#pragma once

#include "../DrumCore.h"
#include "PatternData.h"
#include <functional>

namespace elastic {

class Sequencer {
public:
    using TriggerCallback = std::function<void(int track, float velocity)>;

    Sequencer();

    void init(float sampleRate);
    void setBpm(float bpm);
    void setPlaying(bool playing);
    bool isPlaying() const { return playing_; }

    // Called per audio block – advances tick counter, triggers voices
    void process(int numSamples, TriggerCallback onTrigger);

    // Pattern access
    PatternData& getPattern() { return pattern_; }
    int getCurrentStep() const { return currentStep_; }

private:
    PatternData pattern_;
    float sampleRate_ = 44100.0f;
    float bpm_ = 120.0f;
    bool playing_ = false;

    // Timing
    int currentStep_ = 0;
    double samplesPerStep_ = 0.0;
    double sampleCounter_ = 0.0;
    int cycleCount_ = 0; // For conditional trigs (x:y logic)

    void advanceStep(TriggerCallback& onTrigger);
    bool evaluateCondition(const StepData& step) const;
    void recalcTiming();
};

} // namespace elastic
