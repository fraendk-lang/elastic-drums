#pragma once

namespace elastic {

class Distortion {
public:
    void process(float* buffer, int numSamples);
    void setDrive(float drive) { drive_ = drive; }
    void setMix(float mix) { mix_ = mix; }

private:
    float drive_ = 0.0f;
    float mix_ = 1.0f;
};

} // namespace elastic
