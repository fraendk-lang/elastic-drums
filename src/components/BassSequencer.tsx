/**
 * Bass Sequencer — Piano-roll with pages, presets, bassline agent, save/load
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { useBassStore, BASS_PRESETS, BASSLINE_STRATEGIES, BASS_SIGNATURE_PRESET_NAMES } from "../store/bassStore";
import { BASS_INSTRUMENTS, findInstrumentOption } from "../audio/SoundFontEngine";
import { SCALES, ROOT_NOTES, scaleNote } from "../audio/BassEngine";
import { useDrumStore } from "../store/drumStore";
import { Knob } from "./Knob";
import { SoundFontKnobs } from "./SoundFontKnobs";
import { AutomationLane, type AutomationParam } from "./AutomationLane";
import { saveBassPattern, listBassPatterns, deleteBassPattern, type StoredBassPattern } from "../storage/patternStorage";

const SCALE_NAMES = Object.keys(SCALES);
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const VALID_LENGTHS = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
const BASS_COLOR = "var(--ed-accent-bass)";
const BASS_INSTRUMENT_GROUPS = BASS_INSTRUMENTS.reduce<Record<string, typeof BASS_INSTRUMENTS>>((groups, instrument) => {
  const key = instrument.reliability === "core" ? "Reliable" : "Optional GM";
  groups[key] ??= [];
  groups[key].push(instrument);
  return groups;
}, {});
const BASS_PRESET_GROUPS = {
  All: BASS_PRESETS.map((preset, index) => ({ preset, index })),
};

const BASS_AUTO_PARAMS: AutomationParam[] = [
  { id: "cutoff", label: "CUT", min: 200, max: 8000 },
  { id: "resonance", label: "RES", min: 0, max: 30 },
  { id: "envMod", label: "ENV", min: 0, max: 100 },
  { id: "decay", label: "DEC", min: 50, max: 800 },
  { id: "accent", label: "ACC", min: 0, max: 100 },
  { id: "distortion", label: "DRV", min: 0, max: 100 },
];

function midiToName(midi: number): string {
  return NOTE_NAMES[midi % 12] + String(Math.floor(midi / 12) - 1);
}

export function BassSequencer() {
  const {
    steps, length, currentStep, selectedPage, rootNote, rootName, scaleName, params, presetIndex, strategyIndex, instrument,
    automationData, automationParam,
    globalOctave,
    toggleStep, setStepNote, setStepVelocity, toggleAccent, toggleSlide, toggleTie, setGateLength, setStepOctave, cycleOctave,
    setRootNote, setGlobalOctave, setScale, setParam, setLength, setSelectedPage,
    clearSteps, generateBassline, nextStrategy, prevStrategy,
    loadPreset, loadBassPattern, setInstrument,
    setAutomationValue, setAutomationParam,
  } = useBassStore();

  const isPlaying = useDrumStore((s) => s.isPlaying);
  const dragRef = useRef<{ step: number; startY: number; startNote: number } | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [durationDrag, setDurationDrag] = useState<{ sourceStep: number; endStep: number } | null>(null);
  const stepElRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [loadOpen, setLoadOpen] = useState(false);
  const [savedPatterns, setSavedPatterns] = useState<StoredBassPattern[]>([]);
  const [clipEditorExpanded, setClipEditorExpanded] = useState(false);
  const [velocityLaneExpanded, setVelocityLaneExpanded] = useState(true);

  const pageOffset = selectedPage * 16;
  const totalPages = Math.max(1, Math.ceil(length / 16));
  const pageNumbers = Array.from({ length: totalPages }, (_, page) => page);
  const strategyName = BASSLINE_STRATEGIES[strategyIndex]?.name ?? "Random";
  const activeSteps = steps.slice(0, length).filter((step) => step.active).length;
  const pageActiveSteps = steps.slice(pageOffset, pageOffset + 16).filter((step) => step.active).length;
  const longestNote = steps.slice(0, length).reduce((max, step) => Math.max(max, step.gateLength ?? 1), 1);
  const instrumentMeta = findInstrumentOption(BASS_INSTRUMENTS, instrument);
  const instrumentName = instrumentMeta?.name ?? "Internal Synth";
  const instrumentReliability = instrumentMeta?.reliability ?? "core";
  const currentPresetName = BASS_PRESETS[presetIndex]?.name ?? "Preset";
  const isSignaturePreset = BASS_SIGNATURE_PRESET_NAMES.includes(currentPresetName as typeof BASS_SIGNATURE_PRESET_NAMES[number]);

  // Load saved patterns list
  const refreshSaved = useCallback(async () => {
    setSavedPatterns(await listBassPatterns());
  }, []);

  useEffect(() => { if (loadOpen) refreshSaved(); }, [loadOpen, refreshSaved]);

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

  const handleSave = useCallback(async () => {
    const name = saveName.trim() || `Bass ${new Date().toLocaleTimeString()}`;
    const { steps, length, params, rootNote, rootName, scaleName } = useBassStore.getState();
    await saveBassPattern(name, { steps, length, params, rootNote, rootName, scaleName });
    setSaveName("");
    setSaveOpen(false);
  }, [saveName]);

  const handleLoad = useCallback((p: StoredBassPattern) => {
    loadBassPattern({ steps: p.steps, length: p.length, params: p.params, rootNote: p.rootNote, rootName: p.rootName, scaleName: p.scaleName });
    setLoadOpen(false);
  }, [loadBassPattern]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteBassPattern(id);
    refreshSaved();
  }, [refreshSaved]);

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
        if (Math.abs(dy) > 3) didDrag = true; // Threshold to distinguish click from drag
        if (didDrag) {
          const newNote = Math.max(0, Math.min(14, dragRef.current.startNote + Math.round(dy / 8)));
          setStepNote(dragRef.current.step, newNote);
        }
      };
      const handleUp = () => {
        // If no drag happened, toggle step off
        if (!didDrag && dragRef.current) toggleStep(dragRef.current.step);
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    }
  }, [steps, toggleStep, setStepNote, toggleSlide, toggleTie, cycleOctave]);

  // Duration drag: right edge of note → drag right to set actual gate length
  const handleDurationDragStart = useCallback((e: React.PointerEvent, absStep: number) => {
    const s = steps[absStep];
    const prev = absStep > 0 ? steps[absStep - 1] : null;
    const isContinuationTie = Boolean(s?.active && s.tie && prev?.active);
    if (!s?.active || isContinuationTie) return; // Only start from source notes

    // Check if pointer is near right edge (last 16px — wider grab area)
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    if (offsetX < rect.width - 16) return;

    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDurationDrag({ sourceStep: absStep, endStep: absStep });
  }, [steps]);

  const handleDurationDragMove = useCallback((e: React.PointerEvent) => {
    if (!durationDrag) return;
    // Find which step column the pointer is over
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
    <div className="border-t border-[var(--ed-accent-bass)]/15 bg-gradient-to-b from-[#0a0d0c] to-[#080a09]">
      <div className="mx-3 mt-2 rounded-xl border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))] px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black tracking-[0.2em] text-[var(--ed-accent-bass)]" style={{ textShadow: "0 0 12px rgba(16,185,129,0.25)" }}>
              BASS CLIP EDITOR
            </span>
            <span className="text-[8px] font-bold tracking-[0.15em] text-white/20">
              MONO LINE / GATE / LEGATO
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[8px] font-bold tracking-[0.12em] text-white/40">
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">{instrumentName}</span>
            <span className={`rounded-full border px-2 py-0.5 ${
              instrumentReliability === "core"
                ? "border-[var(--ed-accent-bass)]/25 bg-[var(--ed-accent-bass)]/10 text-[var(--ed-accent-bass)]"
                : "border-white/8 bg-white/[0.04] text-white/45"
            }`}>
              {instrumentReliability === "core" ? "CORE" : "GM COLOR"}
            </span>
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">{rootName} {scaleName}</span>
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">{activeSteps} NOTES</span>
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">LONGEST {longestNote} STEPS</span>
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">PAGE {selectedPage + 1} · {pageActiveSteps}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[7px] font-bold tracking-[0.14em] text-white/22">
              {clipEditorExpanded ? "FULL OVERVIEW" : "COMPACT VIEW"}
            </span>
            <button
              onClick={() => setClipEditorExpanded((prev) => !prev)}
              className={`h-5 rounded-full border px-2 text-[7px] font-bold tracking-[0.14em] transition-colors ${
                clipEditorExpanded
                  ? "border-[var(--ed-accent-bass)]/30 bg-[var(--ed-accent-bass)]/12 text-[var(--ed-accent-bass)]"
                  : "border-white/8 bg-white/[0.03] text-white/45 hover:text-white/70"
              }`}
            >
              {clipEditorExpanded ? "HIDE" : "SHOW"}
            </button>
          </div>
        </div>

        {clipEditorExpanded ? (
          <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)]">
            <div className="grid grid-cols-4 gap-1.5">
              {pageNumbers.map((page) => {
                const start = page * 16;
                const count = steps.slice(start, start + 16).filter((step) => step.active).length;
                const density = Math.min(1, count / 12);
                return (
                  <button
                    key={`clip-page-${page}`}
                    onClick={() => setSelectedPage(page)}
                    className={`relative overflow-hidden rounded-lg border px-2 py-2 text-left transition-all ${
                      selectedPage === page
                        ? "border-[var(--ed-accent-bass)]/40 bg-[var(--ed-accent-bass)]/10"
                        : "border-white/6 bg-black/20 hover:border-white/12"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] font-black tracking-[0.16em] text-white/70">PAGE {page + 1}</span>
                      <span className="text-[8px] font-mono text-white/35">{count}</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-white/6">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(8, density * 100)}%`,
                          background: "linear-gradient(90deg, rgba(16,185,129,0.95), rgba(16,185,129,0.32))",
                        }}
                      />
                    </div>
                    <div className="mt-1 text-[7px] font-bold tracking-[0.12em] text-white/25">
                      {start + 1}-{start + 16}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/6 bg-black/20 px-3 py-2">
              <span className="text-[8px] font-black tracking-[0.16em] text-white/55">
                EDIT MODE
              </span>
              <span className="text-[8px] font-bold tracking-[0.12em] text-[var(--ed-accent-bass)]">GATE LENGTH</span>
              <span className="text-[8px] font-bold tracking-[0.12em] text-cyan-300/70">ALT = LEGATO</span>
              <span className="text-[8px] font-bold tracking-[0.12em] text-blue-300/70">SHIFT = SLIDE</span>
              <span className={`text-[8px] font-bold tracking-[0.14em] ${isPlaying ? "text-[var(--ed-accent-bass)]" : "text-white/30"}`}>
                {isPlaying ? `PLAYHEAD ${currentStep + 1}` : "STOPPED"}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-white/6 bg-black/20 px-3 py-2">
            <span className="text-[8px] font-black tracking-[0.16em] text-white/55">QUICK STATUS</span>
            <span className="rounded-full border border-[var(--ed-accent-bass)]/20 bg-[var(--ed-accent-bass)]/8 px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] text-[var(--ed-accent-bass)]">
              PAGE {selectedPage + 1}
            </span>
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] text-white/45">
              {pageActiveSteps} NOTES
            </span>
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] text-cyan-300/70">
              ALT = LEGATO
            </span>
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] text-blue-300/70">
              SHIFT = SLIDE
            </span>
            <span className={`ml-auto text-[8px] font-bold tracking-[0.14em] ${isPlaying ? "text-[var(--ed-accent-bass)]" : "text-white/30"}`}>
              {isPlaying ? `PLAYHEAD ${currentStep + 1}` : "STOPPED"}
            </span>
          </div>
        )}
      </div>

      {/* Row 1: Main controls */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 border-b border-white/5">
        {/* Title */}
        <span className="text-[10px] font-black tracking-[0.15em] text-[var(--ed-accent-bass)] shrink-0" style={{ textShadow: "0 0 12px rgba(16,185,129,0.2)" }}>BASS 303</span>

        <Sep />

        {/* Instrument selector */}
        <select
          value={instrument}
          onChange={(e) => setInstrument(e.target.value)}
          className="h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded-md text-[var(--ed-accent-bass)]/70 focus:outline-none appearance-none cursor-pointer hover:border-[var(--ed-accent-bass)]/30 transition-colors min-w-[90px]"
        >
          {Object.entries(BASS_INSTRUMENT_GROUPS).map(([label, items]) => (
            <optgroup key={label} label={label}>
              {items.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <Sep />

        {/* Sound preset selector */}
        <select
          value={presetIndex}
          onChange={(e) => loadPreset(Number(e.target.value))}
          className={`h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded-md text-[var(--ed-accent-bass)]/70 focus:outline-none appearance-none cursor-pointer hover:border-[var(--ed-accent-bass)]/30 transition-colors min-w-[90px] ${instrument !== "_synth_" ? "opacity-40 cursor-not-allowed" : ""}`}
          disabled={instrument !== "_synth_"}
        >
          {Object.entries(BASS_PRESET_GROUPS).map(([label, items]) => (
            <optgroup key={label} label={label}>
              {items.map(({ preset, index }) => (
                <option key={`bass-preset-${label}-${index}`} value={index}>{preset.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <span className={`h-6 inline-flex items-center rounded-full border px-2 text-[8px] font-bold tracking-[0.14em] ${
          isSignaturePreset
            ? "border-[var(--ed-accent-bass)]/25 bg-[var(--ed-accent-bass)]/10 text-[var(--ed-accent-bass)]"
            : "border-white/8 bg-white/[0.04] text-white/45"
        }`}>
          {isSignaturePreset ? "CORE" : "HIDDEN"}
        </span>

        <Sep />

        {/* Root + Scale */}
        <Sel value={rootName} options={ROOT_NOTES}
          onChange={(v) => { const i = ROOT_NOTES.indexOf(v); if (i >= 0) setRootNote(36 + i, v); }} />
        <Sel value={scaleName} options={SCALE_NAMES} onChange={setScale} />

        <Sep />

        {/* Waveform */}
        <WaveBtn active={params.waveform === "sawtooth"} onClick={() => setParam("waveform", "sawtooth")} label="SAW" />
        <WaveBtn active={params.waveform === "square"} onClick={() => setParam("waveform", "square")} label="SQR" />
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

        {/* Filter mode */}
        <FilterBtn active={params.filterType === "lowpass"} onClick={() => setParam("filterType", "lowpass")} label="LP" />
        <FilterBtn active={params.filterType === "highpass"} onClick={() => setParam("filterType", "highpass")} label="HP" />
        <FilterBtn active={params.filterType === "bandpass"} onClick={() => setParam("filterType", "bandpass")} label="BP" />
        <FilterBtn active={params.filterType === "notch"} onClick={() => setParam("filterType", "notch")} label="NT" />

        <Sep />

        {/* Filter Model */}
        {(["lpf", "ladder", "steiner-lp"] as const).map((m) => (
          <FilterBtn key={m} active={params.filterModel === m}
            onClick={() => setParam("filterModel", m)}
            label={m === "lpf" ? "12dB" : m === "ladder" ? "MOOG" : "STNR"} />
        ))}

        <div className="flex-1" />

        {/* Bassline Agent — strategy cycle + generate */}
        <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-md px-1">
          <button onClick={prevStrategy} className="w-4 h-5 text-[8px] text-white/25 hover:text-white/60 transition-colors">&lsaquo;</button>
          <button
            onClick={() => generateBassline(strategyIndex)}
            className="h-6 px-2 text-[8px] font-bold text-[var(--ed-accent-bass)]/70 hover:text-[var(--ed-accent-bass)] transition-all"
            title="Generate bassline with selected strategy"
          >
            {strategyName}
          </button>
          <button onClick={nextStrategy} className="w-4 h-5 text-[8px] text-white/25 hover:text-white/60 transition-colors">&rsaquo;</button>
        </div>

        <Sep />

        {/* Save / Load */}
        <div className="flex items-center gap-[2px] relative">
          <button onClick={() => { setSaveOpen((o) => !o); setLoadOpen(false); }}
            className={`h-6 px-2 text-[7px] font-bold rounded-md transition-all ${saveOpen ? "bg-[var(--ed-accent-bass)]/15 text-[var(--ed-accent-bass)]" : "text-white/25 hover:text-white/50 hover:bg-white/5"}`}>
            SAVE
          </button>
          <button onClick={() => { setLoadOpen((o) => !o); setSaveOpen(false); }}
            className={`h-6 px-2 text-[7px] font-bold rounded-md transition-all ${loadOpen ? "bg-[var(--ed-accent-bass)]/15 text-[var(--ed-accent-bass)]" : "text-white/25 hover:text-white/50 hover:bg-white/5"}`}>
            LOAD
          </button>
          <button onClick={clearSteps} className="h-6 px-2 text-[7px] font-bold text-white/25 hover:text-red-400/70 hover:bg-white/5 rounded-md transition-all">CLR</button>
        </div>
      </div>

      {/* Inline save bar */}
      {saveOpen && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 bg-[var(--ed-bg-primary)]/40">
          <input
            type="text" placeholder="Bass pattern name..."
            value={saveName} onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            className="flex-1 h-6 px-2 text-[9px] bg-black/30 border border-white/8 rounded-md text-white/80 focus:outline-none focus:border-[var(--ed-accent-bass)]/40"
            autoFocus
          />
          <button onClick={handleSave} className="h-6 px-3 text-[8px] font-bold bg-[var(--ed-accent-bass)]/20 text-[var(--ed-accent-bass)] rounded-md hover:bg-[var(--ed-accent-bass)]/30 transition-colors">SAVE</button>
          <button onClick={() => setSaveOpen(false)} className="h-6 px-2 text-[8px] text-white/30 hover:text-white/60 transition-colors">&times;</button>
        </div>
      )}

      {/* Inline load dropdown */}
      {loadOpen && (
        <div className="border-b border-white/5 bg-[var(--ed-bg-primary)]/40 max-h-32 overflow-y-auto">
          {savedPatterns.length === 0 ? (
            <div className="px-3 py-2 text-[9px] text-white/20">No saved bass patterns</div>
          ) : savedPatterns.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-1 hover:bg-white/[0.03] group">
              <button onClick={() => handleLoad(p)} className="flex-1 text-left text-[9px] text-white/60 hover:text-white/90 transition-colors truncate">
                {p.name}
              </button>
              <span className="text-[7px] text-white/15">{p.length}st &middot; {p.scaleName}</span>
              <button onClick={() => handleDelete(p.id)} className="text-[8px] text-white/10 hover:text-red-400/60 opacity-0 group-hover:opacity-100 transition-all">&times;</button>
            </div>
          ))}
        </div>
      )}

      {/* Compact Knobs Row — show synth or Soundfont knobs based on instrument */}
      {instrument === "_synth_" ? (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/5 overflow-x-auto">
          <Knob value={params.cutoff} min={200} max={8000} defaultValue={600} label="CUT" color={BASS_COLOR} size={34} onChange={(v) => setParam("cutoff", v)} />
          <Knob value={params.resonance} min={0} max={30} defaultValue={12} label="RES" color={BASS_COLOR} size={34} onChange={(v) => setParam("resonance", v)} />
          <Knob value={Math.round(params.envMod * 100)} min={0} max={100} defaultValue={60} label="ENV" color={BASS_COLOR} size={34} onChange={(v) => setParam("envMod", v / 100)} />
          <Knob value={params.decay} min={50} max={800} defaultValue={200} label="DEC" color={BASS_COLOR} size={34} onChange={(v) => setParam("decay", v)} />
          <Knob value={Math.round(params.accent * 100)} min={0} max={100} defaultValue={50} label="ACC" color={BASS_COLOR} size={34} onChange={(v) => setParam("accent", v / 100)} />
          <Knob value={params.slideTime} min={0} max={200} defaultValue={60} label="SLD" color={BASS_COLOR} size={34} onChange={(v) => setParam("slideTime", v)} />
          <Knob value={Math.round(params.distortion * 100)} min={0} max={100} defaultValue={30} label="DRV" color={BASS_COLOR} size={34} onChange={(v) => setParam("distortion", v / 100)} />
          <Knob value={Math.round(params.subOsc * 100)} min={0} max={100} defaultValue={0} label="SUB" color={BASS_COLOR} size={34} onChange={(v) => setParam("subOsc", v / 100)} />
        </div>
      ) : (
        <SoundFontKnobs channel={12} color={BASS_COLOR} />
      )}

      {/* Row 2: Pages + length */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-white/5">
        <div className="flex gap-1">
            {pageNumbers.map((page) => (
            <button key={`page-tab-${page}`} onClick={() => setSelectedPage(page)}
              className={`px-2 py-0.5 text-[9px] font-medium rounded-md transition-all ${
                selectedPage === page
                  ? "bg-[var(--ed-accent-bass)] text-black font-bold shadow-[0_0_8px_rgba(16,185,129,0.2)]"
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
              <span className="text-[10px] font-mono text-[var(--ed-accent-bass)] min-w-[24px] text-center font-bold tabular-nums">{length}</span>
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
          <span className={`text-[10px] font-mono min-w-[32px] text-center font-bold tabular-nums ${globalOctave !== 0 ? "text-[var(--ed-accent-bass)]" : "text-[var(--ed-text-muted)]"}`}>
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
          // Note length: use explicit gateLength if set (> 1), otherwise check legacy ties
          let noteLength = Math.max(1, step.gateLength ?? 1);
          if (isActive && !isTiedFromPrev && noteLength <= 1) {
            // Legacy compatibility: count consecutive tied steps for old patterns
            let legacyTie = 1;
            for (let j = absStep + 1; j < length; j++) {
              const next = steps[j]!;
              if (!next.active || !next.tie) break;
              legacyTie += 1;
            }
            if (legacyTie > 1) noteLength = legacyTie;
          }
          const visibleLength = Math.max(1, Math.min(noteLength, 16 - i, length - absStep));

          return (
            <div key={i}
              ref={(el) => { if (el) stepElRefs.current.set(absStep, el); else stepElRefs.current.delete(absStep); }}
              className={`flex-1 flex flex-col justify-end min-w-0 relative ${beyondLength ? "opacity-25" : ""} ${isSelected && isActive ? "ring-1 ring-[var(--ed-accent-bass)]/55 rounded-sm" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); handleMouseDown(e, absStep); }}
              onPointerDown={(e) => handleDurationDragStart(e, absStep)}
              onContextMenu={(e) => { e.preventDefault(); if (isActive) toggleAccent(absStep); }}
              onAuxClick={(e) => { if (e.button === 1 && isActive) { e.preventDefault(); cycleOctave(absStep); } }}>
              <div className={`absolute top-0 left-0 right-0 h-3 border-b ${isBeat ? "border-white/10" : "border-white/5"}`}>
                <div className="pt-[1px] text-center text-[6px] font-black tracking-[0.15em] text-white/20">
                  {Math.floor(i / 4) + 1}.{(i % 4) + 1}
                </div>
              </div>
              {isBeat && <div className="absolute top-0 bottom-0 left-0 w-px bg-white/[0.04]" />}
              {isCurrent && (
                <div className="absolute top-0 left-0 right-0 h-[2px] rounded-full"
                  style={{ background: "linear-gradient(90deg, var(--ed-accent-bass), transparent)", boxShadow: "0 0 8px rgba(16,185,129,0.4)" }} />
              )}
              {isActive && !isTiedFromPrev && visibleLength > 1 && (
                <div
                  className="absolute left-[2px] rounded-[6px] pointer-events-none z-0"
                  style={{
                    bottom: 18,
                    height: `max(16px, ${noteHeight}%)`,
                    width: `calc(${visibleLength * 100}% + ${(visibleLength - 1)}px - 4px)`,
                    background: "linear-gradient(90deg, rgba(16,185,129,0.55) 0%, rgba(16,185,129,0.32) 82%, rgba(16,185,129,0.16) 100%)",
                    boxShadow: "0 0 0 1px rgba(16,185,129,0.24) inset, 0 0 12px rgba(16,185,129,0.12)",
                  }}
                />
              )}
              <div className={`w-full transition-all duration-75 flex flex-col items-center justify-end pb-0.5 select-none ${isActive ? "cursor-ns-resize" : "cursor-pointer rounded-sm"}`}
                style={{
                  height: isActive ? `${noteHeight}%` : "100%", minHeight: isActive ? 20 : undefined,
                  background: isActive
                    ? step.accent ? "linear-gradient(180deg, rgba(16,185,129,0.85), rgba(16,185,129,0.55))"
                    : step.tie ? "linear-gradient(180deg, rgba(34,211,238,0.55), rgba(34,211,238,0.35))"
                    : "linear-gradient(180deg, rgba(16,185,129,0.55), rgba(16,185,129,0.3))"
                    : "rgba(255,255,255,0.025)",
                  borderLeft: step.slide && isActive ? "3px solid rgba(96,165,250,0.8)" : "none",
                  borderTopLeftRadius: isTiedFromPrev ? 0 : 3, borderTopRightRadius: 3, borderBottomLeftRadius: 0,
                  marginLeft: isTiedFromPrev ? -1 : 0,
                  marginTop: 12,
                  boxShadow: isActive && isCurrent ? "0 0 10px rgba(16,185,129,0.25)" : isActive ? "inset 0 1px 0 rgba(255,255,255,0.05)" : "none",
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
                {/* Duration drag handle — right edge (wider grab area, clear visual) */}
                {isActive && !isTiedFromPrev && (
                  <div className="absolute right-0 top-0 bottom-0 w-[14px] cursor-e-resize rounded-r group/handle"
                    style={{
                      background: noteLength > 1
                        ? "linear-gradient(90deg, transparent, rgba(16,185,129,0.4))"
                        : "linear-gradient(90deg, transparent, rgba(255,255,255,0.12))",
                    }}>
                    {/* Visible grab line */}
                    <div className="absolute right-[2px] top-[20%] bottom-[20%] w-[2px] rounded-full bg-white/40 group-hover/handle:bg-white/70 transition-colors" />
                  </div>
                )}
                {/* Duration drag preview */}
                {isInDragRange && !isActive && (
                  <div className="absolute inset-0 rounded-sm" style={{ backgroundColor: "rgba(34,211,238,0.25)" }} />
                )}
              </div>
              <div className={`text-center text-[7px] font-mono mt-0.5 ${isCurrent ? "text-[var(--ed-accent-bass)] font-bold" : isBeat ? "text-white/15" : "text-white/8"}`}>{absStep + 1}</div>
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
        params={BASS_AUTO_PARAMS}
        selectedParam={automationParam}
        values={automationData[automationParam] ?? []}
        length={length}
        pageOffset={pageOffset}
        currentStep={currentStep}
        isPlaying={isPlaying}
        color="var(--ed-accent-bass)"
        onSelectParam={setAutomationParam}
        onChange={(step, value) => setAutomationValue(automationParam, step, value)}
      />
      </div>
      <div className="px-3 pb-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-black tracking-[0.16em] text-[var(--ed-accent-bass)]">VELOCITY LANE</span>
            <span className="text-[7px] text-white/22">draw dynamics without zoom</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[7px] text-white/25">drag bars</span>
            <button
              onClick={() => setVelocityLaneExpanded((prev) => !prev)}
              className={`h-5 rounded-full border px-2 text-[7px] font-bold tracking-[0.14em] transition-colors ${
                velocityLaneExpanded
                  ? "border-[var(--ed-accent-bass)]/30 bg-[var(--ed-accent-bass)]/12 text-[var(--ed-accent-bass)]"
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
                  className={`relative flex-1 rounded-md border cursor-ns-resize transition-colors ${absStep >= length ? "opacity-25" : ""} ${isCurrent ? "border-[var(--ed-accent-bass)]/45 bg-[var(--ed-accent-bass)]/[0.06]" : "border-white/6 bg-white/[0.025] hover:bg-white/[0.045]"}`}
                  onMouseDown={(e) => handleVelocityDraw(e, absStep)}
                  onMouseMove={(e) => {
                    if (e.buttons === 1) handleVelocityDraw(e, absStep);
                  }}
                >
                  {step.active && (
                    <div
                      className="absolute inset-x-[3px] bottom-[3px] rounded-sm shadow-[0_0_14px_rgba(16,185,129,0.16)]"
                      style={{
                        height: `${Math.max(12, velocity * 100)}%`,
                        background: step.accent
                          ? "linear-gradient(180deg, rgba(248,113,113,0.9), rgba(16,185,129,0.7))"
                          : "linear-gradient(180deg, rgba(110,231,183,0.9), rgba(16,185,129,0.45))",
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
      className="h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded-md text-white/60 focus:outline-none appearance-none cursor-pointer hover:border-[var(--ed-accent-bass)]/30 transition-colors">
      {options.map((o) => <option key={`bass-sel-${o}`} value={o}>{o}</option>)}
    </select>
  );
}

function WaveBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 h-6 text-[8px] font-bold rounded-md transition-all ${
        active ? "bg-[var(--ed-accent-bass)]/15 text-[var(--ed-accent-bass)] shadow-[0_0_8px_rgba(16,185,129,0.1)]" : "text-white/25 hover:text-white/50 hover:bg-white/5"
      }`}>
      {label}
    </button>
  );
}

function FilterBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-1.5 h-5 text-[7px] font-bold rounded transition-all ${
        active ? "bg-[var(--ed-accent-blue)]/20 text-[var(--ed-accent-blue)]" : "text-white/20 hover:text-white/40"
      }`}>
      {label}
    </button>
  );
}
