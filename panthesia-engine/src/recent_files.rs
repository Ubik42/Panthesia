//! Recently opened files: local practice data, kept in `recent-files.json` under the data root.
use crate::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

const FILE: &str = "recent-files.json";
const LIMIT: usize = 30;
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    path: PathBuf,
    title: String,
    opened_at: u64,
}
#[derive(Default, Serialize, Deserialize)]
struct Store {
    version: u32,
    #[serde(default)]
    items: Vec<Entry>,
}

/// One song, however it was opened: its manifest `X.panthesia` and the music files `X.mid`,
/// `X.musicxml` beside it share folder and name.
fn song_key(path: &Path) -> String {
    path.with_extension("").to_string_lossy().to_lowercase()
}
fn same(a: &Path, b: &Path) -> bool {
    song_key(a) == song_key(b)
}
fn read(data: &Path) -> Store {
    panthesia_core::utils::atomic_file::read(&data.join(FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}
fn write(data: &Path, store: &Store) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    panthesia_core::utils::atomic_file::write(&data.join(FILE), &bytes).map_err(|e| format!("最近打开列表保存失败：{e}"))
}

impl Engine {
    pub(crate) fn remember_recent(&self, path: &Path, title: &str) {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut store = read(&self.data);
        store.version = 1;
        store.items.retain(|e| !same(&e.path, path));
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        store.items.insert(0, Entry { path: path.into(), title: title.into(), opened_at: now });
        store.items.truncate(LIMIT);
        if let Err(error) = write(&self.data, &store) {
            eprintln!("{error}");
        }
    }
    pub(crate) fn recent_files(&self) -> Value {
        let store = read(&self.data);
        // Older lists may hold one song twice (opened by its manifest and by its MIDI).
        let mut seen = std::collections::HashSet::new();
        Value::Array(
            store
                .items
                .iter()
                .filter(|e| seen.insert(song_key(&e.path)))
                .map(|e| json!({"path": e.path, "title": e.title, "openedAt": e.opened_at, "exists": e.path.is_file()}))
                .collect(),
        )
    }
    pub(crate) fn forget_recent(&self, path: &Path) -> Result<Value, String> {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut store = read(&self.data);
        store.items.retain(|e| !same(&e.path, path));
        write(&self.data, &store)?;
        Ok(self.recent_files())
    }
}
