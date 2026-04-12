#include "Filter.h"
#include <cmath>
#include <algorithm>

namespace elastic {

void Filter::init(float sampleRate) {
    sampleRate_ = sampleRate;
    low_ = band_ = high_ = 0.0f;
}

void Filter::setParams(float cutoff, float resonance, Type type) {
    cutoff_ = std::clamp(cutoff, 20.0f, sampleRate_ * 0.49f);
    resonance_ = std::clamp(resonance, 0.0f, 1.0f);
    type_ = type;
}

float Filter::process(float input) {
    float f = 2.0f * std::sin(3.14159265f * cutoff_ / sampleRate_);
    float q = 1.0f - resonance_ * 0.99f;

    high_ = input - low_ - q * band_;
    band_ += f * high_;
    low_ += f * band_;

    switch (type_) {
        case Type::LowPass:  return low_;
        case Type::HighPass: return high_;
        case Type::BandPass: return band_;
    }
    return low_;
}

} // namespace elastic
