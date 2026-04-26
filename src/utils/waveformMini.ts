/**
 * Deterministic waveform bar height generators for arrangement clip mini-previews.
 * All values are normalised 0–1. Inactive steps return 0.
 */

/**
 * Pseudo-random height using a simple LCG seeded by (sceneIndex * 100 + stepIndex).
 * Always returns the same value for the same inputs.
 */
function deterministicHeight(sceneIndex: number, stepIndex: number): number {
  const seed = (sceneIndex * 100 + stepIndex) & 0x7fffffff;
  // LCG constants from Numerical Recipes
  const val = (seed * 1664525 + 1013904223) & 0x7fffffff;
  return 0.3 + (val / 0x7fffffff) * 0.7; // 0.3 – 1.0
}

/** Bar heights for a DRUMS clip. Uses deterministic pseudo-random heights so the
 *  visual pattern is stable across re-renders. */
export function drumWaveformBars(
  steps: ReadonlyArray<{ active: boolean; velocity?: number }>,
  sceneIndex: number,
): number[] {
  return steps.map((step, i) =>
    step.active ? deterministicHeight(sceneIndex, i) : 0
  );
}

/** Bar heights for a BASS clip. Height is proportional to MIDI note (36–84 range). */
export function bassWaveformBars(
  steps: ReadonlyArray<{ active: boolean; note: number; octave?: number }>,
): number[] {
  const MIN_NOTE = 36; // C2
  const MAX_NOTE = 84; // C6
  return steps.map((step) => {
    if (!step.active) return 0;
    const midi = step.note + (step.octave ?? 0) * 12;
    return 0.2 + Math.max(0, Math.min(1, (midi - MIN_NOTE) / (MAX_NOTE - MIN_NOTE))) * 0.8;
  });
}
