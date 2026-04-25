/**
 * LoopPlayerTab — 4-slot Ableton-quality tempo-synced loop player
 *
 * Each slot:
 *  - Drag & drop or click-to-load any audio file
 *  - Auto BPM detection (Web Worker) with waveform + beat-grid overlay
 *  - Tap BPM button for manual tempo tapping
 *  - Original BPM input → playbackRate auto-adjusted to global BPM
 *  - Beat-aligned looping (firstBeatOffset → loopEnd on bar boundary)
 *  - Quantized launch: next bar boundary when transport is running
 *  - Volume slider
 *
 * Slots start immediately on PLAY when transport is stopped.
 * When transport starts, all armed slots restart at the next bar.
 * BPM changes update playback rates in real time — no restart needed.
 */

import { useRef, useEffect, useCallback, useState, memo } from "react";
import { useLoopPlayerStore } from "../store/loopPlayerStore";
import { useDrumStore } from "../store/drumStore";
import { useSamplerStore } from "../store/samplerStore";
import { detectTransients, sliceEqual, onsetsToRegions } from "../audio/SlicerEngine";
import { audioEngine } from "../audio/AudioEngine";

// ── Theme ──────────────────────────────────────────────────────────────────────
const TEAL = "#2EC4B6";

// ── Waveform + beat-grid drawing ───────────────────────────────────────────────

function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  firstBeatOffset: number,
  loopEndSeconds: number,
  bpm: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const data  = buffer.getChannelData(0);
  const w     = canvas.width;
  const h     = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const duration = buffer.duration;
  const step     = data.length / w;

  // ── Waveform bars
  for (let x = 0; x < w; x++) {
    const idx = Math.floor(x * step);
    const amp = Math.abs(data[idx] ?? 0) * h * 0.88;
    ctx.fillStyle = "rgba(46,196,182,0.72)";
    ctx.fillRect(x, h / 2 - amp / 2, 1, Math.max(1, amp));
  }

  if (bpm <= 0 || duration <= 0) return;

  const timeToX = (t: number) => (t / duration) * w;

  // ── Loop region highlight (beat 1 → loopEnd)
  const lx0 = timeToX(firstBeatOffset);
  const lx1 = loopEndSeconds > firstBeatOffset ? timeToX(loopEndSeconds) : w;
  ctx.fillStyle = "rgba(46,196,182,0.06)";
  ctx.fillRect(lx0, 0, lx1 - lx0, h);

  // ── Beat-grid lines
  const secondsPerBeat = 60 / bpm;
  const numBeats       = Math.ceil(duration / secondsPerBeat) + 1;

  for (let b = 0; b < numBeats; b++) {
    const t  = firstBeatOffset + b * secondsPerBeat;
    if (t > duration + 0.01) break;
    const x  = timeToX(t);
    const isBar = b % 4 === 0;

    ctx.strokeStyle = isBar ? `rgba(46,196,182,0.6)` : `rgba(46,196,182,0.2)`;
    ctx.lineWidth   = isBar ? 1.5 : 0.75;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();

    // Bar number label
    if (isBar) {
      const barNum = b / 4 + 1;
      ctx.fillStyle = "rgba(46,196,182,0.55)";
      ctx.font      = "bold 7px monospace";
      ctx.fillText(String(barNum), x + 2, 9);
    }
  }

  // ── Pre-beat region dim (before beat 1)
  if (firstBeatOffset > 0.01) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, lx0, h);
    ctx.strokeStyle = `${TEAL}90`;
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(lx0, 0);
    ctx.lineTo(lx0, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Post-loop region dim
  if (loopEndSeconds > firstBeatOffset && loopEndSeconds < duration - 0.05) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(lx1, 0, w - lx1, h);
  }

  // ── Draggable loop handles ──────────────────────────────

  // START handle — teal vertical line + downward triangle grip
  ctx.fillStyle = `${TEAL}ee`;
  ctx.fillRect(lx0 - 1.5, 0, 3, h);
  // Grip triangle (pointing down)
  ctx.fillStyle = TEAL;
  ctx.beginPath();
  ctx.moveTo(lx0 - 6, 0);
  ctx.lineTo(lx0 + 6, 0);
  ctx.lineTo(lx0, 11);
  ctx.closePath();
  ctx.fill();
  // Small "S" indicator
  ctx.fillStyle = "#000a";
  ctx.font = "bold 6px monospace";
  ctx.textAlign = "center";
  ctx.fillText("S", lx0, 8.5);
  ctx.textAlign = "left";

  // END handle — white vertical line + downward triangle grip
  const exEnd = loopEndSeconds > firstBeatOffset ? lx1 : w;
  ctx.fillStyle = "rgba(255,255,255,0.60)";
  ctx.fillRect(exEnd - 1.5, 0, 3, h);
  ctx.beginPath();
  ctx.moveTo(exEnd - 6, 0);
  ctx.lineTo(exEnd + 6, 0);
  ctx.lineTo(exEnd, 11);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#000a";
  ctx.font = "bold 6px monospace";
  ctx.textAlign = "center";
  ctx.fillText("E", exEnd, 8.5);
  ctx.textAlign = "left";
}

// ── Slot component ─────────────────────────────────────────────────────────────

interface LoopSlotProps {
  slotIndex: number;
}

const LoopSlot = memo(function LoopSlot({ slotIndex }: LoopSlotProps) {
  const slot               = useLoopPlayerStore((s) => s.slots[slotIndex]!);
  const setBuffer          = useLoopPlayerStore((s) => s.setBuffer);
  const setOriginalBpm     = useLoopPlayerStore((s) => s.setOriginalBpm);
  const setFirstBeatOffset = useLoopPlayerStore((s) => s.setFirstBeatOffset);
  const setLoopEndSeconds  = useLoopPlayerStore((s) => s.setLoopEndSeconds);
  const setLoopRegion      = useLoopPlayerStore((s) => s.setLoopRegion);
  const restartSlot        = useLoopPlayerStore((s) => s.restartSlot);
  const setVolume          = useLoopPlayerStore((s) => s.setVolume);
  const togglePlay         = useLoopPlayerStore((s) => s.togglePlay);
  const tapBpm             = useLoopPlayerStore((s) => s.tapBpm);
  const globalBpm          = useDrumStore((s) => s.bpm);
  const isTransportPlay    = useDrumStore((s) => s.isPlaying);

  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const waveContRef = useRef<HTMLDivElement>(null);
  // Track which handle is being dragged: "start" | "end" | null
  const dragHandleRef = useRef<"start" | "end" | null>(null);

  const [isDragOver,    setIsDragOver]    = useState(false);
  const [bpmInput,      setBpmInput]      = useState(String(slot.originalBpm));
  const [canvasCursor,  setCanvasCursor]  = useState<"default" | "ew-resize">("default");
  const [sliceMode,     setSliceMode]     = useState<"auto" | "4" | "8" | "16">("8");
  const [slicing,       setSlicing]       = useState(false);
  // Ref-based guard for synchronous double-click protection (React state batching is too slow)
  const slicingRef = useRef(false);
  const sliceToPads = useSamplerStore((s) => s.sliceToPads);

  // Sync BPM input when originalBpm changes externally (e.g. auto-detected)
  useEffect(() => {
    setBpmInput(String(slot.originalBpm));
  }, [slot.originalBpm]);

  // ── Canvas interaction helpers ────────────────────────────

  /** Convert a clientX screen position to a buffer time (seconds). */
  const xToTime = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || !slot.buffer) return 0;
    const rect  = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * slot.duration;
  }, [slot.buffer, slot.duration]);

  /** Snap a time value to the nearest 1/16-note grid of the global (drum) BPM.
   *  4× finer than a full-beat snap — still grid-aligned but much more precise.
   *  Pass freeSnap=true (Alt key held) to bypass snap entirely. */
  const snapToGrid = useCallback((t: number, freeSnap: boolean): number => {
    if (freeSnap || globalBpm <= 0) return t;
    const sixteenth = 60 / globalBpm / 4; // 1/16-note duration in seconds
    return Math.round(t / sixteenth) * sixteenth;
  }, [globalBpm]);

  // ── Slice to Pads ─────────────────────────────────────────
  const handleSliceToPads = useCallback(async () => {
    const buf = slot.buffer;
    // slicingRef provides synchronous guard — React state batching is not fast enough
    if (!buf || slicingRef.current) return;

    const regionStart = slot.firstBeatOffset;
    const regionEnd   = slot.loopEndSeconds > slot.firstBeatOffset
      ? slot.loopEndSeconds
      : buf.duration;

    slicingRef.current = true;
    setSlicing(true);
    try {
      let onsets: number[];
      if (sliceMode === "auto") {
        // Run detection in a micro-task to avoid blocking the UI
        onsets = await new Promise<number[]>(resolve =>
          setTimeout(() => resolve(detectTransients(buf, 0.6, regionStart, regionEnd)), 0)
        );
        // Clamp to 16 pads: keep strongest-spaced onsets
        if (onsets.length > 16) onsets = onsets.slice(0, 16);
      } else {
        const count = parseInt(sliceMode, 10);
        onsets = sliceEqual(count, regionStart, regionEnd);
      }

      const regions = onsetsToRegions(onsets, buf.duration, regionEnd, 16);
      const name = slot.fileName.replace(/\.[^.]+$/, "");
      sliceToPads(buf, regions, name);
    } finally {
      slicingRef.current = false;
      setSlicing(false);
    }
  }, [slot, sliceMode, sliceToPads]);

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!slot.buffer || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const w    = rect.width;
    const HIT  = 14; // screen px hit-zone

    const startX = (slot.firstBeatOffset / slot.duration) * w;
    const endX   = slot.loopEndSeconds > slot.firstBeatOffset
      ? (slot.loopEndSeconds / slot.duration) * w
      : w;

    // Priority: end handle (so you can always grab it even when start ≈ end)
    if (Math.abs(relX - endX) < HIT) {
      dragHandleRef.current = "end";
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (Math.abs(relX - startX) < HIT) {
      dragHandleRef.current = "start";
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }, [slot.buffer, slot.duration, slot.firstBeatOffset, slot.loopEndSeconds]);

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!slot.buffer || !canvasRef.current) return;

    // Update cursor style based on proximity to handles
    if (!dragHandleRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const w    = rect.width;
      const HIT  = 14;
      const startX = (slot.firstBeatOffset / slot.duration) * w;
      const endX   = slot.loopEndSeconds > slot.firstBeatOffset
        ? (slot.loopEndSeconds / slot.duration) * w
        : w;
      const near = Math.abs(relX - startX) < HIT || Math.abs(relX - endX) < HIT;
      setCanvasCursor(near ? "ew-resize" : "default");
      return;
    }

    // Active drag — Alt key = completely free, no snap
    const freeSnap = e.altKey;
    const minGap   = 0.05; // 50 ms minimum region width (free mode)
    let t = xToTime(e.clientX);
    t = snapToGrid(t, freeSnap);

    if (dragHandleRef.current === "start") {
      const maxStart = slot.loopEndSeconds > 0
        ? slot.loopEndSeconds - minGap
        : slot.duration * 0.95;
      t = Math.max(0, Math.min(t, maxStart));
      setFirstBeatOffset(slotIndex, t);
    } else {
      const minEnd = slot.firstBeatOffset + minGap;
      t = Math.max(minEnd, Math.min(t, slot.duration));
      setLoopEndSeconds(slotIndex, t);
    }
  }, [slot.buffer, slot.duration, slot.firstBeatOffset, slot.loopEndSeconds,
      slotIndex, xToTime, snapToGrid, setFirstBeatOffset, setLoopEndSeconds]);

  const handleCanvasPointerUp = useCallback(() => {
    if (dragHandleRef.current !== null) {
      // Apply new loop points to the running source (restart at next bar boundary)
      restartSlot(slotIndex);
    }
    dragHandleRef.current = null;
    setCanvasCursor("default");
  }, [slotIndex, restartSlot]);

  const handleCanvasPointerLeave = useCallback(() => {
    if (!dragHandleRef.current) setCanvasCursor("default");
  }, []);

  // ── Redraw waveform + beat grid whenever relevant state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !slot.buffer) return;
    drawWaveform(
      canvas,
      slot.buffer,
      slot.firstBeatOffset,
      slot.loopEndSeconds,
      slot.analyzing ? 0 : slot.originalBpm,
    );
  }, [slot.buffer, slot.firstBeatOffset, slot.loopEndSeconds, slot.originalBpm, slot.analyzing]);

  // ── File loading ─────────────────────────────────────────
  const handleLoadFile = useCallback(async (file: File) => {
    const ctx = audioEngine.getAudioContext();
    if (!ctx) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      setBuffer(slotIndex, audioBuffer, file.name);
    } catch (err) {
      console.warn("LoopPlayer: failed to decode file", err);
    }
  }, [slotIndex, setBuffer]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleLoadFile(file);
  }, [handleLoadFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleLoadFile(file);
    // Reset so same file can be reloaded
    e.target.value = "";
  }, [handleLoadFile]);

  // ── BPM commit ───────────────────────────────────────────
  const commitBpm = useCallback(() => {
    const parsed = parseFloat(bpmInput);
    if (!isNaN(parsed) && parsed >= 20 && parsed <= 999) {
      setOriginalBpm(slotIndex, parsed);
    } else {
      setBpmInput(String(slot.originalBpm));
    }
  }, [bpmInput, slotIndex, slot.originalBpm, setOriginalBpm]);

  // ── Derived display values ────────────────────────────────
  const ratio          = slot.originalBpm > 0 ? globalBpm / slot.originalBpm : 1;
  const clampedRatio   = Math.max(0.1, Math.min(4, ratio));
  const pitchSemitones = Math.log2(clampedRatio) * 12;
  const ratioLabel     = clampedRatio.toFixed(2);
  const ratioOff       = Math.abs(clampedRatio - 1) > 0.015;

  const isArmed  = slot.playing;
  const isActive = isArmed && isTransportPlay;

  const dur      = slot.duration;
  const durMin   = Math.floor(dur / 60);
  const durSec   = (dur % 60).toFixed(1).padStart(4, "0");
  const durLabel = slot.buffer ? `${durMin}:${durSec}` : "";

  // Number of bars in the loop region.
  // loopDuration / (4 beats/bar × 60s/bpm-beat) = loopDuration × originalBpm / 240
  const loopRegionDur = slot.loopEndSeconds > slot.firstBeatOffset
    ? slot.loopEndSeconds - slot.firstBeatOffset
    : slot.duration - slot.firstBeatOffset;
  const numBars = loopRegionDur > 0.05 && slot.originalBpm > 0
    ? Math.round((loopRegionDur * slot.originalBpm) / 240)
    : 0;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg transition-all"
      style={{
        background: isArmed
          ? `color-mix(in srgb, ${TEAL} 6%, var(--ed-bg-surface))`
          : "var(--ed-bg-surface)",
        border: isArmed
          ? `1px solid ${TEAL}50`
          : isDragOver
            ? `1px dashed ${TEAL}50`
            : "1px solid var(--ed-border-subtle)",
        boxShadow: isActive ? `0 0 14px ${TEAL}14` : "none",
        padding: "7px 9px",
      }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* ── Row 1: Badge · Play · Filename · Duration/Bars · LOAD ── */}
      <div className="flex items-center gap-1.5 min-w-0">

        {/* Slot badge + play button fused */}
        <button
          onClick={() => togglePlay(slotIndex)}
          disabled={!slot.buffer}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold shrink-0 transition-all"
          style={{
            background: isArmed ? TEAL : "rgba(255,255,255,0.06)",
            color:      isArmed ? "#000814" : slot.buffer ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.18)",
            border:     `1px solid ${isArmed ? TEAL : "rgba(255,255,255,0.08)"}`,
            boxShadow:  isActive ? `0 0 10px ${TEAL}80` : "none",
            cursor:     slot.buffer ? "pointer" : "default",
            minWidth:   "36px",
          }}
          title={isArmed ? "Stop" : "Play"}
        >
          <span style={{ fontSize: 7 }}>{isArmed ? "■" : "▶"}</span>
          <span>{slotIndex + 1}</span>
        </button>

        {/* File name */}
        <span
          className="text-[9px] font-bold tracking-wide truncate flex-1 min-w-0"
          style={{ color: slot.buffer ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.18)" }}
        >
          {slot.buffer
            ? slot.fileName.replace(/\.[^/.]+$/, "")
            : isDragOver ? "DROP HERE…" : "DROP FILE OR LOAD →"}
        </span>

        {/* Bars badge */}
        {numBars > 0 && !slot.analyzing && (
          <span className="text-[7px] font-bold px-1 py-0.5 rounded shrink-0 tabular-nums"
            style={{ background: `rgba(46,196,182,0.10)`, color: `${TEAL}cc`, border: `1px solid ${TEAL}20` }}>
            {numBars}B
          </span>
        )}

        {/* Duration */}
        {durLabel && !slot.analyzing && (
          <span className="text-[7px] tabular-nums shrink-0" style={{ color: `${TEAL}60` }}>{durLabel}</span>
        )}

        {/* Analyzing spinner */}
        {slot.analyzing && (
          <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0" style={{ animation: "spin 0.9s linear infinite" }}>
            <circle cx="5" cy="5" r="4" stroke={`${TEAL}30`} strokeWidth="1.5" fill="none" />
            <path d="M5 1A4 4 0 0 1 9 5" stroke={TEAL} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        )}

        {/* Ratio */}
        {slot.buffer && (
          <span className="text-[7px] font-bold tabular-nums shrink-0"
            style={{ color: ratioOff ? TEAL : "rgba(255,255,255,0.28)" }}
            title={`Playback rate ×${ratioLabel}${Math.abs(pitchSemitones) >= 0.4 ? ` (${pitchSemitones > 0 ? "+" : ""}${pitchSemitones.toFixed(1)} st)` : ""}`}>
            ×{ratioLabel}
          </span>
        )}

        {/* Load */}
        <label
          className="text-[7px] font-bold px-1.5 py-0.5 rounded cursor-pointer shrink-0 transition-all"
          style={{ color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.03)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.65)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.3)"; }}
        >
          LOAD
          <input type="file" accept="audio/*" className="hidden" onChange={handleFileInput} />
        </label>
      </div>

      {/* ── Row 2: Compact waveform (only when loaded) ── */}
      {slot.buffer && (
        <div
          ref={waveContRef}
          className="relative rounded overflow-hidden"
          style={{ height: 32, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.04)" }}
        >
          <canvas
            ref={canvasRef}
            width={900}
            height={32}
            className="w-full h-full"
            style={{ imageRendering: "pixelated", display: "block", cursor: canvasCursor }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerLeave={handleCanvasPointerLeave}
          />
          {slot.analyzing && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
              <span className="text-[7px] font-bold tracking-[0.14em]" style={{ color: TEAL }}>ANALYZING BPM…</span>
            </div>
          )}
          {isActive && (
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: `linear-gradient(90deg, transparent, ${TEAL}10 50%, transparent)`, backgroundSize: "200% 100%", animation: "ed-shimmer 2.5s linear infinite" }} />
          )}
        </div>
      )}

      {/* ── Row 3: BPM · LOCK · VOL · SLICE (only when loaded) ── */}
      {slot.buffer && (
        <div className="flex items-center gap-1.5 flex-wrap">

          {/* BPM input */}
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[6px] font-bold tracking-[0.1em] text-white/25">BPM</span>
            {slot.detectedBpm !== null && !slot.analyzing && (
              <span className="text-[6px] font-bold px-0.5 rounded" style={{ background: `rgba(46,196,182,0.12)`, color: `${TEAL}bb` }} title="Auto-detected">A</span>
            )}
            <input
              type="number" min={20} max={999} step={0.5}
              value={bpmInput}
              onChange={(e) => setBpmInput(e.target.value)}
              onBlur={commitBpm}
              onKeyDown={(e) => { if (e.key === "Enter") commitBpm(); }}
              className="w-12 text-center text-[9px] font-bold rounded px-1 py-0.5 tabular-nums"
              style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${slot.detectedBpm !== null && !slot.analyzing ? `${TEAL}30` : "rgba(255,255,255,0.1)"}`, color: "rgba(255,255,255,0.82)", outline: "none" }}
            />
            <button onClick={() => tapBpm(slotIndex)}
              className="text-[6px] font-bold px-1 py-0.5 rounded shrink-0"
              style={{ color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.03)" }}
              title="Tap BPM">TAP</button>
          </div>

          <div className="w-px h-3.5 bg-white/8 shrink-0" />

          {/* LOCK presets */}
          {globalBpm > 0 && !slot.analyzing && (
            <div className="flex items-center gap-0.5 shrink-0">
              <span className="text-[6px] font-bold text-white/20">LOCK</span>
              {([0.5, 1, 2, 4, 8] as const).map((bars) => {
                const usableDuration = slot.duration - slot.firstBeatOffset;
                const expectedBpm   = usableDuration > 0.1 ? (bars * 240) / usableDuration : 0;
                const isLocked = expectedBpm > 0 && Math.abs(slot.originalBpm - expectedBpm) < 1 && Math.abs(slot.loopEndSeconds - slot.duration) < 0.05;
                return (
                  <button key={bars} onClick={() => setLoopRegion(slotIndex, bars)}
                    className="text-[6px] font-bold px-1 py-0.5 rounded transition-all"
                    style={{ background: isLocked ? `${TEAL}22` : "rgba(255,255,255,0.04)", color: isLocked ? TEAL : "rgba(255,255,255,0.35)", border: `1px solid ${isLocked ? `${TEAL}40` : "rgba(255,255,255,0.07)"}` }}
                    title={`Lock to ${bars === 0.5 ? "½" : bars} bar${bars !== 1 ? "s" : ""}`}>
                    {bars === 0.5 ? "½" : bars}B
                  </button>
                );
              })}
            </div>
          )}

          <div className="w-px h-3.5 bg-white/8 shrink-0" />

          {/* Volume */}
          <div className="flex items-center gap-1 flex-1 min-w-[70px]">
            <span className="text-[6px] font-bold text-white/25 shrink-0">VOL</span>
            <input type="range" min={0} max={100} value={Math.round(slot.volume * 100)}
              onChange={(e) => setVolume(slotIndex, parseInt(e.target.value) / 100)}
              className="flex-1 h-[3px] min-w-0" style={{ accentColor: TEAL }} />
            <span className="text-[7px] tabular-nums w-5 text-right shrink-0" style={{ color: "rgba(255,255,255,0.3)" }}>
              {Math.round(slot.volume * 100)}
            </span>
          </div>

          <div className="w-px h-3.5 bg-white/8 shrink-0" />

          {/* Slice → Pads */}
          <div className="flex items-center gap-0.5 shrink-0">
            <span className="text-[6px] font-bold text-white/20">SLICE</span>
            <select value={sliceMode} onChange={(e) => setSliceMode(e.target.value as typeof sliceMode)}
              className="h-5 px-0.5 text-[7px] font-bold rounded"
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.55)", outline: "none" }}>
              <option value="auto">AUTO</option>
              <option value="4">4</option>
              <option value="8">8</option>
              <option value="16">16</option>
            </select>
            <button onClick={handleSliceToPads} disabled={slicing}
              className="text-[7px] font-black px-1.5 py-0.5 rounded transition-all shrink-0"
              style={{ background: slicing ? `rgba(46,196,182,0.06)` : `rgba(46,196,182,0.12)`, color: slicing ? `${TEAL}50` : TEAL, border: `1px solid ${slicing ? `${TEAL}18` : `${TEAL}40`}`, cursor: slicing ? "wait" : "pointer" }}
              title="Slice to sampler pads">
              {slicing ? "…" : "→PADS"}
            </button>
          </div>

        </div>
      )}
    </div>
  );
});

// ── Main tab ───────────────────────────────────────────────────────────────────

export function LoopPlayerTab() {
  const globalBpm   = useDrumStore((s) => s.bpm);
  const isPlaying   = useDrumStore((s) => s.isPlaying);
  const stopAll     = useLoopPlayerStore((s) => s.stopAll);
  const slots       = useLoopPlayerStore((s) => s.slots);

  const armedCount  = slots.filter((s) => s.playing).length;
  const activeCount = armedCount > 0 && isPlaying ? armedCount : 0;
  const anyAnalyzing = slots.some((s) => s.analyzing);

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* Header bar */}
      <div className="flex items-center gap-3 px-0.5">
        <span className="text-[8px] font-bold tracking-[0.18em] text-white/30">LOOP PLAYER</span>

        {/* Transport dot + BPM */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full transition-all"
            style={{
              background: isPlaying ? TEAL : "rgba(255,255,255,0.12)",
              boxShadow:  isPlaying ? `0 0 6px ${TEAL}` : "none",
            }}
          />
          <span
            className="text-[8px] font-bold tabular-nums"
            style={{ color: isPlaying ? `${TEAL}90` : "rgba(255,255,255,0.25)" }}
          >
            {globalBpm} BPM
          </span>
        </div>

        {/* Active count */}
        {activeCount > 0 && (
          <span
            className="text-[7px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: `${TEAL}18`, color: TEAL, border: `1px solid ${TEAL}30` }}
          >
            {activeCount} PLAYING
          </span>
        )}

        {/* Quantized launch hint */}
        {isPlaying && armedCount > 0 && (
          <span className="text-[7px] text-white/20 hidden sm:block">
            ⊞ Launches on next bar
          </span>
        )}

        {/* Analyzing indicator */}
        {anyAnalyzing && (
          <span
            className="text-[7px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: `rgba(46,196,182,0.08)`, color: `${TEAL}80`, border: `1px solid ${TEAL}20` }}
          >
            ANALYZING…
          </span>
        )}

        <div className="flex-1" />

        {/* Stop all */}
        <button
          onClick={stopAll}
          className="text-[8px] font-bold px-2 py-0.5 rounded transition-all"
          style={{
            color:  armedCount > 0 ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)",
            border: `1px solid ${armedCount > 0 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}`,
          }}
        >
          STOP ALL
        </button>
      </div>

      {/* 8 Slot cards — 2 columns, all visible at once */}
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 8 }, (_, idx) => (
          <LoopSlot key={idx} slotIndex={idx} />
        ))}
      </div>

      {/* Hint */}
      <p className="text-[7px] text-white/15 text-center pb-0.5">
        Drop WAV/MP3 on a slot · Drag S/E handles on waveform (Alt = free) · LOCK = set bar count · SLICE → PADS
      </p>

    </div>
  );
}
