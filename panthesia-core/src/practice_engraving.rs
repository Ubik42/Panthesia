//! Disposable practice notation from the effective performance, never a replacement source score.
use midi_file::MidiFile;
use std::{collections::HashMap, fmt::Write};

const DIVISIONS: u64 = 32;
pub const GENERATOR: &str = "panthesia-practice-engraving-v1";
pub struct Engraving {
    pub bytes: Vec<u8>,
    pub notes: HashMap<String, PracticeNote>,
}
pub struct PracticeNote {
    pub track: usize,
    pub index: usize,
    pub start_tick: u64,
    pub end_tick: u64,
}
#[derive(Clone)]
struct Note {
    track: usize,
    index: usize,
    pitch: u8,
    start: u64,
    end: u64,
}
struct Lane {
    staff: u8,
    notes: Vec<Note>,
    end: u64,
}
fn units(tick: f64, ppq: u16) -> u64 {
    (tick * DIVISIONS as f64 / f64::from(ppq)).round().max(0.) as u64
}
fn escape(value: &str) -> String {
    quick_xml::escape::escape(value).into_owned()
}
fn pitch(value: u8, flats: bool) -> String {
    let names = if flats {
        [
            ("C", 0),
            ("D", -1),
            ("D", 0),
            ("E", -1),
            ("E", 0),
            ("F", 0),
            ("G", -1),
            ("G", 0),
            ("A", -1),
            ("A", 0),
            ("B", -1),
            ("B", 0),
        ]
    } else {
        [
            ("C", 0),
            ("C", 1),
            ("D", 0),
            ("D", 1),
            ("E", 0),
            ("F", 0),
            ("F", 1),
            ("G", 0),
            ("G", 1),
            ("A", 0),
            ("A", 1),
            ("B", 0),
        ]
    };
    let (step, alter) = names[usize::from(value % 12)];
    format!(
        "<pitch><step>{step}</step><alter>{alter}</alter><octave>{}</octave></pitch>",
        i16::from(value) / 12 - 1
    )
}
// Split at beats and barlines. Each piece has an exact conventional note value.
fn pieces(
    mut start: u64,
    end: u64,
    measure: u64,
    beat: u64,
) -> Vec<(u64, u64, &'static str, bool)> {
    let mut result = Vec::new();
    while start < end {
        let boundary = if (start - measure) % beat == 0 {
            end
        } else {
            measure + ((start - measure) / beat + 1) * beat
        };
        let available = (end - start).min(boundary - start);
        let (length, kind, dot) = [
            (192, "whole", true),
            (128, "whole", false),
            (96, "half", true),
            (64, "half", false),
            (48, "quarter", true),
            (32, "quarter", false),
            (24, "eighth", true),
            (16, "eighth", false),
            (12, "16th", true),
            (8, "16th", false),
            (6, "32nd", true),
            (4, "32nd", false),
            (3, "64th", true),
            (2, "64th", false),
            (1, "128th", false),
        ]
        .into_iter()
        .find(|(length, _, dot)| {
            *length <= available
                && (start - measure) % if *dot { length * 2 / 3 } else { *length } == 0
        })
        .unwrap();
        result.push((start, length, kind, dot));
        start += length;
    }
    result
}
fn rests(xml: &mut String, start: u64, end: u64, measure: u64, beat: u64, voice: usize, staff: u8) {
    for (_, length, kind, dot) in pieces(start, end, measure, beat) {
        write!(xml,"<note><rest/><duration>{length}</duration><voice>{voice}</voice><type>{kind}</type>{}<staff>{staff}</staff></note>",if dot {"<dot/>"}else{""}).unwrap();
    }
}
/// All identities refer to the original track/note indices retained by practice transforms.
/// The check runs during preparation and rendering, outside the playback driver.
pub fn engrave(
    file: &MidiFile,
    title: &str,
    fifths: i8,
    minor: bool,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Engraving, String> {
    check()?;
    let ppq = file.tempo_track.ppq();
    if ppq == 0 {
        return Err("MIDI 缺少有效的拍位精度".into());
    }
    let mut notes = Vec::new();
    for track in file.tracks.iter() {
        check()?;
        for (index, note) in track
            .notes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.channel != 9)
        {
            let start = units(
                file.tempo_track.seconds_to_pulses(note.start.as_secs_f64()),
                ppq,
            );
            let end = units(
                file.tempo_track.seconds_to_pulses(note.end.as_secs_f64()),
                ppq,
            )
            .max(start + 1);
            notes.push(Note {
                track: track.track_id,
                index,
                pitch: note.note,
                start,
                end,
            });
        }
    }
    if notes.is_empty() {
        return Err("当前演奏没有可记谱的有音高音符".into());
    }
    if notes.len() > 100_000 {
        return Err("量化练习谱超过十万个音符".into());
    }
    let source_notes = notes.len();
    notes.sort_by_key(|note| (note.start, note.end, note.track, note.index));
    let mut lanes: Vec<Lane> = vec![];
    for note in notes {
        check()?;
        let staff = if note.pitch >= 60 { 1 } else { 2 };
        // Exact simultaneous notes share a chord; sustained overlapping notes get a voice.
        let chord = lanes.iter().position(|lane| {
            lane.staff == staff
                && lane.notes.last().is_some_and(|previous| {
                    previous.start == note.start && previous.end == note.end
                })
        });
        let lane = chord.or_else(|| {
            lanes
                .iter()
                .position(|lane| lane.staff == staff && lane.end <= note.start)
        });
        if let Some(index) = lane {
            lanes[index].end = note.end;
            lanes[index].notes.push(note);
        } else {
            lanes.push(Lane {
                staff,
                end: note.end,
                notes: vec![note],
            });
        }
        if lanes.len() > 128 {
            return Err("量化练习谱的同时声部超过 128 个".into());
        }
    }
    // An empty staff still receives a measure rest, keeping the piano grand staff explicit.
    for staff in [1, 2] {
        if !lanes.iter().any(|lane| lane.staff == staff) {
            lanes.push(Lane {
                staff,
                notes: vec![],
                end: 0,
            });
        }
    }
    lanes.sort_by_key(|lane| lane.staff);
    let mut xml = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><score-partwise version=\"4.0\"><work><work-title>{}</work-title></work><identification><encoding><software>Panthesia practice engraving</software></encoding></identification><part-list><score-part id=\"P1\"><part-name>钢琴</part-name></score-part></part-list><part id=\"P1\">",
        escape(title)
    );
    let mut identities = HashMap::new();
    let mut offsets = vec![0; lanes.len()];
    let mut segments: HashMap<(usize, usize), usize> = HashMap::new();
    let mut previous_meter = None;
    for (ordinal, measure) in file.musical_time.measures.iter().enumerate() {
        check()?;
        let start = units(measure.start_tick as f64, ppq);
        let end = units(measure.end_tick as f64, ppq);
        if end <= start {
            return Err("当前小节长度低于练习谱的 1/128 精度".into());
        }
        let beat = (DIVISIONS * 4 / u64::from(measure.denominator)).max(1)
            * if measure.denominator == 8 && measure.numerator > 3 && measure.numerator % 3 == 0 {
                3
            } else {
                1
            };
        write!(
            xml,
            "<measure number=\"{}\"{}>",
            measure.display_number,
            if measure.partial {
                " implicit=\"yes\""
            } else {
                ""
            }
        )
        .unwrap();
        let meter = (measure.numerator, measure.denominator);
        if ordinal == 0 || previous_meter != Some(meter) {
            write!(xml, "<attributes><divisions>{DIVISIONS}</divisions>").unwrap();
            if ordinal == 0 {
                write!(
                    xml,
                    "<key><fifths>{fifths}</fifths><mode>{}</mode></key>",
                    if minor { "minor" } else { "major" }
                )
                .unwrap();
            }
            write!(
                xml,
                "<time><beats>{}</beats><beat-type>{}</beat-type></time>",
                meter.0, meter.1
            )
            .unwrap();
            if ordinal == 0 {
                xml.push_str("<staves>2</staves><clef number=\"1\"><sign>G</sign><line>2</line></clef><clef number=\"2\"><sign>F</sign><line>4</line></clef>");
            }
            xml.push_str("</attributes>");
        }
        previous_meter = Some(meter);
        if ordinal == 0 {
            let bpm = file.tempo_track.bpm_at_seconds(0.);
            write!(xml,"<direction placement=\"above\"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{bpm:.2}</per-minute></metronome></direction-type><sound tempo=\"{bpm:.2}\"/></direction>").unwrap();
        }
        for (lane_index, lane) in lanes.iter().enumerate() {
            check()?;
            if lane_index > 0 {
                write!(xml, "<backup><duration>{}</duration></backup>", end - start).unwrap();
            }
            let voice = lane_index + 1;
            let staff = lane.staff;
            let mut cursor = start;
            while offsets[lane_index] < lane.notes.len()
                && lane.notes[offsets[lane_index]].end <= start
            {
                offsets[lane_index] += 1;
            }
            let mut at = offsets[lane_index];
            while at < lane.notes.len() && lane.notes[at].start < end {
                let first = &lane.notes[at];
                let mut after = at + 1;
                while after < lane.notes.len()
                    && lane.notes[after].start == first.start
                    && lane.notes[after].end == first.end
                {
                    after += 1;
                }
                let note_start = first.start.max(start);
                let note_end = first.end.min(end);
                rests(&mut xml, cursor, note_start, start, beat, voice, staff);
                for (position, length, kind, dot) in pieces(note_start, note_end, start, beat) {
                    check()?;
                    for (chord_index, note) in lane.notes[at..after].iter().enumerate() {
                        let segment = segments.entry((note.track, note.index)).or_default();
                        let id = format!(
                            "panthesia-practice-t{}-n{}-s{}",
                            note.track, note.index, segment
                        );
                        *segment += 1;
                        identities.insert(
                            id.clone(),
                            PracticeNote {
                                track: note.track,
                                index: note.index,
                                start_tick: position * u64::from(ppq) / DIVISIONS,
                                end_tick: (position + length) * u64::from(ppq) / DIVISIONS,
                            },
                        );
                        write!(
                            xml,
                            "<note id=\"{id}\">{}{}<duration>{length}</duration>",
                            if chord_index > 0 { "<chord/>" } else { "" },
                            pitch(note.pitch, fifths < 0)
                        )
                        .unwrap();
                        let stop = position > note.start;
                        let begin = position + length < note.end;
                        if stop {
                            xml.push_str("<tie type=\"stop\"/>");
                        }
                        if begin {
                            xml.push_str("<tie type=\"start\"/>");
                        }
                        write!(
                            xml,
                            "<voice>{voice}</voice><type>{kind}</type>{}<staff>{staff}</staff>",
                            if dot { "<dot/>" } else { "" }
                        )
                        .unwrap();
                        if stop || begin {
                            xml.push_str("<notations>");
                            if stop {
                                xml.push_str("<tied type=\"stop\"/>");
                            }
                            if begin {
                                xml.push_str("<tied type=\"start\"/>");
                            }
                            xml.push_str("</notations>");
                        }
                        xml.push_str("</note>");
                        if xml.len() > 4_000_000 || identities.len() > 100_000 {
                            return Err("量化练习谱过大，请缩短练习范围".into());
                        }
                    }
                }
                cursor = note_end;
                at = after;
            }
            if cursor == start {
                write!(xml,"<note><rest measure=\"yes\"/><duration>{}</duration><voice>{voice}</voice><staff>{staff}</staff></note>",end-start).unwrap();
            } else {
                rests(&mut xml, cursor, end, start, beat, voice, staff);
            }
        }
        xml.push_str("</measure>");
        if xml.len() > 4_000_000 {
            return Err("量化练习谱超过 4 MB，请缩短练习范围".into());
        }
    }
    xml.push_str("</part></score-partwise>");
    if segments.len() != source_notes {
        return Err("当前小节范围没有完整覆盖演奏音符，请核对小节设置".into());
    }
    check()?;
    Ok(Engraving {
        bytes: xml.into_bytes(),
        notes: identities,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use midi_file::midly::{
        Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind as K,
    };
    #[test]
    fn polyphonic_practice_round_trip_keeps_chords_ties_meters_and_source_indices() {
        let mut events = vec![
            (0, K::Meta(MetaMessage::Tempo(500_000.into()))),
            (0, K::Meta(MetaMessage::TimeSignature(4, 2, 24, 8))),
            (1920, K::Meta(MetaMessage::TimeSignature(3, 2, 24, 8))),
        ];
        for (start, end, pitch, channel) in [
            (0, 2400, 60, 0),
            (0, 480, 64, 0),
            (0, 480, 67, 0),
            (240, 960, 69, 0),
            (1440, 2160, 48, 0),
            (0, 120, 36, 9),
        ] {
            events.push((
                start,
                K::Midi {
                    channel: channel.into(),
                    message: MidiMessage::NoteOn {
                        key: pitch.into(),
                        vel: 90.into(),
                    },
                },
            ));
            events.push((
                end,
                K::Midi {
                    channel: channel.into(),
                    message: MidiMessage::NoteOff {
                        key: pitch.into(),
                        vel: 0.into(),
                    },
                },
            ));
        }
        events.sort_by_key(|e| e.0);
        let mut last = 0;
        let track = events
            .into_iter()
            .map(|(tick, kind)| {
                let delta = tick - last;
                last = tick;
                TrackEvent {
                    delta: delta.into(),
                    kind,
                }
            })
            .collect();
        let file = MidiFile::from_smf(
            "practice",
            &Smf {
                header: Header::new(Format::SingleTrack, Timing::Metrical(480.into())),
                tracks: vec![track],
            },
        )
        .unwrap();
        let result = engrave(&file, "练习 & 和弦", -2, false, &|| Ok(())).unwrap();
        let text = String::from_utf8(result.bytes.clone()).unwrap();
        assert!(
            text.contains("<chord/>")
                && text.contains("<tied type=\"start\"/>")
                && text.contains("<beats>3</beats>")
        );
        let score = crate::musicxml::import_musicxml_document(&result.bytes).unwrap();
        let performed = crate::score_performance::generate(&score, 120).unwrap();
        let decoded = MidiFile::from_smf("round-trip", &performed.smf).unwrap();
        let signatures = |file: &MidiFile| {
            let mut rows: Vec<_> = file
                .tracks
                .iter()
                .flat_map(|t| &*t.notes)
                .filter(|n| n.channel != 9)
                .map(|n| {
                    (
                        n.note,
                        units(
                            file.tempo_track.seconds_to_pulses(n.start.as_secs_f64()),
                            file.tempo_track.ppq(),
                        ),
                        units(
                            file.tempo_track.seconds_to_pulses(n.end.as_secs_f64()),
                            file.tempo_track.ppq(),
                        ),
                    )
                })
                .collect();
            rows.sort();
            rows
        };
        assert_eq!(signatures(&file), signatures(&decoded));
        let identities: std::collections::HashSet<_> =
            result.notes.values().map(|n| (n.track, n.index)).collect();
        assert_eq!(identities.len(), 5);
        assert!(result.notes.len() > identities.len());
    }
}
