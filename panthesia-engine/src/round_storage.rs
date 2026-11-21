//! One round publishes its archive and history/ledger through a recoverable intent.
use panthesia_core::utils::atomic_file;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
const PENDING: &str = "round-save-pending";
const HISTORY: &str = "web-practice-history.ron";
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Artifact {
    name: String,
    before: Option<String>,
    after: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Intent {
    version: u8,
    committed: bool,
    before: Option<String>,
    after: String,
    archive: Option<Artifact>,
}
fn hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
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
                Err(format!("保存位置包含链接，未修改：{}", path.display()))
            } else {
                Ok(())
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
fn fingerprint(path: &Path) -> Result<Option<String>, String> {
    plain(path)?;
    match fs::read(path) {
        Ok(bytes) => Ok(Some(hash(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
fn root(data: &Path) -> PathBuf {
    data.join(PENDING)
}
pub(crate) fn pending(data: &Path) -> bool {
    pending_checked(data).unwrap_or(true)
}
pub(crate) fn pending_checked(data: &Path) -> std::io::Result<bool> {
    root(data).join("intent.json").try_exists()
}
fn validate(data: &Path) -> Result<(), String> {
    plain(&root(data))?;
    plain(&data.join("performance-history"))?;
    plain(&data.join(HISTORY))?;
    Ok(())
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn load(data: &Path) -> Result<Intent, String> {
    validate(data)?;
    let path = root(data).join("intent.json");
    plain(&path)?;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(8193)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8192 {
        return Err("练习保存恢复记录超过限制".into());
    }
    let intent: Intent =
        serde_json::from_slice(&bytes).map_err(|e| format!("练习保存恢复记录无法读取：{e}"))?;
    if intent.version != 1
        || !valid_hash(&intent.after)
        || intent.before.as_ref().is_some_and(|v| !valid_hash(v))
    {
        return Err("练习保存恢复记录无效".into());
    }
    if let Some(a) = &intent.archive {
        if a.name.len() != 69
            || !a.name.ends_with(".json")
            || !a.name.as_bytes()[..64].iter().all(u8::is_ascii_hexdigit)
            || !valid_hash(&a.after)
            || a.before.as_ref().is_some_and(|v| !valid_hash(v))
        {
            return Err("练习回放恢复位置无效".into());
        }
    }
    Ok(intent)
}
fn payload(data: &Path, name: &str, expected: &str) -> Result<Vec<u8>, String> {
    let path = root(data).join(name);
    plain(&path)?;
    let bytes =
        fs::read(&path).map_err(|e| format!("待保存资料无法读取：{}：{e}", path.display()))?;
    if hash(&bytes) != expected {
        return Err(format!(
            "待保存资料校验失败，已保留原件：{}",
            path.display()
        ));
    }
    Ok(bytes)
}
fn cleanup(data: &Path) -> Result<(), String> {
    // Remove the intent first; a later interruption leaves only an inert staging folder.
    fs::remove_file(root(data).join("intent.json")).map_err(|e| e.to_string())?;
    for name in ["history.next", "archive.next"] {
        let path = root(data).join(name);
        if path.is_file() {
            let _ = fs::remove_file(path);
        }
    }
    let _ = fs::remove_dir(root(data));
    Ok(())
}
fn check(path: &Path, before: &Option<String>, after: &str) -> Result<bool, String> {
    let current = fingerprint(path)?;
    if current.as_deref() == Some(after) {
        return Ok(false);
    }
    if &current != before {
        return Err(format!(
            "恢复前资料已被其他操作改变，未覆盖：{}",
            path.display()
        ));
    }
    Ok(true)
}
fn finish(
    data: &Path,
    mut intent: Intent,
    checkpoint: impl Fn(u8) -> Result<(), String>,
) -> Result<(), String> {
    let history = payload(data, "history.next", &intent.after)?;
    let archive = match &intent.archive {
        Some(a) => Some(payload(data, "archive.next", &a.after)?),
        None => None,
    };
    if intent.committed {
        let _ = cleanup(data);
        return Ok(());
    }
    let write_history = check(&data.join(HISTORY), &intent.before, &intent.after)?;
    let write_archive = match &intent.archive {
        Some(a) => check(
            &data.join("performance-history").join(&a.name),
            &a.before,
            &a.after,
        )?,
        None => false,
    };
    if write_archive {
        atomic_file::write(
            &data
                .join("performance-history")
                .join(&intent.archive.as_ref().unwrap().name),
            archive.as_ref().unwrap(),
        )
        .map_err(|e| e.to_string())?;
    }
    checkpoint(1)?;
    if write_history {
        atomic_file::write(&data.join(HISTORY), &history).map_err(|e| e.to_string())?;
    }
    checkpoint(2)?;
    intent.committed = true;
    atomic_file::write(
        &root(data).join("intent.json"),
        &serde_json::to_vec(&intent).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let _ = cleanup(data);
    Ok(())
}
fn preserve_incomplete(data: &Path) -> Result<(), String> {
    if !root(data).try_exists().map_err(|e| e.to_string())? {
        return Ok(());
    }
    plain(&root(data))?;
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let destination = data.join(format!("round-save-incomplete-{suffix}"));
    if destination.exists() {
        return Err("待保存资料保留目录已存在".into());
    }
    fs::rename(root(data), destination).map_err(|e| e.to_string())
}
pub(crate) fn recover(data: &Path) -> Result<(), String> {
    validate(data)?;
    if !pending(data) {
        return preserve_incomplete(data);
    }
    finish(data, load(data)?, |_| Ok(()))
}
/// Queued automatic rounds publish immutable archives before their coalesced history.
/// An interruption before history publication may leave an unreferenced archive;
/// it cannot publish a history record whose archive has not been written.
pub(crate) fn commit_queued(
    data: &Path,
    writes: &[atomic_file::PendingWrite],
) -> Result<(), String> {
    validate(data)?;
    let archive_root = data.join("performance-history");
    let mut settings = Vec::new();
    let mut archives = Vec::new();
    for write in writes {
        if write.path == data.join(HISTORY) || write.path == data.join("web-preferences.json") {
            settings.push(write.clone());
        } else {
            let name = write
                .path
                .file_name()
                .and_then(|v| v.to_str())
                .ok_or("回放保存位置无效")?;
            if write.path.parent() != Some(archive_root.as_path())
                || !name.strip_suffix(".json").is_some_and(valid_hash)
            {
                return Err("保存包含未知的文件位置".into());
            }
            let before = fingerprint(&write.path)?;
            if before.as_ref().is_some_and(|h| h != &hash(&write.bytes)) {
                return Err("相同记录已有不同回放，原件已保留".into());
            }
            archives.push((write, before.is_none()));
        }
    }
    if !archives.is_empty() && !settings.iter().any(|w| w.path == data.join(HISTORY)) {
        return Err("回放保存缺少对应的练习历史".into());
    }
    for (write, missing) in archives {
        if missing {
            atomic_file::write(&write.path, &write.bytes).map_err(|e| e.to_string())?;
        }
    }
    crate::settings_storage::commit(data, &settings)
}

