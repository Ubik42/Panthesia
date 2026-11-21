//! Content-addressed annotation documents. MIDI bytes and source paths stay separate.
use crate::library::{MetadataError, SongSidecar, normalize_song_sidecar};
use crate::utils::atomic_file;
use panthesia_music::{NoteId, Performance};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

const VERSION: u16 = 2;
const PROTOCOL: &str = "smf-track-noteon-v1";
const LIMIT: usize = 32_000_000;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    version: u16,
    content_id: String,
    annotations: SongSidecar,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    note_identity: Option<Identity>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    unmapped: Vec<Unmapped>,
}
#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Identity {
    protocol: String,
    /// Only referenced notes are stored. Key = compatibility index; value = onset ordinal.
    tracks: BTreeMap<usize, BTreeMap<usize, usize>>,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Unmapped {
    kind: String,
    value: serde_json::Value,
    source_notes: Vec<Option<NoteId>>,
    reason: String,
}

/// Portable note references plus preserved, unapplied legacy records.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteArchive {
    identity: Identity,
    unmapped: Vec<Unmapped>,
}
fn bind_current(document: &mut Document, source: &Performance) -> Result<(), MetadataError> {
    let mut identity = Identity {
        protocol: PROTOCOL.into(),
        tracks: BTreeMap::new(),
    };
    let current = source
        .note_mapping
        .iter()
        .map(|m| ((m.id.track, m.compatibility_index), m.id))
        .collect::<BTreeMap<_, _>>();
    let resolve = |track: usize, index: usize| current.get(&(track, index)).copied();
    let mut map = |track: usize, index: usize| {
        let id = resolve(track, index)?;
        identity
            .tracks
            .entry(track)
            .or_default()
            .insert(index, id.onset);
        Some((track, index))
    };
    remap(
        &mut document.annotations,
        &mut document.unmapped,
        &mut map,
        &resolve,
    )?;
    document.version = VERSION;
    document.note_identity = Some(identity);
    Ok(())
}
pub fn archive(
    midi: &Path,
    cid: &str,
    annotations: SongSidecar,
    source: &Performance,
) -> Result<NoteArchive, MetadataError> {
    let unmapped = if let Some(path) = document_path(midi).filter(|p| atomic_file::is_file(p)) {
        let (mut doc, _) = decode(&path, cid)?;
        project(&mut doc, source)?;
        doc.unmapped
    } else {
        vec![]
    };
    let mut doc = Document {
        version: VERSION,
        content_id: cid.into(),
        annotations,
        note_identity: None,
        unmapped,
    };
    bind_current(&mut doc, source)?;
    Ok(NoteArchive {
        identity: doc.note_identity.unwrap(),
        unmapped: doc.unmapped,
    })
}
pub fn restore_archive(
    annotations: SongSidecar,
    archive: Option<&NoteArchive>,
    source: &Performance,
) -> Result<(SongSidecar, NoteArchive), MetadataError> {
    if archive.is_some_and(|a| a.identity.protocol != PROTOCOL) {
        return Err(MetadataError::InvalidNoteIdentity(
            "曲目包音符身份协议不受支持".into(),
        ));
    }
    let mut doc = Document {
        version: if archive.is_some() { VERSION } else { 1 },
        content_id: source.content_id.clone(),
        annotations,
        note_identity: archive.map(|a| a.identity.clone()),
        unmapped: archive.map(|a| a.unmapped.clone()).unwrap_or_default(),
    };
    project(&mut doc, source)?;
    Ok((
        normalize_song_sidecar(doc.annotations)?,
        NoteArchive {
            identity: doc.note_identity.unwrap(),
            unmapped: doc.unmapped,
        },
    ))
}
pub fn save_current(
    midi: &Path,
    cid: &str,
    annotations: SongSidecar,
    archive: Option<&NoteArchive>,
) -> Result<PathBuf, MetadataError> {
    let path = document_path(midi)
        .ok_or_else(|| MetadataError::InvalidNoteIdentity("曲目标注尚未进入资料库".into()))?;
    check_identity(&path, cid)?;
    let file = source(midi)?;
    let mut doc = if atomic_file::is_file(&path) {
        if decode(&path, cid)?.0.version == 1 {
            bind(midi, cid, &file.source)?;
        }
        let (mut d, _) = decode(&path, cid)?;
        project(&mut d, &file.source)?;
        d
    } else {
        Document {
            version: VERSION,
            content_id: cid.into(),
            annotations: SongSidecar::default(),
            note_identity: None,
            unmapped: vec![],
        }
    };
    doc.annotations = normalize_song_sidecar(annotations)?;
    if let Some(a) = archive {
        for row in &a.unmapped {
            if !doc.unmapped.contains(row) {
                doc.unmapped.push(row.clone());
            }
        }
    }
    bind_current(&mut doc, &file.source)?;
    encode(&path, &doc)
}

/// Annotations of a generated exercise: `exercises/<cid>.mid` keeps them in
/// `exercises/annotations/<cid>.json` (an exercise's content id comes from its parameters, not
/// its bytes, so it cannot use a manifest). Every other song uses its `.panthesia` manifest.
pub fn document_path(midi: &Path) -> Option<PathBuf> {
    let id = midi.file_stem()?.to_str()?;
    if midi.extension()? != "mid"
        || id.len() != 64
        || !id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return None;
    }
    let directory = midi.parent()?;
    directory
        .file_name()
        .is_some_and(|v| v == "exercises")
        .then(|| directory.join("annotations").join(format!("{id}.json")))
}

fn decode(path: &Path, content_id: &str) -> Result<(Document, Vec<u8>), MetadataError> {
    check_identity(path, content_id)?;
    let bytes = atomic_file::read_limited(path, LIMIT).map_err(MetadataError::Read)?;
    let document: Document = serde_json::from_slice(&bytes).map_err(MetadataError::Document)?;
    if !(1..=VERSION).contains(&document.version) {
        return Err(MetadataError::UnsupportedVersion(document.version));
    }
    if document.version == 1 && (document.note_identity.is_some() || !document.unmapped.is_empty())
    {
        return Err(MetadataError::InvalidNoteIdentity(
            "旧版文档包含未知的音符身份字段".into(),
        ));
    }
    if document.version == 2
        && document.note_identity.as_ref().map(|v| v.protocol.as_str()) != Some(PROTOCOL)
    {
        return Err(MetadataError::InvalidNoteIdentity(
            "音符身份协议缺失或不受支持".into(),
        ));
    }
    if document.content_id != content_id {
        return Err(MetadataError::ContentMismatch {
            expected: content_id.into(),
            actual: document.content_id,
        });
    }
    Ok((document, bytes))
}
fn has_notes(s: &SongSidecar) -> bool {
    !s.fingerings.is_empty()
        || !s.finger_actions.is_empty()
        || !s.hands.is_empty()
        || !s.note_playback.is_empty()
}
fn source(midi: &Path) -> Result<panthesia_music::MidiFile, MetadataError> {
    let bytes = atomic_file::read_dependency(midi, LIMIT).map_err(MetadataError::Read)?;
    let file = panthesia_music::MidiFile::from_path_bytes(midi, &bytes)
        .map_err(MetadataError::InvalidNoteIdentity)?;
    Ok(file)
}
/// A read-only projection also protects v1 documents before their background adoption.
pub(crate) fn read(
    path: &Path,
    content_id: &str,
    midi: &Path,
) -> Result<SongSidecar, MetadataError> {
    let (mut document, _) = decode(path, content_id)?;
    if has_notes(&document.annotations) {
        let file = source(midi)?;
        project(&mut document, &file.source)?;
    }
    normalize_song_sidecar(document.annotations)
}
/// External RON has the legacy index protocol; never let a formerly absent index
/// attach to a newly recovered dangling or cross-track note.
pub fn project_legacy(
    mut annotations: SongSidecar,
    source: &Performance,
) -> Result<SongSidecar, MetadataError> {
    let mut document = Document {
        version: 1,
        content_id: source.content_id.clone(),
        annotations: std::mem::take(&mut annotations),
        note_identity: None,
        unmapped: vec![],
    };
    project(&mut document, source)?;
    normalize_song_sidecar(document.annotations)
}
fn project(document: &mut Document, source: &Performance) -> Result<(), MetadataError> {
    let legacy = document.version == 1;
    let previous = document.note_identity.take();
    let mut next = Identity {
        protocol: PROTOCOL.into(),
        tracks: BTreeMap::new(),
    };
    let current = source
        .note_mapping
        .iter()
        .map(|m| (m.id, m.compatibility_index))
        .collect::<BTreeMap<_, _>>();
    let resolve = |track: usize, index: usize| -> Option<NoteId> {
        if legacy {
            source.legacy_note_id(track, index)
        } else {
            previous
                .as_ref()?
                .tracks
                .get(&track)?
                .get(&index)
                .map(|&onset| NoteId { track, onset })
        }
    };
    let mut map = |track: usize, index: usize| -> Option<(usize, usize)> {
        let id = resolve(track, index)?;
        let &index = current.get(&id)?;
        next.tracks
            .entry(id.track)
            .or_default()
            .insert(index, id.onset);
        Some((id.track, index))
    };
    remap(
        &mut document.annotations,
        &mut document.unmapped,
        &mut map,
        &resolve,
    )?;
    document.version = VERSION;
    document.note_identity = Some(next);
    Ok(())
}
fn remap(
    annotations: &mut SongSidecar,
    unmapped: &mut Vec<Unmapped>,
    map: &mut impl FnMut(usize, usize) -> Option<(usize, usize)>,
    resolve: &impl Fn(usize, usize) -> Option<NoteId>,
) -> Result<(), MetadataError> {
    macro_rules! single {
        ($field:ident) => {{
            let mut kept=vec![];
            for mut value in std::mem::take(&mut annotations.$field) {
                let (track,index)=(value.track_id,value.note_index);
                if let Some((track,index))=map(track,index){value.track_id=track;value.note_index=index;kept.push(value);}
                else {unmapped.push(Unmapped{kind:stringify!($field).into(),value:serde_json::to_value(&value).map_err(MetadataError::Document)?,source_notes:vec![resolve(track,index)],reason:"原索引或源音符无法准确对应，记录已保留且未应用".into()});}
            }
            annotations.$field=kept;
        }};
    }
    single!(fingerings);
    single!(hands);
    single!(note_playback);
    let mut kept = vec![];
    for mut value in std::mem::take(&mut annotations.finger_actions) {
        let a = (value.track_id, value.note_index);
        let b = (value.before_track, value.before_index);
        match (map(a.0, a.1), map(b.0, b.1)) {
            (Some(a), Some(b)) => {
                value.track_id = a.0;
                value.note_index = a.1;
                value.before_track = b.0;
                value.before_index = b.1;
                kept.push(value);
            }
            _ => unmapped.push(Unmapped {
                kind: "finger_actions".into(),
                value: serde_json::to_value(&value).map_err(MetadataError::Document)?,
                source_notes: vec![resolve(a.0, a.1), resolve(b.0, b.1)],
                reason: "换指动作的两个音符无法同时准确对应，记录已保留且未应用".into(),
            }),
        }
    }
    annotations.finger_actions = kept;
    Ok(())
}
fn encode(path: &Path, document: &Document) -> Result<PathBuf, MetadataError> {
    let bytes = serde_json::to_vec_pretty(document).map_err(MetadataError::Document)?;
    if bytes.len() > LIMIT {
        return Err(MetadataError::Write(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "曲目标注超过容量限制",
        )));
    }
    atomic_file::write(path, &bytes).map_err(MetadataError::Write)?;
    Ok(path.into())
}
/// Adopt an owned annotation document with exact source-onset identities. The
/// original document is archived before its first migration or later rebinding.
pub fn bind_legacy_bytes(
    midi: &Path,
    content_id: &str,
    bytes: &[u8],
    check: &impl Fn() -> Result<(), String>,
) -> Result<(), MetadataError> {
    let path = document_path(midi)
        .ok_or_else(|| MetadataError::InvalidNoteIdentity("曲目标注尚未进入资料库".into()))?;
    if decode(&path, content_id)?.0.version == VERSION {
        return Ok(());
    }
    let file = panthesia_music::MidiFile::from_path_bytes_checked(midi, bytes, check)
        .map_err(MetadataError::InvalidNoteIdentity)?;
    bind(midi, content_id, &file.source)
}
pub fn bind(midi: &Path, content_id: &str, source: &Performance) -> Result<(), MetadataError> {
    let path = document_path(midi)
        .ok_or_else(|| MetadataError::InvalidNoteIdentity("曲目标注尚未进入资料库".into()))?;
    let (mut document, before) = decode(&path, content_id)?;
    project(&mut document, source)?;
    let after = serde_json::to_vec_pretty(&document).map_err(MetadataError::Document)?;
    if before != after {
        let archive = path
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("legacy-inputs")
            .join(format!(
                "annotations-{}.json",
                blake3::hash(&before).to_hex()
            ));
        match atomic_file::read_limited(&archive, LIMIT) {
            Ok(existing) if existing == before => {}
            Ok(_) => {
                return Err(MetadataError::InvalidNoteIdentity(
                    "标注迁移快照内容冲突".into(),
                ));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                atomic_file::write(&archive, &before).map_err(MetadataError::Write)?
            }
            Err(e) => return Err(MetadataError::Read(e)),
        }
        encode(&path, &document)?;
    }
    Ok(())
}
pub(crate) fn write(
    path: &Path,
    content_id: &str,
    annotations: SongSidecar,
    midi: &Path,
) -> Result<PathBuf, MetadataError> {
    check_identity(path, content_id)?;
    let mut document = if atomic_file::is_file(path) {
        let mut existing = decode(path, content_id)?.0;
        if existing.version == 1 {
            let file = source(midi)?;
            bind(midi, content_id, &file.source)?;
            existing = decode(path, content_id)?.0;
        }
        existing
    } else {
        Document {
            version: 1,
            content_id: content_id.into(),
            annotations: SongSidecar::default(),
            note_identity: None,
            unmapped: vec![],
        }
    };
    document.annotations = normalize_song_sidecar(annotations)?;
    if document.version == VERSION {
        let mut identity = Identity {
            protocol: PROTOCOL.into(),
            tracks: BTreeMap::new(),
        };
        if has_notes(&document.annotations) {
            let file = source(midi)?;
            let current = file
                .source
                .note_mapping
                .iter()
                .map(|m| ((m.id.track, m.compatibility_index), m.id))
                .collect::<BTreeMap<_, _>>();
            let resolve = |track: usize, index: usize| current.get(&(track, index)).copied();
            let mut map = |track: usize, index: usize| {
                let id = resolve(track, index)?;
                identity
                    .tracks
                    .entry(track)
                    .or_default()
                    .insert(index, id.onset);
                Some((track, index))
            };
            remap(
                &mut document.annotations,
                &mut document.unmapped,
                &mut map,
                &resolve,
            )?;
        }
        document.note_identity = Some(identity);
    }
    encode(path, &document)
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

#[cfg(test)]
mod tests;
