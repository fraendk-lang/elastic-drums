# Arrangement View Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-column Arrangement View with a DAW-grade 5-lane sequencer (DRUMS, BASS, CHORDS, MELODY, LOOPS) with scene colours, waveform miniature, edge-resize, alt-drag copy, context menu, and keyboard shortcuts.

**Architecture:** `ArrangementView.tsx` is a complete rewrite (~900 lines). Sub-components stay inline unless they exceed 150 lines, in which case they are extracted to a sibling file. Two new optional fields (`color?`, `label?`) are added to `SongChainEntry` in `drumStore.ts`. All existing store actions are reused unchanged.

**Tech Stack:** React 18, TypeScript strict, Zustand, Tailwind CSS, Vitest (pure utility tests)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/store/drumStore.ts` | Modify (lines 85–90) | Add `color?` and `label?` to `SongChainEntry` interface |
| `src/components/ArrangementView.tsx` | Full rewrite | All 5-lane view, sub-components, interactions |
| `src/utils/arrangementColors.ts` | Create | Scene-colour palette + helper functions (pure, testable) |
| `src/utils/arrangementColors.test.ts` | Create | Vitest unit tests for colour helpers |

---

## Task 1: Extend `SongChainEntry` + colour utilities

**Files:**
- Modify: `src/store/drumStore.ts:85–90`
- Create: `src/utils/arrangementColors.ts`
- Create: `src/utils/arrangementColors.test.ts`

### Step 1.1 — Write failing tests for colour utilities

- [ ] Create `src/utils/arrangementColors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SCENE_COLORS, getEntryColor, getEntryLabel } from "./arrangementColors";
import type { SongChainEntry } from "../store/drumStore";

describe("arrangementColors", () => {
  it("SCENE_COLORS has 8 entries", () => {
    expect(SCENE_COLORS).toHaveLength(8);
  });

  it("getEntryColor returns entry.color when set", () => {
    const entry: SongChainEntry = { sceneIndex: 0, repeats: 1, color: "#ff0000" };
    expect(getEntryColor(entry)).toBe("#ff0000");
  });

  it("getEntryColor returns palette color based on sceneIndex when entry.color undefined", () => {
    const entry: SongChainEntry = { sceneIndex: 2, repeats: 1 };
    expect(getEntryColor(entry)).toBe(SCENE_COLORS[2]);
  });

  it("getEntryColor cycles palette for sceneIndex >= 8", () => {
    const entry: SongChainEntry = { sceneIndex: 10, repeats: 1 };
    expect(getEntryColor(entry)).toBe(SCENE_COLORS[10 % 8]);
  });

  it("getEntryLabel returns entry.label when set", () => {
    const entry: SongChainEntry = { sceneIndex: 0, repeats: 1, label: "Drop" };
    expect(getEntryLabel(entry)).toBe("Drop");
  });

  it("getEntryLabel returns 'Scene N' (1-indexed) when label undefined", () => {
    const entry: SongChainEntry = { sceneIndex: 4, repeats: 1 };
    expect(getEntryLabel(entry)).toBe("Scene 5");
  });
});
```

### Step 1.2 — Run test to confirm it fails

- [ ] Run: `npm test -- arrangementColors`
- Expected: FAIL — module `./arrangementColors` not found

### Step 1.3 — Add `color?` and `label?` to `SongChainEntry`

- [ ] In `src/store/drumStore.ts`, update the interface at line 85:

```typescript
// Song Mode — chains Scenes (full groovebox snapshots)
export interface SongChainEntry {
  sceneIndex: number;     // Index into sceneStore.scenes[]
  repeats: number;        // How many times to play (1-16)
  tempoBpm?: number;      // Optional: set tempo at this entry (60-200)
  tempoRamp?: boolean;    // When true, ramp to tempoBpm over entry duration instead of instant jump
  color?: string;         // Hex colour override, e.g. "#a855f7" — undefined = auto from palette
  label?: string;         // User-assigned name, e.g. "Drop" — undefined = "Scene N"
}
```

No action changes are needed — `updateSongEntry(index, patch)` already accepts `Partial<SongChainEntry>`.

### Step 1.4 — Create colour utilities

- [ ] Create `src/utils/arrangementColors.ts`:

```typescript
import type { SongChainEntry } from "../store/drumStore";

/** 8 scene colours — cycled by sceneIndex when no custom color is set */
export const SCENE_COLORS: readonly string[] = [
  "#f97316", // Orange
  "#22c55e", // Green
  "#a855f7", // Purple
  "#ec4899", // Pink
  "#3b82f6", // Blue
  "#f59e0b", // Amber
  "#22d3ee", // Teal
  "#ef4444", // Red
] as const;

/** Loop lane accent colour */
export const LOOP_COLOR = "#22d3ee";

/** Returns the effective hex colour for a chain entry */
export function getEntryColor(entry: Pick<SongChainEntry, "sceneIndex" | "color">): string {
  if (entry.color) return entry.color;
  return SCENE_COLORS[entry.sceneIndex % SCENE_COLORS.length]!;
}

/** Returns display label for a chain entry (1-indexed for UX) */
export function getEntryLabel(entry: Pick<SongChainEntry, "sceneIndex" | "label">): string {
  return entry.label ?? `Scene ${entry.sceneIndex + 1}`;
}

/** Returns a semi-transparent version of a hex color at given opacity 0–1 */
export function hexAlpha(hex: string, alpha: number): string {
  // Expand shorthand #abc → #aabbcc
  const full = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
```

### Step 1.5 — Run tests to confirm they pass

- [ ] Run: `npm test -- arrangementColors`
- Expected: 6/6 PASS

### Step 1.6 — Commit

- [ ] Run:
```bash
git add src/store/drumStore.ts src/utils/arrangementColors.ts src/utils/arrangementColors.test.ts
git commit -m "feat: extend SongChainEntry with color/label + colour utilities"
```

---

## Task 2: Waveform mini helpers

**Files:**
- Create: `src/utils/waveformMini.ts`
- Create: `src/utils/waveformMini.test.ts`

These helpers generate deterministic bar arrays for the waveform mini-preview in DRUMS and BASS clips. No audio is involved — it's a purely visual computation from step data.

### Step 2.1 — Write failing tests

- [ ] Create `src/utils/waveformMini.test.ts`:

```typescript
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
});
```

### Step 2.2 — Run to confirm failure

- [ ] Run: `npm test -- waveformMini`
- Expected: FAIL — module not found

### Step 2.3 — Implement waveform helpers

- [ ] Create `src/utils/waveformMini.ts`:

```typescript
/**
 * Deterministic waveform bar height generators for arrangement clip mini-previews.
 * All values are normalised 0–1. Inactive steps return 0.
 */

/**
 * Pseudo-random height using a simple LCG seeded by (sceneIndex * 100 + stepIndex).
 * Always returns the same value for the same inputs.
 */
function deterministicHeight(sceneIndex: number, stepIndex: number): number {
  const seed = (sceneIndex * 100 + stepIndex) & 0x7fffffff;
  // LCG constants from Numerical Recipes
  const val = (seed * 1664525 + 1013904223) & 0x7fffffff;
  return 0.3 + (val / 0x7fffffff) * 0.7; // 0.3 – 1.0
}

/** Bar heights for a DRUMS clip. Uses deterministic pseudo-random heights so the
 *  visual pattern is stable across re-renders. */
export function drumWaveformBars(
  steps: ReadonlyArray<{ active: boolean; velocity?: number }>,
  sceneIndex: number,
): number[] {
  return steps.map((step, i) =>
    step.active ? deterministicHeight(sceneIndex, i) : 0
  );
}

/** Bar heights for a BASS clip. Height is proportional to MIDI note (36–84 range). */
export function bassWaveformBars(
  steps: ReadonlyArray<{ active: boolean; note: number; octave?: number }>,
): number[] {
  const MIN_NOTE = 36; // C2
  const MAX_NOTE = 84; // C6
  return steps.map((step) => {
    if (!step.active) return 0;
    const midi = step.note + (step.octave ?? 0) * 12;
    return 0.2 + Math.max(0, Math.min(1, (midi - MIN_NOTE) / (MAX_NOTE - MIN_NOTE))) * 0.8;
  });
}
```

### Step 2.4 — Run tests to confirm pass

- [ ] Run: `npm test -- waveformMini`
- Expected: 7/7 PASS

### Step 2.5 — Commit

- [ ] Run:
```bash
git add src/utils/waveformMini.ts src/utils/waveformMini.test.ts
git commit -m "feat: waveform mini helpers for arrangement clip previews"
```

---

## Task 3: Foundation — layout skeleton + constants

**Files:**
- Modify: `src/components/ArrangementView.tsx` (full rewrite — delete old content, write new skeleton)

This task sets up the outer shell, constants, track definitions, and a static layout. No interactions yet — just the visual structure.

### Step 3.1 — Delete old content and write skeleton

- [ ] Replace the entire content of `src/components/ArrangementView.tsx` with:

```typescript
/**
 * Arrangement View v3 — DAW-grade 5-lane multi-track sequencer
 *
 * Lanes: DRUMS · BASS · CHORDS · MELODY · LOOPS
 * Interactions: click-select, drag-reorder, alt-drag copy, edge-resize, context menu
 * Keyboard: D dup · Del delete · ⌘C copy · ⌘V paste · ←→ move · −/+ resize · C colour · F2 rename
 */

import {
  useCallback, useEffect, useRef, useState,
} from "react";
import { useDrumStore, type SongChainEntry } from "../store/drumStore";
import { useSceneStore, type Scene } from "../store/sceneStore";
import { useLoopPlayerStore } from "../store/loopPlayerStore";
import {
  SCENE_COLORS, LOOP_COLOR, getEntryColor, getEntryLabel, hexAlpha,
} from "../utils/arrangementColors";
import { drumWaveformBars, bassWaveformBars } from "../utils/waveformMini";

// ─── Layout constants ─────────────────────────────────────────────────────────

const LABEL_W        = 68;   // px — track-label column width
const TRACK_H        = 52;   // px — height of each instrument track row
const LOOP_H         = 36;   // px — height of loop lane row
const RULER_H        = 22;   // px — bar-number ruler height
const MIN_BAR_PX     = 16;
const MAX_BAR_PX     = 120;
const DEFAULT_BAR_PX = 40;
const MAX_REPEATS    = 16;
const MIN_REPEATS    = 1;

// ─── Track definitions ────────────────────────────────────────────────────────

type TrackId = "drums" | "bass" | "chords" | "melody";

const TRACKS: Array<{ id: TrackId; label: string }> = [
  { id: "drums",  label: "DRUMS"  },
  { id: "bass",   label: "BASS"   },
  { id: "chords", label: "CHORDS" },
  { id: "melody", label: "MELODY" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface ArrangementViewProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function ArrangementView({ isOpen, onClose }: ArrangementViewProps) {
  // Store slices
  const songChain              = useDrumStore((s) => s.songChain);
  const songPosition           = useDrumStore((s) => s.songPosition);
  const songRepeatCount        = useDrumStore((s) => s.songRepeatCount);
  const songMode               = useDrumStore((s) => s.songMode);
  const setSongMode            = useDrumStore((s) => s.setSongMode);
  const addToSongChain         = useDrumStore((s) => s.addToSongChain);
  const removeFromSongChain    = useDrumStore((s) => s.removeFromSongChain);
  const updateSongEntryRepeats = useDrumStore((s) => s.updateSongEntryRepeats);
  const moveSongEntry          = useDrumStore((s) => s.moveSongEntry);
  const setSongPosition        = useDrumStore((s) => s.setSongPosition);
  const clearSongChain         = useDrumStore((s) => s.clearSongChain);
  const updateSongEntry        = useDrumStore((s) => s.updateSongEntry);

  const scenes = useSceneStore((s) => s.scenes);

  // View state
  const [barPx, setBarPx]                   = useState(DEFAULT_BAR_PX);
  const [selected, setSelected]             = useState<Set<number>>(new Set());
  const [dragIndex, setDragIndex]           = useState<number | null>(null);
  const [dropIndex, setDropIndex]           = useState<number | null>(null);
  const [isDragCopy, setIsDragCopy]         = useState(false);
  const [clipboard, setClipboard]           = useState<SongChainEntry | null>(null);
  const [contextMenu, setContextMenu]       = useState<{ x: number; y: number; index: number } | null>(null);
  const [renamingIndex, setRenamingIndex]   = useState<number | null>(null);
  const [renameValue, setRenameValue]       = useState("");
  const [showColorPicker, setShowColorPicker] = useState<number | null>(null);

  // Resize drag state (edge-drag)
  const resizingRef   = useRef<{ index: number; startX: number; startRepeats: number } | null>(null);

  // REC mode
  const [isRecording, setIsRecording] = useState(false);
  const [recCount, setRecCount]       = useState(0);
  const lastRecScene                  = useRef<number>(-1);

  const timelineRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const totalBars     = Math.max(songChain.reduce((s, e) => s + e.repeats, 0), 32);
  const playheadBarOffset = songChain.slice(0, songPosition).reduce((sum, e) => sum + e.repeats, 0) + songRepeatCount;
  const playheadPx   = playheadBarOffset * barPx;

  // ── Ctrl/Cmd+scroll zoom ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const el = timelineRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setBarPx(px => Math.max(MIN_BAR_PX, Math.min(MAX_BAR_PX, px - Math.sign(e.deltaY) * 6)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isOpen]);

  // ── REC mode ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRecording) { lastRecScene.current = -1; return; }
    setRecCount(0);
    const unsub = useSceneStore.subscribe((state, prev) => {
      const newScene = state.activeScene;
      if (newScene === prev.activeScene || newScene < 0) return;
      const scene = state.scenes[newScene];
      if (!scene) return;
      const bars = Math.max(1, Math.ceil((scene.drumPattern.length ?? 16) / 16));
      useDrumStore.getState().addToSongChain(newScene, bars);
      lastRecScene.current = newScene;
      setRecCount(c => c + 1);
    });
    return () => unsub();
  }, [isRecording]);

  // ── Close context menu on outside click ──────────────────────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [contextMenu]);

  // ── Focus rename input when it opens ────────────────────────────────────────
  useEffect(() => {
    if (renamingIndex !== null) renameInputRef.current?.focus();
  }, [renamingIndex]);

  // ── Global pointer move/up for edge-resize ───────────────────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const dx    = e.clientX - r.startX;
      const delta = Math.round(dx / barPx);
      const next  = Math.max(MIN_REPEATS, Math.min(MAX_REPEATS, r.startRepeats + delta));
      updateSongEntryRepeats(r.index, next);
    };
    const onUp = () => { resizingRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [barPx, updateSongEntryRepeats]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Ignore when rename input is active
      if (renamingIndex !== null) return;

      const primary = selected.size > 0 ? [...selected][0]! : null;

      if (e.key === "Escape") {
        if (contextMenu) { setContextMenu(null); return; }
        setSelected(new Set());
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.size === 0) return;
        const sorted = [...selected].sort((a, b) => b - a); // remove from end first
        sorted.forEach(i => removeFromSongChain(i));
        setSelected(new Set());
        return;
      }

      if (e.key === "d" || e.key === "D") {
        if (primary === null) return;
        const entry = useDrumStore.getState().songChain[primary];
        if (!entry) return;
        // Insert duplicate right after
        useDrumStore.getState().addToSongChain(entry.sceneIndex, entry.repeats);
        const newIndex = useDrumStore.getState().songChain.length - 1;
        useDrumStore.getState().moveSongEntry(newIndex, primary + 1);
        setSelected(new Set([primary + 1]));
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        if (primary === null) return;
        const entry = useDrumStore.getState().songChain[primary];
        if (entry) setClipboard({ ...entry });
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        if (!clipboard) return;
        const insertAfter = primary ?? useDrumStore.getState().songChain.length - 1;
        useDrumStore.getState().addToSongChain(clipboard.sceneIndex, clipboard.repeats);
        const newIndex = useDrumStore.getState().songChain.length - 1;
        useDrumStore.getState().moveSongEntry(newIndex, insertAfter + 1);
        setSelected(new Set([insertAfter + 1]));
        return;
      }

      if (e.key === "-" || e.key === "_") {
        if (primary === null) return;
        const entry = useDrumStore.getState().songChain[primary];
        if (entry) updateSongEntryRepeats(primary, Math.max(MIN_REPEATS, entry.repeats - 1));
        return;
      }

      if (e.key === "=" || e.key === "+") {
        if (primary === null) return;
        const entry = useDrumStore.getState().songChain[primary];
        if (entry) updateSongEntryRepeats(primary, Math.min(MAX_REPEATS, entry.repeats + 1));
        return;
      }

      if (e.key === "ArrowLeft") {
        if (primary === null || primary === 0) return;
        moveSongEntry(primary, primary - 1);
        setSelected(new Set([primary - 1]));
        return;
      }

      if (e.key === "ArrowRight") {
        if (primary === null) return;
        const chain = useDrumStore.getState().songChain;
        if (primary >= chain.length - 1) return;
        moveSongEntry(primary, primary + 1);
        setSelected(new Set([primary + 1]));
        return;
      }

      if (e.key === "c" || e.key === "C") {
        if (primary === null) return;
        setShowColorPicker(primary);
        return;
      }

      if (e.key === "F2") {
        if (primary === null) return;
        const entry = useDrumStore.getState().songChain[primary];
        setRenameValue(entry?.label ?? getEntryLabel(entry ?? { sceneIndex: 0, repeats: 1 }));
        setRenamingIndex(primary);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, selected, clipboard, renamingIndex, contextMenu,
      removeFromSongChain, updateSongEntryRepeats, moveSongEntry]);

  // ─── Action helpers ──────────────────────────────────────────────────────────

  const selectEntry = useCallback((index: number, multi: boolean) => {
    setContextMenu(null);
    if (multi) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index); else next.add(index);
        return next;
      });
    } else {
      setSelected(prev => (prev.size === 1 && prev.has(index)) ? new Set() : new Set([index]));
    }
  }, []);

  const openContextMenu = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    setSelected(new Set([index]));
    setContextMenu({ x: e.clientX, y: e.clientY, index });
  }, []);

  const handleSceneDrop = useCallback((e: React.DragEvent, atIndex?: number) => {
    e.preventDefault();
    const sceneIdx = parseInt(e.dataTransfer.getData("sceneIndex"));
    if (!isNaN(sceneIdx)) {
      const scene = useSceneStore.getState().scenes[sceneIdx];
      const bars  = scene ? Math.max(1, Math.ceil((scene.drumPattern.length ?? 16) / 16)) : 1;
      addToSongChain(sceneIdx, bars);
      if (atIndex !== undefined) {
        const newLen = useDrumStore.getState().songChain.length;
        moveSongEntry(newLen - 1, atIndex);
      }
    }
    setDropIndex(null);
    setDragIndex(null);
  }, [addToSongChain, moveSongEntry]);

  const handleEntryDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const fromStr = e.dataTransfer.getData("entryIndex");
    if (fromStr !== "") {
      const from = parseInt(fromStr);
      if (!isNaN(from) && from !== toIndex) {
        if (isDragCopy) {
          // Alt+drag: insert a copy at toIndex
          const entry = useDrumStore.getState().songChain[from];
          if (entry) {
            addToSongChain(entry.sceneIndex, entry.repeats);
            const newLen = useDrumStore.getState().songChain.length;
            moveSongEntry(newLen - 1, toIndex);
            if (entry.color || entry.label) {
              updateSongEntry(toIndex, { color: entry.color, label: entry.label });
            }
          }
        } else {
          moveSongEntry(from, toIndex);
        }
        setSelected(new Set([toIndex]));
      }
    } else {
      handleSceneDrop(e, toIndex);
    }
    setDragIndex(null);
    setDropIndex(null);
    setIsDragCopy(false);
  }, [isDragCopy, addToSongChain, moveSongEntry, updateSongEntry, handleSceneDrop]);

  const commitRename = useCallback(() => {
    if (renamingIndex === null) return;
    updateSongEntry(renamingIndex, { label: renameValue.trim() || undefined });
    setRenamingIndex(null);
  }, [renamingIndex, renameValue, updateSongEntry]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="flex flex-col bg-[linear-gradient(180deg,rgba(14,15,20,0.99),rgba(8,9,13,0.99))] border border-white/10 rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.6)] w-[98vw] max-w-[1400px] max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Status bar ──────────────────────────────────────── */}
        <ArrangementStatusBar
          chainLength={songChain.length}
          totalBars={totalBars}
          songMode={songMode}
          setSongMode={setSongMode}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
          recCount={recCount}
          barPx={barPx}
          setBarPx={setBarPx}
          onClear={() => { if (confirm("Clear entire arrangement?")) { clearSongChain(); setSelected(new Set()); } }}
          onClose={onClose}
        />

        {/* ── Timeline ────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden" ref={timelineRef}>

          {/* Track labels column */}
          <div className="shrink-0 border-r border-white/8 flex flex-col" style={{ width: LABEL_W }}>
            <div style={{ height: RULER_H }} className="border-b border-white/8 shrink-0" />
            {TRACKS.map(({ id, label }) => (
              <div
                key={id}
                className="flex items-center justify-center border-b border-white/5 shrink-0"
                style={{ height: TRACK_H }}
              >
                <span className="text-[8px] font-black tracking-[0.18em] text-white/35">{label}</span>
              </div>
            ))}
            <div
              className="flex items-center justify-center border-b border-white/5 shrink-0"
              style={{ height: LOOP_H }}
            >
              <span className="text-[8px] font-black tracking-[0.18em]" style={{ color: hexAlpha(LOOP_COLOR, 0.6) }}>
                LOOPS
              </span>
            </div>
          </div>

          {/* Scrollable track area */}
          <div className="relative flex-1 overflow-x-auto overflow-y-hidden">

            {/* Ruler */}
            <div
              className="sticky top-0 z-20 flex border-b border-white/8 bg-[rgba(8,9,13,0.95)] cursor-pointer select-none"
              style={{ height: RULER_H, minWidth: totalBars * barPx }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleSceneDrop(e)}
            >
              {Array.from({ length: totalBars }, (_, i) => (
                <div
                  key={i}
                  className="border-r border-white/5 flex items-center shrink-0"
                  style={{ width: barPx, minWidth: barPx }}
                >
                  {i % 4 === 0 && (
                    <span className="text-[7px] font-mono text-white/25 pl-0.5">{i + 1}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Track rows */}
            <div className="relative" style={{ minWidth: totalBars * barPx }}>

              {/* Grid-line backgrounds */}
              {[...TRACKS.map((_, ri) => ({ top: ri * TRACK_H, h: TRACK_H })),
                { top: TRACKS.length * TRACK_H, h: LOOP_H }].map(({ top, h }, ri) => (
                <div
                  key={ri}
                  className="absolute left-0 right-0 border-b border-white/5"
                  style={{
                    top,
                    height: h,
                    backgroundImage: `repeating-linear-gradient(90deg,transparent,transparent ${barPx * 4 - 1}px,rgba(255,255,255,0.015) ${barPx * 4 - 1}px,rgba(255,255,255,0.015) ${barPx * 4}px)`,
                  }}
                />
              ))}

              {/* Instrument track rows */}
              {TRACKS.map(({ id }, trackIndex) => (
                <div
                  key={id}
                  className="absolute left-0 flex"
                  style={{ top: trackIndex * TRACK_H, height: TRACK_H }}
                >
                  {songChain.map((entry, clipIndex) => {
                    const scene   = scenes[entry.sceneIndex] ?? null;
                    const color   = getEntryColor(entry);
                    const label   = getEntryLabel(entry);
                    const isActive = songMode === "song" && clipIndex === songPosition;
                    const progress = isActive ? songRepeatCount / Math.max(1, entry.repeats) : 0;
                    const w        = entry.repeats * barPx;
                    const isSelected = selected.has(clipIndex);
                    const isDragging = dragIndex === clipIndex;
                    const isDropTgt  = dropIndex === clipIndex && dragIndex !== clipIndex;

                    return (
                      <ArrangementClip
                        key={clipIndex}
                        entry={entry}
                        clipIndex={clipIndex}
                        trackId={id}
                        scene={scene}
                        color={color}
                        label={label}
                        width={w}
                        height={TRACK_H}
                        isFirstTrack={trackIndex === 0}
                        isLastTrack={trackIndex === TRACKS.length - 1}
                        isActive={isActive}
                        progress={progress}
                        isSelected={isSelected}
                        isDragging={isDragging}
                        isDropTarget={isDropTgt}
                        isRenaming={renamingIndex === clipIndex && trackIndex === 0}
                        renameValue={renameValue}
                        renameInputRef={trackIndex === 0 ? renameInputRef : undefined}
                        onRenameChange={setRenameValue}
                        onRenameCommit={commitRename}
                        onSelect={(multi) => selectEntry(clipIndex, multi)}
                        onContextMenu={(e) => openContextMenu(e, clipIndex)}
                        onDragStart={(e) => {
                          setDragIndex(clipIndex);
                          setIsDragCopy(e.altKey);
                          e.dataTransfer.setData("entryIndex", String(clipIndex));
                          e.dataTransfer.effectAllowed = e.altKey ? "copy" : "move";
                        }}
                        onDragEnd={() => { setDragIndex(null); setDropIndex(null); setIsDragCopy(false); }}
                        onDragOver={() => setDropIndex(clipIndex)}
                        onDrop={(e) => handleEntryDrop(e, clipIndex)}
                        onResizeStart={(e) => {
                          e.stopPropagation();
                          resizingRef.current = { index: clipIndex, startX: e.clientX, startRepeats: entry.repeats };
                          (e.target as HTMLElement).setPointerCapture(e.pointerId);
                        }}
                      />
                    );
                  })}

                  {/* Empty drop zone */}
                  {songChain.length === 0 && trackIndex === 0 && (
                    <div
                      className="flex items-center justify-center border-2 border-dashed border-white/8 rounded m-1.5 px-4"
                      style={{ height: TRACK_H - 12, minWidth: 240 }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleSceneDrop(e)}
                    >
                      <span className="text-[9px] text-white/20 font-bold tracking-wider whitespace-nowrap">
                        Drag scenes here · or press REC and trigger scenes live
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {/* Loop lane */}
              <div
                className="absolute left-0 flex"
                style={{ top: TRACKS.length * TRACK_H, height: LOOP_H }}
              >
                <ArrangementLoopLane
                  songChain={songChain}
                  scenes={scenes}
                  barPx={barPx}
                  height={LOOP_H}
                  songPosition={songPosition}
                  songMode={songMode}
                  selected={selected}
                  onSelect={(i, multi) => selectEntry(i, multi)}
                  onDragOver={(i) => setDropIndex(i)}
                  onDrop={(e, i) => handleEntryDrop(e, i)}
                />
              </div>

              {/* Playhead */}
              {songMode === "song" && songChain.length > 0 && (
                <div
                  className="absolute top-0 z-30 pointer-events-none"
                  style={{
                    left: playheadPx,
                    width: 2,
                    height: TRACKS.length * TRACK_H + LOOP_H,
                    backgroundColor: "rgba(255,255,255,0.55)",
                  }}
                >
                  <div
                    className="absolute"
                    style={{
                      top: -6, left: -4,
                      width: 0, height: 0,
                      borderLeft: "5px solid transparent",
                      borderRight: "5px solid transparent",
                      borderTop: "6px solid rgba(255,255,255,0.7)",
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Detail panel ──────────────────────────────────────── */}
        <ArrangementDetailPanel
          songChain={songChain}
          scenes={scenes}
          selected={selected}
          showColorPicker={showColorPicker}
          setShowColorPicker={setShowColorPicker}
          onUpdateEntry={updateSongEntry}
          onUpdateRepeats={updateSongEntryRepeats}
          onStartRename={(i) => {
            const entry = songChain[i];
            setRenameValue(entry?.label ?? getEntryLabel(entry ?? { sceneIndex: 0, repeats: 1 }));
            setRenamingIndex(i);
          }}
          onRemove={(i) => { removeFromSongChain(i); setSelected(new Set()); }}
        />

        {/* ── Scene palette ──────────────────────────────────────── */}
        <div className="shrink-0 border-t border-white/8 px-4 py-2.5 bg-black/20">
          <div className="text-[7px] font-black tracking-[0.2em] text-white/22 mb-1.5">
            SCENE PALETTE — drag or click to add
            {isRecording && " · REC: trigger a scene to record"}
          </div>
          <div className="grid grid-cols-8 gap-1">
            {scenes.map((scene, i) => {
              const color = SCENE_COLORS[i % SCENE_COLORS.length]!;
              return (
                <div
                  key={i}
                  draggable={!!scene}
                  onDragStart={(e) => {
                    if (!scene) { e.preventDefault(); return; }
                    e.dataTransfer.setData("sceneIndex", String(i));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => {
                    if (!scene) return;
                    addToSongChain(i, Math.max(1, Math.ceil((scene.drumPattern.length ?? 16) / 16)));
                  }}
                  className="h-8 rounded-md border flex flex-col items-center justify-center transition-all cursor-pointer"
                  style={{
                    borderColor: scene ? hexAlpha(color, 0.35) : "rgba(255,255,255,0.05)",
                    backgroundColor: scene ? hexAlpha(color, 0.08) : "rgba(255,255,255,0.015)",
                    opacity: scene ? 1 : 0.4,
                    cursor: scene ? "grab" : "not-allowed",
                  }}
                >
                  {scene ? (
                    <>
                      <span className="text-[7px] font-bold text-white/70 truncate w-full text-center px-0.5 leading-tight">{scene.name}</span>
                      <span className="text-[6px] font-mono" style={{ color: hexAlpha(color, 0.6) }}>#{i + 1}</span>
                    </>
                  ) : (
                    <span className="text-[6px] text-white/15">#{i + 1}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Context menu ──────────────────────────────────────── */}
        {contextMenu && (
          <ArrangementContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            index={contextMenu.index}
            entry={songChain[contextMenu.index] ?? null}
            chainLength={songChain.length}
            onClose={() => setContextMenu(null)}
            onDuplicate={() => {
              const entry = songChain[contextMenu.index];
              if (!entry) return;
              addToSongChain(entry.sceneIndex, entry.repeats);
              const newLen = useDrumStore.getState().songChain.length;
              moveSongEntry(newLen - 1, contextMenu.index + 1);
              if (entry.color || entry.label) updateSongEntry(contextMenu.index + 1, { color: entry.color, label: entry.label });
              setSelected(new Set([contextMenu.index + 1]));
              setContextMenu(null);
            }}
            onCopy={() => {
              const entry = songChain[contextMenu.index];
              if (entry) setClipboard({ ...entry });
              setContextMenu(null);
            }}
            onPaste={() => {
              if (!clipboard) return;
              addToSongChain(clipboard.sceneIndex, clipboard.repeats);
              const newLen = useDrumStore.getState().songChain.length;
              moveSongEntry(newLen - 1, contextMenu.index + 1);
              setSelected(new Set([contextMenu.index + 1]));
              setContextMenu(null);
            }}
            onBarsChange={(delta) => {
              const entry = songChain[contextMenu.index];
              if (entry) updateSongEntryRepeats(contextMenu.index, Math.max(MIN_REPEATS, Math.min(MAX_REPEATS, entry.repeats + delta)));
              setContextMenu(null);
            }}
            onOpenColorPicker={() => { setShowColorPicker(contextMenu.index); setContextMenu(null); }}
            onRename={() => {
              const entry = songChain[contextMenu.index];
              setRenameValue(entry?.label ?? getEntryLabel(entry ?? { sceneIndex: 0, repeats: 1 }));
              setRenamingIndex(contextMenu.index);
              setContextMenu(null);
            }}
            onDelete={() => {
              removeFromSongChain(contextMenu.index);
              setSelected(new Set());
              setContextMenu(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
```

### Step 3.2 — Verify TypeScript compiles (sub-components not yet defined)

- [ ] Run: `npm run build 2>&1 | head -40`
- Expected: errors referencing `ArrangementStatusBar`, `ArrangementClip`, etc. (not yet defined) — that's fine at this stage. Confirm no other unexpected errors.

---

## Task 4: `ArrangementClip` component

**Files:**
- Modify: `src/components/ArrangementView.tsx` — add `ArrangementClip` function above `ArrangementView`

This component renders a single clip cell for one track × one chain entry. It handles selection, drag, edge-resize handle, right-click, and inline rename (first track only).

### Step 4.1 — Add `WaveformMiniCanvas` helper and `ArrangementClip`

- [ ] Add the following directly above `export function ArrangementView` in `src/components/ArrangementView.tsx`:

```typescript
// ─── WaveformMiniCanvas ──────────────────────────────────────────────────────

interface WaveformMiniCanvasProps {
  bars:   number[];   // 0-1 heights
  color:  string;
  width:  number;
  height: number;
}

function WaveformMiniCanvas({ bars, color, width, height }: WaveformMiniCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const barW   = Math.max(1, Math.floor(width / bars.length) - 1);
    const usable = height * 0.85;
    bars.forEach((h, i) => {
      if (h === 0) return;
      const barH = Math.max(2, h * usable);
      const x    = Math.floor(i * (width / bars.length));
      const y    = height - barH;
      ctx.fillStyle = hexAlpha(color, 0.45);
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 1);
      ctx.fill();
    });
  }, [bars, color, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0 pointer-events-none" />;
}

// ─── ArrangementClip ─────────────────────────────────────────────────────────

interface ArrangementClipProps {
  entry:          SongChainEntry;
  clipIndex:      number;
  trackId:        TrackId;
  scene:          Scene | null;
  color:          string;
  label:          string;
  width:          number;
  height:         number;
  isFirstTrack:   boolean;
  isLastTrack:    boolean;
  isActive:       boolean;
  progress:       number;
  isSelected:     boolean;
  isDragging:     boolean;
  isDropTarget:   boolean;
  isRenaming:     boolean;
  renameValue:    string;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  onRenameChange:  (v: string) => void;
  onRenameCommit:  () => void;
  onSelect:        (multi: boolean) => void;
  onContextMenu:   (e: React.MouseEvent) => void;
  onDragStart:     (e: React.DragEvent) => void;
  onDragEnd:       () => void;
  onDragOver:      () => void;
  onDrop:          (e: React.DragEvent) => void;
  onResizeStart:   (e: React.PointerEvent) => void;
}

function ArrangementClip({
  entry, clipIndex, trackId, scene, color, label, width, height,
  isFirstTrack, isLastTrack, isActive, progress, isSelected, isDragging, isDropTarget,
  isRenaming, renameValue, renameInputRef, onRenameChange, onRenameCommit,
  onSelect, onContextMenu, onDragStart, onDragEnd, onDragOver, onDrop, onResizeStart,
}: ArrangementClipProps) {

  // ── Waveform bars ────────────────────────────────────────────────────────────
  const waveformBars = (() => {
    if (trackId === "drums" && scene) {
      const steps = scene.drumPattern.tracks.slice(0, 4).flatMap(t =>
        t.steps.slice(0, Math.min(scene.drumPattern.length ?? 16, 32))
      );
      return drumWaveformBars(steps, entry.sceneIndex);
    }
    if (trackId === "bass" && scene) {
      return bassWaveformBars(
        scene.bassSteps.slice(0, Math.min(scene.bassLength, 32))
      );
    }
    return null;
  })();

  // ── Instrument sub-label ─────────────────────────────────────────────────────
  const subLabel = (() => {
    if (!scene) return null;
    if (trackId === "drums")  return null;
    if (trackId === "bass")   return scene.rootName && scene.scaleName ? `${scene.rootName} ${scene.scaleName}` : null;
    if (trackId === "chords") return (scene.chordsParams as Record<string, unknown> | undefined)?.presetName as string | null ?? null;
    if (trackId === "melody") return (scene.melodyParams as Record<string, unknown> | undefined)?.presetName as string | null ?? null;
    return null;
  })();

  const borderRadius =
    isFirstTrack && isLastTrack ? "6px"
    : isFirstTrack ? "6px 6px 0 0"
    : isLastTrack  ? "0 0 6px 6px"
    : "0";

  return (
    <div
      className="relative overflow-hidden border-b border-black/20 select-none"
      style={{
        width, minWidth: width, height,
        backgroundColor:   hexAlpha(color, isActive ? 0.28 : 0.14),
        borderRight:       "1px solid rgba(0,0,0,0.25)",
        borderRadius,
        opacity:           isDragging ? 0.35 : 1,
        outline:           isDropTarget  ? `2px solid rgba(255,255,255,0.4)`
                         : isSelected    ? `2px solid ${hexAlpha(color, 0.8)}`
                         : "none",
        outlineOffset: "-1px",
        cursor: "grab",
      }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDrop={onDrop}
      onClick={(e) => { e.stopPropagation(); onSelect(e.metaKey || e.ctrlKey); }}
      onContextMenu={onContextMenu}
    >
      {/* Active progress shimmer */}
      {isActive && (
        <div
          className="absolute top-0 left-0 bottom-0 pointer-events-none"
          style={{ width: `${progress * 100}%`, backgroundColor: hexAlpha(color, 0.18) }}
        />
      )}

      {/* Waveform mini (drums + bass only) */}
      {waveformBars && width > 30 && (
        <WaveformMiniCanvas bars={waveformBars} color={color} width={width - 12} height={height} />
      )}

      {/* First-track labels */}
      {isFirstTrack && (
        <div className="absolute inset-0 flex flex-col justify-center px-1.5 pointer-events-none z-10">
          {isRenaming ? (
            <input
              ref={renameInputRef as React.RefObject<HTMLInputElement> | undefined}
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={onRenameCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRenameCommit();
                if (e.key === "Escape") onRenameCommit();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-[8px] font-bold bg-black/50 border border-white/20 rounded px-1 text-white outline-none pointer-events-auto"
              style={{ fontSize: 8 }}
            />
          ) : (
            <>
              <span
                className="text-[8px] font-black truncate leading-tight"
                style={{ color: hexAlpha(color, 0.95) }}
              >
                {label}
              </span>
              <span
                className="text-[7px] font-bold truncate leading-tight mt-0.5"
                style={{ color: hexAlpha(color, 0.55) }}
              >
                ×{entry.repeats}
              </span>
            </>
          )}
        </div>
      )}

      {/* Sub-label (non-drums, non-first-track) */}
      {!isFirstTrack && subLabel && width > 40 && (
        <div className="absolute inset-0 flex items-center px-1.5 pointer-events-none z-10">
          <span className="text-[7px] font-bold truncate" style={{ color: hexAlpha(color, 0.55) }}>
            {subLabel}
          </span>
        </div>
      )}

      {/* Edge resize handle — rightmost 12px */}
      <div
        className="absolute top-0 bottom-0 right-0 w-3 flex items-center justify-center cursor-col-resize z-20 hover:bg-white/10"
        onPointerDown={onResizeStart}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-0.5 h-4 rounded-full" style={{ backgroundColor: hexAlpha(color, 0.3) }} />
      </div>
    </div>
  );
}
```

### Step 4.2 — Run dev server and open Arrangement View

- [ ] Run: `npm run dev` in background
- Open browser → trigger Arrangement View
- Expected: the 5-lane grid renders with coloured clips, waveform bars visible on DRUMS/BASS rows, resize handle on right edge of each clip

### Step 4.3 — Commit

- [ ] Run:
```bash
git add src/components/ArrangementView.tsx
git commit -m "feat: ArrangementClip — colour, waveform mini, resize handle, drag"
```

---

## Task 5: `ArrangementLoopLane`

**Files:**
- Modify: `src/components/ArrangementView.tsx` — add `ArrangementLoopLane` above `ArrangementView`

The loop lane shows active loop slots for each chain entry as teal pills with the slot's `fileName`.

### Step 5.1 — Add `ArrangementLoopLane` to `ArrangementView.tsx`

- [ ] Add directly above `// ─── WaveformMiniCanvas` in `ArrangementView.tsx`:

```typescript
// ─── ArrangementLoopLane ──────────────────────────────────────────────────────

interface ArrangementLoopLaneProps {
  songChain:    SongChainEntry[];
  scenes:       (Scene | null)[];
  barPx:        number;
  height:       number;
  songPosition: number;
  songMode:     string;
  selected:     Set<number>;
  onSelect:     (i: number, multi: boolean) => void;
  onDragOver:   (i: number) => void;
  onDrop:       (e: React.DragEvent, i: number) => void;
}

function ArrangementLoopLane({
  songChain, scenes, barPx, height, songPosition, songMode, selected, onSelect, onDragOver, onDrop,
}: ArrangementLoopLaneProps) {
  return (
    <>
      {songChain.map((entry, i) => {
        const scene    = scenes[entry.sceneIndex] ?? null;
        const slots    = scene?.loopSlots?.filter(s => s.playing) ?? [];
        const w        = entry.repeats * barPx;
        const isActive = songMode === "song" && i === songPosition;
        const isSel    = selected.has(i);

        return (
          <div
            key={i}
            className="relative overflow-hidden border-r border-b border-black/20 flex items-center gap-1 px-1"
            style={{
              width: w, minWidth: w, height,
              backgroundColor: isSel
                ? hexAlpha(LOOP_COLOR, 0.18)
                : isActive
                  ? hexAlpha(LOOP_COLOR, 0.12)
                  : hexAlpha(LOOP_COLOR, 0.05),
              outline: isSel ? `1px solid ${hexAlpha(LOOP_COLOR, 0.5)}` : "none",
              outlineOffset: "-1px",
              cursor: "default",
            }}
            onClick={(e) => onSelect(i, e.metaKey || e.ctrlKey)}
            onDragOver={(e) => { e.preventDefault(); onDragOver(i); }}
            onDrop={(e) => onDrop(e, i)}
          >
            {slots.length === 0 ? (
              <span className="text-[6px] text-white/12 truncate">—</span>
            ) : (
              <>
                {slots.slice(0, 2).map((slot, si) => (
                  <span
                    key={si}
                    className={`text-[6px] font-bold px-1 py-0.5 rounded truncate ${isActive ? "animate-pulse" : ""}`}
                    style={{
                      backgroundColor: hexAlpha(LOOP_COLOR, 0.2),
                      color: hexAlpha(LOOP_COLOR, 0.9),
                      maxWidth: w / 2 - 4,
                    }}
                  >
                    ● {slot.fileName || `Slot ${si + 1}`}
                  </span>
                ))}
                {slots.length > 2 && (
                  <span className="text-[6px]" style={{ color: hexAlpha(LOOP_COLOR, 0.5) }}>
                    +{slots.length - 2}
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
```

### Step 5.2 — Verify visually

- [ ] With dev server running, open Arrangement View
- Expected: LOOPS row renders below MELODY with teal pills (if scenes have loop slots) or "—" dashes

### Step 5.3 — Commit

- [ ] Run:
```bash
git add src/components/ArrangementView.tsx
git commit -m "feat: ArrangementLoopLane — teal loop slot pills"
```

---

## Task 6: `ArrangementStatusBar`

**Files:**
- Modify: `src/components/ArrangementView.tsx` — add `ArrangementStatusBar` above `ArrangementLoopLane`

### Step 6.1 — Add `ArrangementStatusBar`

- [ ] Add directly above `// ─── ArrangementLoopLane` in `ArrangementView.tsx`:

```typescript
// ─── ArrangementStatusBar ────────────────────────────────────────────────────

interface ArrangementStatusBarProps {
  chainLength:   number;
  totalBars:     number;
  songMode:      string;
  setSongMode:   (m: "pattern" | "song") => void;
  isRecording:   boolean;
  setIsRecording: (fn: (r: boolean) => boolean) => void;
  recCount:      number;
  barPx:         number;
  setBarPx:      (fn: (px: number) => number) => void;
  onClear:       () => void;
  onClose:       () => void;
}

function ArrangementStatusBar({
  chainLength, totalBars, songMode, setSongMode,
  isRecording, setIsRecording, recCount,
  barPx, setBarPx, onClear, onClose,
}: ArrangementStatusBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-white/8 shrink-0">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[11px] font-black tracking-[0.22em] text-white/85">ARRANGEMENT</div>
          <div className="text-[7px] font-bold tracking-[0.14em] text-white/25 mt-0.5">
            {chainLength} CLIPS · {totalBars} BARS
          </div>
        </div>

        {/* Song mode toggle */}
        <button
          onClick={() => setSongMode(songMode === "song" ? "pattern" : "song")}
          className={`px-3 py-1 rounded-full text-[9px] font-black tracking-[0.18em] border transition-all ${
            songMode === "song"
              ? "border-[#10b981]/50 bg-[#10b981]/15 text-[#10b981]"
              : "border-white/10 bg-white/5 text-white/35 hover:text-white/60"
          }`}
        >
          {songMode === "song" ? "▶ SONG" : "○ PATTERN"}
        </button>

        {/* REC */}
        <button
          onClick={() => setIsRecording(r => !r)}
          className={`px-3 py-1 rounded-full text-[9px] font-black tracking-[0.18em] border transition-all ${
            isRecording
              ? "border-red-500/60 bg-red-500/20 text-red-400 animate-pulse"
              : "border-white/10 bg-white/5 text-white/35 hover:text-red-400/70 hover:border-red-500/30"
          }`}
        >
          {isRecording ? `⏺ REC +${recCount}` : "⏺ REC"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        {/* Zoom */}
        <div className="flex items-center gap-1 border border-white/8 rounded-lg px-1.5 py-1">
          <button
            onClick={() => setBarPx(px => Math.max(MIN_BAR_PX, px - 8))}
            className="w-5 h-5 text-[10px] font-bold text-white/30 hover:text-white/70 transition-colors"
          >−</button>
          <span className="text-[8px] font-mono text-white/35 w-8 text-center tabular-nums">
            {Math.round(barPx / DEFAULT_BAR_PX * 100)}%
          </span>
          <button
            onClick={() => setBarPx(px => Math.min(MAX_BAR_PX, px + 8))}
            className="w-5 h-5 text-[10px] font-bold text-white/30 hover:text-white/70 transition-colors"
          >+</button>
        </div>

        {/* Clear */}
        <button
          onClick={onClear}
          className="px-2 py-1 rounded text-[8px] font-bold text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          CLEAR
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full text-white/30 hover:text-white hover:bg-white/8 transition-all text-lg flex items-center justify-center"
        >
          ×
        </button>
      </div>
    </div>
  );
}
```

### Step 6.2 — Verify build

- [ ] Run: `npm run build 2>&1 | grep -E "error|Error" | head -20`
- Expected: only remaining errors should be `ArrangementContextMenu` and `ArrangementDetailPanel` not yet defined

---

## Task 7: `ArrangementColorPicker` + `ArrangementContextMenu`

**Files:**
- Modify: `src/components/ArrangementView.tsx` — add both components above `ArrangementStatusBar`

### Step 7.1 — Add `ArrangementColorPicker`

- [ ] Add above `// ─── ArrangementStatusBar`:

```typescript
// ─── ArrangementColorPicker ───────────────────────────────────────────────────

interface ArrangementColorPickerProps {
  currentColor?: string;
  onSelect: (color: string) => void;
}

function ArrangementColorPicker({ currentColor, onSelect }: ArrangementColorPickerProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {SCENE_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onSelect(c)}
          className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            backgroundColor: c,
            borderColor: currentColor === c ? "white" : "transparent",
          }}
          title={c}
        />
      ))}
    </div>
  );
}
```

### Step 7.2 — Add `ArrangementContextMenu`

- [ ] Add directly after `ArrangementColorPicker`:

```typescript
// ─── ArrangementContextMenu ───────────────────────────────────────────────────

interface ArrangementContextMenuProps {
  x:            number;
  y:            number;
  index:        number;
  entry:        SongChainEntry | null;
  chainLength:  number;
  onClose:      () => void;
  onDuplicate:  () => void;
  onCopy:       () => void;
  onPaste:      () => void;
  onBarsChange: (delta: number) => void;
  onOpenColorPicker: () => void;
  onRename:     () => void;
  onDelete:     () => void;
}

function ArrangementContextMenu({
  x, y, entry, onClose,
  onDuplicate, onCopy, onPaste, onBarsChange, onOpenColorPicker, onRename, onDelete,
}: ArrangementContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position so menu doesn't go off-screen
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth  - rect.width  - 8),
      top:  Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  const entryColor = entry ? getEntryColor(entry) : "#ffffff";
  const entryLabel = entry ? getEntryLabel(entry) : "";

  const Row = ({ icon, label, shortcut, onClick, red }: { icon: string; label: string; shortcut?: string; onClick: () => void; red?: boolean }) => (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-[9px] font-bold transition-colors hover:bg-white/8 text-left ${red ? "text-red-400 hover:bg-red-500/10" : "text-white/65"}`}
    >
      <span className="w-3 text-center">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="font-mono text-white/25 text-[8px]">{shortcut}</span>}
    </button>
  );

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-[rgba(18,19,26,0.98)] border border-white/12 rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] py-1 overflow-hidden min-w-[180px]"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entryColor }} />
        <span className="text-[8px] font-black text-white/70 truncate">{entryLabel}</span>
        {entry && <span className="text-[7px] text-white/30 ml-auto">×{entry.repeats}</span>}
      </div>

      <Row icon="⎘" label="Duplizieren"    shortcut="D"  onClick={onDuplicate} />
      <Row icon="⊕" label="Kopieren"       shortcut="⌘C" onClick={onCopy} />
      <Row icon="⊗" label="Einfügen danach" shortcut="⌘V" onClick={onPaste} />

      <div className="border-t border-white/6 my-0.5" />

      <Row icon="◀" label="Bars −1" shortcut="−" onClick={() => onBarsChange(-1)} />
      <Row icon="▶" label="Bars +1" shortcut="+" onClick={() => onBarsChange(1)} />

      <div className="border-t border-white/6 my-0.5" />

      <Row icon="🎨" label="Farbe wählen…" shortcut="C"  onClick={onOpenColorPicker} />
      <Row icon="✏"  label="Umbenennen…"   shortcut="F2" onClick={onRename} />

      <div className="border-t border-white/6 my-0.5" />

      <Row icon="✕" label="Löschen" shortcut="Del" onClick={onDelete} red />
    </div>
  );
}
```

### Step 7.3 — Verify

- [ ] Run: `npm run build 2>&1 | grep -E "^src.*error" | head -20`
- Expected: only `ArrangementDetailPanel` still undefined

---

## Task 8: `ArrangementDetailPanel`

**Files:**
- Modify: `src/components/ArrangementView.tsx` — add above `ArrangementColorPicker`

The detail panel shows at the bottom when a clip is selected: colour, name, bars, instrument info, and a colour picker.

### Step 8.1 — Add `ArrangementDetailPanel`

- [ ] Add above `// ─── ArrangementColorPicker`:

```typescript
// ─── ArrangementDetailPanel ───────────────────────────────────────────────────

interface ArrangementDetailPanelProps {
  songChain:       SongChainEntry[];
  scenes:          (Scene | null)[];
  selected:        Set<number>;
  showColorPicker: number | null;
  setShowColorPicker: (i: number | null) => void;
  onUpdateEntry:   (i: number, patch: Partial<SongChainEntry>) => void;
  onUpdateRepeats: (i: number, repeats: number) => void;
  onStartRename:   (i: number) => void;
  onRemove:        (i: number) => void;
}

function ArrangementDetailPanel({
  songChain, scenes, selected, showColorPicker, setShowColorPicker,
  onUpdateEntry, onUpdateRepeats, onStartRename, onRemove,
}: ArrangementDetailPanelProps) {
  // Use first selected index as primary
  const primary = selected.size > 0 ? [...selected][0]! : null;
  const entry   = primary !== null ? songChain[primary] ?? null : null;
  const scene   = entry ? scenes[entry.sceneIndex] ?? null : null;

  if (!entry || primary === null) {
    return (
      <div className="shrink-0 border-t border-white/8 px-4 py-2 flex items-center gap-3 bg-white/[0.015]">
        <span className="text-[8px] text-white/20 font-bold tracking-wider">
          Kein Clip ausgewählt — klicke einen Clip oder ↑ Szene aus der Palette hineinziehen
        </span>
      </div>
    );
  }

  const color = getEntryColor(entry);
  const label = getEntryLabel(entry);

  return (
    <div className="shrink-0 border-t border-white/8 px-4 py-2.5 flex items-center gap-4 flex-wrap bg-white/[0.02]">

      {/* Colour swatch */}
      <div
        className="w-4 h-4 rounded-full border-2 border-white/20 cursor-pointer shrink-0"
        style={{ backgroundColor: color }}
        onClick={() => setShowColorPicker(showColorPicker === primary ? null : primary)}
        title="Farbe wählen"
      />

      {/* Name */}
      <span className="text-[10px] font-black text-white/80">{label}</span>
      <span className="text-[8px] text-white/35">Scene {entry.sceneIndex + 1}</span>

      {/* Bars control */}
      <div className="flex items-center gap-1 border border-white/8 rounded px-1 py-0.5">
        <button
          onClick={() => onUpdateRepeats(primary, Math.max(MIN_REPEATS, entry.repeats - 1))}
          className="text-[10px] font-bold text-white/40 hover:text-white/80 w-4 h-4 transition-colors"
        >−</button>
        <span className="text-[9px] font-mono text-white/60 w-6 text-center tabular-nums">{entry.repeats}</span>
        <button
          onClick={() => onUpdateRepeats(primary, Math.min(MAX_REPEATS, entry.repeats + 1))}
          className="text-[10px] font-bold text-white/40 hover:text-white/80 w-4 h-4 transition-colors"
        >+</button>
        <span className="text-[7px] text-white/25 ml-0.5">bars</span>
      </div>

      {/* Instrument info */}
      {scene && (
        <div className="flex items-center gap-3 text-[7px] text-white/35">
          {scene.rootName && <span>BASS: {scene.rootName} {scene.scaleName}</span>}
          {(scene.chordsParams as Record<string, unknown> | undefined)?.presetName && (
            <span>CHORDS: {String((scene.chordsParams as Record<string, unknown>).presetName)}</span>
          )}
        </div>
      )}

      {/* Tempo change (retained from v2) */}
      <label className="flex items-center gap-1.5 text-[8px] text-white/40 cursor-pointer ml-auto">
        <input
          type="checkbox"
          checked={entry.tempoBpm !== undefined}
          onChange={(e) => onUpdateEntry(primary, {
            tempoBpm:  e.target.checked ? 120 : undefined,
            tempoRamp: e.target.checked ? false : undefined,
          })}
          className="accent-[#22c55e]"
        />
        Tempo
      </label>
      {entry.tempoBpm !== undefined && (
        <input
          type="number" min={60} max={200}
          value={entry.tempoBpm}
          onChange={(e) => onUpdateEntry(primary, { tempoBpm: parseInt(e.target.value) || 120 })}
          className="w-14 h-6 px-1 text-[10px] bg-black/30 border border-white/15 rounded text-white font-mono"
        />
      )}

      {/* Rename */}
      <button
        onClick={() => onStartRename(primary)}
        className="text-[8px] text-white/25 hover:text-white/60 border border-white/8 rounded px-1.5 py-0.5 transition-colors"
      >
        ✏ Umbenennen
      </button>

      {/* Remove */}
      <button
        onClick={() => onRemove(primary)}
        className="text-[8px] text-red-400/40 hover:text-red-400 transition-colors ml-1"
      >
        ✕
      </button>

      {/* Colour picker (expanded) */}
      {showColorPicker === primary && (
        <div className="w-full flex items-center gap-2 mt-1">
          <span className="text-[7px] text-white/30 font-bold">FARBE:</span>
          <ArrangementColorPicker
            currentColor={entry.color}
            onSelect={(c) => {
              onUpdateEntry(primary, { color: c });
              setShowColorPicker(null);
            }}
          />
          {entry.color && (
            <button
              onClick={() => { onUpdateEntry(primary, { color: undefined }); setShowColorPicker(null); }}
              className="text-[7px] text-white/30 hover:text-white/60 transition-colors"
            >
              zurücksetzen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 8.2 — Build clean

- [ ] Run: `npm run build 2>&1 | grep -E "error TS" | head -20`
- Expected: 0 TypeScript errors

### Step 8.3 — Run all tests

- [ ] Run: `npm test`
- Expected: all tests PASS (arrangementColors: 6/6, waveformMini: 7/7)

### Step 8.4 — Commit

- [ ] Run:
```bash
git add src/components/ArrangementView.tsx
git commit -m "feat: arrangement view — detail panel, colour picker, context menu, status bar"
```

---

## Task 9: Final wiring + visual verification

**Files:**
- No new files — verify everything works end-to-end

### Step 9.1 — Verify 5-lane layout

- [ ] Open dev server: `npm run dev`
- Open Arrangement View (Song tab → ARRANGEMENT button)
- Add at least 3 scenes to the chain via scene palette
- Expected:
  - 5 rows visible: DRUMS, BASS, CHORDS, MELODY, LOOPS
  - Each row shows clips with the same scene colours
  - Waveform bars visible on DRUMS and BASS rows
  - LOOPS row shows teal pills (or "—" if no loops)
  - Ruler with bar numbers at top
  - Playhead visible when Song mode active

### Step 9.2 — Verify clip interactions

- [ ] Click a clip → it gets a coloured border (selected)
- [ ] ⌘+click another clip → both selected (multi-select)
- [ ] Click empty space → deselect all
- [ ] Drag clip body to new position → clip reorders
- [ ] Alt+drag clip → a copy appears at target position
- [ ] Drag right-edge handle → clip width changes (repeats updates)
- [ ] Right-click clip → context menu opens with correct entry name/colour

### Step 9.3 — Verify keyboard shortcuts

- [ ] Select a clip, press `D` → duplicate appears right after
- [ ] Press `Del` → clip deleted
- [ ] Press `←` / `→` → clip moves one position
- [ ] Press `-` / `+` → clip repeats decrease/increase (verify in detail panel)
- [ ] Press `C` → colour picker appears in detail panel
- [ ] Press `F2` → inline rename input appears in clip
- [ ] Press `Esc` → deselects / closes menu

### Step 9.4 — Verify playhead

- [ ] Enable Song Mode → trigger play
- [ ] Expected: white vertical line + triangle cap moves across all 5 rows

### Step 9.5 — Verify REC mode

- [ ] Press REC → switch scenes → each scene-switch adds a clip to the chain
- [ ] Counter in REC button increments

### Step 9.6 — Run full test suite and build

- [ ] Run: `npm test && npm run build`
- Expected: all tests PASS, build completes with 0 errors

### Step 9.7 — Final commit

- [ ] Run:
```bash
git add -A
git commit -m "feat: arrangement view v3 — 5-lane DAW sequencer complete"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| 5 lanes: DRUMS, BASS, CHORDS, MELODY, LOOPS | Task 3 (main structure) + Task 5 (loop lane) |
| Scene colours (8 predefined + user override) | Task 1 (utilities) + Task 7 (picker) + Task 8 (panel) |
| Waveform mini on DRUMS/BASS | Task 2 (helpers) + Task 4 (clip renders canvas) |
| Loop Lane: teal pills from `scene.loopSlots` | Task 5 |
| Clip label + "×N" repeats display | Task 4 |
| Instrument sub-label (BASS: root+scale, CHORDS/MELODY: preset) | Task 4 |
| Click → select, ⌘Click → multi-select | Task 3 (`selectEntry`) |
| Drag body → reorder | Task 3 (`handleEntryDrop` + `moveSongEntry`) |
| Alt+Drag → copy | Task 3 (`isDragCopy` flag + copy branch in `handleEntryDrop`) |
| Edge-drag → resize repeats | Task 3 (pointer events in `useEffect`) |
| Right-click → context menu | Task 7 (`ArrangementContextMenu`) |
| Keyboard: D, Del, ⌘C/V, −/+, ←→, C, F2, Esc | Task 3 (keyboard `useEffect`) |
| Detail panel: colour, name, bars, tempo | Task 8 |
| Colour picker 8-dot | Task 7 + Task 8 |
| Inline rename (F2 / context menu) | Task 3 + Task 4 (input in clip first-track) |
| Playhead across all 5 rows | Task 3 |
| REC mode: scene → auto-append | Task 3 |
| Zoom (⌘+scroll + buttons) | Task 3 |
| `color?` + `label?` on `SongChainEntry` | Task 1 |
| `updateSongEntry` reused unchanged | Task 3 (confirmed — no store changes) |

### Placeholder check

None found — all steps contain complete code.

### Type consistency check

- `getEntryColor`, `getEntryLabel`, `hexAlpha` defined in Task 1 → used in Tasks 3–8 ✓
- `drumWaveformBars`, `bassWaveformBars` defined in Task 2 → used in Task 4 ✓
- `SongChainEntry.color?`, `.label?` defined in Task 1 → used in Tasks 3, 4, 7, 8 ✓
- `ArrangementClipProps.onResizeStart` defined in Task 4 → wired in Task 3 ✓
- `MIN_REPEATS`, `MAX_REPEATS` constants defined in Task 3 → used in Tasks 3, 6, 8 ✓
- `LOOP_COLOR` imported from `arrangementColors` in Task 3 → used in Tasks 5, 6 ✓
