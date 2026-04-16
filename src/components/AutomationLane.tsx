/**
 * AutomationLane — curve-style automation editor
 *
 * Renders a compact automation lane with breakpoints, connecting curve,
 * value fill, and direct draw editing. Adapts to current step count
 * and supports resize via drag handle.
 */

import { useCallback, useMemo, useRef, useState } from "react";

export interface AutomationParam {
  id: string;
  label: string;
  min: number;
  max: number;
}

interface AutomationLaneProps {
  params: AutomationParam[];
  selectedParam: string;
  values: Array<number | undefined>;
  length: number;          // Active pattern length (total steps)
  pageOffset: number;
  currentStep: number;
  isPlaying: boolean;
  color: string;
  onSelectParam: (paramId: string) => void;
  onChange: (step: number, value: number | undefined) => void;
}

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 200;
const DEFAULT_HEIGHT = 76;

export function AutomationLane({
  params, selectedParam, values, length, pageOffset, currentStep, isPlaying,
  color, onSelectParam, onChange,
}: AutomationLaneProps) {
  const dragRef = useRef<{ active: boolean; min: number; max: number; lastStep: number | null; lastValue: number | null }>({
    active: false, min: 0, max: 1, lastStep: null, lastValue: null,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const [laneHeight, setLaneHeight] = useState(DEFAULT_HEIGHT);

  // ─── Dynamic step count: adapt to pattern length ─────────────
  const stepsOnPage = Math.min(16, Math.max(1, length - pageOffset));

  const paramDef = params.find((p) => p.id === selectedParam);
  const min = paramDef?.min ?? 0;
  const max = paramDef?.max ?? 100;
  const pageValues = useMemo(
    () => Array.from({ length: stepsOnPage }, (_, i) => values[pageOffset + i]),
    [pageOffset, values, stepsOnPage],
  );
  const activePointCount = pageValues.filter((value) => value !== undefined).length;
  const averageValue = activePointCount > 0
    ? Math.round(pageValues.reduce<number>((sum, value) => sum + (value ?? 0), 0) / activePointCount)
    : null;
  const currentValue = values[currentStep];

  // ─── SVG geometry (adapt to stepsOnPage) ─────────────────────
  const svgW = 124;
  const svgH = 56;
  const padL = 4;
  const stepW = stepsOnPage > 0 ? (svgW - padL * 2) / stepsOnPage : 7.2;

  const normalizedPoints = pageValues.map((raw, i) => {
    const absStep = pageOffset + i;
    const normalized = raw === undefined ? null : Math.max(0, Math.min(1, (raw - min) / (max - min)));
    return { absStep, step: i, raw, normalized };
  });
  const curvePoints = normalizedPoints
    .filter((point) => point.normalized !== null && point.absStep < length)
    .map((point) => {
      const x = padL + (point.step + 0.5) * stepW;
      const y = svgH - 4 - (point.normalized! * (svgH - 12));
      return { ...point, x, y };
    });
  const linePath = curvePoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const areaPath = curvePoints.length > 0
    ? `${linePath} L ${curvePoints[curvePoints.length - 1]!.x} ${svgH - 4} L ${curvePoints[0]!.x} ${svgH - 4} Z`
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
      const containerRect = containerRef.current.getBoundingClientRect();
      const relX = me.clientX - containerRect.left;
      const colW = containerRect.width / stepsOnPage;
      const stepIdx = Math.floor(relX / colW);
      if (stepIdx < 0 || stepIdx >= stepsOnPage) return;
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
  }, [interpolateSegment, length, max, min, onChange, pageOffset, stepsOnPage, valueFromPointer]);

  // ─── RESIZE handle ──────────────────────────────────────────
  const handleResizeDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = laneHeight;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    const onMove = (me: PointerEvent) => {
      const delta = me.clientY - startY;
      setLaneHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startH + delta)));
    };
    const onUp = (ue: PointerEvent) => {
      try { el.releasePointerCapture(ue.pointerId); } catch { /* */ }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [laneHeight]);

  return (
    <div className="w-32 shrink-0 hidden sm:flex flex-col rounded-xl border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] overflow-hidden">
      <div className="border-b border-white/6 px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[7px] font-black tracking-[0.18em] text-white/35">AUTOMATION</span>
          <span className="text-[7px] font-bold tracking-[0.12em]" style={{ color }}>
            {activePointCount} PT · {stepsOnPage} steps
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

      <div ref={containerRef} className="relative border-b border-white/6 bg-black/15" style={{ height: laneHeight }}>
        <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox={`0 0 ${svgW} ${svgH}`} preserveAspectRatio="none">
          {/* Horizontal grid lines */}
          {[0.25, 0.5, 0.75, 1].map((pct) => {
            const y = svgH - 4 - pct * (svgH - 12);
            return <line key={pct} x1="0" y1={y} x2={svgW} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />;
          })}
          {/* Vertical step lines */}
          {Array.from({ length: stepsOnPage + 1 }, (_, i) => (
            <line
              key={i}
              x1={padL + i * stepW}
              y1="0"
              x2={padL + i * stepW}
              y2={svgH}
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
          {isPlaying && currentStep >= pageOffset && currentStep < pageOffset + stepsOnPage && (
            <line
              x1={padL + (currentStep - pageOffset + 0.5) * stepW}
              y1="0"
              x2={padL + (currentStep - pageOffset + 0.5) * stepW}
              y2={svgH}
              stroke={color}
              strokeOpacity="0.4"
              strokeWidth="1.5"
            />
          )}
        </svg>

        <div className="absolute inset-0 flex">
          {Array.from({ length: stepsOnPage }, (_, i) => {
            const absStep = pageOffset + i;
            const raw = values[absStep] ?? min;
            const pct = Math.max(0, Math.min(100, ((raw - min) / (max - min)) * 100));
            const isCurrent = isPlaying && currentStep === absStep;
            const hasValue = values[absStep] !== undefined;

            return (
              <div
                key={i}
                className="flex-1 relative cursor-crosshair"
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

      {/* Resize handle */}
      <div
        className="h-2 cursor-ns-resize flex items-center justify-center hover:bg-white/5 transition-colors"
        onPointerDown={handleResizeDown}
      >
        <div className="w-8 h-[2px] rounded-full bg-white/15" />
      </div>

      <div className="flex items-center justify-between px-2 py-1 text-[7px] font-bold tracking-[0.12em] text-white/22">
        <span>breakpoint draw</span>
        <span>page {Math.floor(pageOffset / 16) + 1}</span>
      </div>
    </div>
  );
}
