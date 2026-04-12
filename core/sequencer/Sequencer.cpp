#include "Sequencer.h"
#include <cstdlib>

namespace elastic {

Sequencer::Sequencer() {
    recalcTiming();
}

void Sequencer::init(float sampleRate) {
    sampleRate_ = sampleRate;
    recalcTiming();
}

void Sequencer::setBpm(float bpm) {
    bpm_ = bpm;
    recalcTiming();
}

void Sequencer::setPlaying(bool playing) {
    if (playing && !playing_) {
        currentStep_ = 0;
        sampleCounter_ = 0.0;
        cycleCount_ = 0;
    }
    playing_ = playing;
}

void Sequencer::recalcTiming() {
    // Samples per 16th note: (60 / bpm) * sampleRate / 4
    samplesPerStep_ = (60.0 / static_cast<double>(bpm_)) * sampleRate_ / 4.0;
}

void Sequencer::process(int numSamples, TriggerCallback onTrigger) {
    if (!playing_) return;

    for (int i = 0; i < numSamples; ++i) {
        sampleCounter_ += 1.0;

        // Apply swing: even steps are shifted forward
        double effectiveSamplesPerStep = samplesPerStep_;
        if (currentStep_ % 2 == 1) {
            float swingAmount = (pattern_.swing - 50.0f) / 50.0f; // 0..0.5
            effectiveSamplesPerStep *= (1.0 + swingAmount);
        }

        if (sampleCounter_ >= effectiveSamplesPerStep) {
            sampleCounter_ -= effectiveSamplesPerStep;
            advanceStep(onTrigger);
        }
    }
}

void Sequencer::advanceStep(TriggerCallback& onTrigger) {
    for (int track = 0; track < kNumTracks; ++track) {
        auto& trackData = pattern_.tracks[track];
        if (trackData.mute) continue;

        int step = currentStep_ % trackData.length;
        auto& stepData = trackData.steps[step];

        if (stepData.active && evaluateCondition(stepData)) {
            float vel = static_cast<float>(stepData.velocity) / 127.0f;
            onTrigger(track, vel);
        }
    }

    currentStep_++;
    if (currentStep_ >= pattern_.globalLength) {
        currentStep_ = 0;
        cycleCount_++;
    }
}

bool Sequencer::evaluateCondition(const StepData& step) const {
    // Quick probability check
    if (step.probability < 100) {
        // LCG noise instead of rand() (thread-safe, no mutex)
    static unsigned int rngState = 42;
    rngState = rngState * 1664525u + 1013904223u;
    int r = static_cast<int>((rngState >> 16) % 100);
        if (r >= step.probability) return false;
    }

    auto& cond = step.condition;
    bool result = true;

    switch (cond.type) {
        case ConditionType::Always:
            result = true;
            break;
        case ConditionType::Probability:
            result = (rand() % 100) < cond.a;
            break;
        case ConditionType::Cycle:
            result = (cond.b > 0) && ((cycleCount_ % cond.b) == (cond.a - 1));
            break;
        case ConditionType::First:
            result = cycleCount_ == 0;
            break;
        case ConditionType::NotFirst:
            result = cycleCount_ != 0;
            break;
        case ConditionType::Fill:
            result = false; // TODO: fill mode flag
            break;
        default:
            result = true;
            break;
    }

    return cond.invert ? !result : result;
}

} // namespace elastic
