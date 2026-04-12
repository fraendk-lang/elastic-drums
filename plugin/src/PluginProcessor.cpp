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
    // Chromatic mapping: C1-B1 (36-47) = all 12 voices in one octave
    // Also repeats every octave (C0-B0, C1-B1, C2-B2, etc.)
    if (note < 24 || note > 96) return -1;

    int voiceIndex = (note - 36) % 12;
    if (voiceIndex < 0) voiceIndex += 12;

    // Map chromatic to voice order:
    // C=Kick, C#=Snare, D=Clap, D#=TomL, E=TomM, F=TomH
    // F#=HH Cl, G=HH Op, G#=Cymbal, A=Ride, A#=Perc1, B=Perc2
    return (voiceIndex >= 0 && voiceIndex < 12) ? voiceIndex : -1;
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
