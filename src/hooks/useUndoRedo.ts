/**
 * Global Undo/Redo across all sequencer engines.
 *
 * Tracks snapshot history of: drum pattern, bass steps, chords steps, melody steps.
 * Uses Zustand reference identity to detect mutations (avoids JSON.stringify overhead).
 */

import { useEffect, useRef, useCallback } from "react";
import { useDrumStore, type PatternData } from "../store/drumStore";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";
import type { BassStep } from "../audio/BassEngine";
import type { ChordsStep } from "../audio/ChordsEngine";
import type { MelodyStep } from "../audio/MelodyEngine";

const MAX_HISTORY = 50;

interface Snapshot {
  source: "drums" | "bass" | "chords" | "melody";
  pattern?: PatternData;
  bassSteps?: BassStep[];
  bassLength?: number;
  chordsSteps?: ChordsStep[];
  chordsLength?: number;
  melodySteps?: MelodyStep[];
  melodyLength?: number;
}

export function useUndoRedo() {
  const history = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const isUndoRedo = useRef(false);

  // Last-known refs per engine (used to build previous-state snapshots)
  const lastDrumPattern = useRef<PatternData | null>(null);
  const lastBassSteps = useRef<BassStep[] | null>(null);
  const lastBassLength = useRef<number>(0);
  const lastChordsSteps = useRef<ChordsStep[] | null>(null);
  const lastChordsLength = useRef<number>(0);
  const lastMelodySteps = useRef<MelodyStep[] | null>(null);
  const lastMelodyLength = useRef<number>(0);

  const pushHistory = useCallback((snap: Snapshot) => {
    history.current.push(snap);
    if (history.current.length > MAX_HISTORY) history.current.shift();
    future.current = [];
  }, []);

  useEffect(() => {
    // Initialize refs
    lastDrumPattern.current = useDrumStore.getState().pattern;
    lastBassSteps.current = useBassStore.getState().steps;
    lastBassLength.current = useBassStore.getState().length;
    lastChordsSteps.current = useChordsStore.getState().steps;
    lastChordsLength.current = useChordsStore.getState().length;
    lastMelodySteps.current = useMelodyStore.getState().steps;
    lastMelodyLength.current = useMelodyStore.getState().length;

    // Drums
    const unsubDrums = useDrumStore.subscribe((state, prevState) => {
      if (isUndoRedo.current) return;
      if (state.pattern === prevState.pattern) return;
      if (lastDrumPattern.current) {
        pushHistory({ source: "drums", pattern: lastDrumPattern.current });
      }
      lastDrumPattern.current = state.pattern;
    });

    // Bass
    const unsubBass = useBassStore.subscribe((state, prevState) => {
      if (isUndoRedo.current) return;
      if (state.steps === prevState.steps && state.length === prevState.length) return;
      if (lastBassSteps.current) {
        pushHistory({
          source: "bass",
          bassSteps: lastBassSteps.current,
          bassLength: lastBassLength.current,
        });
      }
      lastBassSteps.current = state.steps;
      lastBassLength.current = state.length;
    });

    // Chords
    const unsubChords = useChordsStore.subscribe((state, prevState) => {
      if (isUndoRedo.current) return;
      if (state.steps === prevState.steps && state.length === prevState.length) return;
      if (lastChordsSteps.current) {
        pushHistory({
          source: "chords",
          chordsSteps: lastChordsSteps.current,
          chordsLength: lastChordsLength.current,
        });
      }
      lastChordsSteps.current = state.steps;
      lastChordsLength.current = state.length;
    });

    // Melody
    const unsubMelody = useMelodyStore.subscribe((state, prevState) => {
      if (isUndoRedo.current) return;
      if (state.steps === prevState.steps && state.length === prevState.length) return;
      if (lastMelodySteps.current) {
        pushHistory({
          source: "melody",
          melodySteps: lastMelodySteps.current,
          melodyLength: lastMelodyLength.current,
        });
      }
      lastMelodySteps.current = state.steps;
      lastMelodyLength.current = state.length;
    });

    return () => {
      unsubDrums();
      unsubBass();
      unsubChords();
      unsubMelody();
    };
  }, [pushHistory]);

  const undo = useCallback(() => {
    const snap = history.current.pop();
    if (!snap) return;

    isUndoRedo.current = true;
    // Build future snapshot from current state BEFORE restoring
    if (snap.source === "drums") {
      const current = useDrumStore.getState().pattern;
      future.current.push({ source: "drums", pattern: current });
      useDrumStore.setState({ pattern: snap.pattern! });
      lastDrumPattern.current = snap.pattern!;
    } else if (snap.source === "bass") {
      const cur = useBassStore.getState();
      future.current.push({ source: "bass", bassSteps: cur.steps, bassLength: cur.length });
      useBassStore.setState({ steps: snap.bassSteps!, length: snap.bassLength! });
      lastBassSteps.current = snap.bassSteps!;
      lastBassLength.current = snap.bassLength!;
    } else if (snap.source === "chords") {
      const cur = useChordsStore.getState();
      future.current.push({ source: "chords", chordsSteps: cur.steps, chordsLength: cur.length });
      useChordsStore.setState({ steps: snap.chordsSteps!, length: snap.chordsLength! });
      lastChordsSteps.current = snap.chordsSteps!;
      lastChordsLength.current = snap.chordsLength!;
    } else if (snap.source === "melody") {
      const cur = useMelodyStore.getState();
      future.current.push({ source: "melody", melodySteps: cur.steps, melodyLength: cur.length });
      useMelodyStore.setState({ steps: snap.melodySteps!, length: snap.melodyLength! });
      lastMelodySteps.current = snap.melodySteps!;
      lastMelodyLength.current = snap.melodyLength!;
    }
    isUndoRedo.current = false;
  }, []);

  const redo = useCallback(() => {
    const snap = future.current.pop();
    if (!snap) return;

    isUndoRedo.current = true;
    if (snap.source === "drums") {
      const current = useDrumStore.getState().pattern;
      history.current.push({ source: "drums", pattern: current });
      useDrumStore.setState({ pattern: snap.pattern! });
      lastDrumPattern.current = snap.pattern!;
    } else if (snap.source === "bass") {
      const cur = useBassStore.getState();
      history.current.push({ source: "bass", bassSteps: cur.steps, bassLength: cur.length });
      useBassStore.setState({ steps: snap.bassSteps!, length: snap.bassLength! });
      lastBassSteps.current = snap.bassSteps!;
      lastBassLength.current = snap.bassLength!;
    } else if (snap.source === "chords") {
      const cur = useChordsStore.getState();
      history.current.push({ source: "chords", chordsSteps: cur.steps, chordsLength: cur.length });
      useChordsStore.setState({ steps: snap.chordsSteps!, length: snap.chordsLength! });
      lastChordsSteps.current = snap.chordsSteps!;
      lastChordsLength.current = snap.chordsLength!;
    } else if (snap.source === "melody") {
      const cur = useMelodyStore.getState();
      history.current.push({ source: "melody", melodySteps: cur.steps, melodyLength: cur.length });
      useMelodyStore.setState({ steps: snap.melodySteps!, length: snap.melodyLength! });
      lastMelodySteps.current = snap.melodySteps!;
      lastMelodyLength.current = snap.melodyLength!;
    }
    isUndoRedo.current = false;
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [undo, redo]);
}
