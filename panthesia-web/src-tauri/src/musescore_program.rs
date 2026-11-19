//! MuseScore discovery and selection belong to the desktop, outside playback and conversion workers.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const CONFIG: &str = "musescore-program.json";
const CONFIG_LIMIT: usize = 8192;

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProgramSource {
    Selected,
    Environment,
    Installed,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MuseScoreProgramStatus {
    pub available: bool,
    pub supported: bool,
    pub path: Option<PathBuf>,
    pub source: Option<ProgramSource>,
    pub message: String,
    pub cancelled: bool,
}
fn valid_program(candidate: &Path) -> Result<PathBuf, String> {
    if !candidate.is_absolute() || candidate.as_os_str().len() > 32768 {
        return Err("MuseScore 程序位置必须是有效的完整路径".into());
    }
    let path = candidate
        .canonicalize()
        .map_err(|error| format!("MuseScore 程序无法读取：{error}"))?;
    if !path.is_file()
        || !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("MuseScore4.exe"))
    {
        return Err("请选择 MuseScore Studio 的 MuseScore4.exe 程序文件".into());
    }
    Ok(path)
}
fn saved_program(data: &Path) -> Result<Option<PathBuf>, String> {
    let bytes =
        match panthesia_core::utils::atomic_file::read_limited(&data.join(CONFIG), CONFIG_LIMIT) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(format!(
                    "已保存的 MuseScore 位置无法读取，原设置保留：{error}"
                ));
            }
        };
    let path: PathBuf = serde_json::from_slice(&bytes).map_err(
        |_| "已保存的 MuseScore 位置无法完整读取，原设置保留。请重新选择程序或恢复自动查找。",
    )?;
    valid_program(&path)
        .map(Some)
        .map_err(|error| format!("已选择的 MuseScore 暂时不可用，原设置保留：{error}"))
}
pub fn discovered_program() -> Option<PathBuf> {
    let mut roots = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(key) {
            roots.push(PathBuf::from(root));
        }
    }
    if let Some(root) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(root).join("Programs"));
    }
    for root in roots {
        for name in ["MuseScore 4", "MuseScore Studio 4"] {
            let path = root.join(name).join("bin").join("MuseScore4.exe");
            if let Ok(path) = valid_program(&path) {
                return Some(path);
            }
        }
    }
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .find_map(|dir| valid_program(&dir.join("MuseScore4.exe")).ok())
    })
}
fn unavailable(source: Option<ProgramSource>, message: String) -> MuseScoreProgramStatus {
    MuseScoreProgramStatus {
        available: false,
        supported: cfg!(target_os = "windows"),
        path: None,
        source,
        message,
        cancelled: false,
    }
}
fn available(path: PathBuf, source: ProgramSource) -> MuseScoreProgramStatus {
    let message = match source {
        ProgramSource::Selected => "已选择 MuseScore Studio",
        ProgramSource::Environment => "已从环境设置找到 MuseScore Studio",
        ProgramSource::Installed => "已找到 MuseScore Studio",
    }
    .into();
    MuseScoreProgramStatus {
        available: true,
        supported: true,
        path: Some(path),
        source: Some(source),
        message,
        cancelled: false,
    }
}
fn status(data: &Path) -> MuseScoreProgramStatus {
    if !cfg!(target_os = "windows") {
        return unavailable(
            None,
            "当前平台可使用系统编辑器入口；自动转谱与 PDF 排版暂限 Windows。".into(),
        );
    }
    match saved_program(data) {
        Ok(Some(path)) => return available(path, ProgramSource::Selected),
        Err(error) => return unavailable(Some(ProgramSource::Selected), error),
        Ok(None) => {}
    }
    if let Some(path) = std::env::var_os("MUSESCORE_EXECUTABLE") {
        return match valid_program(Path::new(&path)) {
            Ok(path) => available(path, ProgramSource::Environment),
            Err(error) => unavailable(
                Some(ProgramSource::Environment),
                format!("MUSESCORE_EXECUTABLE 无法使用：{error}。可手动选择程序。"),
            ),
        };
    }
    match discovered_program() {
        Some(path) => available(path, ProgramSource::Installed),
        None => unavailable(
            None,
            "尚未找到 MuseScore Studio，可选择已安装或便携版的 MuseScore4.exe。".into(),
        ),
    }
}
fn save(data: &Path, path: &Path) -> Result<MuseScoreProgramStatus, String> {
    let path = valid_program(path)?;
    let bytes = serde_json::to_vec(&path).map_err(|error| error.to_string())?;
    if bytes.len() > CONFIG_LIMIT {
        return Err("MuseScore 程序路径过长，原设置保留".into());
    }
    panthesia_core::utils::atomic_file::write(&data.join(CONFIG), &bytes)
        .map_err(|error| format!("MuseScore 位置保存失败，原设置保留：{error}"))?;
    crate::remember_location(data, "musescore", &path, false);
    Ok(available(path, ProgramSource::Selected))
}
#[tauri::command]
pub async fn musescore_program_status(
    state: tauri::State<'_, crate::State>,
) -> Result<MuseScoreProgramStatus, String> {
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || status(&data))
        .await
        .map_err(|error| format!("MuseScore 位置读取中断：{error}"))
}
#[tauri::command]
pub async fn select_musescore_program(
    state: tauri::State<'_, crate::State>,
) -> Result<MuseScoreProgramStatus, String> {
    select(&state, None).await
}
#[tauri::command]
pub async fn reset_musescore_program(
    state: tauri::State<'_, crate::State>,
) -> Result<MuseScoreProgramStatus, String> {
    let lease = crate::score_edit::reserve(&state, "musescore-program-setting")?;
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        match std::fs::remove_file(data.join(CONFIG)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("MuseScore 位置无法清除，原设置保留：{error}")),
        }
        Ok(status(&data))
    })
    .await
    .map_err(|error| format!("MuseScore 位置重置中断：{error}"))?
}
async fn select(
    state: &crate::State,
    control: Option<&crate::score_jobs::Token>,
) -> Result<MuseScoreProgramStatus, String> {
    if let Some(control) = control {
        control.check()?;
    }
    let lease = crate::score_edit::reserve(state, "musescore-program-setting")?;
    let data = state.data.clone();
    let dialog_data = data.clone();
    let directory = tauri::async_runtime::spawn_blocking(move || {
        panthesia_engine::file_locations::initial(&dialog_data, "musescore")
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Some(control) = control {
        control.check()?;
    }
    let dialog = rfd::AsyncFileDialog::new()
        .set_title("选择 MuseScore Studio 程序")
        .add_filter("MuseScore 程序", &["exe"]);
    let dialog = if let Some(directory) = directory {
        dialog.set_directory(directory)
    } else {
        dialog
    };
    let selected = dialog
        .pick_file()
        .await
        .map(|file| file.path().to_path_buf());
    if let Some(control) = control {
        control.check()?;
    }
    let control = control.cloned();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        if let Some(control) = control {
            control.check()?;
        }
        if let Some(path) = selected {
            save(&data, &path)
        } else {
            let mut current = status(&data);
            current.cancelled = true;
            Ok(current)
        }
    })
    .await
    .map_err(|error| format!("MuseScore 位置保存中断：{error}"))?
}
pub async fn executable(
    state: &crate::State,
    control: Option<&crate::score_jobs::Token>,
) -> Result<PathBuf, String> {
    if let Some(control) = control {
        control.check()?;
    }
    if !cfg!(target_os = "windows") {
        return Ok(PathBuf::from(if cfg!(target_os = "macos") {
            "open"
        } else {
            "musescore"
        }));
    }
    let data = state.data.clone();
    let current = tauri::async_runtime::spawn_blocking(move || status(&data))
        .await
        .map_err(|error| format!("MuseScore 位置读取中断：{error}"))?;
    if let Some(control) = control {
        control.check()?;
    }
    if let Some(path) = current.path {
        return Ok(path);
    }
    if current.source.is_some() {
        return Err(current.message);
    }
    let chosen = select(state, control).await?;
    if chosen.cancelled {
        return Err("已取消选择 MuseScore 程序，当前曲目和原谱保留。".into());
    }
    chosen.path.ok_or(chosen.message)
}
