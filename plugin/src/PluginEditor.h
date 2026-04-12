#pragma once
#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>
#include <map>

/**
 * Plugin Editor — WebView with Resource Provider
 * (Same pattern as the working Elastic Synth M4 plugin)
 */
class ElasticDrumsEditor : public juce::AudioProcessorEditor,
                            private juce::Timer {
public:
    explicit ElasticDrumsEditor(ElasticDrumsProcessor& p);
    ~ElasticDrumsEditor() override;

    void resized() override;
    void timerCallback() override;
    void paint(juce::Graphics&) override {}

private:
    struct PluginWebView : juce::WebBrowserComponent {
        using WebBrowserComponent::WebBrowserComponent;
        bool pageAboutToLoad(const juce::String&) override { return true; }
        std::function<void()> onPageLoaded;
        void pageFinishedLoading(const juce::String&) override {
            if (onPageLoaded) onPageLoaded();
        }
    };

    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);
    static std::string getMime(const juce::String& ext);
    static std::vector<std::byte> readFile(const juce::File& f);

    ElasticDrumsProcessor& processor_;
    juce::File webUiRoot_;
    std::unique_ptr<PluginWebView> webView_;
    bool uiLoaded_ = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ElasticDrumsEditor)
};
