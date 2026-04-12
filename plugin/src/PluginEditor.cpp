#include "PluginEditor.h"

// ─── Helpers ─────────────────────────────────────────────

std::string ElasticDrumsEditor::getMime(const juce::String& ext) {
    if (ext == "html") return "text/html";
    if (ext == "css")  return "text/css";
    if (ext == "js")   return "application/javascript";
    if (ext == "json") return "application/json";
    if (ext == "svg")  return "image/svg+xml";
    if (ext == "png")  return "image/png";
    if (ext == "wasm") return "application/wasm";
    return "application/octet-stream";
}

std::vector<std::byte> ElasticDrumsEditor::readFile(const juce::File& f) {
    juce::MemoryBlock mb;
    if (!f.loadFileAsData(mb)) return {};
    auto* ptr = reinterpret_cast<const std::byte*>(mb.getData());
    return { ptr, ptr + mb.getSize() };
}

// ─── Resource Provider ───────────────────────────────────

std::optional<juce::WebBrowserComponent::Resource>
ElasticDrumsEditor::getResource(const juce::String& url) {
    juce::String path = (url == "/" || url.isEmpty())
        ? juce::String("index.html")
        : url.fromFirstOccurrenceOf("/", false, false);

    if (path.containsChar('?')) path = path.upToFirstOccurrenceOf("?", false, false);
    if (path.containsChar('#')) path = path.upToFirstOccurrenceOf("#", false, false);

    const juce::File file = webUiRoot_.getChildFile(path);
    if (!file.existsAsFile()) {
        DBG("WebUI resource not found: " + path);
        return std::nullopt;
    }

    auto data = readFile(file);
    if (data.empty()) return std::nullopt;

    auto ext = file.getFileExtension().trimCharactersAtStart(".");
    return juce::WebBrowserComponent::Resource{
        std::move(data), juce::String(getMime(ext))
    };
}

// ─── Constructor ─────────────────────────────────────────

ElasticDrumsEditor::ElasticDrumsEditor(ElasticDrumsProcessor& p)
    : AudioProcessorEditor(p), processor_(p)
{
    // Find bundled web UI
    juce::File exe = juce::File::getSpecialLocation(juce::File::currentExecutableFile);

    // Try: <Bundle>/Contents/Resources/webui
    webUiRoot_ = exe.getParentDirectory().getParentDirectory()
        .getChildFile("Resources").getChildFile("webui");

    // Fallback: AU path
    if (!webUiRoot_.getChildFile("index.html").existsAsFile()) {
        webUiRoot_ = exe.getParentDirectory()
            .getChildFile("Resources").getChildFile("webui");
    }

    // Fallback: search upwards
    if (!webUiRoot_.getChildFile("index.html").existsAsFile()) {
        juce::File search = exe.getParentDirectory();
        for (int i = 0; i < 6; ++i) {
            auto candidate = search.getChildFile("Resources").getChildFile("webui");
            if (candidate.getChildFile("index.html").existsAsFile()) {
                webUiRoot_ = candidate;
                break;
            }
            search = search.getParentDirectory();
        }
    }

    // Dev fallback: project dist folder
    if (!webUiRoot_.getChildFile("index.html").existsAsFile()) {
        webUiRoot_ = juce::File("/Users/frankkrumsdorf/Desktop/Elastic Drum/dist");
    }

    DBG("Elastic Drums webUiRoot: " + webUiRoot_.getFullPathName());

    // Create WebView with resource provider (NO localhost, NO file://)
    webView_ = std::make_unique<PluginWebView>(
        juce::WebBrowserComponent::Options{}
            .withNativeIntegrationEnabled(true)
            .withNativeFunction("drumTrigger",
                [this](const juce::Array<juce::var>& args,
                       juce::WebBrowserComponent::NativeFunctionCompletion complete) {
                    if (args.size() >= 2) {
                        int voice = static_cast<int>(args[0]);
                        float vel = static_cast<float>(args[1]);
                        processor_.getDrumCore().triggerVoice(voice, vel);
                    }
                    complete(juce::var());
                })
            .withResourceProvider(
                [this](const juce::String& url) { return getResource(url); },
                std::nullopt)
    );

    webView_->onPageLoaded = [this]() {
        uiLoaded_ = true;
        DBG("Elastic Drums WebUI loaded!");
    };

    addAndMakeVisible(*webView_);
    setResizable(true, true);
    setSize(1280, 800);

    // Bootstrap trick for Ableton: load data: URL first, then redirect
    juce::Timer::callAfterDelay(200, [this]() {
        if (webView_ == nullptr) return;
        const auto root = juce::WebBrowserComponent::getResourceProviderRoot();
        juce::String bootstrap = "data:text/html,"
            "<html><body style='background:%230a0a0c'>"
            "<script>window.location.href='" + root + "';</script>"
            "</body></html>";
        webView_->goToURL(bootstrap);
    });

    startTimerHz(15);
}

ElasticDrumsEditor::~ElasticDrumsEditor() {
    stopTimer();
}

void ElasticDrumsEditor::resized() {
    if (webView_)
        webView_->setBounds(getLocalBounds());
}

void ElasticDrumsEditor::timerCallback() {
    // Future: sync host parameters → WebView
}
