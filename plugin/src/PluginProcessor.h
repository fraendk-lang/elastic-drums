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
    double getTailLengthSeconds() const override { return 2.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    // DSP core
    elastic::DrumCore& getDrumCore() { return drumCore_; }

    // Parameter tree
    juce::AudioProcessorValueTreeState& getAPVTS() { return apvts_; }

    // Sequencer state
    struct SeqState {
        bool playing = false;
        int currentStep = 0;
        float bpm = 120.0f;
    };
    SeqState seqState;

private:
    elastic::DrumCore drumCore_;
    juce::AudioProcessorValueTreeState apvts_;

    // Sequencer timing
    double sampleCounter_ = 0.0;
    double samplesPerStep_ = 0.0;
    int internalStep_ = 0;

    // Simple pattern storage (16 steps × 12 tracks)
    bool stepPattern_[12][64] = {};
    int stepVelocity_[12][64] = {};
    int patternLength_ = 16;

    void syncParamsToCore();
    int midiNoteToVoice(int note) const;

    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ElasticDrumsProcessor)
};
