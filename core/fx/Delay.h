#pragma once

namespace elastic {

class Delay {
public:
    void init(float sampleRate);
    void setParams(float timeMs, float feedback, float mix);
    void process(float* left, float* right, int numSamples);

private:
    float sampleRate_ = 44100.0f;
    float timeMs_ = 375.0f;
    float feedback_ = 0.4f;
    float mix_ = 0.3f;
    // TODO: Delay line buffers (Phase 4)
};

} // namespace elastic
