// C interface to Signalsmith Stretch (MIT, vendor/signalsmith-stretch) for panthesia-audio.
#include "signalsmith-stretch.h"

using Stretch = signalsmith::stretch::SignalsmithStretch<float>;

extern "C" {
void *panthesia_stretch_new(int channels, float sample_rate) {
    auto *stretch = new Stretch();
    stretch->presetDefault(channels, sample_rate);
    return stretch;
}
void panthesia_stretch_free(void *stretch) { delete static_cast<Stretch *>(stretch); }
void panthesia_stretch_reset(void *stretch) { static_cast<Stretch *>(stretch)->reset(); }
int panthesia_stretch_input_latency(const void *stretch) { return static_cast<const Stretch *>(stretch)->inputLatency(); }
int panthesia_stretch_output_latency(const void *stretch) { return static_cast<const Stretch *>(stretch)->outputLatency(); }
void panthesia_stretch_seek(void *stretch, const float *const *inputs, int input_samples, double rate) {
    static_cast<Stretch *>(stretch)->seek(inputs, input_samples, rate);
}
void panthesia_stretch_process(void *stretch, const float *const *inputs, int input_samples, float **outputs, int output_samples) {
    static_cast<Stretch *>(stretch)->process(inputs, input_samples, outputs, output_samples);
}
}
