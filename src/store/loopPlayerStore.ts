/**
 * Loop Player Store — 4-slot tempo-synced loop player
 *
 * Playback model:
 *  - Pressing PLAY on a slot starts audio immediately (no transport required)
 *  - When transport starts:  all armed slots restart in phase with each other
 *  - When transport stops:   all audio sources stop; armed state is preserved
 *  - When transport restarts: armed slots restart in sync
 *  - BPM changes:           playback rate of all running slots updates live
 */

import { create } from "zustand";
import { loopPlayerEngine } from "../audio/LoopPlayerEngine";
import { audioEngine } from "../audio/AudioEngine";
import { useDrumStore } from "./drumStore";

// ─── Types ────────────────────────────────────────────────

export interface LoopSlotState {
  buffer: AudioBuffer | null;
  fileName: string;
  duration: number;     // seconds
  originalBpm: number;  // native BPM of the loop file
  volume: number;       // 0–1
  playing: boolean;     // user's armed/play intent
}

interface LoopPlayerStore {
  slots: LoopSlotState[];
  setBuffer(idx: number, buffer: AudioBuffer, fileName: string): void;
  setOriginalBpm(idx: number, bpm: number): void;
  setVolume(idx: number, volume: number): void;
  togglePlay(idx: number): void;
  stopAll(): void;
}

// ─── Defaults ─────────────────────────────────────────────

function createDefaultSlot(): LoopSlotState {
  return {
    buffer: null,
    fileName: "",
    duration: 0,
    originalBpm: 120,
    volume: 0.8,
    playing: false,
  };
}

// ─── Store ────────────────────────────────────────────────

export const useLoopPlayerStore = create<LoopPlayerStore>((set, get) => ({
  slots: Array.from({ length: 4 }, createDefaultSlot),

  setBuffer: (idx, buffer, fileName) =>
    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, buffer, fileName, duration: buffer.duration };
      return { slots };
    }),

  setOriginalBpm: (idx, bpm) => {
    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, originalBpm: bpm };
      return { slots };
    });
    // Update playback rate live if the slot has an active audio source
    const globalBpm = useDrumStore.getState().bpm;
    loopPlayerEngine.updatePlaybackRate(idx, bpm, globalBpm);
  },

  setVolume: (idx, volume) => {
    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, volume };
      return { slots };
    });
    loopPlayerEngine.setVolume(idx, volume);
  },

  togglePlay: (idx) => {
    const slot = get().slots[idx]!;
    if (!slot.buffer) return;

    const globalBpm  = useDrumStore.getState().bpm;
    const now        = audioEngine.currentTime;
    const startTime  = now + 0.02;

    if (slot.playing) {
      // Disarm + stop
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, playing: false };
        return { slots };
      });
      loopPlayerEngine.stopSlot(idx, now);
    } else {
      // Arm + start immediately (independent of transport)
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, playing: true };
        return { slots };
      });
      loopPlayerEngine.startSlot(
        idx,
        slot.buffer,
        slot.originalBpm,
        globalBpm,
        slot.volume,
        startTime,
      );
    }
  },

  stopAll: () => {
    set((s) => ({
      slots: s.slots.map((sl) => ({ ...sl, playing: false })),
    }));
    loopPlayerEngine.stopAll();
  },
}));

// ─── Transport Subscription ───────────────────────────────
// Runs globally — not tied to component lifecycle.

const _unsub = useDrumStore.subscribe((state, prev) => {
  const { slots } = useLoopPlayerStore.getState();
  const globalBpm  = state.bpm;

  if (state.isPlaying && !prev.isPlaying) {
    // Transport started → restart all armed slots in phase
    const startTime = audioEngine.currentTime + 0.05;
    slots.forEach((slot, idx) => {
      if (slot.playing && slot.buffer) {
        loopPlayerEngine.startSlot(
          idx,
          slot.buffer,
          slot.originalBpm,
          globalBpm,
          slot.volume,
          startTime,
        );
      }
    });
  } else if (!state.isPlaying && prev.isPlaying) {
    // Transport stopped → kill audio, preserve armed state
    loopPlayerEngine.stopAll();
  } else if (state.bpm !== prev.bpm) {
    // BPM changed → update all currently active slots (whether transport is playing or not)
    slots.forEach((slot, idx) => {
      if (slot.playing) {
        loopPlayerEngine.updatePlaybackRate(idx, slot.originalBpm, globalBpm);
      }
    });
  }
});

// Vite HMR cleanup
if (import.meta.hot) {
  import.meta.hot.dispose(() => _unsub());
}
