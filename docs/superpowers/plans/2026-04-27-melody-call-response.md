# Melody Call & Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Call & Response mode to the MELODY tab — two voices (Call + Response) that strictly alternate bars, each with its own Piano Roll and independent synth settings.

**Architecture:** One Zustand store (`useMelodyCRStore`) holds `callNotes[]` + `responseNotes[]` + synth settings for both voices. One scheduler (`melodyCRScheduler.ts`) subscribes to the drum step clock and routes notes to two MelodyEngine instances (`callCREngine` = existing `melodyEngine`, `responseCREngine` = new instance). When C&R is enabled, the existing melody step scheduler is skipped via a guard in `melodyStore.ts`. The UI is an inline Piano Roll embedded inside the MELODY tab, toggled by a C&R switch.

**Tech Stack:** React, Zustand, Web Audio API, Vitest, TypeScript strict, Tailwind, existing `MelodyEngine` class, `drumCurrentStepStore` step clock.

**Spec:** `docs/superpowers/specs/2026-04-27-melody-call-response-design.md`

---

## File Map

| File | Action |
|---|---|
| `src/store/melodyCRStore.ts` | CREATE — Zustand store: enabled, barLength, callNotes, responseNotes, synth settings |
| `src/components/MelodyCR/melodyCRUtils.ts` | CREATE — pure scheduling helpers (testable) |
| `src/components/MelodyCR/melodyCRUtils.test.ts` | CREATE — vitest unit tests |
| `src/audio/melodyCREngines.ts` | CREATE — exports `callCREngine` + `responseCREngine` |
| `src/App.tsx` | MODIFY — init + connect `responseCREngine` on AudioContext resume |
| `src/components/MelodyCR/melodyCRScheduler.ts` | CREATE — drum-step subscriber, routes notes to engines |
| `src/store/melodyStore.ts` | MODIFY — guard: skip tick when C&R enabled |
| `src/components/MelodyCR/index.tsx` | CREATE — inline piano roll + synth panel |
| `src/components/MelodySequencer.tsx` | MODIFY — C&R toggle + conditional render |
| `src/store/sceneStore.ts` | MODIFY — capture/restore melodyCR state |

---

## Task 1: Store + Pure Utils + Tests

**Files:**
- Create: `src/store/melodyCRStore.ts`
- Create: `src/components/MelodyCR/melodyCRUtils.ts`
- Create: `src/components/MelodyCR/melodyCRUtils.test.ts`

- [ ] **Step 1: Create the Zustand store**

Create `src/store/melodyCRStore.ts`:

```typescript
import { create } from "zustand";

export interface MelodyCRNote {
  id: string;           // crypto.randomUUID()
  startBeat: number;    // beat position within this voice's own bar window
  durationBeats: number;
  pitch: number;        // MIDI 0–127
}

export interface SynthSettings {
  presetIndex: number;   // index into MELODY_PRESETS
  octaveOffset: number;  // -2 to +2 (added to pitch at trigger time as semitones * 12)
  cutoff: number;        // 0–1 (mapped to 200–12000 Hz at trigger time)
  linkToCall: boolean;   // Response only: when true, mirrors callSynth at trigger time
}

const DEFAULT_SYNTH: SynthSettings = {
  presetIndex: 0,
  octaveOffset: 0,
  cutoff: 0.5,
  linkToCall: false,
};

interface MelodyCRState {
  enabled: boolean;
  barLength: 1 | 2 | 4;
  activeVoice: "call" | "response";
  callNotes: MelodyCRNote[];
  responseNotes: MelodyCRNote[];
  callSynth: SynthSettings;
  responseSynth: SynthSettings;
  rootNote: number;  // 0–11, for piano roll highlighting (0=C)

  // Actions
  setEnabled: (v: boolean) => void;
  setBarLength: (bars: 1 | 2 | 4) => void;
  setActiveVoice: (v: "call" | "response") => void;
  addCallNote: (n: MelodyCRNote) => void;
  addResponseNote: (n: MelodyCRNote) => void;
  removeCallNote: (id: string) => void;
  removeResponseNote: (id: string) => void;
  updateCallNote: (id: string, patch: Partial<MelodyCRNote>) => void;
  updateResponseNote: (id: string, patch: Partial<MelodyCRNote>) => void;
  setCallSynth: (patch: Partial<SynthSettings>) => void;
  setResponseSynth: (patch: Partial<SynthSettings>) => void;
  clearCallNotes: () => void;
  clearResponseNotes: () => void;
  setRootNote: (n: number) => void;
}

export const useMelodyCRStore = create<MelodyCRState>((set) => ({
  enabled: false,
  barLength: 2,
  activeVoice: "call",
  callNotes: [],
  responseNotes: [],
  callSynth: { ...DEFAULT_SYNTH },
  responseSynth: { ...DEFAULT_SYNTH, linkToCall: false },
  rootNote: 0,

  setEnabled: (v) => set({ enabled: v }),
  setBarLength: (bars) => set({ barLength: bars }),
  setActiveVoice: (v) => set({ activeVoice: v }),
  addCallNote: (n) => set((s) => ({ callNotes: [...s.callNotes, n] })),
  addResponseNote: (n) => set((s) => ({ responseNotes: [...s.responseNotes, n] })),
  removeCallNote: (id) => set((s) => ({ callNotes: s.callNotes.filter((n) => n.id !== id) })),
  removeResponseNote: (id) => set((s) => ({ responseNotes: s.responseNotes.filter((n) => n.id !== id) })),
  updateCallNote: (id, patch) => set((s) => ({
    callNotes: s.callNotes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  })),
  updateResponseNote: (id, patch) => set((s) => ({
    responseNotes: s.responseNotes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  })),
  setCallSynth: (patch) => set((s) => ({ callSynth: { ...s.callSynth, ...patch } })),
  setResponseSynth: (patch) => set((s) => ({ responseSynth: { ...s.responseSynth, ...patch } })),
  clearCallNotes: () => set({ callNotes: [] }),
  clearResponseNotes: () => set({ responseNotes: [] }),
  setRootNote: (n) => set({ rootNote: n }),
}));
```

- [ ] **Step 2: Create the pure scheduling utils**

Create `src/components/MelodyCR/melodyCRUtils.ts`:

```typescript
/**
 * Pure helpers for Melody C&R scheduling logic.
 * No side effects — easily unit-tested.
 */

/**
 * Total 16th-note steps in one full C&R cycle (Call + Response).
 * barLength=2 → 2 bars Call + 2 bars Response = 4 bars × 16 steps = 64 steps.
 */
export function fullCycleSteps(barLength: 1 | 2 | 4): number {
  return barLength * 8 * 4;
}

/**
 * 16th-note steps for the Call section only (first half of cycle).
 */
export function callSectionSteps(barLength: 1 | 2 | 4): number {
  return barLength * 4 * 4;
}

/**
 * Which voice is active at stepCounter (monotonically increasing, never resets).
 */
export function getActiveVoice(
  stepCounter: number,
  barLength: 1 | 2 | 4
): "call" | "response" {
  const cs = callSectionSteps(barLength);
  const fs = fullCycleSteps(barLength);
  return stepCounter % fs < cs ? "call" : "response";
}

/**
 * Step position local to the active voice's own bar window.
 * Resets to 0 at the start of each voice section.
 */
export function getLocalStep(
  stepCounter: number,
  barLength: 1 | 2 | 4
): number {
  const cs = callSectionSteps(barLength);
  const fs = fullCycleSteps(barLength);
  const wrapped = stepCounter % fs;
  return wrapped < cs ? wrapped : wrapped - cs;
}

/**
 * Convert a local 16th-note step to a beat position (÷ 4).
 */
export function stepToBeat(localStep: number): number {
  return localStep / 4;
}

/**
 * Find all notes that start on localStep (within ½-step tolerance to handle float rounding).
 */
export function notesOnStep(
  notes: { startBeat: number; durationBeats: number; pitch: number; id: string }[],
  localStep: number,
  totalBeats: number
): typeof notes {
  const totalSteps = totalBeats * 4;
  return notes.filter((n) => {
    const noteStep = Math.round(n.startBeat * 4) % totalSteps;
    return noteStep === localStep % totalSteps;
  });
}
```

- [ ] **Step 3: Write tests for the pure utils**

Create `src/components/MelodyCR/melodyCRUtils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  fullCycleSteps,
  callSectionSteps,
  getActiveVoice,
  getLocalStep,
  stepToBeat,
  notesOnStep,
} from "./melodyCRUtils";

describe("fullCycleSteps", () => {
  it("barLength=1 → 32 steps (1 bar Call + 1 bar Response)", () => {
    expect(fullCycleSteps(1)).toBe(32);
  });
  it("barLength=2 → 64 steps", () => {
    expect(fullCycleSteps(2)).toBe(64);
  });
  it("barLength=4 → 128 steps", () => {
    expect(fullCycleSteps(4)).toBe(128);
  });
});

describe("callSectionSteps", () => {
  it("barLength=1 → 16 steps", () => {
    expect(callSectionSteps(1)).toBe(16);
  });
  it("barLength=2 → 32 steps", () => {
    expect(callSectionSteps(2)).toBe(32);
  });
});

describe("getActiveVoice", () => {
  it("step 0 → call", () => {
    expect(getActiveVoice(0, 2)).toBe("call");
  });
  it("step 31 (last call step) → call for barLength=2", () => {
    expect(getActiveVoice(31, 2)).toBe("call");
  });
  it("step 32 (first response step) → response for barLength=2", () => {
    expect(getActiveVoice(32, 2)).toBe("response");
  });
  it("step 63 (last response step) → response for barLength=2", () => {
    expect(getActiveVoice(63, 2)).toBe("response");
  });
  it("step 64 (cycle wraps) → call for barLength=2", () => {
    expect(getActiveVoice(64, 2)).toBe("call");
  });
  it("barLength=1: step 16 → response", () => {
    expect(getActiveVoice(16, 1)).toBe("response");
  });
  it("barLength=4: step 64 → response", () => {
    expect(getActiveVoice(64, 4)).toBe("response");
  });
});

describe("getLocalStep", () => {
  it("step 0 (call) → localStep 0", () => {
    expect(getLocalStep(0, 2)).toBe(0);
  });
  it("step 31 (last call) → localStep 31", () => {
    expect(getLocalStep(31, 2)).toBe(31);
  });
  it("step 32 (first response) → localStep 0", () => {
    expect(getLocalStep(32, 2)).toBe(0);
  });
  it("step 47 (response step 15) → localStep 15", () => {
    expect(getLocalStep(47, 2)).toBe(15);
  });
  it("step 64 (second cycle call) → localStep 0", () => {
    expect(getLocalStep(64, 2)).toBe(0);
  });
});

describe("stepToBeat", () => {
  it("step 0 → beat 0", () => {
    expect(stepToBeat(0)).toBe(0);
  });
  it("step 4 → beat 1", () => {
    expect(stepToBeat(4)).toBe(1);
  });
  it("step 7 → beat 1.75", () => {
    expect(stepToBeat(7)).toBe(1.75);
  });
});

describe("notesOnStep", () => {
  const notes = [
    { id: "a", startBeat: 0, durationBeats: 1, pitch: 60 },
    { id: "b", startBeat: 1, durationBeats: 0.5, pitch: 62 },
    { id: "c", startBeat: 0.25, durationBeats: 0.25, pitch: 64 },
  ];
  it("step 0 → note at beat 0", () => {
    const found = notesOnStep(notes, 0, 8);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("a");
  });
  it("step 1 → note at beat 0.25", () => {
    const found = notesOnStep(notes, 1, 8);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("c");
  });
  it("step 4 → note at beat 1", () => {
    const found = notesOnStep(notes, 4, 8);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("b");
  });
  it("step 8 → empty (no notes at beat 2)", () => {
    const found = notesOnStep(notes, 8, 8);
    expect(found).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx vitest run src/components/MelodyCR/melodyCRUtils.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/melodyCRStore.ts src/components/MelodyCR/melodyCRUtils.ts src/components/MelodyCR/melodyCRUtils.test.ts
git commit -m "feat: add melodyCRStore, pure scheduling utils + tests"
```

---

## Task 2: Engine Instances + App.tsx Routing

**Files:**
- Create: `src/audio/melodyCREngines.ts`
- Modify: `src/App.tsx`

**Context:** `melodyEngine` (from `MelodyEngine.ts`) is a singleton initialized in `App.tsx` via `melodyEngine.init(ctx)` and routed to Channel 14 via `melodyEngine.getOutput()`. `responseCREngine` needs the same treatment — same channel 14 so it shares the melody mixer strip. The `MelodyEngine` class is a named export alongside the `melodyEngine` singleton.

- [ ] **Step 1: Create melodyCREngines.ts**

Create `src/audio/melodyCREngines.ts`:

```typescript
/**
 * Melody C&R engine instances.
 *
 * callCREngine  = the existing melodyEngine singleton (reused for Call voice).
 * responseCREngine = a separate MelodyEngine instance for Response voice.
 *
 * Both are initialized in App.tsx and connected to Channel 14 (shared melody strip).
 * The existing melody step scheduler is disabled when C&R is enabled (guard in melodyStore.ts).
 */
import { melodyEngine, MelodyEngine } from "./MelodyEngine";

export const callCREngine = melodyEngine;
export const responseCREngine = new MelodyEngine();
```

- [ ] **Step 2: Find the melody init block in App.tsx**

Read `src/App.tsx` around line 211–215:

```
melodyEngine.init(ctx);
const melodyOut = melodyEngine.getOutput();
const melodyCh = audioEngine.getChannelOutput(14);
if (melodyOut && melodyCh) melodyOut.connect(melodyCh);
```

- [ ] **Step 3: Add responseCREngine init immediately after the melody block**

In `src/App.tsx`, add the following lines right after `if (melodyOut && melodyCh) melodyOut.connect(melodyCh);`:

```typescript
// Response C&R engine → also Channel 14 (shares melody mixer strip)
import { responseCREngine } from "./audio/melodyCREngines";
responseCREngine.init(ctx);
const responseCROut = responseCREngine.getOutput();
if (responseCROut && melodyCh) responseCROut.connect(melodyCh);
```

> **Note:** Add the import at the top of App.tsx with the other audio imports, not inline. The import line shown here is for clarity only.

The actual import to add at the top of `src/App.tsx` (with the other audio imports):

```typescript
import { responseCREngine } from "./audio/melodyCREngines";
```

And the init code to add after `if (melodyOut && melodyCh) melodyOut.connect(melodyCh);`:

```typescript
// Melody C&R Response → also Channel 14 (shares melody strip)
responseCREngine.init(ctx);
const responseCROut = responseCREngine.getOutput();
if (responseCROut && melodyCh) responseCROut.connect(melodyCh);
```

- [ ] **Step 4: Verify build compiles**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/audio/melodyCREngines.ts src/App.tsx
git commit -m "feat: add responseCREngine instance, init + route to Ch14"
```

---

## Task 3: Scheduler + melodyStore Guard

**Files:**
- Create: `src/components/MelodyCR/melodyCRScheduler.ts`
- Modify: `src/store/melodyStore.ts`

**Context:** The scheduler uses `drumCurrentStepStore` (same as `chordPianoScheduler.ts`) — it subscribes to drum steps, converts the global step counter to a voice-local step using `getActiveVoice` / `getLocalStep`, then calls `engine.triggerPolyNote(midiNote, t, durationSec)`. The drum clock already provides a lookahead timestamp via `getDrumCurrentStepAudioTime()` — **no extra offset needed**. Use `triggerPolyNote` (not `triggerNote`+`releaseNote`) because it pre-schedules the full ADSR envelope including release, matching how ChordsEngine is used. The guard in `melodyStore.ts` follows the exact same pattern as the guard added to `chordsStore.ts` for ChordPianoRoll.

- [ ] **Step 1: Create melodyCRScheduler.ts**

Create `src/components/MelodyCR/melodyCRScheduler.ts`:

```typescript
// src/components/MelodyCR/melodyCRScheduler.ts
//
// Subscribes to drumCurrentStepStore, plays MelodyCR notes via
// callCREngine (= melodyEngine) and responseCREngine.
// Import once from MelodyCREditor to activate.

import { drumCurrentStepStore, getDrumCurrentStepAudioTime } from "../../store/drumStore";
import { useDrumStore } from "../../store/drumStore";
import { useMelodyCRStore } from "../../store/melodyCRStore";
import { callCREngine, responseCREngine } from "../../audio/melodyCREngines";
import { MELODY_PRESETS } from "../../store/melodyStore";
import {
  fullCycleSteps,
  getActiveVoice,
  getLocalStep,
  stepToBeat,
  notesOnStep,
} from "./melodyCRUtils";

// ─── Internal state ────────────────────────────────────────────────────────────

let _lastStep = -1;
let _stepCounter = 0;

// External beat store — drives playhead in MelodyCREditor
const _beatListeners = new Set<() => void>();
let _currentVoice: "call" | "response" = "call";
let _currentLocalBeat = 0;

export const melodyCRCurrentBeatStore = {
  subscribe(listener: () => void): () => void {
    _beatListeners.add(listener);
    return () => _beatListeners.delete(listener);
  },
  getSnapshot(): { voice: "call" | "response"; beat: number } {
    return { voice: _currentVoice, beat: _currentLocalBeat };
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Apply SynthSettings to a MelodyEngine instance. */
function applySynth(engine: typeof callCREngine, presetIndex: number, cutoff: number): void {
  const preset = MELODY_PRESETS[presetIndex];
  if (preset) {
    // Map cutoff 0–1 to 200–12000 Hz (log-ish)
    const cutoffHz = 200 + cutoff * 11800;
    engine.setParams({ ...preset.params, cutoff: cutoffHz });
  }
}

// ─── Tick ──────────────────────────────────────────────────────────────────────

function tick(currentStep: number, bpm: number): void {
  const state = useMelodyCRStore.getState();
  if (!state.enabled) return;
  if (currentStep === _lastStep) return;

  const advanced = _lastStep >= 0;
  _lastStep = currentStep;

  if (advanced) {
    _stepCounter++;
  } else {
    _stepCounter = 0;
  }

  const { barLength, callNotes, responseNotes, callSynth, responseSynth } = state;

  // Loop wrap — on real wrap only (not first tick)
  const fs = fullCycleSteps(barLength);
  const wrappedGlobal = _stepCounter % fs;
  if (wrappedGlobal === 0 && advanced) {
    // Nothing to explicitly release — triggerPolyNote self-releases
  }

  const voice = getActiveVoice(_stepCounter, barLength);
  const localStep = getLocalStep(_stepCounter, barLength);
  const localBeat = stepToBeat(localStep);
  const totalBeats = barLength * 4;

  // Update playhead
  _currentVoice = voice;
  _currentLocalBeat = localBeat;
  for (const fn of _beatListeners) fn();

  // Determine which engine + notes + synth to use
  const isCall = voice === "call";
  const engine = isCall ? callCREngine : responseCREngine;
  const notes = isCall ? callNotes : responseNotes;
  // Response can link to Call settings
  const effectiveSynth =
    !isCall && responseSynth.linkToCall ? callSynth : isCall ? callSynth : responseSynth;

  // Apply synth settings each tick (cheap — setParams is idempotent)
  // Only apply when section boundary: localStep === 0
  if (localStep === 0) {
    applySynth(engine, effectiveSynth.presetIndex, effectiveSynth.cutoff);
  }

  if (notes.length === 0) return;

  const t = getDrumCurrentStepAudioTime();
  const secPerBeat = 60 / bpm;

  const hits = notesOnStep(notes, localStep, totalBeats);
  for (const note of hits) {
    const midiNote = Math.max(0, Math.min(127, note.pitch + effectiveSynth.octaveOffset * 12));
    const durationSec = Math.max(0.05, note.durationBeats * secPerBeat);
    engine.triggerPolyNote(midiNote, t, durationSec);
  }
}

// ─── Subscribe to drum step clock ─────────────────────────────────────────────

const _unsubDrum = drumCurrentStepStore.subscribe(() => {
  const currentStep = drumCurrentStepStore.getSnapshot();
  const { isPlaying, bpm } = useDrumStore.getState();

  if (isPlaying) {
    tick(currentStep, bpm);
  } else {
    _lastStep = -1;
    _stepCounter = 0;
    _currentLocalBeat = 0;
    for (const fn of _beatListeners) fn();
  }
});

// Reset step counter when barLength changes mid-playback
let _prevBarLength = useMelodyCRStore.getState().barLength;
const _unsubStore = useMelodyCRStore.subscribe((state) => {
  if (state.barLength !== _prevBarLength) {
    _prevBarLength = state.barLength;
    _stepCounter = 0;
    _lastStep = -1;
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _unsubDrum();
    _unsubStore();
  });
}
```

- [ ] **Step 2: Add the guard in melodyStore.ts**

Open `src/store/melodyStore.ts`. Find this block (around line 936–938):

```typescript
      const currentStep = _melodyStep;
      const stepIndex = currentStep % length;
      const step = steps[stepIndex];
```

Add the C&R guard **immediately after** `const stepIndex = currentStep % length;`:

```typescript
      const currentStep = _melodyStep;
      const stepIndex = currentStep % length;

      // Skip step-grid melody when Melody C&R is the active source
      const { useMelodyCRStore } = await import("./melodyCRStore");
```

Wait — dynamic import inside a hot loop would break things. Instead, use a static import at the top of the file. Add this import at the top of `src/store/melodyStore.ts` with the other imports:

```typescript
import { useMelodyCRStore } from "./melodyCRStore";
```

Then add the guard right after `const stepIndex = currentStep % length;` (and before `const step = steps[stepIndex];`):

```typescript
      // Skip step-grid playback when Melody C&R mode is active
      if (useMelodyCRStore.getState().enabled) {
        setMelodyStep((currentStep + 1) % length);
        nextMelodyStepTime += secondsPerStep;
        continue;
      }
```

The full context of the while loop after the edit (lines ~936–945):

```typescript
      const currentStep = _melodyStep;
      const stepIndex = currentStep % length;

      // Skip step-grid playback when Melody C&R mode is active
      if (useMelodyCRStore.getState().enabled) {
        setMelodyStep((currentStep + 1) % length);
        nextMelodyStepTime += secondsPerStep;
        continue;
      }

      const step = steps[stepIndex];
      const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : steps[length - 1];
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/MelodyCR/melodyCRScheduler.ts src/store/melodyStore.ts
git commit -m "feat: add melodyCRScheduler + melodyStore guard for C&R mode"
```

---

## Task 4: MelodyCR Editor Component

**Files:**
- Create: `src/components/MelodyCR/index.tsx`

**Context:** This is an inline piano roll + synth panel embedded in the MELODY tab. It mirrors the approach of `ChordPianoRoll/index.tsx` but for single melody notes. Key measurements: `MIDI_MIN=48` (C3), `MIDI_MAX=84` (C6), 37 rows, `ROW_H=14px`, `PIANO_W=40px`, `RULER_H=20px`. Call notes are pink `#f472b6`, Response notes green `#22c55e`. The scheduler is activated via side-effect import at the top. The playhead reads from `melodyCRCurrentBeatStore`. `MELODY_PRESETS` are imported from `melodyStore`.

- [ ] **Step 1: Create the MelodyCREditor component**

Create `src/components/MelodyCR/index.tsx`:

```typescript
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMelodyCRStore, type MelodyCRNote } from "../../store/melodyCRStore";
import { useDrumStore } from "../../store/drumStore";
import { MELODY_PRESETS } from "../../store/melodyStore";
import { callCREngine, responseCREngine } from "../../audio/melodyCREngines";
import { melodyCRCurrentBeatStore } from "./melodyCRScheduler";

// Activate scheduler via side-effect import
import "./melodyCRScheduler";

// ─── Constants ────────────────────────────────────────────────────────────────

const MIDI_MIN = 48;  // C3
const MIDI_MAX = 84;  // C6
const ROWS = MIDI_MAX - MIDI_MIN + 1;  // 37
const ROW_H = 14;
const PIANO_W = 40;
const RULER_H = 20;
const CALL_COLOR = "#f472b6";
const RESP_COLOR = "#22c55e";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]); // semitones that are black keys

function isBlackKey(pitch: number): boolean {
  return BLACK_KEYS.has(((pitch % 12) + 12) % 12);
}

function pitchName(pitch: number): string {
  return NOTE_NAMES[((pitch % 12) + 12) % 12]!;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MelodyCREditor() {
  const {
    enabled, barLength, activeVoice,
    callNotes, responseNotes,
    callSynth, responseSynth,
    rootNote,
    setActiveVoice, setBarLength,
    addCallNote, addResponseNote,
    removeCallNote, removeResponseNote,
    updateCallNote, updateResponseNote,
    setCallSynth, setResponseSynth,
    clearCallNotes, clearResponseNotes,
    setRootNote,
  } = useMelodyCRStore();

  const isPlaying = useDrumStore((s) => s.isPlaying);

  // Playhead
  const beatInfo = useSyncExternalStore(
    melodyCRCurrentBeatStore.subscribe,
    melodyCRCurrentBeatStore.getSnapshot,
    () => ({ voice: "call" as const, beat: 0 }),
  );

  const gridRef = useRef<HTMLDivElement>(null);
  const [hoverCell, setHoverCell] = useState<{ pitch: number; beat: number } | null>(null);
  const [gridCursor, setGridCursor] = useState("crosshair");
  const [resizeDrag, setResizeDrag] = useState<{
    id: string;
    voice: "call" | "response";
    startX: number;
    origDur: number;
    beatWidth: number;
  } | null>(null);

  const notes = activeVoice === "call" ? callNotes : responseNotes;
  const noteColor = activeVoice === "call" ? CALL_COLOR : RESP_COLOR;
  const totalBeats = barLength * 4;
  const totalCols = barLength * 16; // 16th-note columns

  // ─── Beat width in pixels (computed from grid width) ─────────────────────

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

  // ─── Hit testing ──────────────────────────────────────────────────────────

  function hitTestNote(clientX: number, clientY: number) {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const x = clientX - rect.left - PIANO_W;
    const y = clientY - rect.top - RULER_H;
    if (x < 0 || y < 0) return null;

    const rowIdx = Math.floor(y / ROW_H);
    if (rowIdx < 0 || rowIdx >= ROWS) return null;
    const pitch = MIDI_MAX - rowIdx;
    const beat = x / beatWidth;

    for (const note of notes) {
      if (note.pitch !== pitch) continue;
      const noteStartX = note.startBeat * beatWidth;
      const noteEndX = (note.startBeat + note.durationBeats) * beatWidth;
      if (x >= noteStartX && x <= noteEndX) {
        const isRightEdge = x >= noteEndX - 6;
        return { note, isRightEdge, pitch, beat };
      }
    }
    return { note: null, isRightEdge: false, pitch, beat };
  }

  // ─── Pointer handlers ─────────────────────────────────────────────────────

  const handleGridPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const hit = hitTestNote(e.clientX, e.clientY);
    if (!hit) return;

    if (hit.note && hit.isRightEdge) {
      // Start resize drag
      e.currentTarget.setPointerCapture(e.pointerId);
      setResizeDrag({
        id: hit.note.id,
        voice: activeVoice,
        startX: e.clientX,
        origDur: hit.note.durationBeats,
        beatWidth,
      });
      return;
    }

    if (!hit.note && e.button === 0) {
      // Add note — snap startBeat to 16th note grid
      const snappedBeat = Math.round(hit.beat * 4) / 4;
      if (snappedBeat < 0 || snappedBeat >= totalBeats) return;
      const newNote: MelodyCRNote = {
        id: crypto.randomUUID(),
        pitch: hit.pitch,
        startBeat: snappedBeat,
        durationBeats: 0.5,  // 8th note default
      };
      if (activeVoice === "call") addCallNote(newNote);
      else addResponseNote(newNote);
    }
  }, [activeVoice, beatWidth, totalBeats, notes, addCallNote, addResponseNote]); // eslint-disable-line

  const handleGridPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeDrag) {
      const deltaPx = e.clientX - resizeDrag.startX;
      const deltaBeat = deltaPx / resizeDrag.beatWidth;
      const newDur = Math.max(0.25, Math.round((resizeDrag.origDur + deltaBeat) * 4) / 4);
      if (resizeDrag.voice === "call") {
        updateCallNote(resizeDrag.id, { durationBeats: newDur });
      } else {
        updateResponseNote(resizeDrag.id, { durationBeats: newDur });
      }
      return;
    }

    // Ghost preview hover + cursor update
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - PIANO_W;
    const y = e.clientY - rect.top - RULER_H;
    if (x < 0 || y < 0) { setHoverCell(null); setGridCursor("crosshair"); return; }
    const rowIdx = Math.floor(y / ROW_H);
    if (rowIdx < 0 || rowIdx >= ROWS) { setHoverCell(null); setGridCursor("crosshair"); return; }
    const pitch = MIDI_MAX - rowIdx;
    const beat = Math.round((x / beatWidth) * 4) / 4;
    // Detect right-edge hover for resize cursor
    const onRightEdge = notes.some((n) => {
      if (n.pitch !== pitch) return false;
      const endX = (n.startBeat + n.durationBeats) * beatWidth;
      const startX = n.startBeat * beatWidth;
      return x >= startX && x >= endX - 6 && x <= endX;
    });
    setGridCursor(onRightEdge ? "ew-resize" : "crosshair");
    // Only show ghost if no note at this pitch + beat already
    const hasNote = notes.some(
      (n) => n.pitch === pitch && beat >= n.startBeat && beat < n.startBeat + n.durationBeats
    );
    setHoverCell(hasNote ? null : { pitch, beat });
  }, [resizeDrag, beatWidth, notes, updateCallNote, updateResponseNote]);

  const handleGridPointerUp = useCallback(() => {
    setResizeDrag(null);
  }, []);

  const handleGridContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const hit = hitTestNote(e.clientX, e.clientY);
    if (hit?.note) {
      if (activeVoice === "call") removeCallNote(hit.note.id);
      else removeResponseNote(hit.note.id);
    }
  }, [activeVoice, notes, removeCallNote, removeResponseNote]); // eslint-disable-line

  // ─── Ghost note ──────────────────────────────────────────────────────────

  const ghostNote = useMemo(() => {
    if (!hoverCell) return null;
    const { pitch, beat } = hoverCell;
    if (beat < 0 || beat >= totalBeats) return null;
    return { pitch, startBeat: beat, durationBeats: 0.5, id: "ghost" };
  }, [hoverCell, totalBeats]);

  // ─── Playhead position ───────────────────────────────────────────────────

  const playheadX = isPlaying && beatInfo.voice === activeVoice
    ? PIANO_W + beatInfo.beat * beatWidth
    : null;

  // ─── Synth panel helpers ─────────────────────────────────────────────────

  const activeSynth = activeVoice === "call" ? callSynth : responseSynth;
  const setActiveSynth = activeVoice === "call" ? setCallSynth : setResponseSynth;

  function applyPreset(index: number) {
    setActiveSynth({ presetIndex: index });
    const engine = activeVoice === "call" ? callCREngine : responseCREngine;
    const preset = MELODY_PRESETS[index];
    if (preset) engine.setParams(preset.params);
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const gridHeight = ROWS * ROW_H;

  return (
    <div className="flex flex-col select-none" style={{ fontFamily: "monospace" }}>
      {/* Sub-tab bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        {(["call", "response"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setActiveVoice(v)}
            className="px-2.5 py-1 text-[8px] font-black tracking-[0.15em] rounded border transition-all"
            style={{
              background: activeVoice === v ? (v === "call" ? "#f472b620" : "#22c55e20") : "transparent",
              borderColor: activeVoice === v ? (v === "call" ? "#f472b660" : "#22c55e60") : "#2a2d38",
              color: activeVoice === v ? (v === "call" ? CALL_COLOR : RESP_COLOR) : "#555",
            }}
          >
            {v === "call" ? "▶ CALL" : "RESPONSE"}
          </button>
        ))}

        <div className="flex items-center gap-1 ml-4">
          <span className="text-[7px] text-white/30 tracking-[0.1em]">BARS</span>
          {([1, 2, 4] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBarLength(b)}
              className="w-6 h-5 text-[8px] font-black rounded transition-all"
              style={{
                background: barLength === b ? "#a855f720" : "transparent",
                border: `1px solid ${barLength === b ? "#a855f760" : "#2a2d38"}`,
                color: barLength === b ? "#a855f7" : "#555",
              }}
            >
              {b}
            </button>
          ))}
        </div>

        <button
          onClick={() => { if (activeVoice === "call") clearCallNotes(); else clearResponseNotes(); }}
          className="ml-auto text-[7px] font-bold tracking-[0.1em] text-white/20 hover:text-white/50 px-1.5 py-0.5 rounded border border-white/8"
        >
          CLR
        </button>
      </div>

      {/* Piano Roll Grid */}
      <div
        ref={gridRef}
        className="relative overflow-y-auto overflow-x-hidden"
        style={{ height: Math.min(gridHeight + RULER_H, 260), background: "#0d0f14", cursor: gridCursor }}
        onPointerDown={handleGridPointerDown}
        onPointerMove={handleGridPointerMove}
        onPointerUp={handleGridPointerUp}
        onPointerLeave={() => { setHoverCell(null); if (resizeDrag) setResizeDrag(null); }}
        onContextMenu={handleGridContextMenu}
      >
        {/* Ruler */}
        <div
          className="sticky top-0 z-10 flex"
          style={{ height: RULER_H, background: "#0d0f14", borderBottom: "1px solid #1f2230", paddingLeft: PIANO_W }}
        >
          {Array.from({ length: barLength * 4 }, (_, beat) => (
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
            const isRoot = ((pitch % 12) + 12) % 12 === rootNote;
            const name = pitchName(pitch);
            const isC = name === "C";

            return (
              <div
                key={pitch}
                style={{
                  display: "flex",
                  height: ROW_H,
                  background: isRoot
                    ? "rgba(249,115,22,0.10)"
                    : isBlack
                    ? "rgba(0,0,0,0.25)"
                    : "transparent",
                  borderBottom: isC ? "1px solid #222" : "1px solid #181a22",
                }}
              >
                {/* Piano key */}
                <div
                  style={{
                    width: PIANO_W,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: 5,
                    fontSize: 6,
                    color: isRoot ? "rgba(249,115,22,0.9)" : isBlack ? "#333" : "#444",
                    background: isBlack ? "#151820" : "#1a1d26",
                    borderRight: "1px solid #222",
                    cursor: "default",
                  }}
                >
                  {isC || isRoot ? name + (Math.floor(pitch / 12) - 1) : ""}
                </div>

                {/* Beat cells — purely visual grid lines */}
                {Array.from({ length: barLength * 4 }, (_, beat) => (
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

          {/* Notes (call or response) */}
          {[...notes, ...(ghostNote ? [{ ...ghostNote, _ghost: true }] : [])].map((note) => {
            const isGhost = "id" in note && note.id === "ghost";
            const rowIdx = MIDI_MAX - note.pitch;
            if (rowIdx < 0 || rowIdx >= ROWS) return null;
            const top = rowIdx * ROW_H;
            const left = PIANO_W + note.startBeat * beatWidth;
            const width = Math.max(4, note.durationBeats * beatWidth - 2);

            return (
              <div
                key={note.id}
                style={{
                  position: "absolute",
                  top: top + 2,
                  left,
                  width,
                  height: ROW_H - 3,
                  background: isGhost
                    ? `${noteColor}30`
                    : `${noteColor}70`,
                  border: `1px solid ${isGhost ? noteColor + "40" : noteColor}`,
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

      {/* Synth panel */}
      <div className="px-3 py-2 border-t border-white/5 flex flex-wrap items-center gap-x-4 gap-y-1.5"
        style={{ background: "#0d0f14" }}
      >
        {/* Preset */}
        <div className="flex items-center gap-1.5">
          <span className="text-[7px] text-white/30 tracking-[0.1em]">PRESET</span>
          <select
            value={activeSynth.presetIndex}
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
              onClick={() => setActiveSynth({ octaveOffset: o })}
              className="w-5 h-5 text-[7px] font-black rounded border transition-all"
              style={{
                background: activeSynth.octaveOffset === o ? `${noteColor}20` : "transparent",
                borderColor: activeSynth.octaveOffset === o ? `${noteColor}60` : "#2a2d38",
                color: activeSynth.octaveOffset === o ? noteColor : "#555",
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
            value={activeSynth.cutoff}
            onChange={(e) => setActiveSynth({ cutoff: Number(e.target.value) })}
            className="w-20 h-1 accent-current"
            style={{ accentColor: noteColor }}
          />
        </div>

        {/* Response-only: link to Call */}
        {activeVoice === "response" && (
          <button
            onClick={() => setResponseSynth({ linkToCall: !responseSynth.linkToCall })}
            className="text-[7px] font-black tracking-[0.1em] px-2 py-1 rounded border transition-all"
            style={{
              background: responseSynth.linkToCall ? "#22c55e20" : "transparent",
              borderColor: responseSynth.linkToCall ? "#22c55e60" : "#2a2d38",
              color: responseSynth.linkToCall ? "#22c55e" : "#555",
            }}
          >
            {responseSynth.linkToCall ? "= CALL ✓" : "= CALL"}
          </button>
        )}

        {/* Root note for highlighting */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[7px] text-white/20 tracking-[0.1em]">ROOT</span>
          <select
            value={rootNote}
            onChange={(e) => setRootNote(Number(e.target.value))}
            className="text-[7px] bg-black/30 border border-white/5 rounded px-1 py-0.5 text-white/40"
          >
            {NOTE_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MelodyCR/index.tsx
git commit -m "feat: add MelodyCREditor inline piano roll component"
```

---

## Task 5: MelodySequencer Integration + Scene Integration

**Files:**
- Modify: `src/components/MelodySequencer.tsx`
- Modify: `src/store/sceneStore.ts`

**Context:** The MELODY tab is rendered by `MelodySequencer.tsx`. We add a C&R toggle in the existing toolbar area. When `enabled = true`, the entire sequencer body is replaced by `<MelodyCREditor />`. The scene store captures/restores the full `MelodyCRState` for scene snapshots.

- [ ] **Step 1: Add C&R toggle to MelodySequencer.tsx**

Open `src/components/MelodySequencer.tsx`. Add these imports at the top:

```typescript
import { useMelodyCRStore } from "../store/melodyCRStore";
import { MelodyCREditor } from "./MelodyCR";
```

Inside the `MelodySequencer` component (or its top-level function), add:

```typescript
const crEnabled = useMelodyCRStore((s) => s.enabled);
const setCREnabled = useMelodyCRStore((s) => s.setEnabled);
```

Find the toolbar area at the top of the component's returned JSX. Add the C&R toggle button in the toolbar row immediately after the existing controls (look for the `CLR` button row or the top control bar). The exact insertion point should be near where scale/length controls are shown. Add this toggle:

```tsx
{/* C&R Toggle */}
<button
  onClick={() => setCREnabled(!crEnabled)}
  className="px-2.5 py-1 text-[8px] font-black tracking-[0.15em] rounded border transition-all ml-auto"
  style={{
    background: crEnabled ? "#a855f720" : "transparent",
    borderColor: crEnabled ? "#a855f760" : "#2a2d38",
    color: crEnabled ? "#a855f7" : "#555",
  }}
  title="Toggle Call & Response mode"
>
  C&R {crEnabled ? "ON" : "OFF"}
</button>
```

Then find where the main sequencer body is returned (after the toolbar). Wrap it in a conditional:

```tsx
{crEnabled ? (
  <MelodyCREditor />
) : (
  {/* existing sequencer body — leave unchanged */}
  ...existing content...
)}
```

> **Implementation note:** The existing MelodySequencer body may be a large block. Wrap the outermost JSX div of the sequencer body (not the whole return, just the body below the toolbar) with the `crEnabled` conditional. Keep the toolbar with the C&R toggle always visible.

- [ ] **Step 2: Add scene integration to sceneStore.ts**

Open `src/store/sceneStore.ts`. Add the import at the top with other store imports:

```typescript
import { useMelodyCRStore, type MelodyCRNote, type SynthSettings } from "./melodyCRStore";
```

Add to the `Scene` interface (after `chordPianoNotes?: ChordNote[];`):

```typescript
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
```

In `captureScene`, add after the `chordPianoNotes` line:

```typescript
const crState = useMelodyCRStore.getState();
melodyCR: {
  enabled: crState.enabled,
  barLength: crState.barLength,
  callNotes: deepClone(crState.callNotes),
  responseNotes: deepClone(crState.responseNotes),
  callSynth: deepClone(crState.callSynth),
  responseSynth: deepClone(crState.responseSynth),
  rootNote: crState.rootNote,
},
```

> The `melodyCR:` entry goes inside the `scene` object literal, after the `chordPianoNotes` property.

In `loadScene`, add after the `chordPianoNotes` restore block (after line ~320):

```typescript
// Restore Melody C&R state — legacy scenes (undefined) are silently skipped
if (scene.melodyCR !== undefined) {
  const cr = useMelodyCRStore.getState();
  cr.setEnabled(scene.melodyCR.enabled);
  cr.setBarLength(scene.melodyCR.barLength);
  cr.setRootNote(scene.melodyCR.rootNote);
  cr.clearCallNotes();
  cr.clearResponseNotes();
  for (const n of deepClone(scene.melodyCR.callNotes)) cr.addCallNote(n);
  for (const n of deepClone(scene.melodyCR.responseNotes)) cr.addResponseNote(n);
  cr.setCallSynth(deepClone(scene.melodyCR.callSynth));
  cr.setResponseSynth(deepClone(scene.melodyCR.responseSynth));
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Verify dev server starts without console errors**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npm run dev
```

Expected: Server starts on localhost:5173 (or similar). No red errors in terminal.

- [ ] **Step 5: Manual smoke test**

1. Open the app in the browser
2. Click the MELODY tab
3. Confirm C&R OFF/ON toggle is visible in the toolbar
4. Click C&R ON → confirm the inline piano roll appears with CALL / RESPONSE sub-tabs and BARS 1/2/4 selector
5. Click on the piano roll grid → a pink note appears (Call voice)
6. Switch to RESPONSE tab → click on the grid → a green note appears
7. Start transport (Space) → confirm notes play back at the right times
8. Right-click a note → note disappears
9. Drag the right edge of a note → duration changes
10. C&R OFF → original step sequencer reappears

- [ ] **Step 6: Run all tests**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx vitest run
```

Expected: All tests pass (including the melodyCRUtils tests from Task 1).

- [ ] **Step 7: Commit**

```bash
git add src/components/MelodySequencer.tsx src/store/sceneStore.ts
git commit -m "feat: integrate MelodyCR into MELODY tab + scene capture/restore"
```

---

## Done

After all tasks pass: run the full test suite one final time and verify no regressions.

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx vitest run
npx tsc --noEmit
```

Both should exit cleanly.
