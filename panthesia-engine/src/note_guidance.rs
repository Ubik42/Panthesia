//! Required-key guidance only. No timing grades, errors, scores or attempts.
use std::{
    collections::{BTreeSet, HashMap},
    time::Duration,
};

#[derive(Default)]
pub(crate) struct Guidance {
    required: BTreeSet<u8>,
    recent: HashMap<u8, Duration>,
}
impl Guidance {
    pub fn clear(&mut self) {
        self.required.clear();
        self.recent.clear();
    }
    pub fn press(&mut self, pitch: u8, now: Duration) {
        self.recent
            .retain(|_, at| now.saturating_sub(*at) <= Duration::from_millis(500));
        if !self.required.remove(&pitch) {
            self.recent.insert(pitch, now);
        }
    }
    pub fn require(&mut self, pitch: u8, now: Duration) {
        if self
            .recent
            .remove(&pitch)
            .is_some_and(|at| now.saturating_sub(at) <= Duration::from_millis(500))
        {
            return;
        }
        self.required.insert(pitch);
    }
    pub fn ready(&self) -> bool {
        self.required.is_empty()
    }
    pub fn pitches(&self) -> Vec<u8> {
        self.required.iter().copied().collect()
    }
}
