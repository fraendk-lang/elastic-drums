# Performance Pad — Step Control Redesign + Grid Stuck-Note Fix

**Date:** 2026-05-18
**Component:** XY Performance Pad (`PerformancePad.tsx`, `performancePadStore.ts`)

## Context

The XY Performance Pad has a step-recording mode (`⏵ STEP`) where each tap places a
note at a cursor and auto-advances. Two problems:

1. **Step mode doesn't feel like control.** The cursor position is shown only in
   seconds (`0.23s / 4.0s`), there is no visible step grid, and the cursor can only
   move forward. `SKIP`/`UNDO` exist as toolbar buttons but the user flies blind —
   every tap is a leap into the unknown.
2. **Stuck notes in Grid mode.** Notes occasionally hang (keep sounding). When a
   pointer goes down on the pad and moves past the pad's edge before lifting, the
   `pointerup` fires on a different element, so the voice is never released.

Goal: make step mode feel like a real step sequencer — visible grid, clear position,
freely navigable, steps skippable and deletable — and fix the hanging notes.

## Decisions (from brainstorming)

- **Navigation:** Hybrid — a pad tap places a note and auto-advances the cursor;
  tapping any cell in the step lane jumps the cursor to that step.
- **Layout:** A step lane *below* the XY pad. The pad itself is unchanged (tap = pitch
  + expression). The lane is only shown in step mode.
- **Scope:** Lean — per step: note on/off + pitch, jump to any step, skip (rest),
  delete any step. No accent / length / tie / per-step Y-param (future work).

## Architecture

### Data model — explicit step model as source of truth

Today step mode writes raw `events: PadEvent[]` (down/up pairs with ms timestamps and
synthetic negative `pointerId`s). Indexing "step 7" out of that is fragile.

Introduce a step-indexed model in `performancePadStore.ts`:

```ts
interface StepNote { x: number; y: number; velocity: number; }  // x = pitch (0..1)
stepNotes: (StepNote | null)[];   // one slot per step, null = rest
stepCursor: number;               // integer step index (replaces stepCursorMs as the cursor of record)
```

- `stepNotes` is the source of truth in step mode. `null` = rest.
- `events` is **derived** from `stepNotes` whenever it changes (regenerate down/up
  pairs). The existing loop scheduler and `exportToPianoRoll` keep consuming `events`
  unchanged — no scheduler changes needed.
- Step count = `round(loopDuration / grid)`, where `grid` comes from `quantize`
  (default 1/16) and `loopDuration` from `loopBars`. Existing logic in
  `startStepRecording` already sets `loopDuration`.
- Real-time `● REC` mode is untouched — it still writes `events` directly.

### Store API changes (`performancePadStore.ts`)

- Replace the `stepCursorMs`-centric flow with `stepCursor` (integer). Keep an
  internal ms conversion only where the scheduler needs it.
- New/changed actions:
  - `placeStepNote(note: StepNote)` — write `stepNotes[stepCursor]`, advance cursor +1
    (wrap), regenerate `events`.
  - `setStepCursor(index)` — jump cursor (no note placed).
  - `skipStep()` — cursor +1 (wrap), no note.
  - `clearStepAt(index)` — set `stepNotes[index] = null`, regenerate `events`.
  - `undoLastStep()` — remove most-recently-placed note, rewind cursor (kept).
  - `startStepRecording(bpm)` — also initialise `stepNotes` to an empty array of the
    correct length and `stepCursor = 0`.
- `appendEvent` keeps its real-time-REC branch; its step-mode branch is replaced by
  `placeStepNote` called from the component.
- `events` regeneration helper: map each non-null `stepNotes[i]` to a down event at
  `i * grid` and an up event at `i * grid + grid * 0.92`, clamped inside `loopDuration`,
  each with a unique synthetic `pointerId` (same convention as today).

### Step lane UI (`PerformancePad.tsx`)

A new horizontal lane rendered below the XY pad, visible only in step mode
(`isStepRecording` or step content present):

- 16 cells per page; page tabs appear when step count > 16 (mirror the drum
  `StepSequencer` paging pattern).
- Each cell: filled = note (bar height ∝ pitch `x`), empty = rest.
- Current `stepCursor` cell highlighted blue. During loop playback a moving playhead
  highlight tracks the active step.
- Subtle beat dividers every 4 steps; step numbers labelled.
- Toolbar readout changes from seconds to **`Step 5 / 16 · Bar 1.2`**.

### Interactions

| Action | Result |
|--------|--------|
| Tap XY pad (step mode) | place note at `stepCursor`, cursor +1 (wrap) |
| Tap a lane cell | `setStepCursor` to that step — no note placed (this is how you skip: jump past steps) |
| Long-press / right-click a lane cell | `clearStepAt` — delete that step's note |
| `↷ SKIP` button | `skipStep` — cursor +1, no note |
| `↶ UNDO` button | `undoLastStep` |

### Grid stuck-note fix

In `handlePointerDown` (`PerformancePad.tsx`): call
`e.currentTarget.setPointerCapture(e.pointerId)` so all subsequent events for that
pointer — including `pointerup` — are delivered to the pad even if the pointer leaves
the element. Add an `onLostPointerCapture` handler on the pad that routes to
`handlePointerUp` as a safety net. This releases the voice reliably in all modes
(notes / chords / grid).

## Files affected

- `src/store/performancePadStore.ts` — step model, regenerate-events helper, action changes
- `src/components/PerformancePad.tsx` — step lane component, pad-tap → `placeStepNote`,
  toolbar readout, `setPointerCapture` + `onLostPointerCapture`

## Out of scope

- Per-step accent, note length / tie, per-step Y-parameter capture.
- Real-time `● REC` mode behaviour (unchanged).

## Verification

1. **Step control:** open XY PAD → `⏵ STEP`. Lane appears below the pad. Tap the pad a
   few times — notes fill consecutive cells, cursor advances, readout shows
   `Step n / 16`. Tap a cell further ahead — cursor jumps there (skips). Tap the pad —
   note lands on the jumped-to step. Long-press a filled cell — note clears. Press
   `▶ LOOP` — playhead runs across the lane, audio matches the grid.
2. **Stuck-note fix:** in Grid mode, press down on a pad cell and drag the pointer off
   the pad edge before releasing — the note must stop when the pointer lifts. Repeat
   rapidly across many cells; no voice should hang. Check the same in notes/chords mode.
3. `npm run build` is green; existing `melodyLayerScheduler` tests still pass.
4. Loop playback and `→ PIANO ROLL` export still produce correct notes from a
   step-recorded pattern.
