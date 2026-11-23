//! Player behaviour tests.
    use super::*;

    fn player() -> Player {
        static TEST_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "panthesia-engine-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        let midi = path.join("exercise.mid");
        std::fs::write(&midi, include_bytes!("../assets/five-finger.mid")).unwrap();
        let mut player = Player::new(path, PathBuf::new(), true);
        player
            .load_file(midi, "五指热身".into())
            .unwrap();
        // Practice tests run in wait mode; songs open in listen mode.
        player.command(Command::Mode { value: "wait".into() }).unwrap();
        player.state.count_in = 0;
        player
    }
    #[test]
    fn storage_freeze_keeps_keyboard_monitor_and_releases_without_assessment() {
        let mut p=player();p.state.status="playing".into();
        p.storage_busy.store(true,Ordering::Release);
        let before=p.matcher.snapshot();
        p.midi(&[144,60,90]);assert!(p.state.pressed.contains(&60));
        p.midi(&[128,60,0]);assert!(!p.state.pressed.contains(&60));
        let after=p.matcher.snapshot();
        assert_eq!(before.matched_notes,after.matched_notes);
        assert_eq!(before.wrong_notes,after.wrong_notes);
    }
    #[test]
    fn session_read_pairs_song_and_state_without_resetting_practice_or_errors() {
        let mut p = player();
        p.command(Command::Play).unwrap();
        p.tick(Duration::from_millis(5));
        p.state.error = Some("保留设备提示".into());
        let before = serde_json::to_value(p.snapshot()).unwrap();
        let session = p.command(Command::Session).unwrap();
        assert_eq!(session["song"]["contentId"], session["state"]["contentId"]);
        assert_eq!(session["state"], before);
        assert_eq!(serde_json::to_value(p.snapshot()).unwrap(), before);
        let mut empty = Player::new(p.data.join("empty-session"), PathBuf::new(), true);
        let session = empty.command(Command::Session).unwrap();
        assert!(session["song"].is_null());
        assert!(session["state"]["contentId"].is_null());
    }
    #[test]
    fn opening_passage_restores_latency_and_rejects_invalid_range_before_changing_settings() {
        let mut p=player();
        p.command(Command::SavePassage{content_id:None,id:None,name:"第一小节".into(),start:1,end:1,notes:String::new()}).unwrap();
        let content_id=p.file.as_ref().unwrap().content_id.clone();
        let id=p.preferences.passages[&content_id][0].id.clone();
        p.preferences.passages.get_mut(&content_id).unwrap()[0].settings.latency=42;
        p.state.latency=0;
        p.command(Command::OpenPassage{id:id.clone()}).unwrap();
        assert_eq!(p.state.latency,42);
        p.preferences.passages.get_mut(&content_id).unwrap()[0].end=usize::MAX;
        p.state.latency=7;
        p.state.mode="flow".into();
        let before=p.state.status.clone();
        assert!(p.command(Command::OpenPassage{id}).is_err());
        assert_eq!(p.state.latency,7);
        assert_eq!(p.state.mode,"flow");
        assert_eq!(p.state.status,before);
    }
    #[test]
    fn passage_write_failure_keeps_memory_equal_to_saved_data() {
        let mut p=player();
        p.command(Command::SavePassage{content_id:None,id:None,name:"原练习段".into(),start:1,end:1,notes:String::new()}).unwrap();
        let content_id=p.file.as_ref().unwrap().content_id.clone();
        let id=p.preferences.passages[&content_id][0].id.clone();
        let before=serde_json::to_value(&p.preferences.passages).unwrap();
        assert!(p.command(Command::SavePassage{content_id:Some("另一首曲目".into()),id:None,name:"错误曲目".into(),start:1,end:1,notes:String::new()}).is_err());
        assert!(p.command(Command::RemovePassage{content_id:Some("另一首曲目".into()),id:id.clone()}).is_err());
        assert_eq!(serde_json::to_value(&p.preferences.passages).unwrap(),before);
        p.preferences_path=p.preferences_path.parent().unwrap().to_path_buf();
        assert!(p.command(Command::SavePassage{content_id:None,id:Some(id.clone()),name:"未写入的改名".into(),start:1,end:1,notes:String::new()}).is_err());
        assert_eq!(serde_json::to_value(&p.preferences.passages).unwrap(),before);
        assert!(p.command(Command::RemovePassage{content_id:None,id}).is_err());
        assert_eq!(serde_json::to_value(&p.preferences.passages).unwrap(),before);
    }
    #[test]
    fn wait_freezes_transport_and_pause_keeps_required_target() {
        let mut player = player();
        player.command(Command::Play).unwrap();
        player.tick(Duration::from_millis(5));
        assert_eq!(player.snapshot().required, vec![60]);
        player.tick(Duration::from_secs(1));
        assert_eq!(player.state.position, 0.);
        player.command(Command::Pause).unwrap();
        player.tick(Duration::from_secs(1));
        assert_eq!(player.snapshot().required, vec![60]);
        player.command(Command::Play).unwrap();
        player.midi(&[144, 60, 90]);
        player.midi(&[128, 60, 0]);
        player.tick(Duration::from_millis(100));
        assert!(player.state.position > 0.);
    }
    #[test]
    fn input_overflow_pauses_and_invalid_seek_does_not_reset_results() {
        let mut player = player();
        player.command(Command::Play).unwrap();
        player.tick(Duration::from_millis(5));
        player.midi(&[144, 60, 90]);
        assert!(
            player
                .command(Command::Seek { position: f64::NAN })
                .is_err()
        );
        player.input_overflow.store(true, Ordering::Release);
        player.tick(Duration::from_millis(5));
        assert_eq!(player.state.status, "paused");
        assert!(player.state.pressed.is_empty());
    }
    #[test]
    fn loop_saves_each_round_and_excludes_the_end_boundary() {
        let mut p = player();
        p.command(Command::Loop {
            start: 0.,
            end: 0.6,
            enabled: true,
        })
        .unwrap();
        for round in 1..=2 {
            p.command(Command::Play).unwrap();
            p.tick(Duration::from_millis(1));
            assert_eq!(p.snapshot().required, vec![60]);
            p.midi(&[144, 60, 90]);
            p.midi(&[128, 60, 0]);
            p.tick(Duration::from_secs(1));
            assert_eq!(p.state.repetitions, round);
            assert_eq!(p.state.position, 0.);
            assert_eq!(p.state.status, "playing");
        }
        assert!(
            p.command(Command::Loop {
                start: 2.,
                end: 1.,
                enabled: true
            })
            .is_err()
        );
        assert_eq!(p.state.passage.as_ref().unwrap().end, 0.6);
    }
    #[test]
    fn restart_restores_preferences_without_starting_playback() {
        let mut p = player();
        p.command(Command::Speed { value: 0.65 }).unwrap();
        p.command(Command::Wait { enabled: false }).unwrap();
        let track = p.notes[0].track_id;
        p.command(Command::Track {
            id: track,
            mode: "human".into(),
            part: "right".into(),
            visible: true,
        })
        .unwrap();
        p.command(Command::Hands {
            value: "right".into(),
        })
        .unwrap();
        p.command(Command::Loop {
            start: 0.6,
            end: 1.8,
            enabled: true,
        })
        .unwrap();
        let data = p.preferences_path.parent().unwrap().to_owned();
        let before = std::fs::read(&p.preferences_path).unwrap();
        drop(p);
        let mut restored = Player::new(data, PathBuf::new(), true);
        restored.restore();
        assert_eq!(restored.state.status, "ready");
        assert_eq!(restored.state.speed, 0.65);
        assert!(!restored.state.wait);
        assert_eq!(restored.state.hands, "right");
        assert_eq!(restored.state.position, 0.6);
        assert_eq!(restored.notes.len(), 9);
        assert_eq!(std::fs::read(&restored.preferences_path).unwrap(), before);
    }
    #[test]
    fn chord_lesson_requires_all_three_pitches() {
        let mut p = player();
        let path = p.preferences_path.parent().unwrap().join("chords.mid");
        std::fs::write(&path, include_bytes!("../assets/basic-chords.mid")).unwrap();
        p.load_file(path, "三和弦".into())
        .unwrap();
        p.command(Command::Mode { value: "wait".into() }).unwrap();
        p.command(Command::CountIn { bars: 0 }).unwrap();
        p.command(Command::Play).unwrap();
        p.tick(Duration::from_millis(1));
        assert_eq!(p.snapshot().required, vec![60, 64, 67]);
        p.midi(&[144, 60, 90]);
        p.midi(&[144, 64, 90]);
        p.tick(Duration::from_millis(200));
        assert_eq!(p.state.position, 0.);
        p.midi(&[144, 67, 90]);
        p.tick(Duration::from_millis(200));
        assert!(p.state.position > 0.);
    }
    #[test]
    fn hand_assignment_uses_track_even_when_pitch_crosses_middle_c() {
        let mut p = player();
        assert!(
            p.command(Command::Hands {
                value: "left".into()
            })
            .is_err()
        );
        let track = p.notes[0].track_id;
        p.command(Command::Track {
            id: track,
            mode: "human".into(),
            part: "left".into(),
            visible: true,
        })
        .unwrap();
        p.command(Command::Hands {
            value: "left".into(),
        })
        .unwrap();
        p.command(Command::Play).unwrap();
        p.tick(Duration::from_millis(5));
        assert_eq!(p.snapshot().required, vec![60]);
        p.midi(&[144, 60, 100]);
    }
    #[test]
    fn count_in_does_not_move_transport_or_score() {
        let mut p = player();
        p.command(Command::CountIn { bars: 1 }).unwrap();
        p.command(Command::Play).unwrap();
        assert_eq!(p.state.status, "countIn");
        p.tick(Duration::from_millis(100));
        assert_eq!(p.state.position, 0.);
        assert!(p.snapshot().required.is_empty());
        p.tick(Duration::from_secs(10));
        assert_eq!(p.state.status, "playing");
        p.tick(Duration::from_millis(5));
        assert_eq!(p.snapshot().required, vec![60]);
    }
    #[test]
    fn fingering_preview_acceptance_undo_and_content_guard() {
        let mut p = player();
        // Start without hands or fingering: opening the song drafted both (song_prepare).
        p.write_hands(Vec::new(), false).unwrap();
        p.write_hints(Vec::new(), false).unwrap();
        assert!(
            p.command(Command::SuggestFingers {
                hand: None,
                track: 0,
                index: 0,
                profile: Default::default(),
                range: None
            })
            .is_err()
        );
        let track = p
            .file
            .as_ref()
            .unwrap()
            .tracks
            .iter()
            .find(|t| !t.notes.is_empty())
            .unwrap()
            .track_id;
        p.config
            .tracks
            .iter_mut()
            .find(|t| t.track_id == track)
            .unwrap()
            .practice_part = PracticePart::RightHand;
        let preview = p
            .command(Command::SuggestFingers {
                hand: None,
                track,
                index: 0,
                profile: Default::default(),
                range: Some((1, 1)),
            })
            .unwrap();
        assert_eq!(preview["proposals"].as_array().unwrap().len(), 4);
        assert!(p.saved_hints().unwrap().is_empty());
        let id = p.file.as_ref().unwrap().content_id.clone();
        let hint = panthesia_core::library::FingerHint {
            track_id: track,
            note_index: 0,
            finger: 2,
        };
        assert!(
            p.command(Command::ApplyFingers {
                content_id: "different".into(),
                hints: vec![hint]
            })
            .is_err()
        );
        let invalid = panthesia_core::library::FingerHint {
            note_index: 999,
            ..hint
        };
        assert!(
            p.command(Command::ApplyFingers {
                content_id: id.clone(),
                hints: vec![hint, invalid]
            })
            .is_err()
        );
        assert!(p.saved_hints().unwrap().is_empty());
        p.command(Command::ApplyFingers {
            content_id: id,
            hints: vec![hint],
        })
        .unwrap();
        assert_eq!(p.saved_hints().unwrap(), vec![hint]);
        p.command(Command::UndoFingers).unwrap();
        assert!(p.saved_hints().unwrap().is_empty());
    }
    #[test]
    fn suggestions_preserve_note_identity_when_release_order_differs() {
        let mut p = player();
        let file = p.file.as_mut().unwrap();
        let mut tracks = file.tracks.to_vec();
        let track = tracks.iter_mut().find(|t| !t.notes.is_empty()).unwrap();
        let track_id = track.track_id;
        let mut notes = track.notes.to_vec();
        notes.swap(0, 1);
        track.notes = notes.into();
        file.tracks = tracks.into();
        p.config
            .tracks
            .iter_mut()
            .find(|t| t.track_id == track_id)
            .unwrap()
            .practice_part = PracticePart::RightHand;
        let preview = p
            .command(Command::SuggestFingers {
                hand: None,
                track: track_id,
                index: 1,
                profile: Default::default(),
                range: None,
            })
            .unwrap();
        assert_eq!(preview["proposals"][0]["index"], 1);
        assert_eq!(preview["proposals"][0]["pitch"], 60);
    }
    #[test]
    fn per_note_hands_drive_targets_recommendations_undo_and_restore() {
        let mut p = player();
        let track = p.notes[0].track_id;
        let n = p.notes[0].clone();
        let second = p
            .notes
            .iter()
            .find(|v| v.track_id == track && v.index != n.index)
            .unwrap()
            .clone();
        let id = p.file.as_ref().unwrap().content_id.clone();
        p.command(Command::HandSpanDefault {
            hand: PracticePart::LeftHand,
            profile: panthesia_core::fingering::HandSpanProfile::Compact,
        })
        .unwrap();
        let hint = panthesia_core::library::NoteHandHint {
            track_id: track,
            note_index: n.index,
            part: PracticePart::LeftHand,
        };
        assert!(
            p.command(Command::ApplyHands {
                content_id: "stale".into(),
                hints: vec![hint],
                clear: vec![],
                proof: None,
            })
            .is_err()
        );
        p.command(Command::ApplyHands {
            content_id: id.clone(),
            hints: vec![hint],
            clear: vec![],
            proof: None,
        })
        .unwrap();
        let undo_count = p.hand_undo.len();
        p.command(Command::ApplyHands {
            content_id: id.clone(),
            hints: vec![hint],
            clear: vec![],
            proof: None,
        }).unwrap();
        assert_eq!(p.hand_undo.len(), undo_count);
        assert_eq!(p.command(Command::HandUndoState).unwrap()["undoAvailable"], true);
        p.command(Command::Hands {
            value: "left".into(),
        })
        .unwrap();
        assert_eq!(p.note_player(track, n.index), PlayerConfig::Human);
        assert_eq!(p.note_player(track, second.index), PlayerConfig::Auto);
        p.command(Command::Play).unwrap();
        p.tick(Duration::from_millis(1));
        assert_eq!(p.snapshot().required, vec![n.note]);
        p.midi(&[144, n.note, 90]);
        let proposed = p
            .command(Command::SuggestFingers {
                hand: Some(PracticePart::LeftHand),
                track,
                index: n.index,
                profile: Default::default(),
                range: Some((1, 1)),
            })
            .unwrap();
        assert!(
            proposed["proposals"]
                .as_array()
                .unwrap()
                .iter()
                .all(|h| h["index"] == n.index)
        );
        let data = p.data.clone();
        drop(p);
        let mut p = Player::new(data, PathBuf::new(), true);
        p.restore();
        assert_eq!(
            p.preferences
                .hand_span_defaults
                .get(&PracticePart::LeftHand),
            Some(&panthesia_core::fingering::HandSpanProfile::Compact)
        );
        assert_eq!(
            p.note_hands.get(&(track, n.index)),
            Some(&PracticePart::LeftHand)
        );
        p.command(Command::NoteHand {
            track,
            index: n.index,
            part: Some(PracticePart::RightHand),
        })
        .unwrap();
        p.command(Command::UndoHands).unwrap();
        assert_eq!(
            p.note_hands.get(&(track, n.index)),
            Some(&PracticePart::LeftHand)
        );
        let before = hands::hints(&p.note_hands);
        assert!(
            p.command(Command::ApplyHands {
                content_id: id.clone(),
                hints: vec![panthesia_core::library::NoteHandHint {
                    track_id: track,
                    note_index: usize::MAX,
                    part: PracticePart::LeftHand
                }],
                clear: vec![],
                proof: None,
            })
            .is_err()
        );
        assert_eq!(hands::hints(&p.note_hands), before);
        p.command(Command::ApplyHands {
            content_id: id,
            hints: vec![],
            clear: vec![(track, n.index)],
            proof: None,
        }).unwrap();
        assert!(!p.note_hands.contains_key(&(track, n.index)));
        p.command(Command::UndoHands).unwrap();
        assert_eq!(p.note_hands.get(&(track, n.index)), Some(&PracticePart::LeftHand));
    }
    #[test]
    fn hand_span_override_rejects_stale_song_and_survives_restore() {
        use panthesia_core::fingering::HandSpanProfile;

        let mut p = player();
        let content_id = p.file.as_ref().unwrap().content_id.clone();
        let track = p.notes[0].track_id;
        let proposal = p.command(Command::SuggestHands {
            track,
            range: (1, 1),
            reference: 60,
        }).unwrap();
        let old_proof = proposal["proof"].as_str().unwrap().to_owned();
        let command = |content_id: String, profile| Command::HandSpanFor {
            content_id,
            track,
            hand: PracticePart::LeftHand,
            profile,
        };
        assert!(p.command(command("stale".into(), Some(HandSpanProfile::Compact))).is_err());
        p.command(command(content_id.clone(), Some(HandSpanProfile::Large)))
            .unwrap();
        assert!(p.command(Command::ApplyHands {
            content_id: content_id.clone(),
            hints: vec![],
            clear: vec![],
            proof: Some(old_proof),
        }).is_err());
        let data = p.data.clone();
        drop(p);
        let mut restored = Player::new(data, PathBuf::new(), true);
        restored.restore();
        let key = format!("{track}:left");
        assert_eq!(
            restored.preferences.hand_span_profiles[&content_id][&key],
            HandSpanProfile::Large
        );
        restored.command(command(content_id.clone(), None)).unwrap();
        assert!(!restored.preferences.hand_span_profiles[&content_id].contains_key(&key));
    }
    #[test]
    fn measure_part_preparation_targets_only_the_requested_track_and_hand() {
        let mut p = player();
        let content_id = p.file.as_ref().unwrap().content_id.clone();
        let first = p.notes[0].clone();
        let second = p.notes.iter().find(|n| n.track_id == first.track_id && n.index != first.index).unwrap().clone();
        p.note_hands.insert((first.track_id, first.index), PracticePart::LeftHand);
        p.note_hands.insert((second.track_id, second.index), PracticePart::RightHand);
        let old_hands = p.state.hands.clone();
        assert!(p.command(Command::PrepareMeasurePart { content_id: "wrong".into(), measure: 1, part: PracticePart::LeftHand, track_id: first.track_id }).is_err());
        assert_eq!(p.state.hands, old_hands);
        p.command(Command::PrepareMeasurePart { content_id, measure: 1, part: PracticePart::LeftHand, track_id: first.track_id }).unwrap();
        assert_eq!(p.state.hands, "left");
        assert_eq!(p.note_player(first.track_id, first.index), PlayerConfig::Human);
        assert_eq!(p.note_player(second.track_id, second.index), PlayerConfig::Auto);
        assert!(p.state.passage.is_some());
    }
    #[test]
    fn measure_part_command_accepts_browser_fields_and_other_notes() {
        let mut p = player();
        let content_id = p.file.as_ref().unwrap().content_id.clone();
        let note = p.notes[0].clone();
        let other_hand = p.notes.iter().find(|n| n.track_id == note.track_id && n.index != note.index).unwrap().clone();
        p.note_hands.insert((note.track_id, note.index), PracticePart::Other);
        p.note_hands.insert((other_hand.track_id, other_hand.index), PracticePart::RightHand);
        p.state.mode = "listen".into();
        let command: Command = serde_json::from_value(serde_json::json!({
            "type":"prepareMeasurePart", "contentId":content_id,
            "measure":1, "part":"Other", "trackId":note.track_id
        })).unwrap();
        p.command(command).unwrap();
        assert_eq!(p.state.hands, "other");
        assert_eq!(p.state.mode, "flow");
        assert_eq!(p.note_player(note.track_id, note.index), PlayerConfig::Human);
        assert_eq!(p.note_player(other_hand.track_id, other_hand.index), PlayerConfig::Auto);
    }
    #[test]
    fn cross_paper_transfer_preserves_identities_and_target_grid(){
        use score_attachments::{AnnotationDraft,Mapping,PageAnchor};use score_attachments::cross_transfer::{Request,Anchor};
        let mut p=player();let cid=p.file.as_ref().unwrap().content_id.clone();let source_cid="other-performance-with-missing-midi";let data=p.data.clone();
        let source=score_attachments::add(&data,source_cid,"旧演奏谱",b"\x89PNG\r\n\x1a\nsource".to_vec(),None).unwrap();let sb=source["active"].as_str().unwrap().to_owned();let sa=source["attachments"][0]["pages"][0]["id"].as_str().unwrap().to_owned();
        score_attachments::edit_annotation(&data,source_cid,&sb,None,Some(AnnotationDraft{asset_id:sa,page:1,x:0.1,y:0.2,text:"换指 3→1".into(),color:"yellow".into(),width:None,height:None,ink:None}),None).unwrap();score_attachments::set_mapping(&data,source_cid,&sb,Some(Mapping{grid:"source-grid-must-not-copy".into(),enabled:true,anchors:vec![PageAnchor{measure:12,page:1,region:None}]})).unwrap();
        let original=score_attachments::list(&data,source_cid).unwrap();let note=original["attachments"][0]["annotations"][0]["id"].as_str().unwrap().to_owned();
        let target=score_attachments::add(&data,&cid,"新演奏谱",b"\x89PNG\r\n\x1a\ntarget".to_vec(),None).unwrap();let tb=target["active"].as_str().unwrap().to_owned();let ta=target["attachments"][0]["pages"][0]["id"].as_str().unwrap().to_owned();
        score_attachments::edit_annotation(&data,&cid,&tb,None,Some(AnnotationDraft{asset_id:ta.clone(),page:1,x:0.7,y:0.6,text:"保留目标批注".into(),color:"blue".into(),width:None,height:None,ink:None}),None).unwrap();
        score_attachments::set_mapping(&data,&cid,&tb,Some(Mapping{grid:p.grid_signature(),enabled:true,anchors:vec![PageAnchor{measure:1,page:1,region:None}]})).unwrap();
        let request=|baseline:String|Request{source_content_id:source_cid.into(),source:sb.clone(),target:tb.clone(),baseline,annotations:vec![score_attachments::TransferAnnotation{id:note.clone(),asset_id:ta.clone(),page:1,x:0.3,y:0.4}],anchors:vec![Anchor{source_measure:12,measure:2,page:1,region:None}]};
        let listed=p.command(Command::PaperTransferSources{content_id:cid.clone()}).unwrap();assert_eq!(listed["sources"][0]["contentId"],source_cid);
        let preview=p.preview_cross_paper(&cid,source_cid,&sb,&tb).unwrap();let proof=preview["baseline"].as_str().unwrap().to_owned();let result=p.apply_cross_paper(&cid,request(proof.clone())).unwrap();assert_eq!(result["added"],1);assert!(p.apply_cross_paper(&cid,request(proof)).is_err());
        let read=score_attachments::list(&data,&cid).unwrap();assert_eq!(read["attachments"][0]["annotations"].as_array().unwrap().len(),2);assert_eq!(read["attachments"][0]["mapping"]["grid"],p.grid_signature());assert_eq!(read["attachments"][0]["mapping"]["anchors"][1]["measure"],2);assert_eq!(read["attachments"][0]["mapping"]["enabled"],false);assert_eq!(score_attachments::list(&data,source_cid).unwrap(),original);
        let preview=p.preview_cross_paper(&cid,source_cid,&sb,&tb).unwrap();assert_eq!(preview["imported"][0],note);assert_eq!(p.apply_cross_paper(&cid,request(preview["baseline"].as_str().unwrap().into())).unwrap()["added"],0);
        score_attachments::set_mapping(&data,&cid,&tb,Some(Mapping{grid:"expired-target-grid".into(),enabled:true,anchors:vec![PageAnchor{measure:1,page:1,region:None}]})).unwrap();let preview=p.preview_cross_paper(&cid,source_cid,&sb,&tb).unwrap();assert!(p.apply_cross_paper(&cid,request(preview["baseline"].as_str().unwrap().into())).is_err());assert_eq!(score_attachments::list(&data,&cid).unwrap()["attachments"][0]["mapping"]["grid"],"expired-target-grid");
        let mut reopened=Player::new(data.clone(),PathBuf::new(),true);reopened.load_file(p.file.as_ref().unwrap().source_path.clone().unwrap(), "重开目标".into()).unwrap();assert_eq!(score_attachments::list(&data,&cid).unwrap()["attachments"][0]["annotations"].as_array().unwrap().len(),2);
    }
    #[test]
    fn reviewed_score_can_be_saved_without_changing_current_practice() {
        let mut p=player();
        let cid=p.file.as_ref().unwrap().content_id.clone();
        let xml=br#"<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>"#;
        let old_revision=p.score_revision;
        let result=p.command(Command::SaveScoreVersion{bytes:xml.to_vec(),name:"待核对的谱面".into(),content_id:cid.clone()}).unwrap();
        assert_eq!(result["active"],false);
        assert_eq!(result["alreadySaved"],false);
        assert_eq!(p.score_revision,old_revision);
        assert!(p.notation.is_none());
        let repeat=p.command(Command::SaveScoreVersion{bytes:xml.to_vec(),name:"待核对的谱面".into(),content_id:cid.clone()}).unwrap();
        assert_eq!(repeat["alreadySaved"],true);
        assert_eq!(repeat["versionId"],result["versionId"]);
        let versions=p.command(Command::ScoreVersions).unwrap();
        assert_eq!(versions["versions"].as_array().unwrap().len(),1);
        assert_eq!(versions["versions"][0]["active"],false);
        let root=p.data.clone();drop(p);
        let reopened=Player::new(root,PathBuf::new(),true);
        assert_eq!(reopened.preferences.score_versions[&cid][0].id,result["versionId"].as_str().unwrap());
    }
    #[test]
    fn direct_musicxml_import_persists_performance_score_hands_and_original_fingers() {
        let mut p = player();
        let imported = p
            .import_score(include_bytes!("../../panthesia-notation/src/score_performance_test.musicxml")
                    .to_vec(), "lesson.musicxml".into(), 100)
            .unwrap();
        assert_eq!(imported["title"], "弱起与连音练习");
        assert!(imported["hasScore"].as_bool().unwrap());
        assert_eq!(imported["notes"].as_array().unwrap().len(), 6);
        assert!(
            imported["notes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n["part"] == "left")
        );
        assert!(
            imported["notes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n["finger"] == 3)
        );
        assert!((p.state.duration - 5.).abs() < 0.00001);
        let id = p.file.as_ref().unwrap().content_id.clone();
        let data = p.data.clone();
        drop(p);
        let mut p = Player::new(data, PathBuf::new(), true);
        p.restore();
        assert_eq!(p.file.as_ref().unwrap().content_id, id);
        assert!(p.notation.is_some());
        assert_eq!(p.notes.len(), 6);
        assert!(p.fingers.values().any(|f| *f == 3));
    }
    #[test]
    fn beat_navigation_uses_pickup_and_real_tempo_and_rejects_invalid_beats() {
        let mut p = player();
        p.import_score(include_bytes!("../../panthesia-notation/src/score_performance_test.musicxml")
                .to_vec(), "乐谱.musicxml".into(), 120)
        .unwrap();
        assert!(
            p.command(Command::SeekBeat {
                measure: 1,
                beat: 2.
            })
            .is_err()
        );
        p.command(Command::SeekBeat {
            measure: 2,
            beat: 2.,
        })
        .unwrap();
        let before = p.state.position;
        p.command(Command::StepBeat { direction: 1 }).unwrap();
        assert!(p.state.position > before);
        p.command(Command::StepBeat { direction: -1 }).unwrap();
        assert!((p.state.position - before).abs() < 0.00001);
        assert!(
            p.command(Command::SeekBeat {
                measure: 2,
                beat: f64::NAN
            })
            .is_err()
        );
    }
    #[test] fn scoped_score_finger_edits_are_atomic_guarded_clearable_and_undoable(){
     let mut p=player();let id=p.file.as_ref().unwrap().content_id.clone();let track=p.file.as_ref().unwrap().tracks.iter().find(|t|t.notes.len()>1).unwrap().track_id;
     let edit=|index,finger|fingerings::Edit{track_id:track,note_index:index,finger};
     let before=p.saved_hints().unwrap();
     assert!(p.command(Command::EditFingersFor{content_id:id.clone(),edits:vec![edit(0,Some(2)),edit(9999,None)]}).is_err());assert_eq!(p.saved_hints().unwrap(),before);
     assert!(p.command(Command::EditFingersFor{content_id:"another-song".into(),edits:vec![edit(0,Some(2))]}).is_err());
     p.command(Command::EditFingersFor{content_id:id.clone(),edits:vec![edit(0,Some(2)),edit(1,Some(4))]}).unwrap();assert!(p.command(Command::CurrentSong).unwrap()["fingerUndoAvailable"].as_bool().unwrap());
     p.command(Command::EditFingersFor{content_id:id.clone(),edits:vec![edit(0,None)]}).unwrap();assert!(!p.saved_hints().unwrap().iter().any(|h|h.note_index==0));
     assert!(p.command(Command::UndoFingersFor{content_id:"another-song".into()}).is_err());
     p.command(Command::UndoFingersFor{content_id:id.clone()}).unwrap();assert_eq!(p.saved_hints().unwrap().iter().find(|h|h.note_index==0).unwrap().finger,2);
     p.command(Command::UndoFingersFor{content_id:id}).unwrap();assert_eq!(p.saved_hints().unwrap(),before);
    }
