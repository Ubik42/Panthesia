//! Detached backup inspection: memory candidates enter, read-only conflict reports leave.
use crate::{
    Engine, library_workspace,
    practice_backup::{Backup, Selection, seed_fingerprint, collision_key, session_key},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};

pub(crate) enum PreviewInput {
    Bytes(Vec<u8>),
    Decoded(Backup),
}

impl Engine {
    pub(super) fn practice_backup_preview_task(
        &self,
        input: PreviewInput,
    ) -> Result<Value, String> {
        let engine = self.clone();
        self.tasks.run("预览练习备份", None, move |token| {
            token.check()?;
            token.stage("decoding")?;
            let (backup, bytes) = match input {
                PreviewInput::Bytes(bytes) => (Backup::decode(&bytes)?, Some(bytes)),
                PreviewInput::Decoded(backup) => {
                    backup.validate()?;
                    (backup, None)
                }
            };
            token.check()?;
            let selection = Selection::default();
            let seed = engine.backup_seed(selection.clone(), None, || token.check())?;
            let expected = seed_fingerprint(&seed, || token.check())?;
            token.stage("comparing")?;
            let mut preview = inspect_snapshot(&engine.data, &seed, &backup, || token.check())?;
            token.check()?;
            let current = engine.backup_seed(selection, Some(seed.created_at), || token.check())?;
            if expected != seed_fingerprint(&current, || token.check())? {
                return Err("预览期间本机练习资料已变化，请重新选择备份".into());
            }
            token.check()?;
            if let Some(bytes) = bytes {
                let key = blake3::hash(&bytes).to_hex().to_string();
                let path = engine
                    .data
                    .join("practice-transfers")
                    .join(format!("{key}.neopractice"));
                token.begin_commit()?;
                panthesia_core::utils::atomic_file::write(&path, &bytes)
                    .map_err(|e| e.to_string())?;
                preview["token"] = json!(key);
            }
            Ok(preview)
        })
    }
}

pub(super) fn inspect_snapshot(
    data: &Path,
    memory: &Backup,
    b: &Backup,
    check: impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    let lock = library_workspace::lock_for(data)?;
    let _guard = lock.lock().map_err(|_| "曲库资料正忙")?;
    check()?;
    let local = &memory.history;
    let conflicts = b
        .routines
        .iter()
        .filter(|r| {
            memory.routines.iter().any(|l| {
                l.id == r.id && serde_json::to_value(l).unwrap() != serde_json::to_value(r).unwrap()
            })
        })
        .count();
    let duplicate = b
        .history
        .iter()
        .map(|(cid, h)| {
            h.sessions
                .iter()
                .filter(|s| {
                    local.get(cid).is_some_and(|l| {
                        l.sessions
                            .iter()
                            .any(|x| session_key(x) == session_key(s) && x.same_performance(s))
                    })
                })
                .count()
        })
        .sum::<usize>();
    let known = library_workspace::Workspace::load(data).ok();
    let mut refs = BTreeMap::new();
    check()?;
    for r in b.routines.iter().chain(b.runs.values().map(|r| &r.routine)) {
        for i in &r.items {
            refs.entry(i.content_id.clone()).or_insert(json!({"contentId":i.content_id,"title":i.song_title,"generated":i.exercise.is_some(),"indexed":known.as_ref().is_some_and(|w|w.entries.values().any(|e|e.content_id.as_ref()==Some(&i.content_id)))}));
        }
    }
    let mut conflict_rows = vec![];
    check()?;
    for (cid, plan) in &b.learning {
        let entry = known.as_ref().and_then(|w| {
            w.entries
                .values()
                .find(|entry| entry.content_id.as_ref() == Some(cid))
        });
        let title = entry
            .and_then(|entry| entry.metadata.title.clone())
            .unwrap_or_else(|| {
                if plan.title.is_empty() {
                    format!("未定位曲目 · {}", &cid[..12])
                } else {
                    plan.title.clone()
                }
            });
        refs.entry(cid.clone()).or_insert(
            json!({"contentId":cid,"title":title,"generated":false,"indexed":entry.is_some()}),
        );
        if known
            .as_ref()
            .and_then(|w| w.learning.get(cid))
            .is_some_and(|local| local != plan)
        {
            conflict_rows.push(json!({"kind":"曲目学习","local":title,"incoming":title}));
        }
    }

    check()?;
    for r in &b.routines {
        if let Some(local) = memory.routines.iter().find(|v| v.id == r.id) {
            if serde_json::to_value(local).unwrap() != serde_json::to_value(r).unwrap() {
                conflict_rows.push(json!({"kind":"计划","local":local.name,"incoming":r.name}));
            }
        }
    }
    let day_conflicts = b
        .runs
        .iter()
        .filter(|(key, r)| {
            memory.runs.get(*key).is_some_and(|local| {
                serde_json::to_value(local).unwrap() != serde_json::to_value(r).unwrap()
            })
        })
        .count();
    let mut preset_conflicts = 0;
    if let Some(incoming) = &b.repertoire {
        let local = crate::repertoire::read(data)?.0;
        for (id, work) in &incoming.works {
            if local.works.get(id).is_some_and(|old|serde_json::to_value(old).ok()!=serde_json::to_value(work).ok()) {
                preset_conflicts += 1;
                conflict_rows.push(json!({"kind":"作品资料","local":local.works[id].title,"incoming":work.title}));
            }
        }
        for (id, performance) in &incoming.performances {
            if local.performances.get(id).is_some_and(|old|old.work_id != performance.work_id) {
                preset_conflicts += 1;
                conflict_rows.push(json!({"kind":"演奏作品关联","local":local.performances[id].label,"incoming":performance.label}));
            }
        }
        for (id, notation) in &incoming.notations {
            if local.notations.get(id).is_some_and(|old|serde_json::to_value(old).ok()!=serde_json::to_value(notation).ok()) {
                preset_conflicts += 1;
                conflict_rows.push(json!({"kind":"谱面校对资料","local":local.notations[id].name,"incoming":notation.name}));
            }
        }
    }
    check()?;
    for (cid, rows) in &b.bookmarks {
        for row in rows {if memory.bookmarks.get(cid).is_some_and(|local|local.iter().any(|old|old.id==row.id&&old!=row)){preset_conflicts+=1;}}
    }
    for (cid, rows) in &b.passages {
        for r in rows {
            if memory.passages.get(cid).is_some_and(|local| {
                local.iter().any(|v| {
                    v.id == r.id
                        && serde_json::to_value(v).unwrap() != serde_json::to_value(r).unwrap()
                })
            }) {
                preset_conflicts += 1;
            }
        }
    }
    check()?;
    for (cid, rows) in &b.ladders {
        for r in rows {
            if memory.ladders.get(cid).is_some_and(|local| {
                local.iter().any(|v| {
                    v.id == r.id
                        && serde_json::to_value(v).unwrap() != serde_json::to_value(r).unwrap()
                })
            }) {
                preset_conflicts += 1;
            }
        }
    }
    preset_conflicts += b
        .exercises
        .iter()
        .filter(|r| {
            memory.exercises.iter().any(|v| {
                v.id == r.id && serde_json::to_value(v).unwrap() != serde_json::to_value(r).unwrap()
            })
        })
        .count();
    preset_conflicts += b
        .ladder_runs
        .iter()
        .filter(|(key, r)| {
            memory.ladder_runs.get(*key).is_some_and(|local| {
                serde_json::to_value(local).unwrap() != serde_json::to_value(r).unwrap()
            })
        })
        .count();
    preset_conflicts += b
        .track_sounds
        .iter()
        .map(|(cid, rows)| {
            rows.iter()
                .filter(|(id, s)| {
                    memory
                        .track_sounds
                        .get(cid)
                        .and_then(|m| m.get(id))
                        .is_some_and(|old| old != *s)
                })
                .count()
        })
        .sum::<usize>();
    preset_conflicts += b
        .track_appearances
        .iter()
        .map(|(cid, rows)| {
            rows.iter()
                .filter(|(id, a)| {
                    memory
                        .track_appearances
                        .get(cid)
                        .and_then(|m| m.get(id))
                        .is_some_and(|old| old != *a)
                })
                .count()
        })
        .sum::<usize>();
    let describe_goal = |goal: &crate::expression_goal::ExpressionGoal| {
        let mut parts = Vec::new();
        if let Some(value) = goal.velocity_difference {
            parts.push(format!("力度平均差 ≤ {value}"));
        }
        if let Some(value) = goal.note_velocity_difference {
            parts.push(format!("逐音力度差 ≤ {value}"));
        }
        if let Some(value) = goal.note_pedal_mismatch_count {
            parts.push(format!("逐音踏板错配 ≤ {value} 个"));
        }
        if let Some(value) = goal.contour_percent {
            parts.push(format!("起伏一致率 ≥ {value}%"));
        }
        if let Some(value) = goal.pedal_offset_ms {
            parts.push(format!("踏板偏移 ≤ {value} ms"));
        }
        parts.join(" · ")
    };
    check()?;
    for (cid, incoming) in &b.song_expression_goals {
        if let Some(local) = memory
            .song_expression_goals
            .get(cid)
            .filter(|local| *local != incoming)
        {
            preset_conflicts += 1;
            let title = known
                .as_ref()
                .and_then(|workspace| {
                    workspace
                        .entries
                        .values()
                        .find(|entry| entry.content_id.as_ref() == Some(cid))
                })
                .and_then(|entry| entry.metadata.title.as_deref())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("曲目 {}…", &cid[..12]));
            conflict_rows.push(json!({"kind":"单曲力度与踏板目标","local":format!("{title}：{}",describe_goal(local)),"incoming":format!("{title}：{}",describe_goal(incoming))}));
        }
    }
    let templates = crate::metadata_templates::snapshot_unlocked(data);
    if let Ok(local) = &templates {
        for (name, rules) in &b.metadata_templates {
            if local.get(name).is_some_and(|r| r != rules) {
                preset_conflicts += 1;
                conflict_rows.push(json!({"kind":"资料模板","local":name,"incoming":name}));
            }
        }
    }
    let mut performance_conflicts = 0;
    let mut performance_duplicates = 0;
    let mut performance_errors = Vec::new();
    check()?;
    for (cid, rows) in &b.performances {
        check()?;
        for (id, a) in rows {
            check()?;
            // Different performances with the same record ID get a new ID on import.
            if !local.get(cid).is_some_and(|h| {
                h.sessions.iter().any(|s| {
                    session_key(s) == *id
                        && b.history[cid]
                            .sessions
                            .iter()
                            .any(|other| session_key(other) == *id && s.same_performance(other))
                })
            }) {
                continue;
            }
            if crate::performance_archive::available(data, cid, id) {
                match crate::performance_archive::read(data, cid, id) {
                    Ok(old) if old.bytes().ok() == a.bytes().ok() => performance_duplicates += 1,
                    Ok(old) => {
                        performance_conflicts += 1;
                        if performance_conflicts <= 100 {
                            conflict_rows.push(json!({"kind":"演奏回放","local":format!("{} · {} · {} 个按键/踏板事件",b.history[cid].display_name,id,old.inputs.len()),"incoming":format!("{} · {} · {} 个按键/踏板事件",b.history[cid].display_name,id,a.inputs.len())}));
                        }
                    }
                    Err(error) => {
                        performance_errors.push(json!({"contentId":cid,"id":id,"error":error}))
                    }
                }
            }
        }
    }
    check()?;
    let mut v = b.summary();
    let metadata_history_plan =
        library_workspace::Workspace::load(data).and_then(|mut workspace| {
            crate::metadata_history::merge(data, &mut workspace, &b.metadata_history)
        });
    match metadata_history_plan {
        Ok(plan) => {
            v["metadataHistoryAdded"] = json!(plan.added);
            v["metadataHistoryDuplicates"] = json!(plan.duplicates);
            v["metadataHistoryUnmatched"] = json!(plan.unmatched);
            v["metadataHistoryAmbiguous"] = json!(plan.ambiguous);
            v["metadataHistoryPendingAdded"] = json!(plan.pending_added);
            v["metadataHistoryError"] = Value::Null;
        }
        Err(error) => {
            v["metadataHistoryError"] = json!(error);
        }
    }
    v["performanceConflicts"] = json!(performance_conflicts);
    v["duplicatePerformances"] = json!(performance_duplicates);
    v["performanceErrors"] = json!(performance_errors);
    v["templateError"] = json!(if b.metadata_templates.is_empty() {
        None
    } else {
        templates.err()
    });
    v["learningConflicts"] = json!(
        b.learning
            .iter()
            .filter(|(cid, plan)| known
                .as_ref()
                .and_then(|w| w.learning.get(*cid))
                .is_some_and(|local| local != *plan))
            .count()
    );
    v["conflicts"] = json!(conflicts);
    v["dayConflicts"] = json!(day_conflicts);
    v["presetConflicts"] = json!(preset_conflicts);
    v["conflictRows"] = json!(conflict_rows);
    v["duplicateRecords"] = json!(duplicate);
    v["annotationConflicts"] = json!(
        b.history
            .iter()
            .map(|(cid, h)| h
                .sessions
                .iter()
                .filter(|s| s.annotation.is_some()
                    && local
                        .get(cid)
                        .is_some_and(|l| l.sessions.iter().any(|x| session_key(x)
                            == session_key(s)
                            && x.same_performance(s)
                            && x.annotation.is_some()
                            && x.annotation != s.annotation)))
                .count())
            .sum::<usize>()
    );
    let mut time_duplicates = 0;
    let mut time_conflicts = 0;
    check()?;
    for (cid, rows) in &b.time_ledger {
        for (id, incoming) in rows {
            if let Some(local) = memory.time_ledger.get(cid).and_then(|r| r.get(id)) {
                if local == incoming {
                    time_duplicates += 1;
                } else {
                    time_conflicts += 1;
                }
            }
        }
    }
    v["timeLedgerDuplicates"] = json!(time_duplicates);
    v["timeLedgerConflicts"] = json!(time_conflicts);
    v["replayClipConflicts"] = json!(
        b.history
            .iter()
            .map(|(cid, h)| h
                .sessions
                .iter()
                .map(|s| local
                    .get(cid)
                    .and_then(
                        |l| l.sessions.iter().find(|x| (session_key(x) == session_key(s)
                            || session_key(x) == collision_key(s))
                            && x.same_performance(s))
                    )
                    .map(|x| s
                        .replay_clips
                        .iter()
                        .filter(|c| x.replay_clips.iter().any(|old| old.id == c.id && old != *c))
                        .count())
                    .unwrap_or(0))
                .sum::<usize>())
            .sum::<usize>()
    );
    v["references"] = json!(refs.into_values().collect::<Vec<_>>());
    check()?;
    Ok(v)
}
