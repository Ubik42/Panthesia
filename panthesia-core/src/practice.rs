use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
    time::Duration,
};

use panthesia_keyboard::KeyboardRange;
use serde::{Deserialize, Serialize};

pub type NoteId = u8;

#[derive(Debug, Clone, Copy, Default, Deserialize, Eq, PartialEq, Serialize)]
pub enum PracticeHands {
    Both,
    Right,
    Left,
    Custom,
    #[default]
    Unspecified,
}

#[derive(
    Debug, Clone, Copy, Default, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize,
)]
pub enum PracticePart {
    LeftHand,
    RightHand,
    #[default]
    Other,
}


#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct PracticeWindows {
    /// A user note may wait this long for its matching score note.
    pub early_match: Duration,
    /// A matched note inside this window is considered on time.
    pub on_time: Duration,
    /// In flow practice, an expected note becomes missed after this delay.
    pub late_match: Duration,
}

impl Default for PracticeWindows {
    fn default() -> Self {
        Self {
            early_match: Duration::from_millis(500),
            on_time: Duration::from_millis(80),
            late_match: Duration::from_millis(500),
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum TimingGrade {
    Early(Duration),
    OnTime,
    Late(Duration),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct MatchedNote {
    pub note: NoteId,
    pub timing: TimingGrade,
}


#[derive(Debug, Clone, Copy, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct PracticeSnapshot {
    pub matched_notes: usize,
    pub on_time_notes: usize,
    pub early_notes: usize,
    pub late_notes: usize,
    pub wrong_notes: usize,
    pub missed_notes: usize,
    pub required_notes: usize,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct PracticeBreakdown {
    pub target_notes: usize,
    pub matched_notes: usize,
    pub on_time_notes: usize,
    pub early_notes: usize,
    pub late_notes: usize,
    pub wrong_notes: usize,
    pub missed_notes: usize,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct MeasureSummary {
    pub measure: usize,
    pub breakdown: PracticeBreakdown,
    #[serde(default)]
    pub timing: TimingSummary,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct PartSummary {
    pub part: PracticePart,
    pub breakdown: PracticeBreakdown,
    #[serde(default)]
    pub timing: TimingSummary,
}

/// A judged score-note group with enough identity to revisit the same voice.
/// Wrong presses have no proven target and are deliberately not assigned here.
#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct MeasurePartSummary {
    pub measure: usize,
    pub part: PracticePart,
    pub track_id: usize,
    pub breakdown: PracticeBreakdown,
    #[serde(default)]
    pub timing: TimingSummary,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Serialize)]
pub struct AttemptSummary {
    pub overall: PracticeSnapshot,
    pub measures: Vec<MeasureSummary>,
    pub parts: Vec<PartSummary>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub measure_parts: Vec<MeasurePartSummary>,
    #[serde(default)]
    pub timing: TimingSummary,
    #[serde(default)]
    pub chords: ChordSummary,
    #[serde(default)]
    pub expression: ExpressionSummary,
    #[serde(default)]
    pub exercise_passes: Vec<ExercisePassSummary>,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct ExercisePassSummary {
    pub pass: usize,
    pub breakdown: PracticeBreakdown,
    #[serde(default)]
    pub timing: TimingSummary,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ChordSummary {
    pub eligible_chords: usize,
    pub complete_chords: usize,
    pub incomplete_chords: usize,
    pub median_attack_span_ms: Option<u32>,
    pub maximum_attack_span_ms: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct TimingSummary {
    pub matched_samples: usize,
    /// Negative values are early; positive values are late.
    pub median_offset_ms: Option<i32>,
    /// Median absolute deviation from the median offset.
    pub median_deviation_ms: Option<u32>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum TimingCalibrationStatus {
    InsufficientSamples { captured: usize, required: usize },
    Unstable { deviation_ms: u32, maximum_ms: u32 },
    Centered,
    AtLimit,
    Suggested(TimingCalibrationSuggestion),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct TimingCalibrationSuggestion {
    pub current_ms: i32,
    pub adjustment_ms: i32,
    pub suggested_ms: i32,
}

pub fn timing_calibration_status(
    timing: TimingSummary,
    current_ms: i32,
) -> TimingCalibrationStatus {
    const REQUIRED_SAMPLES: usize = 24;
    const MAX_DEVIATION_MS: u32 = 35;
    const BIAS_DEADBAND_MS: u32 = 10;
    const MAX_STEP_MS: i32 = 50;
    const LIMIT_MS: i32 = 250;

    if timing.matched_samples < REQUIRED_SAMPLES {
        return TimingCalibrationStatus::InsufficientSamples {
            captured: timing.matched_samples,
            required: REQUIRED_SAMPLES,
        };
    }
    let deviation_ms = timing.median_deviation_ms.unwrap_or(u32::MAX);
    if deviation_ms > MAX_DEVIATION_MS {
        return TimingCalibrationStatus::Unstable {
            deviation_ms,
            maximum_ms: MAX_DEVIATION_MS,
        };
    }
    let bias_ms = timing.median_offset_ms.unwrap_or(0);
    if bias_ms.unsigned_abs() < BIAS_DEADBAND_MS {
        return TimingCalibrationStatus::Centered;
    }

    let current_ms = current_ms.clamp(-LIMIT_MS, LIMIT_MS);
    let adjustment_ms = bias_ms.clamp(-MAX_STEP_MS, MAX_STEP_MS);
    let suggested_ms = (current_ms + adjustment_ms).clamp(-LIMIT_MS, LIMIT_MS);
    if suggested_ms == current_ms {
        TimingCalibrationStatus::AtLimit
    } else {
        TimingCalibrationStatus::Suggested(TimingCalibrationSuggestion {
            current_ms,
            adjustment_ms: suggested_ms - current_ms,
            suggested_ms,
        })
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct VelocitySummary {
    pub matched_samples: usize,
    pub mean_abs_difference: Option<u8>,
    pub played_min: Option<u8>,
    pub played_max: Option<u8>,
    pub target_min: Option<u8>,
    pub target_max: Option<u8>,
    #[serde(default)]
    pub contour_steps: usize,
    #[serde(default)]
    pub contour_aligned: usize,
    #[serde(default)]
    pub contour_flat: usize,
    #[serde(default)]
    pub contour_inverted: usize,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct PedalSummary {
    pub user_changes: usize,
    pub target_changes: usize,
    pub user_used: bool,
    pub target_present: bool,
    pub user_continuous_samples: usize,
    pub target_continuous_samples: usize,
    #[serde(default)]
    pub user_transitions: usize,
    #[serde(default)]
    pub target_transitions: usize,
    #[serde(default)]
    pub timing_samples: usize,
    #[serde(default)]
    pub median_offset_ms: Option<i32>,
    #[serde(default)]
    pub median_deviation_ms: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ExpressionSummary {
    pub velocity: VelocitySummary,
    pub pedal: PedalSummary,
    #[serde(default)]
    pub articulation: ArticulationSummary,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ArticulationSummary {
    pub matched_samples: usize,
    pub median_duration_ratio_percent: Option<u16>,
    pub shorter_count: usize,
    pub similar_count: usize,
    pub longer_count: usize,
}


/// Matches score note onsets with live keyboard input.
///
/// All timestamps come from the caller's monotonic session clock. This keeps
/// the matcher deterministic in tests and lets the clock continue while
/// wait-for-notes pauses the MIDI timeline.
#[derive(Debug)]
pub struct PracticeMatcher {
    user_keyboard_range: KeyboardRange,
    windows: PracticeWindows,

    /// Score onsets that wait for a key press, per pitch in arrival order.
    required_notes: HashMap<NoteId, VecDeque<Duration>>,
    /// Key presses that wait for a score onset, per pitch in arrival order.
    user_pressed_recently: HashMap<NoteId, VecDeque<Duration>>,

    snapshot: PracticeSnapshot,
    timing_offsets_ms: Arc<Vec<i32>>,
}

impl PracticeMatcher {
    pub fn new(user_keyboard_range: KeyboardRange) -> Self {
        Self::with_windows(user_keyboard_range, PracticeWindows::default())
    }

    pub fn with_windows(user_keyboard_range: KeyboardRange, windows: PracticeWindows) -> Self {
        Self {
            user_keyboard_range,
            windows,
            required_notes: HashMap::new(),
            user_pressed_recently: HashMap::new(),
            snapshot: PracticeSnapshot::default(),
            timing_offsets_ms: Arc::default(),
        }
    }

    pub fn tick(&mut self, now: Duration) {
        self.snapshot.wrong_notes +=
            drain_expired(&mut self.user_pressed_recently, now, self.windows.early_match);
    }

    /// Finalizes score notes that were not played in the allowed late window.
    ///
    /// Guided wait mode should not call this: its required notes intentionally
    /// remain pending until the pianist plays them.
    pub fn finalize_missed(&mut self, now: Duration) {
        let expired = drain_expired(&mut self.required_notes, now, self.windows.late_match);
        if expired == 0 { return; }
        self.snapshot.missed_notes += expired;
        self.update_required_count();
    }

    pub fn user_note(&mut self, now: Duration, note: NoteId, active: bool) -> Option<MatchedNote> {
        if !active || !self.user_keyboard_range.contains(note) {
            return None;
        }
        if let Some(required) = pop_front(&mut self.required_notes, note) {
            self.update_required_count();
            return Some(self.record_match(
                note,
                if now < required {TimingGrade::Early(required-now)} else {TimingGrade::Late(now-required)},
            ));
        }
        self.user_pressed_recently.entry(note).or_default().push_back(now);
        None
    }

    pub fn score_note(&mut self, now: Duration, note: NoteId, active: bool) -> Option<MatchedNote> {
        if !active || !self.user_keyboard_range.contains(note) {
            return None;
        }
        if let Some(pressed) = pop_front(&mut self.user_pressed_recently, note) {
            return Some(self.record_match(
                note,
                if pressed < now {TimingGrade::Early(now-pressed)} else {TimingGrade::Late(pressed-now)},
            ));
        }
        self.required_notes.entry(note).or_default().push_back(now);
        self.update_required_count();
        None
    }

    pub fn snapshot(&self) -> PracticeSnapshot {
        self.snapshot
    }

    pub fn finish(&mut self) {
        self.snapshot.wrong_notes += self.user_pressed_recently.drain().map(|(_, queue)| queue.len()).sum::<usize>();
        self.snapshot.missed_notes += self.required_notes.drain().map(|(_, queue)| queue.len()).sum::<usize>();
        self.snapshot.required_notes = 0;
    }

    /// Retain one exact attempt without copying its samples on the playback thread.
    pub fn report(&self) -> PracticeReport {
        PracticeReport {
            snapshot: self.snapshot,
            timing_offsets_ms: self.timing_offsets_ms.clone(),
        }
    }

    /// Signed onset offsets of every matched note, for latency calibration.
    pub fn timing(&self) -> TimingSummary { summarize_timing_offsets(&self.timing_offsets_ms) }

    /// Remaining attacks may still be matched inside the configured timing window.
    pub fn has_pending_judgements(&self) -> bool {
        !self.required_notes.is_empty() || !self.user_pressed_recently.is_empty()
    }

    pub fn settlement_window(&self) -> Duration {
        self.windows.early_match.max(self.windows.late_match)
    }

    pub fn are_required_notes_pressed(&self) -> bool {
        self.required_notes.is_empty()
    }

    pub fn required_note_pitches(&self) -> Vec<NoteId> {
        let mut notes: Vec<_> = self
            .required_notes
            .iter()
            .flat_map(|(&note, occurrences)| std::iter::repeat_n(note, occurrences.len()))
            .collect();
        notes.sort_unstable();
        notes
    }

    /// Clears transient matching state while retaining the session totals.
    pub fn clear_pending(&mut self) {
        self.required_notes.clear();
        self.user_pressed_recently.clear();
        self.snapshot.required_notes = 0;
    }

    pub fn reset(&mut self) {
        self.required_notes.clear();
        self.user_pressed_recently.clear();
        self.snapshot = PracticeSnapshot::default();
        self.timing_offsets_ms = Arc::default();
    }

    fn record_match(&mut self, note: NoteId, timing: TimingGrade) -> MatchedNote {
        let timing_offset_ms = match timing {
            TimingGrade::Early(delta) => -duration_millis_i32(delta),
            TimingGrade::OnTime => 0,
            TimingGrade::Late(delta) => duration_millis_i32(delta),
        };
        Arc::make_mut(&mut self.timing_offsets_ms).push(timing_offset_ms);
        let timing = match timing {
            TimingGrade::Early(delta) if delta <= self.windows.on_time => TimingGrade::OnTime,
            TimingGrade::Late(delta) if delta <= self.windows.on_time => TimingGrade::OnTime,
            timing => timing,
        };

        self.snapshot.matched_notes += 1;
        match timing {
            TimingGrade::Early(_) => self.snapshot.early_notes += 1,
            TimingGrade::OnTime => self.snapshot.on_time_notes += 1,
            TimingGrade::Late(_) => self.snapshot.late_notes += 1,
        }
        MatchedNote { note, timing }
    }

    fn update_required_count(&mut self) {
        self.snapshot.required_notes = self.required_notes.values().map(VecDeque::len).sum();
    }
}

/// An immutable attempt, released off the playback thread.
#[derive(Debug, Clone)]
pub struct PracticeReport {
    snapshot: PracticeSnapshot,
    timing_offsets_ms: Arc<Vec<i32>>,
}
impl PracticeReport {
    pub fn snapshot(&self) -> PracticeSnapshot { self.snapshot }
    pub fn timing(&self) -> TimingSummary { summarize_timing_offsets(&self.timing_offsets_ms) }
}

fn duration_millis_i32(duration: Duration) -> i32 {
    duration.as_millis().min(i32::MAX as u128) as i32
}

fn summarize_timing_offsets(offsets: &[i32]) -> TimingSummary {
    let mut ordered = offsets.to_vec();
    ordered.sort_unstable();
    let median_offset_ms = median_i32(&ordered);
    let median_deviation_ms = median_offset_ms.and_then(|median| {
        let mut deviations = ordered
            .iter()
            .map(|offset| offset.abs_diff(median))
            .collect::<Vec<_>>();
        deviations.sort_unstable();
        median_u32(&deviations)
    });
    TimingSummary {
        matched_samples: ordered.len(),
        median_offset_ms,
        median_deviation_ms,
    }
}

fn median_i32(values: &[i32]) -> Option<i32> {
    let middle = values.len() / 2;
    match values.len() {
        0 => None,
        len if len.is_multiple_of(2) => {
            Some(((i64::from(values[middle - 1]) + i64::from(values[middle])) / 2) as i32)
        }
        _ => Some(values[middle]),
    }
}

fn median_u32(values: &[u32]) -> Option<u32> {
    let middle = values.len() / 2;
    match values.len() {
        0 => None,
        len if len.is_multiple_of(2) => {
            Some((u64::from(values[middle - 1]) + u64::from(values[middle])).div_ceil(2) as u32)
        }
        _ => Some(values[middle]),
    }
}

fn pop_front(notes: &mut HashMap<NoteId, VecDeque<Duration>>, note: NoteId) -> Option<Duration> {
    let queue = notes.get_mut(&note)?;
    let press = queue.pop_front();
    if queue.is_empty() {
        notes.remove(&note);
    }
    press
}

/// Removes every occurrence older than `window` and returns how many were removed.
fn drain_expired(
    notes: &mut HashMap<NoteId, VecDeque<Duration>>,
    now: Duration,
    window: Duration,
) -> usize {
    let mut expired = 0;
    notes.retain(|_, queue| {
        while queue
            .front()
            .is_some_and(|&timestamp| now.saturating_sub(timestamp) > window)
        {
            queue.pop_front();
            expired += 1;
        }
        !queue.is_empty()
    });
    expired
}

#[cfg(test)]
mod tests {
    use super::*;

    fn matcher() -> PracticeMatcher {
        PracticeMatcher::with_windows(
            KeyboardRange::new(21..=108),
            PracticeWindows {
                early_match: Duration::from_millis(500),
                on_time: Duration::from_millis(80),
                late_match: Duration::from_millis(500),
            },
        )
    }


    #[test]
    fn matches_early_on_time_and_late_notes_deterministically() {
        let mut matcher = matcher();

        matcher.user_note(Duration::from_millis(950), 60, true);
        assert_eq!(
            matcher.score_note(Duration::from_millis(1_000), 60, true),
            Some(MatchedNote {
                note: 60,
                timing: TimingGrade::OnTime,
            })
        );

        matcher.user_note(Duration::from_millis(1_200), 62, true);
        assert_eq!(
            matcher.score_note(Duration::from_millis(1_400), 62, true),
            Some(MatchedNote {
                note: 62,
                timing: TimingGrade::Early(Duration::from_millis(200)),
            })
        );

        matcher.score_note(Duration::from_millis(2_000), 64, true);
        assert_eq!(
            matcher.user_note(Duration::from_millis(2_220), 64, true),
            Some(MatchedNote {
                note: 64,
                timing: TimingGrade::Late(Duration::from_millis(220)),
            })
        );

        assert_eq!(
            matcher.snapshot(),
            PracticeSnapshot {
                matched_notes: 3,
                on_time_notes: 1,
                early_notes: 1,
                late_notes: 1,
                wrong_notes: 0,
                missed_notes: 0,
                required_notes: 0,
            }
        );
        assert_eq!(
            matcher.timing(),
            TimingSummary {
                matched_samples: 3,
                median_offset_ms: Some(-50),
                median_deviation_ms: Some(150),
            }
        );
    }

    #[test]
    fn expires_unmatched_user_notes_as_wrong() {
        let mut matcher = matcher();
        matcher.user_note(Duration::from_secs(1), 61, true);

        matcher.tick(Duration::from_millis(1_500));
        assert_eq!(matcher.snapshot().wrong_notes, 0);

        matcher.tick(Duration::from_millis(1_501));
        assert_eq!(matcher.snapshot().wrong_notes, 1);
    }

    #[test]
    fn tracks_required_chord_notes_without_order_penalty() {
        let mut matcher = matcher();
        let target_time = Duration::from_secs(2);

        matcher.score_note(target_time, 60, true);
        matcher.score_note(target_time, 64, true);
        matcher.score_note(target_time, 67, true);
        assert_eq!(matcher.snapshot().required_notes, 3);
        assert_eq!(matcher.required_note_pitches(), vec![60, 64, 67]);
        assert!(!matcher.are_required_notes_pressed());

        matcher.user_note(Duration::from_millis(2_100), 67, true);
        matcher.user_note(Duration::from_millis(2_110), 60, true);
        matcher.user_note(Duration::from_millis(2_120), 64, true);

        assert!(matcher.are_required_notes_pressed());
        assert_eq!(matcher.snapshot().matched_notes, 3);
    }

    #[test]
    fn ignores_notes_outside_the_configured_keyboard_range() {
        let mut matcher = PracticeMatcher::new(KeyboardRange::new(48..=72));

        matcher.user_note(Duration::ZERO, 36, true);
        matcher.score_note(Duration::ZERO, 84, true);
        matcher.tick(Duration::from_secs(1));

        assert_eq!(matcher.snapshot(), PracticeSnapshot::default());
    }

    #[test]
    fn repeated_same_pitch_presses_match_distinct_score_occurrences() {
        let mut matcher = matcher();
        matcher.user_note(Duration::from_millis(100), 60, true);
        matcher.user_note(Duration::from_millis(200), 60, true);

        assert_eq!(
            matcher.score_note(Duration::from_millis(250), 60, true),
            Some(MatchedNote {
                note: 60,
                timing: TimingGrade::Early(Duration::from_millis(150)),
            })
        );
        assert_eq!(
            matcher.score_note(Duration::from_millis(260), 60, true),
            Some(MatchedNote {
                note: 60,
                timing: TimingGrade::OnTime,
            })
        );
        assert_eq!(matcher.snapshot().matched_notes, 2);
        assert_eq!(matcher.snapshot().wrong_notes, 0);
    }

    #[test]
    fn overlapping_same_pitch_targets_keep_separate_occurrences() {
        let mut matcher = matcher();
        matcher.score_note(Duration::from_millis(100), 60, true);
        matcher.score_note(Duration::from_millis(200), 60, true);

        assert_eq!(matcher.snapshot().required_notes, 2);
        matcher.user_note(Duration::from_millis(300), 60, true);
        assert_eq!(matcher.snapshot().required_notes, 1);
        matcher.user_note(Duration::from_millis(400), 60, true);
        assert_eq!(matcher.snapshot().required_notes, 0);
    }

    #[test]
    fn flow_practice_finalizes_late_targets_as_missed() {
        let mut matcher = matcher();
        matcher.score_note(Duration::from_secs(1), 60, true);
        matcher.score_note(Duration::from_millis(1_200), 64, true);

        matcher.finalize_missed(Duration::from_millis(1_500));
        assert_eq!(matcher.snapshot().missed_notes, 0);
        assert_eq!(matcher.snapshot().required_notes, 2);

        matcher.finalize_missed(Duration::from_millis(1_501));
        assert_eq!(matcher.snapshot().missed_notes, 1);
        assert_eq!(matcher.snapshot().required_notes, 1);
    }

    #[test]
    fn timing_profile_uses_signed_median_and_robust_deviation() {
        let summary = summarize_timing_offsets(&[-40, -20, -10, 0, 10, 20, 40, 100]);

        assert_eq!(summary.matched_samples, 8);
        assert_eq!(summary.median_offset_ms, Some(5));
        assert_eq!(summary.median_deviation_ms, Some(20));
        assert_eq!(summarize_timing_offsets(&[]), TimingSummary::default());
    }

    #[test]
    fn calibration_requires_enough_stable_and_meaningfully_biased_evidence() {
        let timing = |samples, offset, deviation| TimingSummary {
            matched_samples: samples,
            median_offset_ms: Some(offset),
            median_deviation_ms: Some(deviation),
        };

        assert_eq!(
            timing_calibration_status(timing(23, 40, 10), 0),
            TimingCalibrationStatus::InsufficientSamples {
                captured: 23,
                required: 24,
            }
        );
        assert_eq!(
            timing_calibration_status(timing(24, 40, 36), 0),
            TimingCalibrationStatus::Unstable {
                deviation_ms: 36,
                maximum_ms: 35,
            }
        );
        assert_eq!(
            timing_calibration_status(timing(24, 9, 5), 0),
            TimingCalibrationStatus::Centered
        );
    }

    #[test]
    fn calibration_caps_each_confirmed_step_and_respects_global_limits() {
        let timing = |offset| TimingSummary {
            matched_samples: 24,
            median_offset_ms: Some(offset),
            median_deviation_ms: Some(10),
        };

        assert_eq!(
            timing_calibration_status(timing(90), 20),
            TimingCalibrationStatus::Suggested(TimingCalibrationSuggestion {
                current_ms: 20,
                adjustment_ms: 50,
                suggested_ms: 70,
            })
        );
        assert_eq!(
            timing_calibration_status(timing(-30), 10),
            TimingCalibrationStatus::Suggested(TimingCalibrationSuggestion {
                current_ms: 10,
                adjustment_ms: -30,
                suggested_ms: -20,
            })
        );
        assert_eq!(
            timing_calibration_status(timing(20), 250),
            TimingCalibrationStatus::AtLimit
        );
    }


    #[test]
    fn expression_saved_before_articulation_remains_readable() {
        let legacy = r#"(
            velocity: (
                matched_samples: 0,
                mean_abs_difference: None,
                played_min: None,
                played_max: None,
                target_min: None,
                target_max: None,
            ),
            pedal: (
                user_changes: 0,
                target_changes: 0,
                user_used: false,
                target_present: false,
                user_continuous_samples: 0,
                target_continuous_samples: 0,
            ),
        )"#;

        let expression: ExpressionSummary = ron::from_str(legacy).unwrap();
        assert_eq!(expression.articulation, ArticulationSummary::default());
        assert_eq!(expression.velocity.contour_steps, 0);
        assert_eq!(expression.pedal.timing_samples, 0);
        assert_eq!(expression.pedal.user_transitions, 0);
    }

    #[test]
    fn part_summaries_saved_before_timing_profiles_remain_readable() {
        let legacy = r#"(
            part: RightHand,
            breakdown: (
                target_notes: 1,
                matched_notes: 1,
                on_time_notes: 1,
                early_notes: 0,
                late_notes: 0,
                wrong_notes: 0,
                missed_notes: 0,
            ),
        )"#;

        let part: PartSummary = ron::from_str(legacy).unwrap();
        assert_eq!(part.timing, TimingSummary::default());
    }

    #[test]
    fn measure_summaries_saved_before_timing_profiles_remain_readable() {
        let legacy = r#"(
            measure: 3,
            breakdown: (
                target_notes: 1,
                matched_notes: 1,
                on_time_notes: 1,
                early_notes: 0,
                late_notes: 0,
                wrong_notes: 0,
                missed_notes: 0,
            ),
        )"#;

        let measure: MeasureSummary = ron::from_str(legacy).unwrap();
        assert_eq!(measure.timing, TimingSummary::default());
    }
}
