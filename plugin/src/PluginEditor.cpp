#include "PluginEditor.h"

ElasticDrumsEditor::ElasticDrumsEditor(ElasticDrumsProcessor& p)
    : AudioProcessorEditor(p), processor_(p)
{
    setSize(1280, 800);
    setResizable(true, true);
    setResizeLimits(800, 500, 2560, 1600);

    webView_ = std::make_unique<juce::WebBrowserComponent>(
        juce::WebBrowserComponent::Options()
            .withKeepPageLoadedWhenBrowserIsHidden()
    );

    addAndMakeVisible(*webView_);

    // Try to load the bundled webapp
    auto webappPath = findWebAppPath();

    if (webappPath.exists()) {
        auto indexFile = webappPath.getChildFile("index.html");
        // Use file:// URL for local files
        webView_->goToURL("file://" + indexFile.getFullPathName());
    } else {
        // Fallback: try dev server
        webView_->goToURL("http://localhost:5173");
    }
}

ElasticDrumsEditor::~ElasticDrumsEditor() = default;

void ElasticDrumsEditor::resized() {
    if (webView_)
        webView_->setBounds(getLocalBounds());
}

juce::File ElasticDrumsEditor::findWebAppPath() {
    // Search for webapp in multiple locations

    // 1. Next to the plugin binary (development)
    auto pluginFile = juce::File::getSpecialLocation(
        juce::File::SpecialLocationType::currentApplicationFile);

    // For .vst3 bundles: look inside Contents/Resources/webapp
    auto resourcesDir = pluginFile.getChildFile("Contents").getChildFile("Resources").getChildFile("webapp");
    if (resourcesDir.exists()) return resourcesDir;

    // 2. Look relative to the project directory (development mode)
    // Walk up from plugin binary to find the project root
    auto dir = pluginFile.getParentDirectory();
    for (int i = 0; i < 10; i++) {
        auto webappDir = dir.getChildFile("plugin").getChildFile("resources").getChildFile("webapp");
        if (webappDir.exists()) return webappDir;

        auto distDir = dir.getChildFile("dist");
        if (distDir.getChildFile("index.html").exists()) return distDir;

        dir = dir.getParentDirectory();
    }

    // 3. Hardcoded project path (development fallback)
    auto devPath = juce::File("/Users/frankkrumsdorf/Desktop/Elastic Drum/dist");
    if (devPath.exists()) return devPath;

    return juce::File();
}
