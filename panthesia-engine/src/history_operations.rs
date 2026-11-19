//! History-specific source and destination contract; journal ownership is shared.
use crate::{
    Engine,
    history_source::{HistoryActionRequest, HistoryPrepared},
};
use serde::{Deserialize, Serialize};
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryOperationRequest {
    pub engine_id: String,
    pub id: String,
    pub created_at_ms: u64,
    pub operation: HistoryActionRequest,
    pub origin: HistoryOperationOrigin,
    #[serde(default)]
    pub measure: Option<usize>,
}
pub type HistoryOperationOrigin = crate::operation_journal::PreparationOrigin;
pub type HistoryOperationPhase = crate::operation_journal::PreparationPhase;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryOperationResult {
    pub history_prepared: HistoryPrepared,
    pub restore_warning: Option<String>,
    pub score_review: Option<crate::history_review::HistoryScoreReview>,
    pub score_focus: Option<crate::history_review::HistoryScoreTarget>,
    pub paper_focus: Option<crate::history_review::HistoryPaperTarget>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryOperationReceipt {
    pub request: HistoryOperationRequest,
    pub phase: HistoryOperationPhase,
    pub stage: String,
    pub task_id: Option<String>,
    pub result: Option<HistoryOperationResult>,
    #[serde(default)]
    pub has_result: bool,
    pub error: Option<String>,
    pub warning: Option<String>,
    pub cancellable: bool,
}
pub(crate) type Store = crate::operation_journal::Store<HistoryOperationRequest>;
crate::operation_journal::receipt_wire!(HistoryOperationRequest, HistoryOperationReceipt);
impl crate::operation_journal::Operation for HistoryOperationRequest {
    type Output = HistoryOperationResult;
    const FOLDER: &'static str = "history-operation-results";
    fn id(&self) -> &str {
        &self.id
    }
    fn engine_id(&self) -> &str {
        &self.engine_id
    }
    fn created_at_ms(&self) -> u64 {
        self.created_at_ms
    }
    fn label(&self) -> &'static str {
        self.operation.action.action().label()
    }
    fn validate(&self) -> Result<(), String> {
        self.operation.source.validate()?;
        if self.measure.is_some_and(|measure| measure == 0)
            || self.measure.is_some()
                && !matches!(
                    self.operation.action,
                    crate::history_source::HistoryActionKind::Open { .. }
                )
        {
            return Err("历史小节定位只适用于打开原曲目，请重新选择".into());
        }
        if matches!(
            self.operation.action,
            crate::history_source::HistoryActionKind::PracticeRange { .. }
        ) {
            self.operation.source.require_performance()?;
        }
        Ok(())
    }
    fn run(
        self,
        engine: &Engine,
        token: crate::background_tasks::TaskToken,
    ) -> Result<Self::Output, String> {
        token.check()?;
        token.source(
            self.operation.source.content_id.clone(),
            blake3::hash(
                &serde_json::to_vec(&self.operation.source).map_err(|error| error.to_string())?,
            )
            .to_hex()
            .to_string(),
        )?;
        let action = self.operation.action.action();
        let (origin, mut context) = engine.capture_history_action(
            self.operation.source.content_id.clone(),
            self.operation.source.id.clone(),
            action,
            Some(self.operation.source),
            Some(self.origin),
        )?;
        context.focus_measure = self.measure;
        serde_json::from_value(engine.commit_song_switch(
            origin,
            crate::song_switch::Input::History(context),
            token,
        )?)
        .map_err(|_| "历史练习已处理，结果内容尚未确认，请先核对当前练习".into())
    }
}
impl Engine {
    pub(crate) fn start_history_operation(
        &self,
        request: HistoryOperationRequest,
    ) -> Result<HistoryOperationReceipt, String> {
        self.history_operations.start(self, request).map(Into::into)
    }
    pub(crate) fn read_history_operation(
        &self,
        id: &str,
        metadata_only: bool,
    ) -> Result<Option<HistoryOperationReceipt>, String> {
        self.history_operations
            .read(self, id, metadata_only)
            .map(|receipt| receipt.map(Into::into))
    }
    pub(crate) fn cancel_history_operation(
        &self,
        id: &str,
    ) -> Result<Option<HistoryOperationReceipt>, String> {
        self.history_operations
            .cancel(self, id)
            .map(|receipt| receipt.map(Into::into))
    }
    pub(crate) fn release_history_operation(
        &self,
        id: &str,
    ) -> Result<Option<HistoryOperationReceipt>, String> {
        self.history_operations
            .release(self, id)
            .map(|receipt| receipt.map(Into::into))
    }
}
