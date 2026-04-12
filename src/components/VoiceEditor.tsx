import { useDrumStore } from "../store/drumStore";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM LO",
  "TOM MID", "TOM HI", "HH CL", "HH OP",
  "CYMBAL", "RIDE", "PERC 1", "PERC 2",
];

const KICK_PARAMS = [
  { id: "tune", label: "TUNE", min: 20, max: 200, default: 60 },
  { id: "decay", label: "DECAY", min: 50, max: 2000, default: 400 },
  { id: "click", label: "CLICK", min: 0, max: 100, default: 50 },
  { id: "drive", label: "DRIVE", min: 0, max: 100, default: 20 },
  { id: "sub", label: "SUB", min: 0, max: 100, default: 30 },
  { id: "tone", label: "TONE", min: 0, max: 100, default: 50 },
];

export function VoiceEditor() {
  const { selectedVoice } = useDrumStore();

  return (
    <div className="flex-1 p-3 border-t border-[var(--ed-border)]">
      <h3 className="text-xs font-semibold text-[var(--ed-text-secondary)] mb-3">
        {VOICE_LABELS[selectedVoice]} — PARAMETERS
      </h3>

      <div className="grid grid-cols-3 gap-3">
        {KICK_PARAMS.map((param) => (
          <div key={param.id} className="flex flex-col items-center gap-1">
            <input
              type="range"
              min={param.min}
              max={param.max}
              defaultValue={param.default}
              className="w-full h-1 accent-[var(--ed-accent-orange)] bg-[var(--ed-bg-surface)] rounded-full"
            />
            <span className="text-[9px] font-medium text-[var(--ed-text-muted)]">
              {param.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
