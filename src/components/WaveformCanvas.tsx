/**
 * WaveformCanvas — Compact bar-waveform with Ableton-style drag handles.
 *
 * Rendering:
 *  - 3px-wide bars, 2px gap, centered vertically from midpoint
 *  - Bars inside [loopStart, loopEnd] (normalized 0..1): teal #2EC4B6
 *  - Bars outside: #555 at 0.35 opacity
 *  - Start handle: 3px teal line full height + 8×10px tab at top + 8×10px tab at bottom
 *  - End handle: same
 *  - Playhead: 1.5px white line
 *
 * Pointer events:
 *  - Hit-test within 8px of handle → drag start/end
 *  - pointermove → update position (clamped, start < end - minGap)
 *  - pointerup → call onDragEnd()
 */

import { useRef, useEffect, useCallback } from "react";

const TEAL = "#2EC4B6";
const BAR_W = 3;
const BAR_GAP = 2;
const BAR_STRIDE = BAR_W + BAR_GAP;
const HIT_RADIUS = 8;
const MIN_GAP = 0.02;

// suppress unused warning — BAR_STRIDE is part of the documented API
void BAR_STRIDE;

export interface WaveformCanvasProps {
  peaks:              Float32Array;
  loopStart:          number;            // 0..1 normalized
  loopEnd:            number;            // 0..1 normalized
  playing:            boolean;
  playStartedAt:      number | null;     // AudioContext time when playback started
  loopDuration:       number;            // seconds, for playhead calculation
  onLoopStartChange:  (pos: number) => void;
  onLoopEndChange:    (pos: number) => void;
  onDragEnd:          () => void;
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, H: number): void {
  const EAR_W = 8;
  const EAR_H = 10;
  const LINE_W = 3;

  ctx.fillStyle = TEAL;
  // Full-height teal line
  ctx.fillRect(x - LINE_W / 2, 0, LINE_W, H);
  // Top ear
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x - EAR_W / 2, 0, EAR_W, EAR_H, 2);
  } else {
    ctx.rect(x - EAR_W / 2, 0, EAR_W, EAR_H);
  }
  ctx.fill();
  // Bottom ear
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x - EAR_W / 2, H - EAR_H, EAR_W, EAR_H, 2);
  } else {
    ctx.rect(x - EAR_W / 2, H - EAR_H, EAR_W, EAR_H);
  }
  ctx.fill();
}

function drawCanvas(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  loopStart: number,
  loopEnd: number,
  playhead: number, // -1 = hidden
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // ctx.scale(dpr,dpr) was applied when the canvas was sized, so drawing
  // coordinates must be in CSS pixels, not physical pixels.
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width / dpr;
  const H = canvas.height / dpr;
  const midY = H / 2;

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = "#1c1c22";
  ctx.fillRect(0, 0, W, H);

  // Loop region tinted background
  const startPx = loopStart * W;
  const endPx   = loopEnd * W;
  ctx.fillStyle = `${TEAL}12`;
  ctx.fillRect(startPx, 0, endPx - startPx, H);

  // Waveform bars
  const numBars = peaks.length;
  for (let i = 0; i < numBars; i++) {
    const norm = (i + 0.5) / numBars; // center of bar in normalized space
    const insideLoop = norm >= loopStart && norm < loopEnd;
    const peak = peaks[i] ?? 0;
    const barH = Math.max(2, peak * (H - 8));
    const x = (i / numBars) * W;
    const y = midY - barH / 2;

    if (insideLoop) {
      ctx.fillStyle = TEAL;
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#555";
      ctx.globalAlpha = 0.35;
    }
    ctx.fillRect(x, y, BAR_W, barH);
  }
  ctx.globalAlpha = 1;

  // Handles (draw after bars so they appear on top)
  drawHandle(ctx, startPx, H);
  drawHandle(ctx, endPx, H);

  // Playhead
  if (playhead >= 0 && playhead <= 1) {
    const px = playhead * W;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(px - 0.75, 0, 1.5, H);
  }
}

export function WaveformCanvas({
  peaks,
  loopStart,
  loopEnd,
  playing,
  playStartedAt,
  loopDuration,
  onLoopStartChange,
  onLoopEndChange,
  onDragEnd,
}: WaveformCanvasProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const rafRef      = useRef<number>(0);
  const dragRef     = useRef<"start" | "end" | null>(null);
  const playheadRef = useRef<number>(-1);

  // Redraw whenever non-playhead state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    const ctx2 = canvas.getContext("2d");
    if (ctx2) ctx2.scale(dpr, dpr);
    drawCanvas(canvas, peaks, loopStart, loopEnd, playheadRef.current);
  }, [peaks, loopStart, loopEnd]);

  // RAF playhead loop — only when playing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!playing || !canvas || playStartedAt === null || loopDuration <= 0) {
      playheadRef.current = -1;
      // Redraw without playhead
      if (canvas) drawCanvas(canvas, peaks, loopStart, loopEnd, -1);
      return;
    }

    const tick = () => {
      const now =
        (window as unknown as { __audioCtxCurrentTime?: number }).__audioCtxCurrentTime ??
        (Date.now() / 1000);
      const elapsed = Math.max(0, now - playStartedAt);
      const loopPos = (elapsed % loopDuration) / loopDuration;
      // Map loop position to canvas position within [loopStart, loopEnd]
      playheadRef.current = loopStart + loopPos * (loopEnd - loopStart);
      drawCanvas(canvas, peaks, loopStart, loopEnd, playheadRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      playheadRef.current = -1;
    };
  }, [playing, playStartedAt, loopDuration, peaks, loopStart, loopEnd]);

  const xToNorm = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const norm = xToNorm(e.clientX);
    const canvas = canvasRef.current;
    const hitPx = HIT_RADIUS / (canvas?.getBoundingClientRect().width ?? 400);
    const distStart = Math.abs(norm - loopStart);
    const distEnd   = Math.abs(norm - loopEnd);

    if (distEnd < hitPx && distEnd <= distStart) {
      dragRef.current = "end";
    } else if (distStart < hitPx) {
      dragRef.current = "start";
    } else {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = "ew-resize";
  }, [loopStart, loopEnd, xToNorm]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) {
      // Hover cursor
      const norm = xToNorm(e.clientX);
      const canvas = canvasRef.current;
      const hitPx = HIT_RADIUS / (canvas?.getBoundingClientRect().width ?? 400);
      const near = Math.abs(norm - loopStart) < hitPx || Math.abs(norm - loopEnd) < hitPx;
      e.currentTarget.style.cursor = near ? "ew-resize" : "default";
      return;
    }
    const norm = xToNorm(e.clientX);
    if (dragRef.current === "start") {
      onLoopStartChange(Math.max(0, Math.min(norm, loopEnd - MIN_GAP)));
    } else {
      onLoopEndChange(Math.max(loopStart + MIN_GAP, Math.min(norm, 1)));
    }
  }, [loopStart, loopEnd, xToNorm, onLoopStartChange, onLoopEndChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current !== null) {
      dragRef.current = null;
      e.currentTarget.style.cursor = "default";
      onDragEnd();
    }
  }, [onDragEnd]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: 56, display: "block", borderRadius: 4 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
