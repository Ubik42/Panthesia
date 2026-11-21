//! Practice-time totals, collection flags and passage location labels.
use super::*;
use serde_json::{Value, json};


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
}

#[cfg(test)]
mod tests {
    

}