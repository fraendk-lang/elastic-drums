/**
 * Melody Generator Engine
 *
 * Guided MIDI composition engine — produces musically coherent patterns from
 * style / role / key / mode / parameter combinations. Not random noise; every
 * generated pattern follows scale theory, style-specific rhythmic templates,
 * and melodic phrasing conventions.
 *
 * Supported styles: HarbourGlow (trip-hop), Ambient, Deep House, Electronica, Smooth Jazz
 * Supported roles:  Chords, Bass, Melody, Arp, Drums
 */

import type { PianoRollNote } from "../components/PianoRoll/types";

// ─── Exported types ───────────────────────────────────────────────────────────

export type GenStyle = "harbourGlow" | "ambient" | "deepHouse" | "electronica" | "smoothJazz";
export type GenRole  = "chords" | "bass" | "melody" | "arp" | "drums";
export type GenMode  = "minor" | "dorian" | "phrygian" | "major" | "mixolydian" | "pentatonicMinor";

export const STYLE_META: Record<GenStyle, { name: string; tagline: string; color: string }> = {
  harbourGlow: { name: "HarbourGlow",  tagline: "Trip-Hop · Bristol 90s · Noir",   color: "#6366f1" },
  ambient:     { name: "Ambient",      tagline: "Open · Atmospheric · Floating",   color: "#22d3ee" },
  deepHouse:   { name: "Deep House",   tagline: "Funky · Soulful · 4-on-the-floor",color: "#f59e0b" },
  electronica: { name: "Electronica",  tagline: "Synth · Textured · Rhythmic",     color: "#10b981" },
  smoothJazz:  { name: "Smooth Jazz",  tagline: "Groove · Soulful · Late Night",   color: "#f97316" },
};

export const ROLE_META: Record<GenRole, { name: string; icon: string }> = {
  chords:  { name: "Chords",  icon: "♩♩" },
  bass:    { name: "Bass",    icon: "♩"  },
  melody:  { name: "Melody",  icon: "♪"  },
  arp:     { name: "Arp",     icon: "♫"  },
  drums:   { name: "Drums",   icon: "▣"  },
};

export const MODE_META: Record<GenMode, { name: string; label: string }> = {
  minor:          { name: "Minor",      label: "Natural Minor (Aeolian)" },
  dorian:         { name: "Dorian",     label: "Dorian (minor w/ maj6)" },
  phrygian:       { name: "Phrygian",   label: "Phrygian (Spanish feel)" },
  major:          { name: "Major",      label: "Major (Ionian)" },
  mixolydian:     { name: "Mixolydian", label: "Mixolydian (major w/ min7)" },
  pentatonicMinor:{ name: "Pent. Min",  label: "Pentatonic Minor" },
};

export const KEYS = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"] as const;
export type GenKey = typeof KEYS[number];

export interface GeneratorParams {
  style:      GenStyle;
  role:       GenRole;
  key:        GenKey;
  mode:       GenMode;
  bpm:        number;   // 60–180
  swing:      number;   // 50–70 (%)
  bars:       2 | 4 | 8 | 16;
  complexity: number;   // 1–5
  mood:       number;   // 0–1 (calm → tense)
  density:    number;   // 0–1 (sparse → dense)
  humanize:   number;   // 0–1
}

export interface GeneratedPattern {
  id:        string;
  name:      string;
  params:    GeneratorParams;
  notes:     PianoRollNote[];
  createdAt: number;
}

// Style-tuned defaults
export const STYLE_DEFAULTS: Record<GenStyle, Omit<GeneratorParams, "role">> = {
  harbourGlow: { style:"harbourGlow", key:"D",  mode:"dorian",         bpm:84,  swing:59, bars:4, complexity:2, mood:0.3, density:0.35, humanize:0.5 },
  ambient:     { style:"ambient",     key:"C",  mode:"major",          bpm:68,  swing:50, bars:8, complexity:1, mood:0.1, density:0.2,  humanize:0.3 },
  deepHouse:   { style:"deepHouse",   key:"Ab", mode:"minor",          bpm:122, swing:53, bars:4, complexity:3, mood:0.5, density:0.55, humanize:0.3 },
  electronica: { style:"electronica", key:"G",  mode:"pentatonicMinor",bpm:128, swing:50, bars:4, complexity:3, mood:0.6, density:0.6,  humanize:0.2 },
  smoothJazz:  { style:"smoothJazz",  key:"Bb", mode:"dorian",         bpm:96,  swing:63, bars:4, complexity:3, mood:0.35,density:0.45, humanize:0.55 },
};

// ─── Scale / harmony utilities ────────────────────────────────────────────────

const KEY_SEMITONE: Record<GenKey, number> = {
  C:0, Db:1, D:2, Eb:3, E:4, F:5, Gb:6, G:7, Ab:8, A:9, Bb:10, B:11,
};

const SCALE_INTERVALS: Record<GenMode, number[]> = {
  minor:          [0, 2, 3, 5, 7, 8, 10],
  dorian:         [0, 2, 3, 5, 7, 9, 10],
  phrygian:       [0, 1, 3, 5, 7, 8, 10],
  major:          [0, 2, 4, 5, 7, 9, 11],
  mixolydian:     [0, 2, 4, 5, 7, 9, 10],
  pentatonicMinor:[0, 3, 5, 7, 10],
};

/** Build all MIDI notes in the given scale across the full useful range */
function buildScale(key: GenKey, mode: GenMode): number[] {
  const root = KEY_SEMITONE[key];
  const intervals = SCALE_INTERVALS[mode];
  const notes: number[] = [];
  for (let oct = 1; oct <= 8; oct++) {
    for (const iv of intervals) {
      const midi = oct * 12 + root + iv;
      if (midi >= 24 && midi <= 100) notes.push(midi);
    }
  }
  return notes.sort((a, b) => a - b);
}

/** Filter scale to a given octave range [low, high] inclusive */
function scaleInRange(scale: number[], low: number, high: number): number[] {
  return scale.filter(m => m >= low && m <= high);
}

/** Nearest note in scale to target MIDI */
function nearestScale(midi: number, scale: number[]): number {
  if (scale.length === 0) return midi;
  return scale.reduce((best, n) =>
    Math.abs(n - midi) < Math.abs(best - midi) ? n : best
  );
}

/** Build a diatonic 7th chord from a scale degree (0-indexed) */
function buildChord(degree: number, key: GenKey, mode: GenMode, octave: number): number[] {
  const root = KEY_SEMITONE[key];
  const intervals = SCALE_INTERVALS[mode];
  const n = intervals.length;
  const baseRoot = octave * 12 + root;
  // Stack in 3rds: 1st, 3rd, 5th, 7th degrees of the chord
  return [0, 2, 4, 6].map(offset => {
    const d = (degree + offset) % n;
    const extraOct = Math.floor((degree + offset) / n);
    return baseRoot + intervals[d]! + extraOct * 12;
  }).filter(m => m >= 36 && m <= 96);
}

// ─── Seeded RNG ───────────────────────────────────────────────────────────────

function makeRng(seed: number) {
  let s = (seed | 0) || 1;
  return {
    next(): number {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0xffffffff;
    },
    int(max: number): number { return Math.floor(this.next() * max); },
    choose<T>(arr: T[]): T { return arr[this.int(arr.length)]!; },
    /** Bernoulli trial with probability p */
    chance(p: number): boolean { return this.next() < p; },
    /** Float in [min, max] */
    range(min: number, max: number): number { return min + this.next() * (max - min); },
  };
}

// ─── Rhythm templates (16 steps per bar, 1=hit, 0=rest) ──────────────────────
//     Step 0 = beat 1, step 4 = beat 2, step 8 = beat 3, step 12 = beat 4

const PATTERNS = {
  bass: {
    harbourGlow: [
      [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],  // single hit beat 1
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],  // beats 1 & 3
      [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0],  // 1 + 8th pickup
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],  // half-time syncopated
      [1,0,0,0, 0,1,0,0, 1,0,0,0, 0,0,0,1],  // busier
      [1,0,0,0, 0,0,1,0, 1,0,0,1, 0,0,0,0],  // with ghost
    ],
    ambient: [
      [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [1,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    ],
    deepHouse: [
      [1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,1,0],  // funky 16th
      [1,0,1,0, 0,0,1,0, 1,0,0,0, 0,1,0,0],  // choppy
      [1,0,0,0, 1,0,1,0, 0,0,1,0, 1,0,0,0],  // syncopated
      [1,0,0,1, 0,0,1,0, 0,0,1,0, 0,1,0,0],
      [1,0,0,0, 0,1,0,0, 1,0,0,1, 0,0,1,0],
      [1,0,1,0, 0,1,0,0, 0,1,0,0, 1,0,1,0],
    ],
    electronica: [
      [1,0,1,0, 0,1,0,0, 1,0,0,1, 0,0,1,0],
      [1,0,0,1, 0,0,1,0, 1,0,1,0, 0,1,0,0],
      [1,1,0,0, 1,0,1,0, 0,1,0,0, 1,0,1,0],
      [1,0,1,1, 0,0,1,0, 1,1,0,0, 0,1,0,1],
      [0,1,0,1, 1,0,0,1, 0,1,1,0, 1,0,0,1],
      [1,0,0,0, 1,1,0,1, 0,0,1,0, 1,0,1,0],
    ],
    smoothJazz: [
      [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,1,0,0],  // quarter-note walking feel
      [1,0,1,0, 1,0,0,0, 1,0,1,0, 1,0,0,0],  // 8th-note groove
      [1,0,0,0, 1,0,1,0, 0,0,1,0, 0,0,1,0],  // syncopated
      [1,0,1,0, 0,0,1,0, 1,0,0,0, 0,1,0,0],  // funky jazz
      [1,0,0,1, 0,1,0,0, 1,0,1,0, 0,0,1,0],  // bebop feel
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,0,0],  // walking quarters
    ],
  },
  drums: {
    kick: {
      harbourGlow: [
        [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],  // half-time
        [1,0,0,1, 0,0,0,0, 1,0,0,0, 0,0,0,0],  // with ghost
        [1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,0],  // breakbeat
        [1,0,0,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],  // broken
        [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,0],
      ],
      ambient: [
        [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
        [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      ],
      deepHouse: [
        [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],  // 4-on-floor
        [1,0,0,0, 1,0,1,0, 1,0,0,0, 1,0,0,0],
        [1,0,0,0, 1,0,0,0, 1,0,1,0, 1,0,0,0],
        [1,0,1,0, 1,0,0,0, 1,0,0,0, 1,0,1,0],
      ],
      electronica: [
        [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,1,0,0],
        [1,0,1,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
        [1,0,0,0, 1,0,0,1, 0,0,1,0, 1,0,0,0],
        [0,0,1,0, 0,1,0,0, 1,0,0,1, 0,0,1,0],
      ],
      smoothJazz: [
        [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],  // jazz half-time feel
        [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],  // syncopated
        [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,1,0,0],  // light
        [0,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],  // off-beat
        [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,0],  // shuffle feel
      ],
    },
    snare: {
      harbourGlow: [
        [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],  // snare on 3
        [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],  // with ghost
        [0,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,0],  // anticipation
        [0,0,0,0, 0,0,0,1, 1,0,0,0, 0,0,0,0],
      ],
      ambient: [
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
        [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      ],
      deepHouse: [
        [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],  // 2 + 4
        [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,1,0],
        [0,0,0,0, 1,0,1,0, 0,0,0,0, 1,0,0,1],
        [0,0,1,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
      ],
      electronica: [
        [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        [0,0,1,0, 0,0,1,0, 0,0,0,0, 1,0,0,1],
        [0,0,0,0, 1,0,0,1, 0,1,0,0, 1,0,0,0],
        [0,1,0,0, 0,0,1,0, 0,0,0,1, 1,0,0,0],
      ],
      smoothJazz: [
        [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],  // standard 2+4 (rimshot)
        [0,0,0,0, 1,0,1,0, 0,0,0,0, 1,0,0,1],  // with anticipation
        [0,0,0,0, 1,0,0,0, 0,0,1,0, 1,0,0,0],  // extra hit
        [0,0,1,0, 1,0,0,0, 0,0,0,0, 1,0,1,0],  // shuffle feel
        [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0],  // syncopated
      ],
    },
    hihat: {
      harbourGlow: [
        [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],  // 8ths
        [1,1,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,1],  // choppy 16ths
        [1,0,1,0, 0,0,1,1, 1,0,1,0, 0,1,1,0],  // syncopated swing
        [1,0,0,0, 1,0,1,0, 1,0,0,0, 0,1,0,0],
      ],
      ambient: [
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
        [1,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],
        [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0],
      ],
      deepHouse: [
        [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],  // 16ths
        [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],  // 8ths
        [1,1,1,0, 1,0,1,1, 1,1,1,0, 1,0,1,1],  // groove 16ths
        [1,0,1,1, 0,1,1,0, 1,0,1,1, 0,1,0,1],
      ],
      electronica: [
        [1,0,1,1, 0,1,1,0, 1,0,1,1, 0,1,0,1],
        [1,1,0,1, 1,0,1,0, 1,1,0,1, 0,1,1,0],
        [1,0,0,1, 0,1,0,1, 1,0,0,1, 0,0,1,0],
        [0,1,1,0, 1,0,0,1, 1,0,1,0, 0,1,1,1],
      ],
      smoothJazz: [
        [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],  // quarter-note ride
        [1,1,1,0, 1,0,1,1, 1,1,1,0, 1,0,1,0],  // jazz 8ths swing
        [1,0,0,1, 1,0,1,0, 1,0,0,1, 1,0,1,0],  // swing feel
        [1,1,0,0, 1,1,0,0, 1,1,0,0, 1,1,0,0],  // dotted-8th feel
        [1,0,1,1, 1,0,0,1, 1,0,1,0, 1,0,0,0],  // bebop-ish
      ],
    },
  },
  chord: {
    harbourGlow: [
      [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],  // whole-bar swell
      [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0],  // chord + 8th anticipation
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],  // two half-bar chords
      [1,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,1,0],
    ],
    ambient: [
      [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    ],
    deepHouse: [
      [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],  // offbeat stabs
      [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],  // 8th upbeats
      [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,1,0,0],
      [0,0,0,1, 0,0,1,0, 0,0,0,0, 0,0,1,0],
    ],
    electronica: [
      [1,0,1,0, 0,0,1,0, 1,0,0,0, 0,1,0,0],
      [0,0,1,0, 0,1,0,0, 0,0,1,0, 0,0,1,0],
      [1,0,0,0, 0,0,1,1, 0,0,1,0, 0,1,0,0],
      [0,1,0,0, 1,0,0,1, 0,0,1,0, 0,0,0,1],
    ],
    smoothJazz: [
      [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],  // sparse comping
      [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,1,0,0],  // 3 hits
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],  // on 2 + 4
      [1,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],  // quarter comping
      [0,0,1,0, 0,0,0,0, 0,0,1,0, 0,1,0,0],  // offbeat comping
    ],
  },
  arp: {
    harbourGlow: [
      [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,0],
      [1,0,1,0, 1,0,0,0, 1,0,1,0, 0,0,0,0],
      [1,0,0,0, 0,1,0,0, 1,0,0,0, 0,0,1,0],
    ],
    ambient: [
      [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      [1,0,1,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    ],
    deepHouse: [
      [1,0,1,1, 0,1,0,1, 1,0,1,0, 1,1,0,1],
      [0,1,0,1, 1,0,1,0, 0,1,0,1, 0,1,0,0],
      [1,1,0,1, 0,0,1,0, 1,1,0,0, 0,1,1,0],
    ],
    electronica: [
      [1,0,1,0, 1,0,1,0, 0,1,0,1, 0,1,0,1],
      [1,1,0,1, 0,1,1,0, 1,0,1,1, 0,1,0,0],
      [0,1,1,0, 1,0,0,1, 1,1,0,0, 1,0,1,1],
    ],
    smoothJazz: [
      [1,0,1,0, 1,0,0,0, 1,0,1,0, 0,0,1,0],  // quarter-feel arp
      [1,0,0,1, 0,1,0,0, 1,0,0,1, 0,0,0,0],  // syncopated
      [0,0,1,0, 1,0,0,0, 0,1,0,0, 1,0,1,0],  // offbeat
      [1,0,1,0, 0,0,1,0, 1,0,0,0, 0,1,0,1],  // bossa feel
    ],
  },
};

// Chord progressions (scale degrees, 0-indexed, one chord per bar)
const PROGRESSIONS: Record<GenStyle, number[][]> = {
  harbourGlow: [
    [0, 6, 5, 6],  // i – VII – VI – VII
    [0, 5, 2, 6],  // i – VI – III – VII
    [0, 3, 0, 4],  // i – iv – i – v
    [0, 6, 3, 5],  // i – VII – III – VI
    [0, 2, 6, 5],  // i – III – VII – VI
  ],
  ambient: [
    [0, 4, 5, 0],  // I – V – VI – I
    [0, 5, 3, 4],  // I – VI – IV – V
    [0, 2, 5, 3],  // I – III – VI – IV
    [0, 3, 0, 5],  // I – IV – I – VI
  ],
  deepHouse: [
    [0, 6, 5, 6],
    [0, 3, 6, 5],
    [0, 5, 0, 4],
    [0, 6, 3, 4],
    [0, 2, 5, 4],
  ],
  electronica: [
    [0, 6, 5, 6],
    [0, 5, 3, 4],
    [0, 2, 3, 4],
    [0, 4, 6, 5],
    [0, 3, 5, 2],
  ],
  smoothJazz: [
    [1, 4, 0, 4],   // ii – V – I – V (turnaround)
    [0, 3, 1, 4],   // I – IV – ii – V
    [0, 4, 1, 4],   // I – V – ii – V
    [0, 5, 1, 4],   // I – vi – ii – V
    [1, 4, 0, 3],   // ii – V – I – IV
  ],
};

// Bass note sequences (scale degree offsets used per rhythmic hit in a bar)
const BASS_NOTE_SEQS: Record<GenStyle, number[][]> = {
  harbourGlow: [
    [0, 4, 0, 4],
    [0, 0, 7, 0],
    [0, 3, 0, 10],
    [0, 4, 7, 4],
    [0, 0, 10, 7],
  ],
  ambient: [
    [0, 0, 4, 0],
    [0, 4, 0, 0],
    [0, 0, 0, 7],
    [0, 7, 0, 4],
  ],
  deepHouse: [
    [0, 0, 4, 3],
    [0, 3, 7, 10],
    [0, 0, 7, 5],
    [0, 4, 3, 0],
    [0, 0, 10, 7],
  ],
  electronica: [
    [0, 4, 7, 10],
    [0, 3, 7, 10],
    [0, 0, 4, 7],
    [0, 12, 7, 10],
    [0, 5, 0, 7],
  ],
  smoothJazz: [
    [0, 4, 7, 10],   // root – maj3 – 5th – min7
    [0, 3, 7, 10],   // root – min3 – 5th – min7
    [0, 7, 5, 3],    // descending walk
    [0, 4, 7, 9],    // root – maj3 – 5th – 6th
    [0, 2, 4, 7],    // chromatic-ish approach
    [0, 12, 7, 4],   // octave jump then descend
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _uidCtr = 0;
function uid(): string { return `gen-${Date.now()}-${++_uidCtr}`; }

/**
 * Convert a 16th-note step index to beat position with swing applied.
 * Swing affects 8th-note upbeats (steps 2, 6, 10, 14 in each bar).
 */
function stepToBeat(step: number, swing: number): number {
  const beat = step * 0.25;
  const beatFrac = beat % 1;
  if (Math.abs(beatFrac - 0.5) < 0.001) {
    return Math.floor(beat) + swing / 100;
  }
  return beat;
}

function pickPattern(patterns: number[][], complexity: number, rng: ReturnType<typeof makeRng>): number[] {
  const maxIdx = Math.min(patterns.length - 1, Math.floor(complexity / 5 * patterns.length));
  const idx = rng.int(maxIdx + 1);
  return patterns[idx]!;
}

function humanizeBeat(beat: number, amount: number, rng: ReturnType<typeof makeRng>): number {
  if (amount === 0) return beat;
  const jitter = (rng.next() - 0.5) * 0.06 * amount;
  return Math.max(0, beat + jitter);
}

function humanizeVelocity(vel: number, amount: number, rng: ReturnType<typeof makeRng>): number {
  const jitter = (rng.next() - 0.5) * 0.15 * amount;
  return Math.max(0.05, Math.min(1, vel + jitter));
}

// ─── Role generators ──────────────────────────────────────────────────────────

function generateDrums(p: GeneratorParams, seed: number): PianoRollNote[] {
  const rng = makeRng(seed);
  const notes: PianoRollNote[] = [];
  const style = p.style;
  for (let bar = 0; bar < p.bars; bar++) {
    const barOffset = bar * 4;

    // Kick
    const kickPat = pickPattern(PATTERNS.drums.kick[style], p.complexity, rng);
    kickPat.forEach((hit, step) => {
      if (!hit) return;
      if (rng.chance(1 - p.density * 0.3)) {
        const baseVel = style === "smoothJazz" ? 0.7 : 0.95;
        const vel = humanizeVelocity(step === 0 ? baseVel : baseVel * 0.8, p.humanize, rng);
        notes.push({
          id: uid(), midi: 36, track: "drums",
          start: barOffset + humanizeBeat(stepToBeat(step, p.swing), p.humanize, rng),
          duration: 0.1, velocity: vel,
        });
      }
    });

    // Snare
    const snarePat = pickPattern(PATTERNS.drums.snare[style], p.complexity, rng);
    snarePat.forEach((hit, step) => {
      if (!hit) return;
      const isGhost = step !== 8 && (style === "harbourGlow" || style === "smoothJazz");
      const baseSnare = style === "smoothJazz" ? 0.6 : 0.82; // softer rimshot for jazz
      const vel = humanizeVelocity(isGhost ? 0.3 : baseSnare, p.humanize, rng);
      notes.push({
        id: uid(), midi: 37, track: "drums",
        start: barOffset + humanizeBeat(stepToBeat(step, p.swing), p.humanize, rng),
        duration: 0.1, velocity: vel,
      });
    });

    // Hi-hat / ride (density-gated)
    if (p.density > 0.2) {
      const hhPat = pickPattern(PATTERNS.drums.hihat[style], p.complexity, rng);
      hhPat.forEach((hit, step) => {
        if (!hit) return;
        // Smooth jazz ride is sparser & softer
        const gateProb = style === "smoothJazz"
          ? 0.4 + p.density * 0.3
          : 0.5 + p.density * 0.4;
        if (!rng.chance(gateProb)) return;
        const openHH = step === 6 && style === "harbourGlow" && rng.chance(0.3);
        const baseVel = style === "smoothJazz" ? 0.35 : (openHH ? 0.55 : 0.42);
        const vel = humanizeVelocity(baseVel, p.humanize, rng);
        notes.push({
          id: uid(), midi: openHH ? 43 : 42, track: "drums",
          start: barOffset + humanizeBeat(stepToBeat(step, p.swing), p.humanize, rng),
          duration: 0.1, velocity: vel,
        });
      });
    }

    // Tense mood → ride/cymbal accents
    if (p.mood > 0.6 && rng.chance(p.mood - 0.5)) {
      const rideStep = rng.choose([4, 8, 12]);
      notes.push({
        id: uid(), midi: 44, track: "drums",
        start: barOffset + stepToBeat(rideStep, p.swing),
        duration: 0.1, velocity: 0.38,
      });
    }
  }

  return notes;
}

function generateBass(p: GeneratorParams, progression: number[], seed: number): PianoRollNote[] {
  const rng = makeRng(seed);
  const scale = buildScale(p.key, p.mode);
  const bassRange = scaleInRange(scale, 36, 52);
  const notes: PianoRollNote[] = [];
  const bassPats = PATTERNS.bass[p.style];
  const noteSeqs = BASS_NOTE_SEQS[p.style];

  for (let bar = 0; bar < p.bars; bar++) {
    const barOffset = bar * 4;
    const chordDeg = progression[bar % progression.length]!;
    const rootInterval = SCALE_INTERVALS[p.mode][chordDeg % SCALE_INTERVALS[p.mode].length]!;
    const chordRoot = (KEY_SEMITONE[p.key] + rootInterval) % 12 + 36;
    const chordRootInBass = nearestScale(chordRoot, bassRange);

    const pat = pickPattern(bassPats, p.complexity, rng);
    const noteSeq = rng.choose(noteSeqs);

    let hitIdx = 0;
    pat.forEach((hit, step) => {
      if (!hit) return;
      if (rng.chance(0.3 - p.density * 0.25)) return;

      const seqNote = noteSeq[hitIdx % noteSeq.length]!;
      const targetMidi = chordRootInBass + seqNote;
      const midi = nearestScale(targetMidi, bassRange);

      // Note duration: longer for sparser styles
      const baseDur = p.style === "harbourGlow" ? 0.7
        : p.style === "ambient" ? 1.5
        : p.style === "smoothJazz" ? 0.55
        : 0.5;
      const dur = baseDur + rng.range(0, 0.25);

      notes.push({
        id: uid(), midi, track: "bass",
        start: barOffset + humanizeBeat(stepToBeat(step, p.swing), p.humanize, rng),
        duration: dur,
        velocity: humanizeVelocity(0.78, p.humanize, rng),
      });
      hitIdx++;
    });
  }

  return notes;
}

function generateChords(p: GeneratorParams, progression: number[], seed: number): PianoRollNote[] {
  const rng = makeRng(seed);
  const notes: PianoRollNote[] = [];
  const chordPats = PATTERNS.chord[p.style];
  const chordOctave = 5;

  for (let bar = 0; bar < p.bars; bar++) {
    const barOffset = bar * 4;
    const degree = progression[bar % progression.length]!;
    const chordMidis = buildChord(degree, p.key, p.mode, chordOctave);
    const pat = pickPattern(chordPats, p.complexity, rng);

    let prevHit = false;
    pat.forEach((hit, step) => {
      if (!hit) return;
      if (prevHit && step < 3) return;
      prevHit = true;

      const nextHitStep = pat.findIndex((v, i) => i > step && v === 1);
      const durSteps = nextHitStep >= 0 ? nextHitStep - step : stepsInBar - step;
      const dur = Math.max(0.5, durSteps * 0.25 - 0.05);

      chordMidis.forEach((midi, i) => {
        const baseVel = i === 0 ? 0.72 : i === 1 ? 0.65 : 0.55;
        notes.push({
          id: uid(), midi, track: "chords",
          start: barOffset + humanizeBeat(stepToBeat(step, p.swing), p.humanize * 0.3, rng),
          duration: dur,
          velocity: humanizeVelocity(baseVel, p.humanize * 0.4, rng),
        });
      });
    });
  }

  return notes;
}

const stepsInBar = 16;

function generateMelody(p: GeneratorParams, _progression: number[], seed: number): PianoRollNote[] {
  const rng = makeRng(seed);
  const notes: PianoRollNote[] = [];
  // Smooth jazz: dorian + blue notes (use the params mode itself)
  const melMode: GenMode = p.style === "ambient"
    ? "major"
    : p.style === "smoothJazz"
      ? "dorian"
      : "pentatonicMinor";
  const scale = buildScale(p.key, melMode);
  const melRange = scaleInRange(scale, 60, 84);
  if (melRange.length === 0) return notes;

  let prevMidi = melRange[Math.floor(melRange.length / 2)]!;

  for (let bar = 0; bar < p.bars; bar++) {
    const barOffset = bar * 4;

    if (p.style === "harbourGlow") {
      // Trip-hop melody: sparse 2-bar phrases
      if (bar % 2 === 0) {
        const phraseLen = rng.int(3) + 2;
        const phraseSteps = [0, 3, 6, 10, 13];
        for (let i = 0; i < phraseLen; i++) {
          const step = phraseSteps[i]!;
          const direction = i < phraseLen / 2 ? 1 : -1;
          const move = direction * rng.int(3);
          const targetIdx = Math.max(0, Math.min(melRange.length - 1,
            melRange.indexOf(prevMidi) + move
          ));
          const midi = melRange[targetIdx] ?? prevMidi;
          prevMidi = midi;

          const dur = rng.choose([0.5, 0.75, 1.0, 1.5]);
          notes.push({
            id: uid(), midi, track: "melody",
            start: barOffset + stepToBeat(step, p.swing),
            duration: dur,
            velocity: humanizeVelocity(i === 0 ? 0.8 : 0.7, p.humanize, rng),
          });
        }
      }
    } else if (p.style === "smoothJazz") {
      // Smooth Jazz melody: bebop-feel, legato, syncopated phrases
      // Phrases tend to start on offbeats; use 8th-note pulse with rests
      const phraseSteps = [0, 2, 4, 6, 7, 9, 10, 12, 14];
      // density param: 0.45 default → ~5 notes per bar
      const noteCount = Math.round(3 + p.density * 6);
      const chosenSteps: number[] = [];
      for (const s of phraseSteps) {
        if (rng.chance(0.45 + p.density * 0.4)) chosenSteps.push(s);
      }
      const selected = chosenSteps.slice(0, noteCount);

      for (let i = 0; i < selected.length; i++) {
        const step = selected[i]!;
        // Bebop-style stepwise motion (mostly) with occasional leaps
        const isLeap = rng.chance(0.2);
        const move = isLeap
          ? rng.choose([-3, -2, 2, 3])
          : rng.choose([-2, -1, -1, 1, 1, 2]);
        const curIdx = melRange.indexOf(prevMidi);
        const newIdx = Math.max(0, Math.min(melRange.length - 1, curIdx + move));
        const midi = melRange[newIdx] ?? prevMidi;
        prevMidi = midi;

        // Legato — duration roughly fills until next note
        const nextStep = selected[i + 1] ?? step + 4;
        const durBeats = Math.max(0.25, (nextStep - step) * 0.25 - 0.05);

        notes.push({
          id: uid(), midi, track: "melody",
          start: barOffset + humanizeBeat(stepToBeat(step, p.swing), p.humanize, rng),
          duration: durBeats,
          velocity: humanizeVelocity(0.7, p.humanize, rng),
        });
      }
    } else {
      // Other styles: density-driven melody
      const noteCount = Math.round(2 + p.density * 6);
      const availSteps = [0, 2, 4, 6, 8, 10, 12, 14].filter(() => rng.chance(p.density * 0.8 + 0.2));
      const selectedSteps = availSteps.slice(0, noteCount);

      for (const step of selectedSteps) {
        const move = (rng.next() - 0.5) * 4 * p.complexity;
        const curIdx = melRange.indexOf(prevMidi);
        const newIdx = Math.max(0, Math.min(melRange.length - 1, Math.round(curIdx + move)));
        const midi = melRange[newIdx] ?? prevMidi;
        prevMidi = midi;

        const dur = rng.choose([0.25, 0.5, 0.5, 0.75, 1.0]);
        notes.push({
          id: uid(), midi, track: "melody",
          start: barOffset + humanizeBeat(stepToBeat(step, p.swing), p.humanize, rng),
          duration: dur,
          velocity: humanizeVelocity(0.72, p.humanize, rng),
        });
      }
    }
  }

  return notes;
}

function generateArp(p: GeneratorParams, progression: number[], seed: number): PianoRollNote[] {
  const rng = makeRng(seed);
  const notes: PianoRollNote[] = [];
  const arpRange = scaleInRange(buildScale(p.key, p.mode), 55, 79);
  const arpPats = PATTERNS.arp[p.style];

  const ARP_DIRECTIONS: ("up" | "down" | "updown")[] = ["up", "down", "updown"];
  const direction = rng.choose(ARP_DIRECTIONS);

  for (let bar = 0; bar < p.bars; bar++) {
    const barOffset = bar * 4;
    const degree = progression[bar % progression.length]!;
    const chordMidis = buildChord(degree, p.key, p.mode, 5)
      .filter(m => m >= 55 && m <= 80);
    if (chordMidis.length === 0) continue;

    const pat = pickPattern(arpPats, p.complexity, rng);
    let noteIdx = 0;

    pat.forEach((hit, step) => {
      if (!hit) return;
      let midi: number;
      const n = chordMidis.length;
      if (direction === "up") {
        midi = chordMidis[noteIdx % n]!;
      } else if (direction === "down") {
        midi = chordMidis[(n - 1) - (noteIdx % n)]!;
      } else {
        const cycle = n * 2 - 2;
        const pos = noteIdx % cycle;
        midi = pos < n ? chordMidis[pos]! : chordMidis[cycle - pos]!;
      }

      const nearMidi = nearestScale(midi, arpRange);
      notes.push({
        id: uid(), midi: nearMidi, track: "melody",
        start: barOffset + humanizeBeat(stepToBeat(step, p.swing), p.humanize * 0.5, rng),
        duration: 0.22,
        velocity: humanizeVelocity(0.65, p.humanize, rng),
      });
      noteIdx++;
    });
  }

  return notes;
}

// ─── Main API ─────────────────────────────────────────────────────────────────

export function generatePattern(params: GeneratorParams): GeneratedPattern {
  const seed = Date.now() ^ (Math.random() * 0xffffffff);
  const rng = makeRng(seed);

  const progs = PROGRESSIONS[params.style];
  const progression = rng.choose(progs);
  const fullProg: number[] = [];
  for (let i = 0; i < params.bars; i++) fullProg.push(progression[i % progression.length]!);

  let notes: PianoRollNote[] = [];

  switch (params.role) {
    case "drums":  notes = generateDrums(params, seed); break;
    case "bass":   notes = generateBass(params, fullProg, seed); break;
    case "chords": notes = generateChords(params, fullProg, seed); break;
    case "melody": notes = generateMelody(params, fullProg, seed); break;
    case "arp":    notes = generateArp(params, fullProg, seed); break;
  }

  const styleName = STYLE_META[params.style].name;
  const roleName  = ROLE_META[params.role].name;
  const name = `${styleName} ${roleName} — ${params.key} ${MODE_META[params.mode].name}`;

  return { id: uid(), name, params, notes, createdAt: Date.now() };
}

/**
 * Generate a controlled variation of an existing pattern.
 */
export function generateVariation(original: GeneratedPattern): GeneratedPattern {
  const seed = Date.now() ^ 0xdeadbeef;
  const rng = makeRng(seed);
  const scale = buildScale(original.params.key, original.params.mode);
  const { humanize, complexity } = original.params;

  const mutated: PianoRollNote[] = original.notes.map(n => {
    const note = { ...n, id: uid() };

    note.velocity = humanizeVelocity(note.velocity, 0.3 + humanize * 0.3, rng);

    if (n.track !== "drums" && rng.chance(0.5)) {
      note.start = humanizeBeat(note.start, 0.2 + humanize * 0.4, rng);
    }

    if (n.track !== "drums" && rng.chance(0.2 * complexity / 5)) {
      const idx = scale.indexOf(nearestScale(note.midi, scale));
      const move = rng.choose([-1, 1]);
      const newMidi = scale[Math.max(0, Math.min(scale.length - 1, idx + move))];
      if (newMidi !== undefined) note.midi = newMidi;
    }

    return note;
  });

  const addGhosts = rng.chance(0.3 + complexity * 0.1);
  const ghosts: PianoRollNote[] = [];
  if (addGhosts && original.params.role === "drums") {
    original.notes
      .filter(n => n.midi === 37)
      .slice(0, 2)
      .forEach(n => {
        const ghostBeat = n.start - 0.5;
        if (ghostBeat >= 0 && rng.chance(0.5)) {
          ghosts.push({ ...n, id: uid(), start: ghostBeat, velocity: 0.2 + rng.next() * 0.15 });
        }
      });
  }

  const name = `${original.name} (Variation)`;
  return {
    id: uid(),
    name,
    params: original.params,
    notes: [...mutated, ...ghosts].sort((a, b) => a.start - b.start),
    createdAt: Date.now(),
  };
}
