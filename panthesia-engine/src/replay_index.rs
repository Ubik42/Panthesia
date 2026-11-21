//! Seek state for prepared demo playback is built once on a worker and reconstructed from bounded checkpoints.
type Event = (f64, usize, [u8; 3]);
const STRIDE: usize = 256;

#[derive(Clone)]
struct State {
    velocity: [[u8; 128]; 16],
    held: [[bool; 128]; 16],
    pedals: [u8; 16],
}
impl Default for State {
    fn default() -> Self {
        Self {
            velocity: [[0; 128]; 16],
            held: [[false; 128]; 16],
            pedals: [0; 16],
        }
    }
}
impl State {
    fn apply(&mut self, [status, key, value]: [u8; 3]) {
        let channel = usize::from(status & 15);
        let pitch = usize::from(key);
        if pitch >= 128 {
            return;
        }
        match status & 240 {
            144 if value > 0 => {
                self.velocity[channel][pitch] = value;
                self.held[channel][pitch] = true;
            }
            128 | 144 => {
                self.held[channel][pitch] = false;
                if self.pedals[channel] < 64 {
                    self.velocity[channel][pitch] = 0;
                }
            }
            176 if key == 64 => {
                self.pedals[channel] = value;
                if value < 64 {
                    for (velocity, held) in
                        self.velocity[channel].iter_mut().zip(self.held[channel])
                    {
                        if !held {
                            *velocity = 0;
                        }
                    }
                }
            }
            176 if key == 120 => {
                self.velocity[channel].fill(0);
                self.held[channel].fill(false);
            }
            176 if key == 123 => {
                self.held[channel].fill(false);
                if self.pedals[channel] < 64 {
                    self.velocity[channel].fill(0);
                }
            }
            _ => {}
        }
    }
    fn messages(&self) -> Vec<[u8; 3]> {
        let mut result = Vec::new();
        for (channel, value) in self.pedals.iter().copied().enumerate() {
            if value > 0 {
                result.push([176 | channel as u8, 64, value]);
            }
        }
        for channel in 0..16 {
            for pitch in 0..128 {
                let velocity = self.velocity[channel][pitch];
                if velocity == 0 {
                    continue;
                }
                result.push([144 | channel as u8, pitch as u8, velocity]);
                if !self.held[channel][pitch] {
                    result.push([128 | channel as u8, pitch as u8, 0]);
                }
            }
        }
        result
    }
}
pub(crate) struct Index {
    checkpoints: Vec<State>,
}
impl Index {
    pub(crate) fn restore(&self, events: &[Event], position: f64) -> (usize, Vec<[u8; 3]>) {
        let cursor = events.partition_point(|event| event.0 <= position + 0.000001);
        let block = cursor / STRIDE;
        let mut state = self.checkpoints[block].clone();
        for (_, _, message) in &events[block * STRIDE..cursor] {
            state.apply(*message);
        }
        (cursor, state.messages())
    }
}
pub(crate) fn restore_from_start(events: &[Event], position: f64) -> (usize, Vec<[u8; 3]>) {
    let cursor = events.partition_point(|event| event.0 <= position + 0.000001);
    let mut state = State::default();
    for (_, _, message) in &events[..cursor] {
        state.apply(*message);
    }
    (cursor, state.messages())
}

/// Auditions retain track identity; their generated events contain note attacks/releases.
pub(crate) struct AuditionIndex {
    voices: std::collections::BTreeMap<(usize, u8, u8), Vec<(usize, u8)>>,
}
impl AuditionIndex {
    pub(crate) fn new(events: &[Event]) -> Self {
        let mut voices: std::collections::BTreeMap<_, Vec<_>> = Default::default();
        for (index, (_, track, [status, pitch, velocity])) in events.iter().enumerate() {
            if !matches!(status & 240, 128 | 144) {
                continue;
            }
            let velocity = if status & 240 == 144 { *velocity } else { 0 };
            voices
                .entry((*track, status & 15, *pitch))
                .or_default()
                .push((index, velocity));
        }
        Self { voices }
    }
    pub(crate) fn at(&self, cursor: usize) -> Vec<(usize, [u8; 3])> {
        self.voices
            .iter()
            .filter_map(|((track, channel, pitch), history)| {
                let before = history.partition_point(|(index, _)| *index < cursor);
                let velocity = history.get(before.checked_sub(1)?)?.1;
                (velocity > 0).then_some((*track, [144 | *channel, *pitch, velocity]))
            })
            .collect()
    }
}
