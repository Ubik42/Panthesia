//! Native shutdown: stop sound, wait for running writers, report what would be lost.
use crate::*;

/// Things the user may want to return for before the window closes.
#[derive(Clone, Copy)]
pub enum CloseInput {
    StorageProblem,
    Recording,
    RecordingUnsaved,
    SoundUnavailable,
}
impl CloseInput {
    pub fn key(self) -> &'static str {
        match self {
            Self::StorageProblem => "storage-problem",
            Self::Recording => "recording-active",
            Self::RecordingUnsaved => "recording-unsaved",
            Self::SoundUnavailable => "sound-unavailable",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::StorageProblem => "练习资料需要检查",
            Self::Recording | Self::RecordingUnsaved => "本次录音",
            Self::SoundUnavailable => "声音输出",
        }
    }
    pub fn detail(self) -> &'static str {
        match self {
            Self::StorageProblem => "最近一次保存未能完成，磁盘中的原文件继续保留。返回后可重新修改并保存。",
            Self::Recording => "录音仍在记录，尚未保存的录音会在退出后丢失。",
            Self::RecordingUnsaved => "最近的录音尚未保存，可返回停止录音并保存。",
            Self::SoundUnavailable => "声音输出暂时无法响应。可返回检查音频或 MIDI 设备。",
        }
    }
}
pub(crate) struct Fence {
    pub recording: bool,
    pub recording_unsaved: bool,
    pub exclusive: bool,
    pub error: Option<String>,
}
fn temporary_inputs(status: &Fence) -> Vec<CloseInput> {
    if status.recording {
        vec![CloseInput::Recording]
    } else if status.recording_unsaved {
        vec![CloseInput::RecordingUnsaved]
    } else {
        Vec::new()
    }
}
impl Engine {
    pub(super) fn storage_fence(&self) -> Result<Fence, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::StorageFence(reply))
            .map_err(|_| "音乐引擎已关闭")?;
        receiver
            .recv_timeout(Duration::from_secs(125))
            .map_err(|_| "等待资料保存状态超时，请稍后重试当前操作")?
    }
    pub fn prepare_close(&self) -> Result<(), String> {
        self.prepare_close_with_cancel(Arc::new(AtomicBool::new(false)))
    }
    pub fn prepare_close_with_cancel(&self, cancelled: Arc<AtomicBool>) -> Result<(), String> {
        self.prepare_close_inner(cancelled, false).map(|_| ())
    }
    pub fn prepare_desktop_close(&self, cancelled: Arc<AtomicBool>) -> Result<Vec<CloseInput>, String> {
        self.prepare_close_inner(cancelled, true)
    }
    /// Wait until no exclusive operation or background writer is running. With
    /// `report_temporary`, unsaved recordings are reported instead of refusing to close.
    fn prepare_close_inner(&self, cancelled: Arc<AtomicBool>, report_temporary: bool) -> Result<Vec<CloseInput>, String> {
        struct Reset {
            closing: Arc<AtomicBool>,
            complete: bool,
        }
        impl Drop for Reset {
            fn drop(&mut self) {
                if !self.complete {
                    self.closing.store(false, Ordering::Release);
                }
            }
        }
        self.closing.store(true, Ordering::Release);
        if !self.startup.finished.load(Ordering::Acquire) {
            self.startup.skip.store(true, Ordering::Release);
        }
        let mut reset = Reset { closing: self.closing.clone(), complete: false };
        self.command(Command::Panic)?;
        let deadline = Instant::now() + Duration::from_secs(125);
        while Instant::now() < deadline {
            if cancelled.load(Ordering::Acquire) {
                return Err("已取消本次退出".into());
            }
            let fence = self.storage_fence()?;
            let mut inputs = temporary_inputs(&fence);
            if !report_temporary {
                if let Some(input) = inputs.first() {
                    return Err(input.detail().into());
                }
            }
            if !fence.exclusive
                && self.imports_in_flight.load(Ordering::Acquire) == 0
                && self.startup.finished.load(Ordering::Acquire)
            {
                if report_temporary && fence.error.is_some() {
                    inputs.push(CloseInput::StorageProblem);
                }
                if let Err(error) = self.sound.flush() {
                    if !report_temporary {
                        return Err(error);
                    }
                    inputs.push(CloseInput::SoundUnavailable);
                }
                reset.complete = true;
                return Ok(inputs);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Err("保存任务仍在处理，程序暂未关闭，请稍后重试".into())
    }
    pub fn cancel_close(&self) {
        self.closing.store(false, Ordering::Release);
    }
}
