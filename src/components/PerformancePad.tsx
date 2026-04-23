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

import { useEffect, useRef, useCallback } from "react";
import { usePerformancePadStore, CHORD_SETS, type YAxisParam, type PadTarget, type PadMode } from "../store/performancePadStore";
import { useMelodyStore, MELODY_PRESETS } from "../store/melodyStore";
import { useBassStore, BASS_PRESETS } from "../store/bassStore";
import { useDrumStore } from "../store/drumStore";
import { melodyEngine } from "../audio/MelodyEngine";
import { bassEngine, SCALES } from "../audio/BassEngine";
import { audioEngine } from "../audio/AudioEngine";
import { sendFxManager } from "../audio/SendFx";

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

export function PerformancePad({ isOpen, onClose }: Props) {
  const {
    target, mode, chordSetIndex, yParam, scaleOctaves, scaleLowestOct, gridSnap, trailEnabled, chordFollow,
    events, isArmed, isRecording, isStepRecording, stepCursorMs, isLooping, loopDuration, loopBars, quantize,
    setTarget, setMode, setChordSetIndex, setYParam, setScaleOctaves, setScaleLowestOct, setGridSnap, setTrailEnabled, setChordFollow,
    armRecording, startStepRecording, stopRecording, clearRecording, appendEvent, setLoopBars, setQuantize,
    startLoop, stopLoop,
  } = usePerformancePadStore();

  const setBassLiveTranspose = useBassStore((s) => s.setLiveTransposeOffset);
  const setMelodyLiveTranspose = useMelodyStore((s) => s.setLiveTransposeOffset);

  const chordSet = CHORD_SETS[chordSetIndex] ?? CHORD_SETS[0]!;

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
  const fireVoice = useCallback((midi: number, velocity: number, y: number): (() => void) | null => {
    const ctx = audioEngine.getAudioContext();
    if (!ctx) return null;
    const startTime = ctx.currentTime + 0.001;
    // Long pseudo-sustain — actual release is triggered by pointer-up via release handle
    const duration = 30.0;

    // Apply Y modulation to engine params BEFORE trigger
    const paramValue = yToParam(y);
    if (target === "melody") {
      melodyEngine.setParams({ [yParam]: paramValue });
      return melodyEngine.triggerPolyNote(midi, startTime, duration, velocity, false);
    } else {
      bassEngine.setParams({ [yParam]: paramValue });
      bassEngine.triggerNote(midi, startTime, false, false, false, velocity);
      // Bass engine is mono — release function just calls releaseNote
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
        // Fire with strum delay using direct engine calls
        const r = (target === "melody")
          ? melodyEngine.triggerPolyNote(noteMidi, startTime, 30.0, noteVel, false)
          : (() => {
              bassEngine.triggerNote(noteMidi, startTime, false, false, false, noteVel);
              return () => bassEngine.releaseNote(ctx?.currentTime ?? 0);
            })();
        void yCell; // used in Y modulation callback
        releases.push(r);
      });
      voice = { pointerId: e.pointerId, midi: rootMidi, startAt: performance.now(), velocity, releases, cellIndex: cellIdx };
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

    const voice = activeVoicesRef.current.get(e.pointerId);
    if (!voice) return;  // Hover-only mode: just show trail, no audio modulation
    e.preventDefault();

    if (mode === "chords") {
      // In chord mode: Y axis still modulates params for expressiveness,
      // but no re-pitch (chord is locked until pointer-up)
      modulateVoice(y);
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
    // Spring-back: restore FX levels when ALL fingers are lifted
    if (activeVoicesRef.current.size === 0 && fxSnapshotRef.current) {
      const snap = fxSnapshotRef.current;
      fxSnapshotRef.current = null;
      // Smooth fade back over 400ms (not jarring)
      const ctx = audioEngine.getAudioContext();
      const fadeMs = 400;
      if (yParam === "reverb") {
        // Use ramp via a small setTimeout loop — sendFxManager doesn't expose AudioParam directly
        const startLevel = sendFxManager.getReverbLevel();
        const endLevel = snap.reverb;
        const steps = 20;
        for (let i = 1; i <= steps; i++) {
          setTimeout(() => {
            const t = i / steps;
            sendFxManager.setReverbLevel(startLevel + (endLevel - startLevel) * t);
          }, (fadeMs / steps) * i);
        }
      } else if (yParam === "delay") {
        const startLevel = sendFxManager.getDelayLevel();
        const endLevel = snap.delay;
        const steps = 20;
        for (let i = 1; i <= steps; i++) {
          setTimeout(() => {
            const t = i / steps;
            sendFxManager.setDelayLevel(startLevel + (endLevel - startLevel) * t);
          }, (fadeMs / steps) * i);
        }
      } else if (yParam === "drive") {
        // Restore synth distortion (engine-specific)
        void ctx; // suppress unused warning
        if (target === "melody") melodyEngine.setParams({ distortion: 0 });
        else bassEngine.setParams({ distortion: 0 });
      }
    }
  };

  // ── Loop playback engine ──
  useEffect(() => {
    if (!isLooping || events.length === 0) return;
    const loopStart = performance.now();
    const dur = loopDuration;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const playbackVoices = new Map<number, ActiveVoice>();

    const scheduleIteration = (iterationStart: number) => {
      for (const ev of events) {
        const delay = (iterationStart - performance.now()) + ev.t;
        const timer = setTimeout(() => {
          if (!usePerformancePadStore.getState().isLooping) return;
          if (ev.type === "down") {
            const midi = xToMidi(ev.x);
            const release = fireVoice(midi, ev.velocity, ev.y);
            const voice: ActiveVoice = { pointerId: ev.pointerId, midi, startAt: performance.now(), velocity: ev.velocity, releases: [release] };
            playbackVoices.set(ev.pointerId, voice);
          } else if (ev.type === "move") {
            const v = playbackVoices.get(ev.pointerId);
            if (!v) return;
            modulateVoice(ev.y);
            if (gridSnap) {
              const newMidi = xToMidi(ev.x);
              if (newMidi !== v.midi) repitchVoice(v, newMidi, ev.y);
            }
          } else if (ev.type === "up") {
            const v = playbackVoices.get(ev.pointerId);
            v?.releases.forEach((r) => r?.());
            playbackVoices.delete(ev.pointerId);
          }
        }, Math.max(0, delay));
        timers.push(timer);
      }
    };

    scheduleIteration(loopStart);
    // Loop: schedule next iteration just before this one ends
    const loopTimer = setInterval(() => {
      if (!usePerformancePadStore.getState().isLooping) {
        clearInterval(loopTimer);
        return;
      }
      scheduleIteration(performance.now());
    }, dur);

    return () => {
      timers.forEach(clearTimeout);
      clearInterval(loopTimer);
      playbackVoices.clear();
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
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const targetW = Math.max(2, Math.round(rect.width * dpr));
      const targetH = Math.max(2, Math.round(rect.height * dpr));
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

      if (mode === "chords") {
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
      } else {
        // ── Pitch grid (notes mode) ──
        const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
        const cols = scale.length * scaleOctaves;
        ctx.strokeStyle = "rgba(244, 114, 182, 0.08)";
        ctx.lineWidth = 1;
        for (let i = 1; i < cols; i++) {
          const x = (i / cols) * W;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
        ctx.strokeStyle = "rgba(244, 114, 182, 0.22)";
        ctx.lineWidth = 1.5;
        for (let o = 1; o < scaleOctaves; o++) {
          const x = (o / scaleOctaves) * W;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
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

        const chordColor = mode === "chords" && voice.cellIndex !== undefined
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
        const label = mode === "chords" && voice.cellIndex !== undefined
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
  }, [isOpen, scaleName, scaleOctaves, mode, chordSetIndex, trailEnabled]);

  if (!isOpen) return null;

  const activeYParam = Y_PARAMS.find((p) => p.id === yParam)!;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col backdrop-blur-xl"
      style={{ backgroundColor: "rgba(10, 8, 12, 0.98)" }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/80 px-5 py-2.5">
        <h2 className="text-[11px] font-bold tracking-[0.18em] text-[var(--ed-accent-melody)]">XY PERFORMANCE</h2>

        {/* Mode: Notes / Chords */}
        <div className="flex items-center gap-1">
          <span className="text-[8px] text-[var(--ed-text-muted)] mr-1">MODE</span>
          {(["notes", "chords"] as PadMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 h-6 text-[9px] font-bold rounded transition-all ${
                mode === m ? "bg-[var(--ed-accent-melody)]/30 text-[var(--ed-accent-melody)]" : "text-white/35 hover:text-white/60"
              }`}>{m === "notes" ? "NOTES" : "CHORDS"}</button>
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
              title="Bass + Melody transponieren live zur Akkord-Grundnote (z.B. Bass in Cm spielt Fm wenn du F-Moll-Akkord drückst)"
            >🎯 FOLLOW</button>
            <div className="mx-1 h-4 w-px bg-white/10" />
          </>
        )}

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
      <div className="flex-1 flex items-stretch justify-stretch p-6 gap-4 min-h-0">
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
          <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

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
                    ? `${chordSet.name} · ${chordSet.cells.length} CHORDS · MULTI-TOUCH`
                    : "BERÜHREN · HALTEN · BEWEGEN — MULTI-TOUCH"}
          </div>

          {/* Key/Scale indicator — top-right corner */}
          {mode === "notes" && (
            <div className="absolute top-3 right-4 text-[10px] text-white/45 font-mono pointer-events-none tracking-wide">
              <span className="text-[var(--ed-accent-melody)]/70 font-bold">{midiToName(rootNote).replace(/\d+$/, "")}</span>
              <span className="mx-1 text-white/20">·</span>
              <span>{gridSnap ? scaleName : "CHROMATIC"}</span>
            </div>
          )}
        </div>

        {/* Right strip: stats */}
        <div className="flex flex-col justify-end w-8 text-[8px] text-[var(--ed-text-muted)] font-mono">
          <span className="text-[var(--ed-accent-melody)]/70 rotate-90 origin-left translate-y-[-50%]">Pitch →</span>
        </div>
      </div>
    </div>
  );
}
