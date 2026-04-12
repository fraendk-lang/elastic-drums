#include "PluginProcessor.h"
#include "PluginEditor.h"
#include <cmath>

static const char* VOICE_NAMES[] = {
    "kick", "snare", "clap", "tomlo", "tommid", "tomhi",
    "hhcl", "hhop", "cym", "ride", "perc1", "perc2"
};

// ─── Parameter Layout ────────────────────────────────────

juce::AudioProcessorValueTreeState::ParameterLayout
ElasticDrumsProcessor::createParameterLayout() {
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID("master_vol", 1), "Master Volume", 0.0f, 1.0f, 0.85f));
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID("bpm", 1), "BPM", 30.0f, 300.0f, 120.0f));

    static const char* LABELS[] = {
        "Kick", "Snare", "Clap", "Tom Lo", "Tom Mid", "Tom Hi",
        "HH Closed", "HH Open", "Cymbal", "Ride", "Perc 1", "Perc 2"
    };

    for (int v = 0; v < 12; v++) {
        auto prefix = juce::String(VOICE_NAMES[v]) + "_";
        auto label = juce::String(LABELS[v]) + " ";

        params.push_back(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(prefix + "tune", 1), label + "Tune", 20.0f, 2000.0f, 100.0f));
        params.push_back(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(prefix + "decay", 1), label + "Decay", 10.0f, 2000.0f, 300.0f));
        params.push_back(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(prefix + "vol", 1), label + "Volume", 0.0f, 127.0f, 100.0f));
        params.push_back(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(prefix + "pan", 1), label + "Pan", -100.0f, 100.0f, 0.0f));

        if (v == 0) {
            params.push_back(std::make_unique<juce::AudioParameterFloat>(
                juce::ParameterID(prefix + "click", 1), label + "Click", 0.0f, 100.0f, 50.0f));
            params.push_back(std::make_unique<juce::AudioParameterFloat>(
                juce::ParameterID(prefix + "drive", 1), label + "Drive", 0.0f, 100.0f, 40.0f));
            params.push_back(std::make_unique<juce::AudioParameterFloat>(
                juce::ParameterID(prefix + "sub", 1), label + "Sub", 0.0f, 100.0f, 60.0f));
        }
        if (v == 1) {
            params.push_back(std::make_unique<juce::AudioParameterFloat>(
                juce::ParameterID(prefix + "snap", 1), label + "Snap", 0.0f, 100.0f, 70.0f));
            params.push_back(std::make_unique<juce::AudioParameterFloat>(
                juce::ParameterID(prefix + "tone", 1), label + "Tone", 0.0f, 100.0f, 55.0f));
        }
    }

    return { params.begin(), params.end() };
}

// ─── Constructor ─────────────────────────────────────────

ElasticDrumsProcessor::ElasticDrumsProcessor()
    : AudioProcessor(BusesProperties()
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts_(*this, nullptr, "PARAMETERS", createParameterLayout())
{
    for (int t = 0; t < 12; t++)
        for (int s = 0; s < 64; s++) {
            stepPattern_[t][s] = false;
            stepVelocity_[t][s] = 100;
        }
}

ElasticDrumsProcessor::~ElasticDrumsProcessor() = default;

void ElasticDrumsProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
    drumCore_.init(static_cast<float>(sampleRate), samplesPerBlock);
    syncParamsToCore();
}

void ElasticDrumsProcessor::releaseResources() {}

// ─── MIDI Mapping ────────────────────────────────────────
// GM Drum Map — standard mapping that works with Ableton Drum Rack,
// MIDI keyboards, and standard drum controllers

int ElasticDrumsProcessor::midiNoteToVoice(int note) const {
    switch (note) {
        // Primary GM Drum Map notes
        case 36: return 0;   // C1  = Kick
        case 38: return 1;   // D1  = Snare
        case 40: return 1;   // E1  = Snare (alt - Electric Snare)
        case 39: return 2;   // D#1 = Clap (Hand Clap)
        case 41: return 3;   // F1  = Tom Lo (Low Floor Tom)
        case 43: return 4;   // G1  = Tom Mid (High Floor Tom)
        case 45: return 4;   // A1  = Tom Mid (Low Tom)
        case 47: return 5;   // B1  = Tom Hi (Low-Mid Tom)
        case 48: return 5;   // C2  = Tom Hi (Hi-Mid Tom)
        case 42: return 6;   // F#1 = HH Closed
        case 44: return 6;   // G#1 = HH Closed (Pedal)
        case 46: return 7;   // A#1 = HH Open
        case 49: return 8;   // C#2 = Cymbal (Crash 1)
        case 57: return 8;   // A2  = Cymbal (Crash 2)
        case 51: return 9;   // D#2 = Ride
        case 59: return 9;   // B2  = Ride (Ride 2)
        case 53: return 9;   // F2  = Ride Bell
        case 37: return 10;  // C#1 = Perc 1 (Side Stick)
        case 56: return 11;  // G#2 = Perc 2 (Cowbell)
        case 54: return 11;  // F#2 = Perc 2 (Tambourine)

        // Chromatic fallback: C1-B1 octave = 12 voices
        default: {
            if (note >= 36 && note <= 47)
                return note - 36;
            if (note >= 60 && note <= 71)  // C3-B3 octave too
                return note - 60;
            return -1;
        }
    }
}

// ─── Param Sync ──────────────────────────────────────────

void ElasticDrumsProcessor::syncParamsToCore() {
    for (int v = 0; v < 12; v++) {
        auto prefix = juce::String(VOICE_NAMES[v]) + "_";

        drumCore_.setVoiceParam(v, elastic::ParamID::Tune,
            *apvts_.getRawParameterValue(prefix + "tune"));
        drumCore_.setVoiceParam(v, elastic::ParamID::Decay,
            *apvts_.getRawParameterValue(prefix + "decay"));
        drumCore_.setVoiceParam(v, elastic::ParamID::Volume,
            *apvts_.getRawParameterValue(prefix + "vol"));
        drumCore_.setVoiceParam(v, elastic::ParamID::Pan,
            *apvts_.getRawParameterValue(prefix + "pan"));

        if (v == 0) {
            drumCore_.setVoiceParam(v, elastic::ParamID::Click,
                *apvts_.getRawParameterValue(prefix + "click"));
            drumCore_.setVoiceParam(v, elastic::ParamID::Drive,
                *apvts_.getRawParameterValue(prefix + "drive"));
            drumCore_.setVoiceParam(v, elastic::ParamID::Sub,
                *apvts_.getRawParameterValue(prefix + "sub"));
        }
        if (v == 1) {
            drumCore_.setVoiceParam(v, elastic::ParamID::Snap,
                *apvts_.getRawParameterValue(prefix + "snap"));
            drumCore_.setVoiceParam(v, elastic::ParamID::Tone,
                *apvts_.getRawParameterValue(prefix + "tone"));
        }
    }
}

// ─── Process Block ───────────────────────────────────────

void ElasticDrumsProcessor::processBlock(juce::AudioBuffer<float>& buffer,
                                          juce::MidiBuffer& midiMessages) {
    juce::ScopedNoDenormals noDenormals;

    syncParamsToCore();

    // Host transport sync
    auto playHead = getPlayHead();
    bool hostPlaying = false;

    if (playHead) {
        auto posInfo = playHead->getPosition();
        if (posInfo.hasValue()) {
            auto bpmOpt = posInfo->getBpm();
            if (bpmOpt.hasValue()) {
                seqState.bpm = static_cast<float>(*bpmOpt);
                drumCore_.setBpm(seqState.bpm);
            }

            hostPlaying = posInfo->getIsPlaying();
            seqState.playing = hostPlaying;

            // PPQ-based step triggering synced to host
            auto ppqOpt = posInfo->getPpqPosition();
            if (ppqOpt.hasValue() && hostPlaying) {
                double ppq = *ppqOpt;
                int newStep = static_cast<int>(std::fmod(ppq * 4.0,
                    static_cast<double>(patternLength_)));
                if (newStep < 0) newStep += patternLength_;

                if (newStep != internalStep_) {
                    internalStep_ = newStep;
                    seqState.currentStep = newStep;

                    // Trigger pattern steps
                    for (int track = 0; track < 12; track++) {
                        if (stepPattern_[track][newStep]) {
                            float vel = static_cast<float>(
                                stepVelocity_[track][newStep]) / 127.0f;
                            drumCore_.triggerVoice(track, vel);
                        }
                    }
                }
            }

            // Reset step when host stops
            if (!hostPlaying && seqState.playing) {
                internalStep_ = -1;
            }
        }
    }

    // Process MIDI input
    for (const auto metadata : midiMessages) {
        const auto msg = metadata.getMessage();
        if (msg.isNoteOn()) {
            int voice = midiNoteToVoice(msg.getNoteNumber());
            if (voice >= 0) {
                drumCore_.triggerVoice(voice, msg.getFloatVelocity());
            }
        }
    }

    // Process audio
    auto* leftChannel = buffer.getWritePointer(0);
    auto* rightChannel = buffer.getNumChannels() > 1
        ? buffer.getWritePointer(1) : leftChannel;
    drumCore_.process(leftChannel, rightChannel, buffer.getNumSamples());

    // Master volume
    float masterVol = *apvts_.getRawParameterValue("master_vol");
    buffer.applyGain(masterVol);
}

// ─── State ───────────────────────────────────────────────

void ElasticDrumsProcessor::getStateInformation(juce::MemoryBlock& destData) {
    auto state = apvts_.copyState();

    juce::ValueTree patternTree("pattern");
    patternTree.setProperty("length", patternLength_, nullptr);

    for (int t = 0; t < 12; t++) {
        juce::ValueTree trackTree("track");
        trackTree.setProperty("index", t, nullptr);

        juce::String steps, velocities;
        for (int s = 0; s < 64; s++) {
            steps += stepPattern_[t][s] ? "1" : "0";
            velocities += juce::String(stepVelocity_[t][s]) + ",";
        }
        trackTree.setProperty("steps", steps, nullptr);
        trackTree.setProperty("velocities", velocities, nullptr);
        patternTree.addChild(trackTree, -1, nullptr);
    }

    state.addChild(patternTree, -1, nullptr);

    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void ElasticDrumsProcessor::setStateInformation(const void* data, int sizeInBytes) {
    std::unique_ptr<juce::XmlElement> xml(getXmlFromBinary(data, sizeInBytes));
    if (!xml) return;

    auto state = juce::ValueTree::fromXml(*xml);
    if (state.isValid()) {
        apvts_.replaceState(state);

        auto patternTree = state.getChildWithName("pattern");
        if (patternTree.isValid()) {
            patternLength_ = patternTree.getProperty("length", 16);

            for (int t = 0; t < patternTree.getNumChildren(); t++) {
                auto trackTree = patternTree.getChild(t);
                int idx = trackTree.getProperty("index", t);
                if (idx < 0 || idx >= 12) continue;

                juce::String steps = trackTree.getProperty("steps", "");
                juce::String velocities = trackTree.getProperty("velocities", "");

                for (int s = 0; s < std::min(64, steps.length()); s++) {
                    stepPattern_[idx][s] = steps[s] == '1';
                }

                juce::StringArray velArray;
                velArray.addTokens(velocities, ",", "");
                for (int s = 0; s < std::min(64, velArray.size()); s++) {
                    stepVelocity_[idx][s] = velArray[s].getIntValue();
                }
            }
        }

        syncParamsToCore();
    }
}

juce::AudioProcessorEditor* ElasticDrumsProcessor::createEditor() {
    return new ElasticDrumsEditor(*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new ElasticDrumsProcessor();
}
