#include "ClapVoice.h"
#include <cmath>

namespace elastic {

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
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_ * 0.75f;
    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));

    // Burst timing: 4 bursts with increasing spacing (0, 8ms, 19ms, 33ms)
    const int burstSpacing[4] = {
        0,
        static_cast<int>(sampleRate_ * 0.008f),
        static_cast<int>(sampleRate_ * 0.011f),
        static_cast<int>(sampleRate_ * 0.014f),
    };

    static unsigned int noiseState = 98765;

    for (int i = 0; i < numSamples; ++i) {
        noiseState = noiseState * 1664525u + 1013904223u;
        float noise = static_cast<float>(static_cast<int>(noiseState)) / 2147483648.0f;

        float env = ampEnv_;

        // During burst phase: gate the noise
        if (burstCount_ < 4) {
            burstSamples_++;
            int nextBurst = burstCount_ < 3 ? burstSpacing[burstCount_ + 1] : 9999;
            if (burstSamples_ >= nextBurst) {
                burstCount_++;
                burstEnv_ = 1.0f;
                burstSamples_ = 0;
            }
            float burstGate = burstEnv_ > 0.2f ? 1.0f : 0.3f;
            env *= burstGate;
            burstEnv_ *= std::exp(-1.0f / (0.005f * sampleRate_));
        }

        // Bandpass character (simple)
        float sample = noise * env * volume;

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
