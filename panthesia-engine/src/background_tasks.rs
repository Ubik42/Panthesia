//! Bounded CPU work, observable state, and cancellation before any commit.
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::VecDeque,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

type Reply = Result<Value, String>;
type Work = Box<dyn FnOnce(TaskToken) -> Reply + Send>;
type SharedWork = Arc<Mutex<Option<Work>>>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub id: String,
    pub label: String,
    pub state: &'static str,
    pub stage: &'static str,
    pub content_id: Option<String>,
    pub fingerprint: Option<String>,
    pub error: Option<String>,
}
struct Record {
    scope: Option<(String, u64)>,
    status: Status,
    reply: Option<mpsc::SyncSender<Reply>>,
    work: std::sync::Weak<Mutex<Option<Work>>>,
}
#[derive(Clone)]
pub(crate) struct TaskToken(Arc<Mutex<Record>>);
impl TaskToken {
    pub fn check(&self) -> Result<(), String> {
        if self
            .0
            .lock()
            .map_err(|_| "后台任务状态不可用")?
            .status
            .state
            == "cancelled"
        {
            Err("后台任务已取消".into())
        } else {
            Ok(())
        }
    }
    pub fn stage(&self, stage: &'static str) -> Result<(), String> {
        let mut record = self.0.lock().map_err(|_| "后台任务状态不可用")?;
        if record.status.state == "cancelled" {
            return Err("后台任务已取消".into());
        }
        record.status.stage = stage;
        Ok(())
    }
    pub fn source(&self, content_id: String, fingerprint: String) -> Result<(), String> {
        self.check()?;
        let mut record = self.0.lock().map_err(|_| "后台任务状态不可用")?;
        record.status.content_id = Some(content_id);
        record.status.fingerprint = Some(fingerprint);
        Ok(())
    }
    // This transition and cancellation use the same lock. Once a write begins,
    // cancellation cannot promise that the write did not happen.
    pub fn begin_commit(&self) -> Result<(), String> {
        let mut record = self.0.lock().map_err(|_| "后台任务状态不可用")?;
        if record.status.state == "cancelled" {
            return Err("后台任务已取消".into());
        }
        record.status.state = "committing";
        record.status.stage = "committing";
        Ok(())
    }
    fn finish(&self, result: Reply) {
        let Ok(mut record) = self.0.lock() else {
            return;
        };
        if record.status.state == "cancelled" {
            return;
        }
        record.status.state = if result.is_ok() {
            "succeeded"
        } else {
            "failed"
        };
        record.status.error = result.as_ref().err().cloned();
        if let Some(reply) = record.reply.take() {
            let _ = reply.send(result);
        }
    }
}
struct Job {
    token: TaskToken,
    work: SharedWork,
}
pub(crate) struct Ticket {
    id: String,
    receiver: mpsc::Receiver<Reply>,
}
#[derive(Clone)]
pub(crate) struct TaskPool {
    sender: mpsc::SyncSender<Job>,
    records: Arc<Mutex<VecDeque<TaskToken>>>,
    serial: Arc<AtomicU64>,
    cancelled_scopes: Arc<Mutex<VecDeque<(String, u64)>>>,
}
impl TaskPool {
    pub fn new(workers: usize, capacity: usize) -> Result<Self, String> {
        Self::with_records(
            workers,
            capacity,
            "work",
            Arc::new(Mutex::new(VecDeque::new())),
            Arc::new(AtomicU64::new(0)),
            Arc::new(Mutex::new(VecDeque::new())),
        )
    }
    pub fn storage_lane(&self, capacity: usize) -> Result<Self, String> {
        self.serial_lane("storage", capacity)
    }
    /// Dedicated bounded CPU lanes share observable tasks, not another lane's queue.
    pub fn serial_lane(&self, name: &str, capacity: usize) -> Result<Self, String> {
        Self::with_records(
            1,
            capacity,
            name,
            self.records.clone(),
            self.serial.clone(),
            self.cancelled_scopes.clone(),
        )
    }
    fn with_records(
        workers: usize,
        capacity: usize,
        name: &str,
        records: Arc<Mutex<VecDeque<TaskToken>>>,
        serial: Arc<AtomicU64>,
        cancelled_scopes: Arc<Mutex<VecDeque<(String, u64)>>>,
    ) -> Result<Self, String> {
        let (sender, receiver) = mpsc::sync_channel::<Job>(capacity);
        let receiver = Arc::new(Mutex::new(receiver));
        for index in 0..workers {
            let receiver = receiver.clone();
            thread::Builder::new()
                .name(format!("neothesia-{name}-{index}"))
                .spawn(move || {
                    loop {
                        let job = match receiver.lock().unwrap().recv() {
                            Ok(job) => job,
                            Err(_) => break,
                        };
                        let work = {
                            let Ok(mut record) = job.token.0.lock() else {
                                continue;
                            };
                            if record.status.state == "cancelled" {
                                continue;
                            }
                            let work = job.work.lock().ok().and_then(|mut work| work.take());
                            if record.status.state != "committing" {
                                record.status.state = "running";
                                record.status.stage = "preparing";
                            }
                            work
                        };
                        let token = job.token.clone();
                        let result = match work {
                            Some(work) => catch_unwind(AssertUnwindSafe(|| work(token)))
                                .unwrap_or_else(|_| Err("后台计算异常结束，请重新生成".into())),
                            None => Err("后台任务内容已释放，请重新执行".into()),
                        };
                        job.token.finish(result);
                    }
                })
                .map_err(|error| error.to_string())?;
        }
        Ok(Self {
            sender,
            records,
            serial,
            cancelled_scopes,
        })
    }
    fn submit(
        &self,
        label: &str,
        content_id: Option<String>,
        work: Work,
    ) -> Result<Ticket, String> {
        self.submit_policy(label, content_id, work, true, None)
    }
    fn submit_policy(
        &self,
        label: &str,
        content_id: Option<String>,
        work: Work,
        cancellable: bool,
        scope: Option<(String, u64)>,
    ) -> Result<Ticket, String> {
        let serial = self.serial.fetch_add(1, Ordering::Relaxed);
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let id = format!("{time:x}-{serial:x}");
        let (reply, receiver) = mpsc::sync_channel(1);
        let work = Arc::new(Mutex::new(Some(work)));
        let token = TaskToken(Arc::new(Mutex::new(Record {
            scope: scope.clone(),
            status: Status {
                id: id.clone(),
                label: label.into(),
                state: if cancellable { "queued" } else { "committing" },
                stage: if cancellable { "queued" } else { "committing" },
                content_id,
                fingerprint: None,
                error: None,
            },
            reply: Some(reply),
            work: Arc::downgrade(&work),
        })));
        let mut superseded = Vec::new();
        {
            let mut records = self.records.lock().map_err(|_| "后台任务列表不可用")?;
            if let Some((key, sequence)) = &scope {
                if self
                    .cancelled_scopes
                    .lock()
                    .map_err(|_| "后台读取通道不可用")?
                    .iter()
                    .any(|(cancelled_key, through)| cancelled_key == key && sequence <= through)
                {
                    return Err("这次后台读取已停止".into());
                }
                // Admission is ordered by the caller's sequence, not by the timing of worker threads.
                if records.iter().any(|token| {
                    token.0.lock().is_ok_and(|record| {
                        record
                            .scope
                            .as_ref()
                            .is_some_and(|(old_key, old_sequence)| {
                                old_key == key && old_sequence >= sequence
                            })
                    })
                }) {
                    return Err("后台读取已被较新的请求替代".into());
                }
                for previous in records.iter() {
                    let mut record = previous.0.lock().map_err(|_| "后台任务状态不可用")?;
                    if record
                        .scope
                        .as_ref()
                        .is_some_and(|(old_key, _)| old_key == key)
                        && matches!(record.status.state, "queued" | "running")
                    {
                        record.status.state = "cancelled";
                        let reply = record.reply.take();
                        let abandoned = record
                            .work
                            .upgrade()
                            .and_then(|work| work.lock().ok()?.take());
                        superseded.push((reply, abandoned));
                    }
                }
            }
            while records.len() >= 64 {
                let removable = records.iter().position(|record| {
                    record.0.lock().is_ok_and(|r| {
                        matches!(r.status.state, "succeeded" | "failed" | "cancelled")
                    })
                });
                if let Some(index) = removable {
                    records.remove(index);
                } else {
                    break;
                }
            }
            records.push_back(token.clone());
        }
        // Dropping abandoned closures may release runtime guards; keep it outside registry locks.
        for (reply, abandoned) in superseded {
            drop(abandoned);
            if let Some(reply) = reply {
                let _ = reply.send(Err("后台读取已被较新的请求替代".into()));
            }
        }
        if let Err(error) = self.sender.try_send(Job {
            token: token.clone(),
            work,
        }) {
            let message = match error {
                mpsc::TrySendError::Full(_) => "后台任务已满，请等当前计算完成后重试",
                mpsc::TrySendError::Disconnected(_) => "后台计算线程已关闭",
            };
            token.finish(Err(message.into()));
            return Err(message.into());
        }
        Ok(Ticket { id, receiver })
    }
    pub fn run(
        &self,
        label: &str,
        content_id: Option<String>,
        work: impl FnOnce(TaskToken) -> Reply + Send + 'static,
    ) -> Reply {
        let ticket = self.submit(label, content_id, Box::new(work))?;
        self.wait_result(ticket)
    }
    /// Only readers should use replacement; durable work keeps its existing commit policy.
    pub fn run_latest(
        &self,
        key: String,
        sequence: u64,
        label: &str,
        content_id: Option<String>,
        work: impl FnOnce(TaskToken) -> Reply + Send + 'static,
    ) -> Reply {
        let ticket = self.submit_policy(
            label,
            content_id,
            Box::new(work),
            true,
            Some((key, sequence)),
        )?;
        self.wait_result(ticket)
    }
    fn wait_result(&self, ticket: Ticket) -> Reply {
        match ticket.receiver.recv_timeout(Duration::from_secs(120)) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let cancelled = self.cancel(&ticket.id);
                if let Ok(result) = ticket.receiver.try_recv() {
                    return result;
                }
                if cancelled.is_ok() {
                    Err("后台任务等待超时，已取消未提交的处理".into())
                } else {
                    Err(format!(
                        "后台任务响应超时，保存仍在进行。请等待任务结束并重新读取结果，避免重复操作：{}",
                        ticket.id
                    ))
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err("后台任务结果通道已关闭".into()),
        }
    }
    /// Owned persistence keeps its completion channel until the write actually ends.
    /// The caller may stop waiting externally; the job must still release its runtime lease.
    pub fn run_owned(
        &self,
        label: &str,
        work: impl FnOnce(TaskToken) -> Reply + Send + 'static,
    ) -> Reply {
        let ticket = self.submit_policy(label, None, Box::new(work), false, None)?;
        ticket
            .receiver
            .recv()
            .map_err(|_| "保存作业结果通道已关闭".to_string())?
    }
    pub fn post(
        &self,
        label: &str,
        work: impl FnOnce(TaskToken) -> Reply + Send + 'static,
    ) -> Result<(), String> {
        self.submit_policy(label, None, Box::new(work), false, None)
            .map(|_| ())
    }
    pub fn list(&self) -> Result<Vec<Status>, String> {
        self.records
            .lock()
            .map_err(|_| "后台任务列表不可用")?
            .iter()
            .map(|token| {
                token
                    .0
                    .lock()
                    .map(|record| record.status.clone())
                    .map_err(|_| "后台任务状态不可用".into())
            })
            .collect()
    }
    /// A stop can arrive before its read is admitted. Retain a bounded sequence fence.
    pub fn cancel_scope(&self, key: &str, through: u64) -> Result<(), String> {
        let records = self.records.lock().map_err(|_| "后台任务列表不可用")?;
        let mut scopes = self
            .cancelled_scopes
            .lock()
            .map_err(|_| "后台读取通道不可用")?;
        let previous = scopes
            .iter()
            .position(|(stored, _)| stored == key)
            .and_then(|index| scopes.remove(index))
            .map_or(0, |(_, sequence)| sequence);
        scopes.push_back((key.into(), through.max(previous)));
        while scopes.len() > 256 {
            scopes.pop_front();
        }
        drop(scopes);
        let mut cancelled = Vec::new();
        for token in records.iter() {
            let mut record = token.0.lock().map_err(|_| "后台任务状态不可用")?;
            if !record
                .scope
                .as_ref()
                .is_some_and(|(stored, sequence)| stored == key && *sequence <= through)
                || !matches!(record.status.state, "queued" | "running")
            {
                continue;
            }
            record.status.state = "cancelled";
            let reply = record.reply.take();
            let abandoned = record
                .work
                .upgrade()
                .and_then(|work| work.lock().ok()?.take());
            cancelled.push((reply, abandoned));
        }
        drop(records);
        for (reply, abandoned) in cancelled {
            drop(abandoned);
            if let Some(reply) = reply {
                let _ = reply.send(Err("这次后台读取已停止".into()));
            }
        }
        Ok(())
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let records = self.records.lock().map_err(|_| "后台任务列表不可用")?;
        let token = records
            .iter()
            .find(|token| token.0.lock().is_ok_and(|r| r.status.id == id))
            .ok_or("后台任务不存在或记录已过期")?;
        let mut record = token.0.lock().map_err(|_| "后台任务状态不可用")?;
        match record.status.state {
            "committing" => return Err("结果正在保存，请等待完成".into()),
            "succeeded" | "failed" | "cancelled" => return Ok(()),
            _ => {}
        }
        record.status.state = "cancelled";
        let reply = record.reply.take();
        let abandoned = record
            .work
            .upgrade()
            .and_then(|work| work.lock().ok()?.take());
        drop(record);
        drop(records);
        // Release queued input buffers and exclusive-operation guards immediately.
        // A worker already owns a running closure, which stops at its next cancellation check.
        drop(abandoned);
        if let Some(reply) = reply {
            let _ = reply.send(Err("后台任务已取消".into()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn cancellation_wakes_the_caller_and_prevents_commit() {
        let pool = TaskPool::new(1, 1).unwrap();
        let (started, start) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let wrote = Arc::new(AtomicBool::new(false));
        let flag = wrote.clone();
        let ticket = pool
            .submit(
                "blocked",
                None,
                Box::new(move |token| {
                    started.send(()).unwrap();
                    gate.recv().unwrap();
                    token.begin_commit()?;
                    flag.store(true, Ordering::SeqCst);
                    Ok(Value::Null)
                }),
            )
            .unwrap();
        start.recv_timeout(Duration::from_secs(2)).unwrap();
        pool.cancel(&ticket.id).unwrap();
        assert_eq!(
            ticket
                .receiver
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap_err(),
            "后台任务已取消"
        );
        release.send(()).unwrap();
        pool.run("barrier", None, |_| Ok(Value::Null)).unwrap();
        assert!(!wrote.load(Ordering::SeqCst));
    }
    #[test]
    fn queued_cancel_does_not_run_and_a_full_queue_is_rejected() {
        let pool = TaskPool::new(1, 1).unwrap();
        let (started, start) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let first = pool
            .submit(
                "first",
                None,
                Box::new(move |_| {
                    started.send(()).unwrap();
                    gate.recv().unwrap();
                    Ok(Value::Null)
                }),
            )
            .unwrap();
        start.recv_timeout(Duration::from_secs(2)).unwrap();
        let ran = Arc::new(AtomicBool::new(false));
        let flag = ran.clone();
        let queued = pool
            .submit(
                "queued",
                None,
                Box::new(move |_| {
                    flag.store(true, Ordering::SeqCst);
                    Ok(Value::Null)
                }),
            )
            .unwrap();
        assert!(
            pool.submit("overflow", None, Box::new(|_| Ok(Value::Null)))
                .is_err()
        );
        pool.cancel(&queued.id).unwrap();
        assert!(
            queued
                .receiver
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .is_err()
        );
        release.send(()).unwrap();
        first
            .receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        // The worker consumes the cancelled queue item before the next job.
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        loop {
            assert!(std::time::Instant::now() < deadline);
            match pool.submit("barrier", None, Box::new(|_| Ok(Value::Null))) {
                Ok(ticket) => {
                    ticket
                        .receiver
                        .recv_timeout(Duration::from_secs(2))
                        .unwrap()
                        .unwrap();
                    break;
                }
                Err(_) => thread::yield_now(),
            }
        }
        assert!(!ran.load(Ordering::SeqCst));
    }
    #[test]
    fn committing_result_is_not_reported_as_cancelled() {
        let pool = TaskPool::new(1, 1).unwrap();
        let (started, start) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let ticket = pool
            .submit(
                "commit",
                None,
                Box::new(move |token| {
                    token.begin_commit()?;
                    started.send(()).unwrap();
                    gate.recv().unwrap();
                    Ok(Value::Bool(true))
                }),
            )
            .unwrap();
        start.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(pool.cancel(&ticket.id).is_err());
        release.send(()).unwrap();
        assert_eq!(
            ticket
                .receiver
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap(),
            Value::Bool(true)
        );
    }
}
