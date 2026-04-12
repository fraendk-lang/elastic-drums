#pragma once

#include "../DrumCore.h"

namespace elastic {

struct ChannelState {
    float volume = 1.0f;
    float pan = 0.0f;       // -1..1
    float sendA = 0.0f;     // Reverb send
    float sendB = 0.0f;     // Delay send
    bool mute = false;
    bool solo = false;
};

class Mixer {
public:
    void init(float sampleRate);
    void setChannel(int ch, const ChannelState& state);

    // Mix voice outputs to master stereo bus
    void process(
        float voiceBuffers[][2],  // [voice][L/R] per sample
        float* masterLeft,
        float* masterRight,
        int numSamples
    );

private:
    std::array<ChannelState, kNumVoices> channels_;
    float masterVolume_ = 1.0f;
    bool anySolo_ = false;
};

} // namespace elastic
