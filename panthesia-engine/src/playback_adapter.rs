//! MIDI/configuration/output adapter for the in-memory playback session.
use crate::playback_session::Frame;
use crate::*;
pub(super) fn note_player(
    config: &SongConfig,
    note_hands: &HandAssignments,
    scope: &str,
    track: usize,
    index: usize,
) -> PlayerConfig {
    let base = config.player_for(track, index);
    if base != PlayerConfig::Human {
        return base;
    }
    let wanted = match scope {
        "left" => Some(PracticePart::LeftHand),
        "right" => Some(PracticePart::RightHand),
        "other" => Some(PracticePart::Other),
        _ => None,
    };
    if wanted.is_some_and(|h| hands::part(config, note_hands, track, index) != h) {
        PlayerConfig::Auto
    } else {
        base
    }
}
impl Player {
    pub(super) fn tick_transport(&mut self, delta: Duration) {
        let end = self
            .state
            .passage
            .as_ref()
            .map_or(self.state.duration, |p| p.end);
        let config = &self.config;
        let hands = &self.note_hands;
        let scope = &self.state.hands;
        let frame = Frame {
            position: self.state.position,
            speed: self.state.speed,
            end,
            waiting: self.state.wait,
            looping: self.state.passage.is_some(),
        };
        let Some(position) = self.playback.advance(delta, frame, &self.notes, |n| {
            (
                n.start.as_secs_f64(),
                n.note,
                note_player(config, hands, scope, n.track_id, n.index) == PlayerConfig::Human,
            )
        }) else {
            return;
        };
        self.state.position = position;
        while let Some(event) = self
            .playback
            .next_event(
                &self.events,
                position,
                self.state.passage.as_ref().map(|p| p.end),
                |e| e.timestamp.as_secs_f64(),
            )
            .cloned()
        {
            if self
                .config
                .tracks
                .iter()
                .any(|t| t.track_id == event.track_id && t.player == PlayerConfig::Mute)
            {
                continue;
            }
            use midi_file::midly::MidiMessage as M;
            let (bytes, len) = match event.message {
                M::NoteOn { key, vel } => {
                    if event
                        .source_note
                        .and_then(|id| self.event_notes.get(&id))
                        .is_some_and(|&i| {
                            !note_playback::reference_sounds(
                                self.note_player(event.track_id, i),
                                &self.state.mode,
                            )
                        })
                    {
                        continue;
                    }
                    ([144 | event.channel, key.as_int(), vel.as_int()], 3)
                }
                M::NoteOff { key, vel } => {
                    if event
                        .source_note
                        .and_then(|id| self.event_notes.get(&id))
                        .is_some_and(|&i| {
                            !note_playback::reference_sounds(
                                self.note_player(event.track_id, i),
                                &self.state.mode,
                            )
                        })
                    {
                        continue;
                    }
                    ([128 | event.channel, key.as_int(), vel.as_int()], 3)
                }
                M::Controller { controller, value } => (
                    [176 | event.channel, controller.as_int(), value.as_int()],
                    3,
                ),
                M::ProgramChange { program } => ([192 | event.channel, program.as_int(), 0], 2),
                M::PitchBend { bend } => {
                    let n = bend.0.as_int();
                    ([224 | event.channel, (n & 127) as u8, (n >> 7) as u8], 3)
                }
                _ => continue,
            };
            self.send_track(event.track_id, &bytes[..len]);
        }

        if self.playback.completed(position, end, self.state.wait) {
            self.finish_practice_round();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn live_mode_and_hand_changes_preserve_position_and_running_state() {
        let root = std::env::temp_dir().join(format!(
            "panthesia-live-transport-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("own.mid");
        std::fs::write(&path, include_bytes!("../assets/five-finger.mid")).unwrap();
        let mut p = Player::new(root.join("profile"), PathBuf::new(), true);
        p.command(Command::Load {
            path,
            title: "Transport fixture".into(),
        })
        .unwrap();
        p.command(Command::CountIn { bars: 0 }).unwrap();
        p.command(Command::Mode {
            value: "listen".into(),
        })
        .unwrap();
        p.command(Command::Play).unwrap();
        p.tick(Duration::from_millis(250));
        let position = p.state.position;
        let clock = p.playback.clock;
        let cursor = p.playback.event_cursor;
        p.command(Command::Wait { enabled: true }).unwrap();
        assert_eq!(p.state.status, "playing");
        assert_eq!(p.state.position, position);
        assert_eq!(p.playback.clock, clock);
        assert_eq!(p.playback.event_cursor, cursor);
        p.command(Command::Hands {
            value: "both".into(),
        })
        .unwrap();
        assert_eq!(p.state.status, "playing");
        assert_eq!(p.state.position, position);
        assert_eq!(p.playback.clock, clock);
        p.command(Command::Wait { enabled: false }).unwrap();
        p.tick(Duration::from_millis(50));
        assert!(p.state.position > position);
        assert!(p.playback.guidance.ready());
        p.command(Command::Pause).unwrap();
        let position = p.state.position;
        p.tick(Duration::from_millis(200));
        assert_eq!(p.state.position, position);
        assert!(p.state.pressed.is_empty());
        p.command(Command::Hands {
            value: "both".into(),
        })
        .unwrap();
        assert_eq!(p.state.status, "paused");
        assert_eq!(p.state.position, position);
    }
}
