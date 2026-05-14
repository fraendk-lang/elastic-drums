/**
 * XY Performance Pad — multi-touch expression instrument.
 *
 * Each pointer spawns a polyphonic voice on the target engine.
 * X = pitch (scale-locked across configurable octave range).
 * Y = assignable modulation parameter (cutoff/resonance/envMod/...).
 * Multi-touch: each finger plays its own voice independently.
 *
 * Records pointer events into a loopable expression pattern.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { usePerformancePadStore, CHORD_SETS, type YAxisParam, type PadTarget, type PadMode } from "../store/performancePadStore";
import { useMelodyStore, MELODY_PRESETS } from "../store/melodyStore";
import { useBassStore, BASS_PRESETS } from "../store/bassStore";
import { useDrumStore, getDrumTransportStartTime } from "../store/drumStore";
import { melodyEngine } from "../audio/MelodyEngine";
import { bassEngine, SCALES } from "../audio/BassEngine";
import { chordsEngine } from "../audio/ChordsEngine";
import { audioEngine } from "../audio/AudioEngine";
import { sendFxManager } from "../audio/SendFx";
import { ArpScheduler } from "../audio/ArpScheduler";
import { DEFAULT_ARP_SETTINGS } from "../audio/Arpeggiator";
import { getMelodyEngineFxChain } from "../audio/MelodyLayerFx";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// MIDI number → "C4", "A#3" etc.
const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiToName(midi: number): string {
  return (NOTE_NAMES_SHARP[midi % 12] ?? "?") + (Math.floor(midi / 12) - 1);
}

// Y-Param definitions — wide, dramatic ranges that make every gesture feel powerful.
// "springBack" params restore their original value when all pointers leave the pad.
const Y_PARAMS: { id: YAxisParam; label: string; range: [number, number]; springBack?: boolean; group: "synth" | "fx" }[] = [
  // ── Synth params (affect melody/bass engine directly) ──────────────────
  { id: "cutoff",     label: "CUTOFF",   range: [60, 18000],  group: "synth" },  // full spectrum: bass rumble → hi-hat shimmer
  { id: "resonance",  label: "RESO",     range: [0, 30],      group: "synth" },  // screaming acid resonance
  { id: "envMod",     label: "ENVMOD",   range: [0, 1.2],     group: "synth" },  // heavy filter envelope depth
  { id: "decay",      label: "DECAY",    range: [30, 1400],   group: "synth" },  // short stab → long sustain
  { id: "distortion", label: "SYNTH DRV",range: [0, 1.5],     group: "synth" },  // light crunch → heavy saturation
  { id: "volume",     label: "VOL",      range: [0.02, 1.4],  group: "synth" },  // silence → loud blast
  // ── FX params (affect send buses — spring back to original on release) ─
  { id: "reverb",    label: "REVERB",   range: [0, 1.8],  springBack: true, group: "fx" },  // dry → massive wash
  { id: "delay",     label: "DELAY",    range: [0, 1.4],  springBack: true, group: "fx" },  // off → slapback echo
  { id: "drive",     label: "MASTER DRV",range: [0, 1.5], springBack: true, group: "fx" },  // clean → crushed
  { id: "pitch",     label: "PITCH ↕",  range: [-12, 12], springBack: true, group: "fx" },  // MPE pitch bend ±12 st
];

interface ActiveVoice {
  pointerId: number;
  midi: number;         // Current pitch (for glide); for chords: root of chord
  startAt: number;      // performance.now() at down
  velocity: number;
  /** Release handles — multiple for chord mode (one per chord note), single for note mode */
  releases: Array<(() => void) | null>;
  /** For chord mode: which cell is active */
  cellIndex?: number;
}

/** FX values saved before pad interaction — restored on last-finger-up if springBack param */
interface FxSnapshot {
  reverb: number;
  delay: number;
  drive: number;
}

// Persist pad volume per-target across open/close cycles (component unmounts on close)
const _padVolumeByTarget: Record<string, number> = {};

export function PerformancePad({ isOpen, onClose }: Props) {
  const {
    target, mode, chordSetIndex, yParam, scaleOctaves, scaleLowestOct, gridSnap, trailEnabled, chordFollow, gridRows,
    events, isArmed, isRecording, isStepRecording, stepCursorMs, isLooping, loopDuration, loopBars, quantize,
    setTarget, setMode, setChordSetIndex, setYParam, setScaleOctaves, setScaleLowestOct, setGridSnap, setTrailEnabled, setChordFollow, setGridRows,
    armRecording, startStepRecording, stopRecording, clearRecording, skipStep, undoLastStep, appendEvent, setLoopBars, setQuantize,
    startLoop, stopLoop,
    customChordSets, setChordIntervals, resetChordCell,
  } = usePerformancePadStore();

  const setBassLiveTranspose = useBassStore((s) => s.setLiveTransposeOffset);
  const setMelodyLiveTranspose = useMelodyStore((s) => s.setLiveTransposeOffset);

  const chordSet = customChordSets[chordSetIndex] ?? customChordSets[0] ?? CHORD_SETS[0]!;

  // Pull current scale/root from melody or bass store based on target
  const melodyRoot = useMelodyStore((s) => s.rootNote);
  const melodyScale = useMelodyStore((s) => s.scaleName);
  const melodyPresetIndex = useMelodyStore((s) => s.presetIndex);
  const loadMelodyPreset = useMelodyStore((s) => s.loadPreset);
  const nextMelodyPreset = useMelodyStore((s) => s.nextPreset);
  const prevMelodyPreset = useMelodyStore((s) => s.prevPreset);

  const bassRoot = useBassStore((s) => s.rootNote);
  const bassScale = useBassStore((s) => s.scaleName);
  const bassPresetIndex = useBassStore((s) => s.presetIndex);
  const loadBassPreset = useBassStore((s) => s.loadPreset);
  const nextBassPreset = useBassStore((s) => s.nextPreset);
  const prevBassPreset = useBassStore((s) => s.prevPreset);

  const currentPresetName = target === "melody"
    ? (MELODY_PRESETS[melodyPresetIndex]?.name ?? "Preset")
    : (BASS_PRESETS[bassPresetIndex]?.name ?? "Preset");
  const totalPresets = target === "melody" ? MELODY_PRESETS.length : BASS_PRESETS.length;
  const activePresetIndex = target === "melody" ? melodyPresetIndex : bassPresetIndex;
  const handlePrevPreset = target === "melody" ? prevMelodyPreset : prevBassPreset;
  const handleNextPreset = target === "melody" ? nextMelodyPreset : nextBassPreset;
  const handleLoadPreset = target === "melody" ? loadMelodyPreset : loadBassPreset;

  const rootNote = target === "melody" ? melodyRoot : bassRoot;
  const scaleName = target === "melody" ? melodyScale : bassScale;

  const bpm = useDrumStore((s) => s.bpm);

  // ── Space FX state ──────────────────────────────────────────────────────────
  const [shimmerOn, setShimmerOn] = useState(false);
  const [shimmerDepth, setShimmerDepth] = useState(0.55);
  const [shimmerFeedback, setShimmerFeedback] = useState(0.28);
  const [padVolume, setPadVolume] = useState(() => _padVolumeByTarget[target] ?? 80);
  const [arpOn, setArpOn] = useState(false);
  const [arpMode, setArpMode] = useState<"up" | "down" | "updown" | "downup" | "converge" | "diverge" | "random" | "chord">("up");
  const [arpRate, setArpRate] = useState<"1/4" | "1/8" | "1/16">("1/8");
  const [arpOctaves, setArpOctaves] = useState<1 | 2>(1);
  const [arpLatch, setArpLatch] = useState(false);
  const arpSchedulerRef = useRef<ArpScheduler | null>(null);
  if (arpSchedulerRef.current === null) {
    arpSchedulerRef.current = new ArpScheduler();
  }
  const arpRootRef = useRef<number>(60);

  // ── Chord Editor ──────────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<{ setIdx: number; cellIdx: number } | null>(null);
  /** Long-press tracking: timer + pointerId + pointer position at press start */
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPointerId = useRef<number | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Derived editor state — resolved from customChordSets when editTarget is set */
  const [editIntervals, setEditIntervals] = useState<boolean[]>(Array(12).fill(false));
  const [editLabel, setEditLabel] = useState("");

  const arpModeRef = useRef(arpMode);
  const arpRateRef = useRef(arpRate);
  const arpOctavesRef = useRef(arpOctaves);
  const arpOnRef = useRef(arpOn);
  const arpLatchRef = useRef(arpLatch);
  const scaleNameRef = useRef(scaleName);
  const gridRowsRef = useRef(gridRows);
  const rootNoteRef = useRef(rootNote);
  const scaleLowestOctRef = useRef(scaleLowestOct);
  const modeRef = useRef(mode);
  arpModeRef.current = arpMode;
  arpRateRef.current = arpRate;
  arpOctavesRef.current = arpOctaves;
  arpOnRef.current = arpOn;
  arpLatchRef.current = arpLatch;
  scaleNameRef.current = scaleName;
  gridRowsRef.current = gridRows;
  rootNoteRef.current = rootNote;
  scaleLowestOctRef.current = scaleLowestOct;
  modeRef.current = mode;

  const padRef = useRef<HTMLDivElement | null>(null);
  const activeVoicesRef = useRef<Map<number, ActiveVoice>>(new Map());
  const rafIdRef = useRef<number | null>(null);
  /** FX levels captured at first pointer-down — restored on last pointer-up for spring-back params */
  const fxSnapshotRef = useRef<FxSnapshot | null>(null);

  // Particle trail — each trail point decays over ~600ms
  interface TrailPoint { x: number; y: number; t: number; pointerId: number }
  const trailRef = useRef<TrailPoint[]>([]);

  // Reset transpose when overlay closes (prevents stale offset if closed mid-press)
  useEffect(() => {
    if (!isOpen) {
      setBassLiveTranspose(0);
      setMelodyLiveTranspose(0);
    }
  }, [isOpen, setBassLiveTranspose, setMelodyLiveTranspose]);

  useEffect(() => {
    if (!isOpen) return;
    if (target === "melody") melodyEngine.sweepLiveVolume(padVolume / 100);
    else bassEngine.sweepLiveVolume(padVolume / 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, target]);

  useEffect(() => {
    const sched = arpSchedulerRef.current;
    return () => { sched?.stop(); };
  }, []);

  // ── Wake-up handler ─────────────────────────────────────────────────────
  // When the browser window/tab regains focus, the AudioContext may have been
  // suspended and the SchedulerClock's main-thread message dispatch may have
  // been throttled. If the ARP is running with LATCH on, audio appears to stop.
  // Listen for focus + visibilitychange so we can resume the audio context and
  // immediately re-tick the scheduler to refill its lookahead window.
  useEffect(() => {
    if (!isOpen) return;
    const wakeUp = () => {
      // Don't bother if we don't actually need audio right now
      if (!arpOnRef.current && activeVoicesRef.current.size === 0) return;
      audioEngine.resume();
      // Force the scheduler to schedule notes immediately rather than wait for
      // the next worklet tick to get unstuck on the main thread.
      arpSchedulerRef.current?.kick();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") wakeUp();
    };
    window.addEventListener("focus", wakeUp);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", wakeUp);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isOpen]);

  /** Apply chord-follow: transpose Bass + Melody engines to match the given chord root.
   *  Pass null to clear. Uses closest-octave diff from current bass rootNote. */
  const applyChordFollow = useCallback((chordRootMidi: number | null) => {
    if (!chordFollow) return;
    if (chordRootMidi === null) {
      setBassLiveTranspose(0);
      setMelodyLiveTranspose(0);
      return;
    }
    // Use the bass root as the anchor (assumes bass+melody share the same key root,
    // which they do via the scale-sync system in bassStore).
    let diff = (chordRootMidi - bassRoot) % 12;
    if (diff < 0) diff += 12;
    if (diff > 6) diff -= 12;  // Take closest direction (within ±6 semitones)
    setBassLiveTranspose(diff);
    setMelodyLiveTranspose(diff);
  }, [chordFollow, bassRoot, setBassLiveTranspose, setMelodyLiveTranspose]);

  const handleArpToggle = useCallback(() => {
    setArpOn((prev) => {
      if (prev) arpSchedulerRef.current?.stop();
      return !prev;
    });
  }, []);

  // ── Pitch mapping: X [0-1] → MIDI note via scale ──
  // ── Export recording to Piano Roll ──
  const exportToPianoRoll = useCallback(async () => {
    if (events.length === 0) return;
    const msPerBeat = 60000 / bpm;

    // Group down→up pairs per pointerId into notes (pitch = median X)
    const noteStarts = new Map<number, { t: number; x: number; velocity: number; xs: number[] }>();
    const rawNotes: { startMs: number; endMs: number; x: number; velocity: number }[] = [];

    for (const ev of events) {
      if (ev.type === "down") {
        noteStarts.set(ev.pointerId, { t: ev.t, x: ev.x, velocity: ev.velocity, xs: [ev.x] });
      } else if (ev.type === "move") {
        const rec = noteStarts.get(ev.pointerId);
        if (rec) rec.xs.push(ev.x);
      } else if (ev.type === "up") {
        const rec = noteStarts.get(ev.pointerId);
        if (rec) {
          noteStarts.delete(ev.pointerId);
          const sortedXs = [...rec.xs].sort((a, b) => a - b);
          const medianX = sortedXs[Math.floor(sortedXs.length / 2)] ?? rec.x;
          rawNotes.push({
            startMs: rec.t,
            endMs: ev.t,
            x: medianX,
            velocity: rec.velocity,
          });
        }
      }
    }

    if (rawNotes.length === 0) return;

    const { importPianoRollNotes } = await import("./PianoRoll/persistedState");
    const { uid } = await import("./PianoRoll/types");
    // Minimum note duration = 1/16 (0.25 beats) so exported notes are always
    // clearly visible and musical in the Piano Roll. Very-short taps on the
    // pad wouldn't survive otherwise.
    const pianoRollNotes: import("./PianoRoll/types").PianoRollNote[] = rawNotes.map((n) => ({
      id: uid(),
      midi: xToMidi(n.x),
      start: n.startMs / msPerBeat,
      duration: Math.max(0.25, (n.endMs - n.startMs) / msPerBeat),
      velocity: Math.max(0.1, Math.min(1, n.velocity)),
      track: target === "bass" ? "bass" : "melody",
    }));

    importPianoRollNotes(pianoRollNotes);
    // Feedback: show brief alert (simple confirmation)
    alert(`${pianoRollNotes.length} Noten in Piano Roll importiert.\nÖffne Piano Roll zum Anzeigen.`);
  }, [events, bpm, target]);
  // NOTE: xToMidi intentionally omitted from deps — it's defined below but stable via useCallback.
  // We rely on closure capture at call time (handler fires after all hooks are declared).

  const xToMidi = useCallback((x: number): number => {
    const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
    const baseMidi = rootNote + scaleLowestOct * 12;
    if (gridSnap) {
      const totalSteps = scale.length * scaleOctaves;
      const stepIdx = Math.floor(x * totalSteps);
      const clamped = Math.max(0, Math.min(totalSteps - 1, stepIdx));
      const octave = Math.floor(clamped / scale.length);
      const degree = clamped % scale.length;
      return baseMidi + octave * 12 + (scale[degree] ?? 0);
    } else {
      // Smooth: linear interpolation across chromatic range
      return Math.round(baseMidi + x * scaleOctaves * 12);
    }
  }, [scaleName, rootNote, scaleLowestOct, scaleOctaves, gridSnap]);

  // ── Y mapping: Y [0-1] → param value ──
  // Y=0 is TOP of pad (high value = most expressive at the top — natural gesture)
  // Y=1 is BOTTOM (low value)
  const yToParam = useCallback((y: number): number => {
    const info = Y_PARAMS.find((p) => p.id === yParam)!;
    const [min, max] = info.range;
    // Flip: top of pad = max value
    const t = 1 - y;
    // Exponential perceptual curve for frequency/time params
    if (yParam === "cutoff" || yParam === "decay") {
      const ratio = max / min;
      return min * Math.pow(ratio, t);
    }
    // Square-law for resonance (feels more gradual at low end)
    if (yParam === "resonance") {
      return min + t * t * (max - min);
    }
    // Linear for all others (reverb/delay/drive/envMod/distortion/volume)
    return min + t * (max - min);
  }, [yParam]);

  // ── Fire a voice — returns release handle ──
  const fireVoice = useCallback((midi: number, velocity: number, y: number, opts?: { startTime?: number; duration?: number }): (() => void) | null => {
    const ctx = audioEngine.getAudioContext();
    if (!ctx) return null;
    // Default: trigger ~1ms ahead with 30s pseudo-sustain (released on pointer-up).
    // Loop playback overrides startTime + duration to schedule notes exactly on
    // the audio clock — bypasses setTimeout main-thread jitter.
    const startTime = opts?.startTime ?? (ctx.currentTime + 0.001);
    const duration = opts?.duration ?? 30.0;

    // Apply Y modulation to engine params BEFORE trigger
    const paramValue = yToParam(y);
    if (target === "melody") {
      melodyEngine.setParams({ [yParam]: paramValue });
      return melodyEngine.triggerPolyNote(midi, startTime, duration, velocity, false);
    } else {
      bassEngine.setParams({ [yParam]: paramValue });
      bassEngine.triggerNote(midi, startTime, false, false, false, velocity);
      return () => bassEngine.releaseNote(ctx.currentTime);
    }
  }, [target, yParam, yToParam]);

  // ── Live Y modulation while dragging ──
  const modulateVoice = useCallback((y: number) => {
    const paramValue = yToParam(y);

    // FX params → SendFx bus (spring-back captured at pointer-down)
    if (yParam === "reverb") { sendFxManager.setReverbLevel(paramValue); return; }
    if (yParam === "delay")  { sendFxManager.setDelayLevel(paramValue);  return; }
    if (yParam === "drive") {
      // Master saturation: route through setParam-equivalent
      // sendFxManager doesn't expose master sat directly, so use distortion on engine
      if (target === "melody") melodyEngine.setParams({ distortion: paramValue });
      else bassEngine.setParams({ distortion: paramValue });
      return;
    }

    // Cutoff/Resonance → sweepLiveFilter (updates PLAYING voice filters in real-time)
    if (yParam === "cutoff") {
      if (target === "melody") melodyEngine.sweepLiveFilter(paramValue);
      else bassEngine.sweepLiveFilter(paramValue);
      return;
    }
    if (yParam === "resonance") {
      // Normalise to 0-1 for sweepLiveFilter resonanceNorm param
      const normRes = paramValue / 30;
      if (target === "melody") melodyEngine.sweepLiveFilter(melodyEngine["params"]?.cutoff ?? 2000, normRes);
      else bassEngine.sweepLiveFilter(bassEngine["params"]?.cutoff ?? 2000, normRes);
      // Also update engine params so next trigger uses the new resonance
      if (target === "melody") melodyEngine.setParams({ resonance: paramValue });
      else bassEngine.setParams({ resonance: paramValue });
      return;
    }

    // Volume → direct output gain sweep (affects playing notes immediately)
    if (yParam === "volume") {
      if (target === "melody") melodyEngine.sweepLiveVolume(paramValue);
      else bassEngine.sweepLiveVolume(paramValue);
      return;
    }

    // Pitch bend → sweepLivePitch (detunes all active voices in real-time)
    if (yParam === "pitch") {
      if (target === "melody") melodyEngine.sweepLivePitch(paramValue);
      return;
    }

    // All other params (envMod, decay, distortion) → setParams (affects next trigger)
    if (target === "melody") melodyEngine.setParams({ [yParam]: paramValue });
    else bassEngine.setParams({ [yParam]: paramValue });
  }, [target, yParam, yToParam]);

  // ── Re-trigger on pitch change: release old voice, spawn fresh ──
  const repitchVoice = useCallback((voice: ActiveVoice, newMidi: number, y: number) => {
    if (voice.midi === newMidi) return;
    voice.midi = newMidi;
    if (target === "melody") {
      // Release old voices (smooth fade) then spawn new
      voice.releases.forEach((r) => r?.());
      const newRelease = fireVoice(newMidi, voice.velocity * 0.9, y);
      voice.releases = [newRelease];
    } else {
      const ctx = audioEngine.getAudioContext();
      if (!ctx) return;
      // Bass mono: slide-retrigger (engine handles portamento internally)
      bassEngine.triggerNote(newMidi, ctx.currentTime + 0.001, false, true, false, voice.velocity);
    }
  }, [target, fireVoice]);

  // ── Pointer handlers ──
  const getXY = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isOpen) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = getXY(e);

    // ── Long-press detection for chord editor (chord mode only) ──────────
    if (mode === "chords") {
      const col = Math.max(0, Math.min(chordSet.cols - 1, Math.floor(x * chordSet.cols)));
      const row = Math.max(0, Math.min(chordSet.rows - 1, Math.floor(y * chordSet.rows)));
      const cellIdx = row * chordSet.cols + col;
      longPressPointerId.current = e.pointerId;
      longPressOrigin.current = { x: e.clientX, y: e.clientY };
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = setTimeout(() => {
        // Only fire if same pointer and it hasn't moved much (< 12px)
        if (longPressPointerId.current === e.pointerId) {
          const cell = customChordSets[chordSetIndex]?.cells[cellIdx];
          if (cell) {
            const bools = Array(12).fill(false) as boolean[];
            cell.intervals.forEach((iv) => { if (iv >= 0 && iv < 12) bools[iv] = true; });
            setEditIntervals(bools);
            setEditLabel(cell.label);
            setEditTarget({ setIdx: chordSetIndex, cellIdx });
            if (navigator.vibrate) navigator.vibrate(40);
          }
        }
      }, 500);
    }

    // Snapshot FX levels for spring-back params on FIRST pointer down only
    if (activeVoicesRef.current.size === 0) {
      const paramDef = Y_PARAMS.find((p) => p.id === yParam);
      if (paramDef?.springBack) {
        fxSnapshotRef.current = {
          reverb: sendFxManager.getReverbLevel(),
          delay: sendFxManager.getDelayLevel(),
          drive: 0, // drive is engine-specific, reset to 0 on release
        };
      } else {
        fxSnapshotRef.current = null;
      }
    }

    // Velocity: Y position (top = loud, bottom = soft) + pressure if available.
    // This makes playing in the upper half louder — natural performance gesture.
    const yVelocityBoost = 0.3 + (1 - y) * 0.7;  // top of pad → 1.0, bottom → 0.3
    const pressureBoost = e.pressure > 0 ? e.pressure : 0.85;
    const velocity = Math.min(1.0, yVelocityBoost * 0.6 + pressureBoost * 0.4);

    // Apply Y modulation immediately on press
    modulateVoice(y);

    let voice: ActiveVoice;
    if (mode === "chords") {
      // Find which chord cell the pointer hit
      const col = Math.max(0, Math.min(chordSet.cols - 1, Math.floor(x * chordSet.cols)));
      const row = Math.max(0, Math.min(chordSet.rows - 1, Math.floor(y * chordSet.rows)));
      const cellIdx = row * chordSet.cols + col;
      const chord = chordSet.cells[cellIdx];
      if (!chord) return;
      const rootMidi = chordSet.rootMidi + chord.rootOffset;
      // ── Chord-follow: transpose Bass+Melody engines to match this chord's root ──
      applyChordFollow(rootMidi);

      const releases: Array<(() => void) | null> = [];
      const ctx = audioEngine.getAudioContext();
      // Strum: stagger notes by 0–35ms for human feel (root = 0ms, 5th = 12ms, 3rd = 22ms…)
      const strumGap = 0.015; // 15ms between chord notes
      chord.intervals.forEach((interval, i) => {
        const noteMidi = rootMidi + interval;
        const strumDelay = i * strumGap;
        const yCell = 1 - ((row + 0.5) / chordSet.rows);
        // Inner voices slightly softer than root
        const noteVel = velocity * (i === 0 ? 1.0 : 0.82 - i * 0.04);
        const startTime = (ctx?.currentTime ?? 0) + 0.001 + strumDelay;
        // Fire with strum delay using direct engine calls.
        // Both engines now have a true polyphonic path (triggerPolyNote) —
        // chord-mode in bass target previously sounded only the LAST note
        // because the BassEngine was mono. With per-voice poly synthesis
        // each chord-tone rings independently.
        const r = (target === "melody")
          ? melodyEngine.triggerPolyNote(noteMidi, startTime, 30.0, noteVel, false)
          : bassEngine.triggerPolyNote(noteMidi, startTime, 30.0, noteVel, false);
        void yCell; // used in Y modulation callback
        releases.push(r);
      });
      voice = { pointerId: e.pointerId, midi: rootMidi, startAt: performance.now(), velocity, releases, cellIndex: cellIdx };
    } else if (mode === "grid") {
      // Scale-grid mode: fixed cells, multi-touch chord playing
      const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
      const cols = scale.length;
      const col = Math.max(0, Math.min(cols - 1, Math.floor(x * cols)));
      const row = Math.max(0, Math.min(gridRows - 1, Math.floor(y * gridRows)));
      const baseMidi = rootNote + scaleLowestOct * 12;
      // Top row = highest octave
      const midi = baseMidi + (gridRows - 1 - row) * 12 + (scale[col] ?? 0);
      const release = fireVoice(midi, velocity, y);
      voice = { pointerId: e.pointerId, midi, startAt: performance.now(), velocity, releases: [release] };
    } else if (arpOn && target === "melody") {
      const midi = xToMidi(x);
      arpRootRef.current = midi;
      if (!arpSchedulerRef.current?.isRunning) {
        arpSchedulerRef.current?.start({
          getRoot: () => arpRootRef.current,
          getSettings: () => ({
            ...DEFAULT_ARP_SETTINGS,
            mode: arpModeRef.current,
            rate: arpRateRef.current,
            octaves: arpOctavesRef.current,
            gate: "medium",
          }),
          getScaleName: () => scaleNameRef.current,
          onNote: (noteMidi, duration, atTime, vel) => {
            melodyEngine.triggerPolyNote(noteMidi, atTime, duration, vel, false);
          },
          getBpm: () => useDrumStore.getState().bpm,
          // Tight 100ms while user touches the pad (immediate response to
          // X-position changes); 1s buffer when LATCH keeps it running on
          // its own (covers main-thread throttling on background tabs).
          getLookahead: () => activeVoicesRef.current.size > 0 ? 0.1 : (arpLatchRef.current ? 1.0 : 0.1),
        });
      }
      voice = { pointerId: e.pointerId, midi, startAt: performance.now(), velocity, releases: [] };
    } else {
      const midi = xToMidi(x);
      const release = fireVoice(midi, velocity, y);
      voice = { pointerId: e.pointerId, midi, startAt: performance.now(), velocity, releases: [release] };
    }

    activeVoicesRef.current.set(e.pointerId, voice);
    trailRef.current.push({ x, y, t: performance.now(), pointerId: e.pointerId });
    appendEvent({ type: "down", pointerId: e.pointerId, x, y, velocity });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = getXY(e);
    // Always drop a trail point on ANY movement (hover or press) so user sees motion feedback
    trailRef.current.push({ x, y, t: performance.now(), pointerId: e.pointerId });
    if (trailRef.current.length > 120) trailRef.current.shift();

    // Cancel long-press if pointer moves more than 12px
    if (longPressPointerId.current === e.pointerId) {
      const dx = Math.abs(e.clientX - longPressOrigin.current.x);
      const dy = Math.abs(e.clientY - longPressOrigin.current.y);
      if (dx > 12 || dy > 12) {
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
        longPressPointerId.current = null;
      }
    }

    const voice = activeVoicesRef.current.get(e.pointerId);
    if (!voice) return;  // Hover-only mode: just show trail, no audio modulation
    e.preventDefault();

    if (mode === "chords" || mode === "grid") {
      // In chord/grid mode: Y axis modulates params for expressiveness,
      // but pitch is locked to the cell until pointer-up
      modulateVoice(y);
    } else if (arpOn && target === "melody") {
      modulateVoice(y);
      arpRootRef.current = xToMidi(x);
    } else {
      modulateVoice(y);
      if (gridSnap) {
        const newMidi = xToMidi(x);
        if (newMidi !== voice.midi) repitchVoice(voice, newMidi, y);
      }
    }
    appendEvent({ type: "move", pointerId: e.pointerId, x, y, velocity: voice.velocity });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // Cancel long-press timer on finger lift
    if (longPressPointerId.current === e.pointerId) {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      longPressPointerId.current = null;
    }
    const voice = activeVoicesRef.current.get(e.pointerId);
    if (!voice) return;
    activeVoicesRef.current.delete(e.pointerId);
    const { x, y } = getXY(e);
    appendEvent({ type: "up", pointerId: e.pointerId, x, y, velocity: voice.velocity });
    // Trigger musical release for all voices (single note or chord stack)
    voice.releases.forEach((r) => r?.());
    // Chord-follow: if no chord voices remain, reset transpose to 0
    if (mode === "chords") {
      const stillChordActive = Array.from(activeVoicesRef.current.values()).some((v) => v.cellIndex !== undefined);
      if (!stillChordActive) applyChordFollow(null);
    }
    // Stop arp when last finger lifts (unless latch is on)
    if (arpOnRef.current && target === "melody" && activeVoicesRef.current.size === 0 && !arpLatchRef.current) {
      arpSchedulerRef.current?.stop();
    }

    // Restore padVolume when Y-axis volume modulation ends
    if (activeVoicesRef.current.size === 0 && yParam === "volume") {
      if (target === "melody") melodyEngine.sweepLiveVolume(padVolume / 100);
      else bassEngine.sweepLiveVolume(padVolume / 100);
    }

    // Spring-back: restore FX levels when ALL fingers are lifted
    if (activeVoicesRef.current.size === 0 && fxSnapshotRef.current) {
      const snap = fxSnapshotRef.current;
      fxSnapshotRef.current = null;
      // Smooth fade back — AudioParam.setTargetAtTime gives a clean exponential fade
      if (yParam === "reverb") {
        audioEngine.setReverbLevelSmooth(snap.reverb, 0.18); // 180ms time constant ≈ 400ms perceptual fade
      } else if (yParam === "delay") {
        audioEngine.setDelayLevelSmooth(snap.delay, 0.18);
      } else if (yParam === "drive") {
        // Restore synth distortion (engine-specific)
        if (target === "melody") melodyEngine.setParams({ distortion: 0 });
        else bassEngine.setParams({ distortion: 0 });
      } else if (yParam === "pitch") {
        // Snap detune back to zero on finger lift
        if (target === "melody") melodyEngine.resetLivePitch();
      }
    }
  };

  // ── Loop playback engine ──
  // Strategy: instead of scheduling separate "down" + "up" timers (race-prone
  // at iteration boundaries), pair every down with its matching up at SCHEDULE
  // time and pass the resulting duration directly to the audio engine. The
  // engine handles release on its own audio clock — no setTimeout race, no
  // hanging notes. "move" events still use setTimeout (gestural, not timing-
  // critical).
  useEffect(() => {
    if (!isLooping || events.length === 0) return;
    const ctx = audioEngine.getAudioContext();
    if (!ctx) return;

    // Pre-compute paired note events: for each "down", find the matching "up"
    // (same pointerId, smallest t > down.t) and combine into { startT, duration, midi, velocity, y }.
    // This happens once per useEffect run, not per iteration.
    interface PairedNote { startT: number; duration: number; pointerId: number; x: number; y: number; velocity: number }
    const pairedNotes: PairedNote[] = [];
    const moves: typeof events = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      if (ev.type === "move") {
        moves.push(ev);
      } else if (ev.type === "down") {
        // Find next "up" with same pointerId
        let upT = ev.t + 100; // fallback 100ms if no up found
        for (let j = i + 1; j < events.length; j++) {
          const cand = events[j]!;
          if (cand.type === "up" && cand.pointerId === ev.pointerId && cand.t > ev.t) {
            upT = cand.t;
            break;
          }
        }
        const duration = Math.max(0.02, (upT - ev.t) / 1000); // seconds, min 20ms
        pairedNotes.push({ startT: ev.t, duration, pointerId: ev.pointerId, x: ev.x, y: ev.y, velocity: ev.velocity });
      }
      // "up" events are handled via the duration param — no explicit scheduling
    }

    // Sort by start time so iteration scheduling fires events in order
    pairedNotes.sort((a, b) => a.startT - b.startT);
    const sortedMoves = [...moves].sort((a, b) => a.t - b.t);

    const dur = loopDuration;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const playbackVoices = new Map<number, ActiveVoice>();

    // ── Loop-start anchor ─────────────────────────────────────────────
    // If drums are playing, line up iteration #0 with the NEXT bar boundary
    // so the gesture loop locks to the same grid as the sequencer. Without
    // this the gesture wraps at "wherever the user clicked PLAY + 50ms" —
    // any phase offset against the drums then sounds like the loop is
    // "almost but not quite" in time. With it, the first note of the
    // gesture lands exactly on a downbeat regardless of when STOP was hit.
    const drumState = useDrumStore.getState();
    const bpm = drumState.bpm;
    const msPerBar = (60000 / bpm) * 4;
    let iterationAudioStart: number;
    if (drumState.isPlaying) {
      const transportStart = getDrumTransportStartTime();
      const barSec = msPerBar / 1000;
      const elapsed = ctx.currentTime - transportStart;
      const nextBar = Math.ceil(elapsed / barSec) * barSec;
      iterationAudioStart = transportStart + nextBar;
      // Small safety margin so we never schedule into the past on tiny stalls
      if (iterationAudioStart < ctx.currentTime + 0.02) iterationAudioStart += barSec;
    } else {
      iterationAudioStart = ctx.currentTime + 0.05;
    }
    const wallStart = performance.now() + (iterationAudioStart - ctx.currentTime) * 1000;

    const scheduleIteration = (iterAudioStart: number, iterWallStart: number) => {
      // Schedule paired notes — each fires triggerPolyNote with exact audio time
      for (const note of pairedNotes) {
        const wallDelay = (iterWallStart - performance.now()) + note.startT;
        const audioStart = iterAudioStart + note.startT / 1000;
        const timer = setTimeout(() => {
          if (!usePerformancePadStore.getState().isLooping) return;
          const midi = xToMidi(note.x);
          if (arpOnRef.current && target === "melody") {
            // Arp mode: just update the root — arp scheduler keeps producing notes
            arpRootRef.current = midi;
            if (!arpSchedulerRef.current?.isRunning) {
              arpSchedulerRef.current?.start({
                getRoot: () => arpRootRef.current,
                getSettings: () => ({
                  ...DEFAULT_ARP_SETTINGS,
                  mode: arpModeRef.current,
                  rate: arpRateRef.current,
                  octaves: arpOctavesRef.current,
                  gate: "medium",
                }),
                getScaleName: () => scaleNameRef.current,
                onNote: (noteMidi, d, atTime, vel) => {
                  melodyEngine.triggerPolyNote(noteMidi, atTime, d, vel, false);
                },
                getBpm: () => useDrumStore.getState().bpm,
                getLookahead: () => activeVoicesRef.current.size > 0 ? 0.1 : (arpLatchRef.current ? 1.0 : 0.1),
              });
            }
          } else {
            // Direct triggering with EXACT audio start + duration
            // Pass startTime so the audio engine schedules precisely, not
            // "whenever setTimeout decided to fire".
            const release = fireVoice(midi, note.velocity, note.y, {
              startTime: audioStart,
              duration: note.duration,
            });
            // Track for cleanup-on-stop. Release isn't usually called (engine
            // auto-releases at startTime + duration) but available if user
            // hits stop mid-note.
            playbackVoices.set(note.pointerId, { pointerId: note.pointerId, midi, startAt: performance.now(), velocity: note.velocity, releases: [release] });
            // Auto-evict from map after note's natural end
            const evictDelay = (note.duration * 1000) + 100;
            setTimeout(() => playbackVoices.delete(note.pointerId), evictDelay);
          }
        }, Math.max(0, wallDelay));
        timers.push(timer);
      }
      // Schedule "move" events for X/Y modulation during note playback
      for (const ev of sortedMoves) {
        const wallDelay = (iterWallStart - performance.now()) + ev.t;
        const timer = setTimeout(() => {
          if (!usePerformancePadStore.getState().isLooping) return;
          const v = playbackVoices.get(ev.pointerId);
          if (!v) return;
          if (arpOnRef.current && target === "melody") {
            arpRootRef.current = xToMidi(ev.x);
          } else {
            modulateVoice(ev.y);
            if (gridSnap) {
              const newMidi = xToMidi(ev.x);
              if (newMidi !== v.midi) repitchVoice(v, newMidi, ev.y);
            }
          }
        }, Math.max(0, wallDelay));
        timers.push(timer);
      }
    };

    scheduleIteration(iterationAudioStart, wallStart);

    // ── Audio-clock-anchored iteration rescheduler ────────────────────
    // setInterval drifts because it's driven by setTimeout / event-loop
    // jitter. Instead, each iteration's start time is computed by ADDING
    // exactly `dur/1000` to the previous iteration's audio time — so over
    // 100 loops we still land on the exact original phase. The setTimeout
    // delay is recomputed from the absolute target audio time each tick,
    // so even if a tick fires late it self-corrects on the next one.
    let nextIterAudioStart = iterationAudioStart + dur / 1000;
    let loopTickHandle: ReturnType<typeof setTimeout> | null = null;
    const tickLoop = () => {
      if (!usePerformancePadStore.getState().isLooping) return;
      const nowAudio = ctx.currentTime;
      // Schedule this iteration ~50ms before its audio start so wall-delay
      // computations inside scheduleIteration have positive lead-time.
      const leadSec = 0.05;
      if (nextIterAudioStart - nowAudio <= leadSec) {
        const iterWallStart = performance.now() + (nextIterAudioStart - nowAudio) * 1000;
        scheduleIteration(nextIterAudioStart, iterWallStart);
        nextIterAudioStart += dur / 1000;
      }
      // Re-tick at the next opportunity. Use the absolute target time so
      // we self-correct any setTimeout drift on every tick.
      const msToNextWindow = Math.max(20, (nextIterAudioStart - ctx.currentTime - leadSec) * 1000);
      loopTickHandle = setTimeout(tickLoop, msToNextWindow);
    };
    loopTickHandle = setTimeout(tickLoop, Math.max(20, (nextIterAudioStart - ctx.currentTime - 0.05) * 1000));

    return () => {
      timers.forEach(clearTimeout);
      if (loopTickHandle !== null) clearTimeout(loopTickHandle);
      // Release any voice whose audio is still active. Most notes will have
      // auto-released by their `duration`, but the cleanup catches the case
      // where the user hits STOP mid-note.
      for (const v of playbackVoices.values()) {
        v.releases.forEach((r) => r?.());
      }
      playbackVoices.clear();
      // Stop arp if it was started by loop playback
      if (arpSchedulerRef.current?.isRunning) {
        arpSchedulerRef.current.stop();
      }
    };
  }, [isLooping, events, loopDuration, xToMidi, fireVoice, modulateVoice, repitchVoice, gridSnap, target]);

  // ── Visual: chord/pitch grid + particle trail ──
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      // Guard against zero-sized canvas (pre-layout) — browsers render a
      // "broken image" placeholder icon if canvas dims are 0.
      if (rect.width < 2 || rect.height < 2) {
        rafIdRef.current = requestAnimationFrame(draw);
        return;
      }
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      // Hard upper bound — guards against pathological feedback loops.
      // 4096 covers 4K displays at 2x DPR with margin.
      const MAX_DIM = 4096;
      const targetW = Math.max(2, Math.min(MAX_DIM, Math.round(rect.width * dpr)));
      const targetH = Math.max(2, Math.min(MAX_DIM, Math.round(rect.height * dpr)));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const W = rect.width;
      const H = rect.height;

      const currentMode = modeRef.current;
      if (currentMode === "chords") {
        // ── Chord grid cells ──
        const cellW = W / chordSet.cols;
        const cellH = H / chordSet.rows;
        for (let row = 0; row < chordSet.rows; row++) {
          for (let col = 0; col < chordSet.cols; col++) {
            const idx = row * chordSet.cols + col;
            const chord = chordSet.cells[idx];
            if (!chord) continue;
            const x = col * cellW;
            const y = row * cellH;
            const hue = chord.hue ?? "#f472b6";

            // Check if any active pointer is in this cell
            const active = Array.from(activeVoicesRef.current.values()).some((v) => v.cellIndex === idx);

            // Cell fill — bright when active
            ctx.fillStyle = active ? `${hue}3a` : "rgba(255,255,255,0.02)";
            ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);

            // Active: inner gradient wash
            if (active) {
              const cellGrad = ctx.createRadialGradient(
                x + cellW / 2, y + cellH / 2, 0,
                x + cellW / 2, y + cellH / 2, Math.max(cellW, cellH) * 0.7
              );
              cellGrad.addColorStop(0, `${hue}55`);
              cellGrad.addColorStop(1, `${hue}00`);
              ctx.fillStyle = cellGrad;
              ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
            }

            // Border
            ctx.strokeStyle = active ? `${hue}ff` : `${hue}33`;
            ctx.lineWidth = active ? 2.5 : 1;
            if (active) {
              ctx.shadowColor = hue;
              ctx.shadowBlur = 22;
            }
            ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2);
            ctx.shadowBlur = 0;

            // Label
            ctx.fillStyle = active ? "#fff" : hue + "bb";
            const fontSize = Math.min(active ? 26 : 20, cellW / 5.5);
            ctx.font = `${active ? "bold " : ""}${fontSize}px ui-sans-serif, system-ui, -apple-system`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            if (active) {
              ctx.shadowColor = hue;
              ctx.shadowBlur = 12;
            }
            ctx.fillText(chord.label, x + cellW / 2, y + cellH / 2);
            ctx.shadowBlur = 0;
          }
        }
      } else if (currentMode === "grid") {
        // ── Scale-grid mode: fixed cells, polyphonic chord playing ──
        const scale = SCALES[scaleNameRef.current] ?? SCALES["Chromatic"] ?? [];
        const cols = Math.max(1, scale.length);
        const rows = Math.max(1, gridRowsRef.current);
        const cellW = W / cols;
        const cellH = H / rows;
        const baseMidi = rootNoteRef.current + scaleLowestOctRef.current * 12;

        // Collect all active grid-voice MIDI pitches for highlight
        const activeMidis = new Set<number>();
        for (const v of activeVoicesRef.current.values()) {
          activeMidis.add(v.midi);
        }

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const midi = baseMidi + (rows - 1 - row) * 12 + (scale[col] ?? 0);
            const isRoot = (scale[col] ?? 0) === 0;
            const isFifth = (scale[col] ?? 0) === 7;
            const isActive = activeMidis.has(midi);
            const cx = col * cellW;
            const cy = row * cellH;

            // Background
            const bgAlpha = isActive ? 0.55 : isRoot ? 0.32 : isFifth ? 0.18 : 0.10;
            ctx.fillStyle = isActive
              ? `rgba(244,114,182,${bgAlpha})`
              : isRoot
              ? `rgba(251,191,36,${bgAlpha})`
              : `rgba(167,139,250,${bgAlpha})`;
            ctx.fillRect(cx + 1, cy + 1, cellW - 2, cellH - 2);

            // Active: inner radial glow
            if (isActive) {
              const g = ctx.createRadialGradient(cx + cellW/2, cy + cellH/2, 0, cx + cellW/2, cy + cellH/2, Math.max(cellW, cellH) * 0.6);
              g.addColorStop(0, "rgba(255,200,240,0.35)");
              g.addColorStop(1, "rgba(244,114,182,0)");
              ctx.fillStyle = g;
              ctx.fillRect(cx + 1, cy + 1, cellW - 2, cellH - 2);
              ctx.shadowColor = "#f472b6";
              ctx.shadowBlur = 20;
            }

            // Border
            ctx.strokeStyle = isActive
              ? "rgba(244,114,182,1.0)"
              : isRoot
              ? "rgba(251,191,36,0.7)"
              : "rgba(167,139,250,0.38)";
            ctx.lineWidth = isActive ? 2 : 1;
            ctx.strokeRect(cx + 1, cy + 1, cellW - 2, cellH - 2);
            ctx.shadowBlur = 0;

            // Note label
            const noteName = (NOTE_NAMES_SHARP[midi % 12] ?? "?");
            const fontSize = Math.min(cellH * 0.38, cellW * 0.32, 22);
            ctx.font = `${isActive || isRoot ? "bold " : ""}${fontSize}px ui-sans-serif, system-ui, -apple-system`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = isActive ? "#fff" : isRoot ? "rgba(251,191,36,1.0)" : "rgba(210,195,255,0.85)";
            if (isActive) { ctx.shadowColor = "#f472b6"; ctx.shadowBlur = 10; }
            ctx.fillText(noteName, cx + cellW / 2, cy + cellH * 0.42);
            ctx.shadowBlur = 0;

            // Octave label (small, below note name)
            if (cellH > 40) {
              const octave = Math.floor(midi / 12) - 1;
              ctx.font = `${Math.max(10, fontSize * 0.5)}px ui-sans-serif, system-ui`;
              ctx.fillStyle = isActive ? "rgba(255,255,255,0.65)" : "rgba(180,160,240,0.55)";
              ctx.fillText(`${octave}`, cx + cellW / 2, cy + cellH * 0.68);
            }
          }
        }
      } else {
        // ── Pitch grid (notes mode) ──
        const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
        const cols = scale.length * scaleOctaves;

        // 1. Horizontal reference lines (cutoff/Y-axis quartiles) — very subtle
        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        ctx.lineWidth = 1;
        for (const frac of [0.25, 0.5, 0.75]) {
          const y = frac * H;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }

        // 2. Scale-degree lines — every interval inside an octave
        ctx.strokeStyle = "rgba(244, 114, 182, 0.18)";
        ctx.lineWidth = 1;
        for (let i = 1; i < cols; i++) {
          const x = (i / cols) * W;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }

        // 3. Fifth-of-scale highlight — half-octave reference for melodic intervals
        const fifthIdx = Math.min(scale.length - 1, Math.floor(scale.length * 0.5));
        if (fifthIdx > 0) {
          ctx.strokeStyle = "rgba(167, 139, 250, 0.22)"; // accent-chords violet
          ctx.lineWidth = 1;
          for (let o = 0; o < scaleOctaves; o++) {
            const x = ((o * scale.length + fifthIdx) / cols) * W;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
          }
        }

        // 4. Octave dividers — bright, with a soft glow so they really land
        ctx.strokeStyle = "rgba(244, 114, 182, 0.55)";
        ctx.lineWidth = 1.5;
        ctx.shadowColor = "rgba(244, 114, 182, 0.4)";
        ctx.shadowBlur = 6;
        for (let o = 1; o < scaleOctaves; o++) {
          const x = (o / scaleOctaves) * W;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }

      // ── Particle trail (hover + press) — dramatically enlarged ──
      const nowT = performance.now();
      if (trailEnabled && trailRef.current.length > 0) {
        const TRAIL_LIFETIME = 1600;
        trailRef.current = trailRef.current.filter((p) => nowT - p.t < TRAIL_LIFETIME);

        for (const p of trailRef.current) {
          const age = (nowT - p.t) / TRAIL_LIFETIME;
          const alpha = Math.pow(1 - age, 1.2);
          const radius = 18 + (1 - age) * 42;  // 18 → 60px — much bigger blobs
          const px = p.x * W;
          const py = p.y * H;
          const isActive = activeVoicesRef.current.has(p.pointerId);

          const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
          if (isActive) {
            // Active finger: warm white → magenta → violet
            grad.addColorStop(0,   `rgba(255, 240, 255, ${alpha * 0.95})`);
            grad.addColorStop(0.25, `rgba(255, 100, 220, ${alpha * 0.75})`);
            grad.addColorStop(0.6, `rgba(167, 100, 250, ${alpha * 0.45})`);
            grad.addColorStop(1,   "rgba(100, 50, 200, 0)");
          } else {
            // Hover / fading: cooler
            grad.addColorStop(0,   `rgba(200, 180, 255, ${alpha * 0.5})`);
            grad.addColorStop(0.5, `rgba(167, 100, 250, ${alpha * 0.25})`);
            grad.addColorStop(1,   "rgba(100, 50, 200, 0)");
          }
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ── Active voice press-indicator — big dramatic circle ──
      for (const voice of activeVoicesRef.current.values()) {
        const latest = [...trailRef.current].reverse().find((p) => p.pointerId === voice.pointerId);
        if (!latest) continue;
        const px = latest.x * W;
        const py = latest.y * H;

        const chordColor = currentMode === "chords" && voice.cellIndex !== undefined
          ? (chordSet.cells[voice.cellIndex]?.hue ?? "#f472b6")
          : "#f472b6";

        // Impact burst: very fast initial expansion (0→60ms) then settle
        const impactAge = Math.min(1, (nowT - voice.startAt) / 60);
        const impactBurst = 1 - Math.pow(1 - impactAge, 2);

        // Scale-in: full size at 150ms
        const pressAge = Math.min(1, (nowT - voice.startAt) / 150);
        const pressScale = 1 - Math.pow(1 - pressAge, 3);

        // Breathe: subtle ±8% pulse while held
        const breathe = 1 + 0.08 * Math.sin((nowT - voice.startAt) / 500 * Math.PI * 2);

        const R_FULL = 62;
        const R = R_FULL * pressScale * breathe;

        // BIG outer ambient glow (spreads far)
        const glowR = R + 80 + impactBurst * 60;
        const glowAlpha = 0.18 * (1 - impactBurst * 0.4);
        const bgGrad = ctx.createRadialGradient(px, py, 0, px, py, glowR);
        bgGrad.addColorStop(0,   chordColor + Math.floor(glowAlpha * 255).toString(16).padStart(2, "0"));
        bgGrad.addColorStop(1,   "rgba(0,0,0,0)");
        ctx.fillStyle = bgGrad;
        ctx.beginPath();
        ctx.arc(px, py, glowR, 0, Math.PI * 2);
        ctx.fill();

        // FAST impact ring (expands 0→220px in 300ms then fades)
        if (impactAge < 1) {
          const impactR = impactBurst * 200;
          const impactAlpha = (1 - impactAge) * 0.7;
          ctx.strokeStyle = chordColor + Math.floor(impactAlpha * 255).toString(16).padStart(2, "0");
          ctx.lineWidth = 3 - impactAge * 2;
          ctx.beginPath();
          ctx.arc(px, py, impactR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Three concentric ripples (staggered phase)
        for (let ripIdx = 0; ripIdx < 3; ripIdx++) {
          const rippleOffset = (ripIdx / 3);
          const ripplePhase = ((nowT - voice.startAt) / 1800 + rippleOffset) % 1;
          const rippleR = R + 8 + ripplePhase * 55;
          const rippleAlpha = (1 - ripplePhase) * 0.5;
          ctx.strokeStyle = chordColor + Math.floor(rippleAlpha * 255).toString(16).padStart(2, "0");
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px, py, rippleR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Solid filled disc with gradient
        const discGrad = ctx.createRadialGradient(px, py, 0, px, py, R);
        discGrad.addColorStop(0,   chordColor + "f0");
        discGrad.addColorStop(0.5, chordColor + "90");
        discGrad.addColorStop(1,   chordColor + "10");
        ctx.fillStyle = discGrad;
        ctx.shadowColor = chordColor;
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.arc(px, py, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // White ring
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px, py, R * 0.92, 0, Math.PI * 2);
        ctx.stroke();

        // Label
        const label = currentMode === "chords" && voice.cellIndex !== undefined
          ? (chordSet.cells[voice.cellIndex]?.label ?? midiToName(voice.midi))
          : midiToName(voice.midi);
        const labelFontSize = Math.min(28, Math.max(14, R * 0.55));
        ctx.font = `bold ${labelFontSize}px ui-sans-serif, system-ui, -apple-system`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "rgba(0,0,0,0.95)";
        ctx.shadowBlur = 8;
        ctx.fillText(label, px, py);
        ctx.shadowBlur = 0;
      }

      rafIdRef.current = requestAnimationFrame(draw);
    };
    rafIdRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  // gridRows / rootNote / scaleLowestOct are read via refs — no loop restart needed for those.
  }, [isOpen, scaleName, scaleOctaves, mode, chordSetIndex, trailEnabled]);

  if (!isOpen) return null;

  const activeYParam = Y_PARAMS.find((p) => p.id === yParam)!;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: "#0a080c" }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/80 px-5 py-2.5">
        <h2 className="text-[11px] font-bold tracking-[0.18em] text-[var(--ed-accent-melody)]">XY PERFORMANCE</h2>

        {/* Mode: Notes / Chords / Grid */}
        <div className="flex items-center gap-1">
          <span className="text-[8px] text-[var(--ed-text-muted)] mr-1">MODE</span>
          {(["notes", "chords", "grid"] as PadMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 h-6 text-[9px] font-bold rounded transition-all ${
                mode === m ? "bg-[var(--ed-accent-melody)]/30 text-[var(--ed-accent-melody)]" : "text-white/35 hover:text-white/60"
              }`}>
              {m === "notes" ? "NOTES" : m === "chords" ? "CHORDS" : "GRID"}
            </button>
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* Target */}
        <div className="flex items-center gap-1">
          <span className="text-[8px] text-[var(--ed-text-muted)] mr-1">TARGET</span>
          {(["melody", "bass"] as PadTarget[]).map((t) => (
            <button key={t} onClick={() => setTarget(t)}
              className={`px-2.5 h-6 text-[9px] font-bold rounded transition-all ${
                target === t ? "bg-[var(--ed-accent-melody)]/25 text-[var(--ed-accent-melody)]" : "text-white/35 hover:text-white/60"
              }`}>{t.toUpperCase()}</button>
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* Sound Preset picker — prev / dropdown / next */}
        <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-md px-1">
          <span className="text-[8px] text-[var(--ed-text-muted)] mr-1">SOUND</span>
          <button onClick={handlePrevPreset}
            className="w-5 h-5 text-[10px] text-white/40 hover:text-white/80 transition-colors"
            title="Previous preset"
          >‹</button>
          <select
            value={activePresetIndex}
            onChange={(e) => handleLoadPreset(Number(e.target.value))}
            className="h-6 px-1.5 text-[9px] font-bold bg-transparent text-[var(--ed-accent-melody)]/85 hover:text-[var(--ed-accent-melody)] cursor-pointer outline-none border-0 max-w-[130px]"
            title={`${currentPresetName} (${activePresetIndex + 1}/${totalPresets})`}
          >
            {(target === "melody" ? MELODY_PRESETS : BASS_PRESETS).map((preset, idx) => (
              <option key={idx} value={idx} className="bg-[var(--ed-bg-secondary)] text-white">
                {preset.name}
              </option>
            ))}
          </select>
          <button onClick={handleNextPreset}
            className="w-5 h-5 text-[10px] text-white/40 hover:text-white/80 transition-colors"
            title="Next preset"
          >›</button>
        </div>

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* Y Param — grouped: SYNTH params + FX params (spring-back) */}
        <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-md px-1.5 py-0.5">
          <span className="text-[8px] text-[var(--ed-text-muted)] mr-1">Y AXIS</span>
          {/* Synth group */}
          {Y_PARAMS.filter((p) => p.group === "synth").map((p) => (
            <button key={p.id} onClick={() => setYParam(p.id)}
              className={`px-2 h-5 text-[8px] font-bold rounded transition-all ${
                yParam === p.id
                  ? "bg-[var(--ed-accent-melody)]/30 text-[var(--ed-accent-melody)]"
                  : "text-white/30 hover:text-white/60"
              }`}>{p.label}</button>
          ))}
          <span className="w-px h-3 bg-white/15 mx-1" />
          {/* FX group — spring-back indicator */}
          {Y_PARAMS.filter((p) => p.group === "fx").map((p) => (
            <button key={p.id} onClick={() => setYParam(p.id)}
              title={`${p.label} — springs back when you lift`}
              className={`px-2 h-5 text-[8px] font-bold rounded transition-all ${
                yParam === p.id
                  ? "bg-orange-500/30 text-orange-300"
                  : "text-orange-400/40 hover:text-orange-300/70"
              }`}>{p.label} ⟲</button>
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* Range — only in notes mode */}
        {mode === "notes" && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-[var(--ed-text-muted)] mr-1">OCT</span>
              <button onClick={() => setScaleLowestOct(scaleLowestOct - 1)} className="w-5 h-5 text-[10px] text-white/50 hover:text-white/90 rounded bg-white/5">−</button>
              <span className="text-[8px] text-white/70 font-mono w-4 text-center">{scaleLowestOct >= 0 ? "+" : ""}{scaleLowestOct}</span>
              <button onClick={() => setScaleLowestOct(scaleLowestOct + 1)} className="w-5 h-5 text-[10px] text-white/50 hover:text-white/90 rounded bg-white/5">+</button>
              <span className="text-[8px] text-[var(--ed-text-muted)] mx-1">SPAN</span>
              {[1, 2, 3, 4].map((n) => (
                <button key={n} onClick={() => setScaleOctaves(n)}
                  className={`w-5 h-5 text-[9px] font-bold rounded ${
                    scaleOctaves === n ? "bg-white/15 text-white/90" : "text-white/30 hover:text-white/60"
                  }`}>{n}</button>
              ))}
            </div>
            <div className="mx-1 h-4 w-px bg-white/10" />
          </>
        )}

        {/* Snap toggle — only in notes mode */}
        {mode === "notes" && (
          <>
            <button onClick={() => setGridSnap(!gridSnap)}
              className={`px-2 h-6 text-[8px] font-bold rounded transition-all ${
                gridSnap ? "bg-[var(--ed-accent-blue)]/20 text-[var(--ed-accent-blue)]" : "text-white/35 hover:text-white/60"
              }`}
              title="Snap X-position to scale notes"
            >SNAP</button>
            <div className="mx-1 h-4 w-px bg-white/10" />
          </>
        )}

        {/* Grid rows — only in grid mode */}
        {mode === "grid" && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-[var(--ed-text-muted)] mr-1">OCT</span>
              <button onClick={() => setScaleLowestOct(scaleLowestOct - 1)} className="w-5 h-5 text-[10px] text-white/50 hover:text-white/90 rounded bg-white/5">−</button>
              <span className="text-[8px] text-white/70 font-mono w-4 text-center">{scaleLowestOct >= 0 ? "+" : ""}{scaleLowestOct}</span>
              <button onClick={() => setScaleLowestOct(scaleLowestOct + 1)} className="w-5 h-5 text-[10px] text-white/50 hover:text-white/90 rounded bg-white/5">+</button>
              <span className="text-[8px] text-[var(--ed-text-muted)] mx-1">ROWS</span>
              {[1, 2, 3, 4].map((n) => (
                <button key={n} onClick={() => setGridRows(n)}
                  className={`w-5 h-5 text-[9px] font-bold rounded ${
                    gridRows === n ? "bg-white/15 text-white/90" : "text-white/30 hover:text-white/60"
                  }`}>{n}</button>
              ))}
            </div>
            <div className="mx-1 h-4 w-px bg-white/10" />
          </>
        )}

        {/* Chord-Set picker — only in chord mode */}
        {mode === "chords" && (
          <>
            <div className="flex items-center gap-1 bg-white/[0.04] rounded-md px-1">
              <span className="text-[8px] text-[var(--ed-text-muted)] mr-1">SET</span>
              <select
                value={chordSetIndex}
                onChange={(e) => setChordSetIndex(Number(e.target.value))}
                className="h-6 px-1.5 text-[9px] font-bold bg-transparent text-[var(--ed-accent-melody)]/85 hover:text-[var(--ed-accent-melody)] cursor-pointer outline-none border-0 max-w-[130px]"
              >
                {CHORD_SETS.map((s, idx) => (
                  <option key={idx} value={idx} className="bg-[var(--ed-bg-secondary)] text-white">{s.name}</option>
                ))}
              </select>
            </div>
            <div className="mx-1 h-4 w-px bg-white/10" />
          </>
        )}

        {/* Chord-Follow toggle — shown only in chord mode */}
        {mode === "chords" && (
          <>
            <button onClick={() => setChordFollow(!chordFollow)}
              className={`px-2 h-6 text-[8px] font-bold rounded transition-all ${
                chordFollow
                  ? "bg-[var(--ed-accent-bass)]/25 text-[var(--ed-accent-bass)]"
                  : "text-white/35 hover:text-white/60"
              }`}
              title="Bass + Melody transpose live to the chord root (e.g. bass in Cm plays Fm when you hit an F-minor chord)"
            >🎯 FOLLOW</button>
            <div className="mx-1 h-4 w-px bg-white/10" />
          </>
        )}

        {/* ── Space FX ── Shimmer + Freeze (melody target only) ── */}
        {target === "melody" && (
          <div className="flex items-center gap-1 bg-white/[0.03] rounded-md px-1.5 py-0.5">
            <span className="text-[8px] text-white/20 mr-1 tracking-wider">SPACE</span>
            {/* SHIMMER toggle */}
            <button
              onClick={() => {
                const next = !shimmerOn;
                setShimmerOn(next);
                const chain = getMelodyEngineFxChain();
                if (chain) {
                  if (next) chain.enableShimmer(shimmerDepth, shimmerFeedback);
                  else chain.disableShimmer();
                }
              }}
              className={`px-2 h-5 text-[8px] font-bold rounded transition-all ${
                shimmerOn
                  ? "bg-indigo-500/30 text-indigo-200"
                  : "text-white/30 hover:text-white/60"
              }`}
              style={{ boxShadow: shimmerOn ? "0 0 8px rgba(129,140,248,0.4)" : "none" }}
              title="Shimmer reverb — bright feedback tail"
            >✦ SHIMM</button>

            {/* SHIMMER depth inline mini-slider */}
            {shimmerOn && (
              <input
                type="range" min={0} max={1} step={0.01}
                value={shimmerDepth}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setShimmerDepth(v);
                  getMelodyEngineFxChain()?.setShimmerDepth(v);
                }}
                className="w-14 h-1 accent-indigo-400 cursor-pointer"
                title={`Shimmer depth: ${Math.round(shimmerDepth * 100)}%`}
              />
            )}
            {shimmerOn && (
              <input
                type="range" min={0} max={1} step={0.01}
                value={shimmerFeedback}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setShimmerFeedback(v);
                  getMelodyEngineFxChain()?.setShimmerFeedback(v);
                }}
                className="w-14 h-1 accent-violet-400 cursor-pointer"
                title={`Shimmer feedback: ${Math.round(shimmerFeedback * 100)}%`}
              />
            )}

            <div className="w-px h-3 bg-white/10 mx-0.5" />

            {/* FREEZE hold button */}
            <button
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                getMelodyEngineFxChain()?.activateFreeze();
              }}
              onPointerUp={() => getMelodyEngineFxChain()?.deactivateFreeze()}
              onPointerLeave={() => getMelodyEngineFxChain()?.deactivateFreeze()}
              className="px-2 h-5 text-[8px] font-bold rounded border border-cyan-500/20 text-cyan-400/50 hover:text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-500/10 active:bg-cyan-500/25 active:text-cyan-100 transition-all select-none"
              title="Freeze — hold to sustain audio as infinite drone"
            >❄ FREEZE</button>
          </div>
        )}

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* Trail toggle */}
        <button onClick={() => setTrailEnabled(!trailEnabled)}
          className={`px-2 h-6 text-[8px] font-bold rounded transition-all ${
            trailEnabled ? "bg-purple-500/20 text-purple-300" : "text-white/35 hover:text-white/60"
          }`}
          title="Particle trail behind cursor"
        >✨ TRAIL</button>

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* Loop length selector (auto / 1 / 2 / 4 / 8 bars) */}
        {!isRecording && !isArmed && (
          <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-md px-1">
            <span className="text-[8px] text-[var(--ed-text-muted)] mr-1">BARS</span>
            {([0, 1, 2, 4, 8] as const).map((n) => (
              <button key={n} onClick={() => setLoopBars(n)}
                className={`px-1.5 h-5 text-[9px] font-bold rounded ${
                  loopBars === n ? "bg-white/15 text-white/90" : "text-white/30 hover:text-white/60"
                }`}
                title={n === 0 ? "Auto (measured duration)" : `${n} bar${n > 1 ? "s" : ""} at current BPM`}
              >{n === 0 ? "AUTO" : n}</button>
            ))}
          </div>
        )}

        {/* Quantize selector */}
        {!isRecording && !isArmed && (
          <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-md px-1">
            <span className="text-[8px] text-[var(--ed-text-muted)] mr-1">Q</span>
            {(["off", "1/4", "1/8", "1/16", "1/32"] as const).map((q) => (
              <button key={q} onClick={() => setQuantize(q)}
                className={`px-1 h-5 text-[8px] font-bold rounded ${
                  quantize === q
                    ? "bg-[var(--ed-accent-blue)]/25 text-[var(--ed-accent-blue)]"
                    : "text-white/30 hover:text-white/60"
                }`}
                title={q === "off" ? "No quantize" : `Snap event timings to ${q} grid`}
              >{q === "off" ? "—" : q}</button>
            ))}
          </div>
        )}

        {/* Recording controls */}
        {!isRecording && !isArmed && !isStepRecording ? (
          <>
            <button onClick={armRecording}
              className="px-3 h-6 text-[9px] font-bold rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-all"
              title="Live recording — starts on first note you play"
            >● REC</button>
            <button onClick={() => startStepRecording(bpm)}
              className="px-3 h-6 text-[9px] font-bold rounded bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 transition-all"
              title="Step recording — each tap places a note at the current step (Q-grid), then auto-advances"
            >⏵ STEP</button>
          </>
        ) : isArmed ? (
          <button onClick={() => stopRecording(bpm)}
            className="px-3 h-6 text-[9px] font-bold rounded bg-yellow-500/25 text-yellow-300 animate-pulse transition-all"
            title="Waiting for first note — click to cancel"
          >◉ ARMED</button>
        ) : isStepRecording ? (
          <>
            <button onClick={() => stopRecording(bpm)}
              className="px-3 h-6 text-[9px] font-bold rounded bg-blue-500/40 text-blue-100 animate-pulse transition-all"
              title={`Step recording — cursor at ${(stepCursorMs / 1000).toFixed(2)}s`}
            >■ STOP STEP</button>
            <button onClick={() => skipStep(bpm)}
              className="px-2 h-6 text-[9px] font-bold rounded bg-white/10 text-white/70 hover:bg-white/20 transition-all"
              title="Advance cursor without placing a note (rest)"
            >↷ SKIP</button>
            <button onClick={() => undoLastStep(bpm)}
              disabled={events.length === 0}
              className="px-2 h-6 text-[9px] font-bold rounded bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Remove last placed note and rewind cursor one step"
            >↶ UNDO</button>
            <span className="text-[8px] text-blue-300/70 font-mono">
              {(stepCursorMs / 1000).toFixed(2)}s / {(loopDuration / 1000).toFixed(1)}s
            </span>
          </>
        ) : (
          <button onClick={() => stopRecording(bpm)}
            className="px-3 h-6 text-[9px] font-bold rounded bg-red-500/40 text-red-100 animate-pulse transition-all"
          >■ STOP</button>
        )}

        {events.length > 0 && !isRecording && !isArmed && (
          <>
            {!isLooping ? (
              <button onClick={startLoop}
                className="px-3 h-6 text-[9px] font-bold rounded bg-green-500/15 text-green-400 hover:bg-green-500/25"
              >▶ LOOP</button>
            ) : (
              <button onClick={stopLoop}
                className="px-3 h-6 text-[9px] font-bold rounded bg-green-500/35 text-green-200 animate-pulse"
              >■ STOP LOOP</button>
            )}
            <button onClick={exportToPianoRoll}
              className="px-3 h-6 text-[9px] font-bold rounded bg-[var(--ed-accent-melody)]/15 text-[var(--ed-accent-melody)] hover:bg-[var(--ed-accent-melody)]/25"
              title="Konvertiert Aufnahme in MIDI-Noten und importiert in Piano Roll"
            >→ PIANO ROLL</button>
            <button onClick={clearRecording}
              className="px-2 h-6 text-[8px] font-bold rounded bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70"
            >CLR</button>
            <span className="text-[8px] text-[var(--ed-text-muted)] font-mono">
              {events.length} ev · {(loopDuration / 1000).toFixed(1)}s
              {loopBars > 0 && <span className="text-[var(--ed-accent-blue)]/70"> · {loopBars}bar</span>}
              {quantize !== "off" && <span className="text-[var(--ed-accent-blue)]/70"> · Q={quantize}</span>}
            </span>
          </>
        )}

        <button onClick={onClose}
          className="ml-auto w-7 h-7 text-[12px] text-white/40 hover:text-white/80 hover:bg-white/10 rounded transition-all"
        >✕</button>
      </div>

      {/* XY Pad */}
      <div className="flex-1 flex items-stretch justify-stretch p-6 gap-4 min-h-0" style={{ background: "#0a080c" }}>
        {/* Y-axis label strip */}
        <div className="flex flex-col justify-between w-8 text-[8px] text-[var(--ed-text-muted)] font-mono text-right pr-1">
          <span>{activeYParam.label} MAX</span>
          <span className="text-[var(--ed-accent-melody)]/70">{activeYParam.label}</span>
          <span>{activeYParam.label} MIN</span>
        </div>

        <div
          ref={padRef}
          className="relative flex-1 rounded-lg border border-[var(--ed-accent-melody)]/25 overflow-hidden cursor-crosshair select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            touchAction: "none",
            // Hard-coded dark fallback BG guarantees contrast even if CSS vars
            // fail to resolve (e.g. early paint, theme not hydrated).
            backgroundColor: "#0d0a0f",
            // Atmospheric radial accent glow layered on top.
            backgroundImage:
              "radial-gradient(circle at 50% 50%, rgba(244,114,182,0.06) 0%, transparent 70%)",
          }}
        >
          {/*
            Pin the canvas DOM size to its parent. Without explicit CSS width/height,
            setting canvas.width = rect.width * dpr in the draw loop makes the
            intrinsic size become the layout size, which then feeds back into the
            next read of rect.width — runaway growth (we hit 2^25 px on Retina).
            CSS width:100%/height:100% breaks that loop.
          */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 pointer-events-none"
            style={{ width: "100%", height: "100%" }}
          />

          {/* Static X-axis ruler — only in notes mode */}
          {mode === "notes" && (
            <div className="absolute inset-x-0 bottom-0 h-6 flex items-stretch border-t border-white/5 pointer-events-none">
              {Array.from({ length: scaleOctaves }, (_, i) => (
                <div key={i} className="flex-1 flex items-center justify-center text-[9px] font-mono text-white/35 border-r border-white/5 last:border-0">
                  Oct {scaleLowestOct + i}
                </div>
              ))}
            </div>
          )}

          {/* Hint / Status bar */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] text-white/25 tracking-wider pointer-events-none font-light">
            {isArmed
              ? <span className="text-yellow-400 animate-pulse font-bold tracking-[0.3em]">● ARMED — PRESS ANY KEY TO START RECORDING</span>
              : isRecording
                ? <span className="text-red-400 font-bold tracking-[0.3em]">● RECORDING</span>
                : isStepRecording
                  ? <span className="text-blue-300 font-bold tracking-[0.3em]">⏵ STEP MODE — each tap advances one {quantize === "off" ? "1/16" : quantize} step</span>
                  : mode === "chords"
                    ? `${chordSet.name} · ${chordSet.cells.length} CHORDS · HOLD TO EDIT`
                    : "TOUCH · HOLD · MOVE — MULTI-TOUCH"}
          </div>

          {/* Key/Scale indicator — top-right corner */}
          {mode === "notes" && (
            <div className="absolute top-3 right-4 text-[10px] text-white/45 font-mono pointer-events-none tracking-wide">
              <span className="text-[var(--ed-accent-melody)]/70 font-bold">{midiToName(rootNote).replace(/\d+$/, "")}</span>
              <span className="mx-1 text-white/20">·</span>
              <span>{gridSnap ? scaleName : "CHROMATIC"}</span>
            </div>
          )}

          {/* ── Chord Editor Modal ─────────────────────────────────────────── */}
          {editTarget !== null && (() => {
            const factoryCell = CHORD_SETS[editTarget.setIdx]?.cells[editTarget.cellIdx];

            // Piano layout data
            const WHITE_KEYS = [
              { semi: 0, name: "C" }, { semi: 2, name: "D" }, { semi: 4, name: "E" },
              { semi: 5, name: "F" }, { semi: 7, name: "G" }, { semi: 9, name: "A" },
              { semi: 11, name: "B" },
            ];
            // leftPct = left edge as % of total keyboard width (7 white keys)
            const WW = 100 / 7; // one white key width in %
            const BLACK_KEYS = [
              { semi: 1,  name: "C#", leftPct: 0.65 * WW },
              { semi: 3,  name: "D#", leftPct: 1.65 * WW },
              { semi: 6,  name: "F#", leftPct: 3.65 * WW },
              { semi: 8,  name: "G#", leftPct: 4.65 * WW },
              { semi: 10, name: "A#", leftPct: 5.65 * WW },
            ];
            const INTERVAL_NAMES = [
              "Root", "m2", "M2", "m3", "M3", "P4", "d5", "P5", "m6", "M6", "m7", "M7",
            ];

            // Quick-select chord presets
            const QUICK_PRESETS = [
              { label: "Maj",  intervals: [0, 4, 7] },
              { label: "Min",  intervals: [0, 3, 7] },
              { label: "7",    intervals: [0, 4, 7, 10] },
              { label: "Maj7", intervals: [0, 4, 7, 11] },
              { label: "Min7", intervals: [0, 3, 7, 10] },
              { label: "Sus2", intervals: [0, 2, 7] },
              { label: "Sus4", intervals: [0, 5, 7] },
              { label: "Dim",  intervals: [0, 3, 6] },
              { label: "Aug",  intervals: [0, 4, 8] },
              { label: "6th",  intervals: [0, 4, 7, 9] },
            ];

            // Live preview: play the current chord through ChordsEngine
            const previewChord = (bools: boolean[]) => {
              const ctx = audioEngine.getAudioContext();
              if (!ctx || !chordsEngine.isInitialized) return;
              const ROOT_MIDI = 60; // C4
              const notes = bools.reduce<number[]>((acc, on, i) => {
                if (on || i === 0) acc.push(ROOT_MIDI + i);
                return acc;
              }, []);
              chordsEngine.triggerChord(notes, ctx.currentTime, false, false, 0.75);
              setTimeout(() => chordsEngine.releaseChord(ctx.currentTime), 700);
            };

            const applyQuickPreset = (intervals: number[]) => {
              const bools = Array(12).fill(false) as boolean[];
              intervals.forEach((iv) => { if (iv >= 0 && iv < 12) bools[iv] = true; });
              setEditIntervals(bools);
              previewChord(bools);
            };

            const toggleSemitone = (i: number) => {
              if (i === 0) return;
              setEditIntervals((prev) => {
                const next = [...prev] as boolean[];
                next[i] = !next[i];
                previewChord(next);
                return next;
              });
            };

            return (
              <div
                className="absolute inset-0 flex items-center justify-center z-50"
                style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div
                  className="rounded-2xl border border-[var(--ed-accent-melody)]/25 p-4 w-80 flex flex-col gap-3"
                  style={{ background: "#120a10", boxShadow: "0 0 40px rgba(244,114,182,0.20)" }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[9px] font-black tracking-[0.2em] text-[var(--ed-accent-melody)]/60 uppercase">Edit Chord</div>
                      <div className="text-[13px] font-black text-white/90 mt-0.5">{editLabel || "—"}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {factoryCell && (
                        <button
                          className="px-2 h-6 text-[8px] font-bold rounded border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 transition-colors"
                          onClick={() => {
                            resetChordCell(editTarget.setIdx, editTarget.cellIdx);
                            const bools = Array(12).fill(false) as boolean[];
                            factoryCell.intervals.forEach((iv) => { if (iv >= 0 && iv < 12) bools[iv] = true; });
                            setEditIntervals(bools);
                            setEditLabel(factoryCell.label);
                          }}
                        >RESET</button>
                      )}
                      <button
                        className="w-6 h-6 text-[11px] rounded border border-white/10 text-white/40 hover:text-white hover:border-white/20 transition-colors flex items-center justify-center"
                        onClick={() => setEditTarget(null)}
                      >✕</button>
                    </div>
                  </div>

                  {/* Quick chord presets */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[8px] text-white/30 uppercase tracking-widest">Quick Select</span>
                    <div className="flex flex-wrap gap-1">
                      {QUICK_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          onClick={() => { applyQuickPreset(p.intervals); setEditLabel(p.label); }}
                          className="px-2 h-6 rounded text-[9px] font-bold border border-[var(--ed-accent-melody)]/20 text-[var(--ed-accent-melody)]/60 hover:bg-[var(--ed-accent-melody)]/15 hover:text-[var(--ed-accent-melody)] transition-all"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Piano keyboard */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[8px] text-white/30 uppercase tracking-widest">Intervals — tap to toggle · ♪ plays preview</span>
                    <div className="relative w-full" style={{ height: "72px" }}>
                      {/* White keys */}
                      {WHITE_KEYS.map((key, idx) => {
                        const active = editIntervals[key.semi] ?? false;
                        const isRoot = key.semi === 0;
                        return (
                          <button
                            key={key.semi}
                            onClick={() => toggleSemitone(key.semi)}
                            title={`${key.name} — ${INTERVAL_NAMES[key.semi]}`}
                            style={{
                              position: "absolute",
                              left: `${idx * WW}%`,
                              width: `${WW - 0.5}%`,
                              top: 0,
                              bottom: 0,
                              zIndex: 1,
                            }}
                            className={`rounded-b-md flex flex-col items-center justify-end pb-1 transition-all select-none border-t border-l border-r ${
                              isRoot
                                ? "bg-[var(--ed-accent-melody)] border-[var(--ed-accent-melody)] cursor-default"
                                : active
                                  ? "bg-[var(--ed-accent-melody)]/60 border-[var(--ed-accent-melody)]/60"
                                  : "bg-white/85 border-white/20 hover:bg-white text-black"
                            }`}
                          >
                            <span className={`text-[7px] font-bold leading-none ${isRoot || active ? "text-white" : "text-black/60"}`}>
                              {key.name}
                            </span>
                            <span className={`text-[6px] leading-none mt-0.5 ${isRoot || active ? "text-white/70" : "text-black/35"}`}>
                              {INTERVAL_NAMES[key.semi]}
                            </span>
                          </button>
                        );
                      })}
                      {/* Black keys */}
                      {BLACK_KEYS.map((key) => {
                        const active = editIntervals[key.semi] ?? false;
                        return (
                          <button
                            key={key.semi}
                            onClick={() => toggleSemitone(key.semi)}
                            title={`${key.name} — ${INTERVAL_NAMES[key.semi]}`}
                            style={{
                              position: "absolute",
                              left: `${key.leftPct}%`,
                              width: `${WW * 0.62}%`,
                              top: 0,
                              height: "58%",
                              zIndex: 2,
                            }}
                            className={`rounded-b-md flex flex-col items-center justify-end pb-0.5 transition-all select-none ${
                              active
                                ? "bg-[var(--ed-accent-melody)] shadow-[0_0_8px_var(--ed-accent-melody)]"
                                : "bg-[#1a0a14] hover:bg-[#2e1224] border border-white/10"
                            }`}
                          >
                            <span className={`text-[5.5px] font-bold leading-none ${active ? "text-white" : "text-white/50"}`}>
                              {key.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Label + Save row */}
                  <div className="flex gap-2 items-end">
                    <div className="flex flex-col gap-1 flex-1">
                      <span className="text-[8px] text-white/30 uppercase tracking-widest">Label</span>
                      <input
                        type="text"
                        maxLength={6}
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value.slice(0, 6))}
                        className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-[11px] font-mono outline-none focus:border-[var(--ed-accent-melody)]/50"
                        placeholder="Am7"
                      />
                    </div>
                    <button
                      className="h-8 px-4 rounded-lg font-black text-[10px] tracking-widest transition-all bg-[var(--ed-accent-melody)]/30 text-[var(--ed-accent-melody)] hover:bg-[var(--ed-accent-melody)]/50 border border-[var(--ed-accent-melody)]/30"
                      onClick={() => {
                        const intervals: number[] = [];
                        editIntervals.forEach((on, i) => { if (on || i === 0) intervals.push(i); });
                        setChordIntervals(editTarget.setIdx, editTarget.cellIdx, intervals, editLabel || "?");
                        setEditTarget(null);
                      }}
                    >
                      SAVE
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Volume slider */}
        <div className="flex flex-col items-center gap-1 w-10">
          <span className="text-[7px] text-white/30 font-mono tracking-wider">VOL</span>
          <div className="flex-1 flex items-center justify-center w-full">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={padVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                _padVolumeByTarget[target] = v;
                setPadVolume(v);
                if (target === "melody") melodyEngine.sweepLiveVolume(v / 100);
                else bassEngine.sweepLiveVolume(v / 100);
              }}
              className="cursor-pointer accent-orange-400"
              style={{ writingMode: "vertical-lr" as const, direction: "rtl" as const, width: "100%", height: "100%" }}
              title={`Volume: ${padVolume}%`}
            />
          </div>
          <span className="text-[7px] text-orange-400/80 font-mono">{padVolume}%</span>
        </div>
      </div>

      {/* Arp bar — melody target only */}
      {target === "melody" && (
        <div
          className="flex items-center gap-2 px-5 py-2 border-t border-white/[0.06] flex-shrink-0"
          style={{ background: "#0a080c" }}
        >
          {/* ARP ON/OFF */}
          <button
            onClick={handleArpToggle}
            className={`px-3 h-6 text-[9px] font-bold rounded transition-all ${
              arpOn
                ? "bg-orange-500/30 text-orange-300"
                : "bg-white/5 text-white/30 hover:text-white/60"
            }`}
            style={{ boxShadow: arpOn ? "0 0 8px rgba(249,115,22,0.25)" : "none" }}
          >
            ARP {arpOn ? "●" : "○"}
          </button>

          <div className="w-px h-4 bg-white/10" />

          {/* Mode */}
          <div className="flex items-center gap-0.5">
            <span className="text-[7px] text-white/20 mr-1 tracking-wider">MODE</span>
            {(
              [
                ["up",       "↑ UP"],
                ["down",     "↓ DN"],
                ["updown",   "↕ UD"],
                ["downup",   "↓↑ DU"],
                ["converge", "→← CV"],
                ["diverge",  "←→ DV"],
                ["random",   "? RND"],
                ["chord",    "≡ CHD"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setArpMode(m)}
                className={`px-2 h-5 text-[8px] font-bold rounded transition-all ${
                  arpMode === m
                    ? "bg-orange-500/25 text-orange-300"
                    : "text-white/25 hover:text-white/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-white/10" />

          {/* Rate */}
          <div className="flex items-center gap-0.5">
            <span className="text-[7px] text-white/20 mr-1 tracking-wider">RATE</span>
            {(["1/4", "1/8", "1/16"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setArpRate(r)}
                className={`px-2 h-5 text-[8px] font-bold rounded transition-all ${
                  arpRate === r
                    ? "bg-orange-500/25 text-orange-300"
                    : "text-white/25 hover:text-white/60"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-white/10" />

          {/* Octave */}
          <div className="flex items-center gap-0.5">
            <span className="text-[7px] text-white/20 mr-1 tracking-wider">OCT</span>
            {([1, 2] as const).map((o) => (
              <button
                key={o}
                onClick={() => setArpOctaves(o)}
                className={`px-2 h-5 text-[8px] font-bold rounded transition-all ${
                  arpOctaves === o
                    ? "bg-orange-500/25 text-orange-300"
                    : "text-white/25 hover:text-white/60"
                }`}
              >
                {o}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-white/10" />

          {/* Latch */}
          <button
            onClick={() => setArpLatch((v) => !v)}
            className={`px-3 h-6 text-[9px] font-bold rounded transition-all ${
              arpLatch
                ? "bg-orange-500/20 text-orange-400"
                : "bg-white/5 text-white/30 hover:text-white/60"
            }`}
            title="LATCH: arp keeps running after finger lift"
          >
            LATCH
          </button>
        </div>
      )}
    </div>
  );
}
