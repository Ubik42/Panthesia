//! A completed attempt is captured on playback, persisted on storage, then installed on playback.
use crate::*;
use panthesia_core::practice::{AttemptSummary, PracticeReport};
use panthesia_core::practice_history::PracticeTimeEntry;

pub(crate) struct Context {
    data: PathBuf,
    content_id: String,
    title: String,
    history: PracticeHistoryStore,
    session: PracticeSession,
    entry: PendingTime,
    capture: performance_archive::Capture,
    report: PracticeReport,
    conditions: asset_edit::Context,
    expression_goal: Option<expression_goal::ExpressionGoal>,
    assessment: Option<round_analysis::SharedAssessment>,
    duration: f64,
    mode: String,
}
struct PendingTime {
    saved_at_unix_ms: u64,
    slices: PracticeTimeSlices,
    untracked_ms: u64,
}
impl PendingTime {
    fn materialize(self) -> PracticeTimeEntry {
        PracticeTimeEntry {
            saved_at_unix_ms: self.saved_at_unix_ms,
            slices: self.slices.materialize(),
            untracked_ms: self.untracked_ms,
        }
    }
}
pub(crate) struct Outcome {
    history: PracticeHistoryStore,
    history_id: String,
    summary: preferences::Shared<AttemptSummary>,
    assessment: round_analysis::SharedAssessment,
    mode: String,
}
impl Context {
    fn commit(
        mut self,
        token: &background_tasks::TaskToken,
        pipeline: &pending_save::Pipeline,
        id: &str,
    ) -> Result<Outcome, String> {
        token.check()?;
        token.stage("analyzingRound")?;
        let mut conditions = self.conditions.into_player(true)?;
        conditions.performance_capture = self.capture.clone();
        conditions.active_expression_goal = self.expression_goal;
        let assessment = match self
            .assessment
            .filter(|assessment| assessment.reusable(&conditions, &self.report))
        {
            Some(assessment) => assessment,
            None => round_analysis::Assessment::prepare(&conditions, &self.report, token)?,
        };
        conditions.retain_round_assessment(assessment.clone());
        let summary = assessment.summary.clone();
        token.check()?;
        pipeline
            .sender()
            .send(runtime_request::Request::RoundAnalysisReady {
                id: id.into(),
                assessment: assessment.clone(),
            })
            .map_err(|_| "音乐引擎已关闭")?;
        self.session.summary = summary.materialize();
        self.session.context =
            Some(conditions.history_context_with_summary(&summary, self.report.results()));
        self.session.scope = Some(conditions.practice_scope_checked(|| token.check())?);
        token.check()?;
        pipeline.flush()?;
        token.stage("serializing")?;
        let history_id = self.session.stable_id();
        let archive = performance_archive::prepare_checked(
            &self.content_id,
            &history_id,
            &self.capture,
            self.duration,
            self.report.results(),
            || token.check(),
        )?;
        token.check()?;
        let history = self
            .history
            .stage_session_with_time(
                &self.content_id,
                &self.title,
                self.session,
                self.entry.materialize(),
            )?
            .unwrap_or(self.history);
        let bytes = history.snapshot_bytes().map_err(|e| e.to_string())?;
        token.check()?;
        token.begin_commit()?;
        settings_storage::recover(&self.data)?;
        if settings_storage::pending(&self.data) {
            return Err("设置保存尚待恢复，请重新启动后再保存本轮".into());
        }
        let path = performance_archive::path(&self.data, &self.content_id, &history_id);
        let name = path
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or("回放保存位置无效")?;
        round_storage::commit(
            &self.data,
            archive.as_ref().map(|a| (name, a.as_slice())),
            &bytes,
        )?;
        Ok(Outcome {
            history,
            history_id,
            summary,
            assessment,
            mode: self.mode,
        })
    }
}
struct Guard {
    pipeline: pending_save::Pipeline,
    observing: bool,
    tx: mpsc::Sender<runtime_request::Request>,
    id: String,
    automatic: bool,
    finished: bool,
}
impl Guard {
    fn finish(
        mut self,
        result: Result<Outcome, String>,
        reply: Option<runtime_request::Reply>,
    ) -> Result<(), String> {
        if self.observing {
            self.pipeline.observe_recovery();
        }
        self.tx
            .send(runtime_request::Request::RoundSaveFinish {
                id: self.id.clone(),
                result,
                automatic: self.automatic,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        self.finished = true;
        Ok(())
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        if !self.finished {
            if self.observing {
                self.pipeline.observe_recovery();
            }
            let _ = self.tx.send(runtime_request::Request::RoundSaveFinish {
                id: self.id.clone(),
                result: Err("本轮保存尚未完成，演奏结果仍保留在本次运行中，可重试保存".into()),
                automatic: false,
                reply: None,
            });
        }
    }
}
fn id() -> String {
    static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    format!(
        "round-{}-{}",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    )
}
impl Engine {
    pub(super) fn save_round_task(&self) -> Result<serde_json::Value, String> {
        let engine = self.clone();
        let id = id();
        let mut guard = Guard {
            pipeline: engine.pending_saves.clone(),
            observing: false,
            tx: engine.tx.clone(),
            id: id.clone(),
            automatic: false,
            finished: false,
        };
        let (reply, receiver) = mpsc::sync_channel(1);
        // Freeze the attempt before waiting behind previous storage work. This
        // control message captures immutable roots; it performs no disk access.
        engine
            .control_tx
            .send(runtime_request::Request::RoundSaveBegin { id, reply })
            .map_err(|_| "音乐引擎已关闭")?;
        let Some(context) = receiver.recv().map_err(|_| "音乐引擎已关闭")?? else {
            guard.finished = true;
            return Ok(serde_json::json!({"ok":true}));
        };
        self.storage_tasks.run("保存本轮练习", None, move |token| {
            guard.observing = true;
            let result = context.commit(&token, &engine.pending_saves, &guard.id);
            let (reply, receiver) = mpsc::sync_channel(1);
            guard.finish(result, Some(reply))?;
            receiver.recv().map_err(|_| "音乐引擎已关闭")?
        })
    }
}
impl Player {
    pub(super) fn begin_round_save(&mut self, id: String) -> Result<Option<Context>, String> {
        if self.storage_busy.load(Ordering::Acquire) {
            return Err("其他资料正在保存，请稍候".into());
        }
        if self.state.saved {
            return Ok(None);
        }
        if is_recital_mode(&self.state.mode) && self.state.status != "finished" {
            return Err("完整演奏结束后自动保存结果".into());
        }
        let score = self.matcher.snapshot();
        if score.matched_notes + score.wrong_notes + score.missed_notes == 0 {
            return Err("还没有演奏记录，无法保存结果".into());
        }
        if self.recorder.is_recording() {
            return Err("请先停止录音再保存练习结果".into());
        }
        // A save represents one exact musical instant. Never let input extend it during publication.
        if self.state.status == "playing" || self.state.status == "countIn" {
            self.state.status = "paused".into();
        }
        self.panic();
        self.round_resume_epoch = Some(self.audio_stop_epoch);
        self.time_connected = false;
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let hands = match self.state.hands.as_str() {
            "left" => PracticeHands::Left,
            "right" => PracticeHands::Right,
            "custom" | "other" => PracticeHands::Custom,
            _ => PracticeHands::Both,
        };
        let session = PracticeSession::new(
            self.state
                .passage
                .as_ref()
                .map_or(PracticeSessionKind::WholeSong, |passage| {
                    PracticeSessionKind::Loop {
                        start_measure: file
                            .measures
                            .partition_point(|m| m.as_secs_f64() <= passage.start)
                            .max(1),
                        end_measure: file
                            .measures
                            .partition_point(|m| m.as_secs_f64() < passage.end)
                            .max(1),
                    }
                }),
            hands,
            self.state.speed as f32,
            AttemptSummary::default(),
        )
        .with_playing_ms(self.session_clock.as_millis().min(u128::from(u64::MAX)) as u64)
        .with_mode(&self.state.mode)
        .with_effective_tempo_bpm(Some(
            (file.tempo_track.bpm_at_seconds(self.state.position) * self.state.speed)
                .round()
                .clamp(1., 65535.) as u16,
        ));
        let entry = PendingTime {
            saved_at_unix_ms: session.recorded_at_unix_ms,
            slices: self.pending_time.clone(),
            untracked_ms: self.pending_untracked,
        };
        let context = Context {
            data: self.data.clone(),
            content_id: file.content_id.clone(),
            title: self.title.clone(),
            history: self.history.clone(),
            session,
            entry,
            capture: self.performance_capture.clone(),
            report: self.matcher.report(),
            conditions: self.capture_asset_context(true, true),
            expression_goal: self.active_expression_goal.clone(),
            assessment: self.current_round_assessment(),
            duration: self.session_clock.as_secs_f64(),
            mode: self.state.mode.clone(),
        };
        self.mark_round_attempt();
        self.storage_id = Some(id);
        self.storage_busy.store(true, Ordering::Release);
        Ok(Some(context))
    }
    pub(super) fn queue_automatic_round_save(&mut self) -> Result<(), String> {
        let pipeline = self.pending_saves.clone().ok_or("保存队列尚未就绪")?;
        let id = id();
        let Some(context) = self.begin_round_save(id.clone())? else {
            self.continue_finished_round();
            return Ok(());
        };
        let mut guard = Guard {
            pipeline: pipeline.clone(),
            observing: false,
            tx: pipeline.sender(),
            id: id.clone(),
            automatic: true,
            finished: false,
        };
        let worker = pipeline.clone();
        if let Err(error) = pipeline.post_exclusive("保存本轮练习", move |token| {
            guard.observing = true;
            let result = context.commit(&token, &worker, &guard.id);
            let task_result = result
                .as_ref()
                .map(|_| serde_json::json!({"ok":true}))
                .map_err(Clone::clone);
            guard.finish(result, None)?;
            task_result
        }) {
            // The dropped guard also sends a failure; the operation ID makes the second result inert.
            return self.finish_round_save(&id, Err(error), false).map(|_| ());
        }
        Ok(())
    }
    pub(super) fn finish_round_save(
        &mut self,
        id: &str,
        result: Result<Outcome, String>,
        automatic: bool,
    ) -> Result<serde_json::Value, String> {
        if self.storage_id.as_deref() != Some(id) {
            self.retire(result);
            return Err("本轮保存任务已失效".into());
        }
        self.storage_id = None;
        let unchanged_epoch = self.round_resume_epoch.take() == Some(self.audio_stop_epoch);
        let resume = automatic && unchanged_epoch;
        match result {
            Ok(outcome) => {
                if outcome.assessment.matches_attempt(self) {
                    self.retain_round_assessment(outcome.assessment);
                } else {
                    self.retire(outcome.assessment);
                }
                let old = std::mem::replace(&mut self.history, outcome.history);
                self.retire(old);
                let time = std::mem::take(&mut self.pending_time);
                self.retire(time);
                self.pending_untracked = 0;
                let old = self.previous_summary.replace(outcome.summary);
                self.retire(old);
                self.previous_mode = Some(outcome.mode);
                self.state.saved = true;
                self.state.current_history_id = Some(outcome.history_id);
                if self.state.error == self.save_error {
                    self.state.error = None;
                }
                self.save_error = None;
                crate::storage_control::unblock(self);
                // A retry of a failed automatic save must still grade this round.
                // Only the original automatic operation may resume playback.
                self.round_continuation_pending = automatic || self.state.status == "finished";
                self.continue_saved_round(resume);
                Ok(serde_json::json!({"ok":true}))
            }
            Err(error) => {
                let recovery = storage_control::recovery(self);
                let recover = recovery.blocked()
                    || self
                        .pending_saves
                        .as_ref()
                        .is_some_and(|p| p.status().error.is_some());
                if recovery.round {
                    self.history.block_writes(error.clone());
                }
                self.storage_busy.store(recover, Ordering::Release);
                self.save_error = Some(error.clone());
                self.state.error = Some(error.clone());
                Err(error)
            }
        }
    }
    pub(super) fn continue_saved_round(&mut self, resume: bool) {
        if self.round_continuation_pending
            && self.state.saved
            && self.state.status == "finished"
            && self.state.error.is_none()
            && !self.storage_busy.load(Ordering::Acquire)
        {
            // Consume before advancing: a failed progress write retains its original
            // deferred save instead of counting this attempt twice on another retry.
            self.round_continuation_pending = false;
            self.advance_finished_round(resume);
        }
    }
}
