use crate::{
    score_draft_bridge::DraftSelection,
    score_jobs::{ScoreJobKind, ScoreJobRequest, ScoreSubmitted},
};
use panthesia_engine::{
    Command,
    pdf_drafts::{self, PdfDraft, Record},
};
use std::io::Write;

use crate::conversion_files::Scratch;
#[tauri::command]
pub async fn prepare_pdf_draft(
    state: tauri::State<'_, crate::State>,
    request: ScoreJobRequest,
    version_id: String,
    source_title: Option<String>,
) -> Result<ScoreSubmitted, String> {
    let cid = request.content_id.clone();
    let guard = state.score_jobs.begin(
        Some(request),
        ScoreJobKind::NotationToPdf,
        &cid,
        &state.engine,
    )?;
    let result = render_pdf(&state, cid, version_id, source_title, guard.token()).await;
    guard.finish_pdf(result)
}
async fn render_pdf(
    state: &crate::State,
    cid: String,
    version_id: String,
    source_title: Option<String>,
    control: crate::score_jobs::Token,
) -> Result<PdfDraft, String> {
    control.stage("readingSource")?;
    let data = state.data.clone();
    let version = version_id.clone();
    let content = cid.clone();
    let (source, bytes) = tauri::async_runtime::spawn_blocking(move || {
        pdf_drafts::capacity(&data)?;
        let source = panthesia_engine::score_sources::original_for_edit(&data, &content, &version)?;
        let bytes = panthesia_engine::score_sources::read_original(&source)?;
        Ok::<_, String>((source, bytes))
    })
    .await
    .map_err(|error| error.to_string())??;
    control.stage("choosingProgram")?;
    let executable = crate::musescore_executable(&state, Some(&control)).await?;
    control.check()?;
    let data = state.data.clone();
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let scratch = Scratch::create(&data, "pdf")?;
            control.stage("copyingSource")?;
            let input = scratch.source(&source, &bytes)?;
            let source_hash = blake3::hash(&bytes).to_hex().to_string();
            control.stage("layingOutPdf")?;
            let output = crate::convert_musescore_pdf_controlled(
                &executable,
                &input,
                &scratch.dir.join("layout.pdf"),
                Some(&control),
            )?;
            control.stage("retainingPdf")?;
            let warning = (|| {
                let current =
                    panthesia_engine::score_sources::original_for_edit(&data, &cid, &version_id)?;
                let bytes = panthesia_engine::score_sources::read_original(&current)?;
                if current != source || blake3::hash(&bytes).to_hex().as_str() != source_hash {
                    return Err("原谱内容或位置已改变".to_string());
                }
                Ok(())
            })()
            .err()
            .map(|error| {
                format!("PDF 来自排版开始时的原谱，原谱随后发生变化，已保留 PDF 请先查看：{error}")
            });
            let hash = blake3::hash(&output).to_hex().to_string();
            let id = blake3::hash(
                format!(
                    "{}:{cid}:{version_id}:{hash}:{}",
                    scratch.dir.display(),
                    crate::score_draft_bridge::now_ms()
                )
                .as_bytes(),
            )
            .to_hex()
            .to_string();
            let stem = source
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("乐谱")
                .chars()
                .take(80)
                .collect::<String>();
            let draft = PdfDraft {
                id,
                content_id: cid,
                version_id,
                source_title: source_title
                    .filter(|title| !title.trim().is_empty() && title.chars().count() <= 120),
                name: format!("{stem} · MuseScore.pdf"),
                size: output.len(),
                created_at_ms: crate::score_draft_bridge::now_ms(),
                warning,
                paper_id: None,
                adoption_pending: false,
            };
            control.check()?;
            pdf_drafts::store(
                &data,
                &Record {
                    source_warning: draft.warning.clone(),
                    draft: draft.clone(),
                    hash,
                    source,
                    source_hash,
                },
                &output,
            )?;
            control.check()?;
            Ok(draft)
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (data, source, bytes, executable, version_id);
        Err("当前平台尚未接入 MuseScore PDF 排版".into())
    }
}
/// Keep the old command's immediate-adoption behavior on the same retained PDF pipeline.
pub async fn legacy_pdf(
    state: tauri::State<'_, crate::State>,
    content_id: String,
    version_id: String,
) -> Result<serde_json::Value, String> {
    let _lease = crate::score_edit::reserve(&state, "legacy-musescore-pdf")?;
    let engine_id = state
        .engine
        .snapshot()
        .state_order
        .ok_or("练习室连接尚未准备完成")?
        .engine_id;
    let guard = state.score_jobs.begin(
        None,
        ScoreJobKind::NotationToPdf,
        &content_id,
        &state.engine,
    )?;
    let result = render_pdf(&state, content_id.clone(), version_id, None, guard.token()).await;
    let draft = result.as_ref().ok().cloned();
    guard.finish_pdf(result)?;
    let draft = draft.ok_or("PDF 排版结果尚未确认")?;
    if let Some(warning) = &draft.warning {
        return Err(format!(
            "PDF 已保留在本机初稿中，请核对后加入谱页：{warning}"
        ));
    }
    let saved = adopt_pdf_draft(
        state,
        DraftSelection {
            engine_id,
            content_id,
            id: draft.id,
        },
        Some(true),
    )
    .await?;
    let active = saved.paper_id.ok_or_else(|| {
        saved
            .warning
            .clone()
            .unwrap_or_else(|| "PDF 已保留，加入结果尚未确认，请核对谱页列表".into())
    })?;
    Ok(serde_json::json!({ "active": active, "draftId": saved.id, "warning": saved.warning }))
}

#[tauri::command]
pub async fn list_pdf_drafts(
    state: tauri::State<'_, crate::State>,
    engine_id: String,
    content_id: Option<String>,
) -> Result<pdf_drafts::PdfListing, String> {
    state.engine.check_engine(&engine_id)?;
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || pdf_drafts::list(&data, content_id.as_deref()))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn read_pdf_draft_bytes(
    state: tauri::State<'_, crate::State>,
    request: DraftSelection,
) -> Result<tauri::ipc::Response, String> {
    state.engine.check_engine(&request.engine_id)?;
    let data = state.data.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        pdf_drafts::read(&data, &request.id, &request.content_id).map(|(_, bytes)| bytes)
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}
fn existing_paper(value: &serde_json::Value, hash: &str) -> Option<String> {
    value["attachments"].as_array()?.iter().find(|book| {
        book["format"] == "pdf"
            && book["pages"]
                .as_array()
                .is_some_and(|pages| pages.len() == 1 && pages[0]["id"].as_str() == Some(hash))
    })?["id"]
        .as_str()
        .map(str::to_owned)
}
#[tauri::command]
pub async fn adopt_pdf_draft(
    state: tauri::State<'_, crate::State>,
    request: DraftSelection,
    adopt: Option<bool>,
) -> Result<PdfDraft, String> {
    state.engine.check_engine(&request.engine_id)?;
    let lease = crate::score_edit::reserve(&state, &request.id)?;
    let data = state.data.clone();
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        engine.check_current_content_id(&request.content_id)?;
        let mut record = pdf_drafts::record(&data, &request.id, &request.content_id)?;
        record.draft.warning = record.source_warning.clone();
        // This read is refused while the engine is saving or recovering. A lost
        // response is reconciled against the exact PDF hash before another write.
        let listed = engine.command(Command::ScoreAttachments {
            content_id: request.content_id.clone(),
        })?;
        if let Some(id) = existing_paper(&listed, &record.hash).filter(|id| {
            (record.draft.adoption_pending
                || record.draft.paper_id.is_some()
                || adopt == Some(false))
                && panthesia_engine::score_attachments::read(&data, &request.content_id, id, 0)
                    .is_ok()
        }) {
            record.draft.paper_id = Some(id);
            record.draft.adoption_pending = false;
            if let Err(error) = pdf_drafts::update(&data, &record) {
                record.draft.warning = Some(format!("PDF 已加入谱面，但缓存记录未更新：{error}"));
            }
            return Ok(record.draft);
        }
        if adopt == Some(false) {
            record.draft.paper_id = None;
            record.draft.adoption_pending = false;
            record.draft.warning =
                Some("未找到可用的已保存谱页，PDF 缓存保留，可以重新加入或另存。".into());
            pdf_drafts::update(&data, &record)?;
            return Ok(record.draft);
        }
        record.draft.paper_id = None;
        record.draft.adoption_pending = true;
        let (_, bytes) = pdf_drafts::read(&data, &request.id, &request.content_id)?;
        pdf_drafts::update(&data, &record)?;
        match engine.command(Command::AddScoreAttachment {
            content_id: request.content_id,
            name: record.draft.name.clone(),
            bytes,
            append: None,
        }) {
            Ok(value) => {
                record.draft.paper_id = existing_paper(&value, &record.hash);
                record.draft.adoption_pending = record.draft.paper_id.is_none();
                if record.draft.adoption_pending {
                    record.draft.warning =
                        Some("PDF 加入请求已返回，请重新确认谱页结果。原 PDF 缓存保留。".into());
                }
            }
            Err(error) => {
                record.draft.warning = Some(format!(
                    "PDF 已保留，加入谱面的结果尚未确认，可以重新读取后继续：{error}"
                ))
            }
        }
        if let Err(error) = pdf_drafts::update(&data, &record) {
            record.draft.warning = Some(format!(
                "PDF 处理结果尚未写入缓存记录，请先核对谱页：{error}"
            ));
        }
        Ok(record.draft)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn remove_pdf_draft(
    state: tauri::State<'_, crate::State>,
    request: DraftSelection,
) -> Result<(), String> {
    state.engine.check_engine(&request.engine_id)?;
    let lease = crate::score_edit::reserve(&state, &request.id)?;
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        pdf_drafts::remove(&data, &request.id, &request.content_id)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn export_pdf_draft(
    state: tauri::State<'_, crate::State>,
    request: DraftSelection,
) -> Result<Option<String>, String> {
    state.engine.check_engine(&request.engine_id)?;
    let lease = crate::score_edit::reserve(&state, &request.id)?;
    let data = state.data.clone();
    let (record, bytes) = tauri::async_runtime::spawn_blocking(move || {
        pdf_drafts::read(&data, &request.id, &request.content_id)
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some(file) = crate::file_dialog(&state.data, "exportPaper")
        .set_title("另存排版 PDF 副本")
        .add_filter("PDF 文档", &["pdf"])
        .set_file_name(&record.draft.name)
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let data = state.data.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let _lease = lease;
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
        {
            return Err("请使用 .pdf 文件名".into());
        }
        let parent = path
            .parent()
            .ok_or("保存位置无效")?
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let root = data
            .canonicalize()
            .map_err(|error| format!("软件资料位置无法读取：{error}"))?;
        if parent.starts_with(root) {
            return Err("请选择个人文件夹，PDF 副本不能存入软件内部资料目录".into());
        }
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    "该位置已有文件，请选择新的 PDF 文件名".into()
                } else {
                    format!("PDF 副本无法新建：{error}")
                }
            })?;
        if let Err(error) = output.write_all(&bytes).and_then(|_| output.sync_all()) {
            drop(output);
            let _ = std::fs::remove_file(&path);
            return Err(format!("PDF 副本写入失败：{error}"));
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())??;
    crate::remember_location(&state.data, "exportPaper", file.path(), false);
    Ok(Some(saved))
}
