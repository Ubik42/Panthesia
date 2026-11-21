//! The published state snapshot: readers take the latest copy, subscribers wait for the next one.
use crate::*;
use std::sync::Condvar;
use std::time::Duration;

/// The latest snapshot with a revision that grows on every publish.
pub(crate) struct StateFeed {
    slot: Mutex<(u64, Snapshot)>,
    published: Condvar,
}
impl StateFeed {
    pub(crate) fn new(first: Snapshot) -> Self {
        Self { slot: Mutex::new((1, first)), published: Condvar::new() }
    }
    pub(crate) fn snapshot(&self) -> Snapshot {
        self.slot.lock().map(|slot| slot.1.clone()).unwrap_or_default()
    }
    pub(crate) fn read<T>(&self, f: impl FnOnce(&Snapshot) -> T) -> Option<T> {
        self.slot.lock().ok().map(|slot| f(&slot.1))
    }
    /// The first snapshot published after revision `after`, or `None` when `timeout` passes.
    pub(crate) fn next(&self, after: u64, timeout: Duration) -> Option<(u64, Snapshot)> {
        let slot = self.slot.lock().ok()?;
        let (slot, _) = self.published.wait_timeout_while(slot, timeout, |slot| slot.0 <= after).ok()?;
        (slot.0 > after).then(|| (slot.0, slot.1.clone()))
    }
}

/// Compute outside the shared-state lock. Readers never wait for musical projections.
pub(super) fn publish(player: &Player, shared: &StateFeed) {
    let next = player.snapshot();
    let old = shared.slot.lock().ok().map(|mut slot| {
        slot.0 += 1;
        std::mem::replace(&mut slot.1, next)
    });
    shared.published.notify_all();
    player.retire(old);
}

impl Engine {
    /// Wait for the first state published after revision `after` (0 returns the current one).
    /// The desktop pushes these to the window; the debug service serves them as a long poll.
    pub fn next_state(&self, after: u64, timeout: Duration) -> Option<(u64, Snapshot)> {
        self.state.next(after, timeout)
    }
}
