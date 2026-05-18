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
    const nextStepT = (i + 1) * grid;
    const tentativeUpT = downT + grid * 0.92;
    const upT = nextStepT >= loopDuration
      ? loopDuration - 1
      : Math.min(tentativeUpT, loopDuration - 1);
    events.push({ t: downT, type: "down", pointerId, x: note.x, y: note.y, velocity: note.velocity });
    events.push({ t: upT,   type: "up",   pointerId, x: note.x, y: note.y, velocity: note.velocity });
  }
  return events;
}
