//! Compact import receipts survive UI and engine restarts. Upload buffers remain ephemeral.
use crate::music_import::{ImportedSong, MusicPhase, MusicReceipt};
use panthesia_core::utils::atomic_file;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Deserialize, Serialize)]
struct Record {
    version: u8,
    request_hash: String,
    receipt: MusicReceipt,
}
fn path(data: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || id.len() > 256
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("导入回执编号无效".into());
    }
    Ok(data
        .join("music-import-results")
        .join(format!("{}.json", blake3::hash(id.as_bytes()).to_hex())))
}
pub(super) fn valid_song(song: &ImportedSong) -> bool {
    !song.content_id.is_empty()
        && song.content_id.len() <= 256
        && song.title.len() <= 16384
        && !song.source_path.is_empty()
        && song.source_path.len() <= 32768
        && song.import_warnings.len() <= 1000
        && song
            .import_warnings
            .iter()
            .all(|warning| warning.len() <= 65536)
}
pub(super) fn persist(
    data: &Path,
    request_hash: String,
    receipt: &MusicReceipt,
) -> Result<(), String> {
    let bytes = crate::json_stream::encode(
        &Record {
            version: 1,
            request_hash,
            receipt: receipt.clone(),
        },
        Vec::new(),
        262144,
        || Ok(()),
    )?;
    atomic_file::write(&path(data, &receipt.id)?, &bytes)
        .map_err(|error| format!("导入回执尚未保存：{error}"))
}
pub(super) fn read(data: &Path, id: &str) -> Result<Option<(String, MusicReceipt)>, String> {
    let bytes = match atomic_file::read_limited(&path(data, id)?, 262144) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("原导入回执无法读取：{error}")),
    };
    let mut record: Record = serde_json::from_slice(&bytes)
        .map_err(|_| "原导入回执无法解析，原文继续保留，请核对曲库")?;
    let receipt = &mut record.receipt;
    if record.version != 1
        || receipt.id != id
        || receipt.engine_id.is_empty()
        || receipt.engine_id.len() > 128
        || !receipt.id.starts_with(&format!("{}-", receipt.engine_id))
        || receipt.name.len() > 1024
        || receipt.size > 32_000_000
        || receipt.received > receipt.size
        || record.request_hash.len() != 64
        || !record
            .request_hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || (receipt.catalog_only
            && !matches!(
                receipt.kind,
                crate::music_import::MusicKind::Midi | crate::music_import::MusicKind::Score
            ))
        || receipt
            .song
            .as_ref()
            .is_some_and(|song| !valid_song(song) || song.catalog_only != receipt.catalog_only)
        || (receipt.phase == MusicPhase::Done && receipt.song.is_none())
    {
        return Err("原导入回执身份或内容不完整，请先核对曲库。原文继续保留。".into());
    }
    receipt.cancellable = false;
    match receipt.phase {
        MusicPhase::Uploading => {
            receipt.phase = MusicPhase::Cancelled;
            receipt.received = 0;
            receipt.error = Some("上次传输已结束，原文件保留。补选原文件后可以重新导入。".into());
        }
        MusicPhase::Queued | MusicPhase::Running | MusicPhase::Committing => {
            receipt.phase = MusicPhase::Unconfirmed;
            receipt.error = Some("上次准备已中断，请先核对曲库中的保存结果，再重新排队。".into());
        }
        _ => {}
    }
    Ok(Some((record.request_hash, record.receipt)))
}
