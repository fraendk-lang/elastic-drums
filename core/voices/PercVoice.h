#pragma once
#include "../DrumCore.h"

namespace elastic {

// Percussion: resonant filtered noise + sine transient
class PercVoice : public DrumVoice {
public:
    PercVoice(float freq = 800.0f, float decayMs = 120.0f);
    void trigger(float velocity) override;
    void process(float* left, float* right, int numSamples) override;

private:
    float phase_ = 0.0f;
    float ampEnv_ = 0.0f;
    float filterState_ = 0.0f;
    float filterState2_ = 0.0f;
    float velocity_ = 0.0f;
    float defaultFreq_;
    float defaultDecay_;
    bool active_ = false;
    unsigned int noiseState_ = 67890;

    float noise() {
        noiseState_ = noiseState_ * 1664525u + 1013904223u;
        return static_cast<float>(static_cast<int>(noiseState_)) / 2147483648.0f;
    }
};

} // namespace elastic
