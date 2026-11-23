//! The chord layer of the current song and its display. Sources in order: the manifest's
//! `chords` layer (any origin), a POP909 `chord_midi.txt` beside the file (imported), the
//! analysis of the played notes (generated). Names and degrees are spelled against the same
//! effective key timeline as the note labels, so a chord's degree matches its notes'.
use crate::player::Player;
use panthesia_analysis::harte::{Chord, Key};
use panthesia_core::manifest_store;
use panthesia_music::MidiFile;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Harmony {
    pub chords: Vec<ChordItem>,
    /// `human`, `imported` or `generated`.
    pub origin: String,
    /// What produced the chords: `score`, `pop909`, `analysis`, or the tool a manifest names.
    pub tool: String,
    /// Saved in the song's manifest (edited, imported or adopted), so analysis no longer moves it.
    pub saved: bool,
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

/// One chord as the user wrote it, at a tick of the shown (possibly transposed) song: a Harte
/// label (`F#:min7/b3`) or a chord name (`F#m7/A`); `N` for no chord.
#[derive(Clone, Deserialize)]
pub struct ChordEdit {
    pub tick: u64,
    pub label: String,
}

/// Chords on the source tick grid, before transposition.
struct Source {
    segments: Vec<(u64, u64, Option<Chord>)>,
    origin: String,
    tool: String,
    saved: bool,
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
    let tool = layer.provenance.as_ref().and_then(|p| p.tool.clone()).unwrap_or_else(|| "manifest".into());
    Some(Source { segments, origin, tool, saved: true, follows_transpose: true })
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
    (!segments.is_empty()).then(|| Source { segments, origin: "imported".into(), tool: "pop909".into(), saved: false, follows_transpose: true })
}

/// No chords for a single melodic line: there is no harmony to recognise.
fn analysed_chords(file: &MidiFile) -> Source {
    let notes = panthesia_analysis::notes(&file.source);
    if panthesia_analysis::polyphony(&notes) < 1.3 {
        return Source { segments: vec![], origin: "generated".into(), tool: "analysis".into(), saved: false, follows_transpose: false };
    }
    let keys = panthesia_analysis::keys(&notes, &file.musical_time);
    let segments = panthesia_analysis::chords(&notes, &file.musical_time, &keys).into_iter().map(|s| (s.tick, s.end, s.chord)).collect();
    Source { segments, origin: "generated".into(), tool: "analysis".into(), saved: false, follows_transpose: false }
}

/// The analysis of `file` as manifest `chords` rows; repeated chords merge into one.
pub(crate) fn analysed_rows(file: &MidiFile) -> Vec<Value> {
    let mut rows = Vec::new();
    let mut previous = None;
    for (tick, _, chord) in analysed_chords(file).segments {
        if previous == Some(chord) {
            continue;
        }
        previous = Some(chord);
        rows.push(serde_json::json!({ "tick": tick, "chord": chord.map_or_else(|| "N".to_string(), Chord::harte) }));
    }
    rows
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
        let harmony = Harmony { chords, origin: source.origin, tool: source.tool, saved: source.saved };
        self.harmony_cache = Some((identity, harmony.clone()));
        Some(harmony)
    }
}

impl Player {
    /// The file whose manifest holds the chords, and the shown transposition.
    fn chord_target(&self, content_id: &str) -> Result<(std::path::PathBuf, i16), String> {
        let file = self.file.as_ref().filter(|f| f.content_id == content_id).ok_or("曲目已切换，请重新打开和弦编辑")?;
        let original = self.source_file.as_ref().unwrap_or(file);
        let music = original.source_path.clone().filter(|_| self.exercise.is_none()).ok_or("这首曲目不能保存和弦")?;
        Ok((music, i16::from(self.variant().transpose)))
    }

    fn write_chords(&mut self, music: &Path, items: Vec<(u64, Option<Chord>)>, provenance: panthesia_core::manifest::Provenance, status: Option<&str>) -> Result<Value, String> {
        let mut rows: Vec<Value> = Vec::new();
        let mut previous: Option<Option<Chord>> = None;
        for (tick, chord) in items {
            if previous == Some(chord) {
                continue;
            }
            previous = Some(chord);
            rows.push(serde_json::json!({ "tick": tick, "chord": chord.map_or_else(|| "N".to_string(), Chord::harte) }));
        }
        manifest_store::edit(music, true, |manifest, performance, _| {
            let key = manifest.layer_key("chords", performance);
            let mut body = serde_json::Map::new();
            body.insert("items".into(), Value::Array(rows));
            manifest.layers.insert(
                key,
                panthesia_core::manifest::Layer { provenance: Some(provenance), status: status.map(str::to_string), body, ..Default::default() },
            );
            Ok(((), true))
        })?;
        self.harmony_cache = None;
        self.command(crate::Command::CurrentSong)
    }

    /// Store edited chords as the song's own (`human`); they are never replaced by analysis.
    pub(crate) fn save_chords(&mut self, content_id: &str, edits: Vec<ChordEdit>) -> Result<Value, String> {
        let (music, transpose) = self.chord_target(content_id)?;
        if edits.len() > 20_000 {
            return Err("和弦过多，最多 20000 个".into());
        }
        let mut items = edits
            .iter()
            .map(|edit| {
                let chord = Chord::parse(&edit.label).or_else(|_| Chord::parse_name(&edit.label))?;
                Ok((edit.tick, chord.map(|c| shifted(c, -transpose))))
            })
            .collect::<Result<Vec<_>, String>>()?;
        items.sort_by_key(|(tick, _)| *tick);
        self.write_chords(&music, items, panthesia_core::manifest::Provenance::new(panthesia_core::manifest::Origin::Human, None), None)
    }

    /// Keep the analysis result as the song's chords, so later analysis changes do not move it.
    pub(crate) fn adopt_chords(&mut self, content_id: &str) -> Result<Value, String> {
        let (music, transpose) = self.chord_target(content_id)?;
        let harmony = self.harmony().ok_or("请先打开曲目")?;
        if harmony.origin != "generated" || harmony.saved {
            return Err("当前和弦不是自动分析结果".into());
        }
        let items = harmony
            .chords
            .iter()
            .map(|c| (c.tick, c.harte.as_deref().and_then(|label| Chord::parse(label).ok().flatten()).map(|c| shifted(c, -transpose))))
            .collect();
        self.write_chords(&music, items, panthesia_core::manifest::Provenance::new(panthesia_core::manifest::Origin::Generated, Some("analysis")), Some("accepted"))
    }
}
