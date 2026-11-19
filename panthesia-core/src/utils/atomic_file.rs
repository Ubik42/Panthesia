//! Complete-file replacement with unique, synced temporary files.
use std::{
    collections::HashMap,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};
static SERIAL: AtomicU64 = AtomicU64::new(0);
#[derive(Clone)]
pub struct PendingWrite {
    pub path: PathBuf,
    pub bytes: Arc<Vec<u8>>,
}
#[derive(Clone)]
pub struct DeferredWrite {
    pub path: PathBuf,
    render: Arc<dyn Fn() -> io::Result<Vec<u8>> + Send + Sync>,
    bytes: Arc<OnceLock<Result<Arc<Vec<u8>>, String>>>,
}
/// Destroy unpublished write roots away from the current thread; never publish them.
/// The callback runs after the capture releases its thread-local borrow.
pub type Retirement = Arc<dyn Fn(Vec<DeferredWrite>) + Send + Sync>;
impl DeferredWrite {
    pub fn materialize(&self) -> io::Result<PendingWrite> {
        let bytes = self
            .bytes
            .get_or_init(|| (self.render)().map(Arc::new).map_err(|e| e.to_string()));
        match bytes {
            Ok(bytes) => Ok(PendingWrite {
                path: self.path.clone(),
                bytes: bytes.clone(),
            }),
            Err(error) => Err(io::Error::other(error.clone())),
        }
    }
}
#[derive(Clone)]
pub struct Observation {
    pub path: PathBuf,
    pub before: Option<String>,
}
type Selector = Arc<dyn Fn(&Path) -> bool + Send + Sync>;
struct Observed {
    path: PathBuf,
    bytes: Option<Arc<Vec<u8>>>,
}
struct Capture {
    retirement: Option<Retirement>,
    retired: Vec<DeferredWrite>,
    targets: Arc<[PathBuf]>,
    selector: Option<Selector>,
    observed: Vec<Observed>,
    observed_index: HashMap<PathBuf, usize>,
    writes: Vec<DeferredWrite>,
    write_index: HashMap<PathBuf, usize>,
}
impl Capture {
    fn retire(&mut self, writes: impl IntoIterator<Item = DeferredWrite>) {
        if self.retirement.is_some() {
            self.retired.extend(writes);
        }
        // Detached captures keep their normal local release behavior.
    }
    fn release_retired(&mut self) {
        let retired = std::mem::take(&mut self.retired);
        if let Some(retirement) = &self.retirement {
            if !retired.is_empty() {
                retirement(retired);
            }
        }
    }
}
thread_local! { static CAPTURE: std::cell::RefCell<Option<Capture>> = const { std::cell::RefCell::new(None) }; }
/// Discard a failed item's staged files while preserving earlier successful items.
/// Outside a capture this retains the caller's ordinary persistence behavior.
pub fn with_savepoint<T, E>(work: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
    struct Savepoint(Option<(Vec<DeferredWrite>, usize)>);
    impl Drop for Savepoint {
        fn drop(&mut self) {
            let Some((writes, observed)) = self.0.take() else {
                return;
            };
            CAPTURE.with(|slot| {
                if let Some(capture) = slot.borrow_mut().as_mut() {
                    let replaced = std::mem::replace(&mut capture.writes, writes);
                    capture.retire(replaced);
                    capture.write_index = capture
                        .writes
                        .iter()
                        .enumerate()
                        .map(|(index, write)| (write.path.clone(), index))
                        .collect();
                    capture.observed.truncate(observed);
                    capture.observed_index = capture
                        .observed
                        .iter()
                        .enumerate()
                        .map(|(index, value)| (value.path.clone(), index))
                        .collect();
                }
            });
        }
    }
    let mut saved = Savepoint(CAPTURE.with(|slot| {
        slot.borrow()
            .as_ref()
            .map(|capture| (capture.writes.clone(), capture.observed.len()))
    }));
    let result = work();
    if result.is_ok() {
        saved.0 = None;
    }
    result
}
/// Stage only the caller's named files. All other atomic writes keep their normal behavior.
pub fn capture<T>(targets: Arc<[PathBuf]>, work: impl FnOnce() -> T) -> (T, Vec<DeferredWrite>) {
    let (result, writes, _) = capture_inner(targets, None, false, None, work);
    (result, writes)
}
/// Playback can release superseded immutable roots on its dedicated reclaimer.
pub fn capture_with_retirement<T>(
    targets: Arc<[PathBuf]>,
    retirement: Retirement,
    work: impl FnOnce() -> T,
) -> (T, Vec<DeferredWrite>) {
    let (result, writes, _) = capture_inner(targets, None, false, Some(retirement), work);
    (result, writes)
}
/// A detached edit sees its initial inputs and its own staged replacements until publication.
pub fn capture_matching<T>(
    selector: Arc<dyn Fn(&Path) -> bool + Send + Sync>,
    work: impl FnOnce() -> T,
) -> (T, Vec<DeferredWrite>, Vec<Observation>) {
    capture_inner(Arc::from([]), Some(selector), true, None, work)
}
/// Queries share the staged view without spending time hashing publication observations.
pub fn capture_readonly<T>(selector: Selector, work: impl FnOnce() -> T) -> T {
    capture_inner(Arc::from([]), Some(selector), false, None, work).0
}
fn capture_inner<T>(
    targets: Arc<[PathBuf]>,
    selector: Option<Selector>,
    fingerprint: bool,
    retirement: Option<Retirement>,
    work: impl FnOnce() -> T,
) -> (T, Vec<DeferredWrite>, Vec<Observation>) {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            let captured = CAPTURE.with(|slot| slot.borrow_mut().take());
            if let Some(mut captured) = captured {
                let writes = std::mem::take(&mut captured.writes);
                captured.retire(writes);
                captured.release_retired();
            }
        }
    }
    CAPTURE.with(|slot| {
        assert!(slot.borrow().is_none(), "nested persistence capture");
        *slot.borrow_mut() = Some(Capture {
            retirement,
            retired: Vec::new(),
            targets,
            selector,
            observed: Vec::new(),
            observed_index: HashMap::new(),
            writes: Vec::new(),
            write_index: HashMap::new(),
        });
    });
    let reset = Reset;
    let result = work();
    let mut captured = CAPTURE.with(|slot| slot.borrow_mut().take().unwrap());
    captured.release_retired();
    let observed = if fingerprint {
        captured
            .observed
            .into_iter()
            .map(|observed| Observation {
                path: observed.path,
                before: observed
                    .bytes
                    .map(|bytes| blake3::hash(&bytes).to_hex().to_string()),
            })
            .collect()
    } else {
        Vec::new()
    };
    drop(reset);
    (result, captured.writes, observed)
}
pub fn read(path: &Path) -> io::Result<Vec<u8>> {
    if let Some(write) = CAPTURE.with(|slot| {
        slot.borrow().as_ref().and_then(|capture| {
            capture
                .write_index
                .get(path)
                .and_then(|index| capture.writes.get(*index))
                .cloned()
        })
    }) {
        return write.materialize().map(|w| (*w.bytes).clone());
    }
    if let Some(bytes) = CAPTURE.with(|slot| {
        slot.borrow().as_ref().and_then(|capture| {
            capture
                .observed_index
                .get(path)
                .map(|index| capture.observed[*index].bytes.clone())
        })
    }) {
        return bytes
            .map(|bytes| (*bytes).clone())
            .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound));
    }
    let track = CAPTURE.with(|slot| {
        slot.borrow().as_ref().is_some_and(|capture| {
            capture
                .selector
                .as_ref()
                .is_some_and(|selector| selector(path))
        })
    });
    if !track {
        return fs::read(path);
    }
    let bytes = match fs::read(path) {
        Ok(bytes) => Some(Arc::new(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    CAPTURE.with(|slot| {
        if let Some(capture) = slot.borrow_mut().as_mut() {
            capture
                .observed_index
                .insert(path.into(), capture.observed.len());
            capture.observed.push(Observed {
                path: path.into(),
                bytes: bytes.clone(),
            });
        }
    });
    bytes
        .map(|bytes| (*bytes).clone())
        .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
}
/// Bounded reads use the same staged view; oversized files never enter an edit snapshot.
pub fn read_limited(path: &Path, limit: usize) -> io::Result<Vec<u8>> {
    read_bounded(path, limit, false)
}
/// Discovery indexes are hints, not commit dependencies. The caller must verify the selected asset.
/// An already staged or observed index still uses the detached edit's coherent view.
pub fn read_hint(path: &Path, limit: usize) -> io::Result<Vec<u8>> {
    let captured = CAPTURE.with(|slot| {
        slot.borrow().as_ref().is_some_and(|capture| {
            capture.write_index.contains_key(path) || capture.observed_index.contains_key(path)
        })
    });
    if captured {
        return read_limited(path, limit);
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit.saturating_add(1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::other("资料索引超过读取容量限制"));
    }
    Ok(bytes)
}
/// A read-only dependency participates in conflict checks without becoming a writable target.
pub fn read_dependency(path: &Path, limit: usize) -> io::Result<Vec<u8>> {
    read_bounded(path, limit, true)
}
fn read_bounded(path: &Path, limit: usize, dependency: bool) -> io::Result<Vec<u8>> {
    let virtual_bytes = CAPTURE.with(|slot| {
        slot.borrow().as_ref().is_some_and(|capture| {
            capture.write_index.contains_key(path) || capture.observed_index.contains_key(path)
        })
    });
    if virtual_bytes {
        let bytes = read(path)?;
        if bytes.len() > limit {
            return Err(io::Error::other("资料文件超过读取容量限制"));
        }
        return Ok(bytes);
    }
    let mut bytes = Vec::new();
    let result = match fs::File::open(path) {
        Ok(file) => file
            .take(limit.saturating_add(1) as u64)
            .read_to_end(&mut bytes)
            .map(|_| ()),
        Err(error) => Err(error),
    };
    if bytes.len() > limit {
        return Err(io::Error::other("资料文件超过读取容量限制"));
    }
    let tracked = (dependency || is_capturing(path))
        && CAPTURE.with(|slot| {
            slot.borrow()
                .as_ref()
                .is_some_and(|capture| capture.selector.is_some())
        });
    if tracked
        && (result.is_ok()
            || result
                .as_ref()
                .err()
                .is_some_and(|error| error.kind() == io::ErrorKind::NotFound))
    {
        let saved = if result.is_ok() {
            Some(Arc::new(bytes.clone()))
        } else {
            None
        };
        CAPTURE.with(|slot| {
            if let Some(capture) = slot.borrow_mut().as_mut() {
                capture
                    .observed_index
                    .insert(path.into(), capture.observed.len());
                capture.observed.push(Observed {
                    path: path.into(),
                    bytes: saved,
                });
            }
        });
    }
    result.map(|_| bytes)
}
/// Rollback of an unpublished asset discards the staged write rather than deleting a user file.
pub fn discard_or_remove(path: &Path) -> io::Result<()> {
    if is_capturing(path) {
        CAPTURE.with(|slot| {
            if let Some(capture) = slot.borrow_mut().as_mut() {
                if capture.retirement.is_none() {
                    capture.writes.retain(|write| write.path != path);
                } else {
                    let writes = std::mem::take(&mut capture.writes);
                    for write in writes {
                        if write.path == path {
                            capture.retire([write]);
                        } else {
                            capture.writes.push(write);
                        }
                    }
                }
                capture.write_index = capture
                    .writes
                    .iter()
                    .enumerate()
                    .map(|(index, write)| (write.path.clone(), index))
                    .collect();
            }
        });
        return Ok(());
    }
    fs::remove_file(path)
}
pub fn is_file(path: &Path) -> bool {
    let captured = CAPTURE.with(|slot| {
        slot.borrow().as_ref().and_then(|capture| {
            if capture.write_index.contains_key(path) {
                return Some(true);
            }
            capture
                .observed_index
                .get(path)
                .map(|index| capture.observed[*index].bytes.is_some())
        })
    });
    captured.unwrap_or_else(|| path.is_file())
}
pub fn read_to_string(path: &Path) -> io::Result<String> {
    String::from_utf8(read(path)?).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}
pub fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if is_capturing(path) {
        let payload = Arc::new(OnceLock::new());
        let _ = payload.set(Ok(Arc::new(bytes.to_vec())));
        return stage(DeferredWrite {
            path: path.into(),
            render: Arc::new(|| Ok(Vec::new())),
            bytes: payload,
        });
    }
    write_now(path, bytes)
}
pub fn is_capturing(path: &Path) -> bool {
    CAPTURE.with(|slot| {
        slot.borrow().as_ref().is_some_and(|capture| {
            capture.targets.iter().any(|target| target == path)
                || capture
                    .selector
                    .as_ref()
                    .is_some_and(|selector| selector(path))
        })
    })
}
fn stage(write: DeferredWrite) -> io::Result<()> {
    // Exact actor captures stay free of filesystem reads. Detached edits observe each original once.
    if CAPTURE.with(|slot| {
        slot.borrow().as_ref().is_some_and(|capture| {
            capture.selector.is_some() && !capture.observed_index.contains_key(&write.path)
        })
    }) {
        match read_limited(&write.path, 512_000_000) {
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    CAPTURE.with(|slot| {
        let mut slot = slot.borrow_mut();
        let capture = slot.as_mut().expect("staged write outside capture");
        if let Some(index) = capture.write_index.get(&write.path).copied() {
            let replaced = std::mem::replace(&mut capture.writes[index], write);
            capture.retire([replaced]);
        } else {
            capture
                .write_index
                .insert(write.path.clone(), capture.writes.len());
            capture.writes.push(write);
        }
    });
    Ok(())
}
pub fn write_generated(
    path: &Path,
    render: impl Fn() -> io::Result<Vec<u8>> + Send + Sync + 'static,
) -> io::Result<()> {
    if is_capturing(path) {
        stage(DeferredWrite {
            path: path.into(),
            render: Arc::new(render),
            bytes: Arc::new(OnceLock::new()),
        })
    } else {
        write_now(path, &render()?)
    }
}
/// Publish a complete new asset without replacing an existing destination.
/// Unlike staged metadata writes, creation is performed only by the owning storage worker.
pub fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if is_capturing(path) {
        return Err(io::Error::other("新增资产必须由存储线程直接发布"));
    }
    write_complete(path, bytes, false)
}
fn write_now(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_complete(path, bytes, true)
}
fn write_complete(path: &Path, bytes: &[u8], replace: bool) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::other("保存目标缺少文件名"))?
        .to_string_lossy();
    let temp = parent.join(format!(
        ".{name}.tmp-{}-{}",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    ));
    let mut created = false;
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        created = true;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if replace { replace_file(&temp, path) } else { create_file(&temp, path) }
    })();
    // A non-Windows create uses a link, so its source must also be released on success.
    if created {
        let _ = fs::remove_file(&temp);
    }
    result
}
#[cfg(not(target_os = "windows"))]
fn create_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::hard_link(source, destination)
}
#[cfg(target_os = "windows")]
fn create_file(source: &Path, destination: &Path) -> io::Result<()> {
    move_file_windows(source, destination, false)
}
#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    move_file_windows(source, destination, true)
}
#[cfg(target_os = "windows")]
fn move_file_windows(source: &Path, destination: &Path, replace: bool) -> io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let source: Vec<_> = source
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let destination: Vec<_> = destination
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let success = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_WRITE_THROUGH | if replace { MOVEFILE_REPLACE_EXISTING } else { 0 },
        )
    };
    if success == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!(
            "neothesia-atomic-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn parallel_replacements_keep_one_complete_file_and_no_temporary_files() {
        let p = root().join("settings.json");
        write(&p, b"old").unwrap();
        let jobs: Vec<_> = (0..8)
            .map(|i| {
                let p = p.clone();
                std::thread::spawn(move || write(&p, &vec![i; 10000]))
            })
            .collect();
        let results: Vec<_> = jobs.into_iter().map(|job| job.join().unwrap()).collect();
        assert!(results.iter().any(Result::is_ok));
        // Windows can deny competing replacements; reported failures still leave a complete destination.
        assert!(
            results
                .iter()
                .filter_map(|r| r.as_ref().err())
                .all(|e| matches!(
                    e.kind(),
                    io::ErrorKind::PermissionDenied | io::ErrorKind::AlreadyExists
                ))
        );
        let bytes = fs::read(&p).unwrap();
        assert_eq!(bytes.len(), 10000);
        assert!(bytes.iter().all(|b| *b == bytes[0]));
        assert_eq!(fs::read_dir(p.parent().unwrap()).unwrap().count(), 1);
    }
    #[test]
    fn replacement_failure_keeps_existing_directory_and_its_contents() {
        let p = root().join("existing");
        fs::create_dir(&p).unwrap();
        fs::write(p.join("retained.txt"), b"keep").unwrap();
        assert!(write(&p, b"new").is_err());
        assert_eq!(fs::read(p.join("retained.txt")).unwrap(), b"keep");
        assert_eq!(fs::read_dir(p.parent().unwrap()).unwrap().count(), 1);
    }
}
