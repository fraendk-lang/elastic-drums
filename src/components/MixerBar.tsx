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

import { useEffect, useRef } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { useMixerBarStore, faderToGain, NUM_MIXER_CHANNELS } from "../store/mixerBarStore";
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
];

// ── Peak meter per channel ────────────────────────────────────────────────────

function useMeterData() {
  const peakRef = useRef<number[]>(new Array(NUM_MIXER_CHANNELS).fill(-Infinity));
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>(new Array(NUM_MIXER_CHANNELS).fill(null));
  const rafRef = useRef(0);

  useEffect(() => {
    const draw = () => {
      for (let i = 0; i < NUM_MIXER_CHANNELS; i++) {
        const canvas = canvasRefs.current[i];
        if (!canvas) continue;
        const analyser = audioEngine.getChannelAnalyser(i);
        if (!analyser) continue;

        const buf = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let j = 0; j < buf.length; j++) peak = Math.max(peak, Math.abs(buf[j]!));
        const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
        // Peak hold: decay 20dB/s
        peakRef.current[i] = Math.max(peakRef.current[i]! - 0.33, db);

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
        gradient.addColorStop(0, db > -3 ? "#ef4444" : db > -12 ? "#fbbf24" : "#22c55e");
        gradient.addColorStop(1, "#16a34a");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, h - fillH, w, fillH);

        // Peak hold line
        const peakDb = peakRef.current[i]!;
        if (peakDb > -60) {
          const peakFrac = (Math.max(-60, Math.min(0, peakDb)) + 60) / 60;
          const py = h - peakFrac * h;
          ctx.fillStyle = peakDb > -3 ? "#ef4444" : "#86efac";
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

// ── Main component ────────────────────────────────────────────────────────────

export function MixerBar() {
  const {
    channels, expandedChannel,
    setFader, setMute, setSolo, setPan, setEQ, setSendRev, setSendDly, setExpanded,
  } = useMixerBarStore();

  const canvasRefs = useMeterData();

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
                    style={{ top: `calc(${(1 - ch.fader / 1000) * 100}% - 4px)` }}
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
