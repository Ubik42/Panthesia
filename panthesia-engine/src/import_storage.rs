use serde::Serialize;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovery {
    pub preserved_path: PathBuf,
    pub restored_path: PathBuf,
    pub carried_annotations: bool,
}
pub struct Stored {
    pub path: PathBuf,
    pub recovery: Option<Recovery>,
}
impl Stored {
    pub fn warning(&self) -> Option<String> {
        self.recovery.as_ref().map(|r| {
            format!(
                "原导入文件或附加资料已变化，原件保留在 {}；演奏恢复到 {}{}",
                r.preserved_path.display(),
                r.restored_path.display(),
                if r.carried_annotations {
                    "，已保留同一内容的个人资料"
                } else {
                    ""
                }
            )
        })
    }
}
pub(crate) fn matches_content(path: &Path, expected: &str) -> Result<bool, String> {
    if panthesia_core::utils::atomic_file::is_capturing(path) {
        let bytes = panthesia_core::utils::atomic_file::read_dependency(path,32_000_000).map_err(|e|e.to_string())?;
        return Ok(blake3::hash(&bytes).to_hex().as_str()==expected);
    }
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 32_000_000 {
        return Ok(false);
    }
    let mut hash = blake3::Hasher::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0usize;
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        total += read;
        if total > 32_000_000 {
            return Ok(false);
        }
        hash.update(&buffer[..read]);
    }
    Ok(hash.finalize().to_hex().as_str() == expected)
}
fn usable(path: &Path, bytes_id: &str, cid: &str) -> bool {
    let Ok(bytes) = panthesia_core::utils::atomic_file::read_dependency(path,32_000_000) else {return false;};
    if blake3::hash(&bytes).to_hex().as_str()!=bytes_id { return false; }
    match panthesia_core::library::load_song_sidecar(path, cid) {
        Ok(_) => true,
        Err(panthesia_core::library::MetadataError::Read(e)) if e.kind() == std::io::ErrorKind::NotFound => true,
        _ => false,
    }
}
pub fn store(root: &Path, stem: &str, cid: &str, bytes: &[u8]) -> Result<Stored, String> {
    store_with_identity(root, stem, cid, cid, bytes)
}
// Read-only counterpart of store_with_identity's candidate selection. The caller
// watches every inspected file, including missing candidates and orphan sidecars.
pub(crate) fn planned_annotations(
    root:&Path, stem:&str, bytes_id:&str, cid:&str,
    mut watch:impl FnMut(&Path)->Result<(),String>,
) -> Result<(PathBuf,PathBuf),String> {
    let original=root.join(format!("{stem}.mid"));
    watch(&original)?; watch(&panthesia_core::library::metadata_sidecar_path(&original))?;
    let original_annotations=panthesia_core::library::load_song_sidecar(&original,cid).is_ok();
    for index in 0..1000 {
        let path=if index==0 {original.clone()} else {root.join(format!("{stem}-restored-{index}.mid"))};
        let sidecar=panthesia_core::library::metadata_sidecar_path(&path);
        watch(&path)?;watch(&sidecar)?;
        match panthesia_core::utils::atomic_file::read_dependency(&path,32_000_000) {
            Ok(_)=>{},
            Err(error) if error.kind()==std::io::ErrorKind::NotFound=>{},
            Err(error)=>{
                if path.try_exists().unwrap_or(false) {continue;}
                return Err(error.to_string());
            }
        }
        // Record missing sidecars as well, to avoid carrying a newly replaced annotation set.
        let _ = panthesia_core::library::load_song_sidecar(&path,cid);
        if panthesia_core::utils::atomic_file::is_file(&path) {
            if usable(&path,bytes_id,cid) {return Ok((path.clone(),path));}
            continue;
        }
        if panthesia_core::utils::atomic_file::is_file(&sidecar) && panthesia_core::library::load_song_sidecar(&path,cid).is_err() {continue;}
        let source=if index>0 && !panthesia_core::utils::atomic_file::is_file(&sidecar) && original_annotations {original.clone()} else {path.clone()};
        return Ok((path,source));
    }
    Err("恢复副本过多，请先整理导入文件位置".into())
}
// Captured publication observes every candidate and stages bytes before any metadata can refer to them.
fn stage_owned(root: &Path, stem: &str, bytes_id: &str, cid: &str, bytes: &[u8]) -> Result<Stored,String> {
    use panthesia_core::{library,utils::atomic_file};
    let original=root.join(format!("{stem}.mid"));
    let annotations=library::load_song_sidecar(&original,cid).ok();
    for index in 0..1000 {
        let path=if index==0 {original.clone()} else {root.join(format!("{stem}-restored-{index}.mid"))};
        let sidecar=library::metadata_sidecar_path(&path);
        let existing=match atomic_file::read_dependency(&path,32_000_000) {
            Ok(value)=>Some(value),
            Err(error) if error.kind()==std::io::ErrorKind::NotFound=>None,
            Err(error)=>{
                // An occupied but unreadable/oversized original is preserved. Use another owned destination.
                if path.try_exists().unwrap_or(false) {continue;}
                return Err(error.to_string());
            }
        };
        let (valid_annotations, sidecar_missing)=match library::load_song_sidecar(&path,cid) {
            Ok(_)=>(true,false),
            Err(library::MetadataError::Read(error)) if error.kind()==std::io::ErrorKind::NotFound=>(false,true),
            Err(_)=>(false,false),
        };
        if let Some(existing)=existing {
            if blake3::hash(&existing).to_hex().as_str()!=bytes_id || (!valid_annotations&&!sidecar_missing) {continue;}
        } else {
            if !valid_annotations&&!sidecar_missing {continue;}
            atomic_file::write(&path,bytes).map_err(|e|e.to_string())?;
            if index>0 && sidecar_missing {
                if let Some(value)=&annotations {library::save_song_sidecar(&path,cid,value.clone()).map_err(|e|e.to_string())?;}
            }
        }
        // The initial sidecar read is also an observation, even when absent.
        let carried_annotations=atomic_file::is_file(&sidecar);
        return Ok(Stored {path:path.clone(),recovery:(index>0).then_some(Recovery {
            preserved_path:original,restored_path:path,carried_annotations,
        })});
    }
    Err("恢复副本过多，请先整理导入文件位置".into())
}
pub fn store_with_identity(
    root: &Path,
    stem: &str,
    bytes_id: &str,
    cid: &str,
    bytes: &[u8],
) -> Result<Stored, String> {
    if stem.len() != 64
        || !stem.bytes().all(|b| b.is_ascii_hexdigit())
        || cid.len() != 64
        || !cid.bytes().all(|b| b.is_ascii_hexdigit())
        || blake3::hash(bytes).to_hex().as_str() != bytes_id
    {
        return Err("导入内容身份无效".into());
    }
    if panthesia_core::utils::atomic_file::is_capturing(&root.join(format!("{stem}.mid"))) {
        return stage_owned(root,stem,bytes_id,cid,bytes);
    }
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let original = root.join(format!("{stem}.mid"));
    let annotations = panthesia_core::library::load_song_sidecar(&original, cid).ok();
    for index in 0..1000 {
        let path = if index == 0 {
            original.clone()
        } else {
            root.join(format!("{stem}-restored-{index}.mid"))
        };
        if path.exists() {
            if !usable(&path, bytes_id, cid) {
                continue;
            }
            let carried_annotations =
                panthesia_core::library::load_song_sidecar(&path, cid).is_ok();
            return Ok(Stored {
                path: path.clone(),
                recovery: (index > 0).then_some(Recovery {
                    preserved_path: original,
                    restored_path: path,
                    carried_annotations,
                }),
            });
        }
        let sidecar = panthesia_core::library::metadata_sidecar_path(&path);
        if sidecar.exists() && panthesia_core::library::load_song_sidecar(&path, cid).is_err() {
            continue;
        }
        let mut file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        };
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        if index > 0 && !sidecar.exists() {
            if let Some(value) = &annotations {
                panthesia_core::library::save_song_sidecar(&path, cid, value.clone())
                    .map_err(|e| e.to_string())?;
            }
        }
        return Ok(Stored {
            path: path.clone(),
            recovery: (index > 0).then_some(Recovery {
                preserved_path: original,
                restored_path: path,
                carried_annotations: annotations.is_some(),
            }),
        });
    }
    Err("恢复副本过多，请先整理导入文件位置".into())
}
