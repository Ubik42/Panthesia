//! Practice settings and annotation edits prepare their projection before durable publication.
use crate::*;
use serde_json::Value;
/// A desktop editor always identifies the exact score that supplied its note indices.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub command: Command,
    pub content_id: String,
    pub engine_id: Option<String>,
    pub score_revision: u64,
    #[serde(default)]
    pub annotation_revision: Option<u64>,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub catalog_revision: Option<String>,
}
#[derive(Clone)]
pub(crate) struct Scope {
    pub content_id: String,
    pub engine_id: Option<String>,
    pub score_revision: u64,
    pub annotation_revision: Option<u64>,
}
#[derive(Clone, Copy)]
pub(crate) enum Kind {
    Fingers,
    Hands,
    Meter,
    Preferences,
    Sound,
    Metadata,
    Range,
}
impl Kind {
    pub(super) fn resets(self) -> bool {
        matches!(self, Self::Hands | Self::Meter | Self::Sound | Self::Range)
    }
    pub(super) fn changes_geometry(self) -> bool {
        matches!(self, Self::Hands | Self::Meter)
    }
    pub(super) fn visual(self) -> bool {
        matches!(self, Self::Fingers | Self::Hands | Self::Meter)
    }
}
pub(crate) fn classify(command: &Command) -> Option<Kind> {
    Some(match command {
        Command::Finger { .. }
        | Command::EditFingersFor { .. }
        | Command::UndoFingers
        | Command::UndoFingersFor { .. }
        | Command::ApplyFingers { .. }
        | Command::AcceptFingerPlan { .. }
        | Command::AcceptHeldFingerPlan { .. }
        | Command::ClearHeldFingerActions { .. }
        | Command::ClearNoteHeldFingerActions { .. }
        | Command::SaveHeldActionEdit { .. } => Kind::Fingers,
        Command::FingerPair { proof: Some(_), .. } => Kind::Fingers,
        Command::Track { .. } | Command::EditNotePlayback { .. } | Command::NoteHand { .. } | Command::ResetPartSettings { .. } | Command::SetPartHands { .. } | Command::ApplyHands { .. } | Command::UndoHands | Command::UndoHandsFor { .. } => Kind::Hands,
        Command::Meter { .. } | Command::SaveMeterMap { .. } => Kind::Meter,
        Command::TrackSound { .. } => Kind::Sound,
        Command::ApplyScoreRange { .. } | Command::ApplyTickRange { .. } => Kind::Range,
        Command::SetMetadata { .. } | Command::EditMetadata { .. } => Kind::Metadata,
        Command::TrackAppearance { .. } | Command::SaveFingerPractice { .. } | Command::SavePairFingerPractice { .. } => {
            Kind::Preferences
        }
        _ => return None,
    })
}
pub(crate) fn reads(command: &Command) -> bool {
    matches!(
        command,
        Command::Metadata | Command::HeldFingerDemoContext { .. }
            | Command::SuggestHands { .. }
            | Command::PreviewMeterMap { .. }
            | Command::FingerPlanContext { .. }
            | Command::ReviewFingerAcceptance { .. }
            | Command::ReviewHeldActionEdit { .. }
            | Command::FingerProfiles
            | Command::HandUndoState
            | Command::ReadHandAssignments { .. }
            | Command::ReadNotePlayback { .. }
            | Command::ReadMeterEditorState
            | Command::FingerPair { proof: None, .. }
    )
}
pub(super) fn require_idle(command: &Command) -> bool {
    matches!(
        command,
        Command::FingerPair { proof: Some(_), .. } | Command::SavePairFingerPractice { .. }
    )
}
pub(super) fn execute(
    reader: &mut Player,
    command: Command,
    token: &background_tasks::TaskToken,
) -> Result<Value, String> {
    token.check()?;
    reader.command(command)
}
/// Cloning editor state on the playback thread never copies all 30 undo batches.
/// The worker copies a shared history only when it appends or removes an entry.
#[derive(Clone)]
pub(crate) struct UndoStack<T>(Arc<Vec<T>>);
impl<T> Default for UndoStack<T> {
    fn default() -> Self {
        Self(Arc::new(Vec::new()))
    }
}
impl<T> std::ops::Deref for UndoStack<T> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        self.0.as_slice()
    }
}
impl<T> UndoStack<T> {
    pub(super) fn clear(&mut self) {
        *self = Self::default();
    }
}
impl<T: Clone> UndoStack<T> {
    pub(super) fn push(&mut self, item: T) {
        Arc::make_mut(&mut self.0).push(item);
    }
    pub(super) fn pop(&mut self) -> Option<T> {
        Arc::make_mut(&mut self.0).pop()
    }
    pub(super) fn remove(&mut self, index: usize) -> T {
        Arc::make_mut(&mut self.0).remove(index)
    }
}
pub(crate) type FingerUndo = UndoStack<(
    Vec<panthesia_core::library::FingerHint>,
    Vec<panthesia_core::library::FingerAction>,
)>;
pub(crate) type HandUndo = UndoStack<Vec<panthesia_core::library::NoteHandHint>>;
#[derive(Clone)]
pub(crate) struct Undo {
    fingers: FingerUndo,
    hands: HandUndo,
}
impl Undo {
    pub(super) fn capture(player: &Player) -> Self {
        Self {
            fingers: player.finger_undo.clone(),
            hands: player.hand_undo.clone(),
        }
    }
    pub(super) fn install(self, player: &mut Player) {
        player.finger_undo = self.fingers;
        player.hand_undo = self.hands;
    }
    pub(super) fn take(player: &mut Player) -> Self {
        Self {
            fingers: std::mem::take(&mut player.finger_undo),
            hands: std::mem::take(&mut player.hand_undo),
        }
    }
}
pub(crate) struct Patch {
    annotation_revision: u64,
    fingers: Option<FingerAssignments>,
    title: Option<String>,
    undo: Undo,
}
impl Patch {
    pub(super) fn take(reader: &mut Player, kind: Kind) -> Self {
        Self {
            annotation_revision: reader.state.annotation_revision,
            title: matches!(kind, Kind::Metadata).then(|| reader.title.clone()),
            fingers: matches!(kind, Kind::Fingers).then(|| std::mem::take(&mut reader.fingers)),
            undo: Undo::take(reader),
        }
    }
    pub(super) fn install(self, player: &mut Player) {
        if let Some(fingers) = self.fingers {
            let old = std::mem::replace(&mut player.fingers, fingers);
            player.retire(old);
        }
        if let Some(title) = self.title { player.title = title; }
        player.state.annotation_revision = self.annotation_revision;
        self.undo.install(player);
    }
}
struct Lease {
    tx: mpsc::Sender<runtime_request::Request>,
    id: String,
    done: bool,
}
impl Lease {
    fn finish(mut self, result: Result<asset_edit::Outcome, String>) -> Result<Value, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::AssetEditFinish {
                id: self.id.clone(),
                result,
                reply: Some(reply),
            })
            .map_err(|_| "音乐引擎已关闭")?;
        self.done = true;
        receiver.recv().map_err(|_| "练习编辑结果通道已关闭")?
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if !self.done {
            let _ = self.tx.send(runtime_request::Request::AssetEditFinish {
                id: self.id.clone(),
                result: Err("练习编辑未完成，请重新读取当前标注后重试".into()),
                reply: None,
            });
        }
    }
}
impl Engine {
    pub fn edit_practice(&self, request: Request) -> Result<Value, String> {
        if self.closing.load(Ordering::Acquire) {
            return Err("正在保存并关闭程序，请等待完成".into());
        }
        storage_control::check_command(&self.storage_busy, &request.command)?;
        if matches!(request.command, Command::OpenPassage { .. }) {
            let label = if matches!(request.command, Command::OpenPassage { .. }) {"打开保存的练习段"} else {"打开速度阶梯"};
            return self.song_switch_task(crate::song_switch::Input::ScopedPractice {
                command:request.command,scope:Scope{engine_id:request.engine_id.clone(),content_id:request.content_id,score_revision:request.score_revision,annotation_revision:request.annotation_revision},
                catalog_revision:request.catalog_revision,
            }, label, None);
        }
        if crate::practice_catalog::edits(&request.command).is_some() {
            return self.catalog_task_with_creation(request.command, Some(Scope {
                engine_id:request.engine_id.clone(),content_id:request.content_id,score_revision:request.score_revision,annotation_revision:request.annotation_revision,
            }), request.catalog_revision, request.request_id);
        }
        let kind = classify(&request.command).ok_or("此入口只接受练习设置与标注编辑")?;
        self.practice_edit_task(
            request.command,
            kind,
            Some(Scope {
                engine_id: request.engine_id.clone(),
                content_id: request.content_id,
                score_revision: request.score_revision,
                annotation_revision: request.annotation_revision,
            }),
        )
    }
    pub fn read_practice(&self, request: Request) -> Result<Value, String> {
        if self.closing.load(Ordering::Acquire) {
            return Err("正在保存并关闭程序，请等待完成".into());
        }
        storage_control::check_command(&self.storage_busy, &request.command)?;
        let scope = Some(Scope {
            engine_id: request.engine_id.clone(),
            content_id: request.content_id.clone(),
            score_revision: request.score_revision,
            annotation_revision: request.annotation_revision,
        });
        if crate::practice_catalog::reads(&request.command) { return self.catalog_task(request.command, scope, None); }
        match request.command {
            Command::SuggestFingerPlans { request } => self.finger_plan_task(request, false, scope),
            Command::SuggestHeldFingerPlans { request } => {
                self.finger_plan_task(request, true, scope)
            }
            command if reads(&command) => {
                let observation = self.observe_writers();
                let settled_read = matches!(&command, Command::HandUndoState | Command::ReadHandAssignments { .. } | Command::ReadMeterEditorState);
                let context = self.practice_read_context(scope)?;
                let engine = self.clone();
                self.tasks.run(
                    if matches!(command, Command::Metadata) {"读取曲目信息"} else {"读取练习标注"},
                    Some(request.content_id),
                    move |token| {
                        token.stage("preparingPractice")?;
                        let mut result = (|| context.into_player(false)?.command(command))()?;
                        token.check()?;
                        if settled_read {
                            result["writeSettled"] = serde_json::json!(engine.writers_settled(&observation));
                        }
                        Ok(result)
                    },
                )
            }
            _ => Err("此入口只接受练习标注读取与预览".into()),
        }
    }
    pub(super) fn practice_read_context(
        &self,
        scope: Option<Scope>,
    ) -> Result<asset_edit::Context, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::AssetReadContext {
                registry: true,
                export: false,
                editor: true,
                scope,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        receiver.recv().map_err(|_| "练习读取快照通道已关闭")?
    }
    pub(super) fn finger_plan_task(
        &self,
        request: fingerings::PlanRequest,
        held: bool,
        scope: Option<Scope>,
    ) -> Result<Value, String> {
        let context = self.practice_read_context(scope)?;
        self.tasks.run(
            if held {
                "生成持音换指方案"
            } else {
                "比较指法方案"
            },
            Some(request.content_id.clone()),
            move |token| {
                token.stage("computing")?;
                let result = (|| {
                        let reader = context.into_player(false)?;
                        let file = reader.file.as_ref().ok_or("请先打开曲目")?;
                        let prepared = fingerings::prepare(
                            file,
                            reader.notation.as_deref(),
                            &reader.config,
                            &reader.fingers,
                            &reader.note_hands,
                            request,
                        )?;
                        token.source(
                            prepared.request.content_id.clone(),
                            prepared.fingerprint.clone(),
                        )?;
                        token.check()?;
                        if held {
                            fingerings::held_plans(prepared)
                        } else {
                            fingerings::plans(prepared)
                        }
                    })()?;
                token.check()?;
                Ok(result)
            },
        )
    }

    pub(super) fn practice_edit_task(
        &self,
        command: Command,
        kind: Kind,
        scope: Option<Scope>,
    ) -> Result<Value, String> {
        let pending = self.pending_operation()?;
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = format!(
            "practice-edit-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        );
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::PracticeEditBegin {
                id: id.clone(),
                kind,
                strict: require_idle(&command),
                scope,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let context = receiver.recv().map_err(|_| "练习编辑准备通道已关闭")??;
        let lease = Lease {
            tx: self.tx.clone(),
            id,
            done: false,
        };
        let label = match kind {
            Kind::Fingers => "保存指法与换指",
            Kind::Hands => "保存逐音分手",
            Kind::Meter => "保存拍号与小节",
            Kind::Preferences => "保存练习编辑设置",
            Kind::Sound => "保存音轨声音",
            Kind::Metadata => "保存曲目信息",
            Kind::Range => "应用练习范围",
        };
        let source = context.score_identity();
        self.tasks.run(
            label,
            source.as_ref().map(|(id, _)| id.clone()),
            move |token| {
                let _pending = pending;
                let result = (|| {
                    token.check()?;
                    if let Some((id, revision)) = source {
                        token.source(id, revision.to_string())?;
                    }
                    let outcome = context.prepare_practice(command, kind, &token)?;
                    token.check()?;
                    token.begin_commit()?;
                    Ok(outcome)
                })();
                lease.finish(result)
            },
        )
    }
}
impl Player {
    /// Reject a detached edit when an external sidecar no longer describes the loaded notes.
    /// Off-view generated annotations are retained by the shared projection rather than rejected.
    pub(super) fn validate_practice_annotations(&self) -> Result<(), String> {
        let file = self.file.as_ref().ok_or("请先打开曲目")?;
        let path = self.annotation_path(file)?;
        let sidecar = match panthesia_core::library::load_song_sidecar(&path, &file.content_id) {
            Ok(sidecar) => sidecar,
            Err(panthesia_core::library::MetadataError::Read(error))
                if error.kind() == std::io::ErrorKind::NotFound =>
            {
                Default::default()
            }
            Err(error) => return Err(error.to_string()),
        };
        let hands: HashMap<_, _> = sidecar
            .hands
            .iter()
            .filter(|hint| {
                file.tracks
                    .iter()
                    .find(|track| track.track_id == hint.track_id)
                    .and_then(|track| track.notes.get(hint.note_index))
                    .is_some()
            })
            .map(|hint| ((hint.track_id, hint.note_index), hint.part))
            .collect();
        if hands != *self.note_hands
            || sidecar.meter != self.meter_correction
            || sidecar.meter_map != self.meter_map
            || crate::finger_annotations::project(file, self.exercise, &sidecar.fingerings)?
                != *self.fingers
        {
            return Err("曲目的指法、分手或小节标注已在程序外改变，请重新打开曲目后编辑".into());
        }
        Ok(())
    }
    pub(super) fn check_practice_scope(&self, scope: Option<&Scope>) -> Result<(), String> {
        if let Some(scope) = scope {
            if scope.engine_id.as_deref().is_some_and(|expected| self.source_engine_id() != Some(expected)) {
                return Err("练习室已重新启动，请重新读取当前曲目后继续编辑；未保存输入仍保留在界面中".into());
            }
            if self.file.as_ref().map(|file| file.content_id.as_str())
                != Some(scope.content_id.as_str())
                || self.score_revision != scope.score_revision
                || scope
                    .annotation_revision
                    .is_some_and(|revision| revision != self.state.annotation_revision)
            {
                return Err("练习内容已更新，请刷新编辑窗口后重试".into());
            }
        }
        Ok(())
    }
    pub(super) fn begin_practice_edit(
        &mut self,
        id: String,
        kind: Kind,
        strict: bool,
        scope: Option<Scope>,
    ) -> Result<asset_edit::Context, String> {
        self.check_practice_scope(scope.as_ref())?;
        if strict
            && (matches!(self.state.status.as_str(), "playing" | "countIn")
                || !self.state.pressed.is_empty())
        {
            return Err("请先暂停演奏、结束活动计划并松开琴键，再保存这项指法编辑".into());
        }
        if kind.resets() {
        }
        let mut context = self.begin_asset_edit(id, false, true, true)?;
        context.set_undo(Undo::capture(self));
        Ok(context)
    }
}
