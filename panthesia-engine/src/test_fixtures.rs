//! Shared unit-test fixtures: a practice room with one saved session and personal annotations.
use crate::{Command, Player};
use panthesia_core::{
    exercise::ExerciseSpec,
    practice::{AttemptSummary, PracticeHands, PracticePart},
    practice_history::{PracticeSession, PracticeSessionKind},
};
use std::{
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
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
