/**
 * Chords Sequencer Store
 *
 * 64-step chord sequencer (4 pages of 16) with note, chordType, octave, accent, tie.
 * Includes factory presets, genre-aware chordline generator, and Euclidean rhythms.
 */

import { create } from "zustand";
import {
  chordsEngine,
  CHORD_TYPES,
  type ChordsStep,
  type ChordsParams,
  DEFAULT_CHORDS_PARAMS,
} from "../audio/ChordsEngine";
import { scaleNote, SCALES } from "../audio/BassEngine";
import { audioEngine } from "../audio/AudioEngine";
import { soundFontEngine } from "../audio/SoundFontEngine";
import { generateEuclidean } from "./drumStore";
import { syncScaleToOtherStores, registerScaleStore } from "./bassStore";

// ─── Chord Type Names (for cycling) ────────────────────────

export const CHORD_TYPE_NAMES = Object.keys(CHORD_TYPES);

// ─── Factory Sound Presets ───────────────────────────────

export interface ChordsPreset {
  name: string;
  params: ChordsParams;
}

const cp = (p: Partial<ChordsParams>): ChordsParams => ({ ...DEFAULT_CHORDS_PARAMS, ...p });

// Factory helper to ensure filterModel is set (for backward compatibility)
function ensureFilterModel(p: ChordsParams): ChordsParams {
  return { ...p, filterModel: p.filterModel || "lpf" };
}

export const CHORDS_PRESETS: ChordsPreset[] = [
  // ── Professional Pads ──
  { name: "Warm Analog Pad", params: cp({ waveform: "sawtooth", filterModel: "ladder", cutoff: 800, resonance: 2, envMod: 0.15, attack: 100, release: 600, detune: 20, distortion: 0, volume: 0.5, subOsc: 0.3, chorus: 0.4, spread: 0.6, brightness: 0.2 }) },
  { name: "Glass Keys", params: cp({ waveform: "triangle", filterModel: "steiner-bp", cutoff: 3000, resonance: 3, envMod: 0.05, attack: 50, release: 800, detune: 8, distortion: 0, volume: 0.45, subOsc: 0, chorus: 0.2, spread: 0.4, brightness: 0.7 }) },
  { name: "Reese Pad", params: cp({ waveform: "sawtooth", filterModel: "ladder", cutoff: 1200, resonance: 12, envMod: 0.3, attack: 150, release: 1000, detune: 18, distortion: 0.05, volume: 0.5, subOsc: 0.2, chorus: 0.6, spread: 0.7, brightness: 0.25 }) },
  { name: "Ambient Wash", params: cp({ waveform: "triangle", filterModel: "lpf", cutoff: 600, resonance: 1, envMod: 0.08, attack: 250, release: 2000, detune: 30, distortion: 0, volume: 0.35, subOsc: 0.4, chorus: 0.5, spread: 1.0, brightness: 0.1 }) },
  { name: "Dark Strings", params: cp({ waveform: "sawtooth", filterModel: "ladder", cutoff: 900, resonance: 4, envMod: 0.2, attack: 120, release: 900, detune: 15, distortion: 0.08, volume: 0.48, subOsc: 0.25, chorus: 0.35, spread: 0.8, brightness: 0.15 }) },
  // ── Classic Pads (original) ──
  { name: "Ethereal Pad", params: cp({ waveform: "triangle", filterModel: "lpf", cutoff: 1200, resonance: 4, envMod: 0.08, attack: 300, release: 2000, detune: 30, distortion: 0, volume: 0.35, subOsc: 0.6, chorus: 0.3, spread: 0.5, brightness: 0.3 }) },
  { name: "String Machine", params: cp({ waveform: "sawtooth", filterModel: "lpf", cutoff: 900, resonance: 2, envMod: 0.12, attack: 120, release: 800, detune: 18, distortion: 0.05, volume: 0.5, subOsc: 0.2, chorus: 0.3, spread: 0.5, brightness: 0.3 }) },
  { name: "Glass Pad", params: cp({ waveform: "triangle", filterModel: "steiner-lp", cutoff: 2500, resonance: 8, envMod: 0.05, attack: 150, release: 1200, detune: 10, distortion: 0, volume: 0.4, subOsc: 0, chorus: 0.3, spread: 0.5, brightness: 0.3 }) },
  // ── Stabs ──
  { name: "Bright Stabs", params: cp({ waveform: "sawtooth", cutoff: 2000, resonance: 8, envMod: 0.5, attack: 5, release: 100, detune: 8, distortion: 0.2, volume: 0.5, subOsc: 0 }) },
  { name: "Techno Stabs", params: cp({ waveform: "square", cutoff: 1800, resonance: 12, envMod: 0.7, attack: 3, release: 80, detune: 3, distortion: 0.3, volume: 0.5, subOsc: 0 }) },
  { name: "House Organ", params: cp({ waveform: "sawtooth", cutoff: 1600, resonance: 6, envMod: 0.4, attack: 8, release: 120, detune: 6, distortion: 0.1, volume: 0.5, subOsc: 0.15 }) },
  { name: "Disco Chords", params: cp({ waveform: "sawtooth", cutoff: 1500, resonance: 10, envMod: 0.6, attack: 10, release: 150, detune: 5, distortion: 0.15, volume: 0.5, subOsc: 0 }) },
  { name: "Funk Clav", params: cp({ waveform: "square", cutoff: 2200, resonance: 9, envMod: 0.6, attack: 2, release: 60, detune: 2, distortion: 0.25, volume: 0.55, subOsc: 0 }) },
  // ── Dirty / Heavy ──
  { name: "Power Chords", params: cp({ waveform: "sawtooth", cutoff: 1200, resonance: 6, envMod: 0.4, attack: 8, release: 200, detune: 12, distortion: 0.5, volume: 0.55, subOsc: 0.3 }) },
  { name: "Industrial Stab", params: cp({ waveform: "square", cutoff: 800, resonance: 14, envMod: 0.65, attack: 2, release: 50, detune: 4, distortion: 0.7, volume: 0.45, subOsc: 0 }) },
  { name: "Rave Organ", params: cp({ waveform: "sawtooth", cutoff: 1400, resonance: 15, envMod: 0.55, attack: 5, release: 90, detune: 8, distortion: 0.4, volume: 0.5, subOsc: 0.1 }) },
  // ── Lo-Fi / Retro ──
  { name: "Lo-Fi Chords", params: cp({ waveform: "square", cutoff: 500, resonance: 4, envMod: 0.2, attack: 30, release: 300, detune: 30, distortion: 0.4, volume: 0.45, subOsc: 0.6 }) },
  { name: "VHS Nostalgia", params: cp({ waveform: "sawtooth", cutoff: 650, resonance: 5, envMod: 0.18, attack: 60, release: 450, detune: 35, distortion: 0.25, volume: 0.45, subOsc: 0.4 }) },
  { name: "Chip Arps", params: cp({ waveform: "square", cutoff: 3000, resonance: 3, envMod: 0.3, attack: 2, release: 70, detune: 0, distortion: 0.1, volume: 0.5, subOsc: 0 }) },
  // ── Genre ──
  { name: "Trance Supersaw", params: cp({ waveform: "sawtooth", cutoff: 1100, resonance: 5, envMod: 0.3, attack: 15, release: 250, detune: 22, distortion: 0.15, volume: 0.5, subOsc: 0.2 }) },
  { name: "Deep House", params: cp({ waveform: "sawtooth", cutoff: 700, resonance: 7, envMod: 0.35, attack: 20, release: 180, detune: 12, distortion: 0.08, volume: 0.5, subOsc: 0.25 }) },
  { name: "Garage Stab", params: cp({ waveform: "sawtooth", cutoff: 1800, resonance: 11, envMod: 0.55, attack: 4, release: 110, detune: 7, distortion: 0.2, volume: 0.5, subOsc: 0 }) },
  { name: "Dub Swell", params: cp({ waveform: "triangle", cutoff: 500, resonance: 8, envMod: 0.25, attack: 100, release: 600, detune: 20, distortion: 0.05, volume: 0.45, subOsc: 0.5 }) },
  // ── Professional New Presets ──
  { name: "Vintage Keys", params: cp({ waveform: "triangle", filterModel: "ladder", cutoff: 1500, resonance: 3, envMod: 0.1, attack: 10, release: 200, detune: 5, distortion: 0, volume: 0.55, subOsc: 0.1, chorus: 0, spread: 0.3, brightness: 0.2 }) },
  { name: "Lush Pad", params: cp({ waveform: "sawtooth", filterModel: "ladder", cutoff: 1000, resonance: 5, envMod: 0.25, attack: 200, release: 1500, detune: 35, distortion: 0.05, volume: 0.5, subOsc: 0.3, chorus: 0.8, spread: 0.9, brightness: 0.7 }) },
  { name: "Vintage Strings", params: cp({ waveform: "sawtooth", filterModel: "ladder", cutoff: 4000, resonance: 2, envMod: 0.1, attack: 200, release: 1200, detune: 8, distortion: 0.04, volume: 0.65, subOsc: 0.15, chorus: 0.7, spread: 0.85, brightness: 0.35 }) },
  // ── Comprehensive Designer Presets ──
  { name: "Juno Strings", params: cp({ waveform: "sawtooth", cutoff: 4000, resonance: 2, envMod: 0.15, attack: 400, release: 1200, detune: 8, distortion: 0, volume: 0.65, subOsc: 0, chorus: 0.7, spread: 0.8, brightness: 0.3 }) },
  { name: "Dream Pad", params: cp({ waveform: "sawtooth", cutoff: 3000, resonance: 2, envMod: 0.15, attack: 350, release: 1500, detune: 15, distortion: 0, volume: 0.6, subOsc: 0.2, chorus: 0.6, spread: 0.9, brightness: 0.2 }) },
  { name: "Analog Pad", params: cp({ waveform: "sawtooth", cutoff: 2000, resonance: 2, envMod: 0.15, attack: 300, release: 800, detune: 8, distortion: 0.08, volume: 0.55, subOsc: 0.3, chorus: 0, spread: 0.3, brightness: 0.1 }) },
  { name: "Glass Pad", params: cp({ waveform: "triangle", cutoff: 5000, resonance: 3, envMod: 0.1, attack: 250, release: 1000, detune: 5, distortion: 0, volume: 0.6, subOsc: 0, chorus: 0.2, spread: 0.3, brightness: 0.6 }) },
  { name: "Dark Pad", params: cp({ waveform: "sawtooth", cutoff: 2000, resonance: 2, envMod: 0.1, attack: 150, release: 900, detune: 3, distortion: 0, volume: 0.5, subOsc: 0, chorus: 0.5, spread: 0.5, brightness: 0 }) },
  { name: "Choir Pad", params: cp({ waveform: "sawtooth", cutoff: 3000, resonance: 2, envMod: 0.15, attack: 400, release: 1200, detune: 10, distortion: 0, volume: 0.6, subOsc: 0, chorus: 0.3, spread: 0.9, brightness: 0.4 }) },
  { name: "Cinematic Pad", params: cp({ waveform: "sawtooth", cutoff: 5000, resonance: 2, envMod: 0.2, attack: 500, release: 2000, detune: 25, distortion: 0, volume: 0.6, subOsc: 0.1, chorus: 0.4, spread: 0.8, brightness: 0.5 }) },
  { name: "PWM Pad", params: cp({ waveform: "square", cutoff: 3000, resonance: 2, envMod: 0.15, attack: 300, release: 1000, detune: 8, distortion: 0, volume: 0.55, subOsc: 0.2, chorus: 0.6, spread: 0.5, brightness: 0.2 }) },
  { name: "Ambient Wash", params: cp({ waveform: "sawtooth", cutoff: 6000, resonance: 1, envMod: 0.1, attack: 500, release: 2000, detune: 12, distortion: 0, volume: 0.45, subOsc: 0.3, chorus: 0.3, spread: 1.0, brightness: 0.3 }) },
  { name: "Soft Keys", params: cp({ waveform: "triangle", cutoff: 2000, resonance: 1, envMod: 0.08, attack: 80, release: 400, detune: 2, distortion: 0, volume: 0.55, subOsc: 0, chorus: 0, spread: 0.2, brightness: 0.1 }) },
];

// ─── Chordline Agent: Genre Strategies ──────────────────

export interface ChordlineStrategy {
  name: string;
  generate: (length: number, scaleLen: number) => ChordsStep[];
}

function makeStep(note: number, chordType: string, opts?: Partial<ChordsStep>): ChordsStep {
  return { active: true, note, chordType, octave: 0, accent: false, tie: false, ...opts };
}

function emptyStep(): ChordsStep {
  return { active: false, note: 0, chordType: "Min", octave: 0, accent: false, tie: false };
}

function prob(p: number): boolean { return Math.random() < p; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

export const CHORDLINE_STRATEGIES: ChordlineStrategy[] = [
  {
    name: "Pop",
    generate: (len, scaleLen) => {
      // Simple I-IV-V-I progressions, Maj/Min chords, density ~30%
      const steps: ChordsStep[] = [];
      const progDegrees = [0, Math.min(3, scaleLen - 1), Math.min(4, scaleLen - 1), 0];
      const progChords = ["Maj", "Maj", "Maj", "Maj"];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (i % 4 === 0 && prob(0.7)) {
          const progIdx = Math.floor((i % 16) / 4) % progDegrees.length;
          const chordType = prob(0.3) ? "Min" : progChords[progIdx]!;
          steps.push(makeStep(progDegrees[progIdx]!, chordType, {
            accent: i % 16 === 0,
            tie: prob(0.3),
          }));
        } else if (prob(0.1)) {
          steps.push(makeStep(Math.floor(Math.random() * Math.min(scaleLen, 5)), pick(["Maj", "Min"]), {
            tie: prob(0.4),
          }));
        } else {
          steps.push(emptyStep());
        }
      }
      return steps;
    },
  },
  {
    name: "House",
    generate: (len, scaleLen) => {
      // 4-on-floor stabs, Maj7/Min7, medium density
      const steps: ChordsStep[] = [];
      const chordTypes = ["Maj7", "Min7", "7th", "Min7"];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        // Stabs on beats and some offbeats
        if (i % 4 === 0 && prob(0.8)) {
          const note = Math.floor(Math.random() * Math.min(scaleLen, 5));
          steps.push(makeStep(note, pick(chordTypes), {
            accent: i % 8 === 0,
          }));
        } else if (i % 2 === 0 && prob(0.25)) {
          steps.push(makeStep(0, pick(["Min7", "Maj7"]), {
            accent: false,
          }));
        } else {
          steps.push(emptyStep());
        }
      }
      return steps;
    },
  },
  {
    name: "Ambient",
    generate: (len, scaleLen) => {
      // Very sparse, Maj7/Sus4/Add9, lots of ties
      const steps: ChordsStep[] = [];
      const chordTypes = ["Maj7", "Sus4", "Add9", "Sus2", "Min9"];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (i % 8 === 0 && prob(0.6)) {
          const note = Math.floor(Math.random() * Math.min(scaleLen, 4));
          steps.push(makeStep(note, pick(chordTypes), {
            tie: prob(0.7),
            octave: prob(0.2) ? -1 : 0,
          }));
        } else if (prob(0.05)) {
          steps.push(makeStep(0, pick(chordTypes), { tie: true }));
        } else {
          steps.push(emptyStep());
        }
      }
      return steps;
    },
  },
  {
    name: "Funk",
    generate: (len, scaleLen) => {
      // Syncopated, Min7/7th, offbeat placement
      const steps: ChordsStep[] = [];
      const chordTypes = ["Min7", "7th", "9th", "Min9"];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        const offbeat = i % 2 === 1;
        if (offbeat && prob(0.45)) {
          const note = Math.floor(Math.random() * Math.min(scaleLen, 5));
          steps.push(makeStep(note, pick(chordTypes), {
            accent: prob(0.15),
            tie: prob(0.2),
          }));
        } else if (i % 4 === 0 && prob(0.3)) {
          steps.push(makeStep(0, pick(["Min7", "7th"]), {
            accent: prob(0.3),
          }));
        } else {
          steps.push(emptyStep());
        }
      }
      return steps;
    },
  },
  {
    name: "Minimal",
    generate: (len, scaleLen) => {
      // Root + 5th-based, sparse, mostly Maj/Min
      const steps: ChordsStep[] = [];
      const notes = [0, Math.min(4, scaleLen - 1)]; // Root + 5th
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (i % 8 === 0 && prob(0.7)) {
          steps.push(makeStep(pick(notes), pick(["Maj", "Min"]), {
            tie: prob(0.5),
            accent: prob(0.2),
          }));
        } else if (prob(0.08)) {
          steps.push(makeStep(0, "Min", { tie: prob(0.6) }));
        } else {
          steps.push(emptyStep());
        }
      }
      return steps;
    },
  },
  {
    name: "Random",
    generate: (len, scaleLen) => {
      // Fully random chord types and placement
      const steps: ChordsStep[] = [];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (prob(0.45)) {
          steps.push(makeStep(
            Math.floor(Math.random() * Math.min(scaleLen, 7)),
            pick(CHORD_TYPE_NAMES),
            {
              octave: prob(0.2) ? pick([1, -1]) : 0,
              accent: prob(0.25),
              tie: prob(0.2),
            },
          ));
        } else {
          steps.push(emptyStep());
        }
      }
      return steps;
    },
  },
];

// ─── Store Interface ─────────────────────────────────────

interface ChordsStore {
  steps: ChordsStep[];
  length: number;
  currentStep: number;
  selectedPage: number;
  rootNote: number;
  rootName: string;
  scaleName: string;
  params: ChordsParams;
  presetIndex: number;
  strategyIndex: number;
  automationData: Record<string, number[]>;
  automationParam: string;
  isPlaying: boolean;
  instrument: string;

  setAutomationValue: (param: string, step: number, value: number) => void;
  setAutomationParam: (param: string) => void;
  clearAutomation: (param: string) => void;
  toggleStep: (step: number) => void;
  setStepNote: (step: number, note: number) => void;
  setStepOctave: (step: number, octave: number) => void;
  cycleChordType: (step: number) => void;
  setStepChordType: (step: number, chordType: string) => void;
  toggleAccent: (step: number) => void;
  toggleTie: (step: number) => void;
  cycleOctave: (step: number) => void;
  setRootNote: (midi: number, name: string) => void;
  setScale: (name: string) => void;
  setParam: (key: keyof ChordsParams, value: number | string) => void;
  setLength: (len: number) => void;
  setSelectedPage: (page: number) => void;
  clearSteps: () => void;
  randomize: () => void;
  generateChordline: (strategyIndex: number) => void;
  nextStrategy: () => void;
  prevStrategy: () => void;
  applyEuclidean: (pulses: number, eucSteps: number, rotation: number, noteMode: string) => void;
  loadPreset: (index: number) => void;
  nextPreset: () => void;
  prevPreset: () => void;
  setInstrument: (id: string) => Promise<void>;
  // For save/load
  loadChordsPattern: (data: { steps: ChordsStep[]; length: number; params: ChordsParams; rootNote: number; rootName: string; scaleName: string }) => void;
}

function createEmptySteps(): ChordsStep[] {
  return Array.from({ length: 64 }, () => ({
    active: false, note: 0, chordType: "Min", octave: 0, accent: false, tie: false,
  }));
}

// ─── Chords Scheduler ───────────────────────────────────

let chordsTimer: ReturnType<typeof setInterval> | null = null;
let nextChordsStepTime = 0;

export function startChordsScheduler() {
  nextChordsStepTime = audioEngine.currentTime + 0.05;
  if (chordsTimer !== null) clearInterval(chordsTimer);

  chordsTimer = setInterval(() => {
    const drumState = (window as unknown as { __drumStore?: { getState: () => { bpm: number; isPlaying: boolean } } }).__drumStore?.getState();
    if (!drumState?.isPlaying) return;

    const bpm = drumState.bpm;
    const secondsPerStep = 60.0 / bpm / 4;

    while (nextChordsStepTime < audioEngine.currentTime + 0.1) {
      const { steps, currentStep, length, rootNote, scaleName, automationData } = useChordsStore.getState();
      const step = steps[currentStep % length];

      // Apply per-step automation
      for (const [param, vals] of Object.entries(automationData)) {
        const val = vals[currentStep % length];
        if (val !== undefined) chordsEngine.setParams({ [param]: val });
      }

      if (step?.active) {
        // Convert scale degree + chord type to MIDI note array
        const rootMidi = scaleNote(rootNote, scaleName, step.note, step.octave);
        const intervals = CHORD_TYPES[step.chordType] ?? CHORD_TYPES["Min"]!;
        const midiNotes = intervals.map((interval) => rootMidi + interval);

        const { instrument } = useChordsStore.getState();

        // Use soundfont if a non-synth instrument is selected
        if (instrument !== "_synth_") {
          const velocity = step.accent ? 1.0 : 0.7;
          const duration = secondsPerStep * 2.0;
          // Play the root note only for soundfont (can't play full chords easily)
          soundFontEngine.playNote("chords", rootMidi, nextChordsStepTime, velocity, duration);
        } else {
          // Use built-in synth
          chordsEngine.triggerChord(midiNotes, nextChordsStepTime, step.accent, step.tie);

          // Check next step for tie/release
          const nextStepIdx = (currentStep + 1) % length;
          const nextStep = steps[nextStepIdx];
          if (nextStep?.active && nextStep.tie) {
            // Don't release — tie holds chord
          } else {
            chordsEngine.releaseChord(nextChordsStepTime + secondsPerStep * 0.9);
          }
        }
      } else {
        if (steps.some(s => s.active)) {
          chordsEngine.rest(nextChordsStepTime);
        }
      }

      useChordsStore.setState({ currentStep: (currentStep + 1) % length });
      nextChordsStepTime += secondsPerStep;
    }
  }, 25);
}

export function stopChordsScheduler() {
  if (chordsTimer !== null) { clearInterval(chordsTimer); chordsTimer = null; }
  const now = audioEngine.currentTime;
  if (now > 0) chordsEngine.releaseChord(now);
  useChordsStore.setState({ currentStep: 0 });
}

// ─── Store ───────────────────────────────────────────────

export const useChordsStore = create<ChordsStore>((set, get) => ({
  steps: createEmptySteps(),
  length: 16,
  currentStep: 0,
  selectedPage: 0,
  rootNote: 48,
  rootName: "C",
  scaleName: "Minor",
  params: { ...DEFAULT_CHORDS_PARAMS },
  presetIndex: 0,
  strategyIndex: 0,
  automationData: {},
  automationParam: "cutoff",
  isPlaying: false,
  instrument: "_synth_",

  toggleStep: (step) => set((s) => {
    const newSteps = [...s.steps];
    newSteps[step] = { ...newSteps[step]!, active: !newSteps[step]!.active };
    const newLen = step >= s.length ? Math.min(64, step + 1) : s.length;
    return { steps: newSteps, length: newLen };
  }),

  setStepNote: (step, note) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, note }; return { steps: newSteps };
  }),

  setStepOctave: (step, octave) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, octave }; return { steps: newSteps };
  }),

  cycleChordType: (step) => set((s) => {
    const newSteps = [...s.steps];
    const current = newSteps[step]!.chordType;
    const idx = CHORD_TYPE_NAMES.indexOf(current);
    const next = CHORD_TYPE_NAMES[(idx + 1) % CHORD_TYPE_NAMES.length]!;
    newSteps[step] = { ...newSteps[step]!, chordType: next };
    return { steps: newSteps };
  }),

  setStepChordType: (step, chordType) => set((s) => {
    const newSteps = [...s.steps];
    newSteps[step] = { ...newSteps[step]!, chordType };
    return { steps: newSteps };
  }),

  toggleAccent: (step) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, accent: !newSteps[step]!.accent }; return { steps: newSteps };
  }),

  toggleTie: (step) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, tie: !newSteps[step]!.tie }; return { steps: newSteps };
  }),

  cycleOctave: (step) => set((s) => {
    const newSteps = [...s.steps];
    const cur = newSteps[step]!.octave;
    newSteps[step] = { ...newSteps[step]!, octave: cur === 0 ? 1 : cur === 1 ? -1 : 0 };
    return { steps: newSteps };
  }),

  setRootNote: (midi, name) => {
    set({ rootNote: midi, rootName: name });
    syncScaleToOtherStores("chords", { rootNote: midi, rootName: name });
  },
  setScale: (name) => {
    set({ scaleName: name });
    syncScaleToOtherStores("chords", { scaleName: name });
  },

  setParam: (key, value) => {
    const p = { ...get().params, [key]: value };
    set({ params: p });
    chordsEngine.setParams({ [key]: value });

    // Motion Recording: write automation on current step while playing
    const { isPlaying, currentStep, length, automationData } = get();
    if (isPlaying && typeof value === "number") {
      const data = { ...automationData };
      if (!data[key]) data[key] = new Array(length).fill(undefined);
      const arr = [...data[key]!];
      arr[currentStep % length] = value;
      data[key] = arr;
      set({ automationData: data });
    }
  },

  setLength: (len) => set({ length: Math.max(4, Math.min(64, len)) }),
  setSelectedPage: (page) => set({ selectedPage: page }),
  clearSteps: () => set({ steps: createEmptySteps() }),

  // Simple random (calls current strategy)
  randomize: () => get().generateChordline(get().strategyIndex),

  generateChordline: (strategyIdx) => {
    const { length, scaleName } = get();
    const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
    const strategy = CHORDLINE_STRATEGIES[strategyIdx];
    if (!strategy) return;
    const steps = strategy.generate(length, scale.length);
    set({ steps, strategyIndex: strategyIdx });
  },

  nextStrategy: () => {
    const next = (get().strategyIndex + 1) % CHORDLINE_STRATEGIES.length;
    set({ strategyIndex: next });
  },

  prevStrategy: () => {
    const prev = (get().strategyIndex - 1 + CHORDLINE_STRATEGIES.length) % CHORDLINE_STRATEGIES.length;
    set({ strategyIndex: prev });
  },

  applyEuclidean: (pulses, eucSteps, rotation, noteMode) => {
    const { length, scaleName } = get();
    const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
    const rhythm = generateEuclidean(pulses, eucSteps, rotation);
    const newSteps = createEmptySteps();

    for (let i = 0; i < length; i++) {
      const hit = rhythm[i % rhythm.length];
      if (hit) {
        let note = 0;
        if (noteMode === "ascending") note = i % Math.min(scale.length, 7);
        else if (noteMode === "random") note = Math.floor(Math.random() * Math.min(scale.length, 7));
        // "root" → note stays 0
        newSteps[i] = { active: true, note, chordType: "Min", octave: 0, accent: i % 4 === 0, tie: false };
      }
    }
    set({ steps: newSteps });
  },

  loadPreset: (index) => {
    const preset = CHORDS_PRESETS[index];
    if (!preset) return;
    const params = ensureFilterModel(preset.params);
    set({ params, presetIndex: index });
    chordsEngine.setParams(params);
  },

  nextPreset: () => { const n = (get().presetIndex + 1) % CHORDS_PRESETS.length; get().loadPreset(n); },
  prevPreset: () => { const p = (get().presetIndex - 1 + CHORDS_PRESETS.length) % CHORDS_PRESETS.length; get().loadPreset(p); },

  setInstrument: async (id: string) => {
    set({ instrument: id });
    const ctx = audioEngine.getAudioContext();
    if (ctx) {
      const destination = audioEngine.getChannelOutput(13); // Chords = channel 13
      try {
        await soundFontEngine.loadInstrument("chords", id, destination);
      } catch (err) {
        console.warn("Failed to load chords instrument:", err);
        set({ instrument: "_synth_" });
      }
    }
  },

  setAutomationValue: (param, step, value) => set((s) => {
    const data = { ...s.automationData };
    if (!data[param]) data[param] = new Array(64).fill(0);
    data[param] = [...data[param]!];
    data[param]![step] = value;
    return { automationData: data };
  }),
  setAutomationParam: (param) => set({ automationParam: param }),
  clearAutomation: (param) => set((s) => {
    const data = { ...s.automationData };
    delete data[param];
    return { automationData: data };
  }),

  loadChordsPattern: (data) => {
    const params = ensureFilterModel(data.params);
    set({
      steps: data.steps,
      length: data.length,
      params,
      rootNote: data.rootNote,
      rootName: data.rootName,
      scaleName: data.scaleName,
    });
    chordsEngine.setParams(params);
  },
}));

// Register for global scale sync
registerScaleStore("chords", (u) => useChordsStore.setState(u), 48);
