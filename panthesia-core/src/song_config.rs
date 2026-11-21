use crate::practice::{PracticeHands, PracticePart};
use crate::practice_history::{PracticeTrackMode, PracticeTrackSetup, SongPracticeSetup};
use panthesia_music::MidiTrack;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};
#[derive(Debug, Clone, Copy, Deserialize, Serialize, Eq, PartialEq)]
pub enum PlayerConfig {
    Mute,
    Auto,
    Human,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct TrackConfig {
    pub track_id: usize,
    pub player: PlayerConfig,
    pub visible: bool,
    pub practice_part: PracticePart,
}

/// A content-bound note identity; indices remain stable under practice variants.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, Eq, PartialEq)]
pub struct NotePlaybackRule {
    pub track_id: usize,
    pub note_index: usize,
    pub mode: PlayerConfig,
}

#[derive(Default, Debug, Clone, Eq, PartialEq)]
pub struct SongConfig {
    pub tracks: Box<[TrackConfig]>,
    pub note_players: Arc<BTreeMap<(usize, usize), PlayerConfig>>,
}

impl SongConfig {
    pub fn new(tracks: &[MidiTrack]) -> Self {
        let practice_parts = infer_practice_parts(tracks);
        let tracks: Vec<_> = tracks
            .iter()
            .map(|t| {
                let is_drums = t.has_drums && !t.has_other_than_drums;
                TrackConfig {
                    track_id: t.track_id,
                    player: if t.notes.is_empty() || is_drums {
                        PlayerConfig::Auto
                    } else {
                        PlayerConfig::Human
                    },
                    visible: !is_drums,
                    practice_part: practice_parts.get(&t.track_id).copied().unwrap_or_default(),
                }
            })
            .collect();
        Self {
            tracks: tracks.into(),
            ..Default::default()
        }
    }

    /// Track mute/auto still applies when the user changes an entire track.
    pub fn player_for(&self, track: usize, index: usize) -> PlayerConfig {
        let base = self
            .tracks
            .iter()
            .find(|t| t.track_id == track)
            .map_or(PlayerConfig::Mute, |t| t.player);
        match (base, self.note_players.get(&(track, index))) {
            (PlayerConfig::Mute, _) | (_, Some(PlayerConfig::Mute)) => PlayerConfig::Mute,
            (PlayerConfig::Auto, _) | (_, Some(PlayerConfig::Auto)) => PlayerConfig::Auto,
            _ => PlayerConfig::Human,
        }
    }

    pub fn note_playback_rules(&self) -> Vec<NotePlaybackRule> {
        self.note_players
            .iter()
            .map(|(&(track_id, note_index), &mode)| NotePlaybackRule {
                track_id,
                note_index,
                mode,
            })
            .collect()
    }

    pub fn has_human_notes(&self, track: usize, note_count: usize) -> bool {
        if !self
            .tracks
            .iter()
            .any(|t| t.track_id == track && t.player == PlayerConfig::Human)
        {
            return false;
        }
        let excluded = self
            .note_players
            .range((track, 0)..=(track, usize::MAX))
            .filter(|((_, index), mode)| *index < note_count && **mode != PlayerConfig::Human)
            .count();
        excluded < note_count
    }

    pub fn set_note_playback_rules(
        &mut self,
        rules: &[NotePlaybackRule],
        file: &panthesia_music::MidiFile,
    ) -> Result<(), String> {
        let mut players = BTreeMap::new();
        for rule in rules {
            if file
                .tracks
                .iter()
                .find(|t| t.track_id == rule.track_id)
                .and_then(|t| t.notes.get(rule.note_index))
                .is_none()
                || players
                    .insert((rule.track_id, rule.note_index), rule.mode)
                    .is_some()
            {
                return Err("逐音播放规则包含无效或重复的音符".into());
            }
        }
        self.note_players = Arc::new(players);
        Ok(())
    }

    pub fn practice_hands(&self) -> Option<PracticeHands> {
        let left: Vec<_> = self
            .tracks
            .iter()
            .filter(|track| track.practice_part == PracticePart::LeftHand)
            .collect();
        let right: Vec<_> = self
            .tracks
            .iter()
            .filter(|track| track.practice_part == PracticePart::RightHand)
            .collect();
        if left.is_empty() || right.is_empty() {
            return None;
        }

        let all =
            |tracks: &[&TrackConfig], player| tracks.iter().all(|track| track.player == player);
        Some(
            if all(&left, PlayerConfig::Human) && all(&right, PlayerConfig::Human) {
                PracticeHands::Both
            } else if all(&left, PlayerConfig::Auto) && all(&right, PlayerConfig::Human) {
                PracticeHands::Right
            } else if all(&left, PlayerConfig::Human) && all(&right, PlayerConfig::Auto) {
                PracticeHands::Left
            } else {
                PracticeHands::Custom
            },
        )
    }

    pub fn set_practice_hands(&mut self, mode: PracticeHands) -> bool {
        if matches!(mode, PracticeHands::Custom | PracticeHands::Unspecified)
            || self.practice_hands().is_none()
        {
            return false;
        }

        for track in &mut self.tracks {
            track.player = match (mode, track.practice_part) {
                (PracticeHands::Both, PracticePart::LeftHand | PracticePart::RightHand) => {
                    PlayerConfig::Human
                }
                (PracticeHands::Right, PracticePart::RightHand)
                | (PracticeHands::Left, PracticePart::LeftHand) => PlayerConfig::Human,
                (PracticeHands::Right, PracticePart::LeftHand)
                | (PracticeHands::Left, PracticePart::RightHand) => PlayerConfig::Auto,
                _ => track.player,
            };
        }
        true
    }

    pub fn practice_track_setup(&self) -> Vec<PracticeTrackSetup> {
        self.tracks
            .iter()
            .map(|track| PracticeTrackSetup {
                track_id: track.track_id,
                mode: match track.player {
                    PlayerConfig::Mute => PracticeTrackMode::Mute,
                    PlayerConfig::Auto => PracticeTrackMode::Auto,
                    PlayerConfig::Human => PracticeTrackMode::Human,
                },
                visible: track.visible,
            })
            .collect()
    }

    pub fn apply_practice_setup(&mut self, setup: &SongPracticeSetup) -> bool {
        if setup.tracks.len() != self.tracks.len()
            || setup.tracks.iter().any(|saved| {
                !self
                    .tracks
                    .iter()
                    .any(|track| track.track_id == saved.track_id)
            })
        {
            return false;
        }

        for saved in &setup.tracks {
            let track = self
                .tracks
                .iter_mut()
                .find(|track| track.track_id == saved.track_id)
                .expect("validated track IDs must remain present");
            track.player = match saved.mode {
                PracticeTrackMode::Mute => PlayerConfig::Mute,
                PracticeTrackMode::Auto => PlayerConfig::Auto,
                PracticeTrackMode::Human => PlayerConfig::Human,
            };
            track.visible = saved.visible;
        }
        true
    }
}

fn infer_practice_parts(tracks: &[MidiTrack]) -> HashMap<usize, PracticePart> {
    let centers: Vec<_> = tracks
        .iter()
        .filter(|track| {
            let is_drums = track.has_drums && !track.has_other_than_drums;
            !track.notes.is_empty() && !is_drums
        })
        .map(|track| {
            let pitch_sum: usize = track.notes.iter().map(|note| note.note as usize).sum();
            (track.track_id, pitch_sum as f32 / track.notes.len() as f32)
        })
        .collect();

    infer_practice_parts_from_centers(&centers)
}

pub fn infer_practice_parts_from_centers(centers: &[(usize, f32)]) -> HashMap<usize, PracticePart> {
    let mut parts: HashMap<_, _> = centers
        .iter()
        .map(|(track_id, _)| (*track_id, PracticePart::Other))
        .collect();

    if centers.len() == 2 {
        let mut ordered = centers.to_vec();
        ordered.sort_by(|(left_id, left_pitch), (right_id, right_pitch)| {
            left_pitch
                .total_cmp(right_pitch)
                .then_with(|| left_id.cmp(right_id))
        });
        parts.insert(ordered[0].0, PracticePart::LeftHand);
        parts.insert(ordered[1].0, PracticePart::RightHand);
    }

    parts
}
