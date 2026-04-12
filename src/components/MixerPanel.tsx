/**
 * Fullscreen Mixer — Professional Metering v2
 *
 * Fixed: dB scale aligned to meters, wider meters, proper IEC mapping
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

// IEC 60268-18 meter scale: dBFS → meter % (0..100)
function dbToPercent(db: number): number {
  if (db < -60) return 0;
  if (db > 6)   return 100;
  // Piecewise linear approximation of IEC scale
  if (db >= -0.1) return 100;
  if (db >= -6)   return 85 + (db + 6) / 6 * 15;
  if (db >= -12)  return 70 + (db + 12) / 6 * 15;
  if (db >= -20)  return 50 + (db + 20) / 8 * 20;
  if (db >= -30)  return 30 + (db + 30) / 10 * 20;
  if (db >= -40)  return 15 + (db + 40) / 10 * 15;
  if (db >= -60)  return (db + 60) / 20 * 15;
  return 0;
}

// Logarithmic fader: position (0..1) → gain
function faderToGain(pos: number): number {
  if (pos <= 0.005) return 0;
  const db = pos < 0.75
    ? -60 + (pos / 0.75) * 60
    : (pos - 0.75) / 0.25 * 6;
  return AudioEngine.dbToLinear(db);
}

// dB scale marks with their IEC positions
const DB_SCALE = [
  { db: 0,   label: "0" },
  { db: -3,  label: "-3" },
  { db: -6,  label: "-6" },
  { db: -12, label: "-12" },
  { db: -18, label: "-18" },
  { db: -24, label: "-24" },
  { db: -30, label: "-30" },
  { db: -40, label: "-40" },
  { db: -50, label: "-50" },
  { db: -60, label: "-60" },
];

interface MeterData { rmsDb: number; peakDb: number }

interface MixerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MixerPanel({ isOpen, onClose }: MixerPanelProps) {
  const [meters, setMeters] = useState<MeterData[]>(Array.from({ length: 12 }, () => ({ rmsDb: -Infinity, peakDb: -Infinity })));
  const [masterMeter, setMasterMeter] = useState<MeterData>({ rmsDb: -Infinity, peakDb: -Infinity });
  const [faders, setFaders] = useState<number[]>(new Array(12).fill(750));
  const [masterFader, setMasterFaderVal] = useState(700);
  const [sends, setSends] = useState<{ a: number[]; b: number[] }>({ a: new Array(12).fill(0), b: new Array(12).fill(0) });
  const [reverbLevel, setReverbLvl] = useState(35);
  const [delayTime, setDelayTime] = useState(375);
  const [delayFB, setDelayFB] = useState(40);
  const [delayLevel, setDelayLvl] = useState(30);
  const [eqLow, setEqLow] = useState(0);
  const [eqMid, setEqMid] = useState(0);
  const [eqHigh, setEqHigh] = useState(0);
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [soloed, setSoloed] = useState<Set<number>>(new Set());
  const rafRef = useRef<number>(0);

  // Meter animation loop
  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const m: MeterData[] = [];
      for (let i = 0; i < 12; i++) {
        const d = audioEngine.getChannelMeter(i);
        m.push({ rmsDb: d.rmsDb, peakDb: d.peakDb });
      }
      const mm = audioEngine.getMasterMeter();
      setMeters(m);
      setMasterMeter({ rmsDb: mm.rmsDb, peakDb: mm.peakDb });
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isOpen]);

  const handleFader = useCallback((ch: number, val: number) => {
    setFaders((p) => { const n = [...p]; n[ch] = val; return n; });
    audioEngine.setChannelVolume(ch, faderToGain(val / 1000));
  }, []);

  const handleMasterFader = useCallback((val: number) => {
    setMasterFaderVal(val);
    audioEngine.setMasterVolume(faderToGain(val / 1000));
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
      if (next.has(ch)) { next.delete(ch); audioEngine.setChannelVolume(ch, faderToGain((faders[ch] ?? 750) / 1000)); }
      else { next.add(ch); audioEngine.setChannelVolume(ch, 0); }
      return next;
    });
  }, [faders]);

  const toggleSolo = useCallback((ch: number) => {
    setSoloed((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch); else next.add(ch);
      for (let i = 0; i < 12; i++) {
        if (next.size === 0) audioEngine.setChannelVolume(i, muted.has(i) ? 0 : faderToGain((faders[i] ?? 750) / 1000));
        else audioEngine.setChannelVolume(i, next.has(i) ? faderToGain((faders[i] ?? 750) / 1000) : 0);
      }
      return next;
    });
  }, [faders, muted]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#08080a]">
      {/* Header */}
      <div className="flex items-center justify-between h-9 px-4 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-black text-[var(--ed-accent-orange)] tracking-[0.2em]">MIXER</span>
          <span className="text-[8px] text-[var(--ed-text-muted)]">FFT RMS+Peak · IEC 60268 · Log Fader</span>
        </div>
        <button onClick={onClose} className="px-3 py-1 text-[10px] bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:text-white rounded transition-colors">← BACK</button>
      </div>

      {/* Main area */}
      <div className="flex-1 flex min-h-0 px-1 py-1">

        {/* dB Scale ruler — positioned to match meter area */}
        <div className="w-10 shrink-0 relative">
          {DB_SCALE.map((mark) => {
            const pct = dbToPercent(mark.db);
            return (
              <div key={mark.db} className="absolute right-0 flex items-center" style={{ bottom: `${pct}%`, transform: "translateY(50%)" }}>
                <span className="text-[8px] font-mono text-[var(--ed-text-muted)] mr-1">{mark.label}</span>
                <div className="w-3 h-px bg-[var(--ed-text-muted)]/40" />
              </div>
            );
          })}
        </div>

        {/* Channel strips */}
        {CHANNELS.map((ch, i) => (
          <ChannelStrip
            key={ch.id}
            label={ch.label}
            color={ch.color}
            meter={meters[i]!}
            faderValue={faders[i] ?? 750}
            sendA={sends.a[i] ?? 0}
            sendB={sends.b[i] ?? 0}
            isMuted={muted.has(i)}
            isSoloed={soloed.has(i)}
            onFader={(v) => handleFader(i, v)}
            onSendA={(v) => handleSendA(i, v)}
            onSendB={(v) => handleSendB(i, v)}
            onMute={() => toggleMute(i)}
            onSolo={() => toggleSolo(i)}
            channelIndex={i}
          />
        ))}

        {/* Divider */}
        <div className="w-px bg-[var(--ed-accent-green)]/20 mx-1" />

        {/* Master */}
        <div className="w-24 flex flex-col bg-[#0a0f0a] rounded border border-[var(--ed-accent-green)]/20 overflow-hidden">
          <div className="h-7 flex items-center justify-center bg-[var(--ed-accent-green)]/8 border-b border-[var(--ed-accent-green)]/20">
            <span className="text-[10px] font-bold text-[var(--ed-accent-green)] tracking-[0.15em]">MASTER</span>
          </div>

          {/* Meter + Fader */}
          <div className="flex-1 flex px-2 py-2 gap-2 min-h-0">
            <Meter rmsDb={masterMeter.rmsDb} peakDb={masterMeter.peakDb} color="#22c55e" width={14} />
            <div className="flex-1 flex items-center justify-center">
              <input type="range" min={0} max={1000} value={masterFader}
                onChange={(e) => handleMasterFader(Number(e.target.value))}
                className="accent-[var(--ed-accent-green)]"
                style={{ writingMode: "vertical-lr", direction: "rtl", height: "100%", width: "28px", minHeight: "80px" }} />
            </div>
          </div>

          {/* Readout */}
          <div className="text-center py-1 border-t border-[var(--ed-accent-green)]/20">
            <div className={`text-[9px] font-mono ${masterMeter.peakDb > -0.5 ? "text-red-400" : "text-[var(--ed-accent-green)]"}`}>
              {masterMeter.rmsDb > -60 ? `${masterMeter.rmsDb.toFixed(1)} dB` : "-∞ dB"}
            </div>
            <div className="text-[7px] text-[var(--ed-text-muted)]">
              Peak: {masterMeter.peakDb > -60 ? `${masterMeter.peakDb.toFixed(1)}` : "-∞"}
            </div>
          </div>

          {/* Compressor GR */}
          <div className="px-2 py-1 border-t border-[var(--ed-accent-green)]/20">
            <div className="flex items-center gap-1">
              <span className="text-[7px] font-bold text-[var(--ed-text-muted)]">GR</span>
              <div className="flex-1 h-2 bg-black rounded-sm overflow-hidden">
                <div className="h-full bg-yellow-500/80 transition-all duration-100" style={{
                  width: `${Math.min(Math.abs(audioEngine.getCompressorReduction()) / 20 * 100, 100)}%`,
                }} />
              </div>
              <span className="text-[7px] font-mono text-[var(--ed-text-muted)]">
                {audioEngine.getCompressorReduction().toFixed(1)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* FX Bar */}
      <div className="h-11 flex items-center gap-6 px-5 border-t border-[var(--ed-border)] bg-[var(--ed-bg-secondary)] shrink-0 overflow-x-auto">
        {/* Master EQ */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] font-bold text-[var(--ed-accent-green)] tracking-wider">EQ</span>
          <FxSlider value={eqLow + 12} max={24} label="Lo" suffix="" color="#22c55e"
            onChange={(v) => { const db = v - 12; setEqLow(db); audioEngine.setMasterEQ(db, eqMid, eqHigh); }} />
          <FxSlider value={eqMid + 12} max={24} label="Mid" suffix="" color="#22c55e"
            onChange={(v) => { const db = v - 12; setEqMid(db); audioEngine.setMasterEQ(eqLow, db, eqHigh); }} />
          <FxSlider value={eqHigh + 12} max={24} label="Hi" suffix="" color="#22c55e"
            onChange={(v) => { const db = v - 12; setEqHigh(db); audioEngine.setMasterEQ(eqLow, eqMid, db); }} />
        </div>
        <div className="w-px h-5 bg-[var(--ed-border)] shrink-0" />
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] font-bold text-[var(--ed-accent-blue)] tracking-wider">REVERB</span>
          <FxSlider value={reverbLevel} max={100} label="Lvl" color="#3b82f6"
            onChange={(v) => { setReverbLvl(v); audioEngine.setReverbLevel(v / 100); }} />
        </div>
        <div className="w-px h-5 bg-[var(--ed-border)]" />
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold text-[var(--ed-accent-orange)] tracking-wider">DELAY</span>
          <FxSlider value={delayTime} max={1000} label="Time" suffix="ms" color="#f59e0b"
            onChange={(v) => { setDelayTime(v); audioEngine.setDelayParams(v / 1000, delayFB / 100, 4000); }} />
          <FxSlider value={delayFB} max={90} label="FB" color="#f59e0b"
            onChange={(v) => { setDelayFB(v); audioEngine.setDelayParams(delayTime / 1000, v / 100, 4000); }} />
          <FxSlider value={delayLevel} max={100} label="Wet" color="#f59e0b"
            onChange={(v) => { setDelayLvl(v); audioEngine.setDelayLevel(v / 100); }} />
        </div>
      </div>
    </div>
  );
}

// ─── Channel Strip ───────────────────────────────────────

function ChannelStrip({ label, color, meter, faderValue, sendA, sendB, isMuted, isSoloed,
  onFader, onSendA, onSendB, onMute, onSolo, channelIndex,
}: {
  label: string; color: string; meter: MeterData; faderValue: number;
  sendA: number; sendB: number; isMuted: boolean; isSoloed: boolean;
  onFader: (v: number) => void; onSendA: (v: number) => void; onSendB: (v: number) => void;
  onMute: () => void; onSolo: () => void; channelIndex: number;
}) {
  const [filterFreq, setFilterFreq] = useState(1000);
  const [filterType, setFilterType] = useState<BiquadFilterType>("allpass");
  const [drive, setDrive] = useState(0);
  const faderDb = faderValue <= 5 ? -Infinity : AudioEngine.linearToDb(faderToGain(faderValue / 1000));

  return (
    <div className="flex-1 flex flex-col bg-[var(--ed-bg-secondary)] rounded border border-[var(--ed-border)] overflow-hidden min-w-0">
      {/* Label */}
      <div className="h-6 flex items-center justify-center" style={{ backgroundColor: color + "10", borderBottom: `1px solid ${color}20` }}>
        <span className="text-[9px] font-bold tracking-wider" style={{ color: isMuted ? "#555" : color }}>{label}</span>
      </div>

      {/* Sends */}
      <div className="px-1 py-1 space-y-0.5 border-b border-[var(--ed-border)]">
        <MiniSend label="R" value={sendA} color="#3b82f6" onChange={onSendA} />
        <MiniSend label="D" value={sendB} color="#f59e0b" onChange={onSendB} />
      </div>

      {/* Insert FX */}
      <div className="px-1 py-1 space-y-0.5 border-b border-[var(--ed-border)]">
        {/* Filter type toggle */}
        <div className="flex gap-[2px]">
          {(["allpass", "lowpass", "highpass", "bandpass"] as const).map((t) => (
            <button key={t} onClick={() => {
              setFilterType(t);
              audioEngine.setChannelFilter(channelIndex, t, filterFreq, 2);
            }}
              className={`flex-1 text-[5px] font-bold py-[1px] rounded-sm transition-colors ${
                filterType === t ? "bg-[var(--ed-accent-blue)]/40 text-[var(--ed-accent-blue)]" : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
              }`}
            >{t === "allpass" ? "OFF" : t === "lowpass" ? "LP" : t === "highpass" ? "HP" : "BP"}</button>
          ))}
        </div>
        {/* Filter freq */}
        {filterType !== "allpass" && (
          <MiniSend label="F" value={Math.round(filterFreq / 200 * 100)} color="#3b82f6" onChange={(v) => {
            const freq = Math.round(20 + (v / 100) * 19980);
            setFilterFreq(freq);
            audioEngine.setChannelFilter(channelIndex, filterType, freq, 2);
          }} />
        )}
        {/* Drive */}
        <MiniSend label="⚡" value={drive} color="#ef4444" onChange={(v) => {
          setDrive(v);
          audioEngine.setChannelDrive(channelIndex, v / 100);
        }} />
      </div>

      {/* Meter + Fader area */}
      <div className="flex-1 flex px-1 py-1 gap-[3px] min-h-0">
        {/* Meter */}
        <Meter rmsDb={meter.rmsDb} peakDb={meter.peakDb} color={color} width={10} />

        {/* Fader */}
        <div className="flex-1 flex items-center justify-center">
          <input type="range" min={0} max={1000} value={faderValue}
            onChange={(e) => onFader(Number(e.target.value))}
            className="accent-white/80"
            style={{ writingMode: "vertical-lr", direction: "rtl", height: "100%", width: "22px", minHeight: "80px" }} />
        </div>
      </div>

      {/* Readout */}
      <div className="text-center py-[2px] border-t border-[var(--ed-border)] bg-black/30">
        <span className={`text-[8px] font-mono ${meter.peakDb > -0.5 ? "text-red-400 font-bold" : "text-[var(--ed-text-muted)]"}`}>
          {meter.rmsDb > -60 ? meter.rmsDb.toFixed(1) : "-∞"}
        </span>
        <span className="text-[7px] text-[var(--ed-text-muted)]"> / </span>
        <span className="text-[7px] font-mono text-[var(--ed-text-muted)]">
          {isFinite(faderDb) ? `${faderDb >= 0 ? "+" : ""}${faderDb.toFixed(1)}` : "-∞"}
        </span>
      </div>

      {/* M/S */}
      <div className="flex">
        <button onClick={onMute} className={`flex-1 py-[3px] text-[8px] font-bold border-t border-r border-[var(--ed-border)] transition-colors ${isMuted ? "bg-red-500 text-white" : "text-[var(--ed-text-muted)] hover:bg-white/5"}`}>M</button>
        <button onClick={onSolo} className={`flex-1 py-[3px] text-[8px] font-bold border-t border-[var(--ed-border)] transition-colors ${isSoloed ? "bg-amber-500 text-black" : "text-[var(--ed-text-muted)] hover:bg-white/5"}`}>S</button>
      </div>
    </div>
  );
}

// ─── Meter Component ─────────────────────────────────────

interface MeterData { rmsDb: number; peakDb: number }

function Meter({ rmsDb, peakDb, color, width }: { rmsDb: number; peakDb: number; color: string; width: number }) {
  const rmsPct = dbToPercent(rmsDb);
  const peakPct = dbToPercent(peakDb);
  const isClip = peakDb > -0.5;

  // Color gradient based on level
  const gradient = rmsPct > 85
    ? "linear-gradient(to top, #22c55e 0%, #84cc16 30%, #eab308 60%, #f97316 80%, #ef4444 100%)"
    : rmsPct > 50
      ? "linear-gradient(to top, #22c55e 0%, #84cc16 50%, #eab308 100%)"
      : "#22c55e";

  return (
    <div className="relative rounded-sm overflow-hidden bg-[#080808]" style={{ width, minWidth: width }}>
      {/* Tick marks at key dB points */}
      {[-6, -12, -24, -40].map((db) => (
        <div key={db} className="absolute left-0 right-0 h-px bg-white/5" style={{ bottom: `${dbToPercent(db)}%` }} />
      ))}

      {/* 0dB reference line */}
      <div className="absolute left-0 right-0 h-px bg-red-500/30 z-10" style={{ bottom: `${dbToPercent(0)}%` }} />

      {/* RMS bar */}
      <div className="absolute bottom-0 left-0 right-0 transition-[height] duration-[60ms]" style={{
        height: `${rmsPct}%`,
        background: gradient,
        borderRadius: "1px 1px 0 0",
      }} />

      {/* Peak hold line */}
      {peakPct > 0.5 && (
        <div className="absolute left-0 right-0 z-10" style={{
          height: "2px",
          bottom: `${peakPct}%`,
          backgroundColor: peakDb > -3 ? "#ef4444" : peakDb > -12 ? "#eab308" : color,
          boxShadow: peakDb > -3 ? "0 0 4px #ef4444" : "none",
        }} />
      )}

      {/* Clip indicator */}
      {isClip && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-red-500 z-20" style={{ boxShadow: "0 0 6px #ef4444" }} />
      )}
    </div>
  );
}

// ─── Mini Send Slider ────────────────────────────────────

function MiniSend({ label, value, color, onChange }: { label: string; value: number; color: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-[3px]">
      <span className="text-[6px] font-bold w-2" style={{ color }}>{label}</span>
      <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-[3px]" style={{ accentColor: color }} />
    </div>
  );
}

// ─── FX Slider ───────────────────────────────────────────

function FxSlider({ value, max, label, suffix, color, onChange }: {
  value: number; max: number; label: string; suffix?: string; color: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px] text-[var(--ed-text-muted)]">{label}</span>
      <input type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-14 h-1" style={{ accentColor: color }} />
      <span className="text-[8px] font-mono text-[var(--ed-text-secondary)] w-10">{value}{suffix ?? "%"}</span>
    </div>
  );
}
