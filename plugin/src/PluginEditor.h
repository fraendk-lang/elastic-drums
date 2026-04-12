#pragma once

#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>

/**
 * Plugin Editor — Embeds the full React UI via WebBrowserComponent
 *
 * Loads the React app from the Vite dev server (localhost:5173)
 * or from bundled resources in production.
 */
class ElasticDrumsEditor : public juce::AudioProcessorEditor {
public:
    explicit ElasticDrumsEditor(ElasticDrumsProcessor& processor);
    ~ElasticDrumsEditor() override;

    void resized() override;

private:
    ElasticDrumsProcessor& processor_;
    std::unique_ptr<juce::WebBrowserComponent> webView_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ElasticDrumsEditor)
};
