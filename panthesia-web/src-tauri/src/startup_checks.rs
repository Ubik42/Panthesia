//! Isolated desktop checks. Normal application profiles are never test fixtures.
use std::path::{Path, PathBuf};

pub fn headless() -> bool {
    panthesia_core::product::env_os("PANTHESIA_HEADLESS_CHECK").is_some()
        || std::env::args().any(|a| a == "--headless-check")
}
pub fn enabled() -> bool {
    headless() || std::env::args().any(|a| a == "--window-check")
}
pub fn configure(
    mut context: tauri::Context<tauri::Wry>,
) -> Result<tauri::Context<tauri::Wry>, String> {
    if enabled() || panthesia_core::product::env_os("PANTHESIA_DATA_ROOT").is_some() {
        let root = panthesia_core::product::env_os("PANTHESIA_DATA_ROOT")
            .filter(|value| !value.is_empty())
            .ok_or("启动检查需要独立资料目录，请设置 PANTHESIA_DATA_ROOT")?;
        let root = PathBuf::from(root);
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        // This also isolates localStorage, browser cache and window preferences.
        context.config_mut().app.app_directories_override = Some(
            tauri::utils::config::AppDirectoriesOverride::Root(root.join("webview-profile")),
        );
        for window in &mut context.config_mut().app.windows {
            window.data_directory = None;
            #[cfg(debug_assertions)]
            if let Ok(port)=panthesia_core::product::env("PANTHESIA_DEVTOOLS_PORT") {
                let port=port.parse::<u16>().ok().filter(|port|*port>=1024).ok_or("开发调试端口需为 1024～65535")?;
                window.additional_browser_args=Some(format!("--remote-debugging-address=127.0.0.1 --remote-debugging-port={port}"));
            }
        }
    }
    Ok(context)
}
pub fn bundled_font(resource_dir: &Path) -> Result<PathBuf, String> {
    let font = resource_dir.join("default.sf2");
    if font.is_file() {
        return Ok(font);
    }
    #[cfg(debug_assertions)]
    {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../default.sf2");
        if development.is_file() {
            return Ok(development);
        }
    }
    Err(format!(
        "运行包缺少钢琴音色：{}。请保留完整程序目录。",
        font.display()
    ))
}

