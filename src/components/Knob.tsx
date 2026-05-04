/**
 * Rotary Knob Component — Premium hardware style
 *
 * Features:
 * - Drag up/down to change value
 * - Double-click to reset to default
 * - Value arc with glow (purple default for macros, or custom color)
 * - Tick marks around the perimeter
 * - Outer metallic bezel ring
 * - 3D-depth knob body gradient
 * - Glowing indicator dot at end of needle
 */

import React, { useState, useCallback, useRef, memo } from "react";

interface KnobProps {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  label: string;
  color?: string;
  size?: number;
  /** Number of tick marks (default 11) */
  ticks?: number;
  /** Show the outer bezel ring (default true for size >= 56) */
  bezel?: boolean;
  onChange: (value: number) => void;
}

export const Knob = memo(function Knob({
  value, min, max, defaultValue, label,
  color = "var(--ed-accent-orange)",
  size = 40,
  ticks,
  bezel,
  onChange,
}: KnobProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [showValue, setShowValue] = useState(false);
  const dragStartY = useRef(0);
  const dragStartVal = useRef(0);
  const knobRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef(0);

  const normalized = (value - min) / (max - min); // 0..1
  const angle = -135 + normalized * 270;            // -135° … +135°

  const showBezel = bezel ?? size >= 56;
  const tickCount = ticks ?? (size >= 56 ? 13 : 11);

  // Layout
  const cx = size / 2;
  const cy = size / 2;
  const outerR    = size / 2 - 1;              // outermost bezel ring
  const trackR    = size / 2 - (showBezel ? 5 : 3); // arc track
  const bodyR     = trackR - (showBezel ? 5 : 4);   // knob body

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    setShowValue(true);
    dragStartY.current = e.clientY;
    dragStartVal.current = value;
  }, [value]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!e.buttons && e.pointerType === "mouse") return;
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    const deltaY = dragStartY.current - e.clientY;
    const range  = max - min;
    const sensitivity = range / (size >= 56 ? 200 : 150);
    const newVal = Math.max(min, Math.min(max, dragStartVal.current + deltaY * sensitivity));
    onChange(newVal);
  }, [min, max, size, onChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDragging(false);
    setShowValue(false);
  }, []);

  // Double-tap on touch, double-click on mouse → reset to default
  const handleClick = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 400) {
      onChange(defaultValue);
    }
    lastTapRef.current = now;
  }, [defaultValue, onChange]);

  // ── Arc geometry ────────────────────────────────────────────────
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const startAngleDeg = -135;
  const endAngleDeg   = angle;

  const arcStartX = cx + trackR * Math.cos(toRad(startAngleDeg));
  const arcStartY = cy + trackR * Math.sin(toRad(startAngleDeg));
  const arcEndX   = cx + trackR * Math.cos(toRad(endAngleDeg));
  const arcEndY   = cy + trackR * Math.sin(toRad(endAngleDeg));
  const largeArc  = normalized > 0.5 ? 1 : 0;

  // ── Tick marks ──────────────────────────────────────────────────
  const tickR = showBezel ? outerR - 1 : trackR + 3;
  const tickLen = size >= 56 ? 4 : 2.5;
  const tickWidth = size >= 56 ? 1.5 : 1;
  const tickMarks: React.ReactElement[] = [];
  for (let i = 0; i < tickCount; i++) {
    const t = i / (tickCount - 1);
    const tickDeg = -135 + t * 270;
    const tickRad = toRad(tickDeg);
    const x1 = cx + tickR * Math.cos(tickRad);
    const y1 = cy + tickR * Math.sin(tickRad);
    const x2 = cx + (tickR - tickLen) * Math.cos(tickRad);
    const y2 = cy + (tickR - tickLen) * Math.sin(tickRad);
    // Active ticks (covered by value arc) glow in accent color
    const isActive = t <= normalized + 0.001;
    tickMarks.push(
      <line
        key={i}
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={isActive ? color : "rgba(255,255,255,0.18)"}
        strokeWidth={tickWidth}
        strokeLinecap="round"
        opacity={isActive ? (i === 0 || t <= normalized ? 1 : 0.5) : 0.6}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-0.5 select-none">
      {/* Value readout */}
      <span
        className={`font-mono tabular-nums h-3 transition-opacity duration-100 ${
          showValue || isDragging ? "opacity-100" : "opacity-0"
        }`}
        style={{ color, fontSize: size >= 56 ? 10 : 8 }}
      >
        {Math.round(value)}
      </span>

      {/* Knob */}
      <div
        ref={knobRef}
        className={`relative cursor-grab ${isDragging ? "cursor-grabbing" : ""}`}
        style={{ width: size, height: size }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
        onDoubleClick={() => onChange(defaultValue)}
      >
        <svg width={size} height={size} className="absolute inset-0 overflow-visible">
          {/* ── Outer bezel ring ────────────────────────────────── */}
          {showBezel && (
            <circle
              cx={cx} cy={cy} r={outerR}
              fill="none"
              stroke="url(#bezel-gradient)"
              strokeWidth={1.5}
            />
          )}

          {/* ── Gradient defs ─────────────────────────────────── */}
          <defs>
            <linearGradient id="bezel-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="rgba(255,255,255,0.18)" />
              <stop offset="50%"  stopColor="rgba(255,255,255,0.06)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.03)" />
            </linearGradient>
          </defs>

          {/* ── Background arc track ───────────────────────────── */}
          <circle
            cx={cx} cy={cy} r={trackR}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={showBezel ? 3 : 2.5}
            strokeDasharray={`${trackR * 2 * Math.PI * 0.75} ${trackR * 2 * Math.PI * 0.25}`}
            strokeDashoffset={trackR * 2 * Math.PI * 0.375}
            strokeLinecap="round"
          />

          {/* ── Tick marks ─────────────────────────────────────── */}
          {tickMarks}

          {/* ── Value arc ──────────────────────────────────────── */}
          {normalized > 0.005 && (<>
            {/* Wide glow */}
            <path
              d={`M ${arcStartX} ${arcStartY} A ${trackR} ${trackR} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`}
              fill="none" stroke={color}
              strokeWidth={showBezel ? 10 : 6}
              strokeLinecap="round"
              opacity={0.15}
            />
            {/* Main arc */}
            <path
              d={`M ${arcStartX} ${arcStartY} A ${trackR} ${trackR} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`}
              fill="none" stroke={color}
              strokeWidth={showBezel ? 3.5 : 2.5}
              strokeLinecap="round"
            />
          </>)}
        </svg>

        {/* ── Knob body ─────────────────────────────────────────── */}
        <div
          className="absolute rounded-full"
          style={{
            width:  bodyR * 2,
            height: bodyR * 2,
            top:    (size - bodyR * 2) / 2,
            left:   (size - bodyR * 2) / 2,
            background: isDragging
              ? "linear-gradient(145deg, #2e2e3e 0%, #1e1e2c 55%, #161622 100%)"
              : "linear-gradient(145deg, #292939 0%, #1d1d2b 55%, #141420 100%)",
            border: `1px solid ${isDragging ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.07)"}`,
            boxShadow: isDragging
              ? `inset 0 2px 4px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.04), 0 4px 16px rgba(0,0,0,0.6)`
              : `inset 0 2px 3px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(255,255,255,0.03), 0 2px 8px rgba(0,0,0,0.5)`,
          }}
        >
          {/* Indicator needle */}
          <div
            className="absolute w-0.5 rounded-full"
            style={{
              height: bodyR * 0.4,
              top:    bodyR * 0.1,
              left:   bodyR - 1,
              transformOrigin: `1px ${bodyR * 0.9}px`,
              transform:       `rotate(${angle + 90}deg)`,
              background: `linear-gradient(to bottom, ${color}, ${color}88)`,
              boxShadow: isDragging ? `0 0 5px ${color}` : `0 0 3px ${color}88`,
            }}
          />

          {/* Indicator dot at tip */}
          {size >= 56 && (
            <div
              className="absolute rounded-full"
              style={{
                width:  4,
                height: 4,
                background: color,
                top:    bodyR * 0.1 + 1,
                left:   bodyR - 2,
                transformOrigin: `2px ${bodyR * 0.9 - 1}px`,
                transform:       `rotate(${angle + 90}deg)`,
                boxShadow: `0 0 6px ${color}, 0 0 12px ${color}66`,
              }}
            />
          )}
        </div>
      </div>

      {/* Label */}
      <span
        className={`font-semibold uppercase tracking-wider transition-colors duration-100 ${
          isDragging ? "text-[var(--ed-text-secondary)]" : "text-[var(--ed-text-muted)]"
        }`}
        style={{ fontSize: size >= 56 ? 9 : 8 }}
      >
        {label}
      </span>
    </div>
  );
});
