use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongRow {
    pub id: String,
    pub title: String,
    pub composer: String,
    #[serde(default)]
    pub arranger: Option<String>,
    pub source: String,
    pub category: String,
    pub license: String,
    pub source_url: String,
    pub path: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub difficulty: Option<String>,
    pub rating: u8,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Catalog {
    title: String,
    composer: String,
    source: String,
    category: String,
    license: String,
    #[serde(default)]
    source_url: String,
    local_path: String,
}

pub fn read(root: &Path) -> Result<Vec<SongRow>, String> {
    let path = root.join("catalog.csv");
    let mut reader = csv::Reader::from_path(&path)
        .map_err(|e| format!("无法读取曲库目录 {}：{e}", path.display()))?;
    let mut rows = Vec::new();
    for row in reader.deserialize::<Catalog>().flatten() {
        let portable = row.local_path.replace('\\', "/");
        let relative = Path::new(&portable);
        if portable.contains(':')
            || relative.is_absolute()
            || relative
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
        {
            continue;
        }
        let path = root.join(relative);
        if !path.is_file() {
            continue;
        }
        rows.push(SongRow { arranger: None,
            id: portable,
            title: row.title,
            composer: row.composer,
            source: row.source,
            category: row.category,
            license: row.license,
            source_url: row.source_url,
            path,
            content_id: None,
            tags: vec![],
            difficulty: None,
            rating: 0,
        });
    }
    Ok(rows)
}

/// This original exercise is bundled, so first launch does not depend on an
/// external corpus. Third-party datasets continue to live outside the package.
pub(crate) fn builtin_rows(data:&Path) -> Result<Vec<SongRow>,String> {
    static BUILTINS:std::sync::Mutex<()>=std::sync::Mutex::new(());
    let _guard=BUILTINS.lock().map_err(|_|"内置练习缓存暂不可用")?;
    std::fs::create_dir_all(data).map_err(|e| e.to_string())?;
    let path = data.join("five-finger.mid");
    write_builtin(&path,include_bytes!("../assets/five-finger.mid"))?;
    let mut rows = vec![SongRow { arranger: None,
        id: "builtin/five-finger".into(),
        title: "五指热身 · 从中央 C 开始".into(),
        composer: "Panthesia 原创练习".into(),
        source: "内置练习".into(),
        category: "入门/五指练习".into(),
        license: "随项目许可发布".into(),
        source_url: String::new(),
        path,
        content_id: None,
        tags: vec![],
        difficulty: None,
        rating: 0,
    }];
    for (name, title, category, bytes) in [
        (
            "c-major-scale",
            "C 大调音阶 · 一个八度",
            "入门/音阶",
            include_bytes!("../assets/c-major-scale.mid").as_slice(),
        ),
        (
            "bass-five-finger",
            "低音五指练习 · 左手音区",
            "入门/低音",
            include_bytes!("../assets/bass-five-finger.mid").as_slice(),
        ),
        (
            "parallel-five-finger",
            "双音同步 · 两个八度五指",
            "入门/双音",
            include_bytes!("../assets/parallel-five-finger.mid").as_slice(),
        ),
        (
            "basic-chords",
            "三和弦练习 · C / F / G",
            "入门/和弦",
            include_bytes!("../assets/basic-chords.mid").as_slice(),
        ),
    ] {
        let path = data.join(format!("{name}.mid"));
        write_builtin(&path,bytes)?;
        rows.push(SongRow { arranger: None,
            id: format!("builtin/{name}"),
            title: title.into(),
            composer: "Panthesia 原创练习".into(),
            source: "内置练习".into(),
            category: category.into(),
            license: "随项目许可发布".into(),
            source_url: String::new(),
            path,
            content_id: None,
            tags: vec![],
            difficulty: None,
            rating: 0,
        });
    }
    for (name, bytes) in [
        ("five-finger", include_bytes!("../assets/starter-pack/five-finger.musicxml").as_slice()),
        ("c-major-scale", include_bytes!("../assets/starter-pack/c-major-scale.musicxml").as_slice()),
        ("bass-five-finger", include_bytes!("../assets/starter-pack/bass-five-finger.musicxml").as_slice()),
        ("parallel-five-finger", include_bytes!("../assets/starter-pack/parallel-five-finger.musicxml").as_slice()),
        ("basic-chords", include_bytes!("../assets/starter-pack/basic-chords.musicxml").as_slice()),
    ] {
        let midi = data.join(format!("{name}.mid"));
        let score = data.join(format!("{name}.musicxml"));
        let initialized = data.join(format!("{name}-notation-v1.initialized"));
        if initialized.exists() { continue; }
        // User edits or paired scores remain authoritative. Builtin notation is immutable.
        if !score.exists() { panthesia_core::utils::atomic_file::write(&score, bytes).map_err(|e|e.to_string())?; }
        if std::fs::read(&score).map_err(|e|e.to_string())? != bytes { continue; }
        let file = midi_file::MidiFile::new(&midi)?;
        match panthesia_core::library::load_song_sidecar(&midi, &file.content_id) {
            Ok(sidecar) if sidecar.score.is_some() => {},
            Ok(_) => { panthesia_core::library::save_score_association(&midi, &file.content_id, &score).map_err(|e|e.to_string())?; },
            Err(panthesia_core::library::MetadataError::Read(e)) if e.kind() == std::io::ErrorKind::NotFound => { panthesia_core::library::save_score_association(&midi, &file.content_id, &score).map_err(|e|e.to_string())?; },
            Err(e) => return Err(format!("内置练习的个人资料需先恢复：{e}")),
        }
        let mut sidecar = panthesia_core::library::load_song_sidecar(&midi, &file.content_id).map_err(|e|e.to_string())?;
        if let Some(row) = rows.iter().find(|row|row.path == midi) {
            let missing_title = sidecar.metadata.title.is_none();
            let missing_composer = sidecar.metadata.composer.is_none();
            if missing_title { sidecar.metadata.title = Some(row.title.clone()); }
            if missing_composer { sidecar.metadata.composer = Some(row.composer.clone()); }
            if missing_title || missing_composer { panthesia_core::library::save_song_sidecar(&midi,&file.content_id,sidecar).map_err(|e|e.to_string())?; }
        }
        panthesia_core::utils::atomic_file::write(&initialized, b"1").map_err(|e|e.to_string())?;
    }
    for row in &mut rows { row.content_id = Some(midi_file::MidiFile::new(&row.path)?.content_id); }
    Ok(rows)
}
pub(crate) fn is_builtin_notation(data: &Path, path: &Path, fingerprint: &str) -> bool {
    [("five-finger",include_bytes!("../assets/starter-pack/five-finger.musicxml").as_slice()),("c-major-scale",include_bytes!("../assets/starter-pack/c-major-scale.musicxml").as_slice()),("bass-five-finger",include_bytes!("../assets/starter-pack/bass-five-finger.musicxml").as_slice()),("parallel-five-finger",include_bytes!("../assets/starter-pack/parallel-five-finger.musicxml").as_slice()),("basic-chords",include_bytes!("../assets/starter-pack/basic-chords.musicxml").as_slice())].iter().any(|(name,bytes)|path==data.join(format!("{name}.musicxml")) && blake3::hash(bytes).to_hex().as_str()==fingerprint)
}
fn write_builtin(path:&Path, bytes:&[u8]) -> Result<(),String> {
    match std::fs::read(path) {
        Ok(old) if old==bytes=>return Ok(()),
        Ok(old)=> {
            let name=path.file_stem().and_then(|s|s.to_str()).ok_or("内置练习位置无效")?;
            let identity=blake3::hash(&old).to_hex().to_string();
            let copy=path.parent().ok_or("内置练习目录无效")?.join("builtin-previous").join(format!("{name}-{identity}.mid"));
            match std::fs::read(&copy) {
                Ok(existing) if existing==old=>{},
                Ok(_)=>return Err(format!("旧版内置练习保留文件内容有冲突：{}",copy.display())),
                Err(error) if error.kind()==std::io::ErrorKind::NotFound=>panthesia_core::utils::atomic_file::write(&copy,&old).map_err(|e|format!("旧版内置练习无法保留：{e}"))?,
                Err(error)=>return Err(format!("旧版内置练习保留文件无法读取：{error}")),
            }
            preserve_builtin_annotations(path,&copy,&identity)?;
        }
        Err(error) if error.kind()==std::io::ErrorKind::NotFound=>{},
        Err(error)=>return Err(format!("内置练习无法读取：{error}")),
    }
    panthesia_core::utils::atomic_file::write(path,bytes).map_err(|e|e.to_string())
}
fn preserve_builtin_annotations(original:&Path,archived:&Path,identity:&str)->Result<(),String> {
    use panthesia_core::library::{load_song_sidecar,metadata_sidecar_path,save_song_sidecar};
    let destination=metadata_sidecar_path(archived);
    match destination.try_exists() {Ok(true)=>return Ok(()),Ok(false)=>{},Err(error)=>return Err(error.to_string())}
    let raw=match std::fs::read(metadata_sidecar_path(original)) {
        Ok(raw)=>raw,
        Err(error) if error.kind()==std::io::ErrorKind::NotFound=>return Ok(()),
        Err(error)=>return Err(format!("旧版指法与谱面资料无法保留：{error}")),
    };
    match load_song_sidecar(original,identity) {
        Ok(mut sidecar)=> {
            // Relative score links must continue to refer to the original source directory.
            if let Some(score)=&mut sidecar.score {score.path=panthesia_core::library::resolve_score_path(original,score);}
            save_song_sidecar(archived,identity,sidecar).map_err(|e|e.to_string())?;
        }
        Err(_)=> {
            // Preserve unreadable metadata byte-for-byte for later repair.
            panthesia_core::utils::atomic_file::write(&destination,&raw).map_err(|e|e.to_string())?;
        }
    }
    Ok(())
}
pub(crate) fn recording_title(path:&Path)->String {
    let stem=path.file_stem().unwrap_or_default().to_string_lossy();
    let timestamp=stem.strip_prefix("演奏-").and_then(|value|value.split('-').next()).and_then(|value|value.parse::<u128>().ok());
    if let Some(timestamp)=timestamp {
        let millis=if timestamp>100_000_000_000_000_000 {timestamp/1_000_000}else{timestamp};
        if let Ok(millis)=i64::try_from(millis) {
            if let Some(time)=chrono::DateTime::<chrono::Utc>::from_timestamp_millis(millis) {
                return format!("自由演奏 · {}",time.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M"));
            }
        }
    }
    stem.into_owned()
}
/// Saved free-play takes remain visible after restart, even when replay preparation failed.
pub(crate) fn recording_rows(data:&Path)->Result<Vec<SongRow>,String> {
    let root=data.join("recordings");
    let entries=match std::fs::read_dir(&root) {Ok(entries)=>entries,Err(error) if error.kind()==std::io::ErrorKind::NotFound=>return Ok(Vec::new()),Err(error)=>return Err(format!("录音目录无法读取：{error}"))};
    let mut rows=Vec::new();
    for entry in entries {
        let entry=entry.map_err(|e|e.to_string())?;
        let kind=entry.file_type().map_err(|e|e.to_string())?;
        let path=entry.path();
        if !kind.is_file()||!path.extension().is_some_and(|ext|ext.eq_ignore_ascii_case("mid")||ext.eq_ignore_ascii_case("midi")){continue;}
        if rows.len()>=50_000 {return Err("录音目录超过 50000 首，请先整理录音文件".into());}
        let title=recording_title(&path);
        rows.push(SongRow { arranger: None,id:format!("recording/{}",entry.file_name().to_string_lossy()),title,composer:"本机演奏".into(),source:"我的录音".into(),category:"自由演奏".into(),license:"个人演奏录音".into(),source_url:String::new(),path,content_id:None,tags:vec!["录音".into()],difficulty:None,rating:0});
    }
    rows.sort_by(|a,b|b.path.cmp(&a.path));Ok(rows)
}
pub(crate) fn local_cache(data:&Path)->Result<Vec<SongRow>,String> {
    use std::io::Read;
    const MAX_BYTES:u64=64*1024*1024;
    let file=match std::fs::File::open(data.join("library-monitor-files.json")) {
        Ok(file)=>file,
        Err(error) if error.kind()==std::io::ErrorKind::NotFound=>return Ok(Vec::new()),
        Err(error)=>return Err(error.to_string()),
    };
    let mut bytes=Vec::new();file.take(MAX_BYTES+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len() as u64>MAX_BYTES {return Err("曲库缓存过大，将通过文件夹扫描重建".into());}
    let rows:Vec<SongRow>=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
    if rows.len()>100_000{return Err("曲库缓存条目过多，将通过文件夹扫描重建".into());}
    let roots=folders(data)?;
    Ok(rows.into_iter().filter(|row|row.id.starts_with("folder/")&&row.path.is_absolute()&&roots.iter().any(|root|row.path.starts_with(root))).collect())
}
/// First paint uses the last index; the monitor discovers filesystem changes afterwards.
pub(crate) fn initial_rows(root:&Path,data:&Path) -> Result<Vec<SongRow>,String> {
    let mut rows=builtin_rows(data)?;
    for folder in discovered_folders(data)? { if let Ok(found)=scan_folder(&folder) { rows.splice(0..0,found); } }
    if let Ok(external)=read(root) {rows.extend(external);}
    if let Ok(recordings)=recording_rows(data){rows.extend(recordings);}
    if let Ok(cached)=local_cache(data){rows.extend(cached);}
    let mut seen=std::collections::HashSet::new();rows.retain(|row|seen.insert(row.path.clone()));
    Ok(rows)
}
pub fn load(root: &Path, data: &Path) -> Result<Vec<SongRow>, String> {
    let mut rows=builtin_rows(data)?;
    if let Ok(recordings)=recording_rows(data){rows.extend(recordings);}
    match read(root) {
        Ok(external) => rows.extend(external),
        Err(e) => eprintln!("{e}；仍可使用内置练习和导入 MIDI"),
    }
    match folders(data) {
        Ok(folders) => {
            for folder in folders {
                match scan_folder(&folder) {
                    Ok(found) => rows.extend(found),
                    Err(e) => eprintln!("曲库文件夹暂不可用 {}：{e}", folder.display()),
                }
            }
        }
        Err(e) => eprintln!("本地文件夹配置读取失败：{e}"),
    }

    let mut seen = std::collections::HashSet::new();
    rows.retain(|r| seen.insert(r.path.clone()));
    Ok(rows)
}

fn registered_folders(data: &Path) -> Result<Vec<PathBuf>, String> {
    match std::fs::read(data.join("library-folders.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}
fn catalog_root() -> PathBuf {
    panthesia_core::product::env_os("PANTHESIA_LIBRARY_ROOT").map(PathBuf::from).unwrap_or_else(||PathBuf::from(r"D:\Music\MIDI\PracticeLibrary"))
}
fn folder_key(path: &Path) -> String {
    crate::library_workspace::key(path).trim_start_matches("//?/").to_owned()
}
fn discovered_folders(data: &Path) -> Result<Vec<PathBuf>,String> {
    let root=catalog_root();
    let ignored:Vec<PathBuf>=match panthesia_core::utils::atomic_file::read(&data.join("library-hidden-defaults.json")) {
        Ok(bytes)=>serde_json::from_slice(&bytes).map_err(|e|e.to_string())?,
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>vec![],
        Err(e)=>return Err(e.to_string()),
    };
    let output=root.parent().unwrap_or(&root).join("Output");
    Ok(if output.is_dir() && !ignored.iter().any(|p|folder_key(p)==folder_key(&output)) {vec![output]} else {vec![]})
}
pub fn folders(data: &Path) -> Result<Vec<PathBuf>,String> {
    let mut roots=registered_folders(data)?;
    for path in discovered_folders(data)? {if !roots.iter().any(|p|folder_key(p)==folder_key(&path)){roots.push(path);}}
    Ok(roots)
}
pub fn folder_status(data: &Path) -> Result<serde_json::Value, String> {
    let defaults=discovered_folders(data)?;
    let mut entries:Vec<_>=folders(data)?.into_iter().map(|path|serde_json::json!({"available":path.is_dir(),"automatic":defaults.iter().any(|p|folder_key(p)==folder_key(&path)),"kind":"folder","path":path})).collect();
    let catalog=catalog_root();
    if catalog.join("catalog.csv").is_file() && !entries.iter().any(|e|e["path"].as_str().is_some_and(|p|folder_key(Path::new(p))==folder_key(&catalog))) {entries.insert(0,serde_json::json!({"available":true,"automatic":true,"kind":"catalog","path":catalog}));}
    Ok(serde_json::json!({"folders":entries}))
}
pub fn remove_folder(data: &Path, path: &Path) -> Result<(), String> {
    let mut roots = folders(data)?;
    if !roots.iter().any(|p| folder_key(p) == folder_key(path)) {
        return Err("该文件夹未登记".into());
    }
    roots.retain(|p| folder_key(p) != folder_key(path));
    if discovered_folders(data)?.iter().any(|p|folder_key(p)==folder_key(path)) {
        let file=data.join("library-hidden-defaults.json");
        let mut hidden:Vec<PathBuf>=panthesia_core::utils::atomic_file::read(&file).ok().map(|b|serde_json::from_slice(&b)).transpose().map_err(|e|e.to_string())?.unwrap_or_default();
        hidden.push(path.to_owned());
        panthesia_core::utils::atomic_file::write(&file,&serde_json::to_vec(&hidden).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    }
    let temporary = data.join("library-folders.json.tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec(&roots).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temporary, data.join("library-folders.json")).map_err(|e| e.to_string())
}
pub fn command_paths(command: &crate::Command) -> Vec<PathBuf> {
    match command {
        crate::Command::Load { path, .. }
        | crate::Command::LoadIndexed { path, .. }
        | crate::Command::InspectSong { path, .. }
        | crate::Command::SongPreview { path }
        | crate::Command::SetLibraryCollection { path, .. }
        | crate::Command::SaveSongLearning { path, .. }
        | crate::Command::LibraryMetadataHistory { path, .. } | crate::Command::PreviewMetadataRestore { path, .. } | crate::Command::RestoreLibraryMetadata { path, .. }
        | crate::Command::PreviewLibraryMetadata { path, .. }
        | crate::Command::ReadLibraryMetadata { path, .. }
        | crate::Command::ResetLibraryMetadataDefaults { path, .. }
        | crate::Command::SaveLibraryMetadata { path, .. }
        | crate::Command::UpdateSongMetadata { path, .. } => vec![path.clone()],
        crate::Command::IndexLibrary { paths, .. }
        | crate::Command::PreviewSynthesiaMetadata { paths, .. }
        | crate::Command::ImportSynthesiaMetadata { paths, .. }
        | crate::Command::InspectSongs { paths, .. }
        | crate::Command::AssignLibrary { paths, .. }
        | crate::Command::UnassignLibrary { paths, .. } => paths.clone(),
        crate::Command::RelinkLibrary{items}=>items.iter().flat_map(|i|[i.from.clone(),i.to.clone()]).collect(),
        crate::Command::SetLibraryPrimary{path,..}=>path.clone().into_iter().collect(),
        crate::Command::RestoreLibraryPath{path,..}|crate::Command::IgnoreLibraryPath{path,..}=>vec![path.clone()],
        _ => vec![],
    }
}
pub fn add_folder(data: &Path, folder: PathBuf) -> Result<Vec<SongRow>, String> {
    let rows = scan_folder(&folder)?;
    let mut roots = folders(data)?;
    if !roots.contains(&folder) {
        roots.push(folder);
        let temporary = data.join("library-folders.json.tmp");
        std::fs::write(
            &temporary,
            serde_json::to_vec(&roots).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(temporary, data.join("library-folders.json")).map_err(|e| e.to_string())?;
    }
    Ok(rows)
}
pub fn scan_folder(root: &Path) -> Result<Vec<SongRow>, String> {
    scan_folder_until(root,||Ok(()))
}
pub(crate) fn scan_folder_until(root:&Path,check:impl Fn()->Result<(),String>) -> Result<Vec<SongRow>,String> {
    let mut rows = Vec::new();
    let mut pending = vec![(root.to_owned(), 0)];
    let mut visited = 0;
    while let Some((directory, depth)) = pending.pop() {
        check()?;
        visited += 1;
        if visited > 20_000 {
            return Err("文件夹数量过多，请选择更具体的曲库目录".into());
        }
        let entries = match std::fs::read_dir(&directory) {
            Ok(e) => e,
            Err(e) if depth == 0 => return Err(e.to_string()),
            Err(e) => return Err(format!("无法读取子目录 {}：{e}", directory.display())),
        };
        for entry in entries.flatten() {
            check()?;
            let kind = match entry.file_type() {
                Ok(k) => k,
                Err(_) => continue,
            };
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                if depth < 12 {
                    pending.push((path, depth + 1))
                }
                continue;
            }
            if !kind.is_file()
                || !path.extension().is_some_and(|e| {
                    e.eq_ignore_ascii_case("mid") || e.eq_ignore_ascii_case("midi")
                })
            {
                continue;
            }
            if rows.len() >= 50_000 {
                return Err("单个文件夹超过 50000 首，请分目录导入".into());
            }
            rows.push(SongRow { arranger: None,
                id: format!("folder/{}", path.display()),
                title: path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
                composer: String::new(),
                source: "本地文件夹".into(),
                category: root
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
                license: "本地文件，请确认使用权限".into(),
                source_url: String::new(),
                path,
                content_id: None,
                tags: vec![],
                difficulty: None,
                rating: 0,
            });
        }
    }
    rows.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(rows)
}
pub fn enriched(rows: &[SongRow], data: &Path) -> Vec<SongRow> {
    let mut rows = rows.to_vec();
    if let Ok(recordings)=recording_rows(data) {let mut known=rows.iter().map(|row|crate::library_workspace::key(&row.path)).collect::<std::collections::HashSet<_>>();rows.extend(recordings.into_iter().filter(|row|known.insert(crate::library_workspace::key(&row.path))));}
    if let Ok(workspace) = crate::library_workspace::Workspace::load(data) {
        let mut known: std::collections::HashSet<_> = rows
            .iter()
            .map(|r| crate::library_workspace::key(&r.path))
            .collect();
        for entry in workspace.entries.values() {
            if known.insert(crate::library_workspace::key(&entry.path)) {
                rows.push(SongRow { arranger: None,
                    id: format!("indexed/{}", entry.path.display()),
                    title: entry.metadata.title.clone().unwrap_or_else(|| {
                        entry
                            .path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into()
                    }),
                    composer: entry.metadata.composer.clone().unwrap_or_default(),
                    source: "本地索引".into(),
                    category: entry.metadata.collection.clone().unwrap_or_default(),
                    license: "本地文件，请确认使用权限".into(),
                    source_url: String::new(),
                    path: entry.path.clone(),
                    content_id: entry.content_id.clone(),
                    tags: vec![],
                    difficulty: None,
                    rating: 0,
                });
            }
        }
        rows.retain(|row|workspace.entries.get(&crate::library_workspace::key(&row.path)).and_then(|e|e.content_id.as_ref()).is_none_or(|id|crate::library_repairs::link_target(&workspace,id,&row.path).is_none() && !workspace.ignored_paths.contains(&crate::library_repairs::record_key(id,&row.path))));
        for row in &mut rows {
            if let Some(entry) = workspace
                .entries
                .get(&crate::library_workspace::key(&row.path))
            {
                if let Some(title) = &entry.metadata.title {
                    if !title.is_empty() {
                        row.title = title.clone();
                    }
                }
                if let Some(composer) = &entry.metadata.composer {
                    row.composer = composer.clone();
                }
                row.arranger = entry.metadata.arranger.clone();
                row.tags = entry.metadata.tags.clone();
                row.content_id = entry.content_id.clone();
                row.difficulty = entry.metadata.difficulty.clone();
                row.rating = entry.rating;
            }
        }
    }
    rows
}
/// Recover the portable annotations of an identical MIDI at a new location.
/// Existing valid annotations at the destination always win.
pub fn recover_annotations(
    original: &Path,
    destination: &Path,
    content_id: &str,
) -> Result<(), String> {
    recover_annotations_report(original, destination, content_id).map(|_| ())
}
pub(crate) fn recover_annotations_report(
    original: &Path,
    destination: &Path,
    content_id: &str,
) -> Result<Option<String>, String> {
    match panthesia_core::library::load_song_sidecar(destination, content_id) {
        Ok(_) => {
            return Ok(Some(
                "新位置已有附加资料，已沿用原有标注；旧位置保持原状。".into(),
            ));
        }
        Err(panthesia_core::library::MetadataError::Read(e))
            if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("新位置已有无法合并的附加信息：{e}")),
    }
    let mut old = match panthesia_core::library::load_song_sidecar(original, content_id) {
        Ok(s) => s,
        Err(panthesia_core::library::MetadataError::Read(e))
            if e.kind() == std::io::ErrorKind::NotFound =>
        {
            return Ok(None);
        }
        Err(e) => return Err(e.to_string()),
    };
    let mut unverified_score = false;
    if let Some(score) = old.score.as_ref() {
        if panthesia_core::library::verify_score_association(original, score)
            .is_ok_and(|valid| valid)
        {
            let path = panthesia_core::library::resolve_score_path(original, score);
            old.score = Some(panthesia_core::library::ScoreAssociation {
                path,
                content_id: score.content_id.clone(),
            });
        } else {
            unverified_score = true;
            old.score = None;
            old.score_analysis = None;
        }
    }
    panthesia_core::library::save_song_sidecar(destination, content_id, old)
        .map_err(|e| e.to_string())?;
    Ok(Some(if unverified_score {
        format!(
            "已恢复可用的附加资料；旧谱面关联未通过核对，暂未启用。原资料保留在 {}",
            original.display()
        )
    } else {
        format!("已恢复原位置的附加资料；原件保留在 {}", original.display())
    }))
}

pub fn validate_paths(
    paths: Vec<PathBuf>,
    rows: &[SongRow],
    known: &serde_json::Value,
    indexed: &serde_json::Value,
) -> Result<(), String> {
    let mut allowed: std::collections::HashSet<_> = rows
        .iter()
        .map(|r| crate::library_workspace::key(&r.path))
        .collect();
    for v in known["songs"].as_array().into_iter().flatten() {
        for p in [v["path"].as_str(),v["storedPath"].as_str()].into_iter().flatten(){allowed.insert(crate::library_workspace::key(Path::new(p)));}
    }
    for v in indexed["entries"]
        .as_object()
        .into_iter()
        .flat_map(|v| v.values())
    {
        if let Some(p) = v["path"].as_str() {
            allowed.insert(crate::library_workspace::key(Path::new(p)));
        }
    }
    if paths
        .iter()
        .any(|p| !allowed.contains(&crate::library_workspace::key(p)))
    {
        return Err("文件不在已登记的曲库中，请先导入".into());
    }
    Ok(())
}

/// A known content identity may have moved to another indexed path.
pub fn available_path(index:&crate::library_workspace::Workspace,content_id:&str,preferred:Option<&Path>)->Option<PathBuf>{
 if let Some(path)=index.preferred_paths.get(content_id){if path.is_file()&&index.entries.get(&crate::library_workspace::key(path)).is_some_and(|e|e.content_id.as_deref()==Some(content_id)){return Some(path.clone());}}
 if let Some(path)=preferred {if path.is_file() && index.entries.get(&crate::library_workspace::key(path)).is_none_or(|e|e.content_id.as_deref()==Some(content_id)){return Some(path.to_owned());}}
 index.entries.values().filter(|e|e.content_id.as_deref()==Some(content_id)&&e.path.is_file()).find(|e|crate::library_repairs::link_target(index,content_id,&e.path).is_none()).or_else(||index.entries.values().find(|e|e.content_id.as_deref()==Some(content_id)&&e.path.is_file())).map(|e|e.path.clone())
}
pub(crate) fn read_midi(path:&Path)->Result<midi_file::MidiFile,String> {
    read_midi_limited(path, 512_000_000)
}
pub(crate) fn read_midi_limited(path:&Path, limit:usize)->Result<midi_file::MidiFile,String> {
    let path=std::path::absolute(path).map_err(|e|format!("曲目位置无法解析：{e}"))?;
    let bytes=panthesia_core::utils::atomic_file::read_dependency(&path,limit).map_err(|e|e.to_string())?;
    midi_file::MidiFile::from_path_bytes(&path,&bytes)
}
pub fn verified_file(data:&Path,content_id:&str,preferred:impl IntoIterator<Item=PathBuf>)->Result<midi_file::MidiFile,String>{
 let index=crate::library_workspace::Workspace::load_hint(data)?;
 verified_file_in_workspace(&index,content_id,preferred)
}
pub fn verified_file_in_workspace(index:&crate::library_workspace::Workspace,content_id:&str,preferred:impl IntoIterator<Item=PathBuf>)->Result<midi_file::MidiFile,String>{
 for path in candidate_paths(index,content_id,preferred) {if let Ok(file)=read_midi(&path){if file.content_id==content_id{return Ok(file);}}}
 Err("曲目文件缺失、内容改变或无法读取，请定位同一内容的文件后重试".into())
}
pub(crate) fn candidate_paths(index:&crate::library_workspace::Workspace,content_id:&str,preferred:impl IntoIterator<Item=PathBuf>)->Vec<PathBuf>{
 let mut paths=available_path(index,content_id,None).into_iter().chain(preferred).collect::<Vec<_>>();
 paths.extend(index.entries.values().filter(|e|e.content_id.as_deref()==Some(content_id)).map(|e|e.path.clone()));
 let mut seen=std::collections::HashSet::new();
 paths.into_iter().filter(|path|seen.insert(crate::library_workspace::key(path))).collect()
}
