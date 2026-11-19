//! Scheduled day preparation and response serialization happen on a worker snapshot.
use crate::preferences::Shared;
use crate::routine_commands::{PracticeRoutine, RoutineRun, RoutineState, RoutineList, RoutineSummary, day_valid, run_key};
use crate::*;
use std::collections::BTreeMap;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadRequest {
    pub day: String,
    pub scope: Option<crate::history_reader::ReadScope>,
    pub engine_id: Option<String>,
}

type Plans = Shared<Vec<PracticeRoutine>>;
type Runs = crate::shared_map::SharedMap<String, RoutineRun>;
pub(crate) struct Context {
    plans: Plans,
    runs: Runs,
    active: Option<RoutineState>,
}
pub(crate) struct Prepared {
    origin: Context,
    runs: Option<Runs>,
    value: serde_json::Value,
}
pub(crate) struct Installation {
    plans: Plans,
    origin: Runs,
    next: Runs,
}
impl Prepared {
    fn installation(&self) -> Option<Installation> {
        self.runs.as_ref().map(|next| Installation {
            plans: self.origin.plans.clone(),
            origin: self.origin.runs.clone(),
            next: next.clone(),
        })
    }
}
impl Context {
    fn prepare(self, day: &str, token: &background_tasks::TaskToken) -> Result<Prepared, String> {
        if !day_valid(day) {
            return Err("日期无效".into());
        }
        token.check()?;
        let due: Vec<_> = self
            .plans
            .iter()
            .filter(|plan| {
                !plan.items.is_empty()
                    && plan
                        .schedule
                        .as_ref()
                        .is_some_and(|schedule| schedule.matches(day))
            })
            .map(|plan| plan.id.clone())
            .collect();
        let missing: Vec<_> = due
            .iter()
            .filter(|id| !self.runs.contains_key(&run_key(id, day)))
            .collect();
        if self.runs.len() + missing.len() > 10000 {
            return Err("日期安排已到容量上限".into());
        }
        let runs = if missing.is_empty() {
            None
        } else {
            let mut runs = self.runs.clone();
            for id in missing {
                token.check()?;
                let routine = self
                    .plans
                    .iter()
                    .find(|plan| &plan.id == id)
                    .cloned()
                    .ok_or("常用计划已移除，无法创建当天安排")?;
                runs.insert(
                    run_key(id, day),
                    RoutineRun {
                        day: day.into(),
                        routine,
                        progress: BTreeMap::new(),
                        last_item: None,
                    },
                );
            }
            Some(runs)
        };
        token.check()?;
        let view = runs.as_ref().unwrap_or(&self.runs);
        let value = serde_json::to_value(RoutineList {
            versions: crate::routine_protocol::versions(&self.plans, view, day)?,
            plans: self.plans.clone(),
            runs: view.values().filter(|run| run.day == day).cloned().collect(),
            due,
            active: self.active.clone(),
        }).map_err(|error| error.to_string())?;
        token.check()?;
        Ok(Prepared {
            origin: self,
            runs,
            value,
        })
    }
}
impl Player {
    pub(super) fn capture_routine_reader(&self) -> Context {
        Context {
            plans: self.preferences.routines.clone(),
            runs: self.preferences.routine_runs.clone(),
            active: self.routine_state(),
        }
    }
    pub(super) fn install_routine_days(
        &mut self,
        prepared: &Installation,
        token: &background_tasks::TaskToken,
    ) -> Result<bool, String> {
        if !self.preferences.routines.same_snapshot(&prepared.plans)
            || !self
                .preferences
                .routine_runs
                .same_snapshot(&prepared.origin)
        {
            return Ok(false);
        }
        token.begin_commit()?;
        let previous = self.preferences.routine_runs.clone();
        self.preferences.routine_runs = prepared.next.clone();
        // This operation owns only the scheduled runs. Saving transport settings here
        // would create unrelated song/history changes while the user is opening a list.
        if let Err(error) = self.preferences.save(&self.preferences_path) {
            self.preferences.routine_runs = previous;
            return Err(error);
        }
        Ok(true)
    }
}
impl Engine {
    pub fn routine_templates(&self) -> Result<serde_json::Value, String> {
        let engine = self.clone();
        self.tasks.run("读取常用计划名称", None, move |token| {
            token.stage("readingPlans")?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::RoutineReadContext(reply))
                .map_err(|_| "音乐引擎已关闭")?;
            let context = receiver.recv().map_err(|_| "计划读取通道已关闭")??;
            let mut plans = Vec::with_capacity(context.plans.len());
            for plan in context.plans.iter() {
                token.check()?;
                plans.push(RoutineSummary { id: plan.id.clone(), name: plan.name.clone() });
            }
            Ok(serde_json::json!({"plans":plans}))
        })
    }

    pub(super) fn read_routines(&self, day: String) -> Result<serde_json::Value, String> {
        self.read_routine_list(ReadRequest { day, scope: None, engine_id: None })
    }
    pub fn read_routine_list(&self, request: ReadRequest) -> Result<serde_json::Value, String> {
        let ReadRequest { day, scope, engine_id } = request;
        if let Some(expected) = engine_id.as_deref() {
            self.check_engine(expected)?;
        }
        if self.closing.load(Ordering::Acquire) {
            return Err("正在关闭练习室，请等待完成".into());
        }
        storage_control::check_command(
            &self.storage_busy,
            &Command::Routines { day: day.clone() },
        )?;
        if scope.as_ref().is_some_and(|scope| {
            scope.channel.is_empty()
                || scope.channel.len() > 96
                || scope.sequence == 0
                || !scope
                    .channel
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        }) {
            return Err("计划查询通道无效".into());
        }
        if !day_valid(&day) {
            return Err("日期无效".into());
        }
        let engine = self.clone();
        let work = move |token: background_tasks::TaskToken| {
            token.stage("readingPlans")?;
            for _ in 0..3 {
                token.check()?;
                let (reply, receiver) = mpsc::sync_channel(1);
                engine
                    .tx
                    .send(runtime_request::Request::RoutineReadContext(reply))
                    .map_err(|_| "音乐引擎已关闭")?;
                let context = receiver.recv().map_err(|_| "计划读取通道已关闭")??;
                let prepared = context.prepare(&day, &token)?;
                let Some(installation) = prepared.installation() else {
                    return Ok(prepared.value);
                };
                let (reply, receiver) = mpsc::sync_channel(1);
                engine
                    .tx
                    .send(runtime_request::Request::RoutineDaysCommit {
                        prepared: installation,
                        token: token.clone(),
                        reply,
                    })
                    .map_err(|_| "音乐引擎已关闭")?;
                if receiver.recv().map_err(|_| "日期安排保存通道已关闭")?? {
                    return Ok(prepared.value);
                }
            }
            Err("计划或练习进度正在更新，请重新打开计划列表".into())
        };
        if let Some(scope) = scope {
            self.tasks.run_latest(
                format!("routine-read:{}", scope.channel),
                scope.sequence,
                "读取练习计划",
                None,
                work,
            )
        } else {
            self.tasks.run("读取练习计划", None, work)
        }
    }
}
