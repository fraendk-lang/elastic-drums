# Performance Pad — Step Control Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the XY Performance Pad's step-recording mode feel like a real step sequencer — visible step lane, navigable cursor, skip/delete any step — and fix hanging notes in Grid mode.

**Architecture:** Introduce a step-indexed model (`stepNotes: (StepNote|null)[]`) as the source of truth for step mode in `performancePadStore`. The raw `events` array is *derived* from it via a pure function, so the existing loop scheduler and Piano-Roll export keep working unchanged. A new `PerformancePadStepLane` component renders the grid below the XY pad. The Grid stuck-note bug is fixed with `setPointerCapture`.

**Tech Stack:** React 19, TypeScript (strict), Zustand, Vitest 3, Web Audio API.

**Spec:** `docs/superpowers/specs/2026-05-18-performance-pad-step-control-design.md`

---

## File Structure

- **Create** `src/store/performancePadStep.ts` — `StepNote` type + pure helpers (`gridMs`, `stepCountFor`, `stepNotesToEvents`). One responsibility: the step-model maths, fully unit-testable.
- **Create** `src/store/performancePadStep.test.ts` — tests for the pure helpers.
- **Create** `src/store/performancePadStore.test.ts` — tests for the store's step actions.
- **Create** `src/components/PerformancePadStepLane.tsx` — the step-lane UI component.
- **Modify** `src/store/performancePadStore.ts` — step-model state + actions; `events` derived from `stepNotes`.
- **Modify** `src/components/PerformancePad.tsx` — render the lane, route step-mode pad taps to `placeStepNote`, step/bar readout, `setPointerCapture` fix.

---

## Task 1: Pure step-model helpers

**Files:**
- Create: `src/store/performancePadStep.ts`
- Test: `src/store/performancePadStep.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/store/performancePadStep.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gridMs, stepCountFor, stepNotesToEvents, type StepNote } from "./performancePadStep";

describe("gridMs", () => {
  it("1/16 at 120 bpm = 125 ms", () => {
    expect(gridMs("1/16", 120)).toBe(125);
  });
  it("'off' falls back to a 1/16 grid", () => {
    expect(gridMs("off", 120)).toBe(125);
  });
  it("1/4 at 120 bpm = 500 ms", () => {
    expect(gridMs("1/4", 120)).toBe(500);
  });
});

describe("stepCountFor", () => {
  it("a 4000 ms loop at a 125 ms grid = 32 steps", () => {
    expect(stepCountFor(4000, 125)).toBe(32);
  });
  it("never returns less than 1", () => {
    expect(stepCountFor(0, 125)).toBe(1);
  });
});

describe("stepNotesToEvents", () => {
  const n = (x: number): StepNote => ({ x, y: 0.5, velocity: 0.8 });

  it("emits one down/up pair per non-null step", () => {
    const evs = stepNotesToEvents([n(0.2), null, n(0.6)], 125, 2000);
    expect(evs).toHaveLength(4);
    expect(evs.filter((e) => e.type === "down")).toHaveLength(2);
  });
  it("places the down event at stepIndex * grid", () => {
    const evs = stepNotesToEvents([null, null, n(0.5)], 125, 2000);
    expect(evs.find((e) => e.type === "down")!.t).toBe(250);
  });
  it("ends a note at 92% of the grid", () => {
    const evs = stepNotesToEvents([n(0.5)], 125, 2000);
    expect(evs.find((e) => e.type === "up")!.t).toBeCloseTo(115);
  });
  it("ends the final note 92% into its grid step", () => {
    const evs = stepNotesToEvents([null, null, null, n(0.5)], 125, 500);
    expect(evs.find((e) => e.type === "up")!.t).toBe(490);
  });
  it("gives each step a stable unique pointerId", () => {
    const evs = stepNotesToEvents([n(0.1), n(0.2)], 125, 2000);
    expect(new Set(evs.map((e) => e.pointerId)).size).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/store/performancePadStep.test.ts`
Expected: FAIL — `Failed to resolve import "./performancePadStep"`.

- [ ] **Step 3: Write the implementation**

Create `src/store/performancePadStep.ts`:

```ts
/**
 * Performance Pad — step-model maths.
 *
 * Pure, dependency-free helpers shared by the store. The step model is a
 * flat array `(StepNote | null)[]` (one slot per step, null = rest); the
 * loop scheduler still consumes the derived `PadEvent[]` stream.
 */
import type { PadEvent } from "./performancePadStore";

/** A note placed on one step. `x` is the pad X-axis pitch position (0..1). */
export interface StepNote {
  x: number;
  y: number;
  velocity: number;
}

export type Quantize = "off" | "1/4" | "1/8" | "1/16" | "1/32";

/** Milliseconds per step for a quantize grid + tempo. Step mode always needs
 *  a concrete grid, so "off" defaults to 1/16. */
export function gridMs(quantize: Quantize, bpm: number): number {
  const beatMs = 60000 / bpm;
  switch (quantize) {
    case "1/4":  return beatMs;
    case "1/8":  return beatMs / 2;
    case "1/32": return beatMs / 8;
    case "1/16":
    case "off":
    default:     return beatMs / 4;
  }
}

/** How many steps fit in a `loopDuration` ms loop at `grid` ms/step (min 1). */
export function stepCountFor(loopDuration: number, grid: number): number {
  if (grid <= 0) return 1;
  return Math.max(1, Math.round(loopDuration / grid));
}

/** Derive the flat down/up `PadEvent` stream from the step model.
 *  Each note ends at 92% of the grid (a small breathing gap that avoids
 *  setTimeout-order races) and is clamped inside the loop. Each step gets a
 *  stable synthetic negative `pointerId` so playback voices never collide. */
export function stepNotesToEvents(
  stepNotes: (StepNote | null)[],
  grid: number,
  loopDuration: number,
): PadEvent[] {
  const events: PadEvent[] = [];
  for (let i = 0; i < stepNotes.length; i++) {
    const note = stepNotes[i];
    if (!note) continue;
    const pointerId = -1000 - i;
    const downT = i * grid;
    const upT = Math.min(downT + grid * 0.92, loopDuration - 1);
    events.push({ t: downT, type: "down", pointerId, x: note.x, y: note.y, velocity: note.velocity });
    events.push({ t: upT,   type: "up",   pointerId, x: note.x, y: note.y, velocity: note.velocity });
  }
  return events;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/store/performancePadStep.test.ts`
Expected: PASS — all 10 assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/store/performancePadStep.ts src/store/performancePadStep.test.ts
git commit -m "feat(perf-pad): step-model maths helpers"
```

---

## Task 2: Store — step-model state + actions

**Files:**
- Modify: `src/store/performancePadStore.ts`
- Test: `src/store/performancePadStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/store/performancePadStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { usePerformancePadStore } from "./performancePadStore";

const store = () => usePerformancePadStore.getState();

describe("performancePadStore — step model", () => {
  beforeEach(() => {
    store().clearRecording();
    store().setQuantize("1/16");
    store().setLoopBars(1);
    store().startStepRecording(120); // 1 bar @120bpm = 2000ms, 125ms grid → 16 steps
  });

  it("startStepRecording initialises 16 empty steps at cursor 0", () => {
    expect(store().stepNotes).toHaveLength(16);
    expect(store().stepNotes.every((s) => s === null)).toBe(true);
    expect(store().stepCursor).toBe(0);
  });

  it("placeStepNote writes the note and advances the cursor", () => {
    store().placeStepNote({ x: 0.5, y: 0.5, velocity: 0.8 });
    expect(store().stepNotes[0]).toEqual({ x: 0.5, y: 0.5, velocity: 0.8 });
    expect(store().stepCursor).toBe(1);
  });

  it("placeStepNote regenerates the derived events array", () => {
    store().placeStepNote({ x: 0.5, y: 0.5, velocity: 0.8 });
    expect(store().events.filter((e) => e.type === "down")).toHaveLength(1);
  });

  it("the cursor wraps at the end of the loop", () => {
    store().setStepCursor(15);
    store().placeStepNote({ x: 0.5, y: 0.5, velocity: 0.8 });
    expect(store().stepCursor).toBe(0);
  });

  it("skipStep advances the cursor without placing a note", () => {
    store().skipStep();
    expect(store().stepCursor).toBe(1);
    expect(store().stepNotes[0]).toBeNull();
  });

  it("setStepCursor jumps to any step, clamped to range", () => {
    store().setStepCursor(7);
    expect(store().stepCursor).toBe(7);
    store().setStepCursor(999);
    expect(store().stepCursor).toBe(15);
  });

  it("clearStepAt deletes a note at any index", () => {
    store().setStepCursor(4);
    store().placeStepNote({ x: 0.3, y: 0.5, velocity: 0.7 });
    store().clearStepAt(4);
    expect(store().stepNotes[4]).toBeNull();
    expect(store().events).toHaveLength(0);
  });

  it("undoLastStep steps back and clears that step", () => {
    store().placeStepNote({ x: 0.5, y: 0.5, velocity: 0.8 }); // step 0 → cursor 1
    store().undoLastStep();
    expect(store().stepCursor).toBe(0);
    expect(store().stepNotes[0]).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/store/performancePadStore.test.ts`
Expected: FAIL — `placeStepNote is not a function` (and similar for the new actions).

- [ ] **Step 3: Apply the store changes**

**3a.** Add the import near the top of `src/store/performancePadStore.ts`, after the existing `import { useDrumStore } from "./drumStore";` line:

```ts
import { gridMs, stepCountFor, stepNotesToEvents, type StepNote } from "./performancePadStep";
```

**3b.** In the `PerformancePadState` interface, find the `// Recording` block. Replace this line:

```ts
  stepCursorMs: number;     // Current "virtual time" position in step mode (ms from loop start)
```

with:

```ts
  stepNotes: (StepNote | null)[]; // Step-indexed melody — source of truth in step mode (null = rest)
  stepCursor: number;             // Current step index in step mode
  stepGridMs: number;             // ms per step, captured when step recording starts
```

**3c.** In the `// Recording API` block of the interface, replace these three lines:

```ts
  /** Advance the step-record cursor by one grid step WITHOUT placing a note (rest). */
  skipStep: (bpm: number) => void;
  /** Remove the most recent step-recorded note + rewind cursor by one grid step. */
  undoLastStep: (bpm: number) => void;
```

with:

```ts
  /** Place a note at the current step and advance the cursor by one (wraps). */
  placeStepNote: (note: StepNote) => void;
  /** Jump the step cursor to any step index (clamped to range). */
  setStepCursor: (index: number) => void;
  /** Delete the note at any step index. */
  clearStepAt: (index: number) => void;
  /** Advance the step cursor by one WITHOUT placing a note (rest). */
  skipStep: () => void;
  /** Clear the step before the cursor and rewind the cursor onto it. */
  undoLastStep: () => void;
```

**3d.** In the store's initial-state block, replace this line:

```ts
  stepCursorMs: 0,
```

with:

```ts
  stepNotes: [],
  stepCursor: 0,
  stepGridMs: 0,
```

**3e.** Replace the whole `startStepRecording` action with:

```ts
  startStepRecording: (bpm: number) => {
    const s = get();
    if (s.isLooping) s.stopLoop();
    const grid = gridMs(s.quantize, bpm);
    const loopDuration = s.loopBars > 0
      ? s.loopBars * (60000 / bpm) * 4
      : 2 * (60000 / bpm) * 4;
    const count = stepCountFor(loopDuration, grid);
    // Keep an existing pattern if grid + length still match — toggling STEP
    // off/on must not wipe the user's work. Otherwise start fresh.
    const keep = s.stepNotes.length === count && s.stepGridMs === grid;
    const stepNotes = keep ? s.stepNotes : new Array(count).fill(null);
    set({
      isArmed: false,
      isRecording: false,
      isStepRecording: true,
      stepGridMs: grid,
      stepCursor: 0,
      stepNotes,
      recordStart: performance.now(),
      loopDuration,
      events: stepNotesToEvents(stepNotes, grid, loopDuration),
    });
  },
```

**3f.** Replace the whole `clearRecording` action with:

```ts
  clearRecording: () => {
    const s = get();
    if (s.isLooping) s.stopLoop();
    set({
      events: [], loopDuration: 0, isRecording: false, isArmed: false,
      isStepRecording: false, stepNotes: [], stepCursor: 0,
    });
  },
```

**3g.** Replace the whole `skipStep` action and the whole `undoLastStep` action (including their doc comments) with:

```ts
  placeStepNote: (note) => {
    const s = get();
    if (!s.isStepRecording || s.stepNotes.length === 0) return;
    const stepNotes = s.stepNotes.slice();
    stepNotes[s.stepCursor] = note;
    set({
      stepNotes,
      stepCursor: (s.stepCursor + 1) % stepNotes.length,
      events: stepNotesToEvents(stepNotes, s.stepGridMs, s.loopDuration),
    });
  },

  setStepCursor: (index) => {
    const len = get().stepNotes.length;
    if (len === 0) return;
    set({ stepCursor: Math.max(0, Math.min(len - 1, index)) });
  },

  clearStepAt: (index) => {
    const s = get();
    if (index < 0 || index >= s.stepNotes.length) return;
    const stepNotes = s.stepNotes.slice();
    stepNotes[index] = null;
    set({ stepNotes, events: stepNotesToEvents(stepNotes, s.stepGridMs, s.loopDuration) });
  },

  skipStep: () => {
    const s = get();
    if (!s.isStepRecording || s.stepNotes.length === 0) return;
    set({ stepCursor: (s.stepCursor + 1) % s.stepNotes.length });
  },

  undoLastStep: () => {
    const s = get();
    if (!s.isStepRecording || s.stepNotes.length === 0) return;
    const prev = (s.stepCursor - 1 + s.stepNotes.length) % s.stepNotes.length;
    const stepNotes = s.stepNotes.slice();
    stepNotes[prev] = null;
    set({
      stepNotes, stepCursor: prev,
      events: stepNotesToEvents(stepNotes, s.stepGridMs, s.loopDuration),
    });
  },
```

**3h.** Replace the whole `appendEvent` action with the real-time-only version (the step-mode branch is gone — the component calls `placeStepNote` directly):

```ts
  appendEvent: (ev) => {
    const s = get();
    // Step mode places notes via placeStepNote (called from the component);
    // appendEvent only handles real-time (armed) recording.
    if (s.isStepRecording) return;
    // If armed and this is the first event, start recording NOW
    if (s.isArmed && ev.type === "down") {
      const startTime = performance.now();
      set({ isArmed: false, isRecording: true, recordStart: startTime, events: [{ ...ev, t: 0 }] });
      return;
    }
    if (!s.isRecording) return;
    const t = performance.now() - s.recordStart;
    set((state) => ({ events: [...state.events, { ...ev, t }] }));
  },
```

> Note: `stopRecording`'s step branch (`if (s.isStepRecording) { set({ isStepRecording: false }); return; }`) stays as-is — the events are already current.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/store/performancePadStore.test.ts`
Expected: PASS — all 8 assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/store/performancePadStore.ts src/store/performancePadStore.test.ts
git commit -m "feat(perf-pad): step-indexed model as step-mode source of truth"
```

---

## Task 3: Step lane component

**Files:**
- Create: `src/components/PerformancePadStepLane.tsx`

This component has no unit test (pure presentational UI); it is verified in the browser in Task 6.

- [ ] **Step 1: Create the component**

Create `src/components/PerformancePadStepLane.tsx`:

```tsx
/**
 * Performance Pad — Step Lane
 *
 * Horizontal step grid shown below the XY pad in step mode. Tap a cell to
 * move the cursor there (this is how you skip steps — jump past them);
 * long-press or right-click a cell to clear its note.
 */
import { useState, useRef, useCallback } from "react";
import type { StepNote } from "../store/performancePadStep";

const STEPS_PER_PAGE = 16;
const LONG_PRESS_MS = 500;

interface StepLaneProps {
  stepNotes: (StepNote | null)[];
  stepCursor: number;
  /** Currently-sounding step during loop playback, or null when not looping. */
  playheadStep: number | null;
  onStepTap: (index: number) => void;
  onStepClear: (index: number) => void;
}

export function PerformancePadStepLane({
  stepNotes, stepCursor, playheadStep, onStepTap, onStepClear,
}: StepLaneProps) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(stepNotes.length / STEPS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * STEPS_PER_PAGE;
  const pageSteps = stepNotes.slice(pageStart, pageStart + STEPS_PER_PAGE);

  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpFired = useRef(false);

  const startLongPress = useCallback((index: number) => {
    lpFired.current = false;
    lpTimer.current = setTimeout(() => {
      lpFired.current = true;
      onStepClear(index);
    }, LONG_PRESS_MS);
  }, [onStepClear]);

  const cancelLongPress = useCallback(() => {
    if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
  }, []);

  return (
    <div className="px-6 pb-3 select-none">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[8px] text-white/40 tracking-[0.15em] uppercase">Steps</span>
        {pageCount > 1 && (
          <div className="flex gap-1">
            {Array.from({ length: pageCount }, (_, p) => (
              <button key={p} onClick={() => setPage(p)}
                className={`w-4 h-4 text-[8px] rounded ${p === safePage
                  ? "bg-blue-500/40 text-blue-100"
                  : "bg-white/5 text-white/40 hover:bg-white/10"}`}
              >{p + 1}</button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-[2px]">
        {pageSteps.map((note, i) => {
          const index = pageStart + i;
          const isCursor = index === stepCursor;
          const isPlayhead = index === playheadStep;
          const isBeat = index % 4 === 0;
          return (
            <button
              key={index}
              onClick={() => { if (!lpFired.current) onStepTap(index); }}
              onContextMenu={(e) => { e.preventDefault(); onStepClear(index); }}
              onPointerDown={() => startLongPress(index)}
              onPointerUp={cancelLongPress}
              onPointerLeave={cancelLongPress}
              onPointerCancel={cancelLongPress}
              title={`Step ${index + 1}${note ? "" : " (rest)"} — tap to move cursor, long-press to clear`}
              className={`relative flex-1 h-9 rounded-sm flex items-end justify-center transition-colors
                ${note ? "bg-[#1c1c26]" : "bg-[#141420]"}
                ${isBeat ? "border-l border-l-white/20" : ""}
                ${isCursor ? "ring-2 ring-blue-400" : "ring-1 ring-white/10"}
                ${isPlayhead ? "bg-blue-500/25" : ""}`}
            >
              {note && (
                <div className="w-2/3 rounded-[1px] bg-[#f472b6]"
                  style={{ height: `${20 + note.x * 70}%` }} />
              )}
              <span className="absolute top-[1px] left-0 right-0 text-center text-[6px] text-white/25 font-mono">
                {index + 1}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `PerformancePadStepLane.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/PerformancePadStepLane.tsx
git commit -m "feat(perf-pad): step lane component"
```

---

## Task 4: Wire the lane into PerformancePad

**Files:**
- Modify: `src/components/PerformancePad.tsx`

No unit test — verified in the browser in Task 6.

- [ ] **Step 1: Import the lane component**

Near the other component imports at the top of `src/components/PerformancePad.tsx`, add:

```ts
import { PerformancePadStepLane } from "./PerformancePadStepLane";
```

- [ ] **Step 2: Update the store destructuring**

Find the `usePerformancePadStore()` destructuring block (around line 100-108). In the state line, replace `stepCursorMs` with `stepNotes, stepCursor, stepGridMs`. In the actions line, replace `skipStep, undoLastStep` with `placeStepNote, setStepCursor, clearStepAt, skipStep, undoLastStep`. The block becomes:

```ts
  const {
    target, mode, chordSetIndex, yParam, scaleOctaves, scaleLowestOct, gridSnap, trailEnabled, chordFollow, gridRows,
    events, isArmed, isRecording, isStepRecording, stepNotes, stepCursor, stepGridMs, isLooping, loopDuration, loopBars, quantize,
    setTarget, setMode, setChordSetIndex, setYParam, setScaleOctaves, setScaleLowestOct, setGridSnap, setTrailEnabled, setChordFollow, setGridRows,
    armRecording, startStepRecording, stopRecording, clearRecording, placeStepNote, setStepCursor, clearStepAt, skipStep, undoLastStep, appendEvent, setLoopBars, setQuantize,
    startLoop, stopLoop,
    customChordSets, setChordIntervals, resetChordCell,
  } = usePerformancePadStore();
```

- [ ] **Step 3: Add the playhead-step state + tracker**

After the store destructuring and other `useState` hooks near the top of the component, add:

```tsx
  // Step index currently sounding during loop playback (null when not looping).
  const [playheadStep, setPlayheadStep] = useState<number | null>(null);
  useEffect(() => {
    if (!isLooping || stepGridMs <= 0 || loopDuration <= 0) {
      setPlayheadStep(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      const startedAt = usePerformancePadStore.getState().playbackStartTime;
      const elapsed = (performance.now() - startedAt) % loopDuration;
      setPlayheadStep(Math.floor(elapsed / stepGridMs));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isLooping, stepGridMs, loopDuration]);
```

> If `useState`/`useEffect` are not already imported from React at the top of the file, add them to the existing React import.

- [ ] **Step 4: Route step-mode pad taps to placeStepNote**

In `handlePointerDown`, find the final line of the function:

```ts
    appendEvent({ type: "down", pointerId: e.pointerId, x, y, velocity });
```

Replace it with:

```ts
    if (isStepRecording) {
      placeStepNote({ x, y, velocity });
    } else {
      appendEvent({ type: "down", pointerId: e.pointerId, x, y, velocity });
    }
```

In `handlePointerUp`, find:

```ts
    appendEvent({ type: "up", pointerId: e.pointerId, x, y, velocity: voice.velocity });
```

Replace it with:

```ts
    if (!isStepRecording) {
      appendEvent({ type: "up", pointerId: e.pointerId, x, y, velocity: voice.velocity });
    }
```

- [ ] **Step 5: Render the step lane below the XY pad**

Find the closing `</div>` of the XY-pad row — the `<div>` opened with `className="flex-1 flex items-stretch justify-stretch p-6 gap-4 min-h-0"` (around line 1652). Immediately **after** that closing `</div>`, insert:

```tsx
        {(isStepRecording || stepNotes.some((n) => n !== null)) && (
          <PerformancePadStepLane
            stepNotes={stepNotes}
            stepCursor={stepCursor}
            playheadStep={playheadStep}
            onStepTap={setStepCursor}
            onStepClear={clearStepAt}
          />
        )}
```

- [ ] **Step 6: Replace the seconds readout with a step/bar readout**

Find the step-mode cursor readout (around line 1610):

```tsx
            <span className="text-[8px] text-blue-300/70 font-mono">
              {(stepCursorMs / 1000).toFixed(2)}s / {(loopDuration / 1000).toFixed(1)}s
            </span>
```

Replace it with:

```tsx
            <span className="text-[8px] text-blue-300/70 font-mono">
              Step {stepCursor + 1} / {stepNotes.length} · Bar {Math.floor(stepCursor / 4) + 1}.{(stepCursor % 4) + 1}
            </span>
```

- [ ] **Step 7: Drop the `bpm` argument from the SKIP / UNDO buttons**

Find the SKIP and UNDO buttons (around lines 1601-1609). Change `onClick={() => skipStep(bpm)}` to `onClick={skipStep}` and `onClick={() => undoLastStep(bpm)}` to `onClick={undoLastStep}`. Also update the `title` on the STOP STEP button (around line 1599) — replace `` title={`Step recording — cursor at ${(stepCursorMs / 1000).toFixed(2)}s`} `` with `title="Stop step recording"`.

- [ ] **Step 8: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (Any remaining `stepCursorMs` reference is a missed edit — fix it.)

- [ ] **Step 9: Commit**

```bash
git add src/components/PerformancePad.tsx
git commit -m "feat(perf-pad): step lane UI + step/bar readout"
```

---

## Task 5: Grid stuck-note fix

**Files:**
- Modify: `src/components/PerformancePad.tsx`

- [ ] **Step 1: Capture the pointer on pointer-down**

In `handlePointerDown`, find the function-opening line:

```ts
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
```

Immediately after it, insert:

```ts
    // Capture the pointer so pointerup/pointercancel are always delivered to
    // the pad even if the finger/mouse leaves the pad's bounds — otherwise the
    // voice is never released and the note hangs (notably in Grid mode).
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
```

- [ ] **Step 2: Add a lost-capture safety net on the pad element**

Find the pad `<div ref={padRef} ...>` (around line 1660). It already has `onPointerUp={handlePointerUp}` and `onPointerCancel={handlePointerUp}`. Add one more handler line alongside them:

```tsx
          onLostPointerCapture={handlePointerUp}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/PerformancePad.tsx
git commit -m "fix(perf-pad): capture pointer so Grid-mode notes never hang"
```

---

## Task 6: Build + browser verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite + build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds with no TypeScript errors.

- [ ] **Step 2: Verify step control in the browser**

Start the dev server, open the app, click **XY PAD**, then **⏵ STEP**:
- A step lane appears below the XY pad with 16 cells.
- Tapping the pad fills consecutive cells; the cursor (blue ring) advances; the toolbar reads `Step n / 16 · Bar x.y`.
- Tapping a cell further ahead jumps the cursor there (cells in between stay empty = skipped). Tapping the pad then places a note on the jumped-to step.
- Long-press (or right-click) a filled cell — its note clears.
- `↷ SKIP` advances the cursor leaving a rest; `↶ UNDO` clears the previous step and rewinds.
- Press **▶ LOOP** — a playhead highlight runs across the lane in time with the audio.
- **→ PIANO ROLL** export produces the same notes that are shown in the lane.

- [ ] **Step 3: Verify the Grid stuck-note fix**

Switch the pad to **Grid** mode. Press down on a cell and drag the pointer off the pad's edge before releasing — the note must stop when the pointer lifts. Repeat quickly across many cells; no voice should hang. Spot-check notes mode and chords mode too.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "fix(perf-pad): step-control verification fixes"
```

---

## Self-Review notes

- **Spec coverage:** step model (Task 2), derived events (Task 1), step lane UI (Task 3), hybrid navigation — pad-tap places + advances / cell-tap jumps (Tasks 2, 4), skip + delete-any-step (Tasks 2, 4), step/bar readout (Task 4), paging for >16 steps (Task 3), playhead (Task 4), pointer-capture fix (Task 5). All covered.
- **Out of scope** (accent / length / tie / per-step Y) is not implemented — correct.
- **Type consistency:** `StepNote` is defined once in `performancePadStep.ts` and imported everywhere; `placeStepNote`/`setStepCursor`/`clearStepAt`/`skipStep`/`undoLastStep` signatures match between the store interface, implementation, tests, and component call sites.
