//! Clip preparation reads archives on a worker; the actor applies a small, versioned edit.
use crate::*;
use panthesia_core::practice_history::{ReplayClip, validate_replay_clips};

pub(crate) fn supports(command: &Command) -> bool {
    matches!(
        command,
        Command::SaveHistoryReplayClip { .. } | Command::DeleteHistoryReplayClip { .. }
    )
}
pub(crate) struct Context {
    data: PathBuf,
    history: PracticeHistoryStore,
}
pub(crate) struct Prepared {
    content_id: String,
    id: String,
    origin: PracticeHistoryStore,
    old: Vec<ReplayClip>,
    clips: Vec<ReplayClip>,
    response: serde_json::Value,
}
impl Context {
    fn prepare(
        self,
        command: Command,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<Prepared, String> {
        check()?;
        let (content_id, id, expected) = match &command {
            Command::SaveHistoryReplayClip {
                content_id,
                id,
                expected,
                ..
            }
            | Command::DeleteHistoryReplayClip {
                content_id,
                id,
                expected,
                ..
            } => (content_id, id, expected),
            _ => return Err("回放片段操作无效".into()),
        };
        let song = self.history.song(content_id).ok_or("曲目记录不存在")?;
        let session = song
            .sessions
            .iter()
            .find(|session| session.stable_id() == *id)
            .ok_or("这条记录已不在历史中")?;
        let old = session.replay_clips.clone();
        let repeated = if let Command::SaveHistoryReplayClip {
            clip_id: None,
            request_id: Some(request),
            source,
            name,
            start,
            end,
            notes,
            ..
        } = &command
        {
            if request.is_empty()
                || request.len() > 128
                || !request
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            {
                return Err("回放片段请求编号无效".into());
            }
            let key = format!("clip-{request}");
            if let Some(clip) = old.iter().find(|clip| clip.id == key) {
                if clip.name != name.trim()
                    || clip.start != *start
                    || clip.end != *end
                    || clip.notes != *notes
                    || source
                        .as_ref()
                        .and_then(|value| value.performance_revision.as_ref())
                        .is_some_and(|revision| {
                            clip.performance_revision.as_ref() != Some(revision)
                        })
                {
                    return Err("这个收藏请求已有不同内容，请核对原结果".into());
                }
                true
            } else {
                false
            }
        } else {
            false
        };
        if !repeated && crate::replay_clips::revision(&old) != *expected {
            return Err("回放片段已更新，请重新读取后再保存".into());
        }
        let mut clips = old.clone();
        if !repeated {
            match &command {
                Command::SaveHistoryReplayClip {
                    clip_id,
                    request_id,
                    source,
                    name,
                    start,
                    end,
                    notes,
                    ..
                } => {
                    let time = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default();
                    let row = ReplayClip {
                        id: clip_id.clone().unwrap_or_else(|| {
                            request_id
                                .as_ref()
                                .map(|request| format!("clip-{request}"))
                                .unwrap_or_else(|| format!("clip-{}", time.as_nanos()))
                        }),
                        name: name.trim().into(),
                        start: *start,
                        end: *end,
                        notes: notes.clone(),
                        updated_at_unix_ms: time.as_millis() as u64,
                        performance_revision: source
                            .as_ref()
                            .and_then(|source| source.performance_revision.clone()),
                    };
                    if let Some(key) = clip_id {
                        *clips
                            .iter_mut()
                            .find(|clip| clip.id == *key)
                            .ok_or("这个回放片段已不存在，请重新读取")? = row;
                    } else {
                        clips.push(row);
                    }
                    // Reject malformed edits before loading a potentially large recording.
                    validate_replay_clips(&clips, None)?;
                    let watch = load_pipeline::Watch::capture(&performance_archive::path(
                        &self.data, content_id, id,
                    ))?;
                    check()?;
                    let (archive, revision) =
                        performance_archive::read_versioned(&self.data, content_id, id)?;
                    if let Some(source) = source {
                        source.require_performance()?;
                        source.check_context(&history_loading::Context::capture(
                            &self.history,
                            content_id,
                            id,
                            false,
                        )?)?;
                        source.check_performance(&revision)?;
                    }
                    check()?;
                    let written = if let Some(key) = clip_id {
                        clips.iter_mut().find(|row| &row.id == key)
                    } else {
                        clips.last_mut()
                    };
                    let row = written.ok_or("回放片段准备结果缺少保存目标，请重新读取后保存")?;
                    validate_replay_clips(std::slice::from_ref(row), Some(archive.duration))?;
                    row.performance_revision = Some(revision);
                    watch.check()?;
                }
                Command::DeleteHistoryReplayClip { clip_id, .. } => {
                    clips.retain(|clip| clip.id != *clip_id);
                    if clips.len() == old.len() {
                        return Err("这个回放片段已不存在，请重新读取".into());
                    }
                }
                _ => unreachable!(),
            }
        }
        check()?;
        let response =
            serde_json::json!({"clips": clips, "revision": crate::replay_clips::revision(&clips)});
        Ok(Prepared {
            content_id: content_id.clone(),
            id: id.clone(),
            origin: self.history,
            old,
            clips,
            response,
        })
    }
}
impl Player {
    pub(super) fn capture_clip_edit(&self) -> Context {
        Context {
            data: self.data.clone(),
            history: self.history.clone(),
        }
    }
    pub(super) fn install_clip_edit(
        &mut self,
        prepared: Prepared,
        token: Option<&background_tasks::TaskToken>,
    ) -> Result<serde_json::Value, String> {
        // Import/restore replaces the song snapshot even when clip text happens to be equal.
        // Unrelated songs can change while this worker prepares without invalidating its edit.
        if !self
            .history
            .same_song_snapshot(&prepared.origin, &prepared.content_id)
        {
            return Err("这次演奏的资料已更新，请重新读取回放片段后保存".into());
        }
        if let Some(token) = token {
            token.begin_commit()?;
        }
        if prepared.old == prepared.clips {
            return Ok(prepared.response);
        }
        self.history.set_replay_clips(
            &prepared.content_id,
            &prepared.id,
            prepared.old,
            prepared.clips,
        )?;
        Ok(prepared.response)
    }
    pub(super) fn edit_clips_owned(
        &mut self,
        command: Command,
    ) -> Result<serde_json::Value, String> {
        let prepared = self.capture_clip_edit().prepare(command, || Ok(()))?;
        self.install_clip_edit(prepared, None)
    }
}
impl Engine {
    pub fn edit_history_clips(&self, command: Command) -> Result<serde_json::Value, String> {
        if !supports(&command) {
            return Err("此入口只接受回放片段保存或删除".into());
        }
        self.command(command)
    }
    pub(super) fn history_clip_task(&self, command: Command) -> Result<serde_json::Value, String> {
        let pending = self.pending_operation()?;
        let content = match &command {
            Command::SaveHistoryReplayClip { content_id, .. }
            | Command::DeleteHistoryReplayClip { content_id, .. } => content_id.clone(),
            _ => return Err("回放片段操作无效".into()),
        };
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::ClipEditContext(reply))
            .map_err(|_| "音乐引擎已关闭")?;
        let context = receiver
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "回放片段准备通道未及时回复，请重新读取")??;
        let engine = self.clone();
        self.tasks.run("保存回放片段", Some(content), move |token| {
            // A caller may stop waiting while a commit is still running. Keep the
            // admission lease with the actual job until persistence acknowledges it.
            let _pending = pending;
            token.stage("readingHistory")?;
            let prepared = context.prepare(command, || token.check())?;
            token.check()?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::ClipEditCommit {
                    prepared,
                    token,
                    reply,
                })
                .map_err(|_| "音乐引擎已关闭")?;
            // The persistence barrier releases this reply only after the settings write.
            receiver.recv().map_err(|_| "回放片段保存通道已关闭")?
        })
    }
}
