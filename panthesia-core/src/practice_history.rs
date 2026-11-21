use std::{
    collections::BTreeMap,
    fs,
    io,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use ron::extensions::Extensions;
use serde::{Deserialize, Serialize};

use crate::{
    exercise::ExerciseSpec,
    practice::{AttemptSummary, PracticeHands, PracticePart},
};

const MAX_SESSIONS_PER_SONG: usize = 200;

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
pub enum PracticeSessionKind {
    WholeSong,
    Loop {
        start_measure: usize,
        end_measure: usize,
    },
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Serialize)]
pub struct PracticeAnnotation {
    pub note: String,
    pub teacher: String,
    pub next: String,
    pub updated_at_unix_ms: u64,
}
#[derive(Debug,Clone,Deserialize,PartialEq,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ReplayClip {
    pub id: String,
    pub name: String,
    pub start: f64,
    pub end: f64,
    pub notes: String,
    pub updated_at_unix_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub performance_revision: Option<String>,
}
#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct PracticeSession {
    #[serde(default,skip_serializing_if="Vec::is_empty")]
    pub replay_clips:Vec<ReplayClip>,
    /// Wall time with practice transport running; excludes pause and count-in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playing_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotation: Option<PracticeAnnotation>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub context: Option<PracticeSessionContext>,
    pub recorded_at_unix_ms: u64,
    pub kind: PracticeSessionKind,
    #[serde(default)]
    pub hands: PracticeHands,
    pub speed: f32,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub effective_tempo_bpm: Option<u16>,
    pub summary: AttemptSummary,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct PracticeLadderCondition {
    pub plan_id:String,
    pub plan_name:String,
    pub stage:usize,
    pub speed_percent:u16,
    pub target_percent:u16,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub accuracy_percent:Option<u8>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub on_time_percent:Option<u8>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub passes_required:Option<u8>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub round_passed:Option<bool>,
}

#[derive(Debug,Clone,Default,Deserialize,PartialEq,Serialize)]
pub struct PracticeExpressionCondition {pub velocity_difference:Option<u8>,#[serde(default,skip_serializing_if="Option::is_none")] pub note_velocity_difference:Option<u8>,#[serde(default,skip_serializing_if="Option::is_none")] pub note_pedal_mismatch_count:Option<u8>,pub contour_percent:Option<u8>,pub pedal_offset_ms:Option<u16>}

#[derive(Debug,Clone,Deserialize,PartialEq,Serialize)]
pub struct PracticeRoutineCondition {
    #[serde(default,skip_serializing_if="Option::is_none")] pub expression:Option<PracticeExpressionCondition>,
    #[serde(default)] pub item_notes:String,
    #[serde(default)] pub consecutive:bool,
    pub routine_id:String,pub routine_name:String,pub day:String,pub item_id:String,pub item_title:String,
    pub passes_required:u16,pub accuracy_percent:u8,pub on_time_percent:Option<u8>,
}

/// Immutable conditions of a saved attempt. Absent in older histories.
#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct PracticeSessionContext {
    /// The attempt ended early after this many errors. Such attempts cannot establish mastery.
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub loop_restart:Option<u16>,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub expression: Option<PracticeExpressionCondition>,
    #[serde(default)]
    pub routine:Option<PracticeRoutineCondition>,
    #[serde(default)]
    pub ladder: Option<PracticeLadderCondition>,
    #[serde(default)]
    pub target_notes: usize,
    #[serde(default)]
    pub judged_notes: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub note_playback: Vec<crate::song_config::NotePlaybackRule>,
    pub tracks: Vec<PracticeTrackSetup>,
    pub parts: BTreeMap<usize, PracticePart>,
    pub hands: String,
    pub count_in: u8,
    pub metronome: bool,
    pub latency: i32,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub pedal_latency_ms:Option<i32>,
    pub rounds: usize,
    pub adaptive: bool,
    pub grid: String,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub passage_bounds: Option<PracticePassageBounds>,
    pub source_path: Option<PathBuf>,
    pub exercise_spec: Option<ExerciseSpec>,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
pub struct PracticePassageBounds {
    pub start_tick: u64,
    pub end_tick: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
pub enum PracticeTrackMode {
    Mute,
    Auto,
    Human,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
pub struct PracticeTrackSetup {
    pub track_id: usize,
    pub mode: PracticeTrackMode,
    pub visible: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
pub struct PracticeLoopSetup {
    pub enabled: bool,
    pub start_measure: usize,
    pub end_measure: usize,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Serialize)]
pub struct SongPracticeSetup {
    pub tracks: Vec<PracticeTrackSetup>,
    pub speed: f32,
    pub loop_setup: Option<PracticeLoopSetup>,
    #[serde(default)]
    pub source_path: Option<PathBuf>,
    #[serde(default)]
    pub exercise_spec: Option<ExerciseSpec>,
    #[serde(default)]
    pub last_used_unix_ms: u64,
}

#[derive(Debug, Clone, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct SongLibraryState {
    pub source_path: Option<PathBuf>,
    pub favorite: bool,
    pub queue_position: Option<usize>,
}

impl PracticeSession {
    pub fn stable_id(&self) -> String {
        self.id.clone().unwrap_or_else(|| {
            let mut original=self.clone();original.annotation=None;original.replay_clips.clear();
            format!("legacy-{}",blake3::hash(&serde_json::to_vec(&original).unwrap_or_default()))
        })
    }
    pub fn same_performance(&self, other:&Self)->bool {
        let mut a=self.clone();let mut b=other.clone();
        a.annotation=None;b.annotation=None;a.replay_clips.clear();b.replay_clips.clear();a.id=None;b.id=None;
        if a.playing_ms.is_some() && b.playing_ms.is_some() && a.playing_ms!=b.playing_ms {return false;}
        a.playing_ms=None;b.playing_ms=None;a==b
    }
    pub fn new(
        kind: PracticeSessionKind,
        hands: PracticeHands,
        speed: f32,
        summary: AttemptSummary,
    ) -> Self {
        Self {
            replay_clips:Vec::new(),
            playing_ms: None,
            annotation: None,
            id: Some(format!("attempt-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos())),
            context: None,
            recorded_at_unix_ms: unix_time_ms(),
            kind,
            hands,
            speed,
            mode: None,
            scope: None,
            effective_tempo_bpm: None,
            summary,
        }
    }
    pub fn with_mode(mut self, mode: &str) -> Self {
        self.mode = Some(mode.into());
        self
    }
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Serialize)]
pub struct SongPracticeHistory {
    pub display_name: String,
    #[serde(default)]
    pub setup: Option<SongPracticeSetup>,
    #[serde(default)]
    pub library: SongLibraryState,
    pub sessions: Vec<PracticeSession>,
}

/// UTC half-open intervals. running_ms can be shorter when a measured interval has a gap.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize)]
pub struct PracticeTimeSlice { pub from:u64,pub to:u64,pub running_ms:u64 }
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq, Serialize)]
pub struct PracticeTimeEntry { pub saved_at_unix_ms:u64,pub slices:Vec<PracticeTimeSlice>,#[serde(default)] pub untracked_ms:u64 }
pub type PracticeTimeLedger=BTreeMap<String,BTreeMap<String,PracticeTimeEntry>>;
pub fn validate_time_ledger(ledger:&PracticeTimeLedger)->Result<(),String>{
    let mut saves=0usize;let mut slices=0usize;let mut total_ms=0u128;
    for (cid,entries) in ledger {if cid.is_empty()||cid.len()>160{return Err("计时账本的曲目标识无效".into())}saves=saves.checked_add(entries.len()).ok_or("计时账本数量超限")?;
        for (id,entry) in entries {if id.is_empty()||id.len()>200||entry.saved_at_unix_ms>9_000_000_000_000_000||entry.slices.len()>20_000{return Err("计时账本条目无效".into())}total_ms+=u128::from(entry.untracked_ms);let mut end=0;
            for slice in &entry.slices {if slice.from<end||slice.from>=slice.to||slice.to>9_000_000_000_000_000||slice.running_ms==0||slice.running_ms>slice.to-slice.from{return Err("计时账本区间无效或重叠".into())}end=slice.to;total_ms+=u128::from(slice.running_ms);}
            slices=slices.checked_add(entry.slices.len()).ok_or("计时账本区间数量超限")?;
        }
    }
    if total_ms>9_000_000_000_000_000||saves>200_000||slices>2_000_000{return Err("计时账本容量已达上限，请先导出备份".into())}Ok(())
}
impl PracticeTimeSlice {
    pub fn intersection_ms(&self,from:u64,to:u64)->u64{let a=self.from.max(from);let b=self.to.min(to);if a>=b{return 0}let length=u128::from(self.to-self.from);let part=|at:u64|u128::from(self.running_ms)*u128::from(at-self.from)/length;(part(b)-part(a)) as u64}
}

/// Shared in memory, transparent in the existing RON file. Updating one song does not
/// duplicate the sessions and timing ledger of every other song held by a reader.
#[derive(Debug, Clone, PartialEq)]
struct SharedHistory<T>(Arc<T>);
impl<T: Default> Default for SharedHistory<T> {
    fn default() -> Self { Self(Arc::new(T::default())) }
}
impl<T> From<T> for SharedHistory<T> {
    fn from(value: T) -> Self { Self(Arc::new(value)) }
}
impl<T> std::ops::Deref for SharedHistory<T> {
    type Target = T;
    fn deref(&self) -> &T { self.0.as_ref() }
}
impl<T: Clone> std::ops::DerefMut for SharedHistory<T> {
    fn deref_mut(&mut self) -> &mut T { Arc::make_mut(&mut self.0) }
}
impl<T: Serialize> Serialize for SharedHistory<T> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.as_ref().serialize(serializer)
    }
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for SharedHistory<T> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        T::deserialize(deserializer).map(Self::from)
    }
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Serialize)]
struct PracticeHistoryV1 {
    #[serde(default)]
    time_ledger:SharedHistory<PracticeTimeLedger>,
    songs: BTreeMap<String, SharedHistory<SongPracticeHistory>>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
enum PracticeHistoryFile {
    V1(PracticeHistoryV1),
    V2(PracticeHistoryV1),
}

impl Default for PracticeHistoryFile {
    fn default() -> Self {
        Self::V1(PracticeHistoryV1::default())
    }
}

#[derive(Debug, Clone)]
pub struct PracticeHistoryStore {
    path: PathBuf,
    file: Arc<PracticeHistoryFile>,
    write_block: Option<String>,
}

impl PracticeHistoryStore {
    pub fn empty(path:impl Into<PathBuf>) -> Self { Self { path:path.into(),file:Arc::new(PracticeHistoryFile::default()),write_block:None } }
    /// Observe damaged/recovery-blocked storage without quarantining or changing its files.
    pub fn load_read_only(path: impl Into<PathBuf>, reason: String) -> Self {
        let path=path.into();
        let file=fs::read_to_string(&path).ok().and_then(|text|ron_options().from_str::<PracticeHistoryFile>(&text).ok()).unwrap_or_default();
        let mut store=Self{path,file:Arc::new(file),write_block:Some(reason)};
        if validate_time_ledger(store.time_ledger()).is_err(){store.file=Arc::new(PracticeHistoryFile::default());}
        store
    }
    pub fn load(path:impl Into<PathBuf>) -> Self { Self::load_report(path).0 }
    pub fn write_block_reason(&self) -> Option<&str> { self.write_block.as_deref() }
    pub fn load_report(path: impl Into<PathBuf>) -> (Self,Option<String>) {
        let path = path.into();
        let mut warning=None;
        let file = match crate::utils::atomic_file::read_to_string(&path) {
            Ok(contents) => match ron_options().from_str(&contents) {
                Ok(file) => file,
                Err(error) => {
                    log::error!("Practice history is damaged and will be quarantined: {error:#?}");
                    warning=Some(format!("练习历史无法读取，原件已保留：{}：{error}",path.display()));
                    quarantine_corrupt_file(&path);
                    PracticeHistoryFile::default()
                }
            },
            Err(error) if error.kind() == io::ErrorKind::NotFound => PracticeHistoryFile::default(),
            Err(error) => {
                warning=Some(format!("练习历史无法读取：{}：{error}",path.display()));
                log::error!("Could not read practice history: {error}");
                PracticeHistoryFile::default()
            }
        };

        let file=match &file {PracticeHistoryFile::V1(value) | PracticeHistoryFile::V2(value) if validate_time_ledger(&value.time_ledger).is_err()=>{warning=Some(format!("练习累计时长资料损坏，原件已保留：{}",path.display()));log::error!("Practice time ledger is damaged and will be quarantined");quarantine_corrupt_file(&path);PracticeHistoryFile::default()},_=>file};
        let write_block=warning.as_ref().filter(|_|path.try_exists().unwrap_or(true)).cloned();
        (Self { path,file:Arc::new(file),write_block },warning)
    }

    pub fn time_ledger(&self)->&PracticeTimeLedger {match self.file.as_ref(){PracticeHistoryFile::V1(file) | PracticeHistoryFile::V2(file)=>&file.time_ledger}}
    pub fn block_writes(&mut self, reason: String) { self.write_block = Some(reason); }
    pub fn record_session(
        &mut self,
        song_id: &str,
        display_name: &str,
        session: PracticeSession,
    ) -> Result<(), PracticeHistoryError> {
        let song = self
            .songs_mut()
            .entry(song_id.to_owned())
            .or_insert_with(|| SharedHistory::from(SongPracticeHistory {
                display_name: display_name.to_owned(),
                setup: None,
                library: SongLibraryState::default(),
                sessions: Vec::new(),
            }));
        song.display_name = display_name.to_owned();
        song.sessions.push(session);
        let excess = song.sessions.len().saturating_sub(MAX_SESSIONS_PER_SONG);
        if excess != 0 {
            song.sessions.drain(..excess);
        }
        self.save()
    }

    pub fn save_setup(
        &mut self,
        song_id: &str,
        display_name: &str,
        mut setup: SongPracticeSetup,
    ) -> Result<(), PracticeHistoryError> {
        setup.last_used_unix_ms = unix_time_ms();
        let song = self
            .songs_mut()
            .entry(song_id.to_owned())
            .or_insert_with(|| SharedHistory::from(SongPracticeHistory {
                display_name: display_name.to_owned(),
                setup: None,
                library: SongLibraryState::default(),
                sessions: Vec::new(),
            }));
        song.display_name = display_name.to_owned();
        if setup.source_path.is_some() {
            song.library.source_path = setup.source_path.clone();
        }
        song.setup = Some(setup);
        self.save()
    }

    pub fn setup(&self, song_id: &str) -> Option<&SongPracticeSetup> {
        self.song(song_id)?.setup.as_ref()
    }
    pub fn snapshot(&self) -> BTreeMap<String, SongPracticeHistory> {self.songs().iter().map(|(id,song)|(id.clone(),(**song).clone())).collect()}
    pub fn replace_snapshot(&mut self, songs:BTreeMap<String,SongPracticeHistory>) { *self.songs_mut()=songs.into_iter().map(|(id,song)|(id,song.into())).collect(); self.normalize_queue(); }
    pub fn from_snapshot_bytes(path:impl Into<PathBuf>,bytes:&[u8])->Result<Self,String> {
        let contents=std::str::from_utf8(bytes).map_err(|e|e.to_string())?;
        let file:PracticeHistoryFile=ron_options().from_str(contents).map_err(|e|e.to_string())?;
        let store=Self {path:path.into(),file:Arc::new(file),write_block:None};
        validate_time_ledger(store.time_ledger())?;
        Ok(store)
    }
    fn serialized_file(&self) -> PracticeHistoryFile {
        let (PracticeHistoryFile::V1(value) | PracticeHistoryFile::V2(value)) = self.file.as_ref();
        if value.songs.values().flat_map(|s| &s.sessions).any(|s| s.context.as_ref().is_some_and(|c| !c.note_playback.is_empty())) {
            PracticeHistoryFile::V2(value.clone())
        } else { PracticeHistoryFile::V1(value.clone()) }
    }
    pub fn snapshot_bytes(&self) -> Result<Vec<u8>,PracticeHistoryError> {Ok(ron_options().to_string_pretty(&self.serialized_file(),ron::ser::PrettyConfig::default().struct_names(true))?.into_bytes())}
    /// Detect replacement of the exact song used by a background editor.
    /// The in-memory identity is deliberately independent of serialized data equality.
    pub fn same_song_snapshot(&self, other: &Self, song_id: &str) -> bool {
        match (self.songs().get(song_id), other.songs().get(song_id)) {
            (Some(left), Some(right)) => Arc::ptr_eq(&left.0, &right.0),
            _ => false,
        }
    }
    pub fn song(&self, song_id: &str) -> Option<&SongPracticeHistory> {
        self.songs().get(song_id).map(|song| &**song)
    }

    pub fn session_count(&self, song_id: &str) -> usize {
        self.song(song_id).map_or(0, |song| song.sessions.len())
    }

    pub fn save(&self) -> Result<(), PracticeHistoryError> {
        if let Some(reason)=&self.write_block { return Err(io::Error::other(reason.clone()).into()); }
        if crate::utils::atomic_file::is_capturing(&self.path) {
            let snapshot=self.clone();
            crate::utils::atomic_file::write_generated(&self.path,move||snapshot.snapshot_bytes().map_err(io::Error::other))?;
            return Ok(());
        }
        let contents = ron_options().to_string_pretty(
            &self.serialized_file(),
            ron::ser::PrettyConfig::default().struct_names(true),
        )?;
        atomic_write(&self.path, contents.as_bytes())?;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn songs(&self) -> &BTreeMap<String, SharedHistory<SongPracticeHistory>> {
        match self.file.as_ref() {
            PracticeHistoryFile::V1(file) | PracticeHistoryFile::V2(file) => &file.songs,
        }
    }

    fn songs_mut(&mut self) -> &mut BTreeMap<String, SharedHistory<SongPracticeHistory>> {
        match Arc::make_mut(&mut self.file) {
            PracticeHistoryFile::V1(file) | PracticeHistoryFile::V2(file) => &mut file.songs,
        }
    }

    fn normalize_queue(&mut self) {
        let mut queue: Vec<_> = self
            .songs()
            .iter()
            .filter_map(|(id, song)| Some((song.library.queue_position?, id.clone())))
            .collect();
        queue.sort();
        for (position, (_, id)) in queue.into_iter().enumerate() {
            if let Some(song) = self.songs_mut().get_mut(&id) {
                song.library.queue_position = Some(position);
            }
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PracticeHistoryError {
    #[error("could not serialize practice history: {0}")]
    Serialize(#[from] ron::Error),
    #[error("could not write practice history: {0}")]
    Io(#[from] io::Error),
}

fn ron_options() -> ron::Options {
    ron::Options::default().with_default_extension(Extensions::UNWRAP_VARIANT_NEWTYPES)
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn quarantine_corrupt_file(path: &Path) {
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("practice-history");
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("ron");
    let quarantine =
        path.with_file_name(format!("{stem}.corrupt-{}.{}", unix_time_ms(), extension));
    if let Err(error) = fs::rename(path, &quarantine) {
        log::error!("Could not quarantine damaged practice history: {error}");
    }
}

fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    crate::utils::atomic_file::write(path, contents)
}

#[cfg(test)]
mod tests {
    #[test]
    fn older_expression_condition_keeps_its_serialized_identity_without_note_goal() {
        let old=r#"{"velocity_difference":12,"contour_percent":null,"pedal_offset_ms":null}"#;
        let condition:super::PracticeExpressionCondition=serde_json::from_str(old).unwrap();
        assert_eq!(condition.note_velocity_difference,None);
        assert_eq!(condition.note_pedal_mismatch_count,None);
        assert_eq!(serde_json::to_string(&condition).unwrap(),old);
        let with_note=super::PracticeExpressionCondition{note_velocity_difference:Some(8),..condition.clone()};
        assert_eq!(serde_json::to_value(with_note).unwrap()["note_velocity_difference"],8);
        let with_pedal=super::PracticeExpressionCondition{note_pedal_mismatch_count:Some(0),..condition};
        assert_eq!(serde_json::to_value(with_pedal).unwrap()["note_pedal_mismatch_count"],0);
    }
    use super::*;
    use crate::practice::{MeasurePartSummary, MeasureSummary, PracticeBreakdown, PracticeSnapshot, TimingSummary};

    fn temp_history_path(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "neothesia-history-test-{}-{}-{name}",
            std::process::id(),
            unix_time_ms()
        ));
        fs::create_dir_all(&directory).unwrap();
        directory.join("practice-history.ron")
    }

    fn session(measure: usize, matched: usize, missed: usize) -> PracticeSession {
        PracticeSession {
            replay_clips:Vec::new(),
            playing_ms: None,
            annotation: None,
            id: None,
            context: None,
            scope: None,
            mode: None,
            recorded_at_unix_ms: 1,
            kind: PracticeSessionKind::WholeSong,
            hands: PracticeHands::Both,
            speed: 0.75,
            effective_tempo_bpm: None,
            summary: AttemptSummary {
                overall: PracticeSnapshot {
                    matched_notes: matched,
                    missed_notes: missed,
                    ..PracticeSnapshot::default()
                },
                measures: vec![MeasureSummary {
                    measure,
                    breakdown: PracticeBreakdown {
                        target_notes: matched + missed,
                        matched_notes: matched,
                        missed_notes: missed,
                        ..PracticeBreakdown::default()
                    },
                    timing: Default::default(),
                }],
                parts: Vec::new(),
                measure_parts: Vec::new(),
                timing: Default::default(),
                chords: Default::default(),
                expression: Default::default(),
                exercise_passes: Vec::new(),
            },
        }
    }

    #[test]
    fn round_trip_survives_rename_of_the_source_song() {
        let path = temp_history_path("round-trip");
        let mut store = PracticeHistoryStore::load(&path);
        store
            .record_session("content-id", "Old Name.mid", session(2, 8, 2))
            .unwrap();
        store
            .record_session("content-id", "New Name.mid", session(3, 9, 1))
            .unwrap();

        let loaded = PracticeHistoryStore::load(&path);
        let song = loaded.song("content-id").unwrap();
        assert_eq!(song.display_name, "New Name.mid");
        assert_eq!(song.sessions.len(), 2);

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn summaries_saved_before_expression_feedback_remain_readable() {
        let legacy = r#"(
            overall: (
                matched_notes: 1,
                on_time_notes: 1,
                early_notes: 0,
                late_notes: 0,
                wrong_notes: 0,
                missed_notes: 0,
                required_notes: 0,
            ),
            measures: [],
            parts: [],
        )"#;

        let summary: AttemptSummary = ron::from_str(legacy).unwrap();
        assert_eq!(summary.timing, Default::default());
        assert_eq!(summary.chords, Default::default());
        assert_eq!(summary.expression, Default::default());
        assert!(summary.exercise_passes.is_empty());
        assert!(summary.measure_parts.is_empty());
    }

    #[test]
    fn measured_part_evidence_survives_history_save_and_reopen() {
        let path = temp_history_path("measure-part-evidence");
        let mut attempt = session(7, 2, 1);
        attempt.summary.measure_parts.push(MeasurePartSummary {
            measure: 7,
            part: PracticePart::LeftHand,
            track_id: 4,
            breakdown: PracticeBreakdown {
                target_notes: 3,
                matched_notes: 2,
                late_notes: 1,
                on_time_notes: 1,
                missed_notes: 1,
                ..PracticeBreakdown::default()
            },
            timing: TimingSummary {
                matched_samples: 2,
                median_offset_ms: Some(58),
                median_deviation_ms: Some(22),
            },
        });
        let mut store = PracticeHistoryStore::load(&path);
        store.record_session("song-content", "Test.mid", attempt).unwrap();
        let reopened = PracticeHistoryStore::load(&path);
        let cell = &reopened.song("song-content").unwrap().sessions[0].summary.measure_parts[0];
        assert_eq!((cell.measure, cell.part, cell.track_id), (7, PracticePart::LeftHand, 4));
        assert_eq!((cell.breakdown.target_notes, cell.breakdown.missed_notes), (3, 1));
        assert_eq!(cell.timing.median_offset_ms, Some(58));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn histories_saved_before_hand_scopes_remain_readable() {
        let path = temp_history_path("legacy-hand-scope");
        let mut store = PracticeHistoryStore::load(&path);
        store
            .record_session("content-id", "Song.mid", session(2, 8, 2))
            .unwrap();

        let legacy_contents = fs::read_to_string(&path)
            .unwrap()
            .lines()
            .filter(|line| {
                let line = line.trim_start();
                !line.starts_with("hands:") && !line.starts_with("setup:")
            })
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&path, legacy_contents).unwrap();

        let loaded = PracticeHistoryStore::load(&path);
        assert_eq!(
            loaded.song("content-id").unwrap().sessions[0].hands,
            PracticeHands::Unspecified
        );
        assert_eq!(loaded.setup("content-id"), None);

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn legacy_song_history_defaults_to_unorganized_library_state() {
        let history: SongPracticeHistory = ron_options()
            .from_str("(display_name:\"Legacy.mid\",sessions:[])")
            .unwrap();
        assert_eq!(history.library, SongLibraryState::default());
    }

    #[test]
    fn session_saved_before_effective_tempo_remains_readable() {
        let original = session(2, 8, 2);
        let serialized = ron_options().to_string(&original).unwrap();
        let legacy = serialized.replace("effective_tempo_bpm:None,", "");
        assert_ne!(legacy, serialized);

        let loaded: PracticeSession = ron_options().from_str(&legacy).unwrap();

        assert_eq!(loaded.effective_tempo_bpm, None);
        assert_eq!(loaded.summary, original.summary);
    }

    #[test]
    fn song_setup_is_saved_by_content_identity() {
        let path = temp_history_path("song-setup");
        let mut store = PracticeHistoryStore::load(&path);
        let setup = SongPracticeSetup {
            tracks: vec![PracticeTrackSetup {
                track_id: 3,
                mode: PracticeTrackMode::Human,
                visible: true,
            }],
            speed: 0.65,
            loop_setup: Some(PracticeLoopSetup {
                enabled: true,
                start_measure: 7,
                end_measure: 8,
            }),
            source_path: Some(PathBuf::from("C:/Music/Old Name.mid")),
            exercise_spec: None,
            last_used_unix_ms: 0,
        };
        store
            .save_setup("content-id", "Old Name.mid", setup.clone())
            .unwrap();
        store
            .save_setup("content-id", "New Name.mid", setup.clone())
            .unwrap();

        let loaded = PracticeHistoryStore::load(&path);
        let loaded_setup = loaded.setup("content-id").unwrap();
        assert_eq!(loaded_setup.tracks, setup.tracks);
        assert_eq!(loaded_setup.speed, setup.speed);
        assert_eq!(loaded_setup.loop_setup, setup.loop_setup);
        assert_eq!(loaded_setup.source_path, setup.source_path);
        assert!(loaded_setup.last_used_unix_ms > 0);
        assert_eq!(
            loaded.song("content-id").unwrap().display_name,
            "New Name.mid"
        );

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn generated_exercise_source_survives_setup_round_trip() {
        let path = temp_history_path("exercise-source");
        let mut store = PracticeHistoryStore::load(&path);
        let spec = ExerciseSpec {
            tonic: 1,
            tempo_bpm: 70,
            ..Default::default()
        };
        store
            .save_setup(
                "exercise-id",
                "C# Major Scale",
                SongPracticeSetup {
                    tracks: Vec::new(),
                    speed: 1.0,
                    loop_setup: None,
                    source_path: None,
                    exercise_spec: Some(spec),
                    last_used_unix_ms: 0,
                },
            )
            .unwrap();

        let loaded = PracticeHistoryStore::load(&path);

        assert_eq!(
            loaded.setup("exercise-id").unwrap().exercise_spec,
            Some(spec)
        );

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn setup_saved_before_generated_sources_remains_readable() {
        let setup = SongPracticeSetup {
            tracks: Vec::new(),
            speed: 0.8,
            loop_setup: None,
            source_path: Some(PathBuf::from("C:/Music/Legacy.mid")),
            exercise_spec: None,
            last_used_unix_ms: 7,
        };
        let serialized = ron_options().to_string(&setup).unwrap();
        let legacy = serialized.replace("exercise_spec:None,", "");
        assert_ne!(legacy, serialized);

        let loaded: SongPracticeSetup = ron_options().from_str(&legacy).unwrap();

        assert_eq!(loaded.exercise_spec, None);
        assert_eq!(loaded.source_path, setup.source_path);
    }

    #[test]
    fn damaged_history_is_quarantined_and_does_not_block_startup() {
        let path = temp_history_path("corrupt");
        fs::write(&path, "this is not valid RON").unwrap();

        let store = PracticeHistoryStore::load(&path);

        assert_eq!(store.session_count("anything"), 0);
        assert!(!path.exists());
        assert!(
            fs::read_dir(path.parent().unwrap())
                .unwrap()
                .flatten()
                .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
        );

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn history_retains_only_the_most_recent_sessions() {
        let path = temp_history_path("retention");
        let mut store = PracticeHistoryStore::load(&path);
        for index in 0..(MAX_SESSIONS_PER_SONG + 3) {
            let mut item = session(1, 1, 0);
            item.recorded_at_unix_ms = index as u64;
            store.record_session("song", "Song.mid", item).unwrap();
        }

        let song = store.song("song").unwrap();
        assert_eq!(song.sessions.len(), MAX_SESSIONS_PER_SONG);
        assert_eq!(song.sessions.first().unwrap().recorded_at_unix_ms, 3);

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
