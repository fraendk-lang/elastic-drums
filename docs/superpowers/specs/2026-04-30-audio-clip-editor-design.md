# Audio Clip Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-destructive trim handles, ⌘E clip-split, fade in/out, and a detail panel to the AUDIO track in the Arrangement View.

**Architecture:** Extend `AudioClip` with four new fields (`sampleStartSec`, `sampleEndSec`, `fadeInSec`, `fadeOutSec`). The trim handles live directly on the clip in `AudioClipLane`; split creates two replacement clips. The existing `ArrangementDetailPanel` renders an audio-clip branch when `selectedAudioClipId` is set. The `audioClipEngine` uses the new fields for precise playback scheduling.

**Tech Stack:** React, Zustand, Web Audio API (`AudioBufferSourceNode`, `GainNode`, `AudioParam` ramps), TypeScript strict mode, Tailwind CSS.

---

## Data Model

### AudioClip (extended)

```typescript
export interface AudioClip {
  // existing
  id:            string;
  startBar:      number;
  durationBars:  number;
  fileName:      string;
  buffer:        AudioBuffer;
  waveformPeaks: Float32Array;
  volume:        number;
  color:         string;

  // new
  sampleStartSec: number;   // seconds into buffer where playback begins (default 0)
  sampleEndSec:   number;   // seconds into buffer where playback ends (default buffer.duration)
  fadeInSec:      number;   // fade-in duration in seconds (default 0)
  fadeOutSec:     number;   // fade-out duration in seconds (default 0)
}
```

New store actions:
- `setTrimPoints(id, startSec, endSec)` — clamp to `[0, buffer.duration]`, ensure start < end
- `setFades(id, fadeIn, fadeOut)` — clamp to `[0, (sampleEndSec - sampleStartSec) / 2]`
- `splitClip(id, splitAtSec)` — remove clip, insert two replacement clips

`addClip` sets defaults: `sampleStartSec: 0`, `sampleEndSec: buffer.duration`, `fadeInSec: 0`, `fadeOutSec: 0`.

---

## Interaction Design

### Trim Handles on AudioClipLane

Two handle types coexist on each audio clip:

| Handle | Position | What it changes |
|--------|----------|----------------|
| **Trim-Left** | Left clip edge (inside existing left padding) | `sampleStartSec` |
| **Trim-Right** | Right clip edge (inside existing right padding) | `sampleEndSec` |
| **Resize** (existing) | Far-right edge (outside clip) | `durationBars` |

**Visual treatment:**
- Trim handles: orange `▌` bar (4px wide, full clip height), slightly inset from clip edge
- Region between clip edge and trim handle: waveform dimmed to 30% opacity (excluded audio)
- Fade overlay: left triangle gradient for fade-in, right triangle for fade-out

**Drag behaviour:**
- Free precision (seconds) by default
- **Shift held**: snaps to nearest bar boundary (`Math.round(sec / secPerBar) * secPerBar`)
- Left trim cannot exceed right trim minus 0.1s (minimum audible region)
- Right trim cannot exceed `buffer.duration`

### Split (⌘E)

- While hovering a selected audio clip, a thin vertical white line tracks cursor X position
- `splitAtSec` = `(cursorX - clipLeft) / clipWidth * (sampleEndSec - sampleStartSec) + sampleStartSec`
- ⌘E (or Ctrl+E on Windows) fires split:
  - **Clip 1**: `startBar` unchanged, `durationBars` reduced to `splitAtSec - sampleStartSec` in bars, `sampleStartSec` unchanged, `sampleEndSec = splitAtSec`
  - **Clip 2**: `startBar = splitBar` (derived from splitAtSec), `durationBars` = remaining bars, `sampleStartSec = splitAtSec`, `sampleEndSec` unchanged
- If no clip is hovered/selected, ⌘E is a no-op

### Selection

- Click on audio clip → sets `selectedAudioClipId` in ArrangementView state
- Click elsewhere in the arrangement → clears selection
- Selected clip gets a brighter border (`rgba(249,115,22,0.8)`)

---

## Detail Panel

`ArrangementDetailPanel` gains an audio-clip branch. When `selectedAudioClip` is passed as a prop (non-null), it renders:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ AUDIO CLIP — vocal.wav                                                  │
│ [SAMPLE START 0.00s] [SAMPLE END 3.20s] [FADE IN 0.0s] [FADE OUT 0.0s] [VOL 100%]   [⌘E SPLIT] [⌫] │
└─────────────────────────────────────────────────────────────────────────┘
```

- All numeric fields: `<input type="number" step="0.01">` with live update on change
- VOL: 0–100 integer (maps to 0–1 in store)
- **⌘E SPLIT** button: triggers split at current hover position (or midpoint if cursor not over clip)
- **⌫ DELETE** button: removes clip, clears selection
- When no audio clip is selected, the panel falls back to the existing scene-clip detail view

---

## Playback Engine Changes (`audioClipEngine.ts`)

### startClip — updated signature

```typescript
function startClip(clip: AudioClip, startAtTime: number): void {
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return;
  stopClip(clip.id);

  const src  = ctx.createBufferSource();
  src.buffer = clip.buffer;

  const gain = ctx.createGain();
  src.connect(gain);
  gain.connect(ctx.destination);

  const playDuration = clip.sampleEndSec - clip.sampleStartSec;
  const when = Math.max(ctx.currentTime, startAtTime);

  // Fade in
  if (clip.fadeInSec > 0) {
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(clip.volume, when + clip.fadeInSec);
  } else {
    gain.gain.setValueAtTime(clip.volume, when);
  }

  // Fade out
  if (clip.fadeOutSec > 0) {
    const fadeOutStart = when + playDuration - clip.fadeOutSec;
    gain.gain.setValueAtTime(clip.volume, fadeOutStart);
    gain.gain.linearRampToValueAtTime(0, when + playDuration);
  }

  src.start(when, clip.sampleStartSec);
  src.stop(when + playDuration);

  src.onended = () => { _playing.delete(clip.id); };
  _playing.set(clip.id, src);
}
```

### seekAudioClips — updated mid-clip offset

When seeking to bar N, mid-clip offset must account for `sampleStartSec`:

```typescript
const offset = clip.sampleStartSec + (nowSec - clipStartSec);
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/store/audioClipStore.ts` | Add 4 fields to `AudioClip`, add `setTrimPoints`, `setFades`, `splitClip` actions, update `addClip` defaults |
| `src/audio/audioClipEngine.ts` | Update `startClip` for trim/fade, update `seekAudioClips` offset |
| `src/components/ArrangementView.tsx` | `AudioClipLane`: trim handles + hover cursor + ⌘E handler + selection state; `ArrangementDetailPanel`: audio-clip branch |

---

## Constraints & Edge Cases

- **Trim vs. Resize**: trim-left/right handles are visually inside the clip; the resize handle is outside the right edge. They must not interfere.
- **Minimum region**: `sampleEndSec - sampleStartSec ≥ 0.1s` enforced in store.
- **Split at boundary**: if `splitAtSec` is within 0.05s of `sampleStartSec` or `sampleEndSec`, split is a no-op.
- **Backward compatibility**: existing clips without the new fields get defaults via store initializer (`?? 0`, `?? buffer.duration`).
- **Fade clamping**: `fadeInSec + fadeOutSec ≤ playDuration` (half-each rule if over).
