//! Owned export snapshots keep file reads and package encoding outside playback.
use crate::*;
use panthesia_core::utils::atomic_file;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaExportKind {
    Midi,
    PracticeMidi,}
impl MediaExportKind {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Midi | Self::PracticeMidi => "mid",
        }
    }
    pub fn maximum(self) -> usize {
        match self {
            Self::Midi | Self::PracticeMidi => 32_000_000,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaExportInput {
    pub content_id: String,
    pub kind: MediaExportKind,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaExportSummary {
    #[serde(default)]
    pub performances:usize,
    pub scores: usize,
    pub paper_books: usize,
    pub paper_pages: usize,
    pub fingerings: usize,
    pub finger_actions: usize,
    pub hands: usize,
    pub passages: usize,
    pub ladders: usize,
}
impl MediaExportSummary {
}
pub struct Payload {
    pub bytes: Vec<u8>,
    pub title: String,
    pub content_id: String,
    pub summary: MediaExportSummary,
}
impl Engine {
    pub fn prepare_media_export(
        &self,
        input: MediaExportInput,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Payload, String> {
        check()?;
        let _pending = self.pending_operation()?;
        let (reply, receiver) = mpsc::sync_channel(1);
        self.tx
            .send(runtime_request::Request::AssetReadContext {
                registry: false,
                export: true,
                editor: false,
                scope: None,
                reply,
            })
            .map_err(|_| "音乐引擎已关闭")?;
        let context = receiver.recv().map_err(|_| "导出快照通道已关闭")??;
        check()?;
        let data = self.data.clone();
        let (prepared, _, observed) = atomic_file::capture_matching(
            Arc::new(move |path: &Path| asset_storage::captures(&data, path)),
            || {
                let reader = context.into_player(false)?;
                if reader
                    .file
                    .as_ref()
                    .is_none_or(|file| file.content_id != input.content_id)
                {
                    return Err("曲目已切换，请返回来源曲目后重新导出".into());
                }
                check()?;
                let title=reader.title.clone();
                let (bytes, summary) = match input.kind {
                    MediaExportKind::PracticeMidi => {
                        let value=reader.export_practice_variant()?;
                        let bytes:Vec<u8>=serde_json::from_value(value["bytes"].clone()).map_err(|e|e.to_string())?;
                        (bytes,MediaExportSummary::default())
                    }
                    MediaExportKind::Midi => {
                        (reader.prepare_midi_export()?, MediaExportSummary::default())
                    }
                };
                check()?;
                Ok::<_, String>(Payload {
                    bytes,
                    title: if input.kind==MediaExportKind::PracticeMidi {let v=reader.variant();format!("{} [转调{:+} 量化{}]",reader.title,v.transpose,v.quantize)}else{title},
                    content_id: input.content_id.clone(),
                    summary,
                })
            },
        );
        let result = prepared?;
        check()?;
        asset_storage::validate_observations(&observed)?;
        check()?;
        Ok(result)
    }
    pub(super) fn export_midi_task(&self) -> Result<serde_json::Value, String> {
        let content_id = self.snapshot().content_id.ok_or("请先打开曲目或录制演奏")?;
        let engine = self.clone();
        self.tasks
            .run("导出 MIDI", Some(content_id.clone()), move |token| {
                token.stage("readingMidi")?;
                let output = engine.prepare_media_export(
                    MediaExportInput {
                        content_id,
                        kind: MediaExportKind::Midi,
                    },
                    &|| token.check(),
                )?;
                token.check()?;
                Ok(serde_json::json!({"bytes":output.bytes,"title":output.title}))
            })
    }
}
impl Player {
    pub(crate) fn prepare_midi_export(&self) -> Result<Vec<u8>, String> {
        let file = self.file.as_ref().ok_or("请先打开曲目或录制演奏")?;
        if let Some(path) = &file.source_path {
            let bytes = atomic_file::read_dependency(path, 32_000_000)
                .map_err(|error| error.to_string())?;
            if blake3::hash(&bytes).to_hex().as_str() != file.content_id {
                return Err("MIDI 文件已在外部改变，请重新打开曲目后再导出".into());
            }
            Ok(bytes)
        } else {
            let plan = ExercisePlan::generate(
                self.exercise.ok_or("曲目无法导出")?,
                &KeyboardRange::new(21..=108),
            )
            .map_err(|error| error.to_string())?;
            let mut bytes = Vec::new();
            plan.to_smf()?
                .write_std(&mut bytes)
                .map_err(|error| error.to_string())?;
            Ok(bytes)
        }
    }
}
