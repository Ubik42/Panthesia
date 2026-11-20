//! Content-owned MIDI assets and the authoritative song/performance/location directory.
//! The old repertoire JSON is an import/export format; normal edits commit here.
mod archive;
use crate::library::SongRow;
use panthesia_core::repertoire::{MusicalWork, PerformanceEdition, RepertoireRegistry};
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

pub struct SongRepository {
    data: PathBuf,
    db: Connection,
}
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct DirectorySnapshot {
    pub registry: RepertoireRegistry,
    pub locked: Vec<String>,
}
fn error(e: impl std::fmt::Display) -> String {
    format!("歌曲资料库：{e}")
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn key(path: &Path) -> String {
    crate::library_workspace::key(path)
        .trim_start_matches("//?/")
        .to_string()
}
// Positive byte identities are reused only while the file stamp is unchanged.
// Captured preparations always read their observed bytes, including deferred imports.
fn verified_source(path:&Path,cid:&str)->bool{
    if !panthesia_core::utils::atomic_file::is_file(path){return false;}
    if panthesia_core::utils::atomic_file::is_capturing(path){return crate::import_storage::matches_content(path,cid).unwrap_or(false);}
    type Stamp=(u64,Option<SystemTime>,Option<SystemTime>);
    static VERIFIED:std::sync::OnceLock<std::sync::Mutex<std::collections::BTreeMap<(String,String),Stamp>>>=std::sync::OnceLock::new();
    let Ok(metadata)=std::fs::metadata(path)else{return false;};if !metadata.is_file(){return false;}
    let stamp=(metadata.len(),metadata.modified().ok(),metadata.created().ok());let cache=VERIFIED.get_or_init(Default::default);let cache_key=(key(path),cid.to_owned());
    if cache.lock().is_ok_and(|cache|cache.get(&cache_key)==Some(&stamp)){return true;}
    if !crate::import_storage::matches_content(path,cid).unwrap_or(false){return false;}
    if let Ok(mut cache)=cache.lock(){if cache.len()>=4096{cache.clear();}cache.insert(cache_key,stamp);}
    true
}
impl SongRepository {
    pub fn open(data: &Path) -> Result<Self, String> {
        let directory = data.join("library");
        std::fs::create_dir_all(&directory).map_err(error)?;
        let db = Connection::open(directory.join("songs.sqlite3")).map_err(error)?;
        let version: u32 = db
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(error)?;
        if version > 1 {
            return Err(format!("歌曲资料库版本 {version} 暂不支持，数据保持原状"));
        }
        db.busy_timeout(std::time::Duration::from_secs(3))
            .map_err(error)?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS songs(id TEXT PRIMARY KEY,title TEXT NOT NULL,composer TEXT NOT NULL,catalogue TEXT NOT NULL DEFAULT '');
   CREATE TABLE IF NOT EXISTS performances(id TEXT PRIMARY KEY,song_id TEXT NOT NULL REFERENCES songs(id),label TEXT NOT NULL,group_locked INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS locations(path_key TEXT PRIMARY KEY,path TEXT NOT NULL,performance_id TEXT NOT NULL REFERENCES performances(id),last_seen INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS locations_performance ON locations(performance_id);
   CREATE TABLE IF NOT EXISTS assets(content_id TEXT PRIMARY KEY,path TEXT NOT NULL,bytes INTEGER NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS notation_editions(id TEXT PRIMARY KEY,document TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS catalog_rows(content_id TEXT PRIMARY KEY,row_json TEXT NOT NULL);
   PRAGMA user_version=1;").map_err(error)?;
        let mut result = Self {
            data: data.into(),
            db,
        };
        result.import_legacy()?;
        result.import_workspace_locations()?;
        crate::portable_song::recover(data,&mut result)?;
        Ok(result)
    }
    pub fn managed_path(data: &Path, cid: &str) -> Result<PathBuf, String> {
        if !valid_id(cid) {
            return Err("演奏内容身份无效".into());
        }
        Ok(data.join("library/assets/midi").join(format!("{cid}.mid")))
    }
    fn import_legacy(&mut self) -> Result<(), String> {
        let path = self.data.join("repertoire.json");
        let metadata = match std::fs::metadata(&path) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(error(e)),
        };
        let stamp = format!("{}:{:?}", metadata.len(), metadata.modified().ok());
        let previous_stamp: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM settings WHERE key='legacy_repertoire_stamp'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)?;
        if previous_stamp.as_deref() == Some(&stamp) {
            return Ok(());
        }
        let bytes = match panthesia_core::utils::atomic_file::read_limited(&path, 64_000_000) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(error(e)),
        };
        let hash = blake3::hash(&bytes).to_hex().to_string();
        let previous: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM settings WHERE key='legacy_repertoire_hash'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)?;
        if previous.as_deref() == Some(&hash) {
            self.db.execute("INSERT INTO settings(key,value) VALUES('legacy_repertoire_stamp',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[stamp]).map_err(error)?;
            return Ok(());
        }
        let registry: RepertoireRegistry = serde_json::from_slice(&bytes).map_err(error)?;
        registry.validate()?;
        // Preserve the exact old input before recording its first successful migration.
        let archive = self.data.join("library/legacy-inputs");
        std::fs::create_dir_all(&archive).map_err(error)?;
        let backup = archive.join(format!("repertoire-{hash}.json"));
        if !backup.exists() {
            panthesia_core::utils::atomic_file::write_new(&backup, &bytes).map_err(error)?;
        }
        let tx = self.db.transaction().map_err(error)?;
        // Legacy changes can contribute previously unseen records and source locations.
        // Current song membership, names and edition decisions remain authoritative.
        let mut merged=read_registry(&tx)?;
        let mut known_locations=merged.performances.values().flat_map(|p|p.locations.iter().map(|p|key(Path::new(p)))).collect::<std::collections::BTreeSet<_>>();
        for (id,work)in registry.works{merged.works.entry(id).or_insert(work);}
        for (id,mut incoming)in registry.performances{
            incoming.locations.retain(|path|known_locations.insert(key(Path::new(path))));
            if let Some(current)=merged.performances.get_mut(&id){current.locations.extend(incoming.locations);}else{merged.performances.insert(id,incoming);}
        }
        for (id,notation)in registry.notations{merged.notations.entry(id).or_insert(notation);}
        merged.validate()?;
        write_registry(&tx, &merged)?;
        tx.execute("INSERT INTO settings(key,value) VALUES('legacy_repertoire_hash',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[hash]).map_err(error)?;
        tx.execute("INSERT INTO settings(key,value) VALUES('legacy_repertoire_stamp',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[stamp]).map_err(error)?;
        tx.commit().map_err(error)
    }
    fn import_workspace_locations(&mut self) -> Result<(), String> {
        let imported: bool = self
            .db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM settings WHERE key='legacy_catalog_rows_imported')",
                [],
                |r| r.get(0),
            )
            .map_err(error)?;
        if imported {
            return Ok(());
        }
        let path = self.data.join("library-workspace.json");
        let bytes = match panthesia_core::utils::atomic_file::read_limited(&path, 64_000_000) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(error(e)),
        };
        let workspace: crate::library_workspace::Workspace =
            serde_json::from_slice(&bytes).map_err(error)?;
        let hash = blake3::hash(&bytes).to_hex().to_string();
        let archive = self.data.join("library/legacy-inputs");
        std::fs::create_dir_all(&archive).map_err(error)?;
        let backup = archive.join(format!("workspace-{hash}.json"));
        if !backup.exists() {
            panthesia_core::utils::atomic_file::write_new(&backup, &bytes).map_err(error)?;
        }
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(error)?;
        let mut registry = read_registry(&tx)?;
        for entry in workspace
            .entries
            .values()
            .chain(workspace.retired_entries.values())
        {
            if let Some(cid) = &entry.content_id {
                registry.register(
                    cid,
                    entry.metadata.title.as_deref().unwrap_or_else(|| {
                        entry
                            .path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("未命名作品")
                    }),
                    entry.metadata.composer.as_deref().unwrap_or(""),
                    Some(entry.path.to_string_lossy().into()),
                );
                if valid_id(cid)
                    && !workspace
                        .ignored_paths
                        .contains(&crate::library_repairs::record_key(cid, &entry.path))
                    && crate::library_repairs::link_target(&workspace, cid, &entry.path).is_none()
                {
                    let row = SongRow {
                        id: format!("owned/{cid}"),
                        title: entry.metadata.title.clone().unwrap_or_else(|| {
                            entry
                                .path
                                .file_stem()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .into()
                        }),
                        composer: entry.metadata.composer.clone().unwrap_or_default(),
                        arranger: entry.metadata.arranger.clone(),
                        source: "我的曲目".into(),
                        category: entry.metadata.collection.clone().unwrap_or_default(),
                        license: "本地文件".into(),
                        source_url: String::new(),
                        path: entry.path.clone(),
                        content_id: Some(cid.clone()),
                        tags: entry.metadata.tags.clone(),
                        difficulty: entry.metadata.difficulty.clone(),
                        rating: entry.rating,
                    };
                    tx.execute("INSERT INTO catalog_rows(content_id,row_json) VALUES(?1,?2) ON CONFLICT(content_id) DO NOTHING",params![cid,serde_json::to_string(&row).map_err(error)?]).map_err(error)?;
                }
            }
        }
        registry.validate()?;
        write_registry(&tx, &registry)?;
        tx.execute("INSERT INTO settings(key,value) VALUES('legacy_workspace_imported',?1) ON CONFLICT(key) DO NOTHING",[hash]).map_err(error)?;
        tx.execute("INSERT INTO settings(key,value) VALUES('legacy_catalog_rows_imported','complete') ON CONFLICT(key) DO NOTHING",[]).map_err(error)?;
        tx.commit().map_err(error)
    }
    pub fn registry(&self) -> Result<RepertoireRegistry, String> {
        let tx = self.db.unchecked_transaction().map_err(error)?;
        let registry = read_registry(&tx)?;
        tx.commit().map_err(error)?;
        Ok(registry)
    }
    pub fn snapshot(&self) -> Result<(RepertoireRegistry, String), String> {
        let registry = self.registry()?;
        let revision = registry_revision(&registry)?;
        Ok((registry, revision))
    }
    pub fn revision(&self) -> Result<String, String> {
        registry_revision(&self.registry()?)
    }
    pub(crate) fn export_directory(&self) -> Result<DirectorySnapshot, String> {
        let tx = self.db.unchecked_transaction().map_err(error)?;
        let registry = read_registry(&tx)?;
        let locked = {
            let mut q = tx
                .prepare("SELECT id FROM performances WHERE group_locked=1 ORDER BY id")
                .map_err(error)?;
            q.query_map([], |r| r.get::<_, String>(0))
                .map_err(error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(error)?
        };
        tx.commit().map_err(error)?;
        Ok(DirectorySnapshot { registry, locked })
    }
    /// Used by the existing restore journal. Assets are immutable and remain available.
    pub(crate) fn restore_directory(&mut self, snapshot: &DirectorySnapshot) -> Result<(), String> {
        snapshot.registry.validate()?;
        if snapshot
            .locked
            .iter()
            .any(|id| !snapshot.registry.performances.contains_key(id))
        {
            return Err("歌曲恢复快照的分组记录无效".into());
        }
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(error)?;
        tx.execute_batch("DELETE FROM notation_editions;DELETE FROM locations;DELETE FROM performances;DELETE FROM songs;").map_err(error)?;
        write_registry(&tx, &snapshot.registry)?;
        for id in &snapshot.locked {
            tx.execute("UPDATE performances SET group_locked=1 WHERE id=?1", [id])
                .map_err(error)?;
        }
        tx.commit().map_err(error)
    }
    pub fn save_registry(
        &mut self,
        registry: &RepertoireRegistry,
        expected: &str,
        lock_group: Option<&str>,
    ) -> Result<(), String> {
        registry.validate()?;
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(error)?;
        if registry_revision(&read_registry(&tx)?)? != expected {
            return Err("歌曲资料已更新，请重新读取后保存".into());
        }
        write_registry(&tx, registry)?;
        if let Some(cid) = lock_group {
            tx.execute("UPDATE performances SET group_locked=1 WHERE id=?1", [cid])
                .map_err(error)?;
        }
        tx.execute(
            "DELETE FROM songs WHERE NOT EXISTS(SELECT 1 FROM performances WHERE song_id=songs.id)",
            [],
        )
        .map_err(error)?;
        tx.commit().map_err(error)
    }
    /// Publish immutable bytes first. Cancellation may leave an unreferenced asset, never an empty DB reference.
    pub fn retain(
        &mut self,
        source: &Path,
        cid: &str,
        title: &str,
        composer: &str,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<PathBuf, String> {
        self.retain_with_parts(source, cid, title, composer, None, check)
    }
    pub fn retain_with_parts(
        &mut self,
        source: &Path,
        cid: &str,
        title: &str,
        composer: &str,
        parts: Option<&std::collections::BTreeMap<usize, panthesia_core::practice::PracticePart>>,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<PathBuf, String> {
        self.retain_with_origin(source,cid,title,composer,parts,source,check)
    }
    pub(crate) fn retain_with_origin(
        &mut self,
        source: &Path,
        cid: &str,
        title: &str,
        composer: &str,
        parts: Option<&std::collections::BTreeMap<usize, panthesia_core::practice::PracticePart>>,
        annotation_origin:&Path,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<PathBuf, String> {
        check()?;
        let bytes = panthesia_core::utils::atomic_file::read_dependency(source, 32_000_000)
            .map_err(error)?;
        if blake3::hash(&bytes).to_hex().as_str() != cid {
            return Err("保存演奏副本时内容已改变".into());
        }
        let managed = publish_asset(&Self::managed_path(&self.data, cid)?, &bytes, cid)?;
        check()?;
        self.import_annotations(annotation_origin, &managed, cid, parts, None)?;
        panthesia_core::song_annotations::bind_legacy_bytes(&managed,cid,&bytes,check).map_err(error)?;
        let project = project_identity(source)?;
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(error)?;
        let existing: Option<String> = tx
            .query_row("SELECT song_id FROM performances WHERE id=?1", [cid], |r| {
                r.get(0)
            })
            .optional()
            .map_err(error)?;
        let locked: bool = tx
            .query_row(
                "SELECT group_locked FROM performances WHERE id=?1",
                [cid],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)?
            .unwrap_or(false);
        let project = if locked
            || existing
                .as_ref()
                .is_some_and(|id| id != &format!("work-{cid}"))
        {
            None
        } else {
            project
        };
        let work_id = project
            .as_ref()
            .map(|p| p.0.clone())
            .or(existing)
            .unwrap_or_else(|| format!("work-{cid}"));
        let work_title = project.as_ref().map(|p| p.1.as_str()).unwrap_or(title);
        let work_title = if work_title.trim().is_empty() {
            "未命名作品".into()
        } else {
            work_title
                .chars()
                .filter(|c| !c.is_control())
                .take(200)
                .collect::<String>()
        };
        let composer = composer
            .chars()
            .filter(|c| !c.is_control())
            .take(160)
            .collect::<String>();
        tx.execute(
            "INSERT INTO songs(id,title,composer) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET title=CASE WHEN songs.title='未命名作品' THEN excluded.title ELSE songs.title END",
            params![work_id, work_title, composer],
        )
        .map_err(error)?;
        // Explicit project manifests can relate variants; a filename alone never joins songs.
        if project.is_some() {
            tx.execute("INSERT INTO performances(id,song_id,label) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET song_id=excluded.song_id,label=CASE WHEN performances.label IN ('','未命名作品') THEN excluded.label ELSE performances.label END",params![cid,work_id,title]).map_err(error)?;
        } else {
            tx.execute("INSERT INTO performances(id,song_id,label) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET label=CASE WHEN performances.label IN ('','未命名作品') THEN excluded.label ELSE performances.label END",params![cid,work_id,title]).map_err(error)?;
        }
        tx.execute("INSERT INTO assets(content_id,path,bytes,created_at) VALUES(?1,?2,?3,?4) ON CONFLICT(content_id) DO UPDATE SET path=excluded.path",params![cid,managed.to_string_lossy(),bytes.len() as i64,now()]).map_err(error)?;
        for path in [source, &managed] {
            tx.execute("INSERT INTO locations(path_key,path,performance_id,last_seen) VALUES(?1,?2,?3,?4) ON CONFLICT(path_key) DO UPDATE SET path=excluded.path,performance_id=excluded.performance_id,last_seen=excluded.last_seen",params![key(path),path.to_string_lossy(),cid,now()]).map_err(error)?;
        }
        let row = SongRow {
            arranger: None,
            id: format!("owned/{cid}"),
            title: title.into(),
            composer,
            source: "我的曲目".into(),
            category: String::new(),
            license: "本地文件".into(),
            source_url: String::new(),
            path: source.into(),
            content_id: Some(cid.into()),
            tags: vec![],
            difficulty: None,
            rating: 0,
        };
        tx.execute("INSERT INTO catalog_rows(content_id,row_json) VALUES(?1,?2) ON CONFLICT(content_id) DO NOTHING",params![cid,serde_json::to_string(&row).map_err(error)?]).map_err(error)?;
        check()?;
        tx.commit().map_err(error)?;
        Ok(managed)
    }
    pub(crate) fn prepare_import_annotations(
        &self,
        cid: &str,
        managed: &Path,
        initial: Option<panthesia_core::library::SongSidecar>,
    ) -> Result<(), String> {
        let preferences =
            crate::preferences::Preferences::load(&self.data.join("web-preferences.json"))?;
        self.import_annotations(
            &self.data.join("imports").join(format!("{cid}.mid")),
            managed,
            cid,
            preferences.songs.get(cid).map(|s| &s.parts),
            initial,
        )
    }
    pub(crate) fn prepare_generated_annotations(&self,source:&Path,owned:&Path,cid:&str,initial:Option<panthesia_core::library::SongSidecar>)->Result<(),String>{
        let preferences=crate::preferences::Preferences::load(&self.data.join("web-preferences.json"))?;
        self.import_annotations(source,owned,cid,preferences.songs.get(cid).map(|s|&s.parts),initial)
    }
    fn import_annotations(
        &self,
        source: &Path,
        managed: &Path,
        cid: &str,
        parts: Option<&std::collections::BTreeMap<usize, panthesia_core::practice::PracticePart>>,
        initial: Option<panthesia_core::library::SongSidecar>,
    ) -> Result<(), String> {
        use panthesia_core::{library, utils::atomic_file};
        let target = library::metadata_sidecar_path(managed);
        if atomic_file::is_file(&target) {
            library::load_song_sidecar(managed, cid).map_err(error)?;
            return Ok(());
        }
        // A previous managed RON contains edits made after the external source was imported.
        let mut imported = None;
        for (origin, legacy) in [(managed, true), (source, false)] {
            let document = if legacy {
                library::load_legacy_song_sidecar(origin, cid)
            } else {
                library::load_song_sidecar(origin, cid)
            };
            match document {
                Ok(mut annotations) => {
                    let original = if legacy {
                        library::legacy_metadata_sidecar_path(origin)
                    } else {
                        library::metadata_sidecar_path(origin)
                    };
                    let bytes =
                        atomic_file::read_dependency(&original, 32_000_000).map_err(error)?;
                    let archive = self.data.join("library/legacy-inputs");
                    std::fs::create_dir_all(&archive).map_err(error)?;
                    let snapshot = archive.join(format!(
                        "annotations-{}.source",
                        blake3::hash(&bytes).to_hex()
                    ));
                    if !snapshot.exists() {
                        atomic_file::write_new(&snapshot, &bytes).map_err(error)?;
                    }
                    if let Some(score) = &mut annotations.score {
                        score.path = library::resolve_score_path(origin, score);
                    }
                    imported = Some(annotations);
                    break;
                }
                Err(library::MetadataError::Read(e))
                    if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(error(e)),
            }
        }
        let mut annotations = imported.or(initial).unwrap_or_default();
        if let Some(parts) = parts.filter(|p| !p.is_empty()) {
            let preferences = self.data.join("web-preferences.json");
            let archive = self.data.join("library/legacy-inputs");
            std::fs::create_dir_all(&archive).map_err(error)?;
            let snapshot = archive.join("preferences-before-annotations.json");
            if !snapshot.exists() {
                match atomic_file::read_limited(&preferences, 64_000_000) {
                    Ok(bytes) => atomic_file::write_new(&snapshot, &bytes).map_err(error)?,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(error(e)),
                }
            }
            // Legacy preferences were applied last; preserve that effective hand assignment.
            annotations
                .track_parts
                .extend(parts.iter().map(|(id, part)| (*id, *part)));
        }
        library::save_song_sidecar(managed, cid, annotations).map_err(error)?;
        Ok(())
    }
    pub fn resolve(&self,path:&Path,expected:Option<&str>)->Result<PathBuf,String>{
        if expected.is_none() && panthesia_core::utils::atomic_file::is_file(path){return Ok(path.into());}
        let cid=match expected{Some(id)=>Some(id.to_owned()),None=>self.db.query_row("SELECT performance_id FROM locations WHERE path_key=?1",[key(path)],|r|r.get::<_,String>(0)).optional().map_err(error)?};
        if let Some(cid)=cid{
            let owned=self.db.query_row("SELECT path FROM assets WHERE content_id=?1",[&cid],|r|r.get::<_,String>(0)).optional().map_err(error)?.map(PathBuf::from);
            for candidate in owned.into_iter().chain(std::iter::once(Self::managed_path(&self.data,&cid)?)).chain(std::iter::once(path.into())){if verified_source(&candidate,&cid){return Ok(candidate);}}
            let mut query=self.db.prepare("SELECT path FROM locations WHERE performance_id=?1 ORDER BY last_seen DESC").map_err(error)?;
            for path in query.query_map([&cid],|r|r.get::<_,String>(0)).map_err(error)?{let path=PathBuf::from(path.map_err(error)?);if verified_source(&path,&cid){return Ok(path);}}
        }
        Err("曲目暂时没有相同内容的演奏文件，后台将继续查找来源".into())
    }
    pub fn register_row(&mut self, row: &SongRow, cid: &str) -> Result<(), String> {
        let mut row = row.clone();
        row.content_id = Some(cid.into());
        self.db.execute("INSERT INTO catalog_rows(content_id,row_json) VALUES(?1,?2) ON CONFLICT(content_id) DO UPDATE SET row_json=excluded.row_json",params![cid,serde_json::to_string(&row).map_err(error)?]).map_err(error)?;
        Ok(())
    }
    pub fn rows(&self) -> Result<Vec<SongRow>, String> {
        let mut statement = self
            .db
            .prepare("SELECT content_id,row_json FROM catalog_rows ORDER BY content_id")
            .map_err(error)?;
        let mut rows = Vec::new();
        for result in statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(error)?
        {
            let (cid, json) = result.map_err(error)?;
            let mut row: SongRow = serde_json::from_str(&json).map_err(error)?;
            if let Ok(path) = self.resolve(&row.path, Some(&cid)) {
                row.path = path;
                row.content_id = Some(cid);
                crate::library::overlay_metadata(&mut row);
                rows.push(row);
            }
        }
        Ok(rows)
    }
    /// Recognize only registered locations, including owned files returned by catalog queries.
    pub fn contains_path(&self, path: &Path) -> Result<bool, String> {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM locations WHERE path_key=?1)",
                [key(path)],
                |r| r.get(0),
            )
            .map_err(error)
    }
    pub fn retained_ids(&self) -> Result<std::collections::BTreeSet<String>, String> {
        let mut q = self
            .db
            .prepare("SELECT content_id,path FROM assets")
            .map_err(error)?;
        let mut ids = std::collections::BTreeSet::new();
        for row in q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(error)?
        {
            let (id, path) = row.map_err(error)?;
            if Path::new(&path).is_file() {
                ids.insert(id);
            }
        }
        Ok(ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use panthesia_core::{
        library::{self, FingerHint, NoteHandHint, SongSidecar},
        practice::PracticePart,
    };
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "panthesia-song-repository-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn data(&self) -> PathBuf {
            self.0.join("profile")
        }
        fn midi(&self, name: &str, bytes: &[u8]) -> (PathBuf, String) {
            let p = self.0.join(name);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, bytes).unwrap();
            (p, blake3::hash(bytes).to_hex().to_string())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn moved_source_restores_exact_notes_and_owned_annotations_without_editing_original() {
        let fixture = Fixture::new();
        let data = fixture.data();
        let (source, cid) = fixture.midi(
            "external/original.mid",
            include_bytes!("../assets/five-finger.mid"),
        );
        let mut sidecar = SongSidecar::default();
        sidecar.hands.push(NoteHandHint {
            track_id: 1,
            note_index: 0,
            part: PracticePart::LeftHand,
        });
        sidecar.fingerings.push(FingerHint {
            track_id: 1,
            note_index: 0,
            finger: 4,
        });
        library::save_song_sidecar(&source, &cid, sidecar.clone()).unwrap();
        let original_sidecar = std::fs::read(library::metadata_sidecar_path(&source)).unwrap();
        let (legacy_path, _) = fixture.midi(
            "legacy/moved.mid",
            include_bytes!("../assets/five-finger.mid"),
        );
        let mut workspace = crate::library_workspace::Workspace::default();
        workspace.inspect(legacy_path.clone(), true).unwrap();
        workspace.save(&data).unwrap();
        let old_workspace = std::fs::read(data.join("library-workspace.json")).unwrap();
        std::fs::rename(&legacy_path, legacy_path.with_extension("renamed.mid")).unwrap();
        let mut repo = SongRepository::open(&data).unwrap();
        let owned = repo
            .retain(&source, &cid, "Owned sample", "", &|| Ok(()))
            .unwrap();
        assert_eq!(library::load_song_sidecar(&owned, &cid).unwrap(), sidecar);
        let mut changed = sidecar;
        changed.fingerings[0].finger = 2;
        library::save_song_sidecar(&owned, &cid, changed.clone()).unwrap();
        repo.retain(&source, &cid, "Owned sample", "", &|| Ok(()))
            .unwrap();
        assert_eq!(library::load_song_sidecar(&owned, &cid).unwrap(), changed);
        assert_eq!(
            std::fs::read(library::metadata_sidecar_path(&source)).unwrap(),
            original_sidecar
        );
        std::fs::rename(&source, source.with_extension("moved.mid")).unwrap();
        drop(repo);
        let repo = SongRepository::open(&data).unwrap();
        assert_eq!(repo.resolve(&source, Some(&cid)).unwrap(), owned);
        assert_eq!(repo.resolve(&source, None).unwrap(), owned);
        assert!(repo.contains_path(&owned).unwrap());
        assert_eq!(repo.resolve(&legacy_path, None).unwrap(), owned);
        assert_eq!(
            std::fs::read(data.join("library-workspace.json")).unwrap(),
            old_workspace
        );
        assert!(repo.retained_ids().unwrap().contains(&cid));
        let prepared = crate::load_pipeline::Input::File {
            path: source,
            title: "Owned sample".into(),
            expected: Some(cid.clone()),
        }
        .read(&data, |_| Ok(vec![]), || Ok(()))
        .unwrap();
        assert_eq!(prepared.file.content_id, cid);
        assert_eq!(prepared.assets.sidecar.unwrap(), changed);
        assert_eq!(repo.rows().unwrap().len(), 1);
        assert_eq!(
            crate::library::enriched(&[], &data)
                .iter()
                .filter(|r| r.content_id.as_deref() == Some(&cid))
                .count(),
            1
        );
    }
    #[test]
    fn explicit_project_grouping_preserves_manual_separation_and_rejects_stale_save() {
        let fixture = Fixture::new();
        let data = fixture.data();
        let (source, cid) = fixture.midi(
            "project/main.mid",
            include_bytes!("../assets/five-finger.mid"),
        );
        let (version, vid) = fixture.midi(
            "project/versions/quantized.mid",
            include_bytes!("../assets/basic-chords.mid"),
        );
        let (unrelated, uid) = fixture.midi(
            "project/other.mid",
            include_bytes!("../assets/five-finger.mid"),
        );
        // Give the unrelated file a distinct, still valid byte identity.
        let mut bytes = std::fs::read(&unrelated).unwrap();
        bytes.extend_from_slice(b"separate");
        std::fs::write(&unrelated, &bytes).unwrap();
        let uid = if uid == cid {
            blake3::hash(&bytes).to_hex().to_string()
        } else {
            uid
        };
        std::fs::write(
            source.parent().unwrap().join("midi-info.json"),
            br#"{"performance_midi":"main.mid"}"#,
        )
        .unwrap();
        let mut legacy = RepertoireRegistry::default();
        legacy.register(&cid, "Main", "", Some(source.to_string_lossy().into()));
        std::fs::create_dir_all(&data).unwrap();
        let legacy_bytes = serde_json::to_vec_pretty(&legacy).unwrap();
        std::fs::write(data.join("repertoire.json"), &legacy_bytes).unwrap();
        let mut repo = SongRepository::open(&data).unwrap();
        repo.retain(&source, &cid, "Main", "", &|| Ok(())).unwrap();
        repo.retain(&version, &vid, "Quantized", "", &|| Ok(()))
            .unwrap();
        repo.retain(&unrelated, &uid, "Other", "", &|| Ok(()))
            .unwrap();
        let mut registry = repo.registry().unwrap();
        assert_eq!(
            registry.performances[&cid].work_id,
            registry.performances[&vid].work_id
        );
        assert_ne!(
            registry.performances[&cid].work_id,
            registry.performances[&uid].work_id
        );
        let revision = repo.revision().unwrap();
        registry.separate(&vid).unwrap();
        repo.save_registry(&registry, &revision, Some(&vid))
            .unwrap();
        assert!(repo.save_registry(&registry, &revision, None).is_err());
        repo.retain(&version, &vid, "Quantized", "", &|| Ok(()))
            .unwrap();
        assert_ne!(
            repo.registry().unwrap().performances[&cid].work_id,
            repo.registry().unwrap().performances[&vid].work_id
        );
        assert_eq!(
            std::fs::read(data.join("repertoire.json")).unwrap(),
            legacy_bytes
        );
        assert_eq!(
            std::fs::read(data.join("library/legacy-inputs").join(format!(
                "repertoire-{}.json",
                blake3::hash(&legacy_bytes).to_hex()
            )))
            .unwrap(),
            legacy_bytes
        );
    }
    #[test]
    fn backup_restore_updates_sqlite_and_interrupted_publication_restores_directory() {
        let fixture = Fixture::new();
        let data = fixture.data();
        let (source, cid) = fixture.midi(
            "external/sample.mid",
            include_bytes!("../assets/five-finger.mid"),
        );
        std::fs::create_dir_all(&data).unwrap();
        let mut legacy = RepertoireRegistry::default();
        legacy.register(&cid, "Before", "", Some(source.to_string_lossy().into()));
        std::fs::write(
            data.join("repertoire.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        let mut repository = SongRepository::open(&data).unwrap();
        let owned = repository
            .retain(&source, &cid, "Before", "", &|| Ok(()))
            .unwrap();
        let before = repository.export_directory().unwrap();
        let mut changed = before.registry.clone();
        changed.works.get_mut(&format!("work-{cid}")).unwrap().title = "After".into();
        let history = panthesia_core::practice_history::PracticeHistoryStore::load_snapshot(
            data.join("web-practice-history.ron"),
        )
        .unwrap();
        let folder = crate::practice_backup::commit(
            &data,
            &crate::preferences::Preferences::default(),
            &history,
            &crate::library_workspace::Workspace::default(),
            None,
            Some(&serde_json::to_vec(&changed).unwrap()),
            &std::collections::BTreeMap::new(),
            &std::collections::BTreeMap::new(),
            None,
        )
        .unwrap();
        assert_eq!(
            SongRepository::open(&data)
                .unwrap()
                .registry()
                .unwrap()
                .works[&format!("work-{cid}")]
                .title,
            "After"
        );
        // Recreate a crash after SQLite committed but before the journal commit flag.
        let journal = serde_json::json!({"folder":folder,"prefs":false,"history":false,"workspace":false,"templates":null,"repertoire":true,"performances":{},"metadata_histories":{},"pending_metadata_history":null,"song_directory":true,"committed":false});
        std::fs::write(
            data.join("practice-import-journal.json"),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        crate::practice_backup::recover(&data).unwrap();
        let restored = SongRepository::open(&data)
            .unwrap()
            .export_directory()
            .unwrap();
        assert_eq!(
            registry_revision(&restored.registry).unwrap(),
            registry_revision(&before.registry).unwrap()
        );
        assert_eq!(restored.locked, before.locked);
        assert!(owned.is_file());
        assert!(!data.join("practice-import-journal.json").exists());
    }
    #[test]
    fn changed_legacy_registry_adds_records_without_reverting_current_song_edits(){
        let fixture=Fixture::new();let data=fixture.data();std::fs::create_dir_all(&data).unwrap();
        let ids=[blake3::hash(b"first").to_hex().to_string(),blake3::hash(b"second").to_hex().to_string(),blake3::hash(b"third").to_hex().to_string()];
        let mut old=RepertoireRegistry::default();old.register(&ids[0],"Old first","",None);old.register(&ids[1],"Old second","",None);
        let file=data.join("repertoire.json");std::fs::write(&file,serde_json::to_vec(&old).unwrap()).unwrap();
        let mut repository=SongRepository::open(&data).unwrap();let (mut registry,revision)=repository.snapshot().unwrap();let song=registry.performances[&ids[0]].work_id.clone();registry.performances.get_mut(&ids[1]).unwrap().work_id=song.clone();registry.works.get_mut(&song).unwrap().title="Current edited song".into();repository.save_registry(&registry,&revision,Some(&ids[1])).unwrap();drop(repository);
        old.works.get_mut(&song).unwrap().title="Stale external overwrite".into();old.register(&ids[2],"New legacy source","",None);let bytes=serde_json::to_vec(&old).unwrap();std::fs::write(&file,&bytes).unwrap();
        let snapshot=SongRepository::open(&data).unwrap().export_directory().unwrap();assert_eq!(snapshot.registry.performances[&ids[1]].work_id,song);assert_eq!(snapshot.registry.works[&song].title,"Current edited song");assert!(snapshot.registry.performances.contains_key(&ids[2]));assert!(snapshot.locked.contains(&ids[1]));assert_eq!(std::fs::read(file).unwrap(),bytes);
    }
    #[test]
    fn owned_documents_migrate_effective_parts_once_and_preserve_legacy_inputs() {
        let fixture = Fixture::new();
        let data = fixture.data();
        let (source, cid) = fixture.midi(
            "external/sample.mid",
            include_bytes!("../assets/five-finger.mid"),
        );
        let file = midi_file::MidiFile::new(&source).unwrap();
        let track = file
            .tracks
            .iter()
            .find(|t| !t.notes.is_empty())
            .unwrap()
            .track_id;
        let mut old = SongSidecar::default();
        old.track_parts.insert(track, PracticePart::RightHand);
        old.fingerings.push(FingerHint {
            track_id: track,
            note_index: 0,
            finger: 3,
        });
        library::save_song_sidecar(&source, &cid, old).unwrap();
        let legacy_bytes = std::fs::read(library::metadata_sidecar_path(&source)).unwrap();
        let managed = SongRepository::managed_path(&data, &cid).unwrap();
        std::fs::create_dir_all(managed.parent().unwrap()).unwrap();
        std::fs::copy(&source, &managed).unwrap();
        std::fs::write(
            library::legacy_metadata_sidecar_path(&managed),
            &legacy_bytes,
        )
        .unwrap();
        let parts = std::collections::BTreeMap::from([(track, PracticePart::LeftHand)]);
        let mut preferences = crate::preferences::Preferences::default();
        preferences.songs.insert(
            cid.clone(),
            crate::preferences::SessionSettings {
                parts: parts.clone(),
                ..Default::default()
            },
        );
        preferences
            .save(&data.join("web-preferences.json"))
            .unwrap();
        let preferences_bytes = std::fs::read(data.join("web-preferences.json")).unwrap();
        let mut repository = SongRepository::open(&data).unwrap();
        repository
            .retain_with_parts(&managed, &cid, "Sample", "", Some(&parts), &|| Ok(()))
            .unwrap();
        let document = library::metadata_sidecar_path(&managed);
        assert_eq!(
            document,
            data.join("library/annotations").join(format!("{cid}.json"))
        );
        assert_eq!(
            library::load_song_sidecar(&managed, &cid)
                .unwrap()
                .track_parts[&track],
            PracticePart::LeftHand
        );
        let mut player = crate::Player::new(data.clone(), PathBuf::new(), true);
        player
            .command(crate::Command::Load {
                path: managed.clone(),
                title: "Sample".into(),
            })
            .unwrap();
        assert_eq!(
            player
                .config
                .tracks
                .iter()
                .find(|t| t.track_id == track)
                .unwrap()
                .practice_part,
            PracticePart::LeftHand
        );
        assert!(player.preferences.songs[&cid].parts.is_empty());
        player
            .command(crate::Command::Track {
                id: track,
                mode: "auto".into(),
                part: "right".into(),
                visible: true,
            })
            .unwrap();
        assert_eq!(
            library::load_song_sidecar(&managed, &cid)
                .unwrap()
                .track_parts[&track],
            PracticePart::RightHand
        );
        assert_eq!(
            library::load_song_sidecar(&managed, &cid)
                .unwrap()
                .fingerings[0]
                .finger,
            3
        );
        // A legacy preference writer cannot overwrite the adopted content document.
        preferences
            .save(&data.join("web-preferences.json"))
            .unwrap();
        repository
            .retain_with_parts(&managed, &cid, "Sample", "", Some(&parts), &|| Ok(()))
            .unwrap();
        let mut reopened = crate::Player::new(data.clone(), PathBuf::new(), true);
        reopened
            .command(crate::Command::Load {
                path: managed.clone(),
                title: "Sample".into(),
            })
            .unwrap();
        assert_eq!(
            reopened
                .config
                .tracks
                .iter()
                .find(|t| t.track_id == track)
                .unwrap()
                .practice_part,
            PracticePart::RightHand
        );
        assert_eq!(
            std::fs::read(library::legacy_metadata_sidecar_path(&managed)).unwrap(),
            legacy_bytes
        );
        assert_eq!(
            std::fs::read(data.join("library/legacy-inputs/preferences-before-annotations.json"))
                .unwrap(),
            preferences_bytes
        );
        let current = std::fs::read(&document).unwrap();
        assert!(
            library::save_song_sidecar(&managed, &"f".repeat(64), SongSidecar::default()).is_err()
        );
        assert_eq!(std::fs::read(&document).unwrap(), current);
        let mut future: serde_json::Value = serde_json::from_slice(&current).unwrap();
        future["version"] = serde_json::json!(99);
        let future = serde_json::to_vec(&future).unwrap();
        std::fs::write(&document, &future).unwrap();
        assert!(
            repository
                .retain_with_parts(&managed, &cid, "Sample", "", Some(&parts), &|| Ok(()))
                .is_err()
        );
        assert_eq!(std::fs::read(&document).unwrap(), future);
    }
    #[test]
    fn catalog_import_and_live_import_share_owned_storage_and_recoverable_annotations() {
        let fixture = Fixture::new();
        let data = fixture.data();
        std::fs::create_dir_all(&data).unwrap();
        let bytes = include_bytes!("../assets/five-finger.mid").to_vec();
        let cid = blake3::hash(&bytes).to_hex().to_string();
        let mut prepared = crate::import_pipeline::prepare(crate::import_pipeline::Input::Midi {
            bytes: bytes.clone(),
            name: "Sample.mid".into(),
        })
        .unwrap();
        let selected = data.clone();
        let (published, writes, observed) = panthesia_core::utils::atomic_file::capture_matching(
            std::sync::Arc::new(move |p| crate::asset_storage::captures(&selected, p)),
            || prepared.store_catalog(&data, &|| Ok(())),
        );
        let published = published.unwrap();
        let path = PathBuf::from(published.song.source_path);
        assert_eq!(
            path.parent(),
            Some(data.join("library/assets/midi").as_path())
        );
        assert!(!path.exists());
        assert!(
            writes
                .iter()
                .any(|w| w.path == library::metadata_sidecar_path(&path))
        );
        crate::asset_storage::commit(&data, writes, observed).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(library::metadata_sidecar_path(&path).is_file());
        assert!(!library::legacy_metadata_sidecar_path(&path).exists());
        let mut player = crate::Player::new(data.clone(), PathBuf::new(), true);
        let prepared = crate::import_pipeline::prepare(crate::import_pipeline::Input::Midi {
            bytes: bytes.clone(),
            name: "Sample.mid".into(),
        })
        .unwrap();
        player.install_import(prepared).unwrap();
        assert_eq!(
            player.file.as_ref().unwrap().source_path.as_ref(),
            Some(&path)
        );
        assert!(!data.join("imports").exists());
        // Preserve changed owned bytes and publish a verified recovery location.
        std::fs::write(&path, b"user-owned foreign bytes").unwrap();
        let mut repository = SongRepository::open(&data).unwrap();
        let (external, _) = fixture.midi("external/original.mid", &bytes);
        let recovered = repository
            .retain(&external, &cid, "Sample", "", &|| Ok(()))
            .unwrap();
        assert_ne!(recovered, path);
        assert_eq!(std::fs::read(&path).unwrap(), b"user-owned foreign bytes");
        assert_eq!(std::fs::read(&recovered).unwrap(), bytes);
        assert_eq!(
            library::metadata_sidecar_path(&recovered),
            library::metadata_sidecar_path(&path)
        );
        // A pre-upgrade save journal still restores RON to its original location.
        let central = library::metadata_sidecar_path(&path);
        let central_bytes = std::fs::read(&central).unwrap();
        let pending = data.join("asset-save-pending");
        std::fs::create_dir_all(&pending).unwrap();
        let legacy = b"retained legacy journal payload";
        std::fs::write(pending.join("0.next"), legacy).unwrap();
        let intent = serde_json::json!({"version":1,"committed":false,"entries":[{"target":{"Sidecar":path},"before":null,"after":blake3::hash(legacy).to_hex().to_string()}]});
        std::fs::write(
            pending.join("intent.json"),
            serde_json::to_vec(&intent).unwrap(),
        )
        .unwrap();
        crate::asset_storage::recover(&data).unwrap();
        assert_eq!(
            std::fs::read(library::legacy_metadata_sidecar_path(&path)).unwrap(),
            legacy
        );
        assert_eq!(std::fs::read(&central).unwrap(), central_bytes);
    }
    #[test]
    fn cancelled_registration_and_future_schema_leave_no_directory_changes() {
        let fixture = Fixture::new();
        let data = fixture.data();
        let (source, cid) = fixture.midi("cancel.mid", include_bytes!("../assets/five-finger.mid"));
        let mut repo = SongRepository::open(&data).unwrap();
        let count = std::cell::Cell::new(0);
        assert!(
            repo.retain(&source, &cid, "Cancel", "", &|| {
                count.set(count.get() + 1);
                if count.get() >= 3 {
                    Err("cancel".into())
                } else {
                    Ok(())
                }
            })
            .is_err()
        );
        assert!(repo.registry().unwrap().performances.is_empty());
        assert!(repo.rows().unwrap().is_empty());
        repo.db.pragma_update(None, "user_version", 99).unwrap();
        drop(repo);
        assert!(SongRepository::open(&data).is_err());
        let db = Connection::open(data.join("library/songs.sqlite3")).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                .unwrap(),
            99
        );
    }
}
pub(crate) fn registry_revision(registry: &RepertoireRegistry) -> Result<String, String> {
    Ok(
        blake3::hash(&serde_json::to_vec_pretty(registry).map_err(error)?)
            .to_hex()
            .to_string(),
    )
}
fn read_registry(db: &Connection) -> Result<RepertoireRegistry, String> {
    let mut registry = RepertoireRegistry::default();
    let mut q = db
        .prepare("SELECT id,title,composer,catalogue FROM songs ORDER BY id")
        .map_err(error)?;
    for row in q
        .query_map([], |r| {
            Ok(MusicalWork {
                id: r.get(0)?,
                title: r.get(1)?,
                composer: r.get(2)?,
                catalogue: r.get(3)?,
            })
        })
        .map_err(error)?
    {
        let v = row.map_err(error)?;
        registry.works.insert(v.id.clone(), v);
    }
    let mut q = db
        .prepare("SELECT id,song_id,label FROM performances ORDER BY id")
        .map_err(error)?;
    for row in q
        .query_map([], |r| {
            Ok(PerformanceEdition {
                content_id: r.get(0)?,
                work_id: r.get(1)?,
                label: r.get(2)?,
                locations: Vec::new(),
            })
        })
        .map_err(error)?
    {
        let v = row.map_err(error)?;
        registry.performances.insert(v.content_id.clone(), v);
    }
    let mut q = db
        .prepare("SELECT performance_id,path FROM locations ORDER BY performance_id,path_key")
        .map_err(error)?;
    for row in q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(error)?
    {
        let (cid, path) = row.map_err(error)?;
        if let Some(p) = registry.performances.get_mut(&cid) {
            p.locations.push(path);
        }
    }
    let mut q = db
        .prepare("SELECT document FROM notation_editions ORDER BY id")
        .map_err(error)?;
    for row in q.query_map([], |r| r.get::<_, String>(0)).map_err(error)? {
        let v: panthesia_core::repertoire::NotationEdition =
            serde_json::from_str(&row.map_err(error)?).map_err(error)?;
        registry.notations.insert(v.id.clone(), v);
    }
    registry.validate()?;
    Ok(registry)
}
fn write_registry(db: &Connection, registry: &RepertoireRegistry) -> Result<(), String> {
    for work in registry.works.values() {
        db.execute("INSERT INTO songs(id,title,composer,catalogue) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET title=excluded.title,composer=excluded.composer,catalogue=excluded.catalogue",params![work.id,work.title,work.composer,work.catalogue]).map_err(error)?;
    }
    for p in registry.performances.values() {
        db.execute("INSERT INTO performances(id,song_id,label) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET song_id=excluded.song_id,label=excluded.label",params![p.content_id,p.work_id,p.label]).map_err(error)?;
        for path in &p.locations {
            db.execute("INSERT INTO locations(path_key,path,performance_id) VALUES(?1,?2,?3) ON CONFLICT(path_key) DO UPDATE SET performance_id=excluded.performance_id",params![key(Path::new(path)),path,p.content_id]).map_err(error)?;
        }
    }
    for n in registry.notations.values() {
        db.execute("INSERT INTO notation_editions(id,document) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET document=excluded.document",params![n.id,serde_json::to_string(n).map_err(error)?]).map_err(error)?;
    }
    Ok(())
}
fn publish_asset(path: &Path, bytes: &[u8], cid: &str) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or("演奏资产目录无效")?;
    std::fs::create_dir_all(parent).map_err(error)?;
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let temporary = parent.join(format!(
        ".{cid}-{}-{}-{}.tmp",
        std::process::id(),
        now(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(error)?;
        file.write_all(bytes).map_err(error)?;
        file.sync_all().map_err(error)?;
        drop(file);
        for index in 0..1000 {
            let target = if index == 0 {
                path.into()
            } else {
                parent.join(format!("{cid}-restored-{index}.mid"))
            };
            match std::fs::hard_link(&temporary, &target) {
                Ok(()) => return Ok(target),
                Err(_) if target.is_file() => {
                    if crate::import_storage::matches_content(&target, cid)? {
                        return Ok(target);
                    }
                }
                Err(e) => return Err(error(e)),
            }
        }
        Err("演奏恢复副本超过容量限制，请检查资产目录".into())
    })();
    let _ = std::fs::remove_file(&temporary);
    result
}
/// Only an explicit per-song manifest can define a project family automatically.
fn project_identity(source: &Path) -> Result<Option<(String, String)>, String> {
    let parent = source.parent().ok_or("歌曲目录无效")?;
    let project = if parent
        .file_name()
        .is_some_and(|n| n.eq_ignore_ascii_case("versions"))
    {
        parent.parent().unwrap_or(parent)
    } else {
        parent
    };
    let manifest = project.join("midi-info.json");
    let bytes = match panthesia_core::utils::atomic_file::read_dependency(&manifest, 64 * 1024) {
        Ok(v) => v,
        _ => return Ok(None),
    };
    let value: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let Some(name) = value
        .get("performance_midi")
        .and_then(|v| v.as_str())
        .and_then(|v| Path::new(v).file_name())
    else {
        return Ok(None);
    };
    let canonical = project.join(name);
    if parent == project && key(source) != key(&canonical) {
        return Ok(None);
    }
    let bytes = match panthesia_core::utils::atomic_file::read_dependency(&canonical, 32_000_000) {
        Ok(v) if v.starts_with(b"MThd") => v,
        _ => return Ok(None),
    };
    let title = canonical
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    Ok(Some((
        format!("work-{}", blake3::hash(&bytes).to_hex()),
        title,
    )))
}
