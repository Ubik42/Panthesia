//! Current-song metadata follows the same captured save and recovery path as annotations.
use crate::*;
use panthesia_core::library::{MetadataError, SongMetadata};

impl Player {
    pub(super) fn current_metadata(&self) -> Result<SongMetadata, String> {
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        match panthesia_core::library::load_song_metadata(
            &self.annotation_path(file)?,
            &file.content_id,
        ) {
            Ok(value) => Ok(value),
            Err(MetadataError::Read(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(SongMetadata::default())
            }
            Err(error) => Err(format!("曲目信息无法读取，原文件已保留：{error}")),
        }
    }

    pub(super) fn save_current_metadata(
        &mut self,
        value: SongMetadata,
        expected: Option<SongMetadata>,
    ) -> Result<serde_json::Value, String> {
        validate(&value)?;
        let current = self.current_metadata()?;
        if expected.as_ref().is_some_and(|old| *old != current) {
            return Ok(
                serde_json::json!({"ok":false,"status":"conflict","current":current,"changed":false}),
            );
        }
        let value = value.normalized();
        if value == current {
            return Ok(
                serde_json::json!({"ok":true,"status":"saved","value":current,"changed":false}),
            );
        }
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let path = self.annotation_path(file)?;
        panthesia_core::library::save_song_metadata(&path, &file.content_id, value.clone())
            .map_err(|error| error.to_string())?;
        if let Some(title) = value.title.clone().filter(|title| !title.trim().is_empty()) {
            self.title = title;
        }
        self.persist()?;
        Ok(
            serde_json::json!({"ok":true,"status":"saved","value":value,"changed":true}),
        )
    }
}

fn validate(value: &SongMetadata) -> Result<(), String> {
    for (label, text, limit) in [
        ("曲名", &value.title, 2000),
        ("副标题", &value.subtitle, 2000),
        ("改编者", &value.arranger, 2000),
        ("版权", &value.copyright, 2000),
        ("许可说明", &value.license, 2000),
        ("作曲家", &value.composer, 2000),
        ("演奏者", &value.artist, 2000),
        ("作品集", &value.collection, 2000),
        ("难度", &value.difficulty, 2000),
        ("备注", &value.notes, 10000),
    ] {
        if text.as_ref().is_some_and(|s| s.chars().count() > limit) {
            return Err(format!("{label}最多 {limit} 字"));
        }
    }
    if value.tags.len() > 100 || value.tags.iter().any(|s| s.chars().count() > 128) {
        return Err("最多 100 个标签，每个最多 128 字".into());
    }
    Ok(())
}
