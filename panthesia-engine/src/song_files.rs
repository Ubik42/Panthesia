//! Files of the current song as listed in its `.panthesia` manifest: versions (performances),
//! accompaniment and vocal stems, source audio and paper scores. Adding a file creates the
//! manifest when the song has none yet.
use crate::Player;
use crate::manifest_store;
use panthesia_core::manifest::{FileRef, Manifest, PerformanceRef};
use serde_json::{Map, Value, json};
use std::path::{Path, PathBuf};

const ROLES: &[&str] = &["performance", "stem", "source", "paper", "score", "annotation-source"];

pub enum SongFileEdit {
    Add { path: PathBuf, role: String, stem: Option<String>, label: Option<String> },
    Remove { id: String },
    Label { id: String, label: Option<String> },
}
impl SongFileEdit {
    pub fn parse(
        action: &str,
        path: Option<PathBuf>,
        id: Option<String>,
        role: Option<String>,
        stem: Option<String>,
        label: Option<String>,
    ) -> Result<Self, String> {
        match action {
            "add" => Ok(Self::Add {
                path: path.ok_or("缺少文件位置")?,
                role: role.ok_or("缺少文件角色")?,
                stem,
                label,
            }),
            "remove" => Ok(Self::Remove { id: id.ok_or("缺少文件编号")? }),
            "label" => Ok(Self::Label { id: id.ok_or("缺少文件编号")?, label }),
            other => Err(format!("不支持的操作：{other}")),
        }
    }
}

fn unique_id(manifest: &Manifest, base: &str) -> String {
    let taken = |id: &str| manifest.files.iter().any(|f| f.id == id) || manifest.performances.iter().any(|p| p.id == id);
    if !taken(base) {
        return base.into();
    }
    (2..).map(|n| format!("{base}{n}")).find(|id| !taken(id)).unwrap_or_else(|| base.into())
}
fn file_base(role: &str, stem: Option<&str>) -> String {
    let base = match (role, stem) {
        ("stem", Some(stem)) => stem,
        ("performance", _) => "perf",
        (role, _) => role,
    };
    let clean: String = base.chars().filter(|c| c.is_ascii_alphanumeric() || "_.-".contains(*c)).take(48).collect();
    if clean.is_empty() { "file".into() } else { clean }
}

impl Player {
    fn manifest_song_or_error(&self) -> Result<(PathBuf, String), String> {
        if self.file.is_none() {
            return Err("请先打开一首曲目".into());
        }
        self.manifest_song()
            .ok_or_else(|| "这首曲目保存在旧曲库中，迁移到文件旁的歌曲清单后才能管理文件".into())
    }

    pub(crate) fn song_files(&self) -> Result<Value, String> {
        let (music, _) = self.manifest_song_or_error()?;
        let Some(found) = manifest_store::locate(&music)? else {
            return Ok(json!({
                "manifest": null,
                "readOnly": false,
                "current": "main",
                "performances": [{"id": "main", "label": null, "path": music, "current": true, "default": true}],
                "files": [{"id": "perf", "role": "performance", "path": music, "relative": music.file_name().map(|n| n.to_string_lossy().to_string()), "missing": false}],
                "unmatched": 0,
                "suggestions": crate::song_package::related_files(&music, &[]),
            }));
        };
        let dir = found.path.parent().ok_or("清单所在目录无法读取")?;
        let m = &found.manifest;
        let current = manifest_store::performance_of(&found, &music).unwrap_or_else(|| m.default.performance.clone());
        let performances: Vec<Value> = m
            .performances
            .iter()
            .map(|p| {
                let path = m.file(&p.file).map(|f| manifest_store::resolve(dir, &f.path));
                json!({
                    "id": p.id, "label": p.label, "path": path,
                    "missing": path.as_ref().is_none_or(|p| !p.is_file()),
                    "current": p.id == current, "default": p.id == m.default.performance,
                })
            })
            .collect();
        let files: Vec<Value> = m
            .files
            .iter()
            .map(|f| {
                let path = manifest_store::resolve(dir, &f.path);
                json!({
                    "id": f.id, "role": f.role, "stem": f.stem, "label": f.label,
                    "path": path, "relative": f.path, "missing": !path.is_file(),
                })
            })
            .collect();
        let unmatched: usize = m.layers.values().map(|l| l.unmatched.len()).sum();
        let known: Vec<PathBuf> = m.files.iter().map(|f| manifest_store::resolve(dir, &f.path)).collect();
        Ok(json!({
            "manifest": found.path, "readOnly": found.read_only, "title": m.title, "current": current,
            "performances": performances, "files": files, "unmatched": unmatched,
            "suggestions": crate::song_package::related_files(&music, &known),
        }))
    }

    pub(crate) fn edit_song_file(&mut self, edit: SongFileEdit) -> Result<Value, String> {
        let (music, _) = self.manifest_song_or_error()?;
        let create = matches!(edit, SongFileEdit::Add { .. });
        let result = manifest_store::edit(&music, create, |m, current, dir| {
            match edit {
                SongFileEdit::Add { path, role, stem, label } => add(m, dir, &path, &role, stem, label)?,
                SongFileEdit::Remove { id } => remove(m, current, &id)?,
                SongFileEdit::Label { id, label } => {
                    let label = label.map(|l| l.trim().to_string()).filter(|l| !l.is_empty());
                    if let Some(p) = m.performances.iter_mut().find(|p| p.id == id) {
                        p.label = label;
                    } else if let Some(f) = m.files.iter_mut().find(|f| f.id == id) {
                        f.label = label;
                    } else {
                        return Err("清单中没有这个文件".into());
                    }
                }
            }
            Ok(((), true))
        })?;
        if result.is_none() {
            return Err("这首曲目还没有歌曲清单".into());
        }
        self.song_files()
    }
}

fn add(m: &mut Manifest, dir: &Path, path: &Path, role: &str, stem: Option<String>, label: Option<String>) -> Result<(), String> {
    if !ROLES.contains(&role) {
        return Err(format!("不支持的文件角色：{role}"));
    }
    let stem = stem.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if role == "stem" && stem.is_none() {
        return Err("请选择音轨类型（伴奏、人声等）".into());
    }
    let path = std::path::absolute(path).map_err(|e| format!("文件位置无法解析：{e}"))?;
    if !path.is_file() {
        return Err(format!("找不到文件：{}", path.display()));
    }
    if role == "performance" && !crate::openable_file(&path) {
        return Err("版本须为 MIDI 文件".into());
    }
    let relative = manifest_store::relative_path(dir, &path)
        .ok_or("文件与歌曲清单不在同一磁盘，无法引用")?;
    if m.files.iter().any(|f| f.path.eq_ignore_ascii_case(&relative)) {
        return Err("这个文件已经登记在歌曲清单中".into());
    }
    let (hash, bytes) = manifest_store::hash_file(&path)?;
    let id = unique_id(m, &file_base(role, stem.as_deref()));
    let label = label.map(|l| l.trim().to_string()).filter(|l| !l.is_empty());
    m.files.push(FileRef {
        id: id.clone(),
        role: role.into(),
        path: relative,
        blake3: Some(hash),
        bytes: Some(bytes),
        stem: if role == "stem" { stem } else { None },
        range: None,
        label: if role == "performance" { None } else { label.clone() },
        rest: Map::new(),
    });
    if role == "performance" {
        let performance = unique_id(m, "v");
        m.performances.push(PerformanceRef {
            id: performance,
            file: id,
            label,
            note_identity: panthesia_core::manifest::NOTE_IDENTITY.into(),
            rest: Map::new(),
        });
    }
    Ok(())
}

fn remove(m: &mut Manifest, current: &str, id: &str) -> Result<(), String> {
    if let Some(index) = m.performances.iter().position(|p| p.id == id) {
        if id == current || id == m.default.performance {
            return Err("当前打开的版本和默认版本不能移除".into());
        }
        let file = m.performances.remove(index).file;
        m.layers.retain(|_, l| l.performance.as_deref() != Some(id));
        if let Some(Value::Object(all)) = m.settings.get_mut("performances") {
            all.remove(id);
        }
        m.prune_settings();
        drop_unused_file(m, &file);
        return Ok(());
    }
    if m.performances.iter().any(|p| p.file == id) {
        return Err("这个文件是一个版本的演奏文件，请移除对应版本".into());
    }
    if m.scores.iter().any(|s| s.file == id) {
        return Err("这个谱面正在配对使用，请在谱面设置中取消配对".into());
    }
    let before = m.files.len();
    m.files.retain(|f| f.id != id);
    if m.files.len() == before {
        return Err("清单中没有这个文件".into());
    }
    Ok(())
}
fn drop_unused_file(m: &mut Manifest, file: &str) {
    let used = m.performances.iter().any(|p| p.file == file) || m.scores.iter().any(|s| s.file == file);
    if !used {
        m.files.retain(|f| f.id != file);
    }
}
