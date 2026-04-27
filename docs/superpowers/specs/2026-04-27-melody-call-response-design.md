# Melody Call & Response — Design Spec

**Date:** 2026-04-27
**Status:** Approved

---

## Overview

Add a Call & Response mode to the MELODY tab. When enabled, the melody is split into two voices — **Call** and **Response** — that alternate strictly: Call plays its bars, then Response answers with its own bars. Both voices have independent synth settings and are edited via embedded Piano Rolls.

---

## Decisions Made

| Question | Answer |
|---|---|
| Alternation model | Strict (A plays, then B — never simultaneous) |
| Bar length | Configurable: 1, 2, or 4 bars per voice |
| Response sound | Independent synth settings; optional "= CALL" link |
| UI placement | Inside MELODY tab — C&R toggle + CALL/RESPONSE sub-tabs |
| Note editing | Inline Piano Roll for each voice |
| Architecture | One store, two note arrays, one scheduler, two engine instances |

---

## Data Model

### `MelodyCRNote`

```typescript
interface MelodyCRNote {
  id: string             // crypto.randomUUID()
  startBeat: number      // beat position within the voice's own bar window
  durationBeats: number  // note length in beats
  pitch: number          // MIDI note number 0–127
}
```

### `SynthSettings`

```typescript
interface SynthSettings {
  presetIndex: number    // index into MELODY_PRESETS
  octaveOffset: number   // -2 to +2 semitone octave shift (applied as transpose)
  cutoff: number         // 0–1, applied to melodyEngine filter cutoff
  linkToCall: boolean    // Response only: mirror callSynth settings when true
}
```

### `MelodyCRState` (Zustand)

```typescript
interface MelodyCRState {
  enabled: boolean                    // C&R mode on/off
  barLength: 1 | 2 | 4               // bars per voice
  activeVoice: "call" | "response"    // which sub-tab is shown
  callNotes: MelodyCRNote[]
  responseNotes: MelodyCRNote[]
  callSynth: SynthSettings
  responseSynth: SynthSettings        // linkToCall=true mirrors callSynth
  totalBeats: number                  // derived: barLength * 4 (per voice)
}

// Actions
setEnabled(enabled: boolean): void
setBarLength(bars: 1 | 2 | 4): void
setActiveVoice(voice: "call" | "response"): void
addCallNote(note: MelodyCRNote): void
addResponseNote(note: MelodyCRNote): void
removeCallNote(id: string): void
removeResponseNote(id: string): void
updateCallNote(id: string, patch: Partial<MelodyCRNote>): void
updateResponseNote(id: string, patch: Partial<MelodyCRNote>): void
setCallSynth(patch: Partial<SynthSettings>): void
setResponseSynth(patch: Partial<SynthSettings>): void
clearCallNotes(): void
clearResponseNotes(): void
```

---

## Audio Architecture

### Engine Instances

```typescript
// src/audio/melodyCREngines.ts
import { melodyEngine } from "./MelodyEngine"
import { MelodyEngine } from "./MelodyEngine"

export const callCREngine = melodyEngine          // reuse existing instance for Call
export const responseCREngine = new MelodyEngine() // new instance for Response
```

Both engines route through the existing audio graph (master gain, reverb/delay sends). `responseCREngine` is initialized identically to `melodyEngine` and connected at creation time.

### Scheduler — `melodyCRScheduler.ts`

Subscribes to `drumCurrentStepStore` (same pattern as `chordPianoScheduler.ts`).

**Step logic:**

```
fullCycleBeats = barLength * 8          // Call + Response combined
callBeats      = barLength * 4
totalSteps     = fullCycleBeats * 4     // in 16th notes
callSteps      = callBeats * 4

wrappedStep = stepCounter % totalSteps

if wrappedStep < callSteps:
  localStep = wrappedStep
  play callNotes where startBeat == localStep / 4  → via callCREngine

else:
  localStep = wrappedStep - callSteps
  play responseNotes where startBeat == localStep / 4  → via responseCREngine
```

**Timing:** Uses `getDrumCurrentStepAudioTime()` as the lookahead audio timestamp (same pattern as chordPianoScheduler — no additional offset). Release pre-scheduled via `engine.releaseNote(t + durationBeats * secPerBeat)`.

**Guard:** Scheduler only runs when `useMelodyCRStore.getState().enabled === true`. When disabled, the existing melodyEngine/melodyStore flow continues unaffected.

**Engine mute during C&R:** When `enabled = true`, the existing melody scheduler (`melodyEngine`) is paused by skipping its tick (same chordsSource guard pattern used in `chordsStore.ts`).

**Loop wrap:** On `wrappedStep === 0 && advanced`: release all active notes on both engines.

**HMR:** `import.meta.hot.dispose()` unsubscribes both store listeners.

### Synth Settings Application

When the user changes `callSynth` or `responseSynth`, apply immediately:
- `presetIndex` → for `callCREngine` (= `melodyEngine`): call `useMelodyStore.getState().loadPreset(index)` which applies preset params to the engine. For `responseCREngine`: read `MELODY_PRESETS[index]` and call engine methods directly (same params, different instance).
- `octaveOffset` → add `octaveOffset * 12` to each note's `pitch` at trigger time (not stored in note data)
- `cutoff` → `engine.setCutoff(value)` — call directly on the engine instance
- `responseSynth.linkToCall = true` → at trigger time, read `callSynth` values and apply to `responseCREngine` instead of `responseSynth` (not stored as duplicate data)

---

## UI

### MELODY Tab Changes (`MelodySequencer.tsx`)

Add to the top toolbar row:

```
[C&R: OFF ⟷ ON]    (when ON:)   [▶ CALL]  [RESPONSE]   BARS: [1][2][4]
```

When `enabled = false`: render existing `<MelodySequencer>` content unchanged.

When `enabled = true`: replace sequencer body with the `<MelodyCREditor>` component.

### `MelodyCREditor` Component

New component at `src/components/MelodyCR/index.tsx`.

Layout:
```
┌─────────────────────────────────────────────────────┐
│  [▶ CALL]  [RESPONSE]                [BARS: 1|2|4]  │
├─────────────────────────────────────────────────────┤
│                                                      │
│   Piano Roll (inline, ~180px tall)                   │
│   Y-axis: C3–C6 (37 semitones, 14px per row)        │
│   X-axis: barLength bars                             │
│   Click = add note, Right-click = delete             │
│   Drag right edge = resize duration                  │
│   Playhead triangle during playback                  │
│                                                      │
├─────────────────────────────────────────────────────┤
│  Preset: [dropdown ▾]  Oct: [-2][-1][0][+1][+2]    │
│  Cutoff: ────────●──────────────                     │
│  (Response only) [= CALL] toggle                     │
└─────────────────────────────────────────────────────┘
```

### Piano Roll (inline)

- **No overlay** — embedded directly in the tab, max-height ~180px with vertical scroll
- Pitch range: C3 (MIDI 48) to C6 (MIDI 84), 37 rows
- Row height: 14px (same as ChordPianoRoll)
- Black key rows: slightly darker background
- Scale highlighting: root notes tinted orange (matches ChordPianoRoll pattern). Add `rootNote: number` (0–11, default 0 = C) to `MelodyCRState`; the piano roll tints every row where `pitch % 12 === rootNote`.
- Notes: colored rectangles — Call = pink `#f472b6`, Response = green `#22c55e`
- Ghost preview on hover (same pattern as ChordPianoRoll)
- Playhead: vertical line driven by `melodyCRCurrentBeatStore` (external store, same pattern as `chordPianoCurrentBeatStore`)
- Ruler: bar numbers above grid

### Synth Panel

Below the piano roll. Shows settings for the active voice (`activeVoice`).

For **RESPONSE** voice only: `[= CALL]` toggle button. When active, all controls are greyed out and mirror Call's values.

---

## File Map

| File | Change |
|---|---|
| `src/store/melodyCRStore.ts` | **NEW** — Zustand store |
| `src/audio/melodyCREngines.ts` | **NEW** — callCREngine + responseCREngine |
| `src/components/MelodyCR/melodyCRScheduler.ts` | **NEW** — step-clock subscriber |
| `src/components/MelodyCR/index.tsx` | **NEW** — editor component (piano roll + synth panel) |
| `src/components/MelodySequencer.tsx` | **MODIFY** — C&R toggle + conditional render |
| `src/audio/MelodyEngine.ts` | **MODIFY** — ensure constructor is public + engine can be instantiated multiple times |
| `src/store/melodyStore.ts` | **MODIFY** — add guard to skip tick when C&R enabled (same pattern as chordsStore.ts) |
| `src/store/sceneStore.ts` | **MODIFY** — capture/restore melodyCR state |

---

## Scene Integration

`captureScene` adds:
```typescript
melodyCR?: {
  enabled: boolean
  barLength: 1 | 2 | 4
  callNotes: MelodyCRNote[]
  responseNotes: MelodyCRNote[]
  callSynth: SynthSettings
  responseSynth: SynthSettings
}
```

`loadScene` restores all fields via store actions (deep clone, same pattern as chordPianoNotes).

---

## Out of Scope

- Melody generator (GEN button) for Response voice — stays as-is, applies to Call only
- MIDI record into C&R Piano Roll
- Per-note velocity in the inline Piano Roll (future enhancement)
- More than 2 voices (Call + Response is the full feature)
