# Elastic Drums — Project Memory

## What is this?

Elastic Drums is a hybrid drum machine combining VA-Synthese (TR-808/909) with a Sample Engine (LinnDrum µ-Law) and an Elektron-level Sequencer. It runs as a Browser instrument (WASM) and VST3/AU Plugin (JUCE), sharing the same C++ DSP core.

## Architecture

```
C++ DrumCore (core/)
├── voices/          KickVoice, SnareVoice, ClapVoice, TomVoice, HiHatVoice, SampleVoice
├── sequencer/       Sequencer, PatternData (P-Locks, Conditional Trigs)
├── fx/              Distortion, Filter, Compressor, Reverb, Delay
├── mixer/           12-channel Mixer
└── wasm/            Emscripten bindings (WasmBindings.cpp)

React UI (src/)
├── components/      PadGrid, StepSequencer, Transport, VoiceEditor, MixerStrip
├── audio/           AudioEngine.ts, drum-worklet.ts
├── store/           Zustand store (drumStore.ts)
└── hooks/           Custom React hooks

Plugin (plugin/)     JUCE wrapper (Phase 7)
```

## Tech Stack

| Layer        | Browser                           | Plugin                    |
|-------------|-----------------------------------|---------------------------|
| DSP         | C++ → WASM (Emscripten)          | C++ nativ (DrumCore)      |
| Audio       | AudioWorklet + SharedArrayBuffer  | JUCE processBlock         |
| UI          | React 19 + TypeScript + Tailwind  | JUCE WebBrowserComponent  |
| State       | Zustand ↔ WASM MessagePort       | APVTS ↔ WebView           |
| Build       | Vite + Emscripten                 | CMake + JUCE 8            |

## Voices (12)

| # | Voice    | Engine      | Key Params                    |
|---|----------|-------------|-------------------------------|
| 0 | Kick     | VA-Synth    | Tune, Decay, Click, Drive, Sub |
| 1 | Snare    | VA-Synth    | Tune, Decay, Tone, Snap       |
| 2 | Clap     | VA-Synth    | Decay, Tone                   |
| 3 | Tom Lo   | VA-Synth    | Tune, Decay                   |
| 4 | Tom Mid  | VA-Synth    | Tune, Decay                   |
| 5 | Tom Hi   | VA-Synth    | Tune, Decay                   |
| 6 | HH Cl   | Sample+VA   | Tune, Decay, Tone (choke grp) |
| 7 | HH Op   | Sample+VA   | Tune, Decay, Tone (choke grp) |
| 8 | Cymbal  | Sample      | Tune, Decay, Pan              |
| 9 | Ride    | Sample      | Tune, Decay                   |
| 10| Perc 1  | VA/Sample   | All configurable              |
| 11| Perc 2  | VA/Sample   | All configurable              |

## Audio Thread Rules (Real-Time Safety)

- **NO dynamic allocations** (malloc/new) in processBlock
- **NO mutex locks** — use atomics for UI→DSP parameters
- **NO file I/O** in audio thread
- **NO exceptions** in DSP code (-fno-exceptions)
- Sample loading: background thread only, swap via atomic pointer
- DSP graph is static — toggle via bypass/parameter, never create/destroy nodes

## Sequencer Data Model

- 12 Tracks × 64 Steps
- Per step: active, velocity (0-127), microTiming (±23 ticks), condition, paramLocks[], ratchetCount, probability
- Conditions: Always, Probability, Cycle (A:B), Fill, Pre/!Pre, Nei/!Nei, First/!First
- Swing: 50-75% global + per-step microtiming
- Polymetric: per-track length

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server (Vite)
npm run build        # Production build
npm run build:wasm   # Build C++ to WASM (requires Emscripten)
npm test             # Run tests
```

## Conventions

- **C++**: C++20, snake_case for files, PascalCase for classes, camelCase for methods
- **TypeScript**: strict mode, no `any`, named exports
- **CSS**: Tailwind utility classes, CSS variables for theme colors
- **Git**: Conventional commits (feat:, fix:, refactor:, etc.)

## Current Phase

**Phase 1: Bootstrapping** (Week 1-4)
- [x] Repository structure
- [x] Build pipeline (Vite + CMake + Emscripten)
- [x] C++ DrumCore skeleton (all voices, sequencer, FX, mixer)
- [x] React UI skeleton (PadGrid, StepSequencer, Transport, Mixer)
- [x] WASM AudioWorklet bridge
- [ ] Install dependencies & first dev server run
- [ ] First playable sound (Kick Voice via pad click)

## Reference Documents

- Konzept: `/Users/frankkrumsdorf/Downloads/Elastic-Drums-Konzept.docx`
- Technische Analyse: `/Users/frankkrumsdorf/Downloads/Drumcomputer als Browser-App und VST_AU.pdf`
