#pragma once
#include "../DrumCore.h"

namespace elastic {

// Cymbal/Ride: metallic square-wave oscillator bank with long decay
class CymbalVoice : public DrumVoice {
public:
    CymbalVoice(float baseFreq = 380.0f, float decayMs = 800.0f);
    void trigger(float velocity) override;
    void process(float* left, float* right, int numSamples) override;

private:
    static constexpr int kNumOsc = 6;
    static constexpr float kRatios[kNumOsc] = {1.0f, 1.4471f, 1.7409f, 1.9307f, 2.5377f, 2.7616f};

    float phases_[kNumOsc] = {};
    float ampEnv_ = 0.0f;
    float velocity_ = 0.0f;
    float defaultFreq_;
    float defaultDecay_;
    bool active_ = false;
    unsigned int noiseState_ = 12345;

    float noise() {
        noiseState_ = noiseState_ * 1664525u + 1013904223u;
        return static_cast<float>(static_cast<int>(noiseState_)) / 2147483648.0f;
    }
};

} // namespace elastic
