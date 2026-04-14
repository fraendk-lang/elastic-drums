import React, { useEffect, useRef, useState, useCallback } from "react";
import { useDrumStore } from "../store/drumStore";
import { useTransportStore } from "../store/transportStore";

interface PianoRollNote {
  id: string;
  midi: number;
  start: number;
  duration: number;
  velocity: number;
}

interface PianoRollProps {
  isOpen: boolean;
  onClose: () => void;
}

const OCTAVE_PATTERN = [
  { note: "C", black: false },
  { note: "C#", black: true },
  { note: "D", black: false },
  { note: "D#", black: true },
  { note: "E", black: false },
  { note: "F", black: false },
  { note: "F#", black: true },
  { note: "G", black: false },
  { note: "G#", black: true },
  { note: "A", black: false },
  { note: "A#", black: true },
  { note: "B", black: false },
];

const ROW_HEIGHT = 18;
const PIANO_WIDTH = 48;
const GRID_CELL_WIDTH = 30; // 30px per 1/16 note

export function PianoRoll({ isOpen, onClose }: PianoRollProps) {
  const drumStore = useDrumStore();
  const transportStore = useTransportStore();

  // Local state for piano roll
  const [notes, setNotes] = useState<PianoRollNote[]>([
    { id: "1", midi: 60, start: 0, duration: 0.5, velocity: 0.8 },
    { id: "2", midi: 64, start: 1, duration: 0.5, velocity: 0.8 },
    { id: "3", midi: 67, start: 2, duration: 0.5, velocity: 0.8 },
  ]);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [gridResolution, setGridResolution] = useState(0.25); // 1/16
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [scrollY] = useState(36); // Start at C4 (MIDI 60)
  const [scrollX] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Note creation and manipulation
  const createNote = useCallback((midi: number, start: number) => {
    const id = Date.now().toString();
    const snappedStart = snapEnabled ? Math.round(start / gridResolution) * gridResolution : start;
    setNotes((prev) => [
      ...prev,
      { id, midi, start: snappedStart, duration: gridResolution, velocity: 0.8 },
    ]);
  }, [gridResolution, snapEnabled]);

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setSelectedNoteId(null);
  }, []);

  const updateNote = useCallback((id: string, updates: Partial<PianoRollNote>) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...updates } : n))
    );
  }, []);

  // Grid interaction handlers
  const handleGridClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left-click

    const rect = gridContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left + scrollX;
    const y = e.clientY - rect.top;
    const rowIndex = Math.floor(y / ROW_HEIGHT);

    // Get MIDI note from row
    const totalRows = OCTAVE_PATTERN.length * 4; // 4 octaves
    const midiNote = Math.max(0, Math.min(127, scrollY + (totalRows - rowIndex - 1)));

    // Get start beat from x position
    const beatStart = x / GRID_CELL_WIDTH;

    // Check if clicking on existing note
    const clickedNote = notes.find(
      (n) =>
        n.midi === midiNote &&
        n.start <= beatStart &&
        beatStart < n.start + n.duration
    );

    if (clickedNote) {
      setSelectedNoteId(clickedNote.id);
    } else {
      setSelectedNoteId(null);
      createNote(midiNote, beatStart);
    }
  }, [scrollX, scrollY, notes, createNote]);

  const handleNoteMouseDown = useCallback((e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    e.stopPropagation();

    setSelectedNoteId(noteId);

    const rect = gridContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = e.clientX;
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;

    const isResizeHandle = (e.target as HTMLElement).classList.contains("resize-handle");

    const handleMouseMove = (moveE: MouseEvent) => {
      const deltaX = moveE.clientX - startX;

      if (isResizeHandle) {
        // Resize duration
        const beatDelta = deltaX / GRID_CELL_WIDTH;
        const newDuration = Math.max(gridResolution, note.duration + beatDelta);
        updateNote(noteId, { duration: newDuration });
      } else {
        // Move note
        const beatDelta = deltaX / GRID_CELL_WIDTH;
        const newStart = Math.max(0, note.start + beatDelta);

        // Snap to grid if enabled
        const snappedStart = snapEnabled
          ? Math.round(newStart / gridResolution) * gridResolution
          : newStart;

        updateNote(noteId, { start: snappedStart });
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [notes, gridResolution, snapEnabled, updateNote]);

  const handleNoteContextMenu = useCallback((e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    e.stopPropagation();
    deleteNote(noteId);
  }, [deleteNote]);

  // Keyboard shortcut: Delete selected note
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNoteId) {
        e.preventDefault();
        deleteNote(selectedNoteId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedNoteId, deleteNote]);

  if (!isOpen) return null;

  // ─── Render ─────────────────────────────────────────────
  const visibleBeats = 16;
  const visibleRows = Math.ceil(window.innerHeight / ROW_HEIGHT) - 4;
  const totalRows = OCTAVE_PATTERN.length * 4;

  // Playhead position (in beats)
  const playheadBeat = transportStore.currentStep / 4; // Assuming 16 steps per bar

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-[var(--ed-bg-primary)] flex flex-col"
    >
      {/* ─── Toolbar ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 px-4 py-2 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/50">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-wider text-[var(--ed-text-secondary)]">
            PIANO ROLL
          </span>
          <span className="text-[9px] text-[var(--ed-text-muted)]">
            {notes.length} NOTES
          </span>
        </div>

        <div className="flex items-center gap-4 text-[9px]">
          {/* Grid resolution selector */}
          <div className="flex items-center gap-1.5">
            <label className="text-[var(--ed-text-muted)]">GRID:</label>
            <select
              value={gridResolution}
              onChange={(e) => setGridResolution(parseFloat(e.target.value))}
              className="bg-[var(--ed-bg-elevated)] border border-[var(--ed-border)]/50 rounded px-2 py-1 text-[var(--ed-text-secondary)] font-bold tracking-wider cursor-pointer hover:border-[var(--ed-border)] transition-colors"
            >
              <option value={0.25}>1/16</option>
              <option value={0.5}>1/8</option>
              <option value={1}>1/4</option>
              <option value={2}>1/2</option>
            </select>
          </div>

          {/* Snap toggle */}
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            className={`px-2 py-1 rounded border font-bold tracking-wider transition-colors ${
              snapEnabled
                ? "bg-[var(--ed-accent-orange)]/10 border-[var(--ed-accent-orange)]/50 text-[var(--ed-accent-orange)]"
                : "bg-[var(--ed-bg-elevated)] border-[var(--ed-border)]/50 text-[var(--ed-text-muted)] hover:border-[var(--ed-border)]"
            }`}
          >
            SNAP
          </button>

          {/* BPM display */}
          <span className="text-[var(--ed-text-secondary)] px-2 py-1 bg-[var(--ed-bg-elevated)] rounded border border-[var(--ed-border)]/50">
            {drumStore.bpm} BPM
          </span>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="px-3 py-1 rounded border border-[var(--ed-border)]/50 text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)] transition-colors font-bold tracking-wider"
        >
          ← BACK
        </button>
      </div>

      {/* ─── Piano Roll Canvas ──────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--ed-bg-primary)]">
        {/* Piano keyboard (left) */}
        <div
          className="w-12 border-r border-[var(--ed-border)] bg-[var(--ed-bg-surface)] flex flex-col overflow-y-auto"
          style={{ width: PIANO_WIDTH }}
        >
          {/* Render piano keys */}
          {Array.from({ length: totalRows }).map((_, rowIndex) => {
            const noteIndex = rowIndex % OCTAVE_PATTERN.length;
            const octave = Math.floor((totalRows - rowIndex - 1) / OCTAVE_PATTERN.length) + 2;
            const octaveKey = OCTAVE_PATTERN[noteIndex]!;
            const isBlackKey = octaveKey.black;
            const midiNote = scrollY + (totalRows - rowIndex - 1);

            const showLabel = noteIndex === 0;

            return (
              <div
                key={rowIndex}
                className={`flex items-center justify-center font-bold text-[7px] tracking-wider cursor-pointer select-none border-b border-[var(--ed-border)]/20 transition-colors ${
                  isBlackKey
                    ? "bg-[#151518] text-[var(--ed-text-muted)] hover:bg-[#1a1a1f]"
                    : "bg-[#2a2a30] text-[var(--ed-text-muted)] hover:bg-[#323238]"
                }`}
                style={{ height: ROW_HEIGHT }}
                title={`${octaveKey.note}${octave} (MIDI ${midiNote})`}
              >
                {showLabel && (
                  <span className="text-[var(--ed-text-secondary)]">
                    {octaveKey.note}
                    {octave}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Grid area (right) */}
        <div
          ref={gridContainerRef}
          className="flex-1 bg-[var(--ed-bg-primary)] overflow-auto cursor-crosshair relative"
          onClick={handleGridClick}
        >
          {/* SVG for grid background */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={visibleBeats * GRID_CELL_WIDTH}
            height={visibleRows * ROW_HEIGHT}
          >
            {/* Vertical lines (beat divisions) */}
            {Array.from({ length: visibleBeats * 4 + 1 }).map((_, i) => {
              const x = i * (GRID_CELL_WIDTH / 4);
              const isBeatLine = i % 4 === 0;
              const isBarLine = i % 16 === 0;

              let opacity = 0.05;
              let strokeWidth = 0.5;
              if (isBeatLine) {
                opacity = 0.12;
                strokeWidth = 1;
              }
              if (isBarLine) {
                opacity = 0.2;
                strokeWidth = 1.5;
              }

              return (
                <line
                  key={`v${i}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={visibleRows * ROW_HEIGHT}
                  stroke="white"
                  strokeWidth={strokeWidth}
                  opacity={opacity}
                />
              );
            })}

            {/* Horizontal lines (notes) */}
            {Array.from({ length: visibleRows + 1 }).map((_, i) => {
              const y = i * ROW_HEIGHT;
              return (
                <line
                  key={`h${i}`}
                  x1={0}
                  y1={y}
                  x2={visibleBeats * GRID_CELL_WIDTH}
                  y2={y}
                  stroke="white"
                  strokeWidth="0.5"
                  opacity="0.05"
                />
              );
            })}
          </svg>

          {/* Note blocks */}
          {notes.map((note) => {
            const rowIndex = totalRows - (note.midi - scrollY) - 1;
            if (rowIndex < 0 || rowIndex >= visibleRows) return null;

            const y = rowIndex * ROW_HEIGHT;
            const x = note.start * GRID_CELL_WIDTH - scrollX;
            const width = Math.max(4, note.duration * GRID_CELL_WIDTH);
            const isSelected = note.id === selectedNoteId;

            return (
              <div
                key={note.id}
                className={`absolute rounded cursor-move transition-all ${
                  isSelected
                    ? "ring-2 ring-[var(--ed-accent-orange)] shadow-[0_0_12px_rgba(245,158,11,0.5)]"
                    : "hover:shadow-[0_0_8px_rgba(245,158,11,0.3)]"
                }`}
                style={{
                  left: `${x}px`,
                  top: `${y + 1}px`,
                  width: `${width}px`,
                  height: `${ROW_HEIGHT - 2}px`,
                  backgroundColor: `var(--ed-accent-orange)`,
                  opacity: 0.6 + note.velocity * 0.4,
                  pointerEvents: "auto",
                }}
                onMouseDown={(e) => handleNoteMouseDown(e, note.id)}
                onContextMenu={(e) => handleNoteContextMenu(e, note.id)}
              >
                {/* Resize handle (right edge) */}
                <div
                  className="resize-handle absolute top-0 right-0 h-full w-1 bg-[var(--ed-accent-orange)] opacity-0 hover:opacity-100 cursor-col-resize transition-opacity"
                  onMouseDown={(e) => handleNoteMouseDown(e, note.id)}
                />
              </div>
            );
          })}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[var(--ed-accent-orange)] shadow-[0_0_12px_rgba(245,158,11,0.6)] pointer-events-none"
            style={{
              left: `${playheadBeat * GRID_CELL_WIDTH - scrollX}px`,
            }}
          />
        </div>
      </div>

      {/* ─── Info Footer ─────────────────────────────────────── */}
      <div className="px-4 py-1.5 border-t border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/50 text-[9px] text-[var(--ed-text-muted)]">
        {selectedNoteId ? (
          (() => {
            const note = notes.find((n) => n.id === selectedNoteId);
            if (!note) return "No selection";
            const octave = Math.floor(note.midi / 12);
            const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
            return `Selected: ${noteNames[note.midi % 12]}${octave} | Start: ${note.start.toFixed(2)}b | Duration: ${note.duration.toFixed(2)}b | Velocity: ${(note.velocity * 100).toFixed(0)}%`;
          })()
        ) : (
          "Click to add notes • Right-click to delete • Drag to move • Drag right edge to resize"
        )}
      </div>
    </div>
  );
}
