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
fn prepare(data: &Path, archive: Option<(&str, &[u8])>, history: &[u8]) -> Result<Intent, String> {
    if crate::asset_storage::pending(data) || crate::settings_storage::pending(data) { return Err("设置保存尚待恢复，请重新启动后再保存本轮".into()); }
    validate(data)?;
    if data
        .join("practice-import-journal.json")
        .try_exists()
        .map_err(|e| e.to_string())?
    {
        return Err("备份导入尚待恢复，请重新启动完成恢复后再保存练习；现有资料已保留".into());
    }
    if pending(data) {
        let old = load(data)?;
        if !old.committed {
            return Err("上次练习结果尚未恢复，请重新启动后再保存；待保存资料已保留".into());
        }
        finish(data, old, |_| Ok(()))?;
    }
    preserve_incomplete(data)?;
    let before = fingerprint(&data.join(HISTORY))?;
    let mut a = None;
    if let Some((name, bytes)) = archive {
        if name.len() != 69
            || !name.ends_with(".json")
            || !name.as_bytes()[..64].iter().all(u8::is_ascii_hexdigit)
        {
            return Err("练习回放保存位置无效".into());
        }
        let target = data.join("performance-history").join(name);
        let before = fingerprint(&target)?;
        let after = hash(bytes);
        if before.as_ref().is_some_and(|h| h != &after) {
            return Err("相同记录已有不同回放，原件已保留".into());
        }
        a = Some(Artifact {
            name: name.into(),
            before,
            after,
        });
    }
    fs::create_dir_all(data).map_err(|e| e.to_string())?;
    fs::create_dir(root(data)).map_err(|e| e.to_string())?;
    atomic_file::write(&root(data).join("history.next"), history).map_err(|e| e.to_string())?;
    if let Some((_, bytes)) = archive {
        atomic_file::write(&root(data).join("archive.next"), bytes).map_err(|e| e.to_string())?;
    }
    let intent = Intent {
        version: 1,
        committed: false,
        before,
        after: hash(history),
        archive: a,
    };
    atomic_file::write(
        &root(data).join("intent.json"),
        &serde_json::to_vec(&intent).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(intent)
}
pub(crate) fn commit(
    data: &Path,
    archive: Option<(&str, &[u8])>,
    history: &[u8],
) -> Result<(), String> {
    let intent = prepare(data, archive, history)?;
    if let Err(error) = finish(data, intent, |_| Ok(())) {
        recover(data).map_err(|recovery| {
            format!(
                "练习保存未完成：{error}；恢复未完成：{recovery}。待保存资料保留在 {}",
                root(data).display()
            )
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Player,
        history_loading::tests::{archive, seeded},
    };
    use panthesia_core::practice_history::PracticeTimeEntry;
    fn fixture() -> (Player, String, String, Vec<u8>, Vec<u8>) {
        let (player, cid, id) = seeded(false, false);
        let mut session = player.history.snapshot()[&cid].sessions[0].clone();
        session.id = Some("recoverable-round".into());
        let entry = PracticeTimeEntry {
            saved_at_unix_ms: session.recorded_at_unix_ms,
            slices: vec![],
            untracked_ms: 25,
        };
        let candidate = player
            .history
            .stage_session_with_time(&cid, "恢复一轮", session, entry)
            .unwrap()
            .unwrap();
        let mut value = archive(&player, &cid, &id);
        value["id"] = serde_json::json!("recoverable-round");
        let path = crate::performance_archive::path(&player.data, &cid, "recoverable-round");
        let name = path.file_name().unwrap().to_str().unwrap().to_owned();
        (
            player,
            cid,
            name,
            serde_json::to_vec(&value).unwrap(),
            candidate.snapshot_bytes().unwrap(),
        )
    }
    #[test]
    fn round_commit_publishes_both_files_and_cleans_only_staging() {
        let (player, cid, name, a, h) = fixture();
        let old = fs::read(player.data.join(HISTORY)).unwrap();
        commit(&player.data, Some((&name, &a)), &h).unwrap();
        assert_eq!(fs::read(player.data.join(HISTORY)).unwrap(), h);
        assert_eq!(
            fs::read(player.data.join("performance-history").join(name)).unwrap(),
            a
        );
        assert_ne!(old, h);
        assert!(!pending(&player.data));
        assert!(crate::performance_archive::read(&player.data, &cid, "recoverable-round").is_ok());
    }
    #[test]
    fn startup_recovers_each_interruption_without_duplicate_round_or_time() {
        for step in [0, 1, 2] {
            let (player, cid, name, a, h) = fixture();
            let data = player.data.clone();
            let intent = prepare(&data, Some((&name, &a)), &h).unwrap();
            if step > 0 {
                assert!(
                    finish(&data, intent, |at| if at == step {
                        Err("simulated process exit".into())
                    } else {
                        Ok(())
                    })
                    .is_err()
                );
            }
            drop(player);
            let restored = Player::new(data.clone(), PathBuf::new(), true);
            assert_eq!(restored.history.snapshot()[&cid].sessions.len(), 2);
            assert_eq!(
                restored.history.time_ledger()[&cid]["recoverable-round"].untracked_ms,
                25
            );
            assert_eq!(fs::read(data.join(HISTORY)).unwrap(), h);
            assert_eq!(
                fs::read(data.join("performance-history").join(&name)).unwrap(),
                a
            );
            drop(restored);
            let again = Player::new(data.clone(), PathBuf::new(), true);
            assert_eq!(again.history.snapshot()[&cid].sessions.len(), 2);
            assert_eq!(again.history.time_ledger()[&cid].len(), 1);
            assert!(!pending(&data));
        }
    }
    #[test]
    fn changed_history_blocks_startup_writes_and_preserves_unexpected_bytes() {
        let (player, _, name, a, h) = fixture();
        prepare(&player.data, Some((&name, &a)), &h).unwrap();
        let foreign = b"user-edited history, retained exactly";
        fs::write(player.data.join(HISTORY), foreign).unwrap();
        let data = player.data.clone();
        drop(player);
        let mut restored = Player::new(data.clone(), PathBuf::new(), true);
        restored.restore();
        assert!(
            restored
                .state
                .error
                .as_ref()
                .unwrap()
                .contains("已被其他操作改变")
        );
        assert!(restored.history.save().is_err());
        assert_eq!(fs::read(data.join(HISTORY)).unwrap(), foreign);
        assert!(!data.join("performance-history").join(name).exists());
        assert!(pending(&data));
    }
    #[test]
    fn corrupt_payload_is_rejected_before_either_target_changes() {
        let (player, _, name, a, h) = fixture();
        let old = fs::read(player.data.join(HISTORY)).unwrap();
        prepare(&player.data, Some((&name, &a)), &h).unwrap();
        fs::write(root(&player.data).join("archive.next"), b"damaged").unwrap();
        assert!(recover(&player.data).unwrap_err().contains("校验失败"));
        assert_eq!(fs::read(player.data.join(HISTORY)).unwrap(), old);
        assert!(!player.data.join("performance-history").join(name).exists());
        assert!(pending(&player.data));
    }
    #[test]
    fn recovery_rejects_paths_versions_and_multibyte_names_without_panicking() {
        for name in [
            "../foreign.json".to_owned(),
            "中".repeat(20) + "a.json",
            format!("{}.json", "z".repeat(64)),
        ] {
            let (player, _, safe, a, h) = fixture();
            prepare(&player.data, Some((&safe, &a)), &h).unwrap();
            let path = root(&player.data).join("intent.json");
            let mut intent: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            intent["archive"]["name"] = serde_json::json!(name);
            fs::write(&path, serde_json::to_vec(&intent).unwrap()).unwrap();
            assert!(recover(&player.data).is_err());
            assert!(pending(&player.data));
        }
    }
    #[test]
    fn committed_cleanup_keeps_later_history_and_conflicting_archives_are_untouched() {
        let (player, _, name, a, h) = fixture();
        let mut intent = prepare(&player.data, Some((&name, &a)), &h).unwrap();
        atomic_file::write(&player.data.join("performance-history").join(&name), &a).unwrap();
        atomic_file::write(&player.data.join(HISTORY), &h).unwrap();
        intent.committed = true;
        atomic_file::write(
            &root(&player.data).join("intent.json"),
            &serde_json::to_vec(&intent).unwrap(),
        )
        .unwrap();
        fs::write(player.data.join(HISTORY), b"later history").unwrap();
        recover(&player.data).unwrap();
        assert_eq!(
            fs::read(player.data.join(HISTORY)).unwrap(),
            b"later history"
        );
        fs::write(
            player.data.join("performance-history").join(&name),
            b"foreign archive",
        )
        .unwrap();
        assert!(commit(&player.data, Some((&name, &a)), &h).is_err());
        assert_eq!(
            fs::read(player.data.join("performance-history").join(name)).unwrap(),
            b"foreign archive"
        );
    }
    #[test]
    fn pending_backup_blocks_round_without_creating_another_intent() {
        let (player, _, name, a, h) = fixture();
        let before = fs::read(player.data.join(HISTORY)).unwrap();
        fs::write(
            player.data.join("practice-import-journal.json"),
            b"retained backup intent",
        )
        .unwrap();
        assert!(
            commit(&player.data, Some((&name, &a)), &h)
                .unwrap_err()
                .contains("备份导入尚待恢复")
        );
        assert!(!pending(&player.data));
        assert_eq!(fs::read(player.data.join(HISTORY)).unwrap(), before);
        assert_eq!(
            fs::read(player.data.join("practice-import-journal.json")).unwrap(),
            b"retained backup intent"
        );
    }
    #[test]
    fn incomplete_preparation_is_preserved_and_history_only_commits_are_supported() {
        let (player, _, _, _, h) = fixture();
        fs::create_dir(root(&player.data)).unwrap();
        fs::write(root(&player.data).join("history.next"), b"unfinished").unwrap();
        commit(&player.data, None, &h).unwrap();
        let preserved = fs::read_dir(&player.data)
            .unwrap()
            .map(|e| e.unwrap().path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("round-save-incomplete-")
            })
            .unwrap();
        assert_eq!(
            fs::read(preserved.join("history.next")).unwrap(),
            b"unfinished"
        );
        assert_eq!(fs::read(player.data.join(HISTORY)).unwrap(), h);
        assert!(!pending(&player.data));
    }
}
