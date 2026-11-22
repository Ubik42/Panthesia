//! Score IR to ABC 2.1. The counterpart of [`crate::abc`]: every (part, staff, voice) becomes one
//! ABC voice with its clef, so a piano grand staff is written as `V:1` (treble) and `V:2` (bass),
//! grouped by `%%score`. Lengths are exact fractions of `L:1/16`; accidentals follow the key and
//! the bar, as a reader expects. Chord symbols go into the first voice. Lyrics, ornaments,
//! articulations and fingering are not written.
use std::collections::HashMap;
use std::fmt::Write;

use crate::musicxml::{
    BarlineLocation, EndingType, Harmony, Note, Pitch, RepeatDirection, Score, ScoreEvent, ScoreTime,
    SpanType, Step,
};

const BARS_PER_LINE: usize = 4;

/// One ABC voice: the notes of one voice on one staff of one part.
struct Lane {
    part: usize,
    staff: u8,
    voice: String,
    clef: &'static str,
    name: String,
}

pub fn write(score: &Score, tempo_bpm: Option<f64>) -> Result<String, String> {
    let first = score.parts.first().ok_or("乐谱没有声部")?;
    if first.measures.is_empty() {
        return Err("乐谱没有小节".into());
    }
    let lanes = lanes(score);
    if lanes.is_empty() {
        return Err("乐谱没有音符".into());
    }
    let mut out = String::new();
    out.push_str("X:1\n");
    let _ = writeln!(out, "T:{}", one_line(score.title.as_deref().unwrap_or("未命名")));
    if let Some(composer) = &score.composer {
        let _ = writeln!(out, "C:{}", one_line(composer));
    }
    let attributes = first.measures[0].attributes.first();
    let meter = attributes.and_then(|a| a.time_signature.as_ref()).map(|t| format!("{}/{}", t.beats, t.beat_type));
    let _ = writeln!(out, "M:{}", meter.as_deref().unwrap_or("4/4"));
    out.push_str("L:1/16\n");
    if let Some(bpm) = tempo_bpm.filter(|b| b.is_finite() && *b > 0.) {
        let _ = writeln!(out, "Q:1/4={}", bpm.round() as i64);
    }
    // Staves of one part share a brace; parts are separated by bars.
    let mut groups: Vec<String> = Vec::new();
    for part in 0..score.parts.len() {
        let ids: Vec<String> = lanes.iter().enumerate().filter(|(_, l)| l.part == part).map(|(i, _)| (i + 1).to_string()).collect();
        match ids.len() {
            0 => {}
            1 => groups.push(ids[0].clone()),
            _ => groups.push(format!("{{({})}}", ids.join(" "))),
        }
    }
    let _ = writeln!(out, "%%score {}", groups.join(" | "));
    for (i, lane) in lanes.iter().enumerate() {
        let _ = writeln!(out, "V:{} clef={} name=\"{}\"", i + 1, lane.clef, lane.name.replace('"', "'"));
    }
    let mut fifths = attributes.and_then(|a| a.key_fifths).unwrap_or(0);
    let minor = attributes.and_then(|a| a.key_mode.as_deref()) == Some("minor");
    let _ = writeln!(out, "K:{}", key_name(fifths, minor));

    let count = first.measures.len();
    let harmonies = harmonies(score);
    let mut voices: Vec<Vec<String>> = lanes.iter().map(|_| Vec::with_capacity(count)).collect();
    for m in 0..count {
        let reference = &first.measures[m];
        // Key and meter changes after the first bar apply to every voice.
        let mut inline = String::new();
        if m > 0 {
            for a in &reference.attributes {
                if let Some(f) = a.key_fifths.filter(|f| *f != fifths) {
                    fifths = f;
                    let _ = write!(inline, "[K:{}]", key_name(f, a.key_mode.as_deref() == Some("minor")));
                }
                if let Some(t) = &a.time_signature {
                    let _ = write!(inline, "[M:{}/{}]", t.beats, t.beat_type);
                }
            }
        }
        for (i, lane) in lanes.iter().enumerate() {
            let Some(measure) = score.parts[lane.part].measures.get(m) else {
                voices[i].push(format!("{inline}z{}|", length(reference.duration)));
                continue;
            };
            let chords = if i == 0 { harmonies.get(&m) } else { None };
            let primary = !lanes[..i].iter().any(|l| l.part == lane.part && l.staff == lane.staff);
            let mut bar = inline.clone();
            bar.push_str(&measure_body(measure, lane, fifths, chords, primary));
            voices[i].push(bar);
        }
    }
    // Barlines: repeats, endings and the final bar, written into every voice.
    for m in 0..count {
        let reference = &first.measures[m];
        let forward = reference.barlines.iter().any(|b| matches!(b.location, BarlineLocation::Left) && b.repeat.as_ref().is_some_and(|r| r.direction == RepeatDirection::Forward));
        let backward = reference.barlines.iter().any(|b| b.repeat.as_ref().is_some_and(|r| r.direction == RepeatDirection::Backward));
        let ending = reference.barlines.iter().flat_map(|b| &b.endings).find(|e| e.kind == EndingType::Start).and_then(|e| e.number.clone());
        for voice in &mut voices {
            let bar = &mut voice[m];
            if let Some(number) = &ending {
                bar.insert_str(0, &format!("[{} ", number.split(',').next().unwrap_or("1").trim()));
            }
            if forward {
                bar.insert_str(0, "|:");
            }
            if backward {
                bar.pop();
                bar.push_str(":|");
            } else if m + 1 == count {
                bar.pop();
                bar.push_str("|]");
            }
        }
    }
    for start in (0..count).step_by(BARS_PER_LINE) {
        let end = (start + BARS_PER_LINE).min(count);
        let _ = writeln!(out, "% {}", start + 1);
        for (i, voice) in voices.iter().enumerate() {
            let _ = writeln!(out, "[V:{}] {}", i + 1, voice[start..end].join(" "));
        }
    }
    Ok(out)
}

fn one_line(text: &str) -> String {
    text.replace(['\r', '\n'], " ")
}

fn lanes(score: &Score) -> Vec<Lane> {
    let mut lanes = Vec::new();
    for (p, part) in score.parts.iter().enumerate() {
        let staves = part.measures.iter().flat_map(|m| &m.attributes).filter_map(|a| a.staves).max().unwrap_or(1);
        let clef_of = |staff: u8| {
            let sign = part.measures.iter().flat_map(|m| &m.attributes).flat_map(|a| &a.clefs).find(|c| c.staff == staff).map(|c| c.sign.as_str());
            match sign {
                Some("F") => "bass",
                Some("C") => "alto",
                _ if sign.is_none() && staff >= 2 => "bass",
                _ => "treble",
            }
        };
        let mut seen: Vec<(u8, String)> = Vec::new();
        for event in part.measures.iter().flat_map(|m| &m.events) {
            if let ScoreEvent::Note(note) = event {
                let key = (note.staff.max(1), note.voice.clone().unwrap_or_else(|| "1".into()));
                if note.pitch.is_some() && !seen.contains(&key) {
                    seen.push(key);
                }
            }
        }
        seen.sort_by(|a, b| a.0.cmp(&b.0));
        for (i, (staff, voice)) in seen.iter().cloned().enumerate() {
            let base = match (staves, staff) {
                (2, 1) => "右手".to_string(),
                (2, 2) => "左手".to_string(),
                _ => part.name.clone(),
            };
            let order = seen[..i].iter().filter(|(s, _)| *s == staff).count();
            let name = if order == 0 { base } else { format!("{base} {}", order + 1) };
            lanes.push(Lane { part: p, staff, voice, clef: clef_of(staff), name });
        }
    }
    lanes
}

/// Chord symbols by measure index, from the first part that has any.
fn harmonies(score: &Score) -> HashMap<usize, Vec<Harmony>> {
    let part = score.parts.iter().find(|p| p.measures.iter().any(|m| !m.harmonies.is_empty()));
    let mut out = HashMap::new();
    if let Some(part) = part {
        for (i, m) in part.measures.iter().enumerate() {
            if !m.harmonies.is_empty() {
                out.insert(i, m.harmonies.clone());
            }
        }
    }
    out
}

fn measure_body(measure: &crate::musicxml::Measure, lane: &Lane, fifths: i8, chords: Option<&Vec<Harmony>>, primary: bool) -> String {
    let mut notes: Vec<&Note> = measure
        .events
        .iter()
        .filter_map(|e| match e {
            ScoreEvent::Note(n) if n.staff.max(1) == lane.staff && n.voice.as_deref().unwrap_or("1") == lane.voice => Some(n),
            _ => None,
        })
        .collect();
    // Keep chord members after their first note; sort groups by onset.
    let mut groups: Vec<Vec<&Note>> = Vec::new();
    for note in notes.drain(..) {
        match groups.last_mut() {
            Some(group) if note.chord && !note.grace => group.push(note),
            _ => groups.push(vec![note]),
        }
    }
    groups.sort_by(|a, b| a[0].onset.cmp(&b[0].onset));
    let mut accidentals: HashMap<(Step, i8), i8> = HashMap::new();
    let mut chords: Vec<&Harmony> = chords.map(|c| c.iter().collect()).unwrap_or_default();
    let mut out = String::new();
    // Rests next to each other are written as one.
    let mut rest_run: Option<(ScoreTime, bool)> = None;
    let flush = |out: &mut String, run: &mut Option<(ScoreTime, bool)>| {
        if let Some((duration, hidden)) = run.take() {
            out.push_str(&rest(duration, hidden));
            out.push(' ');
        }
    };
    let add_rest = |out: &mut String, run: &mut Option<(ScoreTime, bool)>, duration: ScoreTime, hidden: bool| match run {
        Some((total, same)) if *same == hidden => *total = total.add(duration),
        _ => {
            flush(out, run);
            *run = Some((duration, hidden));
        }
    };
    let mut cursor = measure.start;
    let end = measure.start.add(measure.duration);
    let mut graces = String::new();
    for group in groups {
        let head = group[0];
        if head.grace {
            graces.push_str(&pitches(&group, fifths, &mut accidentals, false));
            continue;
        }
        if head.onset > cursor {
            add_rest(&mut out, &mut rest_run, head.onset.subtract(cursor), !primary);
        }
        let onset_in_bar = head.onset.subtract(measure.start);
        let symbol = chords.first().is_some_and(|h| h.onset <= onset_in_bar || h.onset <= head.onset);
        if head.pitch.is_none() && !symbol {
            add_rest(&mut out, &mut rest_run, head.duration, head.display.hidden);
            cursor = head.onset.add(head.duration);
            continue;
        }
        flush(&mut out, &mut rest_run);
        while chords.first().is_some_and(|h| h.onset <= onset_in_bar || h.onset <= head.onset) {
            let _ = write!(out, "\"{}\"", chord_symbol(chords.remove(0)));
        }
        if !graces.is_empty() {
            let _ = write!(out, "{{{graces}}}");
            graces.clear();
        }
        if head.pitch.is_none() {
            out.push_str(&rest(head.duration, head.display.hidden));
        } else {
            let body = pitches(&group, fifths, &mut accidentals, true);
            if group.len() > 1 {
                let _ = write!(out, "[{body}]{}", length(head.duration));
            } else {
                // A single note: the tie mark follows the length (`C4-`).
                let (pitch, tie) = body.strip_suffix('-').map_or((body.as_str(), ""), |p| (p, "-"));
                let _ = write!(out, "{pitch}{}{tie}", length(head.duration));
            }
        }
        out.push(' ');
        cursor = head.onset.add(head.duration);
    }
    if cursor < end {
        // Missing time is a rest on the staff's first voice and invisible space on the others.
        add_rest(&mut out, &mut rest_run, end.subtract(cursor), !primary);
    }
    flush(&mut out, &mut rest_run);
    let mut out = out.trim_end().to_string();
    out.push('|');
    out
}

fn rest(duration: ScoreTime, hidden: bool) -> String {
    format!("{}{}", if hidden { 'x' } else { 'z' }, length(duration))
}

/// Pitches of a note or chord, with bar-scoped accidentals; `-` after a tied pitch.
fn pitches(group: &[&Note], fifths: i8, bar: &mut HashMap<(Step, i8), i8>, ties: bool) -> String {
    let mut out = String::new();
    for note in group {
        let Some(pitch) = &note.pitch else { continue };
        out.push_str(&pitch_text(pitch, fifths, bar));
        if ties && note.ties.iter().any(|t| *t == SpanType::Start) {
            out.push('-');
        }
    }
    out
}

fn pitch_text(pitch: &Pitch, fifths: i8, bar: &mut HashMap<(Step, i8), i8>) -> String {
    let current = bar.get(&(pitch.step, pitch.octave)).copied().unwrap_or_else(|| key_alter(pitch.step, fifths));
    let mut out = String::new();
    if current != pitch.alter {
        out.push_str(match pitch.alter {
            2 => "^^",
            1 => "^",
            0 => "=",
            -1 => "_",
            -2 => "__",
            _ => "",
        });
        bar.insert((pitch.step, pitch.octave), pitch.alter);
    }
    let letter = match pitch.step {
        Step::C => 'C',
        Step::D => 'D',
        Step::E => 'E',
        Step::F => 'F',
        Step::G => 'G',
        Step::A => 'A',
        Step::B => 'B',
    };
    if pitch.octave >= 5 {
        out.push(letter.to_ascii_lowercase());
        out.extend(std::iter::repeat_n('\'', (pitch.octave - 5) as usize));
    } else {
        out.push(letter);
        out.extend(std::iter::repeat_n(',', (4 - pitch.octave).max(0) as usize));
    }
    out
}

/// The alteration a key signature gives a step.
fn key_alter(step: Step, fifths: i8) -> i8 {
    const SHARPS: [Step; 7] = [Step::F, Step::C, Step::G, Step::D, Step::A, Step::E, Step::B];
    const FLATS: [Step; 7] = [Step::B, Step::E, Step::A, Step::D, Step::G, Step::C, Step::F];
    if fifths > 0 && SHARPS[..fifths.min(7) as usize].contains(&step) {
        1
    } else if fifths < 0 && FLATS[..(-fifths).min(7) as usize].contains(&step) {
        -1
    } else {
        0
    }
}

fn key_name(fifths: i8, minor: bool) -> String {
    const MAJOR: [&str; 15] = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
    const MINOR: [&str; 15] = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#"];
    let i = (fifths.clamp(-7, 7) + 7) as usize;
    if minor { format!("{}m", MINOR[i]) } else { MAJOR[i].to_string() }
}

/// Length in units of `L:1/16`: a quarter is 4.
fn length(duration: ScoreTime) -> String {
    let (n, d) = reduce(duration.numerator * 4, i64::from(duration.denominator));
    match (n, d) {
        (1, 1) => String::new(),
        (n, 1) => n.to_string(),
        (1, 2) => "/".into(),
        (1, d) => format!("/{d}"),
        (n, d) => format!("{n}/{d}"),
    }
}

fn reduce(n: i64, d: i64) -> (i64, i64) {
    let (mut a, mut b) = (n.abs(), d.abs());
    while b != 0 {
        (a, b) = (b, a % b);
    }
    let g = a.max(1);
    (n / g, d / g)
}

fn chord_symbol(h: &Harmony) -> String {
    if let Some(text) = h.text.as_deref().filter(|t| !t.is_empty()) {
        return text.replace('"', "");
    }
    let root = h.root.map(|(s, a)| step_name(s, a)).unwrap_or_default();
    let quality = match h.kind.as_str() {
        "major" => "",
        "minor" => "m",
        "augmented" => "aug",
        "diminished" => "dim",
        "dominant" => "7",
        "major-seventh" => "maj7",
        "minor-seventh" => "m7",
        "diminished-seventh" => "dim7",
        "half-diminished" => "m7b5",
        "suspended-fourth" => "sus4",
        "suspended-second" => "sus2",
        "major-sixth" => "6",
        "minor-sixth" => "m6",
        "dominant-ninth" => "9",
        _ => "",
    };
    let bass = h.bass.map(|(s, a)| format!("/{}", step_name(s, a))).unwrap_or_default();
    format!("{root}{quality}{bass}")
}

fn step_name(step: Step, alter: i8) -> String {
    let letter = format!("{step:?}");
    let accidental = match alter {
        1 => "#",
        -1 => "b",
        2 => "##",
        -2 => "bb",
        _ => "",
    };
    format!("{letter}{accidental}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes(score: &Score) -> Vec<(i8, Step, i8, ScoreTime)> {
        let mut out: Vec<_> = score
            .parts
            .iter()
            .flat_map(|p| p.measures.iter().flat_map(|m| m.events.iter()))
            .filter_map(|e| match e {
                ScoreEvent::Note(n) if !n.grace => n.pitch.as_ref().map(|p| (p.octave, p.step, p.alter, n.duration)),
                _ => None,
            })
            .collect();
        out.sort_by(|a, b| format!("{a:?}").cmp(&format!("{b:?}")));
        out
    }

    #[test]
    fn abc_round_trip_keeps_pitches_and_lengths() {
        let source = "X:1\nT:Test\nM:3/4\nL:1/8\nK:G\nV:1 clef=treble\nV:2 clef=bass\n[V:1] G2 A B c2 | [Bd]3 ^c/ =c/ B2 | d6 |]\n[V:2] G,,6 | D,6- | D,6 |]\n";
        let original = crate::musicxml::import_musicxml_document(crate::abc::to_musicxml(source).unwrap().as_bytes()).unwrap();
        let written = write(&original, Some(90.)).unwrap();
        let again = crate::musicxml::import_musicxml_document(crate::abc::to_musicxml(&written).unwrap().as_bytes()).unwrap();
        assert_eq!(notes(&original), notes(&again), "{written}");
        assert!(written.contains("K:G") && written.contains("Q:1/4=90"), "{written}");
    }
}
