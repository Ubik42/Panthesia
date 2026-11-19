//! One configuration resolver for settings, diagnostics and generation.
use panthesia_core::utils::atomic_file;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
const CONFIG: &str = "duet-runtime.json";
static SAVING: Mutex<()> = Mutex::new(());
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub python: Option<PathBuf>,
    pub model: Option<PathBuf>,
    pub device: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Effective {
    pub python: PathBuf,
    pub model: PathBuf,
    pub device: String,
    pub python_source: String,
    pub model_source: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub settings: Settings,
    pub revision: String,
    pub effective: Effective,
    pub files_ready: bool,
    pub issues: Vec<String>,
}
fn raw(data: &Path) -> Result<Option<Vec<u8>>, String> {
    match atomic_file::read_limited(&data.join(CONFIG), 32768) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("DuET 配置无法读取：{e}")),
    }
}
fn revision(bytes: Option<&[u8]>) -> String {
    bytes.map_or_else(
        || "missing".into(),
        |b| blake3::hash(b).to_hex().to_string(),
    )
}
fn resolve(settings: &Settings) -> Effective {
    let tools = panthesia_core::product::env_os("PANTHESIA_MUSIC_TOOLS")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .parent()
                .unwrap()
                .parent()
                .unwrap()
                .to_owned()
        });
    let choose = |name: &str, selected: &Option<PathBuf>, fallback: PathBuf| {
        if let Some(path) = panthesia_core::product::env_os(name).map(PathBuf::from) {
            (path, "environment".into())
        } else if let Some(path) = selected {
            (path.clone(), "selected".into())
        } else {
            (fallback, "automatic".into())
        }
    };
    let (python, python_source) = choose(
        "PANTHESIA_DUET_PYTHON",
        &settings.python,
        tools.join("_reference/Transkun/.venv/Scripts/python.exe"),
    );
    let (model, model_source) = choose(
        "PANTHESIA_DUET_MODEL",
        &settings.model,
        PathBuf::from(r"D:\cs\_tools\_reference\_models\music-transcription\DuET"),
    );
    Effective {
        python,
        model,
        device: settings.device.clone().unwrap_or_else(|| "auto".into()),
        python_source,
        model_source,
    }
}
fn issues(runtime: &Effective) -> Vec<String> {
    let mut issues = vec![];
    if !runtime.python.is_file() {
        issues.push("Python 程序未找到，请选择已安装 DuET 的 Python。".into());
    }
    if !runtime.model.join("model.safetensors").is_file() {
        issues.push("模型目录缺少 model.safetensors。".into());
    }
    if !runtime.model.join("config.json").is_file() {
        issues.push("模型目录缺少 config.json。".into());
    }
    if !["auto", "cuda", "cpu"].contains(&runtime.device.as_str()) {
        issues.push("计算设备须为自动、CUDA 或 CPU。".into());
    }
    issues
}
fn view(data: &Path) -> Result<View, String> {
    let bytes = raw(data)?;
    let mut errors = vec![];
    let settings = match bytes
        .as_deref()
        .map(serde_json::from_slice::<Settings>)
        .transpose()
    {
        Ok(value) => value.unwrap_or_default(),
        Err(e) => {
            errors.push(format!("配置格式无法读取，保存新设置时会备份原文件：{e}"));
            Settings::default()
        }
    };
    let effective = resolve(&settings);
    errors.extend(issues(&effective));
    Ok(View {
        settings,
        revision: revision(bytes.as_deref()),
        effective,
        files_ready: errors.is_empty(),
        issues: errors,
    })
}
pub fn resolve_checked(data: &Path) -> Result<Effective, String> {
    let state = view(data)?;
    if !state.files_ready {
        return Err(format!(
            "DuET 尚未就绪：{} 请在设置的“DuET 制谱”页配置。",
            state.issues.join(" ")
        ));
    }
    Ok(state.effective)
}
fn save(data: &Path, settings: Settings, expected: &str) -> Result<View, String> {
    let _guard = SAVING.lock().map_err(|_| "DuET 设置正在处理")?;
    for path in [&settings.python, &settings.model].into_iter().flatten() {
        if !path.is_absolute() || path.as_os_str().len() > 32768 {
            return Err("请输入完整的程序或模型目录路径；留空使用自动查找。".into());
        }
    }
    if settings
        .device
        .as_deref()
        .is_some_and(|d| !["auto", "cuda", "cpu"].contains(&d))
    {
        return Err("请选择自动、CUDA 或 CPU。".into());
    }
    let previous = raw(data)?;
    if revision(previous.as_deref()) != expected {
        return Err("DuET 设置已改变，请重新读取后保存。当前输入仍在。".into());
    }
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    if bytes.len() > 32768 {
        return Err("DuET 设置超过长度限制".into());
    }
    if let Some(previous) = previous.filter(|previous| *previous != bytes) {
        let backups = data.join("settings-backups");
        std::fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
        let path = backups.join(format!(
            "duet-runtime-{}.json",
            blake3::hash(&previous).to_hex()
        ));
        if !path.exists() {
            atomic_file::write_new(&path, &previous).map_err(|e| format!("原配置备份失败：{e}"))?;
        }
    }
    atomic_file::write(&data.join(CONFIG), &bytes)
        .map_err(|e| format!("DuET 设置保存失败：{e}"))?;
    view(data)
}
const PROBE: &str = r#"import sys,json,importlib.metadata
from pathlib import Path
import torch
from duet import DuET
config=json.loads((Path(sys.argv[1])/'config.json').read_text(encoding='utf-8'))
cuda=torch.cuda.is_available()
requested=sys.argv[3]
device=('cuda' if cuda else 'cpu') if requested=='auto' else requested
available=device!='cuda' or cuda
report={'available':available,'pythonVersion':sys.version.split()[0],'duetVersion':importlib.metadata.version('duet-score'),'torchVersion':torch.__version__,'cudaAvailable':cuda,'cudaDevice':torch.cuda.get_device_name(0) if cuda else None,'effectiveDevice':device,'message':'运行环境可用；模型文件已找到。' if available else '已选择 CUDA，但当前 Python 无法使用 CUDA。请选择自动或 CPU，或修复本机 CUDA 环境。'}
Path(sys.argv[2]).write_text(json.dumps(report,ensure_ascii=False),encoding='utf-8')
"#;
fn probe(data: &Path, settings: &Settings) -> Result<serde_json::Value, String> {
    let runtime = resolve(settings);
    let issues = issues(&runtime);
    if !issues.is_empty() {
        return Err(issues.join(" "));
    }
    let scratch = crate::conversion_files::Scratch::create(data, "midi")?;
    let report = scratch.dir.join("probe.json");
    let mut command = std::process::Command::new(&runtime.python);
    command
        .arg("-c")
        .arg(PROBE)
        .arg(&runtime.model)
        .arg(&report)
        .arg(&runtime.device)
        .env("PYTHONUTF8", "1")
        .env("HF_HUB_OFFLINE", "1")
        .env("TRANSFORMERS_OFFLINE", "1")
        .env("OMP_NUM_THREADS", "2");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    crate::external_process::run(
        &mut command,
        std::time::Duration::from_secs(60),
        None,
        "DuET 运行环境检查",
        &scratch.dir.join("probe.log"),
    )?;
    serde_json::from_slice(&atomic_file::read_limited(&report, 32768).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn read_duet_runtime(state: tauri::State<'_, crate::State>) -> Result<View, String> {
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || view(&data))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_duet_runtime(
    state: tauri::State<'_, crate::State>,
    settings: Settings,
    expected_revision: String,
) -> Result<View, String> {
    let lease = crate::score_edit::reserve(&state, "duet-runtime-save")?;
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        save(&data, settings, &expected_revision)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn probe_duet_runtime(
    state: tauri::State<'_, crate::State>,
    settings: Settings,
) -> Result<serde_json::Value, String> {
    let lease = crate::score_edit::reserve(&state, "duet-runtime-probe")?;
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        probe(&data, &settings)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn browse_duet_runtime(
    state: tauri::State<'_, crate::State>,
    kind: String,
) -> Result<Option<String>, String> {
    let _lease = crate::score_edit::reserve(&state, "duet-runtime-browse")?;
    let dialog = rfd::AsyncFileDialog::new();
    let picked = match kind.as_str() {
        "python" => {
            dialog
                .set_title("选择已安装 DuET 的 Python")
                .add_filter("Python 程序", &["exe"])
                .pick_file()
                .await
        }
        "model" => dialog.set_title("选择 DuET 模型目录").pick_folder().await,
        _ => return Err("未知的 DuET 路径类型".into()),
    };
    Ok(picked.map(|file| file.path().to_string_lossy().into_owned()))
}
