import { useState, useCallback, useEffect } from "react";
import { useDrumStore } from "../store/drumStore";
import { audioEngine, VOICE_PARAM_DEFS } from "../audio/AudioEngine";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM LO",
  "TOM MID", "TOM HI", "HH CL", "HH OP",
  "CYMBAL", "RIDE", "PERC 1", "PERC 2",
];

export function VoiceEditor() {
  const { selectedVoice, heldStep, setParamLock } = useDrumStore();
  const pattern = useDrumStore((s) => s.pattern);
  const defs = VOICE_PARAM_DEFS[selectedVoice] ?? [];

  // Local state for parameter values
  const [values, setValues] = useState<Record<string, number>>({});

  // Sync values from engine when voice changes
  useEffect(() => {
    const params = audioEngine.getVoiceParams(selectedVoice);
    setValues({ ...params });
  }, [selectedVoice]);

  // Show P-Lock values when a step is held
  const heldStepData = heldStep
    ? pattern.tracks[heldStep.track]?.steps[heldStep.step]
    : null;

  const handleChange = useCallback(
    (paramId: string, value: number) => {
      if (heldStep && heldStep.track === selectedVoice) {
        // P-Lock mode: write to the held step
        setParamLock(heldStep.track, heldStep.step, paramId, value);
      } else {
        // Normal mode: write to the voice's global params
        audioEngine.setVoiceParam(selectedVoice, paramId, value);
      }
      setValues((prev) => ({ ...prev, [paramId]: value }));
    },
    [selectedVoice, heldStep, setParamLock],
  );

  const isLockMode = heldStep !== null && heldStep.track === selectedVoice;

  return (
    <div className="flex-1 p-3 border-t border-[var(--ed-border)] overflow-auto">
      <h3 className="text-xs font-semibold tracking-wide mb-3 flex items-center gap-2">
        <span className="text-[var(--ed-text-secondary)]">
          {VOICE_LABELS[selectedVoice]}
        </span>
        {isLockMode ? (
          <span className="text-[var(--ed-accent-green)] text-[10px] font-bold animate-pulse">
            P-LOCK Step {heldStep.step + 1}
          </span>
        ) : (
          <span className="text-[var(--ed-text-muted)] text-[10px]">
            PARAMETERS
          </span>
        )}
      </h3>

      <div className="grid grid-cols-3 gap-x-3 gap-y-4">
        {defs.map((def) => {
          // In P-Lock mode, show the locked value (if exists) or global value
          const globalVal = audioEngine.getVoiceParam(selectedVoice, def.id);
          const lockVal = isLockMode ? heldStepData?.paramLocks[def.id] : undefined;
          const displayVal = lockVal ?? values[def.id] ?? def.default;
          const hasLock = lockVal !== undefined;

          return (
            <div key={def.id} className="flex flex-col items-center gap-1">
              {/* Value display */}
              <span
                className={`text-[10px] font-mono tabular-nums ${
                  hasLock
                    ? "text-[var(--ed-accent-green)]"
                    : "text-[var(--ed-accent-orange)]"
                }`}
              >
                {Math.round(displayVal)}
                {hasLock && " ●"}
              </span>

              {/* Slider */}
              <input
                type="range"
                min={def.min}
                max={def.max}
                step={def.step ?? 1}
                value={displayVal}
                onChange={(e) => handleChange(def.id, Number(e.target.value))}
                className={`w-full h-1.5 rounded-full cursor-pointer ${
                  hasLock
                    ? "accent-[var(--ed-accent-green)]"
                    : isLockMode
                      ? "accent-[var(--ed-accent-green)]"
                      : "accent-[var(--ed-accent-orange)]"
                } bg-[var(--ed-bg-surface)]`}
              />

              {/* Label — shows global value in P-Lock mode */}
              <span className="text-[9px] font-medium text-[var(--ed-text-muted)]">
                {def.label}
                {isLockMode && !hasLock && (
                  <span className="text-[var(--ed-text-muted)]"> ({Math.round(globalVal)})</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
