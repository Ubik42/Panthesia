//! File-backed song preparation. The runtime installs owned results, without reparsing scores.
use crate::{Player, notation, preferences::ScoreVersion};
use midi_file::{MidiFile, musical_time::MusicalTime};
use panthesia_core::library::{self, SongSidecar};
use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(PartialEq)]
struct Stamp {
    len: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
}
fn stamp(path: &Path) -> Result<Option<Stamp>, String> {
    match std::fs::metadata(path) {
        Ok(value) => Ok(Some(Stamp {
            len: value.len(),
            modified: value.modified().ok(),
            created: value.created().ok(),
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法检查曲目资料 {}：{error}", path.display())),
    }
}
pub(crate) struct Watch {
    path: PathBuf,
    stamp: Option<Stamp>,
}
impl Watch {
    pub(crate) fn capture(path: &Path) -> Result<Self, String> {
        Ok(Self {
            path: path.into(),
            stamp: stamp(path)?,
        })
    }
    pub(crate) fn check(&self) -> Result<(), String> {
        if stamp(&self.path)? != self.stamp {
            return Err(format!(
                "加载准备期间文件已改变，请重新打开：{}",
                self.path.display()
            ));
        }
        Ok(())
    }
}
#[derive(Clone)]
pub(crate) struct Assets {
    pub sidecar: Option<SongSidecar>,
    pub grid: Option<MusicalTime>,
    pub notation: Option<notation::ScoreAsset>,
    pub error: Option<String>,
}
impl Assets {
    /// Reuse the selected, aligned score after its association has been saved.
    /// Reading the sidecar again retains the same meter, hands and finger restoration.
    pub(crate) fn read_selected(
        file: &MidiFile,
        path: &Path,
        score: notation::ScoreAsset,
    ) -> Result<Self, String> {
        let sidecar = library::load_song_sidecar(path, &file.content_id)
            .map_err(|error| format!("曲目附加信息读取失败：{error}"))?;
        if sidecar
            .score
            .as_ref()
            .map(|association| association.content_id.as_str())
            != Some(score.source_fingerprint.as_str())
        {
            return Err("保存后的谱面关联与所选版本不一致，请重新读取曲库。".into());
        }
        let grid = if sidecar.meter_map.is_some() || sidecar.meter.is_some() {
            Some(Player::sidecar_grid(file, &sidecar)?)
        } else {
            None
        };
        Ok(Self {
            sidecar: Some(sidecar),
            grid,
            notation: Some(score),
            error: None,
        })
    }
    pub fn read(file: &MidiFile, path: &Path, versions: &[ScoreVersion]) -> Self {
        Self::read_checked(file, path, versions, &|| Ok(())).unwrap_or_else(|error| Self {
            sidecar: None,
            grid: None,
            notation: None,
            error: Some(error),
        })
    }
    pub(crate) fn read_checked(
        file: &MidiFile,
        path: &Path,
        versions: &[ScoreVersion],
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        check()?;
        let mut result = Self {
            sidecar: None,
            grid: None,
            notation: None,
            error: None,
        };
        match library::load_song_sidecar(path, &file.content_id) {
            Ok(sidecar) => {
                if sidecar.meter_map.is_some() || sidecar.meter.is_some() {
                    match Player::sidecar_grid(file, &sidecar) {
                        Ok(grid) => result.grid = Some(grid),
                        Err(error) => result.error = Some(format!("小节设置无法恢复：{error}")),
                    }
                }
                check()?;
                if let Some(association) = &sidecar.score {
                    let score_path = library::resolve_score_path(path, association);
                    let mut aligned_file = file.clone();
                    if let Some(grid) = &result.grid {
                        aligned_file.measures = grid.bar_times(&file.tempo_track).into();
                        aligned_file.beats = grid.beat_times(&file.tempo_track).into();
                        aligned_file.musical_time = grid.clone();
                    }
                    // Read once: hash, parse and align the same owned bytes.
                    match panthesia_core::utils::atomic_file::read_dependency(
                        &score_path,
                        4_000_000,
                    )
                    .map_err(|e| format!("乐谱已更改或丢失：{e}"))
                    .and_then(|bytes| {
                        if blake3::hash(&bytes).to_hex().as_str() != association.content_id {
                            return Err("乐谱已更改或丢失：内容校验不一致，请重新配对乐谱".into());
                        }
                        let name = versions
                            .iter()
                            .find(|v| v.path == score_path)
                            .map(|v| v.name.clone())
                            .unwrap_or_else(|| {
                                score_path
                                    .file_name()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .into()
                            });
                        check()?;
                        notation::ScoreAsset::new_checked(bytes, name, &aligned_file, check)
                            .map_err(|e| format!("乐谱无法恢复：{e}"))
                    }) {
                        Ok(score) => result.notation = Some(score),
                        Err(error) => result.error = Some(error),
                    }
                }
                result.sidecar = Some(sidecar);
            }
            Err(library::MetadataError::Read(error))
                if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => result.error = Some(format!("曲目附加信息读取失败：{error}")),
        }
        check()?;
        Ok(result)
    }
}
pub(crate) struct Prepared {
    pub file: MidiFile,
    pub title: String,
    pub assets: Assets,
    pub timeline: Timeline,
    watches: Vec<Watch>,
}
pub(crate) struct InstallData {
    pub assets: Option<Assets>,
    pub timeline: Timeline,
}
#[derive(Clone)]
pub(crate) struct Timeline {
    pub notes: crate::PracticeNotes,
    pub events: crate::PlaybackEvents,
    pub sound: std::sync::Arc<crate::track_sound::Timeline>,
    pub event_notes: crate::EventNotes,
    pub duration: f64,
}
impl Timeline {
    pub(super) fn capture(player: &crate::Player) -> Self {
        Self {
            notes: player.notes.clone(),
            events: player.events.clone(),
            sound: player.sound_timeline.clone(),
            event_notes: player.event_notes.clone(),
            duration: player.state.duration,
        }
    }
    pub fn new(file: &MidiFile) -> Result<Self, String> {
        Self::new_checked(file, &|| Ok(()))
    }
    pub(crate) fn new_checked(
        file: &MidiFile,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        check()?;
        let mut notes = Vec::new();
        for track in file
            .tracks
            .iter()
            .filter(|track| !track.has_drums || track.has_other_than_drums)
        {
            for (index, note) in track.notes.iter().enumerate() {
                if index % 1024 == 0 {
                    check()?;
                }
                notes.push(crate::PracticeNote {
                    inner: note.clone(),
                    index,
                });
            }
        }
        check()?;
        notes.sort_by_key(|note| (note.start, note.track_id, note.note));
        check()?;
        if notes.is_empty() {
            return Err("这首 MIDI 没有可练习的钢琴音符".into());
        }
        let mut duration = file.duration.as_secs_f64();
        let mut event_notes = std::collections::HashMap::new();
        for (index, note) in notes.iter().enumerate() {
            if index % 1024 == 0 {
                check()?;
            }
            duration = duration.max(note.end.as_secs_f64());
            event_notes.insert(
                (note.track_id, note.channel, note.note, note.start, true),
                note.index,
            );
            event_notes.insert(
                (note.track_id, note.channel, note.note, note.end, false),
                note.index,
            );
        }
        let mut events = Vec::new();
        for track in file.tracks.iter() {
            for chunk in track.events.chunks(1024) {
                check()?;
                events.extend_from_slice(chunk);
            }
        }
        check()?;
        events.sort_by_key(|event| event.timestamp);
        check()?;
        let sound = std::sync::Arc::new(crate::track_sound::Timeline::new_checked(&events, check)?);
        check()?;
        Ok(Self {
            sound,
            notes: notes.into(),
            events: events.into(),
            event_notes: event_notes.into(),
            duration,
        })
    }
}
pub(crate) enum Input {
    File {
        path: PathBuf,
        title: String,
        expected: Option<String>,
    },
    Recent {
        content_id: String,
        title: String,
        paths: Vec<PathBuf>,
    },
}
impl Input {
    pub fn expected(&self) -> Option<String> {
        match self {
            Self::File { expected, .. } => expected.clone(),
            Self::Recent { content_id, .. } => Some(content_id.clone()),
        }
    }
    pub fn read(
        self,
        data: &Path,
        mut names: impl FnMut(&str) -> Result<Vec<ScoreVersion>, String>,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<Prepared, String> {
        check()?;
        match self {
            Self::File {
                path,
                title,
                expected,
            } => Prepared::read_checked(path, title, expected.as_deref(), names, &check),
            Self::Recent {
                content_id,
                title,
                paths,
            } => {
                let index = crate::library_workspace::Workspace::load_hint(data)?;
                for path in crate::library::candidate_paths(&index, &content_id, paths) {
                    check()?;
                    if let Ok(prepared) = Prepared::read_checked(
                        path,
                        title.clone(),
                        Some(&content_id),
                        &mut names,
                        &check,
                    ) {
                        return Ok(prepared);
                    }
                }
                check()?;
                Err("曲目文件缺失、内容改变或无法读取，请定位同一内容的文件后重试".into())
            }
        }
    }
}
impl Prepared {
    pub fn read(
        path: PathBuf,
        title: String,
        expected: Option<&str>,
        names: impl FnOnce(&str) -> Result<Vec<ScoreVersion>, String>,
    ) -> Result<Self, String> {
        Self::read_checked(path, title, expected, names, &|| Ok(()))
    }
    pub(crate) fn read_checked(
        path: PathBuf,
        title: String,
        expected: Option<&str>,
        names: impl FnOnce(&str) -> Result<Vec<ScoreVersion>, String>,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        check()?;
        let path = std::path::absolute(path).map_err(|e| format!("曲目位置无法解析：{e}"))?;
        let watch = Watch::capture(&path)?;
        let file = crate::library::read_midi(&path).map_err(|e| format!("曲目加载失败：{e}"))?;
        check()?;
        if expected.is_some_and(|id| id != file.content_id) {
            return Err("曲库索引中的文件内容已改变，请重新检查这首曲目".into());
        }
        Self::from_verified_checked(file, title, watch, names, check)
    }
    pub(crate) fn from_verified(
        file: MidiFile,
        title: String,
        watch: Watch,
        names: impl FnOnce(&str) -> Result<Vec<ScoreVersion>, String>,
    ) -> Result<Self, String> {
        Self::from_verified_checked(file, title, watch, names, &|| Ok(()))
    }
    pub(crate) fn from_verified_checked(
        file: MidiFile,
        title: String,
        watch: Watch,
        names: impl FnOnce(&str) -> Result<Vec<ScoreVersion>, String>,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        check()?;
        let path = file.source_path.clone().ok_or("曲目缺少已核对的文件位置")?;
        if watch.path != path {
            return Err("曲目读取与文件观察位置不一致".into());
        }
        let mut watches = vec![watch];
        let timeline = Timeline::new_checked(&file, check)?;
        let versions = names(&file.content_id)?;
        watches.push(Watch::capture(&library::metadata_sidecar_path(&path))?);
        // Capture the linked path before the score read. The second sidecar read
        // below is guarded, including a previously absent sidecar appearing.
        if let Ok(sidecar) = library::load_song_sidecar(&path, &file.content_id) {
            if let Some(association) = sidecar.score {
                watches.push(Watch::capture(&library::resolve_score_path(
                    &path,
                    &association,
                ))?);
            }
        }
        let assets = Assets::read_checked(&file, &path, &versions, check)?;
        let prepared = Self {
            file,
            title,
            assets,
            timeline,
            watches,
        };
        check()?;
        prepared.check()?;
        Ok(prepared)
    }
    pub fn check(&self) -> Result<(), String> {
        for watch in &self.watches {
            watch.check()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Command, Engine, data_root_lock::DataRootLock, runtime_request::Request};
    use panthesia_core::{
        exercise::ExerciseSpec,
        library::{FingerHint, MeterCorrection, NoteHandHint},
        practice::PracticePart,
    };
    use std::{
        sync::mpsc,
        thread,
        time::{Duration, Instant, UNIX_EPOCH},
    };
    const SCORE: &[u8] = include_bytes!("../../panthesia-core/src/score_performance_test.musicxml");
    fn root() -> PathBuf {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/load-unit")
            .join(format!(
                "{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        std::fs::create_dir_all(&root).unwrap();
        root
    }
    fn engine() -> Engine {
        let root = root();
        let lock = DataRootLock::acquire(&root).unwrap();
        Engine::start(root, lock, PathBuf::new(), true).unwrap()
    }
    fn file(root: &Path) -> PathBuf {
        let path = root.join("课堂.mid");
        std::fs::write(&path, include_bytes!("../assets/five-finger.mid")).unwrap();
        path
    }
    #[test]
    fn public_load_and_recent_restore_saved_assets_at_relocated_path() {
        let engine = engine();
        let song = engine
            .command(Command::ImportScore {
                bytes: SCORE.to_vec(),
                name: "课堂谱面.musicxml".into(),
                default_bpm: 120,
            })
            .unwrap();
        let cid = song["contentId"].as_str().unwrap().to_owned();
        let old = PathBuf::from(song["sourcePath"].as_str().unwrap());
        let mut sidecar = library::load_song_sidecar(&old, &cid).unwrap();
        sidecar.metadata.title = Some("保存的课程名称".into());
        let midi = MidiFile::new(&old).unwrap();
        let track = midi
            .tracks
            .iter()
            .find(|t| !t.notes.is_empty())
            .unwrap()
            .track_id;
        sidecar.fingerings = vec![FingerHint {
            track_id: track,
            note_index: 0,
            finger: 4,
        }];
        sidecar.hands = vec![NoteHandHint {
            track_id: track,
            note_index: 0,
            part: PracticePart::LeftHand,
        }];
        sidecar.meter = Some(MeterCorrection {
            numerator: 3,
            denominator: 4,
            pickup_ticks: 0,
        });
        library::save_song_sidecar(&old, &cid, sidecar).unwrap();
        let names = vec![];
        let prepared =
            Prepared::read(old.clone(), "fallback".into(), Some(&cid), |_| Ok(names)).unwrap();
        let grid = prepared.assets.grid.as_ref().unwrap().clone();
        let mut corrected = prepared.file.clone();
        corrected.musical_time = grid;
        let expected =
            notation::ScoreAsset::new(SCORE.to_vec(), "课堂谱面.musicxml".into(), &corrected)
                .unwrap();
        assert_eq!(
            prepared.assets.notation.as_ref().unwrap().alignment,
            expected.alignment
        );
        let restored = engine
            .command(Command::LoadIndexed {
                path: old.clone(),
                title: "fallback".into(),
                content_id: cid.clone(),
            })
            .unwrap();
        assert_eq!(restored["title"], "保存的课程名称");
        assert_eq!(restored["hasScore"], true);
        assert_eq!(
            engine.command(Command::Score).unwrap()["name"],
            "课堂谱面.musicxml"
        );
        let moved = engine.data.join("移动后的课堂.mid");
        std::fs::rename(&old, &moved).unwrap();
        std::fs::rename(
            library::metadata_sidecar_path(&old),
            library::metadata_sidecar_path(&moved),
        )
        .unwrap();
        let mut index = crate::library_workspace::Workspace::load(&engine.data).unwrap();
        index.inspect(moved.clone(), true).unwrap();
        index.save(&engine.data).unwrap();
        engine
            .command(Command::Generate {
                spec: ExerciseSpec::default(),
            })
            .unwrap();
        let recent = engine
            .command(Command::OpenRecent { content_id: cid })
            .unwrap();
        assert_eq!(recent["sourcePath"], moved.to_string_lossy().as_ref());
        assert_eq!(recent["hasScore"], true);
        assert_eq!(recent["title"], "保存的课程名称");
        assert_eq!(recent["meterMap"]["segments"][0]["numerator"], 3);
        let first = recent["notes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["track"] == track && n["index"] == 0)
            .unwrap();
        assert_eq!(first["finger"], 4);
        assert_eq!(first["part"], "left");
    }
    #[test]
    fn changed_score_bytes_are_rejected_without_overwriting_saved_association() {
        let engine = engine();
        let song = engine
            .command(Command::ImportScore {
                bytes: SCORE.to_vec(),
                name: "课程.musicxml".into(),
                default_bpm: 120,
            })
            .unwrap();
        let path = PathBuf::from(song["sourcePath"].as_str().unwrap());
        let cid = song["contentId"].as_str().unwrap();
        let sidecar = library::load_song_sidecar(&path, cid).unwrap();
        let score_path = library::resolve_score_path(&path, sidecar.score.as_ref().unwrap());
        let prepared =
            Prepared::read(path.clone(), "课程".into(), Some(cid), |_| Ok(vec![])).unwrap();
        let changed = String::from_utf8(SCORE.to_vec())
            .unwrap()
            .replace("</score-partwise>", "<!-- changed --> </score-partwise>");
        std::fs::write(&score_path, changed.as_bytes()).unwrap();
        assert!(prepared.check().unwrap_err().contains("文件已改变"));
        let opened = engine
            .command(Command::Load {
                path: path.clone(),
                title: "课程".into(),
            })
            .unwrap();
        assert_eq!(opened["hasScore"], false);
        assert!(engine.snapshot().error.unwrap().contains("内容校验不一致"));
        assert_eq!(
            library::load_song_sidecar(&path, cid).unwrap().score,
            sidecar.score
        );
        assert_eq!(std::fs::read(&score_path).unwrap(), changed.as_bytes());
    }
    #[test]
    fn invalid_or_mismatched_load_keeps_the_current_song() {
        let engine = engine();
        let song = engine
            .command(Command::Generate {
                spec: ExerciseSpec::default(),
            })
            .unwrap();
        let path = file(&engine.data);
        assert!(
            engine
                .command(Command::LoadIndexed {
                    path: path.clone(),
                    title: "wrong".into(),
                    content_id: "different".into()
                })
                .is_err()
        );
        std::fs::write(&path, b"invalid midi").unwrap();
        assert!(
            engine
                .command(Command::Load {
                    path,
                    title: "invalid".into()
                })
                .unwrap_err()
                .contains("曲目加载失败")
        );
        assert_eq!(
            engine.command(Command::CurrentSong).unwrap()["contentId"],
            song["contentId"]
        );
    }
    #[test]
    fn prepared_load_checks_file_and_new_sidecar_before_install() {
        let root = root();
        let path = file(&root);
        let prepared = Prepared::read(path.clone(), "课程".into(), None, |_| Ok(vec![])).unwrap();
        std::fs::write(library::metadata_sidecar_path(&path), b"new annotations").unwrap();
        assert!(prepared.check().unwrap_err().contains("文件已改变"));
        let prepared = Prepared::read(path.clone(), "课程".into(), None, |_| Ok(vec![])).unwrap();
        std::fs::write(&path, include_bytes!("../assets/basic-chords.mid")).unwrap();
        assert!(prepared.check().is_err());
    }
    #[test]
    fn ready_load_rechecks_song_recording_files_and_cancellation() {
        for change in ["song", "recording", "file", "sidecar", "cancel"] {
            let engine = engine();
            let song = engine
                .command(Command::Generate {
                    spec: ExerciseSpec::default(),
                })
                .unwrap();
            let path = file(&engine.data);
            let (reply, response) = mpsc::sync_channel(1);
            engine.tx.send(Request::ImportContext(reply)).unwrap();
            let origin = response.recv().unwrap().unwrap();
            let (ready, started) = mpsc::channel();
            let (release, gate) = mpsc::channel();
            let worker = engine.clone();
            let pool = engine.tasks.clone();
            let target = path.clone();
            let job = thread::spawn(move || {
                pool.run("held load", None, move |token| {
                    let prepared = Prepared::read(target, "课程".into(), None, |_| Ok(vec![]))?;
                    ready.send(()).unwrap();
                    gate.recv().unwrap();
                    let (reply, response) = mpsc::sync_channel(1);
                    worker
                        .tx
                        .send(Request::LoadCommit(origin, prepared, token, reply))
                        .unwrap();
                    response.recv().unwrap()
                })
            });
            started.recv_timeout(Duration::from_secs(3)).unwrap();
            let start = Instant::now();
            engine.command(Command::Pause).unwrap();
            engine.command(Command::Panic).unwrap();
            assert!(start.elapsed() < Duration::from_secs(1));
            let mut retained = song["contentId"].clone();
            match change {
                "song" => {
                    let mut spec = ExerciseSpec::default();
                    spec.tonic = 7;
                    retained =
                        engine.command(Command::Generate { spec }).unwrap()["contentId"].clone();
                }
                "recording" => {
                    engine.command(Command::Recording { active: true }).unwrap();
                }
                "file" => std::fs::write(path, b"changed").unwrap(),
                "sidecar" => {
                    std::fs::write(library::metadata_sidecar_path(&path), b"new annotations")
                        .unwrap();
                }
                "cancel" => {
                    let tasks = engine.command(Command::Tasks).unwrap();
                    let id = tasks
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|t| t["label"] == "held load")
                        .unwrap()["id"]
                        .as_str()
                        .unwrap()
                        .into();
                    engine.command(Command::CancelTask { id }).unwrap();
                }
                _ => unreachable!(),
            }
            release.send(()).unwrap();
            assert!(job.join().unwrap().is_err(), "{change}");
            // Round-trip through the runtime, including any rejected late commit.
            assert_eq!(
                engine.command(Command::CurrentSong).unwrap()["contentId"],
                retained,
                "{change}"
            );
        }
    }
}
