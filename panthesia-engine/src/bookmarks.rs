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
    
    
}
