/**
 * PatternVariationsBar — A/B/C/D quick-switch toolbar for live performance.
 *
 * Maps to scene slots 0-3 from the existing SceneStore so we don't duplicate
 * the snapshot infrastructure. The Scene system already handles:
 *   - structuredClone snapshot of all 4 sequencer states
 *   - quantized switching at bar boundary (queueScene + scheduler resolve)
 *   - hot-load via loadScene
 *
 * What this component adds:
 *   - Always-visible 4-button toolbar instead of a hidden Scene panel
 *   - Big touch targets (40×40 on iPad) so they're playable mid-jam
 *   - Visual state:
 *       empty  →  dimmed letter
 *       saved  →  outlined letter
 *       active →  filled orange + glow
 *       queued →  pulsing border (waiting for next bar to land)
 *   - Tap empty slot → captures current state into it (save snapshot)
 *   - Tap saved slot → queue switch (or immediate if launchQuantize = immediate)
 *   - Long-press saved slot → re-capture current state into that slot
 *   - Right-click / two-finger tap → clear that slot
 */

import { useEffect, useRef, useState } from "react";
import { useSceneStore } from "../store/sceneStore";
import { HintPopover } from "./Hints";

const SLOT_LABELS = ["A", "B", "C", "D"] as const;
const SLOTS = [0, 1, 2, 3] as const;
const LONG_PRESS_MS = 500;

export function PatternVariationsBar() {
  // Subscribe per-slot — each selector returns a primitive, so Zustand's
  // default identity comparison avoids re-renders unless a slot's
  // null/non-null state actually flipped. Selecting an array literal would
  // create a new reference every render and re-render unconditionally.
  const slotA = useSceneStore((s) => s.scenes[0] !== null);
  const slotB = useSceneStore((s) => s.scenes[1] !== null);
  const slotC = useSceneStore((s) => s.scenes[2] !== null);
  const slotD = useSceneStore((s) => s.scenes[3] !== null);
  const slotFilled = [slotA, slotB, slotC, slotD];
  const activeScene = useSceneStore((s) => s.activeScene);
  const nextScene = useSceneStore((s) => s.nextScene);
  const captureScene = useSceneStore((s) => s.captureScene);
  const queueScene = useSceneStore((s) => s.queueScene);
  const clearScene = useSceneStore((s) => s.clearScene);
  const updateScene = useSceneStore((s) => s.updateScene);

  // Long-press detection per slot
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpFired = useRef(false);
  const [recentlySaved, setRecentlySaved] = useState<number | null>(null);
  // Anchor for the contextual hint — points at the VAR label so first-time
  // users understand what these buttons do.
  const [labelAnchor, setLabelAnchor] = useState<HTMLElement | null>(null);
  // Auto-dismiss the hint once they've actually saved any variation.
  const anySlotFilled = slotA || slotB || slotC || slotD;

  function startLongPress(slot: number) {
    cancelLongPress();
    lpFired.current = false;
    lpTimer.current = setTimeout(() => {
      lpTimer.current = null;
      lpFired.current = true;
      // Re-capture into already-saved slot, else capture into empty slot.
      // Either way: the resulting state is "this slot now holds the current performance".
      if (slotFilled[slot]) updateScene(slot);
      else captureScene(slot);
      setRecentlySaved(slot);
      setTimeout(() => setRecentlySaved((s) => (s === slot ? null : s)), 600);
      // Light haptic if available
      if (navigator.vibrate) navigator.vibrate(20);
    }, LONG_PRESS_MS);
  }
  function cancelLongPress() {
    if (lpTimer.current) {
      clearTimeout(lpTimer.current);
      lpTimer.current = null;
    }
  }

  function handleClick(slot: number) {
    if (lpFired.current) {
      lpFired.current = false;
      return;
    }
    if (slotFilled[slot]) {
      queueScene(slot);
    } else {
      // First click on empty slot saves the current performance.
      captureScene(slot);
      setRecentlySaved(slot);
      setTimeout(() => setRecentlySaved((s) => (s === slot ? null : s)), 600);
    }
  }

  function handleContextMenu(e: React.MouseEvent, slot: number) {
    e.preventDefault();
    if (slotFilled[slot]) clearScene(slot);
  }

  useEffect(() => () => cancelLongPress(), []);

  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <span
        ref={setLabelAnchor}
        className="text-[8px] font-bold tracking-[0.3em] uppercase text-white/35 mr-1 select-none"
        title="Pattern Variations — tap empty to save, tap saved to switch (quantised), long-press to overwrite"
      >
        VAR
      </span>
      <HintPopover
        id="pattern-variations"
        anchor={labelAnchor}
        position="bottom"
        title="Pattern Variations A/B/C/D"
        body="Tap an empty slot to snapshot the current performance. Tap a saved slot to switch at the next bar. Long-press overwrites."
        triggered={anySlotFilled}
      />
      {SLOTS.map((slot) => {
        const filled = slotFilled[slot];
        const isActive = activeScene === slot;
        const isQueued = nextScene === slot;
        const justSaved = recentlySaved === slot;

        const base = "relative w-9 h-7 rounded-md text-[11px] font-black tracking-wide select-none transition-all";
        const visual = isActive
          ? "bg-[var(--ed-accent-orange)] text-black shadow-[0_0_8px_var(--ed-accent-orange)]"
          : isQueued
            ? "bg-white/10 text-[var(--ed-accent-orange)] border border-[var(--ed-accent-orange)] animate-pulse"
            : filled
              ? "bg-white/8 text-white border border-white/20 hover:bg-white/15"
              : "bg-transparent text-white/30 border border-white/10 hover:border-white/25 hover:text-white/60";
        const saveFlash = justSaved ? "ring-2 ring-green-400 ring-offset-1 ring-offset-[#0a0a0c]" : "";

        return (
          <button
            key={slot}
            onClick={() => handleClick(slot)}
            onPointerDown={() => startLongPress(slot)}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onContextMenu={(e) => handleContextMenu(e, slot)}
            className={`${base} ${visual} ${saveFlash}`}
            title={
              filled
                ? isActive
                  ? `Variation ${SLOT_LABELS[slot]} — playing (long-press to overwrite, right-click clears)`
                  : `Variation ${SLOT_LABELS[slot]} — tap to queue, long-press to overwrite`
                : `Empty slot ${SLOT_LABELS[slot]} — tap to save current performance`
            }
          >
            {SLOT_LABELS[slot]}
          </button>
        );
      })}
    </div>
  );
}
