/**
 * Demo Songs — curated genre starter projects.
 *
 * Each demo song is a complete musical idea: drum kit + drum pattern (from
 * the kit) + bass preset + bass pattern + chords preset + chord progression.
 *
 * Critical conventions:
 *   - rootName is "C", "C#", "D", ... (display)
 *   - The loader derives bass MIDI root  = 36 + noteClass (C2 base octave)
 *   - The loader derives chord MIDI root = 48 + noteClass (C3 base octave)
 *   - Step "octave" field shifts ±1 from there
 *
 * Patterns kept INTENTIONALLY sparse: clean root-note bass on downbeats,
 * one chord per bar, no overlapping melodies. Better musical hygiene than
 * dense first attempt.
 */

import type { BassStep } from "../audio/BassEngine";
import type { ChordsStep } from "../audio/ChordsEngine";

export interface DemoSong {
  id: string;
  name: string;
  genre: string;
  description: string;
  bpm: number;
  swing?: number;

  kitId: string;
  bassPresetName: string | null;
  chordsPresetName: string | null;

  // Music key
  rootName: string;       // "C", "C#", "D", ...
  scaleName: string;      // Key in SCALES map

  // Patterns
  bassSteps?: BassStep[];
  bassLength?: number;
  chordsSteps?: ChordsStep[];
  chordsLength?: number;

  // Mix overrides — voiceIndex to fader 0..1000 (750 = unity)
  // Channels 12 = bass, 13 = chords
  faderOverrides?: Record<number, number>;
}

// ─── Map note name → semitone class 0..11 ────────────────────────────────────
export const NOTE_CLASS: Record<string, number> = {
  "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3,
  "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8,
  "A": 9, "A#": 10, "Bb": 10, "B": 11,
};

// ─── Step builders ───────────────────────────────────────────────────────────
const X = (): BassStep => ({ active: false, note: 0, octave: 0, accent: false, slide: false, tie: false });
const B = (note: number, opts: Partial<BassStep> = {}): BassStep => ({
  active: true, note, octave: 0, accent: false, slide: false, tie: false, ...opts,
});

const XC = (): ChordsStep => ({ active: false, note: 0, chordType: "Min", octave: 0, accent: false, tie: false });
const C = (note: number, type: string, opts: Partial<ChordsStep> = {}): ChordsStep => ({
  active: true, note, chordType: type, octave: 0, accent: false, tie: false, ...opts,
});

// Repeat a single chord pulse for `bars` bars (16 steps each), with rests after attack
function holdChord(degree: number, type: string, bars: number): ChordsStep[] {
  const out: ChordsStep[] = [C(degree, type)];
  for (let i = 1; i < bars * 16; i++) out.push(XC());
  return out;
}

// Bass on every quarter note (steps 0, 4, 8, 12) for one bar
function bassPulseBar(degree: number): BassStep[] {
  const out: BassStep[] = [];
  for (let i = 0; i < 16; i++) {
    out.push(i % 4 === 0 ? B(degree) : X());
  }
  return out;
}

// Bass single hit on step 0 only, rest hold for one bar
function bassHitBar(degree: number, octave = 0): BassStep[] {
  const out: BassStep[] = [B(degree, { octave })];
  for (let i = 1; i < 16; i++) out.push(X());
  return out;
}

// ─── 1. VELVET STAIRS — Lo-Fi Hip Hop in C minor ─────────────────────────────
// Progression: Cm - Ab - Eb - G  (i - VI - III - V), one chord per bar
// Scale degrees in C minor [0=C, 1=D, 2=Eb, 3=F, 4=G, 5=Ab, 6=Bb]:
//   Cm  = root 0, Min
//   Ab  = root 5, Maj
//   Eb  = root 2, Maj
//   G   = root 4, Maj  (V chord — major in minor key for tension/release)
const velvetStairs: DemoSong = {
  id: "velvet-stairs",
  name: "Velvet Stairs",
  genre: "Lo-Fi Hip Hop",
  description: "Dusty drums under a slow, soft chord descent",
  bpm: 78,
  swing: 60,
  kitId: "lofi-tape",
  bassPresetName: "Lo-Fi Tape Sub",
  chordsPresetName: "Lo-Fi Velvet",
  rootName: "C",
  scaleName: "Minor",
  // 4-bar progression × 16 = 64 steps
  chordsSteps: [
    ...holdChord(0, "Min", 1),
    ...holdChord(5, "Maj", 1),
    ...holdChord(2, "Maj", 1),
    ...holdChord(4, "Maj", 1),
  ],
  chordsLength: 64,
  // Bass on beat 1 of each bar only — let the kit's groove breathe
  bassSteps: [
    ...bassHitBar(0),
    ...bassHitBar(5, -1), // Ab below root
    ...bassHitBar(2, -1), // Eb below root
    ...bassHitBar(4, -1), // G below root
  ],
  bassLength: 64,
  faderOverrides: { 12: 680, 13: 700 }, // bass + chords slightly under unity
};

// ─── 2. SUNSET DRIVE — Synthwave in A minor ─────────────────────────────────
// Progression: Am - F - C - G  (i - VI - III - VII), classic 80s
// Scale degrees in A minor: [0=A, 1=B, 2=C, 3=D, 4=E, 5=F, 6=G]
const sunsetDrive: DemoSong = {
  id: "sunset-drive",
  name: "Sunset Drive",
  genre: "Synthwave",
  description: "Pulsing octave bass, gated snare, neon pads",
  bpm: 108,
  kitId: "synthwave-80s",
  bassPresetName: "Synthwave Drive",
  chordsPresetName: "Synthwave Pad",
  rootName: "A",
  scaleName: "Minor",
  chordsSteps: [
    ...holdChord(0, "Min", 1),
    ...holdChord(5, "Maj", 1),
    ...holdChord(2, "Maj", 1),
    ...holdChord(6, "Maj", 1),
  ],
  chordsLength: 64,
  // Steady quarter-note bass — typical synthwave drive
  bassSteps: [
    ...bassPulseBar(0),
    ...bassPulseBar(5),
    ...bassPulseBar(2),
    ...bassPulseBar(6),
  ],
  bassLength: 64,
  faderOverrides: { 12: 700, 13: 680 },
};

// ─── 3. LIQUID HOURS — Liquid DnB in F minor ────────────────────────────────
// Progression: Fm - Db - Bbm - Eb  (i - VI - iv - VII)
// Scale degrees in F minor: [0=F, 1=G, 2=Ab, 3=Bb, 4=C, 5=Db, 6=Eb]
const liquidHours: DemoSong = {
  id: "liquid-hours",
  name: "Liquid Hours",
  genre: "Liquid DnB",
  description: "Rolling break with deep sub and warm pads",
  bpm: 174,
  kitId: "dnb-liquid",
  bassPresetName: "Liquid DnB",
  chordsPresetName: "Lush Pad",
  rootName: "F",
  scaleName: "Minor",
  chordsSteps: [
    ...holdChord(0, "Min", 1),
    ...holdChord(5, "Maj", 1),
    ...holdChord(3, "Min", 1),
    ...holdChord(6, "Maj", 1),
  ],
  chordsLength: 64,
  // Single deep sub per bar — DnB lets the break do the work
  bassSteps: [
    ...bassHitBar(0, -1),
    ...bassHitBar(5, -1),
    ...bassHitBar(3, -1),
    ...bassHitBar(6, -1),
  ],
  bassLength: 64,
  faderOverrides: { 12: 720, 13: 660 },
};

// ─── 4. NIGHT BLOOM — Deep House in A minor ─────────────────────────────────
// Progression: Am - F - G - Em  (i - VI - VII - v)
// Off-beat Rhodes stabs are the signature deep-house sound
const nightBloom: DemoSong = {
  id: "night-bloom",
  name: "Night Bloom",
  genre: "Deep House",
  description: "Four-on-the-floor with off-beat Rhodes stabs",
  bpm: 122,
  kitId: "deep-house",
  bassPresetName: "DH Moog Bass",
  chordsPresetName: "DH Rhodes Warm",
  rootName: "A",
  scaleName: "Minor",
  // Off-beat stabs (steps 2, 6, 10, 14) — the "and" of every beat
  chordsSteps: (function buildChords() {
    const stab = (deg: number, type: string): ChordsStep[] => {
      const arr: ChordsStep[] = [];
      for (let i = 0; i < 16; i++) {
        // Stab on the &'s of each beat (steps 2, 6, 10, 14)
        arr.push((i === 2 || i === 6 || i === 10 || i === 14) ? C(deg, type) : XC());
      }
      return arr;
    };
    return [
      ...stab(0, "Min"),
      ...stab(5, "Maj"),
      ...stab(6, "Maj"),
      ...stab(4, "Min"),
    ];
  })(),
  chordsLength: 64,
  // Quarter-note bouncing bass on each bar's chord root
  bassSteps: [
    ...bassPulseBar(0),
    ...bassPulseBar(5),
    ...bassPulseBar(6),
    ...bassPulseBar(4),
  ],
  bassLength: 64,
  faderOverrides: { 12: 700, 13: 680 },
};

// ─── 5. COSMIC DRIFT — Ambient in D minor ───────────────────────────────────
// Progression: Dm - Bb - F - C  (i - VI - III - VII), 2 bars per chord
// Just held drone bass; pad does all the harmony
const cosmicDrift: DemoSong = {
  id: "cosmic-drift",
  name: "Cosmic Drift",
  genre: "Ambient / Cinematic",
  description: "Slow-evolving pad and breathing drone bass",
  bpm: 76,
  kitId: "ambient-organic",
  bassPresetName: "Ambient Drone",
  chordsPresetName: "Cinematic Sweep",
  rootName: "D",
  scaleName: "Minor",
  // 8 bars total = 128 steps. 2 bars per chord.
  chordsSteps: [
    ...holdChord(0, "Min", 2),
    ...holdChord(5, "Maj", 2),
    ...holdChord(2, "Maj", 2),
    ...holdChord(6, "Maj", 2),
  ],
  chordsLength: 128,
  bassSteps: [
    ...bassHitBar(0, -1), ...new Array(16).fill(null).map(X),
    ...bassHitBar(5, -1), ...new Array(16).fill(null).map(X),
    ...bassHitBar(2, -1), ...new Array(16).fill(null).map(X),
    ...bassHitBar(6, -1), ...new Array(16).fill(null).map(X),
  ],
  bassLength: 128,
  faderOverrides: { 12: 650, 13: 720 }, // pad louder, drone bass quieter
};

export const DEMO_SONGS: DemoSong[] = [
  velvetStairs,
  sunsetDrive,
  liquidHours,
  nightBloom,
  cosmicDrift,
];
