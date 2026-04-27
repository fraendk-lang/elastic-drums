# Melody Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2-voice Melody Call & Response system with Melody Layers — up to 4 simultaneous polymeter melody voices, each with independent bar length, piano roll, and synth preset.

**Architecture:** A new Zustand store (`melodyLayerStore`) holds an array of up to 4 layers. A scheduler module subscribes to the drum clock and maintains per-layer step counters so each layer loops independently. The UI is a focus-mode piano roll editor adapted from MelodyCREditor: a mini layer-strip at top, large piano roll below, synth panel at bottom.

**Tech Stack:** React 18 (useSyncExternalStore, useRef, useCallback, useMemo, ResizeObserver), Zustand, Vitest, Web Audio API (MelodyEngine)

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `src/store/melodyLayerStore.ts` | Zustand store — layers, active layer, notes, synth |
| CREATE | `src/audio/melodyLayerEngines.ts` | 4 MelodyEngine instances (one per layer slot) |
| CREATE | `src/components/MelodyLayers/melodyLayerScheduler.ts` | Drum-clock subscriber — per-layer step counters + playhead store |
| CREATE | `src/components/MelodyLayers/index.tsx` | Focus-mode piano roll UI |
| MODIFY | `src/App.tsx` | Connect engines 1–3 to audio channel 14; remove C&R engine |
| MODIFY | `src/components/MelodySequencer.tsx` | Replace C&R toggle with Layers toggle |
| MODIFY | `src/store/melodyStore.ts` | Update guard to check melodyLayerStore instead of melodyCRStore |
| MODIFY | `src/store/sceneStore.ts` | Replace `melodyCR` scene fields with `melodyLayers` fields |
| DELETE | `src/store/melodyCRStore.ts` | Replaced by melodyLayerStore |
| DELETE | `src/audio/melodyCREngines.ts` | Replaced by melodyLayerEngines |
| DELETE | `src/components/MelodyCR/index.tsx` | Replaced by MelodyLayers/index.tsx |
| DELETE | `src/components/MelodyCR/melodyCRScheduler.ts` | Replaced by melodyLayerScheduler |
| DELETE | `src/components/MelodyCR/melodyCRUtils.ts` | Helpers now inline in scheduler |
| DELETE | `src/components/MelodyCR/melodyCRUtils.test.ts` | Tests for deleted module |

---

## Background: Existing patterns to follow

**Audio init pattern (`src/App.tsx` lines 218–221):**
```typescript
responseCREngine.init(ctx);
const responseCROut = responseCREngine.getOutput();
if (responseCROut && melodyCh) responseCROut.connect(melodyCh);
```
Engines 1–3 in melodyLayerEngines follow this exact pattern — `init(ctx)`, `getOutput()`, `connect(melodyCh)`.

**Scheduler pattern (`src/components/MelodyCR/melodyCRScheduler.ts`):**
Module-level `_lastStep` + subscription to `drumCurrentStepStore`. The new scheduler is identical in structure but tracks an array of per-layer step counters.

**Piano roll pattern (`src/components/MelodyCR/index.tsx`):**
- `gridRef.current.scrollTop` added to `y` in hit testing (scroll offset bug fix)
- `notesRef = useRef(notes)` + `notesRef.current = notes` in render (stale closure prevention)
- `resizeDragRef = useRef<ResizeDrag | null>(null)` not useState
- `releasePointerCapture` in pointerUp AND pointerLeave

---

## Task 1: Zustand store (`melodyLayerStore.ts`)

**Files:**
- Create: `src/store/melodyLayerStore.ts`
- Create: `src/store/melodyLayerStore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/store/melodyLayerStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useMelodyLayerStore } from "./melodyLayerStore";

function resetStore() {
  useMelodyLayerStore.setState({
    enabled: false,
    layers: [
      { id: "l0", colorIndex: 0, barLength: 2, notes: [], synth: { presetIndex: 0, octaveOffset: 0, cutoff: 0.5 }, muted: false, soloed: false }
    ],
    activeLayerId: "l0",
  });
}

describe("melodyLayerStore — addLayer", () => {
  beforeEach(resetStore);
  it("adds a second layer with colorIndex 1", () => {
    useMelodyLayerStore.getState().addLayer();
    const { layers } = useMelodyLayerStore.getState();
    expect(layers).toHaveLength(2);
    expect(layers[1]!.colorIndex).toBe(1);
  });
  it("does not add beyond 4 layers", () => {
    for (let i = 0; i < 5; i++) useMelodyLayerStore.getState().addLayer();
    expect(useMelodyLayerStore.getState().layers).toHaveLength(4);
  });
});

describe("melodyLayerStore — removeLayer", () => {
  beforeEach(resetStore);
  it("cannot remove the last layer", () => {
    useMelodyLayerStore.getState().removeLayer("l0");
    expect(useMelodyLayerStore.getState().layers).toHaveLength(1);
  });
  it("removes layer and activates remaining layer", () => {
    useMelodyLayerStore.getState().addLayer();
    const l1id = useMelodyLayerStore.getState().layers[1]!.id;
    useMelodyLayerStore.getState().removeLayer(l1id);
    expect(useMelodyLayerStore.getState().layers).toHaveLength(1);
    expect(useMelodyLayerStore.getState().activeLayerId).toBe("l0");
  });
});

describe("melodyLayerStore — note operations", () => {
  const note = { id: "n1", startBeat: 0, durationBeats: 0.5, pitch: 60 };
  beforeEach(resetStore);
  it("addNote adds note to the correct layer", () => {
    useMelodyLayerStore.getState().addNote("l0", note);
    expect(useMelodyLayerStore.getState().layers[0]!.notes).toHaveLength(1);
    expect(useMelodyLayerStore.getState().layers[0]!.notes[0]!.id).toBe("n1");
  });
  it("removeNote removes note by id", () => {
    useMelodyLayerStore.getState().addNote("l0", note);
    useMelodyLayerStore.getState().removeNote("l0", "n1");
    expect(useMelodyLayerStore.getState().layers[0]!.notes).toHaveLength(0);
  });
  it("updateNote patches note fields", () => {
    useMelodyLayerStore.getState().addNote("l0", note);
    useMelodyLayerStore.getState().updateNote("l0", "n1", { durationBeats: 1 });
    expect(useMelodyLayerStore.getState().layers[0]!.notes[0]!.durationBeats).toBe(1);
  });
});

describe("melodyLayerStore — setSynth", () => {
  beforeEach(resetStore);
  it("patches synth fields", () => {
    useMelodyLayerStore.getState().setSynth("l0", { cutoff: 0.8 });
    expect(useMelodyLayerStore.getState().layers[0]!.synth.cutoff).toBe(0.8);
    expect(useMelodyLayerStore.getState().layers[0]!.synth.presetIndex).toBe(0); // unchanged
  });
  it("setSynthFull replaces entire synth object", () => {
    useMelodyLayerStore.getState().setSynthFull("l0", { presetIndex: 3, octaveOffset: 1, cutoff: 0.3 });
    expect(useMelodyLayerStore.getState().layers[0]!.synth).toEqual({ presetIndex: 3, octaveOffset: 1, cutoff: 0.3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx vitest run src/store/melodyLayerStore.test.ts
```
Expected: FAIL — "Cannot find module './melodyLayerStore'"

- [ ] **Step 3: Create the store**

```typescript
// src/store/melodyLayerStore.ts
import { create } from "zustand";

export const LAYER_COLORS = ["#f472b6", "#22c55e", "#a78bfa", "#f97316"] as const;

export interface MelodyLayerNote {
  id: string;
  startBeat: number;     // beat within this layer's own bar window (0 to barLength*4)
  durationBeats: number;
  pitch: number;         // MIDI 48–84 (C3–C6)
}

export interface LayerSynth {
  presetIndex: number;   // index into MELODY_PRESETS
  octaveOffset: number;  // -2 to +2
  cutoff: number;        // 0–1 (modulates preset's native cutoff proportionally)
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

const DEFAULT_SYNTH: LayerSynth = { presetIndex: 0, octaveOffset: 0, cutoff: 0.5 };

function makeLayer(colorIndex: 0 | 1 | 2 | 3): MelodyLayer {
  return {
    id: crypto.randomUUID(),
    colorIndex,
    barLength: 2,
    notes: [],
    synth: { ...DEFAULT_SYNTH },
    muted: false,
    soloed: false,
  };
}

interface MelodyLayerState {
  enabled: boolean;
  layers: MelodyLayer[];
  activeLayerId: string;

  setEnabled: (v: boolean) => void;
  setActiveLayer: (id: string) => void;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Pick<MelodyLayer, "barLength" | "muted" | "soloed">>) => void;
  addNote: (layerId: string, note: MelodyLayerNote) => void;
  removeNote: (layerId: string, noteId: string) => void;
  updateNote: (layerId: string, noteId: string, patch: Partial<MelodyLayerNote>) => void;
  setSynth: (layerId: string, patch: Partial<LayerSynth>) => void;
  setSynthFull: (layerId: string, synth: LayerSynth) => void;
}

const initialLayer = makeLayer(0);

export const useMelodyLayerStore = create<MelodyLayerState>((set, get) => ({
  enabled: false,
  layers: [{ ...initialLayer }],
  activeLayerId: initialLayer.id,

  setEnabled: (v) => set({ enabled: v }),
  setActiveLayer: (id) => set({ activeLayerId: id }),

  addLayer: () => set((s) => {
    if (s.layers.length >= 4) return s;
    const colorIndex = s.layers.length as 0 | 1 | 2 | 3;
    return { layers: [...s.layers, makeLayer(colorIndex)] };
  }),

  removeLayer: (id) => set((s) => {
    if (s.layers.length <= 1) return s;
    const newLayers = s.layers.filter((l) => l.id !== id);
    const newActiveId = s.activeLayerId === id
      ? (newLayers[newLayers.length - 1]!.id)
      : s.activeLayerId;
    return { layers: newLayers, activeLayerId: newActiveId };
  }),

  updateLayer: (id, patch) => set((s) => ({
    layers: s.layers.map((l) => l.id === id ? { ...l, ...patch } : l),
  })),

  addNote: (layerId, note) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId
      ? { ...l, notes: [...l.notes, note] }
      : l
    ),
  })),

  removeNote: (layerId, noteId) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId
      ? { ...l, notes: l.notes.filter((n) => n.id !== noteId) }
      : l
    ),
  })),

  updateNote: (layerId, noteId, patch) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId
      ? { ...l, notes: l.notes.map((n) => n.id === noteId ? { ...n, ...patch } : n) }
      : l
    ),
  })),

  setSynth: (layerId, patch) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId
      ? { ...l, synth: { ...l.synth, ...patch } }
      : l
    ),
  })),

  setSynthFull: (layerId, synth) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId ? { ...l, synth: { ...synth } } : l),
  })),
}));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/store/melodyLayerStore.test.ts
```
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/store/melodyLayerStore.ts src/store/melodyLayerStore.test.ts
git commit -m "feat: add melodyLayerStore — Zustand store for polymeter melody layers"
```

---

## Task 2: Engine instances (`melodyLayerEngines.ts`)

**Files:**
- Create: `src/audio/melodyLayerEngines.ts`

No unit tests — this file is a thin factory wrapper.

- [ ] **Step 1: Create the engines file**

```typescript
// src/audio/melodyLayerEngines.ts
/**
 * Melody Layers engine instances.
 *
 * 4 MelodyEngine instances — one per layer slot (index matches layer order).
 * Engine 0 reuses the existing melodyEngine singleton (already on Channel 14).
 * Engines 1–3 are initialized and connected to Channel 14 in App.tsx.
 */
import { melodyEngine, MelodyEngine } from "./MelodyEngine";

export const melodyLayerEngines: [MelodyEngine, MelodyEngine, MelodyEngine, MelodyEngine] = [
  melodyEngine,
  new MelodyEngine(),
  new MelodyEngine(),
  new MelodyEngine(),
];
```

- [ ] **Step 2: Commit**

```bash
git add src/audio/melodyLayerEngines.ts
git commit -m "feat: add melodyLayerEngines — 4 MelodyEngine instances for polymeter layers"
```

---

## Task 3: Scheduler (`melodyLayerScheduler.ts`)

**Files:**
- Create: `src/components/MelodyLayers/melodyLayerScheduler.ts`

The scheduler is a side-effect module (imported once from index.tsx) that:
1. Subscribes to `drumCurrentStepStore` (fires every 16th note)
2. Maintains per-layer step counters
3. Triggers notes on each layer's engine
4. Exposes `melodyLayerBeatStore` (useSyncExternalStore-compatible) for the playhead

- [ ] **Step 1: Create the scheduler**

```typescript
// src/components/MelodyLayers/melodyLayerScheduler.ts
//
// Subscribes to drumCurrentStepStore, plays notes via melodyLayerEngines.
// Import once (side-effect import) from MelodyLayers/index.tsx to activate.

import { drumCurrentStepStore, getDrumCurrentStepAudioTime, useDrumStore } from "../../store/drumStore";
import { useMelodyLayerStore } from "../../store/melodyLayerStore";
import { melodyLayerEngines } from "../../audio/melodyLayerEngines";
import { MELODY_PRESETS } from "../../store/melodyStore";

// ─── Per-layer step counters ───────────────────────────────────────────────────
// One counter per layer slot (index 0–3), incremented on every drum tick.
const _stepCounters: [number, number, number, number] = [0, 0, 0, 0];
let _lastDrumStep = -1;

// ─── Playhead store ────────────────────────────────────────────────────────────
// Emits beat position for the active layer so the piano roll playhead can follow.

const _beatListeners = new Set<() => void>();
let _beatSnapshot = { beat: 0 };

export const melodyLayerBeatStore = {
  subscribe(listener: () => void): () => void {
    _beatListeners.add(listener);
    return () => _beatListeners.delete(listener);
  },
  getSnapshot(): { beat: number } {
    return _beatSnapshot;
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Apply synth settings to a MelodyEngine.
 * Modulates the preset's native cutoff proportionally — 0.5 = preset native,
 * 0 = darker, 1 = brighter (same formula as melodyCRScheduler fix).
 */
function applyLayerSynth(
  engine: typeof melodyLayerEngines[0],
  presetIndex: number,
  cutoff: number
): void {
  const preset = MELODY_PRESETS[presetIndex];
  if (!preset) return;
  const presetCutoff = (preset.params as { cutoff?: number }).cutoff ?? 2000;
  const scale = cutoff <= 0.5 ? cutoff * 2 : 1 + (cutoff - 0.5) * 6;
  const cutoffHz = Math.max(100, Math.min(18000, presetCutoff * scale));
  engine.setParams({ ...preset.params, cutoff: cutoffHz });
}

/**
 * Return notes that fire at the given step counter for a layer.
 * stepsPerLoop = barLength * 16 (16 sixteenth-notes per bar).
 */
export function layerNotesOnStep(
  notes: { startBeat: number; durationBeats: number; pitch: number; id: string }[],
  stepCounter: number,
  barLength: 1 | 2 | 4 | 8
): typeof notes {
  const stepsPerLoop = barLength * 16;
  const localStep = stepCounter % stepsPerLoop;
  const totalBeats = barLength * 4;
  return notes.filter((n) => {
    if (n.startBeat < 0 || n.startBeat >= totalBeats) return false;
    return Math.round(n.startBeat * 4) % stepsPerLoop === localStep;
  });
}

/**
 * Current beat position (0-based) within the active layer's bar window.
 */
export function layerLocalBeat(stepCounter: number, barLength: 1 | 2 | 4 | 8): number {
  const stepsPerLoop = barLength * 16;
  const localStep = stepCounter % stepsPerLoop;
  return localStep / 4;  // 16th-note steps → beats
}

// ─── Tick ──────────────────────────────────────────────────────────────────────

function tick(currentDrumStep: number, bpm: number): void {
  const state = useMelodyLayerStore.getState();
  if (!state.enabled) return;
  if (currentDrumStep === _lastDrumStep) return;

  const advanced = _lastDrumStep >= 0;
  _lastDrumStep = currentDrumStep;

  const { layers, activeLayerId } = state;
  const anySoloed = layers.some((l) => l.soloed);
  const t = getDrumCurrentStepAudioTime();
  const secPerBeat = 60 / bpm;

  // Update per-layer counters and trigger notes
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (advanced) _stepCounters[i]++;

    const shouldPlay = !layer.muted && !(anySoloed && !layer.soloed);
    const localStep = _stepCounters[i] % (layer.barLength * 16);
    const engine = melodyLayerEngines[i];
    if (!engine) continue;

    // Apply synth at start of each loop
    if (localStep === 0) {
      applyLayerSynth(engine, layer.synth.presetIndex, layer.synth.cutoff);
    }

    if (shouldPlay && layer.notes.length > 0) {
      const hits = layerNotesOnStep(layer.notes, _stepCounters[i], layer.barLength);
      for (const note of hits) {
        const midiNote = Math.max(0, Math.min(127, note.pitch + layer.synth.octaveOffset * 12));
        const durationSec = Math.max(0.05, note.durationBeats * secPerBeat);
        engine.triggerPolyNote(midiNote, t, durationSec);
      }
    }
  }

  // Update playhead for active layer
  const activeIdx = layers.findIndex((l) => l.id === activeLayerId);
  if (activeIdx >= 0) {
    const activeLayer = layers[activeIdx]!;
    const beat = layerLocalBeat(_stepCounters[activeIdx], activeLayer.barLength);
    const nextSnapshot = { beat };
    if (nextSnapshot.beat !== _beatSnapshot.beat) {
      _beatSnapshot = nextSnapshot;
      for (const fn of _beatListeners) fn();
    }
  }
}

// ─── Subscribe to drum step clock ─────────────────────────────────────────────

const _unsubDrum = drumCurrentStepStore.subscribe(() => {
  const currentStep = drumCurrentStepStore.getSnapshot();
  const { isPlaying, bpm } = useDrumStore.getState();
  if (isPlaying) {
    tick(currentStep, bpm);
  } else {
    _lastDrumStep = -1;
    _stepCounters.fill(0);
    _beatSnapshot = { beat: 0 };
    for (const fn of _beatListeners) fn();
  }
});

// Reset step counters when enabled toggles or layers array changes
let _prevEnabled = useMelodyLayerStore.getState().enabled;
let _prevLayerCount = useMelodyLayerStore.getState().layers.length;

const _unsubStore = useMelodyLayerStore.subscribe((state) => {
  if (state.enabled !== _prevEnabled) {
    _prevEnabled = state.enabled;
    _stepCounters.fill(0);
    _lastDrumStep = -1;
  }
  if (state.layers.length !== _prevLayerCount) {
    _prevLayerCount = state.layers.length;
    // Reset counters for slots that changed
    for (let i = state.layers.length; i < 4; i++) _stepCounters[i] = 0;
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _unsubDrum();
    _unsubStore();
  });
}
```

- [ ] **Step 2: Write tests for the pure helpers**

```typescript
// src/components/MelodyLayers/melodyLayerScheduler.test.ts
import { describe, it, expect } from "vitest";
import { layerNotesOnStep, layerLocalBeat } from "./melodyLayerScheduler";

describe("layerNotesOnStep", () => {
  const notes = [
    { id: "a", startBeat: 0,    durationBeats: 1,   pitch: 60 },
    { id: "b", startBeat: 1,    durationBeats: 0.5, pitch: 62 },
    { id: "c", startBeat: 0.25, durationBeats: 0.25, pitch: 64 },
  ];

  it("stepCounter=0 barLength=2 → note at beat 0", () => {
    const found = layerNotesOnStep(notes, 0, 2);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("a");
  });

  it("stepCounter=1 barLength=2 → note at beat 0.25", () => {
    const found = layerNotesOnStep(notes, 1, 2);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("c");
  });

  it("stepCounter=4 barLength=2 → note at beat 1", () => {
    const found = layerNotesOnStep(notes, 4, 2);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("b");
  });

  it("wraps: stepCounter=32 barLength=2 → same as step 0", () => {
    const found = layerNotesOnStep(notes, 32, 2);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("a");
  });

  it("barLength=1: stepsPerLoop=16, step 16 wraps to step 0", () => {
    const note = [{ id: "x", startBeat: 0, durationBeats: 1, pitch: 60 }];
    expect(layerNotesOnStep(note, 0,  1)).toHaveLength(1);
    expect(layerNotesOnStep(note, 16, 1)).toHaveLength(1);  // wraps
    expect(layerNotesOnStep(note, 1,  1)).toHaveLength(0);
  });

  it("ignores notes with startBeat >= totalBeats", () => {
    const out = [{ id: "z", startBeat: 10, durationBeats: 1, pitch: 60 }];
    expect(layerNotesOnStep(out, 8, 2)).toHaveLength(0); // totalBeats=8, beat 10 out of range
  });
});

describe("layerLocalBeat", () => {
  it("step 0 barLength=2 → beat 0", () => {
    expect(layerLocalBeat(0, 2)).toBe(0);
  });
  it("step 4 barLength=2 → beat 1", () => {
    expect(layerLocalBeat(4, 2)).toBe(1);
  });
  it("step 32 barLength=2 → beat 0 (wraps at 32 steps)", () => {
    expect(layerLocalBeat(32, 2)).toBe(0);
  });
  it("step 0 barLength=8 → beat 0", () => {
    expect(layerLocalBeat(0, 8)).toBe(0);
  });
  it("step 128 barLength=8 → beat 0 (wraps at 128 steps)", () => {
    expect(layerLocalBeat(128, 8)).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/components/MelodyLayers/melodyLayerScheduler.test.ts
```
Expected: PASS — both describe blocks green

- [ ] **Step 4: Commit**

```bash
git add src/components/MelodyLayers/melodyLayerScheduler.ts src/components/MelodyLayers/melodyLayerScheduler.test.ts
git commit -m "feat: add melodyLayerScheduler — polymeter drum-clock subscriber + pure helpers"
```

---

## Task 4: Editor UI (`MelodyLayers/index.tsx`)

**Files:**
- Create: `src/components/MelodyLayers/index.tsx`

Adapted from `src/components/MelodyCR/index.tsx`. The same piano roll mechanics (scrollTop fix, refs, resize) are preserved exactly.

- [ ] **Step 1: Create the component**

```tsx
// src/components/MelodyLayers/index.tsx
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMelodyLayerStore, type MelodyLayerNote, LAYER_COLORS } from "../../store/melodyLayerStore";
import { useDrumStore } from "../../store/drumStore";
import { MELODY_PRESETS } from "../../store/melodyStore";
import { melodyLayerEngines } from "../../audio/melodyLayerEngines";
import { melodyLayerBeatStore } from "./melodyLayerScheduler";

// Activate scheduler via side-effect import
import "./melodyLayerScheduler";

// ─── Constants ────────────────────────────────────────────────────────────────

const MIDI_MIN = 48;  // C3
const MIDI_MAX = 84;  // C6
const ROWS = MIDI_MAX - MIDI_MIN + 1;  // 37
const ROW_H = 14;
const PIANO_W = 40;
const RULER_H = 20;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

function isBlackKey(pitch: number): boolean {
  return BLACK_KEYS.has(((pitch % 12) + 12) % 12);
}

function pitchName(pitch: number): string {
  return NOTE_NAMES[((pitch % 12) + 12) % 12]!;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DisplayNote = MelodyLayerNote & { _ghost?: boolean };

type ResizeDrag = {
  layerId: string;
  noteId: string;
  startX: number;
  origDur: number;
  beatWidth: number;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function MelodyLayersEditor() {
  const {
    layers, activeLayerId, enabled,
    setActiveLayer, addLayer, removeLayer,
    updateLayer, addNote, removeNote, updateNote,
    setSynth,
  } = useMelodyLayerStore();

  const isPlaying = useDrumStore((s) => s.isPlaying);
  const beatInfo = useSyncExternalStore(
    melodyLayerBeatStore.subscribe,
    melodyLayerBeatStore.getSnapshot,
    () => ({ beat: 0 }),
  );

  // Active layer — fall back to layers[0] if id is stale
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0]!;
  const activeLayerIdx = layers.findIndex((l) => l.id === activeLayer.id);
  const layerColor = LAYER_COLORS[activeLayer.colorIndex];
  const notes = activeLayer.notes;
  const totalBeats = activeLayer.barLength * 4;

  const gridRef = useRef<HTMLDivElement>(null);
  const [hoverCell, setHoverCell] = useState<{ pitch: number; beat: number } | null>(null);
  const [gridCursor, setGridCursor] = useState("crosshair");
  const resizeDragRef = useRef<ResizeDrag | null>(null);

  // ─── Beat width ─────────────────────────────────────────────────────────────

  const [beatWidth, setBeatWidth] = useState(40);
  useEffect(() => {
    if (!gridRef.current) return;
    const update = () => {
      const w = gridRef.current!.clientWidth - PIANO_W;
      setBeatWidth(w / totalBeats);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(gridRef.current);
    return () => ro.disconnect();
  }, [totalBeats]);

  // ─── Stable refs (stale-closure prevention) ──────────────────────────────────

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const beatWidthRef = useRef(beatWidth);
  beatWidthRef.current = beatWidth;
  const activeLayerIdRef = useRef(activeLayer.id);
  activeLayerIdRef.current = activeLayer.id;

  // ─── Hit testing ─────────────────────────────────────────────────────────────

  const hitTestNote = useCallback((clientX: number, clientY: number) => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const x = clientX - rect.left - PIANO_W;
    // scrollTop: ruler is sticky so viewport offset doesn't shift, but note positions
    // are relative to scrollable content — must add scrollTop for correct hit testing.
    const y = clientY - rect.top - RULER_H + gridRef.current.scrollTop;
    if (x < 0 || y < 0) return null;
    const rowIdx = Math.floor(y / ROW_H);
    if (rowIdx < 0 || rowIdx >= ROWS) return null;
    const pitch = MIDI_MAX - rowIdx;
    const bw = beatWidthRef.current;
    const beat = x / bw;
    for (const note of notesRef.current) {
      if (note.pitch !== pitch) continue;
      const noteStartX = note.startBeat * bw;
      const noteEndX = (note.startBeat + note.durationBeats) * bw;
      if (x >= noteStartX && x <= noteEndX) {
        return { note, isRightEdge: x >= noteEndX - 6, pitch, beat };
      }
    }
    return { note: null, isRightEdge: false, pitch, beat };
  }, []);

  // ─── Pointer handlers ────────────────────────────────────────────────────────

  const handleGridPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const hit = hitTestNote(e.clientX, e.clientY);
    if (!hit) return;

    if (hit.note && hit.isRightEdge) {
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeDragRef.current = {
        layerId: activeLayerIdRef.current,
        noteId: hit.note.id,
        startX: e.clientX,
        origDur: hit.note.durationBeats,
        beatWidth: beatWidthRef.current,
      };
      return;
    }

    if (!hit.note && e.button === 0) {
      const snappedBeat = Math.round(hit.beat * 4) / 4;
      if (snappedBeat < 0 || snappedBeat >= totalBeats) return;
      const newNote: MelodyLayerNote = {
        id: crypto.randomUUID(),
        pitch: hit.pitch,
        startBeat: snappedBeat,
        durationBeats: 0.5,
      };
      addNote(activeLayerIdRef.current, newNote);
    }
  }, [totalBeats, hitTestNote, addNote]);

  const handleGridPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (drag) {
      const deltaPx = e.clientX - drag.startX;
      const deltaBeat = deltaPx / drag.beatWidth;
      const newDur = Math.max(0.25, Math.round((drag.origDur + deltaBeat) * 4) / 4);
      updateNote(drag.layerId, drag.noteId, { durationBeats: newDur });
      return;
    }

    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - PIANO_W;
    const y = e.clientY - rect.top - RULER_H + gridRef.current.scrollTop;
    if (x < 0 || y < 0) { setHoverCell(null); setGridCursor("crosshair"); return; }
    const rowIdx = Math.floor(y / ROW_H);
    if (rowIdx < 0 || rowIdx >= ROWS) { setHoverCell(null); setGridCursor("crosshair"); return; }
    const pitch = MIDI_MAX - rowIdx;
    const bw = beatWidthRef.current;
    const beat = Math.round((x / bw) * 4) / 4;
    const onRightEdge = notesRef.current.some((n) => {
      if (n.pitch !== pitch) return false;
      const endX = (n.startBeat + n.durationBeats) * bw;
      return x >= n.startBeat * bw && x >= endX - 6 && x <= endX;
    });
    setGridCursor(onRightEdge ? "ew-resize" : "crosshair");
    const hasNote = notesRef.current.some(
      (n) => n.pitch === pitch && beat >= n.startBeat && beat < n.startBeat + n.durationBeats
    );
    setHoverCell(hasNote ? null : { pitch, beat });
  }, [updateNote]);

  const handleGridPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeDragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      resizeDragRef.current = null;
    }
  }, []);

  const handleGridContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const hit = hitTestNote(e.clientX, e.clientY);
    if (hit?.note) removeNote(activeLayerIdRef.current, hit.note.id);
  }, [hitTestNote, removeNote]);

  // ─── Ghost note ──────────────────────────────────────────────────────────────

  const ghostNote = useMemo(() => {
    if (!hoverCell) return null;
    const { pitch, beat } = hoverCell;
    if (beat < 0 || beat >= totalBeats) return null;
    return { pitch, startBeat: beat, durationBeats: 0.5, id: "ghost" };
  }, [hoverCell, totalBeats]);

  const allDisplayNotes = useMemo<DisplayNote[]>(
    () => ghostNote ? [...notes, { ...ghostNote, _ghost: true }] : notes,
    [notes, ghostNote]
  );

  // ─── Playhead ────────────────────────────────────────────────────────────────

  const playheadX = isPlaying ? PIANO_W + beatInfo.beat * beatWidth : null;

  // ─── Synth preset helper ─────────────────────────────────────────────────────

  function applyPreset(index: number) {
    setSynth(activeLayer.id, { presetIndex: index });
    const engine = melodyLayerEngines[activeLayerIdx];
    const preset = MELODY_PRESETS[index];
    if (engine && preset) engine.setParams(preset.params);
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  const gridHeight = ROWS * ROW_H;

  return (
    <div className="flex flex-col select-none" style={{ fontFamily: "monospace" }}>

      {/* ── Mini layer strip ── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/5">
        {layers.map((layer, idx) => {
          const color = LAYER_COLORS[layer.colorIndex];
          const isActive = layer.id === activeLayer.id;
          return (
            <button
              key={layer.id}
              onClick={() => setActiveLayer(layer.id)}
              onContextMenu={(e) => { e.preventDefault(); removeLayer(layer.id); }}
              className="px-2 py-1 text-[7px] font-black tracking-[0.12em] rounded border transition-all"
              style={{
                background: isActive ? `${color}20` : "transparent",
                borderColor: isActive ? `${color}60` : "#2a2d38",
                color: isActive ? color : "#555",
              }}
              title="Right-click to remove"
            >
              L{idx + 1}
              {layer.muted ? " M" : ""}
            </button>
          );
        })}

        {layers.length < 4 && (
          <button
            onClick={() => addLayer()}
            className="px-2 py-1 text-[7px] font-black rounded border border-dashed border-white/15 text-white/25 hover:text-white/50 hover:border-white/30 transition-all"
          >
            +
          </button>
        )}

        {/* Bar length for active layer */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[7px] text-white/25 tracking-[0.1em]">BARS</span>
          {([1, 2, 4, 8] as const).map((b) => (
            <button
              key={b}
              onClick={() => updateLayer(activeLayer.id, { barLength: b })}
              className="w-5 h-5 text-[7px] font-black rounded transition-all"
              style={{
                background: activeLayer.barLength === b ? `${layerColor}20` : "transparent",
                border: `1px solid ${activeLayer.barLength === b ? `${layerColor}60` : "#2a2d38"}`,
                color: activeLayer.barLength === b ? layerColor : "#555",
              }}
            >
              {b}
            </button>
          ))}
        </div>

        {/* Mute / Solo */}
        <button
          onClick={() => updateLayer(activeLayer.id, { muted: !activeLayer.muted })}
          className="w-6 h-5 text-[6px] font-black rounded border transition-all ml-1"
          style={{
            background: activeLayer.muted ? "#f9731620" : "transparent",
            borderColor: activeLayer.muted ? "#f9731660" : "#2a2d38",
            color: activeLayer.muted ? "#f97316" : "#555",
          }}
        >
          M
        </button>
        <button
          onClick={() => updateLayer(activeLayer.id, { soloed: !activeLayer.soloed })}
          className="w-6 h-5 text-[6px] font-black rounded border transition-all"
          style={{
            background: activeLayer.soloed ? `${layerColor}20` : "transparent",
            borderColor: activeLayer.soloed ? `${layerColor}60` : "#2a2d38",
            color: activeLayer.soloed ? layerColor : "#555",
          }}
        >
          S
        </button>

        {/* Clear active layer */}
        <button
          onClick={() => { for (const n of [...notes]) removeNote(activeLayer.id, n.id); }}
          className="ml-1 text-[7px] font-bold tracking-[0.1em] text-white/20 hover:text-white/50 px-1.5 py-0.5 rounded border border-white/8"
        >
          CLR
        </button>
      </div>

      {/* ── Piano Roll Grid ── */}
      <div
        ref={gridRef}
        className="relative overflow-y-auto overflow-x-hidden"
        style={{ height: Math.min(gridHeight + RULER_H, 180), background: "#0d0f14", cursor: gridCursor }}
        onPointerDown={handleGridPointerDown}
        onPointerMove={handleGridPointerMove}
        onPointerUp={handleGridPointerUp}
        onPointerLeave={(e) => {
          setHoverCell(null);
          if (resizeDragRef.current) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            resizeDragRef.current = null;
          }
        }}
        onContextMenu={handleGridContextMenu}
      >
        {/* Ruler */}
        <div
          className="sticky top-0 z-10 flex"
          style={{ height: RULER_H, background: "#0d0f14", borderBottom: "1px solid #1f2230", paddingLeft: PIANO_W }}
        >
          {Array.from({ length: totalBeats }, (_, beat) => (
            <div
              key={beat}
              style={{ flex: 1, borderLeft: "1px solid #1f2230", paddingLeft: 3 }}
            >
              {beat % 4 === 0 && (
                <span style={{ fontSize: 7, color: "#444" }}>{Math.floor(beat / 4) + 1}</span>
              )}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div style={{ position: "relative" }}>
          {Array.from({ length: ROWS }, (_, rowIdx) => {
            const pitch = MIDI_MAX - rowIdx;
            const isBlack = isBlackKey(pitch);
            const name = pitchName(pitch);
            const isC = name === "C";

            return (
              <div
                key={pitch}
                style={{
                  display: "flex",
                  height: ROW_H,
                  background: isBlack ? "rgba(0,0,0,0.25)" : "transparent",
                  borderBottom: isC ? "1px solid #222" : "1px solid #181a22",
                }}
              >
                {/* Piano key label */}
                <div
                  style={{
                    width: PIANO_W,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: 5,
                    fontSize: 6,
                    color: isBlack ? "#333" : "#444",
                    background: isBlack ? "#151820" : "#1a1d26",
                    borderRight: "1px solid #222",
                    cursor: "default",
                  }}
                >
                  {isC ? name + (Math.floor(pitch / 12) - 1) : ""}
                </div>

                {/* Beat cells — grid lines only */}
                {Array.from({ length: totalBeats }, (_, beat) => (
                  <div
                    key={beat}
                    style={{
                      flex: 1,
                      borderLeft: beat % 4 === 0 ? "1px solid #1f2230" : "1px solid #181a22",
                    }}
                  />
                ))}
              </div>
            );
          })}

          {/* Notes */}
          {allDisplayNotes.map((note) => {
            const isGhost = note._ghost === true;
            const rowIdx = MIDI_MAX - note.pitch;
            if (rowIdx < 0 || rowIdx >= ROWS) return null;
            return (
              <div
                key={note.id}
                style={{
                  position: "absolute",
                  top: rowIdx * ROW_H + 2,
                  left: PIANO_W + note.startBeat * beatWidth,
                  width: Math.max(4, note.durationBeats * beatWidth - 2),
                  height: ROW_H - 3,
                  background: isGhost ? `${layerColor}30` : `${layerColor}70`,
                  border: `1px solid ${isGhost ? layerColor + "40" : layerColor}`,
                  borderRadius: 3,
                  pointerEvents: "none",
                  boxSizing: "border-box",
                }}
              />
            );
          })}

          {/* Playhead */}
          {playheadX !== null && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: playheadX,
                width: 1,
                height: gridHeight,
                background: "rgba(255,255,255,0.5)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </div>

      {/* ── Synth panel ── */}
      <div
        className="px-3 py-2 border-t border-white/5 flex flex-wrap items-center gap-x-4 gap-y-1.5"
        style={{ background: "#0d0f14" }}
      >
        {/* Preset */}
        <div className="flex items-center gap-1.5">
          <span className="text-[7px] text-white/30 tracking-[0.1em]">PRESET</span>
          <select
            value={activeLayer.synth.presetIndex}
            onChange={(e) => applyPreset(Number(e.target.value))}
            className="text-[8px] bg-black/40 border border-white/8 rounded px-1 py-0.5 text-white/60"
          >
            {MELODY_PRESETS.map((p, i) => (
              <option key={i} value={i}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Octave offset */}
        <div className="flex items-center gap-1">
          <span className="text-[7px] text-white/30 tracking-[0.1em]">OCT</span>
          {([-2, -1, 0, 1, 2] as const).map((o) => (
            <button
              key={o}
              onClick={() => setSynth(activeLayer.id, { octaveOffset: o })}
              className="w-5 h-5 text-[7px] font-black rounded border transition-all"
              style={{
                background: activeLayer.synth.octaveOffset === o ? `${layerColor}20` : "transparent",
                borderColor: activeLayer.synth.octaveOffset === o ? `${layerColor}60` : "#2a2d38",
                color: activeLayer.synth.octaveOffset === o ? layerColor : "#555",
              }}
            >
              {o > 0 ? `+${o}` : o}
            </button>
          ))}
        </div>

        {/* Cutoff slider */}
        <div className="flex items-center gap-1.5">
          <span className="text-[7px] text-white/30 tracking-[0.1em]">CUTOFF</span>
          <input
            type="range" min={0} max={1} step={0.01}
            value={activeLayer.synth.cutoff}
            onChange={(e) => setSynth(activeLayer.id, { cutoff: Number(e.target.value) })}
            className="w-20 h-1 accent-current"
            style={{ accentColor: layerColor }}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify dev server compiles without TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: No errors (or only pre-existing unrelated errors)

- [ ] **Step 3: Commit**

```bash
git add src/components/MelodyLayers/index.tsx
git commit -m "feat: add MelodyLayersEditor — focus-mode piano roll for polymeter layers"
```

---

## Task 5: Wire up App.tsx + MelodySequencer.tsx + melodyStore.ts

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/MelodySequencer.tsx`
- Modify: `src/store/melodyStore.ts`

### App.tsx

- [ ] **Step 1: Update App.tsx — replace C&R engine init with layer engines 1–3**

In `src/App.tsx`, find the C&R section (around line 218) and replace:

```typescript
// REMOVE these 4 lines:
import { responseCREngine } from "./audio/melodyCREngines";
// ...
responseCREngine.init(ctx);
const responseCROut = responseCREngine.getOutput();
if (responseCROut && melodyCh) responseCROut.connect(melodyCh);
```

Replace the import at the top of App.tsx:
```typescript
// ADD this import (near other audio imports):
import { melodyLayerEngines } from "./audio/melodyLayerEngines";
```

Replace the init block (keep the melodyEngine/melodyCh lines, replace the responseCREngine block):
```typescript
// In the audio init block, after:
//   if (melodyOut && melodyCh) melodyOut.connect(melodyCh);
// ADD:
// Melody Layer engines 1–3 → also Channel 14 (shares melody strip)
for (let i = 1; i <= 3; i++) {
  const layerEngine = melodyLayerEngines[i];
  if (layerEngine) {
    layerEngine.init(ctx);
    const layerOut = layerEngine.getOutput();
    if (layerOut && melodyCh) layerOut.connect(melodyCh);
  }
}
```

### MelodySequencer.tsx

- [ ] **Step 2: Update MelodySequencer.tsx — replace C&R toggle with Layers toggle**

In `src/components/MelodySequencer.tsx`, make these changes:

**Replace imports (lines 13–14):**
```typescript
// REMOVE:
import { useMelodyCRStore } from "../store/melodyCRStore";
import { MelodyCREditor } from "./MelodyCR";

// ADD:
import { useMelodyLayerStore } from "../store/melodyLayerStore";
import { MelodyLayersEditor } from "./MelodyLayers";
```

**Replace hook reads (lines 327–328):**
```typescript
// REMOVE:
const crEnabled = useMelodyCRStore((s) => s.enabled);
const setCREnabled = useMelodyCRStore((s) => s.setEnabled);

// ADD:
const layersEnabled = useMelodyLayerStore((s) => s.enabled);
const setLayersEnabled = useMelodyLayerStore((s) => s.setEnabled);
```

**Replace toggle button (lines ~601–610). Find the button that renders "C&R ON/OFF" and change it:**
```tsx
// REMOVE the C&R button block and REPLACE with:
<button
  onClick={() => setLayersEnabled(!layersEnabled)}
  className="ml-auto px-2.5 py-1 text-[8px] font-black tracking-[0.15em] rounded border transition-all"
  style={{
    background: layersEnabled ? "#a855f720" : "transparent",
    borderColor: layersEnabled ? "#a855f760" : "#2a2d38",
    color: layersEnabled ? "#a855f7" : "#555",
  }}
>
  LAYERS {layersEnabled ? "ON" : "OFF"}
</button>
```

**Replace conditional render (lines ~841–842):**
```tsx
// REMOVE:
{crEnabled ? (
  <MelodyCREditor />

// REPLACE with:
{layersEnabled ? (
  <MelodyLayersEditor />
```

### melodyStore.ts

- [ ] **Step 3: Update melodyStore.ts — update guard to check melodyLayerStore**

In `src/store/melodyStore.ts`, find line 17 and 941:

```typescript
// REMOVE line 17:
import { useMelodyCRStore } from "./melodyCRStore";

// ADD instead:
import { useMelodyLayerStore } from "./melodyLayerStore";
```

```typescript
// REMOVE line 941:
if (useMelodyCRStore.getState().enabled) {

// REPLACE with:
if (useMelodyLayerStore.getState().enabled) {
```

- [ ] **Step 4: Verify dev server compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: No new errors

- [ ] **Step 5: Manual smoke test**
  1. `npm run dev` → open browser
  2. Go to MELODY tab → click "LAYERS OFF" button → it becomes "LAYERS ON"
  3. `MelodyLayersEditor` renders (mini strip with L1, piano roll, synth panel)
  4. Click empty cell → note appears
  5. Right-click note → note deleted
  6. Click `+` → second layer L2 appears in strip
  7. Hit Play → notes from both layers play simultaneously

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/MelodySequencer.tsx src/store/melodyStore.ts
git commit -m "feat: wire up MelodyLayers to App.tsx, MelodySequencer, melody guard"
```

---

## Task 6: Scene integration (`sceneStore.ts`)

**Files:**
- Modify: `src/store/sceneStore.ts`

- [ ] **Step 1: Update sceneStore.ts**

Open `src/store/sceneStore.ts`. Make these changes:

**Replace import (line 22):**
```typescript
// REMOVE:
import { useMelodyCRStore, type MelodyCRNote, type SynthSettings } from "./melodyCRStore";

// ADD:
import { useMelodyLayerStore, type MelodyLayer } from "./melodyLayerStore";
```

**Replace Scene interface (lines 55–65):**
```typescript
// REMOVE:
/** Melody C&R state for this scene.
 *  undefined = legacy scene recorded before this feature — C&R is untouched on load. */
melodyCR?: {
  enabled: boolean;
  barLength: 1 | 2 | 4;
  callNotes: MelodyCRNote[];
  responseNotes: MelodyCRNote[];
  callSynth: SynthSettings;
  responseSynth: SynthSettings;
  rootNote: number;
};

// ADD:
/** Melody Layers state for this scene.
 *  undefined = legacy scene (pre-Layers) — untouched on load. */
melodyLayers?: {
  enabled: boolean;
  layers: MelodyLayer[];
  activeLayerId: string;
};
```

**Replace captureScene (lines ~184–193):**
```typescript
// REMOVE:
const crState = useMelodyCRStore.getState();
// ... and the melodyCR: { ... } block

// ADD (in captureScene, alongside other state captures):
const layersState = useMelodyLayerStore.getState();
```

In the returned scene object, replace the `melodyCR` field:
```typescript
// REMOVE:
melodyCR: {
  enabled: crState.enabled,
  barLength: crState.barLength,
  callNotes: deepClone(crState.callNotes),
  responseNotes: deepClone(crState.responseNotes),
  callSynth: deepClone(crState.callSynth),
  responseSynth: deepClone(crState.responseSynth),
  rootNote: crState.rootNote,
},

// ADD:
melodyLayers: {
  enabled: layersState.enabled,
  layers: deepClone(layersState.layers),
  activeLayerId: layersState.activeLayerId,
},
```

**Replace loadScene restore block (lines ~345–357):**
```typescript
// REMOVE:
if (scene.melodyCR !== undefined) {
  const cr = useMelodyCRStore.getState();
  cr.setEnabled(scene.melodyCR.enabled);
  // ... all cr. calls
}

// ADD:
if (scene.melodyLayers !== undefined) {
  useMelodyLayerStore.setState({
    enabled: scene.melodyLayers.enabled,
    layers: deepClone(scene.melodyLayers.layers),
    activeLayerId: scene.melodyLayers.activeLayerId,
  });
}
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/store/sceneStore.ts
git commit -m "feat: update sceneStore — replace melodyCR with melodyLayers scene fields"
```

---

## Task 7: Delete old C&R files

**Files:**
- Delete: `src/store/melodyCRStore.ts`
- Delete: `src/audio/melodyCREngines.ts`
- Delete: `src/components/MelodyCR/index.tsx`
- Delete: `src/components/MelodyCR/melodyCRScheduler.ts`
- Delete: `src/components/MelodyCR/melodyCRUtils.ts`
- Delete: `src/components/MelodyCR/melodyCRUtils.test.ts`

- [ ] **Step 1: Delete all C&R files**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
rm src/store/melodyCRStore.ts
rm src/audio/melodyCREngines.ts
rm src/components/MelodyCR/index.tsx
rm src/components/MelodyCR/melodyCRScheduler.ts
rm src/components/MelodyCR/melodyCRUtils.ts
rm src/components/MelodyCR/melodyCRUtils.test.ts
rmdir src/components/MelodyCR
```

- [ ] **Step 2: Verify no remaining imports of deleted modules**

```bash
grep -r "melodyCRStore\|melodyCREngines\|MelodyCR\|melodyCRScheduler\|melodyCRUtils" src/ --include="*.ts" --include="*.tsx"
```
Expected: no output (zero matches)

- [ ] **Step 3: Full compilation check**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: No errors referencing deleted files

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```
Expected: All tests pass. The `melodyCRUtils.test.ts` is gone; the two new test files pass.

- [ ] **Step 5: Final smoke test in browser**
  1. `npm run dev`
  2. Go to MELODY tab → LAYERS OFF → click → LAYERS ON
  3. Layers editor renders with L1 pill, piano roll, synth panel
  4. Add notes → play → notes sound with correct preset/cutoff
  5. Add L2 (click +) → switch to L2 → set barLength=1 → add different notes
  6. Play → both layers sound simultaneously, L2 loops 2× per L1 loop (polymeter)
  7. Mute L2 → only L1 plays
  8. Scene: capture a scene → load it → both layers restore correctly

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: remove C&R files — Melody Layers fully replaces Call & Response"
```
