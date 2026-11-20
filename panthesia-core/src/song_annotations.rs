//! Content-addressed annotation documents. MIDI bytes and source paths stay separate.
use crate::library::{MetadataError, SongSidecar, normalize_song_sidecar};
use crate::utils::atomic_file;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const VERSION: u16 = 1;
const LIMIT: usize = 32_000_000;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    version: u16,
    content_id: String,
    annotations: SongSidecar,
}

/// This layout is the repository's owned-asset contract. External MIDI never matches
/// a bare filename: the complete library/assets/midi hierarchy is required.
pub fn document_path(midi: &Path) -> Option<PathBuf> {
    let stem = midi.file_stem()?.to_str()?;
    let id = match stem.split_once("-restored-") {
        Some((id, index))
            if !index.is_empty()
                && index.len() <= 3
                && index.bytes().all(|b| b.is_ascii_digit()) =>
        {
            id
        }
        Some(_) => return None,
        None => stem,
    };
    if midi.extension()? != "mid"
        || id.len() != 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return None;
    }
    let directory = midi.parent()?;
    if !["midi","exercises"].iter().any(|name|directory.file_name().is_some_and(|v|v==*name)) {
        return None;
    }
    let assets = directory.parent()?;
    if assets.file_name()? != "assets" {
        return None;
    }
    let library = assets.parent()?;
    if library.file_name()? != "library" {
        return None;
    }
    Some(library.join("annotations").join(format!("{id}.json")))
}

pub(crate) fn read(path: &Path, content_id: &str) -> Result<SongSidecar, MetadataError> {
    check_identity(path, content_id)?;
    let bytes = atomic_file::read_limited(path, LIMIT).map_err(MetadataError::Read)?;
    let document: Document = serde_json::from_slice(&bytes).map_err(MetadataError::Document)?;
    if document.version != VERSION {
        return Err(MetadataError::UnsupportedVersion(document.version));
    }
    if document.content_id != content_id {
        return Err(MetadataError::ContentMismatch {
            expected: content_id.into(),
            actual: document.content_id,
        });
    }
    normalize_song_sidecar(document.annotations)
}

pub(crate) fn write(
    path: &Path,
    content_id: &str,
    annotations: SongSidecar,
) -> Result<PathBuf, MetadataError> {
    check_identity(path, content_id)?;
    let document = Document {
        version: VERSION,
        content_id: content_id.into(),
        annotations: normalize_song_sidecar(annotations)?,
    };
    let bytes = serde_json::to_vec_pretty(&document).map_err(MetadataError::Document)?;
    if bytes.len() > LIMIT {
        return Err(MetadataError::Write(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "曲目标注超过容量限制",
        )));
    }
    atomic_file::write(path, &bytes).map_err(MetadataError::Write)?;
    Ok(path.into())
}

fn check_identity(path: &Path, content_id: &str) -> Result<(), MetadataError> {
    let expected = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or_default();
    if expected != content_id {
        return Err(MetadataError::ContentMismatch {
            expected: expected.into(),
            actual: content_id.into(),
        });
    }
    Ok(())
}
