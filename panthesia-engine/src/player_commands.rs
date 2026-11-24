//! Command dispatch of the player (runtime thread).
use crate::*;

impl Player {
    pub(crate) fn command(&mut self, command: Command) -> Result<serde_json::Value, String> {
        let command = normalize_mode(command)?;
        match &command {
            Command::StopSongAudition{id}=>{self.stop_song_audition(Some(id));return Ok(self.song_audition_state(Some(id)));},
            Command::SongAuditionState{id}=>return Ok(self.song_audition_state(Some(id))),
            Command::StartInstrumentPreview{id,content_id,track,program}=>return self.start_instrument_preview(id,content_id,*track,*program),
            _=>{}
        }
        if !(matches!(command,Command::Note{..})&&self.recorder.is_recording()) { storage_control::check_command(&self.storage_busy, &command)?; }
        if self.storage_busy.load(Ordering::Acquire) && matches!(command, Command::Panic | Command::Pause) {
            self.panic();
            self.time_connected = false;
            if self.state.status != "finished" { self.state.status = "paused".into(); }
            self.state.count_remaining = 0.;
            return Ok(serde_json::json!({"ok":true}));
        }
        if matches!(command, Command::Session) {
            let song = self.command(Command::CurrentSong)?;
            return Ok(serde_json::json!({ "song": song, "state": self.snapshot() }));
        }
        if self.finger_demo.is_some() && !matches!(&command, Command::StartFingerDemo{..}|Command::FingerDemoControl{..}|Command::StartHeldFingerDemo{..}|Command::StopFingerDemo{..}|Command::FingerDemoState|Command::CurrentSong|Command::Volume{..}|Command::SoundFont{..}) {
            self.panic();
        }
        match &command {
            Command::Bookmarks=>return self.bookmark_catalog(String::new()),
            Command::SaveBookmark{content_id,id,name,tick}=>return self.save_bookmark(content_id,id.clone(),name.clone(),*tick),
            Command::RemoveBookmark{content_id,id}=>return self.remove_bookmark(content_id,id),
            Command::PreviewTickRange{content_id,grid,start,end}=>return self.preview_tick_range(content_id,grid,start,end),
            Command::ApplyTickRange{range}=>return self.apply_tick_range(range),
            Command::SaveTickPassage{id,name,notes,range}=>return self.save_tick_passage(id.clone(),name.clone(),notes.clone(),range.clone()),
            _=>{}
        }
        let workspace_lock = if false {
            Some(data_locks::lock_for(&self.data)?)
        } else {
            None
        };
        let _workspace_guard = workspace_lock
            .as_ref()
            .map(|lock| lock.lock().map_err(|_| "曲库文件正忙"))
            .transpose()?;
        if self.recorder.is_recording()
            && matches!(
                command,
                Command::Generate { .. }
                    | Command::OpenPassage { .. }
                    | Command::Play
                    | Command::Restart
                    | Command::Seek { .. }
                    | Command::SeekBeat { .. }
                    | Command::StepBeat { .. }
                    | Command::SeekMeasure { .. }
                    | Command::MeasureLoop { .. }
                    | Command::PrepareMeasurePart { .. }
                    | Command::Loop { .. }
                    | Command::ApplyScoreRange { .. }
                    | Command::Mode { .. }
                    | Command::Track { .. }
                    | Command::ResetPartSettings { .. } | Command::SetPartHands { .. } | Command::ApplyHands { .. }
                    | Command::EditNotePlayback { .. }
                    | Command::NoteHand { .. }
                    | Command::Meter { .. } | Command::SaveMeterMap { .. }
                    | Command::UndoHands
                    | Command::Hands { .. }
            )
        {
            return Err("请先停止录音，再切换曲目或练习设置".into());
        }
        match &command {
            Command::PracticeTime {content_id,from,to} => return self.practice_time(content_id,*from,*to),
            _ => {}
        }
        let persist = !matches!(
            command,
            Command::Note { .. }
                | Command::Play
                | Command::Pause
                | Command::Panic
                | Command::ExportMidi
                | Command::Metadata
                | Command::Calibration
                | Command::Score
                | Command::SourceScore
                | Command::ScoreView { .. }
                | Command::ScoreMap { .. } | Command::ExportAnnotatedScore { .. }
                | Command::SuggestHands { .. }
                | Command::SuggestFingers { .. } | Command::FingerPlanContext { .. }
                | Command::Seek { .. }
        );
        let _legacy_persist = matches!(
            command,
            Command::Speed { .. }
                | Command::Wait { .. }
                | Command::Hands { .. }
                | Command::Input { .. }
                | Command::Output { .. }
                | Command::Loop { .. }
                | Command::Volume { .. }
        );
        if matches!(command, Command::CurrentSong) {
            let current_title = self
                .file
                .as_ref()
                .and_then(|f| {
                    self.annotation_path(f)
                        .ok()
                        .and_then(|path| {
                            panthesia_core::library::load_song_metadata(&path, &f.content_id).ok()
                        })
                        .and_then(|m| m.title)
                })
                .unwrap_or_else(|| self.title.clone());
            let harmony = self.harmony();
            let sections = self.sections();
            return match &self.file {
                Some(file) => serde_json::to_value(document::build(
                    file,
                    &current_title,
                    self.state.duration,
                    &self.config,
                    &self.fingers,
                    &self.note_hands,
                    self.meter_correction,
                    self.exercise.is_some(),
                    self.notation.is_some(),
                    self.score_revision,
                ))
                .map_err(|e| e.to_string()).map(|mut v|{v["annotationRevision"]=serde_json::json!(self.state.annotation_revision);v["grid"]=serde_json::json!(self.grid_signature());v["meterMap"]=serde_json::json!(self.current_meter_map());v["fingerUndoAvailable"]=serde_json::json!(!self.finger_undo.is_empty());v["trackSounds"]=serde_json::json!(self.track_sound_settings());v["soundPresets"]=serde_json::json!(self.soundfont_presets);self.decorate_tracks(&mut v);self.decorate_finger_actions(&mut v);v["practiceVariant"]=self.variant_document();v["harmony"]=serde_json::json!(harmony);v["sections"]=serde_json::json!(sections);if self.variant().active(){v["fingerActions"]=serde_json::json!([]);}v}),
                None => Ok(serde_json::Value::Null),
            };
        }
        if self.variant().active() && matches!(command,Command::Meter{..}|Command::SaveMeterMap{..}|Command::EditNotePlayback{..}) {return Err("请先恢复原始演奏，再修改源谱网格或演奏细节".into());}
        self.state.error = None;
        match command {
            Command::PracticeVariant{content_id,score_revision,value}=>return self.set_variant(&content_id,score_revision,value),
            Command::ExportPracticeVariant=>return self.export_practice_variant(),
            Command::AudioDevices=>return Ok(serde_json::json!({"devices":audio::Audio::devices()?})),
            Command::AudioDevice{..}=>return Err("请使用设备连接流程".into()),
            Command::StartInstrumentPreview{..}|Command::StopSongAudition{..}|Command::SongAuditionState{..}=>return Err("请使用曲目预览流程".into()),
            Command::TrackAppearance{id,appearance} => return self.set_track_appearance(id,appearance),
            Command::TrackSound{id,sound} => return self.set_track_sound(id,sound),
            Command::SoundFont { path } => return self.set_soundfont(path),
            Command::PreviewMeterMap{content_id,value} => return self.preview_meter_map(&content_id,value.as_ref()),
            Command::SaveMeterMap{content_id,value,proof} => return self.save_meter_map(&content_id,value,&proof),
            Command::Meter { value } => {
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                let grid = match value {
                    Some(meter) => Self::corrected_grid(file, meter)?,
                    None => self.original_grid.as_ref().ok_or("原始小节网格不存在")?.materialize(),
                };
                panthesia_core::library::save_song_meter(
                    &self.annotation_path(file)?,
                    &file.content_id,
                    value,
                )
                .map_err(|e| e.to_string())?;
                self.panic();
                self.state.status = "paused".into();
                self.state.passage = None;
                self.previous_mode = None;
                let file = self.file.as_mut().unwrap();
                file.measures = grid.bar_times(&file.tempo_track).into();
                file.beats = grid.beat_times(&file.tempo_track).into();
                file.musical_time = grid;
                self.meter_correction = value;
                self.meter_map=None;
                if let Some(asset) = self.notation.take() {
                    let asset=Arc::unwrap_or_clone(asset);
                    self.notation = Some(Arc::new(notation::ScoreAsset::new(asset.bytes, asset.name, file)?));
                }
                self.score_revision = self.score_revision.wrapping_add(1);
                self.reset(0.);
            }
            command @ (Command::SuggestHands { .. } | Command::ResetPartSettings { .. } | Command::SetPartHands { .. } | Command::ApplyHands { .. }
                | Command::NoteHand { .. } | Command::UndoHands | Command::UndoHandsFor { .. } | Command::HandUndoState | Command::ReadHandAssignments { .. }
                | Command::HandSpanDefault { .. } | Command::HandSpanFor { .. } | Command::FingerProfiles) => {
                if let Some(result) = self.hand_annotation_command(command)? { return Ok(result); }
            }
            Command::ReadNotePlayback { track, offset, limit } => return self.read_note_playback(track, offset, limit),
            Command::EditNotePlayback { track, indices, mode, expected } => return self.edit_note_playback(track, indices, mode, &expected),
            Command::ReadMeterEditorState => return self.meter_editor_state(),
            Command::PreviewScoreRangeTrim{content_id,score_revision,first,last,start_trim,end_trim}=>{self.score_range_context(&content_id,score_revision)?;return self.preview_score_range_trim(first,last,start_trim,end_trim);}
            Command::PreviewScoreRange {content_id,score_revision,first,last} => {
                self.score_range_context(&content_id,score_revision)?;
                return self.preview_score_range(first,last);
            }
            Command::ApplyScoreRange {content_id,score_revision,range} => {
                self.score_range_context(&content_id,score_revision)?;
                return self.apply_score_range(&range);
            }
            Command::SaveScorePassage {content_id,score_revision,id,name,notes,range} => {
                self.score_range_context(&content_id,score_revision)?;
                return self.save_score_passage(id,name,notes,range);
            }
            Command::Passages => {
                let f = self.file.as_ref().ok_or("请先选择曲目")?;
                return Ok(
                    serde_json::json!({"contentId":f.content_id,"grid":self.grid_signature(),"passages":self.preferences.passages.get(&f.content_id).cloned().unwrap_or_default()}),
                );
            }
            Command::UpdatePassageDetails {content_id,id,name,notes} => {
                if self.file.as_ref().is_none_or(|f|f.content_id!=content_id){return Err("曲目已切换，请重新打开练习段落".into());}
                if name.trim().is_empty() || name.chars().count()>80 || notes.len()>8192{return Err("练习段名称或备注过长/为空".into());}
                let mut prefs=self.preferences.clone();
                let preset=prefs.passages.get_mut(&content_id).and_then(|p|p.iter_mut().find(|p|p.id==id)).ok_or("练习段已不存在，请刷新列表")?;
                preset.name=name.trim().into();preset.notes=notes;
                prefs.save(&self.preferences_path)?;self.preferences=prefs;
                return Ok(serde_json::json!({"saved":true}));
            }
            Command::SavePassage {
                content_id: expected_content_id,
                id,
                name,
                start,
                end,
                notes,
            } => {
                let f = self.file.as_ref().ok_or("请先选择曲目")?;
                if expected_content_id.as_ref().is_some_and(|expected|expected!=&f.content_id){return Err("曲目已切换，请重新打开练习段落".into());}
                let content_id=f.content_id.clone();
                if id.as_ref().is_some_and(|id|self.preferences.passages.get(&f.content_id).is_some_and(|p|p.iter().any(|p|&p.id==id&&(p.score_range.is_some()||p.precise_range.is_some())))){return Err("精确练习段请重新审阅对应范围，或只更新名称与备注".into());}
                if name.trim().is_empty() || name.chars().count() > 80 {
                    return Err("练习段名称需要 1～80 个字".into());
                }
                if start == 0 || start > end || end > f.musical_time.measures.len() {
                    return Err("小节范围无效".into());
                }
                if notes.len() > 8192 {
                    return Err("练习备注过长".into());
                }
                let settings = preferences::SessionSettings {
                    tracks: self.config.practice_track_setup(),
                    parts: self
                        .config
                        .tracks
                        .iter()
                        .map(|t| (t.track_id, t.practice_part))
                        .collect(),
                    mode: Some(self.state.mode.clone()),
                    count_in: self.state.count_in,
                    metronome: self.state.metronome,
                    latency: self.state.latency,
                    rounds: self.state.rounds,
                    hands: self.state.hands.clone(),
                };
                let id = id.unwrap_or_else(|| {
                    format!(
                        "passage-{}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_nanos()
                    )
                });
                let preset = preferences::PassagePreset { practice: Some(self.passage_practice_snapshot()?),
                    grid: Some(self.grid_signature()),
                    score_range: None,
                    precise_range: None,
                    id: id.clone(),
                    name: name.trim().into(),
                    start,
                    end,
                    notes,
                    speed: self.state.speed,
                    settings,
                };
                let mut prefs=self.preferences.clone();
                let passages = prefs.passages.entry(content_id).or_default();
                if let Some(old) = passages.iter_mut().find(|p| p.id == id) {
                    *old = preset;
                } else {
                    if passages.len() >= 200 {
                        return Err("每首曲目最多保存 200 个练习段".into());
                    }
                    passages.push(preset);
                }
                prefs.save(&self.preferences_path)?;
                self.preferences=prefs;
                return Ok(serde_json::json!({"saved":true,"id":id}));
            }
            Command::RemovePassage { content_id, id } => {
                let f = self.file.as_ref().ok_or("请先选择曲目")?;
                if content_id.as_ref().is_some_and(|expected|expected!=&f.content_id){return Err("曲目已切换，请重新打开练习段落".into());}
                let mut prefs=self.preferences.clone();
                if let Some(passages) = prefs.passages.get_mut(&f.content_id) {
                    let before=passages.len();
                    passages.retain(|p| p.id != id);
                    if passages.len()!=before {
                        prefs.save(&self.preferences_path)?;
                        self.preferences=prefs;
                        return Ok(serde_json::json!({"removed":true}));
                    }
                }
                return Ok(serde_json::json!({"removed":false}));
            }
            Command::OpenPassage { id } => return self.open_saved_passage(&id),
            Command::ExercisePresets => {
                return Ok(serde_json::json!({"presets":self.preferences.exercise_presets}));
            }
            Command::SaveExercisePreset { name, spec } => {
                if name.trim().is_empty() || name.chars().count() > 80 {
                    return Err("练习方案名称需要 1～80 个字".into());
                }
                let plan = ExercisePlan::generate(spec, &KeyboardRange::new(21..=108))
                    .map_err(|e| e.to_string())?;
                let id = plan.practice_id();
                if self.preferences.exercise_presets.len() >= 200
                    && !self.preferences.exercise_presets.iter().any(|p| p.id == id)
                {
                    return Err("最多保存 200 个练习方案".into());
                }
                self.preferences.exercise_presets.retain(|p| p.id != id);
                self.preferences
                    .exercise_presets
                    .push(preferences::ExercisePreset {
                        id,
                        name: name.trim().into(),
                        spec,
                    });
            }
            Command::RemoveExercisePreset { id } => {
                self.preferences.exercise_presets.retain(|p| p.id != id)
            }
            Command::EditPaperAnnotation{content_id,book,id,draft,expected}=>return score_attachments::edit_annotation(&self.data,&content_id,&book,id.as_deref(),draft,expected),
            Command::EditPaperNoteAnchor{score_revision,content_id,book,track,index,draft,expected}=>{
                if score_revision.is_some_and(|revision| revision != self.score_revision) { return Err("谱面版本已改变，请重新读取音符位置后保存。草稿继续保留。".into()); }
                let file=self.file.as_ref().filter(|f|f.content_id==content_id).ok_or("曲目已切换，请重新打开谱页音符位置")?;
                let grid=self.grid_signature();
                if let Some(d)=&draft {
                    let candidates:Vec<_>=self.notes.iter().filter(|n|n.track_id==track&&n.index==index).collect();
                    if candidates.len()!=1||candidates[0].note!=d.pitch {return Err("参考音已改变或存在重复身份，请重新选择音符".into());}
                    let measure=file.measures.partition_point(|t|t.as_secs_f64()<=candidates[0].start.as_secs_f64());
                    if measure==0||measure!=d.measure||measure>file.musical_time.measures.len(){return Err("音符所在小节已改变，请重新选择音符".into());}
                }
                return score_attachments::edit_note_anchor(&self.data,&content_id,&book,track,index,draft,expected,&grid);
            }
            Command::BatchPaperNoteAnchors{content_id,book,edits}=>{
                let file=self.file.as_ref().filter(|f|f.content_id==content_id).ok_or("曲目已切换，请重新打开谱页音符位置")?;
                let grid=self.grid_signature();
                for e in &edits {
                    let candidates:Vec<_>=self.notes.iter().filter(|n|n.track_id==e.track&&n.index==e.index).collect();
                    if candidates.len()!=1||candidates[0].note!=e.draft.pitch {return Err("参考音已改变或存在重复身份，请重新选择音符".into());}
                    let measure=file.measures.partition_point(|t|t.as_secs_f64()<=candidates[0].start.as_secs_f64());
                    if measure==0||measure!=e.draft.measure||measure>file.musical_time.measures.len(){return Err("音符所在小节已改变，请重新选择音符".into());}
                }
                return score_attachments::batch_note_anchors(&self.data,&content_id,&book,edits,&grid);
            }
            Command::CreateLocatedScorePaper{content_id,score_revision,source_fingerprint,mapping_token,name,pages,anchors}=>{
                self.score_range_context(&content_id,score_revision)?;
                let asset=self.notation.as_deref().ok_or("当前曲目没有原谱")?;
                if asset.source_fingerprint!=source_fingerprint{return Err("原谱内容已改变，请重新生成纸谱".into());}
                let summary=panthesia_notation::score_alignment::summarize_alignment(&asset.alignment);
                if summary.readiness!=panthesia_notation::score_alignment::AlignmentReadiness::Ready||!asset.alignment.navigation_complete{return Err("原谱与 MIDI 尚未可靠对应，不能自动定位音符".into());}
                let file=self.file.as_ref().ok_or("请先打开曲目")?;
                let grid=self.grid_signature();
                let trusted=self.located_score_map.as_ref().filter(|m|m.content_id==content_id&&m.score_revision==score_revision&&m.source_fingerprint==source_fingerprint&&m.token==mapping_token&&m.grid==grid).ok_or("原谱逐音映射已改变，请重新打开原谱")?;
                let mut note_rows=HashMap::with_capacity(self.notes.len());
                for note in self.notes.iter() {
                    note_rows.entry((note.track_id,note.index)).and_modify(|row|*row=None).or_insert(Some(note));
                }
                for a in &anchors {
                    if trusted.notes.get(&(a.track,a.index)).is_none_or(|(renderer,page)|renderer!=&a.renderer_id||*page!=a.page.wrapping_sub(1)){return Err("音符与原谱位置不符，请重新生成纸谱".into());}
                    let note=note_rows.get(&(a.track,a.index)).copied().flatten().ok_or("参考音已改变或存在重复身份，请重新生成纸谱")?;
                    if note.note!=a.pitch{return Err("参考音已改变或存在重复身份，请重新生成纸谱".into());}
                    let measure=file.measures.partition_point(|t|t.as_secs_f64()<=note.start.as_secs_f64());
                    if measure==0||measure!=a.measure||measure>file.musical_time.measures.len(){return Err("音符所在小节已改变，请重新生成纸谱".into());}
                }
                return score_attachments::create_located_paper(&self.data,&content_id,&name,pages,anchors,&grid,&source_fingerprint);
            }
            Command::EditPaperInk{content_id,book,asset_id,page,expected,strokes}=>return score_attachments::edit_ink(&self.data,&content_id,&book,&asset_id,page,expected,strokes),
            Command::PaperPracticeContext => return serde_json::to_value(self.paper_practice_snapshot()).map_err(|error| error.to_string()),
            Command::PreviewPaperPractice{content_id,book,measure}=>return self.preview_paper_practice(&content_id,&book,measure),
            Command::SavePaperPractice{request}=>return self.save_paper_practice(request),
            command @ (Command::SeekPaperMeasure { .. } | Command::SeekPaperNote { .. }) => {
                return self.navigate_paper_owned(command);
            }
            Command::PaperTransferSources{content_id}=>{self.score_content_guard(&content_id)?;let mut result=score_attachments::cross_transfer::sources(&self.data,&content_id)?;for item in result["sources"].as_array_mut().unwrap(){if item["path"].is_null(){if let Some(h)=item["contentId"].as_str().and_then(|id|self.history.song(id)){if !h.display_name.trim().is_empty(){item["title"]=serde_json::json!(h.display_name);}item["path"]=serde_json::json!(h.library.source_path);}}}return Ok(result);},
            Command::PreviewCrossPaperTransfer{content_id,source_content_id,source,target}=>return self.preview_cross_paper(&content_id,&source_content_id,&source,&target),
            Command::ApplyCrossPaperTransfer{content_id,request}=>return self.apply_cross_paper(&content_id,request),
            Command::SetPaperMapping{score_revision,content_id,id,mapping,expected}=>{
                if score_revision.is_some_and(|revision| revision != self.score_revision) { return Err("谱面版本已改变，请重新读取小节对应后保存。草稿继续保留。".into()); }
                let file=self.file.as_ref().filter(|f|f.content_id==content_id).ok_or("曲目已切换，请重新打开谱页小节对应")?;
                if let Some(m)=&mapping{if m.grid!=self.grid_signature()||m.anchors.iter().any(|a|a.measure>file.musical_time.measures.len()){return Err("小节网格或范围已改变，请重新确认对应".into());}}
                return score_attachments::set_mapping_checked(&self.data,&content_id,&id,mapping,expected);
            }
            Command::ScoreAttachments{..}
            | Command::PaperSourceUpdates| Command::LinkPaperSource{..}|Command::InspectPaperSources{..}|Command::PreviewPaperSource{..}|Command::ApplyPaperSource{..}
            | Command::PreviewPaperTransfer{..}|Command::ApplyPaperTransfer{..}
            | Command::AddScoreAttachment{..}
            | Command::UpdateScoreAttachment{..}
 => unreachable!(),
            Command::Metadata => return serde_json::to_value(self.current_metadata()?).map_err(|error|error.to_string()),
            Command::SetMetadata { value } => return self.save_current_metadata(value, None),
            Command::EditMetadata { value, expected } => return self.save_current_metadata(value, Some(expected)),
            Command::PairScoreFile { .. } => return Err("乐谱文件配对由引擎入口读取文件后处理".into()),
            Command::SaveChords { content_id, chords } => return self.save_chords(&content_id, chords),
            Command::AdoptChords { content_id } => return self.adopt_chords(&content_id),
            Command::PlanVirtualFingers { content_id } => return Ok(serde_json::json!(self.planned_fingers(&content_id)?)),
            Command::StemGain { kind, gain } => {
                self.set_stem_gain(&kind, gain)?;
                return Ok(serde_json::json!(self.stems_state()));
            }
            Command::VstEditor => {
                self.vst
                    .as_ref()
                    .ok_or("请先选择 VST3 音源")?
                    .open_editor()
                    .map_err(|e| e.to_string())?;
            }
            Command::ScoreSources{..}|Command::PreviewScoreSource{..}=>return Err("请从独立线程检查原谱".into()),
            Command::LinkScoreSource{midi_path,content_id,version_id,path,default_bpm}=>return self.link_score_source(midi_path,content_id,version_id,path,default_bpm),
            Command::AcknowledgeScoreSource{id,fingerprint}=>return score_sources::acknowledge(&self.data,&id,&fingerprint),
            Command::UnlinkScoreSource{id,path}=>return score_sources::unlink(&self.data,&id,&path),
            Command::ApplyScoreSource{id,fingerprint,mode}=>return self.apply_score_source(id,fingerprint,mode),
            Command::ImportScoreOriginal{path,default_bpm}=>return self.import_score_original(path,default_bpm),
            Command::ScoreVersions => {
                let f = self.file.as_ref().ok_or("请先选择曲目")?;
                let midi = self.annotation_path(f)?;
                let (versions,current)=library_scores::versions(&self.preferences,&midi,&f.content_id)?;
                let rows:Vec<_>=versions.iter().map(|v|serde_json::json!({"id":v.id,"name":v.name,"path":v.path,"active":current.as_ref()==Some(&v.path),"available":v.path.is_file(),"fingerprint":v.content_id})).collect();
                return Ok(serde_json::json!({"contentId":f.content_id,"versions":rows}));
            }
            Command::PreviewScoreVersionRoute{id,content_id,include_document}=>{
                self.score_content_guard(&content_id)?;
                let file=self.file.as_ref().ok_or("请先选择曲目")?;
                let midi=self.annotation_path(file)?;
                let (versions,_)=library_scores::versions(&self.preferences,&midi,&content_id)?;
                let version=versions.iter().find(|v|v.id==id).ok_or("谱面版本不存在")?;
                let assoc=panthesia_core::library::ScoreAssociation{path:version.path.clone(),content_id:version.content_id.clone()};
                if !panthesia_core::library::verify_score_association(&midi,&assoc).map_err(|e|e.to_string())?{
                    return Err("谱面文件已经改变，请重新导入并检查顺序".into());
                }
                let asset=notation::ScoreAsset::new(panthesia_core::utils::atomic_file::read_dependency(&version.path,panthesia_notation::source_score_window::ASSET_LIMIT).map_err(|e|e.to_string())?,version.name.clone(),self.source_file.as_deref().unwrap_or(file))?;
                if asset.source_fingerprint != version.content_id { return Err("谱面文件在读取期间已改变，请重新预览".into()); }
                let mut result=asset.route_payload(Some(file));
                result["review"]=serde_json::to_value(self.score_review(&asset)).map_err(|error|error.to_string())?;
                if include_document { result["document"]=serde_json::json!({"bytes":asset.bytes,"name":asset.name}); }
                result["versionId"]=serde_json::json!(id);
                result["contentId"]=serde_json::json!(content_id);
                return Ok(result);
            }
            Command::PreviewScoreBytesRoute{bytes,name,content_id}=>{
                self.score_content_guard(&content_id)?;
                let file=self.file.as_ref().ok_or("请先选择曲目")?;
                let fingerprint=blake3::hash(&bytes).to_hex().to_string();
                let asset=notation::ScoreAsset::new(bytes,name,self.source_file.as_deref().unwrap_or(file))?;
                let mut result=asset.route_payload(Some(file));
                result["review"]=serde_json::to_value(self.score_review(&asset)).map_err(|error|error.to_string())?;
                result["fingerprint"]=serde_json::json!(fingerprint);
                result["contentId"]=serde_json::json!(content_id);
                return Ok(result);
            }
            Command::ActivateScore { id, content_id, expected } => {
                self.score_content_guard(&content_id)?;
                self.remember_active_score()?;
                let v = self
                    .preferences
                    .score_versions
                    .get(&content_id)
                    .and_then(|rows| rows.iter().find(|v| v.id == id))
                    .cloned()
                    .ok_or("谱面版本不存在")?;
                let f = self.file.as_ref().unwrap();
                let midi = self.annotation_path(f)?;
                let assoc = panthesia_core::library::ScoreAssociation {
                    path: v.path.clone(),
                    content_id: v.content_id,
                };
                if !panthesia_core::library::verify_score_association(&midi, &assoc)
                    .map_err(|e| e.to_string())?
                {
                    return Err("这份谱面文件已更改，请重新导入确认".into());
                }
                let score = notation::ScoreAsset::new(
                    panthesia_core::utils::atomic_file::read(&v.path).map_err(|e| e.to_string())?,
                    v.name,
                    self.source_file.as_deref().unwrap_or(f),
                )?;
                self.check_score_review(&score, expected.as_ref())?;
                panthesia_core::library::save_score_association(&midi, &content_id, &v.path)
                    .map_err(|e| e.to_string())?;
                self.panic();
                self.state.status = "paused".into();
                self.notation = Some(Arc::new(score));
                self.score_revision = self.score_revision.wrapping_add(1);
            }
            Command::DetachScore { content_id } => {
                self.score_content_guard(&content_id)?;
                self.remember_active_score()?;
                let f = self.file.as_ref().unwrap();
                panthesia_core::library::clear_score_association(
                    &self.annotation_path(f)?,
                    &content_id,
                )
                .map_err(|e| e.to_string())?;
                self.notation = None;
                self.score_revision = self.score_revision.wrapping_add(1);
            }
            Command::RemoveScoreVersion { id, content_id } => {
                self.score_content_guard(&content_id)?;
                let previous = self.preferences.score_versions.get(&content_id).cloned()
                    .ok_or("没有谱面版本")?;
                let f = self.file.as_ref().unwrap();
                let midi = self.annotation_path(f)?;
                let current = panthesia_core::library::load_song_sidecar(&midi, &content_id)
                    .ok()
                    .and_then(|s| s.score)
                    .map(|s| panthesia_core::library::resolve_score_path(&midi, &s));
                let rows = self
                    .preferences
                    .score_versions
                    .get_mut(&content_id)
                    .ok_or("没有谱面版本")?;
                let v = rows.iter().find(|v| v.id == id).ok_or("谱面版本不存在")?;
                if current.as_ref() == Some(&v.path) {
                    return Err("请先解除当前谱面的关联，再移除版本".into());
                }
                rows.retain(|v| v.id != id);
                if let Err(error) = self.preferences.save(&self.preferences_path) {
                    self.preferences.score_versions.insert(content_id, previous);
                    return Err(error);
                }
            }
            Command::RenameScoreVersion {
                id,
                content_id,
                name,
                expected_name,
            } => {
                self.score_content_guard(&content_id)?;
                let previous = self.preferences.score_versions.get(&content_id).cloned()
                    .ok_or("没有谱面版本")?;
                let name = name.trim();
                if name.is_empty() || name.chars().count() > 120 {
                    return Err("请输入 1 至 120 字的谱面名称".into());
                }
                let v = self
                    .preferences
                    .score_versions
                    .get_mut(&content_id)
                    .and_then(|rows| rows.iter_mut().find(|v| v.id == id))
                    .ok_or("谱面版本不存在")?;
                if expected_name.as_ref().is_some_and(|expected| expected != &v.name) { return Err("谱面名称已被其他操作改变，请核对后再保存。当前输入继续保留。".into()); }
                v.name = name.into();
                if let Err(error) = self.preferences.save(&self.preferences_path) {
                    self.preferences.score_versions.insert(content_id, previous);
                    return Err(error);
                }
            }
            Command::Score => return self.score_payload(true),
            Command::SourceScore => return self.score_payload(false),
            Command::ScoreView {content_id,score_revision,first_measure,position,source} => {
                if self.file.as_ref().is_none_or(|f|f.content_id!=content_id) || self.score_revision!=score_revision {return Err("曲目或谱面已切换，请重新读取".into());}
                return self.score_view_payload(first_measure,position,source);
            },
            Command::PairScore { bytes, name, content_id, expected } => {
                self.score_content_guard(&content_id)?;
                let file = self.file.as_ref().ok_or("请先打开 MIDI")?;
                if file.content_id != content_id { return Err("曲目已切换，请重新配对乐谱".into()); }
                let score = notation::ScoreAsset::new(bytes, name, self.source_file.as_deref().unwrap_or(file))?;
                self.check_score_review(&score, expected.as_ref())?;
                return self.pair_score_asset(score);
            }
            Command::SaveScoreVersion{bytes,name,content_id}=>{
                self.score_content_guard(&content_id)?;
                self.remember_active_score()?;
                let name=name.trim().to_owned();
                if name.is_empty()||name.chars().count()>120{return Err("谱面名称需为 1 至 120 字".into())}
                let hash=blake3::hash(&bytes).to_hex().to_string();
                let existing=self.preferences.score_versions.get(&content_id).and_then(|rows|rows.iter().find(|v|v.name==name&&v.content_id==hash)).cloned();
                if existing.is_none()&&self.preferences.score_versions.get(&content_id).is_some_and(|rows|rows.len()>=100){return Err("这首曲目已有 100 份谱面，请先移除不需要的版本".into())}
                let file=self.file.as_ref().ok_or("请先选择曲目")?;
                let score=notation::ScoreAsset::new(bytes,name.clone(),self.source_file.as_deref().unwrap_or(file))?;
                let midi=self.annotation_path(file)?;
                let path=self.store_score_version_file(&score,&content_id)?;
                if let Some(version)=existing{
                    let active=panthesia_core::library::load_song_sidecar(&midi,&content_id)
                        .ok().and_then(|sidecar|sidecar.score)
                        .is_some_and(|association|panthesia_core::library::resolve_score_path(&midi,&association)==version.path);
                    return Ok(serde_json::json!({"versionId":version.id,"contentId":content_id,"active":active,"alreadySaved":true}));
                }
                let id=format!("score-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos());
                let old=self.preferences.clone();
                self.preferences.score_versions.entry(content_id.clone()).or_default().push(preferences::ScoreVersion{id:id.clone(),name,path:path.clone(),content_id:hash});
                if let Err(error)=self.preferences.save(&self.preferences_path){self.preferences=old;let _=panthesia_core::utils::atomic_file::discard_or_remove(&path);return Err(error)}
                return Ok(serde_json::json!({"versionId":id,"contentId":content_id,"active":false,"alreadySaved":false}));
            }
            Command::ExportAnnotatedScore {content_id,score_revision,options,download,fingerprint} => {
                return self.annotated_score_artifact(&content_id,score_revision,&options,None,&|| Ok(()))?.into_value(download,fingerprint.as_deref());
            }
            Command::ScoreMap {score_revision,midi,notes,content_id} => {
                return self.map_score_owned(score_mapping::Input { measure_range:None,display_fingerprint:None,page_count: None,content_id,score_revision,source_fingerprint:None,midi,notes,practice_notation:false});
            }
            command @ (Command::EditFingersFor { .. } | Command::UndoFingersFor { .. }
                | Command::Finger { .. } | Command::ApplyFingers { .. } | Command::UndoFingers) => {
                self.edit_finger_annotations(command)?;
            }
            Command::StartFingerDemo{request,fingerprint,rate}=>return self.start_finger_demo(request,fingerprint,rate),
            Command::HeldFingerDemoContext{content_id,track,index,rate}=>return serde_json::to_value(self.prepare_held_demo(content_id,track,index,rate)?).map_err(|e|e.to_string()),
            Command::StartHeldFingerDemo{content_id,track,index,baseline,rate}=>return self.start_held_demo(content_id,track,index,baseline,rate),
            Command::FingerDemoState=>return Ok(self.finger_demo_state()),
            Command::StopFingerDemo{id}=>{if let Some(id)=id.as_deref(){self.cancel_replay_start(id);}if self.finger_demo.as_ref().is_some_and(|demo|id.as_ref().is_none_or(|id|&demo.id==id)){self.panic();}return Ok(self.finger_demo_state());},
            Command::SuggestFingerPlans{..}=>return Err("指法搜索应由独立调用线程执行".into()),
            Command::AcceptHeldFingerPlan{request,fingerprint,edits,actions}=>return self.accept_held_plan(request,fingerprint,edits,actions),
            Command::ClearHeldFingerActions{content_id}=>{if self.file.as_ref().is_none_or(|f|f.content_id!=content_id){return Err("曲目已切换，持音换指未清除".into());}self.write_schedule(self.saved_hints()?,vec![],true)?;},
            Command::ReviewHeldActionEdit{request}=>return self.review_action_edit(request),
            Command::SaveHeldActionEdit{request,review}=>return self.save_action_edit(request,review),
            Command::ClearNoteHeldFingerActions{content_id,track,index}=>{
              let file=self.file.as_ref().ok_or("请先选择曲目")?;
              if file.content_id!=content_id{return Err("曲目已切换，换指动作未清除".into());}
              if !file.tracks.iter().any(|t|t.track_id==track&&index<t.notes.len()){return Err("持音音符不存在，未清除动作".into());}
              let mut actions=self.saved_actions()?;let before=actions.len();actions.retain(|a|a.track_id!=track||a.note_index!=index);
              if actions.len()!=before{self.write_schedule(self.saved_hints()?,actions,true)?;}
            },
            Command::SuggestHeldFingerPlans{..}=>return Err("持音换指搜索应由独立调用线程执行".into()),
            Command::FingerPlanContext{request}=>{let file=self.file.as_ref().ok_or("请先选择曲目")?;return serde_json::to_value(fingerings::prepare(file,self.notation.as_deref(),&self.config,&self.fingers,&self.note_hands,request)?).map_err(|e|e.to_string());}
            Command::AcceptFingerPlan{request,fingerprint,edits}=>{
              let file=self.file.as_ref().ok_or("请先选择曲目")?;let prepared=fingerings::prepare(file,self.notation.as_deref(),&self.config,&self.fingers,&self.note_hands,request.clone())?;
              if prepared.fingerprint!=fingerprint{return Err("音符、分手或已有指法已变化，请重新生成方案".into());}
              let review=fingerings::review_acceptance_data(&prepared,&edits)?;
              if !review.valid{return Err("勾选建议与保留指法存在同时按键冲突，请先审阅保存结果、调整选择或固定已有指法重新推荐".into());}
              if edits.iter().any(|e|!prepared.positions.iter().any(|n|n.target&&n.track==e.track_id&&n.index==e.note_index)||e.finger.is_none()){return Err("方案包含选段之外的修改，未保存".into());}
              let edited_tracks:std::collections::HashSet<_>=edits.iter().map(|e|e.track_id).collect();
              let result=self.command(Command::EditFingersFor{content_id:request.content_id.clone(),edits})?;
              let profiles=self.preferences.hand_span_profiles.entry(request.content_id).or_default();
              for track in edited_tracks {profiles.insert(format!("{}:{}",track,hands::label(request.hand)),request.profile);}
              self.preferences.save(&self.preferences_path)?;return Ok(result);
            }
            Command::FingerDemoControl{id,action,position}=>return self.finger_demo_control(&id,&action,position),
            Command::StartPairFingerDemo{parts,proof,acknowledged,rate}=>return self.start_pair_demo(&parts,&proof,acknowledged,rate),
            Command::SavePairFingerPractice{parts,proof,acknowledged,ranges}=>return self.save_pair_practice(&parts,&proof,acknowledged,ranges),
            Command::FingerPair{parts,proof,acknowledged}=>return self.finger_pair(&parts,proof.as_deref(),acknowledged),
            Command::ReviewFingerAcceptance{request,fingerprint,edits}=>{
              let file=self.file.as_ref().ok_or("请先选择曲目")?;
              let prepared=fingerings::prepare(file,self.notation.as_deref(),&self.config,&self.fingers,&self.note_hands,request)?;
              if prepared.fingerprint!=fingerprint{return Err("音符、分手或已有指法已变化，请重新生成方案".into());}
              return fingerings::review_acceptance(&prepared,&edits);
            }
            Command::SaveFingerPractice{request,fingerprint,ranges}=>return self.save_finger_practice(request,fingerprint,ranges),
            Command::SuggestFingers { hand, track, index, profile, range } => {
                let context = self.prepare_basic_fingers(&fingerings::BasicRequest { hand, track, index, profile, range })?;
                let proposals = fingerings::basic_proposals(&context);
                return self.commit_basic_fingers(&context, proposals);
            }
            Command::Recording { active, bpm, click } => {
                if active && self.recorder.has_take() && !self.recording_saved { return Err("上一段录音尚未保存，请先点击保存录音".into()); }
                self.panic();
                if active {
                    self.ensure_audio()?;
                    self.matcher.reset();
                    let bpm = bpm.filter(|b| b.is_finite()).unwrap_or(panthesia_core::recorder::DEFAULT_BPM).clamp(20.0, 400.0);
                    self.recorder.start_at(bpm);
                    self.free_click = click.then(|| crate::player::FreeClick { started: std::time::Instant::now(), bpm, beat: None });
                    self.state.recording=true;
                    self.recording_saved=false;
                    self.recording_path=None;
                    self.state.status = "freePlay".into();
                } else {
                    self.state.recording=false;
                    self.free_click = None;
                    let path = self.new_recording_path();
                    let smf = match self.recorder.stop() {
                        Ok(smf) => smf,
                        Err(error) => {
                            self.state.status = "ready".into();
                            return Err(error.to_string());
                        }
                    };
                    std::fs::create_dir_all(path.parent().unwrap_or(&self.data)).map_err(|e| e.to_string())?;
                    smf.save(&path).map_err(|e| e.to_string())?;
                    self.recording_saved=true;
                    self.state.mode = "listen".into();
                    self.state.wait = false;
                    self.state.passage = None;
                    let file = crate::music_file::read_midi(&path)?;
                    self.install(file, "自由演奏录音".into(), None)?;
                    self.persist()?;
                    let result = self.command(Command::CurrentSong)?;
                    self.state.mode = "listen".into();
                    self.state.wait = false;
                    self.state.count_in = 0;
                    self.persist()?;
                    return Ok(result);
                }
            }
            Command::ExportMidi => {
                let bytes = self.prepare_midi_export()?;
                return Ok(serde_json::json!({"bytes":bytes,"title":self.title}));
            }
            Command::Panic => {
                self.panic();
                if self.state.status != "finished" { self.state.status = "paused".into(); }
                self.state.count_remaining = 0.;
            }
            Command::Generate { spec } => {
                exercise_loading::prepare(spec)?.install(self)?;
                self.persist()?;
                return self.command(Command::CurrentSong);
            }
            Command::Mode { value } => {
                let value = match value.as_str() {
                    "wait" | "listen" => value,
                    "flow" => "listen".into(),
                    _ => return Err("只支持连续播放与等待按键两种模式".into()),
                };
                if self.state.mode == value { return Ok(serde_json::json!({"ok":true})); }
                self.panic();
                self.state.mode = value;
                self.state.wait = self.state.mode == "wait";
                self.playback.reselect(self.state.position, &self.notes, |n| n.start.as_secs_f64());
                self.restore_track_sound();
            }
            Command::Track {
                id,
                mode,
                part,
                visible,
            } => {
                let player = match mode.as_str() {
                    "human" => PlayerConfig::Human,
                    "auto" => PlayerConfig::Auto,
                    "mute" => PlayerConfig::Mute,
                    _ => return Err("音轨模式无效".into()),
                };
                let part = match part.as_str() {
                    "left" => PracticePart::LeftHand,
                    "right" => PracticePart::RightHand,
                    "other" => PracticePart::Other,
                    _ => return Err("声部无效".into()),
                };
                let visible=self.switch_part_color(id,part,visible)?;
                let track = self
                    .config
                    .tracks
                    .iter_mut()
                    .find(|t| t.track_id == id)
                    .ok_or("找不到音轨")?;
                track.player = player;
                track.practice_part = part;
                track.visible = visible;
                let file=self.file.as_ref().ok_or("请先选择曲目")?;
                let path=self.annotation_path(file)?;
                let mut annotations=match panthesia_core::library::load_song_sidecar(&path,&file.content_id){
                    Ok(value)=>value,
                    Err(panthesia_core::library::MetadataError::Read(e)) if e.kind()==std::io::ErrorKind::NotFound=>Default::default(),
                    Err(e)=>return Err(e.to_string()),
                };
                annotations.track_parts.insert(id,part);
                // A whole track given to one hand replaces the generated note-by-note split on
                // it while that split is still an unchecked draft; a person's split stays.
                let drafted=part!=PracticePart::Other&&crate::song_prepare::pending_review(&path,"hands");
                if drafted{annotations.hands.retain(|h|h.track_id!=id);}
                panthesia_core::library::save_song_sidecar(&path,&file.content_id,annotations).map_err(|e|e.to_string())?;
                if drafted{self.note_hands.retain(|(track,_),_|*track!=id);}
                self.state.hands = "custom".into();
                self.previous_mode = None;
                self.reset(self.state.position);
            }
            Command::MeasureLoop {
                start,
                end,
                enabled,
            } => {
                let f = self.file.as_ref().ok_or("请先选择曲目")?;
                let first = f
                    .musical_time
                    .measures
                    .get(start.checked_sub(1).ok_or("小节从 1 开始")?)
                    .ok_or("起始小节超出曲目")?;
                let last = f
                    .musical_time
                    .measures
                    .get(end.checked_sub(1).ok_or("小节从 1 开始")?)
                    .ok_or("结束小节超出曲目")?;
                if end < start {
                    return Err("结束小节不能早于起始小节".into());
                }
                return self.command(Command::Loop {
                    start: f
                        .tempo_track
                        .pulses_to_duration(first.start_tick)
                        .as_secs_f64(),
                    end: f
                        .tempo_track
                        .pulses_to_duration(last.end_tick)
                        .as_secs_f64()
                        .min(self.state.duration),
                    enabled,
                });
            }
            Command::SeekMeasure { measure } => {
                let f = self.file.as_ref().ok_or("请先选择曲目")?;
                let m = f
                    .musical_time
                    .measures
                    .get(measure.checked_sub(1).ok_or("小节从 1 开始")?)
                    .ok_or("小节超出曲目")?;
                return self.command(Command::Seek {
                    position: f.tempo_track.pulses_to_duration(m.start_tick).as_secs_f64(),
                });
            }
            Command::SeekBeat { measure, beat } => {
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                let bar = file
                    .musical_time
                    .measures
                    .get(measure.checked_sub(1).ok_or("小节从 1 开始")?)
                    .ok_or("小节超出曲目")?;
                let group = if bar.denominator == 8 && bar.numerator >= 6 && bar.numerator % 3 == 0
                {
                    3.
                } else {
                    1.
                };
                let length =
                    f64::from(file.musical_time.ppq) * 4. / f64::from(bar.denominator) * group;
                let tick = bar.start_tick as f64 + (beat - 1.) * length;
                if !beat.is_finite() || beat < 1. || tick >= bar.end_tick as f64 {
                    return Err("拍位置超出当前小节；弱起只包含实际拍数".into());
                }
                let position = file
                    .tempo_track
                    .pulses_to_duration(tick.round() as u64)
                    .as_secs_f64();
                return self.command(Command::Seek { position });
            }
            Command::StepBeat { direction } => {
                if direction != 1 && direction != -1 {
                    return Err("逐拍方向无效".into());
                }
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                let mut ticks = Vec::new();
                for bar in file.musical_time.measures.iter() {
                    let group =
                        if bar.denominator == 8 && bar.numerator >= 6 && bar.numerator % 3 == 0 {
                            3
                        } else {
                            1
                        };
                    for b in (0..bar.numerator).step_by(group) {
                        let tick = bar.start_tick
                            + u64::from(b) * u64::from(file.musical_time.ppq) * 4
                                / u64::from(bar.denominator);
                        if tick >= bar.end_tick {
                            break;
                        }
                        let time = file.tempo_track.pulses_to_duration(tick).as_secs_f64();
                        if time < self.state.duration
                            && self
                                .state
                                .passage
                                .as_ref()
                                .is_none_or(|p| time >= p.start && time < p.end)
                        {
                            ticks.push(time);
                        }
                    }
                }
                let position = if direction > 0 {
                    ticks
                        .into_iter()
                        .find(|t| *t > self.state.position + 0.000001)
                } else {
                    ticks
                        .into_iter()
                        .rev()
                        .find(|t| *t < self.state.position - 0.000001)
                }
                .ok_or("已到当前范围的边界")?;
                return self.command(Command::Seek { position });
            }
            Command::Rounds { count } => {
                if count > 100 {
                    return Err("循环遍数不能超过 100".into());
                }
                self.state.rounds = count;
            }
            Command::Calibration => {
                use panthesia_core::practice::{
                    TimingCalibrationStatus as C, timing_calibration_status,
                };
                if !is_timed_mode(&self.state.mode)
                    && !self.previous_mode.as_deref().is_some_and(is_timed_mode)
                {
                    return Ok(
                        serde_json::json!({"message":"请先在连续模式下按节拍器演奏至少 24 个音符","suggested":null}),
                    );
                }
                let timing = self.matcher.timing();
                let (message, suggested) =
                    match timing_calibration_status(timing, self.state.latency) {
                        C::Suggested(s) => (
                            format!("参考偏移稳定，建议补偿 {} 毫秒", s.suggested_ms),
                            Some(s.suggested_ms),
                        ),
                        C::InsufficientSamples { captured, required } => (
                            format!("有效样本 {captured}/{required}，继续按节拍演奏"),
                            None,
                        ),
                        C::Unstable { deviation_ms, .. } => (
                            format!("当前节奏波动 {deviation_ms} 毫秒，暂不能判断设备延迟"),
                            None,
                        ),
                        C::Centered => ("当前偏移在正常范围内".into(), None),
                        C::AtLimit => ("补偿已达到范围上限".into(), None),
                    };
                return Ok(serde_json::json!({"message":message,"suggested":suggested}));
            }
            Command::CountIn { bars } => {
                if bars > 4 {
                    return Err("预备拍应为 0 到 4 小节".into());
                }
                self.state.count_in = bars;
            }
            Command::Metronome { enabled } => {self.state.metronome = enabled;self.playback.last_beat=None;},
            Command::Latency { milliseconds } => {
                if !(-250..=250).contains(&milliseconds) {
                    return Err("延迟补偿应为 -250 到 250 毫秒".into());
                }
                self.state.latency = milliseconds;
                let key = self.calibration_key();
                self.preferences.calibrations.insert(key, milliseconds);
            }
            Command::OpenFile { .. } => return Err("打开文件应由引擎调用线程处理".into()),
            Command::RecentFiles | Command::ForgetRecentFile { .. } => return Err("最近打开列表应由引擎调用线程处理".into()),
            Command::SongFiles => return self.song_files(),
            Command::ReloadStems => {
                self.load_stems();
                return Ok(serde_json::json!(self.stems_state()));
            }
            Command::SongSearch { .. } | Command::SongFolder | Command::SetSongFolder { .. } | Command::RescanSongFolder => return Err("曲目索引应由引擎调用线程处理".into()),
            Command::SongSummary { .. } | Command::SongSummaries { .. } | Command::SongCover { .. } | Command::GenerateMaterial { .. } | Command::TranscriptionTool | Command::SetTranscriptionTool { .. } => return Err("歌曲资料应由引擎调用线程处理".into()),
            Command::EditSongFile { action, path, id, role, stem, label } => {
                let edit = song_files::SongFileEdit::parse(&action, path, id, role, stem, label)?;
                return self.edit_song_file(edit);
            }
            Command::Play => {
                if self.state.status!="playing"{self.time_connected=false;}
                if self.recorder.is_recording() {
                    return Err("请先停止录音，再开始曲目练习".into());
                }
                if self.state.mode != "listen"
                    && !self
                        .notes
                        .iter()
                        .any(|n| self.note_player(n.track_id, n.index) == PlayerConfig::Human)
                {
                    return Err("请设置至少一条自己弹的音轨，或切换到聆听模式".into());
                }
                if self.file.is_none() {
                    return Err("请先选择曲目".into());
                }
                self.ensure_audio()?;
                if self.state.status == "finished" {
                    self.reset(self.state.passage.as_ref().map_or(0., |p| p.start));
                }
                if let Some(p) = &self.state.passage {
                    if self.state.position < p.start || self.state.position >= p.end {
                        self.reset(p.start);
                    }
                }
                self.begin_play();
            }
            Command::Tasks | Command::SkipStartupSong | Command::RetryStartup | Command::DismissStartupWarning { .. } | Command::CancelTask { .. } | Command::CancelHistoryRead { .. } | Command::CurrentSong | Command::Session
            |Command::PreviewTickRange{..}|Command::ApplyTickRange{..}|Command::SaveTickPassage{..}
            | Command::PracticeTime { .. }
            | Command::EditExercisePreset { .. } | Command::DeleteExercisePreset { .. }
            | Command::FileLocations | Command::FileLocationsFor { .. } | Command::UpdateFileLocation { .. }
            | Command::ReadPaperView { .. } | Command::SavePaperView { .. }
 => unreachable!(),
            Command::Volume { value } => {
                if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                    return Err("音量参数无效".into());
                }
                self.state.volume = value;
                if let Some(host)=&self.sound_host{host.set_volume(value);}
                if let Some(audio) = &self.audio {
                    audio.set_volume(value);
                }
            }
            Command::Loop {
                start,
                end,
                enabled,
            } => {
                if self.file.is_none() {
                    return Err("请先选择曲目".into());
                }
                if enabled
                    && (!start.is_finite()
                        || !end.is_finite()
                        || start < 0.
                        || end > self.state.duration
                        || end - start < 0.1)
                {
                    return Err("分段终点应在起点之后，且不超过曲目时长".into());
                }
                let position=self.state.position;
                let playing=self.state.status=="playing";
                let paused=self.state.status=="paused";
                self.state.passage = enabled.then_some(Passage { start, end });
                self.state.repetitions = 0;
                self.reset(if enabled { start } else { position });
                if playing {self.ensure_audio()?;self.state.status="playing".into();}
                else if paused {self.state.status="paused".into();}
            }
            Command::Pause => {
                self.time_connected=false;
                self.panic();
                // A delayed pause can arrive just after completion. Keep the
                // saved result finished so its goals remain editable.
                if self.state.status != "finished" {
                    self.state.status = "paused".into();
                }
            }
            Command::Restart => {
                self.state.repetitions = 0;
                self.reset(self.state.passage.as_ref().map_or(0., |p| p.start));
            }
            Command::Seek { position } => {
                if !position.is_finite() || position < 0. || position > self.state.duration {
                    return Err("播放位置无效".into());
                }
                if let Some(p) = &self.state.passage {
                    if position < p.start || position >= p.end {
                        return Err("播放位置应在当前分段范围内；可先关闭分段循环".into());
                    }
                }
                let running=self.state.status=="playing";
                let paused=self.state.status=="paused";
                self.reset(position);
                if running {self.ensure_audio()?;self.state.status="playing".into();}
                else if paused {self.state.status="paused".into();}
            }
            Command::Speed { value } => {
                if !value.is_finite() || !(0.25..=2.).contains(&value) {
                    return Err("速度应在 25% 到 200% 之间".into());
                }
                self.state.speed = value;
            }
            Command::Wait { enabled } => {
                return self.command(Command::Mode { value: if enabled { "wait" } else { "listen" }.into() });
            }
            Command::Hands { value } => {
                self.set_hand_scope(&value)?;
                self.panic();
                self.playback.reselect(self.state.position, &self.notes, |n| n.start.as_secs_f64());
                self.restore_track_sound();
            }
            Command::Note {
                pitch,
                active,
                velocity,
            } => {
                if pitch > 127 || velocity > 127 {
                    return Err("MIDI 音符参数无效".into());
                }
                self.ensure_audio()?;
                self.midi(&[if active { 144 } else { 128 }, pitch, velocity]);
            }
            Command::Input { name } => {
                self.connect_input(name.clone())?;
                self.preferences.input = name;
                self.preferences.input_configured = true;
            }
            Command::Output { name } => {
                self.panic();
                let chosen = name.clone();
                if let Some(name) = name.as_ref().filter(|n| n.starts_with("vst3:")) {
                    let path = PathBuf::from(name.trim_start_matches("vst3:"));
                    let backend = panthesia_vst3::Vst3Backend::new()
                        .map_err(|e| e.to_string())?;
                    if !backend.has_output(&path).map_err(|error| format!("VST3 插件位置无法读取：{error}"))? {
                        return Err("音源不在已发现的 VST3 插件中，请刷新插件清单后重新选择".into());
                    }
                    let connection = backend
                        .new_output_connection(&path)
                        .map_err(|e| e.to_string())?;
                    self.vst = Some(connection);
                    self.output_connection = None;
                    self.audio = None;
                    self.state.output = format!(
                        "VST3 · {}",
                        path.file_stem().unwrap_or_default().to_string_lossy()
                    );
                } else if let Some(name) = name {
                    let output =
                        midir::MidiOutput::new("Panthesia playback").map_err(|e| e.to_string())?;
                    let port = output
                        .ports()
                        .into_iter()
                        .find(|p| output.port_name(p).ok().as_deref() == Some(&name))
                        .ok_or("找不到所选 MIDI 输出")?;
                    let connection = output
                        .connect(&port, "Panthesia playback")
                        .map_err(|e| e.to_string())?;
                    self.vst = None;
                    self.output_connection = Some(connection);
                    self.audio = None;
                    self.state.output = name;
                } else {
                    self.vst = None;
                    self.output_connection = None;
                    self.state.output = "内置钢琴".into();
                    self.ensure_audio()?;
                }
                self.preferences.output = chosen;
                self.restore_latency();
                self.reset(self.state.position);
            }
            Command::PrepareMeasurePart { content_id, measure, part, track_id } => {
                self.prepare_measure_part(&content_id, measure, part, track_id)?;
            }
            Command::Bookmarks | Command::SaveBookmark{..}|Command::RemoveBookmark{..} => unreachable!(),
        }
        if persist {
            self.persist()?;
        }
        Ok(serde_json::json!({ "ok": true }))
    }
}

/// Mainline plays in two modes only: continuous (`listen`) and wait-for-key (`wait`).
/// `flow` is accepted as an alias for `listen` because older settings files store it.
pub(crate) fn normalize_mode(command: Command) -> Result<Command, String> {
    match command {
        Command::Mode { value } if value == "flow" => Ok(Command::Mode { value: "listen".into() }),
        Command::Mode { value } if !["wait", "listen"].contains(&value.as_str()) => {
            Err(format!("不支持的练习模式：{value}"))
        }
        command => Ok(command),
    }
}
