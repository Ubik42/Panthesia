//! Reading performance files from disk.
use panthesia_music::MidiFile;
use std::path::{Path, PathBuf};

/// Tempo for a MIDI without tempo events: the manifest's `tempo` layer, else a BPM in the
/// file name. Sequencer exports often keep the real tempo only there.
pub(crate) fn stated_tempo(path: &Path) -> Option<f64> {
    let layer = panthesia_core::manifest_store::locate(path).ok().flatten().and_then(|found| {
        let performance = panthesia_core::manifest_store::performance_of(&found, path).unwrap_or_else(|| found.manifest.default.performance.clone());
        found.manifest.layer_for("tempo", &performance)?.body.get("items")?.as_array()?.first()?.get("bpm")?.as_f64()
    });
    layer.or_else(|| path.file_stem().and_then(|s| s.to_str()).and_then(filename_bpm))
}

/// "yama - Oz - BPM76 - Gmajor" → 76. Also "76BPM" and "BPM 76".
pub(crate) fn filename_bpm(stem: &str) -> Option<f64> {
    let upper = stem.to_ascii_uppercase();
    let at = upper.find("BPM")?;
    let after: String = upper[at + 3..].trim_start_matches([' ', '_', '-', '=']).chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let before: String = upper[..at].trim_end_matches([' ', '_', '-']).chars().rev().take_while(|c| c.is_ascii_digit() || *c == '.').collect::<Vec<_>>().into_iter().rev().collect();
    [after, before].into_iter().filter_map(|v| v.parse::<f64>().ok()).find(|v| (20.0..=400.0).contains(v))
}

pub(crate) fn read_midi(path: &Path) -> Result<MidiFile, String> {
    read_midi_limited(path, 512_000_000)
}
pub(crate) fn read_midi_checked(path: &Path, check: &impl Fn() -> Result<(), String>) -> Result<MidiFile, String> {
    check()?;
    let path = std::path::absolute(path).map_err(|e| e.to_string())?;
    let bytes = panthesia_core::utils::atomic_file::read_dependency(&path, 32_000_000).map_err(|e| e.to_string())?;
    MidiFile::from_path_bytes_tempo(&path, &bytes, check, stated_tempo(&path))
}
pub(crate) fn read_midi_limited(path: &Path, limit: usize) -> Result<MidiFile, String> {
    let path = std::path::absolute(path).map_err(|e| format!("曲目位置无法解析：{e}"))?;
    let bytes = panthesia_core::utils::atomic_file::read_dependency(&path, limit).map_err(|e| e.to_string())?;
    MidiFile::from_path_bytes_tempo(&path, &bytes, &|| Ok(()), stated_tempo(&path))
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
