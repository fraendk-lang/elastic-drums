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
import { usePerformancePadStore, type YAxisParam, type PadTarget } from "../store/performancePadStore";
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
  midi: number;         // Current pitch (for glide)
  startAt: number;      // performance.now() at down
  velocity: number;
}

export function PerformancePad({ isOpen, onClose }: Props) {
  const {
    target, yParam, scaleOctaves, scaleLowestOct, gridSnap,
    events, isRecording, isLooping, loopDuration,
    setTarget, setYParam, setScaleOctaves, setScaleLowestOct, setGridSnap,
    startRecording, stopRecording, clearRecording, appendEvent,
    startLoop, stopLoop,
  } = usePerformancePadStore();

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
    const pianoRollNotes: import("./PianoRoll/types").PianoRollNote[] = rawNotes.map((n) => ({
      id: uid(),
      midi: xToMidi(n.x),
      start: n.startMs / msPerBeat,
      duration: Math.max(0.05, (n.endMs - n.startMs) / msPerBeat),
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

  // ── Fire a voice ──
  const fireVoice = useCallback((midi: number, velocity: number, y: number) => {
    const ctx = audioEngine.getAudioContext();
    if (!ctx) return;
    const startTime = ctx.currentTime + 0.001;
    const duration = 3.0; // Long sustain — released on pointer up via polyvoice auto-decay

    // Apply Y modulation to engine params BEFORE trigger
    const paramValue = yToParam(y);
    if (target === "melody") {
      melodyEngine.setParams({ [yParam]: paramValue });
      melodyEngine.triggerPolyNote(midi, startTime, duration, velocity, false);
    } else {
      bassEngine.setParams({ [yParam]: paramValue });
      bassEngine.triggerNote(midi, startTime, false, false, false, velocity);
      // Bass is mono — release after gate
      setTimeout(() => {
        bassEngine.releaseNote(ctx.currentTime);
      }, duration * 1000);
    }
  }, [target, yParam, yToParam]);

  // ── Live Y modulation while dragging ──
  const modulateVoice = useCallback((y: number) => {
    const paramValue = yToParam(y);
    if (target === "melody") melodyEngine.setParams({ [yParam]: paramValue });
    else bassEngine.setParams({ [yParam]: paramValue });
  }, [target, yParam, yToParam]);

  // ── Re-trigger on pitch change when bass (mono) or when X snap changes mid-gesture ──
  const repitchVoice = useCallback((voice: ActiveVoice, newMidi: number, y: number) => {
    if (voice.midi === newMidi) return;
    voice.midi = newMidi;
    // For melody: spawn a fresh poly voice (stack). For bass: slide-retrigger.
    if (target === "melody") {
      fireVoice(newMidi, voice.velocity * 0.85, y);
    } else {
      const ctx = audioEngine.getAudioContext();
      if (!ctx) return;
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
    const midi = xToMidi(x);
    const voice: ActiveVoice = { pointerId: e.pointerId, midi, startAt: performance.now(), velocity };
    activeVoicesRef.current.set(e.pointerId, voice);
    fireVoice(midi, velocity, y);
    appendEvent({ type: "down", pointerId: e.pointerId, x, y, velocity });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const voice = activeVoicesRef.current.get(e.pointerId);
    if (!voice) return;
    e.preventDefault();
    const { x, y } = getXY(e);
    modulateVoice(y);
    if (gridSnap) {
      const newMidi = xToMidi(x);
      if (newMidi !== voice.midi) repitchVoice(voice, newMidi, y);
    }
    appendEvent({ type: "move", pointerId: e.pointerId, x, y, velocity: voice.velocity });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const voice = activeVoicesRef.current.get(e.pointerId);
    if (!voice) return;
    activeVoicesRef.current.delete(e.pointerId);
    const { x, y } = getXY(e);
    appendEvent({ type: "up", pointerId: e.pointerId, x, y, velocity: voice.velocity });
    if (target === "bass") {
      const ctx = audioEngine.getAudioContext();
      if (ctx) bassEngine.releaseNote(ctx.currentTime);
    }
    // Melody poly voices auto-release after their internal duration.
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
            const voice: ActiveVoice = { pointerId: ev.pointerId, midi, startAt: performance.now(), velocity: ev.velocity };
            playbackVoices.set(ev.pointerId, voice);
            fireVoice(midi, ev.velocity, ev.y);
          } else if (ev.type === "move") {
            const v = playbackVoices.get(ev.pointerId);
            if (!v) return;
            modulateVoice(ev.y);
            if (gridSnap) {
              const newMidi = xToMidi(ev.x);
              if (newMidi !== v.midi) repitchVoice(v, newMidi, ev.y);
            }
          } else if (ev.type === "up") {
            playbackVoices.delete(ev.pointerId);
            if (target === "bass") {
              const ctx = audioEngine.getAudioContext();
              if (ctx) bassEngine.releaseNote(ctx.currentTime);
            }
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

  // ── Visual: draw active voice positions ──
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Grid overlay — scale divisions
      const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
      const cols = scale.length * scaleOctaves;
      ctx.strokeStyle = "rgba(244, 114, 182, 0.08)";
      ctx.lineWidth = 1;
      for (let i = 1; i < cols; i++) {
        const x = (i / cols) * canvas.width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      // Octave dividers — bolder
      ctx.strokeStyle = "rgba(244, 114, 182, 0.22)";
      ctx.lineWidth = 1.5;
      for (let o = 1; o < scaleOctaves; o++) {
        const x = (o / scaleOctaves) * canvas.width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }

      // Active voice glows — simplified: just count active touches
      const activeCount = activeVoicesRef.current.size;
      if (activeCount > 0) {
        ctx.fillStyle = "rgba(244, 114, 182, 0.6)";
        ctx.font = "10px monospace";
        ctx.fillText(`${activeCount} voice${activeCount > 1 ? "s" : ""}`, 8, 16);
      }

      rafIdRef.current = requestAnimationFrame(draw);
    };
    rafIdRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isOpen, scaleName, scaleOctaves]);

  if (!isOpen) return null;

  const activeYParam = Y_PARAMS.find((p) => p.id === yParam)!;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--ed-bg-primary)]/98 backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/80 px-5 py-2.5">
        <h2 className="text-[11px] font-bold tracking-[0.18em] text-[var(--ed-accent-melody)]">XY PERFORMANCE</h2>
        <span className="text-[9px] text-[var(--ed-text-muted)]">Multi-Touch Expression</span>

        <div className="flex-1" />

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

        {/* Range */}
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

        {/* Snap toggle */}
        <button onClick={() => setGridSnap(!gridSnap)}
          className={`px-2 h-6 text-[8px] font-bold rounded transition-all ${
            gridSnap ? "bg-[var(--ed-accent-blue)]/20 text-[var(--ed-accent-blue)]" : "text-white/35 hover:text-white/60"
          }`}
          title="Snap X-position to scale notes"
        >SNAP</button>

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* Recording controls */}
        {!isRecording ? (
          <button onClick={startRecording}
            className="px-3 h-6 text-[9px] font-bold rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-all"
          >● REC</button>
        ) : (
          <button onClick={stopRecording}
            className="px-3 h-6 text-[9px] font-bold rounded bg-red-500/35 text-red-200 animate-pulse transition-all"
          >■ STOP</button>
        )}
        {events.length > 0 && !isRecording && (
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
            <span className="text-[8px] text-[var(--ed-text-muted)] font-mono">{events.length} ev · {(loopDuration / 1000).toFixed(1)}s</span>
          </>
        )}

        <button onClick={onClose}
          className="ml-2 w-7 h-7 text-[12px] text-white/40 hover:text-white/80 hover:bg-white/10 rounded transition-all"
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
          className="relative flex-1 rounded-lg border border-[var(--ed-accent-melody)]/25 bg-gradient-to-b from-[var(--ed-bg-secondary)] to-[var(--ed-bg-primary)] overflow-hidden cursor-crosshair select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            touchAction: "none",
            backgroundImage:
              "radial-gradient(circle at 50% 50%, rgba(244,114,182,0.04) 0%, transparent 70%)",
          }}
        >
          <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

          {/* Static X-axis ruler */}
          <div className="absolute inset-x-0 bottom-0 h-6 flex items-stretch border-t border-white/5 pointer-events-none">
            {Array.from({ length: scaleOctaves }, (_, i) => (
              <div key={i} className="flex-1 flex items-center justify-center text-[9px] font-mono text-white/35 border-r border-white/5 last:border-0">
                Oct {scaleLowestOct + i}
              </div>
            ))}
          </div>

          {/* Hint */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] text-white/25 tracking-wider pointer-events-none font-light">
            BERÜHREN · HALTEN · BEWEGEN — MULTI-TOUCH
          </div>
        </div>

        {/* Right strip: stats */}
        <div className="flex flex-col justify-end w-8 text-[8px] text-[var(--ed-text-muted)] font-mono">
          <span className="text-[var(--ed-accent-melody)]/70 rotate-90 origin-left translate-y-[-50%]">Pitch →</span>
        </div>
      </div>
    </div>
  );
}
