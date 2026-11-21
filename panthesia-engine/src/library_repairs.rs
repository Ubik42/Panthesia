use crate::{
    library,
    library_workspace::{Entry, Workspace, key, lock_for},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkRecord {
    pub content_id: String,
    pub from: PathBuf,
    pub to: PathBuf,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkItem {
    pub content_id: String,
    pub from: PathBuf,
    pub to: PathBuf,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPathState {
    pub content_id: String,
    pub path: PathBuf,
    pub linked_to: Option<PathBuf>,
    pub ignored: bool,
    pub preferred_path: Option<PathBuf>,
    pub known: bool,
    pub revision: u64,
}
pub(crate) fn read_path(
    data: &Path,
    content_id: &str,
    path: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    if content_id.len() != 64 || !content_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("曲目内容身份无效".into());
    }
    let lock = lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    let workspace = Workspace::load(data)?;
    check()?;
    let record = record_key(content_id, path);
    serde_json::to_value(LibraryPathState {
        content_id: content_id.into(),
        path: path.into(),
        linked_to: workspace
            .path_relinks
            .get(&record)
            .filter(|row| row.content_id == content_id)
            .map(|row| row.to.clone()),
        ignored: workspace.ignored_paths.contains(&record),
        preferred_path: workspace.preferred_paths.get(content_id).cloned(),
        known: source_entry(&workspace, content_id, path).is_some(),
        revision: workspace.revision,
    })
    .map_err(|e| e.to_string())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementReview {
    pub old_content_id: String,
    pub new_content_id: String,
    pub action: String,
    pub target: Option<PathBuf>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiReplacementRow {
    pub path: PathBuf,
    pub title: String,
    pub old_content_id: String,
    pub new_content_id: String,
    pub old_notes: usize,
    pub new_notes: usize,
    pub old_duration: f64,
    pub new_duration: f64,
    pub old_tracks: usize,
    pub new_tracks: usize,
    pub candidates: Vec<PathBuf>,
    pub review: Option<ReplacementReview>,
    pub reviewed: bool,
    pub available: bool,
    pub error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiReplacementPage {
    pub rows: Vec<MidiReplacementRow>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub revision: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementComparison {
    pub matched: usize,
    pub old_only: usize,
    pub new_only: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiReplacementPreview {
    pub path: PathBuf,
    pub old_content_id: String,
    pub new_content_id: String,
    pub old_notes: usize,
    pub new_notes: usize,
    pub old_duration: f64,
    pub new_duration: f64,
    pub old_tracks: usize,
    pub new_tracks: usize,
    pub candidates: Vec<PathBuf>,
    pub exact: Option<ReplacementComparison>,
    pub old_source: Option<PathBuf>,
    pub token: String,
    pub revision: u64,
    pub review: Option<ReplacementReview>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRepairResult {
    pub content_id: String,
    pub from: PathBuf,
    pub to: PathBuf,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<String>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRelinkResult {
    pub results: Vec<LibraryRepairResult>,
    pub revision: u64,
}
pub(crate) fn history_locations(
    history: &panthesia_core::practice_history::PracticeHistoryStore,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    let mut songs = Vec::new();
    for (id, song) in history.iter_songs() {
        check()?;
        if song
            .setup
            .as_ref()
            .is_some_and(|setup| setup.exercise_spec.is_some())
        {
            continue;
        }
        songs.push(json!({"contentId":id,"title":song.display_name,"storedPath":song.library.source_path.as_ref().or_else(||song.setup.as_ref().and_then(|setup|setup.source_path.as_ref())),"generated":false}));
    }
    Ok(json!({"songs":songs}))
}
fn seed_missing_history(
    w: &mut Workspace,
    data: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<(), String> {
    let history = panthesia_core::practice_history::PracticeHistoryStore::load_snapshot(
        data.join("web-practice-history.ron"),
    )?;
    check()?;
    for (id, song) in history.iter_songs() {
        check()?;
        if song
            .setup
            .as_ref()
            .is_some_and(|setup| setup.exercise_spec.is_some())
        {
            continue;
        }
        if let Some(path) = song.library.source_path.as_ref().or_else(|| {
            song.setup
                .as_ref()
                .and_then(|setup| setup.source_path.as_ref())
        }) {
            seed_history_entry(w, id, path, &song.display_name);
        }
    }
    Ok(())
}
fn seed_history_entry(w: &mut Workspace, id: &str, path: &Path, title: &str) -> bool {
    if source_entry(w, id, path).is_some() {
        return false;
    }
    let entry = Entry {
        path: path.into(),
        content_id: Some(id.into()),
        available: path.is_file(),
        metadata: panthesia_core::library::SongMetadata {
            title: Some(title.into()),
            ..Default::default()
        },
        ..Default::default()
    };
    if w.entries.contains_key(&key(path)) {
        w.retired_entries.insert(record_key(id, path), entry);
    } else {
        w.entries.insert(key(path), entry);
    }
    true
}

fn repair_midi(path: &Path) -> Result<panthesia_music::MidiFile, String> {
    library::read_midi_limited(path, 32_000_000)
}
fn replacement_candidates(
    w: &Workspace,
    old_id: &str,
    replaced: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Vec<PathBuf>, String> {
    let mut result = Vec::new();
    for entry in w
        .entries
        .values()
        .filter(|e| e.content_id.as_deref() == Some(old_id) && key(&e.path) != key(replaced))
    {
        check()?;
        let path = std::path::absolute(&entry.path).map_err(|e| e.to_string())?;
        if let Ok(bytes) = panthesia_core::utils::atomic_file::read_hint(&path, 32_000_000) {
            if blake3::hash(&bytes).to_hex().as_str() == old_id {
                result.push(entry.path.clone());
            }
        }
    }
    check()?;
    Ok(result)
}

pub fn replacements(
    data: &Path,
    query: &str,
    include_reviewed: bool,
    offset: usize,
    limit: usize,
) -> Result<Value, String> {
    replacements_checked(data, query, include_reviewed, offset, limit, &|| Ok(()))
}
pub(crate) fn replacements_checked(
    data: &Path,
    query: &str,
    include_reviewed: bool,
    offset: usize,
    limit: usize,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    let lock = lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    let w = Workspace::load(data)?;
    let mut rows = Vec::new();
    for (record, old) in &w.retired_entries {
        check()?;
        let Some(old_id) = old.content_id.as_ref() else {
            continue;
        };
        let Some(current) = w.entries.get(&key(&old.path)) else {
            continue;
        };
        let Some(new_id) = current.content_id.as_ref() else {
            continue;
        };
        if current.analysis_version != 2 {
            continue;
        }
        if old_id == new_id {
            continue;
        }
        let review = w
            .replacement_reviews
            .get(record)
            .filter(|r| &r.new_content_id == new_id);
        if review.is_some() && !include_reviewed {
            continue;
        }
        let title = old
            .metadata
            .title
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                old.path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into()
            });
        let haystack = format!("{title} {} {old_id} {new_id}", old.path.display()).to_lowercase();
        if !query
            .to_lowercase()
            .split_whitespace()
            .all(|t| haystack.contains(t))
        {
            continue;
        }
        rows.push(MidiReplacementRow {
            path: old.path.clone(),
            title,
            old_content_id: old_id.clone(),
            new_content_id: new_id.clone(),
            old_notes: old.notes,
            new_notes: current.notes,
            old_duration: old.duration,
            new_duration: current.duration,
            old_tracks: old.tracks,
            new_tracks: current.tracks,
            candidates: Vec::new(),
            review: review.cloned(),
            reviewed: review.is_some(),
            available: current.available,
            error: current.error.clone(),
        });
    }
    rows.sort_by(|a, b| a.title.cmp(&b.title).then(a.path.cmp(&b.path)));
    let total = rows.len();
    let limit = limit.clamp(1, 100);
    let offset = offset.min(total.saturating_sub(1) / limit * limit);
    let mut page = rows
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let mut candidate_cache = BTreeMap::new();
    for row in &mut page {
        check()?;
        if !candidate_cache.contains_key(&row.old_content_id) {
            candidate_cache.insert(
                row.old_content_id.clone(),
                replacement_candidates(&w, &row.old_content_id, &row.path, check)?,
            );
        }
        row.candidates = candidate_cache
            .get(&row.old_content_id)
            .cloned()
            .unwrap_or_default();
    }
    serde_json::to_value(MidiReplacementPage {
        rows: page,
        total,
        offset,
        limit,
        revision: w.revision,
    })
    .map_err(|e| e.to_string())
}

fn replacement_state(
    w: &Workspace,
    path: &Path,
    old_id: &str,
    new_id: &str,
) -> Result<(Entry, panthesia_music::MidiFile), String> {
    let old = w
        .retired_entries
        .get(&record_key(old_id, path))
        .filter(|e| e.content_id.as_deref() == Some(old_id))
        .cloned()
        .ok_or("旧曲目身份已改变，请刷新文件位置")?;
    let current = w
        .entries
        .get(&key(path))
        .ok_or("当前文件尚未索引，请先检查文件位置")?;
    if current.content_id.as_deref() != Some(new_id) {
        return Err("当前曲目身份已改变，请刷新文件位置".into());
    }
    let stat = std::fs::metadata(path).map_err(|e| format!("当前文件无法读取：{e}"))?;
    if !stat.is_file() || stat.len() > 32_000_000 {
        return Err("当前 MIDI 需要是 32 MB 以内的文件".into());
    }
    let file = repair_midi(path)?;
    if file.content_id != new_id {
        return Err("MIDI 文件在索引后发生变化，请先重新检查文件位置".into());
    }
    Ok((old, file))
}
fn replacement_token(
    w: &Workspace,
    path: &Path,
    old_id: &str,
    new_id: &str,
) -> Result<String, String> {
    let old_key = record_key(old_id, path);
    let state = json!({"path":key(path),"old":old_id,"new":new_id,
        "review":w.replacement_reviews.get(&old_key),"linked":w.path_relinks.get(&old_key),
        "primary":w.preferred_paths.get(old_id),"oldIgnored":w.ignored_paths.contains(&old_key),
        "newIgnored":w.ignored_paths.contains(&record_key(new_id,path))});
    serde_json::to_vec(&state)
        .map(|bytes| blake3::hash(&bytes).to_hex().to_string())
        .map_err(|e| e.to_string())
}

fn notes(
    file: &panthesia_music::MidiFile,
    check: &impl Fn() -> Result<(), String>,
) -> Result<BTreeMap<(usize, u8, u8, u8, u64, u64), usize>, String> {
    let mut notes = BTreeMap::new();
    for track in file.tracks.iter() {
        for n in track.notes.iter() {
            check()?;
            *notes
                .entry((
                    track.track_id,
                    n.note,
                    n.velocity,
                    n.channel,
                    n.start.as_micros().min(u64::MAX as u128) as u64,
                    n.end.as_micros().min(u64::MAX as u128) as u64,
                ))
                .or_default() += 1;
        }
    }
    Ok(notes)
}

pub fn preview_replacement(
    data: &Path,
    path: &Path,
    old_id: &str,
    new_id: &str,
) -> Result<Value, String> {
    preview_replacement_checked(data, path, old_id, new_id, &|| Ok(()))
}
pub(crate) fn preview_replacement_checked(
    data: &Path,
    path: &Path,
    old_id: &str,
    new_id: &str,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    let lock = lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    let w = Workspace::load(data)?;
    let (old, new_file) = replacement_state(&w, path, old_id, new_id)?;
    let candidates = replacement_candidates(&w, old_id, path, check)?;
    let mut old_file = None;
    for candidate in &candidates {
        check()?;
        if let Ok(file) = repair_midi(candidate) {
            if file.content_id == old_id {
                old_file = Some(file);
                break;
            }
        }
    }
    let exact = old_file
        .as_ref()
        .map(|file| {
            let a = notes(file, check)?;
            let b = notes(&new_file, check)?;
            let common = a
                .iter()
                .map(|(k, count)| count.min(b.get(k).unwrap_or(&0)))
                .sum::<usize>();
            Ok::<_, String>(ReplacementComparison {
                matched: common,
                old_only: a.values().sum::<usize>() - common,
                new_only: b.values().sum::<usize>() - common,
            })
        })
        .transpose()?;
    let token = replacement_token(&w, path, old_id, new_id)?;
    serde_json::to_value(MidiReplacementPreview {
        path: path.into(),
        old_content_id: old_id.into(),
        new_content_id: new_id.into(),
        old_notes: old.notes,
        new_notes: new_file.tracks.iter().map(|track| track.notes.len()).sum(),
        old_duration: old.duration,
        new_duration: new_file.duration.as_secs_f64(),
        old_tracks: old.tracks,
        new_tracks: new_file
            .tracks
            .iter()
            .filter(|track| !track.notes.is_empty())
            .count(),
        exact,
        old_source: old_file.as_ref().and_then(|file| file.source_path.clone()),
        candidates,
        token,
        revision: w.revision,
        review: w
            .replacement_reviews
            .get(&record_key(old_id, path))
            .cloned(),
    })
    .map_err(|e| e.to_string())
}

pub fn decide_replacement(
    data: &Path,
    path: &Path,
    old_id: &str,
    new_id: &str,
    token: &str,
    action: &str,
    target: Option<PathBuf>,
) -> Result<Value, String> {
    decide_replacement_checked(
        data,
        path,
        old_id,
        new_id,
        token,
        action,
        target,
        &|| Ok(()),
    )
}
pub(crate) fn decide_replacement_checked(
    data: &Path,
    path: &Path,
    old_id: &str,
    new_id: &str,
    token: &str,
    action: &str,
    target: Option<PathBuf>,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    if !matches!(action, "keep" | "new" | "relink") {
        return Err("请选择有效的文件处理方式".into());
    }
    let lock = lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    let mut w = Workspace::load(data)?;
    let expected = replacement_token(&w, path, old_id, new_id)?;
    if expected != token {
        return Err("文件位置在预览后发生变化，请重新预览".into());
    }
    replacement_state(&w, path, old_id, new_id)?;
    let target = if action == "relink" {
        let to = target.ok_or("请选择保存旧曲目内容的位置")?;
        if key(path) == key(&to)
            || !w
                .entries
                .get(&key(&to))
                .is_some_and(|entry| entry.content_id.as_deref() == Some(old_id))
            || repair_midi(&to)?.content_id != old_id
        {
            return Err("所选位置不再包含旧曲目内容，请重新预览".into());
        }
        relink_one(
            data,&mut w,
            &RelinkItem {
                content_id: old_id.into(),
                from: path.into(),
                to: to.clone(),
            },
            check,
        )?;
        Some(to)
    } else {
        None
    };
    let new_key = record_key(new_id, path);
    if action == "keep" {
        w.ignored_paths.insert(new_key);
    } else {
        w.ignored_paths.remove(&new_key);
    }
    w.replacement_reviews.insert(
        record_key(old_id, path),
        ReplacementReview {
            old_content_id: old_id.into(),
            new_content_id: new_id.into(),
            action: action.into(),
            target,
        },
    );
    check()?;
    w.save(data)?;
    Ok(json!({"ok":true,"revision":w.revision,"action":action}))
}
pub fn page_size() -> usize {
    50
}
pub fn record_key(id: &str, path: &Path) -> String {
    format!("{id}|{}", key(path))
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairLocation {
    path: PathBuf,
    present: bool,
    available: bool,
    verified: bool,
    reason: String,
    resolved: bool,
    ignored: bool,
    relinked_to: Option<PathBuf>,
    primary: bool,
    rating: u8,
    has_score: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairGroup {
    content_id: String,
    title: String,
    primary_path: Option<PathBuf>,
    preferred_path: Option<PathBuf>,
    paths: Vec<RepairLocation>,
    candidates: Vec<PathBuf>,
    missing: usize,
    unverified: usize,
    available: usize,
    resolved: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairInventory {
    pub groups: Vec<RepairGroup>,
    pub total: usize,
    pub missing_files: usize,
    pub duplicate_groups: usize,
    pub unverified_files: usize,
    pub resolved_files: usize,
    pub replacement_count: usize,
    pub offset: usize,
    pub limit: usize,
    pub revision: u64,
}
pub fn source_entry(w: &Workspace, id: &str, path: &Path) -> Option<Entry> {
    w.entries
        .get(&key(path))
        .filter(|e| e.content_id.as_deref() == Some(id))
        .cloned()
        .or_else(|| w.retired_entries.get(&record_key(id, path)).cloned())
}
pub fn link_target<'a>(w: &'a Workspace, id: &str, path: &Path) -> Option<&'a Path> {
    w.path_relinks
        .get(&record_key(id, path))
        .filter(|r| {
            r.to.is_file()
                && w.entries
                    .get(&key(&r.to))
                    .is_some_and(|e| e.content_id.as_deref() == Some(id))
        })
        .map(|r| r.to.as_path())
}
pub fn query(
    data: &Path,
    known: &Value,
    query: &str,
    kind: &str,
    include_resolved: bool,
    offset: usize,
    limit: usize,
) -> Result<Value, String> {
    query_checked(
        data,
        known,
        query,
        kind,
        include_resolved,
        offset,
        limit,
        true,
        &|| Ok(()),
    )
}
pub(crate) fn query_checked(
    data: &Path,
    known: &Value,
    query: &str,
    kind: &str,
    include_resolved: bool,
    offset: usize,
    limit: usize,
    persist: bool,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    let lock = lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    let mut w = Workspace::load(data)?;
    let mut seeded = false;
    let mut titles = BTreeMap::new();
    let mut history_paths = Vec::new();
    for h in known["songs"].as_array().into_iter().flatten() {
        check()?;
        if h["generated"].as_bool() == Some(true) {
            continue;
        }
        let (Some(id), Some(path)) = (h["contentId"].as_str(), h["storedPath"].as_str()) else {
            continue;
        };
        titles.insert(
            id.to_string(),
            h["title"].as_str().unwrap_or("曲目").to_string(),
        );
        let path = PathBuf::from(path);
        history_paths.push((id.to_string(), path.clone()));
        seeded |= seed_history_entry(&mut w, id, &path, h["title"].as_str().unwrap_or("曲目"));
    }
    if seeded && persist {
        check()?;
        w.save(data)?;
    }
    let mut content_paths: BTreeMap<String, BTreeMap<String, PathBuf>> = BTreeMap::new();
    for e in w.entries.values().chain(w.retired_entries.values()) {
        check()?;
        if let Some(id) = e.content_id.as_ref() {
            content_paths
                .entry(id.clone())
                .or_default()
                .insert(key(&e.path), e.path.clone());
        }
    }
    for (id, path) in history_paths {
        check()?;
        content_paths
            .entry(id)
            .or_default()
            .insert(key(&path), path);
    }
    for r in w.path_relinks.values() {
        check()?;
        let paths = content_paths.entry(r.content_id.clone()).or_default();
        paths.insert(key(&r.from), r.from.clone());
        paths.insert(key(&r.to), r.to.clone());
    }
    let mut groups = Vec::new();
    let mut replacement_count = 0;
    for (record, old) in &w.retired_entries {
        check()?;
        let Some(old_id) = old.content_id.as_ref() else { continue };
        let Some(current) = w.entries.get(&key(&old.path)) else { continue };
        if current.analysis_version != 2 { continue; }
        if current.content_id.as_ref().is_some_and(|new_id| new_id != old_id &&
            !w.replacement_reviews.get(record).is_some_and(|review| &review.new_content_id == new_id)) {
            replacement_count += 1;
        }
    }
    let mut missing_files = 0;
    let mut duplicate_groups = 0;
    let mut unverified_files = 0;
    let mut resolved_files = 0;
    for (id, paths) in content_paths {
        check()?;
        let primary = w
            .preferred_paths
            .get(&id)
            .filter(|path| {
                path.is_file()
                    && w.entries
                        .get(&key(path))
                        .is_some_and(|entry| entry.content_id.as_deref() == Some(&id))
            })
            .cloned()
            .or_else(|| {
                let available = paths
                    .values()
                    .filter(|path| {
                        path.is_file()
                            && w.entries
                                .get(&key(path))
                                .is_some_and(|entry| entry.content_id.as_deref() == Some(&id))
                    })
                    .collect::<Vec<_>>();
                available
                    .iter()
                    .find(|path| link_target(&w, &id, path).is_none())
                    .or(available.first())
                    .map(|path| (*path).clone())
            });
        let mut locations = Vec::new();
        let mut candidates = Vec::new();
        for path in paths.values() {
            check()?;
            let actual = w.entries.get(&key(path));
            let e = source_entry(&w, &id, path);
            let stat = std::fs::metadata(path).ok();
            let present = stat.as_ref().is_some_and(|s| s.is_file());
            let modified = stat
                .as_ref()
                .and_then(|s| s.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos().min(u64::MAX as u128) as u64);
            let verified = actual.is_some_and(|e| {
                e.analysis_version == 2
                    && e.content_id.is_some()
                    && (!present
                        || (e.modified == modified
                            && stat.as_ref().is_some_and(|s| s.len() == e.size)))
            });
            let available =
                present && verified && actual.is_some_and(|e| e.content_id.as_deref() == Some(&id));
            if available {
                candidates.push(path.clone());
            }
            let target = link_target(&w, &id, path).map(Path::to_owned);
            let resolved = target.is_some();
            let ignored = w.ignored_paths.contains(&record_key(&id, path));
            let reason = if !present {
                "文件缺失"
            } else if !verified {
                "等待内容核对"
            } else if !available {
                "该位置内容已改变"
            } else if actual.is_some_and(|e| e.error.is_some()) {
                "附加信息需要处理"
            } else {
                "可用"
            }
            .to_string();
            locations.push(RepairLocation {
                path: path.clone(),
                present,
                available,
                verified,
                reason,
                resolved,
                ignored,
                relinked_to: target,
                primary: primary.as_ref().is_some_and(|p| key(p) == key(path)),
                rating: e.as_ref().map_or(0, |e| e.rating),
                has_score: e.as_ref().is_some_and(|e| e.has_score),
            });
        }
        let missing = locations
            .iter()
            .filter(|p| (!p.present || (p.verified && !p.available)) && !p.resolved && !p.ignored)
            .count();
        let unverified = locations
            .iter()
            .filter(|p| p.present && !p.verified && !p.resolved && !p.ignored)
            .count();
        let available = candidates.len();
        let resolved = locations.iter().filter(|p| p.resolved || p.ignored).count();
        missing_files += missing;
        unverified_files += unverified;
        resolved_files += resolved;
        if available > 1 {
            duplicate_groups += 1;
        }
        let title = primary
            .as_ref()
            .and_then(|p| source_entry(&w, &id, p))
            .and_then(|e| e.metadata.title)
            .or_else(|| {
                paths
                    .values()
                    .find_map(|p| source_entry(&w, &id, p).and_then(|e| e.metadata.title))
            })
            .or_else(|| titles.get(&id).cloned())
            .unwrap_or_else(|| {
                paths
                    .values()
                    .next()
                    .and_then(|p| p.file_stem())
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into()
            });
        let chosen = match kind {
            "duplicates" => available > 1,
            "unverified" => unverified > 0,
            "resolved" => resolved > 0,
            _ => missing > 0 || (include_resolved && resolved > 0),
        };
        if !chosen {
            continue;
        }
        let text = format!(
            "{title} {id} {}",
            paths
                .values()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(" ")
        )
        .to_lowercase();
        if !query
            .to_lowercase()
            .split_whitespace()
            .all(|t| text.contains(t))
        {
            continue;
        }
        let preferred_path = w.preferred_paths.get(&id).cloned();
        groups.push(RepairGroup {
            content_id: id,
            title,
            primary_path: primary,
            preferred_path,
            paths: locations,
            candidates,
            missing,
            unverified,
            available,
            resolved,
        });
    }
    groups.sort_by(|a, b| a.title.cmp(&b.title).then(a.content_id.cmp(&b.content_id)));
    let total = groups.len();
    let limit = limit.clamp(1, 100);
    let offset = offset.min(total.saturating_sub(1) / limit * limit);
    serde_json::to_value(RepairInventory {
        groups: groups.into_iter().skip(offset).take(limit).collect(),
        total,
        missing_files,
        duplicate_groups,
        unverified_files,
        resolved_files,
        replacement_count,
        offset,
        limit,
        revision: w.revision,
    })
    .map_err(|e| e.to_string())
}
fn fill_metadata(
    target: &mut panthesia_core::library::SongMetadata,
    source: &panthesia_core::library::SongMetadata,
) {
    for (a, b) in [
        (&mut target.title, &source.title),
        (&mut target.composer, &source.composer),
        (&mut target.artist, &source.artist),
        (&mut target.collection, &source.collection),
        (&mut target.difficulty, &source.difficulty),
        (&mut target.notes, &source.notes),
    ] {
        if a.is_none() {
            *a = b.clone();
        }
    }
    for tag in &source.tags {
        if !target.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
            target.tags.push(tag.clone());
        }
    }
}
fn relink_one(
    data:&Path,
    w: &mut Workspace,
    item: &RelinkItem,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Vec<String>, String> {
    if key(&item.from) == key(&item.to) {
        return Err("原位置与新位置相同".into());
    }
    let source = source_entry(w, &item.content_id, &item.from)
        .ok_or("原曲目身份不在文件记录中，请先核对或导入原记录")?;
    let stat = std::fs::metadata(&item.to).map_err(|e| format!("新位置无法读取：{e}"))?;
    if !stat.is_file() || stat.len() > 32_000_000 {
        return Err("新位置需要是 32 MB 以内的 MIDI 文件".into());
    }
    let parsed = repair_midi(&item.to)?;
    if parsed.content_id != item.content_id {
        if w.entries.contains_key(&key(&item.to)) {
            w.inspect(item.to.clone(), true)?;
        }
        return Err("新位置与原曲目的 MIDI 内容不同，未关联".into());
    }
    check()?;
    let mut warnings = Vec::new();
    let mut annotation_ok = true;
    if let Err(e) = library::recover_annotations(data,&item.from, &item.to, &item.content_id) {
        warnings.push(format!("附加信息未合并：{e}"));
        annotation_ok = false;
    }
    check()?;
    let mut target = w.inspect(item.to.clone(), true)?;
    check()?;
    if target.content_id.as_deref() != Some(item.content_id.as_str()) {
        return Err("新位置内容在处理期间改变，未关联".into());
    }
    for group in &source.groups {
        if w.groups.iter().any(|g| &g.id == group) && !target.groups.contains(group) {
            target.groups.push(group.clone());
        }
    }
    target.rating = target.rating.max(source.rating);
    fill_metadata(&mut target.metadata, &source.metadata);
    if annotation_ok {
        let owned=crate::owned_annotations::retain(data,&item.to,&item.content_id,check)?;
        if let Err(e) = panthesia_core::library::save_song_metadata(
            &owned,
            &item.content_id,
            target.metadata.clone(),
        ) {
            warnings.push(format!("元数据未写入：{e}"));
        }
    }
    w.entries.insert(key(&item.to), target.clone());
    for alias in w
        .entries
        .values_mut()
        .filter(|e| e.content_id.as_deref() == Some(item.content_id.as_str()))
    {
        check()?;
        alias.groups = target.groups.clone();
        alias.rating = target.rating;
    }
    w.ignored_paths
        .remove(&record_key(&item.content_id, &item.from));
    w.ignored_paths
        .remove(&record_key(&item.content_id, &item.to));
    w.path_relinks
        .remove(&record_key(&item.content_id, &item.to));
    w.path_relinks.insert(
        record_key(&item.content_id, &item.from),
        RelinkRecord {
            content_id: item.content_id.clone(),
            from: item.from.clone(),
            to: item.to.clone(),
        },
    );
    w.preferred_paths
        .insert(item.content_id.clone(), item.to.clone());
    Ok(warnings)
}
pub fn relink(data: &Path, items: Vec<RelinkItem>) -> Result<Value, String> {
    relink_checked(data, items, &|| Ok(()))
}
pub(crate) fn relink_checked(
    data: &Path,
    items: Vec<RelinkItem>,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    if items.is_empty() || items.len() > 100 {
        return Err("一次选择 1～100 个文件位置".into());
    }
    let lock = lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    let mut w = Workspace::load(data)?;
    if items
        .iter()
        .any(|item| source_entry(&w, &item.content_id, &item.from).is_none())
    {
        seed_missing_history(&mut w, data, check)?;
    }
    let mut results = Vec::new();
    let mut seen = BTreeSet::new();
    for item in items {
        if !seen.insert(record_key(&item.content_id, &item.from)) {
            continue;
        }
        check()?;
        let result =
            panthesia_core::utils::atomic_file::with_savepoint(|| relink_one(data,&mut w, &item, check));
        check()?;
        let (ok, error, warnings) = match result {
            Ok(warnings) => (true, None, warnings),
            Err(error) => (false, Some(error), Vec::new()),
        };
        results.push(LibraryRepairResult {
            content_id: item.content_id,
            from: item.from,
            to: item.to,
            ok,
            error,
            warnings: ok.then_some(warnings),
        });
    }
    check()?;
    w.save(data)?;
    serde_json::to_value(LibraryRelinkResult {
        results,
        revision: w.revision,
    })
    .map_err(|e| e.to_string())
}
pub fn set_primary(data: &Path, id: &str, path: Option<PathBuf>) -> Result<Value, String> {
    set_primary_checked(data, id, path, &|| Ok(()))
}
pub(crate) fn set_primary_checked(
    data: &Path,
    id: &str,
    path: Option<PathBuf>,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    let lock = lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    let mut w = Workspace::load(data)?;
    if let Some(path) = path {
        let e = w.entries.get(&key(&path)).ok_or("位置尚未索引")?;
        if e.content_id.as_deref() != Some(id) {
            return Err("该位置不属于这首曲目".into());
        }
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 32_000_000 {
            return Err("MIDI 超过 32 MB".into());
        }
        let file = repair_midi(&path)?;
        if file.content_id != id {
            return Err("该位置的实际内容已改变，未设定".into());
        }
        w.preferred_paths.insert(id.into(), path);
    } else {
        w.preferred_paths.remove(id);
    }
    check()?;
    w.save(data)?;
    Ok(json!({"ok":true}))
}
pub fn ignore_path(data: &Path, id: &str, path: &Path) -> Result<Value, String> {
    ignore_path_checked(data, id, path, &|| Ok(()))
}
pub(crate) fn ignore_path_checked(
    data: &Path,
    id: &str,
    path: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    let lock = lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    let mut w = Workspace::load(data)?;
    if source_entry(&w, id, path).is_none() {
        seed_missing_history(&mut w, data, check)?;
    }
    if source_entry(&w, id, path).is_none() {
        return Err("旧位置没有已知的曲目身份，请先核对内容".into());
    }
    if repair_midi(path).is_ok_and(|file| file.content_id == id) {
        return Err("该位置仍有可用曲目，请使用合并显示".into());
    }
    w.ignored_paths.insert(record_key(id, path));
    check()?;
    w.save(data)?;
    Ok(json!({"ok":true}))
}
pub fn restore_path(data: &Path, id: &str, path: &Path) -> Result<Value, String> {
    restore_path_checked(data, id, path, &|| Ok(()))
}
pub(crate) fn restore_path_checked(
    data: &Path,
    id: &str,
    path: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    let lock = lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    let mut w = Workspace::load(data)?;
    w.path_relinks.remove(&record_key(id, path));
    w.ignored_paths.remove(&record_key(id, path));
    check()?;
    w.save(data)?;
    Ok(json!({"ok":true}))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, PathBuf, PathBuf, String) {
        let root = std::env::temp_dir().join(format!(
            "neothesia-repair-{}-{:?}-{}",
            std::process::id(),
            std::thread::current().id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let old = root.join("old.mid");
        let new = root.join("new.mid");
        std::fs::write(&old, include_bytes!("../assets/five-finger.mid")).unwrap();
        std::fs::copy(&old, &new).unwrap();
        let mut w = Workspace::default();
        let e = w.inspect(old.clone(), false).unwrap();
        let id = e.content_id.unwrap();
        let group = w.group(None, "课后练习".into(), None).unwrap();
        w.assign(vec![old.clone()], Some(group), Some(4)).unwrap();
        w.inspect(new.clone(), false).unwrap();
        w.save(&root).unwrap();
        (root, old, new, id)
    }
    #[test]
    fn relinks_keep_identity_grouping_primary_annotations_and_restore_display() {
        let (data, old, new, id) = fixture();
        let mut side = panthesia_core::library::SongSidecar::default();
        side.fingerings.push(panthesia_core::library::FingerHint {
            track_id: 1,
            note_index: 0,
            finger: 4,
        });
        side.metadata.title = Some("教学曲".into());
        panthesia_core::library::save_song_sidecar(&old, &id, side).unwrap();
        std::fs::remove_file(&old).unwrap();
        let r = relink(
            &data,
            vec![RelinkItem {
                content_id: id.clone(),
                from: old.clone(),
                to: new.clone(),
            }],
        )
        .unwrap();
        assert_eq!(r["results"][0]["ok"], true);
        let w = Workspace::load(&data).unwrap();
        assert_eq!(w.entries[&key(&new)].rating, 4);
        assert_eq!(w.entries[&key(&new)].groups.len(), 1);
        assert_eq!(
            library::available_path(&w, &id, Some(&old)),
            Some(new.clone())
        );
        assert_eq!(
            panthesia_core::library::load_song_sidecar(&new, &id)
                .unwrap()
                .fingerings[0]
                .finger,
            4
        );
        let q = query(&data, &json!({"songs":[]}), "", "missing", false, 0, 50).unwrap();
        assert_eq!(q["missingFiles"], 0);
        assert_eq!(q["resolvedFiles"], 1);
        restore_path(&data, &id, &old).unwrap();
        assert_eq!(
            query(&data, &json!({"songs":[]}), "", "missing", false, 0, 50).unwrap()["missingFiles"],
            1
        );
    }
    #[test]
    fn replacement_archive_keeps_old_identity_and_invalid_middle_never_inherits_groups() {
        let (data, old, new, id) = fixture();
        std::fs::write(&old, b"unfinished").unwrap();
        let mut w = Workspace::load(&data).unwrap();
        w.inspect(old.clone(), true).unwrap();
        std::fs::write(&old, include_bytes!("../assets/basic-chords.mid")).unwrap();
        let changed = w.inspect(old.clone(), true).unwrap();
        assert_ne!(changed.content_id.as_ref(), Some(&id));
        assert!(changed.groups.is_empty());
        assert_eq!(changed.rating, 0);
        w.save(&data).unwrap();
        let result = relink(
            &data,
            vec![RelinkItem {
                content_id: id.clone(),
                from: old.clone(),
                to: new.clone(),
            }],
        )
        .unwrap();
        assert_eq!(result["results"][0]["ok"], true);
        let w = Workspace::load(&data).unwrap();
        assert_eq!(w.entries[&key(&old)].content_id, changed.content_id);
        assert_eq!(w.entries[&key(&new)].rating, 4);
    }
    #[test]
    fn replacement_review_keeps_identities_separate_and_rejects_stale_files() {
        let (data, path, duplicate, old_id) = fixture();
        let mut side = panthesia_core::library::SongSidecar::default();
        side.fingerings.push(panthesia_core::library::FingerHint { track_id:1,note_index:0,finger:3 });
        panthesia_core::library::save_song_sidecar(&path,&old_id,side).unwrap();
        std::fs::write(&path,include_bytes!("../assets/basic-chords.mid")).unwrap();
        let mut w=Workspace::load(&data).unwrap();
        let current=w.inspect(path.clone(),true).unwrap();
        let new_id=current.content_id.unwrap();
        assert_ne!(old_id,new_id);
        assert!(current.groups.is_empty());
        w.save(&data).unwrap();
        let listed=replacements(&data,"",false,0,25).unwrap();
        assert_eq!(listed["total"],1);
        let preview=preview_replacement(&data,&path,&old_id,&new_id).unwrap();
        assert_eq!(preview["exact"]["matched"].as_u64().is_some(),true);
        assert!(preview["exact"]["oldOnly"].as_u64().unwrap()>0);
        let stale=preview["token"].as_str().unwrap().to_string();
        std::fs::write(&path,include_bytes!("../assets/five-finger.mid")).unwrap();
        assert!(decide_replacement(&data,&path,&old_id,&new_id,&stale,"new",None).is_err());
        std::fs::write(&path,include_bytes!("../assets/basic-chords.mid")).unwrap();
        let token=preview_replacement(&data,&path,&old_id,&new_id).unwrap()["token"].as_str().unwrap().to_string();
        decide_replacement(&data,&path,&old_id,&new_id,&token,"keep",None).unwrap();
        assert!(!library::enriched(&[],&data).iter().any(|r|r.path==path));
        let reopened=Workspace::load(&data).unwrap();
        assert_eq!(reopened.replacement_reviews[&record_key(&old_id,&path)].action,"keep");
        assert_eq!(replacements(&data,"",false,0,25).unwrap()["total"],0);
        assert_eq!(replacements(&data,"",true,0,25).unwrap()["total"],1);
        let token=preview_replacement(&data,&path,&old_id,&new_id).unwrap()["token"].as_str().unwrap().to_string();
        decide_replacement(&data,&path,&old_id,&new_id,&token,"new",None).unwrap();
        assert!(library::enriched(&[],&data).iter().any(|r|r.path==path));
        let token=preview_replacement(&data,&path,&old_id,&new_id).unwrap()["token"].as_str().unwrap().to_string();
        decide_replacement(&data,&path,&old_id,&new_id,&token,"relink",Some(duplicate.clone())).unwrap();
        let reopened=Workspace::load(&data).unwrap();
        assert_eq!(reopened.replacement_reviews[&record_key(&old_id,&path)].action,"relink");
        assert_eq!(reopened.entries[&key(&path)].content_id.as_deref(),Some(new_id.as_str()));
        assert_eq!(library::available_path(&reopened,&old_id,None),Some(duplicate.clone()));
        assert_eq!(panthesia_core::library::load_song_sidecar(&duplicate,&old_id).unwrap().fingerings[0].finger,3);
        assert!(panthesia_core::library::load_song_sidecar(&path,&new_id).is_err());
    }
    #[test]
    fn batches_report_mismatches_and_primary_checks_actual_content() {
        let (data, old, new, id) = fixture();
        let bad = data.join("wrong.mid");
        std::fs::write(&bad, include_bytes!("../assets/basic-chords.mid")).unwrap();
        let result = relink(
            &data,
            vec![
                RelinkItem {
                    content_id: id.clone(),
                    from: old.clone(),
                    to: bad,
                },
                RelinkItem {
                    content_id: id.clone(),
                    from: new.clone(),
                    to: old.clone(),
                },
            ],
        )
        .unwrap();
        assert_eq!(result["results"][0]["ok"], false);
        assert_eq!(result["results"][1]["ok"], true);
        std::fs::write(&old, include_bytes!("../assets/basic-chords.mid")).unwrap();
        assert!(set_primary(&data, &id, Some(old)).is_err());
    }
    #[test]
    fn reversing_a_display_merge_keeps_one_visible_location_and_all_files() {
        let (data, old, new, id) = fixture();
        relink(
            &data,
            vec![RelinkItem {
                content_id: id.clone(),
                from: old.clone(),
                to: new.clone(),
            }],
        )
        .unwrap();
        relink(
            &data,
            vec![RelinkItem {
                content_id: id.clone(),
                from: new.clone(),
                to: old.clone(),
            }],
        )
        .unwrap();
        let visible = library::enriched(&[], &data);
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].path, old);
        assert!(new.is_file());
        assert!(old.is_file());
        let w = Workspace::load(&data).unwrap();
        assert_eq!(
            library::verified_file(&data, &id, [new.clone()])
                .unwrap()
                .source_path,
            Some(old)
        );
        assert_eq!(w.path_relinks.len(), 1);
    }
    #[test]
    fn ignored_old_identity_is_reversible_and_never_hides_a_replacement() {
        let (data, old, _new, id) = fixture();
        assert!(ignore_path(&data, &id, &old).is_err());
        std::fs::write(&old, include_bytes!("../assets/basic-chords.mid")).unwrap();
        let mut w = Workspace::load(&data).unwrap();
        w.inspect(old.clone(), true).unwrap();
        w.save(&data).unwrap();
        ignore_path(&data, &id, &old).unwrap();
        let q = query(&data, &json!({}), "", "missing", false, 0, 50).unwrap();
        assert_eq!(q["missingFiles"], 0);
        assert_eq!(q["resolvedFiles"], 1);
        assert!(library::enriched(&[], &data).iter().any(|r| r.path == old));
        assert!(old.is_file());
        restore_path(&data, &id, &old).unwrap();
        assert_eq!(
            query(&data, &json!({}), "", "missing", false, 0, 50).unwrap()["missingFiles"],
            1
        );
    }
}
