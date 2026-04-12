#include "DrumCore.h"
#include "voices/KickVoice.h"
#include "voices/SnareVoice.h"
#include "voices/ClapVoice.h"
#include "voices/TomVoice.h"
#include "voices/HiHatVoice.h"
#include "voices/SampleVoice.h"

#include <cstring>

namespace elastic {

DrumCore::DrumCore() {
    voices_[Voice::Kick]         = new KickVoice();
    voices_[Voice::Snare]        = new SnareVoice();
    voices_[Voice::Clap]         = new ClapVoice();
    voices_[Voice::TomLo]        = new TomVoice();
    voices_[Voice::TomMid]       = new TomVoice();
    voices_[Voice::TomHi]        = new TomVoice();
    voices_[Voice::HiHatClosed]  = new HiHatVoice();
    voices_[Voice::HiHatOpen]    = new HiHatVoice();
    voices_[Voice::Cymbal]       = new SampleVoice();
    voices_[Voice::Ride]         = new SampleVoice();
    voices_[Voice::Perc1]        = new SampleVoice();
    voices_[Voice::Perc2]        = new SampleVoice();
}

DrumCore::~DrumCore() {
    for (auto* v : voices_) delete v;
}

void DrumCore::init(float sampleRate, int blockSize) {
    sampleRate_ = sampleRate;
    blockSize_ = blockSize;
    for (auto* v : voices_) {
        v->setSampleRate(sampleRate);
    }
}

void DrumCore::process(float* leftOut, float* rightOut, int numSamples) {
    // Clear output buffers
    std::memset(leftOut, 0, sizeof(float) * numSamples);
    std::memset(rightOut, 0, sizeof(float) * numSamples);

    // Sum all voices into the stereo output
    for (auto* voice : voices_) {
        voice->process(leftOut, rightOut, numSamples);
    }
}

void DrumCore::triggerVoice(int voiceIndex, float velocity) {
    if (voiceIndex >= 0 && voiceIndex < kNumVoices) {
        voices_[voiceIndex]->trigger(velocity);
    }
}

void DrumCore::setVoiceParam(int voiceIndex, ParamID param, float value) {
    if (voiceIndex >= 0 && voiceIndex < kNumVoices) {
        voices_[voiceIndex]->setParam(param, value);
    }
}

float DrumCore::getVoiceParam(int voiceIndex, ParamID param) const {
    if (voiceIndex >= 0 && voiceIndex < kNumVoices) {
        return voices_[voiceIndex]->getParam(param);
    }
    return 0.0f;
}

} // namespace elastic
