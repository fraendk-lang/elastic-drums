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
├── components/      PadGrid (waveform preview), StepSequencer, Transport, VoiceEditor (knobs),
│                    MixerPanel (FFT meters), MixerStrip, Knob, EuclideanGenerator,
│                    SongEditor, PatternBrowser, KitBrowser, WaveformPreview
├── audio/           AudioEngine (12 TS voices + WASM bridge + FFT metering), SampleManager, MuLaw
├── store/           Zustand store — pattern, sequencer, 16 conditional trigs, song mode
├── hooks/           useKeyboard, useMidi, useMotionRecording, useUndoRedo
├── storage/         patternStorage (IndexedDB)
├── kits/            KitManager + 24 factory kits (11 categories)
├── utils/           midiExport (.mid), patternShare (URL encoding)
└── types/           TypeScript declarations

Plugin (plugin/)
├── CMakeLists.txt   JUCE 8 FetchContent (VST3/AU/Standalone)
└── src/             PluginProcessor (DrumCore + MIDI), PluginEditor
```

## Complete Feature List

### Sound Engine
- 12 VA drum voices with parametric knob control
- Sample drag & drop (WAV/MP3/OGG/FLAC)
- µ-Law vintage mode (8-bit companding)
- Per-voice insert FX: Filter (LP/HP/BP) + Distortion
- Waveform oscilloscope preview on pads

### Sequencer
- 64 steps (4 pages), per-track polymetric length
- Parameter Locks (hold step + turn knob)
- 16 Conditional Trig types (prob, fill, pre, nei, 1st, x:y cycle)
- Ratchet/Retrig (1-8x with velocity ramp)
- Swing (50-75%), Fill Mode (hold button)
- Motion Recording (REC: knob changes → P-Locks live)
- Euclidean Rhythm Generator (Bjorklund + presets)
- Song Mode (pattern chain with repeats)
- Undo/Redo (Ctrl+Z / Ctrl+Shift+Z)

### Effects & Mixer
- Send A: Algorithmic Reverb (ConvolverNode)
- Send B: Feedback Delay (LP-filtered, syncable)
- Master: 3-Band EQ → Bus Compressor → Brick-wall Limiter
- Fullscreen Ableton-style mixer with:
  - FFT-based RMS + Peak metering (IEC 60268 scale)
  - Logarithmic fader law (0.75 = unity)
  - Per-channel Insert FX controls (Filter + Drive)
  - Per-channel REV/DLY send knobs
  - Compressor gain reduction meter
  - Master EQ (Lo/Mid/Hi) controls

### Input & Output
- QWERTY keyboard (Q-V = pads, Space = play, 1-6 = presets)
- Web MIDI API (GM drum map, hot-plug, MIDI Learn)
- MIDI file export (.mid download)
- Pattern URL sharing (Base64 in hash)

### Sound Library
- 24 factory kits across 11 categories
- 14 genre preset patterns
- Kit Browser with category filter + search
- Pattern Browser (save/load/delete via IndexedDB)

### Platform
- C++ DSP → WASM (Emscripten 5.0.5, 21KB)
- WASM AudioWorklet processor
- JUCE plugin wrapper (VST3/AU/Standalone)
- PWA (manifest, favicon, service worker)
- Responsive layout (desktop/tablet/mobile)

## Build Commands

```bash
npm install              # Install dependencies
npm run dev              # Dev server (Vite)
npm run build            # Production build
npm run build:wasm       # Build C++ to WASM
npm test                 # Run tests

# WASM build (requires Emscripten)
source ~/emsdk/emsdk_env.sh
cd core/build-wasm && emcmake cmake .. && emmake make

# Plugin build (requires CMake + JUCE)
cmake -B plugin/build plugin
cmake --build plugin/build
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Q W E R / A S D F / Z X C V | Trigger pads (3 rows × 4) |
| Space | Play / Stop |
| 1-6 | Load preset pattern |
| ← → | Previous / Next preset |
| Ctrl+Z | Undo pattern edit |
| Ctrl+Shift+Z | Redo |
| Right-click step | Cycle velocity |
| Shift+right-click | Cycle ratchet |
| Alt+right-click | Cycle condition |
| Hold step + turn knob | Set P-Lock |

## Conventions

- **C++**: C++20, PascalCase classes, camelCase methods, -fno-exceptions
- **TypeScript**: strict mode, no `any`, named exports, React.memo for expensive components
- **CSS**: Tailwind utilities, CSS custom properties for theme
- **Git**: Conventional commits (feat:, fix:, refactor:, polish:)
- **Audio**: No allocations in audio thread, atomics for params, static DSP graph
