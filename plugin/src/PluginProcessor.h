#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "DrumCore.h"

class ElasticDrumsProcessor : public juce::AudioProcessor {
public:
    ElasticDrumsProcessor();
    ~ElasticDrumsProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Elastic Drums"; }

    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    // Access to DSP core
    elastic::DrumCore& getDrumCore() { return drumCore_; }

private:
    elastic::DrumCore drumCore_;

    // GM Drum Map: MIDI note → voice index
    static constexpr int kMidiNoteMap[128] = {};
    int midiNoteToVoice(int note) const;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ElasticDrumsProcessor)
};
