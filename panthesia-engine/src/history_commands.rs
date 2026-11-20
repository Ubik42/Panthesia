use super::*;
use panthesia_core::practice_history::{PracticePassageBounds, PracticeSessionContext};
use serde_json::{Value, json};

fn session_id(session: &PracticeSession) -> String {session.stable_id()}
fn passage_beat_label(file: &midi_file::MidiFile, tick: u64) -> Option<String> {
    let measures = &file.musical_time.measures;
    let index = measures.partition_point(|m| m.start_tick <= tick).checked_sub(1)?;
    let measure = measures.get(index)?;
    if tick > measure.end_tick { return None; }
    if tick == measure.end_tick && index + 1 == measures.len() {
        return Some(format!("第 {} 小节结束", index + 1));
    }
    let denominator = u128::from(file.musical_time.ppq) * 4
        * if measure.denominator == 8 && measure.numerator >= 6 && measure.numerator % 3 == 0 { 3 } else { 1 };
    let numerator = u128::from(tick - measure.start_tick) * u128::from(measure.denominator);
    if denominator == 0 { return None; }
    let whole = numerator / denominator;
    let remainder = numerator % denominator;
    let beat = whole + 1;
    if remainder == 0 { return Some(format!("第 {} 小节第 {} 拍", index + 1, beat)); }
    let mut a = remainder;
    let mut b = denominator;
    while b != 0 { (a, b) = (b, a % b); }
    Some(format!("第 {} 小节第 {} 拍后 {}/{} 拍", index + 1, beat, remainder / a, denominator / a))
}
pub(super) fn passage_location(file: &midi_file::MidiFile, bounds: PracticePassageBounds) -> Option<String> {
    if bounds.start_tick >= bounds.end_tick { return None; }
    Some(format!("{} → {}",
        passage_beat_label(file, bounds.start_tick)?,
        passage_beat_label(file, bounds.end_tick)?))
}
fn entry(
    content_id: &str,
    title: &str,
    path: Option<&PathBuf>,
    session: &PracticeSession,
) -> Value {
    json!(crate::history_list::HistoryListEntry::new(content_id, title, path, session))
}
fn condition_summary(session: &PracticeSession) -> Value {
    let range = match session.kind {
        PracticeSessionKind::WholeSong => None,
        PracticeSessionKind::Loop { start_measure, end_measure } => Some([start_measure, end_measure]),
    };
    let Some(context) = session.context.as_ref() else {
        return json!({"complete":false,"range":range,"mode":session.mode,"hands":session.hands,
            "speed":session.speed,"effectiveTempoBpm":session.effective_tempo_bpm,
            "scope":session.scope});
    };
    json!({"complete":session.scope.as_deref().is_some_and(|s|!s.is_empty())
            && session.mode.as_deref().is_some_and(|s|!s.is_empty())
            && context.target_notes>0 && context.judged_notes>0
            && !context.grid.is_empty() && !context.hands.is_empty(),
        "range":range,"passageBounds":context.passage_bounds,
        "mode":session.mode,"hands":session.hands,"speed":session.speed,
        "effectiveTempoBpm":session.effective_tempo_bpm,"scope":session.scope,"grid":context.grid,
        "loopRestart":context.loop_restart,"targetNotes":context.target_notes,"judgedNotes":context.judged_notes,
        "tracks":context.tracks,"notePlayback":context.note_playback,"parts":context.parts,"assignedHands":context.hands,
        "exerciseSpec":context.exercise_spec,"countIn":context.count_in,
        "metronome":context.metronome,"inputLatencyMs":context.latency,
        "pedalLatencyMs":context.pedal_latency_ms.unwrap_or(context.latency),
        "pedalLatencySource":if context.pedal_latency_ms.is_some(){"saved"}else{"legacyInputLatency"},
        "rounds":context.rounds,"adaptive":context.adaptive,
        "expressionGoal":context.expression.as_ref().or_else(||context.routine.as_ref().and_then(|r|r.expression.as_ref()))})
}
impl Player {
    pub(super) fn set_library_collection(&mut self,path:&PathBuf,content_id:&str,favorite:Option<bool>,queued:Option<bool>) -> Result<Value,String> {
        if content_id.len()!=64 || !content_id.bytes().all(|b|b.is_ascii_hexdigit()) || favorite.is_some()==queued.is_some() {return Err("请选择一项有效的曲目收藏或队列操作".into());}
        let mut workspace=crate::library_workspace::Workspace::load(&self.data)?;
        let entry=if path.is_file(){workspace.inspect(path.clone(),true)?}else{workspace.entries.get(&crate::library_workspace::key(path)).cloned().ok_or("未知文件位置，请先检查文件")?};
        if entry.content_id.as_deref()!=Some(content_id) {return Err("文件内容已改变，请重新检查并选择曲目".into());}
        let title=entry.metadata.title.clone().unwrap_or_else(||path.file_stem().unwrap_or_default().to_string_lossy().into());
        if let Some(enabled)=favorite {self.history.set_favorite(content_id,&title,Some(path.clone()),enabled).map_err(|e|e.to_string())?;}
        if let Some(enabled)=queued {self.history.set_queued(content_id,&title,Some(path.clone()),enabled).map_err(|e|e.to_string())?;}
        let library=self.history.song(content_id).map(|s|&s.library);
        Ok(json!({"favorite":library.is_some_and(|l|l.favorite),"queuePosition":library.and_then(|l|l.queue_position)}))
    }

    pub(super) fn practice_time(&self,content_id:&str,from:u64,to:u64)->Result<Value,String>{self.practice_time_checked(content_id,from,to,||Ok(()))}
    pub(super) fn practice_time_checked(&self,content_id:&str,from:u64,to:u64,check:impl Fn()->Result<(),String>)->Result<Value,String>{
        if content_id.len()!=64||!content_id.bytes().all(|b|b.is_ascii_hexdigit())||from>=to||to>9_000_000_000_000_000{return Err("曲目或统计时间范围无效".into())}
        let sessions=self.history.song(content_id).map(|s|s.sessions.as_slice()).unwrap_or(&[]);let ledger=self.history.time_ledger().get(content_id);
        let mut total=0u64;let mut period=0u64;let mut untracked=0u64;let mut earliest=None;
        for entry in ledger.into_iter().flat_map(|entries|entries.values()){check()?;untracked=untracked.saturating_add(entry.untracked_ms);for slice in &entry.slices{check()?;total=total.saturating_add(slice.running_ms);period=period.saturating_add(slice.intersection_ms(from,to));earliest=Some(earliest.map_or(slice.from,|old:u64|old.min(slice.from)));}}
        let mut legacy=0;let mut legacy_timed=0;let mut legacy_ms=0u64;let mut period_legacy=0;let mut unknown=0;let mut period_unknown=0;
        for session in sessions{check()?;if ledger.is_some_and(|entries|entries.contains_key(&session.stable_id())){continue}legacy+=1;let within=session.recorded_at_unix_ms>=from&&session.recorded_at_unix_ms<to;if within{period_legacy+=1}if let Some(ms)=session.playing_ms{legacy_timed+=1;legacy_ms=legacy_ms.saturating_add(ms)}else{unknown+=1;if within{period_unknown+=1}}}
        Ok(json!({"totalMs":total,"periodMs":period,"timedSessions":ledger.map_or(0,|entries|entries.len()),"unknownSessions":unknown,"periodUnknownSessions":period_unknown,"retainedSessions":sessions.len(),"legacySessions":legacy,"legacyTimedSessions":legacy_timed,"legacyTimedMs":legacy_ms,"periodLegacySessions":period_legacy,"untrackedMs":untracked,"earliestIntervalAt":earliest,"coverage":"saved-running-ledger","from":from,"to":to}))
    }
    pub(super) fn practice_calendar(&self,from:u64,to:u64,content_id:Option<&str>)->Result<Value,String>{self.practice_calendar_checked(from,to,content_id,||Ok(()))}
    pub(super) fn practice_calendar_checked(
        &self, from: u64, to: u64, content_id: Option<&str>,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        let calendar = crate::history_calendar::read(&self.history, from, to, content_id, check)?;
        serde_json::to_value(calendar).map_err(|error| format!("练习日历整理失败：{error}"))
    }

    pub(super) fn history_context(&self) -> PracticeSessionContext {
        let summary = if self.ladder.as_ref().is_some_and(|run| run.active) {
            self.matcher.summary()
        } else { AttemptSummary { overall: self.matcher.snapshot(), ..Default::default() } };
        self.history_context_with_summary(&summary, self.matcher.results())
    }
    pub(super) fn history_context_with_summary(&self, summary: &AttemptSummary,
        results: &[panthesia_core::practice::PracticeResult]) -> PracticeSessionContext {
        let target_notes=self.practice_target_count();
        let expression_failure=self.ladder.as_ref().filter(|run|run.active).and_then(|_|self.expression_failure_for(summary.expression,results,target_notes));
        PracticeSessionContext {
            loop_restart:(self.state.loop_abort_limit>0).then_some(self.state.loop_abort_limit),
            expression:self.active_expression_goal.as_ref().map(|e|panthesia_core::practice_history::PracticeExpressionCondition{velocity_difference:e.velocity_difference,note_velocity_difference:e.note_velocity_difference,note_pedal_mismatch_count:e.note_pedal_mismatch_count,contour_percent:e.contour_percent,pedal_offset_ms:e.pedal_offset_ms}),
            routine: self.routine.as_ref().map(|a| {
                panthesia_core::practice_history::PracticeRoutineCondition {
                    expression:a.item.goal.expression.as_ref().map(|e|panthesia_core::practice_history::PracticeExpressionCondition{velocity_difference:e.velocity_difference,note_velocity_difference:e.note_velocity_difference,note_pedal_mismatch_count:e.note_pedal_mismatch_count,contour_percent:e.contour_percent,pedal_offset_ms:e.pedal_offset_ms}),
                    item_notes: a.item.notes.clone(),
                    consecutive: a.item.goal.consecutive,
                    routine_id: a.routine_id.clone(),
                    routine_name: self
                        .preferences
                        .routine_runs
                        .get(&format!("{}:{}", a.routine_id, a.day))
                        .map_or_else(|| a.routine_id.clone(), |r| r.routine.name.clone()),
                    day: a.day.clone(),
                    item_id: a.item.id.clone(),
                    item_title: a.item.title.clone(),
                    passes_required: a.item.goal.passes,
                    accuracy_percent: a.item.goal.accuracy,
                    on_time_percent: a.item.goal.on_time,
                }
            }),
            ladder: self.ladder.as_ref().filter(|r| r.active).map(|r| {
                panthesia_core::practice_history::PracticeLadderCondition {
                    plan_id: r.preset.id.clone(),
                    plan_name: r.preset.name.clone(),
                    stage: r.progress.stage + 1,
                    speed_percent: r.progress.speed(&r.preset.plan),
                    target_percent: r.preset.plan.target_percent,
                    accuracy_percent:Some(r.preset.plan.accuracy_percent),
                    on_time_percent:r.preset.plan.on_time_percent,
                    passes_required:Some(r.preset.plan.passes_required),
                    round_passed:Some(panthesia_core::speed_ladder::SpeedLadderProgress::round_passes(&r.preset.plan,summary,target_notes,expression_failure.as_deref())),
                }
            }),
            target_notes,
            judged_notes: summary.overall.matched_notes + summary.overall.missed_notes,
            note_playback: self.config.note_playback_rules(),
            tracks: self.config.practice_track_setup(),
            parts: self
                .config
                .tracks
                .iter()
                .map(|t| (t.track_id, t.practice_part))
                .collect(),
            hands: self.state.hands.clone(),
            count_in: self.state.count_in,
            metronome: self.state.metronome,
            latency: self.state.latency,
            pedal_latency_ms:Some(self.state.latency),
            rounds: self.state.rounds,
            adaptive: self.state.adaptive,
            grid: self.grid_signature(),
            passage_bounds: self.state.passage.as_ref().and_then(|passage| {
                let file = self.file.as_ref()?;
                let start_tick = file.tempo_track.seconds_to_pulses(passage.start).round() as u64;
                let end_tick = file.tempo_track.seconds_to_pulses(passage.end).round() as u64;
                (start_tick < end_tick).then_some(PracticePassageBounds { start_tick, end_tick })
            }),
            source_path: self.file.as_ref().and_then(|f| f.source_path.clone()),
            exercise_spec: self.exercise,
        }
    }
    pub(super) fn history_query(&self,query:&str,mode:&str,hands:&str,range:&str,days:u32,offset:usize,limit:usize)->Result<Value,String>{self.history_query_window(query,mode,hands,range,days,offset,limit,None,None)}
    pub(super) fn history_query_window(
        &self,
        query: &str,
        mode: &str,
        hands: &str,
        range: &str,
        days: u32,
        offset: usize,
        limit: usize,
        from:Option<u64>,
        to:Option<u64>,
    ) -> Result<Value, String> {
        self.history_query_window_checked(query,mode,hands,range,days,offset,limit,from,to,||Ok(()))
    }
    pub(super) fn history_query_window_checked(
        &self,
        query: &str,
        mode: &str,
        hands: &str,
        range: &str,
        days: u32,
        offset: usize,
        limit: usize,
        from:Option<u64>,
        to:Option<u64>,
        check: impl Fn()->Result<(),String>,
    ) -> Result<Value, String> {
        self.read_history_page_checked(&crate::history_reader::HistoryPageRequest {
            content_id: None, query: query.into(), mode: mode.into(), hands: hands.into(),
            range: range.into(), days, offset, limit, from, to,
        }, check)
    }
    pub(super) fn read_history_page_checked(
        &self,
        request: &crate::history_reader::HistoryPageRequest,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        check()?;
        let crate::history_reader::HistoryPageRequest {
            content_id, query, mode, hands, range, days, offset, limit, from, to,
        } = request;
        let (days, offset, limit, from, to) = (*days, *offset, *limit, *from, *to);
        if content_id.as_ref().is_some_and(|id| id.trim().is_empty() || id.len() > 160) {
            return Err("曲目内容标识无效，请重新选择曲目".into());
        }
        let window=match(from,to){(None,None)=>None,(Some(a),Some(b))if a<b&&b<=9_000_000_000_000_000&&b-a<=366*86_400_000=>Some((a,b)),_=>return Err("历史日期范围需完整填写，且不超过 366 天".into())};
        let query = query.trim().to_lowercase();
        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let cutoff = cutoff.saturating_sub(u64::from(days) * 86_400_000);
        // Sort borrowed records, then build only the visible page. This avoids calculating
        // recommendations and serializing every retained attempt for a fifty-row list.
        let candidates: Box<dyn Iterator<Item = (&str, &panthesia_core::practice_history::SongPracticeHistory)> + '_> =
            if let Some(id) = content_id.as_deref() {
                Box::new(self.history.song(id).map(|song| (id, song)).into_iter())
            } else {
                Box::new(self.history.iter_songs())
            };
        let mut songs = candidates.filter(|(_, song)| !song.sessions.is_empty())
            .map(|(cid, song)| {
                let last = song.setup.as_ref().map_or(0, |setup| setup.last_used_unix_ms)
                    .max(song.sessions.last().map_or(0, |session| session.recorded_at_unix_ms));
                (cid, song, last)
            }).collect::<Vec<_>>();
        songs.sort_by(|left, right| right.2.cmp(&left.2)
            .then_with(|| left.1.display_name.cmp(&right.1.display_name)).then_with(|| left.0.cmp(right.0)));
        let mut rows = Vec::new();
        for (cid, history, _) in songs {
            check()?;
            let path = history.library.source_path.as_ref().or_else(|| history.setup.as_ref().and_then(|setup| setup.source_path.as_ref()));
            let song_matches = query.is_empty() || history.display_name.to_lowercase().contains(&query)
                || path.is_some_and(|path| path.to_string_lossy().to_lowercase().contains(&query));
            for session in &history.sessions {
                check()?;
                if window.is_some_and(|(a,b)| session.recorded_at_unix_ms < a || session.recorded_at_unix_ms >= b) { continue; }
                if !song_matches && !session.annotation.as_ref().is_some_and(|annotation|
                    [&annotation.note,&annotation.teacher,&annotation.next].iter().any(|text| text.to_lowercase().contains(&query))) { continue; }
                if !mode.is_empty() && session.mode.as_deref() != Some(mode.as_str()) { continue; }
                if !hands.is_empty() && session.hands.label() != hands.as_str() { continue; }
                if days > 0 && session.recorded_at_unix_ms < cutoff { continue; }
                let is_loop = matches!(session.kind, PracticeSessionKind::Loop { .. });
                if (range == "loop" && !is_loop) || (range == "whole" && is_loop) { continue; }
                rows.push((cid, history, session, path));
            }
        }
        rows.sort_by_key(|(_, _, session, _)| std::cmp::Reverse(session.recorded_at_unix_ms));
        let total = rows.len();
        let rows = rows.into_iter().skip(offset).take(if limit == 0 {50} else {limit.min(200)})
            .map(|(cid, history, session, path)| crate::history_list::HistoryListEntry::new(cid, &history.display_name, path, session)).collect::<Vec<_>>();
        check()?;
        serde_json::to_value(crate::history_list::HistoryPage { entries: rows, total, offset, content_id: content_id.clone() })
            .map_err(|error| format!("历史列表整理失败：{error}"))
    }
    pub(super) fn annotate_history(&mut self, content_id:&str,id:&str,note:String,teacher:String,next:String,expected:Option<panthesia_core::practice_history::PracticeAnnotation>)->Result<Value,String>{
        let annotation=panthesia_core::practice_history::PracticeAnnotation{note,teacher,next,updated_at_unix_ms:std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64};
        self.history.annotate_session(content_id,id,expected,annotation)?;
        self.history_detail(content_id,id)
    }
    pub(super) fn history_detail(&self, content_id: &str, id: &str) -> Result<Value, String> {self.history_detail_checked(content_id,id,||Ok(()))}
    pub(super) fn history_detail_checked(&self,content_id:&str,id:&str,check:impl Fn()->Result<(),String>)->Result<Value,String>{
        check()?;
        let history = self.history.song(content_id).ok_or("曲目记录不存在")?;
        let index = history
            .sessions
            .iter()
            .position(|s| session_id(s) == id)
            .ok_or("这条记录已不在历史中")?;
        let session = &history.sessions[index];
        let legacy_approvals=crate::legacy_exercise_history::active_approvals(&self.data,content_id);
        check()?;
        let peers = history.sessions[..index]
            .iter()
            .filter(|s| crate::legacy_exercise_history::same_reviewed(&legacy_approvals,session,s))
            .collect::<Vec<_>>();
        let best = peers
            .iter()
            .filter_map(|s| s.summary.overall.accuracy())
            .max_by(f32::total_cmp);
        let excluded_recent = history.sessions[..index]
            .iter()
            .rev()
            .filter(|older| !crate::legacy_exercise_history::same_reviewed(&legacy_approvals,session,older))
            .take(12)
            .map(|older| json!({
                "entry": entry(content_id, &history.display_name, None, older),
                "reasons": practice_conditions::attempt_difference_reasons(session, older),
            }))
            .collect::<Vec<_>>();
        let mut row = entry(
            content_id,
            &history.display_name,
            history.library.source_path.as_ref(),
            session,
        );
        row["performanceAvailable"]=json!(crate::performance_archive::available(&self.data,content_id,id));
        row["summary"] = json!(session.summary);
        if let Some(e)=session.context.as_ref().and_then(|c|c.expression.as_ref().or_else(||c.routine.as_ref().and_then(|r|r.expression.as_ref()))){
            let g=crate::expression_goal::ExpressionGoal{velocity_difference:e.velocity_difference,note_velocity_difference:e.note_velocity_difference,note_pedal_mismatch_count:e.note_pedal_mismatch_count,contour_percent:e.contour_percent,pedal_offset_ms:e.pedal_offset_ms};
            let archive=if g.note_velocity_difference.is_some()||g.note_pedal_mismatch_count.is_some(){crate::performance_archive::read(&self.data,content_id,id).ok()}else{None};
            let target=session.context.as_ref().map_or(0,|context|context.target_notes);
            let note_velocity=g.note_velocity_difference.and_then(|_|archive.as_ref().and_then(|a|a.note_velocity_evidence(target)));
            let note_pedal=g.note_pedal_mismatch_count.and_then(|_|archive.as_ref().and_then(|a|a.note_pedal_evidence(target)));
            row["expressionGoalResult"]=json!(g.result_with_note_evidence(session.summary.expression,note_velocity,note_pedal));
        }
        check()?;
        row["context"] = json!(session.context);
        let mut conditions=condition_summary(session);
        if let Some(context) = session.context.as_ref() {
            if let Some(bounds) = context.passage_bounds {
                let current = self.file.as_deref().filter(|file| file.content_id == content_id
                    && practice_conditions::grid(file) == context.grid);
                let source = if current.is_none() {
                    let paths = [context.source_path.clone(), history.library.source_path.clone()];
                    crate::library::verified_file(&self.data, content_id, paths.into_iter().flatten())
                        .ok().filter(|file| practice_conditions::grid(file) == context.grid)
                } else { None };
                if let Some(file) = current.or(source.as_ref()) {
                    conditions["passageLocation"] = json!(passage_location(file, bounds));
                }
            }
        }
        let (reason_code,reason)=if !peers.is_empty(){(None,None)}
            else if !conditions["complete"].as_bool().unwrap_or(false){
                (Some("incomplete-conditions"),Some("这条记录缺少完整的演奏条件或有效音符判断，无法证明与旧记录同条件。"))
            }else if index==0{
                (Some("first-attempt"),Some("这是该曲保留的第一条记录，暂无更早的练习可比较。"))
            }else{
                (Some("different-conditions"),Some("更早的记录在范围、模式、速度、音符覆盖、分手、设备校准或其他练习条件上不同。"))
            };
        row["comparison"] = json!({"count":peers.len(),"bestAccuracy":best,
            "reviewedLegacyCount":peers.iter().filter(|s|!practice_conditions::same_attempt_conditions(session,s)).count(),
            "conditions":conditions,"reasonCode":reason_code,"reason":reason,
            "excludedRecent":excluded_recent,
            "previous":peers.last().map(|s|entry(content_id,&history.display_name,None,s)),
            "recent":peers.iter().rev().take(29).rev().map(|s|entry(content_id,&history.display_name,None,s)).collect::<Vec<_>>()});
        Ok(row)
    }
    pub(super) fn history_open(
        &mut self,
        content_id: &str,
        id: &str,
        restore: bool,
    ) -> Result<Value, String> {
        let context = self.prepare_history_open(content_id, id, restore)?;
        if let Some(spec) = context.exercise {
            self.command(Command::Generate { spec })?;
        } else {
            let file = crate::library::verified_file(&self.data, content_id, context.paths.clone())?;
            self.install(file, context.title.clone(), None)?;
        }
        self.apply_history_open(&context)
    }
    pub(crate) fn apply_history_open(&mut self, context: &crate::history_loading::Context) -> Result<Value, String> {
        let content_id = context.content_id.as_str();
        let restore = context.restore;
        let session = &context.session;
        let mut warning = None;
        if restore {
            let context = session.context.as_ref().unwrap();
            let mut variant=crate::practice_variant::Variant::from_grid(&context.grid)?;
            let current=self.variant();variant.tonic=current.tonic;variant.minor=current.minor;
            if current!=variant {self.apply_variant_memory(&variant)?;}
            let previous_config = self.config.clone();
            let previous_hands = self.state.hands.clone();
            self.config.apply_practice_setup(&SongPracticeSetup {
                tracks: context.tracks.clone(),
                ..Default::default()
            });
            for track in &mut self.config.tracks {
                if let Some(part) = context.parts.get(&track.track_id) {
                    track.practice_part = *part;
                }
            }
            if let Some(file) = &self.file {
                self.config.set_note_playback_rules(&context.note_playback, file)?;
            }
            self.state.hands = context.hands.clone();
            if self.grid_signature() != context.grid
                || session.scope.as_deref() != Some(self.practice_scope().as_str())
            {
                self.config = previous_config;
                self.state.hands = previous_hands;
                warning=Some("曲目已打开，但小节或逐音左右手标注已改变，未恢复旧条件。请重新确认声部和选段。".to_string());
            } else {
                self.state.mode = session.mode.clone().unwrap_or_else(|| "wait".into());
                self.state.wait = self.state.mode == "wait";
                self.state.speed = f64::from(session.speed);
                self.state.count_in = context.count_in;
                self.state.metronome = context.metronome;
                self.state.latency = context.latency;
                self.state.rounds = context.rounds;
                self.state.adaptive = context.adaptive;
                self.state.status = "ready".into();
                self.state.passage = None;
                if let PracticeSessionKind::Loop {
                    start_measure,
                    end_measure,
                } = session.kind
                {
                    if let Some(bounds) = context.passage_bounds {
                        let range = crate::tick_ranges::TickRange {
                            description: "历史练习原范围".into(),
                            content_id: content_id.into(), grid: context.grid.clone(),
                            start_tick: bounds.start_tick, end_tick: bounds.end_tick,
                        };
                        self.apply_tick_range(&range)?;
                    } else {
                        self.command(Command::MeasureLoop {
                            start: start_measure,
                            end: end_measure,
                            enabled: true,
                        })?;
                        warning = Some("旧记录只保存了起止小节，原来的拍内起止位置无法确认；已按整小节恢复，请先核对范围。".into());
                    }
                } else {
                    self.reset(0.);
                }
            }
        }
        self.panic();
        self.state.status = "ready".into();
        self.persist()?;
        let mut result = self.command(Command::CurrentSong)?;
        result["restoreWarning"] = json!(warning);
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use panthesia_core::practice_history::PracticeSessionContext;
    use std::collections::BTreeMap;

    #[test]
    fn comparison_conditions_expose_the_exact_saved_task_and_legacy_pedal_basis() {
        let mut parts = BTreeMap::new();
        parts.insert(2, PracticePart::RightHand);
        let session = PracticeSession {
            replay_clips: vec![], playing_ms: None, annotation: None, id: None,
            context: Some(PracticeSessionContext {
                loop_restart:None,
                note_playback: vec![],
                expression: None,
                routine: None, ladder: None, target_notes: 18, judged_notes: 17,
                tracks: vec![], parts, hands: "right".into(), count_in: 2,
                metronome: true, latency: 24, pedal_latency_ms: None,
                rounds: 3, adaptive: true, grid: "grid-1".into(), passage_bounds: None,
                source_path: None, exercise_spec: None,
            }),
            recorded_at_unix_ms: 1,
            kind: PracticeSessionKind::Loop { start_measure: 5, end_measure: 7 },
            hands: PracticeHands::Right, speed: 0.75,
            mode: Some("flow".into()), scope: Some("scope-1".into()),
            effective_tempo_bpm: Some(90), summary: AttemptSummary::default(),
        };
        let summary=condition_summary(&session);
        assert_eq!(summary["range"],json!([5,7]));
        assert_eq!(summary["targetNotes"],18);
        assert_eq!(summary["judgedNotes"],17);
        assert_eq!(summary["pedalLatencyMs"],24);
        assert_eq!(summary["pedalLatencySource"],"legacyInputLatency");
        assert_eq!(summary["parts"]["2"],"RightHand");
        assert_eq!(summary["adaptive"],true);
        assert_eq!(summary["effectiveTempoBpm"],90);
        assert_eq!(summary["complete"],true);
        assert_eq!(entry("content", "曲目", None, &session)["exactPassage"], false);
        let mut exact = session.clone();
        exact.context.as_mut().unwrap().passage_bounds = Some(PracticePassageBounds {
            start_tick: 120, end_tick: 360,
        });
        assert_eq!(entry("content", "曲目", None, &exact)["exactPassage"], true);
    }

    #[test]
    fn history_restore_reopens_saved_beat_boundaries() {
        let data = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/history-exact-range-unit")
            .join(format!("{}", std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut player = Player::new(data, PathBuf::new(), true);
        player.command(Command::Generate { spec: ExerciseSpec::default() }).unwrap();
        let content_id = player.file.as_ref().unwrap().content_id.clone();
        let duration = player.state.duration;
        let start = duration * 0.25;
        let end = duration * 0.75;
        player.command(Command::Loop { start, end, enabled: true }).unwrap();
        let context = player.history_context();
        assert!(context.passage_bounds.is_some());
        let mut session = PracticeSession::new(
            PracticeSessionKind::Loop { start_measure: 1, end_measure: 1 },
            PracticeHands::Both, 1., AttemptSummary::default(),
        ).with_context(context).with_scope(player.practice_scope()).with_mode("wait");
        session.recorded_at_unix_ms = 1;
        let id = session.stable_id();
        player.history.record_session(&content_id, &player.title.clone(), session).unwrap();
        player.command(Command::Loop { start: 0., end: 0., enabled: false }).unwrap();
        let opened = player.history_open(&content_id, &id, true).unwrap();
        assert!(opened["restoreWarning"].is_null());
        let restored = player.state.passage.as_ref().unwrap();
        let tolerance = player.file.as_ref().unwrap().tempo_track.pulses_to_duration(1).as_secs_f64();
        assert!((restored.start - start).abs() <= tolerance);
        assert!((restored.end - end).abs() <= tolerance);
    }

    #[test]
    fn passage_location_names_fractional_beats_and_next_measure_boundary() {
        let data = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/history-beat-label-unit")
            .join(format!("{}", std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut player = Player::new(data, PathBuf::new(), true);
        player.command(Command::Generate { spec: ExerciseSpec::default() }).unwrap();
        let file = player.file.as_ref().unwrap();
        let first = &file.musical_time.measures[0];
        let ppq = u64::from(file.musical_time.ppq);
        assert_eq!(ppq % 2, 0);
        assert_eq!(passage_beat_label(file, first.start_tick + ppq / 2).as_deref(),
            Some("第 1 小节第 1 拍后 1/2 拍"));
        if file.musical_time.measures.len() > 1 {
            assert_eq!(passage_beat_label(file, file.musical_time.measures[1].start_tick).as_deref(),
                Some("第 2 小节第 1 拍"));
        }
    }
}
