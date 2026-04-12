#include "Reverb.h"

namespace elastic {

void Reverb::init(float sampleRate) {
    sampleRate_ = sampleRate;
}

void Reverb::setParams(float decay, float damping, float /*size*/) {
    decay_ = decay;
    damping_ = damping;
}

void Reverb::process(float* /*left*/, float* /*right*/, int /*numSamples*/) {
    // TODO: Full Dattorro reverb implementation (Phase 4)
}

} // namespace elastic
