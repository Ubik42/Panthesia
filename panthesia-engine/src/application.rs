//! Public command routing and worker admission; playback cadence belongs to the driver.
use crate::{Command, DeviceSnapshot, Engine, Preferences, Snapshot, is_control_command};
use crate::{
    asset_edit, audio, demo_loading, file_locations, fingerings, history_actions,
    history_clip_edit, history_loading, history_operations, history_reader, history_replay_loading,
    history_source, import_pipeline, library, library_monitor, library_repairs, library_scores,
    library_workspace, load_pipeline, metadata_templates, package_loading,
    practice_backup_import, practice_backup_preview, practice_catalog, practice_edit, routine_edit,
    runtime_request, score_attachments, score_mapping, score_sources, song_switch, storage_control,
};
use panthesia_core::exercise::ExerciseSpec;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, atomic::Ordering, mpsc},
    time::Duration,
};

impl Engine {
    pub fn devices(&self, refresh: bool) -> Result<DeviceSnapshot, String> {
        self.devices.snapshot(refresh)
    }
    pub fn refresh_devices(&self, target: Option<&str>) -> Result<DeviceSnapshot, String> {
        self.devices.refresh(target)
    }
    pub fn start_library_monitor(
        &self,
        root: PathBuf,
        rows: Arc<Mutex<Vec<library::SongRow>>>,
    ) -> library_monitor::Monitor {
        *self.catalog_rows.lock().unwrap_or_else(|error|error.into_inner())=Some(Arc::downgrade(&rows));
        library_monitor::Monitor::start_loading(
            root,
            self.data.clone(),
            rows,
            self._data_lock.clone(),
        )
    }
    pub fn stage_practice_backup(&self, bytes: Vec<u8>) -> Result<serde_json::Value, String> {
        self.practice_backup_preview_task(practice_backup_preview::PreviewInput::Bytes(bytes))
    }
    pub fn command(&self, command: Command) -> Result<serde_json::Value, String> {
        let command = crate::practice_policy::normalize(command)?;
        let recording_note = matches!(command, Command::Note { .. })
            && self.state.lock().is_ok_and(|state| state.recording);
        if !recording_note {
            if self.closing.load(Ordering::Acquire) && !storage_control::allowed(&command) {
                return Err("正在保存并关闭程序，请等待完成".into());
            }
            storage_control::check_command(&self.storage_busy, &command)?;
        }
        if matches!(
            &command,
            Command::ReadRepertoire { .. } | Command::SongCatalog
                | Command::EditRepertoire { .. }
                | Command::InspectNotation { .. }
        ) {
            return self.repertoire_task(command);
        }
        if matches!(&command, Command::Feedback) {
            return self.feedback_task();
        }
        if matches!(
            &command,
            Command::FileLocations
                | Command::FileLocationsFor { .. }
                | Command::UpdateFileLocation { .. }
        ) {
            return self.file_locations_task(command);
        }
        if matches!(
            &command,
            Command::SeekPaperMeasure { .. } | Command::SeekPaperNote { .. }
        ) {
            return self.navigate_paper(command);
        }
        if let Command::ReadPaperView { content_id, book } = command {
            return self.read_paper_view(content_id, book);
        }
        if let Command::SavePaperView {
            content_id,
            book,
            view,
            expected,
        } = command
        {
            return self.save_paper_view(content_id, book, view, Some(expected), false);
        }
        if let Command::UpdateScoreAttachment {
            content_id,
            id,
            action,
            view,
            ..
        } = &command
        {
            if action == "view" {
                return self.save_paper_view(
                    content_id.clone(),
                    id.clone().ok_or("谱面版本未指定")?,
                    view.clone().ok_or("阅读设置未指定")?,
                    None,
                    true,
                );
            }
        }
        if let Command::Input { name } = command {
            return self.change_input(name);
        }
        if let Command::AudioDevices = command {
            return Ok(serde_json::json!({"devices":audio::Audio::devices()?}));
        }
        if let Command::StartSongAudition { path, id } = command {
            return self.start_song_audition(path, id);
        }
        if let Command::SongPreview { path } = command {
            if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 32_000_000 {
                return Err("MIDI 超过预览大小限制".into());
            }
            let file = midi_file::MidiFile::new(&path)?;
            let mut notes: Vec<_> = file.tracks.iter().flat_map(|t| t.notes.iter()).collect();
            notes.sort_by_key(|n| n.start);
            let preview:Vec<_>=notes.iter().take(192).map(|n|serde_json::json!({"pitch":n.note,"start":n.start.as_secs_f64(),"duration":n.duration.as_secs_f64()})).collect();
            return Ok(
                serde_json::json!({"duration":file.duration.as_secs_f64(),"bpm":file.tempo_track.bpm_at_seconds(0.),"measures":file.measures.len(),"tracks":file.tracks.iter().filter(|t|!t.notes.is_empty()).count(),"notes":notes.len(),"preview":preview}),
            );
        }
        if let Command::AudioDevice { name } = command {
            return self.change_audio_device(name);
        }
        if let Command::Output { name } = command {
            return self.change_output(name);
        }
        if matches!(&command, Command::VstEditor) {
            return self.open_sound_editor();
        }
        if matches!(command, Command::CurrentSong | Command::Session) {
            return self.song_document(matches!(command, Command::Session));
        }
        if self.snapshot().content_id.is_some()
            && (asset_edit::supports(&command) || practice_edit::classify(&command).is_some())
            && !matches!(&command,Command::ActivateScore{..}|Command::DetachScore{..}|Command::PairScore{..}|Command::SaveScoreVersion{..})
        {
            let song = self.song_document(false)?;
            if song["practiceVariant"]["active"].as_bool() == Some(true) {
                return Err("请先恢复原始演奏，再编辑源谱标记；练习版本已保留".into());
            }
        }
        if let Command::ScoreMap {
            score_revision,
            midi,
            notes,
            content_id,
        } = command
        {
            return self.map_score(score_mapping::Input {
                content_id,
                score_revision,
                source_fingerprint: None,
                practice_notation: false,
                midi,
                notes,
            });
        }
        if let Command::AnnotateHistory {
            content_id,
            id,
            note,
            teacher,
            next,
            expected,
        } = command
        {
            return self.annotate_history_background(history_reader::AnnotationInput {
                engine_id: None,
                content_id,
                id,
                note,
                teacher,
                next,
                expected,
            });
        }
        if matches!(&command, Command::PassageCatalog { .. }) {
            return self.read_routine_sources(command);
        }
        if practice_catalog::edits(&command).is_some() || practice_catalog::reads(&command) {
            return self.catalog_task(command, None, None);
        }
        if routine_edit::supports(&command) {
            return self.edit_routine_registry(command);
        }
        if let Command::EditRoutine { request } = command {
            return self.edit_routine_checked(request);
        }
        if let Command::Routines { day } = command {
            return self.read_routines(day);
        }
        if history_clip_edit::supports(&command) {
            return self.history_clip_task(command);
        }
        if history_reader::supports(&command) {
            return self.history_read_task(command, None);
        }
        if demo_loading::supports(&command) {
            return self.audition_task(command, None, None);
        }
        if let Some(kind) = practice_edit::classify(&command) {
            return self.practice_edit_task(command, kind, None);
        }
        if asset_edit::reads(&command)
            || asset_edit::runtime_reads(&command)
            || practice_edit::reads(&command)
        {
            return self.asset_read_task(command);
        }
        if asset_edit::supports(&command) {
            return self.asset_edit_task(command);
        }
        match command {
            Command::StartLibraryOpen { request } => {
                return serde_json::to_value(self.start_library_open(request)?)
                    .map_err(|error| error.to_string());
            }
            Command::ReadLibraryOpen { id, metadata_only } => {
                return serde_json::to_value(self.read_library_open(&id, metadata_only)?)
                    .map_err(|error| error.to_string());
            }
            Command::CancelLibraryOpen { id } => {
                return serde_json::to_value(self.cancel_library_open(&id)?)
                    .map_err(|error| error.to_string());
            }
            Command::ReleaseLibraryOpen { id } => {
                return serde_json::to_value(self.release_library_open(&id)?)
                    .map_err(|error| error.to_string());
            }
            Command::StartHistoryOperation { request } => {
                return serde_json::to_value(self.start_history_operation(request)?)
                    .map_err(|error| error.to_string());
            }
            Command::ReadHistoryOperation { id, metadata_only } => {
                return serde_json::to_value(self.read_history_operation(&id, metadata_only)?)
                    .map_err(|error| error.to_string());
            }
            Command::CancelHistoryOperation { id } => {
                return serde_json::to_value(self.cancel_history_operation(&id)?)
                    .map_err(|error| error.to_string());
            }
            Command::ReleaseHistoryOperation { id } => {
                return serde_json::to_value(self.release_history_operation(&id)?)
                    .map_err(|error| error.to_string());
            }
            Command::ExportMidi => return self.export_midi_task(),
            Command::DismissStartupWarning { id } => {
                let dismissed = self.startup.dismiss_warning(&id)?;
                return Ok(serde_json::json!({"dismissed":dismissed}));
            }
            Command::SkipStartupSong => {
                self.startup.skip_song()?;
                return Ok(serde_json::json!({"ok":true}));
            }
            Command::RetryStartup => {
                if self
                    .state
                    .lock()
                    .is_ok_and(|state| state.recording || state.recording_unsaved)
                {
                    return Err("请先停止并保存录音，再重新恢复练习室".into());
                }
                if self.imports_in_flight.load(Ordering::Acquire) > 0 {
                    return Err("后台资料或设备设置仍在处理，请等待完成后重试恢复".into());
                }
                if self.closing.load(Ordering::Acquire) {
                    return Err("正在关闭练习室".into());
                }
                self.startup.reset()?;
                self.storage_busy.store(true, Ordering::Release);
                self.startup_task()?;
                return Ok(serde_json::json!({"ok":true}));
            }
            Command::SoundFont { path } => return self.soundfont_task(path),
            Command::InspectPackage { bytes } => return self.inspect_package_task(bytes),
            Command::ExportPackage => return self.export_package_task(false),
            Command::ExportPackageFile => return self.export_package_task(true),
            Command::Recording { active: false } => return self.save_recording_task(),
            Command::Save => return Err("评分保存已移至独立分支".into()),
            Command::RetrySave => return self.retry_settings_save(None),
            Command::RetrySettingsSave { expected } => {
                return self.retry_settings_save(Some(expected));
            }
            Command::ReadStorageStatus => return self.read_storage_status(),
            Command::ApplyPracticeBackup {
                backup,
                selection,
                policy,
            } => {
                return self.practice_backup_import_task(
                    practice_backup_import::Input::Decoded(backup),
                    selection,
                    policy,
                );
            }
            Command::ImportStagedPracticeBackup {
                token,
                selection,
                policy,
            } => {
                return self.practice_backup_import_task(
                    practice_backup_import::Input::Staged(token),
                    selection,
                    policy,
                );
            }
            Command::InspectPracticeBackup { backup } => {
                return self.practice_backup_preview_task(
                    practice_backup_preview::PreviewInput::Decoded(backup),
                );
            }
            Command::PracticeBackupSnapshot { selection } => {
                return self.practice_backup_task(selection, false);
            }
            Command::ExportPracticeBackup { selection } => {
                return self.practice_backup_task(selection, true);
            }
            Command::Generate { spec } => return self.exercise_task(spec),
            Command::OpenPassage { id } => {
                return self.song_switch_task(
                    song_switch::Input::Practice(Command::OpenPassage { id }),
                    "打开保存的练习段",
                    None,
                );
            }
            Command::StartLadder { id, resume } => {
                return self.song_switch_task(
                    song_switch::Input::Practice(Command::StartLadder { id, resume }),
                    "打开速度阶梯",
                    None,
                );
            }
            Command::OpenLibraryScore {
                path,
                content_id,
                kind,
                id,
            } => return self.open_library_score_task(path, content_id, kind, id),
            Command::OpenRoutineItem {
                routine_id,
                day,
                item_id,
                resume,
            } => return self.routine_task(routine_id, day, item_id, resume),
            Command::StartHistoryReplay {
                content_id,
                id,
                source,
                rate,
                request_id,
            } => {
                return self
                    .history_replay_task(content_id, id, source, rate, request_id, None, None);
            }
            Command::StartHistoryReplayRange {
                content_id,
                id,
                source,
                rate,
                start,
                end,
                request_id,
            } => {
                return self.history_replay_task(
                    content_id,
                    id,
                    source,
                    rate,
                    request_id,
                    Some((start, end)),
                    None,
                );
            }
            Command::PlayHistorySource { request } => {
                request.source.require_performance()?;
                let range = request
                    .selection
                    .map(|selection| (selection.start, selection.end));
                return self.history_replay_task(
                    request.source.content_id.clone(),
                    request.source.id.clone(),
                    request.sound.name().into(),
                    request.rate,
                    Some(request.request_id),
                    range,
                    Some(request.source),
                );
            }
            Command::PerformHistoryAction { request } => {
                request.source.validate()?;
                if matches!(
                    request.action,
                    history_source::HistoryActionKind::PracticeRange { .. }
                ) {
                    request.source.require_performance()?;
                }
                let action = request.action.action();
                return self.history_task_checked(
                    request.source.content_id.clone(),
                    request.source.id.clone(),
                    action,
                    Some(request.source),
                );
            }
            Command::HistoryOpen {
                content_id,
                id,
                restore,
            } => {
                return self.history_task(content_id, id, history_actions::Action::Open { restore });
            }
            Command::HistoryScoreReview { content_id, id } => {
                return self.history_task(content_id, id, history_actions::Action::ScoreReview);
            }
            Command::HistoryPracticeRange {
                content_id,
                id,
                reference,
                before,
                after,
            } => {
                return self.history_task(
                    content_id,
                    id,
                    history_actions::Action::PracticeRange {
                        reference,
                        before,
                        after,
                    },
                );
            }
            Command::Load { path, title } => {
                return self.load_task(load_pipeline::Input::File {
                    path,
                    title,
                    expected: None,
                });
            }
            Command::LoadIndexed {
                path,
                title,
                content_id,
            } => {
                return self.load_task(load_pipeline::Input::File {
                    path,
                    title,
                    expected: Some(content_id),
                });
            }
            Command::OpenRecent { content_id } => {
                let (reply, receiver) = mpsc::sync_channel(1);
                self.tx
                    .send(runtime_request::Request::RecentSource(
                        content_id.clone(),
                        reply,
                    ))
                    .map_err(|_| "音乐引擎已关闭")?;
                let source = receiver
                    .recv_timeout(Duration::from_secs(15))
                    .map_err(|_| "读取最近练习超时")??;
                return match source {
                    runtime_request::RecentSource::File(title, paths) => {
                        self.load_task(load_pipeline::Input::Recent {
                            content_id,
                            title,
                            paths,
                        })
                    }
                    runtime_request::RecentSource::Exercise(spec) => self.exercise_task(spec),
                };
            }
            Command::ImportPackage { bytes, policy } => {
                return self.song_switch_task(
                    song_switch::Input::Package { bytes, policy },
                    "导入曲目包",
                    None,
                );
            }
            Command::ImportMidi { bytes, name } => {
                return self.import_task(import_pipeline::Input::Midi { bytes, name });
            }
            Command::ImportScore {
                bytes,
                name,
                default_bpm,
            } => {
                return self.import_task(import_pipeline::Input::Score {
                    bytes,
                    name,
                    bpm: default_bpm,
                });
            }
            Command::ImportScoreOriginal { path, default_bpm } => {
                return self.import_task(import_pipeline::Input::Original {
                    path,
                    bpm: default_bpm,
                });
            }
            Command::Tasks => {
                return serde_json::to_value(self.tasks.list()?).map_err(|error| error.to_string());
            }
            Command::CancelTask { id } => {
                self.tasks.cancel(&id)?;
                return Ok(serde_json::json!({"ok": true}));
            }
            Command::CancelHistoryRead { channel, sequence } => {
                return self.cancel_history_read(channel, sequence);
            }
            Command::SuggestFingers {
                hand,
                track,
                index,
                profile,
                range,
            } => {
                return self.basic_fingers_task(fingerings::BasicRequest {
                    hand,
                    track,
                    index,
                    profile,
                    range,
                });
            }
            Command::SuggestFingerPlans { request } => {
                return self.finger_plan_task(request, false, None);
            }
            Command::SuggestHeldFingerPlans { request } => {
                return self.finger_plan_task(request, true, None);
            }
            command => return self.dispatch(command),
        }
    }
    pub(super) fn routine_task(
        &self,
        routine_id: String,
        day: String,
        item_id: String,
        resume: bool,
    ) -> Result<serde_json::Value, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::RoutineContext {
                routine_id,
                day,
                item_id,
                resume,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let (origin, context) = receiver
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "读取计划项目超时")??;
        let engine = self.clone();
        self.tasks.run(
            "准备计划练习项目",
            Some(context.item.content_id.clone()),
            move |token| {
                engine.commit_song_switch(origin, song_switch::Input::Routine(context), token)
            },
        )
    }
    pub(super) fn history_replay_task(
        &self,
        content_id: String,
        id: String,
        source: String,
        rate: f64,
        request_id: Option<String>,
        range: Option<(f64, f64)>,
        expected: Option<history_source::HistorySource>,
    ) -> Result<serde_json::Value, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::ReplayContext {
                content_id: content_id.clone(),
                id,
                source,
                rate,
                request_id,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let mut context = receiver
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "读取历史回放条件超时")??;
        if let Some(source) = &expected {
            source.check_context(&context.history)?;
        }
        context.history.expected = expected;
        context.range = range;
        let engine = self.clone();
        self.tasks
            .run("准备历史声音回放", Some(content_id), move |token| {
                let fingerprint = blake3::hash(
                    &serde_json::to_vec(&(&context.history.id, &context.history.fingerprint))
                        .map_err(|e| e.to_string())?,
                )
                .to_hex()
                .to_string();
                token.source(context.history.content_id.clone(), fingerprint)?;
                token.stage("computing")?;
                let prepared = history_replay_loading::Prepared::read(&engine.data, &context)?;
                token.check()?;
                let (reply, receiver) = mpsc::sync_channel(1);
                engine
                    .tx
                    .send(runtime_request::Request::ReplayCommit(
                        context, prepared, token, reply,
                    ))
                    .map_err(|_| "音乐引擎已关闭")?;
                receiver.recv().map_err(|_| "音乐引擎已关闭")?
            })
    }
    pub(super) fn history_task(
        &self,
        content_id: String,
        id: String,
        action: history_actions::Action,
    ) -> Result<serde_json::Value, String> {
        self.history_task_checked(content_id, id, action, None)
    }
    pub(super) fn history_task_checked(
        &self,
        content_id: String,
        id: String,
        action: history_actions::Action,
        expected: Option<history_source::HistorySource>,
    ) -> Result<serde_json::Value, String> {
        let (origin, context) =
            self.capture_history_action(content_id.clone(), id, action, expected, None)?;
        let engine = self.clone();
        self.tasks
            .run(action.label(), Some(content_id), move |token| {
                engine.commit_song_switch(origin, song_switch::Input::History(context), token)
            })
    }
    pub(crate) fn capture_history_action(
        &self,
        content_id: String,
        id: String,
        action: history_actions::Action,
        expected: Option<history_source::HistorySource>,
        current: Option<history_operations::HistoryOperationOrigin>,
    ) -> Result<(import_pipeline::Origin, history_loading::Context), String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::HistoryContext {
                content_id,
                id,
                action,
                expected,
                current,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        receiver
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "读取历史练习条件超时".to_owned())?
    }
    pub(super) fn exercise_task(&self, spec: ExerciseSpec) -> Result<serde_json::Value, String> {
        self.song_switch_task(
            song_switch::Input::Exercise(spec),
            "生成技术练习与恢复资料",
            None,
        )
    }
    pub(super) fn load_task(
        &self,
        input: load_pipeline::Input,
    ) -> Result<serde_json::Value, String> {
        let expected = input.expected();
        self.song_switch_task(song_switch::Input::File(input), "加载曲目与谱面", expected)
    }
    pub(super) fn import_task(
        &self,
        input: import_pipeline::Input,
    ) -> Result<serde_json::Value, String> {
        self.song_switch_task(song_switch::Input::Import(input), "准备导入曲目", None)
    }
    pub(super) fn basic_fingers_task(
        &self,
        request: fingerings::BasicRequest,
    ) -> Result<serde_json::Value, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::BasicReadContext {
                request: request.clone(),
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let (context, origin) = receiver.recv().map_err(|_| "指法建议快照通道已关闭")??;
        let engine = self.clone();
        self.tasks.run("生成指法建议", None, move |token| {
            token.stage("computing")?;
            let reader = context.into_player(false)?;
            let mut prepared = reader.prepare_basic_fingers(&request)?;
            prepared.origin = Some(origin);
            token.source(prepared.content_id.clone(), prepared.fingerprint.clone())?;
            let proposals = fingerings::basic_proposals(&prepared);
            token.check()?;
            let (reply, receiver) = mpsc::sync_channel(1);
            engine
                .tx
                .send(runtime_request::Request::BasicCommit(
                    prepared, proposals, token, reply,
                ))
                .map_err(|_| "音乐引擎已关闭")?;
            receiver.recv().map_err(|_| "指法建议保存通道已关闭")?
        })
    }
    pub(super) fn dispatch(&self, command: Command) -> Result<serde_json::Value, String> {
        if let Command::PreviewPaperTransfer {
            content_id,
            source,
            target,
        } = command
        {
            return score_attachments::preview_transfer(&self.data, &content_id, &source, &target);
        }
        if let Command::ApplyPaperTransfer {
            content_id,
            request,
        } = command
        {
            return score_attachments::apply_transfer(&self.data, &content_id, request);
        }
        if let Command::LinkPaperSource {
            content_id,
            book,
            asset,
            path,
            baseline,
        } = command
        {
            return score_attachments::link_source(
                &self.data,
                &content_id,
                &book,
                &asset,
                path,
                baseline.as_deref(),
            );
        }
        if let Command::PaperSourceUpdates = command {
            return score_attachments::source_monitor::snapshot(&self.data);
        }
        if let Command::InspectPaperSources { content_id, book } = command {
            return score_attachments::inspect_sources(&self.data, &content_id, &book);
        }
        if let Command::PreviewPaperSource {
            content_id,
            book,
            asset,
            fingerprint,
        } = command
        {
            return score_attachments::preview_source(
                &self.data,
                &content_id,
                &book,
                &asset,
                &fingerprint,
            );
        }
        if let Command::ApplyPaperSource {
            content_id,
            book,
            asset,
            fingerprint,
            baseline,
            action,
        } = command
        {
            return score_attachments::apply_source(
                &self.data,
                &content_id,
                &book,
                &asset,
                &fingerprint,
                &baseline,
                &action,
            );
        }
        if matches!(command, Command::MetadataTemplates) {
            return metadata_templates::inspect(&self.data);
        }
        if let Command::UpdateMetadataTemplate {
            name,
            rules,
            expected,
        } = command
        {
            return metadata_templates::update(&self.data, name, rules, expected);
        }
        if matches!(command, Command::FileLocations) {
            return file_locations::inspect(&self.data);
        }
        if let Command::UpdateFileLocation {
            kind, path, clear, ..
        } = command
        {
            return file_locations::update(&self.data, &kind, path, clear);
        }
        if let Command::ScoreSources { content_id } = command {
            return score_sources::inspect(&self.data, content_id.as_deref());
        }
        if let Command::PreviewScoreSource { id, fingerprint } = command {
            return score_sources::preview(&self.data, &id, &fingerprint);
        }
        if let Command::UpdateLibraryPaper {
            path,
            content_id,
            id,
            action,
            page,
            direction,
            expected_pages,
        } = command
        {
            library_scores::location(&self.data, &path, &content_id)?;
            if !["movePage", "removePage"].contains(&action.as_str()) {
                return Err("谱页整理操作无效".into());
            }
            return score_attachments::update_with_pages(
                &self.data,
                &content_id,
                Some(&id),
                &action,
                None,
                None,
                page,
                direction,
                expected_pages.as_deref(),
            );
        }
        if let Command::AddLibraryScore {
            path,
            content_id,
            name,
            bytes,
            kind,
            target,
            page,
        } = &command
        {
            library_scores::location(&self.data, path, content_id)?;
            if kind == "notation" {
                if bytes.len() > 4_000_000 {
                    return Err("演奏乐谱超过 4 MB".into());
                }
                let score = panthesia_core::musicxml::import_musicxml_document(bytes)
                    .map_err(|e| e.to_string())?;
                panthesia_core::score_performance::normalized(&score)?;
            } else if kind == "paper" || kind == "append" {
                return score_attachments::add(
                    &self.data,
                    content_id,
                    name,
                    bytes.clone(),
                    if kind == "append" {
                        Some(target.as_deref().ok_or("未指定图片谱面")?)
                    } else {
                        None
                    },
                );
            } else if kind == "repairPaper" {
                return score_attachments::repair(
                    &self.data,
                    content_id,
                    target.as_deref().ok_or("未指定待修复谱面")?,
                    *page,
                    bytes.clone(),
                );
            } else {
                return Err("谱面导入类型无效".into());
            }
        }
        if let Command::CheckLibraryScoreImport {
            path,
            content_id,
            bytes,
            kind,
            target,
        } = &command
        {
            return library_scores::check_import(
                &self.data,
                path,
                content_id,
                bytes,
                kind,
                target.as_deref(),
            );
        }
        if let Command::LibraryScores { path, content_id } = &command {
            return library_scores::inspect(&self.data, path, content_id);
        }
        if let Command::PreviewLibraryScoreRoute {
            path,
            content_id,
            id,
        } = &command
        {
            return library_scores::preview_route(&self.data, path, content_id, id);
        }
        let attachment_id = match &command {
            Command::UpdateScoreAttachment { action, .. } if action == "view" => None,
            Command::ScoreAttachments { content_id }
            | Command::AddScoreAttachment { content_id, .. }
            | Command::UpdateScoreAttachment { content_id, .. } => Some(content_id),
            _ => None,
        };
        if let Some(id) = attachment_id {
            self.check_current_content_id(id)?;
        }
        match command {
            Command::ScoreAttachments { content_id } => {
                return score_attachments::list(&self.data, &content_id);
            }
            Command::AddScoreAttachment {
                content_id,
                name,
                bytes,
                append,
            } => {
                return score_attachments::add(
                    &self.data,
                    &content_id,
                    &name,
                    bytes,
                    append.as_deref(),
                );
            }
            Command::UpdateScoreAttachment {
                content_id,
                id,
                action,
                name,
                view,
                page,
                direction,
                expected_pages,
            } => {
                return score_attachments::update_with_pages(
                    &self.data,
                    &content_id,
                    id.as_deref(),
                    &action,
                    name.as_deref(),
                    view,
                    page,
                    direction,
                    expected_pages.as_deref(),
                );
            }
            _ => {}
        }
        match &command {
            Command::LibraryRepairs {
                query,
                kind,
                include_resolved,
                offset,
                limit,
            } => {
                let known = self.command(Command::Collection)?;
                return library_repairs::query(
                    &self.data,
                    &known,
                    query,
                    kind,
                    *include_resolved,
                    *offset,
                    *limit,
                );
            }
            Command::MidiReplacements {
                query,
                include_reviewed,
                offset,
                limit,
            } => {
                return library_repairs::replacements(
                    &self.data,
                    query,
                    *include_reviewed,
                    *offset,
                    *limit,
                );
            }
            Command::PreviewMidiReplacement {
                path,
                old_content_id,
                new_content_id,
            } => {
                return library_repairs::preview_replacement(
                    &self.data,
                    path,
                    old_content_id,
                    new_content_id,
                );
            }
            Command::RelinkLibrary { .. }
            | Command::SetLibraryPrimary { .. }
            | Command::RestoreLibraryPath { .. }
            | Command::IgnoreLibraryPath { .. } => {}
            _ => {}
        }
        match command {
            Command::RelinkLibrary { items } => return library_repairs::relink(&self.data, items),
            Command::DecideMidiReplacement {
                path,
                old_content_id,
                new_content_id,
                token,
                action,
                target,
            } => {
                return library_repairs::decide_replacement(
                    &self.data,
                    &path,
                    &old_content_id,
                    &new_content_id,
                    &token,
                    &action,
                    target,
                );
            }
            Command::SetLibraryPrimary { content_id, path } => {
                return library_repairs::set_primary(&self.data, &content_id, path);
            }
            Command::IgnoreLibraryPath { content_id, path } => {
                return library_repairs::ignore_path(&self.data, &content_id, &path);
            }
            Command::RestoreLibraryPath { content_id, path } => {
                return library_repairs::restore_path(&self.data, &content_id, &path);
            }
            _ => {}
        }
        if let Command::ImportStagedPackage { token, policy } = command {
            package_loading::check_token(&token)?;
            return self.song_switch_task(
                song_switch::Input::StagedPackage { token, policy },
                "导入曲目包",
                None,
            );
        }
        if let Command::InspectPackage { bytes } = command {
            let (content_id,mut result)=crate::portable_song::inspect(&bytes,&||Ok(()))?;
            let index = library_workspace::Workspace::load(&self.data)?;
            let prefs = Preferences::load(&self.data.join("web-preferences.json"))?;
            result["existing"] = serde_json::json!(
                index
                    .entries
                    .values()
                    .any(|e| e.content_id.as_ref() == Some(&content_id))
                    || prefs.songs.contains_key(&content_id)
            );
            return Ok(result);
        }
        if matches!(
            command,
            Command::IndexLibrary { .. }
                | Command::IndexStatus
                | Command::PauseIndex
                | Command::ResumeIndex
                | Command::CancelIndex
        ) {
            return self.indexer.command(command);
        }
        if library_workspace::accepts(&command) {
            return library_workspace::execute(command, &self.data);
        }
        let timeout = if matches!(
            command,
            Command::ImportScore { .. }
                | Command::CreateLocatedScorePaper { .. }
                | Command::SoundFont { .. }
                | Command::ImportMidi { .. }
                | Command::ImportPackage { .. }
                | Command::ExportPackage
                | Command::ExportPackageFile
                | Command::PracticeBackupSnapshot { .. }
                | Command::InspectPracticeBackup { .. }
                | Command::ApplyPracticeBackup { .. }
                | Command::PendingMetadataHistory
                | Command::ClaimPendingMetadataHistory { .. }
                | Command::ManageLibraryScore { .. }
                | Command::OpenLibraryScore { .. }
        ) {
            Duration::from_secs(120)
        } else {
            Duration::from_secs(125)
        };
        let (reply, rx) = mpsc::sync_channel(1);
        let sender = if is_control_command(&command) {
            &self.control_tx
        } else {
            &self.tx
        };
        sender
            .send(runtime_request::Request::Command(command, reply))
            .map_err(|_| "音乐引擎已关闭".to_string())?;
        rx.recv_timeout(timeout)
            .map_err(|_| "音乐引擎响应超时".to_string())?
    }
    pub fn snapshot(&self) -> Snapshot {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }
}
