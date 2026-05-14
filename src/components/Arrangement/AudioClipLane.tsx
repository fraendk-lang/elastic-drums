/**
 * AudioClipLane — dedicated track lane for dropped WAV / MP3 audio clips.
 *
 * Extracted from the 3690-line ArrangementView.tsx monolith. Renders an
 * audio waveform with trim handles, fade-in/out overlays, loop toggle and
 * drag-to-move / drag-to-resize / drag-to-split affordances.
 *
 * Co-located with the LoopWaveformCanvas helper because it's a tight
 * audio-clip-specific dependency — anywhere else that paints sample peaks
 * (the loop player rows in ArrangementView) imports the same helper from
 * here.
 */

import { useCallback, useEffect, useRef } from "react";
import { type AudioClip } from "../../store/audioClipStore";
import { hexAlpha } from "../../utils/arrangementColors";

const AUDIO_COLOR = "#f97316"; // warm orange — distinct from the drum red

// ── LoopWaveformCanvas ─────────────────────────────────────────────────────

interface LoopWaveformCanvasProps {
  peaks:  Float32Array;
  color:  string;
  width:  number;
  height: number;
}

export function LoopWaveformCanvas({ peaks, color, width, height }: LoopWaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    const count  = peaks.length;
    const barW   = Math.max(1, width / count);
    const mid    = height / 2;

    ctx.fillStyle = hexAlpha(color, 0.55);
    for (let i = 0; i < count; i++) {
      const amp  = peaks[i]!;
      const barH = Math.max(1, amp * mid * 1.8);
      const x    = i * barW;
      ctx.fillRect(x, mid - barH, barW - 0.5, barH * 2);
    }
  }, [peaks, color, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none"
      style={{ width, height }}
    />
  );
}

// ── AudioClipLane ──────────────────────────────────────────────────────────

interface AudioClipLaneProps {
  clips:          AudioClip[];
  barPx:          number;
  height:         number;
  totalBars:      number;
  selectedId:     string | null;
  onRemove:       (id: string) => void;
  onMove:         (id: string, startBar: number) => void;
  onResize:       (id: string, durationBars: number) => void;
  onDrop:         (e: React.DragEvent) => void;
  onSelect:       (id: string | null) => void;
  onLoop:         (id: string, loop: boolean) => void;
  onTrimPoints:   (id: string, startSec: number, endSec: number) => void;
  onSplit:        (id: string, splitAtSec: number) => void;
}

export function AudioClipLane({
  clips, barPx, height, totalBars, selectedId,
  onRemove, onMove, onResize, onDrop, onSelect, onLoop, onTrimPoints, onSplit,
}: AudioClipLaneProps) {
  const laneRef   = useRef<HTMLDivElement>(null);
  const dragRef   = useRef<{ id: string; offsetBar: number } | null>(null);
  const resizeRef = useRef<{ id: string; origBars: number; startX: number } | null>(null);
  const trimRef   = useRef<{
    id: string; side: "left" | "right";
    origSec: number; startX: number;
  } | null>(null);
  const hoverRef  = useRef<{ id: string; atSec: number } | null>(null);

  const handleClipPointerDown = useCallback((e: React.PointerEvent, clip: AudioClip) => {
    if ((e.target as HTMLElement).dataset.resize) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const lane = laneRef.current;
    if (!lane) return;
    const laneRect = lane.getBoundingClientRect();
    const clickBar = (e.clientX - laneRect.left) / barPx;
    dragRef.current = { id: clip.id, offsetBar: clickBar - clip.startBar };
  }, [barPx]);

  const handleLanePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) {
      const lane = laneRef.current;
      if (!lane) return;
      const laneRect = lane.getBoundingClientRect();
      const rawBar   = (e.clientX - laneRect.left) / barPx - dragRef.current.offsetBar;
      onMove(dragRef.current.id, Math.max(0, Math.round(rawBar)));
    }
    if (resizeRef.current) {
      const dx        = e.clientX - resizeRef.current.startX;
      const deltaBars = dx / barPx;
      onResize(resizeRef.current.id, Math.max(0.5, resizeRef.current.origBars + deltaBars));
    }
    if (trimRef.current) {
      const clip = clips.find((c) => c.id === trimRef.current!.id);
      if (!clip) return;
      const clipWPx = clip.durationBars * barPx;
      const dxSec   = ((e.clientX - trimRef.current.startX) / clipWPx) * clip.buffer.duration;
      if (trimRef.current.side === "left") {
        onTrimPoints(clip.id, trimRef.current.origSec + dxSec, clip.sampleEndSec);
      } else {
        onTrimPoints(clip.id, clip.sampleStartSec, trimRef.current.origSec + dxSec);
      }
    }
  }, [barPx, onMove, onResize, onTrimPoints, clips]);

  const handleLanePointerUp = useCallback(() => {
    dragRef.current   = null;
    resizeRef.current = null;
    trimRef.current   = null;
  }, []);

  const handleResizePointerDown = useCallback((e: React.PointerEvent, clip: AudioClip) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { id: clip.id, origBars: clip.durationBars, startX: e.clientX };
  }, []);

  const handleTrimPointerDown = useCallback((
    e: React.PointerEvent,
    clip: AudioClip,
    side: "left" | "right",
  ) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    trimRef.current = {
      id:      clip.id,
      side,
      origSec: side === "left" ? clip.sampleStartSec : clip.sampleEndSec,
      startX:  e.clientX,
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "e") return;
      if (!selectedId) return;
      const clip = clips.find((c) => c.id === selectedId);
      if (!clip) return;
      const atSec = hoverRef.current?.id === selectedId
        ? hoverRef.current.atSec
        : (clip.sampleStartSec + clip.sampleEndSec) / 2;
      onSplit(selectedId, atSec);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, clips, onSplit]);

  return (
    <div
      ref={laneRef}
      className="relative border-b border-black/20"
      style={{ height, minWidth: totalBars * barPx, backgroundColor: hexAlpha(AUDIO_COLOR, 0.03) }}
      onPointerMove={handleLanePointerMove}
      onPointerUp={handleLanePointerUp}
      onPointerCancel={handleLanePointerUp}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDrop={onDrop}
    >
      {/* Drop hint when empty */}
      {clips.length === 0 && (
        <div className="absolute inset-0 flex items-center px-3 pointer-events-none">
          <span className="text-[7px] tracking-widest" style={{ color: hexAlpha(AUDIO_COLOR, 0.25) }}>
            AUDIO — drag WAV / MP3 to place
          </span>
        </div>
      )}

      {clips.map((clip) => {
        const x   = clip.startBar * barPx;
        const w   = Math.max(barPx * 0.5, clip.durationBars * barPx);
        const dur = clip.buffer.duration;
        const sel = selectedId === clip.id;

        // Trim handle positions as fractions of clip width
        const trimLFrac = dur > 0 ? clip.sampleStartSec / dur : 0;
        const trimRFrac = dur > 0 ? clip.sampleEndSec   / dur : 1;
        const trimLPx   = trimLFrac * w;
        const trimRPx   = trimRFrac * w;

        return (
          <div
            key={clip.id}
            className="absolute top-1 bottom-1 select-none"
            style={{
              left:            x,
              width:           w,
              backgroundColor: hexAlpha(clip.color, 0.15),
              border:          `1px solid ${sel ? hexAlpha(clip.color, 0.85) : hexAlpha(clip.color, 0.4)}`,
              boxShadow:       sel ? `0 0 0 1px ${hexAlpha(clip.color, 0.35)}` : undefined,
              borderRadius:    5,
              overflow:        "hidden",
              cursor:          "grab",
            }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).dataset.trim) return;
              if ((e.target as HTMLElement).dataset.resize) return;
              handleClipPointerDown(e, clip);
              onSelect(clip.id);
            }}
            onPointerMove={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / w));
              hoverRef.current = { id: clip.id, atSec: frac * dur };
            }}
            onPointerLeave={() => { hoverRef.current = null; }}
            onContextMenu={(e) => { e.preventDefault(); onRemove(clip.id); }}
          >
            {/* Waveform */}
            {w > 24 && (
              <LoopWaveformCanvas
                peaks={clip.waveformPeaks}
                color={clip.color}
                width={w - 2}
                height={height - 10}
              />
            )}

            {/* Dimmed region — excluded left */}
            {trimLPx > 1 && (
              <div
                className="absolute top-0 bottom-0 left-0 pointer-events-none"
                style={{ width: trimLPx, backgroundColor: "rgba(0,0,0,0.55)" }}
              />
            )}

            {/* Dimmed region — excluded right */}
            {trimRPx < w - 1 && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left:            trimRPx,
                  right:           12,
                  backgroundColor: "rgba(0,0,0,0.55)",
                }}
              />
            )}

            {/* Fade-in overlay */}
            {clip.fadeInSec > 0 && (() => {
              const fadePx = (clip.fadeInSec / ((clip.sampleEndSec - clip.sampleStartSec) || 1)) * (w - 24);
              return (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{
                    left:       trimLPx,
                    width:      Math.max(0, fadePx),
                    background: "linear-gradient(to right, rgba(0,0,0,0.5), transparent)",
                  }}
                />
              );
            })()}

            {/* Fade-out overlay */}
            {clip.fadeOutSec > 0 && (() => {
              const fadePx = (clip.fadeOutSec / ((clip.sampleEndSec - clip.sampleStartSec) || 1)) * (w - 24);
              return (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{
                    right:      12 + (w - trimRPx - 12),
                    width:      Math.max(0, fadePx),
                    background: "linear-gradient(to left, rgba(0,0,0,0.5), transparent)",
                  }}
                />
              );
            })()}

            {/* Trim-left handle */}
            <div
              data-trim="left"
              className="absolute top-0 bottom-0 z-10 cursor-ew-resize"
              style={{
                left:            Math.max(0, trimLPx - 3),
                width:           6,
                backgroundColor: hexAlpha(clip.color, 0.9),
                borderRadius:    "3px 0 0 3px",
              }}
              onPointerDown={(e) => handleTrimPointerDown(e, clip, "left")}
            />

            {/* Trim-right handle */}
            <div
              data-trim="right"
              className="absolute top-0 bottom-0 z-10 cursor-ew-resize"
              style={{
                left:            Math.min(w - 15, trimRPx - 3),
                width:           6,
                backgroundColor: hexAlpha(clip.color, 0.9),
                borderRadius:    "0 3px 3px 0",
              }}
              onPointerDown={(e) => handleTrimPointerDown(e, clip, "right")}
            />

            {/* Filename label + loop toggle */}
            <div className="absolute top-0 left-0 right-6 flex items-center gap-1 px-1.5 pt-0.5">
              <span
                className="text-[6px] font-bold truncate block leading-tight pointer-events-none"
                style={{ color: hexAlpha(clip.color, 0.85) }}
              >
                {clip.fileName.replace(/\.[^.]+$/, "")}
              </span>
              {/* Loop toggle — click to enable/disable looping */}
              <button
                className="shrink-0 flex items-center justify-center rounded"
                style={{
                  width: 10, height: 10,
                  fontSize: 8,
                  background: clip.loop ? hexAlpha(clip.color, 0.35) : "transparent",
                  border: `1px solid ${hexAlpha(clip.color, clip.loop ? 0.8 : 0.3)}`,
                  color: hexAlpha(clip.color, clip.loop ? 1 : 0.4),
                  cursor: "pointer",
                  lineHeight: 1,
                }}
                title={clip.loop ? "Loop off" : "Loop on"}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onLoop(clip.id, !clip.loop); }}
              >
                ↺
              </button>
            </div>

            {/* Resize handle */}
            <div
              className="absolute top-0 bottom-0 right-0 w-3 cursor-col-resize hover:bg-white/10"
              data-resize="true"
              onPointerDown={(e) => handleResizePointerDown(e, clip)}
            />
          </div>
        );
      })}
    </div>
  );
}
