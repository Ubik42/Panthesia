//! One-time migration of the central library (R2, current-plan 3.7).
//!
//! Moves the user data that only the old library held to the song files themselves:
//! annotation documents (`library/annotations/<cid>.json`) become `.panthesia` manifests beside
//! every original copy of the song, paired scores are copied beside the song, songs whose
//! original is gone are exported from the library copy, and preference paths that point into
//! `library/` are redirected. Practice settings stay in `web-preferences.json` keyed by content
//! id; the engine writes them into the manifest the first time the song opens.
//!
//! ```text
//! cargo run -p panthesia-engine --example migrate_library -- \
//!     --data <data root> --profile <original data root path> --export <folder> \
//!     [--mirror <folder>] [--apply]
//! ```
//! `--profile` is the data root as recorded in the database (paths under it map to `--data`).
//! `--mirror` copies external originals into the folder first and migrates the copies (dry run
//! on real songs). Without `--apply` nothing is written.
use panthesia_core::library::{self, ScoreAssociation, SongSidecar};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

struct Args {
    data: PathBuf,
    profile: String,
    export: PathBuf,
    mirror: Option<PathBuf>,
    apply: bool,
}

fn args() -> Args {
    let mut it = std::env::args().skip(1);
    let (mut data, mut profile, mut export, mut mirror, mut apply) = (None, None, None, None, false);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--data" => data = it.next().map(PathBuf::from),
            "--profile" => profile = it.next(),
            "--export" => export = it.next().map(PathBuf::from),
            "--mirror" => mirror = it.next().map(PathBuf::from),
            "--apply" => apply = true,
            other => panic!("未知参数 {other}"),
        }
    }
    Args {
        data: data.expect("--data"),
        profile: profile.expect("--profile"),
        export: export.expect("--export"),
        mirror,
        apply,
    }
}

fn plain(path: &str) -> String {
    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

fn content_id(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    panthesia_music::MidiFile::from_path_bytes(path, &bytes).ok().map(|f| f.content_id)
}

fn blake(path: &Path) -> Option<String> {
    std::fs::read(path).ok().map(|b| blake3::hash(&b).to_hex().to_string())
}

fn clean_name(name: &str) -> String {
    name.chars().map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '_' } else { c }).collect()
}

/// Place `bytes` in `folder` as `name`, reusing an identical file; returns the path.
fn place(folder: &Path, name: &str, bytes: &[u8], apply: bool) -> Result<PathBuf, String> {
    let hash = blake3::hash(bytes).to_hex().to_string();
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, "bin"));
    for index in 1..=100 {
        let file = if index == 1 { format!("{stem}.{ext}") } else { format!("{stem} ({index}).{ext}") };
        let path = folder.join(clean_name(&file));
        if path.is_file() {
            if blake(&path).as_deref() == Some(hash.as_str()) {
                return Ok(path);
            }
            continue;
        }
        if apply {
            std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
            panthesia_core::utils::atomic_file::write_new(&path, bytes).map_err(|e| format!("{}：{e}", path.display()))?;
        }
        return Ok(path);
    }
    Err(format!("{} 中同名文件过多", folder.display()))
}

struct Song {
    cid: String,
    title: String,
    library_copy: Option<PathBuf>,
    originals: Vec<PathBuf>,
}

fn main() {
    let a = args();
    let profile = a.profile.to_ascii_lowercase().trim_end_matches('\\').to_string();
    let map_path = |raw: &str| -> PathBuf {
        let p = plain(raw);
        let lower = p.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix(&profile) {
            return a.data.join(p[p.len() - rest.len()..].trim_start_matches('\\'));
        }
        PathBuf::from(p)
    };
    let library = a.data.join("library");
    let db = rusqlite::Connection::open_with_flags(library.join("songs.sqlite3"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("songs.sqlite3");
    let prefs_path = a.data.join("web-preferences.json");
    let mut prefs: Value = serde_json::from_slice(&std::fs::read(&prefs_path).expect("web-preferences.json")).unwrap();

    // Songs that carry user data: annotation documents with content, per-song preferences,
    // score versions.
    let mut cids = BTreeSet::new();
    for entry in std::fs::read_dir(library.join("annotations")).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(cid) = name.strip_suffix(".json") {
            let midi = library.join("assets").join("midi").join(format!("{cid}.mid"));
            match library::load_song_sidecar(&midi, cid) {
                Ok(sidecar) if sidecar != SongSidecar::default() => {
                    cids.insert(cid.to_string());
                }
                Ok(_) => {}
                Err(e) => println!("! 标注无法读取 {cid}：{e}"),
            }
        }
    }
    for key in ["songs", "scoreVersions"] {
        if let Some(Value::Object(map)) = prefs.get(key) {
            for (cid, v) in map {
                if !(v.is_array() && v.as_array().unwrap().is_empty()) {
                    cids.insert(cid.clone());
                }
            }
        }
    }

    let mut songs = Vec::new();
    for cid in &cids {
        let title: String = db
            .query_row(
                "select s.title from performances p join songs s on s.id=p.song_id where p.id=?",
                [cid],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| cid[..12].to_string());
        let mut stmt = db.prepare("select path from locations where performance_id=? order by last_seen desc").unwrap();
        let locations: Vec<String> = stmt.query_map([cid], |r| r.get(0)).unwrap().flatten().collect();
        let library_copy = Some(library.join("assets").join("midi").join(format!("{cid}.mid"))).filter(|p| p.is_file());
        let mut originals = Vec::new();
        for raw in locations {
            let path = map_path(&raw);
            if path.starts_with(&library) || !path.is_file() || content_id(&path).as_deref() != Some(cid.as_str()) {
                continue;
            }
            let path = match &a.mirror {
                Some(mirror) if !path.starts_with(&a.data) => {
                    let text = path.to_string_lossy().replace(':', "");
                    let copy = mirror.join(text);
                    if a.apply && !copy.is_file() {
                        std::fs::create_dir_all(copy.parent().unwrap()).unwrap();
                        std::fs::copy(&path, &copy).unwrap();
                    }
                    copy
                }
                _ => path,
            };
            if !originals.contains(&path) {
                originals.push(path);
            }
        }
        songs.push(Song { cid: cid.clone(), title, library_copy, originals });
    }

    let mut redirect: BTreeMap<String, PathBuf> = BTreeMap::new();
    let mut failures = 0;
    let mut recent = Vec::new();
    for song in &mut songs {
        let short = &song.cid[..12];
        if song.originals.is_empty() {
            match &song.library_copy {
                Some(copy) => {
                    let bytes = std::fs::read(copy).unwrap();
                    match place(&a.export, &format!("{}.mid", song.title), &bytes, a.apply) {
                        Ok(path) => {
                            println!("{short} 导出 {}", path.display());
                            song.originals.push(path);
                        }
                        Err(e) => {
                            println!("! {short} 导出失败：{e}");
                            failures += 1;
                            continue;
                        }
                    }
                }
                None => {
                    println!("- {short} {}：原文件与曲库副本都不存在，只剩偏好，跳过", song.title);
                    continue;
                }
            }
        }
        let old = match &song.library_copy {
            Some(copy) => library::load_song_sidecar(copy, &song.cid).unwrap_or_default(),
            None => SongSidecar::default(),
        };
        if let Some(copy) = &song.library_copy {
            redirect.insert(copy.to_string_lossy().to_ascii_lowercase(), song.originals[0].clone());
        }
        for target in &song.originals {
            let mut next = old.clone();
            if let Some(score) = &old.score {
                let source = map_path(&score.path.to_string_lossy());
                let name = score_name(&prefs, &song.cid, &score.content_id)
                    .unwrap_or_else(|| format!("{}.musicxml", target.file_stem().unwrap().to_string_lossy()));
                let placed = std::fs::read(&source)
                    .map_err(|e| format!("{}：{e}", source.display()))
                    .and_then(|bytes| place(target.parent().unwrap(), &name, &bytes, a.apply));
                match placed {
                    Ok(path) => {
                        redirect.insert(source.to_string_lossy().to_ascii_lowercase(), path.clone());
                        next.score = Some(ScoreAssociation { path, content_id: score.content_id.clone() });
                    }
                    Err(e) => {
                        println!("! {short} 谱面无法复制：{e}");
                        failures += 1;
                        continue;
                    }
                }
            }
            let has_data = next != SongSidecar::default();
            if a.apply && has_data {
                if let Err(e) = library::save_song_sidecar(target, &song.cid, next.clone()) {
                    println!("! {short} 清单写入失败 {}：{e}", target.display());
                    failures += 1;
                    continue;
                }
                // Read back through the same path the program uses.
                match library::load_song_sidecar(target, &song.cid) {
                    Ok(back) if back == next => {}
                    Ok(back) => {
                        println!("! {short} 清单读回不一致 {}\n  写入 {next:?}\n  读回 {back:?}", target.display());
                        failures += 1;
                        continue;
                    }
                    Err(e) => {
                        println!("! {short} 清单读回失败：{e}");
                        failures += 1;
                        continue;
                    }
                }
            }
            println!(
                "{short} {} → {}{}",
                song.title,
                target.display(),
                if has_data { "（清单）" } else { "（无标注，只有偏好）" }
            );
        }
        recent.push((song.originals[0].clone(), song.title.clone()));
    }

    // Preferences: redirect paths that point into library/.
    let mut changed = 0;
    redirect_paths(&mut prefs, &redirect, &map_path, &mut changed);
    println!("偏好中改写路径 {changed} 处");
    if a.apply {
        let bytes = serde_json::to_vec_pretty(&prefs).unwrap();
        panthesia_core::utils::atomic_file::write(&prefs_path, &bytes).unwrap();
        // Seed the recently-opened list with the migrated songs (the library list is gone).
        let recent_path = a.data.join("recent-files.json");
        if !recent_path.exists() {
            let last = prefs.get("path").and_then(Value::as_str).map(str::to_ascii_lowercase);
            recent.sort_by_key(|(p, _)| Some(p.to_string_lossy().to_ascii_lowercase()) != last);
            let items: Vec<Value> = recent
                .iter()
                .map(|(p, t)| serde_json::json!({"path": p, "title": t, "openedAt": 0}))
                .collect();
            let store = serde_json::json!({"version": 1, "items": items});
            panthesia_core::utils::atomic_file::write(&recent_path, &serde_json::to_vec_pretty(&store).unwrap()).unwrap();
        }
    }
    println!("歌曲 {}，失败 {failures}{}", songs.len(), if a.apply { "" } else { "（预演，未写入）" });
    if failures > 0 {
        std::process::exit(1);
    }
}

fn score_name(prefs: &Value, cid: &str, score: &str) -> Option<String> {
    prefs.get("scoreVersions")?.get(cid)?.as_array()?.iter().find_map(|v| {
        (v.get("contentId")?.as_str()? == score).then(|| v.get("name")?.as_str().map(String::from)).flatten()
    })
}

fn redirect_paths(value: &mut Value, map: &BTreeMap<String, PathBuf>, map_path: &dyn Fn(&str) -> PathBuf, changed: &mut usize) {
    match value {
        Value::String(s) => {
            if let Some(to) = map.get(&map_path(s).to_string_lossy().to_ascii_lowercase()) {
                *s = to.to_string_lossy().to_string();
                *changed += 1;
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|v| redirect_paths(v, map, map_path, changed)),
        Value::Object(fields) => fields.values_mut().for_each(|v| redirect_paths(v, map, map_path, changed)),
        _ => {}
    }
}
