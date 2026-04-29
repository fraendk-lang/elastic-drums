# Per-Track Arrangement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scene-chained Arrangement view with a full per-track clip timeline (Drums / Bass / Chords / Melody each get independent rows), enabling complete song production in the browser.

**Architecture:** New `arrangementStore.ts` holds all clips. A new `arrangementScheduler.ts` module subscribes to `drumCurrentStepStore`, counts steps → bars, and hot-swaps the steps/pattern in each instrument store when the active clip changes. `ArrangementView.tsx` gains a mode toggle (SCENE vs CLIPS) and a new `PerTrackArrangement` sub-component for the clip timeline UI.

**Tech Stack:** React 18, Zustand, TypeScript strict, Tailwind, Web Audio API, `useSyncExternalStore`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/store/arrangementStore.ts` | **Create** | All clip data + CRUD actions + `getActiveClip` |
| `src/audio/arrangementScheduler.ts` | **Create** | Bar-boundary listener; swaps clips into instrument stores |
| `src/store/drumStore.ts` | **Modify** | Add `arrangementMode`, `arrangementSilence` flags |
| `src/components/ArrangementView.tsx` | **Modify** | Mode toggle + new `PerTrackArrangement` sub-component (render + interactions) |
| `src/components/BassSequencer.tsx` | **Modify** | `+ Arrangement` capture button |
| `src/components/ChordsSequencer.tsx` | **Modify** | `+ Arrangement` capture button |
| `src/components/MelodySequencer.tsx` | **Modify** | `+ Arrangement` capture button |
| `src/components/StepSequencer.tsx` | **Modify** | `+ Arrangement` capture button |
| `src/App.tsx` | **Modify** | Side-effect import of `arrangementScheduler` |

---

## Task 1: `src/store/arrangementStore.ts` — Types + Store

**Files:**
- Create: `src/store/arrangementStore.ts`

- [ ] **Step 1: Write the file**

```typescript
/**
 * arrangementStore — per-track clip timeline
 *
 * Each of the 4 instrument tracks has its own row of non-overlapping clips.
 * Clips carry their own step data (always) and optional synth param snapshots.
 * A gap between clips = silence for that track.
 */

import { create } from "zustand";
import type { PatternData } from "./drumStore";
import type { BassStep, BassParams } from "../audio/BassEngine";
import type { ChordsStep, ChordsParams } from "../audio/ChordsEngine";
import type { MelodyStep, MelodyParams } from "../audio/MelodyEngine";

// ─── Track IDs ────────────────────────────────────────────────────────────────

export type ArrangementTrackId = "drums" | "bass" | "chords" | "melody";

// ─── Per-track clip data ──────────────────────────────────────────────────────

export interface DrumClipData {
  kind: "drums";
  pattern: PatternData;
}

export interface BassClipData {
  kind: "bass";
  steps: BassStep[];
  length: number;
  params?: BassParams;
}

export interface ChordsClipData {
  kind: "chords";
  steps: ChordsStep[];
  length: number;
  params?: ChordsParams;
}

export interface MelodyClipData {
  kind: "melody";
  steps: MelodyStep[];
  length: number;
  params?: MelodyParams;
}

export type ArrangementClipData =
  | DrumClipData
  | BassClipData
  | ChordsClipData
  | MelodyClipData;

// ─── Clip ─────────────────────────────────────────────────────────────────────

export interface ArrangementClip {
  id: string;
  trackId: ArrangementTrackId;
  startBar: number;    // 0-indexed; 1 bar = 16 drum steps
  lengthBars: number;  // visual length; clip loops internally if pattern < lengthBars
  name: string;
  color?: string;      // hex override; falls back to track default
  data: ArrangementClipData;
}

// ─── Store ───────────────────────────────────────────────────────────────────

let _nextId = 1;
function newId(): string { return `ac_${_nextId++}`; }

/** Returns true if [aStart, aStart+aLen) overlaps [bStart, bStart+bLen) */
function overlaps(aStart: number, aLen: number, bStart: number, bLen: number): boolean {
  return aStart < bStart + bLen && aStart + aLen > bStart;
}

interface ArrangementState {
  clips: ArrangementClip[];
  totalBars: number;

  // ── Mutations ────────────────────────────────────────────────────────────
  /** Returns new clip id, or null if it would overlap an existing clip */
  addClip: (clip: Omit<ArrangementClip, "id">) => string | null;
  removeClip: (id: string) => void;
  /** Returns false if the new position would cause an overlap */
  moveClip: (id: string, startBar: number) => boolean;
  /** Returns false if the new length would cause an overlap */
  resizeClip: (id: string, lengthBars: number) => boolean;
  renameClip: (id: string, name: string) => void;
  setClipColor: (id: string, color: string) => void;
  updateClipData: (id: string, data: ArrangementClipData) => void;

  // ── Read helpers ─────────────────────────────────────────────────────────
  /** Clip covering `bar` on `trackId`, or null (= gap = silence) */
  getActiveClip: (trackId: ArrangementTrackId, bar: number) => ArrangementClip | null;
  /** True if adding/moving a clip to (trackId, startBar, lengthBars) would overlap */
  wouldOverlap: (trackId: ArrangementTrackId, startBar: number, lengthBars: number, excludeId?: string) => boolean;
}

export const useArrangementStore = create<ArrangementState>((set, get) => ({
  clips: [],
  totalBars: 16,

  addClip(clip) {
    if (get().wouldOverlap(clip.trackId, clip.startBar, clip.lengthBars)) return null;
    const id = newId();
    const newClip: ArrangementClip = { ...clip, id };
    const endBar = clip.startBar + clip.lengthBars;
    set((s) => ({
      clips: [...s.clips, newClip],
      totalBars: Math.max(s.totalBars, endBar + 4),
    }));
    return id;
  },

  removeClip(id) {
    set((s) => ({ clips: s.clips.filter((c) => c.id !== id) }));
  },

  moveClip(id, startBar) {
    const clip = get().clips.find((c) => c.id === id);
    if (!clip) return false;
    if (startBar < 0) return false;
    if (get().wouldOverlap(clip.trackId, startBar, clip.lengthBars, id)) return false;
    const endBar = startBar + clip.lengthBars;
    set((s) => ({
      clips: s.clips.map((c) => c.id === id ? { ...c, startBar } : c),
      totalBars: Math.max(s.totalBars, endBar + 4),
    }));
    return true;
  },

  resizeClip(id, lengthBars) {
    const clip = get().clips.find((c) => c.id === id);
    if (!clip) return false;
    if (lengthBars < 1) return false;
    if (get().wouldOverlap(clip.trackId, clip.startBar, lengthBars, id)) return false;
    const endBar = clip.startBar + lengthBars;
    set((s) => ({
      clips: s.clips.map((c) => c.id === id ? { ...c, lengthBars } : c),
      totalBars: Math.max(s.totalBars, endBar + 4),
    }));
    return true;
  },

  renameClip(id, name) {
    set((s) => ({ clips: s.clips.map((c) => c.id === id ? { ...c, name } : c) }));
  },

  setClipColor(id, color) {
    set((s) => ({ clips: s.clips.map((c) => c.id === id ? { ...c, color } : c) }));
  },

  updateClipData(id, data) {
    set((s) => ({ clips: s.clips.map((c) => c.id === id ? { ...c, data } : c) }));
  },

  getActiveClip(trackId, bar) {
    return get().clips.find(
      (c) => c.trackId === trackId && bar >= c.startBar && bar < c.startBar + c.lengthBars
    ) ?? null;
  },

  wouldOverlap(trackId, startBar, lengthBars, excludeId) {
    return get().clips.some(
      (c) => c.trackId === trackId
          && c.id !== excludeId
          && overlaps(startBar, lengthBars, c.startBar, c.lengthBars)
    );
  },
}));
```

- [ ] **Step 2: TypeCheck**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors from the new file.

- [ ] **Step 3: Commit**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
git add src/store/arrangementStore.ts
git commit -m "feat: add arrangementStore with per-track clip CRUD and overlap guard"
```

---

## Task 2: `src/store/drumStore.ts` — Add arrangement flags

**Files:**
- Modify: `src/store/drumStore.ts`

The drum scheduler reads `pattern` and `arrangementSilence` freshly from the store on every tick. We need two new boolean fields:
- `arrangementMode` — true when the per-track arrangement timeline is active
- `arrangementSilence` — true when the drums track has no active clip (gap = silence)

- [ ] **Step 1: Add fields to DrumState interface**

Find the `DrumState` interface (look for `songMode: SongMode`) and add after it:

```typescript
  arrangementMode: boolean;
  arrangementSilence: boolean;
  setArrangementMode: (on: boolean) => void;
  setArrangementSilence: (v: boolean) => void;
```

- [ ] **Step 2: Add default values + actions in `create()`**

Find `songMode: "pattern",` in the `create(…)` block and add below it:

```typescript
  arrangementMode: false,
  arrangementSilence: false,
  setArrangementMode: (on) => set({ arrangementMode: on }),
  setArrangementSilence: (v) => set({ arrangementSilence: v }),
```

- [ ] **Step 3: Silence drums during gaps**

In the scheduler step loop, find the block that starts with:
```typescript
      const hasSolo = activePattern.tracks.some((t) => t?.solo);
```

Insert **before** that line:

```typescript
      // Arrangement mode: skip all voice triggers during gaps (silence = no active clip)
      if (useDrumStore.getState().arrangementSilence) {
        // Advance step counter, then continue without triggering any voices
        setDrumStep(nextStep, nextStepTime);
        nextStepTime += stepDuration;
        continue;
      }
```

Wait — the step advance happens AFTER the voice loop. The correct insertion point is right after:
```typescript
      // Advance step
      const nextStep = (currentStep + 1) % activePattern.length;
```

…actually the silence check should be placed BEFORE the voice-trigger loop. Locate the line:

```
      const hasSolo = activePattern.tracks.some((t) => t?.solo);
```

Insert **immediately above** it:

```typescript
      // Arrangement gap = silence: advance clock but trigger no voices
      if (useDrumStore.getState().arrangementSilence) {
        setDrumStep((currentStep + 1) % activePattern.length, nextStepTime);
        nextStepTime += stepDuration;
        continue;
      }
```

Note: `setDrumStep` is already called at the end of the loop body — the `continue` skips that call, so we advance the step here manually.

- [ ] **Step 4: TypeCheck**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/store/drumStore.ts
git commit -m "feat(drumStore): add arrangementMode + arrangementSilence flags"
```

---

## Task 3: `src/audio/arrangementScheduler.ts` — Bar-boundary clip applier

**Files:**
- Create: `src/audio/arrangementScheduler.ts`

This module subscribes to `drumCurrentStepStore` (fires every drum step) and counts to 16 → 1 arrangement bar. At each bar it reads the active clip for each of the 4 tracks and swaps the steps/params into the respective store if the clip has changed.

Key design decisions:
- 1 arrangement bar = 16 drum steps (= 1 musical measure)
- Silence for bass/chords/melody = set `steps` to all-inactive steps (existing schedulers naturally produce no notes)
- Silence for drums = set `arrangementSilence: true` in drumStore (scheduler skips triggers)
- Baseline params are captured when arrangementMode is first enabled; restored on clip→gap transitions

- [ ] **Step 1: Write the file**

```typescript
/**
 * arrangementScheduler — bar-boundary clip applier
 *
 * Subscribes to drumCurrentStepStore (fires every drum step).
 * Every 16 steps = 1 arrangement bar.
 * Reads active clips from arrangementStore and hot-swaps steps/params
 * into the four instrument stores.
 *
 * Import this module once for its side effects (from App.tsx).
 */

import { drumCurrentStepStore, useDrumStore } from "../store/drumStore";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";
import { useArrangementStore, type ArrangementTrackId } from "../store/arrangementStore";
import { bassEngine, type BassParams, DEFAULT_BASS_PARAMS } from "./BassEngine";
import { chordsEngine, type ChordsParams, DEFAULT_CHORDS_PARAMS } from "./ChordsEngine";
import { melodyEngine, type MelodyParams, DEFAULT_MELODY_PARAMS } from "./MelodyEngine";

// ─── Module state ─────────────────────────────────────────────────────────────

let _stepsElapsed = 0;
let _arrangementBar = 0;

/** Last clip ID applied per track (null = gap was last applied) */
const _lastClipId: Record<ArrangementTrackId, string | null> = {
  drums: null, bass: null, chords: null, melody: null,
};

/** Baseline params captured when arrangementMode turns on */
let _baselineBassParams: BassParams | null = null;
let _baselineChordsParams: ChordsParams | null = null;
let _baselineMelodyParams: MelodyParams | null = null;

/** Whether the previously-active clip for each melodic track had params */
const _prevClipHadParams: Record<"bass" | "chords" | "melody", boolean> = {
  bass: false, chords: false, melody: false,
};

// ─── Silence helpers ──────────────────────────────────────────────────────────

function makeSilentBassSteps(count = 64) {
  return Array.from({ length: count }, () => ({
    active: false, note: 0, octave: 0, accent: false,
    velocity: 0.82, slide: false, tie: false, gateLength: 1,
  }));
}

function makeSilentChordsSteps(count = 64) {
  return Array.from({ length: count }, () => ({
    active: false, note: 0, chordType: "maj" as const,
    octave: 0, accent: false, velocity: 0.82, tie: false, gateLength: 1,
  }));
}

function makeSilentMelodySteps(count = 64) {
  return Array.from({ length: count }, () => ({
    active: false, note: 0, octave: 0, accent: false,
    velocity: 0.82, slide: false, tie: false, gateLength: 1,
  }));
}

// ─── Apply a single bar ───────────────────────────────────────────────────────

function applyArrangementBar(bar: number): void {
  const store = useArrangementStore.getState();

  // ── DRUMS ──────────────────────────────────────────────────────────────────
  const drumClip = store.getActiveClip("drums", bar);
  const drumClipId = drumClip?.id ?? null;
  if (drumClipId !== _lastClipId.drums) {
    _lastClipId.drums = drumClipId;
    if (drumClip && drumClip.data.kind === "drums") {
      useDrumStore.setState({
        arrangementSilence: false,
        pattern: structuredClone(drumClip.data.pattern),
      });
    } else {
      // Gap → silence
      useDrumStore.setState({ arrangementSilence: true });
    }
  }

  // ── BASS ───────────────────────────────────────────────────────────────────
  const bassClip = store.getActiveClip("bass", bar);
  const bassClipId = bassClip?.id ?? null;
  if (bassClipId !== _lastClipId.bass) {
    _lastClipId.bass = bassClipId;
    if (bassClip && bassClip.data.kind === "bass") {
      const { steps, length, params } = bassClip.data;
      useBassStore.setState({ steps: structuredClone(steps), length });
      if (params) {
        useBassStore.setState({ params: structuredClone(params) });
        bassEngine.setParams(params);
        _prevClipHadParams.bass = true;
      } else {
        _prevClipHadParams.bass = false;
      }
    } else {
      // Gap → silence
      useBassStore.setState({ steps: makeSilentBassSteps(), length: 16 });
      if (_prevClipHadParams.bass && _baselineBassParams) {
        useBassStore.setState({ params: structuredClone(_baselineBassParams) });
        bassEngine.setParams(_baselineBassParams);
      }
      _prevClipHadParams.bass = false;
    }
  }

  // ── CHORDS ─────────────────────────────────────────────────────────────────
  const chordsClip = store.getActiveClip("chords", bar);
  const chordsClipId = chordsClip?.id ?? null;
  if (chordsClipId !== _lastClipId.chords) {
    _lastClipId.chords = chordsClipId;
    if (chordsClip && chordsClip.data.kind === "chords") {
      const { steps, length, params } = chordsClip.data;
      useChordsStore.setState({ steps: structuredClone(steps), length });
      if (params) {
        useChordsStore.setState({ params: structuredClone(params) });
        chordsEngine.setParams(params);
        _prevClipHadParams.chords = true;
      } else {
        _prevClipHadParams.chords = false;
      }
    } else {
      useChordsStore.setState({ steps: makeSilentChordsSteps(), length: 16 });
      if (_prevClipHadParams.chords && _baselineChordsParams) {
        useChordsStore.setState({ params: structuredClone(_baselineChordsParams) });
        chordsEngine.setParams(_baselineChordsParams);
      }
      _prevClipHadParams.chords = false;
    }
  }

  // ── MELODY ─────────────────────────────────────────────────────────────────
  const melodyClip = store.getActiveClip("melody", bar);
  const melodyClipId = melodyClip?.id ?? null;
  if (melodyClipId !== _lastClipId.melody) {
    _lastClipId.melody = melodyClipId;
    if (melodyClip && melodyClip.data.kind === "melody") {
      const { steps, length, params } = melodyClip.data;
      useMelodyStore.setState({ steps: structuredClone(steps), length });
      if (params) {
        useMelodyStore.setState({ params: structuredClone(params) });
        melodyEngine.setParams(params);
        _prevClipHadParams.melody = true;
      } else {
        _prevClipHadParams.melody = false;
      }
    } else {
      useMelodyStore.setState({ steps: makeSilentMelodySteps(), length: 16 });
      if (_prevClipHadParams.melody && _baselineMelodyParams) {
        useMelodyStore.setState({ params: structuredClone(_baselineMelodyParams) });
        melodyEngine.setParams(_baselineMelodyParams);
      }
      _prevClipHadParams.melody = false;
    }
  }
}

// ─── Reset when arrangement mode turns on/off ─────────────────────────────────

function resetScheduler(): void {
  _stepsElapsed = 0;
  _arrangementBar = 0;
  _lastClipId.drums = null;
  _lastClipId.bass = null;
  _lastClipId.chords = null;
  _lastClipId.melody = null;
  _prevClipHadParams.bass = false;
  _prevClipHadParams.chords = false;
  _prevClipHadParams.melody = false;
}

// ─── Subscribe to arrangement mode changes ────────────────────────────────────

useDrumStore.subscribe((state, prev) => {
  // Arrangement mode just turned ON
  if (state.arrangementMode && !prev.arrangementMode) {
    // Capture baseline params before any clip overrides them
    _baselineBassParams = structuredClone(useBassStore.getState().params);
    _baselineChordsParams = structuredClone(useChordsStore.getState().params);
    _baselineMelodyParams = structuredClone(useMelodyStore.getState().params);
    resetScheduler();
    // Apply bar 0 immediately so the first bar is ready before playback starts
    applyArrangementBar(0);
  }

  // Arrangement mode just turned OFF — clear silence flag
  if (!state.arrangementMode && prev.arrangementMode) {
    useDrumStore.setState({ arrangementSilence: false });
    resetScheduler();
  }

  // Playback stopped while in arrangement mode — reset bar counter
  if (!state.isPlaying && prev.isPlaying && state.arrangementMode) {
    resetScheduler();
    applyArrangementBar(0);
  }
});

// ─── Main step counter ────────────────────────────────────────────────────────

drumCurrentStepStore.subscribe(() => {
  if (!useDrumStore.getState().arrangementMode) return;
  if (!useDrumStore.getState().isPlaying) return;

  _stepsElapsed++;
  // 1 arrangement bar = 16 drum steps
  if (_stepsElapsed % 16 === 0) {
    _arrangementBar = Math.floor(_stepsElapsed / 16);
    applyArrangementBar(_arrangementBar);
  }
});
```

- [ ] **Step 2: TypeCheck**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit 2>&1 | head -40
```

Expected: 0 errors. If `useChordsStore` doesn't export `setState` directly (it's a Zustand store so it always does), that's fine. If there are missing exports from engine files, check the correct export names.

Common fixes needed:
- If `chordsEngine.setParams` doesn't exist: check `ChordsEngine.ts` for the correct method name (likely `setParams` or `updateParams`)
- If `melodyEngine.setParams` doesn't exist: same check in `MelodyEngine.ts`
- `DEFAULT_BASS_PARAMS`, `DEFAULT_CHORDS_PARAMS`, `DEFAULT_MELODY_PARAMS` are imported but only used for type context; remove the imports if they cause unused-import errors

- [ ] **Step 3: Commit**

```bash
git add src/audio/arrangementScheduler.ts
git commit -m "feat: add arrangementScheduler — bar-boundary clip applier for per-track arrangement"
```

---

## Task 4: `src/components/ArrangementView.tsx` — Mode toggle + PerTrackArrangement render

**Files:**
- Modify: `src/components/ArrangementView.tsx`

The existing ArrangementView handles the scene-chain view. We add a mode toggle (SCENE | CLIPS) at the top of the view, and when in CLIPS mode, render the new `PerTrackArrangement` component. The scene-chain view is preserved and unchanged.

- [ ] **Step 1: Add imports at the top of ArrangementView.tsx**

After the existing imports, add:

```typescript
import {
  useArrangementStore,
  type ArrangementClip,
  type ArrangementTrackId,
} from "../store/arrangementStore";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";
```

- [ ] **Step 2: Add track color constants**

After the existing `TRACKS` array (around line 38), add:

```typescript
const TRACK_COLORS: Record<ArrangementTrackId, string> = {
  drums:  "#ef4444",  // red-500
  bass:   "#14b8a6",  // teal-500
  chords: "#a855f7",  // purple-500
  melody: "#eab308",  // yellow-500
};

const TRACK_LABELS: Record<ArrangementTrackId, string> = {
  drums:  "DRUMS",
  bass:   "BASS",
  chords: "CHORDS",
  melody: "MELODY",
};

const ARR_TRACKS: ArrangementTrackId[] = ["drums", "bass", "chords", "melody"];

const ARR_TRACK_H = 44;  // px per track row
const ARR_LABEL_W = 72;  // px for track name label
```

- [ ] **Step 3: Add PerTrackArrangement component (render only, no interactions yet)**

Add this component just before the `export function ArrangementView` declaration:

```typescript
// ─── PerTrackArrangement ──────────────────────────────────────────────────────

interface PerTrackArrangementProps {
  barPx: number;
  currentBar: number;
}

function PerTrackArrangement({ barPx, currentBar }: PerTrackArrangementProps) {
  const { clips, totalBars } = useArrangementStore();
  const timelineW = totalBars * barPx;

  return (
    <div className="flex flex-col" style={{ minWidth: ARR_LABEL_W + timelineW }}>
      {/* Bar ruler */}
      <div
        className="flex items-center border-b border-white/10 bg-black/20 sticky top-0 z-10 shrink-0"
        style={{ height: RULER_H, paddingLeft: ARR_LABEL_W }}
      >
        {Array.from({ length: totalBars }, (_, i) => (
          <div
            key={i}
            className="text-[9px] text-white/40 font-mono shrink-0 border-l border-white/10 pl-1"
            style={{ width: barPx, lineHeight: `${RULER_H}px` }}
          >
            {i + 1}
          </div>
        ))}
        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-px bg-red-500/80 pointer-events-none"
          style={{ left: ARR_LABEL_W + currentBar * barPx }}
        />
      </div>

      {/* Track rows */}
      {ARR_TRACKS.map((trackId) => {
        const color = TRACK_COLORS[trackId];
        const trackClips = clips.filter((c) => c.trackId === trackId);

        return (
          <div
            key={trackId}
            className="flex relative border-b border-white/10"
            style={{ height: ARR_TRACK_H }}
          >
            {/* Label */}
            <div
              className="flex items-center shrink-0 border-r border-white/10 px-2"
              style={{ width: ARR_LABEL_W, borderLeft: `3px solid ${color}` }}
            >
              <span className="text-[9px] font-black" style={{ color }}>
                {TRACK_LABELS[trackId]}
              </span>
            </div>

            {/* Timeline area */}
            <div className="relative overflow-hidden" style={{ width: timelineW, height: ARR_TRACK_H }}>
              {/* Empty track background */}
              <div className="absolute inset-0 bg-black/10" />

              {/* Clips */}
              {trackClips.map((clip) => (
                <PerTrackClip
                  key={clip.id}
                  clip={clip}
                  barPx={barPx}
                  color={clip.color ?? color}
                  height={ARR_TRACK_H}
                />
              ))}

              {/* Playhead line */}
              <div
                className="absolute top-0 bottom-0 w-px bg-red-500/60 pointer-events-none"
                style={{ left: currentBar * barPx }}
              />
            </div>
          </div>
        );
      })}

      {/* Phase 2 placeholder rows */}
      {["LOOPS", "SAMPLER"].map((label) => (
        <div
          key={label}
          className="flex relative border-b border-white/5 opacity-30"
          style={{ height: 36 }}
        >
          <div
            className="flex items-center shrink-0 border-r border-white/5 px-2"
            style={{ width: ARR_LABEL_W, borderLeft: "3px solid #555" }}
          >
            <span className="text-[9px] font-black text-white/40">{label}</span>
          </div>
          <div className="flex items-center px-2 text-[9px] text-white/20">
            Phase 2
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── PerTrackClip ─────────────────────────────────────────────────────────────

interface PerTrackClipProps {
  clip:   ArrangementClip;
  barPx:  number;
  color:  string;
  height: number;
}

function PerTrackClip({ clip, barPx, color, height }: PerTrackClipProps) {
  const x = clip.startBar * barPx;
  const w = Math.max(8, clip.lengthBars * barPx - 1);

  return (
    <div
      className="absolute top-0.5 bottom-0.5 rounded overflow-hidden select-none"
      style={{
        left:            x,
        width:           w,
        backgroundColor: hexAlpha(color, 0.22),
        border:          `1px solid ${hexAlpha(color, 0.5)}`,
      }}
    >
      <span
        className="text-[8px] font-bold px-1 truncate block leading-none pt-1"
        style={{ color: hexAlpha(color, 0.9) }}
      >
        {clip.name}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Wire the mode toggle into ArrangementView**

Inside `ArrangementView`, add the mode toggle state and use it. Find where the main JSX starts (the outer `div` of the view) and add:

1. Near the top of the `ArrangementView` function body, after existing useState declarations, add:
```typescript
  const [arrViewMode, setArrViewMode] = useState<"scene" | "clips">("scene");
  const { arrangementMode, setArrangementMode, isPlaying } = useDrumStore(
    (s) => ({ arrangementMode: s.arrangementMode, setArrangementMode: s.setArrangementMode, isPlaying: s.isPlaying })
  );
  // Track current arrangement bar for playhead
  const currentBar = useArrangementStore((s) => {
    // Derived from playhead: count how many bars into arrangement we are
    // arrangementScheduler owns the counter; we expose it via a store field later.
    // For now, use 0 as a placeholder — wired properly in Task 7.
    return 0;
  });
```

2. Find the toolbar section (the bar with `ARRANGEMENT` text or the top toolbar) and add mode toggle buttons. Look for where the `zoom −+` buttons are rendered. Add before or after them:

```tsx
  {/* Mode toggle */}
  <div className="flex gap-1 items-center">
    <button
      className={`text-[9px] font-black px-2 py-0.5 rounded transition-colors ${
        arrViewMode === "scene"
          ? "bg-white/15 text-white"
          : "text-white/40 hover:text-white/70"
      }`}
      onClick={() => {
        setArrViewMode("scene");
        setArrangementMode(false);
      }}
    >
      SCENE
    </button>
    <button
      className={`text-[9px] font-black px-2 py-0.5 rounded transition-colors ${
        arrViewMode === "clips"
          ? "bg-white/15 text-white"
          : "text-white/40 hover:text-white/70"
      }`}
      onClick={() => {
        setArrViewMode("clips");
        setArrangementMode(true);
      }}
    >
      CLIPS ✦
    </button>
  </div>
```

3. In the main content area, wrap the existing scene-chain JSX and add the per-track view. The existing scene lanes section should be wrapped conditionally:

```tsx
  {arrViewMode === "scene" ? (
    /* ... existing scene-chain JSX (unchanged) ... */
    <ExistingSceneContent {...existingProps} />
  ) : (
    <PerTrackArrangement barPx={barPx} currentBar={currentBar} />
  )}
```

Where `ExistingSceneContent` represents whatever the existing rendering is. The exact edit depends on the ArrangementView structure — wrap the existing content in `{arrViewMode === "scene" && ( ... )}` and add `{arrViewMode === "clips" && ( ... )}`.

- [ ] **Step 5: TypeCheck**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit 2>&1 | head -40
```

Fix any TypeScript errors before proceeding.

- [ ] **Step 6: Smoke-test in browser**

```bash
npm run dev
```

Open the app, click the Arrangement tab, verify:
- SCENE / CLIPS buttons appear in the toolbar
- Clicking CLIPS shows 4 colored track rows with Phase 2 placeholders below
- Clicking SCENE restores the original scene-chain view
- No console errors

- [ ] **Step 7: Commit**

```bash
git add src/components/ArrangementView.tsx
git commit -m "feat(ArrangementView): add SCENE/CLIPS mode toggle and PerTrackArrangement render"
```

---

## Task 5: `src/components/ArrangementView.tsx` — Clip interactions

**Files:**
- Modify: `src/components/ArrangementView.tsx`

Add the full interaction model to `PerTrackArrangement` + `PerTrackClip`:
- Draw new clip by dragging on empty track area
- Select clip (click)
- Move clip (pointer drag on clip body)
- Resize clip (drag right edge handle)
- Alt+drag to duplicate
- Delete/Backspace key
- Right-click context menu (rename, color, delete)
- Visual overlap warning (red outline when dragging into occupied range)

- [ ] **Step 1: Add interaction state to PerTrackArrangement**

Replace the current `PerTrackArrangement` function with the full interactive version:

```typescript
type DragMode = "move" | "resize" | "draw";

interface DragState {
  mode:       DragMode;
  clipId?:    string;
  trackId:    ArrangementTrackId;
  startX:     number;   // pointer X at drag start (relative to timeline)
  origStart?: number;   // clip.startBar at drag start (for move)
  origLen?:   number;   // clip.lengthBars at drag start (for resize)
  drawStart?: number;   // bar index where draw started
}

function PerTrackArrangement({ barPx, currentBar }: PerTrackArrangementProps) {
  const { clips, totalBars, addClip, moveClip, resizeClip, removeClip, renameClip,
          setClipColor, wouldOverlap } = useArrangementStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; clipId: string;
  } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const timelineW = totalBars * barPx;

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (renaming) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeClip(selectedId);
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, renaming, removeClip]);

  // ── Auto-focus rename input ────────────────────────────────────────────────
  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  // ── Pointer events (global, while dragging) ───────────────────────────────
  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      if (!drag) return;
      const deltaX = e.clientX - drag.startX;
      const deltaBars = Math.round(deltaX / barPx);

      if (drag.mode === "move" && drag.clipId && drag.origStart !== undefined) {
        const newStart = Math.max(0, drag.origStart + deltaBars);
        moveClip(drag.clipId, newStart);
      } else if (drag.mode === "resize" && drag.clipId && drag.origLen !== undefined) {
        const newLen = Math.max(1, drag.origLen + deltaBars);
        resizeClip(drag.clipId, newLen);
      } else if (drag.mode === "draw" && drag.drawStart !== undefined) {
        // Preview draw — handled in onUp
      }
    }
    function onUp(e: PointerEvent) {
      if (drag?.mode === "draw" && drag.drawStart !== undefined) {
        const deltaX = e.clientX - drag.startX;
        const deltaBars = Math.round(deltaX / barPx);
        const lengthBars = Math.max(1, Math.abs(deltaBars) + 1);
        const startBar = deltaBars < 0
          ? Math.max(0, drag.drawStart + deltaBars)
          : drag.drawStart;
        addClip({
          trackId: drag.trackId,
          startBar,
          lengthBars,
          name: `${TRACK_LABELS[drag.trackId]} ${startBar + 1}`,
          data: makeEmptyClipData(drag.trackId),
        });
      }
      setDrag(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, barPx, addClip, moveClip, resizeClip]);

  // ── Context menu handler ──────────────────────────────────────────────────
  function startRename(clipId: string) {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    setRenaming(clipId);
    setRenameValue(clip.name);
    setContextMenu(null);
  }

  function commitRename() {
    if (renaming && renameValue.trim()) renameClip(renaming, renameValue.trim());
    setRenaming(null);
  }

  return (
    <div
      className="flex flex-col"
      style={{ minWidth: ARR_LABEL_W + timelineW }}
      onClick={() => { setSelectedId(null); setContextMenu(null); }}
    >
      {/* Bar ruler */}
      <div
        className="flex items-center border-b border-white/10 bg-black/20 sticky top-0 z-10 shrink-0"
        style={{ height: RULER_H, paddingLeft: ARR_LABEL_W }}
      >
        {Array.from({ length: totalBars }, (_, i) => (
          <div
            key={i}
            className="text-[9px] text-white/40 font-mono shrink-0 border-l border-white/10 pl-1"
            style={{ width: barPx, lineHeight: `${RULER_H}px` }}
          >
            {i + 1}
          </div>
        ))}
        <div
          className="absolute top-0 bottom-0 w-px bg-red-500/80 pointer-events-none"
          style={{ left: ARR_LABEL_W + currentBar * barPx }}
        />
      </div>

      {/* Track rows */}
      {ARR_TRACKS.map((trackId) => {
        const color = TRACK_COLORS[trackId];
        const trackClips = clips.filter((c) => c.trackId === trackId);

        return (
          <div
            key={trackId}
            className="flex relative border-b border-white/10"
            style={{ height: ARR_TRACK_H }}
          >
            {/* Label */}
            <div
              className="flex items-center shrink-0 border-r border-white/10 px-2"
              style={{ width: ARR_LABEL_W, borderLeft: `3px solid ${color}` }}
            >
              <span className="text-[9px] font-black" style={{ color }}>
                {TRACK_LABELS[trackId]}
              </span>
            </div>

            {/* Timeline area */}
            <div
              className="relative overflow-hidden"
              style={{ width: timelineW, height: ARR_TRACK_H, cursor: "crosshair" }}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return; // click on clip, not bg
                const rect = e.currentTarget.getBoundingClientRect();
                const bar = Math.floor((e.clientX - rect.left) / barPx);
                setDrag({
                  mode: "draw", trackId, startX: e.clientX, drawStart: bar,
                });
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
            >
              <div className="absolute inset-0 bg-black/10" />

              {trackClips.map((clip) => (
                <PerTrackClip
                  key={clip.id}
                  clip={clip}
                  barPx={barPx}
                  color={clip.color ?? color}
                  height={ARR_TRACK_H}
                  isSelected={selectedId === clip.id}
                  isRenaming={renaming === clip.id}
                  renameValue={renaming === clip.id ? renameValue : ""}
                  renameRef={renaming === clip.id ? renameRef : undefined}
                  onRenameChange={setRenameValue}
                  onRenameCommit={commitRename}
                  onSelect={(e) => {
                    e.stopPropagation();
                    setSelectedId(clip.id);
                    setContextMenu(null);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedId(clip.id);
                    setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
                  }}
                  onMoveStart={(e) => {
                    e.stopPropagation();
                    setSelectedId(clip.id);
                    if (e.altKey) {
                      // Duplicate then move
                      const newId = addClip({ ...clip, id: "" as unknown as string });
                      if (newId) {
                        setDrag({
                          mode: "move", clipId: newId, trackId,
                          startX: e.clientX, origStart: clip.startBar,
                        });
                      }
                    } else {
                      setDrag({
                        mode: "move", clipId: clip.id, trackId,
                        startX: e.clientX, origStart: clip.startBar,
                      });
                    }
                  }}
                  onResizeStart={(e) => {
                    e.stopPropagation();
                    setSelectedId(clip.id);
                    setDrag({
                      mode: "resize", clipId: clip.id, trackId,
                      startX: e.clientX, origLen: clip.lengthBars,
                    });
                  }}
                />
              ))}

              {/* Playhead line */}
              <div
                className="absolute top-0 bottom-0 w-px bg-red-500/60 pointer-events-none"
                style={{ left: currentBar * barPx }}
              />
            </div>
          </div>
        );
      })}

      {/* Phase 2 placeholder rows */}
      {["LOOPS", "SAMPLER"].map((label) => (
        <div
          key={label}
          className="flex relative border-b border-white/5 opacity-30"
          style={{ height: 36 }}
        >
          <div
            className="flex items-center shrink-0 border-r border-white/5 px-2"
            style={{ width: ARR_LABEL_W, borderLeft: "3px solid #555" }}
          >
            <span className="text-[9px] font-black text-white/40">{label}</span>
          </div>
          <div className="flex items-center px-2 text-[9px] text-white/20">Phase 2</div>
        </div>
      ))}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1a1a1a] border border-white/20 rounded shadow-xl py-1"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: 140 }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            { label: "Rename", action: () => startRename(contextMenu.clipId) },
            { label: "Delete", action: () => { removeClip(contextMenu.clipId); setContextMenu(null); setSelectedId(null); } },
          ].map(({ label, action }) => (
            <button
              key={label}
              className="w-full text-left px-3 py-1 text-[11px] text-white/80 hover:bg-white/10"
              onClick={action}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update PerTrackClip with interaction props**

Replace the existing `PerTrackClip` component with:

```typescript
interface PerTrackClipProps {
  clip:           ArrangementClip;
  barPx:          number;
  color:          string;
  height:         number;
  isSelected:     boolean;
  isRenaming:     boolean;
  renameValue:    string;
  renameRef?:     React.RefObject<HTMLInputElement | null>;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onSelect:       (e: React.MouseEvent) => void;
  onContextMenu:  (e: React.MouseEvent) => void;
  onMoveStart:    (e: React.PointerEvent) => void;
  onResizeStart:  (e: React.PointerEvent) => void;
}

function PerTrackClip({
  clip, barPx, color, height,
  isSelected, isRenaming, renameValue, renameRef,
  onRenameChange, onRenameCommit,
  onSelect, onContextMenu, onMoveStart, onResizeStart,
}: PerTrackClipProps) {
  const x = clip.startBar * barPx;
  const w = Math.max(8, clip.lengthBars * barPx - 1);

  return (
    <div
      className="absolute top-0.5 bottom-0.5 rounded overflow-hidden select-none"
      style={{
        left:            x,
        width:           w,
        backgroundColor: hexAlpha(color, 0.22),
        border:          isSelected
          ? `1px solid ${hexAlpha(color, 0.85)}`
          : `1px solid ${hexAlpha(color, 0.45)}`,
        cursor:          "grab",
      }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onPointerDown={onMoveStart}
    >
      {/* Clip name / rename input */}
      {isRenaming ? (
        <input
          ref={renameRef}
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") onRenameCommit();
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full bg-black/60 border-0 outline-none text-white px-1 text-[8px]"
          style={{ height: "100%" }}
        />
      ) : (
        <span
          className="text-[8px] font-bold px-1 truncate block leading-none pt-1"
          style={{ color: hexAlpha(color, 0.9) }}
        >
          {clip.name}
        </span>
      )}

      {/* Resize handle */}
      <div
        className="absolute top-0 bottom-0 right-0 w-2 cursor-col-resize hover:bg-white/10 z-10"
        onPointerDown={(e) => { e.stopPropagation(); onResizeStart(e); }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
```

- [ ] **Step 3: Add makeEmptyClipData helper** (used in the draw action above)

Add this function just before the `PerTrackArrangement` component:

```typescript
function makeEmptyClipData(trackId: ArrangementTrackId): ArrangementClipData {
  switch (trackId) {
    case "drums":
      return {
        kind: "drums",
        pattern: {
          name: "Arr Clip",
          tracks: Array.from({ length: 12 }, () => ({
            steps: Array.from({ length: 64 }, () => ({
              active: false, velocity: 100, microTiming: 0, probability: 100,
              ratchetCount: 1, condition: "always" as const, gateLength: 1, paramLocks: {},
            })),
            mute: false, solo: false, volume: 100, pan: 0, length: 16,
          })),
          length: 16,
          swing: 50,
        },
      };
    case "bass":
      return {
        kind: "bass",
        steps: Array.from({ length: 64 }, () => ({
          active: false, note: 0, octave: 0, accent: false,
          velocity: 0.82, slide: false, tie: false, gateLength: 1,
        })),
        length: 16,
      };
    case "chords":
      return {
        kind: "chords",
        steps: Array.from({ length: 64 }, () => ({
          active: false, note: 0, chordType: "maj" as const,
          octave: 0, accent: false, velocity: 0.82, tie: false, gateLength: 1,
        })),
        length: 16,
      };
    case "melody":
      return {
        kind: "melody",
        steps: Array.from({ length: 64 }, () => ({
          active: false, note: 0, octave: 0, accent: false,
          velocity: 0.82, slide: false, tie: false, gateLength: 1,
        })),
        length: 16,
      };
  }
}
```

- [ ] **Step 4: TypeCheck**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit 2>&1 | head -40
```

Fix any errors before continuing.

- [ ] **Step 5: Smoke-test interactions**

```bash
npm run dev
```

1. Open Arrangement, switch to CLIPS mode
2. Drag on empty DRUMS row → a new clip appears
3. Click the clip → it gets a colored selection outline
4. Drag the clip left/right → it moves (overlap check works)
5. Drag the right resize handle → clip width changes
6. Right-click a clip → context menu with Rename / Delete
7. Press Delete with clip selected → clip disappears
8. No console errors

- [ ] **Step 6: Commit**

```bash
git add src/components/ArrangementView.tsx
git commit -m "feat(ArrangementView): full clip draw/move/resize/rename/delete interactions"
```

---

## Task 6: Pattern tab `+ Arrangement` capture buttons

**Files:**
- Modify: `src/components/StepSequencer.tsx` (Drums tab toolbar)
- Modify: `src/components/BassSequencer.tsx` (Bass tab toolbar)
- Modify: `src/components/ChordsSequencer.tsx` (Chords tab toolbar)
- Modify: `src/components/MelodySequencer.tsx` (Melody tab toolbar)

Each tab gets a `+ ARRANGEMENT` button in its toolbar. Pressing it:
1. Captures the current pattern/steps as a new `ArrangementClip`
2. Places it at `totalBars - 4` (first gap position) or bar 0 if empty
3. Finds the first open bar on that track and places the clip there

- [ ] **Step 1: Add capture helper to each file (same pattern, 4 files)**

Add this import at the top of each sequencer file:
```typescript
import { useArrangementStore } from "../store/arrangementStore";
```

Then add the capture logic inside each component function. The exact steps per file:

**StepSequencer.tsx (Drums)**

Find the toolbar buttons area (look for existing action buttons). Add:

```tsx
{/* + Arrangement capture */}
<button
  className="text-[9px] font-black px-1.5 py-0.5 rounded border border-white/20 text-white/60
             hover:text-white hover:border-white/40 transition-colors shrink-0"
  title="Capture to Arrangement"
  onClick={() => {
    const { pattern } = useDrumStore.getState();
    const store = useArrangementStore.getState();
    // Find first bar with no drum clip
    let startBar = 0;
    while (store.getActiveClip("drums", startBar) !== null) startBar++;
    store.addClip({
      trackId: "drums",
      startBar,
      lengthBars: Math.ceil(pattern.length / 16),
      name: pattern.name || `Drums ${startBar + 1}`,
      data: { kind: "drums", pattern: structuredClone(pattern) },
    });
  }}
>
  + ARR
</button>
```

**BassSequencer.tsx (Bass)**

Add at the top of the `BassSequencer` component, after the store reads:

```tsx
{/* + Arrangement capture */}
<button
  className="text-[9px] font-black px-1.5 py-0.5 rounded border border-white/20 text-white/60
             hover:text-white hover:border-white/40 transition-colors shrink-0"
  title="Capture to Arrangement"
  onClick={() => {
    const { steps, length, params } = useBassStore.getState();
    const store = useArrangementStore.getState();
    let startBar = 0;
    while (store.getActiveClip("bass", startBar) !== null) startBar++;
    store.addClip({
      trackId: "bass",
      startBar,
      lengthBars: Math.ceil(length / 16) || 1,
      name: `Bass ${startBar + 1}`,
      data: { kind: "bass", steps: structuredClone(steps), length, params: structuredClone(params) },
    });
  }}
>
  + ARR
</button>
```

**ChordsSequencer.tsx (Chords)**

```tsx
{/* + Arrangement capture */}
<button
  className="text-[9px] font-black px-1.5 py-0.5 rounded border border-white/20 text-white/60
             hover:text-white hover:border-white/40 transition-colors shrink-0"
  title="Capture to Arrangement"
  onClick={() => {
    const { steps, length, params } = useChordsStore.getState();
    const store = useArrangementStore.getState();
    let startBar = 0;
    while (store.getActiveClip("chords", startBar) !== null) startBar++;
    store.addClip({
      trackId: "chords",
      startBar,
      lengthBars: Math.ceil(length / 16) || 1,
      name: `Chords ${startBar + 1}`,
      data: { kind: "chords", steps: structuredClone(steps), length, params: structuredClone(params) },
    });
  }}
>
  + ARR
</button>
```

**MelodySequencer.tsx (Melody)**

```tsx
{/* + Arrangement capture */}
<button
  className="text-[9px] font-black px-1.5 py-0.5 rounded border border-white/20 text-white/60
             hover:text-white hover:border-white/40 transition-colors shrink-0"
  title="Capture to Arrangement"
  onClick={() => {
    const { steps, length, params } = useMelodyStore.getState();
    const store = useArrangementStore.getState();
    let startBar = 0;
    while (store.getActiveClip("melody", startBar) !== null) startBar++;
    store.addClip({
      trackId: "melody",
      startBar,
      lengthBars: Math.ceil(length / 16) || 1,
      name: `Melody ${startBar + 1}`,
      data: { kind: "melody", steps: structuredClone(steps), length, params: structuredClone(params) },
    });
  }}
>
  + ARR
</button>
```

- [ ] **Step 2: Verify each sequencer file has the correct store import**

For each file, verify `useBassStore`/`useChordsStore`/`useMelodyStore`/`useDrumStore` is already imported (they will be — these stores are the primary stores for these components). Add only the `useArrangementStore` import.

- [ ] **Step 3: TypeCheck**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: Smoke-test capture buttons**

1. Open Drums tab, program a kick pattern
2. Click `+ ARR` button → switch to Arrangement CLIPS view → a drum clip appears at bar 1
3. Open Bass tab, add a bassline, click `+ ARR` → clip appears in BASS row
4. No duplicate clips overlap (second `+ ARR` press places clip at next free bar)

- [ ] **Step 5: Commit**

```bash
git add src/components/StepSequencer.tsx src/components/BassSequencer.tsx \
        src/components/ChordsSequencer.tsx src/components/MelodySequencer.tsx
git commit -m "feat: add + ARR capture buttons to all four pattern tabs"
```

---

## Task 7: `src/App.tsx` + playhead wiring

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/audio/arrangementScheduler.ts` (add playhead export)
- Modify: `src/components/ArrangementView.tsx` (read playhead bar)

The arrangement scheduler needs to expose the current bar number so the playhead can be rendered correctly in `PerTrackArrangement`. We add a tiny external store (same pattern as `drumCurrentStepStore`) to broadcast the arrangement bar.

- [ ] **Step 1: Export `arrangementBarStore` from arrangementScheduler.ts**

At the top of `arrangementScheduler.ts`, after the imports, add:

```typescript
// ─── Arrangement bar external store (for playhead) ───────────────────────────
const _barListeners = new Set<() => void>();
export const arrangementBarStore = {
  subscribe: (fn: () => void): (() => void) => {
    _barListeners.add(fn);
    return () => _barListeners.delete(fn);
  },
  getSnapshot: (): number => _arrangementBar,
};
```

Then in `applyArrangementBar`, after updating `_arrangementBar`, add:

```typescript
  // Notify playhead subscribers
  for (const fn of _barListeners) fn();
```

Also add it to `resetScheduler()`:
```typescript
  // Notify playhead on reset
  for (const fn of _barListeners) fn();
```

- [ ] **Step 2: Side-effect import in App.tsx**

Find the import block in `src/App.tsx`. Add:

```typescript
// Side-effect: initialise arrangement scheduler (subscribes to drumCurrentStepStore)
import "../audio/arrangementScheduler";
```

Wait — the App is in `src/App.tsx` and the scheduler is at `src/audio/arrangementScheduler.ts`, so the relative path is `./audio/arrangementScheduler`. Add to `App.tsx`:

```typescript
import "./audio/arrangementScheduler";
```

Place it near the other audio imports (after the `BassEngine`, `SendFx` etc. imports).

- [ ] **Step 3: Read arrangement bar in ArrangementView**

In `ArrangementView.tsx`, add the import:

```typescript
import { arrangementBarStore } from "../audio/arrangementScheduler";
```

Replace the placeholder `currentBar` in `PerTrackArrangement`:

```typescript
  // Replace the placeholder useState/derive with:
  const currentBar = useSyncExternalStore(
    arrangementBarStore.subscribe,
    arrangementBarStore.getSnapshot,
  );
```

(The `useSyncExternalStore` import is already present in ArrangementView.tsx from the existing code.)

- [ ] **Step 4: TypeCheck**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit 2>&1 | head -40
```

Expected: 0 errors.

- [ ] **Step 5: End-to-end playback test**

```bash
npm run dev
```

1. Open Drums tab → create a kick pattern → click `+ ARR`
2. Open Bass tab → create a bass line → click `+ ARR`
3. Switch to Arrangement → CLIPS mode
4. Verify both clips appear in correct rows
5. Press PLAY → playhead (red line) moves across the timeline
6. Drum clip active → kick fires correctly
7. When playhead reaches a gap → drums go silent
8. Bass clip active → bass notes play
9. Switch back to SCENE mode during playback → drums switch back to pattern mode
10. No console errors

- [ ] **Step 6: Build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: successful build, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/audio/arrangementScheduler.ts src/components/ArrangementView.tsx
git commit -m "feat: wire arrangementBarStore playhead + App.tsx scheduler init"
```

---

## Self-Review Checklist

**Spec coverage:**

| Spec requirement | Covered in task |
|-----------------|-----------------|
| Per-track clip timeline (4 rows) | Task 4 |
| `ArrangementClip` data model | Task 1 |
| `arrangementStore` CRUD + `getActiveClip` | Task 1 |
| `arrangementMode` flag in drumStore | Task 2 |
| Drum silence in gaps | Tasks 2 + 3 |
| Bass/Chords/Melody silence in gaps | Task 3 |
| Baseline params capture/restore | Task 3 |
| Clip overlap prevention | Task 1 (`wouldOverlap`) |
| SCENE/CLIPS mode toggle | Task 4 |
| Clip draw interaction | Task 5 |
| Clip move interaction | Task 5 |
| Clip resize interaction | Task 5 |
| Alt+drag duplicate | Task 5 |
| Delete/Backspace | Task 5 |
| Right-click context menu (rename, delete) | Task 5 |
| `+ Arrangement` capture buttons | Task 6 |
| Playhead in CLIPS view | Task 7 |
| Phase 2 placeholders (Loops, Sampler) | Task 4 |
| Colored left border per track | Task 4 |
| Bar ruler | Tasks 4 + 5 |

**Not in Phase 1 (per spec):** clip color picker, synth params badge, fade handles, per-clip volume, MIDI export of arrangement.

**Type consistency check:**
- `ArrangementClipData` discriminated by `kind: "drums" | "bass" | "chords" | "melody"` — used consistently in Tasks 1, 3, 5, 6 ✓
- `makeEmptyClipData` returns correct union member for each trackId ✓
- `arrangementScheduler.ts` narrows via `clip.data.kind === "drums"` before accessing `pattern` ✓
- `addClip` returns `string | null` — callers in Task 5 (duplicate) check for null ✓
