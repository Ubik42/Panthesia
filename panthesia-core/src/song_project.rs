//! Derived editions of a song: generated notation and practice transforms.
use crate::practice_transform::Variant;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotationGeneration {
    pub id: String,
    pub generator: String,
    pub generator_identity: String,
    pub source_content_id: String,
    pub input_kind: String,
    pub directory: String,
    pub notes_path: String,
    pub report_path: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeEdition {
    pub id: String,
    pub performance_id: String,
    pub transform: Variant,
}
impl PracticeEdition {
    /// Resolve an immutable snapshot or infer the transform carried by a legacy grid signature.
    pub fn resolve(saved: Option<&Self>, performance_id: &str, grid: &str) -> Result<Self, String> {
        if let Some(saved) = saved {
            let expected = Self::new(performance_id, saved.transform.clone())?;
            if saved != &expected {
                return Err("练习版本身份与当前演奏不一致，请重新核对后保存".into());
            }
            return Ok(expected);
        }
        Self::new(performance_id, Variant::from_grid(grid)?)
    }
    pub fn new(performance_id: &str, transform: Variant) -> Result<Self, String> {
        transform.validate()?;
        let bytes =
            serde_json::to_vec(&(1, performance_id, &transform)).map_err(|e| e.to_string())?;
        Ok(Self {
            id: format!("practice-{}", blake3::hash(&bytes).to_hex()),
            performance_id: performance_id.into(),
            transform,
        })
    }
}
