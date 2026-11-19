//! Thread-affine audio streams and plug-in windows live here, independently of playback.
use crate::{audio::Audio, background_tasks::TaskToken, midi_packet::Packet};
use std::{
    collections::BTreeMap,
    path::{Path,PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub ready: bool,
    pub changing: bool,
    pub error: Option<String>,
    pub late_notes: u64,
    pub device: String,
    pub device_id: Option<String>,
    pub plugin_state_path: Option<String>,
    pub plugin_state_restored: bool,
    pub plugin_state_warning: Option<String>,
}
struct Shared {
    level:AtomicU32,
    observable:AtomicBool,
    stop: AtomicBool,
    alive: AtomicBool,
    flushing: AtomicBool,
    busy: AtomicBool,
    started: Instant,
    pulse: AtomicU64,
    late: AtomicU64,
    overrun: AtomicBool,
    desired: AtomicU64,
    installed: AtomicU64,
    serial: AtomicU64,
    epoch: AtomicU64,
    volume: AtomicU32,
    click: AtomicU32,
    audio_ready: AtomicBool,
    route_ready: AtomicBool,
    performance: Mutex<Option<crate::audio::Performance>>,
    status: Mutex<Status>,
}
struct OwnerLifetime(Arc<Shared>);
impl Drop for OwnerLifetime {
    fn drop(&mut self) {
        self.0.alive.store(false, Ordering::Release);
        self.0.route_ready.store(false, Ordering::Release);
    }
}
struct Lifetime {
    shared: Arc<Shared>,
    control: mpsc::Sender<Request>,
}
impl Drop for Lifetime {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::Release);
        let _ = self.control.send(Request::Shutdown);
    }
}
#[derive(Clone)]
pub(crate) struct Host {
    life: Arc<Lifetime>,
    midi: mpsc::SyncSender<Event>,
}
struct Event {
    at: Instant,
    generation: u64,
    epoch: u64,
    bytes: Packet,
}
#[derive(Clone)]
pub(crate) struct Boot {
    pub label: String,
    pub warning: Option<String>,
}
pub(crate) struct Prepared {
    host: Host,
    id: u64,
    pub name: Option<String>,
    pub label: String,
    pub device: Option<Option<String>>,
    done: bool,
}
impl Prepared {
    pub fn activate(mut self) -> Result<(), String> {
        self.host
            .life
            .control
            .send(Request::Activate(self.id))
            .map_err(|_| "声音线程已关闭")?;
        self.host
            .life
            .shared
            .desired
            .store(self.id, Ordering::Release);
        self.host.stop();
        self.done = true;
        Ok(())
    }
}
impl Drop for Prepared {
    fn drop(&mut self) {
        if !self.done {
            let _ = self.host.life.control.send(Request::Discard(self.id));
        }
    }
}
enum Request {
    Device {id:u64,name:Option<String>,output:Option<String>,font:oxisynth::SoundFont,token:TaskToken,reply:mpsc::SyncSender<Result<String,String>>},
    Boot {
        id: u64,
        font: Option<oxisynth::SoundFont>,
        output: Option<String>,
        device: Option<String>,
        reply: mpsc::SyncSender<Result<Boot, String>>,
    },
    Output {
        id: u64,
        name: Option<String>,
        token: TaskToken,
        reply: mpsc::SyncSender<Result<String, String>>,
    },
    Font {
        id: u64,
        font: oxisynth::SoundFont,
        token: TaskToken,
        reply: mpsc::SyncSender<Result<(), String>>,
    },
    Activate(u64),
    Discard(u64),
    Editor {
        generation: u64,
        reply: mpsc::SyncSender<Result<(), String>>,
    },
    Flush(mpsc::SyncSender<Result<(), String>>),
    Shutdown,
}
enum Route {
    Builtin,
    Midi {connection:midir::MidiOutputConnection,expression:crate::midi_master_volume::ExpressionGain},
    Vst(panthesia_vst3::Vst3OutputConnection),
}
impl Route {
    fn open(name: Option<&str>,device:Option<&str>,state_root:&Path) -> Result<Self, String> {
        match name {
            None => Ok(Self::Builtin),
            Some(name) if name.starts_with("vst3:") => {
                let path = PathBuf::from(&name[5..]);
                let backend = panthesia_vst3::Vst3Backend::for_device(device)
                    .map_err(|error| error.to_string())?.with_state_root(state_root.to_path_buf());
                if !backend
                    .has_output(&path)
                    .map_err(|error| format!("VST3 插件位置无法读取：{error}"))?
                {
                    return Err("音源不在已发现的 VST3 插件中，请刷新插件清单后重新选择".into());
                }
                backend
                    .new_output_connection(&path)
                    .map(|vst| {
                        vst.set_state_persistence(false);
                        Self::Vst(vst)
                    })
                    .map_err(|error| error.to_string())
            }
            Some(name) => {
                let midi = midir::MidiOutput::new("Panthesia playback")
                    .map_err(|error| error.to_string())?;
                let port = midi
                    .ports()
                    .into_iter()
                    .find(|port| midi.port_name(port).ok().as_deref() == Some(name))
                    .ok_or("找不到所选 MIDI 输出")?;
                midi.connect(&port, "Panthesia playback")
                    .map(|connection|Self::Midi{connection,expression:Default::default()})
                    .map_err(|error| error.to_string())
            }
        }
    }
    fn stop(&mut self) {
        match self {
            Self::Builtin => {}
            Self::Vst(vst) => vst.stop_all(),
            Self::Midi {connection:midi,..} => {
                for channel in 0..16 {
                    for (cc, value) in [(64, 0), (123, 0), (120, 0)] {
                        let _ = midi.send(&[176 | channel, cc, value]);
                    }
                }
            }
        }
    }
    fn send(&mut self, bytes: &[u8], audio: Option<&Audio>) -> Result<(), String> {
        match self {
            Self::Builtin => {
                if let Some(audio) = audio {
                    audio.send(bytes);
                }
                Ok(())
            }
            Self::Midi {connection,expression} => expression.send(bytes,|bytes|connection.send(bytes).map_err(|error|format!("MIDI 输出失败：{error}"))),
            Self::Vst(vst) => {
                if let Ok(midi_file::midly::live::LiveEvent::Midi { channel, message }) =
                    midi_file::midly::live::LiveEvent::parse(bytes)
                {
                    vst.midi_event(channel, message);
                }
                Ok(())
            }
        }
    }
    fn set_volume(&mut self,volume:f64)->Result<(),String> {
        match self {
            Self::Builtin=>Ok(()),
            Self::Vst(vst)=>{vst.set_volume(volume);Ok(())},
            Self::Midi {connection,expression}=>expression.set_volume(volume,|bytes|connection.send(bytes).map_err(|error|format!("MIDI 音量设置失败：{error}"))),
        }
    }
}
enum Replacement {
    Device {audio:Option<Audio>,route:Route,device:Option<String>},
    Output(Route),
    Font(Audio),
    SilentFont,
}
fn label(name: Option<&str>) -> String {
    match name {
        None => "内置钢琴".into(),
        Some(name) if name.starts_with("vst3:") => format!(
            "VST3 · {}",
            PathBuf::from(&name[5..])
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
        ),
        Some(name) => name.into(),
    }
}
struct Owner {
    state_root:PathBuf,
    meter_at: Instant,
    device:Option<String>,
    audio: Option<Audio>,
    route: Route,
    staged: BTreeMap<u64, Replacement>,
    generation: u64,
    epoch: u64,
    volume: u32,
    silent: bool,
    shared: Arc<Shared>,
}
impl Owner {
    fn sync_volume(&mut self)->Result<(),String> {
        self.volume=self.shared.volume.load(Ordering::Acquire);
        let volume=f32::from_bits(self.volume) as f64;
        if let Some(audio)=&self.audio {audio.set_volume(volume);}
        self.route.set_volume(volume)
    }
    fn stop(&mut self) {
        self.route.stop();
        if let Some(audio) = &self.audio {
            audio.stop();
        }
        self.epoch = self.shared.epoch.load(Ordering::Acquire);
        self.shared.click.store(0, Ordering::Release);
    }
    fn publish(&self, error: Option<String>) {
        self.shared
            .audio_ready
            .store(self.silent || self.audio.is_some(), Ordering::Release);
        let ready = error.is_none()
            && (self.silent || !matches!(self.route, Route::Builtin) || self.audio.is_some());
        self.shared.route_ready.store(ready, Ordering::Release);
        if let Ok(mut state) = self.shared.status.lock() {
            *state = Status {
                ready,
                changing: false,
                error,
                late_notes: self.shared.late.load(Ordering::Acquire),
                device: if matches!(self.route,Route::Midi{..}){"Windows MIDI · 系统路由".into()}else{Audio::device(self.device.as_deref()).map(|d|d.to_string()).unwrap_or_else(|_|"发声设备不可用".into())},
                device_id:self.device.clone(),
                plugin_state_path:if let Route::Vst(vst)=&self.route{vst.state_location().map(|path|path.to_string_lossy().into_owned())}else{None},
                plugin_state_restored:if let Route::Vst(vst)=&self.route{vst.state_restored()}else{false},
                plugin_state_warning:if let Route::Vst(vst)=&self.route{vst.state_warning().map(str::to_owned)}else{None},
            };
        }
    }
    fn request(&mut self, request: Request) -> bool {
        let preparing = matches!(
            &request,
            Request::Boot { .. }
                | Request::Device { .. }
                | Request::Output { .. }
                | Request::Font { .. }
                | Request::Activate(_)
                | Request::Discard(_)
        );
        if preparing {
            self.shared.busy.store(true, Ordering::Release);
        }
        if self.epoch != self.shared.epoch.load(Ordering::Acquire) {
            self.stop();
        }
        match request {
            Request::Shutdown => return false,
            Request::Discard(id) => {
                self.staged.remove(&id);
            }
            Request::Activate(id) => {
                if let Some(next) = self.staged.remove(&id) {
                    self.stop();
                    match next {
                        Replacement::Device {audio,route,device} => {
                            if let Some(audio)=&audio {audio.set_volume(f32::from_bits(self.shared.volume.load(Ordering::Acquire)) as f64);}
                            if let Route::Vst(vst)=&route {vst.set_state_persistence(true);}
                            self.audio=audio; self.route=route;self.device=device;
                        }
                        Replacement::Output(route) => {
                            if let Route::Vst(vst) = &route {
                                vst.set_state_persistence(true);
                            }
                            self.route = route;
                        }
                        Replacement::Font(audio) => {
                            audio.set_volume(f32::from_bits(
                                self.shared.volume.load(Ordering::Acquire),
                            ) as f64);
                            self.audio = Some(audio);
                        }
                        Replacement::SilentFont => {}
                    }
                    self.shared.late.store(0, Ordering::Release);
                    self.generation = id;
                    self.shared.installed.store(id, Ordering::Release);
                    let error=self.sync_volume().err();
                    self.publish(error);
                } else {
                    self.publish(Some("待安装的音源连接已失效，请重新选择".into()));
                }
            }
            Request::Boot {
                id,
                font,
                output,
                device,
                reply,
            } => {
                self.device=device;
                self.stop();
                self.staged.clear();
                let mut warnings = Vec::new();
                let audio = if self.silent {
                    None
                } else {
                    font.and_then(|font| match Audio::open_font_device(font,self.device.as_deref()) {
                        Ok(audio) => Some(audio),
                        Err(error) => {
                            warnings.push(format!("内置音源连接失败：{error}"));
                            None
                        }
                    })
                };
                let (route, chosen) = if self.silent {
                    (Route::Builtin, output.clone())
                } else {
                    match Route::open(output.as_deref(),self.device.as_deref(),&self.state_root) {
                        Ok(route) => (route, output.clone()),
                        Err(error) => {
                            warnings.push(format!("上次音源无法连接，暂用内置钢琴：{error}"));
                            (Route::Builtin, None)
                        }
                    }
                };
                if let Route::Vst(vst) = &route {
                    vst.set_state_persistence(true);
                }
                self.audio = audio;
                self.route = route;
                self.shared.late.store(0, Ordering::Release);
                self.generation = id;
                self.shared.desired.store(id, Ordering::Release);
                self.shared.installed.store(id, Ordering::Release);
                let volume_error=self.sync_volume().err();
                if let Some(error)=&volume_error {warnings.push(error.clone());}
                let warning = (!warnings.is_empty()).then(|| warnings.join("；"));
                self.publish(volume_error);
                let _ = reply.send(Ok(Boot {
                    label: label(chosen.as_deref()),
                    warning,
                }));
            }
            Request::Device {id,name,output,font,token,reply} => {
                let result=(||{
                    token.check()?;
                    if let Route::Vst(vst)=&self.route {vst.save_state().map_err(|e|e.to_string())?;}
                    let audio=if self.silent {None}else{Some(Audio::open_font_device(font,name.as_deref())?)};
                    let route=if self.silent {Route::Builtin}else{Route::open(output.as_deref(),name.as_deref(),&self.state_root)?};
                    token.check()?;
                    self.staged.insert(id,Replacement::Device {audio,route,device:name});
                    Ok(label(output.as_deref()))
                })();
                if reply.send(result).is_err(){self.staged.remove(&id);}
            }
            Request::Output {
                id,
                name,
                token,
                reply,
            } => {
                let result = token
                    .check()
                    .and_then(|_| {
                        if let Route::Vst(vst) = &self.route {
                            vst.save_state()
                                .map_err(|error| format!("当前音源状态尚未保存：{error}"))?;
                        }
                        Ok(())
                    })
                    .and_then(|_| {
                        if self.silent {
                            Ok(Route::Builtin)
                        } else {
                            Route::open(name.as_deref(),self.device.as_deref(),&self.state_root)
                        }
                    })
                    .and_then(|route| {
                        token.check()?;
                        if matches!(route, Route::Builtin)
                            && !self.silent
                            && self
                                .audio
                                .as_ref()
                                .is_none_or(|audio| audio.error().is_some())
                        {
                            return Err("内置音源尚不可用，请先选择有效的 .sf2 文件".into());
                        }
                        self.staged.insert(id, Replacement::Output(route));
                        Ok(label(name.as_deref()))
                    });
                if reply.send(result).is_err() {
                    self.staged.remove(&id);
                }
            }
            Request::Font {
                id,
                font,
                token,
                reply,
            } => {
                let result = token
                    .check()
                    .and_then(|_| {
                        if self.silent {
                            Ok(Replacement::SilentFont)
                        } else {
                            Audio::open_font_device(font,self.device.as_deref()).map(Replacement::Font)
                        }
                    })
                    .and_then(|font| {
                        token.check()?;
                        self.staged.insert(id, font);
                        Ok(())
                    });
                if reply.send(result).is_err() {
                    self.staged.remove(&id);
                }
            }
            Request::Flush(reply) => {
                self.stop();
                let result = match &self.route {
                    Route::Vst(vst) => {
                        vst.close_editor();
                        vst.save_state()
                            .map_err(|error| format!("音源状态尚未保存，程序暂未关闭：{error}"))
                    }
                    _ => Ok(()),
                };
                self.shared.flushing.store(false, Ordering::Release);
                let _ = reply.send(result);
            }
            Request::Editor { generation, reply } => {
                let result = if generation != self.generation
                    || generation != self.shared.desired.load(Ordering::Acquire)
                {
                    Err("演奏音源已改变，请重新打开音源窗口".into())
                } else {
                    match &self.route {
                        Route::Vst(vst) => vst.open_editor().map_err(|error| error.to_string()),
                        _ => Err("请先选择 VST3 音源".into()),
                    }
                };
                let _ = reply.send(result);
            }
        }
        self.shared.pulse.store(
            self.shared.started.elapsed().as_millis() as u64,
            Ordering::Release,
        );
        if preparing {
            self.shared.busy.store(false, Ordering::Release);
        }
        true
    }
    fn service(&mut self, events: &mpsc::Receiver<Event>) {
        if self.meter_at.elapsed()>=Duration::from_millis(16) {
        self.meter_at=Instant::now();
        if let Ok(mut performance)=self.shared.performance.try_lock(){*performance=if matches!(self.route,Route::Builtin){self.audio.as_ref().map(Audio::performance)}else{None};}
        let level=match &self.route {Route::Builtin=>self.audio.as_ref().map(Audio::peak),Route::Vst(vst)=>Some(vst.peak()),Route::Midi{..}=>None};
        self.shared.observable.store(level.is_some(),Ordering::Relaxed);
        let previous=f32::from_bits(self.shared.level.load(Ordering::Relaxed));
        self.shared.level.store(level.unwrap_or(0.).max(previous*0.65).to_bits(),Ordering::Relaxed);
        }
        if matches!(self.route, Route::Builtin) {
            if let Some(error) = self.audio.as_ref().and_then(Audio::error) {
                let fresh = self
                    .shared
                    .status
                    .try_lock()
                    .is_ok_and(|status| status.error.as_ref() != Some(&error));
                if fresh {
                    self.stop();
                    self.publish(Some(error));
                }
            }
        }
        if self.shared.overrun.swap(false, Ordering::AcqRel) {
            self.stop();
            self.publish(Some(
                "声音事件积压，已停止发声，请重新选择演奏音源后继续".into(),
            ));
        }
        if self.epoch != self.shared.epoch.load(Ordering::Acquire) {
            self.stop();
        }
        let volume = self.shared.volume.load(Ordering::Acquire);
        if self.volume != volume {
            if let Err(error)=self.sync_volume() {self.publish(Some(error));}
        }
        let click = self.shared.click.swap(0, Ordering::AcqRel);
        if click != 0 {
            if let Some(audio) = &self.audio {
                audio.click(click == 2);
            }
        }
        // Wait for the already-admitted activation before consuming its controller restore.
        if self.generation == self.shared.desired.load(Ordering::Acquire) {
            for _ in 0..256 {
                match events.try_recv() {
                    Ok(event)
                        if event.generation == self.generation
                            && event.epoch == self.shared.epoch.load(Ordering::Acquire) =>
                    {
                        let bytes = event.bytes.bytes();
                        if event.at.elapsed() > Duration::from_millis(100)
                            && bytes.first().is_some_and(|status| status & 240 == 144)
                            && bytes.get(2).is_some_and(|velocity| *velocity > 0)
                        {
                            self.shared.late.fetch_add(1, Ordering::AcqRel);
                            continue;
                        }
                        if let Err(error) =
                            self.route.send(event.bytes.bytes(), self.audio.as_ref())
                        {
                            self.stop();
                            self.publish(Some(error));
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(_) => break,
                }
            }
        }
        if let Route::Vst(vst) = &self.route {
            vst.service_editor();
        }
        self.shared.pulse.store(
            self.shared.started.elapsed().as_millis() as u64,
            Ordering::Release,
        );
    }
}
impl Host {
    pub fn start(silent: bool,data:PathBuf) -> Result<Self, String> {
        let shared = Arc::new(Shared {
            level:AtomicU32::new(0),observable:AtomicBool::new(false),
            stop: AtomicBool::new(false),
            alive: AtomicBool::new(true),
            flushing: AtomicBool::new(false),
            busy: AtomicBool::new(false),
            started: Instant::now(),
            pulse: AtomicU64::new(0),
            late: AtomicU64::new(0),
            overrun: AtomicBool::new(false),
            desired: AtomicU64::new(0),
            installed: AtomicU64::new(0),
            serial: AtomicU64::new(1),
            epoch: AtomicU64::new(0),
            volume: AtomicU32::new(1f32.to_bits()),
            click: AtomicU32::new(0),
            audio_ready: AtomicBool::new(silent),
            route_ready: AtomicBool::new(silent),
            performance: Mutex::new(None),
            status: Mutex::new(Status::default()),
        });
        let (control, receiver) = mpsc::channel();
        let (midi, events) = mpsc::sync_channel(4096);
        let worker = shared.clone();
        std::thread::Builder::new()
            .name("neothesia-sound-owner".into())
            .spawn(move || {
                let _lifetime = OwnerLifetime(worker.clone());
                let mut owner = Owner {
                    state_root:data.join("vst3-state"),
                    meter_at: Instant::now(),
                    device:None,
                    audio: None,
                    route: Route::Builtin,
                    staged: BTreeMap::new(),
                    generation: 0,
                    epoch: 0,
                    volume: 1f32.to_bits(),
                    silent,
                    shared: worker.clone(),
                };
                while !worker.stop.load(Ordering::Acquire) {
                    match receiver.recv_timeout(Duration::from_millis(1)) {
                        Ok(request) => {
                            if !owner.request(request) {
                                break;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    owner.service(&events);
                }
                owner.stop();
                // Dropping streams, windows, and saved plug-in state stays on this thread.
            })
            .map_err(|error| format!("声音线程无法启动：{error}"))?;
        Ok(Self {
            life: Arc::new(Lifetime { shared, control }),
            midi,
        })
    }
    fn id(&self) -> u64 {
        self.life.shared.serial.fetch_add(1, Ordering::AcqRel)
    }
    pub fn bootstrap(
        &self,
        font: Option<oxisynth::SoundFont>,
        output: Option<String>,
        device:Option<String>,
    ) -> Result<Boot, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.life
            .control
            .send(Request::Boot {
                id: self.id(),
                font,
                output,
                device,
                reply,
            })
            .map_err(|_| "声音线程已关闭")?;
        receiver.recv().map_err(|_| "声音启动结果通道已关闭")?
    }
    pub fn prepare_device(&self,name:Option<String>,output:Option<String>,font:oxisynth::SoundFont,token:TaskToken)->Result<Prepared,String>{
        let id=self.id();let(reply,receiver)=mpsc::sync_channel(1);
        self.life.control.send(Request::Device{id,name:name.clone(),output:output.clone(),font,token,reply}).map_err(|_|"声音线程已关闭")?;
        let label=receiver.recv().map_err(|_|"设备连接通道已关闭")??;
        Ok(Prepared{host:self.clone(),id,name:output,label,device:Some(name),done:false})
    }
    pub fn prepare_output(
        &self,
        name: Option<String>,
        token: TaskToken,
    ) -> Result<Prepared, String> {
        let id = self.id();
        let (reply, receiver) = mpsc::sync_channel(1);
        self.life
            .control
            .send(Request::Output {
                id,
                name: name.clone(),
                token,
                reply,
            })
            .map_err(|_| "声音线程已关闭")?;
        let label = receiver.recv().map_err(|_| "音源连接结果通道已关闭")??;
        Ok(Prepared {
            host: self.clone(),
            id,
            name,
            label,
            device:None,
            done: false,
        })
    }
    pub fn prepare_font(
        &self,
        font: oxisynth::SoundFont,
        token: TaskToken,
    ) -> Result<Prepared, String> {
        let id = self.id();
        let (reply, receiver) = mpsc::sync_channel(1);
        self.life
            .control
            .send(Request::Font {
                id,
                font,
                token,
                reply,
            })
            .map_err(|_| "声音线程已关闭")?;
        receiver
            .recv()
            .map_err(|_| "音源文件连接结果通道已关闭")??;
        Ok(Prepared {
            host: self.clone(),
            id,
            name: None,
            label: String::new(),
            device:None,
            done: false,
        })
    }
    pub fn flush(&self) -> Result<(), String> {
        if !self.life.shared.alive.load(Ordering::Acquire) {
            return Ok(());
        }
        if self.life.shared.flushing.swap(true, Ordering::AcqRel) {
            return Err("声音设备仍在保存状态，请等待完成后重试关闭".into());
        }
        self.stop();
        let (reply, receiver) = mpsc::sync_channel(1);
        if self.life.control.send(Request::Flush(reply)).is_err() {
            self.life.shared.flushing.store(false, Ordering::Release);
            return Err("声音线程已关闭".into());
        }
        receiver
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "声音设备仍在完成退出处理，程序暂未关闭，请稍后重试".to_string())?
    }
    pub fn generation(&self) -> u64 {
        self.life.shared.desired.load(Ordering::Acquire)
    }
    pub fn performance(&self)->Option<crate::audio::Performance>{self.life.shared.performance.try_lock().ok().and_then(|p|p.clone())}
    pub fn level(&self)->Option<f32>{self.life.shared.observable.load(Ordering::Relaxed).then(||f32::from_bits(self.life.shared.level.load(Ordering::Relaxed)))}
    pub fn open_editor(&self, generation: u64) -> Result<(), String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.life
            .control
            .send(Request::Editor { generation, reply })
            .map_err(|_| "声音线程已关闭")?;
        receiver.recv().map_err(|_| "音源窗口结果通道已关闭")?
    }
    pub fn send(&self, bytes: &[u8]) {
        if (self.stalled()
            || self.life.shared.busy.load(Ordering::Acquire)
            || self.life.shared.flushing.load(Ordering::Acquire)
            || self.life.shared.desired.load(Ordering::Acquire)
                != self.life.shared.installed.load(Ordering::Acquire))
            && bytes
                .first()
                .is_some_and(|status| matches!(status & 240, 128 | 144))
        {
            return;
        }
        if self
            .midi
            .try_send(Event {
                at: Instant::now(),
                generation: self.life.shared.desired.load(Ordering::Acquire),
                epoch: self.life.shared.epoch.load(Ordering::Acquire),
                bytes: Packet::new(bytes),
            })
            .is_err()
        {
            self.life.shared.overrun.store(true, Ordering::Release);
            self.stop();
        }
    }
    pub fn stop(&self) {
        self.life.shared.epoch.fetch_add(1, Ordering::AcqRel);
        self.life.shared.click.store(0, Ordering::Release);
    }
    pub fn click(&self, accent: bool) {
        self.life
            .shared
            .click
            .store(if accent { 2 } else { 1 }, Ordering::Release);
    }
    pub fn set_volume(&self, volume: f64) {
        self.life
            .shared
            .volume
            .store((volume as f32).to_bits(), Ordering::Release);
    }
    fn stalled(&self) -> bool {
        !self.life.shared.busy.load(Ordering::Acquire)
            && !self.life.shared.flushing.load(Ordering::Acquire)
            && (self.life.shared.started.elapsed().as_millis() as u64)
                .saturating_sub(self.life.shared.pulse.load(Ordering::Acquire))
                > 500
    }
    pub fn ready(&self, with_click: bool) -> bool {
        if self.stalled() || self.life.shared.busy.load(Ordering::Acquire) {
            return false;
        }
        if self.life.shared.flushing.load(Ordering::Acquire) {
            return false;
        }
        self.life.shared.alive.load(Ordering::Acquire)
            && self.life.shared.desired.load(Ordering::Acquire)
                == self.life.shared.installed.load(Ordering::Acquire)
            && self.life.shared.route_ready.load(Ordering::Acquire)
            && (!with_click || self.life.shared.audio_ready.load(Ordering::Acquire))
    }
    pub fn status(&self) -> Status {
        if !self.life.shared.alive.load(Ordering::Acquire) {
            return Status {
                ready: false,
                changing: false,
                error: Some("声音线程已停止，请重新启动应用恢复音源".into()),
                late_notes: self.life.shared.late.load(Ordering::Acquire),
                ..Status::default()
            };
        }
        if self.stalled() {
            return Status {
                ready: false,
                changing: false,
                error: Some("声音设备响应中断，已暂停演奏，请等待设备恢复或重新连接音源".into()),
                late_notes: self.life.shared.late.load(Ordering::Acquire),
                ..Status::default()
            };
        }
        let mut status = self
            .life
            .shared
            .status
            .try_lock()
            .map(|state| state.clone())
            .unwrap_or_else(|_| Status {
                ready: self.ready(false),
                ..Status::default()
            });
        status.changing = self.life.shared.busy.load(Ordering::Acquire)
            || self.life.shared.flushing.load(Ordering::Acquire)
            || self.life.shared.desired.load(Ordering::Acquire)
                != self.life.shared.installed.load(Ordering::Acquire);
        status.late_notes = self.life.shared.late.load(Ordering::Acquire);
        status.ready &= !status.changing;
        status
    }
}
