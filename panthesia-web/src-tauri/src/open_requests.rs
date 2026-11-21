//! Files to open arrive from the command line, a second launch (file association or Ouro)
//! and native drag-and-drop. They are queued here; the front end takes them when it is ready
//! and on each `panthesia://open-requested` event, then opens them through the engine.
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

pub const EVENT: &str = "panthesia://open-requested";
const LIMIT: usize = 32;

#[derive(Default)]
pub struct Queue(Mutex<Vec<PathBuf>>);

/// Openable files among launch arguments, resolved against the launching process's folder.
pub fn from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with("--"))
        .map(|arg| {
            let path = PathBuf::from(arg);
            if path.is_absolute() { path } else { cwd.join(path) }
        })
        .filter(|path| path.is_file() && panthesia_engine::openable_file(path))
        .collect()
}

pub fn push(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    let paths: Vec<_> = paths.into_iter().filter(|p| p.is_file() && panthesia_engine::openable_file(p)).collect();
    if paths.is_empty() {
        return;
    }
    if let Some(queue) = app.try_state::<Queue>() {
        let mut pending = queue.0.lock().unwrap_or_else(|e| e.into_inner());
        pending.extend(paths);
        let excess = pending.len().saturating_sub(LIMIT);
        pending.drain(..excess);
    }
    let _ = app.emit(EVENT, ());
}

/// Bring the existing window forward when another launch hands over its files.
pub fn focus(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn take_open_requests(queue: tauri::State<'_, Queue>) -> Vec<String> {
    std::mem::take(&mut *queue.0.lock().unwrap_or_else(|e| e.into_inner()))
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn launch_arguments_keep_only_existing_openable_files() {
        let dir = std::env::temp_dir().join(format!("panthesia-open-args-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.mid"), b"MThd").unwrap();
        std::fs::write(dir.join("b.txt"), b"x").unwrap();
        let args = ["exe", "--headless-check", "a.mid", "b.txt", "missing.mid"].map(String::from);
        assert_eq!(from_args(&args, &dir), vec![dir.join("a.mid")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
