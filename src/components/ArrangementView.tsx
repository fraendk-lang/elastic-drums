/**
 * Arrangement View v3 — DAW-grade 5-lane multi-track sequencer
 *
 * Lanes: DRUMS · BASS · CHORDS · MELODY · LOOPS
 * Interactions: click-select, drag-reorder, alt-drag copy, edge-resize, context menu
 * Keyboard: D dup · Del delete · ⌘C copy · ⌘V paste · ←→ move · −/+ resize · C colour · F2 rename
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useDrumStore, type SongChainEntry, drumCurrentStepStore } from "../store/drumStore";
import { useSceneStore, type Scene } from "../store/sceneStore";
import {
  SCENE_COLORS, LOOP_COLOR, getEntryColor, getEntryLabel, hexAlpha,
} from "../utils/arrangementColors";
import { drumWaveformBars, bassWaveformBars } from "../utils/waveformMini";

// ─── Layout constants ─────────────────────────────────────────────────────────

const LABEL_W        = 68;
const TRACK_H        = 52;
const LOOP_H         = 36;
const RULER_H        = 22;
const MIN_BAR_PX     = 16;
const MAX_BAR_PX     = 120;
const DEFAULT_BAR_PX = 40;
const MAX_REPEATS    = 16;
const MIN_REPEATS    = 1;

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
  isDragging:     boolean;
  isDropTarget:   boolean;
  isRenaming:     boolean;
  renameValue:    string;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onSelect:       (multi: boolean) => void;
  onContextMenu:  (e: React.MouseEvent) => void;
  onDragStart:    (e: React.DragEvent) => void;
  onDragEnd:      () => void;
  onDragOver:     () => void;
  onDrop:         (e: React.DragEvent) => void;
  onResizeStart:  (e: React.PointerEvent) => void;
}

function ArrangementClip({
  entry, trackId, scene, color, label, width, height,
  isFirstTrack, isLastTrack, isActive, progress,
  isSelected, isDragging, isDropTarget,
  isRenaming, renameValue, renameInputRef,
  onRenameChange, onRenameCommit,
  onSelect, onContextMenu,
  onDragStart, onDragEnd, onDragOver, onDrop,
  onResizeStart,
}: ArrangementClipProps) {

  // Waveform bars (drums + bass only)
  const waveformBars = (() => {
    if (trackId === "drums" && scene) {
      const steps = scene.drumPattern.tracks.slice(0, 4).flatMap(t =>
        t.steps.slice(0, Math.min(scene.drumPattern.length ?? 16, 32))
      );
      return drumWaveformBars(steps, entry.sceneIndex);
    }
    if (trackId === "bass" && scene) {
      return bassWaveformBars(
        scene.bassSteps.slice(0, Math.min(scene.bassLength, 32))
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

  return (
    <div
      className="relative overflow-hidden border-b border-black/20 select-none"
      style={{
        width, minWidth: width, height,
        backgroundColor: hexAlpha(color, isActive ? 0.28 : 0.14),
        borderRight:     "1px solid rgba(0,0,0,0.25)",
        borderRadius,
        opacity:         isDragging ? 0.35 : 1,
        outline:         isDropTarget ? "2px solid rgba(255,255,255,0.4)"
                       : isSelected  ? `2px solid ${hexAlpha(color, 0.8)}`
                       : "none",
        outlineOffset: "-1px",
        cursor: "grab",
      }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDrop={onDrop}
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

      {/* Waveform mini */}
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

// ─── ArrangementLoopLane ──────────────────────────────────────────────────────

interface ArrangementLoopLaneProps {
  songChain:    SongChainEntry[];
  scenes:       (Scene | null)[];
  barPx:        number;
  height:       number;
  songPosition: number;
  songMode:     string;
  selected:     Set<number>;
  onSelect:     (i: number, multi: boolean) => void;
  onDragOver:   (i: number) => void;
  onDrop:       (e: React.DragEvent, i: number) => void;
}

function ArrangementLoopLane({
  songChain, scenes, barPx, height,
  songPosition, songMode, selected,
  onSelect, onDragOver, onDrop,
}: ArrangementLoopLaneProps) {
  return (
    <>
      {songChain.map((entry, i) => {
        const scene = scenes[entry.sceneIndex] ?? null;
        // LoopSceneState has no fileName — display as "L1", "L2", etc.
        const activeSlots = (scene?.loopSlots ?? [])
          .map((s, idx) => ({ playing: s.playing, idx }))
          .filter(s => s.playing);
        const w        = entry.repeats * barPx;
        const isActive = songMode === "song" && i === songPosition;
        const isSel    = selected.has(i);

        return (
          <div
            key={i}
            className="relative overflow-hidden border-r border-b border-black/20 flex items-center gap-1 px-1"
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
              <span className="text-[6px] text-white/12">—</span>
            ) : (
              <>
                {activeSlots.slice(0, 3).map(({ idx }) => (
                  <span
                    key={idx}
                    className={`text-[6px] font-bold px-1 py-0.5 rounded ${isActive ? "animate-pulse" : ""}`}
                    style={{
                      backgroundColor: hexAlpha(LOOP_COLOR, 0.2),
                      color:           hexAlpha(LOOP_COLOR, 0.9),
                    }}
                  >
                    ● L{idx + 1}
                  </span>
                ))}
                {activeSlots.length > 3 && (
                  <span className="text-[6px]" style={{ color: hexAlpha(LOOP_COLOR, 0.5) }}>
                    +{activeSlots.length - 3}
                  </span>
                )}
              </>
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
  selected:           Set<number>;
  showColorPicker:    number | null;
  setShowColorPicker: (i: number | null) => void;
  onUpdateEntry:      (i: number, patch: Partial<SongChainEntry>) => void;
  onUpdateRepeats:    (i: number, repeats: number) => void;
  onStartRename:      (i: number) => void;
  onRemove:           (i: number) => void;
}

function ArrangementDetailPanel({
  songChain, scenes, selected,
  showColorPicker, setShowColorPicker,
  onUpdateEntry, onUpdateRepeats, onStartRename, onRemove,
}: ArrangementDetailPanelProps) {
  const primary = selected.size > 0 ? [...selected][0]! : null;
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
}

function ArrangementStatusBar({
  chainLength, totalBars, songMode, setSongMode,
  isRecording, setIsRecording, recCount,
  barPx, setBarPx, onClear, onClose,
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

  const [barPx, setBarPx]                     = useState(DEFAULT_BAR_PX);
  const [selected, setSelected]               = useState<Set<number>>(new Set());
  const [dragIndex, setDragIndex]             = useState<number | null>(null);
  const [dropIndex, setDropIndex]             = useState<number | null>(null);
  const [isDragCopy, setIsDragCopy]           = useState(false);
  const [clipboard, setClipboard]             = useState<SongChainEntry | null>(null);
  const [contextMenu, setContextMenu]         =
    useState<{ x: number; y: number; index: number } | null>(null);
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

  const resizingRef    = useRef<{ index: number; startX: number; startRepeats: number } | null>(null);
  const lastRecScene   = useRef<number>(-1);
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
    if (!isRecording) { lastRecScene.current = -1; return; }
    setRecCount(0);
    const unsub = useSceneStore.subscribe((state, prev) => {
      const newScene = state.activeScene;
      if (newScene === prev.activeScene || newScene < 0) return;
      const scene = state.scenes[newScene];
      if (!scene) return;
      const bars = Math.max(1, Math.ceil((scene.drumPattern.length ?? 16) / 16));
      useDrumStore.getState().addToSongChain(newScene, bars);
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
      const primary = selected.size > 0 ? [...selected][0]! : null;

      if (e.key === "Escape") {
        if (contextMenu) { setContextMenu(null); return; }
        setSelected(new Set());
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.size === 0) return;
        e.preventDefault();
        [...selected].sort((a, b) => b - a).forEach(i => removeFromSongChain(i));
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
        setSelected(new Set([primary + 1]));
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
        setSelected(new Set([after + 1]));
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
        setSelected(new Set([primary - 1]));
        return;
      }

      if (e.key === "ArrowRight") {
        if (primary === null) return;
        e.preventDefault();
        if (primary >= useDrumStore.getState().songChain.length - 1) return;
        moveSongEntry(primary, primary + 1);
        setSelected(new Set([primary + 1]));
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

  // Selection helper
  const selectEntry = useCallback((index: number, multi: boolean) => {
    setContextMenu(null);
    if (multi) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index); else next.add(index);
        return next;
      });
    } else {
      setSelected(prev =>
        prev.size === 1 && prev.has(index) ? new Set() : new Set([index])
      );
    }
  }, []);

  const openContextMenu = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    setSelected(new Set([index]));
    setContextMenu({ x: e.clientX, y: e.clientY, index });
  }, []);

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
    setDropIndex(null);
    setDragIndex(null);
  }, [addToSongChain, moveSongEntry]);

  const handleEntryDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const fromStr = e.dataTransfer.getData("entryIndex");
    if (fromStr !== "") {
      const from = parseInt(fromStr);
      if (!isNaN(from) && from !== toIndex) {
        if (isDragCopy) {
          const entry = useDrumStore.getState().songChain[from];
          if (entry) {
            addToSongChain(entry.sceneIndex, entry.repeats);
            moveSongEntry(useDrumStore.getState().songChain.length - 1, toIndex);
            if (entry.color || entry.label) {
              updateSongEntry(toIndex, { color: entry.color, label: entry.label });
            }
          }
        } else {
          moveSongEntry(from, toIndex);
        }
        setSelected(new Set([toIndex]));
      }
    } else {
      handleSceneDrop(e, toIndex);
    }
    setDragIndex(null);
    setDropIndex(null);
    setIsDragCopy(false);
  }, [isDragCopy, addToSongChain, moveSongEntry, updateSongEntry, handleSceneDrop]);

  const commitRename = useCallback(() => {
    if (renamingIndex === null) return;
    updateSongEntry(renamingIndex, { label: renameValue.trim() || undefined });
    setRenamingIndex(null);
  }, [renamingIndex, renameValue, updateSongEntry]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="flex flex-col bg-[linear-gradient(180deg,rgba(14,15,20,0.99),rgba(8,9,13,0.99))] border border-white/10 rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.6)] w-[98vw] max-w-[1400px] max-h-[90vh] overflow-hidden"
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
        />

        {/* Timeline */}
        <div className="flex flex-1 min-h-0 overflow-hidden" ref={timelineRef}>

          {/* Track labels */}
          <div className="shrink-0 border-r border-white/8 flex flex-col" style={{ width: LABEL_W }}>
            <div style={{ height: RULER_H }} className="border-b border-white/8 shrink-0" />
            {TRACKS.map(({ id, label }) => (
              <div
                key={id}
                className="flex items-center justify-center border-b border-white/5 shrink-0"
                style={{ height: TRACK_H }}
              >
                <span className="text-[8px] font-black tracking-[0.18em] text-white/35">{label}</span>
              </div>
            ))}
            <div
              className="flex items-center justify-center border-b border-white/5 shrink-0"
              style={{ height: LOOP_H }}
            >
              <span
                className="text-[8px] font-black tracking-[0.18em]"
                style={{ color: hexAlpha(LOOP_COLOR, 0.6) }}
              >
                LOOPS
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
            <div className="relative" style={{ minWidth: totalBars * barPx }}>

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
                        isSelected={selected.has(clipIndex)}
                        isDragging={dragIndex === clipIndex}
                        isDropTarget={dropIndex === clipIndex && dragIndex !== clipIndex}
                        isRenaming={renamingIndex === clipIndex && trackIndex === 0}
                        renameValue={renameValue}
                        renameInputRef={trackIndex === 0 ? renameInputRef : undefined}
                        onRenameChange={setRenameValue}
                        onRenameCommit={commitRename}
                        onSelect={(multi) => selectEntry(clipIndex, multi)}
                        onContextMenu={(e) => openContextMenu(e, clipIndex)}
                        onDragStart={(e) => {
                          setDragIndex(clipIndex);
                          setIsDragCopy(e.altKey);
                          e.dataTransfer.setData("entryIndex", String(clipIndex));
                          e.dataTransfer.effectAllowed = e.altKey ? "copy" : "move";
                        }}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDropIndex(null);
                          setIsDragCopy(false);
                        }}
                        onDragOver={() => setDropIndex(clipIndex)}
                        onDrop={(e) => handleEntryDrop(e, clipIndex)}
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
                  onSelect={(i, multi) => selectEntry(i, multi)}
                  onDragOver={(i) => setDropIndex(i)}
                  onDrop={(e, i) => handleEntryDrop(e, i)}
                />
              </div>

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

        {/* Detail panel */}
        <ArrangementDetailPanel
          songChain={songChain}
          scenes={scenes}
          selected={selected}
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
              setSelected(new Set([contextMenu.index + 1]));
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
              setSelected(new Set([contextMenu.index + 1]));
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
              removeFromSongChain(contextMenu.index);
              setSelected(new Set());
              setContextMenu(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
