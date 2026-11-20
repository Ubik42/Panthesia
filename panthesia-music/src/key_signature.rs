//! Sequential source key signatures. Practice projections do not rewrite these events.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeySignatureEvent {
    pub tick: u64,
    pub fifths: i8,
    pub minor: bool,
}
pub fn tonic(fifths: i8, minor: bool) -> u8 {
    ((i16::from(fifths) * 7 + if minor { 9 } else { 0 }).rem_euclid(12)) as u8
}
pub fn project(fifths: i8, minor: bool, shift: i16, forced_minor: Option<bool>) -> (u8, i8, bool) {
    let target = (i16::from(tonic(fifths, minor)) + shift).rem_euclid(12) as u8;
    let mode = forced_minor.unwrap_or(minor);
    let spelling = if target == tonic(fifths, minor) && mode == minor {
        fifths
    } else {
        (-7i8..=7)
            .filter(|f| tonic(*f, mode) == target)
            .min_by_key(|f| f.abs())
            .unwrap_or(0)
    };
    (target, spelling, mode)
}
