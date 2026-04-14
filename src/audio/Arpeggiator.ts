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

export type ArpMode = "off" | "up" | "down" | "updown" | "random";
export type ArpRate = "1/4" | "1/8" | "1/16" | "1/32";
export type ArpGate = "short" | "medium" | "long";

export interface ArpSettings {
  mode: ArpMode;
  rate: ArpRate;
  octaves: number; // 1-4
  gate: ArpGate;
}

export const DEFAULT_ARP_SETTINGS: ArpSettings = {
  mode: "off",
  rate: "1/8",
  octaves: 2,
  gate: "medium",
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
  "1/16": 0.25,
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
  offset: number; // Time offset in seconds from start
  note: number; // MIDI note number
  duration: number; // Note duration in seconds
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
  rootMidi: number
): ArpNote[] {
  const { mode, rate, octaves, gate } = settings;

  // Arpeggiator off: return a single note event for the entire step
  if (mode === "off") {
    return [{ offset: 0, note: baseNote, duration: stepDuration }];
  }

  // Compute sub-step timing
  const rateDiv = ARP_RATES[rate];
  const gateRatio = ARP_GATES[gate];
  const subStepDuration = stepDuration * rateDiv;
  const noteDuration = subStepDuration * gateRatio;
  const numSubSteps = Math.floor(1 / rateDiv);

  // Build scale notes
  const baseOctave = Math.floor(baseNote / 12);
  const scaleNotes = getScaleNotes(rootMidi, scaleName, baseOctave - 1, baseOctave - 1 + octaves);

  if (scaleNotes.length === 0) {
    return [{ offset: 0, note: baseNote, duration: noteDuration }];
  }

  // Find base index in scale
  const baseIndex = scaleNotes.findIndex((n) => n >= baseNote);
  if (baseIndex < 0) {
    return [{ offset: 0, note: baseNote, duration: noteDuration }];
  }

  // Get available notes starting from baseNote and within the octave range
  const availableNotes = scaleNotes.filter(
    (n) => n >= baseNote && n < baseNote + octaves * 12
  );

  if (availableNotes.length === 0) {
    return [{ offset: 0, note: baseNote, duration: noteDuration }];
  }

  // Generate note sequence based on mode
  let noteSequence: number[];

  switch (mode) {
    case "up": {
      noteSequence = [...availableNotes];
      break;
    }

    case "down": {
      noteSequence = [...availableNotes].reverse();
      break;
    }

    case "updown": {
      const up = [...availableNotes];
      const down = [...availableNotes].reverse().slice(1, -1);
      noteSequence = [...up, ...down];
      break;
    }

    case "random": {
      noteSequence = Array(numSubSteps)
        .fill(0)
        .map(() => availableNotes[Math.floor(Math.random() * availableNotes.length)]!);
      break;
    }

    default:
      noteSequence = [baseNote];
  }

  // Map note sequence to timed events
  const result: ArpNote[] = [];
  for (let i = 0; i < numSubSteps; i++) {
    const note = noteSequence[i % noteSequence.length] ?? baseNote;
    result.push({
      offset: i * subStepDuration,
      note,
      duration: noteDuration,
    });
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
