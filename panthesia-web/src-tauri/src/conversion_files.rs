//! A conversion owns an isolated source copy and removes only its own scratch directory.
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static SERIAL: AtomicU64 = AtomicU64::new(0);
pub struct Scratch {
    root: PathBuf,
    pub dir: PathBuf,
}
impl Scratch {
    pub fn create(data: &Path, kind: &str) -> Result<Self, String> {
        if !["midi", "pdf"].contains(&kind) {
            return Err("转换临时目录类别无效".into());
        }
        let root = data.join("conversion-temp");
        std::fs::create_dir_all(&root).map_err(|error| format!("转换临时目录无法创建：{error}"))?;
        let root = root
            .canonicalize()
            .map_err(|error| format!("转换临时目录无法读取：{error}"))?;
        for _ in 0..10 {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_nanos();
            let dir = root.join(format!(
                "run-{kind}-{}-{stamp}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            match std::fs::create_dir(&dir) {
                Ok(()) => return Ok(Self { root, dir }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("转换临时目录无法创建：{error}")),
            }
        }
        Err("转换临时目录名称冲突，请重试".into())
    }
    pub fn source(&self, original: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
        let extension = original
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !["mid", "midi", "xml", "musicxml", "mxl"].contains(&extension.as_str()) {
            return Err("转换输入格式无法识别".into());
        }
        // Keep the original title for tools that derive MusicXML headings from the input filename.
        let stem = original
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("乐谱")
            .chars()
            .take(80)
            .map(|character| {
                if character.is_control() || "<>:\"/\\|?*".contains(character) {
                    '_'
                } else {
                    character
                }
            })
            .collect::<String>();
        let stem = stem.trim_matches([' ', '.']);
        let stem = if stem.is_empty() { "乐谱" } else { stem };
        let path = self.dir.join(format!("{stem}.{extension}"));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| format!("转换输入副本无法创建：{error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("转换输入副本无法写入：{error}"))?;
        drop(file);
        Ok(path)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        // A replaced junction or symlink cannot redirect cleanup to another directory.
        if let Ok(actual) = self.dir.canonicalize() {
            if actual == self.dir && actual.parent() == Some(self.root.as_path()) {
                let _ = std::fs::remove_dir_all(actual);
            }
        }
    }
}
