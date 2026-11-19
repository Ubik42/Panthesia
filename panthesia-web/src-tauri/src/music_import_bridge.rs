use crate::State;
use panthesia_engine::music_import::{Begin, Chunk, MusicReceipt, Selection};
#[tauri::command]
pub async fn refresh_package_preview(
    state: tauri::State<'_, State>,
    request: panthesia_engine::package_preview::PackagePreviewRequest,
) -> Result<panthesia_engine::package_preview::PackagePreview, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.refresh_package_preview(request))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn prepare_package(
    state: tauri::State<'_, State>,
    request: panthesia_engine::music_import::PackageRequest,
) -> Result<MusicReceipt, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.prepare_package(request))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn prepare_exercise(
    state: tauri::State<'_, State>,
    request: panthesia_engine::music_import::ExerciseRequest,
) -> Result<MusicReceipt, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.prepare_exercise(request))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn begin_music_import(
    state: tauri::State<'_, State>,
    request: Begin,
) -> Result<MusicReceipt, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.begin_music_import(request))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn write_music_import(
    state: tauri::State<'_, State>,
    request: Chunk,
) -> Result<MusicReceipt, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.write_music_chunk(request))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn finish_music_import(
    state: tauri::State<'_, State>,
    request: Selection,
) -> Result<MusicReceipt, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.finish_music_import(&request.id))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn read_music_import(
    state: tauri::State<'_, State>,
    request: Selection,
) -> Result<MusicReceipt, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.read_music_import(&request.id))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn cancel_music_import(
    state: tauri::State<'_, State>,
    request: Selection,
) -> Result<MusicReceipt, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.cancel_music_preparation(&request.id, request.kind)
    })
    .await
    .map_err(|error| error.to_string())?
}
