#include "Delay.h"

namespace elastic {

void Delay::init(float sampleRate) {
    sampleRate_ = sampleRate;
}

void Delay::setParams(float timeMs, float feedback, float mix) {
    timeMs_ = timeMs;
    feedback_ = feedback;
    mix_ = mix;
}

void Delay::process(float* /*left*/, float* /*right*/, int /*numSamples*/) {
    // TODO: Stereo delay line implementation (Phase 4)
}

} // namespace elastic
