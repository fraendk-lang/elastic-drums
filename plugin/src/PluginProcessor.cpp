#include "PluginProcessor.h"
#include "PluginEditor.h"

ElasticDrumsProcessor::ElasticDrumsProcessor()
    : AudioProcessor(BusesProperties()
          .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

ElasticDrumsProcessor::~ElasticDrumsProcessor() = default;

void ElasticDrumsProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
    drumCore_.init(static_cast<float>(sampleRate), samplesPerBlock);
}

void ElasticDrumsProcessor::releaseResources() {}

int ElasticDrumsProcessor::midiNoteToVoice(int note) const {
    // GM Drum Map
    switch (note) {
        case 36: return 0;  // C1  → Kick
        case 38: return 1;  // D1  → Snare
        case 39: return 2;  // D#1 → Clap
        case 41: return 3;  // F1  → Tom Lo
        case 43: return 4;  // G1  → Tom Mid
        case 45: return 5;  // A1  → Tom Hi
        case 42: return 6;  // F#1 → HH Closed
        case 46: return 7;  // A#1 → HH Open
        case 49: return 8;  // C#2 → Cymbal
        case 51: return 9;  // D#2 → Ride
        case 37: return 10; // C#1 → Perc 1
        case 40: return 11; // E1  → Perc 2
        default: return -1;
    }
}

void ElasticDrumsProcessor::processBlock(juce::AudioBuffer<float>& buffer,
                                          juce::MidiBuffer& midiMessages) {
    juce::ScopedNoDenormals noDenormals;

    // Process MIDI
    for (const auto metadata : midiMessages) {
        const auto msg = metadata.getMessage();
        if (msg.isNoteOn()) {
            int voice = midiNoteToVoice(msg.getNoteNumber());
            if (voice >= 0) {
                float velocity = msg.getFloatVelocity();
                drumCore_.triggerVoice(voice, velocity);
            }
        }
    }

    // Process audio
    auto* leftChannel = buffer.getWritePointer(0);
    auto* rightChannel = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : nullptr;

    if (rightChannel) {
        drumCore_.process(leftChannel, rightChannel, buffer.getNumSamples());
    } else {
        // Mono: process into left, copy to all channels
        float tempR[2048];
        drumCore_.process(leftChannel, tempR, buffer.getNumSamples());
    }
}

juce::AudioProcessorEditor* ElasticDrumsProcessor::createEditor() {
    return new ElasticDrumsEditor(*this);
}

void ElasticDrumsProcessor::getStateInformation(juce::MemoryBlock& /*destData*/) {
    // TODO: Serialize pattern + parameters to binary state
}

void ElasticDrumsProcessor::setStateInformation(const void* /*data*/, int /*sizeInBytes*/) {
    // TODO: Deserialize state
}

// Plugin entry point
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new ElasticDrumsProcessor();
}
