#pragma once

namespace elastic {

class Compressor {
public:
    void init(float sampleRate);
    void setParams(float threshold, float ratio, float attack, float release);
    void process(float* left, float* right, int numSamples);

private:
    float sampleRate_ = 44100.0f;
    float threshold_ = -10.0f;  // dB
    float ratio_ = 4.0f;
    float attackMs_ = 10.0f;
    float releaseMs_ = 100.0f;
    float envelope_ = 0.0f;
};

} // namespace elastic
