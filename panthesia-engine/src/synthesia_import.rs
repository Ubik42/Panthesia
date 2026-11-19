//! Exchange-format import runs on the existing recoverable library edit lane.
use crate::library_workspace::{Workspace, key};
use panthesia_core::{
    library::{self, FingerHint, NoteHandHint, SongMetadata, SongSidecar},
    synthesia_metadata::{self as format, Hand},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportOptions {
    pub overwrite: bool,
    pub fingers: bool,
    pub hands: bool,
    pub groups: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRow {
    pub path: PathBuf,
    pub content_id: String,
    pub title: String,
    pub matched: bool,
    pub fields: Vec<String>,
    pub fingers: usize,
    pub hands: usize,
    pub groups: Vec<Vec<String>>,
    pub warnings: Vec<String>,
    pub blocked: bool,
    pub source_updated: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub proof: String,
    pub source_songs: usize,
    pub matched: usize,
    pub rows: Vec<ImportRow>,
}
struct Candidate {
    path: PathBuf,
    cid: String,
    sidecar: SongSidecar,
    next: SongSidecar,
    annotations: format::Annotations,
    groups: Vec<Vec<String>>,
    rating: Option<u8>,
}
struct Prepared {
    preview: ImportPreview,
    candidates: Vec<Candidate>,
}
fn part(hand: Hand) -> panthesia_core::practice::PracticePart {
    match hand {
        Hand::Left => panthesia_core::practice::PracticePart::LeftHand,
        Hand::Right => panthesia_core::practice::PracticePart::RightHand,
        _ => panthesia_core::practice::PracticePart::Other,
    }
}
fn prepare(
    workspace: &mut Workspace,
    bytes: &[u8],
    paths: &[PathBuf],
    options: &ImportOptions,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Prepared, String> {
    if paths.is_empty() || paths.len() > 64 {
        return Err("请先选择 1～64 首曲目".into());
    }
    let document = format::parse(bytes)?;
    let songs: BTreeMap<_, _> = document
        .songs
        .iter()
        .map(|song| (song.unique_id.as_str(), song))
        .collect();
    let mut proof = blake3::Hasher::new();
    proof.update(bytes);
    proof.update(&serde_json::to_vec(options).map_err(|e| e.to_string())?);
    proof.update(&workspace.revision.to_le_bytes());
    let mut candidates = vec![];
    let mut rows = vec![];
    let mut visited = BTreeSet::new();
    let mut total_bytes = 0usize;
    for path in paths {
        check()?;
        if !visited.insert(key(path)) {
            return Err("选择中包含重复文件位置".into());
        }
        let midi_bytes = panthesia_core::utils::atomic_file::read_dependency(path, 32_000_000)
            .map_err(|e| format!("无法读取曲目 {}：{e}", path.display()))?;
        total_bytes += midi_bytes.len();
        if total_bytes > 128_000_000 {
            return Err("本批 MIDI 总大小超过 128 MB，请分批导入".into());
        }
        let file = midi_file::MidiFile::from_path_bytes(path, &midi_bytes)?;
        let cid = file.content_id.clone();
        let sidecar_path = library::metadata_sidecar_path(path);
        let raw =
            match panthesia_core::utils::atomic_file::read_dependency(&sidecar_path, 32_000_000) {
                Ok(bytes) => Some(bytes),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(e) => return Err(e.to_string()),
            };
        let sidecar = if raw.is_some() {
            library::load_song_sidecar(path, &cid)
                .map_err(|e| format!("原附加资料无法读取，导入已停止：{e}"))?
        } else {
            SongSidecar::default()
        };
        proof.update(
            &serde_json::to_vec(&(
                key(path),
                &cid,
                raw.as_ref()
                    .map(|bytes| blake3::hash(bytes).to_hex().to_string()),
            ))
            .map_err(|e| e.to_string())?,
        );
        let title = sidecar
            .metadata
            .title
            .clone()
            .unwrap_or_else(|| file.name.clone());
        let mut row = ImportRow {
            path: path.clone(),
            content_id: cid.clone(),
            title,
            matched: false,
            fields: vec![],
            fingers: 0,
            hands: 0,
            groups: vec![],
            warnings: vec![],
            blocked: false,
            source_updated: false,
        };
        let id = format::music_identity(&midi_bytes);
        if let Some(song) = songs.get(id.as_str()) {
            row.matched = true;
            let incoming = song.metadata()?;
            crate::library_metadata::validate(&incoming)?;
            let mut selected = (*song).clone();
            if !options.fingers {
                selected.attributes.remove("FingerHints");
            }
            if !options.hands {
                selected.attributes.remove("Parts");
            }
            let annotations = format::annotations(&selected, &midi_bytes, &file)?;
            let mut next = sidecar.clone();
            let replace_fields = if options.overwrite {
                crate::metadata_history::FIELDS.iter().filter(|field|
                    panthesia_core::metadata_layers::different(&incoming, &SongMetadata::default(), field))
                    .map(|field| (*field).to_owned()).collect::<Vec<_>>()
            } else { vec![] };
            let layers = panthesia_core::metadata_layers::MetadataLayers::import(
                &sidecar.metadata, sidecar.metadata_layers.as_ref(), incoming,
                blake3::hash(bytes).to_hex().to_string(), &replace_fields);
            next.metadata = layers.resolve(&sidecar.metadata);
            next.metadata_layers = Some(layers);
            row.source_updated = next.metadata_layers != sidecar.metadata_layers;
            row.fields = crate::metadata_history::changed(&sidecar.metadata, &next.metadata);
            if options.fingers {
                for hint in &annotations.fingers {
                    let existing = next
                        .fingerings
                        .iter()
                        .position(|f| f.track_id == hint.track && f.note_index == hint.index);
                    if existing.is_none() || options.overwrite {
                        if let Some(index) = existing {
                            next.fingerings.remove(index);
                        }
                        next.fingerings.push(FingerHint {
                            track_id: hint.track,
                            note_index: hint.index,
                            finger: hint.steps[0].finger,
                        });
                        row.fingers += 1;
                        // A finger hint also carries hand identity, independent of Parts.
                        if !next
                            .hands
                            .iter()
                            .any(|h| h.track_id == hint.track && h.note_index == hint.index)
                            && (options.overwrite || !sidecar.track_parts.contains_key(&hint.track))
                        {
                            next.hands.push(NoteHandHint {
                                track_id: hint.track,
                                note_index: hint.index,
                                part: part(hint.steps[0].hand),
                            });
                        }
                    }
                }
            }
            let substitutions = annotations
                .fingers
                .iter()
                .filter(|hint| hint.steps.len() > 1)
                .count();
            if substitutions > 0 {
                row.warnings.push(format!("{substitutions} 处同音换指链完整保存在来源中；先应用起始指法，换指时刻需在指法编辑器指定"));
            }
            if options.hands {
                for hint in &annotations.parts {
                    let protected_hand = sidecar.hands.iter().any(|h|
                        h.track_id == hint.track && h.note_index == hint.index)
                        || sidecar.track_parts.contains_key(&hint.track);
                    let protected_mode = sidecar.note_playback.iter().any(|h|
                        h.track_id == hint.track && h.note_index == hint.index);
                    if !(protected_mode || protected_hand) || options.overwrite {
                        next.note_playback.retain(|h| h.track_id != hint.track || h.note_index != hint.index);
                        next.note_playback.push(panthesia_core::song_config::NotePlaybackRule {
                            track_id: hint.track, note_index: hint.index,
                            mode: match hint.hand {
                                Hand::Background => panthesia_core::song_config::PlayerConfig::Auto,
                                Hand::Discard => panthesia_core::song_config::PlayerConfig::Mute,
                                _ => panthesia_core::song_config::PlayerConfig::Human,
                            },
                        });
                        row.hands += 1;
                    }
                    if matches!(hint.hand, Hand::Left | Hand::Right) && (!protected_hand || options.overwrite) {
                        next.hands.retain(|h| h.track_id != hint.track || h.note_index != hint.index);
                        next.hands.push(NoteHandHint {
                            track_id: hint.track, note_index: hint.index, part: part(hint.hand),
                        });
                    }
                }
            }
            if song.attributes.contains_key("HandParts") {
                row.warnings.push("旧 HandParts 的私有 ConfigHash 未转换；原值保存在来源中，公开 Parts 如有提供则单独应用".into());
            }
            let known = [
                "UniqueId",
                "Version",
                "Title",
                "Subtitle",
                "Composer",
                "Arranger",
                "MadeFamousBy",
                "Copyright",
                "License",
                "Difficulty",
                "Rating",
                "Tags",
                "FingerHints",
                "Parts",
                "HandParts",
                "Bookmarks",
                "BackgroundImage",
            ];
            let unknown = song
                .attributes
                .keys()
                .filter(|key| !known.contains(&key.as_str()))
                .count();
            if unknown > 0 {
                row.warnings.push(format!(
                    "{unknown} 个其他属性已保存在原始来源中，本次未应用"
                ));
            }
            for (attribute, description) in [("Bookmarks", "书签"), ("BackgroundImage", "背景图片")]
            {
                if song.attributes.contains_key(attribute) {
                    row.warnings
                        .push(format!("{description}已保存到原始来源，本次暂未应用到界面"));
                }
            }
            row.groups = document
                .groups
                .iter()
                .filter(|g| g.songs.contains(&id))
                .map(|g| g.path.clone())
                .collect();
            workspace.inspect_prepared(path.clone(), &file)?;
            let rating = song
                .number("Rating")?
                .map(|n| ((u16::from(n) + 10) / 20) as u8);
            if rating.is_some() {
                row.warnings
                    .push("来源 0～100 评级按比例转换为本地 0～5 星，原数值保留在来源中".into());
            }
            candidates.push(Candidate {
                path: path.clone(),
                cid,
                sidecar,
                next,
                annotations,
                groups: row.groups.clone(),
                rating,
            });
        }
        rows.push(row);
    }
    let matched = rows.iter().filter(|row| row.matched).count();
    Ok(Prepared {
        preview: ImportPreview {
            proof: proof.finalize().to_hex().to_string(),
            source_songs: document.songs.len(),
            matched,
            rows,
        },
        candidates,
    })
}
pub fn preview(
    data: &Path,
    bytes: Vec<u8>,
    paths: Vec<PathBuf>,
    options: ImportOptions,
    check: &impl Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    let lock = crate::library_workspace::lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    let mut workspace = Workspace::load(data)?;
    let prepared = prepare(&mut workspace, &bytes, &paths, &options, check)?;
    serde_json::to_value(prepared.preview).map_err(|e| e.to_string())
}
pub fn apply(
    data: &Path,
    bytes: Vec<u8>,
    paths: Vec<PathBuf>,
    options: ImportOptions,
    expected: String,
    check: &impl Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    let lock = crate::library_workspace::lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    let receipt_path = receipt_path(data, &expected);
    let request = request_hash(&bytes, &paths, &options, &expected)?;
    if let Some(receipt) = completed_source_import(data, &blake3::hash(&bytes).to_hex(), &paths, &options, &expected)? { return Ok(receipt); }
    let mut workspace = Workspace::load(data)?;
    let prepared = prepare(&mut workspace, &bytes, &paths, &options, check)?;
    if prepared.preview.proof != expected {
        return Err("预览后的曲目、资料或分组发生变化，请重新预览".into());
    }
    if prepared.preview.matched == 0 {
        return Err("所选 MIDI 与元数据没有匹配项".into());
    }
    if prepared.preview.rows.iter().any(|row| row.blocked) {
        return Err("存在无法应用的分手规则，请调整导入选项后重新预览".into());
    }
    let mut retained = vec![];
    for candidate in prepared.candidates {
        check()?;
        if candidate.sidecar.metadata != candidate.next.metadata {
            let id = crate::metadata_history::prepare(
                data,
                &candidate.path,
                &candidate.cid,
                candidate.sidecar.metadata.clone(),
                candidate.next.metadata.clone(),
                None,
            )?;
            crate::metadata_history::finish(data, &candidate.path, &id, true)?;
        }
        library::save_song_sidecar(&candidate.path, &candidate.cid, candidate.next)
            .map_err(|e| e.to_string())?;
        workspace.inspect(candidate.path.clone(), true)?;
        if let Some(rating) = candidate.rating {
            let entry = workspace
                .entries
                .get_mut(&key(&candidate.path))
                .ok_or("导入曲目未建立索引")?;
            if options.overwrite || entry.rating == 0 {
                entry.rating = rating;
            }
        }
        if options.groups {
            for path in &candidate.groups {
                let mut parent = None;
                for name in path {
                    let existing = workspace
                        .groups
                        .iter()
                        .find(|group| group.parent == parent && group.name == *name)
                        .map(|group| group.id.clone());
                    parent = Some(match existing {
                        Some(id) => id,
                        None => workspace.group(None, name.clone(), parent)?,
                    });
                }
                workspace.assign(vec![candidate.path.clone()], parent, None)?;
            }
        }
        retained.push(serde_json::json!({"path":candidate.path,"contentId":candidate.cid,"annotations":candidate.annotations}));
    }
    check()?;
    let source_hash = blake3::hash(&bytes).to_hex().to_string();
    let source_path = data
        .join("metadata-sources")
        .join(format!("{source_hash}.synthesia"));
    panthesia_core::utils::atomic_file::write(&source_path, &bytes).map_err(|e| e.to_string())?;
    workspace.save(data)?;
    let receipt = serde_json::json!({"format":"neothesia-synthesia-import","version":1,"requestHash":request,"sourceHash":source_hash,"sourcePath":source_path,"matched":prepared.preview.matched,"rows":prepared.preview.rows,"retained":retained,"reopenRequired":true});
    panthesia_core::utils::atomic_file::write(
        &receipt_path,
        &serde_json::to_vec_pretty(&receipt).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(receipt)
}
fn request_hash(
    bytes: &[u8],
    paths: &[PathBuf],
    options: &ImportOptions,
    expected: &str,
) -> Result<String, String> {
    source_request_hash(&blake3::hash(bytes).to_hex(), paths, options, expected)
}
fn receipt_path(data:&Path,expected:&str)->PathBuf {
    data.join("metadata-imports").join(format!("{}.json",blake3::hash(expected.as_bytes()).to_hex()))
}
pub(crate) fn completed_source_import(data:&Path,source_id:&str,paths:&[PathBuf],options:&ImportOptions,expected:&str)->Result<Option<serde_json::Value>,String> {
    let bytes=match panthesia_core::utils::atomic_file::read(&receipt_path(data,expected)) {
        Ok(bytes)=>bytes,
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),
        Err(e)=>return Err(e.to_string()),
    };
    let receipt:serde_json::Value=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
    if receipt["requestHash"]!=source_request_hash(source_id,paths,options,expected)? {
        return Err("导入请求已用于其他来源，请重新预览".into());
    }
    Ok(Some(receipt))
}
fn source_request_hash(source_id:&str,paths:&[PathBuf],options:&ImportOptions,expected:&str)->Result<String,String> {
    Ok(blake3::hash(
        &serde_json::to_vec(&(
            source_id,
            paths,
            options,
            expected,
        ))
        .map_err(|e| e.to_string())?,
    )
    .to_hex()
    .to_string())
}

#[cfg(test)]
#[path = "synthesia_import_tests.rs"]
mod tests;
