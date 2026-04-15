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
const PIANO_WIDTH = 68;
const DEFAULT_CELL_W = 90; // Wider cells for better visibility
const DEFAULT_ROW_HEIGHT = 20; // Taller rows for easier note editing

// Piano key colors
const PIANO_WHITE_BG = "linear-gradient(180deg, #2a2a30 0%, #222228 100%)";
const PIANO_WHITE_BG_C = "linear-gradient(180deg, #33333a 0%, #2b2b32 100%)";
const PIANO_BLACK_BG = "#0d0d10";
const PIANO_BLACK_BG_HOVER = "#191920";

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

// Preview a note with guaranteed release (setTimeout safety net + AudioParam scheduling)
let _previewReleaseTimer: ReturnType<typeof setTimeout> | null = null;

function previewNote(midi: number, velocity: number, target: SoundTarget): void {
  const now = audioEngine.currentTime;

  // Clear any previous preview timer
  if (_previewReleaseTimer) clearTimeout(_previewReleaseTimer);

  switch (target) {
    case "drums":
      audioEngine.triggerVoice(Math.max(0, Math.min(11, midi - 36)));
      return; // Drums don't need release
    case "bass":
      if (soundFontEngine.isLoaded("bass")) {
        soundFontEngine.playNote("bass", midi, now, velocity, 0.25);
        return;
      }
      bassEngine.triggerNote(midi, now, false, false, false);
      break;
    case "chords":
      if (soundFontEngine.isLoaded("chords")) {
        soundFontEngine.playNote("chords", midi, now, velocity, 0.25);
        return;
      }
      chordsEngine.triggerChord([midi], now, false, false);
      break;
    case "melody":
      if (soundFontEngine.isLoaded("melody")) {
        soundFontEngine.playNote("melody", midi, now, velocity, 0.25);
        return;
      }
      melodyEngine.triggerNote(midi, now, false, false, false);
      break;
  }

  // setTimeout safety net: guaranteed release after 300ms (cannot be cancelled by cancelScheduledValues)
  _previewReleaseTimer = setTimeout(() => {
    _previewReleaseTimer = null;
    const t = audioEngine.currentTime;
    if (target === "bass") bassEngine.releaseNote(t);
    else if (target === "chords") chordsEngine.releaseChord(t);
    else if (target === "melody") melodyEngine.releaseNote(t);
  }, 300);
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
// Safety-net timers: ensure every note gets released even if step logic misses it
const _noteReleaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

function pianoRollTick(currentStep: number, bpm: number): void {
  if (!_pianoRollEnabled || _pianoRollNotes.length === 0) return;
  if (currentStep === _lastPlaybackStep) return;

  const drumStepAdvanced = _lastPlaybackStep >= 0;
  _lastPlaybackStep = currentStep;

  if (drumStepAdvanced) {
    _pianoRollStepCounter++;
  } else {
    _pianoRollStepCounter = 0;
  }

  const patternLen = useDrumStore.getState().pattern.length;
  const wrappedStep = _pianoRollStepCounter % patternLen;
  const t = audioEngine.currentTime + 0.01;
  const secPerBeat = 60 / bpm;

  // ─── PHASE 1: Release notes that have ended ─────────────────────
  // Run BEFORE Note ON to ensure proper cleanup, including at loop boundary
  for (const note of _pianoRollNotes) {
    if (!_activePlaybackNotes.has(note.id)) continue;

    const noteStartStep = Math.round(note.start * 4);
    const noteEndStep = Math.round((note.start + note.duration) * 4);
    const target = note.track;

    // Check if this note should be released
    let shouldRelease = false;

    if (noteEndStep <= patternLen) {
      // Normal note (doesn't wrap): release when current step >= end step
      // Use > instead of >= when start and end are on different steps
      shouldRelease = wrappedStep >= noteEndStep && wrappedStep !== noteStartStep;
    } else {
      // Wrapping note: release when past effective end AND before start
      const effectiveEnd = noteEndStep % patternLen;
      shouldRelease = wrappedStep >= effectiveEnd && wrappedStep < noteStartStep;
    }

    // Also release at loop boundary for notes that should have ended
    if (wrappedStep === 0 && noteStartStep !== 0) {
      shouldRelease = true;
    }

    if (shouldRelease) {
      _activePlaybackNotes.delete(note.id);
      const timer = _noteReleaseTimers.get(note.id);
      if (timer) { clearTimeout(timer); _noteReleaseTimers.delete(note.id); }
      if (target === "bass") bassEngine.releaseNote(t);
      else if (target === "chords") chordsEngine.releaseChord(t);
      else if (target === "melody") melodyEngine.releaseNote(t);
    }
  }

  // ─── PHASE 2: Trigger notes that start on this step ─────────────
  for (const note of _pianoRollNotes) {
    const noteStartStep = Math.round(note.start * 4);
    const target = note.track;

    if (noteStartStep !== wrappedStep || _activePlaybackNotes.has(note.id)) continue;

    _activePlaybackNotes.add(note.id);
    const durSec = note.duration * secPerBeat;

    // Clear any leftover timer from previous loop
    const prevTimer = _noteReleaseTimers.get(note.id);
    if (prevTimer) clearTimeout(prevTimer);

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

    // SAFETY NET: setTimeout fires AFTER note duration — cannot be killed by cancelScheduledValues
    if (target !== "drums") {
      const safetyMs = durSec * 1000 + 80;
      const timer = setTimeout(() => {
        _noteReleaseTimers.delete(note.id);
        if (!_activePlaybackNotes.has(note.id)) return;
        _activePlaybackNotes.delete(note.id);
        const now = audioEngine.currentTime;
        if (target === "bass") bassEngine.releaseNote(now);
        else if (target === "chords") chordsEngine.releaseChord(now);
        else if (target === "melody") melodyEngine.releaseNote(now);
      }, safetyMs);
      _noteReleaseTimers.set(note.id, timer);
    }
  }
  // NOTE: No blanket loop-boundary reset here — Phase 1 handles per-note cleanup,
  // and safety timers are NOT cleared (they must be allowed to fire).
}

// Subscribe to transport — this runs globally, not tied to component lifecycle
useTransportStore.subscribe((state, prev) => {
  if (state.currentStep !== prev.currentStep) {
    const bpm = useDrumStore.getState().bpm;
    const isPlaying = useDrumStore.getState().isPlaying;
    if (isPlaying) pianoRollTick(state.currentStep, bpm);
    else {
      // Playback stopped — release any hanging notes
      if (_activePlaybackNotes.size > 0) {
        const now = audioEngine.currentTime + 0.005;
        bassEngine.releaseNote(now);
        chordsEngine.releaseChord(now);
        melodyEngine.releaseNote(now);
      }
      _lastPlaybackStep = -1; _pianoRollStepCounter = 0; _activePlaybackNotes.clear();
      // Clear all safety timers
      for (const timer of _noteReleaseTimers.values()) clearTimeout(timer);
      _noteReleaseTimers.clear();
    }
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

  // ─── Undo/Redo history ───
  const undoStackRef = useRef<PianoRollNote[][]>([]);
  const redoStackRef = useRef<PianoRollNote[][]>([]);
  const pushUndo = useCallback(() => {
    undoStackRef.current.push(JSON.parse(JSON.stringify(notes)));
    if (undoStackRef.current.length > 50) undoStackRef.current.shift(); // Limit to 50
    redoStackRef.current = []; // Clear redo on new action
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

  const gridRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; note: PianoRollNote; originals: Map<string, { start: number; midi: number }> } | null>(null);
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
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const hasSel = selectedNoteIds.size > 0;

      // ─── Ctrl/Cmd shortcuts ───
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "a") { e.preventDefault(); setSelectedNoteIds(new Set(notes.map((n) => n.id))); }
        else if (e.key === "c") { e.preventDefault(); copyNotes(); }
        else if (e.key === "v") { e.preventDefault(); pushUndo(); pasteNotes(); }
        else if (e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); }
        else if (e.key === "z") { e.preventDefault(); undo(); }
        return;
      }

      // ─── Delete ───
      if ((e.key === "Delete" || e.key === "Backspace") && hasSel) {
        e.preventDefault(); pushUndo(); removeNotes(selectedNoteIds); return;
      }

      // ─── Arrow keys: move notes ───
      if (e.key === "ArrowLeft" && hasSel) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : gridRes; // Shift = 1 beat
        setNotes((prev) => prev.map((n) => !selectedNoteIds.has(n.id) ? n :
          { ...n, start: Math.max(0, Math.round((n.start - step) / gridRes) * gridRes) }
        ));
        return;
      }
      if (e.key === "ArrowRight" && hasSel) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : gridRes;
        setNotes((prev) => prev.map((n) => !selectedNoteIds.has(n.id) ? n :
          { ...n, start: Math.min(totalBeats - n.duration, Math.round((n.start + step) / gridRes) * gridRes) }
        ));
        return;
      }
      if (e.key === "ArrowUp" && hasSel) {
        e.preventDefault();
        const semitones = e.shiftKey ? 12 : 1; // Shift = octave
        setNotes((prev) => prev.map((n) => {
          if (!selectedNoteIds.has(n.id)) return n;
          let m = Math.min(baseNote + totalRows - 1, n.midi + semitones);
          if (scaleSnap) m = snapToScale(m, rootMidi, scaleName);
          return { ...n, midi: m };
        }));
        return;
      }
      if (e.key === "ArrowDown" && hasSel) {
        e.preventDefault();
        const semitones = e.shiftKey ? 12 : 1;
        setNotes((prev) => prev.map((n) => {
          if (!selectedNoteIds.has(n.id)) return n;
          let m = Math.max(baseNote, n.midi - semitones);
          if (scaleSnap) m = snapToScale(m, rootMidi, scaleName);
          return { ...n, midi: m };
        }));
        return;
      }

      // ─── Velocity quick-set: keys 1-9 = 10%-90%, 0 = 100% ───
      if (hasSel && e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        const vel = e.key === "0" ? 1.0 : parseInt(e.key) / 10;
        setNotes((prev) => prev.map((n) => !selectedNoteIds.has(n.id) ? n : { ...n, velocity: vel }));
        return;
      }

      // ─── D = duplicate selected notes (offset by 1 beat) ───
      if (e.key === "d" && hasSel) {
        e.preventDefault();
        const selected = notes.filter((n) => selectedNoteIds.has(n.id));
        const dupes = selected.map((n) => ({
          ...n, id: uid(), start: n.start + 1,
        }));
        setNotes((prev) => [...prev, ...dupes]);
        setSelectedNoteIds(new Set(dupes.map((n) => n.id)));
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, notes, selectedNoteIds, copyNotes, pasteNotes, removeNotes, pushUndo, undo, redo]);

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
    // Always snap click position to grid, clamp to visible range
    const rawBeat = x / cellW;
    const beat = snap ? Math.round(rawBeat / gridRes) * gridRes : rawBeat;
    if (beat < 0 || beat >= totalBeats || midi < baseNote || midi >= baseNote + totalRows) return;

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

    // Alt+Drag = duplicate selected notes, then drag the copies
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
        // Set originals for the NEW (duplicate) notes
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
    // Store original positions of ALL selected notes (DAW-style: freeze on drag start)
    const originals = new Map<string, { start: number; midi: number }>();
    const sel = selectedNoteIds.has(noteId) ? selectedNoteIds : new Set([noteId]);
    for (const id of sel) {
      const n = notes.find((nn) => nn.id === id);
      if (n) originals.set(id, { start: n.start, midi: n.midi });
    }
    dragStartRef.current = { x: e.clientX, y: e.clientY, note: { ...note }, originals };
    el.setPointerCapture(e.pointerId);
  }, [notes, selectedNoteIds, pushUndo, setNotes]);

  const handleNotePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragMode === "none" || !dragStartRef.current) return;
    const { x: sx, y: sy, note: orig } = dragStartRef.current;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;

    switch (dragMode) {
      case "move": {
        // DAW-style: calculate delta from drag start, apply to frozen originals
        const { originals } = dragStartRef.current!;
        const rawBeatDelta = dx / cellW;
        const pitchDelta = -Math.round(dy / rowHeight);
        const beatDelta = snap ? Math.round(rawBeatDelta / gridRes) * gridRes : rawBeatDelta;

        setNotes((prev) => prev.map((n) => {
          const original = originals.get(n.id);
          if (!original) return n; // Not selected, don't move

          let newStart = original.start + beatDelta;
          let newMidi = original.midi + pitchDelta;

          if (snap) newStart = Math.round(newStart / gridRes) * gridRes;
          if (scaleSnap) newMidi = snapToScale(newMidi, rootMidi, scaleName);

          return {
            ...n,
            start: Math.max(0, Math.min(totalBeats - n.duration, newStart)),
            midi: Math.max(baseNote, Math.min(baseNote + totalRows - 1, newMidi)),
          };
        }));
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
  const selectedCount = selectedNoteIds.size;
  const targetNoteCount = notes.filter((note) => note.track === target).length;
  const selectedNotes = notes.filter((note) => selectedNoteIds.has(note.id));
  const averageSelectedVelocity = selectedNotes.length > 0
    ? Math.round((selectedNotes.reduce((sum, note) => sum + note.velocity, 0) / selectedNotes.length) * 100)
    : null;

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════ */

  return (
    <div className="fixed inset-0 z-50 bg-[var(--ed-bg-primary)] flex flex-col">
      {/* ─── TOOLBAR ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/60 overflow-x-auto">
        <div className="shrink-0 min-w-[150px]">
          <div className="text-[10px] font-black tracking-[0.18em]" style={{ color: accentColor }}>
            PIANO ROLL
          </div>
          <div className="text-[9px] text-[var(--ed-text-muted)]">
            Clip editing with DAW-style lane workflow
          </div>
        </div>

        <div className="w-px h-4 bg-white/15 shrink-0" />

        {/* Sound target */}
        <div className="flex gap-px bg-black/30 rounded p-0.5 shrink-0">
          {(["melody", "chords", "bass", "drums"] as SoundTarget[]).map((t) => (
            <button
              key={t}
              onClick={() => setTarget(t)}
              className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded-sm transition-all hover:brightness-110"
              style={{
                backgroundColor: target === t ? TARGET_COLORS[t] : "rgba(255,255,255,0.05)",
                color: target === t ? "#000" : TARGET_COLORS[t],
                opacity: target === t ? 1 : 0.6,
                boxShadow: target === t ? `0 0 8px ${TARGET_COLORS[t]}40` : "none",
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-white/15 shrink-0" />

        {/* Grid */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[7px] text-white/35 font-bold uppercase tracking-wider">Grid</span>
          <select
            value={gridRes}
            onChange={(e) => setGridRes(parseFloat(e.target.value))}
            className="h-6 px-1.5 text-[8px] bg-black/30 border border-white/15 rounded text-white/70 cursor-pointer hover:border-white/25 transition-colors"
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
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 hover:brightness-110"
          style={{
            backgroundColor: snap ? TARGET_COLORS[target] : "rgba(255,255,255,0.05)",
            color: snap ? "#000" : "white",
            opacity: snap ? 1 : 0.4,
            border: `1px solid ${snap ? TARGET_COLORS[target] : "rgba(255,255,255,0.15)"}`,
            boxShadow: snap ? `0 0 6px ${TARGET_COLORS[target]}30` : "none",
          }}
        >
          SNAP
        </button>

        {/* Scale snap */}
        <button
          onClick={() => setScaleSnap(!scaleSnap)}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 hover:brightness-110"
          style={{
            backgroundColor: scaleSnap ? "#10b98160" : "rgba(255,255,255,0.05)",
            color: scaleSnap ? "#fff" : "white",
            opacity: scaleSnap ? 1 : 0.4,
            border: `1px solid ${scaleSnap ? "#10b98180" : "rgba(255,255,255,0.15)"}`,
            boxShadow: scaleSnap ? "0 0 6px #10b98140" : "none",
          }}
        >
          SCALE
        </button>

        <div className="w-px h-4 bg-white/15 shrink-0" />

        {/* Quantize */}
        <button
          onClick={() => {
            if (selectedNoteIds.size > 0) {
              quantizeNotes(selectedNoteIds);
            }
          }}
          disabled={selectedNoteIds.size === 0}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20 hover:brightness-110"
          style={{
            backgroundColor: selectedNoteIds.size > 0 ? "rgba(255,165,0,0.25)" : "rgba(255,165,0,0.1)",
            color: selectedNoteIds.size > 0 ? "white" : "white/50",
            border: "1px solid rgba(255,165,0,0.4)",
          }}
        >
          QUANTIZE
        </button>

        {/* Harmony */}
        <HarmonyMenu
          accentColor={accentColor}
          onGenerate={(type) => {
            if (type === "fix-to-scale" as HarmonyType) {
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

        <div className="w-px h-4 bg-white/15 shrink-0" />

        {/* Edit operations */}
        <button
          onClick={() => setSelectedNoteIds(new Set(notes.map((n) => n.id)))}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 hover:brightness-110"
          style={{
            backgroundColor: "rgba(100,150,255,0.15)",
            color: "white",
            border: "1px solid rgba(100,150,255,0.35)",
          }}
        >
          SEL ALL
        </button>

        <button
          onClick={() => removeNotes(selectedNoteIds)}
          disabled={selectedNoteIds.size === 0}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20 hover:brightness-110"
          style={{
            backgroundColor: "rgba(255,100,100,0.15)",
            color: selectedNoteIds.size > 0 ? "white" : "white/50",
            border: "1px solid rgba(255,100,100,0.35)",
          }}
        >
          DEL
        </button>

        <button
          onClick={copyNotes}
          disabled={selectedNoteIds.size === 0}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20 hover:brightness-110"
          style={{
            backgroundColor: "rgba(100,200,100,0.15)",
            color: selectedNoteIds.size > 0 ? "white" : "white/50",
            border: "1px solid rgba(100,200,100,0.35)",
          }}
        >
          COPY
        </button>

        <button
          onClick={pasteNotes}
          disabled={clipboard.length === 0}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20 hover:brightness-110"
          style={{
            backgroundColor: "rgba(100,200,100,0.15)",
            color: clipboard.length > 0 ? "white" : "white/50",
            border: "1px solid rgba(100,200,100,0.35)",
          }}
        >
          PASTE
        </button>

        <button
          onClick={() => {
            setNotes([]);
            setSelectedNoteIds(new Set());
          }}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 hover:brightness-110"
          style={{
            backgroundColor: "rgba(200,100,100,0.15)",
            color: "rgba(255,150,150,0.7)",
            border: "1px solid rgba(200,100,100,0.3)",
          }}
        >
          CLEAR
        </button>

        <div className="flex-1" />

        {/* Stats */}
        <div className="flex items-center gap-2 text-[7px] text-white/35 shrink-0 font-mono">
          <span>{notes.length} notes</span>
          <span className="text-white/20">|</span>
          <span>{bpm} BPM</span>
          <span className="text-white/20">|</span>
          <span>{zoomPercentage}%</span>
        </div>

        <div className="w-px h-4 bg-white/15 shrink-0" />

        <button
          onClick={onClose}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider text-white/35 hover:text-white/70 border border-white/15 hover:border-white/35 rounded transition-all shrink-0"
        >
          BACK
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--ed-border)]/60 bg-[var(--ed-bg-secondary)]/35 overflow-x-auto">
        <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
          Lane {target.toUpperCase()}
        </span>
        <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
          {targetNoteCount} lane notes
        </span>
        <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
          {selectedCount} selected
        </span>
        <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
          Playhead {playheadBeat.toFixed(2)} beats
        </span>
        <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
          Grid {gridRes === 0.125 ? "1/32" : gridRes === 0.25 ? "1/16" : gridRes === 0.5 ? "1/8" : "1/4"}
        </span>
        <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border shrink-0 ${
          dragMode !== "none"
            ? "border-white/20 bg-white/10 text-white/80"
            : "border-white/8 bg-white/5 text-white/35"
        }`}>
          Tool {dragMode === "none" ? "SELECT" : dragMode.toUpperCase()}
        </span>
        {averageSelectedVelocity !== null && (
          <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
            Avg Vel {averageSelectedVelocity}%
          </span>
        )}
        <span className="text-[9px] text-[var(--ed-text-muted)] ml-auto hidden lg:inline">
          Shift-click multi-select, Shift + Arrow Up/Down = octave, drag end for length, number keys set velocity
        </span>
      </div>

      {/* ─── MAIN GRID ────────────────────────────────────────────– */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Piano keys */}
        <div
          className="shrink-0 overflow-y-auto border-r border-[var(--ed-border)] bg-[#1a1816]"
          style={{ width: PIANO_WIDTH }}
        >
          {Array.from({ length: totalRows }, (_, i) => {
            const midi = baseNote + (totalRows - i - 1);
            const noteIdx = midi % 12;
            const noteName = NOTE_NAMES[noteIdx] ?? "?";
            const isBlack = OCTAVE_PATTERN[noteIdx]?.black ?? false;
            const isC = noteIdx === 0;
            const isScaleNote = isNoteInScale(midi, rootMidi, scaleName);

            return (
              <div
                key={i}
                onClick={() => handleKeyClick(midi)}
                className={`flex items-center justify-center text-[6px] font-bold tracking-wider cursor-pointer select-none border-b transition-all ${
                  isBlack
                    ? "hover:brightness-110"
                    : "hover:brightness-105"
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
                  boxShadow: isBlack ? "inset -2px 0 4px rgba(0,0,0,0.8)" : "inset 1px 1px 2px rgba(255,255,255,0.1), inset -1px -1px 2px rgba(0,0,0,0.3)",
                  borderLeft: isBlack ? "1px solid rgba(0,0,0,0.5)" : "none",
                  borderRight: isBlack ? "1px solid rgba(0,0,0,0.8)" : "none",
                  paddingTop: isBlack ? "2px" : "0px",
                }}
              >
                <span style={{ color: isBlack ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.35)" }}>
                  {!isBlack && noteName}
                </span>
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
          {/* Empty state */}
          {notes.length === 0 && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{ width: Math.max(gridW, 800), height: gridH }}
            >
              <div className="text-center text-white/20">
                <div className="text-[11px] font-semibold mb-1">Click to place notes</div>
                <div className="text-[8px] text-white/15">
                  Right-click to delete · Drag edges to resize
                </div>
              </div>
            </div>
          )}

          {/* Background grid */}
          <div className="relative" style={{ width: Math.max(gridW, 800), height: gridH + velocityLaneHeight }}>
            {/* Row stripes (notes grid) */}
            {Array.from({ length: totalRows }, (_, i) => {
              const midi = baseNote + (totalRows - i - 1);
              const isBlack = OCTAVE_PATTERN[midi % 12]?.black ?? false;
              const isScaleNote = isNoteInScale(midi, rootMidi, scaleName);

              return (
                <div
                  key={`row-${i}`}
                  className="absolute w-full border-b"
                  style={{
                    top: i * rowHeight,
                    height: rowHeight,
                    backgroundColor: isBlack
                      ? "rgba(26, 24, 22, 0.5)"
                      : scaleSnap && isScaleNote
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
                  className="absolute rounded-[3px] touch-none select-none transition-shadow"
                  style={{
                    left: x,
                    top: y + 1,
                    width: w,
                    height: rowHeight - 2,
                    background: `linear-gradient(180deg, ${noteColor}dd 0%, ${noteColor}99 100%)`,
                    opacity: 0.7 + note.velocity * 0.3,
                    border: isSel ? `2px solid rgba(255,255,255,0.85)` : `1px solid ${noteColor}55`,
                    boxShadow: isSel
                      ? `0 0 10px ${noteColor}50, inset 0 1px 2px rgba(255,255,255,0.25)`
                      : `inset 0 1px 2px rgba(255,255,255,0.12), 0 1px 3px rgba(0,0,0,0.4)`,
                    zIndex: isSel ? 10 : 1,
                    cursor: dragMode === "resize" ? "col-resize" : dragMode === "velocity" ? "ns-resize" : "grab",
                  }}
                >
                  {isSel && (
                    <div
                      className="absolute -inset-[2px] rounded-[6px] border border-white/25 pointer-events-none"
                      style={{ boxShadow: `0 0 12px ${noteColor}55` }}
                    />
                  )}

                  {/* Ghost outline when dragging */}
                  {dragMode === "move" && dragStartRef.current?.note.id === note.id && (
                    <div
                      className="absolute rounded-[4px] border border-dashed border-white/30 pointer-events-none"
                      style={{
                        left: -(dragStartRef.current.note.start * cellW - x),
                        top: -(dragStartRef.current.note.midi - note.midi) * rowHeight,
                        width: Math.max(12, dragStartRef.current.note.duration * cellW),
                        height: rowHeight - 2,
                      }}
                    />
                  )}

                  {/* Note name - show if width > 24px */}
                  {w > 24 && (
                    <div className="absolute left-1 right-2 top-0.5 flex items-center justify-between gap-1 pointer-events-none select-none">
                      <span className="truncate text-[6px] font-bold text-white/80 leading-none">
                        {midiNoteName(note.midi)}
                      </span>
                      {isSel && (
                        <span className="rounded bg-black/35 px-1 py-[1px] text-[6px] font-black text-white/70">
                          {Math.round(note.velocity * 100)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Velocity bar - colored by track, rounded top */}
                  <div
                    className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[2px] cursor-ns-resize transition-opacity hover:opacity-100"
                    style={{
                      backgroundColor: noteColor,
                      opacity: note.velocity * 0.7,
                    }}
                  />

                  {/* Resize handle */}
                  <div className={`absolute right-0 top-0 bottom-0 w-2 cursor-col-resize rounded-r-[3px] transition-colors ${
                    isSel ? "bg-white/25" : "opacity-0 hover:opacity-100 hover:bg-white/30"
                  }`} />
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
                height: velocityLaneHeight,
                backgroundColor: "rgba(0,0,0,0.15)",
              }}
            >
              {/* Velocity lane label */}
              <div className="absolute left-1 top-1 right-2 flex items-center justify-between text-[7px] font-bold pointer-events-none">
                <span className="text-white/30">VELOCITY LANE</span>
                <span className="text-white/20">drag bars or note footer to shape dynamics</span>
              </div>

              {[25, 50, 75, 100].map((pct) => (
                <div
                  key={`vel-grid-${pct}`}
                  className="absolute left-0 right-0 border-t border-white/6 pointer-events-none"
                  style={{ top: `${velocityLaneHeight - (velocityLaneHeight * pct) / 100}px` }}
                />
              ))}

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
                      dragStartRef.current = { x: e.clientX, y: e.clientY, note: { ...note }, originals: new Map() };
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={handleNotePointerMove}
                    onPointerUp={handleNotePointerUp}
                    className="absolute rounded-t-[3px] transition-opacity hover:opacity-100"
                    style={{
                      left: x,
                      top: velocityLaneHeight - h,
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
                height: gridH + velocityLaneHeight,
                background: `linear-gradient(90deg, ${accentColor}00, ${accentColor}, ${accentColor}00)`,
                boxShadow: `0 0 12px ${accentColor}60, inset 0 0 8px ${accentColor}40`,
              }}
            >
              {/* Beat number label */}
              <div
                className="absolute text-[7px] font-bold text-white/60 pointer-events-none whitespace-nowrap"
                style={{
                  left: "4px",
                  top: "-16px",
                  color: accentColor,
                }}
              >
                Beat {Math.floor(playheadBeat + 1)}
              </div>
            </div>

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
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/60 text-[8px] text-white/35">
        <div className="flex items-center gap-4 flex-1">
          {selectedNoteIds.size === 1 ? (
            (() => {
              const note = notes.find((n) => n.id === Array.from(selectedNoteIds)[0]);
              return note ? (
                <>
                  <span className="font-bold text-white/50">{midiNoteName(note.midi)}</span>
                  <span className="text-white/25">|</span>
                  <span>Beat <span className="text-white/50 font-mono">{note.start.toFixed(2)}</span></span>
                  <span className="text-white/25">|</span>
                  <span>Dur <span className="text-white/50 font-mono">{note.duration.toFixed(2)}</span></span>
                  <span className="text-white/25">|</span>
                  <span>Vel <span className="text-white/50 font-mono">{Math.round(note.velocity * 100)}%</span></span>
                  <span className="text-white/25">|</span>
                  <span>Track: <span className="text-white/50 font-bold">{note.track.toUpperCase()}</span></span>
                </>
              ) : null;
            })()
          ) : selectedNoteIds.size > 1 ? (
            <>
              <span className="font-bold text-white/50">{selectedNoteIds.size} notes selected</span>
              <span className="text-white/25">·</span>
              <span>Del to remove</span>
              <span className="text-white/25">·</span>
              <span>Ctrl+C copy</span>
              <span className="text-white/25">·</span>
              <span>Ctrl+V paste</span>
            </>
          ) : (
            <span className="text-white/30">
              Click to place notes · Right-click to delete · Drag to move · Shift+Drag to rubber band select
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
          <span style={{ color: accentColor }} className="font-bold">{target.toUpperCase()}</span>
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
        className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all hover:brightness-110"
        style={{
          backgroundColor: open ? accentColor : "rgba(255,255,255,0.05)",
          color: open ? "#000" : accentColor,
          border: `1px solid ${open ? accentColor : accentColor + "50"}`,
          boxShadow: open ? `0 0 8px ${accentColor}40` : "none",
        }}
      >
        HARMONY
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] bg-[#1a1a22] border border-[var(--ed-border)] rounded-lg shadow-2xl py-1 overflow-hidden">
          {HARMONY_PRESETS.map((preset) => {
            const showGroupHeader = preset.group !== lastGroup;
            lastGroup = preset.group;
            return (
              <React.Fragment key={preset.id}>
                {showGroupHeader && (
                  <div className="px-3 pt-2 pb-1 text-[6px] font-bold tracking-[0.2em] text-white/25 uppercase">
                    {preset.group}
                  </div>
                )}
                <button
                  onClick={() => { onGenerate(preset.id); setOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-[9px] text-white/70 hover:text-white hover:bg-white/8 transition-colors"
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
