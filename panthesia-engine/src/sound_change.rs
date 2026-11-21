//! Prepare hardware off playback, then acknowledge only the installed and persisted selection.
use crate::*;
pub(crate) struct Guard {
    tx: mpsc::Sender<runtime_request::Request>,
    id: String,
    done: bool,
}
impl Guard {
    pub fn finish(mut self) {
        self.done = true;
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        if !self.done {
            let _ = self
                .tx
                .send(runtime_request::Request::SoundChangeAbort(self.id.clone()));
        }
    }
}
impl Engine {
    pub(super) fn open_sound_editor(&self) -> Result<serde_json::Value, String> {
        let engine = self.clone();
        self.tasks.run("打开音源窗口", None, move |token| {
            let _pending = engine.pending_operation()?;
            if engine.snapshot().sound.changing {
                return Err("音源正在切换，请等待完成后再打开乐器窗口".into());
            }
            let generation = engine.sound.generation();
            token.begin_commit()?;
            token.stage("openingEditor")?;
            engine.sound.open_editor(generation)?;
            Ok(serde_json::json!({"ok":true}))
        })
    }

    pub(super) fn begin_sound_change(
        &self,
        font: bool,
    ) -> Result<(String, u64, Guard), String> {
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = format!("sound-{}", SERIAL.fetch_add(1, Ordering::Relaxed));
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::SoundChangeBegin {
                id: id.clone(),
                font,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let guard = Guard {
            tx: self.tx.clone(),
            id: id.clone(),
            done: false,
        };
        let revision = receiver.recv().map_err(|_| "音源切换准备通道已关闭")??;
        Ok((id, revision, guard))
    }
    pub(super) fn change_audio_device(&self,name:Option<String>)->Result<serde_json::Value,String>{
        let engine=self.clone();
        self.tasks.run("连接发声设备",None,move|token|{
            let _pending=engine.pending_operation()?;
            let snapshot=engine.snapshot();
            let output=snapshot.output_id.clone();
            let font=audio::Audio::prepare_font(&snapshot.soundfont)?;
            let(id,revision,guard)=engine.begin_sound_change(false)?;
            let prepared=engine.sound.prepare_device(name,output,font,token.clone())?;
            token.check()?;
            let(reply,receiver)=mpsc::sync_channel(1);
            engine.tx.send(runtime_request::Request::SoundOutputCommit{id,revision,prepared,token,reply}).map_err(|_|"音乐引擎已关闭")?;
            let result=receiver.recv().map_err(|_|"设备保存通道已关闭")?;
            if result.is_ok(){guard.finish();}result
        })
    }
    pub(super) fn change_output(&self, name: Option<String>) -> Result<serde_json::Value, String> {
        let engine = self.clone();
        self.tasks.run("连接演奏音源", None, move |token| {
            let _pending = engine.pending_operation()?;
            token.check()?;
            token.stage("connectingSound")?;
            let (id, revision, guard) = engine.begin_sound_change(false)?;
            let prepared = engine.sound.prepare_output(name, token.clone())?;
            token.check()?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::SoundOutputCommit {
                    id,
                    revision,
                    prepared,
                    token,
                    reply,
                })
                .map_err(|_| "音乐引擎已关闭")?;
            let result = receiver.recv().map_err(|_| "演奏音源保存结果通道已关闭")?;
            if result.is_ok() {
                guard.finish();
            }
            result
        })
    }
}
impl Player {
    pub(super) fn begin_sound_change(
        &mut self,
        id: String,
        font: bool,
    ) -> Result<u64, String> {
        if self.sound_change.is_some() {
            return Err("音源正在切换，请等待当前任务完成".into());
        }
        if font {
            self.check_soundfont_conditions()?;
        }
        self.panic();
        if matches!(self.state.status.as_str(), "playing" | "countIn") {
            self.state.status = "paused".into();
            self.state.count_remaining = 0.;
        }
        self.time_connected = false;
        self.sound_change = Some(id);
        Ok(self.soundfont_revision)
    }
    pub(super) fn validate_sound_change(&self, id: &str, revision: u64) -> Result<(), String> {
        if self.sound_change.as_deref() != Some(id) || self.soundfont_revision != revision {
            return Err("音源设置已改变，请重新选择".into());
        }
        Ok(())
    }
    pub(super) fn abort_sound_change(&mut self, id: &str) {
        if self.sound_change.as_deref() == Some(id) {
            self.sound_change = None;
        }
    }
    pub(super) fn install_output(
        &mut self,
        id: &str,
        revision: u64,
        prepared: sound_runtime::Prepared,
        token: &background_tasks::TaskToken,
    ) -> Result<serde_json::Value, String> {
        self.validate_sound_change(id, revision)?;
        token.begin_commit()?;
        let name = prepared.name.clone();
        let label = prepared.label.clone();
        let device=prepared.device.clone();
        self.panic();
        prepared.activate()?;
        if let Some(device)=device {self.preferences.audio_device=device;}
        self.sound_change = None;
        self.state.output = label;
        self.preferences.output = name;
        self.soundfont_revision = self.soundfont_revision.wrapping_add(1);
        self.restore_latency();
        // A device transition pauses transport without discarding the clock,
        // accumulated practice time, saved result, or current musical position.
        self.restore_track_sound();
        self.persist()?;
        Ok(serde_json::json!({"ok":true}))
    }
    pub(super) fn sound_click(&self, accent: bool) {
        if let Some(host) = &self.sound_host {
            host.click(accent);
        } else if let Some(audio) = &self.audio {
            audio.click(accent);
        }
    }
    pub(super) fn check_sound(&mut self) {
        let Some(host) = &self.sound_host else {
            return;
        };
        let error = host.status().error;
        if error == self.sound_status_error {
            return;
        }
        if let Some(error) = &error {
            self.panic();
            if matches!(self.state.status.as_str(), "playing" | "countIn") {
                self.state.status = "paused".into();
                self.state.count_remaining = 0.;
            }
            if self.state.error.is_none() || self.state.error == self.sound_status_error {
                self.state.error = Some(error.clone());
            }
        } else if self.state.error == self.sound_status_error {
            self.state.error = None;
        }
        self.sound_status_error = error;
    }
}
