#pragma once

#include "../DrumCore.h"

namespace elastic {

// TR-808-inspired Snare: dual oscillator (tone + noise)
class SnareVoice : public DrumVoice {
public:
    SnareVoice();
    void trigger(float velocity) override;
    void process(float* left, float* right, int numSamples) override;

private:
    float phase_ = 0.0f;
    float ampEnv_ = 0.0f;
    float noiseEnv_ = 0.0f;
    float pitchEnv_ = 0.0f;
    float velocity_ = 0.0f;
    bool active_ = false;
};

} // namespace elastic
