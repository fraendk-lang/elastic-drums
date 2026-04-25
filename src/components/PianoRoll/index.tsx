import React, { useEffect, useRef, useState, useCallback, useMemo, useSyncExternalStore } from "react";
import { useDrumStore, drumCurrentStepStore, getDrumCurrentStep } from "../../store/drumStore";
import { useBassStore } from "../../store/bassStore";
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
import { setPianoRollNotes, setPianoRollLoop, getPianoRollCurrentStep } from "./scheduler";
import { melodyEngine } from "../../audio/MelodyEngine";
import { soundFontEngine } from "../../audio/SoundFontEngine";
import {
  _persistedNotes as initialPersistedNotes,
  _persistedLoop as initialPersistedLoop,
  updatePersistedNotes,
  updatePersistedLoop,
} from "./persistedState";
import { PianoRollKeys } from "./PianoRollKeys";
import { PianoRollRuler } from "./PianoRollRuler";
import { PianoRollToolbar } from "./PianoRollToolbar";

interface PianoRollProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODULE-LEVEL STATE — survives component unmount (now in persistedState.ts)
   ═════════════════════════════════════════════════════════════════════════ */

export function PianoRoll({ isOpen, onClose }: PianoRollProps) {
  const bpm = useDrumStore((s) => s.bpm);
  // Subscribe to the actual drum step clock (drumCurrentStepStore fires on every tick)
  const currentStep = useSyncExternalStore(drumCurrentStepStore.subscribe, drumCurrentStepStore.getSnapshot);
  const rootNote = useBassStore((s) => s.rootNote);
  const scaleName = useBassStore((s) => s.scaleName);

  // ─── STATE ────────────────────────────────────────────────────
  const [notes, setNotesLocal] = useState<PianoRollNote[]>(initialPersistedNotes);
  const setNotes = useCallback(
    (updater: PianoRollNote[] | ((prev: PianoRollNote[]) => PianoRollNote[])) => {
      setNotesLocal((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        updatePersistedNotes(next);
        return next;
      });
    },
    [],
  );

  const [loop, setLoopLocal] = useState<LoopRange>(initialPersistedLoop);
  const setLoop = useCallback((next: LoopRange) => {
    updatePersistedLoop(next);
    setLoopLocal(next);
  }, []);

  // Listen for external imports (MIDI file → piano roll) so already-mounted
  // panel picks up the new notes instead of showing stale state
  useEffect(() => {
    const onImported = () => {
      import("./persistedState").then((m) => setNotesLocal(m._persistedNotes));
    };
    window.addEventListener("piano-roll-notes-imported", onImported);
    return () => window.removeEventListener("piano-roll-notes-imported", onImported);
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
  const [fold, setFold] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; noteId: string } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ midi: number; beat: number } | null>(null);
  const [dragInfo, setDragInfo] = useState<{ midi: number; beat: number } | null>(null);
  const [midiRecord, setMidiRecord] = useState(false);
  // Track held MIDI notes: midi → { startBeat, velocity, id }
  const heldMidiNotes = useRef<Map<number, { startBeat: number; velocity: number; id: string }>>(new Map());
  // Draw-drag: tracks the note being actively drawn by pointer-down + drag
  const drawDragNoteRef = useRef<{ id: string; startX: number } | null>(null);

  // ─── Sync initial persisted state into scheduler on mount ───
  useEffect(() => {
    setPianoRollNotes(initialPersistedNotes);
    setPianoRollLoop(initialPersistedLoop);
  }, []);

  // ─── Layout ──────────────────────────────────────────────────
  const patternLength = useDrumStore((s) => s.pattern.length);
  // Auto-extend Piano Roll length to fit all imported notes — rounded up
  // to the nearest 4-bar boundary (16 beats). Prevents off-screen clipping
  // of notes from long XY-pad recordings or MIDI imports.
  const notesMaxEnd = useMemo(() => {
    if (notes.length === 0) return 0;
    return notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  }, [notes]);
  const totalBeats = useMemo(() => {
    const minBeats = Math.max(16, patternLength / 4);
    const notesBeats = Math.ceil(notesMaxEnd / 16) * 16; // Round up to 4-bar unit
    return Math.max(minBeats, notesBeats);
  }, [patternLength, notesMaxEnd]);
  // rootNote from melodyStore is already a full MIDI number (default 36 = C2).
  // Do NOT add 60 — that would give MIDI 96 (C7) and break all scale/harmony calculations.
  const rootMidi = rootNote;
  const accentColor = TARGET_COLORS[target];

  // ─── Fold view: only show rows that have notes ──────────────
  const foldedRows = useMemo(() => {
    if (!fold || notes.length === 0) return null;
    const usedMidi = new Set(notes.map((n) => n.midi));
    // Add 2 padding rows above/below for context
    const expanded = new Set<number>();
    for (const m of usedMidi) {
      for (let offset = -2; offset <= 2; offset++) {
        const v = m + offset;
        if (v >= BASE_NOTE && v < BASE_NOTE + TOTAL_ROWS) expanded.add(v);
      }
    }
    return Array.from(expanded).sort((a, b) => b - a); // high→low (top→bottom)
  }, [fold, notes]);

  const visibleRows = foldedRows ? foldedRows.length : TOTAL_ROWS;
  const gridW = totalBeats * cellW;
  const gridH = visibleRows * rowHeight;

  // Row↔Midi mapping that respects fold
  const midiForRow = useCallback(
    (row: number): number => {
      if (foldedRows) return foldedRows[row] ?? BASE_NOTE;
      return BASE_NOTE + (TOTAL_ROWS - row - 1);
    },
    [foldedRows],
  );
  const rowForMidi = useCallback(
    (midi: number): number => {
      if (foldedRows) {
        const idx = foldedRows.indexOf(midi);
        return idx >= 0 ? idx : -1;
      }
      return TOTAL_ROWS - (midi - BASE_NOTE) - 1;
    },
    [foldedRows],
  );

  // ─── Undo / Redo ─────────────────────────────────────────────
  const undoStackRef = useRef<PianoRollNote[][]>([]);
  const redoStackRef = useRef<PianoRollNote[][]>([]);
  const pushUndo = useCallback(() => {
    undoStackRef.current.push(structuredClone(notes));
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, [notes]);
  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(structuredClone(notes));
    setNotes(prev);
  }, [notes, setNotes]);
  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(structuredClone(notes));
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

  // ─── MIDI Record: listen for external Note On/Off events ──────
  useEffect(() => {
    if (!isOpen || !midiRecord || !navigator.requestMIDIAccess) return;
    let access: MIDIAccess | null = null;
    const inputs: MIDIInput[] = [];

    const onMessage = (e: MIDIMessageEvent) => {
      const data = e.data;
      if (!data || data.length < 2) return;
      const cmd = data[0]! & 0xf0;
      const note = data[1]!;
      const vel = data[2] ?? 0;

      const beat = getDrumCurrentStep() * 0.25;
      const quantized = snap ? Math.round(beat / gridRes) * gridRes : beat;

      if (cmd === 0x90 && vel > 0) {
        // Note On: create placeholder note, remember id + start
        const id = uid();
        heldMidiNotes.current.set(note, { startBeat: quantized, velocity: vel / 127, id });
        const placeholder: PianoRollNote = {
          id,
          midi: note,
          start: quantized,
          duration: gridRes,
          velocity: vel / 127,
          track: target,
        };
        setNotes((prev) => [...prev, placeholder]);
      } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
        // Note Off: finalize duration
        const held = heldMidiNotes.current.get(note);
        if (!held) return;
        heldMidiNotes.current.delete(note);
        const endBeat = quantized;
        const dur = Math.max(gridRes, endBeat - held.startBeat);
        setNotes((prev) => prev.map((n) => (n.id === held.id ? { ...n, duration: dur } : n)));
      }
    };

    navigator.requestMIDIAccess({ sysex: false }).then((acc) => {
      access = acc;
      for (const input of acc.inputs.values()) {
        input.addEventListener("midimessage", onMessage as EventListener);
        inputs.push(input);
      }
    }).catch(() => { /* no MIDI */ });

    return () => {
      for (const input of inputs) {
        input.removeEventListener("midimessage", onMessage as EventListener);
      }
      heldMidiNotes.current.clear();
      void access; // reference kept
    };
  }, [isOpen, midiRecord, target, gridRes, snap, setNotes]);

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
    // Use the Piano Roll's own independent step counter so paste lands at the
    // visible playhead position, not the (often stale) drum pattern step.
    const playheadBeat = getPianoRollCurrentStep() / 4;
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

      // Escape: cancel in-progress draw / deselect all
      if (e.key === "Escape") {
        e.preventDefault();
        if (drawDragNoteRef.current) {
          const drawnId = drawDragNoteRef.current.id;
          setNotes((prev) => prev.filter((n) => n.id !== drawnId));
          drawDragNoteRef.current = null;
        }
        setSelectedNoteIds(new Set());
        setRubberBand(null);
        setDragMode("none");
        dragStartRef.current = null;
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "a") {
          e.preventDefault();
          setSelectedNoteIds(new Set(notes.map((n) => n.id)));
        } else if (e.key === "x") {
          e.preventDefault();
          copyNotes();
          pushUndo();
          removeNotes(selectedNoteIds);
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
        setLoop({ ...loop, enabled: !loop.enabled });
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
    loop,
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
    const centerRow = rowForMidi(Math.round(centerMidi));
    const targetScrollY = centerRow * rowHeight - gridRef.current.clientHeight / 2;
    const targetScrollX = minBeat * cellW - 40;
    gridRef.current.scrollTo({
      left: Math.max(0, targetScrollX),
      top: Math.max(0, targetScrollY),
      behavior: "smooth",
    });
  }, [isOpen, target, rowForMidi]);

  // ─── ZOOM (anchors to cursor position) ───────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!gridRef.current) return;
    const isHorizontalZoom = e.ctrlKey;
    const isVerticalZoom = e.shiftKey;
    if (!isHorizontalZoom && !isVerticalZoom) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    if (isHorizontalZoom) {
      // Zoom toward the cursor: keep the beat under the cursor stationary
      const rect = gridRef.current.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const oldScrollLeft = gridRef.current.scrollLeft;
      const cursorBeat = (oldScrollLeft + cursorX) / cellW;
      const newCellW = Math.max(15, Math.min(200, cellW * delta));
      const newScrollLeft = Math.max(0, cursorBeat * newCellW - cursorX);
      setCellW(newCellW);
      requestAnimationFrame(() => {
        if (gridRef.current) gridRef.current.scrollLeft = newScrollLeft;
      });
    } else {
      setRowHeight((prev) => Math.max(10, Math.min(40, prev * delta)));
    }
  }, [cellW]);

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
      const midi = midiForRow(row);
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

      // In SELECT mode, empty click starts rubber band (no new notes)
      // In DRAW mode, shift-click starts rubber band; otherwise create note immediately
      if (tool === "select" || e.shiftKey) {
        setRubberBand({ x0: x, y0: y, x1: x, y1: y });
      } else {
        // DRAW mode: create note immediately at pointer-down for drag-to-draw
        setSelectedNoteIds(new Set());
        pushUndo();
        let finalMidi = midi;
        if (scaleSnap) finalMidi = snapToScale(finalMidi, rootMidi, scaleName);
        const startBeat = snap ? Math.round(rawBeat / gridRes) * gridRes : rawBeat;
        const duration = lastDrawnDurationRef.current ?? Math.max(gridRes, 1);
        const note: PianoRollNote = {
          id: uid(),
          midi: finalMidi,
          start: Math.max(0, startBeat),
          duration,
          velocity: 0.8,
          track: target,
        };
        setNotes((prev) => [...prev, note]);
        setSelectedNoteIds(new Set([note.id]));
        previewNote(finalMidi, 0.8, target);
        drawDragNoteRef.current = { id: note.id, startX: x };
      }
    },
    [notes, rowHeight, cellW, snap, gridRes, totalBeats, target, selectedNoteIds, tool, gridH, midiForRow,
     pushUndo, scaleSnap, rootMidi, scaleName, setNotes],
  );

  // ─── Hover info (lightweight mousemove, no state deps on notes) ──
  const handleGridMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left + gridRef.current!.scrollLeft;
      const y = Math.round(e.clientY - rect.top + gridRef.current!.scrollTop - RULER_HEIGHT);
      if (y < 0 || y > gridH) { setHoverInfo(null); return; }
      const row = Math.floor(y / rowHeight);
      const midi = midiForRow(row);
      const beat = x / cellW;
      setHoverInfo({ midi, beat });
    },
    [gridH, rowHeight, cellW, midiForRow],
  );

  const handleGridMouseLeave = useCallback(() => setHoverInfo(null), []);

  const handleGridPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left + gridRef.current!.scrollLeft;

      // Draw-drag: extend duration of the note being drawn
      if (drawDragNoteRef.current) {
        const dx = x - drawDragNoteRef.current.startX;
        if (dx > 0) {
          const rawDur = dx / cellW;
          const newDur = snap
            ? Math.max(gridRes, Math.round(rawDur / gridRes) * gridRes)
            : Math.max(gridRes, rawDur);
          setNotes((prev) =>
            prev.map((n) =>
              n.id === drawDragNoteRef.current!.id ? { ...n, duration: newDur } : n,
            ),
          );
        }
        return;
      }

      if (!rubberBand) return;

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
        const row = rowForMidi(note.midi);
        const noteY = row * rowHeight;
        const noteY2 = noteY + rowHeight;
        if (noteX < x1 && noteX2 > x0 && noteY < y1 && noteY2 > y0) {
          selected.add(note.id);
        }
      }
      setSelectedNoteIds(selected);
    },
    [rubberBand, notes, cellW, rowHeight, rowForMidi, gridRes, snap, setNotes],
  );

  const handleGridPointerUp = useCallback(
    (e: React.PointerEvent) => {
      // Complete draw-drag: record the final duration for next note inheritance
      if (drawDragNoteRef.current) {
        const drawnId = drawDragNoteRef.current.id;
        setNotes((prev) => {
          const drawn = prev.find((n) => n.id === drawnId);
          if (drawn) lastDrawnDurationRef.current = drawn.duration;
          return prev; // no state change — just reading current value
        });
        drawDragNoteRef.current = null;
        gridClickStartRef.current = null;
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* no-op */ }
        setRubberBand(null);
        setDragMode("none");
        dragStartRef.current = null;
        return;
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
    [rubberBand, setNotes],
  );

  // ─── Cut any step-sequencer-held melody note the moment the Piano Roll opens.
  //     Without this, the mono melodyEngine keeps sustaining a note while the
  //     Piano Roll scheduler also tries to manage it → stuck / hanging note.
  useEffect(() => {
    if (!isOpen) return;
    if (!soundFontEngine.isLoaded("melody")) {
      // Small positive offset so cancelScheduledValues lands safely in the future
      const ctx = (melodyEngine as unknown as { ctx: AudioContext | null }).ctx;
      const t = ctx ? ctx.currentTime + 0.01 : 0;
      melodyEngine.releaseNote(t);
    }
  }, [isOpen]);

  // ─── Safety net: global pointerup clears any leftover drag/rubber-band state
  useEffect(() => {
    if (!isOpen) return;
    const onWindowUp = () => {
      drawDragNoteRef.current = null; // finalize any in-progress draw drag
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
      else if (relX > w - 12) mode = "resize"; // 12px hotzone for easy resize grab

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
          // Live drag coordinates for footer
          {
            const firstOrig = originals.values().next().value;
            if (firstOrig) {
              setDragInfo({
                midi: Math.max(BASE_NOTE, Math.min(BASE_NOTE + TOTAL_ROWS - 1, firstOrig.midi + pitchDelta)),
                beat: Math.max(0, firstOrig.start + beatDelta),
              });
            }
          }
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
        setDragInfo(null);
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

  // ─── Right-click context menu on note ──────────────────────
  const handleNoteContext = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      // In DRAW mode: right-click = quick erase (like a pencil eraser)
      if (tool === "draw") {
        pushUndo();
        removeNotes(selectedNoteIds.has(id) ? selectedNoteIds : new Set([id]));
        return;
      }
      setContextMenu({ x: e.clientX, y: e.clientY, noteId: id });
      if (!selectedNoteIds.has(id)) setSelectedNoteIds(new Set([id]));
    },
    [selectedNoteIds, tool, pushUndo, removeNotes],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ─── Right-click on empty grid in draw mode = erase note at cursor
  const handleGridContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (tool !== "draw") return;
      e.preventDefault();
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left + gridRef.current!.scrollLeft;
      const y = Math.round(e.clientY - rect.top + gridRef.current!.scrollTop - RULER_HEIGHT);
      if (y < 0 || y > gridH) return;
      const row = Math.floor(y / rowHeight);
      const midi = midiForRow(row);
      const rawBeat = x / cellW;
      const hit = notes.find(
        (n) => n.track === target && n.midi === midi && rawBeat >= n.start && rawBeat < n.start + n.duration,
      );
      if (hit) {
        pushUndo();
        removeNotes(selectedNoteIds.has(hit.id) ? selectedNoteIds : new Set([hit.id]));
      }
    },
    [tool, notes, target, rowHeight, cellW, gridH, midiForRow, pushUndo, removeNotes, selectedNoteIds],
  );

  // ─── Double-click on grid = create note (works in both modes)
  const handleGridDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left + gridRef.current!.scrollLeft;
      const y = Math.round(e.clientY - rect.top + gridRef.current!.scrollTop - RULER_HEIGHT);
      if (y < 0 || y > gridH) return;
      const row = Math.floor(y / rowHeight);
      const midi = midiForRow(row);
      const beat = x / cellW;
      pushUndo();
      addNote(midi, beat);
    },
    [gridH, rowHeight, cellW, addNote, pushUndo, midiForRow],
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

  // ─── SET NOTE LENGTH (presets) ─────────────────────────────────
  const handleSetNoteLength = useCallback(
    (beats: number) => {
      if (selectedNoteIds.size === 0) return;
      pushUndo();
      setNotes((prev) =>
        prev.map((n) => (!selectedNoteIds.has(n.id) ? n : { ...n, duration: beats })),
      );
      lastDrawnDurationRef.current = beats;
    },
    [selectedNoteIds, pushUndo, setNotes],
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
      const playheadBeat = (getPianoRollCurrentStep() * 0.25) % totalBeats;
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
  // Use piano roll's independent step counter — the scheduler keeps counting
  // past the drum pattern's wrap (e.g. drum = 1 bar, piano roll = 4 bars).
  // currentStep dep ensures this recomputes every transport tick for playhead animation.
  void currentStep;
  const playheadBeat = getPianoRollCurrentStep() / 4;
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
        onSetNoteLength={handleSetNoteLength}
        fold={fold}
        setFold={setFold}
        midiRecord={midiRecord}
        setMidiRecord={setMidiRecord}
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
          const centerRow = rowForMidi(Math.round((minMidi + maxMidi) / 2));
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
          foldedRows={foldedRows}
          onKeyClick={handleKeyClick}
        />

        {/* Scrolling grid + ruler */}
        <div
          ref={gridRef}
          className="flex-1 overflow-auto relative"
          style={{ background: "#0d0c10" }}
          onPointerDown={(e) => { closeContextMenu(); handleGridPointerDown(e); }}
          onPointerMove={handleGridPointerMove}
          onPointerUp={handleGridPointerUp}
          onDoubleClick={handleGridDoubleClick}
          onContextMenu={handleGridContextMenu}
          onMouseMove={handleGridMouseMove}
          onMouseLeave={handleGridMouseLeave}
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
            {Array.from({ length: visibleRows }, (_, i) => {
              const midi = midiForRow(i);
              const isBlack = OCTAVE_PATTERN[midi % 12]?.black ?? false;
              const inScale = isNoteInScale(midi, rootMidi, scaleName);
              const isRoot = midi % 12 === rootMidi % 12;
              // Always highlight scale notes — stronger in snap mode, subtle by default
              const scaleHighlight = isRoot
                ? "rgba(16, 185, 129, 0.14)"
                : inScale
                  ? scaleSnap ? "rgba(16, 185, 129, 0.10)" : "rgba(16, 185, 129, 0.05)"
                  : scaleSnap ? "rgba(0, 0, 0, 0.35)" : "transparent"; // Dim out-of-scale when snap active
              return (
                <div
                  key={`row-${midi}`}
                  className="absolute w-full border-b"
                  style={{
                    top: i * rowHeight,
                    height: rowHeight,
                    backgroundColor: isBlack
                      ? "rgba(26, 24, 22, 0.5)"
                      : scaleHighlight,
                    borderColor: isRoot ? "rgba(16, 185, 129, 0.25)" : "rgba(255,255,255,0.02)",
                  }}
                />
              );
            })}

            {/* Vertical beat lines — density adapts to snap resolution */}
            {(() => {
              // Show lines at the finer of (gridRes, 1/4 beat = 1/16 note)
              const lineRes = Math.min(0.25, gridRes);
              const stepsPerBeat = Math.round(1 / lineRes);
              const stepsPerBar = 4 * stepsPerBeat;
              const totalLines = totalBeats * stepsPerBeat;
              return Array.from({ length: totalLines + 1 }, (_, i) => {
                const x = (i / stepsPerBeat) * cellW;
                const isBar = i % stepsPerBar === 0;
                const isBeat = i % stepsPerBeat === 0;
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
              });
            })()}

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

            {/* ─── GHOST NOTES (other tracks, semi-transparent) ──── */}
            {notes
              .filter((note) => note.track !== target)
              .map((note) => {
                const row = rowForMidi(note.midi);
                if (row < 0 || row >= visibleRows) return null;
                const x = note.start * cellW;
                const y = row * rowHeight;
                const w = Math.max(8, note.duration * cellW);
                const ghostColor = TARGET_COLORS[note.track];
                return (
                  <div
                    key={`ghost-${note.id}`}
                    className="absolute rounded-[2px] pointer-events-none"
                    style={{
                      left: x,
                      top: y + 2,
                      width: w,
                      height: rowHeight - 4,
                      backgroundColor: ghostColor,
                      opacity: 0.15,
                      border: `1px solid ${ghostColor}30`,
                    }}
                  />
                );
              })}

            {/* ─── NOTES (active track) ─────────────────────────── */}
            {notes.map((note) => {
              const row = rowForMidi(note.midi);
              if (row < 0 || row >= visibleRows) return null;
              const x = note.start * cellW;
              const y = row * rowHeight;
              const w = Math.max(12, note.duration * cellW);
              const isSel = selectedNoteIds.has(note.id);
              const noteColor = TARGET_COLORS[note.track];
              // Velocity → brightness (0.5 dim → 1.0 bright)
              const velBrightness = 0.55 + note.velocity * 0.55;
              // Currently-playing detection — the playhead is within this note's span.
              // Wrap-aware: if loop is on, playheadBeat resets to 0 at end — still catches.
              const isActive =
                isPlaying &&
                playheadBeat >= note.start &&
                playheadBeat < note.start + note.duration;

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
                    background: isActive
                      ? `linear-gradient(180deg, #fff 0%, ${noteColor} 100%)`
                      : `linear-gradient(180deg, ${noteColor} 0%, ${noteColor}aa 100%)`,
                    filter: isActive ? `brightness(1.3) saturate(1.4)` : `brightness(${velBrightness})`,
                    border: isSel
                      ? `2px solid rgba(255,255,255,0.9)`
                      : isActive
                        ? `2px solid rgba(255,255,255,0.95)`
                        : `1px solid ${noteColor}55`,
                    boxShadow: isActive
                      ? `0 0 16px ${noteColor}, 0 0 6px rgba(255,255,255,0.8), inset 0 1px 2px rgba(255,255,255,0.35)`
                      : isSel
                        ? `0 0 10px ${noteColor}60, inset 0 1px 2px rgba(255,255,255,0.25)`
                        : `inset 0 1px 2px rgba(255,255,255,0.12), 0 1px 3px rgba(0,0,0,0.4)`,
                    zIndex: isActive ? 15 : isSel ? 10 : 1,
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
                    className={`absolute right-0 top-0 bottom-0 w-3 cursor-col-resize rounded-r-[3px] transition-colors ${
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

            {/* Hover tooltip */}
            {hoverInfo && dragMode === "none" && (
              <div
                className="fixed z-50 pointer-events-none px-1.5 py-0.5 rounded bg-black/80 border border-white/15 text-[8px] font-bold text-white/80 whitespace-nowrap"
                style={{
                  left: (hoverInfo.beat * cellW) + 78,
                  top: (rowForMidi(hoverInfo.midi) * rowHeight) - gridRef.current!.scrollTop + RULER_HEIGHT + gridRef.current!.getBoundingClientRect().top - 20,
                }}
              >
                {midiNoteName(hoverInfo.midi)} · Bar {Math.floor(hoverInfo.beat / 4) + 1}.{((hoverInfo.beat % 4) + 1).toFixed(2)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── CONTEXT MENU (right-click on note) ─────────────────── */}
      {contextMenu && (
        <div
          className="fixed z-[60] min-w-[140px] bg-[#1a1a22] border border-[var(--ed-border)] rounded-lg shadow-2xl py-1 overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {([
            { label: "Delete", action: () => { pushUndo(); removeNotes(selectedNoteIds.size > 0 ? selectedNoteIds : new Set([contextMenu.noteId])); } },
            { label: "Duplicate", action: () => { pushUndo(); const sel = notes.filter(n => selectedNoteIds.has(n.id)); const dupes = sel.map(n => ({ ...n, id: uid(), start: n.start + 1 })); setNotes(prev => [...prev, ...dupes]); setSelectedNoteIds(new Set(dupes.map(d => d.id))); } },
            { label: "Copy", action: copyNotes },
            null,
            { label: "Vel 100%", action: () => { pushUndo(); patchNotes(selectedNoteIds, { velocity: 1 }); } },
            { label: "Vel 80%", action: () => { pushUndo(); patchNotes(selectedNoteIds, { velocity: 0.8 }); } },
            { label: "Vel 50%", action: () => { pushUndo(); patchNotes(selectedNoteIds, { velocity: 0.5 }); } },
            null,
            { label: "Reverse", action: handleReverse },
            { label: "Invert", action: handleInvert },
            { label: "Legato", action: handleLegato },
            { label: "Humanize", action: handleHumanize },
          ] as (({ label: string; action: () => void }) | null)[]).map((item, i) =>
            item === null ? (
              <div key={`sep-${i}`} className="border-t border-white/8 my-0.5" />
            ) : (
              <button
                key={item.label}
                onClick={() => { item.action(); closeContextMenu(); }}
                className="w-full text-left px-3 py-1.5 text-[9px] text-white/70 hover:text-white hover:bg-white/8 transition-colors"
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}

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
          {/* Live drag coordinates */}
          {dragInfo && (
            <>
              <span className="text-[var(--ed-accent-melody)] font-bold">
                {midiNoteName(dragInfo.midi)}
              </span>
              <span className="text-white/15">·</span>
              <span className="font-mono text-white/50">
                Bar {Math.floor(dragInfo.beat / 4) + 1}.{((dragInfo.beat % 4) + 1).toFixed(2)}
              </span>
              <span className="text-white/15">|</span>
            </>
          )}
          {/* Hover coordinates */}
          {!dragInfo && hoverInfo && (
            <>
              <span className="text-white/40 font-mono">
                {midiNoteName(hoverInfo.midi)} · {Math.floor(hoverInfo.beat / 4) + 1}.{((hoverInfo.beat % 4) + 1).toFixed(1)}
              </span>
              <span className="text-white/15">|</span>
            </>
          )}
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
