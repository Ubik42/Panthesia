//! The one MusicXML writer: generated notation (practice scores, ABC imports) is built as a
//! [`Score`] and written here, so every score the renderer sees comes from the same model.
//!
//! Within a measure, notes are written voice after voice (with backup between voices). Chord
//! symbols and directions go into the first voice at their onsets; a direction that falls inside
//! a note gets an offset. Attribute changes inside a measure are reached with forward/backup.

use std::fmt::Write;

use crate::musicxml::{
    Barline, BarlineLocation, Direction, EndingType, Harmony, Measure, MeasureAttributes, Note,
    Pitch, RepeatDirection, Score, ScoreEvent, ScoreTime, SpanType, Step,
};

/// Largest divisions value the writer accepts; finer rhythms are a producer bug.
const MAX_DIVISIONS: u64 = 1 << 20;

pub fn write(score: &Score) -> Result<String, String> {
    let mut x = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<score-partwise version=\"4.0\">\n",
    );
    if let Some(title) = &score.title {
        let _ = writeln!(x, "<work><work-title>{}</work-title></work>", escape(title));
    }
    x.push_str("<identification>");
    if let Some(composer) = &score.composer {
        let _ = write!(x, "<creator type=\"composer\">{}</creator>", escape(composer));
    }
    x.push_str("<encoding><software>Panthesia</software></encoding></identification>\n<part-list>\n");
    for part in &score.parts {
        let _ = writeln!(
            x,
            "<score-part id=\"{}\"><part-name>{}</part-name></score-part>",
            escape(&part.id),
            escape(&part.name)
        );
    }
    x.push_str("</part-list>\n");
    for part in &score.parts {
        let divisions = divisions(&part.measures)?;
        let _ = writeln!(x, "<part id=\"{}\">", escape(&part.id));
        for (index, measure) in part.measures.iter().enumerate() {
            write_measure(&mut x, measure, divisions, index == 0);
        }
        x.push_str("</part>\n");
    }
    x.push_str("</score-partwise>\n");
    Ok(x)
}

fn divisions(measures: &[Measure]) -> Result<u64, String> {
    let mut value = 1u64;
    let mut include = |t: ScoreTime| value = lcm(value, u64::from(t.denominator));
    for m in measures {
        include(m.start);
        include(m.duration);
        for a in &m.attributes {
            include(a.onset);
        }
        for h in &m.harmonies {
            include(h.onset);
        }
        for e in &m.events {
            match e {
                ScoreEvent::Note(n) => {
                    include(n.onset);
                    include(n.duration);
                }
                ScoreEvent::Direction(d) => include(d.onset),
            }
        }
    }
    if value > MAX_DIVISIONS {
        return Err("谱面节奏精度超出 MusicXML 写出范围".into());
    }
    Ok(value)
}

fn units(t: ScoreTime, divisions: u64) -> i64 {
    t.numerator * divisions as i64 / i64::from(t.denominator)
}

fn write_measure(x: &mut String, m: &Measure, divisions: u64, first: bool) {
    let _ = writeln!(
        x,
        "<measure number=\"{}\"{}>",
        escape(&m.number),
        if m.implicit { " implicit=\"yes\"" } else { "" }
    );
    for barline in m.barlines.iter().filter(|b| b.location == BarlineLocation::Left) {
        write_barline(x, barline);
    }
    let at_start: Vec<_> = m.attributes.iter().filter(|a| a.onset == m.start).collect();
    if first || !at_start.is_empty() {
        x.push_str("<attributes>");
        if first {
            let _ = write!(x, "<divisions>{divisions}</divisions>");
        }
        for a in at_start {
            write_attributes(x, a);
        }
        x.push_str("</attributes>\n");
    }
    let start = units(m.start, divisions);
    // Attribute changes inside the measure: walk there with forward and come back.
    let mut cursor = start;
    for a in m.attributes.iter().filter(|a| a.onset > m.start) {
        let at = units(a.onset, divisions);
        let _ = write!(x, "<forward><duration>{}</duration></forward><attributes>", at - cursor);
        write_attributes(x, a);
        x.push_str("</attributes>\n");
        cursor = at;
    }
    if cursor > start {
        let _ = writeln!(x, "<backup><duration>{}</duration></backup>", cursor - start);
    }

    // Voices in order of first appearance; notes keep their order within a voice.
    let mut voices: Vec<(Option<&str>, u8, Vec<&Note>)> = Vec::new();
    for event in &m.events {
        if let ScoreEvent::Note(n) = event {
            let key = (n.voice.as_deref(), n.staff);
            match voices.iter_mut().find(|(v, s, _)| (*v, *s) == key) {
                Some((_, _, notes)) => notes.push(n),
                None => voices.push((key.0, key.1, vec![n])),
            }
        }
    }
    // Items placed into the first voice by onset: chord symbols, then directions.
    let mut items: Vec<(i64, Item)> = m
        .harmonies
        .iter()
        .map(|h| (units(h.onset, divisions), Item::Harmony(h)))
        .chain(m.events.iter().filter_map(|e| match e {
            ScoreEvent::Direction(d) => Some((units(d.onset, divisions), Item::Direction(d))),
            ScoreEvent::Note(_) => None,
        }))
        .collect();
    items.sort_by_key(|(at, _)| *at);
    let mut items = items.into_iter().peekable();
    let end = units(m.start.add(m.duration), divisions);
    let voice_count = voices.len();
    for (index, (_, _, notes)) in voices.into_iter().enumerate() {
        let mut cursor = start;
        for note in notes {
            let onset = units(note.onset, divisions);
            if index == 0 {
                // Items before or at this note: a gap is walked with forward, an item inside the
                // previous note gets an offset from the current position.
                while let Some((at, _)) = items.peek() {
                    if *at > onset || (note.chord && *at == onset) {
                        break;
                    }
                    let (at, item) = items.next().unwrap();
                    if at > cursor && !note.chord {
                        let _ = write!(x, "<forward><duration>{}</duration></forward>", at - cursor);
                        cursor = at;
                    }
                    item.write(x, at - cursor);
                }
            }
            if !note.chord && !note.grace && onset > cursor {
                let _ = write!(x, "<forward><duration>{}</duration></forward>", onset - cursor);
                cursor = onset;
            }
            write_note(x, note, divisions);
            if !note.chord && !note.grace {
                cursor = onset + units(note.duration, divisions);
            }
        }
        if index == 0 {
            for (at, item) in items.by_ref() {
                item.write(x, at - cursor);
            }
        }
        if index + 1 < voice_count && cursor > start {
            let _ = writeln!(x, "<backup><duration>{}</duration></backup>", cursor - start);
        }
    }
    if voice_count == 0 {
        for (at, item) in items {
            item.write(x, at - start);
        }
        let _ = writeln!(x, "<forward><duration>{}</duration></forward>", end - start);
    }
    for barline in m.barlines.iter().filter(|b| b.location != BarlineLocation::Left) {
        write_barline(x, barline);
    }
    x.push_str("</measure>\n");
}

enum Item<'a> {
    Harmony(&'a Harmony),
    Direction(&'a Direction),
}
impl Item<'_> {
    fn write(&self, x: &mut String, offset: i64) {
        match self {
            Item::Harmony(h) => write_harmony(x, h, offset),
            Item::Direction(d) => write_direction(x, d, offset),
        }
    }
}

fn write_attributes(x: &mut String, a: &MeasureAttributes) {
    if let Some(fifths) = a.key_fifths {
        let _ = write!(x, "<key><fifths>{fifths}</fifths>");
        if let Some(mode) = &a.key_mode {
            let _ = write!(x, "<mode>{}</mode>", escape(mode));
        }
        x.push_str("</key>");
    }
    if let Some(t) = &a.time_signature {
        let _ = write!(
            x,
            "<time><beats>{}</beats><beat-type>{}</beat-type></time>",
            escape(&t.beats),
            escape(&t.beat_type)
        );
    }
    if let Some(staves) = a.staves {
        let _ = write!(x, "<staves>{staves}</staves>");
    }
    for clef in &a.clefs {
        let number = if a.staves.unwrap_or(1) > 1 || clef.staff > 1 {
            format!(" number=\"{}\"", clef.staff)
        } else {
            String::new()
        };
        let _ = write!(x, "<clef{number}><sign>{}</sign>", escape(&clef.sign));
        if let Some(line) = clef.line {
            let _ = write!(x, "<line>{line}</line>");
        }
        x.push_str("</clef>");
    }
}

fn offset(x: &mut String, offset: i64) {
    if offset != 0 {
        let _ = write!(x, "<offset>{offset}</offset>");
    }
}

fn write_harmony(x: &mut String, h: &Harmony, at: i64) {
    x.push_str("<harmony>");
    if let Some((step, alter)) = h.root {
        let _ = write!(x, "<root><root-step>{}</root-step>", step_name(step));
        if alter != 0 {
            let _ = write!(x, "<root-alter>{alter}</root-alter>");
        }
        x.push_str("</root>");
    }
    match &h.text {
        Some(text) => {
            let _ = write!(x, "<kind text=\"{}\">{}</kind>", escape(text), escape(&h.kind));
        }
        None => {
            let _ = write!(x, "<kind>{}</kind>", escape(&h.kind));
        }
    }
    if let Some((step, alter)) = h.bass {
        let _ = write!(x, "<bass><bass-step>{}</bass-step>", step_name(step));
        if alter != 0 {
            let _ = write!(x, "<bass-alter>{alter}</bass-alter>");
        }
        x.push_str("</bass>");
    }
    offset(x, at);
    x.push_str("</harmony>\n");
}

fn write_direction(x: &mut String, d: &Direction, at: i64) {
    let _ = write!(
        x,
        "<direction{}>",
        if d.metronome.is_some() || !d.words.is_empty() { " placement=\"above\"" } else { "" }
    );
    let mut types = String::new();
    for words in &d.words {
        let _ = write!(types, "<direction-type><words>{}</words></direction-type>", escape(words));
    }
    for dynamic in &d.dynamics {
        let _ = write!(types, "<direction-type><dynamics><{0}/></dynamics></direction-type>", escape(dynamic));
    }
    if d.segno {
        types.push_str("<direction-type><segno/></direction-type>");
    }
    if d.coda {
        types.push_str("<direction-type><coda/></direction-type>");
    }
    if let Some(bpm) = &d.metronome {
        let _ = write!(
            types,
            "<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{}</per-minute></metronome></direction-type>",
            escape(bpm)
        );
    }
    // A direction needs one direction-type; an empty words element carries a bare sound.
    x.push_str(if types.is_empty() { "<direction-type><words/></direction-type>" } else { &types });
    offset(x, at);
    if let Some(staff) = d.staff {
        let _ = write!(x, "<staff>{staff}</staff>");
    }
    let mut sound = String::new();
    if let Some(bpm) = &d.tempo_bpm {
        let _ = write!(sound, " tempo=\"{}\"", escape(bpm));
    }
    for navigation in &d.navigation {
        for (key, value) in &navigation.attributes {
            let _ = write!(sound, " {}=\"{}\"", escape(key), escape(value));
        }
    }
    if !sound.is_empty() {
        let _ = write!(x, "<sound{sound}/>");
    }
    x.push_str("</direction>\n");
}

fn write_barline(x: &mut String, b: &Barline) {
    let location = match &b.location {
        BarlineLocation::Left => "left",
        BarlineLocation::Middle => "middle",
        BarlineLocation::Right => "right",
        BarlineLocation::Other(value) => value,
    };
    let _ = write!(x, "<barline location=\"{}\">", escape(location));
    if let Some(style) = &b.style {
        let _ = write!(x, "<bar-style>{}</bar-style>", escape(style));
    }
    if b.coda {
        x.push_str("<coda/>");
    }
    for ending in &b.endings {
        let kind = match &ending.kind {
            EndingType::Start => "start",
            EndingType::Stop => "stop",
            EndingType::Discontinue => "discontinue",
            EndingType::Other(value) => value,
        };
        let number = ending.number.as_deref().unwrap_or("1");
        match &ending.text {
            Some(text) => {
                let _ = write!(x, "<ending number=\"{}\" type=\"{}\">{}</ending>", escape(number), escape(kind), escape(text));
            }
            None => {
                let _ = write!(x, "<ending number=\"{}\" type=\"{}\"/>", escape(number), escape(kind));
            }
        }
    }
    if let Some(repeat) = &b.repeat {
        let direction = match &repeat.direction {
            RepeatDirection::Forward => "forward",
            RepeatDirection::Backward => "backward",
            RepeatDirection::Other(value) => value,
        };
        let _ = write!(x, "<repeat direction=\"{}\"", escape(direction));
        if let Some(times) = repeat.times {
            let _ = write!(x, " times=\"{times}\"");
        }
        x.push_str("/>");
    }
    x.push_str("</barline>\n");
}

fn write_note(x: &mut String, n: &Note, divisions: u64) {
    x.push_str("<note");
    if let Some(id) = &n.xml_id {
        let _ = write!(x, " id=\"{}\"", escape(id));
    }
    if n.display.hidden {
        x.push_str(" print-object=\"no\"");
    }
    x.push('>');
    if n.grace {
        let slash = n.grace_timing.as_ref().and_then(|g| g.slash.as_deref());
        match slash {
            Some(value) => {
                let _ = write!(x, "<grace slash=\"{}\"/>", escape(value));
            }
            None => x.push_str("<grace/>"),
        }
    }
    if n.chord {
        x.push_str("<chord/>");
    }
    match &n.pitch {
        Some(p) => write_pitch(x, p),
        None if n.display.measure_rest => x.push_str("<rest measure=\"yes\"/>"),
        None => x.push_str("<rest/>"),
    }
    if !n.grace {
        let _ = write!(x, "<duration>{}</duration>", units(n.duration, divisions));
    }
    let mut ties: Vec<SpanType> = Vec::new();
    for tie in &n.ties {
        if !matches!(tie, SpanType::Continue) && !ties.contains(tie) {
            ties.push(*tie);
        }
    }
    ties.sort_by_key(|tie| matches!(tie, SpanType::Start));
    for tie in &ties {
        let _ = write!(x, "<tie type=\"{}\"/>", span(*tie));
    }
    if let Some(voice) = &n.voice {
        let _ = write!(x, "<voice>{}</voice>", escape(voice));
    }
    let (kind, dots) = match n.display.kind {
        Some(kind) => (Some(kind), n.display.dots),
        None if n.display.measure_rest => (None, 0),
        None => note_type(n),
    };
    if let Some(kind) = kind {
        let _ = write!(x, "<type>{kind}</type>");
        for _ in 0..dots {
            x.push_str("<dot/>");
        }
    }
    if let Some(accidental) = n.display.accidental {
        let _ = write!(x, "<accidental>{accidental}</accidental>");
    }
    if let Some(t) = &n.time_modification {
        let _ = write!(
            x,
            "<time-modification><actual-notes>{}</actual-notes><normal-notes>{}</normal-notes>",
            t.actual_notes, t.normal_notes
        );
        if let Some(normal) = &t.normal_type {
            let _ = write!(x, "<normal-type>{}</normal-type>", escape(normal));
        }
        for _ in 0..t.normal_dots {
            x.push_str("<normal-dot/>");
        }
        x.push_str("</time-modification>");
    }
    if n.staff > 1 || n.voice.is_some() {
        let _ = write!(x, "<staff>{}</staff>", n.staff.max(1));
    }
    let mut notations = String::new();
    for tie in &ties {
        let _ = write!(notations, "<tied type=\"{}\"/>", span(*tie));
    }
    for slur in &n.slurs {
        let _ = write!(notations, "<slur type=\"{}\" number=\"{}\"/>", span(slur.kind), slur.number);
    }
    for tuplet in &n.tuplets {
        let _ = write!(notations, "<tuplet type=\"{}\" number=\"{}\"", span(tuplet.kind), tuplet.number);
        if let Some(bracket) = tuplet.bracket {
            let _ = write!(notations, " bracket=\"{}\"", if bracket { "yes" } else { "no" });
        }
        if let Some(show) = &tuplet.show_number {
            let _ = write!(notations, " show-number=\"{}\"", escape(show));
        }
        notations.push_str("/>");
    }
    let mut ornaments = String::new();
    if n.trill.is_some() {
        ornaments.push_str("<trill-mark/>");
    }
    if let Some(m) = &n.mordent {
        ornaments.push_str(if m.inverted { "<inverted-mordent/>" } else { "<mordent/>" });
    }
    if let Some(t) = &n.turn {
        ornaments.push_str(if t.inverted { "<inverted-turn/>" } else { "<turn/>" });
    }
    if !ornaments.is_empty() {
        let _ = write!(notations, "<ornaments>{ornaments}</ornaments>");
    }
    if let Some(finger) = &n.fingering {
        let _ = write!(notations, "<technical><fingering>{}</fingering></technical>", escape(finger));
    }
    if !n.articulations.is_empty() {
        notations.push_str("<articulations>");
        for a in &n.articulations {
            let _ = write!(notations, "<{}/>", escape(a));
        }
        notations.push_str("</articulations>");
    }
    if !notations.is_empty() {
        let _ = write!(x, "<notations>{notations}</notations>");
    }
    for lyric in &n.lyrics {
        let _ = write!(x, "<lyric number=\"{}\">", escape(&lyric.verse));
        if let Some(syllabic) = &lyric.syllabic {
            let _ = write!(x, "<syllabic>{}</syllabic>", escape(syllabic));
        }
        let _ = write!(x, "<text>{}</text></lyric>", escape(&lyric.text));
    }
    x.push_str("</note>\n");
}

fn write_pitch(x: &mut String, p: &Pitch) {
    let _ = write!(x, "<pitch><step>{}</step>", step_name(p.step));
    if p.alter != 0 {
        let _ = write!(x, "<alter>{}</alter>", p.alter);
    }
    let _ = write!(x, "<octave>{}</octave></pitch>", p.octave);
}

/// The printed type of a note whose producer gave none: its written value (duration scaled
/// back by a tuplet ratio) as a power-of-two note with up to three dots.
fn note_type(n: &Note) -> (Option<&'static str>, u8) {
    if n.grace {
        return (Some("eighth"), 0);
    }
    let mut written = n.duration;
    if let Some(t) = &n.time_modification {
        written = ScoreTime::new(
            written.numerator * i64::from(t.actual_notes),
            written.denominator * u32::from(t.normal_notes),
        );
    }
    const NAMES: [(&str, i64, u32); 11] = [
        ("breve", 8, 1),
        ("whole", 4, 1),
        ("half", 2, 1),
        ("quarter", 1, 1),
        ("eighth", 1, 2),
        ("16th", 1, 4),
        ("32nd", 1, 8),
        ("64th", 1, 16),
        ("128th", 1, 32),
        ("256th", 1, 64),
        ("512th", 1, 128),
    ];
    for (name, numerator, denominator) in NAMES {
        let base = ScoreTime::new(numerator, denominator);
        let mut value = base;
        let mut add = base;
        for dots in 0..=3u8 {
            if value == written {
                return (Some(name), dots);
            }
            add = ScoreTime::new(add.numerator, add.denominator * 2);
            value = value.add(add);
        }
    }
    (None, 0)
}

fn span(kind: SpanType) -> &'static str {
    match kind {
        SpanType::Start => "start",
        SpanType::Stop => "stop",
        SpanType::Continue => "continue",
    }
}

fn step_name(step: Step) -> &'static str {
    match step {
        Step::C => "C",
        Step::D => "D",
        Step::E => "E",
        Step::F => "F",
        Step::G => "G",
        Step::A => "A",
        Step::B => "B",
    }
}

fn lcm(a: u64, b: u64) -> u64 {
    let (mut x, mut y) = (a, b);
    while y != 0 {
        (x, y) = (y, x % y);
    }
    a / x * b
}

fn escape(value: &str) -> String {
    quick_xml::escape::escape(value).into_owned()
}
