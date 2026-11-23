//! Song folder index: the user's music folder (e.g. `D:\Music\MIDI`) is scanned when the program
//! starts. Every `.panthesia` song gets a shortcut in the folder's `索引库` subfolder, and all
//! songs (manifests, plus music files no manifest covers) can be searched from the start page.
//! The music folder itself is only read; the index folder belongs to Panthesia: shortcuts there
//! that no longer match a song are removed.
use crate::manifest_store;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

const CONFIG: &str = "song-index.json";
pub const INDEX_FOLDER: &str = "索引库";
const MUSIC: &[&str] = &["mid", "midi", "kar", "musicxml", "mxl", "abc"];
/// Folders that hold tool intermediates rather than songs.
const SKIP_DIRS: &[&str] = &["runs", "node_modules", "__pycache__"];
const FILE_LIMIT: usize = 400_000;
const RESULT_LIMIT: usize = 200;

#[derive(Default, Serialize, Deserialize)]
struct Config {
    root: Option<PathBuf>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: PathBuf,
    pub title: String,
    pub artist: Option<String>,
    /// `manifest`, `midi`, `musicxml` or `abc`.
    pub kind: &'static str,
    /// Folder relative to the music folder, `/`-separated.
    pub folder: String,
    #[serde(skip)]
    haystack: String,
}

#[derive(Default)]
pub struct Index {
    pub root: Option<PathBuf>,
    pub entries: Vec<Entry>,
    pub scanned_at: Option<u64>,
    pub shortcuts: usize,
    pub error: Option<String>,
}
pub type Shared = Arc<RwLock<Index>>;

fn read_config(data: &Path) -> Config {
    panthesia_core::utils::atomic_file::read_limited(&data.join(CONFIG), 64 * 1024)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn configured_root(data: &Path) -> Option<PathBuf> {
    read_config(data).root.filter(|r| r.is_dir())
}

pub fn set_root(data: &Path, root: Option<PathBuf>) -> Result<(), String> {
    let root = match root {
        Some(r) => {
            let r = std::path::absolute(&r).map_err(|e| e.to_string())?;
            if !r.is_dir() {
                return Err(format!("找不到文件夹：{}", r.display()));
            }
            Some(r)
        }
        None => None,
    };
    std::fs::create_dir_all(data).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(&Config { root }).map_err(|e| e.to_string())?;
    panthesia_core::utils::atomic_file::write(&data.join(CONFIG), &bytes).map_err(|e| format!("曲目文件夹设置无法保存：{e}"))
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

/// Walk `root` and build the index. Manifests stand for the music files they list.
pub fn scan(root: &Path) -> Vec<Entry> {
    let index_dir = root.join(INDEX_FOLDER);
    let mut manifests = Vec::new();
    let mut music = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(items) = std::fs::read_dir(&dir) else { continue };
        for item in items.flatten() {
            let path = item.path();
            let name = item.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let Ok(kind) = item.file_type() else { continue };
            if kind.is_dir() {
                if path != index_dir && !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(path);
                }
                continue;
            }
            seen += 1;
            if seen > FILE_LIMIT {
                break;
            }
            let ext = extension(&path);
            if ext == panthesia_core::manifest::EXTENSION {
                manifests.push(path);
            } else if MUSIC.contains(&ext.as_str()) {
                music.push(path);
            }
        }
    }
    let relative = |p: &Path| {
        p.parent()
            .and_then(|d| d.strip_prefix(root).ok())
            .map(|d| d.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default()
    };
    let mut covered: HashSet<PathBuf> = HashSet::new();
    let mut entries = Vec::new();
    for path in manifests {
        let Ok(found) = manifest_store::read(&path) else { continue };
        let m = &found.manifest;
        let dir = path.parent().unwrap_or(root);
        for f in &m.files {
            if f.role == "performance" || f.role == "score" {
                covered.insert(manifest_store::resolve(dir, &f.path));
            }
        }
        let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        // A folder manifest is named after its folder.
        let fallback = if stem.eq_ignore_ascii_case("song") { dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or(stem) } else { stem };
        let title = m.title.clone().filter(|t| !t.trim().is_empty()).unwrap_or(fallback);
        entries.push(entry(path.clone(), title, m.artist.clone(), "manifest", relative(&path)));
    }
    for path in music {
        if covered.contains(&path) {
            continue;
        }
        let title = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let kind = match extension(&path).as_str() {
            "abc" => "abc",
            "musicxml" | "mxl" => "musicxml",
            _ => "midi",
        };
        let folder = relative(&path);
        entries.push(entry(path, title, None, kind, folder));
    }
    entries.sort_by(|a, b| (a.kind != "manifest", &a.title).cmp(&(b.kind != "manifest", &b.title)));
    entries
}

fn entry(path: PathBuf, title: String, artist: Option<String>, kind: &'static str, folder: String) -> Entry {
    let haystack = format!("{} {} {}", title, artist.as_deref().unwrap_or(""), folder).to_lowercase();
    Entry { path, title, artist, kind, folder, haystack }
}

/// Entries whose title, artist or folder contain every word of `query`; manifests first.
pub fn search(entries: &[Entry], query: &str) -> Vec<Entry> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    entries
        .iter()
        .filter(|e| words.iter().all(|w| e.haystack.contains(w.as_str())))
        .take(RESULT_LIMIT)
        .cloned()
        .collect()
}

fn file_name_safe(text: &str) -> String {
    let clean: String = text
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let clean = clean.trim().trim_end_matches('.').to_string();
    let clean: String = clean.chars().take(120).collect();
    if clean.is_empty() { "歌曲".into() } else { clean }
}

/// Bring `root/索引库` in line with the manifests: one shortcut per song, opening it in the
/// program at `launcher`. Returns how many shortcuts the folder holds.
pub fn update_shortcuts(root: &Path, entries: &[Entry], launcher: &Path) -> Result<usize, String> {
    let dir = root.join(INDEX_FOLDER);
    std::fs::create_dir_all(&dir).map_err(|e| format!("索引库文件夹无法创建：{e}"))?;
    let mut wanted = Vec::new();
    let mut names = HashSet::new();
    for e in entries.iter().filter(|e| e.kind == "manifest") {
        let base = file_name_safe(&match &e.artist {
            Some(a) if !a.trim().is_empty() => format!("{} - {}", e.title, a),
            _ => e.title.clone(),
        });
        let mut name = format!("{base}.lnk");
        let mut n = 2;
        while !names.insert(name.to_lowercase()) {
            name = format!("{base} ({n}).lnk");
            n += 1;
        }
        wanted.push((dir.join(&name), e.path.clone()));
    }
    let keep: HashSet<PathBuf> = wanted.iter().map(|(l, _)| l.clone()).collect();
    if let Ok(items) = std::fs::read_dir(&dir) {
        for item in items.flatten() {
            let path = item.path();
            if extension(&path) == "lnk" && !keep.contains(&path) {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    for (link, target) in &wanted {
        write_shortcut(link, launcher, target)?;
    }
    Ok(wanted.len())
}

#[cfg(windows)]
fn write_shortcut(link: &Path, launcher: &Path, target: &Path) -> Result<(), String> {
    let mut shell = mslnk::ShellLink::new(launcher).map_err(|e| format!("快捷方式无法生成：{e}"))?;
    shell.set_arguments(Some(format!("\"{}\"", target.display())));
    shell.set_name(Some(format!("用 Panthesia 打开 {}", target.display())));
    shell.set_icon_location(Some(launcher.display().to_string()));
    let temporary = link.with_extension("lnk.tmp");
    shell.create_lnk(&temporary).map_err(|e| format!("快捷方式无法写入：{e}"))?;
    std::fs::rename(&temporary, link).map_err(|e| format!("快捷方式无法写入：{e}"))
}

#[cfg(not(windows))]
fn write_shortcut(_link: &Path, _launcher: &Path, _target: &Path) -> Result<(), String> {
    Ok(())
}

/// The desktop program, when this process is it; the browser debug service writes no shortcuts.
fn launcher() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let name = exe.file_name()?.to_string_lossy().to_lowercase();
    (name == "panthesia.exe" || name == "panthesia-desktop.exe").then_some(exe)
}

/// Scan the configured folder, refresh the shortcuts and publish the new index.
pub fn refresh(data: &Path, shared: &Shared) -> Value {
    let root = configured_root(data);
    let mut next = Index { root: root.clone(), ..Index::default() };
    if let Some(root) = &root {
        next.entries = scan(root);
        if let Some(exe) = launcher() {
            match update_shortcuts(root, &next.entries, &exe) {
                Ok(n) => next.shortcuts = n,
                Err(e) => next.error = Some(e),
            }
        }
        next.scanned_at = Some(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64));
    }
    let status = status_of(&next);
    if let Ok(mut index) = shared.write() {
        *index = next;
    }
    status
}

pub fn status_of(index: &Index) -> Value {
    json!({
        "root": index.root,
        "songs": index.entries.iter().filter(|e| e.kind == "manifest").count(),
        "files": index.entries.len(),
        "shortcuts": index.shortcuts,
        "scannedAt": index.scanned_at,
        "error": index.error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_matches_every_word_in_title_artist_or_folder() {
        let entries = vec![
            entry("a.panthesia".into(), "Look at the Sky".into(), Some("Porter Robinson".into()), "manifest", "B站".into()),
            entry("b.mid".into(), "七里香".into(), None, "midi", "周杰伦".into()),
        ];
        assert_eq!(search(&entries, "sky porter").len(), 1);
        assert_eq!(search(&entries, "周杰伦 七里").len(), 1);
        assert_eq!(search(&entries, "sky 七里").len(), 0);
        assert_eq!(file_name_safe("a/b: c?"), "a_b_ c_");
    }
}
