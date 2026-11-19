//! Device enumeration lanes never wait for another driver or for plug-in discovery.
use crate::preferences::Shared as SharedNames;
use serde::Serialize;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatus {
    pub available: bool,
    pub ready: bool,
    pub refreshing: bool,
    pub scanning: bool,
    pub started_at: Option<u64>,
    pub last_finished_at: Option<u64>,
    pub last_success_at: Option<u64>,
    pub error: Option<String>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scans {
    pub input: ScanStatus,
    pub output: ScanStatus,
    pub plugins: ScanStatus,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub catalog_id: String,
    pub inputs: SharedNames<Vec<String>>,
    pub outputs: SharedNames<Vec<String>>,
    pub vst3: SharedNames<Vec<String>>,
    pub revision: u64,
    pub ready: bool,
    pub refreshing: bool,
    pub input_error: Option<String>,
    pub output_error: Option<String>,
    pub scans: Scans,
    #[serde(skip)]
    input_observation: Option<InputObservation>,
}
#[derive(Clone)]
struct InputObservation {
    started: Instant,
    names: SharedNames<Vec<String>>,
    complete: bool,
}
#[derive(Clone, Copy)]
enum Kind {
    Input,
    Output,
    Plugins,
}
impl Kind {
    fn index(self) -> usize {
        match self {
            Self::Input => 0,
            Self::Output => 1,
            Self::Plugins => 2,
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Input => "MIDI 输入",
            Self::Output => "MIDI 输出",
            Self::Plugins => "VST3 插件",
        }
    }
    fn status(self, snapshot: &mut Snapshot) -> &mut ScanStatus {
        match self {
            Self::Input => &mut snapshot.scans.input,
            Self::Output => &mut snapshot.scans.output,
            Self::Plugins => &mut snapshot.scans.plugins,
        }
    }
    fn names(self, snapshot: &mut Snapshot) -> &mut SharedNames<Vec<String>> {
        match self {
            Self::Input => &mut snapshot.inputs,
            Self::Output => &mut snapshot.outputs,
            Self::Plugins => &mut snapshot.vst3,
        }
    }
}
struct Shared {
    snapshot: Mutex<Snapshot>,
    stopping: AtomicBool,
    requested: [AtomicU64; 3],
    alive: [AtomicBool; 3],
}
struct Lifetime {
    shared: Arc<Shared>,
    wakes: Vec<mpsc::SyncSender<()>>,
}
impl Drop for Lifetime {
    fn drop(&mut self) {
        self.shared.stopping.store(true, Ordering::Release);
        for wake in &self.wakes {
            let _ = wake.try_send(());
        }
    }
}
// A failed worker must leave a visible error instead of a permanent loading state.
struct WorkerLifetime {
    shared: Arc<Shared>,
    kind: Kind,
}
impl Drop for WorkerLifetime {
    fn drop(&mut self) {
        self.shared.alive[self.kind.index()].store(false, Ordering::Release);
        if !self.shared.stopping.load(Ordering::Acquire) {
            if let Ok(mut snapshot) = self.shared.snapshot.lock() {
                let status = self.kind.status(&mut snapshot);
                status.available = false;
                status.ready = true;
                status.refreshing = false;
                status.scanning = false;
                status.error = Some(format!(
                    "{}读取线程已停止，请重新启动应用后重试",
                    self.kind.label()
                ));
                finish_snapshot(&mut snapshot);
            }
        }
    }
}
#[derive(Clone)]
pub(crate) struct Catalog(Arc<Lifetime>);
impl Catalog {
    pub fn start() -> Result<Self, String> {
        static SERIAL: AtomicU64 = AtomicU64::new(0);
        let catalog_id = format!(
            "inventory-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        );
        let initial = ScanStatus {
            available: true,
            refreshing: true,
            ..Default::default()
        };
        let shared = Arc::new(Shared {
            snapshot: Mutex::new(Snapshot {
                catalog_id,
                refreshing: true,
                scans: Scans {
                    input: initial.clone(),
                    output: initial.clone(),
                    plugins: initial,
                },
                ..Default::default()
            }),
            stopping: AtomicBool::new(false),
            requested: std::array::from_fn(|_| AtomicU64::new(1)),
            alive: std::array::from_fn(|_| AtomicBool::new(true)),
        });
        let mut lifetime = Lifetime {
            shared: shared.clone(),
            wakes: Vec::new(),
        };
        for kind in [Kind::Input, Kind::Output, Kind::Plugins] {
            let (wake, receiver) = mpsc::sync_channel(1);
            let worker = shared.clone();
            std::thread::Builder::new()
                .name(format!("neothesia-inventory-{}", kind.index()))
                .spawn(move || enumerate_loop(worker, kind, receiver))
                .map_err(|error| format!("{}清单后台任务无法启动：{error}", kind.label()))?;
            lifetime.wakes.push(wake);
        }
        Ok(Self(Arc::new(lifetime)))
    }
    pub fn snapshot(&self, refresh: bool) -> Result<Snapshot, String> {
        self.read(refresh.then_some("all"))
    }
    pub fn refresh(&self, target: Option<&str>) -> Result<Snapshot, String> {
        self.read(Some(target.unwrap_or("all")))
    }
    fn read(&self, target: Option<&str>) -> Result<Snapshot, String> {
        let kinds: &[Kind] = match target {
            None => &[],
            Some("all") => &[Kind::Input, Kind::Output, Kind::Plugins],
            Some("input") => &[Kind::Input],
            Some("output") => &[Kind::Output],
            Some("plugins") => &[Kind::Plugins],
            Some(_) => return Err("设备读取范围需为 input、output、plugins 或 all".into()),
        };
        let mut snapshot = self
            .0
            .shared
            .snapshot
            .lock()
            .map_err(|_| "设备清单暂时无法读取")?;
        for &kind in kinds {
            let index = kind.index();
            if !self.0.shared.alive[index].load(Ordering::Acquire) {
                continue;
            }
            let status = kind.status(&mut snapshot);
            // Coalesce repeated clicks without queuing unbounded driver calls.
            if !status.refreshing {
                self.0.shared.requested[index].fetch_add(1, Ordering::AcqRel);
                status.refreshing = true;
                snapshot.revision = snapshot.revision.wrapping_add(1);
                let _ = self.0.wakes[index].try_send(());
            }
        }
        snapshot.refreshing = snapshot.scans.input.refreshing
            || snapshot.scans.output.refreshing
            || snapshot.scans.plugins.refreshing;
        Ok(snapshot.clone())
    }
    pub fn input_present(&self, name: &str) -> Option<bool> {
        self.input_presence(name, None)
    }
    pub fn input_present_since(&self, name: &str, connected_at: Instant) -> Option<bool> {
        self.input_presence(name, Some(connected_at))
    }
    fn input_presence(&self, name: &str, connected_at: Option<Instant>) -> Option<bool> {
        let snapshot = self.0.shared.snapshot.try_lock().ok()?;
        let observation = snapshot.input_observation.as_ref()?;
        if connected_at.is_some_and(|connected_at| observation.started < connected_at) {
            return None;
        }
        if observation.names.iter().any(|input| input == name) {
            Some(true)
        } else {
            observation.complete.then_some(false)
        }
    }
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}
fn finish_snapshot(snapshot: &mut Snapshot) {
    snapshot.ready = snapshot.scans.input.ready && snapshot.scans.output.ready;
    snapshot.refreshing = snapshot.scans.input.refreshing
        || snapshot.scans.output.refreshing
        || snapshot.scans.plugins.refreshing;
    snapshot.input_error.clone_from(&snapshot.scans.input.error);
    snapshot
        .output_error
        .clone_from(&snapshot.scans.output.error);
    snapshot.revision = snapshot.revision.wrapping_add(1);
}
fn enumerate_loop(shared: Arc<Shared>, kind: Kind, receiver: mpsc::Receiver<()>) {
    let _lifetime = WorkerLifetime {
        shared: shared.clone(),
        kind,
    };
    loop {
        if shared.stopping.load(Ordering::Acquire) {
            break;
        }
        let requested = shared.requested[kind.index()].load(Ordering::Acquire);
        let started = Instant::now();
        if let Ok(mut snapshot) = shared.snapshot.lock() {
            let status = kind.status(&mut snapshot);
            status.scanning = true;
            status.started_at = Some(now_ms());
            snapshot.revision = snapshot.revision.wrapping_add(1);
        }
        let (names, warning) = match kind {
            Kind::Input => inputs(),
            Kind::Output => outputs(),
            Kind::Plugins => {
                let report = panthesia_vst3::discover_standard_plugins_with_report();
                let names = report
                    .plugins
                    .into_iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect();
                let warning = (!report.warnings.is_empty()).then(|| report.warnings.join("；"));
                (Some(names), warning)
            }
        };
        if shared.stopping.load(Ordering::Acquire) {
            break;
        }
        let names = names.map(SharedNames::from);
        let observation = if matches!(kind, Kind::Input) {
            names.as_ref().map(|names| InputObservation {
                started,
                names: names.clone(),
                complete: warning.is_none(),
            })
        } else {
            None
        };
        // A partial plug-in scan keeps usable previous entries. Merging and releasing
        // large lists happen away from the publication lock shared with hotplug reads.
        let names = names.map(|names| {
            let previous = if warning.is_some() {
                shared
                    .snapshot
                    .lock()
                    .ok()
                    .map(|mut snapshot| kind.names(&mut snapshot).clone())
            } else {
                None
            };
            if let Some(previous) = previous {
                let mut seen = std::collections::HashSet::new();
                names
                    .iter()
                    .chain(previous.iter())
                    .filter(|name| seen.insert(name.as_str()))
                    .cloned()
                    .collect::<Vec<_>>()
                    .into()
            } else {
                names
            }
        });
        let mut retired = None;
        let mut retired_observation = None;
        if let Ok(mut snapshot) = shared.snapshot.lock() {
            let now = now_ms();
            if matches!(kind, Kind::Input) {
                retired_observation =
                    std::mem::replace(&mut snapshot.input_observation, observation);
            }
            if let Some(names) = names {
                retired = Some(std::mem::replace(kind.names(&mut snapshot), names));
            }
            let status = kind.status(&mut snapshot);
            status.ready = true;
            status.scanning = false;
            status.refreshing = shared.requested[kind.index()].load(Ordering::Acquire) != requested;
            status.last_finished_at = Some(now);
            if warning.is_none() {
                status.last_success_at = Some(now);
            }
            status.error = warning;
            finish_snapshot(&mut snapshot);
        }
        drop(retired);
        drop(retired_observation);
        if shared.stopping.load(Ordering::Acquire) {
            break;
        }
        if shared.requested[kind.index()].load(Ordering::Acquire) != requested {
            while receiver.try_recv().is_ok() {}
            continue;
        }
        let next = match kind {
            Kind::Plugins => receiver
                .recv()
                .map_err(|_| mpsc::RecvTimeoutError::Disconnected),
            _ => receiver.recv_timeout(Duration::from_secs(1)),
        };
        if matches!(next, Err(mpsc::RecvTimeoutError::Disconnected)) {
            break;
        }
    }
}
pub(crate) fn inputs() -> (Option<Vec<String>>, Option<String>) {
    let midi = match midir::MidiInput::new("Panthesia inventory") {
        Ok(midi) => midi,
        Err(error) => return (None, Some(format!("MIDI 输入枚举失败：{error}"))),
    };
    collect_ports(
        midi.ports().iter().map(|port| midi.port_name(port)),
        "MIDI 输入",
    )
}
fn outputs() -> (Option<Vec<String>>, Option<String>) {
    let midi = match midir::MidiOutput::new("Panthesia inventory") {
        Ok(midi) => midi,
        Err(error) => return (None, Some(format!("MIDI 输出枚举失败：{error}"))),
    };
    collect_ports(
        midi.ports().iter().map(|port| midi.port_name(port)),
        "MIDI 输出",
    )
}
fn collect_ports<T: std::fmt::Display>(
    ports: impl Iterator<Item = Result<String, T>>,
    label: &str,
) -> (Option<Vec<String>>, Option<String>) {
    let mut names = Vec::new();
    let mut errors = Vec::new();
    let mut failed = 0usize;
    for port in ports {
        match port {
            Ok(name) => names.push(name),
            Err(error) => {
                failed += 1;
                if errors.len() < 8 {
                    errors.push(error.to_string());
                }
            }
        }
    }
    let warning =
        (failed > 0).then(|| format!("{label}有 {failed} 个端口名称未读取：{}", errors.join("；")));
    (Some(names), warning)
}
