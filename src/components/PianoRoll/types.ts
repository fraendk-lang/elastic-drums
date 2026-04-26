import { SCALES } from "../../audio/BassEngine";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═════════════════════════════════════════════════════════════════════════ */

export type SoundTarget = "bass" | "chords" | "melody" | "drums";

export interface PianoRollNote {
  id: string;
  midi: number;
  start: number;
  duration: number;
  velocity: number;
  track: SoundTarget;
}

export interface LoopRange {
  start: number; // in beats
  end: number;   // in beats (exclusive)
  enabled: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═════════════════════════════════════════════════════════════════════════ */

export const OCTAVE_PATTERN = [
  { note: "C", black: false },
  { note: "C#", black: true },
  { note: "D", black: false },
  { note: "D#", black: true },
  { note: "E", black: false },
  { note: "F", black: false },
  { note: "F#", black: true },
  { note: "G", black: false },
  { note: "G#", black: true },
  { note: "A", black: false },
  { note: "A#", black: true },
  { note: "B", black: false },
];

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const PIANO_WIDTH = 68;
export const DEFAULT_CELL_W = 90;
export const DEFAULT_ROW_HEIGHT = 30;
export const RULER_HEIGHT = 24;
export const VELOCITY_LANE_HEIGHT = 80;

// Pitch range — 6 octaves, C2 (36) → C8 (108)
export const BASE_NOTE = 36;
export const TOTAL_ROWS = 72;

// Piano key colors
export const PIANO_WHITE_BG = "linear-gradient(180deg, #2a2a30 0%, #222228 100%)";
export const PIANO_WHITE_BG_C = "linear-gradient(180deg, #33333a 0%, #2b2b32 100%)";
export const PIANO_BLACK_BG = "#0d0d10";
export const PIANO_BLACK_BG_HOVER = "#191920";

export const TARGET_COLORS: Record<SoundTarget, string> = {
  bass: "var(--ed-accent-bass, #10b981)",
  chords: "var(--ed-accent-chords, #a78bfa)",
  melody: "var(--ed-accent-melody, #f472b6)",
  drums: "var(--ed-accent-orange, #f59e0b)",
};

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═════════════════════════════════════════════════════════════════════════ */

export function midiNoteName(midi: number): string {
  return (NOTE_NAMES[midi % 12] ?? "?") + (Math.floor(midi / 12) - 1);
}

export function uid(): string {
  return `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function getScaleNotes(
  rootMidi: number,
  scaleName: string,
  fromOctave: number,
  toOctave: number,
): number[] {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const result: number[] = [];
  for (let oct = fromOctave; oct <= toOctave; oct++) {
    for (const deg of scale) {
      const midi = rootMidi + (oct - Math.floor(rootMidi / 12)) * 12 + deg;
      if (midi >= 0 && midi <= 127) result.push(midi);
    }
  }
  return result.sort((a, b) => a - b);
}

export function chordFromDegree(scaleName: string, degree: number): number[] {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const root = scale[degree % scale.length] ?? 0;
  const third = scale[(degree + 2) % scale.length] ?? 0;
  const fifth = scale[(degree + 4) % scale.length] ?? 0;
  return [root, third + (third < root ? 12 : 0), fifth + (fifth < third ? 12 : 0)];
}

export function isNoteInScale(midi: number, rootMidi: number, scaleName: string): boolean {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const degree = (midi - rootMidi + 120) % 12;
  return scale.includes(degree);
}

export function snapToScale(midi: number, rootMidi: number, scaleName: string): number {
  if (isNoteInScale(midi, rootMidi, scaleName)) return midi;
  for (let offset = 1; offset <= 6; offset++) {
    if (isNoteInScale(midi + offset, rootMidi, scaleName)) return midi + offset;
    if (isNoteInScale(midi - offset, rootMidi, scaleName)) return midi - offset;
  }
  return midi;
}
