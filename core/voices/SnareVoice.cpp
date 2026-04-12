#include "SnareVoice.h"
#include <cmath>

namespace elastic {

static constexpr float kTwoPi = 6.283185307f;

SnareVoice::SnareVoice() {
    setParam(ParamID::Tune, 180.0f);
    setParam(ParamID::Decay, 220.0f);
    setParam(ParamID::Tone, 55.0f);     // Body/noise mix
    setParam(ParamID::Snap, 70.0f);     // Noise snap amount
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
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_ * 0.65f;

    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));
    const float noiseRate = std::exp(-1.0f / (decayMs * 0.00055f * sampleRate_));
    const float pitchRate = std::exp(-1.0f / (0.012f * sampleRate_));

    // Noise state for deterministic noise
    static unsigned int noiseState = 54321;

    for (int i = 0; i < numSamples; ++i) {
        float freq = tune + tune * 0.45f * pitchEnv_;
        float freq2 = tune * 2.2f + tune * 0.3f * pitchEnv_;

        // Body: triangle oscillator for warmth
        float bodyPhase = phase_ / kTwoPi;
        bodyPhase = bodyPhase - static_cast<int>(bodyPhase);
        float tri = bodyPhase < 0.5f ? (bodyPhase * 4.0f - 1.0f) : (3.0f - bodyPhase * 4.0f);
        float body = tri * ampEnv_ * toneMix * 0.55f;

        // Second harmonic (sine, detuned)
        float harm = std::sin(phase_ * (freq2 / freq)) * ampEnv_ * toneMix * 0.25f;

        phase_ += kTwoPi * freq / sampleRate_;
        if (phase_ > kTwoPi) phase_ -= kTwoPi;

        // Snappy noise
        noiseState = noiseState * 1664525u + 1013904223u;
        float noise = static_cast<float>(static_cast<int>(noiseState)) / 2147483648.0f;
        float snappy = noise * noiseEnv_ * snap * 0.7f;

        float sample = (body + harm + snappy) * volume;

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
