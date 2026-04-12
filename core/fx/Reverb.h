#pragma once

namespace elastic {

// Simple algorithmic reverb (Dattorro-inspired)
class Reverb {
public:
    void init(float sampleRate);
    void setParams(float decay, float damping, float size);
    void process(float* left, float* right, int numSamples);

private:
    float sampleRate_ = 44100.0f;
    float decay_ = 0.5f;
    float damping_ = 0.5f;
    // TODO: Full Dattorro implementation in Phase 4
};

} // namespace elastic
