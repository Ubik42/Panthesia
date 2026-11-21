//! Push the engine state and the background task list to the window: one `engine-state`
//! event per changed snapshot and one `engine-tasks` event per task change.
use panthesia_engine::Engine;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub fn start(app: AppHandle, engine: Engine) {
    let (task_app, task_engine) = (app.clone(), engine.clone());
    let tasks = std::thread::Builder::new().name("panthesia-task-push".into()).spawn(move || {
        let mut revision = 0;
        loop {
            let Some((next, tasks)) = task_engine.next_tasks(revision, Duration::from_secs(1)) else { continue };
            revision = next;
            let _ = task_app.emit("engine-tasks", &tasks);
        }
    });
    if let Err(error) = tasks {
        eprintln!("任务推送线程无法启动：{error}");
    }
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
