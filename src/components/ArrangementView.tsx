/**
 * Arrangement View v3 — DAW-grade 5-lane multi-track sequencer
 *
 * Lanes: DRUMS · BASS · CHORDS · MELODY · LOOPS
 * Interactions: click-select, drag-reorder, alt-drag copy, edge-resize, context menu
 * Keyboard: D dup · Del delete · ⌘C copy · ⌘V paste · ←→ move · −/+ resize · C colour · F2 rename
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useDrumStore, type SongChainEntry, drumCurrentStepStore } from "../store/drumStore";
import { arrangementBarStore, seekToBar } from "../audio/arrangementScheduler";
import { useSceneStore, type Scene } from "../store/sceneStore";
import { useLoopPlayerStore } from "../store/loopPlayerStore";
import { useAudioClipStore, computeWaveformPeaks, type AudioClip } from "../store/audioClipStore";
import {
  SCENE_COLORS, LOOP_COLOR, getEntryColor, getEntryLabel, hexAlpha,
} from "../utils/arrangementColors";
import { bassWaveformBars, noteWaveformBars } from "../utils/waveformMini";
import {
  useArrangementStore,
  type ArrangementClip,
  type ArrangementTrackId,
} from "../store/arrangementStore";

// ─── Layout constants ─────────────────────────────────────────────────────────

const LABEL_W        = 68;
const TRACK_H        = 52;
const LOOP_H         = 36;
const AUDIO_H        = 52;
const AUDIO_COLOR    = "#f97316"; // warm orange — distinct from drum red
const RULER_H        = 22;
const MIN_BAR_PX     = 16;
const MAX_BAR_PX     = 120;
const DEFAULT_BAR_PX = 40;
const MAX_REPEATS    = 16;
const MIN_REPEATS    = 1;

// ─── Selection key helpers ────────────────────────────────────────────────────
// Format: "${trackId}:${chainIndex}" or "loops:${chainIndex}"
const makeSelKey  = (track: TrackId | "loops", idx: number) => `${track}:${idx}`;
const getSelIdx   = (key: string) => parseInt(key.split(":")[1] ?? "");
const getSelTrack = (key: string): TrackId | "loops" => key.split(":")[0] as TrackId | "loops";

// ─── Per-track arrangement constants ─────────────────────────────────────────

const TRACK_COLORS: Record<ArrangementTrackId, string> = {
  drums:  "#ef4444",
  bass:   "#14b8a6",
  chords: "#a855f7",
  melody: "#eab308",
};

const TRACK_LABELS: Record<ArrangementTrackId, string> = {
  drums:  "DRUMS",
  bass:   "BASS",
  chords: "CHORDS",
  melody: "MELODY",
};

const ARR_TRACKS: ArrangementTrackId[] = ["drums", "bass", "chords", "melody"];
const ARR_TRACK_H = 44;
const ARR_LABEL_W = 72;

// ─── Track definitions ────────────────────────────────────────────────────────

type TrackId = "drums" | "bass" | "chords" | "melody";

const TRACKS: Array<{ id: TrackId; label: string }> = [
  { id: "drums",  label: "DRUMS"  },
  { id: "bass",   label: "BASS"   },
  { id: "chords", label: "CHORDS" },
  { id: "melody", label: "MELODY" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface ArrangementViewProps {
  isOpen:  boolean;
  onClose: () => void;
}

// ─── WaveformMiniCanvas ───────────────────────────────────────────────────────

interface WaveformMiniCanvasProps {
  bars:   number[];
  color:  string;
  width:  number;
  height: number;
}

function WaveformMiniCanvas({ bars, color, width, height }: WaveformMiniCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const count  = Math.max(bars.length, 1);
    const barW   = Math.max(1, Math.floor(width / count) - 1);
    const usable = height * 0.85;
    bars.forEach((h, i) => {
      if (h === 0) return;
      const barH = Math.max(2, h * usable);
      const x    = Math.floor(i * (width / count));
      const y    = height - barH;
      ctx.fillStyle = hexAlpha(color, 0.45);
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 1);
      ctx.fill();
    });
  }, [bars, color, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none"
    />
  );
}

// ─── DrumStepsMini ───────────────────────────────────────────────────────────

interface DrumTrackStep {
  active: boolean;
  velocity?: number;
}

interface DrumStepsMiniProps {
  tracks: ReadonlyArray<ReadonlyArray<DrumTrackStep>>;
  stepCount: number;
  color: string;
  width: number;
  height: number;
}

function DrumStepsMini({ tracks, stepCount, color, width, height }: DrumStepsMiniProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    const activeTracks = tracks.filter(t => t.some(s => s.active));
    if (activeTracks.length === 0) return;

    const rows    = activeTracks.length;
    const cols    = stepCount;
    const cellW   = width / cols;
    const cellH   = height / rows;
    const pad     = Math.max(0.5, Math.min(1.5, cellW * 0.12));

    activeTracks.forEach((track, row) => {
      const y = row * cellH;
      track.slice(0, cols).forEach((step, col) => {
        if (!step.active) return;
        const vel    = (step.velocity ?? 100) / 127;
        const alpha  = 0.35 + vel * 0.55;
        const x      = col * cellW;
        ctx.fillStyle = hexAlpha(color, alpha);
        ctx.beginPath();
        ctx.roundRect(x + pad, y + pad, cellW - pad * 2, cellH - pad * 2, 1);
        ctx.fill();
      });
    });
  }, [tracks, stepCount, color, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute pointer-events-none"
      style={{ top: 2, left: 2, width, height }}
    />
  );
}

// ─── ArrangementClip ──────────────────────────────────────────────────────────

interface ArrangementClipProps {
  entry:          SongChainEntry;
  trackId:        TrackId;
  scene:          Scene | null;
  color:          string;
  label:          string;
  width:          number;
  height:         number;
  isFirstTrack:   boolean;
  isLastTrack:    boolean;
  isActive:       boolean;
  progress:       number;
  isSelected:     boolean;
  isHidden:       boolean;
  isDragging:     boolean;
  isRenaming:     boolean;
  renameValue:    string;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onSelect:       (multi: boolean) => void;
  onContextMenu:  (e: React.MouseEvent) => void;
  onMoveStart:    (e: React.PointerEvent) => void;
  onResizeStart:  (e: React.PointerEvent) => void;
}

function ArrangementClip({
  entry, trackId, scene, color, label, width, height,
  isFirstTrack, isLastTrack, isActive, progress,
  isSelected, isHidden, isDragging,
  isRenaming, renameValue, renameInputRef,
  onRenameChange, onRenameCommit,
  onSelect, onContextMenu,
  onMoveStart, onResizeStart,
}: ArrangementClipProps) {

  // Drum mini-grid data (actual step pattern)
  const drumStepData = (() => {
    if (trackId !== "drums" || !scene) return null;
    const len = Math.min(scene.drumPattern.length ?? 16, 64);
    return {
      tracks: scene.drumPattern.tracks.map(t => t.steps.slice(0, len)) as ReadonlyArray<ReadonlyArray<DrumTrackStep>>,
      stepCount: len,
    };
  })();

  // Waveform bars (bass / chords / melody)
  const waveformBars = (() => {
    if (!scene) return null;
    if (trackId === "bass") {
      return bassWaveformBars(
        scene.bassSteps.slice(0, Math.min(scene.bassLength, 32))
      );
    }
    if (trackId === "chords") {
      return noteWaveformBars(
        scene.chordsSteps.slice(0, Math.min(scene.chordsLength, 32))
      );
    }
    if (trackId === "melody") {
      return noteWaveformBars(
        scene.melodySteps.slice(0, Math.min(scene.melodyLength, 32))
      );
    }
    return null;
  })();

  // Instrument sub-label
  const subLabel = (() => {
    if (!scene || trackId === "drums") return null;
    if (trackId === "bass") {
      return scene.rootName && scene.scaleName
        ? `${scene.rootName} ${scene.scaleName}` : null;
    }
    if (trackId === "chords") {
      return (scene.chordsParams as Record<string, unknown> | undefined)
        ?.presetName as string ?? null;
    }
    if (trackId === "melody") {
      return (scene.melodyParams as Record<string, unknown> | undefined)
        ?.presetName as string ?? null;
    }
    return null;
  })();

  const borderRadius =
    isFirstTrack && isLastTrack ? "6px"
    : isFirstTrack              ? "6px 6px 0 0"
    : isLastTrack               ? "0 0 6px 6px"
    : "0";

  // Render empty placeholder for hidden (per-track deleted) clips
  if (isHidden) {
    return (
      <div
        className="border-b border-r border-black/20"
        style={{ width, minWidth: width, height, cursor: "grab" }}
        onClick={(e) => { e.stopPropagation(); onSelect(e.metaKey || e.ctrlKey); }}
        onContextMenu={(e) => onContextMenu(e)}
        onPointerDown={onMoveStart}
      />
    );
  }

  return (
    <div
      className="relative overflow-hidden border-b border-black/20 select-none"
      style={{
        width, minWidth: width, height,
        backgroundColor: hexAlpha(color, isActive ? 0.28 : 0.14),
        borderRight:     "1px solid rgba(0,0,0,0.25)",
        borderRadius,
        opacity:         isDragging ? 0.35 : 1,
        outline:         isSelected ? `2px solid ${hexAlpha(color, 0.8)}` : "none",
        outlineOffset: "-1px",
        cursor: "grab",
      }}
      onPointerDown={onMoveStart}
      onClick={(e) => { e.stopPropagation(); onSelect(e.metaKey || e.ctrlKey); }}
      onContextMenu={onContextMenu}
    >
      {/* Active progress shimmer */}
      {isActive && (
        <div
          className="absolute top-0 left-0 bottom-0 pointer-events-none"
          style={{ width: `${progress * 100}%`, backgroundColor: hexAlpha(color, 0.18) }}
        />
      )}

      {/* Drum mini step-grid */}
      {drumStepData && width > 30 && (
        <DrumStepsMini
          tracks={drumStepData.tracks}
          stepCount={drumStepData.stepCount}
          color={color}
          width={width - 4}
          height={height - 4}
        />
      )}

      {/* Bass waveform mini */}
      {waveformBars && width > 30 && (
        <WaveformMiniCanvas
          bars={waveformBars}
          color={color}
          width={width - 12}
          height={height}
        />
      )}

      {/* First-track: scene label + repeat count (or rename input) */}
      {isFirstTrack && (
        <div className="absolute inset-0 flex flex-col justify-center px-1.5 pointer-events-none z-10">
          {isRenaming ? (
            <input
              ref={renameInputRef as React.RefObject<HTMLInputElement> | undefined}
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={onRenameCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") onRenameCommit();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-black/50 border border-white/20 rounded px-1 text-white outline-none pointer-events-auto"
              style={{ fontSize: 8 }}
            />
          ) : (
            <>
              <span
                className="text-[8px] font-black truncate leading-tight"
                style={{ color: hexAlpha(color, 0.95) }}
              >
                {label}
              </span>
              <span
                className="text-[7px] font-bold truncate leading-tight mt-0.5"
                style={{ color: hexAlpha(color, 0.55) }}
              >
                ×{entry.repeats}
              </span>
            </>
          )}
        </div>
      )}

      {/* Sub-label on non-first tracks */}
      {!isFirstTrack && subLabel && width > 40 && (
        <div className="absolute inset-0 flex items-center px-1.5 pointer-events-none z-10">
          <span className="text-[7px] font-bold truncate" style={{ color: hexAlpha(color, 0.55) }}>
            {subLabel}
          </span>
        </div>
      )}

      {/* Edge resize handle */}
      <div
        className="absolute top-0 bottom-0 right-0 w-3 flex items-center justify-center cursor-col-resize z-20 hover:bg-white/10"
        onPointerDown={onResizeStart}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-0.5 h-4 rounded-full" style={{ backgroundColor: hexAlpha(color, 0.3) }} />
      </div>
    </div>
  );
}

// ─── LoopWaveformCanvas ───────────────────────────────────────────────────────

interface LoopWaveformCanvasProps {
  peaks:  Float32Array;
  color:  string;
  width:  number;
  height: number;
}

function LoopWaveformCanvas({ peaks, color, width, height }: LoopWaveformCanvasProps) {
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

// ─── ArrangementLoopLane ──────────────────────────────────────────────────────

interface ArrangementLoopLaneProps {
  songChain:    SongChainEntry[];
  scenes:       (Scene | null)[];
  barPx:        number;
  height:       number;
  songPosition: number;
  songMode:     string;
  selected:     Set<string>;
  onSelect:     (i: number, multi: boolean) => void;
  onDragOver:   (i: number) => void;
  onDrop:       (e: React.DragEvent, i: number) => void;
}

function ArrangementLoopLane({
  songChain, scenes, barPx, height,
  songPosition, songMode, selected,
  onSelect, onDragOver, onDrop,
}: ArrangementLoopLaneProps) {
  const liveSlots = useLoopPlayerStore((s) => s.slots);

  return (
    <>
      {songChain.map((entry, i) => {
        const scene = scenes[entry.sceneIndex] ?? null;
        const activeSlots = (scene?.loopSlots ?? [])
          .map((s, idx) => ({ playing: s.playing, idx }))
          .filter(s => s.playing);
        const w        = entry.repeats * barPx;
        const isActive = songMode === "song" && i === songPosition;
        const isSel    = selected.has(makeSelKey("loops", i));

        // Collect waveform peaks for active slots from the live store
        const slotsWithPeaks = activeSlots.map(({ idx }) => ({
          idx,
          peaks: liveSlots[idx]?.waveformPeaks ?? null,
          fileName: liveSlots[idx]?.fileName ?? "",
        }));

        const rowH = activeSlots.length > 0
          ? Math.max(8, height / Math.min(activeSlots.length, 4))
          : height;

        return (
          <div
            key={i}
            className="relative overflow-hidden border-r border-b border-black/20"
            style={{
              width: w, minWidth: w, height,
              backgroundColor: isSel
                ? hexAlpha(LOOP_COLOR, 0.18)
                : isActive
                  ? hexAlpha(LOOP_COLOR, 0.12)
                  : hexAlpha(LOOP_COLOR, 0.05),
              outline:       isSel ? `1px solid ${hexAlpha(LOOP_COLOR, 0.5)}` : "none",
              outlineOffset: "-1px",
              cursor:        "default",
            }}
            onClick={(e) => onSelect(i, e.metaKey || e.ctrlKey)}
            onDragOver={(e) => { e.preventDefault(); onDragOver(i); }}
            onDrop={(e) => onDrop(e, i)}
          >
            {activeSlots.length === 0 ? (
              <span className="absolute inset-0 flex items-center px-2 text-[6px] text-white/12">—</span>
            ) : (
              slotsWithPeaks.slice(0, 4).map(({ idx, peaks, fileName }, row) => (
                <div
                  key={idx}
                  className="absolute left-0 right-0 overflow-hidden"
                  style={{ top: row * rowH, height: rowH }}
                >
                  {/* Waveform if peaks are available */}
                  {peaks && w > 20 && (
                    <LoopWaveformCanvas
                      peaks={peaks}
                      color={LOOP_COLOR}
                      width={w}
                      height={rowH}
                    />
                  )}
                  {/* Slot label overlay */}
                  <div className="absolute inset-0 flex items-center px-1.5 pointer-events-none">
                    <span
                      className="text-[6px] font-bold leading-none"
                      style={{ color: hexAlpha(LOOP_COLOR, peaks ? 0.55 : 0.8) }}
                    >
                      {peaks
                        ? (fileName ? fileName.replace(/\.[^.]+$/, "").slice(0, 12) : `L${idx + 1}`)
                        : `L${idx + 1}`}
                    </span>
                  </div>
                  {/* Row divider */}
                  {row > 0 && (
                    <div
                      className="absolute top-0 left-0 right-0 h-px"
                      style={{ backgroundColor: hexAlpha(LOOP_COLOR, 0.15) }}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        );
      })}
    </>
  );
}

// ─── ArrangementColorPicker ───────────────────────────────────────────────────

interface ArrangementColorPickerProps {
  currentColor?: string;
  onSelect:      (color: string) => void;
}

function ArrangementColorPicker({ currentColor, onSelect }: ArrangementColorPickerProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {SCENE_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onSelect(c)}
          className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            backgroundColor: c,
            borderColor:     currentColor === c ? "white" : "transparent",
          }}
          title={c}
        />
      ))}
    </div>
  );
}

// ─── ArrangementContextMenu ───────────────────────────────────────────────────

interface ArrangementContextMenuProps {
  x:                 number;
  y:                 number;
  entry:             SongChainEntry | null;
  onDuplicate:       () => void;
  onCopy:            () => void;
  onPaste:           () => void;
  onBarsChange:      (delta: number) => void;
  onOpenColorPicker: () => void;
  onRename:          () => void;
  onDelete:          () => void;
}

function ArrangementContextMenu({
  x, y, entry,
  onDuplicate, onCopy, onPaste, onBarsChange,
  onOpenColorPicker, onRename, onDelete,
}: ArrangementContextMenuProps) {
  const menuRef   = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth  - rect.width  - 8),
      top:  Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  const entryColor = entry ? getEntryColor(entry) : "#ffffff";
  const entryLabel = entry ? getEntryLabel(entry) : "";

  function Row({
    icon, label, shortcut, onClick, red,
  }: { icon: string; label: string; shortcut?: string; onClick: () => void; red?: boolean }) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[9px] font-bold transition-colors hover:bg-white/8 text-left ${
          red ? "text-red-400 hover:bg-red-500/10" : "text-white/65"
        }`}
      >
        <span className="w-3 text-center">{icon}</span>
        <span className="flex-1">{label}</span>
        {shortcut && <span className="font-mono text-white/25 text-[8px]">{shortcut}</span>}
      </button>
    );
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-[rgba(18,19,26,0.98)] border border-white/12 rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] py-1 overflow-hidden min-w-[184px]"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entryColor }} />
        <span className="text-[8px] font-black text-white/70 truncate">{entryLabel}</span>
        {entry && <span className="text-[7px] text-white/30 ml-auto">×{entry.repeats}</span>}
      </div>

      <Row icon="⎘" label="Duplizieren"     shortcut="D"  onClick={onDuplicate} />
      <Row icon="⊕" label="Kopieren"        shortcut="⌘C" onClick={onCopy} />
      <Row icon="⊗" label="Einfügen danach" shortcut="⌘V" onClick={onPaste} />
      <div className="border-t border-white/6 my-0.5" />
      <Row icon="◀" label="Bars −1" shortcut="−" onClick={() => onBarsChange(-1)} />
      <Row icon="▶" label="Bars +1" shortcut="+" onClick={() => onBarsChange(1)} />
      <div className="border-t border-white/6 my-0.5" />
      <Row icon="🎨" label="Farbe wählen…" shortcut="C"  onClick={onOpenColorPicker} />
      <Row icon="✏"  label="Umbenennen…"   shortcut="F2" onClick={onRename} />
      <div className="border-t border-white/6 my-0.5" />
      <Row icon="✕" label="Löschen" shortcut="Del" onClick={onDelete} red />
    </div>
  );
}

// ─── ArrangementDetailPanel ───────────────────────────────────────────────────

interface ArrangementDetailPanelProps {
  songChain:          SongChainEntry[];
  scenes:             (Scene | null)[];
  primaryIdx:         number | null;
  showColorPicker:    number | null;
  setShowColorPicker: (i: number | null) => void;
  onUpdateEntry:      (i: number, patch: Partial<SongChainEntry>) => void;
  onUpdateRepeats:    (i: number, repeats: number) => void;
  onStartRename:      (i: number) => void;
  onRemove:           (i: number) => void;
}

function ArrangementDetailPanel({
  songChain, scenes, primaryIdx,
  showColorPicker, setShowColorPicker,
  onUpdateEntry, onUpdateRepeats, onStartRename, onRemove,
}: ArrangementDetailPanelProps) {
  const primary = primaryIdx;
  const entry   = primary !== null ? (songChain[primary] ?? null) : null;
  const scene   = entry ? (scenes[entry.sceneIndex] ?? null) : null;

  if (!entry || primary === null) {
    return (
      <div className="shrink-0 border-t border-white/8 px-4 py-2 flex items-center bg-white/[0.015]">
        <span className="text-[8px] text-white/20 font-bold tracking-wider">
          Kein Clip ausgewählt — klicke einen Clip oder ziehe eine Szene aus der Palette
        </span>
      </div>
    );
  }

  const color = getEntryColor(entry);
  const label = getEntryLabel(entry);

  return (
    <div className="shrink-0 border-t border-white/8 px-4 py-2.5 flex items-center gap-4 flex-wrap bg-white/[0.02]">
      <div
        className="w-4 h-4 rounded-full border-2 border-white/20 cursor-pointer shrink-0"
        style={{ backgroundColor: color }}
        onClick={() => setShowColorPicker(showColorPicker === primary ? null : primary)}
        title="Farbe wählen"
      />

      <span className="text-[10px] font-black text-white/80">{label}</span>
      <span className="text-[8px] text-white/35">Scene {entry.sceneIndex + 1}</span>

      <div className="flex items-center gap-1 border border-white/8 rounded px-1 py-0.5">
        <button
          onClick={() => onUpdateRepeats(primary, Math.max(MIN_REPEATS, entry.repeats - 1))}
          className="text-[10px] font-bold text-white/40 hover:text-white/80 w-4 h-4 transition-colors"
        >−</button>
        <span className="text-[9px] font-mono text-white/60 w-6 text-center tabular-nums">
          {entry.repeats}
        </span>
        <button
          onClick={() => onUpdateRepeats(primary, Math.min(MAX_REPEATS, entry.repeats + 1))}
          className="text-[10px] font-bold text-white/40 hover:text-white/80 w-4 h-4 transition-colors"
        >+</button>
        <span className="text-[7px] text-white/25 ml-0.5">bars</span>
      </div>

      {scene && (
        <div className="flex items-center gap-3 text-[7px] text-white/35">
          {scene.rootName && <span>BASS: {scene.rootName} {scene.scaleName}</span>}
          {typeof (scene.chordsParams as unknown as Record<string, unknown> | undefined)?.presetName === "string" && (
            <span>
              CHORDS: {String((scene.chordsParams as unknown as Record<string, unknown>).presetName)}
            </span>
          )}
        </div>
      )}

      <label className="flex items-center gap-1.5 text-[8px] text-white/40 cursor-pointer ml-auto">
        <input
          type="checkbox"
          checked={entry.tempoBpm !== undefined}
          onChange={(e) => onUpdateEntry(primary, {
            tempoBpm:  e.target.checked ? 120 : undefined,
            tempoRamp: e.target.checked ? false : undefined,
          })}
          className="accent-[#22c55e]"
        />
        Tempo
      </label>
      {entry.tempoBpm !== undefined && (
        <input
          type="number" min={60} max={200}
          value={entry.tempoBpm}
          onChange={(e) =>
            onUpdateEntry(primary, { tempoBpm: parseInt(e.target.value) || 120 })
          }
          className="w-14 h-6 px-1 text-[10px] bg-black/30 border border-white/15 rounded text-white font-mono"
        />
      )}

      <button
        onClick={() => onStartRename(primary)}
        className="text-[8px] text-white/25 hover:text-white/60 border border-white/8 rounded px-1.5 py-0.5 transition-colors"
      >
        ✏ Umbenennen
      </button>

      <button
        onClick={() => onRemove(primary)}
        className="text-[8px] text-red-400/40 hover:text-red-400 transition-colors ml-1"
      >
        ✕
      </button>

      {showColorPicker === primary && (
        <div className="w-full flex items-center gap-2 mt-1">
          <span className="text-[7px] text-white/30 font-bold">FARBE:</span>
          <ArrangementColorPicker
            currentColor={entry.color}
            onSelect={(c) => {
              onUpdateEntry(primary, { color: c });
              setShowColorPicker(null);
            }}
          />
          {entry.color && (
            <button
              onClick={() => {
                onUpdateEntry(primary, { color: undefined });
                setShowColorPicker(null);
              }}
              className="text-[7px] text-white/30 hover:text-white/60 transition-colors"
            >
              zurücksetzen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ArrangementStatusBar ─────────────────────────────────────────────────────

interface ArrangementStatusBarProps {
  chainLength:    number;
  totalBars:      number;
  songMode:       string;
  setSongMode:    (m: "pattern" | "song") => void;
  isRecording:    boolean;
  setIsRecording: React.Dispatch<React.SetStateAction<boolean>>;
  recCount:       number;
  barPx:          number;
  setBarPx:       React.Dispatch<React.SetStateAction<number>>;
  onClear:        () => void;
  onClose:        () => void;
  arrMode:        "scene" | "clips";
  onSetArrMode:   (m: "scene" | "clips") => void;
}

function ArrangementStatusBar({
  chainLength, totalBars, songMode, setSongMode,
  isRecording, setIsRecording, recCount,
  barPx, setBarPx, onClear, onClose,
  arrMode, onSetArrMode,
}: ArrangementStatusBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-white/8 shrink-0">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[11px] font-black tracking-[0.22em] text-white/85">ARRANGEMENT</div>
          <div className="text-[7px] font-bold tracking-[0.14em] text-white/25 mt-0.5">
            {chainLength} CLIPS · {totalBars} BARS
          </div>
        </div>

        <button
          onClick={() => setSongMode(songMode === "song" ? "pattern" : "song")}
          className={`px-3 py-1 rounded-full text-[9px] font-black tracking-[0.18em] border transition-all ${
            songMode === "song"
              ? "border-[#10b981]/50 bg-[#10b981]/15 text-[#10b981]"
              : "border-white/10 bg-white/5 text-white/35 hover:text-white/60"
          }`}
        >
          {songMode === "song" ? "▶ SONG" : "○ PATTERN"}
        </button>

        <button
          onClick={() => setIsRecording(r => !r)}
          className={`px-3 py-1 rounded-full text-[9px] font-black tracking-[0.18em] border transition-all ${
            isRecording
              ? "border-red-500/60 bg-red-500/20 text-red-400 animate-pulse"
              : "border-white/10 bg-white/5 text-white/35 hover:text-red-400/70 hover:border-red-500/30"
          }`}
        >
          {isRecording ? `⏺ REC +${recCount}` : "⏺ REC"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        {/* Mode toggle */}
        <div className="flex gap-1 items-center">
          <button
            className={`text-[9px] font-black px-2 py-0.5 rounded transition-colors ${
              arrMode === "scene"
                ? "bg-white/15 text-white"
                : "text-white/40 hover:text-white/70"
            }`}
            onClick={() => onSetArrMode("scene")}
          >
            SCENE
          </button>
          <button
            className={`text-[9px] font-black px-2 py-0.5 rounded transition-colors ${
              arrMode === "clips"
                ? "bg-white/15 text-white"
                : "text-white/40 hover:text-white/70"
            }`}
            onClick={() => onSetArrMode("clips")}
          >
            CLIPS ✦
          </button>
        </div>

        <div className="flex items-center gap-1 border border-white/8 rounded-lg px-1.5 py-1">
          <button
            onClick={() => setBarPx(px => Math.max(MIN_BAR_PX, px - 8))}
            className="w-5 h-5 text-[10px] font-bold text-white/30 hover:text-white/70 transition-colors"
          >−</button>
          <span className="text-[8px] font-mono text-white/35 w-8 text-center tabular-nums">
            {Math.round(barPx / DEFAULT_BAR_PX * 100)}%
          </span>
          <button
            onClick={() => setBarPx(px => Math.min(MAX_BAR_PX, px + 8))}
            className="w-5 h-5 text-[10px] font-bold text-white/30 hover:text-white/70 transition-colors"
          >+</button>
        </div>

        <button
          onClick={onClear}
          className="px-2 py-1 rounded text-[8px] font-bold text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          CLEAR
        </button>

        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full text-white/30 hover:text-white hover:bg-white/8 transition-all text-lg flex items-center justify-center"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── Drag types ──────────────────────────────────────────────────────────────

type DragMode = "move" | "resize" | "draw";

interface DragState {
  mode:          DragMode;
  clipId?:       string;
  trackId:       ArrangementTrackId;
  startClientX:  number;
  origStart?:    number;
  origLen?:      number;
  drawBarStart?: number;
}

// ─── makeEmptyClipData ────────────────────────────────────────────────────────

function makeEmptyClipData(trackId: ArrangementTrackId): import("../store/arrangementStore").ArrangementClipData {
  switch (trackId) {
    case "drums":
      return {
        kind: "drums",
        pattern: {
          name: "Clip",
          tracks: Array.from({ length: 12 }, () => ({
            steps: Array.from({ length: 64 }, () => ({
              active: false, velocity: 100, microTiming: 0, probability: 100,
              ratchetCount: 1, condition: "always" as const, gateLength: 1, paramLocks: {},
            })),
            mute: false, solo: false, volume: 100, pan: 0, length: 16,
          })),
          length: 16,
          swing: 50,
        },
      };
    case "bass":
      return {
        kind: "bass",
        steps: Array.from({ length: 64 }, () => ({
          active: false, note: 0, octave: 0, accent: false,
          velocity: 0.82, slide: false, tie: false, gateLength: 1,
        })),
        length: 16,
      };
    case "chords":
      return {
        kind: "chords",
        steps: Array.from({ length: 64 }, () => ({
          active: false, note: 0, chordType: "maj" as const,
          octave: 0, accent: false, velocity: 0.82, tie: false, gateLength: 1,
        })),
        length: 16,
      };
    case "melody":
      return {
        kind: "melody",
        steps: Array.from({ length: 64 }, () => ({
          active: false, note: 0, octave: 0, accent: false,
          velocity: 0.82, slide: false, tie: false, gateLength: 1,
        })),
        length: 16,
      };
  }
}

// ─── PerTrackClip ─────────────────────────────────────────────────────────────

interface PerTrackClipProps {
  clip:            ArrangementClip;
  barPx:           number;
  color:           string;
  isSelected:      boolean;
  isRenaming:      boolean;
  renameValue:     string;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  onRenameChange:  (v: string) => void;
  onRenameCommit:  () => void;
  onSelect:        (e: React.MouseEvent) => void;
  onContextMenu:   (e: React.MouseEvent) => void;
  onMoveStart:     (e: React.PointerEvent) => void;
  onResizeStart:   (e: React.PointerEvent) => void;
}

function PerTrackClip({
  clip, barPx, color, isSelected, isRenaming, renameValue, renameInputRef,
  onRenameChange, onRenameCommit, onSelect, onContextMenu, onMoveStart, onResizeStart,
}: PerTrackClipProps) {
  const x = clip.startBar * barPx;
  const w = Math.max(8, clip.lengthBars * barPx - 1);

  return (
    <div
      className="absolute top-0.5 bottom-0.5 rounded overflow-hidden select-none"
      style={{
        left:            x,
        width:           w,
        backgroundColor: hexAlpha(color, 0.22),
        border:          isSelected
          ? `1px solid ${hexAlpha(color, 0.85)}`
          : `1px solid ${hexAlpha(color, 0.45)}`,
        cursor:          "grab",
      }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onPointerDown={onMoveStart}
    >
      {isRenaming ? (
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") onRenameCommit(); }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full bg-black/60 border-0 outline-none text-white px-1 text-[8px]"
          style={{ height: "100%" }}
        />
      ) : (
        <span
          className="text-[8px] font-bold px-1 truncate block leading-none pt-1"
          style={{ color: hexAlpha(color, 0.9) }}
        >
          {clip.name}
        </span>
      )}

      {/* Resize handle — right edge */}
      <div
        className="absolute top-0 bottom-0 right-0 w-2 cursor-col-resize hover:bg-white/10 z-10"
        onPointerDown={(e) => { e.stopPropagation(); onResizeStart(e); }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── PerTrackArrangement ──────────────────────────────────────────────────────

interface PerTrackArrangementProps {
  barPx:      number;
  currentBar: number;
}

function PerTrackArrangement({ barPx, currentBar }: PerTrackArrangementProps) {
  const { clips, totalBars, addClip, moveClip, resizeClip, removeClip, renameClip } =
    useArrangementStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const timelineW = totalBars * barPx;

  const rulerTicks = useMemo(
    () =>
      Array.from({ length: totalBars }, (_, i) => (
        <div
          key={i}
          className="text-[9px] text-white/40 font-mono shrink-0 border-l border-white/10 pl-1"
          style={{ width: barPx, lineHeight: `${RULER_H}px` }}
        >
          {i + 1}
        </div>
      )),
    [totalBars, barPx]
  );

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (renaming) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeClip(selectedId);
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, renaming, removeClip]);

  // Auto-focus rename input
  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [contextMenu]);

  // Global pointer move + up (for drag)
  useEffect(() => {
    if (!drag) return;

    function onMove(e: PointerEvent) {
      if (!drag) return;
      const deltaX = e.clientX - drag.startClientX;
      const deltaBars = Math.round(deltaX / barPx);

      if (drag.mode === "move" && drag.clipId !== undefined && drag.origStart !== undefined) {
        const newStart = Math.max(0, drag.origStart + deltaBars);
        moveClip(drag.clipId, newStart);
      } else if (drag.mode === "resize" && drag.clipId !== undefined && drag.origLen !== undefined) {
        const newLen = Math.max(1, drag.origLen + deltaBars);
        resizeClip(drag.clipId, newLen);
      }
    }

    function onUp(e: PointerEvent) {
      if (drag?.mode === "draw" && drag.drawBarStart !== undefined) {
        const deltaX = e.clientX - drag.startClientX;
        const deltaBars = Math.round(deltaX / barPx);
        const rawLen = Math.abs(deltaBars) + 1;
        const lengthBars = Math.max(1, rawLen);
        const startBar = deltaBars < 0
          ? Math.max(0, drag.drawBarStart + deltaBars)
          : drag.drawBarStart;
        addClip({
          trackId: drag.trackId,
          startBar,
          lengthBars,
          name: `${TRACK_LABELS[drag.trackId]} ${startBar + 1}`,
          data: makeEmptyClipData(drag.trackId),
        });
      }
      setDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, barPx, addClip, moveClip, resizeClip]);

  function startRename(clipId: string) {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    setRenaming(clipId);
    setRenameValue(clip.name);
    setContextMenu(null);
  }

  function commitRename() {
    if (renaming && renameValue.trim()) renameClip(renaming, renameValue.trim());
    setRenaming(null);
  }

  return (
    <div
      className="flex flex-col"
      style={{ minWidth: ARR_LABEL_W + timelineW }}
      onClick={() => { setSelectedId(null); setContextMenu(null); }}
    >
      {/* Bar ruler — click to seek */}
      <div
        className="flex items-center border-b border-white/10 bg-black/20 shrink-0 select-none"
        style={{ height: RULER_H, paddingLeft: ARR_LABEL_W, cursor: "pointer" }}
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const xInRuler = e.clientX - rect.left;
          if (xInRuler < ARR_LABEL_W) return; // clicked inside label column
          const bar = Math.floor((xInRuler - ARR_LABEL_W) / barPx);
          seekToBar(bar);
        }}
      >
        {rulerTicks}
        <div
          className="absolute top-0 bottom-0 w-px bg-red-500/80 pointer-events-none"
          style={{ left: ARR_LABEL_W + currentBar * barPx }}
        />
      </div>

      {/* Track rows */}
      {ARR_TRACKS.map((trackId) => {
        const color = TRACK_COLORS[trackId];
        const trackClips = clips.filter((c) => c.trackId === trackId);

        return (
          <div
            key={trackId}
            className="flex relative border-b border-white/10"
            style={{ height: ARR_TRACK_H }}
          >
            {/* Label */}
            <div
              className="flex items-center shrink-0 border-r border-white/10 px-2"
              style={{ width: ARR_LABEL_W, borderLeft: `3px solid ${color}` }}
            >
              <span className="text-[9px] font-black" style={{ color }}>
                {TRACK_LABELS[trackId]}
              </span>
            </div>

            {/* Timeline area */}
            <div
              className="relative overflow-hidden"
              style={{ width: timelineW, height: ARR_TRACK_H, cursor: drag?.mode === "draw" ? "crosshair" : "default" }}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const bar = Math.floor((e.clientX - rect.left) / barPx);
                setDrag({ mode: "draw", trackId, startClientX: e.clientX, drawBarStart: bar });
              }}
            >
              <div className="absolute inset-0 bg-black/10" />

              {trackClips.map((clip) => (
                <PerTrackClip
                  key={clip.id}
                  clip={clip}
                  barPx={barPx}
                  color={clip.color ?? color}
                  isSelected={selectedId === clip.id}
                  isRenaming={renaming === clip.id}
                  renameValue={renaming === clip.id ? renameValue : ""}
                  renameInputRef={renaming === clip.id ? renameInputRef : undefined}
                  onRenameChange={setRenameValue}
                  onRenameCommit={commitRename}
                  onSelect={(e) => { e.stopPropagation(); setSelectedId(clip.id); setContextMenu(null); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedId(clip.id);
                    setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
                  }}
                  onMoveStart={(e) => {
                    e.stopPropagation();
                    setSelectedId(clip.id);
                    if (e.altKey) {
                      const newId = addClip({ ...clip });
                      if (newId) {
                        setDrag({ mode: "move", clipId: newId, trackId, startClientX: e.clientX, origStart: clip.startBar });
                      }
                    } else {
                      setDrag({ mode: "move", clipId: clip.id, trackId, startClientX: e.clientX, origStart: clip.startBar });
                    }
                  }}
                  onResizeStart={(e) => {
                    e.stopPropagation();
                    setSelectedId(clip.id);
                    setDrag({ mode: "resize", clipId: clip.id, trackId, startClientX: e.clientX, origLen: clip.lengthBars });
                  }}
                />
              ))}

              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-px bg-red-500/60 pointer-events-none"
                style={{ left: currentBar * barPx }}
              />
            </div>
          </div>
        );
      })}

      {/* Phase 2 placeholders */}
      {["LOOPS", "SAMPLER"].map((label) => (
        <div
          key={label}
          className="flex relative border-b border-white/5 opacity-30"
          style={{ height: 36 }}
        >
          <div
            className="flex items-center shrink-0 border-r border-white/5 px-2"
            style={{ width: ARR_LABEL_W, borderLeft: "3px solid #555" }}
          >
            <span className="text-[9px] font-black text-white/40">{label}</span>
          </div>
          <div className="flex items-center px-2 text-[9px] text-white/20">Phase 2</div>
        </div>
      ))}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1a1a1a] border border-white/20 rounded shadow-xl py-1"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: 140 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1 text-[11px] text-white/80 hover:bg-white/10"
            onClick={() => startRename(contextMenu.clipId)}
          >
            Rename
          </button>
          <button
            className="w-full text-left px-3 py-1 text-[11px] text-white/80 hover:bg-white/10"
            onClick={() => { removeClip(contextMenu.clipId); setContextMenu(null); setSelectedId(null); }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─── AudioClipLane ────────────────────────────────────────────────────────────

interface AudioClipLaneProps {
  clips:      AudioClip[];
  barPx:      number;
  height:     number;
  totalBars:  number;
  onRemove:   (id: string) => void;
  onMove:     (id: string, startBar: number) => void;
  onResize:   (id: string, durationBars: number) => void;
  onDrop:     (e: React.DragEvent) => void;
}

function AudioClipLane({
  clips, barPx, height, totalBars,
  onRemove, onMove, onResize, onDrop,
}: AudioClipLaneProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offsetBar: number } | null>(null);
  const resizeRef = useRef<{ id: string; origBars: number; startX: number } | null>(null);

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
      const dx       = e.clientX - resizeRef.current.startX;
      const deltaBars = dx / barPx;
      onResize(resizeRef.current.id, Math.max(0.5, resizeRef.current.origBars + deltaBars));
    }
  }, [barPx, onMove, onResize]);

  const handleLanePointerUp = useCallback(() => {
    dragRef.current   = null;
    resizeRef.current = null;
  }, []);

  const handleResizePointerDown = useCallback((e: React.PointerEvent, clip: AudioClip) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { id: clip.id, origBars: clip.durationBars, startX: e.clientX };
  }, []);

  return (
    <div
      ref={laneRef}
      className="relative border-b border-black/20"
      style={{ height, minWidth: totalBars * barPx, backgroundColor: hexAlpha(AUDIO_COLOR, 0.03) }}
      onPointerMove={handleLanePointerMove}
      onPointerUp={handleLanePointerUp}
      onPointerCancel={handleLanePointerUp}
      onDragOver={(e) => e.preventDefault()}
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
        const x = clip.startBar * barPx;
        const w = Math.max(barPx * 0.5, clip.durationBars * barPx);
        return (
          <div
            key={clip.id}
            className="absolute top-1 bottom-1 overflow-hidden rounded select-none"
            style={{
              left:            x,
              width:           w,
              backgroundColor: hexAlpha(clip.color, 0.15),
              border:          `1px solid ${hexAlpha(clip.color, 0.4)}`,
              cursor:          "grab",
            }}
            onPointerDown={(e) => handleClipPointerDown(e, clip)}
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
            {/* Filename label */}
            <div className="absolute top-0 left-0 right-6 px-1.5 pt-0.5 pointer-events-none">
              <span
                className="text-[6px] font-bold truncate block leading-tight"
                style={{ color: hexAlpha(clip.color, 0.85) }}
              >
                {clip.fileName.replace(/\.[^.]+$/, "")}
              </span>
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

// ─── Main export ──────────────────────────────────────────────────────────────

export function ArrangementView({ isOpen, onClose }: ArrangementViewProps) {
  const songChain              = useDrumStore((s) => s.songChain);
  const songPosition           = useDrumStore((s) => s.songPosition);
  const songRepeatCount        = useDrumStore((s) => s.songRepeatCount);
  const songMode               = useDrumStore((s) => s.songMode);
  const setSongMode            = useDrumStore((s) => s.setSongMode);
  const addToSongChain         = useDrumStore((s) => s.addToSongChain);
  const removeFromSongChain    = useDrumStore((s) => s.removeFromSongChain);
  const updateSongEntryRepeats = useDrumStore((s) => s.updateSongEntryRepeats);
  const moveSongEntry          = useDrumStore((s) => s.moveSongEntry);
  const clearSongChain         = useDrumStore((s) => s.clearSongChain);
  const updateSongEntry        = useDrumStore((s) => s.updateSongEntry);
  const scenes                 = useSceneStore((s) => s.scenes);
  const bpm                    = useDrumStore((s) => s.bpm);

  // Audio clip store
  const audioClips      = useAudioClipStore((s) => s.clips);
  const addAudioClip    = useAudioClipStore((s) => s.addClip);
  const removeAudioClip = useAudioClipStore((s) => s.removeClip);
  const moveAudioClip   = useAudioClipStore((s) => s.moveClip);
  const resizeAudioClip = useAudioClipStore((s) => s.resizeClip);

  const [arrMode, setArrMode]                 = useState<"scene" | "clips">("scene");
  const setArrangementMode                    = useDrumStore((s) => s.setArrangementMode);

  const [barPx, setBarPx]                     = useState(DEFAULT_BAR_PX);
  const [selected, setSelected]               = useState<Set<string>>(new Set());
  const [moveDrag, setMoveDrag]               = useState<{ from: number; to: number } | null>(null);
  const [clipboard, setClipboard]             = useState<SongChainEntry | null>(null);
  const [contextMenu, setContextMenu]         =
    useState<{ x: number; y: number; index: number; track: TrackId | "loops" } | null>(null);
  const [renamingIndex, setRenamingIndex]     = useState<number | null>(null);
  const [renameValue, setRenameValue]         = useState("");
  const [showColorPicker, setShowColorPicker] = useState<number | null>(null);
  const [isRecording, setIsRecording]         = useState(false);
  const [recCount, setRecCount]               = useState(0);
  const [loopStart, setLoopStart]             = useState<number | null>(null);
  const [loopEnd, setLoopEnd]                 = useState<number | null>(null);
  const loopDragRef = useRef<{ handle: "start" | "end"; startX: number; startBar: number } | null>(null);

  // sub-bar playhead precision via external step store
  const currentDrumStep = useSyncExternalStore(
    drumCurrentStepStore.subscribe,
    drumCurrentStepStore.getSnapshot,
  );

  // live bar position from arrangementScheduler
  const arrCurrentBar = useSyncExternalStore(
    arrangementBarStore.subscribe,
    arrangementBarStore.getSnapshot,
  );

  const resizingRef    = useRef<{ index: number; startX: number; startRepeats: number } | null>(null);
  const contentRef     = useRef<HTMLDivElement>(null);
  const lastRecScene   = useRef<number>(-1);
  const recBarStart    = useRef<number>(-1);
  const timelineRef    = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const totalBars     = Math.max(songChain.reduce((s, e) => s + e.repeats, 0), 32);
  const activeEntry   = songChain[songPosition];
  const stepsPerBar   = 16; // 1 bar = 16 steps in 4/4
  const stepFraction  = activeEntry
    ? (currentDrumStep % stepsPerBar) / stepsPerBar
    : 0;
  const playheadBarOffset =
    songChain.slice(0, songPosition).reduce((sum, e) => sum + e.repeats, 0)
    + songRepeatCount
    + stepFraction;
  const playheadPx = playheadBarOffset * barPx;

  // Reset arrangement mode when the view closes
  useEffect(() => {
    if (!isOpen) {
      setArrangementMode(false);
      setArrMode("scene");
    }
  }, [isOpen, setArrangementMode]);

  // Ctrl/Cmd+scroll zoom
  useEffect(() => {
    if (!isOpen) return;
    const el = timelineRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setBarPx(px => Math.max(MIN_BAR_PX, Math.min(MAX_BAR_PX, px - Math.sign(e.deltaY) * 6)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isOpen]);

  // REC mode: auto-append scene switches
  useEffect(() => {
    if (!isRecording) { lastRecScene.current = -1; recBarStart.current = -1; return; }
    setRecCount(0);
    recBarStart.current = -1;
    const unsub = useSceneStore.subscribe((state, prev) => {
      const newScene = state.activeScene;
      if (newScene === prev.activeScene || newScene < 0) return;
      const scene = state.scenes[newScene];
      if (!scene) return;
      const bars = Math.max(1, Math.ceil((scene.drumPattern.length ?? 16) / 16));

      // Fix previous entry's repeats to the actual number of bars played.
      // barCycle is incremented before loadScene fires but the store update
      // happens after — add 1 to get the bar that's actually starting now.
      const currentBar = useDrumStore.getState().barCycle + 1;
      const chain = useDrumStore.getState().songChain;
      if (chain.length > 0 && recBarStart.current >= 0) {
        const actualRepeats = Math.max(1, currentBar - recBarStart.current);
        useDrumStore.getState().updateSongEntry(chain.length - 1, { repeats: actualRepeats });
      }

      useDrumStore.getState().addToSongChain(newScene, bars);
      recBarStart.current = currentBar;
      lastRecScene.current = newScene;
      setRecCount(c => c + 1);
    });
    return () => unsub();
  }, [isRecording]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [contextMenu]);

  // Focus rename input when opened
  useEffect(() => {
    if (renamingIndex !== null) renameInputRef.current?.focus();
  }, [renamingIndex]);

  // Global pointer events for edge-resize + loop-brace drag
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // Clip resize
      const r = resizingRef.current;
      if (r) {
        const rawDelta = (e.clientX - r.startX) / barPx;
        const snap     = e.shiftKey ? 4 : 1;
        const delta    = Math.round(rawDelta / snap) * snap;
        const next     = Math.max(MIN_REPEATS, Math.min(MAX_REPEATS, r.startRepeats + delta));
        updateSongEntryRepeats(r.index, next);
      }
      // Loop-brace drag
      const ld = loopDragRef.current;
      if (ld) {
        const barDelta = Math.round((e.clientX - ld.startX) / barPx);
        const newBar   = Math.max(0, Math.min(totalBars, ld.startBar + barDelta));
        if (ld.handle === "start") {
          setLoopStart(Math.min(newBar, (loopEnd ?? totalBars) - 1));
        } else {
          setLoopEnd(Math.max(newBar, (loopStart ?? 0) + 1));
        }
      }
    };
    const onUp = () => {
      resizingRef.current = null;
      loopDragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [barPx, totalBars, loopStart, loopEnd, updateSongEntryRepeats]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (renamingIndex !== null) return;
      const primaryKey   = selected.size > 0 ? [...selected][0]! : null;
      const primary      = primaryKey !== null ? getSelIdx(primaryKey) : null;
      const primaryTrack = primaryKey ? getSelTrack(primaryKey) : ("drums" as TrackId | "loops");

      if (e.key === "Escape") {
        if (contextMenu) { setContextMenu(null); return; }
        setSelected(new Set());
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.size === 0) return;
        e.preventDefault();

        // Group selected keys by chain index, collect the tracks per index
        const byIdx = new Map<number, string[]>();
        for (const k of selected) {
          const idx = getSelIdx(k);
          const track = getSelTrack(k);
          if (!byIdx.has(idx)) byIdx.set(idx, []);
          byIdx.get(idx)!.push(track);
        }
        const allTracks = ["drums", "bass", "chords", "melody", "loops"] as const;

        [...byIdx.keys()].sort((a, b) => b - a).forEach(idx => {
          const entry = useDrumStore.getState().songChain[idx];
          if (!entry) return;
          const nowHidden = new Set([...(entry.hiddenTracks ?? []), ...byIdx.get(idx)!]);
          if (allTracks.every(t => nowHidden.has(t))) {
            removeFromSongChain(idx);
          } else {
            updateSongEntry(idx, { hiddenTracks: [...nowHidden] });
          }
        });
        setSelected(new Set());
        return;
      }

      if ((e.key === "d" || e.key === "D") && !e.metaKey && !e.ctrlKey) {
        if (primary === null) return;
        const entry = useDrumStore.getState().songChain[primary];
        if (!entry) return;
        useDrumStore.getState().addToSongChain(entry.sceneIndex, entry.repeats);
        const newIdx = useDrumStore.getState().songChain.length - 1;
        useDrumStore.getState().moveSongEntry(newIdx, primary + 1);
        if (entry.color || entry.label) {
          useDrumStore.getState().updateSongEntry(primary + 1, {
            color: entry.color, label: entry.label,
          });
        }
        setSelected(new Set([makeSelKey(primaryTrack, primary + 1)]));
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        if (primary === null) return;
        const entry = useDrumStore.getState().songChain[primary];
        if (entry) setClipboard({ ...entry });
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        if (!clipboard) return;
        const after = primary ?? useDrumStore.getState().songChain.length - 1;
        useDrumStore.getState().addToSongChain(clipboard.sceneIndex, clipboard.repeats);
        const newIdx = useDrumStore.getState().songChain.length - 1;
        useDrumStore.getState().moveSongEntry(newIdx, after + 1);
        if (clipboard.color || clipboard.label) {
          useDrumStore.getState().updateSongEntry(after + 1, {
            color: clipboard.color, label: clipboard.label,
          });
        }
        setSelected(new Set([makeSelKey(primaryTrack, after + 1)]));
        return;
      }

      if (e.key === "-" || e.key === "_") {
        if (primary === null) return;
        const entry = useDrumStore.getState().songChain[primary];
        if (entry) updateSongEntryRepeats(primary, Math.max(MIN_REPEATS, entry.repeats - 1));
        return;
      }

      if (e.key === "=" || e.key === "+") {
        if (primary === null) return;
        const entry = useDrumStore.getState().songChain[primary];
        if (entry) updateSongEntryRepeats(primary, Math.min(MAX_REPEATS, entry.repeats + 1));
        return;
      }

      if (e.key === "ArrowLeft") {
        if (primary === null || primary === 0) return;
        e.preventDefault();
        moveSongEntry(primary, primary - 1);
        setSelected(new Set(
          [...selected].map(k => getSelIdx(k) === primary ? makeSelKey(getSelTrack(k), primary - 1) : k)
        ));
        return;
      }

      if (e.key === "ArrowRight") {
        if (primary === null) return;
        e.preventDefault();
        if (primary >= useDrumStore.getState().songChain.length - 1) return;
        moveSongEntry(primary, primary + 1);
        setSelected(new Set(
          [...selected].map(k => getSelIdx(k) === primary ? makeSelKey(getSelTrack(k), primary + 1) : k)
        ));
        return;
      }

      if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey) {
        if (primary === null) return;
        setShowColorPicker(primary);
        return;
      }

      if (e.key === "F2") {
        if (primary === null) return;
        const entry = useDrumStore.getState().songChain[primary];
        setRenameValue(entry?.label ?? getEntryLabel(entry ?? { sceneIndex: 0, repeats: 1 }));
        setRenamingIndex(primary);
        return;
      }

      // L — toggle loop brace (set to full range or clear)
      if ((e.key === "l" || e.key === "L") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (loopStart !== null) {
          setLoopStart(null); setLoopEnd(null);
        } else {
          setLoopStart(0);
          setLoopEnd(Math.max(songChain.reduce((s, en) => s + en.repeats, 0), 4));
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, selected, clipboard, renamingIndex, contextMenu, loopStart, loopEnd,
      removeFromSongChain, updateSongEntryRepeats, moveSongEntry, songChain]);

  // Selection helper — per-track per-chain-index
  const selectEntry = useCallback((index: number, track: TrackId | "loops", multi: boolean) => {
    const key = makeSelKey(track, index);
    setContextMenu(null);
    if (multi) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
    } else {
      setSelected(prev =>
        prev.size === 1 && prev.has(key) ? new Set() : new Set([key])
      );
    }
  }, []);

  const openContextMenu = useCallback((e: React.MouseEvent, index: number, track: TrackId | "loops") => {
    e.preventDefault();
    setSelected(new Set([makeSelKey(track, index)]));
    setContextMenu({ x: e.clientX, y: e.clientY, index, track });
  }, []);

  // Audio file drop → decode → compute peaks → create clip at bar position
  const handleAudioFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.(wav|mp3|ogg|flac|aiff?|m4a)$/i.test(file.name)) return;

    const { audioEngine: ae } = await import("../audio/AudioEngine");
    const ctx = ae.getAudioContext();
    if (!ctx) return;

    try {
      const arrayBuf = await file.arrayBuffer();
      const buffer   = await ctx.decodeAudioData(arrayBuf);

      // Bar position from drop X relative to timeline content area
      const laneEl = (e.currentTarget as HTMLElement);
      const rect   = laneEl.getBoundingClientRect();
      const dropX  = e.clientX - rect.left;
      const startBar = Math.max(0, Math.floor(dropX / barPx));

      const secPerBar    = (60.0 / bpm) * 4;
      const durationBars = Math.max(0.5, buffer.duration / secPerBar);
      const peaks        = computeWaveformPeaks(buffer);

      addAudioClip({
        id:           `ac-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        startBar,
        durationBars,
        fileName:     file.name,
        buffer,
        waveformPeaks: peaks,
        volume:        1,
        color:         AUDIO_COLOR,
      });
    } catch (err) {
      console.warn("AudioClip decode failed:", err);
    }
  }, [barPx, bpm, addAudioClip]);

  const handleSceneDrop = useCallback((e: React.DragEvent, atIndex?: number) => {
    e.preventDefault();
    const sceneIdx = parseInt(e.dataTransfer.getData("sceneIndex"));
    if (!isNaN(sceneIdx)) {
      const scene = useSceneStore.getState().scenes[sceneIdx];
      const bars  = scene ? Math.max(1, Math.ceil((scene.drumPattern.length ?? 16) / 16)) : 1;
      addToSongChain(sceneIdx, bars);
      if (atIndex !== undefined) {
        moveSongEntry(useDrumStore.getState().songChain.length - 1, atIndex);
      }
    }
  }, [addToSongChain, moveSongEntry]);

  // Pointer-based clip move — works from any track row (including hidden ones)
  const handleClipMoveStart = useCallback((e: React.PointerEvent, clipIndex: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setMoveDrag({ from: clipIndex, to: clipIndex });
  }, []);

  const handleContentPointerMove = useCallback((e: React.PointerEvent) => {
    if (!moveDrag) return;
    const el = contentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scrollLeft = timelineRef.current?.scrollLeft ?? 0;
    const relX = e.clientX - rect.left + scrollLeft;
    const chain = useDrumStore.getState().songChain;
    let cumX = 0;
    let toIndex = chain.length - 1;
    for (let i = 0; i < chain.length; i++) {
      const w = (chain[i]?.repeats ?? 1) * barPx;
      if (relX < cumX + w * 0.5) { toIndex = i; break; }
      cumX += w;
    }
    if (toIndex !== moveDrag.to) setMoveDrag(prev => prev ? { ...prev, to: toIndex } : null);
  }, [moveDrag, barPx]);

  const handleContentPointerUp = useCallback(() => {
    if (!moveDrag) return;
    if (moveDrag.from !== moveDrag.to) {
      moveSongEntry(moveDrag.from, moveDrag.to);
      setSelected(new Set());
    }
    setMoveDrag(null);
  }, [moveDrag, moveSongEntry]);

  const commitRename = useCallback(() => {
    if (renamingIndex === null) return;
    updateSongEntry(renamingIndex, { label: renameValue.trim() || undefined });
    setRenamingIndex(null);
  }, [renamingIndex, renameValue, updateSongEntry]);

  if (!isOpen) return null;

  const primarySelKey = selected.size > 0 ? [...selected][0]! : null;
  const primaryIdx    = primarySelKey !== null ? getSelIdx(primarySelKey) : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="flex flex-col bg-[linear-gradient(180deg,rgba(14,15,20,0.99),rgba(8,9,13,0.99))] border border-white/10 rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.6)] w-[98vw] max-w-[1600px] h-[95vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <ArrangementStatusBar
          chainLength={songChain.length}
          totalBars={totalBars}
          songMode={songMode}
          setSongMode={setSongMode}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
          recCount={recCount}
          barPx={barPx}
          setBarPx={setBarPx}
          onClear={() => {
            if (confirm("Clear entire arrangement?")) {
              clearSongChain();
              setSelected(new Set());
            }
          }}
          onClose={onClose}
          arrMode={arrMode}
          onSetArrMode={(m) => {
            setArrMode(m);
            setArrangementMode(m === "clips");
          }}
        />

        {/* Timeline */}
        {arrMode === "clips" ? (
          <div className="flex flex-1 min-h-0 overflow-x-auto overflow-y-auto">
            <PerTrackArrangement barPx={barPx} currentBar={arrCurrentBar} />
          </div>
        ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden" ref={timelineRef}>

          {/* Track labels */}
          <div className="shrink-0 border-r border-white/8 flex flex-col" style={{ width: LABEL_W }}>
            <div style={{ height: RULER_H }} className="border-b border-white/8 shrink-0" />
            {TRACKS.map(({ id, label }) => {
              const trackColor = TRACK_COLORS[id as keyof typeof TRACK_COLORS];
              return (
                <div
                  key={id}
                  className="relative flex items-center border-b border-white/5 shrink-0 pl-3"
                  style={{ height: TRACK_H }}
                >
                  {/* Colored left accent bar */}
                  <div
                    className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
                    style={{ backgroundColor: hexAlpha(trackColor, 0.7) }}
                  />
                  <span
                    className="text-[8px] font-black tracking-[0.18em]"
                    style={{ color: hexAlpha(trackColor, 0.65) }}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
            <div
              className="relative flex items-center border-b border-white/5 shrink-0 pl-3"
              style={{ height: LOOP_H }}
            >
              <div
                className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
                style={{ backgroundColor: hexAlpha(LOOP_COLOR, 0.6) }}
              />
              <span
                className="text-[8px] font-black tracking-[0.18em]"
                style={{ color: hexAlpha(LOOP_COLOR, 0.6) }}
              >
                LOOPS
              </span>
            </div>
            {/* AUDIO track label */}
            <div
              className="relative flex items-center border-b border-white/5 shrink-0 pl-3"
              style={{ height: AUDIO_H }}
            >
              <div
                className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
                style={{ backgroundColor: hexAlpha(AUDIO_COLOR, 0.7) }}
              />
              <span
                className="text-[8px] font-black tracking-[0.18em]"
                style={{ color: hexAlpha(AUDIO_COLOR, 0.65) }}
              >
                AUDIO
              </span>
            </div>
          </div>

          {/* Scrollable area */}
          <div className="relative flex-1 overflow-x-auto overflow-y-hidden">

            {/* Ruler */}
            <div
              className="sticky top-0 z-20 relative border-b border-white/8 bg-[rgba(8,9,13,0.95)] select-none overflow-hidden"
              style={{ height: RULER_H, minWidth: totalBars * barPx }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleSceneDrop(e)}
              onPointerDown={(e) => {
                // Click on ruler (not a handle) sets loop start and begins range drag
                if ((e.target as HTMLElement).dataset.loopHandle) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const bar  = Math.floor((e.clientX - rect.left) / barPx);
                setLoopStart(bar);
                setLoopEnd(bar + 1);
                loopDragRef.current = { handle: "end", startX: e.clientX, startBar: bar + 1 };
              }}
            >
              {/* Bar tick marks */}
              <div className="absolute inset-0 flex pointer-events-none">
                {Array.from({ length: totalBars }, (_, i) => (
                  <div
                    key={i}
                    className="border-r border-white/5 flex items-center shrink-0"
                    style={{ width: barPx, minWidth: barPx }}
                  >
                    {i % 4 === 0 && (
                      <span className="text-[7px] font-mono text-white/25 pl-0.5">{i + 1}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Loop-brace region */}
              {loopStart !== null && loopEnd !== null && (
                <>
                  <div
                    className="absolute top-0 pointer-events-none"
                    style={{
                      left:   loopStart * barPx,
                      width:  (loopEnd - loopStart) * barPx,
                      height: RULER_H,
                      backgroundColor: "rgba(34,211,238,0.12)",
                      borderTop: "2px solid rgba(34,211,238,0.55)",
                    }}
                  />
                  {/* Start handle */}
                  <div
                    data-loop-handle="start"
                    className="absolute top-0 cursor-ew-resize z-10"
                    style={{
                      left:   loopStart * barPx - 3,
                      width:  6,
                      height: RULER_H,
                      backgroundColor: "rgba(34,211,238,0.7)",
                      borderRadius: "2px",
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      loopDragRef.current = { handle: "start", startX: e.clientX, startBar: loopStart };
                      (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    }}
                  />
                  {/* End handle */}
                  <div
                    data-loop-handle="end"
                    className="absolute top-0 cursor-ew-resize z-10"
                    style={{
                      left:   loopEnd * barPx - 3,
                      width:  6,
                      height: RULER_H,
                      backgroundColor: "rgba(34,211,238,0.7)",
                      borderRadius: "2px",
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      loopDragRef.current = { handle: "end", startX: e.clientX, startBar: loopEnd };
                      (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    }}
                  />
                  {/* Loop label */}
                  <div
                    className="absolute top-0.5 pointer-events-none text-[6px] font-black tracking-wider"
                    style={{ left: loopStart * barPx + 6, color: "rgba(34,211,238,0.7)" }}
                  >
                    {loopStart + 1}–{loopEnd}
                  </div>
                </>
              )}

              {/* Playhead triangle on ruler */}
              {songMode === "song" && songChain.length > 0 && (
                <div
                  className="absolute top-0 pointer-events-none z-20"
                  style={{ left: playheadPx - 4, top: 2 }}
                >
                  <div style={{
                    width: 0, height: 0,
                    borderLeft:  "4px solid transparent",
                    borderRight: "4px solid transparent",
                    borderTop:   "5px solid rgba(255,255,255,0.8)",
                  }} />
                </div>
              )}
            </div>

            {/* Track content */}
            <div
              ref={contentRef}
              className="relative"
              style={{ minWidth: totalBars * barPx }}
              onPointerMove={handleContentPointerMove}
              onPointerUp={handleContentPointerUp}
              onPointerCancel={() => setMoveDrag(null)}
            >

              {/* Grid backgrounds */}
              {[
                ...TRACKS.map((_, ri) => ({ top: ri * TRACK_H, h: TRACK_H })),
                { top: TRACKS.length * TRACK_H, h: LOOP_H },
              ].map(({ top, h }, ri) => (
                <div
                  key={ri}
                  className="absolute left-0 right-0 border-b border-white/5"
                  style={{
                    top, height: h,
                    backgroundImage: `repeating-linear-gradient(90deg,transparent,transparent ${barPx * 4 - 1}px,rgba(255,255,255,0.015) ${barPx * 4 - 1}px,rgba(255,255,255,0.015) ${barPx * 4}px)`,
                  }}
                />
              ))}

              {/* Drop indicator line during pointer move */}
              {moveDrag !== null && (() => {
                const chain = songChain;
                let x = 0;
                for (let i = 0; i < moveDrag.to; i++) x += (chain[i]?.repeats ?? 1) * barPx;
                const totalH = TRACKS.length * TRACK_H + LOOP_H;
                return (
                  <div
                    className="absolute top-0 pointer-events-none z-30"
                    style={{
                      left: x - 1,
                      width: 2,
                      height: totalH,
                      backgroundColor: "rgba(255,255,255,0.6)",
                      boxShadow: "0 0 6px rgba(255,255,255,0.4)",
                    }}
                  />
                );
              })()}

              {/* Instrument rows */}
              {TRACKS.map(({ id }, trackIndex) => (
                <div
                  key={id}
                  className="absolute left-0 flex"
                  style={{ top: trackIndex * TRACK_H, height: TRACK_H }}
                >
                  {songChain.map((entry, clipIndex) => {
                    const scene    = scenes[entry.sceneIndex] ?? null;
                    const color    = getEntryColor(entry);
                    const label    = getEntryLabel(entry);
                    const isActive = songMode === "song" && clipIndex === songPosition;
                    const progress = isActive ? songRepeatCount / Math.max(1, entry.repeats) : 0;
                    const w        = entry.repeats * barPx;

                    return (
                      <ArrangementClip
                        key={clipIndex}
                        entry={entry}
                        trackId={id}
                        scene={scene}
                        color={color}
                        label={label}
                        width={w}
                        height={TRACK_H}
                        isFirstTrack={trackIndex === 0}
                        isLastTrack={trackIndex === TRACKS.length - 1}
                        isActive={isActive}
                        progress={progress}
                        isSelected={selected.has(makeSelKey(id, clipIndex))}
                        isHidden={entry.hiddenTracks?.includes(id) ?? false}
                        isDragging={moveDrag !== null && moveDrag.from === clipIndex}
                        isRenaming={renamingIndex === clipIndex && trackIndex === 0}
                        renameValue={renameValue}
                        renameInputRef={trackIndex === 0 ? renameInputRef : undefined}
                        onRenameChange={setRenameValue}
                        onRenameCommit={commitRename}
                        onSelect={(multi) => selectEntry(clipIndex, id, multi)}
                        onContextMenu={(e) => openContextMenu(e, clipIndex, id)}
                        onMoveStart={(e) => handleClipMoveStart(e, clipIndex)}
                        onResizeStart={(e) => {
                          e.stopPropagation();
                          resizingRef.current = {
                            index: clipIndex,
                            startX: e.clientX,
                            startRepeats: entry.repeats,
                          };
                          (e.target as HTMLElement).setPointerCapture(e.pointerId);
                        }}
                      />
                    );
                  })}

                  {songChain.length === 0 && trackIndex === 0 && (
                    <div
                      className="flex items-center justify-center border-2 border-dashed border-white/8 rounded m-1.5 px-4"
                      style={{ height: TRACK_H - 12, minWidth: 300 }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleSceneDrop(e)}
                    >
                      <span className="text-[9px] text-white/20 font-bold tracking-wider whitespace-nowrap">
                        Drag scenes here · or press REC and trigger scenes live
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {/* Loop lane */}
              <div
                className="absolute left-0 flex"
                style={{ top: TRACKS.length * TRACK_H, height: LOOP_H }}
              >
                <ArrangementLoopLane
                  songChain={songChain}
                  scenes={scenes}
                  barPx={barPx}
                  height={LOOP_H}
                  songPosition={songPosition}
                  songMode={songMode}
                  selected={selected}
                  onSelect={(i, multi) => selectEntry(i, "loops", multi)}
                  onDragOver={() => {}}
                  onDrop={(e, i) => handleSceneDrop(e, i)}
                />
              </div>

              {/* AUDIO clip lane */}
              <AudioClipLane
                clips={audioClips}
                barPx={barPx}
                height={AUDIO_H}
                totalBars={totalBars}
                onRemove={removeAudioClip}
                onMove={moveAudioClip}
                onResize={resizeAudioClip}
                onDrop={handleAudioFileDrop}
              />

              {/* Loop-brace overlay on track area */}
              {loopStart !== null && loopEnd !== null && (
                <div
                  className="absolute top-0 pointer-events-none z-10"
                  style={{
                    left:   loopStart * barPx,
                    width:  (loopEnd - loopStart) * barPx,
                    height: TRACKS.length * TRACK_H + LOOP_H,
                    backgroundColor: "rgba(34,211,238,0.04)",
                    borderLeft:  "1px solid rgba(34,211,238,0.25)",
                    borderRight: "1px solid rgba(34,211,238,0.25)",
                  }}
                />
              )}

              {/* Playhead */}
              {songMode === "song" && songChain.length > 0 && (
                <div
                  className="absolute top-0 z-30 pointer-events-none"
                  style={{
                    left:            playheadPx,
                    width:           2,
                    height:          TRACKS.length * TRACK_H + LOOP_H,
                    backgroundColor: "rgba(255,255,255,0.55)",
                  }}
                >
                  <div
                    className="absolute"
                    style={{
                      top: -6, left: -4,
                      width: 0, height: 0,
                      borderLeft:  "5px solid transparent",
                      borderRight: "5px solid transparent",
                      borderTop:   "6px solid rgba(255,255,255,0.7)",
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        {/* Detail panel */}
        <ArrangementDetailPanel
          songChain={songChain}
          scenes={scenes}
          primaryIdx={primaryIdx}
          showColorPicker={showColorPicker}
          setShowColorPicker={setShowColorPicker}
          onUpdateEntry={updateSongEntry}
          onUpdateRepeats={updateSongEntryRepeats}
          onStartRename={(i) => {
            const entry = songChain[i];
            setRenameValue(entry?.label ?? getEntryLabel(entry ?? { sceneIndex: 0, repeats: 1 }));
            setRenamingIndex(i);
          }}
          onRemove={(i) => { removeFromSongChain(i); setSelected(new Set()); }}
        />

        {/* Scene palette */}
        <div className="shrink-0 border-t border-white/8 px-4 py-2.5 bg-black/20">
          <div className="text-[7px] font-black tracking-[0.2em] text-white/22 mb-1.5">
            SCENE PALETTE — drag oder klicken zum Hinzufügen
            {isRecording && " · REC: Szene auswählen"}
          </div>
          <div className="grid grid-cols-8 gap-1">
            {scenes.map((scene, i) => {
              const color = SCENE_COLORS[i % SCENE_COLORS.length]!;
              return (
                <div
                  key={i}
                  draggable={!!scene}
                  onDragStart={(e) => {
                    if (!scene) { e.preventDefault(); return; }
                    e.dataTransfer.setData("sceneIndex", String(i));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => {
                    if (!scene) return;
                    addToSongChain(
                      i,
                      Math.max(1, Math.ceil((scene.drumPattern.length ?? 16) / 16))
                    );
                  }}
                  className="h-8 rounded-md border flex flex-col items-center justify-center transition-all"
                  style={{
                    borderColor:     scene ? hexAlpha(color, 0.35) : "rgba(255,255,255,0.05)",
                    backgroundColor: scene ? hexAlpha(color, 0.08) : "rgba(255,255,255,0.015)",
                    opacity:         scene ? 1 : 0.4,
                    cursor:          scene ? "grab" : "not-allowed",
                  }}
                >
                  {scene ? (
                    <>
                      <span className="text-[7px] font-bold text-white/70 truncate w-full text-center px-0.5 leading-tight">
                        {scene.name}
                      </span>
                      <span className="text-[6px] font-mono" style={{ color: hexAlpha(color, 0.6) }}>
                        #{i + 1}
                      </span>
                    </>
                  ) : (
                    <span className="text-[6px] text-white/15">#{i + 1}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Context menu */}
        {contextMenu && (
          <ArrangementContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            entry={songChain[contextMenu.index] ?? null}
            onDuplicate={() => {
              const entry = songChain[contextMenu.index];
              if (!entry) return;
              useDrumStore.getState().addToSongChain(entry.sceneIndex, entry.repeats);
              const newLen = useDrumStore.getState().songChain.length;
              useDrumStore.getState().moveSongEntry(newLen - 1, contextMenu.index + 1);
              if (entry.color || entry.label) {
                useDrumStore.getState().updateSongEntry(contextMenu.index + 1, {
                  color: entry.color, label: entry.label,
                });
              }
              setSelected(new Set([makeSelKey(contextMenu.track, contextMenu.index + 1)]));
              setContextMenu(null);
            }}
            onCopy={() => {
              const entry = songChain[contextMenu.index];
              if (entry) setClipboard({ ...entry });
              setContextMenu(null);
            }}
            onPaste={() => {
              if (!clipboard) return;
              useDrumStore.getState().addToSongChain(clipboard.sceneIndex, clipboard.repeats);
              const newLen = useDrumStore.getState().songChain.length;
              useDrumStore.getState().moveSongEntry(newLen - 1, contextMenu.index + 1);
              if (clipboard.color || clipboard.label) {
                useDrumStore.getState().updateSongEntry(contextMenu.index + 1, {
                  color: clipboard.color, label: clipboard.label,
                });
              }
              setSelected(new Set([makeSelKey(contextMenu.track, contextMenu.index + 1)]));
              setContextMenu(null);
            }}
            onBarsChange={(delta) => {
              const entry = songChain[contextMenu.index];
              if (entry) {
                updateSongEntryRepeats(
                  contextMenu.index,
                  Math.max(MIN_REPEATS, Math.min(MAX_REPEATS, entry.repeats + delta))
                );
              }
              setContextMenu(null);
            }}
            onOpenColorPicker={() => {
              setShowColorPicker(contextMenu.index);
              setContextMenu(null);
            }}
            onRename={() => {
              const entry = songChain[contextMenu.index];
              setRenameValue(entry?.label ?? getEntryLabel(entry ?? { sceneIndex: 0, repeats: 1 }));
              setRenamingIndex(contextMenu.index);
              setContextMenu(null);
            }}
            onDelete={() => {
              const { index, track } = contextMenu;
              const entry = useDrumStore.getState().songChain[index];
              if (entry) {
                const allTracks = ["drums", "bass", "chords", "melody", "loops"] as const;
                const nowHidden = new Set([...(entry.hiddenTracks ?? []), track]);
                if (allTracks.every(t => nowHidden.has(t))) {
                  removeFromSongChain(index);
                } else {
                  updateSongEntry(index, { hiddenTracks: [...nowHidden] });
                }
              }
              setSelected(new Set());
              setContextMenu(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
