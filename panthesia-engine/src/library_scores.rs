use crate::{preferences::ScoreVersion, *};
use panthesia_core::library::{self as metadata, SongSidecar};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
fn read_score(path: &Path) -> Result<Vec<u8>, String> {
    let bytes=panthesia_core::utils::atomic_file::read_dependency(path,panthesia_core::source_score_window::ASSET_LIMIT).map_err(|e|e.to_string())?;
    if bytes.len() > panthesia_core::source_score_window::ASSET_LIMIT {
        return Err("谱面超过 64 MiB，请整理或重新导入".into());
    }
    Ok(bytes)
}
fn sidecar(path: &Path, cid: &str) -> Result<SongSidecar, String> {
    match metadata::load_song_sidecar(path, cid) {
        Ok(s) => Ok(s),
        Err(metadata::MetadataError::Read(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(SongSidecar::default())
        }
        Err(e) => Err(e.to_string()),
    }
}
/// The performance file of `cid` at `path` (it must still have that content).
pub(super) fn location(data: &Path, path: &Path, cid: &str) -> Result<(PathBuf, Option<MidiFile>), String> {
    if cid.is_empty() || cid.len() > 160 {
        return Err("曲目身份无效".into());
    }
    let file = crate::music_file::verified_file(data, cid, [path.to_owned()])?;
    Ok((file.source_path.clone().ok_or("曲目没有本地位置")?, Some(file)))
}
pub(super) fn associated_id(path:&Path,cid:&str)->String {
    let key=crate::data_locks::key(path);
    format!("associated-{}",blake3::hash(format!("{cid}\n{}",key.trim_start_matches("//?/")).as_bytes()).to_hex())
}
pub(super) fn versions(
    prefs: &Preferences,
    path: &Path,
    cid: &str,
) -> Result<(Vec<ScoreVersion>, Option<PathBuf>), String> {
    let association = sidecar(path, cid)?.score;
    let active = association
        .as_ref()
        .map(|a| metadata::resolve_score_path(path, a));
    let mut rows = prefs.score_versions.get(cid).cloned().unwrap_or_default();
    if let Some(a) = association {
        let path = metadata::resolve_score_path(path, &a);
        if !rows
            .iter()
            .any(|v| v.path == path && v.content_id == a.content_id)
        {
            rows.push(ScoreVersion {
                id: associated_id(&path,&a.content_id),
                name: crate::notation_assets::display_name(&path),
                path,
                content_id: a.content_id,
            });
        }
    }
    Ok((rows, active))
}

impl Player {
    fn persist_score_registry_with_restore(
        &mut self,
        cid: &str,
        previous: &Option<Vec<ScoreVersion>>,
    ) -> Result<(), String> {
        if let Err(error) = self.preferences.save(&self.preferences_path) {
            if let Some(rows) = previous {
                self.preferences.score_versions.insert(cid.into(), rows.clone());
            } else {
                self.preferences.score_versions.remove(cid);
            }
            return Err(error);
        }
        Ok(())
    }
    fn persist_score_registry_and_associations(
        &mut self,
        cid: &str,
        previous: &Option<Vec<ScoreVersion>>,
        updates: &[(PathBuf, Option<PathBuf>)],
    ) -> Result<(), String> {
        let snapshots: Result<Vec<_>, String> = updates
            .iter()
            .map(|(path, _)| {
                Ok((
                    path.clone(),
                    metadata::metadata_sidecar_path(path).is_file(),
                    sidecar(path, cid)?,
                ))
            })
            .collect();
        let snapshots = match snapshots {
            Ok(snapshots) => snapshots,
            Err(error) => {
                if let Some(rows) = previous {
                    self.preferences.score_versions.insert(cid.into(), rows.clone());
                } else {
                    self.preferences.score_versions.remove(cid);
                }
                return Err(error);
            }
        };
        self.persist_score_registry_with_restore(cid, previous)?;
        for (index, (path, score)) in updates.iter().enumerate() {
            let result = if let Some(score) = score {
                metadata::save_score_association(path, cid, score)
            } else {
                metadata::clear_score_association(path, cid)
            };
            if let Err(error) = result {
                let mut recovery_errors = Vec::new();
                for (old_path, existed, old_sidecar) in snapshots[..=index].iter().rev() {
                    let restored = if *existed {
                        metadata::save_song_sidecar(old_path, cid, old_sidecar.clone())
                            .map(|_| ())
                            .map_err(|e| e.to_string())
                    } else {
                        panthesia_core::utils::atomic_file::discard_or_remove(&metadata::metadata_sidecar_path(old_path))
                            .map_err(|e| e.to_string())
                    };
                    if let Err(restore_error) = restored {
                        recovery_errors.push(restore_error);
                    }
                }
                if let Some(rows) = previous {
                    self.preferences.score_versions.insert(cid.into(), rows.clone());
                } else {
                    self.preferences.score_versions.remove(cid);
                }
                if let Err(restore_error) = self.preferences.save(&self.preferences_path) {
                    recovery_errors.push(restore_error);
                }
                return if recovery_errors.is_empty() {
                    Err(error.to_string())
                } else {
                    Err(format!(
                        "谱面关联失败：{error}；恢复旧资料也失败，请重新读取曲目并检查谱面：{}",
                        recovery_errors.join("；")
                    ))
                };
            }
        }
        Ok(())
    }
    pub(super) fn store_score_version_file(
        &mut self,
        score: &notation::ScoreAsset,
        cid: &str,
    ) -> Result<PathBuf, String> {
        self.store_library_score_bytes(&score.bytes,&score.name,cid)
    }
    fn store_library_score_bytes(&mut self,bytes:&[u8],name:&str,cid:&str)->Result<PathBuf,String>{
        let hash=blake3::hash(bytes).to_hex().to_string();
        let found=self.preferences.score_versions.get(cid).and_then(|rows|rows.iter().find(|v|v.content_id==hash&&v.name==name)).cloned();
        let path=crate::notation_assets::retain(&self.data,bytes)?;
        if let Some(v) = found {
            if v.path != path {
                let row = self.preferences
                    .score_versions
                    .get_mut(cid)
                    .unwrap()
                    .iter_mut()
                    .find(|row| row.id == v.id)
                    .unwrap();
                row.path = path.clone();
                if let Err(error) = self.preferences.save(&self.preferences_path) {
                    self.preferences.score_versions.get_mut(cid).unwrap()
                        .iter_mut().find(|row| row.id == v.id).unwrap().path = v.path;
                    return Err(error);
                }
            }
        }
        Ok(path)
    }
    pub(super) fn add_library_notation(&mut self,path:PathBuf,cid:String,name:String,bytes:Vec<u8>,repair:Option<String>)->Result<Value,String>{
       let (path,_)=location(&self.data,&path,&cid)?;
       let name=name.trim();if name.is_empty()||name.chars().count()>120{return Err("谱面名称需为 1 至 120 字".into());}
       if bytes.len()>panthesia_core::source_score_window::ASSET_LIMIT{return Err("演奏乐谱超过 64 MiB".into());}
       let hash=blake3::hash(&bytes).to_hex().to_string();let (mut rows,active)=versions(&self.preferences,&path,&cid)?;
       let mut old_path=None;
       let (name,existing)=if let Some(id)=repair {let v=rows.iter().find(|v|v.id==id).ok_or("待修复版本不存在")?;if v.content_id!=hash{return Err("文件内容与原版本不符；请选择原文件修复，或添加为新版本".into());}old_path=Some(v.path.clone());(v.name.clone(),Some(v.id.clone()))}else{(name.to_owned(),rows.iter().find(|v|v.name==name&&v.content_id==hash).map(|v|v.id.clone()))};
       if old_path.is_none(){old_path=existing.as_ref().and_then(|id|rows.iter().find(|v|&v.id==id).map(|v|v.path.clone()));}
       if existing.is_none()&&rows.len()>=100{return Err("这首曲目已有 100 份演奏乐谱，请先整理版本".into());}
       let previous=self.preferences.score_versions.get(&cid).cloned();
       let result=(|| -> Result<Value,String> {
           self.preferences.score_versions.insert(cid.clone(),rows.clone());
           let stored=self.store_library_score_bytes(&bytes,&name,&cid)?;
           // The helper can migrate an unavailable external version to an owned copy.
           rows=self.preferences.score_versions.get(&cid).cloned().unwrap_or_default();
           let id=existing.unwrap_or_else(||format!("library-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
           if let Some(v)=rows.iter_mut().find(|v|v.id==id){v.path=stored.clone();}else{rows.push(ScoreVersion{id:id.clone(),name,path:stored.clone(),content_id:hash});}
           if old_path.as_ref().is_some_and(|p|active.as_ref()==Some(p)) {metadata::save_score_association(&path,&cid,&stored).map_err(|e|e.to_string())?;}
           self.preferences.score_versions.insert(cid.clone(),rows);self.preferences.save(&self.preferences_path)?;
           Ok(json!({"id":id,"updated":true}))
       })();
       if result.is_err(){
           if let Some(previous)=previous{self.preferences.score_versions.insert(cid,previous);}
           else{self.preferences.score_versions.remove(&cid);}
       }
       result
    }


    pub(crate) fn pair_score_asset(&mut self, score: notation::ScoreAsset) -> Result<Value, String> {
        let content_id = score.content_id.clone();
        self.score_content_guard(&content_id)?;
        self.remember_active_score()?;
        if self.preferences.score_versions.get(&content_id).is_some_and(|rows| {
            rows.len() >= 100 && !rows.iter().any(|v| v.name == score.name && v.content_id == score.source_fingerprint)
        }) {
            return Err("这首曲目已有 100 份谱面，请先移除不需要的版本".into());
        }
        let file = self.file.as_ref().ok_or("请先打开 MIDI")?;
        if file.content_id != content_id {
            return Err("曲目已切换，请重新配对乐谱".into());
        }
        self.state.error = None;
        self.panic();
        self.state.status = "paused".into();
        let path = self.store_score_version_file(&score, &content_id)?;
        let file = self.file.as_ref().ok_or("请先打开 MIDI")?;
        metadata::save_score_association(&self.annotation_path(file)?, &content_id, &path).map_err(|e| e.to_string())?;
        self.notation = Some(std::sync::Arc::new(score));
        self.score_revision = self.score_revision.wrapping_add(1);
        self.remember_active_score()?;
        self.command(Command::Score)
    }
}
