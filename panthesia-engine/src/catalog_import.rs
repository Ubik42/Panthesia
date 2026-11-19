//! File imports publish owned library assets without replacing the live performance.
use crate::{
    Engine, Player, background_tasks::TaskToken, import_pipeline, music_import::ImportedSong,
    preferences::ScoreVersion, runtime_request,
};
use panthesia_core::utils::atomic_file;
use std::sync::{Arc, mpsc};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct Published {
    pub song: ImportedSong,
    pub score: Option<ScoreVersion>,
}
#[derive(serde::Serialize, serde::Deserialize)]
struct Committed {
    version: u8,
    request_hash: String,
    receipt: crate::music_import::MusicReceipt,
    published: Published,
}
fn receipt_path(data: &std::path::Path, id: &str) -> std::path::PathBuf {
    data.join("catalog-import-results")
        .join(format!("{}.json", blake3::hash(id.as_bytes()).to_hex()))
}
pub(super) fn committed(
    data: &std::path::Path,
    receipt: &crate::music_import::MusicReceipt,
    request_hash: &str,
) -> Result<Option<Published>, String> {
    let bytes = match atomic_file::read_limited(&receipt_path(data, &receipt.id), 1_000_000) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("曲库提交结果无法读取：{error}")),
    };
    let saved: Committed =
        serde_json::from_slice(&bytes).map_err(|_| "曲库提交结果无法解析，原文件与回执保留")?;
    let song = &saved.published.song;
    let source = std::path::Path::new(&song.source_path);
    let valid_hash =
        |value: &str| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit());
    let score_matches = match (&receipt.kind, &saved.published.score) {
        (crate::music_import::MusicKind::Midi, None) => true,
        (crate::music_import::MusicKind::Score, Some(score)) => {
            valid_hash(&score.content_id)
                && score.id
                    == format!(
                        "catalog-{}",
                        blake3::hash(
                            format!("{}:{}:{}", song.content_id, score.content_id, score.name)
                                .as_bytes()
                        )
                        .to_hex()
                    )
                && !score.name.is_empty()
                && score.name.len() <= 1024
        }
        _ => false,
    };
    if !receipt.catalog_only
        || !score_matches
        || saved.version != 1
        || saved.request_hash != request_hash
        || saved.receipt.id != receipt.id
        || saved.receipt.engine_id != receipt.engine_id
        || saved.receipt.name != receipt.name
        || saved.receipt.kind != receipt.kind
        || saved.receipt.size != receipt.size
        || saved.receipt.received != receipt.size
        || receipt.received != receipt.size
        || saved.receipt.phase != crate::music_import::MusicPhase::Queued
        || !saved.receipt.catalog_only
        || !song.catalog_only
        || !crate::music_import_receipts::valid_song(song)
        || !crate::asset_storage::captures(data, source)
        || source.parent() != Some(data.join("imports").as_path())
        || !valid_hash(&song.content_id)
        || saved.published.score.as_ref().is_some_and(|score| {
            score.path.parent() != Some(data.join("scores").as_path())
                || !crate::asset_storage::captures(data, &score.path)
        })
    {
        return Err("曲库提交结果与原请求不一致，原记录继续保留，请先核对曲库".into());
    }
    Ok(Some(saved.published))
}
fn registered(data: &std::path::Path, published: &Published) -> Result<bool, String> {
    let Some(version) = &published.score else {
        return Ok(true);
    };
    let prefs = crate::Preferences::load(&data.join("web-preferences.json"))?;
    Ok(prefs
        .score_versions
        .get(&published.song.content_id)
        .is_some_and(|rows| {
            rows.iter()
                .any(|row| row.path == version.path && row.content_id == version.content_id)
        }))
}
pub(super) fn recover_receipt(
    data: &std::path::Path,
    hash: &str,
    mut receipt: crate::music_import::MusicReceipt,
) -> Result<crate::music_import::MusicReceipt, String> {
    if receipt.catalog_only && receipt.phase == crate::music_import::MusicPhase::Unconfirmed {
        if let Some(published) = committed(data, &receipt, hash)? {
            let complete = registered(data, &published)?;
            receipt.song = Some(published.song);
            receipt.cancellable = false;
            if complete {
                receipt.phase = crate::music_import::MusicPhase::Done;
                receipt.error = None;
            } else {
                receipt.error =
                    Some("曲库文件已保存，谱面登记尚未完成。可接续原请求完成登记。".into());
            }
        }
    }
    Ok(receipt)
}
struct RecoveryObservation(crate::pending_save::Pipeline);
impl Drop for RecoveryObservation {
    fn drop(&mut self) {
        self.0.observe_recovery();
    }
}
impl Engine {
    pub(super) fn import_to_catalog(
        &self,
        input: import_pipeline::Input,
        token: &TaskToken,
        receipt: crate::music_import::MusicReceipt,
        request_hash: String,
    ) -> Result<ImportedSong, String> {
        token.stage("reading")?;
        let mut prepared = import_pipeline::prepare_checked(input, &|| token.check())?;
        token.source(prepared.content_id(), prepared.fingerprint())?;
        token.check()?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        let published = loop {
            token.check()?;
            if self.closing.load(std::sync::atomic::Ordering::Acquire) {
                return Err("正在关闭练习室，曲库导入已停止".into());
            }
            if self.storage_busy.load(std::sync::atomic::Ordering::Acquire) {
                if std::time::Instant::now() >= deadline {
                    return Err("其他资料尚在保存或恢复，请稍后继续导入".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
                continue;
            }
            token.stage("preparingLibrary")?;
            let selected = self.data.clone();
            let selector = Arc::new(move |path: &std::path::Path| {
                crate::asset_storage::captures(&selected, path)
            });
            let (published, writes, observed) = atomic_file::capture_matching(selector, || {
                let published = prepared.store_catalog(&self.data, &|| token.check())?;
                let committed = Committed {
                    version: 1,
                    request_hash: request_hash.clone(),
                    receipt: receipt.clone(),
                    published: published.clone(),
                };
                let bytes = crate::json_stream::encode(&committed, Vec::new(), 1_000_000, || {
                    token.check()
                })?;
                atomic_file::write(&receipt_path(&self.data, &receipt.id), &bytes)
                    .map_err(|error| error.to_string())?;
                Ok::<_, String>(published)
            });
            let published = published?;
            token.check()?;
            token.stage("waitingStorage")?;
            let data = self.data.clone();
            let busy = self.storage_busy.clone();
            let publication = token.clone();
            let pipeline = self.pending_saves.clone();
            let result = self.storage_tasks.run_owned("保存导入曲库文件", move |_| {
                if busy.load(std::sync::atomic::Ordering::Acquire) {
                    return Ok(serde_json::json!({"busy":true}));
                }
                let _observe = RecoveryObservation(pipeline);
                crate::asset_storage::commit_at(&data, writes, observed, || {
                    publication.begin_commit()
                })?;
                Ok(serde_json::json!({"busy":false}))
            });
            match result {
                Ok(value) if value["busy"] == true => {}
                Ok(_) => break published,
                Err(error)
                    if !token.is_committing()
                        && crate::asset_storage::changed_before_commit(&error) => {}
                Err(error) => return Err(error),
            }
            if std::time::Instant::now() >= deadline {
                return Err("曲库资料持续变化，请稍后重试导入；原文件保留".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        token.stage("registeringScore")?;
        self.finish_catalog_registration(&published)?;
        Ok(published.song)
    }
    pub(super) fn finish_catalog_registration(&self, published: &Published) -> Result<(), String> {
        if let Some(version) = &published.score {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
            loop {
                let (reply, receiver) = mpsc::sync_channel(1);
                self.tx
                    .send(runtime_request::Request::RegisterImportedScore {
                        content_id: published.song.content_id.clone(),
                        version: version.clone(),
                        reply,
                    })
                    .map_err(|_| "音乐引擎已关闭，曲库文件已保存，谱面登记仍需核对")?;
                if receiver
                    .recv()
                    .map_err(|_| "谱面登记回复未读到，曲库文件已保存，请先核对曲库")??
                {
                    break;
                }
                if std::time::Instant::now() >= deadline
                    || self.closing.load(std::sync::atomic::Ordering::Acquire)
                {
                    return Err("曲库文件已保存，其他保存尚未结束，请先核对曲库中的谱面登记".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
        Ok(())
    }
}
impl Player {
    pub(super) fn register_imported_score(
        &mut self,
        content_id: String,
        version: ScoreVersion,
    ) -> Result<(), String> {
        let rows = self.preferences.score_versions.get(&content_id);
        let existing = rows.and_then(|rows| {
            rows.iter().position(|row| {
                row.id == version.id
                    || row.path == version.path && row.content_id == version.content_id
            })
        });
        if let Some(index) = existing {
            let row = &rows.unwrap()[index];
            if row.content_id != version.content_id {
                return Err("导入谱面身份与已有登记冲突，请先核对曲库".into());
            }
            if row.path == version.path {
                return Ok(());
            }
        } else if rows.is_some_and(|rows| rows.len() >= 100) {
            return Err("曲库文件已保存，这首曲目的谱面版本已达 100 份，请整理后再登记".into());
        }
        let previous = self.preferences.clone();
        let rows = self
            .preferences
            .score_versions
            .entry(content_id)
            .or_default();
        if let Some(index) = existing {
            rows[index].path = version.path;
        } else {
            rows.push(version);
        }
        if let Err(error) = self.preferences.save(&self.preferences_path) {
            self.preferences = previous;
            return Err(error);
        }
        // The actor's save capture acknowledges only after the merged preference root is stored.
        Ok(())
    }
}
