/**
 * Euclidean Generator — evenly-distributed rhythmic patterns with
 * an optional second pattern used as an accent overlay.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useDrumStore, generateEuclidean } from "../store/drumStore";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";
import { useMelodyLayerStore, LAYER_COLORS } from "../store/melodyLayerStore";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM L", "TOM M", "TOM H",
  "HH CL", "HH OP", "CYM", "RIDE", "PRC1", "PRC2",
];

// ── Kit Fill — base patterns per voice (at density 1.0) ──────────────────────
// Index matches VOICE_LABELS. rotation = step offset for musical placement.
const KIT_FILL_BASE: { pulses: number; steps: number; rotation: number }[] = [
  { pulses: 4, steps: 16, rotation: 0  }, // KICK  — four-on-floor
  { pulses: 2, steps: 16, rotation: 4  }, // SNARE — beats 2 & 4
  { pulses: 2, steps: 16, rotation: 4  }, // CLAP  — beats 2 & 4
  { pulses: 1, steps: 16, rotation: 3  }, // TOM L — sparse
  { pulses: 1, steps: 16, rotation: 7  }, // TOM M — sparse offset
  { pulses: 1, steps: 16, rotation: 11 }, // TOM H — sparse offset
  { pulses: 8, steps: 16, rotation: 0  }, // HH CL — 8th notes
  { pulses: 2, steps: 16, rotation: 2  }, // HH OP — offbeats
  { pulses: 1, steps: 16, rotation: 0  }, // CYM   — downbeat
  { pulses: 4, steps: 16, rotation: 1  }, // RIDE  — slight offset
  { pulses: 3, steps: 16, rotation: 2  }, // PRC1
  { pulses: 3, steps: 16, rotation: 5  }, // PRC2
];

// ── Groove Styles — multi-voice presets ──────────────────────────────────────
interface VoicePat { p: number; s: number; r: number }
interface GrooveStyle {
  name: string;
  hint: string;
  emoji: string;
  voices: Partial<Record<number, VoicePat>>; // voice index → E(p,s,r)
}

const GROOVE_STYLES: GrooveStyle[] = [
  {
    name: "House",   emoji: "🏠", hint: "Four-on-floor, offbeat open HH, snare on 2&4",
    voices: {
      0: { p: 4, s: 16, r: 0  }, // KICK
      1: { p: 2, s: 16, r: 4  }, // SNARE
      2: { p: 2, s: 16, r: 4  }, // CLAP
      6: { p: 8, s: 16, r: 0  }, // HH CL
      7: { p: 4, s: 16, r: 2  }, // HH OP
      9: { p: 4, s: 16, r: 1  }, // RIDE
    },
  },
  {
    name: "Techno",  emoji: "⚙️", hint: "Driving kick, 16th HH, sparse accents",
    voices: {
      0: { p: 4,  s: 16, r: 0 }, // KICK
      1: { p: 2,  s: 16, r: 4 }, // SNARE
      2: { p: 1,  s: 16, r: 4 }, // CLAP
      6: { p: 16, s: 16, r: 0 }, // HH CL — 16th notes
      7: { p: 3,  s: 16, r: 2 }, // HH OP
      8: { p: 2,  s: 16, r: 0 }, // CYM
      9: { p: 4,  s: 16, r: 1 }, // RIDE
    },
  },
  {
    name: "Trap",    emoji: "🔫", hint: "Sparse kick, hi-hat rolls, snare on 3",
    voices: {
      0: { p: 3,  s: 16, r: 0 }, // KICK — sparse
      1: { p: 1,  s: 16, r: 8 }, // SNARE — beat 3
      2: { p: 2,  s: 16, r: 4 }, // CLAP
      6: { p: 16, s: 16, r: 0 }, // HH CL — every step
      7: { p: 4,  s: 16, r: 3 }, // HH OP
      9: { p: 8,  s: 16, r: 1 }, // RIDE
     10: { p: 5,  s: 16, r: 2 }, // PRC1
    },
  },
  {
    name: "Afrobeat", emoji: "🌍", hint: "Cuban clave feel, layered percussion",
    voices: {
      0: { p: 3, s: 16, r: 0 }, // KICK — tresillo
      1: { p: 2, s: 16, r: 3 }, // SNARE
      2: { p: 5, s: 16, r: 1 }, // CLAP — cinquillo
      3: { p: 3, s: 16, r: 2 }, // TOM L
      4: { p: 5, s: 16, r: 4 }, // TOM M
      6: { p: 7, s: 16, r: 0 }, // HH CL — Bulgarian-ish
      7: { p: 3, s: 16, r: 4 }, // HH OP
     10: { p: 5, s:  8, r: 0 }, // PRC1 — dense clave
     11: { p: 3, s:  8, r: 1 }, // PRC2
    },
  },
  {
    name: "Jazz",    emoji: "🎷", hint: "Loose ride, brush snare, sparse kick",
    voices: {
      0: { p: 2, s: 16, r: 0 }, // KICK — sparse
      1: { p: 3, s: 16, r: 2 }, // SNARE — brush feel
      6: { p: 5, s: 16, r: 0 }, // HH CL — swing-like
      7: { p: 2, s: 16, r: 6 }, // HH OP
      8: { p: 2, s: 16, r: 8 }, // CYM
      9: { p: 8, s: 16, r: 1 }, // RIDE — ride pattern
    },
  },
  {
    name: "Samba",   emoji: "🇧🇷", hint: "Layered surdo, tamborim, agogô feel",
    voices: {
      0: { p: 3, s: 16, r: 0 }, // KICK — surdo
      1: { p: 5, s: 16, r: 1 }, // SNARE — caixa
      2: { p: 3, s:  8, r: 0 }, // CLAP  — palma
      3: { p: 5, s: 16, r: 2 }, // TOM L — surdo 2
      4: { p: 3, s: 16, r: 4 }, // TOM M
      6: { p: 8, s: 16, r: 0 }, // HH CL
      7: { p: 2, s: 16, r: 3 }, // HH OP
     10: { p: 5, s: 16, r: 3 }, // PRC1 — tamborim
     11: { p: 7, s: 16, r: 2 }, // PRC2 — agogô
    },
  },
  {
    name: "DnB",     emoji: "⚡", hint: "Amen-inspired breakbeat, syncopated",
    voices: {
      0: { p: 3, s: 16, r: 0 }, // KICK
      1: { p: 5, s: 16, r: 2 }, // SNARE — syncopated
      2: { p: 2, s: 16, r: 5 }, // CLAP
      6: { p: 13,s: 16, r: 0 }, // HH CL — busy
      7: { p: 4, s: 16, r: 1 }, // HH OP
      8: { p: 3, s: 16, r: 3 }, // CYM
      9: { p: 5, s: 16, r: 2 }, // RIDE
    },
  },
  {
    name: "Reggae",  emoji: "🌿", hint: "One-drop kick, skank rhythm, sparse",
    voices: {
      0: { p: 2, s: 16, r: 8 }, // KICK — one drop (beat 3)
      1: { p: 2, s: 16, r: 4 }, // SNARE
      2: { p: 4, s: 16, r: 2 }, // CLAP — skank offbeats
      6: { p: 4, s: 16, r: 0 }, // HH CL
      7: { p: 4, s: 16, r: 2 }, // HH OP — upbeat skank
      9: { p: 4, s: 16, r: 2 }, // RIDE
    },
  },
];

const NOTE_MODES = [
  { id: "root",       label: "Root" },
  { id: "ascending",  label: "Ascend" },
  { id: "walk",       label: "Walk" },
  { id: "alternate",  label: "1 ↔ 5" },
  { id: "pentatonic", label: "Pentatonic" },
  { id: "random",     label: "Random" },
];

type Target = "drums" | "bass" | "chords" | "melody" | "layers";

const TARGETS: { id: Target; label: string; color: string }[] = [
  { id: "drums",  label: "DRUMS",  color: "var(--ed-accent-orange)" },
  { id: "bass",   label: "BASS",   color: "var(--ed-accent-bass)" },
  { id: "chords", label: "CHORDS", color: "var(--ed-accent-chords)" },
  { id: "melody", label: "MELODY", color: "var(--ed-accent-melody)" },
  { id: "layers", label: "LAYERS", color: "#a78bfa" },
];

// Presets including world-music rhythms
interface EuclidPreset { label: string; p: number; s: number; r?: number; hint?: string }
const PRESETS: EuclidPreset[] = [
  { label: "4/16",   p: 4,  s: 16, hint: "Four on floor" },
  { label: "3/8",    p: 3,  s: 8,  hint: "Cuban tresillo" },
  { label: "5/8",    p: 5,  s: 8,  hint: "Cuban cinquillo" },
  { label: "3/16",   p: 3,  s: 16, hint: "Sparse" },
  { label: "5/16",   p: 5,  s: 16, hint: "Bossa / Son" },
  { label: "7/16",   p: 7,  s: 16, hint: "Bulgarian" },
  { label: "9/16",   p: 9,  s: 16, hint: "Aksak" },
  { label: "11/24",  p: 11, s: 24, hint: "Arab Wawuli" },
  { label: "13/16",  p: 13, s: 16, hint: "Busy / Glitch" },
  { label: "2/5",    p: 2,  s: 5,  hint: "Thai / Korean" },
  { label: "4/11",   p: 4,  s: 11, hint: "Frank Zappa vibe" },
  { label: "5/12",   p: 5,  s: 12, hint: "West-African" },
];

interface EuclideanGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EuclideanGenerator({ isOpen, onClose }: EuclideanGeneratorProps) {
  const { selectedVoice, applyEuclidean: applyDrumEuclidean } = useDrumStore();
  const { applyEuclidean: applyBassEuclidean } = useBassStore();
  const { applyEuclidean: applyChordsEuclidean } = useChordsStore();
  const { applyEuclidean: applyMelodyEuclidean, scaleName: melodyScale, rootNote: melodyRoot } = useMelodyStore();
  const { applyLayerEuclidean, layers, activeLayerId } = useMelodyLayerStore();
  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const activeLayerColor = activeLayer ? LAYER_COLORS[activeLayer.colorIndex] : "#a78bfa";

  const [target, setTarget] = useState<Target>("drums");
  const [pulses, setPulses] = useState(4);
  const [steps, setSteps] = useState(16);
  const [rotation, setRotation] = useState(0);
  const [accentPulses, setAccentPulses] = useState(0);
  const [accentRotation, setAccentRotation] = useState(0);
  const [noteMode, setNoteMode] = useState("root");
  const [kitDensity, setKitDensity] = useState(0.5);  // 0 = sparse … 1 = dense
  const [activeStyle, setActiveStyle] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const rhythm = useMemo(() => generateEuclidean(pulses, steps, rotation), [pulses, steps, rotation]);
  const accent = useMemo(
    () => (accentPulses > 0 ? generateEuclidean(accentPulses, steps, accentRotation) : null),
    [accentPulses, steps, accentRotation],
  );

  // For LAYERS target, reflect the active layer's color in the UI
  const targetsWithLayerColor = TARGETS.map((t) =>
    t.id === "layers" ? { ...t, color: activeLayerColor } : t
  );
  const activeTarget = targetsWithLayerColor.find((t) => t.id === target)!;
  const accentColor = activeTarget.color;
  const isSynth = target !== "drums";

  const handleApply = useCallback(() => {
    switch (target) {
      case "drums":
        applyDrumEuclidean(selectedVoice, pulses, steps, rotation);
        break;
      case "bass":
        applyBassEuclidean(pulses, steps, rotation, noteMode, accentPulses, accentRotation);
        break;
      case "chords":
        applyChordsEuclidean(pulses, steps, rotation, noteMode, accentPulses, accentRotation);
        break;
      case "melody":
        applyMelodyEuclidean(pulses, steps, rotation, noteMode, accentPulses, accentRotation);
        break;
      case "layers":
        applyLayerEuclidean(pulses, steps, rotation, noteMode, melodyScale, melodyRoot, accentPulses, accentRotation);
        break;
    }
    onClose();
  }, [target, selectedVoice, pulses, steps, rotation, accentPulses, accentRotation, noteMode,
      applyDrumEuclidean, applyBassEuclidean, applyChordsEuclidean, applyMelodyEuclidean,
      applyLayerEuclidean, melodyScale, melodyRoot, onClose]);

  const mutate = useCallback(() => {
    // Random lightweight mutation: rotate, +/- pulse, nudge accent
    const roll = Math.random();
    if (roll < 0.35) {
      setRotation((r) => (r + 1 + Math.floor(Math.random() * (steps - 1))) % steps);
    } else if (roll < 0.6 && pulses < steps) {
      setPulses((p) => Math.min(steps, p + 1));
    } else if (roll < 0.8 && pulses > 1) {
      setPulses((p) => Math.max(1, p - 1));
    } else if (accentPulses > 0) {
      setAccentRotation((r) => (r + 1) % steps);
    } else {
      setAccentPulses(Math.max(1, Math.floor(pulses / 2)));
    }
  }, [steps, pulses, accentPulses]);

  const invert = useCallback(() => {
    // Logical inverse: complement pulses within steps
    const newPulses = steps - pulses;
    setPulses(newPulses);
  }, [steps, pulses]);

  const reset = useCallback(() => {
    setPulses(4);
    setSteps(16);
    setRotation(0);
    setAccentPulses(0);
    setAccentRotation(0);
  }, []);

  // ── Kit Fill: apply scaled base patterns to all 12 drum voices ──
  const handleFillKit = useCallback(() => {
    // density 0 → ~25 % of base pulses, density 1 → ~175 % (clamped to steps)
    const scale = 0.25 + kitDensity * 1.5;
    KIT_FILL_BASE.forEach((base, voiceIdx) => {
      const scaled = Math.max(1, Math.min(base.steps, Math.round(base.pulses * scale)));
      applyDrumEuclidean(voiceIdx, scaled, base.steps, base.rotation);
    });
    setActiveStyle(null);
  }, [kitDensity, applyDrumEuclidean]);

  // ── Groove Style: apply one style's voice map ──
  const handleApplyStyle = useCallback((style: GrooveStyle) => {
    // Apply defined voices; voices not in the map are left untouched
    Object.entries(style.voices).forEach(([idxStr, pat]) => {
      if (!pat) return;
      applyDrumEuclidean(Number(idxStr), pat.p, pat.s, pat.r);
    });
    setActiveStyle(style.name);
  }, [applyDrumEuclidean]);

  if (!isOpen) return null;

  // ── Polygon Visualizer ──
  // Classic Toussaint-style circular representation
  const polygonSize = 180;
  const cx = polygonSize / 2;
  const cy = polygonSize / 2;
  const r = polygonSize / 2 - 16;
  const activeIndices = rhythm.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
  const polygonPoints = activeIndices.map((i) => {
    const angle = (i / steps) * Math.PI * 2 - Math.PI / 2;
    return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
  }).join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-xl bg-[var(--ed-bg-secondary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-[var(--ed-text-primary)] tracking-wider">
              EUCLIDEAN GENERATOR
            </h2>
            <p className="text-[9px] text-[var(--ed-text-muted)] mt-0.5">
              E({pulses},{steps},{rotation}){accentPulses > 0 ? ` · A(${accentPulses},${steps},${accentRotation})` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg px-1">&times;</button>
        </div>

        {/* Target toggle */}
        <div className="flex gap-1 mb-4">
          {targetsWithLayerColor.map((t) => (
            <button
              key={t.id}
              onClick={() => setTarget(t.id)}
              className="flex-1 py-1.5 text-[9px] font-bold tracking-wider rounded-md transition-all border"
              style={{
                backgroundColor: target === t.id
                  ? `color-mix(in srgb, ${t.color} 18%, transparent)`
                  : "var(--ed-bg-surface)",
                color: target === t.id ? t.color : "var(--ed-text-muted)",
                borderColor: target === t.id
                  ? `color-mix(in srgb, ${t.color} 40%, transparent)`
                  : "transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Target info */}
        {!isSynth ? (
          <div className="text-[10px] text-[var(--ed-text-secondary)] mb-3">
            Apply to: <span className="font-bold" style={{ color: accentColor }}>{VOICE_LABELS[selectedVoice]}</span>
          </div>
        ) : target === "layers" ? (
          <div className="mb-3">
            <div className="text-[10px] text-[var(--ed-text-secondary)] mb-2">
              Active layer: <span className="font-bold" style={{ color: activeLayerColor }}>
                L{(layers.findIndex(l => l.id === activeLayerId) + 1)} · {activeLayer?.barLength ?? 2} bars
              </span>
              <span className="ml-2 opacity-60">· Scale: {melodyScale}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-[var(--ed-text-secondary)]">Note mode:</span>
              <div className="flex gap-1 flex-wrap">
                {NOTE_MODES.map((m) => (
                  <button key={m.id} onClick={() => setNoteMode(m.id)}
                    className="px-2 py-0.5 text-[9px] font-medium rounded-md transition-all"
                    style={{
                      backgroundColor: noteMode === m.id
                        ? `color-mix(in srgb, ${activeLayerColor} 18%, transparent)`
                        : "var(--ed-bg-surface)",
                      color: noteMode === m.id ? activeLayerColor : "var(--ed-text-muted)",
                    }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[10px] text-[var(--ed-text-secondary)]">Note mode:</span>
            <div className="flex gap-1 flex-wrap">
              {NOTE_MODES.map((m) => (
                <button key={m.id} onClick={() => setNoteMode(m.id)}
                  className="px-2 py-0.5 text-[9px] font-medium rounded-md transition-all"
                  style={{
                    backgroundColor: noteMode === m.id
                      ? `color-mix(in srgb, ${accentColor} 18%, transparent)`
                      : "var(--ed-bg-surface)",
                    color: noteMode === m.id ? accentColor : "var(--ed-text-muted)",
                  }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Main: circular viz + sliders */}
        <div className="flex gap-4 mb-4">
          {/* Polygon viz */}
          <div className="shrink-0">
            <svg width={polygonSize} height={polygonSize} viewBox={`0 0 ${polygonSize} ${polygonSize}`}>
              {/* Outer ring */}
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--ed-border-subtle)" strokeWidth="1" />
              {/* Step dots */}
              {Array.from({ length: steps }, (_, i) => {
                const angle = (i / steps) * Math.PI * 2 - Math.PI / 2;
                const x = cx + Math.cos(angle) * r;
                const y = cy + Math.sin(angle) * r;
                const on = rhythm[i];
                const acc = accent?.[i];
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={on ? (acc ? 5 : 3.5) : 1.5}
                    fill={on ? accentColor : "var(--ed-text-muted)"}
                    opacity={on ? (acc ? 1 : 0.7) : 0.4}
                    stroke={acc ? "white" : "none"}
                    strokeWidth={acc ? 1 : 0}
                  />
                );
              })}
              {/* Polygon connecting active hits */}
              {activeIndices.length >= 2 && (
                <polygon
                  points={polygonPoints}
                  fill={accentColor}
                  fillOpacity="0.08"
                  stroke={accentColor}
                  strokeOpacity="0.55"
                  strokeWidth="1"
                />
              )}
              {/* Rotation marker at step 0 */}
              <circle cx={cx} cy={cy - r - 10} r={2.5} fill="var(--ed-accent-blue)" />
            </svg>
          </div>

          {/* Sliders */}
          <div className="flex-1 flex flex-col gap-3">
            {/* Pulses */}
            <SliderRow
              label="Pulses"
              value={pulses}
              min={0}
              max={steps}
              color={accentColor}
              onChange={setPulses}
            />
            {/* Steps */}
            <SliderRow
              label="Steps"
              value={steps}
              min={2}
              max={32}
              color="var(--ed-accent-blue)"
              onChange={(v) => {
                setSteps(v);
                if (pulses > v) setPulses(v);
                if (rotation >= v) setRotation(0);
                if (accentRotation >= v) setAccentRotation(0);
                if (accentPulses > v) setAccentPulses(v);
              }}
            />
            {/* Rotation */}
            <SliderRow
              label="Rotate"
              value={rotation}
              min={0}
              max={Math.max(0, steps - 1)}
              color="var(--ed-pad-hybrid)"
              onChange={setRotation}
            />
          </div>
        </div>

        {/* Linear step preview */}
        <div className="grid gap-1 mb-4" style={{ gridTemplateColumns: `repeat(${Math.min(16, steps)}, minmax(0, 1fr))` }}>
          {rhythm.slice(0, 32).map((on, i) => {
            const acc = accent?.[i];
            return (
              <div
                key={i}
                className="relative h-6 rounded-sm flex items-center justify-center text-[8px] font-mono"
                style={{
                  backgroundColor: on
                    ? accentColor
                    : "var(--ed-bg-surface)",
                  color: on ? "#000" : "var(--ed-text-muted)",
                  fontWeight: on ? 700 : 400,
                  boxShadow: acc ? "inset 0 0 0 1.5px white" : "none",
                }}
              >
                {i + 1}
              </div>
            );
          })}
        </div>

        {/* Accent section — only for synths (drums already accent on beat 1) */}
        {isSynth && (
          <div className="mb-4 p-2.5 rounded-lg border border-[var(--ed-border-subtle)] bg-[var(--ed-bg-surface)]/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold tracking-wider" style={{ color: accentColor }}>
                ACCENT PATTERN
              </span>
              <span className="text-[8px] text-[var(--ed-text-muted)]">
                Second Euclidean marking velocity-accent steps
              </span>
            </div>
            <div className="flex gap-3">
              <SliderRow
                label="Pulses"
                value={accentPulses}
                min={0}
                max={steps}
                color={accentColor}
                onChange={setAccentPulses}
              />
              <SliderRow
                label="Rotate"
                value={accentRotation}
                min={0}
                max={Math.max(0, steps - 1)}
                color="var(--ed-pad-hybrid)"
                onChange={setAccentRotation}
              />
            </div>
          </div>
        )}

        {/* ── Groove Styles (drums only) ── */}
        <div className="mb-3 p-2.5 rounded-lg border border-[var(--ed-border-subtle)] bg-[var(--ed-bg-surface)]/40">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-bold tracking-wider" style={{ color: "var(--ed-accent-orange)" }}>
              GROOVE STYLES
            </span>
            <span className="text-[7px] text-[var(--ed-text-muted)]">Fills all drum voices at once</span>
          </div>
          <div className="grid grid-cols-4 gap-1 mb-2">
            {GROOVE_STYLES.map((style) => {
              const isActive = activeStyle === style.name;
              return (
                <button
                  key={style.name}
                  onClick={() => handleApplyStyle(style)}
                  title={style.hint}
                  className="flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-lg transition-all border"
                  style={{
                    background:   isActive ? "color-mix(in srgb, var(--ed-accent-orange) 15%, transparent)" : "var(--ed-bg-surface)",
                    borderColor:  isActive ? "color-mix(in srgb, var(--ed-accent-orange) 40%, transparent)" : "var(--ed-border-subtle)",
                    color:        isActive ? "var(--ed-accent-orange)" : "var(--ed-text-secondary)",
                  }}
                >
                  <span className="text-[11px] leading-none">{style.emoji}</span>
                  <span className="text-[7px] font-bold tracking-wide">{style.name.toUpperCase()}</span>
                </button>
              );
            })}
          </div>
          {activeStyle && (
            <div className="text-[8px] text-center" style={{ color: "var(--ed-accent-orange)" }}>
              ✓ {activeStyle} applied — tweak individual voices or hit RESET to clear
            </div>
          )}
        </div>

        {/* ── Kit Fill ── */}
        <div className="mb-3 p-2.5 rounded-lg border border-[var(--ed-border-subtle)] bg-[var(--ed-bg-surface)]/40">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-bold tracking-wider" style={{ color: "var(--ed-accent-orange)" }}>
              KIT FILL
            </span>
            <span className="text-[7px] text-[var(--ed-text-muted)]">Scale all voices by density</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-[7px] font-bold text-[var(--ed-text-muted)] w-12">SPARSE</span>
              <input
                type="range" min={0} max={100} value={Math.round(kitDensity * 100)}
                onChange={(e) => setKitDensity(Number(e.target.value) / 100)}
                className="flex-1 h-1.5"
                style={{ accentColor: "var(--ed-accent-orange)" }}
              />
              <span className="text-[7px] font-bold text-[var(--ed-text-muted)] w-12 text-right">DENSE</span>
            </div>
            <button
              onClick={handleFillKit}
              className="shrink-0 px-3 py-1.5 text-[9px] font-bold rounded-lg transition-all border"
              style={{
                background:   "color-mix(in srgb, var(--ed-accent-orange) 15%, transparent)",
                borderColor:  "color-mix(in srgb, var(--ed-accent-orange) 35%, transparent)",
                color:        "var(--ed-accent-orange)",
              }}
            >
              FILL KIT
            </button>
          </div>
          {/* Mini density preview — shows pulse counts */}
          <div className="flex gap-0.5 mt-2 flex-wrap">
            {KIT_FILL_BASE.map((base, i) => {
              const scale  = 0.25 + kitDensity * 1.5;
              const scaled = Math.max(1, Math.min(base.steps, Math.round(base.pulses * scale)));
              return (
                <div key={i} className="flex flex-col items-center gap-0.5 flex-1 min-w-[32px]">
                  <div className="text-[5px] font-bold text-white/25">{VOICE_LABELS[i]}</div>
                  <div className="text-[8px] font-bold tabular-nums" style={{ color: "var(--ed-accent-orange)" }}>
                    {scaled}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Presets */}
        <div className="mb-3">
          <div className="text-[8px] font-bold text-[var(--ed-text-muted)] tracking-wider mb-1">SINGLE-VOICE PRESETS</div>
          <div className="flex gap-1 flex-wrap">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => { setPulses(preset.p); setSteps(preset.s); setRotation(preset.r ?? 0); }}
                title={preset.hint}
                className="px-2 py-1 text-[9px] rounded bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)] hover:text-[var(--ed-text-primary)] transition-colors"
              >
                E({preset.label})
              </button>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={mutate}
            className="flex-1 py-1.5 text-[10px] rounded-md bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)] hover:text-[var(--ed-text-primary)] transition-colors"
            title="Randomly rotate / add / remove a pulse"
          >
            🎲 MUTATE
          </button>
          <button
            onClick={invert}
            className="flex-1 py-1.5 text-[10px] rounded-md bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)] hover:text-[var(--ed-text-primary)] transition-colors"
            title="Invert: swap hits and rests"
          >
            ⇋ INVERT
          </button>
          <button
            onClick={reset}
            className="flex-1 py-1.5 text-[10px] rounded-md bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)] hover:text-[var(--ed-text-primary)] transition-colors"
            title="Reset to E(4,16)"
          >
            ↺ RESET
          </button>
        </div>

        {/* Apply */}
        <button onClick={handleApply}
          className="w-full py-2 text-sm font-bold text-black rounded-lg hover:brightness-110 transition-all"
          style={{ backgroundColor: accentColor }}>
          APPLY TO {!isSynth ? VOICE_LABELS[selectedVoice] : activeTarget.label}
        </button>
      </div>
    </div>
  );
}

function SliderRow({ label, value, min, max, color, onChange }: {
  label: string; value: number; min: number; max: number; color: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-bold text-[var(--ed-text-muted)] tracking-wider w-12">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5"
        style={{ accentColor: color }}
      />
      <span className="text-[11px] font-mono min-w-[1.5rem] text-right" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
