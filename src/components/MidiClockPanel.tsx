/**
 * MIDI Clock Panel — Send/Receive MIDI sync to external gear.
 *
 * Modes:
 *   - Off: no sync
 *   - Send: Elastic Drums is the clock master
 *   - Receive: follow external MIDI clock (BPM + Start/Stop)
 */

import { useCallback, useEffect, useState } from "react";
import { useDrumStore } from "../store/drumStore";
import { getMidiClockMode, setMidiClockMode, subscribeMidiClockMode, type MidiClockMode } from "../store/midiClockMode";

interface MidiClockPanelProps {
  isOpen: boolean;
  onClose: () => void;
  getOutputs: () => MIDIOutput[];
  selectOutput: (output: MIDIOutput) => void;
}

export function MidiClockPanel({ isOpen, onClose, getOutputs, selectOutput }: MidiClockPanelProps) {
  const [mode, setMode] = useState<MidiClockMode>(getMidiClockMode());
  const [outputs, setOutputs] = useState<MIDIOutput[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string>("");
  const bpm = useDrumStore((s) => s.bpm);
  const isPlaying = useDrumStore((s) => s.isPlaying);

  useEffect(() => {
    return subscribeMidiClockMode(() => setMode(getMidiClockMode()));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => setOutputs(getOutputs());
    refresh();
    const id = setInterval(refresh, 500);
    return () => clearInterval(id);
  }, [isOpen, getOutputs]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const selectMode = useCallback((next: MidiClockMode) => {
    setMode(next);
    setMidiClockMode(next);
  }, []);

  const pickOutput = useCallback((id: string) => {
    setSelectedOutputId(id);
    const out = outputs.find((o) => o.id === id);
    if (out) selectOutput(out);
  }, [outputs, selectOutput]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5 w-[500px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold tracking-wider">MIDI CLOCK</h2>
            <div className="text-[9px] text-[var(--ed-text-muted)]">
              24 PPQ sync with external gear/DAWs
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-lg px-2">×</button>
        </div>

        {/* Mode toggle */}
        <div className="space-y-3">
          <div>
            <div className="text-[8px] text-white/30 font-bold mb-1">MODE</div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["off", "send", "receive"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => selectMode(m)}
                  className={`py-2 text-[10px] font-bold rounded transition-colors ${
                    mode === m
                      ? "bg-[var(--ed-accent-orange)]/25 text-[var(--ed-accent-orange)] border border-[var(--ed-accent-orange)]/40"
                      : "bg-white/5 text-white/40 hover:text-white/70 border border-white/10"
                  }`}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-3 p-2 rounded bg-white/[0.02] border border-white/8 text-[9px]">
            <span className="text-white/40 font-bold">STATUS</span>
            <span className={mode === "off" ? "text-white/30" : "text-[var(--ed-accent-green)]"}>
              {mode === "off" && "Disabled"}
              {mode === "send" && (isPlaying ? `Sending clock @ ${bpm} BPM` : "Ready to send (start transport)")}
              {mode === "receive" && "Listening for external clock"}
            </span>
          </div>

          {/* Output selector (send mode only) */}
          {mode === "send" && (
            <div>
              <div className="text-[8px] text-white/30 font-bold mb-1">OUTPUT DEVICE</div>
              {outputs.length === 0 ? (
                <div className="text-[9px] text-white/30 py-2">
                  No MIDI outputs detected. Connect a device and retry.
                </div>
              ) : (
                <select
                  value={selectedOutputId}
                  onChange={(e) => pickOutput(e.target.value)}
                  className="w-full h-8 px-2 text-[10px] bg-black/30 border border-white/15 rounded text-white"
                >
                  <option value="">— Select output —</option>
                  {outputs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} {o.manufacturer ? `(${o.manufacturer})` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Info */}
          <div className="text-[8px] text-white/25 leading-relaxed">
            <strong>Send:</strong> Elastic Drums is the master clock. External gear follows your tempo.
            <br />
            <strong>Receive:</strong> Elastic Drums follows external tempo. Start/Stop messages control playback.
          </div>
        </div>
      </div>
    </div>
  );
}
