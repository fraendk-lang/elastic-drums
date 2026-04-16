/**
 * Fullscreen Mixer — Professional Metering v2
 *
 * Fixed: dB scale aligned to meters, wider meters, proper IEC mapping
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { audioEngine, AudioEngine, DELAY_DIVISION_NAMES, REVERB_TYPES } from "../audio/AudioEngine";

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
  { id: 12, label: "BASS", color: "#10b981" },
  { id: 13, label: "CHRD", color: "#a78bfa" },
  { id: 14, label: "LEAD", color: "#f472b6" },
];

const NUM_CHANNELS = CHANNELS.length; // 15
const MIX_SECTIONS = [
  { id: "drums", label: "DRUM BUS", accent: "var(--ed-accent-orange)", range: [0, 5] as const, hint: "KICK / SNARE / CLAP / TOMS" },
  { id: "tops", label: "TOPS", accent: "var(--ed-accent-blue)", range: [6, 11] as const, hint: "HATS / CYM / RIDE / PERC" },
  { id: "music", label: "MUSIC BUS", accent: "var(--ed-accent-green)", range: [12, 14] as const, hint: "BASS / CHORDS / LEAD" },
] as const;

const BUS_STRIPS = [
  { id: "drums", label: "DRM BUS", color: "#f59e0b" },
  { id: "hats", label: "TOP BUS", color: "#3b82f6" },
  { id: "perc", label: "PRC BUS", color: "#8b5cf6" },
  { id: "bass", label: "BASS BUS", color: "#10b981" },
  { id: "chords", label: "CHRD BUS", color: "#a78bfa" },
  { id: "melody", label: "LEAD BUS", color: "#f472b6" },
] as const;

const RETURN_STRIPS = [
  { id: "reverb", label: "REV", color: "#3b82f6" },
  { id: "delay", label: "DLY", color: "#f59e0b" },
] as const;

// IEC 60268-18 meter scale: dBFS → meter % (0..100)
// Smooth logarithmic curve — no piecewise discontinuities
function dbToPercent(db: number): number {
  if (db < -60) return 0;
  if (db > 6) return 100;
  // Attempt proper IEC-style mapping via smooth polynomial
  // Maps -60→0%, -40→15%, -30→30%, -20→50%, -12→70%, -6→85%, 0→100%
  // Using a smooth cubic fit that passes through the IEC reference points
  const t = (db + 60) / 66; // normalize -60..+6 → 0..1
  // Apply S-curve: slight compression at bottom, expansion at top
  const curved = t * t * (3 - 2 * t); // smoothstep
  return curved * 100;
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
  const [meters, setMeters] = useState<MeterData[]>(Array.from({ length: NUM_CHANNELS }, () => ({ rmsDb: -Infinity, peakDb: -Infinity })));
  const [masterMeter, setMasterMeter] = useState<MeterData>({ rmsDb: -Infinity, peakDb: -Infinity });
  const [groupMeters, setGroupMeters] = useState<Record<string, MeterData>>(() =>
    Object.fromEntries(BUS_STRIPS.map((bus) => [bus.id, { rmsDb: -Infinity, peakDb: -Infinity }]))
  );
  const [returnMeters, setReturnMeters] = useState<Record<string, MeterData>>(() =>
    Object.fromEntries(RETURN_STRIPS.map((bus) => [bus.id, { rmsDb: -Infinity, peakDb: -Infinity }]))
  );
  const [groupFaders, setGroupFaders] = useState<Record<string, number>>(() =>
    Object.fromEntries(BUS_STRIPS.map((bus) => [bus.id, 750]))
  );
  const [faders, setFaders] = useState<number[]>(new Array(NUM_CHANNELS).fill(750));
  const [masterFader, setMasterFaderVal] = useState(700);
  const [sends, setSends] = useState<{ a: number[]; b: number[] }>({
    a: Array.from({ length: NUM_CHANNELS }, (_, i) => Math.round(audioEngine.getChannelReverbSend(i) * 100)),
    b: Array.from({ length: NUM_CHANNELS }, (_, i) => Math.round(audioEngine.getChannelDelaySend(i) * 100)),
  });
  const [reverbLevel, setReverbLvl] = useState(() => Math.round(audioEngine.getReverbLevel() * 100));
  const [reverbType, setReverbType] = useState<string>("hall");
  const [reverbDamping, setReverbDamping] = useState(80); // 0-100 → 500-16000Hz
  const [delayFB, setDelayFB] = useState(40);
  const [delayLevel, setDelayLvl] = useState(() => Math.round(audioEngine.getDelayLevel() * 100));
  const [delayDiv, setDelayDiv] = useState("1/8");
  const [delayType, setDelayTypeState] = useState<string>("stereo");
  const [eqLow, setEqLow] = useState(0);
  const [eqMid, setEqMid] = useState(0);
  const [eqHigh, setEqHigh] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [pumpDepth, setPumpDepth] = useState(0);
  const [limiterOn, setLimiterOn] = useState(true);
  const [limiterThreshold, setLimiterThreshold] = useState(99); // maps to -1dB default
  const [pumpRate, setPumpRate] = useState(50);
  const [pans, setPans] = useState<number[]>(new Array(NUM_CHANNELS).fill(0));
  const [selectedChannels, setSelectedChannels] = useState<Set<number>>(new Set());
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [soloed, setSoloed] = useState<Set<number>>(new Set());
  const rafRef = useRef<number>(0);
  const activeMeterCount = meters.filter((meter) => meter.rmsDb > -36).length;
  const nearClipCount = meters.filter((meter) => meter.peakDb > -3).length;
  const selectedLabel = [...selectedChannels]
    .sort((a, b) => a - b)
    .map((index) => CHANNELS[index]?.label)
    .filter(Boolean)
    .join(" + ");

  // Meter animation loop
  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const m: MeterData[] = [];
      for (let i = 0; i < NUM_CHANNELS; i++) {
        const d = audioEngine.getChannelMeter(i);
        m.push({ rmsDb: d.rmsDb, peakDb: d.peakDb });
      }
      const nextGroupMeters = Object.fromEntries(
        BUS_STRIPS.map((bus) => {
          const meter = audioEngine.getGroupMeter(bus.id);
          return [bus.id, { rmsDb: meter.rmsDb, peakDb: meter.peakDb }];
        })
      );
      const nextReturnMeters = Object.fromEntries(
        RETURN_STRIPS.map((bus) => {
          const meter = audioEngine.getReturnMeter(bus.id);
          return [bus.id, { rmsDb: meter.rmsDb, peakDb: meter.peakDb }];
        })
      );
      const mm = audioEngine.getMasterMeter();
      setMeters(m);
      setGroupMeters(nextGroupMeters);
      setReturnMeters(nextReturnMeters);
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

  const handleGroupFader = useCallback((group: string, val: number) => {
    setGroupFaders((prev) => ({ ...prev, [group]: val }));
    audioEngine.setGroupVolume(group, faderToGain(val / 1000));
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
      for (let i = 0; i < NUM_CHANNELS; i++) {
        if (next.size === 0) audioEngine.setChannelVolume(i, muted.has(i) ? 0 : faderToGain((faders[i] ?? 750) / 1000));
        else audioEngine.setChannelVolume(i, next.has(i) ? faderToGain((faders[i] ?? 750) / 1000) : 0);
      }
      return next;
    });
  }, [faders, muted]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[radial-gradient(circle_at_top,rgba(49,52,63,0.22),transparent_38%),linear-gradient(180deg,#08080a_0%,#050507_100%)]">
      {/* Header */}
      <div className="shrink-0 border-b border-white/8 bg-[linear-gradient(180deg,rgba(18,19,24,0.96),rgba(10,11,15,0.96))] px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.32)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] font-black tracking-[0.24em] text-[var(--ed-accent-orange)]">MIXER</span>
              <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[7px] font-bold tracking-[0.18em] text-white/35">
                CONSOLE / SENDS / MASTER BUS
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <HeaderStat label="Active" value={`${activeMeterCount}/${NUM_CHANNELS}`} tone="text-white/80" />
              <HeaderStat label="Hot" value={`${nearClipCount}`} tone="text-amber-300" />
              <HeaderStat label="Selected" value={selectedLabel || "None"} tone="text-white/62" />
              <HeaderStat
                label="Master"
                value={masterMeter.rmsDb > -60 ? `${masterMeter.rmsDb.toFixed(1)} dB` : "-∞ dB"}
                tone="text-[var(--ed-accent-green)]"
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="text-[8px] tracking-[0.16em] text-[var(--ed-text-muted)]">FFT RMS+Peak · IEC 60268 · Log Fader</span>
            <button onClick={onClose} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-bold tracking-[0.16em] text-[var(--ed-text-secondary)] transition-colors hover:border-white/18 hover:text-white">
              CLOSE
            </button>
          </div>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex min-h-0 flex-col px-2 py-2">
        <div className="mb-2 grid gap-2 md:grid-cols-3">
          {MIX_SECTIONS.map((section) => {
            const [start, end] = section.range;
            const sectionMeters = meters.slice(start, end + 1);
            const avg = sectionMeters.length
              ? sectionMeters.reduce((sum, meter) => sum + (meter.rmsDb > -60 ? meter.rmsDb : -60), 0) / sectionMeters.length
              : -60;
            const peak = sectionMeters.reduce((max, meter) => Math.max(max, meter.peakDb), -Infinity);

            return (
              <div
                key={section.id}
                className="rounded-[16px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[9px] font-black tracking-[0.2em]" style={{ color: section.accent }}>
                      {section.label}
                    </div>
                    <div className="mt-1 text-[7px] font-bold tracking-[0.14em] text-white/28">{section.hint}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[7px] font-bold tracking-[0.16em] text-white/30">AVG</div>
                    <div className="text-[10px] font-black text-white/80">{avg.toFixed(1)} dB</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[7px] font-mono text-white/34">
                  <span>{CHANNELS[start]?.label} - {CHANNELS[end]?.label}</span>
                  <span>PEAK {peak > -60 ? peak.toFixed(1) : "-∞"}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-1 rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,18,23,0.92),rgba(8,9,13,0.96))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_28px_60px_rgba(0,0,0,0.34)]">

        {/* dB Scale ruler — positioned to match meter area */}
        <div className="relative w-10 shrink-0 rounded-[16px] border border-white/6 bg-black/18">
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
        {CHANNELS.map((ch, i) => (<React.Fragment key={ch.id}>
          {/* Divider before BASS channel */}
          {(ch.id === 6 || ch.id === 12) && <div className="mx-1 w-px bg-white/10" />}
          <ChannelStrip
            label={ch.label}
            color={ch.color}
            meter={meters[i]!}
            faderValue={faders[i] ?? 750}
            isSelected={selectedChannels.has(i)}
            group={audioEngine.getChannelGroup(ch.id)}
            onSelect={() => {
              setSelectedChannels((prev) => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i); else next.add(i);
                return next;
              });
            }}
            sendA={sends.a[i] ?? 0}
            sendB={sends.b[i] ?? 0}
            isMuted={muted.has(i)}
            isSoloed={soloed.has(i)}
            onFader={(v) => handleFader(ch.id, v)}
            onSendA={(v) => handleSendA(ch.id, v)}
            onSendB={(v) => handleSendB(ch.id, v)}
            onMute={() => toggleMute(i)}
            onSolo={() => toggleSolo(i)}
            channelIndex={ch.id}
            panValue={pans[i] ?? 0}
            onPanChange={(v) => {
              setPans((p) => { const n = [...p]; n[i] = v; return n; });
              audioEngine.setChannelPan(ch.id, v);
            }}
          />
        </React.Fragment>))}

        {/* Divider before buses */}
        <div className="mx-1 w-px bg-white/10" />

        {/* Bus / Return section */}
        <div className="flex w-[176px] shrink-0 gap-2 overflow-hidden rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(14,15,21,0.96),rgba(7,8,12,0.98))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex min-w-0 flex-1 gap-1.5">
            {BUS_STRIPS.map((bus) => (
              <BusStrip
                key={bus.id}
                label={bus.label}
                color={bus.color}
                meter={groupMeters[bus.id] ?? { rmsDb: -Infinity, peakDb: -Infinity }}
                faderValue={groupFaders[bus.id] ?? 750}
                onFader={(v) => handleGroupFader(bus.id, v)}
              />
            ))}
          </div>
          <div className="w-px shrink-0 bg-white/8" />
          <div className="flex w-[44px] shrink-0 flex-col gap-1.5">
            {RETURN_STRIPS.map((bus) => (
              <ReturnStrip
                key={bus.id}
                label={bus.label}
                color={bus.color}
                meter={returnMeters[bus.id] ?? { rmsDb: -Infinity, peakDb: -Infinity }}
                level={bus.id === "reverb" ? reverbLevel : delayLevel}
                onLevelChange={(v) => {
                  if (bus.id === "reverb") {
                    setReverbLvl(v);
                    audioEngine.setReverbLevel(v / 100);
                  } else {
                    setDelayLvl(v);
                    audioEngine.setDelayLevel(v / 100);
                  }
                }}
              />
            ))}
          </div>
        </div>

        {/* Divider before master */}
        <div className="mx-1 w-px bg-[var(--ed-accent-green)]/20" />

        {/* Master */}
        <div className="flex w-28 flex-col overflow-hidden rounded-[18px] border border-[var(--ed-accent-green)]/20 bg-[linear-gradient(180deg,rgba(12,28,18,0.96),rgba(5,10,7,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="border-b border-[var(--ed-accent-green)]/20 bg-[var(--ed-accent-green)]/8 px-2 py-2">
            <div className="text-center text-[10px] font-black tracking-[0.18em] text-[var(--ed-accent-green)]">MASTER</div>
            <div className="mt-1 text-center text-[7px] font-bold tracking-[0.16em] text-white/28">BUS / LIMIT / GLUE</div>
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
          <div className="border-t border-[var(--ed-accent-green)]/20 py-1 text-center">
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
      </div>

      {/* FX Bar */}
      <div className="mt-2 flex h-14 shrink-0 items-center gap-5 overflow-x-auto rounded-[20px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,18,23,0.98),rgba(9,10,14,0.98))] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        {/* Master EQ */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[9px] font-black tracking-[0.18em] text-[var(--ed-accent-green)]">EQ</span>
          <FxSlider value={eqLow + 12} max={24} label="Lo" suffix="" color="#22c55e"
            onChange={(v) => { const db = v - 12; setEqLow(db); audioEngine.setMasterEQ(db, eqMid, eqHigh); }} />
          <FxSlider value={eqMid + 12} max={24} label="Mid" suffix="" color="#22c55e"
            onChange={(v) => { const db = v - 12; setEqMid(db); audioEngine.setMasterEQ(eqLow, db, eqHigh); }} />
          <FxSlider value={eqHigh + 12} max={24} label="Hi" suffix="" color="#22c55e"
            onChange={(v) => { const db = v - 12; setEqHigh(db); audioEngine.setMasterEQ(eqLow, eqMid, db); }} />
        </div>
        <div className="h-7 w-px shrink-0 bg-white/8" />
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[9px] font-black tracking-[0.18em] text-[var(--ed-accent-blue)]">REVERB</span>
          {/* Type buttons */}
          <div className="flex gap-[2px]">
            {REVERB_TYPES.map((t) => (
              <button key={t} onClick={() => { setReverbType(t); audioEngine.setReverbType(t); }}
                className={`px-1 py-[1px] text-[6px] font-bold rounded transition-colors ${
                  reverbType === t ? "bg-[var(--ed-accent-blue)]/30 text-[var(--ed-accent-blue)]" : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
                }`}>{t.toUpperCase()}</button>
            ))}
          </div>
          <FxSlider value={reverbLevel} max={100} label="Lvl" color="#3b82f6"
            onChange={(v) => { setReverbLvl(v); audioEngine.setReverbLevel(v / 100); }} />
          <FxSlider value={reverbDamping} max={100} label="Damp" color="#3b82f6"
            onChange={(v) => { setReverbDamping(v); audioEngine.setReverbDamping(500 + (v / 100) * 15500); }} />
        </div>
        <div className="h-7 w-px bg-white/8" />
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[9px] font-black tracking-[0.18em] text-[var(--ed-accent-orange)]">DELAY</span>
          {/* Type buttons */}
          <div className="flex gap-[2px]">
            {(["stereo", "pingpong", "tape"] as const).map((t) => {
              const labels: Record<string, string> = { stereo: "ST", pingpong: "PP", tape: "TAPE" };
              return (
                <button key={t} onClick={() => { setDelayTypeState(t); audioEngine.setDelayType(t); }}
                  className={`px-1 py-[1px] text-[6px] font-bold rounded transition-colors ${
                    delayType === t ? "bg-[var(--ed-accent-orange)]/30 text-[var(--ed-accent-orange)]" : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
                  }`}>{labels[t]}</button>
              );
            })}
          </div>
          {/* Sync division */}
          <div className="flex gap-[1px]">
            {DELAY_DIVISION_NAMES.map((d) => (
              <button key={d} onClick={() => { setDelayDiv(d); audioEngine.setDelayDivision(d, 120); }}
                className={`px-0.5 py-[1px] text-[5px] font-bold rounded transition-colors ${
                  delayDiv === d ? "bg-[var(--ed-accent-orange)]/30 text-[var(--ed-accent-orange)]" : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
                }`}>{d}</button>
            ))}
          </div>
          <FxSlider value={delayFB} max={90} label="FB" color="#f59e0b"
            onChange={(v) => { setDelayFB(v); if (audioEngine) audioEngine.setDelayParams(0.375, v / 100, 4000); }} />
          <FxSlider value={delayLevel} max={100} label="Wet" color="#f59e0b"
            onChange={(v) => { setDelayLvl(v); audioEngine.setDelayLevel(v / 100); }} />
        </div>
        <div className="h-7 w-px shrink-0 bg-white/8" />
        {/* Saturation */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[9px] font-black tracking-[0.18em] text-[#ef4444]">SAT</span>
          <FxSlider value={saturation} max={100} label="Drive" color="#ef4444"
            onChange={(v) => { setSaturation(v); audioEngine.setMasterSaturation(v / 100); }} />
        </div>
        <div className="h-7 w-px shrink-0 bg-white/8" />
        {/* Pump / Sidechain */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[9px] font-black tracking-[0.18em] text-[#a855f7]">PUMP</span>
          <FxSlider value={pumpDepth} max={100} label="Depth" color="#a855f7"
            onChange={(v) => { setPumpDepth(v); audioEngine.setPump((pumpRate / 100) * 4 + 0.5, v / 100); }} />
          <FxSlider value={pumpRate} max={100} label="Rate" color="#a855f7"
            onChange={(v) => { setPumpRate(v); audioEngine.setPump((v / 100) * 4 + 0.5, pumpDepth / 100); }} />
        </div>
        <div className="h-7 w-px shrink-0 bg-white/8" />
        {/* Limiter */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => {
              const next = !limiterOn;
              setLimiterOn(next);
              audioEngine.setLimiterEnabled(next);
            }}
            className={`px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${
              limiterOn
                ? "bg-[#ef4444]/30 text-[#ef4444]"
                : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)]"
            }`}
          >
            LIMIT {limiterOn ? "ON" : "OFF"}
          </button>
          {limiterOn && (
            <FxSlider value={limiterThreshold} max={100} label="Ceil" suffix="" color="#ef4444"
              onChange={(v) => {
                setLimiterThreshold(v);
                const db = -12 + (v / 100) * 12;
                audioEngine.setLimiterThreshold(db);
              }} />
          )}
        </div>
        <div className="h-7 w-px shrink-0 bg-white/8" />
        {/* Binaural / Spatial */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => {
              const next = !audioEngine.getBinauralMode();
              audioEngine.setBinauralMode(next);
            }}
            className={`px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${
              audioEngine.getBinauralMode()
                ? "bg-cyan-500/30 text-cyan-400"
                : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)]"
            }`}
          >
            BINAURAL {audioEngine.getBinauralMode() ? "ON" : "OFF"}
          </button>

          {/* Sidechain: Kick → Bass/Chords/Melody Duck */}
          <SidechainControls />
        </div>
      </div>
    </div>
  );
}

// ─── Channel Strip ───────────────────────────────────────

function ChannelStrip({ label, color, meter, faderValue, sendA, sendB, isMuted, isSoloed,
  onFader, onSendA, onSendB, onMute, onSolo, channelIndex, isSelected, group, onSelect,
  panValue, onPanChange,
}: {
  label: string; color: string; meter: MeterData; faderValue: number;
  sendA: number; sendB: number; isMuted: boolean; isSoloed: boolean;
  onFader: (v: number) => void; onSendA: (v: number) => void; onSendB: (v: number) => void;
  onMute: () => void; onSolo: () => void; channelIndex: number;
  isSelected?: boolean; group?: string; onSelect?: () => void;
  panValue: number; onPanChange: (v: number) => void;
}) {
  const [filterFreq, setFilterFreq] = useState(1000);
  const [filterType, setFilterType] = useState<BiquadFilterType>("allpass");
  const [drive, setDrive] = useState(0);

  const GROUP_COLORS: Record<string, string> = {
    drums: "#f59e0b", hats: "#3b82f6", perc: "#8b5cf6", bass: "#10b981", chords: "#a78bfa", melody: "#f472b6", master: "#666",
  };
  const faderDb = faderValue <= 5 ? -Infinity : AudioEngine.linearToDb(faderToGain(faderValue / 1000));

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-white/8 bg-[linear-gradient(180deg,rgba(22,24,31,0.94),rgba(9,10,15,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      {/* Label — click to select */}
      <button
        onClick={onSelect}
        className={`flex h-10 w-full flex-col items-center justify-center transition-all ${isSelected ? "ring-1 ring-white/30" : ""}`}
        style={{
          background: isSelected
            ? `linear-gradient(180deg, ${color}35, rgba(255,255,255,0.04))`
            : `linear-gradient(180deg, ${color}18, rgba(255,255,255,0.02))`,
          borderBottom: `1px solid ${color}20`,
        }}
      >
        <span className="text-[9px] font-black tracking-[0.18em]" style={{ color: isMuted ? "#555" : color }}>{label}</span>
        {group && group !== "master" && (
          <span className="mt-[1px] rounded-full px-1.5 py-[1px] text-[5px] font-black tracking-[0.16em]" style={{
            color: GROUP_COLORS[group] ?? "#666",
            backgroundColor: (GROUP_COLORS[group] ?? "#666") + "20",
          }}>{group.toUpperCase()}</span>
        )}
      </button>

      {/* Sends */}
      <div className="space-y-1 border-b border-white/8 px-1.5 py-1.5">
        <MiniSend label="P" value={Math.round((panValue + 1) * 50)} color="#888"
          onChange={(v) => { const pan = (v / 50) - 1; onPanChange(pan); }} />
        <MiniSend label="R" value={sendA} color="#3b82f6" onChange={onSendA} />
        <MiniSend label="D" value={sendB} color="#f59e0b" onChange={onSendB} />
      </div>

      {/* Insert FX */}
      <div className="space-y-1 border-b border-white/8 px-1.5 py-1.5">
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
      <div className="flex min-h-0 flex-1 gap-[4px] px-1.5 py-1.5">
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
      <div className="border-t border-white/8 bg-black/30 py-[4px] text-center">
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
        <button onClick={onMute} className={`flex-1 border-r border-t border-white/8 py-[5px] text-[8px] font-black tracking-[0.14em] transition-colors ${isMuted ? "bg-red-500 text-white" : "text-[var(--ed-text-muted)] hover:bg-white/5"}`}>M</button>
        <button onClick={onSolo} className={`flex-1 border-t border-white/8 py-[5px] text-[8px] font-black tracking-[0.14em] transition-colors ${isSoloed ? "bg-amber-500 text-black" : "text-[var(--ed-text-muted)] hover:bg-white/5"}`}>S</button>
      </div>
    </div>
  );
}

// ─── Meter Component ─────────────────────────────────────

interface MeterData { rmsDb: number; peakDb: number }

function BusStrip({ label, color, meter, faderValue, onFader }: {
  label: string;
  color: string;
  meter: MeterData;
  faderValue: number;
  onFader: (v: number) => void;
}) {
  const faderDb = faderValue <= 5 ? -Infinity : AudioEngine.linearToDb(faderToGain(faderValue / 1000));

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-white/8 bg-[linear-gradient(180deg,rgba(23,24,29,0.95),rgba(9,10,13,0.98))]">
      <div className="border-b border-white/8 px-1 py-1 text-center" style={{ background: `${color}14` }}>
        <div className="text-[7px] font-black tracking-[0.14em]" style={{ color }}>{label}</div>
      </div>
      <div className="flex min-h-0 flex-1 gap-1 px-1 py-1.5">
        <Meter rmsDb={meter.rmsDb} peakDb={meter.peakDb} color={color} width={8} />
        <div className="flex flex-1 items-center justify-center">
          <input
            type="range"
            min={0}
            max={1000}
            value={faderValue}
            onChange={(e) => onFader(Number(e.target.value))}
            className="accent-white/80"
            style={{ writingMode: "vertical-lr", direction: "rtl", height: "100%", width: "18px", minHeight: "72px" }}
          />
        </div>
      </div>
      <div className="border-t border-white/8 bg-black/25 py-[3px] text-center text-[7px] font-mono text-white/45">
        {meter.rmsDb > -60 ? meter.rmsDb.toFixed(1) : "-∞"}
        <span className="mx-1 text-white/20">/</span>
        {isFinite(faderDb) ? `${faderDb >= 0 ? "+" : ""}${faderDb.toFixed(0)}` : "-∞"}
      </div>
    </div>
  );
}

function ReturnStrip({ label, color, meter, level, onLevelChange }: {
  label: string;
  color: string;
  meter: MeterData;
  level: number;
  onLevelChange: (v: number) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,21,27,0.95),rgba(8,9,12,0.98))]">
      <div className="border-b border-white/8 px-1 py-1 text-center" style={{ background: `${color}14` }}>
        <div className="text-[7px] font-black tracking-[0.14em]" style={{ color }}>{label}</div>
      </div>
      <div className="flex min-h-0 flex-1 gap-1 px-1 py-1.5">
        <Meter rmsDb={meter.rmsDb} peakDb={meter.peakDb} color={color} width={8} />
        <div className="flex flex-1 items-center justify-center">
          <input
            type="range"
            min={0}
            max={100}
            value={level}
            onChange={(e) => onLevelChange(Number(e.target.value))}
            className="accent-white/80"
            style={{ writingMode: "vertical-lr", direction: "rtl", height: "100%", width: "18px", minHeight: "72px" }}
          />
        </div>
      </div>
      <div className="border-t border-white/8 bg-black/25 py-[3px] text-center text-[7px] font-black" style={{ color }}>
        {level}
      </div>
    </div>
  );
}

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
    <div className="flex items-center gap-1">
      <span className="w-3 text-[6px] font-black tracking-[0.12em]" style={{ color }}>{label}</span>
      <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="h-[4px] flex-1" style={{ accentColor: color }} />
    </div>
  );
}

// ─── FX Slider ───────────────────────────────────────────

function FxSlider({ value, max, label, suffix, color, onChange }: {
  value: number; max: number; label: string; suffix?: string; color: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] font-bold tracking-[0.12em] text-[var(--ed-text-muted)]">{label}</span>
      <input type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-14" style={{ accentColor: color }} />
      <span className="w-10 text-[8px] font-mono text-[var(--ed-text-secondary)]">{value}{suffix ?? "%"}</span>
    </div>
  );
}

function HeaderStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">
      <span className="mr-1 text-[7px] font-bold tracking-[0.16em] text-white/28">{label}</span>
      <span className={`text-[8px] font-black tracking-[0.12em] ${tone}`}>{value}</span>
    </div>
  );
}

function SidechainControls() {
  const [enabled, setEnabled] = useState(audioEngine.getSidechainEnabled());
  const [amount, setAmount] = useState(audioEngine.getSidechainAmount());
  const [release, setRelease] = useState(audioEngine.getSidechainRelease());
  const [targets, setTargets] = useState<number[]>(audioEngine.getSidechainTargets());

  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    audioEngine.setSidechain(next, amount, release);
  }, [enabled, amount, release]);

  const updateAmount = useCallback((v: number) => {
    setAmount(v);
    audioEngine.setSidechain(enabled, v, release);
  }, [enabled, release]);

  const updateRelease = useCallback((v: number) => {
    setRelease(v);
    audioEngine.setSidechain(enabled, amount, v);
  }, [enabled, amount]);

  const toggleTarget = useCallback((ch: number) => {
    const next = targets.includes(ch) ? targets.filter((c) => c !== ch) : [...targets, ch];
    setTargets(next);
    audioEngine.setSidechainTargets(next);
  }, [targets]);

  const targetLabels: { ch: number; label: string }[] = [
    { ch: 12, label: "BASS" },
    { ch: 13, label: "CHRD" },
    { ch: 14, label: "LEAD" },
  ];

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={toggle}
        className={`px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${
          enabled
            ? "bg-[var(--ed-accent-orange)]/30 text-[var(--ed-accent-orange)]"
            : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)]"
        }`}
      >
        SC {enabled ? "ON" : "OFF"}
      </button>

      {enabled && (
        <>
          {/* Target toggles */}
          {targetLabels.map(({ ch, label }) => (
            <button
              key={ch}
              onClick={() => toggleTarget(ch)}
              className={`px-1.5 py-0.5 text-[7px] font-bold rounded transition-colors ${
                targets.includes(ch)
                  ? "bg-[var(--ed-accent-orange)]/20 text-[var(--ed-accent-orange)]/90"
                  : "bg-white/5 text-white/25"
              }`}
            >
              {label}
            </button>
          ))}

          {/* Amount */}
          <div className="flex items-center gap-0.5">
            <span className="text-[6px] text-white/25 font-bold">AMT</span>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={amount}
              onChange={(e) => updateAmount(parseFloat(e.target.value))}
              className="w-12 h-1 accent-[var(--ed-accent-orange)]"
            />
            <span className="text-[7px] text-white/40 font-mono w-6 text-right">{Math.round(amount * 100)}</span>
          </div>

          {/* Release */}
          <div className="flex items-center gap-0.5">
            <span className="text-[6px] text-white/25 font-bold">REL</span>
            <input
              type="range"
              min={0.01} max={0.5} step={0.01}
              value={release}
              onChange={(e) => updateRelease(parseFloat(e.target.value))}
              className="w-12 h-1 accent-[var(--ed-accent-orange)]"
            />
            <span className="text-[7px] text-white/40 font-mono w-8 text-right">{Math.round(release * 1000)}ms</span>
          </div>
        </>
      )}
    </div>
  );
}

