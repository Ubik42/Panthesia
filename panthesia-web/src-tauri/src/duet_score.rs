//! Local DuET generation, durable artifacts and reuse, behind the desktop score job boundary.
use crate::{GeneratedScorePreview, State, external_process, score_jobs};
use panthesia_core::{song_project::NotationGeneration, utils::atomic_file};
use panthesia_engine::notation_drafts::{self, DraftRecord};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    process::Command,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
const WORKER: &str = include_str!("duet_worker.py");
static GENERATING: Mutex<()> = Mutex::new(());
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u8,
    generation: NotationGeneration,
    name: String,
    hash: String,
    score: String,
}
fn command(python: &Path, worker: &Path, model: &Path) -> Command {
    let mut command = Command::new(python);
    command
        .arg(worker)
        .arg("--model")
        .arg(model)
        .env("PYTHONUTF8", "1")
        .env("OMP_NUM_THREADS", "2")
        .env("MKL_NUM_THREADS", "2");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
fn prepare(
    data: &Path,
    source: &Path,
    input_bytes: &[u8],
    cid: &str,
    control: Option<&score_jobs::Token>,
) -> Result<(Manifest, Vec<u8>, bool), String> {
    if blake3::hash(input_bytes).to_hex().as_str() != cid {
        return Err("制谱输入与演奏版本不一致".into());
    }
    let _gpu = GENERATING
        .try_lock()
        .map_err(|_| "DuET 正在为另一首歌制谱，请等待当前任务完成")?;
    let runtime = crate::duet_runtime::resolve_checked(data)?;
    let (python, model, device) = (runtime.python, runtime.model, runtime.device);
    let scratch = crate::conversion_files::Scratch::create(data, "midi")?;
    let worker = scratch.dir.join("duet_worker.py");
    std::fs::write(&worker, WORKER).map_err(|e| e.to_string())?;
    if let Some(control) = control {
        control.stage("checkingDuet")?;
    }
    let probe = scratch.dir.join("runtime.json");
    external_process::run(
        command(&python, &worker, &model).arg("--probe").arg(&probe),
        Duration::from_secs(60),
        control,
        "DuET 本地环境核对",
        &scratch.dir.join("probe.log"),
    )?;
    let probe = atomic_file::read_limited(&probe, 32768).map_err(|e| e.to_string())?;
    let identity = blake3::hash(
        &[
            probe,
            WORKER.as_bytes().to_vec(),
            device.as_bytes().to_vec(),
        ]
        .concat(),
    )
    .to_hex()
    .to_string();
    let title = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("钢琴乐谱");
    let id = blake3::hash(
        &serde_json::to_vec(&(1, "duet", cid, &identity, title)).map_err(|e| e.to_string())?,
    )
    .to_hex()
    .to_string();
    let root = data.join("notation-generations").join(&id);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let manifest_path = root.join("manifest.json");
    if let Ok(bytes) = atomic_file::read_limited(&manifest_path, 32768) {
        let value: Manifest = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if value.version != 1
            || value.generation.id != id
            || value.generation.source_content_id != cid
            || value.generation.generator_identity != identity
        {
            return Err("制谱缓存身份与当前输入不同，请重新检查生成目录".into());
        }
        let bytes = atomic_file::read_limited(&data.join(&value.score), 4_000_000)
            .map_err(|e| format!("已有制谱文件无法读取：{e}"))?;
        if blake3::hash(&bytes).to_hex().as_str() != value.hash {
            return Err("已有制谱文件被修改，请将编辑结果作为独立谱面导入".into());
        }
        return Ok((value, bytes, true));
    }
    if let Some(control) = control {
        control.stage("duetGenerating")?;
    }
    let attempt = root.join(format!(
        "run-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::create_dir(&attempt).map_err(|e| e.to_string())?;
    let input = attempt.join("performance.mid");
    std::fs::write(&input, input_bytes).map_err(|e| e.to_string())?;
    let output = attempt.join("result");
    external_process::run(
        command(&python, &worker, &model)
            .arg("--input")
            .arg(&input)
            .arg("--output")
            .arg(&output)
            .arg("--title")
            .arg(title)
            .arg("--source-content-id")
            .arg(cid)
            .arg("--device")
            .arg(&device),
        Duration::from_secs(1800),
        control,
        "DuET 乐谱生成",
        &attempt.join("inference.log"),
    )?;
    if let Some(control) = control {
        control.stage("checkingResult")?;
    }
    let report: serde_json::Value = serde_json::from_slice(
        &atomic_file::read_limited(&output.join("report.json"), 1_000_000)
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if report["status"] != "complete" || report["input_coverage"].as_f64() != Some(1.0) {
        return Err("DuET 未完成整首曲目，生成记录已保存，可查看失败原因".into());
    }
    for name in [
        "score.musicxml",
        "score.mid",
        "notes.json",
        "score.npz",
        "frames.csv",
        "input-identity.json",
        "review.json",
    ] {
        if !std::fs::metadata(output.join(name)).is_ok_and(|m| m.is_file() && m.len() > 0) {
            return Err(format!("DuET 缺少输出 {name}"));
        }
    }
    let bytes = atomic_file::read_limited(&output.join("score.musicxml"), 4_000_000)
        .map_err(|e| e.to_string())?;
    panthesia_notation::musicxml::import_musicxml_document(&bytes).map_err(|e| e.to_string())?;
    let relative = |path: &Path| {
        path.strip_prefix(data)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .map_err(|e| e.to_string())
    };
    let generation = NotationGeneration {
        id: id.clone(),
        generator: "duet".into(),
        generator_identity: identity,
        source_content_id: cid.into(),
        input_kind: "originalPerformance".into(),
        directory: relative(&output)?,
        notes_path: relative(&output.join("notes.json"))?,
        report_path: relative(&output.join("report.json"))?,
    };
    let value = Manifest {
        version: 1,
        generation,
        name: format!("{title} · DuET 乐谱.musicxml"),
        hash: blake3::hash(&bytes).to_hex().to_string(),
        score: relative(&output.join("score.musicxml"))?,
    };
    atomic_file::write(
        &manifest_path,
        &serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok((value, bytes, false))
}
pub async fn generate(
    state: &State,
    content_id: String,
    job: Option<score_jobs::ScoreJobRequest>,
) -> Result<score_jobs::ConversionReply, String> {
    let tracked = job.is_some();
    let guard = state.score_jobs.begin(
        job,
        score_jobs::ScoreJobKind::MidiToNotation,
        &content_id,
        &state.engine,
    )?;
    let control = guard.token();
    let engine = state.engine.clone();
    let data = state.data.clone();
    let generated = state.generated_scores.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        control.stage("readingSource")?;
        let (source, input_bytes) = crate::verified_midi_input(&engine, &content_id)?;
        let (manifest, bytes, reused) =
            prepare(&data, &source, &input_bytes, &content_id, Some(&control))?;
        let token = manifest.generation.id.clone();
        let source_warning = crate::verified_midi_input(&engine, &content_id)
            .err()
            .map(|e| format!("生成完成，原演奏随后变化：{e}"));
        let mut previews = generated.lock().map_err(|_| "谱面预览状态正忙")?;
        crate::score_edit::make_preview_room(&mut previews, Some(&token), |r| {
            (r.cached || r.saved.is_some()).then_some(r.created)
        })?;
        let record = DraftRecord {
            id: token.clone(),
            content_id: content_id.clone(),
            name: manifest.name.clone(),
            kind: "midiToNotation".into(),
            source: source.clone(),
            source_warning: source_warning.clone(),
            book_id: None,
            pages: vec![],
            hash: manifest.hash.clone(),
            size: bytes.len(),
            created_at_ms: crate::score_draft_bridge::now_ms(),
            generation: Some(manifest.generation),
        };
        notation_drafts::store(&data, &record, &bytes)?;
        let existing = notation_drafts::saved(&data, &token, &content_id)?;
        previews.insert(
            token.clone(),
            GeneratedScorePreview {
                created: std::time::Instant::now(),
                content_id,
                source,
                name: manifest.name.clone(),
                hash: manifest.hash,
                saved: existing
                    .clone()
                    .map(serde_json::to_value)
                    .transpose()
                    .map_err(|e| e.to_string())?,
                cached: true,
            },
        );
        let warning = Some(
            [
                source_warning,
                Some(
                    if reused {
                        "已复用同一演奏和生成器的制谱结果。"
                    } else {
                        "DuET 已生成谱面。请核对节奏与分手后采用。"
                    }
                    .into(),
                ),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" "),
        );
        Ok(score_jobs::ScoreDraft {
            name: manifest.name,
            bytes,
            preview_token: token,
            cached: true,
            warning,
            saved: existing,
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    guard.finish(result, tracked)
}
