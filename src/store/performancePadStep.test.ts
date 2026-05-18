import { describe, it, expect } from "vitest";
import { gridMs, stepCountFor, stepNotesToEvents, type StepNote } from "./performancePadStep";

describe("gridMs", () => {
  it("1/16 at 120 bpm = 125 ms", () => {
    expect(gridMs("1/16", 120)).toBe(125);
  });
  it("'off' falls back to a 1/16 grid", () => {
    expect(gridMs("off", 120)).toBe(125);
  });
  it("1/4 at 120 bpm = 500 ms", () => {
    expect(gridMs("1/4", 120)).toBe(500);
  });
});

describe("stepCountFor", () => {
  it("a 4000 ms loop at a 125 ms grid = 32 steps", () => {
    expect(stepCountFor(4000, 125)).toBe(32);
  });
  it("never returns less than 1", () => {
    expect(stepCountFor(0, 125)).toBe(1);
  });
});

describe("stepNotesToEvents", () => {
  const n = (x: number): StepNote => ({ x, y: 0.5, velocity: 0.8 });

  it("emits one down/up pair per non-null step", () => {
    const evs = stepNotesToEvents([n(0.2), null, n(0.6)], 125, 2000);
    expect(evs).toHaveLength(4);
    expect(evs.filter((e) => e.type === "down")).toHaveLength(2);
  });
  it("places the down event at stepIndex * grid", () => {
    const evs = stepNotesToEvents([null, null, n(0.5)], 125, 2000);
    expect(evs.find((e) => e.type === "down")!.t).toBe(250);
  });
  it("ends a note at 92% of the grid", () => {
    const evs = stepNotesToEvents([n(0.5)], 125, 2000);
    expect(evs.find((e) => e.type === "up")!.t).toBeCloseTo(115);
  });
  it("ends the final note 92% into its grid step", () => {
    const evs = stepNotesToEvents([null, null, null, n(0.5)], 125, 500);
    expect(evs.find((e) => e.type === "up")!.t).toBe(490);
  });
  it("gives each step a stable unique pointerId", () => {
    const evs = stepNotesToEvents([n(0.1), n(0.2)], 125, 2000);
    expect(new Set(evs.map((e) => e.pointerId)).size).toBe(2);
  });
});
