#include "HiHatVoice.h"
#include <cmath>
#include <cstdlib>

namespace elastic {

static constexpr float kTwoPi = 6.283185307f;

// 909 hi-hat uses 6 square-wave oscillators at metallic ratios
static constexpr float kMetallicRatios[] = {1.0f, 1.4471f, 1.7409f, 1.9307f, 2.5377f, 2.7616f};

HiHatVoice::HiHatVoice() {
    setParam(ParamID::Tune, 320.0f);    // Base frequency
    setParam(ParamID::Decay, 80.0f);    // Short for closed, longer for open
    setParam(ParamID::Tone, 70.0f);     // Metallic vs noise mix
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);
}

void HiHatVoice::trigger(float velocity) {
    velocity_ = velocity;
    active_ = true;
    phase1_ = 0.0f;
    phase2_ = 0.0f;
    phase3_ = 0.0f;
    ampEnv_ = 1.0f;
}

void HiHatVoice::process(float* left, float* right, int numSamples) {
    if (!active_) return;

    const float tune = getParam(ParamID::Tune);
    const float decayMs = getParam(ParamID::Decay);
    const float toneMix = getParam(ParamID::Tone) * 0.01f;
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_;

    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));

    for (int i = 0; i < numSamples; ++i) {
        // Metallic oscillators (simplified: 3 detuned square waves)
        float metal = 0.0f;
        float sq1 = (std::sin(phase1_) > 0.0f) ? 1.0f : -1.0f;
        float sq2 = (std::sin(phase2_) > 0.0f) ? 1.0f : -1.0f;
        float sq3 = (std::sin(phase3_) > 0.0f) ? 1.0f : -1.0f;
        metal = (sq1 + sq2 + sq3) * 0.2f * toneMix;

        phase1_ += kTwoPi * tune * kMetallicRatios[0] / sampleRate_;
        phase2_ += kTwoPi * tune * kMetallicRatios[2] / sampleRate_;
        phase3_ += kTwoPi * tune * kMetallicRatios[4] / sampleRate_;
        if (phase1_ > kTwoPi) phase1_ -= kTwoPi;
        if (phase2_ > kTwoPi) phase2_ -= kTwoPi;
        if (phase3_ > kTwoPi) phase3_ -= kTwoPi;

        // Noise
        float noise = (static_cast<float>(rand()) / static_cast<float>(RAND_MAX) * 2.0f - 1.0f)
                       * (1.0f - toneMix * 0.5f) * 0.5f;

        float sample = (metal + noise) * ampEnv_ * volume;

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
