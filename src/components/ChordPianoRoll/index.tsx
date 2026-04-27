// src/components/ChordPianoRoll/index.tsx

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore, memo,
} from "react";
import { useChordPianoStore } from "../../store/chordPianoStore";
import { useChordsStore } from "../../store/chordsStore";
import { useDrumStore } from "../../store/drumStore";
import { drumCurrentStepStore, getDrumCurrentStep } from "../../store/drumStore";
import { SCALES } from "../../audio/BassEngine";
import { chordSnap } from "./chordSnap";
import { CHORD_SET_IDS, CHORD_SETS } from "./chordSets";
// Side-effect import: activates the module-level scheduler
import "./chordPianoScheduler";
import type { ChordNote } from "../../store/chordPianoStore";

// ─── Layout constants ─────────────────────────────────────────────────────────
const PIANO_W = 56;
const ROW_H = 14;
const RULER_H = 28;
const MIDI_MIN = 24;   // C1
const MIDI_MAX = 96;   // C7
const ROWS = MIDI_MAX - MIDI_MIN; // 72 rows

// ─── Note names ───────────────────────────────────────────────────────────────
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const;

// ─── Chord group color (stable hash) ─────────────────────────────────────────
const GROUP_COLORS = [
  "#a855f7","#22c55e","#f59e0b","#3b82f6","#ef4444",
  "#06b6d4","#f97316","#8b5cf6","#10b981","#ec4899",
] as const;

function groupColor(group: string): string {
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) | 0;
  return GROUP_COLORS[Math.abs(h) % GROUP_COLORS.length]!;
}

// ─── Scale helpers ────────────────────────────────────────────────────────────
function isInScale(pitch: number, rootNote: number, scaleName: string): boolean {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const semitone = ((pitch - rootNote) % 12 + 12) % 12;
  return scale.includes(semitone);
}

function isRoot(pitch: number, rootNote: number): boolean {
  return ((pitch - rootNote) % 12 + 12) % 12 === 0;
}

// ─── Piano Key row ────────────────────────────────────────────────────────────
const PianoKey = memo(function PianoKey({
  pitch, rootNote, scaleName,
}: { pitch: number; rootNote: number; scaleName: string }) {
  const noteName = NOTE_NAMES[pitch % 12]!;
  const isBlack = noteName.includes("#");
  const isScaleNote = isInScale(pitch, rootNote, scaleName);
  const isRootNote = isRoot(pitch, rootNote);
  const isC = noteName === "C";

  return (
    <div
      className="flex items-center justify-end pr-1 border-b border-white/5 select-none shrink-0"
      style={{
        height: ROW_H,
        background: isRootNote
          ? "rgba(249,115,22,0.18)"
          : isScaleNote
          ? "rgba(168,85,247,0.07)"
          : isBlack
          ? "#0a0a0f"
          : "#101018",
      }}
    >
      {isC && (
        <span className="text-[7px] font-mono text-white/30 leading-none">
          {NOTE_NAMES[pitch % 12]}{Math.floor(pitch / 12) - 1}
        </span>
      )}
      {isRootNote && !isC && (
        <span className="text-[7px] font-mono text-orange-400/60 leading-none">
          {NOTE_NAMES[pitch % 12]}
        </span>
      )}
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────
interface ChordPianoRollProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChordPianoRoll({ isOpen, onClose }: ChordPianoRollProps) {
  const {
    notes, activeChordSet, snapEnabled, snapResolution, totalBeats, chordsSource,
    addNotes, removeGroup, setActiveChordSet, setSnapEnabled, setSnapResolution,
    setChordsSource, clear,
  } = useChordPianoStore();

  const rootNote = useChordsStore((s) => s.rootNote);
  const scaleName = useChordsStore((s) => s.scaleName);
  const isPlaying = useDrumStore((s) => s.isPlaying);

  // Playhead via drum step clock
  const currentStep = useSyncExternalStore(
    drumCurrentStepStore.subscribe,
    getDrumCurrentStep,
  );
  const totalSteps = Math.round(totalBeats * 4);
  const playheadBeat = (currentStep % totalSteps) / 4;

  const [tool, setTool] = useState<"draw" | "select">("draw");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [pixelsPerBeat, setPixelsPerBeat] = useState(60);
  const [hoverCell, setHoverCell] = useState<{ beat: number; pitch: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "b": case "B":
          setTool("draw");
          break;
        case "s": case "S":
          setTool("select");
          break;
        case "Delete": case "Backspace":
          if (selectedGroup) {
            removeGroup(selectedGroup);
            setSelectedGroup(null);
          }
          break;
        case "a": case "A":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setSelectedGroup(notes[0]?.chordGroup ?? null);
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, selectedGroup, removeGroup, onClose, notes]);

  // ── Ctrl+Scroll zoom ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isOpen) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setPixelsPerBeat((p) => Math.max(30, Math.min(200, p - e.deltaY * 0.12)));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [isOpen]);

  // ── Snap beat helper ────────────────────────────────────────────────────────
  const snapBeat = useCallback(
    (rawBeat: number) =>
      Math.floor(rawBeat / snapResolution) * snapResolution,
    [snapResolution],
  );

  // ── Grid click — place chord ────────────────────────────────────────────────
  const handleGridPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rawBeat = x / pixelsPerBeat;
      const beat = snapBeat(rawBeat);
      const pitch = MIDI_MAX - 1 - Math.floor(y / ROW_H);

      if (pitch < MIDI_MIN || pitch >= MIDI_MAX) return;

      // Hit-test existing note block
      const hitGroup = notes.find((n) => {
        const ns = n.startBeat * pixelsPerBeat;
        const ne = (n.startBeat + n.durationBeats) * pixelsPerBeat;
        const nt = (MIDI_MAX - 1 - n.pitch) * ROW_H;
        const nb = nt + ROW_H;
        return x >= ns && x < ne && y >= nt && y < nb;
      })?.chordGroup ?? null;

      if (hitGroup) {
        setSelectedGroup(hitGroup === selectedGroup ? null : hitGroup);
        return;
      }

      if (tool === "select") {
        setSelectedGroup(null);
        return;
      }

      // Draw mode — place chord or single note
      const newNotes: ChordNote[] = snapEnabled
        ? chordSnap(pitch, rootNote, scaleName, activeChordSet, beat, snapResolution, 90)
        : [{
            id: crypto.randomUUID(),
            pitch,
            startBeat: beat,
            durationBeats: snapResolution,
            velocity: 90,
            chordGroup: `single@${beat.toFixed(2)}-${pitch}`,
          }];

      addNotes(newNotes);
      setSelectedGroup(newNotes[0]?.chordGroup ?? null);
    },
    [
      notes, tool, snapEnabled, snapBeat, pixelsPerBeat, rootNote, scaleName,
      activeChordSet, snapResolution, selectedGroup, addNotes,
    ],
  );

  // ── Hover ghost preview ─────────────────────────────────────────────────────
  const handleGridMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (tool !== "draw") { setHoverCell(null); return; }
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const beat = snapBeat(x / pixelsPerBeat);
      const pitch = MIDI_MAX - 1 - Math.floor(y / ROW_H);
      if (pitch >= MIDI_MIN && pitch < MIDI_MAX) {
        setHoverCell({ beat, pitch });
      } else {
        setHoverCell(null);
      }
    },
    [tool, snapBeat, pixelsPerBeat],
  );

  // ── Ghost preview note computation ──────────────────────────────────────────
  const ghostNotes: ChordNote[] = hoverCell && snapEnabled
    ? chordSnap(
        hoverCell.pitch, rootNote, scaleName, activeChordSet,
        hoverCell.beat, snapResolution, 90,
      )
    : hoverCell && !snapEnabled
    ? [{ id: "ghost", pitch: hoverCell.pitch, startBeat: hoverCell.beat, durationBeats: snapResolution, velocity: 90, chordGroup: "ghost" }]
    : [];

  if (!isOpen) return null;

  const gridWidth = totalBeats * pixelsPerBeat;
  const gridHeight = ROWS * ROW_H;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#08090d]/97 backdrop-blur-sm">

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap px-3 py-2 border-b border-white/8 shrink-0">
        <span
          className="text-[10px] font-black tracking-[0.16em] shrink-0"
          style={{ color: "var(--ed-accent-chords)", textShadow: "0 0 12px rgba(167,139,250,0.25)" }}
        >
          CHORDS
        </span>
        <span className="text-[8px] text-white/30 font-mono shrink-0">
          {NOTE_NAMES[rootNote % 12]} · {scaleName}
        </span>

        <div className="w-px h-4 bg-white/8" />

        {/* Draw / Select tool */}
        {(["draw", "select"] as const).map((t) => (
          <button key={t}
            onClick={() => setTool(t)}
            className={`h-6 px-2.5 text-[8px] font-bold rounded-md transition-all ${
              tool === t
                ? "bg-[var(--ed-accent-chords)]/20 text-[var(--ed-accent-chords)]"
                : "text-white/30 hover:text-white/60 hover:bg-white/5"
            }`}
          >
            {t === "draw" ? "✏ DRAW" : "↖ SELECT"}
          </button>
        ))}

        <div className="w-px h-4 bg-white/8" />

        {/* Chord Snap */}
        <button
          onClick={() => setSnapEnabled(!snapEnabled)}
          className={`h-6 px-2.5 text-[8px] font-bold rounded-md transition-all ${
            snapEnabled
              ? "bg-[var(--ed-accent-chords)]/20 text-[var(--ed-accent-chords)] shadow-[0_0_8px_rgba(167,139,250,0.15)]"
              : "text-white/30 hover:text-white/50 hover:bg-white/5"
          }`}
          title="Chord Snap: one click places full chord"
        >
          ⚡ SNAP {snapEnabled ? "ON" : "OFF"}
        </button>

        {/* Snap resolution */}
        {([0.25, 0.5, 1] as const).map((r) => (
          <button key={r}
            onClick={() => setSnapResolution(r)}
            className={`h-6 px-2 text-[8px] font-bold rounded-md transition-all ${
              snapResolution === r
                ? "bg-white/15 text-white/90"
                : "text-white/25 hover:text-white/55"
            }`}
          >
            {r === 0.25 ? "1/16" : r === 0.5 ? "1/8" : "1/4"}
          </button>
        ))}

        <div className="w-px h-4 bg-white/8" />

        {/* chordsSource toggle */}
        {(["grid","piano","both"] as const).map((src) => (
          <button key={src}
            onClick={() => setChordsSource(src)}
            className={`h-6 px-2 text-[7px] font-bold rounded-md uppercase tracking-wider transition-all ${
              chordsSource === src
                ? "bg-white/12 text-white/80"
                : "text-white/20 hover:text-white/50"
            }`}
            title={src === "grid" ? "Step-grid only" : src === "piano" ? "Piano Roll only" : "Both active"}
          >
            {src}
          </button>
        ))}

        <div className="flex-1" />
        <span className="hidden lg:inline text-[7px] text-white/15">Ctrl+Scroll = zoom</span>
        <div className="w-px h-4 bg-white/8" />

        <button onClick={clear}
          className="h-6 px-2 text-[7px] font-bold text-white/25 hover:text-red-400/70 hover:bg-white/5 rounded-md transition-all">
          CLR
        </button>
        <button onClick={onClose}
          className="h-6 w-6 flex items-center justify-center text-white/30 hover:text-white/80 hover:bg-white/8 rounded-md transition-all"
          title="Close (Esc)">
          ×
        </button>
      </div>

      {/* ── Chord Set Bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/6 overflow-x-auto shrink-0">
        {CHORD_SET_IDS.map((id) => (
          <button key={id}
            onClick={() => setActiveChordSet(id)}
            className={`h-6 px-2.5 text-[8px] font-bold rounded-full whitespace-nowrap transition-all shrink-0 ${
              activeChordSet === id
                ? "bg-[var(--ed-accent-chords)]/20 text-[var(--ed-accent-chords)] border border-[var(--ed-accent-chords)]/40"
                : "bg-white/[0.04] text-white/40 border border-white/8 hover:text-white/70 hover:bg-white/8"
            }`}
          >
            {CHORD_SETS[id].label}
          </button>
        ))}
        <span className="ml-2 text-[7px] text-white/20 shrink-0">
          {CHORD_SETS[activeChordSet].description}
        </span>
      </div>

      {/* ── Piano Roll Body ────────────────────────────────────────────────── */}
      <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">

        {/* Piano keys — left column */}
        <div className="shrink-0 flex flex-col overflow-hidden" style={{ width: PIANO_W, paddingTop: RULER_H }}>
          <div className="overflow-y-auto flex-1">
            {Array.from({ length: ROWS }, (_, i) => {
              const pitch = MIDI_MAX - 1 - i;
              return (
                <PianoKey key={pitch} pitch={pitch} rootNote={rootNote} scaleName={scaleName} />
              );
            })}
          </div>
        </div>

        {/* Scrollable grid */}
        <div className="flex-1 min-w-0 overflow-auto">
          <div style={{ width: gridWidth, minWidth: gridWidth }}>

            {/* Ruler */}
            <div
              className="sticky top-0 z-10 bg-[#0a0b10] border-b border-white/8 relative"
              style={{ height: RULER_H, width: gridWidth }}
            >
              {Array.from({ length: Math.ceil(totalBeats / 4) + 1 }, (_, bar) => {
                const x = bar * 4 * pixelsPerBeat;
                if (x > gridWidth) return null;
                return (
                  <div key={bar} className="absolute top-0 bottom-0" style={{ left: x }}>
                    <div className="w-px h-full bg-white/15" />
                    {bar < Math.ceil(totalBeats / 4) && (
                      <span className="absolute top-1 left-1 text-[8px] font-mono text-white/40 whitespace-nowrap">
                        {bar + 1}
                      </span>
                    )}
                  </div>
                );
              })}
              {/* Beat sub-ticks */}
              {Array.from({ length: totalBeats + 1 }, (_, beat) => {
                if (beat % 4 === 0) return null;
                return (
                  <div key={`b${beat}`}
                    className="absolute top-[60%] bottom-0 w-px bg-white/6"
                    style={{ left: beat * pixelsPerBeat }} />
                );
              })}
              {/* Playhead triangle on ruler */}
              {isPlaying && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: playheadBeat * pixelsPerBeat }}
                >
                  <div className="w-px h-full bg-white/50" />
                  <div className="absolute top-0 -translate-x-1/2" style={{
                    width: 0, height: 0,
                    borderLeft: "5px solid transparent",
                    borderRight: "5px solid transparent",
                    borderTop: "6px solid rgba(255,255,255,0.7)",
                  }} />
                </div>
              )}
            </div>

            {/* Note grid */}
            <div
              ref={gridRef}
              className="relative cursor-crosshair"
              style={{ width: gridWidth, height: gridHeight }}
              onPointerDown={handleGridPointerDown}
              onMouseMove={handleGridMouseMove}
              onMouseLeave={() => setHoverCell(null)}
            >
              {/* Pitch rows */}
              {Array.from({ length: ROWS }, (_, i) => {
                const pitch = MIDI_MAX - 1 - i;
                const inScale = isInScale(pitch, rootNote, scaleName);
                const isRootRow = isRoot(pitch, rootNote);
                return (
                  <div key={pitch} className="absolute inset-x-0" style={{
                    top: i * ROW_H,
                    height: ROW_H,
                    background: isRootRow
                      ? "rgba(167,139,250,0.06)"
                      : inScale
                      ? "rgba(168,85,247,0.03)"
                      : "transparent",
                    borderBottom: "1px solid rgba(255,255,255,0.035)",
                  }} />
                );
              })}

              {/* Vertical beat lines */}
              {Array.from({ length: totalBeats + 1 }, (_, beat) => {
                const isBeat = beat % 4 === 0;
                return (
                  <div key={`vl${beat}`} className="absolute top-0 bottom-0" style={{
                    left: beat * pixelsPerBeat,
                    width: 1,
                    background: isBeat ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                  }} />
                );
              })}

              {/* Playhead line */}
              {isPlaying && (
                <div className="absolute top-0 bottom-0 w-px pointer-events-none z-20" style={{
                  left: playheadBeat * pixelsPerBeat,
                  background: "rgba(255,255,255,0.5)",
                  boxShadow: "0 0 6px rgba(255,255,255,0.2)",
                }} />
              )}

              {/* Note blocks */}
              {notes.map((n) => {
                const x = n.startBeat * pixelsPerBeat;
                const y = (MIDI_MAX - 1 - n.pitch) * ROW_H;
                const w = Math.max(2, n.durationBeats * pixelsPerBeat - 1);
                const color = groupColor(n.chordGroup);
                const isSelected = selectedGroup === n.chordGroup;
                return (
                  <div
                    key={n.id}
                    className="absolute rounded-sm pointer-events-none"
                    style={{
                      left: x, top: y, width: w, height: ROW_H - 1,
                      background: color,
                      opacity: isSelected ? 1 : 0.7,
                      boxShadow: isSelected ? `0 0 0 1px ${color}, 0 0 8px ${color}66` : "none",
                    }}
                  />
                );
              })}

              {/* Ghost preview */}
              {ghostNotes.map((n, i) => {
                const x = n.startBeat * pixelsPerBeat;
                const y = (MIDI_MAX - 1 - n.pitch) * ROW_H;
                const w = Math.max(2, n.durationBeats * pixelsPerBeat - 1);
                return (
                  <div
                    key={`ghost-${i}`}
                    className="absolute rounded-sm pointer-events-none"
                    style={{
                      left: x, top: y, width: w, height: ROW_H - 1,
                      background: "rgba(167,139,250,0.35)",
                      border: "1px solid rgba(167,139,250,0.6)",
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail Panel ──────────────────────────────────────────────────── */}
      {selectedGroup && (() => {
        const groupNotes = notes.filter((n) => n.chordGroup === selectedGroup);
        const color = groupColor(selectedGroup);
        return (
          <div className="shrink-0 border-t border-white/8 px-3 py-2 flex items-center gap-3 bg-[#0a0b10]">
            <span className="text-[8px] font-black text-white/40 tracking-wider shrink-0">CHORD</span>
            <div className="flex flex-wrap gap-1">
              {groupNotes.map((n) => (
                <span
                  key={n.id}
                  className="inline-flex items-center h-5 px-1.5 rounded text-[7px] font-bold font-mono"
                  style={{ background: `${color}22`, border: `1px solid ${color}55`, color }}
                >
                  {NOTE_NAMES[n.pitch % 12]}{Math.floor(n.pitch / 12) - 1}
                </span>
              ))}
            </div>
            <div className="flex-1" />
            <button
              onClick={() => { removeGroup(selectedGroup); setSelectedGroup(null); }}
              className="h-5 px-2 text-[7px] font-bold text-red-400/50 hover:text-red-400 hover:bg-red-400/10 rounded transition-all"
            >
              DELETE
            </button>
          </div>
        );
      })()}
    </div>
  );
}
