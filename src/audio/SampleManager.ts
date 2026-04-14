/**
 * Sample Manager
 *
 * Handles loading, decoding, and storing audio samples.
 * Samples are decoded into AudioBuffers and stored per-voice.
 * Supports: WAV, MP3, AIFF, OGG, FLAC (whatever the browser decodes)
 */

import { audioEngine } from "./AudioEngine";
import { applyMuLaw } from "./MuLaw";

export interface LoadedSample {
  name: string;
  buffer: AudioBuffer;        // Current buffer (possibly µ-Law processed)
  originalBuffer: AudioBuffer; // Original unprocessed buffer
  duration: number;
  sampleRate: number;
  muLawEnabled: boolean;
}

class SampleManagerClass {
  // Per-voice sample slots (voice index → sample)
  private samples = new Map<number, LoadedSample>();

  /** Load a sample from a File (drag & drop or file picker) */
  async loadFromFile(file: File, voiceIndex: number): Promise<LoadedSample> {
    const arrayBuffer = await file.arrayBuffer();
    const ctx = audioEngine.getAudioContext();
    if (!ctx) throw new Error("AudioContext not initialized");

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const sample: LoadedSample = {
      name: file.name.replace(/\.[^.]+$/, ""),
      buffer: audioBuffer,
      originalBuffer: audioBuffer,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      muLawEnabled: false,
    };

    this.samples.set(voiceIndex, sample);
    console.log(`Sample loaded: "${sample.name}" → Voice ${voiceIndex} (${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz)`);

    return sample;
  }

  /** Load sample from URL */
  async loadFromUrl(url: string, name: string, voiceIndex: number): Promise<LoadedSample> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const ctx = audioEngine.getAudioContext();
    if (!ctx) throw new Error("AudioContext not initialized");

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const sample: LoadedSample = {
      name,
      buffer: audioBuffer,
      originalBuffer: audioBuffer,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      muLawEnabled: false,
    };

    this.samples.set(voiceIndex, sample);
    return sample;
  }

  /** Load sample from an AudioBuffer (used by kit loading) */
  loadFromBuffer(buffer: AudioBuffer, name: string, voiceIndex: number): LoadedSample {
    const sample: LoadedSample = {
      name,
      buffer,
      originalBuffer: buffer,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      muLawEnabled: false,
    };

    this.samples.set(voiceIndex, sample);
    return sample;
  }

  /** Get loaded sample for a voice */
  getSample(voiceIndex: number): LoadedSample | undefined {
    return this.samples.get(voiceIndex);
  }

  /** Check if voice has a sample loaded */
  hasSample(voiceIndex: number): boolean {
    return this.samples.has(voiceIndex);
  }

  /** Toggle µ-Law vintage processing on a sample */
  toggleMuLaw(voiceIndex: number): boolean {
    const sample = this.samples.get(voiceIndex);
    if (!sample) return false;

    const ctx = audioEngine.getAudioContext();
    if (!ctx) return false;

    sample.muLawEnabled = !sample.muLawEnabled;

    if (sample.muLawEnabled) {
      // Apply µ-Law (8-bit, slight sample rate reduction)
      sample.buffer = applyMuLaw(sample.originalBuffer, ctx, 8, 2);
    } else {
      // Restore original
      sample.buffer = sample.originalBuffer;
    }

    return sample.muLawEnabled;
  }

  /** Check if µ-Law is enabled for a voice */
  isMuLawEnabled(voiceIndex: number): boolean {
    return this.samples.get(voiceIndex)?.muLawEnabled ?? false;
  }

  /** Remove sample from a voice (revert to synthesis) */
  clearSample(voiceIndex: number): void {
    this.samples.delete(voiceIndex);
  }

  /** Get all loaded sample info */
  getLoadedSamples(): Map<number, LoadedSample> {
    return this.samples;
  }
}

export const sampleManager = new SampleManagerClass();

// Register sample lookup with audio engine
audioEngine.setSampleLookup((voice: number) => {
  const sample = sampleManager.getSample(voice);
  return sample?.buffer ?? null;
});
