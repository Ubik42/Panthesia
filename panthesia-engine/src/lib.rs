pub mod state_order;
pub mod music_import;
mod music_import_receipts;
pub mod package_preview;
pub mod notation_drafts;
pub mod pdf_drafts;
pub mod backup_operations;
pub mod media_export;
pub mod media_export_cache;
mod background_tasks;
mod device_catalog;
pub use device_catalog::Snapshot as DeviceSnapshot;
mod import_pipeline;
mod catalog_import;
mod load_pipeline;
mod history_loading;
mod history_source;
mod history_operations;
mod operation_journal;
mod library_operations;
mod history_review;
mod routine_loading;
mod routine_reader;
mod routine_edit;
mod routine_protocol;
mod source_snapshot;
mod song_metadata;
mod metadata_defaults;
mod exercise_assets;
mod history_actions;
mod finger_annotations;
mod history_replay_loading;
mod exercise_loading;
mod runtime_request;
mod meter_map;
mod finger_pair;
mod finger_pair_interactions;
mod performance_archive;
mod round_storage;
mod practice_backup_preview;
mod practice_backup_import;
mod pending_save;
mod settings_storage;
mod round_save;
mod round_analysis;
pub use round_analysis::GoalState as ExpressionGoalState;
mod storage_control;
mod storage_recovery;
pub use pending_save::{StorageOperation, StorageStatus};
pub use storage_recovery::StorageRecovery;
mod storage_close;
pub use storage_close::CloseInput;
mod startup;
mod recording_save;
mod soundfont_loading;
mod sound_runtime;
mod midi_packet;
mod sound_change;
mod input_runtime;
mod input_change;
mod asset_storage;
mod asset_edit;
mod practice_edit;
mod practice_catalog;
mod practice_source;
mod hand_annotations;
mod note_playback;
mod demo_loading;
mod score_mapping;
mod history_reader;
mod history_calendar;
mod history_list;
mod history_clip_edit;
mod json_stream;
mod replay_index;
mod shared_map;
mod song_switch;
mod package_loading;
mod song_document;
mod state_projection;
mod feedback_reader;
pub mod live_notes;
mod playback_memory;
pub use state_projection::{StateCursor, StateFrame};
mod replay_clips;
mod history_problem_plan;
mod history_problem_cuts;
mod practice_conditions;
mod practice_variant;
mod history_multi_plan;
mod metadata_history;
mod metadata_templates;
pub mod file_locations;
pub mod repertoire;
mod import_storage;
mod library_metadata;
mod synthesia_import;
mod metadata_discovery;
pub use synthesia_import::{ImportOptions as SynthesiaImportOptions, ImportPreview as SynthesiaImportPreview, ImportRow as SynthesiaImportRow};
mod legacy_exercise_tracks;
mod legacy_exercise_history;
mod audio;
mod track_sound;
mod track_appearance;
mod expression_goal;
mod expression_review;
mod document;
mod fingerings;
mod fingering_protocol;
mod finger_practice;
mod paper_practice;
mod paper_navigation;
mod paper_views;
mod held_actions;
mod hands;
mod history_commands;
mod weak_practice;
mod ladder_commands;
mod routine_commands;
mod library_index;
mod library_scores;
mod score_review;
pub mod library_workspace;
mod library_edits;
mod metadata_claims;
mod notation;
mod duet_alignment;
pub mod score_ranges;
mod tick_ranges;
pub mod score_export;
pub mod score_sources;
mod practice_notation;
mod finger_demo;
mod demo_protocol;
mod held_demo;
mod song_learning;
mod song_learning_evidence;
mod package_commands;
mod piece_package;
mod preferences;
pub mod data_root_lock;
use panthesia_core::{
    exercise::{ExercisePlan, ExerciseSpec},
    practice::{AdaptiveTempoCoach, AdaptiveTempoRules, AttemptSummary},
    song_config::{PlayerConfig, SongConfig},
};
use preferences::{Passage, Preferences};
use std::collections::HashMap;
#[cfg(test)]
use std::thread;
pub mod library;
pub mod library_monitor;
pub mod library_repairs;
pub mod score_attachments;
pub mod practice_backup;

use midi_file::{MidiFile, MidiNote};
use panthesia_core::{
    piano_layout::KeyboardRange,
    practice::{PracticeHands, PracticeMatcher, PracticePart, PracticeTarget},
    practice_history::{
        PracticeHistoryStore, PracticeSession, PracticeSessionKind, SongPracticeSetup,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

mod session_state;
pub use session_state::{Note, LoadedSong, PlaybackPerformance, Snapshot};

// Runtime readers retain immutable song data; edits detach only on their worker.
type PracticeNotes = preferences::Shared<Vec<PracticeNote>>;
type PracticeTimeSlices = preferences::Shared<Vec<panthesia_core::practice_history::PracticeTimeSlice>>;
type SoundPresets = preferences::Shared<Vec<track_sound::Preset>>;
type PlaybackEvents = preferences::Shared<Vec<midi_file::MidiEvent>>;
type EventNotes = preferences::Shared<HashMap<(usize, u8, u8, Duration, bool), usize>>;
type SongFile = preferences::Shared<MidiFile>;
type FingerAssignments = preferences::Shared<HashMap<(usize, Duration, u8), u8>>;
type HandAssignments = preferences::Shared<HashMap<(usize, usize), PracticePart>>;
type ActivePlan = preferences::Shared<routine_commands::ActiveRoutine>;
type OriginalGrid = preferences::Shared<midi_file::musical_time::MusicalTime>;

mod protocol;
pub use protocol::Command;
pub use score_review::ScoreReviewExpectation;
pub use score_mapping::Input as ScoreMappingRequest;
pub use routine_reader::ReadRequest as RoutineReadRequest;
pub use routine_edit::OptionsRequest as RoutineOptionsRequest;
pub use history_reader::{AnnotationInput as HistoryAnnotationRequest, ReadRequest as HistoryReadRequest, HistoryPageRequest};
pub use history_reader::ReadScope as ReadTaskScope;
pub use history_list::{HistoryPage, HistoryListEntry};
pub use history_calendar::HistoryCalendar;
pub use practice_edit::Request as PracticeRequest;

#[derive(Clone)]
pub struct Engine {
    catalog_rows: Arc<Mutex<Option<std::sync::Weak<Mutex<Vec<library::SongRow>>>>>>,
    paper_navigation: Arc<std::sync::atomic::AtomicU64>,
    music_imports: music_import::Store,
    backup_imports: backup_operations::Store,
    history_operations: history_operations::Store,
    library_opens: library_operations::Store,
    engine_id: Arc<str>,
    startup: startup::Control,
    devices: device_catalog::Catalog,
    sound: sound_runtime::Host,
    input: input_runtime::Client,
    soundfont: PathBuf,
    soundfont_fallback: Option<PathBuf>,
    silent: bool,
    imports_in_flight: Arc<std::sync::atomic::AtomicUsize>,
    // Admission order lets editor reads detect a writer that completed during the read.
    operation_epoch: Arc<std::sync::atomic::AtomicU64>,
    _runtime: Arc<storage_control::RuntimeLifetime>,
    closing: Arc<AtomicBool>,
    storage_busy: Arc<AtomicBool>,
    tx: mpsc::Sender<runtime_request::Request>,
    control_tx: mpsc::Sender<runtime_request::Request>,
    tasks: background_tasks::TaskPool,
    storage_tasks: background_tasks::TaskPool,
    pending_saves: pending_save::Pipeline,
    state: Arc<Mutex<Snapshot>>,
    indexer: library_index::Indexer,
    data: PathBuf,
    _data_lock: Arc<data_root_lock::DataRootLock>,
}
mod bootstrap;
mod application;
mod playback_driver;

/// Only bounded control commands may use the reserved service and runtime lane.
pub fn is_control_command(command: &Command) -> bool {
    matches!(command, Command::Panic | Command::Pause | Command::Note { .. }
        | Command::StopFingerDemo { .. } | Command::FingerDemoState | Command::Tasks | Command::CancelTask { .. } | Command::CancelHistoryRead { .. }
        | Command::SkipStartupSong | Command::RetryStartup | Command::DismissStartupWarning { .. })
}

pub fn is_timed_mode(mode: &str) -> bool {
    matches!(mode, "flow" | "recital" | "memory")
}
fn is_recital_mode(mode: &str) -> bool {
    matches!(mode, "recital" | "memory")
}

pub fn devices() -> serde_json::Value {
    let inputs = midir::MidiInput::new("Panthesia devices")
        .map(|m| {
            m.ports()
                .iter()
                .filter_map(|p| m.port_name(p).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let outputs = midir::MidiOutput::new("Panthesia devices")
        .map(|m| {
            m.ports()
                .iter()
                .filter_map(|p| m.port_name(p).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    serde_json::json!({ "inputs": inputs, "outputs": outputs,"vst3":panthesia_vst3::discover_standard_plugins() })
}

#[derive(Clone)]
struct PracticeNote {
    inner: MidiNote,
    index: usize,
}
impl std::ops::Deref for PracticeNote {
    type Target = MidiNote;
    fn deref(&self) -> &MidiNote {
        &self.inner
    }
}
#[derive(Clone)]
struct LocatedScoreMap {
    content_id:String,
    score_revision:u64,
    source_fingerprint:String,
    token:String,
    grid:String,
    notes:HashMap<(usize,usize),(String,usize)>,
}
struct Player {
    startup: Option<startup::Control>,
    recording_saved: bool,
    recording_path: Option<PathBuf>,
    closing: Arc<AtomicBool>,
    round_resume_epoch: Option<u64>,
    round_continuation_pending: bool,
    pending_saves: Option<pending_save::Pipeline>,
    save_error: Option<String>,
    settings_save_error: Option<String>,
    storage_recovery_error: Option<String>,
    asset_recovery_error:Option<String>,
    storage_busy: Arc<AtomicBool>,
    storage_id: Option<String>,
    state: Snapshot,
    state_clock: Option<state_order::Clock>,
    detached_engine_id: Option<String>,
    file: Option<SongFile>,
    source_file: Option<SongFile>,
    notes: PracticeNotes,
    note_hands: HandAssignments,
    hand_undo: practice_edit::HandUndo,
    event_notes: EventNotes,
    original_grid: Option<OriginalGrid>,
    meter_map:Option<panthesia_core::library::MeterMap>,
    meter_correction: Option<panthesia_core::library::MeterCorrection>,
    note_cursor: usize,
    events: PlaybackEvents,
    event_cursor: usize,
    matcher: PracticeMatcher,
    pending_time:PracticeTimeSlices,
    pending_untracked:u64,
    time_fraction:Duration,
    time_connected:bool,
    time_last_end:Option<u64>,
    session_clock: Duration,
    history: PracticeHistoryStore,
    title: String,
    input_connection: Option<midir::MidiInputConnection<()>>,
    input_status_error: Option<String>,
    input_tx: mpsc::SyncSender<input_runtime::Event>,
    input_rx: mpsc::Receiver<input_runtime::Event>,
    input_client:Option<input_runtime::Client>,
    input_generation:u64,
    input_revision:u64,
    input_disconnects:u64,
    input_overflow: Arc<AtomicBool>,
    output_connection: Option<midir::MidiOutputConnection>,
    audio: Option<audio::Audio>,
    soundfont: PathBuf,
    soundfont_revision: u64,
    prepared_font: Option<oxisynth::SoundFont>,
    sound_host: Option<sound_runtime::Host>,
    sound_change: Option<String>,
    sound_status_error: Option<String>,
    soundfont_presets: SoundPresets,
    silent: bool,
    preferences: Preferences,
    preferences_path: PathBuf,
    restoring: bool,
    sound_timeline: Arc<track_sound::Timeline>,
    track_routing: Arc<track_sound::Routing>,
    track_sound_cache: Arc<std::collections::BTreeMap<usize, track_sound::TrackSound>>,
    config: SongConfig,
    fingers: FingerAssignments,
    exercise: Option<ExerciseSpec>,
    previous_summary: Option<preferences::Shared<AttemptSummary>>,
    projections: state_projection::Cache,
    reclaimer: Option<playback_memory::Reclaimer>,
    coach: AdaptiveTempoCoach,
    ladder: Option<preferences::LadderRun>,
    routine:Option<ActivePlan>,
    active_expression_goal:Option<expression_goal::ExpressionGoal>,
    expression_attempt_started:bool,
    last_click: Option<(usize, usize)>,
    finger_demo: Option<finger_demo::Demo>,
    audio_stop_epoch: u64,
    cancelled_replay_starts: std::collections::VecDeque<String>,
    recorder: panthesia_core::recorder::FreeplayRecorder,
    performance_capture:performance_archive::Capture,
    data: PathBuf,
    notation: Option<Arc<notation::ScoreAsset>>,
    score_revision: u64,
    located_score_map: Option<Arc<LocatedScoreMap>>,
    score_mapping_epoch: u64,
    vst: Option<panthesia_vst3::Vst3OutputConnection>,
    end_hold: f64,
    previous_mode: Option<String>,
    finger_undo: practice_edit::FingerUndo,
}
impl Player {
    #[cfg(test)]
    fn new(data: PathBuf, soundfont: PathBuf, silent: bool) -> Self {
        let loaded=startup::Data::read(&data,&soundfont);
        Self::with_data(data,soundfont,silent,loaded)
    }
    fn empty(data:PathBuf,soundfont:PathBuf,silent:bool) -> Self {
        let loaded=startup::Data::empty(&data);
        Self::with_data(data,soundfont,silent,loaded)
    }
    fn with_data(data:PathBuf,soundfont:PathBuf,silent:bool,loaded:startup::Data) -> Self {
        let (input_tx,input_rx)=mpsc::sync_channel(4096);
        let preferences_path=data.join("web-preferences.json");
        let startup::Data { preferences,history,soundfont_presets,error:settings_error,blocked:import_recovery_pending,.. }=loaded;
        Self {
            startup: None,
            recording_saved: false,
            recording_path: None,
            closing: Arc::new(AtomicBool::new(false)),
            round_resume_epoch: None,
            round_continuation_pending: false,
            pending_saves: None,
            save_error: None,
            settings_save_error: None,
            storage_recovery_error: None,
            asset_recovery_error:None,
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
            note_cursor: 0,
            events: PlaybackEvents::default(),
            event_cursor: 0,
            matcher: PracticeMatcher::new(KeyboardRange::new(0..=127)),
            pending_time:Default::default(),pending_untracked:0,time_fraction:Duration::ZERO,time_connected:false,time_last_end:None,
            session_clock: Duration::ZERO,
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
            performance_capture:Default::default(),
            audio_stop_epoch: 0,
            cancelled_replay_starts: Default::default(),
            data: data.clone(),
            notation: None,
            score_revision: 0,
            located_score_map: None,
            score_mapping_epoch: 0,
            vst: None,
            end_hold: 0.,
            previous_mode: None,
            finger_undo: Default::default(),
            config: SongConfig::default(),
            fingers: FingerAssignments::default(),
            exercise: None,
            previous_summary: None,
            projections: Default::default(),
            reclaimer: None,
            coach: AdaptiveTempoCoach::default(),
            ladder: None,
            routine:None,
            active_expression_goal:None,
            expression_attempt_started:false,
            last_click: None,
            finger_demo: None,
        }
    }
    fn annotation_path(&self, file: &MidiFile) -> Result<PathBuf, String> {
        if let Some(path) = &file.source_path {
            return Ok(path.clone());
        }
        let root = self.data.join("song-assets");
        let spec=self.exercise.ok_or("曲目缺少可保存的内容")?;
        let bytes=exercise_assets::canonical_bytes(spec)?;
        let bytes_id=blake3::hash(&bytes).to_hex().to_string();
        Ok(import_storage::store_with_identity(&root,&file.content_id,&bytes_id,&file.content_id,&bytes)?.path)

    }
    fn begin_play(&mut self) {
        if self.session_clock == Duration::ZERO {
            self.active_expression_goal = self.effective_expression_goal();
        }
        self.expression_attempt_started = true;
        if self.state.count_in > 0 && self.session_clock == Duration::ZERO {
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
    fn install(
        &mut self,
        file: MidiFile,
        title: String,
        plan: Option<ExercisePlan>,
    ) -> Result<(), String> {
        self.install_prepared(file, title, plan, None)
    }
    fn install_prepared(
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
        self.panic();
        self.original_grid = Some(file.musical_time.clone().into());
        self.meter_correction = None;
        self.meter_map = None;
        self.config = SongConfig::new(&file.tracks);
        self.state.mode = "wait".into();
        self.state.wait = true;
        self.state.hands = "both".into();
        self.state.speed = 1.;
        self.state.count_in = 1;
        self.state.metronome = false;
        self.state.rounds = 0;
        self.state.adaptive = false;

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
        self.ladder = None;
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
                    ["wait", "flow", "listen", "recital", "memory"].contains(&mode.as_str())
                })
                .unwrap_or_else(|| "wait".into());
            self.state.wait = self.state.mode == "wait";
            self.state.count_in = settings.count_in;
            self.state.metronome = settings.metronome;
            self.state.latency = settings.latency;
            self.state.rounds = settings.rounds;
            self.state.adaptive = settings.adaptive;
            if ["both", "left", "right", "custom"].contains(&settings.hands.as_str()) {
                self.state.hands = settings.hands.clone();
            }
            for t in &mut self.config.tracks {
                if let Some(part) = settings.parts.get(&t.track_id) {
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
        if is_recital_mode(&self.state.mode) {
            self.state.passage = None;
            self.state.rounds = 1;
            self.state.adaptive = false;
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
    fn restore(&mut self) {
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
            if let Err(e) = self.command(Command::Load {
                path,
                title: prefs.title.clone(),
            }) {
                errors.push(format!("上次曲目无法恢复：{e}"));
            }
        }
        self.restore_controls(prefs,errors);
    }
    fn restore_controls(&mut self,prefs:Preferences,mut errors:Vec<String>) {
        if let Some(speed) = prefs
            .speed
            .filter(|v| v.is_finite() && (0.25..=2.).contains(v))
        {
            self.state.speed = speed;
        }
        if self.preferences.songs.is_empty() {
            self.state.wait = prefs.wait.unwrap_or(true);
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
            if !is_recital_mode(&self.state.mode)
                && self.file.is_some()
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
    fn persist(&mut self) -> Result<(), String> {
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
            if let Some(run)=&self.ladder {self.preferences.ladder_runs.insert(format!("{}:{}",file.content_id,run.preset.id),run.clone());}
            self.preferences.exercise = self.exercise;
            if let Some(spec)=self.exercise {
                if self.preferences.exercise_layouts.get(&file.content_id) != Some(&spec.hands) {
                    self.preferences.exercise_layouts.insert(file.content_id.clone(),spec.hands);
                }
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
                    adaptive: self.state.adaptive,
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
    fn remember_active_score(&mut self) -> Result<(), String> {
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
    fn score_content_guard(&self, id: &str) -> Result<(), String> {
        if self.file.as_ref().is_none_or(|f| f.content_id != id) {
            Err("曲目已切换，请重新打开谱面管理".into())
        } else {
            Ok(())
        }
    }
    fn corrected_grid(
        file: &MidiFile,
        meter: panthesia_core::library::MeterCorrection,
    ) -> Result<midi_file::musical_time::MusicalTime, String> {
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
        midi_file::musical_time::MusicalTime::corrected(
            file.musical_time.ppq,
            end,
            meter.numerator,
            meter.denominator,
            meter.pickup_ticks,
        )
    }
    fn grid_signature(&self)->String {let mut grid=self.file.as_deref().map(practice_conditions::grid).unwrap_or_else(||"grid-v1-cbf29ce484222325".into());let variant=self.variant();if variant.active(){grid.push_str(&variant.signature());}grid}
    fn practice_scope(&self)->String {practice_conditions::scope(self.file.as_deref(),&self.notes,&self.config,&self.note_hands,&self.state.hands)}
    fn note_player(&self, track: usize, index: usize) -> PlayerConfig {
        let base = self.config.player_for(track, index);
        if base != PlayerConfig::Human {
            return base;
        }
        let wanted = match self.state.hands.as_str() {
            "left" => Some(PracticePart::LeftHand),
            "right" => Some(PracticePart::RightHand),
            "other" => Some(PracticePart::Other),
            _ => None,
        };
        if wanted.is_some_and(|h| hands::part(&self.config, &self.note_hands, track, index) != h) {
            PlayerConfig::Auto
        } else {
            base
        }
    }
    fn set_hand_scope(&mut self, value: &str) -> Result<(), String> {
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
    fn prepare_measure_part(&mut self, content_id: &str, measure: usize, part: PracticePart, track_id: usize) -> Result<(), String> {
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
    fn selected(&self, track: usize) -> bool {
        let count = self.file.as_ref().and_then(|file| file.tracks.iter().find(|t| t.track_id == track))
            .map_or(0, |track| track.notes.len());
        self.config.has_human_notes(track, count)
    }
    fn ensure_audio(&mut self) -> Result<(), String> {
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
    fn set_soundfont(&mut self,path:PathBuf) -> Result<serde_json::Value,String> {
        let revision=self.soundfont_context()?;
        let prepared=soundfont_loading::Prepared::read(path)?;
        // Legacy owned readers do not have a task registry.
        self.install_soundfont_owned(revision,prepared)
    }
    fn panic(&mut self) {
        self.audio_stop_epoch = self.audio_stop_epoch.wrapping_add(1);
        self.performance_capture.close(self.session_clock.as_secs_f64(),self.state.position);
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
        self.state.pedal = 0;
    }
    fn send(&mut self, bytes: &[u8]) {
        if self.sound_change.is_some(){return;}
        if let Some(host)=&self.sound_host {host.send(bytes);return;}
        if let Some(vst) = &self.vst {
            if let Ok(midi_file::midly::live::LiveEvent::Midi { channel, message }) =
                midi_file::midly::live::LiveEvent::parse(bytes)
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
    fn save(&mut self) -> Result<(), String> {
        if self.state.saved {
            return Ok(());
        }
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        if self.matcher.snapshot().matched_notes
            + self.matcher.snapshot().wrong_notes
            + self.matcher.snapshot().missed_notes
            == 0
        {
            return Err("还没有演奏记录，无法保存结果".into());
        }
        let hands = match self.state.hands.as_str() {
            "left" => PracticeHands::Left,
            "right" => PracticeHands::Right,
            "custom" | "other" => PracticeHands::Custom,
            _ => PracticeHands::Both,
        };
        let session=PracticeSession::new(
                    self.state
                        .passage
                        .as_ref()
                        .map_or(PracticeSessionKind::WholeSong, |p| {
                            PracticeSessionKind::Loop {
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
                    hands,
                    self.state.speed as f32,
                    self.matcher.summary(),
                )
                .with_playing_ms(self.session_clock.as_millis().min(u128::from(u64::MAX)) as u64)
                .with_context(self.history_context())
                .with_scope(self.practice_scope())
                .with_mode(&self.state.mode)
                .with_effective_tempo_bpm(Some(
                    (self.snapshot().bpm * self.state.speed)
                        .round()
                        .clamp(1., 65535.) as u16,
                ));
        let history_id = session.stable_id();
        let archive=performance_archive::prepare(&file.content_id,&history_id,&self.performance_capture,self.session_clock.as_secs_f64(),self.matcher.results())?;
        let entry=panthesia_core::practice_history::PracticeTimeEntry{saved_at_unix_ms:session.recorded_at_unix_ms,slices:self.pending_time.materialize(),untracked_ms:self.pending_untracked};
        let candidate=self.history.stage_session_with_time(&file.content_id,&self.title,session,entry)?.unwrap_or_else(||self.history.clone());
        let archive_path=performance_archive::path(&self.data,&file.content_id,&history_id);
        let name=archive_path.file_name().and_then(|n|n.to_str()).ok_or("回放保存位置无效")?;
        if let Err(error)=round_storage::commit(&self.data,archive.as_ref().map(|b|(name,b.as_slice())),&candidate.snapshot_bytes().map_err(|e|e.to_string())?) {
            if round_storage::pending(&self.data) {self.history.block_writes(error.clone());}
            return Err(error);
        }
        self.history=candidate;
        self.pending_time.clear();self.pending_untracked=0;
        self.previous_summary = Some(self.matcher.summary().into());
        self.previous_mode = Some(self.state.mode.clone());
        self.state.saved = true;
        self.state.current_history_id = Some(history_id);
        Ok(())
    }
    fn reset(&mut self,position:f64) {self.reset_with_sound(position,None);}
    fn reset_with_sound(&mut self,position:f64,prepared:Option<track_sound::Prepared>) {
        self.round_continuation_pending = false;
        self.active_expression_goal = None;
        let projections = std::mem::take(&mut self.projections);
        self.retire(projections);
        self.expression_attempt_started = false;
        self.panic();
        let report = self.matcher.report();
        self.matcher.reset();
        let capture = std::mem::take(&mut self.performance_capture);
        self.retire((report, capture));
        self.session_clock = Duration::ZERO;
        self.pending_time.clear();self.pending_untracked=0;self.time_fraction=Duration::ZERO;self.time_connected=false;self.time_last_end=None;
        self.state.position = position;
        if self.state.metronome {
            let snap = self.snapshot();
            let click = (snap.measure, snap.beat.floor() as usize);
            if self.last_click != Some(click) {
                self.sound_click(click.1 == 1);
                self.last_click = Some(click);
            }
        }
        self.state.saved = false;
        self.state.current_history_id = None;
        self.note_cursor = self
            .notes
            .partition_point(|n| n.start.as_secs_f64() < position);
        self.event_cursor = self
            .events
            .partition_point(|e| e.timestamp.as_secs_f64() < position);
        if let Some(prepared)=prepared {self.restore_prepared_track_sound(prepared);} else {self.restore_track_sound();}
        self.state.status = "ready".into();
        self.state.count_remaining = 0.;
        self.last_click = None;
        self.end_hold = 0.;
    }
    fn command(&mut self, command: Command) -> Result<serde_json::Value, String> {
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
        if let Command::SetSongExpressionGoal { goal } = command {
            return self.set_song_expression_goal(goal);
        }
        if let Command::PreviewLegacyExerciseHistory{content_id}=command {return legacy_exercise_history::preview(self,&content_id);}
        if let Command::ReviewLegacyExerciseHistory{content_id,old_id,current_id,fingerprint,approve}=command {return legacy_exercise_history::update(self,&content_id,&old_id,&current_id,&fingerprint,approve);}
        if let Command::PreviewLegacyExerciseTracks { content_id } = command {
            return legacy_exercise_tracks::preview(self, &content_id);
        }
        if let Command::ApplyLegacyExerciseTracks { content_id, fingerprint, restore_conditions } = command {
            return legacy_exercise_tracks::apply(self, &content_id, &fingerprint, restore_conditions);
        }
        if self.finger_demo.is_some() && !matches!(&command, Command::StartFingerDemo{..}|Command::FingerDemoControl{..}|Command::StartHeldFingerDemo{..}|Command::StartHistoryReplay{..}|Command::StartHistoryReplayRange{..}|Command::PlayHistorySource{..}|Command::HistoryReplayControl{..}|Command::HistoryReplayLoop{..}|Command::HistoryProblemNotes{..}|Command::PreviewProblemCuts{..}|Command::PreviewMultiProblemPlan{..}|Command::SaveMultiProblemPlan{..}|Command::PreviewHistoryProblemPlan{..}|Command::SaveHistoryProblemPlan{..}|Command::HistoryReplayClips{..}|Command::ReadHistoryReplayClips{..}|Command::SaveHistoryReplayClip{..}|Command::DeleteHistoryReplayClip{..}|Command::HistoryPerformance{..}|Command::ReadHistoryPerformance{..}|Command::ReadHistoryDetail{..}|Command::StopFingerDemo{..}|Command::FingerDemoState|Command::CurrentSong|Command::Volume{..}|Command::SoundFont{..}) {
            self.panic();
        }
        if self.routine.is_some() && matches!(command,
            Command::Mode{..}|Command::Wait{..}|Command::Speed{..}|Command::Hands{..}|Command::Track{..}
            |Command::Meter{..}|Command::SaveMeterMap{..}|Command::ApplyHands{..}|Command::EditNotePlayback{..}|Command::NoteHand{..}|Command::UndoHands
            |Command::MeasureLoop{..}|Command::PrepareMeasurePart{..}|Command::Loop{..}|Command::ApplyScoreRange{..}|Command::Rounds{..}|Command::Adaptive{..}
            |Command::Seek{..}|Command::SeekMeasure{..}|Command::SeekBeat{..}|Command::StepBeat{..}
            |Command::CountIn{..}|Command::Metronome{..}|Command::Latency{..}|Command::Save|Command::Recording{active:true}) {
            return Err("正在练习计划项目，请先结束本项再修改条件".into());
        }
        if self.routine.is_some() && matches!(command,Command::Load{..}|Command::Generate{..}|Command::ImportScore{..}|Command::ImportMidi{..}|Command::ImportPackage{..}|Command::OpenRecent{..}|Command::HistoryOpen{..}|Command::OpenPassage{..}|Command::StartLadder{..}) {self.stop_routine()?;}
        match &command {
            Command::Routines{day}=>return self.routines(day),
            Command::SaveRoutine{id,day,name,notes,copy_of,request_id}=>return self.save_routine_with_request(id.clone(),day.clone(),name.clone(),notes.clone(),copy_of.clone(),request_id.clone()),
            Command::SaveRoutineSchedule{id,schedule}=>return self.save_routine_schedule(id,schedule.clone()),
            Command::RemoveRoutine{id}=>return self.remove_routine(id),
            Command::PassageCatalog{content_id,query,offset}=>return self.passage_catalog(content_id.as_deref(),query,*offset),
            Command::ComposePassages{routine_id,day,content_id,entries,goal,proof}=>return self.compose_passages(routine_id,day.as_deref(),content_id,entries,goal,proof.as_deref()),
            Command::SaveRoutineItem{content_id,routine_id,day,id,source,source_id,title,notes,goal}=>{
                if content_id.as_ref().is_some_and(|expected|self.file.as_ref().is_none_or(|file|&file.content_id!=expected)){return Err("曲目已切换，请重新选择计划项目来源".into());}
                return self.save_routine_item(routine_id,day.as_deref(),id.clone(),source.as_deref(),source_id.as_deref(),title.clone(),notes.clone(),goal.clone());
            },
            Command::MoveRoutineItem{routine_id,day,item_id,direction}=>return self.move_routine_item(routine_id,day.as_deref(),item_id,*direction),
            Command::RemoveRoutineItem{routine_id,day,item_id}=>return self.remove_routine_item(routine_id,day.as_deref(),item_id),
            Command::OpenRoutineItem{routine_id,day,item_id,resume}=>return self.open_routine_item(routine_id,day,item_id,*resume),
            Command::PreviewTickRange{content_id,grid,start,end}=>return self.preview_tick_range(content_id,grid,start,end),
            Command::ApplyTickRange{range}=>return self.apply_tick_range(range),
            Command::SaveTickPassage{id,name,notes,range}=>return self.save_tick_passage(id.clone(),name.clone(),notes.clone(),range.clone()),
            Command::StopRoutine=>return self.stop_routine(),
            Command::SkipRoutineItem{routine_id,day,item_id,reason}=>return self.mark_routine_item(routine_id,day,item_id,false,reason),
            Command::ResetRoutineItem{routine_id,day,item_id}=>return self.mark_routine_item(routine_id,day,item_id,true,""),
            Command::StopLadder if self.routine.is_some()=>return self.stop_routine(),
            _=>{}
        }
        if self.ladder.as_ref().is_some_and(|r|r.active) && matches!(command,
            Command::Mode{..}|Command::Wait{..}|Command::Speed{..}|Command::Hands{..}|Command::Track{..}
            |Command::Meter{..}|Command::SaveMeterMap{..}|Command::ApplyHands{..}|Command::EditNotePlayback{..}|Command::NoteHand{..}|Command::UndoHands
            |Command::MeasureLoop{..}|Command::PrepareMeasurePart{..}|Command::Loop{..}|Command::ApplyScoreRange{..}|Command::Rounds{..}|Command::Adaptive{..}
            |Command::OpenPassage{..}|Command::Seek{..}|Command::SeekMeasure{..}|Command::SeekBeat{..}|Command::StepBeat{..}
            |Command::CountIn{..}|Command::Metronome{..}|Command::Latency{..}|Command::Save|Command::Recording{active:true}) {
            return Err("速度阶梯进行中，请先结束阶梯再修改练习条件".into());
        }
        match &command {
            Command::LadderPresets=>return self.ladder_presets(),
            Command::SaveLadder{id,name,start,end,plan,expression}=>return self.save_ladder(id.clone(),name,*start,*end,plan.clone(),expression.clone()),
            Command::UpdateLadderName{id,name}=>return self.update_ladder_name(id,name),
            Command::RemoveLadder{id}=>return self.remove_ladder(id),
            Command::StartLadder{id,resume}=>return self.start_ladder(id,*resume),
            Command::StopLadder=>return self.stop_ladder(),
            _=>{}
        }
        let workspace_lock = if matches!(
            command,
            Command::ImportPackage { .. }
                | Command::ExportPackage | Command::ExportPackageFile
        ) {
            Some(library_workspace::lock_for(&self.data)?)
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
                Command::ImportScore { .. }
                    | Command::ImportPackage { .. }
                    | Command::ImportMidi { .. }
                    | Command::Load { .. }
                    | Command::LoadIndexed { .. }
                    | Command::OpenRecent { .. }
                    | Command::HistoryOpen { .. }
            | Command::PerformHistoryAction { .. }
            | Command::StartHistoryOperation { .. }
                    | Command::HistoryPracticeRange { .. }
                    | Command::HistoryScoreReview { .. }
                    | Command::Generate { .. }
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
                    | Command::ApplyHands { .. }
                    | Command::EditNotePlayback { .. }
                    | Command::NoteHand { .. }
                    | Command::Meter { .. } | Command::SaveMeterMap { .. }
                    | Command::UndoHands
                    | Command::Hands { .. }
            )
        {
            return Err("请先停止录音，再切换曲目或练习设置".into());
        }
        if is_recital_mode(&self.state.mode) {
            if matches!(
                command,
                Command::PrepareMeasurePart { .. }
                    | Command::MeasureLoop { enabled: true, .. }
                    | Command::Loop { enabled: true, .. }
                    | Command::OpenPassage { .. }
                    | Command::SavePassage { .. }
                    | Command::SaveScorePassage { .. }
                    | Command::ApplyScoreRange { .. }
                    | Command::Adaptive { enabled: true }
            ) {
                return Err("完整演奏与背谱只演奏一遍；选段循环请切换到连续或等音模式".into());
            }
            if ["playing", "countIn", "paused"].contains(&self.state.status.as_str())
                && matches!(
                    command,
                    Command::Seek { .. }
                        | Command::SeekMeasure { .. }
                        | Command::SeekBeat { .. }
                        | Command::StepBeat { .. }
                        | Command::Track { .. }
                        | Command::Hands { .. }
                        | Command::Meter { .. } | Command::SaveMeterMap { .. }
                        | Command::EditNotePlayback { .. }
                    | Command::NoteHand { .. }
                        | Command::ApplyHands { .. }
                        | Command::UndoHands
                        | Command::Speed { .. }
                        | Command::CountIn { .. }
                        | Command::Rounds { .. }
                )
            {
                return Err("本轮演奏已开始，请先重新开始，再修改范围、速度或声部".into());
            }
        }
        if library_workspace::accepts(&command) {
            return library_workspace::execute(command, &self.data);
        }
        if matches!(command, Command::Collection) {
            let index=library_workspace::Workspace::load(&self.data)?;
            let songs: Vec<_> = self.history.recent_songs(usize::MAX).into_iter().map(|s| { let path=library::available_path(&index,&s.content_id,s.source_path.as_deref());
                let available=s.source_path.is_none()||path.is_some();
                serde_json::json!({
                "contentId": s.content_id, "title": s.display_name, "storedPath":s.source_path, "path":path,
                "favorite": s.favorite, "queuePosition": s.queue_position, "lastUsed": s.last_used_unix_ms,
                "lastPracticed":self.history.song(&s.content_id).and_then(|h|h.sessions.last()).map(|s|s.recorded_at_unix_ms), "sessions": s.session_count, "accuracy": s.latest_accuracy,"available":available,"recommended":s.recommended_measures,"review":s.review.map(|r|serde_json::json!({"due":r.is_due,"dueAt":r.due_at_unix_ms,"sourceAt":r.source_at_unix_ms,"sourceIsWholeSong":r.source_is_whole_song,"days":r.days_until_due,"streak":r.mastery_streak,"intervalDays":r.interval_days,"reason":format!("{:?}",r.reason)})), "generated":self.history.setup(&s.content_id).is_some_and(|s|s.exercise_spec.is_some())
            })}).collect();
            return Ok(serde_json::json!({ "songs": songs }));
        }
        if let Command::OpenRecent { content_id } = &command {
            let record = self.history.song(content_id).ok_or("找不到该练习记录")?;
            if let Some(spec) = record.setup.as_ref().and_then(|s| s.exercise_spec) {
                return self.command(Command::Generate { spec });
            }
            let paths=record.setup.as_ref().and_then(|s|s.source_path.clone()).into_iter().chain(record.library.source_path.clone());
            let file=library::verified_file(&self.data,content_id,paths)?;
            let title=record.display_name.clone();
            self.install(file,title,None)?;
            self.persist()?;
            return self.command(Command::CurrentSong);
        }
        match &command {
            Command::StartLibraryOpen{..}|Command::ReadLibraryOpen{..}|Command::CancelLibraryOpen{..}|Command::ReleaseLibraryOpen{..}=>return Err("曲库打开操作需要使用后台入口".into()),
            Command::WeakPractice=>return self.weak_practice(),
            Command::DueReview{offset,expected}=>return self.due_review(*offset,expected.as_deref()),
            Command::AcceptWeakPractice{ids,edits,routine_id,day,name,request_id}=>return self.accept_weak_practice_with_edits(ids,edits,routine_id.as_deref(),day.as_deref(),name,request_id.as_deref()),
            Command::HistoryQuery { query, mode, hands, range, days, offset, limit,from,to } => {
                return self.history_query_window(query, mode, hands, range, *days, *offset, *limit,*from,*to);
            }
            Command::ReadHistoryPage { request } => return self.read_history_page_checked(request, || Ok(())),
            Command::EditRoutine { .. } => return Err("计划版本核对需要使用后台编辑入口".into()),
            Command::AnnotateHistory{content_id,id,note,teacher,next,expected}=>return self.annotate_history(content_id,id,note.clone(),teacher.clone(),next.clone(),expected.clone()),
            Command::SetLibraryCollection{path,content_id,favorite,queued} => return self.set_library_collection(path,content_id,*favorite,*queued),
            Command::PracticeTime {content_id,from,to} => return self.practice_time(content_id,*from,*to),
            Command::PracticeCalendar{from,to,content_id}=>return self.practice_calendar(*from,*to,content_id.as_deref()),
            Command::HistoryPerformance{content_id,id}=>return self.history_performance(content_id,id),
            Command::ReadHistoryPerformance{content_id,id}=>return self.read_history_performance(content_id,id),
            Command::ReadHistoryDetail{content_id,id}=>return self.read_history_detail(content_id,id),
            Command::PerformHistoryAction{..}|Command::PlayHistorySource{..}|Command::StartHistoryOperation{..}|Command::ReadHistoryOperation{..}|Command::CancelHistoryOperation{..}|Command::ReleaseHistoryOperation{..}=>return Err("带版本的历史操作需要使用后台入口".into()),
            Command::StartHistoryReplay{content_id,id,source,rate,request_id}=>return self.start_history_replay(content_id,id,source,*rate,request_id.clone()),
            Command::StartHistoryReplayRange{content_id,id,source,rate,start,end,request_id}=>{
                let mut context = self.prepare_history_replay_request(content_id,id,source,*rate,request_id.clone())?;
                context.range = Some((*start,*end));
                let prepared = history_replay_loading::Prepared::read(&self.data,&context)?;
                self.check_history_replay(&context)?;
                prepared.check()?;
                return prepared.install(self,&context);
            },
            Command::HistoryReplayControl{id,action,position,rate}=>return self.history_replay_control(id,action,*position,*rate),
            Command::HistoryReplayLoop{id,start,end,enabled}=>return self.history_replay_loop(id,*start,*end,*enabled),
            Command::HistoryReplayClips{content_id,id}=>return self.history_replay_clips(content_id,id),
            Command::ReadHistoryReplayClips{content_id,id}=>return self.read_history_replay_clips(content_id,id),
            Command::SaveHistoryReplayClip{..}=>return self.edit_clips_owned(command),
            Command::DeleteHistoryReplayClip{content_id,id,clip_id,expected}=>return self.delete_history_replay_clip(content_id,id,clip_id,expected),
            Command::HistoryDetail { content_id, id } => return self.history_detail(content_id, id),
            Command::HistoryOpen { content_id, id, restore } => return self.history_open(content_id, id, *restore),
            Command::HistoryProblemNotes{content_id,id,offset}=>return self.history_problem_notes(content_id,id,*offset),
            Command::PreviewProblemCuts{single,multi,expected,edits}=>{let built=match(single,multi){(Some(s),None)=>self.build_history_problem_plan(s)?,(None,Some(s))=>self.build_multi_problem_plan(s)?,_=>return Err("请选择唯一编排来源".into())};let b=self.apply_problem_cuts(built,expected,edits)?;return Ok(serde_json::json!({"rows":b.rows,"revision":b.revision}));}
            Command::PreviewMultiProblemPlan{spec}=>return self.preview_multi_problem_plan(spec),
            Command::SaveMultiProblemPlan{spec,expected,name,notes,goal,edits}=>return self.save_multi_problem_plan(spec,expected,name,notes,goal,edits),
            Command::PreviewHistoryProblemPlan{spec}=>return self.preview_history_problem_plan(spec),
            Command::SaveHistoryProblemPlan{spec,expected,name,notes,goal,edits}=>return self.save_history_problem_plan(spec,expected,name,notes,goal,edits),
            Command::HistoryPracticeRange {content_id,id,reference,before,after}=>return self.history_practice_range(content_id,id,*reference,*before,*after),
            Command::HistoryScoreReview {content_id,id}=>return self.history_score_review(content_id,id),
            Command::History => return self.history_query("", "", "", "", 0, 0, 200),
            _ => {}
        }
        let persist = !matches!(
            command,
            Command::Note { .. }
                | Command::Play
                | Command::Pause
                | Command::Panic
                | Command::Save
                | Command::Feedback
                | Command::ExportPackage | Command::ExportPackageFile
                | Command::InspectPackage { .. }
                | Command::ExportMidi
                | Command::Metadata
                | Command::Calibration
                | Command::Score
                | Command::SourceScore
                | Command::ScoreMap { .. } | Command::ExportAnnotatedScore { .. }
                | Command::SuggestHands { .. }
                | Command::SuggestFingers { .. } | Command::FingerPlanContext { .. }
                | Command::Seek { .. }
        );
        let _legacy_persist = matches!(
            command,
            Command::Load { .. } | Command::LoadIndexed { .. }
                | Command::Speed { .. }
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
                .map_err(|e| e.to_string()).map(|mut v|{v["annotationRevision"]=serde_json::json!(self.state.annotation_revision);v["grid"]=serde_json::json!(self.grid_signature());v["meterMap"]=serde_json::json!(self.current_meter_map());v["fingerUndoAvailable"]=serde_json::json!(!self.finger_undo.is_empty());v["trackSounds"]=serde_json::json!(self.track_sound_settings());v["soundPresets"]=serde_json::json!(self.soundfont_presets);self.decorate_tracks(&mut v);self.decorate_finger_actions(&mut v);v["practiceVariant"]=self.variant_document();if self.variant().active(){v["fingerActions"]=serde_json::json!([]);}v}),
                None => Ok(serde_json::Value::Null),
            };
        }
        if self.variant().active() && matches!(command,Command::Meter{..}|Command::SaveMeterMap{..}|Command::EditNotePlayback{..}|Command::NoteHand{..}|Command::ApplyHands{..}|Command::EditFingersFor{..}) {return Err("请先恢复原始演奏，再修改源谱网格、分手或指法".into());}
        self.state.error = None;
        match command {
            Command::PracticeVariant{content_id,score_revision,value}=>return self.set_variant(&content_id,score_revision,value),
            Command::ExportPracticeVariant=>return self.export_practice_variant(),
            Command::AudioDevices=>return Ok(serde_json::json!({"devices":audio::Audio::devices()?})),
            Command::AudioDevice{..}=>return Err("请使用设备连接流程".into()),
            Command::SongPreview{..}=>return Err("请使用曲目预览流程".into()),
            Command::TrackAppearance{id,appearance} => return self.set_track_appearance(id,appearance),
            Command::TrackSound{id,sound} => return self.set_track_sound(id,sound),
            Command::SoundFont { path } => return self.set_soundfont(path),
            Command::ExportPackage | Command::ExportPackageFile => {
                self.command(Command::Pause)?;
                return self.export_piece_package(matches!(command,Command::ExportPackageFile));
            }
            Command::ImportStagedPackage { .. } => return Err("请先预览曲目包".into()),
            Command::InspectPackage { bytes } => {
                let package = piece_package::Package::decode(&bytes)?;
                let mut result = package.summary();
                result["existing"] = serde_json::json!(
                    self.history.song(&package.manifest.content_id).is_some()
                        || library_workspace::Workspace::load(&self.data)?
                            .entries
                            .values()
                            .any(|e| e.content_id.as_ref() == Some(&package.manifest.content_id))
                );
                return Ok(result);
            }
            Command::ImportPackage { bytes, policy } => {
                return self.import_piece_package(bytes, policy);
            }
            Command::ImportMidi { bytes, name } => return self.install_import(import_pipeline::prepare(import_pipeline::Input::Midi { bytes, name })?),
            Command::ImportScore { bytes, name, default_bpm } => return self.install_import(import_pipeline::prepare(import_pipeline::Input::Score { bytes, name, bpm: default_bpm })?),
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
                self.previous_summary = None;
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
                self.coach = AdaptiveTempoCoach::default();
                self.reset(0.);
            }
            command @ (Command::SuggestHands { .. } | Command::ApplyHands { .. }
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
                    adaptive: self.state.adaptive,
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
                let preset = preferences::PassagePreset {
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
            Command::OpenPassage { id } => {
                let f = self.file.as_ref().ok_or("请先选择曲目")?;
                let preset = self
                    .preferences
                    .passages
                    .get(&f.content_id)
                    .and_then(|ps| ps.iter().find(|p| p.id == id))
                    .cloned()
                    .ok_or("该练习段不属于当前曲目")?;
                if preset
                    .grid
                    .as_ref()
                    .is_some_and(|g| *g != self.grid_signature())
                {
                    return Err("小节网格已改变，请重新确认这个练习段的范围并保存".into());
                }
                if let Some(range)=&preset.score_range { self.validate_score_range(range)?; }
                if let Some(range)=&preset.precise_range { self.validate_tick_range(range)?; }
                if preset.score_range.is_none() && preset.precise_range.is_none() {
                    let measures=&f.musical_time.measures;
                    if preset.start==0 || preset.start>preset.end || preset.end>measures.len() {
                        return Err("练习段的小节范围已失效，请重新确认后保存".into());
                    }
                    let start=f.tempo_track.pulses_to_duration(measures[preset.start-1].start_tick).as_secs_f64();
                    let end=f.tempo_track.pulses_to_duration(measures[preset.end-1].end_tick).as_secs_f64().min(self.state.duration);
                    if !start.is_finite() || !end.is_finite() || end-start<0.1 {
                        return Err("练习段时长已失效，请重新确认后保存".into());
                    }
                }
                self.panic();
                self.state.status = "paused".into();
                self.config.apply_practice_setup(&SongPracticeSetup {
                    tracks: preset.settings.tracks.clone(),
                    ..Default::default()
                });
                for t in &mut self.config.tracks {
                    if let Some(part) = preset.settings.parts.get(&t.track_id) {
                        t.practice_part = *part;
                    }
                }
                self.state.mode = preset.settings.mode.unwrap_or_else(|| "wait".into());
                self.state.wait = self.state.mode == "wait";
                self.state.hands = preset.settings.hands;
                self.state.count_in = preset.settings.count_in;
                self.state.metronome = preset.settings.metronome;
                self.state.latency = preset.settings.latency;
                self.state.rounds = preset.settings.rounds;
                self.state.adaptive = preset.settings.adaptive;
                self.state.speed = preset.speed;
                if let Some(range)=&preset.score_range {return self.apply_score_range(range);}
                if let Some(range)=&preset.precise_range {return self.apply_tick_range(range);}
                return self.command(Command::MeasureLoop {
                    start: preset.start,
                    end: preset.end,
                    enabled: true,
                });
            }
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
                let summary=panthesia_core::score_alignment::summarize_alignment(&asset.alignment);
                if summary.readiness!=panthesia_core::score_alignment::AlignmentReadiness::Ready||!asset.alignment.navigation_complete{return Err("原谱与 MIDI 尚未可靠对应，不能自动定位音符".into());}
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
            Command::LibraryRepairs{..}
            | Command::ReadLibraryPath { .. } | Command::ReadMetadataHistoryClaim { .. } | Command::PendingMetadataHistoryPage { .. }
            | Command::MidiReplacements{..}
            | Command::PreviewMidiReplacement{..}
            | Command::DecideMidiReplacement{..}
            | Command::RelinkLibrary{..}
            | Command::SetLibraryPrimary{..}
            | Command::ScoreAttachments{..}
            | Command::PaperSourceUpdates| Command::LinkPaperSource{..}|Command::InspectPaperSources{..}|Command::PreviewPaperSource{..}|Command::ApplyPaperSource{..}
            | Command::PreviewPaperTransfer{..}|Command::ApplyPaperTransfer{..}
            | Command::AddScoreAttachment{..}
            | Command::UpdateScoreAttachment{..}
            | Command::RestoreLibraryPath{..}
            | Command::IgnoreLibraryPath{..}
            | Command::LibraryMonitorStatus
            | Command::SetLibraryMonitor { .. }
            | Command::LibraryWorkspace
            | Command::SaveSongLearning{..}
            | Command::ReadSongLearning{..}
            | Command::SongLearningEvidence{..}
            | Command::InspectSong { .. }
            | Command::InspectSongs { .. }
            | Command::LibraryGroup { .. }
            | Command::RemoveLibraryGroup { .. }
            | Command::AssignLibrary { .. }
            | Command::UnassignLibrary { .. }
            | Command::LibraryMetadataHistory { .. } | Command::PreviewMetadataRestore { .. } | Command::RestoreLibraryMetadata { .. }
            | Command::PreviewLibraryMetadata { .. }
            | Command::ReadLibraryMetadata { .. }
            | Command::SaveLibraryMetadata { .. }
            | Command::UpdateSongMetadata { .. } => unreachable!(),
            Command::DiscoverSynthesiaMetadata { .. } | Command::PreviewDiscoveredSynthesiaMetadata { .. }
            | Command::ImportDiscoveredSynthesiaMetadata { .. }
            | Command::PreviewSynthesiaMetadata { .. } | Command::ImportSynthesiaMetadata { .. } => unreachable!("library import uses the background library lane"),
            Command::LibraryFolders
            | Command::RefreshLibrary
            | Command::RemoveLibraryFolder { .. } => return Err("曲库文件夹管理由应用处理".into()),
            Command::ReadMetadataDefaults => {
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                return serde_json::to_value(metadata_defaults::view(&self.annotation_path(file)?, &file.content_id)?).map_err(|e|e.to_string());
            }
            Command::ResetMetadataDefaults { fields, expected, proof } => {
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                let result = metadata_defaults::reset(&self.data, &self.annotation_path(file)?, &file.content_id, fields, expected, &proof)?;
                if result["status"] == "saved" {
                    self.title = result["value"]["title"].as_str().unwrap_or(&file.name).to_owned();
                }
                return Ok(result);
            }
            Command::Metadata => return serde_json::to_value(self.current_metadata()?).map_err(|error|error.to_string()),
            Command::SetMetadata { value } => return self.save_current_metadata(value, None),
            Command::EditMetadata { value, expected } => return self.save_current_metadata(value, Some(expected)),
            Command::VstEditor => {
                self.vst
                    .as_ref()
                    .ok_or("请先选择 VST3 音源")?
                    .open_editor()
                    .map_err(|e| e.to_string())?;
            }
            Command::LibraryScores{..}=>return Err("请从曲库查看谱面资料".into()),
            Command::PreviewLibraryScoreRoute{path,content_id,id}=>return library_scores::preview_route(&self.data,&path,&content_id,&id),
            Command::CheckLibraryScoreImport{..}=>return Err("请从独立谱面核对调用".into()),
            Command::ManageLibraryScore{path,content_id,kind,id,action,name}=>return self.manage_library_score(path,content_id,kind,id,action,name),
            Command::OpenLibraryScore{path,content_id,kind,id}=>return self.open_library_score(path,content_id,kind,id),
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
            Command::PreviewScoreVersionRoute{id,content_id}=>{
                self.score_content_guard(&content_id)?;
                let file=self.file.as_ref().ok_or("请先选择曲目")?;
                let midi=self.annotation_path(file)?;
                let (versions,_)=library_scores::versions(&self.preferences,&midi,&content_id)?;
                let version=versions.iter().find(|v|v.id==id).ok_or("谱面版本不存在")?;
                let assoc=panthesia_core::library::ScoreAssociation{path:version.path.clone(),content_id:version.content_id.clone()};
                if !panthesia_core::library::verify_score_association(&midi,&assoc).map_err(|e|e.to_string())?{
                    return Err("谱面文件已经改变，请重新导入并检查顺序".into());
                }
                let asset=notation::ScoreAsset::new(panthesia_core::utils::atomic_file::read(&version.path).map_err(|e|e.to_string())?,version.name.clone(),self.source_file.as_deref().unwrap_or(file))?;
                let mut result=asset.route_payload(Some(file));
                result["review"]=serde_json::to_value(self.score_review(&asset)).map_err(|error|error.to_string())?;
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
                return self.map_score_owned(score_mapping::Input {content_id,score_revision,source_fingerprint:None,midi,notes,practice_notation:false});
            }
            Command::UpdateLibraryPaper{..}=>return Err("谱页整理应由独立调用线程执行".into()),
            Command::ExportPracticeBackup{..}|Command::ImportStagedPracticeBackup{..}=>return Err("备份文件应由独立调用线程处理".into()),
            Command::PracticeBackupSnapshot{..}=>return Err("备份快照应由后台任务读取".into()),
            Command::PendingMetadataHistory | Command::ClaimPendingMetadataHistory{..}=>{
                let lock=library_workspace::lock_for(&self.data)?;
                let _guard=lock.lock().map_err(|_|"曲库资料正忙")?;
                let mut workspace=library_workspace::Workspace::load(&self.data)?;
                return match command {
                    Command::PendingMetadataHistory=>metadata_history::pending_rows(&self.data,&mut workspace),
                    Command::ClaimPendingMetadataHistory{source_path,content_id,target_path,..}=>
                        metadata_history::claim_pending(&self.data,&mut workspace,&source_path,&content_id,&target_path),
                    _=>unreachable!(),
                };
            }
            Command::InspectPracticeBackup{..}=>return Err("备份预览应由后台任务读取".into()),
            Command::ApplyPracticeBackup{..}=>return Err("备份导入应由后台任务处理".into()),
            Command::AddLibraryScore{path,content_id,name,bytes,kind,target,..}=>{if kind!="notation"{return Err("谱页操作应由独立调用线程执行".into());}return self.add_library_notation(path,content_id,name,bytes,target);}
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
            Command::Recording { active } => {
                if active && self.recorder.has_take() && !self.recording_saved { return Err("上一段录音尚未保存，请先点击保存录音".into()); }
                self.panic();
                if active {
                    self.ensure_audio()?;
                    self.matcher.reset();
                    self.performance_capture=Default::default();
                    self.recorder.start();
                    self.state.recording=true;
                    self.recording_saved=false;
                    self.recording_path=None;
                    self.state.status = "freePlay".into();
                } else {
                    self.state.recording=false;
                    let smf = match self.recorder.stop() {
                        Ok(smf) => smf,
                        Err(error) => {
                            self.state.status = "ready".into();
                            return Err(error.to_string());
                        }
                    };
                    let directory = self.data.join("recordings");
                    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
                    let timestamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis();
                    let path = directory.join(format!("演奏-{timestamp}.mid"));
                    smf.save(&path).map_err(|e| e.to_string())?;
                    self.recording_saved=true;
                    self.state.mode = "listen".into();
                    self.state.wait = false;
                    self.state.passage = None;
                    let result = self.command(Command::Load {
                        path,
                        title: "自由演奏录音".into(),
                    })?;
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
            Command::Feedback => return self.capture_feedback().prepare(|| Ok(())),
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
                if !["wait", "flow", "listen", "recital", "memory"].contains(&value.as_str()) {
                    return Err("练习模式无效".into());
                }
                if value == "wait" && self.routine.is_none() && self.current_song_expression_goal().is_some_and(|g| g.pedal_offset_ms.is_some()) {
                    return Err("当前曲目设有踏板时机目标；请先关闭该目标，再切换等音模式".into());
                }
                if self.state.mode == value { return Ok(serde_json::json!({"ok":true})); }
                let live_switch = matches!(self.state.mode.as_str(),"wait"|"flow") && matches!(value.as_str(),"wait"|"flow");
                if live_switch && self.state.mode == "flow" {self.panic();self.restore_track_sound();}
                self.state.wait = value == "wait";
                let recital = is_recital_mode(&value);
                self.state.mode = value;
                if recital {
                    self.state.passage = None;
                    self.state.rounds = 1;
                    self.state.adaptive = false;
                }
                if !live_switch { self.reset(if recital { 0. } else { self.state.position }); }
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
                let track = self
                    .config
                    .tracks
                    .iter_mut()
                    .find(|t| t.track_id == id)
                    .ok_or("找不到音轨")?;
                track.player = player;
                track.practice_part = part;
                track.visible = visible;
                self.state.hands = "custom".into();
                self.previous_summary = None;
                self.previous_mode = None;
                self.coach = AdaptiveTempoCoach::default();
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
                let timing = self
                    .previous_summary
                    .as_ref()
                    .map_or_else(|| self.matcher.summary().timing, |s| s.timing);
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
            Command::Metronome { enabled } => self.state.metronome = enabled,
            Command::Latency { milliseconds } => {
                if !(-250..=250).contains(&milliseconds) {
                    return Err("延迟补偿应为 -250 到 250 毫秒".into());
                }
                self.state.latency = milliseconds;
                let key = self.calibration_key();
                self.preferences.calibrations.insert(key, milliseconds);
            }
            Command::Adaptive { enabled } => self.state.adaptive = enabled,
            Command::Load { path, title } => {
                let file = library::read_midi(&path)?;
                self.install(file, title, None)?;
                self.persist()?;
                return self.command(Command::CurrentSong);
            }
            Command::LoadIndexed { path, title, content_id } => {
                let file = library::read_midi(&path)?;
                if file.content_id != content_id {
                    return Err("曲库索引中的文件内容已改变，请重新检查这首曲目".into());
                }
                if self.routine.is_some() { self.stop_routine()?; }
                self.install(file, title, None)?;
                self.persist()?;
                return self.command(Command::CurrentSong);
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
                if is_recital_mode(&self.state.mode) && self.state.status == "ready" {
                    self.state.passage = None;
                    self.reset(0.);
                }
                if self.state.status == "finished" {
                    self.reset(self.state.passage.as_ref().map_or(0., |p| p.start));
                }
                if let Some(p) = &self.state.passage {
                    if self.state.position < p.start || self.state.position >= p.end {
                        self.reset(p.start);
                    }
                }
                if self.session_clock == Duration::ZERO && self.routine.is_none() && !self.ladder.as_ref().is_some_and(|ladder| ladder.active) {
                    if let Some(goal) = self.current_song_expression_goal() {
                        self.validate_current_expression_source(&goal)?;
                    }
                }
                self.begin_play();
            }
            Command::IndexLibrary { .. }
            | Command::IndexStatus
            | Command::PauseIndex
            | Command::ResumeIndex
            | Command::CancelIndex => return Err("请通过后台索引服务执行此命令".into()),
            Command::Tasks | Command::RetrySave | Command::RetrySettingsSave { .. } | Command::ReadStorageStatus | Command::SkipStartupSong | Command::RetryStartup | Command::DismissStartupWarning { .. } | Command::CancelTask { .. } | Command::CancelHistoryRead { .. } | Command::CurrentSong | Command::Session
            | Command::SetSongExpressionGoal{..} | Command::EditSongExpressionGoal { .. } | Command::ReadSongExpressionGoal { .. } | Command::ReadHistoryAnnotation { .. }
            | Command::PassageCatalog{..}|Command::ComposePassages{..}|Command::Routines{..}|Command::SaveRoutine{..}|Command::RemoveRoutine{..}|Command::SaveRoutineItem{..}
            |Command::MoveRoutineItem{..}|Command::RemoveRoutineItem{..}|Command::OpenRoutineItem{..}
            |Command::PreviewTickRange{..}|Command::ApplyTickRange{..}|Command::SaveTickPassage{..}
            |Command::SaveRoutineSchedule{..}|Command::StopRoutine|Command::SkipRoutineItem{..}|Command::ResetRoutineItem{..}
            | Command::LadderPresets
            | Command::SaveLadder{..}
            | Command::UpdateLadderName{..}
            | Command::RemoveLadder{..}
            | Command::StartLadder{..}
            | Command::StopLadder
            | Command::WeakPractice | Command::DueReview{..} | Command::AcceptWeakPractice{..}
            | Command::History
            | Command::HistoryQuery { .. }
            | Command::ReadHistoryPage { .. }
            | Command::EditRoutine { .. }
            | Command::AnnotateHistory { .. }
            | Command::PracticeTime { .. } | Command::PracticeCalendar{..}
            | Command::HistoryPerformance{..}|Command::ReadHistoryPerformance{..}|Command::ReadHistoryDetail{..}|Command::StartHistoryReplay{..}|Command::StartHistoryReplayRange{..}|Command::PlayHistorySource{..}|Command::HistoryReplayControl{..}|Command::HistoryReplayLoop{..}|Command::HistoryProblemNotes{..}|Command::PreviewProblemCuts{..}|Command::PreviewMultiProblemPlan{..}|Command::SaveMultiProblemPlan{..}|Command::PreviewHistoryProblemPlan{..}|Command::SaveHistoryProblemPlan{..}|Command::HistoryReplayClips{..}|Command::ReadHistoryReplayClips{..}|Command::SaveHistoryReplayClip{..}|Command::DeleteHistoryReplayClip{..}
            | Command::HistoryDetail { .. }
            | Command::HistoryOpen { .. }
            | Command::PerformHistoryAction { .. }
            | Command::StartHistoryOperation { .. }
            | Command::ReadHistoryOperation { .. }
            | Command::CancelHistoryOperation { .. }
            | Command::ReleaseHistoryOperation { .. }
            | Command::StartLibraryOpen { .. }
            | Command::ReadLibraryOpen { .. }
            | Command::CancelLibraryOpen { .. }
            | Command::ReleaseLibraryOpen { .. }
                    | Command::HistoryPracticeRange { .. }
                    | Command::HistoryScoreReview { .. }
            | Command::SetLibraryCollection { .. }
            | Command::Collection
            | Command::EditExercisePreset { .. } | Command::DeleteExercisePreset { .. }
            | Command::ResetLibraryMetadataDefaults { .. } | Command::MetadataTemplates | Command::UpdateMetadataTemplate { .. }
            | Command::FileLocations | Command::FileLocationsFor { .. } | Command::UpdateFileLocation { .. }
            | Command::ReadPaperView { .. } | Command::SavePaperView { .. }
            | Command::OpenRecent { .. } => unreachable!(),
            Command::Favorite { enabled } => {
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                self.history
                    .set_favorite(
                        &file.content_id,
                        &self.title,
                        file.source_path.clone(),
                        enabled,
                    )
                    .map_err(|e| e.to_string())?;
            }
            Command::Queue { enabled } => {
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                self.history
                    .set_queued(
                        &file.content_id,
                        &self.title,
                        file.source_path.clone(),
                        enabled,
                    )
                    .map_err(|e| e.to_string())?;
            }
            Command::MoveQueue { direction } => {
                if direction != -1 && direction != 1 {
                    return Err("队列移动方向无效".into());
                }
                let file = self.file.as_ref().ok_or("请先选择曲目")?;
                self.history
                    .move_in_queue(&file.content_id, direction)
                    .map_err(|e| e.to_string())?;
            }
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
                if let Some(run)=&mut self.ladder {if run.active {run.progress.success_streak=0;run.progress.failure_streak=0;run.progress.last_result="重新练习当前速度".into();}}
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
                if enabled && self.routine.is_none() && self.current_song_expression_goal().is_some_and(|g| g.pedal_offset_ms.is_some()) {
                    return Err("当前曲目设有踏板时机目标；请先关闭该目标，再切换等音模式".into());
                }
                if self.state.wait != enabled {
                    self.state.wait = enabled;
                    self.state.mode = if enabled { "wait" } else { "listen" }.into();
                    self.reset(self.state.position);
                }
            }
            Command::Hands { value } => {
                self.previous_summary = None;
                self.previous_mode = None;
                self.coach = AdaptiveTempoCoach::default();
                self.set_hand_scope(&value)?;
                self.reset(self.state.passage.as_ref().map_or(0., |p| p.start));
            }
            Command::Save => {
                if self.pending_saves.is_some() { return Err("请通过后台保存入口保存本轮结果".into()); }
                if is_recital_mode(&self.state.mode) && self.state.status != "finished" {
                    return Err("完整演奏结束后自动保存结果".into());
                }
                self.save()?;
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
            Command::ReadRepertoire { .. } | Command::SongCatalog | Command::EditRepertoire { .. } | Command::InspectNotation { .. } => return Err("作品资料需通过后台任务处理".into()),
            Command::PreviewLegacyExerciseTracks { .. } | Command::ApplyLegacyExerciseTracks { .. }
                | Command::PreviewLegacyExerciseHistory { .. } | Command::ReviewLegacyExerciseHistory { .. } => unreachable!(),
        }
        if persist {
            self.persist()?;
        }
        Ok(serde_json::json!({ "ok": true }))
    }
    fn connect_input(&mut self, name: Option<String>) -> Result<(), String> {
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
    fn output_identity(&self) -> Option<&str> {
        if self.state.output == "内置钢琴" { None }
        else { self.preferences.output.as_deref().or(Some(self.state.output.as_str())) }
    }
    fn calibration_key(&self) -> String {
        // Full plug-in paths distinguish installed instruments with the same display name.
        format!("devices-v2:{}", serde_json::json!([self.state.input, self.output_identity()]))
    }
    fn restore_latency(&mut self) {
        let legacy = format!("{}|{}", self.state.input.as_deref().unwrap_or("computer"), self.state.output);
        self.state.latency = self.preferences.calibrations.get(&self.calibration_key())
            .or_else(|| self.preferences.calibrations.get(&legacy)).copied().unwrap_or(0);
    }
    fn report_input_error(&mut self, message: String) {
        if self.state.error.is_none() || self.state.error == self.input_status_error {
            self.state.error = Some(message.clone());
        }
        self.input_status_error = Some(message);
    }
    fn clear_input_error(&mut self) {
        if self.state.error == self.input_status_error { self.state.error = None; }
        self.input_status_error = None;
    }
    fn check_input(&mut self, catalog: &device_catalog::Catalog) {
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
    fn midi(&mut self, bytes: &[u8]) {
        if self.closing.load(Ordering::Acquire) && !self.recorder.is_recording() { return; }
        // Storage freezes assessment, not the keyboard monitor. In particular,
        // key releases must still reach the instrument while a writer is active.
        if self.storage_busy.load(Ordering::Acquire) && !self.recorder.is_recording() {
            self.state.midi_events+=1;
            if bytes.len()>=3 && matches!(bytes[0]&240,128|144) {
                self.state.pressed.retain(|p|*p!=bytes[1]);
                if bytes[0]&240==144 && bytes[2]>0 {self.state.pressed.push(bytes[1]);}
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
        let input_time=if self.state.latency>=0{self.session_clock.saturating_sub(Duration::from_millis(self.state.latency as u64))}else{self.session_clock+Duration::from_millis((-self.state.latency) as u64)};
        let kind = bytes[0] & 240;
        if let Ok(midi_file::midly::live::LiveEvent::Midi { channel, message }) =
            midi_file::midly::live::LiveEvent::parse(bytes)
        {
            self.recorder.push_event(channel.as_int(), message);
        }
        let note = bytes[1];
        let velocity = bytes[2];
        let performance_input=if self.state.status=="playing" && self.state.mode!="listen" && ((kind==144||kind==128)||kind==176&&note==64){self.performance_capture.input(self.session_clock.as_secs_f64(),input_time.as_secs_f64(),self.state.position,[kind,note,bytes[2]])}else{None};
        if (kind == 144 || kind == 128) && note <= 127 && velocity <= 127 {
            let active = kind == 144 && velocity != 0;
            self.state.pressed.retain(|p| *p != note);
            if active {
                self.state.pressed.push(note);
            }
            if self.state.status == "playing" && self.state.mode != "listen" {
                self.matcher.user_note_with_input(
                    input_time,
                    note,
                    active,
                    velocity,
                    performance_input,
                );
                self.state.saved = false;
                self.state.current_history_id = None;
            }
        }
        if kind == 176 && note == 64 {
            self.state.pedal = velocity;
        }
        if kind == 176 && note == 64 && self.state.status == "playing" {
            self.matcher.user_pedal(input_time, velocity);
        }
        let mut routed=bytes.to_vec();
        if !self.track_routing.lanes.is_empty() && routed[0]<240 {routed[0]&=240;}
        self.send(&routed);
    }
    fn capture_running_time(&mut self,delta:Duration,now:u64){
        self.time_fraction=self.time_fraction.saturating_add(delta);let raw=self.time_fraction.as_millis().min(u128::from(u64::MAX)) as u64;self.time_fraction=self.time_fraction.saturating_sub(Duration::from_millis(raw));if raw==0{return}
        self.state.saved=false;
        self.state.current_history_id=None;
        let ms=raw.min(5_000);self.pending_untracked=self.pending_untracked.saturating_add(raw-ms);
        if now>9_000_000_000_000_000||self.pending_time.len()>=20_000{self.pending_untracked=self.pending_untracked.saturating_add(ms);self.time_connected=false;return}
        let expected=self.time_last_end.and_then(|last|last.checked_add(ms));
        let contiguous=self.time_connected&&expected.is_some_and(|end|end.abs_diff(now)<=2_000)&&raw<=5_000;
        let (mut from,to)=if contiguous{(self.time_last_end.unwrap(),expected.unwrap())}else{(now.saturating_sub(ms),now)};
        if let Some(last)=self.time_last_end{if from<last{let omitted=last.min(to)-from;self.pending_untracked=self.pending_untracked.saturating_add(omitted);from=last;}}
        if from>=to{self.time_connected=false;return}
        let running=to-from;
        if contiguous&&self.pending_time.last().is_some_and(|s|s.to==from){let last=self.pending_time.last_mut().unwrap();last.to=to;last.running_ms=last.running_ms.saturating_add(running);}else{self.pending_time.push(panthesia_core::practice_history::PracticeTimeSlice{from,to,running_ms:running});}
        self.time_last_end=Some(to);self.time_connected=true;
    }
    fn tick(&mut self, delta: Duration) {
        if self.closing.load(Ordering::Acquire) { return; }
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
            let snap = self.snapshot();
            let denominator = self
                .file
                .as_ref()
                .and_then(|f| f.musical_time.measure_at(snap.tick))
                .map_or(4, |m| m.denominator);
            let compound = self
                .file
                .as_ref()
                .and_then(|f| f.musical_time.measure_at(snap.tick))
                .is_some_and(|m| m.denominator == 8 && m.numerator >= 6 && m.numerator % 3 == 0);
            let bpm = snap.bpm * self.state.speed * f64::from(denominator)
                / 4.
                / if compound { 3. } else { 1. };
            let old = self.state.count_remaining.ceil() as usize;
            self.state.count_remaining =
                (self.state.count_remaining - delta.as_secs_f64() * bpm / 60.).max(0.);
            if self.state.count_remaining.ceil() as usize != old {
                self.sound_click(false);
            }
            if self.state.count_remaining == 0. {
                self.state.status = "playing".into();
                self.last_click = None;
            }
            return;
        }
        if self.state.status != "playing" {
            return;
        }
        if self.state.mode!="listen" && !self.state.recording {
            let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis().min(u128::from(u64::MAX)) as u64;
            self.capture_running_time(delta,now);
        }
        let capture_clock=self.session_clock.as_secs_f64();
        let capture_position=self.state.position;
        self.session_clock += delta;
        self.matcher.tick(self.session_clock);
        if self.state.wait && !self.matcher.are_required_notes_pressed() {
            if self.state.mode!="listen" && !self.state.recording {if let Some(file)=&self.file{self.performance_capture.advance(capture_clock,self.session_clock.as_secs_f64(),capture_position,capture_position,self.state.speed,&file.measures,self.state.duration);}}
            return;
        }
        let end = self
            .state
            .passage
            .as_ref()
            .map_or(self.state.duration, |p| p.end);
        let mut position = (self.state.position + delta.as_secs_f64() * self.state.speed).min(end);
        if self.state.wait {
            while self.note_cursor < self.notes.len()
                && self.note_player(
                    self.notes[self.note_cursor].track_id,
                    self.notes[self.note_cursor].index,
                ) != PlayerConfig::Human
            {
                self.note_cursor += 1;
            }
            if let Some(note) = self.notes.get(self.note_cursor) {
                position = position.min(note.start.as_secs_f64().max(self.state.position));
            }
        }
        if self.state.mode!="listen" && !self.state.recording {if let Some(file)=&self.file{self.performance_capture.advance(capture_clock,self.session_clock.as_secs_f64(),capture_position,position,self.state.speed,&file.measures,self.state.duration);}}
        self.state.position = position;
        while self.event_cursor < self.events.len()
            && self.events[self.event_cursor].timestamp.as_secs_f64() <= position + 0.000001
            && (self.state.passage.is_none()
                || self.events[self.event_cursor].timestamp.as_secs_f64() < end)
        {
            let event = self.events[self.event_cursor].clone();
            self.event_cursor += 1;
            if self
                .config
                .tracks
                .iter()
                .any(|t| t.track_id == event.track_id && t.player == PlayerConfig::Mute)
            {
                continue;
            }
            if let midi_file::midly::MidiMessage::Controller { controller, value } = event.message {
                if controller.as_int() == 64 && self.selected(event.track_id) {
                    self.performance_capture.pedal(self.session_clock.as_secs_f64(),event.timestamp.as_secs_f64(),value.as_int());
                    self.matcher.score_pedal(self.session_clock, value.as_int());
                }
            }
            use midi_file::midly::MidiMessage as M;
            let bytes = match event.message {
                M::NoteOn { key, vel } => {
                    if self
                            .event_notes
                            .get(&(
                                event.track_id,
                                event.channel,
                                key.as_int(),
                                event.timestamp,
                                true,
                            ))
                            .is_some_and(|&i| {
                                !note_playback::reference_sounds(self.note_player(event.track_id, i), &self.state.mode)
                            })
                    {
                        continue;
                    }
                    vec![144 | event.channel, key.as_int(), vel.as_int()]
                }
                M::NoteOff { key, vel } => {
                    if self
                            .event_notes
                            .get(&(
                                event.track_id,
                                event.channel,
                                key.as_int(),
                                event.timestamp,
                                false,
                            ))
                            .is_some_and(|&i| {
                                !note_playback::reference_sounds(self.note_player(event.track_id, i), &self.state.mode)
                            })
                    {
                        continue;
                    }
                    vec![128 | event.channel, key.as_int(), vel.as_int()]
                }
                M::Controller { controller, value } => {
                    vec![176 | event.channel, controller.as_int(), value.as_int()]
                }
                M::ProgramChange { program } => vec![192 | event.channel, program.as_int()],
                M::PitchBend { bend } => {
                    let n = bend.0.as_int();
                    vec![224 | event.channel, (n & 127) as u8, (n >> 7) as u8]
                }
                _ => continue,
            };
            self.send_track(event.track_id,&bytes);
        }
        if self.state.mode != "listen" {
            while self.note_cursor < self.notes.len()
                && self.notes[self.note_cursor].start.as_secs_f64() <= position + 0.000001
                && (self.state.passage.is_none()
                    || self.notes[self.note_cursor].start.as_secs_f64() < end)
            {
                let note = self.notes[self.note_cursor].clone();
                self.note_cursor += 1;
                if self.note_player(note.track_id, note.index) == PlayerConfig::Human {
                    let reference=self.performance_capture.target(performance_archive::Reference{at:self.session_clock.as_secs_f64()-((position-note.start.as_secs_f64())/self.state.speed).max(0.),end:self.session_clock.as_secs_f64()-((position-note.start.as_secs_f64())/self.state.speed).max(0.)+note.duration.as_secs_f64()/self.state.speed,pitch:note.note,velocity:note.velocity,measure:self.file.as_ref().map(|f|f.measures.partition_point(|m|*m<=note.start)).unwrap_or(0),song_time:note.start.as_secs_f64(),track:note.track_id});
                    self.matcher.score_target_with_reference(
                        self.session_clock.saturating_sub(Duration::from_secs_f64(
                            ((position - note.start.as_secs_f64()) / self.state.speed).max(0.),
                        )),
                        PracticeTarget {
                            note: note.note,
                            velocity: note.velocity,
                            score_time: note.start,
                            duration: note.duration.div_f64(self.state.speed),
                            track_id: note.track_id,
                            measure: self
                                .file
                                .as_ref()
                                .map(|f| f.measures.partition_point(|m| *m <= note.start))
                                .unwrap_or(0),
                            part: hands::part(
                                &self.config,
                                &self.note_hands,
                                note.track_id,
                                note.index,
                            ),
                        },
                        true,
                        reference,
                    );
                }
            }
        }
        if is_timed_mode(&self.state.mode) {
            self.matcher.finalize_missed(self.session_clock);
        }
        if position >= end && is_timed_mode(&self.state.mode) {
            self.end_hold += delta.as_secs_f64();
            if self.end_hold < 0.5 {
                return;
            }
        }
        if position >= end && (!self.state.wait || self.matcher.are_required_notes_pressed()) {
            self.state.status = "finished".into();
            self.panic();
            self.matcher.finish();
            if self.state.mode != "listen" {
                if self.pending_saves.is_some() {
                    if let Err(error)=self.queue_automatic_round_save() { self.state.error=Some(error); }
                    return;
                }
                if let Err(e) = self.save() {
                    self.state.error = Some(e);
                }
            }
            self.continue_finished_round();
        }
    }
    fn continue_finished_round(&mut self) { self.advance_finished_round(true); }
    fn advance_finished_round(&mut self, resume:bool) {
    if self.state.error.is_none() && self.state.passage.is_some(){self.state.repetitions+=1;}
    let ladder_round=self.ladder.as_ref().is_some_and(|r|r.active);
    if self.state.error.is_none() && ladder_round {
                let target_notes=self.practice_target_count();
                let summary = self.completed_summary();
                let expression_failure = self.expression_failure_for(summary.expression,self.matcher.results(),target_notes);
                if let Some(run)=&mut self.ladder {
                    run.progress.evaluate_with_expression(&run.preset.plan,&summary,target_notes,expression_failure.as_deref());
                    self.state.speed=f64::from(run.progress.speed(&run.preset.plan))/100.;
                    if run.progress.completed||run.progress.limited{run.active=false;}
                }
                if let Err(e)=self.persist(){self.state.error=Some(e);return;}
    }
    if self.state.error.is_none() && self.routine_round_finished(){return;}
    if ladder_round && self.ladder.as_ref().is_some_and(|r|!r.active&&(r.progress.completed||r.progress.limited)){return;}
    if !resume { self.time_connected=false; return; }
    if self.routine.is_some() && self.state.passage.is_none() && !is_recital_mode(&self.state.mode) && self.state.error.is_none(){
        self.reset(0.);self.begin_play();return;
    }
    if let Some(passage) = self.state.passage.clone() {
        if self.state.error.is_none() {
            if self.state.rounds > 0 && self.state.repetitions >= self.state.rounds {
                self.persist()
                    .unwrap_or_else(|e| self.state.error = Some(e));
                return;
            }
            if self.state.adaptive && self.state.mode == "flow" {
                let summary = self.completed_summary();
                let decision = self.coach.evaluate(
                    &summary,
                    self.state.speed as f32,
                    AdaptiveTempoRules::default(),
                );
                self.state.speed = f64::from(decision.speed);
            }
            self.reset(passage.start);
            self.begin_play();
        }
    }
    }
    fn snapshot(&self) -> Snapshot {
        self.prune_round_assessment();
        let mut state = self.state.clone();
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
        state.storage.operation=pending_save::StorageOperation::current(self.storage_id.as_deref(), self.closing.load(Ordering::Acquire));
        state.content_id = self.file.as_ref().map(|file| file.content_id.clone());
        state.score_revision=self.score_revision;
        state.practice_ms=self.session_clock.as_millis().min(u128::from(u64::MAX)) as u64;
        state.ladder = self.ladder.clone();
        state.routine=self.routine_projection();
        state.song_expression_goal=self.current_song_expression_goal();
        state.song_expression_goal_result=self.finished_expression_projection();
        state.song_expression_goal_state = if self.state.status == "finished" && self.active_expression_goal.is_some() && self.routine.is_none() && !self.ladder.as_ref().is_some_and(|run|run.active) {
            Some(if state.song_expression_goal_result.is_some() { ExpressionGoalState::Ready } else if self.storage_id.as_ref().is_some_and(|id|id.starts_with("round-")) { ExpressionGoalState::Pending } else { ExpressionGoalState::Unavailable })
        } else { None };
        state.output_id = self.output_identity().map(str::to_owned);
        state.input_connected = self.input_connected();
        state.note_epoch = self.audio_stop_epoch;
        state.required = self.matcher.required_note_pitches();
        state.score = self.matcher.snapshot();
        state.summary = self.projected_summary();
        state.summary_version = self.summary_version(&state.summary);
        state.recording = self.recorder.is_recording();
        state.record_duration = self.recorder.duration().as_secs_f64();
        if let Some(f) = &self.file {
            state.tick = f.tempo_track.seconds_to_pulses(state.position);
            state.bpm = f.tempo_track.bpm_at_seconds(state.position);
            let display_tick = if state.position >= state.duration {
                (state.tick - 0.000001).max(0.)
            } else {
                state.tick
            };
            if let Some(m) = f.musical_time.measure_at(display_tick) {
                state.measure = m.number;
                state.beat = 1.
                    + (display_tick - m.start_tick as f64)
                        / (f64::from(f.musical_time.ppq) * 4. / f64::from(m.denominator)
                            * if m.denominator == 8 && m.numerator >= 6 && m.numerator % 3 == 0 {
                                3.
                            } else {
                                1.
                            });
            }
        }
        state
    }
}

/// Open the actual output stream without emitting notes, for background
/// validation of the installed audio device and packaged SoundFont.
pub fn validate_soundfont(path: &std::path::Path) -> Result<(), String> {
    audio::Audio::validate_soundfont(path)?;
    if track_sound::presets(path).is_empty() {
        return Err("音色文件缺少可用的旋律音色预设".into());
    }
    Ok(())
}

pub fn probe_audio(soundfont: &std::path::Path) -> Result<(), String> {
    let audio = audio::Audio::open(soundfont)?;
    std::thread::sleep(Duration::from_millis(100));
    audio.stop();
    Ok(())
}

#[cfg(test)]
mod tests {
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
            .command(Command::Load {
                path: midi,
                title: "五指热身".into(),
            })
            .unwrap();
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
    fn pause_after_completion_preserves_saved_result_and_goal_editing() {
        let mut p = player();
        p.session_clock = Duration::from_secs(1);
        p.state.status = "finished".into();
        p.state.saved = true;
        p.expression_attempt_started = true;
        p.command(Command::Pause).unwrap();
        assert_eq!(p.snapshot().status, "finished");
        assert!(p.snapshot().saved);
        p.command(Command::Panic).unwrap();
        assert_eq!(p.snapshot().status, "finished");
        assert!(p.snapshot().saved);
        assert!(p.command(Command::SetSongExpressionGoal { goal: None }).is_ok());
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
        assert_eq!(player.matcher.snapshot().matched_notes, 1);
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
        assert_eq!(player.matcher.snapshot().matched_notes, 1);
        player.input_overflow.store(true, Ordering::Release);
        player.tick(Duration::from_millis(5));
        assert_eq!(player.state.status, "paused");
        assert!(player.state.pressed.is_empty());
    }
    #[test]
    fn result_is_persisted_and_duplicate_save_is_ignored() {
        let mut player = player();
        player.command(Command::Play).unwrap();
        player.tick(Duration::from_millis(5));
        player.midi(&[144, 60, 90]);
        player.command(Command::Save).unwrap();
        player.command(Command::Save).unwrap();
        let id = player.file.as_ref().unwrap().content_id.clone();
        assert_eq!(player.history.song(&id).unwrap().sessions.len(), 1);
        let recovered = PracticeHistoryStore::load(
            player
                .file
                .as_ref()
                .unwrap()
                .source_path
                .as_ref()
                .unwrap()
                .parent()
                .unwrap()
                .join("web-practice-history.ron"),
        );
        assert_eq!(
            recovered.song(&id).unwrap().sessions[0]
                .summary
                .overall
                .matched_notes,
            1
        );
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
        let id = &p.file.as_ref().unwrap().content_id;
        let sessions = &p.history.song(id).unwrap().sessions;
        assert_eq!(sessions.len(), 2);
        assert!(
            sessions
                .iter()
                .all(|s| s.summary.overall.matched_notes == 1)
        );
        assert!(matches!(sessions[0].kind, PracticeSessionKind::Loop { .. }));
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
    fn recent_and_history_use_verified_indexed_renamed_files_and_reject_replacements(){
      let mut p=player();let original=p.preferences_path.parent().unwrap().join("renamed-source.mid");
      std::fs::write(&original,include_bytes!("../assets/five-finger.mid")).unwrap();
      p.command(Command::Load{path:original.clone(),title:"移动曲目".into()}).unwrap();
      p.command(Command::CountIn{bars:0}).unwrap();p.command(Command::Play).unwrap();p.tick(Duration::from_millis(1));p.command(Command::Note{pitch:60,velocity:90,active:true}).unwrap();p.command(Command::Save).unwrap();
      let id=p.file.as_ref().unwrap().content_id.clone();let record=p.history.song(&id).unwrap().sessions.last().unwrap().id.clone().unwrap();
      let moved=original.with_file_name("relocated-source.mid");std::fs::rename(&original,&moved).unwrap();
      library_workspace::execute(Command::InspectSong{path:moved.clone(),force:true},&p.data).unwrap();
      let inventory=p.command(Command::Collection).unwrap();let row=inventory["songs"].as_array().unwrap().iter().find(|r|r["contentId"]==id).unwrap();assert_eq!(row["available"],true);assert_eq!(row["path"],moved.to_string_lossy().to_string());
      let opened=p.command(Command::OpenRecent{content_id:id.clone()}).unwrap();assert_eq!(opened["contentId"],id);assert_eq!(opened["sourcePath"],moved.to_string_lossy().to_string());
      p.command(Command::HistoryOpen{content_id:id.clone(),id:record,restore:true}).unwrap();assert_eq!(p.file.as_ref().unwrap().source_path.as_ref(),Some(&moved));
      std::fs::write(&moved,include_bytes!("../assets/basic-chords.mid")).unwrap();assert!(p.command(Command::OpenRecent{content_id:id}).is_err());
    }
    #[test]
    fn indexed_library_load_rejects_replaced_content_before_switching_song() {
        let mut p = player();
        let previous = p.file.as_ref().unwrap().content_id.clone();
        let path = p.preferences_path.parent().unwrap().join("indexed-selection.mid");
        std::fs::write(&path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let expected = MidiFile::new(&path).unwrap().content_id;
        assert_eq!(library::command_paths(&Command::LoadIndexed {
            path: path.clone(), title: "已索引曲目".into(), content_id: expected.clone(),
        }), vec![path.clone()]);
        std::fs::write(&path, include_bytes!("../assets/basic-chords.mid")).unwrap();
        assert!(p.command(Command::LoadIndexed {
            path: path.clone(), title: "已索引曲目".into(), content_id: expected.clone(),
        }).is_err());
        assert_eq!(p.file.as_ref().unwrap().content_id, previous);
        std::fs::write(&path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let opened = p.command(Command::LoadIndexed {
            path, title: "已索引曲目".into(), content_id: expected.clone(),
        }).unwrap();
        assert_eq!(opened["contentId"], expected);
    }
    #[test]
    fn favorites_queue_and_imported_paths_survive_restart() {
        let mut p = player();
        let first = p.file.as_ref().unwrap().content_id.clone();
        p.command(Command::Favorite { enabled: true }).unwrap();
        p.command(Command::Queue { enabled: true }).unwrap();
        let second_path = p.preferences_path.parent().unwrap().join("chords.mid");
        std::fs::write(&second_path, include_bytes!("../assets/basic-chords.mid")).unwrap();
        p.command(Command::Load {
            path: second_path,
            title: "三和弦".into(),
        })
        .unwrap();
        let second = p.file.as_ref().unwrap().content_id.clone();
        p.command(Command::Queue { enabled: true }).unwrap();
        p.command(Command::MoveQueue { direction: -1 }).unwrap();
        p.command(Command::Volume { value: 0.4 }).unwrap();
        assert!(p.command(Command::Volume { value: 1.1 }).is_err());
        let data = p.preferences_path.parent().unwrap().to_owned();
        drop(p);
        let mut restored = Player::new(data, PathBuf::new(), true);
        restored.restore();
        assert_eq!(restored.state.volume, 0.4);
        assert_eq!(
            restored
                .history
                .song(&first)
                .unwrap()
                .library
                .queue_position,
            Some(1)
        );
        assert_eq!(
            restored
                .history
                .song(&second)
                .unwrap()
                .library
                .queue_position,
            Some(0)
        );
        assert!(restored.history.song(&first).unwrap().library.favorite);
        restored
            .command(Command::OpenRecent { content_id: first })
            .unwrap();
        assert_eq!(restored.notes.len(), 9);
    }
    #[test]
    fn chord_lesson_requires_all_three_pitches() {
        let mut p = player();
        let path = p.preferences_path.parent().unwrap().join("chords.mid");
        std::fs::write(&path, include_bytes!("../assets/basic-chords.mid")).unwrap();
        p.command(Command::Load {
            path,
            title: "三和弦".into(),
        })
        .unwrap();
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
        assert_eq!(p.snapshot().score.matched_notes, 3);
    }
    #[test]
    fn continuous_mode_records_misses_and_structured_measures() {
        let mut p = player();
        p.command(Command::Mode {
            value: "flow".into(),
        })
        .unwrap();
        p.command(Command::Play).unwrap();
        for _ in 0..1500 {
            p.tick(Duration::from_millis(5));
        }
        assert_eq!(p.state.status, "finished");
        assert_eq!(p.snapshot().score.missed_notes, 9);
        assert!(p.state.saved);
        let history_id = p.snapshot().current_history_id.expect("完成后应指向刚保存的成绩");
        let content_id = p.file.as_ref().unwrap().content_id.clone();
        assert!(p.history.song(&content_id).unwrap().sessions.iter().any(|row| row.stable_id() == history_id));
        p.reset(0.);
        assert!(p.snapshot().current_history_id.is_none());
        assert!(!p.previous_summary.as_ref().unwrap().measures.is_empty());
    }
    #[test]
    fn generated_practice_restores_fingers_hand_roles_and_collection() {
        let mut p = player();
        p.command(Command::Generate {
            spec: ExerciseSpec::default(),
        })
        .unwrap();
        let song = p.command(Command::CurrentSong).unwrap();
        let id = p.file.as_ref().unwrap().content_id.clone();
        assert!(
            song["notes"]
                .as_array()
                .unwrap()
                .iter()
                .all(|n| n["finger"].as_u64().is_some())
        );
        assert!(
            p.config
                .tracks
                .iter()
                .any(|t| t.practice_part == PracticePart::LeftHand)
        );
        p.command(Command::Favorite { enabled: true }).unwrap();
        let directory = p.data.clone();
        drop(p);
        let mut restored = Player::new(directory, PathBuf::new(), true);
        restored.restore();
        assert_eq!(restored.file.as_ref().unwrap().content_id, id);
        assert!(restored.history.song(&id).unwrap().library.favorite);
        assert!(
            restored
                .command(Command::OpenRecent { content_id: id })
                .is_ok()
        );
        let exported = restored.command(Command::ExportMidi).unwrap();
        let bytes: Vec<u8> = serde_json::from_value(exported["bytes"].clone()).unwrap();
        assert!(midi_file::midly::Smf::parse(&bytes).is_ok());
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
        assert_eq!(p.matcher.summary().parts[0].part, PracticePart::LeftHand);
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
    fn recording_is_saved_and_reopens_as_playable_midi() {
        let mut p = player();
        let original = p.file.as_ref().unwrap().content_id.clone();
        p.command(Command::Recording { active: true }).unwrap();
        assert_eq!(p.state.mode, "wait");
        assert!(p.command(Command::Play).is_err());
        p.midi(&[144, 60, 99]);
        p.midi(&[176, 64, 127]);
        p.midi(&[128, 60, 0]);
        p.command(Command::Recording { active: false }).unwrap();
        assert_eq!(p.notes.len(), 1);
        assert!(
            p.file
                .as_ref()
                .unwrap()
                .source_path
                .as_ref()
                .unwrap()
                .is_file()
        );
        assert!(!p.snapshot().recording);
        assert_eq!(p.state.mode, "listen");
        p.command(Command::OpenRecent {
            content_id: original,
        })
        .unwrap();
        assert_eq!(p.state.mode, "wait");
        assert!(p.state.wait);
    }
    #[test]
    fn fingering_preview_acceptance_undo_and_content_guard() {
        let mut p = player();
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
    fn generated_annotations_and_score_pair_survive_reopening() {
        let mut p = player();
        p.command(Command::Generate {
            spec: ExerciseSpec::default(),
        })
        .unwrap();
        let id = p.file.as_ref().unwrap().content_id.clone();
        let track = p
            .file
            .as_ref()
            .unwrap()
            .tracks
            .iter()
            .find(|t| !t.notes.is_empty())
            .unwrap()
            .track_id;
        let hint = panthesia_core::library::FingerHint {
            track_id: track,
            note_index: 0,
            finger: 5,
        };
        p.command(Command::ApplyFingers {
            content_id: id.clone(),
            hints: vec![hint],
        })
        .unwrap();
        let xml=br#"<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>"#;
        p.command(Command::PairScore {
            expected: None,            bytes: xml.to_vec(),
            name: "exercise.musicxml".into(),
            content_id: id.clone(),
        })
        .unwrap();
        p.command(Command::OpenRecent { content_id: id }).unwrap();
        assert_eq!(p.saved_hints().unwrap(), vec![hint]);
        assert!(p.notation.is_some());
        let n = &p
            .file
            .as_ref()
            .unwrap()
            .tracks
            .iter()
            .find(|t| t.track_id == track)
            .unwrap()
            .notes[0];
        assert_eq!(p.fingers.get(&(track, n.start, n.note)), Some(&5));
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
        assert_eq!(
            p.matcher
                .summary()
                .parts
                .iter()
                .find(|s| s.part == PracticePart::LeftHand)
                .unwrap()
                .breakdown
                .matched_notes,
            1
        );
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
        let mut reopened=Player::new(data.clone(),PathBuf::new(),true);reopened.command(Command::Load{path:p.file.as_ref().unwrap().source_path.clone().unwrap(),title:"重开目标".into()}).unwrap();assert_eq!(score_attachments::list(&data,&cid).unwrap()["attachments"][0]["annotations"].as_array().unwrap().len(),2);
    }
    #[test]
    fn segmented_meter_preview_save_reopen_and_stale_guard(){
        use panthesia_core::library::{MeasureLength,MeterMap,MeterSegment};
        let mut p=player();let file=p.file.as_ref().unwrap();let id=file.content_id.clone();let path=file.source_path.clone().unwrap();let ppq=u64::from(file.musical_time.ppq);let original=p.grid_signature();let notes:Vec<_>=p.notes.iter().map(|n|(n.start,n.end)).collect();
        assert_eq!(p.command(Command::CurrentSong).unwrap()["grid"], original);
        let value=Some(MeterMap{pickup_ticks:ppq,segments:vec![MeterSegment{measure:1,numerator:3,denominator:4,display_start:Some(0)},MeterSegment{measure:3,numerator:6,denominator:8,display_start:Some(20)}],measure_lengths:vec![MeasureLength{measure:2,ticks:ppq}]});
        let preview=p.command(Command::PreviewMeterMap{content_id:id.clone(),value:value.clone()}).unwrap();assert_eq!(preview["measures"][0]["displayNumber"],0);assert_eq!(preview["measures"][1]["partial"],true);assert_eq!(preview["measures"][2]["displayNumber"],20);assert_eq!(preview["measures"][2]["startTick"],ppq*2);assert_eq!(p.grid_signature(),original);
        let proof=preview["proof"].as_str().unwrap().to_string();p.command(Command::SaveMeterMap{content_id:id.clone(),value:value.clone(),proof:proof.clone()}).unwrap();assert!(p.command(Command::SaveMeterMap{content_id:id.clone(),value:value.clone(),proof}).is_err());
        assert_ne!(p.grid_signature(), original);
        assert_eq!(p.command(Command::CurrentSong).unwrap()["grid"], p.grid_signature());
        p.command(Command::MeasureLoop{start:2,end:2,enabled:true}).unwrap();
        let expected_start=p.file.as_ref().unwrap().tempo_track.pulses_to_duration(ppq).as_secs_f64();
        let expected_end=p.file.as_ref().unwrap().tempo_track.pulses_to_duration(ppq*2).as_secs_f64();
        let passage=p.state.passage.as_ref().unwrap();assert_eq!((passage.start,passage.end),(expected_start,expected_end));
        assert!(p.command(Command::Seek{position:expected_end}).is_err());
        p.command(Command::Seek{position:expected_start}).unwrap();
        p.command(Command::Load{path:path.clone(),title:"reopened".into()}).unwrap();assert_eq!(p.meter_map,value);assert_eq!(p.file.as_ref().unwrap().musical_time.measures[2].display_number,20);assert_eq!(notes,p.notes.iter().map(|n|(n.start,n.end)).collect::<Vec<_>>());
        let exported=p.command(Command::ExportPackage).unwrap();let bytes:Vec<u8>=serde_json::from_value(exported["bytes"].clone()).unwrap();let mut package=piece_package::Package::decode(&bytes).unwrap();assert_eq!(package.manifest.meter_map,value);assert_eq!(package.manifest.version,12);package.manifest.version=11;assert!(package.encode().is_err());
        let preview=p.command(Command::PreviewMeterMap{content_id:id.clone(),value:None}).unwrap();p.command(Command::SaveMeterMap{content_id:id.clone(),value:None,proof:preview["proof"].as_str().unwrap().into()}).unwrap();assert_eq!(p.grid_signature(),original);
        let preview=p.command(Command::PreviewMeterMap{content_id:id.clone(),value:value.clone()}).unwrap();std::fs::write(path,include_bytes!("../assets/basic-chords.mid")).unwrap();assert!(p.command(Command::SaveMeterMap{content_id:id,value,proof:preview["proof"].as_str().unwrap().into()}).is_err());
    }
    #[test]
    fn corrected_meter_preserves_notes_changes_scope_and_restores_original() {
        let mut p = player();
        let original = p.file.as_ref().unwrap().musical_time.clone();
        let id = p.file.as_ref().unwrap().content_id.clone();
        let times: Vec<_> = p.notes.iter().map(|n| (n.start, n.end)).collect();
        let scope = p.practice_scope();
        let meter = panthesia_core::library::MeterCorrection {
            numerator: 3,
            denominator: 4,
            pickup_ticks: u64::from(original.ppq),
        };
        p.command(Command::Meter { value: Some(meter) }).unwrap();
        assert_ne!(p.practice_scope(), scope);
        assert!(p.file.as_ref().unwrap().musical_time.measures[0].partial);
        assert_eq!(
            p.file.as_ref().unwrap().musical_time.measures[0].end_tick,
            u64::from(original.ppq)
        );
        assert_eq!(
            times,
            p.notes.iter().map(|n| (n.start, n.end)).collect::<Vec<_>>()
        );
        assert!(
            p.command(Command::Meter {
                value: Some(panthesia_core::library::MeterCorrection {
                    numerator: 3,
                    denominator: 4,
                    pickup_ticks: u64::from(original.ppq) * 3
                })
            })
            .is_err()
        );
        let path = p.file.as_ref().unwrap().source_path.clone().unwrap();
        p.command(Command::Load {
            path,
            title: "reopened".into(),
        })
        .unwrap();
        assert_eq!(p.meter_correction, Some(meter));
        assert_eq!(p.file.as_ref().unwrap().content_id, id);
        p.command(Command::Meter { value: None }).unwrap();
        assert_eq!(p.practice_scope(), scope);
        assert_eq!(
            p.file.as_ref().unwrap().musical_time.measures.len(),
            original.measures.len()
        );
    }
    #[test]
    fn score_versions_keep_previous_files_and_switch_without_overwriting() {
        let mut p = player();
        let id = p.file.as_ref().unwrap().content_id.clone();
        let xml=br#"<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>"#;
        let file_preview=p.command(Command::PreviewScoreBytesRoute{bytes:xml.to_vec(),name:"待添加谱面".into(),content_id:id.clone()}).unwrap();
        assert_eq!(file_preview["route"]["visits"].as_array().unwrap().len(),1);
        assert_eq!(file_preview["fingerprint"],blake3::hash(xml).to_hex().as_str());
        assert!(file_preview.get("bytes").is_none());
        assert!(p.command(Command::PreviewScoreBytesRoute{bytes:xml.to_vec(),name:"错误曲目".into(),content_id:"wrong".into()}).is_err());
        for name in ["原版谱面", "教学版谱面"] {
            p.command(Command::PairScore {
            expected: None,                bytes: xml.to_vec(),
                name: name.into(),
                content_id: id.clone(),
            })
            .unwrap();
        }
        let rows = p.command(Command::ScoreVersions).unwrap();
        assert_eq!(rows["versions"].as_array().unwrap().len(), 2);
        let first = rows["versions"][0]["id"].as_str().unwrap().to_owned();
        let file = PathBuf::from(rows["versions"][0]["path"].as_str().unwrap());
        let preview=p.command(Command::PreviewScoreVersionRoute{id:first.clone(),content_id:id.clone()}).unwrap();
        assert_eq!(preview["versionId"],first);
        assert_eq!(preview["route"]["visits"].as_array().unwrap().len(),1);
        assert!(preview.get("bytes").is_none());
        p.command(Command::ActivateScore {
            expected: None,            id: first.clone(),
            content_id: id.clone(),
        })
        .unwrap();
        assert_eq!(p.notation.as_deref().unwrap().name, "原版谱面");
        assert!(
            p.command(Command::RemoveScoreVersion {
                id: first.clone(),
                content_id: id.clone()
            })
            .is_err()
        );
        p.command(Command::DetachScore {
            content_id: id.clone(),
        })
        .unwrap();
        assert!(p.notation.is_none());
        let original_preferences_path = p.preferences_path.clone();
        let before_versions = serde_json::to_value(p.preferences.score_versions.get(&id)).unwrap();
        p.preferences_path = p.data.clone();
        assert!(p.command(Command::RenameScoreVersion {
            expected_name: None,            id: first.clone(), content_id: id.clone(), name: "未写入的名称".into(),
        }).is_err());
        assert_eq!(serde_json::to_value(p.preferences.score_versions.get(&id)).unwrap(), before_versions);
        assert!(p.command(Command::RemoveScoreVersion {
            id: first.clone(), content_id: id.clone(),
        }).is_err());
        assert_eq!(serde_json::to_value(p.preferences.score_versions.get(&id)).unwrap(), before_versions);
        p.preferences_path = original_preferences_path;
        std::fs::write(&file,b"changed source").unwrap();
        assert!(p.command(Command::PreviewScoreVersionRoute{id:first.clone(),content_id:id.clone()}).is_err());
        p.command(Command::RemoveScoreVersion {
            id: first,
            content_id: id,
        })
        .unwrap();
        assert!(file.is_file());
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
            .command(Command::ImportScore {
                bytes: include_bytes!("../../panthesia-core/src/score_performance_test.musicxml")
                    .to_vec(),
                name: "lesson.musicxml".into(),
                default_bpm: 100,
            })
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
    fn recital_and_memory_complete_once_without_waiting_and_restore_mode() {
        let mut p = player();
        p.command(Command::CountIn { bars: 0 }).unwrap();
        p.command(Command::MeasureLoop {
            start: 1,
            end: 1,
            enabled: true,
        })
        .unwrap();
        let expected = p.notes.len() as u64;
        for mode in ["recital", "memory"] {
            p.command(Command::Mode { value: mode.into() }).unwrap();
            assert!(p.state.passage.is_none());
            assert!(!p.state.wait);
            assert_eq!(p.state.rounds, 1);
            p.command(Command::Play).unwrap();
            assert!(p.command(Command::SeekMeasure { measure: 1 }).is_err());
            assert!(p.command(Command::Speed { value: 0.6 }).is_err());
            for _ in 0..1000 {
                p.tick(Duration::from_millis(20));
                if p.state.status == "finished" {
                    break;
                }
            }
            assert_eq!(p.state.status, "finished");
            assert!(p.snapshot().measure <= p.file.as_ref().unwrap().musical_time.measures.len());
            assert!(p.state.saved);
            let song = p
                .history
                .song(&p.file.as_ref().unwrap().content_id)
                .unwrap();
            let session = song.sessions.last().unwrap();
            assert_eq!(session.mode.as_deref(), Some(mode));
            assert_eq!(session.summary.overall.missed_notes as u64, expected);
            p.tick(Duration::from_secs(2));
            assert_eq!(p.state.status, "finished");
        }
        let data = p.data.clone();
        drop(p);
        let mut restored = Player::new(data, PathBuf::new(), true);
        restored.restore();
        assert_eq!(restored.state.mode, "memory");
        assert_eq!(restored.state.status, "ready");
        assert!(restored.state.passage.is_none());
    }
    #[test]
    fn history_filters_comparison_and_conditions_survive_restart() {
        let mut p = player();
        p.command(Command::Mode { value: "recital".into() }).unwrap();
        p.command(Command::Speed { value: 0.8 }).unwrap();
        let content_id = p.file.as_ref().unwrap().content_id.clone();
        for speed in [0.8, 0.8, 1.0] {
            p.command(Command::Speed { value: speed }).unwrap();
            p.command(Command::Restart).unwrap();
            p.command(Command::Play).unwrap();
            for _ in 0..1200 {
                p.tick(Duration::from_millis(20));
                if p.state.status == "finished" { break; }
            }
            assert!(p.state.saved);
        }
        let result=p.history_query("五指", "recital", "Both", "whole", 1, 1, 1).unwrap();
        assert_eq!(result["total"],3);
        assert_eq!(result["entries"].as_array().unwrap().len(),1);
        assert_eq!(p.history_query("", "memory", "", "", 0, 0, 50).unwrap()["total"],0);
        let sessions=&p.history.song(&content_id).unwrap().sessions;
        let id=sessions[1].id.clone().unwrap();
        let later=sessions[2].id.clone().unwrap();
        let data=p.data.clone();drop(p);
        let mut p=Player::new(data,PathBuf::new(),true);
        p.restore();
        let detail=p.history_detail(&content_id,&id).unwrap();
        assert_eq!(detail["comparison"]["count"],1);
        assert_eq!(p.history_detail(&content_id,&later).unwrap()["comparison"]["count"],0);
        assert!(detail["context"].is_object());
        p.command(Command::HistoryOpen {content_id:content_id.clone(),id:id.clone(),restore:true}).unwrap();
        assert!((p.state.speed-0.8).abs()<0.0001);
        assert_eq!(p.state.mode,"recital");
        assert_eq!(p.state.status,"ready");
        assert_eq!(p.state.count_in,0);
        let original=p.file.as_ref().unwrap().source_path.clone().unwrap();
        let relocated=original.with_file_name("relocated.mid");
        std::fs::rename(&original,&relocated).unwrap();
        p.command(Command::Load {path:relocated.clone(),title:"已移动的五指练习".into()}).unwrap();
        p.command(Command::HistoryOpen {content_id:content_id.clone(),id:id.clone(),restore:true}).unwrap();
        assert_eq!(p.file.as_ref().unwrap().source_path.as_ref(),Some(&relocated));
        p.command(Command::Meter {value:Some(panthesia_core::library::MeterCorrection {
            numerator:3,denominator:4,pickup_ticks:0
        })}).unwrap();
        let result=p.command(Command::HistoryOpen {content_id,id,restore:true}).unwrap();
        assert!(result["restoreWarning"].as_str().unwrap().contains("未恢复"));
        assert_eq!(p.meter_correction.unwrap().numerator,3);
    }
    #[test]
    fn history_open_refuses_changed_original_file_before_replacing_song() {
        let mut p=player();
        p.command(Command::Play).unwrap();p.tick(Duration::from_millis(10));
        p.command(Command::Note {pitch:60,velocity:90,active:true}).unwrap();
        p.command(Command::Save).unwrap();
        let content_id=p.file.as_ref().unwrap().content_id.clone();
        let id=p.history.song(&content_id).unwrap().sessions.last().unwrap().id.clone().unwrap();
        let path=p.file.as_ref().unwrap().source_path.clone().unwrap();
        std::fs::write(path,b"changed").unwrap();
        assert!(p.command(Command::HistoryOpen {content_id:content_id.clone(),id,restore:true}).is_err());
        assert_eq!(p.file.as_ref().unwrap().content_id,content_id);
    }

    #[test]fn generated_annotations_keep_task_identity_and_restore_changed_cache(){let mut p=player();let spec=ExerciseSpec{tempo_bpm:75,hands:panthesia_core::exercise::ExerciseHands::Right,..Default::default()};p.command(Command::Generate{spec}).unwrap();let cid=p.file.as_ref().unwrap().content_id.clone();let path=p.annotation_path(p.file.as_ref().unwrap()).unwrap();assert_ne!(midi_file::MidiFile::new(&path).unwrap().content_id,cid);let mut metadata=panthesia_core::library::SongMetadata::default();metadata.notes=Some("保留技术练习备注".into());panthesia_core::library::save_song_metadata(&path,&cid,metadata.clone()).unwrap();let sidecar=panthesia_core::library::metadata_sidecar_path(&path);let bytes=std::fs::read(&sidecar).unwrap();p.command(Command::Generate{spec:ExerciseSpec{tempo_bpm:160,repetitions:3,hands:panthesia_core::exercise::ExerciseHands::Left,..spec}}).unwrap();assert_eq!(p.file.as_ref().unwrap().content_id,cid);assert_eq!(p.annotation_path(p.file.as_ref().unwrap()).unwrap(),path);assert_eq!(panthesia_core::library::load_song_metadata(&path,&cid).unwrap(),metadata);let foreign=include_bytes!("../assets/basic-chords.mid");std::fs::write(&path,foreign).unwrap();p.command(Command::Generate{spec}).unwrap();let recovered=p.annotation_path(p.file.as_ref().unwrap()).unwrap();assert_ne!(recovered,path);assert_eq!(std::fs::read(&path).unwrap(),foreign);assert_eq!(std::fs::read(&sidecar).unwrap(),bytes);assert_eq!(panthesia_core::library::load_song_metadata(&recovered,&cid).unwrap(),metadata);p.command(Command::Generate{spec:ExerciseSpec{tempo_bpm:90,..spec}}).unwrap();assert_eq!(p.annotation_path(p.file.as_ref().unwrap()).unwrap(),recovered);}

    #[test]
    fn history_restores_original_generated_variant_and_partial_is_not_mastery() {
        let mut p=player();
        let spec=ExerciseSpec {tempo_bpm:60,repetitions:1,hands:panthesia_core::exercise::ExerciseHands::Right,..Default::default()};
        p.command(Command::Generate {spec}).unwrap();
        p.command(Command::Mode {value:"wait".into()}).unwrap();
        p.command(Command::CountIn {bars:0}).unwrap();
        p.command(Command::Play).unwrap();p.tick(Duration::from_millis(10));
        let pitch=p.snapshot().required[0];
        p.command(Command::Note {pitch,velocity:90,active:true}).unwrap();
        p.command(Command::Save).unwrap();
        let content_id=p.file.as_ref().unwrap().content_id.clone();
        let history=p.history.song(&content_id).unwrap();
        let id=history.sessions.last().unwrap().id.clone().unwrap();
        assert_eq!(history.review_status(u64::MAX).unwrap().mastery_streak,0);
        let notes=p.notes.len();let duration=p.state.duration;
        p.command(Command::Generate {spec:ExerciseSpec {tempo_bpm:120,repetitions:2,..spec}}).unwrap();
        let data=p.data.clone();drop(p);
        let mut p=Player::new(data,PathBuf::new(),true);p.restore();
        p.command(Command::HistoryOpen {content_id,id,restore:true}).unwrap();
        assert_eq!(p.exercise,Some(spec));assert_eq!(p.notes.len(),notes);
        assert!((p.state.duration-duration).abs()<0.0001);
        assert_eq!(p.state.status,"ready");
    }
    #[test]
    fn ladder_advances_from_real_wait_rounds_records_stages_and_checkpoints_restart() {
        let mut p=player();
        let plan=panthesia_core::speed_ladder::SpeedLadderPlan {start_percent:50,target_percent:60,step_percent:10,passes_required:1,accuracy_percent:90,on_time_percent:None,failures_before_step_back:0,attempt_limit:10};
        let saved=p.command(Command::SaveLadder {id:None,name:"左手速度阶梯".into(),start:1,end:1,plan,expression:None}).unwrap();
        let id=saved["id"].as_str().unwrap().to_string();
        p.command(Command::StartLadder {id:id.clone(),resume:false}).unwrap();
        assert_eq!(p.state.speed,0.5);assert_eq!(p.state.status,"ready");
        assert!(p.command(Command::Speed{value:1.}).is_err());
        assert!(p.command(Command::Save).is_err());
        assert!(!p.state.adaptive);assert_eq!(p.state.rounds,0);
        p.command(Command::Play).unwrap();
        for _ in 0..2000 {
            p.tick(Duration::from_millis(10));
            let required=p.snapshot().required;
            for pitch in required {
                p.command(Command::Note{pitch,velocity:90,active:true}).unwrap();
                p.command(Command::Note{pitch,velocity:0,active:false}).unwrap();
            }
            if p.ladder.as_ref().unwrap().progress.total_rounds>=1{break;}
        }
        assert_eq!(p.ladder.as_ref().unwrap().progress.stage,1);
        assert_eq!(p.state.speed,0.6);
        p.command(Command::StopLadder).unwrap();
        let content_id=p.file.as_ref().unwrap().content_id.clone();
        assert_eq!(p.history.song(&content_id).unwrap().review_status(u64::MAX).unwrap().mastery_streak,0);
        let plan=p.ladder.as_ref().unwrap().preset.plan.clone();
        p.command(Command::SaveLadder{id:Some(id.clone()),name:"仅改名保留进度".into(),start:1,end:1,plan,expression:None}).unwrap();
        assert_eq!(p.ladder.as_ref().unwrap().progress.stage,1);
        let data=p.data.clone();let content_id=p.file.as_ref().unwrap().content_id.clone();drop(p);
        let mut p=Player::new(data,PathBuf::new(),true);p.restore();
        assert!(p.ladder.is_none());assert_eq!(p.state.status,"ready");
        p.command(Command::StartLadder{id:id.clone(),resume:true}).unwrap();
        assert_eq!(p.state.speed,0.6);assert_eq!(p.ladder.as_ref().unwrap().progress.total_rounds,1);
        p.command(Command::Play).unwrap();
        for _ in 0..2000 {
            p.tick(Duration::from_millis(10));
            for pitch in p.snapshot().required {
                p.command(Command::Note{pitch,velocity:90,active:true}).unwrap();
                p.command(Command::Note{pitch,velocity:0,active:false}).unwrap();
            }
            if p.ladder.as_ref().unwrap().progress.completed{break;}
        }
        assert!(p.ladder.as_ref().unwrap().progress.completed);
        assert!(!p.ladder.as_ref().unwrap().active);assert_eq!(p.state.status,"finished");
        let history=p.history.song(&content_id).unwrap();assert_eq!(history.sessions.len(),2);
        assert_eq!(history.sessions[0].context.as_ref().unwrap().ladder.as_ref().unwrap().stage,1);
        assert_eq!(history.sessions[1].context.as_ref().unwrap().ladder.as_ref().unwrap().stage,2);
        assert_eq!(history.review_status(u64::MAX).unwrap().mastery_streak,1);
        assert!(p.command(Command::StartLadder{id:id.clone(),resume:true}).is_err());
        p.command(Command::Meter{value:Some(panthesia_core::library::MeterCorrection{numerator:3,denominator:4,pickup_ticks:0})}).unwrap();
        assert!(p.command(Command::StartLadder{id,resume:false}).is_err());
    }
    #[test]
    fn standalone_ladder_expression_grades_resumes_and_exports_with_its_goal() {
        let mut p=player();
        let content_id=p.file.as_ref().unwrap().content_id.clone();
        let plan=panthesia_core::speed_ladder::SpeedLadderPlan{start_percent:70,target_percent:70,step_percent:5,passes_required:1,accuracy_percent:90,on_time_percent:None,failures_before_step_back:0,attempt_limit:5};
        let goal=expression_goal::ExpressionGoal{velocity_difference:Some(50),..Default::default()};
        let id=p.command(Command::SaveLadder{id:None,name:"独立力度阶梯".into(),start:1,end:1,plan:plan.clone(),expression:Some(goal.clone())}).unwrap()["id"].as_str().unwrap().to_string();
        let routine=p.command(Command::SaveRoutine{id:None,day:None,name:"继承阶梯".into(),notes:"".into(),copy_of:None,request_id:None}).unwrap()["id"].as_str().unwrap().to_string();
        let item=p.command(Command::SaveRoutineItem{content_id:None,routine_id:routine.clone(),day:None,id:None,source:Some("ladder".into()),source_id:Some(id.clone()),title:"同条件日课".into(),notes:"".into(),goal:routine_commands::RoutineGoal{expression:None,passes:1,accuracy:90,on_time:None,consecutive:true,attempt_limit:5}}).unwrap()["id"].as_str().unwrap().to_string();
        assert_eq!(p.preferences.routines.iter().find(|r|r.id==routine).unwrap().items.iter().find(|i|i.id==item).unwrap().goal.expression,Some(goal.clone()));
        p.command(Command::StartLadder{id:id.clone(),resume:false}).unwrap();
        p.command(Command::Play).unwrap();
        for _ in 0..2500 {
            p.tick(Duration::from_millis(10));
            for pitch in p.snapshot().required {
                p.command(Command::Note{pitch,velocity:1,active:true}).unwrap();
                p.command(Command::Note{pitch,velocity:0,active:false}).unwrap();
            }
            if p.ladder.as_ref().unwrap().progress.total_rounds>=1 {break;}
        }
        let run=p.ladder.as_ref().unwrap();
        assert_eq!(run.progress.total_rounds,1);
        assert!(!run.progress.completed);
        assert!(run.progress.last_result.contains("力度平均差"));
        assert_eq!(p.history.song(&content_id).unwrap().sessions[0].context.as_ref().unwrap().ladder.as_ref().unwrap().round_passed,Some(false));
        assert_eq!(p.history.song(&content_id).unwrap().review_status(u64::MAX).unwrap().mastery_streak,0);
        let root=p.data.clone();
        p.command(Command::StopLadder).unwrap();drop(p);
        let mut p=Player::new(root,PathBuf::new(),true);p.restore();
        assert_eq!(p.preferences.ladder_presets[&content_id][0].expression,Some(goal.clone()));
        p.command(Command::StartLadder{id:id.clone(),resume:true}).unwrap();
        assert_eq!(p.ladder.as_ref().unwrap().progress.total_rounds,1);
        p.command(Command::Play).unwrap();
        for _ in 0..2500 {
            p.tick(Duration::from_millis(10));
            for pitch in p.snapshot().required {
                p.command(Command::Note{pitch,velocity:90,active:true}).unwrap();
                p.command(Command::Note{pitch,velocity:0,active:false}).unwrap();
            }
            if p.ladder.as_ref().unwrap().progress.completed {break;}
        }
        assert!(p.ladder.as_ref().unwrap().progress.completed);
        let sessions=&p.history.song(&content_id).unwrap().sessions;
        assert_eq!(sessions.len(),2);
        assert_eq!(sessions[1].context.as_ref().unwrap().expression.as_ref().unwrap().velocity_difference,Some(50));
        assert_eq!(sessions[1].context.as_ref().unwrap().ladder.as_ref().unwrap().round_passed,Some(true));
        assert_eq!(p.history.song(&content_id).unwrap().review_status(u64::MAX).unwrap().mastery_streak,1);
        let backup:practice_backup::Backup=serde_json::from_value(p.practice_backup_snapshot(&Default::default()).unwrap()).unwrap();
        let backup=practice_backup::Backup::decode(&backup.encode().unwrap()).unwrap();
        assert_eq!(backup.ladders[&content_id][0].expression,Some(goal.clone()));
        let bytes:Vec<u8>=serde_json::from_value(p.command(Command::ExportPackage).unwrap()["bytes"].clone()).unwrap();
        let package=piece_package::Package::decode(&bytes).unwrap();
        assert_eq!(package.manifest.ladders[0].expression,Some(goal.clone()));
        let mut imported=Player::new(p.data.join("isolated-package-target"),PathBuf::new(),true);
        imported.command(Command::ImportPackage{bytes,policy:"merge".into()}).unwrap();
        assert_eq!(imported.preferences.ladder_presets[&content_id][0].expression,Some(goal.clone()));
        p.command(Command::SaveLadder{id:Some(id.clone()),name:"改名".into(),start:1,end:1,plan:plan.clone(),expression:Some(goal.clone())}).unwrap();
        assert_eq!(p.preferences.ladder_runs[&format!("{content_id}:{id}")].progress.total_rounds,2);
        p.command(Command::SaveLadder{id:Some(id.clone()),name:"取消专项".into(),start:1,end:1,plan,expression:None}).unwrap();
        assert!(!p.preferences.ladder_runs.contains_key(&format!("{content_id}:{id}")));
    }
    fn finish_routine_rounds(p:&mut Player,attempts:u64) {
        p.command(Command::Play).unwrap();
        for _ in 0..2500 {
            p.tick(Duration::from_millis(10));
            for pitch in p.snapshot().required {
                p.command(Command::Note{pitch,velocity:90,active:true}).unwrap();
                p.command(Command::Note{pitch,velocity:0,active:false}).unwrap();
            }
            if p.routine_status().unwrap()["progress"]["attempts"].as_u64().unwrap()>=attempts{break;}
        }
    }
    #[test]
    fn daily_routines_grade_real_rounds_resume_keep_dates_separate_and_preserve_snapshots() {
        let mut p=player();
        p.command(Command::MeasureLoop{start:1,end:1,enabled:true}).unwrap();
        let rid=p.command(Command::SaveRoutine{id:None,day:None,name:"每日练习".into(),notes:"连奏".into(),copy_of:None,request_id:None}).unwrap()["id"].as_str().unwrap().to_string();
        let goal=routine_commands::RoutineGoal{expression:None,passes:2,accuracy:90,on_time:None,consecutive:true,attempt_limit:5};
        let item=p.command(Command::SaveRoutineItem{content_id:None,routine_id:rid.clone(),day:None,id:None,source:Some("current".into()),source_id:None,title:"选段练习".into(),notes:"放松手腕".into(),goal:goal.clone()}).unwrap()["id"].as_str().unwrap().to_string();
        p.command(Command::OpenRoutineItem{routine_id:rid.clone(),day:"2026-10-02".into(),item_id:item.clone(),resume:true}).unwrap();
        assert!(p.command(Command::Speed{value:0.6}).is_err());assert!(p.command(Command::Save).is_err());
        finish_routine_rounds(&mut p,1);
        assert_eq!(p.routine_status().unwrap()["progress"]["passed"],1);assert_eq!(p.routine_status().unwrap()["progress"]["completed"],false);
        p.command(Command::StopRoutine).unwrap();let data=p.data.clone();let content=p.file.as_ref().unwrap().content_id.clone();drop(p);
        let mut p=Player::new(data,PathBuf::new(),true);p.restore();assert!(p.routine.is_none());assert_eq!(p.state.status,"ready");
        p.command(Command::OpenRoutineItem{routine_id:rid.clone(),day:"2026-10-02".into(),item_id:item.clone(),resume:true}).unwrap();
        finish_routine_rounds(&mut p,2);assert_eq!(p.routine_status().unwrap()["progress"]["completed"],true);assert_eq!(p.state.status,"finished");
        let h=p.history.song(&content).unwrap();assert_eq!(h.sessions.len(),2);assert_eq!(h.sessions[0].context.as_ref().unwrap().routine.as_ref().unwrap().day,"2026-10-02");
        p.command(Command::StopRoutine).unwrap();
        p.command(Command::SaveRoutineItem{content_id:None,routine_id:rid.clone(),day:None,id:Some(item.clone()),source:None,source_id:None,title:"模板新目标".into(),notes:"新要求".into(),goal:routine_commands::RoutineGoal{expression:None,passes:3,..goal.clone()}}).unwrap();
        assert_eq!(p.routines("2026-10-02").unwrap()["runs"][0]["routine"]["items"][0]["goal"]["passes"],2);
        let copied=p.command(Command::SaveRoutine{id:None,day:Some("2026-10-04".into()),name:"预览复制".into(),notes:"".into(),copy_of:Some(rid.clone()),request_id:None}).unwrap()["id"].as_str().unwrap().to_string();
        assert_eq!(p.preferences.routines.iter().find(|r|r.id==copied).unwrap().items.len(),1);

        p.command(Command::OpenRoutineItem{routine_id:rid.clone(),day:"2026-10-03".into(),item_id:item.clone(),resume:true}).unwrap();
        assert_eq!(p.routine_status().unwrap()["progress"]["passed"],0);assert_eq!(p.routine_status().unwrap()["goal"]["passes"],3);
        p.command(Command::SkipRoutineItem{routine_id:rid.clone(),day:"2026-10-03".into(),item_id:item.clone(),reason:"今天休息".into()}).unwrap();
        let result=p.routines("2026-10-03").unwrap();assert_eq!(result["runs"][0]["progress"][&item]["skipped"],true);assert_eq!(result["runs"][0]["progress"][&item]["completed"],false);
        p.command(Command::RemoveRoutine{id:rid}).unwrap();assert_eq!(p.routines("2026-10-02").unwrap()["runs"][0]["progress"][&item]["completed"],true);
    }
    #[test]
    fn routine_ladder_snapshot_survives_removal_of_original_and_completes_from_actual_grading() {
        let mut p=player();
        let ladder=p.command(Command::SaveLadder{id:None,name:"单级阶梯".into(),start:1,end:1,plan:panthesia_core::speed_ladder::SpeedLadderPlan{start_percent:80,target_percent:80,step_percent:5,passes_required:1,accuracy_percent:90,on_time_percent:None,failures_before_step_back:0,attempt_limit:5},expression:None}).unwrap()["id"].as_str().unwrap().to_string();
        let rid=p.command(Command::SaveRoutine{id:None,day:None,name:"阶梯日课".into(),notes:"".into(),copy_of:None,request_id:None}).unwrap()["id"].as_str().unwrap().to_string();
        let item=p.command(Command::SaveRoutineItem{content_id:None,routine_id:rid.clone(),day:None,id:None,source:Some("ladder".into()),source_id:Some(ladder.clone()),title:"阶梯项目".into(),notes:"".into(),goal:routine_commands::RoutineGoal{expression:None,passes:1,accuracy:90,on_time:None,consecutive:false,attempt_limit:5}}).unwrap()["id"].as_str().unwrap().to_string();
        p.command(Command::RemoveLadder{id:ladder}).unwrap();
        p.command(Command::OpenRoutineItem{routine_id:rid,day:"2026-10-02".into(),item_id:item,resume:true}).unwrap();
        finish_routine_rounds(&mut p,1);assert_eq!(p.routine_status().unwrap()["progress"]["completed"],true);
        assert!(p.ladder.as_ref().unwrap().progress.completed);assert_eq!(p.state.status,"finished");
    }
    #[test]
    fn daily_ladder_expression_failure_blocks_promotion_and_survives_resume() {
        let mut p=player();
        let content_id=p.file.as_ref().unwrap().content_id.clone();
        let ladder=p.command(Command::SaveLadder{id:None,name:"力度阶梯".into(),start:1,end:1,plan:panthesia_core::speed_ladder::SpeedLadderPlan{start_percent:80,target_percent:80,step_percent:5,passes_required:1,accuracy_percent:90,on_time_percent:None,failures_before_step_back:0,attempt_limit:5},expression:None}).unwrap()["id"].as_str().unwrap().to_string();
        let rid=p.command(Command::SaveRoutine{id:None,day:None,name:"力度阶梯日课".into(),notes:"".into(),copy_of:None,request_id:None}).unwrap()["id"].as_str().unwrap().to_string();
        let expression=expression_goal::ExpressionGoal{velocity_difference:Some(50),..Default::default()};
        let item=p.command(Command::SaveRoutineItem{content_id:None,routine_id:rid.clone(),day:None,id:None,source:Some("ladder".into()),source_id:Some(ladder),title:"力度进阶".into(),notes:"".into(),goal:routine_commands::RoutineGoal{expression:Some(expression.clone()),passes:1,accuracy:90,on_time:None,consecutive:true,attempt_limit:5}}).unwrap()["id"].as_str().unwrap().to_string();
        assert_eq!(p.preferences.routines[0].items[0].goal.expression,Some(expression.clone()));
        p.command(Command::OpenRoutineItem{routine_id:rid.clone(),day:"2026-10-02".into(),item_id:item.clone(),resume:true}).unwrap();
        p.command(Command::Play).unwrap();
        for _ in 0..2500 {
            p.tick(Duration::from_millis(10));
            for pitch in p.snapshot().required {
                p.command(Command::Note{pitch,velocity:1,active:true}).unwrap();
                p.command(Command::Note{pitch,velocity:0,active:false}).unwrap();
            }
            if p.routine_status().unwrap()["progress"]["attempts"]==1 {break;}
        }
        let status=p.routine_status().unwrap();
        assert_eq!(status["progress"]["attempts"],1);
        assert_eq!(status["progress"]["completed"],false);
        assert!(status["progress"]["lastResult"].as_str().unwrap().contains("力度平均差"));
        assert_eq!(p.ladder.as_ref().unwrap().progress.success_streak,0);
        let root=p.data.clone();
        p.command(Command::StopRoutine).unwrap();drop(p);
        let mut p=Player::new(root,PathBuf::new(),true);p.restore();
        assert!(!p.preferences.routines.is_empty(), "routines lost after reopening; error={:?}", p.state.error);
        p.command(Command::OpenRoutineItem{routine_id:rid.clone(),day:"2026-10-02".into(),item_id:item.clone(),resume:true}).unwrap();
        assert_eq!(p.routine_status().unwrap()["progress"]["attempts"],1);
        assert_eq!(p.routine_status().unwrap()["goal"]["expression"]["velocityDifference"],50);
        finish_routine_rounds(&mut p,2);
        assert_eq!(p.routine_status().unwrap()["progress"]["completed"],true);
        let sessions=&p.history.song(&content_id).unwrap().sessions;
        assert_eq!(sessions.len(),2);
        assert_eq!(sessions[1].context.as_ref().unwrap().routine.as_ref().unwrap().expression.as_ref().unwrap().velocity_difference,Some(50));
        let backup:practice_backup::Backup=serde_json::from_value(p.practice_backup_snapshot(&Default::default()).unwrap()).unwrap();
        let restored=practice_backup::Backup::decode(&backup.encode().unwrap()).unwrap();
        assert_eq!(restored.routines.iter().find(|r|r.id==rid).unwrap().items[0].goal.expression,Some(expression));
    }
    #[test]
    fn beat_navigation_uses_pickup_and_real_tempo_and_rejects_invalid_beats() {
        let mut p = player();
        p.command(Command::ImportScore {
            bytes: include_bytes!("../../panthesia-core/src/score_performance_test.musicxml")
                .to_vec(),
            name: "乐谱.musicxml".into(),
            default_bpm: 120,
        })
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

    #[test]
    fn saved_time_ledger_delta_midnight_trim_and_restart(){
        use panthesia_core::practice_history::{PracticeTimeEntry,PracticeTimeSlice};
        let mut p=player();let cid=p.file.as_ref().unwrap().content_id.clone();let midnight=20_000*86_400_000u64;
        p.command(Command::Play).unwrap();p.tick(Duration::from_millis(5));p.midi(&[144,60,90]);p.midi(&[128,60,0]);p.pending_time.clear();p.time_last_end=None;p.time_connected=false;
        p.capture_running_time(Duration::from_millis(1000),midnight+500);p.command(Command::Pause).unwrap();p.command(Command::Save).unwrap();p.command(Command::Save).unwrap();assert_eq!(p.history.time_ledger()[&cid].len(),1);
        assert_eq!(p.practice_time(&cid,midnight-1000,midnight).unwrap()["periodMs"],500);
        assert_eq!(p.practice_time(&cid,midnight,midnight+1000).unwrap()["periodMs"],500);
        p.command(Command::Play).unwrap();p.capture_running_time(Duration::from_millis(700),midnight+2000);p.command(Command::Pause).unwrap();p.command(Command::Save).unwrap();assert_eq!(p.practice_time(&cid,0,9_000_000_000_000_000).unwrap()["totalMs"],1700);assert_eq!(p.history.time_ledger()[&cid].len(),2);
        let example=p.history.song(&cid).unwrap().sessions[0].clone();
        for i in 0..201{let mut record=example.clone();record.id=Some(format!("retention-{i}"));record.recorded_at_unix_ms=midnight+10_000+i*10;let entry=PracticeTimeEntry{saved_at_unix_ms:record.recorded_at_unix_ms,slices:vec![PracticeTimeSlice{from:midnight+10_000+i*10,to:midnight+10_000+i*10+1,running_ms:1}],untracked_ms:0};p.history.record_session_with_time(&cid,"计时",record,entry).unwrap();}
        assert_eq!(p.history.session_count(&cid),200);assert_eq!(p.history.time_ledger()[&cid].len(),203);assert_eq!(p.practice_calendar(midnight-1000,midnight+100_000,Some(&cid)).unwrap()["totalMs"],1901);
        let root=p.data.clone();drop(p);let p=Player::new(root,PathBuf::new(),true);assert_eq!(p.practice_time(&cid,0,9_000_000_000_000_000).unwrap()["totalMs"],1901);assert_eq!(p.practice_time(&cid,0,9_000_000_000_000_000).unwrap()["legacySessions"],0);
        let day=p.history_query_window("","","","",0,0,200,Some(midnight),Some(midnight+86_400_000)).unwrap();assert_eq!(day["total"],200);
    }
    #[test]
    fn saved_practice_time_excludes_pause_count_in_and_survives_reload() {
        let mut p=player();let cid=p.file.as_ref().unwrap().content_id.clone();
        p.state.count_in=1;p.command(Command::Play).unwrap();p.tick(Duration::from_secs(5));
        assert_eq!(p.session_clock,Duration::ZERO);
        p.tick(Duration::from_secs(2));assert_eq!(p.state.position,0.);
        p.command(Command::Pause).unwrap();p.tick(Duration::from_secs(10));
        p.command(Command::Play).unwrap();p.midi(&[144,60,90]);p.midi(&[128,60,0]);p.tick(Duration::from_millis(100));
        p.command(Command::Pause).unwrap();p.command(Command::Save).unwrap();p.command(Command::Save).unwrap();
        let stats=p.practice_time(&cid,0,9_000_000_000_000_000).unwrap();
        let exact=stats["totalMs"].as_u64().unwrap();assert_eq!(exact+stats["untrackedMs"].as_u64().unwrap(),2100);assert_eq!(stats["periodMs"],exact);assert_eq!(stats["retainedSessions"],1);
        let path=p.data.clone();drop(p);let mut reloaded=Player::new(path,PathBuf::new(),true);
        assert_eq!(reloaded.practice_time(&cid,0,9_000_000_000_000_000).unwrap()["totalMs"],exact);
        let mut legacy=reloaded.history.song(&cid).unwrap().sessions[0].clone();legacy.id=Some("old-untimed".into());legacy.playing_ms=None;
        reloaded.history.record_session(&cid,"old",legacy).unwrap();
        let stats=reloaded.practice_time(&cid,0,9_000_000_000_000_000).unwrap();assert_eq!(stats["totalMs"],exact);assert_eq!(stats["unknownSessions"],1);
        assert_eq!(reloaded.practice_time(&cid,0,1).unwrap()["periodMs"],0);
        assert!(reloaded.practice_time(&cid,1,0).is_err());
    }

    #[test]
    fn library_collection_does_not_load_other_song_and_guards_content() {
        let mut p=player();let current=p.file.as_ref().unwrap().content_id.clone();let position=p.state.position;
        let other=p.data.join("other piece.mid");std::fs::write(&other,include_bytes!("../assets/c-major-scale.mid")).unwrap();
        let mut w=library_workspace::Workspace::load(&p.data).unwrap();let e=w.inspect(other.clone(),true).unwrap();w.save(&p.data).unwrap();let cid=e.content_id.unwrap();
        p.command(Command::SetLibraryCollection{path:other.clone(),content_id:cid.clone(),favorite:Some(true),queued:None}).unwrap();
        p.command(Command::SetLibraryCollection{path:other.clone(),content_id:cid.clone(),favorite:None,queued:Some(true)}).unwrap();
        assert!(p.history.song(&cid).unwrap().library.favorite);assert_eq!(p.history.song(&cid).unwrap().library.queue_position,Some(0));
        assert_eq!(p.file.as_ref().unwrap().content_id,current);assert_eq!(p.state.position,position);
        std::fs::write(&other,include_bytes!("../assets/basic-chords.mid")).unwrap();
        assert!(p.command(Command::SetLibraryCollection{path:other.clone(),content_id:cid.clone(),favorite:Some(false),queued:None}).is_err());assert!(p.history.song(&cid).unwrap().library.favorite);
        std::fs::remove_file(&other).unwrap();p.command(Command::SetLibraryCollection{path:other.clone(),content_id:cid.clone(),favorite:None,queued:Some(false)}).unwrap();assert_eq!(p.history.song(&cid).unwrap().library.queue_position,None);
        assert!(p.command(Command::SetLibraryCollection{path:other,content_id:cid,favorite:Some(true),queued:Some(true)}).is_err());
    }

    #[test]
    fn midi_import_keeps_searchable_title_and_personal_metadata_on_repeat() {
        let mut p = player();
        let bytes = include_bytes!("../assets/basic-chords.mid").to_vec();
        let first = p.command(Command::ImportMidi { bytes: bytes.clone(), name: "课堂和弦.mid".into() }).unwrap();
        let path = PathBuf::from(first["sourcePath"].as_str().unwrap());
        let cid = first["contentId"].as_str().unwrap();
        let rows = library::enriched(&[], &p.data);
        assert!(rows.iter().any(|r| r.path == path && r.title == "课堂和弦"));
        let mut sidecar = panthesia_core::library::load_song_sidecar(&path, cid).unwrap();
        sidecar.metadata.title = Some("老师命名的和弦课".into());
        sidecar.metadata.notes = Some("保持共同音".into());
        sidecar.metadata.tags = vec!["课堂".into()];
        sidecar.fingerings = vec![panthesia_core::library::FingerHint { track_id: 0, note_index: 0, finger: 1 }];
        panthesia_core::library::save_song_sidecar(&path, cid, sidecar.clone()).unwrap();
        let second = p.command(Command::ImportMidi { bytes, name: "其他文件名.mid".into() }).unwrap();
        assert_eq!(second["contentId"], first["contentId"]);
        let saved = panthesia_core::library::load_song_sidecar(&path, cid).unwrap();
        assert_eq!(saved.metadata, sidecar.metadata);
        assert_eq!(saved.fingerings, sidecar.fingerings);
        assert!(library::enriched(&[], &p.data).iter().any(|r| r.path == path && r.title == "老师命名的和弦课"));
    }

    #[test]
    fn changed_import_cache_recovers_score_and_midi_without_overwriting() {
        let mut p=player();let xml=br#"<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>"#.to_vec();
        let first=p.command(Command::ImportScore{bytes:xml.clone(),name:"original.musicxml".into(),default_bpm:100}).unwrap();let path=PathBuf::from(first["sourcePath"].as_str().unwrap());let cid=first["contentId"].as_str().unwrap().to_owned();
        let mut annotations=panthesia_core::library::load_song_sidecar(&path,&cid).unwrap();annotations.metadata.notes=Some("teacher".into());annotations.fingerings=vec![panthesia_core::library::FingerHint{track_id:p.file.as_ref().unwrap().tracks.iter().find(|t|!t.notes.is_empty()).unwrap().track_id,note_index:0,finger:3}];panthesia_core::library::save_song_sidecar(&path,&cid,annotations).unwrap();let sidecar=panthesia_core::library::metadata_sidecar_path(&path);let personal=std::fs::read(&sidecar).unwrap();
        let foreign=include_bytes!("../assets/basic-chords.mid");std::fs::write(&path,foreign).unwrap();
        let restored=p.command(Command::ImportScore{bytes:xml.clone(),name:"original.musicxml".into(),default_bpm:100}).unwrap();let restored_path=PathBuf::from(restored["sourcePath"].as_str().unwrap());assert_ne!(path,restored_path);assert_eq!(restored["contentId"],cid);assert_eq!(std::fs::read(&path).unwrap(),foreign);assert_eq!(std::fs::read(&sidecar).unwrap(),personal);assert_eq!(restored["importRecovery"]["carriedAnnotations"],true);assert_eq!(panthesia_core::library::load_song_sidecar(&restored_path,&cid).unwrap().fingerings[0].finger,3);
        assert_eq!(p.command(Command::ImportScore{bytes:xml,name:"original.musicxml".into(),default_bpm:100}).unwrap()["sourcePath"],restored["sourcePath"]);
        let bytes=include_bytes!("../assets/five-finger.mid").to_vec();let midi=p.command(Command::ImportMidi{bytes:bytes.clone(),name:"test.mid".into()}).unwrap();let old=PathBuf::from(midi["sourcePath"].as_str().unwrap());std::fs::write(&old,foreign).unwrap();let recovered=p.command(Command::ImportMidi{bytes:bytes.clone(),name:"test.mid".into()}).unwrap();assert_ne!(recovered["sourcePath"],midi["sourcePath"]);assert_eq!(recovered["contentId"],midi["contentId"]);assert_eq!(std::fs::read(&old).unwrap(),foreign);
        let good=PathBuf::from(recovered["sourcePath"].as_str().unwrap());let broken=panthesia_core::library::metadata_sidecar_path(&good);std::fs::write(&broken,b"broken").unwrap();let next=p.command(Command::ImportMidi{bytes,name:"test.mid".into()}).unwrap();assert_ne!(next["sourcePath"],recovered["sourcePath"]);assert_eq!(std::fs::read(&broken).unwrap(),b"broken");
    }

}
