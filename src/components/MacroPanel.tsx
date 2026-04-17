/**
 * Macro Panel — 8 user-controlled knobs, each routable to up to 4 parameters.
 *
 * Click a macro tile to expand and edit its bindings.
 */

import { useCallback, useEffect, useState } from "react";
import { macros, MACRO_DESTINATIONS, type MacroDestination, type MacroSlot } from "../audio/Macros";

interface MacroPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MacroPanel({ isOpen, onClose }: MacroPanelProps) {
  const [slots, setSlots] = useState<ReadonlyArray<MacroSlot>>(macros.getSlots());
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = macros.subscribe(() => setSlots([...macros.getSlots()]));
    return () => { unsub(); };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const setValue = useCallback((idx: number, v: number) => {
    macros.setValue(idx, v);
    setSlots([...macros.getSlots()]);
  }, []);

  const setBindingDest = useCallback((slotIdx: number, bindIdx: number, dest: MacroDestination) => {
    macros.setBinding(slotIdx, bindIdx, { destination: dest });
    setSlots([...macros.getSlots()]);
  }, []);

  const toggleInvert = useCallback((slotIdx: number, bindIdx: number, current: boolean) => {
    macros.setBinding(slotIdx, bindIdx, { invert: !current });
    setSlots([...macros.getSlots()]);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5 w-[95vw] max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold tracking-wider">MACRO KNOBS</h2>
            <div className="text-[9px] text-[var(--ed-text-muted)]">
              8 meta-controls · Click a tile to route its bindings
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-lg px-2">×</button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {slots.map((slot, idx) => {
            const activeCount = slot.bindings.filter((b) => b.destination !== "none").length;
            const isExpanded = expanded === idx;
            return (
              <div
                key={idx}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-2 transition-colors hover:border-white/20"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[8px] font-bold text-white/60">{slot.name}</span>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : idx)}
                    className="text-[8px] text-white/30 hover:text-white/70"
                  >
                    {isExpanded ? "▲" : "▼"}
                  </button>
                </div>

                {/* Knob (vertical slider) */}
                <div className="flex items-center gap-2 mb-1">
                  <input
                    type="range"
                    min={0} max={1} step={0.005}
                    value={slot.value}
                    onChange={(e) => setValue(idx, parseFloat(e.target.value))}
                    className="flex-1 h-[6px] accent-[var(--ed-accent-orange)]"
                  />
                  <span className="text-[8px] font-mono text-white/50 w-8 text-right">
                    {Math.round(slot.value * 100)}
                  </span>
                </div>

                <div className="text-[7px] text-white/25">
                  {activeCount === 0 ? "no bindings" : `${activeCount} binding${activeCount > 1 ? "s" : ""}`}
                </div>

                {/* Expanded bindings editor */}
                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                    {slot.bindings.map((b, bIdx) => (
                      <div key={bIdx} className="flex items-center gap-1">
                        <span className="text-[7px] text-white/30 w-4">{bIdx + 1}</span>
                        <select
                          value={b.destination}
                          onChange={(e) => setBindingDest(idx, bIdx, e.target.value as MacroDestination)}
                          className="flex-1 h-5 px-1 text-[8px] bg-black/30 border border-white/15 rounded text-white/80"
                        >
                          {MACRO_DESTINATIONS.map((d) => (
                            <option key={d.id} value={d.id}>{d.label}</option>
                          ))}
                        </select>
                        {b.destination !== "none" && (
                          <button
                            onClick={() => toggleInvert(idx, bIdx, b.invert)}
                            className={`px-1 h-5 text-[7px] font-bold rounded ${
                              b.invert
                                ? "bg-[var(--ed-accent-orange)]/25 text-[var(--ed-accent-orange)]"
                                : "bg-white/5 text-white/30 hover:text-white/70"
                            }`}
                            title="Invert: 0→1 instead of 1→0"
                          >
                            INV
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 text-[8px] text-white/25">
          Tip: Macros stay at their last value even when you close this panel. Use them as snapshots during performance.
        </div>
      </div>
    </div>
  );
}
