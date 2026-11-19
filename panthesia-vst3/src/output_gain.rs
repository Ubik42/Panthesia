use std::sync::atomic::{AtomicU32, Ordering};

pub(crate) struct OutputGain {
    target: AtomicU32,
    peak: AtomicU32,
}
impl Default for OutputGain {
    fn default() -> Self {
        Self {
            target: AtomicU32::new(1f32.to_bits()),
            peak: AtomicU32::new(0),
        }
    }
}
impl OutputGain {
    pub fn set(&self, volume: f64) {
        if volume.is_finite() {
            self.target
                .store((volume.clamp(0., 1.) as f32).to_bits(), Ordering::Relaxed);
        }
    }
    pub fn peak(&self) -> f32 {
        f32::from_bits(self.peak.load(Ordering::Relaxed))
    }
    pub fn process(&self, samples: &mut [f32], ramp: &mut GainRamp) {
        let target = f32::from_bits(self.target.load(Ordering::Relaxed));
        if target != ramp.target {
            ramp.target = target;
            ramp.remaining = ramp.frames;
            ramp.step = (target - ramp.current) / ramp.frames as f32;
        }
        let mut peak = 0f32;
        for frame in samples.chunks_mut(ramp.channels) {
            if ramp.remaining > 0 {
                ramp.remaining -= 1;
                ramp.current = if ramp.remaining == 0 {
                    ramp.target
                } else {
                    ramp.current + ramp.step
                };
            }
            for sample in frame {
                *sample *= ramp.current;
                peak = peak.max(sample.abs());
            }
        }
        self.peak.store(peak.to_bits(), Ordering::Relaxed);
    }
}
pub(crate) struct GainRamp {
    current: f32,
    target: f32,
    step: f32,
    remaining: usize,
    frames: usize,
    channels: usize,
}
impl GainRamp {
    pub fn new(sample_rate: f64, channels: usize) -> Self {
        Self {
            current: 1.,
            target: 1.,
            step: 0.,
            remaining: 0,
            frames: (sample_rate * 0.005).round().max(1.) as usize,
            channels: channels.max(1),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gain_ramps_stereo_without_changing_channel_balance_and_mutes_exactly() {
        let gain = OutputGain::default();
        let mut ramp = GainRamp::new(48_000., 2);
        gain.set(0.5);
        let mut block = vec![1.; 512];
        gain.process(&mut block, &mut ramp);
        assert!(block[0] < 1. && block[0] > 0.99);
        assert!(block.chunks(2).all(|frame| frame[0] == frame[1]));
        assert_eq!(block[511], 0.5);
        gain.set(0.);
        block.fill(1.);
        gain.process(&mut block, &mut ramp);
        assert_eq!(block[511], 0.);
        block.fill(1.);
        gain.process(&mut block, &mut ramp);
        assert!(block.iter().all(|sample| *sample == 0.));
        assert_eq!(gain.peak(), 0.);
        gain.set(0.25);
        block.fill(1.);
        gain.process(&mut block, &mut ramp);
        assert_eq!(block[511], 0.25);
    }
}
