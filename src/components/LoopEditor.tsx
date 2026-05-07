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
import { sampleManager, type LoopData, type StretchMode, type WarpMarker } from "../audio/SampleManager";
import { detectOnsets } from "../audio/OnsetDetector";

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
const MARKER_COLOR = "#f59e0b";        // amber — distinct from loop region green
const MARKER_GUTTER_HEIGHT = 14;       // px reserved at top of canvas for marker handles
const MARKER_HIT_PX = 10;              // pointer hit-zone around a marker line

export function LoopEditor({ voiceIndex, label, onClose, onLoopDataChange }: Props) {
  const buffer = sampleManager.getSample(voiceIndex)?.buffer ?? null;
  const initialData = sampleManager.getLoopData(voiceIndex) ?? null;

  const [loopData, setLoopDataLocal] = useState<LoopData>(() => initialData ?? {
    isLoop: false, nativeBpm: 0, bars: 1, loopStart: 0, loopEnd: 0, stretchMode: "repitch",
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // TAP tempo
  const tapTimesRef = useRef<number[]>([]);
  const lastTapRef = useRef(0);

  // Drag state for loop handles + warp markers
  type DragTarget =
    | { kind: "loopStart" }
    | { kind: "loopEnd" }
    | { kind: "marker"; index: number }
    | null;
  const dragging = useRef<DragTarget>(null);
  const dragStartX = useRef(0);
  const dragStartSec = useRef(0);

  // Warp markers — mirrored from SampleManager so we can re-render UI on change
  const [markers, setMarkers] = useState<WarpMarker[]>(() =>
    sampleManager.getEffectiveMarkers(voiceIndex)
  );

  // ── Commit a change and propagate up ───────────────────────
  const commit = useCallback((patch: Partial<LoopData>) => {
    setLoopDataLocal((prev) => {
      const next = { ...prev, ...patch };
      sampleManager.setLoopData(voiceIndex, next);
      onLoopDataChange(next);
      return next;
    });
  }, [voiceIndex, onLoopDataChange]);

  // ── Warp marker helpers (used by canvas + pointer events) ──
  const commitMarkers = useCallback((next: WarpMarker[]) => {
    sampleManager.setWarpMarkers(voiceIndex, next);
    setMarkers([...next].sort((a, b) => a.bufferTime - b.bufferTime));
    onLoopDataChange(sampleManager.getLoopData(voiceIndex) ?? null);
  }, [voiceIndex, onLoopDataChange]);

  const showMarkers = loopData.stretchMode === "beats" && loopData.isLoop;

  // ── Draw waveform + beat grid + loop region + warp markers ─
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const gutter = showMarkers ? MARKER_GUTTER_HEIGHT : 0;
    const waveTop = gutter;
    const waveH = H - gutter;
    const data = buffer.getChannelData(0);
    const duration = buffer.duration;

    ctx.clearRect(0, 0, W, H);

    // ── Background ────────────────────────────────────────────
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);

    // Marker gutter background (slightly different shade)
    if (gutter > 0) {
      ctx.fillStyle = "#0a0d12";
      ctx.fillRect(0, 0, W, gutter);
    }

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
      const barH = Math.max(2, rms * waveH * 1.6);
      ctx.fillRect(x, waveTop + (waveH - barH) / 2, 1, barH);
    }

    // ── Beat grid ─────────────────────────────────────────────
    if (loopData.nativeBpm > 0) {
      const secondsPerBeat = 60 / loopData.nativeBpm;
      let t = 0;
      let beat = 0;
      while (t <= duration + 0.001) {
        const x = Math.round((t / duration) * W);
        const isBar = beat % 4 === 0;
        ctx.strokeStyle = isBar ? BAR_GRID_COLOR : BEAT_GRID_COLOR;
        ctx.lineWidth = isBar ? 1.5 : 0.75;
        ctx.beginPath();
        ctx.moveTo(x, waveTop);
        ctx.lineTo(x, H);
        ctx.stroke();
        // Bar number label on bar lines (in the waveform area, not gutter)
        if (isBar && beat > 0) {
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.font = "9px monospace";
          ctx.fillText(`${beat / 4 + 1}`, x + 3, waveTop + 10);
        }
        t += secondsPerBeat;
        beat++;
        if (beat > 256) break; // safety
      }
    }

    // ── Loop region overlay ───────────────────────────────────
    const loopEnd = loopData.loopEnd > 0 ? loopData.loopEnd : duration;
    const lx0 = (loopData.loopStart / duration) * W;
    const lx1 = (loopEnd / duration) * W;
    ctx.fillStyle = LOOP_FILL;
    ctx.fillRect(lx0, waveTop, lx1 - lx0, waveH);
    ctx.strokeStyle = LOOP_BORDER;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lx0, waveTop); ctx.lineTo(lx0, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx1, waveTop); ctx.lineTo(lx1, H); ctx.stroke();
    // Start/End triangles centered in waveform area
    const handleY = waveTop + waveH / 2;
    ctx.fillStyle = LOOP_BORDER;
    ctx.beginPath();
    ctx.moveTo(lx0, handleY - 7); ctx.lineTo(lx0 + 8, handleY); ctx.lineTo(lx0, handleY + 7); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(lx1, handleY - 7); ctx.lineTo(lx1 - 8, handleY); ctx.lineTo(lx1, handleY + 7); ctx.closePath(); ctx.fill();

    // ── Warp markers ──────────────────────────────────────────
    if (showMarkers) {
      ctx.font = "8px monospace";
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i]!;
        const x = (m.bufferTime / duration) * W;
        // Vertical guideline through whole canvas
        ctx.strokeStyle = MARKER_COLOR;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, gutter);
        ctx.lineTo(x, H);
        ctx.stroke();
        ctx.setLineDash([]);

        // Diamond handle in gutter
        const cy = gutter / 2;
        ctx.fillStyle = MARKER_COLOR;
        ctx.beginPath();
        ctx.moveTo(x, cy - 5);
        ctx.lineTo(x + 5, cy);
        ctx.lineTo(x, cy + 5);
        ctx.lineTo(x - 5, cy);
        ctx.closePath();
        ctx.fill();

        // Beat label (B0, B1, ...) — alternate above/below to avoid overlap
        const label = `B${m.beat}`;
        const labelW = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(245,158,11,0.95)";
        const labelX = Math.max(2, Math.min(W - labelW - 2, x + 6));
        ctx.fillText(label, labelX, cy + 3);
      }
    }

  }, [buffer, loopData, markers, showMarkers]);

  // ── Pointer events for dragging loop handles ───────────────
  const getSecondsFromX = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (x / rect.width) * buffer.duration;
  }, [buffer]);

  const HIT_ZONE = 12; // px on each side of loop handle

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!buffer) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const W = rect.width;
    const H = rect.height;
    const gutterScreenH = showMarkers ? (MARKER_GUTTER_HEIGHT * (H / canvas.height)) : 0;
    const duration = buffer.duration;
    const loopEnd = loopData.loopEnd > 0 ? loopData.loopEnd : duration;

    // Marker hit-test first (priority over loop handles when in gutter)
    if (showMarkers) {
      for (let i = 0; i < markers.length; i++) {
        const mx = (markers[i]!.bufferTime / duration) * W;
        if (Math.abs(x - mx) < MARKER_HIT_PX) {
          dragging.current = { kind: "marker", index: i };
          dragStartX.current = x;
          dragStartSec.current = markers[i]!.bufferTime;
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
      }
      // If click was in the gutter and didn't hit a marker, do nothing
      if (y < gutterScreenH) return;
    }

    const startX = (loopData.loopStart / duration) * W;
    const endX = (loopEnd / duration) * W;

    if (Math.abs(x - startX) < HIT_ZONE) {
      dragging.current = { kind: "loopStart" };
      dragStartX.current = x;
      dragStartSec.current = loopData.loopStart;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else if (Math.abs(x - endX) < HIT_ZONE) {
      dragging.current = { kind: "loopEnd" };
      dragStartX.current = x;
      dragStartSec.current = loopEnd;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }, [buffer, loopData, markers, showMarkers]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const target = dragging.current;
    if (!target || !buffer) return;
    const sec = getSecondsFromX(e.clientX);
    const duration = buffer.duration;
    const loopEnd = loopData.loopEnd > 0 ? loopData.loopEnd : duration;

    if (target.kind === "loopStart") {
      const clamped = Math.max(0, Math.min(sec, loopEnd - 0.05));
      commit({ loopStart: clamped });
    } else if (target.kind === "loopEnd") {
      const clamped = Math.max(loopData.loopStart + 0.05, Math.min(sec, duration));
      const snapped = Math.abs(clamped - duration) < 0.02 ? 0 : clamped;
      commit({ loopEnd: snapped });
    } else if (target.kind === "marker") {
      // Drag marker bufferTime; clamp between neighbors (or buffer bounds)
      const i = target.index;
      const prev = i > 0 ? markers[i - 1]!.bufferTime + 0.01 : 0;
      const next = i < markers.length - 1 ? markers[i + 1]!.bufferTime - 0.01 : duration;
      const clamped = Math.max(prev, Math.min(sec, next));
      const updated = markers.map((m, idx) => idx === i ? { ...m, bufferTime: clamped } : m);
      commitMarkers(updated);
    }
  }, [buffer, loopData, markers, commit, commitMarkers, getSecondsFromX]);

  const handlePointerUp = useCallback(() => {
    dragging.current = null;
  }, []);

  // Double-click in gutter → add a new marker, snapped to the nearest available beat
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!buffer || !showMarkers) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const H = rect.height;
    const gutterScreenH = MARKER_GUTTER_HEIGHT * (H / canvas.height);
    if (y > gutterScreenH * 1.5) return; // only respond near gutter

    const sec = (x / rect.width) * buffer.duration;
    // Pick a sensible beat: linearly interpolate between neighboring markers
    const sorted = [...markers].sort((a, b) => a.bufferTime - b.bufferTime);
    let beat = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sec >= sorted[i]!.bufferTime && sec <= sorted[i + 1]!.bufferTime) {
        const t = (sec - sorted[i]!.bufferTime) / (sorted[i + 1]!.bufferTime - sorted[i]!.bufferTime);
        beat = Math.round(sorted[i]!.beat + t * (sorted[i + 1]!.beat - sorted[i]!.beat));
        // Avoid duplicate beats — nudge if neighbour already uses this beat
        if (beat === sorted[i]!.beat) beat = sorted[i]!.beat + 1;
        if (beat === sorted[i + 1]!.beat) beat = sorted[i + 1]!.beat - 1;
        break;
      }
    }
    if (beat <= 0) return;
    commitMarkers([...markers, { bufferTime: sec, beat }]);
  }, [buffer, markers, commitMarkers, showMarkers]);

  // Right-click on a marker → delete (except first/last)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!buffer || !showMarkers) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const W = rect.width;
    const duration = buffer.duration;

    for (let i = 0; i < markers.length; i++) {
      const mx = (markers[i]!.bufferTime / duration) * W;
      if (Math.abs(x - mx) < MARKER_HIT_PX) {
        if (i === 0 || i === markers.length - 1) return; // can't remove anchors
        e.preventDefault();
        commitMarkers(markers.filter((_, idx) => idx !== i));
        return;
      }
    }
  }, [buffer, markers, showMarkers, commitMarkers]);

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

  // ── Stretch mode toggle ───────────────────────────────────
  const handleSetMode = useCallback((mode: StretchMode) => {
    sampleManager.invalidateStretchCache(voiceIndex);
    commit({ stretchMode: mode });
  }, [voiceIndex, commit]);

  // ── Auto-place markers from transient detection ────────────
  const handleAutoMarkers = useCallback(() => {
    if (!buffer || loopData.nativeBpm <= 0) return;

    // Detect onsets in the source buffer
    const onsets = detectOnsets(buffer, { sensitivity: 0.5 });

    // Snap each onset to the nearest 16th-note in the NATIVE BPM grid
    // (because markers' bufferTime stays in source-time, not project-time)
    const secondsPerBeat = 60 / loopData.nativeBpm;
    const stepSec = secondsPerBeat / 4; // 16th-notes
    const totalBeats = Math.max(1, loopData.bars) * 4;

    // Build marker list: for each onset, snap its bufferTime to the nearest
    // grid step and assign a beat = round(onsetTime / secondsPerBeat).
    const seenBeats = new Set<number>();
    const newMarkers: WarpMarker[] = [
      { bufferTime: 0, beat: 0 }, // anchor
    ];
    seenBeats.add(0);

    for (const onsetTime of onsets) {
      // Snap bufferTime to nearest 16th
      const snappedTime = Math.round(onsetTime / stepSec) * stepSec;
      const beat = Math.round(snappedTime / secondsPerBeat);

      if (beat <= 0 || beat >= totalBeats) continue;
      if (seenBeats.has(beat)) continue;
      if (snappedTime >= buffer.duration) continue;

      seenBeats.add(beat);
      newMarkers.push({ bufferTime: snappedTime, beat });
    }

    // Always include the end anchor
    if (!seenBeats.has(totalBeats)) {
      newMarkers.push({ bufferTime: buffer.duration, beat: totalBeats });
    }

    if (newMarkers.length < 2) return;
    commitMarkers(newMarkers);
  }, [buffer, loopData.nativeBpm, loopData.bars, commitMarkers]);


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

          {/* Stretch mode segmented toggle */}
          <div className="flex items-center rounded border border-white/15 overflow-hidden">
            <button
              onClick={() => handleSetMode("repitch")}
              title="Re-Pitch: pitch shifts with tempo (free, instant)"
              className={`px-2 py-0.5 text-[9px] font-bold transition-all ${
                (loopData.stretchMode ?? "repitch") === "repitch"
                  ? "bg-white/20 text-white"
                  : "bg-transparent text-white/40 hover:text-white/65"
              }`}
            >
              RE-PITCH
            </button>
            <button
              onClick={() => handleSetMode("beats")}
              title="Beats: time-stretch without pitch change (SoundTouch)"
              className={`px-2 py-0.5 text-[9px] font-bold border-l border-white/15 transition-all ${
                loopData.stretchMode === "beats"
                  ? "bg-[var(--ed-accent-orange)]/25 text-[var(--ed-accent-orange)]"
                  : "bg-transparent text-white/40 hover:text-white/65"
              }`}
            >
              BEATS
            </button>
          </div>

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
          height={showMarkers ? 86 : 72}
          className="w-full block cursor-crosshair select-none"
          style={{ imageRendering: "pixelated", touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
        />
        {showMarkers && (
          <div className="absolute top-1 right-2 text-[8px] text-[#f59e0b]/60 pointer-events-none font-mono">
            doppelklick = marker · rechtsklick = entfernen
          </div>
        )}
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

        {showMarkers ? (
          <>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-1.5 text-[9px] text-[#f59e0b]/70">
              <span>WARP</span>
              <span className="font-mono">{markers.length} marker</span>
              <button
                onClick={handleAutoMarkers}
                disabled={loopData.nativeBpm <= 0}
                title="Auto-place warp markers at detected transients (snap to 16th-grid)"
                className="ml-1 px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/35 hover:bg-[#f59e0b]/25 hover:border-[#f59e0b]/55 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                AUTO
              </button>
              {loopData.warpMarkers && loopData.warpMarkers.length >= 2 ? (
                <button
                  onClick={() => {
                    const meta = sampleManager.getLoopData(voiceIndex);
                    if (meta) {
                      const cleared = { ...meta };
                      delete cleared.warpMarkers;
                      sampleManager.setLoopData(voiceIndex, cleared);
                    }
                    sampleManager.invalidateStretchCache(voiceIndex);
                    setMarkers(sampleManager.getEffectiveMarkers(voiceIndex));
                    onLoopDataChange(sampleManager.getLoopData(voiceIndex) ?? null);
                  }}
                  className="text-[#f59e0b]/50 hover:text-[#f59e0b]/90 text-[8px]"
                  title="Reset warp markers to default 2-marker (start/end)"
                >
                  RESET
                </button>
              ) : null}
            </div>
          </>
        ) : null}

      </div>
    </div>
  );
}
