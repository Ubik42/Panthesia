//! Reading performance files from disk.
use panthesia_music::MidiFile;
use std::path::{Path, PathBuf};

pub(crate) fn read_midi(path: &Path) -> Result<MidiFile, String> {
    read_midi_limited(path, 512_000_000)
}
pub(crate) fn read_midi_checked(path: &Path, check: &impl Fn() -> Result<(), String>) -> Result<MidiFile, String> {
    check()?;
    let path = std::path::absolute(path).map_err(|e| e.to_string())?;
    let bytes = panthesia_core::utils::atomic_file::read_dependency(&path, 32_000_000).map_err(|e| e.to_string())?;
    MidiFile::from_path_bytes_checked(path, &bytes, check)
}
pub(crate) fn read_midi_limited(path: &Path, limit: usize) -> Result<MidiFile, String> {
    let path = std::path::absolute(path).map_err(|e| format!("曲目位置无法解析：{e}"))?;
    let bytes = panthesia_core::utils::atomic_file::read_dependency(&path, limit).map_err(|e| e.to_string())?;
    MidiFile::from_path_bytes(&path, &bytes)
}
/// The first of `candidates` whose content is `content_id`.
pub fn verified_file(_data: &Path, content_id: &str, candidates: impl IntoIterator<Item = PathBuf>) -> Result<MidiFile, String> {
    for path in candidates {
        if let Ok(file) = read_midi(&path) {
            if file.content_id == content_id {
                return Ok(file);
            }
        }
    }
    Err("曲目文件缺失、内容改变或无法读取，请重新打开同一内容的文件".into())
}
/// Display title of a saved free-play take, `演奏-<timestamp>-….mid`.
pub(crate) fn recording_title(path: &Path) -> String {
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let timestamp = stem.strip_prefix("演奏-").and_then(|v| v.split('-').next()).and_then(|v| v.parse::<u128>().ok());
    if let Some(timestamp) = timestamp {
        let millis = if timestamp > 100_000_000_000_000_000 { timestamp / 1_000_000 } else { timestamp };
        if let Ok(millis) = i64::try_from(millis) {
            if let Some(time) = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(millis) {
                return format!("自由演奏 · {}", time.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M"));
            }
        }
    }
    stem.into_owned()
}
