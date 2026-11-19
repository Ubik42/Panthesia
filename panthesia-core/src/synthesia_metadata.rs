//! Synthesia's documented exchange format. Parsing never touches user storage.
//! Original attributes are retained even when this application cannot apply them.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use quick_xml::{
    Reader,
    events::{BytesStart, Event},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_BYTES: usize = 2_000_000;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Song {
    pub unique_id: String,
    pub attributes: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Group {
    pub path: Vec<String>,
    pub songs: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MetadataFile {
    pub songs: Vec<Song>,
    pub groups: Vec<Group>,
}
pub fn music_identity(bytes: &[u8]) -> String {
    STANDARD.encode(md5::compute(bytes).0)
}
fn attributes(
    event: &BytesStart<'_>,
    reader: &Reader<&[u8]>,
) -> Result<BTreeMap<String, String>, String> {
    let mut result = BTreeMap::new();
    for item in event.attributes() {
        let item = item.map_err(|e| format!("元数据属性无效：{e}"))?;
        let key = std::str::from_utf8(item.key.as_ref())
            .map_err(|_| "属性名不是 UTF-8")?
            .to_owned();
        let value = item
            .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, reader.decoder())
            .map_err(|e| e.to_string())?
            .into_owned();
        if value.chars().count() > 500_000 || result.insert(key, value).is_some() {
            return Err("元数据属性重复或过长".into());
        }
    }
    Ok(result)
}
fn identity(value: Option<&String>) -> Result<String, String> {
    let value = value.ok_or("歌曲缺少 UniqueId")?;
    let decoded = STANDARD
        .decode(value)
        .map_err(|_| "UniqueId 不是有效 base64 MD5")?;
    if decoded.len() != 16 {
        return Err("UniqueId 不是 16 字节 MD5".into());
    }
    Ok(STANDARD.encode(decoded))
}
pub fn parse(bytes: &[u8]) -> Result<MetadataFile, String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("元数据文件应为 1 字节至 2 MB".into());
    }
    std::str::from_utf8(bytes).map_err(|_| "请将元数据保存为 UTF-8 XML")?;
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut result = MetadataFile {
        songs: vec![],
        groups: vec![],
    };
    let mut stack: Vec<Vec<u8>> = vec![];
    let mut group_stack: Vec<usize> = vec![];
    let mut seen = BTreeSet::new();
    let mut root = false;
    loop {
        let event = reader
            .read_event()
            .map_err(|e| format!("元数据 XML 无效：{e}"))?;
        match event {
            Event::Start(ref element) | Event::Empty(ref element) => {
                let empty = matches!(event, Event::Empty(_));
                let name = element.name().as_ref().to_vec();
                let attrs = attributes(element, &reader)?;
                if stack.is_empty() {
                    if root
                        || name != b"SynthesiaMetadata"
                        || attrs.get("Version").map(String::as_str) != Some("1")
                    {
                        return Err("需要 SynthesiaMetadata Version=1 文件".into());
                    }
                    root = true;
                } else if name == b"Group"
                    && matches!(stack.last().map(Vec::as_slice), Some(b"Groups" | b"Group"))
                {
                    let label = attrs.get("Name").ok_or("分组缺少名称")?.trim();
                    if label.is_empty() || label.chars().count() > 80 || group_stack.len() >= 16 {
                        return Err("分组名称或层级超过范围".into());
                    }
                    let mut path = group_stack
                        .last()
                        .map(|&i| result.groups[i].path.clone())
                        .unwrap_or_default();
                    path.push(label.into());
                    result.groups.push(Group {
                        path,
                        songs: vec![],
                    });
                    if !empty {
                        group_stack.push(result.groups.len() - 1);
                    }
                } else if name == b"Song"
                    && stack.last().is_some_and(|p| p == b"Songs" || p == b"Group")
                {
                    let id = identity(attrs.get("UniqueId"))?;
                    if stack.last().is_some_and(|p| p == b"Songs") {
                        if !seen.insert(id.clone()) {
                            return Err("同一文件包含重复的歌曲 UniqueId".into());
                        }
                        result.songs.push(Song {
                            unique_id: id,
                            attributes: attrs,
                        });
                    } else {
                        let group = *group_stack.last().ok_or("歌曲分组层级无效")?;
                        result.groups[group].songs.push(id);
                    }
                }
                if result.songs.len() > 10_000 || result.groups.len() > 200 || stack.len() > 32 {
                    return Err("元数据歌曲、分组或 XML 层级过多".into());
                }
                if !empty {
                    stack.push(name);
                }
            }
            Event::End(element) => {
                let previous = stack.pop().ok_or("XML 结束标签无对应元素")?;
                if previous.as_slice() != element.name().as_ref() {
                    return Err("XML 标签不匹配".into());
                }
                if previous == b"Group"
                    && group_stack.last().is_some_and(|&i| {
                        result.groups[i].path.len()
                            == stack.iter().filter(|s| s.as_slice() == b"Group").count() + 1
                    })
                {
                    group_stack.pop();
                }
            }
            Event::DocType(_) | Event::GeneralRef(_) => {
                return Err("元数据不支持 DTD 或外部实体".into());
            }
            Event::Text(text)
                if stack.is_empty() && text.iter().any(|b| !b.is_ascii_whitespace()) =>
            {
                return Err("XML 根元素外存在文本".into());
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !root || !stack.is_empty() || result.songs.is_empty() {
        return Err("元数据文件没有完整的歌曲列表".into());
    }
    Ok(result)
}

impl Song {
    pub fn metadata(&self) -> Result<crate::library::SongMetadata, String> {
        let text = |name| self.attributes.get(name).cloned();
        let difficulty = match self.number("Difficulty")? {
            Some(n) => Some(n.to_string()),
            None => None,
        };
        Ok(crate::library::SongMetadata {
            title: text("Title"),
            subtitle: text("Subtitle"),
            composer: text("Composer"),
            arranger: text("Arranger"),
            artist: text("MadeFamousBy"),
            copyright: text("Copyright"),
            license: text("License"),
            collection: None,
            difficulty,
            tags: text("Tags")
                .unwrap_or_default()
                .split(';')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
            notes: None,
        }
        .normalized())
    }
    pub fn number(&self, name: &str) -> Result<Option<u8>, String> {
        self.attributes
            .get(name)
            .map(|s| {
                s.parse::<u8>()
                    .ok()
                    .filter(|n| *n <= 100)
                    .ok_or_else(|| format!("{name} 应为 0～100"))
            })
            .transpose()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum Hand {
    Left,
    Right,
    Background,
    Discard,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Finger {
    pub track: usize,
    pub index: usize,
    pub steps: Vec<FingerStep>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FingerStep {
    pub hand: Hand,
    pub finger: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Part {
    pub track: usize,
    pub index: usize,
    pub hand: Hand,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Annotations {
    pub fingers: Vec<Finger>,
    pub parts: Vec<Part>,
}

struct TrackMap {
    ticks: Vec<u64>,
    runtime: BTreeMap<usize, usize>,
}
struct Cursor {
    track: usize,
    index: usize,
}
impl Cursor {
    fn jump(
        &mut self,
        command: u8,
        number: usize,
        maps: &[TrackMap],
        file: &midi_file::MidiFile,
    ) -> Result<(), String> {
        if command == b't' {
            if number >= maps.len() {
                return Err("指法或分手指定的 MIDI 轨道不存在".into());
            }
            self.track = number;
            self.index = 0;
        } else {
            let measure = file
                .musical_time
                .measures
                .get(number.checked_sub(1).ok_or("小节编号从 1 开始")?)
                .ok_or("指法或分手指定的小节不存在")?;
            self.index = maps[self.track]
                .ticks
                .partition_point(|tick| *tick < measure.start_tick);
        }
        Ok(())
    }
}
fn number(bytes: &[u8], at: &mut usize) -> Result<usize, String> {
    let begin = *at;
    while bytes.get(*at).is_some_and(u8::is_ascii_digit) {
        *at += 1;
    }
    if begin == *at {
        return Err("元数据指令缺少编号".into());
    }
    std::str::from_utf8(&bytes[begin..*at])
        .unwrap()
        .parse::<usize>()
        .map_err(|_| "元数据编号过大".into())
}
fn jump(
    bytes: &[u8],
    at: &mut usize,
    cursor: &mut Cursor,
    maps: &[TrackMap],
    file: &midi_file::MidiFile,
) -> Result<bool, String> {
    if !matches!(bytes.get(*at), Some(b't' | b'm')) {
        return Ok(false);
    }
    let command = bytes[*at];
    *at += 1;
    let n = number(bytes, at)?;
    if bytes.get(*at) != Some(&b':') {
        return Err("轨道或小节指令缺少冒号".into());
    }
    *at += 1;
    cursor.jump(command, n, maps, file)?;
    Ok(true)
}
pub fn annotations(
    song: &Song,
    bytes: &[u8],
    file: &midi_file::MidiFile,
) -> Result<Annotations, String> {
    if song.unique_id != music_identity(bytes)
        || file.content_id != blake3::hash(bytes).to_hex().as_str()
    {
        return Err("元数据、原始 MIDI 和解析结果的内容身份不一致".into());
    }
    let smf = midi_file::midly::Smf::parse(bytes).map_err(|_| "MIDI 文件无法解析")?;
    let mut maps = vec![];
    for (id, track) in smf.tracks.iter().enumerate() {
        let mut tick = 0u64;
        let mut ticks = vec![];
        for event in track {
            tick = tick
                .checked_add(u64::from(event.delta.as_int()))
                .ok_or("MIDI 时序溢出")?;
            if matches!(event.kind,midi_file::midly::TrackEventKind::Midi {message:midi_file::midly::MidiMessage::NoteOn {vel,..},..} if vel.as_int()>0)
            {
                ticks.push(tick);
            }
        }
        maps.push(TrackMap {
            ticks,
            runtime: file.tracks[id]
                .notes
                .iter()
                .enumerate()
                .map(|(index, n)| (n.source_index, index))
                .collect(),
        });
    }
    if maps.iter().map(|m| m.ticks.len()).sum::<usize>() > 1_000_000 {
        return Err("元数据映射超过 100 万音符".into());
    }
    let mut fingers: BTreeMap<(usize, usize), Finger> = BTreeMap::new();
    if let Some(value) = song.attributes.get("FingerHints") {
        let compact = value
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>();
        let bytes = compact.as_bytes();
        let mut at = 0;
        let mut cursor = Cursor { track: 0, index: 0 };
        let mut last = None;
        while at < bytes.len() {
            if bytes[at].is_ascii_whitespace() {
                at += 1;
                continue;
            }
            if matches!(bytes[at], b't' | b'm') && bytes.get(at + 1).is_some_and(u8::is_ascii_digit)
            {
                jump(bytes, &mut at, &mut cursor, &maps, file)?;
                last = None;
                continue;
            }
            let ch = bytes[at];
            at += 1;
            if ch == b'-' {
                cursor.index += 1;
                last = None;
                continue;
            }
            if ch == b's' {
                let digit = *bytes.get(at).ok_or("换指指令缺少后续指法")?;
                if !digit.is_ascii_digit() {
                    return Err("换指指令缺少后续指法".into());
                }
                at += 1;
                let key = last.ok_or("换指指令没有对应音符")?;
                let (hand, finger) = finger_digit(digit);
                let target = fingers.get_mut(&key).ok_or("换指目标无法映射")?;
                target.steps.push(FingerStep { hand, finger });
                continue;
            }
            if !ch.is_ascii_digit() {
                continue;
            }
            let index = *maps[cursor.track]
                .runtime
                .get(&cursor.index)
                .ok_or("指法目标没有完整的 MIDI 音符，或超出轨道范围")?;
            let key = (cursor.track, index);
            let (hand, finger) = finger_digit(ch);
            fingers.insert(
                key,
                Finger {
                    track: cursor.track,
                    index,
                    steps: vec![FingerStep { hand, finger }],
                },
            );
            last = Some(key);
            cursor.index += 1;
        }
    }
    let mut parts = BTreeMap::new();
    if let Some(value) = song.attributes.get("Parts") {
        for (track, map) in maps.iter().enumerate() {
            for &index in map.runtime.values() {
                parts.insert(
                    (track, index),
                    Part {
                        track,
                        index,
                        hand: Hand::Background,
                    },
                );
            }
        }
        let bytes = value.as_bytes();
        let mut at = 0;
        let mut cursor = Cursor { track: 0, index: 0 };
        while at < bytes.len() {
            if bytes[at].is_ascii_whitespace() {
                at += 1;
                continue;
            }
            if jump(bytes, &mut at, &mut cursor, &maps, file)? {
                continue;
            }
            let ch = bytes[at];
            at += 1;
            if ch == b'-' {
                cursor.index += 1;
                continue;
            }
            let hand = match ch {
                b'L' => Hand::Left,
                b'R' => Hand::Right,
                b'B' => Hand::Background,
                b'X' => Hand::Discard,
                _ => return Err("无法识别 Parts 分手指令".into()),
            };
            let count = if bytes.get(at) == Some(&b'A') {
                at += 1;
                cursor.index = 0;
                maps[cursor.track].ticks.len()
            } else if bytes.get(at).is_some_and(u8::is_ascii_digit) {
                number(bytes, &mut at)?
            } else {
                1
            };
            let end = cursor
                .index
                .checked_add(count)
                .filter(|n| *n <= maps[cursor.track].ticks.len())
                .ok_or("分手范围超过轨道音符数")?;
            for ordinal in cursor.index..end {
                let index = *maps[cursor.track]
                    .runtime
                    .get(&ordinal)
                    .ok_or("分手目标缺少结束事件，无法映射")?;
                parts.insert(
                    (cursor.track, index),
                    Part {
                        track: cursor.track,
                        index,
                        hand,
                    },
                );
            }
            cursor.index = end;
        }
    }
    Ok(Annotations {
        fingers: fingers.into_values().collect(),
        parts: parts.into_values().collect(),
    })
}
fn finger_digit(ch: u8) -> (Hand, u8) {
    if (b'1'..=b'5').contains(&ch) {
        (Hand::Left, ch - b'0')
    } else {
        (Hand::Right, if ch == b'0' { 5 } else { ch - b'5' })
    }
}

#[cfg(test)]
#[path = "synthesia_metadata_tests.rs"]
mod tests;
