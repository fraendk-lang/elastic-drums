// src/components/MixerBar.tsx
/**
 * MixerBar — Permanent bottom mixer strip.
 *
 * Compact mode (always visible):
 *   channel name | peak meter | volume fader | M/S buttons
 *
 * Expanded mode (click channel header):
 *   + EQ Hi/Mid/Lo knobs | Rev/Dly send knobs | Pan knob
 */

import { useEffect, useRef, useState } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { useMixerBarStore, faderToGain, NUM_MIXER_CHANNELS, GROUP_BUS_IDS, type GroupBusId } from "../store/mixerBarStore";
import { Knob } from "./Knob";

// ── Channel meta ──────────────────────────────────────────────────────────────

const CHANNELS: { id: number; label: string; color: string }[] = [
  { id:  0, label: "KICK",  color: "#f59e0b" },
  { id:  1, label: "SNARE", color: "#f59e0b" },
  { id:  2, label: "CLAP",  color: "#f59e0b" },
  { id:  3, label: "TOM L", color: "#f59e0b" },
  { id:  4, label: "TOM M", color: "#f59e0b" },
  { id:  5, label: "TOM H", color: "#f59e0b" },
  { id:  6, label: "HH CL", color: "#3b82f6" },
  { id:  7, label: "HH OP", color: "#3b82f6" },
  { id:  8, label: "CYM",   color: "#3b82f6" },
  { id:  9, label: "RIDE",  color: "#3b82f6" },
  { id: 10, label: "PRC 1", color: "#8b5cf6" },
  { id: 11, label: "PRC 2", color: "#8b5cf6" },
  { id: 12, label: "BASS",  color: "#10b981" },
  { id: 13, label: "CHRD",  color: "#a78bfa" },
  { id: 14, label: "LEAD",  color: "#f472b6" },
  { id: 15, label: "SAMPL", color: "#f97316" },
  { id: 16, label: "LOOPS", color: "#2EC4B6" },
];

// ── Group bus meta ────────────────────────────────────────────────────────────

const GROUP_BUSES: { id: GroupBusId; label: string; color: string }[] = [
  { id: "drums",   label: "DRUMS", color: "#f59e0b" },
  { id: "hats",    label: "HATS",  color: "#3b82f6" },
  { id: "perc",    label: "PERC",  color: "#8b5cf6" },
  { id: "bass",    label: "BASS",  color: "#10b981" },
  { id: "chords",  label: "CHRD",  color: "#a78bfa" },
  { id: "melody",  label: "LEAD",  color: "#f472b6" },
  { id: "sampler", label: "SMPL",  color: "#f97316" },
  { id: "loops",   label: "LOOPS", color: "#2EC4B6" },
];

// ── Peak meter per channel ────────────────────────────────────────────────────

function useMeterData() {
  const peakRef = useRef<number[]>(new Array(NUM_MIXER_CHANNELS).fill(-Infinity));
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>(new Array(NUM_MIXER_CHANNELS).fill(null));
  const rafRef = useRef(0);

  useEffect(() => {
    let meterBuf: Float32Array<ArrayBuffer> | null = null;
    let lastT = 0;

    const draw = (now: DOMHighResTimeStamp) => {
      // Throttle to ~20fps (VU meters don't need 60fps)
      if (now - lastT < 50) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastT = now;

      for (let i = 0; i < NUM_MIXER_CHANNELS; i++) {
        const canvas = canvasRefs.current[i];
        if (!canvas) continue;
        const analyser = audioEngine.getChannelAnalyser(i);
        if (!analyser) continue;

        // Reuse buffer — avoids new Float32Array(2048) allocation every frame
        if (!meterBuf || meterBuf.length < analyser.fftSize) {
          meterBuf = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
        }
        analyser.getFloatTimeDomainData(meterBuf);
        let peak = 0;
        for (let j = 0; j < analyser.fftSize; j++) peak = Math.max(peak, Math.abs(meterBuf[j]!));
        const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
        // Peak hold: 2 dB/frame × 20fps = ~40 dB/s decay (~1.5 s to floor)
        peakRef.current[i] = Math.max(peakRef.current[i]! - 2.0, db);

        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        const { width: w, height: h } = canvas;
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, w, h);

        // Level fill
        const clampDb = Math.max(-60, Math.min(0, db));
        const frac = (clampDb + 60) / 60;
        const fillH = frac * h;
        const gradient = ctx.createLinearGradient(0, h - fillH, 0, h);
        // Professional meter thresholds: red = true clip zone, yellow = caution, green = normal
        gradient.addColorStop(0, db > -1.5 ? "#ef4444" : db > -6 ? "#fbbf24" : "#22c55e");
        gradient.addColorStop(1, "#16a34a");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, h - fillH, w, fillH);

        // Peak hold line
        const peakDb = peakRef.current[i]!;
        if (peakDb > -60) {
          const peakFrac = (Math.max(-60, Math.min(0, peakDb)) + 60) / 60;
          const py = h - peakFrac * h;
          ctx.fillStyle = peakDb > -1.5 ? "#ef4444" : "#86efac";
          ctx.fillRect(0, py, w, 1);
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return canvasRefs;
}

// ── Group bus meter data ──────────────────────────────────────────────────────

function useGroupMeterData() {
  const peakRef    = useRef<number[]>(new Array(GROUP_BUS_IDS.length).fill(-Infinity));
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>(new Array(GROUP_BUS_IDS.length).fill(null));
  const rafRef     = useRef(0);

  useEffect(() => {
    let meterBuf: Float32Array<ArrayBuffer> | null = null;
    let lastT = 0;

    const draw = (now: DOMHighResTimeStamp) => {
      if (now - lastT < 50) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastT = now;

      for (let i = 0; i < GROUP_BUS_IDS.length; i++) {
        const canvas = canvasRefs.current[i];
        if (!canvas) continue;
        const analyser = audioEngine.getGroupAnalyser(GROUP_BUS_IDS[i]!);
        if (!analyser) continue;

        if (!meterBuf || meterBuf.length < analyser.fftSize) {
          meterBuf = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
        }
        analyser.getFloatTimeDomainData(meterBuf);
        let peak = 0;
        for (let j = 0; j < analyser.fftSize; j++) peak = Math.max(peak, Math.abs(meterBuf[j]!));
        const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
        peakRef.current[i] = Math.max(peakRef.current[i]! - 2.0, db);

        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        const { width: w, height: h } = canvas;
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, w, h);

        const clampDb = Math.max(-60, Math.min(0, db));
        const frac    = (clampDb + 60) / 60;
        const fillH   = frac * h;
        const gradient = ctx.createLinearGradient(0, h - fillH, 0, h);
        gradient.addColorStop(0, db > -1.5 ? "#ef4444" : db > -6 ? "#fbbf24" : "#22c55e");
        gradient.addColorStop(1, "#16a34a");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, h - fillH, w, fillH);

        const peakDb = peakRef.current[i]!;
        if (peakDb > -60) {
          const peakFrac = (Math.max(-60, Math.min(0, peakDb)) + 60) / 60;
          const py = h - peakFrac * h;
          ctx.fillStyle = peakDb > -1.5 ? "#ef4444" : "#86efac";
          ctx.fillRect(0, py, w, 1);
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return canvasRefs;
}

// ── Group Bus Panel ───────────────────────────────────────────────────────────

interface GroupBusPanelProps {
  groupCanvasRefs: ReturnType<typeof useGroupMeterData>;
}

function GroupBusPanel({ groupCanvasRefs }: GroupBusPanelProps) {
  const groupBuses    = useMixerBarStore((s) => s.groupBuses);
  const setGroupFader = useMixerBarStore((s) => s.setGroupFader);
  const setGroupMute  = useMixerBarStore((s) => s.setGroupMute);

  useEffect(() => {
    GROUP_BUS_IDS.forEach((id) => {
      const bus = groupBuses[id]!;
      const gain = bus.muted ? 0 : faderToGain(bus.fader);
      audioEngine.setGroupVolume(id, gain);
    });
  }, [groupBuses]);

  return (
    <div className="border-b border-white/[0.06] bg-[#0a0a0a]">
      <div className="flex items-center gap-px py-1.5 px-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex items-center justify-center min-w-[32px] mr-1">
          <span className="text-[6px] font-black tracking-[0.18em] text-white/20">BUS</span>
        </div>

        {GROUP_BUSES.map(({ id, label, color }, i) => {
          const bus = groupBuses[id]!;
          return (
            <div
              key={id}
              className="flex flex-col items-center gap-1 min-w-[46px] px-1 rounded hover:bg-white/[0.02] transition-colors"
            >
              <span
                className="text-[7px] font-black tracking-[0.12em] uppercase"
                style={{ color: bus.muted ? "#333" : color }}
              >
                {label}
              </span>

              <div className="flex gap-1 items-end h-[56px]">
                <canvas
                  ref={(el) => { groupCanvasRefs.current[i] = el; }}
                  width={4}
                  height={56}
                  className="rounded-sm"
                  style={{ opacity: bus.muted ? 0.25 : 1, transition: "opacity 0.15s" }}
                />

                <div className="relative" style={{ width: 8, height: 56 }}>
                  <div className="absolute inset-0 rounded bg-[#111] border border-white/[0.06]" />
                  <div
                    className="absolute left-0 right-0 h-px bg-white/20"
                    style={{ top: `${(1 - 750 / 1000) * 100}%` }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={1000}
                    value={bus.fader}
                    onChange={(e) => setGroupFader(id, Number(e.target.value))}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    style={{ writingMode: "vertical-lr" as const, direction: "rtl" as const }}
                    title={`${(faderToGain(bus.fader) * 100).toFixed(0)}%`}
                  />
                  <div
                    className="absolute left-1/2 -translate-x-1/2 w-4 h-2 rounded-sm bg-[#3a3a3a] border border-white/20 pointer-events-none"
                    style={{ top: `calc(${(1 - bus.fader / 1000)} * (100% - 8px))` }}
                  />
                </div>
              </div>

              <button
                onClick={() => setGroupMute(id, !bus.muted)}
                className={`w-5 h-3.5 text-[6px] font-black rounded-sm border transition-colors ${
                  bus.muted
                    ? "bg-orange-500/30 border-orange-500/60 text-orange-400"
                    : "bg-transparent border-white/10 text-white/20 hover:border-white/25"
                }`}
              >
                M
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MixerBar() {
  const {
    channels, expandedChannel,
    setFader, setMute, setSolo, setPan, setEQ, setSendRev, setSendDly, setExpanded,
  } = useMixerBarStore();

  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const canvasRefs      = useMeterData();
  const groupCanvasRefs = useGroupMeterData();

  const anySoloed = channels.some((ch) => ch.soloed);

  // Apply fader + mute/solo to audioEngine whenever they change
  useEffect(() => {
    const soloed = new Set(channels.flatMap((ch, i) => ch.soloed ? [i] : []));
    channels.forEach((ch, i) => {
      let gain: number;
      if (soloed.size > 0) {
        // Soloed+muted channels are silenced — mute takes precedence
        gain = (soloed.has(i) && !ch.muted) ? faderToGain(ch.fader) : 0;
      } else {
        gain = ch.muted ? 0 : faderToGain(ch.fader);
      }
      audioEngine.setChannelVolume(i, gain);
    });
  }, [channels]);

  return (
    <div className="relative flex flex-col shrink-0 bg-[#0e0e0e] border-t border-white/[0.07]">
      {/* Expanded panel — rendered above the strip */}
      {expandedChannel !== null && (
        <ExpandedPanel
          channel={channels[expandedChannel]!}
          color={CHANNELS[expandedChannel]?.color ?? "#888"}
          label={CHANNELS[expandedChannel]?.label ?? ""}
          onClose={() => setExpanded(null)}
          onEQ={(band, gain) => { setEQ(expandedChannel, band, gain); audioEngine.setChannelEQ(expandedChannel, band, gain); }}
          onPan={(pan) => { setPan(expandedChannel, pan); audioEngine.setChannelPan(expandedChannel, pan); }}
          onSendRev={(v) => { setSendRev(expandedChannel, v); audioEngine.setChannelReverbSend(expandedChannel, v / 100); }}
          onSendDly={(v) => { setSendDly(expandedChannel, v); audioEngine.setChannelDelaySend(expandedChannel, v / 100); }}
        />
      )}

      {/* Group Bus Panel — rendered above channel strips when open */}
      {groupPanelOpen && (
        <GroupBusPanel groupCanvasRefs={groupCanvasRefs} />
      )}

      {/* Compact strips — horizontal scroll */}
      <div className="flex overflow-x-auto gap-px py-1.5 px-1 scrollbar-none" style={{ scrollbarWidth: "none" }}>
        {CHANNELS.map(({ id, label, color }) => {
          const ch = channels[id]!;
          const isExpanded = expandedChannel === id;

          return (
            <div
              key={id}
              className={`flex flex-col items-center gap-1 min-w-[46px] px-1 rounded transition-colors ${
                isExpanded ? "bg-white/[0.04] ring-1 ring-white/10" : "hover:bg-white/[0.02]"
              }`}
              style={{
                opacity: anySoloed && !ch.soloed && !ch.muted ? 0.4 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {/* Channel name — click to expand */}
              <button
                onClick={() => setExpanded(isExpanded ? null : id)}
                className="w-full text-center"
              >
                <span
                  className="text-[7px] font-black tracking-[0.14em] uppercase"
                  style={{ color: ch.muted ? "#333" : color }}
                >
                  {label}
                </span>
                <span className="text-[6px] text-white/15 ml-0.5">{isExpanded ? "▴" : "▾"}</span>
              </button>

              {/* Peak meter + fader side by side */}
              <div className="flex gap-1 items-end h-[56px]">
                {/* Meter */}
                <canvas
                  ref={(el) => { canvasRefs.current[id] = el; }}
                  width={4}
                  height={56}
                  className="rounded-sm"
                  style={{ opacity: ch.muted ? 0.25 : 1, transition: "opacity 0.15s" }}
                />

                {/* Fader */}
                <div className="relative" style={{ width: 8, height: 56 }}>
                  <div className="absolute inset-0 rounded bg-[#111] border border-white/[0.06]" />
                  {/* Unity tick */}
                  <div
                    className="absolute left-0 right-0 h-px bg-white/20"
                    style={{ top: `${(1 - 750 / 1000) * 100}%` }}
                  />
                  {/* Thumb */}
                  <input
                    type="range"
                    min={0}
                    max={1000}
                    value={ch.fader}
                    onChange={(e) => setFader(id, Number(e.target.value))}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    style={{ writingMode: "vertical-lr" as const, direction: "rtl" as const }}
                    title={`${(faderToGain(ch.fader) * 100).toFixed(0)}%`}
                  />
                  {/* Visual thumb */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 w-4 h-2 rounded-sm bg-[#3a3a3a] border border-white/20 pointer-events-none"
                    style={{ top: `calc(${(1 - ch.fader / 1000)} * (100% - 8px))` }}
                  />
                </div>
              </div>

              {/* Mute + Solo */}
              <div className="flex gap-0.5">
                <button
                  onClick={() => setMute(id, !ch.muted)}
                  className={`w-5 h-3.5 text-[6px] font-black rounded-sm border transition-colors ${
                    ch.muted
                      ? "bg-orange-500/30 border-orange-500/60 text-orange-400"
                      : "bg-transparent border-white/10 text-white/20 hover:border-white/25"
                  }`}
                >
                  M
                </button>
                <button
                  onClick={() => setSolo(id, !ch.soloed)}
                  className={`w-5 h-3.5 text-[6px] font-black rounded-sm border transition-colors ${
                    ch.soloed
                      ? "bg-yellow-500/30 border-yellow-500/60 text-yellow-400"
                      : "bg-transparent border-white/10 text-white/20 hover:border-white/25"
                  }`}
                >
                  S
                </button>
              </div>
            </div>
          );
        })}

        {/* Group Bus toggle — sticky right */}
        <div className="sticky right-0 flex items-center pl-1 ml-auto shrink-0 bg-[#0e0e0e]">
          <button
            onClick={() => setGroupPanelOpen((v) => !v)}
            className="flex flex-col items-center justify-center gap-0.5 px-1.5 py-1 rounded border transition-all"
            style={{
              borderColor: groupPanelOpen ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.07)",
              background:  groupPanelOpen ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
              color:       groupPanelOpen ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)",
            }}
            title="Toggle Group Bus faders"
          >
            <span className="text-[6px] font-black tracking-[0.14em]">GROUP</span>
            <span className="text-[8px] leading-none">{groupPanelOpen ? "▾" : "▴"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Expanded panel ────────────────────────────────────────────────────────────

interface ExpandedPanelProps {
  channel:  import("../store/mixerBarStore").ChannelMixState;
  color:    string;
  label:    string;
  onClose:  () => void;
  onEQ:     (band: "lo" | "mid" | "hi", gain: number) => void;
  onPan:    (pan: number) => void;
  onSendRev:(v: number) => void;
  onSendDly:(v: number) => void;
}

function ExpandedPanel({ channel, color, label, onClose, onEQ, onPan, onSendRev, onSendDly }: ExpandedPanelProps) {
  return (
    <div className="flex items-end gap-4 px-3 py-2 bg-[#111] border-b border-white/[0.06]">
      {/* Label */}
      <div className="flex flex-col items-center gap-0.5 mr-1">
        <span className="text-[7px] font-black tracking-widest uppercase" style={{ color }}>{label}</span>
        <button onClick={onClose} className="text-[6px] text-white/20 hover:text-white/40">▾ close</button>
      </div>

      {/* Divider */}
      <div className="w-px self-stretch bg-white/[0.06]" />

      {/* EQ */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[6px] font-bold tracking-[0.15em] text-white/25 uppercase">EQ</span>
        <div className="flex gap-2">
          <Knob label="HI"  value={channel.eqHi}  min={-12} max={12} defaultValue={0} onChange={(v) => onEQ("hi",  v)} color={color} size={22} />
          <Knob label="MID" value={channel.eqMid} min={-12} max={12} defaultValue={0} onChange={(v) => onEQ("mid", v)} color={color} size={22} />
          <Knob label="LO"  value={channel.eqLo}  min={-12} max={12} defaultValue={0} onChange={(v) => onEQ("lo",  v)} color={color} size={22} />
        </div>
      </div>

      <div className="w-px self-stretch bg-white/[0.06]" />

      {/* Sends */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[6px] font-bold tracking-[0.15em] text-white/25 uppercase">SENDS</span>
        <div className="flex gap-2">
          <Knob label="REV" value={channel.sendRev} min={0} max={100} defaultValue={0} onChange={onSendRev} color="#3b82f6" size={22} />
          <Knob label="DLY" value={channel.sendDly} min={0} max={100} defaultValue={0} onChange={onSendDly} color="#3b82f6" size={22} />
        </div>
      </div>

      <div className="w-px self-stretch bg-white/[0.06]" />

      {/* Pan */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[6px] font-bold tracking-[0.15em] text-white/25 uppercase">PAN</span>
        <Knob label="PAN" value={channel.pan * 50 + 50} min={0} max={100} defaultValue={50}
          onChange={(v) => onPan((v - 50) / 50)} color={color} size={28} />
      </div>
    </div>
  );
}
