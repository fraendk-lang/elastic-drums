/**
 * Macro Panel — 8 user-controlled premium knobs, each routable to up to 4 parameters.
 *
 * Click a macro tile to expand and edit its bindings.
 */

import { useCallback, useEffect, useState } from "react";
import { macros, MACRO_DESTINATIONS, type MacroDestination, type MacroSlot } from "../audio/Macros";
import { Knob } from "./Knob";

interface MacroPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// Accent color for macro knobs — purple/violet like the image
const MACRO_COLOR = "#7c6ef5";

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
    macros.setValue(idx, v);         // v is already normalized 0..1
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
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-6 w-[95vw] max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-bold tracking-[0.15em] text-white">MACRO KNOBS</h2>
            <div className="text-[9px] text-[var(--ed-text-muted)] mt-0.5">
              8 meta-controls · Click a tile to route its bindings
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl px-2 leading-none">×</button>
        </div>

        {/* Knob grid — 4 × 2 */}
        <div className="grid grid-cols-4 gap-4">
          {slots.map((slot, idx) => {
            const activeCount = slot.bindings.filter((b) => b.destination !== "none").length;
            const isExpanded = expanded === idx;
            return (
              <div
                key={idx}
                className="rounded-lg border transition-colors"
                style={{
                  borderColor: isExpanded ? `${MACRO_COLOR}55` : "rgba(255,255,255,0.08)",
                  background:  isExpanded ? `${MACRO_COLOR}08` : "rgba(255,255,255,0.02)",
                  padding: "12px 10px 10px",
                }}
              >
                {/* Slot name + expand toggle */}
                <div className="flex items-center justify-between mb-3 px-1">
                  <span
                    className="text-[8px] font-bold tracking-widest uppercase"
                    style={{ color: MACRO_COLOR + "cc" }}
                  >
                    {slot.name}
                  </span>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : idx)}
                    className="text-[8px] text-white/25 hover:text-white/60 transition-colors"
                    title="Edit bindings"
                  >
                    {isExpanded ? "▲" : "▼"}
                  </button>
                </div>

                {/* Premium Knob */}
                <div className="flex justify-center">
                  <Knob
                    value={Math.round(slot.value * 100)}
                    min={0}
                    max={100}
                    defaultValue={50}
                    label={`M${idx + 1}`}
                    color={MACRO_COLOR}
                    size={72}
                    ticks={13}
                    bezel={true}
                    onChange={(v) => setValue(idx, v / 100)}
                  />
                </div>

                {/* Binding count badge */}
                <div className="text-center mt-2">
                  <span
                    className="text-[7px] font-semibold px-1.5 py-0.5 rounded"
                    style={{
                      color:      activeCount > 0 ? MACRO_COLOR : "rgba(255,255,255,0.2)",
                      background: activeCount > 0 ? `${MACRO_COLOR}18` : "transparent",
                    }}
                  >
                    {activeCount === 0 ? "no bindings" : `${activeCount} binding${activeCount > 1 ? "s" : ""}`}
                  </span>
                </div>

                {/* Bindings editor (expanded) */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-1.5">
                    {slot.bindings.map((b, bIdx) => (
                      <div key={bIdx} className="flex items-center gap-1">
                        <span className="text-[7px] text-white/25 w-4 shrink-0">{bIdx + 1}</span>
                        <select
                          value={b.destination}
                          onChange={(e) => setBindingDest(idx, bIdx, e.target.value as MacroDestination)}
                          className="flex-1 h-5 px-1 text-[8px] bg-black/40 border border-white/10 rounded text-white/75 outline-none focus:border-white/25"
                        >
                          {MACRO_DESTINATIONS.map((d) => (
                            <option key={d.id} value={d.id}>{d.label}</option>
                          ))}
                        </select>
                        {b.destination !== "none" && (
                          <button
                            onClick={() => toggleInvert(idx, bIdx, b.invert)}
                            className="px-1 h-5 text-[7px] font-bold rounded transition-colors shrink-0"
                            style={{
                              background: b.invert ? `${MACRO_COLOR}28` : "rgba(255,255,255,0.04)",
                              color:      b.invert ? MACRO_COLOR      : "rgba(255,255,255,0.3)",
                            }}
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

        <div className="mt-4 text-[8px] text-white/20">
          Tip: Macros stay at their last value even when you close this panel. Use them as snapshots during live performance.
        </div>
      </div>
    </div>
  );
}
