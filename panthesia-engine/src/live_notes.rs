//! UI keys use one bounded control message and cannot replay after a stop or song switch.
use crate::*;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub engine_id: Option<String>,
    pub epoch: u64,
    pub created_at_ms: u64,
    pub events: Vec<Event>,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pitch: u8,
    velocity: u8,
    active: bool,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Acknowledgement {
    #[serde(skip_serializing_if = "Option::is_none")]
    engine_id: Option<String>,
    epoch: u64,
    accepted: usize,
    expired: usize,
}
impl Engine {
    pub fn live_notes(&self, input: Input) -> Result<Acknowledgement, String> {
        if input.events.len() > 128
            || input
                .events
                .iter()
                .any(|event| event.pitch > 127 || event.velocity > 127)
        {
            return Err("键盘输入数量或音符参数无效".into());
        }
        let (reply, receiver) = mpsc::sync_channel(1);
        self.control_tx
            .send(runtime_request::Request::LiveNotes(
                input,
                Instant::now(),
                reply,
            ))
            .map_err(|_| "音乐引擎已关闭")?;
        receiver
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "键盘输入响应超时")?
    }
}
impl Player {
    pub(super) fn apply_live_notes(
        &mut self,
        input: Input,
        received: Instant,
    ) -> Result<Acknowledgement, String> {
        let mut answer = Acknowledgement {
            engine_id: self
                .state_clock
                .as_ref()
                .map(|clock| clock.engine_id().to_owned()),
            epoch: self.audio_stop_epoch,
            accepted: 0,
            expired: 0,
        };
        if input.engine_id.as_deref().is_some_and(|id| {
            self.state_clock.as_ref().map(state_order::Clock::engine_id) != Some(id)
        }) || input.epoch != self.audio_stop_epoch
        {
            return Ok(answer);
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let expired = received.elapsed() > Duration::from_millis(200)
            || now.saturating_sub(u128::from(input.created_at_ms)) > 200;
        let blocked = self.closing.load(Ordering::Acquire)
            || self
                .startup
                .as_ref()
                .is_some_and(|startup| !startup.status().ready)
            || (self.storage_busy.load(Ordering::Acquire) && !self.recorder.is_recording());
        let can_attack = !expired && !blocked;
        let sound_error = if can_attack
            && input
                .events
                .iter()
                .any(|event| event.active && event.velocity > 0)
        {
            self.ensure_audio().err()
        } else {
            None
        };
        for event in input.events {
            let attack = event.active && event.velocity > 0;
            if attack && (!can_attack || sound_error.is_some()) {
                answer.expired += usize::from(expired);
                continue;
            }
            if blocked && !self.recorder.is_recording() {
                continue;
            }
            self.midi(&[
                if attack { 144 } else { 128 },
                event.pitch,
                if attack { event.velocity } else { 0 },
            ]);
            answer.accepted += 1;
        }
        answer.epoch = self.audio_stop_epoch;
        if let Some(error) = sound_error {
            return Err(error);
        }
        Ok(answer)
    }
}
