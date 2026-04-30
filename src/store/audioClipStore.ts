/**
 * audioClipStore — free audio clips placed at absolute bar positions.
 *
 * Each clip is positioned on the arrangement timeline independently of the
 * scene/song-chain system. Suitable for vocals, FX stabs, long recordings —
 * anything that doesn't need pattern-level sync.
 */

import { create } from "zustand";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AudioClip {
  id:            string;
  startBar:      number;        // 0-indexed bar position on the timeline
  durationBars:  number;        // clip length in bars (computed from file)
  fileName:      string;
  buffer:        AudioBuffer;
  waveformPeaks: Float32Array;  // 200 normalized 0..1 RMS peaks
  volume:        number;        // 0-1
  color:         string;        // user-assignable accent color
}

interface AudioClipStore {
  clips: AudioClip[];
  addClip:    (clip: AudioClip) => void;
  removeClip: (id: string) => void;
  moveClip:   (id: string, startBar: number) => void;
  resizeClip: (id: string, durationBars: number) => void;
  setVolume:  (id: string, volume: number) => void;
  setColor:   (id: string, color: string) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAudioClipStore = create<AudioClipStore>((set) => ({
  clips: [],

  addClip: (clip) =>
    set((s) => ({ clips: [...s.clips, clip] })),

  removeClip: (id) =>
    set((s) => ({ clips: s.clips.filter((c) => c.id !== id) })),

  moveClip: (id, startBar) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id ? { ...c, startBar: Math.max(0, startBar) } : c
      ),
    })),

  resizeClip: (id, durationBars) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id ? { ...c, durationBars: Math.max(0.5, durationBars) } : c
      ),
    })),

  setVolume: (id, volume) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id ? { ...c, volume: Math.max(0, Math.min(1, volume)) } : c
      ),
    })),

  setColor: (id, color) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, color } : c)),
    })),
}));

// ─── Waveform peak analysis ───────────────────────────────────────────────────

/** Compute RMS amplitude peaks from an AudioBuffer (mono mix-down). */
export function computeWaveformPeaks(buffer: AudioBuffer, numPeaks = 200): Float32Array {
  const length  = buffer.length;
  const numCh   = buffer.numberOfChannels;
  const peaks   = new Float32Array(numPeaks);
  const segSize = Math.ceil(length / numPeaks);

  for (let p = 0; p < numPeaks; p++) {
    const start = p * segSize;
    const end   = Math.min(start + segSize, length);
    let   sum   = 0;
    let   count = 0;
    for (let ch = 0; ch < numCh; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = start; i < end; i++) {
        sum += data[i]! * data[i]!;
        count++;
      }
    }
    peaks[p] = count > 0 ? Math.sqrt(sum / count) : 0;
  }

  // Normalize to 0..1
  const max = Math.max(...peaks, 1e-6);
  for (let p = 0; p < numPeaks; p++) peaks[p] = peaks[p]! / max;

  return peaks;
}
