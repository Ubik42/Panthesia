//! Accumulate exact note pairs once for both expression requirements.
use super::{Input, Reference, pedal_before, pedal_events};
use crate::expression_goal::{NotePedalEvidence, NoteVelocityEvidence};

#[derive(Default)]
pub(crate) struct Evidence {
    pub velocity: Option<NoteVelocityEvidence>,
    pub pedal: Option<NotePedalEvidence>,
}

struct Velocity {
    seen: Vec<bool>,
    matched: usize,
    largest: Option<u8>,
}
struct Pedal {
    seen: Vec<bool>,
    matched: usize,
    paired: usize,
    unknown: usize,
    mismatches: usize,
    target: Vec<(f64, bool)>,
    actual: Vec<(f64, bool)>,
}
pub(super) struct Collector<'a> {
    references: &'a [Reference],
    inputs: &'a [Input],
    expected: usize,
    velocity: Option<Velocity>,
    pedal: Option<Pedal>,
}
impl<'a> Collector<'a> {
    pub fn new(
        references: &'a [Reference],
        inputs: &'a [Input],
        reference_pedals: &[Input],
        expected: usize,
        velocity: bool,
        pedal: bool,
    ) -> Self {
        Self {
            references,
            inputs,
            expected: expected.max(references.len()),
            velocity: velocity.then(|| Velocity {
                seen: vec![false; references.len()],
                matched: 0,
                largest: None,
            }),
            pedal: pedal.then(|| Pedal {
                seen: vec![false; references.len()],
                matched: 0,
                paired: 0,
                unknown: 0,
                mismatches: 0,
                target: pedal_events(reference_pedals),
                actual: pedal_events(inputs),
            }),
        }
    }
    pub fn push(&mut self, reference_index: usize, input_index: usize) {
        let (Some(reference), Some(input)) = (
            self.references.get(reference_index),
            self.inputs.get(input_index),
        ) else {
            return;
        };
        if input.synthetic
            || input.bytes[0] != 144
            || input.bytes[2] == 0
            || input.bytes[1] != reference.pitch
        {
            return;
        }
        if let Some(velocity) = &mut self.velocity {
            if reference.velocity > 0 && !velocity.seen[reference_index] {
                velocity.seen[reference_index] = true;
                velocity.matched += 1;
                let difference = reference.velocity.abs_diff(input.bytes[2]);
                velocity.largest = Some(
                    velocity
                        .largest
                        .map_or(difference, |old| old.max(difference)),
                );
            }
        }
        if let Some(pedal) = &mut self.pedal {
            if !pedal.seen[reference_index] {
                pedal.seen[reference_index] = true;
                pedal.matched += 1;
                match (
                    pedal_before(&pedal.target, reference.at),
                    pedal_before(&pedal.actual, input.at),
                ) {
                    (Some(target), Some(actual)) => {
                        pedal.paired += 1;
                        if target != actual {
                            pedal.mismatches += 1;
                        }
                    }
                    _ => pedal.unknown += 1,
                }
            }
        }
    }
    pub fn finish(self) -> Evidence {
        Evidence {
            velocity: self.velocity.map(|value| NoteVelocityEvidence {
                reference_notes: self.expected,
                matched_notes: value.matched,
                missing_notes: self.expected.saturating_sub(value.matched),
                max_abs_difference: value.largest,
            }),
            pedal: self.pedal.map(|value| NotePedalEvidence {
                reference_notes: self.expected,
                matched_notes: value.matched,
                paired_state_notes: value.paired,
                missing_notes: self.expected.saturating_sub(value.matched),
                unknown_state_notes: value.unknown,
                mismatch_count: value.mismatches,
            }),
        }
    }
}
