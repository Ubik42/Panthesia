//! Publish the player's state snapshot for readers.
use crate::*;

/// Compute outside the shared-state lock. Readers never wait for musical projections.
pub(super) fn publish(player: &Player, shared: &Mutex<Snapshot>) {
    let next = player.snapshot();
    let old = shared
        .lock()
        .ok()
        .map(|mut slot| std::mem::replace(&mut *slot, next));
    player.retire(old);
}
