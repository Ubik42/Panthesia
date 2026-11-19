//! SoundFont decode stays on CPU workers. Playback owns only the device transition.
use crate::*;
pub(crate) struct Prepared {
    pub path: PathBuf,
    pub font: oxisynth::SoundFont,
    pub presets: Vec<track_sound::Preset>,
    watch: load_pipeline::Watch,
}
impl Prepared {
    pub fn read(path: PathBuf) -> Result<Self, String> {
        let path = path
            .canonicalize()
            .map_err(|e| format!("找不到音色文件：{e}"))?;
        let watch = load_pipeline::Watch::capture(&path)?;
        let font = audio::Audio::prepare_font(&path)?;
        let presets = track_sound::presets(&path);
        if presets.is_empty() {
            return Err("音色文件缺少可用的旋律音色预设".into());
        }
        watch.check()?;
        Ok(Self {
            path,
            font,
            presets,
            watch,
        })
    }
    fn check(&self) -> Result<(), String> {
        self.watch.check()
    }
}
pub(crate) struct LivePrepared {pub path:PathBuf,pub presets:Vec<track_sound::Preset>,pub connection:sound_runtime::Prepared}
impl Engine {
    pub(super) fn soundfont_task(&self,path:PathBuf)->Result<serde_json::Value,String>{
        let engine=self.clone();
        self.tasks.run("准备钢琴音源",None,move|token|{
            let _pending=engine.pending_operation()?;
            token.check()?;
            let (id,revision,guard)=engine.begin_sound_change(true,None)?;
            token.stage("readingSound")?;
            let prepared=Prepared::read(path)?;
            token.check()?;
            let Prepared{path,font,presets,watch}=prepared;
            token.stage("connectingSound")?;
            let connection=engine.sound.prepare_font(font,token.clone())?;
            watch.check()?;token.check()?;
            let prepared=LivePrepared{path,presets,connection};
            let (reply,receiver)=mpsc::sync_channel(1);
            engine.tx.send(runtime_request::Request::SoundFontLiveCommit{id,revision,prepared,token,reply}).map_err(|_|"音乐引擎已关闭")?;
            let result=receiver.recv().map_err(|_|"钢琴音源保存结果通道已关闭")?;
            if result.is_ok(){guard.finish();}result
        })
    }
}
impl Player {
    pub(super) fn soundfont_context(&self) -> Result<u64, String> {
        if self.sound_change.is_some(){return Err("音源正在切换，请等待当前任务完成".into());}
        self.check_soundfont_conditions()?;
        Ok(self.soundfont_revision)
    }
    pub(super) fn check_soundfont_conditions(&self) -> Result<(), String> {
        if self.routine.is_some() || self.ladder.is_some() {
            return Err("请先结束当前计划项目再更换音源".into());
        }
        if self.recorder.is_recording() {
            return Err("请先停止并保存录音，再更换音源".into());
        }
        Ok(())
    }
    pub(super) fn install_live_soundfont(&mut self,id:&str,revision:u64,prepared:LivePrepared,token:&background_tasks::TaskToken)->Result<serde_json::Value,String>{
        self.check_soundfont_conditions()?;self.validate_sound_change(id,revision)?;token.begin_commit()?;
        let LivePrepared{path,presets,connection}=prepared;
        self.panic();connection.activate()?;self.sound_change=None;
        self.soundfont=path.clone();let old=std::mem::replace(&mut self.soundfont_presets,presets.into());self.retire(old);
        self.soundfont_revision=self.soundfont_revision.wrapping_add(1);
        self.state.soundfont=path.clone();self.state.soundfont_status="ready".into();self.state.soundfont_warning=None;
        self.restore_track_sound();
        Ok(serde_json::json!({"ok":true,"path":path,"soundPresets":self.soundfont_presets}))
    }
    pub(super) fn install_soundfont_owned(
        &mut self,
        revision: u64,
        prepared: Prepared,
    ) -> Result<serde_json::Value, String> {
        if self.soundfont_context()? != revision {
            return Err("音源设置已改变，请重新选择音源".into());
        }
        prepared.check()?;
        let Prepared {
            path,
            font,
            presets,
            ..
        } = prepared;
        let needs_audio = !self.silent
            && (self.audio.is_some() || (self.vst.is_none() && self.output_connection.is_none()));
        let (replacement, retained) = if needs_audio {
            let audio = audio::Audio::open_font(font)?;
            audio.set_volume(self.state.volume);
            (Some(audio), None)
        } else {
            (None, Some(font))
        };
        self.panic();
        self.audio = replacement;
        self.prepared_font = retained;
        self.soundfont = path.clone();
        let old=std::mem::replace(&mut self.soundfont_presets,presets.into());self.retire(old);
        self.soundfont_revision = self.soundfont_revision.wrapping_add(1);
        self.state.soundfont = path.clone();
        self.state.soundfont_status = "ready".into();
        self.state.soundfont_warning = None;
        if !self.has_storage_error() {
            self.state.error = None;
        }
        if matches!(self.state.status.as_str(), "playing" | "countIn") {
            self.state.status = "paused".into();
            self.state.count_remaining = 0.;
        }
        self.restore_track_sound();
        Ok(serde_json::json!({"ok":true,"path":path,"soundPresets":self.soundfont_presets}))
    }
}
