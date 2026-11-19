use crate::routine_commands::{PracticeRoutine, RoutineGoal, RoutineRun, RoutineSchedule, run_key};
use crate::{Command, shared_map::SharedMap};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineVersion {
    pub id: String,
    pub day: Option<String>,
    pub revision: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoutineEditRequest {
    pub routine_id: String,
    pub day: Option<String>,
    pub expected: String,
    pub change: RoutineChange,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RoutineChange {
    Metadata {
        name: String,
        notes: String,
    },
    #[serde(rename_all = "camelCase")]
    Item {
        id: String,
        content_id: Option<String>,
        source: Option<String>,
        source_id: Option<String>,
        title: String,
        notes: String,
        goal: RoutineGoal,
    },
    #[serde(rename_all = "camelCase")]
    MoveItem {
        item_id: String,
        direction: i8,
    },
    #[serde(rename_all = "camelCase")]
    RemoveItem {
        item_id: String,
    },
    Schedule {
        schedule: Option<RoutineSchedule>,
    },
    Remove,
    #[serde(rename_all = "camelCase")]
    Copy {
        request_id: String,
        name: String,
        notes: String,
    },
}

impl RoutineEditRequest {
    pub(super) fn command(self) -> Result<(Command, String), String> {
        if self.expected.len() != 64 || !self.expected.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("计划版本无效，请重新读取后核对修改".into());
        }
        let id = self.routine_id;
        let day = self.day;
        let command = match self.change {
            RoutineChange::Metadata { name, notes } => Command::SaveRoutine {
                id: Some(id),
                day,
                name,
                notes,
                copy_of: None,
                request_id: None,
            },
            RoutineChange::Item {
                id: item,
                content_id,
                source,
                source_id,
                title,
                notes,
                goal,
            } => Command::SaveRoutineItem {
                routine_id: id,
                day,
                id: Some(item),
                content_id,
                source,
                source_id,
                title,
                notes,
                goal,
            },
            RoutineChange::MoveItem { item_id, direction } => Command::MoveRoutineItem {
                routine_id: id,
                day,
                item_id,
                direction,
            },
            RoutineChange::RemoveItem { item_id } => Command::RemoveRoutineItem {
                routine_id: id,
                day,
                item_id,
            },
            RoutineChange::Schedule { schedule } if day.is_none() => {
                Command::SaveRoutineSchedule { id, schedule }
            }
            RoutineChange::Remove if day.is_none() => Command::RemoveRoutine { id },
            RoutineChange::Copy {
                request_id,
                name,
                notes,
            } => Command::SaveRoutine {
                id: None,
                day,
                name,
                notes,
                copy_of: Some(id),
                request_id: Some(request_id),
            },
            _ => return Err("周期安排与常用计划移除需要选择模板".into()),
        };
        Ok((command, self.expected))
    }
}

pub(super) fn revision(plan: Option<&PracticeRoutine>) -> Result<String, String> {
    serde_json::to_vec(&plan)
        .map(|bytes| blake3::hash(&bytes).to_hex().to_string())
        .map_err(|error| error.to_string())
}

pub(super) fn versions(
    plans: &[PracticeRoutine],
    runs: &SharedMap<String, RoutineRun>,
    day: &str,
) -> Result<Vec<RoutineVersion>, String> {
    let mut versions = Vec::new();
    let ids = plans
        .iter()
        .map(|plan| plan.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    for plan in plans {
        versions.push(RoutineVersion {
            id: plan.id.clone(),
            day: None,
            revision: revision(Some(plan))?,
        });
        let current = runs
            .get(&run_key(&plan.id, day))
            .map_or(plan, |run| &run.routine);
        versions.push(RoutineVersion {
            id: plan.id.clone(),
            day: Some(day.into()),
            revision: revision(Some(current))?,
        });
    }
    for run in runs
        .values()
        .filter(|run| run.day == day && !ids.contains(run.routine.id.as_str()))
    {
        versions.push(RoutineVersion {
            id: run.routine.id.clone(),
            day: Some(day.into()),
            revision: revision(Some(&run.routine))?,
        });
    }
    Ok(versions)
}
