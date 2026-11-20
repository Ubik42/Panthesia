mod service_lane;
use panthesia_engine::{Command, Engine, data_root_lock::DataRootLock, library};
use std::{path::PathBuf, sync::{Arc,Mutex, atomic::{AtomicUsize, Ordering}}};
use tiny_http::{Header, Method, Response, Server};

#[derive(Default)]
struct Activity {
    business: Arc<AtomicUsize>,
    reads: Arc<AtomicUsize>,
    documents: Arc<AtomicUsize>,
}

#[derive(Default, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
struct DeviceRefresh {
    target: Option<String>,
    refresh: Option<bool>,
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let args: Vec<_> = std::env::args().collect();
    let root = panthesia_core::product::env_os("PANTHESIA_LIBRARY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"D:\Music\MIDI\Datasets"));
    let data = panthesia_core::product::env_os("PANTHESIA_DATA_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let current=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../work/web-data");
            let legacy=PathBuf::from(r"D:\Music\_tools\Neothesia\work\web-data");
            if !current.exists() && legacy.is_dir() { legacy } else { current }
        });
    let font = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../default.sf2");
    if args.iter().any(|a| a == "--audio-probe") {
        panthesia_engine::probe_audio(&font)?;
        println!("内置钢琴音色已加载，真实音频输出流初始化成功（未播放音符）");
        return Ok(());
    }
    let data_lock = DataRootLock::acquire(&data)?;
    let data = data_lock.root().to_path_buf();
    let rows = Arc::new(Mutex::new(Vec::new()));
    let engine = Engine::start(data.clone(), data_lock, font, args.iter().any(|a| a == "--silent"))?;
    let monitor=engine.start_library_monitor(root.clone(),rows.clone());
    let address = panthesia_core::product::env("PANTHESIA_SERVICE_ADDR").unwrap_or("127.0.0.1:32124".into());
    if !address.starts_with("127.0.0.1:") {
        return Err("服务只允许监听本机回环地址".into());
    }
    let server = Server::http(&address)?;
    println!("Panthesia music engine: http://{address}");
    let activity = Arc::new(Activity::default());
    let handler = {
        let activity = activity.clone();
        Arc::new(move |request| handle_request(request, &engine, &rows, &data, &monitor, &activity))
    };
    let business = service_lane::Lane::new("neothesia-http-work", 1, 16, activity.business.clone(), {
        let handler = handler.clone(); move |request| handler(request)
    })?;
    let reads = service_lane::Lane::new("neothesia-http-read", 2, 8, activity.reads.clone(), {
        let handler = handler.clone(); move |request| handler(request)
    })?;
    let documents = service_lane::Lane::new("neothesia-http-document", 1, 4, activity.documents.clone(), {
        let handler = handler.clone(); move |request| handler(request)
    })?;
    let control = service_lane::Lane::new("neothesia-http-control", 2, 32, Arc::new(AtomicUsize::new(0)),
        move |request| handler(request))?;
    for request in server.incoming_requests() {
        if request.method() == &Method::Options || ["/api/state", "/api/state-frame", "/api/live-notes", "/api/control", "/api/control-scoped", "/api/music-import/read", "/api/music-import/cancel", "/api/service-status", "/api/practice-backup/read", "/api/practice-backup/cancel", "/api/practice-backup/protocol", "/api/devices", "/api/devices/refresh"].contains(&request.url()) {
            control.dispatch(request);
        } else if (request.method() == &Method::Get && ["/api/song", "/api/session"].contains(&request.url()))
            || (request.method() == &Method::Post && ["/api/midi/export", "/api/package/export"].contains(&request.url())) {
            documents.dispatch(request);
        } else if request.method() == &Method::Get && request.url() == "/api/routines/templates" {
            reads.dispatch(request);
        } else if request.method() == &Method::Post && ["/api/practice-read", "/api/practice-demo", "/api/score-map", "/api/notation-document", "/api/notation-read", "/api/history-read", "/api/history-read-scoped", "/api/routines/read", "/api/routines/sources", "/api/routines/options"].contains(&request.url()) {
            reads.dispatch(request);
        } else { business.dispatch(request); }
    }
    Ok(())
}

fn require_client(request:&tiny_http::Request) -> Result<(),String> {
    if request.headers().iter().any(|header|header.field.equiv("X-Panthesia-Client")&&header.value.as_str()=="web") { Ok(()) }
    else { Err("缺少本地客户端标识".into()) }
}
fn client_json<T:serde::de::DeserializeOwned>(request:&mut tiny_http::Request,limit:u64,label:&str) -> Result<T,String> {
    use std::io::Read;
    require_client(request)?;
    let mut bytes=Vec::new();
    request.as_reader().take(limit+1).read_to_end(&mut bytes).map_err(|error|error.to_string())?;
    if bytes.len() as u64>limit {return Err(format!("{label}请求过大"));}
    serde_json::from_slice(&bytes).map_err(|error|error.to_string())
}

fn handle_request(mut request: tiny_http::Request, engine: &Engine,
    rows: &Arc<Mutex<Vec<library::SongRow>>>, data: &PathBuf,
    monitor: &panthesia_engine::library_monitor::Monitor, activity: &Activity) {
        let origin = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("Origin"))
            .map(|h| h.value.as_str());
        let allowed_origin =
            origin.filter(|o| ["http://127.0.0.1:5173", "http://localhost:5173"].contains(o));
        if origin.is_some() && allowed_origin.is_none() {
            let _ =
                request.respond(Response::from_string("拒绝非本地界面请求").with_status_code(403));
            return;
        }
        let origin_header = allowed_origin.map(str::to_owned);
        let url = request.url().to_owned();
        if request.method()==&Method::Post && url=="/api/located-paper/create" {
            let result=(||->Result<serde_json::Value,String>{
                if !request.headers().iter().any(|h|h.field.equiv("X-Panthesia-Client")&&h.value.as_str()=="web") {return Err("缺少本地客户端标识".into());}
                let mut bytes=Vec::new();
                request.as_reader().take(50_100_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
                let (meta,pages)=panthesia_engine::score_attachments::decode_located_paper_upload(&bytes)?;
                engine.command(Command::CreateLocatedScorePaper{
                    content_id:meta.content_id,score_revision:meta.score_revision,
                    source_fingerprint:meta.source_fingerprint,mapping_token:meta.mapping_token,
                    name:meta.name,pages,anchors:meta.anchors,
                })
            })();
            let (status,value)=match result{Ok(v)=>(200,v),Err(e)=>(400,serde_json::json!({"error":e}))};
            let mut response=Response::from_string(value.to_string()).with_status_code(status)
                .with_header(Header::from_bytes("Content-Type","application/json; charset=utf-8").unwrap());
            if let Some(origin)=origin_header {response.add_header(Header::from_bytes("Access-Control-Allow-Origin",origin).unwrap());}
            let _=request.respond(response);return;
        }
        if request.method()==&Method::Post && ["/api/practice-backup/stage","/api/practice-backup/export"].contains(&url.as_str()) {
          let result=(||->Result<(Vec<u8>,String),String>{if !request.headers().iter().any(|h|h.field.equiv("X-Panthesia-Client")&&h.value.as_str()=="web"){return Err("缺少本地客户端标识".into());}
           if url.ends_with("/stage"){let mut bytes=vec![];request.as_reader().take(256_000_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;let v=engine.stage_practice_backup(bytes)?;Ok((serde_json::to_vec(&v).unwrap(),"application/json".into()))}
           else{let mut bytes=vec![];request.as_reader().take(4097).read_to_end(&mut bytes).map_err(|e|e.to_string())?;if bytes.len()>4096{return Err("备份条件请求过大".into());}let selection=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;let v=engine.command(Command::ExportPracticeBackup{selection})?;let path=std::path::Path::new(v["path"].as_str().ok_or("备份导出路径无效")?);let bytes=panthesia_core::utils::atomic_file::read_limited(path,256_000_000).map_err(|e|e.to_string())?;if path.file_stem().and_then(|value|value.to_str())!=Some(blake3::hash(&bytes).to_hex().as_str()){return Err("备份读取期间内容已改变，请重新制作".into());}Ok((bytes,"application/zip".into()))}
          })();let(status,bytes,mime)=match result{Ok((b,m))=>(200,b,m),Err(e)=>(400,serde_json::to_vec(&serde_json::json!({"error":e})).unwrap(),"application/json".into())};let mut response=Response::from_data(bytes).with_status_code(status).with_header(Header::from_bytes("Content-Type",mime).unwrap());if let Some(origin)=origin_header{response.add_header(Header::from_bytes("Access-Control-Allow-Origin",origin).unwrap());}let _=request.respond(response);return;
        }
        if request.method()==&Method::Post && ["/api/package/stage","/api/package/export","/api/midi/export"].contains(&url.as_str()) {
            let result=(||->Result<(Vec<u8>,String),String>{
                if !request.headers().iter().any(|h|h.field.equiv("X-Panthesia-Client")&&h.value.as_str()=="web") {return Err("缺少本地客户端标识".into());}
                if url.ends_with("/stage") {
                    let mut bytes=Vec::new();request.as_reader().take(256_000_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
                    let v=engine.stage_package(bytes)?;Ok((serde_json::to_vec(&v).map_err(|e|e.to_string())?,"application/json".into()))
                } else {
                    let mut body=Vec::new();request.as_reader().take(4097).read_to_end(&mut body).map_err(|e|e.to_string())?;
                    if body.len()>4096{return Err("导出请求过大".into());}
                    let value:serde_json::Value=if body.is_empty(){serde_json::json!({})}else{serde_json::from_slice(&body).map_err(|e|e.to_string())?};
                    let content_id=value["contentId"].as_str().map(str::to_owned).or_else(||engine.snapshot().content_id).ok_or("请先打开曲目或保存录音")?;
                    let midi=url=="/api/midi/export";
                    let output=engine.prepare_media_export(panthesia_engine::media_export::MediaExportInput{content_id,kind:if midi{panthesia_engine::media_export::MediaExportKind::Midi}else{panthesia_engine::media_export::MediaExportKind::Package}},&||Ok(()))?;
                    Ok((output.bytes,if midi{"audio/midi"}else{"application/zip"}.into()))
                }
            })();
            let(status,bytes,mime)=match result {Ok((b,m))=>(200,b,m),Err(e)=>(400,serde_json::to_vec(&serde_json::json!({"error":e})).unwrap(),"application/json".into())};
            let mut response=Response::from_data(bytes).with_status_code(status).with_header(Header::from_bytes("Content-Type",mime).unwrap());
            if let Some(origin)=origin_header {response.add_header(Header::from_bytes("Access-Control-Allow-Origin",origin).unwrap());}
            let _=request.respond(response);return;
        }
        if request.method()==&Method::Post && ["/api/score-attachment/add","/api/library-score/add","/api/library-score/check","/api/score-attachment/read"].contains(&url.as_str()){
            let result=(||->Result<(Vec<u8>,String),String>{
              if !request.headers().iter().any(|h|h.field.equiv("X-Panthesia-Client")&&h.value.as_str()=="web"){return Err("缺少本地客户端标识".into())}
              if url.ends_with("/check") {
                let header=|field:&'static str|request.headers().iter().find(|h|h.field.equiv(field)).map(|h|h.value.as_str().to_owned());
                let path=decode_name(&header("X-Panthesia-Path").ok_or("未指定曲目位置")?)?;
                let content_id=header("X-Panthesia-Song").ok_or("未指定曲目")?;
                let kind=header("X-Panthesia-Kind").ok_or("未指定谱面类型")?;
                let target=header("X-Panthesia-Target");
                let mut bytes=Vec::new();request.as_reader().take(48_000_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
                let result=engine.command(Command::CheckLibraryScoreImport{path:path.into(),content_id,bytes,kind,target})?;
                return Ok((serde_json::to_vec(&result).unwrap(),"application/json".into()));
              }
              if url.ends_with("/add"){
                let cid=request.headers().iter().find(|h|h.field.equiv("X-Panthesia-Song")).map(|h|h.value.as_str().to_owned()).ok_or("未指定曲目")?;
                let encoded=request.headers().iter().find(|h|h.field.equiv("X-Panthesia-Name")).map(|h|h.value.as_str().to_owned()).ok_or("未指定谱面名称")?;
                let name=decode_name(&encoded)?;
                let append=request.headers().iter().find(|h|h.field.equiv("X-Panthesia-Append")).map(|h|h.value.as_str().to_owned());
                let mut bytes=Vec::new();request.as_reader().take(48_000_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
                let value=if url=="/api/library-score/add" {let header=|field:&'static str|request.headers().iter().find(|h|h.field.equiv(field)).map(|h|h.value.as_str().to_owned());let path=decode_name(&header("X-Panthesia-Path").ok_or("未指定曲目位置")?)?;let kind=header("X-Panthesia-Kind").ok_or("未指定谱面类型")?;let target=header("X-Panthesia-Target");let page=header("X-Panthesia-Page").unwrap_or_else(||"0".into()).parse().map_err(|_|"页码无效")?;engine.command(Command::AddLibraryScore{path:path.into(),content_id:cid,name,bytes,kind,target,page})?}else{engine.command(Command::AddScoreAttachment{content_id:cid,name,bytes,append})?};
                Ok((serde_json::to_vec(&value).unwrap(),"application/json".into()))
              }else{
                let mut b=String::new();request.as_reader().take(4097).read_to_string(&mut b).map_err(|e|e.to_string())?;if b.len()>4096{return Err("请求过大".into())}
                let v:serde_json::Value=serde_json::from_str(&b).map_err(|e|e.to_string())?;
                let cid=v["contentId"].as_str().ok_or("未指定曲目")?;let id=v["id"].as_str().ok_or("未指定谱面")?;let(bytes,kind)=if let Some(k)=v["previewKind"].as_str(){panthesia_engine::score_attachments::read_source_preview(&data,cid,id,k)?}else{panthesia_engine::score_attachments::read_expected(&data,cid,id,v["page"].as_u64().unwrap_or(0)as usize,v["expectedAsset"].as_str())?};
                Ok((bytes,match kind.as_str(){"pdf"=>"application/pdf","jpeg"=>"image/jpeg","png"=>"image/png",_=>"image/webp"}.into()))
              }
            })();
            let(status,bytes,mime)=match result{Ok((b,m))=>(200,b,m),Err(e)=>(400,serde_json::to_vec(&serde_json::json!({"error":e})).unwrap(),"application/json".into())};
            let mut response=Response::from_data(bytes).with_status_code(status).with_header(Header::from_bytes("Content-Type",mime).unwrap());
            if let Some(origin)=origin_header{response.add_header(Header::from_bytes("Access-Control-Allow-Origin",origin).unwrap());}
            let _=request.respond(response);return;
        }
        let result: Result<serde_json::Value, String> = (|| {
            if request.method() == &Method::Options {
                return Ok(serde_json::json!({}));
            }
            match (request.method(), url.as_str()) {
                (&Method::Get, "/api/practice-backup/protocol") => Ok(serde_json::json!(1)),
                (&Method::Post, "/api/practice-backup/prepare") => {
                    let input = client_json(&mut request, 4096, "备份导入")?;
                    serde_json::to_value(engine.prepare_backup_import(input)?).map_err(|error| error.to_string())
                },
                (&Method::Post, "/api/practice-backup/read") | (&Method::Post, "/api/practice-backup/cancel") => {
                    let input:panthesia_engine::backup_operations::BackupImportQuery=client_json(&mut request,1024,"备份请求")?;
                    let result=if url.ends_with("/cancel") {engine.cancel_backup_import(&input.engine_id,&input.id)}else{engine.read_backup_import(&input.engine_id,&input.id)}?;
                    serde_json::to_value(result).map_err(|error|error.to_string())
                },
                (&Method::Get, "/api/service-status") => Ok(serde_json::json!({
                    "businessActive": activity.business.load(Ordering::Relaxed),
                    "readActive": activity.reads.load(Ordering::Relaxed),
                    "documentActive": activity.documents.load(Ordering::Relaxed),
                    "readWorkers": 2, "documentWorkers": 1,
                    "readQueueCapacity": 8, "documentQueueCapacity": 4,
                    "businessWorkers": 1, "controlWorkers": 2,
                    "businessQueueCapacity": 16, "controlQueueCapacity": 32,
                })),
                (&Method::Post, "/api/live-notes") => {
                    let input = client_json(&mut request, 12_000, "键盘输入")?;
                    engine.live_notes(input).and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string()))
                }
                (&Method::Post, "/api/state-frame") => {
                    let cursor = client_json(&mut request, 256, "播放状态")?;
                    serde_json::to_value(engine.state_frame(cursor)).map_err(|e| e.to_string())
                }
                (&Method::Get, "/api/state") => {
                    Ok(serde_json::to_value(engine.snapshot()).unwrap())
                }
                (&Method::Get, "/api/song") => engine.command(Command::CurrentSong),
                (&Method::Get, "/api/session") => engine.command(Command::Session),
                (&Method::Get, "/api/routines/templates") => engine.routine_templates(),
                (&Method::Get, "/api/devices") => engine.devices(false).and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
                (&Method::Post, "/api/devices/refresh") => {
                    require_client(&request)?;
                    let mut bytes = Vec::new();
                    request.as_reader().take(513).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
                    if bytes.len() > 512 { return Err("设备刷新条件过大".into()); }
                    let input: DeviceRefresh = if bytes.is_empty() { DeviceRefresh::default() }
                        else { serde_json::from_slice(&bytes).map_err(|error| error.to_string())? };
                    let result = if input.refresh == Some(false) { engine.devices(false) }
                        else { engine.refresh_devices(input.target.as_deref()) };
                    result.and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string()))
                },
                (&Method::Get, "/api/library") => {
                    let current=rows.lock().map_err(|_|"曲库列表暂不可用")?.clone();
                    Ok(serde_json::json!({"songs":library::enriched(&current,&data)}))
                },
                (&Method::Post, "/api/routines/options") => {
                    engine.routine_options(client_json(&mut request,4096,"计划来源")?)
                }
                (&Method::Post, "/api/routines/sources") => {
                    engine.read_routine_sources(client_json(&mut request,4096,"段落来源查询")?)
                }
                (&Method::Post, "/api/routines/read") => {
                    engine.read_routine_list(client_json(&mut request,4096,"计划查询")?)
                }
                (&Method::Post, "/api/history-clips/edit") => {
                    if !request.headers().iter().any(|h| h.field.equiv("X-Panthesia-Client") && h.value.as_str() == "web") { return Err("缺少本地客户端标识".into()); }
                    let mut body = String::new();
                    request.as_reader().take(512_001).read_to_string(&mut body).map_err(|error| error.to_string())?;
                    if body.len() > 512_000 { return Err("回放片段请求过大".into()); }
                    let command: Command = serde_json::from_str(&body).map_err(|error| error.to_string())?;
                    engine.edit_history_clips(command)
                }
                (&Method::Post, "/api/history-annotation") => {
                    if !request.headers().iter().any(|h| h.field.equiv("X-Panthesia-Client") && h.value.as_str() == "web") { return Err("缺少本地客户端标识".into()); }
                    let mut body = String::new();
                    request.as_reader().take(512_001).read_to_string(&mut body).map_err(|error| error.to_string())?;
                    if body.len() > 512_000 { return Err("评语请求过大".into()); }
                    let input: panthesia_engine::HistoryAnnotationRequest = serde_json::from_str(&body).map_err(|error| error.to_string())?;
                    engine.save_history_annotation(input)
                }
                (&Method::Post, "/api/history-read") => {
                    if !request.headers().iter().any(|h| h.field.equiv("X-Panthesia-Client") && h.value.as_str() == "web") { return Err("缺少本地客户端标识".into()); }
                    let mut body = String::new();
                    request.as_reader().take(16_000_001).read_to_string(&mut body).map_err(|error| error.to_string())?;
                    if body.len() > 16_000_000 { return Err("请求过大".into()); }
                    let command: panthesia_engine::HistoryReadRequest = serde_json::from_str(&body).map_err(|error| error.to_string())?;
                    engine.read_history(command)
                }
                (&Method::Post, "/api/notation-read") => {
                    let input:panthesia_engine::NotationReadRequest=client_json(&mut request,3_000_000,"谱面阅读请求")?;
                    engine.read_notation(input)
                }
                (&Method::Post, "/api/notation-document") => {
                    let input:panthesia_engine::NotationDocumentRequest=client_json(&mut request,32_000_000,"谱面解压请求")?;
                    serde_json::to_value(panthesia_engine::notation_document(input.bytes)?).map_err(|e|e.to_string())
                }
                (&Method::Post, "/api/score-map") => {
                    if !request.headers().iter().any(|h| h.field.equiv("X-Panthesia-Client") && h.value.as_str() == "web") { return Err("缺少本地客户端标识".into()); }
                    let mut body = String::new();
                    request.as_reader().take(16_000_001).read_to_string(&mut body).map_err(|error| error.to_string())?;
                    if body.len() > 16_000_000 { return Err("请求过大".into()); }
                    let input: panthesia_engine::ScoreMappingRequest = serde_json::from_str(&body).map_err(|error| error.to_string())?;
                    engine.map_score(input)
                }
                (&Method::Post, "/api/music-import/begin") => {
                    serde_json::to_value(engine.begin_music_import(client_json(&mut request, 4096, "曲目传输")?)?).map_err(|error| error.to_string())
                }
                (&Method::Post, "/api/exercise/prepare") => {
                    serde_json::to_value(engine.prepare_exercise(client_json(&mut request, 4096, "技术练习")?)?).map_err(|error| error.to_string())
                }
                (&Method::Post, "/api/package/prepare") => {
                    serde_json::to_value(engine.prepare_package(client_json(&mut request, 4096, "曲目包")?)?).map_err(|error| error.to_string())
                }
                (&Method::Post, "/api/package/preview") => {
                    serde_json::to_value(engine.refresh_package_preview(client_json(&mut request, 4096, "曲目包预览")?)?).map_err(|error| error.to_string())
                }
                (&Method::Post, "/api/music-import/chunk") => {
                    require_client(&request)?;
                    let id = request.headers().iter().find(|header| header.field.equiv("X-Panthesia-Upload"))
                        .map(|header| header.value.as_str().to_owned()).filter(|id| id.len() <= 256).ok_or("缺少文件传输编号")?;
                    let offset = request.headers().iter().find(|header| header.field.equiv("X-Panthesia-Offset"))
                        .and_then(|header| header.value.as_str().parse::<usize>().ok()).ok_or("文件分块位置无效")?;
                    let mut bytes = Vec::new();
                    request.as_reader().take(524_289).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
                    serde_json::to_value(engine.write_music_chunk(panthesia_engine::music_import::Chunk { id, offset, bytes })?).map_err(|error| error.to_string())
                }
                (&Method::Post, "/api/music-import/finish") | (&Method::Post, "/api/music-import/read") | (&Method::Post, "/api/music-import/cancel") => {
                    let selection: panthesia_engine::music_import::Selection = client_json(&mut request, 1024, "曲目导入")?;
                    let receipt = match url.as_str() {
                        "/api/music-import/finish" => engine.finish_music_import(&selection.id),
                        "/api/music-import/cancel" => engine.cancel_music_preparation(&selection.id, selection.kind),
                        _ => engine.read_music_import(&selection.id),
                    }?;
                    serde_json::to_value(receipt).map_err(|error| error.to_string())
                }
                (&Method::Post, "/api/playback-adjustment") => {
                    if !request.headers().iter().any(|h| h.field.equiv("X-Panthesia-Client") && h.value.as_str() == "web") {
                        return Err("缺少本地客户端标识".into());
                    }
                    let mut body = String::new();
                    request.as_reader().take(4097).read_to_string(&mut body).map_err(|error| error.to_string())?;
                    if body.len() > 4096 { return Err("请求过大".into()); }
                    let adjustment = serde_json::from_str(&body).map_err(|error| error.to_string())?;
                    engine.adjust_playback(adjustment)
                }
                (&Method::Post, "/api/practice-edit") | (&Method::Post, "/api/practice-read") | (&Method::Post, "/api/practice-demo") => {
                    if !request.headers().iter().any(|h| h.field.equiv("X-Panthesia-Client") && h.value.as_str() == "web") {
                        return Err("缺少本地客户端标识".into());
                    }
                    let mut body = String::new();
                    request.as_reader().take(16_000_001).read_to_string(&mut body).map_err(|e| e.to_string())?;
                    if body.len() > 16_000_000 { return Err("请求过大".into()); }
                    let edit: panthesia_engine::PracticeRequest = serde_json::from_str(&body).map_err(|e| e.to_string())?;
                    match url.as_str() {
                        "/api/practice-edit" => engine.edit_practice(edit),
                        "/api/practice-demo" => engine.start_practice_demo(edit),
                        _ => engine.read_practice(edit),
                    }
                }
                (&Method::Post, "/api/command") | (&Method::Post, "/api/control") | (&Method::Post, "/api/command-scoped") | (&Method::Post, "/api/control-scoped") | (&Method::Post, "/api/history-read-scoped") => {
                    if !request
                        .headers()
                        .iter()
                        .any(|h| h.field.equiv("X-Panthesia-Client") && h.value.as_str() == "web")
                    {
                        return Err("缺少本地客户端标识".into());
                    }
                    let limit = if url == "/api/control" || url == "/api/control-scoped" { 4096 } else { 16_000_000 };
                    let mut body = String::new();
                    request
                        .as_reader()
                        .take(limit + 1)
                        .read_to_string(&mut body)
                        .map_err(|e| e.to_string())?;
                    if body.len() as u64 > limit {
                        return Err("请求过大".into());
                    }
                    let command: Command = if url.ends_with("-scoped") {
                        let scoped: panthesia_engine::state_order::GuardedCommand = serde_json::from_str(&body).map_err(|e|e.to_string())?;
                        engine.check_engine(&scoped.engine_id)?;
                        scoped.command
                    } else { serde_json::from_str(&body).map_err(|e| e.to_string())? };
                    if (url == "/api/control" || url == "/api/control-scoped") && !panthesia_engine::is_control_command(&command) {
                        return Err("此通道只接受暂停、停止发声、按键和后台任务控制".into());
                    }
                    if url == "/api/history-read-scoped" {
                        return engine.read_history(panthesia_engine::HistoryReadRequest::Command(command));
                    }
                    if matches!(command,Command::LibraryMonitorStatus){return serde_json::to_value(monitor.status()?).map_err(|e|e.to_string());}
                    if let Command::SetLibraryMonitor{enabled}=command {monitor.set_enabled(enabled)?;return serde_json::to_value(monitor.status()?).map_err(|e|e.to_string());}
                    if matches!(command, Command::LibraryFolders) {
                        return library::folder_status(&data);
                    }
                    if matches!(
                        command,
                        Command::RefreshLibrary | Command::RemoveLibraryFolder { .. }
                    ) {
                        if let Command::RemoveLibraryFolder { path } = command {
                            library::remove_folder(&data, &path)?;
                        }
                        monitor.refresh()?;
                        return Ok(serde_json::json!({"songs":monitor.rows()?,"scheduled":true}));
                    }
                    let paths = library::command_paths(&command);
                    if !paths.is_empty() {
                        let known = engine.command(Command::Collection)?;
                        let indexed = engine.command(Command::LibraryWorkspace)?;
                        let registered = rows.lock().unwrap();
                        library::validate_paths(paths, &registered, &known, &indexed)?;
                    }
                    engine.command(command)
                }
                _ => Err("接口不存在".into()),
            }
        })();
        let (status, value) = match result {
            Ok(v) => (200, v),
            Err(e) => (400, serde_json::json!({"error": e})),
        };
        let mut response = Response::from_string(value.to_string())
            .with_status_code(status)
            .with_header(
                Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap(),
            )
            .with_header(
                Header::from_bytes(
                    "Access-Control-Allow-Headers",
                    "Content-Type, X-Panthesia-Path, X-Panthesia-Kind, X-Panthesia-Target, X-Panthesia-Page, X-Panthesia-Client, X-Panthesia-Song, X-Panthesia-Name, X-Panthesia-Append, X-Panthesia-Upload, X-Panthesia-Offset",
                )
                .unwrap(),
            )
            .with_header(
                Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
            );
        if let Some(origin) = origin_header {
            response.add_header(Header::from_bytes("Access-Control-Allow-Origin", origin).unwrap());
        }
        let _ = request.respond(response);
}
use std::io::Read;

fn decode_name(value:&str)->Result<String,String>{let mut result=Vec::new();let b=value.as_bytes();let mut i=0;while i<b.len(){if b[i]==b'%'{if i+2>=b.len(){return Err("名称编码无效".into())}let s=std::str::from_utf8(&b[i+1..i+3]).map_err(|_|"名称编码无效")?;result.push(u8::from_str_radix(s,16).map_err(|_|"名称编码无效")?);i+=3;}else{result.push(b[i]);i+=1;}}String::from_utf8(result).map_err(|_|"名称编码无效".into())}
