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

export type YAxisParam = "cutoff" | "resonance" | "envMod" | "decay" | "distortion" | "volume";

export type PadTarget = "melody" | "bass";

/** Pad play mode — "notes" = free-pitch via X-axis, "chords" = chord cells grid. */
export type PadMode = "notes" | "chords";

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
];

export interface PadEvent {
  t: number;            // ms since record start
  type: "down" | "move" | "up";
  pointerId: number;    // stable ID for multi-touch tracking
  x: number;            // 0-1
  y: number;            // 0-1
  velocity: number;     // 0-1 (used on "down")
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

  // Recording
  events: PadEvent[];
  isArmed: boolean;         // REC pressed, waiting for first note to actually start
  isRecording: boolean;
  isStepRecording: boolean; // Step-record mode — each press places a note at the current step and advances
  stepCursorMs: number;     // Current "virtual time" position in step mode (ms from loop start)
  isLooping: boolean;
  recordStart: number;      // performance.now() at record start (first-note-touch)
  loopDuration: number;     // ms, set after first recording (quantized if loopBars set)
  loopBars: 0 | 1 | 2 | 4 | 8; // 0 = auto (use measured duration), else snap to N bars at BPM
  quantize: "off" | "1/4" | "1/8" | "1/16" | "1/32";  // Grid to snap event timings to
  playbackTimer: ReturnType<typeof setTimeout> | null;
  playbackStartTime: number;

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

  // Recording API
  armRecording: () => void;     // Arm for recording — starts on first note
  startStepRecording: (bpm: number) => void;
  stopRecording: (bpm: number) => void;  // bpm needed to compute bar-snapped loop length
  clearRecording: () => void;
  appendEvent: (ev: Omit<PadEvent, "t">) => void;
  setLoopBars: (n: 0 | 1 | 2 | 4 | 8) => void;
  setQuantize: (q: "off" | "1/4" | "1/8" | "1/16" | "1/32") => void;

  // Loop playback API
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

  events: [],
  isArmed: false,
  isRecording: false,
  isStepRecording: false,
  stepCursorMs: 0,
  isLooping: false,
  recordStart: 0,
  loopDuration: 0,
  loopBars: 0,          // 0 = auto (use measured duration)
  quantize: "off",
  playbackTimer: null,
  playbackStartTime: 0,

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
    set({
      isArmed: false,
      isRecording: false,
      isStepRecording: true,
      stepCursorMs: 0,
      recordStart: performance.now(), // placeholder, step mode doesn't use it
      events: [],
      // Auto-set loopDuration based on loopBars or default 2 bars
      loopDuration: s.loopBars > 0
        ? s.loopBars * (60000 / bpm) * 4
        : 2 * (60000 / bpm) * 4,
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

    // Compute loop duration: snap to N bars if loopBars set, else use measured
    let finalDuration = measuredDuration;
    if (s.loopBars > 0 && bpm > 0) {
      const msPerBar = (60000 / bpm) * 4; // 4 beats per bar
      finalDuration = s.loopBars * msPerBar;
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
    set({ events: [], loopDuration: 0, isRecording: false, isArmed: false, isStepRecording: false, stepCursorMs: 0 });
  },

  appendEvent: (ev) => {
    const s = get();

    // Step-record mode: each pointer-down places a note at stepCursorMs
    // and auto-advances the cursor by one quantize grid. "move" events are
    // ignored. "up" event finalizes note length (one grid step by default).
    if (s.isStepRecording) {
      if (ev.type === "move") return; // no gesture tracking in step mode
      // We need BPM to compute grid — read from drumStore via window
      const bpm = (window as unknown as { __drumStore?: { getState: () => { bpm: number } } })
        .__drumStore?.getState().bpm ?? 120;
      const beatMs = 60000 / bpm;
      const gridMap: Record<typeof s.quantize, number> = {
        "off":  beatMs / 4,   // default: 1/16 if Q is off in step mode
        "1/4":  beatMs,
        "1/8":  beatMs / 2,
        "1/16": beatMs / 4,
        "1/32": beatMs / 8,
      };
      const grid = gridMap[s.quantize];

      if (ev.type === "down") {
        const downT = s.stepCursorMs;
        // Note dauert volle grid-Länge (legato feel) — liefert sichtbare,
        // musikalische Noten in der Piano Roll statt winzigen Dots.
        set((state) => ({
          events: [
            ...state.events,
            { ...ev, t: downT },
            { ...ev, t: downT + grid, type: "up" as const },
          ],
          // Advance cursor by one grid step, wrap at loopDuration
          stepCursorMs: (downT + grid) % (state.loopDuration || grid * 16),
        }));
      }
      return;
    }

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
