//! Musical identity is independent of filesystem position and practice history.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const SCHEMA_VERSION: u16 = 1;
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScoreQuality {
    Original,
    Proofread,
    AutomaticDraft,
    #[default]
    Unreviewed,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicalWork {
    pub id: String,
    pub title: String,
    pub composer: String,
    pub catalogue: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceEdition {
    pub content_id: String,
    pub work_id: String,
    pub label: String,
    pub locations: Vec<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotationEdition {
    pub id: String,
    pub content_id: String,
    pub performance_id: String,
    pub version_id: String,
    pub name: String,
    pub path: String,
    pub quality: ScoreQuality,
    pub source: String,
    #[serde(default = "registered_default")]
    pub registered: bool,
}
fn registered_default() -> bool {
    true
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepertoireRegistry {
    pub version: u16,
    pub works: BTreeMap<String, MusicalWork>,
    pub performances: BTreeMap<String, PerformanceEdition>,
    pub notations: BTreeMap<String, NotationEdition>,
}
impl Default for RepertoireRegistry {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            works: BTreeMap::new(),
            performances: BTreeMap::new(),
            notations: BTreeMap::new(),
        }
    }
}
impl RepertoireRegistry {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != SCHEMA_VERSION {
            return Err(format!(
                "作品资料版本 {} 暂不支持，原文件保留",
                self.version
            ));
        }
        if self.works.len() > 100_000
            || self.performances.len() > 100_000
            || self.notations.len() > 100_000
        {
            return Err("作品资料超过 100000 条容量限制".into());
        }
        fn text(value: &str, max: usize) -> bool {
            value.chars().count() <= max && !value.chars().any(|c| c.is_control() && c != '\n')
        }
        for (id, work) in &self.works {
            if id != &work.id
                || id.is_empty()
                || !text(id, 200)
                || work.title.trim().is_empty()
                || !text(&work.title, 200)
                || !text(&work.composer, 160)
                || !text(&work.catalogue, 100)
            {
                return Err("作品资料身份或标题无效".into());
            }
        }
        for (id, performance) in &self.performances {
            if id != &performance.content_id
                || id.is_empty()
                || !text(id, 160)
                || !self.works.contains_key(&performance.work_id)
                || performance.locations.len() > 1000
                || performance.locations.iter().any(|p| !text(p, 32768))
            {
                return Err("演奏版本的作品关联无效".into());
            }
        }
        for (id, notation) in &self.notations {
            if id != &notation.id
                || id.is_empty()
                || !text(id, 400)
                || !self.performances.contains_key(&notation.performance_id)
                || notation.content_id.is_empty()
                || !text(&notation.content_id, 160)
                || !text(&notation.version_id, 200)
                || !text(&notation.name, 300)
                || !text(&notation.path, 32768)
                || !text(&notation.source, 2000)
            {
                return Err("谱面版本的演奏关联无效".into());
            }
        }
        Ok(())
    }
    /// Conservative migration: matching titles never merge two performances.
    pub fn register(
        &mut self,
        content_id: &str,
        title: &str,
        composer: &str,
        location: Option<String>,
    ) {
        let work_id = format!("work-{content_id}");
        self.performances
            .entry(content_id.into())
            .or_insert_with(|| {
                self.works
                    .entry(work_id.clone())
                    .or_insert_with(|| MusicalWork {
                        id: work_id.clone(),
                        title: if title.trim().is_empty() {
                            "未命名作品".into()
                        } else {
                            title.into()
                        },
                        composer: composer.into(),
                        catalogue: String::new(),
                    });
                PerformanceEdition {
                    content_id: content_id.into(),
                    work_id,
                    label: title.into(),
                    locations: vec![],
                }
            });
        if let Some(location) = location {
            let locations = &mut self.performances.get_mut(content_id).unwrap().locations;
            if !locations.contains(&location) {
                locations.push(location);
                locations.sort();
            }
        }
    }
    pub fn link(&mut self, content_id: &str, work_id: &str) -> Result<(), String> {
        if !self.works.contains_key(work_id) {
            return Err("目标作品已变化，请刷新".into());
        }
        self.performances
            .get_mut(content_id)
            .ok_or("演奏版本尚未登记")?
            .work_id = work_id.into();
        Ok(())
    }
    pub fn separate(&mut self, content_id: &str) -> Result<(), String> {
        let current = self
            .performances
            .get(content_id)
            .ok_or("演奏版本尚未登记")?
            .work_id
            .clone();
        if self
            .performances
            .values()
            .filter(|p| p.work_id == current)
            .count()
            < 2
        {
            return Ok(());
        }
        let mut work = self.works.get(&current).ok_or("歌曲登记缺失")?.clone();
        let id = std::iter::once(format!("work-{content_id}"))
            .chain((0..=self.works.len()).map(|i| format!("work-{content_id}-independent-{i}")))
            .find(|id| self.performances.values().all(|p| p.work_id != *id))
            .ok_or("无法建立独立歌曲")?;
        if !self.works.contains_key(&id) {
            work.id = id.clone();
            self.works.insert(id.clone(), work);
        }
        self.performances.get_mut(content_id).unwrap().work_id = id;
        Ok(())
    }
}

#[cfg(test)]
mod relationship_tests {
    #[test]
    fn regrouping_restores_independent_identity_without_accumulating_or_overwriting_works() {
        let mut registry = super::RepertoireRegistry::default();
        registry.register("first", "原曲", "作者", Some("first.mid".into()));
        registry.register("second", "个人演奏", "作者", Some("second.mid".into()));
        for _ in 0..8 {
            registry.link("second", "work-first").unwrap();
            registry.separate("second").unwrap();
        }
        assert_eq!(registry.works.len(), 2);
        assert_eq!(registry.performances["second"].work_id, "work-second");
        assert_eq!(registry.works["work-second"].title, "个人演奏");
        assert_eq!(registry.performances["second"].locations, ["second.mid"]);
        registry.validate().unwrap();
    }
}
