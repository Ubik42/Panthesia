use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
pub struct Export {
    kind: Kind,
    _lease: Option<crate::score_edit::Lease>,
    path: PathBuf,
    temp: PathBuf,
    file: Option<File>,
    size: u64,
    written: u64,
    touched: Instant,
}
#[derive(Clone, Copy)]
enum Kind {
    Batch,
    Workspace,
    Pdf,
    Png,
}
impl Kind {
    fn paper(self) -> bool {
        matches!(self, Self::Pdf | Self::Png)
    }
    fn extension(self) -> &'static str {
        match self {
            Self::Batch => "neoscorebatch",
            Self::Workspace => "neoworkspace",
            Self::Pdf => "pdf",
            Self::Png => "png",
        }
    }
    fn location(self) -> &'static str {
        match self {
            Self::Batch => "scoreBatchExport",
            Self::Workspace => "workspaceExport",
            _ => "exportPaper",
        }
    }
    fn title(self) -> &'static str {
        match self {
            Self::Batch => "导出曲谱整理批次",
            Self::Workspace => "导出完整资料备份",
            Self::Pdf => "保存整本批注 PDF",
            Self::Png => "保存本页批注图片",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Batch => "曲谱整理批次",
            Self::Workspace => "Panthesia 资料备份",
            Self::Pdf => "PDF 文档",
            Self::Png => "PNG 图片",
        }
    }
    fn valid_size(self, size: u64) -> bool {
        match self {
            Self::Batch => valid_size(size, false),
            Self::Workspace => valid_size(size, true),
            Self::Pdf => (100..=64_000_000).contains(&size),
            Self::Png => (45..=48_000_000).contains(&size),
        }
    }
    fn size_error(self) -> &'static str {
        match self {
            Self::Batch => "批次大小无效",
            Self::Workspace => "资料备份大小无效，最大支持 1 GiB",
            Self::Pdf => "批注 PDF 大小无效，最大支持 64 MB",
            Self::Png => "批注图片大小无效，最大支持 48 MB",
        }
    }
}
pub fn valid_png_header(header: &[u8]) -> bool {
    if header.len() < 33
        || !header.starts_with(b"\x89PNG\r\n\x1a\n")
        || &header[8..16] != b"\0\0\0\rIHDR"
    {
        return false;
    }
    let width = u32::from_be_bytes(header[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(header[20..24].try_into().unwrap());
    width > 0
        && height > 0
        && height <= 16_000
        && u64::from(width) * u64::from(height) <= 32_000_000
}
impl Drop for Export {
    fn drop(&mut self) {
        self.file.take();
        let _ = std::fs::remove_file(&self.temp);
    }
}
impl Export {
    fn append(&mut self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        if bytes.is_empty()
            || bytes.len() > 1_048_576
            || offset != self.written
            || self.written + bytes.len() as u64 > self.size
        {
            return Err("批次写入位置或大小无效".into());
        }
        let result = self.file.as_mut().ok_or("导出已结束")?.write_all(bytes);
        if let Err(error) = result {
            self.file.take();
            let _ = std::fs::remove_file(&self.temp);
            return Err(format!(
                "导出写入失败，临时副本已停止，原位置文件保留：{error}"
            ));
        }
        self.written += bytes.len() as u64;
        self.touched = Instant::now();
        Ok(())
    }
    fn complete(mut self) -> Result<String, String> {
        if self.written != self.size {
            return Err("批次文件尚未写入完整".into());
        }
        if matches!(self.kind, Kind::Pdf) {
            let file = self.file.as_mut().ok_or("导出已结束")?;
            file.seek(SeekFrom::Start(0))
                .map_err(|error| error.to_string())?;
            let mut header = [0; 5];
            file.read_exact(&mut header)
                .map_err(|error| error.to_string())?;
            let length = self.size.min(1024) as usize;
            file.seek(SeekFrom::End(-(length as i64)))
                .map_err(|error| error.to_string())?;
            let mut tail = vec![0; length];
            file.read_exact(&mut tail)
                .map_err(|error| error.to_string())?;
            if &header != b"%PDF-" || !tail.windows(5).any(|part| part == b"%%EOF") {
                return Err("批注 PDF 内容不完整，原位置的文件已保留".into());
            }
        }
        if matches!(self.kind, Kind::Png) {
            let file = self.file.as_mut().ok_or("导出已结束")?;
            file.seek(SeekFrom::Start(0))
                .map_err(|error| error.to_string())?;
            let mut header = [0; 33];
            file.read_exact(&mut header)
                .map_err(|error| error.to_string())?;
            file.seek(SeekFrom::End(-12))
                .map_err(|error| error.to_string())?;
            let mut tail = [0; 12];
            file.read_exact(&mut tail)
                .map_err(|error| error.to_string())?;
            if !valid_png_header(&header) || &tail != b"\0\0\0\0IEND\xaeB`\x82" {
                return Err("批注图片内容或尺寸无效，原位置文件保留".into());
            }
        }
        self.file
            .take()
            .ok_or("导出已结束")?
            .sync_all()
            .map_err(|e| format!("批次写入失败：{e}"))?;
        std::fs::rename(&self.temp, &self.path).map_err(|e| format!("无法保存批次文件：{e}"))?;
        Ok(self.path.to_string_lossy().into())
    }
}
#[derive(Clone, Default)]
pub struct Sessions(pub Arc<Mutex<HashMap<String, Export>>>);
impl Sessions {
    fn reap(&self) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|error| error.to_string())?
            .retain(|_, export| {
                export.file.is_some() && export.touched.elapsed() < Duration::from_secs(300)
            });
        Ok(())
    }
    pub fn try_cancel_pending(&self) -> Result<bool, String> {
        let mut all = match self.0.try_lock() {
            Ok(all) => all,
            Err(std::sync::TryLockError::WouldBlock) => return Ok(false),
            Err(error) => return Err(error.to_string()),
        };
        let pending = std::mem::take(&mut *all);
        drop(all);
        drop(pending);
        Ok(true)
    }
}
#[tauri::command]
pub async fn begin_score_batch_export(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    name: String,
    size: u64,
) -> Result<Option<String>, String> {
    begin_export(state, sessions, name, size, Kind::Batch).await
}
#[tauri::command]
pub async fn begin_workspace_export(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    name: String,
    size: u64,
) -> Result<Option<String>, String> {
    begin_export(state, sessions, name, size, Kind::Workspace).await
}
#[tauri::command]
pub async fn begin_paper_pdf_export(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    name: String,
    size: u64,
) -> Result<Option<String>, String> {
    begin_export(state, sessions, name, size, Kind::Pdf).await
}
#[tauri::command]
pub async fn begin_paper_png_export(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    name: String,
    size: u64,
) -> Result<Option<String>, String> {
    begin_export(state, sessions, name, size, Kind::Png).await
}
fn valid_size(size: u64, workspace: bool) -> bool {
    (12..=if workspace {
        1_073_741_824
    } else {
        514_000_012
    })
        .contains(&size)
}
async fn begin_export(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    name: String,
    size: u64,
    kind: Kind,
) -> Result<Option<String>, String> {
    if !kind.valid_size(size) {
        return Err(kind.size_error().into());
    }
    let location = kind.location();
    let extension = kind.extension();
    let lease = Some(crate::score_edit::reserve(
        &state,
        &format!(
            "paper-export-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        ),
    )?);
    sessions.reap()?;
    if sessions.0.lock().map_err(|e| e.to_string())?.len() >= 2 {
        return Err("请等待正在导出的批次完成".into());
    }
    let name = name
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect::<String>();
    let Some(file) = crate::file_dialog(&state.data, location)
        .set_title(kind.title())
        .add_filter(kind.label(), &[extension])
        .set_file_name(name)
        .save_file()
        .await
    else {
        return Ok(None);
    };
    if state.closing.load(std::sync::atomic::Ordering::Acquire) {
        return Err("软件正在关闭，本次导出尚未写入目标文件".into());
    }
    let path = if kind.paper() {
        crate::export_files::destination(&state.data, file.path(), extension)?
    } else {
        file.path().to_path_buf()
    };
    crate::remember_location(&state.data, location, &path, false);
    let token = blake3::hash(
        format!(
            "{}:{:?}:{}",
            std::process::id(),
            std::time::SystemTime::now(),
            path.display()
        )
        .as_bytes(),
    )
    .to_hex()
    .to_string();
    let temp = path.with_file_name(format!(".neothesia-batch-{token}.tmp"));
    let writer = OpenOptions::new()
        .create_new(true)
        .read(kind.paper())
        .write(true)
        .open(&temp)
        .map_err(|e| format!("无法创建批次导出文件：{e}"))?;
    let export = Export {
        kind,
        _lease: lease,
        path,
        temp,
        file: Some(writer),
        size,
        written: 0,
        touched: Instant::now(),
    };
    let mut active = sessions.0.lock().map_err(|e| e.to_string())?;
    if active.len() >= 2 {
        return Err("请等待正在导出的批次完成".into());
    }
    active.insert(token.clone(), export);
    Ok(Some(token))
}
#[tauri::command]
pub async fn write_score_batch_export(
    sessions: tauri::State<'_, Sessions>,
    session: String,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let sessions = sessions.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut all = sessions.lock().map_err(|e| e.to_string())?;
        let s = all.get_mut(&session).ok_or("导出会话已结束")?;
        s.append(offset, &bytes)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn finish_score_batch_export(
    sessions: tauri::State<'_, Sessions>,
    session: String,
) -> Result<String, String> {
    let sessions = sessions.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let s = sessions
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&session)
            .ok_or("导出会话已结束")?;
        s.complete()
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn cancel_score_batch_export(
    sessions: tauri::State<'_, Sessions>,
    session: String,
) -> Result<(), String> {
    let sessions = sessions.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        sessions.lock().map_err(|e| e.to_string())?.remove(&session);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_limit_does_not_change_batch_limit() {
        assert!(!valid_size(11, true));
        assert!(valid_size(12, true));
        assert!(valid_size(1_073_741_824, true));
        assert!(!valid_size(1_073_741_825, true));
        assert!(valid_size(514_000_012, false));
        assert!(!valid_size(514_000_013, false));
    }
    #[test]
    fn chunk_order_finish_and_cancel_preserve_existing_file() {
        let root = std::env::temp_dir().join(format!(
            "neothesia-batch-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("batch.neoscorebatch");
        std::fs::write(&path, b"previous").unwrap();
        let temp = root.join("partial.tmp");
        let mut s = Export {
            kind: Kind::Batch,
            _lease: None,
            path: path.clone(),
            temp: temp.clone(),
            file: Some(
                OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temp)
                    .unwrap(),
            ),
            size: 12,
            written: 0,
            touched: Instant::now(),
        };
        assert!(s.append(1, b"bad").is_err());
        s.append(0, b"NEOBAT01").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"previous");
        assert!(s.append(8, b"too large").is_err());
        s.append(8, &[0, 0, 0, 0]).unwrap();
        assert!(s.append(12, b"extra").is_err());
        s.complete().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"NEOBAT01\0\0\0\0");
        assert!(!temp.exists());
        let s = Export {
            kind: Kind::Batch,
            _lease: None,
            path: path.clone(),
            temp: temp.clone(),
            file: Some(
                OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temp)
                    .unwrap(),
            ),
            size: 12,
            written: 0,
            touched: Instant::now(),
        };
        assert!(s.complete().is_err());
        assert!(!temp.exists());
        assert_eq!(std::fs::read(&path).unwrap(), b"NEOBAT01\0\0\0\0");
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
