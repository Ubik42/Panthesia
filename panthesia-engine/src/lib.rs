mod notation_assets;
mod loop_practice;
mod note_guidance;
mod bookmarks;
pub mod state_order;
pub mod notation_drafts;
pub mod pdf_drafts;
pub mod media_export;
pub mod media_export_cache;
mod background_tasks;
mod device_catalog;
pub use device_catalog::Snapshot as DeviceSnapshot;
mod load_pipeline;
mod song_metadata;
mod metadata_defaults;
mod exercise_assets;
mod finger_annotations;
mod exercise_loading;
mod runtime_request;
mod meter_map;
mod finger_pair;
mod finger_pair_interactions;
mod storage_status;
mod storage_control;
pub use storage_status::{StorageOperation, StorageStatus};
pub use storage_status::StorageRecovery;
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
mod recent_files;
mod score_open;
mod player;
mod player_commands;
#[cfg(test)]
mod player_tests;
pub(crate) use player::{LocatedScoreMap, Player, PracticeNote};
mod song_audition;
mod data_locks;
mod music_file;
pub mod probe;
pub use file_open::supported as openable_file;
#[cfg(test)]
mod test_fixtures;
mod song_switch;
mod song_document;
mod state_projection;
pub mod live_notes;
mod playback_memory;
pub use state_projection::{StateCursor, StateFrame};
mod practice_conditions;
mod practice_variant;
mod passage_practice;
mod library_scores;
pub mod file_locations;
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
mod score_review;
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
mod preferences;
pub mod data_root_lock;
use panthesia_core::{
    exercise::{ExercisePlan, ExerciseSpec},
    practice::{AdaptiveTempoCoach, AttemptSummary},
    song_config::{PlayerConfig, SongConfig},
};
use preferences::{Passage, Preferences};
use std::collections::HashMap;
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
    paper_navigation: Arc<std::sync::atomic::AtomicU64>,
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
    state: Arc<Mutex<Snapshot>>,
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


mod notation_source;
mod notation_reader;
pub use notation_reader::Request as NotationReadRequest;
pub use notation_source::{decode as notation_document,Request as NotationDocumentRequest};

