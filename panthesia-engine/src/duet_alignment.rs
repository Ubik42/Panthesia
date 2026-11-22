//! Verified generator provenance takes priority over temporal similarity.
use panthesia_music::MidiFile;
use panthesia_notation::{musicxml::{Score, ScoreEvent}, score_alignment::{self, AlignedNote, MidiNoteId, ScoreMidiAlignment}, score_playback::{self, PlaybackLimits}};
use quick_xml::{Reader, events::Event};
use std::collections::{HashMap, HashSet};

struct Link {
    renderer_id: String,
    content: String,
    track: usize,
    index: usize,
    pitch: u8,
    start: u128,
    end: u128,
}
fn link(value: &str) -> Option<Link> {
    let fields: Vec<_> = value.split('-').collect();
    if fields.len() != 9 || fields[0] != "panthesia1" || fields[1].len() != 64 {
        return None;
    }
    Some(Link {
        renderer_id: value.into(),
        content: fields[1].into(),
        track: fields[2].parse().ok()?,
        index: fields[3].parse().ok()?,
        pitch: fields[4].parse().ok()?,
        start: fields[5].parse().ok()?,
        end: fields[6].parse().ok()?,
    })
}
pub(crate) struct SourceAlignment {
    pub alignment: ScoreMidiAlignment,
    pub render_ids: HashMap<String, panthesia_notation::musicxml::ScoreEventId>,
}
pub(crate) fn align(
    bytes: &[u8],
    score: &Score,
    file: &MidiFile,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Option<SourceAlignment>, String> {
    let xml = panthesia_notation::musicxml::musicxml_source(bytes).map_err(|e| e.to_string())?;
    let mut reader = Reader::from_reader(xml.as_slice());
    let mut sources = Vec::new();
    loop {
        check()?;
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Start(start) | Event::Empty(start) if start.name().as_ref() == b"note" => {
                let mut source = None;
                for attribute in start.attributes() {
                    let attribute = attribute.map_err(|e| e.to_string())?;
                    if attribute.key.as_ref() == b"id" {
                        source = link(&String::from_utf8_lossy(attribute.value.as_ref()));
                    }
                }
                sources.push(source);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !sources.iter().any(Option::is_some) {
        return Ok(None);
    }
    let notes: Vec<_> = score
        .parts
        .iter()
        .flat_map(|part| {
            part.measures.iter().flat_map(|measure| {
                measure.events.iter().filter_map(|event| match event {
                    ScoreEvent::Note(note) => Some(note),
                    _ => None,
                })
            })
        })
        .collect();
    if notes.len() != sources.len() {
        return Ok(None);
    }
    let midi: HashMap<_, _> = file
        .tracks
        .iter()
        .flat_map(|track| {
            track.notes.iter().enumerate().map(move |(index, note)| {
                (
                    (track.track_id, note.source_index),
                    (
                        MidiNoteId {
                            track_id: track.track_id,
                            note_index: index,
                        },
                        note,
                    ),
                )
            })
        })
        .collect();
    let mut identities = HashMap::new();
    let mut render_ids = HashMap::new();
    for (note, source) in notes.iter().zip(&sources) {
        check()?;
        if note.pitch.is_none() {
            continue;
        }
        let Some(source) = source else {
            return Ok(None);
        };
        let Some((id, performed)) = midi.get(&(source.track, source.index)) else {
            return Ok(None);
        };
        let pitch = note.pitch.as_ref().unwrap();
        let natural = match pitch.step {
            panthesia_notation::musicxml::Step::C => 0,
            panthesia_notation::musicxml::Step::D => 2,
            panthesia_notation::musicxml::Step::E => 4,
            panthesia_notation::musicxml::Step::F => 5,
            panthesia_notation::musicxml::Step::G => 7,
            panthesia_notation::musicxml::Step::A => 9,
            panthesia_notation::musicxml::Step::B => 11,
        };
        let written = (i16::from(pitch.octave) + 1) * 12 + natural + i16::from(pitch.alter);
        if source.content != file.content_id
            || source.pitch != performed.note
            || written != i16::from(source.pitch)
            || source.start.abs_diff(performed.start.as_micros()) > 1000
            || source.end.abs_diff(performed.end.as_micros()) > 1000
        {
            return Ok(None);
        }
        identities.insert(note.id.clone(), *id);
        if render_ids
            .insert(source.renderer_id.clone(), note.id.clone())
            .is_some()
        {
            return Ok(None);
        }
    }
    let mut result = ScoreMidiAlignment::default();
    let by_id: HashMap<_, _> = midi.values().map(|(id, note)| (*id, *note)).collect();
    let mut matched = HashSet::new();
    for part in &score.parts {
        check()?;
        let plan = score_playback::build_playback_plan(part, PlaybackLimits::default());
        if !plan.complete {
            return Ok(None);
        }
        let projected = score_alignment::project_performed_part_timeline_checked(
            part,
            &plan,
            &file.tempo_track,
            check,
        )?;
        if !projected.unprojected.is_empty() {
            return Ok(None);
        }
        for event in projected.events {
            if let Some(id) = identities.get(&event.id.source_id) {
                let performed = by_id[id];
                let delta = |a: u128, b: u128| {
                    (a.min(i64::MAX as u128) as i64).saturating_sub(b.min(i64::MAX as u128) as i64)
                };
                // Tied pieces can share one input note; only the first carries fingering.
                let principal = matched.insert(*id);
                result.matches.push(AlignedNote {
                    score_id: event.id,
                    strike_ordinal: 0,
                    principal,
                    midi_id: *id,
                    onset_delta_micros: delta(
                        performed.start.as_micros(),
                        event.timestamp.as_micros(),
                    ),
                    duration_delta_micros: delta(
                        performed.duration.as_micros(),
                        event.duration.unwrap_or_default().as_micros(),
                    ),
                    confidence_percent: 100,
                    exact_score_projection: event.exact_to_midi_pulse,
                });
            }
        }
    }
    for (id, note) in midi.values() {
        if note.channel != 9 && !matched.contains(id) {
            result.unmatched_midi.push(*id);
        }
    }
    result.coverage_percent = if matched.is_empty() {
        0
    } else {
        (matched.len() * 100 / (matched.len() + result.unmatched_midi.len())) as u8
    };
    result.mean_confidence_percent = if matched.is_empty() { 0 } else { 100 };
    Ok(Some(SourceAlignment {
        alignment: result,
        render_ids,
    }))
}

#[cfg(test)]
mod tests {
    #[test]
    fn source_identity_selects_the_repeated_note_instead_of_the_nearest_time() {
        let mut file = panthesia_music::MidiFile::from_path_bytes(
            std::path::Path::new("source.mid"),
            include_bytes!("../assets/five-finger.mid"),
        )
        .unwrap();
        let track = file.tracks.iter().find(|t| !t.notes.is_empty()).unwrap();
        let index = track.notes.len() - 1;
        let note = &track.notes[index];
        assert_eq!(note.note, 60);
        let xml = format!(
            r#"<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note id="panthesia1-{}-{}-{}-60-{}-{}-8-1"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>"#,
            file.content_id,
            track.track_id,
            note.source_index,
            note.start.as_micros(),
            note.end.as_micros()
        );
        let score = panthesia_notation::musicxml::import_musicxml_document(xml.as_bytes()).unwrap();
        let mapped = super::align(xml.as_bytes(), &score, &file, &|| Ok(()))
            .unwrap()
            .unwrap();
        assert_eq!(mapped.alignment.matches.len(), 1);
        assert_eq!(mapped.alignment.matches[0].midi_id.note_index, index);
        assert!(mapped.alignment.matches[0].onset_delta_micros > 1_000_000);
        let renderer_id = mapped.render_ids.keys().next().unwrap().clone();
        let asset = crate::notation::ScoreAsset::new(
            xml.as_bytes().to_vec(),
            "identity.musicxml".into(),
            &file,
        )
        .unwrap();
        let rendered = asset
            .map_notes(
                &file,
                &[],
                vec![crate::notation::RenderNote {
                    renderer_id,
                    page_index: 0,
                    onset_millis: 0.,
                    pitch: 60,
                    duration_millis: 1000.,
                }],
            )
            .unwrap();
        assert!(rendered.following);
        assert_eq!(rendered.mapping[0].index, index);
        assert!(rendered.mapping[0].start > 4.);
        file.content_id = "different-performance".into();
        assert!(
            super::align(xml.as_bytes(), &score, &file, &|| Ok(()))
                .unwrap()
                .is_none()
        );
    }
}
