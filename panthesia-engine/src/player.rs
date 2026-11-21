//! The playback runtime state: one `Player` owns the song, playback, input and sound.
use crate::*;

#[derive(Clone)]
pub(crate) struct PracticeNote {
    pub(crate) inner: MidiNote,
    pub(crate) index: usize,
}
impl std::ops::Deref for PracticeNote {
    type Target = MidiNote;
    fn deref(&self) -> &MidiNote {
        &self.inner
    }
}
#[derive(Clone)]
pub(crate) struct LocatedScoreMap {
    pub(crate) content_id:String,
    pub(crate) score_revision:u64,
    pub(crate) source_fingerprint:String,
    pub(crate) token:String,
    pub(crate) grid:String,
    pub(crate) notes:HashMap<(usize,usize),(String,usize)>,
}
pub(crate) struct Player {
    pub(crate) playback: playback_session::PlaybackSession,
    pub(crate) startup: Option<startup::Control>,
    pub(crate) recording_saved: bool,
    pub(crate) recording_path: Option<PathBuf>,
    pub(crate) closing: Arc<AtomicBool>,
    pub(crate) save_error: Option<String>,
    pub(crate) settings_save_error: Option<String>,
    pub(crate) storage_busy: Arc<AtomicBool>,
    pub(crate) storage_id: Option<String>,
    pub(crate) state: Snapshot,
    pub(crate) state_clock: Option<state_order::Clock>,
    pub(crate) detached_engine_id: Option<String>,
    pub(crate) file: Option<SongFile>,
    pub(crate) source_file: Option<SongFile>,
    pub(crate) notes: PracticeNotes,
    pub(crate) note_hands: HandAssignments,
    pub(crate) hand_undo: practice_edit::HandUndo,
    pub(crate) event_notes: EventNotes,
    pub(crate) original_grid: Option<OriginalGrid>,
    pub(crate) meter_map:Option<panthesia_core::library::MeterMap>,
    pub(crate) meter_correction: Option<panthesia_core::library::MeterCorrection>,
    pub(crate) events: PlaybackEvents,
    pub(crate) matcher: PracticeMatcher,
    pub(crate) pending_time:PracticeTimeSlices,
    pub(crate) pending_untracked:u64,
    pub(crate) time_fraction:Duration,
    pub(crate) time_connected:bool,
    pub(crate) time_last_end:Option<u64>,
    pub(crate) history: PracticeHistoryStore,
    pub(crate) title: String,
    pub(crate) input_connection: Option<midir::MidiInputConnection<()>>,
    pub(crate) input_status_error: Option<String>,
    pub(crate) input_tx: mpsc::SyncSender<input_runtime::Event>,
    pub(crate) input_rx: mpsc::Receiver<input_runtime::Event>,
    pub(crate) input_client:Option<input_runtime::Client>,
    pub(crate) input_generation:u64,
    pub(crate) input_revision:u64,
    pub(crate) input_disconnects:u64,
    pub(crate) input_overflow: Arc<AtomicBool>,
    pub(crate) output_connection: Option<midir::MidiOutputConnection>,
    pub(crate) audio: Option<audio::Audio>,
    pub(crate) soundfont: PathBuf,
    pub(crate) soundfont_revision: u64,
    pub(crate) prepared_font: Option<oxisynth::SoundFont>,
    pub(crate) sound_host: Option<sound_runtime::Host>,
    pub(crate) sound_change: Option<String>,
    pub(crate) sound_status_error: Option<String>,
    pub(crate) soundfont_presets: SoundPresets,
    pub(crate) silent: bool,
    pub(crate) preferences: Preferences,
    pub(crate) preferences_path: PathBuf,
    pub(crate) restoring: bool,
    pub(crate) sound_timeline: Arc<track_sound::Timeline>,
    pub(crate) track_routing: Arc<track_sound::Routing>,
    pub(crate) track_sound_cache: Arc<std::collections::BTreeMap<usize, track_sound::TrackSound>>,
    pub(crate) config: SongConfig,
    pub(crate) fingers: FingerAssignments,
    pub(crate) exercise: Option<ExerciseSpec>,
    pub(crate) previous_summary: Option<preferences::Shared<AttemptSummary>>,
    pub(crate) reclaimer: Option<playback_memory::Reclaimer>,
    pub(crate) coach: AdaptiveTempoCoach,
    pub(crate) finger_demo: Option<finger_demo::Demo>,
    pub(crate) song_audition: Option<song_audition::Playback>,
    pub(crate) song_audition_pending: Option<String>,
    pub(crate) cancelled_song_auditions: std::collections::VecDeque<String>,
    pub(crate) cancelled_replay_starts: std::collections::VecDeque<String>,
    pub(crate) audio_stop_epoch: u64,
    pub(crate) recorder: panthesia_core::recorder::FreeplayRecorder,
    pub(crate) data: PathBuf,
    pub(crate) notation: Option<Arc<notation::ScoreAsset>>,
    pub(crate) score_revision: u64,
    pub(crate) located_score_map: Option<Arc<LocatedScoreMap>>,
    pub(crate) score_mapping_epoch: u64,
    pub(crate) vst: Option<panthesia_vst3::Vst3OutputConnection>,
    pub(crate) end_hold: f64,
    pub(crate) previous_mode: Option<String>,
    pub(crate) finger_undo: practice_edit::FingerUndo,
    /// Last manifest projection of per-song preferences: (content id, values).
    pub(crate) manifest_settings: Option<(String, manifest_settings::Projection)>,
}
impl Player {
    #[cfg(test)]
    pub(crate) fn new(data: PathBuf, soundfont: PathBuf, silent: bool) -> Self {
        let loaded=startup::Data::read(&data,&soundfont);
        Self::with_data(data,soundfont,silent,loaded)
    }
    pub(crate) fn empty(data:PathBuf,soundfont:PathBuf,silent:bool) -> Self {
        let loaded=startup::Data::empty(&data);
        Self::with_data(data,soundfont,silent,loaded)
    }
    pub(crate) fn with_data(data:PathBuf,soundfont:PathBuf,silent:bool,loaded:startup::Data) -> Self {
        let (input_tx,input_rx)=mpsc::sync_channel(4096);
        let preferences_path=data.join("web-preferences.json");
        let startup::Data { preferences,history,soundfont_presets,error:settings_error,blocked:import_recovery_pending,.. }=loaded;
        Self {
            startup: None,
            playback: Default::default(),
            recording_saved: false,
            recording_path: None,
            closing: Arc::new(AtomicBool::new(false)),
            save_error: None,
            settings_save_error: None,
            storage_busy: Arc::new(AtomicBool::new(import_recovery_pending)),
            storage_id: None,
            state: Snapshot {
                error: settings_error,
                soundfont: soundfont.clone(),
                soundfont_status: if soundfont_presets.is_empty() { "unavailable" } else { "ready" }.into(),
                ..Snapshot::default()
            },
            state_clock: None,
            detached_engine_id: None,
            file: None,
            source_file: None,
            notes: PracticeNotes::default(),
            note_hands: HandAssignments::default(),
            hand_undo: Default::default(),
            event_notes: EventNotes::default(),
            original_grid: None,
            meter_map:None,
            meter_correction: None,
            events: PlaybackEvents::default(),
            matcher: PracticeMatcher::new(KeyboardRange::new(0..=127)),
            pending_time:Default::default(),pending_untracked:0,time_fraction:Duration::ZERO,time_connected:false,time_last_end:None,
            history,
            title: String::new(),
            input_connection: None,
            input_status_error: None,
            input_tx,
            input_rx,
            input_client:None,input_generation:0,input_revision:0,input_disconnects:0,
            input_overflow: Arc::new(AtomicBool::new(false)),
            output_connection: None,
            audio: None,
            soundfont_revision: 0,
            prepared_font: None,
            sound_host:None,
            sound_change:None,
            sound_status_error:None,
            soundfont_presets: soundfont_presets.into(),
            soundfont,
            silent,
            preferences,
            preferences_path,
            restoring: false,
            sound_timeline: Default::default(),
            track_routing: Default::default(),
            track_sound_cache: Default::default(),
            recorder: panthesia_core::recorder::FreeplayRecorder::default(),
            audio_stop_epoch: 0,
            data: data.clone(),
            notation: None,
            score_revision: 0,
            located_score_map: None,
            score_mapping_epoch: 0,
            vst: None,
            end_hold: 0.,
            previous_mode: None,
            finger_undo: Default::default(),
            manifest_settings: None,
            config: SongConfig::default(),
            fingers: FingerAssignments::default(),
            exercise: None,
            previous_summary: None,
            reclaimer: None,
            coach: AdaptiveTempoCoach::default(),
            finger_demo: None,
            song_audition: None,
            song_audition_pending: None,
            cancelled_song_auditions: Default::default(),
            cancelled_replay_starts: Default::default(),
        }
    }
    pub(crate) fn annotation_path(&self, file: &MidiFile) -> Result<PathBuf, String> {
        if let Some(path) = &file.source_path {
            return Ok(path.clone());
        }
        let spec=self.exercise.ok_or("曲目缺少可保存的内容")?;
        let path=self.data.join("exercises").join(format!("{}.mid",file.content_id));
        if !panthesia_core::utils::atomic_file::is_file(&path){
            let bytes=exercise_assets::canonical_bytes(spec)?;
            if let Some(parent)=path.parent(){std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
            panthesia_core::utils::atomic_file::write(&path,&bytes).map_err(|e|e.to_string())?;
        }
        Ok(path)

    }
    pub(crate) fn begin_play(&mut self) {
        self.stop_song_audition(None);
        if self.state.count_in > 0 && self.playback.clock == Duration::ZERO {
            let snap = self.snapshot();
            let f = self.file.as_ref().unwrap();
            let m = f.musical_time.measure_at(snap.tick).unwrap();
            self.state.count_remaining = f64::from(self.state.count_in) * f64::from(m.numerator)
                / if m.denominator == 8 && m.numerator >= 6 && m.numerator % 3 == 0 {
                    3.
                } else {
                    1.
                };
            self.state.status = "countIn".into();
            self.sound_click(true);
        } else {
            self.state.status = "playing".into();
        }
    }
    pub(crate) fn install(
        &mut self,
        file: MidiFile,
        title: String,
        plan: Option<ExercisePlan>,
    ) -> Result<(), String> {
        self.install_prepared(file, title, plan, None)
    }
    pub(crate) fn install_prepared(
        &mut self,
        mut file: MidiFile,
        title: String,
        plan: Option<ExercisePlan>,
        prepared: Option<load_pipeline::InstallData>,
    ) -> Result<(), String> {
        let previous_hands=plan.as_ref().and_then(|_| {
            self.preferences.exercise_layouts.get(&file.content_id).copied()
                .or_else(||self.preferences.exercise.filter(|spec|ExercisePlan::identity(*spec)==file.content_id).map(|spec|spec.hands))
        });
        let (assets, timeline) = match prepared {
            Some(prepared) => (prepared.assets, prepared.timeline),
            None => (None, load_pipeline::Timeline::new(&file)?),
        };
        self.manifest_settings = None;
        if plan.is_none() {
            if let Some(path) = file.source_path.clone() {
                if panthesia_core::song_annotations::document_path(&path).is_none() {
                    self.apply_manifest_settings(&path, &file.content_id);
                }
            }
        }
        self.panic();
        self.original_grid = Some(file.musical_time.clone().into());
        self.meter_correction = None;
        self.meter_map = None;
        self.config = SongConfig::new(&file.tracks);
        self.state.mode = "listen".into();
        self.state.wait = false;
        self.state.hands = "both".into();
        self.state.speed = 1.;
        self.state.count_in = 1;
        self.state.metronome = false;
        self.state.rounds = 0;

        self.state.annotation_revision = 0;
        self.fingers.clear();
        self.finger_undo.clear();
        self.note_hands.clear();
        self.hand_undo.clear();
        self.event_notes.clear();
        self.exercise = plan.as_ref().map(|p| p.spec);
        if let Some(plan) = plan {
            let fingers = plan.fingerings();
            for t in file.tracks.iter() {
                if let Some(config)=self.config.tracks.iter_mut().find(|config|config.track_id==t.track_id){
                    if t.track_id==1{config.practice_part=PracticePart::RightHand;}else if t.track_id==2{config.practice_part=PracticePart::LeftHand;}
                }

                if let Some(n) = t.notes.first() {
                    if let Some(c) = self
                        .config
                        .tracks
                        .iter_mut()
                        .find(|c| c.track_id == t.track_id)
                    {
                        c.practice_part = if n.channel == 0 {
                            PracticePart::RightHand
                        } else {
                            PracticePart::LeftHand
                        };
                    }
                    if let Some(f) = &fingers {
                        let fs = if n.channel == 0 { &f.right } else { &f.left };
                        for (n, f) in t.notes.iter().zip(fs) {
                            self.fingers.insert((t.track_id, n.start, n.note), *f);
                        }
                    }
                }
            }
        }
        self.notation = None;
        self.score_revision = self.score_revision.wrapping_add(1);
        let assets = match assets {
            Some(assets) => assets,
            None => load_pipeline::Assets::read(&file, &self.annotation_path(&file)?, self.preferences.score_versions.get(&file.content_id).map(Vec::as_slice).unwrap_or_default()),
        };
        self.state.error = assets.error;
        self.notation = assets.notation.map(Arc::new);
        let mut restored_title = None;
        if let Some(sidecar) = assets.sidecar {
            if let Some(grid) = assets.grid {
                file.measures = grid.bar_times(&file.tempo_track).into();
                file.beats = grid.beat_times(&file.tempo_track).into();
                file.musical_time = grid;
                self.meter_correction = sidecar.meter;
                self.meter_map = sidecar.meter_map;
            }
            if let Err(error) = self.config.set_note_playback_rules(&sidecar.note_playback, &file) {
                self.state.error = Some(error);
            }
            restored_title = sidecar.metadata.title;
            for (track, part) in sidecar.track_parts {
                if let Some(t) = self.config.tracks.iter_mut().find(|t| t.track_id == track) { t.practice_part = part; }
            }
            for hint in sidecar.hands {
                if file.tracks.iter().find(|t| t.track_id == hint.track_id).and_then(|t| t.notes.get(hint.note_index)).is_some() {
                    self.note_hands.insert((hint.track_id, hint.note_index), hint.part);
                }
            }
            for hint in sidecar.fingerings {
                if let Some(note) = file.tracks.iter().find(|t| t.track_id == hint.track_id).and_then(|t| t.notes.get(hint.note_index)) {
                    self.fingers.insert((hint.track_id, note.start, note.note), hint.finger);
                }
            }
        }
        self.title = restored_title.unwrap_or(title);
        self.state.duration = timeline.duration;
        self.event_notes = timeline.event_notes;
        self.notes = timeline.notes;
        self.events = timeline.events;
        self.sound_timeline = timeline.sound;
        if let Some(setup) = self.history.setup(&file.content_id).cloned() {
            self.config.apply_practice_setup(&setup);
            if (0.25..=2.).contains(&setup.speed) {
                self.state.speed = f64::from(setup.speed)
            }
        }
        self.state.passage = None;
        self.state.repetitions = 0;
        self.previous_summary = None;
        self.previous_mode = None;
        if let Some(l) = self
            .history
            .setup(&file.content_id)
            .and_then(|s| s.loop_setup)
            .filter(|l| l.enabled)
        {
            if let (Some(a), Some(b)) = (
                file.musical_time
                    .measures
                    .get(l.start_measure.saturating_sub(1)),
                file.musical_time
                    .measures
                    .get(l.end_measure.saturating_sub(1)),
            ) {
                self.state.passage = Some(Passage {
                    start: file
                        .tempo_track
                        .pulses_to_duration(a.start_tick)
                        .as_secs_f64(),
                    end: file
                        .tempo_track
                        .pulses_to_duration(b.end_tick)
                        .as_secs_f64()
                        .min(self.state.duration),
                });
            }
        }

        if let Some(settings) = self.preferences.songs.get(&file.content_id) {
            self.config.apply_practice_setup(&SongPracticeSetup {
                tracks: settings.tracks.clone(),
                ..SongPracticeSetup::default()
            });
            self.state.mode = settings
                .mode
                .clone()
                .filter(|mode| {
                    ["wait", "flow", "listen"].contains(&mode.as_str())
                })
                .unwrap_or_else(|| "listen".into());
            self.state.wait = self.state.mode == "wait";
            self.state.count_in = settings.count_in;
            self.state.metronome = settings.metronome;
            self.state.latency = settings.latency;
            self.state.rounds = settings.rounds;
            if ["both", "left", "right", "custom"].contains(&settings.hands.as_str()) {
                self.state.hands = settings.hands.clone();
            }
            for t in &mut self.config.tracks {
                if let Some(part) = settings.parts.get(&t.track_id).filter(|_|!(self.exercise.is_some() || file.source_path.as_ref().is_some_and(|p|panthesia_core::song_annotations::document_path(p).is_some()))) {
                    t.practice_part = *part
                }
            }
        }
        if let Some(spec)=self.exercise{
            let mut scope_changed=false;
            for track in file.tracks.iter().filter(|track|!track.notes.is_empty()){
                let channel=track.notes[0].channel;
                let was_selected=previous_hands.is_some_and(|hands|hands==panthesia_core::exercise::ExerciseHands::Both||(hands==panthesia_core::exercise::ExerciseHands::Right&&channel==0)||(hands==panthesia_core::exercise::ExerciseHands::Left&&channel==1));
                if !was_selected{if let Some(config)=self.config.tracks.iter_mut().find(|config|config.track_id==track.track_id){config.player=PlayerConfig::Human;config.visible=true;config.practice_part=if channel==0{PracticePart::RightHand}else{PracticePart::LeftHand};scope_changed=true;}}
            }
            if scope_changed&&previous_hands!=Some(spec.hands){self.state.hands="both".into();}
        }
        self.source_file = Some(file.clone().into());
        self.file = Some(file.into());
        let variant=self.variant();
        if variant.active() {let passage=self.state.passage.clone();self.apply_variant_memory(&variant)?;self.state.passage=passage.filter(|p|p.end<=self.state.duration);}
        self.reset(self.state.passage.as_ref().map_or(0., |p| p.start));
        self.persist()?;
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn restore(&mut self) {
        if self.storage_busy.load(Ordering::Acquire) {
            let detail = self.state.error.as_deref().unwrap_or("恢复记录尚未处理完成");
            self.state.error = Some(format!("练习资料恢复未完成，现有文件已保留并暂停修改。请重新启动后重试。{detail}"));
            self.state.status = "paused".into();
            return;
        }
        self.restoring = true;
        let prefs = self.preferences.clone();
        let mut errors: Vec<String> = self.state.error.clone().into_iter().collect();
        if let Some(spec) = prefs.exercise {
            if let Err(e) = self.command(Command::Generate { spec }) {
                errors.push(e)
            }
        } else if let Some(path) = prefs.path.clone() {
            if let Err(e) = self.load_file(path, prefs.title.clone()) {
                errors.push(format!("上次曲目无法恢复：{e}"));
            }
        }
        self.restore_controls(prefs,errors);
    }
    pub(crate) fn restore_controls(&mut self,prefs:Preferences,mut errors:Vec<String>) {
        if let Some(speed) = prefs
            .speed
            .filter(|v| v.is_finite() && (0.25..=2.).contains(v))
        {
            self.state.speed = speed;
        }
        if self.preferences.songs.is_empty() {
            self.state.wait = prefs.wait.unwrap_or(false);
            self.state.mode = if self.state.wait { "wait" } else { "listen" }.into();
        }
        self.state.volume = prefs
            .volume
            .filter(|v| v.is_finite() && (0.0..=1.0).contains(v))
            .unwrap_or(0.8);
        if let Some(hands) = prefs
            .hands
            .clone()
            .filter(|h| ["both", "left", "right"].contains(&h.as_str()))
        {
            self.state.hands = hands;
        }
        if let Some(passage) = prefs.passage.clone() {
            if self.file.is_some()
                && passage.start.is_finite()
                && passage.end.is_finite()
                && passage.start >= 0.
                && passage.end <= self.state.duration
                && passage.end > passage.start
            {
                self.state.passage = Some(passage.clone());
                self.reset(passage.start);
            }
        }
        if self.input_client.is_none() { if let Some(input) = prefs.input.clone() {
            if let Err(e) = self.connect_input(Some(input.clone())) {
                self.state.input = Some(input);
                self.input_status_error = Some(e.clone());
                errors.push(e);
            }
        }
        }
        if self.sound_host.is_none() { if let Some(output) = prefs.output.clone() {
            if let Err(e) = self.command(Command::Output { name: Some(output) }) {
                errors.push(format!("上次音源无法连接，暂用内置钢琴：{e}"));
            }
        }}
        self.preferences = prefs;
        if let Some(host)=&self.sound_host{host.set_volume(self.state.volume);}
        if self.input_client.is_none() && !self.silent && !self.preferences.input_configured && self.state.input.is_none() {
            if let Some(name) = device_catalog::inputs().0.unwrap_or_default().into_iter().next() {
                match self.connect_input(Some(name.clone())) {
                    Ok(_) => {
                        self.preferences.input = Some(name);
                    }
                    Err(e) => errors.push(e),
                }
            }
        }
        self.restoring = false;
        self.restore_latency();
        if !errors.is_empty() {
            self.state.error = Some(errors.join("；"));
        }
        // Never start transport automatically after opening the application.
    }
    pub(crate) fn persist(&mut self) -> Result<(), String> {
        if self.restoring {
            return Ok(());
        }
        self.preferences.speed = Some(self.state.speed);
        self.preferences.wait = Some(self.state.wait);
        self.preferences.hands = Some(self.state.hands.clone());
        self.preferences.passage = self.state.passage.clone();
        self.preferences.volume = Some(self.state.volume);
        if let Some(file) = &self.file {
            self.preferences.path = file.source_path.clone();
            self.preferences.last_content_id=Some(file.content_id.clone());
            self.preferences.title = self.title.clone();
        }
        if let Some(file) = &self.file {
            self.preferences.exercise = self.exercise;
            if let Some(spec)=self.exercise {
                if self.preferences.exercise_layouts.get(&file.content_id) != Some(&spec.hands) {
                    self.preferences.exercise_layouts.insert(file.content_id.clone(),spec.hands);
                }
            }
            let settings = preferences::SessionSettings {
                    tracks: self.config.practice_track_setup(),
                    parts: if self.exercise.is_some() || file.source_path.as_ref().is_some_and(|p|panthesia_core::song_annotations::document_path(p).is_some()){Default::default()}else{self
                        .config
                        .tracks
                        .iter()
                        .map(|t| (t.track_id, t.practice_part))
                        .collect()},
                    mode: Some(self.state.mode.clone()),
                    count_in: self.state.count_in,
                    metronome: self.state.metronome,
                    latency: self.state.latency,
                    rounds: self.state.rounds,
                    hands: self.state.hands.clone(),
                };
            // Global volume and device updates retain an unchanged per-song collection.
            if self.preferences.songs.get(&file.content_id) != Some(&settings) {
                self.preferences.songs.insert(file.content_id.clone(), settings);
            }
            self.history
                .save_setup(
                    &file.content_id,
                    &self.title,
                    SongPracticeSetup {
                        source_path: file.source_path.clone(),
                        speed: self.state.speed as f32,
                        tracks: self.config.practice_track_setup(),
                        exercise_spec: self.exercise,
                        loop_setup: self.state.passage.as_ref().map(|p| {
                            panthesia_core::practice_history::PracticeLoopSetup {
                                enabled: true,
                                start_measure: file
                                    .measures
                                    .partition_point(|m| m.as_secs_f64() <= p.start)
                                    .max(1),
                                end_measure: file
                                    .measures
                                    .partition_point(|m| m.as_secs_f64() < p.end)
                                    .max(1),
                            }
                        }),
                        ..SongPracticeSetup::default()
                    },
                )
                .map_err(|e| e.to_string())?;
        }
        self.preferences.save(&self.preferences_path)
    }
    pub(crate) fn remember_active_score(&mut self) -> Result<(), String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let midi = self.annotation_path(file)?;
        let Ok(sidecar) = panthesia_core::library::load_song_sidecar(&midi, &file.content_id)
        else {
            return Ok(());
        };
        if let Some(association) = sidecar.score {
            let path = panthesia_core::library::resolve_score_path(&midi, &association);
            let entries = self
                .preferences
                .score_versions
                .entry(file.content_id.clone())
                .or_default();
            if !entries
                .iter()
                .any(|v| v.path == path && v.content_id == association.content_id)
            {
                if entries.len() >= 100 {
                    return Err("这首曲目已有 100 份谱面，请先移除不需要的版本".into());
                }
                let id = library_scores::associated_id(&path,&association.content_id);
                entries.push(preferences::ScoreVersion {
                    id,
                    name: self
                        .notation
                        .as_ref()
                        .map(|s| s.name.clone())
                        .unwrap_or_else(|| {
                            path.file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .into()
                        }),
                    path,
                    content_id: association.content_id,
                });
                self.preferences.save(&self.preferences_path)?;
            }
        }
        Ok(())
    }
    pub(crate) fn score_content_guard(&self, id: &str) -> Result<(), String> {
        if self.file.as_ref().is_none_or(|f| f.content_id != id) {
            Err("曲目已切换，请重新打开谱面管理".into())
        } else {
            Ok(())
        }
    }
    pub(crate) fn corrected_grid(
        file: &MidiFile,
        meter: panthesia_core::library::MeterCorrection,
    ) -> Result<panthesia_music::musical_time::MusicalTime, String> {
        let end = file
            .tracks
            .iter()
            .flat_map(|t| t.notes.iter())
            .map(|n| {
                file.tempo_track
                    .seconds_to_pulses(n.end.as_secs_f64())
                    .round() as u64
            })
            .max()
            .unwrap_or(1);
        panthesia_music::musical_time::MusicalTime::corrected(
            file.musical_time.ppq,
            end,
            meter.numerator,
            meter.denominator,
            meter.pickup_ticks,
        )
    }
    pub(crate) fn grid_signature(&self)->String {let mut grid=self.file.as_deref().map(practice_conditions::grid).unwrap_or_else(||"grid-v1-cbf29ce484222325".into());let variant=self.variant();if variant.active(){grid.push_str(&variant.signature());}grid}
    pub(crate) fn note_player(&self, track: usize, index: usize) -> PlayerConfig {
        playback_adapter::note_player(&self.config, &self.note_hands, &self.state.hands, track, index)
    }
    pub(crate) fn set_hand_scope(&mut self, value: &str) -> Result<(), String> {
        let wanted = match value {
            "left" => Some(PracticePart::LeftHand),
            "right" => Some(PracticePart::RightHand),
            "both" => None,
            _ => return Err("练习声部无效".into()),
        };
        if wanted.is_some_and(|h| {
            !self
                .notes
                .iter()
                .any(|n| hands::part(&self.config, &self.note_hands, n.track_id, n.index) == h)
        }) {
            return Err("这首曲目还没有指定这一只手，请打开逐音分手".into());
        }
        let human_tracks: std::collections::HashSet<_> = self
            .notes
            .iter()
            .filter(|n| {
                wanted.is_none_or(|h| {
                    hands::part(&self.config, &self.note_hands, n.track_id, n.index) == h
                })
            })
            .map(|n| n.track_id)
            .collect();
        for t in &mut self.config.tracks {
            if self.notes.iter().any(|n| n.track_id == t.track_id) {
                t.player = if human_tracks.contains(&t.track_id) {
                    PlayerConfig::Human
                } else {
                    PlayerConfig::Auto
                };
            }
        }
        self.state.hands = value.into();
        Ok(())
    }
    pub(crate) fn prepare_measure_part(&mut self, content_id: &str, measure: usize, part: PracticePart, track_id: usize) -> Result<(), String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        if file.content_id != content_id { return Err("曲目已切换，请重新打开练习反馈".into()); }
        let bar = file.musical_time.measures.get(measure.checked_sub(1).ok_or("小节从 1 开始")?).ok_or("小节超出曲目")?;
        let start = file.tempo_track.pulses_to_duration(bar.start_tick).as_secs_f64();
        let end = file.tempo_track.pulses_to_duration(bar.end_tick).as_secs_f64().min(self.state.duration);
        if end - start < 0.1 { return Err("这个小节没有可练习的时长".into()); }
        let has_notes = self.notes.iter().any(|note| note.track_id == track_id
            && note.start.as_secs_f64() >= start && note.start.as_secs_f64() < end
            && hands::part(&self.config, &self.note_hands, note.track_id, note.index) == part);
        if !has_notes { return Err("该小节的指定手与音轨没有可练习音符".into()); }
        for track in &mut self.config.tracks {
            track.player = if track.track_id == track_id { PlayerConfig::Human } else { PlayerConfig::Auto };
        }
        self.state.hands = match part { PracticePart::LeftHand => "left", PracticePart::RightHand => "right", PracticePart::Other => "other" }.into();
        if self.state.mode == "listen" { self.state.mode = "flow".into(); self.state.wait = false; }
        self.state.passage = Some(Passage { start, end });
        self.state.repetitions = 0;
        self.previous_summary = None;
        self.previous_mode = None;
        self.coach = AdaptiveTempoCoach::default();
        self.reset(start);
        Ok(())
    }
    pub(crate) fn ensure_audio(&mut self) -> Result<(), String> {
        if self.sound_change.is_some(){return Err("音源正在切换，请等待完成后再开始演奏".into());}
        if let Some(host)=&self.sound_host {
            if host.status().changing {return Err("声音设备正在完成切换，请等待完成后再开始演奏".into());}
            return if host.ready(self.state.metronome||self.state.count_in>0){Ok(())}else{Err(host.status().error.unwrap_or_else(||"音源尚不可用，请在设备设置中选择演奏音源或 .sf2 文件".into()))};
        }
        if !self.silent
            && self.audio.is_none()
            && (self.output_connection.is_none() || self.state.metronome || self.state.count_in > 0)
        {
            self.audio = Some(match self.prepared_font.take() {
                Some(font)=>audio::Audio::open_font(font)?,
                None=>audio::Audio::open(&self.soundfont)?,
            });
            self.audio.as_ref().unwrap().set_volume(self.state.volume);
            self.restore_track_sound();
        }
        Ok(())
    }
    pub(crate) fn set_soundfont(&mut self,path:PathBuf) -> Result<serde_json::Value,String> {
        let revision=self.soundfont_context()?;
        let prepared=soundfont_loading::Prepared::read(path)?;
        // Legacy owned readers do not have a task registry.
        self.install_soundfont_owned(revision,prepared)
    }
    pub(crate) fn panic(&mut self) {
        let audition = self.song_audition.take();
        let restore_audition = audition.is_some();
        self.retire(audition);
        self.song_audition_pending = None;
        self.audio_stop_epoch = self.audio_stop_epoch.wrapping_add(1);
        self.finger_demo = None;
        if let Some(host)=&self.sound_host {host.stop();}
        if let Some(vst) = &self.vst {
            vst.stop_all();
        }
        if let Some(audio) = &self.audio {
            audio.stop();
        }
        if let Some(out) = &mut self.output_connection {
            for channel in 0..16 {
                for (cc, value) in [(64, 0), (123, 0), (120, 0)] {
                    let _ = out.send(&[176 | channel, cc, value]);
                }
            }
        }
        self.state.pressed.clear();
        self.state.pressed_keys.clear();
        self.state.pedal = 0;
        if restore_audition { self.restore_track_sound(); }
    }
    pub(crate) fn send(&mut self, bytes: &[u8]) {
        if self.sound_change.is_some(){return;}
        if let Some(host)=&self.sound_host {host.send(bytes);return;}
        if let Some(vst) = &self.vst {
            if let Ok(panthesia_music::midly::live::LiveEvent::Midi { channel, message }) =
                panthesia_music::midly::live::LiveEvent::parse(bytes)
            {
                vst.midi_event(channel, message);
            }
        } else if let Some(out) = &mut self.output_connection {
            if let Err(e) = out.send(bytes) {
                self.state.error = Some(format!("MIDI 输出失败：{e}"));
                self.state.status = "paused".into();
            }
        } else if let Some(audio) = &self.audio {
            audio.send(bytes);
        }
    }
    pub(crate) fn save(&mut self) -> Result<(), String> {
        self.state.saved = true;
        self.persist()
    }
    pub(crate) fn reset(&mut self,position:f64) {self.reset_with_sound(position,None);}
    pub(crate) fn reset_with_sound(&mut self,position:f64,prepared:Option<track_sound::Prepared>) {
        self.playback.guidance.clear();
        self.panic();
        let report = self.matcher.report();
        self.matcher.reset();
        self.retire(report);
        self.playback.clock = Duration::ZERO;
        self.pending_time.clear();self.pending_untracked=0;self.time_fraction=Duration::ZERO;self.time_connected=false;self.time_last_end=None;
        self.state.position = position;
        self.state.saved = true;
        self.state.current_history_id = None;
        self.playback.seek(position, &self.notes, &self.events,
            |n| n.start.as_secs_f64(), |e| e.timestamp.as_secs_f64());
        if let Some(prepared)=prepared {self.restore_prepared_track_sound(prepared);} else {self.restore_track_sound();}
        self.state.status = "ready".into();
        self.state.count_remaining = 0.;
        self.playback.last_beat = None;
        self.end_hold = 0.;
    }
    pub(crate) fn connect_input(&mut self, name: Option<String>) -> Result<(), String> {
        if let Some(name) = &name {
            let mut input =
                midir::MidiInput::new("Panthesia keyboard").map_err(|e| e.to_string())?;
            input.ignore(midir::Ignore::None);
            let port = input
                .ports()
                .into_iter()
                .find(|p| input.port_name(p).ok().as_deref() == Some(name))
                .ok_or("找不到所选 MIDI 键盘")?;
            let tx = self.input_tx.clone();
            let overflow = self.input_overflow.clone();
            let connection = input
                .connect(
                    &port,
                    "Panthesia keyboard",
                    move |_, bytes, _| {
                        if tx.try_send(input_runtime::Event::legacy(bytes)).is_err() {
                            overflow.store(true, Ordering::Release);
                        }
                    },
                    (),
                )
                .map_err(|e| e.to_string())?;
            self.panic();
            self.input_connection = Some(connection);
            self.state.input = Some(name.clone());
        } else {
            self.panic();
            self.input_connection = None;
            self.state.input = None;
        }
        self.clear_input_error();
        self.restore_latency();
        Ok(())
    }
    pub(crate) fn output_identity(&self) -> Option<&str> {
        if self.state.output == "内置钢琴" { None }
        else { self.preferences.output.as_deref().or(Some(self.state.output.as_str())) }
    }
    pub(crate) fn calibration_key(&self) -> String {
        // Full plug-in paths distinguish installed instruments with the same display name.
        format!("devices-v2:{}", serde_json::json!([self.state.input, self.output_identity()]))
    }
    pub(crate) fn restore_latency(&mut self) {
        let legacy = format!("{}|{}", self.state.input.as_deref().unwrap_or("computer"), self.state.output);
        self.state.latency = self.preferences.calibrations.get(&self.calibration_key())
            .or_else(|| self.preferences.calibrations.get(&legacy)).copied().unwrap_or(0);
    }
    pub(crate) fn report_input_error(&mut self, message: String) {
        if self.state.error.is_none() || self.state.error == self.input_status_error {
            self.state.error = Some(message.clone());
        }
        self.input_status_error = Some(message);
    }
    pub(crate) fn clear_input_error(&mut self) {
        if self.state.error == self.input_status_error { self.state.error = None; }
        self.input_status_error = None;
    }
    pub(crate) fn check_input(&mut self, catalog: &device_catalog::Catalog) {
        if self.input_client.is_some(){self.poll_input_owner();return;}
        if let Some(name) = self.state.input.clone() {
            let Some(present) = catalog.input_present(&name) else { return; };
            if !present && self.input_connection.is_some() {
                self.panic();
                self.input_connection = None;
                self.state.status = "paused".into();
                self.report_input_error("MIDI 键盘已断开，播放已暂停；重新连接后可继续".into());
            }
            if present && self.input_connection.is_none() {
                match self.connect_input(Some(name)) {
                    Ok(_) => self.clear_input_error(),
                    Err(e) => self.report_input_error(e),
                }
            }
        }
    }
    pub(crate) fn midi(&mut self, bytes: &[u8]) {
        if bytes.first().is_some_and(|b| (128..240).contains(b)) {
            self.stop_song_audition(None);
        }
        if self.closing.load(Ordering::Acquire) && !self.recorder.is_recording() { return; }
        // Storage freezes assessment, not the keyboard monitor. In particular,
        // key releases must still reach the instrument while a writer is active.
        if self.storage_busy.load(Ordering::Acquire) && !self.recorder.is_recording() {
            self.state.midi_events+=1;
            if bytes.len()>=3 && matches!(bytes[0]&240,128|144) {
                self.state.pressed.retain(|p|*p!=bytes[1]);
                self.state.pressed_keys.remove(&bytes[1]);
                if bytes[0]&240==144 && bytes[2]>0 {self.state.pressed.push(bytes[1]);self.state.pressed_keys.insert(bytes[1],session_state::LiveKey{velocity:bytes[2],serial:self.state.midi_events});}
            }
            if bytes.len()>=3 && bytes[0]&240==176 && bytes[1]==64 {self.state.pedal=bytes[2];}
            let mut routed=bytes.to_vec();
            if !self.track_routing.lanes.is_empty() && !routed.is_empty() && routed[0]<240 {routed[0]&=240;}
            self.send(&routed);
            return;
        }
        if self.finger_demo.is_some() && bytes.len() >= 3 && matches!(bytes[0]&240,128|144|176) {
            // Ignore clock/active-sensing traffic; real keys or controls take over the sound.
            self.panic();
        }
        self.state.midi_events += 1;
        if bytes.len() < 3 {
            let mut routed=bytes.to_vec();
            if !self.track_routing.lanes.is_empty() && !routed.is_empty() && routed[0]<240 {routed[0]&=240;}
            self.send(&routed);
            return;
        }
        let kind = bytes[0] & 240;
        if let Ok(panthesia_music::midly::live::LiveEvent::Midi { channel, message }) =
            panthesia_music::midly::live::LiveEvent::parse(bytes)
        {
            self.recorder.push_event(channel.as_int(), message);
        }
        let note = bytes[1];
        let velocity = bytes[2];
        if (kind == 144 || kind == 128) && note <= 127 && velocity <= 127 {
            let active = kind == 144 && velocity != 0;
            self.state.pressed.retain(|p| *p != note);
            self.state.pressed_keys.remove(&note);
            if active {
                self.state.pressed.push(note);
                self.state.pressed_keys.insert(note,session_state::LiveKey{velocity,serial:self.state.midi_events});
            }
            if active && self.state.status == "playing" && self.state.wait {
                self.playback.guidance.press(note, self.playback.clock);
            }
        }
        if kind == 176 && note == 64 { self.state.pedal = velocity; }
        let mut routed=bytes.to_vec();
        if !self.track_routing.lanes.is_empty() && routed[0]<240 {routed[0]&=240;}
        self.send(&routed);
    }
    pub(crate) fn tick(&mut self, delta: Duration) {
        if self.closing.load(Ordering::Acquire) { return; }
        self.tick_song_audition(delta);
        if self.storage_busy.load(Ordering::Acquire) { return; }
        self.tick_finger_demo(delta);
        if let Some(vst) = &self.vst {
            vst.service_editor();
        }
        if self.input_overflow.swap(false, Ordering::AcqRel) {
            self.panic();
            self.state.status = "paused".into();
            self.state.error = Some("MIDI 输入过载，已停止发声并暂停播放".into());
            while self.input_rx.try_recv().is_ok() {}
        }
        if self.state.status!="playing"||self.state.mode=="listen"||self.state.recording{self.time_connected=false;}
        if self.state.status == "countIn" {
            let bpm=self.file.as_ref().map_or(120.*self.state.speed,|file|
                playback_adapter::musical_position(file,self.state.position,self.state.duration,self.state.speed).beat_rate);
            let old = self.state.count_remaining.ceil() as usize;
            self.state.count_remaining =
                (self.state.count_remaining - delta.as_secs_f64() * bpm / 60.).max(0.);
            if self.state.count_remaining.ceil() as usize != old {
                self.sound_click(false);
            }
            if self.state.count_remaining == 0. {
                self.state.status = "playing".into();
                self.playback.last_beat = None;
            }
            return;
        }
        if self.state.status != "playing" {
            return;
        }
        self.tick_transport(delta);
    }
    pub(crate) fn continue_finished_round(&mut self) { self.advance_finished_round(true); }
    pub(crate) fn advance_finished_round(&mut self, resume: bool) {
        if self.state.error.is_some() { return; }
        if let Some(passage) = self.state.passage.clone() {
            self.state.repetitions = self.state.repetitions.saturating_add(1);
            if resume && (self.state.rounds == 0 || self.state.repetitions < self.state.rounds) {
                self.reset(passage.start);
                self.begin_play();
            }
        }
    }
    pub(crate) fn snapshot(&self) -> Snapshot {

        let mut state = self.state.clone();
        state.mode = public_mode(&state.mode).into();
        state.wait = state.mode == "wait";
        if let Some(clock) = &self.state_clock {
            state.state_order = Some(clock.next());
        }
        state.sound=self.sound_host.as_ref().map_or_else(sound_runtime::Status::default,sound_runtime::Host::status);
        state.audio_level=self.sound_host.as_ref().and_then(sound_runtime::Host::level);
        state.audio_performance=self.sound_host.as_ref().and_then(sound_runtime::Host::performance);
        state.sound.changing|=self.sound_change.is_some();
        state.startup=self.startup.as_ref().map_or_else(startup::Status::default,startup::Control::status);
        state.recording_unsaved=self.recorder.has_take()&&!self.recording_saved;
        state.recording_path=self.recording_path.clone();
        state.storage=storage_control::status(self);
        state.storage.pending |= self.storage_id.is_some();
        state.storage.pending |= self.closing.load(Ordering::Acquire);
        state.storage.operation=storage_status::StorageOperation::current(self.storage_id.as_deref(), self.closing.load(Ordering::Acquire));
        state.content_id = self.file.as_ref().map(|file| file.content_id.clone());
        state.score_revision=self.score_revision;
        state.practice_ms=self.playback.clock.as_millis().min(u128::from(u64::MAX)) as u64;
        state.output_id = self.output_identity().map(str::to_owned);
        state.input_connected = self.input_connected();
        state.note_epoch = self.audio_stop_epoch;
        state.required = self.playback.guidance.pitches();
        state.score = Default::default();
        state.summary = None;
        state.summary_version.clear();
        state.recording = self.recorder.is_recording();
        state.record_duration = self.recorder.duration().as_secs_f64();
        if let Some(f) = &self.file {
            let at=playback_adapter::musical_position(f,state.position,state.duration,state.speed);
            state.tick=at.tick;state.bpm=at.bpm;state.measure=at.measure;state.beat=at.beat;
        }
        state
    }
}
