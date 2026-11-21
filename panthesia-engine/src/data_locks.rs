//! Process-wide locks per data root and the path key used to compare file locations.
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, TryLockError};

/// Case-insensitive, `/`-separated key for comparing Windows paths.
pub fn key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}
/// One lock per data root, shared by every writer of files under it.
pub fn lock_for(data: &Path) -> Result<Arc<Mutex<()>>, String> {
    static LOCKS: OnceLock<Mutex<BTreeMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS.get_or_init(Default::default).lock().map_err(|_| "资料目录锁不可用")?;
    Ok(locks.entry(key(data)).or_default().clone())
}
/// Wait for `lock`, checking `check` (cancellation) while waiting.
pub(crate) fn wait_for<'a>(lock: &'a Mutex<()>, check: &impl Fn() -> Result<(), String>) -> Result<MutexGuard<'a, ()>, String> {
    check()?;
    loop {
        match lock.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::WouldBlock) => {
                check()?;
                std::thread::sleep(std::time::Duration::from_millis(12));
            }
            Err(TryLockError::Poisoned(_)) => return Err("资料目录锁不可用".into()),
        }
    }
}
