//! Bounded playback scheduling. File parsing and persistence remain in workers.
use crate::{Player, Snapshot, device_catalog, pending_save, runtime_request, state_projection};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

const CONTROL_BUDGET: usize = 16;
const INPUT_BUDGET: usize = 512;
const COMMAND_WAIT: Duration = Duration::from_millis(2);
const DEVICE_INTERVAL: Duration = Duration::from_millis(100);
const PUBLISH_INTERVAL: Duration = Duration::from_millis(16);

pub(super) struct Driver {
    pub(super) commands: mpsc::Receiver<runtime_request::Request>,
    pub(super) controls: mpsc::Receiver<runtime_request::Request>,
    pub(super) state: Arc<Mutex<Snapshot>>,
    pub(super) devices: device_catalog::Catalog,
    pub(super) stop: Arc<AtomicBool>,
}

impl Driver {
    pub(super) fn run(self, mut player: Player) {
        let Self {
            commands: rx,
            controls: control_rx,
            state: shared,
            devices,
            stop,
        } = self;
        let mut last = Instant::now();
        let mut device_check = Instant::now();
        let mut sound_check = Instant::now();
        let mut published = Instant::now();
        loop {
            if stop.load(Ordering::Acquire) {
                player.panic();
                break;
            }
            for _ in 0..CONTROL_BUDGET {
                match control_rx.try_recv() {
                    Ok(request) => runtime_request::handle(&mut player, request, &shared),
                    Err(_) => break,
                }
            }
            match rx.recv_timeout(COMMAND_WAIT) {
                Ok(request) => runtime_request::handle(&mut player, request, &shared),
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    player.panic();
                    break;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            let now = Instant::now();
            let gap = now.duration_since(last);
            let running =
                player.state.status == "playing" && !player.storage_busy.load(Ordering::Acquire);
            if running {
                let p = &mut player.state.playback_performance;
                p.max_gap_ms = p.max_gap_ms.max(gap.as_secs_f64() * 1000.);
                if gap > Duration::from_millis(20) {
                    p.late_ticks += 1;
                }
            }
            let work = Instant::now();
            pending_save::tick(&mut player, gap);
            if running {
                player.state.playback_performance.max_tick_ms = player
                    .state
                    .playback_performance
                    .max_tick_ms
                    .max(work.elapsed().as_secs_f64() * 1000.);
            }
            last = now;
            // A controller flood cannot starve transport, cancellation, or state updates.
            for _ in 0..INPUT_BUDGET {
                match player.input_rx.try_recv() {
                    Ok(event) => player.input_event(event),
                    Err(_) => break,
                }
            }
            if sound_check.elapsed() > DEVICE_INTERVAL
                && !player.storage_busy.load(Ordering::Acquire)
            {
                player.check_sound();
                sound_check = now;
            }
            if device_check.elapsed() > DEVICE_INTERVAL
                && !player.storage_busy.load(Ordering::Acquire)
            {
                player.check_input(&devices);
                device_check = now;
            }
            if published.elapsed() >= PUBLISH_INTERVAL {
                let work = Instant::now();
                state_projection::publish(&player, &shared);
                if running {
                    player.state.playback_performance.max_publish_ms = player
                        .state
                        .playback_performance
                        .max_publish_ms
                        .max(work.elapsed().as_secs_f64() * 1000.);
                }
                published = Instant::now();
            }
        }
    }
}
