#include "SnareVoice.h"
#include <cmath>

namespace elastic {

static constexpr float kTwoPi = 6.283185307f;

/**
 * Snare: Body(150-250Hz) + Noise(shaped BP/HP) + Pitch Mod on attack
 *
 * Frequency zones:
 *   Body: 150-250 Hz (tonal)
 *   Nasal/wood: 400-900 Hz (cut for cleaner sound)
 *   Crack/Snap: 1.5-4 kHz (noise shaped here)
 *   Sizzle: 5-10 kHz (noise air)
 */

SnareVoice::SnareVoice() {
    setParam(ParamID::Tune, 190.0f);     // Body fundamental 150-250Hz
    setParam(ParamID::Decay, 220.0f);    // Overall decay
    setParam(ParamID::Tone, 55.0f);      // Body vs noise balance
    setParam(ParamID::Snap, 70.0f);      // Noise crack amount (1.5-4kHz)
    setParam(ParamID::Drive, 10.0f);     // Saturation
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);
}

void SnareVoice::trigger(float velocity) {
    velocity_ = velocity;
    active_ = true;
    phase_ = 0.0f;
    ampEnv_ = 1.0f;
    noiseEnv_ = 1.0f;
    pitchEnv_ = 1.0f;
}

void SnareVoice::process(float* left, float* right, int numSamples) {
    if (!active_) return;

    const float bodyFreq = getParam(ParamID::Tune);     // 150-250Hz
    const float decayMs = getParam(ParamID::Decay);
    const float bodyMix = getParam(ParamID::Tone) * 0.01f;
    const float snapAmt = getParam(ParamID::Snap) * 0.01f;
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_ * 0.65f;

    // Body decays slower than noise for snare tail
    const float bodyRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));
    // Noise decays faster (snap character)
    const float noiseRate = std::exp(-1.0f / (decayMs * 0.0005f * sampleRate_));
    // Very fast pitch mod on attack (~10ms)
    const float pitchRate = std::exp(-1.0f / (0.010f * sampleRate_));

    // Per-instance noise + filter state (members, not static)

    for (int i = 0; i < numSamples; ++i) {
        // === Body: Triangle wave at 150-250Hz ===
        // Short pitch mod: starts at bodyFreq*1.4, drops to bodyFreq
        float freq = bodyFreq + bodyFreq * 0.4f * pitchEnv_;

        // Triangle waveform (warmer than sine, less harsh than saw)
        float p = phase_ / kTwoPi;
        p = p - static_cast<int>(p);
        float tri = p < 0.5f ? (p * 4.0f - 1.0f) : (3.0f - p * 4.0f);
        float body = tri * ampEnv_ * bodyMix * 0.5f;

        phase_ += kTwoPi * freq / sampleRate_;
        if (phase_ > kTwoPi) phase_ -= kTwoPi;

        // === Noise: shaped through HP for crack (1.5-4kHz) ===
        noiseState_ = noiseState_ * 1664525u + 1013904223u;
        float rawNoise = static_cast<float>(static_cast<int>(noiseState_)) / 2147483648.0f;

        // Simple 1-pole highpass at ~2kHz for snap character
        float hpCoeff = 1.0f - (kTwoPi * 2000.0f / sampleRate_);
        if (hpCoeff < 0.0f) hpCoeff = 0.0f;
        float filteredNoise = rawNoise - hpState_;
        hpState_ = hpState_ + (1.0f - hpCoeff) * (rawNoise - hpState_);

        float noiseLayer = filteredNoise * noiseEnv_ * snapAmt * 0.65f;

        // === Sizzle: raw noise at low level for air (5-10kHz inherent) ===
        float sizzle = rawNoise * noiseEnv_ * snapAmt * 0.1f;

        float sample = (body + noiseLayer + sizzle) * volume;

        left[i] += sample;
        right[i] += sample;

        ampEnv_ *= bodyRate;
        noiseEnv_ *= noiseRate;
        pitchEnv_ *= pitchRate;

        if (ampEnv_ < 0.0001f && noiseEnv_ < 0.0001f) {
            active_ = false;
            hpState_ = 0.0f;
            break;
        }
    }
}

} // namespace elastic
