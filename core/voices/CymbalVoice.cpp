#include "CymbalVoice.h"
#include <cmath>

namespace elastic {

constexpr float CymbalVoice::kRatios[kNumOsc];
static constexpr float kTwoPi = 6.283185307f;

CymbalVoice::CymbalVoice(float baseFreq, float decayMs)
    : defaultFreq_(baseFreq), defaultDecay_(decayMs)
{
    setParam(ParamID::Tune, baseFreq);
    setParam(ParamID::Decay, decayMs);
    setParam(ParamID::Tone, 60.0f);
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);
}

void CymbalVoice::trigger(float velocity) {
    velocity_ = velocity;
    active_ = true;
    ampEnv_ = 1.0f;
    for (int i = 0; i < kNumOsc; i++) phases_[i] = 0.0f;
}

void CymbalVoice::process(float* left, float* right, int numSamples) {
    if (!active_) return;

    const float baseFreq = getParam(ParamID::Tune);
    const float decayMs = getParam(ParamID::Decay);
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_ * 0.25f;

    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));

    for (int i = 0; i < numSamples; ++i) {
        // Sum of metallic square-wave oscillators
        float metal = 0.0f;
        for (int o = 0; o < kNumOsc; o++) {
            float sq = (std::sin(phases_[o]) > 0.0f) ? 1.0f : -1.0f;
            metal += sq * 0.12f;
            phases_[o] += kTwoPi * baseFreq * kRatios[o] / sampleRate_;
            if (phases_[o] > kTwoPi) phases_[o] -= kTwoPi;
        }

        // Noise shimmer
        float n = noise() * 0.15f;

        float sample = (metal + n) * ampEnv_ * volume;

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
