#include "PluginEditor.h"

static const char* PAD_NAMES[] = {
    "KICK", "SNARE", "CLAP", "TOM L",
    "TOM M", "TOM H", "HH CL", "HH OP",
    "CYM", "RIDE", "PRC 1", "PRC 2"
};

static const juce::uint32 PAD_COLOURS[] = {
    0xFFF59E0B, 0xFFF59E0B, 0xFFF59E0B, 0xFFF59E0B,
    0xFFF59E0B, 0xFFF59E0B, 0xFF3B82F6, 0xFF3B82F6,
    0xFF3B82F6, 0xFF3B82F6, 0xFF8B5CF6, 0xFF8B5CF6,
};

static const char* VOICE_PREFIXES[] = {
    "kick", "snare", "clap", "tomlo", "tommid", "tomhi",
    "hhcl", "hhop", "cym", "ride", "perc1", "perc2"
};

// Which params each voice has beyond tune/decay/vol/pan
struct VoiceExtraParam { const char* suffix; const char* label; };
static const VoiceExtraParam KICK_EXTRAS[] = {
    {"click", "Click"}, {"drive", "Drive"}, {"sub", "Sub"}, {nullptr, nullptr}
};
static const VoiceExtraParam SNARE_EXTRAS[] = {
    {"snap", "Snap"}, {"tone", "Tone"}, {nullptr, nullptr}
};
static const VoiceExtraParam* VOICE_EXTRAS[] = {
    KICK_EXTRAS, SNARE_EXTRAS, nullptr, nullptr, nullptr, nullptr,
    nullptr, nullptr, nullptr, nullptr, nullptr, nullptr,
};

ElasticDrumsEditor::ElasticDrumsEditor(ElasticDrumsProcessor& p)
    : AudioProcessorEditor(p), processor_(p)
{
    setSize(900, 600);
    setResizable(true, true);
    setResizeLimits(700, 450, 1600, 1000);

    // Create pad buttons (4x3 grid)
    for (int i = 0; i < 12; i++) {
        padButtons_[i] = std::make_unique<juce::TextButton>(PAD_NAMES[i]);
        padButtons_[i]->setColour(juce::TextButton::buttonColourId,
            juce::Colour(PAD_COLOURS[i]).withAlpha(0.3f));
        padButtons_[i]->setColour(juce::TextButton::textColourOffId,
            juce::Colour(PAD_COLOURS[i]));
        padButtons_[i]->onClick = [this, i]() { triggerPad(i); selectVoice(i); };
        addAndMakeVisible(*padButtons_[i]);
    }

    // Master volume
    masterLabel_.setText("MASTER", juce::dontSendNotification);
    masterLabel_.setFont(juce::FontOptions(11.0f, juce::Font::bold));
    masterLabel_.setColour(juce::Label::textColourId, juce::Colour(0xFF22C55E));
    masterLabel_.setJustificationType(juce::Justification::centred);
    addAndMakeVisible(masterLabel_);

    masterSlider_.setSliderStyle(juce::Slider::LinearVertical);
    masterSlider_.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 60, 15);
    masterSlider_.setColour(juce::Slider::thumbColourId, juce::Colour(0xFF22C55E));
    addAndMakeVisible(masterSlider_);
    masterAttachment_ = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(
        processor_.getAPVTS(), "master_vol", masterSlider_);

    // Info
    infoLabel_.setText("MIDI: C1-B1 = 12 Voices | Click pads or use MIDI controller",
        juce::dontSendNotification);
    infoLabel_.setFont(juce::FontOptions(11.0f));
    infoLabel_.setColour(juce::Label::textColourId, juce::Colours::grey);
    infoLabel_.setJustificationType(juce::Justification::centred);
    addAndMakeVisible(infoLabel_);

    selectVoice(0);
    startTimerHz(15); // For pad flash animation
}

ElasticDrumsEditor::~ElasticDrumsEditor() {
    stopTimer();
}

void ElasticDrumsEditor::selectVoice(int voice) {
    selectedVoice_ = voice;

    // Highlight selected pad
    for (int i = 0; i < 12; i++) {
        bool sel = (i == voice);
        padButtons_[i]->setColour(juce::TextButton::buttonColourId,
            juce::Colour(PAD_COLOURS[i]).withAlpha(sel ? 0.6f : 0.2f));
        padButtons_[i]->setToggleState(sel, juce::dontSendNotification);
    }

    setupVoiceControls();
    resized();
}

void ElasticDrumsEditor::triggerPad(int voice) {
    processor_.getDrumCore().triggerVoice(voice, 0.8f);
}

void ElasticDrumsEditor::setupVoiceControls() {
    // Clear existing
    sliderAttachments_.clear();
    voiceSliders_.clear();
    voiceLabels_.clear();

    auto prefix = juce::String(VOICE_PREFIXES[selectedVoice_]) + "_";
    auto& apvts = processor_.getAPVTS();

    // Standard params: Tune, Decay, Volume, Pan
    struct ParamDef { const char* suffix; const char* label; };
    ParamDef standardParams[] = {
        {"tune", "Tune"}, {"decay", "Decay"}, {"vol", "Volume"}, {"pan", "Pan"}
    };

    auto addSlider = [&](const juce::String& paramId, const juce::String& label) {
        auto* slider = voiceSliders_.add(new juce::Slider());
        slider->setSliderStyle(juce::Slider::RotaryVerticalDrag);
        slider->setTextBoxStyle(juce::Slider::TextBoxBelow, false, 55, 14);
        slider->setColour(juce::Slider::rotarySliderFillColourId,
            juce::Colour(PAD_COLOURS[selectedVoice_]));
        addAndMakeVisible(slider);

        auto* lbl = voiceLabels_.add(new juce::Label());
        lbl->setText(label, juce::dontSendNotification);
        lbl->setFont(juce::FontOptions(10.0f, juce::Font::bold));
        lbl->setColour(juce::Label::textColourId, juce::Colours::grey);
        lbl->setJustificationType(juce::Justification::centred);
        addAndMakeVisible(lbl);

        if (apvts.getParameter(paramId) != nullptr) {
            sliderAttachments_.add(
                new juce::AudioProcessorValueTreeState::SliderAttachment(apvts, paramId, *slider));
        }
    };

    for (auto& p : standardParams) {
        addSlider(prefix + p.suffix, p.label);
    }

    // Voice-specific extras
    auto* extras = VOICE_EXTRAS[selectedVoice_];
    if (extras) {
        for (int i = 0; extras[i].suffix != nullptr; i++) {
            addSlider(prefix + extras[i].suffix, extras[i].label);
        }
    }
}

void ElasticDrumsEditor::paint(juce::Graphics& g) {
    g.fillAll(juce::Colour(0xFF0A0A0C));

    // Title
    g.setColour(juce::Colour(0xFFF59E0B));
    g.setFont(juce::FontOptions(18.0f, juce::Font::bold));
    g.drawText("ELASTIC DRUMS", 15, 8, 250, 25, juce::Justification::centredLeft);

    // Selected voice label
    g.setColour(juce::Colour(PAD_COLOURS[selectedVoice_]));
    g.setFont(juce::FontOptions(13.0f, juce::Font::bold));
    g.drawText(juce::String(PAD_NAMES[selectedVoice_]) + " — Parameters",
        320, 8, 300, 25, juce::Justification::centredLeft);

    // Divider line
    g.setColour(juce::Colour(0xFF2A2A34));
    g.drawHorizontalLine(35, 0, static_cast<float>(getWidth()));
}

void ElasticDrumsEditor::resized() {
    auto bounds = getLocalBounds();
    auto topArea = bounds.removeFromTop(36); // Title bar

    // Bottom info bar
    infoLabel_.setBounds(bounds.removeFromBottom(22));

    // Left: Pad grid (4 cols × 3 rows)
    auto padArea = bounds.removeFromLeft(280).reduced(8);
    int padW = padArea.getWidth() / 4;
    int padH = padArea.getHeight() / 3;

    for (int i = 0; i < 12; i++) {
        int col = i % 4;
        int row = i / 4;
        padButtons_[i]->setBounds(
            padArea.getX() + col * padW + 2,
            padArea.getY() + row * padH + 2,
            padW - 4, padH - 4);
    }

    // Right: Master fader
    auto masterArea = bounds.removeFromRight(60);
    masterLabel_.setBounds(masterArea.removeFromTop(20));
    masterSlider_.setBounds(masterArea.reduced(8));

    // Center: Voice parameter knobs
    auto knobArea = bounds.reduced(10, 5);
    int numKnobs = voiceSliders_.size();
    if (numKnobs == 0) return;

    int knobsPerRow = std::min(numKnobs, 7);
    int rows = (numKnobs + knobsPerRow - 1) / knobsPerRow;
    int knobW = knobArea.getWidth() / knobsPerRow;
    int knobH = knobArea.getHeight() / rows;
    int labelH = 16;

    for (int i = 0; i < numKnobs; i++) {
        int col = i % knobsPerRow;
        int row = i / knobsPerRow;
        int x = knobArea.getX() + col * knobW;
        int y = knobArea.getY() + row * knobH;

        voiceLabels_[i]->setBounds(x, y, knobW, labelH);
        voiceSliders_[i]->setBounds(x, y + labelH, knobW, knobH - labelH);
    }
}

void ElasticDrumsEditor::timerCallback() {
    // Could animate pad brightness based on voice activity
    repaint();
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new ElasticDrumsProcessor();
}
