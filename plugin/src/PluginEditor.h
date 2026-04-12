#pragma once
#include "PluginProcessor.h"

// Use JUCE's built-in generic editor — guaranteed stable in all DAWs
class ElasticDrumsEditor : public juce::GenericAudioProcessorEditor {
public:
    explicit ElasticDrumsEditor(ElasticDrumsProcessor& p)
        : juce::GenericAudioProcessorEditor(p) {
        setSize(600, 700);
        setResizable(true, true);
    }
};
