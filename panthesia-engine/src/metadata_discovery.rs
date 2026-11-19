//! Bounded metadata discovery cache. Finding files never applies song annotations.
use crate::library_workspace::key;
use panthesia_core::{synthesia_metadata, utils::atomic_file};
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, BTreeSet}, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};

const MAX_FILES: usize = 128;
const PARSE_BUDGET: u64 = 16_000_000;
const INDEX: &str = "synthesia-discovery.json";
fn source_key(path:&Path)->String {key(path).trim_start_matches("//?/").to_owned()}
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Stamp { size: u64, modified: u128 }
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Record {
    path: PathBuf,
    stamp: Stamp,
    source_id: Option<String>,
    song_ids: Vec<String>,
    pending: bool,
    error: Option<String>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Catalog { version: u8, updated_at: u64, files: BTreeMap<String, Record>, errors: Vec<String> }
impl Default for Catalog {
    fn default() -> Self { Self {version:1, updated_at:0, files:BTreeMap::new(),errors:vec![]} }
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct MetadataSourceCandidate {
    pub path: PathBuf,
    pub name: String,
    pub source_id: Option<String>,
    pub size: u64,
    pub songs: usize,
    pub matched_paths: Vec<PathBuf>,
    pub applied: usize,
    pub updates: usize,
    pub pending: bool,
    pub error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct MetadataDiscovery {
    pub updated_at: u64,
    pub files: Vec<MetadataSourceCandidate>,
    pub errors: Vec<String>,
}
fn read_catalog(data: &Path) -> Result<Catalog,String> {
    match atomic_file::read_hint(&data.join(INDEX),64_000_000) {
        Ok(bytes) => {
            let value: Catalog=serde_json::from_slice(&bytes).map_err(|e|format!("来源索引无法读取：{e}"))?;
            if value.version!=1 || value.files.len()>MAX_FILES || value.files.values().any(|r|
                r.song_ids.len()>10_000 || r.song_ids.windows(2).any(|ids|ids[0]>=ids[1])) {
                return Err("来源索引版本或容量无效，请重新扫描曲库".into());
            }
            Ok(value)
        },
        Err(e) if e.kind()==std::io::ErrorKind::NotFound => Ok(Catalog::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn stamp(path:&Path)->Result<Stamp,String> {
    let value=std::fs::metadata(path).map_err(|e|e.to_string())?;
    if !value.is_file() {return Err("来源不是文件".into());}
    Ok(Stamp {size:value.len(),modified:value.modified().ok().and_then(|t|t.duration_since(UNIX_EPOCH).ok()).map_or(0,|d|d.as_nanos())})
}
fn inspect(path:PathBuf, before:Stamp, budget:&mut u64, check:&impl Fn()->Result<(),String>)->Result<Record,String> {
    check()?;
    let mut row=Record {path:path.clone(),stamp:before.clone(),source_id:None,song_ids:vec![],pending:false,error:None};
    if before.size>synthesia_metadata::MAX_BYTES as u64 { row.error=Some("资料文件超过 2 MB".into());return Ok(row); }
    if before.size>*budget {row.pending=true;return Ok(row);}
    *budget-=before.size;
    let result=(|| {
        let bytes=atomic_file::read_hint(&path,synthesia_metadata::MAX_BYTES).map_err(|e|e.to_string())?;
        let document=synthesia_metadata::parse(&bytes)?;
        check()?;
        if stamp(&path)?!=before {return Err("来源正在写入，请稍后重新查找".into());}
        Ok::<_,String>((blake3::hash(&bytes).to_hex().to_string(),document.songs.into_iter().map(|song|song.unique_id).collect()))
    })();
    match result {Ok((id,songs))=>{row.source_id=Some(id);row.song_ids=songs;row.song_ids.sort();},Err(error)=>row.error=Some(error)}
    Ok(row)
}
/// Only immediate children: recursive registered folders are already walked by the MIDI monitor.
fn direct_sources(root:&Path, paths:&mut Vec<PathBuf>, errors:&mut Vec<String>) {
    match std::fs::read_dir(root) {
        Ok(entries)=>for entry in entries {
            if paths.len()>MAX_FILES {break;}
            match entry {
                Ok(entry) if entry.file_type().is_ok_and(|kind|kind.is_file()&&!kind.is_symlink()) &&
                    entry.path().extension().is_some_and(|e|e.eq_ignore_ascii_case("synthesia"))=>paths.push(entry.path()),
                Err(e)=>{if errors.len()<20 {errors.push(format!("{}：{e}",root.display()));}},
                _=>{},
            }
        },
        Err(e)=>{if errors.len()<20 {errors.push(format!("{}：{e}",root.display()));}},
    }
}
#[derive(Default)]
pub struct Scanner { catalog: Option<Catalog>, dirty:bool }
impl Scanner {
    pub fn scan(&mut self,data:&Path,mut paths:Vec<PathBuf>,root:&Path,mut errors:Vec<String>,check:impl Fn()->Result<(),String>)->Result<(usize,usize,bool),String> {
        check()?;
        direct_sources(root,&mut paths,&mut errors);
        paths.sort_by_key(|p|source_key(p));paths.dedup_by(|a,b|source_key(a)==source_key(b));
        if paths.len()>MAX_FILES {errors.push("来源文件超过 128 份，请按更具体的曲库目录整理；超出部分仍可手动选择导入".into());paths.truncate(MAX_FILES);}
        let old=self.catalog.get_or_insert_with(||read_catalog(data).unwrap_or_default());
        let mut changed=old.errors!=errors;
        old.errors=errors;
        let mut seen=BTreeSet::new();
        let mut budget=PARSE_BUDGET;
        for path in paths {
            check()?;
            let k=source_key(&path);
            seen.insert(k.clone());
            let row=match stamp(&path) {
                Ok(stamp)=>match old.files.get(&k).filter(|r|r.stamp==stamp&&!r.pending) {
                    Some(_)=>continue,
                    None=>inspect(path,stamp,&mut budget,&check)?,
                },
                Err(error)=>Record{path,stamp:Stamp::default(),source_id:None,song_ids:vec![],pending:false,error:Some(error)},
            };
            if old.files.get(&k)!=Some(&row) {old.files.insert(k,row);changed=true;}
        }
        let previous=old.files.len();old.files.retain(|key,_|seen.contains(key));changed|=previous!=old.files.len();
        if changed {old.updated_at=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u64::MAX as u128) as u64;}
        check()?;
        self.dirty|=changed || !data.join(INDEX).is_file();
        if self.dirty {
            let bytes=serde_json::to_vec(old).map_err(|e|e.to_string())?;
            atomic_file::write(&data.join(INDEX),&bytes).map_err(|e|e.to_string())?;
            self.dirty=false;
        }
        Ok((old.files.len(),old.files.values().filter(|r|r.pending).count(),changed))
    }
}
fn allowed(data:&Path,source:&Path,paths:&[PathBuf])->Result<bool,String> {
    if !source.extension().is_some_and(|e|e.eq_ignore_ascii_case("synthesia")) {return Ok(false);}
    let source=std::fs::canonicalize(source).map_err(|e|format!("来源暂不可用：{e}"))?;
    let parent=source.parent();
    if paths.iter().filter_map(|p|p.parent()).filter_map(|p|std::fs::canonicalize(p).ok()).any(|p|Some(p.as_path())==parent) {return Ok(true);}
    for root in crate::library::folders(data)? {
        if std::fs::canonicalize(root).is_ok_and(|root|source.starts_with(root)) {return Ok(true);}
    }
    let catalog=crate::library::catalog_root();
    Ok(std::fs::canonicalize(catalog).is_ok_and(|root|Some(root.as_path())==parent))
}
pub fn read_source(data:&Path,source:&Path,source_id:&str,paths:&[PathBuf],check:&impl Fn()->Result<(),String>)->Result<Vec<u8>,String> {
    check()?;
    if paths.is_empty()||paths.len()>64||!allowed(data,source,paths)? {return Err("来源不在当前曲库或所选曲目目录中，请重新查找或手动选择文件".into());}
    let bytes=atomic_file::read_dependency(source,synthesia_metadata::MAX_BYTES).map_err(|e|format!("来源无法读取：{e}"))?;
    if blake3::hash(&bytes).to_hex().as_str()!=source_id {return Err("资料文件已变化，请重新查找并选择来源，再预览导入".into());}
    check()?;
    Ok(bytes)
}
pub fn discover(data:&Path,paths:&[PathBuf],refresh:bool,check:&impl Fn()->Result<(),String>)->Result<MetadataDiscovery,String> {
    discover_scoped(data,paths,refresh,&crate::library::folders(data)?,&crate::library::catalog_root(),check)
}
fn discover_scoped(data:&Path,paths:&[PathBuf],refresh:bool,roots:&[PathBuf],catalog_root:&Path,check:&impl Fn()->Result<(),String>)->Result<MetadataDiscovery,String> {
    if paths.is_empty()||paths.len()>64 {return Err("请先选择 1～64 首 MIDI".into());}
    let mut catalog=read_catalog(data)?;
    let mut candidates=vec![];
    if refresh {
        for root in roots {
            check()?;
            match crate::library::scan_metadata_until(&root,check) {
                Ok(found)=>candidates.extend(found),
                Err(error)=>catalog.errors.push(format!("{}：{error}",root.display())),
            }
        }
        direct_sources(catalog_root,&mut candidates,&mut catalog.errors);
    }
    let mut parents=BTreeSet::new();
    let mut selected=Vec::new();
    let mut total=0;
    for path in paths {
        check()?;
        let bytes=atomic_file::read_hint(path,32_000_000).map_err(|e|format!("所选 MIDI 无法读取 {}：{e}",path.display()))?;
        total+=bytes.len();if total>128_000_000 {return Err("所选 MIDI 总大小超过 128 MB，请分批核对".into());}
        let cid=blake3::hash(&bytes).to_hex().to_string();
        let layers=match panthesia_core::library::load_song_sidecar(path,&cid) {
            Ok(value)=>value.metadata_layers,
            Err(panthesia_core::library::MetadataError::Read(e)) if e.kind()==std::io::ErrorKind::NotFound=>None,
            Err(e)=>return Err(e.to_string()),
        };
        selected.push((path,synthesia_metadata::music_identity(&bytes),layers));
        if let Some(parent)=path.parent() {parents.insert(parent.to_path_buf());}
    }
    for parent in parents {check()?;direct_sources(&parent,&mut candidates,&mut catalog.errors);}
    candidates.sort_by_key(|path|source_key(path));candidates.dedup_by(|a,b|source_key(a)==source_key(b));
    let mut budget=PARSE_BUDGET;
    for path in candidates {
        let st=match stamp(&path) {Ok(st)=>st,Err(_)=>continue};
        let k=source_key(&path);
        if refresh || catalog.files.get(&k).is_none_or(|r|r.stamp!=st||r.pending||r.error.is_some()) {
            if catalog.files.len()>=MAX_FILES&&!catalog.files.contains_key(&k) {catalog.errors.push("目录中还有其他来源，请细分范围或手动选择文件".into());break;}
            catalog.files.insert(k,inspect(path,st,&mut budget,check)?);
        }
    }
    let mut files=Vec::new();
    for mut record in catalog.files.into_values() {
        check()?;
        // Removed folder registrations and missing sources are never offered as usable snapshots.
        if !allowed(data,&record.path,paths).unwrap_or(false) {continue;}
        if stamp(&record.path).is_ok_and(|current|current!=record.stamp) {
            record=inspect(record.path.clone(),stamp(&record.path)?,&mut budget,check)?;
        }
        let matching=selected.iter().filter(|(_,id,_)|record.song_ids.binary_search(id).is_ok()).collect::<Vec<_>>();
        let applied=matching.iter().filter(|(_,_,layers)|layers.as_ref().is_some_and(|l|Some(&l.source_id)==record.source_id.as_ref())).count();
        let updates=matching.iter().filter(|(_,_,layers)|layers.as_ref().is_some_and(|l|Some(&l.source_id)!=record.source_id.as_ref())).count();
        files.push(MetadataSourceCandidate {name:record.path.file_name().unwrap_or_default().to_string_lossy().into(),
            path:record.path,source_id:record.source_id,size:record.stamp.size,songs:record.song_ids.len(),
            matched_paths:matching.iter().map(|(path,_,_)|(*path).clone()).collect(),applied,updates,pending:record.pending,error:record.error});
    }
    files.sort_by(|a,b|b.matched_paths.len().cmp(&a.matched_paths.len()).then(a.path.cmp(&b.path)));
    catalog.errors.truncate(20);
    Ok(MetadataDiscovery{updated_at:catalog.updated_at,files,errors:catalog.errors})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    fn fixture()->(PathBuf,PathBuf,PathBuf,Vec<u8>) {
        let root=std::env::temp_dir().join(format!("panthesia-source-discovery-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let library=root.join("library");let data=root.join("data");
        std::fs::create_dir_all(library.join("资料")).unwrap();std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("library-folders.json"),serde_json::to_vec(&vec![&library]).unwrap()).unwrap();
        let midi=include_bytes!("../assets/five-finger.mid").to_vec();
        let path=library.join("practice.mid");std::fs::write(&path,&midi).unwrap();
        let source=library.join("资料/课程.synthesia");
        let xml=format!(r#"<SynthesiaMetadata Version="1"><Songs><Song UniqueId="{}" Title="来源标题" Composer="作者"/><Song UniqueId="AAAAAAAAAAAAAAAAAAAAAA==" Title="另一首"/></Songs></SynthesiaMetadata>"#,synthesia_metadata::music_identity(&midi)).into_bytes();
        std::fs::write(&source,&xml).unwrap();
        (data,path,source,xml)
    }
    #[test]
    fn cached_discovery_matches_bytes_keeps_errors_and_tracks_applied_sources() {
        let (data,path,source,xml)=fixture();
        let folder=path.parent().unwrap();
        std::fs::write(folder.join("损坏.synthesia"),b"not XML").unwrap();
        let (songs,sources)=crate::library::scan_folder_contents_until(folder,||Ok(())).unwrap();
        assert_eq!(songs.len(),1);assert_eq!(sources.len(),2);
        let mut scanner=Scanner::default();
        assert!(scanner.scan(&data,sources.clone(),folder,vec![],||Ok(())).unwrap().2);
        assert!(!scanner.scan(&data,sources,folder,vec![],||Ok(())).unwrap().2);
        let discovered=discover(&data,std::slice::from_ref(&path),false,&||Ok(())).unwrap();
        assert_eq!(discovered.files.len(),2);
        let found=&discovered.files[0];
        assert_eq!(found.path,source);assert_eq!(found.matched_paths,[path.clone()]);assert_eq!(found.applied,0);
        assert!(discovered.files.iter().any(|r|r.error.is_some()));
        let id=blake3::hash(&xml).to_hex().to_string();
        let parsed=synthesia_metadata::parse(&xml).unwrap().songs[0].metadata().unwrap();
        let layers=panthesia_core::metadata_layers::MetadataLayers::import(&Default::default(),None,parsed,id.clone(),&[]);
        let sidecar=panthesia_core::library::SongSidecar{metadata:layers.defaults.clone(),metadata_layers:Some(layers),..Default::default()};
        panthesia_core::library::save_song_sidecar(&path,&blake3::hash(include_bytes!("../assets/five-finger.mid")).to_hex(),sidecar).unwrap();
        assert_eq!(discover(&data,std::slice::from_ref(&path),false,&||Ok(())).unwrap().files[0].applied,1);
        let changed=[xml.clone(),b" ".to_vec()].concat();std::fs::write(&source,&changed).unwrap();
        let next=discover(&data,std::slice::from_ref(&path),false,&||Ok(())).unwrap();
        assert_eq!(next.files[0].updates,1);assert_eq!(next.files[0].applied,0);
        assert!(read_source(&data,&source,&id,std::slice::from_ref(&path),&||Ok(())).is_err());
        std::fs::remove_file(source).unwrap();
        assert!(discover(&data,&[path],false,&||Ok(())).unwrap().files.iter().all(|r|r.matched_paths.is_empty()));
    }
    #[test]
    fn discovered_source_is_a_publication_dependency_and_scope_is_enforced() {
        let (data,path,source,xml)=fixture();
        let paths=vec![path.clone()];let id=blake3::hash(&xml).to_hex().to_string();
        let options=crate::synthesia_import::ImportOptions::default();
        let preview=crate::synthesia_import::preview(&data,xml.clone(),paths.clone(),options.clone(),&||Ok(())).unwrap();
        let selected=data.clone();
        let (result,writes,observed)=atomic_file::capture_matching(Arc::new(move|path|crate::asset_storage::captures(&selected,path)),|| {
            let bytes=read_source(&data,&source,&id,&paths,&||Ok(()))?;
            crate::synthesia_import::apply(&data,bytes,paths.clone(),options,preview["proof"].as_str().unwrap().into(),&||Ok(()))
        });
        assert!(result.is_ok());assert!(observed.iter().any(|o|o.path==source));
        std::fs::write(&source,[xml,b" ".to_vec()].concat()).unwrap();
        assert!(crate::asset_storage::commit(&data,writes,observed).is_err());
        assert!(!panthesia_core::library::metadata_sidecar_path(&path).exists());
        let outside=data.join("outside.synthesia");std::fs::write(&outside,b"outside").unwrap();
        assert!(read_source(&data,&outside,&id,&paths,&||Ok(())).is_err());
        assert!(discover(&data,&paths,false,&||Err("cancelled".into())).is_err());
        let bytes=std::fs::read(&source).unwrap();
        let source_id=blake3::hash(&bytes).to_hex().to_string();
        let options=crate::synthesia_import::ImportOptions::default();
        let preview=crate::synthesia_import::preview(&data,bytes,paths.clone(),options.clone(),&||Ok(())).unwrap();
        let command=||crate::Command::ImportDiscoveredSynthesiaMetadata{source_path:source.clone(),source_id:source_id.clone(),paths:paths.clone(),
            options:options.clone(),expected:preview["proof"].as_str().unwrap().into()};
        let selected=data.clone();
        let (result,writes,observed)=atomic_file::capture_matching(Arc::new(move|path|crate::asset_storage::captures(&selected,path)),|| {
            crate::library_edits::execute(command(),&data,&||Ok(()))
        });
        let saved=result.unwrap();crate::asset_storage::commit(&data,writes,observed).unwrap();
        std::fs::remove_file(&source).unwrap();
        assert_eq!(crate::library_edits::execute(command(),&data,&||Ok(())).unwrap(),saved);
    }
}

#[cfg(test)]
mod refresh_tests {
    use super::*;
    #[test]
    fn manual_refresh_finds_nested_sources_without_a_background_index() {
        let root=std::env::temp_dir().join(format!("panthesia-discovery-refresh-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let data=root.join("data");let library=root.join("library");
        std::fs::create_dir_all(&data).unwrap();std::fs::create_dir_all(library.join("nested")).unwrap();
        let midi=include_bytes!("../assets/five-finger.mid");let path=library.join("practice.mid");std::fs::write(&path,midi).unwrap();
        std::fs::write(data.join("library-folders.json"),serde_json::to_vec(&vec![&library]).unwrap()).unwrap();
        let source=library.join("nested/refresh.synthesia");
        std::fs::write(&source,format!(r#"<SynthesiaMetadata Version="1"><Songs><Song UniqueId="{}" Title="手动查找"/></Songs></SynthesiaMetadata>"#,synthesia_metadata::music_identity(midi))).unwrap();
        assert!(discover(&data,std::slice::from_ref(&path),false,&||Ok(())).unwrap().files.is_empty());
        let found=discover_scoped(&data,std::slice::from_ref(&path),true,std::slice::from_ref(&library),&library,&||Ok(())).unwrap();
        assert_eq!(found.files.len(),1);assert_eq!(found.files[0].matched_paths,[path]);
        assert_eq!(found.files[0].path,source);
        assert!(!data.join(INDEX).exists()); // Read-only requests do not replace the monitor's cache.
    }
}
