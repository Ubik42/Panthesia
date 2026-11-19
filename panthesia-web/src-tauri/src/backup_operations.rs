use panthesia_engine::backup_operations::{
    BackupImportQuery, BackupImportReceipt, BackupImportRequest,
};
#[derive(Default)]
pub struct DraftSaves(
    std::sync::Mutex<std::collections::BTreeMap<String, crate::score_edit::Lease>>,
);
#[tauri::command]
pub fn hold_backup_draft(
    state: tauri::State<'_, crate::State>,
    saves: tauri::State<'_, DraftSaves>,
    id: String,
) -> Result<(), String> {
    if !(8..=96).contains(&id.len())
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("备份工作进度保存编号无效".into());
    }
    let mut all = saves.0.lock().map_err(|_| "备份工作进度状态不可用")?;
    if all.contains_key(&id) {
        return Ok(());
    }
    if all.len() >= 4 {
        return Err("备份工作进度正在保存，请稍候".into());
    }
    let lease = crate::score_edit::reserve_draft(&state, &format!("backup-draft-{id}"))?;
    all.insert(id, lease);
    Ok(())
}
#[tauri::command]
pub fn release_backup_draft(saves: tauri::State<'_, DraftSaves>, id: String) -> Result<(), String> {
    saves
        .0
        .lock()
        .map_err(|_| "备份工作进度状态不可用")?
        .remove(&id);
    Ok(())
}
#[tauri::command]
pub fn backup_import_protocol() -> u8 {
    1
}
#[tauri::command]
pub async fn prepare_backup_import(
    state: tauri::State<'_, crate::State>,
    request: BackupImportRequest,
) -> Result<BackupImportReceipt, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.prepare_backup_import(request))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn read_backup_import(
    state: tauri::State<'_, crate::State>,
    request: BackupImportQuery,
) -> Result<Option<BackupImportReceipt>, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.read_backup_import(&request.engine_id, &request.id)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn cancel_backup_import(
    state: tauri::State<'_, crate::State>,
    request: BackupImportQuery,
) -> Result<Option<BackupImportReceipt>, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.cancel_backup_import(&request.engine_id, &request.id)
    })
    .await
    .map_err(|error| error.to_string())?
}
