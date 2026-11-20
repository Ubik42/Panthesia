//! Storage migration checks use bundled fixtures and isolated profiles only.
use crate::*;
use panthesia_core::{
    library::{self, FingerHint, ScoreAssociation, SongSidecar},
    practice::PracticePart,
};
fn root() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "panthesia-unified-assets-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&path).unwrap();
    path
}
const MIDI: &[u8] = include_bytes!("../assets/five-finger.mid");
const XML: &[u8] = include_bytes!("../assets/starter-pack/five-finger.musicxml");
#[test]
fn owned_notation_survives_source_loss_and_preserves_changed_asset() {
    let data = root();
    let source = data.join("source.mid");
    let xml = data.join("original.musicxml");
    std::fs::write(&source, MIDI).unwrap();
    std::fs::write(&xml, XML).unwrap();
    let cid = blake3::hash(MIDI).to_hex().to_string();
    let hash = blake3::hash(XML).to_hex().to_string();
    let mut sidecar = SongSidecar::default();
    sidecar.score = Some(ScoreAssociation {
        path: xml.clone(),
        content_id: hash.clone(),
    });
    library::save_song_sidecar(&source, &cid, sidecar).unwrap();
    let owned = song_repository::SongRepository::open(&data)
        .unwrap()
        .retain(&source, &cid, "Fixture", "", &|| Ok(()))
        .unwrap();
    let mut workspace=crate::library_workspace::Workspace::default();
    workspace.inspect(source.clone(),true).unwrap();workspace.save(&data).unwrap();
    assert_eq!(crate::library::verified_file(&data,&cid,[source.clone()]).unwrap().source_path.as_ref(),Some(&owned));
    let mut versions = vec![];
    notation_assets::retain_editions(&data, &cid, &owned, &mut versions).unwrap();
    assert_eq!(versions.len(), 1);
    let asset = versions[0].path.clone();
    assert!(asset.starts_with(data.join("library/assets/notation")));
    std::fs::rename(&xml, xml.with_extension("moved")).unwrap();
    std::fs::rename(&source, source.with_extension("moved")).unwrap();
    let file = crate::library::read_midi(&owned).unwrap();
    let prepared = load_pipeline::Assets::read(&file, &owned, &versions);
    assert!(prepared.notation.is_some(), "{:?}", prepared.error);
    std::fs::write(&asset, b"changed user bytes").unwrap();
    let restored = notation_assets::retain(&data, XML).unwrap();
    assert_ne!(restored, asset);
    assert_eq!(std::fs::read(&asset).unwrap(), b"changed user bytes");
    notation_assets::retain_editions(&data, &cid, &owned, &mut versions).unwrap();
    assert_eq!(versions[0].path, restored);
    assert_eq!(
        library::load_song_sidecar(&owned, &cid)
            .unwrap()
            .score
            .unwrap()
            .path,
        restored
    );
}
#[test]
fn panthesia_package_roundtrip_keeps_raw_midi_transform_and_owned_annotations() {
    let data = root();
    let source = data.join("source.mid");
    std::fs::write(&source, MIDI).unwrap();
    let cid = blake3::hash(MIDI).to_hex().to_string();
    let track = crate::library::read_midi(&source)
        .unwrap()
        .tracks
        .iter()
        .find(|t| !t.notes.is_empty())
        .unwrap()
        .track_id;
    let mut sidecar = SongSidecar::default();
    sidecar.track_parts.insert(track, PracticePart::LeftHand);
    sidecar.fingerings.push(FingerHint {
        track_id: track,
        note_index: 0,
        finger: 4,
    });
    let xml = notation_assets::retain(&data, XML).unwrap();
    sidecar.score = Some(ScoreAssociation {
        path: xml,
        content_id: blake3::hash(XML).to_hex().to_string(),
    });
    library::save_song_sidecar(&source, &cid, sidecar).unwrap();
    let owned = song_repository::SongRepository::open(&data)
        .unwrap()
        .retain(&source, &cid, "Fixture", "", &|| Ok(()))
        .unwrap();
    let mut player = Player::new(data.clone(), PathBuf::new(), true);
    player.retain_notation_assets(&cid, &owned).unwrap();
    player
        .command(Command::Load {
            path: owned,
            title: "Fixture".into(),
        })
        .unwrap();
    let transform = practice_variant::Variant {
        transpose: 2,
        quantize: 16,
        ..Default::default()
    };
    player
        .set_variant(&cid, player.score_revision, transform.clone())
        .unwrap();
    let (bytes, _) = player.prepare_piece_package().unwrap();
    let archive = piece_package::Package::decode(&bytes).unwrap();
    assert_eq!(archive.manifest.version, 19);
    assert_eq!(archive.manifest.format, "panthesia-piece");
    assert_eq!(archive.manifest.practice_variant, transform);
    assert_eq!(archive.files["performance.mid"], MIDI);
    assert_eq!(archive.manifest.scores.len(), 1);
    let target = root();
    let mut restored = Player::new(target.clone(), PathBuf::new(), true);
    restored
        .import_piece_package(bytes, "replace".into())
        .unwrap();
    assert_eq!(restored.variant(), transform);
    let managed = restored
        .source_file
        .as_ref()
        .unwrap()
        .source_path
        .as_ref()
        .unwrap();
    assert!(managed.starts_with(target.join("library/assets/midi")));
    assert_eq!(std::fs::read(managed).unwrap(), MIDI);
    let doc = library::load_song_sidecar(managed, &cid).unwrap();
    assert_eq!(doc.track_parts[&track], PracticePart::LeftHand);
    assert_eq!(doc.fingerings[0].finger, 4);
    assert!(
        doc.score
            .unwrap()
            .path
            .starts_with(target.join("library/assets/notation"))
    );
}
#[test]
fn builtins_and_generated_exercises_write_owned_json_preserving_legacy() {
    let data = root();
    let legacy = data.join("five-finger.mid");
    let changed = include_bytes!("../assets/bass-five-finger.mid");
    std::fs::write(&legacy, changed).unwrap();
    let rows = crate::library::builtin_rows(&data).unwrap();
    assert_eq!(rows.len(), 5);
    assert_eq!(std::fs::read(&legacy).unwrap(), changed);
    for row in rows {
        assert!(row.path.starts_with(data.join("library/assets/midi")));
        assert_eq!(
            library::metadata_sidecar_path(&row.path)
                .extension()
                .unwrap(),
            "json"
        );
        assert!(!library::legacy_metadata_sidecar_path(&row.path).exists());
    }
    let spec = panthesia_core::exercise::ExerciseSpec::default();
    let prepared = exercise_loading::prepare(spec).unwrap();
    let cid = prepared.file.content_id.clone();
    let canonical = exercise_assets::canonical_bytes(spec).unwrap();
    let raw = blake3::hash(&canonical).to_hex().to_string();
    let old = import_storage::store_with_identity(
        &data.join("song-assets"),
        &cid,
        &raw,
        &cid,
        &canonical,
    )
    .unwrap()
    .path;
    let mut annotations = SongSidecar::default();
    annotations.track_parts.insert(0, PracticePart::RightHand);
    library::save_song_sidecar(&old, &cid, annotations).unwrap();
    let snapshot = std::fs::read(library::metadata_sidecar_path(&old)).unwrap();
    let prepared = prepared
        .read_assets(&data, &[])
        .unwrap()
        .materialize_for_startup(&data, &mut vec![])
        .unwrap();
    prepared.check().unwrap();
    let owned = data
        .join("library/assets/exercises")
        .join(format!("{cid}.mid"));
    assert!(owned.exists());
    assert!(library::metadata_sidecar_path(&owned).is_file());
    assert!(!library::legacy_metadata_sidecar_path(&owned).exists());
    assert_eq!(
        std::fs::read(library::metadata_sidecar_path(&old)).unwrap(),
        snapshot
    );
}
