#pragma once

#include <array>
#include <atomic>
#include <cstdint>

namespace elastic {

constexpr int kNumVoices = 12;
constexpr int kMaxBlockSize = 512;

// Voice indices
enum Voice : int {
    Kick = 0, Snare, Clap,
    TomLo, TomMid, TomHi,
    HiHatClosed, HiHatOpen,
    Cymbal, Ride,
    Perc1, Perc2
};

// Parameter IDs per voice
enum class ParamID : int {
    Tune = 0,
    Decay,
    Tone,
    Drive,
    Click,
    Sub,
    Snap,
    Noise,
    Pan,
    Volume,
    SendA,
    SendB,
    FilterCutoff,
    FilterReso,
    SampleStart,
    NumParams
};

constexpr int kNumParams = static_cast<int>(ParamID::NumParams);

// Base class for all drum voices
class DrumVoice {
public:
    virtual ~DrumVoice() = default;

    // Trigger the voice (called from sequencer, real-time safe)
    virtual void trigger(float velocity) = 0;

    // Process a block of audio (real-time safe: no alloc, no locks, no I/O)
    virtual void process(float* left, float* right, int numSamples) = 0;

    // Set a parameter (atomic, real-time safe)
    void setParam(ParamID id, float value) {
        params_[static_cast<int>(id)].store(value, std::memory_order_relaxed);
    }

    float getParam(ParamID id) const {
        return params_[static_cast<int>(id)].load(std::memory_order_relaxed);
    }

    void setSampleRate(float sr) { sampleRate_ = sr; }

protected:
    float sampleRate_ = 44100.0f;
    std::array<std::atomic<float>, kNumParams> params_{};
};

// The main DSP engine
class DrumCore {
public:
    DrumCore();
    ~DrumCore();

    void init(float sampleRate, int blockSize);

    // Process a stereo block (called from audio thread)
    void process(float* leftOut, float* rightOut, int numSamples);

    // Trigger a voice (real-time safe)
    void triggerVoice(int voiceIndex, float velocity);

    // Parameter access (real-time safe)
    void setVoiceParam(int voiceIndex, ParamID param, float value);
    float getVoiceParam(int voiceIndex, ParamID param) const;

    // Transport
    void setBpm(float bpm) { bpm_.store(bpm, std::memory_order_relaxed); }
    float getBpm() const { return bpm_.load(std::memory_order_relaxed); }

private:
    std::array<DrumVoice*, kNumVoices> voices_{};
    std::atomic<float> bpm_{120.0f};
    float sampleRate_ = 44100.0f;
    int blockSize_ = 256;
};

} // namespace elastic
