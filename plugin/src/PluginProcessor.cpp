#include "PluginProcessor.h"
#include "PluginEditor.h"
#include <cmath>

// Voice names for parameter IDs
static const char* VOICE_NAMES[] = {
    "kick", "snare", "clap", "tomlo", "tommid", "tomhi",
    "hhcl", "hhop", "cym", "ride", "perc1", "perc2"
};

static const char* VOICE_LABELS[] = {
    "Kick", "Snare", "Clap", "Tom Lo", "Tom Mid", "Tom Hi",
    "HH Closed", "HH Open", "Cymbal", "Ride", "Perc 1", "Perc 2"
};

// ─── Parameter Layout ────────────────────────────────────

juce::AudioProcessorValueTreeState::ParameterLayout
ElasticDrumsProcessor::createParameterLayout() {
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;

    // Master
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID("master_vol", 1), "Master Volume", 0.0f, 1.0f, 0.85f));
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID("bpm", 1), "BPM", 30.0f, 300.0f, 120.0f));

    // Per-voice parameters
    for (int v = 0; v < 12; v++) {
        auto prefix = juce::String(VOICE_NAMES[v]) + "_";
        auto label = juce::String(VOICE_LABELS[v]) + " ";

        params.push_back(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(prefix + "tune", 1), label + "Tune", 20.0f, 2000.0f, 100.0f));
        params.push_back(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(prefix + "decay", 1), label + "Decay", 10.0f, 2000.0f, 300.0f));
        params.push_back(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(prefix + "vol", 1), label + "Volume", 0.0f, 127.0f, 100.0f));
        params.push_back(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(prefix + "pan", 1), label + "Pan", -100.0f, 100.0f, 0.0f));

        // Voice-specific params
        if (v == 0) { // Kick
            params.push_back(std::make_unique<juce::AudioParameterFloat>(
                juce::ParameterID(prefix + "click", 1), label + "Click", 0.0f, 100.0f, 50.0f));
            params.push_back(std::make_unique<juce::AudioParameterFloat>(
                juce::ParameterID(prefix + "drive", 1), label + "Drive", 0.0f, 100.0f, 40.0f));
            params.push_back(std::make_unique<juce::AudioParameterFloat>(
                juce::ParameterID(prefix + "sub", 1), label + "Sub", 0.0f, 100.0f, 60.0f));
        }
        if (v == 1) { // Snare
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
    // Init pattern to empty
    for (int t = 0; t < 12; t++)
        for (int s = 0; s < 64; s++) {
            stepPattern_[t][s] = false;
            stepVelocity_[t][s] = 100;
        }
}

ElasticDrumsProcessor::~ElasticDrumsProcessor() = default;

// ─── Audio Setup ─────────────────────────────────────────

void ElasticDrumsProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
    drumCore_.init(static_cast<float>(sampleRate), samplesPerBlock);
    syncParamsToCore();
}

void ElasticDrumsProcessor::releaseResources() {}

// ─── Sync APVTS → DrumCore ──────────────────────────────

void ElasticDrumsProcessor::syncParamsToCore() {
    for (int v = 0; v < 12; v++) {
        auto prefix = juce::String(VOICE_NAMES[v]) + "_";

        float tune = *apvts_.getRawParameterValue(prefix + "tune");
        float decay = *apvts_.getRawParameterValue(prefix + "decay");
        float vol = *apvts_.getRawParameterValue(prefix + "vol");

        drumCore_.setVoiceParam(v, elastic::ParamID::Tune, tune);
        drumCore_.setVoiceParam(v, elastic::ParamID::Decay, decay);
        drumCore_.setVoiceParam(v, elastic::ParamID::Volume, vol);

        if (v == 0) { // Kick specifics
            drumCore_.setVoiceParam(v, elastic::ParamID::Click,
                *apvts_.getRawParameterValue(prefix + "click"));
            drumCore_.setVoiceParam(v, elastic::ParamID::Drive,
                *apvts_.getRawParameterValue(prefix + "drive"));
            drumCore_.setVoiceParam(v, elastic::ParamID::Sub,
                *apvts_.getRawParameterValue(prefix + "sub"));
        }
        if (v == 1) { // Snare specifics
            drumCore_.setVoiceParam(v, elastic::ParamID::Snap,
                *apvts_.getRawParameterValue(prefix + "snap"));
            drumCore_.setVoiceParam(v, elastic::ParamID::Tone,
                *apvts_.getRawParameterValue(prefix + "tone"));
        }
    }
}

// ─── MIDI Mapping ────────────────────────────────────────

int ElasticDrumsProcessor::midiNoteToVoice(int note) const {
    if (note < 24 || note > 96) return -1;
    int voiceIndex = (note - 36) % 12;
    if (voiceIndex < 0) voiceIndex += 12;
    return (voiceIndex >= 0 && voiceIndex < 12) ? voiceIndex : -1;
}

// ─── Process Block ───────────────────────────────────────

void ElasticDrumsProcessor::processBlock(juce::AudioBuffer<float>& buffer,
                                          juce::MidiBuffer& midiMessages) {
    juce::ScopedNoDenormals noDenormals;

    // Sync params from DAW automation
    syncParamsToCore();

    // Get host tempo/transport
    auto playHead = getPlayHead();
    if (playHead) {
        auto posInfo = playHead->getPosition();
        if (posInfo.hasValue()) {
            auto bpmOpt = posInfo->getBpm();
            if (bpmOpt.hasValue()) {
                seqState.bpm = static_cast<float>(*bpmOpt);
                drumCore_.setBpm(seqState.bpm);
            }

            seqState.playing = posInfo->getIsPlaying();

            // PPQ position for sample-accurate sync
            auto ppqOpt = posInfo->getPpqPosition();
            if (ppqOpt.hasValue() && seqState.playing) {
                double ppq = *ppqOpt;
                // 1 quarter note = 4 steps (16th notes)
                int newStep = static_cast<int>(std::fmod(ppq * 4.0, static_cast<double>(patternLength_)));
                if (newStep < 0) newStep += patternLength_;

                // Step changed → trigger voices
                if (newStep != internalStep_) {
                    internalStep_ = newStep;
                    seqState.currentStep = newStep;

                    for (int track = 0; track < 12; track++) {
                        if (stepPattern_[track][newStep]) {
                            float vel = static_cast<float>(stepVelocity_[track][newStep]) / 127.0f;
                            drumCore_.triggerVoice(track, vel);
                        }
                    }
                }
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
    auto* rightChannel = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : leftChannel;
    drumCore_.process(leftChannel, rightChannel, buffer.getNumSamples());

    // Apply master volume
    float masterVol = *apvts_.getRawParameterValue("master_vol");
    buffer.applyGain(masterVol);
}

// ─── State ───────────────────────────────────────────────

void ElasticDrumsProcessor::getStateInformation(juce::MemoryBlock& destData) {
    // Save APVTS state + pattern
    auto state = apvts_.copyState();

    // Add pattern data as child
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

        // Restore pattern
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
