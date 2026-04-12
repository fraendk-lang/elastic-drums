#include "TomVoice.h"
#include <cmath>

namespace elastic {

static constexpr float kTwoPi = 6.283185307f;

TomVoice::TomVoice() {
    setParam(ParamID::Tune, 120.0f);
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
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_;

    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));
    const float pitchRate = std::exp(-1.0f / (0.025f * sampleRate_));

    for (int i = 0; i < numSamples; ++i) {
        float freq = tune + tune * 0.8f * pitchEnv_;
        float sample = std::sin(phase_) * ampEnv_ * volume;

        phase_ += kTwoPi * freq / sampleRate_;
        if (phase_ > kTwoPi) phase_ -= kTwoPi;

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
