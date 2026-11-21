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
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
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
    }
    Ok(Progress {
        last: last.map(Attempt::from_session),
    })
}
impl Player {
    pub(super) fn collection_checked(
        &self,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        check()?;
        let index = library_workspace::Workspace::load(&self.data)?;
        let now = now_ms();
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
