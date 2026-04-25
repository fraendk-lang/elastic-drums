/**
 * MidiLibraryParser.ts
 *
 * Parses SMF (Standard MIDI File) binary data into sequencer-ready structures.
 * Supports Type 0 and Type 1 MIDI files.
 *
 * Key features:
 * - Note-on/off extraction per channel/track
 * - Auto-detection of content type (drums/bass/chords/melody)
 * - BPM-sync playback rate calculation
 * - Key transposition (semitone offset)
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type MidiContentType = "drums" | "bass" | "chords" | "melody";

export interface MidiNote {
  /** MIDI note number (0–127) */
  note: number;
  /** Velocity (0–127) */
  velocity: number;
  /** Start time in quarter-note ticks */
  startTick: number;
  /** Duration in quarter-note ticks */
  durationTick: number;
  /** MIDI channel (0-indexed, 0–15) */
  channel: number;
}

export interface MidiTrack {
  index: number;
  name: string;
  channel: number;
  notes: MidiNote[];
  contentType: MidiContentType;
}

export interface ParsedMidi {
  /** Ticks per quarter note (from MIDI header) */
  ticksPerQuarterNote: number;
  /** Tempo in BPM (from tempo event, or 120 if none) */
  bpm: number;
  /** Total duration in ticks */
  totalTicks: number;
  /** All tracks with notes */
  tracks: MidiTrack[];
  /** Primary content type (of the most-used track) */
  primaryContentType: MidiContentType;
}

export interface MidiSequencerPattern {
  /** 32-step boolean grid (one per 16th note, or remapped to pattern length) */
  steps: boolean[];
  /** Per-step MIDI note (for pitched content) */
  notes: number[];
  /** Per-step velocity 0–1 */
  velocities: number[];
  /** Pattern length (8, 16, or 32) */
  patternLength: 8 | 16 | 32;
  /** Detected BPM */
  bpm: number;
  /** Content type */
  contentType: MidiContentType;
}

// ─── SMF Reader ────────────────────────────────────────────────────────────────

class BinaryReader {
  private view: DataView;
  private pos = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  get position() { return this.pos; }
  get remaining() { return this.view.byteLength - this.pos; }

  readUint8(): number {
    return this.view.getUint8(this.pos++);
  }

  readUint16(): number {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }

  readUint32(): number {
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }

  readBytes(n: number): Uint8Array {
    const bytes = new Uint8Array(this.view.buffer, this.pos, n);
    this.pos += n;
    return bytes;
  }

  readString(n: number): string {
    const bytes = this.readBytes(n);
    return String.fromCharCode(...bytes);
  }

  /** Read MIDI variable-length quantity */
  readVarLen(): number {
    let value = 0;
    let b: number;
    do {
      if (this.pos >= this.view.byteLength) break;
      b = this.readUint8();
      value = (value << 7) | (b & 0x7f);
    } while (b & 0x80);
    return value;
  }

  skip(n: number): void {
    this.pos += n;
  }

  seek(pos: number): void {
    this.pos = pos;
  }
}

// ─── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse a Standard MIDI File binary buffer.
 */
export function parseMidi(buffer: ArrayBuffer): ParsedMidi {
  const r = new BinaryReader(buffer);

  // Header chunk
  const headerTag = r.readString(4);
  if (headerTag !== "MThd") throw new Error("Not a MIDI file");
  const headerLen = r.readUint32(); // always 6
  const format = r.readUint16();    // 0=single, 1=multi-track, 2=multi-song
  const numTracks = r.readUint16();
  const division = r.readUint16();

  let ticksPerQuarterNote = 480;
  if (division & 0x8000) {
    // SMPTE timecode — not supported, use default
    ticksPerQuarterNote = 480;
  } else {
    ticksPerQuarterNote = division & 0x7fff;
  }

  if (headerLen > 6) r.skip(headerLen - 6);

  let globalBpm = 120;
  let totalTicks = 0;
  const allTracks: MidiTrack[] = [];

  for (let trackIdx = 0; trackIdx < numTracks; trackIdx++) {
    const tag = r.readString(4);
    const chunkLen = r.readUint32();
    const chunkStart = r.position;

    if (tag !== "MTrk") {
      r.skip(chunkLen);
      continue;
    }

    const notes: MidiNote[] = [];
    let trackName = `Track ${trackIdx}`;
    let trackChannel = 0;

    // pending note-on events: note → { startTick, velocity, channel }
    const pendingNotes = new Map<number, { startTick: number; velocity: number; channel: number }>();

    let currentTick = 0;
    let runningStatus = 0;

    while (r.position < chunkStart + chunkLen) {
      const delta = r.readVarLen();
      currentTick += delta;

      let statusByte = r.readUint8();

      // Running status
      if (statusByte < 0x80) {
        // Use running status
        r.seek(r.position - 1);
        statusByte = runningStatus;
      } else {
        runningStatus = statusByte;
      }

      const msgType = (statusByte >> 4) & 0x0f;
      const channel = statusByte & 0x0f;

      if (statusByte === 0xff) {
        // Meta event
        const metaType = r.readUint8();
        const metaLen = r.readVarLen();
        const metaData = r.readBytes(metaLen);

        if (metaType === 0x51 && metaLen === 3) {
          // Set tempo
          const usPerBeat = (metaData[0]! << 16) | (metaData[1]! << 8) | metaData[2]!;
          if (trackIdx === 0) globalBpm = Math.round(60_000_000 / usPerBeat);
        } else if (metaType === 0x03) {
          // Track name
          trackName = String.fromCharCode(...metaData);
        }
      } else if (statusByte === 0xf0 || statusByte === 0xf7) {
        // SysEx
        const sysexLen = r.readVarLen();
        r.skip(sysexLen);
      } else if (msgType === 0x09) {
        // Note-on
        const note = r.readUint8();
        const velocity = r.readUint8();
        if (velocity > 0) {
          const key = channel * 128 + note;
          pendingNotes.set(key, { startTick: currentTick, velocity, channel });
          if (channel !== 9) trackChannel = channel;
        } else {
          // Velocity 0 = note-off
          const key = channel * 128 + note;
          const pending = pendingNotes.get(key);
          if (pending) {
            notes.push({
              note,
              velocity: pending.velocity,
              startTick: pending.startTick,
              durationTick: Math.max(1, currentTick - pending.startTick),
              channel: pending.channel,
            });
            pendingNotes.delete(key);
          }
        }
      } else if (msgType === 0x08) {
        // Note-off
        const note = r.readUint8();
        r.readUint8(); // velocity
        const key = channel * 128 + note;
        const pending = pendingNotes.get(key);
        if (pending) {
          notes.push({
            note,
            velocity: pending.velocity,
            startTick: pending.startTick,
            durationTick: Math.max(1, currentTick - pending.startTick),
            channel: pending.channel,
          });
          pendingNotes.delete(key);
        }
      } else if (msgType === 0x0a || msgType === 0x0b || msgType === 0x0e) {
        // Polyphonic pressure, control change, pitch bend — 2 data bytes
        r.readUint8();
        r.readUint8();
      } else if (msgType === 0x0c || msgType === 0x0d) {
        // Program change, channel pressure — 1 data byte
        r.readUint8();
      }
    }

    // Flush any still-pending notes (note-on without note-off)
    for (const [key, pending] of pendingNotes) {
      const note = key % 128;
      notes.push({
        note,
        velocity: pending.velocity,
        startTick: pending.startTick,
        durationTick: ticksPerQuarterNote, // assume 1 quarter note
        channel: pending.channel,
      });
    }

    if (notes.length > 0) {
      const lastNote = notes.reduce((acc, n) => Math.max(acc, n.startTick + n.durationTick), 0);
      totalTicks = Math.max(totalTicks, lastNote);

      const contentType = detectContentType(notes, trackName, trackChannel);
      allTracks.push({
        index: trackIdx,
        name: trackName.trim(),
        channel: trackChannel,
        notes,
        contentType,
      });
    }

    // Seek to end of chunk (handles any over/under-read)
    r.seek(chunkStart + chunkLen);
  }

  // For Type 0 (single track), split by channel
  let tracks = allTracks;
  if ((format === 0 || allTracks.length === 1) && allTracks.length > 0) {
    const singleTrack = allTracks[0]!;
    const channelGroups = new Map<number, MidiNote[]>();
    for (const note of singleTrack.notes) {
      const ch = note.channel;
      if (!channelGroups.has(ch)) channelGroups.set(ch, []);
      channelGroups.get(ch)!.push(note);
    }
    if (channelGroups.size > 1) {
      tracks = [];
      for (const [ch, chNotes] of channelGroups) {
        const contentType = detectContentType(chNotes, singleTrack.name, ch);
        tracks.push({
          index: ch,
          name: ch === 9 ? "Drums" : `Channel ${ch + 1}`,
          channel: ch,
          notes: chNotes,
          contentType,
        });
      }
    }
  }

  const primaryContentType =
    tracks.length > 0
      ? tracks.reduce((best, t) => (t.notes.length > best.notes.length ? t : best)).contentType
      : "melody";

  return {
    ticksPerQuarterNote,
    bpm: globalBpm,
    totalTicks,
    tracks,
    primaryContentType,
  };
}

// ─── Content Type Detection ────────────────────────────────────────────────────

function detectContentType(notes: MidiNote[], trackName: string, channel: number): MidiContentType {
  // MIDI channel 9 = drums (GM standard)
  if (channel === 9) return "drums";

  const nameLower = trackName.toLowerCase();
  if (/drum|perc|kick|snare|hat|cymbal/i.test(nameLower)) return "drums";
  if (/bass/i.test(nameLower)) return "bass";
  if (/chord|pad|stab/i.test(nameLower)) return "chords";
  if (/lead|melody|hook|phrase/i.test(nameLower)) return "melody";

  if (notes.length === 0) return "melody";

  // Pitch analysis
  const pitches = notes.map((n) => n.note);
  const avgPitch = pitches.reduce((s, p) => s + p, 0) / pitches.length;
  const minPitch = Math.min(...pitches);
  const maxPitch = Math.max(...pitches);
  const range = maxPitch - minPitch;

  // Polyphony (simultaneous notes)
  const maxSimultaneous = getMaxSimultaneous(notes);

  if (avgPitch < 48 && range < 24) return "bass";
  if (maxSimultaneous >= 3 || (range > 12 && maxSimultaneous >= 2)) return "chords";
  if (avgPitch < 52) return "bass";

  return "melody";
}

function getMaxSimultaneous(notes: MidiNote[]): number {
  let max = 0;
  for (const note of notes) {
    const simultaneous = notes.filter(
      (n) =>
        n !== note &&
        n.startTick < note.startTick + note.durationTick &&
        n.startTick + n.durationTick > note.startTick
    ).length + 1;
    if (simultaneous > max) max = simultaneous;
  }
  return max;
}

// ─── Sequencer Conversion ──────────────────────────────────────────────────────

/**
 * Convert parsed MIDI into a step-sequencer pattern.
 *
 * @param parsed      Result from parseMidi()
 * @param trackIndex  Which track to convert (0 = first/primary)
 * @param targetBpm   Target BPM for playback rate scaling (not used here, just passed through)
 * @param transpose   Semitone offset to apply to note pitches
 * @param bars        Override bar count (e.g. 8) — pads pattern to fit
 */
export function midiToStepPattern(
  parsed: ParsedMidi,
  trackIndex: number,
  _targetBpm: number,
  transpose: number,
  bars?: number
): MidiSequencerPattern {
  const track = parsed.tracks[trackIndex] ?? parsed.tracks[0];
  if (!track) {
    return {
      steps: new Array(16).fill(false) as boolean[],
      notes: new Array(16).fill(60) as number[],
      velocities: new Array(16).fill(0.8) as number[],
      patternLength: 16,
      bpm: parsed.bpm,
      contentType: "melody",
    };
  }

  const tpq = parsed.ticksPerQuarterNote;
  const tickPer16th = tpq / 4; // 1 quarter = 4 sixteenth notes

  // Pattern length: how many 16th-note steps total
  // Use bars param, or compute from totalTicks
  const numBars = bars ?? Math.max(1, Math.round(parsed.totalTicks / (tpq * 4)));
  const stepsTotal = numBars * 16;

  // Clamp to 8/16/32
  const patternLength: 8 | 16 | 32 =
    stepsTotal <= 8 ? 8 : stepsTotal <= 16 ? 16 : 32;

  const steps = new Array(patternLength).fill(false) as boolean[];
  const notes = new Array(patternLength).fill(60) as number[];
  const velocities = new Array(patternLength).fill(0.8) as number[];

  for (const midiNote of track.notes) {
    const stepIdx = Math.round(midiNote.startTick / tickPer16th);
    if (stepIdx < patternLength) {
      steps[stepIdx] = true;
      notes[stepIdx] = Math.max(0, Math.min(127, midiNote.note + transpose));
      velocities[stepIdx] = Math.max(0, Math.min(1, midiNote.velocity / 127));
    }
  }

  return {
    steps,
    notes,
    velocities,
    patternLength,
    bpm: parsed.bpm,
    contentType: track.contentType,
  };
}

/**
 * Calculate playback rate to sync a loop to a target BPM.
 * Usage: audioBufferSource.playbackRate.value = syncPlaybackRate(originalBpm, targetBpm)
 */
export function syncPlaybackRate(originalBpm: number, targetBpm: number): number {
  if (originalBpm <= 0) return 1;
  return targetBpm / originalBpm;
}

/**
 * Fetch and parse a MIDI file from its public URL.
 */
export async function fetchAndParseMidi(url: string): Promise<ParsedMidi> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch MIDI: ${url} (${response.status})`);
  const buffer = await response.arrayBuffer();
  return parseMidi(buffer);
}

// ─── Index Types ──────────────────────────────────────────────────────────────

export interface MidiLibraryPattern {
  id: string;
  pack: string;
  category: string;
  instrument: string;
  key: string;
  scale: string;
  bpm: number;
  swing: number;
  bars: number;
  variation: number;
  program: number;
  path: string;
}

export interface MidiLibraryPackCategory {
  id: string;
  name: string;
  count: number;
}

export interface MidiLibraryPack {
  id: string;
  name: string;
  color: string;
  categories: MidiLibraryPackCategory[];
  patternCount: number;
}

export interface MidiLibraryIndex {
  version: number;
  generatedAt: string;
  packs: MidiLibraryPack[];
  patterns: MidiLibraryPattern[];
}

let cachedIndex: MidiLibraryIndex | null = null;

/**
 * Load and cache the MIDI library index.
 */
export async function loadMidiLibraryIndex(): Promise<MidiLibraryIndex> {
  if (cachedIndex) return cachedIndex;
  const response = await fetch("/midi-library/index.json");
  if (!response.ok) throw new Error("MIDI library index not found — run: node scripts/build-midi-library.cjs");
  cachedIndex = (await response.json()) as MidiLibraryIndex;
  return cachedIndex;
}
