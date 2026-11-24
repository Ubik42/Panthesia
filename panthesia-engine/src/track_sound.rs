use crate::Player;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackSound {
    pub volume: u8,
    pub pan: Option<u8>,
    pub program: Option<u8>,
    /// Per-hand level (0–100) of a track whose notes are split between the hands, applied to
    /// each note's velocity; `None` plays the hand at the track's level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<u8>,
}
impl TrackSound {
    /// The velocity of a note of `part` after its hand's level; `None` silences it.
    pub(crate) fn hand_velocity(&self, part: panthesia_core::practice::PracticePart, velocity: u8) -> Option<u8> {
        use panthesia_core::practice::PracticePart;
        let level = match part {
            PracticePart::LeftHand => self.left,
            PracticePart::RightHand => self.right,
            _ => None,
        };
        match level {
            None => Some(velocity),
            Some(0) => None,
            Some(level) => Some(((u16::from(velocity) * u16::from(level) + 50) / 100).clamp(1, 127) as u8),
        }
    }
}
impl Default for TrackSound {
    fn default() -> Self {
        Self {
            volume: 100,
            pan: None,
            program: None,
            left: None,
            right: None,
        }
    }
}
#[derive(Default, Clone)]
pub struct Routing {
    pub lanes: BTreeMap<(usize, u8), u8>,
}
impl Routing {
    pub fn build(events: &[panthesia_music::MidiEvent]) -> Result<Self, String> {
        let mut keys = std::collections::BTreeSet::new();
        for e in events {
            if matches!(
                e.message,
                panthesia_music::midly::MidiMessage::NoteOn { .. }
                    | panthesia_music::midly::MidiMessage::NoteOff { .. }
            ) {
                keys.insert((e.track_id, e.channel));
            }
        }
        let mut available = (1..16).filter(|c| *c != 9);
        let mut percussion = false;
        let mut lanes = BTreeMap::new();
        for key in keys {
            let channel = if key.1 == 9 {
                if percussion {
                    return Err("多个独立打击乐声部暂不支持单独混音".into());
                }
                percussion = true;
                9
            } else {
                available
                    .next()
                    .ok_or("独立混音最多支持 14 个旋律通道和 1 个打击乐通道；此曲通道过多")?
            };
            lanes.insert(key, channel);
        }
        Ok(Self { lanes })
    }
    #[allow(dead_code)]
    pub fn transform(
        &self, track: usize, bytes: &[u8], settings: &BTreeMap<usize, TrackSound>,
    ) -> Vec<Vec<u8>> {
        let mut result = Vec::new();
        self.for_each_message(track, bytes, settings, |message| result.push(message.to_vec()));
        result
    }
    /// Live playback emits stack-backed MIDI messages without allocating target/message vectors.
    pub(crate) fn for_each_message(
        &self, track: usize, bytes: &[u8], settings: &BTreeMap<usize, TrackSound>,
        mut emit: impl FnMut(&[u8]),
    ) {
        let Some(&status) = bytes.first() else { return; };
        let original = status & 15;
        let kind = status & 240;
        if !(128..=224).contains(&kind) { return; }
        let length = if matches!(kind, 192 | 208) { 2 } else { 3 };
        if bytes.len() != length { return; }
        let mut target = |track: usize, channel: u8| {
            let sound = settings.get(&track).copied().unwrap_or_default();
            let mut message = [kind | channel, bytes[1], bytes.get(2).copied().unwrap_or(0)];
            if kind == 192 {
                if let Some(program) = sound.program { message[1] = program; }
            }
            if kind == 176 {
                match message[1] {
                    7 => message[2] = ((u16::from(message[2]) * u16::from(sound.volume) + 50) / 100) as u8,
                    10 => if let Some(pan) = sound.pan { message[2] = pan; },
                    0 | 32 if sound.program.is_some() => message[2] = 0,
                    _ => {}
                }
            }
            emit(&message[..length]);
            if kind == 176 && bytes[1] == 121 {
                emit(&[176 | channel, 7, sound.volume]);
                if let Some(pan) = sound.pan { emit(&[176 | channel, 10, pan]); }
            }
        };
        if let Some(channel) = self.lanes.get(&(track, original)).copied() {
            target(track, channel);
        } else if matches!(kind, 176 | 192 | 208 | 224) {
            for ((track, source), channel) in &self.lanes {
                if *source == original { target(*track, *channel); }
            }
        }
    }

}
#[derive(Clone, Serialize)]
pub struct Preset {
    pub program: u8,
    pub name: String,
}
pub fn presets(path: &std::path::Path) -> Vec<Preset> {
    fn chunks(bytes: &[u8]) -> Vec<Preset> {
        let mut out = vec![];
        let mut at = 0;
        while at + 8 <= bytes.len() {
            let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
            let Some(end) = (at + 8).checked_add(size).filter(|e| *e <= bytes.len()) else {
                break;
            };
            let id = &bytes[at..at + 4];
            let data = &bytes[at + 8..end];
            if id == b"LIST" && data.len() >= 4 && &data[..4] == b"pdta" {
                out.extend(chunks(&data[4..]));
            }
            if id == b"phdr" {
                for r in data.chunks_exact(38) {
                    let program = u16::from_le_bytes([r[20], r[21]]);
                    let bank = u16::from_le_bytes([r[22], r[23]]);
                    let name = String::from_utf8_lossy(&r[..20])
                        .trim_end_matches('\0')
                        .to_string();
                    if bank == 0 && program < 128 && name != "EOP" {
                        out.push(Preset {
                            program: program as u8,
                            name,
                        });
                    }
                }
            }
            at = end + (size % 2);
        }
        out
    }
    if std::fs::metadata(path).map_or(true, |m| m.len() > 512 * 1024 * 1024) {
        return vec![];
    }
    let Ok(bytes) = std::fs::read(path) else {
        return vec![];
    };
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"sfbk" {
        return vec![];
    }
    let mut out = chunks(&bytes[12..]);
    out.sort_by_key(|p| p.program);
    out.dedup_by_key(|p| p.program);
    out
}
/// Immutable controller histories are built with the song on a worker.
/// Seeking selects one event per control with binary search rather than rescanning notes.
pub(crate) struct Timeline {
    routing: Result<std::sync::Arc<Routing>, String>,
    unmixed: std::sync::Arc<Routing>,
    controls: BTreeMap<(usize, u8, u16), Vec<(usize, panthesia_music::MidiEvent)>>,
}
impl Default for Timeline {
    fn default() -> Self {
        Self { routing: Ok(Default::default()), unmixed: Default::default(), controls: BTreeMap::new() }
    }
}
impl Timeline {
    pub(crate) fn new_checked(
        events: &[panthesia_music::MidiEvent],
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        check()?;
        let mut controls: BTreeMap<_, Vec<_>> = BTreeMap::new();
        for (index, event) in events.iter().enumerate() {
            if index % 1024 == 0 {
                check()?;
            }
            use panthesia_music::midly::MidiMessage as M;
            let key = match event.message {
                M::Controller { controller, .. }
                    if !matches!(controller.as_int(), 64 | 120 | 123) =>
                {
                    u16::from(controller.as_int())
                }
                M::ProgramChange { .. } => 128,
                M::PitchBend { .. } => 129,
                _ => continue,
            };
            controls
                .entry((event.track_id, event.channel, key))
                .or_default()
                .push((index, event.clone()));
        }
        check()?;
        let routing = Routing::build(events).map(std::sync::Arc::new);
        check()?;
        Ok(Self {
            routing,
            unmixed: Default::default(),
            controls,
        })
    }
    fn validate_routing(&self) -> Result<(), String> {
        self.routing.as_ref().map(|_| ()).map_err(Clone::clone)
    }
    fn at(&self, cursor: usize, mixed: bool) -> Prepared {
        let (routing, error) = if mixed {
            match &self.routing {
                Ok(routing) => (routing.clone(), None),
                Err(error) => (self.unmixed.clone(), Some(error.clone())),
            }
        } else {
            (self.unmixed.clone(), None)
        };
        let mut selected = self
            .controls
            .values()
            .filter_map(|history| {
                let before = history.partition_point(|(index, _)| *index < cursor);
                before.checked_sub(1).map(|index| history[index].clone())
            })
            .collect::<Vec<_>>();
        selected.sort_by_key(|(index, _)| *index);
        Prepared {
            routing,
            events: selected.into_iter().map(|(_, event)| event).collect(),
            error,
        }
    }
}

/// A seek/switch sound state is computed without a device connection.
pub(crate) struct Prepared {
    routing: std::sync::Arc<Routing>,
    events: Vec<panthesia_music::MidiEvent>,
    error: Option<String>,
}
impl Player {
    pub(crate) fn track_sound_settings(&self) -> BTreeMap<usize, TrackSound> {
        let mut s = self
            .file
            .as_ref()
            .and_then(|f| self.preferences.track_sounds.get(&f.content_id))
            .cloned()
            .unwrap_or_default();
        s.retain(|id, s| {
            s.volume <= 100
                && s.pan.is_none_or(|p| p <= 127)
                && s.program.is_none_or(|p| p <= 127)
                && self.file.as_ref().is_some_and(|f| {
                    f.tracks
                        .iter()
                        .any(|t| t.track_id == *id && !t.notes.is_empty())
                })
        });
        s
    }
    pub(crate) fn effective_track_sound(&self) -> BTreeMap<usize, TrackSound> {
        let mut s = self.track_sound_settings();
        if self.vst.is_some() || self.output_connection.is_some() {
            for sound in s.values_mut() {
                sound.program = None;
            }
        } else {
            for sound in s.values_mut() {
                if sound.program.is_some_and(|program| !self.soundfont_presets.iter().any(|preset| preset.program == program)) {
                    sound.program = None;
                }
            }
        }
        s
    }
    pub(crate) fn send_track(&mut self, track: usize, bytes: &[u8]) {
        if self.track_routing.lanes.is_empty() {
            self.send(bytes)
        } else {
            // The shared snapshots release the actor borrow before sending to its live device.
            let routing = self.track_routing.clone();
            let settings = self.track_sound_cache.clone();
            routing.for_each_message(track, bytes, &settings, |message| self.send(message));
        }
    }
    pub(crate) fn prepare_track_sound(&self)->Prepared {
        self.sound_timeline.at(self.playback.event_cursor,!self.track_sound_settings().is_empty())
    }
    pub(crate) fn restore_track_sound(&mut self) {
        let prepared=self.prepare_track_sound();
        self.restore_prepared_track_sound(prepared);
    }
    pub(crate) fn restore_prepared_track_sound(&mut self,prepared:Prepared) {
        self.track_sound_cache = std::sync::Arc::new(self.effective_track_sound());
        let settings = self.track_sound_cache.clone();
        self.track_routing = prepared.routing;
        if let Some(error)=prepared.error {self.state.error=Some(error);}
        let routing = self.track_routing.clone();
        let mut reset_channel = |channel: u8| {
            for (message, len) in [
                ([176 | channel, 121, 0], 3), ([176 | channel, 0, 0], 3),
                ([176 | channel, 32, 0], 3), ([192 | channel, 0, 0], 2),
                ([176 | channel, 7, 100], 3), ([176 | channel, 10, 64], 3),
                ([224 | channel, 0, 64], 3),
            ] { self.send(&message[..len]); }
        };
        if routing.lanes.is_empty() {
            for channel in 0..16 { reset_channel(channel); }
        } else {
            for channel in routing.lanes.values().copied().chain(std::iter::once(0)) { reset_channel(channel); }
        }
        for ((track, _), channel) in &routing.lanes {
            let sound = settings.get(track).copied().unwrap_or_default();
            self.send(&[176 | *channel, 7, sound.volume]);
            if let Some(pan) = sound.pan { self.send(&[176 | *channel, 10, pan]); }
            if let Some(program) = sound.program { self.send(&[192 | *channel, program]); }
        }
        for e in prepared.events {
            use panthesia_music::midly::MidiMessage as M;
            let (message, len) = match e.message {
                M::Controller { controller, value } if !matches!(controller.as_int(), 64 | 120 | 123) =>
                    ([176 | e.channel, controller.as_int(), value.as_int()], 3),
                M::ProgramChange { program } => ([192 | e.channel, program.as_int(), 0], 2),
                M::PitchBend { bend } => ([224 | e.channel, (bend.0.as_int() & 127) as u8, (bend.0.as_int() >> 7) as u8], 3),
                _ => continue,
            };
            self.send_track(e.track_id, &message[..len]);
        }
    }
    pub(crate) fn set_track_sound(
        &mut self,
        id: usize,
        sound: Option<TrackSound>,
    ) -> Result<serde_json::Value, String> {
        if !self.config.tracks.iter().any(|t| t.track_id == id) {
            return Err("找不到音轨".into());
        }
        if let Some(s) = &sound {
            if s.volume > 100 || s.pan.is_some_and(|p| p > 127) || s.left.is_some_and(|v| v > 100) || s.right.is_some_and(|v| v > 100) {
                return Err("音量或声像超出范围".into());
            }
            if s.program
                .is_some_and(|p| !self.soundfont_presets.iter().any(|a| a.program == p))
            {
                return Err("当前钢琴音源不含此预设".into());
            }
            self.sound_timeline.validate_routing()?;
        }
        let cid = self.file.as_ref().ok_or("请先选择曲目")?.content_id.clone();
        let current = self.preferences.track_sounds.get(&cid).and_then(|settings| settings.get(&id)).copied();
        if current == sound { return Ok(serde_json::json!({"ok":true,"changed":false})); }
        let old = self.preferences.clone();
        let map = self
            .preferences
            .track_sounds
            .entry(cid.clone())
            .or_default();
        if let Some(s) = sound {
            map.insert(id, s);
        } else {
            map.remove(&id);
        }
        if map.is_empty() {
            self.preferences.track_sounds.remove(&cid);
        }
        if let Err(e) = self.preferences.save(&self.preferences_path) {
            self.preferences = old;
            return Err(e);
        }
        self.reset(self.state.position);
        Ok(serde_json::json!({"ok":true}))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn soundfont_switch_keeps_old_source_after_validation_failure() {
        let dir = std::env::temp_dir().join(format!(
            "neothesia-soundfont-switch-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let bundled = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../default.sf2");
        let custom = dir.join("chosen.sf2");
        let invalid = dir.join("invalid.sf2");
        std::fs::copy(&bundled, &custom).unwrap();
        std::fs::write(&invalid, b"not a soundfont").unwrap();
        let mut player = Player::new(dir.join("data"), bundled.clone(), true);
        let result = player.command(crate::Command::SoundFont { path: custom.clone() }).unwrap();
        let canonical = std::fs::canonicalize(custom).unwrap();
        assert_eq!(result["path"], canonical.to_string_lossy().as_ref());
        assert!(!result["soundPresets"].as_array().unwrap().is_empty());
        assert_eq!(player.snapshot().soundfont, canonical);
        assert!(player.command(crate::Command::SoundFont { path: invalid }).is_err());
        assert_eq!(player.snapshot().soundfont, canonical);
        assert_eq!(player.soundfont, canonical);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn independent_channels_and_expression() {
        let r = Routing {
            lanes: BTreeMap::from([((1, 0), 1), ((2, 0), 2)]),
        };
        let s = BTreeMap::from([(
            1,
            TrackSound {
                volume: 50,
                pan: Some(10),
                program: Some(22),
                left: None,
                right: None,
            },
        )]);
        assert_eq!(r.transform(1, &[144, 60, 83], &s), vec![vec![145, 60, 83]]);
        assert_eq!(r.transform(1, &[176, 7, 80], &s), vec![vec![177, 7, 40]]);
        assert_eq!(r.transform(2, &[176, 7, 80], &s), vec![vec![178, 7, 80]]);
        assert_eq!(
            r.transform(0, &[192, 8], &s),
            vec![vec![193, 22], vec![194, 8]]
        );
        assert_eq!(r.transform(1, &[176, 10, 64], &s), vec![vec![177, 10, 10]]);
    }
}

#[cfg(test)]
mod flow_tests {
    
    
}
