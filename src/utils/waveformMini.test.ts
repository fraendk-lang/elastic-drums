import { describe, it, expect } from "vitest";
import { drumWaveformBars, bassWaveformBars } from "./waveformMini";

describe("drumWaveformBars", () => {
  it("returns array of length = step count", () => {
    const steps = Array.from({ length: 16 }, (_, i) => ({ active: i % 2 === 0, velocity: 100 }));
    const bars = drumWaveformBars(steps, 0);
    expect(bars).toHaveLength(16);
  });

  it("inactive steps have height 0", () => {
    const steps = [{ active: false, velocity: 80 }];
    const bars = drumWaveformBars(steps, 0);
    expect(bars[0]).toBe(0);
  });

  it("active steps have height between 0.3 and 1.0", () => {
    const steps = [{ active: true, velocity: 100 }];
    const bars = drumWaveformBars(steps, 0);
    expect(bars[0]!).toBeGreaterThanOrEqual(0.3);
    expect(bars[0]!).toBeLessThanOrEqual(1.0);
  });

  it("same seed produces same heights (deterministic)", () => {
    const steps = Array.from({ length: 8 }, () => ({ active: true, velocity: 100 }));
    const a = drumWaveformBars(steps, 3);
    const b = drumWaveformBars(steps, 3);
    expect(a).toEqual(b);
  });

  it("different seeds produce different heights", () => {
    const steps = Array.from({ length: 8 }, () => ({ active: true, velocity: 100 }));
    const a = drumWaveformBars(steps, 0);
    const b = drumWaveformBars(steps, 1);
    expect(a).not.toEqual(b);
  });
});

describe("bassWaveformBars", () => {
  it("returns array of length = step count", () => {
    const steps = Array.from({ length: 16 }, (_, i) => ({ active: i % 3 === 0, note: 60, octave: 0 }));
    const bars = bassWaveformBars(steps);
    expect(bars).toHaveLength(16);
  });

  it("inactive steps have height 0", () => {
    const steps = [{ active: false, note: 48, octave: 0 }];
    const bars = bassWaveformBars(steps);
    expect(bars[0]).toBe(0);
  });

  it("higher MIDI note produces taller bar (within octave range)", () => {
    const low  = [{ active: true, note: 36, octave: 0 }];
    const high = [{ active: true, note: 84, octave: 0 }];
    expect(bassWaveformBars(high)[0]!).toBeGreaterThan(bassWaveformBars(low)[0]!);
  });

  it("note=36 (C2) produces height of exactly 0.2", () => {
    const steps = [{ active: true, note: 36, octave: 0 }];
    expect(bassWaveformBars(steps)[0]).toBeCloseTo(0.2, 10);
  });

  it("note=84 (C6) produces height of exactly 1.0", () => {
    const steps = [{ active: true, note: 84, octave: 0 }];
    expect(bassWaveformBars(steps)[0]).toBeCloseTo(1.0, 10);
  });

  it("non-zero octave correctly shifts MIDI value", () => {
    const withOctave    = [{ active: true, note: 24, octave: 1 }]; // MIDI 36
    const withoutOctave = [{ active: true, note: 36, octave: 0 }]; // MIDI 36
    expect(bassWaveformBars(withOctave)[0]).toBeCloseTo(bassWaveformBars(withoutOctave)[0]!, 10);
  });
});
