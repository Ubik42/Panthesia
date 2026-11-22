//! Meter grid in source ticks. Explicit changes start a new bar even inside an existing bar.
use crate::tempo_track::TempoTrack;
use midly::{MetaMessage, TrackEvent, TrackEventKind};
use std::{collections::BTreeMap, time::Duration};
#[derive(Clone, Debug)]
pub struct Measure {
    pub number: usize,
    pub display_number: i32,
    pub start_tick: u64,
    pub end_tick: u64,
    pub numerator: u8,
    pub denominator: u16,
    pub explicit_meter: bool,
    pub partial: bool,
}
#[derive(Clone, Debug)]
pub struct MusicalTime {
    pub ppq: u16,
    pub measures: Vec<Measure>,
}
fn length(ppq: u16, n: u8, d: u16) -> Result<u64, String> {
    if ppq == 0 || n == 0 || n > 32 || ![1, 2, 4, 8, 16, 32, 64, 128].contains(&d) {
        return Err("拍号或每拍分辨率无效".into());
    }
    let size = u64::from(ppq) * 4 * u64::from(n) / u64::from(d);
    if size == 0 {
        return Err("当前分辨率不足以表达拍号".into());
    }
    Ok(size)
}
fn push(
    bars: &mut Vec<Measure>,
    start: u64,
    end: u64,
    n: u8,
    d: u16,
    explicit: bool,
    partial: bool,
    label: i32,
) -> Result<(), String> {
    if bars.len() >= 1_000_000 || end <= start {
        return Err("小节范围或数量超过上限".into());
    }
    bars.push(Measure {
        number: bars.len() + 1,
        display_number: label,
        start_tick: start,
        end_tick: end,
        numerator: n,
        denominator: d,
        explicit_meter: explicit,
        partial,
    });
    Ok(())
}
impl MusicalTime {
    pub fn build(tracks: &[Vec<TrackEvent<'_>>], ppq: u16, last_tick: u64) -> Result<Self, String> {
        Self::build_checked(tracks, ppq, last_tick, &|| Ok(()))
    }
    pub fn build_checked(
        tracks: &[Vec<TrackEvent<'_>>],
        ppq: u16,
        last_tick: u64,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        let mut changes = BTreeMap::from([(0, (4u8, 4u16, false))]);
        for track in tracks {
            let mut tick = 0u64;
            for (ordinal, event) in track.iter().enumerate() {
                if ordinal % 2048 == 0 {
                    check()?;
                }
                tick = tick
                    .checked_add(event.delta.as_int() as u64)
                    .ok_or("MIDI 时间超出范围")?;
                if let TrackEventKind::Meta(MetaMessage::TimeSignature(n, power, _, _)) = event.kind
                {
                    let d = 1u16.checked_shl(power.into()).ok_or("拍号分母超出范围")?;
                    length(ppq, n, d)?;
                    // Several signatures at one tick take effect in file order: the last wins
                    // (POP909 writes 4/4 and then the real 2/4 at tick 0).
                    changes.insert(tick, (n, d, true));
                }
            }
        }
        let changes = changes.into_iter().collect::<Vec<_>>();
        let mut bars = Vec::new();
        for (index, &(start, (n, d, explicit))) in changes.iter().enumerate() {
            if start >= last_tick.max(1) && !bars.is_empty() {
                break;
            }
            length(ppq, n, d)?;
            let stop = changes
                .get(index + 1)
                .map(|v| v.0)
                .unwrap_or(last_tick.max(1));
            let mut tick = start;
            let mut ordinal = 1u128;
            while tick < stop {
                if bars.len() % 2048 == 0 {
                    check()?;
                }
                let offset = (ordinal * u128::from(ppq) * 4 * u128::from(n) + u128::from(d) / 2)
                    / u128::from(d);
                ordinal += 1;
                let natural = start
                    .checked_add(u64::try_from(offset).map_err(|_| "小节时间超出范围")?)
                    .ok_or("小节时间超出范围")?;
                let end = if index + 1 < changes.len() {
                    natural.min(stop)
                } else {
                    natural
                };
                let label = i32::try_from(bars.len() + 1).map_err(|_| "小节编号超出范围")?;
                push(&mut bars, tick, end, n, d, explicit, end < natural, label)?;
                tick = end;
            }
        }
        Ok(Self {
            ppq,
            measures: bars,
        })
    }
    pub fn corrected(ppq: u16, last_tick: u64, n: u8, d: u16, pickup: u64) -> Result<Self, String> {
        Self::segmented_with_lengths(ppq, last_tick, pickup, &[(1, n, d, None)], &[])
    }
    pub fn segmented(
        ppq: u16,
        last_tick: u64,
        pickup: u64,
        segments: &[(usize, u8, u16, Option<i32>)],
    ) -> Result<Self, String> {
        Self::segmented_with_lengths(ppq, last_tick, pickup, segments, &[])
    }
    pub fn segmented_with_lengths(
        ppq: u16,
        last_tick: u64,
        pickup: u64,
        segments: &[(usize, u8, u16, Option<i32>)],
        overrides: &[(usize, u64)],
    ) -> Result<Self, String> {
        if segments.is_empty()
            || segments.len() > 1024
            || segments[0].0 != 1
            || segments.windows(2).any(|p| p[0].0 >= p[1].0)
        {
            return Err("拍号变化须从第 1 小节开始并递增".into());
        }
        for &(bar, n, d, label) in segments {
            length(ppq, n, d)?;
            if bar > 1_000_000 || label.is_some_and(|v| v < 0) {
                return Err("小节编号无效".into());
            }
        }
        length(ppq, segments[0].1, segments[0].2)?;
        if u128::from(pickup) * u128::from(segments[0].2)
            >= u128::from(ppq) * 4 * u128::from(segments[0].1)
        {
            return Err("弱起必须短于完整小节".into());
        }
        let mut lengths = BTreeMap::new();
        for &(bar, ticks) in overrides {
            if bar == 0 || ticks == 0 || lengths.insert(bar, ticks).is_some() {
                return Err("小节长度覆盖重复或无效".into());
            }
        }
        let mut measures = Vec::new();
        let mut tick = 0u64;
        let mut segment = 0usize;
        let mut label = 1i32;
        let mut remainder = 0u64;
        while tick < last_tick.max(1) {
            let ordinal = measures.len() + 1;
            while segment + 1 < segments.len() && segments[segment + 1].0 <= ordinal {
                segment += 1;
            }
            let (from, n, d, display) = segments[segment];
            if from == ordinal {
                remainder = u64::from(d) / 2;
                if let Some(value) = display {
                    label = value;
                }
            }
            length(ppq, n, d)?;
            let scaled = u64::from(ppq) * 4 * u64::from(n) + remainder;
            let full = scaled / u64::from(d);
            remainder = scaled % u64::from(d);
            let size = lengths
                .get(&ordinal)
                .copied()
                .unwrap_or(if ordinal == 1 && pickup > 0 {
                    pickup
                } else {
                    full
                });
            if lengths.contains_key(&ordinal) || (ordinal == 1 && pickup > 0) {
                remainder = u64::from(d) / 2;
            }
            let end = tick.checked_add(size).ok_or("小节时间超出范围")?;
            push(&mut measures, tick, end, n, d, true, size != full, label)?;
            tick = end;
            label = label.checked_add(1).ok_or("小节编号超出范围")?;
        }
        if segments.last().is_some_and(|s| s.0 > measures.len())
            || lengths.keys().any(|n| *n > measures.len())
        {
            return Err("小节设置超出演奏范围".into());
        }
        Ok(Self { ppq, measures })
    }
    pub fn measure_at(&self, tick: f64) -> Option<&Measure> {
        self.measures.get(
            self.measures
                .partition_point(|m| m.start_tick as f64 <= tick)
                .saturating_sub(1),
        )
    }
    pub fn beat_at(&self, tick: f64) -> f64 {
        self.measure_at(tick).map_or(1., |m| {
            1. + (tick - m.start_tick as f64) / (self.ppq as f64 * 4. / m.denominator as f64)
        })
    }
    pub fn bar_times(&self, tempo: &TempoTrack) -> Vec<Duration> {
        self.measures
            .iter()
            .map(|m| tempo.pulses_to_duration(m.start_tick))
            .collect()
    }
    pub fn beat_times(&self, tempo: &TempoTrack) -> Vec<Duration> {
        let mut result = Vec::new();
        for bar in &self.measures {
            let mut beat = 0u64;
            loop {
                let tick = bar.start_tick
                    + (beat * u64::from(self.ppq) * 4 + u64::from(bar.denominator) / 2)
                        / u64::from(bar.denominator);
                if tick >= bar.end_tick {
                    break;
                }
                result.push(tempo.pulses_to_duration(tick));
                beat += 1;
                if beat >= 1024 {
                    break;
                }
            }
        }
        result
    }
}
