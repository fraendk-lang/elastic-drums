/**
 * Hints — contextual "press here" tooltips for hard-to-find features.
 *
 * Each hint is registered with a unique id + target element ref + content.
 * When the target mounts and the hint hasn't been dismissed, a small
 * popover with an arrow points at the element. The user dismisses with ×
 * (one-time, persisted in localStorage) or interacts with the target which
 * also auto-dismisses.
 *
 * "Replay tour" — clears all dismissals so hints reappear. Exposed via
 * resetAllHints() which can be called from a settings menu.
 */

import { useEffect, useState, useRef } from "react";

const STORAGE_KEY = "eg-hints-dismissed-v1";

// ────────────────────────────────────────────────────────────────────────
// Persistence
// ────────────────────────────────────────────────────────────────────────

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : []);
  } catch { return new Set(); }
}

function saveDismissed(set: Set<string>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); }
  catch { /* private mode — no-op */ }
}

const dismissed: Set<string> = loadDismissed();
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) fn();
}

export function isDismissed(id: string): boolean {
  return dismissed.has(id);
}

export function dismissHint(id: string): void {
  if (dismissed.has(id)) return;
  dismissed.add(id);
  saveDismissed(dismissed);
  notify();
}

/** Reset all hints — replay-tour entry point */
export function resetAllHints(): void {
  dismissed.clear();
  saveDismissed(dismissed);
  notify();
}

// ────────────────────────────────────────────────────────────────────────
// useHint — visibility hook for a single hint
// ────────────────────────────────────────────────────────────────────────

export interface HintConfig {
  id: string;
  /** Whether the hint should attempt to render — caller can gate on app state. */
  enabled?: boolean;
  /** Auto-dismiss when this becomes true (e.g., user clicked the target). */
  triggered?: boolean;
}

/**
 * Returns true while the hint should be visible. Auto-dismisses when
 * `triggered` becomes true (so the hint disappears once the user
 * interacts with the target).
 */
export function useHint({ id, enabled = true, triggered = false }: HintConfig): {
  visible: boolean;
  dismiss: () => void;
} {
  const [, force] = useState(0);
  useEffect(() => {
    const cb = () => force((n) => n + 1);
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);

  // Auto-dismiss when triggered
  useEffect(() => {
    if (triggered && !isDismissed(id)) dismissHint(id);
  }, [triggered, id]);

  return {
    visible: enabled && !isDismissed(id),
    dismiss: () => dismissHint(id),
  };
}

// ────────────────────────────────────────────────────────────────────────
// HintPopover — visual tooltip with arrow
// ────────────────────────────────────────────────────────────────────────

type Position = "top" | "bottom" | "left" | "right";

interface HintPopoverProps {
  id: string;
  /** Anchor element to position relative to. Pass null while target isn't mounted. */
  anchor: HTMLElement | null | undefined;
  /** Side of the anchor where the popover points. */
  position?: Position;
  /** Title (one line, max ~30 chars) */
  title: string;
  /** Body — supports plain text or simple inline markup */
  body: string;
  /** Optional flag to gate rendering (e.g., only show when a panel is open) */
  enabled?: boolean;
  /** When this becomes true, auto-dismiss the hint */
  triggered?: boolean;
}

/**
 * Positioned tooltip that points at a target element. Renders nothing if
 * the hint has been dismissed or the anchor isn't available yet.
 */
export function HintPopover({
  id, anchor, position = "bottom", title, body, enabled, triggered,
}: HintPopoverProps) {
  const { visible, dismiss } = useHint({ id, enabled, triggered });
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!visible || !anchor) {
      setCoords(null);
      return;
    }
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const popover = popoverRef.current;
      const PW = popover?.offsetWidth ?? 240;
      const PH = popover?.offsetHeight ?? 80;
      const PADDING = 12;
      let top: number, left: number;
      switch (position) {
        case "top":    top = rect.top - PH - PADDING;             left = rect.left + rect.width / 2 - PW / 2; break;
        case "bottom": top = rect.bottom + PADDING;               left = rect.left + rect.width / 2 - PW / 2; break;
        case "left":   top = rect.top + rect.height / 2 - PH / 2; left = rect.left - PW - PADDING; break;
        case "right":  top = rect.top + rect.height / 2 - PH / 2; left = rect.right + PADDING; break;
      }
      // Clamp to viewport
      top = Math.max(8, Math.min(window.innerHeight - PH - 8, top));
      left = Math.max(8, Math.min(window.innerWidth - PW - 8, left));
      setCoords({ top, left });
    };
    updatePosition();
    // Re-position on resize / scroll
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    // Also re-measure once after the popover renders (need its real size)
    const raf = requestAnimationFrame(updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      cancelAnimationFrame(raf);
    };
  }, [visible, anchor, position]);

  if (!visible || !coords) return null;

  return (
    <div
      ref={popoverRef}
      className="fixed z-[200] max-w-[260px] rounded-lg border border-[var(--ed-accent-orange)]/40 bg-[#0d0d12]/95 backdrop-blur-md shadow-2xl px-3 py-2.5"
      style={{ top: coords.top, left: coords.left, boxShadow: "0 12px 36px rgba(0,0,0,0.6)" }}
      role="tooltip"
    >
      {/* Pointer arrow — small triangle on the side facing the anchor */}
      <div
        className="absolute w-2.5 h-2.5 bg-[#0d0d12] border-[var(--ed-accent-orange)]/40"
        style={{
          ...(position === "bottom" && { top: -5, left: "calc(50% - 5px)", borderTop: "1px solid", borderLeft: "1px solid", transform: "rotate(45deg)" }),
          ...(position === "top"    && { bottom: -5, left: "calc(50% - 5px)", borderBottom: "1px solid", borderRight: "1px solid", transform: "rotate(45deg)" }),
          ...(position === "right"  && { left: -5, top: "calc(50% - 5px)", borderBottom: "1px solid", borderLeft: "1px solid", transform: "rotate(45deg)" }),
          ...(position === "left"   && { right: -5, top: "calc(50% - 5px)", borderTop: "1px solid", borderRight: "1px solid", transform: "rotate(45deg)" }),
        }}
      />
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-[var(--ed-accent-orange)] mb-1">
            {title}
          </div>
          <div className="text-[11px] leading-snug text-white/75">
            {body}
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss hint"
          className="shrink-0 -mr-1 -mt-1 px-1.5 py-0.5 text-white/40 hover:text-white/80 text-sm leading-none"
        >
          ×
        </button>
      </div>
    </div>
  );
}
