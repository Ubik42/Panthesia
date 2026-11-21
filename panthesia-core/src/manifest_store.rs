//! `.panthesia` manifests on disk: lookup next to a music file, atomic writes, hash checks
//! and recovery of moved references inside the manifest's own folder tree.
use crate::manifest::{self, FileRef, Manifest, ManifestError};
use crate::utils::atomic_file;
use std::path::{Component, Path, PathBuf};

/// Folder levels searched upwards for a `song.panthesia` that references the opened file.
const PARENT_LEVELS: usize = 2;
/// Upper bound on files examined while looking for a moved reference.
const SEARCH_LIMIT: usize = 50_000;

#[derive(Debug, Clone)]
pub struct Located {
    pub path: PathBuf,
    pub manifest: Manifest,
    /// Opened from a newer format: never written back.
    pub read_only: bool,
}

pub fn read(path: &Path) -> Result<Located, String> {
    let bytes = atomic_file::read_limited(path, manifest::MAX_BYTES)
        .map_err(|e| format!("歌曲清单读取失败：{e}"))?;
    match Manifest::parse(&bytes) {
        Ok(manifest) => Ok(Located { path: path.into(), manifest, read_only: false }),
        Err(ManifestError::Newer(_)) => Manifest::parse_read_only(&bytes)
            .map(|manifest| Located { path: path.into(), manifest, read_only: true })
            .map_err(|e| e.to_string()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn write(located: &Located) -> Result<(), String> {
    if located.read_only {
        return Err("歌曲清单来自更新版本的程序，当前版本不写回".into());
    }
    let bytes = located.manifest.to_bytes().map_err(|e| e.to_string())?;
    atomic_file::write(&located.path, &bytes).map_err(|e| format!("歌曲清单保存失败：{e}"))
}

/// Lookup order (current-plan 3.7): ① same-name manifest beside the file; ② a `song.panthesia`
/// in the same folder or up to two levels above that references the file. Unreadable manifests
/// are reported as errors rather than skipped, so a damaged file is never silently replaced.
pub fn locate(music: &Path) -> Result<Option<Located>, String> {
    if music.extension().is_some_and(|e| e.eq_ignore_ascii_case(manifest::EXTENSION)) {
        return read(music).map(Some);
    }
    let name = music.file_name().and_then(|n| n.to_str()).ok_or("文件名无法读取")?;
    let dir = music.parent().ok_or("文件所在目录无法读取")?;
    let sibling = dir.join(manifest::sibling_name(name));
    if sibling.is_file() {
        return read(&sibling).map(Some);
    }
    let mut folder = Some(dir);
    for _ in 0..=PARENT_LEVELS {
        let Some(current) = folder else { break };
        let candidate = current.join(manifest::FOLDER_NAME);
        if candidate.is_file() {
            let located = read(&candidate)?;
            if relative_path(current, music).is_some_and(|rel| located.manifest.references(&rel)) {
                return Ok(Some(located));
            }
        }
        folder = current.parent();
    }
    Ok(None)
}

/// Serializes every read-modify-write of manifests in this process.
static EDIT: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Read, change and write the manifest that refers to `music` under one process-wide lock.
/// `f` receives the manifest and the performance id of `music` in it. Without a manifest,
/// `create` makes a same-name one beside `music` (current-plan 3.7: created on the first edit);
/// otherwise nothing happens and `Ok(None)` is returned. `f` returns whether to write.
pub fn edit<T>(
    music: &Path,
    create: bool,
    f: impl FnOnce(&mut Manifest, &str, &Path) -> Result<(T, bool), String>,
) -> Result<Option<(T, PathBuf)>, String> {
    let _guard = EDIT.lock().unwrap_or_else(|e| e.into_inner());
    let mut found = match locate(music)? {
        Some(found) => found,
        None if create => {
            let path = sibling_path(music).ok_or("文件名无法读取")?;
            let name = music.file_name().and_then(|n| n.to_str()).ok_or("文件名无法读取")?;
            let (hash, bytes) = hash_file(music)?;
            Located { path, manifest: Manifest::for_performance(name, &hash, bytes, None), read_only: false }
        }
        None => return Ok(None),
    };
    if found.read_only {
        return Err("歌曲清单来自更新版本的程序，当前版本不写回".into());
    }
    let dir = found.path.parent().ok_or("清单所在目录无法读取")?.to_path_buf();
    let performance = performance_of(&found, music).ok_or("歌曲清单未列出这个演奏文件")?;
    let (value, changed) = f(&mut found.manifest, &performance, &dir)?;
    if changed {
        write(&found)?;
    }
    Ok(Some((value, found.path)))
}

/// The id of the performance whose file is `music`, if the manifest lists it.
pub fn performance_of(found: &Located, music: &Path) -> Option<String> {
    let dir = found.path.parent()?;
    let rel = relative_path(dir, music)?;
    let m = &found.manifest;
    m.performances
        .iter()
        .find(|p| m.file(&p.file).is_some_and(|f| f.path.eq_ignore_ascii_case(&rel)))
        .map(|p| p.id.clone())
}

/// Where a manifest for `music` is created on first edit: beside it, same name.
pub fn sibling_path(music: &Path) -> Option<PathBuf> {
    let name = music.file_name()?.to_str()?;
    Some(music.with_file_name(manifest::sibling_name(name)))
}

/// `target` relative to `base`, `/`-separated, using `..` where needed. Both must share a root.
pub fn relative_path(base: &Path, target: &Path) -> Option<String> {
    let base = normalize(base);
    let target = normalize(target);
    let b: Vec<_> = base.components().collect();
    let t: Vec<_> = target.components().collect();
    if b.first() != t.first() {
        return None;
    }
    let common = b.iter().zip(&t).take_while(|(x, y)| eq_component(x, y)).count();
    let mut parts: Vec<String> = std::iter::repeat_n("..".to_string(), b.len() - common).collect();
    for c in &t[common..] {
        parts.push(c.as_os_str().to_str()?.to_string());
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}
fn eq_component(a: &Component, b: &Component) -> bool {
    // Windows paths compare case-insensitively.
    a.as_os_str().to_string_lossy().to_lowercase() == b.as_os_str().to_string_lossy().to_lowercase()
}
fn normalize(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    let text = text.strip_prefix(r"\\?\").unwrap_or(&text);
    let mut out = PathBuf::new();
    for c in Path::new(text).components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}
/// Resolve a manifest-relative reference.
pub fn resolve(manifest_dir: &Path, relative: &str) -> PathBuf {
    normalize(&manifest_dir.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR)))
}

pub fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let mut hasher = blake3::Hasher::new();
    let mut file = std::fs::File::open(path).map_err(|e| format!("{}：{e}", path.display()))?;
    let bytes = std::io::copy(&mut file, &mut hasher).map_err(|e| format!("{}：{e}", path.display()))?;
    Ok((hasher.finalize().to_hex().to_string(), bytes))
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Check {
    /// Referenced files whose recorded hash no longer matches (file id).
    pub changed: Vec<String>,
    /// References that could not be found (file id).
    pub missing: Vec<String>,
    /// References found elsewhere in the folder tree and updated (file id, new path).
    pub relinked: Vec<(String, String)>,
}
impl Check {
    pub fn modified(&self) -> bool {
        !self.relinked.is_empty()
    }
}

/// Verify every reference with a recorded hash. Missing files are searched for inside the
/// manifest's folder tree; a unique match by size and hash updates the path in `manifest`.
/// The caller writes the manifest back when `Check::modified` is true.
pub fn check(manifest_dir: &Path, manifest: &mut Manifest) -> Check {
    let mut report = Check::default();
    let mut index: Option<Vec<(PathBuf, u64)>> = None;
    for file in &mut manifest.files {
        let path = resolve(manifest_dir, &file.path);
        if path.is_file() {
            if let Some(expected) = &file.blake3 {
                match hash_file(&path) {
                    Ok((hash, bytes)) if &hash == expected && file.bytes.is_none_or(|b| b == bytes) => {}
                    _ => report.changed.push(file.id.clone()),
                }
            }
            continue;
        }
        let (Some(expected), Some(size)) = (file.blake3.clone(), file.bytes) else {
            report.missing.push(file.id.clone());
            continue;
        };
        let files = index.get_or_insert_with(|| list_tree(manifest_dir));
        let matches: Vec<_> = files
            .iter()
            .filter(|(_, bytes)| *bytes == size)
            .filter(|(candidate, _)| hash_file(candidate).is_ok_and(|(hash, _)| hash == expected))
            .map(|(candidate, _)| candidate.clone())
            .collect();
        match matches.as_slice() {
            [found] => match relative_path(manifest_dir, found) {
                Some(rel) => {
                    relink(file, rel.clone());
                    report.relinked.push((file.id.clone(), rel));
                }
                None => report.missing.push(file.id.clone()),
            },
            _ => report.missing.push(file.id.clone()),
        }
    }
    report
}
fn relink(file: &mut FileRef, path: String) {
    file.path = path;
}
fn list_tree(root: &Path) -> Vec<(PathBuf, u64)> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            if out.len() >= SEARCH_LIMIT {
                return out;
            }
            let name = entry.file_name();
            // macOS resource forks copied onto Windows volumes.
            if name.to_string_lossy().starts_with("._") {
                continue;
            }
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                stack.push(entry.path());
            } else if kind.is_file() {
                if let Ok(meta) = entry.metadata() {
                    out.push((entry.path(), meta.len()));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "panthesia-manifest-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn manifest_for(dir: &Path, music: &Path) -> Manifest {
        let (hash, bytes) = hash_file(music).unwrap();
        Manifest::for_performance(&relative_path(dir, music).unwrap(), &hash, bytes, None)
    }

    #[test]
    fn relative_paths_use_forward_slashes_and_parents() {
        let base = Path::new(r"D:\Music\MIDI\KAIRCI\#1 MIDI");
        let target = Path::new(r"D:\Music\MIDI\KAIRCI\#1 AUDIO\Oz_人声.wav");
        assert_eq!(relative_path(base, target).unwrap(), "../#1 AUDIO/Oz_人声.wav");
        assert_eq!(relative_path(Path::new(r"\\?\D:\a"), Path::new(r"d:\A\b\c.mid")).unwrap(), "b/c.mid");
        assert!(relative_path(Path::new(r"C:\a"), Path::new(r"D:\a\b")).is_none());
        assert_eq!(resolve(Path::new(r"D:\x\y"), "../z/w.mid"), PathBuf::from(r"D:\x\z\w.mid"));
    }

    #[test]
    fn lookup_prefers_sibling_then_folder_manifest_up_two_levels() {
        let root = temp("lookup");
        let nested = root.join("versions").join("c");
        std::fs::create_dir_all(&nested).unwrap();
        let music = nested.join("song.mid");
        std::fs::write(&music, include_bytes!("../../panthesia-engine/assets/five-finger.mid")).unwrap();
        assert!(locate(&music).unwrap().is_none());

        let folder = Located { path: root.join(manifest::FOLDER_NAME), manifest: manifest_for(&root, &music), read_only: false };
        write(&folder).unwrap();
        let found = locate(&music).unwrap().unwrap();
        assert_eq!(found.path, root.join(manifest::FOLDER_NAME));

        // A folder manifest that does not reference the file is ignored.
        let other = root.join("other.mid");
        std::fs::write(&other, b"MThd").unwrap();
        assert!(locate(&other).unwrap().is_none());

        let sibling = Located { path: sibling_path(&music).unwrap(), manifest: manifest_for(&nested, &music), read_only: false };
        write(&sibling).unwrap();
        assert_eq!(locate(&music).unwrap().unwrap().path, nested.join("song.panthesia"));
        assert_eq!(locate(&sibling.path).unwrap().unwrap().manifest, sibling.manifest);

        std::fs::write(&sibling.path, b"{broken").unwrap();
        assert!(locate(&music).is_err(), "a damaged manifest is reported, not replaced");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn check_reports_changes_and_relinks_moved_files_inside_the_tree() {
        let root = temp("check");
        let music = root.join("a.mid");
        std::fs::write(&music, include_bytes!("../../panthesia-engine/assets/five-finger.mid")).unwrap();
        let mut m = manifest_for(&root, &music);
        assert_eq!(check(&root, &mut m), Check::default());

        std::fs::create_dir_all(root.join("moved")).unwrap();
        std::fs::write(root.join("moved").join("._a.mid"), include_bytes!("../../panthesia-engine/assets/five-finger.mid")).unwrap();
        std::fs::rename(&music, root.join("moved").join("renamed.mid")).unwrap();
        let report = check(&root, &mut m);
        assert_eq!(report.relinked, vec![("perf".to_string(), "moved/renamed.mid".to_string())]);
        assert!(report.modified());
        assert_eq!(m.files[0].path, "moved/renamed.mid");

        std::fs::write(root.join("moved").join("renamed.mid"), b"changed").unwrap();
        assert_eq!(check(&root, &mut m).changed, vec!["perf".to_string()]);

        std::fs::remove_file(root.join("moved").join("renamed.mid")).unwrap();
        assert_eq!(check(&root, &mut m).missing, vec!["perf".to_string()]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn newer_manifest_is_read_only() {
        let root = temp("newer");
        let path = root.join("x.panthesia");
        let mut m = Manifest::for_performance("x.mid", &"0".repeat(64), 1, None);
        m.version = 9;
        std::fs::write(&path, serde_json::to_vec(&m).unwrap()).unwrap();
        let located = read(&path).unwrap();
        assert!(located.read_only);
        assert!(write(&located).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }
    /// Builds one manifest per corpus area of current-plan 3.7 on copies under `work/`.
    /// Run with `cargo test -p panthesia-core corpus_manifests -- --ignored`.
    #[test]
    #[ignore]
    fn corpus_manifests() {
        use crate::manifest::{Layer, Origin, Provenance};
        let corpus = PathBuf::from(std::env::var("PANTHESIA_CORPUS").unwrap_or_else(|_| r"D:\Music\MIDI".into()));
        if !corpus.is_dir() {
            return;
        }
        let work = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/r2-corpus")
            .join(format!("{}", std::process::id()));
        let copy = |relative: &str| -> PathBuf {
            let target = work.join(relative);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::copy(corpus.join(relative), &target).unwrap();
            target
        };
        let reference = |m: &mut Manifest, dir: &Path, id: &str, role: &str, path: &Path, stem: Option<&str>| {
            let (hash, bytes) = hash_file(path).unwrap();
            m.files.push(FileRef {
                id: id.into(),
                role: role.into(),
                path: relative_path(dir, path).unwrap(),
                blake3: Some(hash),
                bytes: Some(bytes),
                stem: stem.map(Into::into),
                range: None,
                label: None,
                rest: Default::default(),
            });
        };
        let save_and_verify = |path: PathBuf, manifest: Manifest, opened: &Path| {
            let located = Located { path: path.clone(), manifest, read_only: false };
            write(&located).unwrap();
            let found = locate(opened).unwrap().unwrap_or_else(|| panic!("no manifest for {}", opened.display()));
            assert_eq!(found.path, path);
            let mut manifest = found.manifest;
            let report = check(path.parent().unwrap(), &mut manifest);
            assert_eq!(report, Check::default(), "{}", path.display());
            manifest
        };
        let perf = |m: &mut Manifest, id: String, file: String, label: &str| {
            m.performances.push(serde_json::from_value(serde_json::json!({"id": id, "file": file, "label": label})).unwrap());
        };

        // B 站曲目：文件夹清单，根 MIDI + 一次导出的谱面与人声。
        let bili = "B站纯钢琴演奏视频转MIDI/Ai-Ai-Ai_BV16b6RBpE6T";
        let run = "exports/roformer-duet-683d194088d02b23b70a";
        let raw = copy(&format!("{bili}/piano_raw.mid"));
        let xml = copy(&format!("{bili}/{run}/score.musicxml"));
        let vocals = copy(&format!("{bili}/{run}/vocals.wav"));
        let dir = work.join(bili);
        let (hash, bytes) = hash_file(&raw).unwrap();
        let mut m = Manifest::for_performance("piano_raw.mid", &hash, bytes, Some("Ai Ai Ai".into()));
        reference(&mut m, &dir, "xml", "score", &xml, None);
        reference(&mut m, &dir, "vox", "stem", &vocals, Some("vocals"));
        m.scores.push(serde_json::from_value(serde_json::json!({"id": "s1", "file": "xml", "performance": "main"})).unwrap());
        m.default.score = Some("s1".into());
        save_and_verify(dir.join(manifest::FOLDER_NAME), m, &raw);

        // Look at the Sky：文件夹清单，多个演奏版本 + 原音频。
        let sky = "B站纯钢琴演奏视频转MIDI/Look at the Sky - Porter Robinson - MIDI";
        let dir = work.join(sky);
        let main = copy(&format!("{sky}/Look at the Sky - Porter Robinson.mid"));
        let (hash, bytes) = hash_file(&main).unwrap();
        let mut m = Manifest::for_performance("Look at the Sky - Porter Robinson.mid", &hash, bytes, Some("Look at the Sky".into()));
        let versions = [("原调_自动对齐", "原调 · 自动对齐"), ("原调_乐谱量化", "原调 · 乐谱量化"), ("C大调_自动对齐", "C 大调 · 自动对齐"), ("C大调_乐谱量化", "C 大调 · 乐谱量化")];
        for (i, (name, label)) in versions.iter().enumerate() {
            let version = copy(&format!("{sky}/versions/Look at the Sky - Porter Robinson_{name}.mid"));
            reference(&mut m, &dir, &format!("v{i}"), "performance", &version, None);
            perf(&mut m, format!("p{i}"), format!("v{i}"), label);
        }
        let sky_audio = std::fs::read_dir(corpus.join(sky).join("source")).unwrap().flatten().next().unwrap().file_name();
        let audio = copy(&format!("{sky}/source/{}", sky_audio.to_string_lossy()));
        reference(&mut m, &dir, "src", "source", &audio, None);
        let m = save_and_verify(dir.join(manifest::FOLDER_NAME), m, &main);
        assert_eq!(m.performances.len(), 5);
        let version = dir.join("versions").join("Look at the Sky - Porter Robinson_C大调_乐谱量化.mid");
        assert_eq!(locate(&version).unwrap().unwrap().path, dir.join(manifest::FOLDER_NAME));

        // 周杰伦多版本文件夹：列出全部版本。
        let jay = "周杰伦midi  126首/七里香";
        let dir = work.join(jay);
        let mut names: Vec<_> = std::fs::read_dir(corpus.join(jay)).unwrap().flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.to_lowercase().ends_with(".mid")).collect();
        names.sort();
        let first = copy(&format!("{jay}/{}", names[0]));
        let (hash, bytes) = hash_file(&first).unwrap();
        let mut m = Manifest::for_performance(&names[0], &hash, bytes, Some("七里香".into()));
        for (i, name) in names.iter().enumerate().skip(1) {
            let path = copy(&format!("{jay}/{name}"));
            reference(&mut m, &dir, &format!("v{i}"), "performance", &path, None);
            perf(&mut m, format!("p{i}"), format!("v{i}"), name);
        }
        let m = save_and_verify(dir.join(manifest::FOLDER_NAME), m, &first);
        assert_eq!(m.performances.len(), names.len());

        // KAIRCI：MIDI 旁同名清单，用 ../ 引用相邻 AUDIO 文件夹；文件名中的 BPM 与调写入图层。
        let kai = "KAIRCI ACG SONGS PIANO ACCOMPANIMENT/「ACG」CHORUS PIANO #1_";
        let song = "CRYCHIC - 春日影 - BPM97 Bmajor";
        let midi = copy(&format!("{kai}/「ACG」CHORUS PIANO #1 MIDI/{song}.mid"));
        let acc = copy(&format!("{kai}/「ACG」CHORUS PIANO #1 AUDIO/{song}.wav"));
        let vox = copy(&format!("{kai}/「ACG」CHORUS PIANO #1 AUDIO/{song}_人声.wav"));
        let dir = midi.parent().unwrap().to_path_buf();
        let (hash, bytes) = hash_file(&midi).unwrap();
        let mut m = Manifest::for_performance(&format!("{song}.mid"), &hash, bytes, Some("春日影".into()));
        m.artist = Some("CRYCHIC".into());
        reference(&mut m, &dir, "acc", "stem", &acc, Some("accompaniment"));
        reference(&mut m, &dir, "vox", "stem", &vox, Some("vocals"));
        let filename = Some(Provenance::new(Origin::Imported, Some("filename")));
        let keys = serde_json::from_value(serde_json::json!({"items": [{"tick": 0, "key": "B:maj"}]})).unwrap();
        let tempo = serde_json::from_value(serde_json::json!({"items": [{"tick": 0, "bpm": 97}]})).unwrap();
        m.layers.insert("keys".into(), Layer { provenance: filename.clone(), body: keys, ..Default::default() });
        m.layers.insert("tempo".into(), Layer { provenance: filename, body: tempo, ..Default::default() });
        let m = save_and_verify(sibling_path(&midi).unwrap(), m, &midi);
        assert!(m.files.iter().any(|f| f.path == format!("../「ACG」CHORUS PIANO #1 AUDIO/{song}_人声.wav")));

        // POP909：数据集旁的标注作为 annotation-source（用户修改时才创建）。
        let pop = "Datasets/POP909-Dataset/POP909/001";
        let midi = copy(&format!("{pop}/001.mid"));
        let chords = copy(&format!("{pop}/chord_midi.txt"));
        let (hash, bytes) = hash_file(&midi).unwrap();
        let mut m = Manifest::for_performance("001.mid", &hash, bytes, None);
        reference(&mut m, midi.parent().unwrap(), "chords", "annotation-source", &chords, None);
        save_and_verify(sibling_path(&midi).unwrap(), m, &midi);

        // SNH48：文件夹清单，paper 引用 PDF，score 引用 MXL，performance 引用识谱 MIDI。
        let snh = "SNH48钢琴PDF谱";
        let midi = copy(&format!("{snh}/PDF转MIDI/海砂.mid"));
        let mxl = copy(&format!("{snh}/PDF转MIDI/海砂.mxl"));
        let pdf_name = std::fs::read_dir(corpus.join(snh)).unwrap().flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .find(|n| n.contains("海砂") && n.to_lowercase().ends_with(".pdf"));
        let dir = work.join(snh);
        let (hash, bytes) = hash_file(&midi).unwrap();
        let mut m = Manifest::for_performance("PDF转MIDI/海砂.mid", &hash, bytes, Some("海砂".into()));
        reference(&mut m, &dir, "mxl", "score", &mxl, None);
        if let Some(name) = pdf_name {
            let pdf = copy(&format!("{snh}/{name}"));
            reference(&mut m, &dir, "pdf", "paper", &pdf, None);
        }
        let mut m = save_and_verify(dir.join(manifest::FOLDER_NAME), m, &midi);

        // 移动后在目录树内按哈希找回。
        std::fs::create_dir_all(dir.join("整理")).unwrap();
        std::fs::rename(&midi, dir.join("整理").join("海砂-识谱.mid")).unwrap();
        let report = check(&dir, &mut m);
        assert_eq!(report.relinked, vec![("perf".to_string(), "整理/海砂-识谱.mid".to_string())]);

        std::fs::remove_dir_all(&work).unwrap();
    }

}
