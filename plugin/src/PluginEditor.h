#pragma once

#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>

/**
 * Plugin Editor — uses WebBrowserComponent to display the React UI
 *
 * This embeds the same React UI that the browser version uses,
 * communicating with the C++ DSP core via postMessage.
 * This ensures visual and functional parity between browser and plugin.
 */
class ElasticDrumsEditor : public juce::AudioProcessorEditor {
public:
    explicit ElasticDrumsEditor(ElasticDrumsProcessor& processor);
    ~ElasticDrumsEditor() override;

    void resized() override;

private:
    ElasticDrumsProcessor& processor_;

    // TODO: WebBrowserComponent to embed React UI
    // For now: simple placeholder label
    juce::Label titleLabel_;
    juce::Label infoLabel_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ElasticDrumsEditor)
};
