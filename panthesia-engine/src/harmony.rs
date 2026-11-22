//! The chord layer of the current song and its display. Sources in order: the manifest's
//! `chords` layer (any origin), a POP909 `chord_midi.txt` beside the file (imported), the
//! analysis of the played notes (generated). Names and degrees are spelled against the same
//! effective key timeline as the note labels, so a chord's degree matches its notes'.
use crate::player::Player;
use panthesia_analysis::harte::{Chord, Key};
use panthesia_core::manifest_store;
use panthesia_music::MidiFile;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Harmony {
    pub chords: Vec<ChordItem>,
    /// `human`, `imported` or `generated`.
    pub origin: String,
    /// What produced the chords: `manifest`, `pop909`, `analysis`.
    pub tool: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChordItem {
    pub tick: u64,
    pub end_tick: u64,
    pub seconds: f64,
    pub end_seconds: f64,
    /// Harte label of the sounding chord; `None` is "no chord".
    pub harte: Option<String>,
    /// `F♯7/A♯`; empty for no chord.
    pub name: String,
    /// `3⁷/♯5`; empty for no chord.
    pub degree: String,
}

/// Chords on the source tick grid, before transposition.
struct Source {
    segments: Vec<(u64, u64, Option<Chord>)>,
    origin: String,
    tool: String,
    /// Read from the untransposed song: shift by the practice transposition when shown.
    follows_transpose: bool,
}

fn manifest_chords(music: &Path, end: u64) -> Option<Source> {
    let found = manifest_store::locate(music).ok().flatten()?;
    let performance = manifest_store::performance_of(&found, music).unwrap_or_else(|| found.manifest.default.performance.clone());
    let layer = found.manifest.layer_for("chords", &performance)?;
    let items = layer.body.get("items")?.as_array()?;
    let mut starts: Vec<(u64, Option<Chord>)> = items
        .iter()
        .filter_map(|item| {
            let tick = item.get("tick")?.as_u64()?;
            let chord = Chord::parse(item.get("chord")?.as_str()?).ok()?;
            Some((tick, chord))
        })
        .collect();
    starts.sort_by_key(|(tick, _)| *tick);
    let segments = starts
        .iter()
        .enumerate()
        .map(|(i, &(tick, chord))| (tick, starts.get(i + 1).map_or(end, |next| next.0), chord))
        .collect();
    let origin = layer.provenance.as_ref().map(|p| format!("{:?}", p.origin).to_lowercase()).unwrap_or_else(|| "human".into());
    Some(Source { segments, origin, tool: "manifest".into(), follows_transpose: true })
}

/// POP909 writes `start end label` in MIDI seconds beside each song.
fn pop909_chords(file: &MidiFile, music: &Path) -> Option<Source> {
    let text = std::fs::read_to_string(music.parent()?.join("chord_midi.txt")).ok()?;
    let tempo = &file.tempo_track;
    let tick = |seconds: f64| tempo.seconds_to_pulses(seconds).round().max(0.) as u64;
    let segments: Vec<_> = text
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let start = parts.next()?.trim().parse::<f64>().ok()?;
            let end = parts.next()?.trim().parse::<f64>().ok()?;
            let chord = Chord::parse(parts.next()?).ok()?;
            Some((tick(start), tick(end), chord))
        })
        .collect();
    (!segments.is_empty()).then(|| Source { segments, origin: "imported".into(), tool: "pop909".into(), follows_transpose: true })
}

fn analysed_chords(file: &MidiFile) -> Source {
    let notes = panthesia_analysis::notes(&file.source);
    let keys = panthesia_analysis::keys(&notes, &file.musical_time);
    let segments = panthesia_analysis::chords(&notes, &file.musical_time, &keys).into_iter().map(|s| (s.tick, s.end, s.chord)).collect();
    Source { segments, origin: "generated".into(), tool: "analysis".into(), follows_transpose: false }
}

fn shifted(chord: Chord, semitones: i16) -> Chord {
    let shift = |pc: u8| ((i16::from(pc) + semitones).rem_euclid(12)) as u8;
    Chord { root: shift(chord.root), quality: chord.quality, bass: chord.bass.map(shift) }
}

impl Player {
    /// The chord layer for `currentSong`, cached per song, variant and score revision.
    pub(crate) fn harmony(&mut self) -> Option<Harmony> {
        let file = self.file.as_ref()?;
        let variant = self.variant();
        let identity = format!("{}:{:?}:{}", file.content_id, variant, self.score_revision);
        if let Some((key, value)) = &self.harmony_cache {
            if *key == identity {
                return Some(value.clone());
            }
        }
        let original = self.source_file.as_ref().unwrap_or(file);
        let end = original.source.last_tick.max(original.musical_time.measures.last().map_or(0, |m| m.end_tick));
        let music = original.source_path.clone();
        let source = music
            .as_deref()
            .and_then(|path| manifest_chords(path, end).or_else(|| pop909_chords(original, path)))
            .unwrap_or_else(|| analysed_chords(file));
        let transpose = if source.follows_transpose { i16::from(variant.transpose) } else { 0 };
        let keys: Vec<(u64, Key)> = self
            .variant_document()
            .get("keyChanges")
            .and_then(Value::as_array)
            .map(|changes| {
                changes
                    .iter()
                    .filter_map(|c| Some((c.get("tick")?.as_u64()?, Key { tonic: c.get("tonic")?.as_u64()? as u8, minor: c.get("minor")?.as_bool()? })))
                    .collect()
            })
            .unwrap_or_default();
        let key_at = |tick: u64| keys.iter().take_while(|(at, _)| *at <= tick).last().or(keys.first()).map(|(_, key)| *key);
        let seconds = |tick: u64| file.tempo_track.pulses_to_duration(tick).as_secs_f64();
        let chords = source
            .segments
            .iter()
            .filter(|(tick, end, _)| end > tick)
            .map(|&(tick, end_tick, chord)| {
                let chord = chord.map(|c| shifted(c, transpose));
                let key = key_at(tick);
                ChordItem {
                    tick,
                    end_tick,
                    seconds: seconds(tick),
                    end_seconds: seconds(end_tick),
                    harte: chord.map(Chord::harte),
                    name: chord.map(|c| c.name(key)).unwrap_or_default(),
                    degree: chord.zip(key).map(|(c, k)| c.degree(k)).unwrap_or_default(),
                }
            })
            .collect();
        let harmony = Harmony { chords, origin: source.origin, tool: source.tool };
        self.harmony_cache = Some((identity, harmony.clone()));
        Some(harmony)
    }
}
