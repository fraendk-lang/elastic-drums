#include "CymbalVoice.h"
#include <cmath>

namespace elastic {

constexpr float CymbalVoice::kRatios[kNumOsc];
static constexpr float kTwoPi = 6.283185307f;

/**
 * Cymbal/Ride: Multiple inharmonic oscillators + noise + long decay
 *
 * Frequency zones:
 *   Metallic body: 3-8 kHz
 *   Brilliance: 8-12 kHz
 *   Air: 12-16+ kHz
 *
 * Uses 6 square oscillators at inharmonic ratios (like HiHat but with
 * longer decay and different frequency range), plus FM between pairs
 * for richer metallic character.
 */

CymbalVoice::CymbalVoice(float baseFreq, float decayMs)
    : defaultFreq_(baseFreq), defaultDecay_(decayMs)
{
    setParam(ParamID::Tune, baseFreq);
    setParam(ParamID::Decay, decayMs);
    setParam(ParamID::Tone, 60.0f);
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);
}

void CymbalVoice::trigger(float velocity) {
    velocity_ = velocity;
    active_ = true;
    ampEnv_ = 1.0f;
    // Don't reset phases for natural variation
}

void CymbalVoice::process(float* left, float* right, int numSamples) {
    if (!active_) return;

    const float baseFreq = getParam(ParamID::Tune);
    const float decayMs = getParam(ParamID::Decay);
    const float metalMix = getParam(ParamID::Tone) * 0.01f;
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_ * 0.25f;

    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));

    for (int i = 0; i < numSamples; ++i) {
        // === Metallic oscillator bank ===
        float metal = 0.0f;
        for (int o = 0; o < kNumOsc; o++) {
            // Square oscillator
            float sq = (std::sin(phases_[o]) > 0.0f) ? 1.0f : -1.0f;

            // FM modulation between adjacent pairs for richer harmonics
            float fmMod = 0.0f;
            if (o > 0) {
                fmMod = std::sin(phases_[o - 1]) * 0.3f;
            }

            metal += sq * 0.12f;
            phases_[o] += kTwoPi * (baseFreq * kRatios[o] + fmMod * baseFreq) / sampleRate_;
            if (phases_[o] > kTwoPi) phases_[o] -= kTwoPi;
        }
        metal *= metalMix;

        // === Noise shimmer (air content) ===
        float n = noise() * (1.0f - metalMix * 0.3f) * 0.15f;

        // === Mix ===
        float sample = (metal + n) * ampEnv_ * volume;

        // Gentle saturation for presence
        if (sample > 0.8f) sample = 0.8f + (sample - 0.8f) * 0.3f;
        if (sample < -0.8f) sample = -0.8f + (sample + 0.8f) * 0.3f;

        left[i] += sample;
        right[i] += sample;

        ampEnv_ *= ampRate;
        if (ampEnv_ < 0.0001f) {
            active_ = false;
            break;
        }
    }
}

} // namespace elastic
