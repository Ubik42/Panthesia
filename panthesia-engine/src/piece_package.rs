use crate::preferences::{PassagePreset, SessionSettings};
use midi_file::MidiFile;
use panthesia_core::{
    library::{FingerHint, MeterCorrection, NoteHandHint, SongMetadata},
    practice::PracticePart,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Cursor, Read, Write},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub path: String,
    pub name: String,
    pub hash: String,
    pub size: usize,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paper {
    pub name: String,
    pub format: String,
    pub pages: Vec<Asset>,
    pub view: crate::score_attachments::View,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub mapping:Option<crate::score_attachments::Mapping>,
    #[serde(default,skip_serializing_if="Vec::is_empty")]
    pub annotations:Vec<crate::score_attachments::Annotation>,
    #[serde(default,skip_serializing_if="Vec::is_empty")]
    pub note_anchors:Vec<crate::score_attachments::NoteAnchor>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub version: u16,
    pub content_id: String,
    pub title: String,
    pub metadata: SongMetadata,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata_layers: Option<panthesia_core::metadata_layers::MetadataLayers>,
    pub midi: Asset,
    pub scores: Vec<Asset>,
    pub active_score: Option<usize>,
    #[serde(default)]
    pub papers: Vec<Paper>,
    #[serde(default)]
    pub active_paper: Option<usize>,
    #[serde(default)]
    pub ladders: Vec<crate::preferences::LadderPreset>,
    pub fingerings: Vec<FingerHint>,
    #[serde(default)]
    pub finger_actions:Vec<panthesia_core::library::FingerAction>,
    pub hands: Vec<NoteHandHint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub note_playback: Vec<panthesia_core::song_config::NotePlaybackRule>,
    pub track_parts: BTreeMap<usize, PracticePart>,
    #[serde(default)]
    pub track_appearances:BTreeMap<usize,crate::track_appearance::TrackAppearance>,
    #[serde(default)]
    pub track_sounds: BTreeMap<usize, crate::track_sound::TrackSound>,
    pub meter: Option<MeterCorrection>,
    #[serde(default)]
    pub meter_map:Option<panthesia_core::library::MeterMap>,
    pub passages: Vec<PassagePreset>,
    #[serde(default,skip_serializing_if="Vec::is_empty")]
    pub bookmarks:Vec<panthesia_core::song_bookmarks::Bookmark>,
    pub settings: SessionSettings,
    pub speed: f64,
    #[serde(default)]
    pub practice_loop: Option<crate::preferences::Passage>,
    pub hand_profiles: BTreeMap<String, panthesia_core::fingering::HandSpanProfile>,
    pub profiles: BTreeMap<usize, panthesia_core::fingering::HandSpanProfile>,
    pub groups: Vec<Vec<String>>,
    pub rating: u8,
    #[serde(default)]
    pub provenance: serde_json::Value,
}
pub struct Package {
    pub manifest: Manifest,
    pub files: BTreeMap<String, Vec<u8>>,
}
pub fn asset(path: String, name: String, bytes: &[u8]) -> Asset {
    Asset {
        path,
        name,
        hash: blake3::hash(bytes).to_hex().to_string(),
        size: bytes.len(),
    }
}
/// Archive paths must identify the same file on the supported Windows desktop filesystem.
pub(crate) fn valid_asset_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path
            .chars()
            .any(|c| c.is_control() || matches!(c, ':' | '<' | '>' | '"' | '|' | '?' | '*'))
        && path.split('/').all(|part| {
            if part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' ']) {
                return false;
            }
            let stem = part
                .split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase();
            if matches!(
                stem.as_str(),
                "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
            ) {
                return false;
            }
            !(stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        })
}
/// Reject both case aliases and a file that is another asset's parent directory.
pub(crate) fn insert_asset_path(paths: &mut BTreeSet<String>, path: &str) -> bool {
    let key = path.replace('\\', "/").to_lowercase();
    if paths.contains(&key)
        || key
            .char_indices()
            .any(|(index, c)| c == '/' && paths.contains(&key[..index]))
    {
        return false;
    }
    let prefix = format!("{key}/");
    if paths
        .range(prefix.clone()..)
        .next()
        .is_some_and(|candidate| candidate.starts_with(&prefix))
    {
        return false;
    }
    paths.insert(key)
}
struct LimitedArchive(Cursor<Vec<u8>>);
impl Write for LimitedArchive {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.position().checked_add(bytes.len() as u64).is_none_or(|length| length > 256_000_000) {
            return Err(std::io::Error::other("曲目包超过 256 MB，请减少不需要的谱面版本"));
        }
        self.0.write(bytes)
    }
    fn flush(&mut self) -> std::io::Result<()> {self.0.flush()}
}
impl std::io::Seek for LimitedArchive {
    fn seek(&mut self, position: std::io::SeekFrom) -> std::io::Result<u64> {std::io::Seek::seek(&mut self.0, position)}
}
impl Package {
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        self.encode_checked(&|| Ok(()))
    }
    pub(crate) fn encode_checked(&self, check: &dyn Fn() -> Result<(), String>) -> Result<Vec<u8>, String> {
        let bytes = self.write_archive(check)?;
        Self::decode_checked(&bytes, check)?;
        check()?;
        Ok(bytes)
    }
    pub(crate) fn encode_owned_checked(self, check: &dyn Fn() -> Result<(), String>) -> Result<Vec<u8>, String> {
        let bytes = self.write_archive(check)?;
        drop(self);
        Self::decode_checked(&bytes, check)?;
        check()?;
        Ok(bytes)
    }
    fn write_archive(&self, check: &dyn Fn() -> Result<(), String>) -> Result<Vec<u8>, String> {
        check()?;
        let manifest = serde_json::to_vec_pretty(&self.manifest).map_err(|error| error.to_string())?;
        if manifest.len() > 4_000_000 || self.files.values().map(|bytes| bytes.len() as u64).sum::<u64>() + manifest.len() as u64 > 512_000_000 {return Err("曲目包展开大小或清单超过范围".into());}
        let mut zip = zip::ZipWriter::new(LimitedArchive(Cursor::new(Vec::new())));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("manifest.json", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&manifest)
            .map_err(|e| e.to_string())?;
        for (path, bytes) in &self.files {
            check()?;
            zip.start_file(path, options).map_err(|e| e.to_string())?;
            for chunk in bytes.chunks(524_288) {
                check()?;
                zip.write_all(chunk).map_err(|e| e.to_string())?;
            }
        }
        let bytes = zip.finish().map_err(|e| e.to_string())?.0.into_inner();
        check()?;
        Ok(bytes)
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        Self::decode_checked(bytes, &|| Ok(()))
    }
    fn decode_checked(bytes: &[u8], check: &dyn Fn() -> Result<(), String>) -> Result<Self, String> {
        check()?;
        if bytes.is_empty() || bytes.len() > 256_000_000 {
            return Err("曲目包为空或超过 256 MB".into());
        }
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|e| format!("曲目包不是有效 ZIP：{e}"))?;
        if zip.len() > 3302 {
            return Err("曲目包文件数量超出范围".into());
        }
        let mut files = BTreeMap::new();
        let mut total = 0u64;
        let mut expanded = 0u64;
        let mut paths=BTreeSet::new();
        for i in 0..zip.len() {
            check()?;
            let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
            let path = file.name().to_owned();
            if !valid_asset_path(&path) || !insert_asset_path(&mut paths,&path)
                || file.is_dir()
                || file.unix_mode().is_some_and(|v| v & 0o170000 == 0o120000)
            {
                return Err("曲目包包含无效文件路径".into());
            }
            let limit = if path == "performance.mid" {
                32_000_000
            } else if path.starts_with("papers/") {
                48_000_000
            } else {
                4_000_000
            };
            total = total.checked_add(file.size()).ok_or("曲目包大小无效")?;
            if file.size() > limit || total > 512_000_000 {
                return Err("曲目包展开大小超出范围".into());
            }
            let mut data = Vec::new();
            let mut chunk = [0u8; 65_536];
            loop {
                check()?;
                let count = file.read(&mut chunk).map_err(|error| error.to_string())?;
                if count == 0 { break; }
                if data.len() as u64 + count as u64 > limit {
                    return Err("曲目包包含超大文件".into());
                }
                expanded = expanded.checked_add(count as u64).ok_or("曲目包展开大小无效")?;
                if expanded > 512_000_000 { return Err("曲目包实际展开大小超出范围".into()); }
                data.extend_from_slice(&chunk[..count]);
            }
            if data.len() as u64 > limit || files.insert(path, data).is_some() {
                return Err("曲目包包含重复文件或超大文件".into());
            }
        }
        let manifest: Manifest = serde_json::from_slice(
            files
                .remove("manifest.json")
                .ok_or("曲目包缺少清单")?
                .as_slice(),
        )
        .map_err(|e| format!("曲目包清单无效：{e}"))?;
        if manifest.format != "neothesia-piece" || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].contains(&manifest.version) {
            return Err("曲目包版本暂不支持".into());
        }
        if let Some(layers) = &manifest.metadata_layers {
            if manifest.version < 15 { return Err("来源默认值与个人覆盖需要第 15 版曲目包".into()); }
            layers.validate()?;
            crate::library_metadata::validate(&layers.defaults)?;
            if layers.resolve(&manifest.metadata) != manifest.metadata.clone().normalized() {
                return Err("曲目包的来源默认值与有效资料不一致".into());
            }
        }
        if manifest.version < 14 && !manifest.note_playback.is_empty() {
            return Err("逐音播放规则需要第 14 版曲目包".into());
        }
        if manifest.version < 13 && manifest.metadata.has_extended_fields() {
            return Err("扩展曲目资料需要第 13 版曲目包，请使用新版软件重新导出".into());
        }
        if manifest.version < 12 && manifest.meter_map.as_ref().is_some_and(|m| !m.measure_lengths.is_empty()) {
            return Err("不完整小节需要第 12 版曲目包，请使用新版软件重新导出".into());
        }
        if manifest.version<10 && manifest.meter_map.is_some(){return Err("分段拍号需要第 10 版曲目包，请使用新版软件重新导出".into());}
        if manifest.version<11 && manifest.papers.iter().any(|p|!p.note_anchors.is_empty()){return Err("逐音纸谱位置需要第 11 版曲目包，请使用新版软件重新导出".into());}
        if manifest.version<9&&manifest.papers.iter().any(|p|p.annotations.iter().any(|n|n.ink.is_some())){return Err("手写笔迹需要第 9 版曲目包，请使用新版软件重新导出".into());}
        if manifest.version<3&&manifest.papers.iter().any(|p|p.mapping.is_some()){return Err("谱页小节对应需要第 3 版曲目包".into());}
        if manifest.version<4&&manifest.papers.iter().any(|p|!p.annotations.is_empty()){return Err("谱页批注需要第 4 版曲目包".into());}
        if manifest.midi.path != "performance.mid"
            || manifest.scores.len() > 100
            || manifest.passages.len() > 200
            || manifest.rating > 5
            || manifest.title.len() > 1024
            || manifest
                .active_score
                .is_some_and(|i| i >= manifest.scores.len())
        {
            return Err("曲目包清单范围无效".into());
        }
        crate::score_attachments::validate_package(
            &manifest.papers,
            manifest.active_paper,
            &files,
        )?;
        if manifest.ladders.len() > 200 {
            return Err("速度阶梯数量超过上限".into());
        }
        let mut used = BTreeSet::new();
        for a in std::iter::once(&manifest.midi)
            .chain(&manifest.scores)
            .chain(manifest.papers.iter().flat_map(|p| &p.pages))
        {
            check()?;
            if !used.insert(&a.path) {
                return Err("曲目包重复引用文件".into());
            }
            let data = files.get(&a.path).ok_or("曲目包缺少声明的文件")?;
            if data.len() != a.size || blake3::hash(data).to_hex().as_str() != a.hash {
                return Err(format!("曲目包文件校验失败：{}", a.name));
            }
        }
        if used.len() != files.len() {
            return Err("曲目包包含未声明的文件".into());
        }
        let midi = &files[&manifest.midi.path];
        check()?;
        let smf = midi_file::midly::Smf::parse(midi).map_err(|e| e.to_string())?;
        let file = MidiFile::from_smf(&manifest.title, &smf)?;
        check()?;
        if blake3::hash(midi).to_hex().as_str() != manifest.content_id {
            return Err("曲目包 MIDI 身份不一致".into());
        }
        if manifest.practice_loop.as_ref().is_some_and(|p| {
            !p.start.is_finite()
                || !p.end.is_finite()
                || p.start < 0.
                || p.end <= p.start
                || p.end > file.duration.as_secs_f64() + 0.0001
        }) {
            return Err("曲目包当前练习范围无效".into());
        }
        let valid = |track, index| {
            file.tracks
                .iter()
                .find(|t| t.track_id == track)
                .and_then(|t| t.notes.get(index))
                .is_some()
        };
        panthesia_core::song_config::SongConfig::new(&file.tracks)
            .set_note_playback_rules(&manifest.note_playback, &file)?;
        if manifest
            .fingerings
            .iter()
            .any(|h| !valid(h.track_id, h.note_index) || !(1..=5).contains(&h.finger))
            || manifest
                .hands
                .iter()
                .any(|h| !valid(h.track_id, h.note_index))
            || manifest
                .track_parts
                .keys()
                .any(|id| !file.tracks.iter().any(|t| t.track_id == *id))
        {
            return Err("曲目包的音符标注无效".into());
        }
        if !manifest.finger_actions.is_empty() && manifest.version<6{return Err("持音换指需要第 6 版曲目包".into());}
        panthesia_core::library::normalize_finger_actions(manifest.finger_actions.clone()).map_err(|e|e.to_string())?;
        if manifest.finger_actions.iter().any(|a|!valid(a.track_id,a.note_index)||!valid(a.before_track,a.before_index)||file.tracks.iter().find(|t|t.track_id==a.track_id).and_then(|t|t.notes.get(a.note_index)).is_some_and(|n|{let at=file.tempo_track.pulses_to_duration(a.at_tick);at<=n.start||at>=n.start+n.duration})){return Err("曲目包的换指音符或时刻无效".into());}
        for (id,a) in &manifest.track_appearances{a.validate()?;if !file.tracks.iter().any(|t|t.track_id==*id&&!t.notes.is_empty()){return Err("曲目包音轨名称或颜色的音轨不存在".into())}}
        if manifest.track_sounds.iter().any(|(id,s)| !file.tracks.iter().any(|t|t.track_id==*id&&!t.notes.is_empty())||s.volume>100||s.pan.is_some_and(|p|p>127)||s.program.is_some_and(|p|p>127)){return Err("曲目包音轨声音设置无效".into())}
        if !manifest.track_sounds.is_empty(){let events:Vec<_>=file.tracks.iter().flat_map(|t|t.events.iter().cloned()).collect();crate::track_sound::Routing::build(&events)?;}
        let mut grid_file=file.clone();
        grid_file.musical_time=crate::Player::sidecar_grid(&file,&panthesia_core::library::SongSidecar{meter:manifest.meter,meter_map:manifest.meter_map.clone(),..Default::default()})?;
        let bars = grid_file.musical_time.measures.len();
        let grid=crate::practice_conditions::grid(&grid_file);
        for paper in &manifest.papers {
            check()?;
            for anchor in &paper.note_anchors {
                let note=file.tracks.iter().find(|t|t.track_id==anchor.track).and_then(|t|t.notes.get(anchor.index)).ok_or("曲目包逐音位置的音符身份无效")?;
                let tick=file.tempo_track.seconds_to_pulses(note.start.as_secs_f64()).round() as u64;
                let measure=grid_file.musical_time.measures.partition_point(|m|m.start_tick<=tick);
                if note.note!=anchor.pitch||anchor.grid==grid&&measure!=anchor.measure {return Err("曲目包逐音位置与 MIDI 音符或小节网格不符".into());}
            }
        }
        if manifest
            .settings
            .mode
            .as_deref()
            .is_some_and(crate::is_recital_mode)
            && manifest.practice_loop.is_some()
        {
            return Err("完整演奏曲目包不能包含当前循环范围".into());
        }
        let settings_valid = |s: &SessionSettings| {
            (-500..=500).contains(&s.latency)
                && s.count_in <= 4
                && s.rounds <= 100
                && ["both", "left", "right", "custom"].contains(&s.hands.as_str())
                && s.mode.as_ref().is_none_or(|m| {
                    ["wait", "flow", "listen", "recital", "memory"].contains(&m.as_str())
                })
                && s.tracks
                    .iter()
                    .all(|t| file.tracks.iter().any(|track| track.track_id == t.track_id))
        };
        if !(0.25..=2.).contains(&manifest.speed)
            || !settings_valid(&manifest.settings)
            || manifest.passages.iter().any(|p| {
                p.start == 0
                    || p.end < p.start
                    || p.end > bars
                    || p.name.trim().is_empty()
                    || p.name.len() > 512
                    || p.notes.len() > 8192
                    || !(0.25..=2.).contains(&p.speed)
                    || !settings_valid(&p.settings)
                    || p.settings
                        .mode
                        .as_deref()
                        .is_some_and(crate::is_recital_mode)
            })
        {
            return Err("曲目包的练习设置或小节范围无效".into());
        }
        for p in &manifest.passages {
            if p.practice.is_some() { if manifest.version < 16 { return Err("段落练习版本需要第 16 版曲目包".into()); } p.practice_edition(&manifest.content_id)?; }
            let effective = if p.practice.is_some() { Some(crate::practice_variant::transform(&file, &p.practice_edition(&manifest.content_id)?.transform)?) } else { None };
            let passage_file = effective.as_ref().unwrap_or(&file);
            if let Some(r)=&p.precise_range {r.validate()?;if manifest.version<7 || r.content_id!=manifest.content_id || p.score_range.is_some() || r.end_tick>passage_file.tempo_track.seconds_to_pulses(passage_file.duration.as_secs_f64()).round()as u64 {return Err("拍内段落需要第 7 版曲目包及正确归属".into())}}
            if let Some(range)=&p.score_range {
                if (range.start_trim>0||range.end_trim>0)&&manifest.version<8{return Err("原谱拍内端点需要第 8 版曲目包".into());}
                if manifest.version<5{return Err("原谱练习段需要第 5 版曲目包".into());}
                range.validate()?;
                if range.end_tick > passage_file.tempo_track.seconds_to_pulses(passage_file.duration.as_secs_f64()).round() as u64 {
                    return Err("原谱练习段超出曲目时长".into());
                }
            }
        }
        if !manifest.bookmarks.is_empty()&&manifest.version<18{return Err("演奏书签需要第 18 版曲目包".into());}
        panthesia_core::song_bookmarks::validate(&manifest.bookmarks)?;
        let last_tick=file.tempo_track.seconds_to_pulses(file.duration.as_secs_f64()).round() as u64;
        if manifest.bookmarks.iter().any(|row|row.tick>last_tick){return Err("曲目包书签超出原演奏范围".into());}
        let mut ladder_ids = BTreeSet::new();
        for l in &manifest.ladders {
            if l.practice.is_some() && manifest.version < 17 {return Err("阶梯练习版本需要第 17 版曲目包".into());}
            let edition=panthesia_core::song_project::PracticeEdition::resolve(l.practice.as_ref(), &manifest.content_id, &l.grid)?;
            let ladder_bars=if l.practice.is_some(){crate::practice_variant::transform(&file,&edition.transform)?.musical_time.measures.len()}else{bars};
            l.plan.validate()?;
            if let Some(goal)=&l.expression { goal.validate(l.settings.mode.as_deref().unwrap_or("wait"))?; }
            if l.id.is_empty()
                || l.id.len() > 160
                || !ladder_ids.insert(&l.id)
                || l.name.trim().is_empty()
                || l.name.chars().count() > 80
                || l.start == 0
                || l.end < l.start
                || l.end > ladder_bars
                || l.grid.len() > 160
                || l.scope.len() > 160
                || l.exercise_spec.is_some()
                || !settings_valid(&l.settings)
                || !matches!(l.settings.mode.as_deref(), Some("wait" | "flow"))
                || (l.settings.mode.as_deref() == Some("wait") && l.plan.on_time_percent.is_some())
            {
                return Err("曲目包速度阶梯规则无效".into());
            }
        }
        if manifest.groups.len() > 200
            || manifest.groups.iter().any(|g| {
                g.is_empty()
                    || g.len() > 20
                    || g.iter()
                        .any(|n| n.trim().is_empty() || n.chars().count() > 80)
            })
        {
            return Err("曲目包分组无效".into());
        }
        for score in &manifest.scores {
            panthesia_core::musicxml::import_musicxml_document(&files[&score.path])
                .map_err(|e| format!("曲目包谱面无效：{e}"))?;
        }
        Ok(Self { manifest, files })
    }
    pub fn summary(&self) -> serde_json::Value {
        serde_json::json!({"title":self.manifest.title,"contentId":self.manifest.content_id,"metadata":self.manifest.metadata,"scores":self.manifest.scores.iter().map(|s|&s.name).collect::<Vec<_>>(),"papers":self.manifest.papers.iter().map(|p|serde_json::json!({"name":p.name,"format":p.format,"pages":p.pages.len(),"annotations":p.annotations.len(),"mappingPoints":p.mapping.as_ref().map_or(0,|m|m.anchors.len()),"autoTurn":p.mapping.as_ref().is_some_and(|m|m.enabled)})).collect::<Vec<_>>(),"ladders":self.manifest.ladders.iter().map(|l|&l.name).collect::<Vec<_>>(),"trackSounds":self.manifest.track_sounds.len(),"trackAppearances":self.manifest.track_appearances.iter().map(|(id,a)|serde_json::json!({"id":id,"name":a.name.clone().unwrap_or_else(||format!("音轨 {}",id+1)),"color":a.color})).collect::<Vec<_>>(),"fingerings":self.manifest.fingerings.len(),"fingerActions":self.manifest.finger_actions.len(),"hands":self.manifest.hands.len(),"notePlayback":self.manifest.note_playback.len(),"bookmarks":self.manifest.bookmarks.iter().map(|row|&row.name).collect::<Vec<_>>(),"passages":self.manifest.passages.iter().map(|p|&p.name).collect::<Vec<_>>(),"groups":self.manifest.groups,"rating":self.manifest.rating,"provenance":self.manifest.provenance})
    }
}
