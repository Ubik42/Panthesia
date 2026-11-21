//! Paper lookup runs on a worker; playback installs only a checked musical position.
use crate::*;
use std::sync::atomic::AtomicU64;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperPracticeSnapshot {
    pub content_id: Option<String>,
    pub grid: String,
    pub measures: usize,
    pub measure: usize,
    pub score_revision: u64,
}

pub(crate) struct Context {
    file: SongFile,
    notes: PracticeNotes,
    revision: u64,
    stop_epoch: u64,
    input_epoch: u64,
    status: String,
}
pub(crate) struct Prepared {
    context: Context,
    position: f64,
}

impl Engine {
    pub(super) fn navigate_paper(&self, command: Command) -> Result<serde_json::Value, String> {
        let engine = self.clone();
        let received = Instant::now();
        let (content, scope) = match &command {
            Command::SeekPaperMeasure {
                content_id, scope, ..
            }
            | Command::SeekPaperNote {
                content_id, scope, ..
            } => (
                content_id.clone(),
                scope
                    .as_ref()
                    .map(|scope| (scope.channel.clone(), scope.sequence)),
            ),
            _ => return Err("谱页定位操作无效".into()),
        };
        if let Some((channel, sequence)) = &scope {
            history_reader::ReadScope {
                channel: channel.clone(),
                sequence: *sequence,
            }
            .validate()?;
        }
        let sequence = self
            .paper_navigation
            .fetch_add(1, Ordering::AcqRel)
            .wrapping_add(1);
        let selected = content.clone();
        let work = move |token: background_tasks::TaskToken| {
            let check = || {
                token.check()?;
                if engine.paper_navigation.load(Ordering::Acquire) != sequence {
                    return Err("已选择新的谱页位置".into());
                }
                if received.elapsed() > Duration::from_secs(15) {
                    return Err("谱页定位等待过久，请重新选择位置".into());
                }
                Ok(())
            };
            check()?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::PaperNavigationContext {
                    content_id: content.clone(),
                    reply,
                })
                .map_err(|_| "音乐引擎已关闭")?;
            let context = wait(receiver, &check)?;
            // The worker retains these roots even if playback rejects an outdated installation.
            let retained = (context.file.clone(), context.notes.clone());
            token.stage("readingScore")?;
            let lock = data_locks::lock_for(&engine.data)?;
            let guard = data_locks::wait_for(&lock, &check)?;
            let position = score_attachments::navigation_position(
                &engine.data,
                &content,
                &command,
                &context.file,
                &context.notes,
                &check,
            )?;
            check()?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::PaperNavigationInstall {
                    prepared: Prepared { context, position },
                    sequence,
                    latest: engine.paper_navigation.clone(),
                    received,
                    token: token.clone(),
                    reply,
                })
                .map_err(|_| "音乐引擎已关闭")?;
            // Keep the manifest stable until the short playback-side installation has replied.
            let result = receiver.recv().map_err(|_| "谱页定位通道已关闭")?;
            drop(guard);
            drop(retained);
            result
        };
        if let Some((channel, sequence)) = scope {
            self.tasks.run_latest(
                format!("history-read:{channel}"),
                sequence,
                "从谱页定位练习",
                Some(selected),
                work,
            )
        } else {
            self.tasks.run("从谱页定位练习", Some(selected), work)
        }
    }
}
fn wait<T>(
    receiver: mpsc::Receiver<Result<T, String>>,
    check: &impl Fn() -> Result<(), String>,
) -> Result<T, String> {
    loop {
        check()?;
        match receiver.recv_timeout(Duration::from_millis(25)) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("谱页定位通道已关闭".into()),
        }
    }
}
impl Player {
    pub(super) fn paper_practice_snapshot(&self) -> PaperPracticeSnapshot {
        PaperPracticeSnapshot {
            content_id: self.file.as_ref().map(|file| file.content_id.clone()),
            grid: self.grid_signature(),
            measures: self
                .file
                .as_ref()
                .map_or(0, |file| file.musical_time.measures.len()),
            measure: self.snapshot().measure,
            score_revision: self.score_revision,
        }
    }
    pub(super) fn navigate_paper_owned(
        &mut self,
        command: Command,
    ) -> Result<serde_json::Value, String> {
        let content = match &command {
            Command::SeekPaperMeasure { content_id, .. }
            | Command::SeekPaperNote { content_id, .. } => content_id,
            _ => return Err("谱页定位操作无效".into()),
        };
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let lock = data_locks::lock_for(&self.data)?;
        let _guard = lock.lock().map_err(|_| "谱页目录正忙")?;
        let position = score_attachments::navigation_position(
            &self.data,
            content,
            &command,
            file,
            &self.notes,
            &|| Ok(()),
        )?;
        self.command(Command::Seek { position })
    }
    pub(crate) fn capture_paper_navigation(&self, content: &str) -> Result<Context, String> {
        let file = self
            .file
            .as_ref()
            .filter(|file| file.content_id == content)
            .ok_or("曲目已切换，请重新打开谱页")?;
        Ok(Context {
            file: file.clone(),
            notes: self.notes.clone(),
            revision: self.score_revision,
            stop_epoch: self.audio_stop_epoch,
            input_epoch: self.state.midi_events,
            status: self.state.status.clone(),
        })
    }
    pub(crate) fn install_paper_navigation(
        &mut self,
        prepared: Prepared,
        sequence: u64,
        latest: &AtomicU64,
        received: Instant,
        token: &background_tasks::TaskToken,
    ) -> Result<serde_json::Value, String> {
        let result = (|| {
            token.check()?;
            if received.elapsed() > Duration::from_secs(15)
                || latest.load(Ordering::Acquire) != sequence
            {
                return Err("谱页定位已过期，请重新选择位置".into());
            }
            let context = &prepared.context;
            if self
                .file
                .as_ref()
                .is_none_or(|file| !file.same_snapshot(&context.file))
                || !self.notes.same_snapshot(&context.notes)
                || self.score_revision != context.revision
                || self.audio_stop_epoch != context.stop_epoch
                || self.state.midi_events != context.input_epoch
                || self.state.status != context.status
            {
                return Err("练习或曲目已改变，请重新选择谱页位置".into());
            }
            token.begin_commit()?;
            // Ordinary seek retains all existing routine, recording and recital restrictions.
            self.command(Command::Seek {
                position: prepared.position,
            })
        })();
        self.retire(prepared);
        result
    }
}
