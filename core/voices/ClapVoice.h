#pragma once
#include "../DrumCore.h"

namespace elastic {

// 808-style Clap: multi-trigger noise bursts
class ClapVoice : public DrumVoice {
public:
    ClapVoice();
    void trigger(float velocity) override;
    void process(float* left, float* right, int numSamples) override;

private:
    float ampEnv_ = 0.0f;
    float burstEnv_ = 0.0f;
    float velocity_ = 0.0f;
    int burstCount_ = 0;
    int burstSamples_ = 0;
    bool active_ = false;
};

} // namespace elastic
