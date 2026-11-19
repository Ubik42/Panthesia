//! Import admission and compact receipts survive a disconnected caller.
use crate::{Engine, practice_backup::Selection, practice_backup_import::Input};
use panthesia_core::utils::atomic_file;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupImportRequest {
    pub engine_id: String,
    pub id: String,
    pub created_at_ms: u64,
    pub token: String,
    pub selection: BackupSelection,
    pub policy: BackupPolicy,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupImportQuery {
    pub engine_id: String,
    pub id: String,
}
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupSelection {
    pub plans: bool,
    pub records: bool,
    pub presets: bool,
    pub days: u32,
}
impl From<BackupSelection> for Selection {
    fn from(value: BackupSelection) -> Self {
        Self {
            plans: value.plans,
            records: value.records,
            presets: value.presets,
            days: value.days,
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BackupPolicy {
    Keep,
    Backup,
}
#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BackupImportPhase {
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
pub struct BackupImportResult {
    pub metadata_history_added: usize,
    pub metadata_history_duplicates: usize,
    pub metadata_history_unmatched: usize,
    pub metadata_history_ambiguous: usize,
    pub metadata_history_pending_added: usize,
    pub added_time_entries: usize,
    pub imported_performances: usize,
    pub duplicate_performances: usize,
    pub kept_performances: usize,
    pub replaced_performances: usize,
    pub trimmed_performances: usize,
    pub learning_changed: usize,
    pub added_records: usize,
    pub duplicate_records: usize,
    pub renamed_records: usize,
    pub trimmed_records: usize,
    pub restore_point: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupImportReceipt {
    pub request: BackupImportRequest,
    pub phase: BackupImportPhase,
    #[serde(default)]
    pub stage: String,
    pub task_id: Option<String>,
    pub result: Option<BackupImportResult>,
    pub error: Option<String>,
    pub warning: Option<String>,
    pub cancellable: bool,
}
struct Entry {
    receipt: BackupImportReceipt,
    touched: Instant,
}
#[derive(Clone, Default)]
pub(crate) struct Store(
    Arc<Mutex<BTreeMap<String, Entry>>>,
    Arc<Mutex<BTreeMap<String, Instant>>>,
);
fn key(id: &str) -> Result<(), String> {
    if !(8..=96).contains(&id.len())
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("备份导入请求编号无效".into());
    }
    Ok(())
}
fn path(data: &Path, id: &str) -> Result<PathBuf, String> {
    key(id)?;
    Ok(data
        .join("backup-import-results")
        .join(format!("{id}.json")))
}
fn persist(data: &Path, receipt: &BackupImportReceipt) -> Result<(), String> {
    let bytes = serde_json::to_vec(receipt).map_err(|error| error.to_string())?;
    if bytes.len() > 65_536 {
        return Err("备份导入回执过大".into());
    }
    atomic_file::write(&path(data, &receipt.request.id)?, &bytes).map_err(|error| error.to_string())
}
fn read_disk(data: &Path, id: &str) -> Result<Option<BackupImportReceipt>, String> {
    let bytes = match atomic_file::read_limited(&path(data, id)?, 65_536) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("备份导入回执无法读取：{error}")),
    };
    let mut receipt: BackupImportReceipt =
        serde_json::from_slice(&bytes).map_err(|_| "备份导入回执损坏，请先核对本机资料")?;
    if receipt.request.id != id {
        return Err("备份导入回执身份不一致".into());
    }
    if receipt.phase == BackupImportPhase::Done && receipt.result.is_none() {
        receipt.phase = BackupImportPhase::Unconfirmed;
        receipt.error = Some("原导入回执缺少结果摘要，请先核对本机资料和导入前副本。".into());
    }
    if matches!(
        receipt.phase,
        BackupImportPhase::Queued | BackupImportPhase::Running | BackupImportPhase::Committing
    ) {
        receipt.phase = BackupImportPhase::Unconfirmed;
        receipt.error = Some(
            "上次导入的最终结果尚未确认。请先核对本机资料和导入前副本，再决定是否重新准备。".into(),
        );
    }
    receipt.cancellable = false;
    Ok(Some(receipt))
}
fn terminal(phase: BackupImportPhase) -> bool {
    !matches!(
        phase,
        BackupImportPhase::Queued | BackupImportPhase::Running | BackupImportPhase::Committing
    )
}
impl Store {
    fn finish(
        &self,
        data: &Path,
        id: &str,
        result: Result<BackupImportResult, String>,
        committed: bool,
    ) {
        let Ok(mut all) = self.0.lock() else { return };
        let Some(entry) = all.get_mut(id) else { return };
        if entry.receipt.phase == BackupImportPhase::Cancelled {
            return;
        }
        entry.receipt.cancellable = false;
        entry.receipt.stage = "finished".into();
        match result {
            Ok(value) => {
                entry.receipt.phase = BackupImportPhase::Done;
                entry.receipt.result = Some(value);
                entry.receipt.error = None;
            }
            Err(error) => {
                entry.receipt.phase = if committed {
                    BackupImportPhase::Unconfirmed
                } else {
                    BackupImportPhase::Error
                };
                entry.receipt.error = Some(error);
            }
        }
        if let Err(error) = persist(data, &entry.receipt) {
            entry.receipt.warning = Some(format!(
                "本次结果保留在当前连接中，磁盘回执尚未更新：{error}"
            ));
        }
        entry.touched = Instant::now();
    }
}
impl Engine {
    pub fn prepare_backup_import(
        &self,
        request: BackupImportRequest,
    ) -> Result<BackupImportReceipt, String> {
        // Cover admission receipts too, including a cancelled request or a full task queue.
        let _admission = self.pending_operation()?;
        self.check_engine(&request.engine_id)?;
        key(&request.id)?;
        if request.token.len() != 64 || !request.token.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("备份预览已失效，请重新选择文件".into());
        }
        if request.selection.days != 0
            || !(request.selection.plans || request.selection.records || request.selection.presets)
        {
            return Err("请选择要恢复的练习资料；导入范围采用备份内的完整日期记录".into());
        }
        let mut all = self
            .backup_imports
            .0
            .lock()
            .map_err(|_| "备份导入状态不可用")?;
        let previous = match all.get(&request.id) {
            Some(entry) => Some(entry.receipt.clone()),
            None => read_disk(&self.data, &request.id)?,
        };
        if let Some(previous) = previous {
            if previous.request.token != request.token
                || previous.request.selection != request.selection
                || previous.request.policy != request.policy
            {
                return Err("原备份请求的范围或策略不同，请先读取原结果".into());
            }
            return Ok(previous);
        }
        if self
            .backup_imports
            .1
            .lock()
            .map_err(|_| "备份取消状态不可用")?
            .contains_key(&request.id)
        {
            let receipt = BackupImportReceipt {
                request,
                phase: BackupImportPhase::Cancelled,
                stage: "cancelled".into(),
                task_id: None,
                result: None,
                error: None,
                warning: None,
                cancellable: false,
            };
            persist(&self.data, &receipt)?;
            return Ok(receipt);
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        if now.abs_diff(request.created_at_ms) > 30_000 {
            return Err("备份导入请求已过期，请重新准备".into());
        }
        if all.values().any(|entry| !terminal(entry.receipt.phase)) {
            return Err("已有备份正在导入，请先读取原请求".into());
        }
        while all.len() >= 32 {
            let id = all
                .iter()
                .filter(|(_, entry)| terminal(entry.receipt.phase))
                .min_by_key(|(_, entry)| entry.touched)
                .map(|(id, _)| id.clone())
                .ok_or("备份导入记录较多，请稍后继续")?;
            all.remove(&id);
        }
        let pending = self.pending_operation()?;
        let mut receipt = BackupImportReceipt {
            request: request.clone(),
            phase: BackupImportPhase::Queued,
            stage: "queued".into(),
            task_id: None,
            result: None,
            error: None,
            warning: None,
            cancellable: true,
        };
        // An uncertain on-disk marker blocks accidental replay after a process crash.
        persist(&self.data, &receipt)?;
        all.insert(
            request.id.clone(),
            Entry {
                receipt: receipt.clone(),
                touched: Instant::now(),
            },
        );
        let engine = self.clone();
        let store = self.backup_imports.clone();
        let id = request.id.clone();
        match self.tasks.start("导入练习资料", move |token| {
            let _pending = pending;
            let completion = token.clone();
            let result = engine
                .import_backup_with_token(
                    Input::Staged(request.token),
                    request.selection.into(),
                    match request.policy {
                        BackupPolicy::Keep => "keep",
                        BackupPolicy::Backup => "backup",
                    }
                    .into(),
                    token,
                )
                .and_then(|value| {
                    serde_json::from_value::<BackupImportResult>(value)
                        .map_err(|_| "资料已处理，但导入回执不完整。请先核对本机资料。".into())
                });
            store.finish(
                &engine.data,
                &id,
                result.clone(),
                completion.is_committing(),
            );
            result.map(|_| serde_json::json!({"id":id}))
        }) {
            Ok(task) => receipt.task_id = Some(task),
            Err(error) => {
                receipt.phase = BackupImportPhase::Error;
                receipt.error = Some(error);
                receipt.cancellable = false;
                let _ = persist(&self.data, &receipt);
            }
        }
        all.get_mut(&receipt.request.id).unwrap().receipt = receipt.clone();
        Ok(receipt)
    }
    pub fn read_backup_import(
        &self,
        engine_id: &str,
        id: &str,
    ) -> Result<Option<BackupImportReceipt>, String> {
        self.check_engine(engine_id)?;
        key(id)?;
        let tasks = self.tasks.list()?;
        let mut all = self
            .backup_imports
            .0
            .lock()
            .map_err(|_| "备份导入状态不可用")?;
        let Some(entry) = all.get_mut(id) else {
            return read_disk(&self.data, id);
        };
        let previous_phase = entry.receipt.phase;
        if !terminal(entry.receipt.phase) {
            if let Some(task) = entry
                .receipt
                .task_id
                .as_ref()
                .and_then(|id| tasks.iter().find(|task| &task.id == id))
            {
                entry.receipt.phase = match task.state {
                    "queued" => BackupImportPhase::Queued,
                    "running" => BackupImportPhase::Running,
                    "committing" => BackupImportPhase::Committing,
                    "cancelled" => BackupImportPhase::Cancelled,
                    _ => BackupImportPhase::Unconfirmed,
                };
                entry.receipt.cancellable = matches!(task.state, "queued" | "running");
                entry.receipt.stage = task.stage.into();
                if entry.receipt.phase == BackupImportPhase::Cancelled {
                    entry.receipt.error = None;
                } else if entry.receipt.phase == BackupImportPhase::Unconfirmed {
                    entry.receipt.error =
                        Some("原任务已结束，回执尚未确认，请先核对本机资料。".into());
                }
            } else if entry.receipt.task_id.is_some() {
                entry.receipt.phase = BackupImportPhase::Unconfirmed;
                entry.receipt.cancellable = false;
                entry.receipt.error =
                    Some("原任务记录已过期，导入结果待核对。请先检查本机资料和导入前副本。".into());
            }
        }
        if (previous_phase != entry.receipt.phase && terminal(entry.receipt.phase))
            || entry.receipt.warning.is_some()
        {
            let mut durable = entry.receipt.clone();
            durable.warning = None;
            let saved = self.pending_operation().and_then(|_operation| persist(&self.data, &durable));
            match saved {
                Ok(()) => entry.receipt.warning = None,
                Err(error) => {
                    entry.receipt.warning = Some(format!(
                        "本次结果仍保留在当前连接中，磁盘回执尚未更新：{error}"
                    ))
                }
            }
        }
        entry.touched = Instant::now();
        Ok(Some(entry.receipt.clone()))
    }
    pub fn cancel_backup_import(
        &self,
        engine_id: &str,
        id: &str,
    ) -> Result<Option<BackupImportReceipt>, String> {
        self.check_engine(engine_id)?;
        key(id)?;
        let task = {
            let all = self
                .backup_imports
                .0
                .lock()
                .map_err(|_| "备份导入状态不可用")?;
            if let Some(entry) = all.get(id) {
                entry.receipt.task_id.clone()
            } else {
                let mut cancelled = self
                    .backup_imports
                    .1
                    .lock()
                    .map_err(|_| "备份取消状态不可用")?;
                cancelled.retain(|_, at| at.elapsed().as_secs() < 300);
                if cancelled.len() >= 64 {
                    return Err("正在确认的取消请求较多，请稍后继续".into());
                }
                cancelled.insert(id.into(), Instant::now());
                None
            }
        };
        if let Some(task) = task {
            let _ = self.tasks.cancel(&task);
        }
        self.read_backup_import(engine_id, id)
    }
}
