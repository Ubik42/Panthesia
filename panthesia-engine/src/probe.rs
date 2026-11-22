//! `panthesia probe`: the song summary (`song_summary`) for file managers such as Keel, without
//! starting the program, plus an optional piano-roll thumbnail.
use crate::song_summary;
use panthesia_core::manifest::Manifest;
use panthesia_music::MidiFile;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

pub struct Thumbnail {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
}

/// Probe `path` (MIDI, MusicXML, ABC or `.panthesia`). `detached`: the file is a copy, so the
/// files its manifest references are not looked for. Errors are returned as text.
pub fn probe(path: &Path, thumbnail: Option<Thumbnail>, detached: bool) -> Result<Value, String> {
    let (mut value, song) = song_summary::summarize(path, !detached)?;
    if let Some(t) = thumbnail {
        let manifest = song.located.as_ref().map(|found| &found.manifest);
        write_thumbnail(&song.file, manifest, &song.performance, &t)?;
        value["thumbnail"] = json!(t.path);
    }
    Ok(value)
}

/// Piano-roll PNG: time left to right, pitch bottom to top, colour by hand when the manifest
/// assigns tracks to hands, otherwise by track.
fn write_thumbnail(file: &MidiFile, manifest: Option<&Manifest>, performance: &str, t: &Thumbnail) -> Result<(), String> {
    let (w, h) = (t.width.clamp(16, 4096) as usize, t.height.clamp(16, 4096) as usize);
    // The song page colours (tokens.css): surface, hands, accent.
    const BACKGROUND: [u8; 3] = [0x14, 0x17, 0x1e];
    const OCTAVE: [u8; 3] = [0x23, 0x27, 0x30];
    const PALETTE: [[u8; 3]; 6] = [[0xa9, 0xdf, 0x74], [0x6c, 0xb7, 0xf3], [0x8b, 0x93, 0xf8], [0xf1, 0xad, 0x67], [0xde, 0x94, 0xdc], [0x8d, 0xd6, 0xca]];
    let hands = manifest.and_then(|m| m.layer_for("hands", performance)).and_then(|l| l.body.get("tracks")).and_then(Value::as_object);
    let colour = |track: usize, order: usize| match hands.and_then(|h| h.get(&track.to_string())).and_then(Value::as_str) {
        Some("right") => PALETTE[0],
        Some("left") => PALETTE[1],
        _ => PALETTE[(order + 2) % PALETTE.len()],
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

/// Command line: `probe <path> [--json] [--detached] [--thumbnail <png>] [--size <W>x<H>]`.
/// Prints JSON to stdout; on failure prints `{"error": …}` and returns exit code 1.
pub fn run(args: &[std::ffi::OsString]) -> (i32, String) {
    let mut path = None;
    let mut thumbnail = None;
    let mut size = (480u32, 160u32);
    let mut iter = args.iter();
    let mut error = None;
    let mut detached = false;
    while let Some(arg) = iter.next() {
        match arg.to_str() {
            Some("--json") => {}
            Some("--detached") => detached = true,
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
        (None, None) => Err("用法：panthesia probe <文件> [--json] [--detached] [--thumbnail <png>] [--size 宽x高]".into()),
        (None, Some(path)) => probe(&path, thumbnail.map(|path| Thumbnail { path, width: size.0, height: size.1 }), detached),
    };
    match result {
        Ok(value) => (0, value.to_string()),
        Err(e) => (1, json!({"error": e}).to_string()),
    }
}
