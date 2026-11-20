//! One immutable assessment supplies the saved round, live summary and continuation rules.
use crate::expression_goal::{
    ExpressionGoal, ExpressionGoalResult, NotePedalEvidence, NoteVelocityEvidence,
};
use crate::*;
use panthesia_core::practice::{ExpressionSummary, PracticeReport, PracticeResult};

pub(crate) type SharedAssessment = preferences::Shared<Assessment>;
#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GoalState {
    Pending,
    Ready,
    Unavailable,
}
pub(crate) struct Attempt {
    file: Option<SongFile>,
    report: PracticeReport,
    capture: performance_archive::Capture,
}
impl Attempt {
    fn capture(player: &Player) -> Self {
        Self {
            file: player.file.clone(),
            report: player.matcher.report(),
            capture: player.performance_capture.clone(),
        }
    }
    fn matches(&self, player: &Player) -> bool {
        self.file.as_ref().map(|file| &file.content_id)
            == player.file.as_ref().map(|file| &file.content_id)
            && self.report.same_snapshot(&player.matcher.report())
            && self.capture.same_evidence(&player.performance_capture)
    }
}
struct Selection {
    file: Option<SongFile>,
    notes: PracticeNotes,
    config: SongConfig,
    hands: String,
    assignments: HandAssignments,
    passage: Option<(u64, u64)>,
}
impl Selection {
    fn same_song(&self, player: &Player) -> bool {
        self.file.as_ref().map(|file| &file.content_id)
            == player.file.as_ref().map(|file| &file.content_id)
    }
    fn capture(player: &Player) -> Self {
        Self {
            file: player.file.clone(),
            notes: player.notes.clone(),
            config: player.config.clone(),
            hands: player.state.hands.clone(),
            assignments: player.note_hands.clone(),
            passage: bounds(player),
        }
    }
    fn matches(&self, player: &Player) -> bool {
        let file = match (&self.file, &player.file) {
            (Some(old), Some(current)) => old.same_snapshot(current),
            (None, None) => true,
            _ => false,
        };
        let tracks = self.config.tracks.len() == player.config.tracks.len()
            && self
                .config
                .tracks
                .iter()
                .zip(player.config.tracks.iter())
                .all(|(old, current)| {
                    old.track_id == current.track_id
                        && old.player == current.player
                        && old.practice_part == current.practice_part
                });
        file && self.notes.same_snapshot(&player.notes)
            && Arc::ptr_eq(&self.config.note_players, &player.config.note_players)
            && tracks
            && self.hands == player.state.hands
            && self.assignments.same_snapshot(&player.note_hands)
            && self.passage == bounds(player)
    }
}
fn bounds(player: &Player) -> Option<(u64, u64)> {
    player
        .state
        .passage
        .as_ref()
        .map(|passage| (passage.start.to_bits(), passage.end.to_bits()))
}
pub(crate) struct Assessment {
    selection: preferences::Shared<Selection>,
    report: PracticeReport,
    capture: performance_archive::Capture,
    pub summary: preferences::Shared<AttemptSummary>,
    pub target_notes: usize,
    velocity_requested: bool,
    pedal_requested: bool,
    velocity: Option<NoteVelocityEvidence>,
    pedal: Option<NotePedalEvidence>,
}
impl Assessment {
    fn requested(player: &Player) -> (bool, bool) {
        let goals = [
            player.active_expression_goal.as_ref(),
            player
                .routine
                .as_ref()
                .and_then(|active| active.item.goal.expression.as_ref()),
            player
                .ladder
                .as_ref()
                .filter(|run| run.active)
                .and_then(|run| run.preset.expression.as_ref()),
        ];
        (
            goals
                .iter()
                .flatten()
                .any(|goal| goal.note_velocity_difference.is_some()),
            goals
                .iter()
                .flatten()
                .any(|goal| goal.note_pedal_mismatch_count.is_some()),
        )
    }
    pub fn reusable(&self, player: &Player, report: &PracticeReport) -> bool {
        let (velocity, pedal) = Self::requested(player);
        self.selection.matches(player)
            && self.report.same_snapshot(report)
            && self.capture.same_evidence(&player.performance_capture)
            && (!velocity || self.velocity_requested)
            && (!pedal || self.pedal_requested)
    }
    pub fn prepare(
        player: &Player,
        report: &PracticeReport,
        token: &background_tasks::TaskToken,
    ) -> Result<SharedAssessment, String> {
        token.check()?;
        let (velocity_requested, pedal_requested) = Self::requested(player);
        let target_notes = player.practice_target_count_checked(|| token.check())?;
        token.check()?;
        let summary = report.summary_checked(|| token.check())?.into();
        token.check()?;
        let evidence = player.performance_capture.note_evidence(
            report.results(),
            target_notes,
            velocity_requested,
            pedal_requested,
            || token.check(),
        )?;
        token.check()?;
        Ok(Self {
            selection: Selection::capture(player).into(),
            report: report.clone(),
            capture: player.performance_capture.clone(),
            summary,
            target_notes,
            velocity_requested,
            pedal_requested,
            velocity: evidence.velocity,
            pedal: evidence.pedal,
        }
        .into())
    }
    pub fn matches_attempt(&self, player: &Player) -> bool {
        self.selection.same_song(player)
            && self.report.same_snapshot(&player.matcher.report())
            && self.capture.same_evidence(&player.performance_capture)
    }
    fn matches_results(&self, player: &Player, results: &[PracticeResult]) -> bool {
        self.selection.matches(player)
            && self.capture.same_evidence(&player.performance_capture)
            && results.len() == self.report.results().len()
            && results.as_ptr() == self.report.results().as_ptr()
    }
    pub fn result(
        &self,
        player: &Player,
        goal: &ExpressionGoal,
        expression: ExpressionSummary,
        results: &[PracticeResult],
    ) -> Option<ExpressionGoalResult> {
        if !self.matches_results(player, results) {
            return None;
        }
        self.result_from_facts(goal, expression)
    }
    fn result_from_facts(
        &self,
        goal: &ExpressionGoal,
        expression: ExpressionSummary,
    ) -> Option<ExpressionGoalResult> {
        if goal.note_velocity_difference.is_some() && !self.velocity_requested
            || goal.note_pedal_mismatch_count.is_some() && !self.pedal_requested
        {
            return None;
        }
        Some(goal.result_with_note_evidence(expression, self.velocity, self.pedal))
    }
}
pub(crate) struct TargetCount {
    selection: preferences::Shared<Selection>,
    pub count: usize,
}
impl TargetCount {
    pub fn matches(&self, player: &Player) -> bool {
        self.selection.matches(player)
    }
}
impl Player {
    pub(super) fn mark_round_attempt(&self) {
        let old = self
            .projections
            .attempt
            .replace(Some(Attempt::capture(self)));
        if old.is_some() {
            self.retire(old);
        }
    }
    pub(super) fn has_round_attempt(&self) -> bool {
        self.projections
            .attempt
            .borrow()
            .as_ref()
            .is_some_and(|attempt| attempt.matches(self))
    }
    pub(super) fn retain_round_assessment(&self, assessment: SharedAssessment) {
        if self
            .projections
            .assessment
            .borrow()
            .as_ref()
            .is_some_and(|old| old.same_snapshot(&assessment))
        {
            return;
        }
        let old = self.projections.target_count.replace(Some(TargetCount {
            selection: assessment.selection.clone(),
            count: assessment.target_notes,
        }));
        self.retire(old);
        let old = self.projections.assessment.replace(Some(assessment));
        self.retire(old);
    }
    pub(super) fn prune_round_assessment(&self) {
        let mut attempt = self.projections.attempt.borrow_mut();
        let old = if attempt
            .as_ref()
            .is_some_and(|attempt| !attempt.matches(self))
        {
            attempt.take()
        } else {
            None
        };
        drop(attempt);
        if old.is_some() {
            self.retire(old);
        }
        let mut cached = self.projections.assessment.borrow_mut();
        let old = if cached
            .as_ref()
            .is_some_and(|assessment| !assessment.matches_attempt(self))
        {
            cached.take()
        } else {
            None
        };
        drop(cached);
        if old.is_some() {
            self.retire(old);
        }
        let mut target = self.projections.target_count.borrow_mut();
        let old = if target.as_ref().is_some_and(|count| !count.matches(self)) {
            target.take()
        } else {
            None
        };
        drop(target);
        if old.is_some() {
            self.retire(old);
        }
    }
    pub(super) fn accept_round_assessment(&self, id: &str, assessment: SharedAssessment) {
        if self.storage_id.as_deref() == Some(id) && assessment.matches_attempt(self) {
            self.retain_round_assessment(assessment);
        } else {
            self.retire(assessment);
        }
    }
    pub(super) fn assessed_expression(
        &self,
        goal: &ExpressionGoal,
        expression: ExpressionSummary,
        results: &[PracticeResult],
    ) -> Option<ExpressionGoalResult> {
        self.projections
            .assessment
            .borrow()
            .as_ref()?
            .result(self, goal, expression, results)
    }
    pub(super) fn completed_expression(
        &self,
        goal: &ExpressionGoal,
    ) -> Option<ExpressionGoalResult> {
        let cached = self.projections.assessment.borrow();
        let assessment = cached
            .as_ref()
            .filter(|assessment| assessment.matches_attempt(self))?;
        // Display the requirements captured for this attempt; display-only changes
        // must not reinterpret its already-completed note evidence.
        assessment.result_from_facts(goal, assessment.summary.expression)
    }
    pub(super) fn current_round_summary(&self) -> Option<preferences::Shared<AttemptSummary>> {
        self.projections
            .assessment
            .borrow()
            .as_ref()
            .filter(|assessment| assessment.matches_attempt(self))
            .map(|assessment| assessment.summary.clone())
    }
    pub(super) fn current_round_assessment(&self) -> Option<SharedAssessment> {
        self.projections
            .assessment
            .borrow()
            .as_ref()
            .filter(|assessment| assessment.matches_attempt(self))
            .cloned()
    }
    pub(super) fn projected_summary(&self) -> Option<preferences::Shared<AttemptSummary>> {
        if let Some(summary) = self.current_round_summary() {
            return Some(summary);
        }
        let saving = self
            .storage_id
            .as_ref()
            .is_some_and(|id| id.starts_with("round-"));
        if (saving
            || self.has_round_attempt()
            || self.state.status == "finished" && self.state.mode != "listen")
            && self.pending_saves.is_some()
            && !self.state.saved
        {
            return None;
        }
        self.previous_summary.clone()
    }
}
