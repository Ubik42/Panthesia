//! Capture one musical instant cheaply; build the report and historical trend on a worker.
use crate::*;
use panthesia_core::practice::PracticeReport;

pub(crate) struct Context {
    file: Option<SongFile>,
    notes: PracticeNotes,
    config: SongConfig,
    assignments: HandAssignments,
    hands: String,
    history: PracticeHistoryStore,
    previous: Option<preferences::Shared<AttemptSummary>>,
    report: PracticeReport,
    mode: String,
    history_id: Option<String>,
    summary_version: String,
    score_revision: u64,
    annotation_revision: u64,
}
impl Context {
    pub(super) fn prepare(
        self,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<serde_json::Value, String> {
        check()?;
        let summary = match self.previous {
            Some(summary) => summary,
            None => self.report.summary_checked(&check)?.into(),
        };
        check()?;
        let mut result = serde_json::to_value(summary).map_err(|error| error.to_string())?;
        result["mode"] = serde_json::json!(self.mode);
        let content_id = self.file.as_ref().map(|file| file.content_id.as_str());
        if let Some(history) = content_id.and_then(|id| self.history.song(id)) {
            let scope = practice_conditions::scope_checked(
                self.file.as_deref(),
                &self.notes,
                &self.config,
                &self.assignments,
                &self.hands,
                &check,
            )?;
            check()?;
            let changed_scope = history
                .sessions
                .last()
                .is_some_and(|session| session.scope.as_ref().is_some_and(|old| *old != scope));
            let overview = if changed_scope {
                history.overview(0, 0)
            } else {
                history.overview(20, 5)
            };
            result["trend"] = serde_json::json!({"attempts":overview.trend_attempts,
                "accuracyDelta":overview.accuracy_delta,"speedDelta":overview.speed_delta,
                "tempoDelta":overview.tempo_bpm_delta});
        }
        check()?;
        result["source"] = serde_json::json!({"contentId":content_id,"historyId":self.history_id,
            "summaryVersion":self.summary_version,"scoreRevision":self.score_revision,
            "annotationRevision":self.annotation_revision});
        Ok(result)
    }
}
impl Player {
    pub(super) fn capture_feedback(&self) -> Context {
        let summary = self.projected_summary();
        let summary_version = self.summary_version(&summary);
        let current_round = self.has_round_attempt()
            || self.current_round_summary().is_some()
            || self.state.status == "finished" && self.state.mode != "listen"
            || self
                .storage_id
                .as_ref()
                .is_some_and(|id| id.starts_with("round-"));
        Context {
            file: self.file.clone(),
            notes: self.notes.clone(),
            config: self.config.clone(),
            assignments: self.note_hands.clone(),
            hands: self.state.hands.clone(),
            history: self.history.clone(),
            previous: summary,
            report: self.matcher.report(),
            mode: if current_round {
                self.state.mode.clone()
            } else {
                self.previous_mode
                    .as_ref()
                    .unwrap_or(&self.state.mode)
                    .clone()
            },
            history_id: self.state.current_history_id.clone(),
            summary_version,
            score_revision: self.score_revision,
            annotation_revision: self.state.annotation_revision,
        }
    }
}
impl Engine {
    pub(super) fn feedback_task(&self) -> Result<serde_json::Value, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::FeedbackContext(reply))
            .map_err(|_| "音乐引擎已关闭")?;
        let context = receiver.recv().map_err(|_| "练习反馈读取通道已关闭")??;
        let content_id = context.file.as_ref().map(|file| file.content_id.clone());
        self.tasks.run("生成本轮反馈", content_id, move |token| {
            token.stage("readingHistory")?;
            context.prepare(|| token.check())
        })
    }
}
