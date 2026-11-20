//! Read-only library practice projection from the same frozen history used by review.
use crate::*;
use panthesia_core::practice_history::{PracticeSession, PracticeSessionKind};
use serde_json::{Value, json};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Attempt {
    id: String,
    recorded_at: u64,
    kind: &'static str,
    range: Option<(usize, usize)>,
    mode: Option<String>,
    hands: String,
    bpm: Option<u16>,
    accuracy: Option<f32>,
    judged: Option<usize>,
    target: Option<usize>,
    restorable: bool,
    error_restart: bool,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    last: Option<Attempt>,
    whole: Option<Attempt>,
    whole_count: usize,
    comparable_whole_count: usize,
}
impl Attempt {
    fn from_session(s: &PracticeSession) -> Self {
        let context = s.context.as_ref();
        let range = match s.kind {
            PracticeSessionKind::WholeSong => None,
            PracticeSessionKind::Loop {
                start_measure,
                end_measure,
            } => Some((start_measure, end_measure)),
        };
        Self {
            id: s.stable_id(),
            recorded_at: s.recorded_at_unix_ms,
            kind: if range.is_some() {
                "passage"
            } else if context.is_some_and(|c| c.exercise_spec.is_some()) {
                "exercise"
            } else {
                "whole"
            },
            range,
            mode: s.mode.clone(),
            hands: context
                .map(|c| c.hands.clone())
                .unwrap_or_else(|| format!("{:?}", s.hands).to_lowercase()),
            bpm: s.effective_tempo_bpm,
            accuracy: s.summary.overall.accuracy().map(|v| v * 100.),
            judged: context.map(|c| c.judged_notes),
            target: context.map(|c| c.target_notes),
            restorable: context.is_some(),
            error_restart: context.is_some_and(|c| c.loop_restart.is_some()),
        }
    }
}
fn progress(
    history: &PracticeHistoryStore,
    cid: &str,
    now: u64,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Progress, String> {
    let sessions = history
        .song(cid)
        .map(|h| h.sessions.as_slice())
        .unwrap_or(&[]);
    let mut last = None;
    let mut whole = None;
    let mut whole_count = 0;
    for session in sessions {
        check()?;
        if session.recorded_at_unix_ms > now {
            continue;
        }
        if last
            .is_none_or(|s: &PracticeSession| s.recorded_at_unix_ms <= session.recorded_at_unix_ms)
        {
            last = Some(session);
        }
        if crate::song_learning_evidence::complete_whole_attempt(session, now) {
            whole_count += 1;
            if whole.is_none_or(|s: &PracticeSession| {
                s.recorded_at_unix_ms <= session.recorded_at_unix_ms
            }) {
                whole = Some(session);
            }
        }
    }
    let mut comparable_whole_count = 0;
    if let Some(anchor) = whole {
        for session in sessions {
            check()?;
            if crate::song_learning_evidence::complete_whole_attempt(session, now)
                && crate::practice_conditions::same_attempt_conditions(anchor, session)
            {
                comparable_whole_count += 1;
            }
        }
    }
    Ok(Progress {
        last: last.map(Attempt::from_session),
        whole: whole.map(Attempt::from_session),
        whole_count,
        comparable_whole_count,
    })
}
impl Player {
    pub(super) fn collection_checked(
        &self,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        check()?;
        let index = library_workspace::Workspace::load(&self.data)?;
        let now = crate::song_learning_evidence::now_ms();
        let mut songs = Vec::new();
        for s in self.history.recent_songs(usize::MAX) {
            check()?;
            let path = library::available_path(&index, &s.content_id, s.source_path.as_deref());
            let available = s.source_path.is_none() || path.is_some();
            let practice = progress(&self.history, &s.content_id, now, check)?;
            let last_practiced = practice.last.as_ref().map(|s| s.recorded_at);
            songs.push(json!({
                "contentId":s.content_id,"title":s.display_name,"storedPath":s.source_path,"path":path,
                "favorite":s.favorite,"queuePosition":s.queue_position,"lastUsed":s.last_used_unix_ms,
                "lastPracticed":last_practiced,"sessions":s.session_count,"accuracy":s.latest_accuracy,
                "available":available,"recommended":s.recommended_measures,"practice":practice,
                "review":s.review.map(|r|json!({"due":r.is_due,"dueAt":r.due_at_unix_ms,"sourceAt":r.source_at_unix_ms,
                    "sourceIsWholeSong":r.source_is_whole_song,"days":r.days_until_due,"streak":r.mastery_streak,
                    "intervalDays":r.interval_days,"reason":format!("{:?}",r.reason)})),
                "generated":self.history.setup(&s.content_id).is_some_and(|s|s.exercise_spec.is_some())
            }));
        }
        check()?;
        Ok(json!({"songs":songs}))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use panthesia_core::practice::{AttemptSummary, PracticeHands, PracticeSnapshot};
    #[test]
    fn library_distinguishes_recent_passages_and_full_condition_scoped_attempts() {
        let (player, cid, _) = crate::history_loading::tests::seeded(false, false);
        let mut history = PracticeHistoryStore::load(player.data.join("projection-history.ron"));
        let now = crate::song_learning_evidence::now_ms();
        let mut condition = player.history_context();
        condition.exercise_spec = None;
        condition.target_notes = 10;
        condition.judged_notes = 10;
        condition.passage_bounds = None;
        condition.hands = "both".into();
        condition.rounds = 0;
        let session = |id: &str, at: u64| {
            let mut s = PracticeSession::new(
                PracticeSessionKind::WholeSong,
                PracticeHands::Both,
                1.,
                AttemptSummary {
                    overall: PracticeSnapshot {
                        matched_notes: 10,
                        ..Default::default()
                    },
                    ..Default::default()
                },
            )
            .with_context(condition.clone())
            .with_mode("flow");
            s.id = Some(id.into());
            s.recorded_at_unix_ms = at;
            s.scope = Some("same-condition".into());
            s.effective_tempo_bpm = Some(120);
            s
        };
        let mut cases = vec![
            session("whole-a", now - 9000),
            session("whole-b", now - 8000),
        ];
        let mut right = session("whole-right", now - 7000);
        right.hands = PracticeHands::Right;
        right.context.as_mut().unwrap().hands = "right".into();
        cases.push(right);
        let mut old = session("old-whole", now - 91 * 86_400_000);
        old.effective_tempo_bpm = Some(180);
        cases.push(old);
        let mut partial = session("partial-whole", now - 5000);
        partial.context.as_mut().unwrap().judged_notes = 5;
        cases.push(partial);
        let mut wait = session("wait-whole", now - 4000);
        wait.mode = Some("wait".into());
        cases.push(wait);
        let mut failed = session("aborted-whole", now - 3000);
        failed.context.as_mut().unwrap().loop_restart = Some(1);
        cases.push(failed);
        let mut passage = session("latest-passage", now - 2000);
        passage.kind = PracticeSessionKind::Loop {
            start_measure: 3,
            end_measure: 4,
        };
        cases.push(passage);
        cases.push(session("future", now + 86_400_000));
        for s in cases {
            history.record_session(&cid, "练习投影", s).unwrap();
        }
        let result = progress(&history, &cid, now, &|| Ok(())).unwrap();
        assert_eq!(result.last.as_ref().unwrap().id, "latest-passage");
        assert_eq!(result.last.as_ref().unwrap().range, Some((3, 4)));
        assert_eq!(result.whole.as_ref().unwrap().id, "whole-right");
        assert_eq!(result.whole.as_ref().unwrap().hands, "right");
        assert_eq!(result.whole_count, 3);
        assert_eq!(result.comparable_whole_count, 1);
        let before = std::fs::read(history.path()).unwrap();
        assert!(progress(&history, &cid, now, &|| Err("cancelled".into())).is_err());
        assert_eq!(std::fs::read(history.path()).unwrap(), before);
    }
}
