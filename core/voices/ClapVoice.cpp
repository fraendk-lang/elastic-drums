#include "ClapVoice.h"
#include <cmath>
#include <cstdlib>

namespace elastic {

ClapVoice::ClapVoice() {
    setParam(ParamID::Decay, 300.0f);
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
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_;
    const float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));

    // 808 clap: 4 short noise bursts followed by decay tail
    const int burstInterval = static_cast<int>(sampleRate_ * 0.015f); // 15ms between bursts

    for (int i = 0; i < numSamples; ++i) {
        float noise = static_cast<float>(rand()) / static_cast<float>(RAND_MAX) * 2.0f - 1.0f;

        float env = ampEnv_;
        if (burstCount_ < 4) {
            // During bursts: short on/off pattern
            burstSamples_++;
            if (burstSamples_ >= burstInterval) {
                burstSamples_ = 0;
                burstCount_++;
                burstEnv_ = 1.0f;
            }
            float burstGate = burstEnv_ > 0.3f ? 1.0f : 0.0f;
            env *= burstGate;
            burstEnv_ *= std::exp(-1.0f / (0.004f * sampleRate_));
        }

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
