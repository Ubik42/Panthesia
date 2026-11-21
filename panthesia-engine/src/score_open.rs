//! Opening a MusicXML / MXL score: the generated performance, a copy of the score and the
//! song manifest live in the local cache `cache/scores/<hash>/`, keyed by the score's bytes.
//! Reopening the same score reuses the folder, so edits made to it are kept.
use crate::{Command, Player};
use panthesia_core::library::{self, FingerHint, SongMetadata, SongSidecar};
use panthesia_core::utils::atomic_file;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

const PERFORMANCE: &str = "performance.mid";

fn score_name(name: &str) -> &'static str {
    if name.to_ascii_lowercase().ends_with(".mxl") { "score.mxl" } else { "score.musicxml" }
}

impl Player {
    /// Open `bytes` (MusicXML or MXL named `name`) as a song played at `bpm` where the score
    /// has no tempo. Returns the current song.
    pub(crate) fn open_score_bytes(&mut self, bytes: Vec<u8>, name: &str, bpm: u16) -> Result<Value, String> {
        if bytes.is_empty() || bytes.len() > panthesia_core::source_score_window::ASSET_LIMIT {
            return Err("乐谱文件为空或超过 64 MiB".into());
        }
        let hash = blake3::hash(&bytes).to_hex().to_string();
        let dir = self.data.join("cache").join("scores").join(&hash[..32]);
        let midi = dir.join(PERFORMANCE);
        let score_path = dir.join(score_name(name));
        let score = panthesia_core::musicxml::import_musicxml_document(&bytes)
            .map_err(|e| format!("乐谱无法读取，请检查 MusicXML 或 MXL 文件：{e}"))?;
        let title = score
            .title
            .clone()
            .unwrap_or_else(|| Path::new(name).file_stem().unwrap_or_default().to_string_lossy().to_string());
        if !midi.is_file() || !score_path.is_file() {
            let performance = panthesia_core::score_performance::generate(&score, bpm)?;
            let mut midi_bytes = Vec::new();
            performance.smf.write_std(&mut midi_bytes).map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&dir).map_err(|e| format!("乐谱缓存目录无法创建：{e}"))?;
            atomic_file::write(&score_path, &bytes).map_err(|e| format!("乐谱缓存无法写入：{e}"))?;
            atomic_file::write(&midi, &midi_bytes).map_err(|e| format!("乐谱缓存无法写入：{e}"))?;
            let file = crate::music_file::read_midi(&midi)?;
            let sidecar = initial_sidecar(&file, &performance, &score, &title, &score_path, &hash);
            library::save_song_sidecar(&midi, &file.content_id, sidecar).map_err(|e| e.to_string())?;
        }
        let file = crate::music_file::read_midi(&midi)?;
        self.install(file, title, None)?;
        self.persist()?;
        self.command(Command::CurrentSong)
    }

    /// Load a MIDI file directly (tests).
    #[cfg(test)]
    pub(crate) fn load_file(&mut self, path: PathBuf, title: String) -> Result<Value, String> {
        let file = crate::music_file::read_midi(&path)?;
        self.install(file, title, None)?;
        self.persist()?;
        self.command(Command::CurrentSong)
    }
    /// Open score bytes (tests).
    #[cfg(test)]
    pub(crate) fn import_score(&mut self, bytes: Vec<u8>, name: String, bpm: u16) -> Result<Value, String> {
        self.open_score_bytes(bytes, &name, bpm)
    }
    pub(crate) fn open_score_path(&mut self, path: &Path, bpm: u16) -> Result<Value, String> {
        let bytes = crate::score_sources::read_original(path)?;
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        self.open_score_bytes(bytes, &name, bpm)
    }
}

/// Hands per staff and printed fingerings from the score, plus the score pairing.
fn initial_sidecar(
    file: &panthesia_music::MidiFile,
    performance: &panthesia_core::score_performance::Performance,
    score: &panthesia_core::musicxml::Score,
    title: &str,
    score_path: &PathBuf,
    hash: &str,
) -> SongSidecar {
    let mut track_parts = BTreeMap::new();
    let mut fingerings = Vec::new();
    for (i, staff) in performance.tracks.iter().enumerate() {
        let hints: HashMap<_, _> = staff.notes.iter().map(|n| ((n.start, n.pitch), n.finger)).collect();
        let Some(track) = file.tracks.get(i + 1) else { continue };
        track_parts.insert(track.track_id, staff.part);
        for (index, note) in track.notes.iter().enumerate() {
            let tick = file.tempo_track.seconds_to_pulses(note.start.as_secs_f64()).round() as u64;
            if let Some(finger) = hints.get(&(tick, note.note)).copied().flatten() {
                fingerings.push(FingerHint { track_id: track.track_id, note_index: index, finger });
            }
        }
    }
    SongSidecar {
        metadata: SongMetadata {
            title: Some(title.into()),
            composer: score.composer.clone(),
            notes: (!performance.warnings.is_empty()).then(|| performance.warnings.join("；")),
            ..Default::default()
        },
        track_parts,
        fingerings,
        score: Some(library::ScoreAssociation { path: score_path.clone(), content_id: hash.into() }),
        ..Default::default()
    }
}
