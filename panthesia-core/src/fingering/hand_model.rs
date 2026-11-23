//! What one hand can reach between two fingers, and what it costs: the finger-pair distance
//! table and difficulty rules of Parncutt, Sloboda, Clarke, Raekallio & Desain, "An ergonomic
//! model of keyboard fingering for melodic fragments" (Music Perception 14, 1997), with the
//! revised table of Jacobs, "Refinements to the ergonomic model for keyboard fingering of
//! Parncutt, Sloboda, Clarke, Raekallio, and Desain" (Music Perception 18, 2001). Implemented
//! from the papers; distances are in semitones. As Jacobs notes, the original limits for the
//! thumb passing under are too strict: here the thumb can pass a fourth under the third finger
//! (standard arpeggio fingering), calibrated on textbook scales and arpeggios.
use super::{FingeringHand, HandSpanProfile, is_black_key};

/// MinPrac, MinComf, MinRel, MaxRel, MaxComf, MaxPrac for each finger pair (i < j), measured
/// from finger i to finger j in the right hand's direction (up the keyboard).
const SPANS: [((u8, u8), [i32; 6]); 10] = [
    ((1, 2), [-7, -5, 1, 5, 8, 10]),
    ((1, 3), [-7, -5, 3, 7, 10, 12]),
    ((1, 4), [-5, -3, 5, 9, 12, 14]),
    ((1, 5), [-2, 0, 7, 10, 13, 15]),
    ((2, 3), [1, 1, 1, 2, 3, 5]),
    ((2, 4), [1, 1, 3, 4, 5, 7]),
    ((2, 5), [2, 2, 5, 6, 8, 10]),
    ((3, 4), [1, 1, 1, 2, 2, 4]),
    ((3, 5), [1, 1, 3, 4, 5, 7]),
    ((4, 5), [1, 1, 1, 2, 3, 5]),
];

/// The spans of finger pair (i, j), i < j, for a hand size: a smaller or larger hand reaches
/// less or more on the wide side.
pub(crate) fn spans(i: u8, j: u8, profile: HandSpanProfile) -> [i32; 6] {
    let mut s = SPANS.iter().find(|(pair, _)| *pair == (i, j)).map_or([0; 6], |(_, s)| *s);
    let grow = match profile {
        HandSpanProfile::Compact => -1,
        HandSpanProfile::Standard => 0,
        HandSpanProfile::Large => 1,
    } * if i == 1 { 2 } else { 1 };
    for k in 3..6 {
        s[k] += grow;
    }
    s
}

/// Signed distance from the lower-numbered finger to the higher, in the right hand's direction;
/// the fingers in order (lower, higher).
fn oriented(p1: u8, f1: u8, p2: u8, f2: u8, hand: FingeringHand) -> (u8, u8, i32) {
    let (i, j, d) = if f1 < f2 { (f1, f2, i32::from(p2) - i32::from(p1)) } else { (f2, f1, i32::from(p1) - i32::from(p2)) };
    (i, j, if hand == FingeringHand::Left { -d } else { d })
}

/// Cost of playing `p1` with `f1` and then `p2` with `f2` (different fingers, different keys):
/// the stretch and span rules, crossings, weak fingers and black-key rules.
pub(crate) fn pair_cost(p1: u8, f1: u8, p2: u8, f2: u8, hand: FingeringHand, profile: HandSpanProfile) -> i32 {
    let (i, j, d) = oriented(p1, f1, p2, f2, hand);
    let [min_prac, min_comf, min_rel, max_rel, max_comf, max_prac] = spans(i, j, profile);
    let mut cost = 0;
    // Beyond what a hand can do at all: only a jump can make it.
    let impossible = (d - max_prac).max(0) + (min_prac - d).max(0);
    if impossible > 0 {
        cost += 20 + 4 * impossible;
    }
    // Stretch: 2 points per semitone outside the comfortable range.
    cost += 2 * ((d - max_comf).max(0) + (min_comf - d).max(0));
    // Small and large span: 1 point per semitone outside the relaxed range, 2 without the thumb.
    let weight = if i == 1 { 1 } else { 2 };
    cost += weight * ((min_rel - d).max(0) + (d - max_rel).max(0));
    // Weak finger.
    if f2 == 4 || f2 == 5 {
        cost += 1;
    }
    // Three-to-four, and four on black next to three on white.
    if (f1, f2) == (3, 4) || (f1, f2) == (4, 3) {
        cost += 1;
        let (three, four) = if f1 == 3 { (p1, p2) } else { (p2, p1) };
        if is_black_key(four) && !is_black_key(three) {
            cost += 1;
        }
    }
    // Thumb on a black key, more after a white key; little finger on black after white.
    if f2 == 1 && is_black_key(p2) {
        cost += 1 + if is_black_key(p1) { 0 } else { 2 };
    }
    if f1 == 1 && is_black_key(p1) && !is_black_key(p2) {
        cost += 2;
    }
    if f2 == 5 && is_black_key(p2) && !is_black_key(p1) {
        cost += 2;
    }
    // Thumb passing under or a finger crossing over the thumb: easiest from a finger on a black
    // key to the thumb on a white one (the thumb has room under the black key), harder between
    // two white keys, hardest with the thumb on black.
    if i == 1 && d < 0 {
        let (thumb, other) = if f1 == 1 { (p1, p2) } else { (p2, p1) };
        cost += match (is_black_key(thumb), is_black_key(other)) {
            (false, true) => 0,
            (false, false) => 2,
            (true, false) => 4,
            (true, true) => 2,
        };
    }
    cost
}

/// Cost of three notes in a row beyond their two pairs: the hand changing position (the first
/// and third fingers out of their comfortable span) and 3, 4 and 5 in succession.
pub(crate) fn triple_cost(p: [u8; 3], f: [u8; 3], hand: FingeringHand, profile: HandSpanProfile) -> i32 {
    let mut cost = 0;
    if f[0] != f[2] {
        let (i, j, d) = oriented(p[0], f[0], p[2], f[2], hand);
        let [_, min_comf, _, _, max_comf, _] = spans(i, j, profile);
        let outside = (d - max_comf).max(0) + (min_comf - d).max(0);
        if outside > 0 {
            // A full change of position when the middle note is the thumb passing; else half.
            let passing = f[1] == 1 && (f[0] != 1 && f[2] != 1);
            cost += if passing { 2 } else { 1 } + outside;
        }
    } else if p[0] != p[2] {
        // The same finger again one note later on another key: the hand jumps, except the thumb
        // on white keys around a black key in between (chromatic 1-3-1).
        let chromatic = f[0] == 1 && is_black_key(p[1]) && !is_black_key(p[0]) && !is_black_key(p[2]) && (i32::from(p[0]) - i32::from(p[2])).abs() <= 2;
        cost += if chromatic { 1 } else { 3 + (i32::from(p[0]) - i32::from(p[2])).abs() };
    }
    let mut sorted = f;
    sorted.sort_unstable();
    if sorted == [3, 4, 5] {
        cost += 1;
    }
    cost
}
