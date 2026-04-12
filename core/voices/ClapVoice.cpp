#include "ClapVoice.h"
#include <cmath>

namespace elastic {

/**
 * Clap: Multiple non-uniform noise bursts + bandpass + room tail
 *
 * Frequency zones:
 *   Body: 700Hz - 1.5kHz
 *   Presence: 1.5-4kHz
 *   Air: 6-10kHz
 *
 * Key: bursts are NOT uniform — slight randomness in timing
 */

ClapVoice::ClapVoice() {
    setParam(ParamID::Decay, 350.0f);
    setParam(ParamID::Tone, 50.0f);
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);
}

void ClapVoice::trigger(float velocity) {
    velocity_ = velocity;
    active_ = true;
    ampEnv_ = 1.0f;
    burstEnv_ = 1.0f;
    burstCount_ = 0;
    burstSamples_ = 0;
}

void ClapVoice::process(float* left, float* right, int numSamples) {
    if (!active_) return;

    const float decayMs = getParam(ParamID::Decay);
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_ * 0.7f;
    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));

    // Non-uniform burst intervals (0, ~8ms, ~11ms, ~14ms) — slight variation
    const int burstIntervals[4] = {
        0,
        static_cast<int>(sampleRate_ * 0.008f),
        static_cast<int>(sampleRate_ * 0.011f),
        static_cast<int>(sampleRate_ * 0.014f),
    };

    // Per-instance state (no static!)
    float bpLow = 0.0f, bpBand = 0.0f;
    unsigned int ns = 98765 + static_cast<unsigned int>(burstSamples_);

    for (int i = 0; i < numSamples; ++i) {
        ns = ns * 1664525u + 1013904223u;
        float noise = static_cast<float>(static_cast<int>(ns)) / 2147483648.0f;

        // === Burst phase: 4 non-uniform noise bursts ===
        float burstGain = 1.0f;
        if (burstCount_ < 4) {
            burstSamples_++;
            if (burstCount_ < 3 && burstSamples_ >= burstIntervals[burstCount_ + 1]) {
                burstCount_++;
                burstEnv_ = 1.0f;
                burstSamples_ = 0;
            } else if (burstCount_ >= 3 && burstSamples_ > static_cast<int>(sampleRate_ * 0.006f)) {
                burstCount_ = 4; // End burst phase
            }
            // Each burst has fast decay
            burstGain = burstEnv_ > 0.15f ? 1.0f : 0.2f;
            burstEnv_ *= std::exp(-1.0f / (0.004f * sampleRate_));
        }

        // === Bandpass filter (SVF) targeting 1.5kHz center ===
        float bpFreq = 2.0f * std::sin(3.14159f * 1500.0f / sampleRate_);
        float bpQ = 0.5f;  // Moderate resonance for body
        float high = noise - bpLow - bpQ * bpBand;
        bpBand += bpFreq * high;
        bpLow += bpFreq * bpBand;

        float filtered = bpBand; // Bandpass output

        float sample = filtered * ampEnv_ * burstGain * volume;

        left[i] += sample;
        right[i] += sample;

        ampEnv_ *= ampRate;
        if (ampEnv_ < 0.0001f) {
            active_ = false;
            bpLow = 0.0f;
            bpBand = 0.0f;
            break;
        }
    }
}

} // namespace elastic
