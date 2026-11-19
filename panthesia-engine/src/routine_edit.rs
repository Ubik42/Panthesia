//! Plan metadata edits prepare owned registry changes, then merge only their two collections.
use crate::preferences::Shared;
use crate::practice_source::SourceIdentity;
use crate::routine_commands::{PracticeRoutine, RoutineRun};
use crate::*;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OptionsRequest {
    pub content_id: String,
    pub engine_id: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineSourceEntry { pub id: String, pub name: String }
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineSourceOptions {
    pub content_id: String,
    pub passages: Vec<RoutineSourceEntry>,
    pub ladders: Vec<preferences::LadderPreset>,
}

type Plans = Shared<Vec<PracticeRoutine>>;
type Runs = crate::shared_map::SharedMap<String, RoutineRun>;
pub(crate) fn supports(command: &Command) -> bool {
    matches!(
        command,
        Command::AcceptWeakPractice { .. }
            | Command::SaveRoutine { .. }
            | Command::SaveRoutineSchedule { .. }
            | Command::RemoveRoutine { .. }
            | Command::MoveRoutineItem { .. }
            | Command::RemoveRoutineItem { .. }
            | Command::SaveRoutineItem { .. }
            | Command::ComposePassages { .. }
            | Command::PreviewHistoryProblemPlan { .. }
            | Command::PreviewMultiProblemPlan { .. }
            | Command::PreviewProblemCuts { .. }
            | Command::SaveHistoryProblemPlan { .. }
            | Command::SaveMultiProblemPlan { .. }
    )
}
pub(crate) struct Context {
    data: PathBuf,
    preferences: Preferences,
    active: Option<ActivePlan>,
    history: PracticeHistoryStore,
    file: Option<SongFile>,
    title: String,
    latency: i32,
    source: Option<asset_edit::Context>,
    source_origin: Option<SourceOrigin>,
}
#[derive(Clone)]
pub(crate) struct Installation {
    plans: Plans,
    runs: Runs,
    next_plans: Plans,
    next_runs: Runs,
    guard: Guard,
    source: Option<SourceOrigin>,
    history: PracticeHistoryStore,
    history_sources: Vec<String>,
    review_latency: Option<i32>,
}
#[derive(Clone)]
enum Guard {
    TemplateRemoval(String),
    DayEdit(String, Option<String>),
    Idle,
    None,
}
struct Prepared {
    installation: Installation,
    value: serde_json::Value,
}
#[derive(Clone)]
struct SourceOrigin {
    content_id: Option<String>,
    identity: SourceIdentity,
    preferences: Preferences,
}
impl SourceOrigin {
    fn same_preferences(&self, preferences: &Preferences) -> bool {
        self.preferences
            .passages
            .same_snapshot(&preferences.passages)
            && self
                .preferences
                .ladder_presets
                .same_snapshot(&preferences.ladder_presets)
            && self.preferences.songs.same_snapshot(&preferences.songs)
            && self
                .preferences
                .exercise_layouts
                .same_snapshot(&preferences.exercise_layouts)
            && self
                .preferences
                .score_versions
                .same_snapshot(&preferences.score_versions)
    }
    fn scoped_revision(&self) -> Result<Vec<u8>, String> {
        let content = self.content_id.as_ref();
        serde_json::to_vec(&(
            content,
            content.and_then(|id| self.preferences.passages.get(id)),
            content.and_then(|id| self.preferences.ladder_presets.get(id)),
            content.and_then(|id| self.preferences.songs.get(id)),
            content.and_then(|id| self.preferences.exercise_layouts.get(id)),
            content.and_then(|id| self.preferences.score_versions.get(id)),
        )).map_err(|error|error.to_string())
    }
    fn same_origin(&self, other: &Self) -> Result<bool, String> {
        if self.identity != other.identity || self.content_id != other.content_id { return Ok(false); }
        if self.same_preferences(&other.preferences) { return Ok(true); }
        // A changed shared root may belong to another song. Compare the selected
        // source on this worker, then let the actor attempt a fresh root merge.
        Ok(self.scoped_revision()? == other.scoped_revision()?)
    }

}
fn has_saved_sequence(command: &Command, preferences: &Preferences) -> bool {
    let Command::ComposePassages {
        routine_id,
        day,
        proof: Some(proof),
        ..
    } = command
    else {
        return false;
    };
    if proof.len() != 64 {
        return false;
    }
    let plan = day
        .as_deref()
        .and_then(|day| {
            preferences
                .routine_runs
                .get(&crate::routine_commands::run_key(routine_id, day))
                .map(|run| &run.routine)
        })
        .or_else(|| {
            preferences
                .routines
                .iter()
                .find(|plan| &plan.id == routine_id)
        });
    let prefix = format!("sequence-{proof}-");
    plan.is_some_and(|plan| plan.items.iter().any(|item| item.id.starts_with(&prefix)))
}
fn target_revision(command: &Command, preferences: &Preferences, plan_only: bool) -> Result<Option<String>, String> {
    let target = match command {
        Command::SaveRoutine {
            id: Some(id), day, ..
        } => Some((id.as_str(), day.as_deref())),
        Command::SaveRoutine {
            id: None,
            copy_of: Some(id),
            day,
            ..
        } => Some((id.as_str(), day.as_deref())),
        Command::SaveRoutineSchedule { id, .. } | Command::RemoveRoutine { id } => {
            Some((id.as_str(), None))
        }
        Command::AcceptWeakPractice { routine_id:Some(routine_id), day, .. } => Some((routine_id.as_str(), day.as_deref())),
        Command::MoveRoutineItem {
            routine_id, day, ..
        }
        | Command::RemoveRoutineItem {
            routine_id, day, ..
        }
        | Command::SaveRoutineItem {
            routine_id, day, ..
        }
        | Command::ComposePassages {
            routine_id, day, ..
        } => Some((routine_id.as_str(), day.as_deref())),
        Command::SaveHistoryProblemPlan { spec, .. } => spec
            .routine_id
            .as_deref()
            .map(|id| (id, spec.day.as_deref())),
        Command::SaveMultiProblemPlan { spec, .. } => spec
            .routine_id
            .as_deref()
            .map(|id| (id, spec.day.as_deref())),
        _ => None,
    };
    let Some((id, day)) = target else {
        return Ok(None);
    };
    // Compare only the destination. Unrelated plans may advance while this edit
    // is prepared; a concurrent edit to this same plan requires a fresh review.
    let value = if let Some(day) = day {
        if let Some(run) = preferences
            .routine_runs
            .get(&crate::routine_commands::run_key(id, day))
        {
            if plan_only {
                return crate::routine_protocol::revision(Some(&run.routine)).map(Some);
            }
            serde_json::to_vec(run)
        } else {
            serde_json::to_vec(&preferences.routines.iter().find(|plan| plan.id == id))
        }
    } else {
        serde_json::to_vec(&preferences.routines.iter().find(|plan| plan.id == id))
    }
    .map_err(|error| error.to_string())?;
    Ok(Some(blake3::hash(&value).to_hex().to_string()))
}
fn history_sources(command: &Command) -> Vec<String> {
    match command {
        Command::PreviewHistoryProblemPlan { spec }
        | Command::SaveHistoryProblemPlan { spec, .. } => vec![spec.content_id.clone()],
        Command::PreviewMultiProblemPlan { spec } | Command::SaveMultiProblemPlan { spec, .. } => {
            spec.sources
                .iter()
                .map(|source| source.content_id.clone())
                .collect()
        }
        Command::PreviewProblemCuts {
            single: Some(spec),
            multi: None,
            ..
        } => vec![spec.content_id.clone()],
        Command::PreviewProblemCuts {
            single: None,
            multi: Some(spec),
            ..
        } => spec
            .sources
            .iter()
            .map(|source| source.content_id.clone())
            .collect(),
        _ => Vec::new(),
    }
}
impl Context {
    fn prepare(
        self,
        command: &Command,
        token: &background_tasks::TaskToken,
    ) -> Result<Prepared, String> {
        let data = self.data.clone();
        panthesia_core::utils::atomic_file::capture_readonly(
            Arc::new(move |path: &std::path::Path| asset_storage::captures(&data, path)),
            || self.prepare_owned(command, token),
        )
    }
    fn prepare_owned(
        self,
        command: &Command,
        token: &background_tasks::TaskToken,
    ) -> Result<Prepared, String> {
        token.check()?;
        let history_origin = self.history.clone();
        let mut history_sources = history_sources(command);
        let review_latency = matches!(command, Command::AcceptWeakPractice { .. }).then_some(self.latency);
        let plans = self.preferences.routines.clone();
        let runs = self.preferences.routine_runs.clone();
        let mut reader = match self.source {
            Some(source) => source.into_player(true)?,
            None => Player::empty(self.data, PathBuf::new(), true),
        };
        reader.preferences = self.preferences;
        reader.history = self.history;
        if reader.file.is_none() {
            reader.file = self.file;
            reader.title = self.title;
        }
        reader.routine = self.active;
        reader.state.latency = self.latency;
        // These operations own registry data only. Suppress persist() on this
        // detached editor; the live actor merges and acknowledges the resulting patch.
        reader.restoring = true;
        let (value, guard) = match command {
            Command::AcceptWeakPractice { ids, edits, routine_id, day, name, request_id } => {
                let (value, sources) = reader.accept_weak_practice_checked(ids, edits, routine_id.as_deref(), day.as_deref(), name, request_id.as_deref(), &||token.check())?;
                history_sources = sources;
                (value, routine_id.as_ref().map(|id|Guard::DayEdit(id.clone(),day.clone())).unwrap_or(Guard::None))
            }
            Command::SaveRoutine {
                id,
                day,
                name,
                notes,
                copy_of,
                request_id,
            } => (
                reader.save_routine_with_request(
                    id.clone(),
                    day.clone(),
                    name.clone(),
                    notes.clone(),
                    copy_of.clone(),
                    request_id.clone(),
                )?,
                id.as_ref()
                    .map_or(Guard::None, |id| Guard::DayEdit(id.clone(), day.clone())),
            ),
            Command::SaveRoutineSchedule { id, schedule } => (
                reader.save_routine_schedule(id, schedule.clone())?,
                Guard::None,
            ),
            Command::RemoveRoutine { id } => (
                reader.remove_routine(id)?,
                Guard::TemplateRemoval(id.clone()),
            ),
            Command::MoveRoutineItem {
                routine_id,
                day,
                item_id,
                direction,
            } => (
                reader.move_routine_item(routine_id, day.as_deref(), item_id, *direction)?,
                Guard::DayEdit(routine_id.clone(), day.clone()),
            ),
            Command::RemoveRoutineItem {
                routine_id,
                day,
                item_id,
            } => (
                reader.remove_routine_item(routine_id, day.as_deref(), item_id)?,
                Guard::DayEdit(routine_id.clone(), day.clone()),
            ),
            Command::SaveRoutineItem {
                routine_id,
                day,
                id,
                source,
                source_id,
                title,
                notes,
                goal,
                ..
            } => (
                reader.save_routine_item(
                    routine_id,
                    day.as_deref(),
                    id.clone(),
                    source.as_deref(),
                    source_id.as_deref(),
                    title.clone(),
                    notes.clone(),
                    goal.clone(),
                )?,
                Guard::DayEdit(routine_id.clone(), day.clone()),
            ),
            Command::ComposePassages {
                routine_id,
                day,
                content_id,
                entries,
                goal,
                proof,
            } => (
                reader.compose_passages_checked(
                    routine_id,
                    day.as_deref(),
                    content_id,
                    entries,
                    goal,
                    proof.as_deref(),
                    &|| token.check(),
                )?,
                Guard::DayEdit(routine_id.clone(), day.clone()),
            ),
            Command::PreviewHistoryProblemPlan { spec } => {
                (reader.preview_history_problem_plan(spec)?, Guard::None)
            }
            Command::PreviewMultiProblemPlan { spec } => {
                (reader.preview_multi_problem_plan(spec)?, Guard::None)
            }
            Command::PreviewProblemCuts {
                single,
                multi,
                expected,
                edits,
            } => {
                let built = match (single, multi) {
                    (Some(spec), None) => reader.build_history_problem_plan(spec)?,
                    (None, Some(spec)) => reader.build_multi_problem_plan(spec)?,
                    _ => return Err("请选择唯一编排来源".into()),
                };
                token.check()?;
                let built = reader.apply_problem_cuts(built, expected, edits)?;
                (
                    serde_json::json!({"rows":built.rows,"revision":built.revision}),
                    Guard::None,
                )
            }
            Command::SaveHistoryProblemPlan {
                spec,
                expected,
                name,
                notes,
                goal,
                edits,
            } => (
                reader.save_history_problem_plan(spec, expected, name, notes, goal, edits)?,
                Guard::Idle,
            ),
            Command::SaveMultiProblemPlan {
                spec,
                expected,
                name,
                notes,
                goal,
                edits,
            } => (
                reader.save_multi_problem_plan(spec, expected, name, notes, goal, edits)?,
                Guard::Idle,
            ),
            _ => return Err("计划编辑命令无效".into()),
        };
        token.check()?;
        Ok(Prepared {
            value,
            installation: Installation {
                plans,
                runs,
                next_plans: reader.preferences.routines,
                next_runs: reader.preferences.routine_runs,
                guard,
                source: self.source_origin,
                history: history_origin,
                history_sources,
                review_latency,
            },
        })
    }
}
impl Player {
    pub(super) fn capture_routine_edit(
        &self,
        source: bool,
        expected: Option<&str>,
    ) -> Result<Context, String> {
        if expected.is_some_and(|expected| {
            self.file
                .as_ref()
                .is_none_or(|file| file.content_id != expected)
        }) {
            return Err("曲目已切换，请重新打开计划编辑".into());
        }
        Ok(Context {
            data: self.data.clone(),
            preferences: self.preferences.clone(),
            active: self.routine.clone(),
            history: self.history.clone(),
            file: self.file.clone(),
            title: self.title.clone(),
            latency: self.state.latency,
            source: source.then(|| self.capture_asset_context(true, true)),
            source_origin: source.then(|| SourceOrigin {
                content_id: self.file.as_ref().map(|file|file.content_id.clone()),
                identity: SourceIdentity::capture(self),
                preferences: self.preferences.clone(),
            }),
        })
    }
    pub(super) fn install_routine_edit(
        &mut self,
        patch: &Installation,
        token: &background_tasks::TaskToken,
    ) -> Result<bool, String> {
        if patch.review_latency.is_some_and(|latency| latency != self.state.latency) {
            return Err("设备校准已改变，请重新生成建议后再加入计划".into());
        }
        if let Some(source) = &patch.source {
            if source.identity != SourceIdentity::capture(self) {
                return Err("当前曲目、谱面或练习条件已改变，请重新读取后保存项目".into());
            }
            // Keep serialization off playback. A worker can distinguish a change
            // to this source from an unrelated catalog or score registration.
            if !source.same_preferences(&self.preferences) { return Ok(false); }
        }
        if !self.preferences.routines.same_snapshot(&patch.plans)
            || !self.preferences.routine_runs.same_snapshot(&patch.runs)
        {
            return Ok(false);
        }
        if patch
            .history_sources
            .iter()
            .any(|content| !patch.history.same_song_snapshot(&self.history, content))
        {
            if patch.review_latency.is_some() { return Ok(false); }
            return Err("来源演奏记录已更新，请重新核对后保存计划".into());
        }
        match &patch.guard {
            Guard::TemplateRemoval(id)
                if self
                    .routine
                    .as_ref()
                    .is_some_and(|active| &active.routine_id == id) =>
            {
                return Err("请先结束该计划的当前项目".into());
            }
            Guard::DayEdit(id, day) => self.routine_editable(id, day.as_deref())?,
            Guard::Idle
                if self.recorder.is_recording()
                    || self.routine.is_some()
                    || self.ladder.as_ref().is_some_and(|ladder| ladder.active)
                    || matches!(self.state.status.as_str(), "playing" | "countIn")
                    || !self.state.pressed.is_empty() =>
            {
                return Err("请先停止演奏、录音和活动计划，再保存编排".into());
            }
            _ => {}
        }
        token.check()?;
        if patch.plans.same_snapshot(&patch.next_plans)
            && patch.runs.same_snapshot(&patch.next_runs)
        {
            return Ok(true);
        }
        token.begin_commit()?;
        let previous_plans = self.preferences.routines.clone();
        let previous_runs = self.preferences.routine_runs.clone();
        self.preferences.routines = patch.next_plans.clone();
        self.preferences.routine_runs = patch.next_runs.clone();
        if let Err(error) = self.preferences.save(&self.preferences_path) {
            self.preferences.routines = previous_plans;
            self.preferences.routine_runs = previous_runs;
            return Err(error);
        }
        Ok(true)
    }
}
impl Engine {
    pub fn routine_options(&self, request: OptionsRequest) -> Result<serde_json::Value, String> {
        if let Some(expected) = request.engine_id.as_deref() {
            self.check_engine(expected)?;
        }
        if self.closing.load(Ordering::Acquire) {
            return Err("正在关闭练习室，请等待完成".into());
        }
        let engine = self.clone();
        self.tasks.run("读取当前曲目计划来源",Some(request.content_id.clone()),move |token| {
            token.stage("readingPlans")?;
            let (reply,receiver)=mpsc::sync_channel(1);
            engine.tx.send(runtime_request::Request::RoutineEditContext {source:false,expected:Some(request.content_id.clone()),reply}).map_err(|_|"音乐引擎已关闭")?;
            let context=receiver.recv().map_err(|_|"计划来源快照通道已关闭")??;
            token.check()?;
            let passages:Vec<_>=context.preferences.passages.get(&request.content_id).into_iter().flatten()
                .map(|passage|RoutineSourceEntry { id: passage.id.clone(), name: passage.name.clone() }).collect();
            let ladders=context.preferences.ladder_presets.get(&request.content_id).cloned().unwrap_or_default();
            let value=serde_json::to_value(RoutineSourceOptions {content_id: request.content_id, passages, ladders}).map_err(|error|error.to_string())?;
            token.check()?;
            Ok(value)
        })
    }

    pub fn read_routine_sources(&self, command: Command) -> Result<serde_json::Value, String> {
        if !matches!(&command, Command::PassageCatalog { .. }) {
            return Err("此入口只接受计划来源查询".into());
        }
        if self.closing.load(Ordering::Acquire) {
            return Err("正在关闭练习室，请等待完成".into());
        }
        storage_control::check_command(&self.storage_busy, &command)?;
        let engine = self.clone();
        self.tasks.run("读取计划段落来源", None, move |token| {
            token.stage("readingPlans")?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::RoutineEditContext {
                    source: false,
                    expected: None,
                    reply,
                })
                .map_err(|_| "音乐引擎已关闭")?;
            let context = receiver.recv().map_err(|_| "计划来源快照通道已关闭")??;
            let mut reader = Player::empty(context.data, PathBuf::new(), true);
            reader.preferences = context.preferences;
            reader.history = context.history;
            reader.file = context.file;
            reader.title = context.title;
            if let Command::PassageCatalog {
                content_id,
                query,
                offset,
            } = command
            {
                reader.passage_catalog_checked(content_id.as_deref(), &query, offset, || {
                    token.check()
                })
            } else {
                Err("计划来源查询无效".into())
            }
        })
    }

    pub(super) fn edit_routine_registry(
        &self,
        command: Command,
    ) -> Result<serde_json::Value, String> {
        self.edit_routine_registry_expected(command, None)
    }
    pub(super) fn edit_routine_checked(&self, request: crate::routine_protocol::RoutineEditRequest) -> Result<serde_json::Value, String> {
        let (command, expected) = request.command()?;
        self.edit_routine_registry_expected(command, Some(expected))
    }
    fn edit_routine_registry_expected(&self, command: Command, expected_revision: Option<String>) -> Result<serde_json::Value, String> {
        let engine = self.clone();
        let label = match &command {
            Command::AcceptWeakPractice { .. } => "将复习建议加入计划",
            Command::ComposePassages { proof: None, .. } => "预览段落编排",
            Command::PreviewHistoryProblemPlan { .. }
            | Command::PreviewMultiProblemPlan { .. }
            | Command::PreviewProblemCuts { .. } => "整理历史问题练习",
            _ => "保存练习计划",
        };
        self.tasks.run(label, None, move |token| {
            token.stage("preparingPlans")?;
            let (source, expected) = match &command {
                Command::SaveRoutineItem { content_id, .. } => (true, content_id.clone()),
                Command::ComposePassages { content_id, .. } => {
                    (true, (!content_id.is_empty()).then(|| content_id.clone()))
                }
                Command::PreviewHistoryProblemPlan { spec }
                | Command::SaveHistoryProblemPlan { spec, .. } => {
                    (true, Some(spec.content_id.clone()))
                }
                Command::PreviewProblemCuts { .. }
                | Command::PreviewMultiProblemPlan { .. }
                | Command::SaveMultiProblemPlan { .. } => (true, None),
                _ => (false, None),
            };
            let mut original_source: Option<SourceOrigin> = None;
            let mut original_target: Option<Option<String>> = None;
            for _ in 0..3 {
                token.check()?;
                let (reply, receiver) = mpsc::sync_channel(1);
                engine
                    .tx
                    .send(runtime_request::Request::RoutineEditContext {
                        source,
                        expected: expected.clone(),
                        reply,
                    })
                    .map_err(|_| "音乐引擎已关闭")?;
                let context = receiver.recv().map_err(|_| "计划编辑快照通道已关闭")??;
                let target = target_revision(&command, &context.preferences, expected_revision.is_some())?;
                if expected_revision.as_ref().is_some_and(|expected| target.as_ref() != Some(expected)) {
                    return Err("目标计划已更新，当前草稿保留；请重新读取并核对后保存".into());
                }
                if original_target
                    .as_ref()
                    .is_some_and(|original| original != &target)
                    && !has_saved_sequence(&command, &context.preferences)
                {
                    return Err("目标计划已由其他操作更新，请重新读取后核对修改".into());
                }
                original_target = Some(target);
                if let Some(origin) = &context.source_origin {
                    if let Some(original) = &original_source {
                        if !original.same_origin(origin)? {
                            return Err("当前练习条件或来源资料已改变，请重新读取后保存项目".into());
                        }
                    }
                    original_source = Some(origin.clone());
                }
                let prepared = context.prepare(&command, &token)?;
                let (reply, receiver) = mpsc::sync_channel(1);
                // The worker retains the large collections until the actor has replied.
                engine
                    .tx
                    .send(runtime_request::Request::RoutineEditCommit {
                        prepared: prepared.installation.clone(),
                        token: token.clone(),
                        reply,
                    })
                    .map_err(|_| "音乐引擎已关闭")?;
                if receiver.recv().map_err(|_| "计划保存通道已关闭")?? {
                    return Ok(prepared.value);
                }
            }
            Err("计划或练习进度正在更新，请重新读取后再保存".into())
        })
    }
}
