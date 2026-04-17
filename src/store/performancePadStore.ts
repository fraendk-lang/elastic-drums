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
  yParam: YAxisParam;
  scaleOctaves: number;     // Pitch range width in octaves (1-4)
  scaleLowestOct: number;   // Octave offset from C3 (-2 to +2)
  gridSnap: boolean;        // Snap X to scale notes vs. smooth pitch bend
  glide: number;            // 0-1, portamento ms factor for mono-like expressiveness

  // Recording
  events: PadEvent[];
  isRecording: boolean;
  isLooping: boolean;
  recordStart: number;      // performance.now() at record start
  loopDuration: number;     // ms, set after first recording
  playbackTimer: ReturnType<typeof setTimeout> | null;
  playbackStartTime: number;

  // Setters
  setTarget: (t: PadTarget) => void;
  setYParam: (p: YAxisParam) => void;
  setScaleOctaves: (n: number) => void;
  setScaleLowestOct: (n: number) => void;
  setGridSnap: (b: boolean) => void;
  setGlide: (n: number) => void;

  // Recording API
  startRecording: () => void;
  stopRecording: () => void;
  clearRecording: () => void;
  appendEvent: (ev: Omit<PadEvent, "t">) => void;

  // Loop playback API
  startLoop: () => void;
  stopLoop: () => void;
}

export const usePerformancePadStore = create<PerformancePadState>((set, get) => ({
  target: "melody",
  yParam: "cutoff",
  scaleOctaves: 2,
  scaleLowestOct: 0,
  gridSnap: true,
  glide: 0.15,

  events: [],
  isRecording: false,
  isLooping: false,
  recordStart: 0,
  loopDuration: 0,
  playbackTimer: null,
  playbackStartTime: 0,

  setTarget: (t) => set({ target: t }),
  setYParam: (p) => set({ yParam: p }),
  setScaleOctaves: (n) => set({ scaleOctaves: Math.max(1, Math.min(4, n)) }),
  setScaleLowestOct: (n) => set({ scaleLowestOct: Math.max(-2, Math.min(2, n)) }),
  setGridSnap: (b) => set({ gridSnap: b }),
  setGlide: (n) => set({ glide: Math.max(0, Math.min(1, n)) }),

  startRecording: () => {
    const s = get();
    if (s.isLooping) s.stopLoop();
    set({
      isRecording: true,
      recordStart: performance.now(),
      events: [],
      loopDuration: 0,
    });
  },

  stopRecording: () => {
    const s = get();
    if (!s.isRecording) return;
    const now = performance.now();
    const duration = now - s.recordStart;
    set({
      isRecording: false,
      loopDuration: Math.max(duration, 500),
    });
  },

  clearRecording: () => {
    const s = get();
    if (s.isLooping) s.stopLoop();
    set({ events: [], loopDuration: 0, isRecording: false });
  },

  appendEvent: (ev) => {
    const s = get();
    if (!s.isRecording) return;
    const t = performance.now() - s.recordStart;
    set((state) => ({ events: [...state.events, { ...ev, t }] }));
  },

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
