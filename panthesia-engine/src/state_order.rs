//! Engine-local capture order. Transport completion time never establishes snapshot freshness.
use serde::Serialize;
use std::cell::Cell;
use std::sync::atomic::{AtomicU64, Ordering};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateOrder {
    pub engine_id: String,
    pub sequence: u64,
}
pub(crate) struct Clock {
    engine_id: String,
    sequence: Cell<u64>,
}
impl Clock {
    pub fn new() -> Self {
        static ORIGIN: AtomicU64 = AtomicU64::new(0);
        Self {
            engine_id: format!(
                "{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos(),
                ORIGIN.fetch_add(1, Ordering::Relaxed)
            ),
            sequence: Cell::new(0),
        }
    }
    pub fn engine_id(&self) -> &str {
        &self.engine_id
    }
    pub fn next(&self) -> StateOrder {
        let sequence = self.sequence.get().saturating_add(1);
        self.sequence.set(sequence);
        StateOrder {
            engine_id: self.engine_id.clone(),
            sequence,
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuardedCommand {
    pub engine_id: String,
    pub command: crate::Command,
}

/// Playback controls retain the song and score version visible when queued.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaybackAdjustment {
    pub engine_id: String,
    pub created_at_ms: u64,
    pub content_id: Option<String>,
    pub score_revision: u64,
    pub command: crate::Command,
}
impl PlaybackAdjustment {
    fn check_age(&self) -> Result<(), String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        if now.saturating_sub(u128::from(self.created_at_ms)) > 2000 {
            return Err("调节请求已过期，请在当前曲目中重新调节".into());
        }
        Ok(())
    }
    pub(crate) fn check(&self, player: &crate::Player) -> Result<(), String> {
        self.check_age()?;
        if player.state_clock.as_ref().map(Clock::engine_id) != Some(self.engine_id.as_str())
            || player.file.as_ref().map(|file| file.content_id.as_str())
                != self.content_id.as_deref()
            || player.score_revision != self.score_revision
        {
            return Err("曲目或练习室已改变，请在当前曲目中重新调节".into());
        }
        if matches!(self.command, crate::Command::StopLadder) && player.routine.is_some() {
            return Err("练习计划已改变，请在当前计划中结束练习".into());
        }
        Ok(())
    }
}
impl crate::Engine {
    pub fn check_engine(&self, expected: &str) -> Result<(), String> {
        if self.engine_id.as_ref() != expected {
            return Err("练习室连接已改变，请重新读取当前练习后再操作".into());
        }
        Ok(())
    }

    pub fn adjust_playback(
        &self,
        request: PlaybackAdjustment,
    ) -> Result<serde_json::Value, String> {
        self.check_engine(&request.engine_id)?;
        request.check_age()?;
        if !matches!(
            request.command,
            crate::Command::Speed { .. }
                | crate::Command::Volume { .. }
                | crate::Command::Seek { .. }
                | crate::Command::Play
                | crate::Command::Restart
                | crate::Command::SeekMeasure { .. }
                | crate::Command::SeekBeat { .. }
                | crate::Command::StepBeat { .. }
                | crate::Command::Metronome { .. }
                | crate::Command::Loop { .. }
                | crate::Command::Mode { .. }
                | crate::Command::MeasureLoop { .. }
                | crate::Command::Track { .. }
                | crate::Command::StopLadder
        ) {
            return Err("此入口只接受当前曲目的播放设置、定位与速度阶梯控制".into());
        }
        let (reply, receiver) = std::sync::mpsc::sync_channel(1);
        self.tx
            .send(crate::runtime_request::Request::PlaybackAdjustment(
                request,
                std::time::Instant::now(),
                reply,
            ))
            .map_err(|_| "音乐引擎已关闭".to_string())?;
        receiver
            .recv_timeout(std::time::Duration::from_secs(125))
            .map_err(|_| "演奏调节响应超时".to_string())?
    }
}

impl crate::Player {
    /// Worker copies retain the source identity without duplicating its capture clock.
    pub(crate) fn source_engine_id(&self) -> Option<&str> {
        self.state_clock
            .as_ref()
            .map(Clock::engine_id)
            .or(self.detached_engine_id.as_deref())
    }
}
