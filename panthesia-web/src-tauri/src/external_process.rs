use std::{
    io::{Read, Seek, SeekFrom},
    path::Path,
    process::{Child, Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};
pub fn stop(child: &mut Child) {
    if child.try_wait().is_ok_and(|status| status.is_some()) {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(mut killer) = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                match killer.try_wait() {
                    Ok(Some(_)) | Err(_) => break,
                    Ok(None) if Instant::now() < deadline => {
                        std::thread::sleep(Duration::from_millis(25))
                    }
                    Ok(None) => {
                        let _ = killer.kill();
                        let _ = killer.wait();
                        break;
                    }
                }
            }
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}
pub fn wait_with_log(
    child: &mut Child,
    timeout: Duration,
    token: Option<&crate::score_jobs::Token>,
    name: &str,
    log: Option<&Path>,
) -> Result<ExitStatus, String> {
    struct Running<'a> {
        child: &'a mut Child,
        reaped: bool,
    }
    impl Drop for Running<'_> {
        fn drop(&mut self) {
            if !self.reaped {
                stop(self.child);
            }
        }
    }
    let mut running = Running {
        child,
        reaped: false,
    };
    let started = Instant::now();
    loop {
        if let Some(token) = token {
            token.check()?;
        }
        match running.child.try_wait() {
            Ok(Some(status)) => {
                running.reaped = true;
                return Ok(status);
            }
            Ok(None) => {}
            Err(error) => {
                return Err(format!("{name} 状态无法读取：{error}"));
            }
        }
        if let Some(log) = log {
            if std::fs::metadata(log).is_ok_and(|metadata| metadata.len() > 8_000_000) {
                return Err(format!("{name} 的诊断记录超过 8 MB，已停止本次处理"));
            }
        }
        if started.elapsed() > timeout {
            return Err(format!("{name} 运行超过规定时间，已停止本次处理"));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Read only the tail; diagnostics must stay bounded even when an external tool is noisy.
pub fn log_excerpt(path: &Path) -> String {
    let Ok(mut file) = std::fs::File::open(path) else {
        return String::new();
    };
    let Ok(size) = file.metadata().map(|metadata| metadata.len()) else {
        return String::new();
    };
    if file
        .seek(SeekFrom::Start(size.saturating_sub(4096)))
        .is_err()
    {
        return String::new();
    }
    let mut bytes = Vec::new();
    if file.take(4096).read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&bytes)
        .chars()
        .filter(|character| !character.is_control() || *character == '\n' || *character == '\t')
        .collect::<String>()
        .trim()
        .to_owned()
}
pub fn run(
    command: &mut Command,
    timeout: Duration,
    token: Option<&crate::score_jobs::Token>,
    name: &str,
    log_path: &Path,
) -> Result<(), String> {
    if let Some(token) = token {
        token.check()?;
    }
    let log = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(log_path)
        .map_err(|error| format!("{name} 诊断记录无法创建：{error}"))?;
    struct LogFile<'a>(&'a Path);
    impl Drop for LogFile<'_> {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.0);
        }
    }
    let _log_file = LogFile(log_path);
    let stderr = log.try_clone().map_err(|error| error.to_string())?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr));
    let mut child = command
        .spawn()
        .map_err(|error| format!("{name} 无法启动：{error}"))?;
    let result = wait_with_log(&mut child, timeout, token, name, Some(log_path));
    let detail = log_excerpt(log_path);
    let detail = if detail.is_empty() {
        String::new()
    } else {
        format!("\n程序诊断：{detail}")
    };
    match result {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!(
            "{name} 失败，退出码：{}{detail}",
            status.code().unwrap_or(-1)
        )),
        Err(error) => Err(format!("{error}{detail}")),
    }
}
