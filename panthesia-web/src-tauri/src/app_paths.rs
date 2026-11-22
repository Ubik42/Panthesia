//! Registers the running executable under the user's App Paths
//! (`HKCU\…\App Paths\Panthesia.exe`), the standard Windows place where other programs
//! look a program up. The Keel plugin finds `panthesia probe` there. The last launched
//! copy wins, as with any portable program.

#[cfg(windows)]
pub fn register() {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\App Paths\Panthesia.exe";
    let Ok(exe) = std::env::current_exe() else { return };
    let exe_text = exe.to_string_lossy().to_string();
    let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(KEY) else { return };
    if key.get_value::<String, _>("").ok().as_deref() == Some(exe_text.as_str()) {
        return;
    }
    let _ = key.set_value("", &exe_text);
    if let Some(dir) = exe.parent() {
        let _ = key.set_value("Path", &dir.to_string_lossy().to_string());
    }
}

#[cfg(not(windows))]
pub fn register() {}
