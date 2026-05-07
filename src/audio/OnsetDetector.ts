/**
 * OnsetDetector — energy-based transient detection for drum loops.
 *
 * Approach: high-pass the signal (cuts sub-bass rumble that can mask
 * onsets), build an envelope via half-wave-rectified differentiation
 * of windowed RMS, then peak-pick with adaptive thresholding.
 *
 * Tuned for drum content (kicks, snares, hats). Works less well on
 * sustained melodic material — for that, spectral-flux would be better.
 */

export interface OnsetOptions {
  /** Window size in samples for RMS computation. Default ~5ms. */
  windowSize?: number;
  /** Minimum gap between detected onsets in seconds. Default 80ms. */
  minGapSec?: number;
  /** Sensitivity 0..1 — higher detects more onsets. Default 0.5. */
  sensitivity?: number;
}

/**
 * Detect onset times (in seconds) in an AudioBuffer.
 * Returns sorted array of onset times.
 */
export function detectOnsets(buffer: AudioBuffer, opts: OnsetOptions = {}): number[] {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const N = data.length;

  const windowSize = opts.windowSize ?? Math.floor(sr * 0.005); // ~5ms
  const minGapSec = opts.minGapSec ?? 0.08;
  const sensitivity = Math.max(0.05, Math.min(0.95, opts.sensitivity ?? 0.5));

  // ── 1. High-pass filter (one-pole, ~100Hz cutoff) to remove DC + sub-bass
  const filtered = new Float32Array(N);
  const a = 0.995; // ~100Hz @ 44.1kHz
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp = a * lp + (1 - a) * (data[i] ?? 0);
    filtered[i] = (data[i] ?? 0) - lp;
  }

  // ── 2. Compute envelope: RMS over sliding windows
  const numWindows = Math.floor(N / windowSize);
  const env = new Float32Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    let sum = 0;
    const start = w * windowSize;
    for (let i = 0; i < windowSize; i++) {
      const v = filtered[start + i] ?? 0;
      sum += v * v;
    }
    env[w] = Math.sqrt(sum / windowSize);
  }

  // ── 3. Onset detection function: half-wave-rectified derivative
  const odf = new Float32Array(numWindows);
  for (let w = 1; w < numWindows; w++) {
    const diff = (env[w] ?? 0) - (env[w - 1] ?? 0);
    odf[w] = diff > 0 ? diff : 0;
  }

  // ── 4. Adaptive threshold: median × sensitivity-derived multiplier
  // Sort a copy to find median; use 0.7-quantile for less noise sensitivity.
  const sorted = [...odf].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const q70 = sorted[Math.floor(sorted.length * 0.7)] ?? 0;
  const max = sorted[sorted.length - 1] ?? 1;
  // Threshold inverse to sensitivity: high sensitivity → low threshold
  const threshold = Math.max(median * 2, q70) + (1 - sensitivity) * (max - q70) * 0.4;

  // ── 5. Peak-pick with minimum gap
  const minGapWindows = Math.ceil(minGapSec * sr / windowSize);
  const onsets: number[] = [];
  let lastOnsetWindow = -minGapWindows - 1;

  for (let w = 1; w < numWindows - 1; w++) {
    const v = odf[w] ?? 0;
    if (v < threshold) continue;
    // Local maximum check (look 2 windows each side)
    if (v <= (odf[w - 1] ?? 0)) continue;
    if (v <= (odf[w + 1] ?? 0)) continue;
    if (w - lastOnsetWindow < minGapWindows) continue;

    // Refine: locate the peak sample within this window
    const onsetTime = (w * windowSize) / sr;
    onsets.push(onsetTime);
    lastOnsetWindow = w;
  }

  return onsets;
}

/**
 * Snap each onset time to the nearest beat in the project tempo grid,
 * starting from time 0. Returns the snapped beat numbers (integers or
 * half-beats depending on `subdivision`).
 *
 * @param onsetTimes  Onset times in seconds
 * @param projectBpm  Target BPM
 * @param subdivision  Smallest beat division (e.g. 1=quarter, 2=eighth, 4=sixteenth). Default 4.
 */
export function snapOnsetsToBeats(
  onsetTimes: number[],
  projectBpm: number,
  subdivision = 4,
): number[] {
  if (projectBpm <= 0) return [];
  const secondsPerBeat = 60 / projectBpm;
  const stepSec = secondsPerBeat / subdivision;
  return onsetTimes.map(t => Math.round(t / stepSec) / subdivision);
}
