//! Source descriptions and field-level personal choices. No filesystem or UI dependencies.
use crate::library::SongMetadata;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const FIELDS: &[&str] = &[
    "title", "subtitle", "arranger", "copyright", "license", "composer",
    "artist", "collection", "difficulty", "tags", "notes",
];

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataLayers {
    pub source_format: String,
    pub source_id: String,
    pub defaults: SongMetadata,
    pub overridden: BTreeSet<String>,
}

impl MetadataLayers {
    pub fn validate(&self) -> Result<(), String> {
        if self.source_format != "synthesia" || self.source_id.len() != 64
            || !self.source_id.bytes().all(|b| b.is_ascii_hexdigit())
            || self.overridden.iter().any(|field| !FIELDS.contains(&field.as_str())) {
            return Err("资料来源或个人覆盖字段无效".into());
        }
        Ok(())
    }

    pub fn resolve(&self, personal: &SongMetadata) -> SongMetadata {
        let mut value = self.defaults.clone();
        for field in &self.overridden { copy_field(&mut value, personal, field); }
        value.normalized()
    }

    /// Existing non-empty descriptions have unknown provenance; preserve them as personal.
    pub fn import(current: &SongMetadata, previous: Option<&Self>, incoming: SongMetadata,
        source_id: String, replace_fields: &[String]) -> Self {
        let mut overridden = previous.map(|layers| layers.overridden.clone()).unwrap_or_else(|| {
            FIELDS.iter().filter(|field| nonempty(current, field)).map(|field| (*field).to_owned()).collect()
        });
        for field in replace_fields { overridden.remove(field); }
        Self { source_format: "synthesia".into(), source_id, defaults: incoming.normalized(), overridden }
    }

    pub fn personal_edit(&mut self, before: &SongMetadata, after: &SongMetadata) {
        for field in FIELDS {
            if different(before, after, field) { self.overridden.insert((*field).into()); }
        }
    }

    pub fn reset(&mut self, fields: &[String]) -> Result<(), String> {
        if fields.is_empty() || fields.len() > FIELDS.len()
            || fields.iter().any(|field| !FIELDS.contains(&field.as_str())) {
            return Err("请选择有效的来源资料字段".into());
        }
        for field in fields { self.overridden.remove(field); }
        Ok(())
    }
}

pub fn copy_field(target: &mut SongMetadata, source: &SongMetadata, field: &str) {
    match field {
        "title" => target.title = source.title.clone(),
        "subtitle" => target.subtitle = source.subtitle.clone(),
        "arranger" => target.arranger = source.arranger.clone(),
        "copyright" => target.copyright = source.copyright.clone(),
        "license" => target.license = source.license.clone(),
        "composer" => target.composer = source.composer.clone(),
        "artist" => target.artist = source.artist.clone(),
        "collection" => target.collection = source.collection.clone(),
        "difficulty" => target.difficulty = source.difficulty.clone(),
        "tags" => target.tags = source.tags.clone(),
        "notes" => target.notes = source.notes.clone(),
        _ => {}
    }
}
pub fn different(before: &SongMetadata, after: &SongMetadata, field: &str) -> bool {
    let mut a = SongMetadata::default(); let mut b = SongMetadata::default();
    copy_field(&mut a, before, field); copy_field(&mut b, after, field); a != b
}
fn nonempty(value: &SongMetadata, field: &str) -> bool {
    different(value, &SongMetadata::default(), field)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn updates_follow_source_except_personal_values_and_explicit_empty_choices() {
        let old = SongMetadata { title: Some("个人曲名".into()), ..Default::default() };
        let incoming = SongMetadata { title: Some("来源曲名".into()), subtitle: Some("第一版".into()), tags: vec!["入门".into()], ..Default::default() };
        let first = MetadataLayers::import(&old, None, incoming, "a".repeat(64), &[]);
        let before = first.resolve(&old);
        assert_eq!(before.title, old.title);
        let mut edited = before.clone(); edited.tags.clear();
        let mut personal = first; personal.personal_edit(&before, &edited);
        let incoming = SongMetadata { title: Some("新版来源".into()), subtitle: Some("第二版".into()), tags: vec!["新版标签".into()], ..Default::default() };
        let mut updated = MetadataLayers::import(&edited, Some(&personal), incoming, "b".repeat(64), &[]);
        let value = updated.resolve(&edited);
        assert_eq!(value.title, old.title); assert_eq!(value.subtitle.as_deref(), Some("第二版")); assert!(value.tags.is_empty());
        updated.reset(&["title".into(), "tags".into()]).unwrap();
        let reset = updated.resolve(&value);
        assert_eq!(reset.title.as_deref(), Some("新版来源")); assert_eq!(reset.tags, ["新版标签"]);
        assert!(!updated.overridden.contains("tags"));
        assert!(updated.reset(&["bad".into()]).is_err());
    }
}
