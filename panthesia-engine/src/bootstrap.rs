//! Engine composition root: resources are assembled once, then handed to their owners.
use crate::{Engine, Player, Snapshot};
use crate::{
    background_tasks, data_root_lock, device_catalog,
    input_runtime, playback_memory,
    runtime_request, sound_runtime, startup, state_order, storage_control,
};
use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool, mpsc},
    thread,
};

impl Engine {
    pub fn start(
        data: PathBuf,
        data_lock: data_root_lock::DataRootLock,
        soundfont: PathBuf,
        silent: bool,
    ) -> Result<Self, String> {
        Self::start_with_soundfont_fallback(data, data_lock, soundfont, None, silent)
    }
    pub fn start_with_soundfont_fallback(
        data: PathBuf,
        data_lock: data_root_lock::DataRootLock,
        soundfont: PathBuf,
        soundfont_fallback: Option<PathBuf>,
        silent: bool,
    ) -> Result<Self, String> {
        data_lock.matches(&data)?;
        let data = data_lock.root().to_path_buf();
        let data_lock = Arc::new(data_lock);
        let tasks = background_tasks::TaskPool::new(2, 8)?;
        let storage_tasks = tasks.storage_lane(32)?;
        let tool_tasks = tasks.serial_lane("tools", 4)?;
        let devices = device_catalog::Catalog::start()?;
        let player_devices = devices.clone();
        let sound = sound_runtime::Host::start(silent,data.clone())?;
        let player_sound = sound.clone();
        let reclaimer = playback_memory::Reclaimer::start()?;
        let (input_tx, input_rx) = mpsc::sync_channel(4096);
        let input_overflow = Arc::new(AtomicBool::new(false));
        let input = input_runtime::Client::start(
            input_tx.clone(),
            input_overflow.clone(),
            devices.clone(),
            silent,
        )?;
        let player_input = input.clone();
        let engine_data = data.clone();
        let (tx, rx) = mpsc::channel::<runtime_request::Request>();
        let (control_tx, control_rx) = mpsc::channel::<runtime_request::Request>();
        let startup = startup::Control::new();
        let worker_startup = startup.clone();
        let engine_soundfont = soundfont.clone();
        let state_clock = state_order::Clock::new();
        let engine_id: Arc<str> = state_clock.engine_id().into();
        let state = Arc::new(crate::state_projection::StateFeed::new(Snapshot {
            state_order: Some(state_clock.next()),
            startup: startup.status(),
            ..Snapshot::default()
        }));
        let shared = state.clone();
        let storage_busy = Arc::new(AtomicBool::new(true));
        let closing = Arc::new(AtomicBool::new(false));
        let worker_closing = closing.clone();
        let import_busy = storage_busy.clone();
        let runtime_stop = Arc::new(AtomicBool::new(false));
        let runtime = Arc::new(storage_control::RuntimeLifetime {
            stop: runtime_stop.clone(),
            tx: tx.clone(),
        });
        let worker_lock = data_lock.clone();
        thread::spawn(move || {
            let _data_lock = worker_lock;
            let mut player = Player::empty(data, soundfont, silent);
            player.state_clock = Some(state_clock);
            player.sound_host = Some(player_sound);
            player.reclaimer = Some(reclaimer);
            player.input_client = Some(player_input);
            player.input_tx = input_tx;
            player.input_rx = input_rx;
            player.input_overflow = input_overflow;
            player.storage_busy = import_busy;
            player.startup = Some(worker_startup);
            player.closing = worker_closing;
            crate::state_projection::publish(&player, &shared);
            crate::playback_driver::Driver {
                commands: rx,
                controls: control_rx,
                state: shared,
                devices: player_devices,
                stop: runtime_stop,
            }
            .run(player);
        });
        let engine = Self {
            notation_readers: crate::notation_reader::Store::default(),
            paper_navigation: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            engine_id,
            startup,
            devices,
            sound,
            input,
            soundfont: engine_soundfont,
            soundfont_fallback,
            silent,
            imports_in_flight: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            operation_epoch: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            _runtime: runtime,
            closing,
            storage_busy,
            tx,
            control_tx,
            tasks,
            storage_tasks,
            tool_tasks,
            opened: Arc::new(std::sync::Mutex::new(None)),
            songs: Default::default(),
            state,
            data: engine_data,
            _data_lock: data_lock,
        };
        engine.startup_task()?;
        engine.rescan_songs();
        Ok(engine)
    }
}
