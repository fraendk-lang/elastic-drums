#include "Compressor.h"
#include <cmath>
#include <algorithm>

namespace elastic {

void Compressor::init(float sampleRate) {
    sampleRate_ = sampleRate;
    envelope_ = 0.0f;
}

void Compressor::setParams(float threshold, float ratio, float attack, float release) {
    threshold_ = threshold;
    ratio_ = std::max(1.0f, ratio);
    attackMs_ = attack;
    releaseMs_ = release;
}

void Compressor::process(float* left, float* right, int numSamples) {
    float attackCoeff = std::exp(-1.0f / (attackMs_ * 0.001f * sampleRate_));
    float releaseCoeff = std::exp(-1.0f / (releaseMs_ * 0.001f * sampleRate_));

    for (int i = 0; i < numSamples; ++i) {
        float peak = std::max(std::abs(left[i]), std::abs(right[i]));
        float peakDb = 20.0f * std::log10(peak + 1e-10f);

        // Envelope follower
        float coeff = (peakDb > envelope_) ? attackCoeff : releaseCoeff;
        envelope_ = coeff * envelope_ + (1.0f - coeff) * peakDb;

        // Gain computation
        float gainDb = 0.0f;
        if (envelope_ > threshold_) {
            gainDb = (threshold_ - envelope_) * (1.0f - 1.0f / ratio_);
        }
        float gain = std::pow(10.0f, gainDb * 0.05f);

        left[i] *= gain;
        right[i] *= gain;
    }
}

} // namespace elastic
