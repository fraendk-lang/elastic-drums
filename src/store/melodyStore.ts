/**
 * Melody Sequencer Store
 *
 * 64-step melody sequencer (4 pages of 16) with note, octave, accent, slide, tie.
 * Includes factory presets, melody generation strategies, and Euclidean rhythms.
 */

import { create } from "zustand";
import { melodyEngine, type MelodyStep, type MelodyParams, DEFAULT_MELODY_PARAMS } from "../audio/MelodyEngine";
import { scaleNote, SCALES } from "../audio/BassEngine";
import { audioEngine } from "../audio/AudioEngine";
import { soundFontEngine } from "../audio/SoundFontEngine";
import { generateEuclidean } from "./drumStore";
import { syncScaleToOtherStores, registerScaleStore } from "./bassStore";

export const MELODY_MAX_CLIP_STEPS = 256;

// ─── Factory Sound Presets ───────────────────────────────

export interface MelodyPreset {
  name: string;
  params: MelodyParams;
}

export const MELODY_SIGNATURE_PRESET_NAMES = [
  "FM Bell",
  "Crystal Bell",
  "Vinyl Keys",
  "Muted",
  "Tape Wobble",
] as const;

const mp = (p: Partial<MelodyParams>): MelodyParams => ({ ...DEFAULT_MELODY_PARAMS, ...p });

// Factory helper to ensure synthType and filterModel are set (for backward compatibility)
function ensureSynthParams(p: MelodyParams): MelodyParams {
  return { ...p, synthType: p.synthType || "subtractive", filterModel: p.filterModel || "lpf" };
}

export const MELODY_PRESETS: MelodyPreset[] = [
  // ── Professional Leads ──
  { name: "Classic Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "ladder", cutoff: 2000, resonance: 8, envMod: 0.4, decay: 150, accent: 0.4, slideTime: 40, legato: false, distortion: 0.15, volume: 0.5, subOsc: 0.1, pulseWidth: 0.5, unison: 0.3, vibratoRate: 4, vibratoDepth: 0.1, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "PWM String", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "ladder", cutoff: 1200, resonance: 6, envMod: 0.3, decay: 180, accent: 0.3, slideTime: 80, legato: true, distortion: 0.1, volume: 0.48, subOsc: 0.2, pulseWidth: 0.3, unison: 0.2, vibratoRate: 5, vibratoDepth: 0.25, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "FM Bell", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 2600, resonance: 3, envMod: 0.12, decay: 95, accent: 0.32, slideTime: 0, legato: false, distortion: 0.02, volume: 0.42, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 3, vibratoDepth: 0, fmHarmonicity: 3.2, fmModIndex: 9 }) },
  { name: "Pluck Guitar", params: mp({ synthType: "pluck", waveform: "triangle", filterModel: "lpf", cutoff: 2500, resonance: 5, envMod: 0.15, decay: 80, accent: 0.4, slideTime: 0, legato: false, distortion: 0, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Acid Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "steiner-lp", cutoff: 800, resonance: 20, envMod: 0.8, decay: 100, accent: 0.7, slideTime: 50, legato: false, distortion: 0.4, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0.2, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Trance Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "steiner-lp", cutoff: 1600, resonance: 12, envMod: 0.5, decay: 110, accent: 0.6, slideTime: 20, legato: false, distortion: 0.2, volume: 0.52, subOsc: 0.1, pulseWidth: 0.5, unison: 0.6, vibratoRate: 4, vibratoDepth: 0.08, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Ambient Lead", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 1000, resonance: 3, envMod: 0.15, decay: 300, accent: 0.15, slideTime: 120, legato: true, distortion: 0, volume: 0.42, subOsc: 0.25, pulseWidth: 0.5, unison: 0.1, vibratoRate: 3, vibratoDepth: 0.2, fmHarmonicity: 3, fmModIndex: 10 }) },
  // ── Classic / Existing ──
  { name: "Screamer", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "ladder", cutoff: 600, resonance: 25, envMod: 0.9, decay: 80, accent: 0.8, slideTime: 30, legato: false, distortion: 0.6, volume: 0.45, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Bright Pluck", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "lpf", cutoff: 3000, resonance: 10, envMod: 0.6, decay: 60, accent: 0.5, slideTime: 0, legato: false, distortion: 0.1, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Crystal Pluck", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 4000, resonance: 6, envMod: 0.4, decay: 45, accent: 0.3, slideTime: 0, legato: false, distortion: 0, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Sharp Key", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "ladder", cutoff: 2500, resonance: 14, envMod: 0.7, decay: 40, accent: 0.6, slideTime: 0, legato: false, distortion: 0.2, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0.15, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Bell Tone", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 3500, resonance: 12, envMod: 0.5, decay: 70, accent: 0.4, slideTime: 0, legato: false, distortion: 0, volume: 0.45, subOsc: 0.15, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Smooth", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 2500, resonance: 2, envMod: 0.1, decay: 300, accent: 0.15, slideTime: 100, legato: true, distortion: 0, volume: 0.45, subOsc: 0.3, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Warm Pad Lead", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 1500, resonance: 3, envMod: 0.15, decay: 400, accent: 0.2, slideTime: 80, legato: true, distortion: 0, volume: 0.45, subOsc: 0.4, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Flute", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 2000, resonance: 5, envMod: 0.2, decay: 350, accent: 0.25, slideTime: 60, legato: true, distortion: 0, volume: 0.45, subOsc: 0.1, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0.15, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Soft Portamento", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 1200, resonance: 4, envMod: 0.15, decay: 250, accent: 0.2, slideTime: 120, legato: true, distortion: 0.05, volume: 0.45, subOsc: 0.3, pulseWidth: 0.5, unison: 0.1, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Retro Arp", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "lpf", cutoff: 1800, resonance: 6, envMod: 0.5, decay: 120, accent: 0.3, slideTime: 20, legato: false, distortion: 0.2, volume: 0.5, subOsc: 0.2, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Trance Arp", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "ladder", cutoff: 1400, resonance: 10, envMod: 0.55, decay: 90, accent: 0.45, slideTime: 10, legato: false, distortion: 0.15, volume: 0.5, subOsc: 0.15, pulseWidth: 0.5, unison: 0.3, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Chip Arp", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "lpf", cutoff: 5000, resonance: 2, envMod: 0.3, decay: 50, accent: 0.3, slideTime: 0, legato: false, distortion: 0.1, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Distorted Saw", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "ladder", cutoff: 1000, resonance: 8, envMod: 0.45, decay: 130, accent: 0.65, slideTime: 15, legato: false, distortion: 0.7, volume: 0.45, subOsc: 0, pulseWidth: 0.5, unison: 0.2, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Gritty Square", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "steiner-lp", cutoff: 700, resonance: 16, envMod: 0.6, decay: 100, accent: 0.7, slideTime: 25, legato: false, distortion: 0.5, volume: 0.5, subOsc: 0.1, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Noise Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "steiner-lp", cutoff: 500, resonance: 22, envMod: 0.85, decay: 70, accent: 0.85, slideTime: 35, legato: false, distortion: 0.8, volume: 0.4, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Muted", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "lpf", cutoff: 400, resonance: 4, envMod: 0.2, decay: 200, accent: 0.3, slideTime: 60, legato: false, distortion: 0.05, volume: 0.5, subOsc: 0.5, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Vinyl Keys", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 600, resonance: 6, envMod: 0.25, decay: 180, accent: 0.3, slideTime: 40, legato: false, distortion: 0.15, volume: 0.45, subOsc: 0.35, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Tape Wobble", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 550, resonance: 7, envMod: 0.3, decay: 220, accent: 0.35, slideTime: 70, legato: true, distortion: 0.2, volume: 0.45, subOsc: 0.4, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Atmosphere", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 800, resonance: 3, envMod: 0.08, decay: 500, accent: 0.1, slideTime: 150, legato: true, distortion: 0, volume: 0.4, subOsc: 0.6, pulseWidth: 0.5, unison: 0, vibratoRate: 3, vibratoDepth: 0.15, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Space Echo", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 1000, resonance: 5, envMod: 0.12, decay: 400, accent: 0.2, slideTime: 90, legato: true, distortion: 0.05, volume: 0.4, subOsc: 0.25, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0.1, fmHarmonicity: 3, fmModIndex: 10 }) },
  // ── Professional New Presets ──
  { name: "Vintage Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "ladder", cutoff: 800, resonance: 18, envMod: 0.5, decay: 120, accent: 0.5, slideTime: 30, legato: false, distortion: 0.2, volume: 0.5, subOsc: 0.1, pulseWidth: 0.5, unison: 0.15, vibratoRate: 5, vibratoDepth: 0.15, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Crystal Bell", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 3000, resonance: 2, envMod: 0.08, decay: 82, accent: 0.22, slideTime: 0, legato: false, distortion: 0, volume: 0.44, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 3, vibratoDepth: 0.03, fmHarmonicity: 4.2, fmModIndex: 11 }) },
  // ── Comprehensive Designer Presets ──
  { name: "Analog Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 5000, resonance: 4, envMod: 0.2, decay: 150, accent: 0.3, slideTime: 0, legato: false, distortion: 0, volume: 0.55, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Mono Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 4000, resonance: 3, envMod: 0.2, decay: 100, accent: 0.3, slideTime: 0, legato: false, distortion: 0.3, volume: 0.55, subOsc: 0.3, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Soft Lead", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 3000, resonance: 2, envMod: 0.1, decay: 250, accent: 0.2, slideTime: 0, legato: false, distortion: 0, volume: 0.55, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0.15, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Bright Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 8000, resonance: 2, envMod: 0.15, decay: 100, accent: 0.3, slideTime: 0, legato: false, distortion: 0, volume: 0.6, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Pluck Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 4000, resonance: 3, envMod: 0.15, decay: 80, accent: 0.3, slideTime: 0, legato: false, distortion: 0, volume: 0.55, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "FM Lead", params: mp({ synthType: "fm", waveform: "sawtooth", filterModel: "lpf", cutoff: 6000, resonance: 3, envMod: 0.15, decay: 100, accent: 0.3, slideTime: 0, legato: false, distortion: 0, volume: 0.55, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 5, fmModIndex: 12 }) },
  { name: "Glide Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 5000, resonance: 3, envMod: 0.15, decay: 100, accent: 0.3, slideTime: 100, legato: true, distortion: 0, volume: 0.55, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Acid Lead Sharp", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "steiner-lp", cutoff: 3000, resonance: 22, envMod: 0.35, decay: 120, accent: 0.4, slideTime: 0, legato: false, distortion: 0.5, volume: 0.55, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Dream Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 4000, resonance: 3, envMod: 0.2, decay: 250, accent: 0.2, slideTime: 0, legato: false, distortion: 0, volume: 0.55, subOsc: 0, pulseWidth: 0.5, unison: 0.5, vibratoRate: 4, vibratoDepth: 0.1, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Vintage Lead 2", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "lpf", cutoff: 3000, resonance: 2, envMod: 0.12, decay: 100, accent: 0.3, slideTime: 0, legato: false, distortion: 0, volume: 0.55, subOsc: 0, pulseWidth: 0.3, unison: 0.3, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  // ── Deep House Collection ──
  { name: "DH Soft Pluck", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 2800, resonance: 4, envMod: 0.5, decay: 40, accent: 0.3, slideTime: 0, legato: false, distortion: 0, volume: 0.55, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "DH Crystal Key", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 3500, resonance: 2, envMod: 0.1, decay: 50, accent: 0.25, slideTime: 0, legato: false, distortion: 0, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 3, vibratoDepth: 0, fmHarmonicity: 5, fmModIndex: 6 }) },
  { name: "DH Warm Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "ladder", cutoff: 1800, resonance: 4, envMod: 0.2, decay: 200, accent: 0.2, slideTime: 30, legato: true, distortion: 0.05, volume: 0.55, subOsc: 0.15, pulseWidth: 0.5, unison: 0.3, vibratoRate: 4.5, vibratoDepth: 0.08, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "DH Staccato Pluck", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 3200, resonance: 5, envMod: 0.65, decay: 30, accent: 0.45, slideTime: 0, legato: false, distortion: 0.05, volume: 0.55, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "DH Kalimba", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 4000, resonance: 2, envMod: 0.08, decay: 60, accent: 0.2, slideTime: 0, legato: false, distortion: 0, volume: 0.48, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 3, vibratoDepth: 0, fmHarmonicity: 7, fmModIndex: 4 }) },
  { name: "DH Airy Lead", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 4500, resonance: 1, envMod: 0.1, decay: 300, accent: 0.15, slideTime: 20, legato: true, distortion: 0, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0.4, vibratoRate: 5, vibratoDepth: 0.12, fmHarmonicity: 3, fmModIndex: 10 }) },
  // ── Producer Essentials: Melody sounds for every genre ──
  { name: "Marimba FM", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 4000, resonance: 1, envMod: 0.05, decay: 50, accent: 0.2, slideTime: 0, legato: false, distortion: 0, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 3, vibratoDepth: 0, fmHarmonicity: 4, fmModIndex: 3 }) },
  { name: "Vibes FM", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 3500, resonance: 2, envMod: 0.08, decay: 120, accent: 0.15, slideTime: 0, legato: false, distortion: 0, volume: 0.48, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4.5, vibratoDepth: 0.06, fmHarmonicity: 6, fmModIndex: 5 }) },
  { name: "Glass Bell", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 5000, resonance: 1, envMod: 0.05, decay: 80, accent: 0.2, slideTime: 0, legato: false, distortion: 0, volume: 0.45, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 3, vibratoDepth: 0, fmHarmonicity: 7.5, fmModIndex: 8 }) },
  { name: "Electric Piano", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 3000, resonance: 2, envMod: 0.1, decay: 150, accent: 0.15, slideTime: 0, legato: false, distortion: 0.04, volume: 0.52, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 3.5, vibratoDepth: 0.02, fmHarmonicity: 1, fmModIndex: 4 }) },
  { name: "Garage Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 2500, resonance: 5, envMod: 0.35, decay: 80, accent: 0.35, slideTime: 15, legato: false, distortion: 0.08, volume: 0.55, subOsc: 0.1, pulseWidth: 0.5, unison: 0.2, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Neon Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "ladder", cutoff: 3000, resonance: 6, envMod: 0.3, decay: 120, accent: 0.3, slideTime: 25, legato: true, distortion: 0.1, volume: 0.55, subOsc: 0.15, pulseWidth: 0.5, unison: 0.4, vibratoRate: 5, vibratoDepth: 0.08, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Retro Pluck", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "lpf", cutoff: 2800, resonance: 6, envMod: 0.55, decay: 35, accent: 0.4, slideTime: 0, legato: false, distortion: 0.06, volume: 0.55, subOsc: 0, pulseWidth: 0.4, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Ambient Key", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 2500, resonance: 1, envMod: 0.08, decay: 200, accent: 0.1, slideTime: 0, legato: false, distortion: 0, volume: 0.45, subOsc: 0, pulseWidth: 0.5, unison: 0.3, vibratoRate: 3, vibratoDepth: 0.04, fmHarmonicity: 3, fmModIndex: 2 }) },
  { name: "Steel Drum", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 4500, resonance: 2, envMod: 0.1, decay: 60, accent: 0.3, slideTime: 0, legato: false, distortion: 0, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 2.5, fmModIndex: 12 }) },
  { name: "Flute Synth", params: mp({ synthType: "subtractive", waveform: "triangle", filterModel: "lpf", cutoff: 3500, resonance: 2, envMod: 0.08, decay: 250, accent: 0.1, slideTime: 30, legato: true, distortion: 0, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 5.5, vibratoDepth: 0.15, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Disco Lead", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "lpf", cutoff: 2200, resonance: 4, envMod: 0.2, decay: 100, accent: 0.3, slideTime: 10, legato: false, distortion: 0.08, volume: 0.55, subOsc: 0.1, pulseWidth: 0.35, unison: 0.25, vibratoRate: 4, vibratoDepth: 0.05, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Chiptune", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "lpf", cutoff: 5000, resonance: 1, envMod: 0, decay: 50, accent: 0.2, slideTime: 5, legato: false, distortion: 0, volume: 0.45, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Tape Melody", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 2000, resonance: 3, envMod: 0.15, decay: 180, accent: 0.2, slideTime: 20, legato: false, distortion: 0.15, volume: 0.52, subOsc: 0, pulseWidth: 0.5, unison: 0.2, vibratoRate: 4, vibratoDepth: 0.04, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Vocal Synth", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 1200, resonance: 8, envMod: 0.3, decay: 300, accent: 0.15, slideTime: 40, legato: true, distortion: 0, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0.3, vibratoRate: 5, vibratoDepth: 0.1, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Brass Stab", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 1800, resonance: 4, envMod: 0.4, decay: 70, accent: 0.5, slideTime: 0, legato: false, distortion: 0.1, volume: 0.58, subOsc: 0.15, pulseWidth: 0.5, unison: 0.3, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Koto Pluck", params: mp({ synthType: "pluck", waveform: "triangle", filterModel: "lpf", cutoff: 3000, resonance: 3, envMod: 0.1, decay: 70, accent: 0.3, slideTime: 0, legato: false, distortion: 0, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Harp Pluck", params: mp({ synthType: "pluck", waveform: "triangle", filterModel: "lpf", cutoff: 4500, resonance: 2, envMod: 0.05, decay: 100, accent: 0.2, slideTime: 0, legato: false, distortion: 0, volume: 0.5, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 3, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Chill Pad Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "ladder", cutoff: 1500, resonance: 3, envMod: 0.08, decay: 400, accent: 0.1, slideTime: 50, legato: true, distortion: 0, volume: 0.48, subOsc: 0.1, pulseWidth: 0.5, unison: 0.5, vibratoRate: 3.5, vibratoDepth: 0.1, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Acid Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "ladder", cutoff: 600, resonance: 8, envMod: 0.7, decay: 100, accent: 0.6, slideTime: 30, legato: false, distortion: 0.2, volume: 0.55, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "Trance Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "lpf", cutoff: 3500, resonance: 4, envMod: 0.2, decay: 150, accent: 0.25, slideTime: 15, legato: true, distortion: 0.05, volume: 0.55, subOsc: 0.15, pulseWidth: 0.5, unison: 0.5, vibratoRate: 4, vibratoDepth: 0.06, fmHarmonicity: 3, fmModIndex: 10 }) },
];

export const MELODY_CORE_PRESETS = MELODY_PRESETS.filter((preset) =>
  MELODY_SIGNATURE_PRESET_NAMES.includes(preset.name as typeof MELODY_SIGNATURE_PRESET_NAMES[number])
);

// getMelodyCorePresetIndex removed — preset nav now cycles through all presets

// ─── Melody Generation Strategies ────────────────────────

export interface MelodyStrategy {
  name: string;
  generate: (length: number, scaleLen: number) => MelodyStep[];
}

function makeStep(note: number, opts?: Partial<MelodyStep>): MelodyStep {
  return { active: true, note, octave: 0, accent: false, velocity: 0.82, slide: false, tie: false, gateLength: 1, ...opts };
}

function emptyStep(): MelodyStep {
  return { active: false, note: 0, octave: 0, accent: false, velocity: 0.82, slide: false, tie: false, gateLength: 1 };
}

function prob(p: number): boolean { return Math.random() < p; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }
function pickMelodyGate(style: "short" | "phrase" = "phrase"): number {
  return style === "short" ? pick([1, 1, 1, 2, 2]) : pick([1, 2, 2, 3, 4]);
}

export const MELODY_STRATEGIES: MelodyStrategy[] = [
  {
    name: "Arp Up",
    generate: (len, scaleLen) => {
      // Ascending with phrase breathing — climb, breathe, resolve
      const steps: MelodyStep[] = [];
      const maxDeg = Math.min(scaleLen - 1, 7);
      let note = 0;
      let phraseCount = 0;
      const phraseSize = 4 + Math.floor(Math.random() * 3); // 4-6 notes per phrase
      let restCountdown = 0;
      let lastActiveIdx = -1;

      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }

        // Insert breathing rests between phrases
        if (restCountdown > 0) {
          steps.push(emptyStep());
          restCountdown--;
          continue;
        }

        // Start breathing after a full phrase
        if (phraseCount >= phraseSize) {
          restCountdown = 1 + (prob(0.4) ? 1 : 0); // 1-2 rest steps
          phraseCount = 0;
          steps.push(emptyStep());
          restCountdown--;
          continue;
        }

        const prevNote = note;
        steps.push(makeStep(note, {
          accent: (i % 4 === 0) && prob(0.6),
          slide: (note === prevNote + 1 || note > 0) && prob(0.4),
          octave: note > maxDeg ? 1 : 0,
        }));
        lastActiveIdx = i;
        phraseCount++;

        // Ascend through scale degrees
        note++;
        if (note > maxDeg) note = 0;
      }

      // Resolve: last active step to degree 0
      if (lastActiveIdx >= 0 && lastActiveIdx < len) {
        steps[lastActiveIdx] = makeStep(0, {
          accent: steps[lastActiveIdx]!.accent,
          slide: false,
        });
      }
      return steps;
    },
  },
  {
    name: "Arp Down",
    generate: (len, scaleLen) => {
      // Descending with tension leaps — fall, leap up for tension, resolve
      const steps: MelodyStep[] = [];
      const maxDeg = Math.min(scaleLen - 1, 7);
      let note = maxDeg;
      let stepsSinceLeap = 0;
      const leapInterval = 6 + Math.floor(Math.random() * 3); // 6-8 steps between leaps
      let lastActiveIdx = -1;

      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }

        if (prob(0.1)) {
          steps.push(emptyStep());
          continue;
        }

        // Tension leap: jump UP by 3 degrees
        if (stepsSinceLeap >= leapInterval) {
          const leapNote = Math.min(note + 3, maxDeg);
          steps.push(makeStep(leapNote, {
            accent: true,
            slide: false,
            octave: prob(0.2) ? 1 : 0,
          }));
          note = leapNote;
          stepsSinceLeap = 0;
          lastActiveIdx = i;
          continue;
        }

        steps.push(makeStep(note, {
          accent: i % 4 === 0,
          slide: prob(0.35), // slide on descending motion
          octave: note >= maxDeg && prob(0.15) ? 1 : (note <= 1 && prob(0.1) ? -1 : 0),
        }));
        lastActiveIdx = i;
        stepsSinceLeap++;

        // Descend
        note--;
        if (note < 0) note = maxDeg;
      }

      // Resolve to root
      if (lastActiveIdx >= 0 && lastActiveIdx < len) {
        steps[lastActiveIdx] = makeStep(0, {
          accent: steps[lastActiveIdx]!.accent,
          slide: false,
        });
      }
      return steps;
    },
  },
  {
    name: "Melodic",
    generate: (len, scaleLen) => {
      // Call-and-response in 4-step phrases
      const steps: MelodyStep[] = [];
      const maxDeg = Math.min(scaleLen - 1, 7);
      let note = 0;
      let lastActiveIdx = -1;

      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }

        const phraseIdx = Math.floor(i / 4); // which 4-step phrase
        const posInPhrase = i % 4;
        const isCall = phraseIdx % 2 === 0; // odd phrases = call, even = response
        const isPhraseStart = posInPhrase === 0;

        // 65% density
        if (!prob(0.65)) {
          steps.push(emptyStep());
          continue;
        }

        if (isCall) {
          // Call: ascending motion with small intervals
          const interval = pick([1, 1, 2, 1, -1, 2]);
          note = Math.max(0, Math.min(maxDeg, note + interval));
        } else {
          // Response: descend toward root or land on degree 4
          if (posInPhrase === 3) {
            // End of response phrase: land on root or degree 4
            note = prob(0.6) ? 0 : Math.min(4, maxDeg);
          } else {
            const interval = pick([-1, -1, -2, -1, 1, -2]);
            note = Math.max(0, Math.min(maxDeg, note + interval));
          }
        }

        // Slide between phrase transitions (last step of one phrase to first of next)
        const isTransition = posInPhrase === 3 || posInPhrase === 0;

        steps.push(makeStep(note, {
          accent: isPhraseStart && (i % 4 === 0),
          slide: isTransition && prob(0.45),
          tie: prob(0.1),
          octave: prob(0.08) ? pick([1, -1]) : 0,
        }));
        lastActiveIdx = i;
      }

      // Force resolution to root
      if (lastActiveIdx >= 0 && lastActiveIdx < len) {
        steps[lastActiveIdx] = makeStep(0, {
          accent: steps[lastActiveIdx]!.accent,
          slide: false,
        });
      }
      return steps;
    },
  },
  {
    name: "Pentatonic",
    generate: (len, scaleLen) => {
      // Contoured arc: ascend to peak then resolve down, sparse, pentatonic range
      const steps: MelodyStep[] = [];
      const maxDeg = Math.min(4, Math.min(scaleLen - 1, 7)); // only degrees 0-4
      const peakPos = Math.floor(len * (0.6 + Math.random() * 0.15)); // peak at 60-75%
      let note = 0;
      let lastActiveIdx = -1;

      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }

        // Rests at phrase boundaries (multiples of 8)
        if (i > 0 && i % 8 === 0 && i < len - 1) {
          steps.push(emptyStep());
          continue;
        }

        // 50% density
        if (!prob(0.5)) {
          steps.push(emptyStep());
          continue;
        }

        // Shape the arc
        if (i < peakPos) {
          // Ascending phase: gradually climb
          const progress = i / peakPos;
          const targetNote = Math.round(progress * maxDeg);
          if (note < targetNote) note = Math.min(note + 1, maxDeg);
          else if (prob(0.2)) note = Math.max(note - 1, 0); // occasional dip
        } else {
          // Descending phase: resolve toward root
          const remaining = len - 1 - i;
          const totalDescend = len - 1 - peakPos;
          if (totalDescend > 0) {
            const progress = 1 - (remaining / totalDescend);
            const targetNote = Math.round((1 - progress) * maxDeg);
            if (note > targetNote) note = Math.max(note - 1, 0);
            else if (prob(0.15)) note = Math.min(note + 1, maxDeg); // small tension
          }
        }

        const isPeak = i === peakPos || (i >= peakPos - 1 && i <= peakPos + 1 && note === maxDeg);

        steps.push(makeStep(note, {
          accent: isPeak,
          slide: prob(0.2),
          tie: prob(0.1),
          octave: isPeak && prob(0.3) ? 1 : 0,
        }));
        lastActiveIdx = i;
      }

      // Force resolution to root
      if (lastActiveIdx >= 0 && lastActiveIdx < len) {
        steps[lastActiveIdx] = makeStep(0, {
          accent: false,
          slide: false,
        });
      }
      return steps;
    },
  },
  {
    name: "Sequence",
    generate: (len, scaleLen) => {
      // Transposing motif: generate motif, repeat transposed, invert final, resolve
      const steps: MelodyStep[] = [];
      const maxDeg = Math.min(scaleLen - 1, 7);
      const motifLen = pick([3, 3, 4, 4]);

      // Generate an interesting motif (intervals, not absolute notes)
      const motifIntervals: number[] = [];
      for (let m = 0; m < motifLen; m++) {
        motifIntervals.push(pick([1, 2, -1, 3, -2, 1, 2]));
      }

      // Decide repetitions: 3-4 times, each transposed up by 1 degree
      const reps = Math.min(pick([3, 3, 4, 4]), Math.floor(len / motifLen));
      let cursor = 0;
      let lastActiveIdx = -1;

      for (let rep = 0; rep < reps && cursor < len; rep++) {
        const isLast = rep === reps - 1;
        const transpose = rep; // each rep shifts up by 1 degree
        let note = transpose; // start from transposed root

        for (let m = 0; m < motifLen && cursor < len; m++) {
          if (cursor >= MELODY_MAX_CLIP_STEPS) break;

          let interval = motifIntervals[m]!;
          // Final repetition: invert intervals (go back down)
          if (isLast) interval = -interval;

          if (m > 0) note = note + interval;
          // Clamp to valid range
          note = Math.max(0, Math.min(maxDeg, note));

          steps.push(makeStep(note, {
            accent: m === 0, // accent on motif start
            slide: m > 0 && prob(0.4), // slide between motif notes
            tie: prob(0.08),
            octave: note > maxDeg - 1 && prob(0.2) ? 1 : 0,
          }));
          lastActiveIdx = cursor;
          cursor++;
        }
      }

      // Fill remaining steps within length
      while (cursor < len && cursor < MELODY_MAX_CLIP_STEPS) {
        steps.push(emptyStep());
        cursor++;
      }

      // Fill beyond length
      while (steps.length < MELODY_MAX_CLIP_STEPS) {
        steps.push(emptyStep());
      }

      // Resolve last active step to root
      if (lastActiveIdx >= 0 && lastActiveIdx < len) {
        steps[lastActiveIdx] = makeStep(0, {
          accent: steps[lastActiveIdx]!.accent,
          slide: false,
        });
      }
      return steps;
    },
  },
  {
    name: "Random",
    generate: (len, scaleLen) => {
      // House-friendly random with phrase anchors and occasional held notes
      const steps: MelodyStep[] = [];
      const maxDeg = Math.min(scaleLen - 1, 7);
      const ceiling = maxDeg + 2; // allow slight overflow for range
      let note = pick([0, 0, 1, 2, Math.min(4, maxDeg)]);
      let lastDir = 0; // -1 down, 0 neutral, +1 up
      let consecSameDir = 0;
      let lastActiveIdx = -1;

      for (let i = 0; i < MELODY_MAX_CLIP_STEPS; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }

        const phraseEdge = i % 4 === 0;
        if (phraseEdge && i > 0 && prob(0.28)) {
          steps.push(emptyStep());
          continue;
        }

        // Determine interval type
        const r = Math.random();
        let interval: number;
        if (r < 0.76) {
          // Step motion: +/-1
          interval = pick([1, -1]);
        } else if (r < 0.94) {
          // Skip: +/-2 or +/-3
          interval = pick([2, -2, 3, -3]);
        } else {
          // Leap: +/-4 or more
          interval = pick([4, -4, 5, -5]);
        }

        // Direction change: if 3+ consecutive notes in same direction, reverse
        const dir = interval > 0 ? 1 : -1;
        if (dir === lastDir) {
          consecSameDir++;
        } else {
          consecSameDir = 1;
          lastDir = dir;
        }
        if (consecSameDir >= 3) {
          interval = -interval;
          lastDir = -lastDir;
          consecSameDir = 0;
        }

        note = note + interval;
        // Constrain to 0..ceiling
        if (note < 0) note = -note; // bounce off floor
        if (note > ceiling) note = ceiling - (note - ceiling); // bounce off ceiling
        note = Math.max(0, Math.min(ceiling, note));
        // Clamp display to maxDeg for safety
        const displayNote = Math.min(note, maxDeg);

        const gateLength = phraseEdge ? pickMelodyGate("phrase") : pickMelodyGate("short");
        steps.push(makeStep(displayNote, {
          accent: phraseEdge && prob(0.55),
          slide: !phraseEdge && prob(0.18),
          tie: gateLength >= 3 && prob(0.18),
          gateLength,
          octave: note > maxDeg ? 1 : (prob(0.08) ? pick([1, -1]) : 0),
        }));
        lastActiveIdx = i;
      }

      // Force resolution: last active step ALWAYS sets note=0
      if (lastActiveIdx >= 0 && lastActiveIdx < len) {
        steps[lastActiveIdx] = makeStep(0, {
          accent: steps[lastActiveIdx]!.accent,
          slide: false,
        });
      }
      return steps;
    },
  },
];

// ─── Store Interface ─────────────────────────────────────

interface MelodyStore {
  steps: MelodyStep[];
  length: number;
  currentStep: number;
  selectedPage: number;
  rootNote: number;
  rootName: string;
  scaleName: string;
  globalOctave: number;
  params: MelodyParams;
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
  toggleAccent: (step: number) => void;
  toggleSlide: (step: number) => void;
  toggleTie: (step: number) => void;
  setGateLength: (fromStep: number, toStep: number) => void;
  cycleOctave: (step: number) => void;
  setRootNote: (midi: number, name: string) => void;
  setGlobalOctave: (oct: number) => void;
  setScale: (name: string) => void;
  setParam: (key: keyof MelodyParams, value: number | string | boolean) => void;
  setLength: (len: number) => void;
  setSelectedPage: (page: number) => void;
  clearSteps: () => void;
  randomize: () => void;
  generateMelodiline: (strategyIndex: number) => void;
  nextStrategy: () => void;
  prevStrategy: () => void;
  applyEuclidean: (pulses: number, eucSteps: number, rotation: number, noteMode: string) => void;
  loadPreset: (index: number) => void;
  nextPreset: () => void;
  prevPreset: () => void;
  setInstrument: (id: string) => Promise<void>;
  // For save/load
  loadMelodyPattern: (data: { steps: MelodyStep[]; length: number; params: MelodyParams; rootNote: number; rootName: string; scaleName: string }) => void;
}

function createEmptySteps(): MelodyStep[] {
  return Array.from({ length: MELODY_MAX_CLIP_STEPS }, () => ({
    active: false, note: 0, octave: 0, accent: false, velocity: 0.82, slide: false, tie: false, gateLength: 1,
  }));
}

// ─── Melody Scheduler ───────────────────────────────────

let melodyTimer: ReturnType<typeof setInterval> | null = null;
let nextMelodyStepTime = 0;

export function startMelodyScheduler() {
  nextMelodyStepTime = audioEngine.currentTime + 0.05;
  if (melodyTimer !== null) clearInterval(melodyTimer);

  melodyTimer = setInterval(() => {
    const drumState = (window as unknown as { __drumStore?: { getState: () => { bpm: number; isPlaying: boolean } } }).__drumStore?.getState();
    if (!drumState?.isPlaying) return;

    const bpm = drumState.bpm;
    const secondsPerStep = 60.0 / bpm / 4;

    const getLegacyTieLength = (sequence: MelodyStep[], startIndex: number, sequenceLength: number) => {
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

    while (nextMelodyStepTime < audioEngine.currentTime + 0.1) {
      const { steps, currentStep, length, rootNote, scaleName, automationData, globalOctave } = useMelodyStore.getState();
      const stepIndex = currentStep % length;
      const step = steps[stepIndex];
      const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : steps[length - 1];

      // Apply per-step automation
      for (const [param, vals] of Object.entries(automationData)) {
        const val = vals[currentStep % length];
        if (val !== undefined) melodyEngine.setParams({ [param]: val });
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
        const midiNote = scaleNote(rootNote, scaleName, step.note, step.octave + globalOctave);
        const explicitGateLength = Math.max(1, step.gateLength ?? 1);
        const sustainSteps = explicitGateLength > 1 ? explicitGateLength : getLegacyTieLength(steps, stepIndex, length);
        const sustainDuration = secondsPerStep * sustainSteps;
        const { instrument } = useMelodyStore.getState();

        // Use soundfont if a non-synth instrument is selected
        if (instrument !== "_synth_") {
          const velocity = Math.max(0.2, Math.min(1, step.velocity ?? (step.accent ? 1.0 : 0.7)));
          const duration = Math.max(secondsPerStep * 1.2, sustainDuration * 0.98);
          soundFontEngine.playNote("melody", midiNote, nextMelodyStepTime, velocity, duration);
        } else {
          // Use built-in synth
          melodyEngine.triggerNote(midiNote, nextMelodyStepTime, step.accent, step.slide, false, step.velocity ?? (step.accent ? 1.0 : 0.7));
          melodyEngine.releaseNote(nextMelodyStepTime + Math.max(secondsPerStep * 0.92, sustainDuration * 0.98));
        }
      } else if (!step?.active && !isHeldByPreviousGate) {
        if (steps.some(s => s.active)) {
          melodyEngine.rest(nextMelodyStepTime);
        }
      }

      useMelodyStore.setState({ currentStep: (currentStep + 1) % length });
      nextMelodyStepTime += secondsPerStep;
    }
  }, 25);
}

export function stopMelodyScheduler() {
  if (melodyTimer !== null) { clearInterval(melodyTimer); melodyTimer = null; }
  const now = audioEngine.currentTime;
  if (now > 0) melodyEngine.releaseNote(now);
  useMelodyStore.setState({ currentStep: 0 });
}

// ─── Store ───────────────────────────────────────────────

export const useMelodyStore = create<MelodyStore>((set, get) => ({
  steps: createEmptySteps(),
  length: 16,
  currentStep: 0,
  selectedPage: 0,
  rootNote: 48,
  rootName: "C",
  scaleName: "Minor",
  globalOctave: 0,
  params: { ...DEFAULT_MELODY_PARAMS },
  presetIndex: 0,
  strategyIndex: 0,
  automationData: {},
  automationParam: "cutoff",
  isPlaying: false,
  instrument: "_synth_",

  toggleStep: (step) => set((s) => {
    const newSteps = [...s.steps];
    newSteps[step] = { ...newSteps[step]!, active: !newSteps[step]!.active };
    const newLen = step >= s.length ? Math.min(MELODY_MAX_CLIP_STEPS, step + 1) : s.length;
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

    const gateLength = Math.max(1, Math.min(MELODY_MAX_CLIP_STEPS - fromStep, toStep - fromStep + 1));
    newSteps[fromStep] = { ...sourceStep, gateLength };

    for (let i = fromStep + 1; i < MELODY_MAX_CLIP_STEPS; i++) {
      if (newSteps[i]?.tie && newSteps[i]?.active) {
        newSteps[i] = { active: false, note: 0, octave: 0, accent: false, velocity: 0.82, slide: false, tie: false, gateLength: 1 };
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
    syncScaleToOtherStores("melody", { rootNote: midi, rootName: name });
  },
  setGlobalOctave: (oct) => set({ globalOctave: Math.max(-2, Math.min(2, oct)) }),
  setScale: (name) => {
    set({ scaleName: name });
    syncScaleToOtherStores("melody", { scaleName: name });
  },

  setParam: (key, value) => {
    const p = { ...get().params, [key]: value };
    set({ params: p });
    melodyEngine.setParams({ [key]: value } as Partial<MelodyParams>);

    // Motion Recording: write automation on current step while playing
    const { isPlaying, currentStep, length, automationData } = get();
    if (isPlaying && typeof value === "number") {
      const data = { ...automationData };
      if (!data[key]) data[key] = new Array(MELODY_MAX_CLIP_STEPS).fill(undefined);
      const arr = [...data[key]!];
      arr[currentStep % length] = value;
      data[key] = arr;
      set({ automationData: data });
    }
  },

  setLength: (len) => set({ length: Math.max(4, Math.min(MELODY_MAX_CLIP_STEPS, len)) }),
  setSelectedPage: (page) => set({ selectedPage: page }),
  clearSteps: () => set({ steps: createEmptySteps() }),

  // Simple random (calls current strategy)
  randomize: () => get().generateMelodiline(get().strategyIndex),

  generateMelodiline: (strategyIdx) => {
    const { length, scaleName } = get();
    const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
    const strategy = MELODY_STRATEGIES[strategyIdx];
    if (!strategy) return;
    const steps = strategy.generate(length, scale.length);
    set({ steps, strategyIndex: strategyIdx });
  },

  nextStrategy: () => {
    const next = (get().strategyIndex + 1) % MELODY_STRATEGIES.length;
    set({ strategyIndex: next });
  },

  prevStrategy: () => {
    const prev = (get().strategyIndex - 1 + MELODY_STRATEGIES.length) % MELODY_STRATEGIES.length;
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
        newSteps[i] = { active: true, note, octave: 0, accent: i % 4 === 0, velocity: i % 4 === 0 ? 0.95 : 0.72, slide: false, tie: false, gateLength: 1 };
      }
    }
    set({ steps: newSteps });
  },

  loadPreset: (index) => {
    const preset = MELODY_PRESETS[index];
    if (!preset) return;
    const params = ensureSynthParams(preset.params);
    set({ params, presetIndex: index });
    melodyEngine.setParams(params);
  },

  nextPreset: () => {
    const next = (get().presetIndex + 1) % MELODY_PRESETS.length;
    get().loadPreset(next);
  },
  prevPreset: () => {
    const prev = (get().presetIndex - 1 + MELODY_PRESETS.length) % MELODY_PRESETS.length;
    get().loadPreset(prev);
  },

  setInstrument: async (id: string) => {
    if (id === "_synth_") {
      soundFontEngine.stopAll("melody");
      set({ instrument: id });
      return;
    }

    set({ instrument: id });
    const ctx = audioEngine.getAudioContext();
    if (ctx) {
      const destination = audioEngine.getChannelOutput(14); // Melody = channel 14
      try {
        await soundFontEngine.loadInstrument("melody", id, destination);
      } catch (err) {
        console.warn("Failed to load melody instrument:", err);
        set({ instrument: "_synth_" });
      }
    }
  },

  setAutomationValue: (param, step, value) => set((s) => {
    const data = { ...s.automationData };
    if (!data[param]) data[param] = new Array(MELODY_MAX_CLIP_STEPS).fill(undefined);
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

  loadMelodyPattern: (data) => {
    const params = ensureSynthParams(data.params);
    set({
      steps: data.steps,
      length: data.length,
      params,
      rootNote: data.rootNote,
      rootName: data.rootName,
      scaleName: data.scaleName,
    });
    melodyEngine.setParams(params);
  },
}));

// Register for global scale sync
registerScaleStore("melody", (u) => useMelodyStore.setState(u), 48);
