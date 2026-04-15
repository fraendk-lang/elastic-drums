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

export const CHORDS_MAX_CLIP_STEPS = 256;

// ─── Chord Type Names (for cycling) ────────────────────────

export const CHORD_TYPE_NAMES = Object.keys(CHORD_TYPES);

// ─── Factory Sound Presets ───────────────────────────────

export interface ChordsPreset {
  name: string;
  params: ChordsParams;
}

export const CHORDS_SIGNATURE_PRESET_NAMES = [
  "House Organ",
  "Deep House",
  "Neo Soul Velvet",
  "Future RnB Stack",
  "Warm Analog Pad",
  "Airy Pluck Bed",
] as const;

const cp = (p: Partial<ChordsParams>): ChordsParams => ({ ...DEFAULT_CHORDS_PARAMS, ...p });

// Factory helper to ensure filterModel is set (for backward compatibility)
function ensureFilterModel(p: ChordsParams): ChordsParams {
  return { ...p, filterModel: p.filterModel || "lpf" };
}

export const CHORDS_PRESETS: ChordsPreset[] = [
  // ── Professional Pads ──
  { name: "Neo Soul Velvet", params: cp({ waveform: "triangle", filterModel: "ladder", cutoff: 1850, resonance: 2, envMod: 0.1, attack: 24, release: 420, detune: 5, distortion: 0.03, volume: 0.54, subOsc: 0.08, chorus: 0.14, spread: 0.34, brightness: 0.34 }) },
  { name: "Wide Cinema Pad", params: cp({ waveform: "sawtooth", filterModel: "ladder", cutoff: 1600, resonance: 3, envMod: 0.22, attack: 280, release: 1800, detune: 28, distortion: 0.06, volume: 0.48, subOsc: 0.18, chorus: 0.78, spread: 0.96, brightness: 0.58 }) },
  { name: "Hyper Pop Glass", params: cp({ waveform: "triangle", filterModel: "steiner-bp", cutoff: 4200, resonance: 7, envMod: 0.1, attack: 18, release: 360, detune: 12, distortion: 0.08, volume: 0.5, subOsc: 0, chorus: 0.26, spread: 0.74, brightness: 0.88 }) },
  { name: "Future RnB Stack", params: cp({ waveform: "sawtooth", filterModel: "ladder", cutoff: 1600, resonance: 4, envMod: 0.16, attack: 20, release: 330, detune: 9, distortion: 0.06, volume: 0.52, subOsc: 0.12, chorus: 0.24, spread: 0.48, brightness: 0.36 }) },
  { name: "Airy Pluck Bed", params: cp({ waveform: "triangle", filterModel: "steiner-hp", cutoff: 2500, resonance: 4, envMod: 0.14, attack: 8, release: 160, detune: 5, distortion: 0.02, volume: 0.48, subOsc: 0, chorus: 0.08, spread: 0.32, brightness: 0.62 }) },
  { name: "Midnight Texture", params: cp({ waveform: "sawtooth", filterModel: "steiner-lp", cutoff: 900, resonance: 8, envMod: 0.24, attack: 140, release: 1300, detune: 20, distortion: 0.14, volume: 0.44, subOsc: 0.24, chorus: 0.46, spread: 0.82, brightness: 0.2 }) },
  { name: "Warm Analog Pad", params: cp({ waveform: "sawtooth", filterModel: "ladder", cutoff: 980, resonance: 2, envMod: 0.12, attack: 55, release: 420, detune: 11, distortion: 0.02, volume: 0.48, subOsc: 0.18, chorus: 0.22, spread: 0.42, brightness: 0.18 }) },
  { name: "Glass Keys", params: cp({ waveform: "triangle", filterModel: "steiner-bp", cutoff: 3000, resonance: 3, envMod: 0.05, attack: 50, release: 800, detune: 8, distortion: 0, volume: 0.45, subOsc: 0, chorus: 0.2, spread: 0.4, brightness: 0.7 }) },
  { name: "Reese Pad", params: cp({ waveform: "sawtooth", filterModel: "ladder", cutoff: 1200, resonance: 12, envMod: 0.3, attack: 150, release: 1000, detune: 18, distortion: 0.05, volume: 0.5, subOsc: 0.2, chorus: 0.6, spread: 0.7, brightness: 0.25 }) },
  { name: "Ambient Wash", params: cp({ waveform: "triangle", filterModel: "lpf", cutoff: 600, resonance: 1, envMod: 0.08, attack: 250, release: 2000, detune: 30, distortion: 0, volume: 0.35, subOsc: 0.4, chorus: 0.5, spread: 1.0, brightness: 0.1 }) },
  { name: "Dark Strings", params: cp({ waveform: "sawtooth", filterModel: "ladder", cutoff: 900, resonance: 4, envMod: 0.2, attack: 120, release: 900, detune: 15, distortion: 0.08, volume: 0.48, subOsc: 0.25, chorus: 0.35, spread: 0.8, brightness: 0.15 }) },
  // ── Classic Pads (original) ──
  { name: "Ethereal Pad", params: cp({ waveform: "triangle", filterModel: "lpf", cutoff: 1200, resonance: 4, envMod: 0.08, attack: 300, release: 2000, detune: 30, distortion: 0, volume: 0.35, subOsc: 0.6, chorus: 0.3, spread: 0.5, brightness: 0.3 }) },
  { name: "String Machine", params: cp({ waveform: "sawtooth", filterModel: "lpf", cutoff: 900, resonance: 2, envMod: 0.12, attack: 120, release: 800, detune: 18, distortion: 0.05, volume: 0.5, subOsc: 0.2, chorus: 0.3, spread: 0.5, brightness: 0.3 }) },
  { name: "Glass Pad Classic", params: cp({ waveform: "triangle", filterModel: "steiner-lp", cutoff: 2500, resonance: 8, envMod: 0.05, attack: 150, release: 1200, detune: 10, distortion: 0, volume: 0.4, subOsc: 0, chorus: 0.3, spread: 0.5, brightness: 0.3 }) },
  // ── Stabs ──
  { name: "Bright Stabs", params: cp({ waveform: "sawtooth", cutoff: 2000, resonance: 8, envMod: 0.5, attack: 5, release: 100, detune: 8, distortion: 0.2, volume: 0.5, subOsc: 0 }) },
  { name: "Techno Stabs", params: cp({ waveform: "square", cutoff: 1800, resonance: 12, envMod: 0.7, attack: 3, release: 80, detune: 3, distortion: 0.3, volume: 0.5, subOsc: 0 }) },
  { name: "House Organ", params: cp({ waveform: "triangle", filterModel: "ladder", cutoff: 1350, resonance: 4, envMod: 0.26, attack: 5, release: 105, detune: 4, distortion: 0.08, volume: 0.54, subOsc: 0.08, chorus: 0.05, spread: 0.18, brightness: 0.3 }) },
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
  { name: "Deep House", params: cp({ waveform: "triangle", filterModel: "ladder", cutoff: 820, resonance: 5, envMod: 0.22, attack: 10, release: 155, detune: 6, distortion: 0.06, volume: 0.52, subOsc: 0.16, chorus: 0.08, spread: 0.24, brightness: 0.22 }) },
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
  { name: "Glass Pad Bright", params: cp({ waveform: "triangle", cutoff: 5000, resonance: 3, envMod: 0.1, attack: 250, release: 1000, detune: 5, distortion: 0, volume: 0.6, subOsc: 0, chorus: 0.2, spread: 0.3, brightness: 0.6 }) },
  { name: "Dark Pad", params: cp({ waveform: "sawtooth", cutoff: 2000, resonance: 2, envMod: 0.1, attack: 150, release: 900, detune: 3, distortion: 0, volume: 0.5, subOsc: 0, chorus: 0.5, spread: 0.5, brightness: 0 }) },
  { name: "Choir Pad", params: cp({ waveform: "sawtooth", cutoff: 3000, resonance: 2, envMod: 0.15, attack: 400, release: 1200, detune: 10, distortion: 0, volume: 0.6, subOsc: 0, chorus: 0.3, spread: 0.9, brightness: 0.4 }) },
  { name: "Cinematic Pad", params: cp({ waveform: "sawtooth", cutoff: 5000, resonance: 2, envMod: 0.2, attack: 500, release: 2000, detune: 25, distortion: 0, volume: 0.6, subOsc: 0.1, chorus: 0.4, spread: 0.8, brightness: 0.5 }) },
  { name: "PWM Pad", params: cp({ waveform: "square", cutoff: 3000, resonance: 2, envMod: 0.15, attack: 300, release: 1000, detune: 8, distortion: 0, volume: 0.55, subOsc: 0.2, chorus: 0.6, spread: 0.5, brightness: 0.2 }) },
  { name: "Ambient Wash Wide", params: cp({ waveform: "sawtooth", cutoff: 6000, resonance: 1, envMod: 0.1, attack: 500, release: 2000, detune: 12, distortion: 0, volume: 0.45, subOsc: 0.3, chorus: 0.3, spread: 1.0, brightness: 0.3 }) },
  { name: "Soft Keys", params: cp({ waveform: "triangle", cutoff: 2000, resonance: 1, envMod: 0.08, attack: 80, release: 400, detune: 2, distortion: 0, volume: 0.55, subOsc: 0, chorus: 0, spread: 0.2, brightness: 0.1 }) },
  // ── Deep House Collection ──
  { name: "DH Rhodes Warm", params: cp({ waveform: "triangle", cutoff: 2200, resonance: 2, envMod: 0.12, attack: 8, release: 350, detune: 3, distortion: 0.04, volume: 0.6, subOsc: 0, chorus: 0.15, spread: 0.3, brightness: 0.2 }) },
  { name: "DH Rhodes Bright", params: cp({ waveform: "triangle", cutoff: 3500, resonance: 2, envMod: 0.18, attack: 5, release: 280, detune: 2, distortion: 0.06, volume: 0.58, subOsc: 0, chorus: 0.1, spread: 0.25, brightness: 0.4 }) },
  { name: "DH Juno Stab", params: cp({ waveform: "sawtooth", cutoff: 1800, resonance: 4, envMod: 0.4, attack: 3, release: 120, detune: 8, distortion: 0.08, volume: 0.6, subOsc: 0.1, chorus: 0.5, spread: 0.6, brightness: 0.15 }) },
  { name: "DH Juno Pad", params: cp({ waveform: "sawtooth", cutoff: 2400, resonance: 2, envMod: 0.1, attack: 300, release: 1000, detune: 12, distortion: 0, volume: 0.55, subOsc: 0.15, chorus: 0.65, spread: 0.7, brightness: 0.25 }) },
  { name: "DH Organ Stab", params: cp({ waveform: "triangle", cutoff: 1500, resonance: 3, envMod: 0.25, attack: 2, release: 100, detune: 4, distortion: 0.1, volume: 0.6, subOsc: 0.08, chorus: 0.05, spread: 0.15, brightness: 0.3 }) },
  { name: "DH Soulful Pad", params: cp({ waveform: "sawtooth", cutoff: 1600, resonance: 2, envMod: 0.08, attack: 250, release: 900, detune: 10, distortion: 0, volume: 0.5, subOsc: 0.2, chorus: 0.4, spread: 0.8, brightness: 0.15 }) },
  // ── Producer Essentials: Chords that sit perfectly in a mix ──
  { name: "Wurlitzer Warm", params: cp({ waveform: "triangle", cutoff: 1800, resonance: 3, envMod: 0.15, attack: 5, release: 250, detune: 2, distortion: 0.08, volume: 0.58, subOsc: 0, chorus: 0.08, spread: 0.2, brightness: 0.15 }) },
  { name: "Chill Keys", params: cp({ waveform: "triangle", cutoff: 2500, resonance: 2, envMod: 0.1, attack: 12, release: 400, detune: 3, distortion: 0.03, volume: 0.55, subOsc: 0, chorus: 0.12, spread: 0.3, brightness: 0.25 }) },
  { name: "Gospel Organ", params: cp({ waveform: "triangle", cutoff: 1200, resonance: 2, envMod: 0.2, attack: 2, release: 80, detune: 3, distortion: 0.12, volume: 0.6, subOsc: 0.1, chorus: 0.04, spread: 0.12, brightness: 0.35 }) },
  { name: "Garage Stab", params: cp({ waveform: "sawtooth", cutoff: 2200, resonance: 5, envMod: 0.5, attack: 2, release: 80, detune: 6, distortion: 0.1, volume: 0.62, subOsc: 0.08, chorus: 0.3, spread: 0.5, brightness: 0.2 }) },
  { name: "90s House Organ", params: cp({ waveform: "triangle", cutoff: 1400, resonance: 3, envMod: 0.3, attack: 1, release: 60, detune: 2, distortion: 0.15, volume: 0.6, subOsc: 0.05, chorus: 0.03, spread: 0.1, brightness: 0.4 }) },
  { name: "Detroit Strings", params: cp({ waveform: "sawtooth", cutoff: 3000, resonance: 1, envMod: 0.08, attack: 350, release: 1200, detune: 14, distortion: 0, volume: 0.55, subOsc: 0, chorus: 0.55, spread: 0.9, brightness: 0.2 }) },
  { name: "Prophet Pad", params: cp({ waveform: "sawtooth", cutoff: 2000, resonance: 3, envMod: 0.12, attack: 200, release: 800, detune: 10, distortion: 0.05, volume: 0.55, subOsc: 0.15, chorus: 0.35, spread: 0.6, brightness: 0.18 }) },
  { name: "OB-Xa Brass", params: cp({ waveform: "sawtooth", cutoff: 1600, resonance: 4, envMod: 0.35, attack: 15, release: 200, detune: 6, distortion: 0.08, volume: 0.6, subOsc: 0.2, chorus: 0.15, spread: 0.4, brightness: 0.25 }) },
  { name: "Vocal Pad", params: cp({ waveform: "sawtooth", cutoff: 1200, resonance: 5, envMod: 0.15, attack: 400, release: 1500, detune: 8, distortion: 0, volume: 0.5, subOsc: 0.1, chorus: 0.3, spread: 0.7, brightness: 0.1 }) },
  { name: "Ambient Shimmer", params: cp({ waveform: "triangle", cutoff: 5000, resonance: 1, envMod: 0.05, attack: 500, release: 2000, detune: 20, distortion: 0, volume: 0.45, subOsc: 0, chorus: 0.5, spread: 1.0, brightness: 0.5 }) },
  { name: "Tape Chords", params: cp({ waveform: "sawtooth", cutoff: 1800, resonance: 2, envMod: 0.1, attack: 10, release: 300, detune: 5, distortion: 0.18, volume: 0.58, subOsc: 0.1, chorus: 0.08, spread: 0.3, brightness: 0.08 }) },
  { name: "Lo-Fi Keys", params: cp({ waveform: "triangle", cutoff: 1600, resonance: 3, envMod: 0.12, attack: 8, release: 350, detune: 4, distortion: 0.2, volume: 0.55, subOsc: 0, chorus: 0.06, spread: 0.2, brightness: 0.05 }) },
  { name: "Afro Stab", params: cp({ waveform: "sawtooth", cutoff: 2500, resonance: 4, envMod: 0.45, attack: 2, release: 100, detune: 5, distortion: 0.06, volume: 0.6, subOsc: 0.05, chorus: 0.2, spread: 0.4, brightness: 0.3 }) },
  { name: "Neo Soul Keys", params: cp({ waveform: "triangle", cutoff: 2000, resonance: 2, envMod: 0.08, attack: 10, release: 450, detune: 3, distortion: 0.02, volume: 0.55, subOsc: 0, chorus: 0.1, spread: 0.25, brightness: 0.2 }) },
  { name: "Synthwave Pad", params: cp({ waveform: "sawtooth", cutoff: 3500, resonance: 3, envMod: 0.15, attack: 150, release: 600, detune: 18, distortion: 0.05, volume: 0.55, subOsc: 0.1, chorus: 0.6, spread: 0.8, brightness: 0.35 }) },
  { name: "Glass Stab", params: cp({ waveform: "triangle", cutoff: 4000, resonance: 5, envMod: 0.55, attack: 1, release: 60, detune: 3, distortion: 0, volume: 0.55, subOsc: 0, chorus: 0.15, spread: 0.3, brightness: 0.5 }) },
  { name: "Warm Blanket", params: cp({ waveform: "sawtooth", cutoff: 1000, resonance: 1, envMod: 0.05, attack: 500, release: 1800, detune: 12, distortion: 0, volume: 0.48, subOsc: 0.25, chorus: 0.45, spread: 0.9, brightness: 0 }) },
  { name: "Disco Strings", params: cp({ waveform: "sawtooth", cutoff: 3500, resonance: 2, envMod: 0.12, attack: 250, release: 800, detune: 15, distortion: 0, volume: 0.55, subOsc: 0, chorus: 0.5, spread: 0.85, brightness: 0.3 }) },
  { name: "Trance Pad", params: cp({ waveform: "sawtooth", cutoff: 2800, resonance: 4, envMod: 0.2, attack: 200, release: 1000, detune: 20, distortion: 0.03, volume: 0.55, subOsc: 0.1, chorus: 0.4, spread: 0.7, brightness: 0.4 }) },
  { name: "Minimal Stab", params: cp({ waveform: "square", cutoff: 1500, resonance: 6, envMod: 0.5, attack: 1, release: 40, detune: 2, distortion: 0.05, volume: 0.58, subOsc: 0, chorus: 0, spread: 0.1, brightness: 0.2 }) },
];

export const CHORDS_CORE_PRESETS = CHORDS_PRESETS.filter((preset) =>
  CHORDS_SIGNATURE_PRESET_NAMES.includes(preset.name as typeof CHORDS_SIGNATURE_PRESET_NAMES[number])
);

const getChordsCorePresetIndex = (index: number): number => {
  const currentName = CHORDS_PRESETS[index]?.name;
  const coreIndex = CHORDS_CORE_PRESETS.findIndex((preset) => preset.name === currentName);
  return coreIndex >= 0 ? coreIndex : 0;
};

// ─── Chordline Agent: Genre Strategies ──────────────────

export interface ChordlineStrategy {
  name: string;
  generate: (length: number, scaleLen: number) => ChordsStep[];
}

function makeStep(note: number, chordType: string, opts?: Partial<ChordsStep>): ChordsStep {
  return { active: true, note, chordType, octave: 0, accent: false, velocity: 0.8, tie: false, gateLength: 1, ...opts };
}

function emptyStep(): ChordsStep {
  return { active: false, note: 0, chordType: "Min", octave: 0, accent: false, velocity: 0.8, tie: false, gateLength: 1 };
}

function prob(p: number): boolean { return Math.random() < p; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }
function pickChordGate(style: "stab" | "groove" | "hold" = "groove"): number {
  if (style === "stab") return pick([1, 1, 2, 2]);
  if (style === "hold") return pick([3, 4, 4, 6, 8]);
  return pick([2, 2, 3, 4, 4, 6]);
}

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
      // House stabs with occasional held suspensions
      const steps: ChordsStep[] = [];
      const chordTypes = ["Maj7", "Min7", "7th", "9th"];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (i % 4 === 0 && prob(0.82)) {
          const note = pick([0, 0, Math.min(3, scaleLen - 1), Math.min(4, scaleLen - 1)]);
          const gateLength = i % 8 === 0 ? pickChordGate("groove") : pickChordGate("stab");
          steps.push(makeStep(note, pick(chordTypes), {
            accent: i % 8 === 0,
            gateLength,
          }));
        } else if (i % 8 === 6 && prob(0.35)) {
          steps.push(makeStep(0, pick(["Min7", "Maj7", "Sus2"]), {
            accent: false,
            gateLength: pickChordGate("hold"),
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
      // Constrained random with house/deep-house friendly harmony
      const steps: ChordsStep[] = [];
      const chordPalette = ["Min7", "Maj7", "7th", "9th", "Sus2", "Add9"];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        const phraseEdge = i % 4 === 0;
        if ((phraseEdge && prob(0.7)) || prob(0.16)) {
          const gateLength = phraseEdge ? pickChordGate("groove") : pickChordGate("stab");
          steps.push(makeStep(
            pick([0, 0, 1, Math.min(3, scaleLen - 1), Math.min(4, scaleLen - 1)]),
            pick(chordPalette),
            {
              octave: prob(0.2) ? pick([1, -1]) : 0,
              accent: phraseEdge ? prob(0.45) : prob(0.12),
              tie: gateLength >= 4 && prob(0.2),
              gateLength,
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
  globalOctave: number;
  params: ChordsParams;
  presetIndex: number;
  strategyIndex: number;
  automationData: Record<string, Array<number | undefined>>;
  automationParam: string;
  isPlaying: boolean;
  instrument: string;

  setAutomationValue: (param: string, step: number, value: number | undefined) => void;
  setAutomationParam: (param: string) => void;
  clearAutomation: (param: string) => void;
  toggleStep: (step: number) => void;
  setStepNote: (step: number, note: number) => void;
  setStepOctave: (step: number, octave: number) => void;
  setStepVelocity: (step: number, velocity: number) => void;
  cycleChordType: (step: number) => void;
  setStepChordType: (step: number, chordType: string) => void;
  toggleAccent: (step: number) => void;
  toggleTie: (step: number) => void;
  setGateLength: (fromStep: number, toStep: number) => void;
  cycleOctave: (step: number) => void;
  setRootNote: (midi: number, name: string) => void;
  setGlobalOctave: (oct: number) => void;
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
  return Array.from({ length: CHORDS_MAX_CLIP_STEPS }, () => ({
    active: false, note: 0, chordType: "Min", octave: 0, accent: false, velocity: 0.8, tie: false, gateLength: 1,
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

    const getLegacyTieLength = (sequence: ChordsStep[], startIndex: number, sequenceLength: number) => {
      let span = 1;
      for (let i = 1; i < sequenceLength; i++) {
        const nextIdx = (startIndex + i) % sequenceLength;
        const next = sequence[nextIdx];
        if (!next?.active || !next.tie) break;
        span += 1;
        if (nextIdx === startIndex) break;
      }
      return span;
    };

    while (nextChordsStepTime < audioEngine.currentTime + 0.1) {
      const { steps, currentStep, length, rootNote, scaleName, automationData, globalOctave } = useChordsStore.getState();
      const stepIndex = currentStep % length;
      const step = steps[stepIndex];
      const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : steps[length - 1];

      // Apply per-step automation
      for (const [param, vals] of Object.entries(automationData)) {
        const val = vals[currentStep % length];
        if (val !== undefined) chordsEngine.setParams({ [param]: val });
      }

      const isContinuationTie = Boolean(step?.active && step.tie && prevStep?.active);
      let isHeldByPreviousGate = false;

      if (!step?.active) {
        for (let back = 1; back < length; back++) {
          const candidateIndex = (stepIndex - back + length) % length;
          const candidate = steps[candidateIndex];
          if (!candidate?.active) continue;

          const candidatePrev = candidateIndex > 0 ? steps[candidateIndex - 1] : steps[length - 1];
          const candidateIsContinuation = Boolean(candidate.tie && candidatePrev?.active);
          if (candidateIsContinuation) continue;

          const explicitGateLength = Math.max(1, candidate.gateLength ?? 1);
          const span = explicitGateLength > 1 ? explicitGateLength : getLegacyTieLength(steps, candidateIndex, length);
          isHeldByPreviousGate = back < span;
          break;
        }
      }

      if (step?.active && !isContinuationTie) {
        // Convert scale degree + chord type to MIDI note array
        const rootMidi = scaleNote(rootNote, scaleName, step.note, step.octave + globalOctave);
        const intervals = CHORD_TYPES[step.chordType] ?? CHORD_TYPES["Min"]!;
        const midiNotes = intervals.map((interval) => rootMidi + interval);
        const explicitGateLength = Math.max(1, step.gateLength ?? 1);
        const sustainSteps = explicitGateLength > 1 ? explicitGateLength : getLegacyTieLength(steps, stepIndex, length);
        const sustainDuration = secondsPerStep * sustainSteps;

        const { instrument } = useChordsStore.getState();

        // Use soundfont if a non-synth instrument is selected
        if (instrument !== "_synth_") {
          const velocity = Math.max(0.2, Math.min(1, step.velocity ?? (step.accent ? 1.0 : 0.7)));
          const duration = Math.max(secondsPerStep * 1.5, sustainDuration * 0.98);
          soundFontEngine.playChord("chords", midiNotes, nextChordsStepTime, velocity, duration);
        } else {
          // Use built-in synth
          chordsEngine.triggerChord(midiNotes, nextChordsStepTime, step.accent, false, step.velocity ?? (step.accent ? 1.0 : 0.7));
          chordsEngine.releaseChord(nextChordsStepTime + Math.max(secondsPerStep * 0.92, sustainDuration * 0.98));
        }
      } else if (!step?.active && !isHeldByPreviousGate) {
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
  globalOctave: 0,
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
    const newLen = step >= s.length ? Math.min(CHORDS_MAX_CLIP_STEPS, step + 1) : s.length;
    return { steps: newSteps, length: newLen };
  }),

  setStepNote: (step, note) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, note }; return { steps: newSteps };
  }),

  setStepOctave: (step, octave) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, octave }; return { steps: newSteps };
  }),

  setStepVelocity: (step, velocity) => set((s) => {
    const newSteps = [...s.steps];
    newSteps[step] = { ...newSteps[step]!, velocity: Math.max(0.2, Math.min(1, velocity)) };
    return { steps: newSteps };
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

  setGateLength: (fromStep, toStep) => set((s) => {
    const newSteps = [...s.steps];
    const sourceStep = newSteps[fromStep]!;
    if (!sourceStep.active) return { steps: newSteps };

    const gateLength = Math.max(1, Math.min(CHORDS_MAX_CLIP_STEPS - fromStep, toStep - fromStep + 1));
    newSteps[fromStep] = { ...sourceStep, gateLength };

    for (let i = fromStep + 1; i < CHORDS_MAX_CLIP_STEPS; i++) {
      if (newSteps[i]?.tie && newSteps[i]?.active) {
        newSteps[i] = { active: false, note: 0, chordType: "Min", octave: 0, accent: false, velocity: 0.8, tie: false, gateLength: 1 };
      } else break;
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
    syncScaleToOtherStores("chords", { rootNote: midi, rootName: name });
  },
  setGlobalOctave: (oct) => set({ globalOctave: Math.max(-2, Math.min(2, oct)) }),
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
      if (!data[key]) data[key] = new Array(CHORDS_MAX_CLIP_STEPS).fill(undefined);
      const arr = [...data[key]!];
      arr[currentStep % length] = value;
      data[key] = arr;
      set({ automationData: data });
    }
  },

  setLength: (len) => set({ length: Math.max(4, Math.min(CHORDS_MAX_CLIP_STEPS, len)) }),
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
        newSteps[i] = { active: true, note, chordType: "Min", octave: 0, accent: i % 4 === 0, velocity: i % 4 === 0 ? 0.95 : 0.72, tie: false, gateLength: 1 };
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

  nextPreset: () => {
    const nextCore = (getChordsCorePresetIndex(get().presetIndex) + 1) % CHORDS_CORE_PRESETS.length;
    const nextName = CHORDS_CORE_PRESETS[nextCore]?.name;
    const nextIndex = CHORDS_PRESETS.findIndex((preset) => preset.name === nextName);
    if (nextIndex >= 0) get().loadPreset(nextIndex);
  },
  prevPreset: () => {
    const prevCore = (getChordsCorePresetIndex(get().presetIndex) - 1 + CHORDS_CORE_PRESETS.length) % CHORDS_CORE_PRESETS.length;
    const prevName = CHORDS_CORE_PRESETS[prevCore]?.name;
    const prevIndex = CHORDS_PRESETS.findIndex((preset) => preset.name === prevName);
    if (prevIndex >= 0) get().loadPreset(prevIndex);
  },

  setInstrument: async (id: string) => {
    if (id === "_synth_") {
      soundFontEngine.stopAll("chords");
      set({ instrument: id });
      return;
    }

    set({ instrument: id });
    const ctx = audioEngine.getAudioContext();
    if (ctx) {
      const destination = audioEngine.getChannelOutput(13); // Chords = channel 13
      try {
        const ok = await soundFontEngine.loadInstrument("chords", id, destination);
        if (!ok) {
          set({ instrument: "_synth_" });
        }
      } catch (err) {
        console.warn("Failed to load chords instrument:", err);
        set({ instrument: "_synth_" });
      }
    }
  },

  setAutomationValue: (param, step, value) => set((s) => {
    const data = { ...s.automationData };
    if (!data[param]) data[param] = new Array(CHORDS_MAX_CLIP_STEPS).fill(undefined);
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
