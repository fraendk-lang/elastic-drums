import { useDrumStore } from "../store/drumStore";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM LO",
  "TOM MID", "TOM HI", "HH CL", "HH OP",
  "CYMBAL", "RIDE", "PERC 1", "PERC 2",
];

const VOICE_COLORS = [
  "var(--ed-pad-va)", "var(--ed-pad-va)", "var(--ed-pad-va)", "var(--ed-pad-va)",
  "var(--ed-pad-va)", "var(--ed-pad-va)", "var(--ed-pad-sample)", "var(--ed-pad-sample)",
  "var(--ed-pad-sample)", "var(--ed-pad-sample)", "var(--ed-pad-hybrid)", "var(--ed-pad-hybrid)",
];

export function PadGrid() {
  const { selectedVoice, setSelectedVoice, triggerVoice } = useDrumStore();

  return (
    <div className="p-3">
      <div className="grid grid-cols-4 gap-2">
        {VOICE_LABELS.map((label, i) => (
          <button
            key={i}
            onMouseDown={() => triggerVoice(i)}
            onClick={() => setSelectedVoice(i)}
            className={`relative flex flex-col items-center justify-center h-16 rounded-lg transition-all active:scale-95 ${
              selectedVoice === i
                ? "ring-2 ring-[var(--ed-accent-orange)] bg-[var(--ed-bg-elevated)]"
                : "bg-[var(--ed-bg-surface)] hover:bg-[var(--ed-bg-elevated)]"
            }`}
          >
            <div
              className="w-2 h-2 rounded-full mb-1"
              style={{ backgroundColor: VOICE_COLORS[i] }}
            />
            <span className="text-[10px] font-medium text-[var(--ed-text-secondary)]">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
