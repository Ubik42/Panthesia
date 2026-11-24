//! One immutable source performance, with disposable practice transformations.
use crate::*;
use panthesia_music::midly::{MidiMessage as M, num::u7};
use panthesia_music::{MidiEvent, MidiFile};

pub use panthesia_core::practice_transform::Variant;

#[cfg(test)]
mod tests {
    use super::*;
    use panthesia_music::midly::{
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
            event.order=1;
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
                source_note:Some(note.id()),
                order:2,
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
                source_note:Some(note.id()),
                order:0,
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
/// The song's main key (tonic, minor) estimated from its notes.
pub(super) fn key_estimate(file: &MidiFile) -> (u8, bool) {
    panthesia_analysis::main_key(&panthesia_analysis::notes(&file.source), &file.musical_time)
        .map_or((0, false), |key| (key.tonic, key.minor))
}
impl Player {
    pub(super) fn export_practice_variant(&self) -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({"bytes": self.practice_smf(false)?}))
    }
    /// The practice MIDI split by hand: one track each for the right hand, the left hand and the
    /// rest (song-pipeline.md, "练习 MIDI"), with the practice version applied. Pedal and
    /// program changes go to every hand track, each hand on its own channel.
    pub(crate) fn export_hand_split(&self) -> Result<Vec<u8>, String> {
        self.practice_smf(true)
    }
    fn practice_smf(&self, split: bool) -> Result<Vec<u8>, String> {
        use panthesia_music::midly::{
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
        let info=self.variant_document();
        if let Some(keys)=info["keyChanges"].as_array().filter(|_|info["keySource"]!="estimate"){for key in keys {
            let (Some(tick),Some(fifths),Some(minor))=(key["tick"].as_u64(),key["fifths"].as_i64(),key["minor"].as_bool())else{continue;};
            conductor.push((tick,TrackEventKind::Meta(MetaMessage::KeySignature(fifths as i8,minor))));
        }}
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
        let pulses = |t: std::time::Duration| file.tempo_track.seconds_to_pulses(t.as_secs_f64()).round().max(0.) as u64;
        if split {
            use panthesia_core::practice::PracticePart;
            let hands = [(PracticePart::RightHand, "右手", 0u8), (PracticePart::LeftHand, "左手", 1), (PracticePart::Other, "其他", 2)];
            let mut parts: Vec<Vec<(u64, TrackEventKind<'static>)>> = hands.iter().map(|_| Vec::new()).collect();
            let mut used = [false; 3];
            for track in file.tracks.iter() {
                for (index, n) in track.notes.iter().enumerate() {
                    let part = crate::hands::part(&self.config, &self.note_hands, track.track_id, index);
                    let slot = hands.iter().position(|(p, _, _)| *p == part).unwrap_or(2);
                    used[slot] = true;
                    let channel = u4::from(hands[slot].2);
                    parts[slot].push((pulses(n.start), TrackEventKind::Midi { channel, message: M::NoteOn { key: u7::from(n.note), vel: u7::from(n.velocity.max(1)) } }));
                    parts[slot].push((pulses(n.end), TrackEventKind::Midi { channel, message: M::NoteOff { key: u7::from(n.note), vel: u7::from(0) } }));
                }
            }
            for track in file.tracks.iter() {
                for e in track.events.iter().filter(|e| !matches!(e.message, M::NoteOn { .. } | M::NoteOff { .. })) {
                    for (slot, (_, _, channel)) in hands.iter().enumerate() {
                        parts[slot].push((pulses(e.timestamp), TrackEventKind::Midi { channel: u4::from(*channel), message: e.message }));
                    }
                }
            }
            for (slot, events) in parts.into_iter().enumerate() {
                if !used[slot] {
                    continue;
                }
                let mut events = events;
                events.insert(0, (0, TrackEventKind::Meta(MetaMessage::TrackName(hands[slot].1.as_bytes()))));
                tracks.push(encode(events)?);
            }
        }
        for track in file.tracks.iter().filter(|_| !split) {
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
        Ok(bytes)
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
        let key_source=source.map(|file|crate::practice_keys::source(file,self.notation.as_deref()));
        let signature=key_source.as_ref().and_then(|file|file.key_signature);
        let authored_key=source.is_some_and(|file|file.key_signatures.is_empty())&&signature.is_some();
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
        let effective_tonic=(i16::from(tonic)+i16::from(variant.transpose)).rem_euclid(12) as u8;
        let effective_fifths=signature.filter(|(_,m)|*m==minor).map(|(f,_)|f).filter(|f|((i16::from(*f)*7+if minor{9}else{0}).rem_euclid(12)) as u8==effective_tonic).unwrap_or_else(||(-7i8..=7).filter(|f|((i16::from(*f)*7+if minor{9}else{0}).rem_euclid(12)) as u8==effective_tonic).min_by_key(|f|f.abs()).unwrap_or(0));
        let edition=source.and_then(|file|panthesia_core::song_project::PracticeEdition::new(&file.content_id,variant.clone()).ok());
        serde_json::json!({"editionId":edition.map(|e|e.id),"settings":variant,"tonic":tonic,"effectiveTonic":effective_tonic,"effectiveFifths":effective_fifths,"keyChanges":key_source.as_ref().map(|file|crate::practice_keys::timeline(file,&variant,effective_fifths,minor)).unwrap_or_default(),"minor":minor,"keySource":if variant.tonic.is_some(){"manual"}else if authored_key{"score"}else if signature.is_some(){"midi"}else{"estimate"},"minPitch":notes.iter().min(),"maxPitch":notes.iter().max(),"active":variant.active(),"sourceHasScore":self.notation.is_some()})
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
        if self.recorder.is_recording() {
            return Err("请先结束录音，再更换练习版本".into());
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
