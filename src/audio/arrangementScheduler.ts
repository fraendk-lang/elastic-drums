/**
 * arrangementScheduler — bar-boundary clip applier
 *
 * Subscribes to drumCurrentStepStore (fires every drum step).
 * Every 16 steps = 1 arrangement bar.
 * Reads active clips from arrangementStore and hot-swaps steps/params
 * into the four instrument stores.
 *
 * Import this module once for its side effects (from App.tsx).
 */

import { drumCurrentStepStore, useDrumStore } from "../store/drumStore";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";
import { useArrangementStore, type ArrangementTrackId } from "../store/arrangementStore";

import { bassEngine, type BassParams } from "./BassEngine";
import { chordsEngine, type ChordsParams } from "./ChordsEngine";
import { melodyEngine, type MelodyParams } from "./MelodyEngine";
import { audioEngine } from "./AudioEngine";
import { faderToGain, useMixerBarStore } from "../store/mixerBarStore";
import { useArrangementAutoStore, interpolateAuto, AUTO_TRACK_CHANNELS, AUTO_PARAM_DEFAULTS, type AutoParam } from "../store/arrangementAutoStore";

// ─── Arrangement bar external store (for playhead) ───────────────────────────

let _arrangementBar = 0;
const _barListeners = new Set<() => void>();
export const arrangementBarStore = {
  subscribe: (fn: () => void): (() => void) => {
    _barListeners.add(fn);
    return () => _barListeners.delete(fn);
  },
  getSnapshot: (): number => _arrangementBar,
};

function notifyBarListeners(): void {
  for (const fn of _barListeners) fn();
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _stepsElapsed = 0;

/** Last clip ID applied per track (null = gap was last applied) */
const _lastClipId: Record<ArrangementTrackId, string | null> = {
  drums: null, bass: null, chords: null, melody: null,
};

/** Baseline params captured when arrangementMode turns on */
let _baselineBassParams: BassParams | null = null;
let _baselineChordsParams: ChordsParams | null = null;
let _baselineMelodyParams: MelodyParams | null = null;

/** Whether the previously-active clip for each melodic track had params */
const _prevClipHadParams: Record<"bass" | "chords" | "melody", boolean> = {
  bass: false, chords: false, melody: false,
};

// ─── Silence helpers ──────────────────────────────────────────────────────────

function makeSilentBassSteps(count = 64) {
  return Array.from({ length: count }, () => ({
    active: false, note: 0, octave: 0, accent: false,
    velocity: 0.82, slide: false, tie: false, gateLength: 1,
  }));
}

function makeSilentChordsSteps(count = 64) {
  return Array.from({ length: count }, () => ({
    active: false, note: 0, chordType: "maj" as const,
    octave: 0, accent: false, velocity: 0.82, tie: false, gateLength: 1,
  }));
}

function makeSilentMelodySteps(count = 64) {
  return Array.from({ length: count }, () => ({
    active: false, note: 0, octave: 0, accent: false,
    velocity: 0.82, slide: false, tie: false, gateLength: 1,
  }));
}

// ─── Restore a single param to its pre-automation (mixer) state ──────────────

function restoreParam(trackId: string, param: AutoParam): void {
  const ch = AUTO_TRACK_CHANNELS[trackId];
  const { channels, groupBuses } = useMixerBarStore.getState();

  switch (param) {
    case "volume": {
      if (ch !== null && ch !== undefined) {
        const c = channels[ch];
        if (c) audioEngine.setChannelVolume(ch, c.muted ? 0 : faderToGain(c.fader));
      } else if (trackId === "drums") {
        const bus = groupBuses["drums"];
        if (bus) audioEngine.setGroupVolume("drums", bus.muted ? 0 : faderToGain(bus.fader));
      }
      break;
    }
    case "filterCutoff":
      if (ch !== null && ch !== undefined) audioEngine.bypassChannelFilter(ch);
      break;
    case "drive":
      if (ch !== null && ch !== undefined) audioEngine.setChannelDrive(ch, 0);
      break;
    case "eqHi":
      if (ch !== null && ch !== undefined) audioEngine.setChannelEQ(ch, "hi", 0);
      break;
    case "eqMid":
      if (ch !== null && ch !== undefined) audioEngine.setChannelEQ(ch, "mid", 0);
      break;
    case "reverb": {
      if (ch !== null && ch !== undefined) {
        const send = (channels[ch]?.sendRev ?? 0) / 100;
        audioEngine.setChannelReverbSend(ch, send);
      }
      break;
    }
    case "delay": {
      if (ch !== null && ch !== undefined) {
        const send = (channels[ch]?.sendDly ?? 0) / 100;
        audioEngine.setChannelDelaySend(ch, send);
      }
      break;
    }
    case "chorus":
      if (ch !== null && ch !== undefined) audioEngine.setChannelChorusSend(ch, 0);
      break;
    case "pan": {
      if (ch !== null && ch !== undefined) {
        const pan = channels[ch]?.pan ?? 0;
        audioEngine.setChannelPan(ch, pan);
      }
      break;
    }
  }
}

/** Restore all currently-open automation lanes to their baseline mixer state */
function restoreAllOpenLanes(): void {
  const { lanes } = useArrangementAutoStore.getState();
  for (const [trackId, trackLanes] of Object.entries(lanes)) {
    for (const lane of trackLanes) {
      if (lane.open) restoreParam(trackId, lane.param);
    }
  }
}

// ─── Apply automation lanes at bar boundary ───────────────────────────────────

function applyAutoLanes(bar: number): void {
  const { lanes } = useArrangementAutoStore.getState();
  for (const [trackId, trackLanes] of Object.entries(lanes)) {
    for (const lane of trackLanes) {
      if (!lane.open) continue;
  const def = AUTO_PARAM_DEFAULTS[lane.param] ?? 0.75;
  const val = interpolateAuto(lane.points, bar, def);  // 0-1
  const ch  = AUTO_TRACK_CHANNELS[trackId];

    switch (lane.param) {
      case "volume":
        if (ch !== null && ch !== undefined) {
          audioEngine.setChannelVolume(ch, faderToGain(val * 1000));
        } else if (trackId === "drums") {
          audioEngine.setGroupVolume("drums", faderToGain(val * 1000));
        }
        break;
      case "pan":
        if (ch !== null && ch !== undefined)
          audioEngine.setChannelPan(ch, val * 2 - 1);
        break;
      case "reverb":
        if (ch !== null && ch !== undefined)
          audioEngine.setChannelReverbSend(ch, val);
        break;
      case "delay":
        if (ch !== null && ch !== undefined)
          audioEngine.setChannelDelaySend(ch, val);
        break;
      case "filterCutoff": {
        if (ch !== null && ch !== undefined) {
          if (val >= 0.995) {
            // Fully open → bypass the filter entirely (no allpass coloring)
            audioEngine.bypassChannelFilter(ch);
          } else {
            // Exponential mapping: 0→1 maps 80 Hz → 18 000 Hz
            const freq = 80 * Math.pow(18000 / 80, val);
            audioEngine.setChannelFilter(ch, "lowpass", freq, 1.0);
          }
        }
        break;
      }
      case "drive":
        if (ch !== null && ch !== undefined)
          audioEngine.setChannelDrive(ch, val * 100);
        break;
      case "chorus":
        if (ch !== null && ch !== undefined)
          audioEngine.setChannelChorusSend(ch, val);
        break;
      case "eqHi":
        if (ch !== null && ch !== undefined)
          audioEngine.setChannelEQ(ch, "hi", (val - 0.5) * 24);
        break;
      case "eqMid":
        if (ch !== null && ch !== undefined)
          audioEngine.setChannelEQ(ch, "mid", (val - 0.5) * 24);
        break;
    }
    } // end for lane
  }   // end for trackId
}

// ─── Apply a single bar ───────────────────────────────────────────────────────

function applyArrangementBar(bar: number): void {
  const store = useArrangementStore.getState();

  // ── DRUMS ──────────────────────────────────────────────────────────────────
  const drumClip = store.getActiveClip("drums", bar);
  const drumClipId = drumClip?.id ?? null;
  if (drumClipId !== _lastClipId.drums) {
    _lastClipId.drums = drumClipId;
    if (drumClip && drumClip.data.kind === "drums") {
      useDrumStore.setState({
        arrangementSilence: false,
        pattern: structuredClone(drumClip.data.pattern),
      });
    } else {
      useDrumStore.setState({ arrangementSilence: true });
    }
  }

  // ── BASS ───────────────────────────────────────────────────────────────────
  const bassClip = store.getActiveClip("bass", bar);
  const bassClipId = bassClip?.id ?? null;
  if (bassClipId !== _lastClipId.bass) {
    _lastClipId.bass = bassClipId;
    if (bassClip && bassClip.data.kind === "bass") {
      const { steps, length, params } = bassClip.data;
      useBassStore.setState({ steps: structuredClone(steps), length });
      if (params) {
        useBassStore.setState({ params: structuredClone(params) });
        bassEngine.setParams(params);
        _prevClipHadParams.bass = true;
      } else {
        _prevClipHadParams.bass = false;
      }
    } else {
      useBassStore.setState({ steps: makeSilentBassSteps(), length: 16 });
      if (_prevClipHadParams.bass && _baselineBassParams) {
        useBassStore.setState({ params: structuredClone(_baselineBassParams) });
        bassEngine.setParams(_baselineBassParams);
      }
      _prevClipHadParams.bass = false;
    }
  }

  // ── CHORDS ─────────────────────────────────────────────────────────────────
  const chordsClip = store.getActiveClip("chords", bar);
  const chordsClipId = chordsClip?.id ?? null;
  if (chordsClipId !== _lastClipId.chords) {
    _lastClipId.chords = chordsClipId;
    if (chordsClip && chordsClip.data.kind === "chords") {
      const { steps, length, params } = chordsClip.data;
      useChordsStore.setState({ steps: structuredClone(steps), length });
      if (params) {
        useChordsStore.setState({ params: structuredClone(params) });
        chordsEngine.setParams(params);
        _prevClipHadParams.chords = true;
      } else {
        _prevClipHadParams.chords = false;
      }
    } else {
      useChordsStore.setState({ steps: makeSilentChordsSteps(), length: 16 });
      if (_prevClipHadParams.chords && _baselineChordsParams) {
        useChordsStore.setState({ params: structuredClone(_baselineChordsParams) });
        chordsEngine.setParams(_baselineChordsParams);
      }
      _prevClipHadParams.chords = false;
    }
  }

  // ── MELODY ─────────────────────────────────────────────────────────────────
  const melodyClip = store.getActiveClip("melody", bar);
  const melodyClipId = melodyClip?.id ?? null;
  if (melodyClipId !== _lastClipId.melody) {
    _lastClipId.melody = melodyClipId;
    if (melodyClip && melodyClip.data.kind === "melody") {
      const { steps, length, params } = melodyClip.data;
      useMelodyStore.setState({ steps: structuredClone(steps), length });
      if (params) {
        useMelodyStore.setState({ params: structuredClone(params) });
        melodyEngine.setParams(params);
        _prevClipHadParams.melody = true;
      } else {
        _prevClipHadParams.melody = false;
      }
    } else {
      useMelodyStore.setState({ steps: makeSilentMelodySteps(), length: 16 });
      if (_prevClipHadParams.melody && _baselineMelodyParams) {
        useMelodyStore.setState({ params: structuredClone(_baselineMelodyParams) });
        melodyEngine.setParams(_baselineMelodyParams);
      }
      _prevClipHadParams.melody = false;
    }
  }
}

// ─── Public: seek to a specific bar ──────────────────────────────────────────

/**
 * Jump the arrangement playhead to `bar` immediately.
 * Works both during playback and while stopped.
 * The step counter resumes counting from bar * 16 on the next tick.
 */
export function seekToBar(bar: number): void {
  const target = Math.max(0, bar);
  _stepsElapsed = target * 16;
  _arrangementBar = target;
  notifyBarListeners();
  applyArrangementBar(target);
  applyAutoLanes(target);
}

// ─── Reset when arrangement mode turns on/off ─────────────────────────────────

function resetScheduler(): void {
  _stepsElapsed = 0;
  _arrangementBar = 0;
  _lastClipId.drums = null;
  _lastClipId.bass = null;
  _lastClipId.chords = null;
  _lastClipId.melody = null;
  _prevClipHadParams.bass = false;
  _prevClipHadParams.chords = false;
  _prevClipHadParams.melody = false;
  notifyBarListeners();
}

// ─── Subscribe to arrangement mode changes ────────────────────────────────────

function initScheduler(): void {
  useDrumStore.subscribe((state, prev) => {
    // Arrangement mode just turned ON
    if (state.arrangementMode && !prev.arrangementMode) {
      _baselineBassParams = structuredClone(useBassStore.getState().params);
      _baselineChordsParams = structuredClone(useChordsStore.getState().params);
      _baselineMelodyParams = structuredClone(useMelodyStore.getState().params);
      resetScheduler();
      applyArrangementBar(0);
      applyAutoLanes(0);
    }

    // Arrangement mode just turned OFF — restore all automated params
    if (!state.arrangementMode && prev.arrangementMode) {
      restoreAllOpenLanes();
      useDrumStore.setState({ arrangementSilence: false });
      resetScheduler();
    }

    // Playback started while in arrangement mode — apply current bar immediately
    if (state.isPlaying && !prev.isPlaying && state.arrangementMode) {
      applyAutoLanes(_arrangementBar);
    }

    // Playback stopped while in arrangement mode
    if (!state.isPlaying && prev.isPlaying && state.arrangementMode) {
      resetScheduler();
      applyArrangementBar(0);
      applyAutoLanes(0);
    }
  });

  // ── Restore when a lane is closed, removed, or its param changes ─────────
  useArrangementAutoStore.subscribe((state, prev) => {
    if (!useDrumStore.getState().arrangementMode) return;

    for (const trackId of Object.keys(prev.lanes)) {
      const prevLanes = prev.lanes[trackId]  ?? [];
      const nextLanes = state.lanes[trackId] ?? [];
      const nextMap   = new Map(nextLanes.map((l) => [l.id, l]));

      for (const prevLane of prevLanes) {
        const nextLane = nextMap.get(prevLane.id);

        // Lane removed entirely
        if (!nextLane && prevLane.open) {
          restoreParam(trackId, prevLane.param);
          continue;
        }
        if (!nextLane) continue;

        // Lane toggled closed
        if (prevLane.open && !nextLane.open) {
          restoreParam(trackId, prevLane.param);
        }

        // Param changed on an open lane → restore old param first
        if (prevLane.open && nextLane.open && prevLane.param !== nextLane.param) {
          restoreParam(trackId, prevLane.param);
        }
      }
    }
  });

  // ── Main step counter ──────────────────────────────────────────────────────
  drumCurrentStepStore.subscribe(() => {
    if (!useDrumStore.getState().arrangementMode) return;
    if (!useDrumStore.getState().isPlaying) return;

    _stepsElapsed++;
    if (_stepsElapsed % 16 === 0) {
      _arrangementBar = Math.floor(_stepsElapsed / 16);

      // ── Loop region check ────────────────────────────────────────────────
      const { loopRegion } = useArrangementStore.getState();
      if (loopRegion.enabled && _arrangementBar >= loopRegion.end) {
        seekToBar(loopRegion.start);
        return; // seekToBar handles notify + apply
      }

      notifyBarListeners();
      applyArrangementBar(_arrangementBar);
      applyAutoLanes(_arrangementBar);
    }
  });
}

// Defer initialization to ensure all chunks are fully evaluated before
// subscribing. Prevents "Cannot read properties of undefined" errors
// caused by circular chunk dependencies in production Rollup bundles.
// (chunk-audio → chunk-stores → chunk-audio circular reference)
setTimeout(initScheduler, 0);
