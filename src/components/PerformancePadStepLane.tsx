/**
 * Performance Pad — Step Lane
 *
 * Horizontal step grid shown below the XY pad in step mode. Tap a cell to
 * move the cursor there (this is how you skip steps — jump past them);
 * long-press or right-click a cell to clear its note.
 */
import { useState, useRef, useCallback } from "react";
import type { StepNote } from "../store/performancePadStep";

const STEPS_PER_PAGE = 16;
const LONG_PRESS_MS = 500;

interface StepLaneProps {
  stepNotes: (StepNote | null)[];
  stepCursor: number;
  /** Currently-sounding step during loop playback, or null when not looping. */
  playheadStep: number | null;
  onStepTap: (index: number) => void;
  onStepClear: (index: number) => void;
}

export function PerformancePadStepLane({
  stepNotes, stepCursor, playheadStep, onStepTap, onStepClear,
}: StepLaneProps) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(stepNotes.length / STEPS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * STEPS_PER_PAGE;
  const pageSteps = stepNotes.slice(pageStart, pageStart + STEPS_PER_PAGE);

  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpFired = useRef(false);

  const startLongPress = useCallback((index: number) => {
    lpFired.current = false;
    lpTimer.current = setTimeout(() => {
      lpFired.current = true;
      onStepClear(index);
    }, LONG_PRESS_MS);
  }, [onStepClear]);

  const cancelLongPress = useCallback(() => {
    if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
  }, []);

  return (
    <div className="px-6 pb-3 select-none">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[8px] text-white/40 tracking-[0.15em] uppercase">Steps</span>
        {pageCount > 1 && (
          <div className="flex gap-1">
            {Array.from({ length: pageCount }, (_, p) => (
              <button key={p} onClick={() => setPage(p)}
                className={`w-4 h-4 text-[8px] rounded ${p === safePage
                  ? "bg-blue-500/40 text-blue-100"
                  : "bg-white/5 text-white/40 hover:bg-white/10"}`}
              >{p + 1}</button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-[2px]">
        {pageSteps.map((note, i) => {
          const index = pageStart + i;
          const isCursor = index === stepCursor;
          const isPlayhead = index === playheadStep;
          const isBeat = index % 4 === 0;
          return (
            <button
              key={index}
              onClick={() => { if (!lpFired.current) onStepTap(index); }}
              onContextMenu={(e) => { e.preventDefault(); onStepClear(index); }}
              onPointerDown={() => startLongPress(index)}
              onPointerUp={cancelLongPress}
              onPointerLeave={cancelLongPress}
              onPointerCancel={cancelLongPress}
              title={`Step ${index + 1}${note ? "" : " (rest)"} — tap to move cursor, long-press to clear`}
              className={`relative flex-1 h-9 rounded-sm flex items-end justify-center transition-colors
                ${note ? "bg-[#1c1c26]" : "bg-[#141420]"}
                ${isBeat ? "border-l border-l-white/20" : ""}
                ${isCursor ? "ring-2 ring-blue-400" : "ring-1 ring-white/10"}
                ${isPlayhead ? "bg-blue-500/25" : ""}`}
            >
              {note && (
                <div className="w-2/3 rounded-[1px] bg-[#f472b6]"
                  style={{ height: `${20 + note.x * 70}%` }} />
              )}
              <span className="absolute top-[1px] left-0 right-0 text-center text-[6px] text-white/25 font-mono">
                {index + 1}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
