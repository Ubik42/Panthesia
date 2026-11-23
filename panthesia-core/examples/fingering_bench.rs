//! Fingering benchmark on textbook material: the 12 major scales (two octaves up and down,
//! both hands), the chromatic scale, root-position major arpeggios and Hanon exercise 1. The
//! reference fingerings are the standard ones taught everywhere; scale starts and ends vary
//! between books, so only the notes between the first and the last thumb are scored.
//!
//! `cargo run -p panthesia-core --example fingering_bench --release [-- --verbose]`
use panthesia_core::fingering::{FingeringHand, FingeringNote, HandSpanProfile, suggest_fingerings_with_profile};
use std::time::Duration;

const MAJOR: [u8; 7] = [0, 2, 4, 5, 7, 9, 11];
/// Tonic, then the pitch classes the thumb plays (right hand, left hand).
const SCALES: [(&str, u8, [u8; 2], [u8; 2]); 12] = [
    ("C", 0, [0, 5], [7, 0]),
    ("G", 7, [7, 0], [2, 7]),
    ("D", 2, [2, 7], [9, 2]),
    ("A", 9, [9, 2], [4, 9]),
    ("E", 4, [4, 9], [11, 4]),
    ("B", 11, [11, 4], [4, 11]),
    ("F", 5, [5, 0], [0, 5]),
    ("Bb", 10, [0, 5], [2, 9]),
    ("Eb", 3, [5, 0], [7, 2]),
    ("Ab", 8, [0, 5], [0, 7]),
    ("Db", 1, [5, 0], [5, 0]),
    ("Gb", 6, [11, 5], [11, 5]),
];

struct Case {
    group: &'static str,
    name: String,
    hand: FingeringHand,
    pitches: Vec<u8>,
    /// Expected finger per note; 0 = not scored.
    expected: Vec<u8>,
}

fn notes(pitches: &[u8], seconds: f64) -> Vec<FingeringNote> {
    pitches
        .iter()
        .enumerate()
        .map(|(i, &pitch)| FingeringNote {
            pitch,
            onset: Duration::from_secs_f64(i as f64 * seconds),
            end: Duration::from_secs_f64((i as f64 + 0.9) * seconds),
            anchored_finger: None,
        })
        .collect()
}

/// Fingers of an ascending run from where the thumb falls: the right hand counts up from each
/// thumb, the left hand counts down to the next thumb.
fn by_thumbs(ascending: &[u8], thumbs: &[u8], hand: FingeringHand) -> Vec<u8> {
    let is_thumb: Vec<bool> = ascending.iter().map(|p| thumbs.contains(&(p % 12))).collect();
    let first = is_thumb.iter().position(|&t| t).unwrap();
    let last = is_thumb.iter().rposition(|&t| t).unwrap();
    // The first and last note of a run are fingered differently from book to book.
    (0..ascending.len())
        .map(|i| {
            if i < first || i > last || i == 0 || i + 1 == ascending.len() {
                return 0;
            }
            match hand {
                FingeringHand::Right => {
                    let since = (0..=i).rev().position(|k| is_thumb[k]).unwrap();
                    since as u8 + 1
                }
                FingeringHand::Left => {
                    let until = (i..ascending.len()).position(|k| is_thumb[k]).unwrap();
                    until as u8 + 1
                }
            }
        })
        .collect()
}

fn up_and_down(ascending: Vec<u8>, fingers: Vec<u8>) -> (Vec<u8>, Vec<u8>) {
    let mut p = ascending.clone();
    let mut f = fingers.clone();
    p.extend(ascending.iter().rev().skip(1));
    f.extend(fingers.iter().rev().skip(1));
    (p, f)
}

fn cases() -> Vec<Case> {
    let mut out = Vec::new();
    for (name, tonic, rh, lh) in SCALES {
        for (hand, thumbs, base) in [(FingeringHand::Right, rh, 60), (FingeringHand::Left, lh, 48)] {
            let start = base + tonic;
            let ascending: Vec<u8> = (0..15).map(|i| start + 12 * (i / 7) as u8 + MAJOR[i % 7]).collect();
            let fingers = by_thumbs(&ascending, &thumbs, hand);
            let (pitches, expected) = up_and_down(ascending, fingers);
            out.push(Case { group: "大调音阶", name: format!("{name} 大调音阶 {}", side(hand)), hand, pitches, expected });
        }
    }
    // Chromatic: thumb on white keys, 3 on black keys, 2 on the white key next to another white
    // key (right hand: F and C going up; left hand: E and B going up).
    for (hand, base) in [(FingeringHand::Right, 60), (FingeringHand::Left, 48)] {
        let ascending: Vec<u8> = (0..25).map(|i| base + i).collect();
        let fingers: Vec<u8> = ascending
            .iter()
            .map(|p| match (p % 12, hand) {
                (1 | 3 | 6 | 8 | 10, _) => 3,
                (5 | 0, FingeringHand::Right) => 2,
                (4 | 11, FingeringHand::Left) => 2,
                _ => 1,
            })
            .collect();
        let mut expected = fingers;
        let n = expected.len();
        expected[0] = 0;
        expected[n - 1] = 0;
        let (pitches, expected) = up_and_down(ascending, expected);
        out.push(Case { group: "半音阶", name: format!("半音阶 {}", side(hand)), hand, pitches, expected });
    }
    // Root-position major arpeggios on white-key triads, right hand: 1 2 3 1 2 3 5.
    for (name, tonic) in [("C", 0u8), ("G", 7), ("F", 5), ("D", 2), ("A", 9), ("E", 4)] {
        let root = 60 + tonic;
        let ascending = vec![root, root + 4, root + 7, root + 12, root + 16, root + 19, root + 24];
        let fingers = vec![1, 2, 3, 1, 2, 3, 5];
        let (pitches, expected) = up_and_down(ascending, fingers);
        out.push(Case { group: "琶音", name: format!("{name} 大三和弦琶音 右手"), hand: FingeringHand::Right, pitches, expected });
    }
    // Hanon 1: C E F G A G F E, moving up one step per group; right hand 1 2 3 4 5 4 3 2, left
    // hand an octave lower 5 4 3 2 1 2 3 4.
    let white = |degree: i32| -> u8 { (48 + 12 * degree.div_euclid(7) + MAJOR[degree.rem_euclid(7) as usize] as i32) as u8 };
    for (hand, octave, shape) in [(FingeringHand::Right, 7, [1, 2, 3, 4, 5, 4, 3, 2]), (FingeringHand::Left, 0, [5, 4, 3, 2, 1, 2, 3, 4])] {
        let mut pitches = Vec::new();
        let mut expected = Vec::new();
        for step in 0..14 {
            for (k, offset) in [0, 2, 3, 4, 5, 4, 3, 2].iter().enumerate() {
                pitches.push(white(octave + step + offset));
                expected.push(shape[k]);
            }
        }
        out.push(Case { group: "哈农", name: format!("哈农第 1 条 {}", side(hand)), hand, pitches, expected });
    }
    out
}

fn side(hand: FingeringHand) -> &'static str {
    match hand {
        FingeringHand::Right => "右手",
        FingeringHand::Left => "左手",
    }
}

fn main() {
    let verbose = std::env::args().any(|a| a == "--verbose");
    let (mut hit, mut total) = (0usize, 0usize);
    let mut groups: Vec<(String, usize, usize)> = Vec::new();
    for case in cases() {
        let input = notes(&case.pitches, 0.18);
        let got: Vec<u8> = suggest_fingerings_with_profile(&input, case.hand, HandSpanProfile::Standard)
            .into_iter()
            .map(|s| s.map_or(0, |s| s.finger))
            .collect();
        let scored: Vec<usize> = (0..case.expected.len()).filter(|&i| case.expected[i] != 0).collect();
        let good = scored.iter().filter(|&&i| got[i] == case.expected[i]).count();
        hit += good;
        total += scored.len();
        let group = case.group.to_string();
        match groups.iter_mut().find(|g| g.0 == group) {
            Some(g) => {
                g.1 += good;
                g.2 += scored.len();
            }
            None => groups.push((group, good, scored.len())),
        }
        if verbose || good < scored.len() {
            println!("{:<22} {:>3}/{:<3}", case.name, good, scored.len());
            if verbose || good * 10 < scored.len() * 9 {
                let fmt = |v: &[u8]| v.iter().map(|f| if *f == 0 { "·".into() } else { f.to_string() }).collect::<String>();
                println!("    期望 {}", fmt(&case.expected));
                println!("    结果 {}", fmt(&got));
            }
        }
    }
    println!();
    for (group, good, n) in &groups {
        println!("{group:<12} {:5.1}%  ({good}/{n})", 100.0 * *good as f64 / *n as f64);
    }
    println!("{:<12} {:5.1}%  ({hit}/{total})", "合计", 100.0 * hit as f64 / total as f64);
}
