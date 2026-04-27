# Chord Piano Roll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fullscreen overlay Chord Piano Roll with Chord Snap (one click places a fully voiced chord from the active Chord Set) alongside the existing ChordsSequencer step-grid.

**Architecture:** Pure functions (`chordSets.ts`, `chordSnap.ts`) compute voicings. A Zustand store (`chordPianoStore.ts`) holds notes and a `chordsSource` flag. A module-level scheduler subscribes to `drumCurrentStepStore` and drives `chordsEngine` with batched chord triggers. The React overlay mounts in `App.tsx` as a lazy overlay and is opened by a button in `ChordsSequencer`.

**Tech Stack:** React 18, TypeScript strict, Zustand, Vitest, `chordsEngine` + `drumCurrentStepStore` (existing), `SCALES` + `scaleNote` from `src/audio/BassEngine.ts`

---

## File Map

| Path | Action | Purpose |
|------|--------|---------|
| `src/components/ChordPianoRoll/chordSets.ts` | **Create** | 9 chord set voicing definitions (data only) |
| `src/components/ChordPianoRoll/chordSets.test.ts` | **Create** | Vitest unit tests |
| `src/components/ChordPianoRoll/chordSnap.ts` | **Create** | Pure function: pitch + scale + set → ChordNote[] |
| `src/components/ChordPianoRoll/chordSnap.test.ts` | **Create** | Vitest unit tests |
| `src/store/chordPianoStore.ts` | **Create** | Zustand store: ChordNote[], UI state, chordsSource flag |
| `src/components/ChordPianoRoll/chordPianoScheduler.ts` | **Create** | Audio scheduler (module-level, subscribes to drumCurrentStepStore) |
| `src/components/ChordPianoRoll/index.tsx` | **Create** | Full overlay component (~400 lines) |
| `src/store/chordsStore.ts` | **Modify** | Add `chordsSource` guard in step-grid scheduler |
| `src/store/overlayStore.ts` | **Modify** | Add `"chordPianoRoll"` to `OverlayId` union |
| `src/components/ChordsSequencer.tsx` | **Modify** | Add `🎹 PIANO ROLL ↗` button to toolbar |
| `src/App.tsx` | **Modify** | Lazy-import + mount `ChordPianoRoll` overlay |
| `src/store/sceneStore.ts` | **Modify** | Persist ChordPianoRoll notes per scene |

---

## Task 1: ChordSets — Voicing Definitions + Tests

**Files:**
- Create: `src/components/ChordPianoRoll/chordSets.ts`
- Create: `src/components/ChordPianoRoll/chordSets.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/ChordPianoRoll/chordSets.test.ts
import { describe, it, expect } from "vitest";
import { CHORD_SETS, CHORD_SET_IDS } from "./chordSets";

describe("ChordSets", () => {
  it("has exactly 9 chord sets", () => {
    expect(CHORD_SET_IDS).toHaveLength(9);
  });

  it("all sets define voicings for all 7 scale degrees (0–6)", () => {
    for (const id of CHORD_SET_IDS) {
      const { voicings } = CHORD_SETS[id];
      for (let deg = 0; deg <= 6; deg++) {
        expect(voicings[deg], `${id} degree ${deg}`).toBeDefined();
        expect(voicings[deg]!.length, `${id} degree ${deg} has notes`).toBeGreaterThan(0);
        expect(voicings[deg]![0], `${id} degree ${deg} starts at 0`).toBe(0);
      }
    }
  });

  it("Neo Soul 7ths degree 0 (tonic) is min9: [0, 3, 7, 10, 14]", () => {
    expect(CHORD_SETS["neo-soul-7ths"].voicings[0]).toEqual([0, 3, 7, 10, 14]);
  });

  it("Pop Triads all degrees have exactly 3 notes", () => {
    for (let deg = 0; deg <= 6; deg++) {
      expect(CHORD_SETS["pop-triads"].voicings[deg]).toHaveLength(3);
    }
  });

  it("Power Chords all 7 degrees use [0, 7, 12]", () => {
    for (let deg = 0; deg <= 6; deg++) {
      expect(CHORD_SETS["power-chords"].voicings[deg]).toEqual([0, 7, 12]);
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
        for (const offset of CHORD_SETS[id].voicings[deg]!) {
          expect(root + offset, `${id} deg ${deg} offset ${offset}`).toBeGreaterThanOrEqual(0);
          expect(root + offset, `${id} deg ${deg} offset ${offset}`).toBeLessThanOrEqual(127);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
npm test -- --reporter=verbose chordSets.test.ts
```

Expected: FAIL — `Cannot find module './chordSets'`

- [ ] **Step 3: Create chordSets.ts**

```typescript
// src/components/ChordPianoRoll/chordSets.ts

export type ChordSetId =
  | "neo-soul-7ths"
  | "pop-triads"
  | "jazz-voicings"
  | "spread-voicings"
  | "power-chords"
  | "shell-voicings"
  | "trip-hop"
  | "deep-house"
  | "custom";

/** For each scale degree (0–6): semitone offsets from the chord root pitch. */
export type ChordSetVoicing = Record<number, number[]>;

export interface ChordSetDef {
  id: ChordSetId;
  label: string;
  description: string;
  voicings: ChordSetVoicing;
}

export const CHORD_SETS: Record<ChordSetId, ChordSetDef> = {
  "neo-soul-7ths": {
    id: "neo-soul-7ths",
    label: "Neo Soul 7ths",
    description: "min9 · maj9 · dom9 — 5-tone voicings",
    voicings: {
      0: [0, 3, 7, 10, 14],   // min9  (i)
      1: [0, 3, 6, 10, 14],   // min9♭5 (ii°)
      2: [0, 4, 7, 11, 14],   // maj9  (III)
      3: [0, 3, 7, 10, 14],   // min9  (iv)
      4: [0, 4, 7, 10, 14],   // dom9  (V)
      5: [0, 4, 7, 11, 14],   // maj9  (VI)
      6: [0, 4, 7, 10],       // dom7  (VII)
    },
  },
  "pop-triads": {
    id: "pop-triads",
    label: "Pop Triads",
    description: "min · maj · dim — 3-tone voicings",
    voicings: {
      0: [0, 3, 7],   // min
      1: [0, 3, 6],   // dim
      2: [0, 4, 7],   // maj
      3: [0, 3, 7],   // min
      4: [0, 4, 7],   // maj
      5: [0, 4, 7],   // maj
      6: [0, 3, 7],   // min
    },
  },
  "jazz-voicings": {
    id: "jazz-voicings",
    label: "Jazz Voicings",
    description: "min11 · maj13 · 7alt — complex voicings",
    voicings: {
      0: [0, 3, 7, 10, 14, 17],   // min11
      1: [0, 3, 6, 10, 14, 17],   // min11♭5
      2: [0, 4, 7, 11, 14, 21],   // maj13
      3: [0, 3, 7, 10, 14, 17],   // min11
      4: [0, 4, 7, 10, 13, 18],   // 7alt (♭9 ♯11)
      5: [0, 4, 7, 11, 14, 21],   // maj13
      6: [0, 4, 7, 10, 13],       // 7♭9
    },
  },
  "spread-voicings": {
    id: "spread-voicings",
    label: "Spread Voicings",
    description: "min9 · maj9 · dom9 — 2-octave spread",
    voicings: {
      0: [0, 7, 10, 15, 26],   // min9 spread
      1: [0, 7, 10, 15, 27],   // min9♭5 spread
      2: [0, 7, 11, 16, 26],   // maj9 spread
      3: [0, 7, 10, 15, 26],   // min9 spread
      4: [0, 7, 10, 16, 26],   // dom9 spread
      5: [0, 7, 11, 16, 26],   // maj9 spread
      6: [0, 7, 10, 16],       // dom7 spread
    },
  },
  "power-chords": {
    id: "power-chords",
    label: "Power Chords",
    description: "1+5+oct — dense power",
    voicings: {
      0: [0, 7, 12],
      1: [0, 7, 12],
      2: [0, 7, 12],
      3: [0, 7, 12],
      4: [0, 7, 12],
      5: [0, 7, 12],
      6: [0, 7, 12],
    },
  },
  "shell-voicings": {
    id: "shell-voicings",
    label: "Shell Voicings",
    description: "1+m3+m7 · 1+M3+M7 · 1+M3+m7 — jazz minimal",
    voicings: {
      0: [0, 3, 10],   // 1+m3+m7
      1: [0, 3, 10],   // 1+m3+m7
      2: [0, 4, 11],   // 1+M3+M7
      3: [0, 3, 10],   // 1+m3+m7
      4: [0, 4, 10],   // 1+M3+m7 (dominant shell)
      5: [0, 4, 11],   // 1+M3+M7
      6: [0, 4, 10],   // 1+M3+m7
    },
  },
  "trip-hop": {
    id: "trip-hop",
    label: "Trip Hop",
    description: "min7 · dim7 · maj7♭5 · sus4 — dark, Bristol",
    voicings: {
      0: [0, 3, 7, 10],    // min7
      1: [0, 3, 6, 9],     // dim7 (fully diminished)
      2: [0, 4, 6, 11],    // maj7♭5
      3: [0, 3, 7, 10],    // min7
      4: [0, 5, 7],        // sus4
      5: [0, 4, 6, 11],    // maj7♭5
      6: [0, 3, 6, 9],     // dim7
    },
  },
  "deep-house": {
    id: "deep-house",
    label: "Deep House",
    description: "min11 · maj9 · dom7sus4 — floating, Chicago",
    voicings: {
      0: [0, 3, 7, 10, 14, 17],   // min11
      1: [0, 3, 7, 10, 14],       // min9
      2: [0, 4, 7, 11, 14],       // maj9
      3: [0, 3, 7, 10, 14, 17],   // min11
      4: [0, 5, 7, 10],           // dom7sus4
      5: [0, 4, 7, 14],           // add9
      6: [0, 5, 7, 10],           // dom7sus4
    },
  },
  "custom": {
    id: "custom",
    label: "Custom",
    description: "Frei konfigurierbar",
    voicings: {
      0: [0, 3, 7, 10, 14],   // default: Neo Soul 7ths
      1: [0, 3, 6, 10, 14],
      2: [0, 4, 7, 11, 14],
      3: [0, 3, 7, 10, 14],
      4: [0, 4, 7, 10, 14],
      5: [0, 4, 7, 11, 14],
      6: [0, 4, 7, 10],
    },
  },
};

export const CHORD_SET_IDS: ChordSetId[] = [
  "neo-soul-7ths",
  "pop-triads",
  "jazz-voicings",
  "spread-voicings",
  "power-chords",
  "shell-voicings",
  "trip-hop",
  "deep-house",
  "custom",
];
```

- [ ] **Step 4: Run tests — confirm pass**

```bash
npm test -- --reporter=verbose chordSets.test.ts
```

Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/ChordPianoRoll/chordSets.ts src/components/ChordPianoRoll/chordSets.test.ts
git commit -m "feat: add ChordSets voicing definitions + tests (9 sets, 7 degrees each)"
```

---

## Task 2: chordSnap — Pure Function + Tests

**Files:**
- Create: `src/components/ChordPianoRoll/chordSnap.ts`
- Create: `src/components/ChordPianoRoll/chordSnap.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/ChordPianoRoll/chordSnap.test.ts
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
});
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
npm test -- --reporter=verbose chordSnap.test.ts
```

Expected: FAIL — `Cannot find module './chordSnap'`

- [ ] **Step 3: Create chordSnap.ts**

```typescript
// src/components/ChordPianoRoll/chordSnap.ts

import { SCALES } from "../../audio/BassEngine";
import { CHORD_SETS, type ChordSetId } from "./chordSets";
import type { ChordNote } from "../../store/chordPianoStore";

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const;

/**
 * Find the scale degree and chord-root pitch for a given clicked pitch.
 *
 * Algorithm:
 * 1. Determine which octave the clicked pitch is in relative to rootNote.
 * 2. Find the clicked pitch's semitone within that octave.
 * 3. Find the nearest in-scale semitone (snapping off-scale notes).
 * 4. Return both the degree index (0–scaleLen-1) and the absolute MIDI pitch
 *    of that snapped scale note (= the chord root).
 */
export function pitchToScaleDegreeAndRoot(
  clickedPitch: number,
  rootNote: number,
  scaleName: string,
): { degree: number; chordRootPitch: number } {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;

  // Semitone of clicked pitch within one octave, relative to root
  const diffFromRoot = clickedPitch - rootNote;
  const octave = Math.floor(diffFromRoot / 12);
  const semitone = ((diffFromRoot % 12) + 12) % 12;

  // Find nearest scale interval
  let bestIdx = 0;
  let bestDist = 13;
  for (let i = 0; i < scale.length; i++) {
    const interval = scale[i] ?? 0;
    // Wrap-around distance (C# is 1 away from C AND 1 away from D in Chromatic wrapping)
    const dist = Math.min(
      Math.abs(interval - semitone),
      12 - Math.abs(interval - semitone),
    );
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  const chordRootPitch = rootNote + octave * 12 + (scale[bestIdx] ?? 0);
  return { degree: bestIdx, chordRootPitch };
}

/**
 * Given a clicked pitch, produce all ChordNote[] for the chord group.
 *
 * When snapEnabled = false in the UI, the caller passes a chord set of "pop-triads"
 * with only a single-note voicing array — or just wraps the single note manually.
 * This function always uses the chord set voicings as-is.
 */
export function chordSnap(
  clickedPitch: number,
  rootNote: number,
  scaleName: string,
  chordSet: ChordSetId,
  startBeat: number,
  durationBeats: number,
  velocity: number,
): ChordNote[] {
  const { degree, chordRootPitch } = pitchToScaleDegreeAndRoot(
    clickedPitch,
    rootNote,
    scaleName,
  );

  const voicings = CHORD_SETS[chordSet].voicings;
  const offsets = voicings[degree] ?? voicings[0] ?? [0];

  const rootName = NOTE_NAMES[chordRootPitch % 12] ?? "?";
  const chordGroup = `${rootName}${chordSet}@${startBeat.toFixed(2)}`;

  const clampedDuration = Math.max(0.25, durationBeats);
  const clampedVelocity = Math.max(0, Math.min(127, velocity));

  return offsets.map((offset) => ({
    id: crypto.randomUUID(),
    pitch: Math.max(0, Math.min(127, chordRootPitch + offset)),
    startBeat,
    durationBeats: clampedDuration,
    velocity: clampedVelocity,
    chordGroup,
  }));
}
```

- [ ] **Step 4: Run tests — confirm pass**

```bash
npm test -- --reporter=verbose chordSnap.test.ts
```

Expected: PASS (12 tests)

- [ ] **Step 5: Run all tests — confirm no regressions**

```bash
npm test
```

Expected: all existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/components/ChordPianoRoll/chordSnap.ts src/components/ChordPianoRoll/chordSnap.test.ts
git commit -m "feat: add chordSnap pure function + tests"
```

---

## Task 3: chordPianoStore — Zustand Store

**Files:**
- Create: `src/store/chordPianoStore.ts`

- [ ] **Step 1: Create the store**

```typescript
// src/store/chordPianoStore.ts

import { create } from "zustand";
import type { ChordSetId } from "../components/ChordPianoRoll/chordSets";

export interface ChordNote {
  id: string;
  pitch: number;         // MIDI 0–127
  startBeat: number;     // float beats, 0-indexed
  durationBeats: number; // min 0.25 (= 1/16 note)
  velocity: number;      // 0–127
  chordGroup: string;    // stable group ID (e.g. "Cneo-soul-7ths@0.00")
}

interface ChordPianoState {
  notes: ChordNote[];
  activeChordSet: ChordSetId;
  snapEnabled: boolean;
  snapResolution: 0.25 | 0.5 | 1; // beats: 1/16, 1/8, 1/4
  loopStart: number;               // beats
  loopEnd: number;                 // beats
  totalBeats: number;              // default 16
  chordsSource: "grid" | "piano" | "both";

  addNotes: (notes: ChordNote[]) => void;
  removeNote: (id: string) => void;
  removeGroup: (chordGroup: string) => void;
  updateNote: (id: string, patch: Partial<ChordNote>) => void;
  updateGroup: (chordGroup: string, patch: Partial<ChordNote>) => void;
  setActiveChordSet: (id: ChordSetId) => void;
  setSnapEnabled: (v: boolean) => void;
  setSnapResolution: (v: 0.25 | 0.5 | 1) => void;
  setLoopRange: (start: number, end: number) => void;
  setTotalBeats: (v: number) => void;
  setChordsSource: (v: "grid" | "piano" | "both") => void;
  clear: () => void;
}

export const useChordPianoStore = create<ChordPianoState>((set) => ({
  notes: [],
  activeChordSet: "neo-soul-7ths",
  snapEnabled: true,
  snapResolution: 0.25,
  loopStart: 0,
  loopEnd: 16,
  totalBeats: 16,
  chordsSource: "both",

  addNotes: (notes) => set((s) => ({ notes: [...s.notes, ...notes] })),
  removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
  removeGroup: (chordGroup) =>
    set((s) => ({ notes: s.notes.filter((n) => n.chordGroup !== chordGroup) })),
  updateNote: (id, patch) =>
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),
  updateGroup: (chordGroup, patch) =>
    set((s) => ({
      notes: s.notes.map((n) => (n.chordGroup === chordGroup ? { ...n, ...patch } : n)),
    })),
  setActiveChordSet: (id) => set({ activeChordSet: id }),
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  setSnapResolution: (v) => set({ snapResolution: v }),
  setLoopRange: (start, end) => set({ loopStart: start, loopEnd: end }),
  setTotalBeats: (v) => set({ totalBeats: v }),
  setChordsSource: (v) => set({ chordsSource: v }),
  clear: () => set({ notes: [] }),
}));
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/store/chordPianoStore.ts
git commit -m "feat: add chordPianoStore Zustand store"
```

---

## Task 4: Audio Integration — Scheduler + chordsSource Guard

**Files:**
- Create: `src/components/ChordPianoRoll/chordPianoScheduler.ts`
- Modify: `src/store/chordsStore.ts` (add import + guard at line ~453)

- [ ] **Step 1: Create chordPianoScheduler.ts**

```typescript
// src/components/ChordPianoRoll/chordPianoScheduler.ts
//
// Module-level scheduler: subscribes to drumCurrentStepStore, plays ChordPianoRoll
// notes through chordsEngine (batched chord triggers, same as PianoRoll scheduler).
// Import this module once (e.g. from the App or the overlay component) to activate it.

import {
  drumCurrentStepStore,
  getDrumCurrentStep,
  getDrumCurrentStepAudioTime,
} from "../../store/drumStore";
import { useDrumStore } from "../../store/drumStore";
import { useChordPianoStore } from "../../store/chordPianoStore";
import { chordsEngine } from "../../audio/ChordsEngine";
import { audioEngine } from "../../audio/AudioEngine";

// ─── Internal state ──────────────────────────────────────────────────────────

let _lastStep = -1;
let _stepCounter = 0;
const _activeGroups = new Set<string>(); // groups currently playing
const _releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

// External store for playhead display — notified on every tick
const _beatListeners = new Set<() => void>();
let _currentBeat = 0;

export const chordPianoCurrentBeatStore = {
  subscribe(listener: () => void): () => void {
    _beatListeners.add(listener);
    return () => _beatListeners.delete(listener);
  },
  getSnapshot(): number {
    return _currentBeat;
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function releaseAll(): void {
  if (_activeGroups.size === 0) return;
  const now = audioEngine.currentTime + 0.005;
  chordsEngine.releaseChord(now);
  _activeGroups.clear();
  for (const t of _releaseTimers.values()) clearTimeout(t);
  _releaseTimers.clear();
}

// ─── Tick ────────────────────────────────────────────────────────────────────

function tick(currentStep: number, bpm: number): void {
  const { notes, chordsSource, totalBeats } = useChordPianoStore.getState();

  // Muted or empty → skip (but still advance counter to keep in sync)
  if (chordsSource === "grid" || notes.length === 0) {
    _lastStep = currentStep;
    return;
  }

  if (currentStep === _lastStep) return;

  const advanced = _lastStep >= 0;
  _lastStep = currentStep;

  if (advanced) {
    _stepCounter++;
  } else {
    _stepCounter = 0;
  }

  const totalSteps = Math.round(totalBeats * 4); // totalBeats in beats → steps
  const prevWrapped = (_stepCounter - 1 + totalSteps) % totalSteps;
  const wrappedStep = _stepCounter % totalSteps;

  // Detect loop wrap → cut all hanging notes
  if (wrappedStep < prevWrapped || wrappedStep === 0) releaseAll();

  // Update playhead store
  _currentBeat = wrappedStep / 4;
  for (const fn of _beatListeners) fn();

  const t0 = getDrumCurrentStepAudioTime();
  const t = t0 > audioEngine.currentTime ? t0 : audioEngine.currentTime + 0.01;
  const secPerBeat = 60 / bpm;

  // ── Phase 1: Release groups that have ended ───────────────────────────────
  for (const n of notes) {
    if (!_activeGroups.has(n.chordGroup)) continue;
    const endStep = Math.round((n.startBeat + n.durationBeats) * 4);
    const startStep = Math.round(n.startBeat * 4) % totalSteps;
    if (wrappedStep >= endStep % totalSteps && wrappedStep !== startStep) {
      _activeGroups.delete(n.chordGroup);
      const timer = _releaseTimers.get(n.chordGroup);
      if (timer) {
        clearTimeout(timer);
        _releaseTimers.delete(n.chordGroup);
      }
      chordsEngine.releaseChord(t);
    }
  }

  // ── Phase 2: Trigger groups starting this step ────────────────────────────
  // Batch notes by chordGroup so all voices of a chord trigger in one call.
  const groupsThisStep = new Map<string, { midis: number[]; maxDur: number }>();

  for (const n of notes) {
    const startStep = Math.round(n.startBeat * 4) % totalSteps;
    if (startStep !== wrappedStep) continue;
    if (_activeGroups.has(n.chordGroup)) continue;

    const entry = groupsThisStep.get(n.chordGroup) ?? { midis: [], maxDur: 0 };
    entry.midis.push(n.pitch);
    entry.maxDur = Math.max(entry.maxDur, n.durationBeats);
    groupsThisStep.set(n.chordGroup, entry);
  }

  for (const [group, { midis, maxDur }] of groupsThisStep) {
    chordsEngine.triggerChord(midis, t, false, false);
    _activeGroups.add(group);

    // Safety-net timer — releases the chord if the step-based release misses it
    const prev = _releaseTimers.get(group);
    if (prev) clearTimeout(prev);
    const safetyMs = maxDur * secPerBeat * 1000 + 80;
    const timer = setTimeout(() => {
      _releaseTimers.delete(group);
      if (!_activeGroups.has(group)) return;
      _activeGroups.delete(group);
      chordsEngine.releaseChord(audioEngine.currentTime);
    }, safetyMs);
    _releaseTimers.set(group, timer);
  }
}

// ─── Subscribe to drum step clock ────────────────────────────────────────────

let _prevDrumStep = -1;

const _unsub = drumCurrentStepStore.subscribe(() => {
  const step = getDrumCurrentStep();
  if (step === _prevDrumStep) return;
  _prevDrumStep = step;

  const { bpm, isPlaying } = useDrumStore.getState();
  if (isPlaying) {
    tick(step, bpm);
  } else {
    releaseAll();
    _lastStep = -1;
    _stepCounter = 0;
    _prevDrumStep = -1;
    _currentBeat = 0;
    for (const fn of _beatListeners) fn();
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => _unsub());
}
```

- [ ] **Step 2: Add chordsSource guard to chordsStore.ts**

In `src/store/chordsStore.ts`, find the `while (nextChordsStepTime < audioEngine.currentTime + 0.3)` loop (around line 452). Add an import at the top and a guard inside the while loop, right after `const currentStep = _chordsStep;`:

At the top of the file, add one import (after the existing imports, around line 20):
```typescript
import { useChordPianoStore } from "./chordPianoStore";
```

Inside the while loop, right after `const stepIndex = currentStep % length;` (line ~455), add:
```typescript
      // Skip step-grid chord playback when ChordPianoRoll is the active source
      const { chordsSource } = useChordPianoStore.getState();
      if (chordsSource === "piano") {
        setChordsStep((currentStep + 1) % length);
        nextChordsStepTime += secondsPerStep;
        continue;
      }
```

Full context for the edit (lines 452–460 in chordsStore.ts — verify exact lines before editing):
```typescript
    while (nextChordsStepTime < audioEngine.currentTime + 0.3) {
      const { steps, length, rootNote, scaleName, automationData, globalOctave } = useChordsStore.getState();
      const currentStep = _chordsStep;
      const stepIndex = currentStep % length;
      // ← INSERT HERE:
      const { chordsSource } = useChordPianoStore.getState();
      if (chordsSource === "piano") {
        setChordsStep((currentStep + 1) % length);
        nextChordsStepTime += secondsPerStep;
        continue;
      }
      // ← END INSERT
      const step = steps[stepIndex];
      // ... rest of loop unchanged
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors

- [ ] **Step 4: Quick smoke test — start dev server, play transport, check no console errors**

```bash
npm run dev
```

Open browser, start transport. No console errors. Step-grid chords still play (chordsSource default = "both").

- [ ] **Step 5: Commit**

```bash
git add src/components/ChordPianoRoll/chordPianoScheduler.ts src/store/chordsStore.ts
git commit -m "feat: add chordPianoScheduler + chordsSource guard in ChordsScheduler"
```

---

## Task 5: ChordPianoRoll — Overlay Component

**Files:**
- Create: `src/components/ChordPianoRoll/index.tsx`

- [ ] **Step 1: Create the full overlay component**

```tsx
// src/components/ChordPianoRoll/index.tsx

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore, memo,
} from "react";
import { useChordPianoStore } from "../../store/chordPianoStore";
import { useChordsStore } from "../../store/chordsStore";
import { useDrumStore } from "../../store/drumStore";
import { drumCurrentStepStore, getDrumCurrentStep } from "../../store/drumStore";
import { SCALES } from "../../audio/BassEngine";
import { chordSnap } from "./chordSnap";
import { CHORD_SET_IDS, CHORD_SETS } from "./chordSets";
// Side-effect import: activates the scheduler (module-level subscription)
import "./chordPianoScheduler";
import type { ChordNote } from "../../store/chordPianoStore";

// ─── Layout constants ─────────────────────────────────────────────────────────
const PIANO_W = 56;
const ROW_H = 14;
const RULER_H = 28;
const MIDI_MIN = 24;   // C1
const MIDI_MAX = 96;   // C7
const ROWS = MIDI_MAX - MIDI_MIN; // 72 rows

// ─── Note names for piano key labels ─────────────────────────────────────────
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const;

// ─── Chord group color (stable hash) ─────────────────────────────────────────
const GROUP_COLORS = [
  "#a855f7","#22c55e","#f59e0b","#3b82f6","#ef4444",
  "#06b6d4","#f97316","#8b5cf6","#10b981","#ec4899",
] as const;

function groupColor(group: string): string {
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) | 0;
  return GROUP_COLORS[Math.abs(h) % GROUP_COLORS.length]!;
}

// ─── Scale helpers ────────────────────────────────────────────────────────────
function isInScale(pitch: number, rootNote: number, scaleName: string): boolean {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const semitone = ((pitch - rootNote) % 12 + 12) % 12;
  return scale.includes(semitone);
}

function isRoot(pitch: number, rootNote: number): boolean {
  return ((pitch - rootNote) % 12 + 12) % 12 === 0;
}

// ─── Piano Key (single row) ───────────────────────────────────────────────────
const PianoKey = memo(function PianoKey({
  pitch, rootNote, scaleName,
}: { pitch: number; rootNote: number; scaleName: string }) {
  const noteName = NOTE_NAMES[pitch % 12]!;
  const isBlack = noteName.includes("#");
  const isScaleNote = isInScale(pitch, rootNote, scaleName);
  const isRootNote = isRoot(pitch, rootNote);
  const isC = noteName === "C";

  return (
    <div
      className="flex items-center justify-end pr-1 border-b border-white/5 select-none shrink-0"
      style={{
        height: ROW_H,
        background: isRootNote
          ? "rgba(249,115,22,0.18)"
          : isScaleNote
          ? "rgba(168,85,247,0.10)"
          : isBlack
          ? "#0a0a0f"
          : "#101018",
      }}
    >
      {isC && (
        <span className="text-[7px] font-mono text-white/30 leading-none">
          {NOTE_NAMES[pitch % 12]}{Math.floor(pitch / 12) - 1}
        </span>
      )}
      {isRootNote && !isC && (
        <span className="text-[7px] font-mono text-orange-400/60 leading-none">
          {NOTE_NAMES[pitch % 12]}
        </span>
      )}
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────
interface ChordPianoRollProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChordPianoRoll({ isOpen, onClose }: ChordPianoRollProps) {
  const {
    notes, activeChordSet, snapEnabled, snapResolution, totalBeats, chordsSource,
    addNotes, removeGroup, setActiveChordSet, setSnapEnabled, setSnapResolution,
    setChordsSource, clear,
  } = useChordPianoStore();

  const rootNote = useChordsStore((s) => s.rootNote);
  const scaleName = useChordsStore((s) => s.scaleName);
  const isPlaying = useDrumStore((s) => s.isPlaying);

  // Playhead — subscribe to drum step clock for sub-16th accuracy
  const currentStep = useSyncExternalStore(
    drumCurrentStepStore.subscribe,
    getDrumCurrentStep,
  );
  const totalSteps = Math.round(totalBeats * 4);
  const playheadBeat = (currentStep % totalSteps) / 4;

  const [tool, setTool] = useState<"draw" | "select">("draw");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [pixelsPerBeat, setPixelsPerBeat] = useState(60);
  const [hoverCell, setHoverCell] = useState<{ beat: number; pitch: number } | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "b": case "B":
          setTool("draw");
          break;
        case "s": case "S":
          setTool("select");
          break;
        case "Delete": case "Backspace":
          if (selectedGroup) {
            removeGroup(selectedGroup);
            setSelectedGroup(null);
          }
          break;
        case "a": case "A":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            // Select first group as "all" indicator (full multi-select is out of scope)
            setSelectedGroup(notes[0]?.chordGroup ?? null);
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, selectedGroup, removeGroup, onClose, notes]);

  // ── Ctrl+Scroll zoom ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isOpen) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setPixelsPerBeat((p) => Math.max(30, Math.min(200, p - e.deltaY * 0.12)));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [isOpen]);

  // ── Grid dimensions ─────────────────────────────────────────────────────────
  const gridWidth = totalBeats * pixelsPerBeat;
  const gridHeight = ROWS * ROW_H;

  // ── Snap beat to resolution ─────────────────────────────────────────────────
  const snapBeat = useCallback(
    (rawBeat: number) =>
      Math.floor(rawBeat / snapResolution) * snapResolution,
    [snapResolution],
  );

  // ── Click on grid ───────────────────────────────────────────────────────────
  const handleGridPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const rawBeat = x / pixelsPerBeat;
      const beat = snapBeat(rawBeat);
      const pitch = MIDI_MAX - 1 - Math.floor(y / ROW_H);

      if (pitch < MIDI_MIN || pitch >= MIDI_MAX) return;

      // Check if pointer is on an existing note block
      const hitGroup = notes.find((n) => {
        const ns = n.startBeat * pixelsPerBeat;
        const ne = (n.startBeat + n.durationBeats) * pixelsPerBeat;
        const nt = (MIDI_MAX - 1 - n.pitch) * ROW_H;
        const nb = nt + ROW_H;
        return x >= ns && x < ne && y >= nt && y < nb;
      })?.chordGroup ?? null;

      if (hitGroup) {
        setSelectedGroup(hitGroup === selectedGroup ? null : hitGroup);
        return;
      }

      if (tool === "select") {
        setSelectedGroup(null);
        return;
      }

      // Place chord (draw mode)
      const newNotes: ChordNote[] = snapEnabled
        ? chordSnap(pitch, rootNote, scaleName, activeChordSet, beat, snapResolution, 90)
        : [{
            id: crypto.randomUUID(),
            pitch,
            startBeat: beat,
            durationBeats: snapResolution,
            velocity: 90,
            chordGroup: `single@${beat.toFixed(2)}-${pitch}`,
          }];

      addNotes(newNotes);
      setSelectedGroup(newNotes[0]?.chordGroup ?? null);
    },
    [
      notes, tool, snapEnabled, snapBeat, pixelsPerBeat, rootNote, scaleName,
      activeChordSet, snapResolution, selectedGroup, addNotes,
    ],
  );

  // ── Hover for ghost preview ─────────────────────────────────────────────────
  const handleGridMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (tool !== "draw") { setHoverCell(null); return; }
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const beat = snapBeat(x / pixelsPerBeat);
      const pitch = MIDI_MAX - 1 - Math.floor(y / ROW_H);
      if (pitch >= MIDI_MIN && pitch < MIDI_MAX) {
        setHoverCell({ beat, pitch });
      } else {
        setHoverCell(null);
      }
    },
    [tool, snapBeat, pixelsPerBeat],
  );

  // ── Ghost preview notes ─────────────────────────────────────────────────────
  const ghostNotes = hoverCell && snapEnabled
    ? chordSnap(
        hoverCell.pitch, rootNote, scaleName, activeChordSet,
        hoverCell.beat, snapResolution, 90,
      )
    : hoverCell && !snapEnabled
    ? [{ id: "ghost", pitch: hoverCell.pitch, startBeat: hoverCell.beat, durationBeats: snapResolution, velocity: 90, chordGroup: "ghost" }]
    : [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#08090d]/97 backdrop-blur-sm">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap px-3 py-2 border-b border-white/8 shrink-0">
        {/* Title + key/scale read-only */}
        <span className="text-[10px] font-black tracking-[0.16em] text-[var(--ed-accent-chords)] shrink-0"
          style={{ textShadow: "0 0 12px rgba(168,85,247,0.25)" }}>
          CHORDS
        </span>
        <span className="text-[8px] text-white/30 font-mono shrink-0">
          {NOTE_NAMES[rootNote % 12]} · {scaleName}
        </span>

        <div className="w-px h-4 bg-white/8" />

        {/* Draw / Select */}
        {(["draw", "select"] as const).map((t) => (
          <button key={t}
            onClick={() => setTool(t)}
            className={`h-6 px-2.5 text-[8px] font-bold rounded-md transition-all ${
              tool === t
                ? "bg-[var(--ed-accent-chords)]/20 text-[var(--ed-accent-chords)]"
                : "text-white/30 hover:text-white/60 hover:bg-white/5"
            }`}
          >
            {t === "draw" ? "✏ DRAW" : "↖ SELECT"}
          </button>
        ))}

        <div className="w-px h-4 bg-white/8" />

        {/* Chord Snap toggle */}
        <button
          onClick={() => setSnapEnabled(!snapEnabled)}
          className={`h-6 px-2.5 text-[8px] font-bold rounded-md transition-all ${
            snapEnabled
              ? "bg-[var(--ed-accent-chords)]/20 text-[var(--ed-accent-chords)] shadow-[0_0_8px_rgba(168,85,247,0.15)]"
              : "text-white/30 hover:text-white/50 hover:bg-white/5"
          }`}
          title="Chord Snap: one click places full chord"
        >
          ⚡ SNAP {snapEnabled ? "ON" : "OFF"}
        </button>

        {/* Snap resolution */}
        {([0.25, 0.5, 1] as const).map((r) => (
          <button key={r}
            onClick={() => setSnapResolution(r)}
            className={`h-6 px-2 text-[8px] font-bold rounded-md transition-all ${
              snapResolution === r
                ? "bg-white/15 text-white/90"
                : "text-white/25 hover:text-white/55"
            }`}
          >
            {r === 0.25 ? "1/16" : r === 0.5 ? "1/8" : "1/4"}
          </button>
        ))}

        <div className="w-px h-4 bg-white/8" />

        {/* chordsSource */}
        {(["grid","piano","both"] as const).map((src) => (
          <button key={src}
            onClick={() => setChordsSource(src)}
            className={`h-6 px-2 text-[7px] font-bold rounded-md uppercase tracking-wider transition-all ${
              chordsSource === src
                ? "bg-white/12 text-white/80"
                : "text-white/20 hover:text-white/50"
            }`}
            title={src === "grid" ? "Step-grid only" : src === "piano" ? "Piano Roll only" : "Both active"}
          >
            {src}
          </button>
        ))}

        <div className="flex-1" />

        {/* Zoom hint */}
        <span className="hidden lg:inline text-[7px] text-white/15">Ctrl+Scroll = zoom</span>

        <div className="w-px h-4 bg-white/8" />

        {/* CLR + Close */}
        <button onClick={clear}
          className="h-6 px-2 text-[7px] font-bold text-white/25 hover:text-red-400/70 hover:bg-white/5 rounded-md transition-all">
          CLR
        </button>
        <button onClick={onClose}
          className="h-6 w-6 flex items-center justify-center text-white/30 hover:text-white/80 hover:bg-white/8 rounded-md transition-all"
          title="Close (Esc)">
          ×
        </button>
      </div>

      {/* ── Chord Set Bar ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/6 overflow-x-auto shrink-0">
        {CHORD_SET_IDS.map((id) => (
          <button key={id}
            onClick={() => setActiveChordSet(id)}
            className={`h-6 px-2.5 text-[8px] font-bold rounded-full whitespace-nowrap transition-all shrink-0 ${
              activeChordSet === id
                ? "bg-[var(--ed-accent-chords)]/20 text-[var(--ed-accent-chords)] border border-[var(--ed-accent-chords)]/40"
                : "bg-white/[0.04] text-white/40 border border-white/8 hover:text-white/70 hover:bg-white/8"
            }`}
          >
            {CHORD_SETS[id].label}
          </button>
        ))}
        <span className="ml-2 text-[7px] text-white/20 shrink-0 hidden sm:inline">
          {CHORD_SETS[activeChordSet].description}
        </span>
      </div>

      {/* ── Piano Roll Body ──────────────────────────────────────────────── */}
      <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">
        {/* Piano Keys — fixed left column */}
        <div
          className="shrink-0 overflow-hidden flex flex-col"
          style={{ width: PIANO_W, paddingTop: RULER_H }}
        >
          <div className="overflow-y-auto flex-1" id="piano-keys-scroll">
            {Array.from({ length: ROWS }, (_, i) => {
              const pitch = MIDI_MAX - 1 - i;
              return (
                <PianoKey
                  key={pitch}
                  pitch={pitch}
                  rootNote={rootNote}
                  scaleName={scaleName}
                />
              );
            })}
          </div>
        </div>

        {/* Scrollable grid area */}
        <div className="flex-1 min-w-0 overflow-auto" id="chord-pr-grid-scroll">
          <div style={{ width: gridWidth, minWidth: gridWidth }}>
            {/* Ruler */}
            <div
              className="sticky top-0 z-10 bg-[#0a0b10] border-b border-white/8"
              style={{ height: RULER_H, width: gridWidth }}
            >
              {/* Bar lines + beat labels */}
              {Array.from({ length: Math.ceil(totalBeats) + 1 }, (_, bar) => {
                const x = bar * 4 * pixelsPerBeat; // 4 beats per bar
                if (x > gridWidth) return null;
                return (
                  <div key={bar} className="absolute top-0 bottom-0 flex flex-col"
                    style={{ left: x }}>
                    <div className="w-px h-full bg-white/15" />
                    {bar < Math.ceil(totalBeats / 4) && (
                      <span
                        className="absolute top-1 left-1 text-[8px] font-mono text-white/40 whitespace-nowrap"
                      >
                        {bar + 1}
                      </span>
                    )}
                  </div>
                );
              })}
              {/* Beat ticks */}
              {Array.from({ length: totalBeats + 1 }, (_, beat) => {
                if (beat % 4 === 0) return null; // bars already drawn
                const x = beat * pixelsPerBeat;
                return (
                  <div key={`b${beat}`}
                    className="absolute top-[60%] bottom-0 w-px bg-white/6"
                    style={{ left: x }} />
                );
              })}
              {/* Playhead triangle on ruler */}
              {isPlaying && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: playheadBeat * pixelsPerBeat }}
                >
                  <div className="w-px h-full bg-white/50" />
                  <div
                    className="absolute top-0 -translate-x-1/2"
                    style={{
                      width: 0, height: 0,
                      borderLeft: "5px solid transparent",
                      borderRight: "5px solid transparent",
                      borderTop: "6px solid rgba(255,255,255,0.7)",
                    }}
                  />
                </div>
              )}
            </div>

            {/* Note Grid */}
            <div
              ref={gridRef}
              className="relative cursor-crosshair"
              style={{ width: gridWidth, height: gridHeight }}
              onPointerDown={handleGridPointerDown}
              onMouseMove={handleGridMouseMove}
              onMouseLeave={() => setHoverCell(null)}
            >
              {/* Horizontal pitch rows */}
              {Array.from({ length: ROWS }, (_, i) => {
                const pitch = MIDI_MAX - 1 - i;
                const isScaleNote = isInScale(pitch, rootNote, scaleName);
                const isRootNote = isRoot(pitch, rootNote);
                return (
                  <div key={pitch}
                    className="absolute inset-x-0"
                    style={{
                      top: i * ROW_H,
                      height: ROW_H,
                      background: isRootNote
                        ? "rgba(249,115,22,0.05)"
                        : isScaleNote
                        ? "rgba(168,85,247,0.04)"
                        : "transparent",
                      borderBottom: "1px solid rgba(255,255,255,0.035)",
                    }}
                  />
                );
              })}

              {/* Vertical beat lines */}
              {Array.from({ length: totalBeats + 1 }, (_, beat) => {
                const isBeat = beat % 4 === 0;
                return (
                  <div key={`vl${beat}`}
                    className="absolute top-0 bottom-0"
                    style={{
                      left: beat * pixelsPerBeat,
                      width: 1,
                      background: isBeat ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                    }}
                  />
                );
              })}

              {/* Playhead */}
              {isPlaying && (
                <div
                  className="absolute top-0 bottom-0 w-px pointer-events-none z-20"
                  style={{
                    left: playheadBeat * pixelsPerBeat,
                    background: "rgba(255,255,255,0.5)",
                    boxShadow: "0 0 6px rgba(255,255,255,0.2)",
                  }}
                />
              )}

              {/* Note blocks */}
              {notes.map((n) => {
                const x = n.startBeat * pixelsPerBeat;
                const y = (MIDI_MAX - 1 - n.pitch) * ROW_H;
                const w = Math.max(2, n.durationBeats * pixelsPerBeat - 1);
                const color = groupColor(n.chordGroup);
                const isSelected = selectedGroup === n.chordGroup;
                return (
                  <div
                    key={n.id}
                    className="absolute rounded-sm pointer-events-none"
                    style={{
                      left: x,
                      top: y,
                      width: w,
                      height: ROW_H - 1,
                      background: color,
                      opacity: isSelected ? 1 : 0.7,
                      boxShadow: isSelected
                        ? `0 0 0 1px ${color}, 0 0 8px ${color}66`
                        : "none",
                    }}
                  />
                );
              })}

              {/* Ghost preview notes */}
              {ghostNotes.map((n, i) => {
                const x = n.startBeat * pixelsPerBeat;
                const y = (MIDI_MAX - 1 - n.pitch) * ROW_H;
                const w = Math.max(2, n.durationBeats * pixelsPerBeat - 1);
                return (
                  <div
                    key={`ghost-${i}`}
                    className="absolute rounded-sm pointer-events-none"
                    style={{
                      left: x,
                      top: y,
                      width: w,
                      height: ROW_H - 1,
                      background: "rgba(168,85,247,0.35)",
                      border: "1px solid rgba(168,85,247,0.6)",
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail Panel ─────────────────────────────────────────────────── */}
      {selectedGroup && (() => {
        const groupNotes = notes.filter((n) => n.chordGroup === selectedGroup);
        const color = groupColor(selectedGroup);
        return (
          <div className="shrink-0 border-t border-white/8 px-3 py-2 flex items-center gap-3 bg-[#0a0b10]">
            <span className="text-[8px] font-black text-white/40 tracking-wider shrink-0">CHORD</span>
            <div className="flex flex-wrap gap-1">
              {groupNotes.map((n) => (
                <span
                  key={n.id}
                  className="inline-flex items-center h-5 px-1.5 rounded text-[7px] font-bold font-mono"
                  style={{ background: `${color}22`, border: `1px solid ${color}55`, color }}
                >
                  {NOTE_NAMES[n.pitch % 12]}{Math.floor(n.pitch / 12) - 1}
                </span>
              ))}
            </div>
            <div className="flex-1" />
            <button
              onClick={() => { removeGroup(selectedGroup); setSelectedGroup(null); }}
              className="h-5 px-2 text-[7px] font-bold text-red-400/50 hover:text-red-400 hover:bg-red-400/10 rounded transition-all"
            >
              DELETE
            </button>
          </div>
        );
      })()}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ChordPianoRoll/index.tsx
git commit -m "feat: ChordPianoRoll overlay — full UI with snap, chord set bar, detail panel"
```

---

## Task 6: Wire Up — overlayStore + ChordsSequencer + App.tsx

**Files:**
- Modify: `src/store/overlayStore.ts`
- Modify: `src/components/ChordsSequencer.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add "chordPianoRoll" to OverlayId in overlayStore.ts**

In `src/store/overlayStore.ts`, find the `type OverlayId = ...` union (first line of the file) and append `"chordPianoRoll"`:

```typescript
type OverlayId = "mixer" | "browser" | "euclidean" | "song" | "scene" | "fxPanel" | "kitBrowser" | "help" | "mobileVoice" | "sampleBrowser" | "midiPlayer" | "pianoRoll" | "clipLauncher" | "arrangement" | "modMatrix" | "macros" | "midiLearn" | "midiClock" | "userGuide" | "performancePad" | "melodyGen" | "shortcuts" | "chordPianoRoll";
```

- [ ] **Step 2: Add "🎹 PIANO ROLL ↗" button to ChordsSequencer.tsx**

In `src/components/ChordsSequencer.tsx`, find the CLR button group near the end of Row 1 (around line 399–403). After the `CLR` button and before the closing `</div>`, the component receives an `onOpenPianoRoll` prop. Change the component signature and add the button:

**Add prop to the function signature** (line 106):
```typescript
export function ChordsSequencer({ onOpenPianoRoll }: { onOpenPianoRoll?: () => void }) {
```

**Add button inside the CLR group** (after the CLR button, around line 402):
```typescript
          {onOpenPianoRoll && (
            <button
              onClick={onOpenPianoRoll}
              className="h-6 px-2.5 text-[7px] font-bold text-[var(--ed-accent-chords)]/60 hover:text-[var(--ed-accent-chords)] hover:bg-[var(--ed-accent-chords)]/10 border border-[var(--ed-accent-chords)]/20 hover:border-[var(--ed-accent-chords)]/50 rounded-md transition-all"
              title="Open Chord Piano Roll"
            >
              🎹 PIANO ROLL ↗
            </button>
          )}
```

- [ ] **Step 3: Find where ChordsSequencer is rendered**

`ChordsSequencer` is rendered inside `SynthSection.tsx`. Search for it:

```bash
grep -n "ChordsSequencer" src/components/SynthSection.tsx
```

- [ ] **Step 4: Pass onOpenPianoRoll prop through SynthSection**

In `src/components/SynthSection.tsx`, find the `<ChordsSequencer />` usage and add the prop. Also update `SynthSection`'s own props if it doesn't already receive `onOpenChordPianoRoll`.

If `SynthSection` doesn't receive external props for this, use the `useOverlayStore` hook directly inside `SynthSection.tsx`:

```typescript
import { useOverlayStore } from "../store/overlayStore";
// inside SynthSection component:
const overlay = useOverlayStore();
// in JSX:
<ChordsSequencer onOpenPianoRoll={() => overlay.openOverlay("chordPianoRoll")} />
```

- [ ] **Step 5: Add ChordPianoRoll lazy import + mount in App.tsx**

In `src/App.tsx`, add the lazy import alongside the other overlays (after the `PianoRoll` import, around line 22):

```typescript
const ChordPianoRoll = lazy(() =>
  import("./components/ChordPianoRoll").then((m) => ({ default: m.ChordPianoRoll }))
);
```

Inside the `<Suspense>` block (around line 508, after the pianoRoll entry), add:

```typescript
        {overlay.isOpen("chordPianoRoll") && (
          <ChordPianoRoll isOpen onClose={() => overlay.closeOverlay("chordPianoRoll")} />
        )}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Smoke test in browser**

```bash
npm run dev
```

1. Click START, let audio initialize
2. Go to CHORDS tab in the bottom panel
3. Click "🎹 PIANO ROLL ↗" button → overlay opens
4. Select "Neo Soul 7ths" chord set (already default)
5. Click on the grid → chord group appears (5 colored note blocks)
6. Press Space to start playback → chord sounds, playhead moves
7. Press Esc → overlay closes
8. No console errors

- [ ] **Step 8: Commit**

```bash
git add src/store/overlayStore.ts src/components/ChordsSequencer.tsx src/components/SynthSection.tsx src/App.tsx
git commit -m "feat: wire ChordPianoRoll overlay — button in ChordsSequencer, mount in App"
```

---

## Task 7: sceneStore Persistence

**Files:**
- Modify: `src/store/sceneStore.ts`

- [ ] **Step 1: Add ChordNote import and field to Scene interface**

In `src/store/sceneStore.ts`, add the import (after the existing imports, around line 20):

```typescript
import { useChordPianoStore, type ChordNote } from "./chordPianoStore";
```

Add `chordPianoNotes?: ChordNote[]` to the `Scene` interface (after the `loopSlots?` field, around line 49):

```typescript
  /** ChordPianoRoll notes for this scene. undefined = legacy scene (notes untouched). */
  chordPianoNotes?: ChordNote[];
```

- [ ] **Step 2: Capture ChordPianoRoll notes in captureScene**

In the `captureScene` action (inside the `scene` object literal, around line 157, after `loopSlots`):

```typescript
      chordPianoNotes: deepClone(useChordPianoStore.getState().notes),
```

- [ ] **Step 3: Restore ChordPianoRoll notes in loadScene**

In the `loadScene` action, inside the `unstable_batchedUpdates` call (after the loop player restore, around line 307), add:

```typescript
      // Restore ChordPianoRoll notes — legacy scenes (undefined) are silently skipped
      if (scene.chordPianoNotes !== undefined) {
        const store = useChordPianoStore.getState();
        store.clear();
        if (scene.chordPianoNotes.length > 0) {
          store.addNotes(deepClone(scene.chordPianoNotes));
        }
      }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Smoke test scene persistence**

1. Open Chord Piano Roll, place some chords
2. Capture a Scene (via SceneLauncher)
3. Place different chords
4. Load the original Scene → original chords restore
5. No console errors

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all existing tests pass + 21 new tests (chordSets + chordSnap) pass

- [ ] **Step 7: Commit**

```bash
git add src/store/sceneStore.ts
git commit -m "feat: persist ChordPianoRoll notes per scene in sceneStore"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Placement: Vollbild-Overlay, Button in ChordsSequencer — Task 6
- ✅ 9 Chord Sets with voicings for all 7 degrees — Task 1
- ✅ `chordSnap()` pure function — Task 2
- ✅ `ChordNote` data model with `id`, `pitch`, `startBeat`, `durationBeats`, `velocity`, `chordGroup` — Task 3
- ✅ `chordsSource` flag ("grid" | "piano" | "both") — Task 3 + Task 4
- ✅ Audio integration with existing `ChordsEngine` — Task 4
- ✅ Toolbar with snap toggle, resolution, chord set bar — Task 5
- ✅ Scale highlighting + root orange on piano keys — Task 5
- ✅ Ghost preview on hover — Task 5
- ✅ Note blocks colored by chordGroup — Task 5
- ✅ Playhead — Task 5
- ✅ Keyboard shortcuts: B/S/Del/Esc/Cmd+A — Task 5
- ✅ Ctrl+Scroll zoom — Task 5
- ✅ Detail panel showing chord notes — Task 5
- ✅ SceneStore persistence — Task 7
- ✅ Unit tests for ChordSets + chordSnap — Tasks 1–2

**Not in scope (see spec):**
- Custom Chord Set Editor UI
- MIDI import into Chord Piano Roll
- Quantise existing notes
- Strum delay (UI stub only, no audio implementation)
- Full undo/redo in Chord Piano Roll
- Right-click context menu (delete via Del key instead)
- Alt+drag duplicate

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-27-chord-piano-roll.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
