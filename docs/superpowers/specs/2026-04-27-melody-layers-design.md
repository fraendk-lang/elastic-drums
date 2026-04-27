# Melody Layers — Design Spec

**Date:** 2026-04-27  
**Replaces:** Melody Call & Response (C&R) — fully removed

---

## Summary

Replace the 2-voice Call & Response system with a **Melody Layers** engine: up to 4 simultaneous melody voices, each with its own independent bar length, sound preset, and piano roll. Layers loop independently (Polymeter) — a 4-bar layer over a 2-bar layer creates endless rhythmic variation without any manual programming.

---

## Design Decisions

| Decision | Choice |
|----------|--------|
| Layer concept | Option C — independent polymeter (each layer has its own bar length) |
| Layer editing | Option B — focus mode (mini overview strip + full piano roll for active layer) |
| Piano roll range | 3 octaves: C3–C6 (MIDI 48–84, 37 rows) |
| Max layers | 4 |
| Replaces C&R | Yes — C&R files are deleted |
| Bar lengths available | 1 / 2 / 4 / 8 bars |

---

## Architecture

### Files Created

| File | Responsibility |
|------|---------------|
| `src/store/melodyLayerStore.ts` | Zustand store — layers array, active layer, enabled flag |
| `src/audio/melodyLayerEngines.ts` | 4 MelodyEngine instances (one per layer slot) |
| `src/components/MelodyLayers/index.tsx` | Main editor UI — mini strip + focus piano roll |
| `src/components/MelodyLayers/melodyLayerScheduler.ts` | Drum-clock subscriber — per-layer step counters → note triggers |

### Files Modified

| File | Change |
|------|--------|
| `src/components/MelodySequencer.tsx` | Replace C&R toggle with Layers toggle |
| `src/store/sceneStore.ts` | Replace melodyCR scene fields with melodyLayers fields |
| `src/store/melodyStore.ts` | Remove `useMelodyCRStore` import |
| `src/App.tsx` | Replace C&R engine init with layer engines init (connect to channel) |

### Files Deleted

| File | Reason |
|------|--------|
| `src/store/melodyCRStore.ts` | Replaced by melodyLayerStore |
| `src/audio/melodyCREngines.ts` | Replaced by melodyLayerEngines |
| `src/components/MelodyCR/index.tsx` | Replaced by MelodyLayers/index.tsx |
| `src/components/MelodyCR/melodyCRScheduler.ts` | Replaced by melodyLayerScheduler |
| `src/components/MelodyCR/melodyCRUtils.ts` | Replaced by inline logic in scheduler |
| `src/components/MelodyCR/melodyCRUtils.test.ts` | Tests for deleted module |

---

## Data Model

```typescript
// src/store/melodyLayerStore.ts

export const LAYER_COLORS = ["#f472b6", "#22c55e", "#a78bfa", "#f97316"] as const;

export interface MelodyLayerNote {
  id: string;            // crypto.randomUUID()
  startBeat: number;     // beat position within this layer's own bar window (0 to barLength*4)
  durationBeats: number; // e.g. 0.25 = 16th note
  pitch: number;         // MIDI 48–84 (C3–C6 range)
}

export interface LayerSynth {
  presetIndex: number;   // index into MELODY_PRESETS
  octaveOffset: number;  // -2 to +2 (applied as semitones * 12 at trigger)
  cutoff: number;        // 0–1 (modulates preset's native cutoff proportionally, 0.5 = native)
}

export interface MelodyLayer {
  id: string;
  colorIndex: 0 | 1 | 2 | 3;
  barLength: 1 | 2 | 4 | 8;
  notes: MelodyLayerNote[];
  synth: LayerSynth;
  muted: boolean;
  soloed: boolean;
}

interface MelodyLayerState {
  enabled: boolean;
  layers: MelodyLayer[];         // 1–4 layers
  activeLayerId: string;         // id of the layer shown in focus view

  setEnabled: (v: boolean) => void;
  setActiveLayer: (id: string) => void;
  addLayer: () => void;          // max 4; adds with colorIndex = layers.length
  removeLayer: (id: string) => void;  // min 1 layer; if removing active, activates previous
  updateLayer: (id: string, patch: Partial<Pick<MelodyLayer, "barLength" | "muted" | "soloed">>) => void;
  addNote: (layerId: string, note: MelodyLayerNote) => void;
  removeNote: (layerId: string, noteId: string) => void;
  updateNote: (layerId: string, noteId: string, patch: Partial<MelodyLayerNote>) => void;
  setSynth: (layerId: string, patch: Partial<LayerSynth>) => void;
  setSynthFull: (layerId: string, synth: LayerSynth) => void;
}
```

**Initial state:** 1 layer, barLength=2, presetIndex=0, no notes, enabled=false.

---

## Engine Instances

```typescript
// src/audio/melodyLayerEngines.ts
import { melodyEngine, MelodyEngine } from "./MelodyEngine";

// Layer 0 reuses the existing singleton (already connected to channel 14)
// Layers 1–3 are new instances, connected in App.tsx on init
export const melodyLayerEngines: [MelodyEngine, MelodyEngine, MelodyEngine, MelodyEngine] = [
  melodyEngine,
  new MelodyEngine(),
  new MelodyEngine(),
  new MelodyEngine(),
];
```

In `App.tsx`, on audio init: connect engines 1–3 to the same channel as engine 0 (channel 14 / melody strip). This uses the same pattern as `responseCREngine` was connected.

---

## Scheduler

```typescript
// src/components/MelodyLayers/melodyLayerScheduler.ts
// Side-effect import from MelodyLayers/index.tsx

// Per-layer step counters (module-level, not React state)
const _stepCounters: number[] = [0, 0, 0, 0];
const _lastStep = { value: -1 };

// Playhead store — emits { layerIndex: number; beat: number } for active layer
export const melodyLayerBeatStore = { subscribe, getSnapshot };
```

**Tick logic per layer (index `i`):**
```
layer = layers[i]
if layer.muted → skip
if any layer is soloed and !layer.soloed → skip

stepsPerLoop = layer.barLength * 16   // 16th notes per bar = 16
localStep = _stepCounters[i] % stepsPerLoop
totalBeats = layer.barLength * 4

for each note in layer.notes:
  if round(note.startBeat * 4) % stepsPerLoop === localStep:
    midiNote = clamp(note.pitch + layer.synth.octaveOffset * 12, 0, 127)
    melodyLayerEngines[i].triggerPolyNote(midiNote, audioTime, durationSec)

_stepCounters[i]++
```

**applySynth** called at `localStep === 0` per layer using same proportional cutoff formula as C&R fix:
```typescript
const scale = cutoff <= 0.5 ? cutoff * 2 : 1 + (cutoff - 0.5) * 6;
const cutoffHz = clamp(presetCutoff * scale, 100, 18000);
engine.setParams({ ...preset.params, cutoff: cutoffHz });
```

**Reset:** step counters reset to 0 when `enabled` toggles or `layers` array changes length.

---

## Playhead Store

The scheduler exports a `melodyLayerBeatStore` (useSyncExternalStore compatible):
- `getSnapshot()` returns `{ activeLayerIndex: number; beat: number }`
- Updated on every tick for the **active layer only**
- UI subscribes to drive the playhead triangle in the piano roll ruler

---

## UI: MelodyLayers Editor

```
┌──────────────────────────────────────────────────────┐
│  [L1 ●] [L2 ●] [L3 ●] [+]      [BARS: 1 2 ●4 8]   │  ← mini strip
├──────────────────────────────────────────────────────┤
│  LAYER 2  FM Bell  4 BARS                [M] [S]     │  ← active layer header
├──────────────────────────────────────────────────────┤
│  [ruler: 1    2    3    4   ▲playhead]               │
│  C5 │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│   │
│  B4 │                                             │   │
│  ...│   (37 rows — C3 to C5)                     │   │  ← piano roll
│  C3 │                                             │   │
├──────────────────────────────────────────────────────┤
│  [Preset ▾ FM Bell] [Oct +0 ▾] ─────── CUTOFF ────  │  ← synth panel
└──────────────────────────────────────────────────────┘
```

### Mini Strip (top row)

- One colored pill per layer (`L1 ●`, `L2 ●`, etc.) — click to make active
- Active layer: bright border + label
- `[+]` button: add layer (disabled when 4 layers exist)
- Long-press or right-click a layer pill: show "Remove Layer" option (min 1 layer)
- Bar length selector: `1 2 4 8` buttons — updates `activeLayer.barLength`

### Piano Roll

- **Range:** C3 (MIDI 48) to C6 (MIDI 84) — 37 rows
- **Ruler:** beat numbers (1, 2, 3, 4... up to barLength×4), playhead triangle
- **Row height:** 6px (compact, like MelodyCR)
- **Grid:** vertical lines every beat; horizontal lines every semitone; darker lines at octave boundaries (C)
- **Draw mode** (default): left-click empty area → add 1/4-note note at cursor position; right-click note → delete
- **Resize:** drag right edge of a note to resize duration
- **Note colors:** use `layer.colorIndex` color with 60% opacity fill, full opacity border
- **Playhead:** vertical line at current beat, driven by `melodyLayerBeatStore`

### Piano Roll Implementation Notes

- Grid height: 180px (overflow-y-auto), same as MelodyCR
- `gridRef.current.scrollTop` must be added to `y` coordinate in hit testing (same bug fix as in MelodyCR)
- `notesRef = useRef(notes)` — keep ref in sync in render, read in event handlers (stale-closure prevention)
- `resizeDrag = useRef<ResizeDrag | null>(null)` — not useState (stale closure prevention)
- `releasePointerCapture` called in pointerUp and pointerLeave

### Synth Panel (bottom row)

- **Preset dropdown:** same `MELODY_PRESETS` list as current melody synth
- **Octave offset:** `-2 / -1 / 0 / +1 / +2` segment buttons
- **Cutoff slider:** 0–1 horizontal range input, labeled "CUTOFF"
- Changing any value calls `setSynth(activeLayerId, { ... })`

---

## Scene Integration

```typescript
// sceneStore.ts — Scene interface addition
melodyLayers?: {
  enabled: boolean;
  layers: MelodyLayer[];      // deep-cloned
  activeLayerId: string;
};
```

- `captureScene`: read `useMelodyLayerStore.getState()`, deep-clone `layers`
- `loadScene`: if `scene.melodyLayers === undefined` → skip (legacy scenes)
- Restore: `set({ enabled, layers: deepClone(layers), activeLayerId })`

---

## Migration from C&R

- `melodyStore.ts` currently imports `useMelodyCRStore` to disable the old step scheduler when C&R is enabled. This guard becomes: disable the old step-sequencer melody engine when `enabled === true` in `melodyLayerStore`.
- Scene files with `melodyCR` fields are silently ignored (undefined check).
- The C&R toggle button in `MelodySequencer.tsx` (purple, `ml-auto`) is replaced by a Layers toggle button (same position, same purple color `#a855f7`).

---

## Colors

- Layer 0: `#f472b6` (pink)
- Layer 1: `#22c55e` (green)
- Layer 2: `#a78bfa` (violet)
- Layer 3: `#f97316` (orange)

These match the brainstorm mockups and are distinct from drum-channel colors.

---

## Out of Scope

- MIDI export of individual layers (future)
- Note velocity per note (future — all notes at full velocity)
- Scale highlighting in piano roll (future)
- More than 4 layers
