/**
 * Demo Songs — curated genre starter projects.
 *
 * Each demo song is a complete musical idea: drum kit + drum pattern (from
 * the kit) + bass preset + bass pattern + chords preset + chord progression
 * + melody (optional). Loading a demo populates every engine's state and
 * leaves the user with a playable groove.
 *
 * The "Wow Effect" — first-launch experience picks one of these so the user
 * hears something musical immediately.
 */

import type { BassStep } from "../audio/BassEngine";
import type { ChordsStep } from "../audio/ChordsEngine";
import type { MelodyStep } from "../audio/MelodyEngine";

export interface DemoSong {
  id: string;
  name: string;          // Marketing name e.g. "Velvet Stairs"
  genre: string;         // "Lo-Fi Hip Hop"
  description: string;   // 1-line tagline
  bpm: number;
  swing?: number;        // 50-75 (50 = none, 67 = 2:1 triplet shuffle)

  // Sound selection (must match existing IDs/names in the project)
  kitId: string;                    // factoryKits.ts id
  bassPresetName: string | null;    // BASS_PRESETS .name (null = silent)
  chordsPresetName: string | null;
  melodyPresetName: string | null;

  // Music key
  rootNote: number;       // 0..11 (0 = C)
  rootName: string;       // Display name "C", "C#", ...
  scaleName: string;      // Key in SCALES map

  // Patterns — undefined = engine stays silent
  bassSteps?: BassStep[];
  bassLength?: number;
  chordsSteps?: ChordsStep[];
  chordsLength?: number;
  melodySteps?: MelodyStep[];
  melodyLength?: number;
}

// ─── Compact step builders ──────────────────────────────────────────────────
// Use these to keep step arrays terse and readable.

const X = (): BassStep => ({ active: false, note: 0, octave: 0, accent: false, slide: false, tie: false });
const B = (note: number, opts: Partial<BassStep> = {}): BassStep => ({
  active: true, note, octave: 0, accent: false, slide: false, tie: false, ...opts,
});

const XC = (): ChordsStep => ({ active: false, note: 0, chordType: "Min", octave: 0, accent: false, tie: false });
const C = (note: number, type: string, opts: Partial<ChordsStep> = {}): ChordsStep => ({
  active: true, note, chordType: type, octave: 0, accent: false, tie: false, ...opts,
});

const XM = (): MelodyStep => ({ active: false, note: 0, octave: 0, accent: false, slide: false, tie: false });
const M = (note: number, opts: Partial<MelodyStep> = {}): MelodyStep => ({
  active: true, note, octave: 0, accent: false, slide: false, tie: false, ...opts,
});

// Pad an array out to `len` with empties of the given builder
function pad<T>(arr: T[], len: number, empty: () => T): T[] {
  while (arr.length < len) arr.push(empty());
  return arr.slice(0, len);
}

// ─── 1. Velvet Stairs — Lo-Fi Hip Hop ────────────────────────────────────────
// Key: A minor. Progression: Am7 - Dm7 - Fmaj7 - E7 (one chord per bar, 4 bars)
const velvetStairs: DemoSong = {
  id: "velvet-stairs",
  name: "Velvet Stairs",
  genre: "Lo-Fi Hip Hop",
  description: "Dusty drums, warm Rhodes chords and a soft pluck bass",
  bpm: 78,
  swing: 62,
  kitId: "lofi-tape",
  bassPresetName: "Lo-Fi Tape Sub",
  chordsPresetName: "Lo-Fi Velvet",
  melodyPresetName: null,
  rootNote: 9, rootName: "A", scaleName: "Minor",
  // 32 steps = 2 bars of 16ths × 2 (chord changes every bar)
  // Scale degrees in A Minor: 0=A, 1=B, 2=C, 3=D, 4=E, 5=F, 6=G
  chordsSteps: pad([
    // Bar 1: Am7
    C(0, "Min7"), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    // Bar 2: Dm7
    C(3, "Min7"), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    // Bar 3: Fmaj7
    C(5, "Maj7"), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    // Bar 4: E7
    C(4, "7th"), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
  ], 64, XC),
  chordsLength: 64,
  bassSteps: pad([
    // Bar 1: Am root, walking
    B(0, { octave: -1 }), X(), X(), X(), B(0), X(), X(), B(2),
    X(), X(), X(), X(), B(0), X(), X(), X(),
    // Bar 2: Dm
    B(3, { octave: -1 }), X(), X(), X(), B(3), X(), X(), B(5),
    X(), X(), X(), X(), B(3), X(), X(), X(),
    // Bar 3: F (= 5)
    B(5, { octave: -1 }), X(), X(), X(), B(5), X(), X(), B(0, { octave: 0 }),
    X(), X(), X(), X(), B(5), X(), X(), X(),
    // Bar 4: E (= 4)
    B(4, { octave: -1 }), X(), X(), X(), B(4), X(), X(), B(6, { octave: -1 }),
    X(), X(), X(), X(), B(4), X(), X(), X(),
  ], 64, X),
  bassLength: 64,
};

// ─── 2. Sunset Drive — Synthwave ─────────────────────────────────────────────
// Key: D minor. Progression: i-VI-III-VII (Dm-Bb-F-C). Classic 80s.
const sunsetDrive: DemoSong = {
  id: "sunset-drive",
  name: "Sunset Drive",
  genre: "Synthwave",
  description: "80s analog drive — gated snare, supersaw chords, octave bass",
  bpm: 108,
  swing: 50,
  kitId: "synthwave-80s",
  bassPresetName: "Synthwave Drive",
  chordsPresetName: "Synthwave Pad",
  melodyPresetName: "★ Glass Bells",
  rootNote: 2, rootName: "D", scaleName: "Minor",
  // Scale degrees in D Minor: 0=D, 1=E, 2=F, 3=G, 4=A, 5=Bb, 6=C
  chordsSteps: pad([
    // Bar 1: Dm
    C(0, "Min"),  XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    // Bar 2: Bb (= 5, octave above)
    C(5, "Maj"),  XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    // Bar 3: F (= 2)
    C(2, "Maj"),  XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    // Bar 4: C (= 6)
    C(6, "Maj"),  XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
  ], 64, XC),
  chordsLength: 64,
  // Octave-driven 80s bass (up-down 8th notes)
  bassSteps: pad([
    // Bar 1: Dm root + octave alternation
    B(0), B(0, { octave: 1 }), B(0), B(0, { octave: 1 }),
    B(0), B(0, { octave: 1 }), B(0), B(0, { octave: 1 }),
    B(0), B(0, { octave: 1 }), B(0), B(0, { octave: 1 }),
    B(0), B(0, { octave: 1 }), B(0), B(0, { octave: 1 }),
    // Bar 2: Bb root
    B(5, { octave: -1 }), B(5), B(5, { octave: -1 }), B(5),
    B(5, { octave: -1 }), B(5), B(5, { octave: -1 }), B(5),
    B(5, { octave: -1 }), B(5), B(5, { octave: -1 }), B(5),
    B(5, { octave: -1 }), B(5), B(5, { octave: -1 }), B(5),
    // Bar 3: F
    B(2), B(2, { octave: 1 }), B(2), B(2, { octave: 1 }),
    B(2), B(2, { octave: 1 }), B(2), B(2, { octave: 1 }),
    B(2), B(2, { octave: 1 }), B(2), B(2, { octave: 1 }),
    B(2), B(2, { octave: 1 }), B(2), B(2, { octave: 1 }),
    // Bar 4: C
    B(6, { octave: -1 }), B(6), B(6, { octave: -1 }), B(6),
    B(6, { octave: -1 }), B(6), B(6, { octave: -1 }), B(6),
    B(6, { octave: -1 }), B(6), B(6, { octave: -1 }), B(6),
    B(6, { octave: -1 }), B(6), B(6, { octave: -1 }), B(6),
  ], 64, X),
  bassLength: 64,
  // Sparse glass-bell melody hits — emphasize 5th of each chord
  melodySteps: pad([
    XM(), XM(), XM(), XM(), XM(), XM(), XM(), XM(), M(4, { octave: 1 }), XM(), XM(), XM(), XM(), XM(), XM(), XM(),
    XM(), XM(), XM(), XM(), XM(), XM(), XM(), XM(), M(2, { octave: 1 }), XM(), XM(), XM(), XM(), XM(), XM(), XM(),
    XM(), XM(), XM(), XM(), XM(), XM(), XM(), XM(), M(6), XM(), XM(), XM(), XM(), XM(), XM(), XM(),
    XM(), XM(), XM(), XM(), XM(), XM(), XM(), XM(), M(3, { octave: 1 }), XM(), XM(), XM(), XM(), XM(), XM(), XM(),
  ], 64, XM),
  melodyLength: 64,
};

// ─── 3. Liquid Hours — DnB Liquid ───────────────────────────────────────────
// Key: F minor. Progression: i-VII-VI-V (Fm-Eb-Db-C7)
const liquidHours: DemoSong = {
  id: "liquid-hours",
  name: "Liquid Hours",
  genre: "Liquid DnB",
  description: "Rolling break with deep sub and warm string pads",
  bpm: 174,
  kitId: "dnb-liquid",
  bassPresetName: "Liquid DnB",
  chordsPresetName: "Lush Pad",
  melodyPresetName: null,
  rootNote: 5, rootName: "F", scaleName: "Minor",
  // Scale degrees in F Minor: 0=F, 1=G, 2=Ab, 3=Bb, 4=C, 5=Db, 6=Eb
  chordsSteps: pad([
    // Bar 1: Fm
    C(0, "Min"),  XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    // Bar 2: Eb (= 6)
    C(6, "Maj"),  XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    // Bar 3: Db (= 5)
    C(5, "Maj7"), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    // Bar 4: C (= 4)
    C(4, "7th"),  XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
  ], 64, XC),
  chordsLength: 64,
  // Liquid bassline — root + 5th, sliding
  bassSteps: pad([
    B(0, { octave: -1 }), X(), X(), X(), X(), X(), X(), X(),
    B(0, { octave: -1 }), X(), X(), B(4, { octave: -1, slide: true }), X(), X(), X(), X(),
    B(6, { octave: -1 }), X(), X(), X(), X(), X(), X(), X(),
    B(6, { octave: -1 }), X(), X(), B(3, { octave: -1, slide: true }), X(), X(), X(), X(),
    B(5, { octave: -1 }), X(), X(), X(), X(), X(), X(), X(),
    B(5, { octave: -1 }), X(), X(), B(2, { octave: -1, slide: true }), X(), X(), X(), X(),
    B(4, { octave: -1 }), X(), X(), X(), X(), X(), X(), X(),
    B(4, { octave: -1 }), X(), X(), B(1, { octave: -1, slide: true }), X(), X(), X(), X(),
  ], 64, X),
  bassLength: 64,
};

// ─── 4. Night Bloom — Deep House ────────────────────────────────────────────
// Key: G minor. Progression: i-VII-VI-V (Gm-F-Eb-D)
const nightBloom: DemoSong = {
  id: "night-bloom",
  name: "Night Bloom",
  genre: "Deep House",
  description: "Four-on-the-floor with Rhodes stabs and round bass",
  bpm: 122,
  kitId: "deep-house",
  bassPresetName: "DH Moog Bass",
  chordsPresetName: "DH Rhodes Warm",
  melodyPresetName: null,
  rootNote: 7, rootName: "G", scaleName: "Minor",
  // Scale degrees in G Minor: 0=G, 1=A, 2=Bb, 3=C, 4=D, 5=Eb, 6=F
  // Off-beat Rhodes stabs (the classic deep house "skank")
  chordsSteps: pad([
    // Bar 1: Gm9 — stabs on 2-and, 4-and
    XC(), XC(), C(0, "Min7"), XC(), XC(), XC(), C(0, "Min7"), XC(),
    XC(), XC(), C(0, "Min7"), XC(), XC(), XC(), C(0, "Min7"), XC(),
    // Bar 2: F (= 6)
    XC(), XC(), C(6, "Maj7"), XC(), XC(), XC(), C(6, "Maj7"), XC(),
    XC(), XC(), C(6, "Maj7"), XC(), XC(), XC(), C(6, "Maj7"), XC(),
    // Bar 3: Eb (= 5)
    XC(), XC(), C(5, "Maj7"), XC(), XC(), XC(), C(5, "Maj7"), XC(),
    XC(), XC(), C(5, "Maj7"), XC(), XC(), XC(), C(5, "Maj7"), XC(),
    // Bar 4: D (= 4)
    XC(), XC(), C(4, "7th"),  XC(), XC(), XC(), C(4, "7th"),  XC(),
    XC(), XC(), C(4, "7th"),  XC(), XC(), XC(), C(4, "7th"),  XC(),
  ], 64, XC),
  chordsLength: 64,
  // Bouncing bassline — root and 5th
  bassSteps: pad([
    B(0), X(), X(), B(4, { octave: -1 }), X(), X(), B(0), X(),
    X(), B(0), X(), X(), B(4, { octave: -1 }), X(), B(0), X(),
    B(6, { octave: -1 }), X(), X(), B(3, { octave: -1 }), X(), X(), B(6, { octave: -1 }), X(),
    X(), B(6, { octave: -1 }), X(), X(), B(3, { octave: -1 }), X(), B(6, { octave: -1 }), X(),
    B(5, { octave: -1 }), X(), X(), B(2, { octave: -1 }), X(), X(), B(5, { octave: -1 }), X(),
    X(), B(5, { octave: -1 }), X(), X(), B(2, { octave: -1 }), X(), B(5, { octave: -1 }), X(),
    B(4, { octave: -1 }), X(), X(), B(1, { octave: -1 }), X(), X(), B(4, { octave: -1 }), X(),
    X(), B(4, { octave: -1 }), X(), X(), B(1, { octave: -1 }), X(), B(4, { octave: -1 }), X(),
  ], 64, X),
  bassLength: 64,
};

// ─── 5. Cosmic Drift — Ambient / Cinematic ──────────────────────────────────
// Key: C minor. Progression: i-iv-VI-VII (Cm-Fm-Ab-Bb), 2 bars per chord = 8 bars total
const cosmicDrift: DemoSong = {
  id: "cosmic-drift",
  name: "Cosmic Drift",
  genre: "Ambient / Cinematic",
  description: "Slow-evolving pad and breathing drone bass",
  bpm: 76,
  kitId: "ambient-organic",
  bassPresetName: "Ambient Drone",
  chordsPresetName: "Cinematic Sweep",
  melodyPresetName: "★ Vocal Lead",
  rootNote: 0, rootName: "C", scaleName: "Minor",
  // Scale degrees in C Minor: 0=C, 1=D, 2=Eb, 3=F, 4=G, 5=Ab, 6=Bb
  // 2 bars per chord, 4 chords = 8 bars × 16 = 128 steps. Use 64 → 1 bar each.
  chordsSteps: pad([
    C(0, "Min7"), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    C(3, "Min7"), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    C(5, "Maj7"), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
    C(6, "Maj"),  XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(), XC(),
  ], 64, XC),
  chordsLength: 64,
  // Slow drone bass — held root through each chord
  bassSteps: pad([
    B(0, { octave: -1 }), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(),
    B(3, { octave: -1 }), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(),
    B(5, { octave: -1 }), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(),
    B(6, { octave: -1 }), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(), X(),
  ], 64, X),
  bassLength: 64,
  // Sparse melody — single notes drifting through the chord changes
  melodySteps: pad([
    XM(), XM(), XM(), XM(), M(4, { octave: 1 }), XM(), XM(), XM(), XM(), XM(), M(2, { octave: 1 }), XM(), XM(), XM(), XM(), XM(),
    XM(), XM(), XM(), XM(), M(0, { octave: 1 }), XM(), XM(), XM(), XM(), XM(), M(5), XM(), XM(), XM(), XM(), XM(),
    XM(), XM(), XM(), XM(), M(2, { octave: 1 }), XM(), XM(), XM(), XM(), XM(), M(0, { octave: 1 }), XM(), XM(), XM(), XM(), XM(),
    XM(), XM(), XM(), XM(), M(3, { octave: 1 }), XM(), XM(), XM(), XM(), XM(), M(6), XM(), XM(), XM(), XM(), XM(),
  ], 64, XM),
  melodyLength: 64,
};

export const DEMO_SONGS: DemoSong[] = [
  velvetStairs,
  sunsetDrive,
  liquidHours,
  nightBloom,
  cosmicDrift,
];
