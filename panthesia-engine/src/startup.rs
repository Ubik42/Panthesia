//! Files are recovered and prepared off playback; only owned results enter the musical runtime.
use crate::*;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    pub stage: &'static str,
    pub active: bool,
    pub ready: bool,
    pub can_skip: bool,
    pub error: Option<String>,
    pub warnings: Vec<StartupWarning>,
}
impl Default for StartupStatus {
    fn default() -> Self {
        Self {
            stage: "ready",
            active: false,
            ready: true,
            can_skip: false,
            error: None,
            warnings: Vec::new(),
        }
    }
}
pub type Status = StartupStatus;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupWarningKind {
    Song,
    SkippedSong,
    SongAssets,
    SongLocation,
    Soundfont,
    Input,
    Output,
    History,
    Settings,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupWarning {
    pub id: String,
    pub kind: StartupWarningKind,
    pub title: String,
    pub detail: String,
    pub source: Option<crate::library_operations::LibraryOpenSource>,
}
fn song_source(prefs: &Preferences) -> Option<crate::library_operations::LibraryOpenSource> {
    if prefs.exercise.is_some() {
        return prefs.last_content_id.as_ref().map(|id| {
            crate::library_operations::LibraryOpenSource::Recent {
                content_id: id.clone(),
            }
        });
    }
    prefs
        .path
        .as_ref()
        .map(|path| crate::library_operations::LibraryOpenSource::File {
            path: path.to_string_lossy().into(),
            title: prefs.title.clone(),
            content_id: prefs.last_content_id.clone(),
        })
}
#[derive(Clone)]
pub(crate) struct Control {
    status: Arc<Mutex<Status>>,
    pub skip: Arc<AtomicBool>,
    pub finished: Arc<AtomicBool>,
}
impl Control {
    pub fn reset(&self) -> Result<(), String> {
        let mut status = self.status.lock().map_err(|_| "启动状态不可用")?;
        if status.active || status.ready {
            return Err("当前没有需要重试的启动恢复任务".into());
        }
        *status = Status {
            stage: "recovering",
            active: true,
            ready: false,
            can_skip: false,
            error: None,
            warnings: Vec::new(),
        };
        self.finished.store(false, Ordering::Release);
        self.skip.store(false, Ordering::Release);
        Ok(())
    }
    pub fn new() -> Self {
        Self {
            status: Arc::new(Mutex::new(Status {
                stage: "recovering",
                active: true,
                ready: false,
                can_skip: false,
                error: None,
                warnings: Vec::new(),
            })),
            skip: Arc::new(AtomicBool::new(false)),
            finished: Arc::new(AtomicBool::new(false)),
        }
    }
    pub fn skip_song(&self) -> Result<(), String> {
        let mut status = self.status.lock().map_err(|_| "启动状态不可用")?;
        if !status.can_skip {
            return Err("当前曲目读取阶段已结束，请等待进入练习室".into());
        }
        self.skip.store(true, Ordering::Release);
        status.stage = "skippingSong";
        status.can_skip = false;
        Ok(())
    }
    pub fn status(&self) -> Status {
        self.status.lock().map(|s| s.clone()).unwrap_or(Status {
            stage: "failed",
            active: false,
            ready: false,
            can_skip: false,
            error: Some("启动状态无法读取，请重新启动".into()),
            warnings: Vec::new(),
        })
    }
    pub fn stage(&self, stage: &'static str, can_skip: bool) {
        if let Ok(mut status) = self.status.lock() {
            status.stage = stage;
            status.can_skip = can_skip;
        }
    }
    fn warn(
        &self,
        id: &str,
        kind: StartupWarningKind,
        title: &str,
        detail: String,
        source: Option<crate::library_operations::LibraryOpenSource>,
    ) {
        if let Ok(mut status) = self.status.lock() {
            status.warnings.retain(|warning| warning.id != id);
            status.warnings.push(StartupWarning {
                id: id.into(),
                kind,
                title: title.into(),
                detail,
                source,
            });
        }
    }
    pub fn dismiss_warning(&self, id: &str) -> Result<bool, String> {
        let mut status = self.status.lock().map_err(|_| "启动状态不可用")?;
        if !status.ready || status.active {
            return Err("启动恢复尚未完成，请等待后再收起提示".into());
        }
        let previous = status.warnings.len();
        status.warnings.retain(|warning| warning.id != id);
        Ok(status.warnings.len() != previous)
    }
    fn complete(&self, blocked: bool, error: Option<String>) {
        if let Ok(mut status) = self.status.lock() {
            let stage = if blocked { status.stage } else { "ready" };
            let mut warnings = std::mem::take(&mut status.warnings);
            if !blocked && warnings.is_empty() {
                if let Some(detail) = &error {
                    warnings.push(StartupWarning {
                        id: "settings".into(),
                        kind: StartupWarningKind::Settings,
                        title: "启动恢复需要核对".into(),
                        detail: detail.clone(),
                        source: None,
                    });
                }
            }
            *status = Status {
                stage,
                active: false,
                ready: !blocked,
                can_skip: false,
                error,
                warnings,
            };
        }
        self.finished.store(true, Ordering::Release);
    }
}
pub(crate) struct Data {
    pub preferences: Preferences,
    pub history: PracticeHistoryStore,
    pub soundfont_presets: Vec<track_sound::Preset>,
    pub error: Option<String>,
    pub blocked: bool,
    font: Option<oxisynth::SoundFont>,
    sound_output: Option<sound_runtime::Boot>,
    input_boot: Option<input_runtime::Boot>,
    soundfont: Option<PathBuf>,
    soundfont_warning: Option<String>,
    device_warnings: Vec<(StartupWarningKind, String)>,
}
impl Data {
    pub fn empty(data: &std::path::Path) -> Self {
        Self {
            preferences: Preferences::default(),
            history: PracticeHistoryStore::empty(data.join("web-practice-history.ron")),
            soundfont_presets: Vec::new(),
            error: None,
            blocked: false,
            font: None,
            sound_output: None,
            input_boot: None,
            soundfont: None,
            soundfont_warning: None,
            device_warnings: Vec::new(),
        }
    }
    #[cfg(test)]
    pub fn read(data: &std::path::Path, soundfont: &std::path::Path) -> Self {
        let mut loaded = Self::read_base(data);
        if !loaded.blocked {
            loaded.soundfont_presets = track_sound::presets(soundfont);
        }
        loaded
    }
    fn read_base(data: &std::path::Path) -> Self {
        let lock = match library_workspace::lock_for(data) {
            Ok(lock) => lock,
            Err(error) => return Self::failed(data, error),
        };
        let _guard = match lock.lock() {
            Ok(guard) => guard,
            Err(_) => return Self::failed(data, "曲库资料锁无法使用".into()),
        };
        let recovery = round_storage::recover(data)
            .and_then(|_| settings_storage::recover(data))
            .and_then(|_| asset_storage::recover(data))
            .and_then(|_| {
                if storage_control::recovery_pending(data) {
                    Err("资料恢复记录尚待处理，请重新启动".into())
                } else {
                    Ok(())
                }
            });
        let loaded = Preferences::load(&data.join("web-preferences.json"));
        let mut error = recovery.err().or_else(|| loaded.as_ref().err().cloned());
        let mut blocked = error.is_some();
        let history = if let Some(error) = &error {
            PracticeHistoryStore::load_read_only(
                data.join("web-practice-history.ron"),
                error.clone(),
            )
        } else {
            let (history, warning) =
                PracticeHistoryStore::load_report(data.join("web-practice-history.ron"));
            error = warning;
            blocked = history.write_block_reason().is_some();
            history
        };
        let soundfont_presets = Vec::new();
        Self {
            preferences: loaded.unwrap_or_default(),
            history,
            soundfont_presets,
            error,
            blocked,
            font: None,
            sound_output: None,
            input_boot: None,
            soundfont: None,
            soundfont_warning: None,
            device_warnings: Vec::new(),
        }
    }
    fn prepare_font(
        &mut self,
        preferred: &std::path::Path,
        fallback: Option<&std::path::Path>,
        silent: bool,
        control: &Control,
    ) {
        if self.blocked {
            return;
        }
        control.stage("preparingSound", false);
        self.soundfont = Some(preferred.into());
        if silent {
            self.soundfont_presets = track_sound::presets(preferred);
            return;
        }
        let prepare = |path: &std::path::Path| {
            soundfont_loading::Prepared::read(path.into())
                .map(|prepared| (prepared.font, prepared.presets))
        };
        let prepared = match prepare(preferred) {
            Ok(value) => Ok(value),
            Err(error) => {
                if let Some(fallback) = fallback.filter(|path| *path != preferred) {
                    self.soundfont_warning =
                        Some(format!("上次音源无法使用，暂用随包钢琴音源：{error}"));
                    self.soundfont = Some(fallback.into());
                    prepare(fallback)
                } else {
                    Err(error)
                }
            }
        };
        match prepared {
            Ok((font, presets)) => {
                self.font = Some(font);
                self.soundfont_presets = presets;
            }
            Err(error) => {
                self.soundfont_presets.clear();
                self.soundfont_warning = Some(format!(
                    "钢琴音源暂时不可用，可在设备设置中重新选择：{error}"
                ));
            }
        }
    }
    fn failed(data: &std::path::Path, error: String) -> Self {
        let mut value = Self::empty(data);
        value.history.block_writes(error.clone());
        value.error = Some(error);
        value.blocked = true;
        value
    }
}
enum Song {
    File(load_pipeline::Prepared),
    Exercise(exercise_loading::Prepared),
}
pub(crate) struct Prepared {
    data: Data,
    song: Option<Song>,
    song_error: Option<String>,
}
impl Prepared {
    fn read(mut data: Data, root: &std::path::Path, control: &Control) -> Self {
        if data.blocked {
            return Self {
                data,
                song: None,
                song_error: None,
            };
        }
        let original_preferences=data.preferences.clone();
        control.stage("restoringSong", true);
        let check = || {
            if control.skip.load(Ordering::Acquire) {
                Err("已跳过上次曲目".into())
            } else {
                Ok(())
            }
        };
        let prepared = (|| {
            check()?;
            if let Some(spec) = data.preferences.exercise {
                let prepared = exercise_loading::prepare_checked(spec, &check)?;
                if data
                    .preferences
                    .last_content_id
                    .as_ref()
                    .is_some_and(|id| id != &prepared.file.content_id)
                {
                    return Err("上次技术练习设置与保存的内容身份不一致，请重新选择练习".into());
                }
                check()?;
                let versions = data
                    .preferences
                    .score_versions
                    .get(&prepared.file.content_id)
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                let prepared=prepared.read_assets_checked(root,versions,&check)?;
                let versions=data.preferences.score_versions.entry(prepared.file.content_id.clone()).or_default();
                return prepared.materialize_for_startup(root,versions).map(|p|Some(Song::Exercise(p)));
            }
            if let Some(path) = data.preferences.path.clone() {
                if path.parent().and_then(|p| p.canonicalize().ok()).as_deref() == Some(root)
                    && matches!(
                        path.file_name().and_then(|v| v.to_str()),
                        Some(
                            "five-finger.mid"
                                | "c-major-scale.mid"
                                | "bass-five-finger.mid"
                                | "parallel-five-finger.mid"
                                | "basic-chords.mid"
                        )
                    )
                {
                    library::builtin_rows(root)?;
                }
                let names = |id: &str| {
                    Ok(data
                        .preferences
                        .score_versions
                        .get(id)
                        .cloned()
                        .unwrap_or_default())
                };
                check()?;
                let direct = load_pipeline::Prepared::read_checked(
                    path.clone(),
                    data.preferences.title.clone(),
                    data.preferences.last_content_id.as_deref(),
                    names,
                    &check,
                );
                check()?;
                if direct.is_ok() || data.preferences.last_content_id.is_none() {
                    return direct.map(|p| Some(Song::File(p)));
                }
                let content_id = data.preferences.last_content_id.clone().unwrap();
                let mut paths = vec![path.clone()];
                if content_id.len() == 64 && content_id.bytes().all(|b| b.is_ascii_hexdigit()) {
                    if let Some(stem) = path.file_stem().and_then(|v| v.to_str()) {
                        paths.push(
                            root.join("builtin-previous")
                                .join(format!("{stem}-{content_id}.mid")),
                        );
                    }
                }
                check()?;
                let input = load_pipeline::Input::Recent {
                    content_id,
                    title: data.preferences.title.clone(),
                    paths,
                };
                return input.read(root, names, check).map(|p| Some(Song::File(p)));
            }
            Ok(None)
        })();
        let prepared=prepared.and_then(|song|{
            match song {
                Some(Song::File(file))=>file.retain_assets(root,&mut data.preferences,&check).map(|file|Some(Song::File(file))),
                other=>Ok(other),
            }
        });
        match prepared {
            Ok(song) => {
                // Restoring owned notation can rebase edition paths. Publish that registry
                // before installing its memory snapshot, using the existing recovery journal.
                if let Err(error)=publish_restored_registry(root,&original_preferences,&data.preferences) {
                    data.preferences=original_preferences;
                    data.blocked=true;
                    data.error=Some(format!("启动资料关联尚未保存，现有文件已保留：{error}"));
                    return Self{data,song:None,song_error:None};
                }
                Self {data,song,song_error:None}
            },
            Err(_) if control.skip.load(Ordering::Acquire) => Self {
                data:Data{preferences:original_preferences,..data},
                song: None,
                song_error: None,
            },
            Err(error) => Self {
                data:Data{preferences:original_preferences,..data},
                song: None,
                song_error: Some(format!("上次曲目无法恢复，历史与设置已保留：{error}")),
            },
        }
    }
}
/// Startup preparation runs detached. The journal checks and backs up the original
/// registry, so a moved profile cannot leave memory ahead of disk or replace edits.
fn publish_restored_registry(root:&std::path::Path,before:&Preferences,after:&Preferences)->Result<(),String> {
    let before=serde_json::to_value(before).map_err(|e|e.to_string())?;
    if before==serde_json::to_value(after).map_err(|e|e.to_string())? {return Ok(());}
    let path=root.join("web-preferences.json");let selected=root.to_path_buf();
    let (result,writes,observed)=panthesia_core::utils::atomic_file::capture_matching(
        Arc::new(move|path|asset_storage::captures(&selected,path)),||{
            let current=Preferences::load(&path)?;
            if serde_json::to_value(current).map_err(|e|e.to_string())?!=before {return Err("恢复期间设置已改变，请重新读取资料".into());}
            after.save(&path)
        });
    result?;
    asset_storage::commit(root,writes,observed)
}
struct Completion {
    tx: mpsc::Sender<runtime_request::Request>,
    finished: bool,
}
impl Completion {
    fn send(mut self, result: Result<Prepared, String>) -> Result<(), String> {
        self.tx
            .send(runtime_request::Request::StartupFinished(result))
            .map_err(|_| "音乐引擎已关闭")?;
        self.finished = true;
        Ok(())
    }
}
impl Drop for Completion {
    fn drop(&mut self) {
        if !self.finished {
            let _ = self.tx.send(runtime_request::Request::StartupFinished(Err(
                "启动恢复任务异常结束，现有资料未被重置，请重试读取".into(),
            )));
        }
    }
}
impl Engine {
    pub(super) fn startup_task(&self) -> Result<(), String> {
        let engine = self.clone();
        let completion = Completion {
            tx: self.tx.clone(),
            finished: false,
        };
        self.tasks.post("恢复练习室", move |token| {
            token.stage("restoring")?;
            engine.startup.stage("recovering", false);
            let mut data = Data::read_base(&engine.data);
            // The MIDI owner can connect while this worker reads the piano samples.
            let pending_input = (!data.blocked).then(|| {
                engine.input.begin_bootstrap(
                    data.preferences.input.clone(),
                    !data.preferences.input_configured && data.preferences.input.is_none(),
                )
            });
            data.prepare_font(
                &engine.soundfont,
                engine.soundfont_fallback.as_deref(),
                engine.silent,
                &engine.startup,
            );
            if !data.blocked {
                engine.startup.stage("connectingInput", false);
                if let Some(pending) = pending_input {
                    match pending.and_then(crate::input_runtime::Bootstrap::finish) {
                        Ok(input) => data.input_boot = Some(input),
                        Err(error) => data.device_warnings.push((
                            StartupWarningKind::Input,
                            format!("MIDI 键盘暂未连接：{error}"),
                        )),
                    }
                }
                engine.startup.stage("connectingOutput", false);
                match engine
                    .sound
                    .bootstrap(data.font.take(), data.preferences.output.clone(),data.preferences.audio_device.clone())
                {
                    Ok(output) => data.sound_output = Some(output),
                    Err(error) => data.device_warnings.push((
                        StartupWarningKind::Output,
                        format!("声音设备暂未连接：{error}"),
                    )),
                }
            }
            let prepared = Prepared::read(data, &engine.data, &engine.startup);
            engine.pending_saves.observe_recovery();
            completion.send(Ok(prepared))?;
            Ok(serde_json::json!({"ok":true}))
        })
    }
}
impl Player {
    pub(super) fn install_startup(&mut self, result: Result<Prepared, String>) {
        let Some(control) = self.startup.clone() else {
            return;
        };
        match result {
            Err(error) => {
                self.storage_busy.store(true, Ordering::Release);
                self.state.error = Some(error.clone());
                self.state.status = "paused".into();
                control.complete(true, Some(error));
            }
            Ok(prepared) => {
                let Prepared {
                    data,
                    song,
                    song_error,
                } = prepared;
                let Data {
                    preferences,
                    history,
                    soundfont_presets,
                    error,
                    blocked,
                    font,
                    sound_output,
                    input_boot,
                    soundfont,
                    soundfont_warning,
                    device_warnings,
                } = data;
                self.asset_recovery_error = None;
                self.storage_recovery_error = None;
                if input_boot.is_none() {
                    if let Some((_, detail)) = device_warnings
                        .iter()
                        .find(|(kind, _)| matches!(kind, StartupWarningKind::Input))
                    {
                        self.state.input = preferences.input.clone();
                        self.input_status_error = Some(detail.clone());
                    }
                }
                let input_warning = input_boot.and_then(|input| {
                    self.state.input = input.name.clone();
                    // Automatic discovery is live device state. Keep the saved registry
                    // unchanged until an explicit device choice or practice edit is committed.
                    self.input_generation = input.generation;
                    self.input_revision = self.input_revision.wrapping_add(1);
                    self.input_disconnects = self
                        .input_client
                        .as_ref()
                        .and_then(input_runtime::Client::status)
                        .map_or(0, |status| status.disconnects);
                    self.input_status_error = input.warning.clone();
                    input.warning
                });
                let old_preferences = std::mem::replace(&mut self.preferences, preferences.clone());
                let old_history = std::mem::replace(&mut self.history, history);
                self.retire((old_preferences, old_history));
                let old = std::mem::replace(&mut self.soundfont_presets, soundfont_presets.into());
                self.retire(old);
                self.state.error = None;
                if let Some(path) = soundfont {
                    self.soundfont = path.clone();
                    self.state.soundfont = path;
                }
                self.prepared_font = font;
                let output_warning = sound_output.and_then(|output| {
                    self.state.output = output.label;
                    output.warning
                });
                self.soundfont_revision = self.soundfont_revision.wrapping_add(1);
                self.state.soundfont_warning = soundfont_warning.clone();
                self.state.soundfont_status = if self.soundfont_presets.is_empty() {
                    "unavailable"
                } else {
                    "ready"
                }
                .into();
                if blocked {
                    self.storage_busy.store(true, Ordering::Release);
                    self.state.error = error.clone();
                    self.state.status = "paused".into();
                    control.complete(true, error);
                    return;
                }
                self.restoring = true;
                if let Some(detail) = &error {
                    control.warn(
                        "history",
                        StartupWarningKind::History,
                        "练习记录需要核对",
                        detail.clone(),
                        None,
                    );
                }
                if let Some(detail) = &soundfont_warning {
                    control.warn(
                        "soundfont",
                        StartupWarningKind::Soundfont,
                        "启动时的钢琴音源提示",
                        detail.clone(),
                        None,
                    );
                }
                if let Some(detail) = &input_warning {
                    control.warn(
                        "input",
                        StartupWarningKind::Input,
                        "启动时的 MIDI 键盘提示",
                        detail.clone(),
                        None,
                    );
                }
                if let Some(detail) = &output_warning {
                    control.warn(
                        "output",
                        StartupWarningKind::Output,
                        "启动时使用了临时声音输出",
                        detail.clone(),
                        None,
                    );
                }
                if let Some(detail) = &song_error {
                    control.warn(
                        "song",
                        StartupWarningKind::Song,
                        "启动时未恢复上次曲目",
                        detail.clone(),
                        song_source(&preferences),
                    );
                }
                if control.skip.load(Ordering::Acquire)
                    && (preferences.path.is_some() || preferences.exercise.is_some())
                {
                    control.warn(
                        "song",
                        StartupWarningKind::SkippedSong,
                        "上次曲目已跳过",
                        "原曲目位置与已保存的记录保留，可重新打开，或从曲库选择其他曲目。".into(),
                        song_source(&preferences),
                    );
                }
                for (kind, detail) in &device_warnings {
                    let (id, title) = match kind {
                        StartupWarningKind::Input => ("input", "启动时的 MIDI 键盘提示"),
                        _ => ("output", "声音设备尚未连接"),
                    };
                    control.warn(id, kind.clone(), title, detail.clone(), None);
                }
                let mut errors = error
                    .into_iter()
                    .chain(soundfont_warning)
                    .chain(song_error)
                    .chain(output_warning)
                    .chain(input_warning)
                    .chain(device_warnings.into_iter().map(|(_, detail)| detail))
                    .collect::<Vec<_>>();
                control.stage("installing", false);
                if !control.skip.load(Ordering::Acquire) {
                    let file_prepared = matches!(&song, Some(Song::File(_)));
                    let installed = match song {
                        Some(Song::File(prepared)) => prepared.check().and_then(|_| {
                            self.install_prepared(
                                prepared.file,
                                prepared.title,
                                None,
                                Some(load_pipeline::InstallData {
                                    assets: Some(prepared.assets),
                                    timeline: prepared.timeline,
                                }),
                            )
                        }),
                        Some(Song::Exercise(prepared)) => prepared.install_startup(self),
                        None => Ok(()),
                    };
                    if let Err(error) = installed {
                        control.warn(
                            "song",
                            StartupWarningKind::Song,
                            "上次曲目安装未完成",
                            error.clone(),
                            song_source(&preferences),
                        );
                        errors.push(error);
                    } else if file_prepared {
                        if let (Some(original), Some(file)) =
                            (&preferences.path, self.file.as_ref())
                        {
                            if let Some(actual) = &file.source_path {
                                if library_workspace::key(original)
                                    != library_workspace::key(actual)
                                {
                                    control.warn("songLocation", StartupWarningKind::SongLocation,
                                        "上次曲目已从其他位置恢复",
                                        format!("原位置：{}；已从 {} 读取同一内容。原文件与附加资料保留。", original.display(), actual.display()),
                                        Some(crate::library_operations::LibraryOpenSource::File {
                                            path: actual.to_string_lossy().into(), title: self.title.clone(), content_id: Some(file.content_id.clone()),
                                        }));
                                }
                            }
                        }
                    }
                } else {
                    // A late skip may arrive after the worker has handed off a large song.
                    self.retire(song);
                }
                self.storage_busy.store(false, Ordering::Release);
                if self.closing.load(Ordering::Acquire) {
                    self.restoring = false;
                    self.state.status = "paused".into();
                    control.complete(false, self.state.error.clone());
                    return;
                }
                if let Some(error) = self.state.error.clone() {
                    if !control
                        .status()
                        .warnings
                        .iter()
                        .any(|warning| warning.detail == error)
                    {
                        let source = self
                            .file
                            .as_ref()
                            .and_then(|file| {
                                file.source_path.as_ref().map(|path| {
                                    crate::library_operations::LibraryOpenSource::File {
                                        path: path.to_string_lossy().into(),
                                        title: self.title.clone(),
                                        content_id: Some(file.content_id.clone()),
                                    }
                                })
                            })
                            .or_else(|| song_source(&preferences));
                        control.warn(
                            "songAssets",
                            StartupWarningKind::SongAssets,
                            "曲目附加资料需要核对",
                            error.clone(),
                            source,
                        );
                    }
                    errors.push(error);
                }
                self.restore_controls(preferences, errors);
                control.complete(false, self.state.error.clone());
            }
        }
    }
}

#[cfg(test)]
mod restored_registry_tests {
    use super::*;
    #[test]
    fn restored_editions_publish_atomically_and_reject_external_settings() {
        let root=std::env::temp_dir().join(format!("panthesia-startup-registry-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&root).unwrap();let path=root.join("web-preferences.json");
        let before=Preferences::default();before.save(&path).unwrap();let mut after=before.clone();after.title="Restored owned song".into();
        publish_restored_registry(&root,&before,&after).unwrap();
        assert_eq!(Preferences::load(&path).unwrap().title,"Restored owned song");
        let mut external=after.clone();external.volume=Some(0.25);external.save(&path).unwrap();let bytes=std::fs::read(&path).unwrap();
        assert!(publish_restored_registry(&root,&before,&after).is_err());assert_eq!(std::fs::read(&path).unwrap(),bytes);
    }
}
