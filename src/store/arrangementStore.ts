/**
 * arrangementStore — per-track clip timeline
 *
 * Each of the 4 instrument tracks has its own row of non-overlapping clips.
 * Clips carry their own step data (always) and optional synth param snapshots.
 * A gap between clips = silence for that track.
 */

import { create } from "zustand";
import type { PatternData } from "./drumStore";
import type { BassStep, BassParams } from "../audio/BassEngine";
import type { ChordsStep, ChordsParams } from "../audio/ChordsEngine";
import type { MelodyStep, MelodyParams } from "../audio/MelodyEngine";

// ─── Track IDs ────────────────────────────────────────────────────────────────

export type ArrangementTrackId = "drums" | "bass" | "chords" | "melody";

// ─── Per-track clip data ──────────────────────────────────────────────────────

export interface DrumClipData {
  kind: "drums";
  pattern: PatternData;
}

export interface BassClipData {
  kind: "bass";
  steps: BassStep[];
  length: number;
  params?: BassParams;
}

export interface ChordsClipData {
  kind: "chords";
  steps: ChordsStep[];
  length: number;
  params?: ChordsParams;
}

export interface MelodyClipData {
  kind: "melody";
  steps: MelodyStep[];
  length: number;
  params?: MelodyParams;
}

export type ArrangementClipData =
  | DrumClipData
  | BassClipData
  | ChordsClipData
  | MelodyClipData;

// ─── Clip ─────────────────────────────────────────────────────────────────────

export interface ArrangementClip {
  id: string;
  trackId: ArrangementTrackId;
  startBar: number;    // 0-indexed; 1 bar = 16 drum steps
  lengthBars: number;  // visual length; clip loops internally if pattern < lengthBars
  name: string;
  color?: string;      // hex override; falls back to track default
  data: ArrangementClipData;
}

// ─── Store ───────────────────────────────────────────────────────────────────

function newId(): string { return crypto.randomUUID(); }

/** Returns true if [aStart, aStart+aLen) overlaps [bStart, bStart+bLen) */
function overlaps(aStart: number, aLen: number, bStart: number, bLen: number): boolean {
  return aStart < bStart + bLen && aStart + aLen > bStart;
}

interface ArrangementState {
  clips: ArrangementClip[];
  totalBars: number;

  // ── Mutations ────────────────────────────────────────────────────────────
  /** Returns new clip id, or null if it would overlap an existing clip */
  addClip: (clip: Omit<ArrangementClip, "id">) => string | null;
  removeClip: (id: string) => void;
  /** Returns false if the new position would cause an overlap */
  moveClip: (id: string, startBar: number) => boolean;
  /** Returns false if the new length would cause an overlap */
  resizeClip: (id: string, lengthBars: number) => boolean;
  renameClip: (id: string, name: string) => void;
  setClipColor: (id: string, color: string) => void;
  updateClipData: (id: string, data: ArrangementClipData) => void;

  // ── Read helpers ─────────────────────────────────────────────────────────
  /** Clip covering `bar` on `trackId`, or null (= gap = silence) */
  getActiveClip: (trackId: ArrangementTrackId, bar: number) => ArrangementClip | null;
  /** True if adding/moving a clip to (trackId, startBar, lengthBars) would overlap */
  wouldOverlap: (trackId: ArrangementTrackId, startBar: number, lengthBars: number, excludeId?: string) => boolean;
}

export const useArrangementStore = create<ArrangementState>((set, get) => ({
  clips: [],
  totalBars: 16,

  addClip(clip) {
    if (get().wouldOverlap(clip.trackId, clip.startBar, clip.lengthBars)) return null;
    const id = newId();
    const newClip: ArrangementClip = { ...clip, id };
    const endBar = clip.startBar + clip.lengthBars;
    set((s) => ({
      clips: [...s.clips, newClip],
      totalBars: Math.max(s.totalBars, endBar + 4),
    }));
    return id;
  },

  removeClip(id) {
    set((s) => {
      const remaining = s.clips.filter((c) => c.id !== id);
      const maxBar = remaining.reduce(
        (m, c) => Math.max(m, c.startBar + c.lengthBars),
        0
      );
      return { clips: remaining, totalBars: Math.max(16, maxBar + 4) };
    });
  },

  moveClip(id, startBar) {
    const clip = get().clips.find((c) => c.id === id);
    if (!clip) return false;
    if (startBar < 0) return false;
    if (get().wouldOverlap(clip.trackId, startBar, clip.lengthBars, id)) return false;
    const endBar = startBar + clip.lengthBars;
    set((s) => ({
      clips: s.clips.map((c) => c.id === id ? { ...c, startBar } : c),
      totalBars: Math.max(s.totalBars, endBar + 4),
    }));
    return true;
  },

  resizeClip(id, lengthBars) {
    const clip = get().clips.find((c) => c.id === id);
    if (!clip) return false;
    if (lengthBars < 1) return false;
    if (get().wouldOverlap(clip.trackId, clip.startBar, lengthBars, id)) return false;
    const endBar = clip.startBar + lengthBars;
    set((s) => ({
      clips: s.clips.map((c) => c.id === id ? { ...c, lengthBars } : c),
      totalBars: Math.max(s.totalBars, endBar + 4),
    }));
    return true;
  },

  renameClip(id, name) {
    set((s) => ({ clips: s.clips.map((c) => c.id === id ? { ...c, name } : c) }));
  },

  setClipColor(id, color) {
    set((s) => ({ clips: s.clips.map((c) => c.id === id ? { ...c, color } : c) }));
  },

  updateClipData(id, data) {
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        if (data.kind !== c.trackId) return c; // guard: kind must match trackId
        return { ...c, data };
      }),
    }));
  },

  getActiveClip(trackId, bar) {
    return get().clips.find(
      (c) => c.trackId === trackId && bar >= c.startBar && bar < c.startBar + c.lengthBars
    ) ?? null;
  },

  wouldOverlap(trackId, startBar, lengthBars, excludeId) {
    return get().clips.some(
      (c) => c.trackId === trackId
          && c.id !== excludeId
          && overlaps(startBar, lengthBars, c.startBar, c.lengthBars)
    );
  },
}));
