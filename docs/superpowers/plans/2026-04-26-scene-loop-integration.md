# Scene + Loop Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scenes save and restore Loop Player state so that switching scenes changes which loops are playing, with seamless "keep running" behaviour when the same slot is active in both scenes.

**Architecture:** Two-file change. `loopPlayerStore.ts` gains a `LoopSceneState` export interface and a `loadSceneSlots()` action that diffs current vs. target slot states. `sceneStore.ts` snapshots loop state in `captureScene()` and calls `loadSceneSlots()` at the end of `loadScene()`.

**Tech Stack:** TypeScript strict, Zustand, Web Audio API (`AudioBufferSourceNode`), `loopPlayerEngine` (existing singleton), `_launchSlot` / `_nextBarTime` (module-scoped helpers already in `loopPlayerStore.ts`).

---

## Task 1: Export `LoopSceneState` and add `loadSceneSlots` to `loopPlayerStore.ts`

**Files:**
- Modify: `src/store/loopPlayerStore.ts`

### Context

`loopPlayerStore.ts` already has:
- `LoopSlotState` interface (line 32) — includes `buffer`, `playing`, `volume`, `transpose`, `warpMode`, `originalBpm`, `firstBeatOffset`, `loopEndSeconds`
- `LoopPlayerStore` interface (line 54) — lists all public actions
- `_launchSlot(idx, slot)` (line 231) — module-scoped, starts a slot at the next bar boundary
- `loopPlayerEngine.stopSlot(idx, time)`, `.setVolume(idx, vol)`, `.updatePlaybackRate(idx, originalBpm, globalBpm, pitchFactor)` — engine API
- `audioEngine` imported from `../audio/AudioEngine` — use `audioEngine.getAudioContext()` to get `currentTime`
- `useDrumStore` imported — use `useDrumStore.getState().bpm` for globalBpm
- `WarpMode` already imported from `../audio/pitchShiftBuffer`

`LoopSceneState` must be defined **here** (not in sceneStore) to avoid a circular import — sceneStore will import it from loopPlayerStore.

### Steps

- [ ] **Step 1: Add `LoopSceneState` export interface**

  Insert after the `LoopSlotState` interface definition (after line ~52), before the `LoopPlayerStore` interface:

  ```typescript
  /** Serialisable per-slot snapshot saved inside a Scene.
   *  AudioBuffer and waveformPeaks are omitted — they are too large to
   *  serialize and are already held in memory from the user's file load. */
  export interface LoopSceneState {
    playing:         boolean;
    volume:          number;
    transpose:       number;
    warpMode:        WarpMode;
    originalBpm:     number;
    firstBeatOffset: number;
    loopEndSeconds:  number;
  }
  ```

- [ ] **Step 2: Add `loadSceneSlots` to the `LoopPlayerStore` interface**

  In the `LoopPlayerStore` interface (line ~54), add after `stopAll()`:

  ```typescript
  /** Diff-based restore: only touches slots whose play state changes.
   *  Slots playing in both scenes keep running uninterrupted. */
  loadSceneSlots(targetSlots: LoopSceneState[]): void;
  ```

- [ ] **Step 3: Implement `loadSceneSlots` in the store factory**

  Inside `create<LoopPlayerStore>((set, get) => ({ … }))`, add after the `stopAll` implementation:

  ```typescript
  loadSceneSlots: (targetSlots) => {
    const currentSlots = get().slots;
    const globalBpm    = useDrumStore.getState().bpm;
    const ctx          = audioEngine.getAudioContext();
    const now          = ctx?.currentTime ?? 0;

    const nextSlots = currentSlots.map((cur, i): LoopSlotState => {
      const target = targetSlots[i];
      if (!target) return cur;

      const wasPlaying = cur.playing;
      const willPlay   = target.playing;

      // Always write the new non-destructive params to store state
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
        // Keep running — sync volume + playback rate only
        loopPlayerEngine.setVolume(i, target.volume);
        loopPlayerEngine.updatePlaybackRate(i, target.originalBpm, globalBpm, 1);
      } else if (wasPlaying && !willPlay) {
        // Stop now (called from bar-boundary context via scheduler setTimeout)
        loopPlayerEngine.stopSlot(i, now);
      } else if (!wasPlaying && willPlay) {
        // Start — only if buffer is loaded; silently skip if not
        if (cur.buffer) {
          _launchSlot(i, updated);
        }
      }
      // false → false: nothing to do

      return updated;
    });

    set({ slots: nextSlots });
  },
  ```

- [ ] **Step 4: Build check**

  ```bash
  cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
  npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors related to `loopPlayerStore.ts`. Build may warn about other unrelated things — that is fine.

- [ ] **Step 5: Commit**

  ```bash
  cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
  git add src/store/loopPlayerStore.ts
  git commit -m "feat: export LoopSceneState + add loadSceneSlots action to loopPlayerStore"
  ```

---

## Task 2: Snapshot and restore loop state in `sceneStore.ts`

**Files:**
- Modify: `src/store/sceneStore.ts`

### Context

`sceneStore.ts` currently:
- Has `Scene` interface (line 23) with no loop fields
- `captureScene()` (line 106): builds a `scene` object literal ending with `drumVoiceParams`, then calls `set({ scenes: newScenes })` (line 169)
- `loadScene()` (line 178): calls `unstable_batchedUpdates(() => { … set({ activeScene: slot, nextScene: null }); })` — the `set(...)` is the LAST statement inside `unstable_batchedUpdates` (line 287)
- Imports at top: `create`, `unstable_batchedUpdates`, and several store/engine imports — NO import of `useLoopPlayerStore` yet

`WarpMode` is **not** needed here — `LoopSceneState` uses it by type, but sceneStore.ts only passes data through; TypeScript will infer it. No additional import of `WarpMode` is required.

### Steps

- [ ] **Step 1: Add import for `useLoopPlayerStore` and `LoopSceneState`**

  In `src/store/sceneStore.ts`, after the last existing import line (currently `import { ROOT_NOTES } from "../audio/BassEngine";`), add:

  ```typescript
  import { useLoopPlayerStore, type LoopSceneState } from "./loopPlayerStore";
  ```

- [ ] **Step 2: Add `loopSlots` to the `Scene` interface**

  In the `Scene` interface (line 23), after the `followAction` field:

  ```typescript
  /** Loop Player slot states at the time this scene was recorded.
   *  undefined = legacy scene recorded before this feature — loops are untouched. */
  loopSlots?: LoopSceneState[];
  ```

- [ ] **Step 3: Snapshot loop state in `captureScene()`**

  Inside `captureScene()`, in the `scene` object literal, add `loopSlots` after `drumVoiceParams`:

  ```typescript
  loopSlots: useLoopPlayerStore.getState().slots.map((s): LoopSceneState => ({
    playing:         s.playing,
    volume:          s.volume,
    transpose:       s.transpose,
    warpMode:        s.warpMode,
    originalBpm:     s.originalBpm,
    firstBeatOffset: s.firstBeatOffset,
    loopEndSeconds:  s.loopEndSeconds,
  })),
  ```

  The full scene object should now end with:
  ```typescript
      drumVoiceParams,
      loopSlots: useLoopPlayerStore.getState().slots.map((s): LoopSceneState => ({
        playing:         s.playing,
        volume:          s.volume,
        transpose:       s.transpose,
        warpMode:        s.warpMode,
        originalBpm:     s.originalBpm,
        firstBeatOffset: s.firstBeatOffset,
        loopEndSeconds:  s.loopEndSeconds,
      })),
      // Save global key/scale …
  ```

- [ ] **Step 4: Restore loop state in `loadScene()`**

  At the end of the `unstable_batchedUpdates` callback, immediately after `set({ activeScene: slot, nextScene: null });` (line 287), add:

  ```typescript
      // Restore loop player state — diff-based, bar-boundary synchronized.
      // Legacy scenes (loopSlots undefined) are silently skipped.
      if (scene.loopSlots && scene.loopSlots.length > 0) {
        useLoopPlayerStore.getState().loadSceneSlots(scene.loopSlots);
      }
  ```

  Result: the closing `});` of `unstable_batchedUpdates` is the very next line after this block.

- [ ] **Step 5: Build check**

  ```bash
  cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
  npm run build 2>&1 | tail -20
  ```

  Expected: clean build, no TypeScript errors.

- [ ] **Step 6: Commit**

  ```bash
  cd "/Users/frankkrumsdorf/Desktop/Claude Code Landingpage Elastic Field/Elastic Drum"
  git add src/store/sceneStore.ts
  git commit -m "feat: capture + restore loop player state per scene (scene-loop integration)"
  ```

---

## Behaviour Summary

| Slot state change | Action taken |
|---|---|
| `false → false` | Nothing |
| `false → true` (buffer loaded) | `_launchSlot` → starts at next bar boundary |
| `false → true` (no buffer) | Silently skipped |
| `true → false` | `loopPlayerEngine.stopSlot(i, now)` |
| `true → true` | Volume + rate update only, no interruption |

## Legacy Compatibility

Scenes recorded before this feature have `loopSlots: undefined`. The guard `if (scene.loopSlots && scene.loopSlots.length > 0)` in `loadScene()` ensures they are silently ignored.
