/**
 * Melody Generator Panel
 *
 * Full-screen overlay that exposes the guided MIDI generation engine.
 * Produces style-specific patterns (HarbourGlow, Ambient, Deep House,
 * Electronica) and sends them directly to the Piano Roll.
 */

import { useState, useCallback, useMemo } from "react";
import {
  generatePattern,
  generateVariation,
  type GeneratorParams,
  type GeneratedPattern,
  type GenStyle,
  type GenRole,
  type GenMode,
  STYLE_META,
  ROLE_META,
  MODE_META,
  KEYS,
  STYLE_DEFAULTS,
} from "../audio/MelodyGeneratorEngine";
import {
  _persistedNotes,
  updatePersistedNotes,
} from "./PianoRoll/persistedState";
import { useOverlayStore } from "../store/overlayStore";
import { useDrumStore } from "../store/drumStore";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Tiny note preview ───────────────────────────────────────────────────────

function NotePreview({ notes, bars }: { notes: GeneratedPattern["notes"]; bars: number }) {
  if (notes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/15 text-[9px]">
        no notes — hit Generate
      </div>
    );
  }

  const totalBeats = bars * 4;
  const midiMin = Math.min(...notes.map(n => n.midi));
  const midiMax = Math.max(...notes.map(n => n.midi));
  const midiRange = Math.max(1, midiMax - midiMin);

  const TRACK_COLORS: Record<string, string> = {
    bass: "#6366f1", chords: "#8b5cf6", melody: "#22d3ee",
    drums: "#f59e0b", sampler: "#10b981",
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      {notes.map(note => {
        const x = (note.start / totalBeats) * 100;
        const w = Math.max(0.4, (note.duration / totalBeats) * 100);
        const y = 100 - ((note.midi - midiMin) / midiRange) * 100;
        const color = TRACK_COLORS[note.track] ?? "#fff";
        return (
          <div
            key={note.id}
            className="absolute rounded-[1px]"
            style={{
              left:   `${x}%`,
              width:  `${w}%`,
              top:    `${Math.max(0, Math.min(92, y))}%`,
              height: `${Math.max(3, Math.min(12, 100 / midiRange))}%`,
              backgroundColor: color,
              opacity: 0.5 + note.velocity * 0.5,
            }}
          />
        );
      })}
      {/* Bar lines */}
      {Array.from({ length: bars + 1 }, (_, i) => (
        <div
          key={`bar-${i}`}
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: `${(i / bars) * 100}%`, width: 1, backgroundColor: "rgba(255,255,255,0.12)" }}
        />
      ))}
    </div>
  );
}

// ─── Slider ──────────────────────────────────────────────────────────────────

function Slider({
  label, value, min, max, step = 1,
  onChange, format,
}: {
  label: string; value: number; min: number; max: number;
  step?: number; onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-bold tracking-[0.12em] text-white/40">{label}</span>
        <span className="text-[8px] font-mono text-white/60">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 accent-[#f59e0b] rounded cursor-pointer"
      />
    </div>
  );
}

// ─── History Item ─────────────────────────────────────────────────────────────

function HistoryItem({
  pattern, onLoad, onRemove,
}: {
  pattern: GeneratedPattern;
  onLoad: (p: GeneratedPattern) => void;
  onRemove: (id: string) => void;
}) {
  const color = STYLE_META[pattern.params.style].color;
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-white/6 bg-white/[0.02] hover:bg-white/[0.04] group transition-colors">
      <div
        className="w-1.5 h-6 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[8px] font-bold text-white/65 truncate">{pattern.name}</div>
        <div className="text-[7px] text-white/25">
          {pattern.params.bars}B · {pattern.notes.length} notes
        </div>
      </div>
      <button
        onClick={() => onLoad(pattern)}
        className="px-2 py-0.5 text-[7px] font-bold tracking-wide border border-white/12 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded transition-colors shrink-0"
      >
        LOAD
      </button>
      <button
        onClick={() => onRemove(pattern.id)}
        className="text-white/20 hover:text-red-400 text-[9px] transition-colors shrink-0"
      >
        ×
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const BARS_OPTIONS: (2 | 4 | 8 | 16)[] = [2, 4, 8, 16];
const MODES: GenMode[] = ["minor", "dorian", "phrygian", "major", "mixolydian", "pentatonicMinor"];

export function MelodyGenerator({ isOpen, onClose }: Props) {
  const bpmFromStore = useDrumStore(s => s.bpm);
  const overlay = useOverlayStore();

  const [style, setStyle]   = useState<GenStyle>("harbourGlow");
  const [role,  setRole]    = useState<GenRole>("bass");
  const [current, setCurrent] = useState<GeneratedPattern | null>(null);
  const [history, setHistory] = useState<GeneratedPattern[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Params — initialised from HarbourGlow defaults
  const [params, setParams] = useState<GeneratorParams>(() => ({
    ...STYLE_DEFAULTS.harbourGlow,
    role: "bass",
    bpm: bpmFromStore,
  }));

  const setParam = useCallback(<K extends keyof GeneratorParams>(key: K, val: GeneratorParams[K]) => {
    setParams(prev => ({ ...prev, [key]: val }));
  }, []);

  // Sync style changes to defaults
  const applyStyle = useCallback((s: GenStyle) => {
    setStyle(s);
    const defaults = STYLE_DEFAULTS[s];
    setParams(prev => ({ ...prev, ...defaults, role: prev.role }));
  }, []);

  const handleGenerate = useCallback(() => {
    setIsGenerating(true);
    // Defer so the UI updates before the (potentially slow) generation
    setTimeout(() => {
      try {
        const p: GeneratorParams = { ...params, style, role };
        const pattern = generatePattern(p);
        setCurrent(pattern);
        setHistory(prev => [pattern, ...prev].slice(0, 16));
      } finally {
        setIsGenerating(false);
      }
    }, 10);
  }, [params, style, role]);

  const handleVariation = useCallback(() => {
    if (!current) return;
    setIsGenerating(true);
    setTimeout(() => {
      try {
        const v = generateVariation(current);
        setCurrent(v);
        setHistory(prev => [v, ...prev].slice(0, 16));
      } finally {
        setIsGenerating(false);
      }
    }, 10);
  }, [current]);

  const sendToPianoRoll = useCallback((pattern: GeneratedPattern, mode: "replace" | "add") => {
    const existing = mode === "add" ? _persistedNotes : [];
    updatePersistedNotes([...existing, ...pattern.notes]);
    window.dispatchEvent(new CustomEvent("piano-roll-notes-imported"));
    overlay.openOverlay("pianoRoll");
  }, [overlay]);

  const handleLoad = useCallback((p: GeneratedPattern) => {
    setCurrent(p);
  }, []);

  const handleRemove = useCallback((id: string) => {
    setHistory(prev => prev.filter(p => p.id !== id));
  }, []);

  const accentColor = useMemo(() => STYLE_META[style].color, [style]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[var(--ed-bg-primary)] flex flex-col select-none">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center px-4 py-2 border-b border-white/8 shrink-0"
        style={{ borderBottomColor: `${accentColor}30` }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: accentColor, boxShadow: `0 0 8px ${accentColor}` }}
          />
          <span className="text-[11px] font-black tracking-[0.2em]" style={{ color: accentColor }}>
            GENERATOR
          </span>
          <span className="text-[8px] font-bold tracking-[0.15em] text-white/25">
            GUIDED MIDI COMPOSITION ENGINE
          </span>
        </div>
        <button
          onClick={onClose}
          className="ml-auto text-white/25 hover:text-white/70 text-lg transition-colors px-2"
          aria-label="Close generator"
        >
          ×
        </button>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────*/}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── LEFT: Style + Role ────────────────────────────────────────────*/}
        <div className="w-48 shrink-0 border-r border-white/6 flex flex-col overflow-y-auto">

          {/* Style */}
          <div className="px-3 pt-3 pb-2">
            <div className="text-[8px] font-black tracking-[0.2em] text-white/30 mb-2">STYLE</div>
            {(Object.keys(STYLE_META) as GenStyle[]).map(s => {
              const meta = STYLE_META[s];
              const active = style === s;
              return (
                <button
                  key={s}
                  onClick={() => applyStyle(s)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg mb-1 border transition-all ${
                    active
                      ? "border-white/15 bg-white/[0.06]"
                      : "border-transparent hover:border-white/8 hover:bg-white/[0.03]"
                  }`}
                  style={{ borderColor: active ? meta.color : undefined }}
                >
                  <div
                    className="text-[9px] font-black tracking-[0.12em]"
                    style={{ color: active ? meta.color : "rgba(255,255,255,0.55)" }}
                  >
                    {meta.name}
                  </div>
                  <div className="text-[7px] text-white/25 mt-0.5 leading-tight">{meta.tagline}</div>
                </button>
              );
            })}
          </div>

          <div className="border-t border-white/6 mx-3" />

          {/* Role */}
          <div className="px-3 pt-2 pb-3">
            <div className="text-[8px] font-black tracking-[0.2em] text-white/30 mb-2">ROLE</div>
            {(Object.keys(ROLE_META) as GenRole[]).map(r => {
              const meta = ROLE_META[r];
              const active = role === r;
              return (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`w-full text-left px-2.5 py-1.5 rounded mb-0.5 transition-all ${
                    active
                      ? "bg-white/[0.08] text-white"
                      : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
                  }`}
                >
                  <span className="text-[9px] font-bold tracking-[0.1em]">
                    {meta.icon}&nbsp;&nbsp;{meta.name.toUpperCase()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── CENTER: Params + Preview + Controls ───────────────────────────*/}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Params grid */}
          <div className="px-4 pt-3 pb-2 border-b border-white/6 shrink-0">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">

              {/* Key */}
              <div className="flex flex-col gap-1">
                <span className="text-[8px] font-bold tracking-[0.12em] text-white/40">KEY</span>
                <div className="flex flex-wrap gap-1">
                  {KEYS.map(k => (
                    <button
                      key={k}
                      onClick={() => setParam("key", k)}
                      className={`px-1.5 py-0.5 text-[7px] font-bold rounded border transition-all ${
                        params.key === k
                          ? "border-white/30 text-white bg-white/10"
                          : "border-white/8 text-white/35 hover:text-white/60 hover:border-white/15"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode */}
              <div className="flex flex-col gap-1">
                <span className="text-[8px] font-bold tracking-[0.12em] text-white/40">MODE</span>
                <div className="flex flex-col gap-0.5">
                  {MODES.map(m => (
                    <button
                      key={m}
                      onClick={() => setParam("mode", m)}
                      className={`text-left px-2 py-0.5 rounded text-[7px] font-bold transition-all ${
                        params.mode === m
                          ? "bg-white/10 text-white"
                          : "text-white/35 hover:text-white/60"
                      }`}
                    >
                      {MODE_META[m].name}
                    </button>
                  ))}
                </div>
              </div>

              {/* BPM + Swing */}
              <div className="flex flex-col gap-2 mt-1">
                <Slider label="BPM" value={params.bpm} min={60} max={180} onChange={v => setParam("bpm", v)} />
                <Slider label="SWING" value={params.swing} min={50} max={70}
                  format={v => `${v}%`} onChange={v => setParam("swing", v)} />
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[8px] font-bold tracking-[0.12em] text-white/40">BARS</span>
                  {BARS_OPTIONS.map(b => (
                    <button
                      key={b}
                      onClick={() => setParam("bars", b)}
                      className={`px-2 py-0.5 text-[8px] font-bold rounded border transition-all ${
                        params.bars === b
                          ? "border-white/30 text-white bg-white/10"
                          : "border-white/8 text-white/35 hover:text-white/60"
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              {/* Expression sliders */}
              <div className="flex flex-col gap-2 mt-1">
                <Slider label="COMPLEXITY" value={params.complexity} min={1} max={5}
                  format={v => "●".repeat(v) + "○".repeat(5 - v)}
                  onChange={v => setParam("complexity", v)} />
                <Slider label="MOOD" value={params.mood} min={0} max={1} step={0.01}
                  format={v => v < 0.33 ? "Calm" : v < 0.66 ? "Mid" : "Tense"}
                  onChange={v => setParam("mood", v)} />
                <Slider label="DENSITY" value={params.density} min={0} max={1} step={0.01}
                  format={v => v < 0.33 ? "Sparse" : v < 0.66 ? "Medium" : "Dense"}
                  onChange={v => setParam("density", v)} />
                <Slider label="HUMANIZE" value={params.humanize} min={0} max={1} step={0.01}
                  format={v => `${Math.round(v * 100)}%`}
                  onChange={v => setParam("humanize", v)} />
              </div>
            </div>
          </div>

          {/* Generate controls */}
          <div className="px-4 py-3 border-b border-white/6 shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="flex-1 py-3 text-[10px] font-black tracking-[0.2em] rounded-lg border transition-all disabled:opacity-50"
                style={{
                  backgroundColor: `${accentColor}20`,
                  borderColor: `${accentColor}50`,
                  color: accentColor,
                  boxShadow: `0 0 20px ${accentColor}20`,
                }}
              >
                {isGenerating ? "GENERATING…" : "▶ GENERATE"}
              </button>

              <button
                onClick={handleVariation}
                disabled={!current || isGenerating}
                className="px-4 py-3 text-[9px] font-black tracking-[0.15em] rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white/80 transition-all disabled:opacity-30"
              >
                VARIATION
              </button>
            </div>

            {/* Send to Piano Roll */}
            {current && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[7px] text-white/30 font-bold tracking-wide">SEND TO PIANO ROLL:</span>
                <button
                  onClick={() => sendToPianoRoll(current, "replace")}
                  className="px-2 py-1 text-[7px] font-bold rounded border border-white/15 bg-white/5 hover:bg-white/10 text-white/55 hover:text-white transition-colors"
                >
                  REPLACE
                </button>
                <button
                  onClick={() => sendToPianoRoll(current, "add")}
                  className="px-2 py-1 text-[7px] font-bold rounded border border-white/15 bg-white/5 hover:bg-white/10 text-white/55 hover:text-white transition-colors"
                >
                  ADD
                </button>
                <span className="text-[7px] text-white/20 ml-auto">
                  {current.notes.length} notes · {current.params.bars} bars
                </span>
              </div>
            )}
          </div>

          {/* Note Preview */}
          <div className="px-4 py-2 border-b border-white/6 shrink-0">
            <div className="text-[7px] font-bold tracking-[0.15em] text-white/25 mb-1.5">PREVIEW</div>
            <div
              className="relative rounded border border-white/6 overflow-hidden"
              style={{ height: 72, backgroundColor: "rgba(0,0,0,0.3)" }}
            >
              {current ? (
                <NotePreview notes={current.notes} bars={current.params.bars} />
              ) : (
                <div className="flex items-center justify-center h-full text-white/12 text-[8px] italic">
                  press Generate to create a pattern
                </div>
              )}
            </div>
            {current && (
              <div className="mt-1 text-[7px] text-white/30 font-mono truncate">{current.name}</div>
            )}
          </div>

          {/* Footer info */}
          <div className="px-4 py-1.5 mt-auto border-t border-white/5">
            <div className="text-[7px] text-white/20">
              Guided MIDI generation · Patterns are musically coherent — not random · HarbourGlow = Trip-Hop, Bristol 90s
            </div>
          </div>
        </div>

        {/* ── RIGHT: History ────────────────────────────────────────────────*/}
        <div className="w-56 shrink-0 border-l border-white/6 flex flex-col overflow-hidden">
          <div className="px-3 pt-3 pb-1 shrink-0">
            <span className="text-[8px] font-black tracking-[0.2em] text-white/30">HISTORY</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
            {history.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-white/15 text-[8px]">
                nothing generated yet
              </div>
            ) : (
              history.map(p => (
                <HistoryItem
                  key={p.id} pattern={p}
                  onLoad={handleLoad} onRemove={handleRemove}
                />
              ))
            )}
          </div>

          {/* Quick stack hint */}
          {history.length > 1 && (
            <div className="px-3 pb-3 pt-1 border-t border-white/5 shrink-0">
              <div className="text-[7px] text-white/20 leading-relaxed">
                TIP: Generate multiple roles, then Add each to the Piano Roll to build a full arrangement.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
