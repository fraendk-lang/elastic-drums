#include "PercVoice.h"
#include <cmath>

namespace elastic {

static constexpr float kTwoPi = 6.283185307f;

PercVoice::PercVoice(float freq, float decayMs)
    : defaultFreq_(freq), defaultDecay_(decayMs)
{
    setParam(ParamID::Tune, freq);
    setParam(ParamID::Decay, decayMs);
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);
}

void PercVoice::trigger(float velocity) {
    velocity_ = velocity;
    active_ = true;
    phase_ = 0.0f;
    ampEnv_ = 1.0f;
    filterState_ = 0.0f;
    filterState2_ = 0.0f;
}

void PercVoice::process(float* left, float* right, int numSamples) {
    if (!active_) return;

    const float freq = getParam(ParamID::Tune);
    const float decayMs = getParam(ParamID::Decay);
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_ * 0.5f;

    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));

    // Bandpass filter coefficients (resonant)
    const float f = 2.0f * std::sin(3.14159265f * freq / sampleRate_);
    const float q = 0.08f; // High resonance

    for (int i = 0; i < numSamples; ++i) {
        // Noise through resonant bandpass
        float input = noise();
        float high = input - filterState_ - q * filterState2_;
        filterState2_ += f * high;
        filterState_ += f * filterState2_;

        // Sine transient for body
        float sine = std::sin(phase_) * ampEnv_ * 0.3f;
        phase_ += kTwoPi * freq * 0.4f / sampleRate_;
        if (phase_ > kTwoPi) phase_ -= kTwoPi;

        float sample = (filterState2_ + sine) * ampEnv_ * volume;

        left[i] += sample;
        right[i] += sample;

        ampEnv_ *= ampRate;
        if (ampEnv_ < 0.0001f) {
            active_ = false;
            break;
        }
    }
}

} // namespace elastic
