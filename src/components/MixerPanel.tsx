/**
 * Fullscreen Mixer — Professional Metering
 *
 * - FFT-based RMS + Peak level analysis
 * - Logarithmic dB scale on meters (-60dB to 0dB)
 * - Peak hold indicators with slow decay
 * - Logarithmic fader law (like real consoles)
 * - Clip indicators at 0dBFS
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { audioEngine, AudioEngine } from "../audio/AudioEngine";

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

// dB scale: maps dBFS to meter position (0..1)
// Logarithmic: more resolution near 0dB, less at -60dB
const DB_MIN = -60;
const DB_MAX = 6; // Allow +6dB for clip indication
const _DB_RANGE = DB_MAX - DB_MIN; void _DB_RANGE;

function dbToMeterPosition(db: number): number {
  if (db <= DB_MIN) return 0;
  if (db >= DB_MAX) return 1;
  // Attempt at IEC 60268-18 scale approximation
  if (db >= -0.1) return 1.0;
  if (db >= -6)  return 0.85 + (db + 6) / 6 * 0.15;
  if (db >= -12) return 0.70 + (db + 12) / 6 * 0.15;
  if (db >= -20) return 0.50 + (db + 20) / 8 * 0.20;
  if (db >= -30) return 0.30 + (db + 30) / 10 * 0.20;
  if (db >= -40) return 0.15 + (db + 40) / 10 * 0.15;
  if (db >= -60) return (db + 60) / 20 * 0.15;
  return 0;
}

// Logarithmic fader law: fader position (0..1) → gain multiplier
function faderToGain(position: number): number {
  if (position <= 0) return 0;
  // Attempt at industry-standard fader curve
  // Position 0.75 = unity (0dB), 1.0 = +6dB
  const db = position <= 0.001 ? -Infinity
    : position < 0.75 ? -60 + (position / 0.75) * 60
    : (position - 0.75) / 0.25 * 6;
  return AudioEngine.dbToLinear(db);
}

// Used for preset recall
function _gainToFaderPosition(gain: number): number {
  if (gain <= 0.001) return 0;
  const db = AudioEngine.linearToDb(gain);
  if (db <= -60) return 0;
  if (db <= 0) return (db + 60) / 60 * 0.75;
  return 0.75 + db / 6 * 0.25;
} void _gainToFaderPosition;

// dB scale marks for the meter
const DB_MARKS = [0, -3, -6, -12, -18, -24, -36, -48];

interface MixerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MixerPanel({ isOpen, onClose }: MixerPanelProps) {
  interface MeterData { rmsDb: number; peakDb: number }
  const [meters, setMeters] = useState<MeterData[]>(Array.from({ length: 12 }, () => ({ rmsDb: -Infinity, peakDb: -Infinity })));
  const [masterMeter, setMasterMeter] = useState<MeterData>({ rmsDb: -Infinity, peakDb: -Infinity });
  const [faderPositions, setFaderPositions] = useState<number[]>(new Array(12).fill(0.75)); // Unity
  const [masterFader, setMasterFader] = useState(0.7);
  const [sends, setSends] = useState<{ a: number[]; b: number[] }>({ a: new Array(12).fill(0), b: new Array(12).fill(0) });
  const [reverbLevel, setReverbLvl] = useState(35);
  const [delayTime, setDelayTime] = useState(375);
  const [delayFB, setDelayFB] = useState(40);
  const [delayLevel, setDelayLvl] = useState(30);
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [soloed, setSoloed] = useState<Set<number>>(new Set());
  const [clipped, setClipped] = useState<Set<number>>(new Set());
  const rafRef = useRef<number>(0);

  // ─── Meter Loop (FFT-based) ────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const newMeters: MeterData[] = [];
      const newClipped = new Set<number>();

      for (let i = 0; i < 12; i++) {
        const m = audioEngine.getChannelMeter(i);
        newMeters.push({ rmsDb: m.rmsDb, peakDb: m.peakDb });
        if (m.peakDb > -0.1) newClipped.add(i);
      }

      const mm = audioEngine.getMasterMeter();
      setMeters(newMeters);
      setMasterMeter({ rmsDb: mm.rmsDb, peakDb: mm.peakDb });
      setClipped(newClipped);
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isOpen]);

  // ─── Handlers ──────────────────────────────────────────
  const handleFader = useCallback((ch: number, position: number) => {
    setFaderPositions((p) => { const n = [...p]; n[ch] = position; return n; });
    audioEngine.setChannelVolume(ch, faderToGain(position));
  }, []);

  const handleMasterFader = useCallback((position: number) => {
    setMasterFader(position);
    audioEngine.setMasterVolume(faderToGain(position));
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
      if (next.has(ch)) { next.delete(ch); audioEngine.setChannelVolume(ch, faderToGain(faderPositions[ch]!)); }
      else { next.add(ch); audioEngine.setChannelVolume(ch, 0); }
      return next;
    });
  }, [faderPositions]);

  const toggleSolo = useCallback((ch: number) => {
    setSoloed((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch); else next.add(ch);
      for (let i = 0; i < 12; i++) {
        if (next.size === 0) audioEngine.setChannelVolume(i, muted.has(i) ? 0 : faderToGain(faderPositions[i]!));
        else audioEngine.setChannelVolume(i, next.has(i) ? faderToGain(faderPositions[i]!) : 0);
      }
      return next;
    });
  }, [faderPositions, muted]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--ed-bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between h-10 px-5 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)] shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-bold text-[var(--ed-accent-orange)] tracking-[0.2em]">MIXER</h2>
          <span className="text-[9px] text-[var(--ed-text-muted)]">FFT RMS+Peak &middot; IEC 60268 Scale &middot; Log Fader Law</span>
        </div>
        <button onClick={onClose} className="px-3 py-1 text-xs bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:text-[var(--ed-text-primary)] rounded transition-colors">
          ← BACK
        </button>
      </div>

      {/* Channels */}
      <div className="flex-1 flex min-h-0 px-2 py-2 gap-[3px]">
        {/* dB Scale ruler */}
        <div className="w-8 flex flex-col justify-between py-8 shrink-0">
          {DB_MARKS.map((db) => (
            <div key={db} className="flex items-center gap-0.5" style={{ position: "relative", top: `${(1 - dbToMeterPosition(db)) * 0}px` }}>
              <div className="w-2 h-px bg-[var(--ed-text-muted)]" />
              <span className="text-[7px] font-mono text-[var(--ed-text-muted)]">{db}</span>
            </div>
          ))}
        </div>

        {/* Channel strips */}
        {CHANNELS.map((ch, i) => {
          const meter = meters[i] ?? { rmsDb: -Infinity, peakDb: -Infinity };
          const rmsPos = dbToMeterPosition(meter.rmsDb);
          const peakPos = dbToMeterPosition(meter.peakDb);
          const isClipped = clipped.has(i);
          const faderPos = faderPositions[i] ?? 0.75;
          const faderDb = faderPos <= 0.001 ? -Infinity : AudioEngine.linearToDb(faderToGain(faderPos));

          return (
            <div key={ch.id} className="flex-1 flex flex-col bg-[var(--ed-bg-secondary)] rounded-lg border border-[var(--ed-border)] overflow-hidden min-w-0">
              {/* Label */}
              <div className="h-7 flex items-center justify-center border-b border-[var(--ed-border)]" style={{ backgroundColor: ch.color + "12" }}>
                <span className="text-[10px] font-bold tracking-wider" style={{ color: muted.has(i) ? "var(--ed-text-muted)" : ch.color }}>
                  {ch.label}
                </span>
              </div>

              {/* Sends */}
              <div className="flex flex-col gap-1 px-1.5 py-1.5 border-b border-[var(--ed-border)]">
                <SendKnob label="REV" value={sends.a[i] ?? 0} color="#3b82f6" onChange={(v) => handleSendA(i, v)} />
                <SendKnob label="DLY" value={sends.b[i] ?? 0} color="#f59e0b" onChange={(v) => handleSendB(i, v)} />
              </div>

              {/* Meter + Fader */}
              <div className="flex-1 flex items-stretch px-1.5 py-1.5 gap-1 min-h-0">
                {/* Meter */}
                <div className="w-[6px] rounded-sm bg-black relative overflow-hidden border border-[var(--ed-border)]/10">
                  {/* RMS bar (main level) */}
                  <div className="absolute bottom-0 left-0 right-0 transition-[height] duration-75" style={{
                    height: `${rmsPos * 100}%`,
                    background: meter.rmsDb > -6
                      ? "linear-gradient(to top, #22c55e 0%, #84cc16 40%, #eab308 70%, #ef4444 100%)"
                      : meter.rmsDb > -18
                        ? "linear-gradient(to top, #22c55e 0%, #84cc16 60%, #eab308 100%)"
                        : "#22c55e",
                  }} />

                  {/* Peak hold line */}
                  {peakPos > 0.01 && (
                    <div className="absolute left-0 right-0 h-[2px]" style={{
                      bottom: `${peakPos * 100}%`,
                      backgroundColor: meter.peakDb > -3 ? "#ef4444" : meter.peakDb > -12 ? "#eab308" : ch.color,
                      boxShadow: meter.peakDb > -3 ? "0 0 3px #ef4444" : "none",
                    }} />
                  )}

                  {/* 0dB line */}
                  <div className="absolute left-0 right-0 h-px bg-red-500/40" style={{ bottom: `${dbToMeterPosition(0) * 100}%` }} />

                  {/* Clip indicator */}
                  {isClipped && (
                    <div className="absolute top-0 left-0 right-0 h-2 bg-red-500 animate-pulse" />
                  )}
                </div>

                {/* Fader (logarithmic) */}
                <div className="flex-1 flex items-center justify-center">
                  <input
                    type="range" min={0} max={1000} value={Math.round(faderPos * 1000)}
                    onChange={(e) => handleFader(i, Number(e.target.value) / 1000)}
                    className="accent-[var(--ed-text-primary)]"
                    style={{ writingMode: "vertical-lr", direction: "rtl", height: "100%", width: "24px", minHeight: "100px" }}
                  />
                </div>
              </div>

              {/* dB readout */}
              <div className={`text-center py-0.5 text-[8px] font-mono border-t border-[var(--ed-border)] ${isClipped ? "text-red-400 font-bold" : "text-[var(--ed-text-muted)]"}`}>
                {meter.rmsDb > -60 ? `${meter.rmsDb.toFixed(1)}` : "-∞"} / {isFinite(faderDb) ? `${faderDb.toFixed(1)}` : "-∞"}
              </div>

              {/* M/S */}
              <div className="flex border-t border-[var(--ed-border)]">
                <button onClick={() => toggleMute(i)} className={`flex-1 py-1 text-[9px] font-bold transition-colors ${muted.has(i) ? "bg-[var(--ed-accent-red)] text-white" : "text-[var(--ed-text-muted)] hover:bg-[var(--ed-bg-elevated)]"}`}>M</button>
                <div className="w-px bg-[var(--ed-border)]" />
                <button onClick={() => toggleSolo(i)} className={`flex-1 py-1 text-[9px] font-bold transition-colors ${soloed.has(i) ? "bg-[var(--ed-accent-orange)] text-black" : "text-[var(--ed-text-muted)] hover:bg-[var(--ed-bg-elevated)]"}`}>S</button>
              </div>
            </div>
          );
        })}

        {/* Divider */}
        <div className="w-px bg-[var(--ed-border)] mx-0.5" />

        {/* Master */}
        <div className="w-20 flex flex-col bg-[var(--ed-bg-secondary)] rounded-lg border-2 border-[var(--ed-accent-green)]/30 overflow-hidden">
          <div className="h-7 flex items-center justify-center bg-[var(--ed-accent-green)]/10 border-b border-[var(--ed-border)]">
            <span className="text-[10px] font-bold text-[var(--ed-accent-green)] tracking-[0.12em]">MASTER</span>
          </div>

          <div className="flex-1 flex items-stretch px-2 py-1.5 gap-1.5 min-h-0">
            <div className="w-2 rounded-sm bg-black relative overflow-hidden border border-[var(--ed-border)]/10">
              <div className="absolute bottom-0 left-0 right-0 transition-[height] duration-75" style={{
                height: `${dbToMeterPosition(masterMeter.rmsDb) * 100}%`,
                background: masterMeter.rmsDb > -6
                  ? "linear-gradient(to top, #22c55e 0%, #eab308 70%, #ef4444 100%)"
                  : "#22c55e",
              }} />
              {dbToMeterPosition(masterMeter.peakDb) > 0.01 && (
                <div className="absolute left-0 right-0 h-[2px]" style={{
                  bottom: `${dbToMeterPosition(masterMeter.peakDb) * 100}%`,
                  backgroundColor: masterMeter.peakDb > -3 ? "#ef4444" : "#22c55e",
                }} />
              )}
              <div className="absolute left-0 right-0 h-px bg-red-500/40" style={{ bottom: `${dbToMeterPosition(0) * 100}%` }} />
            </div>
            <div className="flex-1 flex items-center justify-center">
              <input type="range" min={0} max={1000} value={Math.round(masterFader * 1000)}
                onChange={(e) => handleMasterFader(Number(e.target.value) / 1000)}
                className="accent-[var(--ed-accent-green)]"
                style={{ writingMode: "vertical-lr", direction: "rtl", height: "100%", width: "26px", minHeight: "100px" }}
              />
            </div>
          </div>

          <div className={`text-center py-0.5 text-[8px] font-mono border-t border-[var(--ed-border)] ${masterMeter.peakDb > -0.1 ? "text-red-400" : "text-[var(--ed-accent-green)]"}`}>
            {masterMeter.rmsDb > -60 ? `${masterMeter.rmsDb.toFixed(1)} dB` : "-∞"}
          </div>

          {/* Compressor GR meter */}
          <div className="px-2 py-1 border-t border-[var(--ed-border)]">
            <span className="text-[7px] text-[var(--ed-text-muted)]">GR</span>
            <div className="h-1.5 bg-black rounded-sm overflow-hidden mt-0.5">
              <div className="h-full bg-yellow-500 transition-all duration-100" style={{
                width: `${Math.min(Math.abs(audioEngine.getCompressorReduction()) / 20 * 100, 100)}%`,
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* FX Bar */}
      <div className="h-12 flex items-center gap-8 px-6 border-t border-[var(--ed-border)] bg-[var(--ed-bg-secondary)] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-bold text-[var(--ed-accent-blue)] tracking-wider w-12">REVERB</span>
          <FxSlider label="Level" value={reverbLevel} max={100} color="var(--ed-accent-blue)"
            onChange={(v) => { setReverbLvl(v); audioEngine.setReverbLevel(v / 100); }} />
        </div>
        <div className="w-px h-5 bg-[var(--ed-border)]" />
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-bold text-[var(--ed-accent-orange)] tracking-wider w-10">DELAY</span>
          <FxSlider label="Time" value={delayTime} max={1000} suffix="ms" color="var(--ed-accent-orange)"
            onChange={(v) => { setDelayTime(v); audioEngine.setDelayParams(v / 1000, delayFB / 100, 4000); }} />
          <FxSlider label="FB" value={delayFB} max={90} suffix="%" color="var(--ed-accent-orange)"
            onChange={(v) => { setDelayFB(v); audioEngine.setDelayParams(delayTime / 1000, v / 100, 4000); }} />
          <FxSlider label="Wet" value={delayLevel} max={100} suffix="%" color="var(--ed-accent-orange)"
            onChange={(v) => { setDelayLvl(v); audioEngine.setDelayLevel(v / 100); }} />
        </div>
      </div>
    </div>
  );
}

function SendKnob({ label, value, color, onChange }: { label: string; value: number; color: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[7px] font-bold tracking-wider w-5" style={{ color }}>{label}</span>
      <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1" style={{ accentColor: color }} />
      <span className="text-[7px] font-mono text-[var(--ed-text-muted)] w-4 text-right">{value}</span>
    </div>
  );
}

function FxSlider({ label, value, max, suffix, color, onChange }: {
  label: string; value: number; max: number; suffix?: string; color: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px] text-[var(--ed-text-muted)]">{label}</span>
      <input type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-16 h-1" style={{ accentColor: color }} />
      <span className="text-[9px] font-mono text-[var(--ed-text-secondary)] w-10">{value}{suffix ?? "%"}</span>
    </div>
  );
}
