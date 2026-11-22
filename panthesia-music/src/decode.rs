//! Source bytes are decoded once, with channel-wide voice/pedal state and track-local identity.
use crate::*;
use midly::{MetaMessage, Timing, TrackEventKind};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    io::Write,
};
const EVENT_LIMIT: usize = 2_000_000;
pub(crate) struct MidiWriter(pub Vec<u8>);
impl Write for MidiWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self
            .0
            .len()
            .checked_add(bytes.len())
            .is_none_or(|n| n > 32_000_000)
        {
            return Err(std::io::Error::other("MIDI 超过 32 MB"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
/// The encoding of a file's meta texts (names, markers, lyrics). MIDI does not declare one;
/// files from Chinese and Japanese tools commonly use GBK or Shift-JIS, so the texts are
/// detected together (chardetng) when they are not valid UTF-8.
fn text_encoding(smf: &Smf) -> &'static encoding_rs::Encoding {
    let texts = smf.tracks.iter().flatten().filter_map(|event| match event.kind {
        TrackEventKind::Meta(
            MetaMessage::TrackName(value)
            | MetaMessage::InstrumentName(value)
            | MetaMessage::Marker(value)
            | MetaMessage::CuePoint(value)
            | MetaMessage::Lyric(value)
            | MetaMessage::Text(value),
        ) => Some(value),
        _ => None,
    });
    let mut detector = chardetng::EncodingDetector::new();
    let mut foreign = false;
    for value in texts {
        if std::str::from_utf8(value).is_err() {
            foreign = true;
        }
        detector.feed(value, false);
    }
    if !foreign {
        return encoding_rs::UTF_8;
    }
    detector.feed(&[], true);
    detector.guess(None, true)
}
fn decode(bytes: &[u8], encoding: &'static encoding_rs::Encoding) -> String {
    encoding.decode_without_bom_handling(bytes).0.into_owned()
}
fn text(bytes: &[u8], limit: usize, encoding: &'static encoding_rs::Encoding) -> Option<String> {
    let value = decode(bytes, encoding)
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect::<String>();
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}
fn release(
    notes: &mut [SourceNote],
    index: usize,
    tick: u64,
    kind: ReleaseKind,
    pedal: bool,
    pending: &mut [Vec<usize>; 16],
) {
    let note = &mut notes[index];
    note.release_tick = tick;
    note.release = kind;
    if pedal {
        pending[note.channel as usize].push(index);
    } else {
        note.sounding_end_tick = tick;
    }
}
/// `default_bpm` is the tempo of a file that has no tempo events at all (sequencer exports
/// that keep the real tempo only in their file name). The content id stays that of `bytes`.
pub(crate) fn read(
    name: String,
    bytes: &[u8],
    check: &dyn Fn() -> Result<(), String>,
    default_bpm: Option<f64>,
) -> Result<MidiFile, String> {
    check()?;
    if bytes.is_empty() || bytes.len() > 32_000_000 {
        return Err("MIDI 为空或超过 32 MB".into());
    }
    let smf = Smf::parse(bytes).map_err(|e| format!("MIDI 文件无法解析：{e}"))?;
    if smf.tracks.is_empty() || smf.tracks.len() > 4096 {
        return Err("MIDI 音轨数量无效".into());
    }
    if smf.header.format == Format::Sequential && smf.tracks.len() > 1 {
        return Err("格式 2 包含独立序列，当前需先拆分为单个演奏文件".into());
    }
    let ppq = match smf.header.timing {
        Timing::Metrical(value) if value.as_int() > 0 => value.as_int(),
        Timing::Metrical(_) => return Err("MIDI 每拍分辨率不能为零".into()),
        Timing::Timecode(_, _) => return Err("当前演奏时间模型暂不支持 SMPTE 时间码 MIDI".into()),
    };
    let count = smf.tracks.iter().map(Vec::len).sum::<usize>();
    if count > EVENT_LIMIT {
        return Err("MIDI 事件超过 200 万个".into());
    }
    let content_id = blake3::hash(bytes).to_hex().to_string();
    let mut events = Vec::with_capacity(count);
    let mut names = vec![None; smf.tracks.len()];
    let mut fallback_names = names.clone();
    let mut last_tick = 0u64;
    let mut marker_set = BTreeSet::new();
    let encoding = text_encoding(&smf);
    let (mut lyrics, mut kar_text) = (Vec::new(), Vec::new());
    let mut keys = Vec::new();
    for (track_id, track) in smf.tracks.iter().enumerate() {
        let mut tick = 0u64;
        for (ordinal, event) in track.iter().enumerate() {
            if ordinal % 2048 == 0 {
                check()?;
            }
            tick = tick
                .checked_add(event.delta.as_int() as u64)
                .ok_or("MIDI 时间超出范围")?;
            match event.kind {
                TrackEventKind::Midi { channel, message } => {
                    let message = match message {
                        MidiMessage::NoteOn { key, vel } if vel.as_int() == 0 => {
                            MidiMessage::NoteOff { key, vel }
                        }
                        other => other,
                    };
                    events.push(TickEvent {
                        tick,
                        track: track_id,
                        ordinal,
                        channel: channel.as_int(),
                        message,
                        voice: None,
                    });
                }
                TrackEventKind::Meta(MetaMessage::TrackName(value)) => {
                    if names[track_id].is_none() {
                        names[track_id] = text(value, 120, encoding);
                    }
                }
                TrackEventKind::Meta(MetaMessage::InstrumentName(value)) => {
                    if fallback_names[track_id].is_none() {
                        fallback_names[track_id] = text(value, 120, encoding);
                    }
                }
                TrackEventKind::Meta(MetaMessage::Marker(value) | MetaMessage::CuePoint(value)) => {
                    if let Some(value) = text(value, 80, encoding) {
                        marker_set.insert((tick, value));
                    }
                }
                TrackEventKind::Meta(MetaMessage::Lyric(value)) => lyrics.push((tick, track_id, ordinal, value)),
                // Karaoke (.kar) files carry lyrics as text events; `@` lines are headers.
                TrackEventKind::Meta(MetaMessage::Text(value)) if !value.starts_with(b"@") => {
                    kar_text.push((tick, track_id, ordinal, value))
                }
                TrackEventKind::Meta(MetaMessage::KeySignature(key, minor)) => {
                    if (-7..=7).contains(&key) {
                        keys.push((tick, track_id, ordinal, (key, minor)));
                    }
                }
                TrackEventKind::Meta(MetaMessage::Tempo(value)) if value.as_int() == 0 => {
                    return Err("MIDI 速度不能为零".into());
                }
                _ => {}
            }
        }
        last_tick = last_tick.max(tick);
    }
    events.sort_by_key(|e| (e.tick, e.track, e.ordinal));
    keys.sort_by_key(|e| (e.0, e.1, e.2));
    let canonical:BTreeMap<_,_>=keys.into_iter().map(|(tick,_,_,value)|(tick,value)).collect();
    let mut signatures=Vec::new();
    for (tick,(fifths,minor)) in canonical {if signatures.last().is_none_or(|last:&key_signature::KeySignatureEvent|last.fifths!=fifths||last.minor!=minor){signatures.push(key_signature::KeySignatureEvent{tick,fifths,minor});}}
    let has_tempo = smf.tracks.iter().flatten().any(|e| matches!(e.kind, TrackEventKind::Meta(MetaMessage::Tempo(_))));
    let tempo = match default_bpm.filter(|bpm| !has_tempo && (10.0..=400.0).contains(bpm)) {
        Some(bpm) => {
            let mut tracks = smf.tracks.clone();
            let micros = midly::num::u24::new((60_000_000.0 / bpm).round() as u32);
            tracks[0].insert(0, midly::TrackEvent { delta: 0.into(), kind: TrackEventKind::Meta(MetaMessage::Tempo(micros)) });
            tempo_track::TempoTrack::build(&tracks, ppq)
        }
        None => tempo_track::TempoTrack::build(&smf.tracks, ppq),
    };
    let musical_time =
        musical_time::MusicalTime::build_checked(&smf.tracks, ppq, last_tick, check)?;
    let mut notes = Vec::<SourceNote>::new();
    let mut voices = BTreeMap::<(u8, u8), VecDeque<usize>>::new();
    let mut pending: [Vec<usize>; 16] = std::array::from_fn(|_| Vec::new());
    let mut pedal = [false; 16];
    let mut counters = vec![0usize; smf.tracks.len()];
    // This narrow ledger records only the old index-to-onset relation. It never determines sound or timing.
    let mut legacy_active = vec![BTreeMap::<(u8, u8), NoteId>::new(); smf.tracks.len()];
    let mut legacy_order = vec![Vec::<NoteId>::new(); smf.tracks.len()];
    let mut orphan_offs = 0usize;
    for (event_index, event) in events.iter_mut().enumerate() {
        if event_index % 2048 == 0 {
            check()?;
        }
        let channel = event.channel as usize;
        let track = event.track;
        match event.message {
            MidiMessage::NoteOn { key, vel } => {
                let id = NoteId {
                    track,
                    onset: counters[track],
                };
                counters[track] += 1;
                event.voice = Some(id);
                if let Some(previous) =
                    legacy_active[track].insert((event.channel, key.as_int()), id)
                {
                    legacy_order[track].push(previous);
                }
                let index = notes.len();
                notes.push(SourceNote {
                    id,
                    start_tick: event.tick,
                    release_tick: last_tick,
                    sounding_end_tick: last_tick,
                    note: key.as_int(),
                    velocity: vel.as_int(),
                    channel: event.channel,
                    release: ReleaseKind::EndOfFile,
                });
                voices
                    .entry((event.channel, key.as_int()))
                    .or_default()
                    .push_back(index);
            }
            MidiMessage::NoteOff { key, .. } => {
                if let Some(previous) = legacy_active[track].remove(&(event.channel, key.as_int()))
                {
                    legacy_order[track].push(previous);
                }
                if let Some(index) = voices
                    .get_mut(&(event.channel, key.as_int()))
                    .and_then(VecDeque::pop_front)
                {
                    event.voice = Some(notes[index].id);
                    release(
                        &mut notes,
                        index,
                        event.tick,
                        ReleaseKind::KeyUp,
                        pedal[channel],
                        &mut pending,
                    );
                } else {
                    orphan_offs += 1;
                }
            }
            MidiMessage::Controller { controller, value } => match controller.as_int() {
                64 => {
                    let down = value.as_int() >= 64;
                    if pedal[channel] && !down {
                        for index in pending[channel].drain(..) {
                            notes[index].sounding_end_tick = event.tick;
                        }
                    }
                    pedal[channel] = down;
                }
                121 => {
                    pedal[channel] = false;
                    for index in pending[channel].drain(..) {
                        notes[index].sounding_end_tick = event.tick;
                    }
                }
                120 | 123 => {
                    let immediate = controller.as_int() == 120;
                    for (&(ch, _), queue) in &mut voices {
                        if ch == event.channel {
                            for index in queue.drain(..) {
                                release(
                                    &mut notes,
                                    index,
                                    event.tick,
                                    if immediate {
                                        ReleaseKind::AllSoundOff
                                    } else {
                                        ReleaseKind::AllNotesOff
                                    },
                                    !immediate && pedal[channel],
                                    &mut pending,
                                );
                            }
                        }
                    }
                    if immediate {
                        for index in pending[channel].drain(..) {
                            notes[index].sounding_end_tick = event.tick;
                        }
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
    let incomplete = notes
        .iter()
        .filter(|n| n.release == ReleaseKind::EndOfFile)
        .count();
    let mut warnings = Vec::new();
    if orphan_offs > 0 {
        warnings.push(format!("{orphan_offs} 个松键事件没有对应的按键"));
    }
    if incomplete > 0 {
        warnings.push(format!("{incomplete} 个未松键音符按文件结束位置截断"));
    }
    notes.sort_by_key(|n| n.id);
    let note_indices = notes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id, i))
        .collect::<BTreeMap<_, _>>();
    let mut mapping = Vec::with_capacity(notes.len());
    let mut tracks = Vec::with_capacity(smf.tracks.len());
    let mut color = 0usize;
    let mut event_indices = vec![Vec::<usize>::new(); smf.tracks.len()];
    for (index, event) in events.iter().enumerate() {
        event_indices[event.voice.map_or(event.track, |id| id.track)].push(index);
    }
    for track_id in 0..smf.tracks.len() {
        check()?;
        let range = notes.partition_point(|n| n.id.track < track_id)
            ..notes.partition_point(|n| n.id.track <= track_id);
        let source_notes = &notes[range];
        let mut ordered = legacy_order[track_id].clone();
        let legacy_len = ordered.len();
        let seen = ordered.iter().copied().collect::<BTreeSet<_>>();
        ordered.extend(
            source_notes
                .iter()
                .filter(|n| !seen.contains(&n.id))
                .map(|n| n.id),
        );
        let mut translated = Vec::with_capacity(ordered.len());
        let mut drums = false;
        let mut melodic = false;
        for (index, id) in ordered.into_iter().enumerate() {
            let note = &notes[note_indices[&id]];
            let start = tempo.pulses_to_duration(note.start_tick);
            let end = tempo.pulses_to_duration(note.release_tick);
            if note.channel == 9 {
                drums = true;
            } else {
                melodic = true;
            }
            translated.push(MidiNote {
                source_index: id.onset,
                start,
                end,
                duration: end.saturating_sub(start),
                note: note.note,
                velocity: note.velocity,
                channel: note.channel,
                track_id,
                track_color_id: color,
            });
            mapping.push(NoteMapping {
                id,
                compatibility_index: index,
                legacy_index: (index < legacy_len).then_some(index),
            });
        }
        let track_events = event_indices[track_id]
            .iter()
            .map(|&index| (index, &events[index]))
            .map(|(index, e)| MidiEvent {
                source_note: e.voice,
                order: index,
                channel: e.channel,
                timestamp: tempo.pulses_to_duration(e.tick),
                message: e.message,
                track_id,
                track_color_id: color,
            })
            .collect::<Vec<_>>();
        let programs = track_events
            .iter()
            .filter_map(|e| {
                if let MidiMessage::ProgramChange { program } = e.message {
                    Some(ProgramEvent {
                        channel: e.channel,
                        timestamp: e.timestamp,
                        program: program.as_int(),
                    })
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        let name = names[track_id]
            .take()
            .or_else(|| fallback_names[track_id].take());
        let has_notes = !translated.is_empty();
        tracks.push(MidiTrack {
            name,
            notes: translated.into(),
            events: track_events.into(),
            track_id,
            track_color_id: color,
            programs: programs.into(),
            has_drums: drums,
            has_other_than_drums: melodic,
        });
        if has_notes {
            color += 1;
        }
    }
    let program_track = program_track::ProgramTrack::new(&tracks);
    let measures = musical_time.bar_times(&tempo).into();
    let beats = musical_time.beat_times(&tempo).into();
    let duration = tempo.pulses_to_duration(last_tick);
    let source = Arc::new(Performance {
        content_id: content_id.clone(),
        ppq,
        last_tick,
        notes: notes.into(),
        events: events.into(),
        note_mapping: mapping.into(),
        warnings: warnings.into(),
        original_bytes: Arc::from(bytes),
    });
    check()?;
    let mut lyrics = if lyrics.is_empty() { kar_text } else { lyrics };
    lyrics.sort_by_key(|e| (e.0, e.1, e.2));
    let lyrics: Vec<MidiLyric> = lyrics
        .into_iter()
        .filter_map(|(tick, _, _, value)| {
            let text: String = decode(value, encoding)
                .chars()
                .map(|c| if c == '\r' { '\n' } else { c })
                .filter(|c| *c == '\n' || !c.is_control())
                .take(200)
                .collect();
            (!text.is_empty()).then_some(MidiLyric { tick, text })
        })
        .take(100_000)
        .collect();
    Ok(MidiFile {
        name,
        content_id,
        source_path: None,
        lyrics: lyrics.into(),
        markers: marker_set
            .into_iter()
            .map(|(tick, name)| MidiMarker { tick, name })
            .collect::<Vec<_>>()
            .into(),
        format: smf.header.format,
        key_signature:signatures.first().map(|e|(e.fifths,e.minor)),
        key_signatures:signatures.into(),
        tracks: tracks.into(),
        program_track,
        tempo_track: tempo,
        measures,
        beats,
        duration,
        musical_time,
        source,
    })
}
