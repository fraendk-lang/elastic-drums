import { forwardRef } from "react";
import {
  BASE_NOTE,
  TOTAL_ROWS,
  PIANO_WIDTH,
  RULER_HEIGHT,
  VELOCITY_LANE_HEIGHT,
  NOTE_NAMES,
  OCTAVE_PATTERN,
  PIANO_WHITE_BG,
  PIANO_WHITE_BG_C,
  PIANO_BLACK_BG,
  PIANO_BLACK_BG_HOVER,
  isNoteInScale,
} from "./types";

interface PianoRollKeysProps {
  rowHeight: number;
  rootMidi: number;
  scaleName: string;
  scaleSnap: boolean;
  foldedRows: number[] | null; // null = show all, otherwise sorted high→low midi values
  onKeyClick: (midi: number) => void;
}

export const PianoRollKeys = forwardRef<HTMLDivElement, PianoRollKeysProps>(
  function PianoRollKeys({ rowHeight, rootMidi, scaleName, scaleSnap, foldedRows, onKeyClick }, ref) {
    const rows = foldedRows
      ? foldedRows.map((midi, i) => ({ midi, i }))
      : Array.from({ length: TOTAL_ROWS }, (_, i) => ({ midi: BASE_NOTE + (TOTAL_ROWS - i - 1), i }));
    return (
      <div
        ref={ref}
        className="shrink-0 overflow-y-hidden border-r border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]"
        style={{ width: PIANO_WIDTH }}
      >
        {/* Spacer matching the ruler height so rows line up with the grid */}
        <div
          style={{
            height: RULER_HEIGHT,
            backgroundColor: "var(--ed-bg-primary)",
            borderBottom: "1px solid rgba(255,255,255,0.2)",
          }}
        />
        {rows.map(({ midi }) => {
          const noteIdx = midi % 12;
          const noteName = NOTE_NAMES[noteIdx] ?? "?";
          const isBlack = OCTAVE_PATTERN[noteIdx]?.black ?? false;
          const isC = noteIdx === 0;
          const isScaleNote = isNoteInScale(midi, rootMidi, scaleName);

          return (
            <div
              key={midi}
              onClick={() => onKeyClick(midi)}
              className={`flex items-center justify-center text-[6px] font-bold tracking-wider cursor-pointer select-none border-b transition-all ${
                isBlack ? "hover:brightness-110" : "hover:brightness-105"
              } ${isC ? "border-b-[var(--ed-border)]" : "border-b-[#1a1a1e]/30"} ${
                scaleSnap && !isScaleNote ? "opacity-30" : ""
              }`}
              style={{
                height: rowHeight,
                background: isBlack
                  ? `linear-gradient(180deg, ${PIANO_BLACK_BG_HOVER} 0%, ${PIANO_BLACK_BG} 100%)`
                  : isC
                    ? PIANO_WHITE_BG_C
                    : PIANO_WHITE_BG,
                color: isBlack ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.25)",
                boxShadow: isBlack
                  ? "inset -2px 0 4px rgba(0,0,0,0.8)"
                  : "inset 1px 1px 2px rgba(255,255,255,0.1), inset -1px -1px 2px rgba(0,0,0,0.3)",
                borderLeft: isBlack ? "1px solid rgba(0,0,0,0.5)" : "none",
                borderRight: isBlack ? "1px solid rgba(0,0,0,0.8)" : "none",
                paddingTop: isBlack ? "2px" : "0px",
              }}
            >
              <span
                style={{
                  color: isBlack ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.35)",
                }}
              >
                {!isBlack && `${noteName}${Math.floor(midi / 12) - 1}`}
              </span>
            </div>
          );
        })}
        {/* Spacer matching velocity lane + scrollbar buffer so keys can scroll as far as grid */}
        <div style={{ height: VELOCITY_LANE_HEIGHT + 20, flexShrink: 0 }} />
      </div>
    );
  },
);
