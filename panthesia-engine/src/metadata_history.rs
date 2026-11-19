use panthesia_core::library::SongMetadata;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub content_id: String,
    pub time_ms: u64,
    pub before: SongMetadata,
    pub after: SongMetadata,
    pub state: String,
    pub restored_from: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Journal {
    version: u8,
    path: PathBuf,
    records: Vec<Record>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Portable {
    pub source_path: PathBuf,
    pub content_id: String,
    pub records: Vec<Record>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingMetadataRow {
    pub source_path: PathBuf,
    pub content_id: String,
    pub title: Option<String>,
    pub records: usize,
    pub fingerprint: String,
    pub candidates: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingMetadataPage {
    pub rows: Vec<PendingMetadataRow>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
}
pub struct Merge {
    pub files: BTreeMap<String, Vec<u8>>,
    pub pending_file: Option<Vec<u8>>,
    pub pending_added: usize,
    pub added: usize,
    pub duplicates: usize,
    pub unmatched: usize,
    pub ambiguous: usize,
}
const PENDING_FILE: &str = "pending-metadata-history.json";
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pending {
    version: u8,
    rows: Vec<Portable>,
}
fn pending(data: &Path) -> Result<Pending, String> {
    let bytes = match panthesia_core::utils::atomic_file::read_dependency(&data.join(PENDING_FILE), 64_000_000) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Pending {
                version: 1,
                rows: vec![],
            });
        }
        Err(e) => return Err(e.to_string()),
    };
    if bytes.len() > 64_000_000 {
        return Err("待认领资料历史文件过大".into());
    }
    let value: Pending =
        serde_json::from_slice(&bytes).map_err(|e| format!("待认领资料历史无法读取：{e}"))?;
    if ![1, 2].contains(&value.version) {
        return Err("待认领资料历史版本无效".into());
    }
    validate_backup(&value.rows)?;
    Ok(value)
}
fn insert_pending(rows: &mut Vec<Portable>, incoming: &Portable) -> Result<usize, String> {
    let row = rows.iter_mut().find(|row| {
        row.content_id == incoming.content_id
            && crate::library_workspace::key(&row.source_path)
                == crate::library_workspace::key(&incoming.source_path)
    });
    let row = if let Some(row) = row {
        row
    } else {
        rows.push(Portable {
            source_path: incoming.source_path.clone(),
            content_id: incoming.content_id.clone(),
            records: vec![],
        });
        rows.last_mut().unwrap()
    };
    let mut added = 0;
    for record in &incoming.records {
        if let Some(local) = row.records.iter().find(|local| local.id == record.id) {
            if serde_json::to_vec(local).map_err(|e| e.to_string())?
                != serde_json::to_vec(record).map_err(|e| e.to_string())?
            {
                return Err("待认领资料历史编号发生内容冲突".into());
            }
        } else {
            row.records.push(record.clone());
            added += 1;
        }
    }
    if row.records.len() > 200 {
        return Err("同一来源待认领资料历史超过 200 条".into());
    }
    Ok(added)
}
pub const FIELDS: &[&str] = panthesia_core::metadata_layers::FIELDS;

fn file(data: &Path, path: &Path) -> PathBuf {
    data.join("metadata-history").join(format!(
        "{}.json",
        blake3::hash(crate::library_workspace::key(path).as_bytes())
    ))
}
fn load(data: &Path, path: &Path) -> Result<Journal, String> {
    let journal = match panthesia_core::utils::atomic_file::read_dependency(&file(data, path), 64_000_000) {
        Ok(bytes) => {
            if bytes.len() > 64_000_000 {
                return Err("资料历史文件过大".into());
            }
            serde_json::from_slice::<Journal>(&bytes)
                .map_err(|e| format!("资料历史无法读取，未覆盖：{e}"))?
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Journal {
            version: 1,
            path: path.to_owned(),
            records: vec![],
        },
        Err(e) => return Err(e.to_string()),
    };
    if ![1, 2].contains(&journal.version)
        || crate::library_workspace::key(&journal.path) != crate::library_workspace::key(path)
        || journal.records.len() > 200
        || journal.records.iter().any(|r| {
            !hex(&r.id)
                || !hex(&r.content_id)
                || !["prepared", "applied", "failed"].contains(&r.state.as_str())
                || r.restored_from.as_ref().is_some_and(|id| !hex(id))
        })
    {
        return Err("资料历史记录无效，未覆盖".into());
    }
    Ok(journal)
}
fn hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn validate_portable(row: &Portable) -> Result<(), String> {
    if !hex(&row.content_id)
        || row.source_path.as_os_str().is_empty()
        || row.source_path.to_string_lossy().len() > 4096
        || row.records.is_empty()
        || row.records.len() > 200
    {
        return Err("备份曲目资料历史身份或数量无效".into());
    }
    let mut ids = BTreeSet::new();
    for record in &row.records {
        if !hex(&record.id)
            || record.content_id != row.content_id
            || record.state != "applied"
            || record.restored_from.as_ref().is_some_and(|id| !hex(id))
            || !ids.insert(&record.id)
            || changed(&record.before, &record.after).is_empty()
        {
            return Err("备份曲目资料历史记录无效".into());
        }
    }
    Ok(())
}
pub fn validate_backup(rows: &[Portable]) -> Result<(), String> {
    if rows.len() > 10000 || rows.iter().map(|r| r.records.len()).sum::<usize>() > 100_000 {
        return Err("备份曲目资料历史超过容量限制".into());
    }
    for row in rows {
        validate_portable(row)?;
    }
    Ok(())
}
pub fn snapshot(data: &Path) -> Result<Vec<Portable>, String> {
    let folder = data.join("metadata-history");
    let entries = match std::fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("资料历史目录无法读取：{e}")),
    };
    let mut result = vec![];
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".json") {
            continue;
        }
        let bytes = std::fs::read(entry.path()).map_err(|e| e.to_string())?;
        if bytes.len() > 64_000_000 {
            return Err("资料历史文件过大".into());
        }
        let journal: Journal = serde_json::from_slice(&bytes)
            .map_err(|e| format!("资料历史无法读取，备份已中止：{e}"))?;
        if name
            != file(data, &journal.path)
                .file_name()
                .unwrap()
                .to_string_lossy()
        {
            return Err("资料历史路径校验失败，备份已中止".into());
        }
        let checked = load(data, &journal.path)?;
        let mut grouped: BTreeMap<String, Vec<Record>> = BTreeMap::new();
        for record in checked.records.into_iter().filter(|r| r.state == "applied") {
            grouped
                .entry(record.content_id.clone())
                .or_default()
                .push(record);
        }
        for (content_id, records) in grouped {
            let row = Portable {
                source_path: journal.path.clone(),
                content_id,
                records,
            };
            validate_portable(&row)?;
            result.push(row);
        }
    }
    for row in pending(data)?.rows {
        insert_pending(&mut result, &row)?;
    }
    validate_backup(&result)?;
    Ok(result)
}
pub fn merge(
    data: &Path,
    workspace: &mut crate::library_workspace::Workspace,
    incoming: &[Portable],
) -> Result<Merge, String> {
    validate_backup(incoming)?;
    let mut result = Merge {
        files: BTreeMap::new(),
        pending_file: None,
        pending_added: 0,
        added: 0,
        duplicates: 0,
        unmatched: 0,
        ambiguous: 0,
    };
    if incoming.is_empty() {
        return Ok(result);
    }
    let mut unresolved = pending(data)?;
    let mut by_content: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    let indexed = workspace
        .entries
        .values()
        .map(|entry| entry.path.clone())
        .collect::<Vec<_>>();
    for path in indexed {
        let entry = workspace.inspect(path.clone(), true)?;
        if entry.available && entry.error.is_none() {
            if let Some(cid) = entry.content_id {
                let paths = by_content.entry(cid).or_default();
                if !paths.iter().any(|existing| {
                    crate::library_workspace::key(existing) == crate::library_workspace::key(&path)
                }) {
                    paths.push(path);
                }
            }
        }
    }
    let mut planned: BTreeMap<String, Journal> = BTreeMap::new();
    for row in incoming {
        let candidates = by_content
            .get(&row.content_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let exact = candidates.iter().find(|path| {
            crate::library_workspace::key(path) == crate::library_workspace::key(&row.source_path)
        });
        let target = if let Some(path) = exact {
            Some(path.clone())
        } else if candidates.len() == 1 {
            Some(candidates[0].clone())
        } else {
            None
        };
        let Some(target) = target else {
            if candidates.is_empty() {
                result.unmatched += row.records.len();
            } else {
                result.ambiguous += row.records.len();
            }
            result.pending_added += insert_pending(&mut unresolved.rows, row)?;
            continue;
        };
        let name = file(data, &target)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        if !planned.contains_key(&name) {
            planned.insert(name.clone(), load(data, &target)?);
        }
        let journal = planned.get_mut(&name).unwrap();
        for record in &row.records {
            if let Some(local) = journal.records.iter().find(|r| r.id == record.id) {
                if local.content_id != record.content_id
                    || serde_json::to_vec(local).map_err(|e| e.to_string())?
                        != serde_json::to_vec(record).map_err(|e| e.to_string())?
                {
                    return Err("曲目资料历史编号发生内容冲突，导入已中止".into());
                }
                result.duplicates += 1;
            } else {
                journal.records.push(record.clone());
                result.added += 1;
            }
        }
    }
    for (name, journal) in planned {
        if journal.records.len() > 200 {
            return Err("合并后的单曲资料历史超过 200 条，请先整理本地历史".into());
        }
        result.files.insert(
            name,
            serde_json::to_vec_pretty(&journal).map_err(|e| e.to_string())?,
        );
    }
    if result.unmatched + result.ambiguous > 0 {
        validate_backup(&unresolved.rows)?;
        unresolved.version = if unresolved.rows.iter().flat_map(|row| &row.records).any(|record| record.before.has_extended_fields() || record.after.has_extended_fields()) { 2 } else { 1 };
        let bytes = serde_json::to_vec_pretty(&unresolved).map_err(|e| e.to_string())?;
        if bytes.len() > 64_000_000 { return Err("待认领资料历史超过文件容量限制".into()); }
        result.pending_file = Some(bytes);
    }
    Ok(result)
}
pub fn pending_rows(
    data: &Path,
    workspace: &mut crate::library_workspace::Workspace,
) -> Result<serde_json::Value, String> {
    pending_rows_checked(data, workspace, &|| Ok(()))
}
pub(crate) fn pending_rows_checked(
    data: &Path,
    workspace: &mut crate::library_workspace::Workspace,
    check: &impl Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    pending_window(data, workspace, "", 0, 10_000, check)
}
pub(crate) fn pending_page_checked(
    data: &Path,
    workspace: &mut crate::library_workspace::Workspace,
    query: &str,
    offset: usize,
    limit: usize,
    check: &impl Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    pending_window(data, workspace, query, offset, limit.clamp(1, 40), check)
}
fn pending_window(
    data: &Path,
    workspace: &mut crate::library_workspace::Workspace,
    query: &str,
    offset: usize,
    limit: usize,
    check: &impl Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    check()?;
    let rows = pending(data)?.rows;
    let query = query.to_lowercase();
    let terms = query.split_whitespace().collect::<Vec<_>>();
    let mut matching = Vec::new();
    for row in rows {
        check()?;
        let text = format!(
            "{} {} {}",
            row.source_path.display(),
            row.content_id,
            row.records
                .iter()
                .rev()
                .find_map(|record| record.after.title.as_ref().or(record.before.title.as_ref()))
                .map(String::as_str)
                .unwrap_or("")
        )
        .to_lowercase();
        if terms.iter().all(|term| text.contains(term)) {
            matching.push(row);
        }
    }
    let total = matching.len();
    let offset = offset.min(total.saturating_sub(1) / limit * limit);
    let rows = matching
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let needed = rows
        .iter()
        .map(|row| row.content_id.as_str())
        .collect::<BTreeSet<_>>();
    let indexed = workspace
        .entries
        .values()
        .filter(|entry| {
            entry
                .content_id
                .as_deref()
                .is_some_and(|cid| needed.contains(cid))
        })
        .map(|entry| entry.path.clone())
        .collect::<Vec<_>>();
    let mut by_content: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for path in indexed {
        check()?;
        let entry = workspace.inspect(path.clone(), true)?;
        if entry.available && entry.error.is_none() {
            if let Some(cid) = entry.content_id {
                let choices = by_content.entry(cid).or_default();
                let display = path.to_string_lossy().to_string();
                if !choices.iter().any(|old| {
                    crate::library_workspace::key(Path::new(old))
                        == crate::library_workspace::key(&path)
                }) {
                    choices.push(display);
                }
            }
        }
    }
    let mut output = Vec::new();
    for row in &rows {
        check()?;
        let title = row
            .records
            .iter()
            .rev()
            .find_map(|record| record.after.title.as_ref().or(record.before.title.as_ref()));
        output.push(PendingMetadataRow {
            source_path: row.source_path.clone(),
            content_id: row.content_id.clone(),
            title: title.cloned(),
            records: row.records.len(),
            fingerprint: pending_fingerprint(row)?,
            candidates: by_content.get(&row.content_id).cloned().unwrap_or_default(),
        });
    }
    serde_json::to_value(PendingMetadataPage {
        rows: output,
        total,
        offset,
        limit,
    })
    .map_err(|e| e.to_string())
}
fn pending_fingerprint(row: &Portable) -> Result<String, String> {
    serde_json::to_vec(row)
        .map(|bytes| blake3::hash(&bytes).to_hex().to_string())
        .map_err(|e| e.to_string())
}

pub fn claim_pending(
    data: &Path,
    workspace: &mut crate::library_workspace::Workspace,
    source: &Path,
    cid: &str,
    target: &Path,
) -> Result<serde_json::Value, String> {
    claim_pending_checked(data, workspace, source, cid, target, None, &|| Ok(()))
}
pub(crate) fn claim_pending_checked(
    data: &Path,
    workspace: &mut crate::library_workspace::Workspace,
    source: &Path,
    cid: &str,
    target: &Path,
    expected: Option<&str>,
    check: &impl Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    check()?;
    if !hex(cid) {
        return Err("资料历史曲目身份无效".into());
    }
    let mut unresolved = pending(data)?;
    let index = unresolved
        .rows
        .iter()
        .position(|row| {
            row.content_id == cid
                && crate::library_workspace::key(&row.source_path)
                    == crate::library_workspace::key(source)
        })
        .ok_or("待认领资料历史不存在，请刷新列表")?;
    let indexed = workspace.entries.values().any(|entry| {
        crate::library_workspace::key(&entry.path) == crate::library_workspace::key(target)
    });
    if !indexed {
        return Err("目标曲目尚未加入曲库".into());
    }
    let entry = workspace.inspect(target.to_owned(), true)?;
    if !entry.available || entry.error.is_some() || entry.content_id.as_deref() != Some(cid) {
        return Err("目标 MIDI 内容已变化，认领已取消".into());
    }
    check()?;
    let row = &unresolved.rows[index];
    let fingerprint = pending_fingerprint(row)?;
    if expected.is_some_and(|value| value != fingerprint) {
        return Err("待认领历史在读取后发生变化，请刷新核对原记录".into());
    }
    let mut journal = load(data, target)?;
    let mut added = 0;
    for record in &row.records {
        check()?;
        if let Some(local) = journal.records.iter().find(|local| local.id == record.id) {
            if serde_json::to_vec(local).map_err(|e| e.to_string())?
                != serde_json::to_vec(record).map_err(|e| e.to_string())?
            {
                return Err("目标曲目历史含相同编号的不同内容，认领已取消".into());
            }
        } else {
            journal.records.push(record.clone());
            added += 1;
        }
    }
    if journal.records.len() > 200 {
        return Err("目标曲目资料历史超过 200 条，认领已取消".into());
    }
    // Both files are staged into the service transaction; direct legacy calls remain retry-safe.
    check()?;
    write(data, &journal)?;
    let records = unresolved.rows[index].records.len();
    unresolved.rows.remove(index);
    unresolved.version = if unresolved.rows.iter().flat_map(|row| &row.records).any(|record| record.before.has_extended_fields() || record.after.has_extended_fields()) { 2 } else { 1 };
    let bytes = serde_json::to_vec_pretty(&unresolved).map_err(|e| e.to_string())?;
    check()?;
    panthesia_core::utils::atomic_file::write(&data.join(PENDING_FILE), &bytes)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"added":added,"records":records,"fingerprint":fingerprint}))
}
fn write(data: &Path, journal: &Journal) -> Result<(), String> {
    let path = file(data, &journal.path);
    let mut value = serde_json::to_value(journal).map_err(|error| error.to_string())?;
    value["version"] = serde_json::json!(if journal.records.iter().any(|record| record.before.has_extended_fields() || record.after.has_extended_fields()) { 2 } else { 1 });
    let bytes = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
    panthesia_core::utils::atomic_file::write(&path, &bytes).map_err(|error| error.to_string())
}
pub fn changed(before: &SongMetadata, after: &SongMetadata) -> Vec<String> {
    let before = serde_json::to_value(before).unwrap();
    let after = serde_json::to_value(after).unwrap();
    FIELDS
        .iter()
        .filter(|field| before[**field] != after[**field])
        .map(|field| (*field).into())
        .collect()
}
pub fn prepare(
    data: &Path,
    path: &Path,
    cid: &str,
    before: SongMetadata,
    after: SongMetadata,
    restored_from: Option<String>,
) -> Result<String, String> {
    let mut journal = load(data, path)?;
    let time_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    let id = blake3::hash(
        &serde_json::to_vec(&(
            cid,
            time_ms,
            &before,
            &after,
            journal.records.last().map(|r| &r.id),
        ))
        .map_err(|e| e.to_string())?,
    )
    .to_hex()
    .to_string();
    journal.records.push(Record {
        id: id.clone(),
        content_id: cid.into(),
        time_ms,
        before,
        after,
        state: "prepared".into(),
        restored_from,
    });
    if journal.records.len() > 200 {
        journal.records.drain(..journal.records.len() - 200);
    }
    write(data, &journal)?;
    Ok(id)
}
pub fn finish(data: &Path, path: &Path, id: &str, applied: bool) -> Result<(), String> {
    let mut journal = load(data, path)?;
    let record = journal
        .records
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or("资料历史记录不见了")?;
    record.state = if applied { "applied" } else { "failed" }.into();
    write(data, &journal)
}
pub fn inspect(
    data: &Path,
    path: &Path,
    cid: &str,
    current: Option<&SongMetadata>,
) -> Result<serde_json::Value, String> {
    let journal = load(data, path)?;
    let mut records = vec![];
    for record in journal
        .records
        .into_iter()
        .rev()
        .filter(|r| r.content_id == cid)
    {
        let mut value = serde_json::to_value(&record).map_err(|e| e.to_string())?;
        value["fields"] = serde_json::json!(changed(&record.before, &record.after));
        value["matchesCurrent"] = serde_json::json!(current == Some(&record.after));
        records.push(value);
    }
    Ok(serde_json::json!({"records":records,"retention":200}))
}
pub fn record(data: &Path, path: &Path, cid: &str, id: &str) -> Result<Record, String> {
    let journal = load(data, path)?;
    let record = journal
        .records
        .into_iter()
        .find(|r| r.id == id && r.content_id == cid)
        .ok_or("此项资料历史不存在")?;
    if record.state != "applied" {
        return Err("此项写入未确认，不能作为恢复来源".into());
    }
    Ok(record)
}
pub fn proposed(
    record: &Record,
    current: &SongMetadata,
    fields: &[String],
) -> Result<SongMetadata, String> {
    let allowed = changed(&record.before, &record.after);
    if fields.is_empty() || fields.len() > FIELDS.len() || fields.iter().any(|field| !allowed.contains(field))
    {
        return Err("请选择这次修改中的字段".into());
    }
    let mut value = serde_json::to_value(current).map_err(|e| e.to_string())?;
    let before = serde_json::to_value(&record.before).map_err(|e| e.to_string())?;
    for field in fields {
        value[field] = before[field].clone();
    }
    serde_json::from_value(value).map_err(|e| e.to_string())
}
