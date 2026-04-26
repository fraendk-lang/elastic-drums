import React, { useCallback, useRef } from "react";
import { RULER_HEIGHT, type LoopRange } from "./types";

interface PianoRollRulerProps {
  totalBeats: number;
  cellW: number;
  gridW: number;
  playheadBeat: number;
  accentColor: string;
  loop: LoopRange;
  onLoopChange: (loop: LoopRange) => void;
  snapBeat: (beat: number) => number;
}

type DragMode =
  | { kind: "create"; originBeat: number }
  | { kind: "move"; startMouse: number; startLoop: LoopRange }
  | { kind: "resize-start"; startLoop: LoopRange }
  | { kind: "resize-end"; startLoop: LoopRange };

export function PianoRollRuler({
  totalBeats,
  cellW,
  gridW,
  playheadBeat,
  accentColor,
  loop,
  onLoopChange,
  snapBeat,
}: PianoRollRulerProps) {
  const rulerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);

  const beatFromClientX = useCallback(
    (clientX: number): number => {
      const rect = rulerRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return Math.max(0, Math.min(totalBeats, (clientX - rect.left) / cellW));
    },
    [cellW, totalBeats],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const beat = beatFromClientX(e.clientX);
      const target = e.target as HTMLElement;
      const role = target.dataset.loopRole;

      if (role === "handle-start") {
        dragRef.current = { kind: "resize-start", startLoop: { ...loop } };
      } else if (role === "handle-end") {
        dragRef.current = { kind: "resize-end", startLoop: { ...loop } };
      } else if (role === "body") {
        dragRef.current = { kind: "move", startMouse: beat, startLoop: { ...loop } };
      } else {
        // Empty ruler area → start creating a new loop
        const startBeat = snapBeat(beat);
        onLoopChange({ start: startBeat, end: startBeat + 0.25, enabled: true });
        dragRef.current = { kind: "create", originBeat: startBeat };
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [beatFromClientX, loop, onLoopChange, snapBeat],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const beat = beatFromClientX(e.clientX);
      const d = dragRef.current;
      switch (d.kind) {
        case "create": {
          const snapped = snapBeat(beat);
          const start = Math.min(d.originBeat, snapped);
          const end = Math.max(d.originBeat + 0.25, snapped);
          onLoopChange({ start, end, enabled: true });
          break;
        }
        case "move": {
          const delta = beat - d.startMouse;
          const len = d.startLoop.end - d.startLoop.start;
          let newStart = snapBeat(d.startLoop.start + delta);
          newStart = Math.max(0, Math.min(totalBeats - len, newStart));
          onLoopChange({ start: newStart, end: newStart + len, enabled: true });
          break;
        }
        case "resize-start": {
          const newStart = Math.max(0, Math.min(d.startLoop.end - 0.25, snapBeat(beat)));
          onLoopChange({ ...d.startLoop, start: newStart, enabled: true });
          break;
        }
        case "resize-end": {
          const newEnd = Math.max(d.startLoop.start + 0.25, Math.min(totalBeats, snapBeat(beat)));
          onLoopChange({ ...d.startLoop, end: newEnd, enabled: true });
          break;
        }
      }
    },
    [beatFromClientX, onLoopChange, snapBeat, totalBeats],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.dataset.loopRole === "body") {
        onLoopChange({ ...loop, enabled: false });
      }
    },
    [loop, onLoopChange],
  );

  const bars = Math.ceil(totalBeats / 4);
  const loopX = loop.start * cellW;
  const loopW = (loop.end - loop.start) * cellW;

  return (
    <div
      ref={rulerRef}
      className="sticky top-0 z-30 select-none"
      style={{
        height: RULER_HEIGHT,
        width: Math.max(gridW, 800),
        backgroundColor: "var(--ed-bg-primary)",
        borderBottom: "1px solid rgba(255,255,255,0.22)",
        cursor: "crosshair",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      {/* Bar ticks + labels */}
      {Array.from({ length: bars + 1 }, (_, barIdx) => {
        const x = barIdx * 4 * cellW;
        return (
          <div
            key={`bar-${barIdx}`}
            className="absolute pointer-events-none"
            style={{ left: x, top: 0, bottom: 0 }}
          >
            <div
              style={{
                width: 1,
                height: "100%",
                backgroundColor: "rgba(255,255,255,0.35)",
              }}
            />
            <div
              className="absolute text-[9px] font-bold text-white/65"
              style={{ left: 4, top: 3 }}
            >
              {barIdx + 1}
            </div>
          </div>
        );
      })}

      {/* Beat sub-ticks (1/4 inside each bar) */}
      {Array.from({ length: totalBeats + 1 }, (_, beatIdx) => {
        if (beatIdx % 4 === 0) return null;
        const x = beatIdx * cellW;
        return (
          <div
            key={`beat-${beatIdx}`}
            className="absolute pointer-events-none"
            style={{
              left: x,
              bottom: 0,
              width: 1,
              height: 9,
              backgroundColor: "rgba(255,255,255,0.20)",
            }}
          />
        );
      })}

      {/* Loop brace */}
      {loop.enabled && (
        <div
          data-loop-role="body"
          className="absolute cursor-grab active:cursor-grabbing"
          style={{
            left: loopX,
            top: 0,
            width: Math.max(4, loopW),
            height: RULER_HEIGHT,
            backgroundColor: `${accentColor}38`,
            borderTop: `2px solid ${accentColor}`,
            borderBottom: `1px solid ${accentColor}`,
            boxShadow: `inset 0 -6px 8px ${accentColor}25`,
          }}
          title="Drag to move · Double-click to disable"
        >
          {/* Start handle */}
          <div
            data-loop-role="handle-start"
            className="absolute top-0 bottom-0 cursor-ew-resize"
            style={{
              left: 0,
              width: 6,
              backgroundColor: accentColor,
              boxShadow: `0 0 6px ${accentColor}80`,
            }}
          />
          {/* End handle */}
          <div
            data-loop-role="handle-end"
            className="absolute top-0 bottom-0 cursor-ew-resize"
            style={{
              right: 0,
              width: 6,
              backgroundColor: accentColor,
              boxShadow: `0 0 6px ${accentColor}80`,
            }}
          />
          {/* Label */}
          {loopW > 50 && (
            <div
              className="absolute pointer-events-none text-[8px] font-bold text-black/80"
              style={{ left: 10, top: 5 }}
            >
              LOOP {(loop.end - loop.start).toFixed(1)}b
            </div>
          )}
        </div>
      )}

      {/* Playhead marker (triangle) */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: playheadBeat * cellW - 5,
          bottom: 0,
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderBottom: `7px solid ${accentColor}`,
          filter: `drop-shadow(0 0 4px ${accentColor})`,
        }}
      />
    </div>
  );
}
