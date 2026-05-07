/**
 * LoopEditor — Ableton-style clip/warp view for sample loops.
 *
 * Shows amplitude waveform + beat-grid overlay, lets user set:
 *  - Native BPM (auto-detected, TAP tempo, or manual input)
 *  - Bar count (½B 1B 2B 4B 8B) — recalculates BPM from duration
 *  - Loop region start/end (drag handles on waveform)
 *  - WARP ON/OFF toggle (enables BPM-stretch + phase-sync)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { sampleManager, type LoopData } from "../audio/SampleManager";

interface Props {
  voiceIndex: number;
  label: string;
  onClose: () => void;
  onLoopDataChange: (data: LoopData | null) => void;
}

const BAR_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "½B", value: 0.5 },
  { label: "1B", value: 1 },
  { label: "2B", value: 2 },
  { label: "4B", value: 4 },
  { label: "8B", value: 8 },
];

const WAVEFORM_COLOR = "#1db584";
const BEAT_GRID_COLOR = "rgba(255,255,255,0.12)";
const BAR_GRID_COLOR = "rgba(255,255,255,0.28)";
const LOOP_FILL = "rgba(29,181,132,0.10)";
const LOOP_BORDER = "#1db584";

export function LoopEditor({ voiceIndex, label, onClose, onLoopDataChange }: Props) {
  const buffer = sampleManager.getSample(voiceIndex)?.buffer ?? null;
  const initialData = sampleManager.getLoopData(voiceIndex) ?? null;

  const [loopData, setLoopDataLocal] = useState<LoopData>(() => initialData ?? {
    isLoop: false, nativeBpm: 0, bars: 1, loopStart: 0, loopEnd: 0,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // TAP tempo
  const tapTimesRef = useRef<number[]>([]);
  const lastTapRef = useRef(0);

  // Drag state for loop handles
  type DragTarget = "start" | "end" | null;
  const dragging = useRef<DragTarget>(null);
  const dragStartX = useRef(0);
  const dragStartSec = useRef(0);

  // ── Commit a change and propagate up ───────────────────────
  const commit = useCallback((patch: Partial<LoopData>) => {
    setLoopDataLocal((prev) => {
      const next = { ...prev, ...patch };
      sampleManager.setLoopData(voiceIndex, next);
      onLoopDataChange(next);
      return next;
    });
  }, [voiceIndex, onLoopDataChange]);

  // ── Draw waveform + beat grid + loop region ─────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const data = buffer.getChannelData(0);
    const duration = buffer.duration;

    ctx.clearRect(0, 0, W, H);

    // ── Background ────────────────────────────────────────────
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);

    // ── Amplitude waveform (RMS per pixel column) ─────────────
    ctx.fillStyle = WAVEFORM_COLOR;
    const samplesPerPixel = Math.ceil(data.length / W);
    for (let x = 0; x < W; x++) {
      let sum = 0;
      const start = x * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, data.length);
      for (let s = start; s < end; s++) {
        sum += (data[s] ?? 0) ** 2;
      }
      const rms = Math.sqrt(sum / (end - start));
      const barH = Math.max(2, rms * H * 1.6);
      ctx.fillRect(x, (H - barH) / 2, 1, barH);
    }

    // ── Beat grid ─────────────────────────────────────────────
    if (loopData.nativeBpm > 0) {
      const secondsPerBeat = 60 / loopData.nativeBpm;
      const secondsPerBar = secondsPerBeat * 4;
      let t = 0;
      let beat = 0;
      while (t <= duration + 0.001) {
        const x = Math.round((t / duration) * W);
        const isBar = beat % 4 === 0;
        ctx.strokeStyle = isBar ? BAR_GRID_COLOR : BEAT_GRID_COLOR;
        ctx.lineWidth = isBar ? 1.5 : 0.75;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
        // Beat number label on bar lines
        if (isBar && beat > 0) {
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.font = "9px monospace";
          ctx.fillText(`${beat / 4 + 1}`, x + 3, 10);
        }
        t += secondsPerBeat;
        beat++;
        if (beat > 256) break; // safety
      }
      // Suppress unused variable
      void secondsPerBar;
    }

    // ── Loop region overlay ───────────────────────────────────
    const loopEnd = loopData.loopEnd > 0 ? loopData.loopEnd : duration;
    const lx0 = (loopData.loopStart / duration) * W;
    const lx1 = (loopEnd / duration) * W;
    ctx.fillStyle = LOOP_FILL;
    ctx.fillRect(lx0, 0, lx1 - lx0, H);
    // Loop boundary lines
    ctx.strokeStyle = LOOP_BORDER;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lx0, 0); ctx.lineTo(lx0, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx1, 0); ctx.lineTo(lx1, H); ctx.stroke();
    // Start handle triangle (pointing right)
    ctx.fillStyle = LOOP_BORDER;
    ctx.beginPath();
    ctx.moveTo(lx0, H / 2 - 7);
    ctx.lineTo(lx0 + 8, H / 2);
    ctx.lineTo(lx0, H / 2 + 7);
    ctx.closePath();
    ctx.fill();
    // End handle triangle (pointing left)
    ctx.beginPath();
    ctx.moveTo(lx1, H / 2 - 7);
    ctx.lineTo(lx1 - 8, H / 2);
    ctx.lineTo(lx1, H / 2 + 7);
    ctx.closePath();
    ctx.fill();

  }, [buffer, loopData]);

  // ── Pointer events for dragging loop handles ───────────────
  const getSecondsFromX = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (x / rect.width) * buffer.duration;
  }, [buffer]);

  const HIT_ZONE = 12; // px on each side of handle

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!buffer) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const W = rect.width;
    const duration = buffer.duration;
    const loopEnd = loopData.loopEnd > 0 ? loopData.loopEnd : duration;

    const startX = (loopData.loopStart / duration) * W;
    const endX = (loopEnd / duration) * W;

    if (Math.abs(x - startX) < HIT_ZONE) {
      dragging.current = "start";
      dragStartX.current = x;
      dragStartSec.current = loopData.loopStart;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else if (Math.abs(x - endX) < HIT_ZONE) {
      dragging.current = "end";
      dragStartX.current = x;
      dragStartSec.current = loopEnd;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }, [buffer, loopData]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !buffer) return;
    const sec = getSecondsFromX(e.clientX);
    const duration = buffer.duration;
    const loopEnd = loopData.loopEnd > 0 ? loopData.loopEnd : duration;

    if (dragging.current === "start") {
      const clamped = Math.max(0, Math.min(sec, loopEnd - 0.05));
      commit({ loopStart: clamped });
    } else if (dragging.current === "end") {
      const clamped = Math.max(loopData.loopStart + 0.05, Math.min(sec, duration));
      // 0 means "use buffer end" — snap to 0 if within 0.02s of buffer end
      const snapped = Math.abs(clamped - duration) < 0.02 ? 0 : clamped;
      commit({ loopEnd: snapped });
    }
  }, [buffer, loopData, commit, getSecondsFromX]);

  const handlePointerUp = useCallback(() => {
    dragging.current = null;
  }, []);

  // ── TAP tempo ─────────────────────────────────────────────
  const handleTap = useCallback(() => {
    const now = performance.now();
    if (now - lastTapRef.current > 2500) tapTimesRef.current = [];
    tapTimesRef.current.push(now);
    lastTapRef.current = now;
    if (tapTimesRef.current.length >= 3) {
      const times = tapTimesRef.current;
      const intervals = times.slice(1).map((t, i) => t - times[i]!);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const tapped = Math.round((60000 / avg) * 10) / 10;
      commit({ nativeBpm: tapped });
    }
  }, [commit]);

  // ── Bar-length button ─────────────────────────────────────
  const handleSetBars = useCallback((bars: number) => {
    if (!buffer) return;
    const bpm = bars > 0
      ? Math.round((bars * 4 * 60 / buffer.duration) * 10) / 10
      : loopData.nativeBpm;
    sampleManager.setBars(voiceIndex, bars);
    commit({ bars, nativeBpm: bpm });
  }, [buffer, voiceIndex, loopData.nativeBpm, commit]);

  // ── BPM manual input ──────────────────────────────────────
  const [bpmInput, setBpmInput] = useState(() => loopData.nativeBpm > 0 ? String(loopData.nativeBpm) : "");
  useEffect(() => {
    if (loopData.nativeBpm > 0) setBpmInput(String(loopData.nativeBpm));
  }, [loopData.nativeBpm]);

  const handleBpmBlur = useCallback(() => {
    const v = parseFloat(bpmInput);
    if (!isNaN(v) && v > 0 && v <= 300) {
      sampleManager.setNativeBpm(voiceIndex, v);
      commit({ nativeBpm: v });
    }
  }, [bpmInput, voiceIndex, commit]);

  if (!buffer) return null;

  const duration = buffer.duration;
  const loopEnd = loopData.loopEnd > 0 ? loopData.loopEnd : duration;
  const loopDurationSec = loopEnd - loopData.loopStart;

  return (
    <div
      ref={containerRef}
      className="mt-2 rounded-lg border border-white/10 bg-[#0d1117] overflow-hidden"
      style={{ boxShadow: "0 0 20px rgba(0,0,0,0.5)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/8">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">{label}</span>
          <span className="text-[9px] text-white/30 truncate max-w-[160px]">
            {sampleManager.getSample(voiceIndex)?.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-white/30">
            {loopDurationSec.toFixed(2)}s
          </span>
          {/* WARP toggle */}
          <button
            onClick={() => commit({ isLoop: !loopData.isLoop })}
            className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${
              loopData.isLoop
                ? "bg-[var(--ed-accent-green)]/20 text-[var(--ed-accent-green)] border-[var(--ed-accent-green)]/40"
                : "bg-white/5 text-white/40 border-white/15 hover:text-white/70"
            }`}
          >
            WARP {loopData.isLoop ? "ON" : "OFF"}
          </button>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/70 text-[14px] leading-none px-1"
            aria-label="Close loop editor"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Waveform canvas */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={600}
          height={72}
          className="w-full block cursor-crosshair"
          style={{ imageRendering: "pixelated" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-white/8 flex-wrap">

        {/* BPM */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-white/40 font-semibold">BPM</span>
          <input
            type="number"
            min={40}
            max={300}
            step={0.1}
            value={bpmInput}
            onChange={(e) => setBpmInput(e.target.value)}
            onBlur={handleBpmBlur}
            onKeyDown={(e) => { if (e.key === "Enter") handleBpmBlur(); }}
            className="w-14 bg-white/5 border border-white/15 rounded px-1.5 py-0.5 text-[10px] text-white/80 text-center focus:outline-none focus:border-[var(--ed-accent-green)]/50"
          />
          <button
            onClick={handleTap}
            className="px-2 py-0.5 rounded text-[9px] font-bold bg-white/5 border border-white/15 text-white/50 hover:text-white/80 hover:border-white/30 active:bg-white/10 transition-all"
          >
            TAP
          </button>
        </div>

        {/* Separator */}
        <div className="w-px h-4 bg-white/10" />

        {/* Bar-length buttons */}
        <div className="flex items-center gap-1">
          {BAR_OPTIONS.map(({ label: bl, value }) => (
            <button
              key={bl}
              onClick={() => handleSetBars(value)}
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all ${
                loopData.bars === value
                  ? "bg-[var(--ed-accent-green)]/20 text-[var(--ed-accent-green)] border-[var(--ed-accent-green)]/40"
                  : "bg-white/5 text-white/40 border-white/10 hover:text-white/70 hover:border-white/25"
              }`}
            >
              {bl}
            </button>
          ))}
        </div>

        {/* Separator */}
        <div className="w-px h-4 bg-white/10" />

        {/* Loop region info */}
        <div className="flex items-center gap-1.5 text-[9px] text-white/35">
          <span>START</span>
          <span className="font-mono text-white/55">{loopData.loopStart.toFixed(3)}s</span>
          <span className="mx-1 text-white/20">·</span>
          <span>END</span>
          <span className="font-mono text-white/55">{loopEnd.toFixed(3)}s</span>
          {loopData.loopStart > 0 || loopData.loopEnd > 0 ? (
            <button
              onClick={() => commit({ loopStart: 0, loopEnd: 0 })}
              className="ml-1 text-white/25 hover:text-white/60 text-[8px]"
              title="Reset loop region to full sample"
            >
              RESET
            </button>
          ) : null}
        </div>

      </div>
    </div>
  );
}
