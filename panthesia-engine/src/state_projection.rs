//! Stable session projections retain their exact inputs instead of rebuilding on every tick.
use crate::*;
use panthesia_core::practice::PracticeReport;
use std::cell::RefCell;

#[derive(Default)]
pub(super) struct Cache {
    pub(super) scope: RefCell<Option<preferences::Shared<crate::practice_conditions::Scope>>>,
    pub(super) attempt: RefCell<Option<crate::round_analysis::Attempt>>,
    pub(super) assessment: RefCell<Option<crate::round_analysis::SharedAssessment>>,
    pub(super) target_count: RefCell<Option<crate::round_analysis::TargetCount>>,
    routine: RefCell<Option<Routine>>,
    finished: RefCell<Option<Finished>>,
    summary: RefCell<Option<Summary>>,
}
struct Summary {
    value: Option<preferences::Shared<AttemptSummary>>,
    version: String,
}

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StateCursor {
    pub summary_version: Option<String>,
}

/// A retained summary belongs to the exact version supplied by the caller.
/// Original full-state endpoints remain available to existing clients.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateFrame {
    state: Snapshot,
    summary_unchanged: bool,
}
impl Engine {
    pub fn state_frame(&self, cursor: StateCursor) -> StateFrame {
        let mut state = self.snapshot();
        let summary_unchanged = !state.summary_version.is_empty()
            && cursor.summary_version.as_ref() == Some(&state.summary_version);
        if summary_unchanged {
            state.summary = None;
        }
        StateFrame {
            state,
            summary_unchanged,
        }
    }
}
struct Routine {
    active: ActivePlan,
    runs: shared_map::SharedMap<String, routine_commands::RoutineRun>,
    value: Option<preferences::Shared<serde_json::Value>>,
}
struct Finished {
    report: PracticeReport,
    capture: performance_archive::Capture,
    goal: expression_goal::ExpressionGoal,
    file: Option<SongFile>,
    config: SongConfig,
    hands: String,
    assignments: HandAssignments,
    passage: Option<(u64, u64)>,
    value: expression_goal::ExpressionGoalResult,
}
impl Player {
    pub(super) fn completed_summary(&self) -> preferences::Shared<AttemptSummary> {
        if self.state.saved {
            if let Some(summary) = &self.previous_summary {
                return summary.clone();
            }
        }
        self.matcher.summary().into()
    }
    pub(super) fn summary_version(
        &self,
        value: &Option<preferences::Shared<AttemptSummary>>,
    ) -> String {
        let mut cached = self.projections.summary.borrow_mut();
        if let Some(previous) = cached.as_ref() {
            let unchanged = match (&previous.value, value) {
                (Some(old), Some(current)) => old.same_snapshot(current),
                (None, None) => true,
                _ => false,
            };
            if unchanged {
                return previous.version.clone();
            }
        }
        // A restarted engine must never accept an old client's cursor by coincidence.
        static ORIGIN: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let origin = ORIGIN.get_or_init(|| {
            format!(
                "{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            )
        });
        let version = format!("{origin}-{}", SERIAL.fetch_add(1, Ordering::Relaxed));
        let old = cached.replace(Summary {
            value: value.clone(),
            version: version.clone(),
        });
        self.retire(old);
        version
    }

    pub(super) fn routine_projection(&self) -> Option<preferences::Shared<serde_json::Value>> {
        let mut cached = self.projections.routine.borrow_mut();
        let Some(active) = &self.routine else {
            if let Some(old) = cached.take() {
                self.retire(old);
            }
            return None;
        };
        if let Some(previous) = cached.as_ref() {
            if previous.active.same_snapshot(active)
                && previous.runs.same_snapshot(&self.preferences.routine_runs)
            {
                return previous.value.clone();
            }
        }
        let value = self.routine_status().map(Into::into);
        let old = cached.replace(Routine {
            active: active.clone(),
            runs: self.preferences.routine_runs.clone(),
            value: value.clone(),
        });
        self.retire(old);
        value
    }

    pub(super) fn finished_expression_projection(
        &self,
    ) -> Option<expression_goal::ExpressionGoalResult> {
        let mut cached = self.projections.finished.borrow_mut();
        if self.state.status != "finished"
            || self.routine.is_some()
            || self.ladder.as_ref().is_some_and(|ladder| ladder.active)
        {
            if let Some(old) = cached.take() {
                self.retire(old);
            }
            return None;
        }
        let Some(goal) = &self.active_expression_goal else {
            if let Some(old) = cached.take() {
                self.retire(old);
            }
            return None;
        };
        if let Some(value) = self.completed_expression(goal) {
            return Some(value);
        }
        // Runtime saves prepare their assessment off playback. Direct legacy players
        // retain the synchronous path below until they adopt the storage pipeline.
        if self.pending_saves.is_some() {
            return None;
        }
        let report = self.matcher.report();
        let passage = self
            .state
            .passage
            .as_ref()
            .map(|p| (p.start.to_bits(), p.end.to_bits()));
        if let Some(previous) = cached.as_ref() {
            let same_file = match (&previous.file, &self.file) {
                (Some(old), Some(current)) => old.same_snapshot(current),
                (None, None) => true,
                _ => false,
            };
            if same_file
                && previous.report.same_snapshot(&report)
                && previous.capture.same_evidence(&self.performance_capture)
                && previous.goal == *goal
                && previous.config == self.config
                && previous.hands == self.state.hands
                && previous.passage == passage
                && previous.assignments.same_snapshot(&self.note_hands)
            {
                return Some(previous.value.clone());
            }
        }
        let target_notes = self.practice_target_count();
        let value = goal.result_with_note_evidence(
            report.expression_summary(),
            goal.note_velocity_difference.and_then(|_| {
                self.performance_capture
                    .note_velocity_evidence(report.results(), target_notes)
            }),
            goal.note_pedal_mismatch_count.and_then(|_| {
                self.performance_capture
                    .note_pedal_evidence(report.results(), target_notes)
            }),
        );
        let old = cached.replace(Finished {
            report,
            capture: self.performance_capture.clone(),
            goal: goal.clone(),
            file: self.file.clone(),
            config: self.config.clone(),
            hands: self.state.hands.clone(),
            assignments: self.note_hands.clone(),
            passage,
            value: value.clone(),
        });
        self.retire(old);
        Some(value)
    }

    pub(super) fn practice_target_count(&self) -> usize {
        if let Some(count) = self
            .projections
            .target_count
            .borrow()
            .as_ref()
            .filter(|count| count.matches(self))
        {
            return count.count;
        }
        self.uncached_practice_target_count()
    }
    pub(super) fn uncached_practice_target_count(&self) -> usize {
        match self.practice_target_count_checked(|| Ok::<(), std::convert::Infallible>(())) {
            Ok(count) => count,
            Err(never) => match never {},
        }
    }
    pub(super) fn practice_target_count_checked<E>(
        &self,
        mut check: impl FnMut() -> Result<(), E>,
    ) -> Result<usize, E> {
        check()?;
        let selection = hands::Selection::new(&self.config, &self.note_hands, &self.state.hands);
        let mut count = 0;
        let notes = self.state.passage.as_ref().map_or(self.notes.as_slice(), |p| {
            let start = self.notes.partition_point(|n| n.start.as_secs_f64() < p.start);
            let end = self.notes.partition_point(|n| n.start.as_secs_f64() < p.end);
            &self.notes[start..end]
        });
        for (index, note) in notes.iter().enumerate() {
            if index % 256 == 0 {
                check()?;
            }
            if selection.selected_part(note.track_id, note.index).is_some() {
                count += 1;
            }
        }
        check()?;
        Ok(count)
    }
}

/// Compute outside the shared-state lock. Readers never wait for musical projections.
pub(super) fn publish(player: &Player, shared: &Mutex<Snapshot>) {
    let next = player.snapshot();
    let old = shared
        .lock()
        .ok()
        .map(|mut slot| std::mem::replace(&mut *slot, next));
    player.retire(old);
}
