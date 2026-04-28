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
import { pitchShiftBuffer, type WarpMode } from "../audio/pitchShiftBuffer";

// ─── Types ────────────────────────────────────────────────

export interface LoopSlotState {
  buffer:           AudioBuffer | null;
  fileName:         string;
  duration:         number;      // seconds (full file)
  originalBpm:      number;      // native BPM — editable by user / auto-detected
  volume:           number;      // 0–1
  playing:          boolean;     // user's armed / play intent
  transpose:        number;      // semitone offset (integer, −24…+24)
  warpMode:         WarpMode;    // 'repitch' | 'beats' | 'complex'
  pitchedBuffer:    AudioBuffer | null; // SoundTouch-processed buffer (pitch shifted, same tempo)
  pitching:         boolean;     // true while SoundTouch is processing
  pitchGeneration:  number;      // incremented on every async pitch operation; stale results are discarded

  // Beat-grid metadata (filled by auto-analysis)
  analyzing:        boolean;     // true while worker is running
  detectedBpm:      number | null; // last auto-detected value (null = never analysed)
  firstBeatOffset:  number;      // seconds to beat 1 in the file
  loopEndSeconds:   number;      // beat-aligned loop end (0 = use full buffer)
  waveformPeaks:    Float32Array | null; // 120 bars, normalized 0..1 amplitude
  playStartedAt:    number | null;       // AudioContext currentTime when loop actually started
  // Volume-envelope automation
  volumeEnvelope:   number[];    // 16 segments × 0–1 (default all 1.0)
  envExpanded:      boolean;     // whether the envelope lane is visible
}

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
  volumeEnvelope?: number[];
}

interface LoopPlayerStore {
  slots: LoopSlotState[];
  setBuffer          (idx: number, buffer: AudioBuffer, fileName: string): void;
  setOriginalBpm     (idx: number, bpm: number): void;
  setFirstBeatOffset (idx: number, offset: number): void;
  setLoopEndSeconds  (idx: number, end: number): void;
  /** Mark this slot's current loop region as numBars bars at the global (project) BPM.
   *  Sets originalBpm = globalBpm and loopEnd = firstBeatOffset + numBars*4*(60/globalBpm).
   *  This is the primary "tempo lock" action — independent of auto-detection. */
  setLoopRegion      (idx: number, numBars: number): void;
  restartSlot        (idx: number): void;
  setVolume          (idx: number, volume: number): void;
  setTranspose       (idx: number, semitones: number): void;
  setWarpMode       (idx: number, mode: WarpMode): void;
  togglePlay         (idx: number): void;
  stopAll            (): void;
  /** Diff-based restore: only touches slots whose play state changes.
   *  Slots playing in both scenes keep running uninterrupted. */
  loadSceneSlots(targetSlots: LoopSceneState[]): void;
  tapBpm             (idx: number): void;
  /** Set one segment of the volume envelope (0–15) to a value 0–1.
   *  Reschedules gain automation immediately if the slot is playing. */
  setVolumeSegment   (idx: number, segIdx: number, value: number): void;
  /** Toggle the envelope lane visibility for a slot. */
  setEnvExpanded     (idx: number, expanded: boolean): void;
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
    transpose:       0,
    warpMode:        "beats",
    pitchedBuffer:   null,
    pitching:        false,
    pitchGeneration: 0,
    analyzing:       false,
    detectedBpm:     null,
    firstBeatOffset: 0,
    loopEndSeconds:  0,
    waveformPeaks:   null,
    playStartedAt:   null,
    volumeEnvelope:  Array(16).fill(1),
    envExpanded:     false,
  };
}

// ─── Filename BPM hint ────────────────────────────────────
/**
 * Try to extract a BPM value from the file name.
 * Matches standalone 2-3 digit numbers in range [40, 220].
 * "EQ-Lp870 HndCong Ringer 090 - C#m" → 90
 * "loop_120bpm.wav" → 120
 * Numbers inside compound words (e.g. "Lp870") are skipped via \b.
 */
function extractBpmFromFilename(name: string): number | null {
  const base = name.replace(/\.[^/.]+$/, ""); // strip extension
  const tokens = base.match(/\b\d{2,3}\b/g) ?? [];
  for (const t of tokens) {
    const n = parseInt(t, 10);
    if (n >= 40 && n <= 220) return n;
  }
  return null;
}

// ─── Waveform peak computation ─────────────────────────────
function computePeaks(buffer: AudioBuffer, numBars = 120): Float32Array {
  const peaks = new Float32Array(numBars);
  const ch = buffer.getChannelData(0);
  const samplesPerBar = Math.floor(ch.length / numBars);
  for (let i = 0; i < numBars; i++) {
    let peak = 0;
    const start = i * samplesPerBar;
    for (let j = 0; j < samplesPerBar; j++) {
      const s = ch[start + j];
      if (s !== undefined && Math.abs(s) > peak) peak = Math.abs(s);
    }
    peaks[i] = peak;
  }
  return peaks;
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

      // Prefer BPM embedded in the filename (e.g. "loop_090bpm.wav" → 90).
      // Auto-detection is kept as detectedBpm for display; originalBpm uses the
      // more reliable filename value when available.
      const filenameBpm = extractBpmFromFilename(slot.fileName);
      const finalBpm    = filenameBpm ?? bpm;

      // Calculate beat-aligned loop end:
      //   loopEnd = firstBeatOffset + floor(numBeats / 4) * 4 * secondsPerBeat
      // (round to complete bars of 4 beats)
      const secondsPerBeat = 60 / finalBpm;
      const usableBeats    = (slot.duration - firstBeatOffset) / secondsPerBeat;
      const numBars        = Math.max(1, Math.floor(usableBeats / 4));
      const loopEndSeconds = firstBeatOffset + numBars * 4 * secondsPerBeat;

      useLoopPlayerStore.setState((s) => {
        const slots = [...s.slots];
        slots[slotIdx] = {
          ...slots[slotIdx]!,
          analyzing:       false,
          detectedBpm:     bpm,          // raw auto-detected value (for display)
          originalBpm:     finalBpm,     // filename hint wins; fallback = detector
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
      // Re-warp beats/complex since bpmRatio is now known
      if (updatedSlot.warpMode !== "repitch") _scheduleRewarp(slotIdx, 0);
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

  const now         = audioEngine.currentTime;
  const barDuration = (60 / drum.bpm) * 4;   // 4 quarter-notes per bar
  const startTime   = getDrumTransportStartTime();
  const elapsed     = now - startTime;

  // Guard: startTime is in the future (normal: scheduler lookahead sets transportStartTime
  // *before* setState fires the subscriber, so elapsed is typically slightly negative).
  // Also handle up to 1 full bar of latency for robustness.
  if (elapsed < barDuration) {
    return Math.max(now + 0.005, startTime);
  }

  const barsElapsed = Math.floor(elapsed / barDuration);
  const nextBar     = startTime + (barsElapsed + 1) * barDuration;

  // Never schedule more than 2 bars ahead, never in the past
  return Math.max(now + 0.01, Math.min(now + barDuration * 2, nextBar));
}

/** Compute pitchFactor for AudioBufferSourceNode.
 *  RE-PITCH: vinyl (pitch via rate). BEATS/COMPLEX: 1.0 (pitch in buffer). */
function _pitchFactor(slot: LoopSlotState): number {
  return slot.warpMode === "repitch" ? Math.pow(2, slot.transpose / 12) : 1;
}

/** BPM ratio for a slot: globalBpm / originalBpm. Returns 1 if originalBpm is 0. */
function _bpmRatioFor(slot: LoopSlotState): number {
  const { bpm: globalBpm } = useDrumStore.getState();
  return slot.originalBpm > 0 ? globalBpm / slot.originalBpm : 1;
}

// Debounced re-warp timers (indexed by slot index)
const _rewarpTimers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Schedule an offline re-warp for a beats/complex slot.
 * Cancels any pending warp for the same slot before scheduling the new one.
 * After delayMs, re-runs pitchShiftBuffer with the current bpmRatio, stores
 * the result as pitchedBuffer, and restarts the slot if playing.
 */
function _scheduleRewarp(idx: number, delayMs = 600): void {
  const existing = _rewarpTimers.get(idx);
  if (existing !== undefined) clearTimeout(existing);
  _rewarpTimers.set(idx, setTimeout(() => {
    _rewarpTimers.delete(idx);
    const slot = useLoopPlayerStore.getState().slots[idx]!;
    if (!slot.buffer || slot.warpMode === "repitch" || slot.analyzing) return;
    const bpmRatio = _bpmRatioFor(slot);
    const gen = (slot.pitchGeneration ?? 0) + 1;
    useLoopPlayerStore.setState((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, pitching: true, pitchGeneration: gen };
      return { slots };
    });
    pitchShiftBuffer(slot.buffer, slot.transpose, slot.warpMode, bpmRatio).then((pitched) => {
      if (useLoopPlayerStore.getState().slots[idx]!.pitchGeneration !== gen) return;
      useLoopPlayerStore.setState((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, pitchedBuffer: pitched, pitching: false };
        return { slots };
      });
      const updated = useLoopPlayerStore.getState().slots[idx]!;
      if (updated.playing && !updated.analyzing) _launchSlot(idx, updated);
    }).catch(() => {
      if (useLoopPlayerStore.getState().slots[idx]!.pitchGeneration !== gen) return;
      useLoopPlayerStore.setState((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, pitching: false };
        return { slots };
      });
    });
  }, delayMs));
}

function _launchSlot(idx: number, slot: LoopSlotState): void {
  if (!slot.buffer) return;
  const globalBpm = useDrumStore.getState().bpm;
  const startTime = _nextBarTime();

  // RE-PITCH: play original buffer at rate that includes pitch factor
  // BEATS/COMPLEX: always use pitchedBuffer when available (BPM compensation + transpose)
  const playBuffer = (slot.warpMode !== "repitch" && slot.pitchedBuffer)
    ? slot.pitchedBuffer
    : slot.buffer;

  const loopStart = slot.firstBeatOffset;
  const loopEnd   = slot.loopEndSeconds > loopStart ? slot.loopEndSeconds : undefined;

  loopPlayerEngine.startSlot(
    idx,
    playBuffer,
    slot.originalBpm,
    globalBpm,
    slot.volume,
    startTime,
    loopStart,
    loopEnd,
    _pitchFactor(slot),
  );

  // ── Schedule volume-envelope automation ──────────────────────────────────
  // realCycleDuration: how many real-time seconds one loop cycle occupies.
  // Loop region is `loopRegionSecs` of audio played at rate = globalBpm / originalBpm,
  // so it takes `loopRegionSecs * originalBpm / globalBpm` seconds of real time.
  const loopRegionSecs = (loopEnd !== undefined ? loopEnd : (slot.buffer?.duration ?? 0)) - loopStart;
  const playbackRate   = slot.originalBpm > 0 ? globalBpm / slot.originalBpm : 1;
  const realCycleDuration = loopRegionSecs / Math.max(0.1, playbackRate);

  loopPlayerEngine.scheduleEnvelope(
    idx,
    slot.volumeEnvelope,
    startTime,
    realCycleDuration,
  );

  // Store the exact scheduled start time so reschedule-on-edit knows the phase
  useLoopPlayerStore.setState((s) => {
    const slots = [...s.slots];
    slots[idx] = { ...slots[idx]!, playStartedAt: startTime };
    return { slots };
  });
}

// ─── Tap-BPM state (per-slot) ─────────────────────────────

const _tapTimes: (number[])[] = [[], [], [], [], [], [], [], []];
const _tapTimers: (ReturnType<typeof setTimeout> | null)[] = [null, null, null, null, null, null, null, null];
const TAP_RESET_MS = 2500;

// ─── HMR slot-state recovery ───────────────────────────────────────────────
// When Vite HMR reloads this module (triggered by LoopPlayerEngine.ts changes)
// it re-evaluates the file and creates a FRESH Zustand store — all loaded
// AudioBuffers are lost. React Fast Refresh keeps audioReady=true so
// startAudio never re-runs; togglePlay would bail immediately with buffer=null.
//
// Fix: stash the current slot array in import.meta.hot.data before teardown
// (dispose) and pick it up here on the next evaluation. AudioBuffer objects
// are reference-stable across HMR reloads (they're tied to the AudioContext,
// which the Fast Refresh runtime keeps alive).
const _prevSlots = (import.meta.hot?.data?.slots as LoopSlotState[] | undefined)
  ?.map((s): LoopSlotState => ({
    ...s,
    analyzing:      false,  // BPM worker is gone after reload → reset flag
    pitching:       false,  // in-flight SoundTouch job is gone → reset flag
    playing:        false,  // audio nodes are gone after reload → mark stopped
    volumeEnvelope: s.volumeEnvelope ?? Array(16).fill(1),
    envExpanded:    s.envExpanded ?? false,
  }));

// ─── Store ────────────────────────────────────────────────

export const useLoopPlayerStore = create<LoopPlayerStore>((set, get) => ({
  slots: _prevSlots ?? Array.from({ length: 8 }, createDefaultSlot),

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
        waveformPeaks:   computePeaks(buffer),
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
    loopPlayerEngine.updatePlaybackRate(idx, bpm, globalBpm, _pitchFactor(get().slots[idx]!));
    // Re-warp beats/complex slots since bpmRatio changed
    const slotAfterBpmUpdate = get().slots[idx]!;
    if (slotAfterBpmUpdate.warpMode !== "repitch" && slotAfterBpmUpdate.buffer) {
      _scheduleRewarp(idx, 0);
    }
  },

  // ── Manual loop region ─────────────────────────────────
  setFirstBeatOffset: (idx, offset) => {
    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, firstBeatOffset: offset };
      return { slots };
    });
  },

  setLoopEndSeconds: (idx, end) => {
    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, loopEndSeconds: end };
      return { slots };
    });
  },

  // ── Tempo-lock: declare this loop to be exactly numBars bars long ──
  //
  // Rather than assuming the file is at globalBpm, we derive the native BPM
  // from the actual audio content: originalBpm = numBars × 240 / loopDuration.
  // The engine then sets playbackRate = globalBpm / originalBpm so the loop
  // lands on beat 1 of every N bars regardless of the project tempo.
  //
  // Example: 90 BPM file (2.667 s/bar), project at 120 BPM, user clicks "1B":
  //   loopDuration = 2.667 s   → originalBpm = 240 / 2.667 = 90 BPM
  //   playbackRate = 120 / 90  = 1.333×  ✓  (was 1.289× with bad auto-detect)
  setLoopRegion: (idx, numBars) => {
    const globalBpm = useDrumStore.getState().bpm;
    const slot      = get().slots[idx]!;
    if (!slot.buffer || numBars <= 0) return;

    // Use the full usable buffer (firstBeatOffset → duration) as the loop region.
    // Most sample-pack loops are exactly N bars with no extra padding, so this
    // gives the most accurate BPM derivation. Trailing silence is handled by the
    // fact that we also set loopEndSeconds = duration (which the engine uses as
    // the loop point, stopping before any silence beyond the last beat).
    const usableDuration = slot.duration - slot.firstBeatOffset;
    if (usableDuration < 0.1) return;

    // Derive the native BPM that makes this audio fit exactly numBars bars.
    // numBars bars × 4 beats/bar × (60 / originalBpm) s/beat = usableDuration
    // → originalBpm = numBars × 240 / usableDuration
    const originalBpm = Math.max(20, Math.min(999, (numBars * 240) / usableDuration));

    set((s) => {
      const slots = [...s.slots];
      slots[idx] = {
        ...slots[idx]!,
        originalBpm,
        loopEndSeconds: slot.duration,   // play the full buffer
        detectedBpm:    null,            // clear detector badge → manual state
      };
      return { slots };
    });

    // Live-update playback rate
    loopPlayerEngine.updatePlaybackRate(idx, originalBpm, globalBpm);

    // Restart at next bar boundary to apply new loop points
    const updated = useLoopPlayerStore.getState().slots[idx]!;
    if (updated.playing && updated.buffer && !updated.analyzing) {
      _launchSlot(idx, updated);
    }
    // Re-warp if beats/complex (originalBpm changed → bpmRatio changed)
    const slotAfterRegion = useLoopPlayerStore.getState().slots[idx]!;
    if (slotAfterRegion.warpMode !== "repitch") _scheduleRewarp(idx, 0);
  },

  // Restart a slot with its current (possibly updated) loop points.
  // Called after the user finishes dragging a handle.
  restartSlot: (idx) => {
    const slot = get().slots[idx]!;
    if (slot.playing && slot.buffer && !slot.analyzing) {
      _launchSlot(idx, slot);
    }
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

  // ── Transpose ──────────────────────────────────────────
  // Offline pitch shifting via SoundTouch WSOLA (pitch only, tempo preserved).
  // Steps: 1) update transpose value  2) run SoundTouch on original buffer
  //        3) store pitchedBuffer     4) restart slot with new buffer
  setTranspose: (idx, semitones) => {
    const clamped = Math.max(-24, Math.min(24, Math.round(semitones)));
    const slot    = useLoopPlayerStore.getState().slots[idx]!;
    if (!slot.buffer) return;

    // RE-PITCH: no offline processing — just update playback rate immediately
    if (slot.warpMode === "repitch") {
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, transpose: clamped };
        return { slots };
      });
      const { bpm: globalBpm } = useDrumStore.getState();
      loopPlayerEngine.updatePlaybackRate(idx, slot.originalBpm, globalBpm, Math.pow(2, clamped / 12));
      return;
    }

    // BEATS/COMPLEX: offline pitch processing (always needed — even at 0 for BPM compensation)
    const gen = (useLoopPlayerStore.getState().slots[idx]!.pitchGeneration ?? 0) + 1;
    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, transpose: clamped, pitching: true, pitchGeneration: gen };
      return { slots };
    });

    pitchShiftBuffer(slot.buffer, clamped, slot.warpMode, _bpmRatioFor(slot)).then((pitched) => {
      // Discard stale results if a newer operation superseded this one
      if (useLoopPlayerStore.getState().slots[idx]!.pitchGeneration !== gen) return;
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, pitchedBuffer: pitched, pitching: false };
        return { slots };
      });
      const updated = useLoopPlayerStore.getState().slots[idx]!;
      if (updated.playing && !updated.analyzing) _launchSlot(idx, updated);
    }).catch(() => {
      if (useLoopPlayerStore.getState().slots[idx]!.pitchGeneration !== gen) return;
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, pitching: false, pitchedBuffer: null };
        return { slots };
      });
    });
  },

  setWarpMode: (idx, mode) => {
    const slot = useLoopPlayerStore.getState().slots[idx]!;
    if (!slot.buffer) {
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, warpMode: mode };
        return { slots };
      });
      return;
    }

    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, warpMode: mode };
      return { slots };
    });

    const updated = useLoopPlayerStore.getState().slots[idx]!;

    if (mode === "repitch") {
      // Clear offline buffer — pitch now via playbackRate
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, pitchedBuffer: null, pitching: false };
        return { slots };
      });
      // Restart slot with original buffer so pitch isn't doubled (buffer + rate)
      const repitchSlot = useLoopPlayerStore.getState().slots[idx]!;
      if (repitchSlot.playing && !repitchSlot.analyzing) {
        _launchSlot(idx, repitchSlot);
      } else {
        const { bpm: globalBpm } = useDrumStore.getState();
        loopPlayerEngine.updatePlaybackRate(
          idx, repitchSlot.originalBpm, globalBpm, Math.pow(2, repitchSlot.transpose / 12),
        );
      }
      return;
    }

    // BEATS or COMPLEX: always re-process (BPM compensation needed even at transpose=0)
    const modeGen = (useLoopPlayerStore.getState().slots[idx]!.pitchGeneration ?? 0) + 1;
    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, pitching: true, pitchGeneration: modeGen };
      return { slots };
    });
    pitchShiftBuffer(updated.buffer!, updated.transpose, mode, _bpmRatioFor(updated)).then((pitched) => {
      if (useLoopPlayerStore.getState().slots[idx]!.pitchGeneration !== modeGen) return;
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, pitchedBuffer: pitched, pitching: false };
        return { slots };
      });
      const final = useLoopPlayerStore.getState().slots[idx]!;
      if (final.playing && !final.analyzing) _launchSlot(idx, final);
    }).catch(() => {
      if (useLoopPlayerStore.getState().slots[idx]!.pitchGeneration !== modeGen) return;
      set((s) => {
        const slots = [...s.slots];
        slots[idx] = { ...slots[idx]!, pitching: false };
        return { slots };
      });
    });
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
        slots[idx] = {
          ...slots[idx]!,
          playing: true,
          playStartedAt: audioEngine.getAudioContext()?.currentTime ?? null,
        };
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

  // ── Load scene slots ───────────────────────────────────
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

  // ── Volume envelope ────────────────────────────────────
  setVolumeSegment: (idx, segIdx, value) => {
    const clamped = Math.max(0, Math.min(1, value));
    set((s) => {
      const slots   = [...s.slots];
      const oldEnv  = slots[idx]!.volumeEnvelope;
      const newEnv  = [...oldEnv];
      newEnv[segIdx] = clamped;
      slots[idx] = { ...slots[idx]!, volumeEnvelope: newEnv };
      return { slots };
    });

    // Reschedule envelope automation if slot is actively playing
    const slot = useLoopPlayerStore.getState().slots[idx]!;
    if (slot.playing && slot.playStartedAt !== null) {
      const globalBpm         = useDrumStore.getState().bpm;
      const loopEnd           = slot.loopEndSeconds > slot.firstBeatOffset
        ? slot.loopEndSeconds
        : (slot.buffer?.duration ?? 0);
      const loopRegionSecs    = loopEnd - slot.firstBeatOffset;
      const playbackRate      = slot.originalBpm > 0 ? globalBpm / slot.originalBpm : 1;
      const realCycleDuration = loopRegionSecs / Math.max(0.1, playbackRate);
      loopPlayerEngine.scheduleEnvelope(
        idx,
        slot.volumeEnvelope,
        slot.playStartedAt,
        realCycleDuration,
      );
    }
  },

  setEnvExpanded: (idx, expanded) => {
    set((s) => {
      const slots = [...s.slots];
      slots[idx] = { ...slots[idx]!, envExpanded: expanded };
      return { slots };
    });
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
    // BPM changed → update playback rate immediately, schedule re-warp for beats/complex
    slots.forEach((slot, idx) => {
      if (slot.playing) {
        loopPlayerEngine.updatePlaybackRate(idx, slot.originalBpm, globalBpm, _pitchFactor(slot));
      }
      if (slot.buffer && slot.warpMode !== "repitch") {
        _scheduleRewarp(idx); // debounced 600ms — re-warp after BPM stops changing
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
    // Stash slot state so the next module evaluation can restore AudioBuffers
    import.meta.hot!.data.slots = useLoopPlayerStore.getState().slots;
    // Disconnect old engine output node so it won't double-connect after reload
    loopPlayerEngine.destroy();
  });
}
