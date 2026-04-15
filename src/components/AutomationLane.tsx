/**
 * AutomationLane — curve-style automation editor
 *
 * Renders a compact automation lane with breakpoints, connecting curve,
 * value fill, and direct draw editing across the current 16-step page.
 */

import { useCallback, useMemo, useRef } from "react";

export interface AutomationParam {
  id: string;
  label: string;
  min: number;
  max: number;
}

interface AutomationLaneProps {
  params: AutomationParam[];       // Available parameters
  selectedParam: string;           // Currently selected param id
  values: Array<number | undefined>; // 64 values (full pattern)
  length: number;                  // Active pattern length
  pageOffset: number;              // Current page offset
  currentStep: number;             // Playhead position
  isPlaying: boolean;
  color: string;                   // Accent color (CSS variable)
  onSelectParam: (paramId: string) => void;
  onChange: (step: number, value: number | undefined) => void;
}

export function AutomationLane({
  params, selectedParam, values, length, pageOffset, currentStep, isPlaying,
  color, onSelectParam, onChange,
}: AutomationLaneProps) {
  const dragRef = useRef<{ active: boolean; min: number; max: number; lastStep: number | null; lastValue: number | null }>({
    active: false, min: 0, max: 1, lastStep: null, lastValue: null,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const paramDef = params.find((p) => p.id === selectedParam);
  const min = paramDef?.min ?? 0;
  const max = paramDef?.max ?? 100;
  const pageValues = useMemo(
    () => Array.from({ length: 16 }, (_, i) => values[pageOffset + i]),
    [pageOffset, values],
  );
  const activePointCount = pageValues.filter((value) => value !== undefined).length;
  const averageValue = activePointCount > 0
    ? Math.round(pageValues.reduce<number>((sum, value) => sum + (value ?? 0), 0) / activePointCount)
    : null;
  const currentValue = values[currentStep];
  const normalizedPoints = pageValues.map((raw, i) => {
    const absStep = pageOffset + i;
    const normalized = raw === undefined ? null : Math.max(0, Math.min(1, (raw - min) / (max - min)));
    return { absStep, step: i, raw, normalized };
  });
  const curvePoints = normalizedPoints
    .filter((point) => point.normalized !== null && point.absStep < length)
    .map((point) => {
      const x = 8 + point.step * 7.2;
      const y = 52 - (point.normalized! * 44);
      return { ...point, x, y };
    });
  const linePath = curvePoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const areaPath = curvePoints.length > 0
    ? `${linePath} L ${curvePoints[curvePoints.length - 1]!.x} 52 L ${curvePoints[0]!.x} 52 Z`
    : "";

  const clampValue = useCallback((raw: number) => Math.round(Math.max(min, Math.min(max, raw))), [max, min]);

  const interpolateSegment = useCallback((fromStep: number, fromValue: number, toStep: number, toValue: number) => {
    const start = Math.min(fromStep, toStep);
    const end = Math.max(fromStep, toStep);
    const span = Math.max(1, end - start);

    for (let step = start; step <= end; step++) {
      const t = (step - start) / span;
      const value = fromStep <= toStep
        ? fromValue + (toValue - fromValue) * t
        : toValue + (fromValue - toValue) * t;
      onChange(step, clampValue(value));
    }
  }, [clampValue, onChange]);

  const valueFromPointer = useCallback((clientY: number, rect: DOMRect) => {
    const y = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return clampValue(min + y * (max - min));
  }, [clampValue, max, min]);

  const handleMouseDown = useCallback((e: React.MouseEvent, absStep: number) => {
    e.preventDefault();
    if (absStep >= length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const value = valueFromPointer(e.clientY, rect);
    onChange(absStep, value);
    dragRef.current = { active: true, min, max, lastStep: absStep, lastValue: value };

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

      const val = valueFromPointer(me.clientY, containerRect);
      if (dragRef.current.lastStep !== null && dragRef.current.lastValue !== null) {
        interpolateSegment(dragRef.current.lastStep, dragRef.current.lastValue, absIdx, val);
      } else {
        onChange(absIdx, val);
      }
      dragRef.current.lastStep = absIdx;
      dragRef.current.lastValue = val;
    };

    const handleUp = () => {
      dragRef.current.active = false;
      dragRef.current.lastStep = null;
      dragRef.current.lastValue = null;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [interpolateSegment, length, max, min, onChange, pageOffset, valueFromPointer]);

  return (
    <div className="w-32 shrink-0 hidden sm:flex flex-col rounded-xl border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] overflow-hidden">
      <div className="border-b border-white/6 px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[7px] font-black tracking-[0.18em] text-white/35">AUTOMATION</span>
          <span className="text-[7px] font-bold tracking-[0.12em]" style={{ color }}>
            {activePointCount} PT
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <select
            value={selectedParam}
            onChange={(e) => onSelectParam(e.target.value)}
            className="h-6 flex-1 px-1.5 text-[8px] font-black bg-black/30 border border-white/8 rounded-md text-white/50 focus:outline-none appearance-none cursor-pointer truncate"
            style={{ color }}
          >
            {params.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <span className="rounded bg-black/25 px-1.5 py-1 text-[7px] font-bold tracking-[0.1em] text-white/35">
            {averageValue ?? "—"}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[7px] font-bold tracking-[0.1em] text-white/22">
          <span>{min}</span>
          <span>{currentValue !== undefined ? `LIVE ${Math.round(currentValue)}` : "DRAW"}</span>
          <span>{max}</span>
        </div>
      </div>

      <div ref={containerRef} className="relative h-[76px] border-b border-white/6 bg-black/15">
        <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 124 56" preserveAspectRatio="none">
          {[8, 19, 30, 41, 52].map((y) => (
            <line key={y} x1="0" y1={y} x2="124" y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          ))}
          {Array.from({ length: 16 }, (_, i) => (
            <line
              key={i}
              x1={8 + i * 7.2}
              y1="0"
              x2={8 + i * 7.2}
              y2="56"
              stroke={i % 4 === 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)"}
              strokeWidth="1"
            />
          ))}
          {areaPath && <path d={areaPath} fill={color} opacity="0.14" />}
          {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
          {curvePoints.map((point) => (
            <circle
              key={point.absStep}
              cx={point.x}
              cy={point.y}
              r={isPlaying && currentStep === point.absStep ? 3 : 2.2}
              fill={color}
              opacity={isPlaying && currentStep === point.absStep ? 1 : 0.85}
            />
          ))}
          {isPlaying && currentStep >= pageOffset && currentStep < pageOffset + 16 && (
            <line
              x1={8 + (currentStep - pageOffset) * 7.2}
              y1="0"
              x2={8 + (currentStep - pageOffset) * 7.2}
              y2="56"
              stroke={color}
              strokeOpacity="0.4"
              strokeWidth="1.5"
            />
          )}
        </svg>

        <div className="absolute inset-0 flex">
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
                className={`flex-1 relative cursor-crosshair ${beyondLength ? "opacity-20" : ""}`}
                onMouseDown={(e) => handleMouseDown(e, absStep)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (absStep < length) onChange(absStep, undefined);
                }}
              >
                {hasValue && (
                  <div
                    className="absolute bottom-0 left-[1px] right-[1px] rounded-t-sm"
                    style={{
                      height: `${Math.max(2, pct)}%`,
                      backgroundColor: color,
                      opacity: isCurrent ? 0.3 : 0.16,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between px-2 py-1.5 text-[7px] font-bold tracking-[0.12em] text-white/22">
        <span>breakpoint draw</span>
        <span>page {Math.floor(pageOffset / 16) + 1}</span>
      </div>
    </div>
  );
}
