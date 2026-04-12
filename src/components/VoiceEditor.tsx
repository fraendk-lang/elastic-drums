import { useState, useCallback, useEffect } from "react";
import { useDrumStore } from "../store/drumStore";
import { audioEngine, VOICE_PARAM_DEFS } from "../audio/AudioEngine";
import { Knob } from "./Knob";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM LO",
  "TOM MID", "TOM HI", "HH CL", "HH OP",
  "CYMBAL", "RIDE", "PERC 1", "PERC 2",
];

export function VoiceEditor() {
  const { selectedVoice, heldStep, setParamLock } = useDrumStore();
  const pattern = useDrumStore((s) => s.pattern);
  const defs = VOICE_PARAM_DEFS[selectedVoice] ?? [];

  const [values, setValues] = useState<Record<string, number>>({});

  useEffect(() => {
    const params = audioEngine.getVoiceParams(selectedVoice);
    setValues({ ...params });
  }, [selectedVoice]);

  const heldStepData = heldStep
    ? pattern.tracks[heldStep.track]?.steps[heldStep.step]
    : null;

  const handleChange = useCallback(
    (paramId: string, value: number) => {
      if (heldStep && heldStep.track === selectedVoice) {
        setParamLock(heldStep.track, heldStep.step, paramId, value);
      } else {
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

      <div className="flex flex-wrap gap-2 justify-center">
        {defs.map((def) => {
          const lockVal = isLockMode ? heldStepData?.paramLocks[def.id] : undefined;
          const displayVal = lockVal ?? values[def.id] ?? def.default;
          const hasLock = lockVal !== undefined;

          return (
            <Knob
              key={def.id}
              value={displayVal}
              min={def.min}
              max={def.max}
              defaultValue={def.default}
              label={hasLock ? `${def.label} ●` : def.label}
              color={isLockMode ? "var(--ed-accent-green)" : hasLock ? "var(--ed-accent-green)" : "var(--ed-accent-orange)"}
              size={46}
              onChange={(v) => handleChange(def.id, v)}
            />
          );
        })}
      </div>
    </div>
  );
}
