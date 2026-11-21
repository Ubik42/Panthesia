//! Bounded chunked uploads from the web view: piece packages, score inputs and located paper.
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
const MAX: u64 = 256_000_000;
const CHUNK: usize = 1_048_576;
#[derive(Clone, Copy, PartialEq, Eq)]
enum TransferKind {
    Package,
    ScoreInput,
    LocatedPaper,
}

/// Owned, bounded upload. Dropping it closes and removes its temporary file.
pub struct ScoreInput(Transfer);
impl ScoreInput {
    pub fn into_bytes(mut self) -> Result<Vec<u8>, String> {
        self.0.staged_bytes()
    }
}
pub fn take_score_input(sessions: &Sessions, id: &str) -> Result<ScoreInput, String> {
    take_upload(sessions, id, TransferKind::ScoreInput).map(ScoreInput)
}

pub fn begin_located_input(
    data: &std::path::Path,
    sessions: &Sessions,
    size: u64,
) -> Result<String, String> {
    if !(8..=50_100_000).contains(&size) {
        return Err("可定位纸谱数据容量无效".into());
    }
    begin_stage_upload(data, sessions, size, TransferKind::LocatedPaper)
}
pub fn write_located_input(
    sessions: &Sessions,
    id: &str,
    offset: u64,
    bytes: &[u8],
) -> Result<(), String> {
    write_stage_chunk(sessions, id, offset, bytes, TransferKind::LocatedPaper)
}
pub fn take_located_input(sessions: &Sessions, id: &str) -> Result<ScoreInput, String> {
    take_upload(sessions, id, TransferKind::LocatedPaper).map(ScoreInput)
}
pub fn cancel_located_input(sessions: &Sessions, id: &str) -> Result<(), String> {
    let mut all = sessions.0.lock().map_err(|_| "纸谱传输状态不可用")?;
    if all
        .get(id)
        .is_some_and(|transfer| transfer.kind != TransferKind::LocatedPaper)
    {
        return Err("文件传输类型不匹配".into());
    }
    all.remove(id);
    Ok(())
}
#[tauri::command]
pub fn begin_score_input(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    size: u64,
) -> Result<String, String> {
    if !(100..=32_000_000).contains(&size) {
        return Err("识谱 PDF 大小无效，最大支持 32 MB".into());
    }
    begin_stage_upload(&state.data, &sessions, size, TransferKind::ScoreInput)
}
#[tauri::command]
pub async fn write_score_input_chunk(
    sessions: tauri::State<'_, Sessions>,
    session: String,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        write_stage_chunk(
            &sessions,
            &session,
            offset,
            &bytes,
            TransferKind::ScoreInput,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub fn cancel_score_input(
    sessions: tauri::State<'_, Sessions>,
    session: String,
) -> Result<(), String> {
    let mut all = sessions.0.lock().map_err(|error| error.to_string())?;
    if all
        .get(&session)
        .is_some_and(|transfer| transfer.kind != TransferKind::ScoreInput)
    {
        return Err("文件传输类型不匹配".into());
    }
    all.remove(&session);
    Ok(())
}
struct Transfer {
    kind: TransferKind,
    touched: Instant,
    file: Option<File>,
    temp: Option<PathBuf>,
    size: u64,
    offset: u64,
}
impl Drop for Transfer {
    fn drop(&mut self) {
        self.file.take();
        if let Some(path) = &self.temp {
            let _ = std::fs::remove_file(path);
        }
    }
}
impl Transfer {
    fn write(&mut self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        if self.temp.is_none()
            || bytes.is_empty()
            || bytes.len() > CHUNK
            || offset != self.offset
            || bytes.len() as u64 > self.size.saturating_sub(self.offset)
        {
            return Err("文件分块位置或大小无效".into());
        }
        self.file
            .as_mut()
            .ok_or("文件传输会话已结束")?
            .write_all(bytes)
            .map_err(|e| e.to_string())?;
        self.offset += bytes.len() as u64;
        self.touched = Instant::now();
        Ok(())
    }
    fn staged_bytes(&mut self) -> Result<Vec<u8>, String> {
        if self.temp.is_none() || self.offset != self.size {
            return Err("文件尚未写入完整".into());
        }
        let file = self.file.as_mut().ok_or("文件传输会话已结束")?;
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(self.size as usize)
            .map_err(|_| "本机可用内存不足，请关闭部分窗口后重新传输")?;
        file.take(self.size.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 != self.size {
            return Err("暂存文件大小发生变化".into());
        }
        Ok(bytes)
    }
}
#[derive(Clone, Default)]
pub struct Sessions(Arc<Mutex<HashMap<String, Transfer>>>);
fn token() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    blake3::hash(
        format!(
            "{}:{:?}:{}",
            std::process::id(),
            std::time::SystemTime::now(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )
        .as_bytes(),
    )
    .to_hex()
    .to_string()
}
fn insert(sessions: &Sessions, transfer: Transfer) -> Result<String, String> {
    let mut all = sessions.0.lock().map_err(|e| e.to_string())?;
    all.retain(|_, transfer| transfer.touched.elapsed() < Duration::from_secs(300));
    if all.len() >= 2 {
        return Err("请等待正在传输的文件完成".into());
    }
    let id = token();
    all.insert(id.clone(), transfer);
    Ok(id)
}
#[tauri::command]
pub fn begin_package_stage(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    size: u64,
) -> Result<String, String> {
    begin_stage_upload(&state.data, &sessions, size, TransferKind::Package)
}
fn begin_stage_upload(
    data: &std::path::Path,
    sessions: &Sessions,
    size: u64,
    kind: TransferKind,
) -> Result<String, String> {
    if size == 0 || size > MAX {
        return Err("文件大小无效，最大支持 256 MB".into());
    }
    let dir = data.join("practice-bridge");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.tmp", token()));
    let file = OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    insert(
        sessions,
        Transfer {
            kind,
            touched: Instant::now(),
            file: Some(file),
            temp: Some(path),
            size,
            offset: 0,
        },
    )
}
#[tauri::command]
pub async fn write_package_stage_chunk(
    sessions: tauri::State<'_, Sessions>,
    session: String,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        write_stage_chunk(&sessions, &session, offset, &bytes, TransferKind::Package)
    })
    .await
    .map_err(|error| error.to_string())?
}
fn write_stage_chunk(
    sessions: &Sessions,
    session: &str,
    offset: u64,
    bytes: &[u8],
    kind: TransferKind,
) -> Result<(), String> {
    let mut all = sessions.0.lock().map_err(|e| e.to_string())?;
    let transfer = all.get_mut(session).ok_or("文件传输会话已结束")?;
    if transfer.kind != kind {
        return Err("文件传输类型不匹配".into());
    }
    let result = transfer.write(offset, bytes);
    if result.is_err() {
        all.remove(session);
    }
    result
}
fn take_upload(sessions: &Sessions, id: &str, kind: TransferKind) -> Result<Transfer, String> {
    let mut all = sessions.0.lock().map_err(|error| error.to_string())?;
    let transfer = all.get(id).ok_or("文件传输会话已结束")?;
    if transfer.kind != kind || transfer.temp.is_none() {
        return Err("文件传输类型不匹配".into());
    }
    all.remove(id).ok_or("文件传输会话已结束".into())
}
#[tauri::command]
pub async fn finish_package_stage(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    session: String,
) -> Result<panthesia_engine::package_preview::PackagePreview, String> {
    let mut transfer = take_upload(&sessions, &session, TransferKind::Package)?;
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.stage_package(transfer.staged_bytes()?))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub fn cancel_package_stage(
    sessions: tauri::State<'_, Sessions>,
    session: String,
) -> Result<(), String> {
    let mut all = sessions.0.lock().map_err(|error| error.to_string())?;
    if all
        .get(&session)
        .is_some_and(|transfer| transfer.kind != TransferKind::Package)
    {
        return Err("文件传输类型不匹配".into());
    }
    all.remove(&session);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_ordered_transfer_and_cleanup() {
        let path = std::env::temp_dir().join(format!("neothesia-bridge-{}.tmp", token()));
        let file = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        let mut transfer = Transfer {
            kind: TransferKind::Package,
            touched: Instant::now(),
            file: Some(file),
            temp: Some(path.clone()),
            size: 12,
            offset: 0,
        };
        assert!(transfer.write(1, b"bad").is_err());
        assert!(transfer.write(0, &vec![0; CHUNK + 1]).is_err());
        transfer.write(0, b"NEOPRAC1").unwrap();
        assert!(transfer.staged_bytes().is_err());
        transfer.write(8, b"test").unwrap();
        assert_eq!(transfer.staged_bytes().unwrap(), b"NEOPRAC1test");
        assert!(transfer.write(12, b"extra").is_err());
        drop(transfer);
        assert!(!path.exists());
        let sessions = Sessions::default();
        for _ in 0..2 {
            insert(
                &sessions,
                Transfer {
                    kind: TransferKind::Package,
                    touched: Instant::now(),
                    file: None,
                    temp: None,
                    size: 1,
                    offset: 0,
                },
            )
            .unwrap();
        }
        assert!(
            insert(
                &sessions,
                Transfer {
                    kind: TransferKind::Package,
                    touched: Instant::now(),
                    file: None,
                    temp: None,
                    size: 1,
                    offset: 0,
                }
            )
            .is_err()
        );
    }
}
