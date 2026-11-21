//! Detached editors prepare changes; one recoverable storage commit publishes each edit.
use crate::*;
use panthesia_core::utils::atomic_file;
use serde_json::Value;
fn wait_preparation<T>(
    receiver: mpsc::Receiver<Result<T, String>>,
    token: &background_tasks::TaskToken,
    subject: &str,
) -> Result<T, String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        token.check()?;
        match receiver.recv_timeout(Duration::from_millis(25)) {
            Ok(result) => {
                token.check()?;
                return result;
            }
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => continue,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(format!("{subject}准备超时，请稍后重试"));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(format!("{subject}准备通道已关闭"));
            }
        }
    }
}
pub(crate) fn supports(command: &Command) -> bool {
    if paper_receipt_read(command) { return false; }
    matches!(
        command,
        Command::LinkScoreSource { .. }
            | Command::ApplyScoreSource { .. }
            | Command::AcknowledgeScoreSource { .. }
            | Command::UnlinkScoreSource { .. }
            | Command::PairScore { .. }
            | Command::ActivateScore { .. }
            | Command::DetachScore { .. }
            | Command::SaveScoreVersion { .. }
            | Command::RemoveScoreVersion { .. }
            | Command::RenameScoreVersion { .. }
            | Command::SetPaperMapping { .. }
            | Command::SavePaperPractice { .. }
            | Command::EditPaperAnnotation { .. }
            | Command::EditPaperInk { .. }
            | Command::EditPaperNoteAnchor { .. }
            | Command::BatchPaperNoteAnchors { .. }
            | Command::CreateLocatedScorePaper { .. }
            | Command::LinkPaperSource { .. }
            | Command::ApplyPaperSource { .. }
            | Command::ApplyPaperTransfer { .. }
            | Command::ApplyCrossPaperTransfer { .. }
            | Command::AddScoreAttachment { .. }

    )
        || matches!(command,Command::UpdateScoreAttachment{action,..} if action!="view")
}
pub(crate) fn reads(command: &Command) -> bool {
    matches!(
        command,
        Command::ScoreSources { .. }
            | Command::PreviewScoreSource { .. }
            | Command::InspectPaperSources { .. }
            | Command::PreviewPaperSource { .. }

    )
}
pub(crate) fn runtime_reads(command: &Command) -> bool {
    paper_receipt_read(command) || matches!(
        command,
        Command::PreviewScoreVersionRoute { .. }
            | Command::PreviewScoreBytesRoute { .. }
            | Command::PreviewPaperPractice { .. }
            | Command::PreviewCrossPaperTransfer { .. }
            | Command::PaperTransferSources { .. }
            | Command::Score
            | Command::SourceScore
            | Command::ScoreView { .. }
            | Command::ScoreVersions
            | Command::ExportAnnotatedScore { .. }
    )
}
fn paper_receipt_read(command: &Command) -> bool {
    matches!(command, Command::SavePaperPractice { request } if request.confirm_only)
}
fn needs_registry(command: &Command) -> bool {
    matches!(
        command,
        Command::LinkScoreSource { .. }
            | Command::ApplyScoreSource { .. }
            | Command::PairScore { .. }
            | Command::ActivateScore { .. }
            | Command::DetachScore { .. }
            | Command::SaveScoreVersion { .. }
            | Command::RemoveScoreVersion { .. }
            | Command::ScoreVersions
            | Command::RenameScoreVersion { .. }
            | Command::SavePaperPractice { .. }
    )
}
fn needs_runtime(command: &Command) -> bool {
    needs_registry(command)
        || matches!(
            command,
            Command::EditPaperNoteAnchor { .. }
                | Command::BatchPaperNoteAnchors { .. }
                | Command::CreateLocatedScorePaper { .. }
                | Command::ApplyCrossPaperTransfer { .. }
                | Command::SetPaperMapping { .. }
        )
}
fn changes_song(command: &Command) -> bool {
    matches!(command,Command::ApplyScoreSource{mode,..} if mode=="performance")
}
fn affects_current(command: &Command, cid: Option<&str>, result: &Value) -> bool {
    let target = match command {
        Command::LinkScoreSource { content_id, .. }
        | Command::SaveScoreVersion { content_id, .. }
        | Command::RemoveScoreVersion { content_id, .. }
        | Command::RenameScoreVersion { content_id, .. }
        | Command::PairScore { content_id, .. }
        | Command::ActivateScore { content_id, .. }
        | Command::DetachScore { content_id } => Some(content_id.as_str()),
        Command::ScoreVersions => cid,
        Command::ApplyScoreSource { .. } => result["contentId"].as_str(),
        _ => None,
    };
    cid.is_some() && cid == target
}
fn execute(reader: &mut Player, command: Command) -> Result<Value, String> {
    let data = &reader.data;
    match command {
        Command::LinkPaperSource {
            content_id,
            book,
            asset,
            path,
            baseline,
        } => score_attachments::link_source(
            data,
            &content_id,
            &book,
            &asset,
            path,
            baseline.as_deref(),
        ),
        Command::ApplyPaperSource {
            content_id,
            book,
            asset,
            fingerprint,
            baseline,
            action,
        } => score_attachments::apply_source(
            data,
            &content_id,
            &book,
            &asset,
            &fingerprint,
            &baseline,
            &action,
        ),
        Command::ApplyPaperTransfer {
            content_id,
            request,
        } => score_attachments::apply_transfer(data, &content_id, request),
        Command::AddScoreAttachment {
            content_id,
            name,
            bytes,
            append,
        } => {
            if reader
                .file
                .as_ref()
                .map(|file| file.content_id.as_str())
                .or(reader.state.content_id.as_deref())
                != Some(content_id.as_str())
            {
                return Err("曲目已切换，请重新打开谱面管理".into());
            }
            score_attachments::add(data, &content_id, &name, bytes, append.as_deref())
        }
        Command::UpdateScoreAttachment {
            content_id,
            id,
            action,
            name,
            view,
            page,
            direction,
            expected_pages,
        } => {
            if reader
                .file
                .as_ref()
                .map(|file| file.content_id.as_str())
                .or(reader.state.content_id.as_deref())
                != Some(content_id.as_str())
            {
                return Err("曲目已切换，请重新打开谱面管理".into());
            }
            score_attachments::update_with_pages(
                data,
                &content_id,
                id.as_deref(),
                &action,
                name.as_deref(),
                view,
                page,
                direction,
                expected_pages.as_deref(),
            )
        }
        other => reader.command(other),
    }
}
pub(crate) struct Context {
    engine_id: Option<String>,
    undo: Option<crate::practice_edit::Undo>,
    data: PathBuf,
    preferences: Option<Preferences>,
    history: Option<PracticeHistoryStore>,
    state: Snapshot,
    file: Option<SongFile>,
    source_file: Option<SongFile>,
    timeline: Option<load_pipeline::Timeline>,
    title: String,
    config: SongConfig,
    fingers: FingerAssignments,
    hands: HandAssignments,
    notation: Option<Arc<notation::ScoreAsset>>,
    exercise: Option<ExerciseSpec>,
    located: Option<Arc<LocatedScoreMap>>,
    original_grid: Option<OriginalGrid>,
    meter_map: Option<panthesia_core::library::MeterMap>,
    meter: Option<panthesia_core::library::MeterCorrection>,
    revision: u64,
    presets: SoundPresets,
}
pub(crate) struct Outcome {
    preferences: Option<Preferences>,
    history: Option<PracticeHistoryStore>,
    practice: Option<crate::practice_edit::Patch>,
    result: Value,
    notation: Option<Option<Arc<notation::ScoreAsset>>>,
    warning: Option<String>,
    revision: Option<u64>,
    switch: Option<crate::song_switch::Playback>,
}
impl Outcome {
}
impl Context {
    pub(super) fn score_identity(&self) -> Option<(String, u64)> {
        self.file
            .as_ref()
            .map(|file| (file.content_id.clone(), self.revision))
    }
    pub(super) fn set_undo(&mut self, undo: crate::practice_edit::Undo) {
        self.undo = Some(undo);
    }
    pub(super) fn validate_registry(&self) -> Result<(), String> {
        let data = &self.data;
        // Capture the initial registry before any read-modify-write operation.
        let disk = Preferences::load(&data.join("web-preferences.json"))?;
        if serde_json::to_value(&disk).map_err(|e| e.to_string())?
            != serde_json::to_value(self.preferences.as_ref().ok_or("谱面设置快照缺失")?)
                .map_err(|e| e.to_string())?
        {
            return Err("练习设置已在程序外改变，请重新启动后再保存".into());
        }
        let history_path = data.join("web-practice-history.ron");
        let disk_history = match atomic_file::read(&history_path) {
            Ok(bytes) => PracticeHistoryStore::from_snapshot_bytes(history_path, &bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                PracticeHistoryStore::empty(history_path)
            }
            Err(error) => return Err(error.to_string()),
        };
        if disk_history.snapshot_bytes().map_err(|e| e.to_string())?
            != self
                .history
                .as_ref()
                .ok_or("谱面历史快照缺失")?
                .snapshot_bytes()
                .map_err(|e| e.to_string())?
        {
            return Err("练习历史已在程序外改变，请重新启动后再保存".into());
        }
        Ok(())
    }
    pub(super) fn reader(self) -> Result<Player, String> {
        self.into_player(true)
    }
    pub(super) fn into_player(self, rebuild_timeline: bool) -> Result<Player, String> {
        let mut player = Player::empty(self.data, PathBuf::new(), true);
        player.detached_engine_id = self.engine_id;
        if let Some(preferences) = self.preferences {
            player.preferences = preferences;
        }
        if let Some(history) = self.history {
            player.history = history;
        }
        if let Some(undo) = self.undo {
            undo.install(&mut player);
        }
        player.state = self.state;
        player.file = self.file;
        player.source_file = self.source_file;
        player.title = self.title;
        player.config = self.config;
        player.fingers = self.fingers;
        player.note_hands = self.hands;
        player.notation = self.notation;
        player.exercise = self.exercise;
        player.located_score_map = self.located;
        player.original_grid = self.original_grid;
        player.meter_map = self.meter_map;
        player.meter_correction = self.meter;
        player.score_revision = self.revision;
        player.soundfont_presets = self.presets;
        if let Some(file) = &player.file {
            if rebuild_timeline {
                let timeline = match self.timeline {
                    Some(timeline) => timeline,
                    None => load_pipeline::Timeline::new(file)?,
                };
                player.notes = timeline.notes;
                player.events = timeline.events;
                player.sound_timeline = timeline.sound;
                player.event_notes = timeline.event_notes;
            }
        }
        Ok(player)
    }
    pub(super) fn prepare_practice(
        self,
        command: Command,
        kind: crate::practice_edit::Kind,
        token: &background_tasks::TaskToken,
    ) -> Result<Outcome, String> {
        token.stage(if matches!(kind, crate::practice_edit::Kind::Sound) { "preparingSound" } else { "preparingPractice" })?;
        let result = (|| {
            self.validate_registry()?;
            if let Some(file) = &self.file {
                if let Some(path) = &file.source_path {
                    match atomic_file::read_dependency(path, 512_000_000) {
                        Ok(bytes) if blake3::hash(&bytes).to_hex().as_str() != file.content_id => {
                            return Err("MIDI 文件已改变，请重新打开曲目后编辑".into());
                        }
                        Ok(_) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.to_string()),
                    }
                }
            }
            let base = self.revision;
            let mut reader = self.into_player(kind.resets())?;
            if !matches!(kind, crate::practice_edit::Kind::Metadata) { reader.validate_practice_annotations()?; }
            let mut result = crate::practice_edit::execute(&mut reader, command, token)?;
            token.check()?;
            let changed = result.get("changed").and_then(Value::as_bool) != Some(false);
            let revision = (kind.changes_geometry() && changed).then(|| {
                if reader.score_revision == base {
                    base.wrapping_add(1)
                } else {
                    reader.score_revision
                }
            });
            if let Some(revision) = revision {
                reader.score_revision = revision;
                if !result["scoreRevision"].is_null() {
                    result["scoreRevision"] = serde_json::json!(revision);
                }
            }
            if kind.visual() && changed {
                reader.state.annotation_revision = reader.state.annotation_revision.wrapping_add(1);
                if result.is_object() && result.get("annotationRevision").is_some() {
                    result["annotationRevision"] =
                        serde_json::json!(reader.state.annotation_revision);
                }
            }
            let patch = crate::practice_edit::Patch::take(&mut reader, kind);
            let replacement = if kind.resets() && changed {
                let mut playback = crate::song_switch::Playback::take(&mut reader)?;
                if matches!(kind, crate::practice_edit::Kind::Sound | crate::practice_edit::Kind::Range) { playback.preserve_score_mapping(); }
                Some(playback)
            } else {
                None
            };
            Ok::<_, String>(Outcome {
                preferences: Some(reader.preferences),
                history: Some(reader.history),
                practice: Some(patch),
                result,
                notation: None,
                warning: reader.state.error,
                revision,
                switch: replacement,
            })
        })();
        result
    }
    pub(super) fn prepare_switch(
        self,
        input: crate::song_switch::Input,
        token: &background_tasks::TaskToken,
    ) -> Result<Outcome, String> {
        token.stage("preparingSong")?;
        let result = (|| {
            self.validate_registry()?;
            let base_revision = self.revision;
            let same_song_practice = input.needs_current_timeline();
            let mut reader = self.into_player(input.needs_current_timeline())?;
            let mut result = input.apply(&mut reader, token)?;
            let keep_undo = same_song_practice && reader.score_revision == base_revision;
            if reader.score_revision == base_revision {
                reader.score_revision = base_revision.wrapping_add(1);
            }
            if !result["scoreRevision"].is_null() {
                result["scoreRevision"] = serde_json::json!(reader.score_revision);
            }
            if !result["historyPrepared"].is_null() {
                result["historyPrepared"]["scoreRevision"] = serde_json::json!(reader.score_revision);
                for key in ["scoreReview", "scoreFocus"] {
                    if !result[key].is_null() { result[key]["scoreRevision"] = serde_json::json!(reader.score_revision); }
                }
            }
            if !result["libraryPrepared"].is_null() {
                result["libraryPrepared"]["scoreRevision"] = serde_json::json!(reader.score_revision);
            }
            token.check()?;
            let mut playback = crate::song_switch::Playback::take(&mut reader)?;
            if keep_undo {
                playback.preserve_undo();
            }
            Ok::<Outcome, String>(Outcome {
                preferences: Some(reader.preferences),
                history: Some(reader.history),
                practice: None,
                result,
                notation: None,
                warning: playback.warning(),
                revision: Some(playback.revision()),
                switch: Some(playback),
            })
        })();
        result
    }
    fn prepare(
        self,
        command: Command,
        token: &background_tasks::TaskToken,
    ) -> Result<Outcome, String> {
        token.stage("preparingScore")?;
        let registry = needs_registry(&command);
        let prepared = (|| {
            if registry {
                if affects_current(
                    &command,
                    self.file.as_ref().map(|file| file.content_id.as_str()),
                    &Value::Null,
                ) {
                    if let Some(file) = &self.file {
                        if let Some(path) = &file.source_path {
                            match atomic_file::read_dependency(path, 512_000_000) {
                                Ok(bytes) => {
                                    if MidiFile::from_path_bytes(path, &bytes)?.content_id
                                        != file.content_id
                                    {
                                        return Err(
                                            "当前 MIDI 文件内容已改变，请重新打开曲目后再管理谱面"
                                                .into(),
                                        );
                                    }
                                }
                                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                                Err(error) => return Err(error.to_string()),
                            }
                        }
                    }
                }
                self.validate_registry()?;
            }
            let switch = changes_song(&command);
            let base_revision = self.revision;
            let old_notation = self
                .notation
                .as_ref()
                .map(|score| (score.source_fingerprint.clone(), score.name.clone()));
            let force_revision = matches!(
                command,
                Command::PairScore { .. }
                    | Command::ActivateScore { .. }
                    | Command::DetachScore { .. }
            );
            let mut reader = self.reader()?;
            // Command is not Clone: record only the affected current-content decision before consuming it.
            let current = reader.file.as_ref().map(|file| file.content_id.clone());
            let affected = match &command {
                Command::ApplyScoreSource { .. } => None,
                _ => Some(affects_current(&command, current.as_deref(), &Value::Null)),
            };
            let mut result = execute(&mut reader, command)?;
            token.check()?;
            let affected = affected.unwrap_or_else(|| {
                current.as_deref() == result["contentId"].as_str() && current.is_some()
            });
            let mut notation = None;
            let mut warning = None;
            let mut replacement = None;
            if switch {
                replacement = Some(crate::song_switch::Playback::take(&mut reader)?);
            } else if affected {
                if let Some(file) = &reader.file {
                    let path = reader.annotation_path(file)?;
                    let versions = reader
                        .preferences
                        .score_versions
                        .get(&file.content_id)
                        .map(Vec::as_slice)
                        .unwrap_or_default();
                    let score_source=if reader.variant().active() {reader.source_file.as_deref().unwrap_or(file)} else {file};
                    let assets = load_pipeline::Assets::read_checked(score_source, &path, versions, &|| token.check())?;
                    warning = assets.error;
                    let new_notation = assets.notation.map(Arc::new);
                    let new_key = new_notation
                        .as_ref()
                        .map(|score| (score.source_fingerprint.clone(), score.name.clone()));
                    if force_revision || new_key != old_notation {
                        notation = Some(new_notation);
                    }
                }
            }
            let revision = if notation.is_some() || replacement.is_some() {
                Some(if reader.score_revision == base_revision {
                    base_revision.wrapping_add(1)
                } else {
                    reader.score_revision
                })
            } else {
                None
            };
            if !result["scoreRevision"].is_null() {
                result["scoreRevision"] = serde_json::json!(revision.unwrap_or(base_revision));
            }
            if !result["song"]["scoreRevision"].is_null() {
                result["song"]["scoreRevision"] =
                    serde_json::json!(revision.unwrap_or(base_revision));
            }
            Ok(Outcome {
                preferences: registry.then_some(reader.preferences),
                history: registry.then_some(reader.history),
                practice: None,
                result,
                notation,
                warning,
                revision,
                switch: replacement,
            })
        })();
        prepared
    }
}
struct Guard {
    tx: mpsc::Sender<runtime_request::Request>,
    id: String,
    done: bool,
    subject: &'static str,
}
impl Guard {
    fn finish(
        mut self,
        result: Result<Outcome, String>,
        reply: Option<runtime_request::Reply>,
    ) -> Result<(), String> {
        self.tx
            .send(runtime_request::Request::AssetEditFinish {
                id: self.id.clone(),
                result,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        self.done = true;
        Ok(())
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        if !self.done {
            let _ = self.tx.send(runtime_request::Request::AssetEditFinish {
                id: self.id.clone(),
                result: Err(format!("{}保存未完成，请重新读取资料后重试", self.subject)),
                reply: None,
            });
        }
    }
}
impl Engine {
    pub(super) fn asset_read_task(&self, command: Command) -> Result<Value, String> {
        let engine = self.clone();
        let paper_receipt = paper_receipt_read(&command);
        let editor_read = crate::practice_edit::reads(&command);
        self.tasks.run(
            if paper_receipt {
                "核对纸谱练习段保存结果"
            } else if matches!(command, Command::Metadata) {
                "读取曲目信息"
            } else if editor_read {
                "读取练习标注"
            } else {
                "读取原谱资料"
            },
            None,
            move |token| {
                let check_receipt_ready = || -> Result<(), String> {
                    if paper_receipt && engine.imports_in_flight.load(Ordering::Acquire) > 0 {
                        return Err("原资料保存或恢复仍未结束，请稍后重新核对保存结果。原请求继续保留。".into());
                    }
                    Ok(())
                };
                check_receipt_ready()?;
                token.stage(if editor_read {
                    "preparingPractice"
                } else {
                    "readingScore"
                })?;
                token.check()?;
                let _observation = engine.observe_writers();
                let result = if runtime_reads(&command) || crate::practice_edit::reads(&command) {
                    let (reply, receiver) = mpsc::sync_channel(1);
                    let editor = crate::practice_edit::reads(&command);
                    let registry = editor || paper_receipt
                        || matches!(
                            command,
                            Command::PaperTransferSources { .. }
                                | Command::PreviewScoreVersionRoute { .. }
                                | Command::ExportAnnotatedScore { .. }
                        );
                    engine
                        .tx
                        .send(runtime_request::Request::AssetReadContext {
                            registry,
                            export: false,
                            editor,
                            scope: None,
                            reply,
                        })
                        .map_err(|_| "音乐引擎已关闭")?;
                    let context = wait_preparation(receiver, &token, "资料读取")?;
                    check_receipt_ready()?;
                    (|| {
                            let lightweight = paper_receipt || matches!(
                                command,
                                Command::PreviewScoreBytesRoute { .. }
                                    | Command::PreviewScoreVersionRoute { .. }
                                    | Command::Score
                                    | Command::SourceScore
            | Command::ScoreView { .. }
                                    | Command::ScoreVersions
                                    | Command::ExportAnnotatedScore { .. }
                            );
                            let mut reader = context.into_player(!editor && !lightweight)?;
                            reader.command(command)
                    })()?
                } else {
                    engine.dispatch(command)?
                };
                token.check()?;
                Ok(result)
            },
        )
    }
    pub(super) fn asset_edit_task(&self, command: Command) -> Result<Value, String> {
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let library = false;
        let label = "保存谱面资料";
        let content: Option<String> = None;
        let id = format!(
            "{}-{}-{}",
            if library {
                "library-edit"
            } else {
                "asset-edit"
            },
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        );
        let apply = matches!(command, Command::ApplyScoreSource { .. });
        let registry = needs_registry(&command);
        let runtime = needs_runtime(&command);
        let pending = self.pending_operation()?;
        let engine = self.clone();
        self.tasks.run(label, content, move |token| {
            let _pending = pending;
            token.stage(if library {
                "preparingLibrary"
            } else {
                "preparingScore"
            })?;
            // Own cleanup before sending Begin: cancellation can race with its queued reply.
            let guard = Guard {
                tx: engine.tx.clone(),
                id: id.clone(),
                done: false,
                subject: if library { "曲库资料" } else { "谱面" },
            };
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::AssetEditBegin {
                    id,
                    apply,
                    registry,
                    runtime,
                    reply,
                })
                .map_err(|_| "音乐引擎已关闭")?;
            let context = match wait_preparation(receiver, &token, guard.subject) {
                Ok(context) => context,
                Err(error) => {
                    guard.finish(Err(error.clone()), None)?;
                    return Err(error);
                }
            };
            let result = (|| {
                token.check()?;
                let outcome = context.prepare(command, &token)?;
                token.check()?;
                token.begin_commit()?;
                let _ = library;
                Ok(outcome)
            })();
            let (reply, receiver) = mpsc::sync_channel(1);
            guard.finish(result, Some(reply))?;
            receiver.recv().map_err(|_| "资料保存结果通道已关闭")?
        })
    }
}
impl Player {
    pub(super) fn begin_asset_edit(
        &mut self,
        id: String,
        apply: bool,
        registry: bool,
        runtime: bool,
    ) -> Result<Context, String> {
        if self.storage_busy.load(Ordering::Acquire) {
            return Err("其他资料正在保存，请稍候重试".into());
        }
        if self.recorder.is_recording() {
            return Err("请先停止并保存录音，再修改练习资料".into());
        }
        if apply {
            self.check_unsaved_switch()?;
        }
        if apply && matches!(self.state.status.as_str(), "playing" | "countIn") {
            return Err("请先停止演奏，再应用原谱更新".into());
        }
        self.panic();
        if matches!(self.state.status.as_str(), "playing" | "countIn") {
            self.state.status = "paused".into();
        }
        self.time_connected = false;
        let context = self.capture_asset_context(registry, runtime);
        self.storage_id = Some(id);
        self.storage_busy.store(true, Ordering::Release);
        Ok(context)
    }
    pub(super) fn capture_practice_read_context(&self) -> Context {
        let mut context = self.capture_asset_context(false, true);
        context.preferences = Some(self.preferences.clone());
        context.undo = Some(crate::practice_edit::Undo::capture(self));
        context
    }
    pub(super) fn capture_document_context(&self) -> Context {
        let mut context = self.capture_asset_context(false, true);
        context.preferences = Some(self.preferences.clone());
        context
    }
    pub(super) fn capture_asset_context(&self, registry: bool, runtime: bool) -> Context {
        let mut state = self.state.clone();
        state.content_id = self.file.as_ref().map(|file| file.content_id.clone());
        Context {
            engine_id: self.source_engine_id().map(str::to_owned),
            undo: None,
            data: self.data.clone(),
            preferences: (registry || runtime).then(|| self.preferences.clone()),
            history: registry.then(|| self.history.clone()),
            state,
            file: runtime.then(|| self.file.clone()).flatten(),
            source_file: runtime.then(|| self.source_file.clone()).flatten(),
            timeline: runtime.then(|| load_pipeline::Timeline::capture(self)),
            title: self.title.clone(),
            config: self.config.clone(),
            fingers: if runtime {
                self.fingers.clone()
            } else {
                FingerAssignments::default()
            },
            hands: if runtime {
                self.note_hands.clone()
            } else {
                HandAssignments::default()
            },
            notation: self.notation.clone(),
            exercise: self.exercise,
            located: runtime.then(|| self.located_score_map.clone()).flatten(),
            original_grid: runtime.then(|| self.original_grid.clone()).flatten(),
            meter_map: runtime.then(|| self.meter_map.clone()).flatten(),
            meter: self.meter_correction,
            revision: self.score_revision,
            presets: self.soundfont_presets.clone(),
        }
    }
    pub(super) fn finish_asset_edit(
        &mut self,
        id: &str,
        result: Result<Outcome, String>,
    ) -> Result<Value, String> {
        if self.storage_id.as_deref() != Some(id) {
            self.retire(result);
            return Err("谱面保存任务已结束或失效".into());
        }
        let subject = if id.starts_with("practice-edit-") {
            "练习标注"
        } else if id.starts_with("recording-") {
            "录音回放"
        } else if id.starts_with("song-switch-") {
            "曲目"
        } else if id.starts_with("library-edit-") {
            "曲库资料"
        } else {
            "谱面"
        };
        self.storage_id = None;
        let outcome = match result {
            Ok(outcome) => outcome,
            Err(error) => {
                storage_control::unblock(self);
                if error == "后台任务已取消" {
                    return Err(error);
                }
                let _ = subject;
                self.state.error = Some(error.clone());
                return Err(error);
            }
        };
        if let Some(preferences) = outcome.preferences {
            let old = std::mem::replace(&mut self.preferences, preferences);
            self.retire(old);
        }
        if let Some(history) = outcome.history {
            let old = std::mem::replace(&mut self.history, history);
            self.retire(old);
        }
        storage_control::unblock(self);
        if let Some(notation) = outcome.notation {
            let old = std::mem::replace(&mut self.notation, notation);
            let located = self.located_score_map.take();
            self.retire((old, located));
        }
        if !self.has_storage_error() {
            self.state.error = None;
        }
        if let Some(replacement) = outcome.switch {
            replacement.install(self);
        }
        if let Some(patch) = outcome.practice {
            patch.install(self);
        }
        if let Some(revision) = outcome.revision {
            self.score_revision = revision;
        }
        if !self.has_storage_error() {
            self.state.error = match (self.state.error.take(), outcome.warning) {
                (Some(current), Some(warning)) if current != warning => {
                    Some(format!("{current}；{warning}"))
                }
                (Some(current), _) => Some(current),
                (None, warning) => warning,
            };
        }
        Ok(outcome.result)
    }
}
