//! Converted and imported notation drafts remain independent from adopted versions and originals.
use panthesia_core::utils::atomic_file;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
#[derive(Clone, Deserialize, Serialize)]
pub struct DraftPage {
    pub id: String,
    pub kind: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRecord {
    pub id: String,
    pub content_id: String,
    pub name: String,
    pub kind: String,
    pub source: PathBuf,
    #[serde(default)]
    pub source_warning: Option<String>,
    pub book_id: Option<String>,
    pub pages: Vec<DraftPage>,
    pub hash: String,
    pub size: usize,
    pub created_at_ms: u64,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub generation:Option<panthesia_core::song_project::NotationGeneration>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSaved {
    pub version_id: Option<String>,
    pub path: PathBuf,
    pub linked: bool,
    #[serde(default)]
    pub opened: bool,
    pub warning: Option<String>,
    #[serde(default)]
    pub already_saved: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary {
    pub id: String,
    pub content_id: String,
    pub name: String,
    pub fingerprint: String,
    pub kind: String,
    pub size: usize,
    pub created_at_ms: u64,
    pub saved: bool,
    pub save_pending: bool,
    pub saved_path: Option<PathBuf>,
    pub source_warning: Option<String>,
    pub generation:Option<panthesia_core::song_project::NotationGeneration>,
}
#[derive(Serialize)]
pub struct DraftListing {
    pub drafts: Vec<DraftSummary>,
    pub issues: Vec<String>,
}
/// Keep machine provenance when a retained draft becomes an adopted score version.
pub(crate) fn automatic_origins(data: &Path, check: &impl Fn() -> Result<(), String>) -> Result<std::collections::BTreeMap<String, String>, String> {
    let mut origins = std::collections::BTreeMap::new();
    let entries = match std::fs::read_dir(data.join("notation-drafts")) {
        Ok(entries) => entries,
        Err(e) if e.kind()==std::io::ErrorKind::NotFound => return Ok(origins),
        Err(e) => return Err(e.to_string()),
    };
    for (index,entry) in entries.enumerate() {
        check()?;
        if index>=4096 { break; }
        let path=entry.map_err(|e|e.to_string())?.path();
        if !path.extension().is_some_and(|e|e=="json") {continue;}
        let Some(id)=path.file_stem().and_then(|s|s.to_str()).filter(|id|valid_id(id)) else {continue;};
        let Ok(bytes)=atomic_file::read_limited(&path,32_768) else {continue;};
        let Ok(record)=serde_json::from_slice::<DraftRecord>(&bytes) else {continue;};
        if record.id!=id || validate(&record).is_err() {continue;}
        let origin=match record.kind.as_str() {
            "midiToNotation"=>"MIDI 自动转谱初稿；拍号、声部、分手与节奏待校对",
            "paperToNotation"=>"纸谱自动识别初稿；音高、节奏、声部与谱面对应待校对",
            _=>continue,
        };
        origins.insert(record.hash,origin.into());
    }
    Ok(origins)
}
fn valid_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn path(data: &Path, id: &str, suffix: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("谱面初稿编号无效".into());
    }
    Ok(data.join("notation-drafts").join(format!("{id}.{suffix}")))
}
fn validate(record: &DraftRecord) -> Result<(), String> {
    if !valid_id(&record.id)
        || !valid_id(&record.hash)
        || record.content_id.is_empty()
        || record.content_id.len() > 256
        || record.name.trim().is_empty()
        || record.name.len() > 1024
        || record.name.contains('\0')
        || record
            .source_warning
            .as_ref()
            .is_some_and(|warning| warning.len() > 16_384)
        || !["midiToNotation", "paperToNotation", "importedNotation"].contains(&record.kind.as_str())
        || record.pages.len() > 80
        || (record.kind == "paperToNotation"
            && (record
                .book_id
                .as_deref()
                .is_none_or(|id| id.trim().is_empty() || id.len() > 256 || id.contains('\0'))
                || record.pages.is_empty()))
        || (["midiToNotation", "importedNotation"].contains(&record.kind.as_str())
            && (record.book_id.is_some() || !record.pages.is_empty()))
        || record.pages.iter().any(|page| {
            !valid_id(&page.id) || !["pdf", "png", "jpeg", "webp"].contains(&page.kind.as_str())
        })
        || record.size == 0
        || record.size > 4_000_000
    {
        return Err("谱面初稿记录无效，请重新生成".into());
    }
    Ok(())
}
fn manifest_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if bytes.len() > 32_768 {
        return Err("初稿记录超过容量限制，请保留原谱文件位置".into());
    }
    Ok(bytes)
}
fn validate_saved(value: &DraftSaved) -> Result<(), String> {
    if !value.path.is_absolute()
        || value.path.to_str().is_none()
        || value
            .version_id
            .as_deref()
            .is_some_and(|id| id.trim().is_empty() || id.len() > 256)
        || (value.linked && value.version_id.is_none())
        || (value.opened && !value.linked)
    {
        return Err("初稿保存回执无效，请先核对已保存的原谱文件".into());
    }
    Ok(())
}
pub fn load_record(data: &Path, id: &str, content_id: &str) -> Result<DraftRecord, String> {
    let bytes = atomic_file::read_limited(&path(data, id, "json")?, 32_768)
        .map_err(|error| format!("初稿记录无法读取：{error}"))?;
    let record: DraftRecord =
        serde_json::from_slice(&bytes).map_err(|_| "初稿记录损坏，请重新生成")?;
    validate(&record)?;
    if record.id != id || record.content_id != content_id {
        return Err("谱面初稿属于其他曲目".into());
    }
    Ok(record)
}
pub fn read(data: &Path, id: &str, content_id: &str) -> Result<(DraftRecord, Vec<u8>), String> {
    let record = load_record(data, id, content_id)?;
    let bytes = atomic_file::read_limited(&path(data, id, "score")?, 4_000_000)
        .map_err(|error| format!("初稿副本无法读取：{error}"))?;
    if bytes.len() != record.size || blake3::hash(&bytes).to_hex().as_str() != record.hash {
        return Err("初稿副本缺失或内容已改变，请重新生成".into());
    }
    Ok((record, bytes))
}
pub fn store(data: &Path, record: &DraftRecord, bytes: &[u8]) -> Result<(), String> {
    validate(record)?;
    if bytes.len() != record.size || blake3::hash(bytes).to_hex().as_str() != record.hash {
        return Err("初稿内容与记录不一致".into());
    }
    let manifest = path(data, &record.id, "json")?;
    if manifest.exists() {
        let (existing, _) = read(data, &record.id, &record.content_id)?;
        if existing.hash == record.hash && existing.name == record.name {
            return Ok(());
        }
        return Err("初稿缓存编号已有其他内容，请另存当前初稿".into());
    }
    let folder = data.join("notation-drafts");
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let count = std::fs::read_dir(&folder)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.path().extension().is_some_and(|ext| ext == "json")
                && entry
                    .path()
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .is_some_and(valid_id)
        })
        .take(256)
        .count();
    if count >= 256 {
        return Err("已保留 256 份初稿，请先保存或移除不需要的缓存初稿".into());
    }
    let manifest_bytes = manifest_bytes(record)?;
    atomic_file::write(&path(data, &record.id, "score")?, bytes)
        .map_err(|error| error.to_string())?;
    if let Err(error) = atomic_file::write(&manifest, &manifest_bytes) {
        let _ = std::fs::remove_file(path(data, &record.id, "score")?);
        return Err(error.to_string());
    }
    Ok(())
}
pub fn saved(data: &Path, id: &str, content_id: &str) -> Result<Option<DraftSaved>, String> {
    load_record(data, id, content_id)?;
    match atomic_file::read_limited(&path(data, id, "saved.json")?, 32_768) {
        Ok(bytes) => {
            let receipt = serde_json::from_slice::<DraftSaved>(&bytes)
                .map_err(|_| "初稿保存回执损坏，请先核对已保存的原谱文件")?;
            validate_saved(&receipt)?;
            Ok(Some(receipt))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}
pub fn remember_saved(
    data: &Path,
    id: &str,
    content_id: &str,
    result: &DraftSaved,
) -> Result<(), String> {
    load_record(data, id, content_id)?;
    validate_saved(result)?;
    atomic_file::write(&path(data, id, "saved.json")?, &manifest_bytes(result)?)
        .map_err(|error| error.to_string())
}
pub fn list(data: &Path, content_id: &str) -> Result<DraftListing, String> {
    let folder = data.join("notation-drafts");
    let entries = match std::fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DraftListing {
                drafts: Vec::new(),
                issues: Vec::new(),
            });
        }
        Err(error) => return Err(error.to_string()),
    };
    let mut result = DraftListing {
        drafts: Vec::new(),
        issues: Vec::new(),
    };
    for (index, entry) in entries.enumerate() {
        if index >= 4096 {
            result.issues.push(
                "初稿目录项目较多，列表仅显示本次读取的部分内容。请保留目录并整理不需要的缓存。"
                    .into(),
            );
            break;
        }
        let entry = entry.map_err(|error| error.to_string())?;
        let file = entry.path();
        if !file.extension().is_some_and(|ext| ext == "json") {
            continue;
        }
        let Some(id) = file
            .file_stem()
            .and_then(|stem| stem.to_str())
            .filter(|id| valid_id(id))
        else {
            continue;
        };
        let bytes = match atomic_file::read_limited(&file, 32_768) {
            Ok(bytes) => bytes,
            Err(_) => {
                result
                    .issues
                    .push("一份初稿记录无法读取，其他初稿仍可使用。".into());
                continue;
            }
        };
        let record: DraftRecord = match serde_json::from_slice(&bytes) {
            Ok(record) => record,
            Err(_) => {
                result
                    .issues
                    .push("一份初稿记录损坏，其他初稿仍可使用。".into());
                continue;
            }
        };
        if record.content_id != content_id {
            continue;
        }
        if validate(&record).is_err() || record.id != id {
            result
                .issues
                .push("一份初稿记录内容无效，请重新生成。".into());
            continue;
        }
        let receipt = match saved(data, id, content_id) {
            Ok(receipt) => receipt,
            Err(error) => {
                result.issues.push(error);
                None
            }
        };
        result.drafts.push(DraftSummary {
            id: record.id.clone(),
            content_id: record.content_id,
            name: record.name,
            fingerprint: record.hash,
            kind: record.kind,
            size: record.size,
            created_at_ms: record.created_at_ms,
            saved: receipt.is_some(),
            save_pending: receipt
                .as_ref()
                .is_some_and(|saved| !saved.linked || saved.version_id.is_none()),
            saved_path: receipt.map(|saved| saved.path),
            source_warning: record.source_warning,
            generation:record.generation,
        });
    }
    result
        .drafts
        .sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    result.issues.sort();
    result.issues.dedup();
    Ok(result)
}
pub fn remove(data: &Path, id: &str, content_id: &str) -> Result<(), String> {
    load_record(data, id, content_id)?;
    for suffix in ["score", "saved.json", "json"] {
        match std::fs::remove_file(path(data, id, suffix)?) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}
