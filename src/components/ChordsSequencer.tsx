/**
 * Chords Sequencer — Piano-roll with pages, presets, chordline agent
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, memo } from "react";
import { useChordsStore, CHORDS_PRESETS, CHORDLINE_STRATEGIES, CHORD_TYPE_NAMES, CHORDS_SIGNATURE_PRESET_NAMES, chordsCurrentStepStore } from "../store/chordsStore";
import { CHORDS_INSTRUMENTS, findInstrumentOption } from "../audio/SoundFontEngine";
import { SCALES, ROOT_NOTES, scaleNote } from "../audio/BassEngine";
import { useDrumStore } from "../store/drumStore";
import { WAVETABLE_NAMES } from "../audio/Wavetables";
import { Knob } from "./Knob";
import { SoundFontKnobs } from "./SoundFontKnobs";
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
const VALID_LENGTHS = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
const CHORDS_COLOR = "var(--ed-accent-chords)";
const CHORDS_INSTRUMENT_GROUPS = CHORDS_INSTRUMENTS.reduce<Record<string, typeof CHORDS_INSTRUMENTS>>((groups, instrument) => {
  const key = instrument.reliability === "core" ? "Reliable" : "Optional GM";
  groups[key] ??= [];
  groups[key].push(instrument);
  return groups;
}, {});
const CHORDS_PRESET_GROUPS = {
  All: CHORDS_PRESETS.map((preset, index) => ({ preset, index })),
};

function chordLabel(midi: number, chordType: string): string {
  const noteName = NOTE_NAMES[midi % 12];
  const SHORT: Record<string, string> = {
    "Maj": "", "Min": "m", "7th": "7", "Maj7": "M7", "Min7": "m7",
    "Min9": "m9", "Dim": "\u00B0", "Aug": "+", "Sus4": "s4", "Sus2": "s2",
    "Add9": "a9", "9th": "9",
  };
  return noteName + (SHORT[chordType] ?? chordType);
}

// AutomationLane wrapper — subscribes to external step store
const ChordsAutomationLaneWrapper = memo(function ChordsAutomationLaneWrapper(
  props: Omit<React.ComponentProps<typeof AutomationLane>, "currentStep">,
) {
  const currentStep = useSyncExternalStore(chordsCurrentStepStore.subscribe, chordsCurrentStepStore.getSnapshot);
  return <AutomationLane {...props} currentStep={currentStep} />;
});

// Velocity lane — subscribes to external step store for isCurrent highlight
interface ChordsVelLaneProps {
  steps: ReturnType<typeof useChordsStore.getState>["steps"];
  length: number;
  pageOffset: number;
  velocityLaneExpanded: boolean;
  isPlaying: boolean;
  onDraw: (e: React.MouseEvent<HTMLDivElement>, absStep: number) => void;
}
const ChordsVelocityLane = memo(function ChordsVelocityLane({
  steps, length, pageOffset, velocityLaneExpanded, isPlaying, onDraw,
}: ChordsVelLaneProps) {
  const currentStep = useSyncExternalStore(chordsCurrentStepStore.subscribe, chordsCurrentStepStore.getSnapshot);
  return (
    <>
      {Array.from({ length: 16 }, (_, i) => {
        const absStep = pageOffset + i;
        const step = steps[absStep]!;
        const velocity = step.velocity ?? (step.accent ? 1 : 0.7);
        const isCurrent = isPlaying && currentStep === absStep;
        return (
          <div
            key={`vel-${i}`}
            className={`relative flex-1 rounded-md border cursor-ns-resize transition-colors ${absStep >= length ? "opacity-25" : ""} ${isCurrent ? "border-[var(--ed-accent-chords)]/45 bg-[var(--ed-accent-chords)]/[0.06]" : "border-white/6 bg-white/[0.025] hover:bg-white/[0.045]"}`}
            onMouseDown={(e) => onDraw(e, absStep)}
            onMouseMove={(e) => { if (e.buttons === 1) onDraw(e, absStep); }}
          >
            {step.active && (
              <div
                className="absolute inset-x-[3px] bottom-[3px] rounded-sm shadow-[0_0_14px_rgba(167,139,250,0.16)]"
                style={{
                  height: `${Math.max(12, velocity * 100)}%`,
                  background: step.accent
                    ? "linear-gradient(180deg, rgba(248,113,113,0.9), rgba(167,139,250,0.7))"
                    : "linear-gradient(180deg, rgba(216,180,254,0.9), rgba(167,139,250,0.45))",
                }}
              />
            )}
            {step.active && velocityLaneExpanded && (
              <span className="pointer-events-none absolute left-1 top-1 text-[8px] font-black text-white/50">
                {Math.round(velocity * 100)}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
});

export function ChordsSequencer() {
  const {
    steps, length, selectedPage, rootNote, rootName, scaleName, params, presetIndex, strategyIndex, instrument,
    automationData, automationParam,
    globalOctave,
    toggleStep, setStepNote, setStepVelocity, toggleTie, setGateLength, setStepOctave, cycleOctave, cycleChordType, setStepChordType,
    setRootNote, setGlobalOctave, setScale, setParam, setLength, setSelectedPage,
    clearSteps, generateChordline, nextStrategy, prevStrategy,
    loadPreset, setInstrument,
    setAutomationValue, setAutomationParam,
  } = useChordsStore();

  // currentStep from external store — does not trigger full ChordsSequencer re-render
  const currentStep = useSyncExternalStore(chordsCurrentStepStore.subscribe, chordsCurrentStepStore.getSnapshot);

  const isPlaying = useDrumStore((s) => s.isPlaying);
  const dragRef = useRef<{ step: number; startY: number; startNote: number } | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [durationDrag, setDurationDrag] = useState<{ sourceStep: number; endStep: number } | null>(null);
  const stepElRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [velocityLaneExpanded, setVelocityLaneExpanded] = useState(true);

  const pageOffset = selectedPage * 16;
  const totalPages = Math.max(1, Math.ceil(length / 16));
  const pageNumbers = Array.from({ length: totalPages }, (_, page) => page);
  const instrumentMeta = findInstrumentOption(CHORDS_INSTRUMENTS, instrument);
  const currentPresetName = CHORDS_PRESETS[presetIndex]?.name ?? "Preset";
  const isSignaturePreset = CHORDS_SIGNATURE_PRESET_NAMES.includes(currentPresetName as typeof CHORDS_SIGNATURE_PRESET_NAMES[number]);
  const strategyName = CHORDLINE_STRATEGIES[strategyIndex]?.name ?? "Random";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.shiftKey || selectedStep === null) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const selected = steps[selectedStep];
      if (!selected?.active) return;

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const delta = e.key === "ArrowUp" ? 1 : -1;
        const nextOctave = Math.max(-2, Math.min(2, selected.octave + delta));
        if (nextOctave !== selected.octave) {
          setStepOctave(selectedStep, nextOctave);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedStep, setStepOctave, steps]);

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

  const handleDurationDragStart = useCallback((e: React.PointerEvent, absStep: number) => {
    const s = steps[absStep];
    const prev = absStep > 0 ? steps[absStep - 1] : null;
    const isContinuationTie = Boolean(s?.active && s.tie && prev?.active);
    if (!s?.active || isContinuationTie) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    if (offsetX < rect.width - 16) return; // Wider grab area

    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDurationDrag({ sourceStep: absStep, endStep: absStep });
  }, [steps]);

  const handleDurationDragMove = useCallback((e: React.PointerEvent) => {
    if (!durationDrag) return;
    for (let i = 0; i < 16; i++) {
      const absStep = pageOffset + i;
      const el = stepElRefs.current.get(absStep);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX < rect.right && absStep >= durationDrag.sourceStep) {
        setDurationDrag((prev) => prev ? { ...prev, endStep: absStep } : null);
        break;
      }
    }
  }, [durationDrag, pageOffset]);

  const handleDurationDragEnd = useCallback(() => {
    if (!durationDrag) return;
    setGateLength(durationDrag.sourceStep, durationDrag.endStep);
    setDurationDrag(null);
  }, [durationDrag, setGateLength]);

  const handleVelocityDraw = useCallback((e: React.MouseEvent<HTMLDivElement>, absStep: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = 1 - (e.clientY - rect.top) / rect.height;
    setStepVelocity(absStep, Math.max(0.2, Math.min(1, ratio)));
  }, [setStepVelocity]);

  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const maxNote = Math.max(7, scale.length + 3);

  return (
    <div className="border-t border-[var(--ed-accent-chords)]/15 bg-gradient-to-b from-[#0d0a10] to-[#0a080d]">
      {/* Row 1: Main controls */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 border-b border-white/5">
        {/* Title */}
        <span className="text-[10px] font-black tracking-[0.15em] text-[var(--ed-accent-chords)] shrink-0" style={{ textShadow: "0 0 12px rgba(167,139,250,0.2)" }}>CHORDS</span>

        <Sep />

        {/* Instrument selector */}
        <select
          value={instrument}
          onChange={(e) => setInstrument(e.target.value)}
          className="h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded-md text-[var(--ed-accent-chords)]/70 focus:outline-none appearance-none cursor-pointer hover:border-[var(--ed-accent-chords)]/30 transition-colors min-w-[90px]"
        >
          {Object.entries(CHORDS_INSTRUMENT_GROUPS).map(([label, items]) => (
            <optgroup key={label} label={label}>
              {items.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <span className={`h-6 inline-flex items-center rounded-full border px-2 text-[8px] font-bold tracking-[0.14em] ${
          (instrumentMeta?.reliability ?? "core") === "core"
            ? "border-[var(--ed-accent-chords)]/25 bg-[var(--ed-accent-chords)]/10 text-[var(--ed-accent-chords)]"
            : "border-white/8 bg-white/[0.04] text-white/45"
        }`}>
          {(instrumentMeta?.reliability ?? "core") === "core" ? "CORE" : "GM COLOR"}
        </span>

        <Sep />

        {/* Sound preset selector */}
        <select
          value={presetIndex}
          onChange={(e) => loadPreset(Number(e.target.value))}
          className={`h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded-md text-[var(--ed-accent-chords)]/70 focus:outline-none appearance-none cursor-pointer hover:border-[var(--ed-accent-chords)]/30 transition-colors min-w-[90px] ${instrument !== "_synth_" ? "opacity-40 cursor-not-allowed" : ""}`}
          disabled={instrument !== "_synth_"}
        >
          {Object.entries(CHORDS_PRESET_GROUPS).map(([label, items]) => (
            <optgroup key={label} label={label}>
              {items.map(({ preset, index }) => (
                <option key={`chords-preset-${label}-${index}`} value={index}>{preset.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <span className={`h-6 inline-flex items-center rounded-full border px-2 text-[8px] font-bold tracking-[0.14em] ${
          isSignaturePreset
            ? "border-[var(--ed-accent-chords)]/25 bg-[var(--ed-accent-chords)]/10 text-[var(--ed-accent-chords)]"
            : "border-white/8 bg-white/[0.04] text-white/45"
        }`}>
          {isSignaturePreset ? "CORE" : "HIDDEN"}
        </span>

        <Sep />

        {/* Root + Scale */}
        <Sel value={rootName} options={ROOT_NOTES}
          onChange={(v) => { const i = ROOT_NOTES.indexOf(v); if (i >= 0) setRootNote(48 + i, v); }} />
        <Sel value={scaleName} options={SCALE_NAMES} onChange={setScale} />

        <Sep />

        {/* Synth Type: SUBTR / WAVE */}
        <WaveBtn
          active={params.synthType !== "wavetable"}
          onClick={() => setParam("synthType", "subtractive")}
          label="SUBTR"
        />
        <WaveBtn
          active={params.synthType === "wavetable"}
          onClick={() => setParam("synthType", "wavetable")}
          label="WAVE"
        />

        {/* Wavetable selector — only visible when WAVE active */}
        {params.synthType === "wavetable" && WAVETABLE_NAMES.map((wt) => (
          <WaveBtn
            key={wt}
            active={params.wavetable === wt}
            onClick={() => setParam("wavetable", wt)}
            label={wt.toUpperCase().slice(0, 6)}
          />
        ))}

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

        {/* Filter Model */}
        {(["lpf", "ladder", "steiner-lp"] as const).map((m) => (
          <button key={m} onClick={() => setParam("filterModel", m)}
            className={`px-1.5 h-5 text-[7px] font-bold rounded transition-all ${
              params.filterModel === m ? "bg-[var(--ed-accent-blue)]/20 text-[var(--ed-accent-blue)]" : "text-white/20 hover:text-white/40"
            }`}>{m === "lpf" ? "12dB" : m === "ladder" ? "MOOG" : "STNR"}</button>
        ))}

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

      {/* Compact Knobs Row — show synth or Soundfont knobs based on instrument */}
      {instrument === "_synth_" ? (
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
      ) : (
        <SoundFontKnobs channel={13} color={CHORDS_COLOR} />
      )}

      {/* Row 2: Pages + length */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-white/5">
        <div className="flex gap-1">
          {pageNumbers.map((page) => (
            <button key={`page-tab-${page}`} onClick={() => setSelectedPage(page)}
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
        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => setGlobalOctave(globalOctave - 1)}
            disabled={globalOctave <= -2}
            className="w-5 h-5 rounded-md text-[10px] font-bold bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-white hover:bg-[var(--ed-bg-elevated)] disabled:opacity-30 transition-all">&minus;</button>
          <span className={`text-[10px] font-mono min-w-[32px] text-center font-bold tabular-nums ${globalOctave !== 0 ? "text-[var(--ed-accent-chords)]" : "text-[var(--ed-text-muted)]"}`}>
            {globalOctave > 0 ? `+${globalOctave}` : globalOctave}
          </span>
          <button onClick={() => setGlobalOctave(globalOctave + 1)}
            disabled={globalOctave >= 2}
            className="w-5 h-5 rounded-md text-[10px] font-bold bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-white hover:bg-[var(--ed-bg-elevated)] disabled:opacity-30 transition-all">+</button>
          <span className="text-[7px] text-[var(--ed-text-muted)] font-bold">OCT</span>
        </div>
        <div className="flex-1" />
        <span className="hidden lg:inline text-[7px] text-white/12">click = select &middot; Shift + ↑/↓ = octave &middot; TYPE buttons = chord &middot; drag = pitch &middot; drag bright edge = note length &middot; rclick = cycle &middot; alt = legato tie</span>
      </div>

      {/* Piano Roll + Automation */}
      <div className="flex gap-1.5 px-3 py-1.5 h-20 sm:h-28" onPointerMove={handleDurationDragMove} onPointerUp={handleDurationDragEnd}>
      <div className="flex gap-[1px] flex-1 min-w-0">
        {Array.from({ length: 16 }, (_, i) => {
          const absStep = pageOffset + i;
          const step = steps[absStep]!;
          const isCurrent = isPlaying && currentStep === absStep;
          const isActive = step.active && absStep < length;
          const noteHeight = isActive ? Math.max(14, (step.note / maxNote) * 100) : 0;
          const midi = isActive ? scaleNote(rootNote, scaleName, step.note, step.octave + globalOctave) : 0;
          const prevStep = absStep > 0 ? steps[absStep - 1] : null;
          const isTiedFromPrev = isActive && step.tie && prevStep?.active;
          const isBeat = i % 4 === 0;
          const beyondLength = absStep >= length;
          const label = isActive ? chordLabel(midi, step.chordType) : "";
          const isSelected = selectedStep === absStep;
          const isInDragRange = durationDrag && absStep > durationDrag.sourceStep && absStep <= durationDrag.endStep;
          let noteLength = Math.max(1, step.gateLength ?? 1);
          if (isActive && !isTiedFromPrev && (step.gateLength ?? 1) <= 1) {
            for (let j = absStep + 1; j < length; j++) {
              const next = steps[j]!;
              if (!next.active || !next.tie) break;
              noteLength += 1;
            }
          }
          const visibleLength = Math.max(1, Math.min(noteLength, 16 - i, length - absStep));

          return (
            <div key={i}
              ref={(el) => { if (el) stepElRefs.current.set(absStep, el); else stepElRefs.current.delete(absStep); }}
              className={`flex-1 flex flex-col justify-end min-w-0 relative ${beyondLength ? "opacity-25" : ""} ${isSelected && isActive ? "ring-1 ring-[var(--ed-accent-chords)]/50 rounded-sm" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); handleMouseDown(e, absStep); }}
              onPointerDown={(e) => handleDurationDragStart(e, absStep)}
              onContextMenu={(e) => { e.preventDefault(); if (isActive) cycleChordType(absStep); }}
              onAuxClick={(e) => { if (e.button === 1 && isActive) { e.preventDefault(); cycleOctave(absStep); } }}>
              {isBeat && <div className="absolute top-0 bottom-0 left-0 w-px bg-white/[0.04]" />}
              {isCurrent && (
                <div className="absolute top-0 left-0 right-0 h-[2px] rounded-full"
                  style={{ background: "linear-gradient(90deg, var(--ed-accent-chords), transparent)", boxShadow: "0 0 8px rgba(167,139,250,0.4)" }} />
              )}
              {isActive && !isTiedFromPrev && visibleLength > 1 && (
                <div
                  className="absolute left-[2px] rounded-[6px] pointer-events-none z-0"
                  style={{
                    bottom: 18,
                    height: `max(16px, ${noteHeight}%)`,
                    width: `calc(${visibleLength * 100}% + ${(visibleLength - 1)}px - 4px)`,
                    background: "linear-gradient(90deg, rgba(167,139,250,0.55) 0%, rgba(167,139,250,0.32) 82%, rgba(167,139,250,0.16) 100%)",
                    boxShadow: "0 0 0 1px rgba(167,139,250,0.24) inset, 0 0 12px rgba(167,139,250,0.12)",
                  }}
                />
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
                  overflow: isActive && !isTiedFromPrev && visibleLength > 1 ? "visible" : "hidden",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.055)"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}>
                {isActive && <span className="text-[7px] font-bold font-mono text-white/90 leading-none drop-shadow-sm truncate max-w-full px-px">{label}</span>}
                {isActive && !isTiedFromPrev && noteLength > 1 && (
                  <span className="absolute right-[8px] top-[3px] text-[7px] font-black text-black/55 leading-none pointer-events-none">
                    {noteLength}
                  </span>
                )}
                {isActive && !isTiedFromPrev && (
                  <div className="absolute right-0 top-0 bottom-0 w-[14px] cursor-e-resize rounded-r group/handle"
                    style={{
                      background: noteLength > 1
                        ? "linear-gradient(90deg, transparent, rgba(168,85,247,0.4))"
                        : "linear-gradient(90deg, transparent, rgba(255,255,255,0.12))",
                    }}>
                    <div className="absolute right-[2px] top-[20%] bottom-[20%] w-[2px] rounded-full bg-white/40 group-hover/handle:bg-white/70 transition-colors" />
                  </div>
                )}
                {isInDragRange && !isActive && (
                  <div className="absolute inset-0 rounded-sm" style={{ backgroundColor: "rgba(34,211,238,0.25)" }} />
                )}
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
      <ChordsAutomationLaneWrapper
        params={CHORDS_AUTO_PARAMS}
        selectedParam={automationParam}
        values={automationData[automationParam] ?? []}
        length={length}
        pageOffset={pageOffset}
        isPlaying={isPlaying}
        color="var(--ed-accent-chords)"
        onSelectParam={setAutomationParam}
        onChange={(step, value) => setAutomationValue(automationParam, step, value)}
      />
      </div>
      <div className="px-3 pb-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-black tracking-[0.16em] text-[var(--ed-accent-chords)]">VELOCITY LANE</span>
            <span className="text-[7px] text-white/22">draw dynamics without zoom</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[7px] text-white/25">drag bars</span>
            <button
              onClick={() => setVelocityLaneExpanded((prev) => !prev)}
              className={`h-5 rounded-full border px-2 text-[7px] font-bold tracking-[0.14em] transition-colors ${
                velocityLaneExpanded
                  ? "border-[var(--ed-accent-chords)]/30 bg-[var(--ed-accent-chords)]/12 text-[var(--ed-accent-chords)]"
                  : "border-white/8 bg-white/[0.03] text-white/45 hover:text-white/70"
              }`}
            >
              {velocityLaneExpanded ? "COMPACT" : "LARGE"}
            </button>
          </div>
        </div>
        <div className="flex gap-1.5">
          <div className={`relative flex flex-1 min-w-0 gap-[1px] rounded-lg border border-white/6 bg-black/20 px-1.5 pb-1.5 pt-4 ${velocityLaneExpanded ? "h-24" : "h-14"}`}>
            <div className="pointer-events-none absolute inset-x-1.5 top-4 bottom-1.5">
              {[0.2, 0.6, 1].map((mark) => (
                <div
                  key={mark}
                  className="absolute inset-x-0 border-t border-dashed border-white/8"
                  style={{ bottom: `${mark * 100}%` }}
                />
              ))}
            </div>
            <div className="pointer-events-none absolute left-1.5 top-1 flex items-center gap-3 text-[7px] font-bold tracking-[0.12em] text-white/20">
              <span>100</span>
              <span>60</span>
              <span>20</span>
            </div>
            <ChordsVelocityLane
              steps={steps}
              length={length}
              pageOffset={pageOffset}
              velocityLaneExpanded={velocityLaneExpanded}
              isPlaying={isPlaying}
              onDraw={handleVelocityDraw}
            />
          </div>
          <div className="hidden sm:block w-32 shrink-0" />
        </div>
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
      {options.map((o) => <option key={`chords-sel-${o}`} value={o}>{o}</option>)}
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
