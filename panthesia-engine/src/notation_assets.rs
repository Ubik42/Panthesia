//! Immutable notation bytes. Source locations and human version names belong to editions.
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
const LIMIT: usize = 4_000_000;
fn verified_asset(path: &Path, hash: &str) -> bool {
    use std::io::Read;
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let mut bytes = Vec::new();
    file.take(LIMIT as u64 + 1).read_to_end(&mut bytes).is_ok()
        && bytes.len() <= LIMIT
        && blake3::hash(&bytes).to_hex().as_str() == hash
}

fn valid(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
pub(crate) fn read(path: &Path, expected: &str) -> Result<Vec<u8>, String> {
    let bytes = panthesia_core::utils::atomic_file::read_dependency(path, LIMIT)
        .map_err(|e| e.to_string())?;
    if blake3::hash(&bytes).to_hex().as_str() != expected {
        return Err("谱面内容与所选版本不一致".into());
    }
    Ok(bytes)
}
pub(crate) fn resolve(data: &Path, hash: &str) -> Option<PathBuf> {
    if !valid(hash) {
        return None;
    }
    let root = data.join("library/assets/notation");
    for extension in ["musicxml", "mxl"] {
        let path = root.join(format!("{hash}.{extension}"));
        if verified_asset(&path, hash) {
            return Some(path);
        }
    }
    let entries = std::fs::read_dir(&root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if entry.file_type().is_ok_and(|v| v.is_file())
            && path.file_stem().is_some_and(|s| {
                s.to_string_lossy()
                    .starts_with(&format!("{hash}-restored-"))
            })
            && verified_asset(&path, hash)
        {
            return Some(path);
        }
    }
    None
}
pub(crate) fn retain(data: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.is_empty() || bytes.len() > LIMIT {
        return Err("演奏谱面为空或超过 4 MB".into());
    }
    let hash = blake3::hash(bytes).to_hex().to_string();
    if let Some(path) = resolve(data, &hash) {
        return Ok(path);
    }
    let root = data.join("library/assets/notation");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let extension = if bytes.starts_with(b"PK") {
        "mxl"
    } else {
        "musicxml"
    };
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let temporary = root.join(format!(
        ".{hash}-{}-{}.tmp",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        for index in 0..1000 {
            let path = root.join(if index == 0 {
                format!("{hash}.{extension}")
            } else {
                format!("{hash}-restored-{index}.{extension}")
            });
            match std::fs::hard_link(&temporary, &path) {
                Ok(()) => return Ok(path),
                Err(_) if path.is_file() => {
                    if verified_asset(&path, &hash) {
                        return Ok(path);
                    }
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        Err("谱面恢复副本超过上限，请检查资产目录".into())
    })();
    let _ = std::fs::remove_file(&temporary);
    result
}

pub(crate) fn retain_editions(
    data: &Path,
    cid: &str,
    anchor: &Path,
    versions: &mut Vec<crate::preferences::ScoreVersion>,
) -> Result<bool, String> {
    use panthesia_core::library;
    let mut changed = false;
    for version in versions.iter_mut() {
        let owned = match read(&version.path, &version.content_id) {
            Ok(bytes) => Some(retain(data, &bytes)?),
            Err(_) => resolve(data, &version.content_id),
        };
        if let Some(path) = owned {
            if path != version.path {
                version.path = path;
                changed = true;
            }
        }
    }
    let mut annotations = match library::load_song_sidecar(anchor, cid) {
        Ok(v) => v,
        Err(library::MetadataError::Read(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            Default::default()
        }
        Err(e) => return Err(e.to_string()),
    };
    let mut association_changed = false;
    if let Some(score) = &mut annotations.score {
        let source = library::resolve_score_path(anchor, score);
        let owned = match read(&source, &score.content_id) {
            Ok(bytes) => Some(retain(data, &bytes)?),
            Err(_) => resolve(data, &score.content_id),
        };
        if let Some(path) = owned {
            if !versions.iter().any(|v| v.content_id == score.content_id) {
                versions.push(crate::preferences::ScoreVersion {
                    id: crate::library_scores::associated_id(&path, &score.content_id),
                    name: if source.starts_with(data.join("library/assets/notation")) {
                        "配套乐谱".into()
                    } else {
                        source
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into()
                    },
                    path: path.clone(),
                    content_id: score.content_id.clone(),
                });
                changed = true;
            }
            if path != source {
                score.path = path;
                association_changed = true;
            }
        }
    }
    if association_changed {
        library::save_song_sidecar(anchor, cid, annotations).map_err(|e| e.to_string())?;
    }
    Ok(changed)
}

impl crate::Player {
    pub(crate) fn retain_notation_assets(
        &mut self,
        cid: &str,
        anchor: &Path,
    ) -> Result<(), String> {
        let versions = self
            .preferences
            .score_versions
            .entry(cid.into())
            .or_default();
        if retain_editions(&self.data, cid, anchor, versions)? {
            self.preferences.save(&self.preferences_path)?;
        }
        Ok(())
    }
}
