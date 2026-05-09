/**
 * StepEditPopover — touch-friendly editor for step modifiers.
 *
 * On desktop, the user right-clicks a step and right-click-cycles velocity
 * (Shift = ratchet, Alt = condition, Shift+Alt = gate). On iPad there is no
 * right-click, so a long-press opens this popover instead, exposing all four
 * modifier rows as tappable chips.
 *
 * The popover positions itself above (or below) the anchor step button and
 * dismisses on outside-tap or × button. Changes apply instantly so the
 * sequencer LED updates as the user taps.
 */

import { useEffect, useRef, useState } from "react";
import type { ConditionType } from "../store/drumStore";

const VELOCITY_LEVELS: Array<{ v: number; label: string }> = [
  { v: 127, label: "F" },   // Forte (full)
  { v: 100, label: "MF" },  // Mezzo-forte
  { v: 70,  label: "MP" },  // Mezzo-piano
  { v: 40,  label: "P" },   // Piano (ghost)
];

const RATCHET_LEVELS = [1, 2, 3, 4, 6, 8];

const CONDITION_LIST: ConditionType[] = [
  "always", "prob", "fill", "!fill", "pre", "!pre", "nei", "!nei",
  "1st", "!1st", "2:2", "3:3", "4:4", "2:3", "2:4", "3:4",
];

const GATE_LEVELS = [1.0, 0.75, 0.5, 0.25, 0.125];

export interface StepEditState {
  velocity: number;
  ratchetCount: number;
  condition: ConditionType;
  gateLength: number;
}

interface Props {
  /** Anchor element (the step button) — popover positions relative to it. */
  anchor: HTMLElement | null;
  /** Current step values; popover highlights the active chips. */
  state: StepEditState;
  onVelocity: (v: number) => void;
  onRatchet: (r: number) => void;
  onCondition: (c: ConditionType) => void;
  onGateLength: (g: number) => void;
  onClose: () => void;
}

export function StepEditPopover({ anchor, state, onVelocity, onRatchet, onCondition, onGateLength, onClose }: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; pointDown: boolean } | null>(null);

  // ── Position above (preferred) or below the step ──
  useEffect(() => {
    if (!anchor) return;
    function reposition() {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const pop = popRef.current;
      const PW = pop?.offsetWidth ?? 280;
      const PH = pop?.offsetHeight ?? 220;
      const PADDING = 10;
      // Prefer above unless not enough room
      const aboveTop = rect.top - PH - PADDING;
      const belowTop = rect.bottom + PADDING;
      const useAbove = aboveTop >= 8;
      const top = useAbove ? aboveTop : belowTop;
      let left = rect.left + rect.width / 2 - PW / 2;
      // Clamp to viewport
      left = Math.max(8, Math.min(window.innerWidth - PW - 8, left));
      const clampedTop = Math.max(8, Math.min(window.innerHeight - PH - 8, top));
      setCoords({ top: clampedTop, left, pointDown: useAbove });
    }
    reposition();
    const raf = requestAnimationFrame(reposition);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchor]);

  // ── Outside-tap to dismiss ──
  useEffect(() => {
    function onDocPointer(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (popRef.current && !popRef.current.contains(t) && anchor !== t && !anchor?.contains(t)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  if (!anchor || !coords) return null;

  return (
    <div
      ref={popRef}
      className="fixed z-[180] rounded-xl border border-[var(--ed-accent-orange)]/40 bg-[#0d0d12]/97 backdrop-blur-md shadow-2xl px-3 py-2.5 w-[280px]"
      style={{ top: coords.top, left: coords.left, boxShadow: "0 16px 48px rgba(0,0,0,0.7)" }}
      role="dialog"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[9px] font-black tracking-[0.2em] uppercase text-[var(--ed-accent-orange)]">
          Edit Step
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-white/40 hover:text-white text-base leading-none px-1 -mr-1"
        >
          ×
        </button>
      </div>

      {/* Velocity */}
      <Row label="Velocity">
        {VELOCITY_LEVELS.map(({ v, label }) => (
          <Chip key={v} active={Math.abs(state.velocity - v) < 4} onClick={() => onVelocity(v)}>
            {label}
          </Chip>
        ))}
      </Row>

      {/* Ratchet */}
      <Row label="Ratchet">
        {RATCHET_LEVELS.map((r) => (
          <Chip key={r} active={state.ratchetCount === r} onClick={() => onRatchet(r)}>
            {r === 1 ? "1×" : `${r}×`}
          </Chip>
        ))}
      </Row>

      {/* Condition */}
      <Row label="Condition">
        <div className="flex flex-wrap gap-1">
          {CONDITION_LIST.map((c) => (
            <Chip key={c} active={state.condition === c} onClick={() => onCondition(c)}>
              {c}
            </Chip>
          ))}
        </div>
      </Row>

      {/* Gate length */}
      <Row label="Gate">
        {GATE_LEVELS.map((g) => (
          <Chip
            key={g}
            active={Math.abs(state.gateLength - g) < 0.05}
            onClick={() => onGateLength(g)}
          >
            {g === 1 ? "FULL" : g === 0.125 ? "1/8" : g === 0.25 ? "1/4" : g === 0.5 ? "1/2" : "3/4"}
          </Chip>
        ))}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-[8px] font-bold tracking-[0.15em] uppercase text-white/45 mb-1">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded-md text-[10px] font-bold tracking-wide border transition-colors ${
        active
          ? "bg-[var(--ed-accent-orange)] text-black border-[var(--ed-accent-orange)]"
          : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
