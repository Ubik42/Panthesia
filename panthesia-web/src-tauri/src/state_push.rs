//! Push the engine state to the window: one `engine-state` event per changed snapshot.
//! The engine publishes about every 16 ms; unchanged snapshots are not sent again.
use panthesia_engine::Engine;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub fn start(app: AppHandle, engine: Engine) {
    let spawned = std::thread::Builder::new().name("panthesia-state-push".into()).spawn(move || {
        let (mut revision, mut last) = (0, String::new());
        loop {
            let Some((next, snapshot)) = engine.next_state(revision, Duration::from_secs(1)) else { continue };
            revision = next;
            let Ok(text) = serde_json::to_string(&snapshot) else { continue };
            if text != last {
                let _ = app.emit("engine-state", &snapshot);
                last = text;
            }
        }
    });
    if let Err(error) = spawned {
        eprintln!("状态推送线程无法启动：{error}");
    }
}
