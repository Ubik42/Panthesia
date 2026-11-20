//! The last program at a clock position is derived from a globally ordered channel stream.
use crate::MidiTrack;
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
    time::Duration,
};
#[derive(Clone, Debug)]
pub struct ProgramTrack {
    states: Arc<[(Duration, HashMap<u8, u8>)]>,
}
fn initial() -> &'static HashMap<u8, u8> {
    static STATE: OnceLock<HashMap<u8, u8>> = OnceLock::new();
    STATE.get_or_init(|| (0..16).map(|channel| (channel, 0)).collect())
}
impl ProgramTrack {
    pub fn new(tracks: &[MidiTrack]) -> Self {
        let mut changes = tracks
            .iter()
            .flat_map(|t| {
                t.programs
                    .iter()
                    .enumerate()
                    .map(move |(i, e)| (e.timestamp, t.track_id, i, e.channel, e.program))
            })
            .collect::<Vec<_>>();
        changes.sort_by_key(|e| (e.0, e.1, e.2));
        let mut state = initial().clone();
        let mut states: Vec<(Duration, HashMap<u8, u8>)> = Vec::new();
        for (time, _, _, channel, program) in changes {
            state.insert(channel, program);
            if states.last().is_some_and(|e| e.0 == time) {
                states.last_mut().unwrap().1 = state.clone();
            } else {
                states.push((time, state.clone()));
            }
        }
        Self {
            states: states.into(),
        }
    }
    pub fn program_for_timestamp(&self, time: &Duration) -> &HashMap<u8, u8> {
        let point = self.states.partition_point(|e| e.0 <= *time);
        point
            .checked_sub(1)
            .map(|i| &self.states[i].1)
            .unwrap_or_else(|| initial())
    }
}
