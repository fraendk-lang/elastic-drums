#include "Distortion.h"
#include <cmath>

namespace elastic {

void Distortion::process(float* buffer, int numSamples) {
    if (drive_ < 0.01f) return;

    float gain = 1.0f + drive_ * 10.0f;
    for (int i = 0; i < numSamples; ++i) {
        float dry = buffer[i];
        float wet = std::tanh(buffer[i] * gain);
        buffer[i] = dry * (1.0f - mix_) + wet * mix_;
    }
}

} // namespace elastic
