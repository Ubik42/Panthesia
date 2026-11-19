//! Save one annotation snapshot and project only the current performance's notes.
use crate::{Command, Player};
use panthesia_core::{
    exercise::ExercisePlan,
    library::{self, FingerAction, FingerHint},
    piano_layout::KeyboardRange,
};
use std::collections::{BTreeSet, HashMap};

pub(crate) fn project(
    file: &midi_file::MidiFile,
    exercise: Option<panthesia_core::exercise::ExerciseSpec>,
    hints: &[FingerHint],
) -> Result<HashMap<(usize, std::time::Duration, u8), u8>, String> {
    let mut fingers = HashMap::new();
    if let Some(spec) = exercise {
        let plan = ExercisePlan::generate(spec, &KeyboardRange::new(21..=108))
            .map_err(|e| e.to_string())?;
        if let Some(defaults) = plan.fingerings() {
            for track in file.tracks.iter() {
                if let Some(first) = track.notes.first() {
                    let values = if first.channel == 0 {
                        &defaults.right
                    } else {
                        &defaults.left
                    };
                    for (note, finger) in track.notes.iter().zip(values) {
                        fingers.insert((track.track_id, note.start, note.note), *finger);
                    }
                }
            }
        }
    }
    for hint in hints {
        if let Some(note) = file
            .tracks
            .iter()
            .find(|track| track.track_id == hint.track_id)
            .and_then(|track| track.notes.get(hint.note_index))
        {
            fingers.insert((hint.track_id, note.start, note.note), hint.finger);
        }
    }
    Ok(fingers)
}

impl Player {
    pub(super) fn edit_finger_annotations(&mut self, command: Command) -> Result<(), String> {
        match command {
            Command::EditFingersFor { content_id, edits } => {
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                if file.content_id != content_id {
                    return Err("曲目已切换，指法修改未保存".into());
                }
                if edits.is_empty() || edits.len() > 4096 {
                    return Err("请选择 1 至 4096 个音符".into());
                }
                let mut hints = self.saved_hints()?;
                let mut identities = std::collections::HashSet::new();
                for edit in edits {
                    if !identities.insert((edit.track_id, edit.note_index)) {
                        return Err("同一音符包含重复修改，未保存".into());
                    }
                    if edit.finger.is_some_and(|f| !(1..=5).contains(&f))
                        || !file
                            .tracks
                            .iter()
                            .any(|t| t.track_id == edit.track_id && edit.note_index < t.notes.len())
                    {
                        return Err("指法包含无效音符或编号，未保存任何修改".into());
                    }
                    hints
                        .retain(|h| h.track_id != edit.track_id || h.note_index != edit.note_index);
                    if let Some(finger) = edit.finger {
                        hints.push(panthesia_core::library::FingerHint {
                            track_id: edit.track_id,
                            note_index: edit.note_index,
                            finger,
                        });
                    }
                }
                self.write_hints(hints, true)?;
            }
            Command::UndoFingersFor { content_id } => {
                if self
                    .file
                    .as_ref()
                    .is_none_or(|f| f.content_id != content_id)
                {
                    return Err("曲目已切换，撤销未执行".into());
                }
                let previous = self
                    .finger_undo
                    .last()
                    .cloned()
                    .ok_or("没有可撤销的指法修改")?;
                self.write_schedule(previous.0, previous.1, false)?;
                self.finger_undo.pop();
            }
            Command::Finger {
                track,
                index,
                finger,
            } => {
                if finger.is_some_and(|f| !(1..=5).contains(&f)) {
                    return Err("指法应为 1 到 5".into());
                }
                let f = self.file.as_ref().ok_or("请先选择曲目")?;
                f.tracks
                    .iter()
                    .find(|t| t.track_id == track)
                    .and_then(|t| t.notes.get(index))
                    .ok_or("音符不存在")?;
                let mut hints = self.saved_hints()?;
                hints.retain(|h| h.track_id != track || h.note_index != index);
                if let Some(finger) = finger {
                    hints.push(panthesia_core::library::FingerHint {
                        track_id: track,
                        note_index: index,
                        finger,
                    });
                }
                self.write_hints(hints, true)?;
            }
            Command::ApplyFingers { content_id, hints } => {
                if self
                    .file
                    .as_ref()
                    .is_none_or(|f| f.content_id != content_id)
                {
                    return Err("曲目已切换，请重新生成指法建议".into());
                }
                if hints.len() > 4096 {
                    return Err("一次最多接受 4096 个指法".into());
                }
                let mut merged = self.saved_hints()?;
                for h in hints {
                    merged.retain(|v| v.track_id != h.track_id || v.note_index != h.note_index);
                    merged.push(h);
                }
                self.write_hints(merged, true)?;
            }
            Command::UndoFingers => {
                let previous = self
                    .finger_undo
                    .last()
                    .cloned()
                    .ok_or("没有可撤销的指法修改")?;
                self.write_schedule(previous.0, previous.1, false)?;
                self.finger_undo.pop();
            }
            _ => return Err("指法编辑命令无效".into()),
        }
        Ok(())
    }
    pub(crate) fn saved_hints(&self) -> Result<Vec<FingerHint>, String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let path = self.annotation_path(file)?;
        match library::load_song_sidecar(&path, &file.content_id) {
            Ok(sidecar) => Ok(sidecar.fingerings),
            Err(library::MetadataError::Read(error))
                if error.kind() == std::io::ErrorKind::NotFound =>
            {
                Ok(Vec::new())
            }
            Err(error) => Err(error.to_string()),
        }
    }
    pub(crate) fn write_hints(
        &mut self,
        hints: Vec<FingerHint>,
        remember: bool,
    ) -> Result<(), String> {
        self.save_finger_annotations(hints, None, remember)
    }
    pub(crate) fn write_schedule(
        &mut self,
        hints: Vec<FingerHint>,
        actions: Vec<FingerAction>,
        remember: bool,
    ) -> Result<(), String> {
        self.save_finger_annotations(hints, Some(actions), remember)
    }
    fn save_finger_annotations(
        &mut self,
        hints: Vec<FingerHint>,
        actions: Option<Vec<FingerAction>>,
        remember: bool,
    ) -> Result<(), String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let path = self.annotation_path(file)?;
        let mut sidecar = match library::load_song_sidecar(&path, &file.content_id) {
            Ok(sidecar) => sidecar,
            Err(library::MetadataError::Read(error))
                if error.kind() == std::io::ErrorKind::NotFound =>
            {
                Default::default()
            }
            Err(error) => return Err(error.to_string()),
        };
        let previous = (sidecar.fingerings.clone(), sidecar.finger_actions.clone());
        let retained: BTreeSet<_> = previous.0.iter().copied().collect();
        let active_note = |h: &FingerHint| {
            file.tracks
                .iter()
                .find(|t| t.track_id == h.track_id)
                .and_then(|t| t.notes.get(h.note_index))
        };
        for hint in &hints {
            // Generated layouts share an identity across hands and repetitions.
            // Off-view entries may be carried unchanged, never introduced or edited here.
            let carry = self.exercise.is_some() && retained.contains(hint);
            if !(1..=5).contains(&hint.finger) || (active_note(hint).is_none() && !carry) {
                return Err("指法包含无效的音符或手指编号，未保存任何修改".into());
            }
        }
        let fingers = project(file, self.exercise, &hints)?;
        sidecar.fingerings = hints;
        if let Some(actions) = actions {
            sidecar.finger_actions = actions;
        }
        library::save_song_sidecar(&path, &file.content_id, sidecar).map_err(|e| e.to_string())?;
        if remember {
            self.finger_undo.push(previous);
            if self.finger_undo.len() > 30 {
                self.finger_undo.remove(0);
            }
        }
        self.fingers = fingers.into();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Command, Engine, data_root_lock::DataRootLock, history_loading::tests::seeded};
    use panthesia_core::{
        exercise::{ExerciseHands, ExerciseSpec},
        practice::PracticePart,
    };
    use std::path::PathBuf;
    fn spec(hands: ExerciseHands, repetitions: u8) -> ExerciseSpec {
        ExerciseSpec {
            hands,
            repetitions,
            ..Default::default()
        }
    }
    fn generated() -> Player {
        let (mut player, _, _) = seeded(false, false);
        player
            .command(Command::Generate {
                spec: spec(ExerciseHands::Both, 1),
            })
            .unwrap();
        player
    }
    fn track(player: &Player, channel: u8) -> usize {
        player
            .file
            .as_ref()
            .unwrap()
            .tracks
            .iter()
            .find(|t| t.notes.first().is_some_and(|n| n.channel == channel))
            .unwrap()
            .track_id
    }
    fn path(player: &Player) -> PathBuf {
        player
            .annotation_path(player.file.as_ref().unwrap())
            .unwrap()
    }
    fn finger(player: &mut Player, track: usize, index: usize, value: Option<u8>) {
        player
            .command(Command::Finger {
                track,
                index,
                finger: value,
            })
            .unwrap();
    }
    fn read(player: &Player) -> library::SongSidecar {
        library::load_song_sidecar(&path(player), &player.file.as_ref().unwrap().content_id)
            .unwrap()
    }
    #[test]
    fn public_single_hand_edits_keep_the_other_hands_annotations() {
        let mut player = generated();
        let right = track(&player, 0);
        let left = track(&player, 1);
        finger(&mut player, right, 0, Some(4));
        finger(&mut player, left, 0, Some(2));
        let cid = player.file.as_ref().unwrap().content_id.clone();
        let data = player.data.clone();
        drop(player);
        let engine = Engine::start(
            data.clone(),
            DataRootLock::acquire(&data).unwrap(),
            PathBuf::new(),
            true,
        )
        .unwrap();
        engine
            .command(Command::Generate {
                spec: spec(ExerciseHands::Left, 1),
            })
            .unwrap();
        engine
            .command(Command::Finger {
                track: left,
                index: 0,
                finger: Some(3),
            })
            .unwrap();
        let saved = engine.command(Command::CurrentSong).unwrap();
        assert!(
            saved["notes"]
                .as_array()
                .unwrap()
                .iter()
                .all(|n| n["track"] != right)
        );
        assert_eq!(saved["notes"][0]["finger"], 3);
        engine
            .command(Command::Generate {
                spec: spec(ExerciseHands::Right, 1),
            })
            .unwrap();
        engine
            .command(Command::ApplyFingers {
                content_id: cid.clone(),
                hints: vec![FingerHint {
                    track_id: right,
                    note_index: 0,
                    finger: 1,
                }],
            })
            .unwrap();
        engine
            .command(Command::Generate {
                spec: spec(ExerciseHands::Both, 1),
            })
            .unwrap();
        let notes = engine.command(Command::CurrentSong).unwrap()["notes"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(
            notes
                .iter()
                .find(|n| n["track"] == right && n["index"] == 0)
                .unwrap()["finger"],
            1
        );
        assert_eq!(
            notes
                .iter()
                .find(|n| n["track"] == left && n["index"] == 0)
                .unwrap()["finger"],
            3
        );
    }
    #[test]
    fn shorter_repetitions_keep_saved_later_notes_while_editing_and_undoing() {
        let mut player = generated();
        player
            .command(Command::Generate {
                spec: spec(ExerciseHands::Both, 3),
            })
            .unwrap();
        let right = track(&player, 0);
        let tail = player
            .file
            .as_ref()
            .unwrap()
            .tracks
            .iter()
            .find(|t| t.track_id == right)
            .unwrap()
            .notes
            .len()
            - 1;
        finger(&mut player, right, tail, Some(4));
        player
            .command(Command::Generate {
                spec: spec(ExerciseHands::Both, 1),
            })
            .unwrap();
        assert!(
            tail >= player
                .file
                .as_ref()
                .unwrap()
                .tracks
                .iter()
                .find(|t| t.track_id == right)
                .unwrap()
                .notes
                .len()
        );
        finger(&mut player, right, 0, Some(2));
        let saved = player.saved_hints().unwrap();
        assert!(
            saved
                .iter()
                .any(|h| h.track_id == right && h.note_index == tail && h.finger == 4)
        );
        finger(&mut player, right, 0, None);
        player.command(Command::UndoFingers).unwrap();
        assert_eq!(player.saved_hints().unwrap(), saved);
        player
            .command(Command::Generate {
                spec: spec(ExerciseHands::Both, 3),
            })
            .unwrap();
        let loaded = player.command(Command::CurrentSong).unwrap();
        assert_eq!(
            loaded["notes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["track"] == right && n["index"] == tail)
                .unwrap()["finger"],
            4
        );
    }
    #[test]
    fn unchanged_hidden_entries_do_not_authorize_new_or_changed_hidden_entries() {
        let mut player = generated();
        let right = track(&player, 0);
        finger(&mut player, right, 0, Some(4));
        player
            .command(Command::Generate {
                spec: spec(ExerciseHands::Left, 1),
            })
            .unwrap();
        let cid = player.file.as_ref().unwrap().content_id.clone();
        let disk = std::fs::read(library::metadata_sidecar_path(&path(&player))).unwrap();
        let before = player.fingers.clone();
        let undo = player.finger_undo.len();
        for hint in [
            FingerHint {
                track_id: right,
                note_index: 0,
                finger: 2,
            },
            FingerHint {
                track_id: right,
                note_index: 1,
                finger: 1,
            },
            FingerHint {
                track_id: 99,
                note_index: 0,
                finger: 3,
            },
            FingerHint {
                track_id: right,
                note_index: 0,
                finger: 9,
            },
        ] {
            assert!(
                player
                    .command(Command::ApplyFingers {
                        content_id: cid.clone(),
                        hints: vec![hint]
                    })
                    .is_err()
            );
            assert_eq!(
                std::fs::read(library::metadata_sidecar_path(&path(&player))).unwrap(),
                disk
            );
            assert_eq!(player.fingers, before);
            assert_eq!(player.finger_undo.len(), undo);
        }
        let (mut imported, _, _) = seeded(false, false);
        let mut hints = imported.saved_hints().unwrap();
        hints.push(FingerHint {
            track_id: 99,
            note_index: 0,
            finger: 2,
        });
        assert!(imported.write_hints(hints, true).is_err());
    }
    #[test]
    fn annotation_and_action_undo_uses_one_preserved_sidecar_snapshot() {
        let mut player = generated();
        let right = track(&player, 0);
        let left = track(&player, 1);
        finger(&mut player, right, 0, Some(4));
        finger(&mut player, left, 0, Some(2));
        let path = path(&player);
        let cid = player.file.as_ref().unwrap().content_id.clone();
        let mut original = read(&player);
        original.metadata.notes = Some("teacher's original note".into());
        original.hands = vec![library::NoteHandHint {
            track_id: right,
            note_index: 0,
            part: PracticePart::RightHand,
        }];
        original.finger_actions = vec![FingerAction {
            track_id: right,
            note_index: 0,
            before_track: right,
            before_index: 1,
            at_tick: 10,
            from: 1,
            to: 2,
            hand: PracticePart::RightHand,
            rate_milli: 1000,
        }];
        library::save_song_sidecar(&path, &cid, original.clone()).unwrap();
        player
            .command(Command::Generate {
                spec: spec(ExerciseHands::Left, 1),
            })
            .unwrap();
        finger(&mut player, left, 0, Some(3));
        let mut expected = original.clone();
        expected
            .fingerings
            .iter_mut()
            .find(|h| h.track_id == left && h.note_index == 0)
            .unwrap()
            .finger = 3;
        assert_eq!(read(&player), expected);
        player
            .command(Command::ClearHeldFingerActions {
                content_id: cid.clone(),
            })
            .unwrap();
        assert!(read(&player).finger_actions.is_empty());
        player
            .command(Command::UndoFingersFor {
                content_id: cid.clone(),
            })
            .unwrap();
        assert_eq!(read(&player), expected);
        player
            .command(Command::UndoFingersFor { content_id: cid })
            .unwrap();
        assert_eq!(read(&player), original);
        assert!(player.fingers.keys().all(|(track, _, _)| *track == left));
    }
    #[test]
    fn rejected_schedule_does_not_change_file_projection_or_undo() {
        let mut player = generated();
        let left = track(&player, 1);
        finger(&mut player, left, 0, Some(2));
        let mut hints = player.saved_hints().unwrap();
        hints
            .iter_mut()
            .find(|h| h.track_id == left && h.note_index == 0)
            .unwrap()
            .finger = 3;
        let data = std::fs::read(library::metadata_sidecar_path(&path(&player))).unwrap();
        let fingers = player.fingers.clone();
        let undo = player.finger_undo.len();
        let bad = FingerAction {
            track_id: left,
            note_index: 0,
            before_track: left,
            before_index: 1,
            at_tick: 1,
            from: 2,
            to: 2,
            hand: PracticePart::LeftHand,
            rate_milli: 1000,
        };
        assert!(player.write_schedule(hints, vec![bad], true).is_err());
        assert_eq!(
            std::fs::read(library::metadata_sidecar_path(&path(&player))).unwrap(),
            data
        );
        assert_eq!(player.fingers, fingers);
        assert_eq!(player.finger_undo.len(), undo);
    }
    #[test]
    fn cross_hand_edits_leave_saved_practice_sessions_unchanged() {
        let (mut player, cid, _) = seeded(true, false);
        let history = serde_json::to_value(&player.history.song(&cid).unwrap().sessions).unwrap();
        assert!(!history.as_array().unwrap().is_empty());
        player
            .command(Command::Generate {
                spec: spec(ExerciseHands::Left, 1),
            })
            .unwrap();
        assert_eq!(player.file.as_ref().unwrap().content_id, cid);
        let left = track(&player, 1);
        finger(&mut player, left, 0, Some(3));
        assert_eq!(
            serde_json::to_value(&player.history.song(&cid).unwrap().sessions).unwrap(),
            history
        );
    }
}
