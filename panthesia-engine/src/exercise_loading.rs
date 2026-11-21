//! Owned exercise preparation shared by generated and historical practice.
use crate::{Player, load_pipeline};
use panthesia_music::MidiFile;
use panthesia_core::{
    exercise::{ExercisePattern, ExercisePlan, ExerciseSpec, ExerciseTonality},
    panthesia_keyboard::KeyboardRange,
};

pub(crate) struct Prepared {
    pub file: MidiFile,
    pub title: String,
    pub(crate) plan: ExercisePlan,
    pub(crate) timeline: load_pipeline::Timeline,
    assets: Option<crate::exercise_assets::Prepared>,
}
pub(crate) fn prepare(spec: ExerciseSpec) -> Result<Prepared, String> {
    prepare_checked(spec, &|| Ok(()))
}
pub(crate) fn prepare_checked(
    spec: ExerciseSpec,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Prepared, String> {
    check()?;
    let plan =
        ExercisePlan::generate(spec, &KeyboardRange::new(21..=108)).map_err(|e| e.to_string())?;
    check()?;
    let mut file = plan.to_midi_file()?;
    check()?;
    file.content_id = plan.practice_id();
    let timeline = load_pipeline::Timeline::new_checked(&file, check)?;
    let title = format!(
        "{}{} · {}",
        [
            "C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"
        ][spec.tonic as usize],
        if matches!(spec.tonality, ExerciseTonality::Major) {
            "大调"
        } else {
            "小调"
        },
        match spec.pattern {
            ExercisePattern::Scale => "音阶",
            ExercisePattern::Arpeggio => "琶音",
            _ => "主三和弦",
        }
    );
    Ok(Prepared {
        file,
        title,
        plan,
        timeline,
        assets: None,
    })
}
impl Prepared {
    pub(crate) fn materialize_for_startup(
        mut self,
        data: &std::path::Path,
        versions: &mut Vec<crate::preferences::ScoreVersion>,
    ) -> Result<Self, String> {
        if let Some(assets) = &self.assets {
            assets.store(data, &self.file.content_id)?;
            crate::notation_assets::retain_editions(
                data,
                &self.file.content_id,
                assets.anchor(),
                versions,
            )?;
        }
        self.assets = Some(crate::exercise_assets::Prepared::read(
            data,
            &self.file,
            self.plan.spec,
            versions,
        )?);
        Ok(self)
    }
    pub(crate) fn install_startup(self, player: &mut Player) -> Result<(), String> {
        self.check()?;
        player.install_prepared(
            self.file,
            self.title,
            Some(self.plan),
            Some(load_pipeline::InstallData {
                assets: self.assets.map(|a| a.assets),
                timeline: self.timeline,
            }),
        )
    }
    #[cfg(test)]
    pub(crate) fn read_assets(
        self,
        data: &std::path::Path,
        versions: &[crate::preferences::ScoreVersion],
    ) -> Result<Self, String> {
        self.read_assets_checked(data, versions, &|| Ok(()))
    }
    pub(crate) fn read_assets_checked(
        mut self,
        data: &std::path::Path,
        versions: &[crate::preferences::ScoreVersion],
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        check()?;
        self.assets = Some(crate::exercise_assets::Prepared::read_checked(
            data,
            &self.file,
            self.plan.spec,
            versions,
            check,
        )?);
        Ok(self)
    }
    pub(crate) fn check(&self) -> Result<(), String> {
        match &self.assets {
            Some(assets) => assets.check(),
            None => Ok(()),
        }
    }
    pub fn install(self, player: &mut Player) -> Result<(), String> {
        self.check()?;
        let assets = match self.assets {
            Some(assets) => {
                assets.store(&player.data, &self.file.content_id)?;
                player.retain_notation_assets(&self.file.content_id, assets.anchor())?;
                Some(load_pipeline::Assets::read_checked(
                    &self.file,
                    assets.anchor(),
                    player
                        .preferences
                        .score_versions
                        .get(&self.file.content_id)
                        .map(Vec::as_slice)
                        .unwrap_or_default(),
                    &|| Ok(()),
                )?)
            }
            None => None,
        };
        player.install_prepared(
            self.file,
            self.title,
            Some(self.plan),
            Some(load_pipeline::InstallData {
                assets,
                timeline: self.timeline,
            }),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Command, Engine,
        background_tasks::TaskPool,
        data_root_lock::DataRootLock,
        test_fixtures::seeded,
        runtime_request::{self, Request},
    };
    use panthesia_core::{exercise::ExerciseHands, library};
    use std::{
        sync::{Arc, Mutex, mpsc},
        thread,
        time::{Duration, Instant},
    };

    fn ready(player: &Player, spec: ExerciseSpec) -> Prepared {
        prepare(spec)
            .unwrap()
            .read_assets(&player.data, &[])
            .unwrap()
    }
    fn commit(
        player: &mut Player,
        origin: crate::song_switch::Origin,
        prepared: Prepared,
        cancel: bool,
    ) -> Result<serde_json::Value, String> {
        let pool = TaskPool::new(1, 2).unwrap();
        let work = pool.clone();
        let (send, recv) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let worker = thread::spawn(move || {
            work.run("held exercise", None, move |token| {
                send.send(token).unwrap();
                gate.recv().unwrap();
                Ok(serde_json::Value::Null)
            })
        });
        let token = recv.recv_timeout(Duration::from_secs(3)).unwrap();
        if cancel {
            pool.cancel(&pool.list().unwrap()[0].id).unwrap();
        }
        let (reply, response) = mpsc::sync_channel(1);
        let shared = Arc::new(Mutex::new(player.snapshot()));
        runtime_request::handle(
            player,
            Request::ExerciseCommit(origin, prepared, token, reply),
            &shared,
        );
        let result = response.recv().unwrap();
        release.send(()).unwrap();
        let _ = worker.join().unwrap();
        result
    }
    #[test]
    fn generated_score_preparation_restores_owned_bytes_and_checks_source_changes() {
        let (mut player, cid, _) = seeded(true, false);
        let xml =
            include_bytes!("../../panthesia-core/src/score_performance_test.musicxml").to_vec();
        player
            .command(Command::PairScore {
                expected: None,
                bytes: xml.clone(),
                name: "生成练习原谱.musicxml".into(),
                content_id: cid.clone(),
            })
            .unwrap();
        let prepared = ready(&player, ExerciseSpec::default());
        let assets = &prepared.assets.as_ref().unwrap().assets;
        assert_eq!(assets.notation.as_ref().unwrap().bytes, xml);
        let path = player
            .annotation_path(player.file.as_ref().unwrap())
            .unwrap();
        let sidecar = library::load_song_sidecar(&path, &cid).unwrap();
        let source = library::resolve_score_path(&path, sidecar.score.as_ref().unwrap());
        let origin = player.begin_import().unwrap();
        commit(&mut player, origin, prepared, false).unwrap();
        assert_eq!(player.notation.as_deref().unwrap().bytes, xml);
        let stale = ready(&player, ExerciseSpec::default());
        std::fs::write(&source, b"changed score").unwrap();
        assert!(stale.check().is_err());
        assert_eq!(player.notation.as_deref().unwrap().bytes, xml);
    }
    #[test]
    fn generated_commit_rejects_changed_assets_cancel_or_new_performance() {
        for change in [
            "sidecar",
            "cache",
            "cancel",
            "playing",
            "pressed",
            "recording",
            "song",
        ] {
            let (mut player, cid, _) = seeded(true, false);
            let spec = ExerciseSpec {
                hands: ExerciseHands::Left,
                ..Default::default()
            };
            let prepared = ready(&player, spec);
            let path = player
                .annotation_path(player.file.as_ref().unwrap())
                .unwrap();
            let origin = player.begin_import().unwrap();
            match change {
                "sidecar" => {
                    std::fs::write(library::metadata_sidecar_path(&path), b"changed").unwrap()
                }
                "cache" => std::fs::write(&path, b"changed").unwrap(),
                "playing" => {
                    player.state.status = "playing".into();
                }
                "pressed" => {
                    player
                        .command(Command::Note {
                            pitch: 60,
                            velocity: 80,
                            active: true,
                        })
                        .unwrap();
                }
                "recording" => {
                    player.command(Command::Recording { active: true }).unwrap();
                }
                "song" => {
                    player
                        .command(Command::Generate {
                            spec: ExerciseSpec {
                                tonic: 2,
                                ..Default::default()
                            },
                        })
                        .unwrap();
                }
                _ => {}
            }
            let retained = player.file.as_ref().unwrap().content_id.clone();
            assert!(
                commit(&mut player, origin, prepared, change == "cancel").is_err(),
                "{change}"
            );
            assert_eq!(
                player.file.as_ref().unwrap().content_id,
                retained,
                "{change}"
            );
            assert!(player.history.song(&cid).unwrap().sessions.len() == 1);
        }
    }
    #[test]
    fn queued_public_generation_can_be_cancelled_while_controls_continue() {
        let (player, cid, _) = seeded(false, false);
        let data = player.data.clone();
        drop(player);
        let lock = DataRootLock::acquire(&data).unwrap();
        let mut engine = Engine::start(data, lock, std::path::PathBuf::new(), true).unwrap();
        engine.wait_until_ready(std::time::Duration::from_secs(30)).unwrap();
        engine.tasks = TaskPool::new(1, 4).unwrap();
        let occupied = engine.tasks.clone();
        let (entered, recv) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let holder = thread::spawn(move || {
            occupied.run("hold worker", None, move |_| {
                entered.send(()).unwrap();
                gate.recv().unwrap();
                Ok(serde_json::Value::Null)
            })
        });
        recv.recv_timeout(Duration::from_secs(3)).unwrap();
        let waiting = engine.clone();
        let generator = thread::spawn(move || {
            waiting.command(Command::Generate {
                spec: ExerciseSpec::default(),
            })
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        let task = loop {
            let tasks = engine.tasks.list().unwrap();
            if let Some(t) = tasks
                .iter()
                .find(|t| t.label == "生成技术练习与恢复资料" && t.state == "queued")
            {
                break t.id.clone();
            }
            assert!(Instant::now() < deadline);
            thread::yield_now();
        };
        engine.command(Command::Panic).unwrap();
        engine.command(Command::CancelTask { id: task }).unwrap();
        assert!(generator.join().unwrap().is_err());
        assert_eq!(
            engine.command(Command::CurrentSong).unwrap()["contentId"],
            cid
        );
        release.send(()).unwrap();
        holder.join().unwrap().unwrap();
    }
}
