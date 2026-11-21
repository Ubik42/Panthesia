//! Practice grid identity: a stable signature of the measure layout used to key saved ranges.
use super::*;

pub(super) fn grid(file: &MidiFile) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for m in &file.musical_time.measures {
        for value in [
            m.start_tick,
            m.end_tick,
            u64::from(m.numerator),
            u64::from(m.denominator),
        ] {
            for b in value.to_le_bytes() {
                hash ^= u64::from(b);
                hash = hash.wrapping_mul(0x100000001b3);
            }
        }
    }
    format!("grid-v1-{hash:016x}")
}
