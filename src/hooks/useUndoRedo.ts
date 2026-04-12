/**
 * Undo/Redo for Pattern Edits
 *
 * Uses Zustand's reference identity to detect pattern changes
 * instead of JSON.stringify (was causing 6MB/s overhead during playback).
 */

import { useEffect, useRef, useCallback } from "react";
import { useDrumStore, type PatternData } from "../store/drumStore";

const MAX_HISTORY = 50;

export function useUndoRedo() {
  const history = useRef<PatternData[]>([]);
  const future = useRef<PatternData[]>([]);
  const isUndoRedo = useRef(false);
  const lastPatternRef = useRef<PatternData | null>(null);

  useEffect(() => {
    const unsub = useDrumStore.subscribe((state, prevState) => {
      if (isUndoRedo.current) return;

      // Compare by reference — Zustand creates new objects on mutation
      if (state.pattern === prevState.pattern) return;
      // Skip currentStep updates (playback doesn't change pattern ref)
      if (state.currentStep !== prevState.currentStep && state.pattern === prevState.pattern) return;

      // Push previous pattern to history
      if (lastPatternRef.current) {
        history.current.push(lastPatternRef.current);
        if (history.current.length > MAX_HISTORY) history.current.shift();
        future.current = [];
      }
      lastPatternRef.current = state.pattern;
    });

    lastPatternRef.current = useDrumStore.getState().pattern;
    return unsub;
  }, []);

  const undo = useCallback(() => {
    if (history.current.length === 0) return;
    const prev = history.current.pop()!;
    const current = useDrumStore.getState().pattern;
    future.current.push(current);

    isUndoRedo.current = true;
    useDrumStore.setState({ pattern: prev });
    lastPatternRef.current = prev;
    isUndoRedo.current = false;
  }, []);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    const next = future.current.pop()!;
    const current = useDrumStore.getState().pattern;
    history.current.push(current);

    isUndoRedo.current = true;
    useDrumStore.setState({ pattern: next });
    lastPatternRef.current = next;
    isUndoRedo.current = false;
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
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
