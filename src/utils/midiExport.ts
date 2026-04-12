/**
 * MIDI File Export
 *
 * Converts a pattern to a Standard MIDI File (Type 0, single track).
 * Uses GM Drum Map note mapping on Channel 10.
 * Generates a downloadable .mid file.
 */

import type { PatternData } from "../store/drumStore";

// GM Drum Map: voice index → MIDI note
const VOICE_TO_NOTE = [
  36, // 0: Kick  → C1
  38, // 1: Snare → D1
  39, // 2: Clap  → D#1
  41, // 3: Tom L → F1
  43, // 4: Tom M → G1
  45, // 5: Tom H → A1
  42, // 6: HH Cl → F#1
  46, // 7: HH Op → A#1
  49, // 8: Cym   → C#2
  51, // 9: Ride  → D#2
  37, // 10: Prc1 → C#1
  40, // 11: Prc2 → E1
];

const TICKS_PER_QUARTER = 480;
const TICKS_PER_16TH = TICKS_PER_QUARTER / 4; // 120 ticks

// Write variable-length quantity (VLQ)
function writeVLQ(value: number): number[] {
  if (value < 0) value = 0;
  if (value <= 0x7f) return [value];

  const bytes: number[] = [];
  bytes.push(value & 0x7f);
  value >>= 7;
  while (value > 0) {
    bytes.push((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return bytes.reverse();
}

// Write 16-bit big-endian
function write16(val: number): number[] {
  return [(val >> 8) & 0xff, val & 0xff];
}

// Write 32-bit big-endian
function write32(val: number): number[] {
  return [(val >> 24) & 0xff, (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff];
}

export function patternToMidi(pattern: PatternData, bpm: number): Uint8Array {
  // Collect all note events
  interface NoteEvent {
    tick: number;
    note: number;
    velocity: number;
    duration: number; // in ticks
  }

  const events: NoteEvent[] = [];

  for (let track = 0; track < 12; track++) {
    const trackData = pattern.tracks[track];
    if (!trackData) continue;
    const note = VOICE_TO_NOTE[track]!;

    for (let step = 0; step < pattern.length; step++) {
      const s = trackData.steps[step];
      if (!s?.active) continue;

      const tick = step * TICKS_PER_16TH;
      const vel = Math.max(1, Math.min(127, s.velocity));
      const ratchets = s.ratchetCount ?? 1;

      if (ratchets <= 1) {
        events.push({ tick, note, velocity: vel, duration: TICKS_PER_16TH - 1 });
      } else {
        const subTick = TICKS_PER_16TH / ratchets;
        for (let r = 0; r < ratchets; r++) {
          const rVel = Math.max(1, Math.round(vel * (1 - r * 0.15)));
          events.push({
            tick: tick + Math.round(r * subTick),
            note,
            velocity: rVel,
            duration: Math.round(subTick * 0.8),
          });
        }
      }
    }
  }

  // Sort by tick
  events.sort((a, b) => a.tick - b.tick);

  // Build MIDI track data
  const trackBytes: number[] = [];

  // Tempo meta event
  const usPerBeat = Math.round(60_000_000 / bpm);
  trackBytes.push(0x00); // delta=0
  trackBytes.push(0xff, 0x51, 0x03); // Tempo
  trackBytes.push((usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff);

  // Track name
  const nameBytes = Array.from(new TextEncoder().encode(pattern.name));
  trackBytes.push(0x00); // delta=0
  trackBytes.push(0xff, 0x03, nameBytes.length, ...nameBytes);

  // Note events (Channel 10 = 0x99 for note on, 0x89 for note off)
  let lastTick = 0;

  for (const evt of events) {
    // Note On
    const deltaOn = evt.tick - lastTick;
    trackBytes.push(...writeVLQ(deltaOn));
    trackBytes.push(0x99, evt.note, evt.velocity); // Ch10 Note On
    lastTick = evt.tick;

    // Note Off
    trackBytes.push(...writeVLQ(evt.duration));
    trackBytes.push(0x89, evt.note, 0); // Ch10 Note Off
    lastTick = evt.tick + evt.duration;
  }

  // End of track
  trackBytes.push(0x00, 0xff, 0x2f, 0x00);

  // Build complete MIDI file
  const header = [
    ...Array.from(new TextEncoder().encode("MThd")),
    ...write32(6),           // Header length
    ...write16(0),           // Format 0
    ...write16(1),           // 1 track
    ...write16(TICKS_PER_QUARTER),
  ];

  const trackHeader = [
    ...Array.from(new TextEncoder().encode("MTrk")),
    ...write32(trackBytes.length),
  ];

  return new Uint8Array([...header, ...trackHeader, ...trackBytes]);
}

/** Download pattern as .mid file */
export function downloadMidi(pattern: PatternData, bpm: number): void {
  const midi = patternToMidi(pattern, bpm);
  const blob = new Blob([midi.buffer as ArrayBuffer], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${pattern.name.replace(/[^a-zA-Z0-9]/g, "_")}_${bpm}bpm.mid`;
  a.click();

  URL.revokeObjectURL(url);
}
