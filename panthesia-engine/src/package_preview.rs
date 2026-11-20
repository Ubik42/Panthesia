//! Compact package preview shared by HTTP, desktop and the import workbench.
use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackagePreviewRequest {
    pub engine_id: String,
    pub token: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePaperPreview {
    pub name: String,
    pub format: String,
    pub pages: usize,
    pub mapping_points: usize,
    pub auto_turn: bool,
    pub annotations: usize,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageTrackPreview {
    pub id: usize,
    pub name: String,
    pub color: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct PackageMetadataPreview {
    pub composer: Option<String>,
    pub notes: Option<String>,
    pub tags: Vec<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageProvenancePreview {
    pub source: Option<String>,
    pub license: Option<String>,
    pub source_url: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePerformancePreview {
    pub content_id: String,
    pub label: String,
    pub title: String,
    pub scores: usize,
    pub papers: usize,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePreview {
    #[serde(default)]
    pub performances: Vec<PackagePerformancePreview>,
    pub token: String,
    pub engine_id: String,
    pub file_name: Option<String>,
    pub papers: Vec<PackagePaperPreview>,
    pub ladders: Vec<String>,
    pub title: String,
    pub content_id: String,
    pub metadata: PackageMetadataPreview,
    pub scores: Vec<String>,
    pub fingerings: usize,
    pub finger_actions: usize,
    pub track_sounds: usize,
    pub track_appearances: Vec<PackageTrackPreview>,
    pub hands: usize,
    #[serde(default)]
    pub note_playback: usize,
    pub passages: Vec<String>,
    #[serde(default)]
    pub bookmarks: Vec<String>,
    pub groups: Vec<Vec<String>>,
    pub rating: u8,
    pub existing: bool,
    pub provenance: Option<PackageProvenancePreview>,
}
impl PackagePreview {
    pub(crate) fn from_summary(
        mut summary: serde_json::Value,
        engine_id: String,
        token: String,
    ) -> Result<Self, String> {
        summary["engineId"] = serde_json::json!(engine_id);
        summary["token"] = serde_json::json!(token);
        summary["fileName"] = serde_json::Value::Null;
        // Older packages may contain free-form provenance. Keep the original archive intact.
        let provenance = &summary["provenance"];
        let known = provenance.is_object().then(|| PackageProvenancePreview {
            source: provenance["source"].as_str().map(str::to_owned),
            license: provenance["license"].as_str().map(str::to_owned),
            source_url: provenance["sourceUrl"].as_str().map(str::to_owned),
        });
        summary["provenance"] = serde_json::to_value(known).map_err(|error| error.to_string())?;
        serde_json::from_value(summary).map_err(|error| format!("曲目包预览结果不完整：{error}"))
    }
}
