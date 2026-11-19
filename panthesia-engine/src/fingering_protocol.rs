//! Concrete response contracts shared with the generated desktop/browser protocol.
use crate::fingerings::{PlanRequest, Position, Proposal};
use panthesia_core::fingering::{CrossHandReviewKind, FingeringReviewKind};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreArticulations {
    pub paired: bool,
    pub slur_links: usize,
    pub staccato_notes: usize,
}
impl ScoreArticulations {
    pub fn for_prepared(p: &crate::fingerings::Prepared) -> Self {
        Self {
            paired: p.score_fingerprint.is_some(),
            slur_links: p
                .expression
                .iter()
                .filter(|mark| mark.slur_from.is_some())
                .count(),
            staccato_notes: p.expression.iter().filter(|mark| mark.staccato).count(),
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionReview {
    pub context_index: usize,
    pub index: usize,
    pub from_index: usize,
    pub track: usize,
    pub from_track: usize,
    pub measure: usize,
    pub from_measure: usize,
    pub pitch: u8,
    pub from_pitch: u8,
    pub kind: FingeringReviewKind,
    pub semitones: u8,
    pub comfortable_semitones: i32,
    pub interval_ms: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossHandPlanReview {
    pub context_index: usize,
    pub track: usize,
    pub index: usize,
    pub measure: usize,
    pub pitch: u8,
    pub finger: u8,
    pub opposite_track: usize,
    pub opposite_index: usize,
    pub opposite_measure: usize,
    pub opposite_pitch: u8,
    pub opposite_finger: u8,
    pub opposite_saved: bool,
    pub kind: CrossHandReviewKind,
    pub overlap_ms: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FingeringPlan {
    pub rank: usize,
    pub cost: i64,
    pub primary_cost: i64,
    pub opposite_cost: i64,
    pub joint_cost: i64,
    pub proposals: Vec<Proposal>,
    pub context_fingers: Vec<u8>,
    pub opposite_context_fingers: Vec<Option<u8>>,
    pub review: Vec<MotionReview>,
    pub cross_hand_review: Vec<CrossHandPlanReview>,
    pub practice_rate: f64,
    pub crossings: usize,
    pub shifts: usize,
    pub wide: usize,
    pub changed: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanResult {
    pub target_tracks: Vec<usize>,
    pub context_tracks: Vec<usize>,
    pub content_id: String,
    pub fingerprint: String,
    pub request: PlanRequest,
    pub plans: Vec<FingeringPlan>,
    pub context: Vec<Position>,
    pub opposite_context: Vec<Position>,
    pub joint_status: String,
    pub score_articulations: ScoreArticulations,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeldSubstitution {
    pub track: usize,
    pub index: usize,
    pub pitch: u8,
    pub measure: usize,
    pub before_track: usize,
    pub before_index: usize,
    pub before_measure: usize,
    pub at: f64,
    pub from: u8,
    pub to: u8,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeldPlan {
    pub rank: usize,
    pub cost: i64,
    pub proposals: Vec<Proposal>,
    pub substitutions: Vec<HeldSubstitution>,
    pub context_fingers: Vec<u8>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeldPlanResult {
    pub content_id: String,
    pub request: PlanRequest,
    pub fingerprint: String,
    pub context: Vec<Position>,
    pub plans: Vec<HeldPlan>,
    pub read_only: bool,
    pub score_articulations: ScoreArticulations,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkedNeighbor {
    pub track: usize,
    pub index: usize,
    pub measure: usize,
    pub pitch: u8,
    pub finger: u8,
    pub context_index: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageNote {
    pub track: usize,
    pub index: usize,
    pub measure: usize,
    pub pitch: u8,
    pub context_index: usize,
    pub target: bool,
    pub before: Option<MarkedNeighbor>,
    pub after: Option<MarkedNeighbor>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceConflict {
    pub context_index: usize,
    pub from_context_index: usize,
    pub index: usize,
    pub from_index: usize,
    pub track: usize,
    pub from_track: usize,
    pub measure: usize,
    pub from_measure: usize,
    pub pitch: u8,
    pub from_pitch: u8,
    pub finger: u8,
    pub from_finger: u8,
    pub reason: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceMotionReview {
    pub context_index: usize,
    pub track: usize,
    pub from_track: usize,
    pub measure: usize,
    pub from_measure: usize,
    pub pitch: u8,
    pub from_pitch: u8,
    pub kind: FingeringReviewKind,
    pub semitones: u8,
    pub comfortable_semitones: i32,
    pub interval_ms: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpressionReview {
    pub context_index: usize,
    pub from_context_index: usize,
    pub track: usize,
    pub index: usize,
    pub measure: usize,
    pub pitch: u8,
    pub finger: u8,
    pub from_track: usize,
    pub from_index: usize,
    pub from_measure: usize,
    pub from_pitch: u8,
    pub from_finger: u8,
    pub reason: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackAcceptance {
    pub track: usize,
    pub total: usize,
    pub selected: usize,
    pub retained: usize,
    pub unmarked: usize,
    pub changed: usize,
    #[serde(rename = "new")]
    pub new_marks: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceReview {
    pub context_unmarked: usize,
    pub valid: bool,
    pub marked_subset_valid: bool,
    pub full_passage_validated: bool,
    pub coverage: Vec<CoverageNote>,
    pub coverage_total: usize,
    pub coverage_truncated: bool,
    pub conflicts: Vec<AcceptanceConflict>,
    pub truncated: bool,
    pub review: Vec<AcceptanceMotionReview>,
    pub expression_review: Vec<ExpressionReview>,
    pub expression_review_truncated: bool,
    pub cross_hand_review: Vec<CrossHandPlanReview>,
    pub tracks: Vec<TrackAcceptance>,
    pub context_fingers: Vec<Option<u8>>,
    pub review_truncated: bool,
    pub selected: usize,
    pub retained: usize,
    pub unmarked: usize,
    pub total: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedKey {
    pub measure: usize,
    pub pitch: u8,
    pub left_track: usize,
    pub right_track: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairReview {
    pub proof: String,
    pub reviews: Vec<AcceptanceReview>,
    pub valid: bool,
    pub needs_ack: bool,
    pub unassigned: usize,
    pub shared: Vec<SharedKey>,
    pub selected: usize,
    pub interactions: crate::finger_pair_interactions::Analysis,
}

#[derive(Serialize)]
pub struct PairSaved {
    pub saved: bool,
    pub hands: usize,
}
