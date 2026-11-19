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
        crate::library_metadata::validate(&value)?;
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
        let journal = metadata_history::prepare(
            &self.data,
            &path,
            &file.content_id,
            current,
            value.clone(),
            None,
        )?;
        if let Err(error) =
            panthesia_core::library::save_song_metadata(&path, &file.content_id, value.clone())
        {
            let _ = metadata_history::finish(&self.data, &path, &journal, false);
            return Err(error.to_string());
        }
        metadata_history::finish(&self.data, &path, &journal, true)?;
        if let Some(title) = value.title.clone().filter(|title| !title.trim().is_empty()) {
            self.title = title;
        }
        self.persist()?;
        Ok(
            serde_json::json!({"ok":true,"status":"saved","value":value,"changed":true,"historyId":journal}),
        )
    }
}
