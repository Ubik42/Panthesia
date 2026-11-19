//! Located score pages use the same owned file transfer as other large score inputs.
use crate::practice_backup_bridge::{self, Sessions};
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocatedPaperSaved {
    pub active: String,
    pub already_saved: bool,
}
#[tauri::command]
pub async fn begin_located_paper_upload(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    size: u64,
) -> Result<String, String> {
    let lease = crate::score_edit::reserve(&state, "located-paper-input-start")?;
    let data = state.data.clone();
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        practice_backup_bridge::begin_located_input(&data, &sessions, size)
    })
    .await
    .map_err(|error| format!("纸谱传输准备中断：{error}"))?
}
#[tauri::command]
pub async fn write_located_paper_chunk(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    session: String,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let lease = crate::score_edit::reserve(&state, &format!("located-paper-input-{session}"))?;
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        practice_backup_bridge::write_located_input(&sessions, &session, offset, &bytes)
    })
    .await
    .map_err(|error| format!("纸谱分块传输中断：{error}"))?
}
#[tauri::command]
pub async fn finish_located_paper_upload(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    session: String,
) -> Result<LocatedPaperSaved, String> {
    let lease = crate::score_edit::reserve(&state, &format!("located-paper-input-{session}"))?;
    let input = practice_backup_bridge::take_located_input(&sessions, &session)?;
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        let bytes = input.into_bytes()?;
        let (meta, pages) =
            panthesia_engine::score_attachments::decode_located_paper_upload(&bytes)?;
        drop(bytes);
        let result = engine.command(panthesia_engine::Command::CreateLocatedScorePaper {
            content_id: meta.content_id,
            score_revision: meta.score_revision,
            source_fingerprint: meta.source_fingerprint,
            mapping_token: meta.mapping_token,
            name: meta.name,
            pages,
            anchors: meta.anchors,
        })?;
        let active = result
            .get("createdPaperId")
            .or_else(|| result.get("active"))
            .and_then(serde_json::Value::as_str)
            .ok_or("纸谱已处理，保存结果尚未确认，请重新核对谱页列表")?
            .to_owned();
        Ok(LocatedPaperSaved {
            active,
            already_saved: result["alreadySaved"] == true,
        })
    })
    .await
    .map_err(|error| format!("纸谱保存处理中断，结果需要核对：{error}"))?
}
#[tauri::command]
pub async fn cancel_located_paper_upload(
    sessions: tauri::State<'_, Sessions>,
    session: String,
) -> Result<(), String> {
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        practice_backup_bridge::cancel_located_input(&sessions, &session)
    })
    .await
    .map_err(|error| error.to_string())?
}
