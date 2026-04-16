import { type SoundTarget, type LoopRange, TARGET_COLORS, DEFAULT_CELL_W } from "./types";
import { HarmonyMenu } from "./HarmonyMenu";
import type { HarmonyType } from "./harmony";

interface PianoRollToolbarProps {
  target: SoundTarget;
  setTarget: (t: SoundTarget) => void;
  tool: "draw" | "select";
  setTool: (t: "draw" | "select") => void;
  gridRes: number;
  setGridRes: (r: number) => void;
  snap: boolean;
  setSnap: (b: boolean) => void;
  scaleSnap: boolean;
  setScaleSnap: (b: boolean) => void;
  loop: LoopRange;
  setLoop: (l: LoopRange) => void;

  selectedCount: number;
  clipboardLength: number;
  noteCount: number;
  targetNoteCount: number;
  bpm: number;
  cellW: number;
  playheadBeat: number;
  dragMode: string;
  averageSelectedVelocity: number | null;
  autoFollow: boolean;
  setAutoFollow: (b: boolean) => void;

  onQuantize: () => void;
  onHarmony: (type: HarmonyType) => void;
  onSelectAll: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onClear: () => void;
  onFit: () => void;
  onClose: () => void;
}

export function PianoRollToolbar(props: PianoRollToolbarProps) {
  const {
    target,
    setTarget,
    tool,
    setTool,
    gridRes,
    setGridRes,
    snap,
    setSnap,
    scaleSnap,
    setScaleSnap,
    loop,
    setLoop,
    selectedCount,
    clipboardLength,
    noteCount,
    targetNoteCount,
    bpm,
    cellW,
    playheadBeat,
    dragMode,
    averageSelectedVelocity,
    autoFollow,
    setAutoFollow,
    onQuantize,
    onHarmony,
    onSelectAll,
    onDelete,
    onCopy,
    onPaste,
    onClear,
    onFit,
    onClose,
  } = props;

  const accentColor = TARGET_COLORS[target];
  const zoomPercentage = Math.round((cellW / DEFAULT_CELL_W) * 100);

  return (
    <>
      {/* ─── PRIMARY TOOLBAR ───────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/60 overflow-x-auto">
        <div className="shrink-0 min-w-[150px]">
          <div className="text-[10px] font-black tracking-[0.18em]" style={{ color: accentColor }}>
            PIANO ROLL
          </div>
          <div className="text-[9px] text-[var(--ed-text-muted)]">
            Clip editing with DAW-style lane workflow
          </div>
        </div>

        <div className="w-px h-4 bg-white/15 shrink-0" />

        {/* Tool: DRAW / SELECT */}
        <div className="flex gap-px bg-black/30 rounded p-0.5 shrink-0">
          {(["draw", "select"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              title={t === "draw" ? "Draw (B)" : "Select (S)"}
              className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded-sm transition-all hover:brightness-110"
              style={{
                backgroundColor: tool === t ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.05)",
                color: tool === t ? "#000" : "rgba(255,255,255,0.6)",
                opacity: tool === t ? 1 : 0.7,
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-white/15 shrink-0" />

        {/* Sound target */}
        <div className="flex gap-px bg-black/30 rounded p-0.5 shrink-0">
          {(["melody", "chords", "bass", "drums"] as SoundTarget[]).map((t) => (
            <button
              key={t}
              onClick={() => setTarget(t)}
              className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded-sm transition-all hover:brightness-110"
              style={{
                backgroundColor: target === t ? TARGET_COLORS[t] : "rgba(255,255,255,0.05)",
                color: target === t ? "#000" : TARGET_COLORS[t],
                opacity: target === t ? 1 : 0.6,
                boxShadow: target === t ? `0 0 8px ${TARGET_COLORS[t]}40` : "none",
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-white/15 shrink-0" />

        {/* Grid */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[7px] text-white/35 font-bold uppercase tracking-wider">Grid</span>
          <select
            value={gridRes}
            onChange={(e) => setGridRes(parseFloat(e.target.value))}
            className="h-6 px-1.5 text-[8px] bg-black/30 border border-white/15 rounded text-white/70 cursor-pointer hover:border-white/25 transition-colors"
          >
            <option value={0.125}>1/32</option>
            <option value={0.25}>1/16</option>
            <option value={0.5}>1/8</option>
            <option value={1}>1/4</option>
          </select>
        </div>

        {/* Snap */}
        <button
          onClick={() => setSnap(!snap)}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 hover:brightness-110"
          style={{
            backgroundColor: snap ? TARGET_COLORS[target] : "rgba(255,255,255,0.05)",
            color: snap ? "#000" : "white",
            opacity: snap ? 1 : 0.4,
            border: `1px solid ${snap ? TARGET_COLORS[target] : "rgba(255,255,255,0.15)"}`,
            boxShadow: snap ? `0 0 6px ${TARGET_COLORS[target]}30` : "none",
          }}
        >
          SNAP
        </button>

        {/* Scale snap */}
        <button
          onClick={() => setScaleSnap(!scaleSnap)}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 hover:brightness-110"
          style={{
            backgroundColor: scaleSnap ? "#10b98160" : "rgba(255,255,255,0.05)",
            color: scaleSnap ? "#fff" : "white",
            opacity: scaleSnap ? 1 : 0.4,
            border: `1px solid ${scaleSnap ? "#10b98180" : "rgba(255,255,255,0.15)"}`,
            boxShadow: scaleSnap ? "0 0 6px #10b98140" : "none",
          }}
        >
          SCALE
        </button>

        {/* Loop toggle */}
        <button
          onClick={() => setLoop({ ...loop, enabled: !loop.enabled })}
          title="Toggle loop (L). Drag on the ruler to draw a loop."
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 hover:brightness-110"
          style={{
            backgroundColor: loop.enabled ? accentColor : "rgba(255,255,255,0.05)",
            color: loop.enabled ? "#000" : "white",
            opacity: loop.enabled ? 1 : 0.45,
            border: `1px solid ${loop.enabled ? accentColor : "rgba(255,255,255,0.15)"}`,
            boxShadow: loop.enabled ? `0 0 6px ${accentColor}40` : "none",
          }}
        >
          LOOP
        </button>

        <div className="w-px h-4 bg-white/15 shrink-0" />

        {/* Quantize */}
        <button
          onClick={onQuantize}
          disabled={selectedCount === 0}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20 hover:brightness-110"
          style={{
            backgroundColor: selectedCount > 0 ? "rgba(255,165,0,0.25)" : "rgba(255,165,0,0.1)",
            color: selectedCount > 0 ? "white" : "white/50",
            border: "1px solid rgba(255,165,0,0.4)",
          }}
        >
          QUANTIZE
        </button>

        <HarmonyMenu accentColor={accentColor} onGenerate={onHarmony} />

        <div className="w-px h-4 bg-white/15 shrink-0" />

        <button
          onClick={onSelectAll}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 hover:brightness-110"
          style={{
            backgroundColor: "rgba(100,150,255,0.15)",
            color: "white",
            border: "1px solid rgba(100,150,255,0.35)",
          }}
        >
          SEL ALL
        </button>

        <button
          onClick={onDelete}
          disabled={selectedCount === 0}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20 hover:brightness-110"
          style={{
            backgroundColor: "rgba(255,100,100,0.15)",
            color: selectedCount > 0 ? "white" : "white/50",
            border: "1px solid rgba(255,100,100,0.35)",
          }}
        >
          DEL
        </button>

        <button
          onClick={onCopy}
          disabled={selectedCount === 0}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20 hover:brightness-110"
          style={{
            backgroundColor: "rgba(100,200,100,0.15)",
            color: selectedCount > 0 ? "white" : "white/50",
            border: "1px solid rgba(100,200,100,0.35)",
          }}
        >
          COPY
        </button>

        <button
          onClick={onPaste}
          disabled={clipboardLength === 0}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 disabled:opacity-20 hover:brightness-110"
          style={{
            backgroundColor: "rgba(100,200,100,0.15)",
            color: clipboardLength > 0 ? "white" : "white/50",
            border: "1px solid rgba(100,200,100,0.35)",
          }}
        >
          PASTE
        </button>

        <button
          onClick={onClear}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all shrink-0 hover:brightness-110"
          style={{
            backgroundColor: "rgba(200,100,100,0.15)",
            color: "rgba(255,150,150,0.7)",
            border: "1px solid rgba(200,100,100,0.3)",
          }}
        >
          CLEAR
        </button>

        <div className="flex-1" />

        <div className="flex items-center gap-2 text-[7px] text-white/35 shrink-0 font-mono">
          <span>{noteCount} notes</span>
          <span className="text-white/20">|</span>
          <span>{bpm} BPM</span>
          <span className="text-white/20">|</span>
          <span>{zoomPercentage}%</span>
        </div>

        <div className="w-px h-4 bg-white/15 shrink-0" />

        <button
          onClick={onClose}
          className="px-2 py-0.5 text-[7px] font-bold tracking-wider text-white/35 hover:text-white/70 border border-white/15 hover:border-white/35 rounded transition-all shrink-0"
        >
          BACK
        </button>
      </div>

      {/* ─── CHIP ROW ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--ed-border)]/60 bg-[var(--ed-bg-secondary)]/35 overflow-x-auto">
        <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
          Lane {target.toUpperCase()}
        </span>
        <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
          {targetNoteCount} lane notes
        </span>
        <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
          {selectedCount} selected
        </span>
        <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
          Playhead {playheadBeat.toFixed(2)} beats
        </span>
        <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
          Grid {gridRes === 0.125 ? "1/32" : gridRes === 0.25 ? "1/16" : gridRes === 0.5 ? "1/8" : "1/4"}
        </span>
        {loop.enabled && (
          <span
            className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border shrink-0"
            style={{
              borderColor: `${accentColor}60`,
              backgroundColor: `${accentColor}20`,
              color: "white",
            }}
          >
            Loop {loop.start.toFixed(1)}–{loop.end.toFixed(1)}
          </span>
        )}
        <span
          className={`px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border shrink-0 ${
            dragMode !== "none"
              ? "border-white/20 bg-white/10 text-white/80"
              : "border-white/8 bg-white/5 text-white/35"
          }`}
        >
          Tool {tool === "draw" ? "DRAW" : "SELECT"}
          {dragMode !== "none" && ` · ${dragMode.toUpperCase()}`}
        </span>
        {averageSelectedVelocity !== null && (
          <span className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-[var(--ed-text-secondary)] shrink-0">
            Avg Vel {averageSelectedVelocity}%
          </span>
        )}
        <button
          onClick={() => setAutoFollow(!autoFollow)}
          className={`px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border shrink-0 transition-colors ${
            autoFollow ? "border-white/25 bg-white/10 text-white/80" : "border-white/8 bg-white/5 text-white/35"
          }`}
        >
          {autoFollow ? "FOLLOW ON" : "FOLLOW"}
        </button>
        <button
          onClick={onFit}
          className="px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] border border-white/8 bg-white/5 text-white/35 hover:text-white/70 shrink-0 transition-colors"
        >
          FIT
        </button>
        <span className="text-[9px] text-[var(--ed-text-muted)] ml-auto hidden lg:inline">
          B = Draw · S = Select · L = Loop · Shift+Drag = axis lock · Numbers = velocity
        </span>
      </div>
    </>
  );
}
