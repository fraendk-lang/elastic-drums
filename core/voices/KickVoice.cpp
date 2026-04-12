#include "KickVoice.h"
#include <cmath>
#include <algorithm>

namespace elastic {

static constexpr float kTwoPi = 6.283185307f;

KickVoice::KickVoice() {
    // Default parameters
    setParam(ParamID::Tune, 60.0f);     // Base frequency Hz
    setParam(ParamID::Decay, 400.0f);   // Decay time ms
    setParam(ParamID::Click, 50.0f);    // Click amount 0-100
    setParam(ParamID::Drive, 20.0f);    // Drive amount 0-100
    setParam(ParamID::Sub, 30.0f);      // Sub oscillator 0-100
    setParam(ParamID::Tone, 50.0f);     // Tone (hi-cut) 0-100
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);       // Center
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
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_;
    const float pan = getParam(ParamID::Pan) * 0.01f; // -100..100 -> -1..1

    // Envelope rates
    const float ampDecayRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));
    const float pitchDecayRate = std::exp(-1.0f / (0.030f * sampleRate_)); // ~30ms pitch sweep
    const float clickDecayRate = std::exp(-1.0f / (0.002f * sampleRate_)); // ~2ms click

    // Pitch sweep range: tune*5 -> tune
    const float pitchStart = tune * 5.0f;

    for (int i = 0; i < numSamples; ++i) {
        // Current frequency with pitch envelope
        float freq = tune + (pitchStart - tune) * pitchEnv_;

        // Main oscillator (sine)
        float osc = std::sin(phase_);
        phase_ += kTwoPi * freq / sampleRate_;
        if (phase_ > kTwoPi) phase_ -= kTwoPi;

        // Sub oscillator (one octave down)
        float sub = std::sin(subPhase_) * subAmt;
        subPhase_ += kTwoPi * (freq * 0.5f) / sampleRate_;
        if (subPhase_ > kTwoPi) subPhase_ -= kTwoPi;

        // Click (noise burst)
        float click = clickEnv_ * clickAmt *
            (static_cast<float>(rand()) / static_cast<float>(RAND_MAX) * 2.0f - 1.0f);

        // Mix
        float sample = (osc + sub + click) * ampEnv_ * volume;

        // Drive (tanh soft clipping)
        if (driveAmt > 0.01f) {
            float gain = 1.0f + driveAmt * 8.0f;
            sample = fastTanh(sample * gain) / fastTanh(gain);
        }

        // Pan law (constant power)
        float panR = (pan + 1.0f) * 0.5f;
        float panL = 1.0f - panR;

        left[i] += sample * panL;
        right[i] += sample * panR;

        // Advance envelopes
        ampEnv_ *= ampDecayRate;
        pitchEnv_ *= pitchDecayRate;
        clickEnv_ *= clickDecayRate;
        sampleCount_ += 1.0f;

        // Kill voice when silent
        if (ampEnv_ < 0.0001f) {
            active_ = false;
            break;
        }
    }
}

} // namespace elastic
