//! Ordinary loop automation shares the normal frozen-round save and audio teardown.
use crate::*;
impl Player {
    pub(super) fn abort_loop_at_error_limit(&mut self) -> bool {
        let limit = self.preferences.loop_restart_errors;
        if limit == 0
            || limit > 100
            || self.state.status != "playing"
            || self.state.passage.is_none()
            || self.state.recording
            || self.routine.is_some()
            || self.ladder.as_ref().is_some_and(|run| run.active)
            || !["wait", "flow"].contains(&self.state.mode.as_str())
        {
            return false;
        }
        let score = self.matcher.snapshot();
        if score.wrong_notes.saturating_add(score.missed_notes) < usize::from(limit) {
            return false;
        }
        self.state.loop_abort_limit = limit;
        self.finish_practice_round();
        true
    }
    pub(super) fn finish_practice_round(&mut self) {
        self.state.status = "finished".into();
        self.panic();
        self.matcher.finish();
        if self.state.mode != "listen" {
            if self.pending_saves.is_some() {
                if let Err(error) = self.queue_automatic_round_save() {
                    self.state.error = Some(error);
                }
                return;
            }
            if let Err(error) = self.save() {
                self.state.error = Some(error);
            }
        }
        self.continue_finished_round();
    }
    pub(super) fn advance_aborted_loop(&mut self, resume: bool) -> bool {
        if self.state.loop_abort_limit == 0 {
            return false;
        }
        if self.state.error.is_none() {
            self.state.loop_restarts = self.state.loop_restarts.saturating_add(1);
            if resume {
                if let Some(passage) = self.state.passage.clone() {
                    self.reset(passage.start);
                    self.begin_play();
                }
            }
        }
        true
    }
    pub(super) fn set_loop_restart_errors(
        &mut self,
        count: u16,
    ) -> Result<serde_json::Value, String> {
        if count > 100 {
            return Err("自动重开的错误阈值需为 0–100，0 表示关闭".into());
        }
        self.preferences.loop_restart_errors = count;
        if !self.restoring {
            self.preferences.save(&self.preferences_path)?;
        }
        Ok(serde_json::json!({"ok":true}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn loop_error_restart_records_failure_without_completing_round_and_can_disable() {
        let root = std::path::absolute(
            std::env::current_dir()
                .unwrap()
                .join("../work/loop-practice-unit")
                .join(format!(
                    "{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                )),
        )
        .unwrap();
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("study.mid");
        let bytes = include_bytes!("../assets/five-finger.mid");
        std::fs::write(&source, bytes).unwrap();
        let mut p = Player::new(root.join("data"), PathBuf::new(), true);
        p.command(Command::Load {
            path: source.clone(),
            title: "错误重开练习".into(),
        })
        .unwrap();
        let cid = p.file.as_ref().unwrap().content_id.clone();
        let end = p.state.duration;
        p.command(Command::CountIn { bars: 0 }).unwrap();
        p.command(Command::Loop {
            start: 0.,
            end,
            enabled: true,
        })
        .unwrap();
        p.set_loop_restart_errors(1).unwrap();
        p.command(Command::Play).unwrap();
        p.tick(Duration::from_millis(10));
        p.command(Command::Note {
            pitch: 126,
            velocity: 90,
            active: true,
        })
        .unwrap();
        p.command(Command::Note {
            pitch: 126,
            velocity: 0,
            active: false,
        })
        .unwrap();
        for _ in 0..100 {
            p.tick(Duration::from_millis(20));
            if p.state.loop_restarts > 0 {
                break;
            }
        }
        assert_eq!(p.state.loop_restarts, 1);
        assert_eq!(p.state.repetitions, 0);
        assert_eq!(p.state.loop_abort_limit, 0);
        assert_eq!(p.state.status, "playing");
        let saved = p.history.song(&cid).unwrap().sessions.last().unwrap();
        assert_eq!(saved.context.as_ref().unwrap().loop_restart, Some(1));
        let backup: crate::practice_backup::Backup =
            serde_json::from_value(p.practice_backup_snapshot(&Default::default()).unwrap())
                .unwrap();
        assert_eq!(backup.version(), 23);
        crate::practice_backup::Backup::decode(&backup.encode().unwrap()).unwrap();
        p.command(Command::Pause).unwrap();
        p.command(Command::Mode {
            value: "flow".into(),
        })
        .unwrap();
        p.command(Command::Loop {
            start: 0.,
            end,
            enabled: true,
        })
        .unwrap();
        p.command(Command::Play).unwrap();
        for _ in 0..100 {
            p.tick(Duration::from_millis(20));
            if p.state.loop_restarts > 0 {
                break;
            }
        }
        assert_eq!(p.state.loop_restarts, 1);
        assert_eq!(p.state.repetitions, 0);
        p.command(Command::Pause).unwrap();
        p.set_loop_restart_errors(0).unwrap();
        p.command(Command::Loop {
            start: 0.,
            end,
            enabled: true,
        })
        .unwrap();
        p.command(Command::Rounds { count: 1 }).unwrap();
        p.command(Command::Play).unwrap();
        for _ in 0..1000 {
            p.tick(Duration::from_millis(20));
            if p.state.repetitions > 0 {
                break;
            }
        }
        assert_eq!(p.state.repetitions, 1);
        assert_eq!(p.state.loop_restarts, 0);
        assert!(
            p.history
                .song(&cid)
                .unwrap()
                .sessions
                .last()
                .unwrap()
                .context
                .as_ref()
                .unwrap()
                .loop_restart
                .is_none()
        );
        assert_eq!(std::fs::read(source).unwrap(), bytes);
    }
}
