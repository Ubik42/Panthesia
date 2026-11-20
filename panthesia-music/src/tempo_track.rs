//! Musical time is accumulated as a rational sum before conversion to clock nanoseconds.
use midly::{MetaMessage, TrackEvent, TrackEventKind};
use std::{collections::BTreeMap, sync::Arc, time::Duration};
#[derive(Clone, Debug)]
pub struct TempoEvent {
    pub absolute_pulses: u64,
    pub timestamp: Duration,
    pub tempo: u32,
}
#[derive(Clone, Debug)]
pub struct TempoTrack {
    ppq: u16,
    events: Arc<[TempoEvent]>,
    weighted: Arc<[u128]>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TempoProjection {
    pub timestamp: Duration,
    pub pulses: u64,
    pub exact_to_pulse: bool,
}
fn duration(nanos: u128) -> Duration {
    Duration::new(
        (nanos / 1_000_000_000).min(u64::MAX as u128) as u64,
        (nanos % 1_000_000_000) as u32,
    )
}
impl TempoTrack {
    pub fn build(tracks: &[Vec<TrackEvent<'_>>], ppq: u16) -> Self {
        let mut changes = BTreeMap::from([(0, 500_000u32)]);
        for track in tracks {
            let mut tick = 0u64;
            for event in track {
                tick = tick.saturating_add(event.delta.as_int() as u64);
                if let TrackEventKind::Meta(MetaMessage::Tempo(value)) = event.kind {
                    if value.as_int() > 0 {
                        changes.insert(tick, value.as_int());
                    }
                }
            }
        }
        let mut previous_tick = 0;
        let mut previous_tempo = 500_000;
        let mut sum = 0u128;
        let mut events = Vec::new();
        let mut weighted = Vec::new();
        for (tick, tempo) in changes {
            sum += u128::from(tick - previous_tick) * u128::from(previous_tempo);
            events.push(TempoEvent {
                absolute_pulses: tick,
                timestamp: duration(sum * 1000 / u128::from(ppq.max(1))),
                tempo,
            });
            weighted.push(sum);
            previous_tick = tick;
            previous_tempo = tempo;
        }
        Self {
            ppq,
            events: events.into(),
            weighted: weighted.into(),
        }
    }
    pub fn ppq(&self) -> u16 {
        self.ppq
    }
    pub fn events(&self) -> &[TempoEvent] {
        &self.events
    }
    pub fn tempo_event_for_pulses(&self, tick: u64) -> Option<&TempoEvent> {
        self.events.get(
            self.events
                .partition_point(|e| e.absolute_pulses <= tick)
                .saturating_sub(1),
        )
    }
    pub fn pulses_to_duration(&self, tick: u64) -> Duration {
        let index = self
            .events
            .partition_point(|e| e.absolute_pulses <= tick)
            .saturating_sub(1);
        let event = &self.events[index];
        duration(
            (self.weighted[index]
                + u128::from(tick - event.absolute_pulses) * u128::from(event.tempo))
                * 1000
                / u128::from(self.ppq.max(1)),
        )
    }
    pub fn seconds_to_pulses(&self, seconds: f64) -> f64 {
        let seconds = if seconds.is_finite() {
            seconds.max(0.)
        } else {
            0.
        };
        let index = self
            .events
            .partition_point(|e| e.timestamp.as_secs_f64() <= seconds)
            .saturating_sub(1);
        let event = &self.events[index];
        event.absolute_pulses as f64
            + (seconds - event.timestamp.as_secs_f64()).max(0.) * self.ppq as f64 * 1_000_000.
                / event.tempo as f64
    }
    pub fn bpm_at_seconds(&self, seconds: f64) -> f64 {
        let index = self
            .events
            .partition_point(|e| e.timestamp.as_secs_f64() <= seconds)
            .saturating_sub(1);
        60_000_000. / self.events[index].tempo as f64
    }
    pub fn project_quarter_fraction(
        &self,
        numerator: i64,
        denominator: u32,
    ) -> Option<TempoProjection> {
        if numerator < 0 || denominator == 0 {
            return None;
        }
        let scaled = u128::try_from(numerator).ok()? * u128::from(self.ppq);
        let divisor = u128::from(denominator);
        let pulses = u64::try_from((scaled + divisor / 2) / divisor).ok()?;
        Some(TempoProjection {
            timestamp: self.pulses_to_duration(pulses),
            pulses,
            exact_to_pulse: scaled % divisor == 0,
        })
    }
}
