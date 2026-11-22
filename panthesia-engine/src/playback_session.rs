//! In-memory transport only: time, ordered cursors and required keys.
//! The adapter supplies immutable timelines and emits packets through its output port.
//! This module has no files, devices, storage, UI or assessment dependencies.
use crate::note_guidance::Guidance;
use std::time::Duration;

#[derive(Default)]
pub(crate) struct PlaybackSession {
    pub(crate) clock: Duration,
    pub(crate) last_beat: Option<(usize, usize)>,
    pub(crate) guidance: Guidance,
    pub(crate) note_cursor: usize,
    pub(crate) event_cursor: usize,
    /// Human-part onsets that came due in this step while not waiting (flow mode), for the
    /// timing matcher that feeds latency calibration.
    pub(crate) due_onsets: Vec<u8>,
}
#[derive(Clone, Copy)]
pub(crate) struct Frame {
    pub position: f64,
    pub speed: f64,
    pub end: f64,
    pub waiting: bool,
    pub looping: bool,
}
impl PlaybackSession {
    pub fn seek<N, E>(
        &mut self,
        position: f64,
        notes: &[N],
        events: &[E],
        note_time: impl Fn(&N) -> f64,
        event_time: impl Fn(&E) -> f64,
    ) {
        self.clock = Duration::ZERO;
        self.last_beat = None;
        self.guidance.clear();
        self.note_cursor = notes.partition_point(|n| note_time(n) < position);
        self.event_cursor = events.partition_point(|e| event_time(e) < position);
    }
    /// Mode/part changes preserve event progress and elapsed time. Pending keys
    /// belong to the old selection; the new selection starts at this position.
    pub fn reselect<N>(&mut self, position: f64, notes: &[N], time: impl Fn(&N) -> f64) {
        self.guidance.clear();
        self.note_cursor = notes.partition_point(|n| time(n) < position);
    }
    /// None means a required chord is still pending. The descriptor projects note time and role.
    pub fn advance<N>(
        &mut self,
        delta: Duration,
        frame: Frame,
        notes: &[N],
        describe: impl Fn(&N) -> (f64, u8, bool),
    ) -> Option<f64> {
        self.clock += delta;
        if frame.waiting && !self.guidance.ready() {
            return None;
        }
        let mut position = (frame.position + delta.as_secs_f64() * frame.speed).min(frame.end);
        self.due_onsets.clear();
        if !frame.waiting {
            while let Some(note) = notes.get(self.note_cursor) {
                let (at, pitch, human) = describe(note);
                if at > position + 0.000001 || (frame.looping && at >= frame.end) {
                    break;
                }
                if human {
                    self.due_onsets.push(pitch);
                }
                self.note_cursor += 1;
            }
        }
        if frame.waiting {
            while self.note_cursor < notes.len() && !describe(&notes[self.note_cursor]).2 {
                self.note_cursor += 1;
            }
            if let Some(note) = notes.get(self.note_cursor) {
                position = position.min(describe(note).0.max(frame.position));
            }
            while let Some(note) = notes.get(self.note_cursor) {
                let (at, pitch, human) = describe(note);
                if at > position + 0.000001 || (frame.looping && at >= frame.end) {
                    break;
                }
                if human {
                    self.guidance.require(pitch, self.clock);
                }
                self.note_cursor += 1;
            }
        }
        Some(position)
    }
    pub fn next_event<'a, E>(
        &mut self,
        events: &'a [E],
        position: f64,
        exclusive_end: Option<f64>,
        time: impl Fn(&E) -> f64,
    ) -> Option<&'a E> {
        let event = events.get(self.event_cursor)?;
        let at = time(event);
        if at > position + 0.000001 || exclusive_end.is_some_and(|end| at >= end) {
            return None;
        }
        self.event_cursor += 1;
        Some(event)
    }
    /// One pulse per entered beat; delayed ticks never replay a burst of old clicks.
    pub fn beat(&mut self, measure: usize, beat: usize) -> Option<bool> {
        let at = (measure, beat);
        if self.last_beat == Some(at) {
            return None;
        }
        self.last_beat = Some(at);
        Some(beat == 1)
    }
    pub fn completed(&self, position: f64, end: f64, waiting: bool) -> bool {
        position >= end && (!waiting || self.guidance.ready())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metronome_enters_each_beat_once_and_rearms_on_seek() {
        let mut s = PlaybackSession::default();
        assert_eq!(s.beat(1, 1), Some(true));
        assert_eq!(s.beat(1, 1), None);
        assert_eq!(s.beat(1, 2), Some(false));
        assert_eq!(s.beat(2, 1), Some(true));
        s.seek(0., &[0.], &[0.], |n| *n, |n| *n);
        assert_eq!(s.beat(1, 1), Some(true));
    }
    #[test]
    fn continuous_wait_and_reselection_keep_transport_position() {
        let notes = [
            (0.1, 60, true),
            (0.1, 64, true),
            (0.2, 67, false),
            (0.3, 72, true),
        ];
        let mut session = PlaybackSession::default();
        let mut frame = Frame {
            position: 0.,
            speed: 1.,
            end: 1.,
            waiting: true,
            looping: false,
        };
        frame.position = session
            .advance(Duration::from_millis(150), frame, &notes, |n| *n)
            .unwrap();
        assert_eq!(frame.position, 0.1);
        assert_eq!(session.guidance.pitches(), vec![60, 64]);
        session.guidance.press(60, session.clock);
        assert!(
            session
                .advance(Duration::from_millis(50), frame, &notes, |n| *n)
                .is_none()
        );
        session.guidance.press(64, session.clock);
        frame.position = session
            .advance(Duration::from_millis(100), frame, &notes, |n| *n)
            .unwrap();
        assert_eq!(frame.position, 0.2);
        let clock = session.clock;
        session.reselect(frame.position, &notes, |n| n.0);
        assert_eq!(session.clock, clock);
        frame.waiting = false;
        assert_eq!(
            session.advance(Duration::from_millis(200), frame, &notes, |n| *n),
            Some(0.4)
        );
    }
    #[test]
    fn seek_and_loop_use_inclusive_start_exclusive_end() {
        let mut s = PlaybackSession::default();
        let events = [0., 0.5, 1.];
        s.seek(0.5, &events, &events, |t| *t, |t| *t);
        assert_eq!(s.next_event(&events, 1., Some(1.), |t| *t), Some(&0.5));
        assert!(s.next_event(&events, 1., Some(1.), |t| *t).is_none());
        s.seek(0., &events, &events, |t| *t, |t| *t);
        assert_eq!(s.next_event(&events, 0., None, |t| *t), Some(&0.));
        assert_eq!(s.clock, Duration::ZERO);
    }
}
