/**
 * Bass Sequencer Store
 *
 * 64-step bass sequencer (4 pages of 16) with note, octave, accent, slide, tie.
 * Includes factory presets, genre-aware bassline generator, and Euclidean rhythms.
 */

import { create } from "zustand";
import { bassEngine, scaleNote, SCALES, type BassStep, type BassParams, DEFAULT_BASS_PARAMS } from "../audio/BassEngine";
import { audioEngine } from "../audio/AudioEngine";
import { soundFontEngine } from "../audio/SoundFontEngine";
import { generateEuclidean } from "./drumStore";

// ─── Factory Sound Presets ───────────────────────────────

export interface BassPreset {
  name: string;
  params: BassParams;
}

const bp = (p: Partial<BassParams>): BassParams => ({ ...DEFAULT_BASS_PARAMS, ...p });

// Factory helper to ensure filterModel is set (for backward compatibility)
function ensureFilterModel(p: BassParams): BassParams {
  return { ...p, filterModel: p.filterModel || "ladder" };
}

export const BASS_PRESETS: BassPreset[] = [
  // ── Classic Acid ──
  { name: "Classic 303", params: bp({}) },
  { name: "Warm Vintage", params: bp({ waveform: "square", cutoff: 200, resonance: 4, envMod: 0.15, decay: 300, accent: 0.3, slideTime: 80, distortion: 0.35, volume: 0.7, subOsc: 0.6, filterModel: "ladder", punch: 0.15, harmonics: 0.2, subFilter: 60 }) },
  { name: "Acid Squelch", params: bp({ cutoff: 400, resonance: 22, envMod: 0.85, decay: 120, accent: 0.7, slideTime: 50, distortion: 0.4 }) },
  { name: "Acid Screamer", params: bp({ cutoff: 350, resonance: 28, envMod: 0.95, decay: 100, accent: 0.9, slideTime: 30, distortion: 0.6, volume: 0.65 }) },
  { name: "Acid Whistle", params: bp({ cutoff: 600, resonance: 26, envMod: 0.9, decay: 60, accent: 0.8, slideTime: 40, distortion: 0.3, volume: 0.6 }) },
  // ── Deep / Sub ──
  { name: "Deep Sub", params: bp({ waveform: "square", cutoff: 300, resonance: 4, envMod: 0.1, decay: 400, accent: 0.3, slideTime: 80, distortion: 0, volume: 0.8, subOsc: 0.7 }) },
  { name: "808 Sub", params: bp({ waveform: "square", cutoff: 200, resonance: 2, envMod: 0.05, decay: 600, accent: 0.2, slideTime: 0, distortion: 0, volume: 0.85, subOsc: 0.9, subFilter: 40 }) },
  { name: "Dub Pressure", params: bp({ cutoff: 280, resonance: 10, envMod: 0.25, decay: 450, accent: 0.35, slideTime: 90, distortion: 0.1, volume: 0.75, subOsc: 0.65 }) },
  // ── Pluck / Stab ──
  { name: "Funky Pluck", params: bp({ cutoff: 700, resonance: 16, envMod: 0.7, decay: 80, accent: 0.4, slideTime: 0, distortion: 0.15 }) },
  { name: "Tight Stab", params: bp({ cutoff: 900, resonance: 12, envMod: 0.65, decay: 50, accent: 0.5, slideTime: 0, distortion: 0.2, volume: 0.6 }) },
  { name: "Disco Octave", params: bp({ cutoff: 1100, resonance: 8, envMod: 0.5, decay: 100, accent: 0.4, slideTime: 15, distortion: 0.1, subOsc: 0.4 }) },
  // ── Warm / Pad ──
  { name: "Warm Pad", params: bp({ cutoff: 800, resonance: 3, envMod: 0.15, decay: 600, accent: 0.2, slideTime: 120, distortion: 0, volume: 0.6, subOsc: 0.4 }) },
  { name: "Velvet Sub", params: bp({ waveform: "square", cutoff: 400, resonance: 5, envMod: 0.1, decay: 500, accent: 0.15, slideTime: 100, distortion: 0, volume: 0.65, subOsc: 0.55 }) },
  // ── Dirty / Distorted ──
  { name: "Distorted Lead", params: bp({ cutoff: 1200, resonance: 10, envMod: 0.4, decay: 150, accent: 0.6, slideTime: 20, distortion: 0.8, volume: 0.55 }) },
  { name: "Rave Hoover", params: bp({ cutoff: 500, resonance: 24, envMod: 0.8, decay: 130, accent: 0.8, slideTime: 70, distortion: 0.5, volume: 0.65, subOsc: 0.2 }) },
  { name: "Industrial", params: bp({ cutoff: 350, resonance: 20, envMod: 0.7, decay: 90, accent: 0.9, slideTime: 10, distortion: 0.9, volume: 0.5 }) },
  { name: "Fuzz Bass", params: bp({ waveform: "square", cutoff: 600, resonance: 6, envMod: 0.35, decay: 200, accent: 0.5, slideTime: 0, distortion: 0.7, volume: 0.55, subOsc: 0.3 }) },
  // ── Genre-Specific ──
  { name: "Rubber Bass", params: bp({ waveform: "square", cutoff: 500, resonance: 14, envMod: 0.5, decay: 180, slideTime: 40, distortion: 0.2, subOsc: 0.3 }) },
  { name: "Techno Throb", params: bp({ waveform: "square", cutoff: 450, resonance: 18, envMod: 0.6, slideTime: 100, distortion: 0.35, subOsc: 0.5 }) },
  { name: "Minimal Dub", params: bp({ cutoff: 350, resonance: 8, envMod: 0.3, decay: 500, accent: 0.3, distortion: 0.1, volume: 0.75, subOsc: 0.6 }) },
  { name: "DnB Reese", params: bp({ cutoff: 550, resonance: 15, envMod: 0.55, decay: 160, accent: 0.6, slideTime: 60, distortion: 0.45, volume: 0.6, subOsc: 0.4 }) },
  { name: "House Groove", params: bp({ cutoff: 650, resonance: 11, envMod: 0.45, decay: 140, accent: 0.45, slideTime: 25, distortion: 0.15, subOsc: 0.35 }) },
  { name: "Lo-Fi Wobble", params: bp({ waveform: "square", cutoff: 380, resonance: 19, envMod: 0.65, decay: 170, accent: 0.55, slideTime: 80, distortion: 0.3, volume: 0.6, subOsc: 0.45 }) },
  { name: "Trance Gate", params: bp({ cutoff: 800, resonance: 13, envMod: 0.6, decay: 70, accent: 0.7, slideTime: 5, distortion: 0.25, volume: 0.6 }) },
  { name: "Dark Ambient", params: bp({ waveform: "square", cutoff: 250, resonance: 6, envMod: 0.2, decay: 700, accent: 0.2, slideTime: 150, distortion: 0, volume: 0.6, subOsc: 0.8 }) },
  // ── Professional New Presets ──
  { name: "Analog Warmth", params: bp({ waveform: "square", cutoff: 500, resonance: 5, envMod: 0.2, decay: 350, accent: 0.25, slideTime: 60, distortion: 0.08, volume: 0.65, subOsc: 0.8, filterModel: "ladder", punch: 0.2, harmonics: 0.25, subFilter: 70 }) },
  { name: "Tape Bass", params: bp({ waveform: "sawtooth", cutoff: 700, resonance: 8, envMod: 0.35, decay: 250, accent: 0.4, slideTime: 45, distortion: 0.45, volume: 0.6, subOsc: 0.4, harmonics: 0.4, punch: 0.25 }) },
];

// ─── Bassline Agent: Genre Strategies ────────────────────

export interface BasslineStrategy {
  name: string;
  generate: (length: number, scaleLen: number) => BassStep[];
}

function makeStep(note: number, opts?: Partial<BassStep>): BassStep {
  return { active: true, note, octave: 0, accent: false, slide: false, tie: false, ...opts };
}

function emptyStep(): BassStep {
  return { active: false, note: 0, octave: 0, accent: false, slide: false, tie: false };
}

function prob(p: number): boolean { return Math.random() < p; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

export const BASSLINE_STRATEGIES: BasslineStrategy[] = [
  {
    name: "Acid",
    generate: (len, scaleLen) => {
      const steps: BassStep[] = [];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (prob(0.8)) {
          const note = Math.floor(Math.random() * Math.min(scaleLen, 7));
          steps.push(makeStep(note, {
            accent: i % 4 === 0 ? prob(0.6) : prob(0.2),
            slide: prob(0.45),
            octave: prob(0.2) ? pick([1, -1]) : 0,
          }));
        } else { steps.push(emptyStep()); }
      }
      return steps;
    },
  },
  {
    name: "Deep House",
    generate: (len, scaleLen) => {
      const steps: BassStep[] = [];
      const rootNotes = [0, 0, 0, Math.min(4, scaleLen - 1), Math.min(3, scaleLen - 1)]; // heavy root
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (prob(0.35)) {
          steps.push(makeStep(pick(rootNotes), {
            accent: prob(0.15),
            slide: prob(0.1),
            tie: prob(0.4),
            octave: prob(0.15) ? -1 : 0,
          }));
        } else { steps.push(emptyStep()); }
      }
      return steps;
    },
  },
  {
    name: "Techno",
    generate: (len) => {
      const steps: BassStep[] = [];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        // Driving 16th notes on root
        if (prob(0.7)) {
          steps.push(makeStep(0, {
            accent: i % 4 === 0 ? prob(0.5) : prob(0.1),
            slide: false,
            tie: prob(0.15),
            octave: i % 8 === 0 && prob(0.3) ? -1 : 0,
          }));
        } else { steps.push(emptyStep()); }
      }
      return steps;
    },
  },
  {
    name: "DnB",
    generate: (len, scaleLen) => {
      const steps: BassStep[] = [];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        // Syncopated with wide intervals
        const synco = [0, 3, 6, 7, 10, 11, 14].includes(i % 16);
        if (synco || prob(0.3)) {
          steps.push(makeStep(Math.floor(Math.random() * Math.min(scaleLen, 8)), {
            accent: prob(0.35),
            slide: prob(0.5),
            octave: prob(0.3) ? pick([1, -1]) : 0,
          }));
        } else { steps.push(emptyStep()); }
      }
      return steps;
    },
  },
  {
    name: "Dub",
    generate: (len, scaleLen) => {
      const steps: BassStep[] = [];
      const notes = [0, Math.min(4, scaleLen - 1)]; // Root + 5th
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (i % 4 === 0 && prob(0.7) || prob(0.12)) {
          steps.push(makeStep(pick(notes), {
            accent: prob(0.2),
            slide: false,
            tie: prob(0.6), // Long held notes
            octave: prob(0.1) ? -1 : 0,
          }));
        } else { steps.push(emptyStep()); }
      }
      return steps;
    },
  },
  {
    name: "Funk",
    generate: (len, scaleLen) => {
      const steps: BassStep[] = [];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        // Syncopated ghost notes
        const offbeat = i % 2 === 1;
        if (prob(offbeat ? 0.55 : 0.4)) {
          steps.push(makeStep(Math.floor(Math.random() * Math.min(scaleLen, 5)), {
            accent: prob(0.1), // Ghost notes = no accent
            slide: prob(0.35),
            tie: prob(0.15),
          }));
        } else { steps.push(emptyStep()); }
      }
      return steps;
    },
  },
  {
    name: "Trance",
    generate: (len, scaleLen) => {
      const steps: BassStep[] = [];
      const maxDeg = Math.min(scaleLen, 7);
      let dir = 1; // 1 = ascending, -1 = descending
      let note = 0;
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (prob(0.85)) {
          steps.push(makeStep(note, {
            accent: note === 0 || note === maxDeg - 1, // Accent peaks
            slide: prob(0.3),
          }));
          note += dir;
          if (note >= maxDeg) { note = maxDeg - 1; dir = -1; }
          if (note < 0) { note = 0; dir = 1; }
        } else { steps.push(emptyStep()); }
      }
      return steps;
    },
  },
  {
    name: "Random",
    generate: (len, scaleLen) => {
      const steps: BassStep[] = [];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (prob(0.65)) {
          steps.push(makeStep(Math.floor(Math.random() * Math.min(scaleLen, 7)), {
            octave: prob(0.3) ? pick([1, -1]) : 0,
            accent: prob(0.3),
            slide: prob(0.4),
            tie: prob(0.2),
          }));
        } else { steps.push(emptyStep()); }
      }
      return steps;
    },
  },
];

// ─── Store Interface ─────────────────────────────────────

interface BassStore {
  steps: BassStep[];
  length: number;
  currentStep: number;
  selectedPage: number;
  rootNote: number;
  rootName: string;
  scaleName: string;
  params: BassParams;
  presetIndex: number;
  strategyIndex: number;
  isPlaying: boolean;
  automationData: Record<string, number[]>;
  automationParam: string;
  instrument: string;

  toggleStep: (step: number) => void;
  setStepNote: (step: number, note: number) => void;
  setStepOctave: (step: number, octave: number) => void;
  toggleAccent: (step: number) => void;
  toggleSlide: (step: number) => void;
  toggleTie: (step: number) => void;
  setTieRange: (fromStep: number, toStep: number) => void;
  cycleOctave: (step: number) => void;
  setRootNote: (midi: number, name: string) => void;
  setScale: (name: string) => void;
  setParam: (key: keyof BassParams, value: number | string) => void;
  setLength: (len: number) => void;
  setSelectedPage: (page: number) => void;
  clearSteps: () => void;
  randomize: () => void;
  generateBassline: (strategyIndex: number) => void;
  nextStrategy: () => void;
  prevStrategy: () => void;
  applyEuclidean: (pulses: number, eucSteps: number, rotation: number, noteMode: string) => void;
  loadPreset: (index: number) => void;
  nextPreset: () => void;
  prevPreset: () => void;
  setInstrument: (id: string) => Promise<void>;
  // For save/load
  setAutomationValue: (param: string, step: number, value: number) => void;
  setAutomationParam: (param: string) => void;
  clearAutomation: (param: string) => void;
  loadBassPattern: (data: { steps: BassStep[]; length: number; params: BassParams; rootNote: number; rootName: string; scaleName: string }) => void;
}

function createEmptySteps(): BassStep[] {
  return Array.from({ length: 64 }, () => ({
    active: false, note: 0, octave: 0, accent: false, slide: false, tie: false,
  }));
}

// ─── Bass Scheduler ──────────────────────────────────────

let bassTimer: ReturnType<typeof setInterval> | null = null;
let nextBassStepTime = 0;

export function startBassScheduler() {
  nextBassStepTime = audioEngine.currentTime + 0.05;
  if (bassTimer !== null) clearInterval(bassTimer);

  bassTimer = setInterval(() => {
    const drumState = (window as unknown as { __drumStore?: { getState: () => { bpm: number; isPlaying: boolean } } }).__drumStore?.getState();
    if (!drumState?.isPlaying) return;

    const bpm = drumState.bpm;
    const secondsPerStep = 60.0 / bpm / 4;

    while (nextBassStepTime < audioEngine.currentTime + 0.1) {
      const { steps, currentStep, length, rootNote, scaleName, automationData } = useBassStore.getState();
      const step = steps[currentStep % length];

      // Apply per-step automation
      for (const [param, vals] of Object.entries(automationData)) {
        const val = vals[currentStep % length];
        if (val !== undefined) bassEngine.setParams({ [param]: val });
      }

      if (step?.active) {
        const midiNote = scaleNote(rootNote, scaleName, step.note, step.octave);
        const { instrument } = useBassStore.getState();

        // Use soundfont if a non-synth instrument is selected
        if (instrument !== "_synth_") {
          const velocity = step.accent ? 1.0 : 0.7;
          const duration = secondsPerStep * 1.5;
          soundFontEngine.playNote("bass", midiNote, nextBassStepTime, velocity, duration);
        } else {
          // Use built-in synth
          bassEngine.triggerNote(midiNote, nextBassStepTime, step.accent, step.slide, step.tie);

          const nextStepIdx = (currentStep + 1) % length;
          const nextStep = steps[nextStepIdx];
          if (nextStep?.active && nextStep.tie) {
            // Don't release — tie holds note
          } else if (!nextStep?.active) {
            bassEngine.releaseNote(nextBassStepTime + secondsPerStep * 0.9);
          }
        }
      } else {
        bassEngine.rest(nextBassStepTime);
      }

      useBassStore.setState({ currentStep: (currentStep + 1) % length });
      nextBassStepTime += secondsPerStep;
    }
  }, 25);
}

export function stopBassScheduler() {
  if (bassTimer !== null) { clearInterval(bassTimer); bassTimer = null; }
  const now = audioEngine.currentTime;
  if (now > 0) bassEngine.releaseNote(now);
  useBassStore.setState({ currentStep: 0 });
}

// ─── Store ───────────────────────────────────────────────

export const useBassStore = create<BassStore>((set, get) => ({
  steps: createEmptySteps(),
  automationData: {},
  automationParam: "cutoff",
  length: 16,
  currentStep: 0,
  selectedPage: 0,
  rootNote: 36,
  rootName: "C",
  scaleName: "Minor",
  params: { ...DEFAULT_BASS_PARAMS },
  presetIndex: 0,
  strategyIndex: 0,
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

  toggleAccent: (step) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, accent: !newSteps[step]!.accent }; return { steps: newSteps };
  }),

  toggleSlide: (step) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, slide: !newSteps[step]!.slide }; return { steps: newSteps };
  }),

  toggleTie: (step) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, tie: !newSteps[step]!.tie }; return { steps: newSteps };
  }),

  setTieRange: (fromStep, toStep) => set((s) => {
    const newSteps = [...s.steps];
    const sourceStep = newSteps[fromStep]!;
    if (!sourceStep.active) return { steps: newSteps };

    // Steps from fromStep+1 to toStep become tie notes (same note/octave as source)
    for (let i = fromStep + 1; i <= Math.min(toStep, 63); i++) {
      newSteps[i] = {
        active: true,
        note: sourceStep.note,
        octave: sourceStep.octave,
        accent: false,
        slide: false,
        tie: true,
      };
    }
    // Clear ties beyond the drag range (in case user shortened)
    for (let i = toStep + 1; i <= 63; i++) {
      if (newSteps[i]?.tie && newSteps[i]?.active) {
        newSteps[i] = { active: false, note: 0, octave: 0, accent: false, slide: false, tie: false };
      } else break; // Stop at first non-tie
    }
    return { steps: newSteps };
  }),

  cycleOctave: (step) => set((s) => {
    const newSteps = [...s.steps];
    const cur = newSteps[step]!.octave;
    newSteps[step] = { ...newSteps[step]!, octave: cur === 0 ? 1 : cur === 1 ? -1 : 0 };
    return { steps: newSteps };
  }),

  setRootNote: (midi, name) => {
    set({ rootNote: midi, rootName: name });
    // Sync to other stores (avoid circular — only push, don't listen)
    syncScaleToOtherStores("bass", { rootNote: midi, rootName: name });
  },
  setScale: (name) => {
    set({ scaleName: name });
    syncScaleToOtherStores("bass", { scaleName: name });
  },

  setParam: (key, value) => {
    const p = { ...get().params, [key]: value };
    set({ params: p });
    bassEngine.setParams({ [key]: value });

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
  randomize: () => get().generateBassline(get().strategyIndex),

  generateBassline: (strategyIdx) => {
    const { length, scaleName } = get();
    const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
    const strategy = BASSLINE_STRATEGIES[strategyIdx];
    if (!strategy) return;
    const steps = strategy.generate(length, scale.length);
    set({ steps, strategyIndex: strategyIdx });
  },

  nextStrategy: () => {
    const next = (get().strategyIndex + 1) % BASSLINE_STRATEGIES.length;
    set({ strategyIndex: next });
  },

  prevStrategy: () => {
    const prev = (get().strategyIndex - 1 + BASSLINE_STRATEGIES.length) % BASSLINE_STRATEGIES.length;
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
        newSteps[i] = { active: true, note, octave: 0, accent: i % 4 === 0, slide: false, tie: false };
      }
    }
    set({ steps: newSteps });
  },

  loadPreset: (index) => {
    const preset = BASS_PRESETS[index];
    if (!preset) return;
    const params = ensureFilterModel(preset.params);
    set({ params, presetIndex: index });
    bassEngine.setParams(params);
  },

  nextPreset: () => { const n = (get().presetIndex + 1) % BASS_PRESETS.length; get().loadPreset(n); },
  prevPreset: () => { const p = (get().presetIndex - 1 + BASS_PRESETS.length) % BASS_PRESETS.length; get().loadPreset(p); },

  setInstrument: async (id: string) => {
    set({ instrument: id });
    const ctx = audioEngine.getAudioContext();
    if (ctx) {
      const destination = audioEngine.getChannelOutput(12); // Bass = channel 12
      try {
        await soundFontEngine.loadInstrument("bass", id, destination);
      } catch (err) {
        console.warn("Failed to load bass instrument:", err);
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

  loadBassPattern: (data) => {
    const params = ensureFilterModel(data.params);
    set({
      steps: data.steps,
      length: data.length,
      params,
      rootNote: data.rootNote,
      rootName: data.rootName,
      scaleName: data.scaleName,
    });
    bassEngine.setParams(params);
  },
}));

// ─── Global Scale Sync ──────────────────────────────────
// When any synth changes root/scale, propagate to the others.
// Uses a guard to prevent circular updates.

// ─── Global Scale Sync ──────────────────────────────────
// When any synth changes root/scale, propagate to the others.
// Registry pattern avoids circular imports — each store registers itself.

let _scaleSyncGuard = false;

interface ScaleUpdate {
  rootNote?: number;
  rootName?: string;
  scaleName?: string;
}

type StoreSetState = (update: ScaleUpdate) => void;

const _scaleStoreRegistry: Record<string, { setState: StoreSetState; baseOctaveMidi: number }> = {};

/** Each synth store registers itself so others can push scale changes */
export function registerScaleStore(name: string, setState: StoreSetState, baseOctaveMidi: number): void {
  _scaleStoreRegistry[name] = { setState, baseOctaveMidi };
}

export function syncScaleToOtherStores(source: string, update: ScaleUpdate): void {
  if (_scaleSyncGuard) return;
  _scaleSyncGuard = true;
  try {
    const sourceStore = _scaleStoreRegistry[source];
    const sourceBase = sourceStore?.baseOctaveMidi ?? 48;

    for (const [name, store] of Object.entries(_scaleStoreRegistry)) {
      if (name === source) continue;
      const adjusted: ScaleUpdate = { ...update };
      // Adjust rootNote for octave differences (bass=36, chords/melody=48)
      if (update.rootNote !== undefined) {
        const octaveDiff = store.baseOctaveMidi - sourceBase;
        adjusted.rootNote = update.rootNote + octaveDiff;
      }
      store.setState(adjusted);
    }
  } finally {
    _scaleSyncGuard = false;
  }
}

// Register bass store
registerScaleStore("bass", (u) => useBassStore.setState(u), 36);
