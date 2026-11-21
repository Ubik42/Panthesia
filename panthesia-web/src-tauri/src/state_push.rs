//! Push the engine state to the window: one `engine-state` event per changed snapshot
//! (the engine's state feed only advances when the content changes).
use panthesia_engine::Engine;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub fn start(app: AppHandle, engine: Engine) {
    let spawned = std::thread::Builder::new().name("panthesia-state-push".into()).spawn(move || {
        let mut revision = 0;
        loop {
            let Some((next, snapshot)) = engine.next_state(revision, Duration::from_secs(1)) else { continue };
            revision = next;
            let _ = app.emit("engine-state", &snapshot);
        }
    });
    if let Err(error) = spawned {
        eprintln!("状态推送线程无法启动：{error}");
    }
}
