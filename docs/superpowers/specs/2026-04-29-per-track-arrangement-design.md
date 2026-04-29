# Per-Track Arrangement — Design Spec

**Date:** 2026-04-29  
**Status:** Approved  
**Phase:** 1 (Drums, Bass, Chords, Melody) — Loops/Sampler in Phase 2

---

## Goal

Replace the scene-based song chain in the Arrangement view with a full per-track clip timeline. Each instrument track (Drums, Bass, Chords, Melody) has its own independent row of clips. Clips on different tracks can start and stop at different bars, enabling complete song production — not just looping scenes.

---

## What Changes, What Stays

| System | Change |
|--------|--------|
| `ArrangementView.tsx` | Major refactor — new per-track render + interaction |
| `arrangementStore.ts` | **New file** — replaces scene-based `songChain` |
| Drum scheduler (song mode) | Updated to read per-track clips instead of scene chain |
| Bass / Chords / Melody schedulers | Updated to read per-track clips |
| `sceneStore.ts` | **Unchanged** — stays for ClipLauncher (live performance) |
| ClipLauncher | **Unchanged** — orthogonal live-performance tool |
| Pattern Mode | **Unchanged** — editing patterns still works as before |

---

## Data Model

### `ArrangementClip`

```typescript
interface ArrangementClip {
  id: string;
  trackId: "drums" | "bass" | "chords" | "melody";
  startBar: number;       // 0-indexed bar position in the timeline
  lengthBars: number;     // visual length (can exceed pattern length → loops internally)
  name: string;
  color?: string;         // hex override; falls back to track color
  data: DrumClipData | BassClipData | ChordsClipData | MelodyClipData;
}
```

### Per-track clip data

```typescript
interface DrumClipData {
  pattern: PatternData;                      // 12 tracks × up to 64 steps
  voiceParams?: Record<string, number>[];    // optional: per-voice param snapshot
}

interface BassClipData {
  steps: BassStep[];
  length: number;        // 8 | 16 | 32 | 64
  params?: BassParams;   // optional: synth param snapshot
}

interface ChordsClipData {
  steps: ChordsStep[];
  length: number;
  params?: ChordsParams;
}

interface MelodyClipData {
  steps: MelodyStep[];
  length: number;
  params?: MelodyParams;
}
```

**Rule:** `steps` / `pattern` are always present. `params` / `voiceParams` are optional — a clip can carry its own synth sound or inherit the global track settings.

### `arrangementStore`

```typescript
interface ArrangementState {
  clips: ArrangementClip[];
  totalBars: number;       // auto-extends when clips are added beyond current end

  addClip: (clip: Omit<ArrangementClip, "id">) => string;  // returns new id
  removeClip: (id: string) => void;
  moveClip: (id: string, startBar: number) => void;
  resizeClip: (id: string, lengthBars: number) => void;
  renameClip: (id: string, name: string) => void;
  setClipColor: (id: string, color: string) => void;
  updateClipData: (id: string, data: ArrangementClip["data"]) => void;

  // Playback helpers (read-only derived)
  getActiveClip: (trackId: string, bar: number) => ArrangementClip | null;
}
```

`getActiveClip(trackId, bar)` returns the clip whose `[startBar, startBar + lengthBars)` range contains `bar`, or `null` (gap = silence).

---

## Arrangement View UI

### Layout (Option C — approved)

```
┌─────────────────────────────────────────────────────────┐
│  ARRANGEMENT  [PATTERN] [ARRANGEMENT*] [SCENE]   zoom −+ │
├─────────────────────────────────────────────────────────┤
│ Transport: ▶ PLAY  ■ STOP  Bar 7 · Beat 2  128 BPM      │
├────────────────────────────────────────────────────────-┤
│         │  1    2    3    4    5    6    7▌   8 …       │
├─ SEQUENCER ──────────────────────────────────────────────┤
│ DRUMS   ║ [Intro ──] [Intro ──]  ✕  [DROP ──────] [Out] │
│ BASS    ║       [Acid Line Am ────────] [Breakdown ─]    │
│ CHORDS  ║              [Pad Cmaj7 ─────────────]         │
│ MELODY  ║                         [Lead Riff ──] [Outro] │
├─ LOOPS / SAMPLER (Phase 2) ──────────────────────────────┤
│ LOOPS   ║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│ SAMPLER ║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
└─────────────────────────────────────────────────────────┘
```

- Each track has a **3px colored left border** (Drums=red, Bass=teal, Chords=purple, Melody=yellow)
- Track header shows: name, current key/scale (Bass/Chords/Melody), volume %, mute/solo buttons
- **Playhead** = vertical red line, moves in real-time during playback
- **Gap** = dashed empty rectangle with ✕ — clicking it does nothing (explicit silence)
- **Clip** = colored block with step-density mini-preview (bar chart of active steps)
- **Clips with synth params** show a small badge: `synth params: Pad Warm ✓`

### Track heights

All 4 sequencer tracks: **44px**  
Loops / Sampler placeholders: **36px** (dimmed, "Phase 2")

### Clip interactions

| Action | Result |
|--------|--------|
| Drag on empty track area | Draw new empty clip (width = bars dragged) |
| Click empty clip → double-click | Open that track's tab, scoped to this clip |
| Drag clip horizontally | Move to new bar position |
| Drag right edge | Resize (change `lengthBars`) |
| Alt + drag | Duplicate clip |
| Right-click | Context menu: rename, color, delete, capture current, detach params |
| Double-click filled clip | Open track tab scoped to this clip |
| Delete / Backspace | Delete selected clip |
| Ctrl+Z / Ctrl+Shift+Z | Undo / Redo (via existing `useUndoRedo` hook) |

### Mode toggle

Three buttons in the arrangement toolbar:  
`PATTERN` · `ARRANGEMENT` (active) · `SCENE`

- **PATTERN** → existing per-instrument pattern editors (current default behavior)
- **ARRANGEMENT** → new per-track timeline (this feature)
- **SCENE** → existing ClipLauncher / scene palette

---

## Clip Creation Workflow

### Method 1 — From the Pattern Tab

Any pattern tab (Drums, Bass, Chords, Melody) gets a new **`+ Arrangement`** button in its toolbar. Pressing it:

1. Captures the current pattern state as a new clip
2. Places it at the current playhead bar (or first gap on that track)
3. Switches view to Arrangement so the user sees the result

### Method 2 — Draw in Arrangement

1. Hover over an empty area on a track row → cursor becomes crosshair
2. Click + drag → creates a new empty clip spanning the dragged bars
3. Double-click the new clip → opens the corresponding pattern tab scoped to this clip
4. Editing in the tab writes back to `clip.data` in real time
5. Closing / switching back to Arrangement saves automatically

---

## Playback Engine

### Arrangement mode flag

`useDrumStore` gains a new field: `arrangementMode: boolean` (default `false`). When `true`, the drum scheduler ignores `songChain` and reads from `arrangementStore` instead.

### Drum scheduler changes

At each bar boundary (`nextStep === 0`, `nextBar++`):

```
activeClip = arrangementStore.getActiveClip("drums", currentBar)

if (activeClip === null):
  → silence: do not schedule any voices this bar

if (activeClip changed since last bar:
  → apply activeClip.data.pattern to current drum pattern state
  → if activeClip.data.voiceParams: apply voice params (non-destructive restore on clip exit)
```

The clip's `pattern` loops internally when `lengthBars > pattern.length / 16`. Example: a 1-bar (16-step) pattern in a 4-bar clip plays 4 times.

### Bass / Chords / Melody schedulers

Same pattern: at each bar boundary, check `getActiveClip` for their track. On clip change:
- Apply `steps` + `length` to the respective store
- If `params` present: apply to synth engine
- On clip exit (gap or new clip): if previous clip had `params`, restore the track's baseline params

### Baseline params

Each track stores its **baseline params** separately from clip params. When a clip with `params` is active, those override the baseline. When a gap follows, baseline is restored. This prevents the "my synth sounds wrong after the clip ends" problem.

Baseline params live in the existing stores (`useBassStore.params`, etc.) and are set from the Pattern tab as usual.

---

## What is NOT in Phase 1

- Loops track in arrangement (Phase 2)
- Sampler track in arrangement (Phase 2)
- Melody Layers track in arrangement (Phase 2)
- Audio recording into arrangement clips
- Clip fade-in / fade-out handles
- Clip gain/volume per clip (global track volume only)
- MIDI export of the full arrangement (existing MIDI export still works on current pattern)

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `src/store/arrangementStore.ts` | **Create** — new Zustand store |
| `src/components/ArrangementView.tsx` | **Major refactor** — per-track render + new interactions |
| `src/store/drumStore.ts` | Add `arrangementMode` flag; update scheduler bar-boundary logic |
| `src/store/bassStore.ts` | Add bar-boundary clip-read hook |
| `src/store/chordsStore.ts` | Add bar-boundary clip-read hook |
| `src/store/melodyStore.ts` | Add bar-boundary clip-read hook |
| Each pattern tab (Bass303, ChordsEngine UI, MelodyTab, DrumPadGrid) | Add `+ Arrangement` button |

---

## Error Handling

- Clip overlap on same track: **rejected** — the store prevents two clips from overlapping on the same track. The UI shows a visual warning (red tint) when dragging into an occupied range.
- Clip data mismatch (e.g. future schema changes): silently skip params, log warning. Steps always applied.
- `arrangementMode` toggled mid-playback: snap to next bar boundary before switching.

---

## Non-Goals

- This does not replace the scene system for live performance (ClipLauncher stays)
- This does not add audio tracks (samples/loops as raw audio) — that is a separate future feature
- This does not change the WASM DSP architecture
