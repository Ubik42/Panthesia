//! Local original-file links are deliberately separate from portable score copies.
use crate::{
    library_scores, library_workspace,
    notation::ScoreAsset,
    preferences::{Preferences, ScoreVersion},
    *,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub content_id: String,
    pub version_id: String,
    pub midi_path: PathBuf,
    pub path: PathBuf,
    pub baseline: String,
    pub default_bpm: u16,
    #[serde(default)]
    pub acknowledged: Option<String>,
}
#[derive(Clone,Copy,Serialize,PartialEq,Eq)]
#[serde(rename_all="lowercase")]
pub enum SourceStatus {Ready,Changed,Acknowledged,Missing,Unreadable}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SourceEntry {
    id:String,content_id:String,version_id:String,name:String,song_title:String,
    midi_path:PathBuf,path:PathBuf,status:SourceStatus,pending:bool,active:bool,
    default_bpm:u16,fingerprint:Option<String>,error:Option<String>,
}
#[derive(Serialize)]
pub struct SourceList {entries:Vec<SourceEntry>}
#[derive(Serialize)]
pub struct Pairing {coverage:u8,readiness:panthesia_core::score_alignment::AlignmentReadiness,diagnostics:Vec<String>}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SourcePreview {
    id:String,fingerprint:String,name:String,title:Option<String>,new_content_id:Option<String>,
    performance_ready:bool,performance_error:Option<String>,written_notes:usize,
    same_performance:Option<bool>,notes:Option<usize>,duration:Option<f64>,old_available:bool,
    pairing:Option<Pairing>,warnings:Vec<String>,route_preview:Option<Value>,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct AppliedSource {content_id:String,version_id:String,mode:String,song:Option<Value>,warnings:Vec<String>}
#[derive(Default, Deserialize, Serialize)]
struct Store {
    entries: BTreeMap<String, Source>,
}
fn load(data:&Path)->Result<Store,String> {
    let bytes=match panthesia_core::utils::atomic_file::read_limited(&data.join("score-sources.json"),16_000_000) {Ok(bytes)=>bytes,Err(error) if error.kind()==std::io::ErrorKind::NotFound=>return Ok(Store::default()),Err(error)=>return Err(error.to_string())};
    if bytes.len()>16_000_000 {return Err("原谱关联资料过大".into());}
    let store:Store=serde_json::from_slice(&bytes).map_err(|e|format!("原谱关联资料无法读取：{e}"))?;
    if store.entries.len()>10_000{return Err("原谱关联数量超过上限".into());}Ok(store)
}
fn save(data:&Path,store:&Store)->Result<(),String> {
    let bytes=serde_json::to_vec_pretty(store).map_err(|e|e.to_string())?;
    if bytes.len()>16_000_000{return Err("原谱关联资料达到容量上限，请先整理关联".into());}
    panthesia_core::utils::atomic_file::write(&data.join("score-sources.json"),&bytes).map_err(|e|e.to_string())
}
pub(crate) fn registered_origins(data: &Path) -> Result<BTreeMap<(String, String), String>, String> {
    Ok(load(data)?.entries.into_values().map(|source|((source.content_id,source.baseline),format!("用户登记的原谱：{}",source.path.display()))).collect())
}
pub fn read_original(path: &Path) -> Result<Vec<u8>, String> {
    if !path.is_absolute() {
        return Err("请选择原谱文件的完整位置".into());
    }
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    if !["xml", "musicxml", "mxl"].contains(&ext.as_str()) {
        return Err("原谱关联支持 MusicXML/XML/MXL".into());
    }
    let bytes=panthesia_core::utils::atomic_file::read_dependency(path,panthesia_core::source_score_window::ASSET_LIMIT)
        .map_err(|e|format!("原谱无法读取：{e}"))?;
    if bytes.is_empty() || bytes.len() > panthesia_core::source_score_window::ASSET_LIMIT {
        return Err("原谱文件为空或超过 64 MiB".into());
    }
    Ok(bytes)
}
fn version<'a>(prefs: &'a Preferences, source: &Source) -> Option<&'a ScoreVersion> {
    prefs
        .score_versions
        .get(&source.content_id)?
        .iter()
        .find(|v| v.id == source.version_id && v.content_id == source.baseline)
}
fn fingerprint(source: &Source, hash: &str) -> String {
    let mut h = blake3::Hasher::new();
    h.update(&serde_json::to_vec(source).unwrap());
    h.update(hash.as_bytes());
    h.finalize().to_hex().to_string()
}
pub(super) fn register(
    data: &Path,
    cid: &str,
    midi: &Path,
    version_id: &str,
    path: &Path,
    bpm: u16,
) -> Result<Value, String> {
    if !(20..=300).contains(&bpm) {
        return Err("缺省速度需为 20 至 300 BPM".into());
    }
    let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let bytes = read_original(&path)?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    let prefs = Preferences::load(&data.join("web-preferences.json"))?;
    let v = prefs
        .score_versions
        .get(cid)
        .and_then(|v| v.iter().find(|v| v.id == version_id))
        .ok_or("谱面版本已移除，请刷新列表")?;
    if hash != v.content_id {
        return Err("原文件与保存版本不同；请先关联原来的文件，或把新内容添加为新版本".into());
    }
    let id = blake3::hash(format!("{cid}\n{version_id}").as_bytes())
        .to_hex()
        .to_string();
    let lock = library_workspace::lock_for(data)?;
    let _guard = lock.lock().map_err(|_| "原谱关联资料正忙")?;
    let mut store = load(data)?;
    store.entries.retain(|_, s| version(&prefs, s).is_some());
    if store.entries.len() >= 10_000 && !store.entries.contains_key(&id) {
        return Err("已关联 10000 份原谱，请先整理".into());
    }
    store.entries.insert(
        id.clone(),
        Source {
            id: id.clone(),
            content_id: cid.into(),
            version_id: version_id.into(),
            midi_path: midi.into(),
            path,
            baseline: hash,
            default_bpm: bpm,
            acknowledged: None,
        },
    );
    save(data, &store)?;
    Ok(json!({"id":id,"linked":true}))
}
fn checked(data: &Path, id: &str, expected: &str) -> Result<(Source, Vec<u8>), String> {
    let source = load(data)?
        .entries
        .remove(id)
        .ok_or("原谱关联已取消，请刷新列表")?;
    let prefs = Preferences::load(&data.join("web-preferences.json"))?;
    version(&prefs, &source).ok_or("保存版本已经改变或移除，请刷新列表")?;
    let bytes = read_original(&source.path)?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    if fingerprint(&source, &hash) != expected {
        return Err("原文件或关联已经改变，请重新检查并预览".into());
    }
    Ok((source, bytes))
}
pub fn inspect(data: &Path, cid: Option<&str>) -> Result<Value, String> {
    let store = load(data)?;
    let prefs = Preferences::load(&data.join("web-preferences.json"))?;
    let mut rows = Vec::new();
    for source in store
        .entries
        .values()
        .filter(|s| cid.is_none_or(|cid| s.content_id == cid))
    {
        let Some(v) = version(&prefs, source) else {
            continue;
        };
        let read = read_original(&source.path);
        let (status, hash, error) = match read {
            Ok(bytes) => {
                let hash = blake3::hash(&bytes).to_hex().to_string();
                (
                    if hash == source.baseline {
                        SourceStatus::Ready
                    } else if source.acknowledged.as_ref() == Some(&hash) {
                        SourceStatus::Acknowledged
                    } else {
                        SourceStatus::Changed
                    },
                    Some(hash),
                    None,
                )
            }
            Err(e) => (
                if source.path.exists() {
                    SourceStatus::Unreadable
                } else {
                    SourceStatus::Missing
                },
                None,
                Some(e),
            ),
        };
        let song_title =
            panthesia_core::library::load_song_sidecar(&source.midi_path, &source.content_id)
                .ok()
                .and_then(|s| s.metadata.title)
                .unwrap_or_else(|| v.name.clone());
        let active =
            panthesia_core::library::load_song_sidecar(&source.midi_path, &source.content_id)
                .ok()
                .and_then(|s| s.score)
                .is_some_and(|a| {
                    panthesia_core::library::resolve_score_path(&source.midi_path, &a) == v.path
                });
        rows.push(SourceEntry {id:source.id.clone(),content_id:source.content_id.clone(),version_id:source.version_id.clone(),name:v.name.clone(),active,song_title,midi_path:source.midi_path.clone(),path:source.path.clone(),status,pending:status==SourceStatus::Changed,default_bpm:source.default_bpm,fingerprint:hash.as_ref().map(|hash|fingerprint(source,hash)),error});
    }
    rows.sort_by(|left,right|(!left.pending,&left.song_title,&left.name,!left.active).cmp(&(!right.pending,&right.song_title,&right.name,!right.active)));
    serde_json::to_value(SourceList{entries:rows}).map_err(|e|e.to_string())
}

/// Resolve only a registered, unchanged original. The caller may pass the path
/// to a score editor; portable score copies are never edited by this action.
pub fn original_for_edit(data: &Path, cid: &str, version_id: &str) -> Result<PathBuf, String> {
    let store = load(data)?;
    let source = store.entries.values()
        .find(|source| source.content_id == cid && source.version_id == version_id)
        .ok_or("此谱面版本尚未关联原谱文件。请先关联原谱文件")?;
    let prefs = Preferences::load(&data.join("web-preferences.json"))?;
    version(&prefs, source).ok_or("谱面版本已改变或移除，请刷新列表")?;
    let path = std::fs::canonicalize(&source.path)
        .map_err(|e| format!("原谱文件无法打开：{e}"))?;
    if path != source.path {
        return Err("原谱文件位置已改变，请重新关联原谱".into());
    }
    let bytes = read_original(&path)?;
    if blake3::hash(&bytes).to_hex().as_str() != source.baseline {
        return Err("原谱文件已经变化。请先检查原谱更新，再决定如何保存新内容".into());
    }
    Ok(path)
}
pub fn preview(data: &Path, id: &str, expected: &str) -> Result<Value, String> {
    let (source, bytes) = checked(data, id, expected)?;
    let score =
        panthesia_core::musicxml::import_musicxml_document(&bytes).map_err(|e| e.to_string())?;
    let name = source
        .path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let generated = panthesia_core::score_performance::generate(&score, source.default_bpm)
        .and_then(|performance| {
            let file = MidiFile::from_smf(&name, &performance.smf)?;
            let notes = file.tracks.iter().map(|t| t.notes.len()).sum::<usize>();
            if notes == 0 {
                return Err("此原谱没有可生成的演奏音符，可保存为谱面版本".into());
            }
            Ok((file, notes, performance.warnings))
        });
    let (_, old_file) = library_scores::location(data, &source.midi_path, &source.content_id)?;
    let pairing = old_file
        .as_ref()
        .map(|f| ScoreAsset::new(bytes.clone(), name.clone(), f).map(|a|{let summary=panthesia_core::score_alignment::summarize_alignment(&a.alignment);Pairing {coverage:summary.coverage_percent,readiness:summary.readiness,diagnostics:summary.navigation_diagnostics}}))
        .transpose()?;
    let (new_cid, notes, duration, same, warnings, error, route_preview) = match generated {
        Ok((file, notes, warnings)) => {
            let asset=ScoreAsset::new(bytes.clone(),name.clone(),&file)?;
            let route=asset.route_payload(Some(&file));
            (
                Some(file.content_id.clone()),
                Some(notes),
                Some(file.duration.as_secs_f64()),
                Some(file.content_id == source.content_id),
                warnings,
                None,
                Some(route),
            )
        }
        Err(error) => (None, None, None, None, Vec::new(), Some(error), None),
    };
    let written = score
        .parts
        .iter()
        .flat_map(|p| &p.measures)
        .flat_map(|m| &m.events)
        .filter(|e| matches!(e,panthesia_core::musicxml::ScoreEvent::Note(n) if n.pitch.is_some()))
        .count();
    serde_json::to_value(SourcePreview {id:id.into(),fingerprint:expected.into(),name,title:score.title,new_content_id:new_cid,performance_ready:error.is_none(),performance_error:error,written_notes:written,same_performance:same,notes,duration,old_available:old_file.is_some(),pairing,warnings,route_preview}).map_err(|e|e.to_string())
}
pub(super) fn acknowledge(data: &Path, id: &str, expected: &str) -> Result<Value, String> {
    let (source, bytes) = checked(data, id, expected)?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    let lock = library_workspace::lock_for(data)?;
    let _guard = lock.lock().map_err(|_| "原谱关联资料正忙")?;
    let mut store = load(data)?;
    let current = store.entries.get_mut(id).ok_or("原谱关联已取消")?;
    if fingerprint(current, &hash) != expected {
        return Err("关联已改变，请刷新列表".into());
    }
    if current.path != source.path {
        return Err("原谱位置已改变".into());
    }
    current.acknowledged = Some(hash);
    save(data, &store)?;
    Ok(json!({"kept":true}))
}
pub(super) fn unlink(data: &Path, id: &str, path: &Path) -> Result<Value, String> {
    let lock = library_workspace::lock_for(data)?;
    let _guard = lock.lock().map_err(|_| "原谱关联资料正忙")?;
    let mut store = load(data)?;
    if store.entries.get(id).is_some_and(|s| s.path != path) {
        return Err("原谱关联已改变，请刷新列表后操作".into());
    }
    store.entries.remove(id);
    save(data, &store)?;
    Ok(json!({"unlinked":true}))
}

impl Player {
    pub(super) fn link_score_source(
        &mut self,
        midi: PathBuf,
        cid: String,
        version_id: String,
        path: PathBuf,
        bpm: u16,
    ) -> Result<Value, String> {
        let midi = if midi.as_os_str().is_empty() {
            let file = self.file.as_ref().filter(|file| file.content_id == cid)
                .ok_or("请先打开需要关联原谱的练习曲")?;
            self.annotation_path(file)?
        } else {
            midi
        };
        let (midi, file) = library_scores::location(&self.data, &midi, &cid)?;
        let bpm = if bpm == 0 {
            file.as_ref()
                .map(|f| f.tempo_track.bpm_at_seconds(0.).round().clamp(20., 300.) as u16)
                .unwrap_or(120)
        } else {
            bpm
        };
        if !(20..=300).contains(&bpm) {
            return Err("缺省速度需为 20 至 300 BPM".into());
        }
        let (mut versions, active) = library_scores::versions(&self.preferences, &midi, &cid)?;
        let v = versions
            .iter()
            .find(|v| v.id == version_id)
            .ok_or("谱面版本不存在")?
            .clone();
        let bytes = read_original(&path)?;
        if blake3::hash(&bytes).to_hex().as_str() != v.content_id {
            return Err("所选原文件与此保存版本不同，未建立关联".into());
        }
        if v.path == path || std::fs::canonicalize(&v.path).ok().zip(std::fs::canonicalize(&path).ok()).is_some_and(|(a,b)|a==b) {
            let snapshot=crate::notation_assets::retain(&self.data,&bytes)?;
            versions
                .iter_mut()
                .find(|row| row.id == version_id)
                .ok_or("谱面版本不存在")?
                .path = snapshot.clone();
            if active.as_ref() == Some(&v.path) {
                panthesia_core::library::save_score_association(&midi, &cid, &snapshot)
                    .map_err(|e| e.to_string())?;
            }
            self.preferences
                .score_versions
                .insert(cid.clone(), versions);
            self.preferences.save(&self.preferences_path)?;
        }
        // Also migrates legacy external associations to an owned immutable copy.
        self.add_library_notation(
            midi.clone(),
            cid.clone(),
            v.name.clone(),
            bytes,
            Some(version_id.clone()),
        )?;
        register(&self.data, &cid, &midi, &version_id, &path, bpm)
    }
    pub(super) fn import_score_original(
        &mut self,
        path: PathBuf,
        bpm: u16,
    ) -> Result<Value, String> {
        let bytes = read_original(&path)?;
        let hash = blake3::hash(&bytes).to_hex().to_string();
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let result = self.command(Command::ImportScore {
            bytes,
            name: name.clone(),
            default_bpm: bpm,
        })?;
        self.finish_original_import(path, bpm, hash, name, result)
    }
    pub(crate) fn finish_original_import(&mut self, path: PathBuf, bpm: u16, hash: String, name: String, result: Value) -> Result<Value, String> {
        let cid = result["contentId"].as_str().ok_or("导入曲目身份缺失")?;
        let midi = PathBuf::from(result["sourcePath"].as_str().ok_or("导入曲目位置缺失")?);
        let version = self
            .preferences
            .score_versions
            .get(cid)
            .and_then(|v| {
                v.iter()
                    .rev()
                    .find(|v| v.content_id == hash && v.name == name)
            })
            .ok_or("导入谱面版本缺失")?
            .id
            .clone();
        let linked = self.link_score_source(midi.clone(), cid.to_string(), version, path, bpm);
        let mut result = result;
        if let Err(e) = linked {
            let mut warnings = result["importWarnings"].as_array().cloned().unwrap_or_default();
            warnings.push(json!(format!("曲目已导入，原文件关联未完成：{e}")));
            result["importWarnings"] = json!(warnings);
        }
        Ok(result)
    }
    pub(super) fn apply_score_source(
        &mut self,
        id: String,
        expected: String,
        mode: String,
    ) -> Result<Value, String> {
        if !["notation", "performance"].contains(&mode.as_str()) {
            return Err("请选择更新谱面或建立演奏曲目".into());
        }
        if self.recorder.is_recording()
            || self.state.status == "playing"
            || self.routine.is_some()
            || self.ladder.as_ref().is_some_and(|r| r.active)
        {
            return Err("请先停止演奏、录音、练习计划和速度阶梯，再应用原谱更新".into());
        }
        let (source, bytes) = checked(&self.data, &id, &expected)?;
        let hash = blake3::hash(&bytes).to_hex().to_string();
        let name = source
            .path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let (cid, midi, version, result) = if mode == "performance" {
            let result = self.command(Command::ImportScore {
                bytes,
                name: name.clone(),
                default_bpm: source.default_bpm,
            })?;
            let cid = result["contentId"]
                .as_str()
                .ok_or("曲目身份缺失")?
                .to_string();
            let midi = PathBuf::from(result["sourcePath"].as_str().ok_or("曲目位置缺失")?);
            let v = self
                .preferences
                .score_versions
                .get(&cid)
                .and_then(|v| {
                    v.iter()
                        .rev()
                        .find(|v| v.content_id == hash && v.name == name)
                })
                .ok_or("新谱面版本缺失")?
                .id
                .clone();
            (cid, midi, v, Some(result))
        } else {
            let score = panthesia_core::musicxml::import_musicxml_document(&bytes)
                .map_err(|e| e.to_string())?;
            panthesia_core::score_performance::normalized(&score)?;
            let result = self.add_library_notation(
                source.midi_path.clone(),
                source.content_id.clone(),
                name,
                bytes,
                None,
            )?;
            (
                source.content_id.clone(),
                source.midi_path.clone(),
                result["id"].as_str().ok_or("新谱面版本缺失")?.into(),
                None,
            )
        };
        // Recheck the source on link: mid-save edits cannot be acknowledged as applied.
        let linked = self.link_score_source(
            midi.clone(),
            cid.clone(),
            version.clone(),
            source.path.clone(),
            source.default_bpm,
        );
        let mut warnings = Vec::new();
        if let Err(e) = linked {
            warnings.push(format!("更新已保存，原文件关联未完成：{e}"));
        }
        if let Err(e) = acknowledge(&self.data, &id, &expected) {
            warnings.push(format!("原文件再次变化，请重新检查：{e}"));
        }
        serde_json::to_value(AppliedSource {content_id:cid,version_id:version,mode,song:result,warnings}).map_err(|e|e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn linking_a_saved_copy_keeps_an_independent_snapshot_and_infers_tempo() {
        let data = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work")
            .join(format!(
                "source-copy-test-{}",
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        std::fs::create_dir_all(&data).unwrap();
        let original = data.join("original.musicxml");
        let first = xml("C", "");
        std::fs::write(&original, &first).unwrap();
        let mut player = Player::new(
            data.clone(),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../default.sf2"),
            true,
        );
        let song = player
            .command(Command::ImportScoreOriginal {
                path: original,
                default_bpm: 60,
            })
            .unwrap();
        let cid = song["contentId"].as_str().unwrap().to_string();
        let version = player.preferences.score_versions[&cid][0].clone();
        player
            .command(Command::LinkScoreSource {
                midi_path: PathBuf::new(),
                content_id: cid.clone(),
                version_id: version.id.clone(),
                path: version.path.clone(),
                default_bpm: 0,
            })
            .unwrap();
        let snapshot = player.preferences.score_versions[&cid][0].path.clone();
        assert_ne!(snapshot, version.path);
        let row = inspect(&data, Some(&cid)).unwrap()["entries"][0].clone();
        assert_eq!(row["defaultBpm"], 60);
        assert_eq!(original_for_edit(&data, &cid, &version.id).unwrap(), std::fs::canonicalize(&version.path).unwrap());
        assert!(original_for_edit(&data, &cid, "another-version").is_err());
        assert!(
            unlink(
                &data,
                row["id"].as_str().unwrap(),
                Path::new("wrong-original.musicxml")
            )
            .is_err()
        );
        std::fs::write(&version.path, xml("G", "")).unwrap();
        assert_eq!(std::fs::read(snapshot).unwrap(), first);
        assert_eq!(
            inspect(&data, Some(&cid)).unwrap()["entries"][0]["status"],
            "changed"
        );
        assert!(original_for_edit(&data, &cid, &version.id).is_err());
        let clean=inspect(&data,Some(&cid)).unwrap()["entries"][0].clone();
        let clean_preview=preview(&data,clean["id"].as_str().unwrap(),clean["fingerprint"].as_str().unwrap()).unwrap();
        assert_eq!(clean_preview["performanceReady"],true);
        assert_eq!(clean_preview["routePreview"]["route"]["visits"].as_array().unwrap().len(),1);
        assert!(clean_preview["routePreview"].get("bytes").is_none());
        std::fs::write(
            &version.path,
            xml("G", r#"<direction><sound dalsegno="missing"/></direction>"#),
        )
        .unwrap();
        let row = inspect(&data, Some(&cid)).unwrap()["entries"][0].clone();
        let preview = preview(
            &data,
            row["id"].as_str().unwrap(),
            row["fingerprint"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(preview["performanceReady"], false);
        assert!(!preview["performanceError"].as_str().unwrap().is_empty());
        player
            .command(Command::ApplyScoreSource {
                id: row["id"].as_str().unwrap().into(),
                fingerprint: row["fingerprint"].as_str().unwrap().into(),
                mode: "notation".into(),
            })
            .unwrap();
        assert_eq!(player.file.as_ref().unwrap().content_id, cid);
    }
    fn xml(step: &str, extra: &str) -> Vec<u8> {
        format!(r#"<score-partwise version="4.0"><work><work-title>原谱课堂</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>{step}</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>{extra}</measure></part></score-partwise>"#).into_bytes()
    }
    #[test]
    fn original_updates_preserve_owned_versions_and_piece_identity() {
        let data = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work")
            .join(format!(
                "source-test-{}",
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        std::fs::create_dir_all(&data).unwrap();
        let original = data.join("original.musicxml");
        let first = xml("C", "");
        std::fs::write(&original, &first).unwrap();
        let mut player = Player::new(
            data.clone(),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../default.sf2"),
            true,
        );
        let song = player
            .command(Command::ImportScoreOriginal {
                path: original.clone(),
                default_bpm: 60,
            })
            .unwrap();
        let cid = song["contentId"].as_str().unwrap().to_string();
        let midi = PathBuf::from(song["sourcePath"].as_str().unwrap());
        let track = song["notes"][0]["track"].as_u64().unwrap() as usize;
        player
            .command(Command::EditFingersFor {
                content_id: cid.clone(),
                edits: vec![fingerings::Edit {
                    track_id: track,
                    note_index: 0,
                    finger: Some(2),
                }],
            })
            .unwrap();
        let row = inspect(&data, Some(&cid)).unwrap()["entries"][0].clone();
        assert_eq!(row["status"], "ready");
        let initial_copy = player.preferences.score_versions[&cid][0].path.clone();
        assert_ne!(initial_copy, original);
        let mut scanner = Scanner::default();
        assert_eq!(scanner.scan(&data).unwrap().0, 0);
        let original_key = std::fs::canonicalize(&original).unwrap();
        scanner.cache.get_mut(&original_key).unwrap().1 = None;
        assert_eq!(scanner.scan(&data).unwrap().1, 0);
        std::fs::write(&original, xml("C", "<!-- engraving changed -->")).unwrap();
        assert_eq!(scanner.scan(&data).unwrap().0, 1);
        let changed = inspect(&data, Some(&cid)).unwrap()["entries"][0].clone();
        let id = changed["id"].as_str().unwrap().to_string();
        let token = changed["fingerprint"].as_str().unwrap().to_string();
        assert!(
            preview(&data, &id, &token).unwrap()["samePerformance"]
                .as_bool()
                .unwrap()
        );
        player
            .command(Command::ApplyScoreSource {
                id: id.clone(),
                fingerprint: token,
                mode: "notation".into(),
            })
            .unwrap();
        assert_eq!(std::fs::read(&initial_copy).unwrap(), first);
        assert_eq!(player.file.as_ref().unwrap().content_id, cid);
        assert_eq!(player.preferences.score_versions[&cid].len(), 2);
        let entries = inspect(&data, Some(&cid)).unwrap();
        assert!(
            entries["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["status"] == "acknowledged")
        );
        let new_source = entries["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["status"] == "ready")
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        std::fs::write(&original, xml("D", "")).unwrap();
        let row = inspect(&data, Some(&cid)).unwrap()["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == new_source)
            .unwrap()
            .clone();
        let token = row["fingerprint"].as_str().unwrap().to_string();
        assert!(
            !preview(&data, &new_source, &token).unwrap()["samePerformance"]
                .as_bool()
                .unwrap()
        );
        std::fs::write(&original, xml("E", "")).unwrap();
        assert!(
            player
                .command(Command::ApplyScoreSource {
                    id: new_source.clone(),
                    fingerprint: token,
                    mode: "performance".into()
                })
                .is_err()
        );
        assert_eq!(player.file.as_ref().unwrap().content_id, cid);
        std::fs::write(&original, xml("D", "")).unwrap();
        let row = inspect(&data, Some(&cid)).unwrap()["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == new_source)
            .unwrap()
            .clone();
        let token = row["fingerprint"].as_str().unwrap().to_string();
        player.state.status = "playing".into();
        assert!(
            player
                .command(Command::ApplyScoreSource {
                    id: new_source.clone(),
                    fingerprint: token.clone(),
                    mode: "performance".into()
                })
                .is_err()
        );
        player.state.status = "paused".into();
        let result = player
            .command(Command::ApplyScoreSource {
                id: new_source,
                fingerprint: token,
                mode: "performance".into(),
            })
            .unwrap();
        assert_ne!(result["contentId"], cid);
        assert!(result["warnings"].as_array().unwrap().is_empty());
        let current = player.command(Command::CurrentSong).unwrap();
        assert!(current["notes"][0]["finger"].is_null());
        player
            .command(Command::Load {
                path: midi,
                title: "旧曲目".into(),
            })
            .unwrap();
        assert_eq!(
            player.command(Command::CurrentSong).unwrap()["notes"][0]["finger"],
            2
        );
        assert_eq!(std::fs::read(&initial_copy).unwrap(), first);
        std::fs::remove_file(&original).unwrap();
        assert!(
            inspect(&data, Some(&cid)).unwrap()["entries"]
                .as_array()
                .unwrap()
                .iter()
                .all(|e| e["status"] == "missing")
        );
        assert!(initial_copy.is_file());
    }
}

/// The folder monitor checks only originals whose timestamp/size changed.
#[derive(Default)]
pub struct Scanner {
    cache: BTreeMap<PathBuf, ((u64, u128), Option<String>)>,
    signature: String,
}
impl Scanner {
    pub fn scan(&mut self, data: &Path) -> Result<(usize, usize, bool), String> {
        let store = load(data)?;
        let prefs = Preferences::load(&data.join("web-preferences.json"))?;
        let mut pending = 0;
        let mut missing = 0;
        let mut states = Vec::new();
        let paths = store
            .entries
            .values()
            .map(|s| s.path.clone())
            .collect::<std::collections::BTreeSet<_>>();
        self.cache.retain(|p, _| paths.contains(p));
        for source in store
            .entries
            .values()
            .filter(|s| version(&prefs, s).is_some())
        {
            let stamp = std::fs::metadata(&source.path).ok().map(|m| {
                (
                    m.len(),
                    m.modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map_or(0, |d| d.as_nanos()),
                )
            });
            let hash = if let Some(stamp) = stamp {
                if self
                    .cache
                    .get(&source.path)
                    .is_none_or(|(old, hash)| *old != stamp || hash.is_none())
                {
                    self.cache.insert(
                        source.path.clone(),
                        (
                            stamp,
                            read_original(&source.path)
                                .ok()
                                .map(|b| blake3::hash(&b).to_hex().to_string()),
                        ),
                    );
                }
                self.cache.get(&source.path).and_then(|(_, h)| h.clone())
            } else {
                self.cache.remove(&source.path);
                None
            };
            if let Some(h) = &hash {
                if h != &source.baseline && source.acknowledged.as_ref() != Some(h) {
                    pending += 1;
                }
            } else {
                missing += 1;
            }
            states.push(json!([source.id, hash, source.acknowledged]));
        }
        let signature = blake3::hash(&serde_json::to_vec(&states).map_err(|e| e.to_string())?)
            .to_hex()
            .to_string();
        let changed = signature != self.signature;
        self.signature = signature;
        Ok((pending, missing, changed))
    }
}
