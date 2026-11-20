use super::*;
use crate::preferences::{ExercisePreset, LadderPreset, LadderRun, PassagePreset};
use crate::routine_commands::{PracticeRoutine, RoutineRun, RoutineTarget};
use panthesia_core::practice_history::{
    PracticeTimeLedger, SongPracticeHistory, validate_time_ledger,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read, Write};
use std::path::Path;
const MAX_FILE: usize = 256_000_000;
const MAX_DATA: usize = 512_000_000;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub plans: bool,
    pub records: bool,
    pub presets: bool,
    #[serde(default)]
    pub days: u32,
}
impl Default for Selection {
    fn default() -> Self {
        Self {
            plans: true,
            records: true,
            presets: true,
            days: 0,
        }
    }
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repertoire: Option<panthesia_core::repertoire::RepertoireRegistry>,
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub metadata_history: Vec<crate::metadata_history::Portable>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata_templates: BTreeMap<String, crate::metadata_templates::Rules>,
    pub routines: Vec<PracticeRoutine>,
    pub runs: BTreeMap<String, RoutineRun>,
    pub passages: BTreeMap<String, Vec<PassagePreset>>,
    pub ladders: BTreeMap<String, Vec<LadderPreset>>,
    pub ladder_runs: BTreeMap<String, LadderRun>,
    pub exercises: Vec<ExercisePreset>,
    #[serde(default)]
    pub track_appearances:
        BTreeMap<String, BTreeMap<usize, crate::track_appearance::TrackAppearance>>,
    #[serde(default)]
    pub track_sounds: BTreeMap<String, BTreeMap<usize, crate::track_sound::TrackSound>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub song_expression_goals: BTreeMap<String, crate::expression_goal::ExpressionGoal>,
    pub history: BTreeMap<String, SongPracticeHistory>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub time_ledger: PracticeTimeLedger,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub performances: BTreeMap<String, BTreeMap<String, crate::performance_archive::Archive>>,
    #[serde(default)]
    pub learning: BTreeMap<String, crate::song_learning::Learning>,
}
fn identity(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > 160 || s.chars().any(char::is_control) {
        Err("备份中存在无效身份编号".into())
    } else {
        Ok(())
    }
}
fn text(s: &str, max: usize) -> Result<(), String> {
    if s.len() > max {
        Err("备份文本超过容量限制".into())
    } else {
        Ok(())
    }
}
fn settings(s: &preferences::SessionSettings) -> Result<(), String> {
    if s.tracks.len() > 1000
        || s.parts.len() > 1000
        || s.count_in > 4
        || s.latency.unsigned_abs() > 1000
        || s.rounds > 10000
        || !matches!(s.hands.as_str(), "both" | "left" | "right" | "custom")
        || s.mode
            .as_deref()
            .is_some_and(|m| !matches!(m, "wait" | "flow" | "listen" | "recital" | "memory"))
    {
        return Err("备份的练习条件无效".into());
    }
    let mut ids = BTreeSet::new();
    if s.tracks.iter().any(|t| !ids.insert(t.track_id)) {
        return Err("备份音轨配置重复".into());
    }
    Ok(())
}
fn speed(v: f64) -> Result<(), String> {
    if !v.is_finite() || !(0.25..=2.).contains(&v) {
        Err("备份练习速度无效".into())
    } else {
        Ok(())
    }
}
fn range(a: usize, b: usize) -> Result<(), String> {
    if a == 0 || a > b || b > 1_000_000 {
        Err("备份小节范围无效".into())
    } else {
        Ok(())
    }
}
fn ladder(p: &LadderPreset) -> Result<(), String> {
    identity(&p.id)?;
    text(&p.name, 320)?;
    text(&p.grid, 2048)?;
    text(&p.scope, 2048)?;
    range(p.start, p.end)?;
    settings(&p.settings)?;
    p.plan.validate()?;
    if p.settings.mode.as_deref() == Some("wait") && p.plan.on_time_percent.is_some() {
        return Err("等音阶梯不能要求准时率".into());
    }
    if let Some(goal)=&p.expression { goal.validate(p.settings.mode.as_deref().unwrap_or("wait"))?; }
    Ok(())
}
fn routine(r: &PracticeRoutine) -> Result<(), String> {
    if let Some(s) = &r.schedule {
        s.validate()?;
    }
    identity(&r.id)?;
    text(&r.name, 320)?;
    text(&r.notes, 8192)?;
    if r.items.len() > 500 {
        return Err("备份计划项目过多".into());
    }
    let mut ids = BTreeSet::new();
    for i in &r.items {
        identity(&i.id)?;
        identity(&i.content_id)?;
        panthesia_core::song_project::PracticeEdition::resolve(i.practice.as_ref(), &i.content_id, &i.grid)?;
        if !ids.insert(&i.id) {
            return Err("备份计划项目编号重复".into());
        }
        text(&i.title, 320)?;
        text(&i.song_title, 2048)?;
        text(&i.notes, 8192)?;
        text(&i.grid, 2048)?;
        text(&i.scope, 2048)?;
        speed(i.speed)?;
        settings(&i.settings)?;
        i.goal
            .validate(i.settings.mode.as_deref().unwrap_or("wait"))?;
        match &i.target {
            RoutineTarget::Whole => {}
            RoutineTarget::PrecisePassage { range } => {
                range.validate()?;
                if range.content_id != i.content_id || range.grid != i.grid {
                    return Err("拍内计划归属无效".into());
                }
            }
            RoutineTarget::ScorePassage { range } => range.validate()?,
            RoutineTarget::Passage { start, end } => range(*start, *end)?,
            RoutineTarget::Ladder { preset } => {
                ladder(preset)?;
                let edition=panthesia_core::song_project::PracticeEdition::resolve(preset.practice.as_ref(), &i.content_id, &preset.grid)?;
                if edition != panthesia_core::song_project::PracticeEdition::resolve(i.practice.as_ref(), &i.content_id, &i.grid)? {return Err("计划与阶梯的练习版本不一致".into());}
            }
        };
        if let Some(spec) = i.exercise {
            let p = ExercisePlan::generate(spec, &KeyboardRange::new(21..=108))
                .map_err(|e| e.to_string())?;
            if p.practice_id() != i.content_id {
                return Err("备份生成练习身份不匹配".into());
            }
        }
    }
    Ok(())
}
fn finite_numbers(v: &Value) -> Result<(), String> {
    fn check(v: &Value, key: &str) -> Result<(), String> {
        // Ledger timestamps, durations and capacity are checked by its shared strict validator.
        if key == "timeLedger" {
            return Ok(());
        }
        match v {
            Value::Array(a) => {
                if a.len() > 1_000_000 {
                    return Err("备份数组过大".into());
                }
                for v in a {
                    check(v, key)?;
                }
            }
            Value::Object(m) => {
                for (k, v) in m {
                    check(v, k)?;
                }
            }
            Value::Number(n) => {
                let max = if matches!(
                    key,
                    "createdAt"
                        | "timeMs"
                        | "generatedAt"
                        | "recordedAt"
                        | "from"
                        | "to"
                        | "runningMs"
                        | "recorded_at_unix_ms"
                        | "last_used_unix_ms"
                        | "updated_at_unix_ms"
                ) {
                    10_000_000_000_000_000
                } else if matches!(key, "updatedAt" | "at") {
                    10_000_000_000
                } else if matches!(key, "startTick" | "endTick") {
                    0x0fff_ffff
                } else {
                    100_000_000
                };
                if n.as_u64().is_some_and(|x| x > max) || n.as_f64().is_some_and(|x| !x.is_finite())
                {
                    return Err("备份数值无效".into());
                }
            }
            _ => {}
        }
        Ok(())
    }
    check(v, "")
}

impl Backup {
    pub fn version(&self) -> u8 {
        if self.ladders.values().flatten().any(|row|row.practice.is_some())
            || self.ladder_runs.values().any(|run|run.preset.practice.is_some())
            || self.routines.iter().chain(self.runs.values().map(|run|&run.routine)).any(|routine|routine.items.iter().any(|item|item.practice.is_some() || matches!(&item.target,RoutineTarget::Ladder{preset} if preset.practice.is_some()))) { return 21; }
        if self.passages.values().flatten().any(|row| row.practice.is_some()) { return 20; }
        if crate::metadata_templates::required_version(&self.metadata_templates) > 1 { return 19; }
        if self.history.values().flat_map(|s| &s.sessions).any(|s| s.context.as_ref().is_some_and(|c| !c.note_playback.is_empty())) { return 18; }
        if self.metadata_history.iter().flat_map(|row| &row.records).any(|record|
            record.before.has_extended_fields() || record.after.has_extended_fields()) { return 17; }

        if self.repertoire.is_some() { return 16; }
        if self.history.values().flat_map(|song| &song.sessions).flat_map(|session| &session.replay_clips).any(|clip| clip.performance_revision.is_some()) { return 15; }
        if !self.song_expression_goals.is_empty() { return 14; }
        if !self.metadata_history.is_empty() {
            return 13;
        }
        if !self.time_ledger.is_empty()
            || self
                .routines
                .iter()
                .chain(self.runs.values().map(|r| &r.routine))
                .any(|r| {
                    r.schedule
                        .as_ref()
                        .is_some_and(|s| !s.skip_dates.is_empty() || !s.extra_dates.is_empty())
                })
        {
            return 12;
        }
        let trimmed = |r: &crate::score_ranges::ScoreRange| r.start_trim > 0 || r.end_trim > 0;
        if self.passages.values().flatten().any(|p|p.score_range.as_ref().is_some_and(trimmed)) || self.routines.iter().chain(self.runs.values().map(|r|&r.routine)).any(|r|r.items.iter().any(|i|matches!(&i.target,RoutineTarget::ScorePassage{range} if trimmed(range)))){return 11;}
        if self
            .passages
            .values()
            .flatten()
            .any(|p| p.precise_range.is_some())
            || self
                .routines
                .iter()
                .chain(self.runs.values().map(|r| &r.routine))
                .any(|r| {
                    r.items
                        .iter()
                        .any(|i| matches!(i.target, RoutineTarget::PrecisePassage { .. }))
                })
        {
            return 10;
        }
        if self
            .history
            .values()
            .any(|h| h.sessions.iter().any(|s| !s.replay_clips.is_empty()))
        {
            return 9;
        }
        if self
            .performances
            .values()
            .flat_map(|rows| rows.values())
            .any(|a| a.has_measures())
        {
            return 8;
        }
        if self
            .performances
            .values()
            .flat_map(|rows| rows.values())
            .any(|a| a.has_judgments())
        {
            return 7;
        }
        if !self.performances.is_empty() {
            return 6;
        }
        if self
            .passages
            .values()
            .flatten()
            .any(|p| p.score_range.is_some())
            || self
                .routines
                .iter()
                .chain(self.runs.values().map(|r| &r.routine))
                .any(|r| {
                    r.items
                        .iter()
                        .any(|i| matches!(i.target, RoutineTarget::ScorePassage { .. }))
                })
        {
            return 5;
        }
        if !self.metadata_templates.is_empty() {
            return 4;
        }
        if !self.learning.is_empty() {
            return 3;
        }
        if self
            .routines
            .iter()
            .chain(self.runs.values().map(|r| &r.routine))
            .any(|r| r.items.iter().any(|i| i.goal.expression.is_some()))
            || self.history.values().any(|h| {
                h.sessions.iter().any(|s| {
                    s.context.as_ref().is_some_and(|c| {
                        c.pedal_latency_ms.is_some_and(|v| v != 0)
                            || c.routine.as_ref().is_some_and(|r| r.expression.is_some())
                    })
                })
            })
        {
            2
        } else {
            1
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if let Some(registry) = &self.repertoire { registry.validate()?; }
        crate::metadata_history::validate_backup(&self.metadata_history)?;
        validate_time_ledger(&self.time_ledger)?;
        if self.time_ledger.len() > 10000 {
            return Err("备份累计时长的曲目数量超过上限".into());
        }
        let mut total_time = 0u64;
        for (cid, rows) in &self.time_ledger {
            identity(cid)?;
            for (id, entry) in rows {
                if id.is_empty() || id.len() > 200 || id.chars().any(char::is_control) {
                    return Err("备份累计时长的保存编号无效".into());
                }
                total_time = total_time
                    .checked_add(entry.untracked_ms)
                    .ok_or("备份累计时长超过上限")?;
                for slice in &entry.slices {
                    total_time = total_time
                        .checked_add(slice.running_ms)
                        .ok_or("备份累计时长超过上限")?;
                }
                if total_time > 9_007_199_254_740_991 {
                    return Err("备份累计时长超过精确统计上限".into());
                }
            }
        }
        for (cid, h) in &self.history {
            for s in &h.sessions {
                let duration = self
                    .performances
                    .get(cid)
                    .and_then(|rows| rows.get(&session_key(s)))
                    .map(|a| a.duration);
                // A versioned clip can deliberately retain seconds from a replaced recording.
                // Keep that metadata available for review after restore; playback validates its source.
                panthesia_core::practice_history::validate_replay_clips(&s.replay_clips, None)?;
                for clip in &s.replay_clips {
                    if clip.performance_revision.is_none() {
                        panthesia_core::practice_history::validate_replay_clips(std::slice::from_ref(clip), duration)?;
                    }
                }
            }
        }
        if self.performances.len() > 10000 {
            return Err("备份回放曲目过多".into());
        }
        for (cid, rows) in &self.performances {
            if rows.len() > 200 {
                return Err("备份每曲回放超过 200 次".into());
            }
            let history = self.history.get(cid).ok_or("备份回放缺少对应成绩")?;
            for (id, a) in rows {
                if !history.sessions.iter().any(|s| session_key(s) == *id) {
                    return Err("备份回放缺少对应成绩".into());
                }
                a.validate(cid, id)?;
                a.validate_summary(
                    history
                        .sessions
                        .iter()
                        .find(|s| session_key(s) == *id)
                        .unwrap()
                        .summary
                        .overall,
                )?;
            }
        }

        if self.metadata_templates.len() > 50 {
            return Err("备份资料模板超过 50 套".into());
        }
        for (name, rules) in &self.metadata_templates {
            if name != name.trim()
                || name.trim().is_empty()
                || name.chars().count() > 80
                || name.chars().any(char::is_control)
            {
                return Err("备份资料模板名称无效".into());
            }
            crate::metadata_templates::validate(rules)?;
        }
        if self.learning.len() > 10000 {
            return Err("备份学习曲目数量超过上限".into());
        }
        for (cid, plan) in &self.learning {
            if cid.len() != 64 || !cid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err("备份学习曲目身份无效".into());
            }
            plan.validate()?;
        }

        if self.track_appearances.len() > 10000 {
            return Err("备份音轨名称与颜色过多".into());
        }
        for (cid, rows) in &self.track_appearances {
            identity(cid)?;
            if rows.len() > 1000 {
                return Err("备份音轨名称与颜色过多".into());
            }
            for (id, a) in rows {
                if *id > 100000 {
                    return Err("备份音轨编号无效".into());
                }
                a.validate()?;
            }
        }
        if self.track_sounds.len() > 10000 {
            return Err("备份音轨设置过多".into());
        }
        for (cid, rows) in &self.track_sounds {
            identity(cid)?;
            if rows.len() > 1000
                || rows.iter().any(|(id, s)| {
                    *id > 100000
                        || s.volume > 100
                        || s.pan.is_some_and(|p| p > 127)
                        || s.program.is_some_and(|p| p > 127)
                })
            {
                return Err("备份音轨声音设置无效".into());
            }
        }
        if self.routines.len() > 100
            || self.runs.len() > 10000
            || self.history.len() > 10000
            || self.exercises.len() > 1000
            || self.passages.len() > 10000
            || self.ladders.len() > 10000
            || self.ladder_runs.len() > 10000
            || self.song_expression_goals.len() > 10000
        {
            return Err("备份条目超过容量限制".into());
        }
        for (content_id, goal) in &self.song_expression_goals {
            identity(content_id)?;
            if content_id.len()!=64 || !content_id.bytes().all(|b|b.is_ascii_hexdigit()) {return Err("备份曲目专项目标身份无效".into());}
            goal.validate("flow")?;
        }
        let mut ids = BTreeSet::new();
        for r in &self.routines {
            routine(r)?;
            if !ids.insert(&r.id) {
                return Err("备份计划编号重复".into());
            }
        }
        for (k, r) in &self.runs {
            routine(&r.routine)?;
            if !routine_commands::day_valid(&r.day) || *k != format!("{}:{}", r.routine.id, r.day) {
                return Err("备份日期安排编号无效".into());
            }
            if r.progress.len() > 1000 {
                return Err("备份日期进度过多".into());
            }
            for p in r.progress.values() {
                if p.session_ids.len() > 500
                    || p.best_accuracy
                        .is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
                    || p.completed && p.skipped
                {
                    return Err("备份日期进度无效".into());
                }
                text(&p.last_result, 8192)?;
            }
        }
        for (cid, rows) in &self.passages {
            identity(cid)?;
            if rows.len() > 200 {
                return Err("备份片段过多".into());
            }
            let mut ids = BTreeSet::new();
            for p in rows {
                if p.practice.is_some() { p.practice_edition(cid)?; }
                identity(&p.id)?;
                if !ids.insert(&p.id) {
                    return Err("备份片段编号重复".into());
                }
                text(&p.name, 320)?;
                text(&p.notes, 8192)?;
                range(p.start, p.end)?;
                if let Some(r) = &p.precise_range {
                    r.validate()?;
                    if &r.content_id != cid || p.score_range.is_some() {
                        return Err("拍内段落归属无效".into());
                    }
                }
                if let Some(range) = &p.score_range {
                    range.validate()?;
                }
                speed(p.speed)?;
                settings(&p.settings)?;
            }
        }
        for (cid, rows) in &self.ladders {
            identity(cid)?;
            if rows.len() > 200 {
                return Err("备份阶梯过多".into());
            }
            let mut ids = BTreeSet::new();
            for p in rows {
                ladder(p)?;
                panthesia_core::song_project::PracticeEdition::resolve(p.practice.as_ref(), cid, &p.grid)?;
                if !ids.insert(&p.id) {
                    return Err("备份阶梯编号重复".into());
                }
            }
        }
        for (key, r) in &self.ladder_runs {
            ladder(&r.preset)?;
            let (cid, _) = key.split_once(':').ok_or("阶梯进度归属无效")?;
            panthesia_core::song_project::PracticeEdition::resolve(r.preset.practice.as_ref(), cid, &r.preset.grid)?;
            if r.progress.stage >= r.preset.plan.speeds().len()
                || r.progress.success_streak > r.preset.plan.passes_required
                || r.progress.batch_rounds > r.preset.plan.attempt_limit
            {
                return Err("备份阶梯阶段无效".into());
            }
        }
        let mut exercise_ids = BTreeSet::new();
        for p in &self.exercises {
            identity(&p.id)?;
            if !exercise_ids.insert(&p.id) {
                return Err("备份技术方案编号重复".into());
            }
            text(&p.name, 320)?;
            ExercisePlan::generate(p.spec, &KeyboardRange::new(21..=108))
                .map_err(|e| e.to_string())?;
        }
        for (cid, h) in &self.history {
            identity(cid)?;
            text(&h.display_name, 2048)?;
            if h.sessions.len() > 200 {
                return Err("每曲备份最多 200 条保留记录".into());
            }
            let mut ids = BTreeSet::new();
            for s in &h.sessions {
                if let Some(a) = &s.annotation {
                    text(&a.note, 8192)?;
                    text(&a.teacher, 8192)?;
                    text(&a.next, 8192)?;
                }
                speed(f64::from(s.speed))?;
                let id = session_key(s);
                if !ids.insert(id) {
                    return Err("备份成绩编号重复".into());
                }
                if let Some(id) = &s.id {
                    identity(id)?;
                }
                if let PracticeSessionKind::Loop {
                    start_measure,
                    end_measure,
                } = s.kind
                {
                    range(start_measure, end_measure)?;
                }
                if s.mode.as_deref().is_some_and(|m| {
                    !matches!(m, "wait" | "flow" | "listen" | "recital" | "memory")
                }) {
                    return Err("备份成绩模式无效".into());
                }
                if s.playing_ms.is_some_and(|ms| ms > 9_000_000_000_000_000) {
                    return Err("备份练习用时超出有效范围".into());
                }
                if let Some(c) = &s.context {
                    if let Some(bounds) = c.passage_bounds {
                        if !matches!(s.kind, PracticeSessionKind::Loop { .. })
                            || bounds.start_tick >= bounds.end_tick
                            || bounds.end_tick > 1_000_000_000_000
                        {
                            return Err("备份成绩的选段起止位置无效".into());
                        }
                    }
                    if let Some(e) = c.expression.as_ref().or_else(||c.routine.as_ref().and_then(|r| r.expression.as_ref())) {
                        crate::expression_goal::ExpressionGoal {
                            velocity_difference: e.velocity_difference,
                            note_velocity_difference: e.note_velocity_difference,
                            note_pedal_mismatch_count: e.note_pedal_mismatch_count,
                            contour_percent: e.contour_percent,
                            pedal_offset_ms: e.pedal_offset_ms,
                        }
                        .validate(s.mode.as_deref().unwrap_or("flow"))?;
                    }
                    let mut note_ids = std::collections::BTreeSet::new();
                    if c.note_playback.len() > 1_000_000 || c.note_playback.iter().any(|r|
                        !c.tracks.iter().any(|t| t.track_id == r.track_id)
                        || !note_ids.insert((r.track_id, r.note_index))) {
                        return Err("备份成绩的逐音播放规则无效".into());
                    }
                    if c.tracks.len() > 1000
                        || c.parts.len() > 1000
                        || c.latency.unsigned_abs() > 1000
                        || c.pedal_latency_ms.is_some_and(|v| v.unsigned_abs() > 1000)
                        || c.count_in > 4
                        || c.target_notes > 100_000_000
                        || c.judged_notes > 100_000_000
                    {
                        return Err("备份成绩条件无效".into());
                    }
                }
            }
        }
        finite_numbers(&serde_json::to_value(self).map_err(|e| e.to_string())?)
    }
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        self.validate()?;
        let data = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        if data.len() > MAX_DATA {
            return Err("备份解压内容超过 512 MB，请按日期减少成绩范围".into());
        }
        let header = json!({"format":"neothesia-practice","version":self.version(),"hash":blake3::hash(&data).to_hex().to_string(),"size":data.len()});
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, b) in [
            ("manifest.json", serde_json::to_vec(&header).unwrap()),
            ("practice.json", data),
        ] {
            zip.start_file(name, opts).map_err(|e| e.to_string())?;
            zip.write_all(&b).map_err(|e| e.to_string())?;
        }
        let bytes = zip.finish().map_err(|e| e.to_string())?.into_inner();
        if bytes.len() > MAX_FILE {
            return Err("备份超过 256 MB".into());
        }
        Ok(bytes)
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        if bytes.is_empty() || bytes.len() > MAX_FILE {
            return Err("练习备份为空或超过 256 MB".into());
        }
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|e| format!("练习备份格式无效：{e}"))?;
        if zip.len() != 2 {
            return Err("练习备份目录无效".into());
        }
        let mut files = BTreeMap::new();
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = f.name().to_owned();
            let max = if name == "manifest.json" {
                4096
            } else if name == "practice.json" {
                MAX_DATA
            } else {
                return Err("备份包含未知文件".into());
            };
            if f.is_dir() || f.size() > max as u64 || files.contains_key(&name) {
                return Err("备份文件重复或超过限制".into());
            }
            let mut b = vec![];
            f.by_ref()
                .take(max as u64 + 1)
                .read_to_end(&mut b)
                .map_err(|e| e.to_string())?;
            if b.len() > max {
                return Err("备份解压内容超过限制".into());
            }
            files.insert(name, b);
        }
        let header: Value =
            serde_json::from_slice(&files["manifest.json"]).map_err(|e| e.to_string())?;
        let data = &files["practice.json"];
        if header["format"] != "neothesia-practice"
            || !matches!(
                header["version"].as_u64(),
                Some(1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21)
            )
            || header["size"].as_u64() != Some(data.len() as u64)
            || header["hash"].as_str() != Some(blake3::hash(data).to_hex().as_str())
        {
            return Err("练习备份校验失败或版本不支持".into());
        }
        let backup: Self = serde_json::from_slice(data).map_err(|e| e.to_string())?;
        backup.validate()?;
        if u64::from(backup.version()) > header["version"].as_u64().unwrap_or(0) {
            return Err("备份包含新的练习资料字段，请使用新版备份格式".into());
        }
        Ok(backup)
    }
    pub fn summary(&self) -> Value {
        let mut value = json!({"timeLedgerEntries":self.time_ledger.values().map(BTreeMap::len).sum::<usize>(),"timeLedgerRunningMs":self.time_ledger.values().flat_map(|rows|rows.values()).flat_map(|e|e.slices.iter()).map(|s|s.running_ms).sum::<u64>(),"timeLedgerUntrackedMs":self.time_ledger.values().flat_map(|rows|rows.values()).map(|e|e.untracked_ms).sum::<u64>(),"replayClips":self.history.values().flat_map(|h|h.sessions.iter()).map(|s|s.replay_clips.len()).sum::<usize>(),"performances":self.performances.values().map(BTreeMap::len).sum::<usize>(),"performanceBytes":self.performances.values().flat_map(|rows|rows.values()).filter_map(|a|a.encoded_len().ok()).sum::<usize>(),"metadataTemplates":self.metadata_templates.len(),"metadataTemplateRows":self.metadata_templates.iter().map(|(name,rules)|json!({"name":name,"rules":rules})).collect::<Vec<_>>(),"learning":self.learning.len(),"createdAt":self.created_at,"plans":self.routines.iter().map(|r|json!({"id":r.id,"name":r.name,"notes":r.notes,"schedule":r.schedule,"items":r.items.len()})).collect::<Vec<_>>(),"days":self.runs.len(),"songs":self.history.len(),"records":self.history.values().map(|h|h.sessions.len()).sum::<usize>(),"passages":self.passages.values().map(Vec::len).sum::<usize>(),"ladders":self.ladders.values().map(Vec::len).sum::<usize>(),"exercises":self.exercises.len(),"trackSounds":self.track_sounds.values().map(BTreeMap::len).sum::<usize>(),"songExpressionGoals":self.song_expression_goals.len(),"trackAppearances":self.track_appearances.values().map(BTreeMap::len).sum::<usize>()});
        value["works"] = json!(self.repertoire.as_ref().map_or(0, |r|r.works.len()));
        value["performanceEditions"] = json!(self.repertoire.as_ref().map_or(0, |r|r.performances.len()));
        value["notationEditions"] = json!(self.repertoire.as_ref().map_or(0, |r|r.notations.len()));
        value["metadataHistory"] = json!(
            self.metadata_history
                .iter()
                .map(|row| row.records.len())
                .sum::<usize>()
        );
        value["metadataHistorySongs"] = json!(
            self.metadata_history
                .iter()
                .map(|row| &row.content_id)
                .collect::<BTreeSet<_>>()
                .len()
        );
        value
    }
}
pub(super) fn session_key(s: &PracticeSession) -> String {
    s.stable_id()
}
pub(super) fn collision_key(session: &PracticeSession) -> String {
    let mut evidence = session.clone();
    evidence.annotation = None;
    evidence.replay_clips.clear();
    format!(
        "import-{}",
        blake3::hash(&serde_json::to_vec(&evidence).unwrap()).to_hex()
    )
}
pub(super) fn merge_rows<T: Clone + Serialize>(
    local: &mut Vec<T>,
    incoming: &[T],
    id: impl Fn(&T) -> &str,
    replace: bool,
    max: usize,
) -> Result<usize, String> {
    let mut changed = 0;
    for r in incoming {
        if let Some(i) = local.iter().position(|x| id(x) == id(r)) {
            if replace
                && serde_json::to_value(&local[i]).unwrap() != serde_json::to_value(r).unwrap()
            {
                local[i] = r.clone();
                changed += 1;
            }
        } else {
            local.push(r.clone());
            changed += 1;
        }
    }
    if local.len() > max {
        return Err("合并后的条目超过容量限制，请先整理本地资料".into());
    }
    Ok(changed)
}
pub(super) fn selected(mut b: Backup, s: &Selection) -> Backup {
    if !s.plans {
        b.routines.clear();
        b.runs.clear();
        b.learning.clear();
    }
    if !s.presets {
        b.repertoire = None;
        b.metadata_history.clear();
        b.metadata_templates.clear();
        b.passages.clear();
        b.ladders.clear();
        b.ladder_runs.clear();
        b.exercises.clear();
        b.track_sounds.clear();
        b.track_appearances.clear();
        b.song_expression_goals.clear();
    }
    if !s.records {
        b.history.clear();
        b.time_ledger.clear();
    } else if s.days > 0 {
        let cutoff = b.created_at.saturating_sub(u64::from(s.days) * 86_400_000);
        for h in b.history.values_mut() {
            h.sessions.retain(|v| v.recorded_at_unix_ms >= cutoff);
        }
        b.history.retain(|_, h| !h.sessions.is_empty());
    }
    b.performances.retain(|cid, rows| {
        let Some(h) = b.history.get(cid) else {
            return false;
        };
        rows.retain(|id, _| h.sessions.iter().any(|session| session_key(session) == *id));
        !rows.is_empty()
    });
    b
}
#[derive(Deserialize, Serialize)]
struct Journal {
    #[serde(default)]
    performances: BTreeMap<String, bool>,
    #[serde(default)]
    metadata_histories: BTreeMap<String, bool>,
    #[serde(default)]
    pending_metadata_history: Option<bool>,
    folder: String,
    prefs: bool,
    history: bool,
    #[serde(default)]
    workspace: Option<bool>,
    #[serde(default)]
    templates: Option<bool>,
    #[serde(default)]
    repertoire: Option<bool>,
    committed: bool,
}
fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    panthesia_core::utils::atomic_file::write(path, bytes).map_err(|e| e.to_string())
}
pub fn recover(data: &Path) -> Result<(), String> {
    let journal = data.join("practice-import-journal.json");
    if !journal.exists() {
        return Ok(());
    }
    let j: Journal = serde_json::from_slice(&std::fs::read(&journal).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if !j.folder.starts_with("restore-")
        || j.folder.len() > 120
        || !j
            .folder
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("练习导入恢复目录无效".into());
    }
    if j.performances.keys().any(|name| {
        name.len() != 69
            || !name.ends_with(".json")
            || !name.as_bytes()[..64].iter().all(|b| b.is_ascii_hexdigit())
    }) {
        return Err("练习导入回放恢复路径无效".into());
    }
    if j.metadata_histories.keys().any(|name| {
        name.len() != 69
            || !name.ends_with(".json")
            || !name.as_bytes()[..64].iter().all(|b| b.is_ascii_hexdigit())
    }) {
        return Err("练习导入资料历史恢复路径无效".into());
    }
    if !j.committed {
        let old = data.join("practice-restore-points").join(&j.folder);
        for (name, exists) in [
            ("web-preferences.json", j.prefs),
            ("web-practice-history.ron", j.history),
        ]
        .into_iter()
        .chain(j.workspace.map(|exists| ("library-workspace.json", exists)))
        .chain(j.repertoire.map(|exists| ("repertoire.json", exists)))
        .chain(
            j.templates
                .map(|exists| ("metadata-templates.json", exists)),
        )
        .chain(
            j.pending_metadata_history
                .map(|exists| ("pending-metadata-history.json", exists)),
        ) {
            if exists {
                atomic(
                    &data.join(name),
                    &std::fs::read(old.join(name)).map_err(|e| e.to_string())?,
                )?;
            } else if data.join(name).exists() {
                std::fs::remove_file(data.join(name)).map_err(|e| e.to_string())?;
            }
        }
        for (name, exists) in &j.performances {
            let path = data.join("performance-history").join(name);
            if *exists {
                std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
                atomic(
                    &path,
                    &std::fs::read(old.join("performance-history").join(name))
                        .map_err(|e| e.to_string())?,
                )?;
            } else if path.exists() {
                std::fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
        for (name, exists) in &j.metadata_histories {
            let path = data.join("metadata-history").join(name);
            if *exists {
                std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
                atomic(
                    &path,
                    &std::fs::read(old.join("metadata-history").join(name))
                        .map_err(|e| e.to_string())?,
                )?;
            } else if path.exists() {
                std::fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
    }
    std::fs::remove_file(journal).map_err(|e| e.to_string())
}
pub(super) fn commit(
    data: &Path,
    prefs: &Preferences,
    history: &PracticeHistoryStore,
    workspace: &library_workspace::Workspace,
    templates: Option<&[u8]>,
    repertoire: Option<&[u8]>,
    performances: &BTreeMap<String, Vec<u8>>,
    metadata_histories: &BTreeMap<String, Vec<u8>>,
    pending_metadata_history: Option<&[u8]>,
) -> Result<String, String> {
    if crate::asset_storage::pending(data) || crate::round_storage::pending(data) || crate::settings_storage::pending(data) {
        return Err("上一轮练习结果尚待恢复，请重新启动完成恢复后再导入备份；现有资料已保留".into());
    }
    recover(data)?;
    std::fs::create_dir_all(data).map_err(|e| e.to_string())?;
    let folder = format!(
        "restore-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let root = data.join("practice-restore-points").join(&folder);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let mut j = Journal {
        performances: BTreeMap::new(),
        metadata_histories: BTreeMap::new(),
        pending_metadata_history: pending_metadata_history.map(|_| false),
        folder: folder.clone(),
        prefs: false,
        history: false,
        workspace: Some(false),
        templates: templates.map(|_| false),
        repertoire: repertoire.map(|_| false),
        committed: false,
    };
    for (name, exists) in [
        ("web-preferences.json", &mut j.prefs),
        ("web-practice-history.ron", &mut j.history),
        ("library-workspace.json", j.workspace.as_mut().unwrap()),
    ]
    .into_iter()
    .chain(j.repertoire.as_mut().map(|exists| ("repertoire.json", exists)))
    .chain(
        j.templates
            .as_mut()
            .map(|exists| ("metadata-templates.json", exists)),
    )
    .chain(
        j.pending_metadata_history
            .as_mut()
            .map(|exists| ("pending-metadata-history.json", exists)),
    ) {
        let p = data.join(name);
        *exists = p.exists();
        if *exists {
            std::fs::copy(&p, root.join(name)).map_err(|e| e.to_string())?;
        }
    }
    if !performances.is_empty() {
        std::fs::create_dir_all(root.join("performance-history")).map_err(|e| e.to_string())?;
    }
    for name in performances.keys() {
        let path = data.join("performance-history").join(name);
        let exists = path.exists();
        if exists {
            std::fs::copy(&path, root.join("performance-history").join(name))
                .map_err(|e| e.to_string())?;
        }
        j.performances.insert(name.clone(), exists);
    }
    if !metadata_histories.is_empty() {
        std::fs::create_dir_all(root.join("metadata-history")).map_err(|e| e.to_string())?;
    }
    for name in metadata_histories.keys() {
        let path = data.join("metadata-history").join(name);
        let exists = path.exists();
        if exists {
            std::fs::copy(&path, root.join("metadata-history").join(name))
                .map_err(|e| e.to_string())?;
        }
        j.metadata_histories.insert(name.clone(), exists);
    }
    let journal = data.join("practice-import-journal.json");
    atomic(&journal, &serde_json::to_vec(&j).unwrap())?;
    let result = (|| {
        atomic(
            &data.join("web-preferences.json"),
            &serde_json::to_vec_pretty(prefs).map_err(|e| e.to_string())?,
        )?;
        atomic(
            &data.join("web-practice-history.ron"),
            &history.snapshot_bytes().map_err(|e| e.to_string())?,
        )?;
        atomic(
            &data.join("library-workspace.json"),
            &serde_json::to_vec(workspace).map_err(|e| e.to_string())?,
        )?;
        if let Some(bytes) = templates {
            atomic(&data.join("metadata-templates.json"), bytes)?;
        }
        if let Some(bytes) = repertoire { atomic(&data.join("repertoire.json"), bytes)?; }
        if let Some(bytes) = pending_metadata_history {
            atomic(&data.join("pending-metadata-history.json"), bytes)?;
        }
        if !performances.is_empty() {
            std::fs::create_dir_all(data.join("performance-history")).map_err(|e| e.to_string())?;
        }
        for (name, bytes) in performances {
            atomic(&data.join("performance-history").join(name), bytes)?;
        }
        if !metadata_histories.is_empty() {
            std::fs::create_dir_all(data.join("metadata-history")).map_err(|e| e.to_string())?;
        }
        for (name, bytes) in metadata_histories {
            atomic(&data.join("metadata-history").join(name), bytes)?;
        }
        j.committed = true;
        atomic(&journal, &serde_json::to_vec(&j).unwrap())?;
        Ok::<_, String>(())
    })();
    if let Err(e) = result {
        recover(data).map_err(|r| format!("导入失败：{e}；恢复失败：{r}"))?;
        return Err(e);
    }
    let _ = recover(data);
    Ok(folder)
}
/// The actor captures shared in-memory state; export materializes it on its caller's worker.
pub(crate) struct Seed {
    preferences: Preferences,
    history: PracticeHistoryStore,
    selection: Selection,
    created_at: u64,
}
impl Seed {
    #[cfg(test)]
    pub(super) fn materialize(self) -> Result<Backup, String> {
        self.materialize_checked(|| Ok(()))
    }
    fn materialize_checked(self, check: impl Fn() -> Result<(), String>) -> Result<Backup, String> {
        check()?;
        let s = &self.selection;
        if !s.plans && !s.records && !s.presets {
            return Err("请选择要备份的练习资料".into());
        }
        let mut history = BTreeMap::new();
        if s.records {
            let cutoff = self.created_at.saturating_sub(u64::from(s.days) * 86_400_000);
            for (id, song) in self.history.iter_songs() {
                check()?;
                let sessions = song.sessions.iter().filter(|session| s.days == 0 || session.recorded_at_unix_ms >= cutoff)
                    .cloned().collect::<Vec<_>>();
                if s.days > 0 && sessions.is_empty() { continue; }
                history.insert(id.to_owned(), SongPracticeHistory {
                    display_name: song.display_name.clone(), setup: song.setup.clone(), library: song.library.clone(), sessions,
                });
            }
        }
        check()?;
        let b = Backup {
            repertoire: None,
            created_at: self.created_at,
            metadata_history: vec![],
            metadata_templates: BTreeMap::new(),
            routines: s.plans.then(|| self.preferences.routines.materialize()).unwrap_or_default(),
            runs: s.plans.then(|| self.preferences.routine_runs.materialize()).unwrap_or_default(),
            passages: s.presets.then(|| self.preferences.passages.materialize()).unwrap_or_default(),
            ladders: s.presets.then(|| self.preferences.ladder_presets.materialize()).unwrap_or_default(),
            ladder_runs: s.presets.then(|| self.preferences.ladder_runs.materialize()).unwrap_or_default(),
            exercises: s.presets.then(|| self.preferences.exercise_presets.materialize()).unwrap_or_default(),
            track_sounds: s.presets.then(|| self.preferences.track_sounds.materialize()).unwrap_or_default(),
            song_expression_goals: s.presets.then(|| self.preferences.song_expression_goals.materialize()).unwrap_or_default(),
            track_appearances: s.presets.then(|| self.preferences.track_appearances.materialize()).unwrap_or_default(),
            history,
            time_ledger: s.records.then(|| self.history.time_ledger().clone()).unwrap_or_default(),
            performances: BTreeMap::new(),
            learning: BTreeMap::new(),
        };
        check()?;
        Ok(selected(b, s))
    }
}
impl Engine {
    pub(super) fn backup_seed(&self, selection: Selection, created_at: Option<u64>, check: impl Fn() -> Result<(), String>) -> Result<Backup, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx.send(runtime_request::Request::BackupSnapshot { selection, created_at, reply })
            .map_err(|_| "音乐引擎已关闭")?;
        let seed = receiver.recv_timeout(Duration::from_secs(15)).map_err(|_| "读取备份条件超时")??;
        seed.materialize_checked(check)
    }

    pub(super) fn practice_backup_task(&self, selection: Selection, as_file: bool) -> Result<Value, String> {
        let engine = self.clone();
        self.tasks.run("导出练习资料", None, move |token| {
            token.check()?;
            let seed = engine.backup_seed(selection.clone(), None, || token.check())?;
            let expected = seed_fingerprint(&seed, || token.check())?;
            let created_at = seed.created_at;
            token.stage("reading")?;
            let backup = complete_snapshot(&engine.data, seed, &selection, || token.check())?;
            token.check()?;
            let current = engine.backup_seed(selection, Some(created_at), || token.check())?;
            if expected != seed_fingerprint(&current, || token.check())? {
                return Err("备份期间选中的练习资料已变化，请重新导出".into());
            }
            token.check()?;
            if !as_file {
                return serde_json::to_value(backup).map_err(|e| e.to_string());
            }
            token.stage("encoding")?;
            let bytes = backup.encode()?;
            let summary = backup.summary();
            token.check()?;
            let path = engine.data.join("practice-transfers").join(format!("{}.neopractice", blake3::hash(&bytes)));
            token.begin_commit()?;
            panthesia_core::utils::atomic_file::write(&path, &bytes).map_err(|e| e.to_string())?;
            Ok(json!({"path": path, "summary": summary}))
        })
    }
}

pub(super) fn seed_fingerprint(backup: &Backup, check: impl Fn() -> Result<(), String>) -> Result<String, String> {
    let hash = crate::json_stream::encode(backup, blake3::Hasher::new(), MAX_DATA, check)?;
    Ok(hash.finalize().to_hex().to_string())
}
#[cfg(test)]
pub(super) fn check_seed(expected: &[u8], current: &Backup) -> Result<(), String> {
    if expected != serde_json::to_vec(current).map_err(|e| e.to_string())? {
        return Err("备份期间选中的练习资料已变化，请重新导出".into());
    }
    Ok(())
}

impl Player {
    pub(super) fn capture_practice_backup(&self, selection: Selection, created_at: Option<u64>) -> Result<Seed, String> {
        if !selection.plans && !selection.records && !selection.presets { return Err("请选择要备份的练习资料".into()); }
        Ok(Seed { preferences: self.preferences.clone(), history: self.history.clone(), selection,
            created_at: created_at.unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64) })
    }
    #[cfg(test)]
    pub(super) fn practice_backup_seed(&self, selection: &Selection, created_at: Option<u64>) -> Result<Backup, String> {
        self.capture_practice_backup(selection.clone(), created_at)?.materialize()
    }
    #[cfg(test)]
    pub(super) fn practice_backup_snapshot(&self, s: &Selection) -> Result<Value, String> {
        let b = complete_snapshot(&self.data, self.practice_backup_seed(s, None)?, s, || Ok(()))?;
        serde_json::to_value(b).map_err(|e| e.to_string())
    }
}

fn complete_snapshot(data: &Path, mut b: Backup, s: &Selection, check: impl Fn() -> Result<(), String>) -> Result<Backup, String> {
        check()?;
        let lock = library_workspace::lock_for(data)?;
        let _guard = lock.lock().map_err(|_| "曲库资料正忙")?;
        check()?;
        if s.presets {
            b.metadata_history = crate::metadata_history::snapshot(data)?;
            check()?;
            b.metadata_templates = crate::metadata_templates::snapshot_unlocked(data)?;
            let registry = crate::repertoire::read(data)?.0;
            if !registry.works.is_empty() { b.repertoire = Some(registry); }
        }
        if s.plans {
            b.learning = library_workspace::Workspace::load(data)?.learning;
        }
        let mut bytes = 0usize;
        for (cid, h) in &b.history {
            for session in &h.sessions {
                check()?;
                let id = session_key(session);
                if crate::performance_archive::available(data, cid, &id) {
                    let a = crate::performance_archive::read(data, cid, &id)?;
                    bytes = bytes.saturating_add(a.encoded_len()?);
                    if bytes > MAX_DATA {
                        return Err("回放资料超过备份容量，请缩小成绩日期范围".into());
                    }
                    b.performances.entry(cid.clone()).or_default().insert(id, a);
                }
            }
        }
        check()?;
        Ok(b)
}
impl Player {
    #[cfg(test)]
    pub(super) fn inspect_practice_backup(&self, b: &Backup) -> Value {
        let memory = self.practice_backup_seed(&Selection::default(), Some(0)).unwrap();
        crate::practice_backup_preview::inspect_snapshot(&self.data, &memory, b, || Ok(())).unwrap()
    }
}

impl Player {
    #[cfg(test)]
    pub(super) fn apply_practice_backup(&mut self, b: Backup, s: Selection, policy: String) -> Result<Value, String> {
        self.check_backup_import()?;
        let context = crate::practice_backup_import::Context::capture(self);
        let outcome = context.apply(b, s, policy, || Ok(()), || Ok(()))?;
        Ok(outcome.install(self))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn background_export(engine: &Engine) -> mpsc::Receiver<Result<Value, String>> {
        let engine = engine.clone();
        let (reply, receiver) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let _ = reply.send(engine.command(Command::ExportPracticeBackup { selection: Selection::default() }));
        });
        receiver
    }
    fn wait_for_backup_read(engine: &Engine) -> String {
        wait_for_task(engine, "导出练习资料", "reading")
    }
    fn wait_for_task(engine: &Engine, label: &str, stage: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let tasks = engine.command(Command::Tasks).unwrap();
            if let Some(task) = tasks.as_array().unwrap().iter().find(|t| t["label"] == label && t["stage"] == stage) {
                return task["id"].as_str().unwrap().into();
            }
            assert!(Instant::now() < deadline, "task did not reach the requested stage");
            thread::sleep(Duration::from_millis(5));
        }
    }
    fn backup_engine() -> Engine {
        let root = player().data;
        let lock = data_root_lock::DataRootLock::acquire(&root).unwrap();
        let engine = Engine::start(root, lock, PathBuf::new(), true).unwrap();
        engine.command(Command::CurrentSong).unwrap();
        engine
    }
    #[test]
    fn public_preview_can_cancel_while_files_wait_without_publishing_and_retry_preserves_bytes() {
        let engine = backup_engine();
        let bytes = Backup::default().encode().unwrap();
        let key = blake3::hash(&bytes).to_hex().to_string();
        let cache = engine.data.join("practice-transfers").join(format!("{key}.neopractice"));
        let lock = library_workspace::lock_for(&engine.data).unwrap();
        let guard = lock.lock().unwrap();
        let (reply, receiver) = mpsc::sync_channel(1);
        let caller = engine.clone();
        let input = bytes.clone();
        thread::spawn(move || { let _ = reply.send(caller.stage_practice_backup(input)); });
        let id = wait_for_task(&engine, "预览练习备份", "comparing");
        let (reply, control) = mpsc::sync_channel(1);
        let controller = engine.clone();
        thread::spawn(move || { let _ = reply.send(controller.command(Command::Panic)); });
        control.recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
        engine.command(Command::CancelTask { id }).unwrap();
        assert!(receiver.recv_timeout(Duration::from_secs(2)).unwrap().unwrap_err().contains("取消"));
        assert!(!cache.exists());
        assert!(!engine.data.join("practice-import-journal.json").exists());
        drop(guard);
        let result = engine.stage_practice_backup(bytes.clone()).unwrap();
        assert_eq!(result["token"], key);
        assert_eq!(std::fs::read(cache).unwrap(), bytes);
        let preview = engine.command(Command::InspectPracticeBackup { backup: Backup::default() }).unwrap();
        assert_eq!(preview["conflicts"], result["conflicts"]);
        assert!(preview.get("token").is_none());
    }
    #[test]
    fn staged_preview_rejects_changed_local_memory_and_invalid_input_keeps_store() {
        let engine = backup_engine();
        assert!(engine.stage_practice_backup(b"invalid zip".to_vec()).is_err());
        assert!(!engine.data.join("practice-transfers").exists());
        let bytes = Backup::default().encode().unwrap();
        let lock = library_workspace::lock_for(&engine.data).unwrap();
        let guard = lock.lock().unwrap();
        let (reply, receiver) = mpsc::sync_channel(1);
        let caller = engine.clone();
        let input = bytes.clone();
        thread::spawn(move || { let _ = reply.send(caller.stage_practice_backup(input)); });
        wait_for_task(&engine, "预览练习备份", "comparing");
        let routine = engine.command(Command::SaveRoutine { id: None, day: None, name: "预览期间新增".into(), notes: String::new(), copy_of: None, request_id: None }).unwrap();
        let prefs = std::fs::read(engine.data.join("web-preferences.json")).unwrap();
        drop(guard);
        assert!(receiver.recv_timeout(Duration::from_secs(5)).unwrap().unwrap_err().contains("预览期间"));
        assert!(!engine.data.join("practice-transfers").exists());
        assert_eq!(std::fs::read(engine.data.join("web-preferences.json")).unwrap(), prefs);
        let result = engine.stage_practice_backup(bytes).unwrap();
        assert!(result["token"].is_string());
        assert!(engine.command(Command::Routines { day: "2026-11-14".into() }).unwrap().to_string().contains(routine["id"].as_str().unwrap()));
    }
    #[test]
    fn public_backup_can_cancel_while_storage_waits_and_controls_keep_responding() {
        let engine = backup_engine();
        let lock = library_workspace::lock_for(&engine.data).unwrap();
        let guard = lock.lock().unwrap();
        let receiver = background_export(&engine);
        let id = wait_for_backup_read(&engine);
        let (reply, control) = mpsc::sync_channel(1);
        let controller = engine.clone();
        thread::spawn(move || { let _ = reply.send(controller.command(Command::Panic)); });
        control.recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
        engine.command(Command::CancelTask { id: id.clone() }).unwrap();
        assert!(receiver.recv_timeout(Duration::from_secs(2)).unwrap().unwrap_err().contains("取消"));
        assert!(!engine.data.join("practice-transfers").exists());
        drop(guard);
        let result = engine.command(Command::ExportPracticeBackup { selection: Selection::default() }).unwrap();
        let path = PathBuf::from(result["path"].as_str().unwrap());
        let backup = Backup::decode(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(backup.summary(), result["summary"]);
        let tasks = engine.command(Command::Tasks).unwrap();
        assert_eq!(tasks.as_array().unwrap().iter().find(|t| t["id"] == id).unwrap()["state"], "cancelled");
    }
    #[test]
    fn public_backup_rejects_changed_memory_before_publishing_and_retry_includes_it() {
        let engine = backup_engine();
        let lock = library_workspace::lock_for(&engine.data).unwrap();
        let guard = lock.lock().unwrap();
        let receiver = background_export(&engine);
        wait_for_backup_read(&engine);
        let routine = engine.command(Command::SaveRoutine { id: None, day: None, name: "导出期间新增".into(), notes: String::new(), copy_of: None, request_id: None }).unwrap();
        drop(guard);
        assert!(receiver.recv_timeout(Duration::from_secs(5)).unwrap().unwrap_err().contains("资料已变化"));
        assert!(!engine.data.join("practice-transfers").exists());
        let result = engine.command(Command::ExportPracticeBackup { selection: Selection::default() }).unwrap();
        let backup = Backup::decode(&std::fs::read(result["path"].as_str().unwrap()).unwrap()).unwrap();
        assert!(backup.routines.iter().any(|r| r.id == routine["id"].as_str().unwrap()));
    }
    #[test]
    fn memory_seed_does_not_read_disk_and_record_only_snapshot_skips_unselected_library() {
        let p = player();
        std::fs::create_dir_all(&p.data).unwrap();
        std::fs::write(p.data.join("library-workspace.json"), b"invalid JSON").unwrap();
        let selection = Selection { plans: false, records: true, presets: false, days: 0 };
        let seed = p.practice_backup_seed(&selection, Some(123)).unwrap();
        assert_eq!(seed.created_at, 123);
        complete_snapshot(&p.data, seed, &selection, || Ok(())).unwrap();
        let full = p.practice_backup_seed(&Selection::default(), Some(123)).unwrap();
        assert!(complete_snapshot(&p.data, full, &Selection::default(), || Ok(())).is_err());
    }
    #[test]
    fn song_expression_goals_preview_conflicts_and_follow_import_policy() {
        let content_id = "a".repeat(64);
        let incoming = crate::expression_goal::ExpressionGoal { contour_percent: Some(85), ..Default::default() };
        let local = crate::expression_goal::ExpressionGoal { velocity_difference: Some(12), ..Default::default() };
        let mut source = player();
        source.preferences.song_expression_goals.insert(content_id.clone(), incoming.clone());
        let selection = Selection { plans: false, records: false, presets: true, days: 0 };
        let backup: Backup = serde_json::from_value(source.practice_backup_snapshot(&selection).unwrap()).unwrap();
        assert_eq!(backup.version(), 14);
        let backup = Backup::decode(&backup.encode().unwrap()).unwrap();
        let mut target = player();
        target.preferences.song_expression_goals.insert(content_id.clone(), local.clone());
        let preview = target.inspect_practice_backup(&backup);
        assert_eq!(preview["songExpressionGoals"], 1);
        assert_eq!(preview["presetConflicts"], 1);
        assert_eq!(preview["conflictRows"][0]["kind"], "单曲力度与踏板目标");
        target.apply_practice_backup(backup.clone(), selection.clone(), "keep".into()).unwrap();
        assert_eq!(target.preferences.song_expression_goals[&content_id], local);
        target.apply_practice_backup(backup, selection, "backup".into()).unwrap();
        assert_eq!(target.preferences.song_expression_goals[&content_id], incoming);
    }
    fn player() -> Player {
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let data = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/cycle128-unit")
            .join(format!(
                "{}-{}",
                SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        Player::new(data, PathBuf::from("unused.sf2"), true)
    }
    fn fixture(p: &mut Player) -> Backup {
        p.command(Command::Generate {
            spec: ExerciseSpec::default(),
        })
        .unwrap();
        p.command(Command::Mode {
            value: "wait".into(),
        })
        .unwrap();
        let result = p
            .save_routine(None, None, "迁移日课".into(), "教师要求".into(), None)
            .unwrap();
        let id = result["id"].as_str().unwrap();
        p.save_routine_item(
            id,
            None,
            None,
            Some("current"),
            None,
            "热身".into(),
            "保持连奏".into(),
            routine_commands::RoutineGoal {
                expression: None,
                passes: 1,
                accuracy: 90,
                on_time: None,
                consecutive: false,
                attempt_limit: 20,
            },
        )
        .unwrap();
        let item = p.preferences.routines[0].items[0].clone();
        let run = RoutineRun {
            day: "2026-10-02".into(),
            routine: p.preferences.routines[0].clone(),
            progress: BTreeMap::from([(
                item.id.clone(),
                routine_commands::RoutineProgress {
                    completed: true,
                    passed: 1,
                    attempts: 1,
                    session_ids: vec!["same-id".into()],
                    ..Default::default()
                },
            )]),
            last_item: Some(item.id.clone()),
        };
        p.preferences
            .routine_runs
            .insert(format!("{}:{}", id, run.day), run);
        let mut session = PracticeSession::new(
            PracticeSessionKind::WholeSong,
            panthesia_core::practice::PracticeHands::Both,
            1.0,
            AttemptSummary::default(),
        );
        session.id = Some("same-id".into());
        session.summary.overall.matched_notes = 9;
        p.history
            .record_session(&item.content_id, &item.song_title, session)
            .unwrap();
        serde_json::from_value(p.practice_backup_snapshot(&Selection::default()).unwrap()).unwrap()
    }
    fn time_entry() -> panthesia_core::practice_history::PracticeTimeEntry {
        use panthesia_core::practice_history::{PracticeTimeEntry, PracticeTimeSlice};
        PracticeTimeEntry {
            saved_at_unix_ms: 1_700_000_015_000,
            slices: vec![PracticeTimeSlice {
                from: 1_700_000_000_000,
                to: 1_700_000_010_000,
                running_ms: 7000,
            }],
            untracked_ms: 500,
        }
    }
    #[test]
    fn exact_passage_bounds_survive_backup_and_invalid_bounds_are_rejected() {
        let mut source = player();
        let mut backup = fixture(&mut source);
        let cid = backup.history.keys().next().unwrap().clone();
        let session = &mut backup.history.get_mut(&cid).unwrap().sessions[0];
        session.kind = PracticeSessionKind::Loop { start_measure: 1, end_measure: 1 };
        let mut context = source.history_context();
        context.passage_bounds = Some(
            panthesia_core::practice_history::PracticePassageBounds {
                start_tick: 120, end_tick: 360,
            },
        );
        let expected = context.passage_bounds;
        session.context = Some(context);
        let decoded = Backup::decode(&backup.encode().unwrap()).unwrap();
        assert_eq!(decoded.history[&cid].sessions[0].context.as_ref().unwrap().passage_bounds,
            expected);
        backup.history.get_mut(&cid).unwrap().sessions[0]
            .context.as_mut().unwrap().passage_bounds.as_mut().unwrap().end_tick = 120;
        assert!(backup.encode().is_err());
    }
    #[test]
    fn time_ledger_v12_roundtrip_filter_idempotence_and_old_backup() {
        let mut source = player();
        let mut b = fixture(&mut source);
        let cid = b.history.keys().next().unwrap().clone();
        b.time_ledger.insert(
            cid.clone(),
            (0..251)
                .map(|i| (format!("ledger-{i}"), time_entry()))
                .collect(),
        );
        assert_eq!(b.version(), 12);
        let decoded = Backup::decode(&b.encode().unwrap()).unwrap();
        assert_eq!(decoded.time_ledger, b.time_ledger);
        assert_eq!(decoded.summary()["timeLedgerEntries"], 251);
        assert_eq!(decoded.summary()["timeLedgerRunningMs"], 251 * 7000);
        assert_eq!(decoded.summary()["timeLedgerUntrackedMs"], 251 * 500);
        let mut dated = decoded.clone();
        dated.created_at = dated.history[&cid].sessions[0].recorded_at_unix_ms + 90 * 86_400_000;
        let recent = selected(
            dated,
            &Selection {
                days: 30,
                ..Selection::default()
            },
        );
        assert!(recent.history.is_empty());
        assert_eq!(recent.time_ledger[&cid].len(), 251);
        assert!(
            selected(
                decoded.clone(),
                &Selection {
                    records: false,
                    ..Selection::default()
                }
            )
            .time_ledger
            .is_empty()
        );
        let mut target = player();
        assert_eq!(
            target
                .apply_practice_backup(recent.clone(), Selection::default(), "keep".into())
                .unwrap()["addedTimeEntries"],
            251
        );
        assert!(target.history.snapshot().is_empty());
        assert_eq!(
            target
                .apply_practice_backup(recent, Selection::default(), "backup".into())
                .unwrap()["addedTimeEntries"],
            0
        );
        assert_eq!(
            target.inspect_practice_backup(&decoded)["timeLedgerDuplicates"],
            251
        );
        let reload = PracticeHistoryStore::load(target.history.path());
        assert_eq!(reload.time_ledger(), &decoded.time_ledger);
        let mut old = decoded.clone();
        old.time_ledger.clear();
        assert!(old.version() <= 11);
        let old = Backup::decode(&old.encode().unwrap()).unwrap();
        assert!(old.time_ledger.is_empty());
        target
            .apply_practice_backup(old, Selection::default(), "keep".into())
            .unwrap();
        assert_eq!(target.history.time_ledger()[&cid].len(), 251);
        let snapshot: Backup = serde_json::from_value(
            target
                .practice_backup_snapshot(&Selection::default())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(snapshot.time_ledger[&cid].len(), 251);
    }
    #[test]
    fn time_ledger_v12_schedule_exceptions_require_new_reader() {
        let mut p = player();
        let mut b = fixture(&mut p);
        assert!(b.time_ledger.is_empty());
        b.routines[0].schedule = Some(crate::routine_commands::RoutineSchedule {
            enabled: true,
            weekdays: vec![1],
            start: "2026-10-01".into(),
            end: None,
            skip_dates: vec!["2026-10-05".into()],
            extra_dates: vec!["2026-10-06".into()],
        });
        assert_eq!(b.version(), 12);
        let restored = Backup::decode(&b.encode().unwrap()).unwrap();
        assert_eq!(
            restored.routines[0].schedule.as_ref().unwrap().skip_dates,
            vec!["2026-10-05"]
        );
        assert_eq!(
            restored.routines[0].schedule.as_ref().unwrap().extra_dates,
            vec!["2026-10-06"]
        );
        b.routines[0].schedule = None;
        b.runs.values_mut().next().unwrap().routine.schedule =
            restored.routines[0].schedule.clone();
        assert_eq!(b.version(), 12);
    }
    #[test]
    fn time_ledger_collision_and_invalid_data_reject_before_writes() {
        let mut p = player();
        let mut b = fixture(&mut p);
        let cid = b.history.keys().next().unwrap().clone();
        b.time_ledger.insert(
            cid.clone(),
            BTreeMap::from([("same-id".into(), time_entry())]),
        );
        p.apply_practice_backup(b.clone(), Selection::default(), "keep".into())
            .unwrap();
        let before = std::fs::read(p.history.path()).unwrap();
        let original = p.history.time_ledger().clone();
        b.time_ledger
            .get_mut(&cid)
            .unwrap()
            .get_mut("same-id")
            .unwrap()
            .untracked_ms += 1;
        assert_eq!(p.inspect_practice_backup(&b)["timeLedgerConflicts"], 1);
        for policy in ["keep", "backup"] {
            assert!(
                p.apply_practice_backup(b.clone(), Selection::default(), policy.into())
                    .is_err()
            );
        }
        assert_eq!(p.history.time_ledger(), &original);
        assert_eq!(std::fs::read(p.history.path()).unwrap(), before);
        let mut invalid = b.clone();
        invalid
            .time_ledger
            .get_mut(&cid)
            .unwrap()
            .get_mut("same-id")
            .unwrap()
            .slices[0]
            .running_ms = 20000;
        assert!(invalid.encode().is_err());
        let mut overflow = b;
        overflow
            .time_ledger
            .get_mut(&cid)
            .unwrap()
            .get_mut("same-id")
            .unwrap()
            .untracked_ms = u64::MAX;
        assert!(overflow.encode().is_err());
    }
    #[test]
    fn pending_round_blocks_backup_before_any_file_changes() {
        let mut p=player();let backup=fixture(&mut p);
        let history=std::fs::read(p.history.path()).unwrap();let prefs=std::fs::read(&p.preferences_path).unwrap();
        let pending=p.data.join("round-save-pending");std::fs::create_dir(&pending).unwrap();std::fs::write(pending.join("intent.json"),b"retained intent").unwrap();
        let error=p.apply_practice_backup(backup,Selection::default(),"backup".into()).unwrap_err();
        assert!(error.contains("上一轮练习结果尚待恢复"));
        assert_eq!(std::fs::read(p.history.path()).unwrap(),history);assert_eq!(std::fs::read(&p.preferences_path).unwrap(),prefs);
        assert_eq!(std::fs::read(pending.join("intent.json")).unwrap(),b"retained intent");assert!(!p.data.join("practice-import-journal.json").exists());
    }
    #[test]
    fn time_ledger_failed_commit_restores_same_history_file() {
        let mut p = player();
        let mut b = fixture(&mut p);
        let cid = b.history.keys().next().unwrap().clone();
        b.time_ledger.insert(
            cid.clone(),
            BTreeMap::from([("before".into(), time_entry())]),
        );
        p.apply_practice_backup(b, Selection::default(), "keep".into())
            .unwrap();
        let before = std::fs::read(p.history.path()).unwrap();
        let mut changed = p.history.clone();
        changed
            .merge_time_ledger(BTreeMap::from([(
                cid.clone(),
                BTreeMap::from([("after".into(), time_entry())]),
            )]))
            .unwrap();
        // Failure occurs after history and preferences have been written, exercising the real journal rollback.
        std::fs::write(
            p.data.join("performance-history"),
            b"block directory creation",
        )
        .unwrap();
        let performances = BTreeMap::from([(format!("{}.json", "a".repeat(64)), b"{}".to_vec())]);
        let workspace = library_workspace::Workspace::load(&p.data).unwrap();
        assert!(
            commit(
                &p.data,
                &p.preferences,
                &changed,
                &workspace,
                None,
                None,
                &performances,
                &BTreeMap::new(),
                None
            )
            .is_err()
        );
        assert_eq!(std::fs::read(p.history.path()).unwrap(), before);
        let restored = PracticeHistoryStore::load(p.history.path());
        assert!(restored.time_ledger()[&cid].contains_key("before"));
        assert!(!restored.time_ledger()[&cid].contains_key("after"));
        assert!(!p.data.join("practice-import-journal.json").exists());
    }
    #[test]
    fn replay_clip_v9_merges_metadata_without_duplicate_records_and_preserves_legacy() {
        use panthesia_core::practice_history::ReplayClip;
        let mut p = player();
        let mut b = fixture(&mut p);
        let cid = b.history.keys().next().unwrap().clone();
        let before = p.history.song(&cid).unwrap().sessions[0].clone();
        let clip = ReplayClip {
            performance_revision: None,
            id: "clip-one".into(),
            name: "左手慢练".into(),
            start: 0.,
            end: 1.,
            notes: "留意转指".into(),
            updated_at_unix_ms: 1,
        };
        p.history
            .set_replay_clips(&cid, "same-id", vec![], vec![clip.clone()])
            .unwrap();
        assert!(p.history.song(&cid).unwrap().sessions[0].same_performance(&before));
        let mut legacy = before.clone();
        legacy.id = None;
        let old_id = legacy.stable_id();
        legacy.replay_clips.push(clip.clone());
        assert_eq!(legacy.stable_id(), old_id);
        b.history.get_mut(&cid).unwrap().sessions[0].replay_clips = vec![
            ReplayClip {
                name: "备份名称".into(),
                ..clip.clone()
            },
            ReplayClip {
                id: "clip-two".into(),
                name: "第二段".into(),
                ..clip.clone()
            },
        ];
        assert_eq!(b.version(), 9);
        let b = Backup::decode(&b.encode().unwrap()).unwrap();
        assert_eq!(b.summary()["replayClips"], 2);
        assert_eq!(p.inspect_practice_backup(&b)["replayClipConflicts"], 1);
        p.apply_practice_backup(b.clone(), Selection::default(), "keep".into())
            .unwrap();
        assert_eq!(p.history.song(&cid).unwrap().sessions.len(), 1);
        assert_eq!(
            p.history.song(&cid).unwrap().sessions[0].replay_clips[0].name,
            "左手慢练"
        );
        assert_eq!(
            p.history.song(&cid).unwrap().sessions[0].replay_clips.len(),
            2
        );
        p.apply_practice_backup(b.clone(), Selection::default(), "backup".into())
            .unwrap();
        assert_eq!(
            p.history.song(&cid).unwrap().sessions[0].replay_clips[0].name,
            "备份名称"
        );
        let mut old = b.clone();
        old.history.get_mut(&cid).unwrap().sessions[0]
            .replay_clips
            .clear();
        p.apply_practice_backup(old, Selection::default(), "backup".into())
            .unwrap();
        assert_eq!(
            p.history.song(&cid).unwrap().sessions[0].replay_clips.len(),
            2
        );
        let mut invalid = b.clone();
        invalid.history.get_mut(&cid).unwrap().sessions[0].replay_clips[0].end = 0.;
        assert!(invalid.encode().is_err());
        let mut collision = b.clone();
        collision.history.get_mut(&cid).unwrap().sessions[0].speed = 0.5;
        p.apply_practice_backup(collision.clone(), Selection::default(), "keep".into())
            .unwrap();
        assert_eq!(p.history.song(&cid).unwrap().sessions.len(), 2);
        collision.history.get_mut(&cid).unwrap().sessions[0].replay_clips[0].name =
            "碰撞后的新名字".into();
        assert_eq!(
            p.inspect_practice_backup(&collision)["replayClipConflicts"],
            1
        );
        p.apply_practice_backup(collision, Selection::default(), "backup".into())
            .unwrap();
        assert_eq!(p.history.song(&cid).unwrap().sessions.len(), 2);
        assert!(
            p.history
                .song(&cid)
                .unwrap()
                .sessions
                .iter()
                .any(|s| s.replay_clips.iter().any(|c| c.name == "碰撞后的新名字"))
        );
        let reload = Player::new(p.data.clone(), PathBuf::from("unused.sf2"), true);
        assert_eq!(reload.history.song(&cid).unwrap().sessions.len(), 2);
    }
    #[test]
    fn measured_time_backup_roundtrip_dedup_and_legacy_unknown() {
        let mut p = player();
        let mut backup = fixture(&mut p);
        let cid = backup.history.keys().next().unwrap().clone();
        backup.history.get_mut(&cid).unwrap().sessions[0].playing_ms = Some(75000);
        let encoded = backup.encode().unwrap();
        let decoded = Backup::decode(&encoded).unwrap();
        assert_eq!(decoded.history[&cid].sessions[0].playing_ms, Some(75000));
        let mut target = player();
        target
            .apply_practice_backup(decoded.clone(), Selection::default(), "keep".into())
            .unwrap();
        target
            .apply_practice_backup(decoded, Selection::default(), "keep".into())
            .unwrap();
        let time = target
            .practice_time(&cid, 0, 9_000_000_000_000_000)
            .unwrap();
        assert_eq!(time["totalMs"], 0);
        assert_eq!(time["timedSessions"], 0);
        assert_eq!(time["legacyTimedMs"], 75000);
        assert_eq!(time["legacySessions"], 1);
        assert_eq!(time["unknownSessions"], 0);
        assert_eq!(target.history.song(&cid).unwrap().sessions.len(), 1);
        backup.history.get_mut(&cid).unwrap().sessions[0].playing_ms = None;
        let old = Backup::decode(&backup.encode().unwrap()).unwrap();
        assert_eq!(old.history[&cid].sessions[0].playing_ms, None);
        target
            .apply_practice_backup(old.clone(), Selection::default(), "backup".into())
            .unwrap();
        assert_eq!(target.history.song(&cid).unwrap().sessions.len(), 1);
        let time = target
            .practice_time(&cid, 0, 9_000_000_000_000_000)
            .unwrap();
        assert_eq!(time["totalMs"], 0);
        assert_eq!(time["timedSessions"], 0);
        assert_eq!(time["legacyTimedMs"], 75000);
        assert_eq!(time["legacySessions"], 1);
        assert_eq!(time["unknownSessions"], 0);
        let mut unknown = player();
        unknown
            .apply_practice_backup(old, Selection::default(), "keep".into())
            .unwrap();
        let time = unknown
            .practice_time(&cid, 0, 9_000_000_000_000_000)
            .unwrap();
        assert_eq!(time["totalMs"], 0);
        assert_eq!(time["legacyTimedMs"], 0);
        assert_eq!(time["legacySessions"], 1);
        assert_eq!(time["unknownSessions"], 1);
        backup.history.get_mut(&cid).unwrap().sessions[0].playing_ms = Some(75000);
        unknown
            .apply_practice_backup(backup.clone(), Selection::default(), "keep".into())
            .unwrap();
        assert_eq!(unknown.history.song(&cid).unwrap().sessions.len(), 1);
        let time = unknown
            .practice_time(&cid, 0, 9_000_000_000_000_000)
            .unwrap();
        assert_eq!(time["totalMs"], 0);
        assert_eq!(time["timedSessions"], 0);
        assert_eq!(time["legacyTimedMs"], 75000);
        assert_eq!(time["legacySessions"], 1);
        assert_eq!(time["unknownSessions"], 0);
        backup.history.get_mut(&cid).unwrap().sessions[0].playing_ms = Some(u64::MAX);
        assert!(backup.encode().is_err());
    }
    #[test]
    fn notes_legacy_identity_conflicts_restart_and_backup_without_duplicate_grades() {
        use panthesia_core::practice_history::PracticeAnnotation;
        let mut p = player();
        let b = fixture(&mut p);
        let cid = b.history.keys().next().unwrap().clone();
        let annotation = PracticeAnnotation {
            note: "练习感受".into(),
            teacher: "手腕放松".into(),
            next: "左手第 3 小节".into(),
            updated_at_unix_ms: 1790960000000,
        };
        let before = p.history.song(&cid).unwrap().sessions[0].clone();
        p.history
            .annotate_session(&cid, "same-id", None, annotation.clone())
            .unwrap();
        assert!(p.history.song(&cid).unwrap().sessions[0].same_performance(&before));
        assert!(
            p.history
                .annotate_session(&cid, "same-id", None, annotation.clone())
                .is_err()
        );
        assert_eq!(
            p.history_query("手腕", "", "", "", 0, 0, 50).unwrap()["total"],
            1
        );
        let mut annotated: Backup =
            serde_json::from_value(p.practice_backup_snapshot(&Selection::default()).unwrap())
                .unwrap();
        annotated.history.get_mut(&cid).unwrap().sessions[0]
            .annotation
            .as_mut()
            .unwrap()
            .teacher = "备份评语".into();
        assert_eq!(
            p.inspect_practice_backup(&annotated)["annotationConflicts"],
            1
        );
        p.apply_practice_backup(annotated.clone(), Selection::default(), "keep".into())
            .unwrap();
        assert_eq!(p.history.song(&cid).unwrap().sessions.len(), 1);
        assert_eq!(
            p.history.song(&cid).unwrap().sessions[0]
                .annotation
                .as_ref()
                .unwrap()
                .teacher,
            "手腕放松"
        );
        p.apply_practice_backup(annotated, Selection::default(), "backup".into())
            .unwrap();
        assert_eq!(p.history.song(&cid).unwrap().sessions.len(), 1);
        assert_eq!(
            p.history.song(&cid).unwrap().sessions[0]
                .annotation
                .as_ref()
                .unwrap()
                .teacher,
            "备份评语"
        );
        let mut collision = b.clone();
        let extra = &mut collision.history.get_mut(&cid).unwrap().sessions[0];
        extra.summary.overall.wrong_notes = 1;
        extra.annotation = Some(annotation.clone());
        p.apply_practice_backup(collision.clone(), Selection::default(), "keep".into())
            .unwrap();
        collision.history.get_mut(&cid).unwrap().sessions[0]
            .annotation
            .as_mut()
            .unwrap()
            .teacher = "碰撞记录改评语".into();
        p.apply_practice_backup(collision.clone(), Selection::default(), "backup".into())
            .unwrap();
        p.apply_practice_backup(collision, Selection::default(), "backup".into())
            .unwrap();
        assert_eq!(p.history.song(&cid).unwrap().sessions.len(), 2);
        assert_eq!(
            p.history.song(&cid).unwrap().sessions[1]
                .annotation
                .as_ref()
                .unwrap()
                .teacher,
            "碰撞记录改评语"
        );
        let mut legacy = before.clone();
        legacy.id = None;
        let id = legacy.stable_id();
        p.history
            .record_session("legacy-song", "旧记录", legacy)
            .unwrap();
        p.history
            .annotate_session("legacy-song", &id, None, annotation)
            .unwrap();
        assert_eq!(
            p.history.song("legacy-song").unwrap().sessions[0].stable_id(),
            id
        );
        let loaded = PracticeHistoryStore::load(p.history.path().to_path_buf());
        assert_eq!(
            loaded.song(&cid).unwrap().sessions[0]
                .annotation
                .as_ref()
                .unwrap()
                .teacher,
            "备份评语"
        );
        assert_eq!(
            loaded.song("legacy-song").unwrap().sessions[0].stable_id(),
            id
        );
    }
    #[test]
    fn archive_merge_conflicts_and_plan_calibration() {
        let mut source = player();
        let b = fixture(&mut source);
        b.validate().unwrap();
        let bytes = b.encode().unwrap();
        let decoded = Backup::decode(&bytes).unwrap();
        assert_eq!(decoded.summary(), b.summary());
        let mut target = player();
        target.state.latency = 32;
        target.preferences.input = Some("local keyboard".into());
        target
            .apply_practice_backup(decoded.clone(), Selection::default(), "keep".into())
            .unwrap();
        assert_eq!(target.preferences.routines[0].items[0].settings.latency, 32);
        assert_eq!(target.preferences.input.as_deref(), Some("local keyboard"));
        assert_eq!(
            target
                .history
                .snapshot()
                .values()
                .next()
                .unwrap()
                .sessions
                .len(),
            1
        );
        target.preferences.routines[0].name = "本地安排".into();
        let result = target
            .apply_practice_backup(decoded.clone(), Selection::default(), "keep".into())
            .unwrap();
        assert_eq!(target.preferences.routines[0].name, "本地安排");
        assert_eq!(result["duplicateRecords"], 1);
        target
            .apply_practice_backup(decoded.clone(), Selection::default(), "backup".into())
            .unwrap();
        assert_eq!(target.preferences.routines[0].name, "迁移日课");
        assert_eq!(
            target
                .preferences
                .routine_runs
                .values()
                .next()
                .unwrap()
                .progress
                .values()
                .next()
                .unwrap()
                .completed,
            true
        );
        let mut changed = decoded;
        changed.history.values_mut().next().unwrap().sessions[0]
            .summary
            .overall
            .matched_notes = 8;
        let result = target
            .apply_practice_backup(changed, Selection::default(), "backup".into())
            .unwrap();
        assert_eq!(result["renamedRecords"], 1);
        assert_eq!(
            target
                .history
                .snapshot()
                .values()
                .next()
                .unwrap()
                .sessions
                .len(),
            2
        );
        let run = target.preferences.routine_runs.values().next().unwrap();
        assert!(run.progress.values().next().unwrap().session_ids[0].starts_with("import-"));
        let disk = PracticeHistoryStore::load(target.data.join("web-practice-history.ron"));
        assert_eq!(disk.snapshot(), target.history.snapshot());
    }
    #[test]
    fn malformed_archives_and_active_import_do_not_change_data() {
        let mut p = player();
        let b = fixture(&mut p);
        let before = p.preferences.routines[0].name.clone();
        p.state.status = "playing".into();
        assert!(
            p.apply_practice_backup(b.clone(), Selection::default(), "backup".into())
                .is_err()
        );
        assert_eq!(p.preferences.routines[0].name, before);
        let mut invalid = b.clone();
        invalid.routines[0].items[0].settings.latency = i32::MIN;
        assert!(invalid.validate().is_err());
        let mut corrupt = b.encode().unwrap();
        corrupt[0] = 0;
        assert!(Backup::decode(&corrupt).is_err());
        let mut invalid = b;
        invalid.runs.values_mut().next().unwrap().day = "2026-02-31".into();
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn metadata_templates_back_up_merge_and_roll_back_with_old_versions() {
        let source = player();
        let rules: crate::metadata_templates::Rules =
            serde_json::from_value(json!({"notes":{"mode":"append","value":"备份提示"},
                "subtitle":{"mode":"set","value":"新版模板副标题"}})).unwrap();
        crate::metadata_templates::update(&source.data, "课堂".into(), Some(rules.clone()), 0)
            .unwrap();
        let selection = Selection {
            plans: false,
            records: false,
            presets: true,
            days: 0,
        };
        let backup: Backup =
            serde_json::from_value(source.practice_backup_snapshot(&selection).unwrap()).unwrap();
        assert_eq!(backup.version(), 19);
        assert_eq!(backup.metadata_templates.len(), 1);
        let decoded = Backup::decode(&backup.encode().unwrap()).unwrap();
        assert_eq!(decoded.metadata_templates, backup.metadata_templates);
        let excluded = selected(
            backup.clone(),
            &Selection {
                presets: false,
                ..Selection::default()
            },
        );
        assert!(excluded.metadata_templates.is_empty());
        let mut target = player();
        let local_rules: crate::metadata_templates::Rules =
            serde_json::from_value(json!({"notes":{"mode":"append","value":"本地提示"}})).unwrap();
        crate::metadata_templates::update(
            &target.data,
            "课堂".into(),
            Some(local_rules.clone()),
            0,
        )
        .unwrap();
        assert_eq!(
            target.inspect_practice_backup(&decoded)["presetConflicts"],
            1
        );
        target
            .apply_practice_backup(decoded.clone(), selection.clone(), "keep".into())
            .unwrap();
        assert_eq!(
            crate::metadata_templates::snapshot_unlocked(&target.data).unwrap()["课堂"],
            local_rules
        );
        target
            .apply_practice_backup(decoded.clone(), selection.clone(), "backup".into())
            .unwrap();
        assert_eq!(
            crate::metadata_templates::snapshot_unlocked(&target.data).unwrap()["课堂"],
            rules
        );
        let path = target.data.join("metadata-templates.json");
        let original = std::fs::read(&path).unwrap();
        let folder = "restore-template-test";
        let restore = target.data.join("practice-restore-points").join(folder);
        std::fs::create_dir_all(&restore).unwrap();
        std::fs::write(restore.join("metadata-templates.json"), &original).unwrap();
        std::fs::write(&path, b"partial new templates").unwrap();
        let journal = Journal {
            performances: BTreeMap::new(),
            metadata_histories: BTreeMap::new(),
            pending_metadata_history: None,
            folder: folder.into(),
            prefs: false,
            history: false,
            workspace: None,
            repertoire: None,
            templates: Some(true),
            committed: false,
        };
        std::fs::write(
            target.data.join("practice-import-journal.json"),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        recover(&target.data).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let old = Backup::default();
        assert_eq!(Backup::decode(&old.encode().unwrap()).unwrap().version(), 1);
        target
            .apply_practice_backup(old, selection.clone(), "backup".into())
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let mut invalid = backup;
        invalid
            .metadata_templates
            .get_mut("课堂")
            .unwrap()
            .get_mut("notes")
            .unwrap()
            .mode = "invalid".into();
        assert!(invalid.encode().is_err());
        std::fs::write(&path, b"broken").unwrap();
        assert!(
            target
                .apply_practice_backup(decoded, selection, "backup".into())
                .is_err()
        );
        assert_eq!(std::fs::read(path).unwrap(), b"broken");
    }

    fn add_performance(p: &Player, b: &mut Backup, velocity: u8) {
        let cid = b.history.keys().next().unwrap().clone();
        let id = session_key(&b.history[&cid].sessions[0]);
        let a:crate::performance_archive::Archive=serde_json::from_value(json!({
            "version":1,"contentId":cid,"id":id,"duration":1.,"truncated":false,
            "inputs":[{"at":0.1,"judgedAt":0.08,"songTime":0.1,"bytes":[144,60,velocity],"synthetic":false},{"at":0.8,"judgedAt":0.78,"songTime":0.8,"bytes":[128,60,0],"synthetic":false}],
            "references":[{"at":0.,"end":1.,"pitch":60,"velocity":90,"measure":1,"songTime":0.,"track":0}],
            "referencePedals":[{"at":0.2,"judgedAt":0.2,"songTime":0.2,"bytes":[176,64,100],"synthetic":false}]
        })).unwrap();
        let path = crate::performance_archive::path(&p.data, &cid, &id);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, a.bytes().unwrap()).unwrap();
        b.performances.entry(cid).or_default().insert(id, a);
    }
    #[test]
    fn performances_roundtrip_conflicts_remap_date_scope_and_restart() {
        let mut source = player();
        let mut b = fixture(&mut source);
        add_performance(&source, &mut b, 83);
        let cid = b.history.keys().next().unwrap().clone();
        let snapshot: Backup = serde_json::from_value(
            source
                .practice_backup_snapshot(&Selection::default())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(snapshot.version(), 6);
        assert_eq!(snapshot.summary()["performances"], 1);
        let decoded = Backup::decode(&snapshot.encode().unwrap()).unwrap();
        let mut target = player();
        let result = target
            .apply_practice_backup(decoded.clone(), Selection::default(), "keep".into())
            .unwrap();
        assert_eq!(result["importedPerformances"], 1);
        assert_eq!(
            target.history_performance(&cid, "same-id").unwrap()["inputs"][0]["bytes"][2],
            83
        );
        assert_eq!(
            target
                .apply_practice_backup(decoded.clone(), Selection::default(), "keep".into())
                .unwrap()["duplicatePerformances"],
            1
        );
        let mut changed = decoded.clone();
        changed
            .performances
            .get_mut(&cid)
            .unwrap()
            .get_mut("same-id")
            .unwrap()
            .inputs[0]
            .bytes[2] = 99;
        assert_eq!(
            target.inspect_practice_backup(&changed)["performanceConflicts"],
            1
        );
        assert_eq!(
            target
                .apply_practice_backup(changed.clone(), Selection::default(), "keep".into())
                .unwrap()["keptPerformances"],
            1
        );
        assert_eq!(
            target.history_performance(&cid, "same-id").unwrap()["inputs"][0]["bytes"][2],
            83
        );
        assert_eq!(
            target
                .apply_practice_backup(changed.clone(), Selection::default(), "backup".into())
                .unwrap()["replacedPerformances"],
            1
        );
        let mut collision = decoded.clone();
        collision.history.get_mut(&cid).unwrap().sessions[0]
            .summary
            .overall
            .wrong_notes = 3;
        assert_eq!(
            target
                .apply_practice_backup(collision.clone(), Selection::default(), "keep".into())
                .unwrap()["renamedRecords"],
            1
        );
        let renamed = target
            .history
            .song(&cid)
            .unwrap()
            .sessions
            .iter()
            .find(|s| s.stable_id() != "same-id")
            .unwrap()
            .stable_id();
        assert_eq!(
            target.history_performance(&cid, &renamed).unwrap()["id"],
            renamed
        );
        assert_eq!(
            target.history_performance(&cid, &renamed).unwrap()["inputs"][0]["bytes"][2],
            83
        );
        assert_eq!(
            target
                .apply_practice_backup(collision, Selection::default(), "keep".into())
                .unwrap()["duplicatePerformances"],
            1
        );
        let restarted = Player::new(target.data.clone(), PathBuf::from("unused.sf2"), true);
        assert_eq!(
            restarted.history_performance(&cid, "same-id").unwrap()["inputs"][0]["bytes"][2],
            99
        );
        assert!(
            selected(
                decoded.clone(),
                &Selection {
                    records: false,
                    ..Selection::default()
                }
            )
            .performances
            .is_empty()
        );
        let mut dated = decoded.clone();
        dated.created_at = dated.history[&cid].sessions[0].recorded_at_unix_ms + 90 * 86400000;
        assert!(
            selected(
                dated,
                &Selection {
                    days: 30,
                    ..Selection::default()
                }
            )
            .performances
            .is_empty()
        );
        let mut orphan = decoded.clone();
        orphan.history.clear();
        assert!(orphan.encode().is_err());
        let mut wrong = decoded;
        wrong.performances.get_mut(&cid).unwrap().insert(
            "wrong-id".into(),
            changed.performances[&cid]["same-id"].clone(),
        );
        assert!(wrong.encode().is_err());
        let path = crate::performance_archive::path(&target.data, &cid, "same-id");
        std::fs::write(&path, b"broken").unwrap();
        assert_eq!(
            target.inspect_practice_backup(&changed)["performanceErrors"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(
            target
                .apply_practice_backup(changed.clone(), Selection::default(), "keep".into())
                .is_err()
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"broken");
        assert_eq!(
            target
                .apply_practice_backup(changed, Selection::default(), "backup".into())
                .unwrap()["replacedPerformances"],
            1
        );
    }
    #[test]
    fn interrupted_import_restores_existing_and_removes_new_performances() {
        let mut p = player();
        let mut b = fixture(&mut p);
        add_performance(&p, &mut b, 83);
        let cid = b.history.keys().next().unwrap();
        let path = crate::performance_archive::path(&p.data, cid, "same-id");
        let original = std::fs::read(&path).unwrap();
        let new_path = crate::performance_archive::path(&p.data, cid, "new-id");
        let restore = p
            .data
            .join("practice-restore-points/restore-performance-test/performance-history");
        std::fs::create_dir_all(&restore).unwrap();
        std::fs::write(restore.join(path.file_name().unwrap()), &original).unwrap();
        std::fs::write(&path, b"partial").unwrap();
        std::fs::write(&new_path, b"new").unwrap();
        let j = Journal {
            folder: "restore-performance-test".into(),
            metadata_histories: BTreeMap::new(),
            pending_metadata_history: None,
            prefs: false,
            history: false,
            workspace: None,
            repertoire: None,
            templates: None,
            committed: false,
            performances: BTreeMap::from([
                (path.file_name().unwrap().to_str().unwrap().into(), true),
                (
                    new_path.file_name().unwrap().to_str().unwrap().into(),
                    false,
                ),
            ]),
        };
        std::fs::write(
            p.data.join("practice-import-journal.json"),
            serde_json::to_vec(&j).unwrap(),
        )
        .unwrap();
        recover(&p.data).unwrap();
        assert_eq!(std::fs::read(path).unwrap(), original);
        assert!(!new_path.exists());
    }
    #[test]
    fn interrupted_transaction_restores_both_files() {
        let mut p = player();
        fixture(&mut p);
        p.preferences.save(&p.preferences_path).unwrap();
        p.history.save().unwrap();
        let old_prefs = std::fs::read(&p.preferences_path).unwrap();
        let old_history = std::fs::read(p.history.path()).unwrap();
        let folder = "restore-test";
        let restore = p.data.join("practice-restore-points").join(folder);
        std::fs::create_dir_all(&restore).unwrap();
        std::fs::write(restore.join("web-preferences.json"), &old_prefs).unwrap();
        std::fs::write(restore.join("web-practice-history.ron"), &old_history).unwrap();
        std::fs::write(&p.preferences_path, b"partial new preferences").unwrap();
        let journal = Journal {
            performances: BTreeMap::new(),
            metadata_histories: BTreeMap::new(),
            pending_metadata_history: None,
            folder: folder.into(),
            prefs: true,
            history: true,
            workspace: None,
            repertoire: None,
            templates: None,
            committed: false,
        };
        std::fs::write(
            p.data.join("practice-import-journal.json"),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        recover(&p.data).unwrap();
        assert_eq!(std::fs::read(&p.preferences_path).unwrap(), old_prefs);
        assert_eq!(std::fs::read(p.history.path()).unwrap(), old_history);
        assert!(!p.data.join("practice-import-journal.json").exists());
    }
    #[test]
    fn metadata_history_moves_by_content_and_survives_reopen_without_duplicates() {
        let source = player();
        let source_path = source.data.join("original.mid");
        std::fs::create_dir_all(&source.data).unwrap();
        std::fs::write(&source_path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let mut source_workspace = library_workspace::Workspace::default();
        let cid = source_workspace
            .inspect(source_path.clone(), true)
            .unwrap()
            .content_id
            .unwrap();
        source_workspace.save(&source.data).unwrap();
        let mut before = panthesia_core::library::SongMetadata::default();
        let mut after = before.clone();
        after.title = Some("迁移前的标题".into());
        let id = crate::metadata_history::prepare(
            &source.data,
            &source_path,
            &cid,
            before.clone(),
            after.clone(),
            None,
        )
        .unwrap();
        crate::metadata_history::finish(&source.data, &source_path, &id, true).unwrap();
        before = after;
        after = before.clone();
        after.notes = Some("第二次修改".into());
        let id2 =
            crate::metadata_history::prepare(&source.data, &source_path, &cid, before, after, None)
                .unwrap();
        crate::metadata_history::finish(&source.data, &source_path, &id2, true).unwrap();
        let backup: Backup = serde_json::from_value(
            source
                .practice_backup_snapshot(&Selection::default())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(backup.version(), 13);
        let backup = Backup::decode(&backup.encode().unwrap()).unwrap();
        assert_eq!(backup.summary()["metadataHistory"], 2);
        let mut target = player();
        std::fs::create_dir_all(&target.data).unwrap();
        let target_path = target.data.join("moved.mid");
        std::fs::write(&target_path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let mut target_workspace = library_workspace::Workspace::default();
        target_workspace.inspect(target_path.clone(), true).unwrap();
        target_workspace.save(&target.data).unwrap();
        assert_eq!(
            target.inspect_practice_backup(&backup)["metadataHistoryAdded"],
            2
        );
        let first = target
            .apply_practice_backup(backup.clone(), Selection::default(), "keep".into())
            .unwrap();
        assert_eq!(first["metadataHistoryAdded"], 2);
        assert_eq!(first["metadataHistoryUnmatched"], 0);
        let second = target
            .apply_practice_backup(backup.clone(), Selection::default(), "keep".into())
            .unwrap();
        assert_eq!(second["metadataHistoryAdded"], 0);
        assert_eq!(second["metadataHistoryDuplicates"], 2);
        let reopened = Player::new(target.data.clone(), PathBuf::from("unused.sf2"), true);
        assert_eq!(crate::metadata_history::inspect(&reopened.data, &target_path, &cid, None).unwrap()["records"].as_array().unwrap().len(), 2);
        assert_eq!(
            crate::metadata_history::record(&reopened.data, &target_path, &cid, &id)
                .unwrap()
                .state,
            "applied"
        );
        let duplicate_path = target.data.join("duplicate.mid");
        std::fs::copy(&target_path, &duplicate_path).unwrap();
        let mut indexed = library_workspace::Workspace::load(&target.data).unwrap();
        indexed.inspect(duplicate_path, true).unwrap();
        indexed.save(&target.data).unwrap();
        assert_eq!(
            reopened.inspect_practice_backup(&backup)["metadataHistoryAmbiguous"],
            2
        );
        let mut broken = backup;
        broken.metadata_history[0].records[0].id = "invalid".into();
        assert!(broken.encode().is_err());
    }
    #[test]
    fn metadata_history_rejects_replaced_content_and_corrupt_local_journal() {
        let source = player();
        std::fs::create_dir_all(&source.data).unwrap();
        let source_path = source.data.join("piece.mid");
        std::fs::write(&source_path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let mut indexed = library_workspace::Workspace::default();
        let cid = indexed
            .inspect(source_path.clone(), true)
            .unwrap()
            .content_id
            .unwrap();
        indexed.save(&source.data).unwrap();
        let mut after = panthesia_core::library::SongMetadata::default();
        after.title = Some("原曲".into());
        let id = crate::metadata_history::prepare(
            &source.data,
            &source_path,
            &cid,
            Default::default(),
            after,
            None,
        )
        .unwrap();
        crate::metadata_history::finish(&source.data, &source_path, &id, true).unwrap();
        let backup: Backup = serde_json::from_value(
            source
                .practice_backup_snapshot(&Selection::default())
                .unwrap(),
        )
        .unwrap();
        let source_journal = source.data.join("metadata-history").join(format!(
            "{}.json",
            blake3::hash(library_workspace::key(&source_path).as_bytes())
        ));
        let verified_source = std::fs::read(&source_journal).unwrap();
        std::fs::write(&source_journal, b"broken").unwrap();
        assert!(
            source
                .practice_backup_snapshot(&Selection::default())
                .is_err()
        );
        std::fs::write(&source_journal, verified_source).unwrap();
        let mut target = player();
        std::fs::create_dir_all(&target.data).unwrap();
        let target_path = target.data.join("piece.mid");
        std::fs::write(&target_path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let mut local = library_workspace::Workspace::default();
        local.inspect(target_path.clone(), true).unwrap();
        local.save(&target.data).unwrap();
        std::fs::write(&target_path, include_bytes!("../assets/basic-chords.mid")).unwrap();
        assert_eq!(
            target.inspect_practice_backup(&backup)["metadataHistoryUnmatched"],
            1
        );
        assert_eq!(
            target
                .apply_practice_backup(backup.clone(), Selection::default(), "keep".into())
                .unwrap()["metadataHistoryAdded"],
            0
        );
        assert!(crate::metadata_history::inspect(&target.data, &target_path, &cid, None).unwrap()["records"].as_array().unwrap().is_empty());
        std::fs::write(&target_path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let journal_path = target.data.join("metadata-history").join(format!(
            "{}.json",
            blake3::hash(library_workspace::key(&target_path).as_bytes())
        ));
        std::fs::create_dir_all(journal_path.parent().unwrap()).unwrap();
        std::fs::write(&journal_path, b"broken").unwrap();
        assert!(
            target.inspect_practice_backup(&backup)["metadataHistoryError"]
                .as_str()
                .is_some()
        );
        assert!(
            target
                .apply_practice_backup(backup, Selection::default(), "backup".into())
                .is_err()
        );
        assert_eq!(std::fs::read(journal_path).unwrap(), b"broken");
    }
    #[test]
    fn unmatched_metadata_history_is_saved_and_claimed_after_song_is_indexed() {
        let source = player();
        std::fs::create_dir_all(&source.data).unwrap();
        let source_path = source.data.join("source.mid");
        std::fs::write(&source_path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let mut source_workspace = library_workspace::Workspace::default();
        let cid = source_workspace
            .inspect(source_path.clone(), true)
            .unwrap()
            .content_id
            .unwrap();
        source_workspace.save(&source.data).unwrap();
        let mut after = panthesia_core::library::SongMetadata::default();
        after.notes = Some("保存的课堂提示".into());
        let id = crate::metadata_history::prepare(
            &source.data,
            &source_path,
            &cid,
            Default::default(),
            after,
            None,
        )
        .unwrap();
        crate::metadata_history::finish(&source.data, &source_path, &id, true).unwrap();
        let backup: Backup = serde_json::from_value(
            source
                .practice_backup_snapshot(&Selection::default())
                .unwrap(),
        )
        .unwrap();
        let mut target = player();
        assert_eq!(
            target
                .apply_practice_backup(backup.clone(), Selection::default(), "keep".into())
                .unwrap()["metadataHistoryPendingAdded"],
            1
        );
        assert_eq!(
            target
                .apply_practice_backup(backup, Selection::default(), "keep".into())
                .unwrap()["metadataHistoryPendingAdded"],
            0
        );
        let target_path = target.data.join("later.mid");
        std::fs::write(&target_path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let mut workspace = library_workspace::Workspace::load(&target.data).unwrap();
        workspace.inspect(target_path.clone(), true).unwrap();
        workspace.save(&target.data).unwrap();
        let mut reopened = library_workspace::Workspace::load(&target.data).unwrap();
        let rows = crate::metadata_history::pending_rows(&target.data, &mut reopened).unwrap();
        assert_eq!(rows["rows"][0]["candidates"].as_array().unwrap().len(), 1);
        let changed_path = target.data.join("wrong.mid");
        std::fs::write(&changed_path, include_bytes!("../assets/basic-chords.mid")).unwrap();
        reopened.inspect(changed_path.clone(), true).unwrap();
        assert!(
            crate::metadata_history::claim_pending(
                &target.data,
                &mut reopened,
                &source_path,
                &cid,
                &changed_path
            )
            .is_err()
        );
        assert_eq!(
            crate::metadata_history::claim_pending(
                &target.data,
                &mut reopened,
                &source_path,
                &cid,
                &target_path
            )
            .unwrap()["added"],
            1
        );
        assert!(
            crate::metadata_history::pending_rows(&target.data, &mut reopened).unwrap()["rows"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            crate::metadata_history::record(&target.data, &target_path, &cid, &id)
                .unwrap()
                .state,
            "applied"
        );
        let mut reopened_again = library_workspace::Workspace::load(&target.data).unwrap();
        assert!(crate::metadata_history::pending_rows(&target.data,&mut reopened_again).unwrap()["rows"].as_array().unwrap().is_empty());
    }
    #[test]
    fn metadata_history_recovery_restores_existing_and_removes_new_files() {
        let p = player();
        std::fs::create_dir_all(p.data.join("metadata-history")).unwrap();
        let old = format!("{}.json", "a".repeat(64));
        let new = format!("{}.json", "b".repeat(64));
        let restore = p
            .data
            .join("practice-restore-points/restore-metadata-test/metadata-history");
        std::fs::create_dir_all(&restore).unwrap();
        std::fs::write(restore.join(&old), b"original").unwrap();
        std::fs::write(
            restore
                .parent()
                .unwrap()
                .join("pending-metadata-history.json"),
            b"saved pending",
        )
        .unwrap();
        std::fs::write(
            p.data.join("pending-metadata-history.json"),
            b"partial pending",
        )
        .unwrap();
        std::fs::write(p.data.join("metadata-history").join(&old), b"partial").unwrap();
        std::fs::write(p.data.join("metadata-history").join(&new), b"new").unwrap();
        let journal = Journal {
            folder: "restore-metadata-test".into(),
            prefs: false,
            history: false,
            workspace: None,
            repertoire: None,
            templates: None,
            pending_metadata_history: Some(true),
            committed: false,
            performances: BTreeMap::new(),
            metadata_histories: BTreeMap::from([(old.clone(), true), (new.clone(), false)]),
        };
        std::fs::write(
            p.data.join("practice-import-journal.json"),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        recover(&p.data).unwrap();
        assert_eq!(
            std::fs::read(p.data.join("pending-metadata-history.json")).unwrap(),
            b"saved pending"
        );
        assert_eq!(
            std::fs::read(p.data.join("metadata-history").join(old)).unwrap(),
            b"original"
        );
        assert!(!p.data.join("metadata-history").join(new).exists());
    }
}

// An internally tagged command buffers map keys as strings. Re-enter the JSON
// deserializer here so nested numeric track/part maps keep their normal semantics.
pub(crate) fn deserialize_command_backup<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Backup, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    serde_json::from_value(value).map_err(serde::de::Error::custom)
}
