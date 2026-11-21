//! Authored score windows follow the complete performed route and native alignment.
use crate::notation::{MappingResult, MappingRow, RenderNote, ScoreAsset};
use panthesia_core::{
    musicxml::{Score, ScoreEvent, ScoreEventId, ScoreTime},
    practice_engraving::MeasureRange,
    score_alignment::{MidiNoteId, ScoreMidiAlignment},
    score_playback::{self, PlaybackLimits},
    source_score_window::{SourceDocument, Window},
};
use std::collections::{HashMap, HashSet};

struct Link {
    pitch: u8,
    finger: Option<String>,
    matches: Vec<(MidiNoteId, bool)>,
}
struct Visit {
    measure: usize,
    ordinal: u32,
    pass: u16,
    start: ScoreTime,
    end: ScoreTime,
    start_beat: f64,
    end_beat: f64,
    partial_start: bool,
    partial_end: bool,
}
pub(crate) struct SourceView {
    document: SourceDocument,
    links: HashMap<ScoreEventId, Link>,
    visits: Vec<Visit>,
    complete: bool,
    numbers: Vec<String>,
    key_changes: Vec<(ScoreTime, i8, bool)>,
    keys_trusted: bool,
}
fn pitch(p: &panthesia_core::musicxml::Pitch) -> Option<u8> {
    use panthesia_core::musicxml::Step::*;
    let value = (i16::from(p.octave) + 1) * 12
        + match p.step {
            C => 0,
            D => 2,
            E => 4,
            F => 5,
            G => 7,
            A => 9,
            B => 11,
        }
        + i16::from(p.alter);
    u8::try_from(value).ok().filter(|p| *p <= 127)
}
fn seconds(file: &panthesia_music::MidiFile, time: ScoreTime) -> f64 {
    let tick = (time.numerator.max(0) as u128 * u128::from(file.musical_time.ppq)
        / u128::from(time.denominator))
    .min(u128::from(u64::MAX)) as u64;
    file.tempo_track.pulses_to_duration(tick).as_secs_f64()
}
impl SourceView {
    pub(crate) fn new(
        bytes: &[u8],
        score: &Score,
        alignment: &ScoreMidiAlignment,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        let document = SourceDocument::new(bytes, check)?;
        let mut all = HashSet::new();
        let mut links = HashMap::new();
        for note in score
            .parts
            .iter()
            .flat_map(|p| &p.measures)
            .flat_map(|m| &m.events)
            .filter_map(|e| {
                if let ScoreEvent::Note(n) = e {
                    Some(n)
                } else {
                    None
                }
            })
        {
            if !all.insert(note.id.clone()) {
                return Err("原谱包含重复的声部/音符身份".into());
            }
            if let Some(pitch) = note.pitch.as_ref().and_then(pitch) {
                links.insert(
                    note.id.clone(),
                    Link {
                        pitch,
                        finger: note.fingering.clone(),
                        matches: vec![],
                    },
                );
            }
        }
        if document.render_ids.values().any(|id| !all.contains(id))
            || document.render_ids.len() != all.len()
        {
            return Err("原谱书面索引与音乐内容不同，请检查谱面结构".into());
        }
        for matched in &alignment.matches {
            check()?;
            if matched.confidence_percent >= 85 {
                if let Some(link) = links.get_mut(&matched.score_id.source_id) {
                    link.matches.push((matched.midi_id, matched.principal));
                }
            }
        }
        let part = score
            .parts
            .iter()
            .enumerate()
            .max_by_key(|(i, p)| (p.measures.len(), usize::MAX - i))
            .map(|(_, p)| p)
            .ok_or("原谱缺少声部")?;
        let plan = score_playback::build_playback_plan(part, PlaybackLimits::default());
        let key_changes = score_playback::performed_key_signatures(part, &plan, check)?;
        let keys_trusted = plan.complete
            && alignment.navigation_complete
            && panthesia_core::score_alignment::summarize_alignment(alignment).readiness
                == panthesia_core::score_alignment::AlignmentReadiness::Ready;
        let mut beat_type = 4f64;
        let mut beats = vec![];
        for m in &part.measures {
            for a in &m.attributes {
                if let Some(time) = &a.time_signature {
                    if let Ok(b) = time.beat_type.parse::<f64>() {
                        beat_type = b;
                    }
                }
            }
            beats.push(beat_type);
        }
        let visits = plan
            .visits
            .iter()
            .map(|v| {
                let m = &part.measures[v.source_measure_ordinal as usize];
                let beat = |t: ScoreTime| {
                    t.numerator as f64 / f64::from(t.denominator)
                        * beats[v.source_measure_ordinal as usize]
                        / 4.
                        + 1.
                };
                Visit {
                    measure: v.source_measure_ordinal as usize,
                    ordinal: v.occurrence_ordinal,
                    pass: v.repeat_pass,
                    start: v.performed_start,
                    end: v.performed_end(),
                    start_beat: beat(v.source_start),
                    end_beat: beat(v.source_end),
                    partial_start: v.source_start > ScoreTime::default(),
                    partial_end: v.source_end < m.duration,
                }
            })
            .collect();
        Ok(Self {
            document,
            key_changes,
            keys_trusted,
            links,
            visits,
            complete: plan.complete && alignment.navigation_complete,
            numbers: part
                .measures
                .iter()
                .enumerate()
                .map(|(i, m)| {
                    if m.number.is_empty() {
                        (i + 1).to_string()
                    } else {
                        m.number.clone()
                    }
                })
                .collect(),
        })
    }
    pub(crate) fn key_signatures(
        &self,
        file: &panthesia_music::MidiFile,
    ) -> Vec<panthesia_music::key_signature::KeySignatureEvent> {
        if !self.keys_trusted {
            return vec![];
        }
        self.key_changes
            .iter()
            .map(
                |(at, fifths, minor)| panthesia_music::key_signature::KeySignatureEvent {
                    tick: (at.numerator.max(0) as u128 * u128::from(file.musical_time.ppq)
                        / u128::from(at.denominator)) as u64,
                    fifths: *fifths,
                    minor: *minor,
                },
            )
            .collect()
    }
    pub(crate) fn prepared(
        &self,
        range: MeasureRange,
        transpose: i8,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Window, String> {
        let mut window = self.document.window(range, check)?;
        if transpose != 0 {
            window.bytes = panthesia_core::practice_score::transpose(&window.bytes, transpose)?;
        }
        check()?;
        Ok(window)
    }
    fn range(
        &self,
        file: &panthesia_music::MidiFile,
        first: Option<usize>,
        position: Option<f64>,
    ) -> Result<MeasureRange, String> {
        let measure = if let Some(first) = first {
            if first >= self.document.total() {
                return Err("原谱小节范围已改变".into());
            }
            first
        } else {
            let position = position.filter(|p| p.is_finite() && *p >= 0.).unwrap_or(0.);
            let i = self
                .visits
                .partition_point(|v| seconds(file, v.start) <= position)
                .saturating_sub(1);
            self.visits.get(i).map_or(0, |v| v.measure)
        };
        Ok(self.document.range_at(measure))
    }
    pub(crate) fn payload(
        &self,
        asset: &ScoreAsset,
        file: &panthesia_music::MidiFile,
        revision: u64,
        transpose: i8,
        first: Option<usize>,
        position: Option<f64>,
    ) -> Result<serde_json::Value, String> {
        let range = self.range(file, first, position)?;
        let window = self.prepared(range, transpose, &|| Ok(()))?;
        let end = range.first + range.count;
        let visits:Vec<_>=self.visits.iter().filter(|v|v.measure>=range.first&&v.measure<end).map(|v|serde_json::json!({"ordinal":v.ordinal,"measure":v.measure,"number":self.numbers[v.measure],"pass":v.pass,"start":seconds(file,v.start),"end":seconds(file,v.end),"startBeat":v.start_beat,"endBeat":v.end_beat,"partialStart":v.partial_start,"partialEnd":v.partial_end})).collect();
        let intervals: Vec<_> = visits
            .iter()
            .map(|v| serde_json::json!({"start":v["start"],"end":v["end"]}))
            .collect();
        let start = visits
            .first()
            .and_then(|v| v["start"].as_f64())
            .unwrap_or(0.);
        let finish = visits
            .last()
            .and_then(|v| v["end"].as_f64())
            .unwrap_or(start);
        let mut result = asset.route_payload(None);
        result["contentId"] = serde_json::json!(file.content_id);
        result["scoreRevision"] = serde_json::json!(revision);
        result["displayFingerprint"] =
            serde_json::json!(blake3::hash(&window.bytes).to_hex().to_string());
        result["bytes"] = serde_json::json!(window.bytes);
        result["compressed"] = serde_json::json!(false);
        result["window"] = serde_json::json!({"first":range.first,"count":range.count,"total":self.document.total(),"previous":self.document.previous(range.first),"firstNumber":self.numbers[range.first],"lastNumber":self.numbers[end-1],"start":start,"end":finish,"intervals":intervals});
        result["route"] = serde_json::json!({"complete":self.complete,"visits":visits});
        Ok(result)
    }
    pub(crate) fn map(
        &self,
        file: &panthesia_music::MidiFile,
        window: &Window,
        notes: Vec<RenderNote>,
        page_count: usize,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<MappingResult, String> {
        let expected = window
            .render_ids
            .values()
            .filter(|id| self.links.contains_key(*id))
            .count();
        let mut seen = HashSet::new();
        let mut ambiguities = 0;
        let mut mapping = vec![];
        let tracks: HashMap<_, _> = file.tracks.iter().map(|t| (t.track_id, t)).collect();
        for rendered in notes {
            check()?;
            let Some(id) = window.render_ids.get(&rendered.renderer_id) else {
                continue;
            };
            let Some(link) = self.links.get(id) else {
                continue;
            };
            if rendered.pitch != link.pitch || rendered.page_index >= page_count {
                continue;
            }
            if !seen.insert(rendered.renderer_id.clone()) {
                ambiguities += 1;
                continue;
            }
            for (midi, principal) in &link.matches {
                if let Some(note) = tracks
                    .get(&midi.track_id)
                    .and_then(|t| t.notes.get(midi.note_index))
                {
                    mapping.push(MappingRow {
                        id: rendered.renderer_id.clone(),
                        page: rendered.page_index,
                        start: note.start.as_secs_f64(),
                        end: note.end.as_secs_f64(),
                        pitch: note.note,
                        track: midi.track_id,
                        index: midi.note_index,
                        score_finger: principal.then(|| link.finger.clone()).flatten(),
                    });
                }
            }
        }
        Ok(MappingResult {
            following: self.complete && ambiguities == 0 && (!mapping.is_empty() || expected == 0),
            mapping,
            ambiguities,
            unmapped: expected.saturating_sub(seen.len()),
            mapping_token: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_and_da_capo_windows_follow_global_occurrences_not_local_renderer_time() {
        for jump in [false, true] {
            let mut xml = String::from(
                "<score-partwise><part-list><score-part id=\"P\"><part-name>Piano</part-name></score-part></part-list><part id=\"P\">",
            );
            for i in 0..72 {
                xml.push_str(&format!("<measure number=\"{}\">", i + 1));
                if i == 0 {
                    xml.push_str("<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>");
                    if !jump {
                        xml.push_str(
                            "<barline location=\"left\"><repeat direction=\"forward\"/></barline>",
                        );
                    }
                }
                if jump && i == 15 {
                    xml.push_str("<direction><direction-type><words>Fine</words></direction-type><sound fine=\"yes\"/></direction>");
                }
                xml.push_str(&format!("<note id=\"n{i}\"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>"));
                if i == 63 {
                    if jump {
                        xml.push_str("<direction><direction-type><words>D.C. al Fine</words></direction-type><sound dacapo=\"yes\"/></direction>");
                    } else {
                        xml.push_str("<barline location=\"right\"><repeat direction=\"backward\" times=\"2\"/></barline>");
                    }
                }
                xml.push_str("</measure>");
            }
            xml.push_str("</part></score-partwise>");
            let score = panthesia_core::musicxml::import_musicxml_document(xml.as_bytes()).unwrap();
            let generated = panthesia_core::score_performance::generate(&score, 120).unwrap();
            let file = panthesia_music::MidiFile::from_smf("owned-route", &generated.smf).unwrap();
            let asset = ScoreAsset::new(xml.into_bytes(), "Owned route".into(), &file).unwrap();
            let view = &asset.source_view;
            let back = view.payload(&asset, &file, 1, 0, None, Some(130.)).unwrap();
            assert_eq!(back["window"]["first"], 0);
            assert!(back["window"]["intervals"].as_array().unwrap().len() > 32);
            let range = MeasureRange {
                first: 0,
                count: 32,
            };
            let window = view.prepared(range, 0, &|| Ok(())).unwrap();
            let notes = (0..32)
                .map(|i| RenderNote {
                    renderer_id: format!("n{i}"),
                    page_index: 0,
                    onset_millis: 0.,
                    duration_millis: 1.,
                    pitch: 60,
                })
                .collect();
            let result = view.map(&file, &window, notes, 1, &|| Ok(())).unwrap();
            assert!(result.following);
            assert_eq!(result.unmapped, 0);
            let repeated: Vec<_> = result.mapping.iter().filter(|m| m.id == "n0").collect();
            assert_eq!(repeated.len(), 2);
            assert_eq!((repeated[0].index, repeated[1].index), (0, 64));
            assert_eq!((repeated[0].start, repeated[1].start), (0., 128.));
            let outside = view
                .map(
                    &file,
                    &window,
                    vec![RenderNote {
                        renderer_id: "n64".into(),
                        page_index: 0,
                        onset_millis: 0.,
                        duration_millis: 1.,
                        pitch: 60,
                    }],
                    1,
                    &|| Ok(()),
                )
                .unwrap();
            assert!(outside.mapping.is_empty());
        }
    }
}
