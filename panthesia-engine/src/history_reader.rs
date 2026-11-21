//! Background reads (practice time, collection, file locations) use a snapshot and never block MIDI scheduling.
use crate::*;
use panthesia_core::utils::atomic_file;

fn wait_read_context<T>(
    receiver: mpsc::Receiver<Result<T, String>>,
    check: &impl Fn() -> Result<(), String>,
    label: &str,
) -> Result<T, String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        check()?;
        match receiver.recv_timeout(Duration::from_millis(25)) {
            Ok(result) => {
                check()?;
                return result;
            }
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => continue,
            Err(mpsc::RecvTimeoutError::Timeout) => return Err(format!("{label}读取超时，请稍后重试")),
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(format!("{label}通道已关闭")),
        }
    }
}

pub(crate) fn supports(command: &Command) -> bool {
    matches!(
        command,
        Command::Collection | Command::LibraryRepairs { .. } | Command::PracticeTime { .. }
    )
}
#[derive(serde::Deserialize)]
#[serde(untagged)]
pub enum ReadRequest {
    Scoped { command: Command, scope: ReadScope, #[serde(default, rename = "engineId")] engine_id: Option<String> },
    Command(Command),
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadScope {
    pub channel: String,
    pub sequence: u64,
}
impl ReadScope {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.channel.is_empty()
            || self.channel.len() > 96
            || self.sequence == 0
            || !self.channel.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            return Err("历史查询通道无效".into());
        }
        Ok(())
    }
}
pub(crate) struct Context {
    data: PathBuf,
    history: PracticeHistoryStore,
    file: Option<SongFile>,
    latency: i32,
}
impl Context {
    fn read(
        self,
        command: Command,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<serde_json::Value, String> {
        check()?;
        let data = self.data.clone();
        atomic_file::capture_readonly(
            Arc::new(move |path: &std::path::Path| asset_storage::captures(&data, path)),
            || {
                if let Command::LibraryRepairs { query, kind, include_resolved, offset, limit } = &command {
                    let known = crate::library_repairs::history_locations(&self.history, &check)?;
                    return crate::library_repairs::query_checked(&self.data, &known, query, kind, *include_resolved, *offset, *limit, false, &check);
                }
                let mut reader = Player::empty(self.data, PathBuf::new(), true);
                reader.history = self.history;
                reader.file = self.file;
                reader.state.latency = self.latency;
                // Dispatch only read methods, with no playback-command side effects or implicit saves.
                match command {
                    Command::Collection => reader.collection_checked(&check),
                    Command::PracticeTime { content_id, from, to } => {
                        reader.practice_time_checked(&content_id, from, to, &check)
                    }
                    _ => Err("读取命令无效".into()),
                }
            },
        )
    }
}
impl Player {
    pub(super) fn capture_history_reader(&self, current_song: bool) -> Context {
        Context {
            data: self.data.clone(),
            history: self.history.clone(),
            file: current_song.then(|| self.file.clone()).flatten(),
            latency: self.state.latency,
        }
    }
}
impl Engine {
    pub(super) fn cancel_history_read(&self, channel: String, sequence: u64) -> Result<serde_json::Value, String> {
        let scope = ReadScope { channel, sequence };
        scope.validate()?;
        self.tasks.cancel_scope(
            &format!("history-read:{}", scope.channel), scope.sequence,
        )?;
        Ok(serde_json::json!({ "ok": true }))
    }
    pub fn read_history(&self, request: ReadRequest) -> Result<serde_json::Value, String> {
        let (command, scope) = match request {
            ReadRequest::Scoped { command, scope, engine_id } => {
                if engine_id.as_deref().is_some_and(|id| id != self.engine_id.as_ref()) { return Err("练习室连接已改变，请重新读取所选资料。".into()); }
                (command, Some(scope))
            },
            ReadRequest::Command(command) => (command, None),
        };
        if let Some(scope) = &scope { scope.validate()?; }
        if !supports(&command) {
            return Err("此入口只接受历史查询".into());
        }
        if self.closing.load(Ordering::Acquire) {
            return Err("正在关闭练习室，请等待完成".into());
        }
        storage_control::check_command(&self.storage_busy, &command)?;
        self.history_read_task(command, scope)
    }
    pub(super) fn history_read_task(
        &self,
        command: Command,
        scope: Option<ReadScope>,
    ) -> Result<serde_json::Value, String> {
        let current_song = false;
        let engine = self.clone();
        let (label, content) = match &command {
            Command::PracticeTime { content_id, .. } => ("汇总练习时长", Some(content_id.clone())),
            Command::Collection => ("读取收藏与最近练习", None),
            _ => ("读取曲目文件位置", None),
        };
        let work = move |token: background_tasks::TaskToken| {
            token.stage(if matches!(command, Command::LibraryRepairs { .. }) { "readingLibrary" } else { "readingHistory" })?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine.tx.send(runtime_request::Request::HistoryQueryContext {
                current_song, reply,
            })
                .map_err(|_| "音乐引擎已关闭")?;
            let context = wait_read_context(receiver, &|| token.check(), "历史查询快照")?;
            token.check()?;
            let result = context.read(command, || token.check())?;
            token.check()?;
            Ok(result)
        };
        if let Some(scope) = scope {
            self.tasks.run_latest(
                format!("history-read:{}", scope.channel),
                scope.sequence,
                label,
                content,
                work,
            )
        } else {
            self.tasks.run(label, content, work)
        }
    }
}
