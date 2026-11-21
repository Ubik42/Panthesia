//! Library auditions own their MIDI schedule and never enter human input or scoring.
use crate::*;
use serde_json::{Value, json};

const EVENT_LIMIT: usize = 16_384;
pub(crate) struct Origin {
    id: String,
    epoch: u64,
    midi_events: u64,
    revision: u64,
}
#[derive(Clone, Copy)]
struct Event {
    at: f64,
    bytes: [u8; 3],
    len: usize,
}
pub(crate) struct Prepared {
    events: Arc<[Event]>,
    duration: f64,
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
impl Prepared {
    pub(crate) fn read(
        path: &PathBuf,
        token: &background_tasks::TaskToken,
    ) -> Result<Self, String> {
        token.check()?;
        if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 32_000_000 {
            return Err("MIDI 超过试听大小限制".into());
        }
        let file = panthesia_music::MidiFile::new(path)?;
        token.check()?;
        let first = file
            .tracks
            .iter()
            .flat_map(|t| t.notes.iter())
            .map(|n| n.start)
            .min()
            .ok_or("这首曲目没有可试听的音符")?
            .as_secs_f64();
        let duration = (file.duration.as_secs_f64() - first).clamp(0.01, 8.);
        let mut source: Vec<_> = file
            .tracks
            .iter()
            .flat_map(|t| t.events.iter())
            .filter(|e| e.timestamp.as_secs_f64() < first + duration)
            .collect();
        source.sort_by_key(|e| (e.timestamp,e.order));
        let mut initial = Vec::new();
        let mut events = Vec::new();
        // Establish the audition's default channel state, independent of the loaded song.
        for channel in 0..16 {
            for (bytes, len) in [
                ([176 | channel, 121, 0], 3),
                ([176 | channel, 64, 0], 3),
                ([176 | channel, 0, 0], 3),
                ([176 | channel, 32, 0], 3),
                ([192 | channel, 0, 0], 2),
                ([176 | channel, 7, 100], 3),
                ([176 | channel, 10, 64], 3),
                ([224 | channel, 0, 64], 3),
            ] {
                events.push(Event { at: 0., bytes, len });
            }
        }
        let mut scheduled = Vec::new();
        for (i, event) in source.into_iter().enumerate() {
            if i % 256 == 0 {
                token.check()?;
            }
            use panthesia_music::midly::MidiMessage as M;
            let ch = event.channel;
            let (bytes, len) = match event.message {
                M::NoteOn { key, vel } => ([144 | ch, key.as_int(), vel.as_int()], 3),
                M::NoteOff { key, vel } => ([128 | ch, key.as_int(), vel.as_int()], 3),
                M::Aftertouch { key, vel } => ([160 | ch, key.as_int(), vel.as_int()], 3),
                M::Controller { controller, value } => {
                    ([176 | ch, controller.as_int(), value.as_int()], 3)
                }
                M::ProgramChange { program } => ([192 | ch, program.as_int(), 0], 2),
                M::ChannelAftertouch { vel } => ([208 | ch, vel.as_int(), 0], 2),
                M::PitchBend { bend } => (
                    [
                        224 | ch,
                        (bend.0.as_int() & 127) as u8,
                        (bend.0.as_int() >> 7) as u8,
                    ],
                    3,
                ),
            };
            let at = event.timestamp.as_secs_f64() - first;
            if at < 0. {
                if !matches!(bytes[0] & 240, 128 | 144 | 160) {
                    initial.push((bytes, len));
                    if initial.len() > 1024 {
                        return Err("曲目前奏的 MIDI 控制信息过密，请直接打开曲目演奏".into());
                    }
                }
            } else {
                scheduled.push(Event { at, bytes, len });
                if scheduled.len() > EVENT_LIMIT {
                    return Err("试听片段的 MIDI 事件过密，请直接打开曲目演奏".into());
                }
            }
        }
        events.extend(
            initial
                .into_iter()
                .map(|(bytes, len)| Event { at: 0., bytes, len }),
        );
        events.extend(scheduled);
        Ok(Self {
            events: events.into(),
            duration,
        })
    }
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
    pub(crate) fn begin_song_audition(&mut self, id: String) -> Result<Origin, String> {
        if !valid_id(&id) {
            return Err("试听请求标识无效".into());
        }
        if self.cancelled_song_auditions.contains(&id) {
            return Err("这次试听已取消".into());
        }
        self.validate_song_audition()?;
        // A previous demo also owns the sound; release it before preparing this audition.
        self.panic();
        self.song_audition_pending = Some(id.clone());
        Ok(Origin {
            id,
            epoch: self.audio_stop_epoch,
            midi_events: self.state.midi_events,
            revision: self.score_revision,
        })
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
    pub(crate) fn install_song_audition(
        &mut self,
        origin: Origin,
        prepared: Prepared,
        token: &background_tasks::TaskToken,
    ) -> Result<Value, String> {
        let ready = (|| {
            self.validate_song_audition()?;
            if self.song_audition_pending.as_ref() != Some(&origin.id)
                || self.audio_stop_epoch != origin.epoch
                || self.state.midi_events != origin.midi_events
                || self.score_revision != origin.revision
            {
                return Err("试听准备期间曲目或演奏状态已变化，请重新试听".into());
            }
            token.begin_commit()?;
            self.ensure_audio()
        })();
        if let Err(error) = ready {
            self.retire(prepared);
            return Err(error);
        }
        self.song_audition_pending = None;
        self.song_audition = Some(Playback {
            id: origin.id,
            events: prepared.events,
            cursor: 0,
            position: 0.,
            duration: prepared.duration,
            lease: Duration::ZERO,
            repeating: false,
        });
        self.tick_song_audition(Duration::ZERO);
        if self.song_audition.is_none() {
            return Err("试听片段的 MIDI 事件过密，已停止发声，请直接打开曲目演奏".into());
        }
        Ok(self.song_audition_state(None))
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
struct Guard {
    engine: Engine,
    id: String,
    done: bool,
}
impl Drop for Guard {
    fn drop(&mut self) {
        if !self.done {
            let _ = self
                .engine
                .control_tx
                .send(runtime_request::Request::SongAuditionAbort(self.id.clone()));
        }
    }
}
impl Engine {
    pub(crate) fn start_song_audition(&self, path: PathBuf, id: String) -> Result<Value, String> {
        let engine = self.clone();
        let guard = Guard {
            engine: engine.clone(),
            id: id.clone(),
            done: false,
        };
        self.tasks.run("准备选曲试听", None, move |token| {
            let mut guard = guard;
            token.check()?;
            let (reply, rx) = mpsc::sync_channel(1);
            engine
                .control_tx
                .send(runtime_request::Request::SongAuditionBegin { id, reply })
                .map_err(|_| "音乐引擎已关闭")?;
            let origin = rx.recv().map_err(|_| "试听准备通道已关闭")??;
            let prepared = Prepared::read(&path, &token)?;
            let (reply, rx) = mpsc::sync_channel(1);
            engine
                .control_tx
                .send(runtime_request::Request::SongAuditionCommit {
                    origin,
                    prepared,
                    token,
                    reply,
                })
                .map_err(|_| "音乐引擎已关闭")?;
            let result = rx.recv().map_err(|_| "试听响应通道已关闭")?;
            guard.done = result.is_ok();
            result
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use panthesia_music::midly::{
        Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind,
    };
    fn fixture(player: &Player) -> PathBuf {
        let event = |delta: u32, message| TrackEvent {
            delta: delta.into(),
            kind: TrackEventKind::Midi {
                channel: 3.into(),
                message,
            },
        };
        let smf = Smf {
            header: Header::new(Format::SingleTrack, Timing::Metrical(480.into())),
            tracks: vec![vec![
                event(0, MidiMessage::ProgramChange { program: 5.into() }),
                event(
                    0,
                    MidiMessage::Controller {
                        controller: 64.into(),
                        value: 127.into(),
                    },
                ),
                event(
                    0,
                    MidiMessage::NoteOn {
                        key: 60.into(),
                        vel: 37.into(),
                    },
                ),
                event(
                    480,
                    MidiMessage::NoteOff {
                        key: 60.into(),
                        vel: 20.into(),
                    },
                ),
                event(
                    0,
                    MidiMessage::Controller {
                        controller: 64.into(),
                        value: 0.into(),
                    },
                ),
                event(
                    0,
                    MidiMessage::NoteOn {
                        key: 60.into(),
                        vel: 100.into(),
                    },
                ),
                event(
                    9600,
                    MidiMessage::NoteOff {
                        key: 60.into(),
                        vel: 0.into(),
                    },
                ),
                TrackEvent {
                    delta: 0.into(),
                    kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
                },
            ]],
        };
        let mut bytes = Vec::new();
        smf.write_std(&mut bytes).unwrap();
        let path = player.data.join("audition-fixture.mid");
        std::fs::write(&path, bytes).unwrap();
        path
    }
    #[test]
    fn instrument_preview_loops_without_practice_input_and_expires_without_owner() {
        let (mut player,_,_)=crate::history_loading::tests::seeded(true,false);
        let file=player.file.as_ref().unwrap();
        let cid=file.content_id.clone();
        let track=file.tracks.iter().find(|t|!t.notes.is_empty()).unwrap().track_id;
        let history=player.history.snapshot_bytes().unwrap();
        let score=player.matcher.snapshot();
        let input=player.state.midi_events;
        let position=player.state.position;
        let id="song-audition-instrument-owned";
        assert!(player.start_instrument_preview(id,"stale",track,Some(0)).is_err());
        player.start_instrument_preview(id,&cid,track,Some(0)).unwrap();
        for _ in 0..12 {player.tick_song_audition(Duration::from_millis(500));player.song_audition_state(Some(id));}
        assert!(player.song_audition.as_ref().unwrap().repeating);
        assert_eq!(player.state.position,position);
        assert_eq!(player.state.midi_events,input);
        assert_eq!(player.matcher.snapshot(),score);
        assert_eq!(player.history.snapshot_bytes().unwrap(),history);
        assert!(player.state.pressed.is_empty());
        assert!(!player.recorder.is_recording());
        player.tick_song_audition(Duration::from_secs(4));
        assert!(player.song_audition.is_none());
        player.start_instrument_preview(id,&cid,track,Some(0)).unwrap();
        player.stop_song_audition(Some(id));
        assert!(player.song_audition.is_none());
        assert!(player.start_instrument_preview(id,&cid,track,Some(0)).is_err());
    }
    #[test]
    fn midi_audition_keeps_performance_state_and_stops_at_end_without_ui_timers() {
        background_tasks::TaskPool::new(1, 2)
            .unwrap()
            .run("audition fixture", None, |token| {
                let (mut player, _, _) = crate::history_loading::tests::seeded(true, false);
                let path = fixture(&player);
                let original = std::fs::read(&path).unwrap();
                let history = player.history.snapshot_bytes().unwrap();
                let score = player.matcher.snapshot();
                let position = player.state.position;
                let status = player.state.status.clone();
                let clock = player.playback.clock;
                let inputs = player.state.midi_events;
                let prepared = Prepared::read(&path, &token).unwrap();
                assert_eq!(prepared.duration, 8.);
                assert!(prepared.events.iter().any(|e| e.bytes == [147, 60, 37]));
                assert!(prepared.events.iter().any(|e| e.bytes == [147, 60, 100]));
                assert!(prepared.events.iter().any(|e| e.bytes == [179, 64, 127]));
                assert!(
                    prepared
                        .events
                        .iter()
                        .any(|e| e.bytes == [195, 5, 0] && e.len == 2)
                );
                let origin = player
                    .begin_song_audition("song-audition-musical".into())
                    .unwrap();
                player
                    .install_song_audition(origin, prepared, &token)
                    .unwrap();
                for _ in 0..16 {
                    player.tick(Duration::from_millis(500));
                    player.song_audition_state(Some("song-audition-musical"));
                }
                assert!(player.song_audition.is_none());
                assert_eq!(player.state.position, position);
                assert_eq!(player.state.status, status);
                assert_eq!(player.playback.clock, clock);
                assert_eq!(player.state.midi_events, inputs);
                assert_eq!(player.matcher.snapshot(), score);
                assert!(player.state.pressed.is_empty());
                assert_eq!(player.state.pedal, 0);
                assert!(!player.recorder.is_recording());
                assert_eq!(player.history.snapshot_bytes().unwrap(), history);
                assert_eq!(std::fs::read(path).unwrap(), original);
                Ok(Value::Null)
            })
            .unwrap();
    }
    #[test]
    fn cancelled_and_stale_starts_cannot_take_sound_from_newer_playback() {
        background_tasks::TaskPool::new(1, 2)
            .unwrap()
            .run("audition cancellation", None, |token| {
                let (mut player, _, _) = crate::history_loading::tests::seeded(true, false);
                let path = fixture(&player);
                let early = "song-audition-early";
                player.stop_song_audition(Some(early));
                assert!(player.begin_song_audition(early.into()).is_err());
                let old = player
                    .begin_song_audition("song-audition-old".into())
                    .unwrap();
                let current = player
                    .begin_song_audition("song-audition-current".into())
                    .unwrap();
                assert!(
                    player
                        .install_song_audition(old, Prepared::read(&path, &token).unwrap(), &token)
                        .is_err()
                );
                player
                    .install_song_audition(current, Prepared::read(&path, &token).unwrap(), &token)
                    .unwrap();
                player.stop_song_audition(Some("song-audition-old"));
                assert_eq!(
                    player.song_audition.as_ref().unwrap().id,
                    "song-audition-current"
                );
                player.tick(Duration::from_millis(200));
                assert!(player.song_audition.as_ref().unwrap().position > 0.);
                player.midi(&[144, 64, 90]);
                assert!(player.song_audition.is_none());
                player.midi(&[128, 64, 0]);
                let origin = player
                    .begin_song_audition("song-audition-lease".into())
                    .unwrap();
                player
                    .install_song_audition(origin, Prepared::read(&path, &token).unwrap(), &token)
                    .unwrap();
                player.tick(Duration::from_secs(4));
                assert!(player.song_audition.is_none());
                let origin = player
                    .begin_song_audition("song-audition-resume".into())
                    .unwrap();
                player
                    .install_song_audition(origin, Prepared::read(&path, &token).unwrap(), &token)
                    .unwrap();
                player.command(Command::CountIn { bars: 0 }).unwrap();
                player.command(Command::Play).unwrap();
                assert!(player.song_audition.is_none());
                assert_eq!(player.state.status, "playing");
                player.command(Command::Pause).unwrap();
                Ok(Value::Null)
            })
            .unwrap();
    }
}
