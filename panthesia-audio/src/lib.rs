//! Accompaniment audio for a song (current-plan 3.4, R7): decode a stem file, and find where it
//! sits against the performance. Playback mixing lives in the engine's audio callback.
//!
//! Alignment compares onsets on a 10 ms grid: peaks of the audio's spectral flux (log
//! magnitude, positive differences) and the note-ons of the performance. A histogram of onset
//! time differences gives a coarse offset; local histograms in 12 s windows give anchors that
//! follow drift, and a Theil–Sen line through them the offset and rate. Continuous envelope
//! cross-correlation was tried first and failed: loudness and sustain dominate it, and a
//! repeated rhythm pulls it to the wrong period.
//!
//! Samples (2026-11-22): a Transkun transcription against its source audio — offset −14 ms,
//! rate 1.0023, 93% of onsets within 30 ms; a KAIRCI accompaniment against its MIDI played at
//! the file-name tempo — offset 0, rate 1, 59%.

pub mod stretch;

use std::path::Path;

use rustfft::{FftPlanner, num_complex::Complex32};
use symphonia::core::{
    codecs::audio::AudioDecoderOptions,
    errors::Error,
    formats::{FormatOptions, TrackType, probe::Hint},
    io::MediaSourceStream,
    meta::MetadataOptions,
};

/// Decoded audio, stereo, planar.
#[derive(Clone)]
pub struct Pcm {
    pub rate: u32,
    pub left: Vec<f32>,
    pub right: Vec<f32>,
}
impl Pcm {
    pub fn seconds(&self) -> f64 {
        self.left.len() as f64 / f64::from(self.rate)
    }
}

/// Decode WAV, FLAC, MP3 or Ogg Vorbis. Mono is duplicated; more than two channels keep the
/// first two. `limit` bounds the decoded length in seconds.
pub fn decode(path: &Path, limit: f64) -> Result<Pcm, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("音频无法读取：{e}"))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(extension);
    }
    let mut format = symphonia::default::get_probe()
        .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| format!("音频格式无法识别：{e}"))?;
    let track = format.default_track(TrackType::Audio).ok_or("文件中没有音频")?;
    let id = track.id;
    let params = track.codec_params.as_ref().and_then(|p| p.audio()).ok_or("音频参数缺失")?.clone();
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(|e| format!("音频解码器不可用：{e}"))?;
    let mut pcm = Pcm { rate: params.sample_rate.unwrap_or(0), left: Vec::new(), right: Vec::new() };
    let mut interleaved: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(Error::ResetRequired) => break,
            Err(e) => return Err(format!("音频读取中断：{e}")),
        };
        if packet.track_id != id {
            continue;
        }
        let buffer = match decoder.decode(&packet) {
            Ok(buffer) => buffer,
            Err(Error::DecodeError(_)) => continue,
            Err(e) => return Err(format!("音频解码失败：{e}")),
        };
        let spec = buffer.spec();
        if pcm.rate == 0 {
            pcm.rate = spec.rate();
        }
        let channels = spec.channels().count().max(1);
        interleaved.resize(buffer.samples_interleaved(), 0.0);
        buffer.copy_to_slice_interleaved(&mut interleaved);
        for frame in interleaved.chunks(channels) {
            pcm.left.push(frame[0]);
            pcm.right.push(*frame.get(1).unwrap_or(&frame[0]));
        }
        if pcm.rate > 0 && pcm.left.len() as f64 > limit * f64::from(pcm.rate) {
            return Err(format!("音频超过 {} 分钟", (limit / 60.0).round()));
        }
    }
    if pcm.rate == 0 || pcm.left.is_empty() {
        return Err("音频为空".into());
    }
    Ok(pcm)
}

/// Envelope frame length in seconds.
pub const HOP: f64 = 0.01;

/// Spectral-flux onset envelope on the [`HOP`] grid.
pub fn audio_onsets(pcm: &Pcm) -> Vec<f32> {
    // Mono at about 11 kHz is plenty for onsets.
    let factor = (pcm.rate / 11_025).max(1) as usize;
    let rate = pcm.rate as f64 / factor as f64;
    let mono: Vec<f32> = pcm
        .left
        .chunks(factor)
        .zip(pcm.right.chunks(factor))
        .map(|(l, r)| (l.iter().sum::<f32>() + r.iter().sum::<f32>()) / (2 * l.len()) as f32)
        .collect();
    const WINDOW: usize = 1024;
    let hop = (rate * HOP).round() as usize;
    let fft = FftPlanner::<f32>::new().plan_fft_forward(WINDOW);
    let hann: Vec<f32> = (0..WINDOW).map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / WINDOW as f32).cos()).collect();
    let frames = mono.len() / hop;
    let mut previous = vec![0f32; WINDOW / 2];
    let mut buffer = vec![Complex32::new(0.0, 0.0); WINDOW];
    let mut out = Vec::with_capacity(frames);
    for frame in 0..frames {
        let center = frame * hop;
        for (i, slot) in buffer.iter_mut().enumerate() {
            let at = (center + i).checked_sub(WINDOW / 2);
            *slot = Complex32::new(at.and_then(|a| mono.get(a)).copied().unwrap_or(0.0) * hann[i], 0.0);
        }
        fft.process(&mut buffer);
        let mut flux = 0.0;
        for (bin, value) in buffer[..WINDOW / 2].iter().enumerate() {
            let magnitude = (1.0 + 100.0 * value.norm()).ln();
            flux += (magnitude - previous[bin]).max(0.0);
            previous[bin] = magnitude;
        }
        out.push(flux);
    }
    out
}

/// Note-on envelope of a performance on the [`HOP`] grid: velocity at each onset, spread over
/// two frames. `onsets` are (seconds, velocity).
pub fn performance_onsets(onsets: &[(f64, u8)], seconds: f64) -> Vec<f32> {
    let mut out = vec![0f32; (seconds / HOP).ceil() as usize + 2];
    for &(at, velocity) in onsets {
        let frame = (at / HOP).round() as usize;
        if frame + 1 < out.len() {
            out[frame] += f32::from(velocity) / 127.0;
            out[frame + 1] += 0.5 * f32::from(velocity) / 127.0;
        }
    }
    out
}

/// Onset frames of an envelope: local maxima (±3 frames) above 1.5 × the level around them
/// (half a second either side). Nearby frames (within 30 ms) count once.
pub fn onset_frames(values: &[f32]) -> Vec<usize> {
    let n = values.len();
    let mut prefix = vec![0f64; n + 1];
    for (i, v) in values.iter().enumerate() {
        prefix[i + 1] = prefix[i] + f64::from(*v);
    }
    let mut out: Vec<usize> = Vec::new();
    for i in 0..n {
        let (a, b) = (i.saturating_sub(50), (i + 51).min(n));
        let level = ((prefix[b] - prefix[a]) / (b - a) as f64) as f32;
        let (c, d) = (i.saturating_sub(3), (i + 4).min(n));
        let peak = values[c..d].iter().all(|v| *v <= values[i]);
        if peak && values[i] > 1.5 * level && values[i] > 0.0 && out.last().is_none_or(|last| i - last > 3) {
            out.push(i);
        }
    }
    out
}

/// Where the audio sits against the performance: audio seconds = `offset` + performance
/// seconds × `rate`, refined by `anchors` (performance seconds, audio seconds) where the two
/// drift apart locally.
#[derive(Clone, Debug, PartialEq)]
pub struct Alignment {
    pub offset: f64,
    pub rate: f64,
    /// Share of performance onsets with an audio onset within 30 ms after alignment, 0..1;
    /// well below 0.5 the stem does not follow this performance.
    pub confidence: f64,
    pub anchors: Vec<(f64, f64)>,
}
impl Alignment {
    /// Audio seconds for a performance time: piecewise linear through the anchors, the fitted
    /// line outside them.
    pub fn audio_time(&self, performance: f64) -> f64 {
        let line = |t: f64| self.offset + t * self.rate;
        let at = self.anchors.partition_point(|(t, _)| *t <= performance);
        match (at.checked_sub(1).and_then(|i| self.anchors.get(i)), self.anchors.get(at)) {
            (Some(&(t0, a0)), Some(&(t1, a1))) if t1 > t0 => a0 + (performance - t0) * (a1 - a0) / (t1 - t0),
            (Some(&(t0, a0)), None) => a0 + (performance - t0) * self.rate,
            (None, Some(&(t1, a1))) => a1 - (t1 - performance) * self.rate,
            _ => line(performance),
        }
    }
}

/// Histogram of onset time differences in `range`, smoothed over ±`spread` frames: the best
/// lag (audio frame = performance frame + lag).
fn best_lag(performance: &[usize], audio: &[usize], range: std::ops::RangeInclusive<isize>, spread: usize) -> isize {
    let (low, high) = (*range.start(), *range.end());
    let mut histogram = vec![0u32; (high - low + 1).max(1) as usize];
    for &p in performance {
        let from = audio.partition_point(|&a| (a as isize) < p as isize + low);
        for &a in &audio[from..] {
            let lag = a as isize - p as isize;
            if lag > high {
                break;
            }
            histogram[(lag - low) as usize] += 1;
        }
    }
    let mut prefix = vec![0u32; histogram.len() + 1];
    for (i, v) in histogram.iter().enumerate() {
        prefix[i + 1] = prefix[i] + v;
    }
    let smoothed = |i: usize| prefix[(i + spread + 1).min(histogram.len())] - prefix[i.saturating_sub(spread)];
    low + (0..histogram.len()).max_by_key(|&i| smoothed(i)).unwrap_or(0) as isize
}

fn matched(performance: &[usize], audio: &[usize], lag: impl Fn(usize) -> isize) -> usize {
    performance
        .iter()
        .filter(|&&p| {
            let target = p as isize + lag(p);
            let at = audio.partition_point(|&a| (a as isize) < target - 3);
            audio.get(at).is_some_and(|&a| (a as isize) <= target + 3)
        })
        .count()
}

/// Align an audio onset envelope with a performance envelope; the offset is searched within
/// ±`range` seconds. A coarse lag from the whole song, then local lags in 12 s windows every
/// 5 s (each within half a second of the previous one), fitted by Theil–Sen for the line.
pub fn align(performance: &[f32], audio: &[f32], range: f64) -> Alignment {
    let (p, a) = (onset_frames(performance), onset_frames(audio));
    let frames = (range / HOP) as isize;
    let coarse = best_lag(&p, &a, -frames..=frames, 25);
    let (window, step, local) = ((12.0 / HOP) as usize, (5.0 / HOP) as usize, (0.5 / HOP) as isize);
    let mut points: Vec<(f64, f64)> = Vec::new();
    let mut previous = coarse;
    let mut start = 0;
    while start < performance.len() {
        let chosen: Vec<usize> = p.iter().copied().filter(|&f| f >= start && f < start + window).collect();
        if chosen.len() >= 8 {
            let lag = best_lag(&chosen, &a, previous - local..=previous + local, 2);
            if matched(&chosen, &a, |_| lag) * 5 >= chosen.len() * 2 {
                let center = chosen.iter().sum::<usize>() as f64 / chosen.len() as f64;
                points.push((center * HOP, (center + lag as f64) * HOP));
                previous = lag;
            }
        }
        start += step;
    }
    let (offset, rate) = if points.len() >= 2 {
        let mut slopes: Vec<f64> = Vec::new();
        for i in 0..points.len() {
            for j in i + 1..points.len() {
                let (dt, da) = (points[j].0 - points[i].0, points[j].1 - points[i].1);
                if dt > 1.0 {
                    slopes.push(da / dt);
                }
            }
        }
        slopes.sort_by(f64::total_cmp);
        let rate = slopes.get(slopes.len() / 2).copied().unwrap_or(1.0);
        let mut intercepts: Vec<f64> = points.iter().map(|(t, at)| at - rate * t).collect();
        intercepts.sort_by(f64::total_cmp);
        (intercepts[intercepts.len() / 2], rate)
    } else {
        (coarse as f64 * HOP, 1.0)
    };
    // A rate far from 1 is a different recording, not drift: keep the line, drop the anchors.
    let plausible = (rate - 1.0).abs() < 0.05;
    let alignment = Alignment {
        offset,
        rate: if plausible { rate } else { 1.0 },
        confidence: 0.0,
        anchors: if plausible { points } else { vec![] },
    };
    let hits = matched(&p, &a, |f| (alignment.audio_time(f as f64 * HOP) / HOP - f as f64).round() as isize);
    Alignment { confidence: hits as f64 / p.len().max(1) as f64, ..alignment }
}
