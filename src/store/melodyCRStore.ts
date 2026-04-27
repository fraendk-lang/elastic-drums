import { create } from "zustand";

export interface MelodyCRNote {
  id: string;           // crypto.randomUUID()
  startBeat: number;    // beat position within this voice's own bar window
  durationBeats: number;
  pitch: number;        // MIDI 0–127
}

export interface SynthSettings {
  presetIndex: number;   // index into MELODY_PRESETS
  octaveOffset: number;  // -2 to +2 (added to pitch at trigger time as semitones * 12)
  cutoff: number;        // 0–1 (mapped to 200–12000 Hz at trigger time)
  linkToCall: boolean;   // Response only: when true, mirrors callSynth at trigger time
}

const DEFAULT_SYNTH: SynthSettings = {
  presetIndex: 0,
  octaveOffset: 0,
  cutoff: 0.5,
  linkToCall: false,
};

interface MelodyCRState {
  enabled: boolean;
  barLength: 1 | 2 | 4;
  activeVoice: "call" | "response";
  callNotes: MelodyCRNote[];
  responseNotes: MelodyCRNote[];
  callSynth: SynthSettings;
  responseSynth: SynthSettings;
  rootNote: number;  // 0–11, for piano roll highlighting (0=C)

  // Actions
  setEnabled: (v: boolean) => void;
  setBarLength: (bars: 1 | 2 | 4) => void;
  setActiveVoice: (v: "call" | "response") => void;
  addCallNote: (n: MelodyCRNote) => void;
  addResponseNote: (n: MelodyCRNote) => void;
  removeCallNote: (id: string) => void;
  removeResponseNote: (id: string) => void;
  updateCallNote: (id: string, patch: Partial<MelodyCRNote>) => void;
  updateResponseNote: (id: string, patch: Partial<MelodyCRNote>) => void;
  setCallSynth: (patch: Partial<SynthSettings>) => void;
  setResponseSynth: (patch: Partial<SynthSettings>) => void;
  setCallSynthFull: (s: SynthSettings) => void;
  setResponseSynthFull: (s: SynthSettings) => void;
  clearCallNotes: () => void;
  clearResponseNotes: () => void;
  setRootNote: (n: number) => void;
}

export const useMelodyCRStore = create<MelodyCRState>((set) => ({
  enabled: false,
  barLength: 2,
  activeVoice: "call",
  callNotes: [],
  responseNotes: [],
  callSynth: { ...DEFAULT_SYNTH },
  responseSynth: { ...DEFAULT_SYNTH, linkToCall: false },
  rootNote: 0,

  setEnabled: (v) => set({ enabled: v }),
  setBarLength: (bars) => set({ barLength: bars }),
  setActiveVoice: (v) => set({ activeVoice: v }),
  addCallNote: (n) => set((s) => ({ callNotes: [...s.callNotes, n] })),
  addResponseNote: (n) => set((s) => ({ responseNotes: [...s.responseNotes, n] })),
  removeCallNote: (id) => set((s) => ({ callNotes: s.callNotes.filter((n) => n.id !== id) })),
  removeResponseNote: (id) => set((s) => ({ responseNotes: s.responseNotes.filter((n) => n.id !== id) })),
  updateCallNote: (id, patch) => set((s) => ({
    callNotes: s.callNotes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  })),
  updateResponseNote: (id, patch) => set((s) => ({
    responseNotes: s.responseNotes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  })),
  setCallSynth: (patch) => set((s) => ({ callSynth: { ...s.callSynth, ...patch } })),
  setResponseSynth: (patch) => set((s) => ({ responseSynth: { ...s.responseSynth, ...patch } })),
  setCallSynthFull: (s) => set({ callSynth: { ...s } }),
  setResponseSynthFull: (s) => set({ responseSynth: { ...s } }),
  clearCallNotes: () => set({ callNotes: [] }),
  clearResponseNotes: () => set({ responseNotes: [] }),
  setRootNote: (n) => set({ rootNote: n }),
}));
