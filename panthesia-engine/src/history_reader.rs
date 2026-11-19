//! History reads use an immutable in-memory snapshot and never block MIDI scheduling.
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
        Command::WeakPractice | Command::DueReview { .. } | Command::Collection | Command::History | Command::LibraryRepairs { .. }
            | Command::SongLearningEvidence { .. }
            | Command::ReadSongExpressionGoal { .. }
            | Command::ReadHistoryAnnotation { .. }
            | Command::HistoryPerformance { .. }
            | Command::ReadHistoryPerformance { .. }
            | Command::HistoryQuery { .. }
            | Command::ReadHistoryPage { .. }
            | Command::HistoryDetail { .. }
            | Command::ReadHistoryDetail { .. }
            | Command::PracticeTime { .. }
            | Command::PracticeCalendar { .. }
            | Command::HistoryProblemNotes { .. }
            | Command::HistoryReplayClips { .. }
            | Command::ReadHistoryReplayClips { .. }
    )
}
#[derive(Clone, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct HistoryPageRequest {
    pub content_id: Option<String>,
    pub query: String,
    pub mode: String,
    pub hands: String,
    pub range: String,
    pub days: u32,
    pub from: Option<u64>,
    pub to: Option<u64>,
    pub offset: usize,
    pub limit: usize,
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
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationInput {
    #[serde(default)]
    pub engine_id: Option<String>,
    pub content_id: String,
    pub id: String,
    pub note: String,
    pub teacher: String,
    pub next: String,
    pub expected: Option<panthesia_core::practice_history::PracticeAnnotation>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationRead {
    pub content_id: String,
    pub id: String,
    pub annotation: Option<panthesia_core::practice_history::PracticeAnnotation>,
    pub write_settled: bool,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnnotationSaved {
    content_id: String,
    id: String,
    annotation: panthesia_core::practice_history::PracticeAnnotation,
}
pub(crate) struct Context {
    data: PathBuf,
    history: PracticeHistoryStore,
    preferences: Preferences,
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
                if let Command::ReadSongExpressionGoal { content_id } = &command {
                    if content_id.len() != 64 || !content_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                        return Err("曲目内容身份无效".into());
                    }
                    check()?;
                    return serde_json::to_value(expression_goal::ExpressionGoalSnapshot {
                        content_id: content_id.clone(),
                        goal: self.preferences.song_expression_goals.get(content_id).cloned(),
                        write_settled: true,
                    }).map_err(|error| error.to_string());
                }
                if let Command::ReadHistoryAnnotation { content_id, id } = &command {
                    if content_id.len() != 64 || !content_id.bytes().all(|byte| byte.is_ascii_hexdigit()) || id.is_empty() || id.len() > 512 { return Err("演奏记录身份无效".into()); }
                    let song = self.history.song(content_id).ok_or("曲目记录不存在")?;
                    let mut annotation = None; let mut found = false;
                    for session in &song.sessions { check()?; if session.stable_id() == *id { annotation = session.annotation.clone(); found = true; break; } }
                    if !found { return Err("这条演奏记录已不在历史中".into()); }
                    return serde_json::to_value(AnnotationRead { content_id: content_id.clone(), id: id.clone(), annotation, write_settled: true }).map_err(|error| error.to_string());
                }
                if let Command::SongLearningEvidence { content_id } = &command {
                    return serde_json::to_value(song_learning_evidence::read_snapshot(
                        &self.data, &self.history, &self.preferences, content_id, &check,
                    )?).map_err(|error| error.to_string());
                }
                let mut reader = Player::empty(self.data, PathBuf::new(), true);
                reader.history = self.history;
                reader.file = self.file;
                reader.state.latency = self.latency;
                // Dispatch only read methods, with no playback-command side effects or implicit saves.
                match command {
                    Command::Collection => reader.command(Command::Collection),
                    Command::WeakPractice => reader.weak_practice_checked(&check),
                    Command::DueReview { offset, expected } => reader.due_review_checked(offset, expected.as_deref(), &check),
                    Command::History => reader.history_query_window_checked(
                        "", "", "", "", 0, 0, 200, None, None, &check,
                    ),
                    Command::HistoryQuery {
                        query,
                        mode,
                        hands,
                        range,
                        days,
                        offset,
                        limit,
                        from,
                        to,
                    } => reader.history_query_window_checked(
                        &query, &mode, &hands, &range, days, offset, limit, from, to, &check,
                    ),
                    Command::HistoryDetail { content_id, id } => {
                        reader.history_detail_checked(&content_id, &id, &check)
                    }
                    Command::ReadHistoryDetail { content_id, id } => {
                        let mut value = reader.history_detail_checked(&content_id, &id, &check)?;
                        value["source"] = serde_json::to_value(reader.history_source(&content_id, &id)?).map_err(|error| error.to_string())?;
                        Ok(value)
                    }
                    Command::ReadHistoryPage { request } => {
                        reader.read_history_page_checked(&request, &check)
                    }
                    Command::PracticeTime {
                        content_id,
                        from,
                        to,
                    } => reader.practice_time_checked(&content_id, from, to, &check),
                    Command::PracticeCalendar {
                        from,
                        to,
                        content_id,
                    } => reader.practice_calendar_checked(from, to, content_id.as_deref(), &check),
                    Command::HistoryProblemNotes {
                        content_id,
                        id,
                        offset,
                    } => reader.history_problem_notes_checked(&content_id, &id, offset, &check),
                    Command::HistoryReplayClips { content_id, id } => {
                        reader.history_replay_clips(&content_id, &id)
                    }
                    Command::ReadHistoryReplayClips { content_id, id } => reader.read_history_replay_clips(&content_id, &id),
                    _ => Err("历史读取命令无效".into()),
                }
            },
        )
    }
}
impl Player {
    pub(super) fn apply_history_annotation(
        &mut self,
        input: AnnotationInput,
        with_detail: bool,
    ) -> Result<(Context, AnnotationSaved), String> {
        let annotation = panthesia_core::practice_history::PracticeAnnotation {
            note: input.note,
            teacher: input.teacher,
            next: input.next,
            updated_at_unix_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        };
        self.history.annotate_session(
            &input.content_id,
            &input.id,
            input.expected,
            annotation.clone(),
        )?;
        let current_song = with_detail
            && self
                .file
                .as_ref()
                .is_some_and(|file| file.content_id == input.content_id);
        let context = self.capture_history_reader(current_song);
        Ok((
            context,
            AnnotationSaved {
                content_id: input.content_id,
                id: input.id,
                annotation,
            },
        ))
    }
    pub(super) fn capture_history_reader(&self, current_song: bool) -> Context {
        Context {
            data: self.data.clone(),
            history: self.history.clone(),
            preferences: self.preferences.clone(),
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
    fn history_performance_task(
        &self,
        content_id: String,
        id: String,
        scope: Option<history_reader::ReadScope>,
        with_source: bool,
    ) -> Result<serde_json::Value, String> {
        let engine = self.clone();
        let selected_content = content_id.clone();
        let work = move |token: background_tasks::TaskToken| {
            token.stage("readingHistory")?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine.tx.send(runtime_request::Request::HistoryReadContext {
                content_id: selected_content, id, reply,
            })
                .map_err(|_| "音乐引擎已关闭")?;
            let context = wait_read_context(receiver, &|| token.check(), "历史演奏条件")?;
            token.source(context.content_id.clone(), context.fingerprint.clone())?;
            let prepared =
                history_actions::Read::prepare_checked(&engine.data, &context, || token.check(), with_source)?;
            token.check()?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::HistoryReadCheck(context, reply))
                .map_err(|_| "音乐引擎已关闭")?;
            wait_read_context(receiver, &|| token.check(), "历史演奏条件核对")?;
            prepared.check()?;
            token.check()?;
            Ok(prepared.value)
        };
        if let Some(scope) = scope {
            self.tasks.run_latest(
                format!("history-read:{}", scope.channel),
                scope.sequence,
                "读取历史演奏",
                Some(content_id),
                work,
            )
        } else {
            self.tasks.run("读取历史演奏", Some(content_id), work)
        }
    }

    fn history_annotation(
        &self,
        input: AnnotationInput,
        with_detail: bool,
    ) -> Result<(Context, AnnotationSaved), String> {
        let _pending = self.pending_operation()?;
        if input.engine_id.as_deref().is_some_and(|id| id != self.engine_id.as_ref()) { return Err("练习室连接已改变，原评语输入继续保留。".into()); }
        if self.closing.load(Ordering::Acquire) {
            return Err("正在关闭练习室，请等待完成".into());
        }
        if self.storage_busy.load(Ordering::Acquire) {
            return Err("练习资料正在保存或恢复，请稍候保存评语".into());
        }
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::HistoryAnnotation {
                input,
                with_detail,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        // The actor's persistence barrier acknowledges this snapshot only after its real write.
        receiver.recv().map_err(|_| "评语保存结果通道已关闭")?
    }
    pub fn save_history_annotation(
        &self,
        input: AnnotationInput,
    ) -> Result<serde_json::Value, String> {
        let (_, saved) = self.history_annotation(input, false)?;
        serde_json::to_value(saved).map_err(|error| error.to_string())
    }
    pub(super) fn annotate_history_background(
        &self,
        input: AnnotationInput,
    ) -> Result<serde_json::Value, String> {
        let (context, saved) = self.history_annotation(input, true)?;
        let engine = self.clone();
        self.tasks.run_owned("读取已保存评语", move |token| {
            let _keep_alive = engine;
            token.stage("readingHistory")?;
            context
                .read(
                    Command::HistoryDetail {
                        content_id: saved.content_id,
                        id: saved.id,
                    },
                    || Ok(()),
                )
                .map_err(|error| format!("评语已保存，演奏详情暂时无法读取：{error}"))
        })
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
        if let Command::HistoryPerformance { content_id, id } = command {
            return self.history_performance_task(content_id, id, scope, false);
        }
        if let Command::ReadHistoryPerformance { content_id, id } = command {
            return self.history_performance_task(content_id, id, scope, true);
        }
        let current_song = matches!(command, Command::HistoryDetail { .. } | Command::ReadHistoryDetail { .. });
        let engine = self.clone();
        let (label, content) = match &command {
            Command::ReadSongExpressionGoal { content_id } => ("读取曲目专项要求", Some(content_id.clone())),
            Command::ReadHistoryAnnotation { content_id, .. } => ("读取演奏评语", Some(content_id.clone())),
            Command::SongLearningEvidence { content_id } => ("整理曲目学习证据", Some(content_id.clone())),
            Command::HistoryDetail { content_id, .. } | Command::ReadHistoryDetail { content_id, .. } => {
                ("读取演奏记录详情", Some(content_id.clone()))
            }
            Command::HistoryProblemNotes { content_id, .. } => {
                ("读取历史问题音符", Some(content_id.clone()))
            }
            Command::HistoryReplayClips { content_id, .. } | Command::ReadHistoryReplayClips { content_id, .. } => {
                ("读取回放片段", Some(content_id.clone()))
            }
            Command::PracticeCalendar { content_id, .. } => ("整理练习日历", content_id.clone()),
            Command::ReadHistoryPage { request } => ("筛选练习历史", request.content_id.clone()),
            Command::PracticeTime { content_id, .. } => ("汇总练习时长", Some(content_id.clone())),
            Command::Collection => ("读取收藏与最近练习",None),
            Command::LibraryRepairs { .. } => ("读取曲目文件位置",None),
            Command::WeakPractice => ("生成历史复习建议", None),
            Command::DueReview { .. } => ("整理到期复习建议", None),
            _ => ("筛选练习历史", None),
        };
        let work = move |token: background_tasks::TaskToken| {
            let observation = engine.observe_writers();
            let settled_read = matches!(&command, Command::ReadSongExpressionGoal { .. } | Command::ReadHistoryAnnotation { .. } | Command::ReadHistoryReplayClips { .. });
            token.stage(if matches!(command, Command::LibraryRepairs { .. }) { "readingLibrary" } else { "readingHistory" })?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine.tx.send(runtime_request::Request::HistoryQueryContext {
                current_song, reply,
            })
                .map_err(|_| "音乐引擎已关闭")?;
            let context = wait_read_context(receiver, &|| token.check(), "历史查询快照")?;
            token.check()?;
            let mut result = context.read(command, || token.check())?;
            token.check()?;
            if settled_read { result["writeSettled"] = serde_json::json!(engine.writers_settled(&observation)); }
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
