#pragma once
#include "../DrumCore.h"

namespace elastic {

// 909-style Tom: analog pitch envelope sine oscillator
class TomVoice : public DrumVoice {
public:
    TomVoice();
    void trigger(float velocity) override;
    void process(float* left, float* right, int numSamples) override;

private:
    float phase_ = 0.0f;
    float ampEnv_ = 0.0f;
    float pitchEnv_ = 0.0f;
    float velocity_ = 0.0f;
    bool active_ = false;
};

} // namespace elastic
