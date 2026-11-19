//! Durable admission and result ownership shared by independent preparation domains.
use crate::{Engine, background_tasks::TaskToken};
use panthesia_core::utils::atomic_file;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PreparationPhase {
    Queued,
    Running,
    Committing,
    Done,
    Released,
    Cancelled,
    Error,
    Unconfirmed,
}
use PreparationPhase as Phase;

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparationOrigin {
    pub content_id: Option<String>,
    pub score_revision: u64,
    pub midi_events: u64,
    pub status: String,
}
impl PreparationOrigin {
    pub(crate) fn check(&self, player: &crate::Player) -> Result<(), String> {
        if player.file.as_ref().map(|file| file.content_id.as_str()) != self.content_id.as_deref()
            || player.score_revision != self.score_revision
            || player.state.midi_events != self.midi_events
            || player.state.status != self.status
        {
            return Err(
                "当前练习、谱面或琴键状态已变化，这次准备已停止。请读取当前练习后重新准备。".into(),
            );
        }
        Ok(())
    }
}

pub(crate) trait Operation:
    Clone + PartialEq + Serialize + DeserializeOwned + Send + Sync + 'static
{
    type Output: Clone + Serialize + DeserializeOwned + Send + Sync + 'static;
    const FOLDER: &'static str;
    fn id(&self) -> &str;
    fn engine_id(&self) -> &str;
    fn created_at_ms(&self) -> u64;
    fn validate(&self) -> Result<(), String>;
    fn label(&self) -> &'static str;
    fn run(self, engine: &Engine, token: TaskToken) -> Result<Self::Output, String>;
}
macro_rules! receipt_wire {
    ($request:ty, $receipt:ty) => {
        impl From<crate::operation_journal::Receipt<$request>> for $receipt {
            fn from(value: crate::operation_journal::Receipt<$request>) -> Self {
                Self {
                    request: value.request,
                    phase: value.phase,
                    stage: value.stage,
                    task_id: value.task_id,
                    result: value.result,
                    has_result: value.has_result,
                    error: value.error,
                    warning: value.warning,
                    cancellable: value.cancellable,
                }
            }
        }
    };
}
pub(crate) use receipt_wire;
#[derive(Clone, Deserialize, Serialize)]
#[serde(
    rename_all = "camelCase",
    bound(
        serialize = "R: Serialize, R::Output: Serialize",
        deserialize = "R: DeserializeOwned, R::Output: DeserializeOwned"
    )
)]
pub(crate) struct Receipt<R: Operation> {
    pub request: R,
    pub phase: Phase,
    pub stage: String,
    pub task_id: Option<String>,
    pub result: Option<R::Output>,
    #[serde(default)]
    pub has_result: bool,
    pub error: Option<String>,
    pub warning: Option<String>,
    pub cancellable: bool,
}
impl<R: Operation> Receipt<R> {
    fn view(&self, metadata_only: bool) -> Self {
        Self {
            request: self.request.clone(),
            phase: self.phase,
            stage: self.stage.clone(),
            task_id: self.task_id.clone(),
            result: if metadata_only {
                None
            } else {
                self.result.clone()
            },
            has_result: self.has_result || self.result.is_some(),
            error: self.error.clone(),
            warning: self.warning.clone(),
            cancellable: self.cancellable,
        }
    }
}
struct Entry<R: Operation> {
    receipt: Receipt<R>,
    touched: Instant,
}
pub(crate) struct Store<R: Operation>(
    Arc<Mutex<BTreeMap<String, Entry<R>>>>,
    Arc<Mutex<BTreeMap<String, Instant>>>,
);
impl<R: Operation> Clone for Store<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone(), self.1.clone())
    }
}
impl<R: Operation> Default for Store<R> {
    fn default() -> Self {
        Self(
            Arc::new(Mutex::new(BTreeMap::new())),
            Arc::new(Mutex::new(BTreeMap::new())),
        )
    }
}
const LIMIT: usize = 24_000_000;
fn key(id: &str) -> Result<(), String> {
    if !(8..=96).contains(&id.len())
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("操作请求编号无效".into());
    }
    Ok(())
}
fn path<R: Operation>(data: &Path, id: &str, payload: bool) -> Result<PathBuf, String> {
    key(id)?;
    Ok(data.join(R::FOLDER).join(if payload {
        format!("{id}.result.json")
    } else {
        format!("{id}.json")
    }))
}
fn terminal(phase: Phase) -> bool {
    !matches!(phase, Phase::Queued | Phase::Running | Phase::Committing)
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "R: DeserializeOwned, R::Output: DeserializeOwned"))]
struct StoredResult<R: Operation> {
    version: u8,
    id: String,
    request_hash: String,
    result: R::Output,
}
#[derive(Serialize)]
#[serde(bound(serialize = "R::Output: Serialize"))]
struct ResultWrite<'a, R: Operation> {
    version: u8,
    id: &'a str,
    request_hash: String,
    result: &'a R::Output,
}
#[derive(Deserialize, Serialize)]
#[serde(bound(
    serialize = "R: Serialize, R::Output: Serialize",
    deserialize = "R: DeserializeOwned, R::Output: DeserializeOwned"
))]
struct StoredHeader<R: Operation> {
    version: u8,
    payload_hash: Option<String>,
    receipt: Receipt<R>,
}
fn request_hash<R: Operation>(request: &R) -> Result<String, String> {
    Ok(
        blake3::hash(&serde_json::to_vec(request).map_err(|error| error.to_string())?)
            .to_hex()
            .to_string(),
    )
}
fn persist<R: Operation>(data: &Path, receipt: &Receipt<R>) -> Result<(), String> {
    let payload_hash = if let Some(result) = &receipt.result {
        let payload = ResultWrite::<R> {
            version: 1,
            id: receipt.request.id(),
            request_hash: request_hash(&receipt.request)?,
            result,
        };
        let bytes = crate::json_stream::encode(&payload, Vec::new(), LIMIT, || Ok(()))?;
        atomic_file::write(&path::<R>(data, receipt.request.id(), true)?, &bytes)
            .map_err(|error| error.to_string())?;
        Some(blake3::hash(&bytes).to_hex().to_string())
    } else {
        None
    };
    let mut header = receipt.view(true);
    header.warning = None;
    let bytes = crate::json_stream::encode(
        &StoredHeader {
            version: 1,
            payload_hash,
            receipt: header,
        },
        Vec::new(),
        65_536,
        || Ok(()),
    )?;
    atomic_file::write(&path::<R>(data, receipt.request.id(), false)?, &bytes)
        .map_err(|error| error.to_string())
}
fn read_disk<R: Operation>(
    data: &Path,
    id: &str,
    metadata_only: bool,
) -> Result<Option<Receipt<R>>, String> {
    let bytes = match atomic_file::read_limited(&path::<R>(data, id, false)?, 65_536) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("操作回执暂时无法读取：{error}")),
    };
    let header: StoredHeader<R> = serde_json::from_slice(&bytes)
        .map_err(|_| "操作回执无法解析，原文继续保留，请核对当前练习")?;
    if header.version != 1 || header.receipt.request.id() != id {
        return Err("操作回执版本或身份不一致，原文继续保留".into());
    }
    let mut receipt = header.receipt;
    receipt.request.validate()?;
    if !terminal(receipt.phase)
        || receipt.phase == Phase::Done
            && (!receipt.has_result
                || header.payload_hash.as_deref().is_none_or(|hash| {
                    hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
                }))
    {
        receipt.phase = Phase::Unconfirmed;
        receipt.error = Some("上次操作的最终结果尚未确认，请先核对当前练习和原资料。".into());
    }
    if !metadata_only && receipt.has_result {
        let loaded: Result<R::Output, String> = (|| {
            let bytes = atomic_file::read_limited(&path::<R>(data, id, true)?, LIMIT)
                .map_err(|error| error.to_string())?;
            if Some(blake3::hash(&bytes).to_hex().as_str()) != header.payload_hash.as_deref() {
                return Err("操作结果内容已变化".into());
            }
            let payload: StoredResult<R> =
                serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
            if payload.version != 1
                || payload.id != id
                || payload.request_hash != request_hash(&receipt.request)?
            {
                return Err("操作结果与原请求不一致".into());
            }
            Ok(payload.result)
        })();
        match loaded {
            Ok(value) => receipt.result = Some(value),
            Err(error) => {
                receipt.phase = Phase::Unconfirmed;
                receipt.has_result = false;
                receipt.error = Some(format!("原结果暂时无法读取，请先核对当前练习：{error}"));
            }
        }
    }
    receipt.cancellable = false;
    Ok(Some(receipt))
}
fn observe<R: Operation>(entry: &mut Entry<R>, tasks: &[crate::background_tasks::Status]) -> bool {
    if terminal(entry.receipt.phase) {
        return false;
    }
    let previous = entry.receipt.phase;
    if let Some(task) = entry
        .receipt
        .task_id
        .as_ref()
        .and_then(|id| tasks.iter().find(|task| &task.id == id))
    {
        entry.receipt.phase = match task.state {
            "queued" => Phase::Queued,
            "running" => Phase::Running,
            "committing" => Phase::Committing,
            "cancelled" => Phase::Cancelled,
            _ => Phase::Unconfirmed,
        };
        entry.receipt.cancellable = matches!(task.state, "queued" | "running");
        entry.receipt.stage = task.stage.into();
    } else {
        entry.receipt.phase = Phase::Unconfirmed;
        entry.receipt.cancellable = false;
    }
    if entry.receipt.phase == Phase::Unconfirmed {
        entry.receipt.error = Some("原任务已结束，最终结果待核对，请先返回当前练习。".into());
    }
    if entry.receipt.phase == Phase::Cancelled {
        entry.receipt.error = None;
    }
    previous != entry.receipt.phase && terminal(entry.receipt.phase)
}
impl<R: Operation> Store<R> {
    fn finish(
        &self,
        data: &Path,
        id: &str,
        result: Result<R::Output, String>,
        committed: bool,
        cancelled: bool,
    ) {
        let Ok(mut all) = self.0.lock() else { return };
        let Some(entry) = all.get_mut(id) else { return };
        if entry.receipt.phase == Phase::Cancelled {
            return;
        }
        entry.receipt.cancellable = false;
        entry.receipt.stage = "finished".into();
        if cancelled {
            entry.receipt.phase = Phase::Cancelled;
            entry.receipt.error = None;
            entry.receipt.result = None;
        } else {
            match result {
                Ok(value) => {
                    entry.receipt.phase = Phase::Done;
                    entry.receipt.result = Some(value);
                    entry.receipt.error = None;
                }
                Err(error) => {
                    entry.receipt.phase = if committed {
                        Phase::Unconfirmed
                    } else {
                        Phase::Error
                    };
                    entry.receipt.error = Some(error);
                }
            }
        }
        entry.receipt.has_result = entry.receipt.result.is_some();
        if let Err(error) = persist(data, &entry.receipt) {
            entry.receipt.warning =
                Some(format!("结果仍保留在当前连接中，磁盘回执尚未更新：{error}"));
        }
        entry.touched = Instant::now();
    }
    pub(crate) fn start(&self, engine: &Engine, request: R) -> Result<Receipt<R>, String> {
        let pending = engine.pending_operation()?;
        engine.check_engine(request.engine_id())?;
        key(request.id())?;
        request.validate()?;
        let mut all = self.0.lock().map_err(|_| "操作状态不可用")?;
        let previous = all
            .get(request.id())
            .map(|entry| Ok(Some(entry.receipt.view(true))))
            .unwrap_or_else(|| read_disk::<R>(&engine.data, request.id(), true))?;
        if let Some(previous) = previous {
            if previous.request != request {
                return Err("这个操作编号已有不同请求，请先读取原结果".into());
            }
            return Ok(previous);
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        if now.abs_diff(request.created_at_ms()) > 30_000 {
            return Err("操作请求已过期，请重新读取原资料后准备".into());
        }
        let tasks = engine.tasks.list()?;
        for entry in all.values_mut() {
            if observe(entry, &tasks) {
                if let Err(error) = persist(&engine.data, &entry.receipt) {
                    entry.receipt.warning = Some(error);
                }
            }
        }
        if all.values().any(|entry| !terminal(entry.receipt.phase)) {
            return Err("已有同类打开操作正在准备，请先读取原结果".into());
        }
        while all.len() >= 8 {
            let oldest = all
                .iter()
                .filter(|(_, entry)| terminal(entry.receipt.phase))
                .min_by_key(|(_, entry)| entry.touched)
                .map(|(id, _)| id.clone())
                .ok_or("原操作尚未结束，请稍后继续")?;
            all.remove(&oldest);
        }
        let cancelled = self
            .1
            .lock()
            .map_err(|_| "取消状态不可用")?
            .contains_key(request.id());
        let mut receipt = Receipt {
            request: request.clone(),
            phase: if cancelled {
                Phase::Cancelled
            } else {
                Phase::Queued
            },
            stage: "queued".into(),
            task_id: None,
            result: None,
            has_result: false,
            error: None,
            warning: None,
            cancellable: !cancelled,
        };
        persist(&engine.data, &receipt)?;
        all.insert(
            request.id().into(),
            Entry {
                receipt: receipt.clone(),
                touched: Instant::now(),
            },
        );
        if cancelled {
            return Ok(receipt);
        }
        let worker = engine.clone();
        let store = self.clone();
        let id = request.id().to_owned();
        match engine.tasks.start(request.label(), move |token| {
            let _pending = pending;
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                request.run(&worker, token.clone())
            }))
            .unwrap_or_else(|_| Err("曲目准备异常结束，请读取当前练习后按原选择重新打开。".into()));
            let reply = result
                .as_ref()
                .map(|_| serde_json::json!({"id":id}))
                .map_err(Clone::clone);
            store.finish(
                &worker.data,
                &id,
                result,
                token.is_committing(),
                token.check().is_err(),
            );
            reply
        }) {
            Ok(task) => receipt.task_id = Some(task),
            Err(error) => {
                receipt.phase = Phase::Error;
                receipt.error = Some(error);
                receipt.cancellable = false;
                if let Err(error) = persist(&engine.data, &receipt) {
                    receipt.warning = Some(error);
                }
            }
        }
        all.get_mut(receipt.request.id())
            .ok_or("操作状态已丢失")?
            .receipt = receipt.clone();
        Ok(receipt)
    }
    pub(crate) fn read(
        &self,
        engine: &Engine,
        id: &str,
        metadata_only: bool,
    ) -> Result<Option<Receipt<R>>, String> {
        key(id)?;
        let tasks = engine.tasks.list()?;
        let mut all = self.0.lock().map_err(|_| "操作状态不可用")?;
        let Some(entry) = all.get_mut(id) else {
            return read_disk::<R>(&engine.data, id, metadata_only);
        };
        if observe(entry, &tasks) || entry.receipt.warning.is_some() {
            match engine
                .pending_operation()
                .and_then(|_guard| persist(&engine.data, &entry.receipt))
            {
                Ok(()) => entry.receipt.warning = None,
                Err(error) => {
                    entry.receipt.warning =
                        Some(format!("结果仍保留在当前连接中，磁盘回执尚未更新：{error}"))
                }
            }
        }
        entry.touched = Instant::now();
        Ok(Some(entry.receipt.view(metadata_only)))
    }
    pub(crate) fn cancel(&self, engine: &Engine, id: &str) -> Result<Option<Receipt<R>>, String> {
        key(id)?;
        let task = {
            let all = self.0.lock().map_err(|_| "操作状态不可用")?;
            if let Some(entry) = all.get(id) {
                entry.receipt.task_id.clone()
            } else {
                let mut cancelled = self.1.lock().map_err(|_| "取消状态不可用")?;
                cancelled.retain(|_, at| at.elapsed().as_secs() < 300);
                if cancelled.len() >= 64 {
                    return Err("正在核对的取消请求较多，请稍后继续".into());
                }
                cancelled.insert(id.into(), Instant::now());
                None
            }
        };
        if let Some(task) = task {
            let _ = engine.tasks.cancel(&task);
        }
        self.read(engine, id, true)
    }
    pub(crate) fn release(&self, engine: &Engine, id: &str) -> Result<Option<Receipt<R>>, String> {
        let _pending = engine.pending_operation()?;
        key(id)?;
        let mut all = self.0.lock().map_err(|_| "操作状态不可用")?;
        let current = match all.get(id) {
            Some(entry) => Some(entry.receipt.view(true)),
            None => read_disk::<R>(&engine.data, id, true)?,
        };
        let Some(mut receipt) = current else {
            return Ok(None);
        };
        if receipt.phase == Phase::Released {
            return Ok(Some(receipt));
        }
        if receipt.phase != Phase::Done {
            return Err("原操作尚未确认完成，已保留请求及结果资料".into());
        }
        receipt.phase = Phase::Released;
        receipt.has_result = false;
        receipt.result = None;
        receipt.warning = None;
        receipt.error = None;
        receipt.cancellable = false;
        persist(&engine.data, &receipt)?;
        if let Err(error) = std::fs::remove_file(path::<R>(&engine.data, id, true)?) {
            if error.kind() != std::io::ErrorKind::NotFound {
                receipt.warning = Some(format!("操作已结束，结果缓存暂未释放：{error}"));
            }
        }
        if let Some(entry) = all.get_mut(id) {
            entry.receipt = receipt.clone();
            entry.touched = Instant::now();
        }
        Ok(Some(receipt))
    }
}
