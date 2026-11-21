//! Playback freezes a take; CPU workers encode/prepare replay, storage publishes the MIDI.
use crate::*;
use panthesia_core::recorder::RecordedTake;

pub(crate) struct Context {
    take: RecordedTake,
    path: PathBuf,
    replay: Option<asset_edit::Context>,
}
pub(crate) struct Outcome {
    path: PathBuf,
    replay: Option<Result<asset_edit::Outcome, String>>,
}
struct Encoded {
    path: PathBuf,
    bytes: Vec<u8>,
}
impl Context {
    fn encode(
        self,
        token: &background_tasks::TaskToken,
    ) -> Result<(Encoded, Option<asset_edit::Context>), String> {
        token.stage("encoding")?;
        let mut bytes = Vec::new();
        self.take
            .as_smf()
            .map_err(|e| e.to_string())?
            .write_std(&mut bytes)
            .map_err(|e| e.to_string())?;
        token.check()?;
        Ok((
            Encoded {
                path: self.path,
                bytes,
            },
            self.replay,
        ))
    }
}
impl Encoded {
    fn matches_existing(&self) -> std::io::Result<Option<bool>> {
        use std::io::Read;
        let mut file = match std::fs::File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        if file.metadata()?.len() != self.bytes.len() as u64 {
            return Ok(Some(false));
        }
        let mut buffer = [0u8; 64 * 1024];
        for expected in self.bytes.chunks(buffer.len()) {
            match file.read_exact(&mut buffer[..expected.len()]) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                    return Ok(Some(false));
                }
                Err(error) => return Err(error),
            }
            if buffer[..expected.len()] != *expected {
                return Ok(Some(false));
            }
        }
        Ok(Some(file.read(&mut buffer[..1])? == 0))
    }
    fn publish(self) -> Result<(), String> {
        let conflict = || {
            format!(
                "录音保存位置已有其他内容，请保留该文件：{}",
                self.path.display()
            )
        };
        match self
            .matches_existing()
            .map_err(|error| format!("录音保存位置无法读取：{error}"))?
        {
            Some(true) => return Ok(()),
            Some(false) => return Err(conflict()),
            None => {}
        }
        // Creation itself rejects replacement, including a file created after the first check.
        if let Err(error) = panthesia_core::utils::atomic_file::write_new(&self.path, &self.bytes) {
            return match self.matches_existing() {
                Ok(Some(true)) => Ok(()),
                Ok(Some(false)) => Err(conflict()),
                _ => Err(format!("录音无法保存：{error}")),
            };
        }
        Ok(())
    }
}
struct Guard {
    tx: mpsc::Sender<runtime_request::Request>,
    id: String,
    finished: bool,
}
impl Guard {
    fn finish(
        mut self,
        result: Result<Outcome, String>,
        reply: Option<runtime_request::Reply>,
    ) -> Result<(), String> {
        self.tx
            .send(runtime_request::Request::RecordingSaveFinish {
                id: self.id.clone(),
                result,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        self.finished = true;
        Ok(())
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        if !self.finished {
            let _ = self.tx.send(runtime_request::Request::RecordingSaveFinish {
                id: self.id.clone(),
                result: Err("录音保存未完成，原始演奏仍保留在本次运行中，请重试保存录音".into()),
                reply: None,
            });
        }
    }
}
impl Engine {
    pub(super) fn save_recording_task(&self) -> Result<serde_json::Value, String> {
        // Stop at the user's request, even when the storage lane is still draining writes.
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = format!(
            "recording-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        );
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::RecordingSaveBegin {
                id: id.clone(),
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let context = receiver.recv().map_err(|_| "停止录音结果通道已关闭")??;
        let guard = Guard {
            tx: self.tx.clone(),
            id,
            finished: false,
        };
        let engine = self.clone();
        self.tasks.run("保存自由演奏录音", None, move |token| {
            token.check()?;
            let result = (|| {
                let (encoded, replay) = context.encode(&token)?;
                let path = encoded.path.clone();
                token.begin_commit()?;
                engine
                    .storage_tasks
                    .run_owned("写入录音文件", move |child| {
                        child.begin_commit()?;
                        encoded.publish()?;
                        Ok(serde_json::json!({"ok":true}))
                    })?;
                token.stage("preparingPlayback")?;
                let replay = replay
                    .filter(|_| !engine.closing.load(Ordering::Acquire))
                    .map(|context| {
                        context.prepare_switch(song_switch::Input::Recording(path.clone()), &token)
                    });
                Ok(Outcome { path, replay })
            })();
            let (reply, receiver) = mpsc::sync_channel(1);
            guard.finish(result, Some(reply))?;
            receiver.recv().map_err(|_| "录音保存结果通道已关闭")?
        })
    }
}
impl Player {
    pub(super) fn begin_recording_save(&mut self, id: String) -> Result<Context, String> {
        if self.storage_busy.load(Ordering::Acquire) {
            return Err("其他资料正在保存，请稍候再保存录音".into());
        }
        self.panic();
        self.state.recording = false;
        self.state.status = "paused".into();
        self.time_connected = false;
        let take = self
            .recorder
            .freeze()
            .map_err(|_| "这段录音没有演奏音符，请开始新的录音")?;
        let path = self
            .recording_path
            .get_or_insert_with(|| {
                static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
                let time = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                self.data.join("recordings").join(format!(
                    "演奏-{time}-{}.mid",
                    SERIAL.fetch_add(1, Ordering::Relaxed)
                ))
            })
            .clone();
        let replay = (!self.closing.load(Ordering::Acquire))
        .then(|| self.capture_asset_context(true, false));
        self.storage_id = Some(id);
        self.storage_busy.store(true, Ordering::Release);
        Ok(Context { take, path, replay })
    }
    pub(super) fn finish_recording_save(
        &mut self,
        id: &str,
        result: Result<Outcome, String>,
    ) -> Result<serde_json::Value, String> {
        if self.storage_id.as_deref() != Some(id) {
            self.retire(result);
            return Err("录音保存任务已结束或失效".into());
        }
        let outcome = match result {
            Ok(outcome) => outcome,
            Err(error) => {
                self.storage_id = None;
                storage_control::unblock(self);
                self.state.error = Some(error.clone());
                return Err(error);
            }
        };
        // MIDI publication is independent of replay preparation or preference persistence.
        self.recording_saved = true;
        self.recording_path = Some(outcome.path.clone());
        let installed = if let Some(replay) = outcome.replay {
            // A published replay installs even when closing began after its commit.
            // Playback installation preserves the live devices and suppresses the metronome on close.
            self.finish_asset_edit(id, replay)
        } else {
            self.storage_id = None;
            storage_control::unblock(self);
            self.state.error = None;
            Ok(serde_json::json!({"ok":true,"path":outcome.path}))
        };
        match installed {
            Ok(value) => Ok(value),
            Err(error) => {
                let detail = self.state.error.clone().unwrap_or(error);
                let message = format!(
                    "录音已保存到 {}，回放暂未打开：{detail}",
                    outcome.path.display()
                );
                self.state.error = Some(message.clone());
                Err(message)
            }
        }
    }
}
