use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
pub const KINDS: &[(&str, &str)] = &[
    ("music", "曲目与乐谱"),
    ("library", "曲库文件夹"),
    ("notation", "MusicXML 乐谱"),
    ("audiveris", "Audiveris 程序"),
    ("musescore", "MuseScore 程序"),
    ("soundfont", "钢琴音源"),
    ("paper", "PDF 与图片"),
    ("piece", "曲目包"),
    ("backup", "练习备份"),
    ("exportMidi", "MIDI 导出"),
    ("exportScore", "乐谱导出"),
    ("exportPaper", "谱页导出"),
    ("exportPiece", "曲目包导出"),
    ("exportBackup", "练习备份导出"),
    ("repair", "重新定位文件"),
];
#[derive(Default, Serialize, Deserialize)]
struct Locations {
    #[serde(default)]
    version: u8,
    #[serde(default)]
    kinds: BTreeMap<String, Vec<PathBuf>>,
}
fn validate(kind: &str) -> Result<(), String> {
    if KINDS.iter().any(|(k, _)| *k == kind) {
        Ok(())
    } else {
        Err("文件位置类别无效".into())
    }
}
fn read(data: &Path) -> Result<Locations, String> {
    match panthesia_core::utils::atomic_file::read_limited(
        &data.join("file-dialog-locations.json"),
        64_000_000,
    ) {
        Ok(bytes) => {
            let value: Locations =
                serde_json::from_slice(&bytes).map_err(|e| format!("文件位置记录无法读取：{e}"))?;
            if value.version != 1 {
                return Err("文件位置记录版本不支持".into());
            }
            if value.kinds.iter().any(|(k, v)| {
                validate(k).is_err()
                    || v.len() > 20
                    || v.iter()
                        .any(|p| !p.is_absolute() || p.as_os_str().len() > 32768)
            }) {
                return Err("文件位置记录无效".into());
            }
            Ok(value)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Locations {
            version: 1,
            ..Default::default()
        }),
        Err(e) => Err(e.to_string()),
    }
}
fn write(data: &Path, value: &Locations) -> Result<(), String> {
    std::fs::create_dir_all(data).map_err(|e| e.to_string())?;
    panthesia_core::utils::atomic_file::write(
        &data.join("file-dialog-locations.json"),
        &serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
fn promote(paths: &mut Vec<PathBuf>, path: PathBuf) {
    let key = crate::data_locks::key(&path);
    paths.retain(|p| crate::data_locks::key(p) != key);
    paths.insert(0, path);
    paths.truncate(20);
}
pub fn remember(data: &Path, kind: &str, path: &Path, folder: bool) -> Result<(), String> {
    validate(kind)?;
    let path = if folder {
        path
    } else {
        path.parent().ok_or("文件上级位置无效")?
    };
    if !path.is_absolute() || path.as_os_str().len() > 32768 || !path.is_dir() {
        return Err("文件位置不可用".into());
    }
    let lock = crate::data_locks::lock_for(data)?;
    let _guard = lock.lock().map_err(|_| "文件位置正忙")?;
    let mut value = read(data)?;
    promote(value.kinds.entry(kind.into()).or_default(), path.to_owned());
    write(data, &value)
}
pub fn initial(data: &Path, kind: &str) -> Option<PathBuf> {
    validate(kind).ok()?;
    let value = read(data).ok()?;
    let mut path = value.kinds.get(kind)?.first()?.clone();
    loop {
        if path.is_dir() {
            return Some(path);
        }
        if !path.pop() {
            return None;
        }
    }
}
pub fn inspect(data: &Path) -> Result<serde_json::Value, String> {
    serde_json::to_value(inspect_checked(data, &|| Ok(()))?).map_err(|e| e.to_string())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLocationPath {
    pub path: PathBuf,
    pub available: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLocationKind {
    pub id: String,
    pub label: String,
    pub paths: Vec<FileLocationPath>,
    pub revision: String,
    pub checked: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLocationListing {
    pub kinds: Vec<FileLocationKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<String>,
}
fn revision(value: &Locations, kind: &str) -> Result<String, String> {
    let paths = value.kinds.get(kind).map(Vec::as_slice).unwrap_or(&[]);
    Ok(
        blake3::hash(&serde_json::to_vec(paths).map_err(|e| e.to_string())?)
            .to_hex()
            .to_string(),
    )
}
fn describe(
    value: &Locations,
    conflict: Option<String>,
    selected: Option<&str>,
    check: &impl Fn() -> Result<(), String>,
) -> Result<FileLocationListing, String> {
    let mut kinds = Vec::with_capacity(KINDS.len());
    for (kind, label) in KINDS {
        let checked = selected.is_none_or(|selected| selected == *kind);
        let mut paths = Vec::new();
        for path in value.kinds.get(*kind).into_iter().flatten() {
            check()?;
            paths.push(FileLocationPath {
                path: path.clone(),
                available: checked && path.is_dir(),
            });
        }
        kinds.push(FileLocationKind {
            id: (*kind).into(),
            label: (*label).into(),
            paths,
            revision: revision(value, kind)?,
            checked,
        });
    }
    Ok(FileLocationListing { kinds, conflict })
}
pub(crate) fn inspect_checked(
    data: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<FileLocationListing, String> {
    inspect_for(data, None, check)
}
fn inspect_for(
    data: &Path,
    kind: Option<&str>,
    check: &impl Fn() -> Result<(), String>,
) -> Result<FileLocationListing, String> {
    if let Some(kind) = kind {
        validate(kind)?;
    }
    let lock = crate::data_locks::lock_for(data)?;
    let guard = crate::data_locks::wait_for(&lock, check)?;
    let value = read(data)?;
    drop(guard);
    describe(&value, None, kind, check)
}
pub fn update(
    data: &Path,
    kind: &str,
    path: Option<PathBuf>,
    clear: bool,
) -> Result<serde_json::Value, String> {
    serde_json::to_value(update_checked(
        data,
        kind,
        path,
        clear,
        None,
        &|| Ok(()),
        || Ok(()),
    )?)
    .map_err(|e| e.to_string())
}
pub(crate) fn update_checked(
    data: &Path,
    kind: &str,
    path: Option<PathBuf>,
    clear: bool,
    expected: Option<&str>,
    check: &impl Fn() -> Result<(), String>,
    before_commit: impl FnOnce() -> Result<(), String>,
) -> Result<FileLocationListing, String> {
    validate(kind)?;
    let lock = crate::data_locks::lock_for(data)?;
    let guard = crate::data_locks::wait_for(&lock, check)?;
    let mut value = read(data)?;
    let actual = revision(&value, kind)?;
    if expected.is_some_and(|version| version != actual) {
        drop(guard);
        return describe(&value, Some(kind.into()), expected.map(|_| kind), check);
    }
    check()?;
    {
        let paths = value.kinds.entry(kind.into()).or_default();
        if clear {
            if let Some(path) = path {
                let key = crate::data_locks::key(&path);
                paths.retain(|p| crate::data_locks::key(p) != key);
            } else {
                paths.clear();
            }
        } else {
            let path = path.ok_or("请选择已记录的文件位置")?;
            let key = crate::data_locks::key(&path);
            let registered = paths
                .iter()
                .find(|p| crate::data_locks::key(p) == key)
                .ok_or("此位置未登记，请通过文件选择窗口使用一次")?
                .clone();
            if !registered.is_dir() {
                return Err("此文件夹当前不可用".into());
            }
            promote(paths, registered);
        }
    }
    before_commit()?;
    write(data, &value)?;
    drop(guard);
    describe(&value, None, expected.map(|_| kind), check)
}
impl crate::Engine {
    pub(super) fn file_locations_task(
        &self,
        command: crate::Command,
    ) -> Result<serde_json::Value, String> {
        let writing = matches!(command, crate::Command::UpdateFileLocation { .. });
        let operation = if writing {
            Some(self.pending_operation()?)
        } else {
            None
        };
        let engine = self.clone();
        let work = move |token: crate::background_tasks::TaskToken| {
            let _operation = operation;
            token.stage("readingLibrary")?;
            let value = match command {
                crate::Command::FileLocations => inspect_checked(&engine.data, &|| token.check())?,
                crate::Command::FileLocationsFor { kind } => {
                    inspect_for(&engine.data, Some(&kind), &|| token.check())?
                }
                crate::Command::UpdateFileLocation {
                    kind,
                    path,
                    clear,
                    expected,
                } => {
                    update_checked(
                        &engine.data,
                        &kind,
                        path,
                        clear,
                        expected.as_deref(),
                        &|| token.check(),
                        || token.begin_commit(),
                    )?
                }
                _ => return Err("文件位置操作无效".into()),
            };
            serde_json::to_value(value).map_err(|e| e.to_string())
        };
        if writing {
            self.storage_tasks.run("保存最近文件位置", None, work)
        } else {
            self.tasks.run("读取最近文件位置", None, work)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn categories_persist_select_forget_and_fall_back() {
        let root = std::env::temp_dir().join(format!(
            "neothesia-locations-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let data = root.join("data");
        let a = root.join("scores");
        let b = root.join("piano");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        remember(&data, "music", &a.join("piece.mid"), false).unwrap();
        remember(&data, "music", &b, true).unwrap();
        remember(&data, "notation", &a, true).unwrap();
        assert_eq!(initial(&data, "music"), Some(b.clone()));
        update(&data, "music", Some(a.clone()), false).unwrap();
        assert_eq!(initial(&data, "music"), Some(a.clone()));
        let missing = a.join("offline");
        std::fs::create_dir_all(&missing).unwrap();
        remember(&data, "music", &missing, true).unwrap();
        std::fs::remove_dir(&missing).unwrap();
        assert_eq!(initial(&data, "music"), Some(a.clone()));
        assert!(update(&data, "music", Some(missing.clone()), false).is_err());
        update(&data, "music", Some(missing), true).unwrap();
        update(&data, "music", None, true).unwrap();
        assert_eq!(initial(&data, "music"), None);
        assert_eq!(initial(&data, "notation"), Some(a.clone()));
        assert!(a.is_dir());
        assert!(remember(&data, "invalid", &b, true).is_err());
    }
}
