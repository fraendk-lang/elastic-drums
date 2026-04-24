/**
 * MixerPanel — Fullscreen Mixer (Redesign v3)
 *
 * Layout: Concept B + A hybrid
 *  - Group boxes: DRUMS / TOPS / MUSIC
 *  - Send dots (clickable popover)
 *  - Pan track visual
 *  - Engine badge
 *  - VIEW toggle: MIN / STD / EXT
 *  - Tabs: CHANNELS / SENDS / BUS
 *  - FX bar with type-buttons
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { audioEngine, AudioEngine, DELAY_DIVISION_NAMES, REVERB_TYPES } from "../audio/AudioEngine";
import type { ReverbType } from "../audio/SendFx";
import { ChannelFxRack } from "./ChannelFxRack";

// ─── Channel meta ────────────────────────────────────────

const CHANNELS = [
  { id:  0, label: "KICK",  color: "#f59e0b", badge: "DRUM" },
  { id:  1, label: "SNARE", color: "#f59e0b", badge: "DRUM" },
  { id:  2, label: "CLAP",  color: "#f59e0b", badge: "DRUM" },
  { id:  3, label: "TOM L", color: "#f59e0b", badge: "DRUM" },
  { id:  4, label: "TOM M", color: "#f59e0b", badge: "DRUM" },
  { id:  5, label: "TOM H", color: "#f59e0b", badge: "DRUM" },
  { id:  6, label: "HH CL", color: "#3b82f6", badge: "HAT" },
  { id:  7, label: "HH OP", color: "#3b82f6", badge: "HAT" },
  { id:  8, label: "CYM",   color: "#3b82f6", badge: "CYM" },
  { id:  9, label: "RIDE",  color: "#3b82f6", badge: "RIDE" },
  { id: 10, label: "PRC 1", color: "#8b5cf6", badge: "PERC" },
  { id: 11, label: "PRC 2", color: "#8b5cf6", badge: "PERC" },
  { id: 12, label: "BASS",  color: "#10b981", badge: "303" },
  { id: 13, label: "CHRD",  color: "#a78bfa", badge: "SYN" },
  { id: 14, label: "LEAD",  color: "#f472b6", badge: "SYN" },
  { id: 15, label: "SAMPL", color: "#f97316", badge: "SMPL" },
];

const NUM_CHANNELS = CHANNELS.length;

const GROUPS = [
  { id: "drums", label: "DRUMS", color: "#f59e0b", channels: [0, 1, 2, 3, 4, 5] },
  { id: "tops",  label: "TOPS",  color: "#3b82f6", channels: [6, 7, 8, 9, 10, 11] },
  { id: "music", label: "MUSIC", color: "#10b981", channels: [12, 13, 14, 15] },
];

const BUS_STRIPS = [
  { id: "drums",  label: "DRM",  color: "#f59e0b" },
  { id: "hats",   label: "TOP",  color: "#3b82f6" },
  { id: "perc",   label: "PRC",  color: "#8b5cf6" },
  { id: "bass",   label: "BSS",  color: "#10b981" },
  { id: "chords", label: "CHD",  color: "#a78bfa" },
  { id: "melody", label: "LED",  color: "#f472b6" },
] as const;

const RETURN_STRIPS = [
  { id: "reverb", label: "REV", color: "#3b82f6" },
  { id: "delay",  label: "DLY", color: "#f59e0b" },
] as const;

type ViewMode = "min" | "std" | "ext";
type TabMode  = "channels" | "sends" | "bus";
type SendKey  = "a" | "b" | "c" | "d";

// ─── IEC meter scale ────────────────────────────────────

function dbToPercent(db: number): number {
  if (db < -60) return 0;
  if (db > 6)   return 100;
  const t = (db + 60) / 66;
  const curved = t * t * (3 - 2 * t);
  return curved * 100;
}

function faderToGain(pos: number): number {
  if (pos <= 0.005) return 0;
  const db = pos < 0.75
    ? -60 + (pos / 0.75) * 60
    : (pos - 0.75) / 0.25 * 6;
  return AudioEngine.dbToLinear(db);
}

// ─── Types ───────────────────────────────────────────────

interface MeterData { rmsDb: number; peakDb: number }

interface MixerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Main component ──────────────────────────────────────

export function MixerPanel({ isOpen, onClose }: MixerPanelProps) {
  const [meters, setMeters] = useState<MeterData[]>(
    Array.from({ length: NUM_CHANNELS }, () => ({ rmsDb: -Infinity, peakDb: -Infinity }))
  );
  const [masterMeter,  setMasterMeter]  = useState<MeterData>({ rmsDb: -Infinity, peakDb: -Infinity });
  const [groupMeters,  setGroupMeters]  = useState<Record<string, MeterData>>(() =>
    Object.fromEntries(BUS_STRIPS.map((b) => [b.id, { rmsDb: -Infinity, peakDb: -Infinity }]))
  );
  const [returnMeters, setReturnMeters] = useState<Record<string, MeterData>>(() =>
    Object.fromEntries(RETURN_STRIPS.map((b) => [b.id, { rmsDb: -Infinity, peakDb: -Infinity }]))
  );

  const [faders,      setFaders]      = useState<number[]>(new Array(NUM_CHANNELS).fill(750));
  const [masterFader, setMasterFader] = useState(700);
  const [groupFaders, setGroupFaders] = useState<Record<string, number>>(() =>
    Object.fromEntries(BUS_STRIPS.map((b) => [b.id, 750]))
  );
  const [pans,    setPans]    = useState<number[]>(new Array(NUM_CHANNELS).fill(0));
  const [muted,   setMuted]   = useState<Set<number>>(new Set());
  const [soloed,  setSoloed]  = useState<Set<number>>(new Set());

  const [sends, setSends] = useState<{ a: number[]; b: number[]; c: number[]; d: number[] }>({
    a: Array.from({ length: NUM_CHANNELS }, (_, i) => Math.round(audioEngine.getChannelReverbSend(i) * 100)),
    b: Array.from({ length: NUM_CHANNELS }, (_, i) => Math.round(audioEngine.getChannelDelaySend(i) * 100)),
    c: Array.from({ length: NUM_CHANNELS }, (_, i) => Math.round(audioEngine.getChannelChorusSend(i) * 100)),
    d: Array.from({ length: NUM_CHANNELS }, (_, i) => Math.round(audioEngine.getChannelPhaserSend(i) * 100)),
  });

  const [reverbLevel,   setReverbLevel]   = useState(() => Math.round(audioEngine.getReverbLevel() * 100));
  const [reverbType,    setReverbType]    = useState("hall");
  const [reverbDamping, setReverbDamping] = useState(80);
  const [delayFB,       setDelayFB]       = useState(40);
  const [delayLevel,    setDelayLevel]    = useState(() => Math.round(audioEngine.getDelayLevel() * 100));
  const [delayDiv,      setDelayDiv]      = useState("1/8");
  const [delayType,     setDelayType]     = useState("stereo");
  const [eqLow,  setEqLow]  = useState(0);
  const [eqMid,  setEqMid]  = useState(0);
  const [eqHigh, setEqHigh] = useState(0);
  const [saturation,    setSaturation]    = useState(0);
  const [pumpDepth,     setPumpDepth]     = useState(0);
  const [pumpRate,      setPumpRate]      = useState(50);
  const [limiterOn,     setLimiterOn]     = useState(true);
  const [limiterThresh, setLimiterThresh] = useState(99);

  const [viewMode, setViewMode] = useState<ViewMode>("std");
  const [activeTab, setActiveTab] = useState<TabMode>("channels");
  const [sendPopover, setSendPopover] = useState<{ ch: number; send: SendKey; rect: DOMRect } | null>(null);
  const [fxRackChannel, setFxRackChannel] = useState<{ index: number; label: string; color: string } | null>(null);

  const rafRef = useRef<number>(0);

  // ── Meter loop ──────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    let lastT = 0;
    const tick = (now: DOMHighResTimeStamp) => {
      if (now - lastT >= 66) {
        lastT = now;
        const m: MeterData[] = [];
        for (let i = 0; i < NUM_CHANNELS; i++) {
          // Gate: if the analyser has no real signal, clear immediately.
          // This bypasses stale peakLevels in meteringEngine (which decay slowly).
          const an = audioEngine.getChannelAnalyser(i);
          if (an) {
            const buf = new Float32Array(an.fftSize);
            an.getFloatTimeDomainData(buf);
            let pk = 0;
            for (let s = 0; s < buf.length; s++) pk = Math.max(pk, Math.abs(buf[s]!));
            if (pk < 1e-6) {
              m.push({ rmsDb: -Infinity, peakDb: -Infinity });
              continue;
            }
          }
          const d = audioEngine.getChannelMeter(i);
          m.push({ rmsDb: d.rmsDb, peakDb: d.peakDb });
        }
        setMeters(m);
        setGroupMeters(Object.fromEntries(
          BUS_STRIPS.map((b) => {
            const d = audioEngine.getGroupMeter(b.id);
            return [b.id, { rmsDb: d.rmsDb, peakDb: d.peakDb }];
          })
        ));
        setReturnMeters(Object.fromEntries(
          RETURN_STRIPS.map((b) => {
            const d = audioEngine.getReturnMeter(b.id);
            return [b.id, { rmsDb: d.rmsDb, peakDb: d.peakDb }];
          })
        ));
        const mm = audioEngine.getMasterMeter();
        setMasterMeter({ rmsDb: mm.rmsDb, peakDb: mm.peakDb });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isOpen]);

  // Close popover on outside click
  useEffect(() => {
    if (!sendPopover) return;
    const close = () => setSendPopover(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [sendPopover]);

  // ── Handlers ────────────────────────────────────────────
  const handleFader = useCallback((ch: number, val: number) => {
    setFaders((p) => { const n = [...p]; n[ch] = val; return n; });
    audioEngine.setChannelVolume(ch, faderToGain(val / 1000));
  }, []);

  const handleMasterFader = useCallback((val: number) => {
    setMasterFader(val);
    audioEngine.setMasterVolume(faderToGain(val / 1000));
  }, []);

  const handleGroupFader = useCallback((group: string, val: number) => {
    setGroupFaders((prev) => ({ ...prev, [group]: val }));
    audioEngine.setGroupVolume(group, faderToGain(val / 1000));
  }, []);

  const handleSend = useCallback((ch: number, key: SendKey, v: number) => {
    setSends((p) => {
      const n = { ...p, [key]: [...p[key]] };
      n[key][ch] = v;
      return n;
    });
    if (key === "a") audioEngine.setChannelReverbSend(ch, v / 100);
    if (key === "b") audioEngine.setChannelDelaySend(ch, v / 100);
    if (key === "c") audioEngine.setChannelChorusSend(ch, v / 100);
    if (key === "d") audioEngine.setChannelPhaserSend(ch, v / 100);
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

  const hotCount = meters.filter((m) => m.peakDb > -3).length;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#08090d]"
      onClick={() => setSendPopover(null)}
    >
      {/* ── Header ─────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between gap-4 px-5 py-3 border-b border-white/[0.07] bg-[linear-gradient(180deg,rgba(16,18,26,0.99),rgba(10,12,18,0.99))]">
        <div className="flex items-center gap-4">
          <span className="text-[11px] font-black tracking-[0.26em] text-[#f59e0b]">MIXER</span>

          {/* Tabs */}
          <div className="flex gap-[2px] bg-black/30 rounded-lg p-[2px] border border-white/[0.05]">
            {(["channels", "sends", "bus"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-[3px] text-[7px] font-black tracking-[0.16em] rounded-[6px] uppercase transition-all ${
                  activeTab === t
                    ? "bg-white/[0.08] text-white/85"
                    : "text-white/28 hover:text-white/55"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Stats */}
          {hotCount > 0 && (
            <span className="text-[7px] font-black tracking-[0.14em] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">
              {hotCount} HOT
            </span>
          )}
          <span className="text-[7px] font-mono text-white/30">
            {masterMeter.rmsDb > -60 ? `${masterMeter.rmsDb.toFixed(1)} dB` : "-∞ dB"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex gap-[2px] bg-black/30 rounded-lg p-[2px] border border-white/[0.05]">
            {(["min", "std", "ext"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-2.5 py-[3px] text-[7px] font-black tracking-[0.14em] rounded-[6px] uppercase transition-all ${
                  viewMode === v
                    ? "bg-white/[0.08] text-white/85"
                    : "text-white/28 hover:text-white/55"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="text-[8px] font-bold tracking-[0.16em] px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/40 hover:text-white/70 hover:border-white/15 transition-all"
          >
            CLOSE
          </button>
        </div>
      </div>

      {/* ── Main strips area ────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-x-auto overflow-y-hidden px-4 py-3 gap-4 items-stretch">

        {/* CHANNELS / SENDS tabs → show group boxes */}
        {(activeTab === "channels" || activeTab === "sends") && GROUPS.map((group) => (
          <GroupBox key={group.id} label={group.label} color={group.color}>
            {group.channels.map((chId) => {
              const ch = CHANNELS[chId]!;
              return (
                <ChannelStrip
                  key={chId}
                  id={chId}
                  label={ch.label}
                  color={ch.color}
                  badge={ch.badge}
                  meter={meters[chId]!}
                  faderValue={faders[chId] ?? 750}
                  sendA={sends.a[chId] ?? 0}
                  sendB={sends.b[chId] ?? 0}
                  sendC={sends.c[chId] ?? 0}
                  sendD={sends.d[chId] ?? 0}
                  panValue={pans[chId] ?? 0}
                  isMuted={muted.has(chId)}
                  isSoloed={soloed.has(chId)}
                  viewMode={viewMode}
                  sendsOnly={activeTab === "sends"}
                  activeSendPop={sendPopover?.ch === chId ? sendPopover.send : null}
                  onFader={(v) => handleFader(chId, v)}
                  onSend={(key, v) => handleSend(chId, key, v)}
                  onPan={(v) => {
                    setPans((p) => { const n = [...p]; n[chId] = v; return n; });
                    audioEngine.setChannelPan(chId, v);
                  }}
                  onMute={() => toggleMute(chId)}
                  onSolo={() => toggleSolo(chId)}
                  onDotClick={(send, rect) => {
                    setSendPopover((prev) =>
                      prev?.ch === chId && prev.send === send ? null : { ch: chId, send, rect }
                    );
                  }}
                  onOpenFxRack={() => setFxRackChannel({ index: chId, label: ch.label, color: ch.color })}
                />
              );
            })}
          </GroupBox>
        ))}

        {/* BUS tab → show bus strips + returns */}
        {activeTab === "bus" && (
          <div className="flex gap-3 items-stretch">
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
            <div className="w-px bg-white/[0.07] mx-1 self-stretch" />
            {RETURN_STRIPS.map((bus) => (
              <ReturnStrip
                key={bus.id}
                label={bus.label}
                color={bus.color}
                meter={returnMeters[bus.id] ?? { rmsDb: -Infinity, peakDb: -Infinity }}
                level={bus.id === "reverb" ? reverbLevel : delayLevel}
                onLevel={(v) => {
                  if (bus.id === "reverb") { setReverbLevel(v); audioEngine.setReverbLevel(v / 100); }
                  else { setDelayLevel(v); audioEngine.setDelayLevel(v / 100); }
                }}
              />
            ))}
          </div>
        )}

        {/* Always show divider + master */}
        <div className="w-px bg-white/[0.05] shrink-0 self-stretch mx-1" />
        <MasterStrip
          meter={masterMeter}
          faderValue={masterFader}
          onFader={handleMasterFader}
          limiterOn={limiterOn}
          grReduction={audioEngine.getCompressorReduction()}
        />
      </div>

      {/* ── Send popover ────────────────────────────────── */}
      {sendPopover && (
        <SendPopover
          ch={sendPopover.ch}
          send={sendPopover.send}
          value={
            sendPopover.send === "a" ? sends.a[sendPopover.ch] ?? 0
            : sendPopover.send === "b" ? sends.b[sendPopover.ch] ?? 0
            : sendPopover.send === "c" ? sends.c[sendPopover.ch] ?? 0
            : sends.d[sendPopover.ch] ?? 0
          }
          rect={sendPopover.rect}
          onChange={(v) => handleSend(sendPopover.ch, sendPopover.send, v)}
        />
      )}

      {/* ── FX Bar ─────────────────────────────────────── */}
      <FxBar
        eqLow={eqLow} eqMid={eqMid} eqHigh={eqHigh}
        reverbLevel={reverbLevel} reverbType={reverbType} reverbDamping={reverbDamping}
        delayFB={delayFB} delayLevel={delayLevel} delayDiv={delayDiv} delayType={delayType}
        saturation={saturation}
        pumpDepth={pumpDepth} pumpRate={pumpRate}
        limiterOn={limiterOn} limiterThresh={limiterThresh}
        onEqLow={(v)  => { setEqLow(v);  audioEngine.setMasterEQ(v, eqMid, eqHigh); }}
        onEqMid={(v)  => { setEqMid(v);  audioEngine.setMasterEQ(eqLow, v, eqHigh); }}
        onEqHigh={(v) => { setEqHigh(v); audioEngine.setMasterEQ(eqLow, eqMid, v); }}
        onReverbLevel={(v)   => { setReverbLevel(v);   audioEngine.setReverbLevel(v / 100); }}
        onReverbType={(t)    => { setReverbType(t);    audioEngine.setReverbType(t); }}
        onReverbDamping={(v) => { setReverbDamping(v); audioEngine.setReverbDamping(500 + (v / 100) * 15500); }}
        onDelayFB={(v)  => { setDelayFB(v);    audioEngine.setDelayParams(0.375, v / 100, 4000); }}
        onDelayWet={(v) => { setDelayLevel(v); audioEngine.setDelayLevel(v / 100); }}
        onDelayDiv={(d) => { setDelayDiv(d);   audioEngine.setDelayDivision(d, 120); }}
        onDelayType={(t) => { setDelayType(t); audioEngine.setDelayType(t); }}
        onSaturation={(v) => { setSaturation(v); audioEngine.setMasterSaturation(v / 100); }}
        onPumpDepth={(v) => { setPumpDepth(v); audioEngine.setPump((pumpRate / 100) * 4 + 0.5, v / 100); }}
        onPumpRate={(v)  => { setPumpRate(v);  audioEngine.setPump((v / 100) * 4 + 0.5, pumpDepth / 100); }}
        onLimiterToggle={() => { const n = !limiterOn; setLimiterOn(n); audioEngine.setLimiterEnabled(n); }}
        onLimiterThresh={(v) => { setLimiterThresh(v); audioEngine.setLimiterThreshold(-12 + (v / 100) * 12); }}
      />

      {/* ── Per-channel FX rack ────────────────────────── */}
      <ChannelFxRack
        channelIndex={fxRackChannel?.index ?? null}
        channelLabel={fxRackChannel?.label ?? ""}
        channelColor={fxRackChannel?.color ?? "#fff"}
        onClose={() => setFxRackChannel(null)}
      />
    </div>
  );
}

// ─── GroupBox ────────────────────────────────────────────

function GroupBox({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 flex-shrink-0">
      <div
        className="text-center text-[6px] font-black tracking-[0.24em] py-1.5 px-3 rounded-lg"
        style={{ color, background: `${color}12`, border: `1px solid ${color}20` }}
      >
        {label}
      </div>
      <div
        className="flex gap-2 flex-1 p-2 rounded-[14px]"
        style={{ background: `${color}06`, border: `1px solid ${color}10` }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Channel Strip ───────────────────────────────────────

interface ChannelStripProps {
  id: number; label: string; color: string; badge: string;
  meter: MeterData; faderValue: number;
  sendA: number; sendB: number; sendC: number; sendD: number;
  panValue: number; isMuted: boolean; isSoloed: boolean;
  viewMode: ViewMode; sendsOnly: boolean;
  activeSendPop: SendKey | null;
  onFader: (v: number) => void;
  onSend: (key: SendKey, v: number) => void;
  onPan: (v: number) => void;
  onMute: () => void; onSolo: () => void;
  onDotClick: (send: SendKey, rect: DOMRect) => void;
  onOpenFxRack: () => void;
}

function ChannelStrip({
  id, label, color, badge, meter, faderValue,
  sendA, sendB, sendC, sendD, panValue,
  isMuted, isSoloed, viewMode, sendsOnly, activeSendPop,
  onFader, onSend, onPan, onMute, onSolo, onDotClick, onOpenFxRack,
}: ChannelStripProps) {
  const faderDb = faderValue <= 5
    ? -Infinity
    : AudioEngine.linearToDb(faderToGain(faderValue / 1000));

  const SEND_META: { key: SendKey; color: string; label: string }[] = [
    { key: "a", color: "#3b82f6", label: "REV" },
    { key: "b", color: "#f59e0b", label: "DLY" },
    { key: "c", color: "#a78bfa", label: "CHR" },
    { key: "d", color: "#10b981", label: "PHS" },
  ];
  const sendValues: Record<SendKey, number> = { a: sendA, b: sendB, c: sendC, d: sendD };

  return (
    <div
      className="flex flex-col rounded-[12px] overflow-hidden border"
      style={{
        width: 62,
        minWidth: 62,
        background: "linear-gradient(180deg,rgba(20,22,30,0.96),rgba(9,11,16,0.98))",
        borderColor: isSoloed ? color + "60" : isMuted ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.07)",
      }}
    >
      {/* Name + badge */}
      <div
        className="text-center pt-2 pb-1.5 border-b border-white/[0.06]"
        style={{ background: `linear-gradient(180deg,${color}18,${color}06)` }}
      >
        <span
          className="block text-[9px] font-black tracking-[0.14em]"
          style={{ color: isMuted ? "rgba(255,255,255,0.18)" : color }}
        >
          {label}
        </span>
        <span
          className="inline-block mt-[2px] text-[5px] font-black tracking-[0.16em] px-1.5 py-[1px] rounded-full"
          style={{ color, background: `${color}18` }}
        >
          {badge}
        </span>
      </div>

      {/* Send dots — always shown except MIN */}
      {viewMode !== "min" && (
        <div className="flex justify-center gap-[5px] py-[5px] border-b border-white/[0.05]">
          {SEND_META.map(({ key, color: c, label: lbl }) => {
            const val = sendValues[key];
            const active = val > 2;
            const isOpen = activeSendPop === key;
            return (
              <button
                key={key}
                title={`${lbl}: ${val}%`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDotClick(key, e.currentTarget.getBoundingClientRect());
                }}
                className="w-[10px] h-[10px] rounded-full border transition-all"
                style={{
                  background: active ? c : "rgba(255,255,255,0.04)",
                  borderColor: active ? c + "80" : isOpen ? c + "60" : "rgba(255,255,255,0.1)",
                  boxShadow: active ? `0 0 5px ${c}50` : "none",
                  opacity: active ? 1 : 0.4,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Pan track — shown in STD + EXT */}
      {(viewMode === "std" || viewMode === "ext") && !sendsOnly && (
        <PanTrack value={panValue} color={color} onChange={onPan} />
      )}

      {/* EQ + Comp + FX — only in EXT */}
      {viewMode === "ext" && !sendsOnly && (
        <>
          <ChannelEQ channelIndex={id} color={color} />
          <ChannelComp channelIndex={id} color={color} />
          <button
            onClick={onOpenFxRack}
            className="border-b border-white/[0.06] px-2 py-[4px] text-[6px] font-black tracking-[0.14em] text-white/30 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
          >
            FX RACK ▸
          </button>
          <ChannelCrossfaderButtons channelIndex={id} />
        </>
      )}

      {/* Sends sliders — only in SENDS tab */}
      {sendsOnly && (
        <div className="px-2 py-2 border-b border-white/[0.06] space-y-1.5">
          {SEND_META.map(({ key, color: c, label: lbl }) => (
            <div key={key} className="flex items-center gap-1">
              <span className="text-[5px] font-black w-5" style={{ color: c }}>{lbl}</span>
              <input
                type="range" min={0} max={100} value={sendValues[key]}
                onChange={(e) => onSend(key, Number(e.target.value))}
                className="flex-1 h-[4px]"
                style={{ accentColor: c }}
              />
              <span className="text-[5px] font-mono text-white/30 w-4 text-right">{sendValues[key]}</span>
            </div>
          ))}
        </div>
      )}

      {/* Fader + Meter */}
      <div
        className="flex gap-[5px] px-[7px] py-2 flex-1"
        style={{ minHeight: viewMode === "min" ? 120 : viewMode === "std" ? 100 : 80 }}
      >
        <Meter rmsDb={meter.rmsDb} peakDb={meter.peakDb} color={color} width={12} />
        <div className="flex-1 flex items-center justify-center">
          <input
            type="range" min={0} max={1000} value={faderValue}
            onChange={(e) => onFader(Number(e.target.value))}
            className="accent-white/70"
            style={{ writingMode: "vertical-lr", direction: "rtl", height: "100%", width: "24px", minHeight: 60 }}
          />
        </div>
      </div>

      {/* Readout */}
      <div className="border-t border-white/[0.06] bg-black/25 py-[3px] text-center">
        <span className={`text-[7px] font-mono ${meter.peakDb > -1.5 ? "text-red-400" : "text-white/35"}`}>
          {meter.rmsDb > -60 ? meter.rmsDb.toFixed(1) : "-∞"}
        </span>
        {viewMode !== "min" && (
          <span className="text-[6px] font-mono text-white/20 ml-1">
            {isFinite(faderDb) ? `${faderDb >= 0 ? "+" : ""}${faderDb.toFixed(0)}` : "-∞"}
          </span>
        )}
      </div>

      {/* M / S */}
      <div className="flex border-t border-white/[0.06]">
        <button
          onClick={onMute}
          className={`flex-1 py-[5px] text-[7px] font-black tracking-[0.1em] border-r border-white/[0.06] transition-colors ${
            isMuted ? "bg-red-500/80 text-white" : "text-white/25 hover:text-white/60 hover:bg-white/[0.04]"
          }`}
        >M</button>
        <button
          onClick={onSolo}
          className={`flex-1 py-[5px] text-[7px] font-black tracking-[0.1em] transition-colors ${
            isSoloed ? "bg-amber-500 text-black" : "text-white/25 hover:text-white/60 hover:bg-white/[0.04]"
          }`}
        >S</button>
      </div>
    </div>
  );
}

// ─── Pan Track ───────────────────────────────────────────

function PanTrack({ value, color, onChange }: { value: number; color: string; onChange: (v: number) => void }) {
  const pct = (value + 1) * 50; // -1..1 → 0..100
  return (
    <div className="flex items-center gap-1 px-2 py-[4px] border-b border-white/[0.05]">
      <span className="text-[5px] font-black text-white/25 w-4 shrink-0">PAN</span>
      <div className="relative flex-1 h-[3px] bg-white/[0.06] rounded-full">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-[7px] bg-white/15" />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[8px] h-[8px] rounded-full border border-white/25 -translate-x-1/2"
          style={{ left: `${pct}%`, background: Math.abs(value) > 0.05 ? color : "rgba(255,255,255,0.12)" }}
        />
        <input
          type="range" min={-100} max={100} value={Math.round(value * 100)}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full"
          onDoubleClick={() => onChange(0)}
        />
      </div>
    </div>
  );
}

// ─── Send Popover ────────────────────────────────────────

const SEND_NAMES: Record<SendKey, string> = { a: "REVERB", b: "DELAY", c: "CHORUS", d: "PHASER" };
const SEND_COLORS: Record<SendKey, string> = { a: "#3b82f6", b: "#f59e0b", c: "#a78bfa", d: "#10b981" };

function SendPopover({ ch, send, value, rect, onChange }: {
  ch: number; send: SendKey; value: number; rect: DOMRect; onChange: (v: number) => void;
}) {
  return (
    <div
      className="fixed z-[100] rounded-xl border border-white/10 bg-[#141620] shadow-[0_12px_40px_rgba(0,0,0,0.5)] p-3"
      style={{ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 160), width: 148 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[7px] font-black tracking-[0.16em]" style={{ color: SEND_COLORS[send] }}>
          {SEND_NAMES[send]}
        </span>
        <span className="text-[8px] font-mono text-white/50">{value}%</span>
      </div>
      <input
        type="range" min={0} max={100} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-[6px]"
        style={{ accentColor: SEND_COLORS[send] }}
      />
      <div className="flex justify-between mt-1">
        <span className="text-[6px] text-white/20">0</span>
        <span className="text-[6px] text-white/20">50</span>
        <span className="text-[6px] text-white/20">100</span>
      </div>
      <div className="mt-2 text-[6px] text-white/25 text-center">
        Ch {ch + 1} — {CHANNELS[ch]?.label}
      </div>
    </div>
  );
}

// ─── Meter ───────────────────────────────────────────────

function Meter({ rmsDb, peakDb, color, width }: { rmsDb: number; peakDb: number; color: string; width: number }) {
  const rmsPct  = dbToPercent(rmsDb);
  const peakPct = dbToPercent(peakDb);
  const isClip  = peakDb > -1.5;

  const gradient = rmsPct > 85
    ? "linear-gradient(to top,#22c55e 0%,#84cc16 30%,#eab308 60%,#f97316 80%,#ef4444 100%)"
    : rmsPct > 50
      ? "linear-gradient(to top,#22c55e 0%,#84cc16 50%,#eab308 100%)"
      : "#22c55e";

  return (
    <div className="relative rounded-sm overflow-hidden bg-[#080808]" style={{ width, minWidth: width }}>
      {[-6, -12, -24, -40].map((db) => (
        <div key={db} className="absolute left-0 right-0 h-px bg-white/[0.04]" style={{ bottom: `${dbToPercent(db)}%` }} />
      ))}
      <div className="absolute left-0 right-0 h-px bg-red-500/25 z-10" style={{ bottom: `${dbToPercent(0)}%` }} />
      <div
        className="absolute bottom-0 left-0 right-0 transition-[height] duration-[60ms]"
        style={{ height: `${rmsPct}%`, background: gradient, borderRadius: "1px 1px 0 0" }}
      />
      {peakPct > 0.5 && (
        <div
          className="absolute left-0 right-0 z-10"
          style={{
            height: "2px", bottom: `${peakPct}%`,
            backgroundColor: peakDb > -1.5 ? "#ef4444" : peakDb > -6 ? "#eab308" : color,
            boxShadow: peakDb > -1.5 ? "0 0 4px #ef4444" : "none",
          }}
        />
      )}
      {isClip && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-red-500 z-20" style={{ boxShadow: "0 0 6px #ef4444" }} />
      )}
    </div>
  );
}

// ─── Bus Strip ───────────────────────────────────────────

function BusStrip({ label, color, meter, faderValue, onFader }: {
  label: string; color: string; meter: MeterData; faderValue: number; onFader: (v: number) => void;
}) {
  return (
    <div
      className="flex flex-col rounded-[12px] overflow-hidden border border-white/[0.07]"
      style={{ width: 48, background: "linear-gradient(180deg,rgba(18,20,28,0.96),rgba(9,11,16,0.98))" }}
    >
      <div className="text-center py-2 border-b border-white/[0.06]" style={{ background: `${color}12` }}>
        <span className="text-[7px] font-black tracking-[0.14em]" style={{ color }}>{label}</span>
      </div>
      <div className="flex gap-[5px] px-[6px] py-2 flex-1 min-h-[100px]">
        <Meter rmsDb={meter.rmsDb} peakDb={meter.peakDb} color={color} width={10} />
        <div className="flex-1 flex items-center justify-center">
          <input
            type="range" min={0} max={1000} value={faderValue}
            onChange={(e) => onFader(Number(e.target.value))}
            className="accent-white/70"
            style={{ writingMode: "vertical-lr", direction: "rtl", height: "100%", width: "20px", minHeight: 60 }}
          />
        </div>
      </div>
      <div className="border-t border-white/[0.06] bg-black/25 py-[3px] text-center text-[6px] font-mono text-white/30">
        {meter.rmsDb > -60 ? meter.rmsDb.toFixed(1) : "-∞"}
      </div>
    </div>
  );
}

// ─── Return Strip ────────────────────────────────────────

function ReturnStrip({ label, color, meter, level, onLevel }: {
  label: string; color: string; meter: MeterData; level: number; onLevel: (v: number) => void;
}) {
  return (
    <div
      className="flex flex-col rounded-[12px] overflow-hidden border border-white/[0.07]"
      style={{ width: 48, background: "linear-gradient(180deg,rgba(16,18,26,0.97),rgba(8,10,15,0.99))" }}
    >
      <div className="text-center py-2 border-b border-white/[0.06]" style={{ background: `${color}10` }}>
        <span className="text-[7px] font-black tracking-[0.14em]" style={{ color }}>{label}</span>
      </div>
      <div className="flex gap-[5px] px-[6px] py-2 flex-1 min-h-[100px]">
        <Meter rmsDb={meter.rmsDb} peakDb={meter.peakDb} color={color} width={10} />
        <div className="flex-1 flex items-center justify-center">
          <input
            type="range" min={0} max={100} value={level}
            onChange={(e) => onLevel(Number(e.target.value))}
            className="accent-white/70"
            style={{ writingMode: "vertical-lr", direction: "rtl", height: "100%", width: "20px", minHeight: 60 }}
          />
        </div>
      </div>
      <div className="border-t border-white/[0.06] bg-black/25 py-[3px] text-center text-[7px] font-black" style={{ color }}>
        {level}
      </div>
    </div>
  );
}

// ─── Master Strip ─────────────────────────────────────────

function MasterStrip({ meter, faderValue, onFader, limiterOn, grReduction }: {
  meter: MeterData; faderValue: number; onFader: (v: number) => void;
  limiterOn: boolean; grReduction: number;
}) {
  return (
    <div
      className="flex flex-col rounded-[14px] overflow-hidden shrink-0"
      style={{
        width: 72,
        border: "1px solid rgba(34,197,94,0.2)",
        background: "linear-gradient(180deg,rgba(10,24,16,0.97),rgba(4,8,6,0.99))",
      }}
    >
      <div className="text-center pt-2.5 pb-2 border-b border-[rgba(34,197,94,0.15)] bg-[rgba(34,197,94,0.07)]">
        <span className="text-[9px] font-black tracking-[0.2em] text-[#22c55e]">MASTER</span>
        <div className="text-[5px] font-bold tracking-[0.14em] text-white/25 mt-[2px]">GLUE · LIMIT</div>
      </div>

      {/* Meter + fader */}
      <div className="flex gap-[6px] px-[8px] py-3 flex-1 min-h-[110px]">
        <Meter rmsDb={meter.rmsDb} peakDb={meter.peakDb} color="#22c55e" width={14} />
        <div className="flex-1 flex items-center justify-center">
          <input
            type="range" min={0} max={1000} value={faderValue}
            onChange={(e) => onFader(Number(e.target.value))}
            style={{ writingMode: "vertical-lr", direction: "rtl", height: "100%", width: "28px", minHeight: 80, accentColor: "#22c55e" }}
          />
        </div>
      </div>

      {/* GR */}
      <div className="border-t border-[rgba(34,197,94,0.12)] px-2 py-1">
        <div className="flex items-center gap-1">
          <span className="text-[6px] font-black text-white/30">GR</span>
          <div className="flex-1 h-[4px] bg-black/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-yellow-500/80 transition-all duration-75"
              style={{ width: `${Math.min(Math.abs(grReduction) / 20 * 100, 100)}%` }}
            />
          </div>
          <span className="text-[6px] font-mono text-white/30 w-6 text-right">{grReduction.toFixed(1)}</span>
        </div>
      </div>

      {/* Readout */}
      <div className="border-t border-[rgba(34,197,94,0.12)] py-[4px] text-center">
        <div className={`text-[8px] font-mono ${meter.peakDb > -1.5 ? "text-red-400" : "text-[#22c55e]"}`}>
          {meter.rmsDb > -60 ? `${meter.rmsDb.toFixed(1)} dB` : "-∞ dB"}
        </div>
      </div>

      {/* Limiter indicator */}
      <div className="border-t border-[rgba(34,197,94,0.08)] text-center py-1.5">
        <span className={`text-[6px] font-black tracking-[0.12em] px-2 py-0.5 rounded ${
          limiterOn ? "text-red-400 bg-red-500/12" : "text-white/20"
        }`}>
          {limiterOn ? "LIMIT ON" : "LIMIT OFF"}
        </span>
      </div>
    </div>
  );
}

// ─── Channel EQ ──────────────────────────────────────────

function ChannelEQ({ channelIndex, color }: { channelIndex: number; color: string }) {
  const [lo, setLo] = useState(0);
  const [mid, setMid] = useState(0);
  const [hi, setHi] = useState(0);

  return (
    <div className="space-y-0.5 border-b border-white/[0.06] px-2 py-1.5">
      <div className="text-[5px] font-black tracking-[0.18em] text-white/20 text-center mb-0.5">EQ</div>
      {([
        { label: "H", band: "hi"  as const, value: hi,  set: setHi },
        { label: "M", band: "mid" as const, value: mid, set: setMid },
        { label: "L", band: "lo"  as const, value: lo,  set: setLo },
      ]).map(({ label, band, value, set }) => (
        <div key={band} className="flex items-center gap-[3px]">
          <span className="text-[5px] font-black text-white/25 w-2">{label}</span>
          <input
            type="range" min={-12} max={12} step={0.5} value={value}
            onChange={(e) => { const v = parseFloat(e.target.value); set(v); audioEngine.setChannelEQ(channelIndex, band, v); }}
            onDoubleClick={() => { set(0); audioEngine.setChannelEQ(channelIndex, band, 0); }}
            className="flex-1 h-[5px]" style={{ accentColor: color }}
          />
          <span className={`text-[5px] font-mono w-4 text-right ${Math.abs(value) > 0 ? "text-white/50" : "text-white/20"}`}>
            {value > 0 ? `+${value.toFixed(0)}` : value.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Channel Compressor ──────────────────────────────────

function ChannelComp({ channelIndex, color }: { channelIndex: number; color: string }) {
  const [threshold, setThreshold] = useState(0);
  const [ratio, setRatio] = useState(4);
  const active = threshold < -1;

  return (
    <div className="space-y-0.5 border-b border-white/[0.06] px-2 py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[5px] font-black tracking-[0.18em] text-white/20">CMP</span>
        {active && <span className="text-[5px] font-bold text-amber-400/60">{threshold}dB</span>}
      </div>
      <div className="flex items-center gap-[3px]">
        <span className="text-[5px] font-black text-white/25 w-2">T</span>
        <input
          type="range" min={-40} max={0} step={1} value={threshold}
          onChange={(e) => { const v = parseInt(e.target.value); setThreshold(v); audioEngine.setChannelCompressor(channelIndex, v, ratio, 0.01, 0.15); }}
          onDoubleClick={() => { setThreshold(0); audioEngine.bypassChannelCompressor(channelIndex); }}
          className="flex-1 h-[5px]" style={{ accentColor: color }}
        />
      </div>
      {active && (
        <div className="flex items-center gap-[3px]">
          <span className="text-[5px] font-black text-white/25 w-2">R</span>
          <input
            type="range" min={1} max={20} step={0.5} value={ratio}
            onChange={(e) => { const v = parseFloat(e.target.value); setRatio(v); audioEngine.setChannelCompressor(channelIndex, threshold, v, 0.01, 0.15); }}
            className="flex-1 h-[5px]" style={{ accentColor: color }}
          />
          <span className="text-[5px] font-mono text-white/30 w-4 text-right">{ratio}:1</span>
        </div>
      )}
    </div>
  );
}

// ─── Channel Crossfader Buttons ──────────────────────────

function ChannelCrossfaderButtons({ channelIndex }: { channelIndex: number }) {
  const [group, setGroup] = useState<"A" | "B" | "none">(audioEngine.getChannelCrossfaderGroup(channelIndex));
  const set = useCallback((next: "A" | "B" | "none") => {
    setGroup(next);
    audioEngine.setChannelCrossfaderGroup(channelIndex, next);
  }, [channelIndex]);

  return (
    <div className="flex gap-[2px] border-b border-white/[0.06] px-1.5 py-1">
      <button onClick={() => set(group === "A" ? "none" : "A")}
        className={`flex-1 text-[6px] font-black py-[3px] rounded-sm transition-colors ${
          group === "A" ? "bg-blue-500/25 text-blue-400" : "text-white/22 hover:text-white/50 bg-white/[0.03]"
        }`}>A</button>
      <button onClick={() => set(group === "B" ? "none" : "B")}
        className={`flex-1 text-[6px] font-black py-[3px] rounded-sm transition-colors ${
          group === "B" ? "bg-amber-500/25 text-amber-400" : "text-white/22 hover:text-white/50 bg-white/[0.03]"
        }`}>B</button>
    </div>
  );
}

// ─── FX Bar ───────────────────────────────────────────────

interface FxBarProps {
  eqLow: number; eqMid: number; eqHigh: number;
  reverbLevel: number; reverbType: string; reverbDamping: number;
  delayFB: number; delayLevel: number; delayDiv: string; delayType: string;
  saturation: number; pumpDepth: number; pumpRate: number;
  limiterOn: boolean; limiterThresh: number;
  onEqLow: (v: number) => void; onEqMid: (v: number) => void; onEqHigh: (v: number) => void;
  onReverbLevel: (v: number) => void; onReverbType: (t: ReverbType) => void; onReverbDamping: (v: number) => void;
  onDelayFB: (v: number) => void; onDelayWet: (v: number) => void;
  onDelayDiv: (d: string) => void; onDelayType: (t: "stereo" | "pingpong" | "tape") => void;
  onSaturation: (v: number) => void; onPumpDepth: (v: number) => void; onPumpRate: (v: number) => void;
  onLimiterToggle: () => void; onLimiterThresh: (v: number) => void;
}

function FxBar({
  eqLow, eqMid, eqHigh, reverbLevel, reverbType, reverbDamping,
  delayFB, delayLevel, delayDiv, delayType, saturation,
  pumpDepth, pumpRate, limiterOn, limiterThresh,
  onEqLow, onEqMid, onEqHigh, onReverbLevel, onReverbType, onReverbDamping,
  onDelayFB, onDelayWet, onDelayDiv, onDelayType,
  onSaturation, onPumpDepth, onPumpRate, onLimiterToggle, onLimiterThresh,
}: FxBarProps) {
  return (
    <div className="shrink-0 flex items-center gap-4 overflow-x-auto px-5 py-2.5 border-t border-white/[0.06] bg-[linear-gradient(180deg,rgba(12,14,20,0.99),rgba(8,10,16,0.99))]"
      style={{ scrollbarWidth: "none", minHeight: 52 }}>

      {/* EQ */}
      <FxSection name="EQ" color="#22c55e">
        <FxSlider label="LO"  value={eqLow + 12}  max={24} color="#22c55e" suffix="" onChange={(v) => onEqLow(v - 12)} />
        <FxSlider label="MID" value={eqMid + 12}  max={24} color="#22c55e" suffix="" onChange={(v) => onEqMid(v - 12)} />
        <FxSlider label="HI"  value={eqHigh + 12} max={24} color="#22c55e" suffix="" onChange={(v) => onEqHigh(v - 12)} />
      </FxSection>

      <FxDiv />

      {/* Reverb */}
      <FxSection name="REV" color="#3b82f6">
        <FxSlider label="LVL"  value={reverbLevel}   max={100} color="#3b82f6" onChange={onReverbLevel} />
        <FxSlider label="DAMP" value={reverbDamping}  max={100} color="#3b82f6" onChange={onReverbDamping} />
        <div className="flex gap-[2px]">
          {REVERB_TYPES.map((t) => (
            <TypeBtn key={t} active={reverbType === t} color="#3b82f6" onClick={() => onReverbType(t)}>
              {t.toUpperCase().slice(0, 4)}
            </TypeBtn>
          ))}
        </div>
      </FxSection>

      <FxDiv />

      {/* Delay */}
      <FxSection name="DLY" color="#f59e0b">
        <FxSlider label="FB"  value={delayFB}    max={90}  color="#f59e0b" onChange={onDelayFB} />
        <FxSlider label="WET" value={delayLevel}  max={100} color="#f59e0b" onChange={onDelayWet} />
        <div className="flex gap-[2px]">
          {(["stereo", "pingpong", "tape"] as const).map((t) => {
            const lbl = { stereo: "ST", pingpong: "PP", tape: "TP" }[t];
            return <TypeBtn key={t} active={delayType === t} color="#f59e0b" onClick={() => onDelayType(t)}>{lbl}</TypeBtn>;
          })}
        </div>
        <div className="flex gap-[2px] mt-[2px]">
          {DELAY_DIVISION_NAMES.slice(0, 6).map((d) => (
            <TypeBtn key={d} active={delayDiv === d} color="#f59e0b" onClick={() => onDelayDiv(d)}>
              {d}
            </TypeBtn>
          ))}
        </div>
      </FxSection>

      <FxDiv />

      {/* Saturation */}
      <FxSection name="SAT" color="#ef4444">
        <FxSlider label="DRV" value={saturation} max={100} color="#ef4444" onChange={onSaturation} />
      </FxSection>

      <FxDiv />

      {/* Pump */}
      <FxSection name="PUMP" color="#a855f7">
        <FxSlider label="DEP" value={pumpDepth} max={100} color="#a855f7" onChange={onPumpDepth} />
        <FxSlider label="RT"  value={pumpRate}  max={100} color="#a855f7" onChange={onPumpRate} />
      </FxSection>

      <FxDiv />

      {/* Limiter + SC + Crossfader */}
      <FxSection name="" color="#fff">
        <button
          onClick={onLimiterToggle}
          className={`text-[7px] font-black tracking-[0.12em] px-2.5 py-1 rounded-md border transition-colors ${
            limiterOn
              ? "bg-red-500/15 border-red-500/30 text-red-400"
              : "bg-white/[0.03] border-white/[0.08] text-white/30"
          }`}
        >
          LIMIT {limiterOn ? "ON" : "OFF"}
        </button>
        {limiterOn && (
          <FxSlider label="CEIL" value={limiterThresh} max={100} color="#ef4444" onChange={onLimiterThresh} />
        )}
        <SidechainControls />
        <CrossfaderControl />
      </FxSection>
    </div>
  );
}

function FxSection({ name, color, children }: { name: string; color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      {name && (
        <span className="text-[8px] font-black tracking-[0.18em] shrink-0" style={{ color }}>{name}</span>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">{children}</div>
    </div>
  );
}

function FxDiv() {
  return <div className="h-6 w-px bg-white/[0.07] shrink-0" />;
}

function FxSlider({ label, value, max, color, suffix = "%", onChange }: {
  label: string; value: number; max: number; color: string; suffix?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[7px] font-bold tracking-[0.1em] text-white/30 shrink-0">{label}</span>
      <input
        type="range" min={0} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-14 h-[4px]" style={{ accentColor: color }}
      />
      <span className="text-[7px] font-mono text-white/40 w-8 shrink-0">
        {value}{suffix}
      </span>
    </div>
  );
}

function TypeBtn({ active, color, onClick, children }: {
  active: boolean; color: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="text-[6px] font-black px-1 py-[2px] rounded transition-colors"
      style={{
        background: active ? `${color}25` : "rgba(255,255,255,0.03)",
        color: active ? color : "rgba(255,255,255,0.28)",
        border: `1px solid ${active ? color + "40" : "rgba(255,255,255,0.06)"}`,
      }}
    >
      {children}
    </button>
  );
}

// ─── Sidechain Controls ──────────────────────────────────

function SidechainControls() {
  const [enabled, setEnabled] = useState(audioEngine.getSidechainEnabled());
  const [amount,  setAmount]  = useState(audioEngine.getSidechainAmount());
  const [release] = useState(audioEngine.getSidechainRelease());
  const [targets, setTargets] = useState<number[]>(audioEngine.getSidechainTargets());

  const TARGET_LABELS = [{ ch: 12, label: "BSS" }, { ch: 13, label: "CHD" }, { ch: 14, label: "LED" }];

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => { const n = !enabled; setEnabled(n); audioEngine.setSidechain(n, amount, release); }}
        className={`text-[7px] font-black tracking-[0.1em] px-2 py-1 rounded-md border transition-colors ${
          enabled ? "bg-amber-500/15 border-amber-500/30 text-amber-400" : "bg-white/[0.03] border-white/[0.07] text-white/28"
        }`}
      >
        SC {enabled ? "ON" : "OFF"}
      </button>
      {enabled && (
        <>
          {TARGET_LABELS.map(({ ch, label }) => (
            <button
              key={ch}
              onClick={() => {
                const n = targets.includes(ch) ? targets.filter((c) => c !== ch) : [...targets, ch];
                setTargets(n); audioEngine.setSidechainTargets(n);
              }}
              className={`text-[6px] font-black px-1.5 py-[3px] rounded transition-colors ${
                targets.includes(ch) ? "bg-amber-500/15 text-amber-400" : "bg-white/[0.03] text-white/22"
              }`}
            >{label}</button>
          ))}
          <input type="range" min={0} max={1} step={0.05} value={amount}
            onChange={(e) => { const v = parseFloat(e.target.value); setAmount(v); audioEngine.setSidechain(enabled, v, release); }}
            className="w-10 h-[4px] accent-amber-500" title={`Amount: ${Math.round(amount * 100)}%`} />
        </>
      )}
    </div>
  );
}

// ─── Crossfader ──────────────────────────────────────────

function CrossfaderControl() {
  const [value, setValue] = useState(audioEngine.getCrossfader());
  const center = Math.abs(value) < 0.02;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-[7px] font-black ${value < -0.02 ? "text-blue-400" : "text-white/20"}`}>A</span>
      <input
        type="range" min={-1} max={1} step={0.01} value={value}
        onChange={(e) => { const v = parseFloat(e.target.value); setValue(v); audioEngine.setCrossfader(v); }}
        onDoubleClick={() => { setValue(0); audioEngine.setCrossfader(0); }}
        className="w-20 h-[4px] accent-amber-500"
        title="Crossfader (double-click = center)"
      />
      <span className={`text-[7px] font-black ${value > 0.02 ? "text-amber-400" : "text-white/20"}`}>B</span>
      <span className="text-[6px] font-mono text-white/25 w-5">{center ? "—" : value.toFixed(2)}</span>
    </div>
  );
}
