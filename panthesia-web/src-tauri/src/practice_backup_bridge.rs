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
    Backup,
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
    expected_hash: Option<String>,
    hash: blake3::Hasher,
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
    fn read(&mut self, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        if self.temp.is_some()
            || length == 0
            || length > CHUNK
            || offset != self.offset
            || length as u64 > self.size.saturating_sub(offset)
        {
            return Err("文件分块位置或大小无效".into());
        }
        let mut bytes = vec![0; length];
        self.file
            .as_mut()
            .ok_or("文件传输会话已结束")?
            .read_exact(&mut bytes)
            .map_err(|e| e.to_string())?;
        self.hash.update(&bytes);
        self.offset += length as u64;
        self.touched = Instant::now();
        Ok(bytes)
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
pub async fn begin_practice_backup_read(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    selection: panthesia_engine::practice_backup::Selection,
) -> Result<serde_json::Value, String> {
    {
        let mut all = sessions.0.lock().map_err(|e| e.to_string())?;
        all.retain(|_, transfer| transfer.touched.elapsed() < Duration::from_secs(300));
        if all.len() >= 2 {
            return Err("请等待正在传输的文件完成".into());
        }
    }
    let engine = state.engine.clone();
    let (file, size, expected_hash) =
        tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
            let result =
                engine.command(panthesia_engine::Command::ExportPracticeBackup { selection })?;
            let path = result["path"].as_str().ok_or("备份导出路径缺失")?;
            let file = File::open(path).map_err(|e| e.to_string())?;
            let size = file.metadata().map_err(|e| e.to_string())?.len();
            if size == 0 || size > MAX {
                return Err("练习备份大小无效，最大支持 256 MB".into());
            }
            let hash = std::path::Path::new(path)
                .file_stem()
                .and_then(|value| value.to_str())
                .filter(|value| {
                    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
                .ok_or("备份制作记录无效")?
                .to_owned();
            Ok((file, size, hash))
        })
        .await
        .map_err(|e| e.to_string())??;
    let session = insert(
        &sessions,
        Transfer {
            kind: TransferKind::Backup,
            touched: Instant::now(),
            file: Some(file),
            temp: None,
            size,
            offset: 0,
            expected_hash: Some(expected_hash),
            hash: blake3::Hasher::new(),
        },
    )?;
    Ok(serde_json::json!({"session":session,"size":size}))
}
#[tauri::command]
pub async fn read_practice_backup_chunk(
    sessions: tauri::State<'_, Sessions>,
    session: String,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, String> {
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut all = sessions.0.lock().map_err(|e| e.to_string())?;
        let transfer = all.get_mut(&session).ok_or("文件传输会话已结束")?;
        if transfer.kind != TransferKind::Backup {
            return Err("文件传输类型不匹配".into());
        }
        let result = transfer.read(offset, length);
        if result.is_err() {
            all.remove(&session);
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub fn begin_practice_backup_stage(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    size: u64,
) -> Result<String, String> {
    begin_stage_upload(&state.data, &sessions, size, TransferKind::Backup)
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
            expected_hash: None,
            hash: blake3::Hasher::new(),
        },
    )
}
#[tauri::command]
pub async fn write_practice_backup_chunk(
    sessions: tauri::State<'_, Sessions>,
    session: String,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        write_stage_chunk(&sessions, &session, offset, &bytes, TransferKind::Backup)
    })
    .await
    .map_err(|error| error.to_string())?
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
#[tauri::command]
pub async fn finish_practice_backup_stage(
    state: tauri::State<'_, crate::State>,
    sessions: tauri::State<'_, Sessions>,
    session: String,
) -> Result<serde_json::Value, String> {
    let mut transfer = take_upload(&sessions, &session, TransferKind::Backup)?;
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = transfer.staged_bytes()?;
        engine.stage_practice_backup(bytes)
    })
    .await
    .map_err(|e| e.to_string())?
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
#[tauri::command]
pub fn finish_practice_backup_read(
    sessions: tauri::State<'_, Sessions>,
    session: String,
) -> Result<(), String> {
    let mut all = sessions.0.lock().map_err(|error| error.to_string())?;
    let transfer = all.get(&session).ok_or("文件传输会话已结束")?;
    if transfer.kind != TransferKind::Backup || transfer.temp.is_some() {
        return Err("文件传输类型不匹配".into());
    }
    let transfer = all.remove(&session).ok_or("文件传输会话已结束")?;
    if transfer.temp.is_some() || transfer.offset != transfer.size {
        return Err("备份文件尚未读取完整".into());
    }
    if transfer
        .expected_hash
        .as_ref()
        .is_some_and(|expected| transfer.hash.finalize().to_hex().as_str() != expected)
    {
        return Err("练习备份读取期间内容已改变，请重新制作，原练习资料保留。".into());
    }
    Ok(())
}
#[tauri::command]
pub fn cancel_practice_backup_transfer(
    sessions: tauri::State<'_, Sessions>,
    session: String,
) -> Result<(), String> {
    let mut all = sessions.0.lock().map_err(|error| error.to_string())?;
    if all
        .get(&session)
        .is_some_and(|transfer| transfer.kind != TransferKind::Backup)
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
            kind: TransferKind::Backup,
            touched: Instant::now(),
            file: Some(file),
            temp: Some(path.clone()),
            size: 12,
            offset: 0,
            expected_hash: None,
            hash: blake3::Hasher::new(),
        };
        assert!(transfer.write(1, b"bad").is_err());
        assert!(transfer.write(0, &vec![0; CHUNK + 1]).is_err());
        transfer.write(0, b"NEOPRAC1").unwrap();
        assert!(transfer.staged_bytes().is_err());
        transfer.write(8, b"test").unwrap();
        assert_eq!(transfer.staged_bytes().unwrap(), b"NEOPRAC1test");
        assert!(transfer.write(12, b"extra").is_err());
        let mut read = Transfer {
            kind: TransferKind::Backup,
            touched: Instant::now(),
            file: Some(File::open(&path).unwrap()),
            temp: None,
            size: 12,
            offset: 0,
            expected_hash: None,
            hash: blake3::Hasher::new(),
        };
        assert!(read.read(1, 4).is_err());
        assert!(read.read(0, CHUNK + 1).is_err());
        assert_eq!(read.read(0, 8).unwrap(), b"NEOPRAC1");
        assert_eq!(read.read(8, 4).unwrap(), b"test");
        drop(read);
        assert!(path.exists(), "reading must preserve the source backup");
        drop(transfer);
        assert!(!path.exists());
        let sessions = Sessions::default();
        for _ in 0..2 {
            insert(
                &sessions,
                Transfer {
                    kind: TransferKind::Backup,
                    touched: Instant::now(),
                    file: None,
                    temp: None,
                    size: 1,
                    offset: 0,
                    expected_hash: None,
                    hash: blake3::Hasher::new(),
                },
            )
            .unwrap();
        }
        assert!(
            insert(
                &sessions,
                Transfer {
                    kind: TransferKind::Backup,
                    touched: Instant::now(),
                    file: None,
                    temp: None,
                    size: 1,
                    offset: 0,
                    expected_hash: None,
                    hash: blake3::Hasher::new(),
                }
            )
            .is_err()
        );
    }
}
