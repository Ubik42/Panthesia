use serde_json::{Value, json};

pub fn startup_label() -> String {
    let identity: Value = serde_json::from_str(env!("PANTHESIA_BUILD_INFO")).unwrap_or(Value::Null);
    let version = identity["version"]
        .as_str()
        .unwrap_or(env!("CARGO_PKG_VERSION"));
    let source = identity["revision"]
        .as_str()
        .map(|value| value.chars().take(10).collect::<String>())
        .unwrap_or_else(|| "来源未登记".into());
    let modified = if identity["dirty"].as_bool() == Some(true) {
        "（含本地修改）"
    } else {
        ""
    };
    format!(
        "Panthesia {version} · {source}{modified} · {}",
        std::env::consts::ARCH
    )
}

/// Startup diagnostics remain available before the engine or window can start.
pub fn startup_report(reason: &str) -> String {
    let executable = std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|error| format!("位置读取失败：{error}"));
    let identity = serde_json::from_str::<Value>(env!("PANTHESIA_BUILD_INFO"))
        .and_then(|value| serde_json::to_string_pretty(&value))
        .unwrap_or_else(|error| format!("构建记录读取失败：{error}"));
    format!(
        "{}\n启动失败：{reason}\n程序位置：{executable}\n构建记录：\n{identity}\n",
        startup_label()
    )
}

#[tauri::command]
pub fn desktop_build_info(state: tauri::State<'_, crate::State>) -> Result<Value, String> {
    let identity: Value = serde_json::from_str(env!("PANTHESIA_BUILD_INFO"))
        .map_err(|error| format!("程序构建来源无法读取：{error}"))?;
    let executable =
        std::env::current_exe().map_err(|error| format!("程序位置无法读取：{error}"))?;
    let selected = state
        .soundfont_status
        .lock()
        .map_err(|error| format!("钢琴音色记录暂未读齐：{error}"))?
        .path
        .clone();
    Ok(json!({
        "identity": identity,
        "architecture": std::env::consts::ARCH,
        "executable": executable.to_string_lossy(),
        "dataRoot": state.data.to_string_lossy(),
        "bundledFont": state.bundled_font.to_string_lossy(),
        "selectedFont": selected.unwrap_or_else(|| state.bundled_font.to_string_lossy().into_owned()),
    }))
}
