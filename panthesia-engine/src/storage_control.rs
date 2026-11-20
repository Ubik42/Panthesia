//! One exclusion boundary for data-changing operations and unresolved recovery files.
use crate::{Command, Player};
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
pub(crate) struct RuntimeLifetime {
    pub stop: std::sync::Arc<AtomicBool>,
    pub tx: std::sync::mpsc::Sender<crate::runtime_request::Request>,
}
impl Drop for RuntimeLifetime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = self.tx.send(crate::runtime_request::Request::Shutdown);
    }
}

pub(super) fn allowed(command: &Command) -> bool {
    matches!(
        command,
        Command::Panic
            | Command::ReadHistoryOperation { .. }
            | Command::CancelHistoryOperation { .. }
            | Command::ReadLibraryOpen { .. }
            | Command::CancelLibraryOpen { .. }
            | Command::Pause
            | Command::StopFingerDemo { .. }
            | Command::FingerDemoState
            | Command::CurrentSong
            | Command::Session
            | Command::Tasks
            | Command::CancelTask { .. }
            | Command::CancelHistoryRead { .. }
            | Command::RetrySave
            | Command::RetrySettingsSave { .. }
            | Command::ReadStorageStatus
            | Command::SkipStartupSong
            | Command::RetryStartup
            | Command::DismissStartupWarning { .. }
    )
}
pub(super) fn check_command(busy: &AtomicBool, command: &Command) -> Result<(), String> {
    if busy.load(Ordering::Acquire) && !allowed(command) {
        Err("练习资料正在保存或恢复，请等待任务结束；止音仍可使用。保存失败时可重试保存".into())
    } else {
        Ok(())
    }
}
pub(super) fn recovery_pending(data: &Path) -> bool {
    crate::storage_recovery::Status::read(data).blocked()
}
pub(super) fn recovery(player: &Player) -> crate::storage_recovery::Status {
    player.pending_saves.as_ref().map_or_else(
        || crate::storage_recovery::Status::read(&player.data),
        |pipeline| pipeline.recovery(),
    )
}
pub(super) fn status(player: &Player) -> crate::pending_save::Status {
    let mut status = player
        .pending_saves
        .as_ref()
        .map_or_else(Default::default, |pipeline| pipeline.status());
    if let Some(error) = player
        .asset_recovery_error
        .as_deref()
        .or_else(|| player.history.write_block_reason())
    {
        status.pending = true;
        status.error = Some(error.to_owned());
        status.can_retry = false;
    }
    status
}
impl Player {
    pub(super) fn has_save_error(&self) -> bool {
        self.save_error.is_some() || self.settings_save_error.is_some()
    }
    pub(super) fn has_storage_error(&self) -> bool {
        self.has_save_error() || self.storage_recovery_error.is_some()
    }
}
pub(super) fn unblock(player: &mut Player) {
    if player
        .startup
        .as_ref()
        .is_some_and(|control| !control.status().ready)
    {
        return;
    }
    if player.storage_id.is_some() {
        return;
    }
    let recovery = recovery(player);
    let blocked = recovery.blocked()
        || player.history.write_block_reason().is_some()
        || player.asset_recovery_error.is_some()
        || player
            .pending_saves
            .as_ref()
            .is_some_and(|pipeline| pipeline.excludes_playback());
    if blocked {
        if matches!(player.state.status.as_str(), "playing" | "countIn") {
            player.panic();
            player.state.status = "paused".into();
            player.time_connected = false;
        }
        player.storage_busy.store(true, Ordering::Release);
        if player.state.error.is_none() || player.state.error == player.storage_recovery_error {
            let error = recovery.message().map(str::to_owned).or_else(|| {
                (!recovery.checked).then(|| {
                    "资料恢复状态尚未确认，已暂停修改。请等待后台读取或重新启动后继续。".into()
                })
            });
            player.state.error = error.clone();
            player.storage_recovery_error = error;
        }
    } else {
        if player.state.error == player.storage_recovery_error {
            player.state.error = None;
        }
        player.storage_recovery_error = None;
        if player.storage_busy.load(Ordering::Acquire) && !player.recorder.is_recording() {
            // Attacks were monitored while storage was frozen. Never replay old
            // attacks into a new assessment, but deliver queued releases so a
            // held key or pedal cannot become stuck at the storage boundary.
            for _ in 0..4096 {
                let Ok(event)=player.input_rx.try_recv() else {break};
                let bytes=event.bytes();
                if bytes.len()>=3 && (bytes[0]&240==128 || bytes[0]&240==144 && bytes[2]==0 || bytes[0]&240==176 && bytes[1]==64 && bytes[2]==0) {player.input_event(event);}
            }
            player.input_overflow.store(false, Ordering::Release);
        }
        player.storage_busy.store(false, Ordering::Release);
    }
}

/// Register work before checking shutdown, so the close fence cannot miss an admitted writer.
pub(crate) struct PendingOperation(std::sync::Arc<std::sync::atomic::AtomicUsize>);
pub(crate) struct WriterObservation {
    epoch: u64,
    storage_version: String,
    quiet: bool,
}
impl Drop for PendingOperation {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
impl crate::Engine {
    fn writers_quiet(&self) -> bool {
        self.imports_in_flight.load(Ordering::Acquire) == 0 && !self.pending_saves.status().pending
    }
    pub(crate) fn observe_writers(&self) -> WriterObservation {
        // Capture admission order before reading data, including writers that
        // finish too quickly to appear in both pending-count observations.
        WriterObservation {
            epoch: self.operation_epoch.load(Ordering::Acquire),
            storage_version: self.pending_saves.status().version,
            quiet: self.writers_quiet(),
        }
    }
    pub(crate) fn writers_settled(&self, observation: &WriterObservation) -> bool {
        observation.quiet
            && self.writers_quiet()
            && self.pending_saves.status().version == observation.storage_version
            && self.operation_epoch.load(Ordering::Acquire) == observation.epoch
    }
    pub(super) fn pending_operation(&self) -> Result<PendingOperation, String> {
        self.imports_in_flight.fetch_add(1, Ordering::AcqRel);
        self.operation_epoch.fetch_add(1, Ordering::AcqRel);
        let guard = PendingOperation(self.imports_in_flight.clone());
        if self.closing.load(Ordering::Acquire) {
            return Err("正在保存并关闭练习室，请等待完成".into());
        }
        Ok(guard)
    }
}

/// Indexers may resume after publication, but must leave an interrupted transaction's inputs intact.
pub(crate) fn workspace_writable(data: &Path) -> Result<(), String> {
    if crate::asset_storage::pending(data)
        || data
            .join("practice-import-journal.json")
            .try_exists()
            .unwrap_or(true)
    {
        return Err("曲库资料尚待恢复，已暂停自动整理，请重新启动练习室完成恢复".into());
    }
    Ok(())
}
