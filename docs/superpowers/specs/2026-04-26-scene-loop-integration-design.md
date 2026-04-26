# Scene + Loop Integration — Design Spec

## Goal

Scenes capture and restore Loop Player state alongside sequencer state. Scene switches coordinate loop start/stop at the bar boundary so transitions feel seamless.

---

## Problem

`captureScene()` snapshots drum, bass, chords, melody — but ignores the Loop Player. When a scene loads, loops keep running regardless of what was active when the scene was recorded. There is no way to build a song with loops that change per scene.

---

## Design Decision: "Keep Running" Default

If a loop slot is playing in both Scene A and Scene B, it keeps playing without interruption — only volume/transpose/warpMode adjust. This is the Ableton Live behaviour and the most musical default.

Only slots that change state (playing→stopped or stopped→playing) are touched at the transition.

---

## Data Model

### New type: `LoopSceneState` (in `src/store/sceneStore.ts`)

```typescript
export interface LoopSceneState {
  playing:         boolean;   // was this slot active?
  volume:          number;    // 0–1
  transpose:       number;    // semitone offset −24…+24
  warpMode:        WarpMode;  // 'repitch' | 'beats' | 'complex'
  originalBpm:     number;    // native loop tempo
  firstBeatOffset: number;    // beat-grid alignment in seconds
  loopEndSeconds:  number;    // loop region end (0 = full file)
}
```

`AudioBuffer` and `waveformPeaks` are **not** saved — too large to serialize and already held in memory from the user's file load. A slot with `playing: true` in the scene but no loaded buffer is silently skipped (graceful).

### Updated `Scene` interface

```typescript
export interface Scene {
  // ... existing fields unchanged ...
  loopSlots?: LoopSceneState[];  // 8 entries, one per slot
                                  // undefined = legacy scene recorded before this feature
}
```

---

## Files Changed

| File | Change |
|---|---|
| `src/store/sceneStore.ts` | Add `LoopSceneState` type, add `loopSlots` to `Scene`, update `captureScene()` and `loadScene()` |
| `src/store/loopPlayerStore.ts` | Add `loadSceneSlots(targetSlots: LoopSceneState[])` action to `LoopPlayerStore` interface + implementation |

---

## Implementation

### 1. `loopPlayerStore.ts` — new action `loadSceneSlots`

Added to the `LoopPlayerStore` interface:
```typescript
loadSceneSlots(targetSlots: LoopSceneState[]): void;
```

Implementation (inside the store factory):

```typescript
loadSceneSlots: (targetSlots) => {
  const currentSlots = get().slots;
  const globalBpm = useDrumStore.getState().bpm;
  const ctx = loopPlayerEngine.getAudioContext();
  const now = ctx?.currentTime ?? 0;

  const nextSlots = currentSlots.map((cur, i) => {
    const target = targetSlots[i];
    if (!target) return cur;

    const wasPlaying = cur.playing;
    const willPlay   = target.playing;

    // Always apply non-destructive params to store state
    const updated: LoopSlotState = {
      ...cur,
      volume:          target.volume,
      transpose:       target.transpose,
      warpMode:        target.warpMode,
      originalBpm:     target.originalBpm,
      firstBeatOffset: target.firstBeatOffset,
      loopEndSeconds:  target.loopEndSeconds,
      playing:         willPlay,
    };

    if (wasPlaying && willPlay) {
      // Keep running — just sync volume and playback rate
      loopPlayerEngine.setVolume(i, target.volume);
      loopPlayerEngine.updatePlaybackRate(i, target.originalBpm, globalBpm, 1);
    } else if (wasPlaying && !willPlay) {
      // Stop at the current time (already bar-boundary since loadScene
      // is called via setTimeout(0) from the scheduler tick)
      loopPlayerEngine.stopSlot(i, now);
    } else if (!wasPlaying && willPlay) {
      // Start — only if buffer is loaded
      if (cur.buffer) {
        _launchSlot(i, updated);  // uses _nextBarTime() internally
      }
    }
    // false → false: nothing to do

    return updated;
  });

  set({ slots: nextSlots });
},
```

### 2. `sceneStore.ts` — `captureScene()` update

After the existing `drumVoiceParams` snapshot block, add:

```typescript
// Snapshot loop player state
// Buffer/waveform not saved — user-loaded, stays in memory
loopSlots: useLoopPlayerStore.getState().slots.map((s) => ({
  playing:         s.playing,
  volume:          s.volume,
  transpose:       s.transpose,
  warpMode:        s.warpMode,
  originalBpm:     s.originalBpm,
  firstBeatOffset: s.firstBeatOffset,
  loopEndSeconds:  s.loopEndSeconds,
})),
```

Also add the import at the top:
```typescript
import { useLoopPlayerStore, type LoopSceneState } from "./loopPlayerStore";
```

And add `WarpMode` to the import from `pitchShiftBuffer` via loopPlayerStore (re-exported or imported directly).

### 3. `sceneStore.ts` — `loadScene()` update

At the end of the `unstable_batchedUpdates` block, after `set({ activeScene: slot, nextScene: null })`, add:

```typescript
// Restore loop player state — diff-based, bar-synchronized
if (scene.loopSlots && scene.loopSlots.length > 0) {
  useLoopPlayerStore.getState().loadSceneSlots(scene.loopSlots);
}
```

---

## Behaviour Summary

| Slot state change | Action |
|---|---|
| `false → false` | Nothing |
| `false → true` (buffer loaded) | Start at next bar boundary |
| `false → true` (no buffer) | Silently skipped |
| `true → false` | Stop at current time (bar-boundary context) |
| `true → true` | Volume + rate update, no interruption |

---

## Legacy Compatibility

Scenes recorded before this feature have `loopSlots: undefined`. The `loadScene()` check `if (scene.loopSlots && scene.loopSlots.length > 0)` ensures they are silently ignored — existing scenes continue to work exactly as before.

---

## Non-Goals

- No loop fade-out on stop (can be added later as Polish sprint)
- No "free loop" toggle per slot (loops always follow scene state if scene has `loopSlots`)
- No cross-fade between loops
- No loop buffer saved to scene (session persistence only, not project save)
