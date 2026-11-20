//! Recoverable publication of library, practice, and score-owned files as one edit.
use panthesia_core::utils::atomic_file::{self, DeferredWrite, Observation};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    io::Read,
    path::{Path, PathBuf},
};
const FOLDER: &str = "asset-save-pending";
const LIMIT: u64 = 512_000_000;
const TRANSACTION_LIMIT: u64 = 1_024_000_000;
const MAX_ENTRIES: usize = 7000;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
enum Target {
    Data(String),
    Sidecar(PathBuf),
}
impl Target {
    fn from_path(data: &Path, path: &Path) -> Result<Self, String> {
        // Legacy callers may pass a relative MIDI path. Resolve it before selecting
        // staged targets so its sidecar cannot bypass the transaction boundary.
        let absolute = std::path::absolute(path).map_err(|error| error.to_string())?;
        let root = std::path::absolute(data).map_err(|error| error.to_string())?;
        let path = absolute.as_path();
        let data = root.as_path();
        if let Ok(relative) = path.strip_prefix(data) {
            let name = relative.to_string_lossy().replace('\\', "/");
            if allowed_relative(&name) {
                return Ok(Self::Data(name));
            }
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("资料保存位置无效")?;
        if let Some(name) = name.strip_suffix(".neothesia.ron") {
            let midi = path.with_file_name(name);
            if midi.is_absolute()
                && midi.extension().is_some_and(|ext| {
                    ext.eq_ignore_ascii_case("mid") || ext.eq_ignore_ascii_case("midi")
                })
            {
                return Ok(Self::Sidecar(midi));
            }
        }
        Err(format!("此资料不属于资料保存范围：{}", path.display()))
    }
    fn path(&self, data: &Path) -> Result<PathBuf, String> {
        let path = match self {
            Self::Data(relative) if allowed_relative(relative) => data.join(relative),
            Self::Sidecar(midi)
                if midi.is_absolute()
                    && midi.extension().is_some_and(|ext| {
                        ext.eq_ignore_ascii_case("mid") || ext.eq_ignore_ascii_case("midi")
                    }) =>
            {
                panthesia_core::library::legacy_metadata_sidecar_path(midi)
            }
            _ => return Err("资料恢复记录包含无效目标".into()),
        };
        if path.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir | std::path::Component::CurDir
            )
        }) {
            return Err("资料恢复位置包含相对路径".into());
        }
        plain_chain(&path)?;
        Ok(path)
    }
}
fn allowed_relative(relative: &str) -> bool {
    if matches!(
        relative,
        "web-preferences.json"
            | "repertoire.json"
            | "web-practice-history.ron"
            | "library-workspace.json"
            | "score-sources.json"
            | "metadata-templates.json"
            | "pending-metadata-history.json"
    ) {
        return true;
    }
    let parts = relative.split('/').collect::<Vec<_>>();
    if parts.iter().any(|part| {
        part.is_empty()
            || *part == "."
            || *part == ".."
            || part.contains('\\')
            || part.contains(':')
    }) {
        return false;
    }
    // A validated piece archive owns only its content-addressed package directory.
    if parts.len()==3 && parts[0]=="library" && parts[1]=="annotations" {
        return parts[2].strip_suffix(".json").is_some_and(valid_hash);
    }
    if parts.len()==4 && parts[..3]==["library","assets","midi"] {
        let Some(stem)=parts[3].strip_suffix(".mid") else{return false;};
        let (id,index)=stem.split_once("-restored-").map_or((stem,None),|(id,index)|(id,Some(index)));
        return valid_hash(id)&&index.is_none_or(|i|!i.is_empty()&&i.len()<=3&&i.bytes().all(|b|b.is_ascii_digit()));
    }
    if parts.len() >= 3 && parts[0] == "packages" && valid_hash(parts[1]) {
        return crate::piece_package::valid_asset_path(relative);
    }
    if parts.len() == 2 && matches!(parts[0], "imports" | "song-assets") {
        let Some(stem) = parts[1].strip_suffix(".mid") else {
            return false;
        };
        let (identity, restored) = stem
            .split_once("-restored-")
            .map_or((stem, None), |(id, n)| (id, Some(n)));
        return valid_hash(identity)
            && restored.is_none_or(|n| {
                !n.is_empty() && n.len() <= 3 && n.bytes().all(|b| b.is_ascii_digit())
            });
    }
    if parts.len() == 3
        && parts[0] == "legacy-track-reviews"
        && valid_hash(parts[1])
        && parts[2] == "first-load.json"
    {
        return true;
    }
    if parts.len() == 2 && parts[0] == "metadata-history" {
        return parts[1].strip_suffix(".json").is_some_and(valid_hash);
    }
    if parts.len() == 2 && parts[0] == "metadata-sources" {
        return parts[1].strip_suffix(".synthesia").is_some_and(valid_hash);
    }
    if parts.len() == 2 && parts[0] == "metadata-imports" {
        return parts[1].strip_suffix(".json").is_some_and(valid_hash);
    }
    if parts.len() == 2 && parts[0] == "metadata-claims" {
        return parts[1].strip_suffix(".json").is_some_and(crate::metadata_claims::valid_id);
    }
    if parts.len() == 2 && parts[0] == "catalog-import-results" {
        return parts[1].strip_suffix(".json").is_some_and(valid_hash);
    }
    if parts.len() == 2 && parts[0] == "scores" {
        return Path::new(parts[1]).extension().is_some_and(|ext| {
            ext.eq_ignore_ascii_case("musicxml")
                || ext.eq_ignore_ascii_case("mxl")
                || ext.eq_ignore_ascii_case("xml")
        });
    }
    if parts.len() == 3 && parts[0] == "score-attachments" && valid_hash(parts[1]) {
        if parts[2] == "manifest.json" {
            return true;
        }
        let name = Path::new(parts[2]);
        return name
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(valid_hash)
            && name
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| matches!(ext, "pdf" | "png" | "jpeg" | "webp"));
    }
    false
}
pub(crate) fn captures(data: &Path, path: &Path) -> bool {
    Target::from_path(data, path).is_ok()
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn plain_chain(path: &Path) -> Result<(), String> {
    for part in path.ancestors() {
        match std::fs::symlink_metadata(part) {
            Ok(metadata) => {
                let mut linked = metadata.file_type().is_symlink();
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    linked |= metadata.file_attributes() & 0x400 != 0;
                }
                if linked {
                    return Err(format!(
                        "资料保存位置含文件链接，请检查实际位置：{}",
                        part.display()
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}
fn read(path: &Path) -> Result<Vec<u8>, String> {
    read_bounded(path, LIMIT)
}
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    plain_chain(path)?;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("保存资料超过容量限制".into());
    }
    Ok(bytes)
}
fn fingerprint(path: &Path) -> Result<Option<String>, String> {
    plain_chain(path)?;
    dependency_fingerprint(path)
}
// Read-only sources may be reached through a user-selected junction or file link.
// Writable destinations are validated separately and must have a plain directory chain.
fn dependency_fingerprint(path: &Path) -> Result<Option<String>, String> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
            let mut hash = blake3::Hasher::new();
            let mut block = [0u8; 64 * 1024];
            let mut total = 0u64;
            loop {
                let count = file.read(&mut block).map_err(|e| e.to_string())?;
                if count == 0 {
                    break;
                }
                total = total.saturating_add(count as u64);
                if total > LIMIT {
                    return Err("保存依赖文件超过容量限制".into());
                }
                hash.update(&block[..count]);
            }
            Ok(Some(hash.finalize().to_hex().to_string()))
        }
        Ok(_) => Err("资料保存目标不是文件".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
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
    data.join(FOLDER)
}
fn payload(data: &Path, index: usize) -> PathBuf {
    folder(data).join(format!("{index}.next"))
}
pub(crate) fn pending(data: &Path) -> bool {
    pending_checked(data).unwrap_or(true)
}
pub(crate) fn pending_checked(data: &Path) -> std::io::Result<bool> {
    folder(data).join("intent.json").try_exists()
}
fn save_intent(data: &Path, intent: &Intent) -> Result<(), String> {
    atomic_file::write(
        &folder(data).join("intent.json"),
        &serde_json::to_vec(intent).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
fn clean(data: &Path, count: usize) {
    if std::fs::remove_file(folder(data).join("intent.json")).is_err() {
        return;
    }
    for index in 0..count {
        let _ = std::fs::remove_file(payload(data, index));
    }
    let _ = std::fs::remove_dir(folder(data));
}
fn apply(data: &Path, mut intent: Intent) -> Result<(), String> {
    if intent.version != 1 || intent.entries.is_empty() || intent.entries.len() > MAX_ENTRIES {
        return Err("资料恢复记录格式无效".into());
    }
    if intent.committed {
        clean(data, intent.entries.len());
        return Ok(());
    }
    let mut destinations = BTreeSet::new();
    let mut writes = Vec::new();
    let mut total = 0u64;
    for (index, entry) in intent.entries.iter().enumerate() {
        if !valid_hash(&entry.after) || entry.before.as_ref().is_some_and(|hash| !valid_hash(hash))
        {
            return Err("资料恢复校验记录无效".into());
        }
        let path = entry.target.path(data)?;
        if !crate::piece_package::insert_asset_path(
            &mut destinations,
            &crate::library_workspace::key(&path),
        ) {
            return Err("资料恢复目标重复".into());
        }
        if intent.committed {
            continue;
        }
        let bytes = read(&payload(data, index))?;
        total = total.saturating_add(bytes.len() as u64);
        if total > TRANSACTION_LIMIT || blake3::hash(&bytes).to_hex().as_str() != entry.after {
            return Err("资料恢复副本校验失败，现有资料已保留".into());
        }
        let current = fingerprint(&path)?;
        if current.as_ref() != Some(&entry.after) && current != entry.before {
            return Err(format!(
                "练习资料在保存后又被修改，请保留恢复目录并处理冲突：{}",
                path.display()
            ));
        }
        if current.as_ref() != Some(&entry.after) {
            writes.push((path, bytes, entry.before.clone(), entry.after.clone()));
        }
    }
    for (path, bytes, before, after) in writes {
        let current = fingerprint(&path)?;
        if current.as_ref() == Some(&after) {
            continue;
        }
        if current != before {
            return Err(format!(
                "保存期间目标又被修改，恢复记录已保留：{}",
                path.display()
            ));
        }
        atomic_file::write(&path, &bytes).map_err(|e| e.to_string())?;
    }
    if !intent.committed {
        intent.committed = true;
        save_intent(data, &intent)?;
    }
    clean(data, intent.entries.len());
    Ok(())
}
pub(crate) fn recover(data: &Path) -> Result<(), String> {
    if !pending(data) {
        return Ok(());
    }
    let bytes = read_bounded(&folder(data).join("intent.json"), 8_000_000)?;
    if bytes.len() > 8_000_000 {
        return Err("资料恢复记录过大".into());
    }
    let intent: Intent =
        serde_json::from_slice(&bytes).map_err(|e| format!("资料恢复记录无法读取：{e}"))?;
    apply(data, intent)
}
pub(crate) fn validate_observations(observed: &[Observation]) -> Result<(), String> {
    for observation in observed {
        if dependency_fingerprint(&observation.path)? != observation.before {
            return Err(format!(
                "准备期间资料已改变，请重新读取：{}",
                observation.path.display()
            ));
        }
    }
    Ok(())
}
pub(crate) fn commit(
    data: &Path,
    writes: Vec<DeferredWrite>,
    observed: Vec<Observation>,
) -> Result<(), String> {
    commit_at(data, writes, observed, || Ok(()))
}
pub(crate) fn changed_before_commit(error: &str) -> bool {
    error.starts_with("准备期间资料已改变，请重新读取后再保存：")
        || error == "准备保存时资料再次改变，请重新读取"
}
pub(crate) fn commit_at(
    data: &Path,
    writes: Vec<DeferredWrite>,
    observed: Vec<Observation>,
    begin: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let lock = crate::library_workspace::lock_for(data)?;
    let _guard = lock.lock().map_err(|_| "练习资料正忙")?;
    recover(data)?;
    if pending(data) {
        return Err("资料保存仍待恢复，请重新启动".into());
    }
    // Detect edits made by the directory monitor, another editor, or the user during preparation.
    for observation in &observed {
        if dependency_fingerprint(&observation.path)? != observation.before {
            return Err(format!(
                "准备期间资料已改变，请重新读取后再保存：{}",
                observation.path.display()
            ));
        }
    }
    if writes.is_empty() {
        return begin();
    }
    if writes.len() == 1 {
        let write = writes.into_iter().next().ok_or("资料保存内容缺失")?;
        let destination = Target::from_path(data, &write.path)?.path(data)?;
        if !observed.iter().any(|item| item.path == write.path) {
            return Err("资料保存缺少原文件校验记录".into());
        }
        let write = write.materialize().map_err(|e| e.to_string())?;
        if write.bytes.len() as u64 > LIMIT {
            return Err("单份保存资料超过容量限制".into());
        }
        // A single manifest is already all-or-nothing. Avoid a multi-file journal for every pen stroke.
        for observation in &observed {
            if dependency_fingerprint(&observation.path)? != observation.before {
                return Err("准备保存时资料再次改变，请重新读取".into());
            }
        }
        begin()?;
        return atomic_file::write(&destination, &write.bytes).map_err(|e| e.to_string());
    }
    if writes.len() > MAX_ENTRIES {
        return Err("单次资料修改涉及过多文件，请分次保存".into());
    }
    let observed_by_path = observed
        .iter()
        .map(|item| (item.path.as_path(), &item.before))
        .collect::<std::collections::HashMap<_, _>>();
    let mut intent = Intent {
        version: 1,
        committed: false,
        entries: Vec::new(),
    };
    let mut staged = Vec::new();
    let mut destinations = BTreeSet::new();
    let mut total = 0u64;
    for write in writes {
        let target = Target::from_path(data, &write.path)?;
        let destination = target.path(data)?;
        if !crate::piece_package::insert_asset_path(
            &mut destinations,
            &crate::library_workspace::key(&destination),
        ) {
            return Err("保存目标有重复文件或文件与目录冲突，未发布保存内容".into());
        }
        let before = (*observed_by_path
            .get(write.path.as_path())
            .ok_or("资料保存缺少原文件校验记录")?)
        .clone();
        let write = write.materialize().map_err(|e| e.to_string())?;
        total = total.saturating_add(write.bytes.len() as u64);
        if total > TRANSACTION_LIMIT {
            return Err("单次保存资料超过容量限制".into());
        }
        intent.entries.push(Entry {
            target,
            before,
            after: blake3::hash(&write.bytes).to_hex().to_string(),
        });
        staged.push(write.bytes);
    }
    plain_chain(&folder(data))?;
    if folder(data).try_exists().map_err(|e| e.to_string())? {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::fs::rename(
            folder(data),
            data.join(format!("asset-save-incomplete-{nonce}")),
        )
        .map_err(|e| e.to_string())?;
    }
    for (index, bytes) in staged.iter().enumerate() {
        atomic_file::write(&payload(data, index), bytes).map_err(|e| e.to_string())?;
    }
    // Recheck every input after staging, before publishing the recoverable intent.
    for observation in &observed {
        if dependency_fingerprint(&observation.path)? != observation.before {
            return Err("准备保存时资料再次改变，请重新读取".into());
        }
    }
    begin()?;
    save_intent(data, &intent)?;
    apply(data, intent)
}
