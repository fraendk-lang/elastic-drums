/**
 * MIDI File Export
 *
 * Converts a pattern to a Standard MIDI File (Format 1, multi-track).
 * Track 0: Tempo + time signature meta events only
 * Track 1: Drums (channel 10) — GM Drum Map
 * Track 2: Bass (channel 1)
 * Track 3: Chords (channel 2)
 * Track 4: Melody (channel 3)
 * Generates a downloadable .mid file.
 */

import type { PatternData } from "../store/drumStore";
import type { PianoRollNote } from "../components/PianoRoll/types";
import { _persistedNotes } from "../components/PianoRoll/persistedState";

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

/** Wrap a raw bytes array into an MTrk chunk (header + length + data). */
function buildMTrk(trackBytes: number[]): number[] {
  return [
    ...Array.from(new TextEncoder().encode("MTrk")),
    ...write32(trackBytes.length),
    ...trackBytes,
  ];
}

/** Build the tempo-only Track 0. */
function buildTempoTrack(bpm: number, patternName: string): number[] {
  const trackBytes: number[] = [];

  // Tempo meta event
  const usPerBeat = Math.round(60_000_000 / bpm);
  trackBytes.push(0x00); // delta=0
  trackBytes.push(0xff, 0x51, 0x03); // Tempo
  trackBytes.push((usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff);

  // Time signature: 4/4
  trackBytes.push(0x00); // delta=0
  trackBytes.push(0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  // Track name (pattern name)
  const nameBytes = Array.from(new TextEncoder().encode(patternName));
  trackBytes.push(0x00); // delta=0
  trackBytes.push(0xff, 0x03, nameBytes.length, ...nameBytes);

  // End of track
  trackBytes.push(0x00, 0xff, 0x2f, 0x00);

  return buildMTrk(trackBytes);
}

/** Build drum track (channel 10). */
function buildDrumTrack(pattern: PatternData): number[] {
  interface NoteEvent {
    tick: number;
    note: number;
    velocity: number;
    duration: number;
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

  events.sort((a, b) => a.tick - b.tick);

  const trackBytes: number[] = [];

  // Track name
  const nameBytes = Array.from(new TextEncoder().encode("Drums"));
  trackBytes.push(0x00);
  trackBytes.push(0xff, 0x03, nameBytes.length, ...nameBytes);

  // Note events (Channel 10 = 0x99 for note on, 0x89 for note off)
  let lastTick = 0;

  for (const evt of events) {
    const deltaOn = evt.tick - lastTick;
    trackBytes.push(...writeVLQ(deltaOn));
    trackBytes.push(0x99, evt.note, evt.velocity); // Ch10 Note On
    lastTick = evt.tick;

    trackBytes.push(...writeVLQ(evt.duration));
    trackBytes.push(0x89, evt.note, 0); // Ch10 Note Off
    lastTick = evt.tick + evt.duration;
  }

  // End of track
  trackBytes.push(0x00, 0xff, 0x2f, 0x00);

  return buildMTrk(trackBytes);
}

/** Build a piano roll track for bass/chords/melody. channel is 0-indexed (0=ch1, 1=ch2, 2=ch3). */
function buildPianoRollTrack(
  allNotes: PianoRollNote[],
  targetTrack: "bass" | "chords" | "melody",
  channel: number,
  trackName: string,
): number[] {
  interface TimedEvent {
    tick: number;
    isNoteOn: boolean;
    note: number;
    velocity: number;
  }

  const notes = allNotes
    .filter((n) => n.track === targetTrack)
    .sort((a, b) => a.start - b.start);

  const timedEvents: TimedEvent[] = [];

  for (const n of notes) {
    const startTick = Math.round(n.start * TICKS_PER_QUARTER);
    const durationTicks = Math.max(1, Math.round(n.duration * TICKS_PER_QUARTER));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));

    timedEvents.push({ tick: startTick, isNoteOn: true, note: n.midi, velocity: vel });
    timedEvents.push({ tick: startTick + durationTicks, isNoteOn: false, note: n.midi, velocity: 0 });
  }

  // Sort by tick; note-offs before note-ons at the same tick to avoid stuck notes
  timedEvents.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return a.isNoteOn ? 1 : -1;
  });

  const noteOnStatus = 0x90 | channel;
  const noteOffStatus = 0x80 | channel;

  const trackBytes: number[] = [];

  // Track name
  const nameBytes = Array.from(new TextEncoder().encode(trackName));
  trackBytes.push(0x00);
  trackBytes.push(0xff, 0x03, nameBytes.length, ...nameBytes);

  let lastTick = 0;

  for (const evt of timedEvents) {
    const delta = evt.tick - lastTick;
    trackBytes.push(...writeVLQ(delta));
    if (evt.isNoteOn) {
      trackBytes.push(noteOnStatus, evt.note, evt.velocity);
    } else {
      trackBytes.push(noteOffStatus, evt.note, 0);
    }
    lastTick = evt.tick;
  }

  // End of track
  trackBytes.push(0x00, 0xff, 0x2f, 0x00);

  return buildMTrk(trackBytes);
}

export function patternToMidi(
  pattern: PatternData,
  bpm: number,
  pianoRollNotes?: PianoRollNote[],
): Uint8Array {
  const notes = pianoRollNotes ?? [];

  const track0 = buildTempoTrack(bpm, pattern.name);
  const track1 = buildDrumTrack(pattern);
  const track2 = buildPianoRollTrack(notes, "bass",   0, "Bass");
  const track3 = buildPianoRollTrack(notes, "chords", 1, "Chords");
  const track4 = buildPianoRollTrack(notes, "melody", 2, "Melody");

  // Format 1 header: 5 tracks, 480 ticks/quarter
  const header = [
    ...Array.from(new TextEncoder().encode("MThd")),
    ...write32(6),           // Header length
    ...write16(1),           // Format 1
    ...write16(5),           // 5 tracks
    ...write16(TICKS_PER_QUARTER),
  ];

  return new Uint8Array([...header, ...track0, ...track1, ...track2, ...track3, ...track4]);
}

/** Download pattern as .mid file */
export function downloadMidi(pattern: PatternData, bpm: number): void {
  const midi = patternToMidi(pattern, bpm, _persistedNotes);
  const blob = new Blob([midi.buffer as ArrayBuffer], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${pattern.name.replace(/[^a-zA-Z0-9]/g, "_")}_${bpm}bpm.mid`;
  a.click();

  URL.revokeObjectURL(url);
}
