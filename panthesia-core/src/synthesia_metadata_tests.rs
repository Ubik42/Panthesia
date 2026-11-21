use super::*;
use panthesia_music::midly::{Format, Header, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind};

fn midi() -> Vec<u8> {
    let event = |delta, message| TrackEvent {
        delta: panthesia_music::midly::num::u28::new(delta),
        kind: TrackEventKind::Midi {
            channel: 0.into(),
            message,
        },
    };
    let file = Smf {
        header: Header::new(Format::SingleTrack, Timing::Metrical(480.into())),
        tracks: vec![vec![
            event(
                0,
                MidiMessage::NoteOn {
                    key: 60.into(),
                    vel: 90.into(),
                },
            ),
            event(
                0,
                MidiMessage::NoteOn {
                    key: 64.into(),
                    vel: 80.into(),
                },
            ),
            event(
                120,
                MidiMessage::NoteOff {
                    key: 64.into(),
                    vel: 0.into(),
                },
            ),
            event(
                360,
                MidiMessage::NoteOff {
                    key: 60.into(),
                    vel: 0.into(),
                },
            ),
        ]],
    };
    let mut bytes = vec![];
    file.write_std(&mut bytes).unwrap();
    bytes
}
#[test]
fn original_note_on_order_survives_reverse_note_offs_and_substitution_chains() {
    let bytes = midi();
    let id = music_identity(&bytes);
    let source = format!(
        r#"<SynthesiaMetadata Version="1"><Songs><Song UniqueId="{id}" Title="A &amp; B" FingerHints="t0: 1s2 6" Parts="t0:RA m1:L1 -" Future="原值"/></Songs><Groups><Group Name="课程"><Group Name="第一册"><Song UniqueId="{id}"/></Group></Group></Groups></SynthesiaMetadata>"#
    );
    let parsed = parse(source.as_bytes()).unwrap();
    let song = &parsed.songs[0];
    assert_eq!(song.metadata().unwrap().title.as_deref(), Some("A & B"));
    assert_eq!(song.attributes["Future"], "原值");
    assert_eq!(parsed.groups[1].path, ["课程", "第一册"]);
    let file = panthesia_music::MidiFile::from_path_bytes("study.mid", &bytes).unwrap();
    assert_eq!(file.tracks[0].notes[0].note, 64);
    let values = annotations(song, &bytes, &file).unwrap();
    let first = values
        .fingers
        .iter()
        .find(|f| file.tracks[f.track].notes[f.index].note == 60)
        .unwrap();
    assert_eq!(
        first
            .steps
            .iter()
            .map(|step| step.finger)
            .collect::<Vec<_>>(),
        [1, 2]
    );
    assert_eq!(first.steps[0].hand, Hand::Left);
    let other = values
        .fingers
        .iter()
        .find(|f| file.tracks[f.track].notes[f.index].note == 64)
        .unwrap();
    assert_eq!(other.steps[0].hand, Hand::Right);
    assert_eq!(
        values
            .parts
            .iter()
            .find(|p| file.tracks[p.track].notes[p.index].note == 60)
            .unwrap()
            .hand,
        Hand::Left
    );
    let cross = Song {
        unique_id: id,
        attributes: BTreeMap::from([("FingerHints".into(), "1s6".into())]),
    };
    let cross = annotations(&cross, &bytes, &file).unwrap();
    assert_eq!(cross.fingers[0].steps[1].hand, Hand::Right);
    assert_eq!(music_identity(b"abc"), "kAFQmDzST7DWlj99KOF/cg==");
}
#[test]
fn xml_and_instruction_failures_are_reported_before_storage() {
    assert!(
        parse(b"<!DOCTYPE x [<!ENTITY a SYSTEM 'file:///test'>]><SynthesiaMetadata Version='1'/>")
            .is_err()
    );
    assert!(parse(b"<SynthesiaMetadata Version='2'/>").is_err());
    assert!(parse(b"<SynthesiaMetadata Version='1'><Songs><Song UniqueId='bad'/></Songs></SynthesiaMetadata>").is_err());
    let bytes = midi();
    let id = music_identity(&bytes);
    let file = panthesia_music::MidiFile::from_path_bytes("study.mid", &bytes).unwrap();
    for instruction in [
        "t99:LA",
        "L999999999999999999999999999999",
        "m0:LA",
        "L3",
        "L 2",
    ] {
        let song = Song {
            unique_id: id.clone(),
            attributes: BTreeMap::from([("Parts".into(), instruction.into())]),
        };
        assert!(annotations(&song, &bytes, &file).is_err(), "{instruction}");
    }
    let song = Song {
        unique_id: id,
        attributes: BTreeMap::from([("Parts".into(), "LA m1:-X".into())]),
    };
    let result = annotations(&song, &bytes, &file).unwrap();
    assert_eq!(
        result
            .parts
            .iter()
            .filter(|p| p.hand == Hand::Discard)
            .count(),
        1
    );
}
