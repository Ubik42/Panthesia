//! Stage only our own temporary file; replace the selected destination after sync.
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub fn destination(data: &Path, path: &Path, extension: &str) -> Result<PathBuf, String> {
    if !path
        .extension()
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
    {
        return Err(format!("请使用 .{extension} 文件名"));
    }
    let parent = path
        .parent()
        .ok_or("保存位置无效")?
        .canonicalize()
        .map_err(|error| format!("保存位置无法读取：{error}"))?;
    let root = data
        .canonicalize()
        .map_err(|error| format!("软件资料位置无法读取：{error}"))?;
    if parent.starts_with(root) {
        return Err("请选择个人文件夹，导出副本不能存入软件内部资料目录".into());
    }
    Ok(parent.join(path.file_name().ok_or("文件名无效")?))
}
struct Temporary {
    path: PathBuf,
    file: Option<std::fs::File>,
}
impl Drop for Temporary {
    fn drop(&mut self) {
        self.file.take();
        let _ = std::fs::remove_file(&self.path);
    }
}
pub fn write(data: &Path, path: &Path, bytes: &[u8], extension: &str) -> Result<String, String> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let target = destination(data, path, extension)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let temporary = target.with_file_name(format!(
        ".neothesia-export-{}-{stamp}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let output = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("导出临时文件无法新建：{error}"))?;
    let mut temporary = Temporary {
        path: temporary,
        file: Some(output),
    };
    let output = temporary.file.as_mut().ok_or("导出临时文件未打开")?;
    output
        .write_all(bytes)
        .and_then(|_| output.sync_all())
        .map_err(|error| format!("导出副本尚未保存，原位置文件保留：{error}"))?;
    temporary.file.take();
    std::fs::rename(&temporary.path, &target)
        .map_err(|error| format!("导出副本尚未保存，原位置文件保留：{error}"))?;
    Ok(target.to_string_lossy().into_owned())
}
pub fn copy(
    data: &Path,
    source: &Path,
    path: &Path,
    extension: &str,
    size: u64,
    expected_hash: &str,
    check: &dyn Fn() -> Result<(), String>,
    progress: &dyn Fn(u64),
    commit: &dyn Fn() -> Result<(), String>,
) -> Result<String, String> {
    use std::io::Read;
    check()?;
    let target = destination(data, path, extension)?;
    let mut input =
        std::fs::File::open(source).map_err(|error| format!("导出成品无法读取：{error}"))?;
    if input.metadata().map_err(|error| error.to_string())?.len() != size {
        return Err("导出成品大小已改变，请重新制作".into());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let temporary = target.with_file_name(format!(
        ".neothesia-copy-{}-{stamp}.tmp",
        std::process::id()
    ));
    let file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("导出临时文件无法新建：{error}"))?;
    let mut temporary = Temporary {
        path: temporary,
        file: Some(file),
    };
    let mut hash = blake3::Hasher::new();
    let mut written = 0;
    let mut chunk = [0; 65_536];
    loop {
        check()?;
        let count = input
            .read(&mut chunk)
            .map_err(|error| format!("导出成品读取失败：{error}"))?;
        if count == 0 {
            break;
        }
        written += count as u64;
        if written > size {
            return Err("导出成品正在改变，请重新制作".into());
        }
        hash.update(&chunk[..count]);
        temporary
            .file
            .as_mut()
            .ok_or("导出临时文件已关闭")?
            .write_all(&chunk[..count])
            .map_err(|error| format!("导出尚未完成，原位置文件保留：{error}"))?;
        progress(written);
    }
    if written != size || hash.finalize().to_hex().as_str() != expected_hash {
        return Err("导出成品内容已改变，原位置文件保留，请重新制作".into());
    }
    commit()?;
    temporary
        .file
        .as_ref()
        .ok_or("导出临时文件已关闭")?
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary.file.take();
    std::fs::rename(&temporary.path, &target)
        .map_err(|error| format!("导出副本尚未保存，原位置文件保留：{error}"))?;
    Ok(target.to_string_lossy().into_owned())
}
