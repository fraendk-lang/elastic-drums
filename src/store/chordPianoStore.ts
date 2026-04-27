// src/store/chordPianoStore.ts

import { create } from "zustand";
import type { ChordSetId } from "../components/ChordPianoRoll/chordSets";

export interface ChordNote {
  id: string;
  pitch: number;         // MIDI 0–127
  startBeat: number;     // float beats, 0-indexed
  durationBeats: number; // min 0.25 (= 1/16 note)
  velocity: number;      // 0–127
  chordGroup: string;    // stable group ID (e.g. "Cneo-soul-7ths@0.00")
}

interface ChordPianoState {
  notes: ChordNote[];
  activeChordSet: ChordSetId;
  snapEnabled: boolean;
  snapResolution: 0.25 | 0.5 | 1; // beats: 1/16, 1/8, 1/4
  loopStart: number;               // beats
  loopEnd: number;                 // beats
  totalBeats: number;              // default 16
  chordsSource: "grid" | "piano" | "both";

  addNotes: (notes: ChordNote[]) => void;
  removeNote: (id: string) => void;
  removeGroup: (chordGroup: string) => void;
  updateNote: (id: string, patch: Partial<ChordNote>) => void;
  updateGroup: (chordGroup: string, patch: Partial<ChordNote>) => void;
  setActiveChordSet: (id: ChordSetId) => void;
  setSnapEnabled: (v: boolean) => void;
  setSnapResolution: (v: 0.25 | 0.5 | 1) => void;
  setLoopRange: (start: number, end: number) => void;
  setTotalBeats: (v: number) => void;
  setChordsSource: (v: "grid" | "piano" | "both") => void;
  clear: () => void;
}

export const useChordPianoStore = create<ChordPianoState>((set) => ({
  notes: [],
  activeChordSet: "neo-soul-7ths",
  snapEnabled: true,
  snapResolution: 0.25,
  loopStart: 0,
  loopEnd: 16,
  totalBeats: 16,
  chordsSource: "both",

  addNotes: (notes) => set((s) => ({ notes: [...s.notes, ...notes] })),
  removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
  removeGroup: (chordGroup) =>
    set((s) => ({ notes: s.notes.filter((n) => n.chordGroup !== chordGroup) })),
  updateNote: (id, patch) =>
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),
  updateGroup: (chordGroup, patch) =>
    set((s) => ({
      notes: s.notes.map((n) => (n.chordGroup === chordGroup ? { ...n, ...patch } : n)),
    })),
  setActiveChordSet: (id) => set({ activeChordSet: id }),
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  setSnapResolution: (v) => set({ snapResolution: v }),
  setLoopRange: (start, end) => set({ loopStart: start, loopEnd: end }),
  setTotalBeats: (v) => set({ totalBeats: v }),
  setChordsSource: (v) => set({ chordsSource: v }),
  clear: () => set({ notes: [] }),
}));
