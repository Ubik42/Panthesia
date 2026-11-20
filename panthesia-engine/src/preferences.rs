use panthesia_core::practice_history::PracticeTrackSetup;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Default, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionSettings {
    pub tracks: Vec<PracticeTrackSetup>,
    #[serde(deserialize_with = "deserialize_parts")]
    pub parts: BTreeMap<usize, panthesia_core::practice::PracticePart>,
    pub mode: Option<String>,
    pub count_in: u8,
    pub metronome: bool,
    pub latency: i32,
    pub rounds: usize,
    pub hands: String,
    pub adaptive: bool,
}
fn deserialize_parts<'de, D>(deserializer: D) -> Result<BTreeMap<usize, panthesia_core::practice::PracticePart>, D::Error>
where D: serde::Deserializer<'de> {
    use serde::de::Error;
    let parts = BTreeMap::<String, panthesia_core::practice::PracticePart>::deserialize(deserializer)?;
    parts.into_iter().map(|(id, part)| {
        id.parse::<usize>().map(|id| (id, part)).map_err(|_| D::Error::custom(format!("音轨编号无效：{id}")))
    }).collect()
}
use std::{
    path::{Path, PathBuf},
};

/// Shared in memory; JSON contains exactly the underlying collection.
/// Detached readers and deferred saves retain a stable snapshot at constant cloning cost.
#[derive(Debug, PartialEq)]
pub struct Shared<T>(std::sync::Arc<T>);
impl<T> From<T> for Shared<T> {
    fn from(value: T) -> Self { Self(std::sync::Arc::new(value)) }
}
impl<T> Shared<T> {
    pub fn same_snapshot(&self, other: &Self) -> bool { std::sync::Arc::ptr_eq(&self.0, &other.0) }
}
impl<T> Clone for Shared<T> {
    fn clone(&self) -> Self { Self(self.0.clone()) }
}
impl<T: Clone> Shared<T> {
    /// Materialize an independent collection only at export/transfer boundaries.
    pub fn materialize(&self) -> T { self.0.as_ref().clone() }
}
impl<T: Default> Default for Shared<T> {
    fn default() -> Self { T::default().into() }
}
impl<T> std::ops::Deref for Shared<T> {
    type Target = T;
    fn deref(&self) -> &T { self.0.as_ref() }
}
impl<T: Clone> std::ops::DerefMut for Shared<T> {
    fn deref_mut(&mut self) -> &mut T { std::sync::Arc::make_mut(&mut self.0) }
}
impl<T: Serialize> Serialize for Shared<T> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.as_ref().serialize(serializer)
    }
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Shared<T> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        T::deserialize(deserializer).map(Self::from)
    }
}
impl<'a, T> IntoIterator for &'a Shared<T> where &'a T: IntoIterator {
    type Item = <&'a T as IntoIterator>::Item;
    type IntoIter = <&'a T as IntoIterator>::IntoIter;
    fn into_iter(self) -> Self::IntoIter { self.0.as_ref().into_iter() }
}
impl<'a, T: Clone> IntoIterator for &'a mut Shared<T> where &'a mut T: IntoIterator {
    type Item = <&'a mut T as IntoIterator>::Item;
    type IntoIter = <&'a mut T as IntoIterator>::IntoIter;
    fn into_iter(self) -> Self::IntoIter { std::sync::Arc::make_mut(&mut self.0).into_iter() }
}
impl<T: Clone + IntoIterator> IntoIterator for Shared<T> {
    type Item = T::Item;
    type IntoIter = T::IntoIter;
    fn into_iter(self) -> Self::IntoIter { std::sync::Arc::unwrap_or_clone(self.0).into_iter() }
}

#[derive(Default, Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub schema_version: PreferencesSchema,
    #[serde(flatten)]
    pub extensions: BTreeMap<String, serde_json::Value>,
    pub last_content_id: Option<String>,
    pub path: Option<PathBuf>,
    pub exercise: Option<panthesia_core::exercise::ExerciseSpec>,
    pub exercise_layouts: Shared<BTreeMap<String,panthesia_core::exercise::ExerciseHands>>,
    pub title: String,
    pub speed: Option<f64>,
    pub wait: Option<bool>,
    pub hands: Option<String>,
    pub input: Option<String>,
    pub output: Option<String>,
    #[serde(default)]
    pub audio_device: Option<String>,
    pub passage: Option<Passage>,
    pub volume: Option<f64>,
    pub loop_restart_errors:u16,
    pub songs: Shared<BTreeMap<String, SessionSettings>>,
    pub variants: Shared<BTreeMap<String, crate::practice_variant::Variant>>,
    pub song_expression_goals: Shared<BTreeMap<String, crate::expression_goal::ExpressionGoal>>,
    pub track_appearances: Shared<BTreeMap<String,BTreeMap<usize,crate::track_appearance::TrackAppearance>>>,
    pub track_sounds: Shared<BTreeMap<String, BTreeMap<usize, crate::track_sound::TrackSound>>>,
    pub input_configured: bool,
    pub calibrations: Shared<BTreeMap<String, i32>>,
    pub passages: Shared<BTreeMap<String, Vec<PassagePreset>>>,
    pub bookmarks: Shared<BTreeMap<String,Vec<panthesia_core::song_bookmarks::Bookmark>>>,
    pub exercise_presets: Shared<Vec<ExercisePreset>>,
    pub ladder_presets: Shared<BTreeMap<String,Vec<LadderPreset>>>,
    pub ladder_runs: Shared<BTreeMap<String,LadderRun>>,
    pub routines: Shared<Vec<crate::routine_commands::PracticeRoutine>>,
    pub routine_runs: crate::shared_map::SharedMap<String,crate::routine_commands::RoutineRun>,
    pub score_versions: Shared<BTreeMap<String, Vec<ScoreVersion>>>,
    pub hand_span_defaults: Shared<BTreeMap<
        panthesia_core::practice::PracticePart,
        panthesia_core::fingering::HandSpanProfile,
    >>,
    pub hand_span_profiles: Shared<BTreeMap<String, BTreeMap<String, panthesia_core::fingering::HandSpanProfile>>>,
    pub fingering_profiles: Shared<BTreeMap<String, BTreeMap<usize, panthesia_core::fingering::HandSpanProfile>>>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub struct PreferencesSchema(u16);
impl Default for PreferencesSchema { fn default() -> Self { Self(1) } }
impl<'de> Deserialize<'de> for PreferencesSchema {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let version = u16::deserialize(deserializer)?;
        if version == 1 { Ok(Self(version)) } else { Err(serde::de::Error::custom(format!("练习设置版本 {version} 暂不支持，原文件保留"))) }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreVersion {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub content_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassagePreset {
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub practice: Option<panthesia_core::song_project::PracticeEdition>,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub precise_range: Option<crate::tick_ranges::TickRange>,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub score_range: Option<crate::score_ranges::ScoreRange>,
    #[serde(default)]
    pub grid: Option<String>,
    pub id: String,
    pub name: String,
    pub start: usize,
    pub end: usize,
    pub notes: String,
    pub speed: f64,
    pub settings: SessionSettings,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExercisePreset {
    pub id: String,
    pub name: String,
    pub spec: panthesia_core::exercise::ExerciseSpec,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Passage {
    pub start: f64,
    pub end: f64,
}

impl Preferences {
    pub fn load(path: &Path) -> Result<Self, String> {
        match panthesia_core::utils::atomic_file::read(path) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("练习设置读取失败：{e}"))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(format!("练习设置读取失败：{e}")),
        }
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if panthesia_core::utils::atomic_file::is_capturing(path) {
            let snapshot=self.clone();
            return panthesia_core::utils::atomic_file::write_generated(path,move||serde_json::to_vec_pretty(&snapshot).map_err(std::io::Error::other)).map_err(|e|format!("练习设置保存失败：{e}"));
        }
        let bytes=serde_json::to_vec_pretty(self).map_err(|e| format!("练习设置保存失败：{e}"))?;
        panthesia_core::utils::atomic_file::write(path, &bytes).map_err(|e| format!("练习设置保存失败：{e}"))
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase")]
pub struct LadderPreset {
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub practice:Option<panthesia_core::song_project::PracticeEdition>,
    pub id:String,
    pub name:String,
    pub start:usize,
    pub end:usize,
    pub grid:String,
    pub scope:String,
    pub exercise_spec:Option<panthesia_core::exercise::ExerciseSpec>,
    pub settings:SessionSettings,
    pub plan:panthesia_core::speed_ladder::SpeedLadderPlan,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub expression:Option<crate::expression_goal::ExpressionGoal>,
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase")]
pub struct LadderRun {
    pub preset:LadderPreset,
    pub progress:panthesia_core::speed_ladder::SpeedLadderProgress,
    pub active:bool,
}
