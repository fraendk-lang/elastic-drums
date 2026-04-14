/**
 * SoundFont Engine — GM Soundfont Integration
 *
 * Loads and manages GM Soundfont instruments for Bass, Chords, and Melody
 * Falls back to synth engines when programId === "_synth_"
 */

import { Soundfont } from "smplr";

// ── Instrument Catalogs ──────────────────────────────────

export const BASS_INSTRUMENTS = [
  { id: "_synth_", name: "Synth (Built-in)", category: "Synth" },
  { id: "electric_bass_finger", name: "E-Bass Finger", category: "Bass" },
  { id: "electric_bass_pick", name: "E-Bass Pick", category: "Bass" },
  { id: "synth_bass_1", name: "Synth Bass 1", category: "Bass" },
  { id: "synth_bass_2", name: "Synth Bass 2", category: "Bass" },
  { id: "slap_bass_1", name: "Slap Bass", category: "Bass" },
  { id: "acoustic_bass", name: "Acoustic Bass", category: "Bass" },
  { id: "fretless_bass", name: "Fretless", category: "Bass" },
];

export const CHORDS_INSTRUMENTS = [
  { id: "_synth_", name: "Synth (Built-in)", category: "Synth" },
  { id: "pad_1_new_age", name: "New Age Pad", category: "Pad" },
  { id: "pad_2_warm", name: "Warm Pad", category: "Pad" },
  { id: "pad_3_polysynth", name: "Polysynth", category: "Pad" },
  { id: "pad_4_choir", name: "Choir Pad", category: "Pad" },
  { id: "string_ensemble_1", name: "Strings", category: "Strings" },
  { id: "synth_strings_1", name: "Synth Strings", category: "Strings" },
  { id: "acoustic_grand_piano", name: "Grand Piano", category: "Keys" },
  { id: "electric_piano_1", name: "E-Piano", category: "Keys" },
  { id: "church_organ", name: "Organ", category: "Keys" },
  { id: "vibraphone", name: "Vibraphone", category: "Mallet" },
];

export const MELODY_INSTRUMENTS = [
  { id: "_synth_", name: "Synth (Built-in)", category: "Synth" },
  { id: "lead_1_square", name: "Square Lead", category: "Lead" },
  { id: "lead_2_sawtooth", name: "Saw Lead", category: "Lead" },
  { id: "lead_5_charang", name: "Charang", category: "Lead" },
  { id: "lead_6_voice", name: "Voice Lead", category: "Lead" },
  { id: "acoustic_grand_piano", name: "Grand Piano", category: "Keys" },
  { id: "bright_acoustic_piano", name: "Bright Piano", category: "Keys" },
  { id: "electric_piano_1", name: "E-Piano 1", category: "Keys" },
  { id: "clavinet", name: "Clavinet", category: "Keys" },
  { id: "celesta", name: "Celesta", category: "Keys" },
  { id: "acoustic_guitar_nylon", name: "Nylon Guitar", category: "Plucked" },
  { id: "kalimba", name: "Kalimba", category: "Plucked" },
  { id: "sitar", name: "Sitar", category: "Plucked" },
  { id: "trumpet", name: "Trumpet", category: "Brass" },
  { id: "flute", name: "Flute", category: "Wind" },
  { id: "shakuhachi", name: "Shakuhachi", category: "Wind" },
  { id: "fx_3_crystal", name: "Crystal", category: "FX" },
  { id: "fx_4_atmosphere", name: "Atmosphere", category: "FX" },
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
  ): Promise<void> {
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
      return;
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
    } catch (err) {
      console.warn(`Failed to load instrument ${programId}:`, err);
      slotObj.instrument = null;
      slotObj.programId = "_synth_";
      slotObj.ready = false;
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
