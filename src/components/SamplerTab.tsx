/**
 * SamplerTab — MPC/Ableton-style 16-pad sample player UI
 *
 * Layout:
 *   [Top: flex gap-4]
 *     Left: 4×4 Pad Grid (w-72)
 *     Right: Detail Panel — waveform + controls
 *   [Bottom: Step Sequencer — 16 rows × patternLength columns]
 */

import {
  useRef,
  useEffect,
  useCallback,
  useState,
  memo,
} from "react";
import { useSamplerStore } from "../store/samplerStore";
import { samplerEngine } from "../audio/SamplerEngine";
import { audioEngine } from "../audio/AudioEngine";
import { Knob } from "./Knob";
import type { SamplerPadParams } from "../audio/SamplerEngine";

// ── Keyboard map: key → pad index (MPC-style bottom-up) ─────────────────────
// Row 4 (pads 12-15): Z X C V
// Row 3 (pads  8-11): A S D F
// Row 2 (pads  4-7 ): Q W E R
// Row 1 (pads  0-3 ): 1 2 3 4
const SAMPLER_KEY_MAP: Record<string, number> = {
  "1": 0,  "2": 1,  "3": 2,  "4": 3,
  "q": 4,  "w": 5,  "e": 6,  "r": 7,
  "a": 8,  "s": 9,  "d": 10, "f": 11,
  "z": 12, "x": 13, "c": 14, "v": 15,
};

// ── Color palette per pad row ────────────────────────────────────────────────
const PAD_COLORS = [
  "var(--ed-accent-orange)", // pads 0–3
  "var(--ed-accent-blue)",   // pads 4–7
  "var(--ed-accent-chords)", // pads 8–11
  "var(--ed-accent-green)",  // pads 12–15
];

function getPadColor(padIndex: number): string {
  return PAD_COLORS[Math.floor(padIndex / 4)] ?? "var(--ed-accent-orange)";
}

// ── Waveform drawing ────────────────────────────────────────────────────────

function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  startPoint: number,
  endPoint: number,
  loopStart: number,
  loopEnd: number,
  playMode: SamplerPadParams["playMode"],
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const data = buffer.getChannelData(0);
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const step = data.length / w;
  for (let x = 0; x < w; x++) {
    const idx = Math.floor(x * step);
    const amp = Math.abs(data[idx] ?? 0) * h * 0.9;
    const ratio = x / w;
    const inRange = ratio >= startPoint && ratio <= endPoint;
    ctx.fillStyle = inRange ? "rgba(244,114,182,0.85)" : "rgba(244,114,182,0.18)";
    ctx.fillRect(x, h / 2 - amp / 2, 1, Math.max(1, amp));
  }

  // Start marker (pink)
  ctx.fillStyle = "#f472b6";
  ctx.fillRect(Math.floor(startPoint * w) - 1, 0, 2, h);

  // End marker (purple)
  ctx.fillStyle = "#a78bfa";
  ctx.fillRect(Math.floor(endPoint * w) - 1, 0, 2, h);

  // Loop markers (green) — only in loop mode
  if (playMode === "loop") {
    ctx.fillStyle = "#34d399";
    ctx.fillRect(Math.floor(loopStart * w), 0, 1, h);
    ctx.fillRect(Math.floor(loopEnd * w), 0, 1, h);
  }
}

// ── Mini waveform on pad ─────────────────────────────────────────────────────

function drawMiniWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const data = buffer.getChannelData(0);
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const step = data.length / w;
  for (let x = 0; x < w; x++) {
    const idx = Math.floor(x * step);
    const amp = Math.abs(data[idx] ?? 0) * h * 0.85;
    ctx.fillStyle = "rgba(244,114,182,0.7)";
    ctx.fillRect(x, h / 2 - amp / 2, 1, Math.max(1, amp));
  }
}

// ── Pad cell ──────────────────────────────────────────────────────────────────

interface PadCellProps {
  padIndex: number;
  isSelected: boolean;
  isPlaying: boolean;
  fileName: string;
  buffer: AudioBuffer | null;
  onSelect: () => void;
  onDrop: (file: File) => void;
  onLoadFile: (file: File) => void;
}

const PadCell = memo(function PadCell({
  padIndex,
  isSelected,
  isPlaying,
  fileName,
  buffer,
  onSelect,
  onDrop,
  onLoadFile,
}: PadCellProps) {
  const color = getPadColor(padIndex);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLoadFile(file);
    e.target.value = "";
  }, [onLoadFile]);

  // Draw mini waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;
    drawMiniWaveform(canvas, buffer);
  }, [buffer]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) onDrop(file);
    },
    [onDrop],
  );

  const truncatedName = fileName
    ? fileName.replace(/\.[^/.]+$/, "").slice(0, 8)
    : "";

  return (
    <div
      className={`relative flex flex-col items-center justify-center cursor-pointer select-none rounded transition-all duration-75 ${
        isDragOver ? "scale-105" : ""
      }`}
      style={{
        width: 72,
        height: 72,
        background: isSelected
          ? `color-mix(in srgb, ${color} 18%, #1a1a22)`
          : "rgba(255,255,255,0.03)",
        border: isSelected
          ? `2px solid ${color}`
          : isDragOver
            ? `2px dashed ${color}`
            : "1px solid rgba(255,255,255,0.08)",
        boxShadow: isPlaying
          ? `0 0 12px ${color}88, inset 0 0 8px ${color}22`
          : "none",
      }}
      onClick={onSelect}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input for click-to-load */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileInputChange}
      />
      {/* Pad number */}
      <span
        className="absolute top-1 left-1.5 text-[8px] font-bold tabular-nums"
        style={{ color: `${color}99` }}
      >
        {padIndex + 1}
      </span>

      {/* Mini waveform */}
      {buffer && (
        <canvas
          ref={canvasRef}
          width={52}
          height={24}
          className="opacity-80"
          style={{ imageRendering: "pixelated" }}
        />
      )}

      {/* Empty pad placeholder — click opens file picker */}
      {!buffer && (
        <div
          className="w-8 h-8 rounded border border-dashed flex items-center justify-center transition-all"
          style={{ borderColor: isDragOver ? color : `${color}40` }}
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          title="Click to load sample"
        >
          <span style={{ color: isDragOver ? color : `${color}55`, fontSize: 14 }}>+</span>
        </div>
      )}

      {/* File name */}
      {truncatedName && (
        <span
          className="absolute bottom-1 text-[7px] font-bold tracking-wide truncate w-full text-center px-1"
          style={{ color: `${color}cc` }}
        >
          {truncatedName}
        </span>
      )}

      {/* Playing glow ring */}
      {isPlaying && (
        <div
          className="absolute inset-0 rounded pointer-events-none animate-pulse"
          style={{ boxShadow: `0 0 0 2px ${color}66` }}
        />
      )}
    </div>
  );
});

// ── Detail Panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  padIndex: number;
}

function DetailPanel({ padIndex, onLoadFile }: DetailPanelProps & { onLoadFile: (file: File) => void }) {
  const pad = useSamplerStore((s) => s.pads[padIndex]!);
  const setParam = useSamplerStore((s) => s.setParam);
  const clearPad = useSamplerStore((s) => s.clearPad);
  const { buffer, params } = pad;
  const detailFileInputRef = useRef<HTMLInputElement>(null);
  const color = getPadColor(padIndex);

  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const [dragTarget, setDragTarget] = useState<"start" | "end" | null>(null);

  // Draw waveform
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas || !buffer) return;
    drawWaveform(
      canvas,
      buffer,
      params.startPoint,
      params.endPoint,
      params.loopStart,
      params.loopEnd,
      params.playMode,
    );
  }, [buffer, params.startPoint, params.endPoint, params.loopStart, params.loopEnd, params.playMode]);

  // Draggable markers on waveform
  const handleWaveMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = waveCanvasRef.current;
      if (!canvas || !buffer) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));

      // Determine which marker is closer
      const distToStart = Math.abs(ratio - params.startPoint);
      const distToEnd = Math.abs(ratio - params.endPoint);
      const target = distToStart < distToEnd ? "start" : "end";
      setDragTarget(target);

      const handleMouseMove = (me: MouseEvent) => {
        const r = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
        if (target === "start") {
          setParam(padIndex, { startPoint: Math.min(r, params.endPoint - 0.01) });
        } else {
          setParam(padIndex, { endPoint: Math.max(r, params.startPoint + 0.01) });
        }
      };

      const handleMouseUp = () => {
        setDragTarget(null);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [buffer, padIndex, params.startPoint, params.endPoint, setParam],
  );

  return (
    <div className="flex-1 flex flex-col gap-2 min-w-0">

      {/* Hidden file input for detail panel load */}
      <input
        ref={detailFileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onLoadFile(file);
          e.target.value = "";
        }}
      />

      {/* Waveform header: pad name + LOAD + CLEAR */}
      <div className="flex items-center gap-2">
        <span
          className="text-[8px] font-bold tracking-[0.14em] truncate flex-1"
          style={{ color: buffer ? `${color}cc` : "rgba(255,255,255,0.2)" }}
        >
          {buffer
            ? `PAD ${padIndex + 1} — ${pad.fileName.replace(/\.[^/.]+$/, "")}`
            : `PAD ${padIndex + 1} — EMPTY`}
        </span>
        <label
          className="text-[7px] font-bold px-2 py-0.5 rounded cursor-pointer transition-all shrink-0"
          style={{
            color:      `${color}cc`,
            border:     `1px solid ${color}40`,
            background: `${color}10`,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = `${color}20`; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = `${color}10`; }}
          onClick={() => detailFileInputRef.current?.click()}
        >
          LOAD
        </label>
        {buffer && (
          <button
            onClick={() => clearPad(padIndex)}
            className="text-[7px] font-bold px-2 py-0.5 rounded transition-all shrink-0"
            style={{
              color:      "rgba(255,100,100,0.6)",
              border:     "1px solid rgba(255,100,100,0.2)",
              background: "rgba(255,100,100,0.05)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color      = "rgba(255,100,100,1)";
              (e.currentTarget as HTMLElement).style.background = "rgba(255,100,100,0.12)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color      = "rgba(255,100,100,0.6)";
              (e.currentTarget as HTMLElement).style.background = "rgba(255,100,100,0.05)";
            }}
          >
            CLEAR
          </button>
        )}
      </div>

      {/* Waveform */}
      <div className="relative rounded overflow-hidden bg-black/30 border border-white/5">
        {buffer ? (
          <canvas
            ref={waveCanvasRef}
            width={600}
            height={72}
            className="w-full h-18 cursor-col-resize"
            style={{ height: 72, imageRendering: "pixelated" }}
            onMouseDown={handleWaveMouseDown}
          />
        ) : (
          <div
            className="flex items-center justify-center h-18 text-[9px] text-white/20 font-bold tracking-widest cursor-pointer"
            style={{ height: 72 }}
            onClick={() => detailFileInputRef.current?.click()}
          >
            DROP SAMPLE HERE OR CLICK TO LOAD
          </div>
        )}
        {dragTarget && (
          <div className="absolute top-1 right-1 text-[8px] font-bold text-white/60 bg-black/50 px-1 rounded">
            {dragTarget === "start" ? "START" : "END"}
          </div>
        )}
      </div>

      {/* Play mode */}
      <div className="flex items-center gap-2">
        <span className="text-[8px] font-bold tracking-[0.1em] text-white/30">MODE</span>
        <div className="flex gap-1">
          {(["oneshot", "gate", "loop"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setParam(padIndex, { playMode: mode })}
              className={`px-2 py-0.5 text-[8px] font-bold tracking-[0.1em] rounded transition-all ${
                params.playMode === mode
                  ? "text-white/90"
                  : "text-white/25 hover:text-white/50"
              }`}
              style={{
                background: params.playMode === mode
                  ? `color-mix(in srgb, ${color} 20%, rgba(255,255,255,0.05))`
                  : "transparent",
                border: `1px solid ${params.playMode === mode ? color + "60" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              {mode === "oneshot" ? "ONE-SHOT" : mode.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Reverse */}
        <button
          onClick={() => setParam(padIndex, { reverse: !params.reverse })}
          className={`px-2 py-0.5 text-[8px] font-bold tracking-[0.1em] rounded transition-all ${
            params.reverse ? "text-white/90" : "text-white/25 hover:text-white/50"
          }`}
          style={{
            background: params.reverse
              ? "color-mix(in srgb, #a78bfa 20%, rgba(255,255,255,0.05))"
              : "transparent",
            border: `1px solid ${params.reverse ? "#a78bfa60" : "rgba(255,255,255,0.06)"}`,
          }}
        >
          REV
        </button>
      </div>

      {/* Choke group */}
      <div className="flex items-center gap-2">
        <span className="text-[8px] font-bold tracking-[0.1em] text-white/30">CHOKE</span>
        <button
          onClick={() => setParam(padIndex, { chokeGroup: 0 })}
          className={`px-1.5 py-0.5 text-[8px] font-bold rounded transition-all ${
            params.chokeGroup === 0 ? "text-white/80" : "text-white/25 hover:text-white/50"
          }`}
          style={{
            border: `1px solid ${params.chokeGroup === 0 ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.06)"}`,
          }}
        >
          —
        </button>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((g) => (
          <button
            key={g}
            onClick={() => setParam(padIndex, { chokeGroup: g })}
            className={`w-5 h-5 text-[8px] font-bold rounded transition-all ${
              params.chokeGroup === g ? "text-white/90" : "text-white/25 hover:text-white/50"
            }`}
            style={{
              background: params.chokeGroup === g
                ? `color-mix(in srgb, ${color} 30%, rgba(255,255,255,0.05))`
                : "transparent",
              border: `1px solid ${params.chokeGroup === g ? color + "70" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Knob row: Pitch, Fine, Volume, Pan */}
      <div className="flex items-end gap-3 flex-wrap">
        <Knob
          value={params.pitch}
          min={-24}
          max={24}
          defaultValue={0}
          label="PITCH"
          color={color}
          size={36}
          onChange={(v) => setParam(padIndex, { pitch: v })}
        />
        <Knob
          value={params.fine}
          min={-100}
          max={100}
          defaultValue={0}
          label="FINE"
          color={color}
          size={36}
          onChange={(v) => setParam(padIndex, { fine: v })}
        />
        <Knob
          value={Math.round(params.volume * 100)}
          min={0}
          max={100}
          defaultValue={80}
          label="VOL"
          color={color}
          size={36}
          onChange={(v) => setParam(padIndex, { volume: v / 100 })}
        />
        <Knob
          value={Math.round(params.pan * 100)}
          min={-100}
          max={100}
          defaultValue={0}
          label="PAN"
          color={color}
          size={36}
          onChange={(v) => setParam(padIndex, { pan: v / 100 })}
        />

        <div className="w-px h-8 bg-white/10" />

        {/* ADSR */}
        <Knob
          value={Math.round(params.attack * 1000)}
          min={1}
          max={2000}
          defaultValue={5}
          label="ATK"
          color={color}
          size={36}
          onChange={(v) => setParam(padIndex, { attack: v / 1000 })}
        />
        <Knob
          value={Math.round(params.decay * 1000)}
          min={1}
          max={2000}
          defaultValue={100}
          label="DEC"
          color={color}
          size={36}
          onChange={(v) => setParam(padIndex, { decay: v / 1000 })}
        />
        <Knob
          value={Math.round(params.sustain * 100)}
          min={0}
          max={100}
          defaultValue={100}
          label="SUS"
          color={color}
          size={36}
          onChange={(v) => setParam(padIndex, { sustain: v / 100 })}
        />
        <Knob
          value={Math.round(params.release * 1000)}
          min={1}
          max={4000}
          defaultValue={100}
          label="REL"
          color={color}
          size={36}
          onChange={(v) => setParam(padIndex, { release: v / 1000 })}
        />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-[8px] font-bold tracking-[0.1em] text-white/30">FILTER</span>
          {(["off", "lowpass", "highpass"] as const).map((ft) => (
            <button
              key={ft}
              onClick={() => setParam(padIndex, { filterType: ft })}
              className={`px-2 py-0.5 text-[8px] font-bold tracking-[0.08em] rounded transition-all ${
                params.filterType === ft ? "text-white/90" : "text-white/25 hover:text-white/50"
              }`}
              style={{
                background: params.filterType === ft
                  ? "color-mix(in srgb, #60a5fa 20%, rgba(255,255,255,0.05))"
                  : "transparent",
                border: `1px solid ${params.filterType === ft ? "#60a5fa60" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              {ft === "off" ? "OFF" : ft === "lowpass" ? "LP" : "HP"}
            </button>
          ))}
        </div>

        {params.filterType !== "off" && (
          <>
            <Knob
              value={Math.round(params.filterCutoff)}
              min={20}
              max={20000}
              defaultValue={2000}
              label="CUTOFF"
              color="#60a5fa"
              size={36}
              onChange={(v) => setParam(padIndex, { filterCutoff: v })}
            />
            <Knob
              value={Math.round(params.filterResonance * 100)}
              min={0}
              max={100}
              defaultValue={0}
              label="RES"
              color="#60a5fa"
              size={36}
              onChange={(v) => setParam(padIndex, { filterResonance: v / 100 })}
            />
          </>
        )}
      </div>

      {/* Loop points — only in loop mode */}
      {params.playMode === "loop" && (
        <div className="flex items-center gap-3">
          <span className="text-[8px] font-bold tracking-[0.1em] text-white/30">LOOP</span>
          <div className="flex items-center gap-1">
            <span className="text-[7px] text-[#34d399]/70 font-bold">START</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(params.loopStart * 100)}
              onChange={(e) => setParam(padIndex, { loopStart: parseInt(e.target.value) / 100 })}
              className="w-20 h-1 accent-[#34d399]"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[7px] text-[#34d399]/70 font-bold">END</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(params.loopEnd * 100)}
              onChange={(e) => setParam(padIndex, { loopEnd: parseInt(e.target.value) / 100 })}
              className="w-20 h-1 accent-[#34d399]"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step Sequencer ───────────────────────────────────────────────────────────

const VELOCITY_LEVELS = [0.3, 0.6, 0.8, 1.0];

function getNextVelocity(current: number): number {
  const closest = VELOCITY_LEVELS.reduce((a, b) =>
    Math.abs(b - current) < Math.abs(a - current) ? b : a,
  );
  const idx = VELOCITY_LEVELS.indexOf(closest);
  return VELOCITY_LEVELS[(idx + 1) % VELOCITY_LEVELS.length]!;
}

function velocityToAlpha(v: number): number {
  return 0.35 + v * 0.65;
}

function StepSequencer() {
  const pads = useSamplerStore((s) => s.pads);
  const steps = useSamplerStore((s) => s.steps);
  const velocities = useSamplerStore((s) => s.velocities);
  const patternLength = useSamplerStore((s) => s.patternLength);
  const currentStep = useSamplerStore((s) => s.currentStep);
  const toggleStep = useSamplerStore((s) => s.toggleStep);
  const setVelocity = useSamplerStore((s) => s.setVelocity);
  const setPatternLength = useSamplerStore((s) => s.setPatternLength);

  const handleRightClick = useCallback(
    (e: React.MouseEvent, padIdx: number, stepIdx: number) => {
      e.preventDefault();
      const isOn = steps[padIdx]?.[stepIdx] ?? false;
      if (!isOn) return;
      const current = velocities[padIdx]?.[stepIdx] ?? 0.8;
      setVelocity(padIdx, stepIdx, getNextVelocity(current));
    },
    [steps, velocities, setVelocity],
  );

  return (
    <div className="border-t border-white/5 bg-[var(--ed-bg-secondary)]/30">
      {/* Pattern length selector */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <span className="text-[8px] font-bold tracking-[0.15em] text-white/30">STEPS</span>
        {[8, 16, 32].map((len) => (
          <button
            key={len}
            onClick={() => setPatternLength(len)}
            className={`px-2 py-0.5 text-[8px] font-bold rounded transition-all ${
              patternLength === len ? "text-white/90" : "text-white/25 hover:text-white/50"
            }`}
            style={{
              background: patternLength === len
                ? "rgba(255,255,255,0.08)"
                : "transparent",
              border: `1px solid ${patternLength === len ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            {len}
          </button>
        ))}
      </div>

      {/* Sequencer grid */}
      <div className="overflow-x-auto">
        <div className="min-w-0 px-3 py-2 flex flex-col gap-0.5">
          {pads.map((pad, padIdx) => {
            const color = getPadColor(padIdx);
            const padSteps = steps[padIdx] ?? [];
            const padVels = velocities[padIdx] ?? [];
            const hasBuffer = pad.buffer !== null;

            return (
              <div key={padIdx} className="flex items-center gap-1.5">
                {/* Pad identifier */}
                <div
                  className="flex items-center gap-1 shrink-0"
                  style={{ width: 84 }}
                >
                  <div
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ background: color, opacity: hasBuffer ? 0.9 : 0.2 }}
                  />
                  <span
                    className="text-[7px] font-bold truncate tracking-wide"
                    style={{ color: hasBuffer ? `${color}cc` : "rgba(255,255,255,0.15)" }}
                  >
                    {pad.fileName
                      ? pad.fileName.replace(/\.[^/.]+$/, "").slice(0, 8)
                      : `PAD ${padIdx + 1}`}
                  </span>
                </div>

                {/* Step buttons */}
                <div className="flex gap-0.5">
                  {Array.from({ length: patternLength }, (_, stepIdx) => {
                    const isOn = padSteps[stepIdx] ?? false;
                    const vel = padVels[stepIdx] ?? 0.8;
                    const isCurrentStep = stepIdx === currentStep % patternLength;
                    const alpha = isOn ? velocityToAlpha(vel) : 0;

                    return (
                      <button
                        key={stepIdx}
                        onClick={() => toggleStep(padIdx, stepIdx)}
                        onContextMenu={(e) => handleRightClick(e, padIdx, stepIdx)}
                        className="rounded-sm transition-all duration-75 shrink-0"
                        style={{
                          width: 16,
                          height: 16,
                          background: isOn
                            ? `rgba(${colorToRgb(color)}, ${alpha})`
                            : isCurrentStep
                              ? "rgba(255,255,255,0.08)"
                              : (stepIdx % 4 === 0 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)"),
                          border: isCurrentStep
                            ? `1px solid rgba(255,255,255,0.3)`
                            : `1px solid ${isOn ? `rgba(${colorToRgb(color)}, 0.4)` : "rgba(255,255,255,0.04)"}`,
                          boxShadow: isOn && isCurrentStep
                            ? `0 0 6px ${color}88`
                            : "none",
                          opacity: hasBuffer ? 1 : 0.35,
                          cursor: hasBuffer ? "pointer" : "default",
                        }}
                        disabled={!hasBuffer}
                        title={
                          isOn
                            ? `Vel: ${Math.round(vel * 100)}% — right-click to cycle`
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Convert CSS variable color to RGB string for rgba() usage */
function colorToRgb(color: string): string {
  // Map known CSS vars to RGB values
  const map: Record<string, string> = {
    "var(--ed-accent-orange)": "245, 158, 11",
    "var(--ed-accent-blue)": "96, 165, 250",
    "var(--ed-accent-chords)": "167, 139, 250",
    "var(--ed-accent-green)": "52, 211, 153",
  };
  return map[color] ?? "255, 255, 255";
}

// ── Main SamplerTab ───────────────────────────────────────────────────────────

export function SamplerTab() {
  const pads = useSamplerStore((s) => s.pads);
  const selectedPad = useSamplerStore((s) => s.selectedPad);
  const currentStep = useSamplerStore((s) => s.currentStep);
  const patternLength = useSamplerStore((s) => s.patternLength);
  const steps = useSamplerStore((s) => s.steps);
  const selectPad = useSamplerStore((s) => s.selectPad);
  const setPadBuffer = useSamplerStore((s) => s.setPadBuffer);

  const handleLoadFile = useCallback(
    async (padIdx: number, file: File) => {
      const ctx = audioEngine.getAudioContext();
      if (!ctx) return;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        setPadBuffer(padIdx, audioBuffer, file.name);
      } catch (err) {
        console.warn("Failed to decode audio file:", err);
      }
    },
    [setPadBuffer],
  );

  const handlePadClick = useCallback(
    (padIdx: number) => {
      selectPad(padIdx);
      // Instant preview: trigger with current sample if loaded
      const pad = useSamplerStore.getState().pads[padIdx];
      if (pad?.buffer) {
        const ctx = audioEngine.getAudioContext();
        if (ctx) {
          samplerEngine.trigger(padIdx, pad.buffer, pad.params, 0.8, ctx.currentTime);
        }
      }
    },
    [selectPad],
  );

  // ── Keyboard triggers ──────────────────────────────────────
  // Only active when Sampler tab is mounted. Ignored when user types in an input.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if focus is on an input / textarea / select
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const padIdx = SAMPLER_KEY_MAP[e.key.toLowerCase()];
      if (padIdx === undefined) return;

      e.preventDefault();
      const pad = useSamplerStore.getState().pads[padIdx];
      if (!pad?.buffer) return;

      const ctx = audioEngine.getAudioContext();
      if (!ctx) return;
      samplerEngine.trigger(padIdx, pad.buffer, pad.params, 0.9, ctx.currentTime);
      selectPad(padIdx);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const padIdx = SAMPLER_KEY_MAP[e.key.toLowerCase()];
      if (padIdx === undefined) return;

      // Gate mode: release on key-up
      const pad = useSamplerStore.getState().pads[padIdx];
      if (pad?.params.playMode === "gate") {
        const ctx = audioEngine.getAudioContext();
        if (ctx) samplerEngine.releaseWithTime(padIdx, ctx.currentTime, pad.params.release);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [selectPad]);

  return (
    <div className="flex flex-col">
      {/* Top section: pad grid + detail */}
      <div className="flex gap-4 p-3">
        {/* 4×4 pad grid */}
        <div className="shrink-0">
          {/* Keyboard hint */}
          <div className="mb-1.5 flex items-center justify-between px-0.5">
            <span className="text-[7px] font-bold tracking-[0.12em] text-white/20">SAMPLER PADS</span>
            <span className="text-[7px] text-white/15">Z–V · A–F · Q–R · 1–4</span>
          </div>
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: "repeat(4, 72px)" }}
          >
            {pads.map((pad, padIdx) => {
              const isCurrentlyPlaying =
                (steps[padIdx]?.[currentStep % patternLength] ?? false);
              return (
                <PadCell
                  key={padIdx}
                  padIndex={padIdx}
                  isSelected={selectedPad === padIdx}
                  isPlaying={isCurrentlyPlaying}
                  fileName={pad.fileName}
                  buffer={pad.buffer}
                  onSelect={() => handlePadClick(padIdx)}
                  onDrop={(file) => {
                    void handleLoadFile(padIdx, file);
                    selectPad(padIdx);
                  }}
                  onLoadFile={(file) => {
                    void handleLoadFile(padIdx, file);
                    selectPad(padIdx);
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        <DetailPanel
          padIndex={selectedPad}
          onLoadFile={(file) => void handleLoadFile(selectedPad, file)}
        />
      </div>

      {/* Step Sequencer */}
      <StepSequencer />
    </div>
  );
}
