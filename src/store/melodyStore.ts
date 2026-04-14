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

// ─── Factory Sound Presets ───────────────────────────────

export interface MelodyPreset {
  name: string;
  params: MelodyParams;
}

const mp = (p: Partial<MelodyParams>): MelodyParams => ({ ...DEFAULT_MELODY_PARAMS, ...p });

// Factory helper to ensure synthType and filterModel are set (for backward compatibility)
function ensureSynthParams(p: MelodyParams): MelodyParams {
  return { ...p, synthType: p.synthType || "subtractive", filterModel: p.filterModel || "lpf" };
}

export const MELODY_PRESETS: MelodyPreset[] = [
  // ── Professional Leads ──
  { name: "Classic Lead", params: mp({ synthType: "subtractive", waveform: "sawtooth", filterModel: "ladder", cutoff: 2000, resonance: 8, envMod: 0.4, decay: 150, accent: 0.4, slideTime: 40, legato: false, distortion: 0.15, volume: 0.5, subOsc: 0.1, pulseWidth: 0.5, unison: 0.3, vibratoRate: 4, vibratoDepth: 0.1, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "PWM String", params: mp({ synthType: "subtractive", waveform: "square", filterModel: "ladder", cutoff: 1200, resonance: 6, envMod: 0.3, decay: 180, accent: 0.3, slideTime: 80, legato: true, distortion: 0.1, volume: 0.48, subOsc: 0.2, pulseWidth: 0.3, unison: 0.2, vibratoRate: 5, vibratoDepth: 0.25, fmHarmonicity: 3, fmModIndex: 10 }) },
  { name: "FM Bell", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 3000, resonance: 4, envMod: 0.2, decay: 120, accent: 0.5, slideTime: 0, legato: false, distortion: 0.05, volume: 0.45, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 4, vibratoDepth: 0, fmHarmonicity: 4, fmModIndex: 15 }) },
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
  { name: "Crystal Bell", params: mp({ synthType: "fm", waveform: "triangle", filterModel: "lpf", cutoff: 4000, resonance: 3, envMod: 0.1, decay: 100, accent: 0.3, slideTime: 0, legato: false, distortion: 0, volume: 0.48, subOsc: 0, pulseWidth: 0.5, unison: 0, vibratoRate: 3, vibratoDepth: 0.05, fmHarmonicity: 5, fmModIndex: 20 }) },
];

// ─── Melody Generation Strategies ────────────────────────

export interface MelodyStrategy {
  name: string;
  generate: (length: number, scaleLen: number) => MelodyStep[];
}

function makeStep(note: number, opts?: Partial<MelodyStep>): MelodyStep {
  return { active: true, note, octave: 0, accent: false, slide: false, tie: false, ...opts };
}

function emptyStep(): MelodyStep {
  return { active: false, note: 0, octave: 0, accent: false, slide: false, tie: false };
}

function prob(p: number): boolean { return Math.random() < p; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

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
          if (cursor >= 64) break;

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
      while (cursor < len && cursor < 64) {
        steps.push(emptyStep());
        cursor++;
      }

      // Fill beyond length
      while (steps.length < 64) {
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
      // Constrained random: step/skip/leap motion, direction changes, phrase breathing
      const steps: MelodyStep[] = [];
      const maxDeg = Math.min(scaleLen - 1, 7);
      const ceiling = maxDeg + 2; // allow slight overflow for range
      let note = Math.floor(Math.random() * (maxDeg + 1));
      let lastDir = 0; // -1 down, 0 neutral, +1 up
      let consecSameDir = 0;
      let lastActiveIdx = -1;

      for (let i = 0; i < 64; i++) {
        if (i >= len) { steps.push(emptyStep()); continue; }

        // Phrase breathing: 35% chance of rest on steps divisible by 4
        if (i % 4 === 0 && i > 0 && prob(0.35)) {
          steps.push(emptyStep());
          continue;
        }

        // Determine interval type
        const r = Math.random();
        let interval: number;
        if (r < 0.7) {
          // Step motion: +/-1
          interval = pick([1, -1]);
        } else if (r < 0.9) {
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

        steps.push(makeStep(displayNote, {
          accent: (i % 4 === 0) && prob(0.6), // accent on beats 1,5,9,13
          slide: prob(0.25),
          tie: prob(0.12),
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
  params: MelodyParams;
  presetIndex: number;
  strategyIndex: number;
  automationData: Record<string, number[]>;
  automationParam: string;
  isPlaying: boolean;
  instrument: string;

  setAutomationValue: (param: string, step: number, value: number) => void;
  setAutomationParam: (param: string) => void;
  clearAutomation: (param: string) => void;
  toggleStep: (step: number) => void;
  setStepNote: (step: number, note: number) => void;
  setStepOctave: (step: number, octave: number) => void;
  toggleAccent: (step: number) => void;
  toggleSlide: (step: number) => void;
  toggleTie: (step: number) => void;
  cycleOctave: (step: number) => void;
  setRootNote: (midi: number, name: string) => void;
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
  return Array.from({ length: 64 }, () => ({
    active: false, note: 0, octave: 0, accent: false, slide: false, tie: false,
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

    while (nextMelodyStepTime < audioEngine.currentTime + 0.1) {
      const { steps, currentStep, length, rootNote, scaleName, automationData } = useMelodyStore.getState();
      const step = steps[currentStep % length];

      // Apply per-step automation
      for (const [param, vals] of Object.entries(automationData)) {
        const val = vals[currentStep % length];
        if (val !== undefined) melodyEngine.setParams({ [param]: val });
      }

      if (step?.active) {
        const midiNote = scaleNote(rootNote, scaleName, step.note, step.octave);
        const { instrument } = useMelodyStore.getState();

        // Use soundfont if a non-synth instrument is selected
        if (instrument !== "_synth_") {
          const velocity = step.accent ? 1.0 : 0.7;
          const duration = secondsPerStep * 1.2;
          soundFontEngine.playNote("melody", midiNote, nextMelodyStepTime, velocity, duration);
        } else {
          // Use built-in synth
          melodyEngine.triggerNote(midiNote, nextMelodyStepTime, step.accent, step.slide, step.tie);

          const nextStepIdx = (currentStep + 1) % length;
          const nextStep = steps[nextStepIdx];
          if (nextStep?.active && nextStep.tie) {
            // Don't release — tie holds note
          } else {
            melodyEngine.releaseNote(nextMelodyStepTime + secondsPerStep * 0.9);
          }
        }
      } else {
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
        newSteps[i] = { active: true, note, octave: 0, accent: i % 4 === 0, slide: false, tie: false };
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

  nextPreset: () => { const n = (get().presetIndex + 1) % MELODY_PRESETS.length; get().loadPreset(n); },
  prevPreset: () => { const p = (get().presetIndex - 1 + MELODY_PRESETS.length) % MELODY_PRESETS.length; get().loadPreset(p); },

  setInstrument: async (id: string) => {
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
