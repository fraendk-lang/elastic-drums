#include "HiHatVoice.h"
#include <cmath>

namespace elastic {

static constexpr float kTwoPi = 6.283185307f;
constexpr float HiHatVoice::kRatios[kNumOsc];

/**
 * Hi-Hat synthesis following professional drum design:
 *
 * Layer 1 — Metallic Core (4-10kHz):
 *   6 square/pulse oscillators at 909 inharmonic ratios
 *   Creates the characteristic metallic shimmer
 *
 * Layer 2 — Noise (8-16kHz):
 *   White noise through highpass for air/sizzle
 *   Decays faster than metal layer
 *
 * Layer 3 — Transient (attack click):
 *   Very short noise burst for definition
 *   ~1ms, gives the "tick" on each hit
 *
 * Post-processing:
 *   HPF at ~500Hz removes all unwanted low content
 *   Light saturation for presence
 */

HiHatVoice::HiHatVoice() {
    setParam(ParamID::Tune, 330.0f);     // Base frequency for metallic core
    setParam(ParamID::Decay, 80.0f);     // 45ms closed, 250ms open
    setParam(ParamID::Tone, 60.0f);      // Metal vs noise balance
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);
}

void HiHatVoice::trigger(float velocity) {
    velocity_ = velocity;
    active_ = true;
    ampEnv_ = 1.0f;
    transientEnv_ = 1.0f;
    // Don't reset phases — allows for natural variation between hits
    // (real cymbals don't reset phase on each strike)
}

void HiHatVoice::process(float* left, float* right, int numSamples) {
    if (!active_) return;

    const float baseFreq = getParam(ParamID::Tune);      // ~330Hz base
    const float decayMs = getParam(ParamID::Decay);       // Closed: ~45ms, Open: ~250ms
    const float metalMix = getParam(ParamID::Tone) * 0.01f; // Metal vs noise
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_ * 0.35f;

    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));
    // Transient: very short (~1ms)
    const float transRate = std::exp(-1.0f / (0.001f * sampleRate_));
    // Noise decays slightly faster for crisp sound
    const float noiseDecayFactor = 0.8f;

    // HPF coefficient (~500Hz cutoff to remove low content)
    const float hpCoeff = std::exp(-kTwoPi * 500.0f / sampleRate_);

    for (int i = 0; i < numSamples; ++i) {
        // === Layer 1: Metallic Core ===
        // 6 square oscillators at inharmonic ratios
        float metal = 0.0f;
        for (int o = 0; o < kNumOsc; o++) {
            // Square wave: sign of sine
            float sq = (std::sin(phases_[o]) > 0.0f) ? 1.0f : -1.0f;
            metal += sq;
            phases_[o] += kTwoPi * baseFreq * kRatios[o] / sampleRate_;
            if (phases_[o] > kTwoPi) phases_[o] -= kTwoPi;
        }
        metal *= (1.0f / kNumOsc) * metalMix * 0.6f;

        // === Layer 2: Noise (air/sizzle) ===
        float n = noise();
        float noiseAmt = (1.0f - metalMix * 0.5f) * 0.4f;
        float noiseLayer = n * noiseAmt;
        // Noise envelope decays faster
        float noiseEnv = std::pow(ampEnv_, 1.0f / noiseDecayFactor);

        // === Layer 3: Transient click ===
        float transient = noise() * transientEnv_ * 0.3f;

        // === Mix all layers ===
        float raw = (metal * ampEnv_) + (noiseLayer * noiseEnv) + transient;

        // === Highpass filter (remove everything below ~500Hz) ===
        float hp = raw - hpState_;
        hpState_ = hpState_ * hpCoeff + raw * (1.0f - hpCoeff);

        // === Light saturation for presence ===
        float sat = hp * 1.3f;
        if (sat > 1.0f) sat = 1.0f;
        if (sat < -1.0f) sat = -1.0f;

        float sample = sat * volume;

        left[i] += sample;
        right[i] += sample;

        ampEnv_ *= ampRate;
        transientEnv_ *= transRate;

        if (ampEnv_ < 0.0001f) {
            active_ = false;
            break;
        }
    }
}

} // namespace elastic
