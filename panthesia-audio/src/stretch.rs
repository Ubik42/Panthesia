//! Pitch-preserving time stretching: Signalsmith Stretch (MIT, vendored under
//! `vendor/signalsmith-stretch`) behind a small C interface.
use std::ffi::c_void;

unsafe extern "C" {
    fn panthesia_stretch_new(channels: i32, sample_rate: f32) -> *mut c_void;
    fn panthesia_stretch_free(stretch: *mut c_void);
    fn panthesia_stretch_reset(stretch: *mut c_void);
    fn panthesia_stretch_input_latency(stretch: *const c_void) -> i32;
    fn panthesia_stretch_output_latency(stretch: *const c_void) -> i32;
    fn panthesia_stretch_seek(stretch: *mut c_void, inputs: *const *const f32, samples: i32, rate: f64);
    fn panthesia_stretch_process(stretch: *mut c_void, inputs: *const *const f32, input_samples: i32, outputs: *const *mut f32, output_samples: i32);
}

/// A stereo stretcher. Not thread-safe; owned by one audio callback.
pub struct Stretch {
    raw: *mut c_void,
}
// The stretcher is used from one thread at a time (moved into the audio callback).
unsafe impl Send for Stretch {}

impl Stretch {
    pub fn new(sample_rate: f32) -> Self {
        Self { raw: unsafe { panthesia_stretch_new(2, sample_rate) } }
    }
    pub fn reset(&mut self) {
        unsafe { panthesia_stretch_reset(self.raw) }
    }
    /// Input frames the output lags behind, plus the output's own delay (in output frames).
    pub fn latency(&self) -> (usize, usize) {
        unsafe { (panthesia_stretch_input_latency(self.raw) as usize, panthesia_stretch_output_latency(self.raw) as usize) }
    }
    /// Prime with the input just before where processing continues, for playback at `rate`.
    pub fn seek(&mut self, left: &[f32], right: &[f32], rate: f64) {
        let inputs = [left.as_ptr(), right.as_ptr()];
        unsafe { panthesia_stretch_seek(self.raw, inputs.as_ptr(), left.len().min(right.len()) as i32, rate) }
    }
    /// Stretch `left`/`right` (equal length) into the output buffers (equal length).
    pub fn process(&mut self, left: &[f32], right: &[f32], out_left: &mut [f32], out_right: &mut [f32]) {
        let inputs = [left.as_ptr(), right.as_ptr()];
        let outputs = [out_left.as_mut_ptr(), out_right.as_mut_ptr()];
        unsafe {
            panthesia_stretch_process(
                self.raw,
                inputs.as_ptr(),
                left.len().min(right.len()) as i32,
                outputs.as_ptr(),
                out_left.len().min(out_right.len()) as i32,
            )
        }
    }
}
impl Drop for Stretch {
    fn drop(&mut self) {
        unsafe { panthesia_stretch_free(self.raw) }
    }
}
