//! A recoverable snapshot of preferences and history setup. The storage lane is the sole writer.
use panthesia_core::utils::atomic_file::{self, PendingWrite};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const DIRECTORY: &str = "settings-save-pending";
const LIMIT: u64 = 512_000_000;
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum Target {
    Preferences,
    History,
}
impl Target {
    fn name(self) -> &'static str {
        match self {
            Self::Preferences => "web-preferences.json",
            Self::History => "web-practice-history.ron",
        }
    }
    fn stage(self) -> &'static str {
        match self {
            Self::Preferences => "preferences.next",
            Self::History => "history.next",
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    target: Target,
    before: Option<String>,
    after: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Intent {
    version: u8,
    committed: bool,
    entries: Vec<Entry>,
}
fn folder(data: &Path) -> PathBuf {
    data.join(DIRECTORY)
}
fn plain(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            let mut linked = meta.file_type().is_symlink();
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                linked |= meta.file_attributes() & 0x400 != 0;
            }
            if linked {
                Err(format!(
                    "保存位置包含链接，现有资料未修改：{}",
                    path.display()
                ))
            } else {
                Ok(())
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
fn read(path: &Path) -> Result<Vec<u8>, String> {
    plain(path)?;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| format!("无法读取 {}：{e}", path.display()))?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("练习资料超过保存容量限制".into());
    }
    Ok(bytes)
}
fn hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}
fn fingerprint(path: &Path) -> Result<Option<String>, String> {
    plain(path)?;
    if !path.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    read(path).map(|bytes| Some(hash(&bytes)))
}
pub(super) fn pending(data: &Path) -> bool {
    pending_checked(data).unwrap_or(true)
}
pub(super) fn pending_checked(data: &Path) -> std::io::Result<bool> {
    folder(data).join("intent.json").try_exists()
}
fn clean(data: &Path) {
    // An interrupted cleanup leaves an inert directory, never an active incomplete intent.
    if fs::remove_file(folder(data).join("intent.json")).is_err() {
        return;
    }
    for target in [Target::Preferences, Target::History] {
        let _ = fs::remove_file(folder(data).join(target.stage()));
    }
    let _ = fs::remove_dir(folder(data));
}
fn preserve_incomplete(data: &Path) -> Result<(), String> {
    if !folder(data).try_exists().map_err(|e| e.to_string())? {
        return Ok(());
    }
    plain(&folder(data))?;
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let destination = data.join(format!("settings-save-incomplete-{suffix}"));
    if destination.exists() {
        return Err("待保存资料保留目录已存在".into());
    }
    fs::rename(folder(data), destination).map_err(|e| e.to_string())
}
fn load(data: &Path) -> Result<Intent, String> {
    plain(&folder(data))?;
    let path = folder(data).join("intent.json");
    plain(&path)?;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(8193)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8192 {
        return Err("设置恢复记录超过限制".into());
    }
    let intent: Intent =
        serde_json::from_slice(&bytes).map_err(|e| format!("设置恢复记录无法读取：{e}"))?;
    let valid = |h: &str| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit());
    if intent.version != 1
        || intent.entries.is_empty()
        || intent.entries.len() > 2
        || intent
            .entries
            .iter()
            .any(|e| !valid(&e.after) || e.before.as_ref().is_some_and(|h| !valid(h)))
        || intent.entries.len() == 2 && intent.entries[0].target == intent.entries[1].target
    {
        return Err("设置恢复记录无效，原件已保留".into());
    }
    Ok(intent)
}
fn finish(data: &Path, mut intent: Intent) -> Result<(), String> {
    if intent.committed {
        clean(data);
        return Ok(());
    }
    let mut writes = Vec::new();
    // Validate every staged byte and destination condition before replacing any live file.
    for entry in &intent.entries {
        let bytes = read(&folder(data).join(entry.target.stage()))?;
        if hash(&bytes) != entry.after {
            return Err("待保存设置校验失败，原件已保留".into());
        }
        let current = fingerprint(&data.join(entry.target.name()))?;
        if current.as_deref() == Some(&entry.after) {
            continue;
        }
        if current != entry.before {
            return Err(format!(
                "设置文件已被其他操作改变，未覆盖：{}",
                entry.target.name()
            ));
        }
        writes.push((entry.target, bytes));
    }
    for (target, bytes) in writes {
        atomic_file::write(&data.join(target.name()), &bytes).map_err(|e| e.to_string())?;
    }
    intent.committed = true;
    atomic_file::write(
        &folder(data).join("intent.json"),
        &serde_json::to_vec(&intent).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    clean(data);
    Ok(())
}
pub(super) fn recover(data: &Path) -> Result<(), String> {
    plain(&folder(data))?;
    if pending(data) {
        finish(data, load(data)?)
    } else {
        preserve_incomplete(data)
    }
}
pub(super) fn commit(data: &Path, writes: &[PendingWrite]) -> Result<(), String> {
    if crate::asset_storage::pending(data) || crate::round_storage::pending(data)
        || data
            .join("practice-import-journal.json")
            .try_exists()
            .unwrap_or(true)
    {
        return Err("其他练习资料尚待恢复，已保留当前修改，请重新启动后处理恢复资料".into());
    }
    recover(data)?;
    if pending(data) {
        return Err("上次设置保存尚待清理，请重新启动".into());
    }
    let mut prepared = Vec::new();
    let mut size = 0u64;
    for target in [Target::History, Target::Preferences] {
        if let Some(write) = writes
            .iter()
            .rev()
            .find(|w| w.path == data.join(target.name()))
        {
            size = size.saturating_add(write.bytes.len() as u64);
            if size > LIMIT {
                return Err("练习资料超过保存容量限制".into());
            }
            prepared.push((
                Entry {
                    target,
                    before: fingerprint(&write.path)?,
                    after: hash(&write.bytes),
                },
                &write.bytes,
            ));
        }
    }
    if prepared.len() != writes.len() || prepared.is_empty() {
        return Err("设置保存包含未知或重复的文件位置".into());
    }
    fs::create_dir_all(data).map_err(|e| e.to_string())?;
    fs::create_dir(folder(data)).map_err(|e| e.to_string())?;
    for (entry, bytes) in &prepared {
        atomic_file::write(&folder(data).join(entry.target.stage()), bytes)
            .map_err(|e| e.to_string())?;
    }
    let intent = Intent {
        version: 1,
        committed: false,
        entries: prepared.into_iter().map(|(e, _)| e).collect(),
    };
    atomic_file::write(
        &folder(data).join("intent.json"),
        &serde_json::to_vec(&intent).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if let Err(error) = finish(data, intent) {
        recover(data)
            .map_err(|recovery| format!("设置保存未完成：{error}；恢复未完成：{recovery}"))?;
    }
    Ok(())
}
