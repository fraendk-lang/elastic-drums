import { describe, it, expect } from "vitest";
import { chordSnap, pitchToScaleDegreeAndRoot } from "./chordSnap";

describe("pitchToScaleDegreeAndRoot", () => {
  // Root = C3 (48), scale = "Minor" = [0, 2, 3, 5, 7, 8, 10]
  it("C3 (root) in C Minor → degree 0, chordRoot 48", () => {
    const { degree, chordRootPitch } = pitchToScaleDegreeAndRoot(48, 48, "Minor");
    expect(degree).toBe(0);
    expect(chordRootPitch).toBe(48);
  });

  it("D3 (2nd semitone) in C Minor → degree 1 (D), chordRoot 50", () => {
    const { degree, chordRootPitch } = pitchToScaleDegreeAndRoot(50, 48, "Minor");
    expect(degree).toBe(1);
    expect(chordRootPitch).toBe(50);
  });

  it("C#3 (off-scale) in C Minor snaps to nearest → C3 (root) or D3", () => {
    const { chordRootPitch } = pitchToScaleDegreeAndRoot(49, 48, "Minor");
    // C# is 1 semitone from C (in scale) and 1 semitone from D (in scale) → either valid
    expect([48, 50]).toContain(chordRootPitch);
  });

  it("C4 (one octave above root) → degree 0 (i), chordRoot 60", () => {
    const { degree, chordRootPitch } = pitchToScaleDegreeAndRoot(60, 48, "Minor");
    expect(degree).toBe(0);
    expect(chordRootPitch).toBe(60);
  });
});

describe("chordSnap", () => {
  const ROOT = 48; // C3
  const SCALE = "Minor";

  it("returns min9 voicing (5 notes) for root in Neo Soul 7ths", () => {
    const notes = chordSnap(48, ROOT, SCALE, "neo-soul-7ths", 0, 1, 90);
    expect(notes).toHaveLength(5);
    expect(notes[0]!.pitch).toBe(48);           // root C3
    expect(notes[1]!.pitch).toBe(48 + 3);       // Eb3 (minor 3rd)
    expect(notes[4]!.pitch).toBe(48 + 14);      // D4 (major 9th)
  });

  it("returns 3 notes for Pop Triads", () => {
    const notes = chordSnap(48, ROOT, SCALE, "pop-triads", 0, 1, 90);
    expect(notes).toHaveLength(3);
  });

  it("all notes have correct startBeat and durationBeats", () => {
    const notes = chordSnap(55, ROOT, SCALE, "neo-soul-7ths", 2.5, 0.5, 90);
    for (const n of notes) {
      expect(n.startBeat).toBe(2.5);
      expect(n.durationBeats).toBe(0.5);
    }
  });

  it("all notes share the same chordGroup", () => {
    const notes = chordSnap(48, ROOT, SCALE, "neo-soul-7ths", 0, 1, 90);
    const groups = new Set(notes.map((n) => n.chordGroup));
    expect(groups.size).toBe(1);
  });

  it("each note has a unique id", () => {
    const notes = chordSnap(48, ROOT, SCALE, "neo-soul-7ths", 0, 1, 90);
    const ids = new Set(notes.map((n) => n.id));
    expect(ids.size).toBe(notes.length);
  });

  it("clamps pitches to MIDI range 0–127", () => {
    // Use a very high root to force clamping
    const notes = chordSnap(120, 120, SCALE, "jazz-voicings", 0, 1, 90);
    for (const n of notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(0);
      expect(n.pitch).toBeLessThanOrEqual(127);
    }
  });

  it("minimum durationBeats is 0.25 even if 0 is passed", () => {
    const notes = chordSnap(48, ROOT, SCALE, "neo-soul-7ths", 0, 0, 90);
    for (const n of notes) {
      expect(n.durationBeats).toBeGreaterThanOrEqual(0.25);
    }
  });

  it("velocity is clamped to 0–127", () => {
    const notes = chordSnap(48, ROOT, SCALE, "pop-triads", 0, 1, 200);
    for (const n of notes) {
      expect(n.velocity).toBeLessThanOrEqual(127);
    }
  });

  it("clamps pitch to 0 when root is very low and voicing would go negative", () => {
    // Root = 0 (C-1), pop-triads voicing = [0, 3, 7] → all pitches ≥ 0
    const notes = chordSnap(0, 0, "Minor", "pop-triads", 0, 1, 90);
    for (const n of notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps negative velocity to 0", () => {
    const notes = chordSnap(48, 48, "Minor", "pop-triads", 0, 1, -10);
    for (const n of notes) {
      expect(n.velocity).toBe(0);
    }
  });
});
