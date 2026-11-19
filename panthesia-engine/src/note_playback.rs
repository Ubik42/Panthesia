//! Per-note playback roles are independent of hand identity and track controls.
use crate::*;
use panthesia_core::{library, song_config::NotePlaybackRule};
use serde_json::Value;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackNote {
    pub index: usize,
    pub pitch: u8,
    pub start: f64,
    pub measure: usize,
    pub mode: Option<PlayerConfig>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackPage {
    pub track: usize,
    pub total: usize,
    pub offset: usize,
    pub revision: String,
    pub notes: Vec<PlaybackNote>,
}

pub(crate) fn reference_sounds(player: PlayerConfig, mode: &str) -> bool {
    player == PlayerConfig::Auto
        || (player == PlayerConfig::Human && matches!(mode, "listen" | "flow"))
}

impl Player {
    fn playback_sidecar(&self) -> Result<(PathBuf, library::SongSidecar), String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let path = self.annotation_path(file)?;
        let sidecar = if panthesia_core::utils::atomic_file::is_file(
            &library::metadata_sidecar_path(&path),
        ) {
            library::load_song_sidecar(&path, &file.content_id).map_err(|e| e.to_string())?
        } else {
            library::SongSidecar::default()
        };
        let mut saved = SongConfig::new(&file.tracks);
        saved.set_note_playback_rules(&sidecar.note_playback, file)?;
        if saved.note_players != self.config.note_players {
            return Err("文件中的逐音播放规则已改变，请重新打开曲目".into());
        }
        Ok((path, sidecar))
    }
    fn playback_revision(&self) -> Result<String, String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let bytes = serde_json::to_vec(&(
            &file.content_id,
            self.score_revision,
            self.config.note_playback_rules(),
        ))
        .map_err(|e| e.to_string())?;
        Ok(blake3::hash(&bytes).to_hex().to_string())
    }
    pub(super) fn read_note_playback(
        &self,
        track: usize,
        offset: usize,
        limit: usize,
    ) -> Result<Value, String> {
        self.playback_sidecar()?;
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let notes = &file
            .tracks
            .iter()
            .find(|t| t.track_id == track)
            .ok_or("音轨不存在")?
            .notes;
        let rows = notes
            .iter()
            .enumerate()
            .skip(offset)
            .take(limit.clamp(1, 200))
            .map(|(index, n)| PlaybackNote {
                index,
                pitch: n.note,
                start: n.start.as_secs_f64(),
                measure: file
                    .musical_time
                    .measures
                    .partition_point(|m| {
                        file.tempo_track.pulses_to_duration(m.start_tick) <= n.start
                    })
                    .max(1),
                mode: self.config.note_players.get(&(track, index)).copied(),
            })
            .collect();
        serde_json::to_value(PlaybackPage {
            track,
            offset,
            total: notes.len(),
            revision: self.playback_revision()?,
            notes: rows,
        })
        .map_err(|e| e.to_string())
    }
    pub(super) fn edit_note_playback(
        &mut self,
        track: usize,
        indices: Vec<usize>,
        mode: Option<PlayerConfig>,
        expected: &str,
    ) -> Result<Value, String> {
        if self.playback_revision()? != expected {
            return Err("逐音播放规则已更新，请重新读取后保存".into());
        }
        if indices.is_empty() || indices.len() > 4096 {
            return Err("请选择 1～4096 个音符".into());
        }
        let (path, mut sidecar) = self.playback_sidecar()?;
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let notes = &file
            .tracks
            .iter()
            .find(|t| t.track_id == track)
            .ok_or("音轨不存在")?
            .notes;
        if indices.iter().any(|&i| i >= notes.len()) {
            return Err("音符位置已改变，请重新读取".into());
        }
        let mut rules = (*self.config.note_players).clone();
        for index in indices {
            if let Some(mode) = mode {
                rules.insert((track, index), mode);
            } else {
                rules.remove(&(track, index));
            }
        }
        sidecar.note_playback = rules
            .iter()
            .map(|(&(track_id, note_index), &mode)| NotePlaybackRule {
                track_id,
                note_index,
                mode,
            })
            .collect();
        library::save_song_sidecar(&path, &file.content_id, sidecar).map_err(|e| e.to_string())?;
        self.config.note_players = Arc::new(rules);
        self.reset(self.state.position);
        self.score_revision = self.score_revision.wrapping_add(1);
        Ok(serde_json::json!({"ok":true, "revision":self.playback_revision()?}))
    }
}

#[cfg(test)]
#[path = "note_playback_tests.rs"]
mod tests;
