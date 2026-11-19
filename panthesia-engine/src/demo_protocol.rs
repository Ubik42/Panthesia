//! Playback observation contracts; omitted idle fields preserve the existing wire shape.
use serde::Serialize;
#[derive(Serialize)]
pub enum DemoKind {
    #[serde(rename = "held")]
    Held,
}
#[derive(Serialize)]
pub struct DemoLoop {
    pub start: f64,
    pub end: f64,
}
#[derive(Serialize)]
pub struct DemoFingerNote {
    pub track: usize,
    pub index: usize,
    pub pitch: u8,
    pub part: String,
    pub finger: Option<u8>,
    pub held: bool,
    pub changed: bool,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoState {
    pub id: Option<String>,
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<bool>,
    #[serde(rename = "loop", skip_serializing_if = "Option::is_none")]
    pub replay_loop: Option<Option<DemoLoop>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_rounds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<DemoKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finger_notes: Option<Vec<DemoFingerNote>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actions_completed: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actions_total: Option<usize>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeldContext {
    pub baseline: String,
    pub content_id: String,
    pub source_track: usize,
    pub source_index: usize,
    pub start: f64,
    pub end: f64,
    pub notes: Vec<HeldNote>,
    pub actions: Vec<HeldChange>,
}
#[derive(Clone, Serialize)]
pub struct HeldNote {
    pub track: usize,
    pub index: usize,
    pub pitch: u8,
    pub part: String,
    pub onset: f64,
    pub end: f64,
    pub finger: Option<u8>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeldChange {
    pub track: usize,
    pub index: usize,
    pub at: f64,
    pub at_tick: u64,
    pub from: u8,
    pub to: u8,
}
