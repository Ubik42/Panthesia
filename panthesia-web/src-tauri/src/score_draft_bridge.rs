use panthesia_engine::notation_drafts;
use serde::{Deserialize, Serialize};
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftSelection {
    pub engine_id: String,
    pub content_id: String,
    pub id: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportedNotationDraft {
    pub engine_id: String,
    pub content_id: String,
    pub name: String,
    pub bytes: Vec<u8>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetainedNotationFile {
    pub id: String,
    pub content_id: String,
    pub name: String,
    pub size: usize,
}
#[tauri::command]
pub async fn retain_notation_file(
    state: tauri::State<'_, crate::State>,
    request: ImportedNotationDraft,
) -> Result<RetainedNotationFile, String> {
    state.engine.check_engine(&request.engine_id)?;
    if request.content_id.len() != 64 || !request.content_id.bytes().all(|byte| byte.is_ascii_hexdigit()) || request.bytes.is_empty() || request.bytes.len() > 4_000_000 {
        return Err("曲目编号或上传谱面大小无效".into());
    }
    let hash = blake3::hash(&request.bytes).to_hex().to_string();
    let id = blake3::hash(format!("imported-notation:{}:{}:{}", request.content_id, request.name, hash).as_bytes()).to_hex().to_string();
    let lease = crate::score_edit::reserve(&state, &id)?;
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        panthesia_core::musicxml::import_musicxml_document(&request.bytes).map_err(|error| format!("谱面内容无法读取：{error}"))?;
        let record = notation_drafts::DraftRecord {
            id: id.clone(), content_id: request.content_id, name: request.name.clone(), kind: "importedNotation".into(),
            source: std::path::PathBuf::from(&request.name), source_warning: None, book_id: None, pages: vec![],
            hash, size: request.bytes.len(), created_at_ms: now_ms(), generation:None,
        };
        notation_drafts::store(&data, &record, &request.bytes)?;
        Ok(RetainedNotationFile { id, content_id: record.content_id, name: record.name, size: record.size })
    }).await.map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn list_notation_drafts(
    state: tauri::State<'_, crate::State>,
    content_id: String,
) -> Result<notation_drafts::DraftListing, String> {
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || notation_drafts::list(&data, &content_id))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn read_notation_draft(
    state: tauri::State<'_, crate::State>,
    request: DraftSelection,
) -> Result<crate::score_jobs::ScoreDraft, String> {
    state.engine.check_engine(&request.engine_id)?;
    let lease = crate::score_edit::reserve(&state, &request.id)?;
    let data = state.data.clone();
    let generated = state.generated_scores.clone();
    let recognized = state.recognized_scores.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        let (record, bytes) = notation_drafts::read(&data, &request.id, &request.content_id)?;
        let receipt = notation_drafts::saved(&data, &request.id, &request.content_id)?;
        let saved = receipt
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|error| error.to_string())?;
        match record.kind.as_str() {
            "midiToNotation" => {
                let mut rows = generated.lock().map_err(|_| "转谱预览资料正忙")?;
                crate::score_edit::make_preview_room(&mut rows, Some(&record.id), |row| {
                    (row.cached || row.saved.is_some()).then_some(row.created)
                })?;
                rows.insert(
                    record.id.clone(),
                    crate::GeneratedScorePreview {
                        created: std::time::Instant::now(),
                        content_id: record.content_id,
                        source: record.source,
                        name: record.name.clone(),
                        hash: record.hash,
                        saved,
                        cached: true,
                    },
                );
            }
            "paperToNotation" => {
                let mut rows = recognized.lock().map_err(|_| "识谱预览资料正忙")?;
                crate::score_edit::make_preview_room(&mut rows, Some(&record.id), |row| {
                    (row.cached || row.saved.is_some()).then_some(row.created)
                })?;
                rows.insert(
                    record.id.clone(),
                    crate::audiveris_paper::RecognizedScorePreview {
                        created: std::time::Instant::now(),
                        content_id: record.content_id,
                        source: record.source,
                        name: record.name.clone(),
                        hash: record.hash,
                        saved,
                        cached: true,
                        book_id: record.book_id.ok_or("识谱初稿缺少纸谱来源")?,
                        pages: record
                            .pages
                            .into_iter()
                            .map(|page| crate::audiveris_paper::PageIdentity {
                                id: page.id,
                                kind: page.kind,
                            })
                            .collect(),
                    },
                );
            }
            "importedNotation" => {},
            _ => return Err("初稿类型暂不支持".into()),
        }
        Ok(crate::score_jobs::ScoreDraft {
            name: record.name,
            bytes,
            preview_token: record.id,
            warning: record.source_warning,
            saved: receipt,
            cached: true,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn remove_notation_draft(
    state: tauri::State<'_, crate::State>,
    request: DraftSelection,
) -> Result<(), String> {
    state.engine.check_engine(&request.engine_id)?;
    let lease = crate::score_edit::reserve(&state, &request.id)?;
    let data = state.data.clone();
    let generated = state.generated_scores.clone();
    let recognized = state.recognized_scores.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        notation_drafts::remove(&data, &request.id, &request.content_id)?;
        generated
            .lock()
            .map_err(|_| "转谱预览资料正忙")?
            .remove(&request.id);
        recognized
            .lock()
            .map_err(|_| "识谱预览资料正忙")?
            .remove(&request.id);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn export_notation_draft(
    state: tauri::State<'_, crate::State>,
    request: DraftSelection,
) -> Result<Option<String>, String> {
    state.engine.check_engine(&request.engine_id)?;
    let lease = crate::score_edit::reserve(&state, &request.id)?;
    let data = state.data.clone();
    let (record, bytes) = tauri::async_runtime::spawn_blocking(move || {
        notation_drafts::read(&data, &request.id, &request.content_id)
    })
    .await
    .map_err(|error| error.to_string())??;
    export_copy(&state, record.name, record.kind, bytes, lease).await
}
#[tauri::command]
pub async fn export_notation_draft_bytes(
    state: tauri::State<'_, crate::State>,
    request: DraftSelection,
    name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    state.engine.check_engine(&request.engine_id)?;
    let lease = crate::score_edit::reserve(&state, &request.id)?;
    if bytes.is_empty() || bytes.len() > 4_000_000 {
        return Err("初稿内容为空或超过 4 MB".into());
    }
    let hash = blake3::hash(&bytes).to_hex().to_string();
    let kind = if state
        .generated_scores
        .lock()
        .map_err(|_| "转谱初稿正忙")?
        .get(&request.id)
        .is_some_and(|row| {
            row.content_id == request.content_id && row.name == name && row.hash == hash
        }) {
        "midiToNotation"
    } else if state
        .recognized_scores
        .lock()
        .map_err(|_| "识谱初稿正忙")?
        .get(&request.id)
        .is_some_and(|row| {
            row.content_id == request.content_id && row.name == name && row.hash == hash
        })
    {
        "paperToNotation"
    } else {
        let data = state.data.clone();
        let id = request.id.clone();
        let content_id = request.content_id.clone();
        let retained = tauri::async_runtime::spawn_blocking(move || notation_drafts::load_record(&data, &id, &content_id))
            .await.map_err(|error| error.to_string())?.ok();
        if retained.as_ref().is_some_and(|record| record.kind == "importedNotation" && record.name == name && record.hash == hash) {
            "importedNotation"
        } else if name.to_ascii_lowercase().ends_with(".mxl") && bytes.starts_with(b"PK\x03\x04") {
            "paperToNotation"
        } else if name.to_ascii_lowercase().ends_with(".musicxml")
            && std::str::from_utf8(&bytes)
                .is_ok_and(|xml| xml.contains("<score-partwise") || xml.contains("<score-timewise"))
        {
            "midiToNotation"
        } else {
            return Err("初稿格式无法核对，请先查看本机保留的初稿".into());
        }
    };
    export_copy(&state, name, kind.into(), bytes, lease).await
}
async fn export_copy(
    state: &crate::State,
    name: String,
    kind: String,
    bytes: Vec<u8>,
    lease: crate::score_edit::Lease,
) -> Result<Option<String>, String> {
    let zipped = kind == "paperToNotation" || kind == "importedNotation" && bytes.starts_with(b"PK");
    let extension = if zipped {
        "mxl"
    } else {
        "musicxml"
    };
    let name = if kind == "importedNotation" {
        format!("{}.{}", std::path::Path::new(&name).file_stem().and_then(|stem| stem.to_str()).unwrap_or("乐谱副本"), extension)
    } else { name };
    let Some(file) = crate::file_dialog(&state.data, "notation")
        .set_title("另存谱面初稿副本")
        .add_filter("乐谱初稿", &[extension])
        .set_file_name(&name)
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let data = state.data.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let _lease = lease;
        let parent = path
            .parent()
            .ok_or("保存位置无效")?
            .canonicalize()
            .map_err(|error| format!("保存文件夹无法读取：{error}"))?;
        if std::fs::canonicalize(&data).is_ok_and(|root| parent.starts_with(root)) {
            return Err("请选择个人乐谱文件夹。初稿副本不能存入软件内部资料目录".into());
        }
        if zipped {
            crate::audiveris_paper::write_new_mxl(&path, &bytes)?;
        } else {
            crate::write_new_generated_score(&path, &bytes)?;
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())??;
    crate::remember_location(&state.data, "notation", file.path(), false);
    Ok(Some(saved))
}
