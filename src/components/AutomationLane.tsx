/**
 * AutomationLane — full-width collapsible automation editor
 *
 * Full-width section below the step grid. Collapse with the chevron button.
 * Drag to draw breakpoints, right-click to erase, drag bottom edge to resize.
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
  length: number;
  pageOffset: number;
  currentStep: number;
  isPlaying: boolean;
  color: string;
  onSelectParam: (paramId: string) => void;
  onChange: (step: number, value: number | undefined) => void;
}

const MIN_H = 64;
const MAX_H = 280;
const DEFAULT_H = 112;

export function AutomationLane({
  params, selectedParam, values, length, pageOffset, currentStep, isPlaying,
  color, onSelectParam, onChange,
}: AutomationLaneProps) {
  const [collapsed, setCollapsed]   = useState(false);
  const [laneHeight, setLaneHeight] = useState(DEFAULT_H);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    active: boolean; lastStep: number | null; lastValue: number | null;
  }>({ active: false, lastStep: null, lastValue: null });

  const stepsOnPage = Math.min(16, Math.max(1, length - pageOffset));

  const paramDef = params.find((p) => p.id === selectedParam);
  const min = paramDef?.min ?? 0;
  const max = paramDef?.max ?? 100;

  const pageValues = useMemo(
    () => Array.from({ length: stepsOnPage }, (_, i) => values[pageOffset + i]),
    [pageOffset, values, stepsOnPage],
  );
  const activeCount = pageValues.filter((v) => v !== undefined).length;
  const currentValue = values[currentStep];

  const clamp = useCallback(
    (raw: number) => Math.round(Math.max(min, Math.min(max, raw))),
    [min, max],
  );

  const valueFromPointer = useCallback(
    (clientY: number, rect: DOMRect) => {
      const y = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      return clamp(min + y * (max - min));
    },
    [clamp, min, max],
  );

  const interpolate = useCallback(
    (fromStep: number, fromVal: number, toStep: number, toVal: number) => {
      const start = Math.min(fromStep, toStep);
      const end   = Math.max(fromStep, toStep);
      const span  = Math.max(1, end - start);
      for (let s = start; s <= end; s++) {
        const t = (s - start) / span;
        const v = fromStep <= toStep
          ? fromVal + (toVal - fromVal) * t
          : toVal  + (fromVal - toVal) * t;
        onChange(s, clamp(v));
      }
    },
    [clamp, onChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, absStep: number) => {
      e.preventDefault();
      if (absStep >= length) return;
      const rect  = e.currentTarget.getBoundingClientRect();
      const value = valueFromPointer(e.clientY, rect);
      onChange(absStep, value);
      dragRef.current = { active: true, lastStep: absStep, lastValue: value };

      const onMove = (me: MouseEvent) => {
        if (!dragRef.current.active || !containerRef.current) return;
        const cRect = containerRef.current.getBoundingClientRect();
        const colW  = cRect.width / stepsOnPage;
        const idx   = Math.floor((me.clientX - cRect.left) / colW);
        if (idx < 0 || idx >= stepsOnPage) return;
        const abs = pageOffset + idx;
        if (abs >= length) return;
        const val = valueFromPointer(me.clientY, cRect);
        const { lastStep, lastValue } = dragRef.current;
        if (lastStep !== null && lastValue !== null) {
          interpolate(lastStep, lastValue, abs, val);
        } else {
          onChange(abs, val);
        }
        dragRef.current.lastStep  = abs;
        dragRef.current.lastValue = val;
      };
      const onUp = () => {
        dragRef.current = { active: false, lastStep: null, lastValue: null };
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [interpolate, length, onChange, pageOffset, stepsOnPage, valueFromPointer],
  );

  // ── resize handle ─────────────────────────────────────────────
  const handleResizeDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = laneHeight;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const onMove = (me: PointerEvent) =>
      setLaneHeight(Math.max(MIN_H, Math.min(MAX_H, startH + me.clientY - startY)));
    const onUp = (ue: PointerEvent) => {
      try { el.releasePointerCapture(ue.pointerId); } catch { /**/ }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [laneHeight]);

  // ── SVG overlay (curve + playhead) ───────────────────────────
  const svgW = 100; // viewBox units — preserveAspectRatio="none" stretches it
  const svgH = 100;
  const stepW = stepsOnPage > 0 ? svgW / stepsOnPage : svgW;

  const normalised = pageValues.map((raw, i) => ({
    step: i,
    absStep: pageOffset + i,
    n: raw === undefined ? null : Math.max(0, Math.min(1, (raw - min) / (max - min))),
    raw,
  }));
  const pts = normalised
    .filter((p) => p.n !== null && p.absStep < length)
    .map((p)  => ({ ...p, x: (p.step + 0.5) * stepW, y: svgH - p.n! * svgH }));

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = pts.length > 0
    ? `${linePath} L${pts[pts.length - 1]!.x},${svgH} L${pts[0]!.x},${svgH} Z`
    : "";

  // ── render ────────────────────────────────────────────────────
  return (
    <div className="border-t border-white/5 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0.10))]">

      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        {/* collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 group"
          title={collapsed ? "Expand automation" : "Collapse automation"}
        >
          <span
            className="text-[8px] font-black tracking-[0.16em] transition-colors"
            style={{ color: collapsed ? "rgba(255,255,255,0.25)" : color }}
          >
            AUTOMATION
          </span>
          <svg
            width="10" height="10" viewBox="0 0 10 10"
            className="transition-transform duration-200 opacity-40 group-hover:opacity-70"
            style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
          >
            <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.5"
              fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {!collapsed && (
          <>
            <div className="w-px h-3 bg-white/8" />

            {/* param selector */}
            <select
              value={selectedParam}
              onChange={(e) => onSelectParam(e.target.value)}
              className="h-5 px-1.5 text-[8px] font-black bg-black/30 border border-white/8 rounded-md focus:outline-none appearance-none cursor-pointer"
              style={{ color }}
            >
              {params.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>

            {/* stats */}
            <span className="text-[7px] font-bold text-white/25 tabular-nums">
              {activeCount > 0 ? `${activeCount} pts` : "no points"}
            </span>
            <span
              className="text-[7px] font-bold tabular-nums ml-auto"
              style={{ color: currentValue !== undefined ? color : "rgba(255,255,255,0.2)" }}
            >
              {currentValue !== undefined
                ? `LIVE ${Math.round(currentValue)}`
                : `${paramDef?.label ?? ""} ${min}–${max}`}
            </span>

            {/* range labels */}
            <div className="w-px h-3 bg-white/8" />
            <span className="text-[7px] text-white/20 font-mono">{min}</span>
            <span className="text-[7px] text-white/20 font-mono">↔</span>
            <span className="text-[7px] text-white/20 font-mono">{max}</span>
          </>
        )}
      </div>

      {/* ── Canvas (hidden when collapsed) ── */}
      {!collapsed && (
        <>
          <div
            ref={containerRef}
            className="relative mx-3 mb-1 rounded-lg overflow-hidden border border-white/6 bg-black/20 cursor-crosshair"
            style={{ height: laneHeight }}
          >
            {/* SVG overlay — curve + grid lines + playhead */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox={`0 0 ${svgW} ${svgH}`}
              preserveAspectRatio="none"
            >
              {/* horizontal grid */}
              {[0.25, 0.5, 0.75].map((pct) => (
                <line key={pct}
                  x1="0" y1={pct * svgH} x2={svgW} y2={pct * svgH}
                  stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"
                />
              ))}
              {/* vertical beat lines */}
              {Array.from({ length: stepsOnPage + 1 }, (_, i) => (
                <line key={i}
                  x1={i * stepW} y1="0" x2={i * stepW} y2={svgH}
                  stroke={i % 4 === 0 ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)"}
                  strokeWidth="0.6"
                />
              ))}
              {/* filled area */}
              {areaPath && <path d={areaPath} fill={color} opacity="0.13" />}
              {/* curve line */}
              {linePath && (
                <path d={linePath} fill="none" stroke={color}
                  strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
              )}
              {/* breakpoint dots */}
              {pts.map((p) => {
                const isCur = isPlaying && currentStep === p.absStep;
                return (
                  <circle key={p.absStep}
                    cx={p.x} cy={p.y}
                    r={isCur ? 3.5 : 2.5}
                    fill={color}
                    opacity={isCur ? 1 : 0.85}
                  />
                );
              })}
              {/* playhead */}
              {isPlaying && currentStep >= pageOffset && currentStep < pageOffset + stepsOnPage && (
                <line
                  x1={(currentStep - pageOffset + 0.5) * stepW} y1="0"
                  x2={(currentStep - pageOffset + 0.5) * stepW} y2={svgH}
                  stroke={color} strokeOpacity="0.45" strokeWidth="1"
                />
              )}
            </svg>

            {/* invisible hit areas — one per step column */}
            <div className="absolute inset-0 flex">
              {Array.from({ length: stepsOnPage }, (_, i) => {
                const absStep  = pageOffset + i;
                const raw      = values[absStep] ?? min;
                const pct      = Math.max(0, Math.min(100, ((raw - min) / (max - min)) * 100));
                const isCur    = isPlaying && currentStep === absStep;
                const hasValue = values[absStep] !== undefined;

                return (
                  <div
                    key={i}
                    className="flex-1 relative"
                    onMouseDown={(e) => handleMouseDown(e, absStep)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (absStep < length) onChange(absStep, undefined);
                    }}
                  >
                    {/* bar fill */}
                    {hasValue && (
                      <div
                        className="absolute bottom-0 left-[1px] right-[1px] rounded-t-sm"
                        style={{
                          height: `${Math.max(2, pct)}%`,
                          backgroundColor: color,
                          opacity: isCur ? 0.28 : 0.12,
                        }}
                      />
                    )}
                    {/* current step highlight */}
                    {isCur && (
                      <div className="absolute inset-0 rounded-sm"
                        style={{ backgroundColor: color, opacity: 0.05 }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Resize handle ── */}
          <div
            className="mx-3 mb-2 h-3 cursor-ns-resize flex items-center justify-center rounded-b hover:bg-white/4 transition-colors group"
            onPointerDown={handleResizeDown}
          >
            <div className="w-12 h-[2px] rounded-full bg-white/12 group-hover:bg-white/25 transition-colors" />
          </div>
        </>
      )}
    </div>
  );
}
