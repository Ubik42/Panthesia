//! Stable archive headers shared by list, detail and comparison projections.
use panthesia_core::{
    practice::{PracticeHands, PracticeSnapshot},
    practice_history::{PracticeAnnotation, PracticeSession, PracticeSessionKind},
};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct HistoryCoverage {
    pub target: usize,
    pub judged: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryListEntry {
    pub id: String,
    pub content_id: String,
    pub title: String,
    pub path: Option<PathBuf>,
    pub recorded_at: u64,
    pub playing_ms: Option<u64>,
    pub speed: f32,
    pub hands: PracticeHands,
    pub annotation: Option<PracticeAnnotation>,
    pub mode: Option<String>,
    pub scope: Option<String>,
    pub range: Option<(usize, usize)>,
    #[serde(rename = "loop")]
    pub is_loop: bool,
    pub exact_passage: bool,
    pub score: PracticeSnapshot,
    pub tempo: Option<u16>,
    pub restorable: bool,
    pub coverage: Option<HistoryCoverage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub entries: Vec<HistoryListEntry>,
    pub total: usize,
    pub offset: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
}

impl HistoryListEntry {
    pub(super) fn new(
        content_id: &str,
        title: &str,
        path: Option<&PathBuf>,
        session: &PracticeSession,
    ) -> Self {
        let range = match session.kind {
            PracticeSessionKind::WholeSong => None,
            PracticeSessionKind::Loop {
                start_measure,
                end_measure,
            } => Some((start_measure, end_measure)),
        };
        Self {
            id: session.stable_id(),
            content_id: content_id.into(),
            title: title.into(),
            path: session
                .context
                .as_ref()
                .and_then(|context| context.source_path.as_ref())
                .or(path)
                .cloned(),
            recorded_at: session.recorded_at_unix_ms,
            playing_ms: session.playing_ms,
            speed: session.speed,
            hands: session.hands,
            annotation: session.annotation.clone(),
            mode: session.mode.clone(),
            scope: session.scope.clone(),
            range,
            is_loop: range.is_some(),
            exact_passage: session
                .context
                .as_ref()
                .and_then(|context| context.passage_bounds)
                .is_some(),
            score: session.summary.overall,
            tempo: session.effective_tempo_bpm,
            restorable: session.context.is_some(),
            coverage: session.context.as_ref().map(|context| HistoryCoverage {
                target: context.target_notes,
                judged: context.judged_notes,
            }),
        }
    }
}
