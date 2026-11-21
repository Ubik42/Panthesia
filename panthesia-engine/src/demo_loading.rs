//! Build and validate finger auditions without sorting or reading annotations on the playback thread.
use crate::*;

pub(crate) fn supports(command: &Command) -> bool {
    matches!(
        command,
        Command::StartFingerDemo { .. }
            | Command::StartHeldFingerDemo { .. }
            | Command::StartPairFingerDemo { .. }
    )
}
pub(crate) struct Context {
    source: asset_edit::Context,
    origin: Origin,
}
pub(crate) struct Origin {
    fingerprint: String,
    request_id: String,
}
pub(crate) struct Prepared {
    demo: finger_demo::Demo,
}
impl Player {
    fn audition_origin(&self) -> Result<String, String> {
        let tracks: Vec<_> = self
            .config
            .tracks
            .iter()
            .map(|track| {
                (
                    track.track_id,
                    track.practice_part,
                    track.visible,
                    match track.player {
                        PlayerConfig::Mute => 0,
                        PlayerConfig::Auto => 1,
                        PlayerConfig::Human => 2,
                    },
                )
            })
            .collect();
        let bytes = serde_json::to_vec(&(
            self.file.as_ref().map(|file| &file.content_id),
            self.score_revision,
            self.state.annotation_revision,
            tracks,
            &self.state.hands,
            self.state.speed,
            self.audio_stop_epoch,
            self.state.midi_events,
            self.finger_demo.as_ref().map(|demo| &demo.id),
        ))
        .map_err(|error| error.to_string())?;
        Ok(blake3::hash(&bytes).to_hex().to_string())
    }
    pub(super) fn prepare_audition(
        &self,
        scope: Option<practice_edit::Scope>,
        request_id: String,
    ) -> Result<Context, String> {
        self.check_demo_idle()
            .map_err(|_| "请先停止练习和录音，并松开琴键，再开始示范")?;
        self.check_practice_scope(scope.as_ref())?;
        self.check_replay_start(&request_id)?;
        Ok(Context {
            source: self.capture_practice_read_context(),
            origin: Origin {
                fingerprint: self.audition_origin()?,
                request_id,
            },
        })
    }
    pub(super) fn install_audition(
        &mut self,
        origin: Origin,
        prepared: Prepared,
        token: &background_tasks::TaskToken,
    ) -> Result<serde_json::Value, String> {
        self.check_demo_idle()
            .map_err(|_| "示范准备期间练习状态已变化，请暂停并松开琴键后重试")?;
        self.check_replay_start(&origin.request_id)?;
        if self.audition_origin()? != origin.fingerprint {
            return Err("示范准备期间曲目、指法或发声状态已变化，请重新开始示范".into());
        }
        token.begin_commit()?;
        token.stage("preparingPlayback")?;
        self.install_prepared_audition(prepared.demo, origin.request_id)
    }
}
impl Engine {
    pub fn start_practice_demo(
        &self,
        request: practice_edit::Request,
    ) -> Result<serde_json::Value, String> {
        let id = request.request_id.ok_or("示范请求缺少操作标识")?;
        if !id.starts_with("demo-start-")
            || id.len() <= 11
            || id.len() > 96
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            return Err("示范操作标识无效".into());
        }
        self.audition_task(
            request.command,
            Some(practice_edit::Scope {
                engine_id: request.engine_id.clone(),
                content_id: request.content_id,
                score_revision: request.score_revision,
                annotation_revision: request.annotation_revision,
            }),
            Some(id),
        )
    }
    pub(super) fn audition_task(
        &self,
        command: Command,
        scope: Option<practice_edit::Scope>,
        request_id: Option<String>,
    ) -> Result<serde_json::Value, String> {
        if !supports(&command) {
            return Err("此入口只接受指法声音示范".into());
        }
        if self.closing.load(Ordering::Acquire) {
            return Err("正在关闭练习室，请等待完成".into());
        }
        storage_control::check_command(&self.storage_busy, &command)?;
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let request_id = request_id.unwrap_or_else(|| {
            format!(
                "demo-start-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            )
        });
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::AuditionContext {
                scope,
                request_id,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let context = receiver.recv().map_err(|_| "示范准备通道已关闭")??;
        let source = context.source.score_identity().map(|(id, _)| id);
        let engine = self.clone();
        self.tasks.run("准备指法声音示范", source, move |token| {
            token.stage("preparingPlayback")?;
            // Retain the lightweight origin for admission; only the detached musical state is consumed.
            let Context { source, origin } = context;
            let mut reader = (|| {
                    let mut reader = source.into_player(false)?;
                    reader.validate_practice_annotations()?;
                    reader.command(command)?;
                    Ok::<_, String>(reader)
                })()?;
            token.check()?;
            let prepared = Prepared {
                demo: reader.finger_demo.take().ok_or("示范准备结果缺失")?,
            };
            drop(reader);
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::AuditionCommit {
                    origin,
                    prepared,
                    token,
                    reply,
                })
                .map_err(|_| "音乐引擎已关闭")?;
            receiver.recv().map_err(|_| "示范开始结果通道已关闭")?
        })
    }
}

impl Player {
    pub(crate) fn cancel_replay_start(&mut self, id: &str) {
        if valid_request_id(id) && !self.cancelled_replay_starts.iter().any(|saved| saved == id) {
            self.cancelled_replay_starts.push_back(id.into());
            // More than the two workers plus eight queued jobs, with room for reordering.
            while self.cancelled_replay_starts.len() > 64 {
                self.cancelled_replay_starts.pop_front();
            }
        }
    }
    fn check_demo_idle(&self) -> Result<(), String> {
        if ["playing", "countIn"].contains(&self.state.status.as_str())
            || self.recorder.is_recording()
            || !self.state.pressed.is_empty()
        {
            return Err("请先停止练习和录音，并松开琴键".into());
        }
        Ok(())
    }
    pub(crate) fn check_replay_start(&self, id: &str) -> Result<(), String> {
        if self.cancelled_replay_starts.iter().any(|saved| saved == id) {
            return Err("这次声音准备已停止，请重新开始".into());
        }
        Ok(())
    }
}
fn valid_request_id(id: &str) -> bool {
    id.starts_with("demo-start-")
        && id.len() > 11
        && id.len() <= 96
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
