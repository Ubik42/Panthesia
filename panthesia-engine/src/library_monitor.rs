//! Directory discovery and cache reconciliation run outside the musical clock.
use crate::{
    library::{self, SongRow},
    library_workspace::{Workspace, key, lock_for},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, mpsc,atomic::{AtomicBool,Ordering}},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub enabled: bool,
    pub phase: String,
    pub revision: u64,
    pub last_scan: u64,
    pub pending: usize,
    pub files: usize,
    pub updated: usize,
    pub errors: Vec<String>,
    pub current: String,
    pub paper_updates:usize,
    pub paper_unavailable:usize,
    pub score_updates:usize,
    pub score_unavailable:usize,
    pub metadata_files:usize,
    pub metadata_pending:usize,
}
#[derive(Deserialize, Serialize)]
struct Settings {
    enabled: bool,
}
#[derive(Clone)]
pub struct Monitor {
    _lifetime:Arc<Lifetime>,
    tx: mpsc::Sender<Request>,
    status: Arc<Mutex<Status>>,
    rows: Arc<Mutex<Vec<SongRow>>>,
}
struct Lifetime {stop:Arc<AtomicBool>}
impl Drop for Lifetime {fn drop(&mut self){self.stop.store(true,Ordering::Release);}}

enum Request {
    Refresh,
    PauseForClose(Arc<AtomicBool>, mpsc::SyncSender<Result<(), String>>),
    ResumeAfterClose,
    Enable(bool, mpsc::SyncSender<Result<(), String>>),
}
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Stamp {
    size: u64,
    modified: u64,
    annotations: u64,
    present: bool,
}
fn modified(path: &Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|s| s.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos().min(u64::MAX as u128) as u64)
}
fn stamp(path: &Path) -> Stamp {
    match std::fs::metadata(path) {
        Ok(s) => Stamp {
            size: s.len(),
            modified: modified(path),
            annotations: modified(&panthesia_core::library::metadata_sidecar_path(path)),
            present: s.is_file(),
        },
        Err(_) => Stamp::default(),
    }
}
fn clock() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    panthesia_core::utils::atomic_file::write(path, &bytes).map_err(|error| error.to_string())
}

struct Worker {
    stop:Arc<AtomicBool>,
    data: PathBuf,
    root: PathBuf,
    builtin: Vec<SongRow>,
    recordings:Vec<SongRow>,
    catalog: Vec<SongRow>,
    catalog_stamp: u64,
    local: Vec<SongRow>,
    observed: BTreeMap<String, Stamp>,
    pending: BTreeMap<String, PathBuf>,
    unstable: BTreeSet<String>,
    rows: Arc<Mutex<Vec<SongRow>>>,
    status: Status,
    workspace_revision: u64,
    folder_signature: BTreeMap<String, bool>,
    score_scanner: crate::score_sources::Scanner,
    paper_scanner:crate::score_attachments::source_monitor::Scanner,
    metadata_scanner:crate::metadata_discovery::Scanner,
}
impl Worker {
    fn new(data: PathBuf, root: PathBuf, rows: Arc<Mutex<Vec<SongRow>>>) -> Self {
        let initial = rows.lock().unwrap().clone();
        let enabled = std::fs::read(data.join("library-monitor-settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Settings>(&b).ok())
            .is_none_or(|s| s.enabled);
        let local = library::local_cache(&data,&root)
            .unwrap_or_else(|_| {
                initial
                    .iter()
                    .filter(|r| r.id.starts_with("folder/"))
                    .cloned()
                    .collect()
            });
        Self {
            stop:Arc::new(AtomicBool::new(false)),
            data,
            root: root.clone(),
            recordings:initial.iter().filter(|row|row.id.starts_with("recording/")).cloned().collect(),
            builtin: initial
                .iter()
                .filter(|r| r.id.starts_with("builtin/"))
                .cloned()
                .collect(),
            catalog: initial
                .iter()
                .filter(|r| !r.id.starts_with("builtin/") && !r.id.starts_with("folder/") && !r.id.starts_with("recording/"))
                .cloned()
                .collect(),
            catalog_stamp: modified(&root.join("catalog.csv")),
            local,
            observed: BTreeMap::new(),
            pending: BTreeMap::new(),
            unstable: BTreeSet::new(),
            rows,
            status: Status {
                enabled,
                phase: if enabled { "scanning" } else { "paused" }.into(),
                ..Default::default()
            },
            workspace_revision: 0,
            folder_signature: BTreeMap::new(),
            score_scanner:Default::default(),
            paper_scanner:Default::default(),
            metadata_scanner:Default::default(),
        }
    }
    fn discover(&mut self) -> Result<(), String> {
        self.check_running()?;
        self.status.phase = "scanning".into();
        self.status.errors.clear();
        match self.score_scanner.scan(&self.data) {
            Ok((updates,unavailable,changed))=>{self.status.score_updates=updates;self.status.score_unavailable=unavailable;if changed{self.status.revision+=1;}}
            Err(e)=>self.status.errors.push(format!("原谱检查：{e}")),
        }
        match self.paper_scanner.scan(&self.data) {
            Ok((updates,unavailable,changed))=>{self.status.paper_updates=updates;self.status.paper_unavailable=unavailable;if changed{self.status.revision+=1;}}
            Err(e)=>self.status.errors.push(format!("纸谱原件检查：{e}")),
        }
        let roots = library::folders_at(&self.data,&self.root)?;
        let folders = roots
            .iter()
            .map(|r| (key(r), r.is_dir()))
            .collect::<BTreeMap<_, _>>();
        if folders != self.folder_signature {
            self.status.revision += 1;
            self.folder_signature = folders;
        }
        let mut local = Vec::new();
        let mut metadata_paths = Vec::new();
        for root in &roots {
            let stop=self.stop.clone();
            match library::scan_folder_contents_until(root,||if stop.load(Ordering::Acquire){Err("曲库更新已停止".into())}else{Ok(())}) {
                Ok((found, sources)) => {local.extend(found);metadata_paths.extend(sources);},
                Err(e) => {
                    self.status.errors.push(format!("{}：{e}", root.display()));
                    local.extend(
                        self.local
                            .iter()
                            .filter(|r| r.path.starts_with(root))
                            .cloned(),
                    );
                }
            }
        }
        let stop=self.stop.clone();
        match self.metadata_scanner.scan(&self.data,metadata_paths,&self.root,self.status.errors.clone(),|| {
            if stop.load(Ordering::Acquire){Err("曲库更新已停止".into())}else{Ok(())}
        }) {
            Ok((files,pending,changed))=>{self.status.metadata_files=files;self.status.metadata_pending=pending;if changed{self.status.revision+=1;}},
            Err(error)=>self.status.errors.push(format!("资料来源检查：{error}")),
        }
        self.check_running()?;
        let mut seen = BTreeSet::new();
        local.retain(|r| seen.insert(key(&r.path)));
        let signature = |rows: &[SongRow]| {
            rows.iter()
                .map(|r| (key(&r.path), r.title.clone(), r.composer.clone()))
                .collect::<BTreeSet<_>>()
        };
        if signature(&local) != signature(&self.local) {
            atomic_json(&self.data.join("library-monitor-files.json"), &local)?;
            self.status.revision += 1;
        }
        let removed = self
            .local
            .iter()
            .filter(|r| !seen.contains(&key(&r.path)) && !r.path.is_file())
            .map(|r| (key(&r.path), r.path.clone()))
            .collect::<BTreeMap<_, _>>();
        self.local = local;
        let catalog_stamp = modified(&self.root.join("catalog.csv"));
        if catalog_stamp != self.catalog_stamp {
            match library::read(&self.root) {
                Ok(found) => {
                    self.catalog = found;
                    self.catalog_stamp = catalog_stamp;
                    self.status.revision += 1;
                }
                Err(e) => self.status.errors.push(e),
            }
        }
        match library::recording_rows(&self.data) {
            Ok(recordings)=> {if signature(&recordings)!=signature(&self.recordings){self.status.revision+=1;}self.recordings=recordings;}
            Err(error)=>self.status.errors.push(error),
        }
        let mut rows = self.builtin.clone();
        rows.extend(self.recordings.clone());
        rows.extend(self.catalog.clone());
        rows.extend(self.local.clone());
        let mut seen = BTreeSet::new();
        rows.retain(|r| seen.insert(key(&r.path)));
        *self.rows.lock().map_err(|_| "曲库列表不可用")? = rows;
        let lock = lock_for(&self.data)?;
        let workspace = {
            let _guard = lock.lock().map_err(|_| "曲库更新锁不可用")?;
            Workspace::load(&self.data)?
        };
        if self.workspace_revision != workspace.revision {
            self.status.revision += 1;
            self.workspace_revision = workspace.revision;
        }
        // Folder files are discovered automatically; existing standalone/imported indexes
        // are checked too. Public catalog files remain lazy until explicitly indexed.
        let mut paths = self
            .local
            .iter().chain(self.recordings.iter())
            .map(|r| (key(&r.path), r.path.clone()))
            .collect::<BTreeMap<_, _>>();
        paths.extend(removed);
        paths.extend(
            workspace
                .entries
                .iter()
                .map(|(k, e)| (k.clone(), e.path.clone())),
        );
        self.status.files = paths.len();
        let retained=crate::song_repository::SongRepository::open(&self.data)?.retained_ids()?;
        let mut stable = BTreeMap::new();
        self.unstable.clear();
        for (k, path) in paths {
            let st = stamp(&path);
            let previous = self.observed.get(&k).copied();
            stable.insert(k.clone(), st);
            let entry = workspace.entries.get(&k);
            if !st.present {
                if entry.is_none_or(|e| e.available) {
                    self.pending.insert(k, path);
                }
                continue;
            }
            let changed = entry.is_none_or(|e| {
                !e.available
                    || e.size != st.size
                    || e.modified != st.modified
                    || e.annotation_modified != st.annotations
                    || e.analysis_version != 2
                    || e.content_id.as_ref().is_some_and(|id|!retained.contains(id))
            });
            if changed {
                // Wait for two observations so a half-written MIDI is never treated as a replacement.
                if previous == Some(st) {
                    self.pending.insert(k, path);
                } else {
                    self.pending.remove(&k);
                    self.unstable.insert(k);
                }
            } else {
                self.pending.remove(&k);
            }
        }
        self.observed = stable;
        // Cache missing discoveries even if they disappeared before their first parsing pass.
        // Existing metadata is retained by Workspace::inspect when a path disappears.
        drop(workspace); // release the copied index before batch parsing
        self.status.last_scan = clock();
        self.status.pending = self.pending.len() + self.unstable.len();
        Ok(())
    }
    fn check_running(&self)->Result<(),String>{if self.stop.load(Ordering::Acquire){Err("曲库更新已停止".into())}else{Ok(())}}
    fn batch(&mut self) -> Result<(), String> {
        self.check_running()?;
        if self.pending.is_empty() {
            self.status.phase = if !self.unstable.is_empty() {
                "scanning"
            } else if self.status.enabled {
                "idle"
            } else {
                "paused"
            }
            .into();
            self.status.current.clear();
            return Ok(());
        }
        self.status.phase = "updating".into();
        let paths = self.pending.values().take(16).cloned().collect::<Vec<_>>();
        let lock = lock_for(&self.data)?;
        let _guard = lock.lock().map_err(|_| "曲库更新锁不可用")?;
        crate::storage_control::workspace_writable(&self.data)?;
        let mut w = Workspace::load(&self.data)?;
        let mut repository=crate::song_repository::SongRepository::open(&self.data)?;
        for path in paths {
            if self.stop.load(Ordering::Acquire){break;}
            let k = key(&path);
            self.status.current = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into();
            if self.observed.get(&k).is_some_and(|s| *s != stamp(&path)) {
                self.pending.remove(&k);
                continue;
            }
            let was = w.entries.get(&k).cloned();
            let mut entry = w.inspect(path.clone(), false)?;
            // Only recover annotations when the content really matches. Destination annotations win.
            if let Some(id) = entry.content_id.as_ref() {
                if was
                    .as_ref()
                    .is_none_or(|old| old.content_id.as_ref() != Some(id))
                {
                    let original = w
                        .entries
                        .values()
                        .find(|e| e.content_id.as_ref() == Some(id) && key(&e.path) != k)
                        .map(|e| e.path.clone());
                    if let Some(original) = original {
                        match library::recover_annotations(&original, &path, id) {
                            Ok(()) => entry = w.inspect(path.clone(), true)?,
                            Err(e) => self.status.errors.push(format!("{}：{e}", path.display())),
                        }
                    }
                }
            }
            if entry.available && entry.error.is_none() {
                if let Some(cid)=entry.content_id.as_deref() {
                    let title=entry.metadata.title.clone().unwrap_or_else(||path.file_stem().unwrap_or_default().to_string_lossy().into());
                    let composer=entry.metadata.composer.clone().unwrap_or_default();
                    let stop=self.stop.clone();
                    match repository.retain(&path,cid,&title,&composer,&||if stop.load(Ordering::Acquire){Err("曲库更新已停止".into())}else{Ok(())}) {
                        Ok(_) => {
                            let row=self.local.iter().chain(self.catalog.iter()).chain(self.recordings.iter()).find(|r|key(&r.path)==k).cloned().unwrap_or_else(||SongRow{arranger:None,id:format!("owned/{cid}"),title:title.clone(),composer:composer.clone(),source:"我的曲目".into(),category:String::new(),license:"本地文件".into(),source_url:String::new(),path:path.clone(),content_id:Some(cid.into()),tags:vec![],difficulty:None,rating:0});
                            repository.register_row(&row,cid)?;
                        },
                        Err(error)=>self.status.errors.push(format!("演奏副本保存失败：{error}")),
                    }
                }
            }
            if let Some(e) = entry.error.as_ref() {
                if self.status.errors.len() < 20 {
                    self.status.errors.push(format!("{}：{e}", path.display()));
                }
            }
            self.pending.remove(&k);
            self.status.updated += 1;
        }
        w.save(&self.data)?;
        self.workspace_revision = w.revision;
        self.status.revision += 1;
        self.status.pending = self.pending.len() + self.unstable.len();
        if self.pending.is_empty() {
            self.status.phase = if !self.unstable.is_empty() {
                "scanning"
            } else if self.status.enabled {
                "idle"
            } else {
                "paused"
            }
            .into();
            self.status.current.clear();
        }
        Ok(())
    }
}
impl Monitor {
    pub fn start(root: PathBuf, data: PathBuf, rows: Arc<Mutex<Vec<SongRow>>>) -> Self {
        Self::spawn(root,data,rows,false,None)
    }
    pub(crate) fn start_loading(root:PathBuf,data:PathBuf,rows:Arc<Mutex<Vec<SongRow>>>,lease:Arc<crate::data_root_lock::DataRootLock>) -> Self {
        Self::spawn(root,data,rows,true,Some(lease))
    }
    fn spawn(root:PathBuf,data:PathBuf,rows:Arc<Mutex<Vec<SongRow>>>,load_initial:bool,lease:Option<Arc<crate::data_root_lock::DataRootLock>>) -> Self {
        let (tx, rx) = mpsc::channel();
        let stop=Arc::new(AtomicBool::new(false));
        let lifetime=Arc::new(Lifetime {stop:stop.clone()});
        let shared = Arc::new(Mutex::new(Status::default()));
        let status = shared.clone();
        let worker_rows = rows.clone();
        std::thread::spawn(move || {
            let _lease=lease;
            let mut initial_error=None;
            if load_initial {
                if let Ok(mut state)=status.lock() { state.phase="loading".into();state.current="正在读取曲库".into(); }
                if let Ok(builtin)=library::builtin_rows(&data) {
                    if let Ok(mut rows)=worker_rows.lock(){*rows=builtin.clone();}
                    if let Ok(mut state)=status.lock(){state.revision=1;state.files=builtin.len();state.current="正在读取曲目目录".into();}
                }
                match library::initial_rows(&root,&data) {
                    Ok(initial)=> {if let Ok(mut rows)=worker_rows.lock(){*rows=initial;}},
                    Err(error)=> {initial_error=Some(error);},
                }
            }
            let mut w = Worker::new(data, root, worker_rows);
            w.stop=stop.clone();
            if load_initial&&initial_error.is_none() {w.status.revision=2;w.status.files=w.builtin.len()+w.catalog.len()+w.local.len()+w.recordings.len();*status.lock().unwrap()=w.status.clone();}
            let mut last = Instant::now() - Duration::from_secs(10);
            let mut manual = false;
            let mut paused_for_close = false;
            let mut next_batch = Instant::now();
            loop {
                if stop.load(Ordering::Acquire){break;}
                match rx.recv_timeout(Duration::from_millis(120)) {
                    Ok(Request::Refresh) => {
                        manual = true;
                        last = Instant::now() - Duration::from_secs(10);
                    }
                    Ok(Request::PauseForClose(cancelled, reply)) => {
                        let result = if cancelled.load(Ordering::Acquire) {
                            Err("已取消本次退出".into())
                        } else {
                            paused_for_close = true;
                            Ok(())
                        };
                        let _ = reply.send(result);
                    }
                    Ok(Request::ResumeAfterClose) => { paused_for_close = false; }
                    Ok(Request::Enable(enabled, reply)) => {
                        if paused_for_close {
                            let _ = reply.send(Err("软件正在退出，请返回后修改自动更新设置".into()));
                            continue;
                        }
                        let result = atomic_json(
                            &w.data.join("library-monitor-settings.json"),
                            &Settings { enabled },
                        );
                        if result.is_ok() {
                            w.status.enabled = enabled;
                            w.status.phase = if enabled { "scanning" } else { "paused" }.into();
                            if enabled {
                                last = Instant::now() - Duration::from_secs(10);
                            }
                        }
                        *status.lock().unwrap() = w.status.clone();
                        let _ = reply.send(result);
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(_) => {}
                }
                if paused_for_close { continue; }
                if let Some(error)=initial_error.clone() {
                    w.status.phase="failed".into();w.status.current="曲库尚未读取完成".into();w.status.errors=vec![error];
                    if manual||last.elapsed()>Duration::from_secs(5) {
                        match library::initial_rows(&w.root,&w.data) {
                            Ok(initial)=> {
                                let revision=w.status.revision.saturating_add(1).max(1);
                                if let Ok(mut rows)=w.rows.lock(){*rows=initial;}
                                w=Worker::new(w.data.clone(),w.root.clone(),w.rows.clone());
                                w.stop=stop.clone();
                                w.status.revision=revision;
                                initial_error=None;
                            }
                            Err(error)=>initial_error=Some(error),
                        }
                        last=Instant::now();
                    }
                    *status.lock().unwrap()=w.status.clone();
                    if initial_error.is_some(){continue;}
                }
                if (w.status.enabled || manual) && last.elapsed() >= Duration::from_secs(5) {
                    *status.lock().unwrap() = w.status.clone();
                    if let Err(e) = w.discover() {
                        w.status.errors = vec![e];
                        w.status.phase = "failed".into();
                        next_batch = Instant::now() + Duration::from_secs(5);
                    }
                    last = Instant::now();
                }
                if stop.load(Ordering::Acquire){break;}
                if (w.status.enabled || manual) && Instant::now() >= next_batch {
                    if let Err(e) = w.batch() {
                        w.status.phase = "failed".into();
                        w.status.errors = vec![e];
                        next_batch = Instant::now() + Duration::from_secs(5);
                    }
                    if w.pending.is_empty() && w.unstable.is_empty() {
                        manual = false;
                    }
                }
                *status.lock().unwrap() = w.status.clone();
            }
        });
        Self {
            _lifetime:lifetime,
            tx,
            status: shared,
            rows,
        }
    }
    /// Acknowledged by the scanning worker after its current file/cache write completes.
    /// This changes only runtime admission, preserving the user's automatic-update setting.
    pub fn pause_for_close(&self, cancelled: Arc<AtomicBool>) -> Result<(), String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx.send(Request::PauseForClose(cancelled.clone(), reply)).map_err(|_| "曲库更新服务已停止")?;
        let started = Instant::now();
        loop {
            if cancelled.load(Ordering::Acquire) { return Err("已取消本次退出".into()); }
            match receiver.recv_timeout(Duration::from_millis(50)) {
                Ok(result) => return result,
                Err(mpsc::RecvTimeoutError::Disconnected) => return Err("曲库更新服务已停止".into()),
                Err(_) if started.elapsed() < Duration::from_secs(15) => {},
                Err(_) => return Err("曲库仍在更新，请返回等待当前文件处理结束后再退出".into()),
            }
        }
    }
    pub fn resume_after_close(&self) {
        let _ = self.tx.send(Request::ResumeAfterClose);
    }
    pub fn status(&self) -> Result<Status, String> {
        Ok(self
            .status
            .lock()
            .map_err(|_| "自动更新状态不可用")?
            .clone())
    }
    pub fn refresh(&self) -> Result<(), String> {
        self.tx
            .send(Request::Refresh)
            .map_err(|_| "自动更新已停止".into())
    }
    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        let (tx, rx) = mpsc::sync_channel(1);
        self.tx
            .send(Request::Enable(enabled, tx))
            .map_err(|_| "自动更新已停止")?;
        rx.recv_timeout(Duration::from_secs(15))
            .map_err(|_| "更新服务响应超时")?
    }
    pub fn rows(&self) -> Result<Vec<SongRow>, String> {
        Ok(self.rows.lock().map_err(|_| "曲库列表不可用")?.clone())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discover_add_rename_replace_missing_restore_and_removed_folder_preserve_identity() {
        let data = std::env::temp_dir().join(format!(
            "neothesia-watch-{}-{}",
            std::process::id(),
            clock()
        ));
        let root = data.join("folder");
        std::fs::create_dir_all(&root).unwrap();
        let first = root.join("one.mid");
        std::fs::write(&first, include_bytes!("../assets/five-finger.mid")).unwrap();
        library::add_folder(&data, root.clone()).unwrap();
        let rows = Arc::new(Mutex::new(Vec::new()));
        let mut w = Worker::new(data.clone(), data.join("public"), rows.clone());
        w.discover().unwrap();
        assert!(w.pending.is_empty(), "pending={:?}", w.pending);
        w.discover().unwrap();
        w.batch().unwrap();
        let mut index = Workspace::load(&data).unwrap();
        let id = index.entries[&key(&first)].content_id.clone().unwrap();
        assert!(crate::song_repository::SongRepository::managed_path(&data,&id).unwrap().is_file());
        let group = index.group(None, "日课".into(), None).unwrap();
        index
            .assign(vec![first.clone()], Some(group.clone()), Some(4))
            .unwrap();
        index.save(&data).unwrap();
        let second = root.join("renamed.mid");
        std::fs::rename(&first, &second).unwrap();
        w.discover().unwrap();
        w.batch().unwrap();
        w.discover().unwrap();
        w.batch().unwrap();
        let index = Workspace::load(&data).unwrap();
        assert!(!index.entries[&key(&first)].available);
        assert_eq!(index.entries[&key(&second)].content_id.as_ref(), Some(&id));
        assert_eq!(index.entries[&key(&second)].groups, vec![group]);
        assert_eq!(index.entries[&key(&second)].rating, 4);
        std::fs::write(&second, include_bytes!("../assets/basic-chords.mid")).unwrap();
        w.discover().unwrap();
        assert!(w.pending.is_empty(), "pending={:?}", w.pending);
        w.discover().unwrap();
        w.batch().unwrap();
        let e = &Workspace::load(&data).unwrap().entries[&key(&second)];
        assert_ne!(e.content_id.as_ref(), Some(&id));
        assert_eq!(e.rating, 0);
        assert!(e.groups.is_empty());
        let disconnected = data.join("offline");
        std::fs::rename(&root, &disconnected).unwrap();
        w.discover().unwrap();
        w.batch().unwrap();
        assert!(!w.status.errors.is_empty());
        assert!(!Workspace::load(&data).unwrap().entries[&key(&second)].available);
        assert_eq!(rows.lock().unwrap().len(), 1);
        std::fs::rename(&disconnected, &root).unwrap();
        w.discover().unwrap();
        w.batch().unwrap();
        w.discover().unwrap();
        w.batch().unwrap();
        assert!(Workspace::load(&data).unwrap().entries[&key(&second)].available);
        library::remove_folder(&data, &root).unwrap();
        w.discover().unwrap();
        assert!(rows.lock().unwrap().is_empty());
        assert_eq!(Workspace::load(&data).unwrap().entries.len(), 2);
    }
}
