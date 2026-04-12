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
└── wasm/            Emscripten bindings → AudioWorklet

React UI (src/)
├── components/      PadGrid, StepSequencer, Transport, VoiceEditor, MixerPanel,
│                    MixerStrip, Knob, EuclideanGenerator, SongEditor, PatternBrowser
├── audio/           AudioEngine.ts (12 TS voices + WASM bridge), SampleManager, MuLaw
├── store/           Zustand store (drumStore.ts) — pattern, sequencer, P-Locks, conditions
├── hooks/           useKeyboard, useMidi, useMotionRecording
├── storage/         patternStorage.ts (IndexedDB)
└── types/           TypeScript declarations

Plugin (plugin/)
├── CMakeLists.txt   JUCE 8 FetchContent (VST3/AU/Standalone)
└── src/             PluginProcessor (DrumCore + MIDI), PluginEditor (placeholder)
```

## Tech Stack

| Layer        | Browser                           | Plugin                    |
|-------------|-----------------------------------|---------------------------|
| DSP         | C++ → WASM (Emscripten 5.0.5)    | C++ nativ (DrumCore)      |
| Audio       | AudioWorklet + Web Audio API      | JUCE processBlock         |
| UI          | React 19 + TypeScript + Tailwind  | JUCE WebBrowserComponent  |
| State       | Zustand ↔ WASM MessagePort       | APVTS ↔ WebView           |
| Build       | Vite + Emscripten                 | CMake + JUCE 8            |
| Storage     | IndexedDB + OPFS                  | Filesystem                |

## Features Implemented

### Sound Engine
- 12 VA drum voices (Kick, Snare, Clap, 3 Toms, 2 HiHats, Cymbal, Ride, 2 Perc)
- Per-voice parametric control (Tune, Decay, Drive, Click, Sub, Tone, Snap, etc.)
- Sample drag & drop on pads (WAV/MP3/OGG/FLAC)
- µ-Law vintage mode (8-bit companding for LinnDrum character)
- Rotary knob UI with drag-to-turn and double-click reset

### Sequencer
- 64 steps (4 pages × 16), per-track polymetric length
- Parameter Locks (hold step + turn knob = per-step override)
- 16 Conditional Trig types (prob, fill, pre, nei, 1st, x:y cycle, etc.)
- Ratchet/Retrig (1-8x per step with velocity ramp)
- Swing (50-75%)
- Motion Recording (REC mode: knob changes → P-Locks in real-time)
- Euclidean Rhythm Generator (Bjorklund's algorithm with presets)
- Fill Mode (hold FILL button for conditional fill patterns)
- Song Mode (pattern chain with repeats)

### Effects
- Per-voice insert FX: Filter (LP/HP/BP) + Distortion (tanh waveshaper)
- Send A: Algorithmic Reverb (ConvolverNode, generated impulse response)
- Send B: Feedback Delay (LP-filtered, BPM-syncable)
- Master Chain: 3-Band EQ → Bus Compressor → Brick-wall Limiter

### Mixer
- Fullscreen Ableton-style layout
- 12 channel strips + Master with real-time peak meters
- Volume faders, Mute/Solo buttons, REV/DLY send knobs per channel
- Global Reverb/Delay controls

### Input
- QWERTY keyboard mapping (Q-V = 12 pads, Space = Play, 1-6 = Presets)
- Web MIDI API (GM drum map, hot-plug, MIDI Learn infrastructure)

### Pattern Management
- 14 genre preset patterns (808, 909, Trap, DnB, House, Techno, etc.)
- Save/Load via IndexedDB (Pattern Browser)
- Track Copy/Paste

### Platform
- C++ DSP → WASM (Emscripten 5.0.5, 21KB binary)
- WASM AudioWorklet processor with pattern sync
- PWA: manifest, favicon, service worker (offline-capable)
- JUCE plugin wrapper: VST3/AU/Standalone with MIDI input

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server (Vite)
npm run build        # Production build
npm run build:wasm   # Build C++ to WASM (requires Emscripten)
npm test             # Run tests

# Plugin build (requires JUCE 8 via CMake FetchContent)
cmake -B plugin/build plugin
cmake --build plugin/build
```

## Conventions

- **C++**: C++20, snake_case for files, PascalCase for classes, camelCase for methods
- **TypeScript**: strict mode, no `any`, named exports
- **CSS**: Tailwind utility classes, CSS variables for theme colors
- **Git**: Conventional commits (feat:, fix:, refactor:, etc.)

## Audio Thread Rules (Real-Time Safety)

- **NO dynamic allocations** (malloc/new) in processBlock
- **NO mutex locks** — use atomics for UI→DSP parameters
- **NO file I/O** in audio thread
- **NO exceptions** in DSP code (-fno-exceptions)
- DSP graph is static — toggle via bypass/parameter, never create/destroy nodes

## Current Status

All 8 phases from the concept document completed. Open items:
- Sound Library content (400+ kits — content creation task)
- JUCE WebBrowserComponent integration for plugin UI
- pluginval certification
- MIDI drag & drop export
- Pattern URL sharing

## Reference Documents

- Konzept: `/Users/frankkrumsdorf/Downloads/Elastic-Drums-Konzept.docx`
- Technische Analyse: `/Users/frankkrumsdorf/Downloads/Drumcomputer als Browser-App und VST_AU.pdf`
