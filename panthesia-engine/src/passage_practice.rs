//! A saved passage owns its practice edition; opening prepares before replacing live musical state.
use crate::*;
use panthesia_core::song_project::PracticeEdition;

impl preferences::PassagePreset {
    pub(super) fn practice_edition(&self, content: &str) -> Result<PracticeEdition, String> {
        if let Some(saved) = &self.practice {
            let expected = PracticeEdition::new(content, saved.transform.clone())?;
            if saved != &expected {
                return Err("练习段的演奏版本身份不一致，请重新核对后保存".into());
            }
            return Ok(expected);
        }
        PracticeEdition::new(
            content,
            practice_variant::Variant::from_grid(self.grid.as_deref().unwrap_or(""))?,
        )
    }
}
impl Player {
    pub(super) fn passage_practice_snapshot(&self) -> Result<PracticeEdition, String> {
        PracticeEdition::new(
            &self.file.as_ref().ok_or("请先选择曲目")?.content_id,
            self.variant(),
        )
    }
    pub(super) fn open_saved_passage(&mut self, id: &str) -> Result<serde_json::Value, String> {
        let content = self.file.as_ref().ok_or("请先选择曲目")?.content_id.clone();
        let preset = self
            .preferences
            .passages
            .get(&content)
            .and_then(|rows| rows.iter().find(|row| row.id == id))
            .cloned()
            .ok_or("该练习段不属于当前曲目")?;
        let edition = preset.practice_edition(&content)?;
        let mut prepared = self.capture_document_context().into_player(true)?;
        prepared.preferences_path = self.preferences_path.clone();
        prepared.restoring = self.restoring;
        let current = prepared.variant();
        if (current.transpose, current.quantize, current.durations)
            != (
                edition.transform.transpose,
                edition.transform.quantize,
                edition.transform.durations,
            )
        {
            prepared.apply_variant_memory(&edition.transform)?;
        }
        prepared
            .preferences
            .variants
            .insert(content.clone(), edition.transform.clone());
        if preset.practice.is_none() {
            if let Some(saved) = prepared
                .preferences
                .passages
                .get_mut(&content)
                .and_then(|rows| rows.iter_mut().find(|row| row.id == id))
            {
                saved.practice = Some(edition);
            }
        }
        let result = prepared.open_passage_conditions(preset)?;
        let status = prepared.state.status.clone();
        let keep = prepared.score_revision == self.score_revision;
        let mut playback = song_switch::Playback::take(&mut prepared)?;
        if keep {
            playback.preserve_undo();
            playback.preserve_score_mapping();
        }
        // The outer song-switch transaction publishes deferred writes and this state together.
        self.preferences = prepared.preferences;
        playback.install(self);
        self.state.status = status;
        Ok(result)
    }
    fn open_passage_conditions(
        &mut self,
        preset: preferences::PassagePreset,
    ) -> Result<serde_json::Value, String> {
        if preset
            .grid
            .as_ref()
            .is_some_and(|g| *g != self.grid_signature())
        {
            return Err("小节网格已改变，请重新确认这个练习段的范围并保存".into());
        }
        if let Some(range) = &preset.score_range {
            self.validate_score_range(range)?;
        }
        if let Some(range) = &preset.precise_range {
            self.validate_tick_range(range)?;
        }
        if preset.score_range.is_none() && preset.precise_range.is_none() {
            let measures = &self
                .file
                .as_ref()
                .ok_or("请先选择曲目")?
                .musical_time
                .measures;
            if preset.start == 0 || preset.start > preset.end || preset.end > measures.len() {
                return Err("练习段的小节范围已失效，请重新确认后保存".into());
            }
            let start = self
                .file
                .as_ref()
                .unwrap()
                .tempo_track
                .pulses_to_duration(measures[preset.start - 1].start_tick)
                .as_secs_f64();
            let end = self
                .file
                .as_ref()
                .unwrap()
                .tempo_track
                .pulses_to_duration(measures[preset.end - 1].end_tick)
                .as_secs_f64()
                .min(self.state.duration);
            if !start.is_finite() || !end.is_finite() || end - start < 0.1 {
                return Err("练习段时长已失效，请重新确认后保存".into());
            }
        }
        self.panic();
        self.state.status = "paused".into();
        self.config.apply_practice_setup(&SongPracticeSetup {
            tracks: preset.settings.tracks.clone(),
            ..Default::default()
        });
        for t in &mut self.config.tracks {
            if let Some(part) = preset.settings.parts.get(&t.track_id) {
                t.practice_part = *part;
            }
        }
        self.state.mode = preset.settings.mode.unwrap_or_else(|| "wait".into());
        self.state.wait = self.state.mode == "wait";
        self.state.hands = preset.settings.hands;
        self.state.count_in = preset.settings.count_in;
        self.state.metronome = preset.settings.metronome;
        self.state.latency = preset.settings.latency;
        self.state.rounds = preset.settings.rounds;
        self.state.adaptive = preset.settings.adaptive;
        self.state.speed = preset.speed;
        if let Some(range) = &preset.score_range {
            return self.apply_score_range(range);
        }
        if let Some(range) = &preset.precise_range {
            return self.apply_tick_range(range);
        }
        return self.command(Command::MeasureLoop {
            start: preset.start,
            end: preset.end,
            enabled: true,
        });
    }
}
