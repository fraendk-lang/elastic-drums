import { describe, it, expect } from "vitest";
import { CHORD_SETS, CHORD_SET_IDS, type ScaleDegree } from "./chordSets";

describe("ChordSets", () => {
  it("has exactly 9 chord sets", () => {
    expect(CHORD_SET_IDS).toHaveLength(9);
  });

  it("all sets define voicings for all 7 scale degrees (0–6)", () => {
    for (const id of CHORD_SET_IDS) {
      const { voicings } = CHORD_SETS[id];
      for (let deg = 0; deg <= 6; deg++) {
        const d = deg as ScaleDegree;
        expect(voicings[d], `${id} degree ${deg}`).toBeDefined();
        expect(voicings[d].length, `${id} degree ${deg} has notes`).toBeGreaterThan(0);
        expect(voicings[d][0], `${id} degree ${deg} starts at 0`).toBe(0);
      }
    }
  });

  it("Neo Soul 7ths degree 0 (tonic) is min9: [0, 3, 7, 10, 14]", () => {
    expect(CHORD_SETS["neo-soul-7ths"].voicings[0]).toEqual([0, 3, 7, 10, 14]);
  });

  it("Pop Triads all degrees have exactly 3 notes", () => {
    for (let deg = 0; deg <= 6; deg++) {
      expect(CHORD_SETS["pop-triads"].voicings[deg as ScaleDegree]).toHaveLength(3);
    }
  });

  it("Power Chords all 7 degrees use [0, 7, 12]", () => {
    for (let deg = 0; deg <= 6; deg++) {
      expect(CHORD_SETS["power-chords"].voicings[deg as ScaleDegree]).toEqual([0, 7, 12]);
    }
  });

  it("Trip Hop degree 0 includes minor-7th interval (10)", () => {
    expect(CHORD_SETS["trip-hop"].voicings[0]).toContain(10);
  });

  it("Trip Hop degree 1 includes diminished-7th interval (9 = fully dim)", () => {
    expect(CHORD_SETS["trip-hop"].voicings[1]).toContain(9);
  });

  it("Deep House degree 4 includes sus4 interval (5)", () => {
    expect(CHORD_SETS["deep-house"].voicings[4]).toContain(5);
  });

  it("all voicing offsets stay within MIDI range when rooted at C3 (48)", () => {
    const root = 48;
    for (const id of CHORD_SET_IDS) {
      for (let deg = 0; deg <= 6; deg++) {
        for (const offset of CHORD_SETS[id].voicings[deg as ScaleDegree]) {
          expect(root + offset, `${id} deg ${deg} offset ${offset}`).toBeGreaterThanOrEqual(0);
          expect(root + offset, `${id} deg ${deg} offset ${offset}`).toBeLessThanOrEqual(127);
        }
      }
    }
  });
});
