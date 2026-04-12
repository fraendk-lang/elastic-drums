#include "DrumCore.h"
#include "voices/KickVoice.h"
#include "voices/SnareVoice.h"
#include "voices/ClapVoice.h"
#include "voices/TomVoice.h"
#include "voices/HiHatVoice.h"
#include "voices/CymbalVoice.h"
#include "voices/PercVoice.h"

#include <cstring>

namespace elastic {

DrumCore::DrumCore() {
    voices_[Voice::Kick]         = new KickVoice();
    voices_[Voice::Snare]        = new SnareVoice();
    voices_[Voice::Clap]         = new ClapVoice();

    // Toms: different default tuning
    auto* tomLo = new TomVoice();
    tomLo->setParam(ParamID::Tune, 100.0f);
    tomLo->setParam(ParamID::Decay, 300.0f);
    voices_[Voice::TomLo] = tomLo;

    auto* tomMid = new TomVoice();
    tomMid->setParam(ParamID::Tune, 140.0f);
    tomMid->setParam(ParamID::Decay, 250.0f);
    voices_[Voice::TomMid] = tomMid;

    auto* tomHi = new TomVoice();
    tomHi->setParam(ParamID::Tune, 200.0f);
    tomHi->setParam(ParamID::Decay, 200.0f);
    voices_[Voice::TomHi] = tomHi;

    // HiHats: closed = short decay, open = long decay
    auto* hhClosed = new HiHatVoice();
    hhClosed->setParam(ParamID::Decay, 45.0f);
    voices_[Voice::HiHatClosed] = hhClosed;

    auto* hhOpen = new HiHatVoice();
    hhOpen->setParam(ParamID::Decay, 250.0f);
    voices_[Voice::HiHatOpen] = hhOpen;

    // Cymbals: metallic VA synth (not samples!)
    voices_[Voice::Cymbal] = new CymbalVoice(380.0f, 800.0f);
    voices_[Voice::Ride]   = new CymbalVoice(480.0f, 900.0f);

    // Percussion: resonant filtered noise
    voices_[Voice::Perc1]  = new PercVoice(800.0f, 120.0f);
    voices_[Voice::Perc2]  = new PercVoice(1200.0f, 100.0f);
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
    std::memset(leftOut, 0, sizeof(float) * numSamples);
    std::memset(rightOut, 0, sizeof(float) * numSamples);

    for (auto* voice : voices_) {
        voice->process(leftOut, rightOut, numSamples);
    }
}

void DrumCore::triggerVoice(int voiceIndex, float velocity) {
    if (voiceIndex < 0 || voiceIndex >= kNumVoices) return;

    // HiHat choke group: closed chokes open, open chokes closed
    if (voiceIndex == Voice::HiHatClosed) {
        static_cast<HiHatVoice*>(voices_[Voice::HiHatOpen])->choke();
    } else if (voiceIndex == Voice::HiHatOpen) {
        static_cast<HiHatVoice*>(voices_[Voice::HiHatClosed])->choke();
    }

    voices_[voiceIndex]->trigger(velocity);
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
