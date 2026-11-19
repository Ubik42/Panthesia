use super::*;
use std::time::SystemTime;
#[test]
fn note_roles_drive_targets_projection_storage_and_portable_formats() {
    use panthesia_core::practice_history::{
        PracticeHistoryStore, PracticeSession, PracticeSessionKind,
    };
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../work/note-routing-unit")
        .join(format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
    std::fs::create_dir_all(&root).unwrap();
    let mut player = Player::new(root, PathBuf::new(), true);
    player
        .command(Command::Generate {
            spec: ExerciseSpec::default(),
        })
        .unwrap();
    let file = player.file.as_ref().unwrap();
    let track = file
        .tracks
        .iter()
        .find(|t| t.notes.len() >= 3)
        .unwrap()
        .track_id;
    let content = file.content_id.clone();
    let count = player.practice_target_count();
    let revision = player.playback_revision().unwrap();
    player
        .edit_note_playback(track, vec![0], Some(PlayerConfig::Auto), &revision)
        .unwrap();
    assert!(
        player
            .edit_note_playback(track, vec![1], Some(PlayerConfig::Mute), &revision)
            .is_err()
    );
    let revision = player.playback_revision().unwrap();
    player
        .edit_note_playback(track, vec![1], Some(PlayerConfig::Mute), &revision)
        .unwrap();
    assert_eq!(player.practice_target_count(), count - 2);
    assert_eq!(player.note_player(track, 0), PlayerConfig::Auto);
    assert_eq!(player.note_player(track, 1), PlayerConfig::Mute);
    let projected = document::notes(
        player.file.as_ref().unwrap(),
        &player.config,
        &player.fingers,
        &player.note_hands,
    );
    assert!(!projected.iter().any(|n| n.track == track && n.index == 1));
    assert_eq!(
        projected
            .iter()
            .find(|n| n.track == track && n.index == 0)
            .unwrap()
            .playback_mode,
        PlayerConfig::Auto
    );
    let page = player.read_note_playback(track, 0, 100).unwrap();
    assert!(
        page["notes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["index"] == 1 && n["mode"] == "Mute")
    );
    let scope = player.practice_scope();
    let mut session = PracticeSession::new(
        PracticeSessionKind::WholeSong,
        panthesia_core::practice::PracticeHands::Both,
        1.,
        AttemptSummary::default(),
    );
    session.mode = Some("wait".into());
    session.scope = Some(scope);
    session.context = Some(player.history_context());
    player
        .history
        .record_session(&content, "逐音规则", session)
        .unwrap();
    player.history.save().unwrap();
    let snapshot = player.history.snapshot_bytes().unwrap();
    assert!(String::from_utf8(snapshot).unwrap().starts_with("V2("));
    let loaded = PracticeHistoryStore::load_snapshot(player.history.path()).unwrap();
    assert_eq!(
        loaded.song(&content).unwrap().sessions[0]
            .context
            .as_ref()
            .unwrap()
            .note_playback,
        player.config.note_playback_rules()
    );
    let backup: crate::practice_backup::Backup = serde_json::from_value(
        player
            .practice_backup_snapshot(&Default::default())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(backup.version(), 18);
    let decoded = crate::practice_backup::Backup::decode(&backup.encode().unwrap()).unwrap();
    assert_eq!(
        decoded.history[&content].sessions[0]
            .context
            .as_ref()
            .unwrap()
            .note_playback,
        player.config.note_playback_rules()
    );
    let (bytes, _) = player.prepare_piece_package().unwrap();
    let mut package = crate::piece_package::Package::decode(&bytes).unwrap();
    assert_eq!(package.manifest.version, 14);
    assert_eq!(
        package.manifest.note_playback,
        player.config.note_playback_rules()
    );
    package.manifest.version = 13;
    assert!(package.encode().is_err());
    let revision = player.playback_revision().unwrap();
    player
        .edit_note_playback(track, vec![0, 1], None, &revision)
        .unwrap();
    assert_eq!(player.practice_target_count(), count);
}

#[test]
fn reference_audio_policy_keeps_background_playing_and_discard_silent_in_every_mode() {
    for mode in ["listen", "flow", "wait", "rhythm", "recital", "memory"] {
        assert!(reference_sounds(PlayerConfig::Auto, mode));
        assert!(!reference_sounds(PlayerConfig::Mute, mode));
        assert_eq!(
            reference_sounds(PlayerConfig::Human, mode),
            matches!(mode, "listen" | "flow")
        );
    }
}
