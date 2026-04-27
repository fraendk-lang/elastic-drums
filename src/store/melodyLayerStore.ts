// src/store/melodyLayerStore.ts
import { create } from "zustand";

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
  cutoff: number;        // 0–1 (modulates preset's native cutoff proportionally)
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

const DEFAULT_SYNTH: LayerSynth = { presetIndex: 0, octaveOffset: 0, cutoff: 0.5 };

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

interface MelodyLayerState {
  enabled: boolean;
  layers: MelodyLayer[];
  activeLayerId: string;

  setEnabled: (v: boolean) => void;
  setActiveLayer: (id: string) => void;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Pick<MelodyLayer, "barLength" | "muted" | "soloed">>) => void;
  addNote: (layerId: string, note: MelodyLayerNote) => void;
  removeNote: (layerId: string, noteId: string) => void;
  updateNote: (layerId: string, noteId: string, patch: Partial<MelodyLayerNote>) => void;
  setSynth: (layerId: string, patch: Partial<LayerSynth>) => void;
  setSynthFull: (layerId: string, synth: LayerSynth) => void;
  clearNotes: (layerId: string) => void;
}

const initialLayer = makeLayer(0);

export const useMelodyLayerStore = create<MelodyLayerState>((set) => ({
  enabled: false,
  layers: [{ ...initialLayer }],
  activeLayerId: initialLayer.id,

  setEnabled: (v) => set({ enabled: v }),
  setActiveLayer: (id) => set({ activeLayerId: id }),

  addLayer: () => set((s) => {
    if (s.layers.length >= 4) return s;
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

  addNote: (layerId, note) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId
      ? { ...l, notes: [...l.notes, note] }
      : l
    ),
  })),

  removeNote: (layerId, noteId) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId
      ? { ...l, notes: l.notes.filter((n) => n.id !== noteId) }
      : l
    ),
  })),

  updateNote: (layerId, noteId, patch) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId
      ? { ...l, notes: l.notes.map((n) => n.id === noteId ? { ...n, ...patch } : n) }
      : l
    ),
  })),

  setSynth: (layerId, patch) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId
      ? { ...l, synth: { ...l.synth, ...patch } }
      : l
    ),
  })),

  setSynthFull: (layerId, synth) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId ? { ...l, synth: { ...synth } } : l),
  })),

  clearNotes: (layerId) => set((s) => ({
    layers: s.layers.map((l) => l.id === layerId ? { ...l, notes: [] } : l),
  })),
}));
