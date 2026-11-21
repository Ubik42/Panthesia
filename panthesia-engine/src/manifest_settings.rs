//! Per-song practice data kept in preferences (passages, bookmarks, track look and sound,
//! practice variant, fingering profiles, practice settings) stored in the `.panthesia`
//! manifest of songs that live at their own location (current-plan 3.7).
//!
//! On load the manifest replaces the preference entries of the song; after every preference
//! save, changes go back to the manifest. Song data creates the manifest on its first change;
//! practice settings (mode, count-in …) alone are written only to an existing manifest.
use crate::Player;
use crate::manifest_store;
use panthesia_core::manifest::{Layer, Manifest, Origin, Provenance};
use serde_json::{Map, Value, json};
use std::path::{Path, PathBuf};

/// Preference entries of one song, as manifest JSON.
#[derive(Clone, Default, PartialEq)]
pub(crate) struct Projection {
    passages: Option<Value>,
    bookmarks: Option<Value>,
    tracks: Map<String, Value>,
    variant: Option<Value>,
    fingering_profiles: Option<Value>,
    practice: Option<Value>,
}
impl Projection {
    fn has_song_data(&self) -> bool {
        self.passages.is_some()
            || self.bookmarks.is_some()
            || !self.tracks.is_empty()
            || self.variant.is_some()
            || self.fingering_profiles.is_some()
    }
}

fn non_empty(value: Value) -> Option<Value> {
    match &value {
        Value::Null => None,
        Value::Array(a) if a.is_empty() => None,
        Value::Object(o) if o.is_empty() => None,
        _ => Some(value),
    }
}
fn is_music_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ["mid", "midi", "kar"].contains(&e.to_ascii_lowercase().as_str()))
}

impl Player {
    /// The song file and content id when the current song lives at its own location: a MIDI
    /// file outside the central library that is not a generated exercise.
    pub(crate) fn manifest_song(&self) -> Option<(PathBuf, String)> {
        let file = self.file.as_ref()?;
        let path = file.source_path.as_ref()?;
        if self.exercise.is_some()
            || !is_music_file(path)
            || panthesia_core::song_annotations::document_path(path).is_some()
        {
            return None;
        }
        Some((path.clone(), file.content_id.clone()))
    }

    fn settings_projection(&self, cid: &str) -> Projection {
        let p = &self.preferences;
        let mut tracks = Map::new();
        if let Some(rows) = p.track_appearances.get(cid) {
            for (track, appearance) in rows {
                if let Ok(Value::Object(fields)) = serde_json::to_value(appearance) {
                    let entry = tracks.entry(track.to_string()).or_insert_with(|| json!({}));
                    for (key, value) in fields.into_iter().filter(|(_, v)| !v.is_null()) {
                        entry[key] = value;
                    }
                }
            }
        }
        if let Some(rows) = p.track_sounds.get(cid) {
            for (track, sound) in rows {
                if let Ok(value) = serde_json::to_value(sound) {
                    tracks.entry(track.to_string()).or_insert_with(|| json!({}))["sound"] = value;
                }
            }
        }
        let json = |value: Option<Value>| value.and_then(non_empty);
        Projection {
            passages: json(p.passages.get(cid).and_then(|v| serde_json::to_value(v).ok())),
            bookmarks: json(p.bookmarks.get(cid).and_then(|v| serde_json::to_value(v).ok())),
            tracks,
            variant: json(p.variants.get(cid).and_then(|v| serde_json::to_value(v).ok())),
            fingering_profiles: json(p.fingering_profiles.get(cid).and_then(|v| serde_json::to_value(v).ok())),
            practice: json(p.songs.get(cid).and_then(|v| serde_json::to_value(v).ok())),
        }
    }

    /// Replace this song's preference entries with the manifest's. Called before the song's
    /// settings are restored. Without a manifest the preferences stay as they are.
    pub(crate) fn apply_manifest_settings(&mut self, path: &Path, cid: &str) {
        self.manifest_settings = None;
        let found = match manifest_store::locate(path) {
            Ok(Some(found)) => found,
            // No manifest: nothing to apply. The next sync compares against the (absent)
            // manifest itself, so song data already in the preferences creates it.
            Ok(None) => return,
            Err(error) => {
                self.state.error = Some(error);
                return;
            }
        };
        let Some(performance) = manifest_store::performance_of(&found, path) else { return };
        let m = &found.manifest;
        let items = |name: &str| m.layer_for(name, &performance).and_then(|l| l.body.get("items")).cloned();
        let empty = Map::new();
        let settings = m.settings_for(&performance).unwrap_or(&empty);
        let mut errors = Vec::new();
        macro_rules! restore {
            ($field:ident, $value:expr, $label:literal) => {
                match $value.map(serde_json::from_value) {
                    Some(Ok(value)) => {
                        self.preferences.$field.insert(cid.into(), value);
                    }
                    Some(Err(e)) => errors.push(format!("{}：{e}", $label)),
                    None => {
                        self.preferences.$field.remove(cid);
                    }
                }
            };
        }
        restore!(passages, items("passages"), "练习段");
        restore!(bookmarks, items("bookmarks"), "书签");
        restore!(variants, settings.get("variant").cloned(), "变调与量化");
        restore!(fingering_profiles, settings.get("fingeringProfiles").cloned(), "指法手型");
        if let Some(practice) = settings.get("practice").cloned() {
            match serde_json::from_value(practice) {
                Ok(value) => {
                    self.preferences.songs.insert(cid.into(), value);
                }
                Err(e) => errors.push(format!("练习设置：{e}")),
            }
        }
        let mut appearances = std::collections::BTreeMap::new();
        let mut sounds = std::collections::BTreeMap::new();
        if let Some(Value::Object(tracks)) = settings.get("tracks") {
            for (track, entry) in tracks {
                let Ok(track) = track.parse::<usize>() else { continue };
                let mut entry = entry.clone();
                if let Some(sound) = entry.as_object_mut().and_then(|o| o.remove("sound")) {
                    match serde_json::from_value(sound) {
                        Ok(sound) => {
                            sounds.insert(track, sound);
                        }
                        Err(e) => errors.push(format!("轨道 {track} 音色：{e}")),
                    }
                }
                if entry.as_object().is_some_and(|o| !o.is_empty()) {
                    match serde_json::from_value(entry) {
                        Ok(appearance) => {
                            appearances.insert(track, appearance);
                        }
                        Err(e) => errors.push(format!("轨道 {track} 外观：{e}")),
                    }
                }
            }
        }
        if appearances.is_empty() {
            self.preferences.track_appearances.remove(cid);
        } else {
            self.preferences.track_appearances.insert(cid.into(), appearances);
        }
        if sounds.is_empty() {
            self.preferences.track_sounds.remove(cid);
        } else {
            self.preferences.track_sounds.insert(cid.into(), sounds);
        }
        if !errors.is_empty() {
            self.state.error = Some(format!("歌曲清单中的部分设置无法读取：{}", errors.join("；")));
        }
        self.manifest_settings = Some((cid.into(), self.settings_projection(cid)));
    }

    /// Write changed preference entries of the current song back to its manifest.
    pub(crate) fn sync_manifest_settings(&mut self) {
        let Some((path, cid)) = self.manifest_song() else { return };
        let next = self.settings_projection(&cid);
        // Without a cached state (e.g. after a switch prepared elsewhere) the manifest itself is
        // the comparison: the edit below writes only when its content changes.
        if self.manifest_settings.as_ref().is_some_and(|(id, last)| id == &cid && last == &next) {
            return;
        }
        let create = next.has_song_data();
        let result = manifest_store::edit(&path, create, |manifest, performance, _| {
            let before = manifest.clone();
            write_projection(manifest, performance, &next);
            Ok(((), *manifest != before))
        });
        match result {
            Ok(_) => self.manifest_settings = Some((cid, next)),
            Err(error) => self.settings_save_error = Some(format!("歌曲清单保存失败：{error}")),
        }
    }
}

fn put_items(manifest: &mut Manifest, name: &str, performance: &str, items: Option<&Value>) {
    let key = manifest.layer_key(name, performance);
    match items {
        Some(items) => {
            let default = manifest.default.performance.clone();
            let layer = manifest.layers.entry(key).or_insert_with(Layer::default);
            if layer.body.get("items") != Some(items) {
                layer.body.insert("items".into(), items.clone());
                layer.provenance = Some(Provenance::new(Origin::Human, None));
            }
            if performance != default {
                layer.performance = Some(performance.into());
            }
        }
        None => {
            manifest.layers.remove(&key);
        }
    }
}
fn write_projection(manifest: &mut Manifest, performance: &str, p: &Projection) {
    put_items(manifest, "passages", performance, p.passages.as_ref());
    put_items(manifest, "bookmarks", performance, p.bookmarks.as_ref());
    let tracks = (!p.tracks.is_empty()).then(|| Value::Object(p.tracks.clone()));
    let settings = manifest.settings_for_mut(performance);
    for (key, value) in [
        ("variant", p.variant.as_ref()),
        ("fingeringProfiles", p.fingering_profiles.as_ref()),
        ("practice", p.practice.as_ref()),
        ("tracks", tracks.as_ref()),
    ] {
        match value {
            Some(value) => {
                settings.insert(key.into(), value.clone());
            }
            None => {
                settings.remove(key);
            }
        }
    }
    manifest.prune_settings();
}
