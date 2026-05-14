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
import { useMixerBarStore } from "../store/mixerBarStore";
import { MixerBar } from "./MixerBar";
import {
  useArrangementAutoStore,
  TRACK_AUTO_PARAMS,
  type AutoLane,
  type AutoPoint,
  type AutoParam,
} from "../store/arrangementAutoStore";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";
import { useOverlayStore } from "../store/overlayStore";
import { DEFAULT_BASS_PARAMS } from "../audio/BassEngine";
import { DEFAULT_CHORDS_PARAMS } from "../audio/ChordsEngine";
import { DEFAULT_MELODY_PARAMS } from "../audio/MelodyEngine";

// ─── Layout constants ─────────────────────────────────────────────────────────

const LABEL_W        = 86;
const MIN_TRACK_H    = 44;        // minimum track row height (px)
const MIN_LOOP_H     = 28;        // minimum loop row height (px)
const MIN_AUDIO_H    = 44;        // minimum audio row height (px)
const N_LOOP_ROWS    = 5;         // number of visible loop track rows (slots 0–4)
const AUDIO_COLOR    = "#f97316"; // warm orange — distinct from drum red
const RULER_H        = 22;

// Weight-based height distribution (used by ResizeObserver in component)
const TRACK_WEIGHT   = 1.4;
const LOOP_WEIGHT    = 0.8;
const AUDIO_WEIGHT   = 1.2;
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
// One row per loop player slot. Rendered N_LOOP_ROWS times (slots 0..N_LOOP_ROWS-1).

interface ArrangementLoopLaneProps {
  songChain:    SongChainEntry[];
  scenes:       (Scene | null)[];
  barPx:        number;
  height:       number;
  slotIndex:    number;  // which loop player slot this row represents
  songPosition: number;
  songMode:     string;
  selected:     Set<string>;
  onSelect:     (i: number, multi: boolean) => void;
  onDragOver:   (i: number) => void;
  onDrop:       (e: React.DragEvent, i: number) => void;
}

function ArrangementLoopLane({
  songChain, scenes, barPx, height, slotIndex,
  songPosition, songMode, selected,
  onSelect, onDragOver, onDrop,
}: ArrangementLoopLaneProps) {
  const liveSlot = useLoopPlayerStore((s) => s.slots[slotIndex]);

  return (
    <>
      {songChain.map((entry, i) => {
        const scene      = scenes[entry.sceneIndex] ?? null;
        const slotActive = scene?.loopSlots?.[slotIndex]?.playing ?? false;
        const peaks      = liveSlot?.waveformPeaks ?? null;
        const fileName   = liveSlot?.fileName ?? "";
        const w          = entry.repeats * barPx;
        const isActive   = songMode === "song" && i === songPosition;
        const isSel      = selected.has(makeSelKey("loops", i));

        return (
          <div
            key={i}
            className="relative overflow-hidden border-r border-b border-black/20"
            style={{
              width: w, minWidth: w, height,
              backgroundColor: isSel
                ? hexAlpha(LOOP_COLOR, 0.18)
                : isActive && slotActive
                  ? hexAlpha(LOOP_COLOR, 0.14)
                  : slotActive
                    ? hexAlpha(LOOP_COLOR, 0.08)
                    : hexAlpha(LOOP_COLOR, 0.03),
              outline:       isSel ? `1px solid ${hexAlpha(LOOP_COLOR, 0.5)}` : "none",
              outlineOffset: "-1px",
              cursor:        "default",
            }}
            onClick={(e) => onSelect(i, e.metaKey || e.ctrlKey)}
            onDragOver={(e) => { e.preventDefault(); onDragOver(i); }}
            onDrop={(e) => onDrop(e, i)}
          >
            {slotActive ? (
              <>
                {peaks && w > 20 && (
                  <LoopWaveformCanvas
                    peaks={peaks}
                    color={LOOP_COLOR}
                    width={w}
                    height={height}
                  />
                )}
                <div className="absolute inset-0 flex items-center px-1.5 pointer-events-none">
                  <span
                    className="text-[6px] font-bold leading-none truncate"
                    style={{ color: hexAlpha(LOOP_COLOR, peaks ? 0.55 : 0.75) }}
                  >
                    {fileName ? fileName.replace(/\.[^.]+$/, "").slice(0, 14) : `L${slotIndex + 1}`}
                  </span>
                </div>
              </>
            ) : (
              <span className="absolute inset-0 flex items-center px-2 text-[6px]"
                style={{ color: hexAlpha(LOOP_COLOR, 0.1) }}>—</span>
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
  // audio clip branch
  selectedAudioClip:  AudioClip | null;
  onAudioTrimPoints:  (id: string, startSec: number, endSec: number) => void;
  onAudioFades:       (id: string, fadeIn: number, fadeOut: number) => void;
  onAudioVolume:      (id: string, volume: number) => void;
  onAudioSplit:       (id: string) => void;
  onAudioRemove:      (id: string) => void;
}

function ArrangementDetailPanel({
  songChain, scenes, primaryIdx,
  showColorPicker, setShowColorPicker,
  onUpdateEntry, onUpdateRepeats, onStartRename, onRemove,
  selectedAudioClip, onAudioTrimPoints, onAudioFades, onAudioVolume, onAudioSplit, onAudioRemove,
}: ArrangementDetailPanelProps) {
  const primary = primaryIdx;
  const entry   = primary !== null ? (songChain[primary] ?? null) : null;
  const scene   = entry ? (scenes[entry.sceneIndex] ?? null) : null;

  if (selectedAudioClip) {
    const ac = selectedAudioClip;
    return (
      <div className="shrink-0 border-t border-white/8 px-4 py-2 flex items-center gap-3 flex-wrap bg-white/[0.02]">
        <span className="text-[8px] font-black tracking-wider" style={{ color: hexAlpha(AUDIO_COLOR, 0.8) }}>
          AUDIO
        </span>
        <span className="text-[8px] text-white/40 truncate max-w-[120px]">{ac.fileName}</span>

        {/* Sample Start */}
        <label className="flex items-center gap-1 text-[7px] text-white/35">
          START
          <input
            type="number" step="0.01" min={0} max={ac.sampleEndSec - 0.1}
            value={ac.sampleStartSec.toFixed(2)}
            onChange={(e) => onAudioTrimPoints(ac.id, parseFloat(e.target.value) || 0, ac.sampleEndSec)}
            className="w-14 h-5 px-1 text-[9px] bg-black/30 border border-white/10 rounded text-white font-mono"
          />
          s
        </label>

        {/* Sample End */}
        <label className="flex items-center gap-1 text-[7px] text-white/35">
          END
          <input
            type="number" step="0.01" min={ac.sampleStartSec + 0.1} max={ac.buffer.duration}
            value={ac.sampleEndSec.toFixed(2)}
            onChange={(e) => onAudioTrimPoints(ac.id, ac.sampleStartSec, parseFloat(e.target.value) || ac.buffer.duration)}
            className="w-14 h-5 px-1 text-[9px] bg-black/30 border border-white/10 rounded text-white font-mono"
          />
          s
        </label>

        {/* Fade In */}
        <label className="flex items-center gap-1 text-[7px] text-white/35">
          FADE IN
          <input
            type="number" step="0.01" min={0}
            value={ac.fadeInSec.toFixed(2)}
            onChange={(e) => onAudioFades(ac.id, parseFloat(e.target.value) || 0, ac.fadeOutSec)}
            className="w-12 h-5 px-1 text-[9px] bg-black/30 border border-white/10 rounded text-white font-mono"
          />
          s
        </label>

        {/* Fade Out */}
        <label className="flex items-center gap-1 text-[7px] text-white/35">
          FADE OUT
          <input
            type="number" step="0.01" min={0}
            value={ac.fadeOutSec.toFixed(2)}
            onChange={(e) => onAudioFades(ac.id, ac.fadeInSec, parseFloat(e.target.value) || 0)}
            className="w-12 h-5 px-1 text-[9px] bg-black/30 border border-white/10 rounded text-white font-mono"
          />
          s
        </label>

        {/* Volume */}
        <label className="flex items-center gap-1 text-[7px] text-white/35">
          VOL
          <input
            type="number" step="1" min={0} max={100}
            value={Math.round(ac.volume * 100)}
            onChange={(e) => onAudioVolume(ac.id, (parseInt(e.target.value) || 0) / 100)}
            className="w-12 h-5 px-1 text-[9px] bg-black/30 border border-white/10 rounded text-white font-mono"
          />
          %
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => onAudioSplit(ac.id)}
            className="text-[8px] font-bold px-2 py-1 rounded border border-white/10 text-white/40 hover:text-white/80 hover:border-white/25 transition-colors"
            title="⌘E — Split at hover position"
          >
            ✂ SPLIT
          </button>
          <button
            onClick={() => onAudioRemove(ac.id)}
            className="text-[8px] text-red-400/40 hover:text-red-400 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

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
  onToggleMixer?: () => void;
  mixerVisible?:  boolean;
  loopEnabled?:   boolean;
  onToggleLoop?:  () => void;
}

function ArrangementStatusBar({
  chainLength, totalBars, songMode, setSongMode,
  isRecording, setIsRecording, recCount,
  barPx, setBarPx, onClear, onClose,
  arrMode, onSetArrMode, onToggleMixer, mixerVisible,
  loopEnabled, onToggleLoop,
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

        {onToggleLoop && (
          <button
            onClick={onToggleLoop}
            className={`px-3 py-1 rounded-full text-[9px] font-black tracking-[0.18em] border transition-all ${
              loopEnabled
                ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-400"
                : "border-white/10 bg-white/5 text-white/35 hover:text-cyan-400/60 hover:border-cyan-400/30"
            }`}
            title="Toggle loop region (Clips mode ruler)"
          >
            ⟲ LOOP
          </button>
        )}
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

        {onToggleMixer && (
          <button
            onClick={onToggleMixer}
            className={`px-2 py-1 rounded text-[8px] font-bold transition-all border ${
              mixerVisible
                ? "border-[#10b981]/50 bg-[#10b981]/15 text-[#10b981]"
                : "border-white/10 bg-white/5 text-white/40 hover:text-white/70"
            }`}
          >
            MIXER
          </button>
        )}

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
  /** Live snap-bar feedback — set by the pointer-move handler so the
   *  timeline can render a guide line at the position the clip would
   *  land if released right now. */
  snapBar?:      number;
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

// ─── ClipPreviewCanvas ────────────────────────────────────────────────────────
// Draws mini step bars for one pattern, repeated across the full clip width.
// Loop boundaries get dashed separator lines. Repeats are drawn at 50% alpha.

interface ClipPreviewCanvasProps {
  clip:   ArrangementClip;
  color:  string;
  width:  number;
  height: number;
}

function ClipPreviewCanvas({ clip, color, width, height }: ClipPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    // ── Build bar-height array for one pattern ───────────────────────────────
    let bars: number[] = [];
    let patternSteps = 16;

    if (clip.data.kind === "drums") {
      patternSteps = clip.data.pattern.length;
      const heights = Array<number>(patternSteps).fill(0);
      clip.data.pattern.tracks.forEach((track, ti) => {
        track.steps.slice(0, patternSteps).forEach((step, si) => {
          if (step.active) {
            const seed = ((ti * 2654435761) ^ (si * 2246822519)) & 0x7fffffff;
            const h = 0.3 + ((seed * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff * 0.7;
            heights[si] = Math.max(heights[si] ?? 0, h);
          }
        });
      });
      bars = heights;
    } else if (clip.data.kind === "bass") {
      patternSteps = clip.data.length;
      bars = bassWaveformBars(clip.data.steps.slice(0, patternSteps));
    } else {
      // chords or melody
      patternSteps = (clip.data as { length: number }).length;
      bars = noteWaveformBars((clip.data as { steps: Array<{ active: boolean; note: number; octave: number }> }).steps.slice(0, patternSteps));
    }

    if (bars.length === 0 || width <= 0) return;

    // ── Draw ─────────────────────────────────────────────────────────────────
    const totalSteps   = clip.lengthBars * 16;
    const patternPx    = (patternSteps / totalSteps) * width;
    const loopCount    = Math.ceil(totalSteps / patternSteps);
    const stepPx       = patternPx / bars.length;
    const barW         = Math.max(1, stepPx - 0.5);
    const usable       = (height - 4) * 0.75;

    for (let loop = 0; loop < loopCount; loop++) {
      const loopX    = loop * patternPx;
      const baseAlpha = loop === 0 ? 0.55 : 0.28;

      bars.forEach((h, i) => {
        if (h === 0) return;
        const x    = loopX + i * stepPx;
        if (x > width) return;
        const barH = Math.max(2, h * usable);
        const y    = height - 2 - barH;
        ctx.fillStyle = hexAlpha(color, baseAlpha);
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 0.5);
        ctx.fill();
      });

      // Dashed loop divider (skip the very first boundary at x=0)
      if (loop > 0) {
        ctx.save();
        ctx.strokeStyle = hexAlpha(color, 0.45);
        ctx.lineWidth   = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(loopX), 0);
        ctx.lineTo(Math.round(loopX), height);
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [clip.data, clip.lengthBars, color, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none"
    />
  );
}

// ─── PerTrackClipProps ────────────────────────────────────────────────────────

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
  onDoubleClick:   (e: React.MouseEvent) => void;
  onContextMenu:   (e: React.MouseEvent) => void;
  onMoveStart:     (e: React.PointerEvent) => void;
  onResizeStart:   (e: React.PointerEvent) => void;
}

function PerTrackClip({
  clip, barPx, color, isSelected, isRenaming, renameValue, renameInputRef,
  onRenameChange, onRenameCommit, onSelect, onDoubleClick, onContextMenu, onMoveStart, onResizeStart,
}: PerTrackClipProps) {
  const x = clip.startBar * barPx;
  const w = Math.max(8, clip.lengthBars * barPx - 1);
  const h = ARR_TRACK_H - 2; // clip height (top-0.5 + bottom-0.5 margin)

  // How many loop repeats fit?
  const patternSteps = clip.data.kind === "drums" ? clip.data.pattern.length : clip.data.length;
  const patternBars  = Math.max(1, patternSteps / 16);
  const loopCount    = Math.ceil(clip.lengthBars / patternBars);

  // Double-tap detection for touch (native dblclick handles mouse)
  const lastTapTime = useRef(0);
  const lastTapX    = useRef(0);
  const lastTapY    = useRef(0);
  const dtFired     = useRef(false);   // suppress click after double-tap

  const handleCombinedPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      const now = Date.now();
      const dt  = now - lastTapTime.current;
      const dx  = Math.abs(e.clientX - lastTapX.current);
      const dy  = Math.abs(e.clientY - lastTapY.current);

      if (dt < 400 && dx < 24 && dy < 24) {
        // Double-tap → open editor
        e.stopPropagation();
        dtFired.current = true;
        lastTapTime.current = 0;
        if (navigator.vibrate) navigator.vibrate(30);
        onDoubleClick(e as unknown as React.MouseEvent);
        return;              // don't start drag
      }
      lastTapTime.current = now;
      lastTapX.current    = e.clientX;
      lastTapY.current    = e.clientY;
      dtFired.current     = false;
    }
    onMoveStart(e);
  }, [onMoveStart, onDoubleClick]);

  const handleCombinedPointerMove = useCallback((_e: React.PointerEvent) => {
    // no-op — drag is handled by global window listener
  }, []);

  const handleCombinedPointerUp = useCallback(() => {
    // no-op
  }, []);

  const handleCombinedClick = useCallback((e: React.MouseEvent) => {
    if (dtFired.current) { dtFired.current = false; return; }
    onSelect(e);
  }, [onSelect]);

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
      onClick={handleCombinedClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onPointerDown={handleCombinedPointerDown}
      onPointerMove={handleCombinedPointerMove}
      onPointerUp={handleCombinedPointerUp}
      onPointerCancel={handleCombinedPointerUp}
    >
      {/* Mini waveform + loop dividers */}
      {w > 12 && (
        <ClipPreviewCanvas clip={clip} color={color} width={w} height={h} />
      )}

      {/* Name label */}
      {isRenaming ? (
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") onRenameCommit(); }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-0 left-0 right-6 bg-black/60 border-0 outline-none text-white px-1 text-[8px] z-10"
          style={{ height: 14 }}
        />
      ) : (
        <span
          className="absolute top-0.5 left-1 right-6 text-[8px] font-bold truncate block leading-none z-10 pointer-events-none"
          style={{ color: hexAlpha(color, 0.95), textShadow: "0 1px 2px rgba(0,0,0,0.7)" }}
        >
          {clip.name}
          {loopCount > 1 && (
            <span className="ml-1 opacity-50 font-normal">×{loopCount}</span>
          )}
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
  const { clips, totalBars, addClip, moveClip, resizeClip, removeClip, renameClip,
          updateClipData, loopRegion, setLoopRegion } =
    useArrangementStore();
  /**
   * Selection state. Holds 0..N clip IDs (Set so order doesn't matter and
   * has/add/delete are O(1)). The previous version was a single `string |
   * null`; widening to Set unblocks shift-click multi-select and bulk
   * delete without changing the existing single-click flow (a fresh click
   * still ends up with exactly one ID in the set).
   */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const timelineW = totalBars * barPx;

  // Loop region drag
  const loopDragRef = useRef<{ handle: "start" | "end"; startX: number; startBar: number } | null>(null);
  const loopRegionRef = useRef(loopRegion);
  useEffect(() => { loopRegionRef.current = loopRegion; }, [loopRegion]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const ld = loopDragRef.current;
      if (!ld) return;
      const dx = e.clientX - ld.startX;
      const newBar = Math.max(0, Math.round(ld.startBar + dx / barPx));
      const lr = loopRegionRef.current;
      if (ld.handle === "start") {
        setLoopRegion(Math.min(newBar, lr.end - 1), lr.end);
      } else {
        setLoopRegion(lr.start, Math.max(newBar, lr.start + 1));
      }
    }
    function onUp() { loopDragRef.current = null; }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [barPx, setLoopRegion]);

  // ── Clip editing (double-click) ──────────────────────────────────────────────
  const editingClipRef = useRef<{ id: string; trackId: ArrangementTrackId } | null>(null);
  const openOverlay    = useOverlayStore((s) => s.openOverlay);
  const closeOverlay   = useOverlayStore((s) => s.closeOverlay);
  const openSet        = useOverlayStore((s) => s.open);
  const prevOpenRef    = useRef<Set<string>>(new Set());

  // When a piano-roll overlay closes, write the current engine state back to the clip
  useEffect(() => {
    const ec = editingClipRef.current;
    if (ec) {
      const OVERLAY: Partial<Record<ArrangementTrackId, string>> = {
        bass:   "pianoRoll",
        chords: "chordPianoRoll",
        melody: "pianoRoll",
      };
      const ov = OVERLAY[ec.trackId] as Parameters<typeof openOverlay>[0] | undefined;
      if (ov) {
        const wasOpen = prevOpenRef.current.has(ov);
        const isOpen  = openSet.has(ov);
        if (wasOpen && !isOpen) {
          // Overlay just closed — save current engine state back to clip
          if (ec.trackId === "bass") {
            const { steps, length, params } = useBassStore.getState();
            updateClipData(ec.id, { kind: "bass", steps, length, params: params ?? DEFAULT_BASS_PARAMS });
          } else if (ec.trackId === "chords") {
            const { steps, length, params } = useChordsStore.getState();
            updateClipData(ec.id, { kind: "chords", steps, length, params: params ?? DEFAULT_CHORDS_PARAMS });
          } else if (ec.trackId === "melody") {
            const { steps, length, params } = useMelodyStore.getState();
            updateClipData(ec.id, { kind: "melody", steps, length, params: params ?? DEFAULT_MELODY_PARAMS });
          }
          editingClipRef.current = null;
        }
      }
    }
    prevOpenRef.current = new Set(Array.from(openSet) as string[]);
  }, [openSet, updateClipData]);

  function handleEditClip(clipId: string) {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    editingClipRef.current = { id: clipId, trackId: clip.trackId };

    if (clip.data.kind === "drums") {
      // Load pattern then close arrangement — step-sequencer becomes visible
      useDrumStore.setState({ pattern: structuredClone(clip.data.pattern) });
      closeOverlay("arrangement");
    } else if (clip.data.kind === "bass") {
      const st = useBassStore.getState();
      st.loadBassPattern({
        steps:     clip.data.steps,
        length:    clip.data.length,
        params:    clip.data.params ?? DEFAULT_BASS_PARAMS,
        rootNote:  st.rootNote,
        rootName:  st.rootName,
        scaleName: st.scaleName,
      });
      openOverlay("pianoRoll");
    } else if (clip.data.kind === "chords") {
      const st = useChordsStore.getState();
      st.loadChordsPattern({
        steps:     clip.data.steps,
        length:    clip.data.length,
        params:    clip.data.params ?? DEFAULT_CHORDS_PARAMS,
        rootNote:  st.rootNote,
        rootName:  st.rootName,
        scaleName: st.scaleName,
      });
      openOverlay("chordPianoRoll");
    } else if (clip.data.kind === "melody") {
      const st = useMelodyStore.getState();
      st.loadMelodyPattern({
        steps:     clip.data.steps,
        length:    clip.data.length,
        params:    clip.data.params ?? DEFAULT_MELODY_PARAMS,
        rootNote:  st.rootNote,
        rootName:  st.rootName,
        scaleName: st.scaleName,
      });
      openOverlay("pianoRoll");
    }
  }

  const rulerTicks = useMemo(
    () =>
      Array.from({ length: totalBars }, (_, i) => {
        // Every 4-bar boundary gets a brighter label + stronger divider —
        // matches the way Ableton/Logic show downbeats so producers can
        // navigate without counting ticks one by one.
        const isMajor = i % 4 === 0;
        return (
          <div
            key={i}
            className={`font-mono shrink-0 border-l pl-1 ${
              isMajor
                ? "text-[10px] font-bold text-white/70 border-white/25"
                : "text-[9px] text-white/30 border-white/10"
            }`}
            style={{ width: barPx, lineHeight: `${RULER_H}px` }}
          >
            {isMajor ? `${i + 1}` : ""}
          </div>
        );
      }),
    [totalBars, barPx]
  );

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (renaming) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
        e.preventDefault();
        // Bulk delete — works whether 1 or N clips are selected.
        for (const id of selectedIds) removeClip(id);
        setSelectedIds(new Set());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, renaming, removeClip]);

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
        // Surface the snap target so the timeline can draw a guide line
        if (drag.snapBar !== newStart) setDrag({ ...drag, snapBar: newStart });
      } else if (drag.mode === "resize" && drag.clipId !== undefined && drag.origLen !== undefined) {
        const newLen = Math.max(1, drag.origLen + deltaBars);
        resizeClip(drag.clipId, newLen);
        const snapEnd = (drag.origStart ?? 0) + newLen;
        if (drag.snapBar !== snapEnd) setDrag({ ...drag, snapBar: snapEnd });
      } else if (drag.mode === "draw" && drag.drawBarStart !== undefined) {
        const tentativeStart = deltaBars < 0
          ? Math.max(0, drag.drawBarStart + deltaBars)
          : drag.drawBarStart;
        const tentativeLen = Math.max(1, Math.abs(deltaBars) + 1);
        const snapBar = tentativeStart + tentativeLen;
        if (drag.snapBar !== snapBar) setDrag({ ...drag, snapBar });
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
      onClick={() => { setSelectedIds(new Set()); setContextMenu(null); }}
    >
      {/* Bar ruler — click to seek, drag loop handles */}
      <div
        className="relative flex items-center border-b border-white/10 bg-black/20 shrink-0 select-none"
        style={{ height: RULER_H, paddingLeft: ARR_LABEL_W, cursor: "pointer" }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.loopHandle) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const xInRuler = e.clientX - rect.left;
          if (xInRuler < ARR_LABEL_W) return;
          const bar = Math.floor((xInRuler - ARR_LABEL_W) / barPx);
          seekToBar(bar);
        }}
      >
        {rulerTicks}

        {/* Snap-to-bar guide — shown while a clip is being dragged so the
            producer sees exactly where it will land. The line runs through
            the full timeline (rendered via absolute fixed-top in this ruler
            for the head, full-height in the timeline body below). */}
        {drag?.snapBar !== undefined && (
          <div
            className="absolute pointer-events-none top-0"
            style={{
              left: ARR_LABEL_W + drag.snapBar * barPx,
              height: RULER_H,
              width: 2,
              backgroundColor: "var(--ed-accent-orange)",
              boxShadow: "0 0 8px var(--ed-accent-orange)",
            }}
          />
        )}

        {/* Loop region highlight */}
        <div
          className="absolute top-0 pointer-events-none"
          style={{
            left:            ARR_LABEL_W + loopRegion.start * barPx,
            width:           (loopRegion.end - loopRegion.start) * barPx,
            height:          RULER_H,
            backgroundColor: loopRegion.enabled ? "rgba(34,211,238,0.18)" : "rgba(34,211,238,0.07)",
            borderTop:       `2px solid rgba(34,211,238,${loopRegion.enabled ? 0.65 : 0.3})`,
          }}
        />
        {/* Loop label */}
        <div
          className="absolute pointer-events-none text-[6px] font-black tracking-wider"
          style={{
            left:  ARR_LABEL_W + loopRegion.start * barPx + 8,
            top:   3,
            color: `rgba(34,211,238,${loopRegion.enabled ? 0.75 : 0.35})`,
          }}
        >
          ⟲ {loopRegion.start + 1}–{loopRegion.end}
        </div>
        {/* Loop start handle */}
        <div
          data-loop-handle="start"
          className="absolute top-0 z-10 cursor-ew-resize"
          style={{
            left:            ARR_LABEL_W + loopRegion.start * barPx - 3,
            width:           6,
            height:          RULER_H,
            backgroundColor: `rgba(34,211,238,${loopRegion.enabled ? 0.8 : 0.4})`,
            borderRadius:    "2px",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            loopDragRef.current = { handle: "start", startX: e.clientX, startBar: loopRegion.start };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
        />
        {/* Loop end handle */}
        <div
          data-loop-handle="end"
          className="absolute top-0 z-10 cursor-ew-resize"
          style={{
            left:            ARR_LABEL_W + loopRegion.end * barPx - 3,
            width:           6,
            height:          RULER_H,
            backgroundColor: `rgba(34,211,238,${loopRegion.enabled ? 0.8 : 0.4})`,
            borderRadius:    "2px",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            loopDragRef.current = { handle: "end", startX: e.clientX, startBar: loopRegion.end };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
        />

        {/* Playhead */}
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
                  isSelected={selectedIds.has(clip.id)}
                  isRenaming={renaming === clip.id}
                  renameValue={renaming === clip.id ? renameValue : ""}
                  renameInputRef={renaming === clip.id ? renameInputRef : undefined}
                  onRenameChange={setRenameValue}
                  onRenameCommit={commitRename}
                  onSelect={(e) => {
                    e.stopPropagation();
                    // Shift / Meta toggles the clicked clip in the set;
                    // plain click replaces the selection with this single clip.
                    if (e.shiftKey || e.metaKey || e.ctrlKey) {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(clip.id)) next.delete(clip.id);
                        else next.add(clip.id);
                        return next;
                      });
                    } else {
                      setSelectedIds(new Set([clip.id]));
                    }
                    setContextMenu(null);
                  }}
                  onDoubleClick={(e) => { e.stopPropagation(); handleEditClip(clip.id); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Right-click on an un-selected clip selects it (single).
                    // Right-click on a selected clip leaves the rest of the
                    // selection intact so bulk-context-actions can target many.
                    setSelectedIds((prev) => prev.has(clip.id) ? prev : new Set([clip.id]));
                    setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
                  }}
                  onMoveStart={(e) => {
                    e.stopPropagation();
                    if (!selectedIds.has(clip.id)) setSelectedIds(new Set([clip.id]));
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
                    if (!selectedIds.has(clip.id)) setSelectedIds(new Set([clip.id]));
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
            onClick={() => { handleEditClip(contextMenu.clipId); setContextMenu(null); }}
          >
            ✏ Edit
          </button>
          <div className="border-t border-white/8 my-0.5" />
          <button
            className="w-full text-left px-3 py-1 text-[11px] text-white/80 hover:bg-white/10"
            onClick={() => startRename(contextMenu.clipId)}
          >
            Rename
          </button>
          <button
            className="w-full text-left px-3 py-1 text-[11px] text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
            onClick={() => {
              // If the user right-clicked into a multi-selection, delete
              // ALL selected clips (right-click + Delete is a power-user
              // workflow for purging a chunk of the arrangement at once).
              const targets = selectedIds.has(contextMenu.clipId) && selectedIds.size > 1
                ? Array.from(selectedIds)
                : [contextMenu.clipId];
              for (const id of targets) removeClip(id);
              setContextMenu(null);
              setSelectedIds(new Set());
            }}
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

function AudioClipLane({
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

// ─── AutoLaneCanvas ───────────────────────────────────────────────────────────

interface AutoLaneCanvasProps {
  lane:       AutoLane;
  totalBars:  number;
  barPx:      number;
  height:     number;
  color:      string;
  onChange:   (points: AutoPoint[]) => void;
}

function AutoLaneCanvas({ lane, totalBars, barPx, height, onChange }: AutoLaneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** paint = free draw, drag = move existing point */
  const actionRef = useRef<{
    kind:     "paint" | "drag" | null;
    dragIdx:  number | null;
    lastBar:  number;
    lastVal:  number;
  }>({ kind: null, dragIdx: null, lastBar: 0, lastVal: 0 });

  const [hover, setHover] = useState<{ x: number; y: number; bar: number; val: number } | null>(null);
  const width = totalBars * barPx;
  const getY  = (v: number) => height * (1 - v);
  const getV  = (rawY: number) => Math.max(0, Math.min(1, 1 - rawY / height));

  // ── Draw ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    // Bar grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth   = 1;
    for (let b = 1; b < totalBars; b++) {
      ctx.beginPath();
      ctx.moveTo(b * barPx, 0);
      ctx.lineTo(b * barPx, height);
      ctx.stroke();
    }
    // Mid guide (value = 0.5)
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(0, height * 0.5);
    ctx.lineTo(width, height * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    const pts = [...lane.points].sort((a, b) => a.bar - b.bar);

    // Stepped path + fill
    const path = new Path2D();
    const fill = new Path2D();
    fill.moveTo(0, height);

    if (pts.length === 0) {
      const y = getY(0.75);
      path.moveTo(0, y); path.lineTo(width, y);
      fill.lineTo(0, y); fill.lineTo(width, y);
    } else {
      const firstY = getY(pts[0]!.value);
      path.moveTo(0, firstY);
      path.lineTo(pts[0]!.bar * barPx, firstY);
      fill.lineTo(0, firstY);
      fill.lineTo(pts[0]!.bar * barPx, firstY);

      for (let i = 0; i < pts.length; i++) {
        const curr = pts[i]!;
        const next = pts[i + 1];
        if (next) {
          const nx = next.bar * barPx;
          const cy = getY(curr.value);
          const ny = getY(next.value);
          path.lineTo(nx, cy); path.lineTo(nx, ny);
          fill.lineTo(nx, cy); fill.lineTo(nx, ny);
        } else {
          path.lineTo(width, getY(curr.value));
          fill.lineTo(width, getY(curr.value));
        }
      }
    }
    fill.lineTo(width, height);
    fill.closePath();

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "rgba(99,102,241,0.45)");
    grad.addColorStop(1, "rgba(99,102,241,0.05)");
    ctx.fillStyle = grad;
    ctx.fill(fill);

    ctx.strokeStyle = "#818cf8";
    ctx.lineWidth   = 1.5;
    ctx.stroke(path);

    // Point dots
    for (const pt of pts) {
      const px = pt.bar * barPx;
      const py = getY(pt.value);
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle   = "#c7d2fe";
      ctx.fill();
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    // Hover crosshair + label (only while not actively drawing)
    if (hover && actionRef.current.kind === null) {
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(hover.x, 0); ctx.lineTo(hover.x, height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, hover.y); ctx.lineTo(width, hover.y);  ctx.stroke();
      ctx.setLineDash([]);

      const label = `B${hover.bar + 1}  ${Math.round(hover.val * 100)}%`;
      ctx.font      = "9px monospace";
      ctx.fillStyle = "rgba(199,210,254,0.85)";
      const tx = Math.min(hover.x + 5, width - label.length * 5.5);
      ctx.fillText(label, tx, Math.max(11, hover.y - 5));
    }
  }, [lane.points, totalBars, barPx, height, width, hover]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function fromEvent(e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const bar  = Math.max(0, Math.min(totalBars - 1, Math.round(rawX / barPx)));
    const val  = getV(rawY);
    return { rawX, rawY, bar, val };
  }

  function nearPoint(rawX: number, rawY: number): number | null {
    for (let i = 0; i < lane.points.length; i++) {
      const pt = lane.points[i]!;
      if (Math.abs(pt.bar * barPx - rawX) <= 9 && Math.abs(getY(pt.value) - rawY) <= 9) return i;
    }
    return null;
  }

  /**
   * Paint automation values from (fromBar, fromVal) → (toBar, toVal).
   * Linearly interpolates across all bars in between so diagonal drags
   * produce smooth ramps instead of jagged steps.
   */
  function paintRange(fromBar: number, fromVal: number, toBar: number, toVal: number) {
    const map = new Map(lane.points.map(p => [p.bar, p.value]));
    const lo  = Math.min(fromBar, toBar);
    const hi  = Math.max(fromBar, toBar);
    for (let b = lo; b <= hi; b++) {
      const t = hi === lo ? 0 : (b - lo) / (hi - lo);
      // When dragging right: lo=fromBar, so t=0→fromVal, t=1→toVal
      // When dragging left:  lo=toBar,   so t=0→toVal,   t=1→fromVal
      const v = fromBar <= toBar
        ? fromVal + t * (toVal - fromVal)
        : toVal   + t * (fromVal - toVal);
      map.set(b, Math.max(0, Math.min(1, v)));
    }
    onChange(Array.from(map.entries()).map(([bar, value]) => ({ bar, value })));
  }

  // ── Pointer handlers ─────────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { rawX, rawY, bar, val } = fromEvent(e);
    setHover(null);
    const near = nearPoint(rawX, rawY);
    if (near !== null) {
      // Drag existing point
      actionRef.current = { kind: "drag", dragIdx: near, lastBar: bar, lastVal: val };
    } else {
      // Start painting
      actionRef.current = { kind: "paint", dragIdx: null, lastBar: bar, lastVal: val };
      paintRange(bar, val, bar, val);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { rawX, rawY, bar, val } = fromEvent(e);
    const a = actionRef.current;

    if (a.kind === null) {
      // Idle — show hover crosshair
      setHover({ x: rawX, y: rawY, bar, val });
      return;
    }
    if (a.kind === "drag" && a.dragIdx !== null) {
      const newPts = [...lane.points];
      newPts[a.dragIdx] = { bar, value: val };
      onChange(newPts);
    } else if (a.kind === "paint") {
      paintRange(a.lastBar, a.lastVal, bar, val);
    }
    actionRef.current = { ...a, lastBar: bar, lastVal: val };
  };

  const onPointerUp = () => {
    actionRef.current = { kind: null, dragIdx: null, lastBar: 0, lastVal: 0 };
  };

  // Right-click: remove the nearest point (or the point at that bar)
  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { rawX, rawY, bar } = fromEvent(e);
    const near = nearPoint(rawX, rawY);
    if (near !== null) {
      onChange(lane.points.filter((_, i) => i !== near));
    } else {
      onChange(lane.points.filter(p => p.bar !== bar));
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: "block", cursor: "crosshair", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onContextMenu={onContextMenu}
    />
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

  // Arrangement loop region
  const loopRegion             = useArrangementStore((s) => s.loopRegion);
  const toggleLoopEnabled      = useArrangementStore((s) => s.toggleLoopEnabled);

  // Audio clip store
  const audioClips         = useAudioClipStore((s) => s.clips);
  const addAudioClip       = useAudioClipStore((s) => s.addClip);
  const removeAudioClip    = useAudioClipStore((s) => s.removeClip);
  const moveAudioClip      = useAudioClipStore((s) => s.moveClip);
  const resizeAudioClip    = useAudioClipStore((s) => s.resizeClip);
  const setTrimPoints      = useAudioClipStore((s) => s.setTrimPoints);
  const setFades           = useAudioClipStore((s) => s.setFades);
  const setAudioLoop       = useAudioClipStore((s) => s.setLoop);
  const splitClip          = useAudioClipStore((s) => s.splitClip);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  // Mixer M/S state — read from mixerBarStore for live feedback
  const mixerChannels  = useMixerBarStore((s) => s.channels);
  const setMixerMute   = useMixerBarStore((s) => s.setMute);
  const setMixerSolo   = useMixerBarStore((s) => s.setSolo);
  const setGroupMute   = useMixerBarStore((s) => s.setGroupMute);
  const groupBuses     = useMixerBarStore((s) => s.groupBuses);
  // Track → mixer channel mapping (DRUMS uses group bus, others use named channels)
  const TRACK_MIXER: Record<string, number | null> = {
    drums: null,   // uses group bus "drums"
    bass:  12,
    chords: 13,
    melody: 14,
    loops:  null,  // group bus "loops"
    audio:  27,
  };
  const [showMixer, setShowMixer]               = useState(false);

  const { lanes: autoLanes, addLane, removeLane, toggleLane, setParam: setAutoParam, setPoints } =
    useArrangementAutoStore();
  const AUTO_LANE_H = 64;

  const [arrMode, setArrMode]                 = useState<"scene" | "clips">("scene");
  const setArrangementMode                    = useDrumStore((s) => s.setArrangementMode);

  const [barPx, setBarPx]                     = useState(DEFAULT_BAR_PX);
  const [containerW, setContainerW]           = useState(0);
  const scrollAreaRef                         = useRef<HTMLDivElement>(null);
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

  // ── Dynamic row heights via ResizeObserver ──────────────────────────────────
  const [trackH, setTrackH] = useState(52);
  const [loopH,  setLoopH]  = useState(36);
  const [audioH, setAudioH] = useState(52);

  // Total open lane count across all tracks (for height computation)
  const openLaneCount = Object.values(autoLanes).reduce(
    (sum, lanes) => sum + lanes.filter((l) => l.open).length, 0,
  );

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const compute = (h: number) => {
      const avail  = Math.max(0, h - RULER_H - openLaneCount * AUTO_LANE_H);
      const totalW = TRACKS.length * TRACK_WEIGHT + N_LOOP_ROWS * LOOP_WEIGHT + AUDIO_WEIGHT;
      const unit   = avail / totalW;
      setTrackH(Math.max(MIN_TRACK_H, Math.floor(unit * TRACK_WEIGHT)));
      setLoopH (Math.max(MIN_LOOP_H,  Math.floor(unit * LOOP_WEIGHT)));
      setAudioH(Math.max(MIN_AUDIO_H, Math.floor(unit * AUDIO_WEIGHT)));
    };
    const ro = new ResizeObserver(([e]) => compute(e!.contentRect.height));
    ro.observe(el);
    compute(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [openLaneCount, AUTO_LANE_H]); // re-run when auto lanes open/close

  // Compute cumulative top offsets accounting for all open lanes per track
  let _trackTopOffset = 0;
  const trackTops: Record<string, number> = {};
  TRACKS.forEach(({ id }) => {
    trackTops[id] = _trackTopOffset;
    _trackTopOffset += trackH;
    const openHere = (autoLanes[id] ?? []).filter((l) => l.open).length;
    _trackTopOffset += openHere * AUTO_LANE_H;
  });
  const loopTops: number[] = [];
  for (let i = 0; i < N_LOOP_ROWS; i++) {
    loopTops.push(_trackTopOffset);
    _trackTopOffset += loopH;
  }
  const audioTop        = _trackTopOffset;
  const totalContentH   = _trackTopOffset + audioH;

  const totalBars     = Math.max(songChain.reduce((s, e) => s + e.repeats, 0), 32);
  const displayBars   = Math.max(totalBars, containerW > 0 ? Math.ceil(containerW / barPx) + 2 : totalBars);
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

    // Force at-least-1-bar quantize so every scene switch lands on a bar boundary.
    // This prevents mid-bar pattern switches which cause audio glitches.
    const prevQ = useSceneStore.getState().launchQuantize;
    if (prevQ === "immediate") useSceneStore.getState().setLaunchQuantize("1bar");

    const unsub = useSceneStore.subscribe((state, prev) => {
      const newScene = state.activeScene;
      if (newScene === prev.activeScene || newScene < 0) return;
      const scene = state.scenes[newScene];
      if (!scene) return;
      const bars = Math.max(1, Math.ceil((scene.drumPattern.length ?? 16) / 16));

      // Fix previous entry's repeats to the actual number of bars played.
      // barCycle is incremented at step 0 — same tick as quantized loadScene,
      // so barCycle already reflects the new bar when we read it here.
      const currentBar = useDrumStore.getState().barCycle;
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
    return () => {
      unsub();
      // Finalize the last recorded entry's repeats (never updated by a subsequent scene trigger)
      const lastBar = useDrumStore.getState().barCycle;
      const chain   = useDrumStore.getState().songChain;
      if (recBarStart.current >= 0 && chain.length > 0) {
        const actualRepeats = Math.max(1, lastBar - recBarStart.current);
        useDrumStore.getState().updateSongEntry(chain.length - 1, { repeats: actualRepeats });
      }
      // Restore quantize to what it was before recording
      if (prevQ === "immediate") useSceneStore.getState().setLaunchQuantize(prevQ);
    };
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

  // Track scrollable container width so ruler fills the viewport
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setContainerW(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    setSelectedClipId(null);
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
    await ae.resume();
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
        loop:          false,
        sampleStartSec: 0,
        sampleEndSec:   buffer.duration,
        fadeInSec:      0,
        fadeOutSec:     0,
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
          onToggleMixer={() => setShowMixer(v => !v)}
          mixerVisible={showMixer}
          loopEnabled={loopRegion.enabled}
          onToggleLoop={toggleLoopEnabled}
        />

        {/* Inner column — timeline + panels + palette; shrinks when mixer appears */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

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
              const trackColor  = TRACK_COLORS[id as keyof typeof TRACK_COLORS];
              const mixCh       = TRACK_MIXER[id];
              // Mute state: channel mute (bass/chords/melody) or group bus (drums)
              const isMuted     = id === "drums"
                ? groupBuses["drums"]?.muted ?? false
                : mixCh !== null && mixCh !== undefined
                  ? (mixerChannels[mixCh]?.muted ?? false)
                  : false;
              const isSoloed    = mixCh !== null && mixCh !== undefined
                ? (mixerChannels[mixCh]?.soloed ?? false)
                : false;

              const toggleMute = () => {
                if (id === "drums") setGroupMute("drums", !isMuted);
                else if (mixCh !== null && mixCh !== undefined) setMixerMute(mixCh, !isMuted);
              };
              const toggleSolo = () => {
                if (mixCh !== null && mixCh !== undefined) setMixerSolo(mixCh, !isSoloed);
              };

              return (
                <div key={id}>
                <div
                  className="relative flex flex-col justify-center border-b border-white/5 shrink-0 pl-3.5 pr-1.5"
                  style={{ height: trackH, gap: 5 }}
                >
                  <div
                    className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
                    style={{ backgroundColor: hexAlpha(trackColor, isMuted ? 0.2 : 0.7) }}
                  />
                  <div className="flex items-center gap-1 min-w-0">
                    <span
                      className="text-[7px] font-black tracking-[0.1em] leading-none truncate"
                      style={{ color: hexAlpha(trackColor, isMuted ? 0.25 : 0.65) }}
                    >
                      {label}
                    </span>
                    {/* + add automation lane */}
                    <button
                      onClick={(e) => { e.stopPropagation(); addLane(id); }}
                      title="Automation Lane hinzufügen"
                      className="flex-shrink-0 w-[10px] h-[10px] rounded-sm flex items-center justify-center text-[7px] transition-all"
                      style={{
                        background: "rgba(99,102,241,0.12)",
                        border: "1px solid rgba(99,102,241,0.3)",
                        color: "#818cf8",
                      }}
                    >+</button>
                  </div>
                  {/* M/S buttons */}
                  <div className="flex gap-0.5">
                    <button
                      onClick={toggleMute}
                      title="Mute"
                      className="flex-1 h-[17px] rounded text-[6px] font-black transition-all"
                      style={{
                        background: isMuted ? "#ef444426" : "rgba(255,255,255,0.04)",
                        border:     `1px solid ${isMuted ? "#ef4444aa" : "rgba(255,255,255,0.08)"}`,
                        color:      isMuted ? "#ef4444" : "rgba(255,255,255,0.3)",
                      }}
                    >M</button>
                    <button
                      onClick={toggleSolo}
                      title="Solo"
                      className="flex-1 h-[17px] rounded text-[6px] font-black transition-all"
                      style={{
                        background: isSoloed ? "#f59e0b26" : "rgba(255,255,255,0.04)",
                        border:     `1px solid ${isSoloed ? "#f59e0baa" : "rgba(255,255,255,0.08)"}`,
                        color:      isSoloed ? "#f59e0b" : "rgba(255,255,255,0.3)",
                      }}
                    >S</button>
                  </div>
                </div>
                {/* Automation lane label rows — one per lane */}
                {(autoLanes[id] ?? []).map((lane) => (
                  <div
                    key={lane.id}
                    className="relative flex items-center border-b border-white/5 shrink-0 pl-3.5 pr-1.5"
                    style={{ height: AUTO_LANE_H, background: "rgba(99,102,241,0.03)" }}
                  >
                    <div className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-[#6366f1]/40" />
                    {/* Collapse toggle */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleLane(id, lane.id); }}
                      className="flex-shrink-0 w-[10px] h-[10px] rounded-sm flex items-center justify-center text-[7px] mr-1 transition-all"
                      style={{
                        background: lane.open ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${lane.open ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.1)"}`,
                        color: lane.open ? "#818cf8" : "rgba(255,255,255,0.3)",
                      }}
                    >{lane.open ? "▾" : "▸"}</button>
                    <span className="text-[6px] font-black tracking-[0.14em] text-[#818cf8]/60 flex-1">
                      AUTO
                    </span>
                    <div className="flex items-center gap-1">
                      <select
                        value={lane.param}
                        onChange={(e) => setAutoParam(id, lane.id, e.target.value as AutoParam)}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[6px] font-black tracking-[0.08em] rounded-md px-1 py-0.5 cursor-pointer"
                        style={{
                          background: "rgba(99,102,241,0.15)",
                          border: "1px solid rgba(99,102,241,0.35)",
                          color: "#818cf8",
                          outline: "none",
                        }}
                      >
                        {(TRACK_AUTO_PARAMS[id] ?? TRACK_AUTO_PARAMS["melody"]!).map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      {/* Clear points */}
                      {lane.points.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPoints(id, lane.id, []); }}
                          title="Punkte löschen"
                          className="text-[6px] font-black rounded px-1 py-0.5 transition-all"
                          style={{
                            background: "rgba(239,68,68,0.12)",
                            border:     "1px solid rgba(239,68,68,0.3)",
                            color:      "rgba(239,68,68,0.7)",
                          }}
                        >✕</button>
                      )}
                      {/* Remove lane */}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeLane(id, lane.id); }}
                        title="Lane entfernen"
                        className="text-[6px] font-black rounded px-1 py-0.5 transition-all"
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          border:     "1px solid rgba(255,255,255,0.1)",
                          color:      "rgba(255,255,255,0.3)",
                        }}
                      >—</button>
                    </div>
                  </div>
                ))}
                </div>
              );
            })}
            {Array.from({ length: N_LOOP_ROWS }, (_, si) => {
              const loopCh    = 16 + si;
              const isLMuted  = mixerChannels[loopCh]?.muted  ?? false;
              const isLSoloed = mixerChannels[loopCh]?.soloed ?? false;
              return (
                <div key={si}
                  className="relative border-b border-white/5 shrink-0 pl-3 pr-1"
                  style={{ height: loopH, display: "flex", alignItems: "center", gap: 4 }}
                >
                  <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
                    style={{ backgroundColor: hexAlpha(LOOP_COLOR, isLMuted ? 0.15 : 0.6) }} />
                  <span className="text-[7px] font-black tracking-[0.08em] leading-none flex-1 min-w-0 truncate"
                    style={{ color: hexAlpha(LOOP_COLOR, isLMuted ? 0.2 : 0.6) }}>
                    {si === 0 ? "LP 1" : `LP ${si + 1}`}
                  </span>
                  <div className="flex gap-px shrink-0">
                    <button onClick={() => setMixerMute(loopCh, !isLMuted)} title="Mute"
                      className="rounded text-[6px] font-black transition-all flex items-center justify-center"
                      style={{ width: 16, height: 16,
                        background: isLMuted ? "#ef444420" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${isLMuted ? "#ef4444aa" : "rgba(255,255,255,0.08)"}`,
                        color: isLMuted ? "#ef4444" : "rgba(255,255,255,0.3)" }}>M</button>
                    <button onClick={() => setMixerSolo(loopCh, !isLSoloed)} title="Solo"
                      className="rounded text-[6px] font-black transition-all flex items-center justify-center"
                      style={{ width: 16, height: 16,
                        background: isLSoloed ? "#f59e0b20" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${isLSoloed ? "#f59e0baa" : "rgba(255,255,255,0.08)"}`,
                        color: isLSoloed ? "#f59e0b" : "rgba(255,255,255,0.3)" }}>S</button>
                  </div>
                </div>
              );
            })}
            {/* AUDIO track label */}
            <div
              className="relative flex flex-col justify-center border-b border-white/5 shrink-0 pl-3.5 pr-1.5"
              style={{ height: audioH, gap: 5 }}
            >
              <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
                style={{ backgroundColor: hexAlpha(AUDIO_COLOR, (mixerChannels[27]?.muted) ? 0.2 : 0.7) }} />
              {/* Label + upload icon inline */}
              <div className="flex items-center gap-1.5">
                <span className="text-[7px] font-black tracking-[0.1em] leading-none"
                  style={{ color: hexAlpha(AUDIO_COLOR, (mixerChannels[27]?.muted) ? 0.25 : 0.65) }}>
                  AUDIO
                </span>
                <label className="w-[14px] h-[14px] rounded flex items-center justify-center cursor-pointer hover:bg-white/10 transition-colors"
                  style={{ color: hexAlpha(AUDIO_COLOR, 0.5) }} title="Import audio file">
                  <input type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a" className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      e.target.value = "";
                      const { audioEngine: ae } = await import("../audio/AudioEngine");
                      await ae.resume();
                      const ctx = ae.getAudioContext();
                      if (!ctx) return;
                      try {
                        const buf   = await ctx.decodeAudioData(await file.arrayBuffer());
                        const spb   = (60.0 / bpm) * 4;
                        const peaks = computeWaveformPeaks(buf);
                        addAudioClip({
                          id: `ac-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                          startBar: 0, durationBars: Math.max(0.5, buf.duration / spb),
                          fileName: file.name, buffer: buf, waveformPeaks: peaks,
                          volume: 1, color: AUDIO_COLOR, loop: false,
                          sampleStartSec: 0, sampleEndSec: buf.duration,
                          fadeInSec: 0, fadeOutSec: 0,
                        });
                      } catch (err) { console.warn("AudioClip decode failed:", err); }
                    }} />
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M6 1L6 8M6 1L3.5 3.5M6 1L8.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                    <path d="M1 9.5V11h10V9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                  </svg>
                </label>
              </div>
              {/* M/S buttons */}
              <div className="flex gap-0.5">
                <button onClick={() => setMixerMute(27, !(mixerChannels[27]?.muted))} title="Mute"
                  className="flex-1 h-[17px] rounded text-[6px] font-black transition-all"
                  style={{
                    background: (mixerChannels[27]?.muted) ? "#ef444426" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${(mixerChannels[27]?.muted) ? "#ef4444aa" : "rgba(255,255,255,0.08)"}`,
                    color: (mixerChannels[27]?.muted) ? "#ef4444" : "rgba(255,255,255,0.3)",
                  }}>M</button>
                <button onClick={() => setMixerSolo(27, !(mixerChannels[27]?.soloed))} title="Solo"
                  className="flex-1 h-[17px] rounded text-[6px] font-black transition-all"
                  style={{
                    background: (mixerChannels[27]?.soloed) ? "#f59e0b26" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${(mixerChannels[27]?.soloed) ? "#f59e0baa" : "rgba(255,255,255,0.08)"}`,
                    color: (mixerChannels[27]?.soloed) ? "#f59e0b" : "rgba(255,255,255,0.3)",
                  }}>S</button>
              </div>
            </div>
          </div>

          {/* Scrollable area */}
          <div className="relative flex-1 overflow-x-auto overflow-y-hidden" ref={scrollAreaRef}>

            {/* Ruler */}
            <div
              className="sticky top-0 z-20 relative select-none overflow-hidden"
              style={{
                height: RULER_H,
                minWidth: displayBars * barPx,
                background: "linear-gradient(180deg, rgba(20,22,30,0.98) 0%, rgba(12,14,20,0.98) 100%)",
                borderBottom: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
              }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleSceneDrop(e)}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).dataset.loopHandle) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const bar  = Math.floor((e.clientX - rect.left) / barPx);
                setLoopStart(bar);
                setLoopEnd(bar + 1);
                loopDragRef.current = { handle: "end", startX: e.clientX, startBar: bar + 1 };
              }}
            >
              {/* Bar + beat tick marks */}
              <div className="absolute inset-0 flex pointer-events-none">
                {Array.from({ length: displayBars }, (_, i) => (
                  <div
                    key={i}
                    className="relative shrink-0 flex items-end pb-px"
                    style={{ width: barPx, minWidth: barPx, borderRight: "1px solid rgba(255,255,255,0.12)" }}
                  >
                    {/* Bar number */}
                    <span
                      className="absolute left-1 top-1 text-[8px] font-bold font-mono leading-none"
                      style={{ color: i % 4 === 0 ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.35)" }}
                    >
                      {i + 1}
                    </span>
                    {/* Beat sub-ticks (3 lines at 1/4, 2/4, 3/4 of the bar) */}
                    {barPx >= 32 && [1, 2, 3].map(beat => (
                      <div
                        key={beat}
                        className="absolute bottom-0"
                        style={{
                          left:   (beat / 4) * barPx,
                          width:  1,
                          height: beat === 2 ? 6 : 4,
                          backgroundColor: `rgba(255,255,255,${beat === 2 ? 0.18 : 0.1})`,
                        }}
                      />
                    ))}
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
              style={{
                minWidth: displayBars * barPx,
                height:   totalContentH,
              }}
              onPointerMove={handleContentPointerMove}
              onPointerUp={handleContentPointerUp}
              onPointerCancel={() => setMoveDrag(null)}
            >

              {/* Grid backgrounds */}
              {[
                ...TRACKS.flatMap(({ id }) => {
                  const rows: { top: number; h: number }[] = [{ top: trackTops[id]!, h: trackH }];
                  (autoLanes[id] ?? []).forEach((lane, li) => {
                    if (lane.open) rows.push({ top: trackTops[id]! + trackH + li * AUTO_LANE_H, h: AUTO_LANE_H });
                  });
                  return rows;
                }),
                ...loopTops.map((top) => ({ top, h: loopH })),
                { top: audioTop, h: audioH },
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
                return (
                  <div
                    className="absolute top-0 pointer-events-none z-30"
                    style={{
                      left: x - 1,
                      width: 2,
                      height: totalContentH,
                      backgroundColor: "rgba(255,255,255,0.6)",
                      boxShadow: "0 0 6px rgba(255,255,255,0.4)",
                    }}
                  />
                );
              })()}

              {/* Instrument rows */}
              {TRACKS.map(({ id }, trackIndex) => (
                <div key={id}>
                <div
                  className="absolute left-0 flex"
                  style={{ top: trackTops[id], height: trackH }}
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
                        height={trackH}
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
                      style={{ height: trackH - 12, minWidth: 300 }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleSceneDrop(e)}
                    >
                      <span className="text-[9px] text-white/20 font-bold tracking-wider whitespace-nowrap">
                        Drag scenes here · or press REC and trigger scenes live
                      </span>
                    </div>
                  )}
                </div>
                {/* Automation lane canvases — one per open lane */}
                {(autoLanes[id] ?? []).map((lane, li) => lane.open && (
                  <div
                    key={lane.id}
                    className="absolute left-0 right-0"
                    style={{
                      top:          trackTops[id]! + trackH + li * AUTO_LANE_H,
                      height:       AUTO_LANE_H,
                      background:   "rgba(99,102,241,0.025)",
                      borderBottom: "1px solid rgba(99,102,241,0.12)",
                    }}
                  >
                    <AutoLaneCanvas
                      lane={lane}
                      totalBars={displayBars}
                      barPx={barPx}
                      height={AUTO_LANE_H}
                      color="#6366f1"
                      onChange={(pts) => setPoints(id, lane.id, pts)}
                    />
                  </div>
                ))}
                </div>
              ))}

              {/* Loop lanes — one row per slot */}
              {Array.from({ length: N_LOOP_ROWS }, (_, si) => (
                <div
                  key={si}
                  className="absolute left-0 flex"
                  style={{ top: loopTops[si], height: loopH }}
                >
                  <ArrangementLoopLane
                    songChain={songChain}
                    scenes={scenes}
                    barPx={barPx}
                    height={loopH}
                    slotIndex={si}
                    songPosition={songPosition}
                    songMode={songMode}
                    selected={selected}
                    onSelect={(i, multi) => selectEntry(i, "loops", multi)}
                    onDragOver={() => {}}
                    onDrop={(e, i) => handleSceneDrop(e, i)}
                  />
                </div>
              ))}

              {/* AUDIO clip lane */}
              <div
                className="absolute left-0"
                style={{ top: audioTop }}
              >
                <AudioClipLane
                  clips={audioClips}
                  barPx={barPx}
                  height={audioH}
                  totalBars={displayBars}
                  selectedId={selectedClipId}
                  onRemove={(id) => { removeAudioClip(id); setSelectedClipId(null); }}
                  onMove={moveAudioClip}
                  onResize={resizeAudioClip}
                  onDrop={handleAudioFileDrop}
                  onSelect={setSelectedClipId}
                  onLoop={setAudioLoop}
                  onTrimPoints={setTrimPoints}
                  onSplit={(id, atSec) => {
                    const secPerBar = (60 / bpm) * 4;
                    splitClip(id, atSec, secPerBar);
                    setSelectedClipId(null);
                  }}
                />
              </div>

              {/* Loop-brace overlay on track area */}
              {loopStart !== null && loopEnd !== null && (
                <div
                  className="absolute top-0 pointer-events-none z-10"
                  style={{
                    left:   loopStart * barPx,
                    width:  (loopEnd - loopStart) * barPx,
                    height: totalContentH,
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
                    height:          totalContentH,
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
          selectedAudioClip={audioClips.find((c) => c.id === selectedClipId) ?? null}
          onAudioTrimPoints={setTrimPoints}
          onAudioFades={setFades}
          onAudioVolume={(id, vol) => useAudioClipStore.getState().setVolume(id, vol)}
          onAudioSplit={(id) => {
            const secPerBar = (60 / bpm) * 4;
            const clip = audioClips.find((c) => c.id === id);
            if (!clip) return;
            splitClip(id, (clip.sampleStartSec + clip.sampleEndSec) / 2, secPerBar);
            setSelectedClipId(null);
          }}
          onAudioRemove={(id) => { removeAudioClip(id); setSelectedClipId(null); }}
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

        </div>{/* end inner column */}

        {/* Embedded mixer — outside inner column so it doesn't clip */}
        {showMixer && (
          <div className="shrink-0 border-t border-white/8 overflow-hidden">
            <MixerBar embedded />
          </div>
        )}

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
