/**
 * Arpeggiator — generates arpeggiated note sequences from held chords.
 * Ported from Elastic Groove, adapted for Elastic Drum's scheduler system.
 *
 * Architecture:
 *   - Takes a base MIDI note and timing parameters
 *   - Expands into rapid sub-step notes following a pattern (up/down/updown/random)
 *   - Returns timed note events for the MelodyEngine's scheduler
 *   - Supports 1-4 octave ranges
 *   - Respects scale constraints (via BassEngine's SCALES format)
 *
 * Usage: The MelodyEngine's scheduler calls generateArpNotes() to expand
 * a single held note into a sequence of rapid notes following a pattern.
 */

// ── TYPES ──

export type ArpMode =
  | "off"
  | "up"
  | "down"
  | "updown"
  | "downup"
  | "converge"
  | "diverge"
  | "random"
  | "chord";
export type ArpRate = "1/4" | "1/8" | "1/8t" | "1/16" | "1/16t" | "1/32";
export type ArpGate = "short" | "medium" | "long";

export interface ArpSettings {
  mode: ArpMode;
  rate: ArpRate;
  octaves: number;      // 1-4
  gate: ArpGate;
  swing: number;        // 0-0.5, shifts every 2nd substep later (groove)
  skipProb: number;     // 0-1, probability a substep is rested (holes in pattern)
  velDecay: number;     // 0-1, velocity multiplier decay per substep (0 = no decay)
  velocityJitter: number; // 0-1, random ±velocity variation
}

export const DEFAULT_ARP_SETTINGS: ArpSettings = {
  mode: "off",
  rate: "1/8",
  octaves: 2,
  gate: "medium",
  swing: 0,
  skipProb: 0,
  velDecay: 0,
  velocityJitter: 0,
};

// ── RATE & GATE LOOKUP TABLES ──

/**
 * Converts arpeggiator rate notation to a divisor.
 * 1/4 = 1 (full step), 1/8 = 0.5 (half), 1/16 = 0.25 (quarter), etc.
 * Used to calculate sub-step duration from the main step duration.
 */
const ARP_RATES: Record<ArpRate, number> = {
  "1/4": 1,
  "1/8": 0.5,
  "1/8t": 1 / 3,    // Triplet eighths (3 per beat)
  "1/16": 0.25,
  "1/16t": 1 / 6,   // Triplet sixteenths (6 per beat)
  "1/32": 0.125,
};

/**
 * Converts gate (note length) notation to a percentage of sub-step duration.
 * short = 30%, medium = 60%, long = 90%.
 * Affects the release time of each arpeggio note.
 */
const ARP_GATES: Record<ArpGate, number> = {
  short: 0.3,
  medium: 0.6,
  long: 0.9,
};

// ── SCALE SYSTEM (from BassEngine) ──

/**
 * Scale definitions matching BassEngine's SCALES format.
 * Each scale is an array of semitone intervals from the root note.
 * e.g., Major = [0, 2, 4, 5, 7, 9, 11]
 */
export const SCALES: Record<string, number[]> = {
  Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  Major: [0, 2, 4, 5, 7, 9, 11],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "Minor Pent": [0, 3, 5, 7, 10],
  "Major Pent": [0, 2, 4, 7, 9],
  Blues: [0, 3, 5, 6, 7, 10],
  "Harmonic Min": [0, 2, 3, 5, 7, 8, 11],
  "Melodic Min": [0, 2, 3, 5, 7, 9, 11],
  "Whole Tone": [0, 2, 4, 6, 8, 10],
  Diminished: [0, 2, 3, 5, 6, 8, 9, 11],
};

export const ROOT_NOTES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

// ── HELPER FUNCTIONS ──

/**
 * Build a list of all MIDI notes in the given scale for a range of octaves.
 * @param rootMidi - The MIDI note number of the scale root (e.g., 60 for middle C)
 * @param scaleName - The name of the scale (e.g., "Major", "Minor Pent")
 * @param startOctave - Starting octave offset (relative to root's octave)
 * @param endOctave - Ending octave offset (relative to root's octave)
 * @returns Array of MIDI note numbers in ascending order
 */
function getScaleNotes(
  rootMidi: number,
  scaleName: string,
  startOctave: number,
  endOctave: number
): number[] {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"];
  if (!scale || scale.length === 0) {
    return [];
  }

  const notes: number[] = [];
  void (Math.floor(rootMidi / 12)); // Calculate but don't use

  for (let octOffset = startOctave; octOffset <= endOctave; octOffset++) {
    for (const interval of scale) {
      const note = rootMidi + interval + octOffset * 12;
      notes.push(note);
    }
  }

  return notes.sort((a, b) => a - b);
}

// ── MAIN ARPEGGIATOR FUNCTION ──

export interface ArpNote {
  offset: number;    // Time offset in seconds from start
  note: number;      // MIDI note number
  duration: number;  // Note duration in seconds
  velocity: number;  // 0-1 velocity
}

/**
 * Generate arpeggio notes for a single scheduler step.
 *
 * @param baseNote - MIDI note to arpeggiate (e.g., 60 for middle C)
 * @param stepDuration - Duration of the current scheduler step in seconds
 * @param settings - ArpSettings object (mode, rate, octaves, gate)
 * @param scaleName - Name of the scale (e.g., "Major", "Minor Pent")
 * @param rootMidi - MIDI note number of the scale root (e.g., 60 for C)
 *
 * @returns Array of {offset, note, duration} for each arpeggio event within this step.
 *          If arp is off, returns a single note event.
 *
 * @example
 *   const notes = generateArpNotes(
 *     60,           // middle C
 *     0.5,          // half-second step
 *     { mode: "up", rate: "1/8", octaves: 2, gate: "medium" },
 *     "Major",
 *     60            // root is middle C
 *   );
 *   // Returns something like:
 *   // [
 *   //   { offset: 0.0, note: 60, duration: 0.15 },
 *   //   { offset: 0.25, note: 62, duration: 0.15 },
 *   //   { offset: 0.5, note: 64, duration: 0.15 },
 *   //   ...
 *   // ]
 */
export function generateArpNotes(
  baseNote: number,
  stepDuration: number,
  settings: ArpSettings,
  scaleName: string,
  rootMidi: number,
  baseVelocity = 0.85,
  extraChordNotes: number[] = []  // For "chord" mode or multi-note input (held chord)
): ArpNote[] {
  const { mode, rate, octaves, gate, swing, skipProb, velDecay, velocityJitter } = settings;

  // Arpeggiator off: return a single note event for the entire step
  if (mode === "off") {
    return [{ offset: 0, note: baseNote, duration: stepDuration, velocity: baseVelocity }];
  }

  // Compute sub-step timing
  const rateDiv = ARP_RATES[rate];
  const gateRatio = ARP_GATES[gate];
  const subStepDuration = stepDuration * rateDiv;
  const noteDuration = subStepDuration * gateRatio;
  const numSubSteps = Math.max(1, Math.floor(1 / rateDiv));

  // Pool of notes to arpeggiate. If caller provided extraChordNotes (e.g. a held
  // chord [root, 3rd, 5th]), use those spread across octaves. Otherwise build
  // from scale.
  let poolBase: number[];
  if (extraChordNotes.length > 0) {
    poolBase = [...new Set(extraChordNotes)].sort((a, b) => a - b);
  } else {
    const baseOctave = Math.floor(baseNote / 12);
    const scaleNotes = getScaleNotes(rootMidi, scaleName, baseOctave - 1, baseOctave - 1 + octaves);
    if (scaleNotes.length === 0) {
      return [{ offset: 0, note: baseNote, duration: noteDuration, velocity: baseVelocity }];
    }
    poolBase = scaleNotes.filter((n) => n >= baseNote && n < baseNote + octaves * 12);
    if (poolBase.length === 0) {
      return [{ offset: 0, note: baseNote, duration: noteDuration, velocity: baseVelocity }];
    }
  }

  // Expand pool across octaves when user specified extraChordNotes (chord mode)
  const pool: number[] = [];
  if (extraChordNotes.length > 0) {
    for (let o = 0; o < octaves; o++) {
      for (const n of poolBase) pool.push(n + o * 12);
    }
  } else {
    pool.push(...poolBase);
  }
  pool.sort((a, b) => a - b);

  // Generate note sequence based on mode
  let noteSequence: number[];
  switch (mode) {
    case "up":
      noteSequence = [...pool];
      break;
    case "down":
      noteSequence = [...pool].reverse();
      break;
    case "updown": {
      const up = [...pool];
      const down = [...pool].reverse().slice(1, -1);
      noteSequence = [...up, ...down];
      break;
    }
    case "downup": {
      const down = [...pool].reverse();
      const up = [...pool].slice(1, -1);
      noteSequence = [...down, ...up];
      break;
    }
    case "converge": {
      // Outside-in: lowest, highest, 2nd-lowest, 2nd-highest ...
      const seq: number[] = [];
      let lo = 0, hi = pool.length - 1;
      while (lo <= hi) {
        seq.push(pool[lo]!);
        if (hi !== lo) seq.push(pool[hi]!);
        lo++;
        hi--;
      }
      noteSequence = seq;
      break;
    }
    case "diverge": {
      // Inside-out from center
      const mid = Math.floor(pool.length / 2);
      const seq: number[] = [pool[mid]!];
      for (let i = 1; i <= mid; i++) {
        if (mid - i >= 0) seq.push(pool[mid - i]!);
        if (mid + i < pool.length) seq.push(pool[mid + i]!);
      }
      noteSequence = seq;
      break;
    }
    case "random":
      noteSequence = Array(numSubSteps)
        .fill(0)
        .map(() => pool[Math.floor(Math.random() * pool.length)]!);
      break;
    case "chord":
      // "Chord" mode = strum: fire all pool notes simultaneously on each substep
      noteSequence = [-1]; // Sentinel, handled below
      break;
    default:
      noteSequence = [baseNote];
  }

  // Map note sequence to timed events with swing + skip + velocity decay
  const result: ArpNote[] = [];
  for (let i = 0; i < numSubSteps; i++) {
    // Skip probability — random holes for organic feel
    if (skipProb > 0 && Math.random() < skipProb) continue;

    // Swing: shift every other substep later (0-50% of substep length)
    const swingOffset = (i % 2 === 1) ? subStepDuration * swing : 0;
    const t = i * subStepDuration + swingOffset;

    // Velocity: decay per-step + optional random jitter
    const decayFactor = Math.max(0.2, 1 - (velDecay * (i / Math.max(1, numSubSteps - 1))));
    const jitter = velocityJitter > 0 ? (Math.random() - 0.5) * velocityJitter : 0;
    const vel = Math.max(0.05, Math.min(1, baseVelocity * decayFactor + jitter));

    if (mode === "chord") {
      // Strum all pool notes simultaneously
      for (const n of pool) {
        result.push({ offset: t, note: n, duration: noteDuration, velocity: vel });
      }
    } else {
      const note = noteSequence[i % noteSequence.length] ?? baseNote;
      result.push({ offset: t, note, duration: noteDuration, velocity: vel });
    }
  }

  return result;
}

// ── UTILITY FUNCTIONS ──

/**
 * Check if a MIDI note is in the given scale.
 * @param midiNote - MIDI note number to check
 * @param rootMidi - MIDI note number of the scale root
 * @param scaleName - Name of the scale
 * @returns true if the note is in the scale, false otherwise
 */
export function isNoteInScale(
  midiNote: number,
  rootMidi: number,
  scaleName: string
): boolean {
  const scale = SCALES[scaleName];
  if (!scale) return true; // Treat unknown scales as chromatic (all notes valid)

  // Calculate semitone distance from root
  void (Math.floor(rootMidi / 12)); // Calculate but don't use
  const rootClass = rootMidi % 12;
  void (Math.floor(midiNote / 12)); // Calculate but don't use
  const noteClass = midiNote % 12;

  // Check if note class is in the scale
  const offset = (noteClass - rootClass + 12) % 12;
  return scale.includes(offset);
}

/**
 * Quantize a MIDI note to the nearest scale degree.
 * @param midiNote - MIDI note to quantize
 * @param rootMidi - MIDI note number of the scale root
 * @param scaleName - Name of the scale
 * @returns Quantized MIDI note number
 */
export function quantizeToScale(
  midiNote: number,
  rootMidi: number,
  scaleName: string
): number {
  const scale = SCALES[scaleName];
  if (!scale) return midiNote;

  void (Math.floor(rootMidi / 12)); // Calculate but don't use
  const rootClass = rootMidi % 12;
  const noteOctave = Math.floor(midiNote / 12);
  const noteClass = midiNote % 12;

  // Find nearest scale degree
  const offset = (noteClass - rootClass + 12) % 12;
  let minDist = 12;
  let bestInterval = 0;

  for (const interval of scale) {
    const dist = Math.min(Math.abs(offset - interval), 12 - Math.abs(offset - interval));
    if (dist < minDist) {
      minDist = dist;
      bestInterval = interval;
    }
  }

  return noteOctave * 12 + ((bestInterval + rootClass) % 12);
}
