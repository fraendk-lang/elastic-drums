import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useDrumStore } from "../../store/drumStore";
import { useBassStore } from "../../store/bassStore";
import { useTransportStore } from "../../store/transportStore";
import {
  type PianoRollNote,
  type SoundTarget,
  type LoopRange,
  BASE_NOTE,
  TOTAL_ROWS,
  DEFAULT_CELL_W,
  DEFAULT_ROW_HEIGHT,
  RULER_HEIGHT,
  VELOCITY_LANE_HEIGHT,
  TARGET_COLORS,
  OCTAVE_PATTERN,
  midiNoteName,
  uid,
  isNoteInScale,
  snapToScale,
} from "./types";
import { generateHarmony, harmonizeNotes, type HarmonyType } from "./harmony";
import { previewNote } from "./preview";
import { setPianoRollNotes, setPianoRollLoop } from "./scheduler";
import { PianoRollKeys } from "./PianoRollKeys";
import { PianoRollRuler } from "./PianoRollRuler";
import { PianoRollToolbar } from "./PianoRollToolbar";

interface PianoRollProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODULE-LEVEL STATE — survives component unmount
   ═════════════════════════════════════════════════════════════════════════ */

let _persistedNotes: PianoRollNote[] = [];
let _persistedLoop: LoopRange = { start: 0, end: 16, enabled: false };

export function PianoRoll({ isOpen, onClose }: PianoRollProps) {
  const bpm = useDrumStore((s) => s.bpm);
  const currentStep = useTransportStore((s) => s.currentStep);
  const rootNote = useBassStore((s) => s.rootNote);
  const scaleName = useBassStore((s) => s.scaleName);

  // ─── STATE ────────────────────────────────────────────────────
  const [notes, setNotesLocal] = useState<PianoRollNote[]>(_persistedNotes);
  const setNotes = useCallback(
    (updater: PianoRollNote[] | ((prev: PianoRollNote[]) => PianoRollNote[])) => {
      setNotesLocal((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        _persistedNotes = next;
        setPianoRollNotes(next);
        return next;
      });
    },
    [],
  );

  const [loop, setLoopLocal] = useState<LoopRange>(_persistedLoop);
  const setLoop = useCallback((next: LoopRange) => {
    _persistedLoop = next;
    setLoopLocal(next);
    setPianoRollLoop(next);
  }, []);

  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [gridRes, setGridRes] = useState(0.25);
  const [snap, setSnap] = useState(true);
  const [target, setTarget] = useState<SoundTarget>("melody");
  const [tool, setTool] = useState<"draw" | "select">("draw");
  const [dragMode, setDragMode] = useState<"none" | "move" | "resize" | "velocity">("none");
  const [cellW, setCellW] = useState(DEFAULT_CELL_W);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [scaleSnap, setScaleSnap] = useState(false);
  const [clipboard, setClipboard] = useState<PianoRollNote[]>([]);
  const [rubberBand, setRubberBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  // ─── Sync initial persisted state into scheduler on mount ───
  useEffect(() => {
    setPianoRollNotes(_persistedNotes);
    setPianoRollLoop(_persistedLoop);
  }, []);

  // ─── Layout ──────────────────────────────────────────────────
  const patternLength = useDrumStore((s) => s.pattern.length);
  const totalBeats = Math.max(16, patternLength / 4);
  const rootMidi = 60 + rootNote;
  const gridW = totalBeats * cellW;
  const gridH = TOTAL_ROWS * rowHeight;
  const accentColor = TARGET_COLORS[target];

  // ─── Undo / Redo ─────────────────────────────────────────────
  const undoStackRef = useRef<PianoRollNote[][]>([]);
  const redoStackRef = useRef<PianoRollNote[][]>([]);
  const pushUndo = useCallback(() => {
    undoStackRef.current.push(JSON.parse(JSON.stringify(notes)));
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, [notes]);
  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(JSON.parse(JSON.stringify(notes)));
    setNotes(prev);
  }, [notes, setNotes]);
  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(JSON.parse(JSON.stringify(notes)));
    setNotes(next);
  }, [notes, setNotes]);

  // ─── Refs ───────────────────────────────────────────────────
  const gridRef = useRef<HTMLDivElement>(null);
  const pianoKeysRef = useRef<HTMLDivElement>(null);
  const lastDrawnDurationRef = useRef<number | null>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    note: PianoRollNote;
    originals: Map<string, { start: number; midi: number }>;
  } | null>(null);
  const gridClickStartRef = useRef<{ x: number; y: number } | null>(null);

  // ─── Scroll sync: piano keys follow grid vertical scroll (inline onScroll) ──
  const handleGridScroll = useCallback(() => {
    const grid = gridRef.current;
    const keys = pianoKeysRef.current;
    if (!grid || !keys) return;
    if (keys.scrollTop !== grid.scrollTop) keys.scrollTop = grid.scrollTop;
  }, []);

  // ─── Snap helper (shared with ruler) ─────────────────────────
  const snapBeat = useCallback(
    (beat: number) => (snap ? Math.round(beat / gridRes) * gridRes : beat),
    [snap, gridRes],
  );

  // ─── NOTE ACTIONS ─────────────────────────────────────────────
  const addNote = useCallback(
    (midi: number, startBeat: number) => {
      let finalMidi = midi;
      let start = startBeat;
      if (scaleSnap) finalMidi = snapToScale(midi, rootMidi, scaleName);
      if (snap) start = Math.round(startBeat / gridRes) * gridRes;

      const duration = lastDrawnDurationRef.current ?? Math.max(gridRes, 1);

      const note: PianoRollNote = {
        id: uid(),
        midi: finalMidi,
        start: Math.max(0, start),
        duration,
        velocity: 0.8,
        track: target,
      };
      setNotes((prev) => [...prev, note]);
      setSelectedNoteIds(new Set([note.id]));
      previewNote(finalMidi, 0.8, target);
    },
    [gridRes, snap, scaleSnap, target, rootMidi, scaleName, setNotes],
  );

  const removeNotes = useCallback((ids: Set<string>) => {
    setNotes((prev) => prev.filter((n) => !ids.has(n.id)));
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, [setNotes]);

  const patchNotes = useCallback((ids: Set<string>, patch: Partial<PianoRollNote>) => {
    setNotes((prev) => prev.map((n) => (ids.has(n.id) ? { ...n, ...patch } : n)));
  }, [setNotes]);

  const quantizeNotes = useCallback(
    (ids: Set<string>) => {
      setNotes((prev) =>
        prev.map((n) => {
          if (!ids.has(n.id)) return n;
          return {
            ...n,
            start: Math.round(n.start / gridRes) * gridRes,
            duration: Math.round(n.duration / gridRes) * gridRes,
          };
        }),
      );
    },
    [gridRes, setNotes],
  );

  const copyNotes = useCallback(() => {
    const toCopy = notes.filter((n) => selectedNoteIds.has(n.id));
    if (toCopy.length === 0) return;
    const minStart = Math.min(...toCopy.map((n) => n.start));
    setClipboard(toCopy.map((n) => ({ ...n, start: n.start - minStart })));
  }, [notes, selectedNoteIds]);

  const pasteNotes = useCallback(() => {
    if (clipboard.length === 0) return;
    const playheadBeat = currentStep * 0.25;
    const newNotes = clipboard.map((n) => ({
      ...n,
      id: uid(),
      start: n.start + playheadBeat,
      track: target,
    }));
    setNotes((prev) => [...prev, ...newNotes]);
    setSelectedNoteIds(new Set(newNotes.map((n) => n.id)));
  }, [clipboard, currentStep, target, setNotes]);

  // ─── KEYBOARD ────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const hasSel = selectedNoteIds.size > 0;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "a") {
          e.preventDefault();
          setSelectedNoteIds(new Set(notes.map((n) => n.id)));
        } else if (e.key === "c") {
          e.preventDefault();
          copyNotes();
        } else if (e.key === "v") {
          e.preventDefault();
          pushUndo();
          pasteNotes();
        } else if (e.key === "z" && e.shiftKey) {
          e.preventDefault();
          redo();
        } else if (e.key === "z") {
          e.preventDefault();
          undo();
        }
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && hasSel) {
        e.preventDefault();
        pushUndo();
        removeNotes(selectedNoteIds);
        return;
      }

      // Tool shortcuts
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setTool("draw");
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setTool("select");
        return;
      }
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        setLoop({ ..._persistedLoop, enabled: !_persistedLoop.enabled });
        return;
      }

      if (e.key === "ArrowLeft" && hasSel) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : gridRes;
        setNotes((prev) =>
          prev.map((n) =>
            !selectedNoteIds.has(n.id)
              ? n
              : { ...n, start: Math.max(0, Math.round((n.start - step) / gridRes) * gridRes) },
          ),
        );
        return;
      }
      if (e.key === "ArrowRight" && hasSel) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : gridRes;
        setNotes((prev) =>
          prev.map((n) =>
            !selectedNoteIds.has(n.id)
              ? n
              : {
                  ...n,
                  start: Math.min(totalBeats - n.duration, Math.round((n.start + step) / gridRes) * gridRes),
                },
          ),
        );
        return;
      }
      if (e.key === "ArrowUp" && hasSel) {
        e.preventDefault();
        const semitones = e.shiftKey ? 12 : 1;
        setNotes((prev) =>
          prev.map((n) => {
            if (!selectedNoteIds.has(n.id)) return n;
            let m = Math.min(BASE_NOTE + TOTAL_ROWS - 1, n.midi + semitones);
            if (scaleSnap) m = snapToScale(m, rootMidi, scaleName);
            return { ...n, midi: m };
          }),
        );
        return;
      }
      if (e.key === "ArrowDown" && hasSel) {
        e.preventDefault();
        const semitones = e.shiftKey ? 12 : 1;
        setNotes((prev) =>
          prev.map((n) => {
            if (!selectedNoteIds.has(n.id)) return n;
            let m = Math.max(BASE_NOTE, n.midi - semitones);
            if (scaleSnap) m = snapToScale(m, rootMidi, scaleName);
            return { ...n, midi: m };
          }),
        );
        return;
      }

      if (hasSel && e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        const vel = e.key === "0" ? 1.0 : parseInt(e.key) / 10;
        setNotes((prev) => prev.map((n) => (!selectedNoteIds.has(n.id) ? n : { ...n, velocity: vel })));
        return;
      }

      if (e.key === "d" && hasSel) {
        e.preventDefault();
        const selected = notes.filter((n) => selectedNoteIds.has(n.id));
        const dupes = selected.map((n) => ({ ...n, id: uid(), start: n.start + 1 }));
        setNotes((prev) => [...prev, ...dupes]);
        setSelectedNoteIds(new Set(dupes.map((n) => n.id)));
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    isOpen,
    notes,
    selectedNoteIds,
    copyNotes,
    pasteNotes,
    removeNotes,
    pushUndo,
    undo,
    redo,
    setLoop,
    gridRes,
    totalBeats,
    scaleSnap,
    rootMidi,
    scaleName,
    setNotes,
  ]);

  // ─── AUTO-SCROLL follow playhead ─────────────────────────────
  const isPlaying = useDrumStore((s) => s.isPlaying);
  useEffect(() => {
    if (!isPlaying || !autoFollow || !gridRef.current || !isOpen) return;
    const playheadX = (currentStep / 4) * cellW;
    const container = gridRef.current;
    const viewW = container.clientWidth;
    const targetScroll = playheadX - viewW * 0.3;
    const clamped = Math.max(0, Math.min(targetScroll, container.scrollWidth - viewW));
    if (Math.abs(container.scrollLeft - clamped) > viewW * 0.5) {
      container.scrollTo({ left: clamped, behavior: "smooth" });
    } else if (playheadX < container.scrollLeft || playheadX > container.scrollLeft + viewW) {
      container.scrollTo({ left: clamped, behavior: "smooth" });
    }
  }, [currentStep, isPlaying, autoFollow, cellW, isOpen]);

  // ─── Zoom-to-fit on open ─────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !gridRef.current || notes.length === 0) return;
    const targetNotes = notes.filter((n) => n.track === target);
    if (targetNotes.length === 0) return;
    const minMidi = Math.min(...targetNotes.map((n) => n.midi));
    const maxMidi = Math.max(...targetNotes.map((n) => n.midi));
    const minBeat = Math.min(...targetNotes.map((n) => n.start));
    const centerMidi = (minMidi + maxMidi) / 2;
    const centerRow = BASE_NOTE + TOTAL_ROWS - centerMidi;
    const targetScrollY = centerRow * rowHeight - gridRef.current.clientHeight / 2;
    const targetScrollX = minBeat * cellW - 40;
    gridRef.current.scrollTo({
      left: Math.max(0, targetScrollX),
      top: Math.max(0, targetScrollY),
      behavior: "smooth",
    });
  }, [isOpen, target]);

  // ─── ZOOM ─────────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!gridRef.current) return;
    const isHorizontalZoom = e.ctrlKey;
    const isVerticalZoom = e.shiftKey;
    if (!isHorizontalZoom && !isVerticalZoom) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    if (isHorizontalZoom) {
      setCellW((prev) => Math.max(15, Math.min(200, prev * delta)));
    } else {
      setRowHeight((prev) => Math.max(10, Math.min(40, prev * delta)));
    }
  }, []);

  // ─── GRID INTERACTIONS ────────────────────────────────────────
  const handleGridPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Subtract the sticky ruler height — notes live below it
      // Round to avoid sub-pixel off-by-one from fractional rectTop
      const y = Math.round(e.clientY - rect.top + gridRef.current!.scrollTop - RULER_HEIGHT);
      const x = e.clientX - rect.left + gridRef.current!.scrollLeft;

      if (y < 0 || y > gridH) return;

      const row = Math.floor(y / rowHeight);
      const midi = BASE_NOTE + (TOTAL_ROWS - row - 1);
      const rawBeat = x / cellW;
      const beat = snap ? Math.round(rawBeat / gridRes) * gridRes : rawBeat;
      if (beat < 0 || beat >= totalBeats || midi < BASE_NOTE || midi >= BASE_NOTE + TOTAL_ROWS) return;

      const hit = notes.find(
        (n) => n.track === target && n.midi === midi && beat >= n.start && beat < n.start + n.duration,
      );

      if (hit) {
        if (e.shiftKey) {
          setSelectedNoteIds((prev) => {
            const next = new Set(prev);
            if (next.has(hit.id)) next.delete(hit.id);
            else next.add(hit.id);
            return next;
          });
        } else if (!selectedNoteIds.has(hit.id)) {
          setSelectedNoteIds(new Set([hit.id]));
        }
        return;
      }

      gridClickStartRef.current = { x: e.clientX, y: e.clientY };

      // Capture the pointer so pointerup/move fire on the grid even if
      // the cursor leaves the grid element during a drag
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* no-op */
      }

      // In SELECT mode, empty click always starts rubber band (no new notes)
      // In DRAW mode, shift-click starts rubber band, otherwise create note on pointerUp
      if (tool === "select" || e.shiftKey) {
        setRubberBand({ x0: x, y0: y, x1: x, y1: y });
      } else {
        setSelectedNoteIds(new Set());
      }
    },
    [notes, rowHeight, cellW, snap, gridRes, totalBeats, target, selectedNoteIds, tool, gridH],
  );

  const handleGridPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!rubberBand) return;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + gridRef.current!.scrollLeft;
      const y = Math.round(e.clientY - rect.top + gridRef.current!.scrollTop - RULER_HEIGHT);

      setRubberBand({ ...rubberBand, x1: x, y1: y });

      const x0 = Math.min(rubberBand.x0, x);
      const x1 = Math.max(rubberBand.x0, x);
      const y0 = Math.min(rubberBand.y0, y);
      const y1 = Math.max(rubberBand.y0, y);

      const selected = new Set<string>();
      for (const note of notes) {
        const noteX = note.start * cellW;
        const noteX2 = noteX + Math.max(12, note.duration * cellW);
        const row = TOTAL_ROWS - (note.midi - BASE_NOTE) - 1;
        const noteY = row * rowHeight;
        const noteY2 = noteY + rowHeight;
        if (noteX < x1 && noteX2 > x0 && noteY < y1 && noteY2 > y0) {
          selected.add(note.id);
        }
      }
      setSelectedNoteIds(selected);
    },
    [rubberBand, notes, cellW, rowHeight],
  );

  const handleGridPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (gridClickStartRef.current && !rubberBand && tool === "draw") {
        const dx = Math.abs(e.clientX - gridClickStartRef.current.x);
        const dy = Math.abs(e.clientY - gridClickStartRef.current.y);
        if (dx < 3 && dy < 3) {
          const rect = gridRef.current?.getBoundingClientRect();
          if (rect) {
            const x = e.clientX - rect.left + gridRef.current!.scrollLeft;
            // Round to avoid sub-pixel off-by-one from fractional rectTop
            const y = Math.round(e.clientY - rect.top + gridRef.current!.scrollTop - RULER_HEIGHT);
            if (y >= 0 && y <= gridH) {
              const row = Math.floor(y / rowHeight);
              const midi = BASE_NOTE + (TOTAL_ROWS - row - 1);
              const beat = x / cellW;
              addNote(midi, beat);
            }
          }
        }
      }
      setRubberBand(null);
      setDragMode("none");
      dragStartRef.current = null;
      gridClickStartRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* no-op */
      }
    },
    [rubberBand, tool, rowHeight, cellW, addNote, gridH],
  );

  // ─── Safety net: global pointerup clears any leftover drag/rubber-band state
  useEffect(() => {
    if (!isOpen) return;
    const onWindowUp = () => {
      setRubberBand(null);
      setDragMode("none");
      dragStartRef.current = null;
      gridClickStartRef.current = null;
    };
    window.addEventListener("pointerup", onWindowUp);
    window.addEventListener("pointercancel", onWindowUp);
    return () => {
      window.removeEventListener("pointerup", onWindowUp);
      window.removeEventListener("pointercancel", onWindowUp);
    };
  }, [isOpen]);

  // ─── NOTE POINTER HANDLERS ────────────────────────────────────
  const handleNotePointerDown = useCallback(
    (e: React.PointerEvent, noteId: string) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) {
        setSelectedNoteIds((prev) => {
          const next = new Set(prev);
          if (next.has(noteId)) next.delete(noteId);
          else next.add(noteId);
          return next;
        });
        setDragMode("none");
        dragStartRef.current = null;
        return;
      }

      if (!selectedNoteIds.has(noteId)) setSelectedNoteIds(new Set([noteId]));

      const note = notes.find((n) => n.id === noteId);
      if (!note) return;

      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      const h = rect.height;
      const w = rect.width;

      let mode: "move" | "resize" | "velocity" = "move";
      if (relY > h - 5) mode = "velocity";
      else if (relX > w - 6) mode = "resize";

      if (e.altKey && mode === "move") {
        pushUndo();
        const sel = selectedNoteIds.has(noteId) ? selectedNoteIds : new Set([noteId]);
        const dupes: PianoRollNote[] = [];
        for (const id of sel) {
          const n = notes.find((nn) => nn.id === id);
          if (n) dupes.push({ ...n, id: uid() });
        }
        if (dupes.length > 0) {
          setNotes((prev) => [...prev, ...dupes]);
          const newIds = new Set(dupes.map((d) => d.id));
          setSelectedNoteIds(newIds);
          const originals = new Map<string, { start: number; midi: number }>();
          for (const d of dupes) originals.set(d.id, { start: d.start, midi: d.midi });
          setDragMode("move");
          dragStartRef.current = { x: e.clientX, y: e.clientY, note: { ...dupes[0]! }, originals };
          el.setPointerCapture(e.pointerId);
          return;
        }
      }

      pushUndo();
      setDragMode(mode);
      const originals = new Map<string, { start: number; midi: number }>();
      const sel = selectedNoteIds.has(noteId) ? selectedNoteIds : new Set([noteId]);
      for (const id of sel) {
        const n = notes.find((nn) => nn.id === id);
        if (n) originals.set(id, { start: n.start, midi: n.midi });
      }
      dragStartRef.current = { x: e.clientX, y: e.clientY, note: { ...note }, originals };
      el.setPointerCapture(e.pointerId);
    },
    [notes, selectedNoteIds, pushUndo, setNotes],
  );

  const handleNotePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragMode === "none" || !dragStartRef.current) return;
      const { x: sx, y: sy, note: orig } = dragStartRef.current;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;

      switch (dragMode) {
        case "move": {
          const { originals } = dragStartRef.current!;
          const rawBeatDelta = dx / cellW;
          let beatDelta = snap ? Math.round(rawBeatDelta / gridRes) * gridRes : rawBeatDelta;
          let pitchDelta = -Math.round(dy / rowHeight);

          // Shift-constraint: lock to dominant axis
          if (e.shiftKey) {
            if (Math.abs(dx) > Math.abs(dy)) {
              pitchDelta = 0;
            } else {
              beatDelta = 0;
            }
          }

          setNotes((prev) =>
            prev.map((n) => {
              const original = originals.get(n.id);
              if (!original) return n;
              let newStart = original.start + beatDelta;
              let newMidi = original.midi + pitchDelta;
              if (snap) newStart = Math.round(newStart / gridRes) * gridRes;
              if (scaleSnap) newMidi = snapToScale(newMidi, rootMidi, scaleName);
              return {
                ...n,
                start: Math.max(0, Math.min(totalBeats - n.duration, newStart)),
                midi: Math.max(BASE_NOTE, Math.min(BASE_NOTE + TOTAL_ROWS - 1, newMidi)),
              };
            }),
          );
          break;
        }
        case "resize": {
          const beatDelta = dx / cellW;
          let newDur = orig.duration + beatDelta;
          if (snap) newDur = Math.round(newDur / gridRes) * gridRes;
          patchNotes(selectedNoteIds, { duration: Math.max(gridRes, newDur) });
          break;
        }
        case "velocity": {
          const velDelta = -dy / VELOCITY_LANE_HEIGHT;
          patchNotes(selectedNoteIds, {
            velocity: Math.max(0.05, Math.min(1, orig.velocity + velDelta)),
          });
          break;
        }
      }
    },
    [dragMode, gridRes, snap, scaleSnap, rootMidi, scaleName, cellW, rowHeight, selectedNoteIds, patchNotes, setNotes, totalBeats],
  );

  const handleNotePointerUp = useCallback(
    (e: React.PointerEvent) => {
      try {
        if (dragMode === "move" && dragStartRef.current && selectedNoteIds.size > 0) {
          const firstNote = notes.find((n) => n.id === Array.from(selectedNoteIds)[0]);
          if (firstNote && firstNote.midi !== dragStartRef.current.note.midi) {
            previewNote(firstNote.midi, firstNote.velocity, firstNote.track);
          }
        }
        // Remember last-drawn duration from resize for inheritance
        if (dragMode === "resize" && selectedNoteIds.size > 0) {
          const firstId = Array.from(selectedNoteIds)[0]!;
          const firstNote = notes.find((n) => n.id === firstId);
          if (firstNote) lastDrawnDurationRef.current = firstNote.duration;
        }
      } finally {
        setDragMode("none");
        dragStartRef.current = null;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          /* no-op */
        }
      }
    },
    [dragMode, notes, selectedNoteIds],
  );

  const handleNoteContext = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      removeNotes(new Set([id]));
    },
    [removeNotes],
  );

  const handleKeyClick = useCallback(
    (midi: number) => previewNote(midi, 0.8, target),
    [target],
  );

  // ─── TRANSPOSE ────────────────────────────────────────────────
  const handleTranspose = useCallback(
    (semitones: number) => {
      if (selectedNoteIds.size === 0) return;
      pushUndo();
      setNotes((prev) =>
        prev.map((n) => {
          if (!selectedNoteIds.has(n.id)) return n;
          const newMidi = Math.max(BASE_NOTE, Math.min(BASE_NOTE + TOTAL_ROWS - 1, n.midi + semitones));
          return { ...n, midi: newMidi };
        }),
      );
    },
    [selectedNoteIds, pushUndo, setNotes],
  );

  // ─── REVERSE ─────────────────────────────────────────────────
  const handleReverse = useCallback(() => {
    if (selectedNoteIds.size < 2) return;
    pushUndo();
    const selected = notes.filter((n) => selectedNoteIds.has(n.id));
    const starts = selected.map((n) => n.start).sort((a, b) => a - b);
    const ends = selected
      .map((n) => n.start + n.duration)
      .sort((a, b) => a - b);
    const rangeStart = starts[0]!;
    const rangeEnd = ends[ends.length - 1]!;
    setNotes((prev) =>
      prev.map((n) => {
        if (!selectedNoteIds.has(n.id)) return n;
        // Mirror note start around center of selection range
        const newStart = rangeEnd - (n.start - rangeStart) - n.duration;
        return { ...n, start: Math.max(0, newStart) };
      }),
    );
  }, [notes, selectedNoteIds, pushUndo, setNotes]);

  // ─── INVERT (mirror pitches around center) ────────────────────
  const handleInvert = useCallback(() => {
    if (selectedNoteIds.size < 2) return;
    pushUndo();
    const selected = notes.filter((n) => selectedNoteIds.has(n.id));
    const minMidi = Math.min(...selected.map((n) => n.midi));
    const maxMidi = Math.max(...selected.map((n) => n.midi));
    const center = (minMidi + maxMidi) / 2;
    setNotes((prev) =>
      prev.map((n) => {
        if (!selectedNoteIds.has(n.id)) return n;
        const newMidi = Math.round(center * 2 - n.midi);
        return { ...n, midi: Math.max(BASE_NOTE, Math.min(BASE_NOTE + TOTAL_ROWS - 1, newMidi)) };
      }),
    );
  }, [notes, selectedNoteIds, pushUndo, setNotes]);

  // ─── LEGATO (extend each note to meet the next) ──────────────
  const handleLegato = useCallback(() => {
    if (selectedNoteIds.size < 2) return;
    pushUndo();
    const selected = notes
      .filter((n) => selectedNoteIds.has(n.id))
      .sort((a, b) => a.start - b.start || a.midi - b.midi);
    const legatoMap = new Map<string, number>();
    for (let i = 0; i < selected.length - 1; i++) {
      const gap = selected[i + 1]!.start - selected[i]!.start;
      if (gap > 0) legatoMap.set(selected[i]!.id, gap);
    }
    setNotes((prev) =>
      prev.map((n) => {
        const newDur = legatoMap.get(n.id);
        return newDur != null ? { ...n, duration: newDur } : n;
      }),
    );
  }, [notes, selectedNoteIds, pushUndo, setNotes]);

  // ─── HUMANIZE (randomize velocity + timing slightly) ─────────
  const handleHumanize = useCallback(() => {
    if (selectedNoteIds.size === 0) return;
    pushUndo();
    setNotes((prev) =>
      prev.map((n) => {
        if (!selectedNoteIds.has(n.id)) return n;
        const velJitter = (Math.random() - 0.5) * 0.15; // ±7.5%
        const timeJitter = (Math.random() - 0.5) * 0.06; // ±0.03 beats (~30ms at 120bpm)
        return {
          ...n,
          velocity: Math.max(0.05, Math.min(1, n.velocity + velJitter)),
          start: Math.max(0, n.start + timeJitter),
        };
      }),
    );
  }, [selectedNoteIds, pushUndo, setNotes]);

  // ─── STRETCH (scale timing by factor) ────────────────────────
  const handleStretch = useCallback(
    (factor: number) => {
      if (selectedNoteIds.size === 0) return;
      pushUndo();
      const selected = notes.filter((n) => selectedNoteIds.has(n.id));
      const anchor = Math.min(...selected.map((n) => n.start));
      setNotes((prev) =>
        prev.map((n) => {
          if (!selectedNoteIds.has(n.id)) return n;
          const newStart = anchor + (n.start - anchor) * factor;
          const newDur = n.duration * factor;
          return {
            ...n,
            start: Math.max(0, Math.min(totalBeats - newDur, newStart)),
            duration: Math.max(gridRes, newDur),
          };
        }),
      );
    },
    [notes, selectedNoteIds, pushUndo, setNotes, totalBeats, gridRes],
  );

  // ─── HARMONY HANDLER ──────────────────────────────────────────
  const handleHarmony = useCallback(
    (type: HarmonyType) => {
      if (type === "fix-to-scale") {
        const ids = selectedNoteIds.size > 0 ? selectedNoteIds : new Set(notes.map((n) => n.id));
        setNotes((prev) =>
          prev.map((n) => (!ids.has(n.id) ? n : { ...n, midi: snapToScale(n.midi, rootMidi, scaleName) })),
        );
        return;
      }
      const playheadBeat = (useTransportStore.getState().currentStep * 0.25) % totalBeats;
      if (type === "harmonize-3rds" || type === "harmonize-5ths") {
        const selected = notes.filter((n) => selectedNoteIds.has(n.id));
        if (selected.length === 0) return;
        const interval = type === "harmonize-3rds" ? 2 : 4;
        const newNotes = harmonizeNotes(selected, interval, rootNote, scaleName);
        setNotes((prev) => [...prev, ...newNotes]);
      } else {
        const newNotes = generateHarmony(type, rootNote, scaleName, playheadBeat, gridRes);
        setNotes((prev) => [...prev, ...newNotes]);
      }
    },
    [notes, selectedNoteIds, rootMidi, rootNote, scaleName, totalBeats, gridRes, setNotes],
  );

  // ─── DERIVED ──────────────────────────────────────────────────
  const playheadBeat = currentStep / 4;
  const selectedCount = selectedNoteIds.size;
  const targetNoteCount = notes.filter((note) => note.track === target).length;
  const averageSelectedVelocity = useMemo(() => {
    const selected = notes.filter((n) => selectedNoteIds.has(n.id));
    if (selected.length === 0) return null;
    return Math.round((selected.reduce((s, n) => s + n.velocity, 0) / selected.length) * 100);
  }, [notes, selectedNoteIds]);

  if (!isOpen) return null;

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════ */

  return (
    <div className="fixed inset-0 z-50 bg-[var(--ed-bg-primary)] flex flex-col">
      <PianoRollToolbar
        target={target}
        setTarget={setTarget}
        tool={tool}
        setTool={setTool}
        gridRes={gridRes}
        setGridRes={setGridRes}
        snap={snap}
        setSnap={setSnap}
        scaleSnap={scaleSnap}
        setScaleSnap={setScaleSnap}
        loop={loop}
        setLoop={setLoop}
        selectedCount={selectedCount}
        clipboardLength={clipboard.length}
        noteCount={notes.length}
        targetNoteCount={targetNoteCount}
        bpm={bpm}
        cellW={cellW}
        playheadBeat={playheadBeat}
        dragMode={dragMode}
        averageSelectedVelocity={averageSelectedVelocity}
        autoFollow={autoFollow}
        setAutoFollow={setAutoFollow}
        onQuantize={() => selectedNoteIds.size > 0 && quantizeNotes(selectedNoteIds)}
        onTranspose={handleTranspose}
        onReverse={handleReverse}
        onInvert={handleInvert}
        onLegato={handleLegato}
        onHumanize={handleHumanize}
        onStretch={handleStretch}
        onHarmony={handleHarmony}
        onSelectAll={() => setSelectedNoteIds(new Set(notes.map((n) => n.id)))}
        onDelete={() => removeNotes(selectedNoteIds)}
        onCopy={copyNotes}
        onPaste={pasteNotes}
        onClear={() => {
          setNotes([]);
          setSelectedNoteIds(new Set());
        }}
        onFit={() => {
          if (!gridRef.current || notes.length === 0) return;
          const targetNotes = notes.filter((n) => n.track === target);
          if (targetNotes.length === 0) return;
          const minMidi = Math.min(...targetNotes.map((n) => n.midi));
          const maxMidi = Math.max(...targetNotes.map((n) => n.midi));
          const minBeat = Math.min(...targetNotes.map((n) => n.start));
          const centerRow = BASE_NOTE + TOTAL_ROWS - (minMidi + maxMidi) / 2;
          gridRef.current.scrollTo({
            left: Math.max(0, minBeat * cellW - 40),
            top: Math.max(0, centerRow * rowHeight - gridRef.current.clientHeight / 2),
            behavior: "smooth",
          });
        }}
        onClose={onClose}
      />

      {/* ─── MAIN AREA ───────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <PianoRollKeys
          ref={pianoKeysRef}
          rowHeight={rowHeight}
          rootMidi={rootMidi}
          scaleName={scaleName}
          scaleSnap={scaleSnap}
          onKeyClick={handleKeyClick}
        />

        {/* Scrolling grid + ruler */}
        <div
          ref={gridRef}
          className="flex-1 overflow-auto relative"
          onPointerDown={handleGridPointerDown}
          onPointerMove={handleGridPointerMove}
          onPointerUp={handleGridPointerUp}
          onScroll={handleGridScroll}
          onWheel={handleWheel}
        >
          <PianoRollRuler
            totalBeats={totalBeats}
            cellW={cellW}
            gridW={gridW}
            playheadBeat={playheadBeat}
            accentColor={accentColor}
            loop={loop}
            onLoopChange={setLoop}
            snapBeat={snapBeat}
          />

          {/* Empty state */}
          {notes.length === 0 && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{ width: Math.max(gridW, 800), height: gridH, top: RULER_HEIGHT }}
            >
              <div className="text-center text-white/20">
                <div className="text-[11px] font-semibold mb-1">
                  {tool === "draw" ? "Click to place notes" : "Drag to select · B to draw"}
                </div>
                <div className="text-[8px] text-white/15">
                  Right-click to delete · Drag edges to resize · Drag ruler to set loop
                </div>
              </div>
            </div>
          )}

          {/* Content area (notes + velocity lane) */}
          <div
            className="relative"
            style={{ width: Math.max(gridW, 800), height: gridH + VELOCITY_LANE_HEIGHT }}
          >
            {/* Row stripes */}
            {Array.from({ length: TOTAL_ROWS }, (_, i) => {
              const midi = BASE_NOTE + (TOTAL_ROWS - i - 1);
              const isBlack = OCTAVE_PATTERN[midi % 12]?.black ?? false;
              const inScale = isNoteInScale(midi, rootMidi, scaleName);
              return (
                <div
                  key={`row-${i}`}
                  className="absolute w-full border-b"
                  style={{
                    top: i * rowHeight,
                    height: rowHeight,
                    backgroundColor: isBlack
                      ? "rgba(26, 24, 22, 0.5)"
                      : scaleSnap && inScale
                        ? "rgba(16, 185, 129, 0.08)"
                        : "transparent",
                    borderColor: "rgba(255,255,255,0.02)",
                  }}
                />
              );
            })}

            {/* Vertical beat lines */}
            {Array.from({ length: totalBeats * 4 + 1 }, (_, i) => {
              const x = i * (cellW / 4);
              const isBar = i % 16 === 0;
              const isBeat = i % 4 === 0;
              return (
                <div
                  key={`vl-${i}`}
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{
                    left: x,
                    width: isBar ? 1.5 : 1,
                    backgroundColor: isBar
                      ? "rgba(255,255,255,0.25)"
                      : isBeat
                        ? "rgba(255,255,255,0.12)"
                        : "rgba(255,255,255,0.04)",
                  }}
                />
              );
            })}

            {/* Loop shading: dim regions outside the loop when enabled */}
            {loop.enabled && (
              <>
                {loop.start > 0 && (
                  <div
                    className="absolute top-0 pointer-events-none"
                    style={{
                      left: 0,
                      width: loop.start * cellW,
                      height: gridH,
                      backgroundColor: "rgba(0,0,0,0.45)",
                    }}
                  />
                )}
                {loop.end < totalBeats && (
                  <div
                    className="absolute top-0 pointer-events-none"
                    style={{
                      left: loop.end * cellW,
                      width: (totalBeats - loop.end) * cellW,
                      height: gridH,
                      backgroundColor: "rgba(0,0,0,0.45)",
                    }}
                  />
                )}
              </>
            )}

            {/* ─── NOTES ────────────────────────────────────────── */}
            {notes.map((note) => {
              const row = TOTAL_ROWS - (note.midi - BASE_NOTE) - 1;
              if (row < 0 || row >= TOTAL_ROWS) return null;
              const x = note.start * cellW;
              const y = row * rowHeight;
              const w = Math.max(12, note.duration * cellW);
              const isSel = selectedNoteIds.has(note.id);
              const noteColor = TARGET_COLORS[note.track];
              // Velocity → brightness (0.5 dim → 1.0 bright)
              const velBrightness = 0.55 + note.velocity * 0.55;

              return (
                <div
                  key={note.id}
                  onPointerDown={(e) => handleNotePointerDown(e, note.id)}
                  onPointerMove={handleNotePointerMove}
                  onPointerUp={handleNotePointerUp}
                  onContextMenu={(e) => handleNoteContext(e, note.id)}
                  className="absolute rounded-[3px] touch-none select-none transition-shadow"
                  style={{
                    left: x,
                    top: y + 1,
                    width: w,
                    height: rowHeight - 2,
                    background: `linear-gradient(180deg, ${noteColor} 0%, ${noteColor}aa 100%)`,
                    filter: `brightness(${velBrightness})`,
                    border: isSel
                      ? `2px solid rgba(255,255,255,0.9)`
                      : `1px solid ${noteColor}55`,
                    boxShadow: isSel
                      ? `0 0 10px ${noteColor}60, inset 0 1px 2px rgba(255,255,255,0.25)`
                      : `inset 0 1px 2px rgba(255,255,255,0.12), 0 1px 3px rgba(0,0,0,0.4)`,
                    zIndex: isSel ? 10 : 1,
                    cursor:
                      dragMode === "resize"
                        ? "col-resize"
                        : dragMode === "velocity"
                          ? "ns-resize"
                          : "grab",
                  }}
                >
                  {w > 24 && (
                    <div className="absolute left-1 right-2 top-0.5 flex items-center justify-between gap-1 pointer-events-none select-none">
                      <span className="truncate text-[6px] font-bold text-white/85 leading-none">
                        {midiNoteName(note.midi)}
                      </span>
                      {isSel && (
                        <span className="rounded bg-black/40 px-1 py-[1px] text-[6px] font-black text-white/80">
                          {Math.round(note.velocity * 100)}
                        </span>
                      )}
                    </div>
                  )}

                  <div
                    className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[2px] cursor-ns-resize"
                    style={{
                      backgroundColor: noteColor,
                      opacity: 0.4 + note.velocity * 0.6,
                    }}
                  />

                  <div
                    className={`absolute right-0 top-0 bottom-0 w-2 cursor-col-resize rounded-r-[3px] transition-colors ${
                      isSel ? "bg-white/25" : "opacity-0 hover:opacity-100 hover:bg-white/30"
                    }`}
                  />
                </div>
              );
            })}

            {/* ─── VELOCITY LANE ────────────────────────────────── */}
            <div
              className="absolute border-t border-white/12"
              style={{
                top: gridH,
                left: 0,
                right: 0,
                height: VELOCITY_LANE_HEIGHT,
                backgroundColor: "rgba(0,0,0,0.15)",
              }}
            >
              <div className="absolute left-1 top-1 right-2 flex items-center justify-between text-[7px] font-bold pointer-events-none">
                <span className="text-white/30">VELOCITY LANE</span>
                <span className="text-white/20">drag bars or note footer to shape dynamics</span>
              </div>

              {[25, 50, 75, 100].map((pct) => (
                <div
                  key={`vel-grid-${pct}`}
                  className="absolute left-0 right-0 border-t border-white/6 pointer-events-none"
                  style={{ top: `${VELOCITY_LANE_HEIGHT - (VELOCITY_LANE_HEIGHT * pct) / 100}px` }}
                />
              ))}

              {notes.map((note) => {
                const x = note.start * cellW;
                const w = Math.max(12, note.duration * cellW);
                const h = note.velocity * VELOCITY_LANE_HEIGHT;
                const isSel = selectedNoteIds.has(note.id);
                const noteColor = TARGET_COLORS[note.track];

                return (
                  <div
                    key={`vel-${note.id}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!selectedNoteIds.has(note.id)) setSelectedNoteIds(new Set([note.id]));
                      setDragMode("velocity");
                      dragStartRef.current = {
                        x: e.clientX,
                        y: e.clientY,
                        note: { ...note },
                        originals: new Map(),
                      };
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={handleNotePointerMove}
                    onPointerUp={handleNotePointerUp}
                    className="absolute rounded-t-[3px] transition-opacity hover:opacity-100"
                    style={{
                      left: x,
                      top: VELOCITY_LANE_HEIGHT - h,
                      width: w,
                      height: h,
                      background: `linear-gradient(180deg, ${noteColor}cc 0%, ${noteColor}88 100%)`,
                      opacity: 0.65 + note.velocity * 0.35,
                      cursor: "ns-resize",
                      border: isSel ? `1px solid rgba(255,255,255,0.6)` : "none",
                      boxShadow: isSel ? `0 0 6px ${noteColor}40` : "none",
                    }}
                  />
                );
              })}
            </div>

            {/* Playhead */}
            <div
              className="absolute top-0 pointer-events-none"
              style={{
                left: playheadBeat * cellW,
                width: 1.5,
                height: gridH + VELOCITY_LANE_HEIGHT,
                background: `linear-gradient(90deg, ${accentColor}00, ${accentColor}, ${accentColor}00)`,
                boxShadow: `0 0 12px ${accentColor}60, inset 0 0 8px ${accentColor}40`,
              }}
            />

            {/* Rubber band */}
            {rubberBand && (
              <div
                className="absolute border border-white/50 bg-white/5 pointer-events-none"
                style={{
                  left: Math.min(rubberBand.x0, rubberBand.x1),
                  top: Math.min(rubberBand.y0, rubberBand.y1),
                  width: Math.abs(rubberBand.x1 - rubberBand.x0),
                  height: Math.abs(rubberBand.y1 - rubberBand.y0),
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* ─── FOOTER ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/60 text-[8px] text-white/35">
        <div className="flex items-center gap-4 flex-1">
          {selectedCount === 1
            ? (() => {
                const note = notes.find((n) => n.id === Array.from(selectedNoteIds)[0]);
                return note ? (
                  <>
                    <span className="font-bold text-white/50">{midiNoteName(note.midi)}</span>
                    <span className="text-white/25">|</span>
                    <span>
                      Beat <span className="text-white/50 font-mono">{note.start.toFixed(2)}</span>
                    </span>
                    <span className="text-white/25">|</span>
                    <span>
                      Dur <span className="text-white/50 font-mono">{note.duration.toFixed(2)}</span>
                    </span>
                    <span className="text-white/25">|</span>
                    <span>
                      Vel{" "}
                      <span className="text-white/50 font-mono">
                        {Math.round(note.velocity * 100)}%
                      </span>
                    </span>
                    <span className="text-white/25">|</span>
                    <span>
                      Track: <span className="text-white/50 font-bold">{note.track.toUpperCase()}</span>
                    </span>
                  </>
                ) : null;
              })()
            : selectedCount > 1
              ? (
                <>
                  <span className="font-bold text-white/50">{selectedCount} notes selected</span>
                  <span className="text-white/25">·</span>
                  <span>Del to remove</span>
                  <span className="text-white/25">·</span>
                  <span>Ctrl+C copy · Ctrl+V paste</span>
                </>
              )
              : (
                <span className="text-white/30">
                  Click to place notes · Right-click to delete · Drag ruler for loop
                </span>
              )}
        </div>
        <div className="flex items-center gap-2 text-white/25">
          <span>Ctrl+Scroll</span>
          <span className="text-white/15">=</span>
          <span>H.Zoom</span>
          <span className="text-white/20">·</span>
          <span>Shift+Scroll</span>
          <span className="text-white/15">=</span>
          <span>V.Zoom</span>
          <span className="text-white/20">·</span>
          <span style={{ color: accentColor }} className="font-bold">
            {target.toUpperCase()}
          </span>
        </div>
      </div>
    </div>
  );
}
