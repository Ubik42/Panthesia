use crate::{Player, notation::ScoreAsset};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreReviewExpectation {
    pub content_id: String,
    pub fingerprint: String,
    pub score_revision: u64,
}
impl Player {
    pub(super) fn score_review(&self, score: &ScoreAsset) -> ScoreReviewExpectation {
        ScoreReviewExpectation {
            content_id: score.content_id.clone(),
            fingerprint: score.source_fingerprint.clone(),
            score_revision: self.score_revision,
        }
    }
    pub(super) fn check_score_review(
        &self,
        score: &ScoreAsset,
        expected: Option<&ScoreReviewExpectation>,
    ) -> Result<(), String> {
        let Some(expected) = expected else {
            return Ok(());
        };
        if expected.content_id != score.content_id
            || expected.fingerprint != score.source_fingerprint
            || expected.score_revision != self.score_revision
        {
            return Err("谱面或练习条件已改变，请重新预览演奏顺序后使用。原初稿继续保留。".into());
        }
        let route = score.route_payload(self.file.as_deref());
        if route["route"]["complete"].as_bool() != Some(true) {
            return Err("这份谱面的演奏顺序尚未确认，可以先保存版本，核对后再使用。".into());
        }
        Ok(())
    }
}
