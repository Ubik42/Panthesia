//! Instrument previews own their MIDI schedule and never enter human input or scoring.
use crate::*;
use serde_json::{Value, json};

#[derive(Clone, Copy)]
struct Event {
    at: f64,
    bytes: [u8; 3],
    len: usize,
}
pub(crate) struct Playback {
    id: String,
    events: Arc<[Event]>,
    cursor: usize,
    position: f64,
    duration: f64,
    lease: Duration,
    repeating: bool,
}
fn valid_id(id: &str) -> bool {
    id.starts_with("song-audition-")
        && id.len() > 14
        && id.len() <= 96
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
impl Player {
    fn validate_song_audition(&self) -> Result<(), String> {
        if self.recorder.is_recording() {
            return Err("请先停止录音，再试听曲目".into());
        }
        if matches!(self.state.status.as_str(), "playing" | "countIn") {
            return Err("请先暂停当前演奏，再试听曲目".into());
        }
        if !self.state.pressed.is_empty() || self.state.pedal > 0 {
            return Err("请先松开琴键和踏板，再试听曲目".into());
        }
        if self.storage_busy.load(Ordering::Acquire)
            || self.closing.load(Ordering::Acquire)
            || self.sound_change.is_some()
        {
            return Err("正在准备练习或音源，请稍候再试听".into());
        }
        Ok(())
    }
    /// Bounded in-memory instrument phrase. It never enters input, recording or assessment.
    pub(crate) fn start_instrument_preview(&mut self, id:&str, content_id:&str, track:usize, program:Option<u8>) -> Result<Value,String> {
        if !valid_id(id) || self.cancelled_song_auditions.iter().any(|v|v==id) { return Err("乐器预听已取消".into()); }
        self.validate_song_audition()?;
        if self.file.as_ref().is_none_or(|f|f.content_id != content_id) { return Err("曲目已变化，请重新选择乐器".into()); }
        let file=self.file.as_ref().ok_or("请先选择曲目")?;
        let source=file.tracks.iter().find(|t|t.track_id==track).ok_or("找不到声部")?;
        if source.has_drums && !source.has_other_than_drums { return Err("打击乐声部暂不提供旋律预听".into()); }
        let program=program.unwrap_or_else(|| source.notes.first().and_then(|n|file.program_track.program_for_timestamp(&n.start).get(&n.channel).copied()).unwrap_or(0));
        if program>127 { return Err("乐器编号超出范围".into()); }
        self.stop_song_audition(None);
        self.ensure_audio()?;
        let mut events=Vec::with_capacity(20);
        for (bytes,len) in [([176,121,0],3),([176,64,0],3),([176,0,0],3),([176,32,0],3),([192,program,0],2),([176,7,100],3),([176,10,64],3),([224,0,64],3)] {events.push(Event{at:0.,bytes,len});}
        for (i,pitch) in [60,64,67,72].into_iter().enumerate() {
            let at=i as f64*0.4;
            events.push(Event{at,bytes:[144,pitch,80],len:3});
            events.push(Event{at:at+0.3,bytes:[128,pitch,0],len:3});
        }
        events.sort_by(|a,b|a.at.total_cmp(&b.at));
        self.song_audition=Some(Playback{id:id.into(),events:events.into(),cursor:0,position:0.,duration:2.,lease:Duration::ZERO,repeating:true});
        self.tick_song_audition(Duration::ZERO);
        Ok(self.song_audition_state(Some(id)))
    }
    pub(crate) fn stop_song_audition(&mut self, id: Option<&str>) {
        if let Some(id) = id.filter(|id| valid_id(id)) {
            if !self.cancelled_song_auditions.iter().any(|v| v == id) {
                self.cancelled_song_auditions.push_back(id.into());
                while self.cancelled_song_auditions.len() > 64 {
                    self.cancelled_song_auditions.pop_front();
                }
            }
        }
        let active = self
            .song_audition
            .as_ref()
            .is_some_and(|p| id.is_none_or(|id| p.id == id));
        let pending = self
            .song_audition_pending
            .as_deref()
            .is_some_and(|p| id.is_none_or(|id| p == id));
        if active || pending {
            self.panic();
        }
    }
    pub(crate) fn song_audition_state(&mut self, id: Option<&str>) -> Value {
        if let Some(p) = self
            .song_audition
            .as_mut()
            .filter(|p| id.is_none_or(|id| p.id == id))
        {
            p.lease = Duration::ZERO;
            return json!({"id":p.id,"phase":"playing","position":p.position,"duration":p.duration});
        }
        if let Some(p) = self
            .song_audition_pending
            .as_ref()
            .filter(|p| id.is_none_or(|id| p.as_str() == id))
        {
            return json!({"id":p,"phase":"preparing","position":0.,"duration":0.});
        }
        json!({"id":null,"phase":"idle","position":0.,"duration":0.})
    }
    pub(crate) fn tick_song_audition(&mut self, delta: Duration) {
        let Some(mut p) = self.song_audition.take() else {
            return;
        };
        p.lease += delta;
        if p.lease > Duration::from_secs(3) || self.storage_busy.load(Ordering::Acquire) {
            self.retire(p);
            self.panic();
            self.restore_track_sound();
            return;
        }
        p.position = (p.position + delta.as_secs_f64()).min(p.duration);
        // Bound a delayed driver's catch-up work; stale attacks are discarded on overrun.
        let end = p.events.partition_point(|e| e.at <= p.position);
        if end.saturating_sub(p.cursor) > 2048 {
            self.retire(p);
            self.panic();
            self.restore_track_sound();
            return;
        }
        for event in &p.events[p.cursor..end] {
            self.send(&event.bytes[..event.len]);
        }
        p.cursor = end;
        if p.position >= p.duration && p.repeating {
            p.position = 0.;
            p.cursor = 0;
            self.song_audition = Some(p);
        } else if p.position >= p.duration {
            self.retire(p);
            self.panic();
            self.restore_track_sound();
        } else {
            self.song_audition = Some(p);
        }
    }
}
