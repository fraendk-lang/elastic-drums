import { useState, useCallback, useMemo } from "react";
import { useDrumStore, generateEuclidean } from "../store/drumStore";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM L", "TOM M", "TOM H",
  "HH CL", "HH OP", "CYM", "RIDE", "PRC1", "PRC2",
];

const NOTE_MODES = [
  { id: "root", label: "Root" },
  { id: "ascending", label: "Ascending" },
  { id: "random", label: "Random" },
];

type Target = "drums" | "bass" | "chords" | "melody";

const TARGETS: { id: Target; label: string; color: string }[] = [
  { id: "drums", label: "DRUMS", color: "var(--ed-accent-orange)" },
  { id: "bass", label: "BASS", color: "var(--ed-accent-bass)" },
  { id: "chords", label: "CHORDS", color: "var(--ed-accent-chords)" },
  { id: "melody", label: "MELODY", color: "var(--ed-accent-melody)" },
];

interface EuclideanGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EuclideanGenerator({ isOpen, onClose }: EuclideanGeneratorProps) {
  const { selectedVoice, applyEuclidean: applyDrumEuclidean } = useDrumStore();
  const { applyEuclidean: applyBassEuclidean } = useBassStore();
  const { applyEuclidean: applyChordsEuclidean } = useChordsStore();
  const { applyEuclidean: applyMelodyEuclidean } = useMelodyStore();

  const [target, setTarget] = useState<Target>("drums");
  const [pulses, setPulses] = useState(4);
  const [steps, setSteps] = useState(16);
  const [rotation, setRotation] = useState(0);
  const [noteMode, setNoteMode] = useState("root");

  const preview = useMemo(
    () => generateEuclidean(pulses, steps, rotation),
    [pulses, steps, rotation],
  );

  const handleApply = useCallback(() => {
    switch (target) {
      case "drums": applyDrumEuclidean(selectedVoice, pulses, steps, rotation); break;
      case "bass": applyBassEuclidean(pulses, steps, rotation, noteMode); break;
      case "chords": applyChordsEuclidean(pulses, steps, rotation, noteMode); break;
      case "melody": applyMelodyEuclidean(pulses, steps, rotation, noteMode); break;
    }
    onClose();
  }, [target, selectedVoice, pulses, steps, rotation, noteMode, applyDrumEuclidean, applyBassEuclidean, applyChordsEuclidean, applyMelodyEuclidean, onClose]);

  if (!isOpen) return null;

  const activeTarget = TARGETS.find((t) => t.id === target)!;
  const accentColor = activeTarget.color;
  const isSynth = target !== "drums"; // bass, chords, melody all use note modes

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-[var(--ed-bg-secondary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[var(--ed-text-primary)] tracking-wider">
            EUCLIDEAN GENERATOR
          </h2>
          <button onClick={onClose} className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg px-1">&times;</button>
        </div>

        {/* Target toggle: DRUMS | BASS | CHORDS | MELODY */}
        <div className="flex gap-1 mb-4">
          {TARGETS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTarget(t.id)}
              className={`flex-1 py-1.5 text-[9px] font-bold tracking-wider rounded-md transition-all ${
                target === t.id
                  ? "border text-white/90"
                  : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] border border-transparent hover:text-[var(--ed-text-secondary)]"
              }`}
              style={target === t.id ? {
                backgroundColor: `color-mix(in srgb, ${t.color} 15%, transparent)`,
                color: t.color,
                borderColor: `color-mix(in srgb, ${t.color} 30%, transparent)`,
              } : undefined}
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
        ) : (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] text-[var(--ed-text-secondary)]">Note mode:</span>
            <div className="flex gap-1">
              {NOTE_MODES.map((m) => (
                <button key={m.id} onClick={() => setNoteMode(m.id)}
                  className={`px-2 py-0.5 text-[9px] font-medium rounded-md transition-all ${
                    noteMode === m.id
                      ? "text-white/90 bg-white/10"
                      : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)] bg-[var(--ed-bg-surface)]"
                  }`}
                  style={noteMode === m.id ? { color: accentColor, backgroundColor: `color-mix(in srgb, ${accentColor} 15%, transparent)` } : undefined}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="flex flex-col items-center gap-1">
            <span className="text-lg font-mono" style={{ color: accentColor }}>{pulses}</span>
            <input type="range" min={0} max={steps} value={pulses}
              onChange={(e) => setPulses(Number(e.target.value))}
              style={{ accentColor }} className="w-full" />
            <span className="text-[10px] text-[var(--ed-text-muted)]">PULSES</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-lg font-mono text-[var(--ed-accent-blue)]">{steps}</span>
            <input type="range" min={2} max={32} value={steps}
              onChange={(e) => {
                const s = Number(e.target.value);
                setSteps(s);
                if (pulses > s) setPulses(s);
                if (rotation >= s) setRotation(0);
              }}
              className="w-full accent-[var(--ed-accent-blue)]" />
            <span className="text-[10px] text-[var(--ed-text-muted)]">STEPS</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-lg font-mono text-[var(--ed-pad-hybrid)]">{rotation}</span>
            <input type="range" min={0} max={steps - 1} value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="w-full accent-[var(--ed-pad-hybrid)]" />
            <span className="text-[10px] text-[var(--ed-text-muted)]">ROTATION</span>
          </div>
        </div>

        {/* Pattern preview */}
        <div className="flex gap-1 mb-4 flex-wrap">
          {preview.map((on, i) => (
            <div key={i}
              className={`w-6 h-6 rounded-sm flex items-center justify-center text-[9px] font-mono ${
                on ? "text-black font-bold" : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)]"
              }`}
              style={on ? { backgroundColor: accentColor } : undefined}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Common presets */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {[
            { label: "4/16", p: 4, s: 16 },
            { label: "3/8", p: 3, s: 8 },
            { label: "5/8", p: 5, s: 8 },
            { label: "7/16", p: 7, s: 16 },
            { label: "5/16", p: 5, s: 16 },
            { label: "3/16", p: 3, s: 16 },
            { label: "9/16", p: 9, s: 16 },
            { label: "13/16", p: 13, s: 16 },
          ].map((preset) => (
            <button key={preset.label}
              onClick={() => { setPulses(preset.p); setSteps(preset.s); setRotation(0); }}
              className="px-2 py-1 text-[10px] rounded bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)] hover:text-[var(--ed-text-primary)] transition-colors">
              E({preset.label})
            </button>
          ))}
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
