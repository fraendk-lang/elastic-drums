#include "../DrumCore.h"
#include "../sequencer/Sequencer.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>

static elastic::DrumCore* gCore = nullptr;
static elastic::Sequencer* gSeq = nullptr;

// Trigger callback from sequencer → voices
static void onSequencerTrigger(int track, float velocity) {
    if (gCore) gCore->triggerVoice(track, velocity);
}

extern "C" {

// ─── Core Lifecycle ──────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void ed_init(float sampleRate, int blockSize) {
    if (!gCore) gCore = new elastic::DrumCore();
    if (!gSeq) gSeq = new elastic::Sequencer();
    gCore->init(sampleRate, blockSize);
    gSeq->init(sampleRate);
}

EMSCRIPTEN_KEEPALIVE
void ed_process(float* leftOut, float* rightOut, int numSamples) {
    if (!gCore) return;

    // Advance sequencer (triggers voices internally)
    if (gSeq) {
        gSeq->process(numSamples, onSequencerTrigger);
    }

    // Process all voices → stereo output
    gCore->process(leftOut, rightOut, numSamples);
}

// ─── Voice Control ───────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void ed_trigger(int voice, float velocity) {
    if (gCore) gCore->triggerVoice(voice, velocity);
}

EMSCRIPTEN_KEEPALIVE
void ed_set_param(int voice, int param, float value) {
    if (gCore) gCore->setVoiceParam(voice, static_cast<elastic::ParamID>(param), value);
}

EMSCRIPTEN_KEEPALIVE
float ed_get_param(int voice, int param) {
    if (gCore) return gCore->getVoiceParam(voice, static_cast<elastic::ParamID>(param));
    return 0.0f;
}

// ─── Transport ───────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void ed_set_bpm(float bpm) {
    if (gCore) gCore->setBpm(bpm);
    if (gSeq) gSeq->setBpm(bpm);
}

EMSCRIPTEN_KEEPALIVE
void ed_set_playing(int playing) {
    if (gSeq) gSeq->setPlaying(playing != 0);
}

EMSCRIPTEN_KEEPALIVE
int ed_get_current_step() {
    if (gSeq) return gSeq->getCurrentStep();
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int ed_is_playing() {
    if (gSeq) return gSeq->isPlaying() ? 1 : 0;
    return 0;
}

// ─── Sequencer Pattern ───────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void ed_set_step(int track, int step, int active, int velocity, int ratchet) {
    if (!gSeq) return;
    auto& pattern = gSeq->getPattern();
    if (track < 0 || track >= elastic::kNumTracks) return;
    if (step < 0 || step >= elastic::kMaxSteps) return;

    auto& s = pattern.tracks[track].steps[step];
    s.active = active != 0;
    s.velocity = static_cast<uint8_t>(velocity);
    s.ratchetCount = static_cast<uint8_t>(ratchet);
}

EMSCRIPTEN_KEEPALIVE
void ed_set_pattern_length(int length) {
    if (!gSeq) return;
    auto& pattern = gSeq->getPattern();
    pattern.globalLength = length;
}

EMSCRIPTEN_KEEPALIVE
void ed_set_swing(float swing) {
    if (!gSeq) return;
    gSeq->getPattern().swing = swing;
}

// ─── Memory Helpers (for audio buffers) ──────────────────

EMSCRIPTEN_KEEPALIVE
float* ed_alloc_buffer(int numSamples) {
    return new float[numSamples];
}

EMSCRIPTEN_KEEPALIVE
void ed_free_buffer(float* ptr) {
    delete[] ptr;
}

} // extern "C"

#endif
