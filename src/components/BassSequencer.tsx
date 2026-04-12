/**
 * Bass Sequencer — Professional mini piano-roll style
 * Drag up/down on steps to change pitch. Visual bar height = note.
 */

import { useCallback, useRef } from "react";
import { useBassStore } from "../store/bassStore";
import { SCALES, ROOT_NOTES, scaleNote } from "../audio/BassEngine";
import { useDrumStore } from "../store/drumStore";

const SCALE_NAMES = Object.keys(SCALES);
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToName(midi: number): string {
  return NOTE_NAMES[midi % 12] + String(Math.floor(midi / 12) - 1);
}

export function BassSequencer() {
  const {
    steps, length, currentStep, rootNote, rootName, scaleName, params,
    toggleStep, setStepNote, toggleAccent,
    setRootNote, setScale, setParam, randomize, clearSteps,
  } = useBassStore();

  const isPlaying = useDrumStore((s) => s.isPlaying);
  const dragRef = useRef<{ step: number; startY: number; startNote: number } | null>(null);

  // Drag to change note
  const handleMouseDown = useCallback((e: React.MouseEvent, step: number) => {
    const s = steps[step];
    if (!s?.active) {
      toggleStep(step);
      return;
    }
    dragRef.current = { step, startY: e.clientY, startNote: s.note };

    const handleMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const dy = dragRef.current.startY - me.clientY;
      const noteDelta = Math.round(dy / 8); // 8px per scale degree
      const newNote = Math.max(0, Math.min(14, dragRef.current.startNote + noteDelta));
      setStepNote(dragRef.current.step, newNote);
    };

    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [steps, toggleStep, setStepNote]);

  // Get scale for display
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const maxNote = Math.max(7, scale.length + 3);

  return (
    <div className="border-t border-white/5 bg-[#09090d]">
      {/* Controls row */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <span className="text-[9px] font-black tracking-[0.15em] text-emerald-400/80">BASS</span>

        <Sep />

        {/* Root + Scale */}
        <Sel value={rootName} options={ROOT_NOTES}
          onChange={(v) => { const i = ROOT_NOTES.indexOf(v); if (i >= 0) setRootNote(36 + i, v); }} />
        <Sel value={scaleName} options={SCALE_NAMES} onChange={setScale} />

        <Sep />

        {/* Waveform */}
        <Btn active={params.waveform === "sawtooth"} onClick={() => setParam("waveform", "sawtooth")} label="SAW" />
        <Btn active={params.waveform === "square"} onClick={() => setParam("waveform", "square")} label="SQR" />

        <Sep />

        {/* Sound params */}
        <Knb label="CUT" value={params.cutoff} min={200} max={8000} onChange={(v) => setParam("cutoff", v)} />
        <Knb label="RES" value={params.resonance} min={0} max={25} onChange={(v) => setParam("resonance", v)} />
        <Knb label="ENV" value={Math.round(params.envMod * 100)} min={0} max={100} onChange={(v) => setParam("envMod", v / 100)} />
        <Knb label="DEC" value={params.decay} min={50} max={800} onChange={(v) => setParam("decay", v)} />
        <Knb label="DST" value={Math.round(params.distortion * 100)} min={0} max={100} onChange={(v) => setParam("distortion", v / 100)} />

        <div className="flex-1" />

        <button onClick={randomize} className="text-[7px] font-bold text-white/20 hover:text-emerald-400/60 transition-colors">RND</button>
        <button onClick={clearSteps} className="text-[7px] font-bold text-white/20 hover:text-red-400/60 transition-colors">CLR</button>
      </div>

      {/* Piano Roll Grid */}
      <div className="flex gap-[1px] px-3 py-1.5 h-24">
        {Array.from({ length: 16 }, (_, i) => {
          const step = steps[i]!;
          const isCurrent = isPlaying && currentStep === i;
          const isActive = step.active && i < length;
          const noteHeight = isActive ? Math.max(12, (step.note / maxNote) * 100) : 0;
          const midi = isActive ? scaleNote(rootNote, scaleName, step.note, step.octave) : 0;

          return (
            <div
              key={i}
              className="flex-1 flex flex-col justify-end min-w-0 relative"
              onMouseDown={(e) => handleMouseDown(e, i)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (isActive) toggleAccent(i);
              }}
            >
              {/* Playhead */}
              {isCurrent && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-emerald-400 rounded-full" style={{ boxShadow: "0 0 4px rgba(52,211,153,0.5)" }} />
              )}

              {/* Note bar */}
              <div
                className={`w-full rounded-t-sm transition-all duration-75 flex flex-col items-center justify-end pb-0.5 cursor-ns-resize select-none ${
                  isActive
                    ? step.accent
                      ? "bg-emerald-400/80"
                      : "bg-emerald-400/50"
                    : "bg-white/4 hover:bg-white/8 cursor-pointer rounded-sm"
                }`}
                style={{
                  height: isActive ? `${noteHeight}%` : "100%",
                  minHeight: isActive ? 16 : undefined,
                  borderLeft: step.slide && isActive ? "2px solid rgba(96,165,250,0.7)" : "none",
                }}
              >
                {isActive && (
                  <span className="text-[7px] font-mono text-white/80 leading-none">
                    {midiToName(midi)}
                  </span>
                )}
              </div>

              {/* Step number */}
              <div className={`text-center text-[6px] font-mono mt-0.5 ${
                isCurrent ? "text-emerald-400" : "text-white/15"
              }`}>
                {i + 1}
              </div>

              {/* Accent + Slide indicators */}
              {isActive && (
                <div className="flex justify-center gap-[1px] mt-[1px]">
                  {step.accent && <div className="w-1 h-1 rounded-full bg-red-400/70" />}
                  {step.slide && <div className="w-1 h-1 rounded-full bg-blue-400/70" />}
                  {step.octave !== 0 && (
                    <span className="text-[5px] text-purple-400/60">
                      {step.octave > 0 ? "↑" : "↓"}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tiny sub-components ─────────────────────────────────

function Sep() { return <div className="w-px h-3 bg-white/6" />; }

function Sel({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-4 px-0.5 text-[8px] bg-transparent border border-white/8 rounded text-white/50 focus:outline-none appearance-none cursor-pointer">
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Btn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-1 h-4 text-[6px] font-bold rounded transition-colors ${
        active ? "bg-emerald-400/15 text-emerald-400/80" : "text-white/20 hover:text-white/40"
      }`}>
      {label}
    </button>
  );
}

function Knb({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <span className="text-[5px] font-bold text-white/20">{label}</span>
      <input type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-8 h-[2px] accent-emerald-400/40" />
    </div>
  );
}
