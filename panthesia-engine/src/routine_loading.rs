//! Plan item preparation uses owned source state, then rechecks it before installation.
use crate::{
    Player, exercise_assets, exercise_loading, load_pipeline,
    routine_commands::{RoutineItem, RoutineProgress},
    source_snapshot::SourceSnapshot,
};
#[cfg(test)]
use serde_json::Value;
use std::path::{Path, PathBuf};

pub(crate) struct Context {
    pub routine_id: String,
    pub day: String,
    pub item_id: String,
    pub resume: bool,
    pub item: RoutineItem,
    pub previous: RoutineProgress,
    fingerprint: std::sync::OnceLock<Result<String,String>>,
    existing_day: bool,
    active: Option<(String,String,String)>,
    snapshot: SourceSnapshot,
    paths: Vec<PathBuf>,
}

impl Context {
    pub(super) fn fingerprint(&self) -> Result<&str,String> {
        self.fingerprint.get_or_init(|| {
            serde_json::to_vec(&(&self.item,&self.previous,self.existing_day,&self.snapshot,&self.paths,&self.active))
                .map(|bytes| blake3::hash(&bytes).to_hex().to_string()).map_err(|error|error.to_string())
        }).as_ref().map(String::as_str).map_err(Clone::clone)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Command, Engine,
        background_tasks::TaskPool,
        data_root_lock::DataRootLock,
        history_loading::tests::seeded,
        routine_commands::RoutineGoal,
        runtime_request::{self, Request},
    };
    use std::{
        collections::BTreeMap,
        sync::{Arc, Mutex, mpsc},
        thread,
        time::{Duration, Instant},
    };
    const DAY: &str = "2026-11-13";
    fn seed(generated: bool) -> (Player, String, String, String) {
        let (mut player, cid, _) = seeded(generated, false);
        let routine = player
            .save_routine(None, None, "日课后台检查".into(), "保留原要求".into(), None)
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let item = player
            .save_routine_item(
                &routine,
                None,
                None,
                Some("current"),
                None,
                "选段慢练".into(),
                "保留个人指法".into(),
                RoutineGoal {
                    expression: None,
                    passes: 3,
                    accuracy: 90,
                    on_time: None,
                    consecutive: false,
                    attempt_limit: 20,
                },
            )
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        (player, cid, routine, item)
    }
    #[test]
    fn reopening_active_ladder_uses_its_latest_in_memory_stage() {
        let (mut player, _, routine, item) = seed(false);
        let preset = player
            .command(Command::SaveLadder {
                id: None,
                name: "速度阶梯".into(),
                start: 1,
                end: 1,
                plan: panthesia_core::speed_ladder::SpeedLadderPlan {
                    start_percent: 50,
                    target_percent: 100,
                    step_percent: 25,
                    passes_required: 1,
                    accuracy_percent: 90,
                    on_time_percent: None,
                    failures_before_step_back: 0,
                    attempt_limit: 20,
                },
                expression: None,
            })
            .unwrap();
        let goal = player.preferences.routines[0].items[0].goal.clone();
        player
            .save_routine_item(
                &routine,
                None,
                Some(item.clone()),
                Some("ladder"),
                preset["id"].as_str(),
                "阶梯慢练".into(),
                "".into(),
                goal,
            )
            .unwrap();
        player
            .open_routine_item(&routine, DAY, &item, true)
            .unwrap();
        player.ladder.as_mut().unwrap().progress.stage = 1;
        player.ladder.as_mut().unwrap().progress.total_rounds = 7;
        let context = player
            .prepare_routine_open(&routine, DAY, &item, true)
            .unwrap();
        assert_eq!(context.previous.ladder.as_ref().unwrap().stage, 1);
        let prepared = Prepared::read(&player.data, &context, || Ok(())).unwrap();
        let origin = player.begin_import().unwrap();
        commit(&mut player, origin, context, prepared, false).unwrap();
        assert_eq!(player.ladder.as_ref().unwrap().progress.stage, 1);
        assert_eq!(player.ladder.as_ref().unwrap().progress.total_rounds, 7);
        assert!((player.state.speed - 0.75).abs() < 0.0001);
    }
    fn tree(root: &Path) -> BTreeMap<PathBuf, String> {
        fn read(root: &Path, path: &Path, files: &mut BTreeMap<PathBuf, String>) {
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries {
                    let path = entry.unwrap().path();
                    if path.is_dir() {
                        read(root, &path, files);
                    } else {
                        files.insert(
                            path.strip_prefix(root).unwrap().into(),
                            blake3::hash(&std::fs::read(&path).unwrap())
                                .to_hex()
                                .to_string(),
                        );
                    }
                }
            }
        }
        let mut files = BTreeMap::new();
        read(root, root, &mut files);
        files
    }
    fn commit(
        player: &mut Player,
        origin: crate::import_pipeline::Origin,
        context: Context,
        prepared: Prepared,
        cancel: bool,
    ) -> Result<Value, String> {
        let pool = TaskPool::new(1, 2).unwrap();
        let canceller = pool.clone();
        let (send, receive) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let worker = thread::spawn(move || {
            pool.run("held plan result", None, move |token| {
                send.send(token).unwrap();
                gate.recv().unwrap();
                Ok(Value::Null)
            })
        });
        let token = receive.recv_timeout(Duration::from_secs(3)).unwrap();
        if cancel {
            canceller.cancel(&canceller.list().unwrap()[0].id).unwrap();
        }
        let (reply, response) = mpsc::sync_channel(1);
        let shared = Arc::new(Mutex::new(player.snapshot()));
        runtime_request::handle(
            player,
            Request::RoutineCommit(origin, context, prepared, token, reply),
            &shared,
        );
        let result = response.recv().unwrap();
        release.send(()).unwrap();
        let _ = worker.join().unwrap();
        result
    }
    #[test]
    fn public_plan_prepares_file_and_generated_items_with_saved_conditions() {
        use panthesia_core::exercise::{ExerciseHands, ExerciseSpec};
        for hands in [
            None,
            Some(ExerciseHands::Both),
            Some(ExerciseHands::Left),
            Some(ExerciseHands::Right),
        ] {
            let (mut player, _, routine, item) = seed(false);
            if let Some(hands) = hands {
                player
                    .command(Command::Generate {
                        spec: ExerciseSpec {
                            hands,
                            ..Default::default()
                        },
                    })
                    .unwrap();
                let track = player
                    .file
                    .as_ref()
                    .unwrap()
                    .tracks
                    .iter()
                    .find(|t| !t.notes.is_empty())
                    .unwrap()
                    .track_id;
                player
                    .command(Command::Finger {
                        track,
                        index: 0,
                        finger: Some(4),
                    })
                    .unwrap();
                player
                    .command(Command::NoteHand {
                        track,
                        index: 0,
                        part: Some(panthesia_core::practice::PracticePart::LeftHand),
                    })
                    .unwrap();
                player.command(Command::Speed { value: 0.75 }).unwrap();
                let duration = player.state.duration;
                player
                    .command(Command::Loop {
                        start: duration * 0.2,
                        end: duration * 0.7,
                        enabled: true,
                    })
                    .unwrap();
                let goal = player.preferences.routines[0].items[0].goal.clone();
                player
                    .save_routine_item(
                        &routine,
                        None,
                        Some(item.clone()),
                        Some("current"),
                        None,
                        "选段慢练".into(),
                        "保留个人指法".into(),
                        goal,
                    )
                    .unwrap();
            }
            let cid = player.file.as_ref().unwrap().content_id.clone();
            let count = player.notes.len();
            let track = player
                .file
                .as_ref()
                .unwrap()
                .tracks
                .iter()
                .find(|t| !t.notes.is_empty())
                .unwrap()
                .track_id;
            let data = player.data.clone();
            drop(player);
            let engine = Engine::start(
                data.clone(),
                DataRootLock::acquire(&data).unwrap(),
                PathBuf::new(),
                true,
            )
            .unwrap();
            let mut other = panthesia_core::exercise::ExerciseSpec::default();
            other.tonic = 9;
            engine.command(Command::Generate { spec: other }).unwrap();
            let opened = engine
                .command(Command::OpenRoutineItem {
                    routine_id: routine.clone(),
                    day: DAY.into(),
                    item_id: item.clone(),
                    resume: true,
                })
                .unwrap();
            assert_eq!(opened["contentId"], cid);
            assert_eq!(opened["notes"].as_array().unwrap().len(), count);
            let personal = opened["notes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["track"] == track && n["index"] == 0)
                .unwrap();
            assert_eq!(personal["finger"], 4);
            assert_eq!(personal["manualHand"], true);
            let state = engine.snapshot();
            assert!((state.speed - 0.75).abs() < 0.0001);
            assert!(state.passage.is_some());
            assert_eq!(state.routine.as_ref().unwrap()["itemId"], item);
            let jobs = engine.tasks.list().unwrap();
            assert_eq!(
                jobs.iter()
                    .filter(|t| t.label == "准备计划练习项目" && t.state == "succeeded")
                    .count(),
                1
            );
            engine.command(Command::StopRoutine).unwrap();
        }
    }
    #[test]
    fn preparation_is_read_only_for_missing_and_recovered_generated_caches() {
        for collision in [false, true] {
            let (mut player, cid, routine, item) = seed(true);
            let original = player.data.join("song-assets").join(format!("{cid}.mid"));
            let backup = player.data.join("preserved-exercise.mid");
            std::fs::rename(&original, &backup).unwrap();
            if collision {
                std::fs::write(&original, b"personal original content").unwrap();
            }
            let before = tree(&player.data);
            let context = player
                .prepare_routine_open(&routine, DAY, &item, true)
                .unwrap();
            let prepared = Prepared::read(&player.data, &context, || Ok(())).unwrap();
            assert_eq!(tree(&player.data), before);
            let origin = player.begin_import().unwrap();
            commit(&mut player, origin, context, prepared, false).unwrap();
            let actual = player
                .annotation_path(player.file.as_ref().unwrap())
                .unwrap();
            if collision {
                assert_ne!(actual, original);
                assert_eq!(
                    std::fs::read(&original).unwrap(),
                    b"personal original content"
                );
            } else {
                assert_eq!(actual, original);
            }
            assert_eq!(
                blake3::hash(&std::fs::read(&backup).unwrap())
                    .to_hex()
                    .as_str(),
                before[Path::new("preserved-exercise.mid")]
            );
            let track = player
                .file
                .as_ref()
                .unwrap()
                .tracks
                .iter()
                .find(|t| !t.notes.is_empty())
                .unwrap()
                .track_id;
            let loaded = player.command(Command::CurrentSong).unwrap();
            let personal = loaded["notes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["track"] == track && n["index"] == 0)
                .unwrap();
            assert_eq!(personal["finger"], 4);
            assert_eq!(personal["manualHand"], true);
        }
    }
    #[test]
    fn concurrent_item_progress_or_source_changes_reject_a_prepared_plan() {
        for change in 0..5 {
            let (mut player, _, routine, item) = seed(false);
            let context = player
                .prepare_routine_open(&routine, DAY, &item, true)
                .unwrap();
            let prepared = Prepared::read(&player.data, &context, || Ok(())).unwrap();
            let origin = player.begin_import().unwrap();
            match change {
                0 => {
                    player.preferences.routines[0].items[0].notes = "new requirement".into();
                }
                1 => {
                    player
                        .open_routine_item(&routine, DAY, &item, true)
                        .unwrap();
                    player.stop_routine().unwrap();
                }
                2 => {
                    let path = player.file.as_ref().unwrap().source_path.clone().unwrap();
                    std::fs::write(path, b"changed MIDI").unwrap();
                }
                3 => {
                    player
                        .preferences
                        .songs
                        .get_mut(&context.item.content_id)
                        .unwrap()
                        .latency += 1;
                }
                _ => {
                    player
                        .command(Command::Note {
                            pitch: 60,
                            active: true,
                            velocity: 80,
                        })
                        .unwrap();
                }
            }
            let before = tree(&player.data);
            let original_cid = player.file.as_ref().unwrap().content_id.clone();
            assert!(
                commit(&mut player, origin, context, prepared, false).is_err(),
                "change {change}"
            );
            assert_eq!(tree(&player.data), before);
            assert_eq!(player.file.as_ref().unwrap().content_id, original_cid);
        }
    }
    #[test]
    fn cancelled_result_and_failed_preflight_create_no_daily_plan_or_cache() {
        let (mut player, _, routine, item) = seed(false);
        let context = player
            .prepare_routine_open(&routine, DAY, &item, true)
            .unwrap();
        let prepared = Prepared::read(&player.data, &context, || Ok(())).unwrap();
        let origin = player.begin_import().unwrap();
        let before = tree(&player.data);
        assert!(
            commit(&mut player, origin, context, prepared, true)
                .unwrap_err()
                .contains("已取消")
        );
        assert_eq!(tree(&player.data), before);
        assert!(player.preferences.routine_runs.is_empty());
        player.preferences.routines[0].items[0].scope = "incompatible scope".into();
        let context = player
            .prepare_routine_open(&routine, DAY, &item, true)
            .unwrap();
        assert!(
            Prepared::read(&player.data, &context, || Ok(()))
                .err()
                .unwrap()
                .contains("评分范围已改变")
        );
        assert_eq!(tree(&player.data), before);
        assert!(player.preferences.routine_runs.is_empty());
    }
    #[test]
    fn independent_template_edits_are_kept_and_resume_preserves_saved_progress() {
        let (mut player, _, routine, item) = seed(false);
        let context = player
            .prepare_routine_open(&routine, DAY, &item, true)
            .unwrap();
        let prepared = Prepared::read(&player.data, &context, || Ok(())).unwrap();
        let origin = player.begin_import().unwrap();
        player.preferences.routines[0].name = "renamed independently".into();
        commit(&mut player, origin, context, prepared, false).unwrap();
        player.stop_routine().unwrap();
        let key = format!("{routine}:{DAY}");
        let run = player.preferences.routine_runs.get_mut(&key).unwrap();
        assert_eq!(run.routine.name, "renamed independently");
        let progress = run.progress.get_mut(&item).unwrap();
        progress.passed = 2;
        progress.attempts = 4;
        progress.session_ids = vec!["original-attempt".into()];
        player
            .open_routine_item(&routine, DAY, &item, true)
            .unwrap();
        let saved = &player.preferences.routine_runs[&key].progress[&item];
        assert_eq!((saved.passed, saved.attempts), (2, 4));
        assert_eq!(saved.session_ids, vec!["original-attempt"]);
        player.stop_routine().unwrap();
        player
            .open_routine_item(&routine, DAY, &item, false)
            .unwrap();
        assert_eq!(
            player.preferences.routine_runs[&key].progress[&item].attempts,
            0
        );
    }
    #[test]
    fn queued_plan_open_can_be_cancelled_without_persisting_daily_state() {
        let (player, _, routine, item) = seed(false);
        let data = player.data.clone();
        drop(player);
        let engine = Engine::start(
            data.clone(),
            DataRootLock::acquire(&data).unwrap(),
            PathBuf::new(),
            true,
        )
        .unwrap();
        engine.command(Command::CurrentSong).unwrap();
        let before = std::fs::read(data.join("web-preferences.json")).unwrap();
        let mut releases = vec![];
        let mut workers = vec![];
        for _ in 0..2 {
            let pool = engine.tasks.clone();
            let (send, ready) = mpsc::channel();
            let (release, gate) = mpsc::channel();
            workers.push(thread::spawn(move || {
                pool.run("hold plan worker", None, move |_| {
                    send.send(()).unwrap();
                    gate.recv().unwrap();
                    Ok(Value::Null)
                })
            }));
            ready.recv_timeout(Duration::from_secs(3)).unwrap();
            releases.push(release);
        }
        let opening = engine.clone();
        let job = thread::spawn(move || {
            opening.command(Command::OpenRoutineItem {
                routine_id: routine,
                day: DAY.into(),
                item_id: item,
                resume: true,
            })
        });
        let deadline = Instant::now() + Duration::from_secs(3);
        let task = loop {
            if let Some(task) = engine
                .tasks
                .list()
                .unwrap()
                .into_iter()
                .find(|t| t.label == "准备计划练习项目")
            {
                break task;
            }
            assert!(Instant::now() < deadline);
            thread::yield_now();
        };
        assert_eq!(task.state, "queued");
        engine.command(Command::Panic).unwrap();
        engine.command(Command::CancelTask { id: task.id }).unwrap();
        assert!(job.join().unwrap().unwrap_err().contains("已取消"));
        for release in releases {
            release.send(()).unwrap();
        }
        for worker in workers {
            worker.join().unwrap().unwrap();
        }
        assert_eq!(
            std::fs::read(data.join("web-preferences.json")).unwrap(),
            before
        );
        assert!(engine.snapshot().routine.is_none());
    }
}
pub(crate) enum Prepared {
    File(load_pipeline::Prepared),
    Exercise(exercise_loading::Prepared, exercise_assets::Prepared),
}
impl Player {
    pub(crate) fn prepare_routine_open(
        &self,
        id: &str,
        day: &str,
        item_id: &str,
        resume: bool,
    ) -> Result<Context, String> {
        let (item, previous, existing_day) = self.routine_selection(id, day, item_id, resume)?;
        let history = self.history.song(&item.content_id);
        let paths = [
            item.path.clone(),
            history.and_then(|h| h.setup.as_ref().and_then(|s| s.source_path.clone())),
            history.and_then(|h| h.library.source_path.clone()),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        let snapshot = SourceSnapshot::capture(self, &item.content_id);
        let active = self
            .routine
            .as_ref()
            .map(|r| (r.routine_id.clone(), r.day.clone(), r.item.id.clone()));
        Ok(Context {
            routine_id: id.into(),
            day: day.into(),
            item_id: item_id.into(),
            resume,
            item,
            previous,
            fingerprint: Default::default(),
            existing_day,
            active,
            snapshot,
            paths,
        })
    }
    pub(crate) fn check_routine_open(&self, expected: &Context) -> Result<(), String> {
        let current = self.prepare_routine_open(
            &expected.routine_id,
            &expected.day,
            &expected.item_id,
            expected.resume,
        )?;
        if current.fingerprint()? != expected.fingerprint()? {
            return Err("计划项目、进度或曲目资料已变化，请重新打开项目".into());
        }
        if ["playing", "countIn"].contains(&self.state.status.as_str())
            || !self.state.pressed.is_empty()
        {
            return Err("准备期间已开始演奏，请先暂停并松开琴键，再打开计划项目".into());
        }
        Ok(())
    }
}
impl Prepared {
    pub fn read(
        data: &Path,
        context: &Context,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        check()?;
        let item = &context.item;
        let versions = context
            .snapshot
            .preferences
            .score_versions
            .get(&item.content_id)
            .cloned()
            .unwrap_or_default();
        let result = if let Some(spec) = item.exercise {
            let exercise = exercise_loading::prepare(spec)?;
            if exercise.file.content_id != item.content_id {
                return Err("生成练习身份不匹配".into());
            }
            check()?;
            let assets = exercise_assets::Prepared::read(data, &exercise.file, spec, &versions)?;
            Self::Exercise(exercise, assets)
        } else {
            Self::File(
                load_pipeline::Input::Recent {
                    content_id: item.content_id.clone(),
                    title: item.song_title.clone(),
                    paths: context.paths.clone(),
                }
                .read(data, |_| Ok(versions.clone()), &check)?,
            )
        };
        check()?;
        let mut reader = context.snapshot.reader(data, &item.content_id);
        let (file, title, plan, assets, timeline) = match &result {
            Self::File(p) => (&p.file, &p.title, None, &p.assets, &p.timeline),
            Self::Exercise(p, a) => (
                &p.file,
                &p.title,
                Some(p.plan.clone()),
                &a.assets,
                &p.timeline,
            ),
        };
        reader.install_prepared(
            file.clone(),
            title.clone(),
            plan,
            Some(load_pipeline::InstallData {
                assets: Some(assets.clone()),
                timeline: timeline.clone(),
            }),
        )?;
        reader.preflight_loaded_routine_item(item)?;
        check()?;
        result.check()?;
        Ok(result)
    }
    pub fn check(&self) -> Result<(), String> {
        match self {
            Self::File(p) => p.check(),
            Self::Exercise(_, a) => a.check(),
        }
    }
    pub fn install(self, player: &mut Player) -> Result<(), String> {
        match self {
            Self::File(p)=>p.install_owned(player),
            Self::Exercise(p,a)=>p.with_assets(a).install(player),
        }
    }
    #[cfg(test)]
    pub fn commit(self, player: &mut Player, context: &Context) -> Result<Value, String> {
        player.install_routine_item(context, self)
    }
}
