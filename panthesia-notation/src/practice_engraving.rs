//! Disposable practice notation from the effective performance, never a replacement source score.
use panthesia_music::MidiFile;
use crate::musicxml::{
    self as ir, Clef, Direction, Measure, MeasureAttributes, NoteDisplay, Part, Pitch, Score, ScoreEvent,
    ScoreEventId, ScoreEventKind, ScoreTime, SpanType, Step, TimeSignature,
};
use std::collections::HashMap;

const DIVISIONS: u64 = 32;
pub const GENERATOR: &str = "panthesia-practice-engraving-v6";
/// Half-open global measure ordinals. Bounds apply to each request, not the song.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeasureRange {
    pub first: usize,
    pub count: usize,
}
impl MeasureRange {
    pub fn end(self, total: usize) -> Result<usize, String> {
        let end = self.first.checked_add(self.count).ok_or("小节范围无效")?;
        if self.count == 0 || self.count > 64 || end > total {
            return Err("每次谱面范围应为当前曲目中的 1–64 个小节".into());
        }
        Ok(end)
    }
}
/// Range engraving keeps global source identities, tick positions and boundary ties.
pub fn engrave_range(
    file: &MidiFile,
    title: &str,
    fifths: i8,
    minor: bool,
    simplified: bool,
    range: MeasureRange,
    staff: &impl Fn(usize, usize, u8) -> u8,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Engraving, String> {
    let keys=projected_keys(file,fifths,minor);
    engrave_range_with_keys(file,title,fifths,minor,simplified,range,staff,&keys,check)
}
pub fn engrave_range_with_keys(
    file:&MidiFile,title:&str,fifths:i8,minor:bool,simplified:bool,range:MeasureRange,
    staff:&impl Fn(usize,usize,u8)->u8,keys:&[panthesia_music::key_signature::KeySignatureEvent],check:&impl Fn()->Result<(),String>,
)->Result<Engraving,String>{
    range.end(file.musical_time.measures.len())?;
    engrave_selected(file,title,fifths,minor,simplified,Some(range),staff,keys,check)
}
fn projected_keys(file:&MidiFile,fifths:i8,minor:bool)->Vec<panthesia_music::key_signature::KeySignatureEvent>{
    use panthesia_music::key_signature::{tonic,project,KeySignatureEvent};
    let Some(first)=file.key_signatures.first() else{return vec![];};
    let shift=i16::from(tonic(fifths,minor))-i16::from(tonic(first.fifths,first.minor));
    file.key_signatures.iter().map(|key|{let (_,fifths,minor)=project(key.fifths,key.minor,shift,(first.minor!=minor).then_some(minor));KeySignatureEvent{tick:key.tick,fifths,minor}}).collect()
}
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
    source_start: u64,
    source_end: u64,
}
struct Lane {
    staff: u8,
    notes: Vec<Note>,
    end: u64,
}
fn units(tick: f64, ppq: u16) -> u64 {
    (tick * DIVISIONS as f64 / f64::from(ppq)).round().max(0.) as u64
}
fn pitch_parts(value: u8, flats: bool) -> (&'static str, i8, i16) {
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
    (step, alter, i16::from(value) / 12 - 1)
}
fn step_of(name: &str) -> Step {
    match name {
        "C" => Step::C,
        "D" => Step::D,
        "E" => Step::E,
        "F" => Step::F,
        "G" => Step::G,
        "A" => Step::A,
        _ => Step::B,
    }
}
fn accidental(
    value: u8,
    fifths: i8,
    seen: &mut HashMap<(&'static str, i16), i8>,
    continuation: bool,
) -> Option<&'static str> {
    if continuation {
        return None;
    }
    let (step, alter, octave) = pitch_parts(value, fifths < 0);
    let order = if fifths < 0 {
        ["B", "E", "A", "D", "G", "C", "F"]
    } else {
        ["F", "C", "G", "D", "A", "E", "B"]
    };
    let key = if order[..usize::from(fifths.unsigned_abs()).min(7)].contains(&step) {
        fifths.signum()
    } else {
        0
    };
    let previous = seen.insert((step, octave), alter).unwrap_or(key);
    if previous == alter {
        return None;
    }
    Some(match alter {
        -1 => "flat",
        1 => "sharp",
        _ => "natural",
    })
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
/// All identities refer to the original track/note indices retained by practice transforms.
/// The check runs during preparation and rendering, outside the playback driver.
pub fn engrave(
    file: &MidiFile,
    title: &str,
    fifths: i8,
    minor: bool,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Engraving, String> {
    engrave_with_rhythm(file, title, fifths, minor, false, check)
}

/// A disposable 1/16 display grid. Playback and source note timing stay untouched.
pub fn engrave_simplified(
    file: &MidiFile,
    title: &str,
    fifths: i8,
    minor: bool,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Engraving, String> {
    engrave_with_rhythm(file, title, fifths, minor, true, check)
}

fn engrave_with_rhythm(
    file: &MidiFile,
    title: &str,
    fifths: i8,
    minor: bool,
    simplified: bool,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Engraving, String> {
    let keys=projected_keys(file,fifths,minor);
    engrave_selected(file,title,fifths,minor,simplified,None,&|_,_,pitch|if pitch>=60 {1}else{2},&keys,check)
}
fn engrave_selected(
    file: &MidiFile,
    title: &str,
    fifths: i8,
    minor: bool,
    simplified: bool,
    range: Option<MeasureRange>,
    staff_for: &impl Fn(usize, usize, u8) -> u8,
    keys:&[panthesia_music::key_signature::KeySignatureEvent],
    check: &impl Fn() -> Result<(), String>,
) -> Result<Engraving, String> {
    check()?;
    let ppq = file.tempo_track.ppq();
    if ppq == 0 {
        return Err("MIDI 缺少有效的拍位精度".into());
    }
    let score_end = file
        .musical_time
        .measures
        .last()
        .map(|m| units(m.end_tick as f64, ppq))
        .unwrap_or(0);
    if score_end == 0 {
        return Err("当前演奏缺少可用的小节范围".into());
    }
    let first = range.map_or(0, |r| r.first);
    let after = range.map_or(file.musical_time.measures.len(), |r| r.first + r.count);
    let range_start = units(file.musical_time.measures[first].start_tick as f64, ppq);
    let range_end = units(file.musical_time.measures[after - 1].end_tick as f64, ppq);
    let mut notes = Vec::new();
    for track in file.tracks.iter() {
        check()?;
        for (index, note) in track
            .notes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.channel != 9)
        {
            if index % 1024 == 0 {
                check()?;
            }
            let source_start = file
                .tempo_track
                .seconds_to_pulses(note.start.as_secs_f64())
                .round()
                .max(0.) as u64;
            let source_end = (file
                .tempo_track
                .seconds_to_pulses(note.end.as_secs_f64())
                .round()
                .max(0.) as u64)
                .max(source_start + 1);
            let step = if simplified { DIVISIONS / 4 } else { 1 };
            let align = |tick| (units(tick as f64, ppq) + step / 2) / step * step;
            let start = align(source_start).min(score_end - 1);
            let end = align(source_end).max(start + step).min(score_end);
            if start >= range_end || end <= range_start {
                continue;
            }
            if notes.len() >= 100_000 {
                return Err("当前谱面范围超过十万个音符，请缩小范围".into());
            }
            notes.push(Note {
                track: track.track_id,
                index,
                pitch: note.note,
                start,
                end,
                source_start,
                source_end,
            });
        }
    }
    if notes.is_empty() && range.is_none() {
        return Err("当前演奏没有可记谱的有音高音符".into());
    }
    if notes.len() > 100_000 {
        return Err("练习谱超过十万个音符".into());
    }
    let source_notes = notes.len();
    notes.sort_by_key(|note| (note.start, note.end, note.track, note.index));
    let mut lanes: Vec<Lane> = vec![];
    for note in notes {
        check()?;
        let staff = staff_for(note.track, note.index, note.pitch).clamp(1, 2);
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
            return Err("练习谱的同时声部超过 128 个".into());
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
    let time = |units: u64| ScoreTime::new(units as i64, DIVISIONS as u32);
    let mode = |minor: bool| Some(if minor { "minor" } else { "major" }.to_string());
    let mut measures = Vec::new();
    let mut identities = HashMap::new();
    let mut offsets = vec![0; lanes.len()];
    let mut segments: HashMap<(usize, usize), usize> = HashMap::new();
    let mut previous_meter = None;
    let mut previous_key = None;
    let key_at = |position: u64| {
        keys.get(keys.partition_point(|key| units(key.tick as f64, ppq) <= position).saturating_sub(1))
            .filter(|key| units(key.tick as f64, ppq) <= position)
            .map_or((fifths, minor), |key| (key.fifths, key.minor))
    };
    for (ordinal, measure) in file.musical_time.measures.iter().enumerate().take(after).skip(first) {
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
        let measure_ordinal = (ordinal - first) as u32;
        let mut out = Measure {
            number: measure.display_number.to_string(),
            implicit: measure.partial,
            start: time(start),
            duration: time(end - start),
            attributes: vec![],
            barlines: vec![],
            events: vec![],
            harmonies: vec![],
        };
        let meter = (measure.numerator, measure.denominator);
        let (fifths, minor) = key_at(start);
        let opening = ordinal == first;
        if opening || previous_meter != Some(meter) || previous_key != Some((fifths, minor)) {
            let key_changed = opening || previous_key != Some((fifths, minor));
            out.attributes.push(MeasureAttributes {
                onset: time(start),
                divisions: DIVISIONS as u32,
                key_fifths: key_changed.then_some(fifths),
                key_mode: if key_changed { mode(minor) } else { None },
                time_signature: Some(TimeSignature { beats: meter.0.to_string(), beat_type: meter.1.to_string() }),
                staves: opening.then_some(2),
                clefs: if opening {
                    vec![
                        Clef { staff: 1, sign: "G".into(), line: Some(2) },
                        Clef { staff: 2, sign: "F".into(), line: Some(4) },
                    ]
                } else {
                    vec![]
                },
            });
        }
        previous_meter = Some(meter);
        previous_key = Some((fifths, minor));
        for key in keys.iter() {
            let at = units(key.tick as f64, ppq);
            if at > start && at < end {
                out.attributes.push(MeasureAttributes {
                    onset: time(at),
                    divisions: DIVISIONS as u32,
                    key_fifths: Some(key.fifths),
                    key_mode: mode(key.minor),
                    ..Default::default()
                });
            }
        }
        let mut direction = 0u32;
        let mut tempo = |out: &mut Measure, at: u64, bpm: String, shown: bool| {
            out.events.push(ScoreEvent::Direction(Direction {
                id: ScoreEventId { part_id: "P1".into(), measure_ordinal, kind: ScoreEventKind::Direction, ordinal: direction },
                onset: time(at),
                metronome: shown.then(|| bpm.clone()),
                tempo_bpm: Some(bpm),
                ..Default::default()
            }));
            direction += 1;
        };
        if opening {
            let bpm = file.tempo_track.bpm_at_seconds(file.tempo_track.pulses_to_duration(measure.start_tick).as_secs_f64());
            tempo(&mut out, start, format!("{bpm:.2}"), true);
        }
        for event in file
            .tempo_track
            .events()
            .iter()
            .filter(|event| event.absolute_pulses > measure.start_tick && event.absolute_pulses < measure.end_tick)
        {
            let at = units(event.absolute_pulses as f64, ppq).max(start);
            tempo(&mut out, at, format!("{:.6}", 60_000_000. / f64::from(event.tempo)), true);
        }
        // A change exactly at a later barline needs its own active tempo as well.
        if !opening && file.tempo_track.events().iter().any(|e| e.absolute_pulses == measure.start_tick) {
            let bpm = file.tempo_track.bpm_at_seconds(file.tempo_track.pulses_to_duration(measure.start_tick).as_secs_f64());
            tempo(&mut out, start, format!("{bpm:.6}"), false);
        }
        let mut note_ordinal = 0u32;
        let mut push = |out: &mut Measure, note: ir::Note| {
            out.events.push(ScoreEvent::Note(ir::Note {
                id: ScoreEventId { part_id: "P1".into(), measure_ordinal, kind: ScoreEventKind::Note, ordinal: note_ordinal },
                ..note
            }));
            note_ordinal += 1;
        };
        let rest = |at: u64, length: u64, kind: &'static str, dot: bool, voice: usize, staff: u8| ir::Note {
            onset: time(at),
            duration: time(length),
            voice: Some(voice.to_string()),
            staff,
            display: NoteDisplay { kind: Some(kind), dots: u8::from(dot), ..Default::default() },
            ..Default::default()
        };
        for (lane_index, lane) in lanes.iter().enumerate() {
            check()?;
            let voice = lane_index + 1;
            let staff = lane.staff;
            let mut cursor = start;
            let mut written_accidentals = HashMap::new();
            let mut written_key = (fifths, minor);
            while offsets[lane_index] < lane.notes.len() && lane.notes[offsets[lane_index]].end <= start {
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
                for (position, length, kind, dot) in pieces(cursor, note_start, start, beat) {
                    push(&mut out, rest(position, length, kind, dot, voice, staff));
                }
                for (position, length, kind, dot) in pieces(note_start, note_end, start, beat) {
                    check()?;
                    for (chord_index, note) in lane.notes[at..after].iter().enumerate() {
                        let note_key = key_at(position);
                        if note_key != written_key {
                            written_accidentals.clear();
                            written_key = note_key;
                        }
                        let fifths = note_key.0;
                        *segments.entry((note.track, note.index)).or_default() += 1;
                        let id = format!("panthesia-practice-t{}-n{}-s{}", note.track, note.index, position);
                        let performance_tick = |display: u64| {
                            if simplified {
                                note.source_start
                                    + (display - note.start) * (note.source_end - note.source_start) / (note.end - note.start)
                            } else {
                                display * u64::from(ppq) / DIVISIONS
                            }
                        };
                        identities.insert(
                            id.clone(),
                            PracticeNote {
                                track: note.track,
                                index: note.index,
                                start_tick: performance_tick(position),
                                end_tick: performance_tick(position + length),
                            },
                        );
                        let stop = position > note.start;
                        let begin = position + length < note.end;
                        let (step, alter, octave) = pitch_parts(note.pitch, fifths < 0);
                        push(&mut out, ir::Note {
                            onset: time(position),
                            duration: time(length),
                            voice: Some(voice.to_string()),
                            staff,
                            pitch: Some(Pitch { step: step_of(step), alter, octave: octave as i8 }),
                            chord: chord_index > 0,
                            ties: [(stop, SpanType::Stop), (begin, SpanType::Start)]
                                .into_iter()
                                .filter_map(|(on, kind)| on.then_some(kind))
                                .collect(),
                            xml_id: Some(id),
                            display: NoteDisplay {
                                kind: Some(kind),
                                dots: u8::from(dot),
                                accidental: accidental(note.pitch, fifths, &mut written_accidentals, stop),
                                ..Default::default()
                            },
                            ..Default::default()
                        });
                        if identities.len() > 100_000 {
                            return Err("练习谱过大，请缩短练习范围".into());
                        }
                    }
                }
                cursor = note_end;
                at = after;
            }
            if cursor == start {
                push(&mut out, ir::Note {
                    onset: time(start),
                    duration: time(end - start),
                    voice: Some(voice.to_string()),
                    staff,
                    display: NoteDisplay { measure_rest: true, ..Default::default() },
                    ..Default::default()
                });
            } else {
                for (position, length, kind, dot) in pieces(cursor, end, start, beat) {
                    push(&mut out, rest(position, length, kind, dot, voice, staff));
                }
            }
        }
        measures.push(out);
    }
    if segments.len() != source_notes {
        return Err("当前小节范围没有完整覆盖演奏音符，请核对小节设置".into());
    }
    check()?;
    let score = Score {
        version: Some("4.0".into()),
        title: Some(title.into()),
        composer: None,
        parts: vec![Part { id: "P1".into(), name: "钢琴".into(), measures }],
        warnings: vec![],
    };
    let xml = crate::musicxml_write::write(&score)?;
    if xml.len() > 4_000_000 {
        return Err("练习谱超过 4 MB，请缩短练习范围".into());
    }
    Ok(Engraving { bytes: xml.into_bytes(), notes: identities })
}

#[cfg(test)]
mod tests {
    use super::*;
    use panthesia_music::midly::{
        Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind as K,
    };
    #[test]
    fn simplified_notation_uses_readable_grid_and_original_performance_time() {
        let on = |pitch: u8| K::Midi {
            channel: 0.into(),
            message: MidiMessage::NoteOn {
                key: pitch.into(),
                vel: 90.into(),
            },
        };
        let off = |pitch: u8| K::Midi {
            channel: 0.into(),
            message: MidiMessage::NoteOff {
                key: pitch.into(),
                vel: 0.into(),
            },
        };
        let file = MidiFile::from_smf(
            "human-timing",
            &Smf {
                header: Header::new(Format::SingleTrack, Timing::Metrical(480.into())),
                tracks: vec![vec![
                    TrackEvent {
                        delta: 101.into(),
                        kind: on(60u8),
                    },
                    TrackEvent {
                        delta: 118.into(),
                        kind: off(60u8),
                    },
                    TrackEvent {
                        delta: 81.into(),
                        kind: on(64u8),
                    },
                    TrackEvent {
                        delta: 1200.into(),
                        kind: off(64u8),
                    },
                    TrackEvent {
                        delta: 0.into(),
                        kind: K::Meta(MetaMessage::EndOfTrack),
                    },
                ]],
            },
        )
        .unwrap();
        let original = file.tracks[0].notes[0].clone();
        let result = engrave_simplified(&file, "简化谱", 0, false, &|| Ok(())).unwrap();
        let first = result.notes.values().find(|note| note.index == 0).unwrap();
        assert_eq!((first.start_tick, first.end_tick), (101, 219));
        let sustained: Vec<_> = result
            .notes
            .values()
            .filter(|note| note.index == 1)
            .collect();
        assert_eq!(
            sustained.iter().map(|note| note.start_tick).min(),
            Some(300)
        );
        assert_eq!(sustained.iter().map(|note| note.end_tick).max(), Some(1500));
        assert!(sustained.len() > 1);
        let score = crate::musicxml::import_musicxml_document(&result.bytes).unwrap();
        let performed = crate::score_performance::generate(&score, 120).unwrap();
        let displayed = MidiFile::from_smf("display", &performed.smf).unwrap();
        let first_displayed = displayed
            .tracks
            .iter()
            .flat_map(|track| track.notes.iter())
            .find(|note| note.note == 60)
            .unwrap();
        assert_eq!(
            units(
                displayed
                    .tempo_track
                    .seconds_to_pulses(first_displayed.start.as_secs_f64()),
                displayed.tempo_track.ppq()
            ),
            8
        );
        assert_eq!(file.tracks[0].notes[0].start, original.start);
        assert_eq!(file.tracks[0].notes[0].end, original.end);
    }
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

#[cfg(test)]
mod accidental_tests {
    use super::*;
    #[test]
    fn signs_follow_key_and_note_state_without_changing_source_pitch() {
        let mut state = HashMap::new();
        assert_eq!(
            accidental(61, 0, &mut state, false),
            Some("sharp")
        );
        assert_eq!(accidental(61, 0, &mut state, false), None);
        assert_eq!(
            accidental(60, 0, &mut state, false),
            Some("natural")
        );
        assert_eq!(accidental(60, 0, &mut state, false), None);
        state.clear();
        assert_eq!(accidental(66, 1, &mut state, false), None);
        assert_eq!(
            accidental(65, 1, &mut state, false),
            Some("natural")
        );
        assert_eq!(accidental(66, 1, &mut state, true), None);
    }
}

#[cfg(test)]
mod range_tests {
    use super::*;
    use panthesia_music::midly::{
        Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind as K,
    };
    fn midi(mut events: Vec<(u32, K<'static>)>) -> MidiFile {
        events.sort_by_key(|e| e.0);
        let mut last = 0;
        let track = events
            .into_iter()
            .map(|(at, kind)| {
                let delta = at - last;
                last = at;
                TrackEvent {
                    delta: delta.into(),
                    kind,
                }
            })
            .collect();
        MidiFile::from_smf(
            "own-window-fixture",
            &Smf {
                header: Header::new(Format::SingleTrack, Timing::Metrical(480.into())),
                tracks: vec![track],
            },
        )
        .unwrap()
    }
    fn on(p: u8) -> K<'static> {
        K::Midi {
            channel: 0.into(),
            message: MidiMessage::NoteOn {
                key: p.into(),
                vel: 80.into(),
            },
        }
    }
    fn off(p: u8) -> K<'static> {
        K::Midi {
            channel: 0.into(),
            message: MidiMessage::NoteOff {
                key: p.into(),
                vel: 0.into(),
            },
        }
    }
    #[test]
    fn adjacent_windows_keep_global_ids_ties_meter_tempo_and_assigned_staff() {
        let file = midi(vec![
            (0, on(36)),
            (31 * 1920, K::Meta(MetaMessage::Tempo(666_667.into()))),
            (33 * 1920 + 240, on(84)),
            (33 * 1920 + 720, off(84)),
            (34 * 1920, K::Meta(MetaMessage::TimeSignature(3, 2, 24, 8))),
            (34 * 1920 + 480, K::Meta(MetaMessage::Tempo(400_000.into()))),
            (65 * 1920, off(36)),
            (72 * 1920, K::Meta(MetaMessage::EndOfTrack)),
        ]);
        let staff = |_, _, pitch| if pitch == 36 { 1 } else { 2 };
        let first = engrave_range(
            &file,
            "Own",
            -2,
            false,
            false,
            MeasureRange {
                first: 32,
                count: 8,
            },
            &staff,
            &|| Ok(()),
        )
        .unwrap();
        let overlap = engrave_range(
            &file,
            "Own",
            -2,
            false,
            false,
            MeasureRange {
                first: 34,
                count: 8,
            },
            &staff,
            &|| Ok(()),
        )
        .unwrap();
        let xml = std::str::from_utf8(&first.bytes).unwrap();
        assert!(xml.contains("<measure number=\"33\""));
        assert!(
            xml.contains("<beats>3</beats>")
                && xml.contains("tempo=\"90.00\"")
                && xml.contains("tempo=\"150.000000\"")
        );
        assert!(xml.contains("<tie type=\"stop\"/>") && xml.contains("<tie type=\"start\"/>"));
        let shared: Vec<_> = first
            .notes
            .iter()
            .filter(|(id, _)| overlap.notes.contains_key(*id))
            .collect();
        assert!(!shared.is_empty());
        for (id, note) in shared {
            let other = &overlap.notes[id];
            assert_eq!(
                (note.track, note.index, note.start_tick, note.end_tick),
                (other.track, other.index, other.start_tick, other.end_tick)
            );
        }
        let score = crate::musicxml::import_musicxml_document(&first.bytes).unwrap();
        for event in score
            .parts
            .iter()
            .flat_map(|p| &p.measures)
            .flat_map(|m| &m.events)
        {
            if let crate::musicxml::ScoreEvent::Note(note) = event {
                if let Some(pitch) = &note.pitch {
                    assert_eq!(note.staff, if pitch.octave == 2 { 1 } else { 2 });
                }
            }
        }
        assert_eq!(file.tracks[0].notes.len(), 2);
    }
    #[test]
    fn range_at_end_of_over_limit_song_prepares_without_full_document() {
        let mut events = Vec::with_capacity(200_003);
        for index in 0..100_001 {
            events.push((index * 480, on(60)));
            events.push((index * 480 + 240, off(60)));
        }
        events.push((100_001 * 480, K::Meta(MetaMessage::EndOfTrack)));
        let file = midi(events);
        assert!(engrave(&file, "", 0, false, &|| Ok(())).is_err());
        let range = MeasureRange {
            first: 25_000,
            count: 1,
        };
        let result =
            engrave_range(&file, "", 0, false, false, range, &|_, _, _| 1, &|| Ok(())).unwrap();
        assert!(result.bytes.len() < 10_000);
        assert_eq!(result.notes.len(), 1);
        let note = result.notes.values().next().unwrap();
        assert_eq!((note.index, note.start_tick), (100_000, 48_000_000));
        assert!(
            std::str::from_utf8(&result.bytes)
                .unwrap()
                .contains("<measure number=\"25001\"")
        );
        assert!(
            engrave_range(
                &file,
                "",
                0,
                false,
                false,
                MeasureRange {
                    first: 0,
                    count: 65
                },
                &|_, _, _| 1,
                &|| Ok(())
            )
            .is_err()
        );
    }
}
