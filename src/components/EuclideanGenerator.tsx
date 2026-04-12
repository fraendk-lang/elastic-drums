import { useState, useCallback, useMemo } from "react";
import { useDrumStore, generateEuclidean } from "../store/drumStore";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM L", "TOM M", "TOM H",
  "HH CL", "HH OP", "CYM", "RIDE", "PRC1", "PRC2",
];

interface EuclideanGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EuclideanGenerator({ isOpen, onClose }: EuclideanGeneratorProps) {
  const { selectedVoice, applyEuclidean } = useDrumStore();
  const [pulses, setPulses] = useState(4);
  const [steps, setSteps] = useState(16);
  const [rotation, setRotation] = useState(0);

  // Live preview
  const preview = useMemo(
    () => generateEuclidean(pulses, steps, rotation),
    [pulses, steps, rotation],
  );

  const handleApply = useCallback(() => {
    applyEuclidean(selectedVoice, pulses, steps, rotation);
    onClose();
  }, [selectedVoice, pulses, steps, rotation, applyEuclidean, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-md bg-[var(--ed-bg-secondary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[var(--ed-text-primary)] tracking-wider">
            EUCLIDEAN GENERATOR — {VOICE_LABELS[selectedVoice]}
          </h2>
          <button onClick={onClose} className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg">✕</button>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="flex flex-col items-center gap-1">
            <span className="text-lg font-mono text-[var(--ed-accent-orange)]">{pulses}</span>
            <input
              type="range" min={0} max={steps} value={pulses}
              onChange={(e) => setPulses(Number(e.target.value))}
              className="w-full accent-[var(--ed-accent-orange)]"
            />
            <span className="text-[10px] text-[var(--ed-text-muted)]">PULSES</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-lg font-mono text-[var(--ed-accent-blue)]">{steps}</span>
            <input
              type="range" min={2} max={32} value={steps}
              onChange={(e) => {
                const s = Number(e.target.value);
                setSteps(s);
                if (pulses > s) setPulses(s);
                if (rotation >= s) setRotation(0);
              }}
              className="w-full accent-[var(--ed-accent-blue)]"
            />
            <span className="text-[10px] text-[var(--ed-text-muted)]">STEPS</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-lg font-mono text-[var(--ed-pad-hybrid)]">{rotation}</span>
            <input
              type="range" min={0} max={steps - 1} value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="w-full accent-[var(--ed-pad-hybrid)]"
            />
            <span className="text-[10px] text-[var(--ed-text-muted)]">ROTATION</span>
          </div>
        </div>

        {/* Pattern preview */}
        <div className="flex gap-1 mb-4 flex-wrap">
          {preview.map((on, i) => (
            <div
              key={i}
              className={`w-6 h-6 rounded-sm flex items-center justify-center text-[9px] font-mono ${
                on
                  ? "bg-[var(--ed-accent-orange)] text-black font-bold"
                  : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)]"
              }`}
            >
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
            <button
              key={preset.label}
              onClick={() => { setPulses(preset.p); setSteps(preset.s); setRotation(0); }}
              className="px-2 py-1 text-[10px] rounded bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)] hover:text-[var(--ed-text-primary)] transition-colors"
            >
              E({preset.label})
            </button>
          ))}
        </div>

        {/* Apply */}
        <button
          onClick={handleApply}
          className="w-full py-2 text-sm font-bold bg-[var(--ed-accent-orange)] text-black rounded-lg hover:brightness-110 transition-all"
        >
          APPLY TO {VOICE_LABELS[selectedVoice]}
        </button>
      </div>
    </div>
  );
}
