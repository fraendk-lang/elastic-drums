/**
 * LoopPlayerTab — 4-slot tempo-synced audio loop player
 *
 * Each slot:
 *  - Drag & drop or click-to-load any audio file
 *  - Waveform display
 *  - Original BPM input → playbackRate auto-adjusted to global BPM
 *  - Volume slider
 *  - PLAY / STOP button
 *
 * Slots start immediately on PLAY (no transport required).
 * When transport starts, all armed slots restart in phase.
 * BPM changes update playback rates in real time — no restart needed.
 */

import { useRef, useEffect, useCallback, useState, memo } from "react";
import { useLoopPlayerStore } from "../store/loopPlayerStore";
import { useDrumStore } from "../store/drumStore";
import { audioEngine } from "../audio/AudioEngine";

// ── Theme ──────────────────────────────────────────────────────────────────────
const TEAL = "#2EC4B6";

// ── Waveform drawing ───────────────────────────────────────────────────────────

function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const data = buffer.getChannelData(0);
  const w    = canvas.width;
  const h    = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const step = data.length / w;

  // Background grid lines (subtle)
  ctx.fillStyle = "rgba(46,196,182,0.04)";
  ctx.fillRect(0, h / 2 - 0.5, w, 1);

  // Waveform bars
  for (let x = 0; x < w; x++) {
    const idx = Math.floor(x * step);
    const amp = Math.abs(data[idx] ?? 0) * h * 0.88;
    ctx.fillStyle = "rgba(46,196,182,0.72)";
    ctx.fillRect(x, h / 2 - amp / 2, 1, Math.max(1, amp));
  }
}

// ── Slot component ─────────────────────────────────────────────────────────────

interface LoopSlotProps {
  slotIndex: number;
}

const LoopSlot = memo(function LoopSlot({ slotIndex }: LoopSlotProps) {
  const slot          = useLoopPlayerStore((s) => s.slots[slotIndex]!);
  const setBuffer     = useLoopPlayerStore((s) => s.setBuffer);
  const setOriginalBpm = useLoopPlayerStore((s) => s.setOriginalBpm);
  const setVolume     = useLoopPlayerStore((s) => s.setVolume);
  const togglePlay    = useLoopPlayerStore((s) => s.togglePlay);
  const globalBpm     = useDrumStore((s) => s.bpm);
  const isTransportPlaying = useDrumStore((s) => s.isPlaying);

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [bpmInput,  setBpmInput]    = useState(String(slot.originalBpm));

  // Keep bpmInput text in sync when originalBpm changes externally
  useEffect(() => {
    setBpmInput(String(slot.originalBpm));
  }, [slot.originalBpm]);

  // Redraw waveform when buffer changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !slot.buffer) return;
    drawWaveform(canvas, slot.buffer);
  }, [slot.buffer]);

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
  }, [handleLoadFile]);

  // ── BPM commit ───────────────────────────────────────────
  const commitBpm = useCallback(() => {
    const parsed = parseFloat(bpmInput);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 999) {
      setOriginalBpm(slotIndex, parsed);
    } else {
      setBpmInput(String(slot.originalBpm)); // revert on bad input
    }
  }, [bpmInput, slotIndex, slot.originalBpm, setOriginalBpm]);

  // ── Derived display values ────────────────────────────────
  const ratio          = slot.originalBpm > 0 ? globalBpm / slot.originalBpm : 1;
  const clampedRatio   = Math.max(0.1, Math.min(4, ratio));
  const pitchSemitones = Math.log2(clampedRatio) * 12;
  const ratioLabel     = clampedRatio.toFixed(2);
  const ratioOff       = Math.abs(clampedRatio - 1) > 0.015;

  // A slot is audibly active when it is armed AND audio sources are running.
  // (Transport-stopped arm = armed but silent, transport-started arm = armed + active)
  const isArmed  = slot.playing;
  const isActive = isArmed && isTransportPlaying;

  // Format duration as mm:ss
  const dur       = slot.duration;
  const durMin    = Math.floor(dur / 60);
  const durSec    = (dur % 60).toFixed(1).padStart(4, "0");
  const durLabel  = slot.buffer ? `${durMin}:${durSec}` : "";

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
      {/* ── Row 1: Slot ID + filename + duration + LOAD button ── */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Slot number badge */}
        <div
          className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold shrink-0 transition-all"
          style={{
            background: isArmed ? TEAL : "rgba(255,255,255,0.06)",
            color: isArmed ? "#000" : "rgba(255,255,255,0.3)",
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
          <span
            className="text-[8px] font-bold tabular-nums shrink-0"
            style={{ color: `${TEAL}70` }}
          >
            {durLabel}
          </span>
        )}

        {/* Load file */}
        <label
          className="text-[8px] font-bold px-2 py-0.5 rounded cursor-pointer transition-all shrink-0"
          style={{
            color: "rgba(255,255,255,0.35)",
            border: "1px solid rgba(255,255,255,0.09)",
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
        className="relative rounded overflow-hidden"
        style={{
          height: 52,
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        {slot.buffer ? (
          <canvas
            ref={canvasRef}
            width={900}
            height={52}
            className="w-full h-full"
            style={{ imageRendering: "pixelated", display: "block" }}
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center text-[8px] font-bold tracking-[0.18em]"
            style={{ color: `${TEAL}20` }}
          >
            WAVEFORM
          </div>
        )}

        {/* Active shimmer overlay */}
        {isActive && (
          <div
            className="absolute inset-0 pointer-events-none ed-shimmer-text"
            style={{
              background: `linear-gradient(90deg, transparent, ${TEAL}12 50%, transparent)`,
              backgroundSize: "200% 100%",
              animation: "ed-shimmer 2.5s linear infinite",
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
              : slot.buffer
                ? "rgba(255,255,255,0.06)"
                : "rgba(255,255,255,0.02)",
            color: isArmed
              ? "#000814"
              : slot.buffer
                ? "rgba(255,255,255,0.75)"
                : "rgba(255,255,255,0.18)",
            border: `1px solid ${isArmed ? TEAL : "rgba(255,255,255,0.08)"}`,
            boxShadow: isActive ? `0 0 12px ${TEAL}70` : "none",
            cursor: slot.buffer ? "pointer" : "default",
          }}
        >
          <span style={{ fontSize: 8 }}>{isArmed ? "■" : "▶"}</span>
          {isArmed ? "STOP" : "PLAY"}
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-white/8 shrink-0" />

        {/* Original BPM input */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[7px] font-bold tracking-[0.12em] text-white/30">FILE BPM</span>
          <input
            type="number"
            min={1}
            max={999}
            step={0.5}
            value={bpmInput}
            onChange={(e) => setBpmInput(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={(e) => { if (e.key === "Enter") commitBpm(); }}
            className="w-14 text-center text-[10px] font-bold rounded px-1 py-0.5 tabular-nums"
            style={{
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.82)",
              outline: "none",
            }}
          />
        </div>

        {/* Playback ratio badge */}
        <div
          className="flex items-center gap-1 px-2 py-0.5 rounded shrink-0"
          style={{
            background: "rgba(0,0,0,0.22)",
            border: "1px solid rgba(255,255,255,0.05)",
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
            <span
              className="text-[7px] font-bold tabular-nums"
              style={{ color: `${TEAL}70` }}
            >
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

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* Header bar */}
      <div className="flex items-center gap-3 px-0.5">
        <span className="text-[8px] font-bold tracking-[0.18em] text-white/30">LOOP PLAYER</span>

        {/* Transport indicator */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full transition-all"
            style={{
              background: isPlaying ? TEAL : "rgba(255,255,255,0.12)",
              boxShadow: isPlaying ? `0 0 6px ${TEAL}` : "none",
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
            style={{
              background: `${TEAL}18`,
              color: TEAL,
              border: `1px solid ${TEAL}30`,
            }}
          >
            {activeCount} PLAYING
          </span>
        )}

        <span className="text-[7px] text-white/18 ml-1 hidden sm:block">
          Loops start immediately · Restart in phase when transport plays
        </span>

        <div className="flex-1" />

        {/* Stop all */}
        <button
          onClick={stopAll}
          className="text-[8px] font-bold px-2 py-0.5 rounded transition-all"
          style={{
            color: armedCount > 0 ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)",
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
        Drop WAV / MP3 onto any slot · Set FILE BPM to match the loop's native tempo
      </p>

    </div>
  );
}
