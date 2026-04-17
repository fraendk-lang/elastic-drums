/**
 * Mod Matrix Editor — LFO → any synth parameter routing.
 *
 * Shows 4 modulation slots, each with source (LFO shape + rate),
 * destination (dropdown), depth, and on/off toggle.
 */

import { useCallback, useEffect, useState } from "react";
import { modMatrix, MOD_DESTINATIONS, type ModDestination, type ModSlot } from "../audio/ModMatrix";

interface ModMatrixEditorProps {
  isOpen: boolean;
  onClose: () => void;
}

const LFO_SHAPES = ["sine", "triangle", "saw", "square", "ramp-up", "ramp-down"] as const;

export function ModMatrixEditor({ isOpen, onClose }: ModMatrixEditorProps) {
  const [slots, setSlots] = useState<ReadonlyArray<ModSlot>>(modMatrix.getSlots());

  useEffect(() => {
    if (!isOpen) return;
    const unsub = modMatrix.subscribe(() => setSlots([...modMatrix.getSlots()]));
    return () => { unsub(); };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const update = useCallback((idx: number, patch: Partial<ModSlot>) => {
    modMatrix.updateSlot(idx, patch);
    setSlots([...modMatrix.getSlots()]);
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
            <h2 className="text-sm font-bold tracking-wider">MOD MATRIX</h2>
            <div className="text-[9px] text-[var(--ed-text-muted)]">
              4 LFO slots · Route any source to any parameter
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-lg px-2">×</button>
        </div>

        <div className="space-y-2">
          {slots.map((slot, idx) => (
            <div
              key={idx}
              className="grid grid-cols-12 gap-2 items-center rounded-lg border border-white/10 bg-white/[0.02] p-3"
              style={{ opacity: slot.enabled ? 1 : 0.55 }}
            >
              {/* Enable */}
              <button
                onClick={() => update(idx, { enabled: !slot.enabled })}
                className={`col-span-1 h-8 rounded text-[9px] font-bold tracking-wider transition-colors ${
                  slot.enabled
                    ? "bg-[var(--ed-accent-green)]/25 text-[var(--ed-accent-green)]"
                    : "bg-white/5 text-white/30"
                }`}
              >
                {slot.enabled ? "ON" : "OFF"}
              </button>

              {/* Slot index */}
              <div className="col-span-1 text-[9px] font-bold text-white/30 text-center">
                LFO {idx + 1}
              </div>

              {/* Shape */}
              <div className="col-span-2">
                <label className="text-[7px] text-white/30 font-bold block mb-0.5">SHAPE</label>
                <select
                  value={slot.source.shape}
                  onChange={(e) => update(idx, { source: { ...slot.source, shape: e.target.value as typeof LFO_SHAPES[number] } })}
                  className="w-full h-6 px-1 text-[9px] bg-black/30 border border-white/15 rounded text-white/80"
                >
                  {LFO_SHAPES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Rate */}
              <div className="col-span-2">
                <label className="text-[7px] text-white/30 font-bold block mb-0.5">
                  RATE <span className="text-white/50">{slot.source.rate.toFixed(2)}Hz</span>
                </label>
                <input
                  type="range"
                  min={0.05} max={10} step={0.05}
                  value={slot.source.rate}
                  onChange={(e) => update(idx, { source: { ...slot.source, rate: parseFloat(e.target.value) } })}
                  className="w-full h-[6px]"
                />
              </div>

              {/* Arrow */}
              <div className="col-span-1 text-center text-white/30 text-[10px]">→</div>

              {/* Destination */}
              <div className="col-span-3">
                <label className="text-[7px] text-white/30 font-bold block mb-0.5">DEST</label>
                <select
                  value={slot.destination}
                  onChange={(e) => update(idx, { destination: e.target.value as ModDestination })}
                  className="w-full h-6 px-1 text-[9px] bg-black/30 border border-white/15 rounded text-white/80"
                >
                  {MOD_DESTINATIONS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </div>

              {/* Depth */}
              <div className="col-span-2">
                <label className="text-[7px] text-white/30 font-bold block mb-0.5">
                  DEPTH <span className="text-white/50">
                    {slot.depth > 0 ? `+${(slot.depth * 100).toFixed(0)}` : (slot.depth * 100).toFixed(0)}%
                  </span>
                </label>
                <input
                  type="range"
                  min={-1} max={1} step={0.01}
                  value={slot.depth}
                  onChange={(e) => update(idx, { depth: parseFloat(e.target.value) })}
                  onDoubleClick={() => update(idx, { depth: 0 })}
                  className="w-full h-[6px]"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 text-[8px] text-white/25">
          Tip: Double-click DEPTH to reset to 0. Negative depth inverts the LFO. Changing DEST re-captures the current parameter value as center.
        </div>
      </div>
    </div>
  );
}
