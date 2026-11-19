//! One desktop close attempt coordinates UI drafts, native jobs and musical storage.
use serde::{Deserialize, Serialize};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, Window};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DesktopClosePhase {
    Preparing,
    Saving,
    Finalizing,
    Reviewing,
    Returning,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCloseStatus {
    pub id: String,
    pub pass: u8,
    pub phase: DesktopClosePhase,
    pub message: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopCloseIssue {
    pub key: String,
    pub label: String,
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<DesktopCloseIssueKind>,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DesktopCloseIssueKind {
    Temporary,
    Recovery,
    Problem,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopCloseReport {
    pub issues: Vec<DesktopCloseIssue>,
    #[serde(default)]
    pub checked: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCloseReview {
    pub id: String,
    pub report: DesktopCloseReport,
}
struct Active {
    status: DesktopCloseStatus,
    cancelled: Arc<AtomicBool>,
    reply: Option<mpsc::SyncSender<DesktopCloseReport>>,
    committed: bool,
    review: Option<DesktopCloseReport>,
    decision: Option<mpsc::SyncSender<String>>,
}
#[derive(Default)]
pub struct Bridge {
    attached: AtomicBool,
    active: Mutex<Option<Active>>,
}
impl Bridge {
    fn begin(&self) -> Result<(String, Arc<AtomicBool>), String> {
        static SERIAL: AtomicU64 = AtomicU64::new(0);
        let id = format!(
            "close-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        );
        let cancelled = Arc::new(AtomicBool::new(false));
        *self.active.lock().map_err(|_| "退出状态不可用")? = Some(Active {
            status: DesktopCloseStatus {
                id: id.clone(),
                pass: 0,
                phase: DesktopClosePhase::Preparing,
                message: "正在保留当前输入…".into(),
            },
            cancelled: cancelled.clone(),
            reply: None,
            committed: false,
            review: None,
            decision: None,
        });
        Ok((id, cancelled))
    }
    fn status(&self) -> Result<Option<DesktopCloseStatus>, String> {
        Ok(self
            .active
            .lock()
            .map_err(|_| "退出状态不可用")?
            .as_ref()
            .map(|active| active.status.clone()))
    }
    fn update(
        &self,
        id: &str,
        phase: DesktopClosePhase,
        message: &str,
    ) -> Result<DesktopCloseStatus, String> {
        let mut all = self.active.lock().map_err(|_| "退出状态不可用")?;
        let active = all
            .as_mut()
            .filter(|active| active.status.id == id)
            .ok_or("退出请求已结束")?;
        if active.cancelled.load(Ordering::Acquire) {
            return Err("已取消本次退出".into());
        }
        active.status.phase = phase;
        active.status.message = message.into();
        Ok(active.status.clone())
    }
    fn review(&self) -> Result<Option<DesktopCloseReview>, String> {
        let all = self.active.lock().map_err(|_| "退出状态不可用")?;
        Ok(all.as_ref().and_then(|active| {
            active.review.as_ref().map(|report| DesktopCloseReview {
                id: active.status.id.clone(),
                report: report.clone(),
            })
        }))
    }
    fn set_review(
        &self,
        id: &str,
        report: &DesktopCloseReport,
    ) -> Result<DesktopCloseStatus, String> {
        let mut all = self.active.lock().map_err(|_| "退出状态不可用")?;
        let active = all
            .as_mut()
            .filter(|active| active.status.id == id)
            .ok_or("退出请求已结束")?;
        if active.cancelled.load(Ordering::Acquire) {
            return Err("已取消本次退出".into());
        }
        active.status.phase = DesktopClosePhase::Reviewing;
        active.status.message = "请核对保存状态，选择返回处理或关闭窗口。".into();
        active.review = Some(report.clone());
        Ok(active.status.clone())
    }
    fn commit(&self, id: &str) -> Result<(), String> {
        let mut all = self.active.lock().map_err(|_| "退出状态不可用")?;
        let active = all
            .as_mut()
            .filter(|active| active.status.id == id)
            .ok_or("退出请求已结束")?;
        if active.cancelled.load(Ordering::Acquire) {
            return Err("已取消本次退出".into());
        }
        active.committed = true;
        Ok(())
    }
    fn finish(&self, id: &str) {
        if let Ok(mut active) = self.active.lock() {
            if active.as_ref().is_some_and(|active| active.status.id == id) {
                active.take();
            }
        }
    }
}
#[tauri::command]
pub fn attach_desktop_close(
    state: tauri::State<'_, crate::State>,
) -> Result<Option<DesktopCloseStatus>, String> {
    state.desktop_close.attached.store(true, Ordering::Release);
    state.desktop_close.status()
}
#[tauri::command]
pub fn desktop_close_status(
    state: tauri::State<'_, crate::State>,
) -> Result<Option<DesktopCloseStatus>, String> {
    state.desktop_close.status()
}
#[tauri::command]
pub fn desktop_close_review(
    state: tauri::State<'_, crate::State>,
) -> Result<Option<DesktopCloseReview>, String> {
    state.desktop_close.review()
}
#[tauri::command]
pub fn decide_desktop_close(state: tauri::State<'_, crate::State>, id: String, action: String) -> Result<(), String> {
    if !matches!(action.as_str(), "close" | "retry") { return Err("退出操作无效".into()); }
    let mut all = state.desktop_close.active.lock().map_err(|_| "退出状态不可用")?;
    let active = all.as_mut().filter(|active| active.status.id == id && active.review.is_some() && !active.committed).ok_or("退出确认已结束")?;
    active.decision.take().ok_or("退出操作已提交")?.send(action).map_err(|_| "退出确认已结束".into())
}
#[tauri::command]
pub fn desktop_close_ready(
    state: tauri::State<'_, crate::State>,
    id: String,
    pass: u8,
    report: DesktopCloseReport,
) -> Result<(), String> {
    if report.issues.len() > 64
        || report.checked.len() > 128
        || report.checked.iter().any(|key| key.len() > 160)
        || report.issues.iter().any(|issue| {
            issue.key.is_empty()
                || issue.key.len() > 160
                || issue.label.len() > 160
                || issue.detail.len() > 4096
                || issue
                    .kind
                    .is_some_and(|kind| kind != DesktopCloseIssueKind::Temporary)
        })
    {
        return Err("退出前的临时内容说明超出范围".into());
    }
    let mut all = state
        .desktop_close
        .active
        .lock()
        .map_err(|_| "退出状态不可用")?;
    let active = all
        .as_mut()
        .filter(|active| active.status.id == id && active.status.pass == pass)
        .ok_or("退出确认已过期")?;
    if let Some(reply) = active.reply.take() {
        reply.send(report).map_err(|_| "退出准备已结束")?;
    }
    Ok(())
}
#[tauri::command]
pub fn cancel_desktop_close(
    state: tauri::State<'_, crate::State>,
    window: Window,
    id: String,
) -> Result<(), String> {
    let status = {
        let mut all = state
            .desktop_close
            .active
            .lock()
            .map_err(|_| "退出状态不可用")?;
        let active = all
            .as_mut()
            .filter(|active| active.status.id == id)
            .ok_or("退出请求已结束")?;
        if active.committed {
            return Err("窗口已开始关闭，本次返回请求未提交".into());
        }
        active.cancelled.store(true, Ordering::Release);
        active.status.phase = DesktopClosePhase::Returning;
        active.status.message = "正在返回窗口，已开始的保存会继续完成…".into();
        active.status.clone()
    };
    let _ = window.emit("neothesia-close-status", status);
    Ok(())
}
fn prepare_ui(
    window: &Window,
    id: &str,
    pass: u8,
    cancelled: &AtomicBool,
) -> Result<DesktopCloseReport, String> {
    if cancelled.load(Ordering::Acquire) {
        return Err("已取消本次退出".into());
    }
    let state = window.state::<crate::State>();
    if !state.desktop_close.attached.load(Ordering::Acquire) {
        return Ok(DesktopCloseReport::default());
    }
    let (reply, receiver) = mpsc::sync_channel(1);
    let status = {
        let mut all = state
            .desktop_close
            .active
            .lock()
            .map_err(|_| "退出状态不可用")?;
        let active = all
            .as_mut()
            .filter(|active| active.status.id == id)
            .ok_or("退出请求已结束")?;
        if active.cancelled.load(Ordering::Acquire) {
            return Err("已取消本次退出".into());
        }
        active.status.pass = pass;
        active.status.phase = if pass == 1 {
            DesktopClosePhase::Preparing
        } else {
            DesktopClosePhase::Finalizing
        };
        active.status.message = if pass == 1 {
            "正在保留编辑输入与工作进度…"
        } else {
            "正在确认最后的暂存与临时成品…"
        }
        .into();
        active.reply = Some(reply);
        active.status.clone()
    };
    window
        .emit("neothesia-close-prepare", status)
        .map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err("已取消本次退出".into());
        }
        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(report) => return Ok(report),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("界面退出准备已中断，当前窗口保留".into());
            }
            Err(mpsc::RecvTimeoutError::Timeout) if started.elapsed() < Duration::from_secs(15) => {
            }
            Err(_) => return Err("界面尚未确认输入已暂存，当前窗口保留。可返回后重试退出。".into()),
        }
    }
}
fn idle_native(window: &Window, cancelled: &AtomicBool) -> Result<(), String> {
    let state = window.state::<crate::State>();
    let exports = window.state::<crate::score_batch_export::Sessions>();
    let started = Instant::now();
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err("已取消本次退出".into());
        }
        let exports_idle = exports.try_cancel_pending()?;
        let saves_idle = state
            .score_saves
            .lock()
            .map_err(|_| "文件保存状态不可用")?
            .is_empty();
        if exports_idle && state.score_jobs.idle()? && saves_idle {
            return Ok(());
        }
        if started.elapsed() > Duration::from_secs(15) {
            return Err(
                "文件处理或保存尚未结束。请返回，关闭文件选择窗口或等待保存完成后再退出。".into(),
            );
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
fn prepare(
    window: &Window,
    id: &str,
    cancelled: Arc<AtomicBool>,
) -> Result<DesktopCloseReport, String> {
    window
        .state::<crate::State>()
        .engine
        .command(panthesia_engine::Command::Pause)?;
    let first = prepare_ui(window, id, 1, &cancelled)?;
    let state = window.state::<crate::State>();
    let status = state.desktop_close.update(
        id,
        DesktopClosePhase::Saving,
        "正在保存练习结果并结束文件处理…",
    )?;
    let _ = window.emit("neothesia-close-status", status);
    state.score_jobs.stop_for_close()?;
    // Finish the current file, then stop legacy batches before admitting another file.
    for cancel in state
        .score_imports
        .lock()
        .map_err(|_| "导入队列状态不可用")?
        .values()
    {
        cancel.store(true, Ordering::Release);
    }
    state.monitor.pause_for_close(cancelled.clone())?;
    idle_native(window, &cancelled)?;
    let performance_inputs = state.engine.prepare_desktop_close(cancelled.clone())?;
    let mut report = prepare_ui(window, id, 2, &cancelled)?;
    for input in performance_inputs {
        report.issues.push(DesktopCloseIssue {
            key: format!("engine-{}", input.key()),
            label: input.label().into(),
            detail: input.detail().into(),
            kind: Some(match input {
                panthesia_engine::CloseInput::StorageRecovery => DesktopCloseIssueKind::Recovery,
                panthesia_engine::CloseInput::StorageProblem
                | panthesia_engine::CloseInput::SoundUnavailable => DesktopCloseIssueKind::Problem,
                _ => DesktopCloseIssueKind::Temporary,
            }),
        });
    }
    for issue in first.issues {
        if !report.checked.contains(&issue.key)
            && !report.issues.iter().any(|current| current.key == issue.key)
        {
            report.issues.push(issue);
        }
    }
    {
        let _saves = state.score_saves.lock().map_err(|_| "暂存保存状态不可用")?;
        state.allow_closing_drafts.store(false, Ordering::Release);
    }
    idle_native(window, &cancelled)?;
    Ok(report)
}
fn resume(window: &Window, id: &str, error: Option<String>) {
    let state = window.state::<crate::State>();
    state.allow_closing_drafts.store(false, Ordering::Release);
    state.engine.cancel_close();
    state.score_jobs.resume_after_close();
    state.monitor.resume_after_close();
    state.desktop_close.finish(id);
    state.closing.store(false, Ordering::Release);
    let _ = window.emit("neothesia-close-resumed", id);
    if let Some(error) = error {
        let _ = window.emit("neothesia-close-blocked", error);
    }
}
pub fn request(window: Window) {
    let state = window.state::<crate::State>();
    if state.closing.swap(true, Ordering::AcqRel) {
        return;
    }
    let (id, cancelled) = match state.desktop_close.begin() {
        Ok(attempt) => attempt,
        Err(error) => {
            state.closing.store(false, Ordering::Release);
            let _ = window.emit("neothesia-close-blocked", error);
            return;
        }
    };
    state.allow_closing_drafts.store(true, Ordering::Release);
    drop(state);
    tauri::async_runtime::spawn(async move {
        let worker_window = window.clone();
        let worker_id = id.clone();
        let worker_cancelled = cancelled.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            prepare(&worker_window, &worker_id, worker_cancelled)
        })
        .await
        .map_err(|error| format!("关闭前保存异常：{error}"))
        .and_then(|result| result);
        if cancelled.load(Ordering::Acquire) {
            resume(&window, &id, None);
            return;
        }
        match result {
            Err(error) => { resume(&window, &id, Some(error)); return; }
            Ok(report) if !report.issues.is_empty() => {
                let state = window.state::<crate::State>();
                let status = match state.desktop_close.set_review(&id, &report) {
                    Ok(status) => status,
                    Err(error) => { drop(state); resume(&window, &id, Some(error)); return; }
                };
                let (decision, receiver) = mpsc::sync_channel(1);
                if let Ok(mut active) = state.desktop_close.active.lock() {
                    if let Some(active) = active.as_mut().filter(|a| a.status.id == id) { active.decision = Some(decision); }
                }
                drop(state);
                let _ = window.emit("neothesia-close-status", status);
                let _ = window.emit("neothesia-close-review", DesktopCloseReview { id: id.clone(), report });
                // The application owns the single decision surface. Never stack a native dialog on it.
                loop {
                    if cancelled.load(Ordering::Acquire) { resume(&window, &id, None); return; }
                    match receiver.recv_timeout(Duration::from_millis(100)) {
                        Ok(action) if action == "retry" => { resume(&window, &id, None); request(window); return; }
                        Ok(_) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(_) => { resume(&window, &id, Some("退出确认已中断，请重试".into())); return; }
                    }
                }
            }
            Ok(_) => {}
        }
        if cancelled.load(Ordering::Acquire) { resume(&window, &id, None); return; }
        let state = window.state::<crate::State>();
        if let Err(error) = state.desktop_close.commit(&id) {
            drop(state);
            resume(
                &window,
                &id,
                if cancelled.load(Ordering::Acquire) {
                    None
                } else {
                    Some(error)
                },
            );
            return;
        }
        state.allow_closing_drafts.store(false, Ordering::Release);
        state.close_allowed.store(true, Ordering::Release);
        let _ = window.emit("neothesia-close-allowed", &id);
        if let Err(error) = window.close() {
            state.close_allowed.store(false, Ordering::Release);
            drop(state);
            resume(&window, &id, Some(format!("窗口暂未关闭：{error}")));
        }
    });
}
