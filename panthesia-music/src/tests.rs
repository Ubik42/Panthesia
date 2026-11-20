use super::*;
use midly::{
    Header, MetaMessage, Timing, TrackEvent, TrackEventKind,
    num::{u4, u7, u15, u24, u28},
};
fn message(ch: u8, message: MidiMessage) -> TrackEventKind<'static> {
    TrackEventKind::Midi {
        channel: u4::from(ch),
        message,
    }
}
fn on(ch: u8, note: u8, vel: u8) -> TrackEventKind<'static> {
    message(
        ch,
        MidiMessage::NoteOn {
            key: u7::from(note),
            vel: u7::from(vel),
        },
    )
}
fn off(ch: u8, note: u8) -> TrackEventKind<'static> {
    message(
        ch,
        MidiMessage::NoteOff {
            key: u7::from(note),
            vel: u7::from(0),
        },
    )
}
fn cc(ch: u8, id: u8, value: u8) -> TrackEventKind<'static> {
    message(
        ch,
        MidiMessage::Controller {
            controller: u7::from(id),
            value: u7::from(value),
        },
    )
}
fn bytes(ppq: u16, tracks: Vec<Vec<(u32, TrackEventKind<'static>)>>) -> Vec<u8> {
    let tracks = tracks
        .into_iter()
        .map(|events| {
            let mut previous = 0;
            events
                .into_iter()
                .map(|(tick, kind)| {
                    let delta = tick - previous;
                    previous = tick;
                    TrackEvent {
                        delta: u28::from(delta),
                        kind,
                    }
                })
                .collect()
        })
        .collect();
    let smf = Smf {
        header: Header::new(Format::Parallel, Timing::Metrical(u15::from(ppq))),
        tracks,
    };
    let mut bytes = Vec::new();
    smf.write_std(&mut bytes).unwrap();
    bytes
}
#[test]
fn source_identity_survives_retrigger_pedal_and_cross_track_release() {
    let bytes = bytes(
        100,
        vec![
            vec![
                (0, on(0, 60, 80)),
                (5, on(1, 67, 90)),
                (10, on(0, 60, 90)),
                (12, on(0, 64, 70)),
                (14, off(0, 64)),
                (20, off(0, 60)),
                (30, off(0, 60)),
                (40, TrackEventKind::Meta(MetaMessage::EndOfTrack)),
            ],
            vec![(15, cc(0, 64, 127)), (35, cc(0, 64, 0))],
            vec![(25, off(1, 67))],
            vec![
                (0, on(15, 72, 90)),
                (5, on(15, 72, 0)),
                (10, on(9, 36, 80)),
                (20, off(9, 36)),
            ],
        ],
    );
    let file = MidiFile::from_path_bytes("fixture.mid", &bytes).unwrap();
    let source = &file.source;
    assert_eq!(file.content_id, blake3::hash(&bytes).to_hex().as_str());
    assert_eq!(source.original_bytes.as_ref(), bytes);
    let first = source.note(NoteId { track: 0, onset: 0 }).unwrap();
    assert_eq!(
        (
            first.start_tick,
            first.release_tick,
            first.sounding_end_tick
        ),
        (0, 20, 35)
    );
    let second = source.note(NoteId { track: 0, onset: 2 }).unwrap();
    assert_eq!(
        (
            second.start_tick,
            second.release_tick,
            second.sounding_end_tick
        ),
        (10, 30, 35)
    );
    assert_eq!(
        source.legacy_note_id(0, 1),
        Some(NoteId { track: 0, onset: 3 })
    );
    assert_eq!(file.note_id(0, 1), Some(NoteId { track: 0, onset: 3 }));
    assert_eq!(source.legacy_note_id(0, 3), None);
    let cross = source.note(NoteId { track: 0, onset: 1 }).unwrap();
    assert_eq!(cross.release_tick, 25);
    assert!(
        source
            .events
            .iter()
            .any(|e| e.track == 2 && e.voice == Some(cross.id))
    );
    assert!(
        file.tracks[0]
            .events
            .iter()
            .any(|e| e.channel == 1 && matches!(e.message, MidiMessage::NoteOff { .. }))
    );
    assert!(file.tracks[3].has_drums && file.tracks[3].has_other_than_drums);
    assert!(
        file.tracks[3]
            .events
            .iter()
            .any(|e| e.channel == 15 && matches!(e.message, MidiMessage::NoteOff { .. }))
    );
}
#[test]
fn clock_accumulates_fractional_ticks_and_meter_changes_without_bar_drift() {
    let data = bytes(
        3,
        vec![vec![
            (
                0,
                TrackEventKind::Meta(MetaMessage::Tempo(u24::from(500001))),
            ),
            (
                1,
                TrackEventKind::Meta(MetaMessage::Tempo(u24::from(500002))),
            ),
            (
                2,
                TrackEventKind::Meta(MetaMessage::Tempo(u24::from(500003))),
            ),
            (
                6,
                TrackEventKind::Meta(MetaMessage::TimeSignature(3, 3, 24, 8)),
            ),
            (20, TrackEventKind::Meta(MetaMessage::EndOfTrack)),
        ]],
    );
    let file = MidiFile::from_path_bytes("clock.mid", &data).unwrap();
    let time = &file.tempo_track;
    assert_eq!(time.pulses_to_duration(3), Duration::from_micros(500002));
    for tick in 0..20 {
        assert!(
            (time.seconds_to_pulses(time.pulses_to_duration(tick).as_secs_f64()) - tick as f64)
                .abs()
                < 0.000001
        );
    }
    assert_eq!(time.project_quarter_fraction(1, 2).unwrap().pulses, 2);
    assert!(!time.project_quarter_fraction(1, 2).unwrap().exact_to_pulse);
    assert!(time.project_quarter_fraction(1, 3).unwrap().exact_to_pulse);
    assert_eq!(
        file.musical_time
            .measures
            .iter()
            .map(|m| (m.start_tick, m.end_tick))
            .collect::<Vec<_>>(),
        vec![(0, 6), (6, 11), (11, 15), (15, 20)]
    );
    assert!(file.musical_time.measures[0].partial);
    let corrected = musical_time::MusicalTime::segmented_with_lengths(
        480,
        6000,
        240,
        &[(1, 4, 4, Some(0)), (3, 3, 4, Some(12))],
        &[(2, 960)],
    )
    .unwrap();
    assert_eq!(corrected.measures[0].display_number, 0);
    assert_eq!(corrected.measures[1].end_tick, 1200);
    assert_eq!(corrected.measures[2].display_number, 12);
}
#[test]
fn programs_and_channel_modes_follow_global_event_time() {
    let program = |ch, n| {
        message(
            ch,
            MidiMessage::ProgramChange {
                program: u7::from(n),
            },
        )
    };
    let data = bytes(
        100,
        vec![
            vec![(100, program(0, 5))],
            vec![
                (0, program(0, 10)),
                (10, program(1, 9)),
                (50, program(0, 20)),
            ],
            vec![
                (0, on(2, 60, 90)),
                (5, cc(2, 64, 127)),
                (10, cc(2, 123, 0)),
                (20, cc(2, 120, 0)),
                (30, TrackEventKind::Meta(MetaMessage::EndOfTrack)),
            ],
        ],
    );
    let file = MidiFile::from_path_bytes("program.mid", &data).unwrap();
    let state = file
        .program_track
        .program_for_timestamp(&file.tempo_track.pulses_to_duration(101));
    assert_eq!(state[&0], 5);
    assert_eq!(state[&1], 9);
    let note = file.source.note(NoteId { track: 2, onset: 0 }).unwrap();
    assert_eq!(note.release_tick, 10);
    assert_eq!(note.sounding_end_tick, 20);
}
#[test]
fn bundled_performances_keep_every_legacy_annotation_target() {
    for bytes in [
        include_bytes!("../../panthesia-engine/assets/five-finger.mid").as_slice(),
        include_bytes!("../../panthesia-engine/assets/parallel-five-finger.mid").as_slice(),
        include_bytes!("../../panthesia-engine/assets/c-major-scale.mid").as_slice(),
    ] {
        let old = midi_legacy::MidiFile::from_path_bytes("owned.mid", bytes).unwrap();
        let new = MidiFile::from_path_bytes("owned.mid", bytes).unwrap();
        assert_eq!(old.content_id, new.content_id);
        assert_eq!(old.tracks.len(), new.tracks.len());
        for (old, new_track) in old.tracks.iter().zip(new.tracks.iter()) {
            assert_eq!(old.notes.len(), new_track.notes.len());
            for (index, (a, b)) in old.notes.iter().zip(new_track.notes.iter()).enumerate() {
                assert_eq!(
                    (a.track_id, a.source_index, a.note, a.channel, a.velocity),
                    (b.track_id, b.source_index, b.note, b.channel, b.velocity)
                );
                assert_eq!(new.source.legacy_note_id(a.track_id, index), Some(b.id()));
                let drift = a.start.as_nanos().abs_diff(b.start.as_nanos());
                assert!(drift <= (new.tempo_track.events().len() as u128) * 1000);
            }
        }
    }
}
#[test]
fn unsupported_timebases_and_cancellation_return_explicit_errors() {
    let data = bytes(480, vec![vec![(0, on(0, 60, 80)), (100, off(0, 60))]]);
    let calls = std::cell::Cell::new(0);
    let check = || {
        calls.set(calls.get() + 1);
        if calls.get() >= 3 {
            Err("cancelled".into())
        } else {
            Ok(())
        }
    };
    assert_eq!(
        MidiFile::from_path_bytes_checked("cancel.mid", &data, &check).unwrap_err(),
        "cancelled"
    );
    let mut smpte = data;
    smpte[12] = 0xe7;
    smpte[13] = 40;
    assert!(
        MidiFile::from_path_bytes("smpte.mid", &smpte)
            .unwrap_err()
            .contains("SMPTE")
    );
}
