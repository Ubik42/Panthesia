use crate::{Command, Player, Snapshot, background_tasks::TaskToken, fingerings};
use std::sync::{Arc, Mutex, mpsc};

pub(crate) type Reply = mpsc::SyncSender<Result<serde_json::Value, String>>;
pub(crate) enum RecentSource {
    File(String, Vec<std::path::PathBuf>),
    Exercise(panthesia_core::exercise::ExerciseSpec),
}
pub(crate) enum Request {
    SongAuditionAbort(String),
    PaperNavigationContext { content_id: String, reply: mpsc::SyncSender<Result<crate::paper_navigation::Context, String>> },
    PaperNavigationInstall { prepared: crate::paper_navigation::Prepared, sequence: u64, latest: Arc<std::sync::atomic::AtomicU64>, received: std::time::Instant, token: TaskToken, reply: Reply },
    ScopedImportContext { origin: crate::song_switch::Origin, cancelled: Arc<std::sync::atomic::AtomicBool>, received: std::time::Instant, reply: mpsc::SyncSender<Result<crate::song_switch::Origin, String>> },
    PlaybackAdjustment(crate::state_order::PlaybackAdjustment, std::time::Instant, Reply),
    LiveNotes(crate::live_notes::Input,std::time::Instant,mpsc::SyncSender<Result<crate::live_notes::Acknowledgement,String>>),
    InputContext{name:Option<String>,reply:mpsc::SyncSender<Result<u64,String>>},
    InputCommit{revision:u64,prepared:crate::input_runtime::Prepared,token:TaskToken,reply:Reply},
    SoundChangeBegin{id:String,font:bool,target:Option<String>,reply:mpsc::SyncSender<Result<u64,String>>},
    SoundChangeAbort(String),
    SoundOutputCommit{id:String,revision:u64,prepared:crate::sound_runtime::Prepared,token:TaskToken,reply:Reply},
    SoundFontLiveCommit{id:String,revision:u64,prepared:crate::soundfont_loading::LivePrepared,token:TaskToken,reply:Reply},
    CatalogContext {source:bool,guard:crate::practice_catalog::Guard,scope:Option<crate::practice_edit::Scope>,reply:mpsc::SyncSender<Result<crate::practice_catalog::Context,String>>},
    CatalogCommit {patch:Arc<crate::practice_catalog::Installation>,token:TaskToken,reply:mpsc::SyncSender<Result<(),String>>},
    HistoryQueryContext{current_song:bool,reply:mpsc::SyncSender<Result<crate::history_reader::Context,String>>},
    ScoreMappingContext {content_id:String,revision:Option<u64>,fingerprint:Option<String>,reply:mpsc::SyncSender<Result<crate::score_mapping::Context,String>>},
    ScoreMappingInstall {prepared:crate::score_mapping::Installation,token:TaskToken,reply:mpsc::SyncSender<Result<(),String>>},
    AuditionContext {scope:Option<crate::practice_edit::Scope>,request_id:String,reply:mpsc::SyncSender<Result<crate::demo_loading::Context,String>>},
    AuditionCommit {origin:crate::demo_loading::Origin,prepared:crate::demo_loading::Prepared,token:TaskToken,reply:Reply},
    BasicReadContext {request:fingerings::BasicRequest,reply:mpsc::SyncSender<Result<(crate::asset_edit::Context,String),String>>},
    PracticeEditBegin{id:String,kind:crate::practice_edit::Kind,strict:bool,scope:Option<crate::practice_edit::Scope>,reply:mpsc::SyncSender<Result<crate::asset_edit::Context,String>>},
    DocumentContext(mpsc::SyncSender<Result<(crate::asset_edit::Context,Snapshot,bool),String>>),
    CurrentSource {content_id: String, reply: mpsc::SyncSender<Result<Option<std::path::PathBuf>, String>>},
    PackagePresence {content_id:String,reply:mpsc::SyncSender<Result<bool,String>>},
    SongSwitchBegin { id: String, origin: crate::song_switch::Origin, reply: mpsc::SyncSender<Result<crate::asset_edit::Context,String>> },
    AssetReadContext{registry:bool,export:bool,editor:bool,scope:Option<crate::practice_edit::Scope>,reply:mpsc::SyncSender<Result<crate::asset_edit::Context,String>>},
    AssetEditBegin{id:String,apply:bool,registry:bool,runtime:bool,reply:mpsc::SyncSender<Result<crate::asset_edit::Context,String>>},
    AssetEditFinish{id:String,result:Result<crate::asset_edit::Outcome,String>,reply:Option<Reply>},
    StartupFinished(Result<crate::startup::Prepared,String>),
    RecordingSaveBegin {id:String,reply:mpsc::SyncSender<Result<crate::recording_save::Context,String>>},
    RecordingSaveFinish {id:String,result:Result<crate::recording_save::Outcome,String>,reply:Option<Reply>},
    Shutdown,
    StorageFence(mpsc::SyncSender<Result<crate::storage_close::Fence,String>>),
    StorageRecoveryObserved(mpsc::SyncSender<Result<crate::pending_save::StorageStatus,String>>),
    SaveFinished { result: Result<(), String>, replies: Vec<crate::pending_save::Completion> },
    Command(Command, Reply),
    ImportContext(mpsc::SyncSender<Result<crate::song_switch::Origin, String>>),
    PreparationContext { current: crate::operation_journal::PreparationOrigin, reply: mpsc::SyncSender<Result<crate::song_switch::Origin, String>> },
    RecentSource(String, mpsc::SyncSender<Result<RecentSource, String>>),
    #[cfg(test)]
    ExerciseCommit(crate::song_switch::Origin, crate::exercise_loading::Prepared, TaskToken, Reply),
    #[cfg(test)]
    LoadCommit(
        crate::song_switch::Origin,
        crate::load_pipeline::Prepared,
        TaskToken,
        Reply,
    ),
    BasicCommit(
        fingerings::BasicPrepared,
        Vec<fingerings::Proposal>,
        TaskToken,
        Reply,
    ),
}

pub(crate) fn handle(player: &mut Player, request: Request, shared: &Arc<Mutex<Snapshot>>) {
    let barrier=match &request {
        Request::PlaybackAdjustment(..) => true,
        Request::Command(command,_)=>!matches!(command,Command::Panic|Command::Pause|Command::Note{..}|Command::StopFingerDemo{..}|Command::FingerDemoState|Command::CurrentSong|Command::Session|Command::Tasks|Command::CancelTask{..}|Command::CancelHistoryRead{..}),
        Request::InputCommit{..}|Request::SoundOutputCommit{..}|Request::SoundFontLiveCommit{..}|Request::CatalogCommit{..}|Request::AssetEditFinish{..}|Request::RecordingSaveFinish {..}|Request::BasicCommit(..)=>true,
        #[cfg(test)]
        Request::LoadCommit(..)|Request::ExerciseCommit(..)=>true,
        _=>false,
    };
    // Per-song preferences of a song at its own location go back to its manifest.
    let run=|player:&mut Player|{handle_inner(player,request,shared);if barrier{player.sync_manifest_settings();}};
    if let Some(pipeline)=player.pending_saves.clone() {
        let (writes,replies)=crate::pending_save::capture(&pipeline,||run(player));
        pipeline.enqueue(writes,replies,barrier);
        return;
    }
    run(player);
}
fn handle_inner(player: &mut Player, request: Request, shared: &Arc<Mutex<Snapshot>>) {
    let allowed = match &request {
        Request::Command(command, _) => crate::storage_control::allowed(command)||(matches!(command,Command::Note{..})&&player.recorder.is_recording()),
        Request::SongAuditionAbort(_) | Request::LiveNotes(..) | Request::SoundChangeAbort(_) | Request::DocumentContext(_) | Request::CurrentSource{..} | Request::AssetEditFinish{..} | Request::RecordingSaveFinish {..} | Request::StartupFinished(_) | Request::Shutdown | Request::SaveFinished { .. } | Request::StorageFence(_) | Request::StorageRecoveryObserved(_) => true,
        Request::ScoreMappingContext{..} | Request::ScoreMappingInstall{..} if !player.closing.load(std::sync::atomic::Ordering::Acquire) => true,
        _ => false,
    };
    if (player.storage_busy.load(std::sync::atomic::Ordering::Acquire)||player.closing.load(std::sync::atomic::Ordering::Acquire)) && !allowed {
        request.reject("练习资料正在保存或恢复，请等待当前任务完成");
        return;
    }
    match request {
        Request::SongAuditionAbort(id) => {player.stop_song_audition(Some(&id));}
        Request::PaperNavigationContext { content_id, reply } => {
            crate::pending_save::respond(reply, player.capture_paper_navigation(&content_id));
        }
        Request::PaperNavigationInstall { prepared, sequence, latest, received, token, reply } => {
            let result = player.install_paper_navigation(prepared, sequence, &latest, received, &token);
            crate::state_projection::publish(player, shared);
            // Release the worker's manifest lock before any captured settings save waits on storage.
            let _ = reply.send(result);
        }
        Request::PlaybackAdjustment(request, received, reply) => {
            if received.elapsed() > std::time::Duration::from_secs(2) {
                crate::pending_save::respond(reply, Err("调节请求已过期，请在当前曲目中重新调节".into()));
            } else if let Err(error) = request.check(player) {
                crate::pending_save::respond(reply, Err(error));
            } else {
                handle_inner(player, Request::Command(request.command, reply), shared);
            }
        }
        Request::LiveNotes(input, received, reply) => {
            let result = player.apply_live_notes(input, received);
            crate::state_projection::publish(&player, &shared);
            crate::pending_save::respond(reply, result);
        }
        Request::InputContext{name,reply}=>{crate::pending_save::respond(reply,player.input_context(name.as_deref()));}
        Request::InputCommit{revision,prepared,token,reply}=>{let result=player.install_input(revision,prepared,&token);crate::state_projection::publish(&player, &shared);crate::pending_save::respond(reply,result);}
        Request::SoundChangeBegin{id,font,target,reply}=>{crate::pending_save::respond(reply,player.begin_sound_change(id,font,target));}
        Request::SoundChangeAbort(id)=>{player.abort_sound_change(&id);}
        Request::SoundOutputCommit{id,revision,prepared,token,reply}=>{let result=player.install_output(&id,revision,prepared,&token);crate::state_projection::publish(&player, &shared);crate::pending_save::respond(reply,result);}
        Request::SoundFontLiveCommit{id,revision,prepared,token,reply}=>{let result=player.install_live_soundfont(&id,revision,prepared,&token);crate::state_projection::publish(&player, &shared);crate::pending_save::respond(reply,result);}
        Request::CatalogContext {source,guard,scope,reply} => {crate::pending_save::respond(reply,player.capture_catalog(source,&guard,scope.as_ref()));}
        Request::CatalogCommit {patch,token,reply} => {
            let result=player.install_catalog(&patch,&token);
            crate::state_projection::publish(&player,&shared);
            crate::pending_save::respond(reply,result);
        }
        Request::HistoryQueryContext{current_song,reply}=>{crate::pending_save::respond(reply,Ok(player.capture_history_reader(current_song)));}
        Request::ScoreMappingContext{content_id,revision,fingerprint,reply} => {crate::pending_save::respond(reply,player.capture_score_mapping(&content_id,revision,fingerprint.as_deref()));}
        Request::ScoreMappingInstall{prepared,token,reply} => {crate::pending_save::respond(reply,player.install_score_mapping(prepared,&token));}
        Request::AuditionContext {scope,request_id,reply} => {crate::pending_save::respond(reply, player.prepare_audition(scope, request_id));}
        Request::AuditionCommit {origin,prepared,token,reply} => {
            let result=player.install_audition(origin,prepared,&token);
            crate::state_projection::publish(&player, &shared);
            crate::pending_save::respond(reply,result);
        }
        Request::BasicReadContext{request,reply}=>{
            let result=player.basic_origin(&request).map(|origin|{let context=player.capture_practice_read_context();(context,origin)});
            crate::pending_save::respond(reply,result);
        }
        Request::PracticeEditBegin{id,kind,strict,scope,reply}=>{let result=player.begin_practice_edit(id.clone(),kind,strict,scope);if reply.send(result).is_err(){let _=player.finish_asset_edit(&id,Err("练习编辑调用已关闭".into()));}crate::state_projection::publish(&player, &shared);}
        Request::DocumentContext(reply)=>{crate::pending_save::respond(reply,Ok((player.capture_document_context(),player.snapshot(),!player.finger_undo.is_empty())));}
        Request::CurrentSource{content_id,reply}=>{
            let result=player.file.as_ref().filter(|file|file.content_id==content_id)
                .ok_or_else(|| "曲目已切换，请重新打开谱面管理".to_string())
                .map(|file|file.source_path.clone());
            crate::pending_save::respond(reply,result);
        }
        Request::PackagePresence {content_id,reply}=>{crate::pending_save::respond(reply,Ok(player.history.song(&content_id).is_some()));}
        Request::SongSwitchBegin {id,origin,reply} => {
            let result=player.begin_song_switch(id.clone(),&origin);
            if reply.send(result).is_err() { let _=player.finish_asset_edit(&id,Err("曲目切换调用已关闭".into())); }
            crate::state_projection::publish(&player, &shared);
        }
        Request::AssetReadContext{registry,export,editor,scope,reply}=>{
            let result=player.check_practice_scope(scope.as_ref()).and_then(|_| if export&&player.recorder.is_recording() {Err("请先停止并保存录音，再导出曲目".into())} else {Ok(if editor {player.capture_practice_read_context()} else {player.capture_asset_context(registry,true)})});
            crate::pending_save::respond(reply,result);
        }
        Request::AssetEditBegin{id,apply,registry,runtime,reply}=>{
            let result=player.begin_asset_edit(id.clone(),apply,registry,runtime);
            if reply.send(result).is_err(){let subject=if id.starts_with("library-edit-"){ "曲库资料" }else{"谱面管理"};let _=player.finish_asset_edit(&id,Err(format!("{subject}调用已关闭")));}
            crate::state_projection::publish(&player, &shared);
        }
        Request::AssetEditFinish{id,result,reply}=>{
            let result=player.finish_asset_edit(&id,result);
            crate::state_projection::publish(&player, &shared);
            if let Some(reply)=reply{crate::pending_save::respond(reply,result);}
        }
        Request::RecordingSaveBegin {id,reply} => {
            let result=player.begin_recording_save(id.clone());
            if reply.send(result).is_err() {let _=player.finish_recording_save(&id,Err("录音保存调用已关闭，请重试保存录音".into()));}
            crate::state_projection::publish(&player, &shared);
        }
        Request::RecordingSaveFinish {id,result,reply} => {
            let result=player.finish_recording_save(&id,result);
            crate::state_projection::publish(&player, &shared);
            if let Some(reply)=reply {crate::pending_save::respond(reply,result);}
        }
        Request::StartupFinished(result) => {
            player.install_startup(result);
            crate::state_projection::publish(&player, &shared);
        }
        Request::Shutdown => { player.panic(); }
        Request::StorageFence(reply) => {
            let notes=player.matcher.snapshot();
            let round_pending=!player.state.saved&&player.file.is_some()&&(notes.matched_notes+notes.wrong_notes+notes.missed_notes>0);
            let incomplete_recital=false;
            let unsaved_round=player.save_error.is_some()&&round_pending&&!crate::storage_control::recovery(player).round;
            let storage=crate::storage_control::status(player);
            crate::pending_save::respond(reply,Ok(crate::storage_close::Fence {
                recording: player.recorder.is_recording(), recording_unsaved: player.recorder.has_take()&&!player.recording_saved,
                unsaved_round, round_pending, incomplete_recital,
                progress_pending: false,
                exclusive: player.storage_id.is_some()||player.sound_change.is_some(),
                error: storage.error.clone(), storage,
            }));
        }
        Request::StorageRecoveryObserved(reply) => {
            crate::storage_control::unblock(player);
            crate::state_projection::publish(player, shared);
            crate::pending_save::respond(reply, Ok(crate::storage_control::status(player)));
        }
        Request::SaveFinished { result, replies } => {
            player.finish_settings_save(&result);
            crate::state_projection::publish(&player, &shared);
            for reply in replies { reply(result.clone()); }
        }
        Request::RecentSource(id, reply) => {
            let result = player
                .history
                .song(&id)
                .ok_or_else(|| "找不到该练习记录".to_string())
                .map(|record| {
                    if let Some(spec) = record.setup.as_ref().and_then(|s| s.exercise_spec) {
                        RecentSource::Exercise(spec)
                    } else {
                        RecentSource::File(
                            record.display_name.clone(),
                            record
                                .setup
                                .as_ref()
                                .and_then(|s| s.source_path.clone())
                                .into_iter()
                                .chain(record.library.source_path.clone())
                                .collect(),
                        )
                    }
                });
            crate::pending_save::respond(reply,result);
        }
        #[cfg(test)]
        Request::ExerciseCommit(origin, prepared, token, reply) => {
            let result = player.check_switch_origin(&origin, "生成技术练习")
                .and_then(|_| {
                    if ["playing", "countIn"].contains(&player.state.status.as_str()) || !player.state.pressed.is_empty() {
                        Err("生成准备期间已开始演奏，请暂停并松开琴键后重试".into())
                    } else { Ok(()) }
                })
                .and_then(|_| prepared.check())
                .and_then(|_| token.begin_commit())
                .and_then(|_| {
                    prepared.install(player)?;
                    player.persist()?;
                    player.command(Command::CurrentSong)
                });
            crate::state_projection::publish(&player, &shared);
            crate::pending_save::respond(reply,result);
        }
        #[cfg(test)]
        Request::LoadCommit(origin, prepared, token, reply) => {
            let result = player
                .check_switch_origin(&origin, "加载")
                .and_then(|_| prepared.check())
                .and_then(|_| token.begin_commit())
                .and_then(|_| {
                    player.install_prepared(
                        prepared.file,
                        prepared.title,
                        None,
                        Some(crate::load_pipeline::InstallData {
                            assets: Some(prepared.assets),
                            timeline: prepared.timeline,
                        }),
                    )?;
                    player.command(Command::CurrentSong)
                });
            crate::state_projection::publish(&player, &shared);
            crate::pending_save::respond(reply,result);
        }
        Request::ScopedImportContext { origin, cancelled, received, reply } => {
            if cancelled.load(std::sync::atomic::Ordering::Acquire) || received.elapsed() > std::time::Duration::from_secs(2) {
                crate::pending_save::respond(reply, Err("后台任务已取消，导入准备请求已结束或过期".into()));
                return;
            }
            let result = player.check_switch_origin(&origin, "导入").and_then(|_| player.begin_import());
            crate::state_projection::publish(&player, &shared);
            crate::pending_save::respond(reply, result);
        }
        Request::ImportContext(reply) => {
            let result = player.begin_import();
            crate::state_projection::publish(&player, &shared);
            crate::pending_save::respond(reply,result);
        }
        Request::PreparationContext { current, reply } => {
            let result = current.check(player).and_then(|_| player.begin_import());
            crate::state_projection::publish(&player, &shared);
            crate::pending_save::respond(reply, result);
        }
        Request::Command(command, reply) => {
            if matches!(
                command,
                Command::ImportScoreOriginal { .. }

            ) && !player.recorder.is_recording()
            {
                player.panic();
                if player.state.status != "finished" {
                    player.state.status = "paused".into();
                }
                crate::state_projection::publish(&player, &shared);
            }
            let result = player.command(command);
            crate::state_projection::publish(&player, &shared);
            crate::pending_save::respond(reply,result);
        }
        Request::BasicCommit(prepared, proposals, token, reply) => {
            let result = token
                .begin_commit()
                .and_then(|_| player.commit_basic_fingers(&prepared, proposals));
            crate::state_projection::publish(&player, &shared);
            crate::pending_save::respond(reply,result);
        }
    }
}

impl Request {
    fn reject(self, message: &str) {
        macro_rules! fail { ($reply:expr) => { let _ = $reply.send(Err(message.into())); }; }
        match self {
            Self::SongAuditionAbort(_) => {}
            Self::LiveNotes(_,_,reply) => {fail!(reply);}
            Self::InputContext{reply,..}=>{fail!(reply);}
            Self::InputCommit{reply,..}=>{fail!(reply);}
            Self::SoundChangeBegin{reply,..}=>{fail!(reply);}
            Self::SoundChangeAbort(_)=>{}
            Self::SoundOutputCommit{reply,..}|Self::SoundFontLiveCommit{reply,..}=>{fail!(reply);}
            Self::CatalogContext{reply,..}=>{fail!(reply);}
            Self::CatalogCommit{reply,..}=>{fail!(reply);}
            Self::PaperNavigationContext { reply, .. } => { fail!(reply); }
            Self::PaperNavigationInstall { reply, .. } => { fail!(reply); }
            Self::HistoryQueryContext{reply,..}=>{fail!(reply);}
            Self::ScoreMappingContext{reply,..}=>{fail!(reply);}
            Self::ScoreMappingInstall{reply,..}=>{fail!(reply);}
            Self::AuditionContext{reply,..}=>{fail!(reply);}
            Self::AuditionCommit{reply,..}=>{fail!(reply);}
            Self::BasicReadContext{reply,..}=>{fail!(reply);}
            Self::PracticeEditBegin{reply,..}=>{fail!(reply);}
            Self::DocumentContext(reply)=>{fail!(reply);}
            Self::CurrentSource{reply,..}=>{fail!(reply);}
            Self::PackagePresence {reply,..}=>{fail!(reply);}
            Self::AssetReadContext{reply,..}=>{fail!(reply);}
            Self::AssetEditBegin{reply,..}=>{fail!(reply);}
            Self::AssetEditFinish{reply,..}=>{if let Some(reply)=reply{fail!(reply);}}
            Self::RecordingSaveBegin {reply,..} => {fail!(reply);}
            Self::RecordingSaveFinish {reply,..} => {if let Some(reply)=reply {fail!(reply);}}
            Self::StartupFinished(_) => {}
            Self::Shutdown => {}
            Self::StorageFence(reply) => { fail!(reply); }
            Self::StorageRecoveryObserved(reply) => { fail!(reply); }
            Self::SaveFinished { result: _, replies } => { for reply in replies { reply(Err(message.into())); } }
            Self::PlaybackAdjustment(_, _, reply) | Self::Command(_, reply) | Self::BasicCommit(_, _, _, reply) => { fail!(reply); }
            #[cfg(test)]
            Self::ExerciseCommit(_, _, _, reply) | Self::LoadCommit(_, _, _, reply) => { fail!(reply); }
            Self::SongSwitchBegin {reply,..} => { fail!(reply); }
            Self::ImportContext(reply) | Self::ScopedImportContext { reply, .. } | Self::PreparationContext { reply, .. } => { fail!(reply); }
            Self::RecentSource(_, reply) => { fail!(reply); }
        }
    }
}

impl Player {
    fn basic_origin(&self,request:&fingerings::BasicRequest)->Result<String,String> {
        let file=self.file.as_ref().ok_or("请先选择曲目")?;
        let cid=&file.content_id;
        let parts: Vec<_> = self.config.tracks.iter().map(|track| (track.track_id, track.practice_part)).collect();
        let encoded=serde_json::to_vec(&(cid,&parts,self.score_revision,self.state.annotation_revision,&self.state.hands,self.config.practice_track_setup(),self.preferences.fingering_profiles.get(cid),self.preferences.hand_span_profiles.get(cid),request)).map_err(|e|e.to_string())?;
        Ok(blake3::hash(&encoded).to_hex().to_string())
    }

    pub(crate) fn prepare_basic_fingers(
        &self,
        request: &fingerings::BasicRequest,
    ) -> Result<fingerings::BasicPrepared, String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let mut context = fingerings::prepare_basic(
            file,
            &self.config,
            &self.fingers,
            &self.note_hands,
            request,
        )?;
        let legacy = self
            .preferences
            .fingering_profiles
            .get(&file.content_id)
            .and_then(|profiles| profiles.get(&request.track));
        let hand = self
            .preferences
            .hand_span_profiles
            .get(&file.content_id)
            .and_then(|profiles| {
                profiles.get(&format!(
                    "{}:{}",
                    request.track,
                    crate::hands::label(context.part)
                ))
            });
        context.fingerprint = blake3::hash(
            &serde_json::to_vec(&(&context.fingerprint, legacy, hand))
                .map_err(|e| e.to_string())?,
        )
        .to_hex()
        .to_string();
        Ok(context)
    }
    pub(crate) fn commit_basic_fingers(
        &mut self,
        context: &fingerings::BasicPrepared,
        proposals: Vec<fingerings::Proposal>,
    ) -> Result<serde_json::Value, String> {
        let valid=if let Some(origin)=&context.origin {self.basic_origin(&context.request)?==*origin} else {
            let current=self.prepare_basic_fingers(&context.request)?;
            current.content_id==context.content_id&&current.fingerprint==context.fingerprint
        };
        if !valid {return Err("曲目、分手或已有指法已变化，请重新生成建议".into());}
        let old = self.preferences.clone();
        self.preferences
            .fingering_profiles
            .entry(context.content_id.clone())
            .or_default()
            .insert(context.request.track, context.request.profile);
        self.preferences
            .hand_span_profiles
            .entry(context.content_id.clone())
            .or_default()
            .insert(
                format!(
                    "{}:{}",
                    context.request.track,
                    crate::hands::label(context.part)
                ),
                context.request.profile,
            );
        if let Err(error) = self.preferences.save(&self.preferences_path) {
            self.preferences = old;
            return Err(error);
        }
        Ok(
            serde_json::json!({"contentId":context.content_id,"fingerprint":context.fingerprint,"proposals":proposals,"undoAvailable":!self.finger_undo.is_empty()}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Engine, data_root_lock::DataRootLock};
    use panthesia_core::{exercise::ExerciseSpec, fingering::HandSpanProfile};
    use std::{
        path::PathBuf,
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    fn data(name: &str) -> PathBuf {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/runtime-unit")
            .join(format!(
                "{name}-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    fn player() -> (Player, fingerings::BasicRequest) {
        let mut player = Player::new(data("basic"), PathBuf::new(), true);
        player
            .command(Command::Generate {
                spec: ExerciseSpec::default(),
            })
            .unwrap();
        let track = player
            .file
            .as_ref()
            .unwrap()
            .tracks
            .iter()
            .find(|track| !track.notes.is_empty())
            .unwrap()
            .track_id;
        (
            player,
            fingerings::BasicRequest {
                hand: None,
                track,
                index: 0,
                profile: HandSpanProfile::Standard,
                range: Some((1, 1)),
            },
        )
    }
    #[test]
    fn basic_result_rechecks_current_notes_and_profile_before_commit() {
        let (mut player, request) = player();
        let context = player.prepare_basic_fingers(&request).unwrap();
        let proposals = fingerings::basic_proposals(&context);
        player
            .preferences
            .fingering_profiles
            .entry(context.content_id.clone())
            .or_default()
            .insert(request.track, HandSpanProfile::Compact);
        let before = serde_json::to_value(&player.preferences).unwrap();
        assert!(player.commit_basic_fingers(&context, proposals).is_err());
        assert_eq!(serde_json::to_value(&player.preferences).unwrap(), before);
        let context = player.prepare_basic_fingers(&request).unwrap();
        let proposals = fingerings::basic_proposals(&context);
        player.note_hands.insert(
            (request.track, 0),
            panthesia_core::practice::PracticePart::Other,
        );
        assert!(player.commit_basic_fingers(&context, proposals).is_err());
    }
    #[test]
    fn basic_profile_write_failure_restores_in_memory_preferences() {
        let (mut player, request) = player();
        let context = player.prepare_basic_fingers(&request).unwrap();
        let proposals = fingerings::basic_proposals(&context);
        std::fs::write(player.data.join("blocked"), b"file").unwrap();
        player.preferences_path = player.data.join("blocked/preferences.json");
        let before = serde_json::to_value(&player.preferences).unwrap();
        assert!(player.commit_basic_fingers(&context, proposals).is_err());
        assert_eq!(serde_json::to_value(&player.preferences).unwrap(), before);
    }
    #[test]
    fn blocked_cpu_work_does_not_block_playback_or_reserved_controls() {
        let root = data("responsive");
        let lock = DataRootLock::acquire(&root).unwrap();
        let engine = Engine::start(root, lock, PathBuf::new(), true).unwrap();
        // Engine construction starts recovery asynchronously. Exercise the
        // scheduling invariant only after startup has released its data lock.
        let ready_deadline = std::time::Instant::now() + Duration::from_secs(15);
        while !engine.snapshot().startup.ready || engine.storage_busy.load(std::sync::atomic::Ordering::Acquire) {
            assert!(std::time::Instant::now() < ready_deadline, "startup did not finish");
            thread::sleep(Duration::from_millis(2));
        }
        engine
            .command(Command::Generate {
                spec: ExerciseSpec::default(),
            })
            .unwrap();
        engine.command(Command::CountIn { bars: 0 }).unwrap();
        engine
            .command(Command::Mode {
                value: "listen".into(),
            })
            .unwrap();
        let (started, start) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let worker_engine = engine.clone();
        let waiting = thread::spawn(move || {
            worker_engine.tasks.run("held by test", None, move |_| {
                started.send(()).unwrap();
                gate.recv().unwrap();
                Ok(serde_json::Value::Null)
            })
        });
        start.recv_timeout(Duration::from_secs(2)).unwrap();
        engine.command(Command::Play).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while engine.snapshot().position <= 0.01 {
            assert!(std::time::Instant::now() < deadline);
            thread::yield_now();
        }
        let control = engine.clone();
        let (responded, response) = mpsc::channel();
        let controller =
            thread::spawn(move || responded.send(control.command(Command::Pause)).unwrap());
        response
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        assert_eq!(engine.snapshot().status, "paused");
        let tasks = engine.command(Command::Tasks).unwrap();
        let id = tasks
            .as_array()
            .unwrap()
            .iter()
            .find(|task| task["label"] == "held by test")
            .unwrap()["id"]
            .as_str()
            .unwrap();
        engine
            .command(Command::CancelTask { id: id.into() })
            .unwrap();
        assert!(waiting.join().unwrap().is_err());
        release.send(()).unwrap();
        controller.join().unwrap();
    }
    #[test]
    fn public_basic_fingering_runs_through_task_pool_and_preserves_reply() {
        let root = data("public");
        let lock = DataRootLock::acquire(&root).unwrap();
        let engine = Engine::start(root, lock, PathBuf::new(), true).unwrap();
        let song = engine
            .command(Command::Generate {
                spec: ExerciseSpec::default(),
            })
            .unwrap();
        let track = song["notes"][0]["track"].as_u64().unwrap() as usize;
        let result = engine
            .command(Command::SuggestFingers {
                hand: None,
                track,
                index: 0,
                profile: HandSpanProfile::Standard,
                range: Some((1, 1)),
            })
            .unwrap();
        assert_eq!(result["contentId"], song["contentId"]);
        assert!(!result["proposals"].as_array().unwrap().is_empty());
        let tasks = engine.command(Command::Tasks).unwrap();
        let task = tasks.as_array().unwrap().iter().find(|t| t["fingerprint"] == result["fingerprint"]).unwrap();
        assert_eq!(task["state"], "succeeded");
    }
}
