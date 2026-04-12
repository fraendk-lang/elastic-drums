/**
 * Bass Sequencer Store
 *
 * Separate from drum store — independent 16-step bass sequencer
 * with note, octave, accent, slide per step.
 */

import { create } from "zustand";
import { bassEngine, scaleNote, type BassStep, type BassParams, DEFAULT_BASS_PARAMS } from "../audio/BassEngine";
import { audioEngine } from "../audio/AudioEngine";

interface BassStore {
  steps: BassStep[];
  length: number;
  currentStep: number;
  rootNote: number;    // MIDI note (36=C2, 48=C3, etc.)
  rootName: string;    // Display name
  scaleName: string;
  params: BassParams;
  isPlaying: boolean;

  // Actions
  toggleStep: (step: number) => void;
  setStepNote: (step: number, note: number) => void;
  setStepOctave: (step: number, octave: number) => void;
  toggleAccent: (step: number) => void;
  toggleSlide: (step: number) => void;
  setRootNote: (midi: number, name: string) => void;
  setScale: (name: string) => void;
  setParam: (key: keyof BassParams, value: number | string) => void;
  setLength: (len: number) => void;
  clearSteps: () => void;
  randomize: () => void;
}

function createEmptySteps(): BassStep[] {
  return Array.from({ length: 16 }, () => ({
    active: false,
    note: 0,
    octave: 0,
    accent: false,
    slide: false,
  }));
}

// Bass scheduler (runs alongside drum scheduler)
let bassTimer: ReturnType<typeof setInterval> | null = null;
let nextBassStepTime = 0;

export function startBassScheduler() {
  nextBassStepTime = audioEngine.currentTime + 0.05;

  if (bassTimer !== null) clearInterval(bassTimer);

  bassTimer = setInterval(() => {
    const drumState = (window as unknown as { __drumStore?: { getState: () => { bpm: number; isPlaying: boolean } } }).__drumStore?.getState();

    // Sync with drum transport
    if (!drumState?.isPlaying) return;

    const bpm = drumState.bpm;
    const secondsPerStep = 60.0 / bpm / 4;

    while (nextBassStepTime < audioEngine.currentTime + 0.1) {
      const { steps, currentStep, length, rootNote, scaleName } = useBassStore.getState();
      const step = steps[currentStep % length];

      if (step?.active) {
        const midiNote = scaleNote(rootNote, scaleName, step.note, step.octave);
        bassEngine.triggerNote(midiNote, nextBassStepTime, step.accent, step.slide);
      } else {
        bassEngine.rest(nextBassStepTime);
      }

      const nextStep = (currentStep + 1) % length;
      useBassStore.setState({ currentStep: nextStep });
      nextBassStepTime += secondsPerStep;
    }
  }, 25);
}

export function stopBassScheduler() {
  if (bassTimer !== null) {
    clearInterval(bassTimer);
    bassTimer = null;
  }
}

export const useBassStore = create<BassStore>((set, get) => ({
  steps: createEmptySteps(),
  length: 16,
  currentStep: 0,
  rootNote: 36,    // C2
  rootName: "C",
  scaleName: "Minor",
  params: { ...DEFAULT_BASS_PARAMS },
  isPlaying: false,

  toggleStep: (step) => set((s) => {
    const newSteps = [...s.steps];
    newSteps[step] = { ...newSteps[step]!, active: !newSteps[step]!.active };
    return { steps: newSteps };
  }),

  setStepNote: (step, note) => set((s) => {
    const newSteps = [...s.steps];
    newSteps[step] = { ...newSteps[step]!, note };
    return { steps: newSteps };
  }),

  setStepOctave: (step, octave) => set((s) => {
    const newSteps = [...s.steps];
    newSteps[step] = { ...newSteps[step]!, octave };
    return { steps: newSteps };
  }),

  toggleAccent: (step) => set((s) => {
    const newSteps = [...s.steps];
    newSteps[step] = { ...newSteps[step]!, accent: !newSteps[step]!.accent };
    return { steps: newSteps };
  }),

  toggleSlide: (step) => set((s) => {
    const newSteps = [...s.steps];
    newSteps[step] = { ...newSteps[step]!, slide: !newSteps[step]!.slide };
    return { steps: newSteps };
  }),

  setRootNote: (midi, name) => set({ rootNote: midi, rootName: name }),
  setScale: (name) => set({ scaleName: name }),

  setParam: (key, value) => {
    const p = { ...get().params, [key]: value };
    set({ params: p });
    bassEngine.setParams({ [key]: value });
  },

  setLength: (len) => set({ length: Math.max(4, Math.min(16, len)) }),

  clearSteps: () => set({ steps: createEmptySteps() }),

  randomize: () => {
    const { } = get(); void 0;
    const scale = [0, 1, 2, 3, 4, 5, 6]; // Scale degrees
    const newSteps = createEmptySteps();
    for (let i = 0; i < 16; i++) {
      newSteps[i] = {
        active: Math.random() > 0.35,
        note: scale[Math.floor(Math.random() * scale.length)]!,
        octave: Math.random() > 0.7 ? (Math.random() > 0.5 ? 1 : -1) : 0,
        accent: Math.random() > 0.7,
        slide: Math.random() > 0.6,
      };
    }
    set({ steps: newSteps });
  },
}));
