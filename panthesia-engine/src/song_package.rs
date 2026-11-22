//! Song package recognition (current-plan 3.2): files next to a song that belong to it, found
//! by fixed naming rules — never by matching titles of different arrangements. The suggestions
//! are only listed; the user adds them to the manifest from the song files dialog.
use serde::Serialize;
use std::path::{Path, PathBuf};

const AUDIO: &[&str] = &["wav", "mp3", "flac", "ogg", "m4a", "aac", "opus"];
const VIDEO: &[&str] = &["mp4", "mkv", "webm"];
const MIDI: &[&str] = &["mid", "midi", "kar"];
const SCORE: &[&str] = &["musicxml", "mxl", "xml", "abc"];
const PAPER: &[&str] = &["pdf"];
/// Ground-truth annotation files of the POP909 dataset.
const POP909: &[(&str, &str)] = &[
    ("chord_midi.txt", "和弦（MIDI 时间）"),
    ("chord_audio.txt", "和弦（音频时间）"),
    ("key_audio.txt", "调性"),
    ("beat_midi.txt", "拍（MIDI 时间）"),
    ("beat_audio.txt", "拍（音频时间）"),
];
const VERSION_MARKS: &[&str] = &["_原调_", "_C大调_", "_原调", "_C大调"];
const DIR_LIMIT: usize = 2000;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub path: PathBuf,
    pub role: &'static str,
    pub stem: Option<&'static str>,
    pub label: Option<String>,
    pub reason: String,
}

fn ext(path: &Path) -> String {
    path.extension().unwrap_or_default().to_string_lossy().to_ascii_lowercase()
}
fn stem(path: &Path) -> String {
    path.file_stem().unwrap_or_default().to_string_lossy().to_string()
}
fn dir_name(path: &Path) -> String {
    path.file_name().unwrap_or_default().to_string_lossy().to_string()
}
fn list(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    // Hidden files (`._name` AppleDouble forks, `.DS_Store`) are not part of a song.
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .take(DIR_LIMIT)
        .map(|e| e.path())
        .filter(|p| p.is_file() && !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')))
        .collect();
    out.sort();
    out
}

/// The song's base name without version and stem suffixes: `X_原调_乐谱量化` → `X`,
/// `001-v1` → `001`.
fn base_name(song_stem: &str) -> String {
    for mark in VERSION_MARKS {
        if let Some(at) = song_stem.find(mark) {
            return song_stem[..at].to_string();
        }
    }
    if let Some((base, version)) = song_stem.rsplit_once("-v") {
        if !base.is_empty() && version.chars().all(|c| c.is_ascii_digit()) && !version.is_empty() {
            return base.to_string();
        }
    }
    song_stem.to_string()
}
/// A readable version label from the part of a file name after the base: `_原调_自动对齐` →
/// `原调 · 自动对齐`, `-v2` → `v2`.
fn version_label(base: &str, file_stem: &str) -> Option<String> {
    let rest = file_stem.strip_prefix(base)?.trim_matches(|c: char| c == '_' || c == '-' || c == ' ');
    (!rest.is_empty()).then(|| rest.split('_').filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · "))
}

/// Files that belong to the song at `song`, except `known` ones (already in its manifest).
pub fn related_files(song: &Path, known: &[PathBuf]) -> Vec<Suggestion> {
    let Some(dir) = song.parent() else { return Vec::new() };
    let song_stem = stem(song);
    let base = base_name(&song_stem);
    let same = |a: &Path, b: &Path| a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy());
    let mut out: Vec<Suggestion> = Vec::new();
    let mut push = |s: Suggestion| {
        if !same(&s.path, song) && !known.iter().any(|k| same(k, &s.path)) && !out.iter().any(|o| same(&o.path, &s.path)) {
            out.push(s);
        }
    };

    // Same folder: same-name audio, vocals, scores, paper scores; POP909 annotations.
    let in_dir = list(dir);
    for file in &in_dir {
        let (e, s) = (ext(file), stem(file));
        let name = dir_name(file).to_ascii_lowercase();
        if AUDIO.contains(&e.as_str()) || VIDEO.contains(&e.as_str()) {
            let vocal = s == format!("{base}_人声") || s == format!("{base}_vocals") || name.starts_with("vocals.");
            if vocal {
                push(Suggestion { path: file.clone(), role: "stem", stem: Some("vocals"), label: Some("人声".into()), reason: "文件名标明人声".into() });
            } else if s == format!("{base}_伴奏") || name.starts_with("accompaniment.") || name.starts_with("instrumental.") {
                push(Suggestion { path: file.clone(), role: "stem", stem: Some("accompaniment"), label: Some("伴奏".into()), reason: "文件名标明伴奏".into() });
            } else if name.starts_with("piano.") {
                push(Suggestion { path: file.clone(), role: "stem", stem: Some("piano"), label: Some("钢琴".into()), reason: "分离出的钢琴音轨".into() });
            } else if s == base || s == song_stem {
                push(Suggestion { path: file.clone(), role: "source", stem: None, label: Some("原音频".into()), reason: "与乐曲同名的音频".into() });
            }
        } else if SCORE.contains(&e.as_str()) && (s == base || s == song_stem || name == "score.musicxml" || name == "score.mxl") {
            push(Suggestion { path: file.clone(), role: "score", stem: None, label: None, reason: "与乐曲同名或导出的乐谱".into() });
        } else if PAPER.contains(&e.as_str()) && (s == base || s == song_stem) {
            push(Suggestion { path: file.clone(), role: "paper", stem: None, label: None, reason: "与乐曲同名的 PDF 谱".into() });
        } else if let Some((_, label)) = POP909.iter().find(|(n, _)| *n == name) {
            push(Suggestion { path: file.clone(), role: "annotation-source", stem: None, label: Some((*label).into()), reason: "POP909 标注文件".into() });
        } else if MIDI.contains(&e.as_str()) {
            // Exported runs keep the raw transcription and the quantized score side by side.
            let pair = matches!((song_stem.as_str(), s.as_str()), ("piano_raw", "score") | ("score", "piano_raw"));
            let marked = s != song_stem && s.starts_with(&base) && VERSION_MARKS.iter().any(|m| s[base.len()..].starts_with(m));
            if pair {
                let label = if s == "score" { "乐谱量化" } else { "原始转录" };
                push(Suggestion { path: file.clone(), role: "performance", stem: None, label: Some(label.into()), reason: "同一次导出的另一份演奏".into() });
            } else if marked {
                push(Suggestion { path: file.clone(), role: "performance", stem: None, label: version_label(&base, &s), reason: "文件名标明同一首歌的版本".into() });
            }
        }
    }
    // versions/ next to the song (or the song inside versions/ and its siblings and parent).
    let versions = if dir_name(dir) == "versions" { Some(dir.to_path_buf()) } else { Some(dir.join("versions")).filter(|d| d.is_dir()) };
    if let Some(versions) = versions {
        for file in list(&versions) {
            let s = stem(&file);
            if MIDI.contains(&ext(&file).as_str()) && s.starts_with(&base) && s != song_stem {
                push(Suggestion { path: file.clone(), role: "performance", stem: None, label: version_label(&base, &s), reason: "versions 文件夹中的版本".into() });
            }
        }
        if dir_name(dir) == "versions" {
            if let Some(parent) = dir.parent() {
                for file in list(parent) {
                    if MIDI.contains(&ext(&file).as_str()) && stem(&file) == base {
                        push(Suggestion { path: file, role: "performance", stem: None, label: Some("原始".into()), reason: "versions 上一级的原始演奏".into() });
                    }
                }
            }
        }
    }
    // `… MIDI` next to `… AUDIO`: same-name audio and vocals in the audio folder.
    let name = dir_name(dir);
    if let (Some(prefix), Some(parent)) = (name.strip_suffix("MIDI"), dir.parent()) {
        let audio_dir = parent.join(format!("{prefix}AUDIO"));
        for file in list(&audio_dir) {
            let s = stem(&file);
            if !AUDIO.contains(&ext(&file).as_str()) {
                continue;
            }
            if s == format!("{song_stem}_人声") || s == format!("{base}_人声") {
                push(Suggestion { path: file, role: "stem", stem: Some("vocals"), label: Some("人声".into()), reason: "AUDIO 文件夹中同名的人声".into() });
            } else if s == song_stem || s == base {
                push(Suggestion { path: file, role: "source", stem: None, label: Some("原音频".into()), reason: "AUDIO 文件夹中同名的音频".into() });
            }
        }
    }
    // Original recordings in a `source` folder next to the song or up to two levels above.
    for up in [Some(dir), dir.parent(), dir.parent().and_then(Path::parent)].into_iter().flatten() {
        for file in list(&up.join("source")) {
            let e = ext(&file);
            if AUDIO.contains(&e.as_str()) || VIDEO.contains(&e.as_str()) {
                push(Suggestion { path: file, role: "source", stem: None, label: Some("原音频".into()), reason: "source 文件夹中的原始录音".into() });
            }
        }
    }
    out
}
