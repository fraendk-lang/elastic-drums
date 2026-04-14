import { create } from "zustand";
import { audioEngine } from "../audio/AudioEngine";

// Scene store reference — set lazily to avoid circular imports
let _sceneStoreRef: { getState: () => { scenes: (unknown | null)[]; loadScene: (slot: number) => void } } | null = null;
export function setSceneStoreRef(ref: typeof _sceneStoreRef) { _sceneStoreRef = ref; }
function getSceneStore() { return _sceneStoreRef; }

// Conditional Trig types (Elektron-style)
export type ConditionType =
  | "always"       // Always trigger
  | "prob"         // Random probability (uses probability field)
  | "fill"         // Only during fill mode
  | "!fill"        // Only when NOT in fill mode
  | "pre"          // Previous step on this track was active
  | "!pre"         // Previous step was NOT active
  | "nei"          // Neighbor track has active step
  | "!nei"         // Neighbor track does NOT have active step
  | "1st"          // Only first cycle
  | "!1st"         // Not first cycle
  | "2:2" | "3:3" | "4:4"  // Every Nth cycle
  | "2:3" | "2:4" | "3:4"  // Specific cycle patterns
  | "3:5" | "4:7" | "5:8"; // Complex polyrhythmic

export interface StepData {
  active: boolean;
  velocity: number;       // 0-127
  microTiming: number;    // ±23 ticks
  probability: number;    // 0-100
  ratchetCount: number;   // 1-8 (1 = normal, 2+ = retrig/roll)
  condition: ConditionType; // Conditional trig
  gateLength: number;     // 1 = normal (1 step), 2+ = tied across steps
  paramLocks: Record<string, number>;
}

// Song Mode — chains Scenes (full groovebox snapshots)
export interface SongChainEntry {
  sceneIndex: number;     // Index into sceneStore.scenes[]
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
    condition: "always",
    gateLength: 1,
    paramLocks: {},
  };
}

// ─── Conditional Trig Evaluation ─────────────────────────
const CYCLE_CONDITIONS: Record<string, [number, number]> = {
  "2:2": [2, 2], "3:3": [3, 3], "4:4": [4, 4],
  "2:3": [2, 3], "2:4": [2, 4], "3:4": [3, 4],
  "3:5": [3, 5], "4:7": [4, 7], "5:8": [5, 8],
};

let cycleCount = 0;
let fillMode = false;
let prevStepTriggered: boolean[] = new Array(12).fill(false);

export function setFillMode(on: boolean) { fillMode = on; }

function evaluateCondition(
  condition: ConditionType,
  probability: number,
  track: number,
): boolean {
  switch (condition) {
    case "always": return true;
    case "prob": return Math.random() * 100 < probability;
    case "fill": return fillMode;
    case "!fill": return !fillMode;
    case "pre": return prevStepTriggered[track] ?? false;
    case "!pre": return !(prevStepTriggered[track] ?? false);
    case "nei": {
      const above = track > 0 ? (prevStepTriggered[track - 1] ?? false) : false;
      const below = track < 11 ? (prevStepTriggered[track + 1] ?? false) : false;
      return above || below;
    }
    case "!nei": {
      const above = track > 0 ? (prevStepTriggered[track - 1] ?? false) : false;
      const below = track < 11 ? (prevStepTriggered[track + 1] ?? false) : false;
      return !above && !below;
    }
    case "1st": return cycleCount === 0;
    case "!1st": return cycleCount > 0;
    default: {
      // Cycle conditions (x:y)
      const cycle = CYCLE_CONDITIONS[condition];
      if (cycle) {
        const [a, b] = cycle;
        return (cycleCount % b) === (a - 1);
      }
      return true;
    }
  }
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
  cycleCount = 0;
  prevStepTriggered = new Array(12).fill(false);

  if (schedulerTimer !== null) clearInterval(schedulerTimer);

  schedulerTimer = setInterval(() => {
    const state = useDrumStore.getState();
    if (!state.isPlaying) return;

    // In WASM mode, sequencer runs in the worklet — just sync step for UI
    if (audioEngine.isWasmActive) return;

    const secondsPerStep = 60.0 / state.bpm / 4;
    const swingRatio = (state.pattern.swing - 50) / 100;

    while (nextStepTime < audioEngine.currentTime + 0.15) { // Larger lookahead for tighter timing
      const { pattern, currentStep, songMode, songChain, songPosition, songRepeatCount } =
        useDrumStore.getState();

      // Song Mode: determine which scene to play
      let activePattern = pattern;
      if (songMode === "song" && songChain.length > 0) {
        const chainEntry = songChain[songPosition];
        if (chainEntry) {
          const sceneStoreRef = getSceneStore();
          if (sceneStoreRef) {
            const scene = sceneStoreRef.getState().scenes[chainEntry.sceneIndex] as { drumPattern?: PatternData } | null;
            if (scene?.drumPattern) activePattern = scene.drumPattern;
          }
        }
      }

      // Swing: even steps are shortened, odd steps (offbeats) are delayed
      // This pushes offbeats later, creating the shuffle feel
      let stepDuration = secondsPerStep;
      if (swingRatio > 0) {
        if (currentStep % 2 === 0) {
          stepDuration = secondsPerStep * (1 + swingRatio); // Even step longer → delays the offbeat
        } else {
          stepDuration = secondsPerStep * (1 - swingRatio); // Odd step shorter → catches up
        }
      }

      // Track trigger state for conditional trigs
      const currentTrigState: boolean[] = new Array(12).fill(false);

      // Check if any track is soloed — if so, only soloed tracks play
      const hasSolo = activePattern.tracks.some((t) => t?.solo);

      // Trigger active steps with conditional trig evaluation
      for (let track = 0; track < 12; track++) {
        const trackData = activePattern.tracks[track];
        if (!trackData || trackData.mute) continue;
        if (hasSolo && !trackData.solo) continue; // Skip non-soloed tracks

        const trackStep = currentStep % trackData.length;
        const step = trackData.steps[trackStep];
        if (!step?.active) continue;

        // Skip if this step is covered by a previous step's gate length (tied note)
        let isTied = false;
        for (let g = 1; g < 16; g++) {
          const prevStep = trackStep - g;
          if (prevStep < 0) break;
          const prev = trackData.steps[prevStep];
          if (prev?.active && (prev.gateLength ?? 1) > g) { isTied = true; break; }
          if (prev?.active) break; // Stop scanning at first active step without coverage
        }
        if (isTied) continue;

        // Evaluate conditional trig
        const condition = step.condition ?? "always";
        if (!evaluateCondition(condition, step.probability, track)) continue;

        // Probability check (separate from condition — applies on top)
        if (condition !== "prob" && step.probability < 100) {
          if (Math.random() * 100 >= step.probability) continue;
        }

        currentTrigState[track] = true;

        // Apply P-Locks
        const locks = step.paramLocks;
        const lockKeys = Object.keys(locks);
        const savedValues: Record<string, number> = {};
        for (const key of lockKeys) {
          savedValues[key] = audioEngine.getVoiceParam(track, key);
          audioEngine.setVoiceParam(track, key, locks[key]!);
        }

        // Trigger with micro-timing offset + ratchet support
        const vel = step.velocity / 127;
        const nudge = (step.microTiming ?? 0) * (secondsPerStep / 24); // ±23 ticks → seconds
        const trigTime = nextStepTime + nudge;
        const ratchets = step.ratchetCount ?? 1;
        if (ratchets <= 1) {
          audioEngine.triggerVoiceAtTime(track, vel, trigTime);
        } else {
          const ratchetInterval = stepDuration / ratchets;
          for (let r = 0; r < ratchets; r++) {
            const rVel = vel * (1 - r * 0.15);
            audioEngine.triggerVoiceAtTime(track, Math.max(rVel, 0.1), trigTime + r * ratchetInterval);
          }
        }

        // Restore P-Locks after a brief delay to ensure they apply to the scheduled voice
        if (lockKeys.length > 0) {
          const restoreDelay = Math.max(5, stepDuration * 500); // ms, at least 5ms
          setTimeout(() => {
            for (const key of lockKeys) {
              audioEngine.setVoiceParam(track, key, savedValues[key]!);
            }
          }, restoreDelay);
        }
      }

      // Update prev-step state for PRE/!PRE conditions
      prevStepTriggered = currentTrigState;

      // Advance step
      const nextStep = (currentStep + 1) % activePattern.length;

      // Song mode: advance chain position at pattern end (bar boundary)
      if (nextStep === 0 && songMode === "song" && songChain.length > 0) {
        cycleCount++;
        const chainEntry = songChain[songPosition];
        const newRepeat = songRepeatCount + 1;

        if (chainEntry && newRepeat >= chainEntry.repeats) {
          // Move to next scene in chain
          const newPos = songPosition + 1;
          const nextPos = newPos >= songChain.length ? 0 : newPos; // Loop
          useDrumStore.setState({ songPosition: nextPos, songRepeatCount: 0 });
          // Load the next scene (all 4 sequencers)
          const nextEntry = songChain[nextPos];
          if (nextEntry) {
            const sceneStoreRef = getSceneStore();
            if (sceneStoreRef) sceneStoreRef.getState().loadScene(nextEntry.sceneIndex);
          }
        } else {
          useDrumStore.setState({ songRepeatCount: newRepeat });
        }
      } else if (nextStep === 0) {
        cycleCount++;
      }

      useDrumStore.setState({ currentStep: nextStep });
      nextStepTime += stepDuration;
    }
  }, 20); // 20ms tick for tighter timing resolution
}

function stopScheduler() {
  if (schedulerTimer !== null) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  cycleCount = 0;
  prevStepTriggered = new Array(12).fill(false);
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
  addToSongChain: (sceneIndex: number, repeats?: number) => void;
  removeFromSongChain: (index: number) => void;
  clearSongChain: () => void;

  // Euclidean generator
  applyEuclidean: (track: number, pulses: number, steps: number, rotation?: number) => void;

  // Ratchet
  setStepRatchet: (track: number, step: number, count: number) => void;
  setStepCondition: (track: number, step: number, condition: ConditionType) => void;
  setStepGateLength: (track: number, step: number, gateLength: number) => void;

  // Copy/Paste
  copyTrack: (track: number) => void;
  pasteTrack: (track: number) => void;
  clipboard: TrackData | null;

  // Page Copy/Paste (16 steps across all tracks)
  copyPage: (page: number) => void;
  pastePage: (page: number) => void;
  pageClipboard: Array<StepData[]> | null;

  // Mixer mute/solo (persistent in store)
  toggleTrackMute: (track: number) => void;
  toggleTrackSolo: (track: number) => void;
}

export const useDrumStore = create<DrumStore>((set, get) => ({
  bpm: 120,
  swing: 50,
  clipboard: null,
  pageClipboard: null,
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

      // Auto-extend pattern length if activating a step beyond current length
      if (s.active && step >= newPattern.length) {
        const VALID = [4, 8, 12, 16, 24, 32, 48, 64];
        const needed = step + 1;
        const newLen = VALID.find((l) => l >= needed) ?? 64;
        newPattern.length = newLen;
        for (const t of newPattern.tracks) t.length = newLen;
      }

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
    const preset = PRESET_PATTERNS[index];
    if (!preset) return;

    const wasPlaying = get().isPlaying;
    const pattern = structuredClone(preset);

    // Hot-swap pattern without stopping playback
    set({
      pattern,
      currentPatternIndex: index,
      swing: pattern.swing,
      currentStep: 0,
      isPlaying: wasPlaying, // Keep transport running
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

  // ─── Page Copy/Paste ──────────────────────────────────────
  copyPage: (page) => {
    const { pattern } = get();
    const start = page * 16;
    // Copy 16 steps from all 12 tracks
    const pageData = pattern.tracks.map((track) =>
      structuredClone(track.steps.slice(start, start + 16))
    );
    set({ pageClipboard: pageData });
  },

  pastePage: (page) => {
    const { pageClipboard } = get();
    if (!pageClipboard) return;
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      const start = page * 16;
      for (let t = 0; t < 12; t++) {
        const src = pageClipboard[t];
        if (!src) continue;
        for (let s = 0; s < 16 && s < src.length; s++) {
          newPattern.tracks[t]!.steps[start + s] = structuredClone(src[s]!);
        }
      }
      // Extend pattern length if pasting beyond current length
      const newEnd = start + 16;
      if (newEnd > newPattern.length) {
        newPattern.length = newEnd;
        for (const track of newPattern.tracks) {
          track.length = newEnd;
        }
      }
      return { pattern: newPattern };
    });
  },

  // ─── Song Mode ───────────────────────────────────────────
  setSongMode: (mode) => set({ songMode: mode }),

  addToSongChain: (sceneIndex, repeats = 1) =>
    set((state) => ({
      songChain: [...state.songChain, { sceneIndex, repeats }],
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

  setStepCondition: (track, step, condition) =>
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      newPattern.tracks[track]!.steps[step]!.condition = condition;
      return { pattern: newPattern };
    }),

  setStepGateLength: (track, step, gateLength) =>
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      const maxLen = newPattern.length - step; // Can't extend past pattern end
      newPattern.tracks[track]!.steps[step]!.gateLength = Math.max(1, Math.min(maxLen, gateLength));
      return { pattern: newPattern };
    }),

  // ─── Mixer Mute/Solo (persistent in store) ───────────────
  toggleTrackMute: (track) =>
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      newPattern.tracks[track]!.mute = !newPattern.tracks[track]!.mute;
      return { pattern: newPattern };
    }),

  toggleTrackSolo: (track) =>
    set((state) => {
      const newPattern = structuredClone(state.pattern);
      newPattern.tracks[track]!.solo = !newPattern.tracks[track]!.solo;
      return { pattern: newPattern };
    }),
}));
