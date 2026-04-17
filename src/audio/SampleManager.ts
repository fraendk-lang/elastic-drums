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

export interface LoadedSample {
  name: string;
  buffer: AudioBuffer;
  originalBuffer: AudioBuffer;
  duration: number;
  sampleRate: number;
  muLawEnabled: boolean;
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

// Register velocity-aware sample lookup with audio engine
audioEngine.setSampleLookup((voice: number, velocity = 0.8) => {
  return sampleManager.getBufferForVelocity(voice, velocity);
});
