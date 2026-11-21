//! Mainline loops advance directly; assessment and automatic round archives live on the lab branch.
use crate::*;
impl Player {
    pub(super) fn finish_practice_round(&mut self) {
        self.state.status = "finished".into();
        self.panic();
        self.playback.guidance.clear();
        self.state.saved = true;
        self.state.current_history_id = None;
        self.continue_finished_round();
    }
}
