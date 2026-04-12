import { create } from "zustand";
import { audioEngine } from "../audio/AudioEngine";

export interface StepData {
  active: boolean;
  velocity: number;       // 0-127
  microTiming: number;    // ±23 ticks
  probability: number;    // 0-100
  ratchetCount: number;   // 1-8 (1 = normal, 2+ = retrig/roll)
  paramLocks: Record<string, number>;
}

// Song Mode
export interface SongChainEntry {
  patternIndex: number;   // Index into pattern bank
  repeats: number;        // How many times to play (1-16)
}

export type SongMode = "pattern" | "song";

export interface TrackData {
  steps: StepData[];
  mute: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  length: number;         // Per-track length for polymetric
}

export interface PatternData {
  name: string;
  tracks: TrackData[];
  length: number;
  swing: number;          // 50-75 (50 = no swing)
}

function createEmptyStep(): StepData {
  return {
    active: false,
    velocity: 100,
    microTiming: 0,
    probability: 100,
    ratchetCount: 1,
    paramLocks: {},
  };
}

// ─── Euclidean Rhythm Generator ──────────────────────────
// Bjorklund's algorithm: distributes k pulses evenly across n steps
export function generateEuclidean(pulses: number, steps: number, rotation = 0): boolean[] {
  if (pulses >= steps) return new Array(steps).fill(true);
  if (pulses <= 0) return new Array(steps).fill(false);

  let pattern: number[][] = [];
  let remainder: number[][] = [];

  for (let i = 0; i < steps; i++) {
    if (i < pulses) {
      pattern.push([1]);
    } else {
      remainder.push([0]);
    }
  }

  while (remainder.length > 1) {
    const newPattern: number[][] = [];
    const minLen = Math.min(pattern.length, remainder.length);

    for (let i = 0; i < minLen; i++) {
      newPattern.push([...pattern[i]!, ...remainder[i]!]);
    }

    const leftoverPattern = pattern.slice(minLen);
    const leftoverRemainder = remainder.slice(minLen);

    pattern = newPattern;
    remainder = leftoverPattern.length > 0 ? leftoverPattern : leftoverRemainder;
  }

  // Flatten
  const flat = [...pattern, ...remainder].flat();

  // Apply rotation
  const result: boolean[] = [];
  for (let i = 0; i < flat.length; i++) {
    result.push(flat[(i + rotation) % flat.length]! === 1);
  }

  return result;
}

function createEmptyTrack(): TrackData {
  return {
    steps: Array.from({ length: 64 }, createEmptyStep),
    mute: false,
    solo: false,
    volume: 100,
    pan: 0,
    length: 16,
  };
}

function createEmptyPattern(): PatternData {
  return {
    name: "A01",
    tracks: Array.from({ length: 12 }, createEmptyTrack),
    length: 16,
    swing: 50,
  };
}

// ─── Preset Patterns ─────────────────────────────────────

function createPresetPattern(
  name: string,
  length: number,
  swing: number,
  data: Record<number, { steps: number[]; vel?: number[] }>,
): PatternData {
  const pattern = createEmptyPattern();
  pattern.name = name;
  pattern.length = length;
  pattern.swing = swing;

  for (const [track, info] of Object.entries(data)) {
    const t = Number(track);
    const trackData = pattern.tracks[t]!;
    trackData.length = length;
    for (let i = 0; i < info.steps.length; i++) {
      const stepIdx = info.steps[i]!;
      trackData.steps[stepIdx]!.active = true;
      if (info.vel?.[i] !== undefined) {
        trackData.steps[stepIdx]!.velocity = info.vel[i]!;
      }
    }
  }
  return pattern;
}

const PRESET_PATTERNS: PatternData[] = [
  // 808 Classic — Boom Bap
  createPresetPattern("808 Boom", 16, 54, {
    0: { steps: [0, 6, 10], vel: [127, 90, 110] },           // Kick
    1: { steps: [4, 12], vel: [120, 110] },                   // Snare
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [100, 60, 80, 60, 100, 60, 80, 60] }, // HH Cl
    7: { steps: [3, 11] },                                    // HH Op
  }),

  // 909 House
  createPresetPattern("909 House", 16, 50, {
    0: { steps: [0, 4, 8, 12], vel: [127, 120, 127, 120] },  // Kick - four on the floor
    2: { steps: [4, 12], vel: [110, 100] },                   // Clap
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [110, 70, 100, 70, 110, 70, 100, 70] }, // HH Cl
    7: { steps: [2, 6, 10, 14], vel: [60, 80, 60, 80] },     // HH Op
  }),

  // Trap
  createPresetPattern("Trap 808", 16, 50, {
    0: { steps: [0, 3, 7, 10, 14], vel: [127, 100, 110, 90, 100] },  // Kick
    1: { steps: [4, 12] },                                            // Snare
    6: { steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
         vel: [100, 50, 70, 50, 100, 50, 70, 50, 100, 50, 70, 50, 100, 50, 70, 50] }, // HH rapid
    7: { steps: [6, 14] },                                            // HH Op
  }),

  // Electro
  createPresetPattern("Electro", 16, 50, {
    0: { steps: [0, 3, 8, 11], vel: [127, 100, 120, 95] },   // Kick
    1: { steps: [4, 12] },                                     // Snare
    2: { steps: [7, 15], vel: [80, 90] },                      // Clap
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14] },                // HH Cl
    3: { steps: [6, 14], vel: [80, 70] },                      // Tom Lo
  }),

  // DnB — Amen-style
  createPresetPattern("DnB Amen", 16, 50, {
    0: { steps: [0, 4, 9, 10], vel: [127, 100, 110, 80] },   // Kick
    1: { steps: [4, 10, 12], vel: [120, 100, 110] },          // Snare
    6: { steps: [0, 2, 4, 5, 6, 8, 10, 12, 13, 14], vel: [100, 60, 90, 50, 80, 100, 60, 90, 50, 80] }, // HH
    9: { steps: [0, 8], vel: [70, 60] },                       // Ride
  }),

  // Reggaeton
  createPresetPattern("Dembow", 16, 50, {
    0: { steps: [0, 7], vel: [127, 100] },
    1: { steps: [3, 7, 11, 15], vel: [120, 80, 110, 80] },
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14] },
    10: { steps: [2, 6, 10, 14], vel: [70, 60, 70, 60] },
  }),

  // Lo-Fi Hip Hop
  createPresetPattern("Lo-Fi", 16, 58, {
    0: { steps: [0, 5, 10], vel: [110, 80, 95] },
    1: { steps: [4, 12], vel: [100, 90] },
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [80, 40, 65, 40, 80, 40, 65, 40] },
    10: { steps: [7, 15], vel: [50, 45] },
  }),

  // Deep House
  createPresetPattern("Deep House", 16, 52, {
    0: { steps: [0, 4, 8, 12], vel: [120, 115, 120, 115] },
    2: { steps: [4, 12], vel: [90, 85] },
    6: { steps: [2, 6, 10, 14], vel: [90, 70, 90, 70] },
    7: { steps: [4, 12], vel: [60, 55] },
    10: { steps: [0, 3, 8, 11], vel: [50, 40, 50, 40] },
  }),

  // Techno — minimal
  createPresetPattern("Techno", 16, 50, {
    0: { steps: [0, 4, 8, 12], vel: [127, 127, 127, 127] },
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [100, 60, 90, 60, 100, 60, 90, 60] },
    7: { steps: [4, 10], vel: [80, 75] },
    2: { steps: [8], vel: [70] },
    11: { steps: [3, 7, 11, 15], vel: [40, 35, 40, 35] },
  }),

  // Afrobeats
  createPresetPattern("Afrobeats", 16, 55, {
    0: { steps: [0, 5, 10], vel: [120, 90, 100] },
    1: { steps: [4, 12], vel: [110, 105] },
    6: { steps: [0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15], vel: [90, 50, 70, 90, 50, 70, 90, 50, 90, 50, 70] },
    10: { steps: [2, 6, 8, 14], vel: [80, 60, 70, 60] },
    11: { steps: [3, 7, 11, 15], vel: [50, 45, 50, 45] },
  }),

  // Amapiano
  createPresetPattern("Amapiano", 16, 50, {
    0: { steps: [0, 4, 8, 12], vel: [110, 100, 110, 100] },
    3: { steps: [2, 6, 10, 14], vel: [90, 70, 85, 70] },
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [70, 40, 60, 40, 70, 40, 60, 40] },
    10: { steps: [3, 7, 11, 15], vel: [80, 60, 75, 60] },
  }),

  // Synthwave / 80s
  createPresetPattern("Synthwave", 16, 50, {
    0: { steps: [0, 4, 8, 12], vel: [120, 110, 120, 110] },
    1: { steps: [4, 12], vel: [127, 120] },
    4: { steps: [6, 14], vel: [80, 75] },
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14] },
    8: { steps: [0, 8], vel: [50, 45] },
  }),

  // IDM / Glitch
  createPresetPattern("IDM Glitch", 16, 50, {
    0: { steps: [0, 3, 5, 8, 11, 13], vel: [127, 70, 90, 110, 60, 85] },
    1: { steps: [2, 7, 9, 14], vel: [100, 80, 110, 70] },
    6: { steps: [0, 1, 3, 5, 6, 8, 9, 11, 13, 14], vel: [90, 40, 70, 50, 90, 40, 70, 50, 90, 40] },
    10: { steps: [4, 10, 12], vel: [60, 50, 55] },
    11: { steps: [1, 6, 11], vel: [40, 50, 35] },
  }),

  // Acoustic / Brush
  createPresetPattern("Acoustic", 16, 56, {
    0: { steps: [0, 8], vel: [100, 90] },
    1: { steps: [4, 12], vel: [90, 85] },
    9: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [70, 50, 65, 50, 70, 50, 65, 50] },
    7: { steps: [6, 14], vel: [50, 45] },
    3: { steps: [10], vel: [60] },
  }),
];

// ─── Sequencer Scheduler ─────────────────────────────────
// Look-ahead scheduler with swing support

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let nextStepTime = 0;

function startScheduler() {
  nextStepTime = audioEngine.currentTime + 0.05;

  if (schedulerTimer !== null) clearInterval(schedulerTimer);

  schedulerTimer = setInterval(() => {
    const state = useDrumStore.getState();
    if (!state.isPlaying) return;

    const secondsPerStep = 60.0 / state.bpm / 4; // 16th notes
    const swingRatio = (state.pattern.swing - 50) / 100; // 0..0.25

    // Schedule all steps that fall within the look-ahead window (100ms)
    while (nextStepTime < audioEngine.currentTime + 0.1) {
      const { pattern, currentStep } = useDrumStore.getState();

      // Apply swing: off-beat steps (odd) are delayed
      let stepDuration = secondsPerStep;
      if (currentStep % 2 === 0 && swingRatio > 0) {
        // Even step: slightly shorter
        stepDuration = secondsPerStep * (1 - swingRatio);
      } else if (currentStep % 2 === 1 && swingRatio > 0) {
        // Odd step: slightly longer (swung)
        stepDuration = secondsPerStep * (1 + swingRatio);
      }

      // Trigger active steps on all tracks, apply P-Locks
      for (let track = 0; track < 12; track++) {
        const trackData = pattern.tracks[track];
        if (!trackData || trackData.mute) continue;

        const trackStep = currentStep % trackData.length;
        const step = trackData.steps[trackStep];
        if (!step?.active) continue;

        // Probability check
        if (step.probability < 100 && Math.random() * 100 >= step.probability) continue;

        // Apply P-Locks: temporarily override voice params for this step
        const locks = step.paramLocks;
        const lockKeys = Object.keys(locks);
        const savedValues: Record<string, number> = {};

        for (const key of lockKeys) {
          savedValues[key] = audioEngine.getVoiceParam(track, key);
          audioEngine.setVoiceParam(track, key, locks[key]!);
        }

        const vel = step.velocity / 127;
        const ratchets = step.ratchetCount ?? 1;

        if (ratchets <= 1) {
          // Normal single trigger
          audioEngine.triggerVoiceAtTime(track, vel, nextStepTime);
        } else {
          // Ratchet: multiple triggers within this step
          const ratchetInterval = stepDuration / ratchets;
          for (let r = 0; r < ratchets; r++) {
            // Velocity ramp: each retrig slightly quieter
            const rVel = vel * (1 - r * 0.15);
            audioEngine.triggerVoiceAtTime(track, Math.max(rVel, 0.1), nextStepTime + r * ratchetInterval);
          }
        }

        // Restore original params after trigger
        for (const key of lockKeys) {
          audioEngine.setVoiceParam(track, key, savedValues[key]!);
        }
      }

      // Advance step
      const nextStep = (currentStep + 1) % pattern.length;
      useDrumStore.setState({ currentStep: nextStep });

      nextStepTime += stepDuration;
    }
  }, 25);
}

function stopScheduler() {
  if (schedulerTimer !== null) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

// ─── Store ───────────────────────────────────────────────

interface DrumStore {
  // Transport
  bpm: number;
  swing: number;
  isPlaying: boolean;
  currentStep: number;

  // Selection
  selectedVoice: number;
  selectedPage: number;
  currentPatternIndex: number;

  // P-Lock editing: which step is being held (track, step) or null
  heldStep: { track: number; step: number } | null;

  // Pattern
  pattern: PatternData;

  // Song Mode
  songMode: SongMode;
  songChain: SongChainEntry[];
  songPosition: number;       // Current index in song chain
  songRepeatCount: number;    // Current repeat within chain entry
  patternBank: PatternData[]; // All available patterns (presets + user)

  // Actions
  setBpm: (bpm: number) => void;
  setSwing: (swing: number) => void;
  togglePlay: () => void;
  setCurrentStep: (step: number) => void;
  setSelectedVoice: (voice: number) => void;
  setSelectedPage: (page: number) => void;
  toggleStep: (track: number, step: number) => void;
  setStepVelocity: (track: number, step: number, velocity: number) => void;
  triggerVoice: (voice: number) => void;
  loadPreset: (index: number) => void;
  nextPreset: () => void;
  prevPreset: () => void;
  clearPattern: () => void;

  // P-Lock editing
  holdStep: (track: number, step: number) => void;
  releaseStep: () => void;
  setParamLock: (track: number, step: number, paramId: string, value: number) => void;
  clearParamLock: (track: number, step: number, paramId: string) => void;

  // Song Mode
  setSongMode: (mode: SongMode) => void;
  addToSongChain: (patternIndex: number, repeats?: number) => void;
  removeFromSongChain: (index: number) => void;
  clearSongChain: () => void;

  // Euclidean generator
  applyEuclidean: (track: number, pulses: number, steps: number, rotation?: number) => void;

  // Ratchet
  setStepRatchet: (track: number, step: number, count: number) => void;

  // Copy/Paste
  copyTrack: (track: number) => void;
  pasteTrack: (track: number) => void;
  clipboard: TrackData | null;
}

export const useDrumStore = create<DrumStore>((set, get) => ({
  bpm: 120,
  swing: 50,
  clipboard: null,
  isPlaying: false,
  currentStep: 0,
  songMode: "pattern" as SongMode,
  songChain: [],
  songPosition: 0,
  songRepeatCount: 0,
  patternBank: [...PRESET_PATTERNS],
  selectedVoice: 0,
  selectedPage: 0,
  currentPatternIndex: -1, // -1 = empty/custom
  heldStep: null,
  pattern: createEmptyPattern(),

  setBpm: (bpm) => set({ bpm: Math.max(30, Math.min(300, bpm)) }),

  setSwing: (swing) => {
    const clamped = Math.max(50, Math.min(75, swing));
    set((state) => {
      const newPattern = { ...state.pattern, swing: clamped };
      return { swing: clamped, pattern: newPattern };
    });
  },

  togglePlay: () => {
    const wasPlaying = get().isPlaying;
    if (wasPlaying) {
      stopScheduler();
      set({ isPlaying: false, currentStep: 0 });
    } else {
      set({ isPlaying: true, currentStep: 0 });
      startScheduler();
    }
  },

  setCurrentStep: (currentStep) => set({ currentStep }),
  setSelectedVoice: (selectedVoice) => set({ selectedVoice }),
  setSelectedPage: (selectedPage) => set({ selectedPage }),

  toggleStep: (track, step) =>
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      const s = newPattern.tracks[track]!.steps[step]!;
      s.active = !s.active;
      if (s.active && s.velocity === 0) s.velocity = 100;
      return { pattern: newPattern };
    }),

  setStepVelocity: (track, step, velocity) =>
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      newPattern.tracks[track]!.steps[step]!.velocity = Math.max(1, Math.min(127, velocity));
      return { pattern: newPattern };
    }),

  triggerVoice: (voice) => {
    audioEngine.triggerVoice(voice, 0.8);
  },

  loadPreset: (index) => {
    const wasPlaying = get().isPlaying;
    if (wasPlaying) stopScheduler();

    const preset = PRESET_PATTERNS[index];
    if (!preset) return;

    const pattern = structuredClone(preset);
    set({
      pattern,
      currentPatternIndex: index,
      swing: pattern.swing,
      currentStep: 0,
      isPlaying: false,
    });
  },

  nextPreset: () => {
    const { currentPatternIndex } = get();
    const next = (currentPatternIndex + 1) % PRESET_PATTERNS.length;
    get().loadPreset(next);
  },

  prevPreset: () => {
    const { currentPatternIndex } = get();
    const prev = currentPatternIndex <= 0 ? PRESET_PATTERNS.length - 1 : currentPatternIndex - 1;
    get().loadPreset(prev);
  },

  clearPattern: () => {
    const wasPlaying = get().isPlaying;
    if (wasPlaying) stopScheduler();
    set({
      pattern: createEmptyPattern(),
      currentPatternIndex: -1,
      currentStep: 0,
      isPlaying: false,
    });
  },

  // ─── P-Lock editing ──────────────────────────────────────
  holdStep: (track, step) => set({ heldStep: { track, step } }),

  releaseStep: () => set({ heldStep: null }),

  setParamLock: (track, step, paramId, value) =>
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      const s = newPattern.tracks[track]!.steps[step]!;
      s.paramLocks[paramId] = value;
      return { pattern: newPattern };
    }),

  clearParamLock: (track, step, paramId) =>
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      const s = newPattern.tracks[track]!.steps[step]!;
      delete s.paramLocks[paramId];
      return { pattern: newPattern };
    }),

  // ─── Copy/Paste ──────────────────────────────────────────
  copyTrack: (track) => {
    const trackData = get().pattern.tracks[track];
    if (trackData) {
      set({ clipboard: structuredClone(trackData) });
    }
  },

  pasteTrack: (track) => {
    const { clipboard } = get();
    if (!clipboard) return;
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      newPattern.tracks[track] = structuredClone(clipboard);
      return { pattern: newPattern };
    });
  },

  // ─── Song Mode ───────────────────────────────────────────
  setSongMode: (mode) => set({ songMode: mode }),

  addToSongChain: (patternIndex, repeats = 1) =>
    set((state) => ({
      songChain: [...state.songChain, { patternIndex, repeats }],
    })),

  removeFromSongChain: (index) =>
    set((state) => ({
      songChain: state.songChain.filter((_, i) => i !== index),
    })),

  clearSongChain: () => set({ songChain: [], songPosition: 0, songRepeatCount: 0 }),

  // ─── Euclidean Generator ─────────────────────────────────
  applyEuclidean: (track, pulses, steps, rotation = 0) =>
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      const trackData = newPattern.tracks[track]!;
      const euclid = generateEuclidean(pulses, steps, rotation);

      // Apply to track steps
      for (let i = 0; i < trackData.length; i++) {
        trackData.steps[i]!.active = i < euclid.length ? euclid[i]! : false;
      }
      trackData.length = steps;
      newPattern.length = Math.max(newPattern.length, steps);

      return { pattern: newPattern };
    }),

  // ─── Ratchet ─────────────────────────────────────────────
  setStepRatchet: (track, step, count) =>
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      newPattern.tracks[track]!.steps[step]!.ratchetCount = Math.max(1, Math.min(8, count));
      return { pattern: newPattern };
    }),
}));
