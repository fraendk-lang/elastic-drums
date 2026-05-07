/**
 * Sample Manager
 *
 * Handles loading, decoding, and storing audio samples.
 * Each voice can hold a single sample OR multiple velocity layers.
 *
 * Velocity Layers:
 *   - Up to 4 layers per voice, each mapped to a velocity range [0..1]
 *   - On playback, the layer whose range covers the velocity wins
 *   - Existing single-sample API still works (treated as one full-range layer)
 */

import { audioEngine } from "./AudioEngine";
import { applyMuLaw } from "./MuLaw";
import { stretchBuffer } from "./SampleStretcher";

export interface LoadedSample {
  name: string;
  buffer: AudioBuffer;
  originalBuffer: AudioBuffer;
  duration: number;
  sampleRate: number;
  muLawEnabled: boolean;
}

export type StretchMode = "repitch" | "beats";

export interface LoopData {
  isLoop: boolean;
  nativeBpm: number;          // 0 = unknown / not a BPM-locked loop
  bars: number;               // how many bars the loop covers (auto-detected or user-set)
  loopStart: number;          // seconds into the buffer (0 = beginning)
  loopEnd: number;            // seconds into the buffer (0 = use buffer end)
  stretchMode: StretchMode;   // "repitch" (default, free) or "beats" (pitch-preserving)
}

/**
 * Auto-detect the native BPM of a loop from its duration.
 * Tests common BPM values (60–200) at 1, 2, 4 and 8 bar lengths.
 * Returns 0 if no clean match is found.
 */
export function detectNativeBpm(duration: number): number {
  const BAR_COUNTS = [1, 2, 4, 8];
  const BEATS_PER_BAR = 4;
  const TOLERANCE = 0.015; // ±1.5% — accommodates slight render offsets

  for (let bpm = 60; bpm <= 200; bpm++) {
    const secondsPerBeat = 60 / bpm;
    for (const bars of BAR_COUNTS) {
      const expected = secondsPerBeat * BEATS_PER_BAR * bars;
      if (Math.abs(duration - expected) / expected < TOLERANCE) {
        return bpm;
      }
    }
  }
  return 0;
}

export interface VelocityLayer {
  sample: LoadedSample;
  velMin: number; // 0..1
  velMax: number; // 0..1
}

export const MAX_VELOCITY_LAYERS = 4;

class SampleManagerClass {
  // Per-voice velocity layers (voice index → array of layers)
  private layers = new Map<number, VelocityLayer[]>();

  // Per-voice loop metadata (voice index → loop settings)
  private loopMeta = new Map<number, LoopData>();

  // Per-voice cached stretched buffer (voice → { sourceBuffer, ratio, stretchedBuffer })
  // Invalidated when sourceBuffer changes or ratio changes by > 0.5%.
  private stretchCache = new Map<number, { source: AudioBuffer; ratio: number; buffer: AudioBuffer }>();

  /** Load a sample from a File. Replaces full-range single layer by default. */
  async loadFromFile(file: File, voiceIndex: number, opts?: { velMin?: number; velMax?: number; append?: boolean }): Promise<LoadedSample> {
    const arrayBuffer = await file.arrayBuffer();
    await audioEngine.resume();
    const ctx = audioEngine.getAudioContext();
    if (!ctx) throw new Error("AudioContext not initialized");

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return this.addSampleBuffer(audioBuffer, file.name.replace(/\.[^.]+$/, ""), voiceIndex, opts);
  }

  /** Load sample from URL */
  async loadFromUrl(url: string, name: string, voiceIndex: number, opts?: { velMin?: number; velMax?: number; append?: boolean }): Promise<LoadedSample> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sample request failed (${response.status}) for ${url}`);
    const arrayBuffer = await response.arrayBuffer();
    await audioEngine.resume();
    const ctx = audioEngine.getAudioContext();
    if (!ctx) throw new Error("AudioContext not initialized");
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return this.addSampleBuffer(audioBuffer, name, voiceIndex, opts);
  }

  /** Decode and store a sample buffer for a voice. */
  decodeAndSet(voiceIndex: number, buffer: AudioBuffer, name: string, opts?: { velMin?: number; velMax?: number; append?: boolean }): LoadedSample {
    return this.addSampleBuffer(buffer, name, voiceIndex, opts);
  }

  private addSampleBuffer(
    buffer: AudioBuffer,
    name: string,
    voiceIndex: number,
    opts?: { velMin?: number; velMax?: number; append?: boolean },
  ): LoadedSample {
    const sample: LoadedSample = {
      name,
      buffer,
      originalBuffer: buffer,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      muLawEnabled: false,
    };

    // Auto-detect loop BPM when replacing the first (or only) layer.
    // Only run detection when not appending — appended layers are usually
    // velocity variants of the same sample and share the same loop setting.
    if (!opts?.append) {
      // Stretched buffer is tied to the previous source — invalidate
      this.stretchCache.delete(voiceIndex);
      const detectedBpm = detectNativeBpm(buffer.duration);
      if (detectedBpm > 0) {
        const bars = Math.max(1, Math.round(buffer.duration / (60 / detectedBpm * 4)));
        // isLoop defaults to FALSE — user must explicitly enable via LOOP badge or editor.
        // We only store nativeBpm as a suggestion shown in the badge.
        this.loopMeta.set(voiceIndex, { isLoop: false, nativeBpm: detectedBpm, bars, loopStart: 0, loopEnd: 0, stretchMode: "repitch" });
      } else {
        // New sample replaces old — clear stale loop data
        this.loopMeta.delete(voiceIndex);
      }
    }

    const velMin = opts?.velMin ?? 0;
    const velMax = opts?.velMax ?? 1;
    const append = opts?.append ?? false;

    const existing = this.layers.get(voiceIndex) ?? [];
    let next: VelocityLayer[];
    if (append && existing.length < MAX_VELOCITY_LAYERS) {
      next = [...existing, { sample, velMin, velMax }];
    } else if (append) {
      // At max layers — replace the last one
      next = [...existing.slice(0, -1), { sample, velMin, velMax }];
    } else {
      // Replace (single-layer default behaviour)
      next = [{ sample, velMin, velMax }];
    }
    // Sort by velMin so lookup is predictable
    next.sort((a, b) => a.velMin - b.velMin);
    this.layers.set(voiceIndex, next);

    return sample;
  }

  /** Get all velocity layers for a voice */
  getLayers(voiceIndex: number): VelocityLayer[] {
    return this.layers.get(voiceIndex) ?? [];
  }

  /** Remove a specific velocity layer by index */
  removeLayer(voiceIndex: number, layerIdx: number): void {
    const existing = this.layers.get(voiceIndex);
    if (!existing) return;
    const next = existing.filter((_, i) => i !== layerIdx);
    if (next.length === 0) this.layers.delete(voiceIndex);
    else this.layers.set(voiceIndex, next);
  }

  /** Update the velocity range of a layer */
  setLayerRange(voiceIndex: number, layerIdx: number, velMin: number, velMax: number): void {
    const existing = this.layers.get(voiceIndex);
    if (!existing || !existing[layerIdx]) return;
    const updated = [...existing];
    updated[layerIdx] = { ...updated[layerIdx]!, velMin, velMax };
    updated.sort((a, b) => a.velMin - b.velMin);
    this.layers.set(voiceIndex, updated);
  }

  /** Pick the right buffer for a given velocity */
  getBufferForVelocity(voiceIndex: number, velocity: number): AudioBuffer | null {
    const layers = this.layers.get(voiceIndex);
    if (!layers || layers.length === 0) return null;
    // Find layer whose [velMin, velMax] covers velocity
    for (const layer of layers) {
      if (velocity >= layer.velMin && velocity <= layer.velMax) return layer.sample.buffer;
    }
    // Fallback: nearest layer
    let best = layers[0]!;
    let bestDist = Infinity;
    for (const layer of layers) {
      const mid = (layer.velMin + layer.velMax) / 2;
      const d = Math.abs(mid - velocity);
      if (d < bestDist) { bestDist = d; best = layer; }
    }
    return best.sample.buffer;
  }

  /** Get first loaded sample for a voice (backward-compat) */
  getSample(voiceIndex: number): LoadedSample | undefined {
    return this.layers.get(voiceIndex)?.[0]?.sample;
  }

  /** Check if voice has any sample loaded */
  hasSample(voiceIndex: number): boolean {
    return (this.layers.get(voiceIndex)?.length ?? 0) > 0;
  }

  /** Toggle µ-Law on all layers of a voice */
  toggleMuLaw(voiceIndex: number): boolean {
    const layers = this.layers.get(voiceIndex);
    if (!layers || layers.length === 0) return false;
    const ctx = audioEngine.getAudioContext();
    if (!ctx) return false;

    const firstEnabled = layers[0]!.sample.muLawEnabled;
    const nextEnabled = !firstEnabled;

    for (const layer of layers) {
      layer.sample.muLawEnabled = nextEnabled;
      if (nextEnabled) {
        layer.sample.buffer = applyMuLaw(layer.sample.originalBuffer, ctx, 8, 2);
      } else {
        layer.sample.buffer = layer.sample.originalBuffer;
      }
    }

    return nextEnabled;
  }

  isMuLawEnabled(voiceIndex: number): boolean {
    return this.layers.get(voiceIndex)?.[0]?.sample.muLawEnabled ?? false;
  }

  /** Remove all samples from a voice (revert to synthesis) */
  clearSample(voiceIndex: number): void {
    this.layers.delete(voiceIndex);
    this.loopMeta.delete(voiceIndex);
    this.stretchCache.delete(voiceIndex);
  }

  // ─── Loop metadata ─────────────────────────────────────────

  /** Get loop settings for a voice (undefined = no loop data set) */
  getLoopData(voiceIndex: number): LoopData | undefined {
    return this.loopMeta.get(voiceIndex);
  }

  /** Manually override loop settings for a voice */
  setLoopData(voiceIndex: number, data: LoopData): void {
    this.loopMeta.set(voiceIndex, data);
  }

  /** Toggle loop mode on/off for a voice (preserves nativeBpm) */
  toggleLoop(voiceIndex: number): boolean {
    const existing = this.loopMeta.get(voiceIndex);
    if (!existing) {
      // Enable loop with unknown BPM — user will set BPM manually
      this.loopMeta.set(voiceIndex, { isLoop: true, nativeBpm: 0, bars: 1, loopStart: 0, loopEnd: 0, stretchMode: "repitch" });
      return true;
    }
    const next: LoopData = { ...existing, isLoop: !existing.isLoop };
    this.loopMeta.set(voiceIndex, next);
    return next.isLoop;
  }

  /** Set the native BPM for a voice's loop, recalculate bars from duration */
  setNativeBpm(voiceIndex: number, bpm: number): void {
    const existing = this.loopMeta.get(voiceIndex) ?? { isLoop: false, nativeBpm: 0, bars: 1, loopStart: 0, loopEnd: 0, stretchMode: "repitch" };
    const buffer = this.layers.get(voiceIndex)?.[0]?.sample.buffer;
    const bars = buffer && bpm > 0 ? Math.max(1, Math.round(buffer.duration / (60 / bpm * 4))) : existing.bars;
    this.loopMeta.set(voiceIndex, { ...existing, nativeBpm: bpm, bars });
  }

  /** Set bars count for a voice's loop and recalculate BPM from buffer duration */
  setBars(voiceIndex: number, bars: number): void {
    const existing = this.loopMeta.get(voiceIndex) ?? { isLoop: false, nativeBpm: 0, bars: 1, loopStart: 0, loopEnd: 0, stretchMode: "repitch" };
    const buffer = this.layers.get(voiceIndex)?.[0]?.sample.buffer;
    const nativeBpm = buffer && bars > 0
      ? Math.round((bars * 4 * 60 / buffer.duration) * 10) / 10
      : existing.nativeBpm;
    this.loopMeta.set(voiceIndex, { ...existing, bars, nativeBpm });
  }

  // ─── Time-stretch cache ─────────────────────────────────────

  /**
   * Return the buffer that should be played for this voice at the given project BPM.
   * If the voice is in "beats" stretch mode and a tempo difference exists, returns
   * a pre-rendered, time-stretched buffer (cached). Otherwise returns the source.
   *
   * @param voice       Voice index
   * @param velocity    Velocity 0..1 (selects velocity layer)
   * @param projectBpm  Current project BPM (0 = no transport tempo known)
   * @returns           Buffer to play, or null if no sample loaded
   */
  getPlaybackBuffer(voice: number, velocity: number, projectBpm: number): AudioBuffer | null {
    const layers = this.layers.get(voice);
    if (!layers || layers.length === 0) return null;

    // Find layer matching velocity (same logic as getBufferForVelocity)
    let chosen = layers[0]!;
    for (const layer of layers) {
      if (velocity >= layer.velMin && velocity <= layer.velMax) { chosen = layer; break; }
    }
    const sourceBuffer = chosen.sample.buffer;

    const meta = this.loopMeta.get(voice);
    if (!meta || !meta.isLoop || meta.stretchMode !== "beats" || meta.nativeBpm <= 0 || projectBpm <= 0) {
      return sourceBuffer; // re-pitch path or no stretch needed
    }

    // ratio: how much faster the output should play vs. source
    // e.g. native 120, project 140 → ratio 140/120 = 1.166 (output is shorter)
    const ratio = projectBpm / meta.nativeBpm;
    if (Math.abs(ratio - 1) < 0.005) return sourceBuffer; // <0.5% ≈ no stretch needed

    // Check cache
    const cached = this.stretchCache.get(voice);
    if (cached && cached.source === sourceBuffer && Math.abs(cached.ratio - ratio) < 0.005) {
      return cached.buffer;
    }

    // Re-render (synchronous; SoundTouch is fast enough for typical loops)
    const ctx = audioEngine.getAudioContext();
    if (!ctx) return sourceBuffer;
    try {
      const stretched = stretchBuffer(sourceBuffer, ratio, ctx);
      this.stretchCache.set(voice, { source: sourceBuffer, ratio, buffer: stretched });
      return stretched;
    } catch (err) {
      console.warn("Time-stretch failed, falling back to re-pitch:", err);
      return sourceBuffer;
    }
  }

  /** Invalidate cached stretched buffer for a voice (e.g., when project BPM changes) */
  invalidateStretchCache(voice?: number): void {
    if (voice === undefined) this.stretchCache.clear();
    else this.stretchCache.delete(voice);
  }

  /** Get a flat map of first layer samples (backward-compat) */
  getLoadedSamples(): Map<number, LoadedSample> {
    const out = new Map<number, LoadedSample>();
    for (const [voice, layers] of this.layers) {
      if (layers[0]) out.set(voice, layers[0].sample);
    }
    return out;
  }
}

export const sampleManager = new SampleManagerClass();

// Register velocity-aware sample lookup with audio engine.
// Now also returns time-stretched buffer when voice is in "beats" mode.
audioEngine.setSampleLookup((voice: number, velocity = 0.8, projectBpm = 0) => {
  return sampleManager.getPlaybackBuffer(voice, velocity, projectBpm);
});

// Register loop-data lookup with audio engine
audioEngine.setLoopLookup((voice: number) => {
  return sampleManager.getLoopData(voice) ?? null;
});
