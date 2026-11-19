//! Typed review results shared by native preparation and the interface generator.
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryScoreTarget {
    pub content_id: String,
    pub score_revision: u64,
    pub history_id: String,
    pub reference: usize,
    pub track: usize,
    pub index: usize,
    pub pitch: u8,
    pub measure: usize,
    pub kind: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryReviewNote {
    pub reference: usize,
    pub track: usize,
    pub index: Option<usize>,
    pub pitch: u8,
    pub measure: usize,
    pub song_time: f64,
    pub at: f64,
    pub end: f64,
    pub kind: String,
    pub timing_kind: Option<String>,
    pub velocity_difference: Option<u64>,
    pub velocity_limit: Option<u64>,
    pub offset_ms: Option<i32>,
    pub reference_velocity: u8,
    pub actual_velocity: Option<u8>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryScoreReview {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<crate::history_source::HistorySource>,
    pub content_id: String,
    pub history_id: String,
    pub score_revision: u64,
    pub duration: f64,
    pub recorded_at: u64,
    pub title: String,
    pub truncated: bool,
    pub exact: bool,
    pub wrong_notes: Option<usize>,
    pub notes: Vec<HistoryReviewNote>,
    pub measures: Option<Vec<crate::performance_archive::PerformanceMeasureSpan>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPaperTarget {
    pub content_id: String,
    pub history_id: String,
    pub reference: usize,
    pub measure: usize,
    pub track: usize,
    pub pitch: u8,
    pub song_time: f64,
    pub start_measure: usize,
    pub end_measure: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_anchor: Option<crate::score_attachments::NoteAnchor>,
}
