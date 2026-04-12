import { create } from "zustand";

export interface StepData {
  active: boolean;
  velocity: number;
  microTiming: number;
  probability: number;
  paramLocks: Record<string, number>;
}

export interface TrackData {
  steps: StepData[];
  mute: boolean;
  solo: boolean;
  volume: number;
  pan: number;
}

export interface PatternData {
  name: string;
  tracks: TrackData[];
  length: number;
}

function createEmptyStep(): StepData {
  return {
    active: false,
    velocity: 100,
    microTiming: 0,
    probability: 100,
    paramLocks: {},
  };
}

function createEmptyTrack(): TrackData {
  return {
    steps: Array.from({ length: 64 }, createEmptyStep),
    mute: false,
    solo: false,
    volume: 100,
    pan: 0,
  };
}

function createEmptyPattern(): PatternData {
  return {
    name: "A01",
    tracks: Array.from({ length: 12 }, createEmptyTrack),
    length: 16,
  };
}

interface DrumStore {
  // Transport
  bpm: number;
  isPlaying: boolean;
  currentStep: number;

  // Selection
  selectedVoice: number;
  selectedPage: number;

  // Pattern
  pattern: PatternData;

  // Actions
  setBpm: (bpm: number) => void;
  togglePlay: () => void;
  setCurrentStep: (step: number) => void;
  setSelectedVoice: (voice: number) => void;
  setSelectedPage: (page: number) => void;
  toggleStep: (track: number, step: number) => void;
  triggerVoice: (voice: number) => void;
}

export const useDrumStore = create<DrumStore>((set) => ({
  bpm: 120,
  isPlaying: false,
  currentStep: 0,
  selectedVoice: 0,
  selectedPage: 0,
  pattern: createEmptyPattern(),

  setBpm: (bpm) => set({ bpm: Math.max(30, Math.min(300, bpm)) }),

  togglePlay: () =>
    set((state) => ({ isPlaying: !state.isPlaying, currentStep: 0 })),

  setCurrentStep: (currentStep) => set({ currentStep }),

  setSelectedVoice: (selectedVoice) => set({ selectedVoice }),

  setSelectedPage: (selectedPage) => set({ selectedPage }),

  toggleStep: (track, step) =>
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      const s = newPattern.tracks[track]!.steps[step]!;
      s.active = !s.active;
      return { pattern: newPattern };
    }),

  triggerVoice: (_voice) => {
    // TODO: Trigger audio engine voice
  },
}));
