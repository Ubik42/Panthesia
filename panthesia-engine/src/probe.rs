//! `panthesia probe`: song facts for file managers (Keel) without starting the program.
//! Duration, tempo, meter, key, tracks and the manifest's title and layers, plus an optional
//! piano-roll thumbnail. MIDI and manifests are parsed here only; the plugin calls this.
use crate::manifest_store;
use panthesia_core::manifest::Manifest;
use panthesia_music::MidiFile;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

const MIDI: &[&str] = &["mid", "midi", "kar"];
const SCORE: &[&str] = &["musicxml", "mxl", "xml", "abc"];
const LIMIT: usize = 64_000_000;

pub struct Thumbnail {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

/// Probe `path` (MIDI, MusicXML or `.panthesia`). Errors are returned as text.
pub fn probe(path: &Path, thumbnail: Option<Thumbnail>) -> Result<Value, String> {
    let path = std::path::absolute(path).map_err(|e| format!("文件位置无法解析：{e}"))?;
    if !path.is_file() {
        return Err(format!("找不到文件：{}", path.display()));
    }
    let ext = extension(&path);
    let kind = if MIDI.contains(&ext.as_str()) {
        "midi"
    } else if SCORE.contains(&ext.as_str()) {
        "musicxml"
    } else if ext == panthesia_core::manifest::EXTENSION {
        "manifest"
    } else {
        return Err("只能分析 MIDI、MusicXML 或 .panthesia 文件".into());
    };
    let mut warnings = Vec::<String>::new();
    let located = match manifest_store::locate(&path) {
        Ok(found) => found,
        Err(error) => {
            if kind == "manifest" {
                return Err(error);
            }
            warnings.push(error);
            None
        }
    };
    // The music file to analyse: the file itself, or the manifest's default performance.
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

    let notes: Vec<_> = file.tracks.iter().filter(|t| !t.has_drums || t.has_other_than_drums).flat_map(|t| t.notes.iter()).collect();
    let tracks = file.tracks.iter().filter(|t| !t.notes.is_empty()).count();
    let (low, high) = notes.iter().fold((u8::MAX, 0u8), |(lo, hi), n| (lo.min(n.note), hi.max(n.note)));
    let duration = notes.iter().map(|n| n.end.as_secs_f64()).fold(file.duration.as_secs_f64(), f64::max);
    let (bpm, bpm_source) = tempo(&file, manifest, &performance, &music);
    let (key, key_source) = key(&file, manifest, &performance, &music);
    let meter = file.musical_time.measures.first().map(|m| format!("{}/{}", m.numerator, m.denominator));
    let title = manifest
        .and_then(|m| m.title.clone())
        .or_else(|| music.file_stem().map(|s| s.to_string_lossy().to_string()));

    let thumbnail = match thumbnail {
        Some(t) => {
            write_thumbnail(&file, manifest, &performance, &t)?;
            Some(t.path)
        }
        None => None,
    };
    Ok(json!({
        "path": path,
        "kind": kind,
        "performancePath": music,
        "title": title,
        "artist": manifest.and_then(|m| m.artist.clone()),
        "durationSeconds": (duration * 1000.).round() / 1000.,
        "bpm": bpm.map(|b| (b * 10.).round() / 10.),
        "bpmSource": bpm_source,
        "tempoChanges": file.tempo_track.events().len().saturating_sub(1),
        "timeSignature": meter,
        "key": key,
        "keySource": key_source,
        "tracks": tracks,
        "notes": notes.len(),
        "pitchRange": (!notes.is_empty()).then_some([low, high]),
        "importedLayers": {
            "lyrics": file.lyrics.len(),
            "sections": file.markers.iter().map(|m| m.name.as_str()).take(64).collect::<Vec<_>>(),
            "keyChanges": file.key_signatures.len(),
        },
        "manifest": located.as_ref().map(|found| manifest_summary(found)),
        "thumbnail": thumbnail,
        "warnings": warnings,
    }))
}

fn read_music(path: &Path) -> Result<MidiFile, String> {
    let bytes = panthesia_core::utils::atomic_file::read_limited(path, LIMIT).map_err(|e| format!("{}：{e}", path.display()))?;
    let bytes = if extension(path) == "abc" { panthesia_notation::abc::musicxml_from_file_bytes(&bytes)? } else { bytes };
    if SCORE.contains(&extension(path).as_str()) {
        let score = panthesia_notation::musicxml::import_musicxml_document(&bytes).map_err(|e| format!("乐谱无法读取：{e}"))?;
        let performance = panthesia_notation::score_performance::generate(&score, 120)?;
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        return MidiFile::from_smf(&name, &performance.smf);
    }
    MidiFile::from_path_bytes(path, &bytes)
}

fn manifest_summary(found: &manifest_store::Located) -> Value {
    let m = &found.manifest;
    let dir = found.path.parent().unwrap_or(Path::new(""));
    let missing: Vec<_> = m.files.iter().filter(|f| !manifest_store::resolve(dir, &f.path).is_file()).map(|f| f.id.clone()).collect();
    json!({
        "path": found.path,
        "readOnly": found.read_only,
        "title": m.title,
        "artist": m.artist,
        "tags": m.metadata.get("tags"),
        "layers": m.layers.keys().collect::<Vec<_>>(),
        "performances": m.performances.iter().map(|p| json!({"id": p.id, "label": p.label})).collect::<Vec<_>>(),
        "stems": m.files.iter().filter(|f| f.role == "stem").filter_map(|f| f.stem.clone()).collect::<Vec<_>>(),
        "hasScore": !m.scores.is_empty(),
        "missing": missing,
    })
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
        if let Some(bpm) = music.file_stem().and_then(|s| s.to_str()).and_then(filename_bpm) {
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

/// "yama - Oz - BPM76 - Gmajor" → 76. Also "76BPM" and "BPM 76".
fn filename_bpm(stem: &str) -> Option<f64> {
    let upper = stem.to_ascii_uppercase();
    let at = upper.find("BPM")?;
    let after: String = upper[at + 3..].trim_start_matches([' ', '_', '-', '=']).chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let before: String = upper[..at].trim_end_matches([' ', '_', '-']).chars().rev().take_while(|c| c.is_ascii_digit() || *c == '.').collect::<Vec<_>>().into_iter().rev().collect();
    [after, before].into_iter().filter_map(|v| v.parse::<f64>().ok()).find(|v| (20.0..=400.0).contains(v))
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

/// Piano-roll PNG: time left to right, pitch bottom to top, colour by hand when the manifest
/// assigns tracks to hands, otherwise by track.
fn write_thumbnail(file: &MidiFile, manifest: Option<&Manifest>, performance: &str, t: &Thumbnail) -> Result<(), String> {
    let (w, h) = (t.width.clamp(16, 4096) as usize, t.height.clamp(16, 4096) as usize);
    const BACKGROUND: [u8; 3] = [0x17, 0x19, 0x1e];
    const OCTAVE: [u8; 3] = [0x22, 0x25, 0x2c];
    const PALETTE: [[u8; 3]; 6] = [[0x7f, 0xc8, 0x5a], [0x4f, 0x9c, 0xf0], [0xf0, 0xa3, 0x3c], [0xc9, 0x6d, 0xe8], [0xe8, 0x5d, 0x75], [0x46, 0xc8, 0xc0]];
    let hands = manifest.and_then(|m| m.layer_for("hands", performance)).and_then(|l| l.body.get("tracks")).and_then(Value::as_object);
    let colour = |track: usize, order: usize| match hands.and_then(|h| h.get(&track.to_string())).and_then(Value::as_str) {
        Some("right") => PALETTE[0],
        Some("left") => PALETTE[1],
        _ => PALETTE[order % PALETTE.len()],
    };
    let mut pixels = vec![0u8; w * h * 3];
    for px in pixels.chunks_exact_mut(3) {
        px.copy_from_slice(&BACKGROUND);
    }
    let tracks: Vec<_> = file.tracks.iter().filter(|t| !t.notes.is_empty() && (!t.has_drums || t.has_other_than_drums)).collect();
    let (mut low, mut high) = (u8::MAX, 0u8);
    for n in tracks.iter().flat_map(|t| t.notes.iter()) {
        low = low.min(n.note);
        high = high.max(n.note);
    }
    if low <= high {
        let low = i32::from(low.saturating_sub(2));
        let high = i32::from(high.saturating_add(2).min(127));
        let rows = (high - low + 1) as f64;
        let end = tracks.iter().flat_map(|t| t.notes.iter()).map(|n| n.end.as_secs_f64()).fold(0.1, f64::max);
        let y_of = |pitch: i32| ((f64::from(high - pitch) / rows) * h as f64) as usize;
        let row_height = ((h as f64 / rows).ceil() as usize).max(1);
        for pitch in (low..=high).filter(|p| p % 12 == 0) {
            let y = y_of(pitch).min(h - 1);
            for x in 0..w {
                pixels[(y * w + x) * 3..][..3].copy_from_slice(&OCTAVE);
            }
        }
        for (order, track) in tracks.iter().enumerate() {
            let c = colour(track.track_id, order);
            for n in track.notes.iter() {
                let x0 = ((n.start.as_secs_f64() / end) * w as f64) as usize;
                let x1 = (((n.end.as_secs_f64() / end) * w as f64).ceil() as usize).max(x0 + 1).min(w);
                let y0 = y_of(i32::from(n.note)).min(h - 1);
                let y1 = (y0 + row_height).min(h);
                for y in y0..y1 {
                    for x in x0.min(w - 1)..x1 {
                        pixels[(y * w + x) * 3..][..3].copy_from_slice(&c);
                    }
                }
            }
        }
    }
    if let Some(parent) = t.path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("缩略图目录无法创建：{e}"))?;
    }
    let out = std::fs::File::create(&t.path).map_err(|e| format!("缩略图无法写入：{e}"))?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(out), w as u32, h as u32);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| format!("缩略图无法写入：{e}"))?;
    writer.write_image_data(&pixels).map_err(|e| format!("缩略图无法写入：{e}"))?;
    writer.finish().map_err(|e| format!("缩略图无法写入：{e}"))
}

/// Command line: `probe <path> [--json] [--thumbnail <png>] [--size <W>x<H>]`.
/// Prints JSON to stdout; on failure prints `{"error": …}` and returns exit code 1.
pub fn run(args: &[std::ffi::OsString]) -> (i32, String) {
    let mut path = None;
    let mut thumbnail = None;
    let mut size = (480u32, 160u32);
    let mut iter = args.iter();
    let mut error = None;
    while let Some(arg) = iter.next() {
        match arg.to_str() {
            Some("--json") => {}
            Some("--thumbnail") => thumbnail = iter.next().map(PathBuf::from),
            Some("--size") => {
                let parsed = iter.next().and_then(|v| v.to_str()).and_then(|v| v.split_once('x')).and_then(|(a, b)| Some((a.parse().ok()?, b.parse().ok()?)));
                match parsed {
                    Some(value) => size = value,
                    None => error = Some("--size 应写作 宽x高，例如 480x160".to_string()),
                }
            }
            Some(flag) if flag.starts_with("--") => error = Some(format!("未知参数：{flag}")),
            _ if path.is_none() => path = Some(PathBuf::from(arg)),
            _ => error = Some("只能分析一个文件".into()),
        }
    }
    let result = match (error, path) {
        (Some(e), _) => Err(e),
        (None, None) => Err("用法：panthesia probe <文件> [--json] [--thumbnail <png>] [--size 宽x高]".into()),
        (None, Some(path)) => probe(&path, thumbnail.map(|path| Thumbnail { path, width: size.0, height: size.1 })),
    };
    match result {
        Ok(value) => (0, value.to_string()),
        Err(e) => (1, json!({"error": e}).to_string()),
    }
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
        assert_eq!(filename_bpm("yama - Oz - BPM76 - Gmajor"), Some(76.));
        assert_eq!(filename_bpm("Song 132bpm"), Some(132.));
        assert_eq!(filename_bpm("Song"), None);
    }
}
