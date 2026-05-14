/**
 * Modulation Matrix
 *
 * 4 independent LFO sources that can be routed to Bass / Chords / Melody
 * parameters via a Zustand store. Each slot has:
 *   - source: LFO shape + rate
 *   - destination: "bass.cutoff" | "chords.cutoff" | "melody.cutoff" | "bass.resonance" | ...
 *   - depth: -1..+1 (signed, so bipolar modulation)
 *
 * The matrix runs as a requestAnimationFrame loop and anchors LFO phase
 * to the AudioContext clock (`ctx.currentTime`) so modulation stays
 * sample-accurate against the rest of the audio engine even if the main
 * thread stalls. (Previously: setInterval(25) with performance.now() —
 * drifted against audio time on stalls / GC pauses, audible as wobble
 * jitter on filter / cutoff modulation.)
 */

import { bassEngine } from "./BassEngine";
import { chordsEngine } from "./ChordsEngine";
import { melodyEngine } from "./MelodyEngine";
import { audioEngine } from "./AudioEngine";

export type ModSource = {
  shape: "sine" | "triangle" | "saw" | "square" | "ramp-up" | "ramp-down";
  rate: number; // Hz
  phase: number; // 0..1, for initial offset
};

export type ModDestination =
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
  | "melody.vibratoDepth";

export const MOD_DESTINATIONS: { id: ModDestination; label: string; min: number; max: number }[] = [
  { id: "none",                 label: "—",                 min: 0,    max: 1 },
  { id: "bass.cutoff",          label: "Bass Cutoff",       min: 80,   max: 8000 },
  { id: "bass.resonance",       label: "Bass Reso",         min: 0,    max: 30 },
  { id: "bass.distortion",      label: "Bass Drive",        min: 0,    max: 1 },
  { id: "bass.volume",          label: "Bass Vol",          min: 0,    max: 1 },
  { id: "chords.cutoff",        label: "Chords Cutoff",     min: 200,  max: 8000 },
  { id: "chords.resonance",     label: "Chords Reso",       min: 0,    max: 20 },
  { id: "chords.volume",        label: "Chords Vol",        min: 0,    max: 1 },
  { id: "melody.cutoff",        label: "Melody Cutoff",     min: 200,  max: 12000 },
  { id: "melody.resonance",     label: "Melody Reso",       min: 0,    max: 30 },
  { id: "melody.volume",        label: "Melody Vol",        min: 0,    max: 1 },
  { id: "melody.vibratoDepth",  label: "Melody Vibrato",    min: 0,    max: 1 },
];

export interface ModSlot {
  enabled: boolean;
  source: ModSource;
  destination: ModDestination;
  depth: number; // -1..1
  /** internal: original parameter value (so we know the center) */
  _center?: number;
}

// LFO shape evaluator — returns -1..+1
function lfoValue(shape: ModSource["shape"], phase: number): number {
  const p = phase % 1;
  switch (shape) {
    case "sine":       return Math.sin(p * Math.PI * 2);
    case "triangle":   return p < 0.5 ? (p * 4 - 1) : (3 - p * 4);
    case "saw":        return p * 2 - 1;
    case "ramp-up":    return p * 2 - 1;
    case "ramp-down":  return 1 - p * 2;
    case "square":     return p < 0.5 ? 1 : -1;
  }
}

class ModMatrixClass {
  private slots: ModSlot[] = [
    { enabled: false, source: { shape: "sine", rate: 0.5, phase: 0 }, destination: "none", depth: 0.5 },
    { enabled: false, source: { shape: "triangle", rate: 1, phase: 0 }, destination: "none", depth: 0.5 },
    { enabled: false, source: { shape: "sine", rate: 2, phase: 0 }, destination: "none", depth: 0.5 },
    { enabled: false, source: { shape: "square", rate: 0.25, phase: 0 }, destination: "none", depth: 0.5 },
  ];
  private rafId: number | null = null;
  /** AudioContext time when start() was called — basis for LFO phase math. */
  private startAudioTime = 0;
  /** Wallclock fallback when no AudioContext is available yet. */
  private startWallTime = 0;
  private listeners = new Set<() => void>();

  start(): void {
    if (this.rafId !== null) return;
    const ctx = audioEngine.getAudioContext();
    this.startAudioTime = ctx?.currentTime ?? 0;
    this.startWallTime = performance.now() / 1000;
    const loop = () => {
      this.tick();
      // Reschedule next frame. rAF on a hidden tab pauses (which is fine — no
      // audible LFOs while tab is hidden, and on focus-back the phase math
      // resyncs to whatever ctx.currentTime says).
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  getSlots(): ReadonlyArray<ModSlot> {
    return this.slots;
  }

  updateSlot(idx: number, patch: Partial<ModSlot>): void {
    const current = this.slots[idx];
    if (!current) return;
    // Clear center when destination changes — will be re-captured on next tick
    const destinationChanged = patch.destination !== undefined && patch.destination !== current.destination;
    this.slots[idx] = { ...current, ...patch, _center: destinationChanged ? undefined : current._center };
    this.notifyListeners();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notifyListeners(): void {
    for (const fn of this.listeners) fn();
  }

  private tick(): void {
    // Anchor phase to the audio clock when available — that's the same clock
    // the rest of the engine schedules against, so an LFO at 1 Hz produces
    // exactly 1 cycle per second of audio output regardless of any main-
    // thread stalls between rAF frames. Fall back to wallclock if the audio
    // context isn't ready yet (very early app startup).
    const ctx = audioEngine.getAudioContext();
    const now = ctx
      ? ctx.currentTime - this.startAudioTime
      : performance.now() / 1000 - this.startWallTime;
    for (const slot of this.slots) {
      if (!slot.enabled || slot.destination === "none") continue;

      const destMeta = MOD_DESTINATIONS.find((d) => d.id === slot.destination);
      if (!destMeta) continue;

      // Capture center on first run (midpoint of range as fallback)
      if (slot._center === undefined) {
        slot._center = (destMeta.min + destMeta.max) / 2;
      }

      const phase = (now * slot.source.rate + slot.source.phase) % 1;
      const raw = lfoValue(slot.source.shape, phase); // -1..1
      const range = (destMeta.max - destMeta.min) / 2;
      const value = slot._center + raw * slot.depth * range;
      const clamped = Math.max(destMeta.min, Math.min(destMeta.max, value));

      this.applyToDestination(slot.destination, clamped);
    }
  }

  private applyToDestination(dest: ModDestination, value: number): void {
    // Split "engine.param" → engine + param
    const [engine, param] = dest.split(".") as [string, string];
    if (!engine || !param) return;
    try {
      switch (engine) {
        case "bass":    bassEngine.setParams({ [param]: value } as never); break;
        case "chords":  chordsEngine.setParams({ [param]: value } as never); break;
        case "melody":  melodyEngine.setParams({ [param]: value } as never); break;
      }
    } catch {
      /* ignore unknown params */
    }
  }
}

export const modMatrix = new ModMatrixClass();
modMatrix.start();
