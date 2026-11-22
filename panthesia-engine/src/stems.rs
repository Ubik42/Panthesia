//! Accompaniment stems of the current song (R7): the manifest's `stem` files, decoded in the
//! background, aligned with the performance once, and played by an output stream of their own
//! (the instrument may be a MIDI device or a plug-in, so the synth's stream is not always
//! there). The player reconciles the stream with the transport every tick: stems sound while
//! a continuous mode plays, follow seeks and speed, and are moved back when they drift.
//!
//! Stems are resampled to the device rate when prepared. At the original speed the callback
//! interpolates (Catmull-Rom, for the alignment's small rate); at other practice speeds it mixes
//! the stems and stretches the mix with Signalsmith Stretch, so the pitch stays. Its latency
//! (about 120 ms) is made up by reading that far ahead after every placement.
use crate::player::Player;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
    mpsc,
};

/// One decoded stem, planar stereo at the set's rate.
struct Track {
    left: Vec<f32>,
    right: Vec<f32>,
}
struct Set {
    rate: f64,
    tracks: Vec<Track>,
}
enum Control {
    Load(Arc<Set>),
    /// Start at `frame` of the stems, advancing `step` stem frames per output frame.
    Play { frame: f64, step: f64 },
    Pause,
    Gains(Vec<f32>),
}

/// The stems' own output stream. The callback owns the audio; the player only sends controls.
struct Output {
    _stream: cpal::Stream,
    tx: Mutex<rtrb::Producer<Control>>,
    /// Retired sets come back here so the callback never frees large buffers.
    trash: Mutex<rtrb::Consumer<Arc<Set>>>,
    /// Current stem frame (f64 bits), published by the callback.
    position: Arc<AtomicU64>,
    rate: f64,
    /// Set by the stream when the device fails.
    failure: Arc<Mutex<Option<String>>>,
}

fn catmull(samples: &[f32], at: f64) -> f32 {
    let i = at.floor() as isize;
    let t = (at - i as f64) as f32;
    let get = |k: isize| if k >= 0 { samples.get(k as usize).copied().unwrap_or(0.0) } else { 0.0 };
    let (p0, p1, p2, p3) = (get(i - 1), get(i), get(i + 1), get(i + 2));
    p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)))
}

impl Output {
    fn open() -> Result<Self, String> {
        let device = cpal::default_host().default_output_device().ok_or("没有可用的音频输出设备")?;
        let supported = device.default_output_config().map_err(|e| e.to_string())?;
        let format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let channels = config.channels as usize;
        let rate = f64::from(config.sample_rate);
        let (tx, mut rx) = rtrb::RingBuffer::<Control>::new(64);
        let (mut trash_tx, trash) = rtrb::RingBuffer::<Arc<Set>>::new(8);
        let position = Arc::new(AtomicU64::new(0f64.to_bits()));
        let published = position.clone();
        let mut stretch = panthesia_audio::stretch::Stretch::new(rate as f32);
        let (input_latency, output_latency) = stretch.latency();
        // Room for one block at the fastest speed (2x), allocated once.
        const BLOCK: usize = 1024;
        let room = (BLOCK * 2 + 8).max(input_latency * 2);
        let (mut mix_l, mut mix_r) = (vec![0f32; room], vec![0f32; room]);
        let (mut out_l, mut out_r) = (vec![0f32; BLOCK], vec![0f32; BLOCK]);
        let (mut set, mut frame, mut step, mut playing, mut gains) = (None::<Arc<Set>>, 0f64, 1f64, false, Vec::<f32>::new());
        // Stretching: how far reading runs ahead of what is heard, and the fractional input.
        let (mut lead, mut carry) = (0f64, 0f64);
        let mix = |set: &Set, gains: &[f32], from: f64, l: &mut [f32], r: &mut [f32]| {
            let start = from.floor() as isize;
            for (k, (a, b)) in l.iter_mut().zip(r.iter_mut()).enumerate() {
                let (mut x, mut y) = (0f32, 0f32);
                let at = start + k as isize;
                if at >= 0 {
                    for (track, gain) in set.tracks.iter().zip(gains) {
                        if *gain > 0.0 {
                            x += track.left.get(at as usize).copied().unwrap_or(0.0) * gain;
                            y += track.right.get(at as usize).copied().unwrap_or(0.0) * gain;
                        }
                    }
                }
                *a = x;
                *b = y;
            }
        };
        let mut render = move |out: &mut [f32]| {
            while let Ok(control) = rx.pop() {
                match control {
                    Control::Load(next) => {
                        if let Some(old) = set.replace(next) {
                            let _ = trash_tx.push(old);
                        }
                        playing = false;
                    }
                    Control::Play { frame: at, step: s } => {
                        step = s;
                        playing = true;
                        carry = 0.0;
                        if (step - 1.0).abs() < 0.002 {
                            frame = at;
                            lead = 0.0;
                        } else {
                            // Read ahead by the stretcher's delay, primed with what precedes.
                            lead = input_latency as f64 + output_latency as f64 * step;
                            frame = (at + lead).floor();
                            stretch.reset();
                            if let Some(set) = set.as_ref() {
                                let prime = input_latency * 2;
                                mix(set, &gains, frame - prime as f64, &mut mix_l[..prime], &mut mix_r[..prime]);
                                stretch.seek(&mix_l[..prime], &mix_r[..prime], step);
                            }
                        }
                    }
                    Control::Pause => playing = false,
                    Control::Gains(values) => gains = values,
                }
            }
            out.fill(0.0);
            let Some(set) = set.as_ref().filter(|_| playing) else { return };
            if lead == 0.0 {
                for output in out.chunks_mut(channels) {
                    let (mut l, mut r) = (0f32, 0f32);
                    for (track, gain) in set.tracks.iter().zip(&gains) {
                        if *gain > 0.0 {
                            l += catmull(&track.left, frame) * gain;
                            r += catmull(&track.right, frame) * gain;
                        }
                    }
                    for (i, sample) in output.iter_mut().enumerate() {
                        *sample = if i % 2 == 0 { l } else { r };
                    }
                    frame += step;
                }
            } else {
                for block in out.chunks_mut(channels * BLOCK) {
                    let frames = block.len() / channels;
                    let wanted = carry + frames as f64 * step;
                    let input = (wanted.floor() as usize).min(mix_l.len());
                    carry = wanted - input as f64;
                    mix(set, &gains, frame, &mut mix_l[..input], &mut mix_r[..input]);
                    stretch.process(&mix_l[..input], &mix_r[..input], &mut out_l[..frames], &mut out_r[..frames]);
                    for (k, output) in block.chunks_mut(channels).enumerate() {
                        for (i, sample) in output.iter_mut().enumerate() {
                            *sample = if i % 2 == 0 { out_l[k] } else { out_r[k] };
                        }
                    }
                    frame += input as f64;
                }
            }
            published.store((frame - lead).to_bits(), Ordering::Relaxed);
        };
        let mut scratch = vec![0f32; 8192 * channels];
        let failure = Arc::new(Mutex::new(None));
        macro_rules! stream {
            ($t:ty) => {
                device.build_output_stream(
                    config,
                    move |out: &mut [$t], _: &cpal::OutputCallbackInfo| {
                        for chunk in out.chunks_mut(scratch.len()) {
                            let buffer = &mut scratch[..chunk.len()];
                            render(buffer);
                            for (sample, value) in chunk.iter_mut().zip(buffer.iter()) {
                                *sample = <$t as cpal::FromSample<f32>>::from_sample_(*value);
                            }
                        }
                    },
                    {
                        let failure = failure.clone();
                        move |error| {
                            if let Ok(mut slot) = failure.lock() {
                                *slot = Some(format!("伴奏音频流中断：{error}"));
                            }
                        }
                    },
                    None,
                )
            };
        }
        let stream = match format {
            cpal::SampleFormat::F32 => stream!(f32),
            cpal::SampleFormat::I16 => stream!(i16),
            cpal::SampleFormat::I32 => stream!(i32),
            cpal::SampleFormat::U16 => stream!(u16),
            _ => return Err(format!("伴奏暂不支持此音频格式：{format:?}")),
        }
        .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(Self { _stream: stream, tx: Mutex::new(tx), trash: Mutex::new(trash), position, rate, failure })
    }
    fn send(&self, control: Control) {
        if let Ok(mut tx) = self.tx.lock() {
            let _ = tx.push(control);
        }
        if let Ok(mut trash) = self.trash.lock() {
            while trash.pop().is_ok() {}
        }
    }
}

/// A stem as the interface shows it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StemState {
    /// `vocals`, `accompaniment`, `piano`, `other`.
    pub kind: String,
    pub label: String,
    pub gain: f64,
}
/// Stems of the current song in the pushed state.
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StemsState {
    pub loading: bool,
    pub error: Option<String>,
    pub stems: Vec<StemState>,
    /// Share of onsets matched by the alignment, 0..1, and the found offset in seconds.
    pub confidence: Option<f64>,
    pub offset: Option<f64>,
    /// While playing: how far the stems are from where the performance is, in ms, and how
    /// often they were moved back (drift over 40 ms) since they started.
    pub drift_ms: Option<f64>,
    pub corrections: u32,
}

struct Prepared {
    set: Arc<Set>,
    alignment: panthesia_audio::Alignment,
    stems: Vec<StemState>,
}

/// Decoded stems and their alignment, prepared off the player thread.
pub(crate) struct Stems {
    content_id: String,
    output: Option<Output>,
    prepared: Option<Prepared>,
    loading: Option<mpsc::Receiver<Result<Prepared, String>>>,
    error: Option<String>,
    /// When the stream was last placed, and at which step; drift is judged only after the
    /// callback has had time to report from the new place.
    sent: Option<(std::time::Instant, f64)>,
    drift_ms: Option<f64>,
    corrections: u32,
    /// Last transport position seen while playing, to tell a seek from drift.
    transport: Option<(std::time::Instant, f64)>,
}

/// The stem files of `music`'s manifest: (path, kind, label).
fn stem_files(music: &std::path::Path) -> Vec<(PathBuf, String, String)> {
    let Some(found) = panthesia_core::manifest_store::locate(music).ok().flatten() else { return vec![] };
    let Some(dir) = found.path.parent() else { return vec![] };
    found
        .manifest
        .files
        .iter()
        .filter(|f| f.role == "stem")
        .map(|f| {
            let kind = f.stem.clone().unwrap_or_else(|| "other".into());
            let label = f.label.clone().unwrap_or_else(|| match kind.as_str() {
                "vocals" => "人声".into(),
                "accompaniment" => "伴奏".into(),
                "piano" => "钢琴".into(),
                _ => "其他".into(),
            });
            (panthesia_core::manifest_store::resolve(dir, &f.path), kind, label)
        })
        .collect()
}

/// `rate` is the output device's; stems are resampled to it here, off the audio thread.
fn prepare(files: Vec<(PathBuf, String, String)>, onsets: Vec<(f64, u8)>, seconds: f64, rate: f64) -> Result<Prepared, String> {
    let mut decoded = Vec::new();
    for (path, kind, label) in files {
        let pcm = panthesia_audio::decode(&path, 30.0 * 60.0).map_err(|e| format!("{}：{e}", path.display()))?;
        decoded.push((pcm, kind, label));
    }
    let source_rate = decoded[0].0.rate;
    if decoded.iter().any(|(pcm, ..)| pcm.rate != source_rate) {
        return Err("伴奏文件的采样率不一致".into());
    }
    // Vocals cannot be matched with piano notes: align a stem with the piano in it and let
    // the others, cut from the same recording, share its timing.
    let reference = decoded
        .iter()
        .position(|(_, kind, _)| kind == "piano" || kind == "accompaniment")
        .or_else(|| decoded.iter().position(|(_, kind, _)| kind != "vocals"));
    let alignment = match reference {
        Some(index) => {
            let audio = panthesia_audio::audio_onsets(&decoded[index].0);
            let performance = panthesia_audio::performance_onsets(&onsets, seconds);
            panthesia_audio::align(&performance, &audio, 20.0)
        }
        None => panthesia_audio::Alignment { offset: 0.0, rate: 1.0, confidence: 0.0, anchors: vec![] },
    };
    // The piano itself doubles the instrument: off by default, the rest on.
    let stems = decoded
        .iter()
        .map(|(_, kind, label)| StemState { kind: kind.clone(), label: label.clone(), gain: if kind == "piano" || kind == "accompaniment" { 0.0 } else { 1.0 } })
        .collect();
    let ratio = f64::from(source_rate) / rate;
    let resample = |samples: Vec<f32>| -> Vec<f32> {
        if (ratio - 1.0).abs() < 1e-9 {
            return samples;
        }
        let length = (samples.len() as f64 / ratio).floor() as usize;
        (0..length).map(|i| catmull(&samples, i as f64 * ratio)).collect()
    };
    let set = Set { rate, tracks: decoded.into_iter().map(|(pcm, ..)| Track { left: resample(pcm.left), right: resample(pcm.right) }).collect() };
    Ok(Prepared { set: Arc::new(set), alignment, stems })
}

impl Player {
    /// Start preparing the stems of the loaded song (if its manifest has any).
    pub(crate) fn load_stems(&mut self) {
        self.stems = None;
        let Some(file) = self.source_file.as_ref().or(self.file.as_ref()) else { return };
        let Some(music) = file.source_path.clone() else { return };
        let files = stem_files(&music);
        if files.is_empty() {
            return;
        }
        let onsets: Vec<(f64, u8)> = file.tracks.iter().flat_map(|t| t.notes.iter().map(|n| (n.start.as_secs_f64(), n.velocity))).collect();
        let seconds = file.duration.as_secs_f64();
        let content_id = file.content_id.clone();
        // A silent engine (tests, the browser debug service) prepares but never plays.
        let (output, error) = if self.silent {
            (None, None)
        } else {
            match Output::open() {
                Ok(output) => (Some(output), None),
                Err(error) => (None, Some(error)),
            }
        };
        let rate = output.as_ref().map_or(48_000.0, |o| o.rate);
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("panthesia-stems".into())
            .spawn(move || {
                let _ = tx.send(prepare(files, onsets, seconds, rate));
            })
            .ok();
        self.stems = Some(Stems { content_id, output, prepared: None, loading: Some(rx), error, sent: None, drift_ms: None, corrections: 0, transport: None });
    }

    pub(crate) fn stems_state(&self) -> Option<StemsState> {
        let stems = self.stems.as_ref()?;
        Some(StemsState {
            loading: stems.loading.is_some(),
            error: stems.error.clone().or_else(|| stems.output.as_ref().and_then(|o| o.failure.lock().ok().and_then(|f| f.clone()))),
            stems: stems.prepared.as_ref().map(|p| p.stems.clone()).unwrap_or_default(),
            confidence: stems.prepared.as_ref().map(|p| p.alignment.confidence),
            offset: stems.prepared.as_ref().map(|p| p.alignment.offset),
            drift_ms: stems.drift_ms,
            corrections: stems.corrections,
        })
    }

    /// Set the gain (0..1.5) of the stems of `kind`.
    pub(crate) fn set_stem_gain(&mut self, kind: &str, gain: f64) -> Result<(), String> {
        let stems = self.stems.as_mut().and_then(|s| s.prepared.as_mut().map(|p| (p, &s.output))).ok_or("这首歌没有可用的伴奏")?;
        let (prepared, output) = stems;
        let mut found = false;
        for stem in prepared.stems.iter_mut().filter(|s| s.kind == kind) {
            stem.gain = gain.clamp(0.0, 1.5);
            found = true;
        }
        if !found {
            return Err("没有这一类伴奏".into());
        }
        if let Some(output) = output {
            output.send(Control::Gains(prepared.stems.iter().map(|s| s.gain as f32).collect()));
        }
        Ok(())
    }

    /// Keep the stems' stream in step with the transport. Called every tick.
    pub(crate) fn reconcile_stems(&mut self) {
        let playing = self.state.status == "playing" && crate::is_timed_mode(&self.state.mode) && !self.state.recording;
        let (position, speed) = (self.state.position, self.state.speed);
        // Stems belong to the song; a practice variant or meter fix replaces the played file.
        let current = self.source_file.as_ref().or(self.file.as_ref()).map(|f| f.content_id.clone());
        let Some(stems) = self.stems.as_mut() else { return };
        if current.as_deref() != Some(stems.content_id.as_str()) {
            self.stems = None;
            return;
        }
        if let Some(rx) = &stems.loading {
            match rx.try_recv() {
                Ok(Ok(prepared)) => {
                    stems.loading = None;
                    if let Some(output) = &stems.output {
                        output.send(Control::Load(prepared.set.clone()));
                        output.send(Control::Gains(prepared.stems.iter().map(|s| s.gain as f32).collect()));
                    }
                    stems.prepared = Some(prepared);
                }
                Ok(Err(error)) => {
                    stems.loading = None;
                    stems.error = Some(error);
                }
                Err(mpsc::TryRecvError::Empty) => return,
                Err(mpsc::TryRecvError::Disconnected) => {
                    stems.loading = None;
                    stems.error = Some("伴奏准备中断".into());
                }
            }
        }
        let (Some(output), Some(prepared)) = (&stems.output, &stems.prepared) else { return };
        if !playing {
            if stems.sent.take().is_some() {
                output.send(Control::Pause);
            }
            stems.drift_ms = None;
            stems.transport = None;
            return;
        }
        let alignment = &prepared.alignment;
        let target = alignment.audio_time(position) * prepared.set.rate;
        let step = speed * alignment.rate;
        let actual = f64::from_bits(output.position.load(Ordering::Relaxed));
        // Re-place the stems when they start, change speed, or drift by more than 40 ms.
        let settled = stems.sent.is_some_and(|(at, _)| at.elapsed() > std::time::Duration::from_millis(300));
        // A seek moves the transport by more than playing could have: place, do not count it.
        let now = std::time::Instant::now();
        let jumped = stems.transport.is_some_and(|(at, last)| (position - last - now.duration_since(at).as_secs_f64() * speed).abs() > 0.1);
        stems.transport = Some((now, position));
        let drifted = settled && !jumped && (actual - target).abs() > 0.04 * prepared.set.rate;
        if settled {
            stems.drift_ms = Some(((actual - target) / prepared.set.rate * 1000.0 * 10.0).round() / 10.0);
        }
        if drifted {
            stems.corrections += 1;
        }
        if stems.sent.is_none_or(|(_, sent)| (sent - step).abs() > 1e-9) || drifted || jumped {
            output.send(Control::Play { frame: target, step });
            stems.sent = Some((std::time::Instant::now(), step));
        }
    }
}
