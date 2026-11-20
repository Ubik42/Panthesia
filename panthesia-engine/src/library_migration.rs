//! Bounded offline migration of registered and saved content. Original music and legacy records stay intact.
use crate::{
    library_workspace::Workspace, preferences::Preferences, song_repository::SongRepository,
};
use panthesia_core::{exercise::*, practice_history::PracticeHistoryStore, utils::atomic_file};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    content_id: String,
    title: String,
    source: Option<PathBuf>,
    #[serde(default)]
    managed: Option<PathBuf>,
    #[serde(default)]
    annotation_source: Option<PathBuf>,
    exercise: Option<ExerciseSpec>,
    status: String,
    error: Option<String>,
}
fn digest(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}
fn valid(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn input_hashes(data: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut hashes = BTreeMap::new();
    for name in [
        "web-preferences.json",
        "library-workspace.json",
        "repertoire.json",
        "web-practice-history.ron",
    ] {
        match atomic_file::read_limited(&data.join(name), 256_000_000) {
            Ok(bytes) => {
                hashes.insert(name.into(), digest(&bytes));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(hashes)
}
fn plan(data: &Path) -> Result<Vec<Item>, String> {
    let prefs = Preferences::load(&data.join("web-preferences.json"))?;
    let workspace = Workspace::load(data)?;
    let history = PracticeHistoryStore::load_snapshot(data.join("web-practice-history.ron"))?;
    let mut titles = BTreeMap::<String, String>::new();
    let mut paths = BTreeMap::<String, Vec<PathBuf>>::new();
    let db = data.join("library/songs.sqlite3");
    if db.is_file() {
        let db =
            rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| e.to_string())?;
        let mut query = db
            .prepare("SELECT id,label FROM performances")
            .map_err(|e| e.to_string())?;
        for row in query
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
        {
            let (id, title) = row.map_err(|e| e.to_string())?;
            titles.insert(id, title);
        }
        let mut query=db.prepare("SELECT performance_id,path FROM locations UNION SELECT content_id,path FROM assets").map_err(|e|e.to_string())?;
        for row in query
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
        {
            let (id, path) = row.map_err(|e| e.to_string())?;
            paths.entry(id).or_default().push(path.into());
        }
    }
    for entry in workspace
        .entries
        .values()
        .chain(workspace.retired_entries.values())
    {
        if let Some(id) = &entry.content_id {
            titles.entry(id.clone()).or_insert_with(|| {
                entry.metadata.title.clone().unwrap_or_else(|| {
                    entry
                        .path
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into()
                })
            });
            paths
                .entry(id.clone())
                .or_default()
                .push(entry.path.clone());
        }
    }
    for id in prefs
        .songs
        .keys()
        .chain(prefs.score_versions.keys())
        .chain(prefs.variants.keys())
        .chain(prefs.passages.keys())
        .chain(prefs.bookmarks.keys())
    {
        titles.entry(id.clone()).or_default();
    }
    let mut specs = BTreeMap::new();
    if let Some(spec) = prefs.exercise {
        specs.insert(ExercisePlan::identity(spec), spec);
    }
    for (id, song) in history.iter_songs() {
        titles
            .entry(id.into())
            .or_insert_with(|| song.display_name.clone());
        if let Some(path) = &song.library.source_path {
            paths.entry(id.into()).or_default().push(path.clone());
        }
        if let Some(setup) = &song.setup {
            if let Some(path) = &setup.source_path {
                paths.entry(id.into()).or_default().push(path.clone());
            }
            if let Some(spec) = setup.exercise_spec {
                specs.insert(ExercisePlan::identity(spec), spec);
            }
        }
        for session in &song.sessions {
            if let Some(context) = &session.context {
                if let Some(spec) = context.exercise_spec {
                    specs.insert(ExercisePlan::identity(spec), spec);
                }
                if let Some(path) = &context.source_path {
                    paths.entry(id.into()).or_default().push(path.clone());
                }
            }
        }
    }
    // Recover every valid legacy exercise identity without guessing from a filename or pitch split.
    for tonic in 0..12 {
        for tonality in [ExerciseTonality::Major, ExerciseTonality::Minor] {
            for minor_form in [
                ExerciseMinorForm::Natural,
                ExerciseMinorForm::Harmonic,
                ExerciseMinorForm::Melodic,
            ] {
                for pattern in [
                    ExercisePattern::Scale,
                    ExercisePattern::Arpeggio,
                    ExercisePattern::PrimaryChords,
                ] {
                    for direction in [
                        ExerciseDirection::Ascending,
                        ExerciseDirection::Descending,
                        ExerciseDirection::UpAndDown,
                    ] {
                        for octaves in 1..=3 {
                            let spec = ExerciseSpec {
                                tonic,
                                tonality,
                                minor_form,
                                pattern,
                                direction,
                                octaves,
                                ..Default::default()
                            };
                            let id = ExercisePlan::identity(spec);
                            if titles.contains_key(&id) {
                                specs.entry(id).or_insert(spec);
                            }
                        }
                    }
                }
            }
        }
    }
    for directory in [
        data.to_owned(),
        data.join("imports"),
        data.join("song-assets"),
        data.join("library/assets/midi"),
    ] {
        if let Ok(entries) = std::fs::read_dir(directory) {
            for entry in entries.take(10000) {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                if !entry.file_type().map_err(|e| e.to_string())?.is_file()
                    || path.extension().is_none_or(|s| {
                        !s.eq_ignore_ascii_case("mid") && !s.eq_ignore_ascii_case("midi")
                    })
                {
                    continue;
                }
                let bytes = match atomic_file::read_limited(&path, 32_000_000) {
                    Ok(b) => b,
                    Err(_) => continue,
                };
                let id = digest(&bytes);
                if titles.contains_key(&id) {
                    paths.entry(id).or_default().push(path);
                }
            }
        }
    }
    let recorded = paths.clone();
    // Locate moved files by their recorded basename, then require an exact byte identity below.
    // Only registered roots and the music root of already registered sources are searched.
    let mut names = BTreeMap::<String, BTreeSet<String>>::new();
    for (cid, candidates) in &paths {
        for path in candidates {
            if let Some(name) = path.file_name() {
                names
                    .entry(name.to_string_lossy().to_lowercase())
                    .or_default()
                    .insert(cid.clone());
            }
        }
    }
    let catalog = crate::library::catalog_root();
    let music = catalog.parent().unwrap_or(&catalog).to_owned();
    let normalized = |path: &Path| {
        crate::library_workspace::key(path)
            .trim_start_matches("//?/")
            .to_owned()
    };
    let mut roots = Vec::new();
    if paths
        .values()
        .flatten()
        .any(|path| normalized(path).starts_with(&format!("{}/", normalized(&music))))
    {
        roots.push(music);
    }
    match atomic_file::read_limited(&data.join("library-folders.json"), 4_000_000) {
        Ok(bytes) => {
            roots.extend(serde_json::from_slice::<Vec<PathBuf>>(&bytes).map_err(|e| e.to_string())?)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    roots.extend(["builtin-previous", "packages", "recordings"].map(|name| data.join(name)));
    let mut pending = roots
        .into_iter()
        .map(|root| (root, 0usize))
        .collect::<Vec<_>>();
    let mut visited = BTreeSet::new();
    while let Some((root, depth)) = pending.pop() {
        if !visited.insert(normalized(&root)) {
            continue;
        }
        if visited.len() > 20000 {
            return Err("登记曲库的目录超过迁移发现上限，请拆分迁移范围".into());
        }
        let entries = match std::fs::read_dir(&root) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
        };
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                if depth < 12 {
                    pending.push((path, depth + 1));
                }
            } else if kind.is_file()
                && path.extension().is_some_and(|s| {
                    s.eq_ignore_ascii_case("mid") || s.eq_ignore_ascii_case("midi")
                })
            {
                if let Some(ids) = names.get(&entry.file_name().to_string_lossy().to_lowercase()) {
                    for id in ids {
                        paths.entry(id.clone()).or_default().push(path.clone());
                    }
                } else if !normalized(&path).starts_with(&format!("{}/", normalized(&catalog))) {
                    if let Ok(bytes) = atomic_file::read_limited(&path, 32_000_000) {
                        let id = digest(&bytes);
                        if titles.contains_key(&id) {
                            paths.entry(id).or_default().push(path);
                        }
                    }
                }
            }
        }
    }
    let mut items = Vec::new();
    for (id, title) in titles {
        if !valid(&id) {
            items.push(Item {
                content_id: id,
                title,
                source: None,
                managed: None,
                annotation_source: None,
                exercise: None,
                status: "unmatched".into(),
                error: Some("旧身份不是受支持的内容身份，原记录保持原状".into()),
            });
            continue;
        }
        let mut source = None;
        let mut seen = BTreeSet::new();
        let canonical = SongRepository::managed_path(data, &id)?;
        for path in std::iter::once(canonical).chain(paths.remove(&id).unwrap_or_default()) {
            if !seen.insert(path.clone()) {
                continue;
            }
            if let Ok(bytes) = atomic_file::read_limited(&path, 32_000_000) {
                if digest(&bytes) == id
                    && midi_file::MidiFile::from_path_bytes(&path, &bytes).is_ok()
                {
                    source = Some(path);
                    break;
                }
            }
        }
        let annotation_source = recorded
            .get(&id)
            .into_iter()
            .flatten()
            .find(|path| panthesia_core::library::load_song_sidecar(path, &id).is_ok())
            .cloned();
        let exercise = specs.get(&id).copied();
        let status = if source.is_some() {
            "ready"
        } else if exercise.is_some() {
            "generated"
        } else {
            "unmatched"
        };
        items.push(Item {
            content_id: id,
            title,
            source,
            managed: None,
            annotation_source,
            exercise,
            status: status.into(),
            error: (status == "unmatched")
                .then(|| "登记的位置均未找到相同内容；设置和旧记录保持原状".into()),
        });
    }
    Ok(items)
}
fn snapshot_tree(source: &Path, target: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err(format!("迁移快照不跟随链接：{}", source.display()));
    }
    if meta.is_dir() {
        std::fs::create_dir(target).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            snapshot_tree(&entry.path(), &target.join(entry.file_name()))?;
        }
    } else {
        std::fs::copy(source, target).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn save(output: &Path, value: &Value) -> Result<(), String> {
    atomic_file::write(
        output,
        &serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
/// Requires exclusive ownership. Plan performs read-only discovery; apply takes a cold snapshot first.
pub fn run(profile: &Path, output: &Path, apply: bool) -> Result<Value, String> {
    let data = profile.canonicalize().map_err(|e| e.to_string())?;
    let output = std::path::absolute(output).map_err(|e| e.to_string())?;
    let output = output
        .parent()
        .ok_or("报告缺少父目录")?
        .canonicalize()
        .map_err(|e| e.to_string())?
        .join(output.file_name().ok_or("报告缺少文件名")?);
    if output.starts_with(&data) {
        return Err("迁移回执请存放在用户资料目录之外".into());
    }
    let _lease = crate::data_root_lock::DataRootLock::acquire(&data)?;
    if crate::asset_storage::pending(&data) {
        return Err("资料存在未完成的文件事务，请先恢复软件保存，再迁移".into());
    }
    let inputs = input_hashes(&data)?;
    let items = plan(&data)?;
    let seed = digest(&serde_json::to_vec(&(&data, &inputs, &items)).map_err(|e| e.to_string())?);
    if output.exists() {
        let old: Value =
            serde_json::from_slice(&std::fs::read(&output).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if old["status"] != "planned" || old["seed"] != seed {
            return Err("报告已完成或来源发生变化，请使用新报告文件，原报告保持原状".into());
        }
    }
    let mut report = json!({"version":1,"profile":data,"seed":seed,"inputsBefore":inputs,"status":"planned","items":items});
    save(&output, &report)?;
    if !apply {
        return Ok(report);
    }
    let snapshot = output.with_extension("snapshot");
    std::fs::create_dir(&snapshot).map_err(|e| format!("快照目录已存在或无法创建：{e}"))?;
    for name in [
        "web-preferences.json",
        "library-workspace.json",
        "repertoire.json",
        "web-practice-history.ron",
        "library",
        "metadata-history",
        "legacy-track-reviews",
        "score-sources.json",
    ] {
        let path = data.join(name);
        if path.exists() {
            snapshot_tree(&path, &snapshot.join(name))?;
        }
    }
    save(
        &snapshot.join("inputs.json"),
        &json!({"profile":data,"inputs":inputs,"note":"Exclusive cold snapshot before migration; original source MIDI, scores and legacy sidecars are not rewritten."}),
    )?;
    report["snapshot"] = json!(snapshot);
    report["status"] = json!("applying");
    save(&output, &report)?;
    let mut originals = BTreeMap::<PathBuf, String>::new();
    for item in &items {
        if let Some(source) = &item.source {
            for path in [
                source.clone(),
                panthesia_core::library::legacy_metadata_sidecar_path(source),
                panthesia_core::library::legacy_metadata_sidecar_path(
                    item.annotation_source.as_deref().unwrap_or(source),
                ),
            ] {
                if let Ok(bytes) = atomic_file::read_limited(&path, 32_000_000) {
                    originals.insert(path, digest(&bytes));
                }
            }
        }
    }
    let preferences = Preferences::load(&data.join("web-preferences.json"))?;
    for item in &items {
        for score in preferences
            .score_versions
            .get(&item.content_id)
            .into_iter()
            .flatten()
        {
            if let Ok(bytes) = atomic_file::read_limited(&score.path, 4_000_000) {
                originals.insert(score.path.clone(), digest(&bytes));
            }
        }
    }
    report["sourceInputs"] = json!(
        originals
            .iter()
            .map(|(path, hash)| json!({"path":path,"hash":hash}))
            .collect::<Vec<_>>()
    );
    save(&output, &report)?;
    let mut completed = Vec::new();
    let mut failed = 0usize;
    for mut item in items {
        if item.status == "unmatched" {
            completed.push(item);
            continue;
        }
        let selected = data.clone();
        let cid = item.content_id.clone();
        let (result, writes, observed) = atomic_file::capture_matching(
            std::sync::Arc::new(move |path: &Path| crate::asset_storage::captures(&selected, path)),
            || {
                let mut prefs = Preferences::load(&data.join("web-preferences.json"))?;
                let owned = if let Some(source) = &item.source {
                    crate::owned_annotations::retain_from(
                        &data,
                        item.annotation_source.as_deref().unwrap_or(source),
                        source,
                        &cid,
                        Some(&item.title),
                        &|| Ok(()),
                    )?
                } else {
                    let spec = item.exercise.ok_or("缺少生成练习规格")?;
                    let prepared = crate::exercise_loading::prepare(spec)?;
                    if prepared.file.content_id != cid {
                        return Err("生成练习身份不一致".into());
                    }
                    let mut reader = crate::Player::empty(data.clone(), PathBuf::new(), true);
                    reader.preferences = prefs.clone();
                    crate::legacy_exercise_tracks::capture_before_install(
                        &reader,
                        &prepared.file,
                        spec,
                    )?;
                    let assets = crate::exercise_assets::Prepared::read(
                        &data,
                        &prepared.file,
                        spec,
                        prefs
                            .score_versions
                            .get(&cid)
                            .map(Vec::as_slice)
                            .unwrap_or_default(),
                    )?;
                    assets.store(&data, &cid)?;
                    assets.anchor().to_owned()
                };
                crate::notation_assets::retain_editions(
                    &data,
                    &cid,
                    &owned,
                    prefs.score_versions.entry(cid.clone()).or_default(),
                )?;
                if let Some(settings) = prefs.songs.get_mut(&cid) {
                    settings.parts.clear();
                }
                prefs.save(&data.join("web-preferences.json"))?;
                panthesia_core::library::load_song_sidecar(&owned, &cid)
                    .map_err(|e| e.to_string())?;
                Ok::<PathBuf, String>(owned)
            },
        );
        match result.and_then(|owned| {
            crate::asset_storage::commit(&data, writes, observed)?;
            Ok(owned)
        }) {
            Ok(owned) => {
                item.status = "migrated".into();
                item.managed = Some(owned);
            }
            Err(e) => {
                failed += 1;
                item.status = "failed".into();
                item.error = Some(e);
            }
        }
        completed.push(item);
        report["items"] = json!(completed);
        save(&output, &report)?;
    }
    for (path, before) in &originals {
        if digest(&atomic_file::read_limited(path, 32_000_000).map_err(|e| e.to_string())?)
            != *before
        {
            return Err(format!("源文件在迁移期间发生变化：{}", path.display()));
        }
    }
    let after = input_hashes(&data)?;
    for name in [
        "library-workspace.json",
        "repertoire.json",
        "web-practice-history.ron",
    ] {
        if inputs.get(name) != after.get(name) {
            return Err(format!("旧资料在迁移期间发生变化：{name}"));
        }
    }
    let prefs = Preferences::load(&data.join("web-preferences.json"))?;
    report["unavailableScores"]=json!(completed.iter().flat_map(|item|prefs.score_versions.get(&item.content_id).into_iter().flatten().filter(|score|crate::notation_assets::resolve(&data,&score.content_id).is_none()).map(|score|json!({"contentId":item.content_id,"name":score.name,"source":score.path,"scoreId":score.content_id}))).collect::<Vec<_>>());
    report["items"] = json!(completed);
    report["migrated"] = json!(completed.iter().filter(|i| i.status == "migrated").count());
    report["unmatched"] = json!(completed.iter().filter(|i| i.status == "unmatched").count());
    report["failed"] = json!(failed);
    report["originalInputsUnchanged"] = json!(true);
    report["status"] = json!(if failed == 0 { "complete" } else { "partial" });
    save(&output, &report)?;
    Ok(report)
}
#[cfg(test)]
mod tests {
    use super::*;
    use panthesia_core::{
        library::{self, FingerHint, SongSidecar},
        practice::PracticePart,
    };
    #[test]
    fn saved_library_migrates_file_generated_and_score_assets_with_unmatched_receipt() {
        let root = std::env::temp_dir().join(format!(
            "panthesia-saved-migration-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let data = root.join("profile");
        std::fs::create_dir_all(&data).unwrap();
        let source = root.join("source.mid");
        let bytes = include_bytes!("../assets/five-finger.mid");
        std::fs::write(&source, bytes).unwrap();
        let cid = digest(bytes);
        let mut old = SongSidecar::default();
        old.fingerings.push(FingerHint {
            track_id: 0,
            note_index: 0,
            finger: 4,
        });
        library::save_song_sidecar(&source, &cid, old).unwrap();
        let original_sidecar = std::fs::read(library::metadata_sidecar_path(&source)).unwrap();
        let mut workspace = Workspace::default();
        workspace.inspect(source.clone(), true).unwrap();
        workspace.save(&data).unwrap();
        let spec = ExerciseSpec::default();
        let generated = ExercisePlan::identity(spec);
        let canonical = crate::exercise_assets::canonical_bytes(spec).unwrap();
        let old_cache = crate::import_storage::store_with_identity(
            &data.join("song-assets"),
            &generated,
            &digest(&canonical),
            &generated,
            &canonical,
        )
        .unwrap()
        .path;
        library::save_song_sidecar(&old_cache, &generated, SongSidecar::default()).unwrap();
        let cache_before = std::fs::read(library::metadata_sidecar_path(&old_cache)).unwrap();
        let unknown = digest(b"unmatched saved content");
        let mut prefs = Preferences::default();
        for id in [&cid, &generated, &unknown] {
            prefs
                .songs
                .entry(id.clone())
                .or_default()
                .parts
                .insert(0, PracticePart::LeftHand);
        }
        let score = root.join("score.musicxml");
        let xml = include_bytes!("../assets/starter-pack/five-finger.musicxml");
        std::fs::write(&score, xml).unwrap();
        prefs.score_versions.insert(
            cid.clone(),
            vec![crate::preferences::ScoreVersion {
                id: "owned-fixture-score".into(),
                name: "Practice score".into(),
                path: score.clone(),
                content_id: digest(xml),
            }],
        );
        prefs.save(&data.join("web-preferences.json")).unwrap();
        let relocated = root.join("relocated");
        std::fs::create_dir(&relocated).unwrap();
        let moved = relocated.join("renamed.mid");
        std::fs::rename(&source, &moved).unwrap();
        std::fs::write(
            data.join("library-folders.json"),
            serde_json::to_vec(&vec![relocated]).unwrap(),
        )
        .unwrap();
        let report = root.join("migration.json");
        let planned = run(&data, &report, false).unwrap();
        assert_eq!(planned["status"], "planned");
        assert!(!data.join("library/songs.sqlite3").exists());
        let done = run(&data, &report, true).unwrap();
        assert_eq!(done["status"], "complete");
        assert_eq!(done["migrated"], 2);
        assert_eq!(done["unmatched"], 1);
        assert_eq!(done["failed"], 0);
        assert_eq!(std::fs::read(&moved).unwrap(), bytes);
        assert_eq!(
            std::fs::read(library::metadata_sidecar_path(&source)).unwrap(),
            original_sidecar
        );
        assert_eq!(
            std::fs::read(library::metadata_sidecar_path(&old_cache)).unwrap(),
            cache_before
        );
        assert_eq!(std::fs::read(&score).unwrap(), xml);
        let prefs = Preferences::load(&data.join("web-preferences.json")).unwrap();
        assert!(prefs.songs[&cid].parts.is_empty());
        assert!(prefs.songs[&generated].parts.is_empty());
        assert!(!prefs.songs[&unknown].parts.is_empty());
        assert!(
            prefs.score_versions[&cid][0]
                .path
                .ends_with(format!("library/assets/notation/{}.musicxml", digest(xml)))
        );
        assert!(run(&data, &report, true).is_err());
    }
}
