#include "../DrumCore.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>

static elastic::DrumCore* gCore = nullptr;

extern "C" {

EMSCRIPTEN_KEEPALIVE
void ed_init(float sampleRate, int blockSize) {
    if (!gCore) gCore = new elastic::DrumCore();
    gCore->init(sampleRate, blockSize);
}

EMSCRIPTEN_KEEPALIVE
void ed_process(float* leftOut, float* rightOut, int numSamples) {
    if (gCore) gCore->process(leftOut, rightOut, numSamples);
}

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

EMSCRIPTEN_KEEPALIVE
void ed_set_bpm(float bpm) {
    if (gCore) gCore->setBpm(bpm);
}

} // extern "C"

#endif
