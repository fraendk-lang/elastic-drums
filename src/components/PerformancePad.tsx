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

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// MIDI number → "C4", "A#3" etc.
const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiToName(midi: number): string {
  return (NOTE_NAMES_SHARP[midi % 12] ?? "?") + (Math.floor(midi / 12) - 1);
}

// Which Y-Param applies to which engine. Both engines share most names.
const Y_PARAMS: { id: YAxisParam; label: string; range: [number, number] }[] = [
  { id: "cutoff",     label: "Cutoff",    range: [200, 9000] },
  { id: "resonance",  label: "Reso",      range: [0, 25] },
  { id: "envMod",     label: "EnvMod",    range: [0, 1] },
  { id: "decay",      label: "Decay",     range: [60, 700] },
  { id: "distortion", label: "Drive",     range: [0, 1] },
  { id: "volume",     label: "Volume",    range: [0.1, 0.9] },
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
  const yToParam = useCallback((y: number): number => {
    const info = Y_PARAMS.find((p) => p.id === yParam)!;
    const [min, max] = info.range;
    // Y=0 is top of pad (higher value feels more expressive)
    // Exponential curve for cutoff/decay (perceptual)
    if (yParam === "cutoff" || yParam === "decay") {
      const ratio = max / min;
      return min * Math.pow(ratio, y);
    }
    return min + y * (max - min);
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
    // Velocity: faster downward pointer movement in recent history = louder.
    // Simple: use pressure if available, else 0.85 default.
    const velocity = e.pressure > 0 ? 0.4 + e.pressure * 0.6 : 0.85;

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
      // Slight strum: fire notes with tiny delay between each for a human feel
      chord.intervals.forEach((interval, i) => {
        const noteMidi = rootMidi + interval;
        // Y axis modulates something meaningful even in chord mode — use cell's vertical center
        const r = fireVoice(noteMidi, velocity * (i === 0 ? 1 : 0.85), 1 - ((row + 0.5) / chordSet.rows));
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

            // Cell fill
            ctx.fillStyle = active ? `${hue}26` : "rgba(255,255,255,0.015)";
            ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);

            // Border
            ctx.strokeStyle = active ? `${hue}cc` : "rgba(255,255,255,0.08)";
            ctx.lineWidth = active ? 2 : 1;
            ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2);

            // Glow on active
            if (active) {
              ctx.shadowColor = hue;
              ctx.shadowBlur = 20;
              ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2);
              ctx.shadowBlur = 0;
            }

            // Label
            ctx.fillStyle = active ? "#fff" : hue + "cc";
            ctx.font = `${active ? "bold " : ""}${Math.min(22, cellW / 6)}px ui-sans-serif, system-ui, -apple-system`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(chord.label, x + cellW / 2, y + cellH / 2);
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

      // ── Particle trail (hover + press) ──
      const nowT = performance.now();
      if (trailEnabled && trailRef.current.length > 0) {
        const TRAIL_LIFETIME = 1100; // Longer lifetime for clearer trails
        trailRef.current = trailRef.current.filter((p) => nowT - p.t < TRAIL_LIFETIME);

        for (const p of trailRef.current) {
          const age = (nowT - p.t) / TRAIL_LIFETIME;
          const alpha = Math.pow(1 - age, 1.4);  // Slower fade
          const radius = 10 + (1 - age) * 22;    // Bigger particles (20→32px)
          const px = p.x * W;
          const py = p.y * H;

          // Softer additive-looking particle — bright magenta→violet→transparent
          const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
          grad.addColorStop(0,   `rgba(255, 200, 240, ${alpha * 0.85})`);
          grad.addColorStop(0.3, `rgba(244, 114, 182, ${alpha * 0.6})`);
          grad.addColorStop(0.7, `rgba(167, 139, 250, ${alpha * 0.3})`);
          grad.addColorStop(1,   "rgba(244, 114, 182, 0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ── Active voice press-indicator: big circle with note inside ──
      for (const voice of activeVoicesRef.current.values()) {
        const latest = [...trailRef.current].reverse().find((p) => p.pointerId === voice.pointerId);
        if (!latest) continue;
        const px = latest.x * W;
        const py = latest.y * H;

        // Pick color: chord hue if chord mode, else accent pink
        const chordColor = mode === "chords" && voice.cellIndex !== undefined
          ? (chordSet.cells[voice.cellIndex]?.hue ?? "#f472b6")
          : "#f472b6";

        // Scale-in animation: grows from 0 to full size in ~120ms after press
        const pressAge = Math.min(1, (nowT - voice.startAt) / 120);
        const pressScale = 1 - Math.pow(1 - pressAge, 3); // Ease-out cubic

        const R_FULL = 46;
        const R = R_FULL * pressScale;

        // Outer ripple (pulses outward continuously while pressed)
        const ripplePhase = ((nowT - voice.startAt) % 1400) / 1400;
        const rippleR = R + ripplePhase * 32;
        const rippleAlpha = (1 - ripplePhase) * 0.55;
        ctx.strokeStyle = chordColor + Math.floor(rippleAlpha * 255).toString(16).padStart(2, "0");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, rippleR, 0, Math.PI * 2);
        ctx.stroke();

        // Solid inner disc (semi-transparent filled)
        const discGrad = ctx.createRadialGradient(px, py, 0, px, py, R);
        discGrad.addColorStop(0,   chordColor + "e6"); // 90% alpha
        discGrad.addColorStop(0.6, chordColor + "80"); // 50% alpha
        discGrad.addColorStop(1,   chordColor + "00"); // 0% alpha
        ctx.fillStyle = discGrad;
        ctx.beginPath();
        ctx.arc(px, py, R, 0, Math.PI * 2);
        ctx.fill();

        // Border ring
        ctx.strokeStyle = chordColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, R, 0, Math.PI * 2);
        ctx.stroke();

        // Big note label in the center
        const label = mode === "chords" && voice.cellIndex !== undefined
          ? (chordSet.cells[voice.cellIndex]?.label ?? midiToName(voice.midi))
          : midiToName(voice.midi);

        const labelFontSize = Math.min(22, Math.max(12, (R_FULL * pressScale) * 0.55));
        ctx.font = `bold ${labelFontSize}px ui-sans-serif, system-ui, -apple-system`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
        ctx.shadowBlur = 6;
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

        {/* Y Param */}
        <div className="flex items-center gap-1">
          <span className="text-[8px] text-[var(--ed-text-muted)] mr-1">Y →</span>
          {Y_PARAMS.map((p) => (
            <button key={p.id} onClick={() => setYParam(p.id)}
              className={`px-2 h-6 text-[8px] font-bold rounded transition-all ${
                yParam === p.id ? "bg-white/15 text-white/90" : "text-white/30 hover:text-white/60"
              }`}>{p.label}</button>
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
