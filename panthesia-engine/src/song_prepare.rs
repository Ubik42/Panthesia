//! First open of a MIDI song. A practice program plays the quantized version: a performed song
//! (notes off the grid, as recorded or transcribed) without a saved practice version gets a
//! 1/16 grid (1/32 where 1/16 fails); the original timing is the user's explicit choice. A
//! sequenced file already on the grid needs no quantized version. Hands, fingering, sections and chords the song lacks are generated
//! once and written to its manifest as drafts: origin `generated`, status `draft`, and
//! `review: "pending"` in the provenance, meaning no AI or person has checked them yet. A later
//! review (AI naming the sections, fixing doubtful fingers) sets `review` to who checked them.
//! Layers that already exist are never touched; songs from a score keep their own timing.
use crate::player::Player;
use panthesia_core::library::{FingerHint, NoteHandHint};
use panthesia_core::manifest::{Layer, Manifest, Origin, Provenance};
use panthesia_core::manifest_store;
use panthesia_core::practice::PracticePart;
use panthesia_core::practice_transform::Variant;
use serde_json::{Map, Value, json};
use std::path::Path;

pub(crate) const TOOL: &str = "panthesia-analysis";

fn draft() -> Provenance {
    let mut p = Provenance::new(Origin::Generated, Some(TOOL));
    p.rest.insert("review".into(), json!("pending"));
    p
}

/// Whether the song's layer `name` is a generated draft no one has checked yet.
pub(crate) fn pending_review(music: &Path, name: &str) -> bool {
    let Ok(Some(found)) = manifest_store::locate(music) else { return false };
    let performance = manifest_store::performance_of(&found, music).unwrap_or_else(|| found.manifest.default.performance.clone());
    found
        .manifest
        .layer_for(name, &performance)
        .and_then(|l| l.provenance.as_ref())
        .and_then(|p| p.rest.get("review"))
        .is_some_and(|r| r == "pending")
}

/// Whether the notes already start on a 1/16 grid (a sequenced file): it needs no quantized
/// version. Performances (recorded or transcribed) do not.
fn on_grid(file: &panthesia_music::MidiFile) -> bool {
    let tempo = &file.tempo_track;
    let step = f64::from(tempo.ppq()) / 4.;
    let tolerance = (f64::from(tempo.ppq()) / 48.).max(1.);
    let (mut on, mut all) = (0usize, 0usize);
    for note in file.tracks.iter().flat_map(|t| t.notes.iter()).filter(|n| n.channel != 9) {
        let tick = tempo.seconds_to_pulses(note.start.as_secs_f64());
        let base = file.musical_time.measure_at(tick).map_or(0., |m| m.start_tick as f64);
        let off = (tick - base).rem_euclid(step);
        all += 1;
        if off.min(step - off) <= tolerance {
            on += 1;
        }
    }
    all == 0 || on * 100 >= all * 95
}

fn is_midi(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| ["mid", "midi", "kar"].contains(&e.to_ascii_lowercase().as_str()))
}

fn mark_draft(manifest: &mut Manifest, name: &str, performance: &str) {
    let key = manifest.layer_key(name, performance);
    if let Some(layer) = manifest.layers.get_mut(&key) {
        layer.provenance = Some(draft());
        layer.status = Some("draft".into());
    }
}

fn put_draft(manifest: &mut Manifest, name: &str, performance: &str, items: Vec<Value>) {
    let key = manifest.layer_key(name, performance);
    let mut body = Map::new();
    body.insert("items".into(), Value::Array(items));
    manifest.layers.insert(key, Layer { provenance: Some(draft()), status: Some("draft".into()), body, ..Default::default() });
}

impl Player {
    /// Called by `load` on the source performance, before the practice version is applied.
    pub(crate) fn prepare_song(&mut self) {
        if let Err(error) = self.try_prepare_song() {
            self.state.error.get_or_insert(format!("自动分析未完成：{error}"));
        }
    }

    fn try_prepare_song(&mut self) -> Result<(), String> {
        if self.exercise.is_some() {
            return Ok(());
        }
        let Some(file) = self.file.clone() else { return Ok(()) };
        let Some(music) = file.source_path.clone().filter(|p| is_midi(p)) else { return Ok(()) };
        if panthesia_core::song_annotations::document_path(&music).is_some() {
            return Ok(());
        }
        let cid = file.content_id.clone();
        if !self.preferences.variants.contains_key(&cid) && !on_grid(&file) {
            for grid in [16, 32] {
                let variant = Variant { quantize: grid, ..Default::default() };
                if crate::practice_variant::transform(&file, &variant).is_ok() {
                    self.preferences.variants.insert(cid.clone(), variant);
                    break;
                }
            }
        }

        let located = manifest_store::locate(&music)?;
        let has = |name: &str| {
            located.as_ref().is_some_and(|found| {
                let performance = manifest_store::performance_of(found, &music).unwrap_or_else(|| found.manifest.default.performance.clone());
                found.manifest.layer_for(name, &performance).is_some()
            })
        };
        let mut drafted: Vec<&str> = Vec::new();
        if self.fingers.is_empty() && !has("fingering") {
            let planned = self.planned_fingers(&cid)?;
            let part = |label: &str| if label == "left" { PracticePart::LeftHand } else { PracticePart::RightHand };
            if self.note_hands.is_empty() && !has("hands") {
                let hands: Vec<NoteHandHint> = planned
                    .iter()
                    .filter(|p| !matches!(crate::hands::part(&self.config, &self.note_hands, p.track, p.index), PracticePart::LeftHand | PracticePart::RightHand))
                    .map(|p| NoteHandHint { track_id: p.track, note_index: p.index, part: part(&p.part) })
                    .collect();
                if !hands.is_empty() {
                    self.write_hands(hands, false)?;
                    drafted.push("hands");
                }
            }
            let fingers: Vec<FingerHint> = planned.iter().map(|p| FingerHint { track_id: p.track, note_index: p.index, finger: p.finger }).collect();
            if !fingers.is_empty() {
                self.write_hints(fingers, false)?;
                drafted.push("fingering");
            }
        }

        let sections = (!has("sections") && file.markers.is_empty()).then(|| {
            let notes = panthesia_analysis::notes(&file.source);
            panthesia_analysis::sections(&notes, &file.musical_time)
                .into_iter()
                .map(|s| json!({"tick": s.tick, "label": s.label}))
                .collect::<Vec<_>>()
        });
        let chords = (!has("chords") && !music.parent().is_some_and(|d| d.join("chord_midi.txt").is_file())).then(|| crate::harmony::analysed_rows(&file));
        let sections = sections.filter(|s| !s.is_empty());
        let chords = chords.filter(|c| !c.is_empty());
        if drafted.is_empty() && sections.is_none() && chords.is_none() {
            return Ok(());
        }
        manifest_store::edit(&music, true, |manifest, performance, _| {
            for name in &drafted {
                mark_draft(manifest, name, performance);
            }
            if let Some(items) = sections {
                put_draft(manifest, "sections", performance, items);
            }
            if let Some(items) = chords {
                put_draft(manifest, "chords", performance, items);
            }
            Ok(((), true))
        })?;
        self.harmony_cache = None;
        Ok(())
    }
}
