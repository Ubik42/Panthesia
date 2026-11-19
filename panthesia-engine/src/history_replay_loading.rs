//! Prepare history audio without reading archives or sorting events in the runtime.
use crate::{
    Player, history_loading, import_pipeline::Origin, load_pipeline::Watch, performance_archive,
};
use serde_json::Value;

#[derive(Clone, Copy)]
pub(crate) enum Source {
    Actual,
    Reference,
}
impl Source {
    pub fn parse(source: &str, rate: f64) -> Result<Self, String> {
        if !rate.is_finite() || !(0.25..=1.).contains(&rate) {
            return Err("请选择有效的回放来源和速度".into());
        }
        match source {
            "actual" => Ok(Self::Actual),
            "reference" => Ok(Self::Reference),
            _ => Err("请选择有效的回放来源和速度".into()),
        }
    }
}

pub(crate) struct Context {
    pub range: Option<(f64, f64)>,
    request_id: String,
    pub history: history_loading::Context,
    origin: Origin,
    demo: Option<String>,
    audio_stop_epoch: u64,
    midi_events: u64,
    pub source: Source,
    pub rate: f64,
}
pub(crate) struct Prepared {
    events: Vec<(f64, usize, [u8; 3])>,
    index: crate::replay_index::Index,
    end: f64,
    watch: Watch,
}
impl Player {
    pub(crate) fn cancel_replay_start(&mut self, id: &str) {
        if valid_request_id(id) && !self.cancelled_replay_starts.iter().any(|saved| saved == id) {
            self.cancelled_replay_starts.push_back(id.into());
            // More than the two workers plus eight queued jobs, with room for reordering.
            while self.cancelled_replay_starts.len() > 64 {
                self.cancelled_replay_starts.pop_front();
            }
        }
    }
    pub(crate) fn validate_history_replay(&self) -> Result<(), String> {
        if ["playing", "countIn"].contains(&self.state.status.as_str())
            || self.recorder.is_recording()
            || self.routine.is_some()
            || self.ladder.as_ref().is_some_and(|r| r.active)
            || !self.state.pressed.is_empty()
        {
            return Err("请先停止练习、录音和计划，并松开琴键，再回放记录".into());
        }
        Ok(())
    }
    pub(crate) fn prepare_history_replay(
        &self,
        cid: &str,
        id: &str,
        source: &str,
        rate: f64,
    ) -> Result<Context, String> {
        self.prepare_history_replay_request(cid, id, source, rate, None)
    }
    pub(crate) fn prepare_history_replay_request(
        &self,
        cid: &str,
        id: &str,
        source: &str,
        rate: f64,
        request_id: Option<String>,
    ) -> Result<Context, String> {
        let source = Source::parse(source, rate)?;
        self.validate_history_replay()?;
        let request_id = request_id.unwrap_or_else(|| {
            format!(
                "history-start-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            )
        });
        if !valid_request_id(&request_id) {
            return Err("回放请求标识无效，请重新打开记录".into());
        }
        self.check_replay_start(&request_id)?;
        if self
            .finger_demo
            .as_ref()
            .is_some_and(|d| d.id == request_id)
        {
            return Err("此回放请求已启动，请使用回放控制".into());
        }
        Ok(Context {
            range: None,
            request_id,
            history: self.prepare_history_open(cid, id, false)?,
            origin: Origin {
                content_id: self.file.as_ref().map(|f| f.content_id.clone()),
                revision: self.score_revision,
            },
            demo: self.finger_demo.as_ref().map(|d| d.id.clone()),
            audio_stop_epoch: self.audio_stop_epoch,
            midi_events: self.state.midi_events,
            source,
            rate,
        })
    }
    pub(crate) fn check_history_replay(&self, context: &Context) -> Result<(), String> {
        self.check_replay_start(&context.request_id)?;
        self.validate_history_replay()?;
        self.check_switch_origin(&context.origin, "回放")?;
        self.check_history_open(&context.history)?;
        if self.finger_demo.as_ref().map(|d| &d.id) != context.demo.as_ref() {
            return Err("回放准备期间示范或回放已变化，请重新回放记录".into());
        }
        if self.audio_stop_epoch != context.audio_stop_epoch
            || self.state.midi_events != context.midi_events
        {
            return Err("回放准备期间已停止发声或收到琴键输入，请重新回放记录".into());
        }
        Ok(())
    }
    pub(crate) fn check_replay_start(&self, id: &str) -> Result<(), String> {
        if self.cancelled_replay_starts.iter().any(|saved| saved == id) {
            return Err("这次声音准备已停止，请重新开始".into());
        }
        Ok(())
    }
}
fn valid_request_id(id: &str) -> bool {
    ((id.starts_with("history-start-") && id.len() > 14)
        || (id.starts_with("demo-start-") && id.len() > 11))
        && id.len() <= 96
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
impl Prepared {
    pub fn read(data: &std::path::Path, context: &Context) -> Result<Self, String> {
        let history = &context.history;
        let watch = Watch::capture(&performance_archive::path(
            data,
            &history.content_id,
            &history.id,
        ))?;
        let (archive, revision) = performance_archive::read_versioned(data, &history.content_id, &history.id)?;
        if let Some(expected) = &history.expected { expected.check_context(history)?; expected.check_performance(&revision)?; }
        if context.range.is_some_and(|(start, end)| !start.is_finite() || !end.is_finite() || start < 0. || end > archive.duration || end - start < 0.1) {
            return Err("选段应在这次演奏的保留范围内，长度至少为 0.1 秒".into());
        }
        let mut events: Vec<_> = match context.source {
            Source::Actual => archive
                .inputs
                .iter()
                .map(|n| (n.at, usize::MAX, n.bytes))
                .collect(),
            Source::Reference => archive
                .references
                .iter()
                .flat_map(|n| {
                    [
                        (n.at, usize::MAX, [144, n.pitch, n.velocity.max(1)]),
                        (n.end, usize::MAX, [128, n.pitch, 0]),
                    ]
                })
                .chain(
                    archive
                        .reference_pedals
                        .iter()
                        .map(|n| (n.at, usize::MAX, n.bytes)),
                )
                .collect(),
        };
        if events.is_empty() {
            return Err("该来源没有声音事件".into());
        }
        let end = events
            .iter()
            .map(|e| e.0)
            .fold(archive.duration, f64::max)
            .max(0.01);
        events.push((end, usize::MAX, [176, 64, 0]));
        // Stable ordering preserves recorded same-time input and reference pedal order.
        events.sort_by(|a, b| a.0.total_cmp(&b.0));
        let index = crate::replay_index::Index::new(&events);
        watch.check()?;
        Ok(Self { events, index, end, watch })
    }
    pub fn check(&self) -> Result<(), String> {
        self.watch.check()
    }
    pub fn install(self, player: &mut Player, context: &Context) -> Result<Value, String> {
        player.begin_history_demo(context.request_id.clone(), self.end, context.rate, self.events, self.index, context.range)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Command, Engine,
        background_tasks::TaskPool,
        data_root_lock::DataRootLock,
        history_loading::tests::{archive, seeded},
        runtime_request::{self, Request},
    };
    use serde_json::json;
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex, mpsc},
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn request_scoped_stop_rejects_early_and_ready_starts_without_stopping_other_replay() {
        let (mut player, cid, id) = with_audio();
        let request = "history-start-early";
        player
            .command(Command::StopFingerDemo {
                id: Some(request.into()),
            })
            .unwrap();
        assert!(
            player
                .prepare_history_replay_request(&cid, &id, "actual", 0.5, Some(request.into()))
                .err()
                .unwrap()
                .contains("准备已停止")
        );
        let request = "history-start-ready";
        let context = player
            .prepare_history_replay_request(&cid, &id, "actual", 0.5, Some(request.into()))
            .unwrap();
        let prepared = Prepared::read(&player.data, &context).unwrap();
        player
            .command(Command::StopFingerDemo {
                id: Some(request.into()),
            })
            .unwrap();
        assert!(
            commit(&mut player, context, prepared, false)
                .unwrap_err()
                .contains("准备已停止")
        );
        let context = player
            .prepare_history_replay_request(
                &cid,
                &id,
                "actual",
                0.5,
                Some("history-start-owned".into()),
            )
            .unwrap();
        let prepared = Prepared::read(&player.data, &context).unwrap();
        let started = commit(&mut player, context, prepared, false).unwrap();
        player
            .command(Command::StopFingerDemo {
                id: Some("history-start-unrelated".into()),
            })
            .unwrap();
        assert_eq!(
            player.finger_demo.as_ref().unwrap().id,
            started["id"].as_str().unwrap()
        );
        player
            .command(Command::StopFingerDemo {
                id: Some("history-start-owned".into()),
            })
            .unwrap();
        assert!(player.finger_demo.is_none());
    }

    fn with_audio() -> (Player, String, String) {
        let (player, cid, id) = seeded(false, false);
        let mut value = archive(&player, &cid, &id);
        value["inputs"] = json!([
            {"at":0.1,"judgedAt":0.1,"songTime":0.1,"bytes":[144,60,83],"synthetic":false},
            {"at":0.2,"judgedAt":0.2,"songTime":0.2,"bytes":[176,64,127],"synthetic":false},
            {"at":0.3,"judgedAt":0.3,"songTime":0.3,"bytes":[128,60,0],"synthetic":false},
            {"at":0.3,"judgedAt":0.3,"songTime":0.3,"bytes":[144,60,90],"synthetic":false}
        ]);
        value["referencePedals"] = json!([
            {"at":0.2,"judgedAt":0.2,"songTime":0.2,"bytes":[176,64,127],"synthetic":false}
        ]);
        std::fs::write(
            performance_archive::path(&player.data, &cid, &id),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
        (player, cid, id)
    }
    fn commit(
        player: &mut Player,
        context: Context,
        prepared: Prepared,
        cancel: bool,
    ) -> Result<Value, String> {
        let pool = TaskPool::new(1, 2).unwrap();
        let cancel_pool = pool.clone();
        let (send, receive) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let worker = thread::spawn(move || {
            pool.run("hold replay", None, move |token| {
                send.send(token).unwrap();
                gate.recv().unwrap();
                Ok(Value::Null)
            })
        });
        let token = receive.recv_timeout(Duration::from_secs(3)).unwrap();
        if cancel {
            cancel_pool
                .cancel(&cancel_pool.list().unwrap()[0].id)
                .unwrap();
        }
        let (reply, response) = mpsc::sync_channel(1);
        let shared = Arc::new(Mutex::new(player.snapshot()));
        runtime_request::handle(
            player,
            Request::ReplayCommit(context, prepared, token, reply),
            &shared,
        );
        let result = response.recv().unwrap();
        release.send(()).unwrap();
        let _ = worker.join().unwrap();
        result
    }
    #[test]
    fn sources_keep_original_event_order_pedal_and_end_release() {
        let (player, cid, id) = with_audio();
        let context = player
            .prepare_history_replay(&cid, &id, "actual", 0.5)
            .unwrap();
        let actual = Prepared::read(&player.data, &context).unwrap();
        assert_eq!(
            actual.events.iter().map(|e| e.2).collect::<Vec<_>>(),
            vec![
                [144, 60, 83],
                [176, 64, 127],
                [128, 60, 0],
                [144, 60, 90],
                [176, 64, 0]
            ]
        );
        assert_eq!(actual.end, 2.);
        let context = player
            .prepare_history_replay(&cid, &id, "reference", 0.5)
            .unwrap();
        let reference = Prepared::read(&player.data, &context).unwrap();
        assert_eq!(reference.events.len(), 4);
        assert_eq!(reference.events[0].0, 0.1);
        assert_eq!(reference.events[1].2, [176, 64, 127]);
        assert_eq!(reference.events[2].0, 1.5);
        assert_eq!(reference.events[2].2[0], 128);
        assert_eq!(reference.events[3], (2., usize::MAX, [176, 64, 0]));
    }
    #[test]
    fn public_replay_prepares_both_sources_without_changing_practice_or_preferences() {
        let (player, cid, id) = with_audio();
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
        let before = engine.snapshot();
        let preferences = std::fs::read(data.join("web-preferences.json")).unwrap();
        let history = engine
            .command(Command::HistoryDetail {
                content_id: cid.clone(),
                id: id.clone(),
            })
            .unwrap();
        for source in ["actual", "reference"] {
            let result = engine
                .command(Command::StartHistoryReplay {
                    request_id: None,
                    content_id: cid.clone(),
                    id: id.clone(),
                    source: source.into(),
                    rate: 0.5,
                })
                .unwrap();
            assert_eq!(result["history"], true);
            assert_eq!(result["end"], 2.);
            assert_eq!(engine.snapshot().position, before.position);
            assert_eq!(engine.snapshot().score, before.score);
            engine
                .command(Command::StopFingerDemo {
                    id: Some(result["id"].as_str().unwrap().into()),
                })
                .unwrap();
        }
        assert_eq!(
            std::fs::read(data.join("web-preferences.json")).unwrap(),
            preferences
        );
        assert_eq!(
            engine
                .command(Command::HistoryDetail {
                    content_id: cid,
                    id
                })
                .unwrap(),
            history
        );
        assert!(
            engine
                .tasks
                .list()
                .unwrap()
                .iter()
                .filter(|t| t.label == "准备历史声音回放")
                .all(|t| t.state == "succeeded")
        );
    }
    #[test]
    fn playback_input_stop_song_and_demo_changes_reject_prepared_start() {
        for change in 0..6 {
            let (mut player, cid, id) = with_audio();
            let context = player
                .prepare_history_replay(&cid, &id, "reference", 0.5)
                .unwrap();
            let prepared = Prepared::read(&player.data, &context).unwrap();
            match change {
                0 => {
                    player.command(Command::Play).unwrap();
                }
                1 => {
                    player
                        .command(Command::Note {
                            pitch: 65,
                            active: true,
                            velocity: 80,
                        })
                        .unwrap();
                    player
                        .command(Command::Note {
                            pitch: 65,
                            active: false,
                            velocity: 0,
                        })
                        .unwrap();
                }
                2 => {
                    player.panic();
                }
                3 => {
                    player
                        .command(Command::Generate {
                            spec: panthesia_core::exercise::ExerciseSpec::default(),
                        })
                        .unwrap();
                }
                4 => {
                    player
                        .start_history_replay(&cid, &id, "actual", 0.5, None)
                        .unwrap();
                }
                _ => {
                    player.score_revision += 1;
                }
            }
            let own = player.finger_demo.as_ref().map(|d| d.id.clone());
            assert!(
                commit(&mut player, context, prepared, false).is_err(),
                "change {change}"
            );
            assert_eq!(player.finger_demo.as_ref().map(|d| d.id.clone()), own);
        }
    }
    #[test]
    fn changed_archive_record_and_cancellation_leave_player_untouched() {
        for change in 0..3 {
            let (mut player, cid, id) = with_audio();
            let context = player
                .prepare_history_replay(&cid, &id, "actual", 0.5)
                .unwrap();
            let prepared = Prepared::read(&player.data, &context).unwrap();
            if change == 0 {
                std::fs::write(
                    performance_archive::path(&player.data, &cid, &id),
                    b"changed",
                )
                .unwrap();
            }
            if change == 1 {
                let mut saved = player.history.snapshot();
                saved.get_mut(&cid).unwrap().sessions[0].recorded_at_unix_ms += 1;
                player.history.replace_snapshot(saved);
            }
            let before = player.state.clone();
            let result = commit(&mut player, context, prepared, change == 2);
            assert!(result.is_err());
            assert!(player.finger_demo.is_none());
            assert_eq!(player.state.position, before.position);
            assert_eq!(player.state.score, before.score);
        }
    }
    #[test]
    fn bad_replay_parameters_and_empty_source_fail_before_installation() {
        let (player, cid, id) = with_audio();
        for (source, rate) in [
            ("other", 0.5),
            ("actual", f64::NAN),
            ("actual", 0.1),
            ("reference", 1.1),
        ] {
            assert!(
                player
                    .prepare_history_replay("missing", "missing", source, rate)
                    .err()
                    .unwrap()
                    .contains("有效的回放")
            );
        }
        archive(&player, &cid, &id);
        let context = player
            .prepare_history_replay(&cid, &id, "actual", 0.5)
            .unwrap();
        assert!(
            Prepared::read(&player.data, &context)
                .err()
                .unwrap()
                .contains("没有声音事件")
        );
    }
    #[test]
    fn queued_replay_can_be_cancelled_while_control_lane_remains_available() {
        let (player, cid, id) = with_audio();
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
        let preferences = std::fs::read(data.join("web-preferences.json")).unwrap();
        let mut workers = vec![];
        let mut releases = vec![];
        for _ in 0..2 {
            let pool = engine.tasks.clone();
            let (send, ready) = mpsc::channel();
            let (release, gate) = mpsc::channel();
            workers.push(thread::spawn(move || {
                pool.run("hold worker", None, move |_| {
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
            opening.command(Command::StartHistoryReplay {
                request_id: None,
                content_id: cid,
                id,
                source: "actual".into(),
                rate: 0.5,
            })
        });
        let deadline = Instant::now() + Duration::from_secs(3);
        let task = loop {
            if let Some(task) = engine
                .tasks
                .list()
                .unwrap()
                .into_iter()
                .find(|t| t.label == "准备历史声音回放")
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
        assert!(engine.command(Command::FingerDemoState).unwrap()["id"].is_null());
        assert_eq!(
            std::fs::read(data.join("web-preferences.json")).unwrap(),
            preferences
        );
    }
}
