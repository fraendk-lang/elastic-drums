/**
 * Sample Slicing — MPC / Maschine "chop" workflow.
 *
 * Takes a long sample buffer (drum break, vocal loop, melodic phrase) and
 * splits it into N short clips, each assigned to a consecutive pad slot.
 * Two slicing modes:
 *
 *   "even"      Divide buffer into N equal-length pieces. Predictable,
 *               great for loops that already sit on a grid.
 *
 *   "transient" Detect note onsets using HF spectral flux and use them
 *               as slice boundaries. Better for drum breaks where the
 *               hits don't fall on equal divisions. Falls back to even
 *               if fewer onsets are detected than requested.
 *
 * Each slice is a real AudioBuffer (not a slice index into the source) so
 * the existing SampleManager.decodeAndSet path works without changes. Each
 * pad becomes a normal one-shot trigger — no special "slice player" mode.
 */

import { audioEngine } from "../audio/AudioEngine";
import { sampleManager } from "../audio/SampleManager";

export type SliceMode = "even" | "transient";

export interface SliceOptions {
  /** Source — file from input, drag drop, or recording. */
  source: File | AudioBuffer;
  /** How many slices to produce (4 / 8 / 12 / 16 typical). */
  count: 4 | 8 | 12 | 16;
  /** Even = grid, Transient = onset-detected. */
  mode: SliceMode;
  /** First voice index to assign slices to (0 = KICK). */
  startVoice: number;
  /** Max voices to fill — useful when only the last N pads should be touched. */
  maxVoices?: number;
  /** Display-name prefix; gets " 01", " 02"… appended. */
  baseName?: string;
}

export interface SliceResult {
  /** Number of slices actually written to pads (≤ count, ≤ 12 voices). */
  slicesWritten: number;
  /** Detected onsets (transient mode only) — debugging / waveform overlay. */
  onsets?: number[];
}

const NUM_PADS = 12;

export async function sliceToPads(opts: SliceOptions): Promise<SliceResult> {
  const { source, count, mode, startVoice, maxVoices = NUM_PADS, baseName } = opts;

  // ── 1. Resolve source to AudioBuffer ──
  const ctx = audioEngine.getAudioContext();
  if (!ctx) throw new Error("AudioContext not initialised");
  const buffer = source instanceof AudioBuffer
    ? source
    : await ctx.decodeAudioData(await source.arrayBuffer());

  // ── 2. Compute slice boundaries in samples ──
  const totalSamples = buffer.length;
  let boundaries: number[];
  let onsets: number[] | undefined;
  if (mode === "transient") {
    onsets = detectOnsets(buffer, count);
    if (onsets.length < count) {
      // Not enough onsets — pad with even divisions for the missing slots
      const even = Array.from({ length: count }, (_, i) => Math.floor((i * totalSamples) / count));
      boundaries = [...onsets, ...even.slice(onsets.length)].sort((a, b) => a - b).slice(0, count);
    } else {
      boundaries = onsets.slice(0, count);
    }
  } else {
    boundaries = Array.from({ length: count }, (_, i) => Math.floor((i * totalSamples) / count));
  }

  // ── 3. Cut and assign to pads ──
  const slicesToWrite = Math.min(count, maxVoices, NUM_PADS - startVoice);
  const ch = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const prefix = baseName ?? (source instanceof File ? source.name.replace(/\.[^.]+$/, "") : "Slice");

  for (let i = 0; i < slicesToWrite; i++) {
    const startSample = boundaries[i]!;
    const endSample = i + 1 < boundaries.length ? boundaries[i + 1]! : totalSamples;
    const len = Math.max(64, endSample - startSample); // never empty (≥1.5ms)
    const slice = ctx.createBuffer(ch, len, sr);
    for (let c = 0; c < ch; c++) {
      const src = buffer.getChannelData(c).subarray(startSample, startSample + len);
      slice.copyToChannel(src, c);
    }
    // Anti-click fade at end of slice (1ms) so chopped buffers don't pop.
    applyTinyFade(slice);
    const voice = startVoice + i;
    sampleManager.decodeAndSet(voice, slice, `${prefix} ${String(i + 1).padStart(2, "0")}`);
  }

  return { slicesWritten: slicesToWrite, onsets };
}

// ─── Transient detection ───────────────────────────────────────────────

/**
 * Naive onset detector — sufficient for drum breaks.
 *
 * Pipeline:
 *  1. Reduce buffer to mono.
 *  2. Compute frame-wise RMS energy (~10ms windows = 441 samples @ 44.1k).
 *  3. Compute "spectral flux" approximation: positive derivative of HF
 *     energy (high-pass through a 1-pole filter first to emphasise
 *     transients over bass).
 *  4. Pick peaks above a dynamic threshold (mean + 1.5σ).
 *  5. Enforce a minimum-distance constraint between onsets so we don't
 *     pick two slices on the same drum hit.
 *
 * Returns onset positions in SAMPLES. May return more or fewer than
 * targetCount — caller pads with even divisions if short.
 */
function detectOnsets(buffer: AudioBuffer, targetCount: number): number[] {
  const sr = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);
  const monoSamples = buffer.length;
  // Mono mix
  const mono = new Float32Array(monoSamples);
  if (buffer.numberOfChannels === 1) {
    mono.set(ch0);
  } else {
    const ch1 = buffer.getChannelData(1);
    for (let i = 0; i < monoSamples; i++) mono[i] = (ch0[i]! + ch1[i]!) * 0.5;
  }
  // High-pass (1-pole) to emphasise transients
  const hpf = new Float32Array(monoSamples);
  let prev = 0, prevHp = 0;
  const a = 0.96; // cutoff ~700Hz at 44.1k
  for (let i = 0; i < monoSamples; i++) {
    const v = mono[i]!;
    const out = a * (prevHp + v - prev);
    hpf[i] = out;
    prev = v;
    prevHp = out;
  }
  // Frame-wise RMS
  const frame = Math.max(64, Math.floor(sr * 0.01)); // ~10ms
  const frames = Math.floor(monoSamples / frame);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * frame;
    for (let i = 0; i < frame; i++) {
      const v = hpf[base + i]!;
      sum += v * v;
    }
    energy[f] = Math.sqrt(sum / frame);
  }
  // Positive derivative (spectral flux proxy)
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = energy[f]! - energy[f - 1]!;
    flux[f] = d > 0 ? d : 0;
  }
  // Dynamic threshold = mean + 1.5σ
  let mean = 0;
  for (let f = 0; f < frames; f++) mean += flux[f]!;
  mean /= frames;
  let variance = 0;
  for (let f = 0; f < frames; f++) {
    const d = flux[f]! - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / frames);
  const threshold = mean + std * 1.5;
  // Pick peaks with minimum-distance (avoid double-trigger on one hit).
  // Target ~50ms minimum spacing — fast hihat rolls still get individual peaks.
  const minDistFrames = Math.max(2, Math.floor(0.05 / (frame / sr)));
  const onsets: number[] = [0]; // always slice from 0
  let lastOnsetFrame = -Infinity;
  for (let f = 1; f < frames - 1; f++) {
    if (flux[f]! < threshold) continue;
    if (flux[f]! < flux[f - 1]! || flux[f]! < flux[f + 1]!) continue; // local max
    if (f - lastOnsetFrame < minDistFrames) continue;
    onsets.push(f * frame);
    lastOnsetFrame = f;
    if (onsets.length >= targetCount + 4) break; // a few extra to choose from
  }
  return onsets.slice(0, targetCount);
}

function applyTinyFade(buffer: AudioBuffer): void {
  const fadeLen = Math.min(buffer.length, Math.floor(buffer.sampleRate * 0.001));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < fadeLen; i++) {
      const k = i / fadeLen;
      const idx = data.length - 1 - i;
      data[idx] = (data[idx] ?? 0) * k;
    }
  }
}
