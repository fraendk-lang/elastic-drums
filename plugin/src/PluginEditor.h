#pragma once
#include "PluginProcessor.h"

class ElasticDrumsEditor : public juce::AudioProcessorEditor,
                            private juce::Timer {
public:
    explicit ElasticDrumsEditor(ElasticDrumsProcessor& processor);
    ~ElasticDrumsEditor() override;

    void paint(juce::Graphics& g) override;
    void resized() override;
    void timerCallback() override;
    void mouseDown(const juce::MouseEvent& e) override;

private:
    ElasticDrumsProcessor& proc_;

    int selectedVoice_ = 0;
    bool stepGrid_[12][16] = {};
    int stepVel_[12][16] = {};
    int playingStep_ = -1;
    bool isPlaying_ = false;

    // Voice param sliders
    juce::OwnedArray<juce::Slider> knobs_;
    juce::OwnedArray<juce::Label> knobLabels_;
    juce::OwnedArray<juce::AudioProcessorValueTreeState::SliderAttachment> attachments_;

    juce::Slider masterSlider_;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> masterAtt_;

    void selectVoice(int v);
    void rebuildKnobs();
    void toggleStep(int track, int step);
    juce::Rectangle<int> getPadBounds(int index) const;
    juce::Rectangle<int> getStepBounds(int track, int step) const;

    static constexpr int kPadCols = 4;
    static constexpr int kPadRows = 3;
    static constexpr int kSteps = 16;
    static constexpr int kTracks = 12;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ElasticDrumsEditor)
};
