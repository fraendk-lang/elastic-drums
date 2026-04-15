/**
 * SoundFont Engine — GM Soundfont Integration
 *
 * Loads and manages GM Soundfont instruments for Bass, Chords, and Melody
 * Falls back to synth engines when programId === "_synth_"
 */

import { Soundfont } from "smplr";

// ── Instrument Catalogs ──────────────────────────────────

export interface InstrumentOption {
  id: string;
  name: string;
  category: string;
  reliability: "core" | "color";
}

export function findInstrumentOption(options: InstrumentOption[], id: string): InstrumentOption | undefined {
  return options.find((option) => option.id === id);
}

// ── Bass: only real bass instruments (low-register, fundamental-carrying) ──
export const BASS_INSTRUMENTS: InstrumentOption[] = [
  { id: "_synth_", name: "Built-in 303 Synth", category: "Synth", reliability: "core" },
  { id: "synth_bass_1", name: "Synth Bass 1", category: "Synth", reliability: "core" },
  { id: "synth_bass_2", name: "Synth Bass 2", category: "Synth", reliability: "core" },
  { id: "electric_bass_finger", name: "Finger Bass", category: "Electric", reliability: "core" },
  { id: "electric_bass_pick", name: "Pick Bass", category: "Electric", reliability: "core" },
  { id: "fretless_bass", name: "Fretless Bass", category: "Electric", reliability: "core" },
  { id: "slap_bass_1", name: "Slap Bass 1", category: "Electric", reliability: "core" },
  { id: "slap_bass_2", name: "Slap Bass 2", category: "Electric", reliability: "color" },
  { id: "acoustic_bass", name: "Acoustic Upright", category: "Acoustic", reliability: "core" },
  { id: "contrabass", name: "Contrabass", category: "Acoustic", reliability: "color" },
  { id: "tuba", name: "Tuba", category: "Color", reliability: "color" },
];

// ── Chords: polyphonic instruments suited for harmony/pads ──
export const CHORDS_INSTRUMENTS: InstrumentOption[] = [
  { id: "_synth_", name: "Built-in Chord Synth", category: "Synth", reliability: "core" },
  { id: "pad_2_warm", name: "Warm Pad", category: "Pads", reliability: "core" },
  { id: "pad_3_polysynth", name: "Polysynth", category: "Pads", reliability: "core" },
  { id: "pad_1_new_age", name: "New Age Pad", category: "Pads", reliability: "core" },
  { id: "pad_4_choir", name: "Choir Pad", category: "Pads", reliability: "core" },
  { id: "pad_6_metallic", name: "Metallic Pad", category: "Pads", reliability: "color" },
  { id: "pad_7_halo", name: "Halo Pad", category: "Pads", reliability: "color" },
  { id: "pad_8_sweep", name: "Sweep Pad", category: "Pads", reliability: "color" },
  { id: "electric_piano_1", name: "E-Piano 1 (Rhodes)", category: "Keys", reliability: "core" },
  { id: "electric_piano_2", name: "E-Piano 2 (DX)", category: "Keys", reliability: "core" },
  { id: "acoustic_grand_piano", name: "Grand Piano", category: "Keys", reliability: "core" },
  { id: "bright_acoustic_piano", name: "Bright Piano", category: "Keys", reliability: "core" },
  { id: "clavinet", name: "Clavinet", category: "Keys", reliability: "color" },
  { id: "harpsichord", name: "Harpsichord", category: "Keys", reliability: "color" },
  { id: "synth_strings_1", name: "Synth Strings", category: "Strings", reliability: "core" },
  { id: "synth_strings_2", name: "Synth Strings 2", category: "Strings", reliability: "color" },
  { id: "string_ensemble_1", name: "String Ensemble", category: "Strings", reliability: "core" },
  { id: "string_ensemble_2", name: "Slow Strings", category: "Strings", reliability: "color" },
  { id: "church_organ", name: "Church Organ", category: "Organ", reliability: "core" },
  { id: "rock_organ", name: "Rock Organ", category: "Organ", reliability: "color" },
  { id: "reed_organ", name: "Reed Organ", category: "Organ", reliability: "color" },
  { id: "vibraphone", name: "Vibraphone", category: "Mallet", reliability: "core" },
  { id: "marimba", name: "Marimba", category: "Mallet", reliability: "color" },
];

// ── Melody: monophonic/lead instruments for top-line melodies ──
export const MELODY_INSTRUMENTS: InstrumentOption[] = [
  { id: "_synth_", name: "Built-in Lead Synth", category: "Synth", reliability: "core" },
  { id: "lead_1_square", name: "Square Lead", category: "Synth", reliability: "core" },
  { id: "lead_2_sawtooth", name: "Saw Lead", category: "Synth", reliability: "core" },
  { id: "lead_5_charang", name: "Charang", category: "Synth", reliability: "core" },
  { id: "lead_6_voice", name: "Voice Lead", category: "Synth", reliability: "color" },
  { id: "lead_7_fifths", name: "Fifths Lead", category: "Synth", reliability: "color" },
  { id: "lead_8_bass_lead", name: "Bass + Lead", category: "Synth", reliability: "color" },
  { id: "flute", name: "Flute", category: "Wind", reliability: "core" },
  { id: "clarinet", name: "Clarinet", category: "Wind", reliability: "core" },
  { id: "oboe", name: "Oboe", category: "Wind", reliability: "color" },
  { id: "soprano_sax", name: "Soprano Sax", category: "Wind", reliability: "color" },
  { id: "alto_sax", name: "Alto Sax", category: "Wind", reliability: "color" },
  { id: "tenor_sax", name: "Tenor Sax", category: "Wind", reliability: "color" },
  { id: "shakuhachi", name: "Shakuhachi", category: "Wind", reliability: "color" },
  { id: "whistle", name: "Whistle", category: "Wind", reliability: "color" },
  { id: "trumpet", name: "Trumpet", category: "Brass", reliability: "core" },
  { id: "muted_trumpet", name: "Muted Trumpet", category: "Brass", reliability: "color" },
  { id: "french_horn", name: "French Horn", category: "Brass", reliability: "color" },
  { id: "electric_piano_1", name: "E-Piano", category: "Keys", reliability: "core" },
  { id: "celesta", name: "Celesta", category: "Keys", reliability: "color" },
  { id: "kalimba", name: "Kalimba", category: "Keys", reliability: "color" },
  { id: "acoustic_guitar_nylon", name: "Nylon Guitar", category: "Guitar", reliability: "color" },
  { id: "acoustic_guitar_steel", name: "Steel Guitar", category: "Guitar", reliability: "color" },
  { id: "electric_guitar_clean", name: "Clean E-Guitar", category: "Guitar", reliability: "color" },
  { id: "sitar", name: "Sitar", category: "World", reliability: "color" },
  { id: "violin", name: "Violin", category: "Strings", reliability: "core" },
  { id: "fiddle", name: "Fiddle", category: "Strings", reliability: "color" },
  { id: "fx_3_crystal", name: "Crystal FX", category: "FX", reliability: "color" },
  { id: "fx_4_atmosphere", name: "Atmosphere FX", category: "FX", reliability: "color" },
];

// ── Instrument Slot ──────────────────────────────────────

interface InstrumentSlot {
  instrument: Soundfont | null;
  programId: string;
  ready: boolean;
}

// ── SoundFont Engine ─────────────────────────────────────

class SoundFontEngine {
  private ctx: AudioContext | null = null;
  private bass: InstrumentSlot = { instrument: null, programId: "_synth_", ready: false };
  private chords: InstrumentSlot = { instrument: null, programId: "_synth_", ready: false };
  private melody: InstrumentSlot = { instrument: null, programId: "_synth_", ready: false };

  /** Initialize with AudioContext */
  init(ctx: AudioContext): void {
    this.ctx = ctx;
  }

  /** Load an instrument into a slot (bass, chords, or melody) */
  async loadInstrument(
    slot: "bass" | "chords" | "melody",
    programId: string,
    destination: AudioNode,
  ): Promise<boolean> {
    if (!this.ctx) throw new Error("SoundFontEngine not initialized");

    const slotObj = slot === "bass" ? this.bass : slot === "chords" ? this.chords : this.melody;

    // Clear existing instrument
    if (slotObj.instrument) {
      try {
        slotObj.instrument.stop();
      } catch {
        /* ignore */
      }
      slotObj.instrument = null;
    }

    // If programId is "_synth_", disable soundfont
    if (programId === "_synth_") {
      slotObj.programId = "_synth_";
      slotObj.ready = false;
      return true;
    }

    // Load new soundfont instrument
    try {
      const inst = new Soundfont(this.ctx, {
        instrument: programId as never,
        destination,
      });
      await inst.load;
      slotObj.instrument = inst;
      slotObj.programId = programId;
      slotObj.ready = true;
      return true;
    } catch (err) {
      console.warn(`Failed to load instrument ${programId}:`, err);
      slotObj.instrument = null;
      slotObj.programId = "_synth_";
      slotObj.ready = false;
      return false;
    }
  }

  /** Play a note on a slot */
  playNote(
    slot: "bass" | "chords" | "melody",
    note: number,
    time: number,
    velocity: number,
    duration: number,
  ): void {
    const slotObj = slot === "bass" ? this.bass : slot === "chords" ? this.chords : this.melody;

    if (!slotObj.instrument || !slotObj.ready) return;

    const midiVelocity = Math.round(velocity * 127);
    slotObj.instrument.start({
      note,
      velocity: midiVelocity,
      time,
      duration,
    });
  }

  playChord(
    slot: "chords" | "melody",
    notes: number[],
    time: number,
    velocity: number,
    duration: number,
  ): void {
    const slotObj = slot === "chords" ? this.chords : this.melody;
    if (!slotObj.instrument || !slotObj.ready) return;

    const midiVelocity = Math.round(velocity * 127);
    for (const note of notes) {
      slotObj.instrument.start({
        note,
        velocity: midiVelocity,
        time,
        duration,
      });
    }
  }

  /** Stop all playing notes on a slot */
  stopAll(slot: "bass" | "chords" | "melody"): void {
    const slotObj = slot === "bass" ? this.bass : slot === "chords" ? this.chords : this.melody;
    if (slotObj.instrument) {
      try {
        slotObj.instrument.stop();
      } catch {
        /* ignore */
      }
    }
  }

  /** Check if instrument is loaded and ready */
  isLoaded(slot: "bass" | "chords" | "melody"): boolean {
    const slotObj = slot === "bass" ? this.bass : slot === "chords" ? this.chords : this.melody;
    return slotObj.ready;
  }

  /** Get current program ID for a slot */
  getProgram(slot: "bass" | "chords" | "melody"): string {
    const slotObj = slot === "bass" ? this.bass : slot === "chords" ? this.chords : this.melody;
    return slotObj.programId;
  }

  /** Clean up all instruments */
  destroy(): void {
    [this.bass, this.chords, this.melody].forEach((slot) => {
      if (slot.instrument) {
        try {
          slot.instrument.stop();
        } catch {
          /* ignore */
        }
      }
      slot.instrument = null;
      slot.ready = false;
    });
    this.ctx = null;
  }
}

export const soundFontEngine = new SoundFontEngine();
