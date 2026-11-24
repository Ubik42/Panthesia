//! Making missing material beside a song (current-plan 3.2). MusicXML, ABC and MIDI are made
//! here from the song's own music; transcription (audio → MIDI) and separation (audio → vocals
//! and accompaniment) run the external `music-transcription` tool as a background task. New
//! files are written next to the song, never over an existing file, and registered in its
//! manifest with `provenance.origin = "generated"`.
use crate::song_summary::{self, extension};
use crate::{Command, Engine, manifest_store};
use panthesia_core::manifest::FileRef;
use panthesia_core::utils::atomic_file;
use serde_json::{Map, Value, json};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const TOOL_CONFIG: &str = "transcription-tool.json";
const TOOL_ENV: &str = "PANTHESIA_TRANSCRIPTION_TOOL";
/// Separation and transcription of a long song on a CPU can take a while.
const TOOL_TIMEOUT: Duration = Duration::from_secs(3 * 60 * 60);
/// Stems mixed into the accompaniment: everything except vocals and the piano the user plays.
const ACCOMPANIMENT: &[&str] = &["bass.wav", "drums.wav", "guitar.wav", "other.wav"];

/// Where the transcription tool is, and how it was found.
pub fn tool_status(data: &Path) -> Value {
    match tool(data) {
        Some((path, source)) => json!({"available": true, "path": path, "source": source}),
        None => json!({"available": false, "path": null, "source": null,
            "message": "需要指定转录工具（music-transcription 的 Run.cmd）"}),
    }
}

fn tool(data: &Path) -> Option<(PathBuf, &'static str)> {
    let saved = atomic_file::read_limited(&data.join(TOOL_CONFIG), 32_768)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<PathBuf>(&bytes).ok())
        .filter(|p| p.is_file());
    if let Some(path) = saved {
        return Some((path, "selected"));
    }
    std::env::var_os(TOOL_ENV).map(PathBuf::from).filter(|p| p.is_file()).map(|p| (p, "environment"))
}

pub fn set_tool(data: &Path, path: Option<PathBuf>) -> Result<Value, String> {
    match path {
        None => match std::fs::remove_file(data.join(TOOL_CONFIG)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("转录工具位置无法清除：{e}")),
        },
        Some(path) => {
            let path = std::path::absolute(&path).map_err(|e| format!("文件位置无法解析：{e}"))?;
            let ok = path.is_file() && matches!(extension(&path).as_str(), "cmd" | "bat" | "exe" | "py");
            if !ok {
                return Err("请选择转录工具的 Run.cmd（或 run.py）".into());
            }
            std::fs::create_dir_all(data).map_err(|e| e.to_string())?;
            let bytes = serde_json::to_vec(&path).map_err(|e| e.to_string())?;
            atomic_file::write(&data.join(TOOL_CONFIG), &bytes).map_err(|e| format!("转录工具位置无法保存：{e}"))?;
        }
    }
    Ok(tool_status(data))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// A path next to `beside` named `<stem>.<ext>`, or `<stem> (2).<ext>` … when taken.
fn free_path(beside: &Path, stem: &str, ext: &str) -> PathBuf {
    let dir = beside.parent().unwrap_or(Path::new("."));
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..1000).map(|n| dir.join(format!("{stem} ({n}).{ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

/// Where a generated file comes from (song-pipeline.md §3): the tool, the step and the files
/// it was made from. `None` registers an input (a file the player brought).
pub(crate) struct Made<'a> {
    pub tool: &'a str,
    pub step: &'a str,
    pub from: Vec<PathBuf>,
}

/// Register `file` in the manifest of `music` (created if needed). A file already registered
/// under the same path gets its hash, size and provenance refreshed (a regenerated output).
fn register(music: &Path, file: &Path, role: &str, stem: Option<&str>, label: &str, made: Option<Made>) -> Result<(), String> {
    manifest_store::edit(music, true, |m, _, dir| {
        let relative = manifest_store::adopt_file(dir, m, file, role, stem, Some(label))?;
        let (hash, bytes) = manifest_store::hash_file(&dir.join(&relative))?;
        let provenance = made.as_ref().map(|made| {
            let from: Vec<String> = made
                .from
                .iter()
                .filter_map(|p| {
                    // By path, or by content (a source brought into the song folder is a hard link).
                    let hash = manifest_store::hash_file(p).ok().map(|(h, _)| h);
                    m.files
                        .iter()
                        .find(|f| manifest_store::resolve(dir, &f.path) == manifest_store::resolve(dir, &p.to_string_lossy()) || (hash.is_some() && f.blake3 == hash))
                        .map(|f| f.id.clone())
                })
                .collect();
            json!({"origin": "generated", "tool": made.tool, "step": made.step, "from": from, "createdAt": now_ms()})
        });
        if let Some(existing) = m.files.iter_mut().find(|f| f.path.eq_ignore_ascii_case(&relative)) {
            let changed = existing.blake3.as_deref() != Some(hash.as_str());
            existing.blake3 = Some(hash);
            existing.bytes = Some(bytes);
            if let Some(p) = provenance {
                existing.rest.insert("provenance".into(), p);
            }
            return Ok(((), changed));
        }
        let base: String = stem.unwrap_or(match role {
            "performance" => "perf",
            r => r,
        })
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
        let id = (1..).map(|n| if n == 1 { base.clone() } else { format!("{base}{n}") }).find(|id| !m.files.iter().any(|f| &f.id == id) && !m.performances.iter().any(|p| &p.id == id)).unwrap_or(base);
        let mut rest = Map::new();
        if let Some(p) = provenance {
            rest.insert("provenance".into(), p);
        }
        m.files.push(FileRef {
            id: id.clone(),
            role: role.into(),
            path: relative,
            blake3: Some(hash),
            bytes: Some(bytes),
            stem: stem.map(str::to_string),
            range: None,
            label: (role != "performance").then(|| label.to_string()),
            rest,
        });
        if role == "performance" {
            let performance = (1..).map(|n| format!("v{n}")).find(|v| !m.performances.iter().any(|p| &p.id == v)).unwrap_or_else(|| "v".into());
            m.performances.push(panthesia_core::manifest::PerformanceRef {
                id: performance,
                file: id,
                label: Some(label.to_string()),
                note_identity: panthesia_core::manifest::NOTE_IDENTITY.into(),
                rest: Map::new(),
            });
        }
        Ok(((), true))
    })?;
    Ok(())
}

/// Record one run of an AI step in `extensions.panthesia.steps` (song-pipeline.md §3).
fn record_step(music: &Path, step: Value) -> Result<(), String> {
    manifest_store::edit(music, true, |m, _, _| {
        let panthesia = m.extensions.entry("panthesia".to_string()).or_insert_with(|| json!({}));
        if !panthesia.is_object() {
            *panthesia = json!({});
        }
        let steps = panthesia.as_object_mut().unwrap().entry("steps").or_insert_with(|| json!([]));
        if let Some(all) = steps.as_array_mut() {
            all.push(step.clone());
        } else {
            *steps = json!([step.clone()]);
        }
        Ok(((), true))
    })?;
    Ok(())
}

/// Mean level of an audio file in dBFS (both channels), or `None` when it cannot be read.
fn level_db(path: &Path) -> Option<f64> {
    let pcm = panthesia_audio::decode(path, 3.0 * 60.0 * 60.0).ok()?;
    let (sum, count) = pcm.left.iter().chain(&pcm.right).fold((0f64, 0usize), |(s, c), v| (s + f64::from(*v) * f64::from(*v), c + 1));
    (count > 0).then(|| 10. * (sum / count as f64).max(1e-12).log10())
}
/// A separated stem counts as empty when it is 30 dB below the piano or below −60 dBFS: the
/// "accompaniment" of a solo piano video is near silence and must not be offered as one.
pub(crate) fn stem_is_empty(stem: Option<f64>, piano: Option<f64>) -> bool {
    match stem {
        None => true,
        Some(level) => level < -60. || piano.is_some_and(|p| level < p - 30.),
    }
}

/// The first usable item of a material in a summary.
fn first_item(summary: &Value, kind: &str) -> Option<(PathBuf, String)> {
    let material = summary["materials"].as_array()?.iter().find(|m| m["kind"] == kind)?;
    material["items"].as_array()?.iter().find_map(|i| {
        let state = i["state"].as_str()?;
        let path = i["path"].as_str()?;
        (state != "missing").then(|| (PathBuf::from(path), state.to_string()))
    })
}

/// Generators for each material, added to a summary for the song page.
fn add_generators(summary: &mut Value, data: &Path) {
    let kind = summary["kind"].as_str().unwrap_or_default().to_string();
    let source = first_item(summary, "source").is_some();
    let tool = tool(data).is_some();
    let external = |id: &str, label: &str| {
        let reason = if !source {
            Some("需要原曲音频")
        } else if !tool {
            Some("需要在设置中指定转录工具")
        } else {
            None
        };
        json!({"id": id, "label": label, "external": true, "available": reason.is_none(), "reason": reason})
    };
    let local = |id: &str, label: &str| json!({"id": id, "label": label, "external": false, "available": true});
    let Some(materials) = summary["materials"].as_array_mut() else { return };
    for material in materials {
        let generators: Vec<Value> = match material["kind"].as_str().unwrap_or_default() {
            "performance" if kind == "midi" || kind == "manifest" => vec![local("practice", "生成练习版 MIDI（分手双轨，按练习版本）"), external("transcribe", "从原曲转录")],
            "performance" => vec![local("midi", "由乐谱导出 MIDI"), external("transcribe", "从原曲转录")],
            "musicxml" if kind == "midi" => vec![local("musicxml", "从演奏生成")],
            "musicxml" if kind == "abc" => vec![local("musicxml", "从 ABC 转换")],
            "abc" if kind == "midi" => vec![local("abc", "从演奏生成")],
            "abc" if kind == "musicxml" => vec![local("abc", "从五线谱转换")],
            // A stem the separation found empty is not offered again.
            "vocals" | "accompaniment" if material["empty"] == true => Vec::new(),
            "vocals" | "accompaniment" => vec![external("separate", "从原曲分离")],
            _ => Vec::new(),
        };
        material["generators"] = Value::Array(generators);
    }
}

impl Engine {
    /// Scan the music folder in the background (at startup); searches see the old index meanwhile.
    pub(crate) fn rescan_songs(&self) {
        let (data, songs) = (self.data.clone(), self.songs.clone());
        let _ = self.tasks.post("扫描曲目文件夹", move |_| Ok(crate::song_index::refresh(&data, &songs)));
    }
    /// The current song's performance file as opened, when it is still the loaded song.
    pub(crate) fn current_song_path(&self) -> Option<PathBuf> {
        let content = self.snapshot().content_id?;
        let opened = self.opened.lock().ok()?.clone()?;
        (opened.0 == content).then_some(opened.1)
    }
    pub(crate) fn remember_opened(&self, path: PathBuf) {
        if let (Some(content), Ok(mut opened)) = (self.snapshot().content_id, self.opened.lock()) {
            *opened = Some((content, path));
        }
    }

    /// The song page's summary: `song_summary` plus generators and the tool status.
    pub(crate) fn song_summary(&self, path: Option<PathBuf>) -> Result<Value, String> {
        let path = path.or_else(|| self.current_song_path()).ok_or("请先打开一首歌")?;
        let data = self.data.clone();
        self.tasks.run("读取歌曲资料", None, move |token| {
            token.stage("reading")?;
            let (mut summary, _) = song_summary::summarize(&path, true)?;
            add_generators(&mut summary, &data);
            summary["tool"] = tool_status(&data);
            Ok(summary)
        })
    }

    /// Facts, material marks and cover picture for several songs (the start page's recent list).
    pub(crate) fn song_summaries(&self, paths: Vec<PathBuf>) -> Result<Value, String> {
        self.tasks.run("读取最近的歌曲", None, move |token| {
            let mut out = Map::new();
            for path in paths.into_iter().take(64) {
                token.check()?;
                let key = path.to_string_lossy().to_string();
                let value = match song_summary::summarize(&path, true) {
                    Ok((summary, _)) => {
                        let has = |kind: &str| summary["materials"].as_array().is_some_and(|all| all.iter().any(|m| m["kind"] == kind && m["items"].as_array().is_some_and(|i| i.iter().any(|i| i["state"] != "missing" && i["state"] != "found"))));
                        json!({"facts": summary["facts"], "cover": cover_path(&summary), "has": {
                            "performance": has("performance"), "score": has("musicxml") || has("abc") || has("paper"),
                            "audio": has("source"), "vocals": has("vocals"), "accompaniment": has("accompaniment"),
                        }})
                    }
                    Err(error) => json!({"error": error}),
                };
                out.insert(key, value);
            }
            Ok(Value::Object(out))
        })
    }

    pub(crate) fn generate_material(&self, kind: String, path: Option<PathBuf>) -> Result<Value, String> {
        let path = path.or_else(|| self.current_song_path()).ok_or("请先打开一首歌")?;
        match kind.as_str() {
            "musicxml" | "abc" | "midi" => {
                let label = match kind.as_str() {
                    "musicxml" => "生成五线谱",
                    "abc" => "生成 ABC 谱",
                    _ => "导出演奏 MIDI",
                };
                let target = path.clone();
                let written = self.tasks.run(label, None, move |token| {
                    token.stage("computing")?;
                    let file = make_local(&target, &kind)?;
                    Ok(json!(file))
                })?;
                let current = self.current_song_path().is_some_and(|p| p == path);
                let mut summary = self.song_summary(Some(path))?;
                summary["written"] = written;
                summary["current"] = json!(current);
                Ok(summary)
            }
            "practice" => {
                // The practice MIDI is made from the open song (its hands and practice version).
                let content_id = self.snapshot().content_id.ok_or("请先打开这首歌")?;
                let path = self.current_song_path().ok_or("请先打开这首歌，再生成练习版 MIDI")?;
                let output = self.prepare_media_export(crate::media_export::MediaExportInput { content_id, kind: crate::media_export::MediaExportKind::HandMidi }, &|| Ok(()))?;
                let target = path.clone();
                let written = self.tasks.run("生成练习版 MIDI", None, move |token| {
                    token.stage("computing")?;
                    Ok(json!(write_practice_midi(&target, &output.bytes)?))
                })?;
                let mut summary = self.song_summary(Some(path))?;
                summary["written"] = written;
                Ok(summary)
            }
            "transcribe" | "separate" => {
                let (tool, _) = tool(&self.data).ok_or("需要在设置中指定转录工具")?;
                let (summary, _) = song_summary::summarize(&path, true)?;
                let (source, state) = first_item(&summary, "source").ok_or("这首歌没有原曲音频")?;
                if state == "found" {
                    register(&path, &source, "source", None, "原曲", None)?;
                }
                let engine = self.clone();
                let transcribe = kind == "transcribe";
                let label = if transcribe { "从原曲转录 MIDI" } else { "从原曲分离人声与伴奏" };
                self.tool_tasks.post(label, move |token| {
                    token.stage(if transcribe { "transcribing" } else { "separating" })?;
                    let added = run_tool(&tool, &path, &source, transcribe, &token)?;
                    if engine.current_song_path().is_some_and(|p| p == path) {
                        let _ = engine.command(Command::ReloadStems);
                    }
                    Ok(json!({"added": added}))
                })?;
                Ok(json!({"started": true}))
            }
            other => Err(format!("不能生成这种资料：{other}")),
        }
    }
}

/// Write the hand-split practice MIDI beside the manifest as `歌名（练习版）.mid` and register
/// it (replacing an earlier one Panthesia made; a file of the player's own is never replaced).
fn write_practice_midi(music: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let (_, song) = song_summary::summarize(music, true)?;
    let found = song.located.as_ref().ok_or("这首歌还没有歌曲清单")?;
    let dir = found.path.parent().ok_or("清单所在目录无法读取")?;
    let base = song.music.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "song".into());
    let name = format!("{base}（练习版）.mid");
    let target = dir.join(&name);
    if target.exists() {
        let ours = found.manifest.files.iter().any(|f| f.path.eq_ignore_ascii_case(&name) && f.rest.get("provenance").and_then(|p| p.get("origin")).and_then(Value::as_str) == Some("generated"));
        if !ours {
            return Err(format!("{name} 已存在且不是 Panthesia 生成的，没有覆盖"));
        }
    }
    atomic_file::write(&target, bytes).map_err(|e| format!("{}：{e}", target.display()))?;
    register(music, &target, "performance", None, "练习版", Some(Made { tool: "panthesia", step: "export", from: vec![song.music.clone()] }))?;
    Ok(target)
}

/// MusicXML, ABC or MIDI made from the song's own music. Returns the written file.
fn make_local(music: &Path, kind: &str) -> Result<PathBuf, String> {
    let (summary, song) = song_summary::summarize(music, true)?;
    let source_kind = summary["kind"].as_str().unwrap_or_default();
    let title = summary["facts"]["title"].as_str().unwrap_or("未命名").to_string();
    let stem = song.music.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "song".into());
    let (fifths, minor) = song_summary::key_signature(&song);
    let engraved = || -> Result<Vec<u8>, String> {
        Ok(panthesia_notation::practice_engraving::engrave_simplified(&song.file, &title, fifths, minor, &|| Ok(()))?.bytes)
    };
    let (target, bytes, role, label) = match kind {
        "musicxml" if source_kind == "abc" => {
            let bytes = std::fs::read(&song.music).map_err(|e| e.to_string())?;
            (free_path(&song.music, &stem, "musicxml"), panthesia_notation::abc::musicxml_from_file_bytes(&bytes)?, "score", "由 ABC 转换")
        }
        "musicxml" => (free_path(&song.music, &stem, "musicxml"), engraved()?, "score", "生成的五线谱"),
        "abc" => {
            // A score source converts directly; a performance goes through engraving first.
            let xml = if source_kind == "musicxml" {
                std::fs::read(&song.music).map_err(|e| e.to_string())?
            } else {
                engraved()?
            };
            let score = panthesia_notation::musicxml::import_musicxml_document(&xml).map_err(|e| format!("乐谱无法读取：{e}"))?;
            let bpm = summary["facts"]["bpm"].as_f64();
            let text = panthesia_notation::abc_write::write(&score, bpm)?;
            (free_path(&song.music, &stem, "abc"), text.into_bytes(), "score", "生成的 ABC 谱")
        }
        _ => {
            if source_kind == "midi" {
                return Err("这首歌已经是 MIDI".into());
            }
            let bytes = std::fs::read(&song.music).map_err(|e| e.to_string())?;
            let bytes = if source_kind == "abc" { panthesia_notation::abc::musicxml_from_file_bytes(&bytes)? } else { bytes };
            let score = panthesia_notation::musicxml::import_musicxml_document(&bytes).map_err(|e| format!("乐谱无法读取：{e}"))?;
            let bpm = summary["facts"]["bpm"].as_f64().unwrap_or(120.).round().clamp(20., 400.) as u16;
            let performance = panthesia_notation::score_performance::generate(&score, bpm)?;
            let mut smf = Vec::new();
            performance.smf.write_std(&mut smf).map_err(|e| format!("MIDI 无法写出：{e}"))?;
            (free_path(&song.music, &stem, "mid"), smf, "performance", "由乐谱导出")
        }
    };
    atomic_file::write(&target, &bytes).map_err(|e| format!("{}：{e}", target.display()))?;
    let step = if role == "performance" { "export" } else { "engrave" };
    register(music, &target, role, None, label, Some(Made { tool: "panthesia", step, from: vec![song.music.clone()] }))?;
    Ok(target)
}

/// The project folder the tool works in: the song's own folder when it already is a tool
/// project, otherwise `转录/` inside the song folder.
fn project_dir(music: &Path) -> PathBuf {
    let dir = music.parent().unwrap_or(Path::new("."));
    if dir.join("source.json").is_file() || dir.join("exports").join("latest.json").is_file() {
        return dir.to_path_buf();
    }
    // Standard layout: the tool's project sits in the song folder as `转录/`.
    dir.join("转录")
}

/// Run the tool to separation (or to a performance MIDI) and register what it produced.
fn run_tool(tool: &Path, music: &Path, source: &Path, transcribe: bool, token: &crate::background_tasks::TaskToken) -> Result<Vec<String>, String> {
    let project = project_dir(music);
    std::fs::create_dir_all(&project).map_err(|e| format!("转录工作目录无法创建：{e}"))?;
    let log = std::fs::File::create(project.join("panthesia-run.log")).map_err(|e| e.to_string())?;
    let until = if transcribe { "midi" } else { "separation" };
    let mut command = if matches!(extension(tool).as_str(), "cmd" | "bat") {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg(tool);
        c
    } else if extension(tool) == "py" {
        let mut c = std::process::Command::new("python");
        c.arg(tool);
        c
    } else {
        std::process::Command::new(tool)
    };
    command
        .arg("--audio")
        .arg(source)
        .arg("--project")
        .arg(&project)
        .arg("--until")
        .arg(until)
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| format!("转录工具无法启动：{e}"))?;
    let started = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if token.check().is_err() || started.elapsed() > TOOL_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(if token.check().is_err() { "已取消".into() } else { "转录工具运行超时".into() });
        }
        std::thread::sleep(Duration::from_millis(500));
    };
    if !status.success() {
        return Err(format!("转录工具运行失败，详情见 {}", project.join("panthesia-run.log").display()));
    }
    token.stage("registering")?;
    let latest = std::fs::read(project.join("exports").join("latest.json")).map_err(|e| format!("转录工具没有写出结果清单：{e}"))?;
    let latest: Value = serde_json::from_slice(&latest).map_err(|e| e.to_string())?;
    let exports = PathBuf::from(latest["directory"].as_str().ok_or("结果清单缺少目录")?);
    let mut added = Vec::new();
    // The other stems stay in the tool's run folder; their sum is the accompaniment.
    if let Some(run) = latest["run"].as_str().map(PathBuf::from) {
        let target = exports.join("accompaniment.wav");
        if !target.is_file() {
            if let Some(stems) = find_stems(&run) {
                mix(&stems, &target)?;
            }
        }
    }
    let piano = level_db(&exports.join("piano.wav"));
    let mut outputs = Vec::new();
    let mut empty = Vec::new();
    for (name, stem, label) in [("piano.wav", "piano", "钢琴"), ("vocals.wav", "vocals", "人声"), ("accompaniment.wav", "accompaniment", "伴奏")] {
        let file = exports.join(name);
        if !file.is_file() {
            continue;
        }
        if stem != "piano" && stem_is_empty(level_db(&file), piano) {
            empty.push(stem);
            continue;
        }
        register(music, &file, "stem", Some(stem), label, Some(Made { tool: "music-transcription", step: "separate", from: vec![source.to_path_buf()] }))?;
        outputs.push(stem);
        added.push(name.to_string());
    }
    record_step(music, json!({"step": "separate", "tool": "BS-RoFormer-SW", "from": ["source"], "outputs": outputs, "empty": empty, "createdAt": now_ms()}))?;
    if transcribe {
        let file = exports.join("piano_raw.mid");
        if file.is_file() {
            let from = if exports.join("piano.wav").is_file() { exports.join("piano.wav") } else { source.to_path_buf() };
            register(music, &file, "performance", None, "转录", Some(Made { tool: "music-transcription", step: "transcribe", from: vec![from] }))?;
            added.push("piano_raw.mid".into());
            record_step(music, json!({"step": "transcribe", "tool": "Transkun", "outputs": ["performance"], "createdAt": now_ms()}))?;
        }
    }
    Ok(added)
}

/// The separation stems (bass, drums, guitar, other) in a tool run folder, up to two levels down.
fn find_stems(run: &Path) -> Option<Vec<PathBuf>> {
    let mut dirs = vec![run.to_path_buf()];
    for _ in 0..2 {
        for dir in dirs.clone() {
            let found: Vec<PathBuf> = ACCOMPANIMENT.iter().map(|n| dir.join(n)).filter(|p| p.is_file()).collect();
            if !found.is_empty() {
                return Some(found);
            }
            if let Ok(entries) = std::fs::read_dir(&dir) {
                dirs.extend(entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()));
            }
        }
    }
    None
}

/// Sum stems into one 16-bit stereo WAV, scaled down only when the sum would clip.
fn mix(stems: &[PathBuf], target: &Path) -> Result<(), String> {
    let mut rate = 44_100;
    let (mut left, mut right): (Vec<f32>, Vec<f32>) = (Vec::new(), Vec::new());
    for stem in stems {
        let pcm = panthesia_audio::decode(stem, 3.0 * 60.0 * 60.0)?;
        rate = pcm.rate;
        if left.len() < pcm.left.len() {
            left.resize(pcm.left.len(), 0.);
            right.resize(pcm.right.len(), 0.);
        }
        for (i, (l, r)) in pcm.left.iter().zip(&pcm.right).enumerate() {
            left[i] += l;
            right[i] += r;
        }
    }
    let peak = left.iter().chain(&right).fold(0f32, |m, v| m.max(v.abs()));
    let gain = if peak > 0.999 { 0.999 / peak } else { 1.0 };
    let frames = left.len();
    let data_bytes = (frames * 4) as u32;
    let mut out = Vec::with_capacity(44 + frames * 4);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 4).to_le_bytes());
    out.extend_from_slice(&4u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_bytes.to_le_bytes());
    for i in 0..frames {
        for v in [left[i], right[i]] {
            out.extend_from_slice(&(((v * gain).clamp(-1., 1.) * 32767.).round() as i16).to_le_bytes());
        }
    }
    atomic_file::write(target, &out).map_err(|e| format!("伴奏无法写入：{e}"))
}

/// The song's picture: a cover listed in the summary's materials whose file exists.
pub(crate) fn cover_path(summary: &Value) -> Value {
    summary["materials"]
        .as_array()
        .and_then(|all| all.iter().find(|m| m["kind"] == "cover"))
        .and_then(|m| m["items"].as_array())
        .and_then(|items| items.iter().find(|i| i["state"] != "missing").map(|i| i["path"].clone()))
        .unwrap_or(Value::Null)
}

/// A song picture for the interface, as a data URL (images only, at most 12 MB).
pub(crate) fn song_cover(path: &std::path::Path) -> Result<Value, String> {
    use base64::Engine as _;
    let ext = song_summary::extension(path);
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => return Err("只能读取 JPG、PNG 或 WebP 图片".into()),
    };
    let meta = std::fs::metadata(path).map_err(|e| format!("图片无法读取：{e}"))?;
    if meta.len() > 12 * 1024 * 1024 {
        return Err("图片超过 12 MB".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("图片无法读取：{e}"))?;
    Ok(json!({"dataUrl": format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))}))
}
