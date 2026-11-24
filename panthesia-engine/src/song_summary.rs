//! One summary of a song for the song page, `probe` and the Keel plugin (current-plan 3.2):
//! facts read from the music (duration, tempo, meter, key, range), the seven kinds of material
//! (performance MIDI, MusicXML, ABC, paper, source audio, vocals, accompaniment) with their
//! files, and the layers with their origin. Everything that shows a song's facts uses this.
use crate::manifest_store::{self, Located};
use panthesia_core::manifest::{Manifest, Origin};
use panthesia_music::MidiFile;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

pub const MIDI: &[&str] = &["mid", "midi", "kar"];
pub const SCORE: &[&str] = &["musicxml", "mxl", "xml", "abc"];
const LIMIT: usize = 64_000_000;

/// Material kinds in display order, with their names.
pub const MATERIALS: &[(&str, &str)] = &[
    ("performance", "演奏 MIDI"),
    ("musicxml", "五线谱 MusicXML"),
    ("abc", "ABC 谱"),
    ("paper", "谱页 PDF"),
    ("source", "原曲音频"),
    ("vocals", "人声"),
    ("accompaniment", "伴奏"),
    ("stems", "其他分轨"),
    ("cover", "封面图片"),
];
/// Layers in display order, with their names.
const LAYERS: &[(&str, &str)] = &[
    ("hands", "手别"),
    ("fingering", "指法"),
    ("chords", "和弦"),
    ("keys", "调性"),
    ("sections", "段落"),
    ("lyrics", "歌词"),
    ("tempo", "速度"),
    ("beats", "拍点"),
];

pub fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

/// What `summarize` read, for callers that draw from the same music (the thumbnail).
pub struct Song {
    pub file: MidiFile,
    pub located: Option<Located>,
    pub performance: String,
    pub music: PathBuf,
}

/// Summary of the song at `path` (MIDI, MusicXML, ABC or `.panthesia`). `check_files` is false
/// when `path` is a detached copy (the Keel plugin's temporary file): referenced files are then
/// reported as registered without looking for them on disk.
pub fn summarize(path: &Path, check_files: bool) -> Result<(Value, Song), String> {
    let path = std::path::absolute(path).map_err(|e| format!("文件位置无法解析：{e}"))?;
    if !path.is_file() {
        return Err(format!("找不到文件：{}", path.display()));
    }
    let ext = extension(&path);
    let kind = if MIDI.contains(&ext.as_str()) {
        "midi"
    } else if ext == "abc" {
        "abc"
    } else if SCORE.contains(&ext.as_str()) {
        "musicxml"
    } else if ext == panthesia_core::manifest::EXTENSION {
        "manifest"
    } else {
        return Err("只能读取 MIDI、MusicXML、ABC 或 .panthesia 文件".into());
    };
    let mut warnings = Vec::<String>::new();
    let located = match manifest_store::locate(&path) {
        Ok(found) => found,
        Err(error) if kind != "manifest" => {
            warnings.push(error);
            None
        }
        Err(error) => return Err(error),
    };
    // The music to read: the file itself, or the manifest's default performance.
    let (music, performance) = match (&located, kind) {
        (Some(found), "manifest") => {
            let dir = found.path.parent().ok_or("清单所在目录无法读取")?;
            let file = found.manifest.default_performance_file().ok_or("清单缺少默认演奏")?;
            (manifest_store::resolve(dir, &file.path), found.manifest.default.performance.clone())
        }
        (Some(found), _) => {
            let id = manifest_store::performance_of(found, &path).unwrap_or_else(|| found.manifest.default.performance.clone());
            (path.clone(), id)
        }
        (None, _) => (path.clone(), String::new()),
    };
    let file = read_music(&music)?;
    let manifest = located.as_ref().map(|found| &found.manifest);
    let facts = facts(&file, manifest, &performance, &music);
    let materials = materials(&music, located.as_ref(), &performance, check_files);
    let layers = layers(&file, manifest, &performance);
    let value = json!({
        "path": path,
        "kind": kind,
        "performancePath": music,
        "facts": facts,
        "materials": materials,
        "layers": layers,
        "manifest": located.as_ref().map(|found| json!({"path": found.path, "readOnly": found.read_only})),
        "warnings": warnings,
    });
    Ok((value, Song { file, located, performance, music }))
}

pub fn read_music(path: &Path) -> Result<MidiFile, String> {
    let bytes = panthesia_core::utils::atomic_file::read_limited(path, LIMIT).map_err(|e| format!("{}：{e}", path.display()))?;
    let bytes = if extension(path) == "abc" { panthesia_notation::abc::musicxml_from_file_bytes(&bytes)? } else { bytes };
    if SCORE.contains(&extension(path).as_str()) {
        let score = panthesia_notation::musicxml::import_musicxml_document(&bytes).map_err(|e| format!("乐谱无法读取：{e}"))?;
        let performance = panthesia_notation::score_performance::generate(&score, 120)?;
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        return MidiFile::from_smf(&name, &performance.smf);
    }
    MidiFile::from_path_bytes_tempo(path, &bytes, &|| Ok(()), crate::music_file::stated_tempo(path))
}

fn facts(file: &MidiFile, manifest: Option<&Manifest>, performance: &str, music: &Path) -> Value {
    let notes: Vec<_> = file.tracks.iter().filter(|t| !t.has_drums || t.has_other_than_drums).flat_map(|t| t.notes.iter()).collect();
    let tracks = file.tracks.iter().filter(|t| !t.notes.is_empty()).count();
    let (low, high) = notes.iter().fold((u8::MAX, 0u8), |(lo, hi), n| (lo.min(n.note), hi.max(n.note)));
    let duration = notes.iter().map(|n| n.end.as_secs_f64()).fold(file.duration.as_secs_f64(), f64::max);
    let (bpm, bpm_source) = tempo(file, manifest, performance, music);
    let (key, key_source) = key(file, manifest, performance, music);
    let meter = file.musical_time.measures.first().map(|m| format!("{}/{}", m.numerator, m.denominator));
    let title = manifest
        .and_then(|m| m.title.clone())
        .or_else(|| music.file_stem().map(|s| s.to_string_lossy().to_string()));
    json!({
        "title": title,
        "artist": manifest.and_then(|m| m.artist.clone()),
        "durationSeconds": (duration * 1000.).round() / 1000.,
        "bpm": bpm.map(|b| (b * 10.).round() / 10.),
        "bpmSource": bpm_source,
        "tempoChanges": file.tempo_track.events().len().saturating_sub(1),
        "timeSignature": meter,
        "key": key,
        "keySource": key_source,
        "measures": file.musical_time.measures.len(),
        "tracks": tracks,
        "notes": notes.len(),
        "pitchRange": (!notes.is_empty()).then_some([low, high]),
    })
}

fn item(id: Option<&str>, path: Option<PathBuf>, relative: &str, label: Option<&str>, state: &str, origin: Option<&str>) -> Value {
    json!({"id": id, "path": path, "relative": relative, "label": label, "state": state, "origin": origin})
}

/// Which material a file of `role` / `stem` / extension belongs to.
fn material_of(role: &str, stem: Option<&str>, path: &str) -> Option<&'static str> {
    let ext = extension(Path::new(path));
    match (role, stem) {
        ("performance", _) => Some("performance"),
        ("score", _) if ext == "abc" => Some("abc"),
        ("score", _) => Some("musicxml"),
        ("paper", _) => Some("paper"),
        ("source", _) => Some("source"),
        ("stem", Some("vocals")) => Some("vocals"),
        ("stem", Some("accompaniment")) => Some("accompaniment"),
        ("stem", _) => Some("stems"),
        ("cover", _) => Some("cover"),
        _ => None,
    }
}

fn materials(music: &Path, located: Option<&Located>, performance: &str, check_files: bool) -> Value {
    let mut groups: Vec<(&str, Vec<Value>)> = MATERIALS.iter().map(|(kind, _)| (*kind, Vec::new())).collect();
    let mut push = |kind: &str, value: Value| {
        if let Some((_, items)) = groups.iter_mut().find(|(k, _)| *k == kind) {
            items.push(value);
        }
    };
    let state_of = |path: &Path| if !check_files { "registered" } else if path.is_file() { "present" } else { "missing" };
    let mut known: Vec<PathBuf> = Vec::new();
    match located {
        Some(found) => {
            let m = &found.manifest;
            let dir = found.path.parent().unwrap_or(Path::new(""));
            for p in &m.performances {
                let Some(f) = m.file(&p.file) else { continue };
                let path = manifest_store::resolve(dir, &f.path);
                let state = if p.id == performance { "current" } else { state_of(&path) };
                let kind = if SCORE.contains(&extension(&path).as_str()) { if extension(&path) == "abc" { "abc" } else { "musicxml" } } else { "performance" };
                push(kind, item(Some(&p.id), Some(path.clone()), &f.path, p.label.as_deref(), state, origin_of(f)));
                known.push(path);
            }
            for f in m.files.iter().filter(|f| f.role != "performance") {
                let Some(kind) = material_of(&f.role, f.stem.as_deref(), &f.path) else { continue };
                let path = manifest_store::resolve(dir, &f.path);
                let paired = m.scores.iter().any(|s| s.file == f.id);
                let mut value = item(Some(&f.id), Some(path.clone()), &f.path, f.label.as_deref(), state_of(&path), origin_of(f));
                value["paired"] = json!(paired);
                value["stem"] = json!(f.stem);
                push(kind, value);
                known.push(path);
            }
        }
        None => {
            let name = music.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let kind = match extension(music).as_str() {
                "abc" => "abc",
                e if SCORE.contains(&e) => "musicxml",
                _ => "performance",
            };
            push(kind, item(None, Some(music.to_path_buf()), &name, None, "current", None));
            known.push(music.to_path_buf());
        }
    }
    // Files that belong to the song by naming rule but are not in its manifest yet.
    for s in crate::song_package::related_files(music, &known) {
        let path = s.path.to_string_lossy().to_string();
        let Some(kind) = material_of(s.role, s.stem, &path) else { continue };
        let relative = s.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let mut value = item(None, Some(s.path.clone()), &relative, s.label.as_deref(), "found", None);
        value["reason"] = json!(s.reason);
        value["role"] = json!(s.role);
        value["stem"] = json!(s.stem);
        push(kind, value);
    }
    let names: std::collections::HashMap<_, _> = MATERIALS.iter().copied().collect();
    Value::Array(
        groups
            .into_iter()
            .filter(|(kind, items)| (*kind != "stems" && *kind != "cover") || !items.is_empty())
            .map(|(kind, items)| json!({"kind": kind, "label": names[kind], "items": items}))
            .collect(),
    )
}

fn origin_of(f: &panthesia_core::manifest::FileRef) -> Option<&'static str> {
    match f.rest.get("provenance").and_then(|p| p.get("origin")).and_then(Value::as_str) {
        Some("generated") => Some("generated"),
        Some("imported") => Some("imported"),
        Some("human") => Some("human"),
        _ => None,
    }
}

fn layers(file: &MidiFile, manifest: Option<&Manifest>, performance: &str) -> Value {
    let imported = |name: &str| -> usize {
        match name {
            "lyrics" => file.lyrics.len(),
            "sections" => file.markers.len(),
            "keys" => file.key_signatures.len(),
            "tempo" => file.tempo_track.events().len().saturating_sub(1),
            _ => 0,
        }
    };
    Value::Array(
        LAYERS
            .iter()
            .filter_map(|(name, label)| {
                let layer = manifest.and_then(|m| m.layer_for(name, performance));
                let (origin, count) = match layer {
                    Some(l) => {
                        let origin = match l.provenance.as_ref().map(|p| &p.origin) {
                            Some(Origin::Human) | None => "human",
                            Some(Origin::Imported) => "imported",
                            Some(Origin::Generated) => "generated",
                        };
                        (Some(origin), layer_count(&l.body))
                    }
                    None if imported(name) > 0 => (Some("imported"), imported(name)),
                    None => (None, 0),
                };
                // `pending`: generated and not yet checked by AI or the player.
                let review = layer.and_then(|l| l.provenance.as_ref()).and_then(|p| p.rest.get("review")).and_then(Value::as_str);
                // Beats only appear when the song has them.
                (*name != "beats" || origin.is_some()).then(|| json!({"name": name, "label": label, "origin": origin, "count": count, "review": review}))
            })
            .collect(),
    )
}

fn layer_count(body: &serde_json::Map<String, Value>) -> usize {
    ["items", "notes", "lines", "changes"]
        .iter()
        .filter_map(|k| body.get(*k).and_then(Value::as_array).map(Vec::len))
        .sum::<usize>()
        + body.get("tracks").and_then(Value::as_object).map_or(0, |t| t.len())
}

fn layer_items<'a>(manifest: Option<&'a Manifest>, name: &str, performance: &str) -> Option<&'a [Value]> {
    manifest?.layer_for(name, performance)?.body.get("items")?.as_array().map(Vec::as_slice)
}

/// Main tempo: manifest `tempo` layer, otherwise the tempo that lasts longest in the file.
fn tempo(file: &MidiFile, manifest: Option<&Manifest>, performance: &str, music: &Path) -> (Option<f64>, &'static str) {
    if let Some(bpm) = layer_items(manifest, "tempo", performance).and_then(|i| i.first()).and_then(|i| i.get("bpm")).and_then(Value::as_f64) {
        return (Some(bpm), "manifest");
    }
    let events = file.tempo_track.events();
    // A file without tempo events plays at the MIDI default of 120; a "BPM76" in the name wins.
    if events.len() == 1 && events[0].tempo == 500_000 {
        if let Some(bpm) = music.file_stem().and_then(|s| s.to_str()).and_then(crate::music_file::filename_bpm) {
            return (Some(bpm), "filename");
        }
    }
    let end = file.duration;
    let mut weights: Vec<(f64, f64)> = Vec::new();
    for (i, e) in events.iter().enumerate() {
        let until = events.get(i + 1).map_or(end, |n| n.timestamp);
        let span = until.saturating_sub(e.timestamp).as_secs_f64();
        let bpm = 60_000_000. / f64::from(e.tempo.max(1));
        match weights.iter_mut().find(|(b, _)| (b - bpm).abs() < 0.05) {
            Some(entry) => entry.1 += span,
            None => weights.push((bpm, span)),
        }
    }
    let best = weights.into_iter().max_by(|a, b| a.1.total_cmp(&b.1)).map(|(bpm, _)| bpm);
    (best, "midi")
}

const SHARP: [&str; 12] = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

fn key_name(tonic: usize, minor: bool) -> String {
    format!("{}:{}", SHARP[tonic % 12], if minor { "min" } else { "maj" })
}
/// Key signature (fifths, minor) → Harte-style key, e.g. (1, false) → "G:maj".
fn signature_key(fifths: i8, minor: bool) -> String {
    let major = (i32::from(fifths) * 7).rem_euclid(12) as usize;
    key_name(if minor { (major + 9) % 12 } else { major }, minor)
}

/// The song's key as (fifths, minor) for notation, from the same rules as the facts.
pub fn key_signature(song: &Song) -> (i8, bool) {
    let manifest = song.located.as_ref().map(|f| &f.manifest);
    let (key, _) = key(&song.file, manifest, &song.performance, &song.music);
    let Some((tonic, mode)) = key.as_deref().and_then(|k| k.split_once(':')) else { return (0, false) };
    let minor = mode == "min";
    let pitch = SHARP.iter().position(|n| *n == tonic).unwrap_or(0) as i64;
    let fifths = (-7i8..=7)
        .filter(|f| (i64::from(*f) * 7 + if minor { 9 } else { 0 }).rem_euclid(12) == pitch)
        .min_by_key(|f| f.abs())
        .unwrap_or(0);
    (fifths, minor)
}

fn key(file: &MidiFile, manifest: Option<&Manifest>, performance: &str, music: &Path) -> (Option<String>, &'static str) {
    if let Some(key) = layer_items(manifest, "keys", performance).and_then(|i| i.first()).and_then(|i| i.get("key")).and_then(Value::as_str) {
        return (Some(key.to_string()), "manifest");
    }
    if let Some((fifths, minor)) = file.key_signature {
        return (Some(signature_key(fifths, minor)), "midi");
    }
    if let Some(key) = music.file_stem().and_then(|s| s.to_str()).and_then(filename_key) {
        return (Some(key), "filename");
    }
    (estimate_key(file), "estimated")
}

/// "yama - Oz - BPM76 - Gmajor" → "G:maj". Only an explicit "major"/"minor" word counts.
fn filename_key(stem: &str) -> Option<String> {
    let lower = stem.to_ascii_lowercase();
    for (word, minor) in [("major", false), ("minor", true)] {
        let Some(at) = lower.find(word) else { continue };
        let head = stem[..at].trim_end_matches([' ', '-', '_']);
        let mut chars = head.chars().rev();
        let last = chars.next()?;
        let (letter, accidental) = match last {
            '#' | 'b' if head.len() >= 2 => (chars.next()?, if last == '#' { 1 } else { -1 }),
            c => (c, 0),
        };
        let base = match letter.to_ascii_uppercase() {
            'C' => 0,
            'D' => 2,
            'E' => 4,
            'F' => 5,
            'G' => 7,
            'A' => 9,
            'B' => 11,
            _ => continue,
        };
        // The letter must start a word: "Gmajor", "G major", "F#minor".
        let before = head.chars().rev().nth(if accidental == 0 { 1 } else { 2 });
        if before.is_some_and(|c| c.is_ascii_alphanumeric()) {
            continue;
        }
        return Some(key_name((base + 12 + accidental) as usize % 12, minor));
    }
    None
}

/// Krumhansl–Kessler key profiles correlated with the duration-weighted pitch-class histogram.
fn estimate_key(file: &MidiFile) -> Option<String> {
    panthesia_analysis::main_key(&panthesia_analysis::notes(&file.source), &file.musical_time).map(|key| key.harte())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_from_signature_and_filename() {
        assert_eq!(signature_key(1, false), "G:maj");
        assert_eq!(signature_key(-3, true), "C:min");
        assert_eq!(signature_key(0, true), "A:min");
        assert_eq!(filename_key("yama - Oz - BPM76 - Gmajor").as_deref(), Some("G:maj"));
        assert_eq!(filename_key("Song - F#minor").as_deref(), Some("F#:min"));
        assert_eq!(filename_key("Song - Bb major").as_deref(), Some("Bb:maj"));
        assert_eq!(filename_key("Harmonic minor study"), None);
        assert_eq!(crate::music_file::filename_bpm("yama - Oz - BPM76 - Gmajor"), Some(76.));
        assert_eq!(crate::music_file::filename_bpm("Song 132bpm"), Some(132.));
        assert_eq!(crate::music_file::filename_bpm("Song"), None);
    }
}
