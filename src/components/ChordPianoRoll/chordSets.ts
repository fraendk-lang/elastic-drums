// src/components/ChordPianoRoll/chordSets.ts

export type ChordSetId =
  | "neo-soul-7ths"
  | "pop-triads"
  | "jazz-voicings"
  | "spread-voicings"
  | "power-chords"
  | "shell-voicings"
  | "trip-hop"
  | "deep-house"
  | "custom";

/** Scale degree within a diatonic scale (0 = root, 6 = leading tone). */
export type ScaleDegree = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** For each scale degree (0–6): semitone offsets from the chord root pitch. */
export type ChordSetVoicing = Record<ScaleDegree, number[]>;

export interface ChordSetDef {
  id: ChordSetId;
  label: string;
  description: string;
  voicings: ChordSetVoicing;
}

export const CHORD_SETS: Record<ChordSetId, ChordSetDef> = {
  "neo-soul-7ths": {
    id: "neo-soul-7ths",
    label: "Neo Soul 7ths",
    description: "min9 · maj9 · dom9 — 5-tone voicings",
    voicings: {
      0: [0, 3, 7, 10, 14],   // min9  (i)
      1: [0, 3, 6, 10, 14],   // min9♭5 (ii°)
      2: [0, 4, 7, 11, 14],   // maj9  (III)
      3: [0, 3, 7, 10, 14],   // min9  (iv)
      4: [0, 4, 7, 10, 14],   // dom9  (V)
      5: [0, 4, 7, 11, 14],   // maj9  (VI)
      6: [0, 4, 7, 10],       // dom7  (VII)
    },
  },
  "pop-triads": {
    id: "pop-triads",
    label: "Pop Triads",
    description: "min · maj · dim — 3-tone voicings",
    voicings: {
      0: [0, 3, 7],   // min
      1: [0, 3, 6],   // dim
      2: [0, 4, 7],   // maj
      3: [0, 3, 7],   // min
      4: [0, 4, 7],   // maj
      5: [0, 4, 7],   // maj
      6: [0, 3, 7],   // min
    },
  },
  "jazz-voicings": {
    id: "jazz-voicings",
    label: "Jazz Voicings",
    description: "min11 · maj13 · 7alt — complex voicings",
    voicings: {
      0: [0, 3, 7, 10, 14, 17],   // min11
      1: [0, 3, 6, 10, 14, 17],   // min11♭5
      2: [0, 4, 7, 11, 14, 21],   // maj13
      3: [0, 3, 7, 10, 14, 17],   // min11
      4: [0, 4, 7, 10, 13, 18],   // 7alt (♭9 ♯11)
      5: [0, 4, 7, 11, 14, 21],   // maj13
      6: [0, 4, 7, 10, 13],       // 7♭9
    },
  },
  "spread-voicings": {
    id: "spread-voicings",
    label: "Spread Voicings",
    description: "min9 · maj9 · dom9 — 2-octave spread",
    voicings: {
      0: [0, 7, 10, 15, 26],   // min9 spread
      1: [0, 7, 10, 15, 27],   // min9♭5 spread
      2: [0, 7, 11, 16, 26],   // maj9 spread
      3: [0, 7, 10, 15, 26],   // min9 spread
      4: [0, 7, 10, 16, 26],   // dom9 spread
      5: [0, 7, 11, 16, 26],   // maj9 spread
      6: [0, 7, 10, 16],       // dom7 spread
    },
  },
  "power-chords": {
    id: "power-chords",
    label: "Power Chords",
    description: "1+5+oct — dense power",
    voicings: {
      0: [0, 7, 12],
      1: [0, 7, 12],
      2: [0, 7, 12],
      3: [0, 7, 12],
      4: [0, 7, 12],
      5: [0, 7, 12],
      6: [0, 7, 12],
    },
  },
  "shell-voicings": {
    id: "shell-voicings",
    label: "Shell Voicings",
    description: "1+m3+m7 · 1+M3+M7 · 1+M3+m7 — jazz minimal",
    voicings: {
      0: [0, 3, 10],   // 1+m3+m7
      1: [0, 3, 10],   // 1+m3+m7 (same as i — minor shell on supertonic)
      2: [0, 4, 11],   // 1+M3+M7
      3: [0, 3, 10],   // 1+m3+m7
      4: [0, 4, 10],   // 1+M3+m7 (dominant shell)
      5: [0, 4, 11],   // 1+M3+M7
      6: [0, 4, 10],   // 1+M3+m7
    },
  },
  "trip-hop": {
    id: "trip-hop",
    label: "Trip Hop",
    description: "min7 · dim7 · maj7♭5 · sus4 — dark, Bristol",
    voicings: {
      0: [0, 3, 7, 10],    // min7
      1: [0, 3, 6, 9],     // dim7 (fully diminished)
      2: [0, 4, 6, 11],    // maj7♭5
      3: [0, 3, 7, 10],    // min7
      4: [0, 5, 7],        // sus4
      5: [0, 4, 6, 11],    // maj7♭5
      6: [0, 3, 6, 9],     // dim7
    },
  },
  "deep-house": {
    id: "deep-house",
    label: "Deep House",
    description: "min11 · maj9 · dom7sus4 — floating, Chicago",
    voicings: {
      0: [0, 3, 7, 10, 14, 17],   // min11
      1: [0, 3, 7, 10, 14],       // min9
      2: [0, 4, 7, 11, 14],       // maj9
      3: [0, 3, 7, 10, 14, 17],   // min11
      4: [0, 5, 7, 10],           // dom7sus4
      5: [0, 4, 7, 14],           // add9
      6: [0, 5, 7, 10],           // dom7sus4
    },
  },
  "custom": {
    id: "custom",
    label: "Custom",
    description: "Freely configurable",
    voicings: {
      0: [0, 3, 7, 10, 14],   // default: Neo Soul 7ths
      1: [0, 3, 6, 10, 14],
      2: [0, 4, 7, 11, 14],
      3: [0, 3, 7, 10, 14],
      4: [0, 4, 7, 10, 14],
      5: [0, 4, 7, 11, 14],
      6: [0, 4, 7, 10],
    },
  },
};

export const CHORD_SET_IDS: ChordSetId[] = [
  "neo-soul-7ths",
  "pop-triads",
  "jazz-voicings",
  "spread-voicings",
  "power-chords",
  "shell-voicings",
  "trip-hop",
  "deep-house",
  "custom",
];
