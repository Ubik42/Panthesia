//! Harmony analysis of a performance (current-plan 3.3): keys and chords on the performance's
//! tick grid. Pure functions; results become `generated` layers.
//!
//! Keys: duration-weighted pitch-class profiles per measure (a five-measure window) correlated
//! with the Albrecht–Shanahan (2013) key profiles (85% on POP909 against 78.5% for Krumhansl–Kessler), smoothed by Viterbi with a cost per key change.
//! Baseline on all 909 POP909 songs against `chord_midi.txt`/`key_audio.txt` (2026-11-22):
//! root 84.7%, MajMin 79.9%, main key 84.9%; about 2.4 ms per song.
//!
//! Chords: one pitch-class profile per beat with the bass weighted, scored against chord
//! templates (with a small bonus for chords of the key), smoothed by Viterbi with a change cost
//! that is lowest at downbeats; equal neighbours merge and the segment's bass gives inversions.
pub mod harte;

use harte::{Chord, Key, Quality};
use panthesia_music::{Performance, musical_time::MusicalTime};

/// A sounding note on the tick grid.
#[derive(Clone, Copy, Debug)]
pub struct Note {
    pub start: u64,
    pub end: u64,
    pub pitch: u8,
}

/// Pitched notes of a performance (drums excluded), from key-down to key-up: a held pedal
/// would carry the previous chord into the next one.
pub fn notes(performance: &Performance) -> Vec<Note> {
    performance
        .notes
        .iter()
        .filter(|n| n.channel != 9 && n.release_tick > n.start_tick)
        .map(|n| Note { start: n.start_tick, end: n.release_tick, pitch: n.note })
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct KeySegment {
    pub tick: u64,
    pub key: Key,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChordSegment {
    pub tick: u64,
    pub end: u64,
    /// `None` is "no chord".
    pub chord: Option<Chord>,
}

/// Duration-weighted pitch classes of the notes sounding in `[start, end)`. `register` also
/// weights low notes up and high ones down: chords live in the accompaniment, the top line is
/// mostly melody (+0.7 points MajMin on POP909); key finding uses all notes alike.
fn profile(notes: &[Note], start: u64, end: u64, register: bool) -> [f64; 12] {
    let mut out = [0.0; 12];
    for n in notes.iter().take_while(|n| n.start < end) {
        let overlap = n.end.min(end).saturating_sub(n.start.max(start));
        if overlap > 0 {
            let weight = if register { (1.0 + (72.0 - f64::from(n.pitch)) / 36.0).clamp(0.5, 1.6) } else { 1.0 };
            out[usize::from(n.pitch % 12)] += overlap as f64 * weight;
        }
    }
    out
}

/// Notes sorted by start; overlap queries scan from the first note that can still sound.
struct Timeline {
    notes: Vec<Note>,
    longest: u64,
}
impl Timeline {
    fn new(notes: &[Note]) -> Self {
        let mut notes = notes.to_vec();
        notes.sort_by_key(|n| n.start);
        let longest = notes.iter().map(|n| n.end - n.start).max().unwrap_or(0);
        Self { notes, longest }
    }
    fn around(&self, start: u64) -> &[Note] {
        let from = self.notes.partition_point(|n| n.start + self.longest < start);
        &self.notes[from..]
    }
    fn profile(&self, start: u64, end: u64, register: bool) -> [f64; 12] {
        profile(self.around(start), start, end, register)
    }
    /// Pitch class of the lowest note that sounds for a quarter of the span or more
    /// (or of the lowest note at all).
    fn bass(&self, start: u64, end: u64) -> Option<u8> {
        let span = end.saturating_sub(start).max(1);
        let mut lowest: Option<(u8, bool)> = None;
        for n in self.around(start).iter().take_while(|n| n.start < end) {
            let overlap = n.end.min(end).saturating_sub(n.start.max(start));
            if overlap == 0 {
                continue;
            }
            let held = overlap * 4 >= span;
            lowest = match lowest {
                None => Some((n.pitch, held)),
                Some((p, h)) if (held && !h) || (held == h && n.pitch < p) => Some((n.pitch, held)),
                keep => keep,
            };
        }
        lowest.map(|(p, _)| p % 12)
    }
}

const MAJOR_PROFILE: [f64; 12] = [0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.080, 0.008, 0.081];
const MINOR_PROFILE: [f64; 12] = [0.220, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052];

fn correlation(a: &[f64; 12], b: &[f64; 12]) -> f64 {
    let mean = |v: &[f64; 12]| v.iter().sum::<f64>() / 12.0;
    let (ma, mb) = (mean(a), mean(b));
    let (mut num, mut da, mut db) = (0.0, 0.0, 0.0);
    for i in 0..12 {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma).powi(2);
        db += (b[i] - mb).powi(2);
    }
    if da == 0.0 || db == 0.0 { 0.0 } else { num / (da * db).sqrt() }
}

/// Key changes on measure boundaries. Empty when the performance has no pitched notes.
pub fn keys(notes: &[Note], time: &MusicalTime) -> Vec<KeySegment> {
    const WINDOW: usize = 2;
    const CHANGE: f64 = 1.5;
    let timeline = Timeline::new(notes);
    let bars: Vec<[f64; 12]> = time.measures.iter().map(|m| timeline.profile(m.start_tick, m.end_tick, false)).collect();
    if bars.is_empty() || bars.iter().all(|b| b.iter().all(|v| *v == 0.0)) {
        return vec![];
    }
    let states: Vec<Key> = (0..24).map(|i| Key { tonic: i % 12, minor: i >= 12 }).collect();
    let template = |key: Key, pc: usize| {
        let profile = if key.minor { &MINOR_PROFILE } else { &MAJOR_PROFILE };
        profile[(pc + 12 - usize::from(key.tonic)) % 12]
    };
    let emissions: Vec<Vec<f64>> = (0..bars.len())
        .map(|i| {
            let mut window = [0.0; 12];
            for bar in &bars[i.saturating_sub(WINDOW)..(i + WINDOW + 1).min(bars.len())] {
                for pc in 0..12 {
                    window[pc] += bar[pc];
                }
            }
            states
                .iter()
                .map(|&key| correlation(&window, &std::array::from_fn(|pc| template(key, pc))))
                .collect()
        })
        .collect();
    let path = viterbi(&emissions, |_| CHANGE);
    let mut out: Vec<KeySegment> = Vec::new();
    for (i, state) in path.into_iter().enumerate() {
        let key = states[state];
        if out.last().is_none_or(|last| last.key != key) {
            out.push(KeySegment { tick: if out.is_empty() { 0 } else { time.measures[i].start_tick }, key });
        }
    }
    out
}

/// Average number of notes sounding while anything sounds. A single melodic line is about 1;
/// chord recognition needs harmony to recognise (the engine asks for 1.3 or more).
pub fn polyphony(notes: &[Note]) -> f64 {
    let mut edges: Vec<(u64, i32)> = notes.iter().flat_map(|n| [(n.start, 1), (n.end, -1)]).collect();
    edges.sort();
    let (mut sounding, mut covered, mut total, mut previous) = (0i32, 0u64, 0u64, 0u64);
    for (tick, change) in edges {
        if sounding > 0 {
            covered += tick - previous;
            total += (tick - previous) * sounding as u64;
        }
        sounding += change;
        previous = tick;
    }
    if covered == 0 { 0.0 } else { total as f64 / covered as f64 }
}

/// The key that lasts longest, for a song-level key.
pub fn main_key(notes: &[Note], time: &MusicalTime) -> Option<Key> {
    let segments = keys(notes, time);
    let end = notes.iter().map(|n| n.end).max().unwrap_or(0).max(time.measures.last().map_or(0, |m| m.end_tick));
    let mut spans: Vec<(Key, u64)> = Vec::new();
    for (i, segment) in segments.iter().enumerate() {
        let until = segments.get(i + 1).map_or(end, |next| next.tick);
        match spans.iter_mut().find(|(k, _)| *k == segment.key) {
            Some((_, span)) => *span += until.saturating_sub(segment.tick),
            None => spans.push((segment.key, until.saturating_sub(segment.tick))),
        }
    }
    spans.into_iter().max_by_key(|(_, span)| *span).map(|(key, _)| key)
}

/// Best state sequence for per-step state scores, with a cost (by step) for changing state.
fn viterbi(emissions: &[Vec<f64>], change_cost: impl Fn(usize) -> f64) -> Vec<usize> {
    let Some(first) = emissions.first() else { return vec![] };
    let states = first.len();
    let mut score = first.clone();
    let mut back: Vec<Vec<usize>> = Vec::with_capacity(emissions.len());
    back.push((0..states).collect());
    for (step, emission) in emissions.iter().enumerate().skip(1) {
        let (best, best_score) = score
            .iter()
            .enumerate()
            .fold((0, f64::NEG_INFINITY), |acc, (i, &s)| if s > acc.1 { (i, s) } else { acc });
        let cost = change_cost(step);
        let mut from = Vec::with_capacity(states);
        let mut next = Vec::with_capacity(states);
        for state in 0..states {
            let (origin, value) = if score[state] >= best_score - cost { (state, score[state]) } else { (best, best_score - cost) };
            from.push(origin);
            next.push(value + emission[state]);
        }
        back.push(from);
        score = next;
    }
    let mut state = score.iter().enumerate().fold((0, f64::NEG_INFINITY), |acc, (i, &s)| if s > acc.1 { (i, s) } else { acc }).0;
    let mut path = vec![0; emissions.len()];
    for step in (0..emissions.len()).rev() {
        path[step] = state;
        state = back[step][state];
    }
    path
}

/// Beats of the grid: the denominator unit, or a dotted unit in compound meters.
fn beats(time: &MusicalTime) -> Vec<(u64, u64, bool, bool)> {
    let mut out = Vec::new();
    for m in &time.measures {
        let unit = u64::from(time.ppq) * 4 / u64::from(m.denominator.max(1));
        let compound = m.denominator == 8 && m.numerator > 3 && m.numerator % 3 == 0;
        let beat = (if compound { unit * 3 } else { unit }).max(1);
        let count = ((m.end_tick - m.start_tick) / beat).max(1);
        let half = count / 2;
        for i in 0..count {
            let start = m.start_tick + i * beat;
            let end = if i + 1 == count { m.end_tick } else { start + beat };
            out.push((start, end, i == 0, half > 0 && i == half));
        }
    }
    out
}

fn tone_weight(quality: Quality, index: usize) -> f64 {
    match (quality, index) {
        (_, 0) => 1.0,
        (_, 1) => 0.95,
        (_, 2) => 0.75,
        _ => 0.85,
    }
}

/// Chord segments over the whole grid, `N` where nothing sounds. `keys` (from [`keys`]) give a
/// small preference to the chords of the key.
pub fn chords(notes: &[Note], time: &MusicalTime, keys: &[KeySegment]) -> Vec<ChordSegment> {
    const OUTSIDE: f64 = 0.35;
    const BASS_ROOT: f64 = 0.2;
    const BASS_TONE: f64 = 0.06;
    const DIATONIC: f64 = 0.06;
    let timeline = Timeline::new(notes);
    let grid = beats(time);
    if grid.is_empty() {
        return vec![];
    }
    let mut states: Vec<Option<Chord>> = vec![None];
    for root in 0..12 {
        for quality in Quality::ALL {
            states.push(Some(Chord { root, quality, bass: None }));
        }
    }
    // Rarer chords need clearer evidence.
    let prior = |q: Quality| match q {
        Quality::Major | Quality::Minor => 0.0,
        Quality::Minor7 | Quality::Dominant7 | Quality::Major7 | Quality::Sus2 | Quality::Sus4 => 0.05,
        Quality::Sus4Flat7 | Quality::Major6 | Quality::Diminished => 0.08,
        _ => 0.12,
    };
    let key_at = |tick: u64| keys.iter().take_while(|k| k.tick <= tick).last().map(|k| k.key);
    let full = grid.iter().map(|(s, e, ..)| (e - s) as f64).fold(0.0, f64::max).max(1.0);
    let emissions: Vec<Vec<f64>> = grid
        .iter()
        .map(|&(start, end, ..)| {
            let raw = timeline.profile(start, end, true);
            let energy: f64 = raw.iter().sum::<f64>() / full;
            let total: f64 = raw.iter().sum();
            let bass = timeline.bass(start, end);
            // A thin beat (one passing melody note) says little: scale its evidence down.
            let confidence = energy / (energy + 0.75);
            let key = key_at(start);
            states
                .iter()
                .map(|state| match state {
                    None => if total == 0.0 { 0.5 } else { -0.4 * confidence },
                    Some(chord) => {
                        if total == 0.0 {
                            return -0.5;
                        }
                        let tones = chord.quality.intervals();
                        let mut inside = 0.0;
                        let mut covered = 0.0;
                        for (i, &interval) in tones.iter().enumerate() {
                            let value = raw[usize::from((chord.root + interval) % 12)] / total;
                            inside += tone_weight(chord.quality, i) * value;
                            covered += value;
                        }
                        let mut score = inside - OUTSIDE * (1.0 - covered) - prior(chord.quality);
                        if let Some(b) = bass {
                            if b == chord.root {
                                score += BASS_ROOT;
                            } else if tones.iter().any(|&i| (chord.root + i) % 12 == b) {
                                score += BASS_TONE;
                            }
                        }
                        if let Some(key) = key {
                            let scale: &[u8] = if key.minor { &[0, 2, 3, 5, 7, 8, 10, 11] } else { &[0, 2, 4, 5, 7, 9, 11] };
                            if tones.iter().all(|&i| scale.contains(&((chord.root + i + 12 - key.tonic) % 12))) {
                                score += DIATONIC;
                            }
                        }
                        score * confidence
                    }
                })
                .collect()
        })
        .collect();
    let path = viterbi(&emissions, |step| match grid[step] {
        (_, _, true, _) => 0.18,
        (_, _, _, true) => 0.3,
        _ => 0.45,
    });
    let mut out: Vec<ChordSegment> = Vec::new();
    for (step, state) in path.into_iter().enumerate() {
        let (start, end, ..) = grid[step];
        match out.last_mut() {
            Some(last) if last.chord == states[state] => last.end = end,
            _ => out.push(ChordSegment { tick: start, end, chord: states[state] }),
        }
    }
    for segment in &mut out {
        if let Some(chord) = &mut segment.chord {
            if let Some(bass) = timeline.bass(segment.tick, segment.end) {
                let tone = chord.quality.intervals().iter().any(|&i| (chord.root + i) % 12 == bass);
                chord.bass = (bass != chord.root && tone).then_some(bass);
            }
        }
    }
    out
}

/// A section start and its name.
#[derive(Clone, Debug, PartialEq)]
pub struct Section {
    pub tick: u64,
    pub label: String,
}

/// Coarse sections on measure boundaries (current-plan 3.3; Eldeeb & Malandro 2025 style):
/// per-measure pitch-class and density features, a cosine self-similarity matrix, boundaries at
/// peaks of a checkerboard novelty curve (at least four measures apart), then segments grouped
/// by similarity. Names stay modest: a quiet first or last segment is 前奏 / 尾奏, the others
/// are lettered by group (段落 A, B …, the same letter for alike segments). Guessing 主歌 and
/// 副歌 from repetition alone was wrong too often to show.
pub fn sections(notes: &[Note], time: &MusicalTime) -> Vec<Section> {
    const KERNEL: usize = 8;
    const MIN_LENGTH: usize = 8;
    let bars = &time.measures;
    if bars.len() < MIN_LENGTH * 3 {
        return vec![];
    }
    let timeline = Timeline::new(notes);
    let features: Vec<[f64; 13]> = bars
        .iter()
        .map(|m| {
            let profile = timeline.profile(m.start_tick, m.end_tick, false);
            let span = (m.end_tick - m.start_tick).max(1) as f64;
            let onsets = timeline.around(m.start_tick).iter().take_while(|n| n.start < m.end_tick).filter(|n| n.start >= m.start_tick).count() as f64;
            let total: f64 = profile.iter().sum();
            let mut f = [0.0; 13];
            for pc in 0..12 {
                f[pc] = if total > 0.0 { profile[pc] / total } else { 0.0 };
            }
            f[12] = onsets / (span / f64::from(time.ppq)) / 8.0;
            f
        })
        .collect();
    let cosine = |a: &[f64; 13], b: &[f64; 13]| {
        let dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
        let na: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
        let nb: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
        if na == 0.0 || nb == 0.0 { if na == nb { 1.0 } else { 0.0 } } else { dot / (na * nb) }
    };
    let n = features.len();
    let ssm: Vec<Vec<f64>> = (0..n).map(|i| (0..n).map(|j| cosine(&features[i], &features[j])).collect()).collect();
    // Boundary before measure i: alike within the K measures on each side, unlike across.
    let novelty: Vec<f64> = (0..n)
        .map(|i| {
            if i < KERNEL || i + KERNEL > n {
                return 0.0;
            }
            let mut value = 0.0;
            for a in 0..KERNEL {
                for b in 0..KERNEL {
                    let (before_a, before_b, after_a, after_b) = (i - 1 - a, i - 1 - b, i + a, i + b);
                    value += ssm[before_a][before_b] + ssm[after_a][after_b] - ssm[before_a][after_b] - ssm[after_a][before_b];
                }
            }
            value / (KERNEL * KERNEL) as f64
        })
        .collect();
    let mean = novelty.iter().sum::<f64>() / n as f64;
    let deviation = (novelty.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n as f64).sqrt();
    let mut cuts = vec![0];
    let mut candidates: Vec<usize> = (MIN_LENGTH..n.saturating_sub(MIN_LENGTH))
        .filter(|&i| novelty[i] > mean + 0.5 * deviation && novelty[i] >= novelty[i - 1] && novelty[i] >= novelty[i + 1])
        .collect();
    candidates.sort_by(|a, b| novelty[*b].total_cmp(&novelty[*a]));
    for c in candidates {
        if cuts.iter().all(|&cut: &usize| cut.abs_diff(c) >= MIN_LENGTH) {
            cuts.push(c);
        }
    }
    cuts.sort();
    let segments: Vec<(usize, usize)> = cuts.iter().enumerate().map(|(i, &s)| (s, cuts.get(i + 1).copied().unwrap_or(n))).collect();
    // Group segments whose measures are alike on average.
    let alike = |a: (usize, usize), b: (usize, usize)| {
        let len = (a.1 - a.0).min(b.1 - b.0);
        (0..len).map(|k| ssm[a.0 + k][b.0 + k]).sum::<f64>() / len.max(1) as f64
    };
    let mut group = vec![usize::MAX; segments.len()];
    let mut groups = 0;
    for i in 0..segments.len() {
        if group[i] != usize::MAX {
            continue;
        }
        group[i] = groups;
        for j in i + 1..segments.len() {
            if group[j] == usize::MAX && alike(segments[i], segments[j]) > 0.9 {
                group[j] = groups;
            }
        }
        groups += 1;
    }
    let density = |s: (usize, usize)| (s.0..s.1).map(|k| features[k][12]).sum::<f64>() / (s.1 - s.0).max(1) as f64;
    let mut densities: Vec<f64> = segments.iter().map(|&s| density(s)).collect();
    densities.sort_by(f64::total_cmp);
    let median = densities[densities.len() / 2];
    let count = |g: usize| group.iter().filter(|&&x| x == g).count();
    let mut letters = 0u8;
    let mut names: Vec<Option<String>> = vec![None; groups];
    segments
        .iter()
        .zip(&group)
        .enumerate()
        .map(|(i, (&s, &g))| {
            let quiet = density(s) < median * 0.6;
            let label = if i == 0 && quiet && count(g) == 1 {
                "前奏".to_string()
            } else if i + 1 == segments.len() && quiet && count(g) == 1 {
                "尾奏".to_string()
            } else {
                names[g]
                    .get_or_insert_with(|| {
                        letters += 1;
                        format!("段落 {}", char::from(b'A' + letters - 1))
                    })
                    .clone()
            };
            Section { tick: bars[s.0].start_tick, label }
        })
        .collect()
}
