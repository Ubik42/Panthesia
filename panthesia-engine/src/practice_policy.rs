//! Mainline product boundary. Assessment lives on feature/assessment-lab.
use crate::Command;

pub(crate) fn normalize(command: Command) -> Result<Command, String> {
    use Command::*;
    match command {
        Mode { value } if value == "flow" => Ok(Mode {
            value: "listen".into(),
        }),
        Mode { value } if !["wait", "listen"].contains(&value.as_str()) => Err(unavailable()),
        Adaptive { .. } => Ok(Adaptive { enabled: false }),
        LoopRestartErrors { .. } => Ok(LoopRestartErrors { count: 0 }),
        Save
        | Feedback
        | SetSongExpressionGoal { .. }
        | EditSongExpressionGoal { .. }
        | SaveLadder { .. }
        | StartLadder { .. }
        | UpdateLadderName { .. }
        | RemoveLadder { .. }
        | SaveRoutine { .. }
        | EditRoutine { .. }
        | SaveRoutineSchedule { .. }
        | SaveRoutineItem { .. }
        | ComposePassages { .. }
        | OpenRoutineItem { .. }
        | MoveRoutineItem { .. }
        | RemoveRoutineItem { .. }
        | RemoveRoutine { .. }
        | SkipRoutineItem { .. }
        | ResetRoutineItem { .. }
        | AcceptWeakPractice { .. }
        | SaveHistoryProblemPlan { .. }
        | SaveMultiProblemPlan { .. }
        | SaveSongLearning { .. } => Err(unavailable()),
        command => Ok(command),
    }
}
fn unavailable() -> String {
    "评分、达标训练与自动晋级已移至 feature/assessment-lab 独立分支".into()
}
pub(crate) fn mode(value: &str) -> &'static str {
    if value == "wait" { "wait" } else { "listen" }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::*;
    #[test]
    fn mainline_playback_and_guidance_never_create_assessment_or_gate_continuation() {
        let root = std::env::temp_dir().join(format!(
            "panthesia-mainline-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("study.mid");
        let bytes = include_bytes!("../assets/five-finger.mid");
        std::fs::write(&source, bytes).unwrap();
        let mut player = Player::new(root.join("data"), PathBuf::new(), true);
        player
            .command(Command::Load {
                path: source.clone(),
                title: "主线练习".into(),
            })
            .unwrap();
        let cid = player.file.as_ref().unwrap().content_id.clone();
        player.preferences.song_expression_goals.insert(
            cid.clone(),
            expression_goal::ExpressionGoal {
                note_pedal_mismatch_count: Some(0),
                ..Default::default()
            },
        );
        player.preferences.loop_restart_errors = 1;
        player.command(Command::CountIn { bars: 0 }).unwrap();
        player
            .command(Command::Mode {
                value: "flow".into(),
            })
            .unwrap();
        player
            .command(Command::Loop {
                start: 0.,
                end: 0.3,
                enabled: true,
            })
            .unwrap();
        player.command(Command::Play).unwrap();
        player.tick(Duration::from_millis(350));
        assert_eq!(player.state.status, "playing");
        assert_eq!(player.state.repetitions, 1);
        assert_eq!(player.snapshot().mode, "listen");
        assert_eq!(player.snapshot().score, Default::default());
        assert_eq!(player.history.session_count(&cid), 0);
        assert!(!player.data.join("performance-history").exists());
        player
            .command(Command::Mode {
                value: "wait".into(),
            })
            .unwrap();
        player.tick(Duration::from_millis(10));
        assert!(!player.snapshot().required.is_empty());
        let position = player.state.position;
        player
            .command(Command::Note {
                pitch: 0,
                velocity: 90,
                active: true,
            })
            .unwrap();
        player
            .command(Command::Note {
                pitch: 0,
                velocity: 0,
                active: false,
            })
            .unwrap();
        player.tick(Duration::from_millis(800));
        assert_eq!(player.state.position, position);
        assert_eq!(player.snapshot().score, Default::default());
        for pitch in player.snapshot().required {
            player
                .command(Command::Note {
                    pitch,
                    velocity: 90,
                    active: true,
                })
                .unwrap();
            player
                .command(Command::Note {
                    pitch,
                    velocity: 0,
                    active: false,
                })
                .unwrap();
        }
        player.tick(Duration::from_millis(20));
        assert!(player.state.position > position);
        player
            .command(Command::Mode {
                value: "listen".into(),
            })
            .unwrap();
        assert!(player.snapshot().required.is_empty());
        player.tick(Duration::from_millis(350));
        assert_eq!(player.state.status, "playing");
        assert!(
            player
                .command(Command::Mode {
                    value: "recital".into()
                })
                .is_err()
        );
        assert!(player.command(Command::Save).is_err());
        assert!(player.preferences.song_expression_goals.contains_key(&cid));
        assert_eq!(player.history.session_count(&cid), 0);
        assert_eq!(std::fs::read(&source).unwrap(), bytes);
    }
}
