//! ABC 2.1 (common subset) to MusicXML. ABC tunes then take the same path as MusicXML scores:
//! import, repeats, chord symbols, lyrics, performance generation and engraving.
//!
//! Covered: header fields X T C M L Q K V; inline fields [K:] [M:] [L:] [Q:] [V:]; notes with
//! octave marks, accidentals (bar-scoped, per octave) and lengths; rests z x Z X; chords [..];
//! ties; broken rhythm > <; tuplets (p:q:r; grace notes {..}; bars, repeats |: :| :: and endings
//! [1 [2 |1 :|2; chord symbols "Am7/G"; lyrics w:; voices V:. Decorations, slurs and text
//! annotations are read and dropped.
use std::collections::HashMap;
use std::fmt::Write as _;

/// An exact fraction of a quarter note.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Frac {
    n: i64,
    d: i64,
}
fn gcd(a: i64, b: i64) -> i64 {
    if b == 0 { a.abs() } else { gcd(b, a % b) }
}
impl Frac {
    fn new(n: i64, d: i64) -> Self {
        let g = gcd(n, d).max(1);
        let s = if d < 0 { -1 } else { 1 };
        Self { n: s * n / g, d: s * d / g }
    }
    fn mul(self, o: Self) -> Self {
        Self::new(self.n * o.n, self.d * o.d)
    }
    fn add(self, o: Self) -> Self {
        Self::new(self.n * o.d + o.n * self.d, self.d * o.d)
    }
    fn sub(self, o: Self) -> Self {
        Self::new(self.n * o.d - o.n * self.d, self.d * o.d)
    }
    fn lt(self, o: Self) -> bool {
        self.n * o.d < o.n * self.d
    }
    fn zero() -> Self {
        Self { n: 0, d: 1 }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Meter {
    Free,
    Sig(u32, u32),
}
impl Meter {
    fn measure(self) -> Option<Frac> {
        match self {
            Meter::Free => None,
            Meter::Sig(n, d) => Some(Frac::new(4 * n as i64, d as i64)),
        }
    }
    fn compound(self) -> bool {
        matches!(self, Meter::Sig(n, 8) if n % 3 == 0 && n > 3)
    }
}

#[derive(Clone, Debug)]
struct Key {
    fifths: i8,
    mode: &'static str,
    /// Alteration per step letter (C D E F G A B) implied by the key.
    alters: [i8; 7],
}
const STEPS: [char; 7] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/// Steps sharpened, in order, by an increasing number of sharps (flats reverse it).
const SHARP_ORDER: [usize; 7] = [3, 0, 4, 1, 5, 2, 6];
impl Key {
    fn from_fifths(fifths: i8, mode: &'static str) -> Self {
        let mut alters = [0; 7];
        if fifths > 0 {
            for &s in &SHARP_ORDER[..fifths as usize] {
                alters[s] = 1;
            }
        } else {
            for &s in SHARP_ORDER.iter().rev().take((-fifths) as usize) {
                alters[s] = -1;
            }
        }
        Self { fifths, mode, alters }
    }
}
/// `K:` value: tonic, mode and explicit accidentals; also returns a clef if given.
fn parse_key(value: &str) -> Result<(Key, Option<Clef>), String> {
    let mut words = value.split_whitespace();
    let first = words.next().unwrap_or("C");
    let mut clef = None;
    let rest: Vec<&str> = words.collect();
    for word in &rest {
        if let Some(c) = word.strip_prefix("clef=") {
            clef = Some(parse_clef(c));
        } else if *word == "bass" || *word == "treble" {
            clef = Some(parse_clef(word));
        }
    }
    if first.eq_ignore_ascii_case("none") || first.is_empty() {
        return Ok((Key::from_fifths(0, "major"), clef));
    }
    let mut chars = first.chars().peekable();
    let tonic = chars.next().unwrap().to_ascii_uppercase();
    let step = STEPS.iter().position(|&s| s == tonic).ok_or_else(|| format!("调号无法识别：{value}"))?;
    let mut alter = 0;
    if let Some(&c) = chars.peek() {
        if c == '#' {
            alter = 1;
            chars.next();
        } else if c == 'b' {
            alter = -1;
            chars.next();
        }
    }
    let mut mode_text: String = chars.collect::<String>().to_ascii_lowercase();
    // `K:G minor` puts the mode in the next word.
    if mode_text.is_empty() {
        if let Some(word) = rest.first().filter(|w| !w.contains('=') && w.chars().next().is_some_and(char::is_alphabetic)) {
            mode_text = word.to_ascii_lowercase();
        }
    }
    let (mode, shift): (&'static str, i8) = match mode_text.get(..3.min(mode_text.len())).unwrap_or("") {
        "" | "maj" | "ion" => ("major", 0),
        "m" | "min" | "aeo" => ("minor", -3),
        "mix" => ("mixolydian", -1),
        "dor" => ("dorian", -2),
        "phr" => ("phrygian", -4),
        "lyd" => ("lydian", 1),
        "loc" => ("locrian", -5),
        other if other.starts_with('m') => ("minor", -3),
        _ => ("major", 0),
    };
    // Fifths of the major key on this tonic: C G D A E B F# / F Bb Eb ...
    const MAJOR: [i8; 7] = [0, 2, 4, -1, 1, 3, 5];
    let fifths = MAJOR[step] + 7 * alter + shift;
    if !(-7..=7).contains(&fifths) {
        return Err(format!("调号超出范围：{value}"));
    }
    let mut key = Key::from_fifths(fifths, mode);
    // Explicit accidentals after the mode: K:D exp ^f _b or K:D ^c
    for word in rest {
        let (alt, letter) = match word.as_bytes() {
            [b'^', b'^', l] => (2, *l),
            [b'_', b'_', l] => (-2, *l),
            [b'^', l] => (1, *l),
            [b'_', l] => (-1, *l),
            [b'=', l] => (0, *l),
            _ => continue,
        };
        if let Some(s) = STEPS.iter().position(|&s| s == (letter as char).to_ascii_uppercase()) {
            key.alters[s] = alt;
        }
    }
    Ok((key, clef))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Clef {
    Treble,
    Bass,
    Alto,
}
fn parse_clef(value: &str) -> Clef {
    match value.trim().to_ascii_lowercase().as_str() {
        "bass" | "f" => Clef::Bass,
        "alto" | "c" => Clef::Alto,
        _ => Clef::Treble,
    }
}

fn parse_meter(value: &str) -> Meter {
    let v = value.trim();
    match v {
        "C" => Meter::Sig(4, 4),
        "C|" => Meter::Sig(2, 2),
        "" | "none" => Meter::Free,
        _ => {
            let mut parts = v.split('/');
            let n = parts.next().and_then(|p| p.split('+').map(|x| x.trim().parse::<u32>().ok()).sum::<Option<u32>>());
            let d = parts.next().and_then(|p| p.trim().parse::<u32>().ok());
            match (n, d) {
                (Some(n), Some(d)) if n > 0 && d > 0 && d.is_power_of_two() => Meter::Sig(n, d),
                _ => Meter::Free,
            }
        }
    }
}
fn parse_fraction(value: &str) -> Option<Frac> {
    let mut parts = value.trim().split('/');
    let n = parts.next()?.trim().parse::<i64>().ok()?;
    let d = parts.next().map_or(Some(1), |p| p.trim().parse::<i64>().ok())?;
    (n > 0 && d > 0).then(|| Frac::new(n, d))
}
/// `Q:` value: `1/4=120`, `3/8=60` or a plain number (quarters per minute).
fn parse_tempo(value: &str) -> Option<f64> {
    let v = value.split('"').enumerate().filter(|(i, _)| i % 2 == 0).map(|(_, s)| s).collect::<String>();
    if let Some((beat, bpm)) = v.split_once('=') {
        let bpm: f64 = bpm.trim().parse().ok()?;
        let beat = beat.split_whitespace().filter_map(parse_fraction).fold(Frac::zero(), Frac::add);
        let quarters = beat.n as f64 * 4.0 / beat.d as f64;
        (bpm > 0.0 && quarters > 0.0).then_some(bpm * quarters)
    } else {
        v.trim().parse::<f64>().ok().filter(|b| *b > 0.0)
    }
}

#[derive(Clone, Debug)]
struct Pitch {
    step: usize,
    alter: i8,
    octave: i8,
}
#[derive(Clone, Debug)]
struct Harmony {
    root: (char, i8),
    kind: &'static str,
    text: String,
    bass: Option<(char, i8)>,
}
#[derive(Clone, Debug)]
struct Event {
    /// Empty for a rest.
    pitches: Vec<Pitch>,
    duration: Frac,
    tuplet: Option<(u32, u32)>,
    grace: bool,
    visible: bool,
    tie_start: Vec<bool>,
    tie_stop: Vec<bool>,
    harmony: Option<Harmony>,
    lyric: Option<(&'static str, String)>,
    /// Lyrics skip rests, grace notes and notes that continue a tie.
    lyric_target: bool,
}
#[derive(Clone, Debug, Default)]
struct Measure {
    events: Vec<Event>,
    key: Option<Key>,
    meter: Option<Meter>,
    clef: Option<Clef>,
    tempo: Option<f64>,
    forward_repeat: bool,
    backward_repeat: bool,
    ending_start: Option<String>,
    ending_stop: Option<&'static str>,
    final_bar: bool,
    double_bar: bool,
}
impl Measure {
    fn duration(&self) -> Frac {
        self.events.iter().filter(|e| !e.grace).fold(Frac::zero(), |a, e| a.add(e.duration))
    }
}

struct Voice {
    id: String,
    name: String,
    clef: Clef,
    measures: Vec<Measure>,
    current: Measure,
    key: Key,
    meter: Meter,
    unit: Frac,
    bar_alters: HashMap<(usize, i8), i8>,
    pending_ties: Vec<(usize, i8)>,
    tuplet: Option<(u32, u32, u32)>,
    broken_next: Option<Frac>,
    pending_harmony: Option<Harmony>,
    active_ending: bool,
    /// (measure, event) of lyric targets of the current music line.
    line_targets: Vec<(usize, usize)>,
    line_start_measure: usize,
}
impl Voice {
    fn new(id: String, key: Key, meter: Meter, unit: Frac, clef: Clef) -> Self {
        Self {
            name: id.clone(),
            id,
            clef,
            measures: Vec::new(),
            current: Measure::default(),
            key,
            meter,
            unit,
            bar_alters: HashMap::new(),
            pending_ties: Vec::new(),
            tuplet: None,
            broken_next: None,
            pending_harmony: None,
            active_ending: false,
            line_targets: Vec::new(),
            line_start_measure: 0,
        }
    }
    /// End the current measure at a bar line. A measure without notes (a leading `|:` or a
    /// bar right after another) is not a measure: its opening marks (key, meter, tempo, forward
    /// repeat, ending) stay for the next one and its closing marks go to the previous one.
    fn close_measure(&mut self) {
        self.bar_alters.clear();
        if self.current.events.is_empty() {
            let current = &mut self.current;
            if let Some(last) = self.measures.last_mut() {
                last.backward_repeat |= current.backward_repeat;
                last.final_bar |= current.final_bar;
                last.double_bar |= current.double_bar;
                if current.ending_stop.is_some() {
                    last.ending_stop = current.ending_stop;
                }
            }
            current.backward_repeat = false;
            current.final_bar = false;
            current.double_bar = false;
            current.ending_stop = None;
            return;
        }
        let measure = std::mem::take(&mut self.current);
        self.measures.push(measure);
    }
    fn push(&mut self, mut event: Event) {
        if let Some(factor) = self.broken_next.take() {
            event.duration = event.duration.mul(factor);
        }
        if !event.grace {
            if let Some((p, q, left)) = self.tuplet {
                event.duration = event.duration.mul(Frac::new(q as i64, p as i64));
                event.tuplet = Some((p, q));
                self.tuplet = if left > 1 { Some((p, q, left - 1)) } else { None };
            }
            event.harmony = self.pending_harmony.take();
        }
        if !event.grace {
            let stops: Vec<bool> = event
                .pitches
                .iter()
                .map(|p| self.pending_ties.iter().any(|&(s, o)| s == p.step && o == p.octave))
                .collect();
            event.lyric_target = !event.pitches.is_empty() && !stops.iter().any(|s| *s);
            event.tie_stop = stops;
            self.pending_ties.clear();
        }
        if event.lyric_target {
            self.line_targets.push((self.measures.len(), self.current.events.len()));
        }
        self.current.events.push(event);
    }
}

/// Read an ABC file: UTF-8 (the ABC 2.1 default), otherwise Windows-1252, as MusicXML bytes.
pub fn musicxml_from_file_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let text = match std::str::from_utf8(bytes) {
        Ok(text) => std::borrow::Cow::Borrowed(text),
        Err(_) => encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes).0,
    };
    to_musicxml(&text).map(String::into_bytes)
}

/// Convert the first tune of an ABC file to MusicXML 4.0.
pub fn to_musicxml(source: &str) -> Result<String, String> {
    let source = source.trim_start_matches('\u{feff}');
    // A tune book: the first tune starts at its X: line; the file header is shared.
    let mut lines: Vec<&str> = Vec::new();
    let mut seen_x = false;
    for line in source.lines() {
        if line.starts_with("X:") {
            if seen_x {
                break;
            }
            seen_x = true;
        }
        lines.push(line);
    }
    let mut title = None;
    let mut composer = None;
    let mut meter = Meter::Sig(4, 4);
    let mut unit = None;
    let mut tempo = None;
    let mut key = None;
    let mut header_clef = Clef::Treble;
    let mut voice_meta: Vec<(String, String, Clef)> = Vec::new();
    // Header ends at the first K: field.
    let mut body_start = lines.len();
    for (i, raw) in lines.iter().enumerate() {
        let line = strip_comment(raw);
        let Some((field, value)) = field(line) else { continue };
        match field {
            'T' if title.is_none() => title = Some(value.trim().to_string()),
            'C' if composer.is_none() => composer = Some(value.trim().to_string()),
            'M' => meter = parse_meter(value),
            'L' => unit = parse_fraction(value),
            'Q' => tempo = parse_tempo(value),
            'V' => voice_meta.push(parse_voice(value)),
            'K' => {
                let (k, clef) = parse_key(value)?;
                key = Some(k);
                if let Some(c) = clef {
                    header_clef = c;
                }
                body_start = i + 1;
                break;
            }
            _ => {}
        }
    }
    let key = key.ok_or("ABC 文件缺少 K: 调号行，无法确定曲调开始的位置")?;
    // L: default: 1/16 when the meter is below 0.75, otherwise 1/8.
    let unit = unit.unwrap_or_else(|| match meter {
        Meter::Sig(n, d) if (n as f64) / (d as f64) < 0.75 => Frac::new(1, 16),
        _ => Frac::new(1, 8),
    });
    // Unit length in quarters.
    let unit_q = unit.mul(Frac::new(4, 1));

    let mut voices: Vec<Voice> = Vec::new();
    let mut current = 0usize;
    let voice_index = |voices: &mut Vec<Voice>, id: &str, key: &Key, meter: Meter, unit: Frac, clef: Clef| -> usize {
        if let Some(i) = voices.iter().position(|v| v.id == id) {
            return i;
        }
        voices.push(Voice::new(id.to_string(), key.clone(), meter, unit, clef));
        voices.len() - 1
    };
    for (id, name, clef) in &voice_meta {
        let i = voice_index(&mut voices, id, &key, meter, unit_q, *clef);
        voices[i].name = name.clone();
    }
    if voices.is_empty() {
        voices.push(Voice::new("1".into(), key.clone(), meter, unit_q, header_clef));
    }
    voices[0].current.tempo = tempo;

    let mut continued = String::new();
    for raw in &lines[body_start..] {
        let line = strip_comment(raw);
        if line.trim().is_empty() {
            continue;
        }
        // Line continuation with a trailing backslash.
        if let Some(stripped) = line.trim_end().strip_suffix('\\') {
            continued.push_str(stripped);
            continue;
        }
        let line = if continued.is_empty() { line.to_string() } else { std::mem::take(&mut continued) + line };
        if let Some((field, value)) = field(&line) {
            match field {
                'w' => {
                    let v = &mut voices[current];
                    assign_lyrics(v, value);
                }
                'V' => {
                    let (id, name, clef) = parse_voice(value);
                    let (k, m, u) = (voices[current].key.clone(), voices[current].meter, voices[current].unit);
                    current = voice_index(&mut voices, &id, &k, m, u, clef);
                    if !name.is_empty() && name != id {
                        voices[current].name = name;
                    }
                }
                'K' | 'M' | 'L' | 'Q' => apply_field(&mut voices[current], field, value)?,
                _ => {}
            }
            continue;
        }
        // `[V:id]` switches voice inside a music line; each segment belongs to its voice.
        let mut rest = line.as_str();
        loop {
            let (segment, next) = match rest.find("[V:") {
                Some(at) => {
                    let end = rest[at..].find(']').map_or(rest.len(), |e| at + e);
                    (&rest[..at], Some((&rest[at + 3..end], &rest[(end + 1).min(rest.len())..])))
                }
                None => (rest, None),
            };
            if !segment.trim().is_empty() {
                let v = &mut voices[current];
                v.line_targets.clear();
                v.line_start_measure = v.measures.len();
                parse_music(v, segment)?;
            }
            let Some((value, after)) = next else { break };
            let (id, name, clef) = parse_voice(value);
            let (k, m, u) = (voices[current].key.clone(), voices[current].meter, voices[current].unit);
            current = voice_index(&mut voices, &id, &k, m, u, clef);
            if !name.is_empty() && name != id {
                voices[current].name = name;
            }
            rest = after;
        }
    }
    for v in &mut voices {
        v.close_measure();
    }
    if voices.iter().all(|v| v.measures.iter().all(|m| m.events.is_empty())) {
        return Err("ABC 曲调中没有音符".into());
    }
    Ok(write_musicxml(title, composer, &mut voices, meter, &key))
}

fn strip_comment(line: &str) -> &str {
    if line.starts_with("%%") {
        return "";
    }
    match line.find('%') {
        Some(i) if !line[..i].ends_with('\\') => &line[..i],
        _ => line,
    }
}
/// `X:value` header or body field lines (a letter, a colon). Music lines never start that way
/// except inline fields in brackets.
fn field(line: &str) -> Option<(char, &str)> {
    let mut chars = line.chars();
    let c = chars.next()?;
    (c.is_ascii_alphabetic() && chars.next() == Some(':')).then(|| (c, &line[2..]))
}
fn parse_voice(value: &str) -> (String, String, Clef) {
    let mut words = value.split_whitespace();
    let id = words.next().unwrap_or("1").to_string();
    let mut name = id.clone();
    let mut clef = Clef::Treble;
    let rest = value[value.find(&id).map_or(0, |i| i + id.len())..].to_string();
    for part in rest.split_whitespace() {
        if let Some(c) = part.strip_prefix("clef=") {
            clef = parse_clef(c);
        } else if part == "bass" {
            clef = Clef::Bass;
        }
    }
    for key in ["name=", "nm="] {
        if let Some(i) = rest.find(key) {
            let after = &rest[i + key.len()..];
            name = if let Some(stripped) = after.strip_prefix('"') {
                stripped.split('"').next().unwrap_or("").to_string()
            } else {
                after.split_whitespace().next().unwrap_or("").to_string()
            };
        }
    }
    (id, name, clef)
}
fn apply_field(v: &mut Voice, field: char, value: &str) -> Result<(), String> {
    match field {
        'K' => {
            let (key, clef) = parse_key(value)?;
            v.current.key = Some(key.clone());
            v.key = key;
            if let Some(c) = clef {
                v.current.clef = Some(c);
                v.clef = c;
            }
        }
        'M' => {
            v.meter = parse_meter(value);
            v.current.meter = Some(v.meter);
        }
        'L' => {
            if let Some(u) = parse_fraction(value) {
                v.unit = u.mul(Frac::new(4, 1));
            }
        }
        'Q' => v.current.tempo = parse_tempo(value),
        _ => {}
    }
    Ok(())
}

/// A note length suffix: `2`, `/`, `//`, `3/2`, `/4`.
fn read_length(chars: &[char], i: &mut usize) -> Frac {
    let mut num = String::new();
    while *i < chars.len() && chars[*i].is_ascii_digit() {
        num.push(chars[*i]);
        *i += 1;
    }
    let mut value = Frac::new(num.parse::<i64>().unwrap_or(1).max(1), 1);
    while *i < chars.len() && chars[*i] == '/' {
        *i += 1;
        let mut den = String::new();
        while *i < chars.len() && chars[*i].is_ascii_digit() {
            den.push(chars[*i]);
            *i += 1;
        }
        value = value.mul(Frac::new(1, den.parse::<i64>().unwrap_or(2).max(1)));
    }
    value
}
/// One pitch: accidentals, letter, octave marks. Returns the pitch and whether an accidental
/// was written.
fn read_pitch(v: &mut Voice, chars: &[char], i: &mut usize) -> Option<Pitch> {
    let start = *i;
    let mut written: Option<i8> = None;
    while *i < chars.len() && matches!(chars[*i], '^' | '_' | '=') {
        let delta = match chars[*i] {
            '^' => 1,
            '_' => -1,
            _ => 0,
        };
        written = Some(if chars[*i] == '=' { 0 } else { written.unwrap_or(0) + delta });
        *i += 1;
    }
    let letter = *chars.get(*i)?;
    let upper = letter.to_ascii_uppercase();
    let Some(step) = STEPS.iter().position(|&s| s == upper) else {
        *i = start;
        return None;
    };
    *i += 1;
    let mut octave: i8 = if letter.is_ascii_lowercase() { 5 } else { 4 };
    while *i < chars.len() && matches!(chars[*i], '\'' | ',') {
        octave += if chars[*i] == '\'' { 1 } else { -1 };
        *i += 1;
    }
    let alter = match written {
        Some(a) => {
            v.bar_alters.insert((step, octave), a);
            a
        }
        None => v.bar_alters.get(&(step, octave)).copied().unwrap_or(v.key.alters[step]),
    };
    Some(Pitch { step, alter, octave })
}
fn note_event(pitches: Vec<Pitch>, duration: Frac, grace: bool) -> Event {
    let n = pitches.len();
    Event {
        pitches,
        duration,
        tuplet: None,
        grace,
        visible: true,
        tie_start: vec![false; n],
        tie_stop: vec![false; n],
        harmony: None,
        lyric: None,
        lyric_target: false,
    }
}

fn parse_music(v: &mut Voice, line: &str) -> Result<(), String> {
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            ' ' | '\t' | '`' | ')' => i += 1,
            // A slur start, unless a tuplet count follows.
            '(' if !chars.get(i + 1).is_some_and(|d| d.is_ascii_digit()) => i += 1,
            '(' => {
                // Tuplet (p:q:r
                i += 1;
                let mut nums = vec![String::new()];
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == ':') {
                    if chars[i] == ':' {
                        nums.push(String::new());
                    } else {
                        nums.last_mut().unwrap().push(chars[i]);
                    }
                    i += 1;
                }
                let p: u32 = nums[0].parse().unwrap_or(3);
                let default_q = match p {
                    2 | 4 | 8 => 3,
                    3 | 6 => 2,
                    _ => {
                        if v.meter.compound() {
                            3
                        } else {
                            2
                        }
                    }
                };
                let q = nums.get(1).and_then(|s| s.parse().ok()).unwrap_or(default_q);
                let r = nums.get(2).and_then(|s| s.parse().ok()).unwrap_or(p);
                if (2..=9).contains(&p) && q > 0 {
                    v.tuplet = Some((p, q, r.max(1)));
                }
            }
            '"' => {
                let end = chars[i + 1..].iter().position(|&c| c == '"').map_or(chars.len(), |p| i + 1 + p);
                let text: String = chars[i + 1..end.min(chars.len())].iter().collect();
                if let Some(h) = parse_chord_symbol(&text) {
                    v.pending_harmony = Some(h);
                }
                i = end + 1;
            }
            '!' | '+' => {
                // !decoration! or +decoration+
                let end = chars[i + 1..].iter().position(|&d| d == c).map_or(chars.len(), |p| i + 1 + p);
                i = end + 1;
            }
            '.' | '~' | 'H' | 'L' | 'M' | 'O' | 'P' | 'S' | 'T' | 'u' | 'v' => i += 1,
            '{' => {
                let end = chars[i + 1..].iter().position(|&d| d == '}').map_or(chars.len(), |p| i + 1 + p);
                let mut j = i + 1;
                while j < end {
                    if chars[j] == '/' {
                        j += 1;
                        continue;
                    }
                    if let Some(p) = read_pitch(v, &chars, &mut j) {
                        let _ = read_length(&chars, &mut j);
                        v.push(note_event(vec![p], Frac::new(1, 2), true));
                    } else {
                        j += 1;
                    }
                }
                i = end + 1;
            }
            '[' if chars.get(i + 1).is_some_and(|d| d.is_ascii_digit()) => {
                i += 1;
                let mut number = String::new();
                while i < chars.len() && (chars[i].is_ascii_digit() || matches!(chars[i], ',' | '-')) {
                    number.push(chars[i]);
                    i += 1;
                }
                start_ending(v, number);
            }
            '[' if chars.get(i + 2) == Some(&':') && chars.get(i + 1).is_some_and(char::is_ascii_alphabetic) => {
                let end = chars[i..].iter().position(|&d| d == ']').map_or(chars.len(), |p| i + p);
                let text: String = chars[i + 1..end].iter().collect();
                let (f, value) = (text.chars().next().unwrap(), &text[2..]);
                apply_field(v, f, value)?;
                i = end + 1;
            }
            '[' if chars.get(i + 1) == Some(&'|') => {
                i = read_bar(v, &chars, i);
            }
            '[' => {
                // Chord
                i += 1;
                let mut pitches = Vec::new();
                let mut inner = None;
                let mut ties = Vec::new();
                while i < chars.len() && chars[i] != ']' {
                    if let Some(p) = read_pitch(v, &chars, &mut i) {
                        let len = read_length(&chars, &mut i);
                        inner.get_or_insert(len);
                        let tie = chars.get(i) == Some(&'-');
                        if tie {
                            i += 1;
                        }
                        ties.push(tie);
                        pitches.push(p);
                    } else {
                        i += 1;
                    }
                }
                i += 1;
                let outer = read_length(&chars, &mut i);
                let tie_all = chars.get(i) == Some(&'-');
                if tie_all {
                    i += 1;
                }
                if pitches.is_empty() {
                    continue;
                }
                let duration = inner.unwrap_or(Frac::new(1, 1)).mul(outer).mul(v.unit);
                let mut event = note_event(pitches, duration, false);
                event.tie_start = ties.iter().map(|t| *t || tie_all).collect();
                finish_note(v, event);
            }
            '|' | ':' => {
                i = read_bar(v, &chars, i);
            }
            'z' | 'x' | 'Z' | 'X' => {
                i += 1;
                let measure_rest = c.is_ascii_uppercase();
                let len = read_length(&chars, &mut i);
                if measure_rest {
                    let bars = len.n.max(1);
                    let length = v.meter.measure().unwrap_or(Frac::new(4, 1));
                    for b in 0..bars {
                        let mut e = note_event(Vec::new(), length, false);
                        e.visible = c == 'Z';
                        v.push(e);
                        if b + 1 < bars {
                            v.close_measure();
                        }
                    }
                } else {
                    let mut e = note_event(Vec::new(), len.mul(v.unit), false);
                    e.visible = c == 'z';
                    finish_note(v, e);
                }
            }
            '>' | '<' => {
                let mut count = 0;
                while i < chars.len() && chars[i] == c {
                    count += 1;
                    i += 1;
                }
                let small = Frac::new(1, 1 << count);
                let big = Frac::new(2, 1).sub(small);
                let (before, after) = if c == '>' { (big, small) } else { (small, big) };
                if let Some(last) = v.current.events.iter_mut().rev().find(|e| !e.grace) {
                    last.duration = last.duration.mul(before);
                }
                v.broken_next = Some(after);
            }
            _ => {
                let mut j = i;
                if let Some(p) = read_pitch(v, &chars, &mut j) {
                    i = j;
                    let len = read_length(&chars, &mut i);
                    let tie = chars.get(i) == Some(&'-');
                    if tie {
                        i += 1;
                    }
                    let mut event = note_event(vec![p], len.mul(v.unit), false);
                    event.tie_start = vec![tie];
                    finish_note(v, event);
                } else {
                    i += 1;
                }
            }
        }
    }
    Ok(())
}
/// Push a note or rest; ties started here are matched by the next note of the same pitch.
fn finish_note(v: &mut Voice, event: Event) {
    let ties: Vec<(usize, i8)> = event
        .pitches
        .iter()
        .zip(&event.tie_start)
        .filter(|(_, t)| **t)
        .map(|(p, _)| (p.step, p.octave))
        .collect();
    v.push(event);
    v.pending_ties = ties;
}
fn start_ending(v: &mut Voice, number: String) {
    if v.active_ending {
        // The previous ending ends at this bar.
        if let Some(last) = v.measures.last_mut() {
            last.ending_stop.get_or_insert("stop");
        }
    }
    v.current.ending_start = Some(number);
    v.active_ending = true;
}
/// A bar line at `i`: `|`, `||`, `|]`, `[|`, `|:`, `:|`, `::`, `:|:`, `|1`, `:|2`, `|[1`.
fn read_bar(v: &mut Voice, chars: &[char], start: usize) -> usize {
    let mut i = start;
    let mut text = String::new();
    while i < chars.len() && matches!(chars[i], '|' | ':' | '[' | ']') {
        // `[1` after a bar is an ending, `[K:` an inline field.
        if chars[i] == '[' && chars.get(i + 1).is_some_and(|c| !matches!(c, '|')) {
            break;
        }
        text.push(chars[i]);
        i += 1;
    }
    let backward = text.starts_with(':') && text.len() > 1;
    let forward = text.ends_with(':') && text.len() > 1;
    let double = text.contains("||") || text.contains("|]") || text.contains("[|");
    v.current.backward_repeat |= backward;
    v.current.double_bar |= double && !backward;
    v.current.final_bar |= text.contains("|]");
    if v.active_ending && (backward || double) {
        v.current.ending_stop = Some(if backward { "stop" } else { "discontinue" });
        v.active_ending = false;
    }
    v.close_measure();
    v.current.forward_repeat |= forward;
    // `|1` or `:|2`: an ending number right after the bar.
    let mut number = String::new();
    while i < chars.len() && (chars[i].is_ascii_digit() || (!number.is_empty() && matches!(chars[i], ',' | '-'))) {
        number.push(chars[i]);
        i += 1;
    }
    if !number.is_empty() {
        start_ending(v, number);
    }
    i
}

/// A chord symbol such as `C`, `Am7`, `F#m7b5`, `Bb/D`, `Gsus4`. Text annotations start with
/// a placement mark (^ _ < > @) and are not chords.
fn parse_chord_symbol(text: &str) -> Option<Harmony> {
    let t = text.trim();
    let mut chars = t.chars();
    let root = chars.next()?;
    if !('A'..='G').contains(&root) {
        return None;
    }
    let rest = chars.as_str();
    let (alter, rest) = match rest.chars().next() {
        Some('#') | Some('♯') => (1, &rest[rest.chars().next().unwrap().len_utf8()..]),
        Some('b') | Some('♭') if !rest.starts_with("b5") || rest.len() > 2 => {
            (-1, &rest[rest.chars().next().unwrap().len_utf8()..])
        }
        _ => (0, rest),
    };
    let (quality, bass) = match rest.split_once('/') {
        Some((q, b)) => (q, Some(b)),
        None => (rest, None),
    };
    let kind = match quality {
        "" | "maj" | "M" => "major",
        "m" | "min" | "-" => "minor",
        "7" => "dominant",
        "maj7" | "M7" | "Δ" | "Δ7" | "ma7" => "major-seventh",
        "m7" | "min7" | "-7" => "minor-seventh",
        "dim" | "°" | "o" => "diminished",
        "dim7" | "°7" | "o7" => "diminished-seventh",
        "m7b5" | "ø" | "ø7" | "-7b5" => "half-diminished",
        "aug" | "+" => "augmented",
        "sus4" | "sus" => "suspended-fourth",
        "sus2" => "suspended-second",
        "6" => "major-sixth",
        "m6" => "minor-sixth",
        "9" => "dominant-ninth",
        "maj9" | "M9" => "major-ninth",
        "m9" => "minor-ninth",
        "11" => "dominant-11th",
        "13" => "dominant-13th",
        "mmaj7" | "m(maj7)" | "mM7" => "major-minor",
        "7sus4" => "suspended-fourth",
        q if q.chars().all(|c| c.is_ascii_alphanumeric() || "#b+-()".contains(c)) => "other",
        _ => return None,
    };
    let bass = match bass {
        Some(b) => {
            let mut bc = b.chars();
            let step = bc.next().filter(|c| ('A'..='G').contains(c))?;
            let alter = match bc.next() {
                Some('#') | Some('♯') => 1,
                Some('b') | Some('♭') => -1,
                None => 0,
                _ => return None,
            };
            Some((step, alter))
        }
        None => None,
    };
    Some(Harmony { root: (root, alter), kind, text: quality.to_string(), bass })
}

/// `w:` syllables to the lyric targets of the voice's last music line.
fn assign_lyrics(v: &mut Voice, value: &str) {
    // Tokens: syllables, `-` breaks, `_` holds, `*` skips, `|` bar advances.
    let mut tokens: Vec<(String, bool)> = Vec::new(); // (syllable, continues with hyphen)
    let chars: Vec<char> = value.chars().collect();
    let mut i = 0;
    let mut word = String::new();
    let flush = |word: &mut String, tokens: &mut Vec<(String, bool)>, hyphen: bool| {
        if !word.is_empty() {
            tokens.push((std::mem::take(word), hyphen));
        }
    };
    while i < chars.len() {
        match chars[i] {
            ' ' | '\t' => flush(&mut word, &mut tokens, false),
            '-' => {
                if word.is_empty() {
                    if let Some(last) = tokens.last_mut() {
                        last.1 = true;
                    }
                } else {
                    flush(&mut word, &mut tokens, true);
                }
            }
            '_' => {
                flush(&mut word, &mut tokens, false);
                tokens.push(("_".into(), false));
            }
            '*' => {
                flush(&mut word, &mut tokens, false);
                tokens.push((String::new(), false));
            }
            '|' => flush(&mut word, &mut tokens, false),
            '~' => word.push(' '),
            '\\' if chars.get(i + 1) == Some(&'-') => {
                word.push('-');
                i += 1;
            }
            c => word.push(c),
        }
        i += 1;
    }
    flush(&mut word, &mut tokens, false);
    let targets = v.line_targets.clone();
    let mut previous_hyphen = false;
    let mut t = 0;
    for (text, hyphen) in tokens {
        if t >= targets.len() {
            break;
        }
        if text == "_" {
            t += 1;
            continue;
        }
        let (m, e) = targets[t];
        t += 1;
        if text.is_empty() {
            previous_hyphen = false;
            continue;
        }
        let syllabic = match (previous_hyphen, hyphen) {
            (false, false) => "single",
            (false, true) => "begin",
            (true, true) => "middle",
            (true, false) => "end",
        };
        previous_hyphen = hyphen;
        let measure = if m < v.measures.len() { &mut v.measures[m] } else { &mut v.current };
        if let Some(event) = measure.events.get_mut(e) {
            event.lyric = Some((syllabic, text));
        }
    }
}

const TYPES: [(&str, i64, i64); 8] = [
    ("whole", 4, 1),
    ("half", 2, 1),
    ("quarter", 1, 1),
    ("eighth", 1, 2),
    ("16th", 1, 4),
    ("32nd", 1, 8),
    ("64th", 1, 16),
    ("128th", 1, 32),
];
/// Split a duration (quarters, before tuplet scaling) into printable values with dots.
fn printable(duration: Frac) -> Vec<(Frac, &'static str, u8)> {
    let mut out = Vec::new();
    let mut left = duration;
    while left.n > 0 && out.len() < 16 {
        let mut chosen = None;
        'search: for &(name, n, d) in &TYPES {
            let base = Frac::new(n, d);
            for dots in (0..=2u8).rev() {
                // base * (2 - 1/2^dots)
                let value = base.mul(Frac::new((1 << (dots + 1)) - 1, 1 << dots));
                if !left.lt(value) {
                    chosen = Some((value, name, dots));
                    break 'search;
                }
            }
        }
        let Some((value, name, dots)) = chosen else { break };
        out.push((value, name, dots));
        left = left.sub(value);
    }
    out
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}
fn lcm(a: i64, b: i64) -> i64 {
    a / gcd(a, b) * b
}

fn write_musicxml(title: Option<String>, composer: Option<String>, voices: &mut [Voice], meter: Meter, key: &Key) -> String {
    // Every voice gets the same number of measures (shorter ones end with measure rests).
    let count = voices.iter().map(|v| v.measures.len()).max().unwrap_or(0);
    for v in voices.iter_mut() {
        while v.measures.len() < count {
            let length = v.meter.measure().unwrap_or(Frac::new(4, 1));
            let mut m = Measure::default();
            let mut e = note_event(Vec::new(), length, false);
            e.visible = false;
            m.events.push(e);
            v.measures.push(m);
        }
    }
    let mut divisions = 1i64;
    for v in voices.iter() {
        for m in &v.measures {
            for e in &m.events {
                let base = match e.tuplet {
                    Some((p, q)) => e.duration.mul(Frac::new(p as i64, q as i64)),
                    None => e.duration,
                };
                for (value, _, _) in printable(base) {
                    let scaled = match e.tuplet {
                        Some((p, q)) => value.mul(Frac::new(q as i64, p as i64)),
                        None => value,
                    };
                    divisions = lcm(divisions, scaled.d);
                }
            }
        }
    }
    let divisions = divisions.min(1 << 20);
    let mut x = String::new();
    x.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<score-partwise version=\"4.0\">\n");
    if let Some(t) = &title {
        let _ = writeln!(x, "<work><work-title>{}</work-title></work>", xml_escape(t));
    }
    if let Some(c) = &composer {
        let _ = writeln!(x, "<identification><creator type=\"composer\">{}</creator></identification>", xml_escape(c));
    }
    x.push_str("<part-list>\n");
    for (i, v) in voices.iter().enumerate() {
        let _ = writeln!(x, "<score-part id=\"P{}\"><part-name>{}</part-name></score-part>", i + 1, xml_escape(&v.name));
    }
    x.push_str("</part-list>\n");
    let pickup = meter
        .measure()
        .zip(voices.first().and_then(|v| v.measures.first()))
        .is_some_and(|(full, m)| m.duration().lt(full) && voices.first().is_some_and(|v| v.measures.len() > 1));
    for (pi, v) in voices.iter().enumerate() {
        let _ = writeln!(x, "<part id=\"P{}\">", pi + 1);
        let mut measure_meter = meter;
        for (mi, m) in v.measures.iter().enumerate() {
            let number = if pickup { mi } else { mi + 1 };
            let implicit = if pickup && mi == 0 { " implicit=\"yes\"" } else { "" };
            let _ = writeln!(x, "<measure number=\"{number}\"{implicit}>");
            if m.forward_repeat || m.ending_start.is_some() {
                x.push_str("<barline location=\"left\">");
                if m.forward_repeat {
                    x.push_str("<bar-style>heavy-light</bar-style>");
                }
                if let Some(n) = &m.ending_start {
                    let number = n.replace('-', ",");
                    let _ = write!(x, "<ending number=\"{number}\" type=\"start\">{n}.</ending>");
                }
                if m.forward_repeat {
                    x.push_str("<repeat direction=\"forward\"/>");
                }
                x.push_str("</barline>\n");
            }
            let first = mi == 0;
            if first || m.key.is_some() || m.meter.is_some() || m.clef.is_some() {
                x.push_str("<attributes>");
                if first {
                    let _ = write!(x, "<divisions>{divisions}</divisions>");
                }
                if let Some(k) = m.key.as_ref().or(first.then_some(key)) {
                    let _ = write!(x, "<key><fifths>{}</fifths><mode>{}</mode></key>", k.fifths, k.mode);
                }
                if let Some(mt) = m.meter {
                    measure_meter = mt;
                }
                if first || m.meter.is_some() {
                    if let Meter::Sig(n, d) = measure_meter {
                        let _ = write!(x, "<time><beats>{n}</beats><beat-type>{d}</beat-type></time>");
                    }
                }
                let clef = m.clef.or(first.then_some(v.clef));
                if let Some(c) = clef {
                    let (sign, line) = match c {
                        Clef::Treble => ("G", 2),
                        Clef::Bass => ("F", 4),
                        Clef::Alto => ("C", 3),
                    };
                    let _ = write!(x, "<clef><sign>{sign}</sign><line>{line}</line></clef>");
                }
                x.push_str("</attributes>\n");
            }
            if let Some(bpm) = m.tempo {
                let bpm = (bpm * 100.0).round() / 100.0;
                let _ = writeln!(
                    x,
                    "<direction placement=\"above\"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{bpm}</per-minute></metronome></direction-type><sound tempo=\"{bpm}\"/></direction>"
                );
            }
            for e in &m.events {
                if let Some(h) = &e.harmony {
                    write_harmony(&mut x, h);
                }
                write_event(&mut x, e, divisions);
            }
            if m.backward_repeat || m.ending_stop.is_some() || m.final_bar || m.double_bar {
                x.push_str("<barline location=\"right\">");
                let style = if m.backward_repeat || m.final_bar { "light-heavy" } else { "light-light" };
                let _ = write!(x, "<bar-style>{style}</bar-style>");
                if let Some(kind) = m.ending_stop {
                    let number = v.measures[..=mi]
                        .iter()
                        .rev()
                        .find_map(|m| m.ending_start.clone())
                        .unwrap_or_else(|| "1".into())
                        .replace('-', ",");
                    let _ = write!(x, "<ending number=\"{number}\" type=\"{kind}\"/>");
                }
                if m.backward_repeat {
                    x.push_str("<repeat direction=\"backward\"/>");
                }
                x.push_str("</barline>\n");
            }
            x.push_str("</measure>\n");
        }
        x.push_str("</part>\n");
    }
    x.push_str("</score-partwise>\n");
    x
}

fn write_harmony(x: &mut String, h: &Harmony) {
    x.push_str("<harmony><root>");
    let _ = write!(x, "<root-step>{}</root-step>", h.root.0);
    if h.root.1 != 0 {
        let _ = write!(x, "<root-alter>{}</root-alter>", h.root.1);
    }
    let _ = write!(x, "</root><kind text=\"{}\">{}</kind>", xml_escape(&h.text), h.kind);
    if let Some((step, alter)) = h.bass {
        let _ = write!(x, "<bass><bass-step>{step}</bass-step>");
        if alter != 0 {
            let _ = write!(x, "<bass-alter>{alter}</bass-alter>");
        }
        x.push_str("</bass>");
    }
    x.push_str("</harmony>\n");
}

fn write_event(x: &mut String, e: &Event, divisions: i64) {
    let base = match e.tuplet {
        Some((p, q)) => e.duration.mul(Frac::new(p as i64, q as i64)),
        None => e.duration,
    };
    let parts = if e.grace { vec![(Frac::new(1, 2), "eighth", 0)] } else { printable(base) };
    let last = parts.len().saturating_sub(1);
    for (k, (value, name, dots)) in parts.iter().enumerate() {
        let scaled = match e.tuplet {
            Some((p, q)) => value.mul(Frac::new(q as i64, p as i64)),
            None => *value,
        };
        let duration = scaled.n * (divisions / scaled.d);
        // Split pieces are tied together; the original tie marks go to the outer pieces.
        let tie_out = |i: usize| k < last || e.tie_start.get(i).copied().unwrap_or(false);
        let tie_in = |i: usize| k > 0 || e.tie_stop.get(i).copied().unwrap_or(false);
        let notes: Vec<Option<&Pitch>> = if e.pitches.is_empty() { vec![None] } else { e.pitches.iter().map(Some).collect() };
        for (i, pitch) in notes.iter().enumerate() {
            x.push_str(if e.visible { "<note>" } else { "<note print-object=\"no\">" });
            if e.grace {
                x.push_str("<grace slash=\"yes\"/>");
            }
            if i > 0 {
                x.push_str("<chord/>");
            }
            match pitch {
                Some(p) => {
                    let _ = write!(x, "<pitch><step>{}</step>", STEPS[p.step]);
                    if p.alter != 0 {
                        let _ = write!(x, "<alter>{}</alter>", p.alter);
                    }
                    let _ = write!(x, "<octave>{}</octave></pitch>", p.octave);
                }
                None => x.push_str("<rest/>"),
            }
            if !e.grace {
                let _ = write!(x, "<duration>{duration}</duration>");
            }
            if pitch.is_some() && !e.grace {
                if tie_in(i) {
                    x.push_str("<tie type=\"stop\"/>");
                }
                if tie_out(i) {
                    x.push_str("<tie type=\"start\"/>");
                }
            }
            x.push_str("<voice>1</voice>");
            let _ = write!(x, "<type>{name}</type>");
            for _ in 0..*dots {
                x.push_str("<dot/>");
            }
            if let Some((p, q)) = e.tuplet {
                let _ = write!(x, "<time-modification><actual-notes>{p}</actual-notes><normal-notes>{q}</normal-notes></time-modification>");
            }
            if pitch.is_some() && !e.grace && (tie_in(i) || tie_out(i)) {
                x.push_str("<notations>");
                if tie_in(i) {
                    x.push_str("<tied type=\"stop\"/>");
                }
                if tie_out(i) {
                    x.push_str("<tied type=\"start\"/>");
                }
                x.push_str("</notations>");
            }
            if i == 0 && k == 0 {
                if let Some((syllabic, text)) = &e.lyric {
                    let _ = write!(x, "<lyric number=\"1\"><syllabic>{syllabic}</syllabic><text>{}</text></lyric>", xml_escape(text));
                }
            }
            x.push_str("</note>\n");
        }
    }
}
