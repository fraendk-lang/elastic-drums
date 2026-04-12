#include "TomVoice.h"
#include <cmath>

namespace elastic {

static constexpr float kTwoPi = 6.283185307f;

/**
 * Tom: Sine/Triangle + Pitch Envelope + Noise Click
 *
 * Frequency zones:
 *   Low Tom: 80-140 Hz, Mid: 120-220 Hz, High: 180-350 Hz
 *   Attack click: 2-5 kHz
 */

TomVoice::TomVoice() {
    setParam(ParamID::Tune, 140.0f);     // Set per-instance in DrumCore
    setParam(ParamID::Decay, 250.0f);
    setParam(ParamID::Tone, 60.0f);
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);
}

void TomVoice::trigger(float velocity) {
    velocity_ = velocity;
    active_ = true;
    phase_ = 0.0f;
    ampEnv_ = 1.0f;
    pitchEnv_ = 1.0f;
}

void TomVoice::process(float* left, float* right, int numSamples) {
    if (!active_) return;

    const float tune = getParam(ParamID::Tune);
    const float decayMs = getParam(ParamID::Decay);
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_ * 0.6f;

    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));
    // Pitch envelope: short drop for impact
    const float pitchRate = std::exp(-1.0f / (0.025f * sampleRate_));

    // Noise click state
    static unsigned int ns = 11111;

    for (int i = 0; i < numSamples; ++i) {
        // Pitch sweep: tune*2.2 → tune
        float freq = tune + tune * 1.2f * pitchEnv_;

        // Sine body
        float body = std::sin(phase_) * ampEnv_;

        // Second harmonic for fullness
        float harm = std::sin(phase_ * 1.5f) * ampEnv_ * 0.2f;

        phase_ += kTwoPi * freq / sampleRate_;
        if (phase_ > kTwoPi) phase_ -= kTwoPi;

        // Noise click (2-5kHz attack definition, very short)
        float click = 0.0f;
        if (pitchEnv_ > 0.3f) {
            ns = ns * 1664525u + 1013904223u;
            float n = static_cast<float>(static_cast<int>(ns)) / 2147483648.0f;
            click = n * pitchEnv_ * 0.15f;
        }

        float sample = (body + harm + click) * volume;

        left[i] += sample;
        right[i] += sample;

        ampEnv_ *= ampRate;
        pitchEnv_ *= pitchRate;

        if (ampEnv_ < 0.0001f) {
            active_ = false;
            break;
        }
    }
}

} // namespace elastic
