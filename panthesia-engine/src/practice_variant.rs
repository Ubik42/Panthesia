//! One immutable source performance, with disposable practice transformations.
use crate::*;
use midi_file::midly::{MidiMessage as M, num::u7};
use midi_file::{MidiEvent, MidiFile};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Variant {
    pub transpose: i8,
    /// 0 = original timing; otherwise a whole-note subdivision.
    pub quantize: u8,
    pub durations: bool,
    pub tonic: Option<u8>,
    pub minor: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use midi_file::midly::{
        Format, Header, MetaMessage, Smf, Timing, TrackEvent, TrackEventKind as K,
        num::{u4, u15},
    };
    #[test]
    fn practice_transform_preserves_source_drums_and_round_trips_export() {
        let event = |delta: u32, channel: u8, key: u8, on: bool| TrackEvent {
            delta: delta.into(),
            kind: K::Midi {
                channel: u4::from(channel),
                message: if on {
                    M::NoteOn {
                        key: u7::from(key),
                        vel: 90.into(),
                    }
                } else {
                    M::NoteOff {
                        key: u7::from(key),
                        vel: 0.into(),
                    }
                },
            },
        };
        let smf = Smf {
            header: Header::new(Format::Parallel, Timing::Metrical(u15::from(480))),
            tracks: vec![
                vec![
                    TrackEvent {
                        delta: 0.into(),
                        kind: K::Meta(MetaMessage::Tempo(500_000.into())),
                    },
                    event(101u32, 0, 60, true),
                    event(118, 0, 60, false),
                    TrackEvent {
                        delta: 0.into(),
                        kind: K::Meta(MetaMessage::EndOfTrack),
                    },
                ],
                vec![
                    event(101, 9, 36, true),
                    event(118, 9, 36, false),
                    TrackEvent {
                        delta: 0.into(),
                        kind: K::Meta(MetaMessage::EndOfTrack),
                    },
                ],
            ],
        };
        let source = MidiFile::from_smf("variant-test", &smf).unwrap();
        let variant = Variant {
            transpose: 2,
            quantize: 16,
            ..Default::default()
        };
        let effective = transform(&source, &variant).unwrap();
        assert_eq!(source.tracks[0].notes[0].note, 60);
        assert_eq!(effective.tracks[0].notes[0].note, 62);
        assert_eq!(effective.tracks[1].notes[0].note, 36);
        assert_eq!(effective.content_id, source.content_id);
        assert!(
            (effective
                .tempo_track
                .seconds_to_pulses(effective.tracks[0].notes[0].start.as_secs_f64())
                - 120.)
                .abs()
                < 0.001
        );
        assert!(
            (effective
                .tempo_track
                .seconds_to_pulses(effective.tracks[0].notes[0].end.as_secs_f64())
                - 240.)
                .abs()
                < 0.001
        );
        let root = std::env::temp_dir().join(format!(
            "neothesia-variant-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut player = Player::new(root, PathBuf::new(), true);
        std::fs::create_dir_all(&player.data).unwrap();
        let path = player.data.join("variant-test.mid");
        let mut source_bytes = Vec::new();
        smf.write_std(&mut source_bytes).unwrap();
        std::fs::write(&path, &source_bytes).unwrap();
        let source = MidiFile::new(&path).unwrap();
        player.install(source, "variant-test".into(), None).unwrap();
        player.apply_variant_memory(&variant).unwrap();
        let exported = player.export_practice_variant().unwrap();
        let bytes: Vec<u8> = serde_json::from_value(exported["bytes"].clone()).unwrap();
        let parsed = Smf::parse(&bytes).unwrap();
        let decoded = MidiFile::from_smf("exported", &parsed).unwrap();
        assert_eq!(
            decoded
                .tracks
                .iter()
                .flat_map(|t| t.notes.iter())
                .map(|n| n.note)
                .collect::<Vec<_>>(),
            vec![62, 36]
        );
        assert_eq!(std::fs::read(&path).unwrap(), source_bytes);
        assert_eq!(
            Variant::from_grid(&player.grid_signature()).unwrap(),
            variant
        );
        player.apply_variant_memory(&Variant::default()).unwrap();
        assert_eq!(player.file.as_ref().unwrap().tracks[0].notes[0].note, 60);
        assert!(
            (player.file.as_ref().unwrap().tracks[0].notes[0]
                .start
                .as_secs_f64()
                - 101. / 960.)
                .abs()
                < 0.000001
        );
    }
}
impl Default for Variant {
    fn default() -> Self {
        Self {
            transpose: 0,
            quantize: 0,
            durations: true,
            tonic: None,
            minor: None,
        }
    }
}
impl Variant {
    pub(crate) fn from_grid(grid: &str) -> Result<Self, String> {
        let Some((_, signature)) = grid.split_once(";practice-v1:") else {
            return Ok(Self::default());
        };
        let values: Vec<_> = signature.split(',').collect();
        if values.len() != 3 {
            return Err("历史练习版本信息不完整".into());
        }
        let value = Self {
            transpose: values[0].parse().map_err(|_| "历史转调信息无效")?,
            quantize: values[1].parse().map_err(|_| "历史量化信息无效")?,
            durations: match values[2] {
                "1" => true,
                "0" => false,
                _ => return Err("历史量化时值无效".into()),
            },
            ..Default::default()
        };
        value.validate()?;
        Ok(value)
    }
    pub fn active(&self) -> bool {
        self.transpose != 0 || self.quantize != 0
    }
    pub fn validate(&self) -> Result<(), String> {
        if !(-24..=24).contains(&self.transpose)
            || ![0, 8, 16, 32].contains(&self.quantize)
            || self.tonic.is_some_and(|v| v > 11)
        {
            return Err("转调或量化设置无效".into());
        }
        Ok(())
    }
    pub fn signature(&self) -> String {
        format!(
            ";practice-v1:{},{},{}",
            self.transpose,
            self.quantize,
            u8::from(self.durations)
        )
    }
}
pub fn transform(source: &MidiFile, variant: &Variant) -> Result<MidiFile, String> {
    variant.validate()?;
    let mut file = source.clone();
    if !variant.active() {
        return Ok(file);
    }
    let tempo = &source.tempo_track;
    let step = f64::from(tempo.ppq()) * 4. / f64::from(variant.quantize.max(1));
    let snap = |tick: f64| {
        let base = source
            .musical_time
            .measure_at(tick)
            .map_or(0., |m| m.start_tick as f64);
        (base + ((tick - base) / step).round() * step)
            .max(0.)
            .round() as u64
    };
    let mut duration = source.duration;
    let mut tracks = Vec::with_capacity(source.tracks.len());
    for original in source.tracks.iter() {
        let mut track = original.clone();
        let mut notes = original.notes.to_vec();
        let mut starts = std::collections::HashSet::new();
        for note in &mut notes {
            if note.channel != 9 {
                let pitch = i16::from(note.note) + i16::from(variant.transpose);
                if !(0..=127).contains(&pitch) {
                    return Err("转调后有音符超出 MIDI 音域，请缩小转调幅度".into());
                }
                note.note = pitch as u8;
            }
            if variant.quantize != 0 {
                let start = tempo.seconds_to_pulses(note.start.as_secs_f64());
                let end = tempo.seconds_to_pulses(note.end.as_secs_f64());
                let quantized = snap(start);
                note.start = tempo.pulses_to_duration(quantized);
                note.end = if variant.durations {
                    tempo
                        .pulses_to_duration(snap(end).max(quantized + (step.round() as u64).max(1)))
                } else {
                    note.start + note.duration
                };
                note.duration = note.end.saturating_sub(note.start);
                if !starts.insert((note.channel, note.note, quantized)) {
                    return Err("这个网格会把连续的同音压在一起，请选更细的量化网格".into());
                }
            }
            duration = duration.max(note.end);
        }
        // Note indices remain stable, so hand and fingering annotations keep their identity.
        let mut events = Vec::with_capacity(original.events.len());
        for event in original.events.iter() {
            if matches!(event.message, M::NoteOn { .. } | M::NoteOff { .. }) {
                continue;
            }
            let mut event = event.clone();
            if event.channel != 9 {
                if let M::Aftertouch { key, vel } = event.message {
                    let pitch = i16::from(key.as_int()) + i16::from(variant.transpose);
                    if (0..=127).contains(&pitch) {
                        event.message = M::Aftertouch {
                            key: u7::from(pitch as u8),
                            vel,
                        };
                    }
                }
            }
            events.push(event);
        }
        for note in &notes {
            events.push(MidiEvent {
                channel: note.channel,
                timestamp: note.start,
                message: M::NoteOn {
                    key: u7::from(note.note),
                    vel: u7::from(note.velocity),
                },
                track_id: note.track_id,
                track_color_id: note.track_color_id,
            });
            events.push(MidiEvent {
                channel: note.channel,
                timestamp: note.end,
                message: M::NoteOff {
                    key: u7::from(note.note),
                    vel: u7::from(0),
                },
                track_id: note.track_id,
                track_color_id: note.track_color_id,
            });
        }
        events.sort_by_key(|e| {
            (
                e.timestamp,
                if matches!(e.message, M::NoteOff { .. }) {
                    0
                } else if matches!(e.message, M::NoteOn { .. }) {
                    2
                } else {
                    1
                },
            )
        });
        track.notes = notes.into();
        track.events = events.into();
        tracks.push(track);
    }
    file.tracks = tracks.into();
    file.duration = duration;
    let last_tick = tempo.seconds_to_pulses(duration.as_secs_f64()).ceil() as u64;
    while file
        .musical_time
        .measures
        .last()
        .is_some_and(|m| m.end_tick < last_tick)
    {
        let mut next = file.musical_time.measures.last().unwrap().clone();
        next.number += 1;
        next.display_number += 1;
        next.start_tick = next.end_tick;
        next.end_tick = next.start_tick
            + u64::from(tempo.ppq()) * 4 * u64::from(next.numerator) / u64::from(next.denominator);
        next.partial = false;
        file.musical_time.measures.push(next);
    }
    file.measures = file.musical_time.bar_times(tempo).into();
    file.beats = file.musical_time.beat_times(tempo).into();
    Ok(file)
}

/// A labelled, editable heuristic, used only when no MIDI key signature is available.
fn key_estimate(file: &MidiFile) -> (u8, bool) {
    let mut histogram = [0f64; 12];
    for note in file
        .tracks
        .iter()
        .flat_map(|t| t.notes.iter())
        .filter(|n| n.channel != 9)
    {
        histogram[usize::from(note.note % 12)] += note.duration.as_secs_f64().max(0.05).min(8.);
    }
    let profiles = [
        [5., 0., 2., 0., 3., 2., 0., 4., 0., 2., 0., 1.],
        [5., 0., 2., 3., 0., 2., 0., 4., 2., 0., 2., 0.],
    ];
    let mut best = (f64::NEG_INFINITY, 0, false);
    for tonic in 0..12 {
        for (minor, profile) in profiles.iter().enumerate() {
            let score = (0..12)
                .map(|p| histogram[p] * profile[(p + 12 - tonic) % 12])
                .sum::<f64>();
            if score > best.0 {
                best = (score, tonic as u8, minor == 1);
            }
        }
    }
    (best.1, best.2)
}
impl Player {
    pub(super) fn export_practice_variant(&self) -> Result<serde_json::Value, String> {
        use midi_file::midly::{
            Format, Header, MetaMessage, Smf, Timing, TrackEvent, TrackEventKind,
            num::{u4, u15, u24, u28},
        };
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let mut conductor = Vec::new();
        for e in file.tempo_track.events() {
            conductor.push((
                e.absolute_pulses,
                TrackEventKind::Meta(MetaMessage::Tempo(u24::from(e.tempo))),
            ));
        }
        let mut meter = None;
        for m in &file.musical_time.measures {
            let value = (m.numerator, m.denominator);
            if meter != Some(value) {
                conductor.push((
                    m.start_tick,
                    TrackEventKind::Meta(MetaMessage::TimeSignature(
                        m.numerator,
                        m.denominator.trailing_zeros() as u8,
                        24,
                        8,
                    )),
                ));
                meter = Some(value);
            }
        }
        let variant = self.variant();
        if file.key_signature.is_some() || variant.tonic.is_some() {
            let info = self.variant_document();
            let minor = info["minor"].as_bool().unwrap_or(false);
            let tonic =
                (info["tonic"].as_i64().unwrap_or(0) + i64::from(variant.transpose)).rem_euclid(12);
            if let Some(sharps) = (-7i8..=7)
                .filter(|s| (i64::from(*s) * 7 + if minor { 9 } else { 0 }).rem_euclid(12) == tonic)
                .min_by_key(|s| s.abs())
            {
                conductor.push((
                    0,
                    TrackEventKind::Meta(MetaMessage::KeySignature(sharps, minor)),
                ));
            }
        }
        fn encode(
            mut values: Vec<(u64, TrackEventKind<'static>)>,
        ) -> Result<Vec<TrackEvent<'static>>, String> {
            values.sort_by_key(|v| v.0);
            let mut previous = 0;
            let mut out = Vec::new();
            for (tick, kind) in values {
                let delta = tick.saturating_sub(previous);
                if delta > 0x0fff_ffff {
                    return Err("导出的事件间隔超出 MIDI 范围".into());
                }
                out.push(TrackEvent {
                    delta: u28::from(delta as u32),
                    kind,
                });
                previous = tick;
            }
            out.push(TrackEvent {
                delta: 0.into(),
                kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
            });
            Ok(out)
        }
        let mut tracks = vec![encode(conductor)?];
        for track in file.tracks.iter() {
            tracks.push(encode(
                track
                    .events
                    .iter()
                    .map(|e| {
                        (
                            file.tempo_track
                                .seconds_to_pulses(e.timestamp.as_secs_f64())
                                .round()
                                .max(0.) as u64,
                            TrackEventKind::Midi {
                                channel: u4::from(e.channel),
                                message: e.message,
                            },
                        )
                    })
                    .collect(),
            )?);
        }
        let smf = Smf {
            header: Header::new(
                Format::Parallel,
                Timing::Metrical(u15::from(file.tempo_track.ppq())),
            ),
            tracks,
        };
        let mut bytes = Vec::new();
        smf.write_std(&mut bytes).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({"bytes":bytes}))
    }
    pub(super) fn variant(&self) -> Variant {
        self.file
            .as_ref()
            .and_then(|f| self.preferences.variants.get(&f.content_id))
            .cloned()
            .unwrap_or_default()
    }
    pub(super) fn variant_document(&self) -> serde_json::Value {
        let variant = self.variant();
        let source = self.source_file.as_ref().or(self.file.as_ref());
        let (estimate, minor) = source.map_or((0, false), |f| key_estimate(f));
        let signature = source.and_then(|f| f.key_signature);
        let tonic = variant
            .tonic
            .or_else(|| {
                signature.map(|(sharps, minor)| {
                    ((i16::from(sharps) * 7 + if minor { 9 } else { 0 }).rem_euclid(12)) as u8
                })
            })
            .unwrap_or(estimate);
        let minor = variant
            .minor
            .or_else(|| signature.map(|(_, minor)| minor))
            .unwrap_or(minor);
        let notes: Vec<_> = source
            .into_iter()
            .flat_map(|f| f.tracks.iter())
            .flat_map(|t| t.notes.iter())
            .filter(|n| n.channel != 9)
            .map(|n| n.note)
            .collect();
        serde_json::json!({"settings":variant,"tonic":tonic,"minor":minor,"keySource":if variant.tonic.is_some(){"manual"}else if signature.is_some(){"midi"}else{"estimate"},"minPitch":notes.iter().min(),"maxPitch":notes.iter().max(),"active":variant.active(),"sourceHasScore":self.notation.is_some()})
    }
    pub(super) fn apply_variant_memory(&mut self, value: &Variant) -> Result<(), String> {
        if !self.variant().active() {
            self.source_file = self.file.clone();
        }
        let source = self
            .source_file
            .clone()
            .ok_or("曲目原始演奏尚未读齐，请重新打开曲目")?;
        let file = transform(&source, value)?;
        let timeline = load_pipeline::Timeline::new(&file)?;
        let previous = self.file.as_ref().ok_or("请先选择曲目")?;
        let mut fingers = HashMap::new();
        for track in file.tracks.iter() {
            if let Some(old) = previous
                .tracks
                .iter()
                .find(|t| t.track_id == track.track_id)
            {
                for (index, note) in track.notes.iter().enumerate() {
                    if let Some(note_before) = old.notes.get(index) {
                        if let Some(finger) =
                            self.fingers
                                .get(&(track.track_id, note_before.start, note_before.note))
                        {
                            fingers.insert((track.track_id, note.start, note.note), *finger);
                        }
                    }
                }
            }
        }
        self.panic();
        self.fingers = fingers.into();
        self.state.duration = timeline.duration;
        self.notes = timeline.notes;
        self.events = timeline.events;
        self.event_notes = timeline.event_notes;
        self.sound_timeline = timeline.sound;
        self.file = Some(file.into());
        self.score_revision = self.score_revision.wrapping_add(1);
        self.previous_summary = None;
        self.previous_mode = None;
        self.state.passage = None;
        self.preferences
            .variants
            .insert(source.content_id.clone(), value.clone());
        self.reset(self.state.position.min(self.state.duration));
        Ok(())
    }
    pub(super) fn set_variant(
        &mut self,
        content_id: &str,
        revision: u64,
        value: Variant,
    ) -> Result<serde_json::Value, String> {
        if self
            .file
            .as_ref()
            .is_none_or(|f| f.content_id != content_id)
            || self.score_revision != revision
        {
            return Err("曲目已变化，请重新读取转调与量化设置".into());
        }
        if self.recorder.is_recording()
            || self.routine.is_some()
            || self.ladder.as_ref().is_some_and(|l| l.active)
            || is_recital_mode(&self.state.mode)
        {
            return Err("请先结束录音、计划或完整演奏，再更换练习版本".into());
        }
        value.validate()?;
        let current = self.variant();
        if (current.transpose, current.quantize, current.durations)
            != (value.transpose, value.quantize, value.durations)
        {
            self.apply_variant_memory(&value)?;
        }
        self.preferences
            .variants
            .insert(content_id.to_owned(), value);
        self.persist()?;
        Ok(serde_json::json!({"ok":true}))
    }
}
