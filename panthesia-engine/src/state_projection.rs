//! Stable session projections retain their exact inputs instead of rebuilding on every tick.
use crate::*;

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StateCursor {
    pub summary_version: Option<String>,
}

/// A retained summary belongs to the exact version supplied by the caller.
/// Original full-state endpoints remain available to existing clients.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateFrame {
    state: Snapshot,
    summary_unchanged: bool,
}
impl Engine {
    pub fn state_frame(&self, cursor: StateCursor) -> StateFrame {
        let mut state = self.snapshot();
        let summary_unchanged = !state.summary_version.is_empty()
            && cursor.summary_version.as_ref() == Some(&state.summary_version);
        if summary_unchanged {
            state.summary = None;
        }
        StateFrame {
            state,
            summary_unchanged,
        }
    }
}
/// Compute outside the shared-state lock. Readers never wait for musical projections.
pub(super) fn publish(player: &Player, shared: &Mutex<Snapshot>) {
    let next = player.snapshot();
    let old = shared
        .lock()
        .ok()
        .map(|mut slot| std::mem::replace(&mut *slot, next));
    player.retire(old);
}
