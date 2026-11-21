//! Immutable notation bytes. Source locations and human version names belong to editions.
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
const LIMIT: usize = panthesia_core::source_score_window::ASSET_LIMIT;
pub(crate) fn display_name(path: &Path) -> String {
    path.file_name().unwrap_or_default().to_string_lossy().into_owned()
}
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
    ["musicxml", "mxl"]
        .iter()
        .map(|extension| data.join("scores").join(format!("{hash}.{extension}")))
        .find(|path| verified_asset(path, hash))
}
pub(crate) fn retain(data: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.is_empty() || bytes.len() > LIMIT {
        return Err("演奏谱面为空或超过 64 MiB".into());
    }
    let hash = blake3::hash(bytes).to_hex().to_string();
    if let Some(path) = resolve(data, &hash) {
        return Ok(path);
    }
    let root = data.join("scores");
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

/// Keep a score copy in `folder` (the song's own folder) under the score's file name, so the
/// song's manifest can reference it by a relative path. An existing file with the same content
/// is reused; a different file of the same name gets a ` (2)`, ` (3)` … suffix.
pub(crate) fn retain_beside(folder: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.is_empty() || bytes.len() > LIMIT {
        return Err("演奏谱面为空或超过 64 MiB".into());
    }
    let hash = blake3::hash(bytes).to_hex().to_string();
    let file_name = Path::new(name).file_name().and_then(|n| n.to_str()).unwrap_or("").trim();
    let default_extension = if bytes.starts_with(b"PK") { "mxl" } else { "musicxml" };
    let (stem, extension) = match file_name.rsplit_once('.') {
        Some((stem, ext)) if ["musicxml", "mxl", "xml"].contains(&ext.to_ascii_lowercase().as_str()) && !stem.is_empty() => {
            (stem.to_string(), ext.to_string())
        }
        _ if !file_name.is_empty() => (file_name.to_string(), default_extension.to_string()),
        _ => (hash[..16].to_string(), default_extension.to_string()),
    };
    let clean: String = stem.chars().map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '_' } else { c }).collect();
    for index in 1..=100 {
        let path = folder.join(if index == 1 { format!("{clean}.{extension}") } else { format!("{clean} ({index}).{extension}") });
        if path.is_file() {
            if verified_asset(&path, &hash) {
                return Ok(path);
            }
            continue;
        }
        panthesia_core::utils::atomic_file::write_new(&path, bytes).map_err(|e| format!("谱面无法保存到歌曲文件夹：{e}"))?;
        return Ok(path);
    }
    Err("歌曲文件夹中同名谱面过多，请整理后重试".into())
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
                    name: display_name(&source),
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
