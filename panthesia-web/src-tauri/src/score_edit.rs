//! Saving an editable original is a resumable operation, independent of opening the editor.
use panthesia_engine::{
    Command, Engine,
    notation_drafts::{self, DraftSaved},
};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

/// Only a retained draft or an acknowledged original may leave the bounded preview registry.
pub fn make_preview_room<T>(
    rows: &mut HashMap<String, T>,
    incoming: Option<&str>,
    retained: impl Fn(&T) -> Option<std::time::Instant>,
) -> Result<(), String> {
    if incoming.is_some_and(|id| rows.contains_key(id)) {
        return Ok(());
    }
    while rows.len() >= 16 {
        let oldest = rows
            .iter()
            .filter_map(|(id, row)| retained(row).map(|created| (id.clone(), created)))
            .min_by_key(|(_, created)| *created)
            .map(|(id, _)| id)
            .ok_or("已有多份尚未保留的谱面初稿，请先另存当前初稿后继续制作")?;
        rows.remove(&oldest);
    }
    Ok(())
}
#[derive(Clone, Copy)]
pub enum Kind {
    Midi,
    Paper,
}
#[derive(Clone)]
enum Source {
    Midi(crate::GeneratedScorePreview),
    Paper(crate::audiveris_paper::RecognizedScorePreview),
}
impl Source {
    fn saved(&self) -> Option<&Value> {
        match self {
            Self::Midi(row) => row.saved.as_ref(),
            Self::Paper(row) => row.saved.as_ref(),
        }
    }
    fn matches(&self, content_id: &str, name: &str, bytes: &[u8]) -> bool {
        let (cid, filename, hash) = match self {
            Self::Midi(row) => (&row.content_id, &row.name, &row.hash),
            Self::Paper(row) => (&row.content_id, &row.name, &row.hash),
        };
        cid == content_id && filename == name && blake3::hash(bytes).to_hex().as_str() == hash
    }
    fn path(&self) -> &Path {
        match self {
            Self::Midi(row) => &row.source,
            Self::Paper(row) => &row.source,
        }
    }
    fn verify(
        &self,
        engine: &Engine,
        data: &Path,
        content_id: &str,
        name: &str,
        bytes: &[u8],
    ) -> Result<(), String> {
        if !self.matches(content_id, name, bytes) {
            return Err("初稿内容已改变，请重新打开保留初稿".into());
        }
        match self {
            Self::Midi(row) => {
                if crate::verified_midi_source(engine, content_id)? != row.source {
                    return Err("曲目文件位置已改变，请重新打开保留初稿".into());
                }
                Ok(())
            }
            Self::Paper(row) => crate::audiveris_paper::verify_recognized_preview(
                engine, data, row, content_id, name, bytes,
            ),
        }
    }
}
struct Reservation {
    all: Arc<Mutex<HashSet<String>>>,
    id: String,
}
#[derive(Clone)]
pub struct Lease {
    _reservation: Arc<Reservation>,
}
impl Lease {
    fn take(
        all: Arc<Mutex<HashSet<String>>>,
        id: &str,
        closing: &std::sync::atomic::AtomicBool,
        allow_closing: Option<&std::sync::atomic::AtomicBool>,
    ) -> Result<Self, String> {
        {
            let mut pending = all.lock().map_err(|_| "原谱保存状态不可用")?;
            if closing.load(std::sync::atomic::Ordering::Acquire)
                && !allow_closing
                    .is_some_and(|allow| allow.load(std::sync::atomic::Ordering::Acquire))
            {
                return Err("软件正在关闭，请返回后继续保存资料".into());
            }
            if pending.len() >= 16 || !pending.insert(id.into()) {
                return Err("这份资料正在处理，请等待原操作完成".into());
            }
        }
        Ok(Self {
            _reservation: Arc::new(Reservation { all, id: id.into() }),
        })
    }
}
impl Drop for Reservation {
    fn drop(&mut self) {
        if let Ok(mut all) = self.all.lock() {
            all.remove(&self.id);
        }
    }
}
pub fn reserve(state: &crate::State, id: &str) -> Result<Lease, String> {
    Lease::take(state.score_saves.clone(), id, &state.closing, None)
}
#[derive(Clone)]
struct Cache {
    data: PathBuf,
    jobs: crate::score_jobs::Jobs,
    id: String,
    content_id: String,
    source: Source,
    generated: Arc<Mutex<std::collections::HashMap<String, crate::GeneratedScorePreview>>>,
    recognized: Arc<
        Mutex<std::collections::HashMap<String, crate::audiveris_paper::RecognizedScorePreview>>,
    >,
}
fn warning(result: &mut DraftSaved, message: String) {
    match &mut result.warning {
        Some(previous) if !previous.contains(&message) => {
            previous.push(' ');
            previous.push_str(&message);
        }
        None => result.warning = Some(message),
        _ => {}
    }
}
impl Cache {
    fn remember(&self, result: &mut DraftSaved) {
        self.jobs.remember_saved(&self.id, result);
        // Keep the in-memory receipt even when the cache is full or unavailable.
        if let Err(error) =
            notation_drafts::remember_saved(&self.data, &self.id, &self.content_id, result)
        {
            warning(
                result,
                format!("原谱保存记录暂未写入本机缓存，请保留文件位置：{error}"),
            );
        }
        let Ok(value) = serde_json::to_value(&*result) else {
            return;
        };
        match &self.source {
            Source::Midi(original) => {
                if let Ok(mut all) = self.generated.lock() {
                    let mut row = original.clone();
                    row.saved = Some(value);
                    let _ = make_preview_room(&mut all, Some(&self.id), |row| {
                        (row.cached || row.saved.is_some()).then_some(row.created)
                    });
                    all.insert(self.id.clone(), row);
                }
            }
            Source::Paper(original) => {
                if let Ok(mut all) = self.recognized.lock() {
                    let mut row = original.clone();
                    row.saved = Some(value);
                    let _ = make_preview_room(&mut all, Some(&self.id), |row| {
                        (row.cached || row.saved.is_some()).then_some(row.created)
                    });
                    all.insert(self.id.clone(), row);
                }
            }
        }
    }
}

pub async fn save(
    state: &crate::State,
    kind: Kind,
    content_id: String,
    name: String,
    bytes: Vec<u8>,
    id: String,
) -> Result<Option<Value>, String> {
    let _lease = reserve(state, &id)?;
    let source = match kind {
        Kind::Midi => state
            .generated_scores
            .lock()
            .map_err(|_| "转谱初稿正忙")?
            .get(&id)
            .cloned()
            .map(Source::Midi),
        Kind::Paper => state
            .recognized_scores
            .lock()
            .map_err(|_| "识谱初稿正忙")?
            .get(&id)
            .cloned()
            .map(Source::Paper),
    };
    let source = if let Some(source) = source {
        source
    } else {
        let data = state.data.clone();
        let cid = content_id.clone();
        let token = id.clone();
        let reading_lease = _lease.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _lease = reading_lease;
            let record = notation_drafts::load_record(&data, &token, &cid)?;
            let saved = notation_drafts::saved(&data, &token, &cid)?
                .map(serde_json::to_value)
                .transpose()
                .map_err(|error| error.to_string())?;
            match kind {
                Kind::Midi if record.kind == "midiToNotation" => {
                    Ok(Source::Midi(crate::GeneratedScorePreview {
                        created: std::time::Instant::now(),
                        cached: true,
                        content_id: record.content_id,
                        source: record.source,
                        name: record.name,
                        hash: record.hash,
                        saved,
                    }))
                }
                Kind::Paper if record.kind == "paperToNotation" => Ok(Source::Paper(
                    crate::audiveris_paper::RecognizedScorePreview {
                        created: std::time::Instant::now(),
                        cached: true,
                        content_id: record.content_id,
                        source: record.source,
                        name: record.name,
                        hash: record.hash,
                        saved,
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
                )),
                _ => Err("初稿类型已改变，请重新打开保留初稿".to_owned()),
            }
        })
        .await
        .map_err(|error| error.to_string())??
    };
    if bytes.is_empty() || bytes.len() > 4_000_000 || !source.matches(&content_id, &name, &bytes) {
        return Err("初稿内容或曲目已改变，请重新打开保留初稿".into());
    }
    let previous: Option<DraftSaved> = source
        .saved()
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|_| "原谱保存记录不完整，请先核对已保存的文件位置")?;
    if let Some(result) = &previous {
        if result.linked && result.version_id.is_some() {
            let mut recalled = result.clone();
            recalled.opened = false;
            recalled.already_saved = true;
            return Ok(Some(
                serde_json::to_value(recalled).map_err(|error| error.to_string())?,
            ));
        }
    }
    // Source verification includes file reads; do it away from the async dispatcher.
    let verify_source = source.clone();
    let verify_engine = state.engine.clone();
    let verify_data = state.data.clone();
    let verify_cid = content_id.clone();
    let verify_name = name.clone();
    let verify_bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        verify_source.verify(
            &verify_engine,
            &verify_data,
            &verify_cid,
            &verify_name,
            &verify_bytes,
        )
    })
    .await
    .map_err(|error| error.to_string())??;
    let path = if let Some(result) = &previous {
        result.path.clone()
    } else {
        let extension = match kind {
            Kind::Midi => "musicxml",
            Kind::Paper => "mxl",
        };
        let Some(file) = crate::file_dialog(&state.data, "notation")
            .set_title("保存可编辑原谱")
            .add_filter("乐谱初稿", &[extension])
            .set_file_name(&name)
            .save_file()
            .await
        else {
            return Ok(None);
        };
        file.path().to_path_buf()
    };
    let cache = Cache {
        data: state.data.clone(),
        jobs: state.score_jobs.clone(),
        id,
        content_id: content_id.clone(),
        source: source.clone(),
        generated: state.generated_scores.clone(),
        recognized: state.recognized_scores.clone(),
    };
    let worker_cache = cache.clone();
    let engine = state.engine.clone();
    let worker_lease = _lease.clone();
    let (mut result, can_open) = tauri::async_runtime::spawn_blocking(move || -> Result<(DraftSaved, bool), String> {
        let _worker_lease = worker_lease;
        source.verify(&engine, &worker_cache.data, &content_id, &name, &bytes)?;
        if path.to_str().is_none() { return Err("保存路径含有无法识别的字符，请选择其他文件夹".into()); }
        let parent = path.parent().ok_or("保存位置无效")?.canonicalize().map_err(|error| format!("保存文件夹无法读取：{error}"))?;
        if std::fs::canonicalize(&worker_cache.data).is_ok_and(|root| parent.starts_with(root)) {
            return Err("请选择个人乐谱文件夹。软件内部资料目录不能用作原谱编辑位置".into());
        }
        let mut result = if let Some(mut result) = previous {
            let original = panthesia_engine::score_sources::read_original(&result.path)
                .map_err(|error| format!("原谱已保存到 {}，当前无法读取。请先恢复该文件再继续：{error}", result.path.display()))?;
            if original != bytes {
                return Err(format!("原谱已保存到 {}，此后内容发生变化。请在原谱管理中核对更新；保留初稿可以另存副本。", result.path.display()));
            }
            result.warning = None;
            result
        } else {
            match kind { Kind::Midi => crate::write_new_generated_score(&path, &bytes)?, Kind::Paper => crate::audiveris_paper::write_new_mxl(&path, &bytes)? }
            DraftSaved {version_id: None, path, linked: false, opened: false, warning: None, already_saved: false}
        };
        worker_cache.remember(&mut result);
        let paper_check = matches!(&source, Source::Paper(_)).then(|| (content_id.clone(), name.clone(), bytes.clone()));
        let continuation = (|| -> Result<(), String> {
            source.verify(&engine, &worker_cache.data, &content_id, &name, &bytes)?;
            // Saving a version is idempotent for the same name and bytes. It also
            // repairs a missing version instead of trusting an old cached id.
            let version = engine.command(Command::SaveScoreVersion {bytes, name, content_id: content_id.clone()})?;
            let version_id = version["versionId"].as_str().ok_or("保存版本编号缺失")?.to_owned();
            result.version_id = Some(version_id.clone());
            worker_cache.remember(&mut result);
            engine.command(Command::LinkScoreSource {midi_path: source.path().to_path_buf(), content_id, version_id, path: result.path.clone(), default_bpm: 0})?;
            result.linked = true;
            Ok(())
        })();
        if let Err(error) = continuation {
            warning(&mut result, format!("原谱已保存，谱面版本与来源关联尚未全部完成。可以继续保存：{error}"));
        }
        let mut can_open = result.linked;
        if result.linked {
            if let Some((cid, name, bytes)) = paper_check {
                if let Err(error) = source.verify(&engine, &worker_cache.data, &cid, &name, &bytes) {
                    can_open = false;
                    warning(&mut result, format!("原谱与版本已保存；纸谱来源随后发生变化，编辑前请重新核对：{error}"));
                }
            }
        }
        worker_cache.remember(&mut result);
        Ok((result, can_open))
    }).await.map_err(|error| error.to_string())??;
    crate::remember_location(&state.data, "notation", &result.path, false);
    if result.linked && can_open {
        let version_id = result.version_id.as_deref().ok_or("保存版本编号缺失")?;
        match crate::launch_score_in_musescore(&state, &cache.content_id, version_id).await {
            Ok(()) => result.opened = true,
            Err(error) => warning(
                &mut result,
                format!("原谱与版本已保存，但 MuseScore 未能打开。可检查程序位置后重试：{error}"),
            ),
        }
    }
    let receipt_lease = _lease.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _receipt_lease = receipt_lease;
        cache.remember(&mut result);
        result
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(Some(
        serde_json::to_value(result).map_err(|error| error.to_string())?,
    ))
}
