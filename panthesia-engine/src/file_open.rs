//! Open a music file or a `.panthesia` manifest from its own location (current-plan 3.7):
//! find the manifest, verify and recover its references, load the chosen performance and
//! check note references when the performance file changed. Without a manifest the file is
//! played directly; nothing is created on open.
use crate::manifest_store::{self, Located};
use crate::{Command, Engine, load_pipeline};
use panthesia_core::manifest::Manifest;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

const MIDI: &[&str] = &["mid", "midi", "kar"];
const SCORE: &[&str] = &["musicxml", "mxl", "xml", "abc"];

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}
pub fn supported(path: &Path) -> bool {
    let ext = extension(path);
    MIDI.contains(&ext.as_str()) || SCORE.contains(&ext.as_str()) || ext == panthesia_core::manifest::EXTENSION
}

/// The performance to open: the file itself when the manifest lists it as a performance,
/// otherwise the manifest's default performance.
fn choose(located: &Located, opened: &Path) -> Result<(String, PathBuf), String> {
    let dir = located.path.parent().ok_or("清单所在目录无法读取")?;
    let manifest = &located.manifest;
    let relative = manifest_store::relative_path(dir, opened);
    let listed = relative.as_deref().and_then(|rel| {
        manifest.performances.iter().find(|p| manifest.file(&p.file).is_some_and(|f| f.path == rel))
    });
    let performance = match listed {
        Some(p) => p,
        None => manifest.performance(&manifest.default.performance).ok_or("清单缺少默认演奏")?,
    };
    let file = manifest.file(&performance.file).ok_or("清单中的演奏文件引用缺失")?;
    Ok((performance.id.clone(), manifest_store::resolve(dir, &file.path)))
}

fn title(manifest: Option<&Manifest>, path: &Path) -> String {
    manifest
        .and_then(|m| m.title.clone())
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "曲目".into()))
}

impl Engine {
    pub fn open_file(&self, path: PathBuf) -> Result<Value, String> {
        let path = std::path::absolute(&path).map_err(|e| format!("文件位置无法解析：{e}"))?;
        if !path.is_file() {
            return Err(format!("找不到文件：{}", path.display()));
        }
        if !supported(&path) {
            return Err("只能打开 MIDI、MusicXML 或 .panthesia 文件".into());
        }
        let mut located = manifest_store::locate(&path)?;
        let mut report = manifest_store::Check::default();
        if let Some(found) = located.as_mut() {
            let dir = found.path.parent().ok_or("清单所在目录无法读取")?.to_path_buf();
            report = manifest_store::check(&dir, &mut found.manifest);
            if report.modified() && !found.read_only {
                manifest_store::write(found)?;
            }
        }
        let (performance, target) = match &located {
            Some(found) => choose(found, &path)?,
            None => (String::new(), path.clone()),
        };
        if !target.is_file() {
            return Err(format!("清单引用的演奏文件缺失：{}", target.display()));
        }
        let name = title(located.as_ref().map(|l| &l.manifest), &target);
        let mut result = if SCORE.contains(&extension(&target).as_str()) {
            self.command(Command::ImportScoreOriginal { path: target.clone(), default_bpm: 120 })?
        } else {
            self.load_task(load_pipeline::Input::File { path: target.clone(), title: name, expected: None })?
        };
        let mut unmatched = 0;
        if let Some(found) = located.as_mut() {
            let changed = found
                .manifest
                .performance(&performance)
                .is_some_and(|p| report.changed.contains(&p.file));
            if changed && MIDI.contains(&extension(&target).as_str()) {
                let bytes = std::fs::read(&target).map_err(|e| format!("演奏文件读取失败：{e}"))?;
                let file = panthesia_music::MidiFile::from_bytes_checked(target.to_string_lossy(), &bytes, &|| Ok(()))?;
                unmatched = found.manifest.reconcile_notes(&performance, &file.source);
                // Record the current file so the same change is not reported again.
                let (hash, size) = manifest_store::hash_file(&target)?;
                let file_id = found.manifest.performance(&performance).map(|p| p.file.clone());
                if let Some(entry) = file_id.and_then(|id| found.manifest.files.iter_mut().find(|f| f.id == id)) {
                    entry.blake3 = Some(hash);
                    entry.bytes = Some(size);
                }
                if !found.read_only {
                    manifest_store::write(found)?;
                }
            }
        }
        let shown = result["title"].as_str().map(str::to_owned).unwrap_or_else(|| title(located.as_ref().map(|l| &l.manifest), &target));
        self.remember_recent(&path, &shown);
        self.remember_opened(target.clone());
        result["opened"] = json!({
            "path": path,
            "performancePath": target,
            "manifest": located.as_ref().map(|found| json!({
                "path": found.path,
                "readOnly": found.read_only,
                "title": found.manifest.title,
                "performance": performance,
                "performances": found.manifest.performances.iter()
                    .map(|p| json!({"id": p.id, "label": p.label})).collect::<Vec<_>>(),
                "changed": report.changed,
                "missing": report.missing,
                "relinked": report.relinked.iter().map(|(id, path)| json!({"id": id, "path": path})).collect::<Vec<_>>(),
                "unmatchedNotes": unmatched,
            })),
        });
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_root_lock::DataRootLock;
    use panthesia_core::manifest::{Layer, Manifest};

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join("panthesia-tests/file-open-unit").join(format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn opens_without_manifest_and_through_a_moved_manifest_reference() {
        let root = temp();
        let data = root.join("data");
        let songs = root.join("songs");
        std::fs::create_dir_all(songs.join("sub")).unwrap();
        let midi = songs.join("sub").join("five.mid");
        std::fs::write(&midi, include_bytes!("../assets/five-finger.mid")).unwrap();
        let lock = DataRootLock::acquire(&data).unwrap();
        let engine = Engine::start(data.clone(), lock, PathBuf::new(), true).unwrap();
        engine.wait_until_ready(std::time::Duration::from_secs(30)).unwrap();

        engine.open_file(midi.clone()).unwrap();
        // The first open drafts the song's analysis into a same-name manifest (song_prepare,
        // 2026-11-22 user decision); every layer it wrote waits for review.
        let sibling = songs.join("sub").join("five.panthesia");
        let drafted = manifest_store::read(&sibling).unwrap().manifest;
        assert!(!drafted.layers.is_empty());
        for layer in drafted.layers.values() {
            let provenance = layer.provenance.as_ref().unwrap();
            assert_eq!(provenance.rest["review"], "pending");
            assert_eq!(layer.status.as_deref(), Some("draft"));
        }

        // Edits go to the same manifest; reopening restores from it.
        let cid = panthesia_music::MidiFile::new(&midi).unwrap().content_id;
        engine.command(Command::SaveBookmark { content_id: cid.clone(), id: None, name: "副歌".into(), tick: 480 }).unwrap();
        let saved = manifest_store::read(&sibling).unwrap().manifest;
        assert_eq!(saved.layers["bookmarks"].body["items"][0]["name"], "副歌");
        assert_eq!(saved.files[0].path, "five.mid");
        engine.command(Command::SetMetadata { value: panthesia_core::library::SongMetadata { title: Some("五指练习".into()), ..Default::default() } }).unwrap();
        let saved = manifest_store::read(&sibling).unwrap().manifest;
        assert_eq!(saved.title.as_deref(), Some("五指练习"));
        assert_eq!(saved.layers["bookmarks"].body["items"][0]["name"], "副歌", "annotation saves keep other data");
        let reopened = engine.open_file(midi.clone()).unwrap();
        assert_eq!(reopened["opened"]["manifest"]["title"], "五指练习");
        let marks = engine.command(Command::Bookmarks).unwrap();
        assert!(marks.to_string().contains("副歌"), "{marks}");
        assert!(!data.join("library").exists(), "not copied into a library");
        // Companion files are listed in the manifest with paths relative to it.
        std::fs::create_dir_all(songs.join("audio")).unwrap();
        std::fs::write(songs.join("audio").join("acc.wav"), b"RIFF").unwrap();
        let listed = engine.command(Command::EditSongFile { action: "add".into(), path: Some(songs.join("audio").join("acc.wav")), id: None, role: Some("stem".into()), stem: Some("accompaniment".into()), label: None }).unwrap();
        assert_eq!(listed["files"][1]["relative"], "../audio/acc.wav", "{listed}");
        let id = listed["files"][1]["id"].as_str().unwrap().to_string();
        assert!(engine.command(Command::EditSongFile { action: "remove".into(), path: None, id: Some("perf".into()), role: None, stem: None, label: None }).is_err());
        let listed = engine.command(Command::EditSongFile { action: "remove".into(), path: None, id: Some(id), role: None, stem: None, label: None }).unwrap();
        assert_eq!(listed["files"].as_array().unwrap().len(), 1);
        std::fs::remove_file(&sibling).unwrap();

        // Folder manifest whose reference is stale: the file is found by hash and the path updated.
        let (hash, bytes) = manifest_store::hash_file(&midi).unwrap();
        let mut manifest = Manifest::for_performance("old/five.mid", &hash, bytes, Some("五指".into()));
        manifest.layers.insert("hands".into(), Layer {
            body: serde_json::from_value(json!({"notes": [{"note": [99, 0, 60], "part": "left"}]})).unwrap(),
            ..Default::default()
        });
        let path = songs.join(panthesia_core::manifest::FOLDER_NAME);
        manifest_store::write(&Located { path: path.clone(), manifest, read_only: false }).unwrap();
        let opened = engine.open_file(path.clone()).unwrap();
        let info = &opened["opened"]["manifest"];
        assert_eq!(info["relinked"][0]["path"], "sub/five.mid");
        assert_eq!(manifest_store::read(&path).unwrap().manifest.files[0].path, "sub/five.mid");

        // The performance changed on disk: note references are checked and kept as unmatched.
        let original = std::fs::read(&midi).unwrap();
        let other = include_bytes!("../assets/parallel-five-finger.mid");
        std::fs::write(&midi, other).unwrap();
        let opened = engine.open_file(midi.clone()).unwrap();
        assert_eq!(opened["opened"]["manifest"]["changed"][0], "perf");
        // The person's hand entry that matches no note is kept aside (it was set aside already
        // when the earlier open drafted fingering); unchecked drafts are regenerated instead.
        let saved = manifest_store::read(&path).unwrap().manifest;
        assert_eq!(saved.layers["hands"].unmatched.len(), 1);
        assert!(saved.layers.values().all(|l| l.unmatched.is_empty() || l.provenance.as_ref().is_none_or(|p| p.rest.get("review").is_none())));
        assert_ne!(saved.files[0].blake3.as_deref(), Some(blake3::hash(&original).to_hex().as_str()));
        assert!(engine.open_file(root.join("missing.mid")).is_err());
        drop(engine);
        let _ = std::fs::remove_dir_all(&root);
    }
}
