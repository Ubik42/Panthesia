//! MIDI ports stay on their owner thread; input packets carry selection and connection identity.
use crate::{background_tasks::TaskToken, device_catalog, midi_packet::Packet};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
pub(crate) struct Event {
    pub selection: u64,
    pub stream: u64,
    bytes: Packet,
}
impl Event {
    pub fn legacy(bytes: &[u8]) -> Self {
        Self {
            selection: 0,
            stream: 0,
            bytes: Packet::new(bytes),
        }
    }
    pub fn bytes(&self) -> &[u8] {
        self.bytes.bytes()
    }
}
#[derive(Clone, Default)]
pub(crate) struct Status {
    pub selection: u64,
    pub connected: bool,
    pub disconnects: u64,
    pub error: Option<String>,
}
struct Shared {
    stop: AtomicBool,
    alive: AtomicBool,
    selection: AtomicU64,
    installed: AtomicU64,
    connected: AtomicBool,
    stream: AtomicU64,
    serial: AtomicU64,
    status: Mutex<Status>,
}
struct OwnerLifetime(Arc<Shared>);
impl Drop for OwnerLifetime {
    fn drop(&mut self) {
        self.0.alive.store(false, Ordering::Release);
    }
}
struct Lifetime {
    shared: Arc<Shared>,
    tx: mpsc::Sender<Request>,
}
impl Drop for Lifetime {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::Release);
        let _ = self.tx.send(Request::Stop);
    }
}
#[derive(Clone)]
pub(crate) struct Client {
    life: Arc<Lifetime>,
}
pub(crate) struct Boot {
    pub name: Option<String>,
    pub generation: u64,
    pub warning: Option<String>,
}
pub(crate) struct Bootstrap(mpsc::Receiver<Result<Boot, String>>);
impl Bootstrap {
    pub fn finish(self) -> Result<Boot, String> {
        self.0.recv().map_err(|_| "键盘启动回复中断，请重新启动练习室")?
    }
}
pub(crate) struct Prepared {
    client: Client,
    pub generation: u64,
    pub name: Option<String>,
    reuse: bool,
    done: bool,
}
impl Prepared {
    pub fn activate(mut self) -> Result<(), String> {
        let shared = &self.client.life.shared;
        let previous = shared.selection.swap(self.generation, Ordering::AcqRel);
        if self
            .client
            .life
            .tx
            .send(Request::Activate(self.generation))
            .is_err()
        {
            let _ = shared.selection.compare_exchange(
                self.generation,
                previous,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
            return Err("MIDI 输入线程已关闭".into());
        }
        self.done = true;
        Ok(())
    }
}
impl Drop for Prepared {
    fn drop(&mut self) {
        if !self.done && !self.reuse {
            let _ = self.client.life.tx.send(Request::Discard(self.generation));
        }
    }
}
struct Slot {
    name: Option<String>,
    stream: u64,
    connection: Option<midir::MidiInputConnection<()>>,
    observed_after: Instant,
}
enum Request {
    Boot {
        name: Option<String>,
        automatic: bool,
        reply: mpsc::SyncSender<Result<Boot, String>>,
    },
    Prepare {
        name: Option<String>,
        token: TaskToken,
        reply: mpsc::SyncSender<Result<(u64, bool), String>>,
    },
    Activate(u64),
    Discard(u64),
    Stop,
}
struct Owner {
    shared: Arc<Shared>,
    input: mpsc::SyncSender<Event>,
    overflow: Arc<AtomicBool>,
    catalog: device_catalog::Catalog,
    active: Slot,
    selection: u64,
    disconnects: u64,
    staged: BTreeMap<u64, Slot>,
    silent: bool,
    retry_at: Instant,
}
impl Owner {
    fn id(&self) -> u64 {
        self.shared.serial.fetch_add(1, Ordering::AcqRel)
    }
    fn connect(
        &self,
        name: &str,
        selection: u64,
        stream: u64,
    ) -> Result<midir::MidiInputConnection<()>, String> {
        let mut midi =
            midir::MidiInput::new("Panthesia keyboard").map_err(|error| error.to_string())?;
        midi.ignore(midir::Ignore::None);
        let port = midi
            .ports()
            .into_iter()
            .find(|port| midi.port_name(port).ok().as_deref() == Some(name))
            .ok_or("找不到所选 MIDI 键盘")?;
        let shared = self.shared.clone();
        let tx = self.input.clone();
        let overflow = self.overflow.clone();
        midi.connect(
            &port,
            "Panthesia keyboard",
            move |_, bytes, _| {
                if shared.selection.load(Ordering::Acquire) != selection
                    || shared.stream.load(Ordering::Acquire) != stream
                {
                    return;
                }
                if tx
                    .try_send(Event {
                        selection,
                        stream,
                        bytes: Packet::new(bytes),
                    })
                    .is_err()
                {
                    overflow.store(true, Ordering::Release);
                }
            },
            (),
        )
        .map_err(|error| error.to_string())
    }
    fn publish(&self, error: Option<String>) {
        self.shared
            .connected
            .store(self.active.connection.is_some(), Ordering::Release);
        self.shared
            .installed
            .store(self.selection, Ordering::Release);
        let desired = self.shared.selection.load(Ordering::Acquire);
        if let Ok(mut state) = self.shared.status.lock() {
            *state = Status {
                selection: desired,
                connected: self.selection == desired && self.active.connection.is_some(),
                disconnects: self.disconnects,
                error,
            };
        }
    }
    fn request(&mut self, request: Request) -> bool {
        match request {
            Request::Stop => return false,
            Request::Discard(id) => {
                self.staged.remove(&id);
            }
            Request::Activate(id) => {
                if id != self.shared.selection.load(Ordering::Acquire) {
                    self.staged.remove(&id);
                    return true;
                }
                if id == self.selection {
                    self.publish(None);
                    return true;
                }
                if let Some(slot) = self.staged.remove(&id) {
                    let old = std::mem::replace(&mut self.active, slot);
                    self.selection = id;
                    self.shared
                        .stream
                        .store(self.active.stream, Ordering::Release);
                    self.publish(None);
                    drop(old);
                } else {
                    self.publish(Some("待连接的 MIDI 键盘已失效，请重新选择输入设备".into()));
                }
            }
            Request::Boot {
                name,
                automatic,
                reply,
            } => {
                self.staged.clear();
                let mut warning = None;
                let name = if automatic && !self.silent {
                    let (names, issue) = device_catalog::inputs();
                    warning = issue;
                    names.unwrap_or_default().into_iter().next()
                } else {
                    name
                };
                let selection = self.id();
                let stream = self.id();
                let connection = if let Some(name) = &name {
                    match self.connect(name, selection, stream) {
                        Ok(connection) => Some(connection),
                        Err(error) => {
                            warning = Some(error);
                            None
                        }
                    }
                } else {
                    None
                };
                self.active = Slot {
                    name: name.clone(),
                    stream,
                    connection,
                    observed_after: Instant::now(),
                };
                self.selection = selection;
                self.shared.selection.store(selection, Ordering::Release);
                self.shared.stream.store(stream, Ordering::Release);
                // Inventory warnings remain in the boot report and catalog. A usable
                // keyboard must not inherit another port's error as its live status.
                self.publish(if self.active.connection.is_some() {
                    None
                } else {
                    warning.clone()
                });
                let _ = reply.send(Ok(Boot {
                    name,
                    generation: selection,
                    warning,
                }));
            }
            Request::Prepare { name, token, reply } => {
                let result = (|| {
                    token.check()?;
                    if name == self.active.name
                        && (name.is_none() || self.active.connection.is_some())
                    {
                        return Ok((self.selection, true));
                    }
                    let selection = self.id();
                    let stream = self.id();
                    let connection = if let Some(name) = &name {
                        Some(self.connect(name, selection, stream)?)
                    } else {
                        None
                    };
                    token.check()?;
                    self.staged.insert(
                        selection,
                        Slot {
                            name,
                            stream,
                            connection,
                            observed_after: Instant::now(),
                        },
                    );
                    Ok((selection, false))
                })();
                let staged = result
                    .as_ref()
                    .ok()
                    .filter(|(_, reuse)| !*reuse)
                    .map(|(selection, _)| *selection);
                if reply.send(result).is_err() {
                    if let Some(id) = staged {
                        self.staged.remove(&id);
                    }
                }
            }
        }
        true
    }
    fn hotplug(&mut self) {
        if self.shared.selection.load(Ordering::Acquire) != self.selection {
            return;
        }
        let Some(name) = self.active.name.clone() else {
            return;
        };
        let Some(present) = self
            .catalog
            .input_present_since(&name, self.active.observed_after)
        else {
            return;
        };
        if !present && self.active.connection.is_some() {
            self.shared.stream.store(self.id(), Ordering::Release);
            let old = self.active.connection.take();
            self.disconnects = self.disconnects.wrapping_add(1);
            self.publish(Some("MIDI 键盘已断开，播放已暂停；重新连接后可继续".into()));
            drop(old);
        } else if present
            && self.active.connection.is_none()
            && self.retry_at.elapsed() >= Duration::from_secs(1)
        {
            self.retry_at = Instant::now();
            let stream = self.id();
            match self.connect(&name, self.selection, stream) {
                Ok(connection) => {
                    self.active.connection = Some(connection);
                    self.active.observed_after = Instant::now();
                    self.active.stream = stream;
                    self.shared.stream.store(stream, Ordering::Release);
                    self.publish(None);
                }
                Err(error) => self.publish(Some(error)),
            }
        }
    }
}
impl Client {
    pub fn start(
        input: mpsc::SyncSender<Event>,
        overflow: Arc<AtomicBool>,
        catalog: device_catalog::Catalog,
        silent: bool,
    ) -> Result<Self, String> {
        let shared = Arc::new(Shared {
            stop: AtomicBool::new(false),
            alive: AtomicBool::new(true),
            selection: AtomicU64::new(0),
            installed: AtomicU64::new(0),
            connected: AtomicBool::new(false),
            stream: AtomicU64::new(0),
            serial: AtomicU64::new(1),
            status: Mutex::new(Status::default()),
        });
        let (tx, receiver) = mpsc::channel();
        let worker = shared.clone();
        std::thread::Builder::new()
            .name("neothesia-midi-input-owner".into())
            .spawn(move || {
                let _lifetime = OwnerLifetime(worker.clone());
                let mut owner = Owner {
                    shared: worker.clone(),
                    input,
                    overflow,
                    catalog,
                    active: Slot {
                        name: None,
                        stream: 0,
                        connection: None,
                        observed_after: Instant::now(),
                    },
                    selection: 0,
                    disconnects: 0,
                    staged: BTreeMap::new(),
                    silent,
                    retry_at: Instant::now(),
                };
                let mut last = Instant::now();
                while !worker.stop.load(Ordering::Acquire) {
                    match receiver.recv_timeout(Duration::from_millis(100)) {
                        Ok(request) => {
                            if !owner.request(request) {
                                break;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    if last.elapsed() >= Duration::from_millis(100) {
                        owner.hotplug();
                        last = Instant::now();
                    }
                }
            })
            .map_err(|error| format!("MIDI 输入线程无法启动：{error}"))?;
        Ok(Self {
            life: Arc::new(Lifetime { shared, tx }),
        })
    }
    pub fn begin_bootstrap(&self, name: Option<String>, automatic: bool) -> Result<Bootstrap, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.life
            .tx
            .send(Request::Boot {
                name,
                automatic,
                reply,
            })
            .map_err(|_| "键盘连接服务已停止，请重新启动练习室")?;
        Ok(Bootstrap(receiver))
    }

    pub fn prepare(&self, name: Option<String>, token: TaskToken) -> Result<Prepared, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.life
            .tx
            .send(Request::Prepare {
                name: name.clone(),
                token,
                reply,
            })
            .map_err(|_| "MIDI 输入线程已关闭")?;
        let (generation, reuse) = receiver.recv().map_err(|_| "键盘连接结果通道已关闭")??;
        Ok(Prepared {
            client: self.clone(),
            generation,
            name,
            reuse,
            done: false,
        })
    }
    pub fn status(&self) -> Option<Status> {
        let mut state = self.life.shared.status.try_lock().ok()?.clone();
        if !self.life.shared.alive.load(Ordering::Acquire) {
            state.connected = false;
            state.selection = self.life.shared.selection.load(Ordering::Acquire);
            state.disconnects = state.disconnects.wrapping_add(1);
            state.error = Some("MIDI 输入线程已停止，请重新启动应用恢复键盘".into());
        }
        Some(state)
    }
    pub fn accepts(&self, event: &Event, selection: u64) -> bool {
        self.connected(selection)
            && event.selection == selection
            && event.stream == self.life.shared.stream.load(Ordering::Acquire)
    }
    pub fn connected(&self, selection: u64) -> bool {
        self.life.shared.alive.load(Ordering::Acquire)
            && self.life.shared.selection.load(Ordering::Acquire) == selection
            && self.life.shared.installed.load(Ordering::Acquire) == selection
            && self.life.shared.connected.load(Ordering::Acquire)
    }
}
