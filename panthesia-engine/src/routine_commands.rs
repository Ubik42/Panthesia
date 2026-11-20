use super::*;
use preferences::{LadderPreset, LadderRun, SessionSettings};
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoutineGoal {
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub expression:Option<crate::expression_goal::ExpressionGoal>,
    pub passes: u16,
    pub accuracy: u8,
    pub on_time: Option<u8>,
    pub consecutive: bool,
    pub attempt_limit: u16,
}
impl RoutineGoal {
    pub(super) fn validate(&self, mode: &str) -> Result<(), String> {
        if !(1..=100).contains(&self.passes)
            || !(50..=100).contains(&self.accuracy)
            || !(1..=500).contains(&self.attempt_limit)
            || self.on_time.is_some_and(|v| !(50..=100).contains(&v))
        {
            return Err("达标次数需 1～100，正确率/准时率需 50%～100%，轮数上限需 1～500".into());
        }
        if mode == "wait" && self.on_time.is_some() {
            return Err("等音不评价准时率，请关闭准时率要求".into());
        }
        if let Some(e)=&self.expression{e.validate(mode)?;}
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase")]
pub struct PassageSequenceEntry {pub id:String,pub copies:u8,#[serde(default,skip_serializing_if="Option::is_none")]pub content_id:Option<String>}
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RoutineTarget {
    Whole,
    Passage { start: usize, end: usize },
    PrecisePassage {range:crate::tick_ranges::TickRange},
    ScorePassage { range: crate::score_ranges::ScoreRange },
    Ladder { preset: LadderPreset },
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineItem {
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub practice:Option<panthesia_core::song_project::PracticeEdition>,
    pub id: String,
    pub title: String,
    pub notes: String,
    pub content_id: String,
    pub song_title: String,
    pub path: Option<PathBuf>,
    pub exercise: Option<ExerciseSpec>,
    pub grid: String,
    pub scope: String,
    pub settings: SessionSettings,
    pub speed: f64,
    pub target: RoutineTarget,
    pub goal: RoutineGoal,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineSchedule {
    pub enabled: bool,
    pub weekdays: Vec<u8>,
    pub start: String,
    pub end: Option<String>,
    #[serde(default)]
    pub skip_dates: Vec<String>,
    #[serde(default)]
    pub extra_dates: Vec<String>,
}
impl RoutineSchedule {
    pub(super) fn validate(&self) -> Result<(), String> {
        if !day_valid(&self.start)
            || self
                .end
                .as_ref()
                .is_some_and(|d| !day_valid(d) || d < &self.start)
            || self.weekdays.is_empty()
            || self.weekdays.len() > 7
            || self.weekdays.iter().any(|d| *d > 6)
            || self
                .weekdays
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != self.weekdays.len()
        {
            return Err("周期安排需要有效日期及不重复的星期；结束日期不能早于开始日期".into());
        }
        for dates in [&self.skip_dates, &self.extra_dates] {
            if dates.len() > 366
                || dates.iter().any(|day| {
                    !day_valid(day)
                        || day.as_str() < self.start.as_str()
                        || self.end.as_ref().is_some_and(|end| day > end)
                })
                || dates.iter().collect::<std::collections::BTreeSet<_>>().len() != dates.len()
            {
                return Err("例外日期需要在周期范围内，不能重复，且每类最多 366 天".into());
            }
        }
        if self.skip_dates.iter().any(|day| self.extra_dates.contains(day)) {
            return Err("同一天不能同时设为跳过和加练".into());
        }
        Ok(())
    }
    pub(super) fn matches(&self, day: &str) -> bool {
        self.enabled
            && day_valid(day)
            && day >= self.start.as_str()
            && self.end.as_ref().is_none_or(|d| day <= d.as_str())
            && !self.skip_dates.iter().any(|date| date == day)
            && (self.extra_dates.iter().any(|date| date == day)
                || self.weekdays.contains(&weekday(day)))
    }
}
// Gregorian calendar: Monday = 0, Sunday = 6. Dates are validated before use.
fn weekday(day: &str) -> u8 {
    let mut y: i32 = day[..4].parse().unwrap();
    let m: usize = day[5..7].parse().unwrap();
    let d: i32 = day[8..10].parse().unwrap();
    if m < 3 {
        y -= 1;
    }
    let sunday =
        (y + y / 4 - y / 100 + y / 400 + [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4][m - 1] + d) % 7;
    ((sunday + 6) % 7) as u8
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeRoutine {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<RoutineSchedule>,
    pub id: String,
    pub name: String,
    pub notes: String,
    pub items: Vec<RoutineItem>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineProgress {
    pub passed: u16,
    pub attempts: u16,
    pub batch_attempts: u16,
    pub streak: u16,
    pub completed: bool,
    pub skipped: bool,
    pub limited: bool,
    pub last_result: String,
    pub best_accuracy: Option<f32>,
    pub session_ids: Vec<String>,
    pub ladder: Option<panthesia_core::speed_ladder::SpeedLadderProgress>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineRun {
    pub day: String,
    pub routine: PracticeRoutine,
    pub progress: BTreeMap<String, RoutineProgress>,
    pub last_item: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RoutineKind { Whole, Passage, Ladder }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineState {
    pub routine_id: String,
    pub day: String,
    pub item_id: String,
    pub title: String,
    pub item_title: String,
    pub notes: String,
    pub index: usize,
    pub total: usize,
    pub kind: RoutineKind,
    pub goal: RoutineGoal,
    pub progress: RoutineProgress,
    pub next_item_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineList {
    pub versions: Vec<crate::routine_protocol::RoutineVersion>,
    pub plans: preferences::Shared<Vec<PracticeRoutine>>,
    pub runs: Vec<RoutineRun>,
    pub due: Vec<String>,
    pub active: Option<RoutineState>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineSummary { pub id: String, pub name: String }

#[derive(Clone)]
pub(super) struct ActiveRoutine {
    pub routine_id: String,
    pub day: String,
    pub item: RoutineItem,
}
pub(super) fn run_key(id: &str, day: &str) -> String {
    format!("{id}:{day}")
}
fn new_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}
pub(super) fn day_valid(day: &str) -> bool {
    let parts = day.split('-').collect::<Vec<_>>();
    if parts.len() != 3 || day.len() != 10 {
        return false;
    }
    let (Ok(y), Ok(m), Ok(d)) = (
        parts[0].parse::<u32>(),
        parts[1].parse::<usize>(),
        parts[2].parse::<u32>(),
    ) else {
        return false;
    };
    if !(2000..=2200).contains(&y) || !(1..=12).contains(&m) {
        return false;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    d >= 1 && d <= days[m - 1]
}
impl Player {
    fn ensure_routine_day(&mut self, id: &str, day: &str) -> Result<(), String> {
        if !day_valid(day) {
            return Err("日期无效".into());
        }
        let key = run_key(id, day);
        if !self.preferences.routine_runs.contains_key(&key) {
            let routine = self
                .preferences
                .routines
                .iter()
                .find(|r| r.id == id)
                .cloned()
                .ok_or("常用计划已移除，无法创建当天安排")?;
            self.preferences.routine_runs.insert(
                key,
                RoutineRun {
                    day: day.into(),
                    routine,
                    progress: BTreeMap::new(),
                    last_item: None,
                },
            );
        }
        Ok(())
    }
    pub(super) fn routine_editable(&self, id: &str, day: Option<&str>) -> Result<(), String> {
        if self
            .routine
            .as_ref()
            .is_some_and(|a| a.routine_id == id && Some(a.day.as_str()) == day)
        {
            return Err("请先结束正在练习的项目，再修改当天安排".into());
        }
        Ok(())
    }
    pub(super) fn routine_target_mut(
        &mut self,
        id: &str,
        day: Option<&str>,
    ) -> Result<&mut PracticeRoutine, String> {
        self.routine_editable(id, day)?;
        if let Some(day) = day {
            self.ensure_routine_day(id, day)?;
            Ok(&mut self
                .preferences
                .routine_runs
                .get_mut(&run_key(id, day))
                .unwrap()
                .routine)
        } else {
            self.preferences
                .routines
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or("计划不存在".into())
        }
    }
    pub(super) fn routines(&mut self, day: &str) -> Result<Value, String> {
        if !day_valid(day) {
            return Err("日期无效".into());
        }
        let due: Vec<_> = self
            .preferences
            .routines
            .iter()
            .filter(|r| !r.items.is_empty() && r.schedule.as_ref().is_some_and(|s| s.matches(day)))
            .map(|r| r.id.clone())
            .collect();
        let missing: Vec<_> = due
            .iter()
            .filter(|id| {
                !self
                    .preferences
                    .routine_runs
                    .contains_key(&run_key(id, day))
            })
            .cloned()
            .collect();
        if self.preferences.routine_runs.len() + missing.len() > 10000 {
            return Err("日期安排已到容量上限".into());
        }
        if !missing.is_empty() {
            let previous = self.preferences.routine_runs.clone();
            for id in &missing {
                self.ensure_routine_day(id, day)?;
            }
            if let Err(e) = self.persist() {
                self.preferences.routine_runs = previous;
                return Err(e);
            }
        }
        serde_json::to_value(RoutineList {
            versions: crate::routine_protocol::versions(&self.preferences.routines, &self.preferences.routine_runs, day)?,
            plans: self.preferences.routines.clone(),
            runs: self.preferences.routine_runs.values().filter(|run| run.day == day).cloned().collect(),
            due,
            active: self.routine_state(),
        }).map_err(|error| error.to_string())
    }
    pub(super) fn save_routine(
        &mut self,
        id: Option<String>,
        day: Option<String>,
        name: String,
        notes: String,
        copy_of: Option<String>,
    ) -> Result<Value, String> {
        self.save_routine_with_request(id,day,name,notes,copy_of,None)
    }
    pub(super) fn save_routine_with_request(
        &mut self,
        id: Option<String>,
        day: Option<String>,
        name: String,
        notes: String,
        copy_of: Option<String>,
        request_id: Option<String>,
    ) -> Result<Value, String> {
        if name.trim().is_empty() || name.chars().count() > 80 || notes.len() > 8192 {
            return Err("计划名称需 1～80 个字，备注最长 8192 字节".into());
        }
        if id.is_some() && request_id.is_some(){return Err("更新已有计划不能带新建请求编号".into());}
        let previous=self.preferences.clone();
        let result=(|| -> Result<Value,String> {
            if let Some(id) = id {
                let r = self.routine_target_mut(&id, day.as_deref())?;
                r.name = name.trim().into();
                r.notes = notes;
                self.persist()?;
                return Ok(json!({"id":id}));
            }
            let requested_id=if let Some(request_id)=request_id {
                if request_id.is_empty()||request_id.len()>128||!request_id.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'-'||c==b'_'){
                    return Err("计划请求编号无效".into());
                }
                Some(format!("routine-request-{request_id}"))
            }else{None};
            if let Some(requested_id)=&requested_id {
                if let Some(saved)=self.preferences.routines.iter().find(|routine|&routine.id==requested_id){
                    if saved.name==name.trim()&&saved.notes==notes{return Ok(json!({"id":saved.id,"existing":true}));}
                    return Err("这份计划已创建且内容已变化，请重新读取计划列表".into());
                }
            }
            if self.preferences.routines.len() >= 100 {
                return Err("最多保存 100 个常用计划".into());
            }
            let id = requested_id.unwrap_or_else(||new_id("routine"));
            let mut routine = if let Some(source) = copy_of {
                if let Some(day) = day.as_deref() {
                    self.preferences
                        .routine_runs
                        .get(&run_key(&source, day))
                        .map(|r| r.routine.clone())
                        .or_else(|| {
                            self.preferences
                                .routines
                                .iter()
                                .find(|r| r.id == source)
                                .cloned()
                        })
                } else {
                    self.preferences
                        .routines
                        .iter()
                        .find(|r| r.id == source)
                        .cloned()
                }
                .ok_or("要复制的计划不存在")?
            } else {
                PracticeRoutine {
                    schedule: None,
                    id: id.clone(),
                    name: String::new(),
                    notes: String::new(),
                    items: vec![],
                }
            };
            routine.schedule = None;
            routine.id = id.clone();
            routine.name = name.trim().into();
            routine.notes = notes;
            for item in &mut routine.items {
                item.id = new_id("item");
            }
            self.preferences.routines.push(routine);
            self.persist()?;
            Ok(json!({"id":id}))
        })();
        if result.is_err(){self.preferences=previous;}
        result
    }
    pub(super) fn save_routine_schedule(
        &mut self,
        id: &str,
        schedule: Option<RoutineSchedule>,
    ) -> Result<Value, String> {
        if let Some(s) = &schedule {
            s.validate()?;
        }
        let i = self
            .preferences
            .routines
            .iter()
            .position(|r| r.id == id)
            .ok_or("常用计划不存在")?;
        if schedule.as_ref().is_some_and(|s| s.enabled)
            && self.preferences.routines[i].items.is_empty()
        {
            return Err("请先给常用计划添加练习项目，再启用周期安排".into());
        }
        let previous = self.preferences.routines[i].schedule.clone();
        self.preferences.routines[i].schedule = schedule;
        if let Err(e) = self.persist() {
            self.preferences.routines[i].schedule = previous;
            return Err(e);
        }
        Ok(json!({"ok":true}))
    }
    pub(super) fn remove_routine(&mut self, id: &str) -> Result<Value, String> {
        if self.routine.as_ref().is_some_and(|a| a.routine_id == id) {
            return Err("请先结束该计划的当前项目".into());
        }
        let previous=self.preferences.clone();
        self.preferences.routines.retain(|r| r.id != id);
        if self.preferences.routines.len()==previous.routines.len(){return Ok(json!({"ok":true,"removed":false}));}
        if let Err(error)=self.persist(){self.preferences=previous;return Err(error);}
        Ok(json!({"ok":true,"removed":true}))
    }
    fn build_routine_item(&mut self, id: Option<String>, source: Option<&str>, source_id: Option<&str>, title: String, notes: String, goal: RoutineGoal, old: Option<RoutineItem>) -> Result<RoutineItem, String> {
        if title.trim().is_empty() || title.chars().count() > 100 || notes.len() > 8192 {
            return Err("项目名称需 1～100 个字，要求最长 8192 字节".into());
        }
        // Capture a named passage under its own conditions without adopting it in the live session.
        if source == Some("passage") {
            let content = &self.file.as_ref().ok_or("请先打开曲目")?.content_id;
            let preset = self.preferences.passages.get(content).and_then(|rows| rows.iter().find(|row| Some(row.id.as_str()) == source_id)).cloned().ok_or("练习段不存在")?;
            let edition = preset.practice_edition(content)?;
            let mut reader = self.capture_document_context().into_player(true)?;
            reader.restoring = true;
            reader.restore_practice_edition(&edition)?;
            if let Some(range) = &preset.score_range { reader.restore_passage_notation(range)?; }
            reader.open_passage_conditions(preset)?;
            return reader.build_routine_item(id, Some("current"), None, title, notes, goal, old);
        }
        let mut item = if let Some(source) = source {
            let f = self.file.as_ref().ok_or("请先打开要加入计划的曲目")?;
            let mut settings = SessionSettings {
                tracks: self.config.practice_track_setup(),
                parts: self
                    .config
                    .tracks
                    .iter()
                    .map(|t| (t.track_id, t.practice_part))
                    .collect(),
                mode: Some(self.state.mode.clone()),
                hands: self.state.hands.clone(),
                count_in: self.state.count_in,
                metronome: self.state.metronome,
                latency: self.state.latency,
                rounds: 0,
                adaptive: false,
            };
            let mut speed = self.state.speed;
            let mut grid = self.grid_signature();
            let mut scope = self.practice_scope();
            let mut exercise = self.exercise;
            let mut practice = Some(self.passage_practice_snapshot()?);
            let target = match source {
                "current" => {
                    if let Some(range)=self.score_range_for_current_loop() {
                        RoutineTarget::ScorePassage {range}
                    } else if let Some(range)=self.tick_range_for_current_loop() {
                        RoutineTarget::PrecisePassage {range}
                    } else if let Some(p) = &self.state.passage {
                        RoutineTarget::Passage {
                            start: f
                                .measures
                                .partition_point(|m| m.as_secs_f64() <= p.start)
                                .max(1),
                            end: f
                                .measures
                                .partition_point(|m| m.as_secs_f64() < p.end)
                                .max(1),
                        }
                    } else {
                        RoutineTarget::Whole
                    }
                }
                "ladder" => {
                    let p = self
                        .preferences
                        .ladder_presets
                        .get(&f.content_id)
                        .and_then(|ps| ps.iter().find(|p| Some(p.id.as_str()) == source_id))
                        .cloned()
                        .ok_or("阶梯方案不存在")?;
                    practice = Some(panthesia_core::song_project::PracticeEdition::resolve(p.practice.as_ref(), &f.content_id, &p.grid)?);
                    settings = p.settings.clone();
                    grid = p.grid.clone();
                    scope = p.scope.clone();
                    exercise = p.exercise_spec;
                    speed = f64::from(p.plan.start_percent) / 100.;
                    RoutineTarget::Ladder { preset: p }
                }
                _ => return Err("项目来源无效".into()),
            };
            if !["wait", "flow", "recital", "memory"]
                .contains(&settings.mode.as_deref().unwrap_or("wait"))
            {
                return Err("计划项目需使用可计分的练习模式".into());
            }
            if !matches!(target, RoutineTarget::Whole)
                && settings.mode.as_deref().is_some_and(is_recital_mode)
            {
                return Err("完整演奏/背谱项目必须为全曲".into());
            }
            RoutineItem {
                practice,
                id: id.clone().unwrap_or_else(|| new_id("item")),
                title: String::new(),
                notes: String::new(),
                content_id: f.content_id.clone(),
                song_title: self.title.clone(),
                path: f.source_path.clone(),
                exercise,
                grid,
                scope,
                settings,
                speed,
                target,
                goal: goal.clone(),
            }
        } else {
            old.clone().ok_or("更新项目需要已有项目或当前曲目来源")?
        };
        let goal = if let RoutineTarget::Ladder { preset } = &item.target {
            RoutineGoal { expression:goal.expression.clone().or_else(|| if source==Some("ladder"){preset.expression.clone()}else{None}),
                    passes: 1,
                accuracy: preset.plan.accuracy_percent,
                on_time: preset.plan.on_time_percent,
                consecutive: true,
                attempt_limit: preset.plan.attempt_limit,
            }
        } else {
            goal
        };
        goal.validate(item.settings.mode.as_deref().unwrap_or("wait"))?;
        item.title = title.trim().into();
        item.notes = notes;
        item.goal = goal;
        self.validate_expression_source(&item)?;
        Ok(item)
    }
    pub(super) fn save_routine_item(
        &mut self,
        routine_id: &str,
        day: Option<&str>,
        id: Option<String>,
        source: Option<&str>,
        source_id: Option<&str>,
        title: String,
        notes: String,
        goal: RoutineGoal,
    ) -> Result<Value, String> {
        self.routine_editable(routine_id, day)?;
        if title.trim().is_empty() || title.chars().count() > 100 || notes.len() > 8192 {
            return Err("项目名称需 1～100 个字，要求最长 8192 字节".into());
        }
        let previous=self.preferences.clone();
        let result=(|| -> Result<Value,String> {
            let old = self
                .routine_target_mut(routine_id, day)?
                .items
                .iter()
                .find(|i| Some(&i.id) == id.as_ref())
                .cloned();
            let item = self.build_routine_item(id, source, source_id, title, notes, goal, old.clone())?;
            if let Some(saved)=&old {
                if serde_json::to_value(saved).map_err(|e|e.to_string())? == serde_json::to_value(&item).map_err(|e|e.to_string())? {
                    return Ok(json!({"id":item.id,"existing":true}));
                }
            }
            let changed = old.as_ref().is_some_and(|old| source.is_some() || old.goal != item.goal);
            let item_id = item.id.clone();
            let rows = &mut self.routine_target_mut(routine_id, day)?.items;
            if let Some(old) = rows.iter_mut().find(|i| i.id == item_id) {
                *old = item;
            } else {
                if rows.len() >= 200 {
                    return Err("每个计划最多 200 个项目".into());
                }
                rows.push(item);
            }
            if changed {
                if let Some(day) = day {
                    self.preferences
                        .routine_runs
                        .get_mut(&run_key(routine_id, day))
                        .unwrap()
                        .progress
                        .remove(&item_id);
                }
            }
            self.persist()?;
            Ok(json!({"id":item_id}))
        })();
        if result.is_err(){self.preferences=previous;}
        result
    }
    pub(super) fn passage_catalog(&self,content_id:Option<&str>,query:&str,offset:usize)->Result<Value,String>{
        self.passage_catalog_checked(content_id,query,offset,||Ok(()))
    }
    pub(super) fn passage_catalog_checked(
        &self,
        content_id: Option<&str>,
        query: &str,
        offset: usize,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        check()?;
        if query.len() > 512 {
            return Err("查询文字过长".into());
        }
        let query = query.trim().to_lowercase();
        // Sort borrowed presets; serialize only the requested page. Full settings and
        // score ranges can be large and do not belong in every matching row's copy.
        let mut rows = Vec::new();
        let mut visited = 0usize;
        for (cid, passages) in &self.preferences.passages {
            check()?;
            if content_id.is_some_and(|id| id != cid) {
                continue;
            }
            let title = Arc::new(
                self.history
                    .song(cid)
                    .map(|history| history.display_name.clone())
                    .filter(|value| !value.is_empty())
                    .or_else(|| {
                        self.file
                            .as_ref()
                            .filter(|file| file.content_id == *cid)
                            .map(|_| self.title.clone())
                    })
                    .unwrap_or_else(|| format!("曲目 {}", cid.chars().take(8).collect::<String>())),
            );
            for preset in passages {
                visited += 1;
                if visited % 128 == 0 {
                    check()?;
                }
                if !query.is_empty()
                    && !format!("{} {} {}", title, preset.name, preset.notes)
                        .to_lowercase()
                        .contains(&query)
                {
                    continue;
                }
                rows.push((cid, title.clone(), preset));
            }
        }
        check()?;
        rows.sort_by(|left, right| {
            left.1
                .as_str()
                .cmp(right.1.as_str())
                .then_with(|| left.2.name.cmp(&right.2.name))
                .then_with(|| left.2.id.cmp(&right.2.id))
        });
        check()?;
        let total = rows.len();
        let mut page = Vec::with_capacity(50.min(total.saturating_sub(offset)));
        for (cid, title, preset) in rows.into_iter().skip(offset).take(50) {
            check()?;
            let mut value = serde_json::to_value(preset).map_err(|error| error.to_string())?;
            value["contentId"] = json!(cid);
            value["songTitle"] = json!(title.as_str());
            page.push(value);
        }
        Ok(json!({"total":total,"offset":offset,"rows":page}))
    }
    fn detached_source_worker(&self,cid:&str)->Player {
        crate::source_snapshot::SourceSnapshot::capture(self,cid).reader(&self.data,cid)
    }

    fn sequence_source(&self,cid:&str)->Result<Player,String>{
        let history=self.history.song(cid);
        let current=self.file.as_ref().is_some_and(|f|f.content_id==cid);
        let spec=if current {self.exercise} else {history.and_then(|h|h.setup.as_ref()).and_then(|s|s.exercise_spec)};
        let title=if current {self.title.clone()} else {history.map(|h|h.display_name.clone()).unwrap_or_else(||"练习曲目".into())};
        let mut worker=self.detached_source_worker(cid);
        let (file,plan)=if let Some(spec)=spec {
            let plan=ExercisePlan::generate(spec,&KeyboardRange::new(21..=108)).map_err(|e|e.to_string())?;
            if plan.practice_id()!=cid {return Err("生成练习身份已改变，请重新打开核对".into());}
            let mut file=plan.to_midi_file()?;file.content_id=plan.practice_id();(file,Some(plan))
        }else{
            let file=crate::library::verified_file(&self.data,cid,
                self.file.as_ref().filter(|f|f.content_id==cid).and_then(|f|f.source_path.clone()).into_iter()
                .chain(history.and_then(|h|h.setup.as_ref()).and_then(|s|s.source_path.clone()))
                .chain(history.and_then(|h|h.library.source_path.clone())))?;(file,None)
        };
        worker.install(file,title,plan)?;
        if let Some(error)=&worker.state.error {return Err(format!("曲目资料无法核对：{error}"));}
        Ok(worker)
    }
    pub(super) fn compose_passages(&mut self, routine_id: &str, day: Option<&str>, content_id: &str, entries: &[PassageSequenceEntry], goal: &RoutineGoal, proof: Option<&str>) -> Result<Value, String> {
        self.compose_passages_checked(routine_id,day,content_id,entries,goal,proof,&||Ok(()))
    }
    pub(super) fn compose_passages_checked(
        &mut self,
        routine_id: &str,
        day: Option<&str>,
        content_id: &str,
        entries: &[PassageSequenceEntry],
        goal: &RoutineGoal,
        proof: Option<&str>,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        check()?;
        if proof.is_some_and(|proof| {
            proof.len() != 64 || !proof.bytes().all(|byte| byte.is_ascii_hexdigit())
        }) {
            return Err("编排核对凭据无效，请重新核对".into());
        }
        self.routine_editable(routine_id, day)?;
        if day.is_some_and(|d| !day_valid(d)) {
            return Err("日期无效".into());
        }
        if !content_id.is_empty()
            && self
                .file
                .as_ref()
                .is_none_or(|f| f.content_id != content_id)
        {
            return Err("曲目已改变，请重新编排段落".into());
        }
        if day.is_some_and(|d| {
            !self
                .preferences
                .routine_runs
                .contains_key(&run_key(routine_id, d))
        }) && self.preferences.routine_runs.len() >= 10000
        {
            return Err("日期安排已到容量上限".into());
        }
        let plan = if let Some(day) = day {
            self.preferences
                .routine_runs
                .get(&run_key(routine_id, day))
                .map(|r| &r.routine)
                .or_else(|| {
                    self.preferences
                        .routines
                        .iter()
                        .find(|r| r.id == routine_id)
                })
        } else {
            self.preferences
                .routines
                .iter()
                .find(|r| r.id == routine_id)
        }
        .cloned()
        .ok_or("计划不存在")?;
        if entries.is_empty()
            || entries.len() > 100
            || entries.iter().any(|e| !(1..=20).contains(&e.copies))
        {
            return Err("请选择 1～100 个段落，每段可编排 1～20 次".into());
        }
        let count: usize = entries.iter().map(|e| usize::from(e.copies)).sum();
        let saved_batch = proof.is_some_and(|proof| {
            let prefix = format!("sequence-{proof}-");
            plan.items.iter().any(|item| item.id.starts_with(&prefix))
        });
        if !saved_batch && plan.items.len() + count > 200 {
            return Err("编排后每个计划最多 200 个项目".into());
        }
        let mut workers: std::collections::HashMap<String, Player> =
            std::collections::HashMap::new();
        let mut items = Vec::with_capacity(count);
        for entry in entries {
            check()?;
            let cid = entry.content_id.as_deref().unwrap_or(content_id);
            let preset = self
                .preferences
                .passages
                .get(cid)
                .and_then(|rows| rows.iter().find(|p| p.id == entry.id))
                .cloned()
                .ok_or("段落已移除，请重新选择")?;
            if !workers.contains_key(cid) {
                workers.insert(
                    cid.into(),
                    self.sequence_source(cid)
                        .map_err(|e| format!("段落「{}」：{e}", preset.name))?,
                );
            }
            let worker = workers.get_mut(cid).unwrap();
            for copy in 0..entry.copies {
                check()?;
                let title = if entry.copies > 1 {
                    format!("{} · {}/{}", preset.name, copy + 1, entry.copies)
                } else {
                    preset.name.clone()
                };
                let title = title.chars().take(100).collect();
                let item = worker
                    .build_routine_item(
                        Some(format!("preview-{}", items.len())),
                        Some("passage"),
                        Some(&entry.id),
                        title,
                        preset.notes.clone(),
                        goal.clone(),
                        None,
                    )
                    .map_err(|e| format!("{} · {}：{e}", worker.title, preset.name))?;
                items.push(item);
            }
        }
        let bytes =
            serde_json::to_vec(&json!({"plan":plan,"day":day,"entries":entries,"items":items}))
                .map_err(|e| e.to_string())?;
        let signature = blake3::hash(&bytes).to_hex().to_string();
        check()?;
        if let Some(proof) = proof {
            let prefix = format!("sequence-{proof}-");
            let existing: Vec<_> = plan
                .items
                .iter()
                .filter(|item| item.id.starts_with(&prefix))
                .collect();
            if !existing.is_empty() {
                let mut ids = Vec::with_capacity(items.len());
                if existing.len() != items.len() {
                    return Err("这次编排已保存且项目数量已变化，请重新读取计划".into());
                }
                for (index, item) in items.iter().enumerate() {
                    check()?;
                    let id = format!("{prefix}{index}");
                    let saved = existing
                        .iter()
                        .find(|saved| saved.id == id)
                        .ok_or("这次编排已保存且项目顺序已变化，请重新读取计划")?;
                    let mut expected = item.clone();
                    expected.id = id.clone();
                    if serde_json::to_value(saved).map_err(|error| error.to_string())?
                        != serde_json::to_value(expected).map_err(|error| error.to_string())?
                    {
                        return Err("这次编排已保存且内容已变化，请重新读取计划".into());
                    }
                    ids.push(id);
                }
                return Ok(json!({"ids":ids,"count":count,"existing":true}));
            }
            if proof != signature {
                return Err("段落条件或计划已改变，请重新审阅编排".into());
            }
            let previous_preferences = self.preferences.clone();
            for (index, item) in items.iter_mut().enumerate() {
                item.id = format!("sequence-{signature}-{index}");
            }
            let ids: Vec<_> = items.iter().map(|i| i.id.clone()).collect();
            self.routine_target_mut(routine_id, day)?
                .items
                .extend(items.clone());
            if let Err(e) = self.persist() {
                self.preferences = previous_preferences;
                return Err(e);
            }
            return Ok(json!({"ids":ids,"count":count}));
        }
        Ok(json!({"proof":signature,"items":items,"existing":plan.items.len(),"count":count}))
    }
    pub(super) fn move_routine_item(
        &mut self,
        id: &str,
        day: Option<&str>,
        item: &str,
        direction: i8,
    ) -> Result<Value, String> {
        if ![-1, 1].contains(&direction) {
            return Err("移动方向无效".into());
        }
        let previous=self.preferences.clone();
        let result=(|| -> Result<Value,String> {
            let rows = &mut self.routine_target_mut(id, day)?.items;
            let index = rows.iter().position(|i| i.id == item).ok_or("项目不存在")?;
            let target = if direction < 0 {
                index.checked_sub(1)
            } else {
                (index + 1 < rows.len()).then_some(index + 1)
            };
            if let Some(target) = target {
                rows.swap(index, target);
            }
            self.persist()?;
            Ok(json!({"ok":true,"moved":target.is_some()}))
        })();
        if result.is_err(){self.preferences=previous;}
        result
    }
    pub(super) fn remove_routine_item(
        &mut self,
        id: &str,
        day: Option<&str>,
        item: &str,
    ) -> Result<Value, String> {
        let previous=self.preferences.clone();
        let result=(|| -> Result<Value,String> {
            let rows=&mut self.routine_target_mut(id, day)?.items;
            let before=rows.len();
            rows.retain(|i|i.id!=item);
            if rows.len()==before {return Err("项目已不存在，请刷新计划".into());}
            if let Some(day)=day {
                let run=self.preferences.routine_runs.get_mut(&run_key(id,day)).unwrap();
                run.progress.remove(item);
                if run.last_item.as_deref()==Some(item){run.last_item=None;}
            }
            self.persist()?;
            Ok(json!({"ok":true}))
        })();
        if result.is_err(){self.preferences=previous;}
        result
    }
    fn restore_routine_edition(&mut self, item: &RoutineItem, associate: bool) -> Result<(), String> {
        let edition = panthesia_core::song_project::PracticeEdition::resolve(item.practice.as_ref(), &item.content_id, &item.grid)?;
        if let RoutineTarget::Ladder { preset } = &item.target {
            let ladder = panthesia_core::song_project::PracticeEdition::resolve(preset.practice.as_ref(), &item.content_id, &preset.grid)?;
            if edition != ladder { return Err("计划项目与阶梯的练习版本不一致，请重新捕获条件".into()); }
        }
        self.restore_practice_edition(&edition)?;
        if let RoutineTarget::ScorePassage { range } = &item.target {
            if let Some(path) = self.restore_passage_notation(range)? {
                if associate {
                    let file=self.file.as_ref().ok_or("请先选择曲目")?;
                    panthesia_core::library::save_score_association(&self.annotation_path(file)?, &item.content_id, &path).map_err(|error|error.to_string())?;
                }
            }
        }
        Ok(())
    }
    pub(crate) fn preflight_loaded_routine_item(&mut self, item: &RoutineItem) -> Result<(), String> {
        if let Some(error) = &self.state.error {
            return Err(format!("曲目资料无法核对：{error}"));
        }
        self.restore_routine_edition(item, false)?;
        if self.grid_signature() != item.grid {
            return Err("项目的小节网格已改变，请重新捕获当前条件".into());
        }
        match &item.target {
            RoutineTarget::ScorePassage { range } => { self.validate_score_range(range)?; }
            RoutineTarget::PrecisePassage { range } => { self.validate_tick_range(range)?; }
            RoutineTarget::Passage { start, end } => {
                if *start == 0 || start > end || *end > self.file.as_ref().unwrap().musical_time.measures.len() {
                    return Err("项目小节范围无效，请重新捕获当前条件".into());
                }
            }
            RoutineTarget::Ladder { preset } => {
                preset.plan.validate()?;
                if preset.start == 0 || preset.start > preset.end || preset.end > self.file.as_ref().unwrap().musical_time.measures.len() {
                    return Err("阶梯小节范围无效，请重新捕获当前条件".into());
                }
            }
            RoutineTarget::Whole => {}
        }
        self.config.apply_practice_setup(&SongPracticeSetup {
            tracks: item.settings.tracks.clone(),
            ..Default::default()
        });
        for track in &mut self.config.tracks {
            if let Some(part) = item.settings.parts.get(&track.track_id) {
                track.practice_part = *part;
            }
        }
        self.state.hands = item.settings.hands.clone();
        if self.practice_scope() != item.scope {
            return Err("逐音分手或评分范围已改变，请重新捕获当前条件".into());
        }
        self.validate_expression_source(item)?;
        Ok(())
    }
    pub(crate) fn routine_selection(&self,id:&str,day:&str,item_id:&str,resume:bool)->Result<(RoutineItem,RoutineProgress,bool),String> {
        if self.recorder.is_recording() {
            return Err("请先停止录音".into());
        }
        if !day_valid(day) {
            return Err("日期无效".into());
        }
        let existing_run = self.preferences.routine_runs.get(&run_key(id, day));
        let routine = existing_run.map(|run| &run.routine)
            .or_else(|| self.preferences.routines.iter().find(|routine| routine.id == id))
            .ok_or("常用计划已移除，无法创建当天安排")?;
        let item = routine
            .items
            .iter()
            .find(|i| i.id == item_id)
            .cloned()
            .ok_or("当天项目不存在")?;
        let mut previous = existing_run.and_then(|run| run.progress.get(item_id)).cloned().unwrap_or_default();
        if resume && (previous.completed || previous.skipped) {
            return Err("该项目已达标或跳过，请明确重置后再练")?;
        }
        item.goal
            .validate(item.settings.mode.as_deref().unwrap_or("wait"))?;
        if self.routine.as_ref().is_some_and(|r|r.routine_id==id && r.day==day && r.item.id==item_id) {
            if let Some(ladder)=&self.ladder {previous.ladder=Some(ladder.progress.clone());}
        }
        Ok((item,previous,existing_run.is_some()))
    }
    pub(super) fn open_routine_item(&mut self,id:&str,day:&str,item_id:&str,resume:bool)->Result<Value,String> {
        let context=self.prepare_routine_open(id,day,item_id,resume)?;
        let prepared=crate::routine_loading::Prepared::read(&self.data,&context,||Ok(()))?;
        prepared.check()?;
        self.install_routine_item(&context,prepared)
    }
    pub(crate) fn install_routine_item(&mut self,context:&crate::routine_loading::Context,prepared:crate::routine_loading::Prepared)->Result<Value,String> {
        let id=context.routine_id.as_str();let day=context.day.as_str();let item_id=context.item_id.as_str();
        let resume=context.resume;let item=context.item.clone();let previous=context.previous.clone();
        self.ensure_routine_day(id, day)?;
        self.stop_routine()?;
        if self.ladder.as_ref().is_some_and(|l| l.active) {
            self.stop_ladder()?;
        }
        self.ladder = None;
        prepared.install(self)?;
        self.restore_routine_edition(&item, true)?;
        if self.grid_signature() != item.grid {
            return Err("项目的小节网格已改变，请重新捕获当前条件")?;
        }
        if let RoutineTarget::ScorePassage {range}=&item.target {self.validate_score_range(range)?;}
        if let RoutineTarget::PrecisePassage {range}=&item.target {self.validate_tick_range(range)?;}
        let before = self.config.clone();
        let before_hands = self.state.hands.clone();
        self.config.apply_practice_setup(&SongPracticeSetup {
            tracks: item.settings.tracks.clone(),
            ..Default::default()
        });
        for t in &mut self.config.tracks {
            if let Some(part) = item.settings.parts.get(&t.track_id) {
                t.practice_part = *part;
            }
        }
        self.state.hands = item.settings.hands.clone();
        if self.practice_scope() != item.scope {
            self.config = before;
            self.state.hands = before_hands;
            return Err("逐音分手或评分范围已改变，请重新捕获当前条件")?;
        }
        self.state.mode = item.settings.mode.clone().unwrap_or_else(|| "wait".into());
        self.state.wait = self.state.mode == "wait";
        self.state.speed = item.speed;
        self.state.count_in = item.settings.count_in;
        self.state.metronome = item.settings.metronome;
        self.state.latency = item.settings.latency;
        self.state.rounds = 0;
        self.state.adaptive = false;
        self.state.passage = None;
        self.state.status = "ready".into();
        let mut progress = if resume {
            previous
        } else {
            RoutineProgress::default()
        };
        progress.limited = false;
        progress.batch_attempts = 0;
        match &item.target {
            RoutineTarget::Whole => self.reset(0.),
            RoutineTarget::Passage { start, end } => {
                self.command(Command::MeasureLoop {
                    start: *start,
                    end: *end,
                    enabled: true,
                })?;
            }
            RoutineTarget::PrecisePassage {range} => {self.apply_tick_range(range)?;}
            RoutineTarget::ScorePassage {range} => { self.apply_score_range(range)?; }
            RoutineTarget::Ladder { preset } => {
                preset.plan.validate()?;
                let mut ladder = progress.ladder.clone().unwrap_or_default();
                ladder.resume();
                self.state.speed = f64::from(ladder.speed(&preset.plan)) / 100.;
                self.command(Command::MeasureLoop {
                    start: preset.start,
                    end: preset.end,
                    enabled: true,
                })?;
                let mut preset = preset.clone();
                preset.id = format!("daily-{id}-{day}-{item_id}");
                self.ladder = Some(LadderRun {
                    preset,
                    progress: ladder,
                    active: true,
                });
            }
        }
        let run = self
            .preferences
            .routine_runs
            .get_mut(&run_key(id, day))
            .unwrap();
        run.progress.insert(item_id.into(), progress);
        run.last_item = Some(item_id.into());
        self.routine = Some(ActiveRoutine {
            routine_id: id.into(),
            day: day.into(),
            item,
        }.into());
        self.persist()?;
        self.command(Command::CurrentSong)
    }
    pub(super) fn stop_routine(&mut self) -> Result<Value, String> {
        if let Some(active) = self.routine.take() {
            if let Some(ladder) = self.ladder.take() {
                if let Some(run) = self
                    .preferences
                    .routine_runs
                    .get_mut(&run_key(&active.routine_id, &active.day))
                {
                    run.progress.entry(active.item.id.clone()).or_default().ladder = Some(ladder.progress);
                }
            }
            self.panic();
            self.state.status = "paused".into();
            self.persist()?;
        }
        Ok(json!({"ok":true}))
    }
    pub(super) fn mark_routine_item(
        &mut self,
        id: &str,
        day: &str,
        item: &str,
        reset: bool,
        reason: &str,
    ) -> Result<Value, String> {
        if self
            .routine
            .as_ref()
            .is_some_and(|a| a.routine_id == id && a.day == day && a.item.id == item)
        {
            self.stop_routine()?;
        }
        self.ensure_routine_day(id, day)?;
        let run = self
            .preferences
            .routine_runs
            .get_mut(&run_key(id, day))
            .unwrap();
        if !run.routine.items.iter().any(|i| i.id == item) {
            return Err("当天项目不存在".into());
        }
        if reset {
            run.progress.remove(item);
        } else {
            if reason.len() > 8192 {
                return Err("跳过原因过长".into());
            }
            let p = run.progress.entry(item.into()).or_default();
            p.skipped = true;
            p.completed = false;
            p.last_result = if reason.trim().is_empty() {
                "本次跳过".into()
            } else {
                reason.trim().into()
            };
        }
        self.persist()?;
        Ok(json!({"ok":true}))
    }
    pub(super) fn routine_round_finished(&mut self) -> bool {
        let Some(active) = self.routine.clone() else {
            return false;
        };
        let summary = self.completed_summary();
        let target = self.practice_target_count();
        let expression_result = if matches!(active.item.target, RoutineTarget::Ladder { .. }) { Ok(()) } else { active.item.goal.expression.as_ref().map_or(Ok(()), |goal| self.assess_expression_goal(goal,summary.expression,self.matcher.results(),target)) };
        let session_id = self
            .history
            .song(&active.item.content_id)
            .and_then(|h| h.sessions.last())
            .and_then(|s| s.id.clone());
        let Some(run) = self
            .preferences
            .routine_runs
            .get_mut(&run_key(&active.routine_id, &active.day))
        else {
            return true;
        };
        let p = run.progress.entry(active.item.id.clone()).or_default();
        if p.completed || p.skipped {
            return true;
        }
        p.attempts = p.attempts.saturating_add(1);
        p.batch_attempts += 1;
        let accuracy = summary.overall.accuracy();
        if let Some(a) = accuracy {
            p.best_accuracy = Some(p.best_accuracy.map_or(a, |best| best.max(a)));
        }
        if let Some(id) = session_id {
            if !p.session_ids.contains(&id) {
                p.session_ids.push(id);
            }
            if p.session_ids.len() > 500 {
                p.session_ids.remove(0);
            }
        }
        if matches!(active.item.target, RoutineTarget::Ladder { .. }) {
            if let Some(ladder) = &self.ladder {
                p.ladder = Some(ladder.progress.clone());
                p.completed = ladder.progress.completed;
                if p.completed {
                    p.passed = 1;
                    p.streak = 1;
                }
                p.limited = ladder.progress.limited;
                p.last_result = ladder.progress.last_result.clone();
            }
        } else {
            let complete = target > 0
                && summary.overall.matched_notes + summary.overall.missed_notes >= target;
            let on_time = (summary.overall.matched_notes > 0).then(|| {
                summary.overall.on_time_notes as f32 / summary.overall.matched_notes as f32
            });
            let accuracy_pass = accuracy
                .is_some_and(|a| a + 0.00001 >= f32::from(active.item.goal.accuracy) / 100.);
            let timing_pass = active
                .item
                .goal
                .on_time
                .is_none_or(|t| on_time.is_some_and(|v| v + 0.00001 >= f32::from(t) / 100.));
            let pass = complete && accuracy_pass && timing_pass && expression_result.is_ok();
            if pass {
                p.passed += 1;
                p.streak += 1;
                p.last_result = "本轮达标".into();
            } else {
                p.streak = 0;
                p.last_result = if !complete {
                    "目标音符未练完"
                } else if !accuracy_pass {
                    "音符正确率未达标"
                } else if !timing_pass {
                    "准时率未达标"
                } else {
                    expression_result.as_ref().err().map_or("本轮未达标",String::as_str)
                }
                .into();
            }
            p.completed = if active.item.goal.consecutive {
                p.streak
            } else {
                p.passed
            } >= active.item.goal.passes;
            if !p.completed && p.batch_attempts >= active.item.goal.attempt_limit {
                p.limited = true;
                p.last_result = "轮数到达上限，可结束后继续".into();
            }
        }
        let stop = p.completed || p.limited;
        if let Err(e) = self.persist() {
            self.state.error = Some(e);
            return true;
        }
        stop
    }
    pub(super) fn routine_status(&self) -> Option<Value> {
        serde_json::to_value(self.routine_state()?).ok()
    }
    pub(super) fn routine_state(&self) -> Option<RoutineState> {
        let a = self.routine.as_ref()?;
        let run = self
            .preferences
            .routine_runs
            .get(&run_key(&a.routine_id, &a.day))?;
        let index = run.routine.items.iter().position(|i| i.id == a.item.id)?;
        let progress = run.progress.get(&a.item.id).cloned().unwrap_or_default();
        let next = run
            .routine
            .items
            .iter()
            .skip(index + 1)
            .find(|i| {
                !run.progress
                    .get(&i.id)
                    .is_some_and(|p| p.completed || p.skipped)
            })
            .map(|i| &i.id);
        Some(RoutineState {
            routine_id: a.routine_id.clone(), day: a.day.clone(), item_id: a.item.id.clone(),
            title: run.routine.name.clone(), item_title: a.item.title.clone(), notes: a.item.notes.clone(),
            index: index + 1, total: run.routine.items.len(),
            kind: match a.item.target {
                RoutineTarget::Whole => RoutineKind::Whole,
                RoutineTarget::Passage { .. } | RoutineTarget::ScorePassage { .. } | RoutineTarget::PrecisePassage { .. } => RoutineKind::Passage,
                RoutineTarget::Ladder { .. } => RoutineKind::Ladder,
            },
            goal: a.item.goal.clone(), progress, next_item_id: next.cloned(),
        })
    }
}

#[cfg(test)]
mod routine_write_tests {
    use super::*;

    #[test]
    fn missing_next_item_keeps_the_current_routine_open() {
        let data = std::env::temp_dir().join(new_id("neothesia-routine-missing-next"));
        let mut p = Player::new(data, PathBuf::new(), true);
        p.command(Command::Generate { spec: ExerciseSpec::default() }).unwrap();
        let plan = p.save_routine(None, None, "两项练习".into(), String::new(), None).unwrap()["id"].as_str().unwrap().to_owned();
        let goal = RoutineGoal { expression: None, passes: 1, accuracy: 90, on_time: None, consecutive: false, attempt_limit: 20 };
        let first = p.save_routine_item(&plan, None, None, Some("current"), None, "第一项".into(), String::new(), goal.clone()).unwrap()["id"].as_str().unwrap().to_owned();
        let next = p.save_routine_item(&plan, None, None, Some("current"), None, "第二项".into(), String::new(), goal).unwrap()["id"].as_str().unwrap().to_owned();
        let template_item = p.preferences.routines.iter().find(|routine| routine.id == plan).unwrap()
            .items.iter().find(|item| item.id == next).unwrap().clone();
        let broken_template = p.preferences.routines.iter_mut().find(|routine| routine.id == plan).unwrap()
            .items.iter_mut().find(|item| item.id == next).unwrap();
        broken_template.content_id = "missing-midi-content".into();
        broken_template.exercise = None;
        broken_template.path = None;
        let unused_day = "2026-10-14";
        assert!(p.open_routine_item(&plan, unused_day, &next, true).is_err());
        assert!(!p.preferences.routine_runs.contains_key(&run_key(&plan, unused_day)));
        *p.preferences.routines.iter_mut().find(|routine| routine.id == plan).unwrap()
            .items.iter_mut().find(|item| item.id == next).unwrap() = template_item;
        let day = "2026-10-13";
        p.open_routine_item(&plan, day, &first, true).unwrap();
        let current_song = p.file.as_ref().unwrap().content_id.clone();
        let run = p.preferences.routine_runs.get_mut(&run_key(&plan, day)).unwrap();
        let broken = run.routine.items.iter_mut().find(|item| item.id == next).unwrap();
        broken.content_id = "missing-midi-content".into();
        broken.exercise = None;
        broken.path = None;
        assert!(p.open_routine_item(&plan, day, &next, true).is_err());
        assert_eq!(p.routine.as_ref().unwrap().item.id, first);
        assert_eq!(p.file.as_ref().unwrap().content_id, current_song);
        let broken = p.preferences.routine_runs.get_mut(&run_key(&plan, day)).unwrap()
            .routine.items.iter_mut().find(|item| item.id == next).unwrap();
        broken.content_id = current_song.clone();
        broken.exercise = Some(ExerciseSpec::default());
        broken.grid = "stale-grid".into();
        assert!(p.open_routine_item(&plan, day, &next, true).is_err());
        assert_eq!(p.routine.as_ref().unwrap().item.id, first);
        assert_eq!(p.file.as_ref().unwrap().content_id, current_song);
    }

    #[test]
    fn repeated_plan_creation_returns_the_saved_plan_without_writing_again() {
        let data = std::env::temp_dir().join(new_id("neothesia-routine-request"));
        let mut p = Player::new(data.clone(), PathBuf::new(), true);
        let created = p.save_routine_with_request(
            None, None, "手位练习".into(), "慢速".into(), None, Some("draft-1".into()),
        ).unwrap();
        let id = created["id"].as_str().unwrap().to_owned();
        let before = serde_json::to_value(&p.preferences).unwrap();
        p.preferences_path = data;
        let repeated = p.save_routine_with_request(
            None, None, "手位练习".into(), "慢速".into(), None, Some("draft-1".into()),
        ).unwrap();
        assert_eq!(repeated["id"], id);
        assert_eq!(repeated["existing"], true);
        assert_eq!(serde_json::to_value(&p.preferences).unwrap(), before);
        assert!(p.save_routine_with_request(
            None, None, "另一份计划".into(), "慢速".into(), None, Some("draft-1".into()),
        ).is_err());
        assert_eq!(serde_json::to_value(&p.preferences).unwrap(), before);
    }

    #[test]
    fn failed_plan_and_item_writes_keep_preferences_unchanged() {
        let data=std::env::temp_dir().join(new_id("neothesia-routine-write"));
        let mut p=Player::new(data.clone(),PathBuf::new(),true);
        p.command(Command::Generate{spec:ExerciseSpec::default()}).unwrap();
        let path=p.preferences_path.clone();
        let before=serde_json::to_value(&p.preferences).unwrap();
        p.preferences_path=data.clone();
        assert!(p.save_routine(None,None,"未保存计划".into(),String::new(),None).is_err());
        assert_eq!(serde_json::to_value(&p.preferences).unwrap(),before);
        p.preferences_path=path.clone();
        let id=p.save_routine(None,None,"手位日课".into(),String::new(),None).unwrap()["id"].as_str().unwrap().to_owned();
        let before=serde_json::to_value(&p.preferences).unwrap();
        let goal=RoutineGoal{expression:None,passes:1,accuracy:90,on_time:None,consecutive:false,attempt_limit:20};
        assert!(p.command(Command::SaveRoutineItem{content_id:Some("另一首曲目".into()),routine_id:id.clone(),day:None,id:None,source:Some("current".into()),source_id:None,title:"错误来源".into(),notes:String::new(),goal:goal.clone()}).is_err());
        assert_eq!(serde_json::to_value(&p.preferences).unwrap(),before);
        p.preferences_path=data.clone();
        assert!(p.save_routine_item(&id,None,None,Some("current"),None,"第一段".into(),String::new(),goal.clone()).is_err());
        assert_eq!(serde_json::to_value(&p.preferences).unwrap(),before);
        assert!(p.save_routine_item(&id,Some("2026-10-02"),None,Some("current"),None,"第一段".into(),String::new(),goal.clone()).is_err());
        assert_eq!(serde_json::to_value(&p.preferences).unwrap(),before);
        p.preferences_path=path;
        let first=p.save_routine_item(&id,None,None,Some("current"),None,"第一段".into(),String::new(),goal.clone()).unwrap()["id"].as_str().unwrap().to_owned();
        let second=p.save_routine_item(&id,None,None,Some("current"),None,"第二段".into(),String::new(),goal.clone()).unwrap()["id"].as_str().unwrap().to_owned();
        let before=serde_json::to_value(&p.preferences).unwrap();
        p.preferences_path=data;
        let retry=p.save_routine_item(&id,None,Some(first.clone()),Some("current"),None,"第一段".into(),String::new(),goal).unwrap();
        assert_eq!(retry["existing"],true);
        assert_eq!(serde_json::to_value(&p.preferences).unwrap(),before);
        assert!(p.move_routine_item(&id,None,&first,1).is_err());
        assert_eq!(serde_json::to_value(&p.preferences).unwrap(),before);
        assert!(p.remove_routine_item(&id,None,&second).is_err());
        assert_eq!(serde_json::to_value(&p.preferences).unwrap(),before);
        assert!(p.remove_routine(&id).is_err());
        assert_eq!(serde_json::to_value(&p.preferences).unwrap(),before);
    }
}

#[cfg(test)]
mod schedule_tests {
    use super::*;
    #[test]
    fn schedule_date_exceptions_override_weekdays_and_keep_old_data_readable() {
        let old = r#"{"enabled":true,"weekdays":[4],"start":"2026-10-02","end":"2026-10-16"}"#;
        let mut rule: RoutineSchedule = serde_json::from_str(old).unwrap();
        assert!(rule.skip_dates.is_empty() && rule.extra_dates.is_empty());
        assert!(rule.matches("2026-10-02"));
        assert!(!rule.matches("2026-10-03"));
        rule.skip_dates.push("2026-10-02".into());
        rule.extra_dates.push("2026-10-03".into());
        rule.validate().unwrap();
        assert!(!rule.matches("2026-10-02"));
        assert!(rule.matches("2026-10-03"));
        assert!(!rule.matches("2026-10-17"));
        let reloaded: RoutineSchedule = serde_json::from_value(serde_json::to_value(&rule).unwrap()).unwrap();
        assert_eq!(reloaded.skip_dates, rule.skip_dates);
        assert_eq!(reloaded.extra_dates, rule.extra_dates);
        rule.extra_dates.push("2026-10-02".into());
        assert!(rule.validate().is_err());
    }
    #[test]
    fn calendar_rules_idempotent_snapshots_pause_copy_and_backup() {
        assert_eq!(weekday("2026-10-02"), 4);
        assert_eq!(weekday("2024-02-29"), 3);
        assert!(!day_valid("2100-02-29"));
        let data = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/cycle129-unit")
            .join(new_id("case"));
        let mut p = Player::new(data.clone(), PathBuf::new(), true);
        p.command(Command::Generate {
            spec: ExerciseSpec::default(),
        })
        .unwrap();
        let id = p
            .save_routine(None, None, "每周曲目".into(), "".into(), None)
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        let mut rule = RoutineSchedule {
            enabled: true,
            weekdays: vec![4],
            start: "2026-10-02".into(),
            end: Some("2026-10-16".into()),
            skip_dates: vec![],
            extra_dates: vec![],
        };
        assert!(p.save_routine_schedule(&id, Some(rule.clone())).is_err());
        let item = p
            .save_routine_item(
                &id,
                None,
                None,
                Some("current"),
                None,
                "原目标".into(),
                "".into(),
                RoutineGoal { expression:None,
                    passes: 1,
                    accuracy: 90,
                    on_time: None,
                    consecutive: false,
                    attempt_limit: 20,
                },
            )
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        p.save_routine_schedule(&id, Some(rule.clone())).unwrap();
        assert_eq!(
            p.routines("2026-10-01").unwrap()["runs"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            p.routines("2026-10-03").unwrap()["runs"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            p.routines("2026-10-23").unwrap()["runs"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            p.routines("2026-10-02").unwrap()["runs"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        p.mark_routine_item(&id, "2026-10-02", &item, false, "课堂已练")
            .unwrap();
        p.preferences.routines[0].items[0].title = "新目标".into();
        let old = p.routines("2026-10-02").unwrap();
        assert_eq!(old["runs"][0]["routine"]["items"][0]["title"], "原目标");
        assert_eq!(old["runs"][0]["progress"][&item]["skipped"], true);
        assert_eq!(
            p.routines("2026-10-09").unwrap()["runs"][0]["routine"]["items"][0]["title"],
            "新目标"
        );
        rule.enabled = false;
        p.save_routine_schedule(&id, Some(rule.clone())).unwrap();
        assert_eq!(
            p.routines("2026-10-16").unwrap()["runs"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        rule.enabled = true;
        p.save_routine_schedule(&id, Some(rule.clone())).unwrap();
        assert_eq!(
            p.routines("2026-10-16").unwrap()["runs"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let copy = p
            .save_routine(None, None, "副本".into(), "".into(), Some(id.clone()))
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(
            p.preferences
                .routines
                .iter()
                .find(|r| r.id == copy)
                .unwrap()
                .schedule
                .is_none()
        );
        let backup = p
            .practice_backup_snapshot(&crate::practice_backup::Selection::default())
            .unwrap();
        let b: crate::practice_backup::Backup = serde_json::from_value(backup).unwrap();
        let decoded = crate::practice_backup::Backup::decode(&b.encode().unwrap()).unwrap();
        assert_eq!(
            decoded.routines[0].schedule.as_ref().unwrap().weekdays,
            vec![4]
        );
        let mut invalid = rule.clone();
        invalid.weekdays = vec![7];
        assert!(p.save_routine_schedule(&id, Some(invalid)).is_err());
        drop(p);
        let mut reopened = Player::new(data, PathBuf::new(), true);
        assert_eq!(
            reopened.routines("2026-10-09").unwrap()["runs"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        reopened.remove_routine(&id).unwrap();
        assert_eq!(
            reopened.routines("2026-10-02").unwrap()["runs"][0]["progress"][&item]["skipped"],
            true
        );
    }
}

#[cfg(test)]
mod sequence_tests {
    use super::*;
    fn save_source(p:&mut Player,step:&str,hand:&str,speed:f64,original:bool)->(String,String,PathBuf){
        let notes=(0..4).map(|_|format!("<note><pitch><step>{step}</step><octave>4</octave></pitch><duration>1</duration></note>")).collect::<String>();
        let xml=format!("<score-partwise><part-list><score-part id='P1'><part-name>Piano</part-name></score-part></part-list><part id='P1'><measure number='1'><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>{notes}</measure></part></score-partwise>");
        p.command(Command::ImportScore{bytes:xml.into_bytes(),name:format!("{step}曲.musicxml"),default_bpm:120}).unwrap();
        p.command(Command::Mode{value:"wait".into()}).unwrap();p.command(Command::CountIn{bars:0}).unwrap();
        p.command(Command::Track{id:p.notes[0].track_id,mode:"human".into(),part:hand.into(),visible:true}).unwrap();
        p.command(Command::Speed{value:speed}).unwrap();
        let cid=p.file.as_ref().unwrap().content_id.clone();let path=p.file.as_ref().unwrap().source_path.clone().unwrap();
        let saved=if original {
            let ppq=u64::from(p.file.as_ref().unwrap().musical_time.ppq);let v=p.preview_score_range_trim(0,0,ppq/2,ppq/2).unwrap();
            p.save_score_passage(None,"原谱短句".into(),"右手放松".into(),serde_json::from_value(v["range"].clone()).unwrap()).unwrap()
        }else{
            let v=p.preview_tick_range(&cid,&p.grid_signature(),&crate::tick_ranges::BeatPoint{measure:1,beat:1.5},&crate::tick_ranges::BeatPoint{measure:1,beat:3.5}).unwrap();
            p.save_tick_passage(None,"连接短句".into(),"左手稳定".into(),serde_json::from_value(v["range"].clone()).unwrap()).unwrap()
        };
        (cid,saved["passage"]["id"].as_str().unwrap().into(),path)
    }
    #[test]
    fn cross_sequence_reads_original_and_precise_sources_without_changing_session(){
        let data=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../work/cycle185-unit").join(new_id("case"));
        let mut p=Player::new(data.clone(),PathBuf::new(),true);
        let (a,ai,ap)=save_source(&mut p,"C","right",0.6,true);let (b,bi,_)=save_source(&mut p,"D","left",0.85,false);
        let rid=p.save_routine(None,None,"两曲短句".into(),"".into(),None).unwrap()["id"].as_str().unwrap().to_owned();
        let goal=RoutineGoal{expression:None,passes:1,accuracy:90,on_time:None,consecutive:false,attempt_limit:4};
        let entries=vec![PassageSequenceEntry{id:ai,copies:1,content_id:Some(a.clone())},PassageSequenceEntry{id:bi,copies:1,content_id:Some(b.clone())}];
        let state=p.state.clone();let score=serde_json::to_value(p.matcher.snapshot()).unwrap();let prefs=std::fs::read(&p.preferences_path).unwrap();let hist=std::fs::read(p.data.join("web-practice-history.ron")).unwrap();
        let catalog=p.passage_catalog(None,"短句",0).unwrap();assert_eq!(catalog["total"],2);assert_eq!(p.passage_catalog(Some(&a),"",0).unwrap()["total"],1);assert!(p.passage_catalog(None,"",50).unwrap()["rows"].as_array().unwrap().is_empty());
        let preview=p.compose_passages(&rid,None,&b,&entries,&goal,None).unwrap();assert_eq!(preview["items"][0]["target"]["kind"],"scorePassage");assert_eq!(preview["items"][1]["target"]["kind"],"precisePassage");
        assert_eq!(p.file.as_ref().unwrap().content_id,b);assert_eq!(p.state.position,state.position);assert_eq!(serde_json::to_value(p.matcher.snapshot()).unwrap(),score);assert_eq!(std::fs::read(&p.preferences_path).unwrap(),prefs);assert_eq!(std::fs::read(p.data.join("web-practice-history.ron")).unwrap(),hist);
        p.preferences.passages.get_mut(&a).unwrap()[0].speed=0.65;
        assert!(p.compose_passages(&rid,None,&b,&entries,&goal,preview["proof"].as_str()).is_err());assert!(p.preferences.routines[0].items.is_empty());p.preferences.passages.get_mut(&a).unwrap()[0].speed=0.6;
        let bytes=std::fs::read(&ap).unwrap();std::fs::write(&ap,b"not a midi").unwrap();assert!(p.compose_passages(&rid,None,&b,&entries,&goal,None).is_err());assert!(p.preferences.routines[0].items.is_empty());std::fs::write(&ap,bytes).unwrap();
        let preview=p.compose_passages(&rid,None,&b,&entries,&goal,None).unwrap();let path=p.preferences_path.clone();p.preferences_path=data.clone();assert!(p.compose_passages(&rid,None,&b,&entries,&goal,preview["proof"].as_str()).is_err());assert!(p.preferences.routines[0].items.is_empty());p.preferences_path=path;
        let saved=p.compose_passages(&rid,None,&b,&entries,&goal,preview["proof"].as_str()).unwrap();assert_eq!(saved["count"],2);assert!(p.compose_passages(&rid,None,&b,&entries,&goal,preview["proof"].as_str()).is_err());
        let snapshot:crate::practice_backup::Backup=serde_json::from_value(p.practice_backup_snapshot(&crate::practice_backup::Selection::default()).unwrap()).unwrap();let backup=crate::practice_backup::Backup::decode(&snapshot.encode().unwrap()).unwrap();assert_eq!(backup.routines[0].items[0].content_id,a);
        drop(p);let mut p=Player::new(data,PathBuf::new(),true);let first=p.preferences.routines[0].items[0].id.clone();
        p.open_routine_item(&rid,"2026-10-02",&first,true).unwrap();assert_eq!(p.file.as_ref().unwrap().content_id,a);assert_eq!(p.state.speed,0.6);p.command(Command::Play).unwrap();
        for _ in 0..500 {p.tick(Duration::from_millis(10));for pitch in p.snapshot().required {p.command(Command::Note{pitch,velocity:90,active:true}).unwrap();p.command(Command::Note{pitch,velocity:0,active:false}).unwrap();}if p.routine_status().unwrap()["progress"]["completed"]==true{break;}}
        assert_eq!(p.routine_status().unwrap()["progress"]["completed"],true);let next=p.routine_status().unwrap()["nextItemId"].as_str().unwrap().to_owned();p.open_routine_item(&rid,"2026-10-02",&next,true).unwrap();assert_eq!(p.file.as_ref().unwrap().content_id,b);assert_eq!(p.state.speed,0.85);assert!(p.config.tracks.iter().any(|t|t.practice_part==PracticePart::LeftHand&&t.player==PlayerConfig::Human));
    }
    #[test]
    fn sequence_snapshots_atomic_stale_rejection_restart_and_daily_isolation(){
        let data=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../work/cycle184-unit").join(new_id("case"));
        let mut p=Player::new(data.clone(),PathBuf::new(),true);
        p.command(Command::Generate{spec:ExerciseSpec::default()}).unwrap();
        p.command(Command::Mode{value:"wait".into()}).unwrap();
        p.command(Command::CountIn{bars:0}).unwrap();
        let cid=p.file.as_ref().unwrap().content_id.clone();
        p.command(Command::Speed{value:0.6}).unwrap();
        p.command(Command::SavePassage{content_id:None,id:Some("a".into()),name:"慢练开头".into(),start:1,end:1,notes:"放松手腕".into()}).unwrap();
        p.command(Command::Speed{value:0.85}).unwrap();
        let v=p.preview_tick_range(&cid,&p.grid_signature(),&crate::tick_ranges::BeatPoint{measure:2,beat:1.5},&crate::tick_ranges::BeatPoint{measure:2,beat:3.5}).unwrap();
        p.command(Command::SaveTickPassage{id:None,name:"连接短句".into(),notes:"保持稳定".into(),range:serde_json::from_value(v["range"].clone()).unwrap()}).unwrap();
        let b=p.preferences.passages[&cid][1].id.clone();
        let rid=p.save_routine(None,None,"片段顺序".into(),"".into(),None).unwrap()["id"].as_str().unwrap().to_owned();
        let goal=RoutineGoal{expression:None,passes:1,accuracy:90,on_time:None,consecutive:false,attempt_limit:4};
        let entries=vec![PassageSequenceEntry{id:b.clone(),copies:2,content_id:None},PassageSequenceEntry{id:"a".into(),copies:1,content_id:None}];
        let before=serde_json::to_value(&p.preferences.routines).unwrap();
        let preview=p.compose_passages(&rid,None,&cid,&entries,&goal,None).unwrap();
        assert_eq!(preview["count"],3);assert_eq!(preview["items"][0]["speed"],0.85);assert_eq!(preview["items"][2]["speed"],0.6);
        assert_eq!(preview["items"][0]["target"]["kind"],"precisePassage");
        assert_eq!(serde_json::to_value(&p.preferences.routines).unwrap(),before);
        let bad=vec![PassageSequenceEntry{id:"a".into(),copies:1,content_id:None},PassageSequenceEntry{id:"missing".into(),copies:1,content_id:None}];
        assert!(p.compose_passages(&rid,Some("2026-10-02"),&cid,&bad,&goal,None).is_err());
        assert!(p.preferences.routine_runs.is_empty());
        p.preferences.passages.get_mut(&cid).unwrap()[0].notes="改动条件".into();
        assert!(p.compose_passages(&rid,None,&cid,&entries,&goal,preview["proof"].as_str()).unwrap_err().contains("重新审阅"));
        assert_eq!(serde_json::to_value(&p.preferences.routines).unwrap(),before);
        let preview=p.compose_passages(&rid,None,&cid,&entries,&goal,None).unwrap();
        let saved=p.compose_passages(&rid,None,&cid,&entries,&goal,preview["proof"].as_str()).unwrap();
        assert_eq!(saved["ids"].as_array().unwrap().len(),3);
        assert_ne!(saved["ids"][0],saved["ids"][1]);
        p.ensure_routine_day(&rid,"2026-10-02").unwrap();
        let first=saved["ids"][0].as_str().unwrap().to_owned();
        p.mark_routine_item(&rid,"2026-10-02",&first,false,"课堂已练").unwrap();
        let daily=p.compose_passages(&rid,Some("2026-10-02"),&cid,&entries[1..],&goal,None).unwrap();
        p.compose_passages(&rid,Some("2026-10-02"),&cid,&entries[1..],&goal,daily["proof"].as_str()).unwrap();
        assert_eq!(p.preferences.routines[0].items.len(),3);
        let run=&p.preferences.routine_runs[&run_key(&rid,"2026-10-02")];assert_eq!(run.routine.items.len(),4);assert!(run.progress[&first].skipped);
        let snapshot:crate::practice_backup::Backup=serde_json::from_value(p.practice_backup_snapshot(&crate::practice_backup::Selection::default()).unwrap()).unwrap();let backup=crate::practice_backup::Backup::decode(&snapshot.encode().unwrap()).unwrap();assert_eq!(backup.routines[0].items.len(),3);
        drop(p);let p=Player::new(data,PathBuf::new(),true);assert_eq!(p.preferences.routines[0].items[0].speed,0.85);assert!(p.preferences.routine_runs[&run_key(&rid,"2026-10-02")].progress[&first].skipped);
    }
}
