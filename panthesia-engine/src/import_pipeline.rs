//! Parse imports without touching the player's state or user files.
use crate::{Command, Player, import_storage, library_workspace, notation};
use midi_file::MidiFile;
use panthesia_core::library::{FingerHint, SongMetadata, SongSidecar};
use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
};

pub(crate) enum Input {
    Midi {
        bytes: Vec<u8>,
        name: String,
    },
    Score {
        bytes: Vec<u8>,
        name: String,
        bpm: u16,
    },
    Original {
        path: PathBuf,
        bpm: u16,
    },
}
pub(crate) struct Origin {
    pub content_id: Option<String>,
    pub revision: u64,
}
pub(crate) struct Prepared {
    file: MidiFile,
    bytes: Vec<u8>,
    title: String,
    sidecar: Option<SongSidecar>,
    score: Option<notation::ScoreAsset>,
    warnings: Vec<String>,
    original: Option<(PathBuf, u16, String, String)>,
}
impl Prepared {
    pub(super) fn store_catalog(
        &mut self,
        data: &std::path::Path,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<crate::catalog_import::Published, String> {
        use panthesia_core::{library, utils::atomic_file};
        check()?;
        let cid = self.file.content_id.clone();
        // One performance owns one annotation document. Distinct written sources remain
        // independent score editions in the score registry, without duplicating MIDI.
        let stored = import_storage::store(&data.join("library/assets/midi"), &cid, &cid, &self.bytes)?;
        let path = stored.path.clone();
        crate::song_repository::SongRepository::open(data)?.prepare_import_annotations(&cid,&path,self.sidecar.clone())?;
        let mut sidecar = match library::load_song_sidecar(&path, &cid) {
            Ok(value) => value,
            Err(library::MetadataError::Read(error))
                if error.kind() == std::io::ErrorKind::NotFound =>
            {
                self.sidecar.clone().unwrap_or_default()
            }
            Err(error) => return Err(error.to_string()),
        };
        if sidecar
            .metadata
            .title
            .as_deref()
            .is_none_or(|title| title.trim().is_empty())
        {
            sidecar.metadata.title = Some(self.title.clone());
        }
        let mut score_warnings = Vec::new();
        let score = if let Some(score) = &self.score {
            let root = data.join("scores");
            let extension = if score.bytes.starts_with(b"PK") {
                "mxl"
            } else {
                "musicxml"
            };
            let stem = format!("catalog-{cid}-{}", score.source_fingerprint);
            let mut chosen = None;
            let mut restored_score = false;
            for index in 0..1000 {
                check()?;
                let candidate = root.join(if index == 0 {
                    format!("{stem}.{extension}")
                } else {
                    format!("{stem}-restored-{index}.{extension}")
                });
                match atomic_file::read_dependency(&candidate, 4_000_000) {
                    Ok(bytes)
                        if blake3::hash(&bytes).to_hex().as_str() == score.source_fingerprint =>
                    {
                        restored_score = index > 0;
                        chosen = Some(candidate);
                        break;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        atomic_file::write(&candidate, &score.bytes)
                            .map_err(|error| error.to_string())?;
                        restored_score = index > 0;
                        chosen = Some(candidate);
                        break;
                    }
                    _ => {}
                }
            }
            let stored_score = chosen.ok_or("谱面恢复副本过多，请先整理曲库")?;
            if restored_score {
                score_warnings.push(format!(
                    "原谱面文件已变化或无法读取，已保留原件；本次谱面保存到 {}",
                    stored_score.display()
                ));
            }
            let repair_association = sidecar.score.as_ref().is_some_and(|association| {
                association.content_id == score.source_fingerprint
                    && !library::verify_score_association(&path, association).unwrap_or(false)
            });
            if repair_association {
                score_warnings
                    .push("原谱面关联已失效，已关联本次核对完整的谱面副本；原件保留。".into());
            } else if sidecar
                .score
                .as_ref()
                .is_some_and(|association| association.content_id != score.source_fingerprint)
            {
                score_warnings
                    .push("已保留原有谱面关联；本次谱面加入版本列表，可打开练习后切换。".into());
            }
            if sidecar.score.is_none() || repair_association {
                sidecar.score = Some(library::ScoreAssociation {
                    path: stored_score.clone(),
                    content_id: score.source_fingerprint.clone(),
                });
            }
            Some(crate::preferences::ScoreVersion {
                id: format!(
                    "catalog-{}",
                    blake3::hash(
                        format!("{cid}:{}:{}", score.source_fingerprint, score.name).as_bytes()
                    )
                    .to_hex()
                ),
                name: score.name.clone(),
                path: stored_score,
                content_id: score.source_fingerprint.clone(),
            })
        } else {
            None
        };
        library::save_song_sidecar(&path, &cid, sidecar.clone())
            .map_err(|error| error.to_string())?;
        self.file.source_path = Some(path.clone());
        let mut index = library_workspace::Workspace::load(data)?;
        index.inspect_prepared(path.clone(), &self.file)?;
        check()?;
        index.save(data)?;
        let mut warnings = self.warnings.clone();
        warnings.extend(stored.warning());
        warnings.extend(score_warnings);
        Ok(crate::catalog_import::Published {
            song: crate::music_import::ImportedSong {
                content_id: cid,
                title: sidecar.metadata.title.unwrap_or_else(|| self.title.clone()),
                source_path: path.to_string_lossy().into(),
                import_warnings: warnings,
                catalog_only: true,
            },
            score,
        })
    }
    pub fn content_id(&self) -> String {
        self.file.content_id.clone()
    }
    pub fn fingerprint(&self) -> String {
        self.score
            .as_ref()
            .map(|s| s.source_fingerprint.clone())
            .unwrap_or_else(|| self.content_id())
    }
}
pub(crate) fn prepare(input: Input) -> Result<Prepared, String> {
    prepare_checked(input, &|| Ok(()))
}
pub(crate) fn prepare_checked(
    input: Input,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Prepared, String> {
    check()?;
    let (bytes, name, bpm, original) = match input {
        Input::Midi { bytes, name } => (bytes, name, None, None),
        Input::Score { bytes, name, bpm } => (bytes, name, Some(bpm), None),
        Input::Original { path, bpm } => {
            let bytes = crate::score_sources::read_original(&path)?;
            let hash = blake3::hash(&bytes).to_hex().to_string();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            (
                bytes,
                name.clone(),
                Some(bpm),
                Some((path, bpm, hash, name)),
            )
        }
    };
    check()?;
    let fallback = PathBuf::from(&name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let mut prepared = if let Some(bpm) = bpm {
        if bytes.is_empty() || bytes.len() > 4_000_000 {
            return Err("乐谱文件为空或超过 4 MB".into());
        }
        let score = panthesia_core::musicxml::import_musicxml_document(&bytes)
            .map_err(|e| format!("乐谱无法读取，请检查 MusicXML 或 MXL 文件：{e}"))?;
        check()?;
        let performance = panthesia_core::score_performance::generate_checked(&score, bpm, check)?;
        check()?;
        let file = MidiFile::from_smf(&name, &performance.smf)?;
        let title = score.title.clone().unwrap_or(fallback);
        let mut midi_bytes = Vec::new();
        performance
            .smf
            .write_std(&mut midi_bytes)
            .map_err(|e| e.to_string())?;
        let mut track_parts = BTreeMap::new();
        let mut fingerings = Vec::new();
        for (i, staff) in performance.tracks.iter().enumerate() {
            check()?;
            let mut hints = HashMap::new();
            for (index, note) in staff.notes.iter().enumerate() {
                if index % 1024 == 0 {
                    check()?;
                }
                hints.insert((note.start, note.pitch), note.finger);
            }
            let track = &file.tracks[i + 1];
            track_parts.insert(track.track_id, staff.part);
            for (index, note) in track.notes.iter().enumerate() {
                if index % 1024 == 0 {
                    check()?;
                }
                let tick = file
                    .tempo_track
                    .seconds_to_pulses(note.start.as_secs_f64())
                    .round() as u64;
                if let Some(finger) = hints.get(&(tick, note.note)).copied().flatten() {
                    fingerings.push(FingerHint {
                        track_id: track.track_id,
                        note_index: index,
                        finger,
                    });
                }
            }
        }
        let sidecar = SongSidecar {
            metadata: SongMetadata {
                title: Some(title.clone()),
                composer: score.composer.clone(),
                tags: vec!["乐谱导入".into()],
                notes: (!performance.warnings.is_empty()).then(|| performance.warnings.join("；")),
                ..Default::default()
            },
            track_parts,
            fingerings,
            ..Default::default()
        };
        let asset = notation::ScoreAsset::from_document_checked(bytes, name, score, &file, check)?;
        Prepared {
            file,
            bytes: midi_bytes,
            title,
            sidecar: Some(sidecar),
            score: Some(asset),
            warnings: performance.warnings,
            original,
        }
    } else {
        if bytes.is_empty() || bytes.len() > 32_000_000 {
            return Err("MIDI 文件为空或超过 32 MB".into());
        }
        let smf = midi_file::midly::Smf::parse(&bytes)
            .map_err(|e| format!("MIDI 无法读取，请检查文件是否完整：{e}"))?;
        let mut file = MidiFile::from_smf(name, &smf)?;
        // Preserve the original byte identity even for non-canonical SMF encoding.
        file.content_id = blake3::hash(&bytes).to_hex().to_string();
        Prepared {
            file,
            bytes,
            title: fallback,
            sidecar: None,
            score: None,
            warnings: Vec::new(),
            original: None,
        }
    };
    if !prepared
        .file
        .tracks
        .iter()
        .filter(|t| !t.has_drums || t.has_other_than_drums)
        .any(|t| !t.notes.is_empty())
    {
        return Err("这首 MIDI 没有可练习的钢琴音符".into());
    }
    check()?;
    prepared.file.source_path = None;
    Ok(prepared)
}

impl Player {
    pub(crate) fn pair_score_asset(
        &mut self,
        score: notation::ScoreAsset,
    ) -> Result<serde_json::Value, String> {
        self.install_score_asset(score, true)
    }
    fn install_score_asset(
        &mut self,
        score: notation::ScoreAsset,
        describe: bool,
    ) -> Result<serde_json::Value, String> {
        let content_id = score.content_id.clone();
        self.score_content_guard(&content_id)?;
        self.remember_active_score()?;
        if self
            .preferences
            .score_versions
            .get(&content_id)
            .is_some_and(|rows| {
                rows.len() >= 100
                    && !rows
                        .iter()
                        .any(|v| v.name == score.name && v.content_id == score.source_fingerprint)
            })
        {
            return Err("这首曲目已有 100 份谱面，请先移除不需要的版本".into());
        }
        let file = self.file.as_ref().ok_or("请先打开 MIDI")?;
        if file.content_id != content_id {
            return Err("曲目已切换，请重新配对乐谱".into());
        }
        self.state.error = None;
        self.panic();
        self.state.status = "paused".into();
        let path = self.store_score_version_file(&score, &content_id)?;
        let file = self.file.as_ref().unwrap();
        panthesia_core::library::save_score_association(
            &self.annotation_path(file)?,
            &content_id,
            &path,
        )
        .map_err(|e| e.to_string())?;
        self.notation = Some(std::sync::Arc::new(score));
        self.score_revision = self.score_revision.wrapping_add(1);
        self.remember_active_score()?;
        if describe {
            self.command(Command::Score)
        } else {
            Ok(serde_json::Value::Null)
        }
    }
    pub(super) fn check_unsaved_switch(&self) -> Result<(), String> {
        let score = self.matcher.snapshot();
        if self.has_save_error()
            && !self.state.saved
            && score.matched_notes + score.wrong_notes + score.missed_notes > 0
        {
            return Err("本轮保存失败，演奏结果仍保留在当前曲目中。请先重试保存本轮结果，再切换曲目或练习条件".into());
        }
        Ok(())
    }
    pub(crate) fn begin_import(&mut self) -> Result<Origin, String> {
        self.check_unsaved_switch()?;
        if self.recorder.is_recording() {
            return Err("请先停止录音，再切换曲目或练习设置".into());
        }
        self.panic();
        if matches!(self.state.status.as_str(), "playing" | "countIn") {
            self.state.status = "paused".into();
        }
        Ok(Origin {
            content_id: self.file.as_ref().map(|f| f.content_id.clone()),
            revision: self.score_revision,
        })
    }
    #[cfg(test)]
    pub(crate) fn check_import_origin(&self, origin: &Origin) -> Result<(), String> {
        self.check_switch_origin(origin, "导入")
    }
    pub(crate) fn check_switch_origin(&self, origin: &Origin, action: &str) -> Result<(), String> {
        if self.recorder.is_recording() {
            return Err(format!("请先停止录音，再{action}曲目"));
        }
        if self.file.as_ref().map(|f| &f.content_id) != origin.content_id.as_ref()
            || self.score_revision != origin.revision
        {
            return Err(format!("{action}准备期间曲目或谱面已切换，请重新{action}"));
        }
        Ok(())
    }
    pub(crate) fn install_import(
        &mut self,
        prepared: Prepared,
    ) -> Result<serde_json::Value, String> {
        self.install_import_described(prepared, true)
    }
    pub(super) fn install_import_described(
        &mut self,
        mut prepared: Prepared,
        describe_song: bool,
    ) -> Result<serde_json::Value, String> {
        if self.recorder.is_recording() {
            return Err("请先停止录音，再导入曲目".into());
        }
        if self.routine.is_some() {
            self.stop_routine()?;
        }
        self.panic();
        self.state.error = None;
        let lock = library_workspace::lock_for(&self.data)?;
        let _guard = lock.lock().map_err(|_| "曲库文件正忙")?;
        let cid = prepared.file.content_id.clone();
        let stored =
            import_storage::store(&self.data.join("library/assets/midi"), &cid, &cid, &prepared.bytes)?;
        let path = stored.path.clone();
        crate::song_repository::SongRepository::open(&self.data)?.prepare_import_annotations(&cid,&path,prepared.sidecar.take())?;
        prepared.file.source_path = Some(path.clone());
        let indexed = prepared.file.clone();
        self.install(prepared.file, prepared.title.clone(), None)?;
        self.persist()?;
        if let Some(score) = prepared.score {
            self.install_score_asset(score, false)?;
        }
        let mut index = library_workspace::Workspace::load(&self.data)?;
        let entry = index.inspect_prepared(path.clone(), &indexed)?;
        if entry
            .metadata
            .title
            .as_deref()
            .is_none_or(|v| v.trim().is_empty())
            && !prepared.title.trim().is_empty()
        {
            let mut metadata = entry.metadata;
            metadata.title = Some(prepared.title);
            panthesia_core::library::save_song_metadata(&path, &cid, metadata)
                .map_err(|e| e.to_string())?;
            index.inspect_prepared(path, &indexed)?;
        }
        index.save(&self.data)?;
        let mut result = if describe_song {
            self.command(Command::CurrentSong)?
        } else {
            let file = self.file.as_ref().ok_or("导入结果缺少演奏曲目")?;
            serde_json::json!({ "contentId":file.content_id, "title":self.title,
                "sourcePath":file.source_path })
        };
        prepared.warnings.extend(stored.warning());
        result["importRecovery"] = serde_json::json!(stored.recovery);
        result["importWarnings"] = serde_json::json!(prepared.warnings);
        // Source registration takes the workspace lock independently.
        drop(_guard);
        if let Some((path, bpm, hash, name)) = prepared.original {
            result = self.finish_original_import(path, bpm, hash, name, result)?;
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Engine, data_root_lock::DataRootLock};
    use panthesia_core::exercise::ExerciseSpec;
    use std::{
        sync::mpsc,
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    fn root(name: &str) -> PathBuf {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/import-unit")
            .join(format!(
                "{name}-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    fn input() -> Input {
        Input::Midi {
            bytes: include_bytes!("../assets/five-finger.mid").to_vec(),
            name: "五指课堂.mid".into(),
        }
    }
    fn player() -> Player {
        let mut p = Player::new(root("player"), PathBuf::new(), true);
        p.command(Command::Generate {
            spec: ExerciseSpec::default(),
        })
        .unwrap();
        p
    }
    fn engine() -> Engine {
        let root = root("engine");
        let lock = DataRootLock::acquire(&root).unwrap();
        Engine::start(root, lock, PathBuf::new(), true).unwrap()
    }
    #[test]
    fn preparation_preserves_noncanonical_midi_bytes_identity() {
        let bytes = [
            b"MThd".as_slice(),
            &[0, 0, 0, 6, 0, 0, 0, 1, 1, 224],
            b"MTrk",
            &[
                0, 0, 0, 14, 0x80, 0, 144, 60, 80, 0x83, 0x60, 128, 60, 0, 0, 255, 47, 0,
            ],
        ]
        .concat();
        let expected = blake3::hash(&bytes).to_hex().to_string();
        let prepared = prepare(Input::Midi {
            bytes: bytes.clone(),
            name: "原始字节.mid".into(),
        })
        .unwrap();
        assert_eq!(prepared.file.content_id, expected);
        assert_eq!(prepared.bytes, bytes);
        let mut p = player();
        let result = p.install_import(prepared).unwrap();
        assert_eq!(result["contentId"], expected);
        assert_eq!(
            std::fs::read(result["sourcePath"].as_str().unwrap()).unwrap(),
            bytes
        );
    }
    #[test]
    fn changed_song_and_recording_reject_prepared_import_before_storage() {
        let mut p = player();
        let origin = p.begin_import().unwrap();
        let mut spec = ExerciseSpec::default();
        spec.tonic = 7;
        p.command(Command::Generate { spec }).unwrap();
        assert!(p.check_import_origin(&origin).is_err());
        assert!(!p.data.join("imports").exists());
        let origin = p.begin_import().unwrap();
        p.command(Command::Recording { active: true }).unwrap();
        assert!(p.check_import_origin(&origin).is_err());
        assert!(p.begin_import().is_err());
        assert!(!p.data.join("imports").exists());
    }
    #[test]
    fn invalid_import_does_not_change_the_loaded_song_or_write_files() {
        let engine = engine();
        let song = engine
            .command(Command::Generate {
                spec: ExerciseSpec::default(),
            })
            .unwrap();
        let result = engine.command(Command::ImportScore {
            bytes: b"bad score".to_vec(),
            name: "错误.musicxml".into(),
            default_bpm: 120,
        });
        assert!(result.is_err());
        assert_eq!(
            engine.command(Command::CurrentSong).unwrap()["contentId"],
            song["contentId"]
        );
        assert!(!engine.data.join("imports").exists());
    }
    #[test]
    fn cancelled_queued_public_import_does_not_write_or_replace_the_song() {
        let engine = engine();
        let song = engine
            .command(Command::Generate {
                spec: ExerciseSpec::default(),
            })
            .unwrap();
        let mut workers = Vec::new();
        let mut releases = Vec::new();
        for _ in 0..2 {
            let (started, ready) = mpsc::channel();
            let (release, gate) = mpsc::channel();
            let engine = engine.clone();
            workers.push(thread::spawn(move || {
                engine.tasks.run("held by test", None, move |_| {
                    started.send(()).unwrap();
                    gate.recv().unwrap();
                    Ok(serde_json::Value::Null)
                })
            }));
            ready.recv_timeout(Duration::from_secs(2)).unwrap();
            releases.push(release);
        }
        let importing = engine.clone();
        let imported = thread::spawn(move || {
            importing.command(Command::ImportMidi {
                bytes: include_bytes!("../assets/five-finger.mid").to_vec(),
                name: "取消.mid".into(),
            })
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        let id = loop {
            let tasks = engine.command(Command::Tasks).unwrap();
            if let Some(task) = tasks
                .as_array()
                .unwrap()
                .iter()
                .find(|task| task["label"] == "准备导入曲目")
            {
                assert_eq!(task["state"], "queued");
                break task["id"].as_str().unwrap().to_owned();
            }
            assert!(Instant::now() < deadline);
            thread::yield_now();
        };
        engine.command(Command::Pause).unwrap();
        engine.command(Command::CancelTask { id }).unwrap();
        assert!(imported.join().unwrap().is_err());
        assert_eq!(
            engine.command(Command::CurrentSong).unwrap()["contentId"],
            song["contentId"]
        );
        assert!(!engine.data.join("imports").exists());
        for release in releases {
            release.send(()).unwrap();
        }
        for worker in workers {
            worker.join().unwrap().unwrap();
        }
    }
    #[test]
    fn runtime_rejects_a_ready_import_after_another_song_was_loaded() {
        let engine = engine();
        engine
            .command(Command::Generate {
                spec: ExerciseSpec::default(),
            })
            .unwrap();
        let (reply, origin) = mpsc::sync_channel(1);
        engine
            .tx
            .send(crate::runtime_request::Request::ImportContext(reply))
            .unwrap();
        let origin = origin
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        let (started, ready) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let worker = engine.clone();
        let pool = worker.tasks.clone();
        let importing = thread::spawn(move || {
            pool.run("held import", None, move |token| {
                let prepared = prepare(input())?;
                started.send(()).unwrap();
                gate.recv().unwrap();
                let (reply, response) = mpsc::sync_channel(1);
                worker
                    .tx
                    .send(crate::runtime_request::Request::ImportCommit(
                        origin, prepared, token, reply,
                    ))
                    .map_err(|e| e.to_string())?;
                response.recv().unwrap()
            })
        });
        ready.recv_timeout(Duration::from_secs(2)).unwrap();
        let mut spec = ExerciseSpec::default();
        spec.tonic = 5;
        let newer = engine.command(Command::Generate { spec }).unwrap();
        release.send(()).unwrap();
        assert!(importing.join().unwrap().unwrap_err().contains("已切换"));
        assert_eq!(
            engine.command(Command::CurrentSong).unwrap()["contentId"],
            newer["contentId"]
        );
        assert!(!engine.data.join("imports").exists());
    }
    #[test]
    fn prepared_index_rejects_a_file_changed_after_storage() {
        let root = root("changed-index");
        let mut prepared = prepare(input()).unwrap();
        let path = root.join("changed.mid");
        std::fs::write(&path, b"externally changed").unwrap();
        prepared.file.source_path = Some(path.clone());
        let mut index = library_workspace::Workspace::default();
        assert!(
            index
                .inspect_prepared(path.clone(), &prepared.file)
                .is_err()
        );
        assert!(index.entries.is_empty());
        assert_eq!(std::fs::read(path).unwrap(), b"externally changed");
    }
    #[test]
    fn a_valid_replacement_score_clears_the_previous_restore_error() {
        let mut p = player();
        let prepared = prepare(Input::Score {
            bytes: include_bytes!("../../panthesia-core/src/score_performance_test.musicxml")
                .to_vec(),
            name: "恢复后的谱面.musicxml".into(),
            bpm: 120,
        })
        .unwrap();
        p.install_import(prepared).unwrap();
        let file = p.file.as_ref().unwrap();
        let score = notation::ScoreAsset::new(
            p.notation.as_deref().unwrap().bytes.clone(),
            "有效谱面.musicxml".into(),
            file,
        )
        .unwrap();
        p.state.error = Some("旧谱面无法恢复".into());
        p.pair_score_asset(score).unwrap();
        assert!(p.snapshot().error.is_none());
    }
    #[test]
    fn public_score_and_original_imports_keep_notation_and_source_identity() {
        let engine = engine();
        let bytes =
            include_bytes!("../../panthesia-core/src/score_performance_test.musicxml").to_vec();
        let result = engine
            .command(Command::ImportScore {
                bytes: bytes.clone(),
                name: "课堂.musicxml".into(),
                default_bpm: 120,
            })
            .unwrap();
        assert_eq!(result["hasScore"], true);
        let tasks = engine.command(Command::Tasks).unwrap();
        assert_eq!(
            tasks[0]["fingerprint"],
            blake3::hash(&bytes).to_hex().to_string()
        );
        assert_eq!(tasks[0]["state"], "succeeded");
        let path = engine.data.join("课堂原谱.musicxml");
        std::fs::write(&path, &bytes).unwrap();
        let original = engine
            .command(Command::ImportScoreOriginal {
                path: path.clone(),
                default_bpm: 120,
            })
            .unwrap();
        assert_eq!(original["contentId"], result["contentId"]);
        assert_eq!(original["hasScore"], true);
        assert!(
            original["importWarnings"]
                .as_array()
                .unwrap()
                .iter()
                .all(|w| !w.as_str().unwrap().contains("关联未完成"))
        );
        let sources = crate::score_sources::inspect(&engine.data, None).unwrap();
        assert!(sources.to_string().contains("课堂原谱.musicxml"));
    }
}
