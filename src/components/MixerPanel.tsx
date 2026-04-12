/**
 * Fullscreen Mixer Panel — Ableton-style
 *
 * Design principles:
 * - Full viewport height for maximum fader travel
 * - Wide channel strips with clear visual hierarchy
 * - Meter + Fader side by side (like Ableton Session Mixer)
 * - Send knobs above fader
 * - FX controls in dedicated bottom row
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { audioEngine } from "../audio/AudioEngine";

const CHANNELS = [
  { id: 0, label: "KICK", color: "#f59e0b" },
  { id: 1, label: "SNARE", color: "#f59e0b" },
  { id: 2, label: "CLAP", color: "#f59e0b" },
  { id: 3, label: "TOM L", color: "#f59e0b" },
  { id: 4, label: "TOM M", color: "#f59e0b" },
  { id: 5, label: "TOM H", color: "#f59e0b" },
  { id: 6, label: "HH CL", color: "#3b82f6" },
  { id: 7, label: "HH OP", color: "#3b82f6" },
  { id: 8, label: "CYM", color: "#3b82f6" },
  { id: 9, label: "RIDE", color: "#3b82f6" },
  { id: 10, label: "PRC 1", color: "#8b5cf6" },
  { id: 11, label: "PRC 2", color: "#8b5cf6" },
];

interface MixerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MixerPanel({ isOpen, onClose }: MixerPanelProps) {
  const [levels, setLevels] = useState<number[]>(new Array(12).fill(0));
  const [masterLevel, setMasterLevel] = useState(0);
  const [volumes, setVolumes] = useState<number[]>(new Array(12).fill(100));
  const [masterVol, setMasterVol] = useState(85);
  const [sends, setSends] = useState<{ a: number[]; b: number[] }>({
    a: new Array(12).fill(0), b: new Array(12).fill(0),
  });
  const [reverbLevel, setReverbLvl] = useState(35);
  const [delayTime, setDelayTime] = useState(375);
  const [delayFeedback, setDelayFB] = useState(40);
  const [delayLevel, setDelayLvl] = useState(30);
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [soloed, setSoloed] = useState<Set<number>>(new Set());
  const rafRef = useRef<number>(0);
  const peakHold = useRef<number[]>(new Array(12).fill(0));
  const masterPeakHold = useRef(0);

  // ─── Meter Loop ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const newLevels: number[] = [];
      for (let i = 0; i < 12; i++) {
        const raw = audioEngine.getChannelLevel(i);
        if (raw > peakHold.current[i]!) peakHold.current[i] = raw;
        else peakHold.current[i]! *= 0.97;
        newLevels.push(raw);
      }
      const rawMaster = audioEngine.getMasterLevel();
      if (rawMaster > masterPeakHold.current) masterPeakHold.current = rawMaster;
      else masterPeakHold.current *= 0.97;

      setLevels(newLevels);
      setMasterLevel(rawMaster);
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isOpen]);

  // ─── Handlers ──────────────────────────────────────────
  const handleVol = useCallback((ch: number, v: number) => {
    setVolumes((p) => { const n = [...p]; n[ch] = v; return n; });
    audioEngine.setChannelVolume(ch, v / 127);
  }, []);

  const handleMasterVol = useCallback((v: number) => {
    setMasterVol(v);
    audioEngine.setMasterVolume(v / 127);
  }, []);

  const handleSendA = useCallback((ch: number, v: number) => {
    setSends((p) => { const n = { ...p, a: [...p.a] }; n.a[ch] = v; return n; });
    audioEngine.setChannelReverbSend(ch, v / 100);
  }, []);

  const handleSendB = useCallback((ch: number, v: number) => {
    setSends((p) => { const n = { ...p, b: [...p.b] }; n.b[ch] = v; return n; });
    audioEngine.setChannelDelaySend(ch, v / 100);
  }, []);

  const toggleMute = useCallback((ch: number) => {
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) { next.delete(ch); audioEngine.setChannelVolume(ch, volumes[ch]! / 127); }
      else { next.add(ch); audioEngine.setChannelVolume(ch, 0); }
      return next;
    });
  }, [volumes]);

  const toggleSolo = useCallback((ch: number) => {
    setSoloed((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch); else next.add(ch);
      for (let i = 0; i < 12; i++) {
        if (next.size === 0) audioEngine.setChannelVolume(i, muted.has(i) ? 0 : volumes[i]! / 127);
        else audioEngine.setChannelVolume(i, next.has(i) ? volumes[i]! / 127 : 0);
      }
      return next;
    });
  }, [volumes, muted]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--ed-bg-primary)]">
      {/* ─── Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between h-10 px-5 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)] shrink-0">
        <h2 className="text-xs font-bold text-[var(--ed-accent-orange)] tracking-[0.2em]">ELASTIC DRUMS — MIXER</h2>
        <button
          onClick={onClose}
          className="px-3 py-1 text-xs bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)] rounded transition-colors"
        >
          ← BACK TO SEQUENCER
        </button>
      </div>

      {/* ─── Channel Strips ─────────────────────────────── */}
      <div className="flex-1 flex min-h-0 px-3 py-3 gap-1">
        {CHANNELS.map((ch, i) => (
          <div
            key={ch.id}
            className="flex-1 flex flex-col bg-[var(--ed-bg-secondary)] rounded-lg border border-[var(--ed-border)] overflow-hidden min-w-0"
          >
            {/* Channel Label */}
            <div className="h-8 flex items-center justify-center border-b border-[var(--ed-border)]" style={{ backgroundColor: ch.color + "15" }}>
              <span className="text-[11px] font-bold tracking-wider" style={{ color: muted.has(i) ? "var(--ed-text-muted)" : ch.color }}>
                {ch.label}
              </span>
            </div>

            {/* Send Knobs */}
            <div className="flex flex-col gap-1.5 px-2 py-2 border-b border-[var(--ed-border)]">
              <SendKnob label="REV" value={sends.a[i] ?? 0} color="#3b82f6" onChange={(v) => handleSendA(i, v)} />
              <SendKnob label="DLY" value={sends.b[i] ?? 0} color="#f59e0b" onChange={(v) => handleSendB(i, v)} />
            </div>

            {/* Meter + Fader (main area — takes all remaining space) */}
            <div className="flex-1 flex items-stretch px-2 py-2 gap-1.5 min-h-0">
              {/* Meter */}
              <div className="w-3 rounded-sm bg-[var(--ed-bg-primary)] relative overflow-hidden border border-[var(--ed-border)]/20">
                <div
                  className="absolute bottom-0 left-0 right-0 transition-all duration-75 rounded-sm"
                  style={{
                    height: `${Math.min((levels[i] ?? 0) * 100, 100)}%`,
                    background: (levels[i] ?? 0) > 0.85
                      ? "linear-gradient(to top, #22c55e 0%, #eab308 60%, #ef4444 100%)"
                      : (levels[i] ?? 0) > 0.4
                        ? `linear-gradient(to top, #22c55e, ${ch.color})`
                        : "#22c55e",
                  }}
                />
                {/* Peak line */}
                {(peakHold.current[i] ?? 0) > 0.03 && (
                  <div
                    className="absolute left-0 right-0 h-[2px]"
                    style={{
                      bottom: `${Math.min((peakHold.current[i] ?? 0) * 100, 100)}%`,
                      backgroundColor: (peakHold.current[i] ?? 0) > 0.85 ? "#ef4444" : ch.color,
                    }}
                  />
                )}
              </div>

              {/* Fader — full height vertical slider */}
              <div className="flex-1 flex items-center justify-center">
                <input
                  type="range"
                  min={0}
                  max={127}
                  value={volumes[i] ?? 100}
                  onChange={(e) => handleVol(i, Number(e.target.value))}
                  className="accent-[var(--ed-text-primary)]"
                  style={{
                    writingMode: "vertical-lr",
                    direction: "rtl",
                    height: "100%",
                    width: "28px",
                    minHeight: "120px",
                  }}
                />
              </div>
            </div>

            {/* dB readout */}
            <div className="text-center py-0.5 text-[9px] font-mono text-[var(--ed-text-muted)] border-t border-[var(--ed-border)]">
              {(levels[i] ?? 0) > 0.001 ? `${(20 * Math.log10(levels[i] ?? 0.001)).toFixed(0)} dB` : "-∞"}
            </div>

            {/* Mute / Solo */}
            <div className="flex border-t border-[var(--ed-border)]">
              <button
                onClick={() => toggleMute(i)}
                className={`flex-1 py-1.5 text-[10px] font-bold transition-colors ${
                  muted.has(i)
                    ? "bg-[var(--ed-accent-red)] text-white"
                    : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)]"
                }`}
              >
                M
              </button>
              <div className="w-px bg-[var(--ed-border)]" />
              <button
                onClick={() => toggleSolo(i)}
                className={`flex-1 py-1.5 text-[10px] font-bold transition-colors ${
                  soloed.has(i)
                    ? "bg-[var(--ed-accent-orange)] text-black"
                    : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)]"
                }`}
              >
                S
              </button>
            </div>
          </div>
        ))}

        {/* ─── Divider ─────────────────────────────────── */}
        <div className="w-px bg-[var(--ed-border)] mx-1" />

        {/* ─── Master Channel ──────────────────────────── */}
        <div className="w-24 flex flex-col bg-[var(--ed-bg-secondary)] rounded-lg border-2 border-[var(--ed-accent-green)]/30 overflow-hidden">
          <div className="h-8 flex items-center justify-center bg-[var(--ed-accent-green)]/10 border-b border-[var(--ed-border)]">
            <span className="text-[11px] font-bold text-[var(--ed-accent-green)] tracking-[0.15em]">MASTER</span>
          </div>

          {/* Master meter + fader */}
          <div className="flex-1 flex items-stretch px-3 py-2 gap-2 min-h-0">
            <div className="w-4 rounded-sm bg-[var(--ed-bg-primary)] relative overflow-hidden border border-[var(--ed-border)]/20">
              <div
                className="absolute bottom-0 left-0 right-0 transition-all duration-75 rounded-sm"
                style={{
                  height: `${Math.min(masterLevel * 100, 100)}%`,
                  background: masterLevel > 0.85
                    ? "linear-gradient(to top, #22c55e 0%, #eab308 60%, #ef4444 100%)"
                    : "linear-gradient(to top, #22c55e, #22c55e)",
                }}
              />
              {masterPeakHold.current > 0.03 && (
                <div
                  className="absolute left-0 right-0 h-[2px]"
                  style={{
                    bottom: `${Math.min(masterPeakHold.current * 100, 100)}%`,
                    backgroundColor: masterPeakHold.current > 0.85 ? "#ef4444" : "#22c55e",
                  }}
                />
              )}
            </div>
            <div className="flex-1 flex items-center justify-center">
              <input
                type="range"
                min={0}
                max={127}
                value={masterVol}
                onChange={(e) => handleMasterVol(Number(e.target.value))}
                className="accent-[var(--ed-accent-green)]"
                style={{
                  writingMode: "vertical-lr",
                  direction: "rtl",
                  height: "100%",
                  width: "30px",
                  minHeight: "120px",
                }}
              />
            </div>
          </div>

          <div className="text-center py-0.5 text-[9px] font-mono text-[var(--ed-accent-green)] border-t border-[var(--ed-border)]">
            {masterLevel > 0.001 ? `${(20 * Math.log10(masterLevel)).toFixed(0)} dB` : "-∞"}
          </div>
        </div>
      </div>

      {/* ─── FX Controls Bar ────────────────────────────── */}
      <div className="h-14 flex items-center gap-8 px-6 border-t border-[var(--ed-border)] bg-[var(--ed-bg-secondary)] shrink-0">
        {/* Reverb */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-[var(--ed-accent-blue)] tracking-wider w-12">REVERB</span>
          <span className="text-[9px] text-[var(--ed-text-muted)]">Level</span>
          <input type="range" min={0} max={100} value={reverbLevel}
            onChange={(e) => { const v = Number(e.target.value); setReverbLvl(v); audioEngine.setReverbLevel(v / 100); }}
            className="w-24 h-1.5 accent-[var(--ed-accent-blue)]" />
          <span className="text-[10px] font-mono text-[var(--ed-text-secondary)] w-8">{reverbLevel}%</span>
        </div>

        <div className="w-px h-6 bg-[var(--ed-border)]" />

        {/* Delay */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-[var(--ed-accent-orange)] tracking-wider w-10">DELAY</span>
          <span className="text-[9px] text-[var(--ed-text-muted)]">Time</span>
          <input type="range" min={50} max={1000} value={delayTime}
            onChange={(e) => { const v = Number(e.target.value); setDelayTime(v); audioEngine.setDelayParams(v / 1000, delayFeedback / 100, 4000); }}
            className="w-20 h-1.5 accent-[var(--ed-accent-orange)]" />
          <span className="text-[10px] font-mono text-[var(--ed-text-secondary)] w-10">{delayTime}ms</span>

          <span className="text-[9px] text-[var(--ed-text-muted)]">FB</span>
          <input type="range" min={0} max={90} value={delayFeedback}
            onChange={(e) => { const v = Number(e.target.value); setDelayFB(v); audioEngine.setDelayParams(delayTime / 1000, v / 100, 4000); }}
            className="w-16 h-1.5 accent-[var(--ed-accent-orange)]" />
          <span className="text-[10px] font-mono text-[var(--ed-text-secondary)] w-6">{delayFeedback}%</span>

          <span className="text-[9px] text-[var(--ed-text-muted)]">Wet</span>
          <input type="range" min={0} max={100} value={delayLevel}
            onChange={(e) => { const v = Number(e.target.value); setDelayLvl(v); audioEngine.setDelayLevel(v / 100); }}
            className="w-16 h-1.5 accent-[var(--ed-accent-orange)]" />
          <span className="text-[10px] font-mono text-[var(--ed-text-secondary)] w-6">{delayLevel}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Send Knob (horizontal mini-slider) ──────────────────

function SendKnob({ label, value, color, onChange }: {
  label: string; value: number; color: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] font-bold tracking-wider w-6" style={{ color }}>{label}</span>
      <input
        type="range" min={0} max={100} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1"
        style={{ accentColor: color }}
      />
      <span className="text-[8px] font-mono text-[var(--ed-text-muted)] w-5 text-right">{value}</span>
    </div>
  );
}
