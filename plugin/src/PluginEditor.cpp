#include "PluginEditor.h"

ElasticDrumsEditor::ElasticDrumsEditor(ElasticDrumsProcessor& p)
    : AudioProcessorEditor(p), processor_(p)
{
    setSize(1280, 800);
    setResizable(true, true);
    setResizeLimits(800, 500, 2560, 1600);

    // Create WebBrowserComponent — loads the React UI
    webView_ = std::make_unique<juce::WebBrowserComponent>(
        juce::WebBrowserComponent::Options()
            .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
            .withKeepPageLoadedWhenBrowserIsHidden()
    );

    addAndMakeVisible(*webView_);

    // Load the React app (dev server or production build)
    webView_->goToURL("http://localhost:5173");
}

ElasticDrumsEditor::~ElasticDrumsEditor() = default;

void ElasticDrumsEditor::resized() {
    webView_->setBounds(getLocalBounds());
}
