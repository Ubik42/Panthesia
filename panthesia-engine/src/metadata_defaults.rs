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
    snapshot(&value, cid)
}
fn snapshot(value: &SongSidecar, cid: &str) -> Result<MetadataDefaultsView, String> {
    let proof = blake3::hash(&serde_json::to_vec(&(cid, &value.metadata, &value.metadata_layers)).map_err(|e|e.to_string())?).to_hex().to_string();
    Ok(MetadataDefaultsView { content_id: cid.into(), value: value.metadata.clone(), layers: value.metadata_layers.clone(), proof })
}
pub fn reset(data: &Path, path: &Path, cid: &str, fields: Vec<String>, expected: SongMetadata, proof: &str) -> Result<serde_json::Value, String> {
    let history_path=path;
    let owned=crate::owned_annotations::retain(data,path,cid,&||Ok(()))?;
    let path=owned.as_path();
    let mut value = sidecar(path, cid)?;
    let observed = snapshot(&value, cid)?;
    if observed.proof != proof || observed.value != expected {
        return Ok(serde_json::json!({"status":"conflict","contentId":cid,"current":observed.value}));
    }
    let layers = value.metadata_layers.as_mut().ok_or("这首曲目尚未导入来源默认资料")?;
    layers.reset(&fields)?;
    value.metadata = layers.resolve(&value.metadata);
    let history = if value.metadata != expected {
        Some(crate::metadata_history::prepare(data, history_path, cid, expected, value.metadata.clone(), None)?)
    } else { None };
    if let Err(error) = library::save_song_sidecar(path, cid, value.clone()) {
        if let Some(id) = &history { let _ = crate::metadata_history::finish(data, history_path, id, false); }
        return Err(error.to_string());
    }
    let mut warnings = Vec::<String>::new();
    if let Some(id) = history {
        if let Err(error) = crate::metadata_history::finish(data, history_path, &id, true) {
            warnings.push(format!("资料已恢复，历史写入状态尚未确认：{error}"));
        }
    }
    Ok(serde_json::json!({"status":"saved","contentId":cid,"value":value.metadata,"warnings":warnings}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use panthesia_core::{library::FingerHint, metadata_layers::MetadataLayers};
    #[test]
    fn reset_checks_origin_proof_preserves_other_fields_and_fingerings() {
        let root = std::env::temp_dir().join(format!("panthesia-defaults-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("exercise.mid");
        let cid = "a".repeat(64);
        let defaults = SongMetadata {title:Some("来源标题".into()),tags:vec!["来源标签".into()],..Default::default()};
        let mut personal = SongMetadata {title:Some("个人标题".into()),..Default::default()};
        let mut layers = MetadataLayers::import(&personal, None, defaults, "b".repeat(64), &[]);
        let before = layers.resolve(&personal);
        layers.personal_edit(&before, &personal); // An explicitly cleared tag list remains a personal choice.
        let mut sidecar = SongSidecar { metadata:personal.clone(), metadata_layers:Some(layers),
            fingerings:vec![FingerHint{track_id:0,note_index:0,finger:2}], ..Default::default() };
        library::save_song_sidecar(&path, &cid, sidecar.clone()).unwrap();
        let first = view(&path, &cid).unwrap();
        sidecar.metadata_layers.as_mut().unwrap().source_id = "c".repeat(64); // Same values, new source.
        library::save_song_sidecar(&path, &cid, sidecar.clone()).unwrap();
        let stale = reset(&root, &path, &cid, vec!["title".into()], personal.clone(), &first.proof).unwrap();
        assert_eq!(stale["status"], "conflict");
        let current = view(&path, &cid).unwrap();
        assert!(reset(&root, &path, &cid, vec!["title".into(),"title".into()], personal.clone(), &current.proof).is_err());
        let result = reset(&root, &path, &cid, vec!["title".into()], personal.clone(), &current.proof).unwrap();
        assert_eq!(result["status"], "saved");
        let restored = library::load_song_sidecar(&path, &cid).unwrap();
        assert_eq!(restored.metadata.title.as_deref(), Some("来源标题"));
        assert!(restored.metadata.tags.is_empty());
        assert_eq!(restored.fingerings, sidecar.fingerings);
        let mut layers = restored.metadata_layers.unwrap();
        assert!(!layers.overridden.contains("title"));
        assert!(layers.overridden.contains("tags"));
        personal = restored.metadata;
        let before = personal.clone();
        personal.title = None;
        layers.personal_edit(&before, &personal);
        let updated = MetadataLayers::import(&personal, Some(&layers), SongMetadata {
            title:Some("来源再次更新".into()), tags:vec!["更新标签".into()],..Default::default()
        }, "d".repeat(64), &[]);
        assert_eq!(updated.resolve(&personal).title, None);
        assert!(updated.resolve(&personal).tags.is_empty());
    }
}
