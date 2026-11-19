//! Lightweight identities for browsing; notation files and playback state are not read.
use crate::repertoire::RepertoireRegistry;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPerformance {
    pub content_id: String,
    pub work_id: String,
    pub title: String,
    pub composer: String,
    pub label: String,
    pub notation_count: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongCatalog {
    pub revision: String,
    pub performances: Vec<CatalogPerformance>,
}
impl SongCatalog {
    pub fn from_registry(registry: &RepertoireRegistry, revision: String) -> Self {
        let mut counts = HashMap::new();
        for notation in registry.notations.values().filter(|n| n.registered) {
            *counts.entry(&notation.performance_id).or_insert(0usize) += 1;
        }
        let performances = registry
            .performances
            .values()
            .filter_map(|performance| {
                let work = registry.works.get(&performance.work_id)?;
                Some(CatalogPerformance {
                    content_id: performance.content_id.clone(),
                    work_id: work.id.clone(),
                    title: work.title.clone(),
                    composer: work.composer.clone(),
                    label: performance.label.clone(),
                    notation_count: counts.get(&performance.content_id).copied().unwrap_or(0),
                })
            })
            .collect();
        Self {
            revision,
            performances,
        }
    }
}
