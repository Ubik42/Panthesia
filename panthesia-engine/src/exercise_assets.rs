//! Generated annotation caches are inspected without creating or repairing files.
use crate::{
    import_storage,
    load_pipeline::{Assets, Watch},
    preferences::ScoreVersion,
};
use panthesia_core::{
    exercise::{ExerciseHands, ExerciseMinorForm, ExercisePlan, ExerciseSpec, ExerciseTonality},
    library,
    piano_layout::KeyboardRange,
};
use std::path::{Path, PathBuf};
pub(crate) fn canonical_bytes(spec: ExerciseSpec) -> Result<Vec<u8>, String> {
    let canonical = ExerciseSpec {
        hands: ExerciseHands::Both,
        repetitions: 1,
        tempo_bpm: 120,
        minor_form: if spec.tonality == ExerciseTonality::Major {
            ExerciseMinorForm::Natural
        } else {
            spec.minor_form
        },
        ..spec
    };
    let smf = ExercisePlan::generate(canonical, &KeyboardRange::new(21..=108))
        .map_err(|e| e.to_string())?
        .to_smf()
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    smf.write_std(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes)
}
pub(crate) struct Prepared {
    pub assets: Assets,
    bytes: Vec<u8>,
    destination: PathBuf,
    watches: Vec<Watch>,
}
impl Prepared {
    #[cfg(test)]
    pub(crate) fn destination_for_test(&self) -> PathBuf {
        self.destination.clone()
    }
    pub fn read(
        data: &Path,
        file: &midi_file::MidiFile,
        spec: ExerciseSpec,
        versions: &[ScoreVersion],
    ) -> Result<Self, String> {
        Self::read_checked(data, file, spec, versions, &|| Ok(()))
    }
    pub(crate) fn read_checked(
        data: &Path,
        file: &midi_file::MidiFile,
        spec: ExerciseSpec,
        versions: &[ScoreVersion],
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        check()?;
        let bytes = canonical_bytes(spec)?;
        check()?;
        let id = blake3::hash(&bytes).to_hex().to_string();
        let mut watches = Vec::new();
        let (destination, source) = import_storage::planned_annotations(
            &data.join("song-assets"),
            &file.content_id,
            &id,
            &file.content_id,
            |path| {
                check()?;
                watches.push(Watch::capture(path)?);
                Ok(())
            },
        )?;
        if let Ok(sidecar) = library::load_song_sidecar(&source, &file.content_id) {
            if let Some(score) = sidecar.score {
                watches.push(Watch::capture(&library::resolve_score_path(
                    &source, &score,
                ))?);
            }
        }
        let assets = Assets::read_checked(file, &source, versions, check)?;
        let result = Self {
            assets,
            bytes,
            destination,
            watches,
        };
        check()?;
        result.check()?;
        Ok(result)
    }
    pub fn check(&self) -> Result<(), String> {
        for watch in &self.watches {
            watch.check()?;
        }
        Ok(())
    }
    pub fn store(&self, data: &Path, cid: &str) -> Result<(), String> {
        let id = blake3::hash(&self.bytes).to_hex().to_string();
        let stored = import_storage::store_with_identity(
            &data.join("song-assets"),
            cid,
            &id,
            cid,
            &self.bytes,
        )?;
        if stored.path != self.destination {
            return Err("生成练习的附加资料位置已变化，请重新打开练习".into());
        }
        Ok(())
    }
}
