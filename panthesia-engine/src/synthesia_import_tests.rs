use super::*;
use panthesia_core::utils::atomic_file;
use std::sync::Arc;
fn root() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "neothesia-synthesia-import-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    root
}
fn commit(
    data: &Path,
    source: Vec<u8>,
    paths: Vec<PathBuf>,
    options: ImportOptions,
    expected: String,
) -> Result<serde_json::Value, String> {
    let selected = data.to_path_buf();
    let (result, writes, observed) = atomic_file::capture_matching(
        Arc::new(move |path| crate::asset_storage::captures(&selected, path)),
        || apply(data, source, paths, options, expected, &|| Ok(())),
    );
    let result = result?;
    crate::asset_storage::commit(data, writes, observed)?;
    Ok(result)
}
#[test]
fn content_bound_import_preserves_personal_data_and_commits_source_history_and_groups() {
    let data = root();
    let path = data.join("song.mid");
    let midi = include_bytes!("../assets/five-finger.mid");
    std::fs::write(&path, midi).unwrap();
    let cid = blake3::hash(midi).to_hex().to_string();
    let mut sidecar = SongSidecar::default();
    sidecar.metadata.title = Some("个人曲名".into());
    sidecar.fingerings.push(FingerHint {
        track_id: 0,
        note_index: 0,
        finger: 5,
    });
    library::save_song_sidecar(&path, &cid, sidecar.clone()).unwrap();
    let id = format::music_identity(midi);
    let xml=format!(r#"<SynthesiaMetadata Version="1"><Songs><Song UniqueId="{id}" Title="来源曲名" Composer="原作者" Arranger="练习作者" FingerHints="t0:6" Future="保留"/></Songs><Groups><Group Name="课程"><Group Name="第一册"><Song UniqueId="{id}"/></Group></Group></Groups></SynthesiaMetadata>"#).into_bytes();
    let paths = vec![path.clone()];
    let options = ImportOptions {
        fingers: true,
        hands: true,
        groups: true,
        overwrite: false,
    };
    let checked = preview(&data, xml.clone(), paths.clone(), options.clone(), &|| {
        Ok(())
    })
    .unwrap();
    assert_eq!(checked["matched"], 1);
    let proof = checked["proof"].as_str().unwrap().to_owned();
    let result = commit(
        &data,
        xml.clone(),
        paths.clone(),
        options.clone(),
        proof.clone(),
    )
    .unwrap();
    let saved = library::load_song_sidecar(&path, &cid).unwrap();
    assert_eq!(saved.metadata.title, sidecar.metadata.title);
    assert_eq!(saved.metadata.arranger.as_deref(), Some("练习作者"));
    assert_eq!(saved.fingerings[0].finger, 5);
    assert_eq!(
        std::fs::read(result["sourcePath"].as_str().unwrap()).unwrap(),
        xml
    );
    assert_eq!(std::fs::read(&path).unwrap(), midi);
    let workspace = Workspace::load(&data).unwrap();
    assert_eq!(workspace.groups.len(), 2);
    assert_eq!(workspace.entries[&key(&path)].groups.len(), 1);
    assert_eq!(
        commit(
            &data,
            xml.clone(),
            paths.clone(),
            options.clone(),
            proof.clone()
        )
        .unwrap(),
        result
    );
    let other = xml.iter().copied().chain(b" ".iter().copied()).collect();
    assert!(commit(&data, other, paths.clone(), options.clone(), proof).is_err());
    let checked = preview(&data, xml.clone(), paths.clone(), options.clone(), &|| {
        Ok(())
    })
    .unwrap();
    let mut edited = saved;
    let mut personal = edited.metadata.clone();
    personal.notes = Some("预览之后的编辑".into());
    edited.set_personal_metadata(personal);
    library::save_song_sidecar(&path, &cid, edited.clone()).unwrap();
    assert!(
        commit(
            &data,
            xml,
            paths,
            options,
            checked["proof"].as_str().unwrap().into()
        )
        .is_err()
    );
    assert_eq!(library::load_song_sidecar(&path, &cid).unwrap(), edited);
}
#[test]
fn background_and_discard_import_as_independent_playback_rules() {
    use panthesia_core::song_config::{SongConfig, PlayerConfig};
    let data = root();
    let path = data.join("song.mid");
    let midi = include_bytes!("../assets/five-finger.mid");
    std::fs::write(&path, midi).unwrap();
    let file = panthesia_music::MidiFile::new(&path).unwrap();
    let id = format::music_identity(midi);
    let xml = format!(r#"<SynthesiaMetadata Version="1"><Songs><Song UniqueId="{id}" Parts="RBX"/></Songs></SynthesiaMetadata>"#).into_bytes();
    let options = ImportOptions { overwrite: false, fingers: false, hands: true, groups: false };
    let checked = preview(&data, xml.clone(), vec![path.clone()], options.clone(), &||Ok(())).unwrap();
    assert_eq!(checked["rows"][0]["blocked"], false);
    commit(&data, xml, vec![path.clone()], options, checked["proof"].as_str().unwrap().into()).unwrap();
    let owned = crate::owned_annotations::existing(&data, &path, &file.content_id);
    let saved = library::load_song_sidecar(&owned, &file.content_id).unwrap();
    let mut config = SongConfig::new(&file.tracks);
    config.set_note_playback_rules(&saved.note_playback, &file).unwrap();
    let track = file.tracks.iter().find(|t| !t.notes.is_empty()).unwrap();
    for (index, note) in track.notes.iter().enumerate() {
        assert_eq!(config.player_for(track.track_id, index), match note.source_index {
            0 => PlayerConfig::Human, 2 => PlayerConfig::Mute, _ => PlayerConfig::Auto,
        });
    }
    assert_eq!(std::fs::read(path).unwrap(), midi);
}
