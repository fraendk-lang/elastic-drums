#include "KickVoice.h"
#include <cmath>
#include <algorithm>

namespace elastic {

static constexpr float kTwoPi = 6.283185307f;

KickVoice::KickVoice() {
    setParam(ParamID::Tune, 52.0f);      // Deep 808 fundamental
    setParam(ParamID::Decay, 550.0f);     // Long decay for sub tail
    setParam(ParamID::Click, 50.0f);      // Click transient amount
    setParam(ParamID::Drive, 40.0f);      // Soft-clip warmth
    setParam(ParamID::Sub, 60.0f);        // Sub oscillator level
    setParam(ParamID::Tone, 50.0f);       // Tone shaping
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);
}

void KickVoice::trigger(float velocity) {
    velocity_ = velocity;
    active_ = true;
    phase_ = 0.0f;
    subPhase_ = 0.0f;
    ampEnv_ = 1.0f;
    pitchEnv_ = 1.0f;
    clickEnv_ = 1.0f;
    sampleCount_ = 0.0f;
}

void KickVoice::process(float* left, float* right, int numSamples) {
    if (!active_) return;

    const float tune = getParam(ParamID::Tune);
    const float decayMs = getParam(ParamID::Decay);
    const float clickAmt = getParam(ParamID::Click) * 0.01f;
    const float driveAmt = getParam(ParamID::Drive) * 0.01f;
    const float subAmt = getParam(ParamID::Sub) * 0.01f;
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_ * 0.9f;

    // Envelope rates
    const float ampDecayRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));
    // Slow pitch sweep for warm punch (not too fast!)
    const float pitchDecayRate = std::exp(-1.0f / (0.035f * sampleRate_));
    const float clickDecayRate = std::exp(-1.0f / (0.003f * sampleRate_));

    // Pitch sweep: tune * 4.5 → tune (matching browser engine)
    const float pitchStart = tune * 4.5f;
    const float pitchMid = tune * 1.8f;

    // Drive gain
    const float driveGain = 1.0f + driveAmt * 4.0f;

    for (int i = 0; i < numSamples; ++i) {
        // Two-stage pitch envelope: fast initial drop, then settle
        float pitchMul;
        if (pitchEnv_ > 0.5f) {
            // Fast: pitchStart → pitchMid
            pitchMul = pitchMid + (pitchStart - pitchMid) * ((pitchEnv_ - 0.5f) * 2.0f);
        } else {
            // Slow: pitchMid → tune
            pitchMul = tune + (pitchMid - tune) * (pitchEnv_ * 2.0f);
        }

        // Main oscillator (sine body)
        float osc = std::sin(phase_) * 0.85f;
        phase_ += kTwoPi * pitchMul / sampleRate_;
        if (phase_ > kTwoPi) phase_ -= kTwoPi;

        // Sub oscillator (one octave down, fades in after attack)
        float sub = 0.0f;
        if (subAmt > 0.05f) {
            float subFadeIn = std::min(sampleCount_ / (sampleRate_ * 0.015f), 1.0f);
            sub = std::sin(subPhase_) * subAmt * 0.7f * subFadeIn;
            subPhase_ += kTwoPi * (tune * 0.5f) / sampleRate_;
            if (subPhase_ > kTwoPi) subPhase_ -= kTwoPi;
        }

        // Click (noise burst with highpass character)
        float click = 0.0f;
        if (clickAmt > 0.05f && clickEnv_ > 0.01f) {
            // Simple noise from counter
            float n = fastTanh(sampleCount_ * 0.1f) * 2.0f - 1.0f;
            n = n * 0.7f + (static_cast<float>(static_cast<int>(sampleCount_ * 7919.0f) % 65536) / 32768.0f - 1.0f) * 0.3f;
            click = n * clickEnv_ * clickAmt * 0.5f;
        }

        // Mix
        float sample = (osc + sub + click) * ampEnv_ * volume;

        // Drive (tanh soft clipping with 4x oversampling character)
        if (driveAmt > 0.05f) {
            sample = fastTanh(sample * driveGain) / fastTanh(driveGain);
        }

        // Simple low-shelf boost for warmth (+4dB at 120Hz equivalent)
        sample *= 1.15f;

        left[i] += sample;
        right[i] += sample;

        // Advance envelopes
        ampEnv_ *= ampDecayRate;
        pitchEnv_ *= pitchDecayRate;
        clickEnv_ *= clickDecayRate;
        sampleCount_ += 1.0f;

        if (ampEnv_ < 0.0001f) {
            active_ = false;
            break;
        }
    }
}

} // namespace elastic
