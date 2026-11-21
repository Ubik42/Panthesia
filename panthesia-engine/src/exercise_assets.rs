//! Generated annotation caches are inspected without creating or repairing files.
use crate::{
    load_pipeline::{Assets, Watch},
    preferences::ScoreVersion,
};
use panthesia_core::{
    exercise::{ExerciseHands, ExerciseMinorForm, ExercisePlan, ExerciseSpec, ExerciseTonality},
    library,
    panthesia_keyboard::KeyboardRange,
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
    pub(crate) fn anchor(&self) -> &Path {
        &self.destination
    }

    #[cfg(test)]
    pub(crate) fn destination_for_test(&self) -> PathBuf {
        self.destination.clone()
    }
    pub fn read(
        data: &Path,
        file: &panthesia_music::MidiFile,
        spec: ExerciseSpec,
        versions: &[ScoreVersion],
    ) -> Result<Self, String> {
        Self::read_checked(data, file, spec, versions, &|| Ok(()))
    }
    pub(crate) fn read_checked(
        data: &Path,
        file: &panthesia_music::MidiFile,
        spec: ExerciseSpec,
        versions: &[ScoreVersion],
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        check()?;
        let bytes = canonical_bytes(spec)?;
        check()?;
        let id = blake3::hash(&bytes).to_hex().to_string();
        let mut watches = Vec::new();
        let _ = id;
        // Generated exercises are cached under the data root: `library/assets/exercises/<cid>.mid`
        // keeps their hand and finger edits in the owned annotation document.
        let destination = data.join("library/assets/exercises").join(format!("{}.mid", file.content_id));
        let source = destination.clone();
        watches.push(Watch::capture(&destination)?);
        watches.push(Watch::capture(&library::metadata_sidecar_path(&destination))?);
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
    pub fn store(&self, _data: &Path, cid: &str) -> Result<(), String> {
        use panthesia_core::utils::atomic_file;
        if !atomic_file::is_file(&self.destination) {
            if let Some(parent) = self.destination.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            atomic_file::write(&self.destination, &self.bytes).map_err(|e| e.to_string())?;
        }
        if !atomic_file::is_file(&library::metadata_sidecar_path(&self.destination)) {
            if let Some(initial) = self.assets.sidecar.clone() {
                library::save_song_sidecar(&self.destination, cid, initial).map_err(|e| e.to_string())?;
            }
        }
        if atomic_file::is_file(&library::metadata_sidecar_path(&self.destination)) {
            panthesia_core::song_annotations::bind_legacy_bytes(&self.destination, cid, &self.bytes, &|| Ok(())).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
