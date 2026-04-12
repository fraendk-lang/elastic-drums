#include "SampleVoice.h"
#include <cmath>

namespace elastic {

SampleVoice::SampleVoice() {
    setParam(ParamID::Tune, 0.0f);       // Pitch offset in semitones
    setParam(ParamID::Decay, 1000.0f);
    setParam(ParamID::Tone, 50.0f);
    setParam(ParamID::Volume, 100.0f);
    setParam(ParamID::Pan, 0.0f);
    setParam(ParamID::SampleStart, 0.0f);
}

void SampleVoice::trigger(float velocity) {
    velocity_ = velocity;
    active_ = true;
    float startPct = getParam(ParamID::SampleStart) * 0.01f;
    playPosition_ = startPct * static_cast<float>(sampleLength_);
    ampEnv_ = 1.0f;
}

void SampleVoice::process(float* left, float* right, int numSamples) {
    if (!active_ || sampleData_ == nullptr) return;

    const float tune = getParam(ParamID::Tune);
    const float decayMs = getParam(ParamID::Decay);
    const float volume = getParam(ParamID::Volume) * 0.01f * velocity_;

    // Variable sample rate pitch (like original Linn machines)
    float pitchRatio = std::pow(2.0f, tune / 12.0f) * (originalSampleRate_ / sampleRate_);
    float ampRate = std::exp(-1.0f / (decayMs * 0.001f * sampleRate_));

    for (int i = 0; i < numSamples; ++i) {
        int pos = static_cast<int>(playPosition_);
        if (pos >= sampleLength_ - 1) {
            active_ = false;
            break;
        }

        // Linear interpolation
        float frac = playPosition_ - static_cast<float>(pos);
        float s = sampleData_[pos] * (1.0f - frac) + sampleData_[pos + 1] * frac;

        float sample = s * ampEnv_ * volume;

        left[i] += sample;
        right[i] += sample;

        playPosition_ += pitchRatio;
        ampEnv_ *= ampRate;

        if (ampEnv_ < 0.0001f) {
            active_ = false;
            break;
        }
    }
}

void SampleVoice::loadSample(const float* data, int numFrames, float originalSR) {
    sampleData_ = data;
    sampleLength_ = numFrames;
    originalSampleRate_ = originalSR;
}

} // namespace elastic
