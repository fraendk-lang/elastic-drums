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

// ── BASS: Only real bass sounds — low-register, sub-heavy ──
export const BASS_INSTRUMENTS: InstrumentOption[] = [
  { id: "_synth_", name: "303 Acid Synth", category: "Synth", reliability: "core" },
  { id: "synth_bass_1", name: "Synth Bass 1", category: "Synth", reliability: "core" },
  { id: "synth_bass_2", name: "Synth Bass 2", category: "Synth", reliability: "core" },
  { id: "electric_bass_finger", name: "Finger Bass", category: "Electric", reliability: "core" },
  { id: "electric_bass_pick", name: "Pick Bass", category: "Electric", reliability: "core" },
  { id: "fretless_bass", name: "Fretless Bass", category: "Electric", reliability: "core" },
  { id: "slap_bass_1", name: "Slap Bass", category: "Electric", reliability: "core" },
  { id: "acoustic_bass", name: "Upright Bass", category: "Acoustic", reliability: "core" },
];

// ── CHORDS: E-Pianos, Organs, Stabs, Pads, Strings — polyphonic harmony sounds ──
export const CHORDS_INSTRUMENTS: InstrumentOption[] = [
  // ─ Built-in
  { id: "_synth_", name: "Poly Synth", category: "Synth", reliability: "core" },
  // ─ Keys (E-Pianos, Clavs — classic house/funk chord sounds)
  { id: "electric_piano_1", name: "Rhodes E-Piano", category: "Keys", reliability: "core" },
  { id: "electric_piano_2", name: "DX E-Piano", category: "Keys", reliability: "core" },
  { id: "clavinet", name: "Clavinet", category: "Keys", reliability: "core" },
  { id: "bright_acoustic_piano", name: "Bright Piano", category: "Keys", reliability: "core" },
  { id: "acoustic_grand_piano", name: "Grand Piano", category: "Keys", reliability: "color" },
  { id: "harpsichord", name: "Harpsichord", category: "Keys", reliability: "color" },
  // ─ Organs (House, Deep House, Gospel)
  { id: "rock_organ", name: "House Organ", category: "Organ", reliability: "core" },
  { id: "church_organ", name: "Church Organ", category: "Organ", reliability: "core" },
  { id: "reed_organ", name: "Reed Organ", category: "Organ", reliability: "color" },
  // ─ Synth Stabs & Pads (Juno-style, chords, stabs)
  { id: "pad_3_polysynth", name: "Juno Poly", category: "Stabs", reliability: "core" },
  { id: "pad_2_warm", name: "Warm Pad", category: "Pads", reliability: "core" },
  { id: "pad_1_new_age", name: "New Age Pad", category: "Pads", reliability: "core" },
  { id: "pad_4_choir", name: "Choir Pad", category: "Pads", reliability: "core" },
  { id: "pad_7_halo", name: "Halo Pad", category: "Pads", reliability: "color" },
  { id: "pad_8_sweep", name: "Sweep Pad", category: "Pads", reliability: "color" },
  // ─ Strings (lush harmony layers)
  { id: "synth_strings_1", name: "Synth Strings", category: "Strings", reliability: "core" },
  { id: "string_ensemble_1", name: "String Ensemble", category: "Strings", reliability: "core" },
  { id: "string_ensemble_2", name: "Slow Strings", category: "Strings", reliability: "color" },
  // ─ Mallet (vibes, marimba — rhythmic chord voicings)
  { id: "vibraphone", name: "Vibraphone", category: "Mallet", reliability: "core" },
  { id: "marimba", name: "Marimba", category: "Mallet", reliability: "color" },
];

// ── MELODY: Leads, plucks, and short melodic sounds ──
export const MELODY_INSTRUMENTS: InstrumentOption[] = [
  // ─ Built-in
  { id: "_synth_", name: "Lead Synth", category: "Synth", reliability: "core" },
  // ─ Synth Leads (saw, square, aggressive)
  { id: "lead_2_sawtooth", name: "Saw Lead", category: "Leads", reliability: "core" },
  { id: "lead_1_square", name: "Square Lead", category: "Leads", reliability: "core" },
  { id: "lead_5_charang", name: "Charang", category: "Leads", reliability: "core" },
  { id: "lead_7_fifths", name: "Fifths Lead", category: "Leads", reliability: "color" },
  { id: "lead_6_voice", name: "Voice Lead", category: "Leads", reliability: "color" },
  // ─ Plucky & Short (kalimba, celesta, guitar, clavinet — rhythmic melodies)
  { id: "kalimba", name: "Kalimba", category: "Plucks", reliability: "core" },
  { id: "celesta", name: "Celesta", category: "Plucks", reliability: "core" },
  { id: "music_box", name: "Music Box", category: "Plucks", reliability: "core" },
  { id: "acoustic_guitar_nylon", name: "Nylon Guitar", category: "Plucks", reliability: "core" },
  { id: "acoustic_guitar_steel", name: "Steel Guitar", category: "Plucks", reliability: "color" },
  { id: "electric_guitar_clean", name: "Clean E-Guitar", category: "Plucks", reliability: "color" },
  { id: "sitar", name: "Sitar", category: "Plucks", reliability: "color" },
  { id: "koto", name: "Koto", category: "Plucks", reliability: "color" },
  // ─ Wind & Brass (melodic solo instruments)
  { id: "flute", name: "Flute", category: "Wind", reliability: "core" },
  { id: "clarinet", name: "Clarinet", category: "Wind", reliability: "core" },
  { id: "alto_sax", name: "Alto Sax", category: "Wind", reliability: "core" },
  { id: "trumpet", name: "Trumpet", category: "Brass", reliability: "core" },
  { id: "muted_trumpet", name: "Muted Trumpet", category: "Brass", reliability: "color" },
  // ─ Solo Strings (violin, fiddle — expressive melodic lines)
  { id: "violin", name: "Violin", category: "Strings", reliability: "core" },
  { id: "fiddle", name: "Fiddle", category: "Strings", reliability: "color" },
  // ─ FX (atmospheric leads)
  { id: "fx_3_crystal", name: "Crystal", category: "FX", reliability: "color" },
  { id: "fx_4_atmosphere", name: "Atmosphere", category: "FX", reliability: "color" },
  { id: "shakuhachi", name: "Shakuhachi", category: "FX", reliability: "color" },
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
