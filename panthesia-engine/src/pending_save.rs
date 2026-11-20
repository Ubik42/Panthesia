//! Coalesced, acknowledged settings writes. Playback never waits on the disk thread.
use crate::{background_tasks::TaskPool, runtime_request::Request};
use panthesia_core::utils::atomic_file::{self, DeferredWrite};
use serde::Serialize;
use std::{
    cell::RefCell,
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
};

pub(crate) type Completion = Box<dyn FnOnce(Result<(), String>) + Send>;
thread_local! { static REPLIES: RefCell<Option<Vec<Completion>>> = const { RefCell::new(None) }; }
pub(super) fn respond<T: Send + 'static>(
    reply: mpsc::SyncSender<Result<T, String>>,
    result: Result<T, String>,
) {
    let mut completion: Option<Completion> = Some(Box::new(move |saved| {
        let _ = reply.send(saved.and(result));
    }));
    REPLIES.with(|slot| {
        if let Some(replies) = slot.borrow_mut().as_mut() {
            replies.push(completion.take().unwrap());
        }
    });
    if let Some(completion) = completion {
        completion(Ok(()));
    }
}
pub(super) fn capture(
    pipeline: &Pipeline,
    work: impl FnOnce(),
) -> (Vec<DeferredWrite>, Vec<Completion>) {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            REPLIES.with(|slot| {
                slot.borrow_mut().take();
            });
        }
    }
    REPLIES.with(|slot| {
        assert!(slot.borrow().is_none(), "nested storage replies");
        *slot.borrow_mut() = Some(Vec::new());
    });
    let reset = Reset;
    let ((), writes) =
        atomic_file::capture_with_retirement(pipeline.targets(), pipeline.retirement.clone(), work);
    let replies = REPLIES.with(|slot| slot.borrow_mut().take().unwrap());
    drop(reset);
    (writes, replies)
}
pub(super) fn tick(player: &mut crate::Player, delta: std::time::Duration) {
    if let Some(pipeline) = player.pending_saves.clone() {
        let (writes, replies) = capture(&pipeline, || player.tick(delta));
        pipeline.enqueue(writes, replies, false);
    } else {
        player.tick(delta);
    }
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    pub version: String,
    pub operation: Option<StorageOperation>,
    pub pending: bool,
    pub writing: bool,
    pub unsaved_changes: bool,
    pub error: Option<String>,
    pub can_retry: bool,
    pub recovery: crate::storage_recovery::StorageRecovery,
    pub recovery_error: Option<String>,
}
pub type Status = StorageStatus;
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageOperation {
    Round,
    Import,
    Recording,
    Asset,
    Library,
    Song,
    Practice,
    Closing,
}
impl StorageOperation {
    pub(super) fn current(id: Option<&str>, closing: bool) -> Option<Self> {
        if closing {
            return Some(Self::Closing);
        }
        id.map(|id| {
            if id.starts_with("round-") {
                Self::Round
            } else if id.starts_with("recording-") {
                Self::Recording
            } else if id.starts_with("practice-edit-") {
                Self::Practice
            } else if id.starts_with("library-edit-") {
                Self::Library
            } else if id.starts_with("asset-edit-") {
                Self::Asset
            } else if id.starts_with("song-switch-") {
                Self::Song
            } else {
                Self::Import
            }
        })
    }
}
struct Batch {
    writes: BTreeMap<PathBuf, DeferredWrite>,
    replies: Vec<Completion>,
}
impl Batch {
    fn merge(&mut self, newer: Self) -> Vec<DeferredWrite> {
        let retired = merge_writes(&mut self.writes, newer.writes);
        self.replies.extend(newer.replies);
        retired
    }
}
fn merge_writes(
    target: &mut BTreeMap<PathBuf, DeferredWrite>,
    newer: BTreeMap<PathBuf, DeferredWrite>,
) -> Vec<DeferredWrite> {
    newer
        .into_iter()
        .filter_map(|(path, write)| target.insert(path, write))
        .collect()
}
#[derive(Default)]
struct Queue {
    revision: u64,
    pending: Option<Batch>,
    failed: Option<BTreeMap<PathBuf, DeferredWrite>>,
    error: Option<String>,
    draining: bool,
    retrying: bool,
}
#[derive(Clone)]
pub(crate) struct Pipeline {
    retirement: atomic_file::Retirement,
    origin: Arc<str>,
    recovery: crate::storage_recovery::Monitor,
    _data_lock: Arc<crate::data_root_lock::DataRootLock>,
    targets: Arc<[PathBuf]>,
    data: PathBuf,
    queue: Arc<Mutex<Queue>>,
    tasks: TaskPool,
    tx: mpsc::Sender<Request>,
    busy: Arc<AtomicBool>,
}
impl Pipeline {
    fn retire_writes(&self, retired: Vec<DeferredWrite>) {
        if !retired.is_empty() {
            (self.retirement)(retired);
        }
    }
    fn version(&self, queue: &Queue) -> String {
        format!("{}-{}", self.origin, queue.revision)
    }
    pub fn recovery(&self) -> crate::storage_recovery::Status {
        self.recovery.status()
    }
    pub fn failure(&self) -> Option<String> {
        match self.queue.lock() {
            Ok(queue) => queue.error.clone(),
            Err(_) => Some("保存队列状态不可用，请保留当前程序并重新处理资料".into()),
        }
    }
    pub fn excludes_playback(&self) -> bool {
        self.queue
            .lock()
            .map_or(true, |queue| queue.error.is_some() || queue.retrying)
    }
    pub fn observe_recovery(&self) -> crate::storage_recovery::Status {
        let status = self.recovery.observe(&self.data);
        if status.blocked() {
            self.busy.store(true, Ordering::Release);
        }
        status
    }
    pub fn targets(&self) -> Arc<[PathBuf]> {
        self.targets.clone()
    }
    pub fn sender(&self) -> mpsc::Sender<Request> {
        self.tx.clone()
    }
    pub fn new(
        data: PathBuf,
        tasks: TaskPool,
            tx: mpsc::Sender<Request>,
        busy: Arc<AtomicBool>,
        data_lock: Arc<crate::data_root_lock::DataRootLock>,
        reclaimer: crate::playback_memory::Reclaimer,
    ) -> Self {
        static ORIGIN: AtomicU64 = AtomicU64::new(0);
        let targets = vec![
            data.join("web-preferences.json"),
            data.join("web-practice-history.ron"),
        ]
        .into();
        Self {
            retirement: Arc::new(move |writes| reclaimer.release(writes)),
            origin: format!(
                "saves-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos(),
                ORIGIN.fetch_add(1, Ordering::Relaxed)
            )
            .into(),
            recovery: Default::default(),
            _data_lock: data_lock,
            targets,
            data,
            tasks,
            tx,
            busy,
            queue: Arc::new(Mutex::new(Queue::default())),
        }
    }
    pub fn status(&self) -> Status {
        let recovery = self.recovery();
        let recovery_error = self.recovery.diagnostic();
        match self.queue.lock() {
            Ok(queue) => Status {
                version: self.version(&queue),
                operation: None,
                pending: queue.draining
                    || queue.pending.is_some()
                    || queue.failed.is_some()
                    || recovery.blocked(),
                writing: queue.draining || queue.pending.is_some(),
                unsaved_changes: queue
                    .failed
                    .as_ref()
                    .is_some_and(|writes| !writes.is_empty()),
                error: queue
                    .error
                    .clone()
                    .or_else(|| recovery_error.clone())
                    .or_else(|| recovery.message().map(str::to_owned)),
                can_retry: queue.failed.is_some() && !recovery.hard(),
                recovery,
                recovery_error,
            },
            Err(_) => Status {
                version: String::new(),
                operation: None,
                pending: true,
                writing: true,
                unsaved_changes: true,
                error: Some("保存队列状态不可用，请保留当前程序并重新处理资料".into()),
                can_retry: false,
                recovery,
                recovery_error,
            },
        }
    }
    pub fn enqueue(&self, writes: Vec<DeferredWrite>, replies: Vec<Completion>, barrier: bool) {
        if writes.is_empty() {
            if barrier && !replies.is_empty() {
                if let Ok(mut queue) = self.queue.lock() {
                    if let Some(error) = queue.error.clone() {
                        drop(queue);
                        self.report(Err(error), replies);
                        return;
                    }
                    if let Some(pending) = &mut queue.pending {
                        pending.replies.extend(replies);
                        return;
                    }
                    if queue.draining {
                        queue.pending = Some(Batch {
                            writes: BTreeMap::new(),
                            replies,
                        });
                        return;
                    }
                } else {
                    self.report(
                        Err("保存队列不可用，无法确认先前修改已经保存".into()),
                        replies,
                    );
                    return;
                }
            }
            for reply in replies {
                reply(Ok(()));
            }
            return;
        }
        let batch = Batch {
            writes: writes.into_iter().map(|w| (w.path.clone(), w)).collect(),
            replies,
        };
        let (start, retired) = match self.queue.lock() {
            Ok(mut queue) => {
                queue.revision = queue.revision.wrapping_add(1);
                if let Some(error) = queue.error.clone() {
                    let retired =
                        merge_writes(queue.failed.get_or_insert_with(BTreeMap::new), batch.writes);
                    drop(queue);
                    self.retire_writes(retired);
                    self.report(Err(error), batch.replies);
                    return;
                }
                let retired = if let Some(pending) = &mut queue.pending {
                    pending.merge(batch)
                } else {
                    queue.pending = Some(batch);
                    Vec::new()
                };
                let start = if queue.draining {
                    false
                } else {
                    queue.draining = true;
                    true
                };
                (start, retired)
            }
            Err(_) => {
                self.report(
                    Err("保存队列不可用，当前修改尚未保存".into()),
                    batch.replies,
                );
                return;
            }
        };
        self.retire_writes(retired);
        if start {
            let pipeline = self.clone();
            if let Err(error) = self.tasks.post("保存练习设置", move |_| {
                pipeline.flush()?;
                Ok(serde_json::json!({"ok":true}))
            }) {
                self.fail(error, None);
            }
        }
    }
    fn report(&self, result: Result<(), String>, replies: Vec<Completion>) {
        if result.is_err() {
            self.busy.store(true, Ordering::Release);
        }
        let _ = self.tx.send(Request::SaveFinished { result, replies });
    }
    fn fail(&self, error: String, batch: Option<Batch>) {
        self.busy.store(true, Ordering::Release);
        let mut replies = Vec::new();
        let mut retired = Vec::new();
        if let Ok(mut queue) = self.queue.lock() {
            queue.revision = queue.revision.wrapping_add(1);
            let mut failed = queue.failed.take().unwrap_or_default();
            if let Some(batch) = batch {
                retired.extend(merge_writes(&mut failed, batch.writes));
                replies.extend(batch.replies);
            }
            if let Some(batch) = queue.pending.take() {
                retired.extend(merge_writes(&mut failed, batch.writes));
                replies.extend(batch.replies);
            }
            queue.failed = Some(failed);
            queue.error = Some(error.clone());
            queue.draining = false;
            queue.retrying = false;
        }
        self.retire_writes(retired);
        self.report(Err(error), replies);
    }
    /// Called only from the shared single storage lane, including before an exclusive operation.
    pub fn flush(&self) -> Result<(), String> {
        loop {
            let batch = {
                let mut queue = self.queue.lock().map_err(|_| "保存队列不可用")?;
                if let Some(error) = &queue.error {
                    return Err(error.clone());
                }
                match queue.pending.take() {
                    Some(batch) => batch,
                    None => {
                        queue.draining = false;
                        let completed_retry = std::mem::take(&mut queue.retrying);
                        drop(queue);
                        if completed_retry {
                            self.report(Ok(()), Vec::new());
                        }
                        return Ok(());
                    }
                }
            };
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                if batch.writes.is_empty() {
                    return Ok(());
                }
                let writes = batch
                    .writes
                    .values()
                    .map(DeferredWrite::materialize)
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                crate::round_storage::commit_queued(&self.data, &writes)
            }))
            .unwrap_or_else(|_| Err("保存未完成，当前修改仍保留在本次运行中，可重试保存".into()));
            self.observe_recovery();
            match result {
                Ok(()) => self.report(Ok(()), batch.replies),
                Err(error) => {
                    self.fail(error.clone(), Some(batch));
                    return Err(error);
                }
            }
        }
    }
    pub fn retry(&self, expected: Option<&str>, reply: Completion) {
        let recovery = self.observe_recovery();
        if recovery.hard() {
            reply(Err(recovery
                .message()
                .unwrap_or("资料恢复状态尚未确认，请重新启动后处理")
                .into()));
            return;
        }
        let ready = match self.queue.lock() {
            Ok(mut queue) => {
                if expected.is_some_and(|expected| expected != self.version(&queue)) {
                    drop(queue);
                    reply(Err(
                        "原保存内容已经更新，请重新读取当前保存状态后重试".into()
                    ));
                    return;
                }
                match queue.failed.take() {
                    Some(writes) => {
                        queue.revision = queue.revision.wrapping_add(1);
                        queue.error = None;
                        queue.draining = true;
                        queue.retrying = true;
                        queue.pending = Some(Batch {
                            writes,
                            replies: vec![reply],
                        });
                        true
                    }
                    None => {
                        drop(queue);
                        reply(Err("没有可重试的设置保存，请重新启动完成资料恢复".into()));
                        false
                    }
                }
            }
            Err(_) => {
                reply(Err("保存队列不可用".into()));
                false
            }
        };
        if ready {
            let _ = self.flush();
        }
    }
}

impl crate::Engine {
    pub(super) fn read_storage_status(&self) -> Result<serde_json::Value, String> {
        let engine = self.clone();
        self.storage_tasks
            .run("核对保存与恢复状态", None, move |token| {
                token.stage("reading")?;
                token.check()?;
                engine.pending_saves.observe_recovery();
                // Publish the observation even if the caller cancelled while the filesystem
                // was responding. Runtime exclusion must follow the facts just observed.
                let (reply, receiver) = mpsc::sync_channel(1);
                engine
                    .tx
                    .send(Request::StorageRecoveryObserved(reply))
                    .map_err(|_| "音乐引擎已关闭")?;
                let status = receiver.recv().map_err(|_| "资料状态核对通道已关闭")??;
                token.check()?;
                serde_json::to_value(status).map_err(|error| error.to_string())
            })
    }
    pub(super) fn retry_settings_save(
        &self,
        expected: Option<String>,
    ) -> Result<serde_json::Value, String> {
        if expected
            .as_ref()
            .is_some_and(|version| version.is_empty() || version.len() > 200)
        {
            return Err("原保存版本无效，请重新读取当前保存状态".into());
        }
        let operation = self.pending_operation()?;
        let engine = self.clone();
        self.storage_tasks
            .run("重试保存练习资料", None, move |token| {
                let _operation = operation;
                token.check()?;
                let fence = engine.storage_fence()?;
                token.check()?;
                if !fence.storage.can_retry {
                    return Err(fence
                        .error
                        .unwrap_or_else(|| "原保存状态已经更新，请重新读取当前保存状态".into()));
                }
                token.begin_commit()?;
                let (reply, receiver) = mpsc::sync_channel(1);
                engine.pending_saves.retry(
                    expected.as_deref(),
                    Box::new(move |result| {
                        let _ = reply.send(result.map(|_| serde_json::json!({"ok":true})));
                    }),
                );
                receiver.recv().map_err(|_| "保存结果通道已关闭")?
            })
    }
}

impl crate::Player {
    pub(super) fn finish_settings_save(&mut self, receipt: &Result<(), String>) {
        // Replies retain the outcome of their original request. Presentation follows
        // the current queue so a delayed receipt cannot undo a successful retry.
        let failure = self
            .pending_saves
            .as_ref()
            .map_or_else(|| receipt.as_ref().err().cloned(), Pipeline::failure);
        if let Some(error) = failure {
            let message =
                format!("练习修改尚未保存：{error}。可重试保存，或在退出时确认未保存内容。");
            if self.settings_save_error.as_ref() != Some(&message) {
                self.panic();
                if self.state.status != "finished" {
                    self.state.status = "paused".into();
                }
                self.time_connected = false;
            }
            self.state.error = Some(message.clone());
            self.settings_save_error = Some(message);
            self.storage_busy.store(true, Ordering::Release);
        } else {
            if self.state.error == self.settings_save_error {
                self.state.error = None;
            }
            self.settings_save_error = None;
            if self.state.error.is_none() {
                self.state.error = self.save_error.clone();
            }
            crate::storage_control::unblock(self);
        }
    }
}
