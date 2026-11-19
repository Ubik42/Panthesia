//! A history request captures conditions, prepares outside the runtime, then rechecks.
use crate::{Player, exercise_loading, load_pipeline};
use panthesia_core::{
    exercise::ExerciseSpec,
    practice_history::{PracticeSessionContext, PracticeSessionKind},
};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Clone, Serialize)]
pub(crate) struct Conditions {
    pub kind: PracticeSessionKind,
    pub mode: Option<String>,
    pub speed: f32,
    pub scope: Option<String>,
    pub context: Option<PracticeSessionContext>,
}
pub(crate) struct Context {
    pub focus_measure: Option<usize>,
    pub expected: Option<crate::history_source::HistorySource>,
    pub action: crate::history_actions::Action,
    pub recorded_at: u64,
    pub content_id: String,
    pub id: String,
    pub restore: bool,
    pub session: Conditions,
    pub title: String,
    pub exercise: Option<ExerciseSpec>,
    pub paths: Vec<PathBuf>,
    pub fingerprint: String,
}
impl Player {
    pub(crate) fn prepare_history_open(
        &self,
        content_id: &str,
        id: &str,
        restore: bool,
    ) -> Result<Context, String> {
        Context::capture(&self.history, content_id, id, restore)
    }
    pub(crate) fn check_history_open(&self, expected: &Context) -> Result<(), String> {
        let current =
            self.prepare_history_open(&expected.content_id, &expected.id, expected.restore)?;
        if let Some(source) = &expected.expected {
            source.check_context(&current)?;
        }
        if current.fingerprint != expected.fingerprint {
            return Err("历史记录的练习条件或文件位置已变化，请重新打开这条记录".into());
        }
        Ok(())
    }
}
impl Context {
    pub(crate) fn capture(
        store: &panthesia_core::practice_history::PracticeHistoryStore,
        content_id: &str,
        id: &str,
        restore: bool,
    ) -> Result<Self, String> {
        let history = store.song(content_id).ok_or("曲目记录不存在")?;
        let saved = history
            .sessions
            .iter()
            .find(|s| s.stable_id() == id)
            .ok_or("这条记录已不在历史中")?;
        if restore && saved.context.is_none() {
            return Err("旧记录没有保存完整条件，请使用打开曲目".into());
        }
        let exercise = saved
            .context
            .as_ref()
            .and_then(|c| c.exercise_spec)
            .or_else(|| history.setup.as_ref().and_then(|s| s.exercise_spec));
        let paths: Vec<_> = [
            saved.context.as_ref().and_then(|c| c.source_path.clone()),
            history.setup.as_ref().and_then(|s| s.source_path.clone()),
            history.library.source_path.clone(),
        ]
        .into_iter()
        .flatten()
        .collect();
        let session = Conditions {
            kind: saved.kind,
            mode: saved.mode.clone(),
            speed: saved.speed,
            scope: saved.scope.clone(),
            context: saved.context.clone(),
        };
        let fingerprint = blake3::hash(
            &serde_json::to_vec(&(&session, exercise, &paths, saved.recorded_at_unix_ms))
                .map_err(|e| e.to_string())?,
        )
        .to_hex()
        .to_string();
        Ok(Context {
            focus_measure: None,
            expected: None,
            action: crate::history_actions::Action::Open { restore },
            recorded_at: saved.recorded_at_unix_ms,
            content_id: content_id.into(),
            id: id.into(),
            restore,
            session,
            title: history.display_name.clone(),
            exercise,
            paths,
            fingerprint,
        })
    }
}
pub(crate) enum Song {
    File(load_pipeline::Prepared),
    Exercise(exercise_loading::Prepared),
}
impl Song {
    pub fn practice_notes(&self,context:&Context)->Result<Vec<crate::PracticeNote>,String>{
        let variant=crate::practice_variant::Variant::from_grid(context.session.context.as_ref().map_or("",|c|c.grid.as_str()))?;
        if !variant.active(){return Ok(self.notes().to_vec());}
        let mut file=match self{Self::File(v)=>v.file.clone(),Self::Exercise(v)=>return Ok(v.notes().to_vec())};
        if let Self::File(v)=self {if let Some(grid)=&v.assets.grid{file.musical_time=grid.clone();}}
        let file=crate::practice_variant::transform(&file,&variant)?;
        Ok(load_pipeline::Timeline::new(&file)?.notes.to_vec())
    }
    pub fn notes(&self) -> &[crate::PracticeNote] {
        match self {
            Self::File(value) => &value.timeline.notes,
            Self::Exercise(value) => value.notes(),
        }
    }
    pub fn content_id(&self) -> &str {
        match self {
            Self::File(value) => &value.file.content_id,
            Self::Exercise(value) => &value.file.content_id,
        }
    }
    pub fn check(&self) -> Result<(), String> {
        match self {
            Self::File(value) => value.check(),
            Self::Exercise(value) => value.check(),
        }
    }
    pub fn install(self, player: &mut Player) -> Result<(), String> {
        match self {
            Self::File(value) => player.install_prepared(
                value.file,
                value.title,
                None,
                Some(load_pipeline::InstallData {
                    assets: Some(value.assets),
                    timeline: value.timeline,
                }),
            ),
            Self::Exercise(value) => value.install(player),
        }
    }
}
pub(crate) struct Prepared {
    pub song: Song,
    pub followup: crate::history_actions::Prepared,
}
impl Prepared {
    pub fn check(&self) -> Result<(), String> {
        self.song.check()?;
        self.followup.check()
    }
    pub fn commit(
        self,
        player: &mut Player,
        context: &Context,
    ) -> Result<serde_json::Value, String> {
        self.song.install(player)?;
        let opened = player.apply_history_open(context)?;
        let mut result = self.followup.finish(player, context, opened)?;
        if let Some(measure) = context
            .focus_measure
            .filter(|_| result["restoreWarning"].is_null())
        {
            if player.state.mode != "flow" {
                player.command(crate::Command::Mode {
                    value: "flow".into(),
                })?;
            }
            player.command(crate::Command::MeasureLoop {
                start: measure,
                end: measure,
                enabled: true,
            })?;
            result = player.command(crate::Command::CurrentSong)?;
        }
        if let Some(source) = &context.expected {
            result["historyPrepared"] =
                serde_json::to_value(crate::history_source::HistoryPrepared {
                    source: source.clone(),
                    content_id: player
                        .file
                        .as_ref()
                        .ok_or("历史练习准备结果缺少曲目")?
                        .content_id
                        .clone(),
                    score_revision: player.score_revision,
                })
                .map_err(|error| error.to_string())?;
        }
        Ok(result)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::{
        Command, Engine,
        background_tasks::TaskPool,
        data_root_lock::DataRootLock,
        runtime_request::{self, Request},
    };
    use panthesia_core::{
        practice::{AttemptSummary, PracticeHands, PracticePart},
        practice_history::PracticeSession,
    };
    use std::{
        sync::{Arc, Mutex, mpsc},
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    fn root() -> PathBuf {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/history-load-unit")
            .join(format!(
                "{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    pub(crate) fn seeded(generated: bool, legacy: bool) -> (Player, String, String) {
        let mut player = Player::new(root(), PathBuf::new(), true);
        if generated {
            player
                .command(Command::Generate {
                    spec: ExerciseSpec::default(),
                })
                .unwrap();
        } else {
            player
                .command(Command::ImportScore {
                    bytes: include_bytes!(
                        "../../panthesia-core/src/score_performance_test.musicxml"
                    )
                    .to_vec(),
                    name: "历史课堂.musicxml".into(),
                    default_bpm: 120,
                })
                .unwrap();
        }
        let cid = player.file.as_ref().unwrap().content_id.clone();
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
                part: Some(PracticePart::LeftHand),
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
        let mut session = PracticeSession::new(
            PracticeSessionKind::Loop {
                start_measure: 1,
                end_measure: 1,
            },
            PracticeHands::Both,
            0.75,
            AttemptSummary::default(),
        )
        .with_context(player.history_context())
        .with_scope(player.practice_scope())
        .with_mode("wait");
        session.id = Some("saved-history-check".into());
        if legacy {
            session.context = None;
        }
        let id = session.stable_id();
        player
            .history
            .record_session(&cid, &player.title.clone(), session)
            .unwrap();
        (player, cid, id)
    }
    fn engine(generated: bool, legacy: bool) -> (Engine, String, String) {
        let (player, cid, id) = seeded(generated, legacy);
        let data = player.data.clone();
        drop(player);
        let lock = DataRootLock::acquire(&data).unwrap();
        let engine = Engine::start(data, lock, PathBuf::new(), true).unwrap();
        engine.command(Command::CurrentSong).unwrap();
        (engine, cid, id)
    }
    pub(crate) fn archive(player: &Player, cid: &str, id: &str) -> serde_json::Value {
        let note = player
            .notes
            .iter()
            .find(|n| {
                player.state.passage.as_ref().is_none_or(|r| {
                    n.start.as_secs_f64() >= r.start && n.start.as_secs_f64() < r.end
                })
            })
            .unwrap();
        let measure = player
            .file
            .as_ref()
            .unwrap()
            .measures
            .partition_point(|t| *t <= note.start);
        let value = serde_json::json!({"version":1,"contentId":cid,"id":id,"duration":2.0,"inputs":[],"references":[{"at":0.1,"end":1.5,"pitch":note.note,"velocity":note.velocity,"measure":measure,"songTime":note.start.as_secs_f64(),"track":note.track_id}],"truncated":false});
        let path = crate::performance_archive::path(&player.data, cid, id);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
        crate::performance_archive::read(&player.data, cid, id).unwrap();
        value
    }
    fn commit_ready(
        player: &mut Player,
        origin: crate::import_pipeline::Origin,
        context: Context,
        prepared: Prepared,
    ) -> Result<serde_json::Value, String> {
        let pool = TaskPool::new(1, 2).unwrap();
        let (send, receive) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let worker = thread::spawn(move || {
            pool.run("held ready action", None, move |token| {
                send.send(token).unwrap();
                gate.recv().unwrap();
                Ok(serde_json::Value::Null)
            })
        });
        let token = receive.recv_timeout(Duration::from_secs(3)).unwrap();
        let (reply, response) = mpsc::sync_channel(1);
        let shared = Arc::new(Mutex::new(player.snapshot()));
        runtime_request::handle(
            player,
            Request::HistoryCommit(origin, context, prepared, token, reply),
            &shared,
        );
        let result = response.recv().unwrap();
        release.send(()).unwrap();
        worker.join().unwrap().unwrap();
        result
    }
    fn different(player: &mut Player) {
        let mut spec = ExerciseSpec::default();
        spec.tonic = 7;
        player.command(Command::Generate { spec }).unwrap();
    }
    fn prepared(player: &Player, context: &Context) -> Prepared {
        let input = crate::history_actions::Input::read(&player.data, context).unwrap();
        let song = if let Some(spec) = context.exercise {
            Song::Exercise(exercise_loading::prepare(spec).unwrap())
        } else {
            Song::File(
                load_pipeline::Input::Recent {
                    content_id: context.content_id.clone(),
                    title: context.title.clone(),
                    paths: context.paths.clone(),
                }
                .read(
                    &player.data,
                    |id| {
                        Ok(player
                            .preferences
                            .score_versions
                            .get(id)
                            .cloned()
                            .unwrap_or_default())
                    },
                    || Ok(()),
                )
                .unwrap(),
            )
        };
        let followup = crate::history_actions::Prepared::prepare(input, context, &song).unwrap();
        Prepared { song, followup }
    }
    #[test]
    fn public_history_restore_keeps_exact_range_annotations_and_saved_history() {
        for generated in [false, true] {
            let (engine, cid, id) = engine(generated, false);
            let before = engine.snapshot();
            let original = engine.command(Command::CurrentSong).unwrap();
            let target = original["notes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["finger"] == 4 && n["manualHand"] == true)
                .unwrap();
            let history = engine
                .command(Command::HistoryQuery {
                    query: String::new(),
                    mode: String::new(),
                    hands: String::new(),
                    range: String::new(),
                    days: 0,
                    offset: 0,
                    limit: 20,
                    from: None,
                    to: None,
                })
                .unwrap();
            engine
                .command(Command::Generate {
                    spec: ExerciseSpec {
                        tonic: 7,
                        ..Default::default()
                    },
                })
                .unwrap();
            let opened = engine
                .command(Command::HistoryOpen {
                    content_id: cid.clone(),
                    id: id.clone(),
                    restore: true,
                })
                .unwrap();
            assert_eq!(opened["contentId"], cid);
            assert!(opened["restoreWarning"].is_null());
            assert_eq!(opened["hasScore"], !generated);
            let restored = engine.snapshot();
            assert!((restored.speed - 0.75).abs() < 0.0001);
            assert_eq!(restored.status, "ready");
            assert!(
                (restored.passage.as_ref().unwrap().start - before.passage.as_ref().unwrap().start)
                    .abs()
                    < 0.003
            );
            assert!(
                (restored.passage.as_ref().unwrap().end - before.passage.as_ref().unwrap().end)
                    .abs()
                    < 0.003
            );
            let first = opened["notes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["track"] == target["track"] && n["index"] == target["index"])
                .unwrap();
            assert_eq!(first["finger"], 4);
            assert_eq!(first["part"], "left");
            let after = engine
                .command(Command::HistoryQuery {
                    query: String::new(),
                    mode: String::new(),
                    hands: String::new(),
                    range: String::new(),
                    days: 0,
                    offset: 0,
                    limit: 20,
                    from: None,
                    to: None,
                })
                .unwrap();
            assert_eq!(history["entries"], after["entries"]);
            assert!(
                engine
                    .command(Command::Tasks)
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|t| t["label"] == "恢复历史练习" && t["state"] == "succeeded")
            );
        }
    }
    #[test]
    fn old_record_requires_saved_conditions_only_when_restore_is_requested() {
        let (engine, cid, id) = engine(true, true);
        assert!(
            engine
                .command(Command::HistoryOpen {
                    content_id: cid.clone(),
                    id: id.clone(),
                    restore: true
                })
                .unwrap_err()
                .contains("没有保存完整条件")
        );
        assert_eq!(
            engine
                .command(Command::HistoryOpen {
                    content_id: cid.clone(),
                    id,
                    restore: false
                })
                .unwrap()["contentId"],
            cid
        );
    }
    #[test]
    fn historical_file_can_move_without_changing_saved_attempt_identity() {
        let (engine, cid, id) = engine(false, false);
        let original = engine.command(Command::CurrentSong).unwrap();
        let path = PathBuf::from(original["sourcePath"].as_str().unwrap());
        let moved = engine.data.join("移动后的历史课堂.mid");
        std::fs::rename(&path, &moved).unwrap();
        std::fs::rename(
            panthesia_core::library::metadata_sidecar_path(&path),
            panthesia_core::library::metadata_sidecar_path(&moved),
        )
        .unwrap();
        let mut index = crate::library_workspace::Workspace::load(&engine.data).unwrap();
        index.inspect(moved.clone(), true).unwrap();
        index.save(&engine.data).unwrap();
        let opened = engine
            .command(Command::HistoryOpen {
                content_id: cid.clone(),
                id,
                restore: true,
            })
            .unwrap();
        assert_eq!(opened["contentId"], cid);
        assert_eq!(opened["sourcePath"], moved.to_string_lossy().as_ref());
        assert_eq!(opened["hasScore"], true);
        assert!(opened["restoreWarning"].is_null());
    }
    #[test]
    fn changed_grid_warns_and_preserves_current_settings_instead_of_restoring_old_range() {
        let (engine, cid, id) = engine(false, false);
        engine
            .command(Command::Meter {
                value: Some(panthesia_core::library::MeterCorrection {
                    numerator: 3,
                    denominator: 4,
                    pickup_ticks: 0,
                }),
            })
            .unwrap();
        engine.command(Command::Speed { value: 1.25 }).unwrap();
        let opened = engine
            .command(Command::HistoryOpen {
                content_id: cid,
                id,
                restore: true,
            })
            .unwrap();
        assert!(
            opened["restoreWarning"]
                .as_str()
                .unwrap()
                .contains("小节或逐音左右手标注已改变")
        );
        assert_eq!(opened["meterMap"]["segments"][0]["numerator"], 3);
        assert!((engine.snapshot().speed - 1.25).abs() < 0.0001);
    }
    #[test]
    fn history_conditions_guard_allows_notes_but_rejects_replaced_conditions() {
        let (mut player, cid, id) = seeded(false, false);
        let context = player.prepare_history_open(&cid, &id, true).unwrap();
        player
            .annotate_history(
                &cid,
                &id,
                "本轮备注".into(),
                "教师说明".into(),
                "下次慢练".into(),
                None,
            )
            .unwrap();
        assert!(player.check_history_open(&context).is_ok());
        let mut snapshot = player.history.snapshot();
        snapshot.get_mut(&cid).unwrap().sessions[0].speed = 1.25;
        player.history.replace_snapshot(snapshot);
        assert!(
            player
                .check_history_open(&context)
                .unwrap_err()
                .contains("练习条件")
        );
    }
    #[test]
    fn history_commit_rechecks_current_song_recording_files_conditions_and_cancel() {
        for change in ["song", "recording", "file", "conditions", "cancel"] {
            let (mut player, cid, id) = seeded(false, false);
            let context = player.prepare_history_open(&cid, &id, true).unwrap();
            let ready = prepared(&player, &context);
            different(&mut player);
            let origin = player.begin_import().unwrap();
            let mut retained = player.file.as_ref().unwrap().content_id.clone();
            let pool = TaskPool::new(1, 2).unwrap();
            let worker_pool = pool.clone();
            let (token_reply, token_response) = mpsc::channel();
            let (release, gate) = mpsc::channel();
            let worker = thread::spawn(move || {
                worker_pool.run("held history", None, move |token| {
                    token_reply.send(token).unwrap();
                    gate.recv().unwrap();
                    Ok(serde_json::Value::Null)
                })
            });
            let token = token_response.recv_timeout(Duration::from_secs(3)).unwrap();
            match change {
                "song" => {
                    player
                        .command(Command::Generate {
                            spec: ExerciseSpec {
                                tonic: 2,
                                ..Default::default()
                            },
                        })
                        .unwrap();
                    retained = player.file.as_ref().unwrap().content_id.clone();
                }
                "recording" => {
                    player.command(Command::Recording { active: true }).unwrap();
                }
                "file" => {
                    std::fs::write(&context.paths[0], b"changed").unwrap();
                }
                "conditions" => {
                    let mut snapshot = player.history.snapshot();
                    snapshot.get_mut(&cid).unwrap().sessions[0]
                        .context
                        .as_mut()
                        .unwrap()
                        .count_in = 3;
                    player.history.replace_snapshot(snapshot);
                }
                "cancel" => {
                    let id = pool.list().unwrap()[0].id.clone();
                    pool.cancel(&id).unwrap();
                }
                _ => unreachable!(),
            }
            let (reply, response) = mpsc::sync_channel(1);
            let shared = Arc::new(Mutex::new(player.snapshot()));
            runtime_request::handle(
                &mut player,
                Request::HistoryCommit(origin, context, ready, token, reply),
                &shared,
            );
            assert!(response.recv().unwrap().is_err(), "{change}");
            assert_eq!(
                player.file.as_ref().unwrap().content_id,
                retained,
                "{change}"
            );
            release.send(()).unwrap();
            let _ = worker.join().unwrap();
        }
    }
    #[test]
    fn queued_history_cancellation_preserves_preferences_and_record() {
        let (engine, cid, id) = engine(false, false);
        engine
            .command(Command::Generate {
                spec: ExerciseSpec::default(),
            })
            .unwrap();
        let original = engine.command(Command::CurrentSong).unwrap();
        let preferences = std::fs::read(engine.data.join("web-preferences.json")).unwrap();
        let mut releases = vec![];
        let mut workers = vec![];
        for _ in 0..2 {
            let pool = engine.tasks.clone();
            let (started, ready) = mpsc::channel();
            let (release, gate) = mpsc::channel();
            workers.push(thread::spawn(move || {
                pool.run("hold queue", None, move |_| {
                    started.send(()).unwrap();
                    gate.recv().unwrap();
                    Ok(serde_json::Value::Null)
                })
            }));
            ready.recv_timeout(Duration::from_secs(3)).unwrap();
            releases.push(release);
        }
        let opening = engine.clone();
        let job = thread::spawn(move || {
            opening.command(Command::HistoryOpen {
                content_id: cid,
                id,
                restore: true,
            })
        });
        let deadline = Instant::now() + Duration::from_secs(3);
        let id = loop {
            let tasks = engine.command(Command::Tasks).unwrap();
            if let Some(task) = tasks
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["label"] == "恢复历史练习")
            {
                assert_eq!(task["state"], "queued");
                break task["id"].as_str().unwrap().to_owned();
            }
            assert!(Instant::now() < deadline);
            thread::yield_now();
        };
        engine.command(Command::Panic).unwrap();
        engine.command(Command::CancelTask { id }).unwrap();
        assert!(job.join().unwrap().is_err());
        for release in releases {
            release.send(()).unwrap();
        }
        for worker in workers {
            worker.join().unwrap().unwrap();
        }
        assert_eq!(
            engine.command(Command::CurrentSong).unwrap()["contentId"],
            original["contentId"]
        );
        assert_eq!(
            std::fs::read(engine.data.join("web-preferences.json")).unwrap(),
            preferences
        );
    }
    #[test]
    fn public_review_and_problem_range_keep_legacy_archive_evidence_and_identity() {
        use crate::history_actions::Action;
        for (generated, action) in [
            (false, Action::ScoreReview),
            (
                false,
                Action::PracticeRange {
                    reference: 0,
                    before: 0,
                    after: 0,
                },
            ),
            (
                true,
                Action::PracticeRange {
                    reference: 0,
                    before: 1,
                    after: 1,
                },
            ),
        ] {
            let (player, cid, id) = seeded(generated, false);
            let evidence = archive(&player, &cid, &id);
            let data = player.data.clone();
            drop(player);
            let lock = DataRootLock::acquire(&data).unwrap();
            let engine = Engine::start(data, lock, PathBuf::new(), true).unwrap();
            engine.command(Command::CurrentSong).unwrap();
            engine
                .command(Command::Generate {
                    spec: ExerciseSpec {
                        tonic: 7,
                        ..Default::default()
                    },
                })
                .unwrap();
            let command = match action {
                Action::ScoreReview => Command::HistoryScoreReview {
                    content_id: cid.clone(),
                    id: id.clone(),
                },
                Action::PracticeRange {
                    reference,
                    before,
                    after,
                } => Command::HistoryPracticeRange {
                    content_id: cid.clone(),
                    id: id.clone(),
                    reference,
                    before,
                    after,
                },
                _ => unreachable!(),
            };
            let result = engine.command(command).unwrap();
            assert_eq!(result["contentId"], cid);
            if matches!(action, Action::ScoreReview) {
                let review = &result["scoreReview"];
                assert_eq!(review["historyId"], id);
                assert_eq!(review["exact"], false);
                assert_eq!(review["notes"][0]["kind"], "approximate");
                assert_eq!(
                    review["notes"][0]["pitch"],
                    evidence["references"][0]["pitch"]
                );
                assert_eq!(
                    review["notes"][0]["track"],
                    evidence["references"][0]["track"]
                );
                assert!(review["notes"][0]["index"].is_u64());
                assert_eq!(review["scoreRevision"], result["scoreRevision"]);
            } else {
                assert_eq!(result["paperFocus"]["historyId"], id);
                assert_eq!(result["paperFocus"]["reference"], 0);
                assert_eq!(
                    result["paperFocus"]["pitch"],
                    evidence["references"][0]["pitch"]
                );
                assert!(result["paperFocus"]["index"].is_u64());
                assert_eq!(result["scoreFocus"].is_object(), !generated);
                assert!(engine.snapshot().passage.is_some());
                assert!(!engine.snapshot().adaptive);
            }
            assert!(
                engine
                    .command(Command::Tasks)
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|task| task["label"] == action.label() && task["state"] == "succeeded")
            );
            assert_eq!(
                crate::performance_archive::read(&engine.data, &cid, &id)
                    .unwrap()
                    .references
                    .len(),
                1
            );
        }
    }
    #[test]
    fn changed_archive_rejects_ready_review_and_range_before_installing() {
        use crate::history_actions::Action;
        for action in [
            Action::ScoreReview,
            Action::PracticeRange {
                reference: 0,
                before: 0,
                after: 0,
            },
        ] {
            let (mut player, cid, id) = seeded(false, false);
            let mut evidence = archive(&player, &cid, &id);
            let mut context = player.prepare_history_open(&cid, &id, true).unwrap();
            context.action = action;
            let ready = prepared(&player, &context);
            different(&mut player);
            let retained = player.file.as_ref().unwrap().content_id.clone();
            let origin = player.begin_import().unwrap();
            evidence["truncated"] = true.into();
            std::fs::write(
                crate::performance_archive::path(&player.data, &cid, &id),
                serde_json::to_vec(&evidence).unwrap(),
            )
            .unwrap();
            assert!(
                commit_ready(&mut player, origin, context, ready)
                    .unwrap_err()
                    .contains("文件已改变")
            );
            assert_eq!(player.file.as_ref().unwrap().content_id, retained);
        }
    }
    #[test]
    fn ready_review_and_range_reject_new_transport_or_held_keys() {
        use crate::history_actions::Action;
        for action in [
            Action::ScoreReview,
            Action::PracticeRange {
                reference: 0,
                before: 0,
                after: 0,
            },
        ] {
            for change in ["play", "press"] {
                let (mut player, cid, id) = seeded(false, false);
                archive(&player, &cid, &id);
                let mut context = player.prepare_history_open(&cid, &id, true).unwrap();
                context.action = action;
                let ready = prepared(&player, &context);
                different(&mut player);
                let retained = player.file.as_ref().unwrap().content_id.clone();
                let origin = player.begin_import().unwrap();
                if change == "play" {
                    player.command(Command::Play).unwrap();
                } else {
                    player
                        .command(Command::Note {
                            pitch: 60,
                            velocity: 90,
                            active: true,
                        })
                        .unwrap();
                }
                assert!(
                    commit_ready(&mut player, origin, context, ready)
                        .unwrap_err()
                        .contains("请先暂停")
                );
                assert_eq!(player.file.as_ref().unwrap().content_id, retained);
                player.panic();
            }
        }
    }
    #[test]
    fn invalid_problem_reference_is_checked_before_missing_song_input() {
        let (player, cid, id) = seeded(false, false);
        archive(&player, &cid, &id);
        let data = player.data.clone();
        let path = player.file.as_ref().unwrap().source_path.clone().unwrap();
        drop(player);
        let lock = DataRootLock::acquire(&data).unwrap();
        let engine = Engine::start(data, lock, PathBuf::new(), true).unwrap();
        engine.command(Command::CurrentSong).unwrap();
        engine
            .command(Command::Generate {
                spec: ExerciseSpec::default(),
            })
            .unwrap();
        std::fs::rename(&path, engine.data.join("temporarily-moved.mid")).unwrap();
        let error = engine
            .command(Command::HistoryPracticeRange {
                content_id: cid.clone(),
                id: id.clone(),
                reference: 100,
                before: 0,
                after: 0,
            })
            .unwrap_err();
        assert!(error.contains("没有所选参考音"));
        let error = engine
            .command(Command::HistoryPracticeRange {
                content_id: cid,
                id,
                reference: 0,
                before: 9,
                after: 0,
            })
            .unwrap_err();
        assert!(error.contains("最多各选 8 小节"));
    }
    #[test]
    fn changed_record_timestamp_invalidates_prepared_history_action() {
        let (mut player, cid, id) = seeded(false, false);
        let context = player.prepare_history_open(&cid, &id, true).unwrap();
        let mut snapshot = player.history.snapshot();
        snapshot.get_mut(&cid).unwrap().sessions[0].recorded_at_unix_ms += 1;
        player.history.replace_snapshot(snapshot);
        assert!(player.check_history_open(&context).is_err());
    }
    #[test]
    fn history_performance_read_does_not_pause_or_persist_the_live_player() {
        let (player, cid, id) = seeded(false, false);
        archive(&player, &cid, &id);
        let data = player.data.clone();
        drop(player);
        let lock = DataRootLock::acquire(&data).unwrap();
        let engine = Engine::start(data, lock, PathBuf::new(), true).unwrap();
        engine.command(Command::CurrentSong).unwrap();
        engine.command(Command::CountIn { bars: 0 }).unwrap();
        engine.command(Command::Play).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while engine.snapshot().required.is_empty() {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(1));
        }
        let before = engine.snapshot();
        let preferences = std::fs::read(engine.data.join("web-preferences.json")).unwrap();
        let result = engine
            .command(Command::HistoryPerformance {
                content_id: cid,
                id,
            })
            .unwrap();
        assert_eq!(result["references"].as_array().unwrap().len(), 1);
        assert_eq!(result["expressionReview"], serde_json::json!([null]));
        assert_eq!(before.status, "playing");
        assert_eq!(engine.snapshot().status, "playing");
        assert_eq!(engine.snapshot().score, before.score);
        assert_eq!(
            std::fs::read(engine.data.join("web-preferences.json")).unwrap(),
            preferences
        );
        engine.command(Command::Pause).unwrap();
    }
    #[test]
    fn prepared_performance_read_detects_replaced_archive() {
        let (player, cid, id) = seeded(false, false);
        archive(&player, &cid, &id);
        let context = player.prepare_history_open(&cid, &id, false).unwrap();
        let prepared = crate::history_actions::Read::prepare(&player.data, &context).unwrap();
        std::fs::write(
            crate::performance_archive::path(&player.data, &cid, &id),
            b"replaced archive",
        )
        .unwrap();
        assert!(prepared.check().unwrap_err().contains("文件已改变"));
    }
    #[test]
    fn maximum_legacy_reference_archive_is_read_without_inventing_exact_judgments() {
        let (player, cid, id) = seeded(false, false);
        let mut value = archive(&player, &cid, &id);
        let reference = value["references"][0].clone();
        value["references"] = serde_json::Value::Array(vec![reference; 50_000]);
        std::fs::write(
            crate::performance_archive::path(&player.data, &cid, &id),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
        let context = player.prepare_history_open(&cid, &id, false).unwrap();
        let result = crate::history_actions::Read::prepare(&player.data, &context).unwrap();
        assert_eq!(result.value["references"].as_array().unwrap().len(), 50_000);
        assert!(result.value["judgments"].is_null());
        assert!(
            result.value["expressionReview"]
                .as_array()
                .unwrap()
                .iter()
                .all(serde_json::Value::is_null)
        );
    }
}
