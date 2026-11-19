use crate::{
    score_draft_bridge::DraftSelection,
    score_jobs::{ScoreJobKind, ScoreJobRequest, ScoreSubmitted},
};
use panthesia_engine::{
    media_export::{MediaExportInput, MediaExportKind},
    media_export_cache::{self, MediaExportDraft, Record},
};

fn name(title: &str, kind: MediaExportKind) -> String {
    let title = title
        .chars()
        .take(100)
        .map(|value| {
            if "<>:\"/\\|?*".contains(value) || value.is_control() {
                '_'
            } else {
                value
            }
        })
        .collect::<String>();
    format!(
        "{}.{}",
        if title.trim().is_empty() {
            "曲目"
        } else {
            title.trim()
        },
        kind.extension()
    )
}
fn location(kind: MediaExportKind) -> &'static str {
    match kind {
        MediaExportKind::Midi | MediaExportKind::PracticeMidi => "exportMidi",
        MediaExportKind::Package => "exportPiece",
    }
}
fn title(kind: MediaExportKind) -> &'static str {
    match kind {
        MediaExportKind::Midi | MediaExportKind::PracticeMidi => "另存 MIDI 副本",
        MediaExportKind::Package => "另存曲目包",
    }
}
fn filter(kind: MediaExportKind) -> &'static str {
    match kind {
        MediaExportKind::Midi | MediaExportKind::PracticeMidi => "MIDI 演奏",
        MediaExportKind::Package => "Panthesia 曲目包",
    }
}

#[tauri::command]
pub async fn prepare_media_export(
    state: tauri::State<'_, crate::State>,
    request: ScoreJobRequest,
    input: MediaExportInput,
) -> Result<ScoreSubmitted, String> {
    if request.content_id != input.content_id {
        return Err("导出曲目来源不一致".into());
    }
    let cache_lease = crate::score_edit::reserve(&state, "media-export-cache")?;
    let kind = match input.kind {
        MediaExportKind::Midi | MediaExportKind::PracticeMidi => ScoreJobKind::MidiExport,
        MediaExportKind::Package => ScoreJobKind::PackageExport,
    };
    let guard = state.score_jobs.begin(
        Some(request.clone()),
        kind,
        &input.content_id,
        &state.engine,
    )?;
    let control = guard.token();
    let engine = state.engine.clone();
    let data = state.data.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _cache_lease = cache_lease;
        control.stage("readingExportSource")?;
        control.stage(if input.kind == MediaExportKind::Package {
            "encodingPackage"
        } else {
            "preparingMidi"
        })?;
        let output = engine.prepare_media_export(input.clone(), &|| control.check())?;
        control.stage("retainingMediaExport")?;
        let hash = blake3::hash(&output.bytes).to_hex().to_string();
        let id = blake3::hash(format!("{}:{}:{}", request.engine_id, request.id, hash).as_bytes())
            .to_hex()
            .to_string();
        let draft = MediaExportDraft {
            id,
            content_id: output.content_id,
            request_id: request.id,
            kind: input.kind,
            name: name(&output.title, input.kind),
            title: output.title,
            size: output.bytes.len(),
            created_at_ms: crate::score_draft_bridge::now_ms(),
            summary: output.summary,
            saved_path: None,
            save_pending_path: None,
            previous_pending_paths: Vec::new(),
            warning: None,
        };
        control.check()?;
        let record = Record {
            draft: draft.clone(),
            hash,
        };
        if let Some(retained) = media_export_cache::equivalent(&data, &record, &|| control.check())?
        {
            control.check()?;
            return Ok(retained);
        }
        media_export_cache::store(&data, &record, &output.bytes)?;
        control.check()?;
        Ok(draft)
    })
    .await
    .map_err(|error| error.to_string())?;
    guard.finish_media(result)
}
#[tauri::command]
pub async fn list_media_exports(
    state: tauri::State<'_, crate::State>,
    engine_id: String,
) -> Result<media_export_cache::MediaExportListing, String> {
    state.engine.check_engine(&engine_id)?;
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || media_export_cache::list(&data))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn remove_media_export(
    state: tauri::State<'_, crate::State>,
    request: DraftSelection,
) -> Result<(), String> {
    state.engine.check_engine(&request.engine_id)?;
    let cache_lease = crate::score_edit::reserve(&state, "media-export-cache")?;
    let lease = crate::score_edit::reserve(&state, &format!("media-export-{}", request.id))?;
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _cache_lease = cache_lease;
        let _lease = lease;
        media_export_cache::remove(&data, &request.id, &request.content_id)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn save_media_export(
    state: tauri::State<'_, crate::State>,
    request: ScoreJobRequest,
    draft: DraftSelection,
) -> Result<ScoreSubmitted, String> {
    if request.engine_id != draft.engine_id || request.content_id != draft.content_id {
        return Err("导出成品的来源不一致".into());
    }
    let guard = state
        .score_jobs
        .begin_export_save(request, &draft.content_id, &state.engine)?;
    let control = guard.token();
    let result = async {
        control.stage("readingCachedExport")?;
        let cache_lease = crate::score_edit::reserve(&state, "media-export-cache")?;
        let lease = crate::score_edit::reserve(&state, &format!("media-export-{}", draft.id))?;
        let data = state.data.clone();
        let (mut record, source) = tauri::async_runtime::spawn_blocking(move || {
            media_export_cache::read(&data, &draft.id, &draft.content_id)
        })
        .await
        .map_err(|error| error.to_string())??;
        control.stage("choosingExportTarget")?;
        let kind = record.draft.kind;
        let Some(file) = crate::file_dialog(&state.data, location(kind))
            .set_title(title(kind))
            .add_filter(filter(kind), &[kind.extension()])
            .set_file_name(&record.draft.name)
            .save_file()
            .await
        else {
            return Ok(None);
        };
        control.check()?;
        control.stage("copyingMediaExport")?;
        let destination = file.path().to_path_buf();
        let data = state.data.clone();
        let output = tauri::async_runtime::spawn_blocking(move || {
            let _cache_lease = cache_lease;
            let _lease = lease;
            let destination =
                crate::export_files::destination(&data, &destination, kind.extension())?;
            let destination_name = destination.to_string_lossy().into_owned();
            let previous_pending = record.draft.save_pending_path.clone();
            let previous_paths = record.draft.previous_pending_paths.clone();
            if let Some(previous) = &record.draft.save_pending_path {
                if previous != &destination_name
                    && !record.draft.previous_pending_paths.contains(previous)
                {
                    if record.draft.previous_pending_paths.len() >= 16 {
                        return Err(
                            "待确认的保存位置较多，请先核对原保存结果。导出成品仍保留。".into()
                        );
                    }
                    record.draft.previous_pending_paths.push(previous.clone());
                }
            }
            record.draft.save_pending_path = Some(destination_name.clone());
            media_export_cache::update(&data, &record)?;
            let reported = std::cell::Cell::new(0u64);
            let copied = crate::export_files::copy(
                &data,
                &source,
                &destination,
                kind.extension(),
                record.draft.size as u64,
                &record.hash,
                &|| control.check(),
                &|written| {
                    let percent = written * 100 / record.draft.size as u64;
                    if percent >= reported.get() + 5 || percent == 100 {
                        reported.set(percent);
                        let _ = control.stage(&format!("writingMediaExport:{percent}"));
                    }
                },
                &|| control.begin_commit("committingMediaExport"),
            );
            let saved = match copied {
                Ok(saved) => saved,
                Err(error) => {
                    record.draft.save_pending_path = previous_pending;
                    record.draft.previous_pending_paths = previous_paths;
                    let _ = media_export_cache::update(&data, &record);
                    return Err(error);
                }
            };
            record.draft.saved_path = Some(saved);
            record.draft.save_pending_path = None;
            record
                .draft
                .previous_pending_paths
                .retain(|path| path != &destination_name);
            record.draft.warning = if record.draft.previous_pending_paths.is_empty() {
                None
            } else {
                Some("这份成品已另存，其他原保存位置仍待核对。".into())
            };
            if let Err(error) = media_export_cache::update(&data, &record) {
                record.draft.warning = Some(format!("文件已另存，缓存回执尚未更新：{error}"));
            }
            Ok::<_, String>(record.draft)
        })
        .await
        .map_err(|error| error.to_string())??;
        crate::remember_location(&state.data, location(kind), file.path(), false);
        Ok(Some(output))
    }
    .await;
    match result {
        Ok(None) => guard.cancel(),
        Ok(Some(output)) => guard.finish_media(Ok(output)),
        Err(error) => guard.finish_media(Err(error)),
    }
}
#[tauri::command]
pub async fn confirm_media_export(
    state: tauri::State<'_, crate::State>,
    request: DraftSelection,
) -> Result<MediaExportDraft, String> {
    use std::io::Read;
    state.engine.check_engine(&request.engine_id)?;
    let cache_lease = crate::score_edit::reserve(&state, "media-export-cache")?;
    let lease = crate::score_edit::reserve(&state, &format!("media-export-{}", request.id))?;
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _cache_lease = cache_lease;
        let _lease = lease;
        let (mut record, _) = media_export_cache::read(&data, &request.id, &request.content_id)?;
        let mut targets = record.draft.previous_pending_paths.clone();
        if let Some(target) = &record.draft.save_pending_path {
            targets.push(target.clone());
        }
        targets.sort();
        targets.dedup();
        if targets.is_empty() {
            return Ok(record.draft);
        }
        let mut remaining = Vec::new();
        let mut issues = Vec::new();
        for target in targets {
            let verified = (|| -> Result<(), String> {
                let mut file = std::fs::File::open(&target).map_err(|error| error.to_string())?;
                if file.metadata().map_err(|error| error.to_string())?.len()
                    != record.draft.size as u64
                {
                    return Err("文件大小与导出成品不一致".into());
                }
                let mut hash = blake3::Hasher::new();
                let mut bytes = [0; 65_536];
                let mut size = 0;
                loop {
                    let count = file.read(&mut bytes).map_err(|error| error.to_string())?;
                    if count == 0 {
                        break;
                    }
                    size += count;
                    if size > record.draft.size {
                        return Err("文件正在改变".into());
                    }
                    hash.update(&bytes[..count]);
                }
                if size != record.draft.size || hash.finalize().to_hex().as_str() != record.hash {
                    return Err("文件内容与导出成品不一致".into());
                }
                Ok(())
            })();
            match verified {
                Ok(()) => record.draft.saved_path = Some(target),
                Err(error) => {
                    issues.push(format!(
                        "{}：{}",
                        target.chars().take(256).collect::<String>(),
                        error.chars().take(256).collect::<String>()
                    ));
                    remaining.push(target);
                }
            }
        }
        record.draft.save_pending_path = remaining.pop();
        record.draft.previous_pending_paths = remaining;
        record.draft.warning = if issues.is_empty() {
            None
        } else {
            Some(format!(
                "部分原保存位置尚未找到一致文件，成品保留，可以另存新副本。{}",
                issues.join("；")
            ))
        };
        media_export_cache::update(&data, &record)?;
        Ok(record.draft)
    })
    .await
    .map_err(|error| error.to_string())?
}
pub async fn legacy_save(
    state: &crate::State,
    kind: MediaExportKind,
) -> Result<Option<String>, String> {
    let lease = crate::score_edit::reserve(state, "legacy-media-export")?;
    let content_id = state
        .engine
        .snapshot()
        .content_id
        .ok_or("请先打开曲目或保存录音")?;
    let engine = state.engine.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        engine.prepare_media_export(MediaExportInput { content_id, kind }, &|| Ok(()))
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some(file) = crate::file_dialog(&state.data, location(kind))
        .set_title(title(kind))
        .add_filter(filter(kind), &[kind.extension()])
        .set_file_name(name(&output.title, kind))
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let data = state.data.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        crate::export_files::write(&data, &path, &output.bytes, kind.extension())
    })
    .await
    .map_err(|error| error.to_string())??;
    crate::remember_location(&state.data, location(kind), file.path(), false);
    Ok(Some(saved))
}
