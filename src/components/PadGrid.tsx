import { useState, useCallback, useRef } from "react";
import { useDrumStore } from "../store/drumStore";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM LO",
  "TOM MID", "TOM HI", "HH CL", "HH OP",
  "CYMBAL", "RIDE", "PERC 1", "PERC 2",
];

const VOICE_COLORS = [
  "#f59e0b", "#f59e0b", "#f59e0b", "#f59e0b",
  "#f59e0b", "#f59e0b", "#3b82f6", "#3b82f6",
  "#3b82f6", "#3b82f6", "#8b5cf6", "#8b5cf6",
];

export function PadGrid() {
  const { selectedVoice, setSelectedVoice, triggerVoice } = useDrumStore();
  const [triggered, setTriggered] = useState<Set<number>>(new Set());
  const timeouts = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const handlePadDown = useCallback((i: number) => {
    triggerVoice(i);
    setSelectedVoice(i);

    // Flash animation
    setTriggered((prev) => new Set(prev).add(i));

    // Clear previous timeout for this pad
    const prev = timeouts.current.get(i);
    if (prev) clearTimeout(prev);

    const timeout = setTimeout(() => {
      setTriggered((prev) => {
        const next = new Set(prev);
        next.delete(i);
        return next;
      });
    }, 120);
    timeouts.current.set(i, timeout);
  }, [triggerVoice, setSelectedVoice]);

  return (
    <div className="p-3">
      <div className="grid grid-cols-4 gap-2">
        {VOICE_LABELS.map((label, i) => {
          const isSelected = selectedVoice === i;
          const isTriggered = triggered.has(i);
          const color = VOICE_COLORS[i]!;

          return (
            <button
              key={i}
              onMouseDown={() => handlePadDown(i)}
              className={`relative flex flex-col items-center justify-center h-16 rounded-lg transition-all ${
                isTriggered ? "scale-95" : "scale-100"
              } ${
                isSelected
                  ? "ring-2 bg-[var(--ed-bg-elevated)]"
                  : "bg-[var(--ed-bg-surface)] hover:bg-[var(--ed-bg-elevated)]"
              }`}
              style={{
                boxShadow: isTriggered
                  ? `0 0 20px ${color}40, inset 0 0 15px ${color}30`
                  : isSelected
                    ? `0 0 8px ${color}20, inset 0 0 0 2px ${color}`
                    : "none",
                borderColor: isSelected ? color : "transparent",
                borderWidth: "1px",
                borderStyle: "solid",
              }}
            >
              {/* Trigger flash overlay */}
              {isTriggered && (
                <div
                  className="absolute inset-0 rounded-lg opacity-30"
                  style={{ backgroundColor: color }}
                />
              )}

              {/* Color dot */}
              <div
                className="w-2.5 h-2.5 rounded-full mb-1 transition-all"
                style={{
                  backgroundColor: color,
                  boxShadow: isTriggered ? `0 0 8px ${color}` : "none",
                }}
              />
              <span className="text-[10px] font-medium text-[var(--ed-text-secondary)]">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
