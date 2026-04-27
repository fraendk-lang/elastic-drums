// src/components/MelodyLayers/melodyLayerScheduler.test.ts
import { describe, it, expect } from "vitest";
import { layerNotesOnStep, layerLocalBeat } from "./melodyLayerScheduler";

describe("layerNotesOnStep", () => {
  const notes = [
    { id: "a", startBeat: 0,    durationBeats: 1,   pitch: 60 },
    { id: "b", startBeat: 1,    durationBeats: 0.5, pitch: 62 },
    { id: "c", startBeat: 0.25, durationBeats: 0.25, pitch: 64 },
  ];

  it("stepCounter=0 barLength=2 → note at beat 0", () => {
    const found = layerNotesOnStep(notes, 0, 2);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("a");
  });

  it("stepCounter=1 barLength=2 → note at beat 0.25", () => {
    const found = layerNotesOnStep(notes, 1, 2);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("c");
  });

  it("stepCounter=4 barLength=2 → note at beat 1", () => {
    const found = layerNotesOnStep(notes, 4, 2);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("b");
  });

  it("wraps: stepCounter=32 barLength=2 → same as step 0", () => {
    const found = layerNotesOnStep(notes, 32, 2);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("a");
  });

  it("barLength=1: stepsPerLoop=16, step 16 wraps to step 0", () => {
    const note = [{ id: "x", startBeat: 0, durationBeats: 1, pitch: 60 }];
    expect(layerNotesOnStep(note, 0,  1)).toHaveLength(1);
    expect(layerNotesOnStep(note, 16, 1)).toHaveLength(1);  // wraps
    expect(layerNotesOnStep(note, 1,  1)).toHaveLength(0);
  });

  it("ignores notes with startBeat >= totalBeats", () => {
    const out = [{ id: "z", startBeat: 10, durationBeats: 1, pitch: 60 }];
    expect(layerNotesOnStep(out, 8, 2)).toHaveLength(0); // totalBeats=8, beat 10 out of range
  });
});

describe("layerLocalBeat", () => {
  it("step 0 barLength=2 → beat 0", () => {
    expect(layerLocalBeat(0, 2)).toBe(0);
  });
  it("step 4 barLength=2 → beat 1", () => {
    expect(layerLocalBeat(4, 2)).toBe(1);
  });
  it("step 32 barLength=2 → beat 0 (wraps at 32 steps)", () => {
    expect(layerLocalBeat(32, 2)).toBe(0);
  });
  it("step 0 barLength=8 → beat 0", () => {
    expect(layerLocalBeat(0, 8)).toBe(0);
  });
  it("step 128 barLength=8 → beat 0 (wraps at 128 steps)", () => {
    expect(layerLocalBeat(128, 8)).toBe(0);
  });
});
