import React, { useEffect, useRef, useState, useCallback } from "react";
import { useDrumStore } from "../store/drumStore";
import { useBassStore } from "../store/bassStore";
import { useTransportStore } from "../store/transportStore";
import { audioEngine } from "../audio/AudioEngine";
import { bassEngine } from "../audio/BassEngine";
import { chordsEngine } from "../audio/ChordsEngine";
import { melodyEngine } from "../audio/MelodyEngine";
import { soundFontEngine } from "../audio/SoundFontEngine";
import { SCALES } from "../audio/BassEngine";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═════════════════════════════════════════════════════════════════════════ */

interface PianoRollNote {
  id: string;
  midi: number;
  start: number;
  duration: number;
  velocity: number;
  track: SoundTarget;  // which engine this note plays through
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
const PIANO_WIDTH = 64;
const DEFAULT_CELL_W = 40;
const DEFAULT_ROW_HEIGHT = 18;

const TARGET_COLORS: Record<SoundTarget, string> = {
  bass: "var(--ed-accent-bass, #10b981)",
  chords: "var(--ed-accent-chords, #a78bfa)",
  melody: "var(--ed-accent-melody, #f472b6)",
  drums: "var(--ed-accent-orange, #f59e0b)",
};

/* ═══════════════════════════════════════════════════════════════════════════
   HELPER FUNCTIONS
   ═════════════════════════════════════════════════════════════════════════ */

function midiNoteName(midi: number): string {
  return (NOTE_NAMES[midi % 12] ?? "?") + (Math.floor(midi / 12) - 1);
}

function uid(): string { return `n${Date.now()}-${Math.random().toString(36).slice(2,6)}`; }

/** Get scale degrees as MIDI notes for a given octave range */
function getScaleNotes(rootMidi: number, scaleName: string, fromOctave: number, toOctave: number): number[] {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const result: number[] = [];
  for (let oct = fromOctave; oct <= toOctave; oct++) {
    for (const deg of scale) {
      const midi = rootMidi + (oct - Math.floor(rootMidi / 12)) * 12 + deg;
      if (midi >= 0 && midi <= 127) result.push(midi);
    }
  }
  return result.sort((a, b) => a - b);
}

/** Chord quality from scale degree (0-based). Returns intervals from root. */
function chordFromDegree(scaleName: string, degree: number): number[] {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  // Stack thirds within the scale: root + 3rd + 5th (+ 7th optional)
  const root = scale[degree % scale.length] ?? 0;
  const third = scale[(degree + 2) % scale.length] ?? 0;
  const fifth = scale[(degree + 4) % scale.length] ?? 0;
  return [root, third + (third < root ? 12 : 0), fifth + (fifth < third ? 12 : 0)];
}

// ─── Harmony Generators ─────────────────────────────────────

type HarmonyType =
  | "fix-to-scale"
  | "scale-up" | "scale-down"
  | "chords-I-IV-V-I" | "chords-I-vi-IV-V"
  | "chords-ii-V-I" | "chords-I-V-vi-IV"
  | "harmonize-3rds" | "harmonize-5ths"
  | "arpeggio-up" | "arpeggio-down";

const HARMONY_PRESETS: { id: HarmonyType; label: string; group: string }[] = [
  { id: "fix-to-scale",    label: "⟳ Fix to Scale",   group: "Correct" },
  { id: "scale-up",        label: "Scale ↑",         group: "Scales" },
  { id: "scale-down",      label: "Scale ↓",         group: "Scales" },
  { id: "chords-I-IV-V-I", label: "I – IV – V – I",  group: "Chords" },
  { id: "chords-I-vi-IV-V",label: "I – vi – IV – V",  group: "Chords" },
  { id: "chords-ii-V-I",   label: "ii – V – I",       group: "Chords" },
  { id: "chords-I-V-vi-IV",label: "I – V – vi – IV",  group: "Chords" },
  { id: "harmonize-3rds",  label: "+ 3rds",            group: "Harmonize" },
  { id: "harmonize-5ths",  label: "+ 5ths",            group: "Harmonize" },
  { id: "arpeggio-up",     label: "Arpeggio ↑",       group: "Arpeggios" },
  { id: "arpeggio-down",   label: "Arpeggio ↓",       group: "Arpeggios" },
];

function generateHarmony(
  type: HarmonyType,
  rootMidi: number,
  scaleName: string,
  startBeat: number,
  gridRes: number,
  track: SoundTarget = "melody",
): PianoRollNote[] {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const baseOctave = Math.floor(rootMidi / 12);
  const notes: PianoRollNote[] = [];

  const addNote = (midi: number, start: number, dur: number, vel = 0.8) => {
    notes.push({ id: uid(), midi, start, duration: dur, velocity: vel, track });
  };

  switch (type) {
    case "scale-up": {
      const scaleNotes = getScaleNotes(rootMidi, scaleName, baseOctave, baseOctave + 1);
      scaleNotes.forEach((n, i) => addNote(n, startBeat + i * gridRes * 2, gridRes * 2, 0.7 + (i / scaleNotes.length) * 0.3));
      break;
    }
    case "scale-down": {
      const scaleNotes = getScaleNotes(rootMidi, scaleName, baseOctave, baseOctave + 1).reverse();
      scaleNotes.forEach((n, i) => addNote(n, startBeat + i * gridRes * 2, gridRes * 2, 0.7 + (i / scaleNotes.length) * 0.3));
      break;
    }
    case "chords-I-IV-V-I":
    case "chords-I-vi-IV-V":
    case "chords-ii-V-I":
    case "chords-I-V-vi-IV": {
      const degreeSequences: Record<string, number[]> = {
        "chords-I-IV-V-I":  [0, 3, 4, 0],
        "chords-I-vi-IV-V": [0, 5, 3, 4],
        "chords-ii-V-I":    [1, 4, 0, 0],
        "chords-I-V-vi-IV": [0, 4, 5, 3],
      };
      const degrees = degreeSequences[type] ?? [0, 3, 4, 0];
      const barDur = 4; // 1 bar = 4 beats
      degrees.forEach((deg, barIdx) => {
        const intervals = chordFromDegree(scaleName, deg);
        const beatOffset = startBeat + barIdx * barDur;
        intervals.forEach((interval) => {
          const midi = rootMidi + interval;
          addNote(midi, beatOffset, barDur - 0.25, 0.75);
        });
      });
      break;
    }
    case "harmonize-3rds": // returns empty — applied to selection in the component
    case "harmonize-5ths":
      break;
    case "arpeggio-up": {
      const chordNotes = [0, 2, 4].map((d) => (scale[d % scale.length] ?? 0) + rootMidi);
      for (let bar = 0; bar < 4; bar++) {
        const oct = bar < 2 ? 0 : 12;
        chordNotes.forEach((n, i) => {
          addNote(n + oct, startBeat + bar * 4 + i * gridRes * 2, gridRes * 2, 0.7);
          addNote(n + oct + 12, startBeat + bar * 4 + (i + 3) * gridRes * 2, gridRes * 2, 0.6);
        });
      }
      break;
    }
    case "arpeggio-down": {
      const chordNotes = [0, 2, 4].map((d) => (scale[d % scale.length] ?? 0) + rootMidi + 12).reverse();
      for (let bar = 0; bar < 4; bar++) {
        chordNotes.forEach((n, i) => {
          addNote(n, startBeat + bar * 4 + i * gridRes * 2, gridRes * 2, 0.7);
          addNote(n - 12, startBeat + bar * 4 + (i + 3) * gridRes * 2, gridRes * 2, 0.6);
        });
      }
      break;
    }
  }
  return notes;
}

/** Harmonize existing notes by adding scale-based intervals */
function harmonizeNotes(
  existingNotes: PianoRollNote[],
  interval: number, // 2 = thirds, 4 = fifths (scale degree offset)
  rootMidi: number,
  scaleName: string,
): PianoRollNote[] {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const result: PianoRollNote[] = [];
  for (const note of existingNotes) {
    const degree = (note.midi - rootMidi + 120) % 12;
    const scaleIdx = scale.indexOf(degree);
    if (scaleIdx < 0) continue;
    const targetDegree = scale[(scaleIdx + interval) % scale.length] ?? 0;
    let targetMidi = note.midi - degree + targetDegree;
    if (targetMidi <= note.midi) targetMidi += 12; // always go up
    result.push({ id: uid(), midi: targetMidi, start: note.start, duration: note.duration, velocity: note.velocity * 0.85, track: note.track });
  }
  return result;
}

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

function isNoteInScale(midi: number, rootMidi: number, scaleName: string): boolean {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const degree = (midi - rootMidi + 120) % 12;
  return scale.includes(degree);
}

function snapToScale(midi: number, rootMidi: number, scaleName: string): number {
  if (isNoteInScale(midi, rootMidi, scaleName)) return midi;
  for (let offset = 1; offset <= 6; offset++) {
    if (isNoteInScale(midi + offset, rootMidi, scaleName)) return midi + offset;
    if (isNoteInScale(midi - offset, rootMidi, scaleName)) return midi - offset;
  }
  return midi;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PERSISTENT PIANO ROLL STATE — survives component unmount
   ═════════════════════════════════════════════════════════════════════════ */

// Module-level state so notes persist when panel is closed
let _pianoRollNotes: PianoRollNote[] = [];
let _pianoRollEnabled = true; // Can be toggled to mute piano roll playback

// Background playback scheduler — runs even when panel is closed
let _lastPlaybackStep = -1;
let _pianoRollStepCounter = 0; // Own counter, independent of drum pattern length
const _activePlaybackNotes = new Set<string>();

function pianoRollTick(currentStep: number, bpm: number): void {
  if (!_pianoRollEnabled || _pianoRollNotes.length === 0) return;
  if (currentStep === _lastPlaybackStep) return;

  // Detect step advancement (drum sequencer step changed)
  const drumStepAdvanced = _lastPlaybackStep >= 0;
  _lastPlaybackStep = currentStep;

  // Advance our own counter (wraps at piano roll length, not drum pattern length)
  if (drumStepAdvanced) {
    _pianoRollStepCounter++;
  } else {
    _pianoRollStepCounter = 0; // Reset on first tick
  }

  // Sync to drum pattern length (not fixed 64)
  const patternLen = useDrumStore.getState().pattern.length; // e.g. 16, 32, 64
  const wrappedStep = _pianoRollStepCounter % patternLen;
  const t = audioEngine.currentTime + 0.01;
  const secPerBeat = 60 / bpm; // seconds per quarter note

  for (const note of _pianoRollNotes) {
    const noteStartStep = Math.round(note.start * 4); // beats → steps (4 steps per beat)
    const noteEndStep = Math.round((note.start + note.duration) * 4);
    const target = note.track;  // Use per-note track instead of global

    // ─── Note ON ───
    if (noteStartStep === wrappedStep && !_activePlaybackNotes.has(note.id)) {
      _activePlaybackNotes.add(note.id);
      const durSec = note.duration * secPerBeat; // Convert beats to seconds

      switch (target) {
        case "drums":
          audioEngine.triggerVoice(Math.max(0, Math.min(11, note.midi - 36)));
          break;
        case "bass":
          if (soundFontEngine.isLoaded("bass")) {
            soundFontEngine.playNote("bass", note.midi, t, note.velocity, durSec);
          } else {
            bassEngine.triggerNote(note.midi, t, false, false, false);
          }
          break;
        case "chords":
          if (soundFontEngine.isLoaded("chords")) {
            soundFontEngine.playNote("chords", note.midi, t, note.velocity, durSec);
          } else {
            chordsEngine.triggerChord([note.midi], t, false, false);
          }
          break;
        case "melody":
          if (soundFontEngine.isLoaded("melody")) {
            soundFontEngine.playNote("melody", note.midi, t, note.velocity, durSec);
          } else {
            melodyEngine.triggerNote(note.midi, t, false, false, false);
          }
          break;
      }
    }

    // ─── Note OFF (use >= to catch long notes that span multiple steps) ───
    if (noteEndStep <= wrappedStep && _activePlaybackNotes.has(note.id) && noteStartStep < wrappedStep) {
      _activePlaybackNotes.delete(note.id);
      if (target === "bass" && !soundFontEngine.isLoaded("bass")) bassEngine.releaseNote(t);
      else if (target === "chords" && !soundFontEngine.isLoaded("chords")) chordsEngine.releaseChord(t);
      else if (target === "melody" && !soundFontEngine.isLoaded("melody")) melodyEngine.releaseNote(t);
    }
  }

  // Reset at loop boundary
  if (wrappedStep === 0) _activePlaybackNotes.clear();
}

// Subscribe to transport — this runs globally, not tied to component lifecycle
useTransportStore.subscribe((state, prev) => {
  if (state.currentStep !== prev.currentStep) {
    const bpm = useDrumStore.getState().bpm;
    const isPlaying = useDrumStore.getState().isPlaying;
    if (isPlaying) pianoRollTick(state.currentStep, bpm);
    else { _lastPlaybackStep = -1; _pianoRollStepCounter = 0; _activePlaybackNotes.clear(); }
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═════════════════════════════════════════════════════════════════════════ */

export function PianoRoll({ isOpen, onClose }: PianoRollProps) {
  const bpm = useDrumStore((s) => s.bpm);
  const currentStep = useTransportStore((s) => s.currentStep);
  const rootNote = useBassStore((s) => s.rootNote);
  const scaleName = useBassStore((s) => s.scaleName);

  // ─── STATE (synced to module-level for persistent playback) ───
  const [notes, setNotesLocal] = useState<PianoRollNote[]>(_pianoRollNotes);
  const setNotes = useCallback((updater: PianoRollNote[] | ((prev: PianoRollNote[]) => PianoRollNote[])) => {
    setNotesLocal((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      _pianoRollNotes = next; // Sync to module-level for background playback
      return next;
    });
  }, []);

  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [gridRes, setGridRes] = useState(0.25);
  const [snap, setSnap] = useState(true);
  const [target, setTarget] = useState<SoundTarget>("melody");
  const [dragMode, setDragMode] = useState<"none" | "move" | "resize" | "velocity">("none");

  const [cellW, setCellW] = useState(DEFAULT_CELL_W);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [scaleSnap, setScaleSnap] = useState(false);
  // Sync piano roll length to drum pattern (1 bar = 4 beats)
  const patternLength = useDrumStore((s) => s.pattern.length);
  const totalBeats = patternLength / 4; // 16 steps = 4 beats, 64 steps = 16 beats

  const [clipboard, setClipboard] = useState<PianoRollNote[]>([]);
  const [rubberBand, setRubberBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; note: PianoRollNote } | null>(null);
  const gridClickStartRef = useRef<{ x: number; y: number } | null>(null);

  const totalRows = 48;
  const baseNote = 36;
  const rootMidi = 60 + rootNote;
  const gridW = totalBeats * cellW;
  const gridH = totalRows * rowHeight;
  const accentColor = TARGET_COLORS[target];
  const velocityLaneHeight = 80;

  // ─── NOTE ACTIONS ─────────────────────────────────────────────
  const addNote = useCallback((midi: number, startBeat: number) => {
    let finalMidi = midi;
    let start = startBeat;

    if (scaleSnap) {
      finalMidi = snapToScale(midi, rootMidi, scaleName);
    }

    if (snap) {
      start = Math.round(startBeat / gridRes) * gridRes;
    }

    const note: PianoRollNote = {
      id: uid(),
      midi: finalMidi,
      start: Math.max(0, start),
      duration: Math.max(1, gridRes * 4), // Default: 1 beat (quarter note) minimum
      velocity: 0.8,
      track: target,
    };
    setNotes((prev) => [...prev, note]);
    setSelectedNoteIds(new Set([note.id]));
    previewNote(finalMidi, 0.8, target);
  }, [gridRes, snap, scaleSnap, target, rootMidi, scaleName]);

  const removeNotes = useCallback((ids: Set<string>) => {
    setNotes((prev) => prev.filter((n) => !ids.has(n.id)));
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const patchNotes = useCallback((ids: Set<string>, patch: Partial<PianoRollNote>) => {
    setNotes((prev) => prev.map((n) => ids.has(n.id) ? { ...n, ...patch } : n));
  }, []);

  const quantizeNotes = useCallback((ids: Set<string>) => {
    setNotes((prev) =>
      prev.map((n) => {
        if (!ids.has(n.id)) return n;
        return {
          ...n,
          start: Math.round(n.start / gridRes) * gridRes,
          duration: Math.round(n.duration / gridRes) * gridRes,
        };
      })
    );
  }, [gridRes]);

  const copyNotes = useCallback(() => {
    const toCopy = notes.filter((n) => selectedNoteIds.has(n.id));
    if (toCopy.length === 0) return;
    const minStart = Math.min(...toCopy.map((n) => n.start));
    const normalized = toCopy.map((n) => ({ ...n, start: n.start - minStart }));
    setClipboard(normalized);
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
  }, [clipboard, currentStep, target]);

  // ─── KEYBOARD SHORTCUTS ───────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "a") {
          e.preventDefault();
          setSelectedNoteIds(new Set(notes.map((n) => n.id)));
        } else if (e.key === "c") {
          e.preventDefault();
          copyNotes();
        } else if (e.key === "v") {
          e.preventDefault();
          pasteNotes();
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (selectedNoteIds.size > 0) {
          removeNotes(selectedNoteIds);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, notes, selectedNoteIds, copyNotes, pasteNotes, removeNotes]);

  // ─── ZOOM ─────────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!gridRef.current) return;

    const isHorizontalZoom = e.ctrlKey;
    const isVerticalZoom = e.shiftKey;

    if (!isHorizontalZoom && !isVerticalZoom) return;

    e.preventDefault();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;

    if (isHorizontalZoom) {
      setCellW((prev) => Math.max(15, Math.min(60, prev * delta)));
    } else if (isVerticalZoom) {
      setRowHeight((prev) => Math.max(10, Math.min(30, prev * delta)));
    }
  }, []);

  // ─── GRID INTERACTIONS ────────────────────────────────────────
  const handleGridPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left + gridRef.current!.scrollLeft;
    const y = e.clientY - rect.top + gridRef.current!.scrollTop;

    if (y > gridH) return;

    const row = Math.floor(y / rowHeight);
    const midi = baseNote + (totalRows - row - 1);
    const beat = x / cellW;

    // Only hit notes on the SAME track — allows overlapping notes on different tracks
    const hit = notes.find((n) => n.track === target && n.midi === midi && beat >= n.start && beat < n.start + n.duration);

    if (hit) {
      if (e.shiftKey) {
        setSelectedNoteIds((prev) => {
          const next = new Set(prev);
          if (next.has(hit.id)) {
            next.delete(hit.id);
          } else {
            next.add(hit.id);
          }
          return next;
        });
      } else if (!selectedNoteIds.has(hit.id)) {
        setSelectedNoteIds(new Set([hit.id]));
      }
      return;
    }

    // Track click start for determining if this is a drag or single click
    gridClickStartRef.current = { x: e.clientX, y: e.clientY };

    if (e.shiftKey) {
      setRubberBand({ x0: x, y0: y, x1: x, y1: y });
    } else {
      // Don't create note yet; only create if it's not a drag
      setSelectedNoteIds(new Set());
    }
  }, [notes, baseNote, gridH, totalRows, rowHeight, cellW, selectedNoteIds]);

  const handleGridPointerMove = useCallback((e: React.PointerEvent) => {
    if (!rubberBand) return;

    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left + gridRef.current!.scrollLeft;
    const y = e.clientY - rect.top + gridRef.current!.scrollTop;

    setRubberBand({ ...rubberBand, x1: x, y1: y });

    const x0 = Math.min(rubberBand.x0, x);
    const x1 = Math.max(rubberBand.x0, x);
    const y0 = Math.min(rubberBand.y0, y);
    const y1 = Math.max(rubberBand.y0, y);

    const selected = new Set<string>();
    for (const note of notes) {
      const noteX = note.start * cellW;
      const noteX2 = noteX + Math.max(12, note.duration * cellW);
      const row = totalRows - (note.midi - baseNote) - 1;
      const noteY = row * rowHeight;
      const noteY2 = noteY + rowHeight;

      if (noteX < x1 && noteX2 > x0 && noteY < y1 && noteY2 > y0) {
        selected.add(note.id);
      }
    }
    setSelectedNoteIds(selected);
  }, [rubberBand, notes, totalRows, baseNote, cellW, rowHeight]);

  const handleGridPointerUp = useCallback((e: React.PointerEvent) => {
    // If this was a single click (not a drag > 3px), create a note
    if (gridClickStartRef.current && !rubberBand) {
      const dx = Math.abs(e.clientX - gridClickStartRef.current.x);
      const dy = Math.abs(e.clientY - gridClickStartRef.current.y);
      if (dx < 3 && dy < 3) {
        const rect = gridRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left + gridRef.current!.scrollLeft;
          const y = e.clientY - rect.top + gridRef.current!.scrollTop;
          if (y <= gridH) {
            const row = Math.floor(y / rowHeight);
            const midi = baseNote + (totalRows - row - 1);
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
  }, [rubberBand, gridH, totalRows, rowHeight, baseNote, cellW, addNote]);

  // ─── NOTE POINTER HANDLERS ────────────────────────────────────
  const handleNotePointerDown = useCallback((e: React.PointerEvent, noteId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey) {
      setSelectedNoteIds((prev) => {
        const next = new Set(prev);
        if (next.has(noteId)) {
          next.delete(noteId);
        } else {
          next.add(noteId);
        }
        return next;
      });
      // Clear drag mode and drag state after shift-click
      setDragMode("none");
      dragStartRef.current = null;
      return;
    }

    if (!selectedNoteIds.has(noteId)) {
      setSelectedNoteIds(new Set([noteId]));
    }

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

    setDragMode(mode);
    dragStartRef.current = { x: e.clientX, y: e.clientY, note: { ...note } };
    el.setPointerCapture(e.pointerId);
  }, [notes, selectedNoteIds]);

  const handleNotePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragMode === "none" || !dragStartRef.current) return;
    const { x: sx, y: sy, note: orig } = dragStartRef.current;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;

    switch (dragMode) {
      case "move": {
        let beatDelta = dx / cellW;
        const pitchDelta = -Math.round(dy / rowHeight);

        if (snap) beatDelta = Math.round(beatDelta / gridRes) * gridRes;

        // Move all selected notes RELATIVELY (preserve their spacing)
        setNotes((prev) => prev.map((n) => {
          if (!selectedNoteIds.has(n.id)) return n;
          // Find this note's original position from before drag started
          const origNote = prev.find((p) => p.id === dragStartRef.current?.note.id);
          if (!origNote) return n;
          // Calculate delta from the dragged note's original position
          const startDelta = (orig.start + beatDelta) - orig.start;
          let newMidi = n.midi + pitchDelta;
          if (scaleSnap) newMidi = snapToScale(newMidi, rootMidi, scaleName);
          return {
            ...n,
            start: Math.max(0, n.start + startDelta),
            midi: Math.max(0, Math.min(127, newMidi)),
          };
        }));
        // Update drag origin so movement is incremental
        dragStartRef.current = { x: e.clientX, y: e.clientY, note: { ...orig, start: orig.start + beatDelta, midi: orig.midi + pitchDelta } };
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
        const velDelta = -dy / velocityLaneHeight;
        patchNotes(selectedNoteIds, { velocity: Math.max(0.05, Math.min(1, orig.velocity + velDelta)) });
        break;
      }
    }
  }, [dragMode, gridRes, snap, scaleSnap, rootMidi, scaleName, cellW, rowHeight, selectedNoteIds, patchNotes, velocityLaneHeight]);

  const handleNotePointerUp = useCallback((e: React.PointerEvent) => {
    try {
      if (dragMode === "move" && dragStartRef.current && selectedNoteIds.size > 0) {
        const firstNote = notes.find((n) => n.id === Array.from(selectedNoteIds)[0]);
        if (firstNote && firstNote.midi !== dragStartRef.current.note.midi) {
          previewNote(firstNote.midi, firstNote.velocity, firstNote.track);
        }
      }
    } finally {
      setDragMode("none");
      dragStartRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  }, [dragMode, notes, selectedNoteIds]);

  const handleNoteContext = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    removeNotes(new Set([id]));
  }, [removeNotes]);

  // ─── PIANO KEY CLICK ──────────────────────────────────────────
  const handleKeyClick = useCallback((midi: number) => {
    previewNote(midi, 0.8, target);
  }, [target]);

  if (!isOpen) return null;

  const playheadBeat = currentStep / 4;
  const zoomPercentage = Math.round((cellW / DEFAULT_CELL_W) * 100);

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════ */

  return (
    <div className="fixed inset-0 z-50 bg-[var(--ed-bg-primary)] flex flex-col">
      {/* ─── TOOLBAR ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/60 overflow-x-auto">
        <span className="text-[10px] font-black tracking-[0.15em] shrink-0" style={{ color: accentColor }}>
          PIANO ROLL
        </span>

        <div className="w-px h-4 bg-white/10 shrink-0" />

        {/* Sound target */}
        <div className="flex gap-[2px] bg-black/20 rounded-md p-[2px] shrink-0">
          {(["melody", "chords", "bass", "drums"] as SoundTarget[]).map((t) => (
            <button
              key={t}
              onClick={() => setTarget(t)}
              className="px-2 py-0.5 text-[8px] font-bold tracking-wider rounded transition-all"
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

        <div className="w-px h-4 bg-white/10 shrink-0" />

        {/* Grid */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[8px] text-white/25 font-bold">GRID</span>
          <select
            value={gridRes}
            onChange={(e) => setGridRes(parseFloat(e.target.value))}
            className="h-6 px-1.5 text-[9px] bg-black/30 border border-white/8 rounded text-white/70 cursor-pointer"
          >
            <option value={0.125}>1/32</option>
            <option value={0.25}>1/16</option>
            <option value={0.5}>1/8</option>
            <option value={1}>1/4</option>
          </select>
        </div>

        {/* Snap */}
        <button
          onClick={() => setSnap(!snap)}
          className="px-1.5 py-0.5 text-[8px] font-bold tracking-wider rounded transition-all shrink-0"
          style={{
            backgroundColor: snap ? accentColor : "transparent",
            color: snap ? "#000" : "white",
            opacity: snap ? 1 : 0.3,
            border: `1px solid ${snap ? accentColor : "rgba(255,255,255,0.1)"}`,
          }}
        >
          SNAP
        </button>

        {/* Scale snap */}
        <button
          onClick={() => setScaleSnap(!scaleSnap)}
          className="px-1.5 py-0.5 text-[8px] font-bold tracking-wider rounded transition-all shrink-0"
          style={{
            backgroundColor: scaleSnap ? accentColor : "transparent",
            color: scaleSnap ? "#000" : "white",
            opacity: scaleSnap ? 1 : 0.3,
            border: `1px solid ${scaleSnap ? accentColor : "rgba(255,255,255,0.1)"}`,
          }}
        >
          SCALE
        </button>

        {/* Quantize */}
        <button
          onClick={() => {
            if (selectedNoteIds.size > 0) {
              quantizeNotes(selectedNoteIds);
            }
          }}
          disabled={selectedNoteIds.size === 0}
          className="px-1.5 py-0.5 text-[8px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20"
          style={{
            backgroundColor: "rgba(255,165,0,0.2)",
            color: selectedNoteIds.size > 0 ? "white" : "white/50",
            border: "1px solid rgba(255,165,0,0.3)",
          }}
        >
          QUANTIZE
        </button>

        <div className="w-px h-4 bg-white/10 shrink-0" />

        {/* Multi-select */}
        <button
          onClick={() => setSelectedNoteIds(new Set(notes.map((n) => n.id)))}
          className="px-1.5 py-0.5 text-[8px] font-bold tracking-wider rounded transition-all shrink-0"
          style={{
            backgroundColor: "rgba(100,150,255,0.2)",
            color: "white",
            border: "1px solid rgba(100,150,255,0.3)",
          }}
        >
          SEL ALL
        </button>

        {/* Delete selected */}
        <button
          onClick={() => removeNotes(selectedNoteIds)}
          disabled={selectedNoteIds.size === 0}
          className="px-1.5 py-0.5 text-[8px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20"
          style={{
            backgroundColor: "rgba(255,100,100,0.2)",
            color: selectedNoteIds.size > 0 ? "white" : "white/50",
            border: "1px solid rgba(255,100,100,0.3)",
          }}
        >
          DEL
        </button>

        {/* Copy */}
        <button
          onClick={copyNotes}
          disabled={selectedNoteIds.size === 0}
          className="px-1.5 py-0.5 text-[8px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20"
          style={{
            backgroundColor: "rgba(100,200,100,0.2)",
            color: selectedNoteIds.size > 0 ? "white" : "white/50",
            border: "1px solid rgba(100,200,100,0.3)",
          }}
        >
          COPY
        </button>

        {/* Paste */}
        <button
          onClick={pasteNotes}
          disabled={clipboard.length === 0}
          className="px-1.5 py-0.5 text-[8px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20"
          style={{
            backgroundColor: "rgba(100,200,100,0.2)",
            color: clipboard.length > 0 ? "white" : "white/50",
            border: "1px solid rgba(100,200,100,0.3)",
          }}
        >
          PASTE
        </button>

        {/* Clear all */}
        <button
          onClick={() => {
            setNotes([]);
            setSelectedNoteIds(new Set());
          }}
          className="px-1.5 py-0.5 text-[8px] font-bold tracking-wider rounded transition-all shrink-0"
          style={{
            backgroundColor: "rgba(200,100,100,0.2)",
            color: "rgba(255,200,200,0.6)",
            border: "1px solid rgba(200,100,100,0.2)",
          }}
        >
          CLEAR
        </button>

        <div className="w-px h-4 bg-white/10 shrink-0" />

        {/* ─── HARMONY Generator ─── */}
        <HarmonyMenu
          accentColor={accentColor}
          onGenerate={(type) => {
            if (type === "fix-to-scale" as HarmonyType) {
              // Snap ALL notes (or selected) to nearest scale note
              const ids = selectedNoteIds.size > 0 ? selectedNoteIds : new Set(notes.map(n => n.id));
              setNotes((prev) => prev.map((n) => {
                if (!ids.has(n.id)) return n;
                return { ...n, midi: snapToScale(n.midi, rootMidi, scaleName) };
              }));
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
          }}
        />

        <div className="flex-1" />

        {/* Stats */}
        <div className="flex items-center gap-3 text-[8px] text-white/30 shrink-0">
          <span className="font-mono">{notes.length} notes</span>
          <span>|</span>
          <span className="font-mono">{bpm} BPM</span>
          <span>|</span>
          <span className="font-mono">{totalBeats} beats</span>
          <span>|</span>
          <span className="font-mono">{zoomPercentage}%</span>
        </div>

        <div className="w-px h-4 bg-white/10 shrink-0" />

        <button
          onClick={onClose}
          className="px-2 py-1 text-[8px] font-bold tracking-wider text-white/40 hover:text-white/80 border border-white/10 hover:border-white/25 rounded transition-all shrink-0"
        >
          BACK
        </button>
      </div>

      {/* ─── MAIN GRID ────────────────────────────────────────────– */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Piano keys */}
        <div
          className="shrink-0 overflow-y-auto border-r border-[var(--ed-border)]"
          style={{ width: PIANO_WIDTH }}
        >
          {Array.from({ length: totalRows }, (_, i) => {
            const midi = baseNote + (totalRows - i - 1);
            const noteIdx = midi % 12;
            const octave = Math.floor(midi / 12) - 1;
            const isBlack = OCTAVE_PATTERN[noteIdx]?.black ?? false;
            const isC = noteIdx === 0;
            const isScaleNote = isNoteInScale(midi, rootMidi, scaleName);

            return (
              <div
                key={i}
                onClick={() => handleKeyClick(midi)}
                className={`flex items-center px-1 text-[7px] font-bold tracking-wider cursor-pointer select-none border-b transition-colors ${
                  isBlack
                    ? "bg-[#131316] text-white/15 hover:bg-[#1c1c22] border-[#0a0a0c]"
                    : "bg-[#24242a] text-white/25 hover:bg-[#2e2e36] border-[#1a1a1e]"
                } ${isC ? "border-b-[var(--ed-border)]" : "border-b-[#1a1a1e]/50"} ${
                  scaleSnap && !isScaleNote ? "opacity-40" : ""
                } ${scaleSnap && isScaleNote && !isBlack ? "bg-[#2a3628]" : ""}`}
                style={{ height: rowHeight }}
              >
                {isC && <span className="text-white/40">{octave}</span>}
              </div>
            );
          })}
        </div>

        {/* Grid + notes */}
        <div
          ref={gridRef}
          className="flex-1 overflow-auto relative"
          onPointerDown={handleGridPointerDown}
          onPointerMove={handleGridPointerMove}
          onPointerUp={handleGridPointerUp}
          onWheel={handleWheel}
        >
          {/* Background grid */}
          <div className="relative" style={{ width: gridW, height: gridH + velocityLaneHeight }}>
            {/* Row stripes (notes grid) */}
            {Array.from({ length: totalRows }, (_, i) => {
              const midi = baseNote + (totalRows - i - 1);
              const isBlack = OCTAVE_PATTERN[midi % 12]?.black ?? false;
              const isScaleNote = isNoteInScale(midi, rootMidi, scaleName);

              return (
                <div
                  key={`row-${i}`}
                  className="absolute w-full border-b border-white/[0.03]"
                  style={{
                    top: i * rowHeight,
                    height: rowHeight,
                    backgroundColor: isBlack
                      ? "rgba(255,255,255,0.015)"
                      : scaleSnap && isScaleNote
                        ? "rgba(50,180,100,0.1)"
                        : scaleSnap
                          ? "rgba(255,255,255,0.005)"
                          : "transparent",
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
                  className="absolute top-0 bottom-0"
                  style={{
                    left: x,
                    width: 1,
                    backgroundColor: isBar
                      ? "rgba(255,255,255,0.18)"
                      : isBeat
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(255,255,255,0.03)",
                  }}
                />
              );
            })}

            {/* Bar numbers */}
            {Array.from({ length: Math.ceil(totalBeats / 4) }, (_, i) => (
              <div
                key={`bar-${i}`}
                className="absolute text-[8px] font-bold text-white/12 pointer-events-none"
                style={{ left: i * 4 * cellW + 4, top: 2 }}
              >
                {i + 1}
              </div>
            ))}

            {/* ─── NOTES ────────────────────────────────────────── */}
            {notes.map((note) => {
              const row = totalRows - (note.midi - baseNote) - 1;
              if (row < 0 || row >= totalRows) return null;
              const x = note.start * cellW;
              const y = row * rowHeight;
              const w = Math.max(12, note.duration * cellW);
              const isSel = selectedNoteIds.has(note.id);
              const noteColor = TARGET_COLORS[note.track];

              return (
                <div
                  key={note.id}
                  onPointerDown={(e) => handleNotePointerDown(e, note.id)}
                  onPointerMove={handleNotePointerMove}
                  onPointerUp={handleNotePointerUp}
                  onContextMenu={(e) => handleNoteContext(e, note.id)}
                  className="absolute rounded-[3px] touch-none select-none"
                  style={{
                    left: x,
                    top: y + 1,
                    width: w,
                    height: rowHeight - 2,
                    backgroundColor: noteColor,
                    opacity: 0.5 + note.velocity * 0.5,
                    outline: isSel ? "2px solid white" : "none",
                    outlineOffset: "-1px",
                    boxShadow: isSel ? `0 0 12px ${noteColor}60` : "none",
                    zIndex: isSel ? 10 : 1,
                    cursor: dragMode === "resize" ? "col-resize" : dragMode === "velocity" ? "ns-resize" : "grab",
                  }}
                >
                  {/* Note name */}
                  {w > 28 && (
                    <span className="absolute left-1 top-0 text-[7px] font-bold text-black/60 leading-none pointer-events-none" style={{ top: 2 }}>
                      {midiNoteName(note.midi)}
                    </span>
                  )}

                  {/* Velocity bar */}
                  <div
                    className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[3px] cursor-ns-resize"
                    style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
                  >
                    <div
                      className="h-full rounded-b-[3px]"
                      style={{ width: `${note.velocity * 100}%`, backgroundColor: "rgba(255,255,255,0.4)" }}
                    />
                  </div>

                  {/* Resize handle */}
                  <div className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize hover:bg-white/20 rounded-r-[3px] transition-colors" />
                </div>
              );
            })}

            {/* ─── VELOCITY LANE ────────────────────────────────── */}
            <div
              className="absolute border-t border-white/8"
              style={{
                top: gridH,
                left: 0,
                right: 0,
                height: velocityLaneHeight,
                backgroundColor: "rgba(0,0,0,0.2)",
              }}
            >
              {/* Velocity bars */}
              {notes.map((note) => {
                const x = note.start * cellW;
                const w = Math.max(12, note.duration * cellW);
                const h = note.velocity * velocityLaneHeight;
                const isSel = selectedNoteIds.has(note.id);
                const noteColor = TARGET_COLORS[note.track];

                return (
                  <div
                    key={`vel-${note.id}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!selectedNoteIds.has(note.id)) {
                        setSelectedNoteIds(new Set([note.id]));
                      }
                      setDragMode("velocity");
                      dragStartRef.current = { x: e.clientX, y: e.clientY, note: { ...note } };
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={handleNotePointerMove}
                    onPointerUp={handleNotePointerUp}
                    className="absolute rounded-t-[2px]"
                    style={{
                      left: x,
                      top: velocityLaneHeight - h,
                      width: w,
                      height: h,
                      backgroundColor: noteColor,
                      opacity: 0.6 + note.velocity * 0.3,
                      cursor: "ns-resize",
                      outline: isSel ? "1px solid white" : "none",
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
                width: 2,
                height: gridH + velocityLaneHeight,
                backgroundColor: accentColor,
                boxShadow: `0 0 8px ${accentColor}, 0 0 20px ${accentColor}40`,
              }}
            />

            {/* Rubber band selection */}
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

      {/* ─── FOOTER ───────────────────────────────────────────────– */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/60 text-[8px] text-white/30">
        <div>
          {selectedNoteIds.size === 1 ? (
            (() => {
              const note = notes.find((n) => n.id === Array.from(selectedNoteIds)[0]);
              return note
                ? `${midiNoteName(note.midi)} | Beat ${note.start.toFixed(2)} | Dur ${note.duration.toFixed(2)} | Vel ${Math.round(note.velocity * 100)}%`
                : "Click = add note · Shift+Drag = rubber band · Ctrl+A = select all";
            })()
          ) : selectedNoteIds.size > 1 ? (
            `${selectedNoteIds.size} notes selected · Delete = remove · Ctrl+C = copy · Ctrl+V = paste`
          ) : (
            "Click = add note · Shift+Drag = rubber band · Ctrl+A = select all · Ctrl+Wheel = zoom"
          )}
        </div>
        <div className="flex items-center gap-2">
          <span>Ctrl+Scroll = H.Zoom</span>
          <span>|</span>
          <span>Shift+Scroll = V.Zoom</span>
          <span>|</span>
          <span style={{ color: accentColor }}>{target.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   HARMONY MENU — Dropdown with scale/chord/arpeggio generators
   ═════════════════════════════════════════════════════════════════════════ */

function HarmonyMenu({ accentColor, onGenerate }: {
  accentColor: string;
  onGenerate: (type: HarmonyType) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  let lastGroup = "";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-0.5 text-[8px] font-bold tracking-wider rounded transition-all"
        style={{
          backgroundColor: open ? accentColor : "rgba(255,255,255,0.05)",
          color: open ? "#000" : accentColor,
          border: `1px solid ${open ? accentColor : accentColor + "40"}`,
        }}
      >
        HARMONY
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[180px] bg-[#1a1a22] border border-[var(--ed-border)] rounded-lg shadow-2xl py-1 overflow-hidden">
          {HARMONY_PRESETS.map((preset) => {
            const showGroupHeader = preset.group !== lastGroup;
            lastGroup = preset.group;
            return (
              <React.Fragment key={preset.id}>
                {showGroupHeader && (
                  <div className="px-3 pt-2 pb-1 text-[7px] font-bold tracking-[0.2em] text-white/25 uppercase">
                    {preset.group}
                  </div>
                )}
                <button
                  onClick={() => { onGenerate(preset.id); setOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-[10px] text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                >
                  {preset.label}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
