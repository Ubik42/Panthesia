//! Product identity and compatibility with previously saved local profiles.
use std::{ffi::OsString, path::{Path, PathBuf}};

pub const NAME: &str = "Panthesia";
pub const APP_ID: &str = "com.ubik.panthesia";
pub const LEGACY_APP_ID: &str = "com.ubik.neothesia";

pub fn env_os(key: &str) -> Option<OsString> {
    std::env::var_os(key).or_else(|| key.strip_prefix("PANTHESIA_")
        .and_then(|suffix| std::env::var_os(format!("NEOTHESIA_{suffix}"))))
}
pub fn env(key: &str) -> Result<String, std::env::VarError> {
    match env_os(key) {
        Some(value) => value.into_string().map_err(std::env::VarError::NotUnicode),
        None => Err(std::env::VarError::NotPresent),
    }
}
/// New installations use the new identity; existing profiles stay in their locked original root.
/// This selects a path only. It never reads, copies, or rewrites profile contents.
pub fn profile_root(preferred: &Path) -> PathBuf {
    if preferred.read_dir().ok().is_some_and(|mut entries| entries.next().is_some()) { return preferred.into(); }
    let legacy = preferred.parent().map(|parent| parent.join(LEGACY_APP_ID));
    legacy.filter(|path| path.is_dir()).unwrap_or_else(|| preferred.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_profiles_and_existing_profiles_keep_distinct_identity_and_lock_roots() {
        let root = std::env::temp_dir().join(format!("panthesia-identity-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&root).unwrap();
        let current = root.join(APP_ID); let legacy = root.join(LEGACY_APP_ID);
        assert_eq!(profile_root(&current), current);
        std::fs::create_dir(&legacy).unwrap();
        assert_eq!(profile_root(&current), legacy);
        std::fs::create_dir(&current).unwrap();
        assert_eq!(profile_root(&current), legacy);
        std::fs::write(current.join("web-preferences.json"), b"{}").unwrap();
        assert_eq!(profile_root(&current), current);
    }
}
