//! Durable acknowledgement for one explicit metadata-history claim.
use panthesia_core::utils::atomic_file;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataHistoryClaim {
    pub version: u8,
    pub request_id: String,
    pub source_path: PathBuf,
    pub content_id: String,
    pub target_path: PathBuf,
    pub fingerprint: String,
    pub records: usize,
    pub added: usize,
}
pub(crate) fn valid_id(value: &str) -> bool {
    (8..=96).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}
fn location(data: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("资料历史认领请求编号无效".into());
    }
    Ok(data.join("metadata-claims").join(format!("{id}.json")))
}
fn valid(value: &MetadataHistoryClaim) -> bool {
    let hash = |s: &str| s.len() == 64 && s.bytes().all(|byte| byte.is_ascii_hexdigit());
    value.version == 1
        && valid_id(&value.request_id)
        && hash(&value.content_id)
        && hash(&value.fingerprint)
        && value.records <= 200
        && value.added <= value.records
        && [&value.source_path, &value.target_path]
            .iter()
            .all(|path| !path.as_os_str().is_empty() && path.to_string_lossy().len() <= 32768)
}
pub(crate) fn read(data: &Path, id: &str) -> Result<Option<MetadataHistoryClaim>, String> {
    match atomic_file::read_dependency(&location(data, id)?, 1_000_000) {
        Ok(bytes) => {
            let value: MetadataHistoryClaim = serde_json::from_slice(&bytes)
                .map_err(|e| format!("资料历史认领回执无法读取：{e}"))?;
            if !valid(&value) || value.request_id != id {
                return Err("资料历史认领回执无效，原记录已保留".into());
            }
            Ok(Some(value))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("资料历史认领回执无法读取：{error}")),
    }
}
pub(crate) fn save(data: &Path, value: &MetadataHistoryClaim) -> Result<(), String> {
    if !valid(value) {
        return Err("资料历史认领回执内容无效".into());
    }
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    atomic_file::write(&location(data, &value.request_id)?, &bytes).map_err(|e| e.to_string())
}
