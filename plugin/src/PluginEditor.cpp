#include "PluginEditor.h"

ElasticDrumsEditor::ElasticDrumsEditor(ElasticDrumsProcessor& p)
    : AudioProcessorEditor(p), processor_(p)
{
    setSize(1280, 800);
    setResizable(true, true);
    setResizeLimits(800, 500, 2560, 1600);

    // Create WebBrowserComponent with default (native) backend
    // macOS: WKWebView, Windows: WebView2
    webView_ = std::make_unique<juce::WebBrowserComponent>(
        juce::WebBrowserComponent::Options()
            .withKeepPageLoadedWhenBrowserIsHidden()
    );

    addAndMakeVisible(*webView_);

    // Load the React app from dev server
    webView_->goToURL("http://localhost:5173");
}

ElasticDrumsEditor::~ElasticDrumsEditor() = default;

void ElasticDrumsEditor::resized() {
    if (webView_)
        webView_->setBounds(getLocalBounds());
}
