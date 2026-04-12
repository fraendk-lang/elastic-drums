/**
 * Undo/Redo for Pattern Edits
 *
 * Subscribes to Zustand store changes and maintains a history stack.
 * Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Shift+Z (redo)
 */

import { useEffect, useRef, useCallback } from "react";
import { useDrumStore, type PatternData } from "../store/drumStore";

const MAX_HISTORY = 50;

export function useUndoRedo() {
  const history = useRef<PatternData[]>([]);
  const future = useRef<PatternData[]>([]);
  const isUndoRedo = useRef(false);
  const lastPatternJson = useRef("");

  // Track pattern changes
  useEffect(() => {
    const unsub = useDrumStore.subscribe((state) => {
      if (isUndoRedo.current) return;

      const json = JSON.stringify(state.pattern);
      if (json === lastPatternJson.current) return;

      // Push current state to history
      if (lastPatternJson.current) {
        const prev = JSON.parse(lastPatternJson.current) as PatternData;
        history.current.push(prev);
        if (history.current.length > MAX_HISTORY) history.current.shift();
        future.current = []; // Clear redo stack on new edit
      }
      lastPatternJson.current = json;
    });

    // Initialize
    lastPatternJson.current = JSON.stringify(useDrumStore.getState().pattern);

    return unsub;
  }, []);

  const undo = useCallback(() => {
    if (history.current.length === 0) return;

    const prev = history.current.pop()!;
    const current = useDrumStore.getState().pattern;
    future.current.push(structuredClone(current));

    isUndoRedo.current = true;
    useDrumStore.setState({ pattern: prev });
    lastPatternJson.current = JSON.stringify(prev);
    isUndoRedo.current = false;
  }, []);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;

    const next = future.current.pop()!;
    const current = useDrumStore.getState().pattern;
    history.current.push(structuredClone(current));

    isUndoRedo.current = true;
    useDrumStore.setState({ pattern: next });
    lastPatternJson.current = JSON.stringify(next);
    isUndoRedo.current = false;
  }, []);

  // Keyboard shortcuts
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

  return {
    undo,
    redo,
    canUndo: () => history.current.length > 0,
    canRedo: () => future.current.length > 0,
  };
}
