import React, { useEffect, useRef, useState, useCallback } from "react";
import { useDrumStore } from "../store/drumStore";
import { useTransportStore } from "../store/transportStore";
import { audioEngine } from "../audio/AudioEngine";
import { bassEngine } from "../audio/BassEngine";
import { chordsEngine } from "../audio/ChordsEngine";
import { melodyEngine } from "../audio/MelodyEngine";
import { soundFontEngine } from "../audio/SoundFontEngine";

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

type SoundTarget = "bass" | "chords" | "melody" | "drums";

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

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const ROW_HEIGHT = 18;
const PIANO_WIDTH = 52;
const CELL_W = 30;

const TARGET_COLORS: Record<SoundTarget, string> = {
  bass: "var(--ed-accent-bass, #10b981)",
  chords: "var(--ed-accent-chords, #a78bfa)",
  melody: "var(--ed-accent-melody, #f472b6)",
  drums: "var(--ed-accent-orange, #f59e0b)",
};

// GM Drum names for drum target
// GM Drum names available for future drum-mode labeling
// const DRUM_NAMES: Record<number, string> = { 36: "Kick", 38: "Snare", 42: "HH Cl", ... };

/** Play a note preview through the selected sound target */
function previewNote(midi: number, velocity: number, target: SoundTarget): void {
  const time = audioEngine.currentTime;
  switch (target) {
    case "drums":
      audioEngine.triggerVoice(Math.max(0, Math.min(11, midi - 36)));
      break;
    case "bass":
      if (soundFontEngine.isLoaded("bass")) {
        soundFontEngine.playNote("bass", midi, time, velocity, 0.3);
      } else {
        bassEngine.triggerNote(midi, time, false, false, false);
        setTimeout(() => bassEngine.releaseNote(time + 0.3), 300);
      }
      break;
    case "chords":
      if (soundFontEngine.isLoaded("chords")) {
        soundFontEngine.playNote("chords", midi, time, velocity, 0.3);
      } else {
        chordsEngine.triggerChord([midi], time, false, false);
        setTimeout(() => chordsEngine.releaseChord(time + 0.3), 300);
      }
      break;
    case "melody":
      if (soundFontEngine.isLoaded("melody")) {
        soundFontEngine.playNote("melody", midi, time, velocity, 0.3);
      } else {
        melodyEngine.triggerNote(midi, time, false, false, false);
        setTimeout(() => melodyEngine.releaseNote(time + 0.3), 300);
      }
      break;
  }
}

function midiNoteName(midi: number): string {
  return (NOTE_NAMES[midi % 12] ?? "?") + (Math.floor(midi / 12) - 1);
}

export function PianoRoll({ isOpen, onClose }: PianoRollProps) {
  const bpm = useDrumStore((s) => s.bpm);
  const currentStep = useTransportStore((s) => s.currentStep);

  const [notes, setNotes] = useState<PianoRollNote[]>([
    { id: "1", midi: 60, start: 0, duration: 1, velocity: 0.8 },
    { id: "2", midi: 64, start: 1, duration: 0.5, velocity: 0.7 },
    { id: "3", midi: 67, start: 2, duration: 1.5, velocity: 0.9 },
    { id: "4", midi: 63, start: 4, duration: 0.5, velocity: 0.6 },
    { id: "5", midi: 60, start: 5, duration: 2, velocity: 0.85 },
  ]);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [gridRes, setGridRes] = useState(0.25);
  const [snap, setSnap] = useState(true);
  const [target, setTarget] = useState<SoundTarget>("melody");
  const [dragMode, setDragMode] = useState<"none" | "move" | "resize" | "velocity">("none");

  const gridRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; note: PianoRollNote } | null>(null);

  const totalRows = 48; // 4 octaves
  const baseNote = 36; // C2
  const totalBeats = 16;
  const gridW = totalBeats * CELL_W;
  const gridH = totalRows * ROW_HEIGHT;
  const accentColor = TARGET_COLORS[target];

  // ─── Note actions ─────────────────────────────────────

  const addNote = useCallback((midi: number, startBeat: number) => {
    const start = snap ? Math.round(startBeat / gridRes) * gridRes : startBeat;
    const note: PianoRollNote = {
      id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      midi, start: Math.max(0, start), duration: gridRes, velocity: 0.8,
    };
    setNotes((prev) => [...prev, note]);
    setSelectedNoteId(note.id);
    previewNote(midi, 0.8, target);
  }, [gridRes, snap, target]);

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (selectedNoteId === id) setSelectedNoteId(null);
  }, [selectedNoteId]);

  const patchNote = useCallback((id: string, patch: Partial<PianoRollNote>) => {
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, ...patch } : n));
  }, []);

  // ─── Grid click → create note ─────────────────────────

  const handleGridPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left + gridRef.current!.scrollLeft;
    const y = e.clientY - rect.top + gridRef.current!.scrollTop;
    const row = Math.floor(y / ROW_HEIGHT);
    const midi = baseNote + (totalRows - row - 1);
    const beat = x / CELL_W;

    // Check if clicking on a note
    const hit = notes.find((n) => n.midi === midi && beat >= n.start && beat < n.start + n.duration);
    if (hit) {
      setSelectedNoteId(hit.id);
      return; // note drag handled by note's own handler
    }

    setSelectedNoteId(null);
    addNote(midi, beat);
  }, [notes, addNote, baseNote]);

  // ─── Note pointer down → move / resize / velocity ─────

  const handleNotePointerDown = useCallback((e: React.PointerEvent, noteId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedNoteId(noteId);

    const note = notes.find((n) => n.id === noteId);
    if (!note) return;

    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const h = rect.height;
    const w = rect.width;

    // Bottom 5px = velocity drag
    let mode: "move" | "resize" | "velocity" = "move";
    if (relY > h - 5) mode = "velocity";
    else if (relX > w - 6) mode = "resize";

    setDragMode(mode);
    dragStartRef.current = { x: e.clientX, y: e.clientY, note: { ...note } };
    el.setPointerCapture(e.pointerId);
  }, [notes]);

  const handleNotePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragMode === "none" || !dragStartRef.current) return;
    const { x: sx, y: sy, note: orig } = dragStartRef.current;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;

    switch (dragMode) {
      case "move": {
        const beatDelta = dx / CELL_W;
        const pitchDelta = -Math.round(dy / ROW_HEIGHT);
        let newStart = orig.start + beatDelta;
        if (snap) newStart = Math.round(newStart / gridRes) * gridRes;
        patchNote(orig.id, {
          start: Math.max(0, newStart),
          midi: Math.max(0, Math.min(127, orig.midi + pitchDelta)),
        });
        break;
      }
      case "resize": {
        const beatDelta = dx / CELL_W;
        let newDur = orig.duration + beatDelta;
        if (snap) newDur = Math.round(newDur / gridRes) * gridRes;
        patchNote(orig.id, { duration: Math.max(gridRes, newDur) });
        break;
      }
      case "velocity": {
        const velDelta = -dy / 80; // 80px = full range
        patchNote(orig.id, { velocity: Math.max(0.05, Math.min(1, orig.velocity + velDelta)) });
        break;
      }
    }
  }, [dragMode, gridRes, snap, patchNote]);

  const handleNotePointerUp = useCallback((e: React.PointerEvent) => {
    if (dragMode === "move" && dragStartRef.current) {
      // Preview new pitch after move
      const note = notes.find((n) => n.id === dragStartRef.current?.note.id);
      if (note && note.midi !== dragStartRef.current.note.midi) {
        previewNote(note.midi, note.velocity, target);
      }
    }
    setDragMode("none");
    dragStartRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, [dragMode, notes, target]);

  // ─── Right-click = delete ─────────────────────────────

  const handleNoteContext = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    removeNote(id);
  }, [removeNote]);

  // ─── Piano key click = preview ────────────────────────

  const handleKeyClick = useCallback((midi: number) => {
    previewNote(midi, 0.8, target);
  }, [target]);

  // ─── Keyboard: Delete ─────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNoteId) {
        e.preventDefault();
        removeNote(selectedNoteId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, selectedNoteId, removeNote]);

  if (!isOpen) return null;

  const playheadBeat = currentStep / 4;
  const selectedNote = notes.find((n) => n.id === selectedNoteId);

  return (
    <div className="fixed inset-0 z-50 bg-[var(--ed-bg-primary)] flex flex-col">
      {/* ─── Toolbar ──────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/60">
        <span className="text-[10px] font-black tracking-[0.15em]" style={{ color: accentColor }}>PIANO ROLL</span>

        {/* Sound target selector */}
        <div className="flex gap-[2px] bg-black/20 rounded-md p-[2px]">
          {(["melody", "chords", "bass", "drums"] as SoundTarget[]).map((t) => (
            <button key={t} onClick={() => setTarget(t)}
              className="px-2.5 py-1 text-[8px] font-bold tracking-wider rounded transition-all"
              style={{
                backgroundColor: target === t ? TARGET_COLORS[t] : "transparent",
                color: target === t ? "#000" : TARGET_COLORS[t],
                opacity: target === t ? 1 : 0.5,
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-white/10" />

        {/* Grid resolution */}
        <div className="flex items-center gap-1">
          <span className="text-[8px] text-white/25 font-bold">GRID</span>
          <select value={gridRes} onChange={(e) => setGridRes(parseFloat(e.target.value))}
            className="h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded text-white/70 cursor-pointer">
            <option value={0.125}>1/32</option>
            <option value={0.25}>1/16</option>
            <option value={0.5}>1/8</option>
            <option value={1}>1/4</option>
          </select>
        </div>

        {/* Snap */}
        <button onClick={() => setSnap(!snap)}
          className="px-2 py-1 text-[8px] font-bold tracking-wider rounded transition-all"
          style={{
            backgroundColor: snap ? accentColor : "transparent",
            color: snap ? "#000" : "white",
            opacity: snap ? 1 : 0.3,
            border: `1px solid ${snap ? accentColor : "rgba(255,255,255,0.1)"}`,
          }}
        >SNAP</button>

        <span className="text-[9px] text-white/30 font-mono">{bpm} BPM</span>
        <span className="text-[9px] text-white/20">{notes.length} notes</span>

        <div className="flex-1" />

        <button onClick={onClose}
          className="px-3 py-1 text-[9px] font-bold tracking-wider text-white/40 hover:text-white/80 border border-white/10 hover:border-white/25 rounded transition-all">
          ← BACK
        </button>
      </div>

      {/* ─── Piano + Grid ─────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Piano keys */}
        <div className="shrink-0 overflow-y-auto border-r border-[var(--ed-border)]" style={{ width: PIANO_WIDTH }}>
          {Array.from({ length: totalRows }, (_, i) => {
            const midi = baseNote + (totalRows - i - 1);
            const noteIdx = midi % 12;
            const octave = Math.floor(midi / 12) - 1;
            const isBlack = OCTAVE_PATTERN[noteIdx]?.black ?? false;
            const isC = noteIdx === 0;

            return (
              <div key={i} onClick={() => handleKeyClick(midi)}
                className={`flex items-center px-1.5 text-[7px] font-bold tracking-wider cursor-pointer select-none border-b transition-colors ${
                  isBlack
                    ? "bg-[#131316] text-white/15 hover:bg-[#1c1c22] border-[#0a0a0c]"
                    : "bg-[#24242a] text-white/25 hover:bg-[#2e2e36] border-[#1a1a1e]"
                } ${isC ? "border-b-[var(--ed-border)]" : "border-b-[#1a1a1e]/50"}`}
                style={{ height: ROW_HEIGHT, justifyContent: isBlack ? "flex-end" : "flex-start" }}
              >
                {isC && <span className="text-white/40">C{octave}</span>}
              </div>
            );
          })}
        </div>

        {/* Grid + notes */}
        <div ref={gridRef} className="flex-1 overflow-auto relative" onPointerDown={handleGridPointerDown}>
          {/* Background grid */}
          <div className="relative" style={{ width: gridW, height: gridH }}>
            {/* Row stripes (black key rows darker) */}
            {Array.from({ length: totalRows }, (_, i) => {
              const midi = baseNote + (totalRows - i - 1);
              const isBlack = OCTAVE_PATTERN[midi % 12]?.black ?? false;
              return (
                <div key={`row-${i}`} className="absolute w-full border-b border-white/[0.03]"
                  style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT, backgroundColor: isBlack ? "rgba(255,255,255,0.015)" : "transparent" }}
                />
              );
            })}

            {/* Vertical beat lines */}
            {Array.from({ length: totalBeats * 4 + 1 }, (_, i) => {
              const x = i * (CELL_W / 4);
              const isBar = i % 16 === 0;
              const isBeat = i % 4 === 0;
              return (
                <div key={`vl-${i}`} className="absolute top-0 bottom-0"
                  style={{
                    left: x, width: 1,
                    backgroundColor: isBar ? "rgba(255,255,255,0.18)" : isBeat ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                  }}
                />
              );
            })}

            {/* Bar numbers */}
            {Array.from({ length: Math.ceil(totalBeats / 4) }, (_, i) => (
              <div key={`bar-${i}`} className="absolute text-[8px] font-bold text-white/12" style={{ left: i * 4 * CELL_W + 4, top: 2 }}>
                {i + 1}
              </div>
            ))}

            {/* ─── Notes ──────────────────────────────────── */}
            {notes.map((note) => {
              const row = totalRows - (note.midi - baseNote) - 1;
              if (row < 0 || row >= totalRows) return null;
              const x = note.start * CELL_W;
              const y = row * ROW_HEIGHT;
              const w = Math.max(4, note.duration * CELL_W);
              const isSel = note.id === selectedNoteId;

              return (
                <div key={note.id}
                  onPointerDown={(e) => handleNotePointerDown(e, note.id)}
                  onPointerMove={handleNotePointerMove}
                  onPointerUp={handleNotePointerUp}
                  onContextMenu={(e) => handleNoteContext(e, note.id)}
                  className="absolute rounded-[3px] touch-none select-none"
                  style={{
                    left: x, top: y + 1, width: w, height: ROW_HEIGHT - 2,
                    backgroundColor: accentColor,
                    opacity: 0.5 + note.velocity * 0.5,
                    outline: isSel ? `2px solid white` : "none",
                    outlineOffset: "-1px",
                    boxShadow: isSel ? `0 0 12px ${accentColor}60` : "none",
                    zIndex: isSel ? 10 : 1,
                    cursor: dragMode === "resize" ? "col-resize" : dragMode === "velocity" ? "ns-resize" : "grab",
                  }}
                >
                  {/* Note name (if wide enough) */}
                  {w > 28 && (
                    <span className="absolute left-1 top-0 text-[7px] font-bold text-black/60 leading-none" style={{ top: 2 }}>
                      {midiNoteName(note.midi)}
                    </span>
                  )}

                  {/* Velocity bar (bottom) */}
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[3px] cursor-ns-resize"
                    style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
                    <div className="h-full rounded-b-[3px]"
                      style={{ width: `${note.velocity * 100}%`, backgroundColor: "rgba(255,255,255,0.4)" }} />
                  </div>

                  {/* Resize handle (right edge) */}
                  <div className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize hover:bg-white/20 rounded-r-[3px] transition-colors" />
                </div>
              );
            })}

            {/* Playhead */}
            <div className="absolute top-0 pointer-events-none" style={{
              left: playheadBeat * CELL_W, width: 2, height: gridH,
              backgroundColor: accentColor,
              boxShadow: `0 0 8px ${accentColor}, 0 0 20px ${accentColor}40`,
            }} />
          </div>
        </div>
      </div>

      {/* ─── Footer ───────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/60 text-[9px]">
        <div className="text-white/30">
          {selectedNote
            ? `${midiNoteName(selectedNote.midi)} | Beat ${selectedNote.start.toFixed(2)} | Dur ${selectedNote.duration.toFixed(2)} | Vel ${Math.round(selectedNote.velocity * 100)}%`
            : "Click = add note · Drag = move · Right edge = duration · Bottom edge = velocity · Right-click = delete"
          }
        </div>
        <div className="flex items-center gap-2 text-white/20">
          <span>Target: <strong style={{ color: accentColor }}>{target.toUpperCase()}</strong></span>
          <span>·</span>
          <span>Click piano keys to preview</span>
        </div>
      </div>
    </div>
  );
}
