use super::*;
use crate::library::FingerHint;
fn fixture() -> (PathBuf, midi_file::MidiFile) {
    use midi_file::midly::{
        Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind,
    };
    let events = [
        (0, Some((true, 60))),
        (0, Some((true, 62))),
        (10, Some((false, 62))),
        (10, Some((false, 60))),
        (0, Some((true, 64))),
        (10, None),
    ]
    .into_iter()
    .map(|(delta, note)| TrackEvent {
        delta: delta.into(),
        kind: match note {
            Some((on, key)) => TrackEventKind::Midi {
                channel: 0.into(),
                message: if on {
                    MidiMessage::NoteOn {
                        key: key.into(),
                        vel: 90.into(),
                    }
                } else {
                    MidiMessage::NoteOff {
                        key: key.into(),
                        vel: 0.into(),
                    }
                },
            },
            None => TrackEventKind::Meta(MetaMessage::EndOfTrack),
        },
    })
    .collect();
    let smf = Smf {
        header: Header::new(Format::SingleTrack, Timing::Metrical(480.into())),
        tracks: vec![events],
    };
    let mut bytes = vec![];
    smf.write_std(&mut bytes).unwrap();
    let cid = blake3::hash(&bytes).to_hex().to_string();
    let root = std::env::temp_dir().join(format!(
        "panthesia-note-binding-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let path = root.join("library/assets/midi").join(format!("{cid}.mid"));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, &bytes).unwrap();
    let file = midi_file::MidiFile::from_path_bytes(&path, &bytes).unwrap();
    (path, file)
}
#[test]
fn legacy_binding_preserves_unknown_rows_and_survives_subsequent_saves() {
    let (midi, file) = fixture();
    let path = document_path(&midi).unwrap();
    let cid = &file.content_id;
    let mut sidecar = SongSidecar::default();
    sidecar.fingerings = vec![
        FingerHint {
            track_id: 0,
            note_index: 0,
            finger: 3,
        },
        FingerHint {
            track_id: 0,
            note_index: 2,
            finger: 4,
        },
    ];
    write(&path, cid, sidecar, &midi).unwrap();
    let original = std::fs::read(&path).unwrap();
    // The new decoder recovers index 2; the old reader never had that note.
    assert_eq!(file.tracks[0].notes.len(), 3);
    assert_eq!(read(&path, cid, &midi).unwrap().fingerings.len(), 1);
    let (result, writes, observations) =
        atomic_file::capture_matching(std::sync::Arc::new(|_| true), || {
            bind(&midi, cid, &file.source)
        });
    result.unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original);
    for observed in observations {
        assert_eq!(
            std::fs::read(&observed.path)
                .ok()
                .map(|v| blake3::hash(&v).to_hex().to_string()),
            observed.before
        );
    }
    assert_eq!(writes.len(), 2);
    for write in writes {
        let pending = write.materialize().unwrap();
        atomic_file::write(&pending.path, &pending.bytes).unwrap();
    }
    let (doc, _) = decode(&path, cid).unwrap();
    assert_eq!(doc.version, 2);
    assert_eq!(doc.unmapped.len(), 1);
    assert_eq!(doc.unmapped[0].value["note_index"], 2);
    assert_eq!(doc.note_identity.unwrap().tracks[&0][&0], 1);
    let archive = path
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("legacy-inputs")
        .join(format!(
            "annotations-{}.json",
            blake3::hash(&original).to_hex()
        ));
    assert_eq!(std::fs::read(archive).unwrap(), original);
    let mut saved = read(&path, cid, &midi).unwrap();
    saved.fingerings.push(FingerHint {
        track_id: 0,
        note_index: 2,
        finger: 5,
    });
    write(&path, cid, saved, &midi).unwrap();
    bind(&midi, cid, &file.source).unwrap();
    let (doc, _) = decode(&path, cid).unwrap();
    assert_eq!(doc.unmapped.len(), 1);
    assert_eq!(doc.annotations.fingerings.len(), 2);
    assert_eq!(doc.note_identity.unwrap().tracks[&0][&2], 2);
}
#[test]
fn persisted_onset_identity_follows_a_changed_view_order() {
    let (midi, file) = fixture();
    let path = document_path(&midi).unwrap();
    let cid = &file.content_id;
    let mut sidecar = SongSidecar::default();
    sidecar.fingerings = vec![FingerHint {
        track_id: 0,
        note_index: 0,
        finger: 3,
    }];
    write(&path, cid, sidecar, &midi).unwrap();
    bind(&midi, cid, &file.source).unwrap();
    let (mut doc, _) = decode(&path, cid).unwrap();
    let mut source = (*file.source).clone();
    let mut mapping = source.note_mapping.to_vec();
    mapping[0].compatibility_index = 1;
    mapping[1].compatibility_index = 0;
    source.note_mapping = mapping.into();
    project(&mut doc, &source).unwrap();
    assert_eq!(doc.annotations.fingerings[0].note_index, 1);
    assert_eq!(doc.note_identity.unwrap().tracks[&0][&1], 1);
}
