/**
 * Clip Store — Ableton Session View-style clip matrix.
 *
 * Grid: 4 tracks (Drums, Bass, Chords, Melody) × 8 clip slots.
 * Each clip stores a snapshot of its track's pattern/steps + synth params.
 * Clicking a clip launches it on that track (replaces live state).
 *
 * Launches are quantized via sceneStore.launchQuantize (only when playing).
 * When playback is stopped, clips launch immediately regardless of quantize.
 */

import { create } from "zustand";
import { unstable_batchedUpdates } from "react-dom";
import { useDrumStore, type PatternData, getDrumNextStepTime } from "./drumStore";
import { useBassStore } from "./bassStore";
import { useChordsStore } from "./chordsStore";
import { useMelodyStore } from "./melodyStore";
import { bassEngine, type BassStep, type BassParams } from "../audio/BassEngine";
import { chordsEngine, type ChordsStep, type ChordsParams } from "../audio/ChordsEngine";
import { melodyEngine, type MelodyStep, type MelodyParams } from "../audio/MelodyEngine";
import { audioEngine } from "../audio/AudioEngine";
import { type ArpSettings } from "../audio/Arpeggiator";

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
  params?: BassParams;
  arp?: ArpSettings;
}
export interface ChordsClip {
  track: "chords";
  name: string;
  steps: ChordsStep[];
  length: number;
  params?: ChordsParams;
  arp?: ArpSettings;
}
export interface MelodyClip {
  track: "melody";
  name: string;
  steps: MelodyStep[];
  length: number;
  params?: MelodyParams;
  arp?: ArpSettings;
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
      clip = {
        track: "bass",
        name: existingName ?? `B${slot + 1}`,
        steps: deepClone(b.steps),
        length: b.length,
        params: deepClone(b.params),
        arp: deepClone(b.arp),
      };
    } else if (track === "chords") {
      const c = useChordsStore.getState();
      clip = {
        track: "chords",
        name: existingName ?? `C${slot + 1}`,
        steps: deepClone(c.steps),
        length: c.length,
        params: deepClone(c.params),
        arp: deepClone(c.arp),
      };
    } else if (track === "melody") {
      const m = useMelodyStore.getState();
      clip = {
        track: "melody",
        name: existingName ?? `M${slot + 1}`,
        steps: deepClone(m.steps),
        length: m.length,
        params: deepClone(m.params),
        arp: deepClone(m.arp),
      };
    }
    if (!clip) return;
    set((s) => ({
      clips: { ...s.clips, [track]: s.clips[track].map((c, i) => i === slot ? clip : c) },
    }));
  },

  loadClip: (track, slot) => {
    const clip = get().clips[track][slot];
    if (!clip) return;

    const ctx = audioEngine.getAudioContext();
    const now = ctx?.currentTime ?? 0;
    // Use bar-boundary timing: same strategy as sceneStore.loadScene
    const bpm = useDrumStore.getState().bpm;
    const secondsPerStep = 60 / bpm / 4;
    const nextDrumStep = getDrumNextStepTime();
    const barBoundary = nextDrumStep > now ? nextDrumStep + secondsPerStep : now;
    const cleanupAt = Math.max(now, barBoundary - 0.002);

    if (clip.track === "drums") {
      useDrumStore.setState({ pattern: deepClone(clip.pattern) });
    } else if (clip.track === "bass") {
      const update: Record<string, unknown> = { steps: deepClone(clip.steps), length: clip.length };
      if (clip.params) { update.params = deepClone(clip.params); bassEngine.setParams(clip.params); }
      if (clip.arp !== undefined) update.arp = deepClone(clip.arp);
      useBassStore.setState(update);
      bassEngine.panic(cleanupAt);
    } else if (clip.track === "chords") {
      const update: Record<string, unknown> = { steps: deepClone(clip.steps), length: clip.length };
      if (clip.params) { update.params = deepClone(clip.params); chordsEngine.setParams(clip.params); }
      if (clip.arp !== undefined) update.arp = deepClone(clip.arp);
      useChordsStore.setState(update);
      chordsEngine.panic(cleanupAt);
    } else if (clip.track === "melody") {
      const update: Record<string, unknown> = { steps: deepClone(clip.steps), length: clip.length };
      if (clip.params) { update.params = deepClone(clip.params); melodyEngine.setParams(clip.params); }
      if (clip.arp !== undefined) update.arp = deepClone(clip.arp);
      useMelodyStore.setState(update);
      melodyEngine.panic(cleanupAt);
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
    // When not playing the scheduler never fires — launch immediately instead of queuing
    if (!useDrumStore.getState().isPlaying) {
      get().loadClip(track, slot);
      return;
    }
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
    const toLoad = CLIP_TRACKS.filter((t) => queuedClips[t] !== null);
    if (toLoad.length === 0) return;
    // Batch all store updates into one React render cycle
    unstable_batchedUpdates(() => {
      for (const track of toLoad) {
        const slot = queuedClips[track];
        if (slot !== null) get().loadClip(track, slot);
      }
    });
  },
}));
