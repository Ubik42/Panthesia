use super::*;
use panthesia_core::practice_history::PracticeSession;

/// A score trend is evidence only when both attempts describe the same played task.
/// Older sessions without an immutable context remain readable, but cannot prove this.
pub(super) fn same_attempt_conditions(a: &PracticeSession, b: &PracticeSession) -> bool {
    if a.scope.as_deref().is_none_or(str::is_empty)
        || a.mode.as_deref().is_none_or(str::is_empty)
        || a.scope != b.scope
        || a.mode != b.mode
        || a.hands != b.hands
        || a.kind != b.kind
        || (a.speed - b.speed).abs() >= 0.0001
        || !a.speed.is_finite()
        || !b.speed.is_finite()
        || a.effective_tempo_bpm != b.effective_tempo_bpm
    {
        return false;
    }
    let (Some(a), Some(b)) = (&a.context, &b.context) else {
        return false;
    };
    a.loop_restart.is_none() && b.loop_restart.is_none()
        && !a.grid.is_empty()
        && !b.grid.is_empty()
        && !a.hands.is_empty()
        && !b.hands.is_empty()
        && a.target_notes > 0
        && b.target_notes > 0
        && a.judged_notes > 0
        && b.judged_notes > 0
        && a.grid == b.grid
        && a.passage_bounds == b.passage_bounds
        && a.note_playback == b.note_playback
        && a.tracks == b.tracks
        && a.parts == b.parts
        && a.hands == b.hands
        && a.exercise_spec == b.exercise_spec
        && a.target_notes == b.target_notes
        && a.judged_notes == b.judged_notes
        && a.count_in == b.count_in
        && a.metronome == b.metronome
        && a.latency == b.latency
        // Before separate pedal calibration existed, pedal timing used input latency.
        && a.pedal_latency_ms.unwrap_or(a.latency)
            == b.pedal_latency_ms.unwrap_or(b.latency)
        && a.rounds == b.rounds
        && a.adaptive == b.adaptive
        && a.expression.as_ref().or_else(||a.routine.as_ref().and_then(|r| r.expression.as_ref()))
            == b.expression.as_ref().or_else(||b.routine.as_ref().and_then(|r| r.expression.as_ref()))
}

/// Compare a reviewed old single-left-track attempt with a current attempt.
/// The caller must first prove both stored scope hashes against their actual
/// MIDI layouts and hold a user-approved alias. This helper changes copies only.
pub(super) fn same_reviewed_left_layout(old: &PracticeSession, current: &PracticeSession) -> bool {
    let (Some(old_context), Some(current_context)) = (&old.context, &current.context) else {
        return false;
    };
    if old_context.loop_restart.is_some() || current_context.loop_restart.is_some(){return false;}
    let old_tracks: Vec<_> = old_context
        .tracks
        .iter()
        .filter(|t| t.track_id == 1)
        .collect();
    let current_tracks: Vec<_> = current_context
        .tracks
        .iter()
        .filter(|t| t.track_id == 2)
        .collect();
    if old_tracks.len() != 1
        || current_tracks.len() != 1
        || old_context.tracks.iter().any(|t| t.track_id == 2)
        || old_context.parts.keys().any(|id| *id != 0 && *id != 1)
        || current_context.parts.get(&2).is_none()
        || old_context.parts.get(&1) != current_context.parts.get(&2)
    {
        return false;
    }
    let mut old_copy = old.clone();
    let mut current_copy = current.clone();
    old_copy.scope = current.scope.clone();
    let old_ctx = old_copy.context.as_mut().unwrap();
    old_ctx
        .tracks
        .retain(|t| t.track_id == 0 || t.track_id == 1);
    for track in &mut old_ctx.tracks {
        if track.track_id == 1 {
            track.track_id = 2;
        }
    }
    for rule in &mut old_ctx.note_playback { if rule.track_id == 1 { rule.track_id = 2; } }
    old_ctx.parts = old_context
        .parts
        .iter()
        .map(|(id, part)| (if *id == 1 { 2 } else { *id }, *part))
        .collect();
    let current_ctx = current_copy.context.as_mut().unwrap();
    current_ctx
        .tracks
        .retain(|t| t.track_id == 0 || t.track_id == 2);
    current_ctx
        .parts
        .retain(|track, _| *track == 0 || *track == 2);
    same_attempt_conditions(&old_copy, &current_copy)
}

/// Explain why an older attempt cannot be used as evidence for this attempt.
/// Keep this list aligned with `same_attempt_conditions`; both records belong
/// to the same song when the caller uses it.
pub(super) fn attempt_difference_reasons(
    current: &PracticeSession,
    older: &PracticeSession,
) -> Vec<&'static str> {
    let mut reasons = Vec::new();
    if current.scope.as_deref().is_none_or(str::is_empty)
        || older.scope.as_deref().is_none_or(str::is_empty)
    {
        reasons.push("练习音符范围缺少完整记录");
    } else if current.scope != older.scope {
        reasons.push("练习音符范围不同");
    }
    if current.mode.as_deref().is_none_or(str::is_empty)
        || older.mode.as_deref().is_none_or(str::is_empty)
    {
        reasons.push("练习模式缺少完整记录");
    } else if current.mode != older.mode {
        reasons.push("练习模式不同");
    }
    if current.hands != older.hands {
        reasons.push("练习手别不同");
    }
    if current.kind != older.kind {
        reasons.push("整曲或练习小节范围不同");
    }
    if !current.speed.is_finite() || !older.speed.is_finite() {
        reasons.push("练习速度记录无效");
    } else if (current.speed - older.speed).abs() >= 0.0001 {
        reasons.push("练习速度不同");
    }
    if current.effective_tempo_bpm != older.effective_tempo_bpm {
        reasons.push("实际节拍速度不同");
    }
    let (Some(a), Some(b)) = (&current.context, &older.context) else {
        reasons.push("旧记录缺少完整演奏条件");
        return reasons;
    };
    if a.grid.is_empty() || b.grid.is_empty() {
        reasons.push("音乐小节网格缺少记录");
    } else if a.grid != b.grid {
        reasons.push("音乐小节网格不同");
    }
    if matches!(current.kind, PracticeSessionKind::Loop { .. }) && current.kind == older.kind
        && a.passage_bounds != b.passage_bounds
    {
        if a.passage_bounds.is_none() || b.passage_bounds.is_none() {
            reasons.push("有一轮缺少原选段起止拍位");
        } else {
            reasons.push("原选段起止拍位不同");
        }
    }
    if a.hands.is_empty() || b.hands.is_empty() {
        reasons.push("逐音分手条件缺少记录");
    } else if a.hands != b.hands {
        reasons.push("逐音分手条件不同");
    }
    if a.target_notes == 0 || b.target_notes == 0 || a.judged_notes == 0 || b.judged_notes == 0 {
        reasons.push("目标音或判定音缺少有效数量");
    } else if a.target_notes != b.target_notes || a.judged_notes != b.judged_notes {
        reasons.push("目标音或实际判定音数量不同");
    }
    if a.note_playback != b.note_playback { reasons.push("逐音演奏与伴奏规则不同"); }
    if a.tracks != b.tracks {
        reasons.push("音轨演奏与伴奏设置不同");
    }
    if a.parts != b.parts {
        reasons.push("音轨手别设置不同");
    }
    if a.exercise_spec != b.exercise_spec {
        reasons.push("技术练习内容不同");
    }
    if a.count_in != b.count_in {
        reasons.push("预备拍设置不同");
    }
    if a.metronome != b.metronome {
        reasons.push("节拍器设置不同");
    }
    if a.latency != b.latency {
        reasons.push("按键延迟校准不同");
    }
    if a.pedal_latency_ms.unwrap_or(a.latency) != b.pedal_latency_ms.unwrap_or(b.latency) {
        reasons.push("踏板延迟校准不同");
    }
    if a.rounds != b.rounds {
        reasons.push("练习轮数不同");
    }
    if a.adaptive != b.adaptive {
        reasons.push("自适应速度设置不同");
    }
    if a.expression.as_ref().or_else(||a.routine.as_ref().and_then(|r| r.expression.as_ref()))
        != b.expression.as_ref().or_else(||b.routine.as_ref().and_then(|r| r.expression.as_ref()))
    {
        reasons.push("力度或踏板专项目标不同");
    }
    reasons
}
pub(super) fn grid(file: &MidiFile) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for m in &file.musical_time.measures {
        for value in [
            m.start_tick,
            m.end_tick,
            u64::from(m.numerator),
            u64::from(m.denominator),
        ] {
            for b in value.to_le_bytes() {
                hash ^= u64::from(b);
                hash = hash.wrapping_mul(0x100000001b3);
            }
        }
    }
    format!("grid-v1-{hash:016x}")
}
pub(super) fn scope(
    file: Option<&MidiFile>,
    notes: &[PracticeNote],
    config: &SongConfig,
    assigned: &HashMap<(usize, usize), PracticePart>,
    wanted: &str,
) -> String {
    match scope_checked(file, notes, config, assigned, wanted, || Ok::<(), std::convert::Infallible>(())) {
        Ok(scope) => scope,
        Err(never) => match never {},
    }
}
pub(super) fn scope_checked<E>(
    file: Option<&MidiFile>, notes: &[PracticeNote], config: &SongConfig,
    assigned: &HashMap<(usize, usize), PracticePart>, wanted: &str,
    mut check: impl FnMut() -> Result<(), E>,
) -> Result<String, E> {
    check()?;
    let mut hash = 0xcbf29ce484222325u64;
    let mut feed = |value: u64| {
        for b in value.to_le_bytes() {
            hash ^= u64::from(b);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    };
    if let Some(file) = file {
        for (index, m) in file.musical_time.measures.iter().enumerate() {
            if index % 256 == 0 { check()?; }
            feed(m.start_tick);
            feed(m.end_tick);
            feed(u64::from(m.numerator));
            feed(u64::from(m.denominator));
        }
    }
    if !config.note_players.is_empty() {
        feed(0x6e6f74652d726f75); // Domain separator; legacy scopes remain unchanged.
        for (index, (&(track, note), mode)) in config.note_players.iter().enumerate() {
            if index % 256 == 0 { check()?; }
            feed(track as u64); feed(note as u64);
            feed(match mode { PlayerConfig::Human => 1, PlayerConfig::Auto => 2, PlayerConfig::Mute => 3 });
        }
    }
    let selection = hands::Selection::new(config, assigned, wanted);
    for (index, n) in notes.iter().enumerate() {
        if index % 256 == 0 { check()?; }
        if let Some(part) = selection.selected_part(n.track_id, n.index) {
            feed(n.track_id as u64);
            feed(n.index as u64);
            feed(match part {
                PracticePart::LeftHand => 1,
                PracticePart::RightHand => 2,
                _ => 0,
            });
        }
    }
    check()?;
    Ok(format!("practice-v1-{hash:016x}"))
}

impl Player {
    pub(super) fn practice_scope_checked<E>(
        &self, mut check: impl FnMut() -> Result<(), E>,
    ) -> Result<String, E> {
        check()?;
        if let Some(cached) = self.projections.scope.borrow().as_ref()
            .filter(|cached| cached.matches(self))
        {
            return Ok(cached.value.clone());
        }
        let value = scope_checked(
            self.file.as_deref(), &self.notes, &self.config,
            &self.note_hands, &self.state.hands, &mut check,
        )?;
        let old = self.projections.scope.replace(Some(Scope {
            file: self.file.clone(),
            notes: self.notes.clone(),
            config: self.config.clone(),
            assignments: self.note_hands.clone(),
            hands: self.state.hands.clone(),
            value: value.clone(),
        }.into()));
        self.retire(old);
        Ok(value)
    }
}

/// Musical identity belongs to a selection, not to one attempt's judgement report.
/// Retaining exact roots lets short loops avoid rescanning all notes of a long song.
pub(crate) struct Scope {
    file: Option<SongFile>,
    notes: PracticeNotes,
    config: SongConfig,
    assignments: HandAssignments,
    hands: String,
    value: String,
}
impl Scope {
    pub(super) fn matches(&self, player: &Player) -> bool {
        let file = match (&self.file, &player.file) {
            (Some(old), Some(current)) => old.same_snapshot(current),
            (None, None) => true,
            _ => false,
        };
        file && self.notes.same_snapshot(&player.notes)
            && self.assignments.same_snapshot(&player.note_hands)
            && self.hands == player.state.hands
            && Arc::ptr_eq(&self.config.note_players, &player.config.note_players)
            && self.config.tracks.len() == player.config.tracks.len()
            && self.config.tracks.iter().zip(player.config.tracks.iter())
                .all(|(old, current)| {
                    old.track_id == current.track_id && old.player == current.player
                        && old.practice_part == current.practice_part
                })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use panthesia_core::practice_history::PracticeSessionContext;
    use std::collections::BTreeMap;

    #[test]
    fn selection_scope_survives_new_attempts_and_tracks_musical_changes() {
        let (mut player, _, _) = crate::history_loading::tests::seeded(true, false);
        let expected = |player: &Player| scope(
            player.file.as_deref(), &player.notes, &player.config,
            &player.note_hands, &player.state.hands,
        );
        assert_eq!(player.practice_scope(), expected(&player));
        let original = player.projections.scope.borrow().clone().unwrap();
        player.reset(0.);
        assert_eq!(player.practice_scope(), expected(&player));
        assert!(player.projections.scope.borrow().as_ref().unwrap().same_snapshot(&original));
        // Speed and range are stored separately in history conditions, not scope.
        player.state.speed = 1.25;
        player.state.passage = None;
        assert_eq!(player.practice_scope(), expected(&player));
        assert!(player.projections.scope.borrow().as_ref().unwrap().same_snapshot(&original));
        player.state.hands = "left".into();
        assert_eq!(player.practice_scope(), expected(&player));
        let left = player.projections.scope.borrow().clone().unwrap();
        assert!(!left.same_snapshot(&original));
        let note = player.notes.first().unwrap();
        let key = (note.track_id, note.index);
        Arc::make_mut(&mut player.config.note_players).insert(key, PlayerConfig::Auto);
        assert_eq!(player.practice_scope(), expected(&player));
        assert!(!player.projections.scope.borrow().as_ref().unwrap().same_snapshot(&left));
        // Per-note routing also invalidates assessment target selection.
        let tasks = background_tasks::TaskPool::new(1, 2).unwrap();
        let context = player.capture_asset_context(false, true);
        let report = player.matcher.report();
        tasks.run("assessment routing identity", None, move |token| {
            let mut player = context.into_player(true)?;
            let assessment = round_analysis::Assessment::prepare(&player, &report, &token)?;
            assert!(assessment.reusable(&player, &report));
            Arc::make_mut(&mut player.config.note_players).remove(&key);
            assert!(!assessment.reusable(&player, &report));
            Ok(serde_json::Value::Null)
        }).unwrap();
    }

    fn attempt() -> PracticeSession {
        PracticeSession {
            replay_clips: vec![],
            playing_ms: None,
            annotation: None,
            id: None,
            context: Some(PracticeSessionContext {
                loop_restart:None,
                note_playback: vec![],
                expression: None,
                routine: None,
                ladder: None,
                target_notes: 12,
                judged_notes: 12,
                tracks: vec![],
                parts: BTreeMap::new(),
                hands: "both".into(),
                count_in: 1,
                metronome: true,
                latency: 10,
                pedal_latency_ms: Some(10),
                rounds: 0,
                adaptive: false,
                grid: "grid-1".into(),
                passage_bounds: None,
                source_path: None,
                exercise_spec: None,
            }),
            recorded_at_unix_ms: 1,
            kind: PracticeSessionKind::Loop {
                start_measure: 2,
                end_measure: 4,
            },
            hands: PracticeHands::Both,
            speed: 0.8,
            mode: Some("flow".into()),
            scope: Some("scope-1".into()),
            effective_tempo_bpm: Some(80),
            summary: AttemptSummary::default(),
        }
    }

    #[test]
    fn same_condition_requires_matching_note_coverage_and_pedal_calibration() {
        let original = attempt();
        assert!(same_attempt_conditions(&original, &original));
        let mut altered = original.clone();
        altered.context.as_mut().unwrap().target_notes = 10;
        assert!(!same_attempt_conditions(&original, &altered));
        altered = original.clone();
        altered.context.as_mut().unwrap().judged_notes = 10;
        assert!(!same_attempt_conditions(&original, &altered));
        altered = original.clone();
        altered.context.as_mut().unwrap().pedal_latency_ms = Some(18);
        assert!(!same_attempt_conditions(&original, &altered));
        altered = original.clone();
        altered.context.as_mut().unwrap().pedal_latency_ms = None;
        assert!(same_attempt_conditions(&original, &altered));
    }

    #[test]
    fn same_condition_rejects_changed_range_grid_settings_and_missing_legacy_context() {
        let original = attempt();
        let mut altered = original.clone();
        altered.kind = PracticeSessionKind::Loop {
            start_measure: 3,
            end_measure: 4,
        };
        assert!(!same_attempt_conditions(&original, &altered));
        altered = original.clone();
        altered.context.as_mut().unwrap().grid = "grid-2".into();
        assert!(!same_attempt_conditions(&original, &altered));
        altered = original.clone();
        altered.context.as_mut().unwrap().count_in = 2;
        assert!(!same_attempt_conditions(&original, &altered));
        altered = original.clone();
        altered.context.as_mut().unwrap().adaptive = true;
        assert!(!same_attempt_conditions(&original, &altered));
        altered = original.clone();
        altered.context = None;
        assert!(!same_attempt_conditions(&altered, &altered));
    }

    #[test]
    fn excluded_attempt_explains_actual_condition_differences() {
        let current = attempt();
        let mut older = current.clone();
        older.speed = 0.7;
        older.context.as_mut().unwrap().grid = "grid-previous".into();
        older.context.as_mut().unwrap().pedal_latency_ms = Some(22);
        assert!(!same_attempt_conditions(&current, &older));
        assert_eq!(
            attempt_difference_reasons(&current, &older),
            ["练习速度不同", "音乐小节网格不同", "踏板延迟校准不同"]
        );
        assert!(attempt_difference_reasons(&current, &current).is_empty());
        let mut exact = current.clone();
        exact.context.as_mut().unwrap().passage_bounds = Some(
            panthesia_core::practice_history::PracticePassageBounds {
                start_tick: 120, end_tick: 360,
            },
        );
        assert_eq!(attempt_difference_reasons(&exact, &current),
            ["有一轮缺少原选段起止拍位"]);
        let mut other = exact.clone();
        other.context.as_mut().unwrap().passage_bounds.as_mut().unwrap().end_tick = 480;
        assert_eq!(attempt_difference_reasons(&exact, &other),
            ["原选段起止拍位不同"]);
        older = current.clone();
        older.context = None;
        assert_eq!(
            attempt_difference_reasons(&current, &older),
            ["旧记录缺少完整演奏条件"]
        );
    }
}
