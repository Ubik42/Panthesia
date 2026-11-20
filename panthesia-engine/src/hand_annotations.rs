//! Hand assignment, editor profiles and undo operate on an owned musical context.
use crate::*;
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandUndoState {
    pub content_id: String,
    pub undo_available: bool,
    pub revision: String,
    pub proof: String,
    pub profile_revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_settled: Option<bool>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandAssignmentValue {
    pub index: usize,
    pub pitch: u8,
    pub start: f64,
    pub manual: Option<panthesia_core::practice::PracticePart>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandAssignmentRead {
    pub content_id: String,
    pub track: usize,
    pub revision: String,
    pub assignments: Vec<HandAssignmentValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_settled: Option<bool>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandSuggestionRead {
    pub content_id: String,
    pub proposals: Vec<hands::HandProposal>,
    pub proof: String,
    pub undo_available: bool,
}
impl Player {
    fn hand_undo_revision(&self) -> Result<String, String> {
        let content = &self.file.as_ref().ok_or("请先选择曲目")?.content_id;
        let bytes = serde_json::to_vec(&(
            content,
            self.score_revision,
            hands::hints(&self.note_hands),
            self.hand_undo.len(),
            self.hand_undo.last(),
        ))
        .map_err(|error| error.to_string())?;
        Ok(blake3::hash(&bytes).to_hex().to_string())
    }
    /// Some is a read response; None lets the caller persist changed practice conditions.
    pub(super) fn hand_annotation_command(
        &mut self,
        command: Command,
    ) -> Result<Option<serde_json::Value>, String> {
        match command {
            Command::SuggestHands {
                track,
                range,
                reference,
            } => {
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                let per_hand = self.preferences.hand_span_profiles.get(&file.content_id);
                let legacy = self
                    .preferences
                    .fingering_profiles
                    .get(&file.content_id)
                    .and_then(|tracks| tracks.get(&track))
                    .copied();
                let profile_for = |hand: PracticePart| {
                    per_hand
                        .and_then(|profiles| {
                            profiles.get(&format!("{track}:{}", hands::label(hand)))
                        })
                        .copied()
                        .or_else(|| self.preferences.hand_span_defaults.get(&hand).copied())
                        .or(legacy)
                        .unwrap_or_default()
                };
                let profiles = [
                    profile_for(PracticePart::LeftHand),
                    profile_for(PracticePart::RightHand),
                ];
                let proposals = hands::propose(
                    file,
                    &self.config,
                    &self.note_hands,
                    track,
                    range,
                    reference,
                    profiles,
                )?;
                let proof = self.hand_suggestion_proof()?;
                return serde_json::to_value(HandSuggestionRead {
                    content_id: file.content_id.clone(),
                    proposals,
                    proof,
                    undo_available: !self.hand_undo.is_empty(),
                })
                .map(Some)
                .map_err(|error| error.to_string());
            }
            Command::ResetPartSettings {content_id,track,proof} => {
                let file=self.file.as_ref().ok_or("请先选择曲目")?;
                if file.content_id!=content_id || self.hand_suggestion_proof()?!=proof {return Err("曲目或手别已改变，请重新打开音轨设置".into());}
                let defaults=panthesia_core::song_config::SongConfig::new(&file.tracks);
                let default=defaults.tracks.iter().find(|t|t.track_id==track).ok_or("找不到声部")?.clone();
                let hints=hands::hints(&self.note_hands).into_iter().filter(|h|h.track_id!=track).collect();
                self.write_hands(hints,true)?;
                let mut rules=(*self.config.note_players).clone();rules.retain(|(id,_),_|*id!=track);self.config.note_players=Arc::new(rules);
                self.set_track_appearance(track,None)?;
                self.set_track_sound(track,None)?;
                self.command(Command::Track{id:track,mode:match default.player {panthesia_core::song_config::PlayerConfig::Auto=>"auto",panthesia_core::song_config::PlayerConfig::Mute=>"mute",_=>"human"}.into(),part:hands::label(default.practice_part).into(),visible:default.visible})?;
            }
            Command::SetPartHands {content_id,track,part,split_pitch,proof,hints,clear} => {
                let file=self.file.as_ref().ok_or("请先选择曲目")?;
                if file.content_id!=content_id || self.hand_suggestion_proof()?!=proof{return Err("曲目或手别已改变，请重新打开音轨设置".into());}
                if part.is_some()==split_pitch.is_some() || split_pitch.is_some_and(|p|p>127){return Err("手别分配参数无效".into());}
                let source=file.tracks.iter().find(|t|t.track_id==track).ok_or("音轨不存在")?;
                let previous=self.config.tracks.iter().find(|t|t.track_id==track).ok_or("音轨不存在")?;
                let visible=previous.visible;let previous_part=previous.practice_part;
                let mut merged=hands::hints(&self.note_hands);merged.retain(|h|h.track_id!=track);
                if let Some(pitch)=split_pitch{
                    merged.extend(source.notes.iter().enumerate().map(|(index,n)|panthesia_core::library::NoteHandHint{track_id:track,note_index:index,part:if n.note<pitch{PracticePart::LeftHand}else{PracticePart::RightHand}}));
                }
                if hints.len()+clear.len()>4096 || hints.iter().any(|h|h.track_id!=track) || clear.iter().any(|&i|i>=source.notes.len()){return Err("逐音修正参数无效或超过 4096 个".into());}
                let clear=clear.into_iter().collect::<std::collections::HashSet<_>>();
                let replacements=hints.iter().map(|h|h.note_index).collect::<std::collections::HashSet<_>>();
                if clear.iter().any(|i|replacements.contains(i)){return Err("同一音符不能同时设置和清除手别".into());}
                merged.retain(|h|h.track_id!=track||(!clear.contains(&h.note_index)&&!replacements.contains(&h.note_index)));
                merged.extend(hints);
                self.write_hands(merged,true)?;
                if let Some(part)=part{
                    self.command(Command::Track{id:track,mode:if part==PracticePart::Other{"auto"}else{"human"}.into(),part:hands::label(part).into(),visible:if part==PracticePart::Other{false}else if previous_part==PracticePart::Other{true}else{visible}})?;
                }
            }
            Command::ApplyHands {
                content_id,
                hints,
                clear,
                proof,
            } => {
                if self
                    .file
                    .as_ref()
                    .is_none_or(|f| f.content_id != content_id)
                {
                    return Err("曲目已切换，请重新审阅分手建议".into());
                }
                if let Some(proof) = proof {
                    if self.hand_suggestion_proof()? != proof {
                        return Err("分手标注、跨度或音乐网格已改变，请重新生成分手建议".into());
                    }
                }
                if hints.len() + clear.len() > 4096 {
                    return Err("一次最多接受 4096 个分手标注".into());
                }
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                for &(track, index) in &clear {
                    if file
                        .tracks
                        .iter()
                        .find(|item| item.track_id == track)
                        .and_then(|item| item.notes.get(index))
                        .is_none()
                    {
                        return Err("音符不存在，分手信息未保存".into());
                    }
                }
                let clear: std::collections::HashSet<_> = clear.into_iter().collect();
                if hints
                    .iter()
                    .any(|hint| clear.contains(&(hint.track_id, hint.note_index)))
                {
                    return Err("同一音符不能同时设置和清除逐音分手".into());
                }
                let mut merged = hands::hints(&self.note_hands);
                merged.retain(|hint| !clear.contains(&(hint.track_id, hint.note_index)));
                for h in hints {
                    merged.retain(|v| v.track_id != h.track_id || v.note_index != h.note_index);
                    merged.push(h);
                }
                merged.sort_by_key(|hint| (hint.track_id, hint.note_index));
                if merged == hands::hints(&self.note_hands) {
                    return Ok(Some(serde_json::json!({"ok":true,"changed":false})));
                }
                self.write_hands(merged, true)?;
            }
            Command::NoteHand { track, index, part } => {
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                if file
                    .tracks
                    .iter()
                    .find(|t| t.track_id == track)
                    .and_then(|t| t.notes.get(index))
                    .is_none()
                {
                    return Err("音符不存在".into());
                }
                let mut hints = hands::hints(&self.note_hands);
                hints.retain(|v| v.track_id != track || v.note_index != index);
                if let Some(part) = part {
                    hints.push(panthesia_core::library::NoteHandHint {
                        track_id: track,
                        note_index: index,
                        part,
                    });
                }
                self.write_hands(hints, true)?;
            }
            Command::UndoHandsFor { expected } => {
                if expected != self.hand_undo_revision()? {
                    return Err("分手或撤销记录已变化，请读取当前资料后再撤销".into());
                }
                return self.hand_annotation_command(Command::UndoHands);
            }
            Command::ReadHandAssignments { track, indices } => {
                if indices.len() > 4096 {
                    return Err("一次最多读取 4096 个音符的分手".into());
                }
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                let path = self.annotation_path(file)?;
                let sidecar = if panthesia_core::utils::atomic_file::is_file(
                    &panthesia_core::library::metadata_sidecar_path(&path),
                ) {
                    panthesia_core::library::load_song_sidecar(&path, &file.content_id)
                        .map_err(|error| error.to_string())?
                } else {
                    panthesia_core::library::SongSidecar::default()
                };
                let stored: HashMap<_, _> = sidecar
                    .hands
                    .iter()
                    .map(|hint| ((hint.track_id, hint.note_index), hint.part))
                    .collect();
                let notes = &file
                    .tracks
                    .iter()
                    .find(|row| row.track_id == track)
                    .ok_or("音轨不存在")?
                    .notes;
                let assignments = indices
                    .into_iter()
                    .map(|index| {
                        let note = notes.get(index).ok_or("原音符位置已改变，请重新选择")?;
                        if stored.get(&(track, index)) != self.note_hands.get(&(track, index)) {
                            return Err("曲目文件中的分手资料已变化，请重新打开曲目核对结果".into());
                        }
                        Ok(HandAssignmentValue {
                            index,
                            pitch: note.note,
                            start: note.start.as_secs_f64(),
                            manual: self.note_hands.get(&(track, index)).copied(),
                        })
                    })
                    .collect::<Result<Vec<_>, String>>()?;
                return serde_json::to_value(HandAssignmentRead {
                    content_id: file.content_id.clone(),
                    track,
                    revision: self.hand_undo_revision()?,
                    assignments,
                    write_settled: None,
                })
                .map(Some)
                .map_err(|error| error.to_string());
            }
            Command::UndoHands => {
                let previous = self
                    .hand_undo
                    .last()
                    .cloned()
                    .ok_or("没有可撤销的分手修改")?;
                self.write_hands(previous, false)?;
                self.hand_undo.pop();
            }
            Command::HandUndoState => {
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                return serde_json::to_value(HandUndoState {
                    content_id: file.content_id.clone(),
                    undo_available: !self.hand_undo.is_empty(),
                    revision: self.hand_undo_revision()?,
                    proof: self.hand_suggestion_proof()?,
                    profile_revision: crate::practice_catalog::profiles_revision(
                        &self.preferences,
                    )?,
                    write_settled: None,
                })
                .map(Some)
                .map_err(|error| error.to_string());
            }
            Command::HandSpanDefault { hand, profile } => {
                if hand == PracticePart::Other {
                    return Err("请指定左手或右手".into());
                }
                self.preferences.hand_span_defaults.insert(hand, profile);
            }
            Command::HandSpanFor {
                content_id,
                track,
                hand,
                profile,
            } => {
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                if file.content_id != content_id {
                    return Err("曲目已切换，请重新设置手的跨度".into());
                }
                if !file.tracks.iter().any(|item| item.track_id == track) {
                    return Err("音轨不存在".into());
                }
                if hand == PracticePart::Other {
                    return Err("请指定左手或右手".into());
                }
                let key = format!("{track}:{}", hands::label(hand));
                let profiles = self
                    .preferences
                    .hand_span_profiles
                    .entry(content_id)
                    .or_default();
                if let Some(profile) = profile {
                    profiles.insert(key, profile);
                } else {
                    profiles.remove(&key);
                }
            }
            Command::FingerProfiles => {
                let f = self.file.as_ref().ok_or("请先选择曲目")?;
                return Ok(Some(
                    serde_json::json!({"profiles":self.preferences.fingering_profiles.get(&f.content_id),"profilesByHand":self.preferences.hand_span_profiles.get(&f.content_id),"defaults":self.preferences.hand_span_defaults}),
                ));
            }
            _ => return Err("分手编辑命令无效".into()),
        }
        Ok(None)
    }
    pub(super) fn hand_suggestion_proof(&self) -> Result<String, String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let mut parts: Vec<_> = self
            .config
            .tracks
            .iter()
            .map(|track| (track.track_id, track.practice_part))
            .collect();
        parts.sort_by_key(|(track, _)| *track);
        let context = serde_json::json!({
            "contentId": &file.content_id,
            "grid": self.grid_signature(),
            "parts": parts,
            "hands": hands::hints(&self.note_hands),
            "profiles": self.preferences.hand_span_profiles.get(&file.content_id),
            "defaults": &self.preferences.hand_span_defaults,
            "legacyProfiles": self.preferences.fingering_profiles.get(&file.content_id),
        });
        let bytes = serde_json::to_vec(&context).map_err(|error| error.to_string())?;
        Ok(blake3::hash(&bytes).to_hex().to_string())
    }
    pub(super) fn write_hands(
        &mut self,
        hints: Vec<panthesia_core::library::NoteHandHint>,
        remember: bool,
    ) -> Result<(), String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        for h in &hints {
            if file
                .tracks
                .iter()
                .find(|t| t.track_id == h.track_id)
                .and_then(|t| t.notes.get(h.note_index))
                .is_none()
            {
                return Err("音符不存在，分手信息未保存".into());
            }
        }
        panthesia_core::library::save_song_hands(
            &self.annotation_path(file)?,
            &file.content_id,
            hints.clone(),
        )
        .map_err(|e| e.to_string())?;
        if remember {
            self.hand_undo.push(hands::hints(&self.note_hands));
            if self.hand_undo.len() > 30 {
                self.hand_undo.remove(0);
            }
        }
        self.note_hands = hints
            .into_iter()
            .map(|h| ((h.track_id, h.note_index), h.part))
            .collect::<HashMap<_, _>>()
            .into();
        let scope = self.state.hands.clone();
        if scope != "custom" && self.set_hand_scope(&scope).is_err() {
            self.set_hand_scope("both")?;
        }
        self.previous_summary = None;
        self.previous_mode = None;
        self.coach = AdaptiveTempoCoach::default();
        self.state.status = "paused".into();
        self.reset(self.state.passage.as_ref().map_or(0., |p| p.start));
        Ok(())
    }
}

#[cfg(test)]
mod product_hand_tests {
    use super::*;
    #[test]
    fn whole_track_split_and_reset_preserve_fingers_and_reject_stale_edits(){
        use midi_file::midly::{Smf,Header,Format,Timing,TrackEvent,TrackEventKind,MidiMessage,MetaMessage};
        let data=std::env::temp_dir().join(format!("panthesia-product-hands-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&data).unwrap();let path=data.join("owned-input.mid");let mut events=vec![];
        for i in 0..5000 {let key=if i%2==0{48}else{72};events.push(TrackEvent{delta:0.into(),kind:TrackEventKind::Midi{channel:0.into(),message:MidiMessage::NoteOn{key:key.into(),vel:80.into()}}});events.push(TrackEvent{delta:1.into(),kind:TrackEventKind::Midi{channel:0.into(),message:MidiMessage::NoteOff{key:key.into(),vel:0.into()}}});}
        events.push(TrackEvent{delta:0.into(),kind:TrackEventKind::Meta(MetaMessage::EndOfTrack)});let smf=Smf{header:Header::new(Format::SingleTrack,Timing::Metrical(480.into())),tracks:vec![events]};smf.save(&path).unwrap();let bytes=std::fs::read(&path).unwrap();
        let mut player=Player::empty(data.clone(),Default::default(),true);player.command(Command::Load{path:path.clone(),title:"Owned split fixture".into()}).unwrap();let file=player.file.as_ref().unwrap();let cid=file.content_id.clone();let owned=player.annotation_path(file).unwrap();
        panthesia_core::library::save_song_fingerings(&owned,&cid,vec![panthesia_core::library::FingerHint{track_id:0,note_index:0,finger:4}]).unwrap();
        let proof=player.hand_suggestion_proof().unwrap();player.command(Command::SetPartHands{content_id:cid.clone(),track:0,part:None,split_pitch:Some(60),proof:proof.clone(),hints:vec![panthesia_core::library::NoteHandHint{track_id:0,note_index:0,part:PracticePart::RightHand}],clear:vec![1]}).unwrap();
        let saved=panthesia_core::library::load_song_sidecar(&owned,&cid).unwrap();assert_eq!(saved.hands.len(),4999);assert_eq!(saved.fingerings[0].finger,4);assert_eq!(saved.hands.iter().find(|h|h.note_index==0).unwrap().part,PracticePart::RightHand);assert_eq!(saved.hands.iter().find(|h|h.note_index==2).unwrap().part,PracticePart::LeftHand);assert!(!saved.hands.iter().any(|h|h.note_index==1));
        let before=std::fs::read(panthesia_core::library::metadata_sidecar_path(&owned)).unwrap();assert!(player.command(Command::SetPartHands{content_id:cid.clone(),track:0,part:Some(PracticePart::LeftHand),split_pitch:None,proof,hints:vec![],clear:vec![]}).is_err());assert_eq!(std::fs::read(panthesia_core::library::metadata_sidecar_path(&owned)).unwrap(),before);
        let proof=player.hand_suggestion_proof().unwrap();player.command(Command::SetPartHands{content_id:cid.clone(),track:0,part:Some(PracticePart::LeftHand),split_pitch:None,proof,hints:vec![],clear:vec![]}).unwrap();let saved=panthesia_core::library::load_song_sidecar(&owned,&cid).unwrap();assert!(saved.hands.is_empty());assert_eq!(saved.track_parts[&0],PracticePart::LeftHand);assert_eq!(saved.fingerings[0].finger,4);assert_eq!(std::fs::read(&path).unwrap(),bytes);
        player.apply_variant_memory(&crate::practice_variant::Variant{transpose:2,..Default::default()}).unwrap();let proof=player.hand_suggestion_proof().unwrap();
        player.command(Command::SetPartHands{content_id:cid.clone(),track:0,part:None,split_pitch:Some(50),proof,hints:vec![],clear:vec![]}).unwrap();let saved=panthesia_core::library::load_song_sidecar(&owned,&cid).unwrap();assert_eq!(saved.hands.len(),5000);assert!(saved.hands.iter().all(|h|h.part==PracticePart::RightHand));assert_eq!(saved.fingerings[0].finger,4);assert_eq!(std::fs::read(path).unwrap(),bytes);

    }
}
