#pragma once

namespace elastic {

class Filter {
public:
    enum class Type { LowPass, HighPass, BandPass };

    void init(float sampleRate);
    void setParams(float cutoff, float resonance, Type type);
    float process(float input);

private:
    float sampleRate_ = 44100.0f;
    float cutoff_ = 1000.0f;
    float resonance_ = 0.0f;
    Type type_ = Type::LowPass;

    // State variables (SVF)
    float low_ = 0.0f;
    float band_ = 0.0f;
    float high_ = 0.0f;
};

} // namespace elastic
