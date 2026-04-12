#pragma once

#include "PluginProcessor.h"

/**
 * Native JUCE Plugin Editor
 *
 * Simple but functional UI that works reliably in all DAWs:
 * - 12 drum pads (clickable + MIDI triggerable)
 * - Per-voice parameter knobs
 * - Generic parameter list for full automation access
 */
class ElasticDrumsEditor : public juce::AudioProcessorEditor,
                            private juce::Timer {
public:
    explicit ElasticDrumsEditor(ElasticDrumsProcessor& processor);
    ~ElasticDrumsEditor() override;

    void paint(juce::Graphics& g) override;
    void resized() override;
    void timerCallback() override;

private:
    ElasticDrumsProcessor& processor_;

    // Pad buttons
    std::array<std::unique_ptr<juce::TextButton>, 12> padButtons_;
    int selectedVoice_ = 0;

    // Parameter sliders for selected voice
    juce::OwnedArray<juce::Slider> voiceSliders_;
    juce::OwnedArray<juce::Label> voiceLabels_;
    juce::OwnedArray<juce::AudioProcessorValueTreeState::SliderAttachment> sliderAttachments_;

    // Master volume
    juce::Slider masterSlider_;
    juce::Label masterLabel_;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> masterAttachment_;

    // Info label
    juce::Label infoLabel_;

    void selectVoice(int voice);
    void triggerPad(int voice);
    void setupVoiceControls();

    static const juce::Colour padColours_[12];
    static const char* padNames_[12];
    static const char* voiceParamIds_[12];

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ElasticDrumsEditor)
};
