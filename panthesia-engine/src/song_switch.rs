//! Prepare a complete song replacement away from the audio clock, then publish it once.
use crate::*;
use serde_json::Value;

pub(crate) enum Input {
    Practice(Command),
    ScopedPractice { command: Command, scope: practice_edit::Scope, catalog_revision: Option<String> },
    Exercise(ExerciseSpec),
    File(load_pipeline::Input),
    Recording(PathBuf),
}
impl Input {
    fn install_file(
        reader: &mut Player,
        input: load_pipeline::Input,
        token: &background_tasks::TaskToken,
    ) -> Result<(), String> {
        let prepared = input.read(
            &reader.data,
            |id| {
                Ok(reader
                    .preferences
                    .score_versions
                    .get(id)
                    .cloned()
                    .unwrap_or_default())
            },
            || token.check(),
        )?;
        Self::install_prepared_file(reader, prepared, token)
    }
    pub(super) fn install_prepared_file(
        reader: &mut Player,
        prepared: load_pipeline::Prepared,
        token: &background_tasks::TaskToken,
    ) -> Result<(), String> {
        token.source(
            prepared.file.content_id.clone(),
            prepared
                .assets
                .notation
                .as_ref()
                .map(|s| s.source_fingerprint.clone())
                .unwrap_or_else(|| prepared.file.content_id.clone()),
        )?;
        token.check()?;
        reader.install_prepared(
            prepared.file,
            prepared.title,
            None,
            Some(load_pipeline::InstallData {
                assets: Some(prepared.assets),
                timeline: prepared.timeline,
            }),
        )?;
        Ok(())
    }

    pub(super) fn needs_current_timeline(&self) -> bool {
        matches!(self, Self::Practice(_) | Self::ScopedPractice { .. })
    }
    pub(super) fn apply(
        self,
        reader: &mut Player,
        token: &background_tasks::TaskToken,
    ) -> Result<Value, String> {
        self.apply_response(reader, token, true)
    }
    fn apply_response(
        self,
        reader: &mut Player,
        token: &background_tasks::TaskToken,
        describe_song: bool,
    ) -> Result<Value, String> {
        token.check()?;
        match &self {
            Self::ScopedPractice {
                scope,
                command,
                catalog_revision,
            } => {
                reader.check_practice_scope(Some(scope))?;
                crate::practice_catalog::check_open_version(
                    reader,
                    command,
                    catalog_revision.as_deref(),
                )?;
                token.source(scope.content_id.clone(), scope.score_revision.to_string())?;
            }
            _ => {}
        }
        let _compact_import = !describe_song || false;
        match self {
            Self::Practice(command) | Self::ScopedPractice { command, .. } => {
                reader.command(command)
            }
            Self::Exercise(spec) => {
                let prepared = exercise_loading::prepare_checked(spec, &|| token.check())?;
                let versions = reader
                    .preferences
                    .score_versions
                    .get(&prepared.file.content_id)
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                let prepared = prepared.read_assets_checked(&reader.data, versions, &|| token.check())?;
                token.source(
                    prepared.file.content_id.clone(),
                    prepared.file.content_id.clone(),
                )?;
                token.check()?;
                prepared.install(reader)?;
                if describe_song {
                    reader.command(Command::CurrentSong)
                } else {
                    Ok(Value::Null)
                }
            }
            Self::File(input) => {
                Self::install_file(reader, input, token)?;
                if describe_song {
                    reader.command(Command::CurrentSong)
                } else {
                    Ok(Value::Null)
                }
            }
            Self::Recording(path) => {
                let title = crate::music_file::recording_title(&path);
                Self::install_file(
                    reader,
                    load_pipeline::Input::File {
                        path,
                        title,
                        expected: None,
                    },
                    token,
                )?;
                reader.state.mode = "listen".into();
                reader.state.wait = false;
                reader.state.count_in = 0;
                reader.state.passage = None;
                reader.state.metronome = false;
                reader.state.rounds = 0;
                reader.state.speed = 1.;
                reader.persist()?;
                if describe_song {
                    reader.command(Command::CurrentSong)
                } else {
                    Ok(Value::Null)
                }
            }
        }
    }
}

/// Only owned musical state crosses threads. Device connections and the live recorder stay on the actor.
pub(crate) struct Playback {
    keep_undo: bool,
    keep_score_mapping: bool,
    sound: track_sound::Prepared,
    sound_timeline: Arc<track_sound::Timeline>,
    state: Snapshot,
    file: SongFile,
    source_file: Option<SongFile>,
    title: String,
    config: SongConfig,
    notes: PracticeNotes,
    events: PlaybackEvents,
    event_notes: EventNotes,
    fingers: FingerAssignments,
    hands: HandAssignments,
    notation: Option<Arc<notation::ScoreAsset>>,
    exercise: Option<ExerciseSpec>,
    original_grid: Option<OriginalGrid>,
    meter_map: Option<panthesia_core::library::MeterMap>,
    meter: Option<panthesia_core::library::MeterCorrection>,
    revision: u64,
}
impl Playback {
    pub(super) fn take(reader: &mut Player) -> Result<Self, String> {
        let sound = reader.prepare_track_sound();
        Ok(Self {
            keep_undo: false,
            keep_score_mapping: false,
            sound,
            sound_timeline: reader.sound_timeline.clone(),
            state: reader.state.clone(),
            file: reader.file.take().ok_or("新曲目准备结果缺失")?,
            source_file: reader.source_file.take(),
            title: std::mem::take(&mut reader.title),
            config: reader.config.clone(),
            notes: std::mem::take(&mut reader.notes),
            events: std::mem::take(&mut reader.events),
            event_notes: std::mem::take(&mut reader.event_notes),
            fingers: std::mem::take(&mut reader.fingers),
            hands: std::mem::take(&mut reader.note_hands),
            notation: reader.notation.take(),
            exercise: reader.exercise,
            original_grid: reader.original_grid.take(),
            meter_map: reader.meter_map.take(),
            meter: reader.meter_correction,
            revision: reader.score_revision,
        })
    }
    pub(super) fn preserve_undo(&mut self) {
        self.keep_undo = true;
    }
    pub(super) fn preserve_score_mapping(&mut self) {
        self.keep_score_mapping = true;
    }
    pub(super) fn warning(&self) -> Option<String> {
        self.state.error.clone()
    }
    pub(super) fn revision(&self) -> u64 {
        self.revision
    }
    pub(super) fn install(self, player: &mut Player) {
        let keep_mapping = self.keep_score_mapping
            && player.score_revision == self.revision
            && player.file.as_ref().map(|file| &file.content_id) == Some(&self.file.content_id)
            && player
                .notation
                .as_ref()
                .map(|score| &score.source_fingerprint)
                == self
                    .notation
                    .as_ref()
                    .map(|score| &score.source_fingerprint);
        player.panic();
        let retired = (
            std::mem::replace(&mut player.file, Some(self.file)),
            std::mem::replace(&mut player.source_file, self.source_file),
            std::mem::replace(&mut player.notes, self.notes),
            std::mem::replace(&mut player.events, self.events),
            std::mem::replace(&mut player.sound_timeline, self.sound_timeline),
            std::mem::replace(&mut player.event_notes, self.event_notes),
            std::mem::replace(&mut player.fingers, self.fingers),
            std::mem::replace(&mut player.note_hands, self.hands),
            std::mem::replace(&mut player.notation, self.notation),
            std::mem::replace(&mut player.original_grid, self.original_grid),
        );
        player.retire(retired);
        player.title = self.title;
        player.config = self.config;
        player.exercise = self.exercise;
        player.meter_map = self.meter_map;
        player.meter_correction = self.meter;
        player.score_revision = self.revision;
        if !keep_mapping {
            let old = player.located_score_map.take();
            player.retire(old);
        }
        if !self.keep_undo {
            let old = (std::mem::take(&mut player.finger_undo), std::mem::take(&mut player.hand_undo));
            player.retire(old);
        }
        player.previous_mode = None;
        // Preserve the live connection, recording and startup fields, which can change while preparing.
        player.state.duration = self.state.duration;
        player.state.annotation_revision = self.state.annotation_revision;
        player.state.mode = self.state.mode;
        player.state.wait = self.state.wait;
        player.state.hands = self.state.hands;
        player.state.speed = self.state.speed;
        player.state.count_in = self.state.count_in;
        player.state.metronome = self.state.metronome;
        player.state.rounds = self.state.rounds;
        player.state.latency = self.state.latency;
        player.state.passage = self.state.passage;
        player.state.repetitions = self.state.repetitions;
        player.state.error = self.state.error;
        let metronome = player.state.metronome;
        if player.closing.load(Ordering::Acquire) {
            player.state.metronome = false;
        }
        player.reset_with_sound(self.state.position, Some(self.sound));
        player.state.metronome = metronome;
        // The reader prepared the song without sound; the live player loads the song's stems
        // (vocals, accompaniment) itself, unless the same song's stems are already loaded.
        let song = player.source_file.as_ref().or(player.file.as_ref()).map(|f| f.content_id.clone());
        if player.stems.as_ref().map(|s| &s.content_id) != song.as_ref() {
            player.load_stems();
        }
    }
}

struct Lease {
    tx: mpsc::Sender<runtime_request::Request>,
    id: String,
    done: bool,
}
impl Lease {
    fn finish(mut self, result: Result<asset_edit::Outcome, String>) -> Result<Value, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::AssetEditFinish {
                id: self.id.clone(),
                result,
                reply: Some(reply),
            })
            .map_err(|_| "音乐引擎已关闭")?;
        self.done = true;
        receiver.recv().map_err(|_| "曲目切换结果通道已关闭")?
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if !self.done {
            let _ = self.tx.send(runtime_request::Request::AssetEditFinish {
                id: self.id.clone(),
                result: Err("曲目切换未完成，已保留当前曲目，请重试".into()),
                reply: None,
            });
        }
    }
}
impl Engine {
    pub(super) fn commit_song_switch(
        &self,
        origin: Origin,
        prepared: Input,
        token: background_tasks::TaskToken,
    ) -> Result<Value, String> {
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        token.check()?;
        let id = format!(
            "song-switch-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        );
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::SongSwitchBegin {
                id: id.clone(),
                origin,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        // Ownership must not expire before the actor acknowledges the lease.
        let context = receiver.recv().map_err(|_| "曲目切换准备通道已关闭")??;
        let lease = Lease {
            tx: self.tx.clone(),
            id,
            done: false,
        };
        let result = (|| {
            token.check()?;
            let outcome = context.prepare_switch(prepared, &token)?;
            token.check()?;
            token.begin_commit()?;
            Ok(outcome)
        })();
        lease.finish(result)
    }
    pub(super) fn song_switch_task(
        &self,
        input: Input,
        label: &str,
        content_id: Option<String>,
    ) -> Result<Value, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::ImportContext(reply))
            .map_err(|_| "音乐引擎已关闭")?;
        let origin = receiver.recv().map_err(|_| "曲目切换准备通道已关闭")??;
        let engine = self.clone();
        self.tasks.run(label, content_id, move |token| {
            engine.commit_song_switch(origin, input, token)
        })
    }
}
impl Player {
    pub(super) fn begin_song_switch(
        &mut self,
        id: String,
        origin: &Origin,
    ) -> Result<asset_edit::Context, String> {
        self.check_switch_origin(origin, "切换")?;
        if matches!(self.state.status.as_str(), "playing" | "countIn")
            || !self.state.pressed.is_empty()
        {
            return Err("曲目准备期间已开始演奏，请暂停并松开琴键后重试".into());
        }
        self.begin_asset_edit(id, false, true, true)
    }
}

/// The song and score revision a switch was prepared against.
pub(crate) struct Origin {
    pub content_id: Option<String>,
    pub revision: u64,
}
impl Player {
    /// Pause and record the current song before a switch is prepared elsewhere.
    pub(crate) fn begin_import(&mut self) -> Result<Origin, String> {
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
}
