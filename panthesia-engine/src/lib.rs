mod portable_song;
mod owned_annotations;
#[cfg(test)]
mod unified_asset_tests;
pub mod song_repository;
mod notation_assets;
mod loop_practice;
mod note_guidance;
mod song_audition;
mod library_progress;
mod bookmarks;
pub mod state_order;
pub mod music_import;
mod music_import_receipts;
pub mod package_preview;
pub mod notation_drafts;
pub mod pdf_drafts;
pub mod media_export;
pub mod media_export_cache;
mod background_tasks;
mod device_catalog;
pub use device_catalog::Snapshot as DeviceSnapshot;
mod import_pipeline;
mod catalog_import;
mod load_pipeline;
mod operation_journal;
mod library_operations;
mod song_metadata;
mod metadata_defaults;
mod exercise_assets;
mod finger_annotations;
mod exercise_loading;
mod runtime_request;
mod meter_map;
mod finger_pair;
mod finger_pair_interactions;
mod round_storage;
mod pending_save;
mod settings_storage;
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
mod source_notation;
mod history_reader;
mod json_stream;
mod replay_index;
pub use panthesia_core::manifest_store;
mod file_open;
mod manifest_settings;
mod song_files;
pub use file_open::supported as openable_file;
#[cfg(test)]
mod test_fixtures;
mod song_switch;
mod package_loading;
mod song_document;
mod state_projection;
pub mod live_notes;
mod playback_memory;
pub use state_projection::{StateCursor, StateFrame};
mod practice_conditions;
mod practice_variant;
mod passage_practice;
mod metadata_history;
mod metadata_templates;
pub mod file_locations;
pub mod repertoire;
mod import_storage;
mod library_metadata;
mod synthesia_import;
mod metadata_discovery;
pub use synthesia_import::{ImportOptions as SynthesiaImportOptions, ImportPreview as SynthesiaImportPreview, ImportRow as SynthesiaImportRow};
mod audio;
mod track_sound;
mod track_appearance;
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
mod practice_keys;
mod midi_master_volume;
mod finger_demo;
mod demo_protocol;
mod held_demo;
mod package_commands;
mod piece_package;
mod preferences;
pub mod data_root_lock;
use panthesia_core::{
    exercise::{ExercisePlan, ExerciseSpec},
    practice::{AdaptiveTempoCoach, AttemptSummary},
    song_config::{PlayerConfig, SongConfig},
};
use preferences::{Passage, Preferences};
use std::collections::HashMap;
pub mod library;
pub mod library_monitor;
pub mod library_repairs;
pub mod score_attachments;

use panthesia_music::{MidiFile, MidiNote};
use panthesia_core::{
    panthesia_keyboard::KeyboardRange,
    practice::{PracticeMatcher, PracticePart},
    practice_history::{
        PracticeHistoryStore, SongPracticeSetup,
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
type PlaybackEvents = preferences::Shared<Vec<panthesia_music::MidiEvent>>;
type EventNotes = preferences::Shared<HashMap<panthesia_music::NoteId, usize>>;
type SongFile = preferences::Shared<MidiFile>;
type FingerAssignments = preferences::Shared<HashMap<(usize, Duration, u8), u8>>;
type HandAssignments = preferences::Shared<HashMap<(usize, usize), PracticePart>>;
type OriginalGrid = preferences::Shared<panthesia_music::musical_time::MusicalTime>;

mod protocol;
pub use protocol::Command;
pub use score_review::ScoreReviewExpectation;
pub use score_mapping::Input as ScoreMappingRequest;
pub use history_reader::ReadRequest as HistoryReadRequest;
pub use history_reader::ReadScope as ReadTaskScope;
pub use practice_edit::Request as PracticeRequest;

#[derive(Clone)]
pub struct Engine {
    notation_readers: notation_reader::Store,
    catalog_rows: Arc<Mutex<Option<std::sync::Weak<Mutex<Vec<library::SongRow>>>>>>,
    paper_navigation: Arc<std::sync::atomic::AtomicU64>,
    music_imports: music_import::Store,
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
mod playback_session;
mod playback_adapter;

/// Only bounded control commands may use the reserved service and runtime lane.
pub fn is_control_command(command: &Command) -> bool {
    matches!(command, Command::Panic | Command::Pause | Command::Note { .. }
        | Command::StartInstrumentPreview { .. } | Command::StopSongAudition { .. } | Command::SongAuditionState { .. } | Command::StopFingerDemo { .. } | Command::FingerDemoState | Command::Tasks | Command::CancelTask { .. } | Command::CancelHistoryRead { .. }
        | Command::SkipStartupSong | Command::RetryStartup | Command::DismissStartupWarning { .. })
}

pub fn is_timed_mode(mode: &str) -> bool {
    matches!(mode, "flow" | "recital" | "memory")
}
/// Mainline exposes two modes; any older stored or internal mode reads as listen.
pub(crate) fn public_mode(value: &str) -> &'static str {
    if value == "wait" { "wait" } else { "listen" }
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
    playback: playback_session::PlaybackSession,
    startup: Option<startup::Control>,
    recording_saved: bool,
    recording_path: Option<PathBuf>,
    closing: Arc<AtomicBool>,
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
    events: PlaybackEvents,
    matcher: PracticeMatcher,
    pending_time:PracticeTimeSlices,
    pending_untracked:u64,
    time_fraction:Duration,
    time_connected:bool,
    time_last_end:Option<u64>,
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
    reclaimer: Option<playback_memory::Reclaimer>,
    coach: AdaptiveTempoCoach,
    finger_demo: Option<finger_demo::Demo>,
    song_audition: Option<song_audition::Playback>,
    song_audition_pending: Option<String>,
    cancelled_song_auditions: std::collections::VecDeque<String>,
    cancelled_replay_starts: std::collections::VecDeque<String>,
    audio_stop_epoch: u64,
    recorder: panthesia_core::recorder::FreeplayRecorder,
    data: PathBuf,
    notation: Option<Arc<notation::ScoreAsset>>,
    score_revision: u64,
    located_score_map: Option<Arc<LocatedScoreMap>>,
    score_mapping_epoch: u64,
    vst: Option<panthesia_vst3::Vst3OutputConnection>,
    end_hold: f64,
    previous_mode: Option<String>,
    finger_undo: practice_edit::FingerUndo,
    /// Last manifest projection of per-song preferences: (content id, values).
    manifest_settings: Option<(String, manifest_settings::Projection)>,
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
            playback: Default::default(),
            recording_saved: false,
            recording_path: None,
            closing: Arc::new(AtomicBool::new(false)),
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
    fn annotation_path(&self, file: &MidiFile) -> Result<PathBuf, String> {
        if let Some(path) = &file.source_path {
            if panthesia_core::song_annotations::document_path(path).is_some(){return Ok(path.clone());}
            let owned = song_repository::SongRepository::managed_path(&self.data,&file.content_id)?;
            return Ok(if owned.is_file(){owned}else{path.clone()});
        }
        let root = self.data.join("library/assets/exercises");
        let spec=self.exercise.ok_or("曲目缺少可保存的内容")?;
        let bytes=exercise_assets::canonical_bytes(spec)?;
        let bytes_id=blake3::hash(&bytes).to_hex().to_string();
        Ok(import_storage::store_with_identity(&root,&file.content_id,&bytes_id,&file.content_id,&bytes)?.path)

    }
    fn begin_play(&mut self) {
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
        self.manifest_settings = None;
        if plan.is_none() {
            if let Some(path) = file.source_path.clone() {
                if panthesia_core::song_annotations::document_path(&path).is_none()
                    && !song_repository::SongRepository::managed_path(&self.data, &file.content_id).is_ok_and(|p| p.is_file())
                {
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
    fn grid_signature(&self)->String {let mut grid=self.file.as_deref().map(practice_conditions::grid).unwrap_or_else(||"grid-v1-cbf29ce484222325".into());let variant=self.variant();if variant.active(){grid.push_str(&variant.signature());}grid}
    fn note_player(&self, track: usize, index: usize) -> PlayerConfig {
        playback_adapter::note_player(&self.config, &self.note_hands, &self.state.hands, track, index)
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
    fn send(&mut self, bytes: &[u8]) {
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
    fn save(&mut self) -> Result<(), String> {
        self.state.saved = true;
        self.persist()
    }
    fn reset(&mut self,position:f64) {self.reset_with_sound(position,None);}
    fn reset_with_sound(&mut self,position:f64,prepared:Option<track_sound::Prepared>) {
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
    fn command(&mut self, command: Command) -> Result<serde_json::Value, String> {
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
        if library_workspace::accepts(&command) {
            return library_workspace::execute(command, &self.data);
        }
        if matches!(command, Command::Collection) {
            return self.collection_checked(&||Ok(()));
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
            Command::SetLibraryCollection{path,content_id,favorite,queued} => return self.set_library_collection(path,content_id,*favorite,*queued),
            Command::PracticeTime {content_id,from,to} => return self.practice_time(content_id,*from,*to),
            _ => {}
        }
        let persist = !matches!(
            command,
            Command::Note { .. }
                | Command::Play
                | Command::Pause
                | Command::Panic
                | Command::ExportPackage | Command::ExportPackageFile
                | Command::InspectPackage { .. }
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
        if self.variant().active() && matches!(command,Command::Meter{..}|Command::SaveMeterMap{..}|Command::EditNotePlayback{..}|Command::EditFingersFor{..}) {return Err("请先恢复原始演奏，再修改源谱网格、分手或指法".into());}
        self.state.error = None;
        match command {
            Command::PracticeVariant{content_id,score_revision,value}=>return self.set_variant(&content_id,score_revision,value),
            Command::ExportPracticeVariant=>return self.export_practice_variant(),
            Command::AudioDevices=>return Ok(serde_json::json!({"devices":audio::Audio::devices()?})),
            Command::AudioDevice{..}=>return Err("请使用设备连接流程".into()),
            Command::StartInstrumentPreview{..}|Command::SongPreview{..}|Command::StartSongAudition{..}|Command::StopSongAudition{..}|Command::SongAuditionState{..}=>return Err("请使用曲目预览流程".into()),
            Command::TrackAppearance{id,appearance} => return self.set_track_appearance(id,appearance),
            Command::TrackSound{id,sound} => return self.set_track_sound(id,sound),
            Command::SoundFont { path } => return self.set_soundfont(path),
            Command::ExportPackage | Command::ExportPackageFile => {
                self.command(Command::Pause)?;
                return self.export_piece_package(matches!(command,Command::ExportPackageFile));
            }
            Command::ImportStagedPackage { .. } => return Err("请先预览曲目包".into()),
            Command::InspectPackage { bytes } => {
                let (content_id,mut result)=portable_song::inspect(&bytes,&||Ok(()))?;
                result["existing"] = serde_json::json!(
                    self.history.song(&content_id).is_some()
                        || library_workspace::Workspace::load(&self.data)?
                            .entries
                            .values()
                            .any(|e| e.content_id.as_ref() == Some(&content_id))
                );
                return Ok(result);
            }
            Command::ImportPackage { bytes, policy } => {
                return self.import_portable_package(bytes, policy);
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
                let asset=notation::ScoreAsset::new(panthesia_core::utils::atomic_file::read_dependency(&version.path,panthesia_core::source_score_window::ASSET_LIMIT).map_err(|e|e.to_string())?,version.name.clone(),self.source_file.as_deref().unwrap_or(file))?;
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
            Command::UpdateLibraryPaper{..}=>return Err("谱页整理应由独立调用线程执行".into()),
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
                panthesia_core::library::save_song_sidecar(&path,&file.content_id,annotations).map_err(|e|e.to_string())?;
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
            Command::SongFiles => return self.song_files(),
            Command::EditSongFile { action, path, id, role, stem, label } => {
                let edit = song_files::SongFileEdit::parse(&action, path, id, role, stem, label)?;
                return self.edit_song_file(edit);
            }
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
            Command::IndexLibrary { .. }
            | Command::IndexStatus
            | Command::PauseIndex
            | Command::ResumeIndex
            | Command::CancelIndex => return Err("请通过后台索引服务执行此命令".into()),
            Command::Tasks | Command::RetrySave | Command::RetrySettingsSave { .. } | Command::ReadStorageStatus | Command::SkipStartupSong | Command::RetryStartup | Command::DismissStartupWarning { .. } | Command::CancelTask { .. } | Command::CancelHistoryRead { .. } | Command::CurrentSong | Command::Session
            |Command::PreviewTickRange{..}|Command::ApplyTickRange{..}|Command::SaveTickPassage{..}
            | Command::PracticeTime { .. }
            | Command::StartLibraryOpen { .. }
            | Command::ReadLibraryOpen { .. }
            | Command::CancelLibraryOpen { .. }
            | Command::ReleaseLibraryOpen { .. }
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
            Command::ReadRepertoire { .. } | Command::SongCatalog | Command::EditRepertoire { .. } | Command::InspectNotation { .. } => return Err("作品资料需通过后台任务处理".into()),
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
    fn tick(&mut self, delta: Duration) {
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
    fn continue_finished_round(&mut self) { self.advance_finished_round(true); }
    fn advance_finished_round(&mut self, resume: bool) {
        if self.state.error.is_some() { return; }
        if let Some(passage) = self.state.passage.clone() {
            self.state.repetitions = self.state.repetitions.saturating_add(1);
            if resume && (self.state.rounds == 0 || self.state.repetitions < self.state.rounds) {
                self.reset(passage.start);
                self.begin_play();
            }
        }
    }
    fn snapshot(&self) -> Snapshot {

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
        state.storage.operation=pending_save::StorageOperation::current(self.storage_id.as_deref(), self.closing.load(Ordering::Acquire));
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
    use panthesia_core::practice_history::PracticeSessionKind;
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
        assert!(panthesia_music::midly::Smf::parse(&bytes).is_ok());
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
        let preview=p.command(Command::PreviewScoreVersionRoute{id:first.clone(),content_id:id.clone(),include_document:false}).unwrap();
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
        assert!(p.command(Command::PreviewScoreVersionRoute{id:first.clone(),content_id:id.clone(),include_document:false}).is_err());
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

    #[test]fn generated_annotations_keep_task_identity_and_restore_changed_cache(){let mut p=player();let spec=ExerciseSpec{tempo_bpm:75,hands:panthesia_core::exercise::ExerciseHands::Right,..Default::default()};p.command(Command::Generate{spec}).unwrap();let cid=p.file.as_ref().unwrap().content_id.clone();let path=p.annotation_path(p.file.as_ref().unwrap()).unwrap();assert_ne!(panthesia_music::MidiFile::new(&path).unwrap().content_id,cid);let mut metadata=panthesia_core::library::SongMetadata::default();metadata.notes=Some("保留技术练习备注".into());panthesia_core::library::save_song_metadata(&path,&cid,metadata.clone()).unwrap();let sidecar=panthesia_core::library::metadata_sidecar_path(&path);let bytes=std::fs::read(&sidecar).unwrap();p.command(Command::Generate{spec:ExerciseSpec{tempo_bpm:160,repetitions:3,hands:panthesia_core::exercise::ExerciseHands::Left,..spec}}).unwrap();assert_eq!(p.file.as_ref().unwrap().content_id,cid);assert_eq!(p.annotation_path(p.file.as_ref().unwrap()).unwrap(),path);assert_eq!(panthesia_core::library::load_song_metadata(&path,&cid).unwrap(),metadata);let foreign=include_bytes!("../assets/basic-chords.mid");std::fs::write(&path,foreign).unwrap();p.command(Command::Generate{spec}).unwrap();let recovered=p.annotation_path(p.file.as_ref().unwrap()).unwrap();assert_ne!(recovered,path);assert_eq!(std::fs::read(&path).unwrap(),foreign);assert_eq!(std::fs::read(&sidecar).unwrap(),bytes);assert_eq!(panthesia_core::library::load_song_metadata(&recovered,&cid).unwrap(),metadata);p.command(Command::Generate{spec:ExerciseSpec{tempo_bpm:90,..spec}}).unwrap();assert_eq!(p.annotation_path(p.file.as_ref().unwrap()).unwrap(),recovered);}

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

mod notation_source;
mod notation_reader;
pub use notation_reader::Request as NotationReadRequest;
pub use notation_source::{decode as notation_document,Request as NotationDocumentRequest};

/// Mainline plays in two modes only: continuous (`listen`) and wait-for-key (`wait`).
/// `flow` is accepted as an alias for `listen` because older settings files store it.
fn normalize_mode(command: Command) -> Result<Command, String> {
    match command {
        Command::Mode { value } if value == "flow" => Ok(Command::Mode { value: "listen".into() }),
        Command::Mode { value } if !["wait", "listen"].contains(&value.as_str()) => {
            Err(format!("不支持的练习模式：{value}"))
        }
        command => Ok(command),
    }
}
