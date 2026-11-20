//! Compatibility transport for retired native consumers; the desktop owns its own playback session.
use crate::{MidiEvent, MidiTrack};
use std::{sync::Arc, time::Duration};
#[derive(Debug, Clone)]
pub struct PlaybackState {
    tracks: Arc<[MidiTrack]>,
    cursor: Vec<usize>,
    clock: Duration,
    lead: Duration,
    paused: bool,
    first: Duration,
    last: Duration,
}
impl PlaybackState {
    pub fn new(lead: Duration, tracks: Arc<[MidiTrack]>) -> Self {
        let first = tracks
            .iter()
            .flat_map(|t| t.notes.iter())
            .map(|n| n.start)
            .min()
            .unwrap_or_default();
        let last = tracks
            .iter()
            .flat_map(|t| t.notes.iter())
            .map(|n| n.end)
            .max()
            .unwrap_or_default();
        Self {
            cursor: vec![0; tracks.len()],
            tracks,
            clock: Duration::ZERO,
            lead,
            paused: false,
            first,
            last,
        }
    }
    pub fn update(&mut self, delta: Duration) -> Vec<&MidiEvent> {
        if !self.paused {
            self.clock = self.clock.saturating_add(delta);
        }
        let mut events = Vec::new();
        for (track, cursor) in self.tracks.iter().zip(&mut self.cursor) {
            let until = track
                .events
                .partition_point(|e| e.timestamp.saturating_add(self.lead) <= self.clock);
            events.extend(&track.events[*cursor..until]);
            *cursor = until;
        }
        events.sort_by_key(|e| (e.timestamp, e.order));
        events
    }
    pub fn is_paused(&self) -> bool {
        self.paused
    }
    pub fn pause(&mut self) {
        self.paused = true;
    }
    pub fn resume(&mut self) {
        self.paused = false;
    }
    pub fn time(&self) -> Duration {
        self.clock
    }
    pub fn set_time(&mut self, time: Duration) {
        self.clock = time;
        for (track, cursor) in self.tracks.iter().zip(&mut self.cursor) {
            *cursor = track
                .events
                .partition_point(|e| e.timestamp.saturating_add(self.lead) < time);
        }
    }
    pub fn is_finished(&self) -> bool {
        self.clock >= self.length()
    }
    pub fn percentage(&self) -> f32 {
        if self.length().is_zero() {
            1.
        } else {
            self.clock.as_secs_f32() / self.length().as_secs_f32()
        }
    }
    pub fn leed_in(&self) -> &Duration {
        &self.lead
    }
    pub fn first_note_start(&self) -> &Duration {
        &self.first
    }
    pub fn last_note_end(&self) -> &Duration {
        &self.last
    }
    pub fn length(&self) -> Duration {
        self.last.saturating_add(self.lead)
    }
    pub fn reset(&mut self) {
        self.clock = Duration::ZERO;
        self.cursor.fill(0);
    }
}
