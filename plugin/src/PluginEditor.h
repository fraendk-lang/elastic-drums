#pragma once

#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>

class ElasticDrumsEditor : public juce::AudioProcessorEditor {
public:
    explicit ElasticDrumsEditor(ElasticDrumsProcessor& processor);
    ~ElasticDrumsEditor() override;

    void resized() override;

private:
    ElasticDrumsProcessor& processor_;
    std::unique_ptr<juce::WebBrowserComponent> webView_;

    static juce::File findWebAppPath();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ElasticDrumsEditor)
};
