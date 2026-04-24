/**
 * Clip Store — Ableton Session View-style clip matrix.
 *
 * Grid: 4 tracks (Drums, Bass, Chords, Melody) × 8 clip slots.
 * Each clip stores a snapshot of its track's pattern/steps.
 * Clicking a clip launches it on that track (replaces live state).
 *
 * Launches are quantized via sceneStore.launchQuantize.
 */

import { create } from "zustand";
import { useDrumStore, type PatternData } from "./drumStore";
import { useBassStore } from "./bassStore";
import { useChordsStore } from "./chordsStore";
import { useMelodyStore } from "./melodyStore";
import type { BassStep } from "../audio/BassEngine";
import type { ChordsStep } from "../audio/ChordsEngine";
import type { MelodyStep } from "../audio/MelodyEngine";

export type ClipTrack = "drums" | "bass" | "chords" | "melody";
export const CLIP_TRACKS: ClipTrack[] = ["drums", "bass", "chords", "melody"];
export const CLIP_SLOTS_PER_TRACK = 8;

export interface DrumClip {
  track: "drums";
  name: string;
  pattern: PatternData;
}
export interface BassClip {
  track: "bass";
  name: string;
  steps: BassStep[];
  length: number;
}
export interface ChordsClip {
  track: "chords";
  name: string;
  steps: ChordsStep[];
  length: number;
}
export interface MelodyClip {
  track: "melody";
  name: string;
  steps: MelodyStep[];
  length: number;
}

export type Clip = DrumClip | BassClip | ChordsClip | MelodyClip;

function deepClone<T>(v: T): T {
  return structuredClone(v);
}

interface ClipStore {
  // clips[track][slot] = Clip | null
  clips: Record<ClipTrack, (Clip | null)[]>;
  activeClips: Record<ClipTrack, number>; // slot index or -1
  queuedClips: Record<ClipTrack, number | null>; // slot index waiting to launch

  captureClip: (track: ClipTrack, slot: number) => void;
  launchClip: (track: ClipTrack, slot: number) => void;
  queueClip: (track: ClipTrack, slot: number) => void;
  loadClip: (track: ClipTrack, slot: number) => void;
  clearClip: (track: ClipTrack, slot: number) => void;
  renameClip: (track: ClipTrack, slot: number, name: string) => void;
  stopTrack: (track: ClipTrack) => void;
  resolveQueuedClips: () => void; // Called on bar boundary
}

function emptyGrid(): Record<ClipTrack, (Clip | null)[]> {
  return {
    drums: new Array<Clip | null>(CLIP_SLOTS_PER_TRACK).fill(null),
    bass: new Array<Clip | null>(CLIP_SLOTS_PER_TRACK).fill(null),
    chords: new Array<Clip | null>(CLIP_SLOTS_PER_TRACK).fill(null),
    melody: new Array<Clip | null>(CLIP_SLOTS_PER_TRACK).fill(null),
  };
}

export const useClipStore = create<ClipStore>((set, get) => ({
  clips: emptyGrid(),
  activeClips: { drums: -1, bass: -1, chords: -1, melody: -1 },
  queuedClips: { drums: null, bass: null, chords: null, melody: null },

  captureClip: (track, slot) => {
    if (slot < 0 || slot >= CLIP_SLOTS_PER_TRACK) return;
    const existingName = get().clips[track][slot]?.name;
    let clip: Clip | null = null;
    if (track === "drums") {
      const d = useDrumStore.getState();
      clip = { track: "drums", name: existingName ?? `D${slot + 1}`, pattern: deepClone(d.pattern) };
    } else if (track === "bass") {
      const b = useBassStore.getState();
      clip = { track: "bass", name: existingName ?? `B${slot + 1}`, steps: deepClone(b.steps), length: b.length };
    } else if (track === "chords") {
      const c = useChordsStore.getState();
      clip = { track: "chords", name: existingName ?? `C${slot + 1}`, steps: deepClone(c.steps), length: c.length };
    } else if (track === "melody") {
      const m = useMelodyStore.getState();
      clip = { track: "melody", name: existingName ?? `M${slot + 1}`, steps: deepClone(m.steps), length: m.length };
    }
    if (!clip) return;
    set((s) => ({
      clips: { ...s.clips, [track]: s.clips[track].map((c, i) => i === slot ? clip : c) },
    }));
  },

  loadClip: (track, slot) => {
    const clip = get().clips[track][slot];
    if (!clip) return;
    if (clip.track === "drums") {
      useDrumStore.setState({ pattern: deepClone(clip.pattern) });
    } else if (clip.track === "bass") {
      useBassStore.setState({ steps: deepClone(clip.steps), length: clip.length });
    } else if (clip.track === "chords") {
      useChordsStore.setState({ steps: deepClone(clip.steps), length: clip.length });
    } else if (clip.track === "melody") {
      useMelodyStore.setState({ steps: deepClone(clip.steps), length: clip.length });
    }
    set((s) => ({
      activeClips: { ...s.activeClips, [track]: slot },
      queuedClips: { ...s.queuedClips, [track]: null },
    }));
  },

  launchClip: (track, slot) => {
    // Immediate launch (bypasses queue)
    get().loadClip(track, slot);
  },

  queueClip: (track, slot) => {
    const clip = get().clips[track][slot];
    if (!clip) return;
    // Toggle: if already queued, cancel
    if (get().queuedClips[track] === slot) {
      set((s) => ({ queuedClips: { ...s.queuedClips, [track]: null } }));
      return;
    }
    set((s) => ({ queuedClips: { ...s.queuedClips, [track]: slot } }));
  },

  clearClip: (track, slot) => {
    set((s) => ({
      clips: { ...s.clips, [track]: s.clips[track].map((c, i) => i === slot ? null : c) },
      activeClips: s.activeClips[track] === slot ? { ...s.activeClips, [track]: -1 } : s.activeClips,
      queuedClips: s.queuedClips[track] === slot ? { ...s.queuedClips, [track]: null } : s.queuedClips,
    }));
  },

  renameClip: (track, slot, name) => {
    set((s) => ({
      clips: {
        ...s.clips,
        [track]: s.clips[track].map((c, i) => i === slot && c ? { ...c, name } : c),
      },
    }));
  },

  stopTrack: (track) => {
    set((s) => ({
      activeClips: { ...s.activeClips, [track]: -1 },
      queuedClips: { ...s.queuedClips, [track]: null },
    }));
  },

  resolveQueuedClips: () => {
    const { queuedClips } = get();
    for (const track of CLIP_TRACKS) {
      const slot = queuedClips[track];
      if (slot !== null) get().loadClip(track, slot);
    }
  },
}));
