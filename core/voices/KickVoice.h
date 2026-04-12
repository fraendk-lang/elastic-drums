#pragma once

#include "../DrumCore.h"
#include <cmath>

namespace elastic {

// TR-808-inspired Kick Drum Voice
// Bridged-T oscillator: sine with exponential pitch envelope + click + sub layer
class KickVoice : public DrumVoice {
public:
    KickVoice();
    void trigger(float velocity) override;
    void process(float* left, float* right, int numSamples) override;

private:
    // Oscillator state
    float phase_ = 0.0f;
    float subPhase_ = 0.0f;

    // Envelope state
    float ampEnv_ = 0.0f;
    float pitchEnv_ = 0.0f;
    float clickEnv_ = 0.0f;

    // Trigger state
    float velocity_ = 0.0f;
    bool active_ = false;

    // Internal counters
    float sampleCount_ = 0.0f;

    // Fast tanh approximation for drive
    static float fastTanh(float x) {
        float x2 = x * x;
        return x * (27.0f + x2) / (27.0f + 9.0f * x2);
    }
};

} // namespace elastic
