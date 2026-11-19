//! Retained MIDI/package exports own only their cache files, never source-library files.
use crate::media_export::{MediaExportKind, MediaExportSummary};
use panthesia_core::utils::atomic_file;
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    path::{Path, PathBuf},
};

const CAPACITY: u64 = 1_073_741_824;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaExportDraft {
    pub id: String,
    pub content_id: String,
    pub request_id: String,
    pub kind: MediaExportKind,
    pub title: String,
    pub name: String,
    pub size: usize,
    pub created_at_ms: u64,
    pub summary: MediaExportSummary,
    pub saved_path: Option<String>,
    pub save_pending_path: Option<String>,
    #[serde(default)]
    pub previous_pending_paths: Vec<String>,
    pub warning: Option<String>,
}
#[derive(Deserialize, Serialize)]
pub struct Record {
    pub draft: MediaExportDraft,
    pub hash: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaExportListing {
    pub drafts: Vec<MediaExportDraft>,
    pub issues: Vec<String>,
    pub total_size: u64,
    pub capacity: u64,
}
fn valid_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn path(data: &Path, id: &str, extension: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("导出成品编号无效".into());
    }
    Ok(data
        .join("document-exports")
        .join(format!("{id}.{extension}")))
}
fn valid(record: &Record) -> bool {
    let row = &record.draft;
    valid_id(&row.id)
        && valid_id(&record.hash)
        && !row.content_id.is_empty()
        && row.content_id.len() <= 256
        && (8..=96).contains(&row.request_id.len())
        && !row.name.trim().is_empty()
        && row.name.len() <= 1024
        && row.title.len() <= 4096
        && (1..=row.kind.maximum()).contains(&row.size)
        && row
            .saved_path
            .as_ref()
            .is_none_or(|path| path.len() <= 131_072)
        && row
            .save_pending_path
            .as_ref()
            .is_none_or(|path| path.len() <= 131_072)
        && row.previous_pending_paths.len() <= 16
        && row
            .previous_pending_paths
            .iter()
            .all(|path| path.len() <= 131_072)
}
pub fn read(data: &Path, id: &str, content_id: &str) -> Result<(Record, PathBuf), String> {
    let bytes = atomic_file::read_limited(&path(data, id, "json")?, 65_536)
        .map_err(|error| format!("导出成品记录无法读取：{error}"))?;
    let record: Record = serde_json::from_slice(&bytes).map_err(|_| "导出成品记录损坏")?;
    if !valid(&record) || record.draft.id != id || record.draft.content_id != content_id {
        return Err("导出成品来源不一致，请重新读取成品列表".into());
    }
    let payload = path(data, id, record.draft.kind.extension())?;
    Ok((record, payload))
}
pub fn update(data: &Path, record: &Record) -> Result<(), String> {
    if !valid(record) {
        return Err("导出成品记录无效".into());
    }
    let bytes = serde_json::to_vec(record).map_err(|error| error.to_string())?;
    if bytes.len() > 65_536 {
        return Err("导出成品记录过大".into());
    }
    atomic_file::write(&path(data, &record.draft.id, "json")?, &bytes)
        .map_err(|error| error.to_string())
}
pub fn list(data: &Path) -> Result<MediaExportListing, String> {
    let mut listing = MediaExportListing {
        drafts: Vec::new(),
        issues: Vec::new(),
        total_size: 0,
        capacity: CAPACITY,
    };
    let entries = match std::fs::read_dir(data.join("document-exports")) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(listing),
        Err(error) => return Err(error.to_string()),
    };
    for (index, entry) in entries.enumerate() {
        if index >= 1024 {
            listing
                .issues
                .push("导出目录项目较多，列表尚未全部读完。".into());
            break;
        }
        let entry = entry.map_err(|error| error.to_string())?.path();
        if !entry
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            continue;
        }
        let Some(id) = entry
            .file_stem()
            .and_then(|value| value.to_str())
            .filter(|id| valid_id(id))
        else {
            continue;
        };
        let raw = atomic_file::read_limited(&entry, 65_536)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Record>(&bytes).ok());
        match raw {
            Some(mut record) if valid(&record) && record.draft.id == id => {
                let file = path(data, id, record.draft.kind.extension())?;
                if !std::fs::metadata(file)
                    .is_ok_and(|metadata| metadata.len() == record.draft.size as u64)
                {
                    record.draft.warning =
                        Some("缓存文件缺失或大小已改变，可以重新制作；此条记录仍可移除。".into());
                }
                listing.total_size = listing.total_size.saturating_add(record.draft.size as u64);
                listing.drafts.push(record.draft);
            }
            _ => listing
                .issues
                .push("一份导出记录无法读取，其他成品仍可使用。".into()),
        }
    }
    listing
        .drafts
        .sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    listing.issues.sort();
    listing.issues.dedup();
    Ok(listing)
}
pub fn capacity(data: &Path, additional: usize) -> Result<(), String> {
    let listing = list(data)?;
    if listing
        .issues
        .iter()
        .any(|issue| issue.contains("尚未全部读完"))
    {
        return Err("导出目录尚未完整读取，请先整理导出缓存，再制作新成品。".into());
    }
    if listing.drafts.len() >= 16 || listing.total_size.saturating_add(additional as u64) > CAPACITY
    {
        return Err(
            "已保留的导出成品达到数量或容量限制（16 份、1 GiB），请先另存并移除不需要的缓存。"
                .into(),
        );
    }
    Ok(())
}
/// Reuse only verified bytes. A pending save receipt must remain independently recoverable.
pub fn equivalent(
    data: &Path,
    candidate: &Record,
    check: &dyn Fn() -> Result<(), String>,
) -> Result<Option<MediaExportDraft>, String> {
    for draft in list(data)?.drafts {
        check()?;
        if draft.content_id != candidate.draft.content_id
            || draft.kind != candidate.draft.kind
            || draft.title != candidate.draft.title
            || draft.name != candidate.draft.name
            || draft.size != candidate.draft.size
            || draft.save_pending_path.is_some()
            || !draft.previous_pending_paths.is_empty()
            || draft.warning.is_some()
        {
            continue;
        }
        let Ok((record, path)) = read(data, &draft.id, &draft.content_id) else {
            continue;
        };
        if record.hash != candidate.hash {
            continue;
        }
        let Ok(mut file) = std::fs::File::open(path) else {
            continue;
        };
        let mut hasher = blake3::Hasher::new();
        let mut count = 0usize;
        let mut buffer = [0u8; 65_536];
        let verified = loop {
            check()?;
            let Ok(size) = file.read(&mut buffer) else {
                break false;
            };
            if size == 0 {
                break count == draft.size;
            }
            count = count.saturating_add(size);
            if count > draft.size {
                break false;
            }
            hasher.update(&buffer[..size]);
        };
        if verified && hasher.finalize().to_hex().as_str() == record.hash {
            return Ok(Some(record.draft));
        }
    }
    Ok(None)
}
pub fn store(data: &Path, record: &Record, bytes: &[u8]) -> Result<(), String> {
    if !valid(record)
        || bytes.len() != record.draft.size
        || blake3::hash(bytes).to_hex().as_str() != record.hash
    {
        return Err("导出成品内容与记录不一致".into());
    }
    capacity(data, bytes.len())?;
    let manifest = path(data, &record.draft.id, "json")?;
    if manifest.exists() {
        return Err("导出请求已保留成品，请重新读取原结果".into());
    }
    std::fs::create_dir_all(data.join("document-exports")).map_err(|error| error.to_string())?;
    let payload = path(data, &record.draft.id, record.draft.kind.extension())?;
    // Publish ownership first. A crash leaves a visible, removable incomplete
    // entry instead of an unlisted large payload outside the capacity budget.
    update(data, record)?;
    if let Err(error) = atomic_file::write(&payload, bytes) {
        let _ = std::fs::remove_file(manifest);
        return Err(format!("导出成品尚未保留：{error}"));
    }
    Ok(())
}
pub fn remove(data: &Path, id: &str, content_id: &str) -> Result<(), String> {
    let (record, payload) = read(data, id, content_id)?;
    let mut owned = vec![payload];
    // A process crash can retain the atomic writer's partial payload. Only the
    // recorded artifact's exact temporary-name family belongs to this removal.
    let payload_prefix = format!(".{id}.{}.tmp-", record.draft.kind.extension());
    let manifest_prefix = format!(".{id}.json.tmp-");
    for entry in
        std::fs::read_dir(data.join("document-exports")).map_err(|error| error.to_string())?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let filename = entry.file_name();
        let Some(filename) = filename.to_str() else {
            continue;
        };
        let suffix = filename
            .strip_prefix(&payload_prefix)
            .or_else(|| filename.strip_prefix(&manifest_prefix));
        if suffix.is_some_and(|suffix| {
            suffix.split_once('-').is_some_and(|(pid, serial)| {
                !pid.is_empty()
                    && !serial.is_empty()
                    && pid.bytes().all(|byte| byte.is_ascii_digit())
                    && serial.bytes().all(|byte| byte.is_ascii_digit())
            })
        }) {
            owned.push(entry.path());
        }
    }
    owned.push(path(data, &record.draft.id, "json")?);
    for file in owned {
        match std::fs::remove_file(file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}
