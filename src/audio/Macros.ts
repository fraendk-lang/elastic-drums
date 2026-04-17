/**
 * Macro Knobs — 8 meta-controls, each routable to up to 4 parameters.
 *
 * Unlike Mod Matrix (LFO-driven), macros are static user-driven knobs (0..1).
 * When a macro value changes, all bound parameters are updated with their
 * individual min/max ranges scaled by the macro value.
 */

import { bassEngine } from "./BassEngine";
import { chordsEngine } from "./ChordsEngine";
import { melodyEngine } from "./MelodyEngine";
import { audioEngine } from "./AudioEngine";

export type MacroDestination =
  | "none"
  | "bass.cutoff"
  | "bass.resonance"
  | "bass.distortion"
  | "bass.volume"
  | "chords.cutoff"
  | "chords.resonance"
  | "chords.volume"
  | "melody.cutoff"
  | "melody.resonance"
  | "melody.volume"
  | "melody.vibratoDepth"
  | "master.eqLow"
  | "master.eqMid"
  | "master.eqHigh"
  | "master.reverb"
  | "master.delay";

export const MACRO_DESTINATIONS: { id: MacroDestination; label: string; min: number; max: number }[] = [
  { id: "none",                label: "—",                 min: 0,    max: 1 },
  { id: "bass.cutoff",         label: "Bass Cutoff",       min: 80,   max: 8000 },
  { id: "bass.resonance",      label: "Bass Reso",         min: 0,    max: 30 },
  { id: "bass.distortion",     label: "Bass Drive",        min: 0,    max: 1 },
  { id: "bass.volume",         label: "Bass Vol",          min: 0,    max: 1 },
  { id: "chords.cutoff",       label: "Chords Cutoff",     min: 200,  max: 8000 },
  { id: "chords.resonance",    label: "Chords Reso",       min: 0,    max: 20 },
  { id: "chords.volume",       label: "Chords Vol",        min: 0,    max: 1 },
  { id: "melody.cutoff",       label: "Melody Cutoff",     min: 200,  max: 12000 },
  { id: "melody.resonance",    label: "Melody Reso",       min: 0,    max: 30 },
  { id: "melody.volume",       label: "Melody Vol",        min: 0,    max: 1 },
  { id: "melody.vibratoDepth", label: "Melody Vibrato",    min: 0,    max: 1 },
  { id: "master.reverb",       label: "Master Reverb",     min: 0,    max: 1 },
  { id: "master.delay",        label: "Master Delay",      min: 0,    max: 1 },
];

export interface MacroBinding {
  destination: MacroDestination;
  min: number; // Range override [0..1 of destination's own min..max]
  max: number;
  invert: boolean;
}

export interface MacroSlot {
  name: string;
  value: number; // 0..1
  bindings: MacroBinding[]; // up to 4
}

export const MAX_BINDINGS_PER_MACRO = 4;
export const NUM_MACROS = 8;

function emptyBinding(): MacroBinding {
  return { destination: "none", min: 0, max: 1, invert: false };
}

function emptySlot(index: number): MacroSlot {
  return {
    name: `Macro ${index + 1}`,
    value: 0,
    bindings: Array.from({ length: MAX_BINDINGS_PER_MACRO }, emptyBinding),
  };
}

class MacrosClass {
  private slots: MacroSlot[] = Array.from({ length: NUM_MACROS }, (_, i) => emptySlot(i));
  private listeners = new Set<() => void>();

  getSlots(): ReadonlyArray<MacroSlot> { return this.slots; }

  setValue(slotIdx: number, value: number): void {
    const slot = this.slots[slotIdx];
    if (!slot) return;
    slot.value = Math.max(0, Math.min(1, value));
    this.apply(slotIdx);
    this.notify();
  }

  setBinding(slotIdx: number, bindingIdx: number, patch: Partial<MacroBinding>): void {
    const slot = this.slots[slotIdx];
    if (!slot || !slot.bindings[bindingIdx]) return;
    slot.bindings[bindingIdx] = { ...slot.bindings[bindingIdx]!, ...patch };
    this.apply(slotIdx);
    this.notify();
  }

  setName(slotIdx: number, name: string): void {
    const slot = this.slots[slotIdx];
    if (!slot) return;
    slot.name = name;
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private apply(slotIdx: number): void {
    const slot = this.slots[slotIdx];
    if (!slot) return;
    const macroValue = slot.value;

    for (const binding of slot.bindings) {
      if (binding.destination === "none") continue;
      const destMeta = MACRO_DESTINATIONS.find((d) => d.id === binding.destination);
      if (!destMeta) continue;

      // Scale macro (0..1) by binding's min..max, invert if requested
      const scaled = binding.invert ? 1 - macroValue : macroValue;
      const ranged = binding.min + scaled * (binding.max - binding.min);
      // Map 0..1 to destination's actual min..max
      const value = destMeta.min + ranged * (destMeta.max - destMeta.min);

      this.applyToDestination(binding.destination, value);
    }
  }

  private applyToDestination(dest: MacroDestination, value: number): void {
    const [engine, param] = dest.split(".") as [string, string];
    if (!engine || !param) return;
    try {
      switch (engine) {
        case "bass":   bassEngine.setParams({ [param]: value } as never); break;
        case "chords": chordsEngine.setParams({ [param]: value } as never); break;
        case "melody": melodyEngine.setParams({ [param]: value } as never); break;
        case "master": {
          if (param === "reverb") audioEngine.setReverbLevel(value);
          else if (param === "delay") audioEngine.setDelayLevel(value);
          break;
        }
      }
    } catch { /* ignore */ }
  }
}

export const macros = new MacrosClass();
