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
import { generateEuclidean, useDrumStore } from "./drumStore";

export const BASS_MAX_CLIP_STEPS = 256;

// ─── Factory Sound Presets ───────────────────────────────

export interface BassPreset {
  name: string;
  params: BassParams;
}

export const BASS_SIGNATURE_PRESET_NAMES = [
  "Deep Sub",
  "Analog Warmth",
  "House Groove",
  "Tape Bass",
  "Classic 303",
] as const;

const bp = (p: Partial<BassParams>): BassParams => ({ ...DEFAULT_BASS_PARAMS, ...p });

// Factory helper to ensure filterModel is set (for backward compatibility)
function ensureFilterModel(p: BassParams): BassParams {
  return { ...p, filterModel: p.filterModel || "ladder" };
}

export const BASS_PRESETS: BassPreset[] = [
  // ── Classic Acid ──
  { name: "Classic 303", params: bp({ cutoff: 420, resonance: 20, envMod: 0.78, decay: 135, accent: 0.58, slideTime: 42, distortion: 0.34, volume: 0.64, subOsc: 0.08, filterModel: "ladder", punch: 0.22, harmonics: 0.18, subFilter: 72 }) },
  { name: "Warm Vintage", params: bp({ waveform: "square", cutoff: 200, resonance: 4, envMod: 0.15, decay: 300, accent: 0.3, slideTime: 80, distortion: 0.35, volume: 0.7, subOsc: 0.6, filterModel: "ladder", punch: 0.15, harmonics: 0.2, subFilter: 60 }) },
  { name: "Acid Squelch", params: bp({ cutoff: 400, resonance: 22, envMod: 0.85, decay: 120, accent: 0.7, slideTime: 50, distortion: 0.4 }) },
  { name: "Acid Screamer", params: bp({ cutoff: 350, resonance: 28, envMod: 0.95, decay: 100, accent: 0.9, slideTime: 30, distortion: 0.6, volume: 0.65 }) },
  { name: "Acid Whistle", params: bp({ cutoff: 600, resonance: 26, envMod: 0.9, decay: 60, accent: 0.8, slideTime: 40, distortion: 0.3, volume: 0.6 }) },
  // ── Deep / Sub ──
  { name: "Deep Sub", params: bp({ waveform: "square", cutoff: 235, resonance: 3, envMod: 0.08, decay: 420, accent: 0.16, slideTime: 55, distortion: 0.04, volume: 0.82, subOsc: 0.9, filterModel: "ladder", punch: 0.16, harmonics: 0.03, subFilter: 46 }) },
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
  { name: "House Groove", params: bp({ waveform: "square", cutoff: 520, resonance: 9, envMod: 0.34, decay: 165, accent: 0.34, slideTime: 22, distortion: 0.12, volume: 0.72, subOsc: 0.42, filterModel: "ladder", punch: 0.34, harmonics: 0.12, subFilter: 62 }) },
  { name: "Lo-Fi Wobble", params: bp({ waveform: "square", cutoff: 380, resonance: 19, envMod: 0.65, decay: 170, accent: 0.55, slideTime: 80, distortion: 0.3, volume: 0.6, subOsc: 0.45 }) },
  { name: "Trance Gate", params: bp({ cutoff: 800, resonance: 13, envMod: 0.6, decay: 70, accent: 0.7, slideTime: 5, distortion: 0.25, volume: 0.6 }) },
  { name: "Dark Ambient", params: bp({ waveform: "square", cutoff: 250, resonance: 6, envMod: 0.2, decay: 700, accent: 0.2, slideTime: 150, distortion: 0, volume: 0.6, subOsc: 0.8 }) },
  // ── Professional New Presets ──
  { name: "Analog Warmth", params: bp({ waveform: "square", cutoff: 360, resonance: 4, envMod: 0.16, decay: 300, accent: 0.2, slideTime: 48, distortion: 0.09, volume: 0.68, subOsc: 0.78, filterModel: "ladder", punch: 0.22, harmonics: 0.14, subFilter: 64 }) },
  { name: "Tape Bass", params: bp({ waveform: "sawtooth", cutoff: 430, resonance: 7, envMod: 0.22, decay: 210, accent: 0.28, slideTime: 36, distortion: 0.28, volume: 0.63, subOsc: 0.34, filterModel: "ladder", harmonics: 0.22, punch: 0.24, subFilter: 70 }) },
  { name: "Organic Evolve", params: bp({ waveform: "sawtooth", cutoff: 300, resonance: 6, envMod: 0.4, decay: 800, accent: 0.15, slideTime: 120, distortion: 0.08, volume: 0.55, subOsc: 0.7, filterModel: "ladder", punch: 0.05, harmonics: 0.12, subFilter: 55 }) },
  // ── Comprehensive Designer Presets ──
  { name: "Deep Sub XL", params: bp({ waveform: "square", cutoff: 200, resonance: 2, envMod: 0.1, decay: 400, accent: 0.1, slideTime: 0, distortion: 0.08, volume: 0.8, subOsc: 0.9, filterModel: "ladder", punch: 0.1, harmonics: 0, subFilter: 40 }) },
  { name: "Punch Bass", params: bp({ waveform: "sawtooth", cutoff: 250, resonance: 4, envMod: 0.15, decay: 120, accent: 0.5, slideTime: 0, distortion: 0.3, volume: 0.7, subOsc: 0.6, punch: 0.5 }) },
  { name: "Acid Bass", params: bp({ waveform: "sawtooth", cutoff: 400, resonance: 22, envMod: 0.6, decay: 100, accent: 0.3, slideTime: 0, distortion: 0.5, filterModel: "ladder", punch: 0.3 }) },
  { name: "Analog Bass", params: bp({ waveform: "square", cutoff: 200, resonance: 3, envMod: 0.1, decay: 350, accent: 0.15, slideTime: 0, distortion: 0.1, volume: 0.7, subOsc: 0.7, punch: 0.15, harmonics: 0.25 }) },
  { name: "Dirty Bass", params: bp({ waveform: "sawtooth", cutoff: 200, resonance: 4, envMod: 0.1, decay: 200, accent: 0.4, slideTime: 0, distortion: 0.7, volume: 0.65 }) },
  { name: "Moving Bass", params: bp({ waveform: "sawtooth", cutoff: 300, resonance: 4, envMod: 0.4, decay: 600, accent: 0.05, slideTime: 100, distortion: 0, volume: 0.7, subOsc: 0.6, punch: 0.05 }) },
  { name: "FM Bass", params: bp({ waveform: "sawtooth", cutoff: 200, resonance: 8, envMod: 0.15, decay: 150, accent: 0.3, slideTime: 0, distortion: 0.25, volume: 0.7 }) },
  { name: "Reese Bass", params: bp({ waveform: "sawtooth", cutoff: 250, resonance: 4, envMod: 0.15, decay: 300, accent: 0.15, slideTime: 60, distortion: 0, volume: 0.7, subOsc: 0.5, harmonics: 0.3, punch: 0.15 }) },
  { name: "Pluck Bass", params: bp({ waveform: "sawtooth", cutoff: 300, resonance: 3, envMod: 0.2, decay: 80, accent: 0.4, slideTime: 0, distortion: 0, volume: 0.7, punch: 0.4 }) },
  { name: "Sub Growl", params: bp({ waveform: "sawtooth", cutoff: 200, resonance: 5, envMod: 0.2, decay: 150, accent: 0.35, slideTime: 0, distortion: 0.45, volume: 0.7, subOsc: 0.7, punch: 0.35, harmonics: 0.3 }) },
  // ── Deep House Collection ──
  { name: "DH Filtered Sine", params: bp({ waveform: "sawtooth", cutoff: 180, resonance: 2, envMod: 0.05, decay: 500, accent: 0.1, slideTime: 40, distortion: 0, volume: 0.8, subOsc: 0.85, filterModel: "ladder", punch: 0.08, harmonics: 0, subFilter: 42 }) },
  { name: "DH Warm Sub", params: bp({ waveform: "square", cutoff: 220, resonance: 3, envMod: 0.08, decay: 450, accent: 0.12, slideTime: 50, distortion: 0.05, volume: 0.78, subOsc: 0.8, filterModel: "ladder", punch: 0.12, harmonics: 0.05, subFilter: 50 }) },
  { name: "DH Moog Bass", params: bp({ waveform: "sawtooth", cutoff: 320, resonance: 6, envMod: 0.2, decay: 250, accent: 0.25, slideTime: 30, distortion: 0.08, volume: 0.72, subOsc: 0.6, filterModel: "ladder", punch: 0.2, harmonics: 0.1, subFilter: 65 }) },
  { name: "DH Rubber Dub", params: bp({ waveform: "square", cutoff: 280, resonance: 5, envMod: 0.15, decay: 380, accent: 0.2, slideTime: 70, distortion: 0.06, volume: 0.75, subOsc: 0.7, filterModel: "ladder", punch: 0.15, harmonics: 0.08, subFilter: 55 }) },
  { name: "DH Staccato", params: bp({ waveform: "sawtooth", cutoff: 400, resonance: 4, envMod: 0.35, decay: 60, accent: 0.4, slideTime: 0, distortion: 0.1, volume: 0.7, subOsc: 0.5, punch: 0.35, harmonics: 0.1 }) },
  // ── Producer Essentials: Basses that work in every mix ──
  { name: "Pure Sub 40Hz", params: bp({ waveform: "square", cutoff: 160, resonance: 1, envMod: 0.02, decay: 600, accent: 0.05, slideTime: 0, distortion: 0, volume: 0.85, subOsc: 1.0, filterModel: "ladder", punch: 0.05, harmonics: 0, subFilter: 38 }) },
  { name: "Garage Sub", params: bp({ waveform: "square", cutoff: 250, resonance: 4, envMod: 0.12, decay: 350, accent: 0.2, slideTime: 35, distortion: 0.08, volume: 0.75, subOsc: 0.75, filterModel: "ladder", punch: 0.2, harmonics: 0.06, subFilter: 52 }) },
  { name: "Neo Soul Bass", params: bp({ waveform: "sawtooth", cutoff: 350, resonance: 5, envMod: 0.18, decay: 280, accent: 0.22, slideTime: 45, distortion: 0.06, volume: 0.7, subOsc: 0.55, filterModel: "ladder", punch: 0.18, harmonics: 0.12, subFilter: 60 }) },
  { name: "Lo-Fi Tape Sub", params: bp({ waveform: "square", cutoff: 280, resonance: 3, envMod: 0.1, decay: 400, accent: 0.15, slideTime: 60, distortion: 0.15, volume: 0.72, subOsc: 0.65, filterModel: "ladder", punch: 0.1, harmonics: 0.2, subFilter: 55 }) },
  { name: "Afro House Sub", params: bp({ waveform: "square", cutoff: 200, resonance: 2, envMod: 0.06, decay: 500, accent: 0.1, slideTime: 30, distortion: 0.03, volume: 0.8, subOsc: 0.85, punch: 0.12, subFilter: 45 }) },
  { name: "Latin Bass", params: bp({ waveform: "sawtooth", cutoff: 500, resonance: 6, envMod: 0.3, decay: 120, accent: 0.35, slideTime: 20, distortion: 0.12, volume: 0.68, subOsc: 0.4, punch: 0.3, harmonics: 0.08 }) },
  { name: "UK Bass", params: bp({ waveform: "square", cutoff: 350, resonance: 8, envMod: 0.4, decay: 180, accent: 0.45, slideTime: 25, distortion: 0.2, volume: 0.68, subOsc: 0.5, filterModel: "ladder", punch: 0.25 }) },
  { name: "Boomy 808", params: bp({ waveform: "square", cutoff: 180, resonance: 1, envMod: 0.03, decay: 800, accent: 0.08, slideTime: 0, distortion: 0.02, volume: 0.82, subOsc: 0.95, punch: 0.08, subFilter: 35 }) },
  { name: "Synth Pop Bass", params: bp({ waveform: "sawtooth", cutoff: 600, resonance: 7, envMod: 0.35, decay: 150, accent: 0.3, slideTime: 15, distortion: 0.15, volume: 0.65, subOsc: 0.3, punch: 0.25 }) },
  { name: "Smooth Jazz Bass", params: bp({ waveform: "sawtooth", cutoff: 280, resonance: 3, envMod: 0.1, decay: 350, accent: 0.15, slideTime: 80, distortion: 0.04, volume: 0.72, subOsc: 0.6, filterModel: "ladder", punch: 0.1, harmonics: 0.15, subFilter: 58 }) },
  { name: "Retro Disco", params: bp({ waveform: "square", cutoff: 450, resonance: 8, envMod: 0.28, decay: 140, accent: 0.35, slideTime: 10, distortion: 0.1, volume: 0.65, subOsc: 0.35, punch: 0.3 }) },
  { name: "Broken Beat", params: bp({ waveform: "sawtooth", cutoff: 380, resonance: 6, envMod: 0.25, decay: 200, accent: 0.3, slideTime: 35, distortion: 0.08, volume: 0.7, subOsc: 0.5, filterModel: "ladder", punch: 0.2 }) },
  { name: "Ambient Drone", params: bp({ waveform: "sawtooth", cutoff: 200, resonance: 2, envMod: 0.05, decay: 900, accent: 0.05, slideTime: 150, distortion: 0, volume: 0.6, subOsc: 0.8, filterModel: "ladder", punch: 0, harmonics: 0.05, subFilter: 48 }) },
  { name: "Acid Wobble", params: bp({ cutoff: 450, resonance: 18, envMod: 0.75, decay: 180, accent: 0.6, slideTime: 55, distortion: 0.3, volume: 0.62, subOsc: 0.2, filterModel: "ladder", punch: 0.2 }) },
  { name: "Trap 808 Long", params: bp({ waveform: "square", cutoff: 170, resonance: 1, envMod: 0.02, decay: 1000, accent: 0.05, slideTime: 0, distortion: 0.05, volume: 0.8, subOsc: 0.95, punch: 0.06, subFilter: 32 }) },
];

export const BASS_CORE_PRESETS = BASS_PRESETS.filter((preset) =>
  BASS_SIGNATURE_PRESET_NAMES.includes(preset.name as typeof BASS_SIGNATURE_PRESET_NAMES[number])
);

// getBassCorePresetIndex removed — preset nav now cycles through all presets

// ─── Bassline Agent: Genre Strategies ────────────────────

export interface BasslineStrategy {
  name: string;
  generate: (length: number, scaleLen: number) => BassStep[];
}

function makeStep(note: number, opts?: Partial<BassStep>): BassStep {
  return { active: true, note, octave: 0, accent: false, velocity: 0.82, slide: false, tie: false, gateLength: 1, ...opts };
}

function emptyStep(): BassStep {
  return { active: false, note: 0, octave: 0, accent: false, velocity: 0.82, slide: false, tie: false, gateLength: 1 };
}

function prob(p: number): boolean { return Math.random() < p; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }
function pickBassGate(style: "tight" | "groove" | "held" = "groove"): number {
  if (style === "tight") return pick([1, 1, 1, 2, 2, 3]);
  if (style === "held") return pick([2, 3, 4, 4, 6, 8]);
  return pick([1, 1, 2, 2, 3, 4, 4]);
}

export const BASSLINE_STRATEGIES: BasslineStrategy[] = [
  {
    name: "Acid",
    generate: (len, scaleLen) => {
      const steps: BassStep[] = [];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (prob(0.8)) {
          const note = Math.floor(Math.random() * Math.min(scaleLen, 7));
          const gateLength = prob(0.3) ? pick([2, 3, 4]) : 1; // Mix of short and long notes
          steps.push(makeStep(note, {
            accent: i % 4 === 0 ? prob(0.6) : prob(0.2),
            slide: prob(0.45),
            octave: prob(0.2) ? pick([1, -1]) : 0,
            gateLength,
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
      const rootNotes = [0, 0, 0, Math.min(4, scaleLen - 1), Math.min(3, scaleLen - 1)];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        const isAnchor = i % 4 === 0 || i % 8 === 6;
        if ((isAnchor && prob(0.82)) || prob(0.12)) {
          const gateLength = i % 8 === 0 ? pickBassGate("held") : pickBassGate("groove");
          steps.push(makeStep(pick(rootNotes), {
            accent: i % 8 === 0 ? prob(0.5) : prob(0.12),
            slide: prob(0.08),
            tie: gateLength >= 4 && prob(0.35),
            gateLength,
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
        // Driving pattern with held notes on downbeats
        const isDownbeat = i % 4 === 0;
        if (prob(isDownbeat ? 0.85 : 0.55)) {
          const gateLength = isDownbeat ? pick([2, 3, 4]) : pick([1, 1, 2]);
          steps.push(makeStep(0, {
            accent: isDownbeat ? prob(0.5) : prob(0.1),
            slide: false,
            gateLength,
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
        // Syncopated with wide intervals and varied note lengths
        const synco = [0, 3, 6, 7, 10, 11, 14].includes(i % 16);
        if (synco || prob(0.3)) {
          const gateLength = synco ? pick([1, 2, 2, 3]) : pick([1, 1, 2]);
          steps.push(makeStep(Math.floor(Math.random() * Math.min(scaleLen, 8)), {
            accent: prob(0.35),
            slide: prob(0.5),
            octave: prob(0.3) ? pick([1, -1]) : 0,
            gateLength,
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
          const gateLength = i % 8 === 0 ? pick([4, 6, 8]) : pick([2, 3, 4]); // Long held notes
          steps.push(makeStep(pick(notes), {
            accent: prob(0.2),
            slide: false,
            gateLength,
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
    name: "Hip-Hop",
    generate: (len, scaleLen) => {
      const steps: BassStep[] = [];
      const roots = [0, 0, 0, Math.min(2, scaleLen - 1), Math.min(4, scaleLen - 1)];
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        const beat = i % 4 === 0;
        const and = i % 4 === 2;
        if ((beat && prob(0.85)) || (and && prob(0.35)) || prob(0.08)) {
          const gateLength = beat ? pick([2, 3, 4, 4, 6]) : pick([1, 1, 2]);
          steps.push(makeStep(pick(roots), {
            accent: beat ? prob(0.5) : prob(0.1),
            slide: prob(0.1),
            gateLength,
            octave: prob(0.2) ? -1 : 0,
          }));
        } else { steps.push(emptyStep()); }
      }
      return steps;
    },
  },
  {
    name: "Minimal",
    generate: (len) => {
      const steps: BassStep[] = [];
      // Minimal: root note, long held, sparse
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        if (i % 8 === 0 && prob(0.9)) {
          const gateLength = pick([4, 6, 8, 8, 12]);
          steps.push(makeStep(0, {
            accent: i % 16 === 0 ? prob(0.5) : false,
            gateLength,
          }));
        } else if (i % 8 === 6 && prob(0.3)) {
          steps.push(makeStep(0, { gateLength: pick([1, 2]) }));
        } else { steps.push(emptyStep()); }
      }
      return steps;
    },
  },
  {
    name: "Reggaeton",
    generate: (len, scaleLen) => {
      const steps: BassStep[] = [];
      const notes = [0, 0, Math.min(3, scaleLen - 1), Math.min(4, scaleLen - 1)];
      // Dembow-inspired: strong off-beat pattern
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        const pos = i % 8;
        const hit = [0, 3, 4, 6].includes(pos);
        if (hit && prob(0.82)) {
          const gateLength = pos === 0 ? pick([2, 3, 4]) : pick([1, 2]);
          steps.push(makeStep(pick(notes), {
            accent: pos === 0 || pos === 4,
            slide: pos === 3 && prob(0.4),
            gateLength,
            octave: prob(0.12) ? -1 : 0,
          }));
        } else { steps.push(emptyStep()); }
      }
      return steps;
    },
  },
  {
    name: "Random",
    generate: (len, scaleLen) => {
      const steps: BassStep[] = [];
      let note = pick([0, 0, 0, 2, Math.min(4, scaleLen - 1)]);
      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }
        const isPhraseEdge = i % 4 === 0;
        if ((isPhraseEdge && prob(0.78)) || prob(0.26)) {
          note = Math.max(0, Math.min(Math.min(scaleLen, 7) - 1, note + pick([-2, -1, 0, 1, 1, 2])));
          const gateLength = isPhraseEdge ? pickBassGate("groove") : pickBassGate("tight");
          steps.push(makeStep(note, {
            octave: prob(0.18) ? pick([1, -1]) : 0,
            accent: isPhraseEdge ? prob(0.45) : prob(0.12),
            slide: !isPhraseEdge && prob(0.22),
            tie: gateLength >= 3 && prob(0.25),
            gateLength,
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
  globalOctave: number;  // -2 to +2, shifts all notes by octaves
  params: BassParams;
  presetIndex: number;
  strategyIndex: number;
  isPlaying: boolean;
  automationData: Record<string, Array<number | undefined>>;
  automationParam: string;
  instrument: string;
  /** Live semitone transpose applied on top of every scheduled note
   *  (used by XY Pad chord-follow — set on chord down, reset on chord up). */
  liveTransposeOffset: number;
  setLiveTransposeOffset: (semis: number) => void;

  toggleStep: (step: number) => void;
  setStepNote: (step: number, note: number) => void;
  setStepOctave: (step: number, octave: number) => void;
  setStepVelocity: (step: number, velocity: number) => void;
  toggleAccent: (step: number) => void;
  toggleSlide: (step: number) => void;
  toggleTie: (step: number) => void;
  setGateLength: (fromStep: number, toStep: number) => void;
  cycleOctave: (step: number) => void;
  setRootNote: (midi: number, name: string) => void;
  setGlobalOctave: (oct: number) => void;
  setScale: (name: string) => void;
  setParam: (key: keyof BassParams, value: number | string | boolean) => void;
  setLength: (len: number) => void;
  setSelectedPage: (page: number) => void;
  clearSteps: () => void;
  randomize: () => void;
  generateBassline: (strategyIndex: number) => void;
  nextStrategy: () => void;
  prevStrategy: () => void;
  applyEuclidean: (pulses: number, eucSteps: number, rotation: number, noteMode: string, accentPulses?: number, accentRotation?: number) => void;
  loadPreset: (index: number) => void;
  nextPreset: () => void;
  prevPreset: () => void;
  setInstrument: (id: string) => Promise<void>;
  // For save/load
  setAutomationValue: (param: string, step: number, value: number | undefined) => void;
  setAutomationParam: (param: string) => void;
  clearAutomation: (param: string) => void;
  loadBassPattern: (data: { steps: BassStep[]; length: number; params: BassParams; rootNote: number; rootName: string; scaleName: string }) => void;
}

function createEmptySteps(): BassStep[] {
  return Array.from({ length: BASS_MAX_CLIP_STEPS }, () => ({
    active: false, note: 0, octave: 0, accent: false, velocity: 0.82, slide: false, tie: false, gateLength: 1,
  }));
}

// ─── Bass Scheduler ──────────────────────────────────────

let bassTimer: ReturnType<typeof setInterval> | null = null;
let nextBassStepTime = 0;

export function startBassScheduler() {
  nextBassStepTime = audioEngine.currentTime + 0.05;
  if (bassTimer !== null) clearInterval(bassTimer);

  bassTimer = setInterval(() => {
    const drumState = useDrumStore.getState();
    if (!drumState.isPlaying) return;

    const bpm = drumState.bpm;
    const secondsPerStep = 60.0 / bpm / 4;

    const getLegacyTieLength = (steps: BassStep[], startIndex: number, sequenceLength: number) => {
      let span = 1;
      for (let i = 1; i < sequenceLength; i++) {
        const nextIdx = (startIndex + i) % sequenceLength;
        const next = steps[nextIdx];
        if (!next?.active || !next.tie) break;
        span += 1;
        if (nextIdx === startIndex) break;
      }
      return span;
    };

    while (nextBassStepTime < audioEngine.currentTime + 0.1) {
      const { steps, currentStep, length, rootNote, scaleName, automationData, globalOctave } = useBassStore.getState();
      const step = steps[currentStep % length];
      const stepIndex = currentStep % length;
      const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : steps[length - 1];

      // Apply per-step automation
      for (const [param, vals] of Object.entries(automationData)) {
        const val = vals[currentStep % length];
        if (val !== undefined) bassEngine.setParams({ [param]: val });
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
        const { instrument, liveTransposeOffset } = useBassStore.getState();
        const midiNote = scaleNote(rootNote, scaleName, step.note, step.octave + globalOctave) + (liveTransposeOffset ?? 0);
        const explicitGateLength = Math.max(1, step.gateLength ?? 1);
        let sustainSteps = explicitGateLength;

        // Backward compatibility for saved patterns that still store continuation ties.
        if (explicitGateLength === 1) {
          sustainSteps = getLegacyTieLength(steps, stepIndex, length);
        }
        const sustainDuration = secondsPerStep * sustainSteps;

        // Use soundfont if a non-synth instrument is selected
        if (instrument !== "_synth_") {
          const velocity = Math.max(0.2, Math.min(1, step.velocity ?? (step.accent ? 1.0 : 0.7)));
          const duration = Math.max(secondsPerStep * 1.2, sustainDuration * 0.98);
          soundFontEngine.playNote("bass", midiNote, nextBassStepTime, velocity, duration);
        } else {
          // Use built-in synth
          bassEngine.triggerNote(midiNote, nextBassStepTime, step.accent, step.slide, false, step.velocity ?? (step.accent ? 1.0 : 0.7));
          bassEngine.releaseNote(nextBassStepTime + Math.max(secondsPerStep * 0.92, sustainDuration * 0.98));
        }
      } else if (!step?.active && !isHeldByPreviousGate) {
        // Only rest if this sequencer actually had a note playing
        // (don't kill notes from Piano Roll)
        if (steps.some(s => s.active)) {
          bassEngine.rest(nextBassStepTime);
        }
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
  globalOctave: 0,
  liveTransposeOffset: 0,
  setLiveTransposeOffset: (semis) => set({ liveTransposeOffset: semis }),
  params: { ...DEFAULT_BASS_PARAMS },
  presetIndex: 0,
  strategyIndex: 0,
  isPlaying: false,
  instrument: "_synth_",

  toggleStep: (step) => set((s) => {
    const newSteps = [...s.steps];
    newSteps[step] = { ...newSteps[step]!, active: !newSteps[step]!.active };
    const newLen = step >= s.length ? Math.min(BASS_MAX_CLIP_STEPS, step + 1) : s.length;
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

  toggleAccent: (step) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, accent: !newSteps[step]!.accent }; return { steps: newSteps };
  }),

  toggleSlide: (step) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, slide: !newSteps[step]!.slide }; return { steps: newSteps };
  }),

  toggleTie: (step) => set((s) => {
    const newSteps = [...s.steps]; newSteps[step] = { ...newSteps[step]!, tie: !newSteps[step]!.tie }; return { steps: newSteps };
  }),

  setGateLength: (fromStep, toStep) => set((s) => {
    const newSteps = [...s.steps];
    const sourceStep = newSteps[fromStep]!;
    if (!sourceStep.active) return { steps: newSteps };

    const gateLength = Math.max(1, Math.min(BASS_MAX_CLIP_STEPS - fromStep, toStep - fromStep + 1));
    newSteps[fromStep] = { ...sourceStep, gateLength, tie: false }; // Clear tie on source — using explicit length now

    // Clear legacy continuation ties directly after the source note so drag length
    // behaves like a real note value instead of leaving old tie placeholders behind.
    for (let i = fromStep + 1; i < BASS_MAX_CLIP_STEPS; i++) {
      if (newSteps[i]?.tie && newSteps[i]?.active) {
        newSteps[i] = { active: false, note: 0, octave: 0, accent: false, velocity: 0.82, slide: false, tie: false, gateLength: 1 };
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
    syncScaleToOtherStores("bass", { rootNote: midi, rootName: name });
  },
  setGlobalOctave: (oct) => set({ globalOctave: Math.max(-2, Math.min(2, oct)) }),
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
      if (!data[key]) data[key] = new Array(BASS_MAX_CLIP_STEPS).fill(undefined);
      const arr = [...data[key]!];
      arr[currentStep % length] = value;
      data[key] = arr;
      set({ automationData: data });
    }
  },

  setLength: (len) => set({ length: Math.max(4, Math.min(BASS_MAX_CLIP_STEPS, len)) }),
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

  applyEuclidean: (pulses, eucSteps, rotation, noteMode, accentPulses = 0, accentRotation = 0) => {
    const { length, scaleName } = get();
    const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
    const rhythm = generateEuclidean(pulses, eucSteps, rotation);
    // Optional accent overlay: second Euclidean pattern that marks steps as accented
    const accent = accentPulses > 0
      ? generateEuclidean(accentPulses, eucSteps, accentRotation)
      : null;
    const newSteps = createEmptySteps();
    const scaleLen = Math.min(scale.length, 7);
    let walkCursor = 0;

    for (let i = 0; i < length; i++) {
      const hit = rhythm[i % rhythm.length];
      if (hit) {
        let note = 0;
        if (noteMode === "ascending") note = i % scaleLen;
        else if (noteMode === "random") note = Math.floor(Math.random() * scaleLen);
        else if (noteMode === "walk") {
          // Random-walk ±1 step — smooth melodic motion
          const dir = Math.random() < 0.5 ? -1 : 1;
          walkCursor = Math.max(0, Math.min(scaleLen - 1, walkCursor + dir));
          note = walkCursor;
        } else if (noteMode === "alternate") {
          // Root / 5th toggle
          note = (i % 2 === 0) ? 0 : Math.min(4, scaleLen - 1);
        } else if (noteMode === "pentatonic") {
          // Cycle through pentatonic degrees (0, 2, 4 out of a 7-note scale)
          const pent = [0, 2, 4, 2].filter((d) => d < scaleLen);
          note = pent[i % pent.length] ?? 0;
        }
        // "root" → note stays 0
        const isAccent = accent ? (accent[i % accent.length] ?? false) : (i % 4 === 0);
        newSteps[i] = {
          active: true, note, octave: 0,
          accent: isAccent,
          velocity: isAccent ? 0.96 : 0.74,
          slide: false, tie: false, gateLength: 1,
        };
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

  nextPreset: () => {
    const next = (get().presetIndex + 1) % BASS_PRESETS.length;
    get().loadPreset(next);
  },
  prevPreset: () => {
    const prev = (get().presetIndex - 1 + BASS_PRESETS.length) % BASS_PRESETS.length;
    get().loadPreset(prev);
  },

  setInstrument: async (id: string) => {
    if (id === "_synth_") {
      soundFontEngine.stopAll("bass");
      set({ instrument: id });
      return;
    }

    set({ instrument: id });
    const ctx = audioEngine.getAudioContext();
    if (ctx) {
      const destination = audioEngine.getChannelOutput(12); // Bass = channel 12
      try {
        const ok = await soundFontEngine.loadInstrument("bass", id, destination);
        if (!ok) {
          set({ instrument: "_synth_" });
        }
      } catch (err) {
        console.warn("Failed to load bass instrument:", err);
        set({ instrument: "_synth_" });
      }
    }
  },

  setAutomationValue: (param, step, value) => set((s) => {
    const data = { ...s.automationData };
    if (!data[param]) data[param] = new Array(BASS_MAX_CLIP_STEPS).fill(undefined);
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
