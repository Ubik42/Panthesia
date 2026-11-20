//! Shared, bounded diagnostic files for the desktop application.
use std::{path::PathBuf, sync::{Mutex,OnceLock}, io::Write};
static ROOT:OnceLock<PathBuf>=OnceLock::new();
static WRITER:Mutex<()>=Mutex::new(());
pub fn root()->PathBuf {
 ROOT.get_or_init(||{
  let profile=panthesia_core::product::env_os("PANTHESIA_DATA_ROOT").map(PathBuf::from).unwrap_or_else(||{
   let base=std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
   panthesia_core::product::profile_root(&base.join(panthesia_core::product::APP_ID))
  });profile.join("logs")
 }).clone()
}
pub fn write(source:&str,detail:&str)->Result<(),String>{
 let _guard=WRITER.lock().map_err(|_|"日志写入暂不可用".to_string())?;
 let root=root();std::fs::create_dir_all(&root).map_err(|e|e.to_string())?;
 let path=root.join("runtime.jsonl");
 if std::fs::metadata(&path).map(|m|m.len()>4*1024*1024).unwrap_or(false){
  let previous=root.join("runtime.previous.jsonl");if previous.exists(){std::fs::remove_file(&previous).map_err(|e|e.to_string())?;}
  std::fs::rename(&path,previous).map_err(|e|e.to_string())?;
 }
 let row=serde_json::json!({"time":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis().to_string(),"pid":std::process::id(),"source":source.chars().take(128).collect::<String>(),"detail":detail.chars().take(16000).collect::<String>()});
 let mut file=std::fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e|e.to_string())?;
 writeln!(file,"{row}").map_err(|e|e.to_string())
}
pub fn install(){let _=write("启动",&super::build_info::startup_label());std::panic::set_hook(Box::new(|info|{let _=write("程序异常",&info.to_string());}));}
#[tauri::command]
pub async fn record_diagnostic(source:String,detail:String)->Result<(),String>{
 tauri::async_runtime::spawn_blocking(move||write(&source,&detail)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn open_log_folder()->Result<(),String>{
 tauri::async_runtime::spawn_blocking(||{
  let path=root();std::fs::create_dir_all(&path).map_err(|e|e.to_string())?;
  #[cfg(target_os="windows")]
  let mut command=std::process::Command::new("explorer.exe");
  #[cfg(target_os="macos")]
  let mut command=std::process::Command::new("open");
  #[cfg(all(not(target_os="windows"),not(target_os="macos")))]
  let mut command=std::process::Command::new("xdg-open");
  command.arg(path).spawn().map_err(|e|format!("日志文件夹无法打开：{e}"))?;Ok(())
 }).await.map_err(|e|e.to_string())?
}
