//! Portable song archives group validated performance packages without retaining external paths.
use crate::{Player, piece_package};
use panthesia_core::{
    repertoire::{MusicalWork, NotationEdition},
    utils::atomic_file,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Cursor, Read, Write},
    path::Path,
};
const ARCHIVE_LIMIT: usize = 256_000_000;
const EXPANDED_LIMIT: u64 = 512_000_000;
const MANIFEST_LIMIT: u64 = 4_000_000;
const PERFORMANCE_LIMIT: usize = 128;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    content_id: String,
    label: String,
    path: String,
    hash: String,
    size: usize,
    locked: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format: String,
    version: u16,
    work: MusicalWork,
    active_content_id: String,
    performances: Vec<Entry>,
    notations: Vec<NotationEdition>,
}
pub(crate) struct Archive {
    manifest: Manifest,
    files: BTreeMap<String, Vec<u8>>,
    summary: Value,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImportReceipt {
    pub work: MusicalWork,
    pub performances: Vec<RestoredPerformance>,
    pub notations: Vec<NotationEdition>,
    pub policy: String,
    pub nonce: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RestoredPerformance {
    pub content_id: String,
    pub label: String,
    pub locked: bool,
}
fn hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}
fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn read_entry(
    zip: &mut zip::ZipArchive<Cursor<&[u8]>>,
    index: usize,
    limit: u64,
) -> Result<(String, Vec<u8>), String> {
    let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
    let name = entry.name().to_owned();
    if !piece_package::valid_asset_path(&name)
        || entry.is_dir()
        || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        || entry.size() > limit
    {
        return Err("歌曲归档包含无效文件或超大文件".into());
    }
    let mut bytes = Vec::new();
    entry
        .by_ref()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("歌曲归档文件超过容量限制".into());
    }
    Ok((name, bytes))
}
/// Detect only our envelope. Older single-performance packages keep their existing decoder.
pub(crate) fn decode(
    bytes: &[u8],
    check: &dyn Fn() -> Result<(), String>,
) -> Result<Option<Archive>, String> {
    check()?;
    if bytes.is_empty() || bytes.len() > ARCHIVE_LIMIT {
        return Err("歌曲归档为空或超过 256 MB".into());
    }
    let mut zip =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("曲目包不是有效 ZIP：{e}"))?;
    let manifest_bytes = {
        let mut entry = zip.by_name("manifest.json").map_err(|_| "曲目包缺少清单")?;
        if entry.size() > MANIFEST_LIMIT {
            return Err("曲目包清单超过容量限制".into());
        }
        let mut result = Vec::new();
        entry
            .by_ref()
            .take(MANIFEST_LIMIT + 1)
            .read_to_end(&mut result)
            .map_err(|e| e.to_string())?;
        if result.len() as u64 > MANIFEST_LIMIT {
            return Err("曲目包清单超过容量限制".into());
        }
        result
    };
    let header: Value = serde_json::from_slice(&manifest_bytes).map_err(|e| e.to_string())?;
    if header["format"] != "panthesia-song" {
        return Ok(None);
    }
    let manifest: Manifest =
        serde_json::from_value(header).map_err(|e| format!("歌曲归档清单无效：{e}"))?;
    if manifest.version != 1
        || manifest.performances.is_empty()
        || manifest.performances.len() > PERFORMANCE_LIMIT
        || zip.len() != manifest.performances.len() + 1
    {
        return Err("歌曲归档版本或演奏数量无效".into());
    }
    let mut registry = panthesia_core::repertoire::RepertoireRegistry::default();
    registry
        .works
        .insert(manifest.work.id.clone(), manifest.work.clone());
    let mut files = BTreeMap::new();
    let mut paths = BTreeSet::new();
    let mut total = 0usize;
    for index in 0..zip.len() {
        check()?;
        let (path, bytes) = read_entry(&mut zip, index, ARCHIVE_LIMIT as u64)?;
        if !piece_package::insert_asset_path(&mut paths, &path) {
            return Err("歌曲归档包含重复路径".into());
        }
        total = total.checked_add(bytes.len()).ok_or("歌曲归档容量无效")?;
        if total > ARCHIVE_LIMIT {
            return Err("歌曲归档展开文件超过 256 MB".into());
        }
        if path != "manifest.json" {
            files.insert(path, bytes);
        }
    }
    let mut content_ids = BTreeSet::new();
    let mut expanded = 0u64;
    let mut summary = None;
    let mut summaries = Vec::new();
    let mut totals = BTreeMap::<&str, u64>::new();
    let mut score_ids = BTreeMap::<String, BTreeSet<String>>::new();
    for entry in &manifest.performances {
        check()?;
        if !valid_id(&entry.content_id)
            || !valid_id(&entry.hash)
            || entry.path != format!("performances/{}.neopiece", entry.content_id)
            || !content_ids.insert(entry.content_id.clone())
        {
            return Err("歌曲归档的演奏身份或路径无效".into());
        }
        let bytes = files.get(&entry.path).ok_or("歌曲归档缺少演奏文件")?;
        if bytes.len() != entry.size || hash(bytes) != entry.hash {
            return Err("歌曲归档的演奏文件校验失败".into());
        }
        let piece = piece_package::Package::decode_checked(bytes, check)?;
        if piece.manifest.content_id != entry.content_id {
            return Err("歌曲与演奏包身份不一致".into());
        }
        expanded = expanded
            .checked_add(piece.files.values().map(|v| v.len() as u64).sum::<u64>())
            .ok_or("歌曲归档容量无效")?;
        if expanded > EXPANDED_LIMIT {
            return Err("歌曲归档全部资产超过 512 MB".into());
        }
        registry.performances.insert(
            entry.content_id.clone(),
            panthesia_core::repertoire::PerformanceEdition {
                content_id: entry.content_id.clone(),
                work_id: manifest.work.id.clone(),
                label: entry.label.clone(),
                locations: vec![],
            },
        );
        score_ids.insert(
            entry.content_id.clone(),
            piece
                .manifest
                .scores
                .iter()
                .map(|a| a.hash.clone())
                .collect(),
        );
        let value = piece.summary();
        for (key, field) in [
            ("scores", "scores"),
            ("paperBooks", "papers"),
            ("passages", "passages"),
            ("ladders", "ladders"),
        ] {
            *totals.entry(key).or_default() +=
                value[field].as_array().map_or(0, |v| v.len() as u64);
        }
        for (key, field) in [
            ("fingerings", "fingerings"),
            ("fingerActions", "fingerActions"),
            ("hands", "hands"),
        ] {
            *totals.entry(key).or_default() += value[field].as_u64().unwrap_or(0);
        }
        *totals.entry("paperPages").or_default() += value["papers"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| p["pages"].as_u64().unwrap_or(0))
            .sum::<u64>();
        if entry.content_id == manifest.active_content_id {
            summary = Some(value.clone());
        }
        summaries.push(json!({"contentId":entry.content_id,"label":entry.label,"title":piece.manifest.title,"scores":piece.manifest.scores.len(),"papers":piece.manifest.papers.len()}));
    }
    for notation in &manifest.notations {
        if !notation.path.is_empty()
            || !score_ids
                .get(&notation.performance_id)
                .is_some_and(|ids| ids.contains(&notation.content_id))
            || registry
                .notations
                .insert(notation.id.clone(), notation.clone())
                .is_some()
        {
            return Err("歌曲归档谱面关联无效".into());
        }
    }
    registry.validate()?;
    let mut summary = summary.ok_or("歌曲归档没有所选演奏")?;
    summary["song"] = json!({"id":manifest.work.id,"title":manifest.work.title});
    summary["title"] = json!(manifest.work.title);
    summary["performances"] = json!(summaries);
    summary["archiveTotals"] = json!(totals);
    Ok(Some(Archive {
        manifest,
        files,
        summary,
    }))
}
pub(crate) fn inspect(
    bytes: &[u8],
    check: &dyn Fn() -> Result<(), String>,
) -> Result<(String, Value), String> {
    if let Some(archive) = decode(bytes, check)? {
        Ok((archive.manifest.active_content_id, archive.summary))
    } else {
        let package = piece_package::Package::decode_checked(bytes, check)?;
        Ok((package.manifest.content_id.clone(), package.summary()))
    }
}
struct BoundedWriter(Cursor<Vec<u8>>);
impl Write for BoundedWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self
            .0
            .position()
            .checked_add(bytes.len() as u64)
            .is_none_or(|n| n > ARCHIVE_LIMIT as u64)
        {
            return Err(std::io::Error::other("歌曲归档超过 256 MB"));
        }
        self.0.write(bytes)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}
impl std::io::Seek for BoundedWriter {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        std::io::Seek::seek(&mut self.0, pos)
    }
}
impl Player {
    pub(crate) fn prepare_song_package_checked(
        &mut self,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<(Vec<u8>, Value), String> {
        let cid = self.file.as_ref().ok_or("请先打开曲目")?.content_id.clone();
        let repository = crate::song_repository::SongRepository::open(&self.data)?;
        let snapshot = repository.export_directory()?;
        let registry = &snapshot.registry;
        let Some(performance) = registry
            .performances
            .get(&cid)
            .filter(|_| self.exercise.is_none())
        else {
            return self.prepare_piece_package_checked(check);
        };
        let work = registry
            .works
            .get(&performance.work_id)
            .ok_or("歌曲关系缺少作品")?
            .clone();
        let members = registry
            .performances
            .values()
            .filter(|p| p.work_id == work.id)
            .collect::<Vec<_>>();
        if members.len() > PERFORMANCE_LIMIT {
            return Err("单首歌曲的演奏版本超过 128 个，请先整理".into());
        }
        let mut manifest = Manifest {
            format: "panthesia-song".into(),
            version: 1,
            work,
            active_content_id: cid.clone(),
            performances: vec![],
            notations: vec![],
        };
        let mut files = BTreeMap::new();
        let mut total = 0usize;
        for member in members {
            check()?;
            let (bytes, _) = if member.content_id == cid {
                self.prepare_piece_package_checked(check)?
            } else {
                let path = repository
                    .resolve(Path::new(""), Some(&member.content_id))
                    .map_err(|e| format!("演奏版本 {} 无法归档：{e}", member.label))?;
                let prepared = crate::load_pipeline::Prepared::read_checked(
                    path,
                    member.label.clone(),
                    Some(&member.content_id),
                    |id| {
                        Ok(self
                            .preferences
                            .score_versions
                            .get(id)
                            .cloned()
                            .unwrap_or_default())
                    },
                    &|| check(),
                )?;
                let mut reader = Player::empty(self.data.clone(), std::path::PathBuf::new(), true);
                reader.preferences = self.preferences.clone();
                reader.restoring = true;
                reader.install_prepared(
                    prepared.file,
                    prepared.title,
                    None,
                    Some(crate::load_pipeline::InstallData {
                        assets: Some(prepared.assets),
                        timeline: prepared.timeline,
                    }),
                )?;
                reader.prepare_piece_package_checked(check)?
            };
            total = total.checked_add(bytes.len()).ok_or("歌曲归档容量无效")?;
            if total > ARCHIVE_LIMIT {
                return Err("歌曲归档的演奏包超过 256 MB".into());
            }
            let path = format!("performances/{}.neopiece", member.content_id);
            manifest.performances.push(Entry {
                content_id: member.content_id.clone(),
                label: member.label.clone(),
                path: path.clone(),
                hash: hash(&bytes),
                size: bytes.len(),
                locked: snapshot.locked.contains(&member.content_id),
            });
            files.insert(path, bytes);
        }
        for notation in registry.notations.values().filter(|n| {
            n.registered
                && manifest
                    .performances
                    .iter()
                    .any(|e| e.content_id == n.performance_id)
        }) {
            // Registered editions must resolve to an included score; incomplete archives are refused by decode.
            let mut notation = notation.clone();
            notation.path.clear();
            manifest.notations.push(notation);
        }
        let encoded = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
        if encoded.len() as u64 > MANIFEST_LIMIT {
            return Err("歌曲归档清单超过容量限制".into());
        }
        let mut zip = zip::ZipWriter::new(BoundedWriter(Cursor::new(Vec::new())));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("manifest.json", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&encoded).map_err(|e| e.to_string())?;
        for (path, bytes) in files {
            check()?;
            zip.start_file(path, options).map_err(|e| e.to_string())?;
            for chunk in bytes.chunks(524288) {
                check()?;
                zip.write_all(chunk).map_err(|e| e.to_string())?;
            }
        }
        let bytes = zip.finish().map_err(|e| e.to_string())?.0.into_inner();
        let archive = decode(&bytes, check)?.ok_or("歌曲归档格式不一致")?;
        if repository.revision()? != crate::song_repository::registry_revision(registry)? {
            return Err("歌曲关系在归档期间改变，请重新导出".into());
        }
        Ok((bytes, archive.summary))
    }
    pub(crate) fn import_portable_package(
        &mut self,
        bytes: Vec<u8>,
        policy: String,
    ) -> Result<Value, String> {
        self.import_portable_package_checked(bytes, policy, &|| Ok(()))
    }
    pub(crate) fn import_portable_package_checked(
        &mut self,
        bytes: Vec<u8>,
        policy: String,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        let Some(archive) = decode(&bytes, check)? else {
            return self.import_piece_package(bytes, policy);
        };
        if !["keep", "merge", "replace"].contains(&policy.as_str()) {
            return Err("请选择保留、合并或使用归档内容".into());
        }
        let target = self.data.join("web-preferences.json");
        if !atomic_file::is_capturing(&target) {
            let data = self.data.clone();
            let selected = data.clone();
            let mut reader = self.capture_asset_context(true, true).into_player(true)?;
            let (result, writes, observed) = atomic_file::capture_matching(
                std::sync::Arc::new(move |path: &Path| {
                    crate::asset_storage::captures(&selected, path)
                }),
                || reader.import_song_archive(archive, policy, check),
            );
            let result = result?;
            let playback = crate::song_switch::Playback::take(&mut reader)?;
            crate::asset_storage::commit(&data, writes, observed)?;
            crate::song_repository::SongRepository::open(&data)?;
            self.preferences = reader.preferences;
            self.history = reader.history;
            playback.install(self);
            return Ok(result);
        }
        self.import_song_archive(archive, policy, check)
    }
    fn import_song_archive(
        &mut self,
        archive: Archive,
        policy: String,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        let mut members = archive.manifest.performances.clone();
        members.sort_by_key(|e| e.content_id == archive.manifest.active_content_id);
        let mut result = Value::Null;
        for member in &members {
            check()?;
            result =
                self.import_piece_package(archive.files[&member.path].clone(), policy.clone())?;
        }
        let mut notations = archive.manifest.notations;
        for notation in &mut notations {
            let version = self
                .preferences
                .score_versions
                .get(&notation.performance_id)
                .into_iter()
                .flatten()
                .find(|v| v.content_id == notation.content_id && v.name == notation.name)
                .ok_or("恢复后的谱面版本未登记")?;
            notation.version_id = version.id.clone();
            notation.path = version.path.to_string_lossy().into_owned();
        }
        let receipt = ImportReceipt {
            work: archive.manifest.work,
            performances: members
                .iter()
                .map(|e| RestoredPerformance {
                    content_id: e.content_id.clone(),
                    label: e.label.clone(),
                    locked: e.locked,
                })
                .collect(),
            notations,
            policy,
            nonce: format!(
                "{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ),
        };
        check()?;
        let document = serde_json::to_vec(&receipt).map_err(|e| e.to_string())?;
        let receipt_path = self
            .data
            .join("library/pending-song-imports")
            .join(format!("{}.json", hash(&document)));
        atomic_file::write(&receipt_path, &document).map_err(|e| e.to_string())?;
        if !atomic_file::is_capturing(&receipt_path) {
            crate::song_repository::SongRepository::open(&self.data)?;
        }
        result["songImport"] = json!({"songId":receipt.work.id,"performances":members.len()});
        Ok(result)
    }
}
/// Receipts are published with the file transaction. SQLite replay is idempotent after a crash.
pub(crate) fn recover(
    data: &Path,
    repository: &mut crate::song_repository::SongRepository,
) -> Result<(), String> {
    let root = data.join("library/pending-song-imports");
    let entries = match std::fs::read_dir(&root) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !entry.file_type().map_err(|e| e.to_string())?.is_file()
            || path.extension().is_none_or(|e| e != "json")
        {
            return Err("歌曲恢复目录包含未知文件".into());
        }
        let bytes =
            atomic_file::read_limited(&path, MANIFEST_LIMIT as usize).map_err(|e| e.to_string())?;
        let id = hash(&bytes);
        if path.file_stem().and_then(|v| v.to_str()) != Some(id.as_str()) {
            return Err("歌曲恢复回执校验失败".into());
        }
        let receipt: ImportReceipt = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        repository.apply_song_archive(&id, &receipt)?;
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Command,
        preferences::{Preferences, ScoreVersion},
        song_repository::SongRepository,
    };
    use panthesia_core::{
        library::{self, FingerHint, SongSidecar},
        practice::PracticePart,
    };
    use std::path::PathBuf;
    fn root() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "panthesia-song-archive-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
    fn song() -> (Player, Vec<String>, String) {
        let data = root();
        let mut ids = vec![];
        let mut preferences = Preferences::default();
        let mut repo = SongRepository::open(&data).unwrap();
        for (index, bytes) in [
            include_bytes!("../assets/five-finger.mid").as_slice(),
            include_bytes!("../assets/c-major-scale.mid").as_slice(),
        ]
        .into_iter()
        .enumerate()
        {
            let cid = hash(bytes);
            let path = data.join(format!("source-{index}.mid"));
            std::fs::write(&path, bytes).unwrap();
            let owned = repo
                .retain(&path, &cid, &format!("Version {index}"), "Fixture", &|| {
                    Ok(())
                })
                .unwrap();
            let parsed = crate::library::read_midi(&owned).unwrap();
            let track = parsed
                .tracks
                .iter()
                .find(|t| !t.notes.is_empty())
                .unwrap()
                .track_id;
            let mut annotation = SongSidecar::default();
            annotation.track_parts.insert(
                track,
                if index == 0 {
                    PracticePart::LeftHand
                } else {
                    PracticePart::RightHand
                },
            );
            annotation.fingerings.push(FingerHint {
                track_id: track,
                note_index: 0,
                finger: 2 + index as u8,
            });
            library::save_song_sidecar(&owned, &cid, annotation).unwrap();
            let xml = crate::notation_assets::retain(
                &data,
                include_bytes!("../assets/starter-pack/five-finger.musicxml"),
            )
            .unwrap();
            preferences.score_versions.insert(
                cid.clone(),
                vec![ScoreVersion {
                    id: format!("version-{index}"),
                    name: format!("Score {index}"),
                    path: xml.clone(),
                    content_id: hash(include_bytes!(
                        "../assets/starter-pack/five-finger.musicxml"
                    )),
                }],
            );
            preferences.variants.insert(
                cid.clone(),
                crate::practice_variant::Variant {
                    transpose: index as i8 + 1,
                    quantize: 16,
                    ..Default::default()
                },
            );
            ids.push(cid);
        }
        let (mut registry, revision) = repo.snapshot().unwrap();
        let song_id = registry.performances[&ids[0]].work_id.clone();
        registry.works.get_mut(&song_id).unwrap().title = "Portable fixture song".into();
        registry.performances.get_mut(&ids[1]).unwrap().work_id = song_id.clone();
        for (index, cid) in ids.iter().enumerate() {
            let score = &preferences.score_versions[cid][0];
            let id = format!("notation-{index}");
            registry.notations.insert(
                id.clone(),
                NotationEdition {
                    id,
                    content_id: score.content_id.clone(),
                    performance_id: cid.clone(),
                    version_id: score.id.clone(),
                    name: score.name.clone(),
                    path: score.path.to_string_lossy().into_owned(),
                    quality: panthesia_core::repertoire::ScoreQuality::Proofread,
                    source: "Owned fixture".into(),
                    registered: true,
                },
            );
        }
        repo.save_registry(&registry, &revision, Some(&ids[1]))
            .unwrap();
        let path = repo.resolve(Path::new(""), Some(&ids[0])).unwrap();
        drop(repo);
        preferences
            .save(&data.join("web-preferences.json"))
            .unwrap();
        let mut player = Player::new(data, PathBuf::new(), true);
        player
            .command(Command::Load {
                path,
                title: "Version 0".into(),
            })
            .unwrap();
        (player, ids, song_id)
    }
    fn export(player: &mut Player) -> Vec<u8> {
        let data = player.data.clone();
        let (result, _, observed) = atomic_file::capture_matching(
            std::sync::Arc::new(move |path: &Path| crate::asset_storage::captures(&data, path)),
            || player.prepare_song_package_checked(&|| Ok(())),
        );
        let bytes = result.unwrap().0;
        crate::asset_storage::validate_observations(&observed).unwrap();
        bytes
    }
    #[test]
    fn all_performances_scores_transforms_and_grouping_survive_archive_restore() {
        let (mut source, ids, song_id) = song();
        let bytes = export(&mut source);
        let archive = decode(&bytes, &|| Ok(())).unwrap().unwrap();
        assert_eq!(archive.manifest.performances.len(), 2);
        assert_eq!(archive.summary["performances"].as_array().unwrap().len(), 2);
        assert!(archive.manifest.notations.iter().all(|n| n.path.is_empty()));
        let data = root();
        let mut restored = Player::new(data.clone(), PathBuf::new(), true);
        restored
            .import_portable_package(bytes, "replace".into())
            .unwrap();
        assert_eq!(restored.file.as_ref().unwrap().content_id, ids[0]);
        let snapshot = SongRepository::open(&data)
            .unwrap()
            .export_directory()
            .unwrap();
        assert_eq!(snapshot.registry.works.len(), 1);
        assert_eq!(
            snapshot.registry.works[&song_id].title,
            "Portable fixture song"
        );
        assert!(snapshot.locked.contains(&ids[1]));
        for (index, cid) in ids.iter().enumerate() {
            assert_eq!(snapshot.registry.performances[cid].work_id, song_id);
            let path = SongRepository::open(&data)
                .unwrap()
                .resolve(Path::new(""), Some(cid))
                .unwrap();
            let doc = library::load_song_sidecar(&path, cid).unwrap();
            assert_eq!(doc.fingerings[0].finger, 2 + index as u8);
            assert_eq!(
                restored.preferences.variants[cid].transpose,
                index as i8 + 1
            );
            let score = &restored.preferences.score_versions[cid][0];
            assert!(score.path.starts_with(data.join("library/assets/notation")));
            assert_eq!(
                snapshot.registry.notations[&format!("notation-{index}")].version_id,
                score.id
            );
        }
    }
    #[test]
    fn published_receipt_recovers_group_after_interrupted_publication() {
        let (mut source, ids, song_id) = song();
        let bytes = export(&mut source);
        let data = root();
        let selected = data.clone();
        let mut reader = Player::new(data.clone(), PathBuf::new(), true);
        let (result, writes, observed) = atomic_file::capture_matching(
            std::sync::Arc::new(move |path: &Path| crate::asset_storage::captures(&selected, path)),
            || reader.import_portable_package(bytes, "replace".into()),
        );
        result.unwrap();
        assert!(
            writes
                .iter()
                .any(|w| w.path.to_string_lossy().contains("pending-song-imports"))
        );
        // The file transaction finishes, but the normal post-commit directory hook has not run.
        crate::asset_storage::commit(&data, writes, observed).unwrap();
        assert_eq!(
            std::fs::read_dir(data.join("library/pending-song-imports"))
                .unwrap()
                .count(),
            1
        );
        let repository = SongRepository::open(&data).unwrap();
        let registry = repository.registry().unwrap();
        assert!(
            ids.iter()
                .all(|id| registry.performances[id].work_id == song_id)
        );
        assert_eq!(
            std::fs::read_dir(data.join("library/pending-song-imports"))
                .unwrap()
                .count(),
            0
        );
        drop(repository);
        assert_eq!(
            SongRepository::open(&data)
                .unwrap()
                .registry()
                .unwrap()
                .works
                .len(),
            1
        );
    }
    #[test]
    fn cancelled_multiversion_prepare_publishes_no_partial_annotations() {
        let (mut source, _, _) = song();
        let bytes = export(&mut source);
        let archive = decode(&bytes, &|| Ok(())).unwrap().unwrap();
        let before = std::fs::read(source.data.join("web-preferences.json")).unwrap();
        let data = source.data.clone();
        let original = source.file.as_ref().unwrap().content_id.clone();
        let mut reader = source
            .capture_asset_context(true, true)
            .into_player(true)
            .unwrap();
        let calls = std::cell::Cell::new(0);
        let check = || {
            calls.set(calls.get() + 1);
            if calls.get() == 2 {
                Err("cancelled".to_owned())
            } else {
                Ok(())
            }
        };
        let (result, writes, _) = atomic_file::capture_matching(
            std::sync::Arc::new(move |path: &Path| crate::asset_storage::captures(&data, path)),
            || reader.import_song_archive(archive, "replace".into(), &check),
        );
        assert_eq!(result.unwrap_err(), "cancelled");
        assert!(!writes.is_empty());
        assert_eq!(
            std::fs::read(source.data.join("web-preferences.json")).unwrap(),
            before
        );
        assert_eq!(source.file.as_ref().unwrap().content_id, original);
        assert!(!source.data.join("library/pending-song-imports").exists());
    }
    #[test]
    fn corrupt_member_is_rejected_before_existing_profile_changes() {
        let (mut source, _, _) = song();
        let bytes = export(&mut source);
        let mut archive = decode(&bytes, &|| Ok(())).unwrap().unwrap();
        archive.manifest.performances[1].hash = "0".repeat(64);
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(&serde_json::to_vec(&archive.manifest).unwrap())
            .unwrap();
        for (path, bytes) in archive.files {
            zip.start_file(path, options).unwrap();
            zip.write_all(&bytes).unwrap();
        }
        let corrupted = zip.finish().unwrap().into_inner();
        let before = std::fs::read(source.data.join("web-preferences.json")).unwrap();
        let active = source.file.as_ref().unwrap().content_id.clone();
        assert!(
            source
                .import_portable_package(corrupted, "replace".into())
                .is_err()
        );
        assert_eq!(
            std::fs::read(source.data.join("web-preferences.json")).unwrap(),
            before
        );
        assert_eq!(source.file.as_ref().unwrap().content_id, active);
    }
}
