import { describe, it, expect } from "vitest";
import {
  fullCycleSteps,
  callSectionSteps,
  getActiveVoice,
  getLocalStep,
  stepToBeat,
  notesOnStep,
} from "./melodyCRUtils";

describe("fullCycleSteps", () => {
  it("barLength=1 → 32 steps (1 bar Call + 1 bar Response)", () => {
    expect(fullCycleSteps(1)).toBe(32);
  });
  it("barLength=2 → 64 steps", () => {
    expect(fullCycleSteps(2)).toBe(64);
  });
  it("barLength=4 → 128 steps", () => {
    expect(fullCycleSteps(4)).toBe(128);
  });
});

describe("callSectionSteps", () => {
  it("barLength=1 → 16 steps", () => {
    expect(callSectionSteps(1)).toBe(16);
  });
  it("barLength=2 → 32 steps", () => {
    expect(callSectionSteps(2)).toBe(32);
  });
});

describe("getActiveVoice", () => {
  it("step 0 → call", () => {
    expect(getActiveVoice(0, 2)).toBe("call");
  });
  it("step 31 (last call step) → call for barLength=2", () => {
    expect(getActiveVoice(31, 2)).toBe("call");
  });
  it("step 32 (first response step) → response for barLength=2", () => {
    expect(getActiveVoice(32, 2)).toBe("response");
  });
  it("step 63 (last response step) → response for barLength=2", () => {
    expect(getActiveVoice(63, 2)).toBe("response");
  });
  it("step 64 (cycle wraps) → call for barLength=2", () => {
    expect(getActiveVoice(64, 2)).toBe("call");
  });
  it("barLength=1: step 16 → response", () => {
    expect(getActiveVoice(16, 1)).toBe("response");
  });
  it("barLength=4: step 64 → response", () => {
    expect(getActiveVoice(64, 4)).toBe("response");
  });
});

describe("getLocalStep", () => {
  it("step 0 (call) → localStep 0", () => {
    expect(getLocalStep(0, 2)).toBe(0);
  });
  it("step 31 (last call) → localStep 31", () => {
    expect(getLocalStep(31, 2)).toBe(31);
  });
  it("step 32 (first response) → localStep 0", () => {
    expect(getLocalStep(32, 2)).toBe(0);
  });
  it("step 47 (response step 15) → localStep 15", () => {
    expect(getLocalStep(47, 2)).toBe(15);
  });
  it("step 64 (second cycle call) → localStep 0", () => {
    expect(getLocalStep(64, 2)).toBe(0);
  });
});

describe("stepToBeat", () => {
  it("step 0 → beat 0", () => {
    expect(stepToBeat(0)).toBe(0);
  });
  it("step 4 → beat 1", () => {
    expect(stepToBeat(4)).toBe(1);
  });
  it("step 7 → beat 1.75", () => {
    expect(stepToBeat(7)).toBe(1.75);
  });
});

describe("notesOnStep", () => {
  const notes = [
    { id: "a", startBeat: 0, durationBeats: 1, pitch: 60 },
    { id: "b", startBeat: 1, durationBeats: 0.5, pitch: 62 },
    { id: "c", startBeat: 0.25, durationBeats: 0.25, pitch: 64 },
  ];
  it("step 0 → note at beat 0", () => {
    const found = notesOnStep(notes, 0, 8);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("a");
  });
  it("step 1 → note at beat 0.25", () => {
    const found = notesOnStep(notes, 1, 8);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("c");
  });
  it("step 4 → note at beat 1", () => {
    const found = notesOnStep(notes, 4, 8);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("b");
  });
  it("step 8 → empty (no notes at beat 2)", () => {
    const found = notesOnStep(notes, 8, 8);
    expect(found).toHaveLength(0);
  });
});
