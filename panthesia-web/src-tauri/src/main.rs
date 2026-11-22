#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
mod state_push;
mod app_paths;
mod diagnostics;
mod score_batch_export;
mod score_jobs;
mod score_draft_bridge;
mod score_edit;
mod pdf_conversion;
mod score_export_bridge;
mod export_files;
mod media_export_bridge;
mod external_process;
mod duet_score;
mod duet_runtime;
mod file_transfer;
mod audiveris_paper;
mod startup_checks;
mod desktop_close;
mod build_info;
mod musescore_program;
mod conversion_files;
mod located_paper_bridge;
mod open_requests;
use panthesia_engine::{Command, Engine, data_root_lock::DataRootLock};
use std::path::PathBuf;
use tauri::Manager;

struct State {
    score_jobs: score_jobs::Jobs,
    score_saves: std::sync::Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    closing: std::sync::atomic::AtomicBool,
    close_allowed: std::sync::atomic::AtomicBool,
    allow_closing_drafts: std::sync::atomic::AtomicBool,
    desktop_close: desktop_close::Bridge,
    engine: Engine,
    data: PathBuf,
    font: PathBuf,
    bundled_font: PathBuf,
    soundfont_status: std::sync::Arc<std::sync::Mutex<SoundFontStatus>>,
    soundfont_change: std::sync::Arc<std::sync::Mutex<()>>,
    score_imports: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String,std::sync::Arc<std::sync::atomic::AtomicBool>>>>,
    generated_scores: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String,GeneratedScorePreview>>>,
    recognized_scores: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String,audiveris_paper::RecognizedScorePreview>>>,
}

#[derive(Clone,serde::Serialize)]
#[serde(rename_all="camelCase")]
struct SoundFontStatus {
    path: Option<String>,
    label: String,
    is_default: bool,
    warning: Option<String>,
}

fn soundfont_config(data:&std::path::Path)->PathBuf {data.join("soundfont.json")}

fn save_soundfont(data:&std::path::Path,path:&std::path::Path)->Result<(),String>{
    let target=soundfont_config(data);
    let bytes=serde_json::to_vec_pretty(&serde_json::json!({"path":path})).map_err(|e|e.to_string())?;
    panthesia_core::utils::atomic_file::write(&target,&bytes).map_err(|e|format!("无法写入音源设置：{e}"))
}

fn saved_soundfont(data:&std::path::Path)->(Option<PathBuf>,Option<String>){
    let file=soundfont_config(data);
    if !file.exists(){return (None,None)}
    let value=panthesia_core::utils::atomic_file::read_limited(&file,1_000_000).ok().and_then(|bytes|serde_json::from_slice::<serde_json::Value>(&bytes).ok());
    let Some(path)=value.as_ref().and_then(|value|value["path"].as_str()).map(PathBuf::from) else {
        return (None,Some("已保存的音源设置无效，已使用随包钢琴音源".into()))
    };
    if !path.is_absolute(){return (None,Some("已保存的音源路径不是绝对路径，已使用随包钢琴音源".into()))}
    if !path.is_file(){return (None,Some(format!("已保存的音源文件已找不到（{}），已使用随包钢琴音源",path.display())))}
    (Some(path),None)
}

fn soundfont_status(path:&std::path::Path,bundled:&std::path::Path,warning:Option<String>)->SoundFontStatus{
    let is_default=path==bundled || path.canonicalize().ok().zip(bundled.canonicalize().ok()).is_some_and(|(left,right)|left==right);
    SoundFontStatus{
        path:if is_default{None}else{Some(path.to_string_lossy().to_string())},
        label:if is_default{"随包钢琴音源".into()}else{path.file_name().unwrap_or_default().to_string_lossy().to_string()},
        is_default,
        warning,
    }
}

#[tauri::command]
async fn get_soundfont_status(state:tauri::State<'_,State>)->Result<SoundFontStatus,String>{
    let engine=state.engine.clone();let status=state.soundfont_status.clone();let bundled=state.bundled_font.clone();let change=state.soundfont_change.clone();
    tauri::async_runtime::spawn_blocking(move|| {
        let _change=change.lock().map_err(|e|e.to_string())?;
        let snapshot=engine.snapshot();
        let previous=status.lock().map_err(|e|e.to_string())?.clone();
        if !snapshot.startup.ready{return Ok(previous);}
        let warning=snapshot.soundfont_warning.or(previous.warning);
        let current=soundfont_status(&snapshot.soundfont,&bundled,warning);
        *status.lock().map_err(|e|e.to_string())?=current.clone();
        Ok(current)
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn select_soundfont(state:tauri::State<'_,State>)->Result<Option<SoundFontStatus>,String>{
    let lease=score_edit::reserve(&state,"soundfont-selection")?;
    let Some(file)=file_dialog(&state.data,"soundfont").set_title("选择本机 SoundFont 音源").add_filter("SoundFont 音源", &["sf2"]).pick_file().await else{return Ok(None)};
    let path=file.path().to_path_buf();
    let engine=state.engine.clone();let data=state.data.clone();let bundled=state.bundled_font.clone();
    let status=state.soundfont_status.clone();let change=state.soundfont_change.clone();
    let selected=tauri::async_runtime::spawn_blocking(move||{
        let _lease=lease;
        let path=path.canonicalize().map_err(|e|format!("无法读取音源文件：{e}"))?;
        if !path.extension().and_then(|extension|extension.to_str()).is_some_and(|extension|extension.eq_ignore_ascii_case("sf2")){return Err("请选择 .sf2 音源文件".into())}
        let _guard=change.lock().map_err(|e|e.to_string())?;
        let previous=status.lock().map_err(|e|e.to_string())?.clone();
        engine.command(Command::SoundFont{path:path.clone()})?;
        if let Err(error)=save_soundfont(&data,&path){
            let restore=previous.path.as_ref().map(PathBuf::from).unwrap_or(bundled.clone());
            let _=engine.command(Command::SoundFont{path:restore});
            return Err(format!("音源设置保存失败：{error}"))
        }
        remember_location(&data,"soundfont",&path,false);
        let current=soundfont_status(&path,&bundled,None);
        *status.lock().map_err(|e|e.to_string())?=current.clone();
        Ok::<_,String>(current)
    }).await.map_err(|e|e.to_string())??;
    Ok(Some(selected))
}

#[tauri::command]
async fn reset_soundfont(state:tauri::State<'_,State>)->Result<SoundFontStatus,String>{
    let lease=score_edit::reserve(&state,"soundfont-reset")?;
    let engine=state.engine.clone();let bundled=state.bundled_font.clone();let data=state.data.clone();
    let status=state.soundfont_status.clone();let change=state.soundfont_change.clone();
    tauri::async_runtime::spawn_blocking(move||{
        let _lease=lease;
        let _guard=change.lock().map_err(|e|e.to_string())?;
        let previous=status.lock().map_err(|e|e.to_string())?.clone();
        engine.command(Command::SoundFont{path:bundled.clone()})?;
        let config=soundfont_config(&data);
        if let Err(error)=std::fs::remove_file(&config){if error.kind()!=std::io::ErrorKind::NotFound{
            let restore=previous.path.as_ref().map(PathBuf::from).unwrap_or(bundled.clone());
            let _=engine.command(Command::SoundFont{path:restore});
            return Err(format!("恢复钢琴音源后无法保存设置：{error}"))
        }}
        let current=soundfont_status(&bundled,&bundled,None);
        *status.lock().map_err(|e|e.to_string())?=current.clone();
        Ok::<_,String>(current)
    }).await.map_err(|e|e.to_string())?
}

#[derive(Clone)]
struct GeneratedScorePreview {
    created: std::time::Instant,
    content_id: String,
    source: PathBuf,
    name: String,
    hash: String,
    saved: Option<serde_json::Value>,
    cached: bool,
}

fn file_dialog(data:&std::path::Path,kind:&str)->rfd::AsyncFileDialog{let dialog=rfd::AsyncFileDialog::new();if let Some(path)=panthesia_engine::file_locations::initial(data,kind){dialog.set_directory(path)}else{dialog}}
fn remember_location(data:&std::path::Path,kind:&str,path:&std::path::Path,folder:bool){if let Err(error)=panthesia_engine::file_locations::remember(data,kind,path,folder){eprintln!("{error}");}}

/// The program uses the GUI subsystem; attach to the calling console so `probe` output is
/// visible when run by hand. Redirected output (pipes, files) works without it.
fn attach_parent_console() {
    #[cfg(windows)]
    unsafe {
        unsafe extern "system" {
            fn AttachConsole(process: u32) -> i32;
            fn GetStdHandle(kind: u32) -> isize;
        }
        const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
        const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
        // Keep inherited pipes and files; attach only when there is no output handle.
        let handle = GetStdHandle(STD_OUTPUT_HANDLE);
        if handle == 0 || handle == -1 {
            AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
}
fn headless_check() -> bool {
    startup_checks::headless()
}
fn startup_check() -> bool {
    startup_checks::enabled()
}
fn startup_stage(label: &str) {
    if !startup_check() { return; }
    let Some(path)=panthesia_core::product::env_os("PANTHESIA_STARTUP_CHECK_LOG") else { return; };
    if let Ok(mut file)=std::fs::OpenOptions::new().create(true).append(true).open(path) {
        use std::io::Write;
        let _=writeln!(file,"stage={label}");
    }
}

#[tauri::command]
async fn open_practice_data_folder(state:tauri::State<'_,State>)->Result<(),String> {
    let data=state.data.clone();
    tauri::async_runtime::spawn_blocking(move|| {
        let data=data.canonicalize().map_err(|e|format!("练习资料目录无法读取：{e}"))?;
        #[cfg(target_os="windows")]
        {
            let value=data.to_string_lossy();
            let value=if let Some(unc)=value.strip_prefix(r"\\?\UNC\"){format!(r"\\{unc}")}else{value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()};
            std::process::Command::new("explorer.exe").arg(value).spawn().map_err(|e|format!("资料文件夹无法打开：{e}"))?;
        }
        #[cfg(target_os="macos")]
        {std::process::Command::new("open").arg(data).spawn().map_err(|e|e.to_string())?;}
        #[cfg(all(not(target_os="windows"),not(target_os="macos")))]
        {std::process::Command::new("xdg-open").arg(data).spawn().map_err(|e|e.to_string())?;}
        Ok(())
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn reveal_library_file(state:tauri::State<'_,State>,path:PathBuf)->Result<(),String>{
    let _ = &state;
    tauri::async_runtime::spawn_blocking(move||{
        let requested_file=path.is_file();
        let mut target=path.clone();
        if !requested_file {while !target.is_dir(){if !target.pop(){return Err("原文件和上级文件夹均不可用".into());}}}
        let target=target.canonicalize().map_err(|e|format!("无法打开文件位置：{e}"))?;
        #[cfg(target_os="windows")]
        {let text=target.to_string_lossy();let text=if let Some(unc)=text.strip_prefix(r"\\?\UNC\"){format!(r"\\{unc}")}else{text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()};let arg=if requested_file{format!("/select,{text}")}else{text.to_string()};std::process::Command::new("explorer.exe").arg(arg).spawn().map_err(|e|format!("无法打开文件位置：{e}"))?;}
        #[cfg(target_os="macos")]
        {let mut command=std::process::Command::new("open");if requested_file{command.arg("-R");}command.arg(&target).spawn().map_err(|e|e.to_string())?;}
        #[cfg(all(not(target_os="windows"),not(target_os="macos")))]
        {let directory=if requested_file{target.parent().ok_or("文件上级位置无效")?}else{target.as_path()};std::process::Command::new("xdg-open").arg(directory).spawn().map_err(|e|e.to_string())?;}
        Ok(())
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn native_startup_check(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    ready: bool,
    notation_ready: bool,
    pdf_ready:bool,
) -> Result<(), String> {
    if !startup_check() {
        return Err("启动检查仅在隐藏验证模式启用".into());
    }
    startup_stage("native_check_called");
    if std::env::args().any(|a| a == "--window-check") {
        let window = app.get_webview_window("main").ok_or("主窗口未创建")?;
        if !window.is_visible().map_err(|e| e.to_string())? {
            startup_stage("window_not_visible");
            return Err("主窗口没有显示".into());
        }
        startup_stage("window_visible");
    }
    let engine = state.engine.clone();
    // The check opens the bundled five-finger exercise from the data folder.
    let starter = state.data.join("startup-check").join("five-finger.mid");
    std::fs::create_dir_all(starter.parent().ok_or("检查目录无效")?).map_err(|e| e.to_string())?;
    std::fs::write(&starter, include_bytes!("../../../panthesia-engine/assets/five-finger.mid")).map_err(|e| e.to_string())?;
    let font = state.font.clone();
    let _data = state.data.clone();
    let _bundled_font = state.bundled_font.clone();
    let _webview_data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        startup_stage("native_worker_started");
        if !pdf_ready {return Err("PDF 谱页渲染器未通过桌面检查".into());}
        if !notation_ready {return Err("桌面乐谱 WASM 渲染器未通过启动检查".into());}
        if !ready { return Err("桌面前端未完成真实引擎连接".into()); }
        startup_stage("frontend_evidence_ready");
        let song = engine.command(Command::OpenFile { path: starter })?;
        startup_stage("song_loaded");
        if song["notes"].as_array().map(Vec::len) != Some(9) { return Err("内置练习解析失败".into()); }
        engine.command(Command::Speed { value: 0.5 })?;
        startup_stage("speed_set");
        panthesia_engine::probe_audio(&font)?;
        startup_stage("audio_ready");
        if let Some(path) = panthesia_core::product::env_os("PANTHESIA_STARTUP_CHECK_LOG") {
            std::fs::write(path, format!("PASS\nvisible={}\nfrontend=ready\nIPC=ready\nnotes=9\naudio=ready\nnotationWasm=ready\npdfPages=ready\nmidiConnected={}\n", !headless_check(),engine.snapshot().input_connected)).map_err(|e| e.to_string())?;
        }
        Ok(())
    }).await.unwrap_or_else(|error|Err(format!("启动检查线程未完成：{error}")));
    match result {
        Ok(()) => app.exit(0),
        Err(e) => {
            if let Some(path) = panthesia_core::product::env_os("PANTHESIA_STARTUP_CHECK_LOG") {
                let stages=std::fs::read_to_string(&path).unwrap_or_default();
                let _ = std::fs::write(path, format!("FAILED\n{e}\n{stages}"));
            }
            app.exit(1);
        }
    }
    Ok(())
}

#[tauri::command]
async fn score_attachment_bytes(state:tauri::State<'_,State>,content_id:String,id:String,page:usize,preview_kind:Option<String>,expected_asset:Option<String>)->Result<tauri::ipc::Response,String>{
 let data=state.data.clone();tauri::async_runtime::spawn_blocking(move||(if let Some(kind)=preview_kind{panthesia_engine::score_attachments::read_source_preview(&data,&content_id,&id,&kind)}else{panthesia_engine::score_attachments::read_expected(&data,&content_id,&id,page,expected_asset.as_deref())}).map(|(bytes,_)|tauri::ipc::Response::new(bytes))).await.map_err(|e|e.to_string())?
}
/// Pick a file to list in the current song's manifest, starting in the song's folder.
#[tauri::command]
async fn pick_song_file(state:tauri::State<'_,State>,kind:String,near:Option<PathBuf>)->Result<Option<String>,String>{
    let _close_lease=score_edit::reserve(&state,"native-pick-song-file")?;
    let mut dialog=file_dialog(&state.data,"music");
    if let Some(folder)=near.as_deref().and_then(std::path::Path::parent).filter(|p|p.is_dir()){dialog=dialog.set_directory(folder);}
    let dialog=match kind.as_str(){
        "music"=>dialog.set_title("打开乐曲").add_filter("乐曲与歌曲清单", &["mid","midi","kar","musicxml","mxl","xml","abc","panthesia"]),
        "performance"=>dialog.set_title("选择同一首歌的另一个 MIDI 版本").add_filter("MIDI", &["mid","midi","kar"]),
        "paper"=>dialog.set_title("选择谱页原件").add_filter("谱页", &["pdf","png","jpg","jpeg","webp"]),
        _=>dialog.set_title("选择伴奏、人声或原音频").add_filter("音频与视频", &["wav","mp3","flac","ogg","m4a","aac","opus","mp4","mkv","webm"]),
    };
    let Some(file)=dialog.pick_file().await else{return Ok(None)};
    Ok(Some(file.path().to_string_lossy().into()))
}
#[tauri::command]
async fn pick_paper_source(state:tauri::State<'_,State>)->Result<Option<String>,String>{
    let _close_lease=score_edit::reserve(&state,"native-pick-paper-source")?;

 let Some(file)=file_dialog(&state.data,"paper").set_title("选择内容相同的谱页原件").add_filter("谱页", &["pdf","png","jpg","jpeg","webp"]).pick_file().await else{return Ok(None)};
 remember_location(&state.data,"paper",file.path(),false);Ok(Some(file.path().to_string_lossy().into()))
}
fn link_imported_paper_source(engine:&panthesia_engine::Engine,cid:&str,value:&serde_json::Value,path:PathBuf,hash:&str)->Result<(),String>{
 let book=value["active"].as_str().ok_or("谱面版本编号缺失")?;
 engine.command(Command::LinkPaperSource{content_id:cid.into(),book:book.into(),asset:hash.into(),path:Some(path),baseline:None}).map(|_|()).map_err(|e|format!("谱面已保存，原件关联失败：{e}"))
}
#[tauri::command]
async fn import_score_attachments(state:tauri::State<'_,State>,content_id:String,append:Option<String>)->Result<Option<serde_json::Value>,String>{
    let _close_lease=score_edit::reserve(&state,"native-import-score-attachments")?;
    let _close_worker=_close_lease.clone();

 let Some(files)=file_dialog(&state.data,"paper").set_title("添加 PDF 或图片谱面").add_filter("谱面", &["pdf","png","jpg","jpeg","webp"]).pick_files().await else{return Ok(None)};
 for file in &files{remember_location(&state.data,"paper",file.path(),false);}
 let paths=files.into_iter().map(|f|f.path().to_path_buf()).collect::<Vec<_>>();let engine=state.engine.clone();
 tauri::async_runtime::spawn_blocking(move||{let _close_worker=_close_worker;let mut results=Vec::new();let only_append=append.is_some();let mut append_to=append;for path in paths{let result=(||->Result<serde_json::Value,String>{if std::fs::metadata(&path).map_err(|e|e.to_string())?.len()>48_000_000{return Err("谱面超过 48 MB".into())}let bytes=std::fs::read(&path).map_err(|e|e.to_string())?;let image=!bytes.starts_with(b"%PDF-");let hash=blake3::hash(&bytes).to_hex().to_string();let value=engine.command(Command::AddScoreAttachment{content_id:content_id.clone(),name:path.file_name().unwrap_or_default().to_string_lossy().into(),bytes,append:if image||only_append{append_to.clone()}else{None}})?;link_imported_paper_source(&engine,&content_id,&value,path.clone(),&hash)?;if image&&append_to.is_none(){append_to=value["active"].as_str().map(String::from);}Ok(value)})();results.push(match result{Ok(_)=>serde_json::json!({"name":path.file_name().unwrap_or_default().to_string_lossy(),"ok":true}),Err(e)=>serde_json::json!({"name":path.file_name().unwrap_or_default().to_string_lossy(),"ok":false,"error":e})});}Ok(Some(serde_json::json!({"results":results}))) }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn export_interface_settings(state:tauri::State<'_,State>,contents:String)->Result<Option<String>,String>{
 let lease=score_edit::reserve(&state,"interface-settings-export")?;
 if contents.len()>1_000_000{return Err("界面设置备份超过 1 MB".into());}
 let value:serde_json::Value=serde_json::from_str(&contents).map_err(|_|"界面设置备份格式无效")?;
 if value["format"]!="neothesia-interface-settings"||value["version"]!=1{return Err("界面设置备份格式无效".into());}
 let Some(file)=file_dialog(&state.data,"exportBackup").set_title("导出界面设置").set_file_name("Panthesia-界面设置.neosettings").add_filter("界面设置备份", &["neosettings"]).save_file().await else{return Ok(None)};
 let path=file.path().to_path_buf();remember_location(&state.data,"exportBackup",&path,false);
 tauri::async_runtime::spawn_blocking(move||{let _lease=lease;panthesia_core::utils::atomic_file::write(&path,contents.as_bytes()).map_err(|e|e.to_string())?;Ok(Some(path.to_string_lossy().to_string()))}).await.map_err(|e|e.to_string())?
}


#[tauri::command]
fn engine_state(state: tauri::State<'_, State>) -> panthesia_engine::Snapshot {
    state.engine.snapshot()
}
#[tauri::command]
async fn play_live_notes(state: tauri::State<'_, State>, request: panthesia_engine::live_notes::Input) -> Result<panthesia_engine::live_notes::Acknowledgement,String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.live_notes(request)).await.map_err(|error| error.to_string())?
}
#[tauri::command]
async fn engine_song(state: tauri::State<'_, State>) -> Result<serde_json::Value, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.command(Command::CurrentSong))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn edit_practice(
    state: tauri::State<'_, State>,
    request: panthesia_engine::PracticeRequest,
) -> Result<serde_json::Value, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.edit_practice(request))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn read_practice(
    state: tauri::State<'_, State>,
    request: panthesia_engine::PracticeRequest,
) -> Result<serde_json::Value, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.read_practice(request))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn start_practice_demo(
    state: tauri::State<'_, State>,
    request: panthesia_engine::PracticeRequest,
) -> Result<serde_json::Value, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.start_practice_demo(request))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn read_notation(state:tauri::State<'_,State>,request:panthesia_engine::NotationReadRequest)->Result<serde_json::Value,String>{
    let engine=state.engine.clone();tauri::async_runtime::spawn_blocking(move||engine.read_notation(request)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn notation_document(request:panthesia_engine::NotationDocumentRequest)->Result<Vec<u8>,String> {
    tauri::async_runtime::spawn_blocking(move||panthesia_engine::notation_document(request.bytes)).await.map_err(|error|error.to_string())?
}
#[tauri::command]
async fn map_score(state: tauri::State<'_, State>, request: panthesia_engine::ScoreMappingRequest) -> Result<serde_json::Value, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.map_score(request)).await.map_err(|error| error.to_string())?
}
#[tauri::command]
async fn read_history(state: tauri::State<'_, State>, request: panthesia_engine::HistoryReadRequest) -> Result<serde_json::Value, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.read_history(request)).await.map_err(|error| error.to_string())?
}
#[tauri::command]
async fn midi_devices(state: tauri::State<'_, State>, refresh: Option<bool>, target: Option<String>) -> Result<panthesia_engine::DeviceSnapshot,String> {
    if refresh.unwrap_or(false) { state.engine.refresh_devices(target.as_deref()) }
    else { state.engine.devices(false) }
}
#[tauri::command]
async fn adjust_playback(state: tauri::State<'_, State>, request: panthesia_engine::state_order::PlaybackAdjustment) -> Result<serde_json::Value, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.adjust_playback(request)).await.map_err(|error| error.to_string())?
}
#[tauri::command]
async fn engine_scoped_command(state: tauri::State<'_, State>, request: panthesia_engine::state_order::GuardedCommand) -> Result<serde_json::Value, String> {
    state.engine.check_engine(&request.engine_id)?;
    engine_command(state, request.command).await
}
#[tauri::command]
async fn engine_command(
    state: tauri::State<'_, State>,
    command: Command,
) -> Result<serde_json::Value, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.command(command))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn link_score_source(state:tauri::State<'_,State>,midi_path:String,content_id:String,version_id:String,expected_engine:Option<String>)->Result<Option<serde_json::Value>,String>{
    if let Some(id)=&expected_engine { state.engine.check_engine(id)?; }
    let Some(file)=file_dialog(&state.data,"notation").set_title("关联此版本的原谱文件").add_filter("MusicXML 乐谱", &["xml","musicxml","mxl"]).pick_file().await else{return Ok(None);};
    let path=file.path().to_path_buf();remember_location(&state.data,"notation",file.path(),false);let engine=state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(id)=expected_engine {engine.check_engine(&id)?;}
        engine.command(Command::LinkScoreSource{midi_path:midi_path.into(),content_id,version_id,path,default_bpm:0}).map(Some)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn export_midi(state: tauri::State<'_, State>) -> Result<Option<String>, String> {
    media_export_bridge::legacy_save(&state, panthesia_engine::media_export::MediaExportKind::Midi).await
}

#[tauri::command]
async fn export_paper_page(state:tauri::State<'_,State>,name: String, bytes: Vec<u8>) -> Result<Option<String>, String> {
    let lease=score_edit::reserve(&state,"legacy-paper-image-export")?;
    if bytes.len()<45 || bytes.len()>48_000_000 || !score_batch_export::valid_png_header(&bytes) || !bytes.ends_with(b"\0\0\0\0IEND\xaeB`\x82") {return Err("批注图片格式、尺寸或大小无效".into());}
    let name=name.chars().map(|c|if "<>:\"/\\|?*".contains(c)||c.is_control(){'_'}else{c}).collect::<String>();
    let Some(file)=file_dialog(&state.data,"exportPaper").set_title("保存本页批注图片").add_filter("PNG 图片", &["png"])
        .set_file_name(if name.ends_with(".png"){name}else{format!("{name}.png")}).save_file().await else{return Ok(None);};
    let path=file.path().to_path_buf();let data=state.data.clone();
    let saved=tauri::async_runtime::spawn_blocking(move||{let _lease=lease;export_files::write(&data,&path,&bytes,"png")}).await.map_err(|e|e.to_string())??;
    remember_location(&state.data,"exportPaper",file.path(),false);Ok(Some(saved))
}

#[cfg(all(test, target_os="windows"))]
fn installed_musescore() -> Option<PathBuf> {
    musescore_program::discovered_program()
}


async fn musescore_executable(state: &State, control: Option<&score_jobs::Token>) -> Result<PathBuf, String> {
    musescore_program::executable(state, control).await
}

#[cfg(target_os="windows")]
fn musescore_path_arg(path:&std::path::Path)->String{
    let text=path.to_string_lossy();
    if let Some(unc)=text.strip_prefix(r"\\?\UNC\"){format!(r"\\{unc}")}
    else{text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()}
}

#[tauri::command]
async fn open_score_in_musescore(state:tauri::State<'_,State>,content_id:String,version_id:String,engine_id:Option<String>)->Result<(),String>{
    if let Some(engine_id) = engine_id { state.engine.check_engine(&engine_id)?; }
    launch_score_in_musescore(&state, &content_id, &version_id).await
}

async fn launch_score_in_musescore(state: &State, content_id: &str, version_id: &str) -> Result<(), String> {
    let lease = score_edit::reserve(state, &format!("musescore-open-{content_id}-{version_id}"))?;
    let executable = musescore_executable(state, None).await?;
    let data = state.data.clone();
    let content_id = content_id.to_owned();
    let version_id = version_id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        // Resolve again after any program picker, immediately before handing the original to the editor.
        let path = panthesia_engine::score_sources::original_for_edit(&data, &content_id, &version_id)?;
        let mut command = std::process::Command::new(executable);
        #[cfg(target_os="windows")]
        { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000).arg(musescore_path_arg(&path)); }
        #[cfg(not(target_os="windows"))]
        { if cfg!(target_os="macos") { command.arg("-a").arg("MuseScore 4"); } command.arg(path); }
        command.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .spawn().map_err(|error| format!("MuseScore Studio 启动失败：{error}"))?;
        Ok(())
    }).await.map_err(|error| format!("MuseScore 启动准备中断：{error}"))?
}

#[cfg(target_os="windows")]
fn convert_musescore_pdf_controlled(executable:&std::path::Path,source:&std::path::Path,destination:&std::path::Path,control:Option<&score_jobs::Token>)->Result<Vec<u8>,String>{
    use std::os::windows::process::CommandExt;
    let mut command=std::process::Command::new(executable);
    command.arg("-o").arg(musescore_path_arg(destination)).arg(musescore_path_arg(source)).creation_flags(0x08000000);
    external_process::run(&mut command, std::time::Duration::from_secs(60), control, "MuseScore PDF 排版", &destination.with_extension("conversion.log"))?;
    let size=std::fs::metadata(destination).map_err(|e|format!("MuseScore 没有生成 PDF：{e}"))?.len();
    if !(100..=48_000_000).contains(&size) {return Err("MuseScore PDF 为空、不完整或超过 48 MB".into());}
    let bytes=panthesia_core::utils::atomic_file::read_limited(destination,48_000_000).map_err(|e|format!("MuseScore 没有生成 PDF：{e}"))?;
    if bytes.len()<100||bytes.len()>48_000_000||!bytes.starts_with(b"%PDF-")||!bytes[bytes.len().saturating_sub(1024)..].windows(5).any(|part|part==b"%%EOF"){
        return Err("MuseScore 导出的 PDF 不完整或超过 48 MB，未加入谱面".into())
    }
    Ok(bytes)
}

#[cfg(all(test, target_os="windows"))]
fn convert_musescore_pdf(executable:&std::path::Path,source:&std::path::Path,destination:&std::path::Path)->Result<Vec<u8>,String>{
    convert_musescore_pdf_controlled(executable,source,destination,None)
}

#[cfg(all(test,target_os="windows"))]
fn convert_musescore_midi_to_musicxml_controlled(executable:&std::path::Path,source:&std::path::Path,destination:&std::path::Path,control:Option<&score_jobs::Token>)->Result<Vec<u8>,String>{
    use std::os::windows::process::CommandExt;
    let mut command=std::process::Command::new(executable);
    command.arg("-o").arg(musescore_path_arg(destination)).arg(musescore_path_arg(source)).creation_flags(0x08000000);
    external_process::run(&mut command, std::time::Duration::from_secs(90), control, "MuseScore MIDI 转谱", &destination.with_extension("conversion.log"))?;
    let size=std::fs::metadata(destination).map_err(|e|format!("MuseScore 没有生成 MusicXML：{e}"))?.len();
    if !(100..=4_000_000).contains(&size){return Err("MuseScore 生成的 MusicXML 不完整或超过 4 MB，未加入谱面".into())}
    let bytes=panthesia_core::utils::atomic_file::read_limited(destination,4_000_000).map_err(|e|format!("MuseScore 生成的 MusicXML 无法读取：{e}"))?;
    let xml=std::str::from_utf8(&bytes).map_err(|_|"MuseScore 生成的 MusicXML 不是 UTF-8，未加入谱面")?;
    if !xml.contains("<score-partwise") && !xml.contains("<score-timewise") {return Err("MuseScore 生成的文件不是 MusicXML 乐谱".into())}
    Ok(bytes)
}

fn verified_midi_input(engine: &Engine, content_id: &str) -> Result<(PathBuf, Vec<u8>), String> {
    let source = engine.current_source_path(content_id)?;
    let extension = source.extension().and_then(|value| value.to_str()).unwrap_or("");
    if !extension.eq_ignore_ascii_case("mid") && !extension.eq_ignore_ascii_case("midi") {
        return Err("当前曲目来自乐谱文件，请直接管理已有原谱".into());
    }
    let bytes = panthesia_core::utils::atomic_file::read_limited(&source, 20_000_000)
        .map_err(|error| format!("MIDI 文件无法读取：{error}"))?;
    if bytes.is_empty() || blake3::hash(&bytes).to_hex().as_str() != content_id {
        return Err("MIDI 文件内容已改变，请重新打开曲目".into());
    }
    Ok((source, bytes))
}
fn verified_midi_source(engine: &Engine, content_id: &str) -> Result<PathBuf, String> {
    verified_midi_input(engine, content_id).map(|(path, _)| path)
}

#[cfg(all(test,target_os="windows"))]
fn convert_musescore_midi_to_musicxml(executable:&std::path::Path,source:&std::path::Path,destination:&std::path::Path)->Result<Vec<u8>,String>{
    convert_musescore_midi_to_musicxml_controlled(executable,source,destination,None)
}
#[tauri::command]
async fn generate_duet_score(state:tauri::State<'_,State>,content_id:String,job:Option<score_jobs::ScoreJobRequest>)->Result<score_jobs::ConversionReply,String>{
    duet_score::generate(&state,content_id,job).await
}
fn write_new_generated_score(path:&std::path::Path,bytes:&[u8])->Result<(),String>{
    if path.extension().and_then(|s|s.to_str()).is_none_or(|ext|!ext.eq_ignore_ascii_case("musicxml")) {
        return Err("请将转谱初稿保存为 .musicxml 文件".into());
    }
    // create_new is the final no-overwrite guard even when the save dialog's
    // target changes between selection and the write.
    let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(path)
        .map_err(|e|if e.kind()==std::io::ErrorKind::AlreadyExists {
            "该位置已有文件。请选择新的文件名；软件不会覆盖原谱".into()
        } else {format!("无法新建转谱文件：{e}")})?;
    use std::io::Write;
    if let Err(error)=file.write_all(bytes).and_then(|_|file.sync_all()) {
        drop(file);
        let _=std::fs::remove_file(path);
        return Err(format!("转谱文件写入失败：{error}"));
    }
    drop(file);
    let saved=panthesia_engine::score_sources::read_original(path)
        .map_err(|e|format!("转谱文件已写入，但无法复查：{e}；位置：{}",path.display()))?;
    if saved!=bytes {
        return Err(format!("转谱文件已写入，但内容核对失败；请检查文件：{}",path.display()));
    }
    Ok(())
}

#[tauri::command]
async fn save_generated_score_for_edit(state:tauri::State<'_,State>,content_id:String,name:String,bytes:Vec<u8>,preview_token:String)->Result<Option<serde_json::Value>,String>{
    score_edit::save(&state, score_edit::Kind::Midi, content_id, name, bytes, preview_token).await
}

#[tauri::command]
async fn add_musescore_pdf(state:tauri::State<'_,State>,content_id:String,version_id:String)->Result<serde_json::Value,String>{
    pdf_conversion::legacy_pdf(state, content_id, version_id).await
}

#[tauri::command]
async fn export_paper_book(state:tauri::State<'_,State>,name:String,bytes:Vec<u8>) -> Result<Option<String>,String> {
    let lease=score_edit::reserve(&state,"legacy-paper-book-export")?;
    if bytes.len()<100 || bytes.len()>64_000_000 || !bytes.starts_with(b"%PDF-") || !bytes[bytes.len().saturating_sub(1024)..].windows(5).any(|part|part==b"%%EOF") {
        return Err("整本批注 PDF 格式或大小无效".into());
    }
    let name=name.chars().map(|c|if "<>:\"/\\|?*".contains(c)||c.is_control(){'_'}else{c}).collect::<String>();
    let Some(file)=file_dialog(&state.data,"exportPaper").set_title("保存整本批注 PDF").add_filter("PDF 文档", &["pdf"])
        .set_file_name(if name.ends_with(".pdf"){name}else{format!("{name}.pdf")}).save_file().await else{return Ok(None);};
    let path=file.path().to_path_buf();let data=state.data.clone();
    let saved=tauri::async_runtime::spawn_blocking(move||{let _lease=lease;export_files::write(&data,&path,&bytes,"pdf")}).await.map_err(|e|e.to_string())??;
    remember_location(&state.data,"exportPaper",file.path(),false);Ok(Some(saved))
}
#[tauri::command]
async fn export_annotated_score(state: tauri::State<'_, State>, request: serde_json::Value) -> Result<Option<String>, String> {
    let lease=score_edit::reserve(&state,"legacy-annotated-score-export")?;
    let command: Command=serde_json::from_value(request).map_err(|e|e.to_string())?;
    let Command::ExportAnnotatedScore {content_id,score_revision,options,download:true,fingerprint}=command else {return Err("导出请求无效".into());};
    let expected=fingerprint.ok_or("请先制作并核对个人标记谱预览")?;
    let engine=state.engine.clone();
    let artifact=tauri::async_runtime::spawn_blocking(move || {
        let artifact=engine.prepare_annotated_score(panthesia_engine::score_export::ScoreExportInput {content_id,score_revision,annotation_revision:None,finger_action_revision:None,options},&||Ok(()))?;
        if artifact.preview.fingerprint!=expected {return Err("指法、换指、分手或谱面已经改变，请刷新预览后导出".into());}
        Ok::<_,String>(artifact)
    }).await.map_err(|e|e.to_string())??;
    let Some(file)=file_dialog(&state.data,"exportScore").set_title("保存个人标记谱").add_filter("MusicXML 乐谱", &["musicxml"])
        .set_file_name(&artifact.preview.name).save_file().await else {return Ok(None);};
    let path=file.path().to_path_buf();let root=state.data.clone();
    let saved=tauri::async_runtime::spawn_blocking(move||{let _lease=lease;export_files::write(&root,&path,&artifact.bytes,"musicxml")}).await.map_err(|e|e.to_string())??;
    remember_location(&state.data,"exportScore",file.path(),false);Ok(Some(saved))
}

fn startup_failure(error: impl std::fmt::Display) -> ! {
    let identity = build_info::startup_label();
    let reason = error.to_string();
    let report = build_info::startup_report(&reason);
    if startup_check() {
        if let Some(path) = panthesia_core::product::env_os("PANTHESIA_STARTUP_CHECK_LOG") {
            let _ = std::fs::write(path, format!("FAILED\n{report}"));
        }
        eprintln!("{report}");
    } else {
        let hint = if reason.to_lowercase().contains("webview") { "\n请安装或修复 Microsoft Edge WebView2 运行时后重新打开。" } else { "" };
        let message = format!("{identity}\n启动失败：{reason}{hint}");
        let saved=diagnostics::write("启动失败",&report);
        let detail=match saved {Ok(())=>format!("日志文件夹：{}",diagnostics::root().display()),Err(cause)=>format!("日志未能写入：{cause}")};
        rfd::MessageDialog::new().set_title("Panthesia 启动失败").set_description(format!("{message}\n{detail}")).set_level(rfd::MessageLevel::Error).show();
    }
    std::process::exit(1);
}
fn main() {
    // `probe` answers file managers (Keel) without a window, a data root or a single instance.
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    if args.get(1).is_some_and(|a| a == "probe") {
        attach_parent_console();
        let (code, output) = panthesia_engine::probe::run(&args[2..]);
        println!("{output}");
        std::process::exit(code);
    }
    diagnostics::install();
    let context = match startup_checks::configure(tauri::generate_context!()) {
        Ok(context) => context,
        Err(error) => startup_failure(error),
    };
    let mut builder = tauri::Builder::default();
    // Isolated checks may run beside a normal window; only real launches hand over to one instance.
    if !startup_checks::enabled() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            open_requests::push(app, open_requests::from_args(&args, std::path::Path::new(&cwd)));
            open_requests::focus(app);
        }));
    }
    builder
        .manage(open_requests::Queue::default())
        .setup(|app| {
            let result: Result<(), Box<dyn std::error::Error>> = (|| {
            let data = panthesia_core::product::env_os("PANTHESIA_DATA_ROOT").map(PathBuf::from).unwrap_or_else(|| panthesia_core::product::profile_root(&app.path().app_data_dir().expect("application data location")));
            let data_lock = DataRootLock::acquire(&data)?;
            let data = data_lock.root().to_path_buf();
            let font = startup_checks::bundled_font(&app.path().resource_dir()?)?;
            if !font.is_file() { return Err(format!("找不到钢琴音色文件：{}", font.display()).into()); }
            let (saved,warning)=saved_soundfont(&data);
            let selected_font=saved.unwrap_or_else(||font.clone());
            let status=soundfont_status(&selected_font,&font,warning);
            let engine = Engine::start_with_soundfont_fallback(data.clone(), data_lock, selected_font.clone(), Some(font.clone()), false)?;
            state_push::start(app.handle().clone(), engine.clone());
            app.manage(score_batch_export::Sessions::default());
            app.manage(score_export_bridge::Cache::default());
            app.manage(file_transfer::Sessions::default());
            app.manage(State { score_jobs:Default::default(), score_saves:Default::default(), closing:Default::default(), close_allowed:Default::default(), allow_closing_drafts:Default::default(), desktop_close:Default::default(), engine,data, font:selected_font, bundled_font:font, soundfont_status:std::sync::Arc::new(std::sync::Mutex::new(status)), soundfont_change:Default::default(), score_imports:Default::default(), generated_scores:Default::default(), recognized_scores:Default::default() });
            if !startup_checks::enabled() {
                app_paths::register();
            }
            if !headless_check() {
                if let Some(window) = app.get_webview_window("main") {
                    window.show()?;
                    startup_stage("window_shown");
                }
            }
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            open_requests::push(app.handle(), open_requests::from_args(&args, &cwd));
            Ok(())
            })();
            match result { Ok(()) => Ok(()), Err(error) => startup_failure(error) }
        })
        .invoke_handler(tauri::generate_handler![
            score_batch_export::begin_score_batch_export,score_batch_export::begin_workspace_export,score_batch_export::begin_paper_pdf_export,score_batch_export::begin_paper_png_export,score_batch_export::write_score_batch_export,score_batch_export::finish_score_batch_export,score_batch_export::cancel_score_batch_export,
            diagnostics::record_diagnostic,diagnostics::open_log_folder,open_requests::take_open_requests,
            reveal_library_file,open_practice_data_folder,
            get_soundfont_status,
            select_soundfont,
            reset_soundfont,
            musescore_program::musescore_program_status,
            musescore_program::select_musescore_program,
            musescore_program::reset_musescore_program,
            open_score_in_musescore,
            add_musescore_pdf,
            pdf_conversion::prepare_pdf_draft,pdf_conversion::list_pdf_drafts,pdf_conversion::read_pdf_draft_bytes,
            pdf_conversion::adopt_pdf_draft,pdf_conversion::export_pdf_draft,pdf_conversion::remove_pdf_draft,
            generate_duet_score,
            duet_runtime::read_duet_runtime,
            duet_runtime::save_duet_runtime,
            duet_runtime::probe_duet_runtime,
            duet_runtime::browse_duet_runtime,
            score_jobs::read_score_job,score_jobs::cancel_score_job,score_jobs::score_job_protocol,
            media_export_bridge::prepare_media_export,media_export_bridge::list_media_exports,media_export_bridge::remove_media_export,media_export_bridge::save_media_export,media_export_bridge::confirm_media_export,
            score_export_bridge::prepare_score_export,score_export_bridge::list_score_exports,score_export_bridge::read_score_export,score_export_bridge::remove_score_export,score_export_bridge::save_score_export,
            score_draft_bridge::retain_notation_file,score_draft_bridge::list_notation_drafts,score_draft_bridge::read_notation_draft,score_draft_bridge::remove_notation_draft,score_draft_bridge::export_notation_draft,score_draft_bridge::export_notation_draft_bytes,
            audiveris_paper::audiveris_program_status,
            audiveris_paper::select_audiveris_program,
            audiveris_paper::reset_audiveris_program,
            audiveris_paper::recognize_paper_with_audiveris,
            audiveris_paper::save_recognized_score_for_edit,
            save_generated_score_for_edit,
            engine_state,
            play_live_notes,
            engine_song,
            midi_devices,
            
            
            
            
            engine_command,
            engine_scoped_command,
            build_info::desktop_build_info,
            adjust_playback,
            edit_practice,
            read_practice,
            map_score,notation_document,read_notation,
            read_history,
            
            
            start_practice_demo,
            located_paper_bridge::begin_located_paper_upload,located_paper_bridge::write_located_paper_chunk,located_paper_bridge::finish_located_paper_upload,located_paper_bridge::cancel_located_paper_upload,
            link_score_source,
            export_midi,
            export_annotated_score,
            export_paper_page,
            export_paper_book,
            score_attachment_bytes,
            import_score_attachments,
            pick_paper_source,
            pick_song_file,
            desktop_close::decide_desktop_close,desktop_close::attach_desktop_close,desktop_close::desktop_close_status,desktop_close::desktop_close_review,desktop_close::desktop_close_ready,desktop_close::cancel_desktop_close,
            file_transfer::begin_score_input,
            file_transfer::write_score_input_chunk,
            file_transfer::cancel_score_input,
            
            
            export_interface_settings,
            native_startup_check
        ])
        .on_page_load(|window, payload| {
            if startup_check() && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                startup_stage(&format!("page_finished:{}",payload.url()));
                if let Err(error) = window.eval(r#"
                    (function check(attempt) {
                        const ready = document.querySelector('[data-engine-connected="true"][data-engine-ready="true"]');
                        if ((ready || attempt > 100) && !window.__panthesiaChecking) {
                          window.__panthesiaChecking=true;
                          const worker=new Worker('/verovio/worker.mjs',{type:'module'});
                          let finished=false;const finish=async(notationReady)=>{if(finished)return;finished=true;worker.terminate();let pdfReady=false;try{pdfReady=Boolean(await Promise.race([window.__panthesiaPdfCheck?.(),new Promise(resolve=>setTimeout(()=>resolve(false),15000))]));}catch{}window.__TAURI_INTERNALS__.invoke('native_startup_check',{ready:Boolean(ready),notationReady,pdfReady});};
                          const timeout=setTimeout(()=>finish(false),15000);
                          worker.onmessage=({data})=>{if(data.progress)return;if(data.error){clearTimeout(timeout);finish(false);return;}if(data.id===1&&data.count>0){worker.postMessage({id:2,type:'page',page:0});}else if(data.id===2&&data.svg){worker.postMessage({id:3,type:'evidence'});}else if(data.id===3){clearTimeout(timeout);finish(Boolean(data.midi)&&data.notes?.length>0);}};
                          worker.onerror=()=>{clearTimeout(timeout);finish(false);};
                          const xml='<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>';
                          worker.postMessage({id:1,type:'open',bytes:new TextEncoder().encode(xml).buffer,compressed:false});
                        }
                        else setTimeout(() => check(attempt + 1), 100);
                    })(0);
                "#) { startup_stage(&format!("eval_failed:{error}")); }
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                open_requests::push(window.app_handle(), paths.clone());
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = window.try_state::<State>() {
                    use std::sync::atomic::Ordering;
                    if state.close_allowed.load(Ordering::Acquire) { return; }
                    api.prevent_close();
                    desktop_close::request(window.clone());
                }
            }
        })
        .run(context)
        .unwrap_or_else(|error| startup_failure(error));
}

#[cfg(all(test,target_os="windows"))]
mod musescore_tests {
    use super::*;
    #[test]
    fn missing_saved_soundfont_returns_to_bundled_font_with_warning(){
        let data=std::env::temp_dir().join(format!("neothesia-soundfont-setting-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&data).unwrap();
        assert_eq!(saved_soundfont(&data),(None,None));
        let missing=data.join("removed.sf2");
        save_soundfont(&data,&missing).unwrap();
        save_soundfont(&data,&missing).unwrap();
        let (selected,warning)=saved_soundfont(&data);
        assert!(selected.is_none());
        assert!(warning.unwrap().contains("已找不到"));
        std::fs::remove_dir_all(&data).unwrap();
    }
    #[test]
    fn installed_musescore_general_exposes_gm_instruments_and_audio(){
        let path=std::path::Path::new(r"D:\Music\SoundFonts\MuseScore General\MuseScore_General.sf2");
        if !path.is_file(){return}
        panthesia_engine::validate_soundfont(path).unwrap();
        let data=std::env::temp_dir().join(format!("neothesia-gm-font-{}",std::process::id()));
        std::fs::create_dir_all(&data).unwrap();
        save_soundfont(&data,path).unwrap();
        let (restored,warning)=saved_soundfont(&data);
        assert_eq!(restored.as_deref(),Some(path));
        assert!(warning.is_none());
        let data_lock=DataRootLock::acquire(&data).unwrap();
        let engine=Engine::start(data.clone(),data_lock,PathBuf::new(),true).unwrap();
        let changed=engine.command(Command::SoundFont{path:path.to_path_buf()}).unwrap();
        let presets=changed["soundPresets"].as_array().unwrap();
        assert!(presets.iter().any(|preset|preset["program"]==40));
        panthesia_engine::probe_audio(path).unwrap();
        drop(engine);
        if data.parent()==Some(std::env::temp_dir().as_path()) && data.file_name().and_then(|name|name.to_str()).is_some_and(|name|name.starts_with("neothesia-gm-font-")){
            let _=std::fs::remove_dir_all(data);
        }
    }
    #[test]
    fn score_path_arg_removes_extended_prefix(){
        assert_eq!(musescore_path_arg(std::path::Path::new(r"\\?\C:\Music\score.mxl")),r"C:\Music\score.mxl");
        assert_eq!(musescore_path_arg(std::path::Path::new(r"\\?\UNC\server\share\score.mxl")),r"\\server\share\score.mxl");
    }
    #[test]
    fn installed_musescore_converts_real_musicxml_to_pdf(){
        let Some(program)=installed_musescore() else{return};
        let input=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../panthesia-notation/src/score_performance_test.musicxml");
        let output=std::env::temp_dir().join(format!("neothesia-musescore-test-{}.pdf",std::process::id()));
        let bytes=convert_musescore_pdf(&program,&input,&output).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        let _=std::fs::remove_file(output);
    }
    #[test]
    fn installed_musescore_converts_real_midi_to_musicxml(){
        let Some(program)=installed_musescore() else{return};
        let input=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../panthesia-engine/assets/five-finger.mid");
        let output=std::env::temp_dir().join(format!("neothesia-musescore-midi-{}.musicxml",std::process::id()));
        let bytes=convert_musescore_midi_to_musicxml(&program,&input,&output).unwrap();
        let xml=std::str::from_utf8(&bytes).unwrap();
        assert!(xml.contains("<score-partwise"));
        assert!(xml.contains("<measure"));
        assert!(xml.contains("<note"));
        let data=std::env::temp_dir().join(format!("neothesia-musescore-preview-{}",std::process::id()));
        let data_lock=DataRootLock::acquire(&data).unwrap();
        let engine=Engine::start(data.clone(),data_lock,PathBuf::new(),true).unwrap();
        engine.wait_until_ready(std::time::Duration::from_secs(30)).unwrap();
        // Saved score versions go beside the song: work on a copy, not the repository asset.
        let song_dir=data.join("song");
        std::fs::create_dir_all(&song_dir).unwrap();
        let input={let copy=song_dir.join("five-finger.mid");std::fs::copy(&input,&copy).unwrap();copy};
        let song=engine.command(Command::OpenFile{path:input.clone()}).unwrap();
        let preview=engine.command(Command::PreviewScoreBytesRoute{
            bytes,name:"MuseScore 转谱初稿.musicxml".into(),
            content_id:song["contentId"].as_str().unwrap().into(),
        }).unwrap();
        assert_eq!(preview["contentId"],song["contentId"]);
        assert!(preview["fingerprint"].as_str().is_some());
        let external=std::env::temp_dir().join(format!("neothesia-musescore-linked-{}-{}.musicxml",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let bytes=std::fs::read(&output).unwrap();
        write_new_generated_score(&external,&bytes).unwrap();
        assert!(write_new_generated_score(&external,b"replacement").is_err());
        assert_eq!(std::fs::read(&external).unwrap(),bytes);
        let cid=song["contentId"].as_str().unwrap().to_string();
        let saved=engine.command(Command::SaveScoreVersion{bytes:bytes.clone(),name:"MuseScore 转谱初稿.musicxml".into(),content_id:cid.clone()}).unwrap();
        engine.command(Command::LinkScoreSource{midi_path:input.clone(),content_id:cid.clone(),version_id:saved["versionId"].as_str().unwrap().into(),path:external.clone(),default_bpm:0}).unwrap();
        let sources=engine.command(Command::ScoreSources{content_id:Some(cid.clone())}).unwrap();
        assert_eq!(sources["entries"][0]["status"],"ready");
        let mut changed=bytes.clone();changed.extend_from_slice(b"\n<!-- edited in MuseScore -->\n");
        std::fs::write(&external,changed).unwrap();
        let sources=engine.command(Command::ScoreSources{content_id:Some(cid)}).unwrap();
        assert_eq!(sources["entries"][0]["status"],"changed");
        let source_preview=engine.command(Command::PreviewScoreSource{id:sources["entries"][0]["id"].as_str().unwrap().into(),fingerprint:sources["entries"][0]["fingerprint"].as_str().unwrap().into()}).unwrap();
        assert_eq!(source_preview["performanceReady"],true);
        drop(engine);
        if data.parent()==Some(std::env::temp_dir().as_path()) && data.file_name().and_then(|name|name.to_str()).is_some_and(|name|name.starts_with("neothesia-musescore-preview-")) {
            let _=std::fs::remove_dir_all(data);
        }
        let _=std::fs::remove_file(output);
        let _=std::fs::remove_file(external);
    }
}
