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

/// Register `file` in the manifest of `music` (created if needed). Returns the new file id.
fn register(music: &Path, file: &Path, role: &str, stem: Option<&str>, label: &str, tool: &str) -> Result<(), String> {
    manifest_store::edit(music, true, |m, _, dir| {
        let relative = manifest_store::relative_path(dir, file).ok_or("生成的文件与歌曲清单不在同一磁盘")?;
        if m.files.iter().any(|f| f.path.eq_ignore_ascii_case(&relative)) {
            return Ok(((), false));
        }
        let (hash, bytes) = manifest_store::hash_file(file)?;
        let base: String = stem.unwrap_or(match role {
            "performance" => "perf",
            r => r,
        })
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
        let id = (1..).map(|n| if n == 1 { base.clone() } else { format!("{base}{n}") }).find(|id| !m.files.iter().any(|f| &f.id == id) && !m.performances.iter().any(|p| &p.id == id)).unwrap_or(base);
        let mut rest = Map::new();
        rest.insert("provenance".into(), json!({"origin": "generated", "tool": tool, "createdAt": now_ms()}));
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
            "performance" if kind == "midi" => vec![external("transcribe", "从原曲转录")],
            "performance" => vec![local("midi", "由乐谱导出 MIDI"), external("transcribe", "从原曲转录")],
            "musicxml" if kind == "midi" => vec![local("musicxml", "从演奏生成")],
            "musicxml" if kind == "abc" => vec![local("musicxml", "从 ABC 转换")],
            "abc" if kind == "midi" => vec![local("abc", "从演奏生成")],
            "abc" if kind == "musicxml" => vec![local("abc", "从五线谱转换")],
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

    /// Facts and material marks for several songs (the start page's recent list).
    pub(crate) fn song_summaries(&self, paths: Vec<PathBuf>) -> Result<Value, String> {
        self.tasks.run("读取最近的歌曲", None, move |token| {
            let mut out = Map::new();
            for path in paths.into_iter().take(64) {
                token.check()?;
                let key = path.to_string_lossy().to_string();
                let value = match song_summary::summarize(&path, true) {
                    Ok((summary, _)) => {
                        let has = |kind: &str| summary["materials"].as_array().is_some_and(|all| all.iter().any(|m| m["kind"] == kind && m["items"].as_array().is_some_and(|i| i.iter().any(|i| i["state"] != "missing" && i["state"] != "found"))));
                        json!({"facts": summary["facts"], "has": {
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
            "transcribe" | "separate" => {
                let (tool, _) = tool(&self.data).ok_or("需要在设置中指定转录工具")?;
                let (summary, _) = song_summary::summarize(&path, true)?;
                let (source, state) = first_item(&summary, "source").ok_or("这首歌没有原曲音频")?;
                if state == "found" {
                    register(&path, &source, "source", None, "原曲", "panthesia")?;
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
    register(music, &target, role, None, label, "panthesia")?;
    Ok(target)
}

/// The project folder the tool works in: the song's own folder when it already is a tool
/// project, otherwise `<song>_转录` beside it.
fn project_dir(music: &Path) -> PathBuf {
    let dir = music.parent().unwrap_or(Path::new("."));
    if dir.join("source.json").is_file() || dir.join("exports").join("latest.json").is_file() {
        return dir.to_path_buf();
    }
    let stem = music.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "song".into());
    dir.join(format!("{stem}_转录"))
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
    let mut add = |name: &str, role: &str, stem: Option<&str>, label: &str| -> Result<(), String> {
        let file = exports.join(name);
        if file.is_file() {
            register(music, &file, role, stem, label, "music-transcription")?;
            added.push(name.to_string());
        }
        Ok(())
    };
    add("vocals.wav", "stem", Some("vocals"), "人声")?;
    add("piano.wav", "stem", Some("piano"), "钢琴")?;
    if transcribe {
        add("piano_raw.mid", "performance", None, "转录")?;
    }
    // The tool keeps the other stems in its run folder; their sum is the accompaniment.
    if let Some(run) = latest["run"].as_str().map(PathBuf::from) {
        let target = exports.join("accompaniment.wav");
        if !target.is_file() {
            if let Some(stems) = find_stems(&run) {
                mix(&stems, &target)?;
            }
        }
        add("accompaniment.wav", "stem", Some("accompaniment"), "伴奏")?;
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
