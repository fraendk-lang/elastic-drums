/**
 * Rotary Knob Component
 *
 * Hardware-feel rotary encoder with:
 * - Drag up/down to change value
 * - Double-click to reset to default
 * - Visual arc indicator with glow
 * - Value display on hover
 */

import { useState, useCallback, useRef, memo } from "react";

interface KnobProps {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  label: string;
  color?: string;
  size?: number;
  onChange: (value: number) => void;
}

export const Knob = memo(function Knob({
  value, min, max, defaultValue, label, color = "var(--ed-accent-orange)",
  size = 40, onChange,
}: KnobProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [showValue, setShowValue] = useState(false);
  const dragStartY = useRef(0);
  const dragStartVal = useRef(0);
  const knobRef = useRef<HTMLDivElement>(null);

  const normalized = (value - min) / (max - min); // 0..1
  const angle = -135 + normalized * 270; // -135° to +135°

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartVal.current = value;

    const handleMove = (me: MouseEvent) => {
      const deltaY = dragStartY.current - me.clientY;
      const range = max - min;
      const sensitivity = range / 150;
      const newVal = Math.max(min, Math.min(max, dragStartVal.current + deltaY * sensitivity));
      onChange(Math.round(newVal));
    };

    const handleUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [value, min, max, onChange]);

  const handleDoubleClick = useCallback(() => {
    onChange(defaultValue);
  }, [defaultValue, onChange]);

  const radius = size / 2 - 4;
  const arcRadius = radius + 2;

  // SVG arc for value indicator
  const startAngle = -135 * (Math.PI / 180);
  const endAngle = angle * (Math.PI / 180);
  const cx = size / 2;
  const cy = size / 2;

  const arcStartX = cx + arcRadius * Math.cos(startAngle);
  const arcStartY = cy + arcRadius * Math.sin(startAngle);
  const arcEndX = cx + arcRadius * Math.cos(endAngle);
  const arcEndY = cy + arcRadius * Math.sin(endAngle);
  const largeArc = normalized > 0.5 ? 1 : 0;

  return (
    <div
      className="flex flex-col items-center gap-0.5 select-none"
      onMouseEnter={() => setShowValue(true)}
      onMouseLeave={() => setShowValue(false)}
    >
      {/* Value tooltip */}
      <span className={`text-[9px] font-mono tabular-nums h-3 transition-opacity duration-100 ${showValue || isDragging ? "opacity-100" : "opacity-0"}`}
        style={{ color }}
      >
        {Math.round(value)}
      </span>

      {/* Knob */}
      <div
        ref={knobRef}
        className={`relative cursor-grab ${isDragging ? "cursor-grabbing" : ""}`}
        style={{ width: size, height: size }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <svg width={size} height={size} className="absolute inset-0">
          {/* Background track */}
          <circle cx={cx} cy={cy} r={arcRadius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={2.5}
            strokeDasharray={`${arcRadius * 2 * Math.PI * 0.75} ${arcRadius * 2 * Math.PI * 0.25}`}
            strokeDashoffset={arcRadius * 2 * Math.PI * 0.375}
            strokeLinecap="round"
          />

          {/* Value arc with glow */}
          {normalized > 0.005 && (<>
            {/* Glow layer */}
            <path
              d={`M ${arcStartX} ${arcStartY} A ${arcRadius} ${arcRadius} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`}
              fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"
              opacity={isDragging ? 0.2 : 0.08}
            />
            {/* Crisp line */}
            <path
              d={`M ${arcStartX} ${arcStartY} A ${arcRadius} ${arcRadius} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`}
              fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round"
            />
          </>)}
        </svg>

        {/* Knob body */}
        <div
          className="absolute rounded-full shadow-inner transition-shadow duration-100"
          style={{
            width: radius * 2,
            height: radius * 2,
            top: (size - radius * 2) / 2,
            left: (size - radius * 2) / 2,
            background: isDragging
              ? "linear-gradient(180deg, #2a2a32 0%, #1e1e26 100%)"
              : "linear-gradient(180deg, #252530 0%, #1a1a22 100%)",
            border: `1px solid ${isDragging ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)"}`,
            boxShadow: isDragging
              ? `inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 8px rgba(0,0,0,0.4)`
              : `inset 0 1px 0 rgba(255,255,255,0.03), 0 1px 4px rgba(0,0,0,0.3)`,
          }}
        >
          {/* Indicator line */}
          <div
            className="absolute w-0.5 rounded-full"
            style={{
              height: radius * 0.45,
              backgroundColor: color,
              top: 3,
              left: radius - 1,
              transformOrigin: `center ${radius - 3}px`,
              transform: `rotate(${angle}deg)`,
              boxShadow: isDragging ? `0 0 6px ${color}` : "none",
            }}
          />
        </div>
      </div>

      {/* Label */}
      <span className={`text-[8px] font-semibold transition-colors duration-100 ${
        isDragging ? "text-[var(--ed-text-secondary)]" : "text-[var(--ed-text-muted)]"
      }`}>{label}</span>
    </div>
  );
});
