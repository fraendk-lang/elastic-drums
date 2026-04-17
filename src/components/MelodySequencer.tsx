/**
 * Melody Sequencer — Piano-roll with pages, presets, melody agent, CLR
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMelodyStore, MELODY_PRESETS, MELODY_STRATEGIES, MELODY_SIGNATURE_PRESET_NAMES, LAYER_MODES } from "../store/melodyStore";
import { MELODY_INSTRUMENTS, findInstrumentOption } from "../audio/SoundFontEngine";
import { SCALES, ROOT_NOTES, scaleNote } from "../audio/BassEngine";
import { useDrumStore } from "../store/drumStore";
import { Knob } from "./Knob";
import { SoundFontKnobs } from "./SoundFontKnobs";
import { AutomationLane, type AutomationParam } from "./AutomationLane";

const MELODY_AUTO_PARAMS: AutomationParam[] = [
  { id: "cutoff", label: "CUT", min: 200, max: 8000 },
  { id: "resonance", label: "RES", min: 0, max: 30 },
  { id: "envMod", label: "ENV", min: 0, max: 100 },
  { id: "decay", label: "DEC", min: 50, max: 800 },
  { id: "accent", label: "ACC", min: 0, max: 100 },
  { id: "distortion", label: "DRV", min: 0, max: 100 },
];

const SCALE_NAMES = Object.keys(SCALES);
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const VALID_LENGTHS = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
const MELODY_COLOR = "var(--ed-accent-melody)";
const MELODY_INSTRUMENT_GROUPS = MELODY_INSTRUMENTS.reduce<Record<string, typeof MELODY_INSTRUMENTS>>((groups, instrument) => {
  const key = instrument.reliability === "core" ? "Reliable" : "Optional GM";
  groups[key] ??= [];
  groups[key].push(instrument);
  return groups;
}, {});
const MELODY_PRESET_GROUPS = {
  All: MELODY_PRESETS.map((preset, index) => ({ preset, index })),
};

function midiToName(midi: number): string {
  return NOTE_NAMES[midi % 12] + String(Math.floor(midi / 12) - 1);
}

export function MelodySequencer() {
  const {
    steps, length, currentStep, selectedPage, rootNote, rootName, scaleName, params, presetIndex, strategyIndex, instrument,
    automationData, automationParam,
    globalOctave,
    toggleStep, setStepNote, setStepVelocity, toggleAccent, toggleSlide, toggleTie, setGateLength, setStepOctave, cycleOctave,
    setRootNote, setGlobalOctave, setScale, setParam, setLength, setSelectedPage,
    clearSteps, generateMelodiline, nextStrategy, prevStrategy,
    loadPreset, setInstrument,
    setAutomationValue, setAutomationParam,
    arp, humanize, setArp, setHumanize,
    layerMode, layerVelocity, setLayerMode, setLayerVelocity,
  } = useMelodyStore();

  const isPlaying = useDrumStore((s) => s.isPlaying);
  const dragRef = useRef<{ step: number; startY: number; startNote: number } | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [durationDrag, setDurationDrag] = useState<{ sourceStep: number; endStep: number } | null>(null);
  const stepElRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [velocityLaneExpanded, setVelocityLaneExpanded] = useState(true);
  // Knobs always visible (no collapse)

  const pageOffset = selectedPage * 16;
  const totalPages = Math.max(1, Math.ceil(length / 16));
  const pageNumbers = Array.from({ length: totalPages }, (_, page) => page);
  const instrumentMeta = findInstrumentOption(MELODY_INSTRUMENTS, instrument);
  const currentPresetName = MELODY_PRESETS[presetIndex]?.name ?? "Preset";
  const isSignaturePreset = MELODY_SIGNATURE_PRESET_NAMES.includes(currentPresetName as typeof MELODY_SIGNATURE_PRESET_NAMES[number]);
  const strategyName = MELODY_STRATEGIES[strategyIndex]?.name ?? "Random";

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
      if (e.shiftKey) { e.preventDefault(); toggleSlide(absStep); return; }
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
  }, [steps, toggleStep, setStepNote, toggleSlide, toggleTie, cycleOctave]);

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
    <div className="border-t border-[var(--ed-accent-melody)]/15 bg-gradient-to-b from-[#0d0a0c] to-[#0a080a]">
      {/* Row 1: Main controls */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 border-b border-white/5">
        {/* Title */}
        <span className="text-[10px] font-black tracking-[0.15em] text-[var(--ed-accent-melody)] shrink-0" style={{ textShadow: "0 0 12px rgba(244,114,182,0.2)" }}>MELODY</span>

        <Sep />

        {/* Instrument selector */}
        <select
          value={instrument}
          onChange={(e) => setInstrument(e.target.value)}
          className="h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded-md text-[var(--ed-accent-melody)]/70 focus:outline-none appearance-none cursor-pointer hover:border-[var(--ed-accent-melody)]/30 transition-colors min-w-[90px]"
        >
          {Object.entries(MELODY_INSTRUMENT_GROUPS).map(([label, items]) => (
            <optgroup key={label} label={label}>
              {items.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <span className={`h-6 inline-flex items-center rounded-full border px-2 text-[8px] font-bold tracking-[0.14em] ${
          (instrumentMeta?.reliability ?? "core") === "core"
            ? "border-[var(--ed-accent-melody)]/25 bg-[var(--ed-accent-melody)]/10 text-[var(--ed-accent-melody)]"
            : "border-white/8 bg-white/[0.04] text-white/45"
        }`}>
          {(instrumentMeta?.reliability ?? "core") === "core" ? "CORE" : "GM COLOR"}
        </span>

        <Sep />

        {/* Sound preset selector */}
        <select
          value={presetIndex}
          onChange={(e) => loadPreset(Number(e.target.value))}
          className={`h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded-md text-[var(--ed-accent-melody)]/70 focus:outline-none appearance-none cursor-pointer hover:border-[var(--ed-accent-melody)]/30 transition-colors min-w-[90px] ${instrument !== "_synth_" ? "opacity-40 cursor-not-allowed" : ""}`}
          disabled={instrument !== "_synth_"}
        >
          {Object.entries(MELODY_PRESET_GROUPS).map(([label, items]) => (
            <optgroup key={label} label={label}>
              {items.map(({ preset, index }) => (
                <option key={`melody-preset-${label}-${index}`} value={index}>{preset.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <span className={`h-6 inline-flex items-center rounded-full border px-2 text-[8px] font-bold tracking-[0.14em] ${
          isSignaturePreset
            ? "border-[var(--ed-accent-melody)]/25 bg-[var(--ed-accent-melody)]/10 text-[var(--ed-accent-melody)]"
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

        {/* Waveform */}
        <WaveBtn active={params.waveform === "sawtooth"} onClick={() => setParam("waveform", "sawtooth")} label="SAW" />
        <WaveBtn active={params.waveform === "square"} onClick={() => setParam("waveform", "square")} label="SQR" />
        <WaveBtn active={params.waveform === "triangle"} onClick={() => setParam("waveform", "triangle")} label="TRI" />
        <WaveBtn active={params.waveform === "wavetable"} onClick={() => setParam("waveform", "wavetable")} label="WT" />
        {params.waveform === "wavetable" && (
          <select
            value={params.wavetable ?? "harmonic"}
            onChange={(e) => setParam("wavetable", e.target.value)}
            className="h-6 px-1.5 text-[8px] bg-black/30 border border-white/15 rounded text-white/70 cursor-pointer"
          >
            <option value="harmonic">Harmonic</option>
            <option value="bright-saw">Bright Saw</option>
            <option value="hollow">Hollow</option>
            <option value="glass">Glass</option>
            <option value="vocal">Vocal</option>
            <option value="pulse-25">Pulse 25%</option>
            <option value="digital">Digital</option>
            <option value="warm-stack">Warm Stack</option>
          </select>
        )}

        <Sep />

        {/* Synth Type */}
        {(["subtractive", "fm", "am", "pluck"] as const).map((st) => {
          const labels: Record<string, string> = { subtractive: "SUB", fm: "FM", am: "AM", pluck: "PLK" };
          return <button key={st} onClick={() => setParam("synthType", st)}
            className={`px-1.5 h-5 text-[7px] font-bold rounded transition-all ${
              params.synthType === st ? "bg-[var(--ed-accent-melody)]/20 text-[var(--ed-accent-melody)]" : "text-white/20 hover:text-white/40"
            }`}>{labels[st]}</button>;
        })}

        <Sep />

        {/* Filter mode */}
        {(["lowpass", "highpass", "bandpass", "notch"] as const).map((ft) => {
          const labels: Record<string, string> = { lowpass: "LP", highpass: "HP", bandpass: "BP", notch: "NT" };
          return <button key={ft} onClick={() => setParam("filterType", ft)}
            className={`px-1.5 h-5 text-[7px] font-bold rounded transition-all ${
              params.filterType === ft ? "bg-[var(--ed-accent-blue)]/20 text-[var(--ed-accent-blue)]" : "text-white/20 hover:text-white/40"
            }`}>{labels[ft]}</button>;
        })}

        {/* Filter Model (only shown for subtractive synth) */}
        {params.synthType === "subtractive" && (
          <>
            <Sep />
            {(["lpf", "ladder", "steiner-lp"] as const).map((m) => (
              <button key={m} onClick={() => setParam("filterModel", m)}
                className={`px-1.5 h-5 text-[7px] font-bold rounded transition-all ${
                  params.filterModel === m ? "bg-[var(--ed-accent-blue)]/20 text-[var(--ed-accent-blue)]" : "text-white/20 hover:text-white/40"
                }`}>{m === "lpf" ? "12dB" : m === "ladder" ? "MOOG" : "STNR"}</button>
            ))}
          </>
        )}

        <Sep />

        {/* Legato toggle */}
        <button onClick={() => setParam("legato", !params.legato)}
          className={`px-2.5 h-6 text-[8px] font-bold rounded-md transition-all ${
            params.legato ? "bg-[var(--ed-accent-melody)]/15 text-[var(--ed-accent-melody)]" : "text-white/25 hover:text-white/50 hover:bg-white/5"
          }`}>LEG</button>

        <div className="flex-1" />

        {/* Melody Agent — strategy cycle + generate */}
        <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-md px-1">
          <button onClick={prevStrategy} className="w-4 h-5 text-[8px] text-white/25 hover:text-white/60 transition-colors">&lsaquo;</button>
          <button
            onClick={() => generateMelodiline(strategyIndex)}
            className="h-6 px-2 text-[8px] font-bold text-[var(--ed-accent-melody)]/70 hover:text-[var(--ed-accent-melody)] transition-all"
            title="Generate melody with selected strategy"
          >
            {strategyName}
          </button>
          <button onClick={nextStrategy} className="w-4 h-5 text-[8px] text-white/25 hover:text-white/60 transition-colors">&rsaquo;</button>
        </div>

        <Sep />

        {/* CLR */}
        <div className="flex items-center gap-[2px] relative">
          <button onClick={clearSteps} className="h-6 px-2 text-[7px] font-bold text-white/25 hover:text-red-400/70 hover:bg-white/5 rounded-md transition-all">CLR</button>
        </div>
      </div>

      {/* Compact Knobs Row — show synth or Soundfont knobs based on instrument */}
      {instrument === "_synth_" ? (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/5 overflow-x-auto">
          <Knob value={params.cutoff} min={200} max={8000} defaultValue={2000} label="CUT" color={MELODY_COLOR} size={34} onChange={(v) => setParam("cutoff", v)} />
          <Knob value={params.resonance} min={0} max={30} defaultValue={8} label="RES" color={MELODY_COLOR} size={34} onChange={(v) => setParam("resonance", v)} />
          <Knob value={Math.round(params.envMod * 100)} min={0} max={100} defaultValue={40} label="ENV" color={MELODY_COLOR} size={34} onChange={(v) => setParam("envMod", v / 100)} />
          <Knob value={params.decay} min={50} max={800} defaultValue={150} label="DEC" color={MELODY_COLOR} size={34} onChange={(v) => setParam("decay", v)} />
          <Knob value={Math.round(params.accent * 100)} min={0} max={100} defaultValue={40} label="ACC" color={MELODY_COLOR} size={34} onChange={(v) => setParam("accent", v / 100)} />
          <Knob value={params.slideTime} min={0} max={200} defaultValue={40} label="SLD" color={MELODY_COLOR} size={34} onChange={(v) => setParam("slideTime", v)} />
          <Knob value={Math.round(params.distortion * 100)} min={0} max={100} defaultValue={15} label="DRV" color={MELODY_COLOR} size={34} onChange={(v) => setParam("distortion", v / 100)} />
          <Knob value={Math.round(params.subOsc * 100)} min={0} max={100} defaultValue={10} label="SUB" color={MELODY_COLOR} size={34} onChange={(v) => setParam("subOsc", v / 100)} />
        </div>
      ) : (
        <SoundFontKnobs channel={14} color={MELODY_COLOR} />
      )}

      {/* ── Arp + Humanize strip ── */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1 border-b border-white/5 text-[7px] font-bold tracking-wider">
        {/* ARP section */}
        <span className="text-[var(--ed-accent-melody)]/70">ARP</span>
        {(["off","up","down","updown","downup","converge","diverge","random","chord"] as const).map((m) => (
          <button key={m} onClick={() => setArp("mode", m)}
            className={`px-1.5 h-5 rounded transition-all ${
              arp.mode === m
                ? "bg-[var(--ed-accent-melody)]/25 text-[var(--ed-accent-melody)]"
                : "text-white/25 hover:text-white/55"
            }`}
            title={`Arpeggiator: ${m}`}
          >{m === "off" ? "—" : m.toUpperCase().slice(0,4)}</button>
        ))}

        {arp.mode !== "off" && (
          <>
            <span className="mx-0.5 text-white/15">|</span>
            {(["1/4","1/8","1/8t","1/16","1/16t","1/32"] as const).map((r) => (
              <button key={r} onClick={() => setArp("rate", r)}
                className={`px-1 h-5 rounded transition-all ${
                  arp.rate === r ? "bg-white/15 text-white/90" : "text-white/25 hover:text-white/55"
                }`}
                title={`Rate ${r}`}
              >{r}</button>
            ))}
            <span className="mx-0.5 text-white/15">|</span>
            {[1,2,3,4].map((o) => (
              <button key={o} onClick={() => setArp("octaves", o)}
                className={`w-5 h-5 rounded transition-all ${
                  arp.octaves === o ? "bg-white/15 text-white/90" : "text-white/25 hover:text-white/55"
                }`}
                title={`${o} Oktave${o > 1 ? "n" : ""}`}
              >{o}</button>
            ))}
            <span className="mx-0.5 text-white/15">|</span>
            {(["short","medium","long"] as const).map((g) => (
              <button key={g} onClick={() => setArp("gate", g)}
                className={`px-1 h-5 rounded transition-all ${
                  arp.gate === g ? "bg-white/15 text-white/90" : "text-white/25 hover:text-white/55"
                }`}
                title={`Gate ${g}`}
              >{g[0]!.toUpperCase()}</button>
            ))}
            {/* Compact numeric sliders */}
            <label className="flex items-center gap-1 text-white/40">
              SW
              <input type="range" min={0} max={50} value={Math.round(arp.swing * 100)}
                onChange={(e) => setArp("swing", Number(e.target.value) / 100)}
                className="w-12 accent-[var(--ed-accent-melody)]" title="Swing" />
              <span className="w-5 text-[6px] text-white/50 font-mono">{Math.round(arp.swing * 100)}</span>
            </label>
            <label className="flex items-center gap-1 text-white/40">
              SKIP
              <input type="range" min={0} max={80} value={Math.round(arp.skipProb * 100)}
                onChange={(e) => setArp("skipProb", Number(e.target.value) / 100)}
                className="w-12 accent-[var(--ed-accent-melody)]" title="Skip probability" />
              <span className="w-5 text-[6px] text-white/50 font-mono">{Math.round(arp.skipProb * 100)}</span>
            </label>
            <label className="flex items-center gap-1 text-white/40">
              DECAY
              <input type="range" min={0} max={100} value={Math.round(arp.velDecay * 100)}
                onChange={(e) => setArp("velDecay", Number(e.target.value) / 100)}
                className="w-12 accent-[var(--ed-accent-melody)]" title="Velocity decay per step" />
              <span className="w-5 text-[6px] text-white/50 font-mono">{Math.round(arp.velDecay * 100)}</span>
            </label>
          </>
        )}

        <div className="flex-1" />

        {/* Humanize section */}
        <span className="text-[var(--ed-accent-melody)]/70">HUM</span>
        <label className="flex items-center gap-1 text-white/40">
          T
          <input type="range" min={0} max={100} value={Math.round(humanize.timing * 100)}
            onChange={(e) => setHumanize("timing", Number(e.target.value) / 100)}
            className="w-12 accent-[var(--ed-accent-melody)]" title="Timing jitter (±30ms max)" />
          <span className="w-5 text-[6px] text-white/50 font-mono">{Math.round(humanize.timing * 100)}</span>
        </label>
        <label className="flex items-center gap-1 text-white/40">
          V
          <input type="range" min={0} max={100} value={Math.round(humanize.velocity * 100)}
            onChange={(e) => setHumanize("velocity", Number(e.target.value) / 100)}
            className="w-12 accent-[var(--ed-accent-melody)]" title="Velocity jitter" />
          <span className="w-5 text-[6px] text-white/50 font-mono">{Math.round(humanize.velocity * 100)}</span>
        </label>
        <label className="flex items-center gap-1 text-white/40">
          P
          <input type="range" min={20} max={100} value={Math.round(humanize.probability * 100)}
            onChange={(e) => setHumanize("probability", Number(e.target.value) / 100)}
            className="w-12 accent-[var(--ed-accent-melody)]" title="Probability (note plays)" />
          <span className="w-6 text-[6px] text-white/50 font-mono">{Math.round(humanize.probability * 100)}%</span>
        </label>

        <span className="mx-1 h-3 w-px bg-white/10" />

        {/* Layer Mode — doubled harmonies */}
        <span className="text-[var(--ed-accent-melody)]/70">LAYER</span>
        {LAYER_MODES.map((m) => (
          <button key={m.id} onClick={() => setLayerMode(m.id)}
            title={m.desc}
            className={`px-1.5 h-5 rounded transition-all ${
              layerMode === m.id
                ? "bg-[var(--ed-accent-melody)]/25 text-[var(--ed-accent-melody)]"
                : "text-white/25 hover:text-white/55"
            }`}
          >{m.label}</button>
        ))}
        {layerMode !== "off" && (
          <label className="flex items-center gap-1 text-white/40">
            MIX
            <input type="range" min={0} max={100} value={Math.round(layerVelocity * 100)}
              onChange={(e) => setLayerVelocity(Number(e.target.value) / 100)}
              className="w-12 accent-[var(--ed-accent-melody)]"
              title="Layer volume (relative to main voice)" />
            <span className="w-5 text-[6px] text-white/50 font-mono">{Math.round(layerVelocity * 100)}</span>
          </label>
        )}
      </div>

      {/* Row 2: Pages + length */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-white/5">
        <div className="flex gap-1">
          {pageNumbers.map((page) => (
            <button key={`page-tab-${page}`} onClick={() => setSelectedPage(page)}
              className={`px-2 py-0.5 text-[9px] font-medium rounded-md transition-all ${
                selectedPage === page
                  ? "bg-[var(--ed-accent-melody)] text-black font-bold shadow-[0_0_8px_rgba(244,114,182,0.2)]"
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
              <span className="text-[10px] font-mono text-[var(--ed-accent-melody)] min-w-[24px] text-center font-bold tabular-nums">{length}</span>
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
          <span className={`text-[10px] font-mono min-w-[32px] text-center font-bold tabular-nums ${globalOctave !== 0 ? "text-[var(--ed-accent-melody)]" : "text-[var(--ed-text-muted)]"}`}>
            {globalOctave > 0 ? `+${globalOctave}` : globalOctave}
          </span>
          <button onClick={() => setGlobalOctave(globalOctave + 1)}
            disabled={globalOctave >= 2}
            className="w-5 h-5 rounded-md text-[10px] font-bold bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-white hover:bg-[var(--ed-bg-elevated)] disabled:opacity-30 transition-all">+</button>
          <span className="text-[7px] text-[var(--ed-text-muted)] font-bold">OCT</span>
        </div>
        <div className="flex-1" />
        <span className="hidden lg:inline text-[7px] text-white/12">click = select &middot; Shift + ↑/↓ = octave &middot; drag = pitch &middot; drag bright edge = note length &middot; rclick = accent &middot; shift = slide &middot; alt = legato tie</span>
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
          const isInDragRange = durationDrag && absStep > durationDrag.sourceStep && absStep <= durationDrag.endStep;
          const isSelected = selectedStep === absStep;
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
              className={`flex-1 flex flex-col justify-end min-w-0 relative ${beyondLength ? "opacity-25" : ""} ${isSelected && isActive ? "ring-1 ring-[var(--ed-accent-melody)]/55 rounded-sm" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); handleMouseDown(e, absStep); }}
              onPointerDown={(e) => handleDurationDragStart(e, absStep)}
              onContextMenu={(e) => { e.preventDefault(); if (isActive) toggleAccent(absStep); }}
              onAuxClick={(e) => { if (e.button === 1 && isActive) { e.preventDefault(); cycleOctave(absStep); } }}>
              {isBeat && <div className="absolute top-0 bottom-0 left-0 w-px bg-white/[0.04]" />}
              {isCurrent && (
                <div className="absolute top-0 left-0 right-0 h-[2px] rounded-full"
                  style={{ background: "linear-gradient(90deg, var(--ed-accent-melody), transparent)", boxShadow: "0 0 8px rgba(244,114,182,0.4)" }} />
              )}
              {isActive && !isTiedFromPrev && visibleLength > 1 && (
                <div
                  className="absolute left-[2px] rounded-[6px] pointer-events-none z-0"
                  style={{
                    bottom: 18,
                    height: `max(16px, ${noteHeight}%)`,
                    width: `calc(${visibleLength * 100}% + ${(visibleLength - 1)}px - 4px)`,
                    background: "linear-gradient(90deg, rgba(244,114,182,0.55) 0%, rgba(244,114,182,0.32) 82%, rgba(244,114,182,0.16) 100%)",
                    boxShadow: "0 0 0 1px rgba(244,114,182,0.24) inset, 0 0 12px rgba(244,114,182,0.12)",
                  }}
                />
              )}
              <div className={`w-full transition-all duration-75 flex flex-col items-center justify-end pb-0.5 select-none ${isActive ? "cursor-ns-resize" : "cursor-pointer rounded-sm"}`}
                style={{
                  height: isActive ? `${noteHeight}%` : "100%", minHeight: isActive ? 20 : undefined,
                  background: isActive
                    ? step.accent ? "linear-gradient(180deg, rgba(244,114,182,0.85), rgba(244,114,182,0.55))"
                    : step.tie ? "linear-gradient(180deg, rgba(34,211,238,0.55), rgba(34,211,238,0.35))"
                    : "linear-gradient(180deg, rgba(244,114,182,0.55), rgba(244,114,182,0.3))"
                    : "rgba(255,255,255,0.025)",
                  borderLeft: step.slide && isActive ? "3px solid rgba(96,165,250,0.8)" : "none",
                  borderTopLeftRadius: isTiedFromPrev ? 0 : 3, borderTopRightRadius: 3, borderBottomLeftRadius: 0,
                  marginLeft: isTiedFromPrev ? -1 : 0,
                  boxShadow: isActive && isCurrent ? "0 0 10px rgba(244,114,182,0.25)" : isActive ? "inset 0 1px 0 rgba(255,255,255,0.05)" : "none",
                  overflow: isActive && !isTiedFromPrev && visibleLength > 1 ? "visible" : "hidden",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.055)"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}>
                {isActive && <span className="text-[8px] font-bold font-mono text-white/90 leading-none drop-shadow-sm">{midiToName(midi)}</span>}
                {isActive && !isTiedFromPrev && noteLength > 1 && (
                  <span className="absolute right-[8px] top-[3px] text-[7px] font-black text-black/55 leading-none pointer-events-none">
                    {noteLength}
                  </span>
                )}
                {isActive && !isTiedFromPrev && (
                  <div className="absolute right-0 top-0 bottom-0 w-[14px] cursor-e-resize rounded-r group/handle"
                    style={{
                      background: noteLength > 1
                        ? "linear-gradient(90deg, transparent, rgba(251,146,60,0.4))"
                        : "linear-gradient(90deg, transparent, rgba(255,255,255,0.12))",
                    }}>
                    <div className="absolute right-[2px] top-[20%] bottom-[20%] w-[2px] rounded-full bg-white/40 group-hover/handle:bg-white/70 transition-colors" />
                  </div>
                )}
                {isInDragRange && !isActive && (
                  <div className="absolute inset-0 rounded-sm" style={{ backgroundColor: "rgba(34,211,238,0.25)" }} />
                )}
              </div>
              <div className={`text-center text-[7px] font-mono mt-0.5 ${isCurrent ? "text-[var(--ed-accent-melody)] font-bold" : isBeat ? "text-white/15" : "text-white/8"}`}>{absStep + 1}</div>
              {isActive && (
                <div className="flex justify-center gap-[2px] mt-[1px] min-h-[8px]">
                  {step.accent && <div className="w-2 h-2 rounded-full bg-red-400/80" />}
                  {step.slide && <div className="w-2 h-2 rounded-full bg-blue-400/80" />}
                  {step.tie && <div className="w-2 h-2 rounded-full bg-cyan-400/80" />}
                  {step.octave !== 0 && <span className="text-[7px] font-bold text-purple-400/80 leading-none">{step.octave > 0 ? "+1" : "-1"}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <AutomationLane
        params={MELODY_AUTO_PARAMS}
        selectedParam={automationParam}
        values={automationData[automationParam] ?? []}
        length={length}
        pageOffset={pageOffset}
        currentStep={currentStep}
        isPlaying={isPlaying}
        color="var(--ed-accent-melody)"
        onSelectParam={setAutomationParam}
        onChange={(step, value) => setAutomationValue(automationParam, step, value)}
      />
      </div>
      <div className="px-3 pb-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-black tracking-[0.16em] text-[var(--ed-accent-melody)]">VELOCITY LANE</span>
            <span className="text-[7px] text-white/22">draw dynamics without zoom</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[7px] text-white/25">drag bars</span>
            <button
              onClick={() => setVelocityLaneExpanded((prev) => !prev)}
              className={`h-5 rounded-full border px-2 text-[7px] font-bold tracking-[0.14em] transition-colors ${
                velocityLaneExpanded
                  ? "border-[var(--ed-accent-melody)]/30 bg-[var(--ed-accent-melody)]/12 text-[var(--ed-accent-melody)]"
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
            {Array.from({ length: 16 }, (_, i) => {
              const absStep = pageOffset + i;
              const step = steps[absStep]!;
              const velocity = step.velocity ?? (step.accent ? 1 : 0.7);
              const isCurrent = isPlaying && currentStep === absStep;
              return (
                <div
                  key={`vel-${i}`}
                  className={`relative flex-1 rounded-md border cursor-ns-resize transition-colors ${absStep >= length ? "opacity-25" : ""} ${isCurrent ? "border-[var(--ed-accent-melody)]/45 bg-[var(--ed-accent-melody)]/[0.06]" : "border-white/6 bg-white/[0.025] hover:bg-white/[0.045]"}`}
                  onMouseDown={(e) => handleVelocityDraw(e, absStep)}
                  onMouseMove={(e) => {
                    if (e.buttons === 1) handleVelocityDraw(e, absStep);
                  }}
                >
                  {step.active && (
                    <div
                      className="absolute inset-x-[3px] bottom-[3px] rounded-sm shadow-[0_0_14px_rgba(244,114,182,0.16)]"
                      style={{
                        height: `${Math.max(12, velocity * 100)}%`,
                        background: step.accent
                          ? "linear-gradient(180deg, rgba(248,113,113,0.9), rgba(244,114,182,0.7))"
                          : "linear-gradient(180deg, rgba(251,207,232,0.9), rgba(244,114,182,0.45))",
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
      className="h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded-md text-white/60 focus:outline-none appearance-none cursor-pointer hover:border-[var(--ed-accent-melody)]/30 transition-colors">
      {options.map((o) => <option key={`melody-sel-${o}`} value={o}>{o}</option>)}
    </select>
  );
}

function WaveBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 h-6 text-[8px] font-bold rounded-md transition-all ${
        active ? "bg-[var(--ed-accent-melody)]/15 text-[var(--ed-accent-melody)] shadow-[0_0_8px_rgba(244,114,182,0.1)]" : "text-white/25 hover:text-white/50 hover:bg-white/5"
      }`}>
      {label}
    </button>
  );
}
