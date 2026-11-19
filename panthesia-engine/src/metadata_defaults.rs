//! Description origin read/reset operations; publication uses existing edit transactions.
use panthesia_core::library::{self, SongMetadata, SongSidecar};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataDefaultsView {
    pub content_id: String,
    pub value: SongMetadata,
    pub layers: Option<panthesia_core::metadata_layers::MetadataLayers>,
    pub proof: String,
}
fn sidecar(path: &Path, cid: &str) -> Result<SongSidecar, String> {
    match library::load_song_sidecar(path, cid) {
        Ok(value) => Ok(value),
        Err(library::MetadataError::Read(e)) if e.kind() == std::io::ErrorKind::NotFound => Ok(SongSidecar::default()),
        Err(e) => Err(e.to_string()),
    }
}
pub fn view(path: &Path, cid: &str) -> Result<MetadataDefaultsView, String> {
    let value = sidecar(path, cid)?;
    let proof = blake3::hash(&serde_json::to_vec(&(cid, &value.metadata, &value.metadata_layers)).map_err(|e|e.to_string())?).to_hex().to_string();
    Ok(MetadataDefaultsView { content_id: cid.into(), value: value.metadata, layers: value.metadata_layers, proof })
}
pub fn reset(data: &Path, path: &Path, cid: &str, fields: Vec<String>, expected: SongMetadata, proof: &str) -> Result<serde_json::Value, String> {
    let observed = view(path, cid)?;
    if observed.proof != proof || observed.value != expected {
        return Ok(serde_json::json!({"status":"conflict","contentId":cid,"current":observed.value}));
    }
    let mut value = sidecar(path, cid)?;
    let layers = value.metadata_layers.as_mut().ok_or("这首曲目尚未导入来源默认资料")?;
    layers.reset(&fields)?;
    value.metadata = layers.resolve(&value.metadata);
    let history = if value.metadata != expected {
        Some(crate::metadata_history::prepare(data, path, cid, expected, value.metadata.clone(), None)?)
    } else { None };
    library::save_song_sidecar(path, cid, value.clone()).map_err(|e|e.to_string())?;
    if let Some(id) = history { crate::metadata_history::finish(data, path, &id, true)?; }
    Ok(serde_json::json!({"status":"saved","contentId":cid,"value":value.metadata,"warnings":[]}))
}
