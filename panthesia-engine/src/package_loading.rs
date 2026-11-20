//! Piece-package inspection and encoding run independently of playback and device ownership.
use crate::*;
use panthesia_core::utils::atomic_file;
use serde_json::{Value, json};
use std::{io::Read, path::Path};
pub(crate) fn check_token(token: &str) -> Result<(), String> {
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("曲目包预览已失效，请重新选择文件".into());
    }
    Ok(())
}
pub(crate) fn read_staged(data: &Path, token: &str) -> Result<Vec<u8>, String> {
    check_token(token)?;
    let bytes = atomic_file::read_limited(
        &data
            .join("package-transfers")
            .join(format!("{token}.neopiece")),
        256_000_000,
    )
    .map_err(|error| format!("曲目包预览缓存无法读取，请重新选择文件：{error}"))?;
    if blake3::hash(&bytes).to_hex().as_str() != token {
        return Err("曲目包缓存校验失败，请重新选择".into());
    }
    Ok(bytes)
}

pub(super) fn store(data: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let fingerprint = blake3::hash(bytes);
    let path = data
        .join("package-transfers")
        .join(format!("{}.neopiece", fingerprint.to_hex()));
    match std::fs::File::open(&path) {
        Ok(mut existing) => {
            if existing
                .metadata()
                .map_err(|error| error.to_string())?
                .len()
                != bytes.len() as u64
            {
                return Err("曲目包缓存位置已有不同内容，请先保留该文件后重试".into());
            }
            let mut hasher = blake3::Hasher::new();
            let mut block = [0u8; 65_536];
            let mut length = 0usize;
            loop {
                let count = existing
                    .read(&mut block)
                    .map_err(|error| error.to_string())?;
                if count == 0 {
                    break;
                }
                length = length.checked_add(count).ok_or("曲目包缓存大小无效")?;
                if length > bytes.len() {
                    return Err("曲目包缓存正在改变，请重新读取".into());
                }
                hasher.update(&block[..count]);
            }
            if length == bytes.len() && hasher.finalize() == fingerprint {
                return Ok(path);
            }
            return Err("曲目包缓存位置已有不同内容，请先保留该文件后重试".into());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    atomic_file::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}
impl Engine {
    pub fn stage_package(
        &self,
        bytes: Vec<u8>,
    ) -> Result<crate::package_preview::PackagePreview, String> {
        let pending = self.pending_operation()?;
        let engine = self.clone();
        let value = self.tasks.run("预览曲目包", None, move |token| {
            let _pending = pending;
            let summary = engine.package_preview_value(&bytes, &token)?;
            let fingerprint = blake3::hash(&bytes).to_hex().to_string();
            token.check()?;
            token.begin_commit()?;
            let data = engine.data.clone();
            let engine_id = engine.engine_id.to_string();
            // Transfer the validated source to storage; a 256 MB archive is never cloned for preview.
            engine.storage_tasks.run_owned("缓存曲目包预览", move |_| {
                store(&data, &bytes)?;
                let preview = crate::package_preview::PackagePreview::from_summary(
                    summary,
                    engine_id,
                    fingerprint,
                )?;
                serde_json::to_value(preview).map_err(|error| error.to_string())
            })
        })?;
        serde_json::from_value(value).map_err(|error| error.to_string())
    }
    fn package_preview_value(
        &self,
        bytes: &[u8],
        token: &background_tasks::TaskToken,
    ) -> Result<Value, String> {
        token.stage("decoding")?;
        let (cid,mut result)=crate::portable_song::inspect(bytes,&||token.check())?;
        token.source(cid.clone(), blake3::hash(bytes).to_hex().to_string())?;
        token.check()?;
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::PackagePresence {
                content_id: cid.clone(),
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let known = receiver.recv().map_err(|_| "曲目包预览状态通道已关闭")??;
        let workspace = library_workspace::Workspace::load(&self.data)?;
        token.check()?;
        result["existing"] = json!(
            known
                || workspace
                    .entries
                    .values()
                    .any(|row| row.content_id.as_ref() == Some(&cid))
        );
        Ok(result)
    }
    pub fn refresh_package_preview(
        &self,
        request: crate::package_preview::PackagePreviewRequest,
    ) -> Result<crate::package_preview::PackagePreview, String> {
        self.check_engine(&request.engine_id)?;
        check_token(&request.token)?;
        let engine = self.clone();
        let value = self.tasks.run("重新读取曲目包预览", None, move |token| {
            token.stage("reading")?;
            let bytes = read_staged(&engine.data, &request.token)?;
            token.check()?;
            let value = engine.package_preview_value(&bytes, &token)?;
            let preview = crate::package_preview::PackagePreview::from_summary(
                value,
                engine.engine_id.to_string(),
                request.token,
            )?;
            serde_json::to_value(preview).map_err(|error| error.to_string())
        })?;
        serde_json::from_value(value).map_err(|error| error.to_string())
    }
    pub(super) fn inspect_package_task(&self, bytes: Vec<u8>) -> Result<Value, String> {
        let engine = self.clone();
        self.tasks.run("预览曲目包", None, move |token| {
            engine.package_preview_value(&bytes, &token)
        })
    }
    pub(super) fn export_package_task(&self, as_file: bool) -> Result<Value, String> {
        let pending = self.pending_operation()?;
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::AssetReadContext {
                registry: true,
                export: true,
                editor: false,
                scope: None,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let context = receiver.recv().map_err(|_| "曲目包导出快照通道已关闭")??;
        let engine = self.clone();
        self.tasks.run("导出曲目包", None, move |token| {
            let _pending = pending;
            token.stage("encoding")?;
            token.check()?;
            let data = engine.data.clone();
            let selected = data.clone();
            // A missing generated annotation cache is virtual while exporting; no source data is published.
            let (prepared, _, observed) = atomic_file::capture_matching(
                Arc::new(move |path: &Path| asset_storage::captures(&selected, path)),
                || {
                    let mut reader = context.into_player(false)?;
                    let cid = reader
                        .file
                        .as_ref()
                        .ok_or("请先打开需要导出的曲目")?
                        .content_id
                        .clone();
                    let (bytes, summary) = reader.prepare_song_package_checked(&|| token.check())?;
                    let title=summary["title"].as_str().unwrap_or(&reader.title).to_owned();
                    token.source(cid, blake3::hash(&bytes).to_hex().to_string())?;
                    Ok::<_, String>((bytes, title, summary))
                },
            );
            let (bytes, title, summary) = prepared?;
            token.check()?;
            asset_storage::validate_observations(&observed)?;
            if as_file {
                token.begin_commit()?;
                engine
                    .storage_tasks
                    .run_owned("保存导出的曲目包", move |_| {
                        let path = store(&data, &bytes)?;
                        Ok(json!({"path":path,"title":title,"summary":summary}))
                    })
            } else {
                token.check()?;
                Ok(json!({"bytes":bytes,"title":title,"summary":summary}))
            }
        })
    }
}
