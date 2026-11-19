//! An exclusive background import owns disk writes; the player installs only a finished outcome.
use crate::{
    practice_backup::{
        Backup, Selection, collision_key, commit, merge_rows, selected, session_key,
    },
    routine_commands::RoutineTarget,
    *,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::PathBuf};

const BUSY: &str = "练习资料正在保存或恢复，请稍候；止音仍可使用";
pub(crate) enum Input {
    Decoded(Backup),
    Staged(String),
}

impl Engine {
    pub(super) fn practice_backup_import_task(
        &self,
        input: Input,
        selection: Selection,
        policy: String,
    ) -> Result<Value, String> {
        let engine = self.clone();
        let preparing=self.pending_operation()?;
        self.tasks.run("导入练习资料", None, move |token| {
            let _preparing = preparing;
            engine.import_backup_with_token(input, selection, policy, token)
        })
    }
    pub(crate) fn import_backup_with_token(
        &self, input: Input, selection: Selection, policy: String,
        token: background_tasks::TaskToken,
    ) -> Result<Value, String> {
        let engine = self.clone();
        token.check()?;
        token.stage("decoding")?;
        let backup = match input {
            Input::Decoded(backup) => backup,
            Input::Staged(key) => {
                if key.len() != 64 || !key.bytes().all(|c| c.is_ascii_hexdigit()) {
                    return Err("备份预览已失效，请重新选择文件".into());
                }
                use std::io::Read;
                let mut bytes = Vec::new();
                std::fs::File::open(
                    engine
                        .data
                        .join("practice-transfers")
                        .join(format!("{key}.neopractice")),
                )
                .map_err(|e| e.to_string())?
                .take(256_000_001)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
                if bytes.len() > 256_000_000 || blake3::hash(&bytes).to_hex().as_str() != key {
                    return Err("备份缓存校验失败，请重新选择文件".into());
                }
                Backup::decode(&bytes)?
            }
        };
        backup.validate()?;
        token.check()?;
        if !matches!(policy.as_str(), "keep" | "backup") {
            return Err("备份冲突策略无效".into());
        }
        if !selection.plans && !selection.records && !selection.presets {
            return Err("请选择要导入的练习资料".into());
        }
        let storage = engine.storage_tasks.clone();
        token.stage("waitingStorage")?;
        storage.run_owned("提交练习资料", move |storage_token| {
            token.check()?;
            storage_token.check()?;
            let (context, lease) = Lease::begin(engine.clone())?;
            if let Err(error) = engine.pending_saves.flush() {
                return lease.finish(Err(error));
            }
            token.stage("merging")?;
            let outcome = context.apply(
                backup,
                selection,
                policy,
                || {
                    token.check()?;
                    storage_token.check()
                },
                || {
                    token.begin_commit()?;
                    storage_token.begin_commit()
                },
            );
            lease.finish(outcome)
        })
    }
}

struct Lease {
    engine: Engine,
    id: String,
    released: bool,
}
impl Lease {
    fn begin(engine: Engine) -> Result<(Context, Self), String> {
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = format!(
            "import-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        );
        let (reply, receiver) = mpsc::sync_channel(1);
        engine
            .tx
            .send(runtime_request::Request::BackupImportBegin {
                id: id.clone(),
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let context = receiver.recv().map_err(|_| "音乐引擎已关闭")??;
        Ok((
            context,
            Self {
                engine,
                id,
                released: false,
            },
        ))
    }
    fn finish(mut self, result: Result<Outcome, String>) -> Result<Value, String> {
        self.engine.pending_saves.observe_recovery();
        let (reply, receiver) = mpsc::sync_channel(1);
        self.engine
            .tx
            .send(runtime_request::Request::BackupImportFinish {
                id: self.id.clone(),
                result,
                reply: Some(reply),
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let result = receiver.recv().map_err(|_| "音乐引擎已关闭")?;
        self.released = true;
        result
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if !self.released {
            self.engine.pending_saves.observe_recovery();
            let _ = self
                .engine
                .tx
                .send(runtime_request::Request::BackupImportFinish {
                    id: self.id.clone(),
                    result: Err("导入任务异常结束，未安装新的练习资料".into()),
                    reply: None,
                });
        }
    }
}

pub(crate) struct Context {
    data: PathBuf,
    preferences: Preferences,
    history: PracticeHistoryStore,
    latency: i32,
}
pub(crate) struct Outcome {
    preferences: Preferences,
    history: PracticeHistoryStore,
    report: Value,
    sound_changed: bool,
}
impl Context {
    pub(super) fn capture(player: &Player) -> Self {
        Self {
            data: player.data.clone(),
            preferences: player.preferences.clone(),
            history: player.history.clone(),
            latency: player.state.latency,
        }
    }
    pub(super) fn apply(
        &self,
        b: Backup,
        s: Selection,
        policy: String,
        check: impl Fn() -> Result<(), String>,
        begin_commit: impl Fn() -> Result<(), String>,
    ) -> Result<Outcome, String> {
        b.validate()?;
        if !matches!(policy.as_str(), "keep" | "backup") {
            return Err("备份冲突策略无效".into());
        }
        if !s.plans && !s.records && !s.presets {
            return Err("请选择要导入的练习资料".into());
        }
        check()?;
        crate::settings_storage::recover(&self.data)?;
        if crate::settings_storage::pending(&self.data) {
            return Err("设置恢复记录尚待处理，请重新启动后导入".into());
        }
        let lock = library_workspace::lock_for(&self.data)?;
        let _guard = lock.lock().map_err(|_| "曲库资料正忙")?;
        check()?;
        let mut workspace = library_workspace::Workspace::load(&self.data)?;
        let mut b = selected(b, &s);
        let metadata_history_plan =
            crate::metadata_history::merge(&self.data, &mut workspace, &b.metadata_history)?;
        let mut history = self.history.clone();
        let added_time_entries = history.merge_time_ledger(b.time_ledger.clone())?;
        let mut learning_changed = 0;
        check()?;
        for (cid, plan) in &b.learning {
            if workspace.learning.get(cid).is_none()
                || (policy == "backup" && workspace.learning.get(cid) != Some(plan))
            {
                workspace.learning.insert(cid.clone(), plan.clone());
                learning_changed += 1;
            }
        }
        if workspace.learning.len() > 10000 {
            return Err("合并后的学习曲目超过上限".into());
        }
        if learning_changed > 0 {
            workspace.revision = workspace.revision.saturating_add(1);
        }

        let replace = policy == "backup";
        let templates = if s.presets && !b.metadata_templates.is_empty() {
            crate::metadata_templates::merge_bytes_unlocked(
                &self.data,
                &b.metadata_templates,
                replace,
            )?
        } else {
            None
        };
        let mut prefs = self.preferences.clone();
        let repertoire = if s.presets {
            if let Some(incoming) = &b.repertoire {
                let mut local = crate::repertoire::read(&self.data)?.0;
                for (id, work) in &incoming.works { if replace || !local.works.contains_key(id) { local.works.insert(id.clone(), work.clone()); } }
                for (id, performance) in &incoming.performances {
                    let mut locations = local.performances.get(id).map(|p|p.locations.clone()).unwrap_or_default();
                    for path in &performance.locations { if !locations.contains(path) { locations.push(path.clone()); } }
                    if replace || !local.performances.contains_key(id) { local.performances.insert(id.clone(), performance.clone()); }
                    if let Some(existing) = local.performances.get_mut(id) { existing.locations = locations; }
                }
                for (id, notation) in &incoming.notations { if replace || !local.notations.contains_key(id) { local.notations.insert(id.clone(), notation.clone()); } }
                local.validate()?;
                Some(serde_json::to_vec_pretty(&local).map_err(|e|e.to_string())?)
            } else { None }
        } else { None };
        let mut songs = self.history.snapshot();
        let mut added = 0;
        let mut duplicates = 0;
        let mut collisions = 0;
        let mut trimmed = 0;
        let mut remap = BTreeMap::new();
        check()?;
        for (cid, h) in b.history {
            let local = songs.entry(cid.clone()).or_insert_with(|| {
                let mut copy = h.clone();
                copy.sessions.clear();
                copy
            });
            for mut session in h.sessions {
                check()?;
                let key = session_key(&session);
                if let Some(x) = local
                    .sessions
                    .iter_mut()
                    .find(|x| session_key(x) == key && x.same_performance(&session))
                {
                    if x.playing_ms.is_none() {
                        x.playing_ms = session.playing_ms;
                    }
                    if session.annotation.is_some() && (replace || x.annotation.is_none()) {
                        x.annotation = session.annotation.clone();
                    }
                    merge_rows(
                        &mut x.replay_clips,
                        &session.replay_clips,
                        |c| &c.id,
                        replace,
                        100,
                    )?;
                    duplicates += 1;
                    continue;
                }
                if local.sessions.iter().any(|x| session_key(x) == key) {
                    let new = collision_key(&session);
                    remap.insert((cid.clone(), key), new.clone());
                    session.id = Some(new);
                    if let Some(x) = local.sessions.iter_mut().find(|x| {
                        session_key(x) == session_key(&session) && x.same_performance(&session)
                    }) {
                        if x.playing_ms.is_none() {
                            x.playing_ms = session.playing_ms;
                        }
                        if session.annotation.is_some() && (replace || x.annotation.is_none()) {
                            x.annotation = session.annotation.clone();
                        }
                        merge_rows(
                            &mut x.replay_clips,
                            &session.replay_clips,
                            |c| &c.id,
                            replace,
                            100,
                        )?;
                        duplicates += 1;
                        continue;
                    }
                    collisions += 1;
                }
                local.sessions.push(session);
                added += 1;
            }
            local.sessions.sort_by_key(|v| v.recorded_at_unix_ms);
            if local.sessions.len() > 200 {
                trimmed += local.sessions.len() - 200;
                local.sessions.drain(..local.sessions.len() - 200);
            }
        }
        if s.plans {
            for r in &mut b.routines {
                for i in &mut r.items {
                    i.settings.latency = self.latency;
                    if let RoutineTarget::Ladder { preset } = &mut i.target {
                        preset.settings.latency = self.latency;
                    }
                }
            }
            for r in b.runs.values_mut() {
                for i in &mut r.routine.items {
                    i.settings.latency = self.latency;
                    if let RoutineTarget::Ladder { preset } = &mut i.target {
                        preset.settings.latency = self.latency;
                    }
                    if let Some(p) = r.progress.get_mut(&i.id) {
                        for id in &mut p.session_ids {
                            if let Some(new) = remap.get(&(i.content_id.clone(), id.clone())) {
                                *id = new.clone();
                            }
                        }
                    }
                }
            }
            merge_rows(&mut prefs.routines, &b.routines, |r| &r.id, replace, 100)?;
            for (k, r) in b.runs {
                if replace || !prefs.routine_runs.contains_key(&k) {
                    prefs.routine_runs.insert(k, r);
                }
            }
        }
        if s.presets {
            for (cid, goal) in b.song_expression_goals {
                if replace || !prefs.song_expression_goals.contains_key(&cid) {
                    prefs.song_expression_goals.insert(cid, goal);
                }
            }
            for (cid, rows) in b.track_appearances {
                for (id, a) in rows {
                    let local = prefs.track_appearances.entry(cid.clone()).or_default();
                    if replace || !local.contains_key(&id) {
                        local.insert(id, a);
                    }
                }
            }
            for (cid, rows) in b.track_sounds {
                for (id, sound) in rows {
                    let local = prefs.track_sounds.entry(cid.clone()).or_default();
                    if replace || !local.contains_key(&id) {
                        local.insert(id, sound);
                    }
                }
            }
            for (cid, mut rows) in b.passages {
                for p in &mut rows {
                    p.settings.latency = self.latency;
                }
                merge_rows(
                    prefs.passages.entry(cid).or_default(),
                    &rows,
                    |r| &r.id,
                    replace,
                    200,
                )?;
            }
            for (cid, mut rows) in b.ladders {
                for p in &mut rows {
                    p.settings.latency = self.latency;
                }
                merge_rows(
                    prefs.ladder_presets.entry(cid).or_default(),
                    &rows,
                    |r| &r.id,
                    replace,
                    200,
                )?;
            }
            for (k, mut r) in b.ladder_runs {
                r.active = false;
                r.preset.settings.latency = self.latency;
                if replace || !prefs.ladder_runs.contains_key(&k) {
                    prefs.ladder_runs.insert(k, r);
                }
            }
            merge_rows(
                &mut prefs.exercise_presets,
                &b.exercises,
                |r| &r.id,
                replace,
                1000,
            )?;
        }
        if prefs.track_appearances.len() > 10000
            || prefs.track_sounds.len() > 10000
            || prefs.routine_runs.len() > 10000
            || prefs.passages.len() > 10000
            || prefs.ladder_presets.len() > 10000
            || prefs.ladder_runs.len() > 10000
            || songs.len() > 10000
        {
            return Err("合并后的练习资料超过容量上限".into());
        }
        let mut performance_files = BTreeMap::new();
        let mut imported_performances = 0;
        let mut duplicate_performances = 0;
        let mut kept_performances = 0;
        let mut replaced_performances = 0;
        let mut trimmed_performances = 0;
        check()?;
        for (cid, rows) in b.performances {
            for (original_id, mut a) in rows {
                check()?;
                let id = remap
                    .get(&(cid.clone(), original_id.clone()))
                    .unwrap_or(&original_id);
                if !songs
                    .get(&cid)
                    .is_some_and(|h| h.sessions.iter().any(|s| session_key(s) == *id))
                {
                    trimmed_performances += 1;
                    continue;
                }
                a.reidentify(id);
                a.validate(&cid, id)?;
                let bytes = a.bytes()?;
                let path = crate::performance_archive::path(&self.data, &cid, id);
                let name = path.file_name().unwrap().to_str().unwrap().to_owned();
                if path.exists() {
                    match crate::performance_archive::read(&self.data, &cid, id) {
                        Ok(old) if old.bytes()? == bytes => {
                            duplicate_performances += 1;
                            continue;
                        }
                        Ok(_) if !replace => {
                            kept_performances += 1;
                            continue;
                        }
                        Err(error) if !replace => {
                            return Err(format!(
                                "本地回放损坏：{error}。请选择使用备份版本恢复，或取消成绩导入。"
                            ));
                        }
                        _ => replaced_performances += 1,
                    }
                } else {
                    imported_performances += 1;
                }
                performance_files.insert(name, bytes);
            }
        }
        history.replace_snapshot(songs);
        check()?;
        begin_commit()?;
        let restore = commit(
            &self.data,
            &prefs,
            &history,
            &workspace,
            templates.as_deref(),
            repertoire.as_deref(),
            &performance_files,
            &metadata_history_plan.files,
            metadata_history_plan.pending_file.as_deref(),
        )?;
        Ok(Outcome {
            sound_changed: self.preferences.track_sounds != prefs.track_sounds,
            preferences: prefs,
            history,
            report: json!({"metadataHistoryAdded":metadata_history_plan.added,"metadataHistoryDuplicates":metadata_history_plan.duplicates,"metadataHistoryUnmatched":metadata_history_plan.unmatched,"metadataHistoryAmbiguous":metadata_history_plan.ambiguous,"metadataHistoryPendingAdded":metadata_history_plan.pending_added,"addedTimeEntries":added_time_entries,"importedPerformances":imported_performances,"duplicatePerformances":duplicate_performances,"keptPerformances":kept_performances,"replacedPerformances":replaced_performances,"trimmedPerformances":trimmed_performances,"learningChanged":learning_changed,"addedRecords":added,"duplicateRecords":duplicates,"renamedRecords":collisions,"trimmedRecords":trimmed,"restorePoint":restore}),
        })
    }
}

impl Outcome {
    pub(super) fn install(self, player: &mut Player) -> Value {
        let preferences = std::mem::replace(&mut player.preferences, self.preferences);
        let history = std::mem::replace(&mut player.history, self.history);
        player.retire((preferences, history));
        if self.sound_changed {
            player.reset(player.state.position);
        }
        self.report
    }
}
impl Player {
    pub(super) fn check_backup_import(&self) -> Result<(), String> {
        if self.storage_busy.load(Ordering::Acquire) {
            return Err(BUSY.into());
        }
        if self.recorder.is_recording()
            || matches!(self.state.status.as_str(), "playing" | "countIn")
            || self.routine.is_some()
            || self.ladder.as_ref().is_some_and(|l| l.active)
        {
            return Err("请先暂停演奏、停止录音并结束活动计划/阶梯，再导入练习资料".into());
        }
        Ok(())
    }
    pub(super) fn begin_backup_import(&mut self, id: String) -> Result<Context, String> {
        self.check_backup_import()?;
        self.panic();
        self.time_connected = false;
        let context = Context::capture(self);
        self.storage_id = Some(id);
        self.storage_busy.store(true, Ordering::Release);
        Ok(context)
    }
    pub(super) fn finish_backup_import(
        &mut self,
        id: &str,
        result: Result<Outcome, String>,
    ) -> Result<Value, String> {
        if self.storage_id.as_deref() != Some(id) {
            self.retire(result);
            return Err("导入任务已失效".into());
        }
        self.storage_id = None;
        let result = result.map(|outcome| outcome.install(self));
        let recovery = storage_control::recovery(self);
        let needs_recovery = result.is_err()
            && (recovery.blocked()
                || self
                    .pending_saves
                    .as_ref()
                    .is_some_and(|pipeline| pipeline.status().error.is_some()));
        if needs_recovery {
            let hard_recovery = recovery.hard();
            let retryable = !hard_recovery
                && self
                    .pending_saves
                    .as_ref()
                    .is_some_and(|p| p.status().can_retry);
            let message = if retryable {
                format!(
                    "{}；设置尚未保存，请使用重试保存",
                    result.as_ref().unwrap_err()
                )
            } else {
                format!(
                    "{}；导入恢复尚未完成，资料已保留，请重新启动",
                    result.as_ref().unwrap_err()
                )
            };
            if !retryable {
                self.history.block_writes(message.clone());
                self.state.error = Some(message.clone());
            }
            return Err(message);
        }
        crate::storage_control::unblock(self);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/backup-import-unit")
            .join(format!(
                "{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
    }
    fn engine() -> Engine {
        let root = root();
        let lock = data_root_lock::DataRootLock::acquire(&root).unwrap();
        let engine = Engine::start(root, lock, PathBuf::new(), true).unwrap();
        engine.command(Command::CurrentSong).unwrap();
        engine
    }
    fn wait_ready(engine: &Engine) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while engine.storage_busy.load(Ordering::Acquire) {
            assert!(
                Instant::now() < deadline,
                "import did not release its lease"
            );
            thread::sleep(Duration::from_millis(5));
        }
    }
    fn wait_merging(engine: &Engine) -> String {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let tasks = engine.command(Command::Tasks).unwrap();
            if let Some(task) = tasks
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["label"] == "导入练习资料" && t["stage"] == "merging")
            {
                return task["id"].as_str().unwrap().into();
            }
            assert!(
                Instant::now() < deadline,
                "import did not reach held storage"
            );
            thread::sleep(Duration::from_millis(5));
        }
    }
    fn import(engine: &Engine) -> Result<Value, String> {
        engine.command(Command::ApplyPracticeBackup {
            backup: Backup::default(),
            selection: Selection::default(),
            policy: "keep".into(),
        })
    }
    fn files(engine: &Engine) -> Vec<Option<Vec<u8>>> {
        [
            "web-preferences.json",
            "web-practice-history.ron",
            "library-workspace.json",
        ]
        .iter()
        .map(|name| std::fs::read(engine.data.join(name)).ok())
        .collect()
    }
    #[test]
    fn public_import_wait_keeps_controls_live_blocks_competing_commands_and_cancels_without_writes()
    {
        let engine = engine();
        engine.command(Command::Volume { value: 0.4 }).unwrap();
        let before = files(&engine);
        let lock = library_workspace::lock_for(&engine.data).unwrap();
        let guard = lock.lock().unwrap();
        let (reply, receiver) = mpsc::sync_channel(1);
        let caller = engine.clone();
        thread::spawn(move || {
            let _ = reply.send(import(&caller));
        });
        let id = wait_merging(&engine);
        assert!(engine.storage_busy.load(Ordering::Acquire));
        assert!(
            engine
                .command(Command::Volume { value: 0.9 })
                .unwrap_err()
                .contains("导入")
        );
        assert!(
            engine
                .command(Command::Generate {
                    spec: ExerciseSpec::default()
                })
                .is_err()
        );
        let (reply, context) = mpsc::sync_channel(1);
        engine
            .tx
            .send(runtime_request::Request::ImportContext(reply))
            .unwrap();
        assert!(
            context
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .is_err()
        );
        let (reply, queued) = mpsc::sync_channel(1);
        engine
            .tx
            .send(runtime_request::Request::Command(
                Command::Volume { value: 0.8 },
                reply,
            ))
            .unwrap();
        assert!(
            queued
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .is_err()
        );
        let (reply, control) = mpsc::sync_channel(1);
        let controller = engine.clone();
        thread::spawn(move || {
            let _ = reply.send(controller.command(Command::Panic));
        });
        control
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        engine.command(Command::Session).unwrap();
        engine.command(Command::CancelTask { id }).unwrap();
        assert!(
            receiver
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap_err()
                .contains("取消")
        );
        assert_eq!(files(&engine), before);
        assert!(!engine.data.join("practice-import-journal.json").exists());
        drop(guard);
        wait_ready(&engine);
        let bytes = Backup::default().encode().unwrap();
        let preview = engine.stage_practice_backup(bytes).unwrap();
        let result = engine
            .command(Command::ImportStagedPracticeBackup {
                token: preview["token"].as_str().unwrap().into(),
                selection: Selection::default(),
                policy: "keep".into(),
            })
            .unwrap();
        assert!(
            engine
                .data
                .join("practice-restore-points")
                .join(result["restorePoint"].as_str().unwrap())
                .is_dir()
        );
        assert!(!engine.storage_busy.load(Ordering::Acquire));
        assert_eq!(
            Preferences::load(&engine.data.join("web-preferences.json"))
                .unwrap()
                .volume,
            Some(0.4)
        );
    }
    #[test]
    fn failed_import_preserves_files_and_memory_then_releases_for_retry() {
        let engine = engine();
        engine.command(Command::Volume { value: 0.6 }).unwrap();
        let before = files(&engine);
        let blocker = engine.data.join("practice-restore-points");
        std::fs::write(&blocker, b"preserve fixture").unwrap();
        assert!(import(&engine).is_err());
        assert_eq!(files(&engine), before);
        assert!(!engine.storage_busy.load(Ordering::Acquire));
        assert_eq!(std::fs::read(&blocker).unwrap(), b"preserve fixture");
        std::fs::rename(blocker, engine.data.join("restore-blocker.saved")).unwrap();
        import(&engine).unwrap();
        assert_eq!(
            Preferences::load(&engine.data.join("web-preferences.json"))
                .unwrap()
                .volume,
            Some(0.6)
        );
    }
    #[test]
    fn dropped_lease_releases_player_and_pending_recovery_keeps_all_writes_blocked() {
        let engine = engine();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let (_, _lease) = Lease::begin(engine.clone()).unwrap();
            panic!("simulated worker unwind");
        }));
        assert!(result.is_err());
        wait_ready(&engine);
        engine.command(Command::Volume { value: 0.5 }).unwrap();
        let before = files(&engine);
        let (_, lease) = Lease::begin(engine.clone()).unwrap();
        std::fs::write(
            engine.data.join("practice-import-journal.json"),
            b"unreadable recovery fixture",
        )
        .unwrap();
        assert!(
            lease
                .finish(Err("simulated incomplete recovery".into()))
                .unwrap_err()
                .contains("重新启动")
        );
        assert!(engine.storage_busy.load(Ordering::Acquire));
        assert!(engine.command(Command::Volume { value: 0.9 }).is_err());
        engine.command(Command::Panic).unwrap();
        assert_eq!(files(&engine), before);
    }
    #[test]
    fn startup_with_unrecoverable_import_observes_history_without_quarantine_or_writes() {
        let root = root();
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("web-preferences.json"), b"{}").unwrap();
        std::fs::write(
            root.join("web-practice-history.ron"),
            b"unreadable preserved history",
        )
        .unwrap();
        std::fs::write(
            root.join("practice-import-journal.json"),
            b"unreadable journal",
        )
        .unwrap();
        let mut player = Player::new(root.clone(), PathBuf::new(), true);
        player.restore();
        assert!(player.storage_busy.load(Ordering::Acquire));
        assert!(player.state.error.is_some());
        assert!(player.command(Command::Volume { value: 0.7 }).is_err());
        player.command(Command::Panic).unwrap();
        player.midi(&[144, 60, 90]);
        assert!(player.state.pressed.is_empty());
        assert_eq!(
            std::fs::read(root.join("web-preferences.json")).unwrap(),
            b"{}"
        );
        assert_eq!(
            std::fs::read(root.join("web-practice-history.ron")).unwrap(),
            b"unreadable preserved history"
        );
        assert_eq!(
            std::fs::read(root.join("practice-import-journal.json")).unwrap(),
            b"unreadable journal"
        );
    }
}
