import { useState, useCallback, useEffect, useRef } from "react";
import { useDrumStore } from "../store/drumStore";
import { audioEngine, VOICE_PARAM_DEFS } from "../audio/AudioEngine";
import { Knob } from "./Knob";

const PERC_TYPE_NAMES = ["CONGA", "BONGO", "RIM", "COWBELL", "SHAKER", "CLAVES", "TAMB", "TRIANGLE"];

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM LO",
  "TOM MID", "TOM HI", "HH CL", "HH OP",
  "CYMBAL", "RIDE", "PERC 1", "PERC 2",
];

export function VoiceEditor() {
  const { selectedVoice, heldStep, setParamLock, isPlaying, currentStep, pattern } = useDrumStore();
  const defs = VOICE_PARAM_DEFS[selectedVoice] ?? [];

  const [values, setValues] = useState<Record<string, number>>({});
  const [motionRec, setMotionRec] = useState(false);
  const lastRecStep = useRef(-1);

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
      } else if (motionRec && isPlaying) {
        const step = currentStep % pattern.length;
        if (step !== lastRecStep.current) {
          lastRecStep.current = step;
          setParamLock(selectedVoice, step, paramId, value);
        }
        audioEngine.setVoiceParam(selectedVoice, paramId, value);
      } else {
        audioEngine.setVoiceParam(selectedVoice, paramId, value);
      }
      setValues((prev) => ({ ...prev, [paramId]: value }));
    },
    [selectedVoice, heldStep, setParamLock, motionRec, isPlaying, currentStep, pattern.length],
  );

  const isLockMode = heldStep !== null && heldStep.track === selectedVoice;

  return (
    <div className="flex-1 p-3 border-t border-[var(--ed-border)]/50 overflow-auto">
      {/* Header with Motion Rec toggle */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold tracking-wide flex items-center gap-2">
          <span className="text-[var(--ed-text-primary)]">
            {VOICE_LABELS[selectedVoice]}
            {(selectedVoice === 10 || selectedVoice === 11) && (
              <span className="text-[var(--ed-pad-hybrid)] ml-1.5 text-[9px] font-medium">
                {PERC_TYPE_NAMES[Math.round(values.type ?? 0)] ?? ""}
              </span>
            )}
          </span>
          {isLockMode ? (
            <span className="text-[var(--ed-accent-green)] text-[9px] font-bold animate-pulse px-1.5 py-0.5 rounded bg-[var(--ed-accent-green)]/10">
              P-LOCK Step {heldStep.step + 1}
            </span>
          ) : motionRec && isPlaying ? (
            <span className="text-[var(--ed-accent-red)] text-[9px] font-bold animate-pulse px-1.5 py-0.5 rounded bg-[var(--ed-accent-red)]/10">
              REC
            </span>
          ) : (
            <span className="text-[var(--ed-text-muted)] text-[9px] font-medium">
              PARAMS
            </span>
          )}
        </h3>

        {/* Motion Rec button */}
        <button
          onClick={() => setMotionRec((r) => !r)}
          className={`px-2.5 py-1 text-[9px] font-bold rounded-md transition-all ${
            motionRec
              ? "bg-[var(--ed-accent-red)] text-white shadow-[0_0_12px_rgba(239,68,68,0.2)]"
              : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)]"
          }`}
        >
          {motionRec ? "REC" : "REC"}
        </button>
      </div>

      {/* Knobs */}
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
              label={hasLock ? `${def.label} \u25CF` : def.label}
              color={
                motionRec && isPlaying
                  ? "var(--ed-accent-red)"
                  : isLockMode || hasLock
                    ? "var(--ed-accent-green)"
                    : "var(--ed-accent-orange)"
              }
              size={46}
              onChange={(v) => handleChange(def.id, v)}
            />
          );
        })}
      </div>
    </div>
  );
}
