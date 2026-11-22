//! Chord labels in Harte syntax (`root:quality/bass`, as POP909 and MIREX use) and the two
//! display forms: chord name (`F♯7/A♯`) and movable-do degree in a key (`3⁷/♯5`).

/// The chord qualities the recogniser produces and the display understands. Labels outside
/// this vocabulary keep their text and display it unchanged.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Quality {
    Major,
    Minor,
    Dominant7,
    Major7,
    Minor7,
    Diminished,
    HalfDiminished7,
    Diminished7,
    Augmented,
    Sus2,
    Sus4,
    Sus4Flat7,
    Major6,
    Minor6,
    MinorMajor7,
}

impl Quality {
    pub const ALL: [Quality; 15] = [
        Quality::Major,
        Quality::Minor,
        Quality::Dominant7,
        Quality::Major7,
        Quality::Minor7,
        Quality::Diminished,
        Quality::HalfDiminished7,
        Quality::Diminished7,
        Quality::Augmented,
        Quality::Sus2,
        Quality::Sus4,
        Quality::Sus4Flat7,
        Quality::Major6,
        Quality::Minor6,
        Quality::MinorMajor7,
    ];
    /// Semitones above the root, root included.
    pub fn intervals(self) -> &'static [u8] {
        match self {
            Quality::Major => &[0, 4, 7],
            Quality::Minor => &[0, 3, 7],
            Quality::Dominant7 => &[0, 4, 7, 10],
            Quality::Major7 => &[0, 4, 7, 11],
            Quality::Minor7 => &[0, 3, 7, 10],
            Quality::Diminished => &[0, 3, 6],
            Quality::HalfDiminished7 => &[0, 3, 6, 10],
            Quality::Diminished7 => &[0, 3, 6, 9],
            Quality::Augmented => &[0, 4, 8],
            Quality::Sus2 => &[0, 2, 7],
            Quality::Sus4 => &[0, 5, 7],
            Quality::Sus4Flat7 => &[0, 5, 7, 10],
            Quality::Major6 => &[0, 4, 7, 9],
            Quality::Minor6 => &[0, 3, 7, 9],
            Quality::MinorMajor7 => &[0, 3, 7, 11],
        }
    }
    pub fn harte(self) -> &'static str {
        match self {
            Quality::Major => "maj",
            Quality::Minor => "min",
            Quality::Dominant7 => "7",
            Quality::Major7 => "maj7",
            Quality::Minor7 => "min7",
            Quality::Diminished => "dim",
            Quality::HalfDiminished7 => "hdim7",
            Quality::Diminished7 => "dim7",
            Quality::Augmented => "aug",
            Quality::Sus2 => "sus2",
            Quality::Sus4 => "sus4",
            Quality::Sus4Flat7 => "sus4(b7)",
            Quality::Major6 => "maj6",
            Quality::Minor6 => "min6",
            Quality::MinorMajor7 => "minmaj7",
        }
    }
    fn from_harte(value: &str) -> Option<Self> {
        Quality::ALL.into_iter().find(|q| q.harte() == value).or(match value {
            "" => Some(Quality::Major),
            "dom7" => Some(Quality::Dominant7),
            "6" => Some(Quality::Major6),
            "min(b7)" => Some(Quality::Minor7),
            "7sus4" => Some(Quality::Sus4Flat7),
            _ => None,
        })
    }
    /// The suffix after a chord name or a degree. Degrees write a dominant seventh as a
    /// superscript (`5⁷`), names as a plain `7` (`G7`).
    fn suffix(self, degree: bool) -> &'static str {
        match self {
            Quality::Major => "",
            Quality::Minor => "m",
            Quality::Dominant7 if degree => "⁷",
            Quality::Dominant7 => "7",
            Quality::Major7 => "maj7",
            Quality::Minor7 => "m7",
            Quality::Diminished => "°",
            Quality::HalfDiminished7 => "ø7",
            Quality::Diminished7 => "°7",
            Quality::Augmented => "+",
            Quality::Sus2 => "sus2",
            Quality::Sus4 => "sus4",
            Quality::Sus4Flat7 => "7sus4",
            Quality::Major6 => "6",
            Quality::Minor6 => "m6",
            Quality::MinorMajor7 => "m(maj7)",
        }
    }
    /// The MIREX major/minor class, for evaluation.
    pub fn major_minor(self) -> Option<bool> {
        match self {
            Quality::Major | Quality::Dominant7 | Quality::Major7 | Quality::Major6 => Some(true),
            Quality::Minor | Quality::Minor7 | Quality::Minor6 | Quality::MinorMajor7 => Some(false),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Chord {
    /// Pitch class of the root, 0 = C.
    pub root: u8,
    pub quality: Quality,
    /// Pitch class of the bass when it is not the root.
    pub bass: Option<u8>,
}

/// A key: tonic pitch class and mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Key {
    pub tonic: u8,
    pub minor: bool,
}

const SHARP_NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES: [&str; 12] = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

fn pitch_class(name: &str) -> Option<u8> {
    let mut chars = name.chars();
    let base: i32 = match chars.next()? {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return None,
    };
    let mut value = base;
    for c in chars {
        value += match c {
            '#' | '♯' => 1,
            'b' | '♭' => -1,
            _ => return None,
        };
    }
    Some(value.rem_euclid(12) as u8)
}

/// Harte bass degree (`3`, `b7`, `#5` …) relative to the root.
fn degree_semitones(value: &str) -> Option<u8> {
    let (accidental, digits) = match value.char_indices().find(|(_, c)| c.is_ascii_digit()) {
        Some((i, _)) => value.split_at(i),
        None => return None,
    };
    let base: i32 = match digits.parse::<u8>().ok()? {
        1 | 8 => 0,
        2 | 9 => 2,
        3 | 10 => 4,
        4 | 11 => 5,
        5 | 12 => 7,
        6 | 13 => 9,
        7 => 11,
        _ => return None,
    };
    let shift: i32 = accidental.chars().map(|c| if c == '#' { 1 } else { -1 }).sum();
    Some((base + shift).rem_euclid(12) as u8)
}

impl Chord {
    /// `C#:min7/b3`; `N` (no chord) is `None`, an unknown quality an error.
    pub fn parse(label: &str) -> Result<Option<Chord>, String> {
        let label = label.trim();
        if label == "N" || label == "X" || label.is_empty() {
            return Ok(None);
        }
        let (body, bass) = match label.split_once('/') {
            Some((body, bass)) => (body, Some(bass)),
            None => (label, None),
        };
        let (root, quality) = body.split_once(':').unwrap_or((body, ""));
        let root = pitch_class(root).ok_or_else(|| format!("和弦根音无法识别：{label}"))?;
        let quality = Quality::from_harte(quality).ok_or_else(|| format!("和弦性质无法识别：{label}"))?;
        let bass = match bass {
            Some(value) => Some((root + degree_semitones(value).ok_or_else(|| format!("低音无法识别：{label}"))?) % 12),
            None => None,
        }
        .filter(|&b| b != root);
        Ok(Some(Chord { root, quality, bass }))
    }

    pub fn harte(self) -> String {
        let mut out = format!("{}:{}", SHARP_NAMES[usize::from(self.root)], self.quality.harte());
        if let Some(bass) = self.bass {
            const DEGREES: [&str; 12] = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];
            out.push('/');
            out.push_str(DEGREES[usize::from((bass + 12 - self.root) % 12)]);
        }
        out
    }

    /// `F♯7/A♯`; sharps or flats follow the key signature.
    pub fn name(self, key: Option<Key>) -> String {
        let flats = key.is_some_and(Key::prefers_flats);
        let spell = |pc: u8| {
            let names = if flats { FLAT_NAMES } else { SHARP_NAMES };
            names[usize::from(pc)].replace('#', "♯").replace('b', "♭")
        };
        let mut out = spell(self.root) + self.quality.suffix(false);
        if let Some(bass) = self.bass {
            out.push('/');
            out.push_str(&spell(bass));
        }
        out
    }

    /// Movable-do degree in `key`: `6m7`, `3⁷/♯5`, `7°/4`, `1/3`. In a minor key the degrees
    /// count from the relative major, as numbered notation does (the tonic is `6m`).
    pub fn degree(self, key: Key) -> String {
        let mut out = key.degree(self.root) + self.quality.suffix(true);
        if let Some(bass) = self.bass {
            out.push('/');
            out.push_str(&key.chord_tone_degree(self.root, bass));
        }
        out
    }
}

impl Key {
    /// `Gb:maj`, `A:min`, also `C major` / `a minor`.
    pub fn parse(label: &str) -> Option<Key> {
        let label = label.trim();
        let (tonic, mode) = label
            .split_once(':')
            .or_else(|| label.split_once(' '))
            .unwrap_or((label, "maj"));
        let mut tonic = tonic.to_string();
        if let Some(first) = tonic.get(..1) {
            tonic.replace_range(..1, &first.to_uppercase());
        }
        let minor = matches!(mode.trim().to_lowercase().as_str(), "min" | "minor" | "m");
        Some(Key { tonic: pitch_class(&tonic)?, minor })
    }
    pub fn harte(self) -> String {
        let names = if self.prefers_flats() { FLAT_NAMES } else { SHARP_NAMES };
        format!("{}:{}", names[usize::from(self.tonic)], if self.minor { "min" } else { "maj" })
    }
    /// Tonic of the major key with the same signature.
    pub fn major_tonic(self) -> u8 {
        if self.minor { (self.tonic + 3) % 12 } else { self.tonic }
    }
    /// Signature in fifths: positive sharps, negative flats (G♭ and D♭ major rather than F♯, C♯).
    pub fn fifths(self) -> i8 {
        const FIFTHS: [i8; 12] = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5];
        FIFTHS[usize::from(self.major_tonic())]
    }
    fn prefers_flats(self) -> bool {
        self.fifths() < 0
    }
    /// A chord tone spelled from the root's letter: the third of F♯ in D major is ♯5 (A♯),
    /// not ♭6.
    fn chord_tone_degree(self, root: u8, tone: u8) -> String {
        const SCALE: [i32; 7] = [0, 2, 4, 5, 7, 9, 11];
        const ROOT_STEPS: [usize; 12] = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
        let tonic = self.major_tonic();
        let root_step = ROOT_STEPS[usize::from((root + 12 - tonic) % 12)];
        let letters = match (tone + 12 - root) % 12 {
            1 | 2 => 1,
            3 | 4 => 2,
            5 => 3,
            6 | 7 | 8 => 4,
            9 => 5,
            10 | 11 => 6,
            _ => 0,
        };
        let step = (root_step + letters) % 7;
        let shift = (i32::from((tone + 12 - tonic) % 12) - SCALE[step] + 18).rem_euclid(12) - 6;
        let accidental = match shift {
            -2 => "𝄫",
            -1 => "♭",
            1 => "♯",
            2 => "𝄪",
            _ => "",
        };
        format!("{accidental}{}", step + 1)
    }
    fn degree(self, pc: u8) -> String {
        const DEGREES: [&str; 12] = ["1", "♭2", "2", "♭3", "3", "4", "♯4", "5", "♭6", "6", "♭7", "7"];
        DEGREES[usize::from((pc + 12 - self.major_tonic()) % 12)].into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_names_and_degrees_follow_the_reference_display() {
        let d = Key::parse("D:maj").unwrap();
        let chord = |s: &str| Chord::parse(s).unwrap().unwrap();
        assert_eq!(chord("F#:7/3").name(Some(d)), "F♯7/A♯");
        assert_eq!(chord("F#:7/3").degree(d), "3⁷/♯5");
        assert_eq!(chord("C#:dim/b5").degree(d), "7°/4");
        assert_eq!(chord("C#:dim/b5").name(Some(d)), "C♯°/G");
        assert_eq!(chord("D:maj/3").degree(d), "1/3");
        assert_eq!(chord("B:min7").degree(d), "6m7");
        assert_eq!(chord("D:sus2").degree(d), "1sus2");
        assert_eq!(Chord::parse("N").unwrap(), None);
        assert_eq!(chord("Bb:min").name(Key::parse("Gb:maj")), "B♭m");
        assert_eq!(chord("Bb:min/b3").harte(), "A#:min/b3");
        assert_eq!(chord("A:min").degree(Key::parse("A:min").unwrap()), "6m");
    }
}
