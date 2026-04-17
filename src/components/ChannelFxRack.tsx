/**
 * Channel FX Rack — per-channel insert FX chain editor.
 *
 * Opens as a modal showing one channel's FX chain. Users can:
 * - Add new FX slots from a catalog
 * - Reorder via drag & drop
 * - Remove slots
 * - Edit parameters via sliders
 */

import { useCallback, useEffect, useState } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { FX_CATALOG, type FxType, type FxSlot } from "../audio/FxChain";

interface ChannelFxRackProps {
  channelIndex: number | null;
  channelLabel: string;
  channelColor: string;
  onClose: () => void;
}

export function ChannelFxRack({ channelIndex, channelLabel, channelColor, onClose }: ChannelFxRackProps) {
  const [, forceUpdate] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  const chain = channelIndex !== null ? audioEngine.getChannelFxChain(channelIndex) : null;
  const slots = chain?.getSlots() ?? [];

  useEffect(() => {
    if (channelIndex === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [channelIndex, onClose]);

  const addFx = useCallback((type: FxType) => {
    if (!chain) return;
    chain.addSlot(type);
    refresh();
  }, [chain, refresh]);

  const removeFx = useCallback((id: string) => {
    if (!chain) return;
    chain.removeSlot(id);
    refresh();
  }, [chain, refresh]);

  const moveFx = useCallback((from: number, to: number) => {
    if (!chain) return;
    chain.moveSlot(from, to);
    refresh();
  }, [chain, refresh]);

  const setParam = useCallback((slot: FxSlot, paramId: string, value: number) => {
    slot.setParam(paramId, value);
    refresh();
  }, [refresh]);

  if (channelIndex === null) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5 w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold tracking-wider">
              FX RACK — <span style={{ color: channelColor }}>{channelLabel}</span>
            </h2>
            <div className="text-[9px] text-[var(--ed-text-muted)]">
              Insert FX chain · Drag to reorder · Click + to add
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-lg px-2">×</button>
        </div>

        {/* FX catalog (add buttons) */}
        <div className="flex flex-wrap gap-1.5 mb-4 pb-3 border-b border-white/8">
          <span className="text-[8px] text-white/30 font-bold self-center mr-2">ADD:</span>
          {FX_CATALOG.map((fx) => (
            <button
              key={fx.type}
              onClick={() => addFx(fx.type)}
              className="px-2 py-1 text-[9px] font-bold rounded bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-colors border border-white/10"
            >
              + {fx.label}
            </button>
          ))}
        </div>

        {/* Chain */}
        <div className="space-y-2">
          {slots.length === 0 && (
            <div className="text-center py-8 text-white/25 text-[10px]">
              No FX in chain. Click an "ADD" button above to insert one.
            </div>
          )}
          {slots.map((slot, idx) => {
            const meta = FX_CATALOG.find((m) => m.type === slot.type)!;
            return (
              <div
                key={slot.id}
                draggable
                onDragStart={(e) => {
                  setDragIndex(idx);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dragIndex !== idx) moveFx(dragIndex, idx);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className="border border-white/10 rounded-lg bg-white/[0.02] p-3 hover:border-white/20 transition-colors cursor-grab active:cursor-grabbing"
                style={{
                  opacity: dragIndex === idx ? 0.4 : 1,
                  borderLeft: `3px solid ${channelColor}`,
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-white/25">#{idx + 1}</span>
                    <span className="text-[11px] font-bold" style={{ color: channelColor }}>
                      {meta.label}
                    </span>
                  </div>
                  <button
                    onClick={() => removeFx(slot.id)}
                    className="text-[9px] text-red-400/50 hover:text-red-400 font-bold"
                  >
                    REMOVE
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {meta.params.map((p) => {
                    const value = slot.params[p.id] ?? p.default;
                    return (
                      <div key={p.id}>
                        <div className="flex items-center justify-between text-[8px] font-bold mb-0.5">
                          <span className="text-white/50">{p.label}</span>
                          <span className="font-mono text-white/70">
                            {value.toFixed(p.max >= 100 ? 0 : 2)}{p.unit ? ` ${p.unit}` : ""}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={p.min} max={p.max}
                          step={(p.max - p.min) / 200}
                          value={value}
                          onChange={(e) => setParam(slot, p.id, parseFloat(e.target.value))}
                          className="w-full h-[6px]"
                          style={{ accentColor: channelColor }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
