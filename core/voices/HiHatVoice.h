#pragma once
#include "../DrumCore.h"

namespace elastic {

/**
 * Hi-Hat: Metal Oscillators + Noise + Transient + HPF
 *
 * Three layers:
 *   1. Metallic core: 6 square oscillators at inharmonic ratios (4-10kHz)
 *   2. Noise layer: shaped white noise for air/sizzle (8-16kHz)
 *   3. Transient: short click for attack definition
 *
 * Closed/Open share the same core, different amp envelopes.
 * HPF removes everything below 300-500Hz.
 */
class HiHatVoice : public DrumVoice {
public:
    HiHatVoice();
    void trigger(float velocity) override;
    void process(float* left, float* right, int numSamples) override;

    void choke() { active_ = false; ampEnv_ = 0.0f; }

private:
    static constexpr int kNumOsc = 6;
    // 909 metallic frequency ratios (inharmonic)
    static constexpr float kRatios[kNumOsc] = {
        1.0f, 1.4471f, 1.7409f, 1.9307f, 2.5377f, 2.7616f
    };

    float phases_[kNumOsc] = {};
    float ampEnv_ = 0.0f;
    float transientEnv_ = 0.0f;
    float velocity_ = 0.0f;
    bool active_ = false;

    // Highpass filter state (removes sub content)
    float hpState_ = 0.0f;

    // Noise generator (LCG)
    unsigned int noiseState_ = 12345;
    float noise() {
        noiseState_ = noiseState_ * 1664525u + 1013904223u;
        return static_cast<float>(static_cast<int>(noiseState_)) / 2147483648.0f;
    }
};

} // namespace elastic
