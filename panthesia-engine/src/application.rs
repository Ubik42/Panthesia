//! Public command routing and worker admission; playback cadence belongs to the driver.
use crate::{Command, DeviceSnapshot, Engine, Snapshot, is_control_command};
use crate::{
    asset_edit, audio, demo_loading, file_locations, fingerings, history_reader,
    load_pipeline,
    practice_catalog, practice_edit, runtime_request, score_attachments, score_mapping, score_sources, song_switch, storage_control,
};
use panthesia_core::exercise::ExerciseSpec;
use std::{
    sync::{atomic::Ordering, mpsc},
    time::Duration,
};

impl Engine {
    pub fn devices(&self, refresh: bool) -> Result<DeviceSnapshot, String> {
        self.devices.snapshot(refresh)
    }
    pub fn refresh_devices(&self, target: Option<&str>) -> Result<DeviceSnapshot, String> {
        self.devices.refresh(target)
    }
    pub fn command(&self, command: Command) -> Result<serde_json::Value, String> {
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
            return self.map_score(score_mapping::Input { measure_range:None,display_fingerprint:None,page_count: None,
                content_id,
                score_revision,
                source_fingerprint: None,
                practice_notation: false,
                midi,
                notes,
            });
        }
        if practice_catalog::edits(&command).is_some() || practice_catalog::reads(&command) {
            return self.catalog_task(command, None, None);
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
            Command::Recording { active: false } => return self.save_recording_task(),
            Command::Generate { spec } => return self.exercise_task(spec),
            Command::OpenPassage { id } => {
                return self.song_switch_task(
                    song_switch::Input::Practice(Command::OpenPassage { id }),
                    "打开保存的练习段",
                    None,
                );
            }
            Command::OpenFile { path } => return self.open_file(path),
            Command::RecentFiles => return Ok(self.recent_files()),
            Command::ForgetRecentFile { path } => return self.forget_recent(&path),
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
        let timeout = if matches!(
            command,
            Command::CreateLocatedScorePaper { .. }
                | Command::SoundFont { .. }

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
