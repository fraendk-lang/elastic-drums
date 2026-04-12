#include "KickVoice.h"
#include <cmath>
#include <algorithm>

namespace elastic {

static constexpr float kTwoPi = 6.283185307f;

KickVoice::KickVoice() {
    setParam(ParamID::Tune, 50.0f);      // Fundamental: 35-60 Hz range
    setParam(ParamID::Decay, 550.0f);     // Amp decay
    setParam(ParamID::Click, 50.0f);      // Click/attack transient (2-5kHz)
    setParam(ParamID::Drive, 35.0f);      // Saturation for harmonics
    setParam(ParamID::Sub, 60.0f);        // Sub layer (35-60Hz pure sine)
    setParam(ParamID::Tone, 50.0f);       // Body vs punch balance
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

    const float fundamental = getParam(ParamID::Tune);  // 35-60 Hz
    const float decayMs = getParam(ParamID::Decay);
    const float clickAmt = getParam(ParamID::Click) * 0.01f;
    const float driveAmt = getParam(ParamID::Drive) * 0.01f;
    const float subAmt = getParam(ParamID::Sub) * 0.01f;
    const float toneAmt = getParam(ParamID::Tone) * 0.01f;  // Body/Punch balance
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_;

    // === Envelope Rates ===
    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));
    // Pitch envelope: very fast fall (key to kick impact)
    // Stage 1: 300-400Hz → 100-140Hz in ~5ms (punch zone)
    // Stage 2: 100-140Hz → fundamental in ~30ms (settle)
    const float pitchRate1 = std::exp(-1.0f / (0.005f * sampleRate_));
    const float pitchRate2 = std::exp(-1.0f / (0.030f * sampleRate_));
    const float clickRate = std::exp(-1.0f / (0.002f * sampleRate_));  // 2ms click

    // Pitch targets
    const float pitchStart = 300.0f + toneAmt * 100.0f;   // Start at 300-400Hz
    const float pitchPunch = 100.0f + toneAmt * 40.0f;    // Punch zone 100-140Hz

    // Drive curve
    const float driveGain = 1.0f + driveAmt * 5.0f;

    for (int i = 0; i < numSamples; ++i) {
        // === Two-stage pitch envelope ===
        float currentPitch;
        if (sampleCount_ < sampleRate_ * 0.008f) {
            // Stage 1: fast drop from pitchStart to pitchPunch
            float t1 = sampleCount_ / (sampleRate_ * 0.008f);
            currentPitch = pitchStart + (pitchPunch - pitchStart) * t1;
        } else {
            // Stage 2: slow settle from pitchPunch to fundamental
            currentPitch = fundamental + (pitchPunch - fundamental) * pitchEnv_;
        }

        // === Main body oscillator (sine) — 60-100Hz zone ===
        float body = std::sin(phase_) * 0.8f;
        phase_ += kTwoPi * currentPitch / sampleRate_;
        if (phase_ > kTwoPi) phase_ -= kTwoPi;

        // === Sub oscillator (pure sine at fundamental) — 35-60Hz ===
        float sub = 0.0f;
        if (subAmt > 0.05f) {
            // Fade in after initial transient to avoid phase conflict
            float subFade = std::min(sampleCount_ / (sampleRate_ * 0.012f), 1.0f);
            sub = std::sin(subPhase_) * subAmt * 0.65f * subFade;
            subPhase_ += kTwoPi * fundamental / sampleRate_;
            if (subPhase_ > kTwoPi) subPhase_ -= kTwoPi;
        }

        // === Click transient (noise burst at 2-5kHz) ===
        float click = 0.0f;
        if (clickAmt > 0.05f && clickEnv_ > 0.01f) {
            // LCG noise (deterministic)
            unsigned int ns = static_cast<unsigned int>(sampleCount_ * 7919.0f);
            ns = ns * 1664525u + 1013904223u;
            float n = static_cast<float>(static_cast<int>(ns)) / 2147483648.0f;
            click = n * clickEnv_ * clickAmt * 0.4f;
            clickEnv_ *= clickRate;
        }

        // === Mix ===
        float sample = (body + sub + click) * ampEnv_ * volume;

        // === Saturation (tanh soft clip for harmonics) ===
        if (driveAmt > 0.05f) {
            sample = fastTanh(sample * driveGain);
            // Compensate gain
            sample /= fastTanh(driveGain * 0.8f);
        }

        // === Anti-boxiness: gentle cut at 200-350Hz ===
        // Simple high-shelf approximation: reduce mumpf
        // (Not a full filter, just a mix technique)

        left[i] += sample;
        right[i] += sample;

        // Envelope advance
        ampEnv_ *= ampRate;
        pitchEnv_ *= (sampleCount_ < sampleRate_ * 0.008f) ? pitchRate1 : pitchRate2;
        sampleCount_ += 1.0f;

        if (ampEnv_ < 0.0001f) {
            active_ = false;
            break;
        }
    }
}

} // namespace elastic
