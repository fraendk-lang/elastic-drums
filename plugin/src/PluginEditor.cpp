#include "PluginEditor.h"

ElasticDrumsEditor::ElasticDrumsEditor(ElasticDrumsProcessor& p)
    : AudioProcessorEditor(p), processor_(p)
{
    setSize(800, 400);

    titleLabel_.setText("ELASTIC DRUMS", juce::dontSendNotification);
    titleLabel_.setFont(juce::FontOptions(28.0f, juce::Font::bold));
    titleLabel_.setColour(juce::Label::textColourId, juce::Colour(0xFFF59E0B));
    titleLabel_.setJustificationType(juce::Justification::centred);
    addAndMakeVisible(titleLabel_);

    infoLabel_.setText(
        "Hybrid Drum Machine — VA Synth + Elektron Sequencer\n\n"
        "MIDI Input: C1-B1 = 12 drum voices (chromatic)\n"
        "C=Kick  C#=Snare  D=Clap  D#=TomL  E=TomM  F=TomH\n"
        "F#=HHCl  G=HHOp  G#=Cym  A=Ride  A#=Prc1  B=Prc2\n\n"
        "All parameters are automatable from the DAW.\n"
        "Internal sequencer syncs to host tempo & transport.\n\n"
        "Full UI: http://localhost:5173",
        juce::dontSendNotification);
    infoLabel_.setFont(juce::FontOptions(13.0f));
    infoLabel_.setColour(juce::Label::textColourId, juce::Colour(0xFF999999));
    infoLabel_.setJustificationType(juce::Justification::centred);
    addAndMakeVisible(infoLabel_);
}

ElasticDrumsEditor::~ElasticDrumsEditor() = default;

void ElasticDrumsEditor::resized() {
    auto area = getLocalBounds();
    titleLabel_.setBounds(area.removeFromTop(80).reduced(20));
    infoLabel_.setBounds(area.reduced(30));
}
