//! Observable, bounded conversion jobs. No generated draft is installed without user review.
use crate::score_export_bridge::ScoreExportResult;
use panthesia_engine::media_export_cache::MediaExportDraft;
use panthesia_engine::{notation_drafts::DraftSaved, pdf_drafts::PdfDraft};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScoreJobKind {
    MidiToNotation,
    PaperToNotation,
    NotationToPdf,
    AnnotatedScore,
    MidiExport,
    PackageExport,
    MediaSave,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScoreJobRequest {
    pub id: String,
    pub engine_id: String,
    pub content_id: String,
    pub kind: ScoreJobKind,
    pub created_at_ms: u64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreDraft {
    pub name: String,
    pub bytes: Vec<u8>,
    pub preview_token: String,
    pub warning: Option<String>,
    pub saved: Option<DraftSaved>,
    #[serde(default)]
    pub cached: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreSubmitted {
    pub job_id: String,
}
#[derive(Serialize)]
#[serde(untagged)]
pub enum ConversionReply {
    Submitted(ScoreSubmitted),
    Draft(ScoreDraft),
}
enum Completed {
    Notation(ScoreDraft),
    Pdf(PdfDraft),
    Export(ScoreExportResult),
    Media(MediaExportDraft),
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScoreJobPhase {
    Preparing,
    Running,
    Ready,
    Cancelled,
    Error,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreJobStatus {
    pub request: ScoreJobRequest,
    pub phase: ScoreJobPhase,
    pub stage: String,
    pub error: Option<String>,
    pub draft: Option<ScoreDraft>,
    pub pdf: Option<PdfDraft>,
    pub prepared_export: Option<ScoreExportResult>,
    pub media_export: Option<MediaExportDraft>,
    pub cancellable: bool,
}
struct Entry {
    status: ScoreJobStatus,
    cancelled: Arc<AtomicBool>,
    touched: Instant,
    worker: Weak<()>,
}
#[derive(Clone, Default)]
pub struct Jobs(Arc<Mutex<BTreeMap<String, Entry>>>);
#[derive(Clone)]
pub struct Token {
    id: String,
    jobs: Jobs,
    cancelled: Arc<AtomicBool>,
    _worker: Arc<()>,
}
impl Token {
    pub fn begin_commit(&self, stage: &str) -> Result<(), String> {
        let mut all = self.jobs.0.lock().map_err(|_| "导出任务状态不可用")?;
        self.check()?;
        let entry = all.get_mut(&self.id).ok_or("导出任务已经结束")?;
        entry.status.cancellable = false;
        entry.status.stage = stage.into();
        entry.touched = Instant::now();
        Ok(())
    }
    pub fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            Err("后台文件任务已取消，已保留的资料可继续使用".into())
        } else {
            Ok(())
        }
    }
    pub fn stage(&self, stage: &str) -> Result<(), String> {
        self.check()?;
        let mut all = self.jobs.0.lock().map_err(|_| "文件任务状态不可用")?;
        let entry = all.get_mut(&self.id).ok_or("文件任务已结束")?;
        if entry.status.phase == ScoreJobPhase::Cancelled {
            return self.check();
        }
        entry.status.phase = ScoreJobPhase::Running;
        entry.status.stage = stage.into();
        entry.touched = Instant::now();
        Ok(())
    }
}
pub struct Guard {
    token: Token,
    done: bool,
}
impl Guard {
    pub fn cancel(mut self) -> Result<ScoreSubmitted, String> {
        let mut all = self.token.jobs.0.lock().map_err(|_| "导出任务状态不可用")?;
        let entry = all.get_mut(&self.token.id).ok_or("导出任务已经结束")?;
        self.token.cancelled.store(true, Ordering::Release);
        entry.status.phase = ScoreJobPhase::Cancelled;
        entry.status.stage = "cancelled".into();
        entry.status.cancellable = false;
        entry.status.error = None;
        entry.touched = Instant::now();
        self.done = true;
        Ok(ScoreSubmitted {
            job_id: self.token.id.clone(),
        })
    }
    pub fn finish_media(
        self,
        result: Result<MediaExportDraft, String>,
    ) -> Result<ScoreSubmitted, String> {
        match self.complete(result.map(Completed::Media), true)? {
            ConversionReply::Submitted(value) => Ok(value),
            _ => Err("文件导出任务回执类型无效".into()),
        }
    }
    pub fn token(&self) -> Token {
        self.token.clone()
    }
    pub fn finish(
        self,
        result: Result<ScoreDraft, String>,
        tracked: bool,
    ) -> Result<ConversionReply, String> {
        self.complete(result.map(Completed::Notation), tracked)
    }
    pub fn finish_pdf(self, result: Result<PdfDraft, String>) -> Result<ScoreSubmitted, String> {
        match self.complete(result.map(Completed::Pdf), true)? {
            ConversionReply::Submitted(reply) => Ok(reply),
            _ => Err("PDF 任务回执类型无效".into()),
        }
    }
    pub fn finish_export(
        self,
        result: Result<ScoreExportResult, String>,
    ) -> Result<ScoreSubmitted, String> {
        match self.complete(result.map(Completed::Export), true)? {
            ConversionReply::Submitted(reply) => Ok(reply),
            _ => Err("个人标记谱任务回执类型无效".into()),
        }
    }
    fn complete(
        mut self,
        result: Result<Completed, String>,
        tracked: bool,
    ) -> Result<ConversionReply, String> {
        let result = result.and_then(|draft| {
            self.token.check()?;
            let valid = match &draft {
                Completed::Notation(draft) => {
                    !draft.bytes.is_empty()
                        && draft.bytes.len() <= 4_000_000
                        && !draft.name.trim().is_empty()
                }
                Completed::Pdf(draft) => {
                    (100..=48_000_000).contains(&draft.size) && !draft.name.trim().is_empty()
                }
                Completed::Export(result) => match (&result.prepared, &result.preview) {
                    (Some(draft), None) => {
                        (1..=64_000_000).contains(&draft.size) && !draft.name.trim().is_empty()
                    }
                    (None, Some(preview)) => {
                        !preview.name.trim().is_empty() && !preview.fingerprint.is_empty()
                    }
                    _ => false,
                },
                Completed::Media(draft) => {
                    (1..=draft.kind.maximum()).contains(&draft.size)
                        && !draft.name.trim().is_empty()
                }
            };
            if !valid {
                return Err("文件任务回执不完整，请重新制作".into());
            }
            Ok(draft)
        });
        let mut all = self.token.jobs.0.lock().map_err(|_| "文件任务状态不可用")?;
        let entry = all.get_mut(&self.token.id).ok_or("文件任务记录已结束")?;
        self.token.check()?;
        entry.status.cancellable = false;
        entry.touched = Instant::now();
        let reply = match result {
            Ok(draft) => {
                let reply = if tracked {
                    ConversionReply::Submitted(ScoreSubmitted {
                        job_id: self.token.id.clone(),
                    })
                } else {
                    match &draft {
                        Completed::Notation(draft) => ConversionReply::Draft(draft.clone()),
                        Completed::Pdf(_) | Completed::Export(_) | Completed::Media(_) => {
                            return Err("导出任务需要使用持续请求入口".into());
                        }
                    }
                };
                entry.status.phase = ScoreJobPhase::Ready;
                entry.status.stage = "ready".into();
                match draft {
                    Completed::Notation(draft) => entry.status.draft = Some(draft),
                    Completed::Pdf(draft) => entry.status.pdf = Some(draft),
                    Completed::Export(draft) => entry.status.prepared_export = Some(draft),
                    Completed::Media(draft) => entry.status.media_export = Some(draft),
                }
                Ok(reply)
            }
            Err(error) => {
                entry.status.phase = ScoreJobPhase::Error;
                entry.status.error = Some(error.clone());
                Err(error)
            }
        };
        self.done = true;
        reply
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        if let Ok(mut all) = self.token.jobs.0.lock() {
            if let Some(entry) = all.get_mut(&self.token.id) {
                if matches!(
                    entry.status.phase,
                    ScoreJobPhase::Preparing | ScoreJobPhase::Running
                ) {
                    if entry.status.cancellable {
                        self.token.cancelled.store(true, Ordering::Release);
                        entry.status.phase = ScoreJobPhase::Cancelled;
                        entry.status.cancellable = false;
                        entry.status.error = Some("文件任务已结束，已保留的成品仍可读取".into());
                    } else {
                        entry.status.phase = ScoreJobPhase::Error;
                        entry.status.error = Some("保存已经开始，结果尚未确认。请从导出缓存核对原保存位置，避免重复制作。".into());
                    }
                }
            }
        }
    }
}
impl Jobs {
    fn room(all: &mut BTreeMap<String, Entry>) -> Result<(), String> {
        while all.len() >= 16 {
            let oldest = all
                .iter()
                .filter(|(_, entry)| {
                    !matches!(
                        entry.status.phase,
                        ScoreJobPhase::Preparing | ScoreJobPhase::Running
                    ) && entry.worker.strong_count() == 0
                        && !entry
                            .status
                            .draft
                            .as_ref()
                            .is_some_and(|draft| !draft.cached && draft.saved.is_none())
                        && !(entry.status.phase == ScoreJobPhase::Cancelled
                            && entry.touched.elapsed() < Duration::from_secs(60))
                })
                .min_by_key(|(_, entry)| entry.touched)
                .map(|(id, _)| id.clone())
                .ok_or("文件任务记录较多，请先另存保留的初稿，或等待当前任务结束后继续")?;
            all.remove(&oldest);
        }
        Ok(())
    }
    fn validate(
        request: &ScoreJobRequest,
        engine: &panthesia_engine::Engine,
    ) -> Result<(), String> {
        engine.check_engine(&request.engine_id)?;
        if !(8..=96).contains(&request.id.len())
            || !request
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err("文件任务编号无效".into());
        }
        if request.content_id.is_empty() || request.content_id.len() > 256 {
            return Err("文件任务缺少曲目身份".into());
        }
        Ok(())
    }
    pub fn begin(
        &self,
        request: Option<ScoreJobRequest>,
        kind: ScoreJobKind,
        content_id: &str,
        engine: &panthesia_engine::Engine,
    ) -> Result<Guard, String> {
        self.begin_policy(request, kind, content_id, engine, true)
    }
    pub fn begin_export_save(
        &self,
        request: ScoreJobRequest,
        content_id: &str,
        engine: &panthesia_engine::Engine,
    ) -> Result<Guard, String> {
        self.begin_policy(
            Some(request),
            ScoreJobKind::MediaSave,
            content_id,
            engine,
            false,
        )
    }
    fn begin_policy(
        &self,
        request: Option<ScoreJobRequest>,
        kind: ScoreJobKind,
        content_id: &str,
        engine: &panthesia_engine::Engine,
        require_current: bool,
    ) -> Result<Guard, String> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let state = engine.snapshot();
        let engine_id = state
            .state_order
            .as_ref()
            .map(|order| order.engine_id.clone())
            .ok_or("练习室尚未准备完成")?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let request = request.unwrap_or_else(|| ScoreJobRequest {
            id: format!("legacy-{}", NEXT.fetch_add(1, Ordering::Relaxed)),
            engine_id,
            content_id: content_id.into(),
            kind,
            created_at_ms: now,
        });
        Self::validate(&request, engine)?;
        if request.kind != kind
            || request.content_id != content_id
            || (require_current && state.content_id.as_deref() != Some(content_id))
        {
            return Err("曲目或文件任务已改变，请重新打开对应窗口".into());
        }
        let mut all = self.0.lock().map_err(|_| "文件任务状态不可用")?;
        if let Some(entry) = all.get(&request.id) {
            return Err(if entry.status.phase == ScoreJobPhase::Cancelled {
                "后台任务已取消，请重新生成"
            } else {
                "文件任务已经开始，请继续读取原请求"
            }
            .into());
        }
        if now.abs_diff(request.created_at_ms) > 30_000 {
            return Err("文件任务请求已过期，请重新生成".into());
        }
        if let Some(entry) = all.values().find(|entry| entry.worker.strong_count() > 0) {
            return Err(if entry.status.stage == "cancelledChoosingExportTarget" {
                "上次文件选择窗口尚未关闭，请先取消或关闭该窗口。"
            } else {
                "已有文件任务正在处理，请完成或取消后继续。"
            }
            .into());
        }
        Self::room(&mut all)?;
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker = Arc::new(());
        let token = Token {
            id: request.id.clone(),
            jobs: self.clone(),
            cancelled: cancelled.clone(),
            _worker: worker.clone(),
        };
        all.insert(
            request.id.clone(),
            Entry {
                status: ScoreJobStatus {
                    request,
                    phase: ScoreJobPhase::Preparing,
                    stage: "preparing".into(),
                    error: None,
                    draft: None,
                    pdf: None,
                    prepared_export: None,
                    media_export: None,
                    cancellable: true,
                },
                cancelled,
                touched: Instant::now(),
                worker: Arc::downgrade(&worker),
            },
        );
        Ok(Guard { token, done: false })
    }
    pub fn read(
        &self,
        request: &ScoreJobRequest,
        engine: &panthesia_engine::Engine,
    ) -> Result<Option<ScoreJobStatus>, String> {
        Self::validate(request, engine)?;
        let all = self.0.lock().map_err(|_| "文件任务状态不可用")?;
        let Some(entry) = all.get(&request.id) else {
            return Ok(None);
        };
        if entry.status.request.engine_id != request.engine_id
            || entry.status.request.content_id != request.content_id
            || entry.status.request.kind != request.kind
        {
            return Err("文件任务来源不一致".into());
        }
        Ok(Some(entry.status.clone()))
    }
    pub fn cancel(
        &self,
        request: ScoreJobRequest,
        engine: &panthesia_engine::Engine,
    ) -> Result<ScoreJobStatus, String> {
        Self::validate(&request, engine)?;
        let mut all = self.0.lock().map_err(|_| "文件任务状态不可用")?;
        if let Some(entry) = all.get_mut(&request.id) {
            if entry.status.request.engine_id != request.engine_id
                || entry.status.request.content_id != request.content_id
                || entry.status.request.kind != request.kind
            {
                return Err("文件任务来源不一致".into());
            }
            if entry.status.cancellable
                && matches!(
                    entry.status.phase,
                    ScoreJobPhase::Preparing | ScoreJobPhase::Running
                )
            {
                entry.cancelled.store(true, Ordering::Release);
                entry.status.phase = ScoreJobPhase::Cancelled;
                entry.status.stage = if entry.status.stage == "choosingExportTarget" {
                    "cancelledChoosingExportTarget"
                } else {
                    "cancelled"
                }
                .into();
                entry.status.cancellable = false;
                entry.status.error = None;
                entry.touched = Instant::now();
            }
            return Ok(entry.status.clone());
        }
        Self::room(&mut all)?;
        let status = ScoreJobStatus {
            request,
            phase: ScoreJobPhase::Cancelled,
            stage: "cancelled".into(),
            error: None,
            draft: None,
            pdf: None,
            prepared_export: None,
            media_export: None,
            cancellable: false,
        };
        all.insert(
            status.request.id.clone(),
            Entry {
                status: status.clone(),
                cancelled: Arc::new(AtomicBool::new(true)),
                touched: Instant::now(),
                worker: Weak::new(),
            },
        );
        Ok(status)
    }
    pub fn remember_saved(&self, preview_token: &str, saved: &DraftSaved) {
        if let Ok(mut all) = self.0.lock() {
            for entry in all.values_mut() {
                if let Some(draft) = entry
                    .status
                    .draft
                    .as_mut()
                    .filter(|draft| draft.preview_token == preview_token)
                {
                    draft.saved = Some(saved.clone());
                    entry.touched = Instant::now();
                }
            }
        }
    }
}
#[tauri::command]
pub fn read_score_job(
    state: tauri::State<'_, crate::State>,
    request: ScoreJobRequest,
) -> Result<Option<ScoreJobStatus>, String> {
    state.score_jobs.read(&request, &state.engine)
}
#[tauri::command]
pub fn score_job_protocol() -> u8 {
    4
}
#[tauri::command]
pub fn cancel_score_job(
    state: tauri::State<'_, crate::State>,
    request: ScoreJobRequest,
) -> Result<ScoreJobStatus, String> {
    state.score_jobs.cancel(request, &state.engine)
}
