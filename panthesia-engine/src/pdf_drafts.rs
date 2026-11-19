//! Retained PDF layouts are separate from the user's editable originals and adopted paper books.
use panthesia_core::utils::atomic_file;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
const MAX: usize = 48_000_000;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDraft {
    pub id: String,
    pub content_id: String,
    pub version_id: String,
    pub source_title: Option<String>,
    pub name: String,
    pub size: usize,
    pub created_at_ms: u64,
    pub warning: Option<String>,
    pub paper_id: Option<String>,
    pub adoption_pending: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub draft: PdfDraft,
    pub hash: String,
    pub source: PathBuf,
    pub source_hash: String,
    pub source_warning: Option<String>,
}
#[derive(Serialize)]
pub struct PdfListing {
    pub drafts: Vec<PdfDraft>,
    pub issues: Vec<String>,
    pub total: usize,
}
fn id_valid(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn path(data: &Path, id: &str, extension: &str) -> Result<PathBuf, String> {
    if !id_valid(id) {
        return Err("PDF 初稿编号无效".into());
    }
    Ok(data.join("pdf-drafts").join(format!("{id}.{extension}")))
}
fn validate(record: &Record) -> Result<(), String> {
    let draft = &record.draft;
    if !id_valid(&draft.id)
        || !id_valid(&record.hash)
        || !id_valid(&record.source_hash)
        || draft.content_id.is_empty()
        || draft.content_id.len() > 256
        || draft.version_id.is_empty()
        || draft.version_id.len() > 256
        || draft
            .source_title
            .as_ref()
            .is_some_and(|title| title.len() > 1024)
        || draft.name.trim().is_empty()
        || draft.name.len() > 1024
        || !(100..=MAX).contains(&draft.size)
        || !record.source.is_absolute()
        || draft
            .paper_id
            .as_deref()
            .is_some_and(|id| id.is_empty() || id.len() > 256)
    {
        return Err("PDF 初稿记录无效，请重新排版".into());
    }
    Ok(())
}
pub fn valid_pdf(bytes: &[u8]) -> bool {
    (100..=MAX).contains(&bytes.len())
        && bytes.starts_with(b"%PDF-")
        && bytes[bytes.len().saturating_sub(1024)..]
            .windows(5)
            .any(|part| part == b"%%EOF")
}
pub fn capacity(data: &Path) -> Result<(), String> {
    let folder = data.join("pdf-drafts");
    let entries = match std::fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let count = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.path().extension().is_some_and(|ext| ext == "json")
                && entry
                    .path()
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .is_some_and(id_valid)
        })
        .take(32)
        .count();
    if count >= 32 {
        return Err("本机已保留 32 份排版 PDF，请先另存或移除不需要的 PDF 缓存".into());
    }
    Ok(())
}
pub fn record(data: &Path, id: &str, content_id: &str) -> Result<Record, String> {
    let bytes = atomic_file::read_limited(&path(data, id, "json")?, 32_768)
        .map_err(|error| format!("PDF 初稿记录无法读取：{error}"))?;
    let record: Record =
        serde_json::from_slice(&bytes).map_err(|_| "PDF 初稿记录损坏，请重新排版")?;
    validate(&record)?;
    if record.draft.id != id || record.draft.content_id != content_id {
        return Err("PDF 初稿属于其他曲目".into());
    }
    Ok(record)
}
pub fn read(data: &Path, id: &str, content_id: &str) -> Result<(Record, Vec<u8>), String> {
    let record = record(data, id, content_id)?;
    let bytes = atomic_file::read_limited(&path(data, id, "pdf")?, MAX)
        .map_err(|error| format!("PDF 初稿无法读取：{error}"))?;
    if bytes.len() != record.draft.size
        || blake3::hash(&bytes).to_hex().as_str() != record.hash
        || !valid_pdf(&bytes)
    {
        return Err("PDF 初稿缺失或内容已改变，请重新排版".into());
    }
    Ok((record, bytes))
}
pub fn update(data: &Path, record: &Record) -> Result<(), String> {
    validate(record)?;
    let bytes = serde_json::to_vec(record).map_err(|error| error.to_string())?;
    if bytes.len() > 32_768 {
        return Err("PDF 初稿记录超过容量限制".into());
    }
    atomic_file::write(&path(data, &record.draft.id, "json")?, &bytes)
        .map_err(|error| error.to_string())
}
pub fn store(data: &Path, record: &Record, bytes: &[u8]) -> Result<(), String> {
    validate(record)?;
    capacity(data)?;
    if !valid_pdf(bytes)
        || bytes.len() != record.draft.size
        || blake3::hash(bytes).to_hex().as_str() != record.hash
    {
        return Err("排版 PDF 内容与记录不一致".into());
    }
    if path(data, &record.draft.id, "json")?.exists() {
        return Err("PDF 初稿编号重复，请重新排版".into());
    }
    std::fs::create_dir_all(data.join("pdf-drafts")).map_err(|error| error.to_string())?;
    let pdf = path(data, &record.draft.id, "pdf")?;
    atomic_file::write(&pdf, bytes).map_err(|error| error.to_string())?;
    if let Err(error) = update(data, record) {
        let _ = std::fs::remove_file(pdf);
        return Err(error);
    }
    Ok(())
}
pub fn list(data: &Path, content_id: Option<&str>) -> Result<PdfListing, String> {
    let entries = match std::fs::read_dir(data.join("pdf-drafts")) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PdfListing {
                drafts: vec![],
                issues: vec![],
                total: 0,
            });
        }
        Err(error) => return Err(error.to_string()),
    };
    let mut output = PdfListing {
        drafts: vec![],
        issues: vec![],
        total: 0,
    };
    for (index, entry) in entries.enumerate() {
        if index >= 1024 {
            output
                .issues
                .push("PDF 缓存目录项目较多，列表尚未全部读取。".into());
            break;
        }
        let file = entry.map_err(|error| error.to_string())?.path();
        if !file.extension().is_some_and(|ext| ext == "json") {
            continue;
        }
        let Some(id) = file
            .file_stem()
            .and_then(|name| name.to_str())
            .filter(|id| id_valid(id))
        else {
            continue;
        };
        let raw = atomic_file::read_limited(&file, 32_768)
            .map_err(|error| error.to_string())
            .and_then(|bytes| {
                serde_json::from_slice::<Record>(&bytes).map_err(|_| "PDF 初稿记录损坏".to_string())
            });
        match raw {
            Ok(record) if validate(&record).is_ok() && record.draft.id == id => {
                output.total += 1;
                if content_id.is_none_or(|cid| record.draft.content_id == cid) {
                    output.drafts.push(record.draft);
                }
            }
            _ => output
                .issues
                .push("一份 PDF 初稿记录无法读取，其他初稿仍可使用。".into()),
        }
    }
    output
        .drafts
        .sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    output.issues.sort();
    output.issues.dedup();
    Ok(output)
}
pub fn remove(data: &Path, id: &str, content_id: &str) -> Result<(), String> {
    record(data, id, content_id)?;
    for extension in ["pdf", "json"] {
        match std::fs::remove_file(path(data, id, extension)?) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}
