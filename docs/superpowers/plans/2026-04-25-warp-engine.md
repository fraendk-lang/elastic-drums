# Warp Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a professional 3-mode Warp Engine (RE-PITCH / BEATS / COMPLEX) to the Loop Player so pitch and tempo can be controlled independently at DAW quality.

**Architecture:** RE-PITCH uses raw `playbackRate` (vinyl, instant). BEATS uses existing SoundTouch WSOLA offline processing (good for drums). COMPLEX uses a new Phase Vocoder offline processor (better for melodic content). All modes share a `pitchedBuffer` pipeline; the mode determines which algorithm fills it. BPM sync remains via `AudioBufferSourceNode.playbackRate` in all modes.

**Tech Stack:** TypeScript, Web Audio API, SoundTouch.js (WSOLA, already installed), custom Cooley-Tukey Phase Vocoder (new), React/Zustand, Vite.

---

## File Map

| File | Role |
|------|------|
| `src/audio/phaseVocoderShift.ts` | **CREATE** — Cooley-Tukey FFT + Phase Vocoder offline pitch shift |
| `src/audio/pitchShiftBuffer.ts` | **MODIFY** — Add `mode` param; route to SoundTouch or PV |
| `src/audio/LoopPlayerEngine.ts` | **MODIFY** — `_calcRate` accepts `pitchFactor` (for RE-PITCH vinyl effect) |
| `src/store/loopPlayerStore.ts` | **MODIFY** — Add `warpMode`, `setWarpMode`; RE-PITCH skips offline processing |
| `src/utils/resetAll.ts` | **MODIFY** — Add `warpMode: 'beats'` to empty slot |
| `src/components/LoopPlayerTab.tsx` | **MODIFY** — REPITCH/BEATS/COMPLEX buttons + cleaner transpose UX |

---

## Task 1: Phase Vocoder Engine (`phaseVocoderShift.ts`)

**Files:**
- Create: `src/audio/phaseVocoderShift.ts`

The Phase Vocoder pitch-shifts audio without changing tempo. Algorithm:
1. Slice input into overlapping frames (Hann-windowed, 2048 samples, 75% overlap)
2. FFT each frame → magnitude + phase per bin
3. Compute "true frequency" from frame-to-frame phase difference
4. Remap bins by `pitchFactor` (e.g. ×1.059 for +1 semitone)
5. Accumulate synthesis phases
6. IFFT + overlap-add → output

- [ ] **Step 1: Create the file with FFT utility**

```typescript
/**
 * phaseVocoderShift — offline pitch shifting via Phase Vocoder
 *
 * Shifts pitch without changing tempo. Better quality than WSOLA for
 * melodic content (synths, chords). Uses Cooley-Tukey radix-2 FFT.
 *
 * Algorithm: analysis (FFT) → bin remapping by pitchFactor → synthesis (IFFT + OLA)
 */

const PV_FRAME   = 2048;          // FFT frame size (must be power of 2)
const PV_OVERLAP = 4;             // 75% overlap
const PV_HOP     = PV_FRAME / PV_OVERLAP; // 512 samples per hop
const TWO_PI     = 2 * Math.PI;

// ── Hann window (precomputed, shared across calls) ──────────────────────
const _hann = new Float64Array(PV_FRAME);
for (let i = 0; i < PV_FRAME; i++) {
  _hann[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / (PV_FRAME - 1)));
}

// ── Cooley-Tukey radix-2 in-place FFT ───────────────────────────────────
// re[] = real part, im[] = imaginary part (both Float64Array of length 2^n)
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const ang  = -TWO_PI / len;
    const wRe  = Math.cos(ang);
    const wIm  = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let uRe = 1, uIm = 0;
      for (let j = 0; j < (len >> 1); j++) {
        const k   = i + j + (len >> 1);
        const vRe = re[k] * uRe - im[k] * uIm;
        const vIm = re[k] * uIm + im[k] * uRe;
        re[k] = re[i + j] - vRe;
        im[k] = im[i + j] - vIm;
        re[i + j] += vRe;
        im[i + j] += vIm;
        const newU = uRe * wRe - uIm * wIm;
        uIm        = uRe * wIm + uIm * wRe;
        uRe        = newU;
      }
    }
  }
}

// Inverse FFT (conjugate → FFT → conjugate + scale)
function ifft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < im.length; i++) im[i] = -im[i];
  fft(re, im);
  const n = re.length;
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
}
```

- [ ] **Step 2: Add the single-channel phase vocoder function**

Append to the same file:

```typescript
// ── Single-channel Phase Vocoder pitch shift ─────────────────────────────
// Returns a new Float32Array of the same length as `input`, pitch-shifted.
function pvShiftChannel(input: Float32Array, pitchFactor: number): Float32Array {
  const len       = input.length;
  const numFrames = Math.max(1, Math.floor((len - PV_FRAME) / PV_HOP) + 1);
  const outLen    = numFrames * PV_HOP + PV_FRAME;
  const output    = new Float64Array(outLen);
  const normAcc   = new Float64Array(outLen); // overlap-added window squares for normalization

  // Per-bin state (reset per call — no shared state between calls)
  const lastPhase  = new Float64Array(PV_FRAME);
  const synthPhase = new Float64Array(PV_FRAME);

  const re = new Float64Array(PV_FRAME);
  const im = new Float64Array(PV_FRAME);

  for (let frame = 0; frame < numFrames; frame++) {
    const inOff = frame * PV_HOP;

    // 1. Extract + apply Hann window
    for (let i = 0; i < PV_FRAME; i++) {
      re[i] = (input[inOff + i] ?? 0) * _hann[i];
      im[i] = 0;
    }

    // 2. FFT
    fft(re, im);

    // 3. Compute magnitude and true frequency for each positive bin
    const mag      = new Float64Array(PV_FRAME);
    const trueFreq = new Float64Array(PV_FRAME);
    for (let k = 0; k < PV_FRAME / 2; k++) {
      mag[k]           = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const phase      = Math.atan2(im[k], re[k]);
      const expected   = (TWO_PI * k * PV_HOP) / PV_FRAME;
      let   delta      = phase - lastPhase[k] - expected;
      // Wrap phase difference to [-π, π]
      delta           -= TWO_PI * Math.round(delta / TWO_PI);
      trueFreq[k]      = (TWO_PI * k) / PV_FRAME + delta / PV_HOP;
      lastPhase[k]     = phase;
    }

    // 4. Pitch-shift: remap bins by pitchFactor
    //    Output bin k reads from source bin k/pitchFactor (linear interpolation)
    const outRe = new Float64Array(PV_FRAME);
    const outIm = new Float64Array(PV_FRAME);
    for (let k = 0; k < PV_FRAME / 2; k++) {
      const srcBin = k / pitchFactor;
      const srcLo  = Math.floor(srcBin);
      const frac   = srcBin - srcLo;
      if (srcLo < 0 || srcLo >= PV_FRAME / 2 - 1) continue;

      // Interpolated magnitude
      const m  = mag[srcLo] * (1 - frac) + mag[srcLo + 1] * frac;
      // Interpolated true frequency, scaled to output bin's frequency range
      const tf = (trueFreq[srcLo] * (1 - frac) + trueFreq[srcLo + 1] * frac) * pitchFactor;

      // Accumulate synthesis phase
      synthPhase[k] += tf * PV_HOP;

      // Reconstruct complex coefficient
      outRe[k] = m * Math.cos(synthPhase[k]);
      outIm[k] = m * Math.sin(synthPhase[k]);

      // Mirror for real output (conjugate symmetry)
      if (k > 0 && PV_FRAME - k < PV_FRAME) {
        outRe[PV_FRAME - k] = outRe[k];
        outIm[PV_FRAME - k] = -outIm[k];
      }
    }

    // 5. IFFT
    ifft(outRe, outIm);

    // 6. Overlap-add (windowed synthesis)
    const outOff = frame * PV_HOP;
    for (let i = 0; i < PV_FRAME; i++) {
      output[outOff + i]   += outRe[i] * _hann[i];
      normAcc[outOff + i]  += _hann[i] * _hann[i];
    }
  }

  // 7. Normalize by sum-of-squared-windows to reconstruct amplitude
  const result = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = normAcc[i] > 1e-8 ? (output[i] / normAcc[i]) : 0;
  }
  return result;
}
```

- [ ] **Step 3: Add the exported async entry point**

Append to the same file:

```typescript
// ── Public API ───────────────────────────────────────────────────────────

/**
 * Pitch-shift an AudioBuffer by `semitones` half-steps, preserving tempo.
 * Uses a Phase Vocoder (better than WSOLA for melodic/harmonic content).
 *
 * @param buffer    Source AudioBuffer
 * @param semitones Pitch offset in semitones (integer recommended, ±24 max)
 * @returns New AudioBuffer with shifted pitch, same approximate duration
 */
export async function phaseVocoderShift(
  buffer: AudioBuffer,
  semitones: number,
): Promise<AudioBuffer> {
  if (Math.abs(semitones) < 0.01) return buffer;

  const pitchFactor = Math.pow(2, semitones / 12);
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const { sampleRate, length } = buffer;

  // Process each channel (synchronous, CPU-bound — runs on main thread)
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(pvShiftChannel(buffer.getChannelData(c), pitchFactor));
  }

  // Wrap in AudioBuffer via OfflineAudioContext
  const offCtx = new OfflineAudioContext(numChannels, length, sampleRate);
  const out    = offCtx.createBuffer(numChannels, length, sampleRate);
  for (let c = 0; c < numChannels; c++) {
    out.copyToChannel(channels[c]!, c);
  }
  return out;
}
```

- [ ] **Step 4: Verify file compiles**

```bash
cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
npx tsc --noEmit 2>&1
```

Expected: no errors related to `phaseVocoderShift.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/audio/phaseVocoderShift.ts
git commit -m "feat(warp): add Phase Vocoder offline pitch shifter with Cooley-Tukey FFT"
```

---

## Task 2: Route `pitchShiftBuffer` to Mode-Specific Algorithm

**Files:**
- Modify: `src/audio/pitchShiftBuffer.ts`

Add a `mode` parameter so the store can choose algorithm by warp mode.
BEATS → SoundTouch WSOLA (existing). COMPLEX → Phase Vocoder (new).

- [ ] **Step 1: Replace the entire file**

```typescript
/**
 * pitchShiftBuffer — offline pitch shifting dispatcher
 *
 * Routes to the correct algorithm based on warp mode:
 *   'beats'   → SoundTouch WSOLA  (good for rhythmic/transient content)
 *   'complex' → Phase Vocoder     (good for melodic/sustained content)
 *
 * Both modes preserve tempo (duration ≈ unchanged).
 * BPM sync is applied separately via AudioBufferSourceNode.playbackRate.
 */

import { SoundTouch, SimpleFilter, WebAudioBufferSource } from "soundtouchjs";
import { phaseVocoderShift } from "./phaseVocoderShift";

export type WarpMode = "repitch" | "beats" | "complex";

const CHUNK_SIZE = 8192;

// ── SoundTouch WSOLA (beats mode) ────────────────────────────────────────

async function soundTouchShift(buffer: AudioBuffer, semitones: number): Promise<AudioBuffer> {
  const { sampleRate, length } = buffer;

  const st           = new SoundTouch(sampleRate);
  st.pitchSemiTones  = semitones;
  st.tempo           = 1.0;

  const src      = new WebAudioBufferSource(buffer);
  const filter   = new SimpleFilter(src, st);

  const maxFrames   = length + CHUNK_SIZE * 4;
  const interleaved = new Float32Array(maxFrames * 2);
  let   totalFrames = 0;

  while (totalFrames < maxFrames) {
    const chunk  = new Float32Array(CHUNK_SIZE * 2);
    const frames = filter.extract(chunk, CHUNK_SIZE);
    if (frames === 0) break;
    const needed = totalFrames * 2 + frames * 2;
    if (needed > interleaved.length) break;
    interleaved.set(chunk.subarray(0, frames * 2), totalFrames * 2);
    totalFrames += frames;
  }

  if (totalFrames === 0) return buffer;

  const numCh  = Math.min(buffer.numberOfChannels, 2);
  const offCtx = new OfflineAudioContext(numCh, totalFrames, sampleRate);
  const out    = offCtx.createBuffer(numCh, totalFrames, sampleRate);

  const L = out.getChannelData(0);
  const R = numCh > 1 ? out.getChannelData(1) : null;
  for (let i = 0; i < totalFrames; i++) {
    L[i] = interleaved[i * 2]     ?? 0;
    if (R) R[i] = interleaved[i * 2 + 1] ?? 0;
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Pitch-shift an AudioBuffer offline. Mode determines algorithm quality.
 * 'repitch' is never called here — RE-PITCH bypasses offline processing entirely.
 */
export async function pitchShiftBuffer(
  buffer: AudioBuffer,
  semitones: number,
  mode: WarpMode = "beats",
): Promise<AudioBuffer> {
  if (Math.abs(semitones) < 0.01) return buffer;
  if (mode === "repitch")         return buffer; // RE-PITCH: handled by playbackRate

  return mode === "complex"
    ? phaseVocoderShift(buffer, semitones)
    : soundTouchShift(buffer, semitones);
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/audio/pitchShiftBuffer.ts
git commit -m "feat(warp): route BEATS→SoundTouch, COMPLEX→PhaseVocoder in pitchShiftBuffer"
```

---

## Task 3: LoopPlayerEngine — RE-PITCH pitch factor in playback rate

**Files:**
- Modify: `src/audio/LoopPlayerEngine.ts`

In RE-PITCH mode the pitch IS applied via `playbackRate` (vinyl effect).
Rename `_transpose` parameter to `pitchFactor` (1.0 for BEATS/COMPLEX, `2^(st/12)` for RE-PITCH).

- [ ] **Step 1: Update `_calcRate`**

Replace:
```typescript
  private _calcRate(originalBpm: number, globalBpm: number, _transpose = 0): number {
    // NOTE: transpose is NOT applied to playbackRate — changing rate would alter
    // tempo and break BPM sync. Real pitch shifting (without tempo change) requires
    // a phase vocoder / WSOLA AudioWorklet — planned as a future enhancement.
    const raw = originalBpm > 0 ? globalBpm / originalBpm : 1;
    return Math.max(0.1, Math.min(4, raw));
  }
```

With:
```typescript
  /**
   * Compute AudioBufferSourceNode playbackRate.
   *
   * @param originalBpm  Native BPM of the audio file
   * @param globalBpm    Current project BPM
   * @param pitchFactor  1.0 for BEATS/COMPLEX (pitch handled offline),
   *                     2^(semitones/12) for RE-PITCH (vinyl — changes both pitch & tempo)
   */
  private _calcRate(originalBpm: number, globalBpm: number, pitchFactor = 1): number {
    const bpmRatio = originalBpm > 0 ? globalBpm / originalBpm : 1;
    return Math.max(0.1, Math.min(8, bpmRatio * pitchFactor));
  }
```

- [ ] **Step 2: Update `startSlot` signature — rename param**

Replace the `transpose = 0` parameter with `pitchFactor = 1`:

```typescript
  startSlot(
    slotIdx: number,
    buffer: AudioBuffer,
    originalBpm: number,
    globalBpm: number,
    volume: number,
    startTime: number,
    loopStartSeconds?: number,
    loopEndSeconds?: number,
    pitchFactor = 1,
  ): void {
```

(No other change in the body — `_calcRate` is already called with the last param.)

- [ ] **Step 3: Update `updatePlaybackRate` signature**

Replace `transpose = 0` with `pitchFactor = 1`:

```typescript
  updatePlaybackRate(slotIdx: number, originalBpm: number, globalBpm: number, pitchFactor = 1): void {
    const source = this.sources[slotIdx];
    if (!source || !this.ctx) return;
    const rate = this._calcRate(originalBpm, globalBpm, pitchFactor);
    source.playbackRate.setValueAtTime(rate, this.ctx.currentTime);
  }
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/audio/LoopPlayerEngine.ts
git commit -m "feat(warp): LoopPlayerEngine accepts pitchFactor for RE-PITCH vinyl mode"
```

---

## Task 4: Store — Add `warpMode` + `setWarpMode`, update `setTranspose`

**Files:**
- Modify: `src/store/loopPlayerStore.ts`

Key changes:
- `LoopSlotState` gets `warpMode: WarpMode` (default `'beats'`)
- `setWarpMode(idx, mode)`: changes mode, re-processes pitch if transpose ≠ 0
- `setTranspose`: for RE-PITCH skips offline processing, just updates rate
- `_launchSlot`: passes correct `pitchFactor` to engine based on mode

- [ ] **Step 1: Add WarpMode import**

At the top of `loopPlayerStore.ts`, find the existing `pitchShiftBuffer` import and replace it:

```typescript
import { pitchShiftBuffer, type WarpMode } from "../audio/pitchShiftBuffer";
```

- [ ] **Step 2: Add `warpMode` to `LoopSlotState`**

Replace:
```typescript
  transpose:        number;      // semitone offset (integer, −24…+24)
  pitchedBuffer:    AudioBuffer | null; // SoundTouch-processed buffer (pitch shifted, same tempo)
  pitching:         boolean;     // true while SoundTouch is processing
```

With:
```typescript
  transpose:        number;      // semitone offset (integer, −24…+24)
  warpMode:         WarpMode;    // 'repitch' | 'beats' | 'complex'
  pitchedBuffer:    AudioBuffer | null; // offline-processed buffer (BEATS/COMPLEX only)
  pitching:         boolean;     // true while offline processing runs
```

- [ ] **Step 3: Add `setWarpMode` to the `LoopPlayerStore` interface**

After `setTranspose`:
```typescript
  setWarpMode       (idx: number, mode: WarpMode): void;
```

- [ ] **Step 4: Add `warpMode: 'beats'` to `createDefaultSlot`**

```typescript
function createDefaultSlot(): LoopSlotState {
  return {
    buffer:          null,
    fileName:        "",
    duration:        0,
    originalBpm:     120,
    volume:          0.8,
    playing:         false,
    transpose:       0,
    warpMode:        "beats",
    pitchedBuffer:   null,
    pitching:        false,
    analyzing:       false,
    detectedBpm:     null,
    firstBeatOffset: 0,
    loopEndSeconds:  0,
  };
}
```

- [ ] **Step 5: Update `_launchSlot` to compute `pitchFactor`**

Replace the existing `_launchSlot` function with:

```typescript
/** Compute the AudioBufferSourceNode pitchFactor for a slot.
 *  RE-PITCH: vinyl (both tempo+pitch via rate). BEATS/COMPLEX: 1.0 (pitch in buffer). */
function _pitchFactor(slot: LoopSlotState): number {
  return slot.warpMode === "repitch" ? Math.pow(2, slot.transpose / 12) : 1;
}

function _launchSlot(idx: number, slot: LoopSlotState): void {
  if (!slot.buffer) return;
  const globalBpm = useDrumStore.getState().bpm;
  const startTime = _nextBarTime();

  // RE-PITCH: play original buffer at rate that includes pitch factor
  // BEATS/COMPLEX: play pitchedBuffer (offline-processed) at pure BPM rate
  const playBuffer = (slot.warpMode !== "repitch" && slot.pitchedBuffer && slot.transpose !== 0)
    ? slot.pitchedBuffer
    : slot.buffer;

  const loopStart = slot.firstBeatOffset;
  const loopEnd   = slot.loopEndSeconds > loopStart ? slot.loopEndSeconds : undefined;

  loopPlayerEngine.startSlot(
    idx,
    playBuffer,
    slot.originalBpm,
    globalBpm,
    slot.volume,
    startTime,
    loopStart,
    loopEnd,
    _pitchFactor(slot),
  );
}
```

- [ ] **Step 6: Update `setTranspose` action**

Replace the existing `setTranspose` action with:

```typescript
  // ── Transpose ──────────────────────────────────────────────────────────
  setTranspose: (idx, semitones) => {
    const clamped = Math.max(-24, Math.min(24, Math.round(semitones)));
    const slot    = useLoopPlayerStore.getState().slots[idx]!;
    if (!slot.buffer) return;

    // RE-PITCH: no offline processing — just update playback rate immediately
    if (slot.warpMode === "repitch") {
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, transpose: clamped };
        return { slots };
      });
      const { bpm: globalBpm } = useDrumStore.getState();
      loopPlayerEngine.updatePlaybackRate(idx, slot.originalBpm, globalBpm, Math.pow(2, clamped / 12));
      return;
    }

    // Reset to 0: clear pitched buffer, use original
    if (clamped === 0) {
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, transpose: 0, pitchedBuffer: null, pitching: false };
        return { slots };
      });
      const updated = useLoopPlayerStore.getState().slots[idx]!;
      if (updated.playing && !updated.analyzing) _launchSlot(idx, updated);
      return;
    }

    // BEATS/COMPLEX: offline pitch processing
    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, transpose: clamped, pitching: true };
      return { slots };
    });

    pitchShiftBuffer(slot.buffer, clamped, slot.warpMode).then((pitched) => {
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, pitchedBuffer: pitched, pitching: false };
        return { slots };
      });
      const updated = useLoopPlayerStore.getState().slots[idx]!;
      if (updated.playing && !updated.analyzing) _launchSlot(idx, updated);
    }).catch(() => {
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, pitching: false, pitchedBuffer: null };
        return { slots };
      });
    });
  },
```

- [ ] **Step 7: Add `setWarpMode` action** (after `setTranspose`):

```typescript
  // ── Warp Mode ──────────────────────────────────────────────────────────
  // Switching mode re-processes pitch with the new algorithm when transpose ≠ 0.
  setWarpMode: (idx, mode) => {
    const slot = useLoopPlayerStore.getState().slots[idx]!;
    if (!slot.buffer) {
      // No buffer yet — just store the preference
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, warpMode: mode };
        return { slots };
      });
      return;
    }

    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, warpMode: mode };
      return { slots };
    });

    const updated = useLoopPlayerStore.getState().slots[idx]!;

    if (mode === "repitch") {
      // Clear offline buffer — pitch now via playbackRate
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, pitchedBuffer: null, pitching: false };
        return { slots };
      });
      const { bpm: globalBpm } = useDrumStore.getState();
      loopPlayerEngine.updatePlaybackRate(
        idx, updated.originalBpm, globalBpm, Math.pow(2, updated.transpose / 12),
      );
      return;
    }

    // BEATS or COMPLEX: if transpose ≠ 0, re-process with new algorithm
    if (updated.transpose !== 0) {
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, pitching: true };
        return { slots };
      });
      pitchShiftBuffer(updated.buffer!, updated.transpose, mode).then((pitched) => {
        set((s) => {
          const slots = [...s.slots];
          slots[idx] = { ...slots[idx]!, pitchedBuffer: pitched, pitching: false };
          return { slots };
        });
        const final = useLoopPlayerStore.getState().slots[idx]!;
        if (final.playing && !final.analyzing) _launchSlot(idx, final);
      }).catch(() => {
        set((s) => {
          const slots = [...s.slots];
          slots[idx] = { ...slots[idx]!, pitching: false };
          return { slots };
        });
      });
    }
  },
```

- [ ] **Step 8: Update BPM subscription to pass correct pitchFactor**

Find the BPM-change branch of the transport subscription:

```typescript
  } else if (state.bpm !== prev.bpm) {
    // BPM changed → update playback rate of all active slots
    slots.forEach((slot, idx) => {
      if (slot.playing) {
        loopPlayerEngine.updatePlaybackRate(idx, slot.originalBpm, globalBpm, slot.transpose);
      }
    });
  }
```

Replace with:
```typescript
  } else if (state.bpm !== prev.bpm) {
    slots.forEach((slot, idx) => {
      if (slot.playing) {
        loopPlayerEngine.updatePlaybackRate(idx, slot.originalBpm, globalBpm, _pitchFactor(slot));
      }
    });
  }
```

- [ ] **Step 9: Update `setOriginalBpm` call**

Find:
```typescript
    loopPlayerEngine.updatePlaybackRate(idx, bpm, globalBpm, get().slots[idx]!.transpose);
```

Replace with:
```typescript
    const s = get().slots[idx]!;
    loopPlayerEngine.updatePlaybackRate(idx, bpm, globalBpm, _pitchFactor({ ...s, originalBpm: bpm }));
```

- [ ] **Step 10: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/store/loopPlayerStore.ts
git commit -m "feat(warp): add warpMode state, setWarpMode action, mode-aware setTranspose"
```

---

## Task 5: Update `resetAll.ts`

**Files:**
- Modify: `src/utils/resetAll.ts`

- [ ] **Step 1: Add `warpMode` to the empty slot factory**

Find `createEmptyLoopSlot` in `src/utils/resetAll.ts`. It currently looks like:

```typescript
function createEmptyLoopSlot(): LoopSlotState {
  return {
    buffer:          null,
    fileName:        "",
    duration:        0,
    originalBpm:     120,
    volume:          0.8,
    playing:         false,
    transpose:       0,
    pitchedBuffer:   null,
    pitching:        false,
    analyzing:       false,
    detectedBpm:     null,
    firstBeatOffset: 0,
    loopEndSeconds:  0,
  };
}
```

Replace with:

```typescript
function createEmptyLoopSlot(): LoopSlotState {
  return {
    buffer:          null,
    fileName:        "",
    duration:        0,
    originalBpm:     120,
    volume:          0.8,
    playing:         false,
    transpose:       0,
    warpMode:        "beats",
    pitchedBuffer:   null,
    pitching:        false,
    analyzing:       false,
    detectedBpm:     null,
    firstBeatOffset: 0,
    loopEndSeconds:  0,
  };
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/resetAll.ts
git commit -m "fix: add warpMode to resetAll empty loop slot"
```

---

## Task 6: UI — Warp Mode Buttons + Clean Transpose UX

**Files:**
- Modify: `src/components/LoopPlayerTab.tsx`

Add `setWarpMode` selector. Replace the PITCH section with mode buttons + cleaner transpose controls. The mode buttons (REPITCH / BEATS / COMPLEX) appear before the transpose nudge buttons.

- [ ] **Step 1: Add `setWarpMode` to the store selectors in `LoopSlot`**

Find the block of `useLoopPlayerStore` selectors (around line 191–201):

```typescript
  const setTranspose       = useLoopPlayerStore((s) => s.setTranspose);
  const togglePlay         = useLoopPlayerStore((s) => s.togglePlay);
```

Insert after `setTranspose`:

```typescript
  const setWarpMode        = useLoopPlayerStore((s) => s.setWarpMode);
```

- [ ] **Step 2: Replace the entire PITCH section in Row 3**

Find the existing PITCH/transpose block (starts with `{/* Transpose — SoundTouch offline pitch shift`). Replace it entirely with:

```tsx
          {/* Warp Mode + Transpose */}
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Mode selector */}
            <span className="text-[6px] font-bold text-white/20 mr-0.5">WARP</span>
            {(["repitch", "beats", "complex"] as const).map((m) => {
              const labels: Record<string, string> = { repitch: "RE-PITCH", beats: "BEATS", complex: "COMPLEX" };
              const isActive = slot.warpMode === m;
              return (
                <button
                  key={m}
                  onClick={() => setWarpMode(slotIndex, m)}
                  disabled={slot.pitching}
                  className="text-[6px] font-bold px-1.5 py-0.5 rounded transition-all"
                  style={{
                    background: isActive ? `rgba(46,196,182,0.20)` : "rgba(255,255,255,0.03)",
                    color: isActive ? TEAL : "rgba(255,255,255,0.3)",
                    border: `1px solid ${isActive ? `${TEAL}50` : "rgba(255,255,255,0.07)"}`,
                  }}
                  title={
                    m === "repitch"
                      ? "Re-Pitch: vinyl — pitch and tempo shift together (instant)"
                      : m === "beats"
                      ? "Beats: WSOLA — pitch without tempo change, best for drums"
                      : "Complex: Phase Vocoder — pitch without tempo change, best for melodic loops"
                  }
                >
                  {labels[m]}
                </button>
              );
            })}

            <div className="w-px h-3 bg-white/8 mx-0.5" />

            {/* Transpose nudge buttons */}
            <span className="text-[6px] font-bold text-white/20 mr-0.5">ST</span>
            {slot.pitching ? (
              <svg width="10" height="10" viewBox="0 0 10 10" style={{ animation: "spin 0.8s linear infinite" }}>
                <circle cx="5" cy="5" r="4" stroke={`${TEAL}30`} strokeWidth="1.5" fill="none" />
                <path d="M5 1A4 4 0 0 1 9 5" stroke={TEAL} strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            ) : (
              <>
                {([-12, -1, +1, +12] as const).map((delta) => (
                  <button
                    key={delta}
                    onClick={() => setTranspose(slotIndex, slot.transpose + delta)}
                    className="text-[7px] font-bold px-1 py-0.5 rounded transition-all"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      color: "rgba(255,255,255,0.45)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                    title={`${delta > 0 ? "+" : ""}${delta} semitone${Math.abs(delta) !== 1 ? "s" : ""}`}
                  >
                    {delta === 12 ? "+8ve" : delta === -12 ? "-8ve" : delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
              </>
            )}

            {/* Value badge — click to reset */}
            <button
              onClick={() => !slot.pitching && setTranspose(slotIndex, 0)}
              disabled={slot.pitching}
              className="text-[7px] font-bold px-1.5 py-0.5 rounded tabular-nums transition-all"
              style={{
                background: slot.transpose !== 0 ? `rgba(46,196,182,0.18)` : "rgba(255,255,255,0.03)",
                color: slot.transpose !== 0 ? TEAL : "rgba(255,255,255,0.18)",
                border: `1px solid ${slot.transpose !== 0 ? `${TEAL}45` : "rgba(255,255,255,0.06)"}`,
                minWidth: 30,
                cursor: slot.transpose !== 0 && !slot.pitching ? "pointer" : "default",
              }}
              title={slot.transpose !== 0 ? "Click to reset pitch to 0" : "No pitch shift"}
            >
              {slot.transpose === 0 ? "0st" : `${slot.transpose > 0 ? "+" : ""}${slot.transpose}st`}
            </button>
          </div>
```

- [ ] **Step 3: Final TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/LoopPlayerTab.tsx
git commit -m "feat(warp): add REPITCH/BEATS/COMPLEX mode buttons + transpose UX to Loop Player"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Full build**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 2: Manual smoke test**

1. Open app in browser (dev server: `npm run dev`)
2. Load a loop file into Loop Player slot
3. Verify BEATS mode (default): set +3 semitones → spinner appears briefly → pitch is higher, BPM sync maintained
4. Switch to COMPLEX: pitch re-processes → quality visibly smoother for melodic content
5. Switch to RE-PITCH: pitch applies instantly (no spinner), both pitch AND tempo shift (vinyl)
6. Set semitones back to 0: loop returns to original pitch instantly
7. Change global BPM while loop plays → sync updates correctly in all 3 modes

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(warp): complete Warp Engine with BEATS/COMPLEX/REPITCH modes — Pro pitch shifting"
```

---

## Self-Review

**Spec coverage:**
- ✅ RE-PITCH mode: Task 3 + 4
- ✅ BEATS mode (WSOLA): Task 2 + 4
- ✅ COMPLEX mode (Phase Vocoder): Task 1 + 2 + 4
- ✅ Mode buttons UI: Task 6
- ✅ Transpose UX cleanup: Task 6
- ✅ BPM sync maintained in all modes: Task 4 (subscription) + Task 3 (pitchFactor)
- ✅ Processing spinner: Task 6
- ✅ Reset to 0: Task 4

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:**
- `WarpMode` defined in `pitchShiftBuffer.ts`, imported in `loopPlayerStore.ts`
- `_pitchFactor(slot)` helper defined before `_launchSlot` in Task 4
- `pitchFactor` param name consistent across `LoopPlayerEngine` in Task 3
- `setWarpMode` added to both the interface and implementation in Task 4
