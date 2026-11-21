//! Check a migrated data root (companion of `migrate_library`): open every song of
//! `recent-files.json` through the engine and compare what the program sees with the old data.
//!
//! ```text
//! cargo run -p panthesia-engine --example verify_migration -- <data root> <old web-preferences.json>
//! ```
use panthesia_engine::{Command, Engine, data_root_lock::DataRootLock};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;

fn main() {
    let mut args = std::env::args().skip(1);
    let data = PathBuf::from(args.next().expect("data root"));
    let old: Value = serde_json::from_slice(&std::fs::read(args.next().expect("old preferences")).unwrap()).unwrap();
    let recent: Value = serde_json::from_slice(&std::fs::read(data.join("recent-files.json")).unwrap()).unwrap();
    let font = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../default.sf2");
    let lock = DataRootLock::acquire(&data).unwrap();
    let engine = Engine::start(data.clone(), lock, font, true).unwrap();
    engine.wait_until_ready(Duration::from_secs(30)).unwrap();
    let mut failures = 0;
    for item in recent["items"].as_array().unwrap() {
        let path = PathBuf::from(item["path"].as_str().unwrap());
        let title = item["title"].as_str().unwrap();
        if let Err(e) = engine.command(Command::OpenFile { path: path.clone() }) {
            println!("! {title}：打开失败 {e}");
            failures += 1;
            continue;
        }
        let snap = serde_json::to_value(engine.snapshot()).unwrap();
        let cid = snap["contentId"].as_str().unwrap_or_default().to_string();
        let mut problems = Vec::new();
        if let Some(e) = snap.get("error").filter(|e| !e.is_null()) {
            problems.push(format!("错误 {e}"));
        }
        // Practice settings: the old per-song entry must reach the manifest unchanged.
        let manifest = panthesia_engine::manifest_store::locate(&path).ok().flatten();
        let expected = &old["songs"][&cid];
        match &manifest {
            Some(found) => {
                let practice = found
                    .manifest
                    .settings
                    .get("practice")
                    .cloned()
                    .unwrap_or(Value::Null);
                // Normal differences: `adaptive` belonged to the removed assessment mode, and
                // `parts` is filled from the song's hand layer when the old entry was empty.
                let mut expected = expected.clone();
                if let Some(o) = expected.as_object_mut() {
                    o.remove("adaptive");
                    if o.get("parts").is_some_and(|p| p.as_object().is_some_and(|p| p.is_empty())) {
                        if let Some(parts) = practice.get("parts") {
                            o.insert("parts".into(), parts.clone());
                        }
                    }
                }
                if !expected.is_null() && practice != expected {
                    problems.push(format!("练习设置不同\n    旧 {expected}\n    新 {practice}"));
                }
                for file in &found.manifest.files {
                    let target = found.path.parent().unwrap().join(&file.path);
                    if !target.is_file() {
                        problems.push(format!("清单引用的文件不存在 {}", target.display()));
                    }
                }
            }
            None => problems.push("没有清单".into()),
        }
        let files = engine.command(Command::SongFiles).unwrap_or_default();
        let scores = files.to_string().matches("\"score\"").count();
        if problems.is_empty() {
            println!("ok {title}（{}，谱面引用 {scores}）", &cid[..12.min(cid.len())]);
        } else {
            failures += 1;
            println!("! {title}：{}", problems.join("；"));
        }
    }
    println!("核对完成，失败 {failures}");
    std::process::exit(if failures > 0 { 1 } else { 0 });
}
