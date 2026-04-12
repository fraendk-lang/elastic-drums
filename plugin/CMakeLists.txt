cmake_minimum_required(VERSION 3.24)
project(ElasticDrumsPlugin VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ─── JUCE ─────────────────────────────────────────────────
include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG 8.0.4
    GIT_SHALLOW ON
)
FetchContent_MakeAvailable(JUCE)

# ─── DSP Core ─────────────────────────────────────────────
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../core core_build)

# ─── Plugin Target ────────────────────────────────────────
juce_add_plugin(ElasticDrums
    COMPANY_NAME "ElasticDrums"
    PLUGIN_MANUFACTURER_CODE ELDR
    PLUGIN_CODE Eldr
    FORMATS VST3 AU Standalone
    PRODUCT_NAME "Elastic Drums"
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    COPY_PLUGIN_AFTER_BUILD TRUE
)

target_sources(ElasticDrums
    PRIVATE
        src/PluginProcessor.cpp
        src/PluginProcessor.h
        src/PluginEditor.cpp
        src/PluginEditor.h
)

target_compile_definitions(ElasticDrums
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(ElasticDrums
    PRIVATE
        elastic-drums-core
        juce::juce_audio_basics
        juce::juce_audio_devices
        juce::juce_audio_formats
        juce::juce_audio_plugin_client
        juce::juce_audio_processors
        juce::juce_audio_utils
        juce::juce_core
        juce::juce_graphics
        juce::juce_gui_basics
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)
