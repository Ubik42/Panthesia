//! Reading preferences use the storage lane without stopping a musical session.
use crate::*;
impl Engine {
    pub(super) fn read_paper_view(
        &self,
        content_id: String,
        book: String,
    ) -> Result<serde_json::Value, String> {
        let engine = self.clone();
        self.tasks.run(
            "读取谱页阅读位置",
            Some(content_id.clone()),
            move |token| {
                token.stage("readingScore")?;
                let lock = data_locks::lock_for(&engine.data)?;
                let _guard = data_locks::wait_for(&lock, &|| token.check())?;
                let state = score_attachments::read_view_locked(&engine.data, &content_id, &book)?;
                token.check()?;
                serde_json::to_value(state).map_err(|e| e.to_string())
            },
        )
    }
    pub(super) fn save_paper_view(
        &self,
        content_id: String,
        book: String,
        view: score_attachments::View,
        expected: Option<score_attachments::View>,
        legacy: bool,
    ) -> Result<serde_json::Value, String> {
        let operation = self.pending_operation()?;
        let engine = self.clone();
        self.storage_tasks.run(
            "保存谱页阅读位置",
            Some(content_id.clone()),
            move |token| {
                let _operation = operation;
                token.stage("readingScore")?;
                engine.pending_saves.flush()?;
                let lock = data_locks::lock_for(&engine.data)?;
                let guard = data_locks::wait_for(&lock, &|| token.check())?;
                if storage_control::recovery_pending(&engine.data) {
                    return Err("练习资料尚待恢复，阅读位置仍可暂存，请恢复后重试保存".into());
                }
                let saved = score_attachments::save_view_locked(
                    &engine.data,
                    &content_id,
                    &book,
                    view,
                    expected.as_ref(),
                    || token.begin_commit(),
                )?;
                drop(guard);
                if legacy {
                    score_attachments::list(&engine.data, &content_id)
                } else {
                    serde_json::to_value(saved).map_err(|e| e.to_string())
                }
            },
        )
    }
}
