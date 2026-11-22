//! The section layer of the current song (前奏 / 主歌 / 副歌 …). Sources in order: the
//! manifest's `sections` layer, the file's markers (MIDI marker and cue point events), the
//! analysis of the played notes. Ticks are those of the played song.
use crate::player::Player;
use panthesia_core::manifest_store;
use serde::Serialize;
use std::path::Path;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sections {
    pub items: Vec<SectionItem>,
    /// `human`, `imported` or `generated`.
    pub origin: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionItem {
    pub tick: u64,
    pub seconds: f64,
    pub label: String,
}

fn manifest_sections(music: &Path) -> Option<(Vec<(u64, String)>, String)> {
    let found = manifest_store::locate(music).ok().flatten()?;
    let performance = manifest_store::performance_of(&found, music).unwrap_or_else(|| found.manifest.default.performance.clone());
    let layer = found.manifest.layer_for("sections", &performance)?;
    let items = layer
        .body
        .get("items")?
        .as_array()?
        .iter()
        .filter_map(|item| Some((item.get("tick")?.as_u64()?, item.get("label")?.as_str()?.to_string())))
        .collect();
    let origin = layer.provenance.as_ref().map(|p| format!("{:?}", p.origin).to_lowercase()).unwrap_or_else(|| "human".into());
    Some((items, origin))
}

impl Player {
    pub(crate) fn sections(&self) -> Option<Sections> {
        let file = self.file.as_ref()?;
        let original = self.source_file.as_ref().unwrap_or(file);
        let (mut items, origin) = original
            .source_path
            .as_deref()
            .and_then(manifest_sections)
            .or_else(|| {
                (!original.markers.is_empty())
                    .then(|| (original.markers.iter().map(|m| (m.tick, m.name.clone())).collect(), "imported".to_string()))
            })
            .unwrap_or_else(|| {
                let notes = panthesia_analysis::notes(&file.source);
                let items = panthesia_analysis::sections(&notes, &file.musical_time).into_iter().map(|s| (s.tick, s.label)).collect();
                (items, "generated".to_string())
            });
        items.sort_by_key(|(tick, _)| *tick);
        let seconds = |tick: u64| file.tempo_track.pulses_to_duration(tick).as_secs_f64();
        Some(Sections {
            items: items.into_iter().map(|(tick, label)| SectionItem { tick, seconds: seconds(tick), label }).collect(),
            origin,
        })
    }
}
