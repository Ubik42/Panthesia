//! Song identity and derived editions, independent of UI, file parsers and runtime ownership.
use crate::{
    practice_transform::Variant,
    repertoire::{MusicalWork, NotationEdition, PerformanceEdition, RepertoireRegistry},
};
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
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNotation {
    pub edition: NotationEdition,
    pub active: bool,
    pub status: String,
    pub generation: Option<NotationGeneration>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongProject {
    pub work: MusicalWork,
    pub performance: PerformanceEdition,
    pub practice: PracticeEdition,
    pub notations: Vec<ProjectNotation>,
    pub generations: Vec<NotationGeneration>,
    pub issues: Vec<String>,
}
impl SongProject {
    pub fn from_registry(
        registry: &RepertoireRegistry,
        performance_id: &str,
        transform: Variant,
        active: Option<&str>,
    ) -> Result<Self, String> {
        let performance = registry
            .performances
            .get(performance_id)
            .ok_or("演奏版本尚未登记")?
            .clone();
        let work = registry
            .works
            .get(&performance.work_id)
            .ok_or("演奏版本缺少所属歌曲")?
            .clone();
        let notations = registry
            .notations
            .values()
            .filter(|n| n.performance_id == performance_id && n.registered)
            .map(|n| ProjectNotation {
                edition: n.clone(),
                active: active == Some(n.id.as_str()),
                status: "unverified".into(),
                generation: None,
            })
            .collect();
        Ok(Self {
            work,
            performance,
            practice: PracticeEdition::new(performance_id, transform)?,
            notations,
            generations: vec![],
            issues: vec![],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn song_project_shares_performance_identity_and_distinguishes_practice_and_score_editions() {
        let cid = "a".repeat(64);
        let mut registry = RepertoireRegistry::default();
        registry.register(&cid, "练习曲", "作者", Some("first.mid".into()));
        let original = PracticeEdition::new(&cid, Variant::default()).unwrap();
        registry.register(&cid, "练习曲", "作者", Some("moved.mid".into()));
        assert_eq!(
            PracticeEdition::new(&cid, Variant::default()).unwrap().id,
            original.id
        );
        let variant = Variant {
            transpose: 2,
            quantize: 16,
            ..Default::default()
        };
        assert_ne!(
            PracticeEdition::new(&cid, variant.clone()).unwrap().id,
            original.id
        );
        for id in ["first", "second"] {
            registry.notations.insert(
                id.into(),
                NotationEdition {
                    id: id.into(),
                    content_id: "b".repeat(64),
                    performance_id: cid.clone(),
                    version_id: id.into(),
                    name: id.into(),
                    path: format!("{id}.musicxml"),
                    quality: crate::repertoire::ScoreQuality::AutomaticDraft,
                    source: "DuET".into(),
                    registered: true,
                },
            );
        }
        let project = SongProject::from_registry(&registry, &cid, variant, Some("second")).unwrap();
        assert_eq!(project.performance.locations.len(), 2);
        assert_eq!(project.notations.iter().filter(|n| n.active).count(), 1);
        assert_eq!(
            project
                .notations
                .iter()
                .find(|n| n.active)
                .unwrap()
                .edition
                .id,
            "second"
        );
        assert_eq!(project.practice.performance_id, cid);
    }
}
