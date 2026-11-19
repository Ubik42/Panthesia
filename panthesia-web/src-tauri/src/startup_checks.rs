//! Isolated desktop checks. Normal application profiles are never test fixtures.
use panthesia_engine::{Command, Engine};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

#[derive(Clone, Copy)]
pub enum Phase {
    Save,
    Restore,
    ResumePlan,
}
pub fn portable_phase() -> Result<Option<Phase>, String> {
    for argument in std::env::args() {
        if let Some(value) = argument.strip_prefix("--portable-check=") {
            return match value {
                "save" => Ok(Some(Phase::Save)),
                "restore" => Ok(Some(Phase::Restore)),
                "resume-plan" => Ok(Some(Phase::ResumePlan)),
                _ => Err("运行包检查阶段需为 save、restore 或 resume-plan".into()),
            };
        }
    }
    Ok(None)
}
pub fn headless() -> bool {
    panthesia_core::product::env_os("PANTHESIA_HEADLESS_CHECK").is_some()
        || std::env::args().any(|a| a == "--headless-check" || a.starts_with("--portable-check="))
}
pub fn enabled() -> bool {
    headless() || std::env::args().any(|a| a == "--window-check")
}
pub fn configure(
    mut context: tauri::Context<tauri::Wry>,
) -> Result<tauri::Context<tauri::Wry>, String> {
    portable_phase()?;
    if enabled() || panthesia_core::product::env_os("PANTHESIA_DATA_ROOT").is_some() {
        let root = panthesia_core::product::env_os("PANTHESIA_DATA_ROOT")
            .filter(|value| !value.is_empty())
            .ok_or("启动检查需要独立资料目录，请设置 PANTHESIA_DATA_ROOT")?;
        let root = PathBuf::from(root);
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        // This also isolates localStorage, browser cache and window preferences.
        context.config_mut().app.app_directories_override = Some(
            tauri::utils::config::AppDirectoriesOverride::Root(root.join("webview-profile")),
        );
        for window in &mut context.config_mut().app.windows {
            window.data_directory = None;
        }
    }
    Ok(context)
}
pub fn bundled_font(resource_dir: &Path) -> Result<PathBuf, String> {
    let font = resource_dir.join("default.sf2");
    if font.is_file() {
        return Ok(font);
    }
    #[cfg(debug_assertions)]
    {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../default.sf2");
        if development.is_file() {
            return Ok(development);
        }
    }
    Err(format!(
        "运行包缺少钢琴音色：{}。请保留完整程序目录。",
        font.display()
    ))
}

const SCORE: &str = r#"<score-partwise version="4.0"><work><work-title>便携练习检查</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note><note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>"#;
fn command(engine: &Engine, value: Value) -> Result<Value, String> {
    engine.command(serde_json::from_value::<Command>(value).map_err(|e| e.to_string())?)
}
fn require(value: bool, error: &str) -> Result<(), String> {
    if value { Ok(()) } else { Err(error.into()) }
}
fn wait(
    engine: &Engine,
    condition: impl Fn(&panthesia_engine::Snapshot) -> bool,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(12);
    while !condition(&engine.snapshot()) {
        if Instant::now() >= deadline {
            return Err("运行包练习等待超时".into());
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    Ok(())
}
fn rounds(engine: &Engine, count: usize) -> Result<(), String> {
    let before = engine.snapshot().repetitions;
    command(engine, json!({"type":"play"}))?;
    for round in 0..count {
        for pitch in [60, 62, 64, 65] {
            wait(engine, |state| state.required == [pitch])?;
            command(
                engine,
                json!({"type":"note","pitch":pitch,"velocity":95,"active":true}),
            )?;
            command(
                engine,
                json!({"type":"note","pitch":pitch,"velocity":0,"active":false}),
            )?;
        }
        wait(engine, |state| state.repetitions > before + round)?;
    }
    command(engine, json!({"type":"pause"}))?;
    Ok(())
}
fn history(engine: &Engine, cid: &str) -> Result<Vec<Value>, String> {
    let value = command(engine, json!({"type":"historyQuery","limit":20}))?;
    Ok(value["entries"]
        .as_array()
        .ok_or("演奏记录列表无效")?
        .iter()
        .filter(|entry| entry["contentId"] == cid)
        .cloned()
        .collect())
}
fn generated(engine:&Engine,hands:&str)->Result<Value,String> {
    command(engine,json!({"type":"generate","spec":{"tonic":0,"tonality":"Major","minor_form":"Natural","pattern":"Scale",
        "direction":"UpAndDown","hands":hands,"octaves":1,"repetitions":1,"tempo_bpm":60}}))?;
    engine.command(Command::CurrentSong)
}
fn saved_finger(song:&Value,track:&Value)->Option<u64> {
    song["notes"].as_array()?.iter().find(|n|n["track"]==*track && n["index"]==0)?["finger"].as_u64()
}
fn prepare_finger_fixture(engine:&Engine,original:&str)->Result<Value,String> {
    let song=generated(engine,"Both")?;
    let notes=song["notes"].as_array().ok_or("生成指法检查音符缺失")?;
    let right=notes.iter().find(|n|n["part"]=="right" && n["index"]==0).ok_or("生成练习缺少右手首音")?["track"].clone();
    let left=notes.iter().find(|n|n["part"]=="left" && n["index"]==0).ok_or("生成练习缺少左手首音")?["track"].clone();
    command(engine,json!({"type":"finger","track":right,"index":0,"finger":4}))?;
    command(engine,json!({"type":"finger","track":left,"index":0,"finger":2}))?;
    generated(engine,"Left")?;
    command(engine,json!({"type":"finger","track":left,"index":0,"finger":3}))?;
    require(saved_finger(&engine.command(Command::CurrentSong)?,&left)==Some(3),"单手指法编辑未保存")?;
    engine.command(Command::OpenRecent {content_id:original.into()})?;
    Ok(json!({"contentId":song["contentId"],"right":right,"left":left}))
}
fn verify_finger_fixture(engine:&Engine,fixture:&Value,original:&str)->Result<(),String> {
    let song=generated(engine,"Both")?;
    require(song["contentId"]==fixture["contentId"],"生成指法检查曲目身份不一致")?;
    require(saved_finger(&song,&fixture["right"])==Some(4) && saved_finger(&song,&fixture["left"])==Some(3),"再次重启后左右手个人指法未保留")?;
    let reopened=engine.command(Command::OpenRecent {content_id:original.into()})?;
    require(reopened["contentId"]==original && reopened["hasScore"]==true,"指法检查后原练习未恢复")
}
pub fn run(engine: &Engine, data: &Path, phase: Phase) -> Result<Value, String> {
    let checkpoint = data.join("portable-check-session.json");
    let phase_name;
    let initial;
    match phase {
        Phase::Save => {
            phase_name = "save";
            require(
                !checkpoint.exists(),
                "此资料目录已检查过，请为新检查选择空目录",
            )?;
            let song = engine.command(Command::ImportScore {
                bytes: SCORE.as_bytes().to_vec(),
                name: "便携练习检查.musicxml".into(),
                default_bpm: 240,
            })?;
            initial = song["contentId"].as_str().ok_or("导入身份缺失")?.to_owned();
            require(
                song["hasScore"] == true && song["notes"].as_array().is_some_and(|n| n.len() == 4),
                "运行包导入谱面或演奏失败",
            )?;
            command(engine, json!({"type":"mode","value":"wait"}))?;
            command(engine, json!({"type":"countIn","bars":0}))?;
            command(engine, json!({"type":"speed","value":0.75}))?;
            command(
                engine,
                json!({"type":"measureLoop","enabled":true,"start":1,"end":1}),
            )?;
            rounds(engine, 2)?;
            let saved = history(engine, &initial)?;
            require(
                saved.len() == 2 && saved.iter().all(|row| row["score"]["matched_notes"] == 4),
                "运行包的两轮成绩未正确保存",
            )?;
            let routine=command(engine,json!({"type":"saveRoutine","name":"便携日课","notes":"","id":null,"day":null,"copy_of":null}))?;
            let item=command(engine,json!({"type":"saveRoutineItem","routine_id":routine["id"],"content_id":initial,"day":null,"id":null,
                "source":"current","source_id":null,"title":"恢复后慢练","notes":"",
                "goal":{"passes":3,"accuracy":90,"onTime":null,"consecutive":false,"attemptLimit":20}}))?;
            let fingers=prepare_finger_fixture(engine,&initial)?;
            std::fs::write(&checkpoint, serde_json::to_vec_pretty(&json!({"contentId":initial,"routineId":routine["id"],"itemId":item["id"],"fingers":fingers,"historyIds":saved.iter().map(|row| row["id"].clone()).collect::<Vec<_>>()})).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        }
        Phase::Restore => {
            phase_name = "restore";
            let saved: Value =
                serde_json::from_slice(&std::fs::read(&checkpoint).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            initial = saved["contentId"]
                .as_str()
                .ok_or("恢复检查身份缺失")?
                .to_owned();
            let session = engine.command(Command::Session)?;
            require(
                session["song"]["contentId"] == initial && session["song"]["hasScore"] == true,
                "重启后未恢复导入曲目和谱面",
            )?;
            let state = engine.snapshot();
            require(
                !["playing", "countIn"].contains(&state.status.as_str()),
                "重启后意外自动播放",
            )?;
            require(
                (state.speed - 0.75).abs() < 0.0001 && state.passage.is_some(),
                "重启后速度或循环范围未恢复",
            )?;
            let records = history(engine, &initial)?;
            let ids = saved["historyIds"].as_array().ok_or("恢复检查记录缺失")?;
            require(
                records.len() == 2
                    && ids
                        .iter()
                        .all(|id| records.iter().any(|row| &row["id"] == id)),
                "重启后成绩身份发生变化",
            )?;
            let reopened = engine.command(Command::OpenRecent {
                content_id: initial.clone(),
            })?;
            require(
                reopened["contentId"] == initial && reopened["hasScore"] == true,
                "后台重开曲目或谱面失败",
            )?;
            let reopened_state = engine.snapshot();
            require(
                (reopened_state.speed - 0.75).abs() < 0.0001 && reopened_state.passage.is_some(),
                "后台重开后速度或循环范围未恢复",
            )?;
            let history_id = ids
                .first()
                .and_then(Value::as_str)
                .ok_or("恢复检查记录身份缺失")?;
            let historical = engine.command(Command::HistoryOpen {
                content_id: initial.clone(),
                id: history_id.into(),
                restore: true,
            })?;
            require(
                historical["contentId"] == initial
                    && historical["hasScore"] == true
                    && historical["restoreWarning"].is_null(),
                "历史练习曲目或谱面恢复失败",
            )?;
            let history_state = engine.snapshot();
            require(
                (history_state.speed - 0.75).abs() < 0.0001 && history_state.passage.is_some(),
                "历史练习速度或范围恢复失败",
            )?;
            let performance = engine.command(Command::HistoryPerformance {
                content_id: initial.clone(),
                id: history_id.into(),
            })?;
            require(
                performance["references"]
                    .as_array()
                    .is_some_and(|rows| rows.len() == 4),
                "历史演奏读取失败",
            )?;
            let range = engine.command(Command::HistoryPracticeRange {
                content_id: initial.clone(),
                id: history_id.into(),
                reference: 0,
                before: 0,
                after: 0,
            })?;
            require(
                range["practiceRange"]["start"] == 1
                    && range["practiceRange"]["end"] == 1
                    && range["scoreFocus"]["index"].is_u64(),
                "历史问题重练定位失败",
            )?;
            let review = engine.command(Command::HistoryScoreReview {
                content_id: initial.clone(),
                id: history_id.into(),
            })?;
            require(
                review["scoreReview"]["exact"] == true
                    && review["scoreReview"]["notes"]
                        .as_array()
                        .is_some_and(|rows| rows.len() == 4),
                "历史谱面批阅准备失败",
            )?;
            let before_replay = engine.snapshot();
            for source in ["actual", "reference"] {
                let replay = engine.command(Command::StartHistoryReplay {
                    request_id: None,
                    content_id: initial.clone(), id: history_id.into(), source: source.into(), rate: 0.5,
                })?;
                require(replay["history"] == true && replay["id"].is_string(), "历史声音回放启动失败")?;
                let after_replay = engine.snapshot();
                require(after_replay.position == before_replay.position && after_replay.score == before_replay.score,
                    "历史声音回放改变了练习计分或位置")?;
                engine.command(Command::StopFingerDemo { id: replay["id"].as_str().map(str::to_owned) })?;
            }
            let open=command(engine,json!({"type":"openRoutineItem","routine_id":saved["routineId"],"day":"2026-11-13","item_id":saved["itemId"],"resume":true}))?;
            require(open["contentId"]==initial && open["hasScore"]==true,"计划项目后台打开失败")?;
            rounds(engine, 1)?;
            let completed=engine.snapshot();
            require(completed.routine.as_ref().is_some_and(|r|r["progress"]["passed"]==1),"计划项目练习进度未保存")?;
            engine.command(Command::StopRoutine)?;
            command(engine,json!({"type":"openRoutineItem","routine_id":saved["routineId"],"day":"2026-11-13","item_id":saved["itemId"],"resume":true}))?;
            require(engine.snapshot().routine.as_ref().is_some_and(|r|r["progress"]["passed"]==1),"计划项目未恢复原进度")?;
            engine.command(Command::StopRoutine)?;
            require(
                history(engine, &initial)?.len() == 3,
                "重启后未能继续练习并保存新成绩",
            )?;
        }
        Phase::ResumePlan => {
            phase_name="resume-plan";
            let saved:Value=serde_json::from_slice(&std::fs::read(&checkpoint).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
            initial=saved["contentId"].as_str().ok_or("计划检查曲目身份缺失")?.to_owned();
            let before=engine.snapshot();
            require(!["playing","countIn"].contains(&before.status.as_str()),"再次启动时意外自动练习")?;
            let opened=command(engine,json!({"type":"openRoutineItem","routine_id":saved["routineId"],"day":"2026-11-13","item_id":saved["itemId"],"resume":true}))?;
            require(opened["contentId"]==initial && opened["hasScore"]==true,"再次重启后计划曲目或谱面未恢复")?;
            let state=engine.snapshot();
            require(state.routine.as_ref().is_some_and(|r|r["progress"]["passed"]==1 && r["progress"]["attempts"]==1),"再次重启后计划进度未恢复")?;
            require((state.speed-0.75).abs()<0.0001 && state.passage.is_some(),"再次重启后计划速度或范围未恢复")?;
            require(history(engine,&initial)?.len()==3,"再次重启恢复计划意外改变了成绩数量")?;
            engine.command(Command::StopRoutine)?;
            verify_finger_fixture(engine,&saved["fingers"],&initial)?;
        }
    }
    let session = engine.command(Command::Session)?;
    Ok(
        json!({"status":"pass","portableCheckVersion":3,"fingerAnnotationsRestored":matches!(phase,Phase::ResumePlan),"planProgressRestored":matches!(phase,Phase::ResumePlan),"phase":phase_name,"contentId":initial,"song":session["song"],"state":session["state"],"savedRounds":history(engine,&initial)?.len(),"silentPlayback":true}),
    )
}
