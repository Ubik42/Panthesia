use panthesia_engine::{Command, Engine, score_attachments};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command as ProcessCommand, Stdio},
    time::{Duration, Instant},
};

const MAX_SCORE_BYTES: u64 = 4_000_000;
const MAX_RECOGNITION_INPUT_BYTES: usize = 32_000_000;
const MAX_SINGLE_PAGE_BYTES: usize = 48_000_000;
const MAX_RECOGNITION_TIME: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageIdentity {
    pub(super) id: String,
    pub(super) kind: String,
}

#[derive(Clone)]
pub(super) struct RecognizedScorePreview {
    pub(super) created: Instant,
    pub(super) content_id: String,
    pub(super) book_id: String,
    pub(super) pages: Vec<PageIdentity>,
    pub(super) source: PathBuf,
    pub(super) name: String,
    pub(super) hash: String,
    pub(super) saved: Option<Value>,
    pub(super) cached: bool,
}

struct PaperSnapshot {
    name: String,
    pages: Vec<PageIdentity>,
}

fn current_source(engine: &Engine, content_id: &str) -> Result<PathBuf, String> {
    let source = engine.current_source_path(content_id)?;
    if panthesia_music::MidiFile::new(&source)
        .map_err(|e| format!("当前 MIDI 文件无法核对：{e}"))?
        .content_id
        != content_id
    {
        return Err("当前 MIDI 文件内容已改变，请重新打开曲目".into());
    }
    Ok(source)
}

fn snapshot(
    data: &Path,
    content_id: &str,
    book_id: &str,
    expected: &[PageIdentity],
) -> Result<PaperSnapshot, String> {
    if expected.is_empty() || expected.len() > 80 {
        return Err("纸谱页数无效，请重新打开谱面管理".into());
    }
    let listed = score_attachments::list_verified(data, content_id)?;
    let book = listed["attachments"]
        .as_array()
        .and_then(|books| {
            books
                .iter()
                .find(|book| book["id"].as_str() == Some(book_id))
        })
        .ok_or("纸谱版本已移除，请重新打开谱面管理")?;
    let pages = book["pages"].as_array().ok_or("纸谱页序无法读取")?;
    let actual = pages
        .iter()
        .map(|page| PageIdentity {
            id: page["id"].as_str().unwrap_or_default().into(),
            kind: page["kind"].as_str().unwrap_or_default().into(),
        })
        .collect::<Vec<_>>();
    if actual != expected {
        return Err("纸谱页序或内容已改变，请重新打开谱面管理".into());
    }
    if pages.iter().any(|page| page["status"] != "ready") {
        return Err("纸谱副本缺失或内容已改变，请先修复谱页".into());
    }
    let valid = match book["format"].as_str() {
        Some("pdf") => actual.len() == 1 && actual[0].kind == "pdf",
        Some("images") => actual
            .iter()
            .all(|page| matches!(page.kind.as_str(), "png" | "jpeg" | "webp")),
        _ => false,
    };
    if !valid {
        return Err("纸谱格式与谱页内容不一致，请重新打开谱面管理".into());
    }
    let name = book["name"]
        .as_str()
        .unwrap_or("纸谱")
        .chars()
        .take(80)
        .collect();
    Ok(PaperSnapshot {
        name,
        pages: actual,
    })
}

fn verify_snapshot_pages(
    data: &Path,
    content_id: &str,
    book_id: &str,
    pages: &[PageIdentity],
) -> Result<Option<Vec<u8>>, String> {
    let mut total = 0usize;
    let mut single_source = None;
    for (index, page) in pages.iter().enumerate() {
        let (bytes, kind) = score_attachments::read(data, content_id, book_id, index)?;
        if kind != page.kind || blake3::hash(&bytes).to_hex().as_str() != page.id {
            return Err("纸谱内容或页序已改变，请重新打开谱面管理".into());
        }
        total = total
            .checked_add(bytes.len())
            .ok_or("纸谱图片过大，请分成较小的谱本")?;
        let limit = if pages.len() == 1 {
            MAX_SINGLE_PAGE_BYTES
        } else {
            MAX_RECOGNITION_INPUT_BYTES
        };
        if total > limit {
            return Err(format!(
                "这份纸谱的文件总量超过 {} MB，请分成较小的谱本再识别",
                limit / 1_000_000
            ));
        }
        if pages.len() == 1 {
            single_source = Some(bytes);
        }
    }
    Ok(single_source)
}

fn valid_program(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() || !path.is_file() {
        return None;
    }
    let name = path.file_name()?.to_str()?;
    if !name.eq_ignore_ascii_case("Audiveris.bat") && !name.eq_ignore_ascii_case("Audiveris.exe") {
        return None;
    }
    let canonical = fs::canonicalize(path).ok()?;
    let actual = canonical.file_name()?.to_str()?;
    (actual.eq_ignore_ascii_case("Audiveris.bat") || actual.eq_ignore_ascii_case("Audiveris.exe"))
        .then_some(canonical)
}

const PROGRAM_CONFIG: &str = "audiveris-program.json";

fn saved_program(data: &Path) -> Result<Option<PathBuf>, String> {
    let config = data.join(PROGRAM_CONFIG);
    let bytes = match panthesia_core::utils::atomic_file::read_limited(&config, 8192) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("已保存的 Audiveris 程序位置无法读取：{error}")),
    };
    if bytes.len() > 8192 {
        return Err("已保存的 Audiveris 程序位置无效，请重新选择程序".into());
    }
    let path: PathBuf = serde_json::from_slice(&bytes)
        .map_err(|_| "已保存的 Audiveris 程序位置无效，请重新选择程序")?;
    valid_program(&path).map(Some).ok_or_else(|| {
        "已选择的 Audiveris 程序已移动或名称不对，请重新选择 Audiveris.exe 或 Audiveris.bat".into()
    })
}

fn discovered_program() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(key) {
            for folder in [
                "Audiveris",
                "Audiveris\u{005c}bin",
                "Audiveris 5\u{005c}bin",
            ] {
                candidates.push(PathBuf::from(&root).join(folder).join("Audiveris.exe"));
                candidates.push(PathBuf::from(&root).join(folder).join("Audiveris.bat"));
            }
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for folder in std::env::split_paths(&path) {
            candidates.push(folder.join("Audiveris.exe"));
            candidates.push(folder.join("Audiveris.bat"));
        }
    }
    candidates.into_iter().find_map(|path| valid_program(&path))
}

fn resolve_program(data: &Path) -> Result<(PathBuf, &'static str), String> {
    if let Some(path) = saved_program(data)? {
        return Ok((path, "selected"));
    }
    if let Some(configured) = std::env::var_os("AUDIVERIS_EXECUTABLE") {
        return valid_program(Path::new(&configured))
            .map(|path| (path, "environment"))
            .ok_or_else(|| {
                "AUDIVERIS_EXECUTABLE 必须指向 Audiveris.bat 或 Audiveris.exe 文件".into()
            });
    }
    discovered_program()
        .map(|path| (path, "installed"))
        .ok_or_else(|| {
            "没有找到 Audiveris。请选择已安装或便携版的 Audiveris.exe 或 Audiveris.bat".into()
        })
}

fn program_status(data: &Path) -> Value {
    match resolve_program(data) {
        Ok((path, source)) => json!({
            "available": true,
            "path": path.to_string_lossy(),
            "source": source,
            "message": if source == "selected" { "已选择 Audiveris 程序" } else { "已找到 Audiveris 程序" },
        }),
        Err(message) => json!({
            "available": false,
            "path": null,
            "source": if data.join(PROGRAM_CONFIG).exists() { Some("selected") } else { None },
            "message": message,
        }),
    }
}

fn clear_selected_program(data: &Path) -> Result<Value, String> {
    match fs::remove_file(data.join(PROGRAM_CONFIG)) {
        Ok(()) => Ok(program_status(data)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(program_status(data)),
        Err(error) => Err(format!("已选择的 Audiveris 程序位置无法清除：{error}")),
    }
}

fn save_program(data: &Path, candidate: &Path) -> Result<Value, String> {
    let path = valid_program(candidate).ok_or("请选择 Audiveris.exe 或 Audiveris.bat 程序文件")?;
    fs::create_dir_all(data).map_err(|error| format!("Audiveris 程序位置无法保存：{error}"))?;
    let bytes = serde_json::to_vec(&path)
        .map_err(|error| format!("Audiveris 程序位置无法保存：{error}"))?;
    panthesia_core::utils::atomic_file::write(&data.join(PROGRAM_CONFIG), &bytes)
        .map_err(|error| format!("Audiveris 程序位置无法保存：{error}"))?;
    Ok(program_status(data))
}

#[tauri::command]
pub async fn audiveris_program_status(
    state: tauri::State<'_, super::State>,
) -> Result<Value, String> {
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || program_status(&data))
        .await
        .map_err(|error| format!("Audiveris 程序位置读取中断：{error}"))
}

#[tauri::command]
pub async fn reset_audiveris_program(
    state: tauri::State<'_, super::State>,
) -> Result<Value, String> {
    let lease = crate::score_edit::reserve(&state, "audiveris-program-setting")?;
    let data = state.data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        clear_selected_program(&data)
    })
    .await
    .map_err(|error| format!("Audiveris 程序位置重置中断：{error}"))?
}

#[tauri::command]
pub async fn select_audiveris_program(
    state: tauri::State<'_, super::State>,
) -> Result<Value, String> {
    let _lease = crate::score_edit::reserve(&state, "audiveris-program-setting")?;
    let selected = super::file_dialog(&state.data, "audiveris")
        .set_title("选择 Audiveris 程序")
        .add_filter("Audiveris 程序", &["exe", "bat"])
        .pick_file()
        .await;
    let data = state.data.clone();
    let path = selected.map(|file| file.path().to_path_buf());
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = _lease;
        let Some(path) = path else {
            let mut status = program_status(&data);
            status["cancelled"] = json!(true);
            return Ok(status);
        };
        let status = save_program(&data, &path)?;
        super::remember_location(&data, "audiveris", &path, false);
        Ok(status)
    })
    .await
    .map_err(|error| format!("Audiveris 程序位置保存中断：{error}"))?
}

struct Scratch {
    root: PathBuf,
    dir: PathBuf,
}
impl Scratch {
    fn create(data: &Path) -> Result<Self, String> {
        let root = data.join("audiveris-temp");
        fs::create_dir_all(&root).map_err(|e| format!("识谱临时目录无法创建：{e}"))?;
        for attempt in 0..10 {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos();
            let dir = root.join(format!("run-{}-{stamp}-{attempt}", std::process::id()));
            match fs::create_dir(&dir) {
                Ok(()) => return Ok(Self { root, dir }),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(format!("识谱临时目录无法创建：{e}")),
            }
        }
        Err("识谱临时目录名称冲突，请重试".into())
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        if let (Ok(root), Ok(dir)) = (fs::canonicalize(&self.root), fs::canonicalize(&self.dir)) {
            if dir.parent() == Some(root.as_path()) {
                let _ = fs::remove_dir_all(dir);
            }
        }
    }
}

fn generated_mxl(folder: &Path) -> Result<Vec<u8>, String> {
    let mut found = Vec::new();
    let mut pending = vec![(folder.to_path_buf(), 0)];
    while let Some((dir, depth)) = pending.pop() {
        for entry in fs::read_dir(dir).map_err(|e| format!("识谱输出无法读取：{e}"))? {
            let entry = entry.map_err(|e| format!("识谱输出无法读取：{e}"))?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                return Err("识谱输出包含链接，无法安全读取".into());
            }
            if kind.is_dir() && depth < 3 {
                pending.push((entry.path(), depth + 1));
            } else if kind.is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("mxl"))
            {
                found.push(entry.path());
            }
            if found.len() > 1 {
                return Err("Audiveris 生成了多份乐谱，请逐份检查原 PDF 后再识别".into());
            }
        }
    }
    let path = found
        .pop()
        .ok_or("Audiveris 没有生成 MXL 乐谱；请检查纸谱清晰度和日志")?;
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if !(100..=MAX_SCORE_BYTES).contains(&size) {
        return Err("Audiveris 输出为空、不完整或超过 4 MB".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("识谱结果无法读取：{e}"))?;
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err("Audiveris 输出不是 MXL 文件".into());
    }
    Ok(bytes)
}

fn log_excerpt(path: &Path) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut file) = fs::File::open(path) else {
        return String::new();
    };
    let Ok(size) = file.metadata().map(|m| m.len()) else {
        return String::new();
    };
    if file
        .seek(SeekFrom::Start(size.saturating_sub(2048)))
        .is_err()
    {
        return String::new();
    }
    let mut bytes = Vec::new();
    if file.take(2048).read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    let detail = String::from_utf8_lossy(&bytes)
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .collect::<String>();
    let detail = detail.trim();
    if detail.is_empty() {
        String::new()
    } else {
        format!("；Audiveris 日志：{detail}")
    }
}

fn convert_controlled(
    program: &Path,
    scratch: &Scratch,
    source: &[u8],
    kind: &str,
    timeout: Duration,
    control: Option<&crate::score_jobs::Token>,
) -> Result<Vec<u8>, String> {
    let input = scratch.dir.join(format!("source.{kind}"));
    fs::write(&input, source).map_err(|e| format!("纸谱副本无法准备：{e}"))?;
    let output = scratch.dir.join("output");
    fs::create_dir(&output).map_err(|e| format!("识谱输出目录无法创建：{e}"))?;
    let log_path = scratch.dir.join("audiveris.log");
    let log = fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let error_log = log.try_clone().map_err(|e| e.to_string())?;
    let mut command = ProcessCommand::new(program);
    command
        .arg("-batch")
        .arg("-export")
        .arg("-output")
        .arg(&output)
        .arg("--")
        .arg(&input)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(error_log));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Audiveris 无法启动：{e}"))?;
    let status = crate::external_process::wait_with_log(
        &mut child,
        timeout,
        control,
        "Audiveris",
        Some(&log_path),
    )?;
    if !status.success() {
        return Err(format!(
            "Audiveris 识谱失败，退出码 {}{}",
            status.code().unwrap_or(-1),
            log_excerpt(&log_path)
        ));
    }
    generated_mxl(&output).map_err(|e| format!("{e}{}", log_excerpt(&log_path)))
}

#[cfg(test)]
fn convert_with_timeout(
    program: &Path,
    scratch: &Scratch,
    source: &[u8],
    kind: &str,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    convert_controlled(program, scratch, source, kind, timeout, None)
}
#[tauri::command]
pub async fn recognize_paper_with_audiveris(
    state: tauri::State<'_, super::State>,
    transfers: tauri::State<'_, crate::practice_backup_bridge::Sessions>,
    content_id: String,
    book_id: String,
    expected_pages: Vec<PageIdentity>,
    prepared_pdf: Option<Vec<u8>>,
    prepared_pdf_session: Option<String>,
    job: Option<crate::score_jobs::ScoreJobRequest>,
) -> Result<crate::score_jobs::ConversionReply, String> {
    if prepared_pdf.is_some() && prepared_pdf_session.is_some() {
        return Err("识谱 PDF 只能使用一种传输方式".into());
    }
    let uploaded = prepared_pdf_session
        .map(|id| crate::practice_backup_bridge::take_score_input(&transfers, &id))
        .transpose()?;
    let tracked = job.is_some();
    let guard = state.score_jobs.begin(
        job,
        crate::score_jobs::ScoreJobKind::PaperToNotation,
        &content_id,
        &state.engine,
    )?;
    let control = guard.token();
    let engine = state.engine.clone();
    let data = state.data.clone();
    let previews = state.recognized_scores.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        {
            let rows=previews.lock().map_err(|_|"识谱初稿状态不可用")?;
            if rows.len()>=16&&rows.values().all(|row|!row.cached&&row.saved.is_none()) { return Err("已有多份尚未保留的识谱初稿，请先另存当前初稿后继续制作".into()); }
        }
        control.stage("readingSource")?;
        let prepared_pdf = match uploaded {
            Some(input) => Some(input.into_bytes()?),
            None => prepared_pdf,
        };
        let midi_source = current_source(&engine, &content_id)?;
        let before = snapshot(&data, &content_id, &book_id, &expected_pages)?;
        let single_source = verify_snapshot_pages(&data, &content_id, &book_id, &before.pages)?;
        let single_webp = before.pages.len() == 1 && before.pages[0].kind == "webp";
        let (source, kind) = if before.pages.len() > 1 || single_webp {
            let pdf = prepared_pdf.ok_or("图片尚未组成 PDF，请重新识别")?;
            if !(100..=MAX_RECOGNITION_INPUT_BYTES).contains(&pdf.len())
                || !pdf.starts_with(b"%PDF-")
            {
                return Err("图片生成的 PDF 无效或超过 32 MB，请分成较小的谱本".into());
            }
            (pdf, "pdf")
        } else {
            if prepared_pdf.is_some() {
                return Err("这份单页纸谱不需要合成 PDF，请重新识别".into());
            }
            (
                single_source.ok_or("纸谱内容无法读取，请重新打开谱面管理")?,
                before.pages[0].kind.as_str(),
            )
        };
        let (program, _) = resolve_program(&data)?;
        let scratch = Scratch::create(&data)?;
        control.stage("recognizing")?;
        let bytes = convert_controlled(
            &program,
            &scratch,
            &source,
            kind,
            MAX_RECOGNITION_TIME,
            Some(&control),
        )?;
        control.stage("checkingResult")?;
        let source_warning = (|| {
            if crate::verified_midi_source(&engine, &content_id)? != midi_source {
                return Err("来源 MIDI 文件位置已改变".to_string());
            }
            snapshot(&data, &content_id, &book_id, &expected_pages)?;
            verify_snapshot_pages(&data, &content_id, &book_id, &before.pages)?;
            Ok(())
        })().err().map(|error| format!("初稿来自识别开始时的纸谱，来源随后发生变化。识别结果已保留，请先核对：{error}"));
        let name = format!("{} · Audiveris 识谱初稿.mxl", before.name.chars().take(80).collect::<String>());
        let preview_warning = if source_warning.is_none() && engine.snapshot().content_id.as_deref() == Some(&content_id) {
            engine.command(Command::PreviewScoreBytesRoute {
                bytes: bytes.clone(),
                name: name.clone(),
                content_id: content_id.clone(),
            })
            .err().map(|error| format!("识谱初稿已保留，当前尚无法作为演奏乐谱预览。可以另存副本，在制谱软件中校正：{error}"))
        } else { None };
        let hash = blake3::hash(&bytes).to_hex().to_string();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let token = blake3::hash(
            format!(
                "{content_id}:{book_id}:{hash}:{stamp}:{}",
                std::process::id()
            )
            .as_bytes(),
        )
        .to_hex()
        .to_string();
        let mut pending = previews.lock().map_err(|_| "纸谱识别预览正忙")?;
        crate::score_edit::make_preview_room(&mut pending, None, |row| (row.cached || row.saved.is_some()).then_some(row.created))?;
        control.check()?;
        let cache_warning = panthesia_engine::notation_drafts::store(
            &data,
            &panthesia_engine::notation_drafts::DraftRecord {
                id: token.clone(),
                content_id: content_id.clone(),
                name: name.clone(),
                kind: "paperToNotation".into(),
                source: midi_source.clone(),
                source_warning: [source_warning.clone(), preview_warning.clone()].into_iter().flatten().reduce(|a,b| format!("{a}；{b}")),
                book_id: Some(book_id.clone()),
                pages: expected_pages
                    .iter()
                    .map(|page| panthesia_engine::notation_drafts::DraftPage {
                        id: page.id.clone(),
                        kind: page.kind.clone(),
                    })
                    .collect(),
                hash: hash.clone(),
                size: bytes.len(),
                created_at_ms: crate::score_draft_bridge::now_ms(),
                generation:None,
            },
            &bytes,
        )
        .err()
        .map(|error| format!("识谱初稿已生成，但缓存未保存；请在本次会话另存原谱：{error}"));
        let cached = cache_warning.is_none();
        let warnings = [source_warning, preview_warning, cache_warning].into_iter().flatten().collect::<Vec<_>>();
        let warning = (!warnings.is_empty()).then(|| warnings.join(" "));
        control.check()?;
        pending.insert(
            token.clone(),
            RecognizedScorePreview {
                created: Instant::now(),
                saved: None,
                cached,
                content_id,
                book_id,
                pages: expected_pages,
                source: midi_source,
                name: name.clone(),
                hash,
            },
        );
        Ok::<crate::score_jobs::ScoreDraft, String>(crate::score_jobs::ScoreDraft {
            name, bytes, preview_token: token, cached, warning, saved: None,
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    guard.finish(result, tracked)
}

pub(super) fn verify_recognized_preview(
    engine: &Engine,
    data: &Path,
    preview: &RecognizedScorePreview,
    content_id: &str,
    name: &str,
    bytes: &[u8],
) -> Result<(), String> {
    if !preview_matches(preview, content_id, name, bytes) {
        return Err("识谱初稿内容已改变，请重新识别纸谱".into());
    }
    if current_source(engine, content_id)? != preview.source {
        return Err("曲目文件位置已改变，请重新识别纸谱".into());
    }
    let paper = snapshot(data, content_id, &preview.book_id, &preview.pages)?;
    verify_snapshot_pages(data, content_id, &preview.book_id, &paper.pages)?;
    Ok(())
}

fn preview_matches(
    preview: &RecognizedScorePreview,
    content_id: &str,
    name: &str,
    bytes: &[u8],
) -> bool {
    preview.content_id == content_id
        && preview.name == name
        && blake3::hash(bytes).to_hex().as_str() == preview.hash
}

pub(super) fn write_new_mxl(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("mxl"))
    {
        return Err("请将识谱初稿保存为 .mxl 文件".into());
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                "该位置已有文件。请选择新的文件名；软件不会覆盖原谱".into()
            } else {
                format!("识谱文件无法新建：{e}")
            }
        })?;
    use std::io::Write;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(format!("识谱文件写入失败：{error}"));
    }
    drop(file);
    let saved = panthesia_engine::score_sources::read_original(path)
        .map_err(|e| format!("识谱文件已写入，但无法复查：{e}；位置：{}", path.display()))?;
    if saved != bytes {
        return Err(format!(
            "识谱文件已写入，但内容核对失败；请检查文件：{}",
            path.display()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn save_recognized_score_for_edit(
    state: tauri::State<'_, super::State>,
    content_id: String,
    name: String,
    bytes: Vec<u8>,
    preview_token: String,
) -> Result<Option<Value>, String> {
    crate::score_edit::save(
        &state,
        crate::score_edit::Kind::Paper,
        content_id,
        name,
        bytes,
        preview_token,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn program_identity_rejects_other_executable_and_relative_paths() {
        assert!(valid_program(Path::new("Audiveris.bat")).is_none());
        let temp = Scratch::create(
            &std::env::temp_dir().join(format!("neothesia-audiveris-test-{}", std::process::id())),
        )
        .unwrap();
        let other = temp.dir.join("not-audiveris.bat");
        fs::write(&other, b"exit 0").unwrap();
        assert!(valid_program(&other).is_none());
        let program = temp.dir.join("Audiveris.bat");
        fs::write(&program, b"exit 0").unwrap();
        assert_eq!(
            valid_program(&program),
            Some(fs::canonicalize(program).unwrap())
        );
        let executable = temp.dir.join("Audiveris.exe");
        fs::write(&executable, b"mock").unwrap();
        assert_eq!(
            valid_program(&executable),
            Some(fs::canonicalize(executable).unwrap())
        );
    }

    #[test]
    fn chosen_program_persists_and_invalid_selection_keeps_the_previous_path() {
        let temp = Scratch::create(&std::env::temp_dir().join(format!(
            "neothesia-audiveris-choice-test-{}",
            std::process::id()
        )))
        .unwrap();
        let program = temp.dir.join("Audiveris.bat");
        fs::write(&program, b"@echo off\r\n").unwrap();
        let status = save_program(&temp.dir, &program).unwrap();
        let canonical = fs::canonicalize(&program).unwrap();
        assert_eq!(status["available"], true);
        assert_eq!(status["source"], "selected");
        assert_eq!(saved_program(&temp.dir).unwrap(), Some(canonical.clone()));
        assert_eq!(resolve_program(&temp.dir).unwrap(), (canonical, "selected"));
        let other = temp.dir.join("other.bat");
        fs::write(&other, b"@echo off\r\n").unwrap();
        assert!(save_program(&temp.dir, &other).is_err());
        assert_eq!(
            saved_program(&temp.dir).unwrap(),
            Some(fs::canonicalize(program).unwrap())
        );
        fs::write(temp.dir.join(PROGRAM_CONFIG), b"not json").unwrap();
        assert_eq!(program_status(&temp.dir)["available"], false);
        assert_eq!(program_status(&temp.dir)["source"], "selected");
        clear_selected_program(&temp.dir).unwrap();
        assert!(saved_program(&temp.dir).unwrap().is_none());
        clear_selected_program(&temp.dir).unwrap();
    }

    #[test]
    fn output_must_be_one_bounded_mxl() {
        let temp = Scratch::create(&std::env::temp_dir().join(format!(
            "neothesia-audiveris-output-test-{}",
            std::process::id()
        )))
        .unwrap();
        let output = temp.dir.join("output");
        fs::create_dir(&output).unwrap();
        assert!(generated_mxl(&output).is_err());
        let first = output.join("score.mxl");
        fs::write(&first, [b"PK\x03\x04".as_slice(), &[0; 100]].concat()).unwrap();
        assert!(generated_mxl(&output).is_ok());
        fs::write(
            output.join("extra.mxl"),
            [b"PK\x03\x04".as_slice(), &[0; 100]].concat(),
        )
        .unwrap();
        assert!(generated_mxl(&output).is_err());
        fs::remove_file(output.join("extra.mxl")).unwrap();
        fs::write(first, &[0; 100]).unwrap();
        assert!(generated_mxl(&output).is_err());
    }

    #[test]
    fn page_snapshot_detects_reorder_and_replacement() {
        let temp = Scratch::create(&std::env::temp_dir().join(format!(
            "neothesia-audiveris-snapshot-test-{}",
            std::process::id()
        )))
        .unwrap();
        let cid = "test-song";
        let first =
            score_attachments::add(&temp.dir, cid, "第一份", b"%PDF-test".to_vec(), None).unwrap();
        let book = first["active"].as_str().unwrap();
        let pages = vec![PageIdentity {
            id: first["attachments"][0]["pages"][0]["id"]
                .as_str()
                .unwrap()
                .into(),
            kind: "pdf".into(),
        }];
        assert!(snapshot(&temp.dir, cid, book, &pages).is_ok());
        let wrong = vec![PageIdentity {
            id: "wrong".into(),
            kind: "pdf".into(),
        }];
        assert!(snapshot(&temp.dir, cid, book, &wrong).is_err());
        assert!(snapshot(&temp.dir, cid, "removed", &pages).is_err());
        let asset_file = temp
            .dir
            .join("score-attachments")
            .join(blake3::hash(cid.as_bytes()).to_hex().as_str())
            .join(format!("{}.pdf", pages[0].id));
        fs::write(asset_file, b"%PDF-evil").unwrap();
        assert!(snapshot(&temp.dir, cid, book, &pages).is_err());
    }

    #[test]
    fn image_book_snapshot_keeps_order_and_verifies_every_source_page() {
        let temp = Scratch::create(&std::env::temp_dir().join(format!(
            "neothesia-audiveris-image-book-test-{}",
            std::process::id()
        )))
        .unwrap();
        let cid = "image-song";
        let png = b"\x89PNG\r\n\x1a\nfirst".to_vec();
        let jpeg = b"\xff\xd8\xffsecond".to_vec();
        let webp = b"RIFF\x10\x00\x00\x00WEBPthird".to_vec();
        let first = score_attachments::add(&temp.dir, cid, "图片谱", png.clone(), None).unwrap();
        let book = first["active"].as_str().unwrap().to_string();
        score_attachments::add(&temp.dir, cid, "第二页", jpeg.clone(), Some(&book)).unwrap();
        let listed =
            score_attachments::add(&temp.dir, cid, "第三页", webp.clone(), Some(&book)).unwrap();
        let pages = listed["attachments"][0]["pages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|page| PageIdentity {
                id: page["id"].as_str().unwrap().into(),
                kind: page["kind"].as_str().unwrap().into(),
            })
            .collect::<Vec<_>>();
        assert_eq!(pages[2].kind, "webp");
        let paper = snapshot(&temp.dir, cid, &book, &pages).unwrap();
        assert_eq!(paper.pages, pages);
        assert!(
            verify_snapshot_pages(&temp.dir, cid, &book, &pages)
                .unwrap()
                .is_none()
        );
        let reversed = pages.iter().rev().cloned().collect::<Vec<_>>();
        assert!(snapshot(&temp.dir, cid, &book, &reversed).is_err());
        let second_asset = temp
            .dir
            .join("score-attachments")
            .join(blake3::hash(cid.as_bytes()).to_hex().as_str())
            .join(format!("{}.jpeg", pages[1].id));
        fs::write(second_asset, b"\xff\xd8\xffchanged").unwrap();
        assert!(snapshot(&temp.dir, cid, &book, &pages).is_err());
        assert!(verify_snapshot_pages(&temp.dir, cid, &book, &pages).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn mock_batch_runs_without_window_and_requires_real_mxl() {
        let temp = Scratch::create(&std::env::temp_dir().join(format!(
            "neothesia-audiveris-command-test-{}",
            std::process::id()
        )))
        .unwrap();
        let script = temp.dir.join("Audiveris.bat");
        fs::write(&script, b"@echo off\r\necho %1 %2 %3 %5>\"%~4\\arguments.txt\"\r\necho invalid>\"%~4\\result.mxl\"\r\n").unwrap();
        let result = convert_controlled(&script, &temp, b"%PDF-test", "pdf", Duration::from_secs(60), None);
        assert!(
            result
                .as_ref()
                .is_err_and(|e| e.contains("输出为空") || e.contains("不是 MXL"))
        );
        let args = fs::read_to_string(temp.dir.join("output").join("arguments.txt")).unwrap();
        assert!(args.contains("-batch -export -output --"), "{args}");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn mock_batch_returns_one_valid_mxl_file() {
        let temp = Scratch::create(&std::env::temp_dir().join(format!(
            "neothesia-audiveris-success-test-{}",
            std::process::id()
        )))
        .unwrap();
        let fixture = include_bytes!("../../tests/fixtures/pickup-ties.mxl");
        fs::write(temp.dir.join("fixture.mxl"), fixture).unwrap();
        let script = temp.dir.join("Audiveris.bat");
        fs::write(
            &script,
            b"@echo off\r\ncopy /Y \"%~dp0fixture.mxl\" \"%~4\\recognized.mxl\" >NUL\r\n",
        )
        .unwrap();
        assert_eq!(
            convert_controlled(&script, &temp, b"%PDF-test", "pdf", Duration::from_secs(60), None).unwrap(),
            fixture
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn mock_batch_is_stopped_at_timeout() {
        let temp = Scratch::create(&std::env::temp_dir().join(format!(
            "neothesia-audiveris-timeout-test-{}",
            std::process::id()
        )))
        .unwrap();
        let script = temp.dir.join("Audiveris.bat");
        fs::write(&script, b"@echo off\r\n:loop\r\ngoto loop\r\n").unwrap();
        let result = convert_with_timeout(
            &script,
            &temp,
            b"%PDF-test",
            "pdf",
            Duration::from_millis(50),
        );
        assert!(
            result.as_ref().is_err_and(|e| e.contains("超过规定时间")),
            "{result:?}"
        );
    }

    #[test]
    fn recognized_preview_hash_and_save_are_exact() {
        let temp = Scratch::create(&std::env::temp_dir().join(format!(
            "neothesia-audiveris-save-test-{}",
            std::process::id()
        )))
        .unwrap();
        let bytes = include_bytes!("../../tests/fixtures/pickup-ties.mxl");
        let name = "纸谱识别初稿.mxl";
        let preview = RecognizedScorePreview {
            created: Instant::now(),
            saved: None,
            cached: false,
            content_id: "song".into(),
            book_id: "paper".into(),
            pages: vec![],
            source: temp.dir.join("song.mid"),
            name: name.into(),
            hash: blake3::hash(bytes).to_hex().to_string(),
        };
        assert!(preview_matches(&preview, "song", name, bytes));
        assert!(!preview_matches(&preview, "other", name, bytes));
        assert!(!preview_matches(&preview, "song", "changed.mxl", bytes));
        assert!(!preview_matches(&preview, "song", name, b"changed"));
        let path = temp.dir.join(name);
        write_new_mxl(&path, bytes).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert!(write_new_mxl(&path, b"replacement").is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert!(write_new_mxl(&temp.dir.join("wrong.musicxml"), bytes).is_err());
    }
}
