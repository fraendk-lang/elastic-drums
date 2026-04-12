#include "SnareVoice.h"
#include <cmath>
#include <cstdlib>

namespace elastic {

static constexpr float kTwoPi = 6.283185307f;

SnareVoice::SnareVoice() {
    setParam(ParamID::Tune, 180.0f);    // Tone frequency
    setParam(ParamID::Decay, 200.0f);   // Decay ms
    setParam(ParamID::Tone, 50.0f);     // Tone/Noise mix
    setParam(ParamID::Snap, 70.0f);     // Snappy (noise attack)
    setParam(ParamID::Drive, 10.0f);
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);
}

void SnareVoice::trigger(float velocity) {
    velocity_ = velocity;
    active_ = true;
    phase_ = 0.0f;
    ampEnv_ = 1.0f;
    noiseEnv_ = 1.0f;
    pitchEnv_ = 1.0f;
}

void SnareVoice::process(float* left, float* right, int numSamples) {
    if (!active_) return;

    const float tune = getParam(ParamID::Tune);
    const float decayMs = getParam(ParamID::Decay);
    const float toneMix = getParam(ParamID::Tone) * 0.01f;
    const float snap = getParam(ParamID::Snap) * 0.01f;
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_;

    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));
    const float noiseRate = std::exp(-1.0f / (decayMs * 0.0006f * sampleRate_));
    const float pitchRate = std::exp(-1.0f / (0.010f * sampleRate_));

    for (int i = 0; i < numSamples; ++i) {
        float freq = tune + tune * 0.5f * pitchEnv_;

        // Tone oscillator (sine)
        float tone = std::sin(phase_) * ampEnv_ * toneMix;
        phase_ += kTwoPi * freq / sampleRate_;
        if (phase_ > kTwoPi) phase_ -= kTwoPi;

        // Noise component
        float noise = (static_cast<float>(rand()) / static_cast<float>(RAND_MAX) * 2.0f - 1.0f)
                       * noiseEnv_ * snap * (1.0f - toneMix + 0.3f);

        float sample = (tone + noise) * volume;

        left[i] += sample;
        right[i] += sample;

        ampEnv_ *= ampRate;
        noiseEnv_ *= noiseRate;
        pitchEnv_ *= pitchRate;

        if (ampEnv_ < 0.0001f && noiseEnv_ < 0.0001f) {
            active_ = false;
            break;
        }
    }
}

} // namespace elastic
