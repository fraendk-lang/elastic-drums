// src/store/melodyLayerStore.ts
import { create } from "zustand";
import { generateEuclidean } from "./drumStore";
import { SCALES } from "../audio/BassEngine";

export const LAYER_COLORS = ["#f472b6", "#22c55e", "#a78bfa", "#f97316"] as const;

export interface MelodyLayerNote {
  id: string;
  startBeat: number;     // beat within this layer's own bar window (0 to barLength*4)
  durationBeats: number;
  pitch: number;         // MIDI 48–84 (C3–C6)
}

export interface LayerSynth {
  presetIndex: number;   // index into MELODY_PRESETS
  octaveOffset: number;  // -2 to +2
  // Filter
  cutoff: number;        // 0–1 (modulates preset's native cutoff proportionally)
  resonance: number;     // 0–1 (maps to 0–30 Q)
  envMod: number;        // 0–1 filter envelope depth
  filterDecay: number;   // ms 50–800
  // Amp ADSR
  attack: number;        // ms 1–500
  decay: number;         // ms 1–500
  sustain: number;       // 0–1
  release: number;       // ms 1–2000
  // Extra
  distortion: number;    // 0–1
  // Output / sends
  volume: number;        // 0–1 output level
  reverbSend: number;    // 0–1 send to reverb bus
  delaySend: number;     // 0–1 send to delay bus
  // Space FX
  shimmerEnabled: boolean; // shimmer reverb on/off
  shimmerDepth: number;    // 0–1 shimmer send depth
  shimmerFeedback: number; // 0–1 shimmer feedback (brightness accumulation)
  pitchGlide: number;      // semitones/second upward pitch drift (0 = off)
}

export interface MelodyLayer {
  id: string;
  colorIndex: 0 | 1 | 2 | 3;
  barLength: 1 | 2 | 4 | 8;
  notes: MelodyLayerNote[];
  synth: LayerSynth;
  muted: boolean;
  soloed: boolean;
}

export const DEFAULT_SYNTH: LayerSynth = {
  presetIndex: 0,
  octaveOffset: 0,
  cutoff: 0.5,
  resonance: 0.27,   // ~8/30
  envMod: 0.4,
  filterDecay: 150,
  attack: 5,
  decay: 50,
  sustain: 1.0,
  release: 80,
  distortion: 0.15,
  volume: 0.7,
  reverbSend: 0.0,
  delaySend: 0.0,
  shimmerEnabled: false,
  shimmerDepth: 0.5,
  shimmerFeedback: 0.28,
  pitchGlide: 0,
};

function makeLayer(colorIndex: 0 | 1 | 2 | 3): MelodyLayer {
  return {
    id: crypto.randomUUID(),
    colorIndex,
    barLength: 2,
    notes: [],
    synth: { ...DEFAULT_SYNTH },
    muted: false,
    soloed: false,
  };
}

// ─── History (module-level, outside Zustand to avoid re-renders) ────────────
// Only layers[] is snapshotted — playback/transport state is excluded.
const HISTORY_MAX = 50;
const _past: MelodyLayer[][] = [];
const _future: MelodyLayer[][] = [];
let _historyPaused = false;

function pushHistory(layers: MelodyLayer[]): void {
  if (_historyPaused) return;
  _past.push(layers.map((l) => ({ ...l, notes: [...l.notes] })));
  if (_past.length > HISTORY_MAX) _past.shift();
  _future.length = 0; // clear redo stack on new action
}

/** Call before starting a continuous drag — snapshots current state once,
 *  then pauses history so every mousemove doesn't flood the stack. */
export function beginDragEdit(): void {
  const layers = useMelodyLayerStore.getState().layers;
  pushHistory(layers);   // one snapshot for the whole drag
  _historyPaused = true;
}

/** Call on pointerUp / pointerLeave to re-enable per-action history. */
export function endDragEdit(): void {
  _historyPaused = false;
}

interface MelodyLayerState {
  enabled: boolean;
  layers: MelodyLayer[];
  activeLayerId: string;
  selectedNoteId: string | null;  // globally selected note (for arrow-key editing)

  setEnabled: (v: boolean) => void;
  setActiveLayer: (id: string) => void;
  setSelectedNote: (id: string | null) => void;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Pick<MelodyLayer, "barLength" | "muted" | "soloed">>) => void;
  addNote: (layerId: string, note: MelodyLayerNote) => void;
  removeNote: (layerId: string, noteId: string) => void;
  updateNote: (layerId: string, noteId: string, patch: Partial<MelodyLayerNote>) => void;
  setSynth: (layerId: string, patch: Partial<LayerSynth>) => void;
  setSynthFull: (layerId: string, synth: LayerSynth) => void;
  clearNotes: (layerId: string) => void;
  applyLayerEuclidean: (
    pulses: number,
    eucSteps: number,
    rotation: number,
    noteMode: string,
    scaleName: string,
    rootNote: number,
    accentPulses?: number,
    accentRotation?: number,
  ) => void;
  undo: () => void;
  redo: () => void;
}

// Start with 2 layers so polymeter is immediately audible:
// Layer 0 = 2-bar Classic Lead, Layer 1 = 4-bar FM Bell
const initialLayer0: MelodyLayer = { ...makeLayer(0), barLength: 2, synth: { ...DEFAULT_SYNTH, presetIndex: 0 } };
const initialLayer1: MelodyLayer = { ...makeLayer(1), barLength: 4, synth: { ...DEFAULT_SYNTH, presetIndex: 2 } };

export const useMelodyLayerStore = create<MelodyLayerState>((set) => ({
  enabled: false,
  layers: [{ ...initialLayer0 }, { ...initialLayer1 }],
  activeLayerId: initialLayer0.id,
  selectedNoteId: null,

  setEnabled: (v) => set({ enabled: v }),
  setActiveLayer: (id) => set({ activeLayerId: id, selectedNoteId: null }),
  setSelectedNote: (id) => set({ selectedNoteId: id }),

  addLayer: () => set((s) => {
    // Max 3 layers: each uses engines 1–3 (engine 0 reserved for step-sequencer)
    if (s.layers.length >= 3) return s;
    const colorIndex = s.layers.length as 0 | 1 | 2 | 3;
    const newLayer = makeLayer(colorIndex);
    return { layers: [...s.layers, newLayer], activeLayerId: newLayer.id };
  }),

  removeLayer: (id) => set((s) => {
    if (s.layers.length <= 1) return s;
    const newLayers = s.layers.filter((l) => l.id !== id);
    const newActiveId = s.activeLayerId === id
      ? (newLayers[newLayers.length - 1]!.id)
      : s.activeLayerId;
    return { layers: newLayers, activeLayerId: newActiveId };
  }),

  updateLayer: (id, patch) => set((s) => ({
    layers: s.layers.map((l) => l.id === id ? { ...l, ...patch } : l),
  })),

  addNote: (layerId, note) => set((s) => {
    pushHistory(s.layers);
    return { layers: s.layers.map((l) => l.id === layerId ? { ...l, notes: [...l.notes, note] } : l) };
  }),

  removeNote: (layerId, noteId) => set((s) => {
    pushHistory(s.layers);
    return {
      layers: s.layers.map((l) => l.id === layerId ? { ...l, notes: l.notes.filter((n) => n.id !== noteId) } : l),
      selectedNoteId: s.selectedNoteId === noteId ? null : s.selectedNoteId,
    };
  }),

  updateNote: (layerId, noteId, patch) => set((s) => {
    pushHistory(s.layers);
    return {
      layers: s.layers.map((l) => l.id === layerId
        ? { ...l, notes: l.notes.map((n) => n.id === noteId ? { ...n, ...patch } : n) }
        : l
      ),
    };
  }),

  setSynth: (layerId, patch) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId
      ? { ...l, synth: { ...l.synth, ...patch } }
      : l
    ),
  })),

  setSynthFull: (layerId, synth) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId ? { ...l, synth: { ...synth } } : l),
  })),

  clearNotes: (layerId) => set((s) => {
    pushHistory(s.layers);
    return { layers: s.layers.map((l) => l.id === layerId ? { ...l, notes: [] } : l) };
  }),

  undo: () => set((s) => {
    const prev = _past.pop();
    if (!prev) return s;
    _future.push(s.layers.map((l) => ({ ...l, notes: [...l.notes] })));
    return { layers: prev, selectedNoteId: null };
  }),

  redo: () => set((s) => {
    const next = _future.pop();
    if (!next) return s;
    _past.push(s.layers.map((l) => ({ ...l, notes: [...l.notes] })));
    return { layers: next, selectedNoteId: null };
  }),

  applyLayerEuclidean: (pulses, eucSteps, rotation, noteMode, scaleName, rootNote, accentPulses = 0, accentRotation = 0) =>
    set((s) => {
      pushHistory(s.layers);
      const layer = s.layers.find((l) => l.id === s.activeLayerId);
      if (!layer) return s;

      const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
      const rhythm = generateEuclidean(pulses, eucSteps, rotation);
      const accent = accentPulses > 0 ? generateEuclidean(accentPulses, eucSteps, accentRotation) : null;

      const totalBeats = layer.barLength * 4;
      // Beat position per euclidean slot, snapped to 1/16 grid
      const beatsPerSlot = totalBeats / eucSteps;
      // Note duration fills the slot but snaps to 1/4 beat minimum
      const durationBeats = Math.max(0.25, Math.round(beatsPerSlot * 4) / 4);

      // Root MIDI: rootNote is a full MIDI note (e.g. 36 = C2, 37 = C#2 …).
      // We only need the pitch class (semitone within octave), anchored to C4=60
      // so generated notes land in the middle of the 48–84 playable range.
      const rootMidi = 60 + (rootNote % 12);
      const scaleLen = scale.length;
      let walkCursor = 0;
      let noteIndex = 0;

      const notes: MelodyLayerNote[] = [];

      for (let i = 0; i < eucSteps; i++) {
        if (!rhythm[i % rhythm.length]) continue;

        // Pitch: scale degree from noteMode
        let interval = 0;
        if (noteMode === "ascending") {
          interval = scale[noteIndex % scaleLen] ?? 0;
        } else if (noteMode === "random") {
          interval = scale[Math.floor(Math.random() * scaleLen)] ?? 0;
        } else if (noteMode === "walk") {
          const dir = Math.random() < 0.5 ? -1 : 1;
          walkCursor = Math.max(0, Math.min(scaleLen - 1, walkCursor + dir));
          interval = scale[walkCursor] ?? 0;
        } else if (noteMode === "alternate") {
          interval = scale[(noteIndex % 2 === 0) ? 0 : Math.min(4, scaleLen - 1)] ?? 0;
        } else if (noteMode === "pentatonic") {
          const pent = [0, 2, 4, 2].filter((d) => d < scaleLen);
          interval = scale[pent[noteIndex % pent.length] ?? 0] ?? 0;
        }
        // else "root" → interval stays 0

        noteIndex++;

        // Clamp pitch to MIDI 48–84 (C3–C6), shift by octaves if needed
        let pitch = rootMidi + interval;
        while (pitch > 84) pitch -= 12;
        while (pitch < 48) pitch += 12;

        const startBeat = Math.round(i * beatsPerSlot * 4) / 4;
        const isAccent = accent ? (accent[i % accent.length] ?? false) : false;
        void isAccent; // accent info available for future velocity support

        notes.push({ id: crypto.randomUUID(), startBeat, durationBeats, pitch });
      }

      return {
        layers: s.layers.map((l) => l.id === s.activeLayerId ? { ...l, notes } : l),
      };
    }),
}));
