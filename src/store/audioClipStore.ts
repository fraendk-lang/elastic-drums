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
  id:             string;
  startBar:       number;        // 0-indexed bar position on the timeline
  durationBars:   number;        // clip length in bars (visual timeline width)
  fileName:       string;
  buffer:         AudioBuffer;
  waveformPeaks:  Float32Array;  // 200 normalized 0..1 RMS peaks
  volume:         number;        // 0-1
  color:          string;        // user-assignable accent color
  loop:           boolean;       // loop continuously while transport plays
  // trim / fade (non-destructive, default = full file, no fade)
  sampleStartSec: number;        // seconds into buffer where playback begins
  sampleEndSec:   number;        // seconds into buffer where playback ends
  fadeInSec:      number;        // fade-in duration in seconds
  fadeOutSec:     number;        // fade-out duration in seconds
}

interface AudioClipStore {
  clips: AudioClip[];
  addClip:       (clip: AudioClip) => void;
  removeClip:    (id: string) => void;
  moveClip:      (id: string, startBar: number) => void;
  resizeClip:    (id: string, durationBars: number) => void;
  setVolume:     (id: string, volume: number) => void;
  setColor:      (id: string, color: string) => void;
  setLoop:       (id: string, loop: boolean) => void;
  setTrimPoints: (id: string, startSec: number, endSec: number) => void;
  setFades:      (id: string, fadeIn: number, fadeOut: number) => void;
  splitClip:     (id: string, splitAtSec: number, secPerBar: number) => void;
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

  setLoop: (id, loop) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, loop } : c)),
    })),

  setTrimPoints: (id, startSec, endSec) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        const clampedEnd   = Math.max(0.1, Math.min(c.buffer.duration, endSec));
        const clampedStart = Math.max(0, Math.min(clampedEnd - 0.1, startSec));
        return { ...c, sampleStartSec: clampedStart, sampleEndSec: clampedEnd };
      }),
    })),

  setFades: (id, fadeIn, fadeOut) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        const maxHalf = (c.sampleEndSec - c.sampleStartSec) / 2;
        return {
          ...c,
          fadeInSec:  Math.max(0, Math.min(maxHalf, fadeIn)),
          fadeOutSec: Math.max(0, Math.min(maxHalf, fadeOut)),
        };
      }),
    })),

  splitClip: (id, splitAtSec, secPerBar) =>
    set((s) => {
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return s;
      if (secPerBar <= 0) return s;
      if (
        splitAtSec <= clip.sampleStartSec + 0.05 ||
        splitAtSec >= clip.sampleEndSec   - 0.05
      ) return s;

      const part1Sec  = splitAtSec - clip.sampleStartSec;
      const part2Sec  = clip.sampleEndSec - splitAtSec;
      const part1Bars = part1Sec / secPerBar;

      const clip1: AudioClip = {
        ...clip,
        id:            `${clip.id}-a`,
        durationBars:  part1Bars,
        sampleEndSec:  splitAtSec,
        fadeOutSec:    0,
        fadeInSec:     Math.min(clip.fadeInSec, part1Sec / 2),
      };
      const clip2: AudioClip = {
        ...clip,
        id:             `${clip.id}-b`,
        startBar:       clip.startBar + part1Bars,
        durationBars:   part2Sec / secPerBar,
        sampleStartSec: splitAtSec,
        fadeInSec:      0,
        fadeOutSec:     Math.min(clip.fadeOutSec, part2Sec / 2),
      };

      return {
        clips: s.clips.filter((c) => c.id !== id).concat([clip1, clip2]),
      };
    }),
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
