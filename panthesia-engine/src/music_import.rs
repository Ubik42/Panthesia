//! Bounded file transfer and compact, observable import results. No caller must replay a commit.
use crate::{Engine, import_pipeline, runtime_request, song_switch};
use panthesia_core::exercise::ExerciseSpec;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MusicKind {
    Midi,
    Score,
    Exercise,
    Package,
}
#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PackagePolicy {
    Merge,
    Keep,
    Replace,
}
impl PackagePolicy {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Keep => "keep",
            Self::Replace => "replace",
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageRequest {
    pub engine_id: String,
    pub request_id: String,
    pub created_at_ms: Option<u64>,
    pub token: String,
    pub policy: PackagePolicy,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExerciseRequest {
    pub engine_id: String,
    pub request_id: String,
    pub created_at_ms: Option<u64>,
    pub spec: ExerciseSpec,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Begin {
    pub engine_id: String,
    pub request_id: Option<String>,
    pub created_at_ms: Option<u64>,
    pub name: String,
    pub size: usize,
    pub kind: MusicKind,
    pub default_bpm: Option<u16>,
    #[serde(default)]
    pub catalog_only: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub id: String,
    pub kind: Option<MusicKind>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Chunk {
    pub id: String,
    pub offset: usize,
    pub bytes: Vec<u8>,
}
#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MusicPhase {
    Uploading,
    Queued,
    Running,
    Committing,
    Done,
    Cancelled,
    Error,
    Unconfirmed,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSong {
    pub content_id: String,
    pub title: String,
    pub source_path: String,
    #[serde(default)]
    pub import_warnings: Vec<String>,
    #[serde(default)]
    pub catalog_only: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicReceipt {
    pub id: String,
    pub engine_id: String,
    pub name: String,
    pub kind: MusicKind,
    pub phase: MusicPhase,
    pub received: usize,
    pub size: usize,
    pub task_id: Option<String>,
    pub song: Option<ImportedSong>,
    pub error: Option<String>,
    pub cancellable: bool,
    #[serde(default)]
    pub catalog_only: bool,
}
#[derive(Clone, PartialEq, Eq, Serialize)]
enum Preparation {
    Cancelled,
    File,
    Exercise(ExerciseSpec),
    Package {
        token: String,
        policy: PackagePolicy,
    },
}
struct Entry {
    meta: Begin,
    source: Preparation,
    origin: import_pipeline::Origin,
    bytes: Vec<u8>,
    receipt: MusicReceipt,
    touched: Instant,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}
#[derive(Clone)]
pub(crate) struct Store(Arc<Mutex<BTreeMap<String, Entry>>>, Arc<std::path::PathBuf>);
impl Store {
    pub(super) fn new(data: std::path::PathBuf) -> Self {
        Self(Arc::new(Mutex::new(BTreeMap::new())), Arc::new(data))
    }
    fn request_hash(meta: &Begin, source: &Preparation) -> Result<String, String> {
        let value = (
            &meta.name,
            meta.size,
            meta.kind,
            if meta.kind == MusicKind::Score {
                meta.default_bpm.unwrap_or(120)
            } else {
                0
            },
            source,
        );
        let bytes = if meta.catalog_only {
            serde_json::to_vec(&("catalog", value))
        } else {
            serde_json::to_vec(&value)
        }
        .map_err(|error| error.to_string())?;
        Ok(blake3::hash(&bytes).to_hex().to_string())
    }
    fn persist(&self, entry: &Entry) -> Result<(), String> {
        crate::music_import_receipts::persist(
            &self.1,
            Self::request_hash(&entry.meta, &entry.source)?,
            &entry.receipt,
        )
    }
    fn remember_cancelled(
        &self,
        entries: &mut BTreeMap<String, Entry>,
        id: String,
        meta: Begin,
        origin: import_pipeline::Origin,
        phase: MusicPhase,
        error: &str,
    ) -> Result<MusicReceipt, String> {
        Self::make_room(entries)?;
        let receipt = MusicReceipt {
            id: id.clone(),
            engine_id: meta.engine_id.clone(),
            name: meta.name.clone(),
            kind: meta.kind,
            phase,
            received: 0,
            size: meta.size,
            task_id: None,
            song: None,
            error: Some(error.into()),
            cancellable: false,
            catalog_only: meta.catalog_only,
        };
        entries.insert(
            id.clone(),
            Entry {
                meta,
                source: Preparation::Cancelled,
                origin,
                bytes: Vec::new(),
                receipt: receipt.clone(),
                touched: Instant::now(),
                cancelled: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            },
        );
        self.persist(entries.get(&id).ok_or("导入取消记录缺失")?)?;
        Ok(receipt)
    }
    fn make_room(entries: &mut BTreeMap<String, Entry>) -> Result<(), String> {
        while entries.len() >= 32 {
            let oldest = entries
                .iter()
                .filter(|(_, entry)| {
                    !matches!(
                        entry.receipt.phase,
                        MusicPhase::Uploading
                            | MusicPhase::Queued
                            | MusicPhase::Running
                            | MusicPhase::Committing
                    ) && !(entry.source == Preparation::Cancelled
                        && entry.touched.elapsed() < Duration::from_secs(300))
                })
                .min_by_key(|(_, entry)| entry.touched)
                .map(|(id, _)| id.clone());
            let Some(oldest) = oldest else {
                return Err("正在确认的准备请求较多，请稍后继续".into());
            };
            entries.remove(&oldest);
        }
        Ok(())
    }
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, BTreeMap<String, Entry>>, String> {
        self.0.lock().map_err(|_| "导入传输状态不可用".into())
    }
    fn reconcile(entry: &mut Entry, tasks: &[crate::background_tasks::Status]) {
        if entry.receipt.phase == MusicPhase::Uploading
            && entry.touched.elapsed() > Duration::from_secs(300)
        {
            entry
                .cancelled
                .store(true, std::sync::atomic::Ordering::Release);
            entry.bytes = Vec::new();
            entry.receipt.phase = MusicPhase::Cancelled;
            entry.receipt.error = Some("准备请求已过期，原有文件和参数保留，可以重新排队".into());
        }
        if matches!(
            entry.receipt.phase,
            MusicPhase::Queued | MusicPhase::Running | MusicPhase::Committing
        ) {
            if let Some(task_id) = &entry.receipt.task_id {
                match tasks.iter().find(|task| &task.id == task_id) {
                    Some(task) => {
                        entry.receipt.phase = match task.state {
                            "queued" => MusicPhase::Queued,
                            "running" => MusicPhase::Running,
                            "committing" => MusicPhase::Committing,
                            "cancelled" => MusicPhase::Cancelled,
                            "failed" => MusicPhase::Unconfirmed,
                            _ => MusicPhase::Unconfirmed,
                        };
                        if matches!(
                            entry.receipt.phase,
                            MusicPhase::Error | MusicPhase::Cancelled | MusicPhase::Unconfirmed
                        ) {
                            entry.receipt.error = task
                                .error
                                .clone()
                                .or_else(|| Some("导入结果待确认，请先核对曲库".into()));
                        }
                    }
                    None => {
                        entry.receipt.phase = MusicPhase::Unconfirmed;
                        entry.receipt.error =
                            Some("导入任务已结束，回执暂不可用，请先核对曲库".into());
                    }
                }
            }
        }
        entry.receipt.cancellable = matches!(
            entry.receipt.phase,
            MusicPhase::Uploading | MusicPhase::Queued | MusicPhase::Running
        );
    }
    fn finish(&self, id: &str, result: Result<ImportedSong, String>) {
        if let Ok(mut entries) = self.lock() {
            if let Some(entry) = entries.get_mut(id) {
                match result {
                    Ok(song) => {
                        entry.receipt.song = Some(song);
                        entry.receipt.phase = MusicPhase::Done;
                        entry.receipt.error = None;
                    }
                    Err(error) => {
                        entry.receipt.phase = if error.contains("后台任务已取消") {
                            MusicPhase::Cancelled
                        } else if error.contains("请先核对曲库") {
                            MusicPhase::Unconfirmed
                        } else {
                            MusicPhase::Error
                        };
                        entry.receipt.error = Some(error);
                    }
                }
                entry.bytes = Vec::new();
                entry.receipt.cancellable = false;
                entry.touched = Instant::now();
                if let Err(error) = self.persist(entry) {
                    let original = entry.receipt.error.take().unwrap_or_default();
                    entry.receipt.error = Some(if original.is_empty() {
                        format!("{error}。当前结果仍保留，请先在界面读取并保留结果。")
                    } else {
                        format!("{original}；{error}。原结果仍在当前会话中，请先读取并保留。")
                    });
                    if let Some(song) = &mut entry.receipt.song {
                        song.import_warnings
                            .push("导入结果回执尚未保存，请保留当前窗口并核对曲库。".into());
                    }
                }
            }
        }
    }
}
impl Engine {
    pub fn begin_music_import(&self, meta: Begin) -> Result<MusicReceipt, String> {
        if !matches!(meta.kind, MusicKind::Midi | MusicKind::Score) {
            return Err("请使用对应的技术练习或曲目包入口".into());
        }
        self.admit_music_preparation(meta, Preparation::File)
    }
    pub fn prepare_exercise(&self, request: ExerciseRequest) -> Result<MusicReceipt, String> {
        request.spec.validate().map_err(|error| error.to_string())?;
        let receipt = self.admit_music_preparation(
            Begin {
                engine_id: request.engine_id,
                request_id: Some(request.request_id),
                created_at_ms: request.created_at_ms,
                name: "技术练习".into(),
                size: 0,
                kind: MusicKind::Exercise,
                default_bpm: None,
                catalog_only: false,
            },
            Preparation::Exercise(request.spec),
        )?;
        self.finish_music_import(&receipt.id)
    }
    pub fn prepare_package(&self, request: PackageRequest) -> Result<MusicReceipt, String> {
        crate::package_loading::check_token(&request.token)?;
        let receipt = self.admit_music_preparation(
            Begin {
                engine_id: request.engine_id,
                request_id: Some(request.request_id),
                created_at_ms: request.created_at_ms,
                name: "曲目包".into(),
                size: 0,
                kind: MusicKind::Package,
                default_bpm: None,
                catalog_only: false,
            },
            Preparation::Package {
                token: request.token,
                policy: request.policy,
            },
        )?;
        self.finish_music_import(&receipt.id)
    }
    fn admit_music_preparation(
        &self,
        meta: Begin,
        source: Preparation,
    ) -> Result<MusicReceipt, String> {
        self.check_engine(&meta.engine_id)?;
        let state = self.snapshot();
        if self.closing.load(std::sync::atomic::Ordering::Acquire) || !state.startup.ready {
            return Err("练习室正在关闭或恢复，请稍后再导入".into());
        }
        let limit = match meta.kind {
            MusicKind::Midi => 32_000_000,
            MusicKind::Score => panthesia_core::source_score_window::ASSET_LIMIT,
            MusicKind::Exercise | MusicKind::Package => 0,
        };
        if meta.catalog_only && (state.storage.operation.is_some() || state.storage.error.is_some())
        {
            return Err("练习资料正在保存或恢复，请稍后导入曲库".into());
        }
        if meta.catalog_only && source != Preparation::File {
            return Err("此准备类型不能只导入曲库".into());
        }
        if (meta.size == 0 && source == Preparation::File) || meta.size > limit {
            return Err(format!("文件为空或超过 {} MB", limit / 1_000_000));
        }
        if meta.name.trim().is_empty() || meta.name.len() > 1024 || meta.name.contains('\0') {
            return Err("导入文件名无效".into());
        }
        if matches!(meta.kind, MusicKind::Score)
            && !(20..=400).contains(&meta.default_bpm.unwrap_or(120))
        {
            return Err("乐谱默认速度应为 20 到 400 BPM".into());
        }
        let mut entries = self.music_imports.lock()?;
        let tasks = self.tasks.list()?;
        for entry in entries.values_mut() {
            Store::reconcile(entry, &tasks);
        }
        // A transport retry must recover the original admission, including its final result.
        let requested_id = if let Some(request_id) = &meta.request_id {
            if !(8..=96).contains(&request_id.len())
                || !request_id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            {
                return Err("导入请求编号无效".into());
            }
            let id = format!("{}-{}", self.engine_id, request_id);
            if let Some(entry) = entries.get_mut(&id) {
                if entry.source == Preparation::Cancelled {
                    entry.receipt.kind = meta.kind;
                    entry.receipt.name = meta.name.clone();
                    entry.receipt.size = meta.size;
                    entry.receipt.catalog_only = meta.catalog_only;
                    entry.receipt.phase = MusicPhase::Cancelled;
                    entry.receipt.error = Some("后台任务已取消，请重新排队后再继续".into());
                    return Ok(entry.receipt.clone());
                }
                if entry.meta.name != meta.name
                    || entry.meta.size != meta.size
                    || entry.meta.kind != meta.kind
                    || entry.source != source
                    || entry.meta.catalog_only != meta.catalog_only
                    || (matches!(meta.kind, MusicKind::Score)
                        && entry.meta.default_bpm.unwrap_or(120) != meta.default_bpm.unwrap_or(120))
                {
                    return Err("原导入请求的文件或速度参数不一致".into());
                }
                return Ok(entry.receipt.clone());
            }
            if let Some((hash, mut receipt)) = crate::music_import_receipts::read(&self.data, &id)?
            {
                if receipt.name == "待确认请求" && receipt.phase == MusicPhase::Unconfirmed {
                    receipt.name = meta.name.clone();
                    receipt.size = meta.size;
                    receipt.catalog_only = meta.catalog_only;
                    receipt.phase = MusicPhase::Cancelled;
                    return Ok(receipt);
                }
                if hash != Store::request_hash(&meta, &source)? {
                    return Err("原导入请求的文件、速度或准备条件不一致".into());
                }
                return Ok(receipt);
            }
            Some(id)
        } else {
            None
        };
        // Versioned callers can cancel before admission. Late queued writes expire before those markers do.
        if meta
            .request_id
            .as_deref()
            .is_some_and(|id| id.starts_with("p2-"))
        {
            let created = meta
                .created_at_ms
                .ok_or("准备请求缺少时间，请更新界面后重试")?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            if now.abs_diff(u128::from(created)) > 30_000 {
                return self.music_imports.remember_cancelled(
                    &mut entries,
                    requested_id.clone().ok_or("准备请求编号缺失")?,
                    meta,
                    import_pipeline::Origin {
                        content_id: state.content_id,
                        revision: state.score_revision,
                    },
                    MusicPhase::Cancelled,
                    "后台任务已取消，准备请求已过期，请重新排队",
                );
            }
        }
        if entries.values().any(|entry| {
            matches!(
                entry.receipt.phase,
                MusicPhase::Uploading
                    | MusicPhase::Queued
                    | MusicPhase::Running
                    | MusicPhase::Committing
            )
        }) {
            return Err("还有曲目正在传输或准备，请等待完成或取消后继续".into());
        }
        Store::make_room(&mut entries)?;
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = requested_id.unwrap_or_else(|| {
            format!(
                "{}-{}",
                self.engine_id,
                SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            )
        });
        let receipt = MusicReceipt {
            id: id.clone(),
            engine_id: meta.engine_id.clone(),
            name: meta.name.clone(),
            kind: meta.kind,
            phase: MusicPhase::Uploading,
            received: 0,
            size: meta.size,
            task_id: None,
            song: None,
            error: None,
            cancellable: true,
            catalog_only: meta.catalog_only,
        };
        let bytes = Vec::with_capacity(meta.size);
        entries.insert(
            id.clone(),
            Entry {
                meta,
                source,
                origin: import_pipeline::Origin {
                    content_id: state.content_id,
                    revision: state.score_revision,
                },
                bytes,
                receipt: receipt.clone(),
                touched: Instant::now(),
                cancelled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            },
        );
        if let Err(error) = self
            .music_imports
            .persist(entries.get(&id).ok_or("导入请求缺失")?)
        {
            entries.remove(&id);
            return Err(error);
        }
        Ok(receipt)
    }
    pub fn write_music_chunk(&self, chunk: Chunk) -> Result<MusicReceipt, String> {
        let mut entries = self.music_imports.lock()?;
        let entry = entries
            .get_mut(&chunk.id)
            .ok_or("导入传输已失效，请重新添加文件")?;
        if entry.receipt.phase != MusicPhase::Uploading
            || entry.source != Preparation::File
            || entry.touched.elapsed() > Duration::from_secs(300)
        {
            return Err("导入传输已结束或过期，请重新读取结果".into());
        }
        if chunk.bytes.is_empty()
            || chunk.bytes.len() > 524_288
            || chunk.offset != entry.bytes.len()
            || chunk
                .offset
                .checked_add(chunk.bytes.len())
                .is_none_or(|end| end > entry.meta.size)
        {
            return Err("文件分块次序或容量无效".into());
        }
        entry.bytes.extend_from_slice(&chunk.bytes);
        entry.receipt.received = entry.bytes.len();
        entry.touched = Instant::now();
        Ok(entry.receipt.clone())
    }
    pub fn read_music_import(&self, id: &str) -> Result<MusicReceipt, String> {
        let mut entries = self.music_imports.lock()?;
        let tasks = self.tasks.list()?;
        let (hash, receipt) = if let Some(entry) = entries.get_mut(id) {
            let previous = entry.receipt.phase;
            Store::reconcile(entry, &tasks);
            if previous != entry.receipt.phase
                && !matches!(
                    entry.receipt.phase,
                    MusicPhase::Queued | MusicPhase::Running | MusicPhase::Committing
                )
            {
                if let Err(error) = self.music_imports.persist(entry) {
                    entry.receipt.error = Some(format!("{error}。原结果继续保留，请核对曲库。"));
                }
            }
            (
                Store::request_hash(&entry.meta, &entry.source)?,
                entry.receipt.clone(),
            )
        } else {
            crate::music_import_receipts::read(&self.data, id)?
                .ok_or("导入回执已过期，请先核对曲库中的保存结果")?
        };
        drop(entries);
        if self.pending_saves.status().pending
            || self.storage_busy.load(std::sync::atomic::Ordering::Acquire)
        {
            return Ok(receipt);
        }
        crate::catalog_import::recover_receipt(&self.data, &hash, receipt)
    }
    pub fn cancel_music_import(&self, id: &str) -> Result<MusicReceipt, String> {
        self.cancel_music_preparation(id, None)
    }
    pub fn cancel_music_preparation(
        &self,
        id: &str,
        kind: Option<MusicKind>,
    ) -> Result<MusicReceipt, String> {
        let task = {
            let mut entries = self.music_imports.lock()?;
            if !entries.contains_key(id) {
                if let Some((_, receipt)) = crate::music_import_receipts::read(&self.data, id)? {
                    return Ok(receipt);
                }
                let prefix = format!("{}-p2-", self.engine_id);
                let nonce = id
                    .strip_prefix(&prefix)
                    .ok_or("导入回执已过期，请先核对曲库中的保存结果")?;
                if !(8..=80).contains(&nonce.len())
                    || !nonce
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                {
                    return Err("准备请求编号无效".into());
                }
                let state = self.snapshot();
                return self.music_imports.remember_cancelled(
                    &mut entries,
                    id.to_owned(),
                    Begin {
                        engine_id: self.engine_id.to_string(),
                        request_id: None,
                        created_at_ms: None,
                        name: "待确认请求".into(),
                        size: 0,
                        kind: kind.unwrap_or(MusicKind::Midi),
                        default_bpm: None,
                        catalog_only: false,
                    },
                    import_pipeline::Origin {
                        content_id: state.content_id,
                        revision: state.score_revision,
                    },
                    MusicPhase::Unconfirmed,
                    "已要求取消尚未开始的请求；已有保存结果仍需继续核对",
                );
            }
            let entry = entries
                .get_mut(id)
                .ok_or("导入回执已过期，请先核对曲库中的保存结果")?;
            if matches!(
                entry.receipt.phase,
                MusicPhase::Done
                    | MusicPhase::Error
                    | MusicPhase::Cancelled
                    | MusicPhase::Unconfirmed
            ) {
                return Ok(entry.receipt.clone());
            }
            if entry.receipt.task_id.is_none() {
                entry
                    .cancelled
                    .store(true, std::sync::atomic::Ordering::Release);
                entry.receipt.phase = MusicPhase::Cancelled;
                entry.receipt.cancellable = false;
                entry.bytes = Vec::new();
                self.music_imports.persist(entry)?;
                return Ok(entry.receipt.clone());
            }
            entry.receipt.task_id.clone().unwrap()
        };
        self.tasks.cancel(&task)?;
        self.read_music_import(id)
    }
    pub fn finish_music_import(&self, id: &str) -> Result<MusicReceipt, String> {
        let pending = self.pending_operation()?;
        let recovered = {
            let entries = self.music_imports.lock()?;
            if let Some(entry) = entries.get(id) {
                if entry.meta.catalog_only && entry.receipt.phase == MusicPhase::Unconfirmed {
                    Some((
                        Store::request_hash(&entry.meta, &entry.source)?,
                        entry.receipt.clone(),
                    ))
                } else {
                    None
                }
            } else {
                crate::music_import_receipts::read(&self.data, id)?
            }
        };
        if let Some((hash, receipt)) = recovered {
            if receipt.catalog_only && receipt.phase == MusicPhase::Unconfirmed {
                if self.pending_saves.recovery().blocked()
                    || self.storage_busy.load(std::sync::atomic::Ordering::Acquire)
                {
                    return Err("其他资料正在保存或恢复，请完成后接续曲库登记".into());
                }
                if let Some(published) =
                    crate::catalog_import::committed(&self.data, &receipt, &hash)?
                {
                    let verified = crate::library::read_midi(std::path::Path::new(
                        &published.song.source_path,
                    ))?;
                    if verified.content_id != published.song.content_id {
                        return Err("已提交的演奏文件内容已变化，请先核对曲库".into());
                    }
                    if let Some(version) = &published.score {
                        let bytes = panthesia_core::utils::atomic_file::read_dependency(
                            &version.path,
                            panthesia_core::source_score_window::ASSET_LIMIT,
                        )
                        .map_err(|error| error.to_string())?;
                        if blake3::hash(&bytes).to_hex().as_str() != version.content_id {
                            return Err("已提交的谱面内容已变化，请先核对曲库".into());
                        }
                    }
                    self.finish_catalog_registration(&published)?;
                    let mut done = receipt;
                    done.phase = MusicPhase::Done;
                    done.song = Some(published.song);
                    done.error = None;
                    done.cancellable = false;
                    crate::music_import_receipts::persist(&self.data, hash, &done)?;
                    // The same-engine cache must stop returning its earlier unconfirmed receipt.
                    if let Ok(mut entries) = self.music_imports.lock() {
                        if let Some(entry) = entries.get_mut(id) {
                            entry.receipt = done.clone();
                        }
                    }
                    return Ok(done);
                }
            }
            return self.read_music_import(id);
        }
        let (origin, cancelled, catalog_only) = {
            let mut entries = self.music_imports.lock()?;
            let entry = entries
                .get_mut(id)
                .ok_or("导入传输已失效，请重新添加文件")?;
            if entry.receipt.phase != MusicPhase::Uploading {
                drop(entries);
                return self.read_music_import(id);
            }
            if entry.touched.elapsed() > Duration::from_secs(300) {
                entry
                    .cancelled
                    .store(true, std::sync::atomic::Ordering::Release);
                entry.bytes = Vec::new();
                entry.receipt.phase = MusicPhase::Cancelled;
                entry.receipt.cancellable = false;
                entry.receipt.error = Some("准备请求已过期，请重新排队；原有文件和参数保留".into());
                return Ok(entry.receipt.clone());
            }
            if entry.bytes.len() != entry.meta.size {
                return Err("文件尚未传输完整，请完成传输后继续".into());
            }
            entry.receipt.phase = MusicPhase::Queued;
            if let Err(error) = self.music_imports.persist(entry) {
                entry.receipt.phase = MusicPhase::Error;
                entry.receipt.error = Some(error);
                entry.receipt.cancellable = false;
                entry.bytes = Vec::new();
                return Ok(entry.receipt.clone());
            }
            (
                import_pipeline::Origin {
                    content_id: entry.origin.content_id.clone(),
                    revision: entry.origin.revision,
                },
                entry.cancelled.clone(),
                entry.meta.catalog_only,
            )
        };
        let (reply, receiver) = mpsc::sync_channel(1);
        let context = if catalog_only {
            Ok(origin)
        } else {
            self.tx
                .send(runtime_request::Request::ScopedImportContext {
                    origin,
                    cancelled,
                    received: Instant::now(),
                    reply,
                })
                .map_err(|_| "音乐引擎已关闭".to_string())
                .and_then(|_| {
                    receiver
                        .recv_timeout(Duration::from_secs(15))
                        .map_err(|_| "读取导入条件超时".to_string())?
                })
        };
        let origin = match context {
            Ok(origin) => origin,
            Err(error) => {
                self.music_imports.finish(id, Err(error));
                return self.read_music_import(id);
            }
        };
        let mut entries = self.music_imports.lock()?;
        let entry = entries.get_mut(id).ok_or("导入回执已过期")?;
        if entry.receipt.phase == MusicPhase::Cancelled {
            return Ok(entry.receipt.clone());
        }
        let bytes = std::mem::take(&mut entry.bytes);
        let input = match &entry.source {
            Preparation::Cancelled => return Ok(entry.receipt.clone()),
            Preparation::Exercise(spec) => song_switch::Input::Exercise(*spec),
            Preparation::Package { token, policy } => song_switch::Input::StagedPackage {
                token: token.clone(),
                policy: policy.as_str().to_owned(),
            },
            Preparation::File if entry.meta.kind == MusicKind::Midi => {
                song_switch::Input::CompactImport(import_pipeline::Input::Midi {
                    bytes,
                    name: entry.meta.name.clone(),
                })
            }
            Preparation::File => song_switch::Input::CompactImport(import_pipeline::Input::Score {
                bytes,
                name: entry.meta.name.clone(),
                bpm: entry.meta.default_bpm.unwrap_or(120),
            }),
        };
        let label = match entry.source {
            Preparation::Cancelled => return Ok(entry.receipt.clone()),
            Preparation::Exercise(_) => "生成技术练习与恢复资料",
            Preparation::Package { .. } => "导入曲目包",
            Preparation::File => "准备导入曲目",
        };
        let engine = self.clone();
        let store = self.music_imports.clone();
        let request_id = id.to_owned();
        let import_receipt = entry.receipt.clone();
        let request_hash = Store::request_hash(&entry.meta, &entry.source)?;
        match self.tasks.start(label, move |token| {
            let _pending = pending;
            let completion = token.clone();
            let result = if catalog_only {
                match input {
                    song_switch::Input::CompactImport(input) => {
                        engine.import_to_catalog(input, &token, import_receipt, request_hash)
                    }
                    _ => Err("曲库导入准备类型无效".into()),
                }
            } else {
                engine
                    .commit_song_switch(origin, input, token)
                    .and_then(|value| {
                        let cleanup = value["packageResult"]["cleanupWarning"]
                            .as_str()
                            .map(str::to_owned);
                        let mut song =
                            serde_json::from_value::<ImportedSong>(value).map_err(|_| {
                                "曲目已处理，但结果回执不完整，请先核对曲库".to_string()
                            })?;
                        if let Some(warning) = cleanup {
                            song.import_warnings.push(warning);
                        }
                        Ok(song)
                    })
            };
            let result = result.map_err(|error| {
                if completion.is_committing() {
                    format!("{error}。保存已开始，请先核对曲库中的结果与恢复提示")
                } else {
                    error
                }
            });
            store.finish(&request_id, result.clone());
            result.map(|song| serde_json::json!({ "contentId": song.content_id }))
        }) {
            Ok(task_id) => entry.receipt.task_id = Some(task_id),
            Err(error) => {
                entry.receipt.phase = MusicPhase::Error;
                entry.receipt.error = Some(error);
                entry.receipt.cancellable = false;
                if let Err(error) = self.music_imports.persist(entry) {
                    entry.receipt.error = Some(format!(
                        "{}；{error}。原文件仍保留。",
                        entry.receipt.error.as_deref().unwrap_or("后台准备未开始")
                    ));
                }
            }
        }
        Ok(entry.receipt.clone())
    }
}
