//! A bounded project migration using the same repository as the desktop.
//! cargo run -p panthesia-engine --example migrate-song-project -- <profile> <project> <report> [--apply]
use panthesia_core::{library, practice::PracticePart, utils::atomic_file};
use panthesia_engine::{data_root_lock::DataRootLock, song_repository::SongRepository};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

fn hash(path: &Path) -> Result<String, String> {
    Ok(
        blake3::hash(&std::fs::read(path).map_err(|e| e.to_string())?)
            .to_hex()
            .to_string(),
    )
}
fn save(path: &Path, value: &Value) -> Result<(), String> {
    atomic_file::write(
        path,
        &serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
fn run() -> Result<(), String> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() < 3 || args.len() > 4 || args.get(3).is_some_and(|a| a != "--apply") {
        return Err("Usage: migrate-song-project <profile> <project> <report> [--apply]".into());
    }
    let profile = PathBuf::from(&args[0])
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let project = PathBuf::from(&args[1])
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let output = std::path::absolute(PathBuf::from(&args[2])).map_err(|e| e.to_string())?;
    let output = output
        .parent()
        .ok_or("报告位置缺少目录")?
        .canonicalize()
        .map_err(|e| e.to_string())?
        .join(output.file_name().ok_or("报告文件名无效")?);
    if output.starts_with(&profile) || output.starts_with(&project) {
        return Err("迁移报告必须放在原资料和歌曲目录之外".into());
    }
    let manifest_bytes = atomic_file::read_limited(&project.join("midi-info.json"), 64 * 1024)
        .map_err(|e| e.to_string())?;
    let manifest: Value = serde_json::from_slice(&manifest_bytes).map_err(|e| e.to_string())?;
    if output.exists() {
        let old: Value =
            serde_json::from_slice(&std::fs::read(&output).map_err(|e| e.to_string())?)
                .map_err(|_| "报告文件已存在，请选择新文件名")?;
        if old["status"] != "planned"
            || old["profile"] != json!(profile)
            || old["project"] != json!(project)
            || old["manifestHash"] != json!(blake3::hash(&manifest_bytes).to_hex().to_string())
        {
            return Err("报告已存在或来源改变，请选择新文件名，原报告保持原状".into());
        }
    }
    let canonical_name = manifest["performance_midi"]
        .as_str()
        .and_then(|s| Path::new(s).file_name())
        .ok_or("歌曲清单缺少主演奏文件")?;
    let canonical = project.join(canonical_name);
    let mut sources = vec![canonical.clone()];
    if let Ok(entries) = std::fs::read_dir(project.join("versions")) {
        for (index, item) in entries.enumerate() {
            if index >= 512 {
                return Err("版本目录超过 512 项，请先整理工程".into());
            }
            let item = item.map_err(|e| e.to_string())?;
            let kind = item.file_type().map_err(|e| e.to_string())?;
            if kind.is_file()
                && !kind.is_symlink()
                && item.path().extension().is_some_and(|s| {
                    s.eq_ignore_ascii_case("mid") || s.eq_ignore_ascii_case("midi")
                })
            {
                sources.push(item.path());
            }
        }
    }
    if sources.len() > 512 {
        return Err("单个工程超过 512 份演奏，请先整理来源清单".into());
    }
    let mut plan = Vec::new();
    for path in sources {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        if !path.starts_with(&project) {
            return Err("演奏文件超出歌曲工程目录".into());
        }
        let bytes = atomic_file::read_limited(&path, 32_000_000).map_err(|e| e.to_string())?;
        let file = midi_file::MidiFile::from_path_bytes(&path, &bytes)?;
        plan.push(json!({"source":path,"contentId":file.content_id,"bytes":bytes.len(),"title":path.file_stem().unwrap_or_default().to_string_lossy()}));
    }
    let unique = plan
        .iter()
        .filter_map(|v| v["contentId"].as_str())
        .collect::<BTreeSet<_>>()
        .len();
    let mut report = json!({"version":1,"profile":profile,"project":project,"manifestHash":blake3::hash(&manifest_bytes).to_hex().to_string(),"sourceFiles":plan.len(),"distinctPerformances":unique,"plan":plan,"completed":[],"status":"planned","originalFilesModified":false});
    if args.len() == 3 {
        save(&output, &report)?;
        println!(
            "{}",
            json!({"status":"planned","files":plan.len(),"distinctPerformances":unique})
        );
        return Ok(());
    }
    // The lease covers the snapshot and migration. No running application may write this profile.
    let _lease = DataRootLock::acquire(&profile)?;
    let checkpoint = output.with_extension("snapshot");
    std::fs::create_dir_all(&checkpoint).map_err(|e| e.to_string())?;
    let inputs = [
        "web-preferences.json",
        "library-workspace.json",
        "repertoire.json",
        "web-practice-history.ron",
        "library-monitor-files.json",
        "library/songs.sqlite3",
        "library/songs.sqlite3-wal",
        "library/songs.sqlite3-shm",
    ];
    let mut snapshots = Vec::new();
    for name in inputs {
        let source = profile.join(name);
        if source.is_file() {
            let bytes = std::fs::read(&source).map_err(|e| e.to_string())?;
            let target = checkpoint.join(name);
            if target.exists() {
                return Err("迁移快照已存在，请使用新的报告文件名，原快照保持原状".into());
            }
            atomic_file::write_new(&target, &bytes).map_err(|e| e.to_string())?;
            snapshots.push(json!({"relativePath":name,"hash":blake3::hash(&bytes).to_hex().to_string(),"bytes":bytes.len()}));
        }
    }
    save(
        &checkpoint.join("manifest.json"),
        &json!({"profile":profile,"inputs":snapshots,"note":"Exclusive profile snapshot; managed assets are immutable. Original inputs stay in place."}),
    )?;
    report["snapshot"] = json!(checkpoint);
    report["status"] = json!("migrating");
    save(&output, &report)?;
    let result = (|| {
        let preferences = match std::fs::read(profile.join("web-preferences.json")) {
            Ok(b) => serde_json::from_slice::<Value>(&b).map_err(|e| e.to_string())?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
            Err(e) => return Err(e.to_string()),
        };
        let mut repository = SongRepository::open(&profile)?;
        let before = repository.snapshot()?;
        save(
            &checkpoint.join("directory-before.json"),
            &serde_json::to_value(before.0).map_err(|e| e.to_string())?,
        )?;
        for item in &plan {
            let path = PathBuf::from(item["source"].as_str().ok_or("来源位置无效")?);
            let cid = item["contentId"].as_str().ok_or("内容身份无效")?;
            let parts: BTreeMap<usize, PracticePart> = serde_json::from_value(
                preferences["songs"][cid]["parts"]
                    .as_object()
                    .cloned()
                    .map(Value::Object)
                    .unwrap_or_else(|| json!({})),
            )
            .map_err(|e| e.to_string())?;
            let managed = repository.retain_with_parts(
                &path,
                cid,
                item["title"].as_str().unwrap_or("未命名作品"),
                "",
                Some(&parts),
                &|| Ok(()),
            )?;
            if hash(&managed)? != cid || hash(&path)? != cid {
                return Err("迁移期间演奏内容改变，已完成的完整副本保留".into());
            }
            library::load_song_sidecar(&managed, cid).map_err(|e| e.to_string())?;
            report["completed"].as_array_mut().unwrap().push(json!({"source":path,"contentId":cid,"managed":managed,"annotations":library::metadata_sidecar_path(&managed),"annotationHash":hash(&library::metadata_sidecar_path(&managed))?}));
            save(&output, &report)?;
        }
        let registry = repository.registry()?;
        let mut works = BTreeSet::new();
        for item in &plan {
            let cid = item["contentId"].as_str().unwrap();
            works.insert(
                registry
                    .performances
                    .get(cid)
                    .ok_or("迁移后演奏关系缺失")?
                    .work_id
                    .clone(),
            );
        }
        if works.len() != 1 {
            return Err("工程演奏尚未归入同一歌曲，迁移记录已保留供核对".into());
        }
        if std::fs::read(project.join("midi-info.json")).map_err(|e| e.to_string())?
            != manifest_bytes
        {
            return Err("迁移期间歌曲清单改变，已完成的副本保留".into());
        }
        for input in &snapshots {
            let name = input["relativePath"].as_str().unwrap();
            if !name.starts_with("library/")
                && hash(&profile.join(name))? != input["hash"].as_str().unwrap()
            {
                return Err("迁移期间旧资料改变，原始快照已保留".into());
            }
        }
        report["songId"] = json!(works.into_iter().next().unwrap());
        report["playableRows"] = json!(
            repository
                .rows()?
                .iter()
                .filter(|r| r
                    .content_id
                    .as_ref()
                    .is_some_and(|cid| plan.iter().any(|p| p["contentId"].as_str() == Some(cid))))
                .count()
        );
        report["legacyInputsUnchanged"] = json!(true);
        Ok::<_, String>(())
    })();
    report["status"] = json!(if result.is_ok() { "complete" } else { "failed" });
    if let Err(e) = &result {
        report["error"] = json!(e);
    }
    save(&output, &report)?;
    println!(
        "{}",
        json!({"status":report["status"],"files":plan.len(),"distinctPerformances":unique,"completed":report["completed"].as_array().unwrap().len(),"songId":report["songId"]})
    );
    result
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
