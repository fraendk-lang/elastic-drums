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
  sliceMarkers?: number[], // optional slice preview markers (in seconds)
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

  // ── Slice preview markers ──────────────────────────────────
  if (sliceMarkers && sliceMarkers.length > 0) {
    sliceMarkers.forEach((t, i) => {
      const x = timeToX(t);
      // Coloured line: first marker = teal (start), others = orange
      const isFirst = i === 0;
      ctx.strokeStyle = isFirst ? `${TEAL}aa` : "rgba(245,158,11,0.85)";
      ctx.lineWidth   = isFirst ? 1.5 : 1.5;
      ctx.setLineDash(isFirst ? [] : [3, 2]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.setLineDash([]);

      // Small triangle grip at top
      ctx.fillStyle = isFirst ? TEAL : "#f59e0b";
      ctx.beginPath();
      ctx.moveTo(x - 5, 0);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x, 8);
      ctx.closePath();
      ctx.fill();

      // Slice number label (skip first)
      if (!isFirst) {
        ctx.fillStyle = "rgba(245,158,11,0.9)";
        ctx.font = "bold 6px monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), x, h - 2);
        ctx.textAlign = "left";
      }
    });
  }
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
  const setTranspose       = useLoopPlayerStore((s) => s.setTranspose);
  const setWarpMode        = useLoopPlayerStore((s) => s.setWarpMode);
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
  const [canvasCursor,  setCanvasCursor]  = useState<"default" | "ew-resize" | "crosshair">("default");
  const [sliceMode,      setSliceMode]      = useState<"auto" | "4" | "8" | "16">("8");
  const [sliceSensitivity, setSliceSensitivity] = useState(0.55); // AUTO sensitivity 0-1
  const [slicing,        setSlicing]        = useState(false);
  // Ref-based guard for synchronous double-click protection (React state batching is too slow)
  const slicingRef = useRef(false);
  // Pending slice markers (onset times in seconds) — shown on waveform before committing to pads
  const [pendingSlices, setPendingSlices] = useState<number[] | null>(null);
  const dragSliceIdx = useRef<number | null>(null); // index into pendingSlices being dragged
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

  // ── Slice workflow: Step 1 — compute markers ─────────────
  const handleComputeSlices = useCallback(async () => {
    const buf = slot.buffer;
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
        onsets = await new Promise<number[]>(resolve =>
          setTimeout(() => resolve(detectTransients(buf, sliceSensitivity, regionStart, regionEnd)), 0)
        );
        if (onsets.length > 16) onsets = onsets.slice(0, 16);
      } else {
        const count = parseInt(sliceMode, 10);
        onsets = sliceEqual(count, regionStart, regionEnd);
      }
      // Always include region start as first marker
      if (!onsets.includes(regionStart)) onsets = [regionStart, ...onsets].sort((a, b) => a - b);
      setPendingSlices(onsets);
    } finally {
      slicingRef.current = false;
      setSlicing(false);
    }
  }, [slot, sliceMode, sliceSensitivity]);

  // ── Slice workflow: Step 2 — commit markers → pads ───────
  const handleCommitSlices = useCallback(() => {
    const buf = slot.buffer;
    if (!buf || !pendingSlices || pendingSlices.length === 0) return;
    const regionEnd = slot.loopEndSeconds > slot.firstBeatOffset
      ? slot.loopEndSeconds
      : buf.duration;
    const regions = onsetsToRegions(pendingSlices, buf.duration, regionEnd, 16);
    const name = slot.fileName.replace(/\.[^.]+$/, "");
    sliceToPads(buf, regions, name);
    setPendingSlices(null);
  }, [slot, pendingSlices, sliceToPads]);

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!slot.buffer || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const w    = rect.width;
    const HIT  = 10; // screen px hit-zone

    // ── Slice marker edit mode ───────────────────────────────
    if (pendingSlices !== null) {
      // Right-click removes nearest marker (but never the first/start marker)
      if (e.button === 2) {
        e.preventDefault();
        const nearest = pendingSlices.reduce((best, t, i) => {
          if (i === 0) return best; // protect first marker
          const px = (t / slot.duration) * w;
          return Math.abs(relX - px) < Math.abs(relX - (pendingSlices[best]! / slot.duration) * w) ? i : best;
        }, 1);
        const px = (pendingSlices[nearest]! / slot.duration) * w;
        if (Math.abs(relX - px) < HIT * 2) {
          setPendingSlices(prev => prev ? prev.filter((_, i) => i !== nearest) : prev);
        }
        return;
      }

      // Check if clicking near an existing marker to drag it
      let hitIdx: number | null = null;
      for (let i = 0; i < pendingSlices.length; i++) {
        const px = (pendingSlices[i]! / slot.duration) * w;
        if (Math.abs(relX - px) < HIT) {
          hitIdx = i;
          break;
        }
      }

      if (hitIdx !== null) {
        // Drag existing marker
        dragSliceIdx.current = hitIdx;
        e.currentTarget.setPointerCapture(e.pointerId);
      } else {
        // Click on empty area → add new marker
        const t = Math.max(0, Math.min(slot.duration, (relX / w) * slot.duration));
        const newSlices = [...pendingSlices, t].sort((a, b) => a - b);
        if (newSlices.length <= 16) setPendingSlices(newSlices);
      }
      return;
    }

    // ── Normal S/E handle mode ───────────────────────────────
    const startX = (slot.firstBeatOffset / slot.duration) * w;
    const endX   = slot.loopEndSeconds > slot.firstBeatOffset
      ? (slot.loopEndSeconds / slot.duration) * w
      : w;

    if (Math.abs(relX - endX) < HIT + 4) {
      dragHandleRef.current = "end";
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (Math.abs(relX - startX) < HIT + 4) {
      dragHandleRef.current = "start";
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }, [slot.buffer, slot.duration, slot.firstBeatOffset, slot.loopEndSeconds, pendingSlices]);

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!slot.buffer || !canvasRef.current) return;

    // ── Slice marker drag ────────────────────────────────────
    if (pendingSlices !== null) {
      if (dragSliceIdx.current !== null) {
        const idx = dragSliceIdx.current;
        let t = xToTime(e.clientX);
        // First marker: clamp to [0, second marker - 0.03]
        // Others: clamp between neighbours
        const prev = idx > 0 ? pendingSlices[idx - 1]! + 0.03 : 0;
        const next = idx < pendingSlices.length - 1 ? pendingSlices[idx + 1]! - 0.03 : slot.duration;
        t = Math.max(prev, Math.min(next, t));
        setPendingSlices(prev => {
          if (!prev) return prev;
          const copy = [...prev];
          copy[idx] = t;
          return copy;
        });
      }
      // Cursor: ew-resize near a marker, crosshair elsewhere
      const rect = canvasRef.current.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const w    = rect.width;
      const near = pendingSlices.some(t => Math.abs(relX - (t / slot.duration) * w) < 10);
      setCanvasCursor(near ? "ew-resize" : "crosshair");
      return;
    }

    // ── Normal S/E handle hover + drag ───────────────────────
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

    const freeSnap = e.altKey;
    const minGap   = 0.05;
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
      pendingSlices, slotIndex, xToTime, snapToGrid, setFirstBeatOffset, setLoopEndSeconds]);

  const handleCanvasPointerUp = useCallback(() => {
    if (dragSliceIdx.current !== null) {
      dragSliceIdx.current = null;
      return;
    }
    if (dragHandleRef.current !== null) {
      restartSlot(slotIndex);
    }
    dragHandleRef.current = null;
    setCanvasCursor(pendingSlices !== null ? "crosshair" : "default");
  }, [slotIndex, restartSlot, pendingSlices]);

  const handleCanvasPointerLeave = useCallback(() => {
    if (!dragHandleRef.current && dragSliceIdx.current === null) {
      setCanvasCursor(pendingSlices !== null ? "crosshair" : "default");
    }
  }, [pendingSlices]);

  // ── Redraw waveform + beat grid + slice markers ──────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !slot.buffer) return;
    drawWaveform(
      canvas,
      slot.buffer,
      slot.firstBeatOffset,
      slot.loopEndSeconds,
      slot.analyzing ? 0 : slot.originalBpm,
      pendingSlices ?? undefined,
    );
  }, [slot.buffer, slot.firstBeatOffset, slot.loopEndSeconds, slot.originalBpm, slot.analyzing, pendingSlices]);

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
  const clampedRatio   = Math.max(0.1, Math.min(8, ratio));
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

      {/* ── Row 2: Waveform / drop zone — always visible ── */}
      <div
        ref={waveContRef}
        className="relative rounded overflow-hidden transition-all"
        style={{
          height: pendingSlices !== null ? 52 : 32, // expand in slice-edit mode
          background: isDragOver ? `rgba(46,196,182,0.08)` : pendingSlices !== null ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.35)",
          border: isDragOver
            ? `1px dashed ${TEAL}60`
            : pendingSlices !== null
              ? "1px solid rgba(245,158,11,0.25)"
              : slot.buffer ? "1px solid rgba(255,255,255,0.05)" : "1px dashed rgba(255,255,255,0.08)",
        }}
      >
        {slot.buffer ? (
          <canvas
            ref={canvasRef}
            width={900}
            height={pendingSlices !== null ? 52 : 32}
            className="w-full h-full"
            style={{ imageRendering: "pixelated", display: "block", cursor: canvasCursor }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerLeave={handleCanvasPointerLeave}
            onContextMenu={(e) => pendingSlices !== null && e.preventDefault()}
          />
        ) : (
          <label className="absolute inset-0 flex items-center justify-center cursor-pointer">
            <span className="text-[7px] font-bold tracking-[0.16em]" style={{ color: `${TEAL}28` }}>
              DROP AUDIO HERE
            </span>
            <input type="file" accept="audio/*" className="hidden" onChange={handleFileInput} />
          </label>
        )}
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

          {/* Warp Mode + Transpose */}
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Mode selector */}
            <span className="text-[6px] font-bold text-white/20 mr-0.5">WARP</span>
            {(["repitch", "beats", "complex"] as const).map((m) => {
              const labels: Record<string, string> = { repitch: "RE-PITCH", beats: "BEATS", complex: "COMPLEX" };
              const isActive = slot.warpMode === m;
              return (
                <button
                  key={m}
                  onClick={() => setWarpMode(slotIndex, m)}
                  disabled={slot.pitching}
                  className="text-[6px] font-bold px-1.5 py-0.5 rounded transition-all"
                  style={{
                    background: isActive ? `rgba(46,196,182,0.20)` : "rgba(255,255,255,0.03)",
                    color: isActive ? TEAL : "rgba(255,255,255,0.3)",
                    border: `1px solid ${isActive ? `${TEAL}50` : "rgba(255,255,255,0.07)"}`,
                  }}
                  title={
                    m === "repitch"
                      ? "Re-Pitch: vinyl — pitch and tempo shift together (instant)"
                      : m === "beats"
                      ? "Beats: WSOLA — pitch without tempo change, best for drums"
                      : "Complex: Phase Vocoder — pitch without tempo change, best for melodic loops"
                  }
                >
                  {labels[m]}
                </button>
              );
            })}

            <div className="w-px h-3 bg-white/8 mx-0.5" />

            {/* Transpose nudge buttons */}
            <span className="text-[6px] font-bold text-white/20 mr-0.5">ST</span>
            {slot.pitching ? (
              <svg width="10" height="10" viewBox="0 0 10 10" style={{ animation: "spin 0.8s linear infinite" }}>
                <circle cx="5" cy="5" r="4" stroke={`${TEAL}30`} strokeWidth="1.5" fill="none" />
                <path d="M5 1A4 4 0 0 1 9 5" stroke={TEAL} strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            ) : (
              <>
                {([-12, -1, +1, +12] as const).map((delta) => (
                  <button
                    key={delta}
                    onClick={() => setTranspose(slotIndex, slot.transpose + delta)}
                    className="text-[7px] font-bold px-1 py-0.5 rounded transition-all"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      color: "rgba(255,255,255,0.45)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                    title={`${delta > 0 ? "+" : ""}${delta} semitone${Math.abs(delta) !== 1 ? "s" : ""}`}
                  >
                    {delta === 12 ? "+8ve" : delta === -12 ? "-8ve" : delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
              </>
            )}

            {/* Value badge — click to reset */}
            <button
              onClick={() => !slot.pitching && setTranspose(slotIndex, 0)}
              disabled={slot.pitching}
              className="text-[7px] font-bold px-1.5 py-0.5 rounded tabular-nums transition-all"
              style={{
                background: slot.transpose !== 0 ? `rgba(46,196,182,0.18)` : "rgba(255,255,255,0.03)",
                color: slot.transpose !== 0 ? TEAL : "rgba(255,255,255,0.18)",
                border: `1px solid ${slot.transpose !== 0 ? `${TEAL}45` : "rgba(255,255,255,0.06)"}`,
                minWidth: 30,
                cursor: slot.transpose !== 0 && !slot.pitching ? "pointer" : "default",
              }}
              title={slot.transpose !== 0 ? "Click to reset pitch to 0" : "No pitch shift"}
            >
              {slot.transpose === 0 ? "0st" : `${slot.transpose > 0 ? "+" : ""}${slot.transpose}st`}
            </button>
          </div>

          <div className="w-px h-3.5 bg-white/8 shrink-0" />

          {/* Slice → Pads — 2-step workflow */}
          {pendingSlices === null ? (
            // Step 1: configure + compute
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
              {sliceMode === "auto" && (
                <input type="range" min={10} max={95} step={5}
                  value={Math.round(sliceSensitivity * 100)}
                  onChange={(e) => setSliceSensitivity(parseInt(e.target.value) / 100)}
                  className="w-10 h-[3px]"
                  style={{ accentColor: TEAL }}
                  title={`Sensitivity: ${Math.round(sliceSensitivity * 100)}% (more → fewer slices)`}
                />
              )}
              <button onClick={handleComputeSlices} disabled={slicing}
                className="text-[7px] font-black px-1.5 py-0.5 rounded transition-all shrink-0"
                style={{ background: slicing ? `rgba(46,196,182,0.06)` : `rgba(46,196,182,0.12)`, color: slicing ? `${TEAL}50` : TEAL, border: `1px solid ${slicing ? `${TEAL}18` : `${TEAL}40`}`, cursor: slicing ? "wait" : "pointer" }}
                title="Compute slice markers — then edit on waveform">
                {slicing ? "…" : "SLICE"}
              </button>
            </div>
          ) : (
            // Step 2: edit markers, then commit or cancel
            <div className="flex items-center gap-0.5 shrink-0">
              <span className="text-[6px] font-bold tracking-[0.1em]" style={{ color: "#f59e0b" }}>
                {pendingSlices.length} SLICES
              </span>
              <span className="text-[6px] text-white/20 hidden sm:block">· drag · click=add · right-click=del</span>
              <button onClick={handleCommitSlices}
                className="text-[7px] font-black px-1.5 py-0.5 rounded transition-all"
                style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.4)" }}
                title="Send slices to Sampler pads">
                →PADS
              </button>
              <button onClick={() => setPendingSlices(null)}
                className="text-[7px] font-bold px-1 py-0.5 rounded transition-all"
                style={{ color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)" }}
                title="Cancel slicing">
                ✕
              </button>
            </div>
          )}

        </div>
      )}
    </div>
  );
});

// ── Main tab ───────────────────────────────────────────────────────────────────

export function LoopPlayerTab() {
  const globalBpm   = useDrumStore((s) => s.bpm);
  const isPlaying   = useDrumStore((s) => s.isPlaying);
  const togglePlay  = useDrumStore((s) => s.togglePlay);
  const setBpm      = useDrumStore((s) => s.setBpm);
  const stopAll     = useLoopPlayerStore((s) => s.stopAll);
  const slots       = useLoopPlayerStore((s) => s.slots);

  const armedCount  = slots.filter((s) => s.playing).length;
  const activeCount = armedCount > 0 && isPlaying ? armedCount : 0;
  const anyAnalyzing = slots.some((s) => s.analyzing);

  const [bpmEdit, setBpmEdit] = useState(String(globalBpm));
  // Keep BPM input in sync when changed from other components
  useEffect(() => { setBpmEdit(String(globalBpm)); }, [globalBpm]);
  const commitBpm = () => {
    const v = parseFloat(bpmEdit);
    if (!isNaN(v) && v >= 30 && v <= 300) setBpm(v);
    else setBpmEdit(String(globalBpm));
  };

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* Transport bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg"
        style={{
          background: isPlaying
            ? `linear-gradient(90deg, ${TEAL}0a, ${TEAL}14, ${TEAL}0a)`
            : "rgba(255,255,255,0.025)",
          border: `1px solid ${isPlaying ? TEAL + "30" : "rgba(255,255,255,0.07)"}`,
        }}
      >
        {/* PLAY / STOP */}
        <button
          onClick={togglePlay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md font-black text-[9px] tracking-[0.14em] transition-all shrink-0"
          style={isPlaying ? {
            background: `${TEAL}22`,
            color: TEAL,
            border: `1px solid ${TEAL}55`,
            boxShadow: `0 0 12px ${TEAL}30`,
          } : {
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.65)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <span style={{ fontSize: 10 }}>{isPlaying ? "■" : "▶"}</span>
          {isPlaying ? "STOP" : "PLAY"}
        </button>

        {/* Animated dot */}
        <div
          className="w-2 h-2 rounded-full shrink-0 transition-all"
          style={{
            background: isPlaying ? TEAL : "rgba(255,255,255,0.1)",
            boxShadow: isPlaying ? `0 0 8px ${TEAL}` : "none",
            animation: isPlaying ? "pulse 1s ease-in-out infinite" : "none",
          }}
        />

        {/* BPM input */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[7px] font-bold text-white/30">BPM</span>
          <input
            type="number" min={30} max={300} step={1}
            value={bpmEdit}
            onChange={(e) => setBpmEdit(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={(e) => { if (e.key === "Enter") commitBpm(); }}
            className="w-12 text-center text-[11px] font-black rounded px-1 py-0.5 tabular-nums"
            style={{
              background: "rgba(0,0,0,0.35)",
              border: `1px solid ${isPlaying ? TEAL + "35" : "rgba(255,255,255,0.1)"}`,
              color: isPlaying ? TEAL : "rgba(255,255,255,0.85)",
              outline: "none",
            }}
          />
        </div>

        {/* BPM nudge */}
        <div className="flex gap-[2px] shrink-0">
          {([-5, -1, +1, +5] as const).map((delta) => (
            <button
              key={delta}
              onClick={() => setBpm(globalBpm + delta)}
              className="text-[7px] font-bold px-1 py-0.5 rounded transition-colors"
              style={{ color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)" }}
            >
              {delta > 0 ? `+${delta}` : delta}
            </button>
          ))}
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
          <span className="text-[7px] text-white/20 hidden sm:block">⊞ next bar</span>
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

        <span className="text-[7px] font-black tracking-[0.18em] text-white/20">LOOP PLAYER</span>

        {/* Stop all loops */}
        <button
          onClick={stopAll}
          className="text-[8px] font-bold px-2 py-1 rounded transition-all shrink-0"
          style={{
            color:  armedCount > 0 ? "rgba(255,80,80,0.85)" : "rgba(255,255,255,0.2)",
            border: `1px solid ${armedCount > 0 ? "rgba(255,80,80,0.25)" : "rgba(255,255,255,0.06)"}`,
            background: armedCount > 0 ? "rgba(255,80,80,0.07)" : "transparent",
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
