/**
 * MIDI Learn Panel — assign external MIDI CC controllers to app parameters.
 *
 * Workflow:
 *   1. Click an "Assign" button → enters learn mode for that target
 *   2. Move a knob on your MIDI controller → next incoming CC becomes mapped
 *   3. Mapping persists in memory for the session
 */

import { useCallback, useEffect, useState } from "react";
import { getCcMappings, setCcLearnTarget, clearCcMapping, type CcDestination } from "../hooks/useMidi";

interface MidiLearnPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const TARGETS: { label: string; dest: CcDestination }[] = [
  { label: "Macro 1", dest: { kind: "macro", index: 0 } },
  { label: "Macro 2", dest: { kind: "macro", index: 1 } },
  { label: "Macro 3", dest: { kind: "macro", index: 2 } },
  { label: "Macro 4", dest: { kind: "macro", index: 3 } },
  { label: "Macro 5", dest: { kind: "macro", index: 4 } },
  { label: "Macro 6", dest: { kind: "macro", index: 5 } },
  { label: "Macro 7", dest: { kind: "macro", index: 6 } },
  { label: "Macro 8", dest: { kind: "macro", index: 7 } },
  { label: "Crossfader", dest: { kind: "crossfader" } },
  { label: "Reverb Level", dest: { kind: "reverb" } },
  { label: "Delay Level", dest: { kind: "delay" } },
];

function destLabel(d: CcDestination): string {
  switch (d.kind) {
    case "macro": return `Macro ${d.index + 1}`;
    case "crossfader": return "Crossfader";
    case "reverb": return "Reverb Level";
    case "delay": return "Delay Level";
    case "channel-volume": return `Ch ${d.channel + 1} Vol`;
  }
}

function destKey(d: CcDestination): string {
  switch (d.kind) {
    case "macro": return `macro.${d.index}`;
    case "channel-volume": return `ch.${d.channel}`;
    default: return d.kind;
  }
}

export function MidiLearnPanel({ isOpen, onClose }: MidiLearnPanelProps) {
  const [learning, setLearning] = useState<string | null>(null);
  const [mappings, setMappings] = useState(getCcMappings());

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Poll mappings every 200ms while learning (new CC could arrive)
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setMappings(getCcMappings()), 250);
    return () => clearInterval(id);
  }, [isOpen]);

  const startLearn = useCallback((label: string, dest: CcDestination) => {
    setCcLearnTarget(dest);
    setLearning(label);
  }, []);

  const cancelLearn = useCallback(() => {
    setCcLearnTarget(null);
    setLearning(null);
  }, []);

  const removeMapping = useCallback((cc: number) => {
    clearCcMapping(cc);
    setMappings(getCcMappings());
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5 w-[90vw] max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold tracking-wider">MIDI LEARN</h2>
            <div className="text-[9px] text-[var(--ed-text-muted)]">
              Click "Assign" then move a controller knob to map it
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-lg px-2">×</button>
        </div>

        {/* Learn mode banner */}
        {learning && (
          <div className="mb-3 p-2 rounded border border-[var(--ed-accent-orange)]/40 bg-[var(--ed-accent-orange)]/10 flex items-center justify-between">
            <span className="text-[10px] text-[var(--ed-accent-orange)] animate-pulse">
              Waiting for MIDI CC for <strong>{learning}</strong>…
            </span>
            <button
              onClick={cancelLearn}
              className="text-[9px] text-white/50 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Targets grid */}
        <div>
          <div className="text-[8px] text-white/30 font-bold mb-1">TARGETS</div>
          <div className="grid grid-cols-4 gap-1.5">
            {TARGETS.map(({ label, dest }) => {
              const existing = mappings.find((m) => destKey(m.dest) === destKey(dest));
              return (
                <div key={label} className="flex items-center gap-1 border border-white/10 rounded p-1.5 bg-white/[0.02]">
                  <div className="flex-1 min-w-0">
                    <div className="text-[9px] font-bold text-white/70 truncate">{label}</div>
                    <div className="text-[7px] text-white/30">
                      {existing ? `CC ${existing.cc}` : "—"}
                    </div>
                  </div>
                  <button
                    onClick={() => startLearn(label, dest)}
                    className="text-[8px] font-bold text-[var(--ed-accent-orange)] hover:brightness-125"
                  >
                    LEARN
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Active mappings */}
        <div className="mt-3">
          <div className="text-[8px] text-white/30 font-bold mb-1">ACTIVE MAPPINGS</div>
          {mappings.length === 0 ? (
            <div className="text-[9px] text-white/20 py-2">No mappings yet.</div>
          ) : (
            <div className="space-y-1">
              {mappings.map(({ cc, dest }) => (
                <div key={cc} className="flex items-center gap-2 py-1 px-2 rounded bg-white/[0.02] border border-white/8 text-[9px]">
                  <span className="font-mono text-white/60">CC {cc}</span>
                  <span className="text-white/30">→</span>
                  <span className="flex-1 text-white/70">{destLabel(dest)}</span>
                  <button
                    onClick={() => removeMapping(cc)}
                    className="text-[8px] text-red-400/60 hover:text-red-400"
                  >
                    REMOVE
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
