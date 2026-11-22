//! Tick-native music data and a temporary compatibility view for existing consumers.
pub use midly;
mod decode;
pub mod musical_time;
pub mod playback;
pub mod program_track;
pub mod tempo_track;
pub mod key_signature;
use midly::{Format, MidiMessage, Smf};
pub use playback::PlaybackState;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub struct NoteId {
    pub track: usize,
    pub onset: usize,
}
impl NoteId {
    pub fn scoped(&self, content_id: &str) -> String {
        format!("{content_id}:{}:{}", self.track, self.onset)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseKind {
    KeyUp,
    AllNotesOff,
    AllSoundOff,
    EndOfFile,
}
#[derive(Debug, Clone)]
pub struct SourceNote {
    pub id: NoteId,
    pub start_tick: u64,
    pub release_tick: u64,
    pub sounding_end_tick: u64,
    pub note: u8,
    pub velocity: u8,
    pub channel: u8,
    pub release: ReleaseKind,
}
#[derive(Debug, Clone)]
pub struct TickEvent {
    pub tick: u64,
    pub track: usize,
    pub ordinal: usize,
    pub channel: u8,
    pub message: MidiMessage,
    pub voice: Option<NoteId>,
}
#[derive(Debug, Clone)]
pub struct NoteMapping {
    pub id: NoteId,
    pub compatibility_index: usize,
    pub legacy_index: Option<usize>,
}
#[derive(Debug, Clone)]
pub struct Performance {
    pub content_id: String,
    pub ppq: u16,
    pub last_tick: u64,
    pub notes: Arc<[SourceNote]>,
    pub events: Arc<[TickEvent]>,
    pub note_mapping: Arc<[NoteMapping]>,
    pub warnings: Arc<[String]>,
    pub original_bytes: Arc<[u8]>,
}
impl Performance {
    pub fn note(&self, id: NoteId) -> Option<&SourceNote> {
        self.notes
            .binary_search_by_key(&id, |n| n.id)
            .ok()
            .map(|i| &self.notes[i])
    }
    pub fn legacy_note_id(&self, track: usize, index: usize) -> Option<NoteId> {
        self.note_mapping
            .binary_search_by_key(&(track, index), |m| (m.id.track, m.compatibility_index))
            .ok()
            .and_then(|i| {
                let m = &self.note_mapping[i];
                (m.legacy_index == Some(index)).then_some(m.id)
            })
    }
}
#[derive(Debug, Clone)]
pub struct MidiEvent {
    pub source_note: Option<NoteId>,
    /// Total source ordering, including cross-track release events.
    pub order: usize,
    pub channel: u8,
    pub timestamp: Duration,
    pub message: MidiMessage,
    pub track_id: usize,
    pub track_color_id: usize,
}
#[derive(Debug, Clone)]
pub struct ProgramEvent {
    pub channel: u8,
    pub timestamp: Duration,
    pub program: u8,
}
#[derive(Debug, Clone)]
pub struct MidiNote {
    pub source_index: usize,
    pub start: Duration,
    pub end: Duration,
    pub duration: Duration,
    pub note: u8,
    pub velocity: u8,
    pub channel: u8,
    pub track_id: usize,
    pub track_color_id: usize,
}
impl MidiNote {
    pub fn id(&self) -> NoteId {
        NoteId {
            track: self.track_id,
            onset: self.source_index,
        }
    }
}
#[derive(Debug, Clone)]
pub struct MidiTrack {
    pub name: Option<String>,
    pub notes: Arc<[MidiNote]>,
    pub events: Arc<[MidiEvent]>,
    pub track_id: usize,
    pub track_color_id: usize,
    pub programs: Arc<[ProgramEvent]>,
    pub has_drums: bool,
    pub has_other_than_drums: bool,
}
#[derive(Debug, Clone)]
pub struct MidiMarker {
    pub tick: u64,
    pub name: String,
}
/// One lyric event: a syllable or word as stored. `/`, `\\` and newlines mark line breaks
/// (karaoke convention); the text is kept as it is.
#[derive(Debug, Clone)]
pub struct MidiLyric {
    pub tick: u64,
    pub text: String,
}
#[derive(Debug, Clone)]
pub struct MidiFile {
    pub name: String,
    pub content_id: String,
    pub source_path: Option<PathBuf>,
    pub markers: Arc<[MidiMarker]>,
    pub lyrics: Arc<[MidiLyric]>,
    pub format: Format,
    pub key_signature: Option<(i8, bool)>,
    pub key_signatures:Arc<[key_signature::KeySignatureEvent]>,
    pub tracks: Arc<[MidiTrack]>,
    pub program_track: program_track::ProgramTrack,
    pub tempo_track: tempo_track::TempoTrack,
    pub measures: Arc<[Duration]>,
    pub beats: Arc<[Duration]>,
    pub duration: Duration,
    pub musical_time: musical_time::MusicalTime,
    /// Original tick data is shared by parsing, identity projection and future render adapters.
    pub source: Arc<Performance>,
}
impl MidiFile {
    pub fn new(path: impl AsRef<Path>) -> Result<Self, String> {
        use std::io::Read;
        let mut data = Vec::new();
        std::fs::File::open(path.as_ref())
            .map_err(|e| format!("无法读取 MIDI：{e}"))?
            .take(32_000_001)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        Self::from_path_bytes(path, &data)
    }
    pub fn from_path_bytes(path: impl AsRef<Path>, data: &[u8]) -> Result<Self, String> {
        let name = path
            .as_ref()
            .file_name()
            .ok_or("MIDI 路径缺少文件名")?
            .to_string_lossy()
            .into_owned();
        let mut file = decode::read(name, data, &|| Ok(()))?;
        file.source_path = Some(path.as_ref().into());
        Ok(file)
    }
    pub fn from_path_bytes_checked(
        path: impl AsRef<Path>,
        data: &[u8],
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        let name = path
            .as_ref()
            .file_name()
            .ok_or("MIDI 路径缺少文件名")?
            .to_string_lossy()
            .into_owned();
        let mut file = decode::read(name, data, check)?;
        file.source_path = Some(path.as_ref().into());
        Ok(file)
    }
    pub fn from_bytes_checked(
        name: impl Into<String>,
        data: &[u8],
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        decode::read(name.into(), data, check)
    }
    pub fn from_smf(name: impl Into<String>, smf: &Smf<'_>) -> Result<Self, String> {
        let mut writer = decode::MidiWriter(Vec::new());
        smf.write_std(&mut writer)
            .map_err(|e| format!("MIDI 编码失败：{e}"))?;
        decode::read(name.into(), &writer.0, &|| Ok(()))
    }
    pub fn note_id(&self, track: usize, index: usize) -> Option<NoteId> {
        self.tracks
            .iter()
            .find(|t| t.track_id == track)?
            .notes
            .get(index)
            .map(MidiNote::id)
    }
}
/// General MIDI program labels. Program numbers remain zero-based on the wire.
pub static INSTRUMENT_NAMES: [&str; 128] = [
    "大钢琴",
    "明亮钢琴",
    "电声大钢琴",
    "酒吧钢琴",
    "电钢琴一",
    "电钢琴二",
    "羽管键琴",
    "击弦古钢琴",
    "钢片琴",
    "钟琴",
    "八音盒",
    "颤音琴",
    "马林巴",
    "木琴",
    "管钟",
    "扬琴",
    "拉杆风琴",
    "打击风琴",
    "摇滚风琴",
    "教堂管风琴",
    "簧风琴",
    "手风琴",
    "口琴",
    "探戈手风琴",
    "尼龙弦吉他",
    "钢弦吉他",
    "爵士电吉他",
    "清音电吉他",
    "闷音电吉他",
    "过载吉他",
    "失真吉他",
    "吉他泛音",
    "原声贝斯",
    "指弹电贝斯",
    "拨片电贝斯",
    "无品贝斯",
    "击弦贝斯一",
    "击弦贝斯二",
    "合成贝斯一",
    "合成贝斯二",
    "小提琴",
    "中提琴",
    "大提琴",
    "低音提琴",
    "弦乐颤音",
    "弦乐拨奏",
    "竖琴",
    "定音鼓",
    "弦乐合奏一",
    "弦乐合奏二",
    "合成弦乐一",
    "合成弦乐二",
    "合唱",
    "人声",
    "合成人声",
    "管弦乐强奏",
    "小号",
    "长号",
    "大号",
    "弱音小号",
    "圆号",
    "铜管合奏",
    "合成铜管一",
    "合成铜管二",
    "高音萨克斯",
    "中音萨克斯",
    "次中音萨克斯",
    "上低音萨克斯",
    "双簧管",
    "英国管",
    "巴松管",
    "单簧管",
    "短笛",
    "长笛",
    "竖笛",
    "排箫",
    "吹瓶",
    "尺八",
    "哨子",
    "陶笛",
    "方波主奏",
    "锯齿波主奏",
    "汽笛主奏",
    "合成主奏四",
    "合成主奏五",
    "人声主奏",
    "五度主奏",
    "贝斯主奏",
    "新时代铺底",
    "暖音铺底",
    "复音铺底",
    "合唱铺底",
    "弓弦铺底",
    "金属铺底",
    "光晕铺底",
    "扫掠铺底",
    "雨声效果",
    "音轨效果",
    "水晶效果",
    "气氛效果",
    "明亮效果",
    "哥布林效果",
    "回声效果",
    "科幻效果",
    "西塔琴",
    "班卓琴",
    "三味线",
    "古筝",
    "卡林巴",
    "风笛",
    "民族提琴",
    "唢呐",
    "铃铛",
    "阿哥哥鼓",
    "钢鼓",
    "木块",
    "太鼓",
    "旋律鼓",
    "合成鼓",
    "反向镲",
    "吉他品噪",
    "呼吸声",
    "海浪",
    "鸟鸣",
    "电话铃",
    "直升机",
    "掌声",
    "枪声",
];

#[cfg(test)]
mod tests;
