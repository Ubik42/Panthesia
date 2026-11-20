//! Bookmark catalogs use the existing saved-practice worker and durable preference merge.
use crate::*;
use panthesia_core::song_bookmarks::Bookmark;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkEntry {
    pub id: String,
    pub name: String,
    pub tick: u64,
    pub seconds: f64,
    pub midi: bool,
    pub available: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkCatalog {
    pub content_id: String,
    pub bookmarks: Vec<BookmarkEntry>,
    pub catalog_revision: String,
}
impl Player {
    pub(super) fn bookmark_catalog(&self, revision: String) -> Result<serde_json::Value, String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let mut rows: Vec<BookmarkEntry> = self
            .preferences
            .bookmarks
            .get(&file.content_id)
            .into_iter()
            .flatten()
            .map(|row| BookmarkEntry {
                id: row.id.clone(),
                name: row.name.clone(),
                tick: row.tick,
                seconds: file.tempo_track.pulses_to_duration(row.tick).as_secs_f64(),
                midi: false,
                available: true,
            })
            .collect();
        let source = self.source_file.as_deref().unwrap_or(file);
        for marker in source.markers.iter() {
            let id = format!(
                "midi-{}",
                blake3::hash(format!("{}:{}", marker.tick, marker.name).as_bytes()).to_hex()
            );
            rows.push(BookmarkEntry {
                id,
                name: marker.name.clone(),
                tick: marker.tick,
                seconds: file
                    .tempo_track
                    .pulses_to_duration(marker.tick)
                    .as_secs_f64(),
                midi: true,
                available: true,
            });
        }
        rows.sort_by(|a, b| (a.tick, a.midi, &a.id).cmp(&(b.tick, b.midi, &b.id)));
        for row in &mut rows {
            row.available = row.seconds <= self.state.duration + 0.000001;
        }
        serde_json::to_value(BookmarkCatalog {
            content_id: file.content_id.clone(),
            bookmarks: rows,
            catalog_revision: revision,
        })
        .map_err(|e| e.to_string())
    }
    pub(super) fn save_bookmark(
        &mut self,
        content: &str,
        id: Option<String>,
        name: String,
        tick: u64,
    ) -> Result<serde_json::Value, String> {
        self.score_content_guard(content)?;
        let source = self
            .source_file
            .as_deref()
            .or(self.file.as_deref())
            .ok_or("请先选择曲目")?;
        let limit = source
            .tempo_track
            .seconds_to_pulses(source.duration.as_secs_f64())
            .round() as u64;
        if tick > limit {
            return Err("书签超出原演奏范围".into());
        }
        let row = Bookmark {
            id: id.unwrap_or_else(|| {
                format!(
                    "bookmark-{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_nanos()
                )
            }),
            name: name.trim().into(),
            tick,
        };
        row.validate()?;
        let rows = self
            .preferences
            .bookmarks
            .entry(content.into())
            .or_default();
        if let Some(old) = rows.iter_mut().find(|old| old.id == row.id) {
            *old = row.clone();
        } else {
            if rows.len() >= 200 {
                return Err("每份演奏最多保存 200 个书签".into());
            }
            rows.push(row.clone());
        }
        self.persist()?;
        Ok(serde_json::json!({"id":row.id}))
    }
    pub(super) fn remove_bookmark(
        &mut self,
        content: &str,
        id: &str,
    ) -> Result<serde_json::Value, String> {
        self.score_content_guard(content)?;
        let rows = self
            .preferences
            .bookmarks
            .get_mut(content)
            .ok_or("书签已移除，请重新读取")?;
        let before = rows.len();
        rows.retain(|row| row.id != id);
        if before == rows.len() {
            return Err("书签已移除，请重新读取".into());
        }
        self.persist()?;
        Ok(serde_json::json!({"ok":true}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use midi_file::midly::{
        Format, Header, MetaMessage as M, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind as K,
    };
    #[test]
    fn bookmark_markers_transforms_and_portable_data_share_source_ticks() {
        let root = std::env::current_dir()
            .unwrap()
            .join("../work/bookmarks-unit")
            .join(format!(
                "{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        let root = std::path::absolute(root).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        let meta = |message| TrackEvent {
            delta: 0.into(),
            kind: K::Meta(message),
        };
        let note = |delta: u32, pitch: u8, on: bool| TrackEvent {
            delta: delta.into(),
            kind: K::Midi {
                channel: 0.into(),
                message: if on {
                    MidiMessage::NoteOn {
                        key: pitch.into(),
                        vel: 90.into(),
                    }
                } else {
                    MidiMessage::NoteOff {
                        key: pitch.into(),
                        vel: 0.into(),
                    }
                },
            },
        };
        let smf = Smf {
            header: Header::new(Format::Parallel, Timing::Metrical(480.into())),
            tracks: vec![
                vec![
                    meta(M::Marker("主题".as_bytes())),
                    note(0, 60, true),
                    note(480, 60, false),
                    meta(M::CuePoint("过门".as_bytes())),
                    note(0, 64, true),
                    note(480, 64, false),
                    meta(M::EndOfTrack),
                ],
                vec![meta(M::Marker("主题".as_bytes())), meta(M::EndOfTrack)],
            ],
        };
        let mut bytes = vec![];
        smf.write_std(&mut bytes).unwrap();
        let source = root.join("source.mid");
        std::fs::write(&source, &bytes).unwrap();
        let mut p = Player::new(root.join("data"), PathBuf::new(), true);
        p.command(Command::Load {
            path: source.clone(),
            title: "书签演奏".into(),
        })
        .unwrap();
        let cid = p.file.as_ref().unwrap().content_id.clone();
        assert_eq!(p.file.as_ref().unwrap().markers.len(), 2);
        let saved = p.save_bookmark(&cid, None, "个人位置".into(), 240).unwrap();
        let id = saved["id"].as_str().unwrap();
        assert!(
            p.save_bookmark("wrong", None, "其他演奏".into(), 0)
                .is_err()
        );
        assert!(p.save_bookmark(&cid, None, "越界".into(), 961).is_err());
        assert!(p.save_bookmark(&cid, None, "\n".into(), 0).is_err());
        p.set_variant(
            &cid,
            p.score_revision,
            crate::practice_variant::Variant {
                transpose: 5,
                quantize: 16,
                ..Default::default()
            },
        )
        .unwrap();
        let rows = p.bookmark_catalog("revision".into()).unwrap();
        assert_eq!(rows["bookmarks"].as_array().unwrap().len(), 3);
        assert_eq!(rows["bookmarks"][1]["tick"], 240);
        assert_eq!(rows["bookmarks"][1]["seconds"], 0.25);
        let backup: crate::practice_backup::Backup =
            serde_json::from_value(p.practice_backup_snapshot(&Default::default()).unwrap())
                .unwrap();
        assert_eq!(backup.version(), 22);
        assert_eq!(
            crate::practice_backup::Backup::decode(&backup.encode().unwrap())
                .unwrap()
                .bookmarks[&cid][0]
                .id,
            id
        );
        let package_bytes: Vec<u8> =
            serde_json::from_value(p.command(Command::ExportPackage).unwrap()["bytes"].clone())
                .unwrap();
        let mut package = crate::piece_package::Package::decode(&package_bytes).unwrap();
        assert_eq!(package.manifest.version, 18);
        assert_eq!(package.manifest.bookmarks[0].tick, 240);
        let mut target = Player::new(root.join("target"), PathBuf::new(), true);
        target
            .command(Command::ImportPackage {
                bytes: package_bytes,
                policy: "replace".into(),
            })
            .unwrap();
        assert_eq!(target.preferences.bookmarks[&cid][0].id, id);
        package.manifest.version=17;package.manifest.bookmarks.clear();
        target.command(Command::ImportPackage{bytes:package.encode().unwrap(),policy:"replace".into()}).unwrap();
        assert_eq!(target.preferences.bookmarks[&cid][0].id,id);
        p.remove_bookmark(&cid, id).unwrap();
        assert!(p.preferences.bookmarks[&cid].is_empty());
        assert_eq!(std::fs::read(source).unwrap(), bytes);
    }
}
