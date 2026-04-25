/**
 * Slicer Engine — Transient detection + slice-to-pads
 *
 * detectTransients():
 *   Energy-flux onset detection (spectral flux on short-time energy).
 *   1. Mix to mono
 *   2. Compute RMS in overlapping windows
 *   3. Half-wave-rectified first difference (energy flux)
 *   4. Adaptive threshold: median + sensitivity × k × MAD
 *   5. Return peaks as normalised positions [0 … 1]
 *
 * sliceEqual():
 *   Divide [start, end] into N equal segments.
 *   Returns N normalised start positions.
 */

const HOP_SIZE    = 256;  // samples between analysis frames
const WINDOW_SIZE = 512;  // samples per RMS window
const MIN_GAP_MS  = 60;   // minimum ms between two slices

// ── Transient detection ──────────────────────────────────────────────────────

/**
 * Detect transient positions in an AudioBuffer.
 *
 * @param buffer      - decoded AudioBuffer to analyse
 * @param sensitivity - 0 (fewer hits) → 1 (maximum sensitivity)
 * @param startSec    - region start in seconds (default: 0)
 * @param endSec      - region end in seconds   (default: buffer.duration)
 * @returns sorted array of onset times in seconds, always including startSec
 */
export function detectTransients(
  buffer: AudioBuffer,
  sensitivity: number = 0.55,
  startSec = 0,
  endSec   = buffer.duration,
): number[] {
  const sr      = buffer.sampleRate;
  const nCh     = buffer.numberOfChannels;
  const startSmp = Math.floor(startSec  * sr);
  const endSmp   = Math.floor(endSec    * sr);
  const len      = endSmp - startSmp;

  if (len < WINDOW_SIZE * 2) return [startSec];

  // ── Mix to mono (slice the relevant region) ──────────────────────────────
  const mono = new Float32Array(len);
  for (let ch = 0; ch < nCh; ch++) {
    const raw = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      mono[i] = (mono[i] ?? 0) + (raw[startSmp + i] ?? 0) / nCh;
    }
  }

  // ── RMS energy per hop ───────────────────────────────────────────────────
  const frameCount = Math.ceil(len / HOP_SIZE);
  const energy     = new Float32Array(frameCount);

  for (let f = 0; f < frameCount; f++) {
    const s0 = f * HOP_SIZE;
    let sum  = 0;
    const limit = Math.min(s0 + WINDOW_SIZE, len);
    for (let i = s0; i < limit; i++) sum += (mono[i]!) ** 2;
    energy[f] = Math.sqrt(sum / (limit - s0 || 1));
  }

  // ── Half-wave-rectified energy flux ─────────────────────────────────────
  const flux = new Float32Array(frameCount);
  for (let f = 1; f < frameCount; f++) {
    flux[f] = Math.max(0, (energy[f]!) - (energy[f - 1]!));
  }

  // ── Adaptive threshold (median + k * MAD) ───────────────────────────────
  const sorted  = Float32Array.from(flux).sort();
  const median  = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const mad     = (() => {
    const devs = Float32Array.from(flux, v => Math.abs(v - median)).sort();
    return devs[Math.floor(devs.length / 2)] ?? 0.001;
  })();
  // k: sensitivity 0→high threshold (fewer), 1→low threshold (more)
  const k         = 6 - sensitivity * 5;   // k ∈ [1, 6]
  const threshold = median + k * mad;

  // ── Peak-picking with minimum gap ────────────────────────────────────────
  const minGapFrames = Math.ceil(MIN_GAP_MS * sr / 1000 / HOP_SIZE);
  const onsets: number[] = [startSec];
  let lastFrame = -minGapFrames;

  for (let f = 1; f < frameCount - 1; f++) {
    if (
      (flux[f]!) > threshold &&
      (flux[f]!) > (flux[f - 1]!) &&
      (flux[f]!) >= (flux[f + 1]!) &&
      f - lastFrame >= minGapFrames
    ) {
      const timeSec = startSec + (f * HOP_SIZE) / sr;
      onsets.push(timeSec);
      lastFrame = f;
    }
  }

  return onsets;
}

// ── Equal-division slicer ────────────────────────────────────────────────────

/**
 * Divide a region into N equal slices.
 *
 * @param count    - number of slices (typically 4, 8, or 16)
 * @param startSec - region start (default 0)
 * @param endSec   - region end   (default buffer.duration)
 * @returns array of `count` onset times in seconds
 */
export function sliceEqual(
  count: number,
  startSec = 0,
  endSec   = 1,
): number[] {
  const dur = endSec - startSec;
  return Array.from({ length: count }, (_, i) => startSec + (i / count) * dur);
}

// ── Convert onset times → normalised [0,1] pad regions ──────────────────────

export interface SliceRegion {
  startPoint: number; // 0–1 normalised to buffer.duration
  endPoint:   number; // 0–1 normalised to buffer.duration
  startSec:   number;
  endSec:     number;
}

/**
 * Convert an array of onset times (seconds) into pad slice regions.
 * Up to `maxPads` regions are returned; onsets beyond that are merged
 * into the last slice.
 *
 * @param onsets     - sorted onset times in seconds (first onset = start of first slice)
 * @param duration   - total AudioBuffer duration in seconds
 * @param endSec     - end of the last slice (often loopEnd or buffer.duration)
 * @param maxPads    - maximum number of slices to return (default 16)
 */
export function onsetsToRegions(
  onsets: number[],
  duration: number,
  endSec: number,
  maxPads = 16,
): SliceRegion[] {
  const pts  = onsets.slice(0, maxPads);
  const regs: SliceRegion[] = [];

  for (let i = 0; i < pts.length; i++) {
    const s = Math.max(0, pts[i]!);
    const e = Math.min(duration, i + 1 < pts.length ? pts[i + 1]! : endSec);
    regs.push({
      startPoint: Math.min(1, Math.max(0, s / duration)),
      endPoint:   Math.min(1, Math.max(0, e / duration)),
      startSec:   s,
      endSec:     e,
    });
  }

  return regs;
}
