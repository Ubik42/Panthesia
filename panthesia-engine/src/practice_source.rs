//! Identity of the musical material and conditions used to prepare a saved definition.
//! Playback position and global volume may move independently; note assignments,
//! selected range, notation mapping, speed and practiced tracks must still agree.
use crate::{Player, preferences::SessionSettings};

#[derive(Clone, PartialEq)]
pub(crate) struct SourceIdentity {
    content: Option<String>,
    score_revision: u64,
    annotation_revision: u64,
    mapping: Option<String>,
    settings: SessionSettings,
    note_playback: Vec<panthesia_core::song_config::NotePlaybackRule>,
    speed: u64,
    passage: Option<(u64, u64)>,
}
impl SourceIdentity {
    pub(crate) fn capture(player: &Player) -> Self {
        Self {
            content: player.file.as_ref().map(|file| file.content_id.clone()),
            score_revision: player.score_revision,
            annotation_revision: player.state.annotation_revision,
            mapping: player
                .located_score_map
                .as_ref()
                .map(|mapping| mapping.token.clone()),
            settings: SessionSettings {
                tracks: player.config.practice_track_setup(),
                parts: player
                    .config
                    .tracks
                    .iter()
                    .map(|track| (track.track_id, track.practice_part))
                    .collect(),
                mode: Some(player.state.mode.clone()),
                count_in: player.state.count_in,
                metronome: player.state.metronome,
                latency: player.state.latency,
                hands: player.state.hands.clone(),
                rounds: player.state.rounds,
                adaptive: player.state.adaptive,
            },
            note_playback: player.config.note_playback_rules(),
            speed: player.state.speed.to_bits(),
            passage: player
                .state
                .passage
                .as_ref()
                .map(|passage| (passage.start.to_bits(), passage.end.to_bits())),
        }
    }
}
