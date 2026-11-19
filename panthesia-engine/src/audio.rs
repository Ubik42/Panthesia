use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::{
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    },
};

#[derive(Clone, Copy)]
struct MidiPacket {
    bytes: [u8; 3],
    len: u8,
}
impl MidiPacket {
    fn from_slice(bytes: &[u8]) -> Option<Self> {
        if bytes.is_empty() || bytes.len() > 3 {
            return None;
        }
        let mut packet = Self {
            bytes: [0; 3],
            len: bytes.len() as u8,
        };
        packet.bytes[..bytes.len()].copy_from_slice(bytes);
        Some(packet)
    }
    fn as_slice(&self) -> &[u8] {
        &self.bytes[..usize::from(self.len)]
    }
}

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Performance {
    pub callbacks: u64,
    pub max_render_us: u64,
    pub over_budget_callbacks: u64,
    pub max_frames: u64,
}
#[derive(Default)]
struct Counters {
    callbacks: AtomicU64,
    max_render_us: AtomicU64,
    over_budget: AtomicU64,
    max_frames: AtomicU64,
}
pub struct Audio {
    counters: Arc<Counters>,
    _stream: cpal::Stream,
    tx: Mutex<rtrb::Producer<(u64, MidiPacket)>>,
    generation: Arc<AtomicU64>,
    panic: Arc<AtomicBool>,
    volume: Arc<AtomicU32>,
    click: Arc<AtomicU32>,
    error: Arc<Mutex<Option<String>>>,
    peak: Arc<AtomicU32>,
}

fn send(synth: &mut oxisynth::Synth, bytes: &[u8]) {
    use oxisynth::MidiEvent as E;
    let Some(&status) = bytes.first() else { return };
    let channel = status & 15;
    let a = bytes.get(1).copied().unwrap_or(0) & 127;
    let b = bytes.get(2).copied().unwrap_or(0) & 127;
    let event = match status & 240 {
        128 => E::NoteOff { channel, key: a },
        144 if b == 0 => E::NoteOff { channel, key: a },
        144 => E::NoteOn {
            channel,
            key: a,
            vel: b,
        },
        160 => E::PolyphonicKeyPressure {
            channel,
            key: a,
            value: b,
        },
        176 => E::ControlChange {
            channel,
            ctrl: a,
            value: b,
        },
        192 => E::ProgramChange {
            channel,
            program_id: a,
        },
        208 => E::ChannelPressure { channel, value: a },
        224 => E::PitchBend {
            channel,
            value: u16::from(a) | (u16::from(b) << 7),
        },
        _ => return,
    };
    let _ = synth.send_event(event);
}

impl Audio {
    pub fn devices() -> Result<Vec<serde_json::Value>, String> {
        let host = cpal::default_host();
        let default = host.default_output_device().map(|d| {
            d.id()
                .map(|id| id.to_string())
                .unwrap_or_else(|_| d.to_string())
        });
        Ok(host.output_devices().map_err(|e|e.to_string())?.map(|d| {
            let id=d.id().map(|id|id.to_string()).unwrap_or_else(|_|d.to_string());
            serde_json::json!({"default":default.as_ref()==Some(&id),"id":id,"name":d.to_string()})
        }).collect())
    }
    pub fn device(name: Option<&str>) -> Result<cpal::Device, String> {
        let host = cpal::default_host();
        match name {
            None => host
                .default_output_device()
                .ok_or_else(|| "没有可用的扬声器或耳机".into()),
            Some(name) => host
                .output_devices()
                .map_err(|e| e.to_string())?
                .find(|d| d.id().is_ok_and(|id| id.to_string() == name) || d.to_string() == name)
                .ok_or_else(|| "所选发声设备已断开，请重新选择扬声器或耳机".into()),
        }
    }
    pub fn check_soundfont_path(path: &Path) -> Result<(), String> {
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("sf2"))
        {
            return Err("请选择 .sf2 音色文件".into());
        }
        let metadata = std::fs::metadata(path).map_err(|e| format!("无法读取音色文件：{e}"))?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 512 * 1024 * 1024 {
            return Err("音色文件必须是大小不超过 512 MB 的有效 .sf2 文件".into());
        }
        Ok(())
    }
    pub fn prepare_font(path: &Path) -> Result<oxisynth::SoundFont, String> {
        Self::check_soundfont_path(path)?;
        let mut file = std::fs::File::open(path).map_err(|e| format!("无法读取音色文件：{e}"))?;
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            oxisynth::SoundFont::load(&mut file)
        }))
        .map_err(|_| "音色文件结构无法解析，请选择有效的 .sf2 文件".to_string())?
        .map_err(|e| format!("音色文件无效：{e}"))
    }
    pub fn validate_soundfont(path: &Path) -> Result<(), String> {
        Self::prepare_font(path).map(|_| ())
    }
    pub fn open(path: &Path) -> Result<Self, String> {
        Self::open_font(Self::prepare_font(path)?)
    }
    /// Call on the thread that will own the stream; font decoding may happen separately.
    pub fn open_font(font: oxisynth::SoundFont) -> Result<Self, String> {
        Self::open_font_device(font, None)
    }
    pub fn open_font_device(font: oxisynth::SoundFont, name: Option<&str>) -> Result<Self, String> {
        let device = Self::device(name)?;
        let supported = device.default_output_config().map_err(|e| e.to_string())?;
        let format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let mut synth = oxisynth::Synth::new(oxisynth::SynthDescriptor {
            sample_rate: config.sample_rate as f32,
            gain: 0.35,
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;
        synth.add_font(font, true);
        let (tx, mut rx) = rtrb::RingBuffer::<(u64, MidiPacket)>::new(2048);
        let panic = Arc::new(AtomicBool::new(false));
        let panic_callback = panic.clone();
        let volume = Arc::new(AtomicU32::new(1f32.to_bits()));
        let volume_callback = volume.clone();
        let click = Arc::new(AtomicU32::new(0));
        let click_callback = click.clone();
        let sample_rate = config.sample_rate as f32;
        let mut remaining = 0usize;
        let generation = Arc::new(AtomicU64::new(0));
        let generation_callback = generation.clone();
        let mut phase = 0f32;
        let mut frequency = 1000f32;
        let channels = config.channels as usize;
        let peak = Arc::new(AtomicU32::new(0));
        let callback_peak = peak.clone();
        // MIDI/control work is bounded at 64-frame boundaries, never repeated per sample.
        let mut render = move |out: &mut [f32]| {
            let gain = f32::from_bits(volume_callback.load(Ordering::Relaxed));
            let mut block_peak = 0f32;
            for quantum in out.chunks_mut(channels * 64) {
                if panic_callback.swap(false, Ordering::AcqRel) {
                    remaining = 0;
                    click_callback.store(0, Ordering::Relaxed);
                    for channel in 0..16 {
                        send(&mut synth, &[176 | channel, 64, 0]);
                        let _ = synth.send_event(oxisynth::MidiEvent::AllSoundOff { channel });
                    }
                }
                let epoch = generation_callback.load(Ordering::Acquire);
                for _ in 0..128 {
                    match rx.pop() {
                        Ok((g, b)) if g == epoch => send(&mut synth, b.as_slice()),
                        Ok(_) => {}
                        Err(_) => break,
                    }
                }
                let request = click_callback.swap(0, Ordering::Relaxed);
                if request > 0 {
                    remaining = (sample_rate * 0.04) as usize;
                    phase = 0.;
                    frequency = if request == 2 { 1500. } else { 1000. };
                }
                for frame in quantum.chunks_mut(channels) {
                    let tone = if remaining > 0 {
                        remaining -= 1;
                        phase += frequency / sample_rate * std::f32::consts::TAU;
                        phase.sin() * 0.16 * (remaining as f32 / (sample_rate * 0.04))
                    } else {
                        0.
                    };
                    let (l, r) = synth.read_next();
                    let (l, r) = ((l + tone) * gain, (r + tone) * gain);
                    block_peak = block_peak.max(l.abs()).max(r.abs());
                    for (i, sample) in frame.iter_mut().enumerate() {
                        *sample = if i % 2 == 0 { l } else { r };
                    }
                }
            }
            callback_peak.fetch_max(block_peak.to_bits(), Ordering::Relaxed);
        };
        // One reusable conversion buffer supports all device sample formats.
        // No allocation or blocking control-side mutex is used in the normal callback.
        let mut scratch = vec![0f32; 4096 * channels];
        let counters = Arc::new(Counters::default());
        let callback_counters = counters.clone();
        let error = Arc::new(Mutex::new(None));
        let error_callback = error.clone();
        macro_rules! stream {
            ($t:ty) => {
                device.build_output_stream(
                    config,
                    move |out: &mut [$t], _: &cpal::OutputCallbackInfo| {
                        let started = std::time::Instant::now();
                        let frames = out.len() / channels;
                        for chunk in out.chunks_mut(scratch.len()) {
                            let buffer = &mut scratch[..chunk.len()];
                            render(buffer);
                            for (sample, value) in chunk.iter_mut().zip(buffer.iter()) {
                                *sample = <$t as cpal::FromSample<f32>>::from_sample_(*value);
                            }
                        }
                        let micros = started.elapsed().as_micros() as u64;
                        callback_counters.callbacks.fetch_add(1, Ordering::Relaxed);
                        callback_counters
                            .max_render_us
                            .fetch_max(micros, Ordering::Relaxed);
                        callback_counters
                            .max_frames
                            .fetch_max(frames as u64, Ordering::Relaxed);
                        if micros as f64 > frames as f64 / f64::from(sample_rate) * 1_000_000. {
                            callback_counters
                                .over_budget
                                .fetch_add(1, Ordering::Relaxed);
                        }
                    },
                    move |error| {
                        if let Ok(mut state) = error_callback.lock() {
                            *state = Some(format!("内置音频流已中断：{error}"));
                        }
                    },
                    None,
                )
            };
        }
        let stream = match format {
            cpal::SampleFormat::F32 => stream!(f32),
            cpal::SampleFormat::F64 => stream!(f64),
            cpal::SampleFormat::I16 => stream!(i16),
            cpal::SampleFormat::I32 => stream!(i32),
            cpal::SampleFormat::U16 => stream!(u16),
            _ => return Err(format!("暂不支持此音频格式：{format:?}")),
        }
        .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(Self {
            _stream: stream,
            counters,
            tx: Mutex::new(tx),
            generation,
            panic,
            volume,
            click,
            error,
            peak,
        })
    }
    pub fn performance(&self) -> Performance {
        let c = &self.counters;
        Performance {
            callbacks: c.callbacks.load(Ordering::Relaxed),
            max_render_us: c.max_render_us.load(Ordering::Relaxed),
            over_budget_callbacks: c.over_budget.load(Ordering::Relaxed),
            max_frames: c.max_frames.load(Ordering::Relaxed),
        }
    }
    pub fn error(&self) -> Option<String> {
        self.error.try_lock().ok().and_then(|error| error.clone())
    }
    pub fn peak(&self) -> f32 {
        f32::from_bits(self.peak.swap(0, Ordering::Relaxed))
    }
    pub fn send(&self, bytes: &[u8]) {
        let Some(packet) = MidiPacket::from_slice(bytes) else {
            return;
        };
        let sent = self.tx.lock().is_ok_and(|mut tx| {
            tx.push((self.generation.load(Ordering::Acquire), packet))
                .is_ok()
        });
        if !sent {
            self.stop();
        }
    }
    pub fn stop(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        self.panic.store(true, Ordering::Release);
    }
    pub fn click(&self, accent: bool) {
        self.click
            .store(if accent { 2 } else { 1 }, Ordering::Relaxed);
    }
    pub fn set_volume(&self, value: f64) {
        self.volume
            .store((value as f32).to_bits(), Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn track_volume_controls_rendered_sound_without_changing_velocity() {
        fn energy(volume: u8) -> f64 {
            let mut synth = oxisynth::Synth::new(Default::default()).unwrap();
            let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../default.sf2");
            let font = oxisynth::SoundFont::load(&mut std::fs::File::open(path).unwrap()).unwrap();
            synth.add_font(font, true);
            send(&mut synth, &[193, 0]);
            send(&mut synth, &[177, 7, volume]);
            send(&mut synth, &[145, 60, 80]);
            (0..8192)
                .map(|_| {
                    let (l, r) = synth.read_next();
                    f64::from(l * l + r * r)
                })
                .sum()
        }
        let full = energy(100);
        assert!(full > 0.0001);
        assert!(energy(0) < full * 0.001);
    }
}
