//! Bind actions to the history conditions and recording actually shown to the user.
use crate::{Player, history_actions, history_loading};
use serde::{Deserialize, Serialize};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistorySource {
    pub content_id: String,
    pub id: String,
    pub conditions_revision: String,
    #[serde(default)]
    pub performance_revision: Option<String>,
}
impl HistorySource {
    pub(crate) fn from_context(
        context: &history_loading::Context,
        performance: Option<String>,
    ) -> Self {
        Self {
            content_id: context.content_id.clone(),
            id: context.id.clone(),
            conditions_revision: context.fingerprint.clone(),
            performance_revision: performance,
        }
    }
    pub(crate) fn validate(&self) -> Result<(), String> {
        let revision =
            |value: &str| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit());
        if self.content_id.is_empty()
            || self.content_id.len() > 160
            || self.id.is_empty()
            || self.id.len() > 512
            || !revision(&self.conditions_revision)
            || self
                .performance_revision
                .as_deref()
                .is_some_and(|value| !revision(value))
        {
            return Err(
                "history-source-invalid:历史操作的来源信息不完整，请重新读取原记录。".into(),
            );
        }
        Ok(())
    }
    pub(crate) fn check_context(&self, context: &history_loading::Context) -> Result<(), String> {
        self.validate()?;
        if self.content_id != context.content_id
            || self.id != context.id
            || self.conditions_revision != context.fingerprint
        {
            return Err(
                "history-source-changed:这条演奏的练习条件或文件位置已更新，请重新读取后继续。"
                    .into(),
            );
        }
        Ok(())
    }
    pub(crate) fn check_performance(&self, revision: &str) -> Result<(), String> {
        if self
            .performance_revision
            .as_deref()
            .is_some_and(|expected| expected != revision)
        {
            return Err("history-performance-changed:这次演奏的回放资料已更新，请重新读取后选择片段或参考音。".into());
        }
        Ok(())
    }
    pub(crate) fn require_performance(&self) -> Result<(), String> {
        self.validate()?;
        if self.performance_revision.is_none() {
            return Err("history-source-invalid:请先读取这次演奏，再选择回放或重练范围。".into());
        }
        Ok(())
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum HistoryActionKind {
    Open {
        restore: bool,
    },
    ScoreReview,
    PracticeRange {
        reference: usize,
        before: u8,
        after: u8,
    },
}
impl HistoryActionKind {
    pub(crate) fn action(&self) -> history_actions::Action {
        match self {
            Self::Open { restore } => history_actions::Action::Open { restore: *restore },
            Self::ScoreReview => history_actions::Action::ScoreReview,
            Self::PracticeRange {
                reference,
                before,
                after,
            } => history_actions::Action::PracticeRange {
                reference: *reference,
                before: *before,
                after: *after,
            },
        }
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryActionRequest {
    pub source: HistorySource,
    pub action: HistoryActionKind,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryPrepared {
    pub source: HistorySource,
    pub content_id: String,
    pub score_revision: u64,
}
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaySelection {
    pub start: f64,
    pub end: f64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplaySound {
    Actual,
    Reference,
}
impl ReplaySound {
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::Actual => "actual",
            Self::Reference => "reference",
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryReplayRequest {
    pub source: HistorySource,
    pub sound: ReplaySound,
    pub rate: f64,
    #[serde(default)]
    pub selection: Option<ReplaySelection>,
    pub request_id: String,
}
impl Player {
    pub(super) fn read_history_detail(
        &self,
        content_id: &str,
        id: &str,
    ) -> Result<serde_json::Value, String> {
        let mut value = self.history_detail(content_id, id)?;
        value["source"] = serde_json::to_value(self.history_source(content_id, id)?)
            .map_err(|error| error.to_string())?;
        Ok(value)
    }
    pub(super) fn read_history_performance(
        &self,
        content_id: &str,
        id: &str,
    ) -> Result<serde_json::Value, String> {
        let context = self.prepare_history_open(content_id, id, false)?;
        Ok(history_actions::Read::prepare_checked(&self.data, &context, || Ok(()), true)?.value)
    }
    pub(super) fn history_source(
        &self,
        content_id: &str,
        id: &str,
    ) -> Result<HistorySource, String> {
        Ok(HistorySource::from_context(
            &self.prepare_history_open(content_id, id, false)?,
            None,
        ))
    }
}
