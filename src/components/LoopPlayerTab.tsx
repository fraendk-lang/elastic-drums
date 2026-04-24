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

  /** Snap a time value to the nearest beat of the global (drum) grid.
   *  This keeps handles aligned to the project bar grid regardless of
   *  whatever BPM the auto-detector guessed for the file. */
  const snapToBeat = useCallback((t: number): number => {
    if (globalBpm <= 0) return t;
    const beat = 60 / globalBpm;
    return Math.round(t / beat) * beat;
  }, [globalBpm]);

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

    // Active drag
    const beat = slot.originalBpm > 0 ? 60 / slot.originalBpm : 0;
    let t = xToTime(e.clientX);
    t = snapToBeat(t);

    if (dragHandleRef.current === "start") {
      // Start must stay at least 1 beat before end
      const maxStart = slot.loopEndSeconds > 0
        ? slot.loopEndSeconds - (beat || 0.1)
        : slot.duration * 0.95;
      t = Math.max(0, Math.min(t, maxStart));
      setFirstBeatOffset(slotIndex, t);
    } else {
      // End must stay at least 1 beat after start
      const minEnd = slot.firstBeatOffset + (beat || 0.1);
      t = Math.max(minEnd, Math.min(t, slot.duration));
      setLoopEndSeconds(slotIndex, t);
    }
  }, [slot.buffer, slot.duration, slot.firstBeatOffset, slot.loopEndSeconds, slot.originalBpm,
      slotIndex, xToTime, snapToBeat, setFirstBeatOffset, setLoopEndSeconds]);

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
      className="flex flex-col gap-2 rounded-lg transition-all"
      style={{
        background: isArmed
          ? `color-mix(in srgb, ${TEAL} 7%, var(--ed-bg-surface))`
          : "var(--ed-bg-surface)",
        border: isArmed
          ? `1px solid ${TEAL}50`
          : isDragOver
            ? `1px dashed ${TEAL}50`
            : "1px solid var(--ed-border-subtle)",
        boxShadow: isActive ? `0 0 18px ${TEAL}18` : "none",
        padding: "10px 12px",
      }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* ── Row 1: Slot ID + filename + duration + LOAD ── */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Slot badge */}
        <div
          className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold shrink-0 transition-all"
          style={{
            background: isArmed ? TEAL : "rgba(255,255,255,0.06)",
            color:      isArmed ? "#000" : "rgba(255,255,255,0.3)",
          }}
        >
          {slotIndex + 1}
        </div>

        {/* File name */}
        <span
          className="text-[9px] font-bold tracking-wide truncate flex-1 min-w-0"
          style={{ color: slot.buffer ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.2)" }}
        >
          {slot.buffer
            ? slot.fileName.replace(/\.[^/.]+$/, "")
            : "DROP LOOP HERE OR CLICK LOAD →"}
        </span>

        {/* Duration */}
        {durLabel && (
          <span className="text-[8px] font-bold tabular-nums shrink-0" style={{ color: `${TEAL}70` }}>
            {durLabel}
          </span>
        )}

        {/* Bars badge */}
        {numBars > 0 && !slot.analyzing && (
          <span
            className="text-[7px] font-bold px-1.5 py-0.5 rounded shrink-0"
            style={{
              background: `rgba(46,196,182,0.10)`,
              color:      `${TEAL}cc`,
              border:     `1px solid ${TEAL}25`,
            }}
          >
            {numBars} BAR{numBars !== 1 ? "S" : ""}
          </span>
        )}

        {/* Load file */}
        <label
          className="text-[8px] font-bold px-2 py-0.5 rounded cursor-pointer transition-all shrink-0"
          style={{
            color:      "rgba(255,255,255,0.35)",
            border:     "1px solid rgba(255,255,255,0.09)",
            background: "rgba(255,255,255,0.03)",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.65)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.35)"; }}
        >
          LOAD
          <input type="file" accept="audio/*" className="hidden" onChange={handleFileInput} />
        </label>
      </div>

      {/* ── Row 2: Waveform ── */}
      <div
        ref={waveContRef}
        className="relative rounded overflow-hidden"
        style={{
          height:     60,
          background: "rgba(0,0,0,0.35)",
          border:     "1px solid rgba(255,255,255,0.04)",
        }}
      >
        {slot.buffer ? (
          <canvas
            ref={canvasRef}
            width={900}
            height={60}
            className="w-full h-full"
            style={{ imageRendering: "pixelated", display: "block", cursor: canvasCursor }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerLeave={handleCanvasPointerLeave}
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center text-[8px] font-bold tracking-[0.18em]"
            style={{ color: `${TEAL}20` }}
          >
            WAVEFORM
          </div>
        )}

        {/* Analyzing overlay */}
        {slot.analyzing && (
          <div
            className="absolute inset-0 flex items-center justify-center gap-2"
            style={{ background: "rgba(0,0,0,0.55)" }}
          >
            {/* Spinning ring */}
            <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: "spin 0.9s linear infinite" }}>
              <circle cx="7" cy="7" r="5.5" stroke={`${TEAL}30`} strokeWidth="2" fill="none" />
              <path d="M 7 1.5 A 5.5 5.5 0 0 1 12.5 7" stroke={TEAL} strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
            <span className="text-[8px] font-bold tracking-[0.14em]" style={{ color: TEAL }}>
              ANALYZING BPM…
            </span>
          </div>
        )}

        {/* Active shimmer */}
        {isActive && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:     `linear-gradient(90deg, transparent, ${TEAL}12 50%, transparent)`,
              backgroundSize: "200% 100%",
              animation:      "ed-shimmer 2.5s linear infinite",
            }}
          />
        )}
      </div>

      {/* ── Row 3: Controls ── */}
      <div className="flex items-center gap-3 flex-wrap">

        {/* Play / Stop */}
        <button
          onClick={() => togglePlay(slotIndex)}
          disabled={!slot.buffer}
          className="flex items-center gap-1.5 px-3 py-1 rounded text-[9px] font-bold tracking-[0.1em] transition-all shrink-0"
          style={{
            background: isArmed
              ? TEAL
              : slot.buffer ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)",
            color: isArmed
              ? "#000814"
              : slot.buffer ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.18)",
            border:    `1px solid ${isArmed ? TEAL : "rgba(255,255,255,0.08)"}`,
            boxShadow: isActive ? `0 0 12px ${TEAL}70` : "none",
            cursor:    slot.buffer ? "pointer" : "default",
          }}
        >
          <span style={{ fontSize: 8 }}>{isArmed ? "■" : "▶"}</span>
          {isArmed
            ? (slot.analyzing ? "ARMED" : isTransportPlay ? "STOP" : "STOP")
            : "PLAY"}
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-white/8 shrink-0" />

        {/* Bar-length tempo-lock presets
            Clicking "2B" means: "this loop region = 2 bars at the project BPM".
            Sets originalBpm = globalBpm so playbackRate = 1.0 (play at native speed).
            This is independent of auto-BPM detection — always reliable. */}
        {slot.buffer && !slot.analyzing && globalBpm > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[6px] font-bold tracking-[0.1em] text-white/25">LOCK</span>
            {([0.5, 1, 2, 4, 8] as const).map((bars) => {
              // Active = this LOCK was the last one applied.
              // setLoopRegion sets: originalBpm = bars × 240 / usableDuration
              //                     loopEndSeconds = duration (full buffer)
              const usableDuration = slot.duration - slot.firstBeatOffset;
              const expectedBpm   = usableDuration > 0.1
                ? (bars * 240) / usableDuration
                : 0;
              const isActive = expectedBpm > 0
                && Math.abs(slot.originalBpm - expectedBpm) < 1
                && Math.abs(slot.loopEndSeconds - slot.duration) < 0.05;
              return (
                <button
                  key={bars}
                  title={`Tempo-lock: this loop = ${bars === 0.5 ? "½" : bars} bar${bars !== 1 ? "s" : ""} at ${globalBpm} BPM`}
                  onClick={() => setLoopRegion(slotIndex, bars)}
                  className="text-[7px] font-bold px-1.5 py-0.5 rounded transition-all"
                  style={{
                    background:  isActive ? `${TEAL}22` : "rgba(255,255,255,0.04)",
                    color:       isActive ? TEAL        : "rgba(255,255,255,0.38)",
                    border:      `1px solid ${isActive ? `${TEAL}40` : "rgba(255,255,255,0.08)"}`,
                  }}
                >
                  {bars === 0.5 ? "½" : bars}B
                </button>
              );
            })}
          </div>
        )}

        {/* Divider */}
        <div className="w-px h-5 bg-white/8 shrink-0" />

        {/* FILE BPM section */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[7px] font-bold tracking-[0.12em] text-white/30">FILE BPM</span>

          {/* Auto-detected badge */}
          {slot.detectedBpm !== null && !slot.analyzing && (
            <span
              className="text-[7px] font-bold px-1 py-0.5 rounded"
              style={{
                background: `rgba(46,196,182,0.12)`,
                color:      `${TEAL}bb`,
                border:     `1px solid ${TEAL}20`,
              }}
              title="Auto-detected BPM"
            >
              AUTO
            </span>
          )}

          {/* BPM number input */}
          <input
            type="number"
            min={20}
            max={999}
            step={0.5}
            value={bpmInput}
            onChange={(e) => setBpmInput(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={(e) => { if (e.key === "Enter") commitBpm(); }}
            className="w-14 text-center text-[10px] font-bold rounded px-1 py-0.5 tabular-nums"
            style={{
              background: "rgba(0,0,0,0.3)",
              border:     `1px solid ${slot.detectedBpm !== null && !slot.analyzing ? `${TEAL}30` : "rgba(255,255,255,0.1)"}`,
              color:      "rgba(255,255,255,0.82)",
              outline:    "none",
            }}
          />

          {/* Tap BPM button */}
          <button
            onClick={() => tapBpm(slotIndex)}
            className="text-[7px] font-bold px-1.5 py-0.5 rounded transition-all shrink-0"
            style={{
              color:      "rgba(255,255,255,0.45)",
              border:     "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color      = "rgba(255,255,255,0.8)";
              (e.currentTarget as HTMLElement).style.background = `rgba(46,196,182,0.1)`;
              (e.currentTarget as HTMLElement).style.borderColor = `${TEAL}40`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color       = "rgba(255,255,255,0.45)";
              (e.currentTarget as HTMLElement).style.background  = "rgba(255,255,255,0.04)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)";
            }}
            title="Tap BPM (tap repeatedly to set tempo)"
          >
            TAP
          </button>
        </div>

        {/* Playback ratio badge */}
        <div
          className="flex items-center gap-1 px-2 py-0.5 rounded shrink-0"
          style={{
            background: "rgba(0,0,0,0.22)",
            border:     "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <span className="text-[7px] text-white/25 font-bold">×</span>
          <span
            className="text-[10px] font-bold tabular-nums"
            style={{ color: ratioOff ? TEAL : "rgba(255,255,255,0.55)" }}
          >
            {ratioLabel}
          </span>
          {Math.abs(pitchSemitones) >= 0.4 && (
            <span className="text-[7px] font-bold tabular-nums" style={{ color: `${TEAL}70` }}>
              {pitchSemitones > 0 ? "+" : ""}{pitchSemitones.toFixed(1)} st
            </span>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-white/8 shrink-0" />

        {/* Volume */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[100px]">
          <span className="text-[7px] font-bold tracking-[0.1em] text-white/30 shrink-0">VOL</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(slot.volume * 100)}
            onChange={(e) => setVolume(slotIndex, parseInt(e.target.value) / 100)}
            className="flex-1 h-1 min-w-0"
            style={{ accentColor: TEAL }}
          />
          <span
            className="text-[8px] font-bold tabular-nums shrink-0 w-6 text-right"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            {Math.round(slot.volume * 100)}
          </span>
        </div>

      </div>
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

      {/* 4 Slot cards */}
      {[0, 1, 2, 3].map((idx) => (
        <LoopSlot key={idx} slotIndex={idx} />
      ))}

      {/* Hint */}
      <p className="text-[7px] text-white/15 text-center pt-1 pb-0.5">
        Drop WAV/MP3 → Drag S/E handles to mark region → click LOCK bar count (½B–8B) to tempo-lock to project BPM
      </p>

    </div>
  );
}
