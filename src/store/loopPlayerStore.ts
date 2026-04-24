/**
 * Loop Player Store — 4-slot tempo-synced loop player
 *
 * Playback model:
 *  - File loaded → BPM auto-detected (Web Worker) + beat offset found
 *  - Pressing PLAY on a slot:
 *      · Transport stopped → starts immediately (no quantise)
 *      · Transport running → starts on next bar boundary (Ableton-style)
 *  - When transport starts:  all armed slots re-launch at next bar boundary
 *  - When transport stops:   all audio sources stop; armed state preserved
 *  - BPM changes:           playback rate of running slots updates live
 *
 * Beat-aligned looping:
 *  - loopStart = firstBeatOffset   (pre-beat silence skipped)
 *  - loopEnd   = loopStart + N complete bars
 *
 * Tap BPM:
 *  - tapBpm(idx) accumulates taps; BPM computed from average interval
 *  - Resets after 2.5 s of inactivity
 */

// @ts-ignore — Vite worker import
import BpmWorkerCtor from "../audio/bpmAnalysisWorker?worker";
import { create } from "zustand";
import { loopPlayerEngine } from "../audio/LoopPlayerEngine";
import { audioEngine } from "../audio/AudioEngine";
import { useDrumStore, getDrumTransportStartTime } from "./drumStore";

// ─── Types ────────────────────────────────────────────────

export interface LoopSlotState {
  buffer:           AudioBuffer | null;
  fileName:         string;
  duration:         number;      // seconds (full file)
  originalBpm:      number;      // native BPM — editable by user / auto-detected
  volume:           number;      // 0–1
  playing:          boolean;     // user's armed / play intent

  // Beat-grid metadata (filled by auto-analysis)
  analyzing:        boolean;     // true while worker is running
  detectedBpm:      number | null; // last auto-detected value (null = never analysed)
  firstBeatOffset:  number;      // seconds to beat 1 in the file
  loopEndSeconds:   number;      // beat-aligned loop end (0 = use full buffer)
}

interface LoopPlayerStore {
  slots: LoopSlotState[];
  setBuffer     (idx: number, buffer: AudioBuffer, fileName: string): void;
  setOriginalBpm(idx: number, bpm: number): void;
  setVolume     (idx: number, volume: number): void;
  togglePlay    (idx: number): void;
  stopAll       (): void;
  tapBpm        (idx: number): void;
}

// ─── Defaults ─────────────────────────────────────────────

function createDefaultSlot(): LoopSlotState {
  return {
    buffer:          null,
    fileName:        "",
    duration:        0,
    originalBpm:     120,
    volume:          0.8,
    playing:         false,
    analyzing:       false,
    detectedBpm:     null,
    firstBeatOffset: 0,
    loopEndSeconds:  0,
  };
}

// ─── BPM Worker (singleton, lazy-created) ─────────────────

let _bpmWorker: Worker | null = null;
let _bpmWorkerReqId = 0;

// Map reqId → slot index (so we know which slot to update)
const _pendingReqs = new Map<number, number>();

function getBpmWorker(): Worker {
  if (!_bpmWorker) {
    _bpmWorker = new BpmWorkerCtor() as Worker;
    _bpmWorker.onmessage = (e: MessageEvent<{ id: number; bpm: number; firstBeatOffset: number }>) => {
      const { id, bpm, firstBeatOffset } = e.data;
      const slotIdx = _pendingReqs.get(id);
      if (slotIdx === undefined) return;
      _pendingReqs.delete(id);

      const store = useLoopPlayerStore.getState();
      const slot  = store.slots[slotIdx];
      if (!slot) return;

      // Calculate beat-aligned loop end:
      //   loopEnd = firstBeatOffset + floor(numBeats / 4) * 4 * secondsPerBeat
      // (round to complete bars of 4 beats)
      const secondsPerBeat = 60 / bpm;
      const usableBeats    = (slot.duration - firstBeatOffset) / secondsPerBeat;
      const numBars        = Math.max(1, Math.floor(usableBeats / 4));
      const loopEndSeconds = firstBeatOffset + numBars * 4 * secondsPerBeat;

      useLoopPlayerStore.setState((s) => {
        const slots = [...s.slots];
        slots[slotIdx] = {
          ...slots[slotIdx]!,
          analyzing:       false,
          detectedBpm:     bpm,
          originalBpm:     bpm,          // auto-set; user can override
          firstBeatOffset: firstBeatOffset < 0.05 ? 0 : firstBeatOffset, // ignore tiny offsets
          loopEndSeconds,
        };
        return { slots };
      });

      // If slot was already armed (user pressed PLAY while analysing), restart now
      const updatedSlot = useLoopPlayerStore.getState().slots[slotIdx]!;
      if (updatedSlot.playing && updatedSlot.buffer) {
        _launchSlot(slotIdx, updatedSlot);
      }
    };
  }
  return _bpmWorker;
}

// ─── Launch helpers ────────────────────────────────────────

/**
 * Compute the AudioContext time for the next bar downbeat, perfectly locked
 * to the drum transport grid.
 *
 * Strategy: use the absolute transport-start timestamp (beat 1 of bar 1) and
 * compute bar boundaries mathematically — no dependency on React state or
 * scheduler lookahead, so no drift.
 *
 * Falls back to "now + 0.05" when transport is stopped.
 */
function _nextBarTime(): number {
  const drum = useDrumStore.getState();
  if (!drum.isPlaying) return audioEngine.currentTime + 0.05;

  const now          = audioEngine.currentTime;
  const barDuration  = (60 / drum.bpm) * 4;      // 4 quarter-notes per bar
  const startTime    = getDrumTransportStartTime();
  const elapsed      = now - startTime;
  const barsElapsed  = Math.floor(elapsed / barDuration);
  const nextBar      = startTime + (barsElapsed + 1) * barDuration;

  // Never schedule more than 2 bars ahead, and never in the past
  return Math.max(now + 0.01, Math.min(now + barDuration * 2, nextBar));
}

function _launchSlot(idx: number, slot: LoopSlotState): void {
  if (!slot.buffer) return;
  const globalBpm   = useDrumStore.getState().bpm;
  const startTime   = _nextBarTime();
  const loopStart   = slot.firstBeatOffset;
  const loopEnd     = slot.loopEndSeconds > loopStart ? slot.loopEndSeconds : undefined;

  loopPlayerEngine.startSlot(
    idx,
    slot.buffer,
    slot.originalBpm,
    globalBpm,
    slot.volume,
    startTime,
    loopStart,
    loopEnd,
  );
}

// ─── Tap-BPM state (per-slot) ─────────────────────────────

const _tapTimes: (number[])[] = [[], [], [], []];
const _tapTimers: (ReturnType<typeof setTimeout> | null)[] = [null, null, null, null];
const TAP_RESET_MS = 2500;

// ─── Store ────────────────────────────────────────────────

export const useLoopPlayerStore = create<LoopPlayerStore>((set, get) => ({
  slots: Array.from({ length: 4 }, createDefaultSlot),

  // ── Load file ──────────────────────────────────────────
  setBuffer: (idx, buffer, fileName) => {
    set((s) => {
      const slots = [...s.slots];
      slots[idx] = {
        ...slots[idx]!,
        buffer,
        fileName,
        duration:        buffer.duration,
        analyzing:       true,
        detectedBpm:     null,
        firstBeatOffset: 0,
        loopEndSeconds:  0,
      };
      return { slots };
    });

    // Fire off BPM analysis in worker
    // IMPORTANT: copy the channel data before sending — transferring the original
    // ArrayBuffer detaches it from the AudioBuffer, making the loop unplayable.
    const reqId = ++_bpmWorkerReqId;
    _pendingReqs.set(reqId, idx);
    const channelData = buffer.getChannelData(0);
    const channelDataCopy = new Float32Array(channelData); // copy, don't detach
    getBpmWorker().postMessage(
      { id: reqId, channelData: channelDataCopy, sampleRate: buffer.sampleRate },
      [channelDataCopy.buffer],
    );
  },

  // ── Manual BPM override ────────────────────────────────
  setOriginalBpm: (idx, bpm) => {
    // Recalculate loopEnd for new BPM
    const slot = get().slots[idx]!;
    const secondsPerBeat = 60 / bpm;
    const usableBeats    = (slot.duration - slot.firstBeatOffset) / secondsPerBeat;
    const numBars        = Math.max(1, Math.floor(usableBeats / 4));
    const loopEndSeconds = slot.firstBeatOffset + numBars * 4 * secondsPerBeat;

    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, originalBpm: bpm, loopEndSeconds };
      return { slots };
    });
    const globalBpm = useDrumStore.getState().bpm;
    loopPlayerEngine.updatePlaybackRate(idx, bpm, globalBpm);
  },

  // ── Volume ─────────────────────────────────────────────
  setVolume: (idx, volume) => {
    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, volume };
      return { slots };
    });
    loopPlayerEngine.setVolume(idx, volume);
  },

  // ── Play / Stop ────────────────────────────────────────
  togglePlay: (idx) => {
    const slot = get().slots[idx]!;
    if (!slot.buffer) return;

    if (slot.playing) {
      // Disarm + stop
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, playing: false };
        return { slots };
      });
      loopPlayerEngine.stopSlot(idx, audioEngine.currentTime);
    } else {
      // Arm — if still analysing, launch will happen on worker callback
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, playing: true };
        return { slots };
      });
      if (!slot.analyzing) {
        _launchSlot(idx, { ...slot, playing: true });
      }
    }
  },

  // ── Stop all ───────────────────────────────────────────
  stopAll: () => {
    set((s) => ({
      slots: s.slots.map((sl) => ({ ...sl, playing: false })),
    }));
    loopPlayerEngine.stopAll();
  },

  // ── Tap BPM ────────────────────────────────────────────
  tapBpm: (idx) => {
    const now = performance.now();
    const taps = _tapTimes[idx]!;

    // Reset stale taps
    if (taps.length > 0 && now - taps[taps.length - 1]! > TAP_RESET_MS) {
      taps.length = 0;
    }
    taps.push(now);

    // Clear reset timer
    if (_tapTimers[idx] !== null) clearTimeout(_tapTimers[idx]!);
    _tapTimers[idx] = setTimeout(() => { _tapTimes[idx]!.length = 0; }, TAP_RESET_MS);

    // Need at least 2 taps to compute a BPM
    if (taps.length < 2) return;

    // Average interval across all tap pairs
    let totalInterval = 0;
    for (let i = 1; i < taps.length; i++) {
      totalInterval += taps[i]! - taps[i - 1]!;
    }
    const avgInterval = totalInterval / (taps.length - 1);
    const bpm = Math.round((60_000 / avgInterval) * 10) / 10;

    if (bpm >= 40 && bpm <= 220) {
      get().setOriginalBpm(idx, bpm);
    }
  },
}));

// ─── Transport Subscription ───────────────────────────────
// Runs globally — not tied to component lifecycle.

const _unsub = useDrumStore.subscribe((state, prev) => {
  const { slots } = useLoopPlayerStore.getState();
  const globalBpm = state.bpm;

  if (state.isPlaying && !prev.isPlaying) {
    // Transport started → re-launch all armed slots at next bar boundary
    slots.forEach((slot, idx) => {
      if (slot.playing && slot.buffer && !slot.analyzing) {
        _launchSlot(idx, slot);
      }
    });
  } else if (!state.isPlaying && prev.isPlaying) {
    // Transport stopped → kill audio, keep armed state
    loopPlayerEngine.stopAll();
  } else if (state.bpm !== prev.bpm) {
    // BPM changed → update playback rate of all active slots
    slots.forEach((slot, idx) => {
      if (slot.playing) {
        loopPlayerEngine.updatePlaybackRate(idx, slot.originalBpm, globalBpm);
      }
    });
  }
});

// Vite HMR cleanup
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _unsub();
    _bpmWorker?.terminate();
    _bpmWorker = null;
  });
}
