use crate::{
    score_draft_bridge::DraftSelection,
    score_jobs::{ScoreJobKind, ScoreJobRequest, ScoreSubmitted},
};
use panthesia_engine::score_export::{
    Artifact, ScoreExportInput, ScoreExportOptions, ScoreExportPreview,
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedScoreExport {
    pub id: String,
    pub content_id: String,
    pub score_revision: u64,
    pub annotation_revision: Option<u64>,
    pub finger_action_revision: Option<String>,
    pub options: ScoreExportOptions,
    pub created_at_ms: u64,
    pub size: usize,
    pub preview: ScoreExportPreview,
    pub saved_path: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreExportCacheItem {
    pub id: String,
    pub content_id: String,
    pub name: String,
    pub size: usize,
    pub created_at_ms: u64,
    pub saved_path: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreExportCacheListing {
    pub revision: u64,
    pub items: Vec<ScoreExportCacheItem>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreExportResult {
    pub input: ScoreExportInput,
    pub prepared: Option<ScoreExportCacheItem>,
    pub preview: Option<ScoreExportPreview>,
    pub warning: Option<String>,
}
struct Entry {
    summary: PreparedScoreExport,
    bytes: Vec<u8>,
    retained: usize,
    saved: Mutex<Option<String>>,
}
impl Entry {
    fn saved_path(&self) -> Option<String> {
        self.saved
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }
    fn prepared(&self) -> PreparedScoreExport {
        let mut result = self.summary.clone();
        result.saved_path = self.saved_path();
        result
    }
    fn item(&self) -> ScoreExportCacheItem {
        ScoreExportCacheItem {
            id: self.summary.id.clone(),
            content_id: self.summary.content_id.clone(),
            name: self.summary.preview.name.clone(),
            size: self.summary.size,
            created_at_ms: self.summary.created_at_ms,
            saved_path: self.saved_path(),
        }
    }
}
#[derive(Default)]
struct CacheState {
    entries: BTreeMap<String, Arc<Entry>>,
    revision: u64,
}
#[derive(Clone, Default)]
pub struct Cache(Arc<Mutex<CacheState>>);
impl Cache {
    fn capacity(&self, additional: usize) -> Result<(), String> {
        let all = self.0.lock().map_err(|_| "导出成品缓存不可用")?;
        if all.entries.len() >= 8
            || all
                .entries
                .values()
                .map(|entry| entry.retained)
                .sum::<usize>()
                + additional
                > 64_000_000
        {
            return Err("这份成品超出缓存余量（最多 8 份、总计 64 MB）。".into());
        }
        Ok(())
    }
    fn entry(&self, request: &DraftSelection) -> Result<Arc<Entry>, String> {
        self.0
            .lock()
            .map_err(|_| "导出成品缓存不可用")?
            .entries
            .get(&request.id)
            .filter(|entry| entry.summary.content_id == request.content_id)
            .cloned()
            .ok_or_else(|| "这份导出成品已释放或来自另一次启动，请按当前内容重新制作。".into())
    }
}
#[tauri::command]
pub async fn prepare_score_export(
    state: tauri::State<'_, crate::State>,
    cache: tauri::State<'_, Cache>,
    request: ScoreJobRequest,
    input: ScoreExportInput,
) -> Result<ScoreSubmitted, String> {
    if request.content_id != input.content_id {
        return Err("导出谱的来源曲目不一致".into());
    }
    let guard = state.score_jobs.begin(
        Some(request.clone()),
        ScoreJobKind::AnnotatedScore,
        &input.content_id,
        &state.engine,
    )?;
    let control = guard.token();
    let engine = state.engine.clone();
    let cache = cache.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        control.stage("preparingAnnotatedScore")?;
        let Artifact { preview, bytes } =
            engine.prepare_annotated_score(input.clone(), &|| control.check())?;
        control.stage("retainingAnnotatedScore")?;
        let summary = PreparedScoreExport {
            id: request.id,
            content_id: input.content_id.clone(),
            score_revision: input.score_revision,
            annotation_revision: input.annotation_revision,
            finger_action_revision: input.finger_action_revision.clone(),
            options: input.options.clone(),
            created_at_ms: crate::score_draft_bridge::now_ms(),
            size: bytes.len(),
            preview,
            saved_path: None,
        };
        let retained = bytes.len()
            + serde_json::to_vec(&summary)
                .map_err(|error| error.to_string())?
                .len();
        if let Err(warning) = cache.capacity(retained) {
            control.check()?;
            return Ok(ScoreExportResult {
                input,
                prepared: None,
                preview: Some(summary.preview),
                warning: Some(format!(
                    "{warning} 已制作预览，保存时会重新核对当前资料并生成文件。"
                )),
            });
        }
        control.check()?;
        let entry = Arc::new(Entry {
            summary,
            bytes,
            retained,
            saved: Mutex::new(None),
        });
        let result = entry.item();
        {
            let mut all = cache.0.lock().map_err(|_| "导出成品缓存不可用")?;
            all.entries.insert(entry.summary.id.clone(), entry);
            all.revision = all.revision.wrapping_add(1);
        }
        control.check()?;
        Ok(ScoreExportResult {
            input,
            prepared: Some(result),
            preview: None,
            warning: None,
        })
    })
    .await
    .map_err(|error| error.to_string())?;
    guard.finish_export(result)
}
#[tauri::command]
pub async fn list_score_exports(
    state: tauri::State<'_, crate::State>,
    cache: tauri::State<'_, Cache>,
    engine_id: String,
) -> Result<ScoreExportCacheListing, String> {
    state.engine.check_engine(&engine_id)?;
    let all = cache.0.lock().map_err(|_| "导出成品缓存不可用")?;
    let mut rows = all
        .entries
        .values()
        .map(|entry| entry.item())
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    Ok(ScoreExportCacheListing {
        revision: all.revision,
        items: rows,
    })
}
#[tauri::command]
pub async fn read_score_export(
    state: tauri::State<'_, crate::State>,
    cache: tauri::State<'_, Cache>,
    request: DraftSelection,
) -> Result<PreparedScoreExport, String> {
    state.engine.check_engine(&request.engine_id)?;
    Ok(cache.entry(&request)?.prepared())
}
#[tauri::command]
pub async fn remove_score_export(
    state: tauri::State<'_, crate::State>,
    cache: tauri::State<'_, Cache>,
    request: DraftSelection,
) -> Result<(), String> {
    state.engine.check_engine(&request.engine_id)?;
    let _lease = crate::score_edit::reserve(&state, &format!("export-save-{}", request.id))?;
    cache.entry(&request)?;
    let mut all = cache.0.lock().map_err(|_| "导出成品缓存不可用")?;
    if all.entries.remove(&request.id).is_some() {
        all.revision = all.revision.wrapping_add(1);
    }
    Ok(())
}
#[tauri::command]
pub async fn save_score_export(
    state: tauri::State<'_, crate::State>,
    cache: tauri::State<'_, Cache>,
    request: DraftSelection,
) -> Result<Option<String>, String> {
    state.engine.check_engine(&request.engine_id)?;
    let lease = crate::score_edit::reserve(&state, &format!("export-save-{}", request.id))?;
    let entry = cache.entry(&request)?;
    let Some(file) = crate::file_dialog(&state.data, "exportScore")
        .set_title("保存已制作的个人标记谱")
        .add_filter("MusicXML 乐谱", &["musicxml"])
        .set_file_name(&entry.summary.preview.name)
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let data = state.data.clone();
    let cache = cache.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        let saved = crate::export_files::write(&data, &path, &entry.bytes, "musicxml")?;
        {
            let mut all = cache
                .0
                .lock()
                .map_err(|_| "文件已保存，成品回执尚未更新，请核对保存位置")?;
            *entry
                .saved
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = Some(saved.clone());
            all.revision = all.revision.wrapping_add(1);
        }
        Ok::<_, String>(saved)
    })
    .await
    .map_err(|error| error.to_string())??;
    crate::remember_location(&state.data, "exportScore", file.path(), false);
    Ok(Some(result))
}
