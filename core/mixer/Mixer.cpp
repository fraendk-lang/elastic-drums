#include "Mixer.h"
#include <cmath>

namespace elastic {

void Mixer::init(float /*sampleRate*/) {
    for (auto& ch : channels_) {
        ch = ChannelState{};
    }
    anySolo_ = false;
}

void Mixer::setChannel(int ch, const ChannelState& state) {
    if (ch >= 0 && ch < kNumVoices) {
        channels_[ch] = state;
        // Recalc solo state
        anySolo_ = false;
        for (const auto& c : channels_) {
            if (c.solo) { anySolo_ = true; break; }
        }
    }
}

void Mixer::process(
    float /*voiceBuffers*/[][2],
    float* /*masterLeft*/,
    float* /*masterRight*/,
    int /*numSamples*/)
{
    // TODO: Per-voice mixing with pan, mute/solo, sends (Phase 4)
    // For now, voices write directly into the stereo bus via DrumCore::process
}

} // namespace elastic
