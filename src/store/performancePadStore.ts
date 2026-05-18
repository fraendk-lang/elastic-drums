/**
 * XY Performance Pad Store — MPE-artiges Expression-Instrument.
 *
 * User interagiert mit einer großen XY-Fläche (Maus/Touch/Multi-Touch).
 * Jeder Pointer-Down spielt eine polyphone Note auf dem Target-Engine.
 * X-Achse bestimmt die Tonhöhe (scale-locked), Y-Achse modulier einen
 * assignbaren Parameter live.
 *
 * Optional: Record → Speichert alle Pointer-Events als Event-Array, das
 * mit einem separaten Scheduler loopbar abgespielt werden kann.
 */

import { create } from "zustand";
import { gridMs, stepCountFor, stepNotesToEvents, type StepNote } from "./performancePadStep";

export type YAxisParam = "cutoff" | "resonance" | "envMod" | "decay" | "distortion" | "volume" | "reverb" | "delay" | "drive" | "pitch";

export type PadTarget = "melody" | "bass";

/** Pad play mode — "notes" = free-pitch via X-axis, "chords" = chord cells grid, "grid" = scale note grid (polyphonic chord playing). */
export type PadMode = "notes" | "chords" | "grid";

/** Chord definition — label + semitone intervals from root (incl. 0 for root). */
export interface ChordDef {
  label: string;
  /** Semitones from the set's rootMidi */
  rootOffset: number;
  /** Interval stack in semitones — e.g. [0,4,7] = major triad */
  intervals: number[];
  /** Optional RGB hue tint for visualization */
  hue?: string;
}

/** A chord set = grid of chord cells (rows × cols) plus a root note. */
export interface ChordSet {
  name: string;
  rootMidi: number; // Anchoring root — all chord rootOffset computed from here
  cells: ChordDef[]; // Laid out in row-major order
  cols: number;
  rows: number;
}

// ── Factory chord sets ──
const C = (label: string, rootOffset: number, intervals: number[], hue?: string): ChordDef =>
  ({ label, rootOffset, intervals, hue });

// Helpers: intervals
const TRIAD_MAJ = [0, 4, 7];
const TRIAD_MIN = [0, 3, 7];
const TRIAD_DIM = [0, 3, 6];
const SEVEN_MAJ7 = [0, 4, 7, 11];
const SEVEN_MIN7 = [0, 3, 7, 10];
const SEVEN_DOM7 = [0, 4, 7, 10];
const SUS4 = [0, 5, 7];
const ADD9 = [0, 4, 7, 14];

export const CHORD_SETS: ChordSet[] = [
  // Pop/Rock — C Major diatonic triads I-ii-iii-IV-V-vi-vii°
  {
    name: "C Major Pop",
    rootMidi: 60,
    cols: 4, rows: 2,
    cells: [
      C("I",   0,  TRIAD_MAJ, "#f472b6"),   C("ii",  2,  TRIAD_MIN, "#a78bfa"),
      C("iii", 4,  TRIAD_MIN, "#a78bfa"),   C("IV",  5,  TRIAD_MAJ, "#f472b6"),
      C("V",   7,  TRIAD_MAJ, "#f472b6"),   C("vi",  9,  TRIAD_MIN, "#a78bfa"),
      C("vii°",11, TRIAD_DIM, "#f87171"),   C("I+8", 12, TRIAD_MAJ, "#fbbf24"),
    ],
  },
  // Jazz — ii-V-I 7th chords
  {
    name: "Jazz ii-V-I",
    rootMidi: 60,
    cols: 4, rows: 2,
    cells: [
      C("Dm7",   2, SEVEN_MIN7, "#a78bfa"), C("G7",    7, SEVEN_DOM7, "#f472b6"),
      C("Cmaj7", 0, SEVEN_MAJ7, "#fbbf24"), C("Am7",   9, SEVEN_MIN7, "#a78bfa"),
      C("Fmaj7", 5, SEVEN_MAJ7, "#fbbf24"), C("Bm7b5",11, [0,3,6,10], "#f87171"),
      C("E7",    4, SEVEN_DOM7, "#f472b6"), C("Cmaj9", 0, ADD9, "#34d399"),
    ],
  },
  // Neo-Soul — lush maj7/min9 chords
  {
    name: "Neo-Soul",
    rootMidi: 60,
    cols: 4, rows: 2,
    cells: [
      C("Cmaj7",  0, SEVEN_MAJ7,       "#fbbf24"), C("Em9",   4, [0,3,7,10,14], "#a78bfa"),
      C("Am9",    9, [0,3,7,10,14],    "#a78bfa"), C("Fmaj7", 5, SEVEN_MAJ7,    "#fbbf24"),
      C("Dm11",   2, [0,3,7,10,14,17], "#a78bfa"), C("G13",   7, [0,4,7,10,14,21],"#f472b6"),
      C("Cadd9",  0, ADD9,             "#34d399"), C("Fadd9", 5, ADD9,          "#34d399"),
    ],
  },
  // House/Deep — minor 7ths + sus
  {
    name: "Deep House",
    rootMidi: 57, // A minor anchor
    cols: 4, rows: 2,
    cells: [
      C("Am7",   0, SEVEN_MIN7, "#a78bfa"), C("Dm7",   5, SEVEN_MIN7, "#a78bfa"),
      C("Em7",   7, SEVEN_MIN7, "#a78bfa"), C("Fmaj7", 8, SEVEN_MAJ7, "#fbbf24"),
      C("Gsus4", 10, SUS4,      "#34d399"), C("G",    10, TRIAD_MAJ,   "#f472b6"),
      C("Am9",   0, [0,3,7,10,14], "#a78bfa"), C("C",    3, TRIAD_MAJ, "#f472b6"),
    ],
  },
  // Ambient — open fifths + sus chords
  {
    name: "Ambient Open",
    rootMidi: 55, // G anchor
    cols: 4, rows: 2,
    cells: [
      C("G5",    0, [0,7,12],     "#34d399"), C("D5",     7, [0,7,12], "#34d399"),
      C("Asus2", 2, [0,2,7],      "#60a5fa"), C("Dsus4",  7, SUS4,     "#60a5fa"),
      C("Gadd9", 0, ADD9,         "#fbbf24"), C("Em9",    9, [0,3,7,10,14], "#a78bfa"),
      C("Cmaj9", 5, [0,4,7,11,14],"#fbbf24"), C("Am7",   14, SEVEN_MIN7, "#a78bfa"),
    ],
  },

  // Funk — dominant 7ths + 9ths
  {
    name: "Funk / R&B",
    rootMidi: 60, // C anchor
    cols: 4, rows: 2,
    cells: [
      C("C9",    0, [0,4,7,10,14], "#f59e0b"), C("F9",    5, [0,4,7,10,14], "#f59e0b"),
      C("G7",    7, SEVEN_DOM7,    "#f472b6"), C("Bb7",  10, SEVEN_DOM7,    "#f472b6"),
      C("Cm7",   0, SEVEN_MIN7,    "#a78bfa"), C("Fm7",   5, SEVEN_MIN7,    "#a78bfa"),
      C("Ab7",   8, SEVEN_DOM7,    "#fb923c"), C("Eb9",   3, [0,4,7,10,14], "#f59e0b"),
    ],
  },

  // Gospel / Soul — rich 7ths with chromatic moves
  {
    name: "Gospel / Soul",
    rootMidi: 60, // C anchor
    cols: 4, rows: 2,
    cells: [
      C("Cmaj7",  0, SEVEN_MAJ7,    "#fbbf24"), C("Am7",    9, SEVEN_MIN7, "#a78bfa"),
      C("Fmaj7",  5, SEVEN_MAJ7,    "#fbbf24"), C("G7sus4", 7, [0,5,7,10], "#34d399"),
      C("Dm9",    2, [0,3,7,10,14], "#a78bfa"), C("E7",     4, SEVEN_DOM7, "#f472b6"),
      C("Ab7",    8, SEVEN_DOM7,    "#fb923c"), C("G7",     7, SEVEN_DOM7, "#f472b6"),
    ],
  },

  // Natural Minor — diatonic triads of A minor
  {
    name: "A Minor Diatonic",
    rootMidi: 57, // A anchor
    cols: 4, rows: 2,
    cells: [
      C("i   Am",  0, TRIAD_MIN, "#a78bfa"), C("ii° B°", 2, TRIAD_DIM, "#f87171"),
      C("III C",   3, TRIAD_MAJ, "#f472b6"), C("iv  Dm", 5, TRIAD_MIN, "#a78bfa"),
      C("v   Em",  7, TRIAD_MIN, "#a78bfa"), C("VI  F",  8, TRIAD_MAJ, "#f472b6"),
      C("VII G",  10, TRIAD_MAJ, "#f472b6"), C("i+8",   12, TRIAD_MIN, "#fbbf24"),
    ],
  },

  // Dorian Mode — minor with raised 6th (jazz / neo-soul)
  {
    name: "Dorian Modal",
    rootMidi: 62, // D anchor
    cols: 4, rows: 2,
    cells: [
      C("i  Dm7",  0, SEVEN_MIN7, "#a78bfa"), C("II E7",  2, SEVEN_DOM7, "#f472b6"),
      C("III F",   3, TRIAD_MAJ,  "#f472b6"), C("IV G7",  5, SEVEN_DOM7, "#fb923c"),
      C("v  Am7",  7, SEVEN_MIN7, "#a78bfa"), C("vi B°",  9, TRIAD_DIM,  "#f87171"),
      C("VII C",  10, TRIAD_MAJ,  "#f472b6"), C("Dm9",    0, [0,3,7,10,14], "#fbbf24"),
    ],
  },

  // Blues — dominant 7ths I-IV-V classic 12-bar building blocks
  {
    name: "12-Bar Blues",
    rootMidi: 60, // C anchor
    cols: 4, rows: 2,
    cells: [
      C("C7",   0, SEVEN_DOM7, "#f59e0b"), C("F7",   5, SEVEN_DOM7, "#f59e0b"),
      C("G7",   7, SEVEN_DOM7, "#f59e0b"), C("Bb",  10, TRIAD_MAJ,  "#f472b6"),
      C("C9",   0, [0,4,7,10,14], "#fb923c"), C("F9",  5, [0,4,7,10,14], "#fb923c"),
      C("G9",   7, [0,4,7,10,14], "#fb923c"), C("Eb7", 3, SEVEN_DOM7, "#f59e0b"),
    ],
  },

  // Techno / Dark — power chords + minor movement
  {
    name: "Techno / Dark",
    rootMidi: 57, // A anchor
    cols: 4, rows: 2,
    cells: [
      C("Am",   0, TRIAD_MIN, "#f87171"), C("F",    8, TRIAD_MAJ, "#a78bfa"),
      C("G",   10, TRIAD_MAJ, "#a78bfa"), C("Em",   7, TRIAD_MIN, "#f87171"),
      C("A5",   0, [0,7],     "#f87171"), C("D5",   5, [0,7],     "#f87171"),
      C("E5",   7, [0,7],     "#f87171"), C("C5",   3, [0,7],     "#a78bfa"),
    ],
  },

  // Andalusian Cadence — iv–III–II–I (Flamenco / Exotic)
  {
    name: "Andalusian",
    rootMidi: 64, // E anchor (Phrygian feel)
    cols: 4, rows: 2,
    cells: [
      C("Am",   0, TRIAD_MIN, "#f59e0b"), C("G",   -2, TRIAD_MAJ, "#f472b6"),
      C("F",   -4, TRIAD_MAJ, "#f472b6"), C("E",   -5, TRIAD_MAJ, "#fb923c"),
      C("Am7",  0, SEVEN_MIN7,"#f59e0b"), C("Gsus4",-2,[0,5,7],   "#34d399"),
      C("Fmaj7",-4,SEVEN_MAJ7,"#fbbf24"), C("E7",  -5, SEVEN_DOM7,"#fb923c"),
    ],
  },
];

export interface PadEvent {
  t: number;            // ms since record start
  type: "down" | "move" | "up";
  pointerId: number;    // stable ID for multi-touch tracking
  x: number;            // 0-1
  y: number;            // 0-1
  velocity: number;     // 0-1 (used on "down")
}

// ── localStorage persistence for custom chord sets ─────────────────────────
const LS_KEY = "eg_custom_chord_sets";
function loadCustomChordSets(): ChordSet[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as ChordSet[];
  } catch { /* ignore */ }
  return JSON.parse(JSON.stringify(CHORD_SETS)) as ChordSet[];
}
function saveCustomChordSets(sets: ChordSet[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(sets)); } catch { /* ignore */ }
}

interface PerformancePadState {
  // Config
  target: PadTarget;
  mode: PadMode;            // "notes" = free-pitch / "chords" = chord cells grid
  chordSetIndex: number;    // Which CHORD_SETS preset to use
  yParam: YAxisParam;
  scaleOctaves: number;     // Pitch range width in octaves (1-4)
  scaleLowestOct: number;   // Octave offset from C3 (-2 to +2)
  gridSnap: boolean;        // Snap X to scale notes vs. smooth pitch bend
  glide: number;            // 0-1, portamento ms factor for mono-like expressiveness
  trailEnabled: boolean;    // Particle trail behind cursor
  chordFollow: boolean;     // When true, Bass + Melody auto-transpose to match pad chord root
  gridRows: number;         // Rows in scale-grid mode (each row = one octave)

  // Editable chord sets (deep-clone of CHORD_SETS, persisted in localStorage)
  customChordSets: ChordSet[];

  // Recording
  events: PadEvent[];
  isArmed: boolean;         // REC pressed, waiting for first note to actually start
  isRecording: boolean;
  isStepRecording: boolean; // Step-record mode — each press places a note at the current step and advances
  stepNotes: (StepNote | null)[]; // Step-indexed melody — source of truth in step mode (null = rest)
  stepCursor: number;             // Current step index in step mode
  stepGridMs: number;             // ms per step, captured when step recording starts
  isLooping: boolean;
  recordStart: number;      // performance.now() at record start (first-note-touch)
  loopDuration: number;     // ms, set after first recording (quantized if loopBars set)
  loopBars: 0 | 1 | 2 | 4 | 8; // 0 = auto (use measured duration), else snap to N bars at BPM
  quantize: "off" | "1/4" | "1/8" | "1/16" | "1/32";  // Grid to snap event timings to
  playbackTimer: ReturnType<typeof setTimeout> | null;
  playbackStartTime: number;
  loopWallStart: number;    // Wall-clock time (performance.now ms) of loop iteration #0 — true playback anchor

  // Setters
  setTarget: (t: PadTarget) => void;
  setMode: (m: PadMode) => void;
  setChordSetIndex: (i: number) => void;
  setYParam: (p: YAxisParam) => void;
  setScaleOctaves: (n: number) => void;
  setScaleLowestOct: (n: number) => void;
  setGridSnap: (b: boolean) => void;
  setGlide: (n: number) => void;
  setTrailEnabled: (b: boolean) => void;
  setChordFollow: (b: boolean) => void;
  setGridRows: (n: number) => void;

  // Chord editor actions
  setChordIntervals: (setIdx: number, cellIdx: number, intervals: number[], label: string) => void;
  resetChordCell: (setIdx: number, cellIdx: number) => void;

  // Recording API
  armRecording: () => void;     // Arm for recording — starts on first note
  startStepRecording: (bpm: number) => void;
  stopRecording: (bpm: number) => void;  // bpm needed to compute bar-snapped loop length
  clearRecording: () => void;
  /** Place a note at the current step and advance the cursor by one (wraps). */
  placeStepNote: (note: StepNote) => void;
  /** Jump the step cursor to any step index (clamped to range). */
  setStepCursor: (index: number) => void;
  /** Delete the note at any step index. */
  clearStepAt: (index: number) => void;
  /** Advance the step cursor by one WITHOUT placing a note (rest). */
  skipStep: () => void;
  /** Clear the step before the cursor and rewind the cursor onto it. */
  undoLastStep: () => void;
  appendEvent: (ev: Omit<PadEvent, "t">) => void;
  setLoopBars: (n: 0 | 1 | 2 | 4 | 8) => void;
  setQuantize: (q: "off" | "1/4" | "1/8" | "1/16" | "1/32") => void;

  // Loop playback API
  setLoopWallStart: (t: number) => void;
  startLoop: () => void;
  stopLoop: () => void;
}

export const usePerformancePadStore = create<PerformancePadState>((set, get) => ({
  target: "melody",
  mode: "notes",
  chordSetIndex: 0,
  yParam: "cutoff",
  scaleOctaves: 2,
  scaleLowestOct: 0,
  gridSnap: true,
  glide: 0.15,
  trailEnabled: true,
  chordFollow: true,
  gridRows: 2,
  customChordSets: loadCustomChordSets(),

  events: [],
  isArmed: false,
  isRecording: false,
  isStepRecording: false,
  stepNotes: [],
  stepCursor: 0,
  stepGridMs: 0,
  isLooping: false,
  recordStart: 0,
  loopDuration: 0,
  loopBars: 0,          // 0 = auto (use measured duration)
  quantize: "off",
  playbackTimer: null,
  playbackStartTime: 0,
  loopWallStart: 0,

  setTarget: (t) => set({ target: t }),
  setMode: (m) => set({ mode: m }),
  setChordSetIndex: (i) => set({ chordSetIndex: Math.max(0, Math.min(CHORD_SETS.length - 1, i)) }),
  setYParam: (p) => set({ yParam: p }),
  setScaleOctaves: (n) => set({ scaleOctaves: Math.max(1, Math.min(4, n)) }),
  setScaleLowestOct: (n) => set({ scaleLowestOct: Math.max(-2, Math.min(2, n)) }),
  setGridSnap: (b) => set({ gridSnap: b }),
  setGlide: (n) => set({ glide: Math.max(0, Math.min(1, n)) }),
  setTrailEnabled: (b) => set({ trailEnabled: b }),
  setChordFollow: (b) => set({ chordFollow: b }),
  setGridRows: (n) => set({ gridRows: Math.max(1, Math.min(4, n)) }),

  setChordIntervals: (setIdx, cellIdx, intervals, label) => {
    const prev = get().customChordSets;
    const next: ChordSet[] = prev.map((cs, si) => {
      if (si !== setIdx) return cs;
      return {
        ...cs,
        cells: cs.cells.map((cell, ci) =>
          ci === cellIdx ? { ...cell, intervals, label } : cell
        ),
      };
    });
    saveCustomChordSets(next);
    set({ customChordSets: next });
  },

  resetChordCell: (setIdx, cellIdx) => {
    const factory = CHORD_SETS[setIdx];
    const factoryCell = factory?.cells[cellIdx];
    if (!factoryCell) return;
    const prev = get().customChordSets;
    const next: ChordSet[] = prev.map((cs, si) => {
      if (si !== setIdx) return cs;
      return {
        ...cs,
        cells: cs.cells.map((cell, ci) =>
          ci === cellIdx ? { ...factoryCell } : cell
        ),
      };
    });
    saveCustomChordSets(next);
    set({ customChordSets: next });
  },

  armRecording: () => {
    const s = get();
    if (s.isLooping) s.stopLoop();
    set({
      isArmed: true,
      isRecording: false,
      isStepRecording: false,
      events: [],
      loopDuration: 0,
      recordStart: 0,
    });
  },

  startStepRecording: (bpm: number) => {
    const s = get();
    if (s.isLooping) s.stopLoop();
    const grid = gridMs(s.quantize, bpm);
    const loopDuration = s.loopBars > 0
      ? s.loopBars * (60000 / bpm) * 4
      : 2 * (60000 / bpm) * 4;
    const count = stepCountFor(loopDuration, grid);
    // Keep an existing pattern if grid + length still match — toggling STEP
    // off/on must not wipe the user's work. Otherwise start fresh.
    const keep = s.stepNotes.length === count && s.stepGridMs === grid;
    const stepNotes = keep ? s.stepNotes : new Array(count).fill(null);
    set({
      isArmed: false,
      isRecording: false,
      isStepRecording: true,
      stepGridMs: grid,
      stepCursor: 0,
      stepNotes,
      recordStart: performance.now(),
      loopDuration,
      events: stepNotesToEvents(stepNotes, grid, loopDuration),
    });
  },

  stopRecording: (bpm: number) => {
    const s = get();
    // Step recording: just flip the flag off — events + loopDuration are already set
    if (s.isStepRecording) {
      set({ isStepRecording: false });
      return;
    }
    if (!s.isRecording && !s.isArmed) return;
    const now = performance.now();
    const measuredDuration = s.recordStart > 0 ? now - s.recordStart : 0;

    // Compute loop duration. ALWAYS bar-aligned — non-bar lengths look
    // "auto" friendly but cause inevitable drift against the drum sequencer
    // because the loop boundary doesn't coincide with a bar boundary.
    //   - loopBars > 0: snap to that exact bar count
    //   - loopBars = 0 ("auto"): round measured wall-clock duration UP
    //     to the nearest bar (min 1 bar). This is what the user usually
    //     means by "auto" — same musical length, just made loop-able.
    let finalDuration = measuredDuration;
    if (bpm > 0) {
      const msPerBar = (60000 / bpm) * 4; // 4 beats per bar
      const bars = s.loopBars > 0
        ? s.loopBars
        : Math.max(1, Math.ceil(measuredDuration / msPerBar));
      finalDuration = bars * msPerBar;
    }

    // Apply quantization to event timings if enabled.
    //   - Note starts (down) snap to grid.
    //   - Note ends (up) snap to grid AND are guaranteed to be at least one
    //     grid step AFTER their matching down (prevents zero-length notes).
    //   - Move events (gesture trails) stay unquantized so pitch-bends / Y-
    //     modulation remain smooth.
    let finalEvents = s.events;
    if (s.quantize !== "off" && bpm > 0) {
      const beatMs = 60000 / bpm;
      const divisions: Record<Exclude<typeof s.quantize, "off">, number> = {
        "1/4":  beatMs,
        "1/8":  beatMs / 2,
        "1/16": beatMs / 4,
        "1/32": beatMs / 8,
      };
      const grid = divisions[s.quantize as Exclude<typeof s.quantize, "off">];
      // Pass 1: snap down events to grid; remember each pointer's quantized down time
      const downTimes = new Map<number, number>();
      finalEvents = s.events.map((e) => {
        if (e.type === "down") {
          const snapped = Math.round(e.t / grid) * grid;
          downTimes.set(e.pointerId, snapped);
          return { ...e, t: snapped };
        }
        if (e.type === "up") {
          const downT = downTimes.get(e.pointerId) ?? e.t;
          const snapped = Math.round(e.t / grid) * grid;
          // Ensure at least one grid step between down and up (no zero-length notes)
          const t = Math.max(snapped, downT + grid);
          downTimes.delete(e.pointerId);
          return { ...e, t };
        }
        return e; // move events unquantized
      });
      finalEvents.sort((a, b) => a.t - b.t);
    }

    set({
      isArmed: false,
      isRecording: false,
      events: finalEvents,
      loopDuration: Math.max(finalDuration, 500),
    });
  },

  clearRecording: () => {
    const s = get();
    if (s.isLooping) s.stopLoop();
    set({
      events: [], loopDuration: 0, isRecording: false, isArmed: false,
      isStepRecording: false, stepNotes: [], stepCursor: 0,
    });
  },

  placeStepNote: (note) => {
    const s = get();
    if (!s.isStepRecording || s.stepNotes.length === 0) return;
    const stepNotes = s.stepNotes.slice();
    stepNotes[s.stepCursor] = note;
    set({
      stepNotes,
      stepCursor: (s.stepCursor + 1) % stepNotes.length,
      events: stepNotesToEvents(stepNotes, s.stepGridMs, s.loopDuration),
    });
  },

  setStepCursor: (index) => {
    const len = get().stepNotes.length;
    if (len === 0) return;
    set({ stepCursor: Math.max(0, Math.min(len - 1, index)) });
  },

  clearStepAt: (index) => {
    const s = get();
    if (index < 0 || index >= s.stepNotes.length) return;
    const stepNotes = s.stepNotes.slice();
    stepNotes[index] = null;
    set({ stepNotes, events: stepNotesToEvents(stepNotes, s.stepGridMs, s.loopDuration) });
  },

  skipStep: () => {
    const s = get();
    if (!s.isStepRecording || s.stepNotes.length === 0) return;
    set({ stepCursor: (s.stepCursor + 1) % s.stepNotes.length });
  },

  undoLastStep: () => {
    const s = get();
    if (!s.isStepRecording || s.stepNotes.length === 0) return;
    const prev = (s.stepCursor - 1 + s.stepNotes.length) % s.stepNotes.length;
    const stepNotes = s.stepNotes.slice();
    stepNotes[prev] = null;
    set({
      stepNotes, stepCursor: prev,
      events: stepNotesToEvents(stepNotes, s.stepGridMs, s.loopDuration),
    });
  },

  appendEvent: (ev) => {
    const s = get();
    // Step mode places notes via placeStepNote (called from the component);
    // appendEvent only handles real-time (armed) recording.
    if (s.isStepRecording) return;
    // If armed and this is the first event, start recording NOW
    if (s.isArmed && ev.type === "down") {
      const startTime = performance.now();
      set({ isArmed: false, isRecording: true, recordStart: startTime, events: [{ ...ev, t: 0 }] });
      return;
    }
    if (!s.isRecording) return;
    const t = performance.now() - s.recordStart;
    set((state) => ({ events: [...state.events, { ...ev, t }] }));
  },

  setLoopBars: (n) => set({ loopBars: n }),
  setQuantize: (q) => set({ quantize: q }),

  setLoopWallStart: (t) => set({ loopWallStart: t }),

  startLoop: () => {
    const s = get();
    if (s.events.length === 0 || s.isLooping) return;
    set({ isLooping: true, playbackStartTime: performance.now() });
    // Playback engine lives in PerformancePad component (needs access to engines)
  },

  stopLoop: () => {
    const s = get();
    if (s.playbackTimer) clearTimeout(s.playbackTimer);
    set({ isLooping: false, playbackTimer: null });
  },
}));
