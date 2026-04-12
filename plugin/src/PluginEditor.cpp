#include "PluginEditor.h"

ElasticDrumsEditor::ElasticDrumsEditor(ElasticDrumsProcessor& p)
    : AudioProcessorEditor(p), processor_(p)
{
    setSize(1280, 720);

    titleLabel_.setText("ELASTIC DRUMS", juce::dontSendNotification);
    titleLabel_.setFont(juce::FontOptions(24.0f, juce::Font::bold));
    titleLabel_.setColour(juce::Label::textColourId, juce::Colour(0xFFF59E0B));
    titleLabel_.setJustificationType(juce::Justification::centred);
    addAndMakeVisible(titleLabel_);

    infoLabel_.setText(
        "VST3/AU Plugin — React WebView UI coming in next iteration.\n"
        "MIDI input active: play notes C1-D#2 for drum triggers.",
        juce::dontSendNotification);
    infoLabel_.setFont(juce::FontOptions(14.0f));
    infoLabel_.setColour(juce::Label::textColourId, juce::Colour(0xFF888888));
    infoLabel_.setJustificationType(juce::Justification::centred);
    addAndMakeVisible(infoLabel_);
}

ElasticDrumsEditor::~ElasticDrumsEditor() = default;

void ElasticDrumsEditor::resized() {
    auto area = getLocalBounds();
    titleLabel_.setBounds(area.removeFromTop(100).reduced(20));
    infoLabel_.setBounds(area.reduced(40));
}
