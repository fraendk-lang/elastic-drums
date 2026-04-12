#pragma once
#include "../DrumCore.h"

namespace elastic {

// Metallic oscillator + noise for hi-hats (909-style)
// Supports choke groups: open hat chokes when closed hat triggers
class HiHatVoice : public DrumVoice {
public:
    HiHatVoice();
    void trigger(float velocity) override;
    void process(float* left, float* right, int numSamples) override;

    // Choke: instantly kill the voice (for choke groups)
    void choke() { active_ = false; ampEnv_ = 0.0f; }

private:
    float phase1_ = 0.0f;
    float phase2_ = 0.0f;
    float phase3_ = 0.0f;
    float ampEnv_ = 0.0f;
    float velocity_ = 0.0f;
    bool active_ = false;
};

} // namespace elastic
