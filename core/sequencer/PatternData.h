#pragma once

#include <array>
#include <cstdint>

namespace elastic {

constexpr int kMaxSteps = 64;
constexpr int kNumTracks = 12;
constexpr int kMaxParamLocks = 8;

// Conditional Trig types (Elektron-style)
enum class ConditionType : uint8_t {
    Always = 0,     // Always trigger
    Probability,    // Random < threshold
    Cycle,          // x:y modulo logic
    Fill,           // Only during fill
    Pre,            // Previous step was active
    NotPre,         // Previous step was NOT active
    Nei,            // Neighbor track active
    NotNei,         // Neighbor track NOT active
    First,          // Only first cycle
    NotFirst,       // Not first cycle
};

struct Condition {
    ConditionType type = ConditionType::Always;
    bool invert = false;
    uint8_t a = 0;  // For Cycle: numerator, Probability: percent
    uint8_t b = 0;  // For Cycle: denominator
};

struct ParamLock {
    int paramId = -1;   // -1 = unused
    float value = 0.0f;
};

struct StepData {
    bool active = false;
    uint8_t velocity = 100;         // 0-127
    int8_t microTiming = 0;         // ±23 ticks
    uint8_t probability = 100;      // 0-100 (shorthand for Condition::Probability)
    uint8_t ratchetCount = 1;       // 1-8
    Condition condition;
    std::array<ParamLock, kMaxParamLocks> paramLocks;
};

struct TrackData {
    std::array<StepData, kMaxSteps> steps;
    int length = 16;    // Per-track length for polymetric patterns
    bool mute = false;
    bool solo = false;
};

struct PatternData {
    std::array<TrackData, kNumTracks> tracks;
    int globalLength = 16;
    float swing = 50.0f;    // 50% = no swing, up to 75%
};

} // namespace elastic
