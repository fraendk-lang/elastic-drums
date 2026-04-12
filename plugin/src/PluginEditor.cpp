#include "PluginEditor.h"

static const char* PAD_NAMES[] = {
    "KICK","SNARE","CLAP","TOM L","TOM M","TOM H",
    "HH CL","HH OP","CYM","RIDE","PRC1","PRC2"
};
static const juce::uint32 PAD_CLR[] = {
    0xFFF59E0B,0xFFF59E0B,0xFFF59E0B,0xFFF59E0B,0xFFF59E0B,0xFFF59E0B,
    0xFF3B82F6,0xFF3B82F6,0xFF3B82F6,0xFF3B82F6,0xFF8B5CF6,0xFF8B5CF6,
};
static const char* TRACK_SHORT[] = {
    "KCK","SNR","CLP","TL","TM","TH","HHC","HHO","CYM","RDE","P1","P2"
};
static const char* VOICE_PFX[] = {
    "kick","snare","clap","tomlo","tommid","tomhi",
    "hhcl","hhop","cym","ride","perc1","perc2"
};

struct ExtraParam { const char* id; const char* name; };
static const ExtraParam KICK_EX[] = {{"click","Click"},{"drive","Drive"},{"sub","Sub"},{nullptr,nullptr}};
static const ExtraParam SNARE_EX[] = {{"snap","Snap"},{"tone","Tone"},{nullptr,nullptr}};
static const ExtraParam* EXTRAS[] = {KICK_EX,SNARE_EX,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr,nullptr};

// ─── Layout constants ────────────────────────────────────
static constexpr int kTopBar = 32;
static constexpr int kPadW = 70, kPadH = 50, kPadGap = 3;
static constexpr int kPadAreaW = (kPadW + kPadGap) * 4;
static constexpr int kStepH = 18, kStepW = 0; // computed
static constexpr int kSeqLabelW = 32;
static constexpr int kKnobSize = 70;

ElasticDrumsEditor::ElasticDrumsEditor(ElasticDrumsProcessor& p)
    : AudioProcessorEditor(p), proc_(p)
{
    setSize(1100, 650);
    setResizable(true, true);
    setResizeLimits(900, 500, 1920, 1080);

    // Master fader
    masterSlider_.setSliderStyle(juce::Slider::LinearVertical);
    masterSlider_.setTextBoxStyle(juce::Slider::NoTextBox, false, 0, 0);
    masterSlider_.setColour(juce::Slider::thumbColourId, juce::Colour(0xFF22C55E));
    masterSlider_.setColour(juce::Slider::trackColourId, juce::Colour(0xFF22C55E).withAlpha(0.3f));
    addAndMakeVisible(masterSlider_);
    masterAtt_ = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(
        proc_.getAPVTS(), "master_vol", masterSlider_);

    // Init step grid from processor
    for (int t = 0; t < 12; t++)
        for (int s = 0; s < 16; s++) {
            stepGrid_[t][s] = false;
            stepVel_[t][s] = 100;
        }

    selectVoice(0);
    startTimerHz(20);
}

ElasticDrumsEditor::~ElasticDrumsEditor() { stopTimer(); }

// ─── Voice selection ─────────────────────────────────────

void ElasticDrumsEditor::selectVoice(int v) {
    selectedVoice_ = v;
    rebuildKnobs();
    repaint();
}

void ElasticDrumsEditor::rebuildKnobs() {
    attachments_.clear();
    knobs_.clear();
    knobLabels_.clear();

    auto& apvts = proc_.getAPVTS();
    auto pfx = juce::String(VOICE_PFX[selectedVoice_]) + "_";
    auto clr = juce::Colour(PAD_CLR[selectedVoice_]);

    auto addKnob = [&](const juce::String& paramId, const juce::String& label) {
        if (!apvts.getParameter(paramId)) return;
        auto* k = knobs_.add(new juce::Slider());
        k->setSliderStyle(juce::Slider::RotaryVerticalDrag);
        k->setTextBoxStyle(juce::Slider::TextBoxBelow, false, 50, 13);
        k->setColour(juce::Slider::rotarySliderFillColourId, clr);
        k->setColour(juce::Slider::textBoxTextColourId, juce::Colours::grey);
        addAndMakeVisible(k);

        auto* l = knobLabels_.add(new juce::Label({}, label));
        l->setFont(juce::FontOptions(9.5f, juce::Font::bold));
        l->setColour(juce::Label::textColourId, juce::Colours::grey);
        l->setJustificationType(juce::Justification::centred);
        addAndMakeVisible(l);

        attachments_.add(new juce::AudioProcessorValueTreeState::SliderAttachment(apvts, paramId, *k));
    };

    addKnob(pfx + "tune", "TUNE");
    addKnob(pfx + "decay", "DECAY");
    addKnob(pfx + "vol", "VOL");
    addKnob(pfx + "pan", "PAN");

    auto* ex = EXTRAS[selectedVoice_];
    if (ex) for (int i = 0; ex[i].id; i++)
        addKnob(pfx + ex[i].id, ex[i].name);

    resized();
}

// ─── Step toggle ─────────────────────────────────────────

void ElasticDrumsEditor::toggleStep(int track, int step) {
    stepGrid_[track][step] = !stepGrid_[track][step];
    // Sync to processor
    proc_.getDrumCore().triggerVoice(track, 0.0f); // silent — just to test
    repaint();
}

// ─── Mouse ───────────────────────────────────────────────

void ElasticDrumsEditor::mouseDown(const juce::MouseEvent& e) {
    auto pos = e.getPosition();

    // Check pads
    for (int i = 0; i < 12; i++) {
        if (getPadBounds(i).contains(pos)) {
            selectVoice(i);
            proc_.getDrumCore().triggerVoice(i, 0.8f);
            return;
        }
    }

    // Check step grid
    for (int t = 0; t < kTracks; t++) {
        for (int s = 0; s < kSteps; s++) {
            if (getStepBounds(t, s).contains(pos)) {
                toggleStep(t, s);
                return;
            }
        }
    }
}

// ─── Bounds helpers ──────────────────────────────────────

juce::Rectangle<int> ElasticDrumsEditor::getPadBounds(int i) const {
    int col = i % kPadCols;
    int row = i / kPadCols;
    int x = 8 + col * (kPadW + kPadGap);
    int y = kTopBar + 8 + row * (kPadH + kPadGap);
    return { x, y, kPadW, kPadH };
}

juce::Rectangle<int> ElasticDrumsEditor::getStepBounds(int track, int step) const {
    int seqX = kPadAreaW + 20;
    int seqY = kTopBar + 8;
    int availW = getWidth() - seqX - 50; // leave room for master
    int sw = std::max(10, (availW - kSeqLabelW) / kSteps);
    int x = seqX + kSeqLabelW + step * sw;
    int y = seqY + track * (kStepH + 1);
    return { x, y, sw - 1, kStepH };
}

// ─── Paint ───────────────────────────────────────────────

void ElasticDrumsEditor::paint(juce::Graphics& g) {
    g.fillAll(juce::Colour(0xFF0A0A0C));

    // Title bar
    g.setColour(juce::Colour(0xFF141418));
    g.fillRect(0, 0, getWidth(), kTopBar);
    g.setColour(juce::Colour(0xFFF59E0B));
    g.setFont(juce::FontOptions(15.0f, juce::Font::bold));
    g.drawText("ELASTIC DRUMS", 10, 0, 200, kTopBar, juce::Justification::centredLeft);

    // Selected voice name
    g.setColour(juce::Colour(PAD_CLR[selectedVoice_]));
    g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
    g.drawText(juce::String(PAD_NAMES[selectedVoice_]) + " — Parameters",
        10, getHeight() - 140, 280, 18, juce::Justification::centredLeft);

    // ─── Pads ────────────────────────────────────────────
    for (int i = 0; i < 12; i++) {
        auto r = getPadBounds(i);
        auto clr = juce::Colour(PAD_CLR[i]);
        bool sel = (i == selectedVoice_);

        g.setColour(sel ? clr.withAlpha(0.35f) : juce::Colour(0xFF1C1C22));
        g.fillRoundedRectangle(r.toFloat(), 4.0f);

        if (sel) {
            g.setColour(clr);
            g.drawRoundedRectangle(r.toFloat(), 4.0f, 2.0f);
        }

        g.setColour(clr.withAlpha(sel ? 1.0f : 0.6f));
        g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
        g.drawText(PAD_NAMES[i], r, juce::Justification::centred);
    }

    // ─── Step Sequencer Grid ─────────────────────────────
    int seqX = kPadAreaW + 20;
    int seqY = kTopBar + 8;

    for (int t = 0; t < kTracks; t++) {
        // Track label
        g.setColour(juce::Colour(PAD_CLR[t]).withAlpha(0.7f));
        g.setFont(juce::FontOptions(8.0f, juce::Font::bold));
        g.drawText(TRACK_SHORT[t], seqX, seqY + t * (kStepH + 1), kSeqLabelW - 2, kStepH,
            juce::Justification::centredRight);

        for (int s = 0; s < kSteps; s++) {
            auto r = getStepBounds(t, s);
            bool on = stepGrid_[t][s];
            bool isBeat = (s % 4 == 0);
            bool isCurrent = (s == playingStep_ && isPlaying_);

            if (on) {
                g.setColour(juce::Colour(PAD_CLR[t]).withAlpha(0.8f));
            } else {
                g.setColour(isBeat ? juce::Colour(0xFF222228) : juce::Colour(0xFF1A1A20));
            }
            g.fillRoundedRectangle(r.toFloat(), 2.0f);

            if (isCurrent) {
                g.setColour(juce::Colours::white.withAlpha(0.15f));
                g.fillRoundedRectangle(r.toFloat(), 2.0f);
            }
        }
    }

    // Step numbers
    g.setColour(juce::Colours::grey.withAlpha(0.4f));
    g.setFont(juce::FontOptions(7.5f));
    for (int s = 0; s < kSteps; s++) {
        auto r = getStepBounds(0, s);
        g.drawText(juce::String(s + 1), r.getX(), seqY - 12, r.getWidth(), 10,
            juce::Justification::centred);
    }

    // Playhead line
    if (isPlaying_ && playingStep_ >= 0 && playingStep_ < kSteps) {
        auto r = getStepBounds(0, playingStep_);
        g.setColour(juce::Colour(0xFFF59E0B));
        g.fillRect(r.getX(), seqY - 3, r.getWidth(), 2);
    }

    // Master label
    g.setColour(juce::Colour(0xFF22C55E));
    g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
    g.drawText("MST", getWidth() - 45, kTopBar + 5, 40, 14, juce::Justification::centred);

    // Divider
    g.setColour(juce::Colour(0xFF2A2A34));
    g.drawHorizontalLine(getHeight() - 145, 0, static_cast<float>(kPadAreaW + 15));
}

// ─── Layout ──────────────────────────────────────────────

void ElasticDrumsEditor::resized() {
    // Master fader
    masterSlider_.setBounds(getWidth() - 40, kTopBar + 20, 30, getHeight() - kTopBar - 170);

    // Knobs below pads
    int knobY = getHeight() - 130;
    int numKnobs = knobs_.size();
    int knobArea = kPadAreaW;

    for (int i = 0; i < numKnobs; i++) {
        int x = 8 + i * (kKnobSize);
        if (x + kKnobSize > knobArea + 8) {
            // Wrap to second row
            x = 8 + (i - knobArea / kKnobSize) * kKnobSize;
            knobLabels_[i]->setBounds(x, knobY + 75, kKnobSize, 12);
            knobs_[i]->setBounds(x, knobY + 75 + 12, kKnobSize, kKnobSize - 15);
        } else {
            knobLabels_[i]->setBounds(x, knobY, kKnobSize, 12);
            knobs_[i]->setBounds(x, knobY + 12, kKnobSize, kKnobSize - 15);
        }
    }
}

// ─── Timer ───────────────────────────────────────────────

void ElasticDrumsEditor::timerCallback() {
    auto& seq = proc_.seqState;
    bool needsRepaint = false;

    if (seq.playing != isPlaying_ || seq.currentStep != playingStep_) {
        isPlaying_ = seq.playing;
        playingStep_ = seq.currentStep;
        needsRepaint = true;
    }

    if (needsRepaint) repaint();
}

// createPluginFilter() is in PluginProcessor.cpp
