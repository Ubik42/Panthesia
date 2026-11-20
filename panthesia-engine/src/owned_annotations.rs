//! Compatibility operations resolve metadata by musical content, never by a mutable source location.
use crate::{library, preferences::Preferences, song_repository::SongRepository};
use panthesia_core::{library as annotations, utils::atomic_file};
use std::path::{Path, PathBuf};
pub(crate) fn existing(data: &Path, path: &Path, cid: &str) -> PathBuf {
    let Ok(owned) = SongRepository::managed_path(data, cid) else {
        return path.into();
    };
    if atomic_file::is_file(&annotations::metadata_sidecar_path(&owned)) {
        owned
    } else {
        path.into()
    }
}
pub(crate) fn read(
    data: &Path,
    path: &Path,
    expected: Option<&str>,
) -> Result<(PathBuf, String), String> {
    let cid = match expected {
        Some(id) => id.to_owned(),
        None if !atomic_file::is_file(path) => crate::library_workspace::Workspace::load(data)?
            .entries
            .get(&crate::library_workspace::key(path))
            .and_then(|entry| entry.content_id.clone())
            .ok_or("曲目位置未登记，无法按内容恢复资料")?,
        None => library::read_midi(path)?.content_id,
    };
    let owned = existing(data, path, &cid);
    if owned != path {
        return Ok((owned, cid));
    }
    let resolved = SongRepository::open(data)?.resolve(path, Some(&cid))?;
    Ok((existing(data, &resolved, &cid), cid))
}
pub(crate) fn retain(
    data: &Path,
    path: &Path,
    cid: &str,
    check: &impl Fn() -> Result<(), String>,
) -> Result<PathBuf, String> {
    check()?;
    let mut repository = SongRepository::open(data)?;
    let source = repository.resolve(path, Some(cid))?;
    let preferences = Preferences::load(&data.join("web-preferences.json"))?;
    let title = source.file_stem().unwrap_or_default().to_string_lossy();
    repository.retain_with_parts(
        &source,
        cid,
        &title,
        "",
        preferences.songs.get(cid).map(|s| &s.parts),
        check,
    )
}
pub(crate) fn relink(
    data: &Path,
    original: &Path,
    destination: &Path,
    cid: &str,
    check: &impl Fn() -> Result<(), String>,
) -> Result<PathBuf, String> {
    retain_from(data, original, destination, cid, None, check)
}
pub(crate) fn retain_from(
    data: &Path,
    original: &Path,
    destination: &Path,
    cid: &str,
    title: Option<&str>,
    check: &impl Fn() -> Result<(), String>,
) -> Result<PathBuf, String> {
    check()?;
    let mut repository = SongRepository::open(data)?;
    let file = library::read_midi(destination)?;
    if file.content_id != cid {
        return Err("新位置内容与原曲目不同".into());
    }
    let origin = match annotations::load_song_sidecar(destination, cid) {
        Ok(_) => destination,
        Err(annotations::MetadataError::Read(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            original
        }
        Err(e) => return Err(e.to_string()),
    };
    let preferences = Preferences::load(&data.join("web-preferences.json"))?;
    repository.retain_with_origin(
        destination,
        cid,
        title.filter(|v| !v.is_empty()).unwrap_or(
            &destination
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy(),
        ),
        "",
        preferences.songs.get(cid).map(|s| &s.parts),
        origin,
        check,
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    use panthesia_core::{
        library::{self, FingerHint, SongSidecar},
        practice::PracticePart,
    };
    fn root() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "panthesia-owned-compat-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn compatibility_edits_follow_content_and_preserve_legacy_history_source() {
        let root = root();
        let data = root.join("profile");
        let source = root.join("source.mid");
        std::fs::write(&source, include_bytes!("../assets/five-finger.mid")).unwrap();
        let cid = crate::library::read_midi(&source).unwrap().content_id;
        let mut old = SongSidecar::default();
        old.metadata.title = Some("Original".into());
        old.fingerings.push(FingerHint {
            track_id: 0,
            note_index: 0,
            finger: 4,
        });
        annotations::save_song_sidecar(&source, &cid, old.clone()).unwrap();
        let bytes = std::fs::read(annotations::metadata_sidecar_path(&source)).unwrap();
        let mut workspace = crate::library_workspace::Workspace::default();
        workspace.inspect(source.clone(), true).unwrap();
        workspace.save(&data).unwrap();
        let mut workspace = crate::library_workspace::Workspace::load(&data).unwrap();
        let mut edited = old.metadata.clone();
        edited.title = Some("Edited".into());
        let selected = data.clone();
        let (result, writes, observed) = atomic_file::capture_matching(
            std::sync::Arc::new(move |path: &Path| crate::asset_storage::captures(&selected, path)),
            || {
                crate::library_metadata::save(
                    &mut workspace,
                    &data,
                    source.clone(),
                    cid.clone(),
                    edited.clone(),
                    old.metadata,
                )
            },
        );
        let saved = result.unwrap();
        crate::asset_storage::commit(&data, writes, observed).unwrap();
        assert_eq!(saved["status"], "saved");
        assert_eq!(
            workspace.inspect(source.clone(), true).unwrap().metadata,
            edited
        );
        assert_eq!(
            std::fs::read(annotations::metadata_sidecar_path(&source)).unwrap(),
            bytes
        );
        assert_eq!(
            SongRepository::open(&data).unwrap().rows().unwrap()[0].title,
            "Edited"
        );
        std::fs::rename(&source, source.with_extension("moved")).unwrap();
        let view =
            crate::library_metadata::read(&mut workspace, &data, source.clone(), Some(cid.clone()))
                .unwrap();
        assert_eq!(view["value"]["title"], "Edited");
        assert_eq!(
            crate::library_metadata::read(&mut workspace, &data, source.clone(), None).unwrap()["value"]
                ["title"],
            "Edited"
        );
        let history =
            crate::library_metadata::history(&mut workspace, &data, source, cid.clone()).unwrap();
        assert_eq!(history["available"], true);
        assert_eq!(history["records"][0]["state"], "applied");
        let managed = SongRepository::managed_path(&data, &cid).unwrap();
        assert_eq!(
            annotations::load_song_sidecar(&managed, &cid)
                .unwrap()
                .fingerings[0]
                .finger,
            4
        );
    }
    #[test]
    fn relinking_uses_owned_annotations_without_creating_a_new_external_sidecar() {
        let root = root();
        let data = root.join("profile");
        let original = root.join("old.mid");
        let destination = root.join("new.mid");
        std::fs::write(&original, include_bytes!("../assets/five-finger.mid")).unwrap();
        let cid = crate::library::read_midi(&original).unwrap().content_id;
        let mut old = SongSidecar::default();
        old.track_parts.insert(0, PracticePart::LeftHand);
        old.fingerings.push(FingerHint {
            track_id: 0,
            note_index: 0,
            finger: 4,
        });
        annotations::save_song_sidecar(&original, &cid, old).unwrap();
        let legacy = std::fs::read(annotations::metadata_sidecar_path(&original)).unwrap();
        std::fs::rename(&original, &destination).unwrap();
        let owned = relink(&data, &original, &destination, &cid, &|| Ok(())).unwrap();
        let doc = annotations::load_song_sidecar(&owned, &cid).unwrap();
        assert_eq!(doc.track_parts[&0], PracticePart::LeftHand);
        assert_eq!(doc.fingerings[0].finger, 4);
        assert!(!annotations::metadata_sidecar_path(&destination).exists());
        assert_eq!(
            std::fs::read(annotations::metadata_sidecar_path(&original)).unwrap(),
            legacy
        );
    }
}
