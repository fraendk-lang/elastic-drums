/**
 * AutomationLane — Ableton-style per-step parameter automation
 *
 * Renders a narrow vertical bar chart to the right of the piano roll.
 * Each bar represents one step's automation value.
 * Click/drag to draw values. Select parameter via header dropdown.
 */

import { useCallback, useRef } from "react";

export interface AutomationParam {
  id: string;
  label: string;
  min: number;
  max: number;
}

interface AutomationLaneProps {
  params: AutomationParam[];       // Available parameters
  selectedParam: string;           // Currently selected param id
  values: number[];                // 64 values (full pattern)
  length: number;                  // Active pattern length
  pageOffset: number;              // Current page offset
  currentStep: number;             // Playhead position
  isPlaying: boolean;
  color: string;                   // Accent color (CSS variable)
  onSelectParam: (paramId: string) => void;
  onChange: (step: number, value: number) => void;
}

export function AutomationLane({
  params, selectedParam, values, length, pageOffset, currentStep, isPlaying,
  color, onSelectParam, onChange,
}: AutomationLaneProps) {
  const dragRef = useRef<{ active: boolean; min: number; max: number }>({ active: false, min: 0, max: 1 });
  const containerRef = useRef<HTMLDivElement>(null);

  const paramDef = params.find((p) => p.id === selectedParam);
  const min = paramDef?.min ?? 0;
  const max = paramDef?.max ?? 100;

  const handleBarInteraction = useCallback((e: React.MouseEvent, absStep: number) => {
    if (absStep >= length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const value = Math.round(min + y * (max - min));
    onChange(absStep, value);
  }, [length, min, max, onChange]);

  const handleMouseDown = useCallback((e: React.MouseEvent, absStep: number) => {
    e.preventDefault();
    handleBarInteraction(e, absStep);
    dragRef.current = { active: true, min, max };

    const handleMove = (me: MouseEvent) => {
      if (!dragRef.current.active || !containerRef.current) return;
      // Find which step column the mouse is over
      const containerRect = containerRef.current.getBoundingClientRect();
      const relX = me.clientX - containerRect.left;
      const stepWidth = containerRect.width / 16;
      const stepIdx = Math.floor(relX / stepWidth);
      if (stepIdx < 0 || stepIdx >= 16) return;
      const absIdx = pageOffset + stepIdx;
      if (absIdx >= length) return;

      // Calculate Y value
      const barTop = containerRect.top;
      const barHeight = containerRect.height;
      const y = 1 - Math.max(0, Math.min(1, (me.clientY - barTop) / barHeight));
      const val = Math.round(dragRef.current.min + y * (dragRef.current.max - dragRef.current.min));
      onChange(absIdx, val);
    };

    const handleUp = () => {
      dragRef.current.active = false;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [handleBarInteraction, pageOffset, length, min, max, onChange]);

  return (
    <div className="w-28 shrink-0 flex flex-col gap-0.5 hidden sm:flex">
      {/* Parameter selector */}
      <select
        value={selectedParam}
        onChange={(e) => onSelectParam(e.target.value)}
        className="h-5 px-1 text-[7px] font-bold bg-black/30 border border-white/8 rounded text-white/50 focus:outline-none appearance-none cursor-pointer truncate"
        style={{ color }}
      >
        {params.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>

      {/* Bars */}
      <div ref={containerRef} className="flex-1 flex gap-px min-h-0 relative">
        {/* Grid lines */}
        <div className="absolute inset-0 pointer-events-none">
          {[0.25, 0.5, 0.75].map((pct) => (
            <div key={pct} className="absolute left-0 right-0 h-px bg-white/[0.04]" style={{ bottom: `${pct * 100}%` }} />
          ))}
        </div>

        {Array.from({ length: 16 }, (_, i) => {
          const absStep = pageOffset + i;
          const raw = values[absStep] ?? min;
          const pct = Math.max(0, Math.min(100, ((raw - min) / (max - min)) * 100));
          const isCurrent = isPlaying && currentStep === absStep;
          const beyondLength = absStep >= length;
          const hasValue = values[absStep] !== undefined;

          return (
            <div
              key={i}
              className={`flex-1 flex flex-col justify-end min-w-0 relative cursor-crosshair ${beyondLength ? "opacity-20" : ""}`}
              onMouseDown={(e) => handleMouseDown(e, absStep)}
            >
              {/* Value bar */}
              <div
                className="w-full rounded-t-sm transition-[height] duration-75"
                style={{
                  height: hasValue ? `${pct}%` : "0%",
                  minHeight: hasValue ? 2 : 0,
                  backgroundColor: color,
                  opacity: isCurrent ? 0.9 : 0.4,
                  boxShadow: isCurrent ? `0 0 6px ${color}40` : "none",
                }}
              />

              {/* Playhead dot */}
              {isCurrent && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                  style={{ backgroundColor: color }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
