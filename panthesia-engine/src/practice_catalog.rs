//! Saved practice definitions prepare on workers and merge only their owning collections.
use crate::practice_source::SourceIdentity;
use crate::*;
use panthesia_core::utils::atomic_file;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageCatalog {
    pub content_id: String,
    pub grid: String,
    pub passages: Vec<preferences::PassagePreset>,
    pub catalog_revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_settled: Option<bool>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LadderCatalog {
    pub presets: Vec<preferences::LadderPreset>,
    pub runs: Vec<preferences::LadderRun>,
    pub current: Option<preferences::LadderRun>,
    pub catalog_revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_settled: Option<bool>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExerciseCatalog {
    pub presets: Vec<preferences::ExercisePreset>,
    pub catalog_revision: String,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerProfileCatalog {
    pub content_id: Option<String>,
    pub profiles: Option<BTreeMap<usize, panthesia_core::fingering::HandSpanProfile>>,
    pub profiles_by_hand: Option<BTreeMap<String, panthesia_core::fingering::HandSpanProfile>>,
    pub defaults: BTreeMap<
        panthesia_core::practice::PracticePart,
        panthesia_core::fingering::HandSpanProfile,
    >,
    pub catalog_revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_settled: Option<bool>,
}
fn read_catalog(reader: &Player, kind: Kind, catalog_revision: String) -> Result<Value, String> {
    match kind {
        Kind::LoopRules => return Err("循环规则没有独立目录".into()),
        Kind::Bookmarks => return reader.bookmark_catalog(catalog_revision),
        Kind::Passages => {
            let content = &reader.file.as_ref().ok_or("请先选择曲目")?.content_id;
            serde_json::to_value(PassageCatalog {
                content_id: content.clone(),
                grid: reader.grid_signature(),
                passages: reader.preferences.passages.get(content).cloned().unwrap_or_default().into_iter().map(|mut row| {
                    if row.practice.is_none() { row.practice = row.practice_edition(content).ok(); }
                    row
                }).collect(),
                catalog_revision,
                write_settled: None,
            })
        }
        Kind::Ladders => {
            let content = &reader.file.as_ref().ok_or("请先选择曲目")?.content_id;
            let presets: Vec<_> = reader
                .preferences
                .ladder_presets
                .get(content)
                .cloned()
                .unwrap_or_default().into_iter().map(|mut row| {
                    if row.practice.is_none() {row.practice=panthesia_core::song_project::PracticeEdition::resolve(None,content,&row.grid).ok();}
                    row
                }).collect();
            let runs = presets
                .iter()
                .filter_map(|preset| {
                    reader
                        .preferences
                        .ladder_runs
                        .get(&format!("{content}:{}", preset.id))
                        .cloned()
                })
                .collect();
            serde_json::to_value(LadderCatalog {
                presets,
                runs,
                current: reader.ladder.clone(),
                catalog_revision,
                write_settled: None,
            })
        }
        Kind::Profiles => {
            let content = reader.file.as_ref().map(|file| file.content_id.clone());
            serde_json::to_value(FingerProfileCatalog {
                profiles: content
                    .as_ref()
                    .and_then(|id| reader.preferences.fingering_profiles.get(id))
                    .cloned(),
                profiles_by_hand: content
                    .as_ref()
                    .and_then(|id| reader.preferences.hand_span_profiles.get(id))
                    .cloned(),
                defaults: (*reader.preferences.hand_span_defaults).clone(),
                content_id: content,
                catalog_revision,
                write_settled: None,
            })
        }
        Kind::Expression => return Err("曲目专项要求通过当前会话读取".into()),
        Kind::Exercises => serde_json::to_value(ExerciseCatalog {
            presets: reader.preferences.exercise_presets.materialize(),
            catalog_revision,
        }),
    }
    .map_err(|error| error.to_string())
}

#[derive(Clone, Copy)]
pub(crate) enum Kind {
    Bookmarks,
    LoopRules,
    Passages,
    Ladders,
    Exercises,
    Expression,
    Profiles,
}
pub(crate) fn edits(command: &Command) -> Option<Kind> {
    Some(match command {
        Command::LoopRestartErrors{..} => Kind::LoopRules,
        Command::SaveBookmark{..}|Command::RemoveBookmark{..} => Kind::Bookmarks,
        Command::SavePassage { .. }
        | Command::RemovePassage { .. }
        | Command::UpdatePassageDetails { .. }
        | Command::SaveScorePassage { .. }
        | Command::SaveTickPassage { .. } => Kind::Passages,
        Command::SaveLadder { .. }
        | Command::UpdateLadderName { .. }
        | Command::RemoveLadder { .. } => Kind::Ladders,
        Command::SetSongExpressionGoal { .. } | Command::EditSongExpressionGoal { .. } => {
            Kind::Expression
        }
        Command::HandSpanFor { .. } | Command::HandSpanDefault { .. } => Kind::Profiles,
        Command::SaveExercisePreset { .. }
        | Command::RemoveExercisePreset { .. }
        | Command::EditExercisePreset { .. }
        | Command::DeleteExercisePreset { .. } => Kind::Exercises,
        _ => return None,
    })
}
fn read_kind(command: &Command) -> Option<Kind> {
    match command {
        Command::Bookmarks => Some(Kind::Bookmarks),
        Command::Passages => Some(Kind::Passages),
        Command::LadderPresets => Some(Kind::Ladders),
        Command::ExercisePresets => Some(Kind::Exercises),
        Command::FingerProfiles => Some(Kind::Profiles),
        _ => None,
    }
}
fn revision(
    preferences: &Preferences,
    content: Option<&str>,
    kind: Kind,
) -> Result<String, String> {
    let bytes = match kind {
        Kind::LoopRules => serde_json::to_vec(&preferences.loop_restart_errors),
        Kind::Bookmarks => serde_json::to_vec(&(content, content.and_then(|id|preferences.bookmarks.get(id)))),
        Kind::Passages => {
            serde_json::to_vec(&(content, content.and_then(|id| preferences.passages.get(id))))
        }
        Kind::Ladders => serde_json::to_vec(&(
            content,
            content.and_then(|id| preferences.ladder_presets.get(id)),
        )),
        Kind::Exercises => serde_json::to_vec(&preferences.exercise_presets),
        Kind::Expression => serde_json::to_vec(&(
            content,
            content.and_then(|id| preferences.song_expression_goals.get(id)),
        )),
        Kind::Profiles => serde_json::to_vec(&(
            &preferences.hand_span_profiles,
            &preferences.hand_span_defaults,
            &preferences.fingering_profiles,
        )),
    }
    .map_err(|error| error.to_string())?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}
pub(super) fn check_open_version(
    player: &Player,
    command: &Command,
    expected: Option<&str>,
) -> Result<(), String> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let kind = match command {
        Command::OpenPassage { .. } => Kind::Passages,
        Command::StartLadder { .. } => Kind::Ladders,
        _ => return Err("练习方案打开操作无效".into()),
    };
    let current = revision(
        &player.preferences,
        player.file.as_ref().map(|file| file.content_id.as_str()),
        kind,
    )?;
    if expected != current {
        return Err("方案列表已更新，请重新读取并核对后再打开练习".into());
    }
    Ok(())
}
pub(crate) fn reads(command: &Command) -> bool {
    matches!(
        command,
        Command::Bookmarks | Command::Passages
            | Command::FingerProfiles
            | Command::LadderPresets
            | Command::ExercisePresets
            | Command::PreviewTickRange { .. }
            | Command::PreviewScoreRange { .. }
            | Command::PreviewScoreRangeTrim { .. }
    )
}
fn needs_source(command: &Command) -> bool {
    !matches!(
        command,
        Command::ExercisePresets
            | Command::HandSpanDefault { .. }
            | Command::SaveExercisePreset { .. }
            | Command::RemoveExercisePreset { .. }
            | Command::EditExercisePreset { .. }
            | Command::DeleteExercisePreset { .. }
    )
}
// New drafts retain this identity across a lost transport reply. Replaying the
// same creation can read its result, but cannot apply newer inputs over it.
fn creation_id(command: &Command, request_id: Option<&str>) -> Result<Option<String>, String> {
    if !matches!(
        command,
        Command::SavePassage { id: None, .. } | Command::SaveLadder { id: None, .. }
    ) {
        return Ok(None);
    }
    let Some(id) = request_id else {
        return Ok(None);
    };
    let valid = id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        });
    if !valid {
        return Err("练习草稿保存编号无效".into());
    }
    Ok(Some(format!("editor-{id}")))
}
pub(crate) fn profiles_revision(preferences: &Preferences) -> Result<String, String> {
    revision(preferences, None, Kind::Profiles)
}
#[derive(Clone)]
pub(crate) enum Guard {
    None,
    LadderSave,
    LadderRemove(String),
    Idle,
    Expression,
}
impl Guard {
    fn for_command(command: &Command) -> Self {
        match command {
            Command::SaveLadder { .. } | Command::UpdateLadderName { .. } => Self::LadderSave,
            Command::RemoveLadder { id } => Self::LadderRemove(id.clone()),
            Command::SaveTickPassage { .. } => Self::Idle,
            Command::SetSongExpressionGoal { .. } | Command::EditSongExpressionGoal { .. } => {
                Self::Expression
            }
            _ => Self::None,
        }
    }
    fn check(&self, player: &Player) -> Result<(), String> {
        match self {
            Self::Expression => player.check_song_expression_editable(),
            Self::LadderSave
                if player.recorder.is_recording()
                    || player.ladder.as_ref().is_some_and(|run| run.active) =>
            {
                Err("请先停止录音或结束速度阶梯，再保存方案".into())
            }
            Self::LadderRemove(id)
                if player
                    .ladder
                    .as_ref()
                    .is_some_and(|run| run.active && run.preset.id == *id) =>
            {
                Err("请先结束这个阶梯再移除方案".into())
            }
            Self::Idle
                if player.recorder.is_recording()
                    || player.routine.is_some()
                    || player.ladder.as_ref().is_some_and(|run| run.active)
                    || matches!(player.state.status.as_str(), "playing" | "countIn")
                    || !player.state.pressed.is_empty() =>
            {
                Err("请先停止演奏、录音和活动计划，再保存段落".into())
            }
            _ => Ok(()),
        }
    }
}
pub(crate) struct Context {
    source: asset_edit::Context,
    origin: Option<SourceIdentity>,
    preferences: Preferences,
    ladder: Option<preferences::LadderRun>,
}
pub(crate) struct Installation {
    kind: Kind,
    origin: Option<SourceIdentity>,
    before: Preferences,
    after: Preferences,
    old_ladder: Option<preferences::LadderRun>,
    ladder: Option<preferences::LadderRun>,
    guard: Guard,
    changed: bool,
}
impl Context {
    fn prepare(
        self,
        command: Command,
        kind: Option<Kind>,
        guard: Guard,
        expected: Option<&str>,
        creation: Option<&str>,
        token: &background_tasks::TaskToken,
    ) -> Result<(Value, Option<Installation>), String> {
        token.check()?;
        let mut reader = self.source.into_player(true)?;
        reader.restoring = true;
        let catalog = kind.or_else(|| read_kind(&command));
        let content = reader.file.as_ref().map(|file| file.content_id.clone());
        if let (Some(id), Some(content)) = (creation, content.as_ref()) {
            let exists = match kind {
                Some(Kind::Passages) => self
                    .preferences
                    .passages
                    .get(content)
                    .is_some_and(|rows| rows.iter().any(|row| row.id == id)),
                Some(Kind::Ladders) => self
                    .preferences
                    .ladder_presets
                    .get(content)
                    .is_some_and(|rows| rows.iter().any(|row| row.id == id)),
                _ => false,
            };
            if exists {
                return Ok((serde_json::json!({"id":id,"existing":true}), None));
            }
        }
        let before_revision = catalog
            .map(|catalog| revision(&self.preferences, content.as_deref(), catalog))
            .transpose()?;
        if let (Some(_), Some(content), Some(revision)) = (&self.origin, &content, &before_revision)
        {
            token.source(content.clone(), revision.clone())?;
        }
        if expected.is_some_and(|expected| before_revision.as_deref() != Some(expected)) {
            return Err("方案列表已更新，当前输入尚未保存。请重新读取列表并核对后再保存".into());
        }
        // Checked editors distinguish updating an existing definition from creation.
        // A deleted target must be recreated through an explicit new-item action.
        if expected.is_some() {
            let missing = match &command {
                Command::SavePassage { id: Some(id), .. } => {
                    content.as_ref().is_none_or(|content| {
                        !self
                            .preferences
                            .passages
                            .get(content)
                            .is_some_and(|rows| rows.iter().any(|row| row.id == *id))
                    })
                }
                Command::SaveLadder { id: Some(id), .. } => {
                    content.as_ref().is_none_or(|content| {
                        !self
                            .preferences
                            .ladder_presets
                            .get(content)
                            .is_some_and(|rows| rows.iter().any(|row| row.id == *id))
                    })
                }
                _ => false,
            };
            if missing {
                return Err("正在编辑的方案已移除，当前输入尚未保存。请核对后新建方案".into());
            }
        }
        let command = match command {
            Command::EditSongExpressionGoal { goal, expected } => {
                if expected != reader.current_song_expression_goal() {
                    return Err(
                        "曲目专项要求已在其他位置修改，当前输入尚未保存，请核对最新目标后再保存"
                            .into(),
                    );
                }
                Command::SetSongExpressionGoal { goal }
            }
            Command::EditExercisePreset { name, spec, .. } => {
                Command::SaveExercisePreset { name, spec }
            }
            Command::DeleteExercisePreset { id, .. } => Command::RemoveExercisePreset { id },
            command => command,
        };
        let mut result = if let Some(read_kind) = read_kind(&command) {
            read_catalog(
                &reader,
                read_kind,
                before_revision.clone().ok_or("方案列表版本缺失")?,
            )?
        } else {
            let data = reader.data.clone();
            atomic_file::capture_readonly(
                Arc::new(move |path: &std::path::Path| asset_storage::captures(&data, path)),
                || reader.command(command),
            )?
        };
        token.check()?;
        if let Some(id) = creation {
            let content = content.as_ref().ok_or("保存结果缺少来源曲目")?;
            let generated = result["id"]
                .as_str()
                .ok_or("保存结果缺少练习方案编号")?
                .to_owned();
            match kind {
                Some(Kind::Passages) => {
                    let row = reader
                        .preferences
                        .passages
                        .get_mut(content)
                        .and_then(|rows| rows.iter_mut().find(|row| row.id == generated))
                        .ok_or("新练习段保存结果无法核对，输入仍保留")?;
                    row.id = id.into();
                }
                Some(Kind::Ladders) => {
                    let row = reader
                        .preferences
                        .ladder_presets
                        .get_mut(content)
                        .and_then(|rows| rows.iter_mut().find(|row| row.id == generated))
                        .ok_or("新速度阶梯保存结果无法核对，输入仍保留")?;
                    row.id = id.into();
                }
                _ => return Err("当前保存操作不接受新建编号".into()),
            }
            result["id"] = serde_json::json!(id);
        }
        let after_revision = if kind.is_some() {
            catalog
                .map(|catalog| revision(&reader.preferences, content.as_deref(), catalog))
                .transpose()?
        } else {
            before_revision.clone()
        };
        if let Some(revision) = &after_revision {
            result["catalogRevision"] = serde_json::json!(revision);
        }
        let changed = before_revision != after_revision || self.ladder != reader.ladder;
        let patch = kind.map(|kind| Installation {
            kind,
            origin: self.origin,
            before: self.preferences,
            after: reader.preferences,
            old_ladder: self.ladder,
            ladder: reader.ladder,
            guard,
            changed,
        });
        Ok((result, patch))
    }
}
impl Player {
    pub(super) fn capture_catalog(
        &self,
        source: bool,
        guard: &Guard,
        scope: Option<&practice_edit::Scope>,
    ) -> Result<Context, String> {
        self.check_practice_scope(scope)?;
        guard.check(self)?;
        if source && self.file.is_none() {
            return Err("请先选择曲目".into());
        }
        Ok(Context {
            source: self.capture_practice_read_context(),
            origin: source.then(|| SourceIdentity::capture(self)),
            preferences: self.preferences.clone(),
            ladder: self.ladder.clone(),
        })
    }
    pub(super) fn install_catalog(
        &mut self,
        patch: &Installation,
        token: &background_tasks::TaskToken,
    ) -> Result<(), String> {
        if patch
            .origin
            .as_ref()
            .is_some_and(|origin| *origin != SourceIdentity::capture(self))
        {
            return Err("曲目、谱面或练习条件已改变，请重新读取方案后保存".into());
        }
        patch.guard.check(self)?;
        let unchanged = match patch.kind {
            Kind::LoopRules => self.preferences.loop_restart_errors==patch.before.loop_restart_errors,
            Kind::Bookmarks => self.preferences.bookmarks.same_snapshot(&patch.before.bookmarks),
            Kind::Passages => self
                .preferences
                .passages
                .same_snapshot(&patch.before.passages),
            Kind::Ladders => {
                self.preferences
                    .ladder_presets
                    .same_snapshot(&patch.before.ladder_presets)
                    && self
                        .preferences
                        .ladder_runs
                        .same_snapshot(&patch.before.ladder_runs)
                    && self.ladder == patch.old_ladder
            }
            Kind::Expression => self
                .preferences
                .song_expression_goals
                .same_snapshot(&patch.before.song_expression_goals),
            Kind::Profiles => {
                self.preferences
                    .hand_span_profiles
                    .same_snapshot(&patch.before.hand_span_profiles)
                    && self
                        .preferences
                        .hand_span_defaults
                        .same_snapshot(&patch.before.hand_span_defaults)
                    && self
                        .preferences
                        .fingering_profiles
                        .same_snapshot(&patch.before.fingering_profiles)
            }
            Kind::Exercises => self
                .preferences
                .exercise_presets
                .same_snapshot(&patch.before.exercise_presets),
        };
        if !unchanged {
            return Err("这组练习方案已由其他操作更新，请重新读取后核对修改".into());
        }
        token.check()?;
        if !patch.changed {
            return Ok(());
        }
        token.begin_commit()?;
        // Keep current playback, device settings, history and unrelated catalogs.
        // The worker retains both roots until the acknowledged save has finished.
        let previous = self.preferences.clone();
        let old_ladder = self.ladder.clone();
        let old_expression = self.active_expression_goal.clone();
        match patch.kind {
            Kind::LoopRules => self.preferences.loop_restart_errors=patch.after.loop_restart_errors,
            Kind::Bookmarks => self.preferences.bookmarks=patch.after.bookmarks.clone(),
            Kind::Passages => self.preferences.passages = patch.after.passages.clone(),
            Kind::Ladders => {
                self.preferences.ladder_presets = patch.after.ladder_presets.clone();
                self.preferences.ladder_runs = patch.after.ladder_runs.clone();
                self.ladder = patch.ladder.clone();
            }
            Kind::Expression => {
                self.preferences.song_expression_goals = patch.after.song_expression_goals.clone();
                self.active_expression_goal = None;
            }
            Kind::Profiles => {
                self.preferences.hand_span_profiles = patch.after.hand_span_profiles.clone();
                self.preferences.hand_span_defaults = patch.after.hand_span_defaults.clone();
            }
            Kind::Exercises => {
                self.preferences.exercise_presets = patch.after.exercise_presets.clone()
            }
        }
        if let Err(error) = self.preferences.save(&self.preferences_path) {
            self.preferences = previous;
            self.ladder = old_ladder;
            self.active_expression_goal = old_expression;
            return Err(error);
        }
        Ok(())
    }
}
impl Engine {
    pub(super) fn catalog_task(
        &self,
        command: Command,
        scope: Option<practice_edit::Scope>,
        expected: Option<String>,
    ) -> Result<Value, String> {
        self.catalog_task_with_creation(command, scope, expected, None)
    }
    pub(super) fn catalog_task_with_creation(
        &self,
        command: Command,
        scope: Option<practice_edit::Scope>,
        expected: Option<String>,
        request_id: Option<String>,
    ) -> Result<Value, String> {
        let creation = creation_id(&command, request_id.as_deref())?;
        let expected = expected.or_else(|| match &command {
            Command::EditExercisePreset { expected, .. }
            | Command::DeleteExercisePreset { expected, .. } => Some(expected.clone()),
            _ => None,
        });
        if expected.as_ref().is_some_and(|value| {
            value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
        }) {
            return Err("练习方案列表版本无效，请重新读取列表".into());
        }
        let kind = edits(&command);
        if kind.is_none() && !reads(&command) {
            return Err("练习方案操作无效".into());
        }
        if self.closing.load(Ordering::Acquire) {
            return Err("正在关闭练习室，请等待完成".into());
        }
        storage_control::check_command(&self.storage_busy, &command)?;
        let label = match (&command, kind) {
            (_, Some(Kind::LoopRules)) => "保存循环练习规则",
            (_, Some(Kind::Bookmarks)) => "保存演奏书签",
            (_, Some(Kind::Passages)) => "保存练习段资料",
            (_, Some(Kind::Ladders)) => "保存速度阶梯方案",
            (_, Some(Kind::Exercises)) => "保存技术练习方案",
            (_, Some(Kind::Expression)) => "保存曲目专项要求",
            (_, Some(Kind::Profiles)) => "保存手跨度设置",
            (Command::LadderPresets, _) => "读取速度阶梯方案",
            (Command::ExercisePresets, _) => "读取技术练习方案",
            (Command::Passages, _) => "读取练习段资料",
            (Command::FingerProfiles, _) => "读取手跨度设置",
            _ => "预览练习范围",
        };
        let source = needs_source(&command);
        let settled_read = matches!(
            &command,
            Command::Passages | Command::LadderPresets | Command::FingerProfiles
        );
        let guard = Guard::for_command(&command);
        let engine = self.clone();
        let pending = if kind.is_some() {
            Some(self.pending_operation()?)
        } else {
            None
        };
        self.tasks.run(
            label,
            scope.as_ref().map(|scope| scope.content_id.clone()),
            move |token| {
                let _pending = pending;
                // Counts alone miss a writer that starts and finishes during a read.
                let observation = engine.observe_writers();
                token.stage(if kind.is_some() {
                    "preparingCatalog"
                } else {
                    "readingCatalog"
                })?;
                let (reply, receiver) = mpsc::sync_channel(1);
                engine
                    .tx
                    .send(runtime_request::Request::CatalogContext {
                        source,
                        guard: guard.clone(),
                        scope,
                        reply,
                    })
                    .map_err(|_| "音乐引擎已关闭")?;
                let context = receiver.recv().map_err(|_| "练习方案快照通道已关闭")??;
                let (mut value, patch) = context.prepare(
                    command,
                    kind,
                    guard,
                    expected.as_deref(),
                    creation.as_deref(),
                    &token,
                )?;
                if let Some(patch) = patch {
                    let patch = Arc::new(patch);
                    let (reply, receiver) = mpsc::sync_channel(1);
                    engine
                        .tx
                        .send(runtime_request::Request::CatalogCommit {
                            patch: patch.clone(),
                            token: token.clone(),
                            reply,
                        })
                        .map_err(|_| "音乐引擎已关闭")?;
                    receiver.recv().map_err(|_| "练习方案保存通道已关闭")??;
                }
                if settled_read {
                    value["writeSettled"] = serde_json::json!(engine.writers_settled(&observation));
                }
                Ok(value)
            },
        )
    }
}
