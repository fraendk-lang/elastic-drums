/**
 * Chords Sequencer — Piano-roll with pages, presets, chordline agent
 */

import { useCallback, useRef, useState } from "react";
import { useChordsStore, CHORDS_PRESETS, CHORDLINE_STRATEGIES, CHORD_TYPE_NAMES } from "../store/chordsStore";
import { SCALES, ROOT_NOTES, scaleNote } from "../audio/BassEngine";
import { useDrumStore } from "../store/drumStore";
import { Knob } from "./Knob";
import { AutomationLane, type AutomationParam } from "./AutomationLane";

const CHORDS_AUTO_PARAMS: AutomationParam[] = [
  { id: "cutoff", label: "CUT", min: 200, max: 12000 },
  { id: "resonance", label: "RES", min: 0, max: 20 },
  { id: "envMod", label: "ENV", min: 0, max: 100 },
  { id: "attack", label: "ATK", min: 1, max: 500 },
  { id: "release", label: "REL", min: 50, max: 2000 },
  { id: "distortion", label: "DRV", min: 0, max: 100 },
];

const SCALE_NAMES = Object.keys(SCALES);
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const VALID_LENGTHS = [4, 8, 12, 16, 24, 32, 48, 64];
const CHORDS_COLOR = "var(--ed-accent-chords)";

function chordLabel(midi: number, chordType: string): string {
  const noteName = NOTE_NAMES[midi % 12];
  const SHORT: Record<string, string> = {
    "Maj": "", "Min": "m", "7th": "7", "Maj7": "M7", "Min7": "m7",
    "Min9": "m9", "Dim": "\u00B0", "Aug": "+", "Sus4": "s4", "Sus2": "s2",
    "Add9": "a9", "9th": "9",
  };
  return noteName + (SHORT[chordType] ?? chordType);
}

export function ChordsSequencer() {
  const {
    steps, length, currentStep, selectedPage, rootNote, rootName, scaleName, params, presetIndex, strategyIndex,
    automationData, automationParam,
    toggleStep, setStepNote, toggleTie, cycleOctave, cycleChordType, setStepChordType,
    setRootNote, setScale, setParam, setLength, setSelectedPage,
    clearSteps, generateChordline, nextStrategy, prevStrategy,
    loadPreset,
    setAutomationValue, setAutomationParam,
  } = useChordsStore();

  const isPlaying = useDrumStore((s) => s.isPlaying);
  const dragRef = useRef<{ step: number; startY: number; startNote: number } | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);

  const pageOffset = selectedPage * 16;

  const strategyName = CHORDLINE_STRATEGIES[strategyIndex]?.name ?? "Random";

  const handleMouseDown = useCallback((e: React.MouseEvent, absStep: number) => {
    const s = steps[absStep];
    if (s?.active) {
      if (e.altKey) { e.preventDefault(); toggleTie(absStep); return; }
      if (e.ctrlKey || e.metaKey || e.button === 1) { e.preventDefault(); cycleOctave(absStep); return; }
    }
    if (!s?.active) { toggleStep(absStep); setSelectedStep(absStep); return; }
    setSelectedStep(absStep);
    if (e.button === 0) {
      dragRef.current = { step: absStep, startY: e.clientY, startNote: s.note };
      let didDrag = false;
      const handleMove = (me: MouseEvent) => {
        if (!dragRef.current) return;
        const dy = dragRef.current.startY - me.clientY;
        if (Math.abs(dy) > 3) didDrag = true;
        if (didDrag) {
          const newNote = Math.max(0, Math.min(14, dragRef.current.startNote + Math.round(dy / 8)));
          setStepNote(dragRef.current.step, newNote);
        }
      };
      const handleUp = () => {
        if (!didDrag && dragRef.current) toggleStep(dragRef.current.step);
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    }
  }, [steps, toggleStep, setStepNote, toggleTie, cycleOctave]);

  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const maxNote = Math.max(7, scale.length + 3);

  return (
    <div className="border-t border-[var(--ed-accent-chords)]/15 bg-gradient-to-b from-[#0d0a10] to-[#0a080d]">
      {/* Row 1: Main controls */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 border-b border-white/5">
        {/* Title */}
        <span className="text-[10px] font-black tracking-[0.15em] text-[var(--ed-accent-chords)] shrink-0" style={{ textShadow: "0 0 12px rgba(167,139,250,0.2)" }}>CHORDS</span>

        <Sep />

        {/* Sound preset selector */}
        <select
          value={presetIndex}
          onChange={(e) => loadPreset(Number(e.target.value))}
          className="h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded-md text-[var(--ed-accent-chords)]/70 focus:outline-none appearance-none cursor-pointer hover:border-[var(--ed-accent-chords)]/30 transition-colors min-w-[90px]"
        >
          {CHORDS_PRESETS.map((p, i) => (
            <option key={i} value={i}>{p.name}</option>
          ))}
        </select>

        <Sep />

        {/* Root + Scale */}
        <Sel value={rootName} options={ROOT_NOTES}
          onChange={(v) => { const i = ROOT_NOTES.indexOf(v); if (i >= 0) setRootNote(48 + i, v); }} />
        <Sel value={scaleName} options={SCALE_NAMES} onChange={setScale} />

        <Sep />

        {/* Waveform: SAW, SQR, TRI */}
        <WaveBtn active={params.waveform === "sawtooth"} onClick={() => setParam("waveform", "sawtooth")} label="SAW" />
        <WaveBtn active={params.waveform === "square"} onClick={() => setParam("waveform", "square")} label="SQR" />
        <WaveBtn active={params.waveform === "triangle"} onClick={() => setParam("waveform", "triangle")} label="TRI" />

        <Sep />

        {/* Filter mode */}
        {(["lowpass", "highpass", "bandpass", "notch"] as const).map((ft) => {
          const labels: Record<string, string> = { lowpass: "LP", highpass: "HP", bandpass: "BP", notch: "NT" };
          return <button key={ft} onClick={() => setParam("filterType", ft)}
            className={`px-1.5 h-5 text-[7px] font-bold rounded transition-all ${
              params.filterType === ft ? "bg-[var(--ed-accent-blue)]/20 text-[var(--ed-accent-blue)]" : "text-white/20 hover:text-white/40"
            }`}>{labels[ft]}</button>;
        })}

        <Sep />

        {/* Chord Type Selector */}
        <div className="flex items-center gap-[2px] bg-white/[0.03] rounded-md px-1">
          <span className="text-[7px] text-white/25 font-bold mr-0.5">TYPE</span>
          {CHORD_TYPE_NAMES.map((ct) => {
            const SHORT: Record<string, string> = { "Maj": "M", "Min": "m", "7th": "7", "Maj7": "M7", "Min7": "m7", "Min9": "m9", "Dim": "°", "Aug": "+", "Sus4": "s4", "Sus2": "s2", "Add9": "a9", "9th": "9" };
            const isActive = selectedStep !== null && steps[selectedStep]?.active && steps[selectedStep]?.chordType === ct;
            return (
              <button key={ct}
                onClick={() => {
                  if (selectedStep !== null && steps[selectedStep]?.active) {
                    setStepChordType(selectedStep, ct);
                  }
                }}
                className={`px-1 h-5 text-[7px] font-bold rounded transition-all ${
                  isActive
                    ? "bg-[var(--ed-accent-chords)]/25 text-[var(--ed-accent-chords)]"
                    : "text-white/20 hover:text-white/50"
                }`}
              >
                {SHORT[ct] ?? ct}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Chordline Agent — strategy cycle + generate */}
        <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-md px-1">
          <button onClick={prevStrategy} className="w-4 h-5 text-[8px] text-white/25 hover:text-white/60 transition-colors">&lsaquo;</button>
          <button
            onClick={() => generateChordline(strategyIndex)}
            className="h-6 px-2 text-[8px] font-bold text-[var(--ed-accent-chords)]/70 hover:text-[var(--ed-accent-chords)] transition-all"
            title="Generate chordline with selected strategy"
          >
            {strategyName}
          </button>
          <button onClick={nextStrategy} className="w-4 h-5 text-[8px] text-white/25 hover:text-white/60 transition-colors">&rsaquo;</button>
        </div>

        <Sep />

        {/* CLR button */}
        <div className="flex items-center gap-[2px] relative">
          <button className="h-6 px-2 text-[7px] font-bold text-white/15 rounded-md transition-all cursor-default">SAVE</button>
          <button className="h-6 px-2 text-[7px] font-bold text-white/15 rounded-md transition-all cursor-default">LOAD</button>
          <button onClick={clearSteps} className="h-6 px-2 text-[7px] font-bold text-white/25 hover:text-red-400/70 hover:bg-white/5 rounded-md transition-all">CLR</button>
        </div>
      </div>

      {/* Compact Knobs Row — always visible */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/5 overflow-x-auto">
        <Knob value={params.cutoff} min={200} max={12000} defaultValue={1200} label="CUT" color={CHORDS_COLOR} size={34} onChange={(v) => setParam("cutoff", v)} />
        <Knob value={params.resonance} min={0} max={20} defaultValue={5} label="RES" color={CHORDS_COLOR} size={34} onChange={(v) => setParam("resonance", v)} />
        <Knob value={Math.round(params.envMod * 100)} min={0} max={100} defaultValue={30} label="ENV" color={CHORDS_COLOR} size={34} onChange={(v) => setParam("envMod", v / 100)} />
        <Knob value={params.attack} min={1} max={500} defaultValue={20} label="ATK" color={CHORDS_COLOR} size={34} onChange={(v) => setParam("attack", v)} />
        <Knob value={params.release} min={50} max={2000} defaultValue={300} label="REL" color={CHORDS_COLOR} size={34} onChange={(v) => setParam("release", v)} />
        <Knob value={params.detune} min={0} max={50} defaultValue={10} label="DET" color={CHORDS_COLOR} size={34} onChange={(v) => setParam("detune", v)} />
        <Knob value={Math.round(params.distortion * 100)} min={0} max={100} defaultValue={10} label="DRV" color={CHORDS_COLOR} size={34} onChange={(v) => setParam("distortion", v / 100)} />
        <Knob value={Math.round(params.subOsc * 100)} min={0} max={100} defaultValue={20} label="SUB" color={CHORDS_COLOR} size={34} onChange={(v) => setParam("subOsc", v / 100)} />
      </div>

      {/* Row 2: Pages + length */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-white/5">
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((page) => (
            <button key={page} onClick={() => setSelectedPage(page)}
              className={`px-2 py-0.5 text-[9px] font-medium rounded-md transition-all ${
                selectedPage === page
                  ? "bg-[var(--ed-accent-chords)] text-black font-bold shadow-[0_0_8px_rgba(167,139,250,0.2)]"
                  : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)]"
              }`}>
              {page * 16 + 1}-{(page + 1) * 16}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-1">
          {(() => {
            const ci = VALID_LENGTHS.indexOf(length);
            const si = ci >= 0 ? ci : VALID_LENGTHS.findIndex((l) => l >= length);
            return (<>
              <button onClick={() => { const idx = Math.max(0, (si >= 0 ? si : 3) - 1); setLength(VALID_LENGTHS[idx]!); }}
                className="w-5 h-5 rounded-md text-[10px] font-bold bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-white hover:bg-[var(--ed-bg-elevated)] transition-all">&minus;</button>
              <span className="text-[10px] font-mono text-[var(--ed-accent-chords)] min-w-[24px] text-center font-bold tabular-nums">{length}</span>
              <button onClick={() => { const idx = Math.min(VALID_LENGTHS.length - 1, (si >= 0 ? si : 3) + 1); setLength(VALID_LENGTHS[idx]!); }}
                className="w-5 h-5 rounded-md text-[10px] font-bold bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-white hover:bg-[var(--ed-bg-elevated)] transition-all">+</button>
              <span className="text-[7px] text-[var(--ed-text-muted)] font-bold">STEPS</span>
            </>);
          })()}
        </div>
        <div className="flex-1" />
        <span className="hidden lg:inline text-[7px] text-white/12">click = select &middot; TYPE buttons = chord &middot; drag = pitch &middot; rclick = cycle &middot; alt = tie</span>
      </div>

      {/* Piano Roll + Automation */}
      <div className="flex gap-1.5 px-3 py-1.5 h-20 sm:h-28">
      <div className="flex gap-[1px] flex-1 min-w-0">
        {Array.from({ length: 16 }, (_, i) => {
          const absStep = pageOffset + i;
          const step = steps[absStep]!;
          const isCurrent = isPlaying && currentStep === absStep;
          const isActive = step.active && absStep < length;
          const noteHeight = isActive ? Math.max(14, (step.note / maxNote) * 100) : 0;
          const midi = isActive ? scaleNote(rootNote, scaleName, step.note, step.octave) : 0;
          const prevStep = absStep > 0 ? steps[absStep - 1] : null;
          const isTiedFromPrev = isActive && step.tie && prevStep?.active;
          const isBeat = i % 4 === 0;
          const beyondLength = absStep >= length;
          const label = isActive ? chordLabel(midi, step.chordType) : "";
          const isSelected = selectedStep === absStep;

          return (
            <div key={i} className={`flex-1 flex flex-col justify-end min-w-0 relative ${beyondLength ? "opacity-25" : ""} ${isSelected && isActive ? "ring-1 ring-[var(--ed-accent-chords)]/50 rounded-sm" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); handleMouseDown(e, absStep); }}
              onContextMenu={(e) => { e.preventDefault(); if (isActive) cycleChordType(absStep); }}
              onAuxClick={(e) => { if (e.button === 1 && isActive) { e.preventDefault(); cycleOctave(absStep); } }}>
              {isBeat && <div className="absolute top-0 bottom-0 left-0 w-px bg-white/[0.04]" />}
              {isCurrent && (
                <div className="absolute top-0 left-0 right-0 h-[2px] rounded-full"
                  style={{ background: "linear-gradient(90deg, var(--ed-accent-chords), transparent)", boxShadow: "0 0 8px rgba(167,139,250,0.4)" }} />
              )}
              <div className={`w-full transition-all duration-75 flex flex-col items-center justify-end pb-0.5 select-none ${isActive ? "cursor-ns-resize" : "cursor-pointer rounded-sm"}`}
                style={{
                  height: isActive ? `${noteHeight}%` : "100%", minHeight: isActive ? 20 : undefined,
                  background: isActive
                    ? step.accent ? "linear-gradient(180deg, rgba(167,139,250,0.85), rgba(167,139,250,0.55))"
                    : step.tie ? "linear-gradient(180deg, rgba(34,211,238,0.55), rgba(34,211,238,0.35))"
                    : "linear-gradient(180deg, rgba(167,139,250,0.55), rgba(167,139,250,0.3))"
                    : "rgba(255,255,255,0.025)",
                  borderTopLeftRadius: isTiedFromPrev ? 0 : 3, borderTopRightRadius: 3, borderBottomLeftRadius: 0,
                  marginLeft: isTiedFromPrev ? -1 : 0,
                  boxShadow: isActive && isCurrent ? "0 0 10px rgba(167,139,250,0.25)" : isActive ? "inset 0 1px 0 rgba(255,255,255,0.05)" : "none",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.055)"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}>
                {isActive && <span className="text-[7px] font-bold font-mono text-white/90 leading-none drop-shadow-sm truncate max-w-full px-px">{label}</span>}
              </div>
              <div className={`text-center text-[7px] font-mono mt-0.5 ${isCurrent ? "text-[var(--ed-accent-chords)] font-bold" : isBeat ? "text-white/15" : "text-white/8"}`}>{absStep + 1}</div>
              {isActive && (
                <div className="flex justify-center gap-[2px] mt-[1px] min-h-[8px]">
                  {step.accent && <div className="w-2 h-2 rounded-full bg-red-400/80" />}
                  {step.tie && <div className="w-2 h-2 rounded-full bg-cyan-400/80" />}
                  {step.octave !== 0 && <span className="text-[7px] font-bold text-purple-400/80 leading-none">{step.octave > 0 ? "+1" : "-1"}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <AutomationLane
        params={CHORDS_AUTO_PARAMS}
        selectedParam={automationParam}
        values={automationData[automationParam] ?? []}
        length={length}
        pageOffset={pageOffset}
        currentStep={currentStep}
        isPlaying={isPlaying}
        color="var(--ed-accent-chords)"
        onSelectParam={setAutomationParam}
        onChange={(step, value) => setAutomationValue(automationParam, step, value)}
      />
      </div>
    </div>
  );
}

// --- Sub-components ---

function Sep() { return <div className="w-px h-4 bg-white/6" />; }

function Sel({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded-md text-white/60 focus:outline-none appearance-none cursor-pointer hover:border-[var(--ed-accent-chords)]/30 transition-colors">
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function WaveBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 h-6 text-[8px] font-bold rounded-md transition-all ${
        active ? "bg-[var(--ed-accent-chords)]/15 text-[var(--ed-accent-chords)] shadow-[0_0_8px_rgba(167,139,250,0.1)]" : "text-white/25 hover:text-white/50 hover:bg-white/5"
      }`}>
      {label}
    </button>
  );
}
