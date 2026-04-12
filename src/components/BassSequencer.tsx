/**
 * Bass Sequencer — TB-303 Style
 * Compact UI that fits below the drum sequencer
 */

import { useCallback } from "react";
import { useBassStore } from "../store/bassStore";
import { SCALES, ROOT_NOTES } from "../audio/BassEngine";
import { useDrumStore } from "../store/drumStore";

const SCALE_NAMES = Object.keys(SCALES);

export function BassSequencer() {
  const {
    steps, length, currentStep, rootName, scaleName, params,
    toggleStep, setStepNote, toggleAccent, toggleSlide, setStepOctave,
    setRootNote, setScale, setParam, randomize, clearSteps,
  } = useBassStore();

  const isPlaying = useDrumStore((s) => s.isPlaying);

  const handleNoteScroll = useCallback((step: number, delta: number) => {
    const s = steps[step];
    if (!s) return;
    setStepNote(step, Math.max(0, Math.min(12, s.note + delta)));
  }, [steps, setStepNote]);

  return (
    <div className="border-t border-[var(--ed-border)] bg-[#0c0c10] px-3 py-2">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[10px] font-black tracking-[0.2em] text-emerald-400">BASS 303</span>

        {/* Root Note */}
        <select
          value={rootName}
          onChange={(e) => {
            const idx = ROOT_NOTES.indexOf(e.target.value);
            if (idx >= 0) setRootNote(36 + idx, e.target.value);
          }}
          className="h-5 px-1 text-[9px] bg-black/40 border border-white/8 rounded text-white/70"
        >
          {ROOT_NOTES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        {/* Scale */}
        <select
          value={scaleName}
          onChange={(e) => setScale(e.target.value)}
          className="h-5 px-1 text-[9px] bg-black/40 border border-white/8 rounded text-white/70"
        >
          {SCALE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Waveform */}
        <div className="flex gap-[2px]">
          <button
            onClick={() => setParam("waveform", "sawtooth")}
            className={`px-1.5 h-5 text-[7px] font-bold rounded transition-colors ${
              params.waveform === "sawtooth" ? "bg-emerald-400/20 text-emerald-400" : "text-white/30"
            }`}
          >SAW</button>
          <button
            onClick={() => setParam("waveform", "square")}
            className={`px-1.5 h-5 text-[7px] font-bold rounded transition-colors ${
              params.waveform === "square" ? "bg-emerald-400/20 text-emerald-400" : "text-white/30"
            }`}
          >SQR</button>
        </div>

        {/* Knobs */}
        <div className="flex items-center gap-2 ml-2">
          <MiniKnob label="CUT" value={params.cutoff} min={200} max={8000}
            onChange={(v) => setParam("cutoff", v)} />
          <MiniKnob label="RES" value={params.resonance} min={0} max={25}
            onChange={(v) => setParam("resonance", v)} />
          <MiniKnob label="ENV" value={Math.round(params.envMod * 100)} min={0} max={100}
            onChange={(v) => setParam("envMod", v / 100)} />
          <MiniKnob label="DEC" value={params.decay} min={50} max={800}
            onChange={(v) => setParam("decay", v)} />
          <MiniKnob label="DIST" value={Math.round(params.distortion * 100)} min={0} max={100}
            onChange={(v) => setParam("distortion", v / 100)} />
          <MiniKnob label="VOL" value={Math.round(params.volume * 100)} min={0} max={100}
            onChange={(v) => setParam("volume", v / 100)} />
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <button onClick={randomize}
          className="px-2 h-5 text-[7px] font-bold text-white/30 hover:text-emerald-400 transition-colors">RND</button>
        <button onClick={clearSteps}
          className="px-2 h-5 text-[7px] font-bold text-white/30 hover:text-red-400 transition-colors">CLR</button>
      </div>

      {/* Step Grid */}
      <div className="flex gap-[2px]">
        {Array.from({ length: 16 }, (_, i) => {
          const step = steps[i]!;
          const isCurrent = isPlaying && currentStep === i;
          const isActive = step.active && i < length;

          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-[2px] min-w-0">
              {/* Step number */}
              <span className={`text-[7px] font-mono ${isCurrent ? "text-emerald-400 font-bold" : "text-white/20"}`}>
                {i + 1}
              </span>

              {/* Note display + step toggle */}
              <button
                onClick={() => toggleStep(i)}
                onWheel={(e) => {
                  e.preventDefault();
                  if (step.active) handleNoteScroll(i, e.deltaY < 0 ? 1 : -1);
                }}
                className={`w-full h-10 rounded-sm flex flex-col items-center justify-center transition-all ${
                  isCurrent ? "ring-1 ring-emerald-400/50" : ""
                } ${
                  isActive
                    ? "bg-emerald-500/60 hover:bg-emerald-500/80"
                    : "bg-white/5 hover:bg-white/10"
                }`}
              >
                {isActive && (
                  <>
                    <span className="text-[9px] font-bold text-white">
                      {step.note}
                    </span>
                    <span className="text-[6px] text-white/40">
                      {step.octave > 0 ? `+${step.octave}` : step.octave < 0 ? step.octave : ""}
                    </span>
                  </>
                )}
              </button>

              {/* Accent */}
              <button
                onClick={() => { if (step.active) toggleAccent(i); }}
                className={`w-full h-3 rounded-sm text-[5px] font-bold transition-colors ${
                  step.active && step.accent ? "bg-red-400/60 text-white" : "bg-white/3 text-white/15"
                }`}
              >
                A
              </button>

              {/* Slide */}
              <button
                onClick={() => { if (step.active) toggleSlide(i); }}
                className={`w-full h-3 rounded-sm text-[5px] font-bold transition-colors ${
                  step.active && step.slide ? "bg-blue-400/60 text-white" : "bg-white/3 text-white/15"
                }`}
              >
                S
              </button>

              {/* Octave */}
              <button
                onClick={() => {
                  if (!step.active) return;
                  const next = step.octave >= 1 ? -1 : step.octave + 1;
                  setStepOctave(i, next);
                }}
                className={`w-full h-3 rounded-sm text-[5px] font-bold transition-colors ${
                  step.octave !== 0 ? "bg-purple-400/40 text-white" : "bg-white/3 text-white/15"
                }`}
              >
                {step.octave > 0 ? "↑" : step.octave < 0 ? "↓" : "○"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Mini Knob (horizontal slider) ───────────────────────

function MiniKnob({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <span className="text-[6px] font-bold text-white/25 w-5">{label}</span>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-10 h-[3px] accent-emerald-400/60"
      />
    </div>
  );
}
