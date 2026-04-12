#pragma once
#include "../DrumCore.h"

namespace elastic {

// Sample playback voice for Cymbal, Ride, Perc
// Supports: µ-Law vintage mode, variable sample rate pitch, multi-layer
class SampleVoice : public DrumVoice {
public:
    SampleVoice();
    void trigger(float velocity) override;
    void process(float* left, float* right, int numSamples) override;

    // Load sample data (called from non-audio thread)
    void loadSample(const float* data, int numFrames, float originalSampleRate);

private:
    // Sample data (owned externally, just a pointer)
    const float* sampleData_ = nullptr;
    int sampleLength_ = 0;
    float originalSampleRate_ = 44100.0f;

    // Playback state
    float playPosition_ = 0.0f;
    float ampEnv_ = 0.0f;
    float velocity_ = 0.0f;
    bool active_ = false;
};

} // namespace elastic
