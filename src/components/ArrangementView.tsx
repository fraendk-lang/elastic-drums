/**
 * Arrangement View v2 — Ableton-style multi-track timeline
 *
 * 4 colour-coded track rows (DRUMS / BASS / CHORDS / MELODY) × scene blocks.
 * Features: zoom, animated playhead, drag-to-reorder, REC mode, scene palette.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDrumStore } from "../store/drumStore";
import { useSceneStore, type Scene } from "../store/sceneStore";

interface ArrangementViewProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TRACKS = [
  { id: "drums",  label: "DRUMS",  color: "#f59e0b", bg: "rgba(245,158,11,0.18)",  activeBg: "rgba(245,158,11,0.32)"  },
  { id: "bass",   label: "BASS",   color: "#10b981", bg: "rgba(16,185,129,0.18)",  activeBg: "rgba(16,185,129,0.32)"  },
  { id: "chords", label: "CHORDS", color: "#8b5cf6", bg: "rgba(139,92,246,0.18)",  activeBg: "rgba(139,92,246,0.32)"  },
  { id: "melody", label: "MELODY", color: "#f472b6", bg: "rgba(244,114,182,0.18)", activeBg: "rgba(244,114,182,0.32)" },
] as const;

const LABEL_W  = 68;  // px — track label column width
const TRACK_H  = 56;  // px — height of each track row
const RULER_H  = 20;  // px — bar ruler height
const DEFAULT_BAR_PX = 36;

// ─── Mini-map helpers ────────────────────────────────────────────────────────

function DrumMinimap({ scene, color }: { scene: Scene; color: string }) {
  const tracks = scene.drumPattern.tracks.slice(0, 6);
  const cols   = Math.min(scene.drumPattern.length ?? 16, 16);
  return (
    <div className="absolute inset-1 flex flex-col gap-[1px] pointer-events-none overflow-hidden">
      {tracks.map((track, ti) => (
        <div key={ti} className="flex gap-[1px] flex-1">
          {Array.from({ length: cols }, (_, si) => {
            const step = track.steps[si];
            return (
              <div
                key={si}
                className="flex-1 rounded-[1px] transition-none"
                style={{ backgroundColor: step?.active ? color : "rgba(255,255,255,0.05)" }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function NoteMinimap({ steps, length, color }: { steps: { active: boolean }[]; length: number; color: string }) {
  const visible = steps.slice(0, Math.min(length, 32));
  const hasNotes = visible.some(s => s.active);
  if (!hasNotes) {
    return (
      <div className="absolute inset-1 flex items-center justify-center pointer-events-none">
        <span style={{ color: `${color}44` }} className="text-[7px] font-bold tracking-wider">—</span>
      </div>
    );
  }
  return (
    <div className="absolute inset-1 flex items-end gap-[1px] pointer-events-none overflow-hidden">
      {visible.map((step, i) => (
        <div
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            minWidth: 2,
            height:   step.active ? "72%" : "8%",
            backgroundColor: step.active ? color : "rgba(255,255,255,0.05)",
          }}
        />
      ))}
    </div>
  );
}

// ─── Single scene block across all tracks ────────────────────────────────────

interface SceneBlockProps {
  entry:       { sceneIndex: number; repeats: number; tempoBpm?: number };
  index:       number;
  scene:       Scene | null;
  barPx:       number;
  isActive:    boolean;
  progress:    number; // 0-1 within this entry
  isDragging:  boolean;
  isDropTarget:boolean;
  isSelected:  boolean;
  onSelect:    () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd:   () => void;
  onDragOver:  (e: React.DragEvent) => void;
  onDrop:      (e: React.DragEvent) => void;
  onRepeat:    (delta: number) => void;
  onRemove:    () => void;
}

function SceneBlock({ entry, scene, barPx, isActive, progress, isDragging, isDropTarget, isSelected, onSelect, onDragStart, onDragEnd, onDragOver, onDrop, onRepeat, onRemove }: SceneBlockProps) {
  const w = entry.repeats * barPx;

  return (
    <div
      className="relative flex border-r border-black/20 select-none"
      style={{
        width: w, minWidth: w,
        opacity: isDragging ? 0.35 : 1,
        outline: isDropTarget ? "2px solid rgba(255,255,255,0.5)" : isSelected ? "2px solid rgba(255,255,255,0.25)" : "none",
        cursor: "pointer",
      }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e); }}
      onDrop={onDrop}
      onClick={onSelect}
    >
      {TRACKS.map(({ id, color, bg, activeBg }) => {
        const trackBg = isActive ? activeBg : bg;
        return (
          <div
            key={id}
            className="relative overflow-hidden border-b border-black/15"
            style={{ width: w, minWidth: w, height: TRACK_H, backgroundColor: trackBg }}
          >
            {/* Active progress overlay */}
            {isActive && (
              <div
                className="absolute top-0 left-0 bottom-0 pointer-events-none"
                style={{ width: `${progress * 100}%`, backgroundColor: `${color}22` }}
              />
            )}

            {/* Pattern mini-map */}
            {scene && id === "drums"  && <DrumMinimap scene={scene} color={color} />}
            {scene && id === "bass"   && <NoteMinimap steps={scene.bassSteps}   length={scene.bassLength}   color={color} />}
            {scene && id === "chords" && <NoteMinimap steps={scene.chordsSteps} length={scene.chordsLength} color={color} />}
            {scene && id === "melody" && <NoteMinimap steps={scene.melodySteps} length={scene.melodyLength} color={color} />}

            {/* Scene label only on first (drums) row */}
            {id === "drums" && (
              <div className="absolute bottom-1 left-0 right-0 text-center pointer-events-none">
                <span
                  className="text-[8px] font-black tracking-wider truncate px-1"
                  style={{ color: `${color}cc` }}
                >
                  {scene?.name ?? `#${entry.sceneIndex + 1}`}
                </span>
                {entry.tempoBpm && (
                  <span className="ml-1 text-[7px] font-mono" style={{ color: `${color}88` }}>
                    {entry.tempoBpm}♩
                  </span>
                )}
              </div>
            )}

            {/* Repeat count badge on drums row top-right */}
            {id === "drums" && (
              <div className="absolute top-0.5 right-0 flex flex-col items-end z-10">
                <button
                  onClick={(e) => { e.stopPropagation(); onRepeat(1); }}
                  className="w-3.5 h-3.5 text-[8px] leading-none hover:bg-black/30 rounded transition-colors"
                  style={{ color: `${color}99` }}
                >+</button>
                <span className="text-[7px] font-black leading-none px-0.5" style={{ color: `${color}99` }}>×{entry.repeats}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRepeat(-1); }}
                  className="w-3.5 h-3.5 text-[8px] leading-none hover:bg-black/30 rounded transition-colors"
                  style={{ color: `${color}99` }}
                >−</button>
              </div>
            )}

            {/* Delete × on melody row bottom-right */}
            {id === "melody" && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 text-[8px] leading-none text-white/20 hover:text-red-400 hover:bg-black/30 rounded transition-colors z-10"
              >×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function ArrangementView({ isOpen, onClose }: ArrangementViewProps) {
  const songChain           = useDrumStore((s) => s.songChain);
  const songPosition        = useDrumStore((s) => s.songPosition);
  const songRepeatCount     = useDrumStore((s) => s.songRepeatCount);
  const songMode            = useDrumStore((s) => s.songMode);
  const setSongMode         = useDrumStore((s) => s.setSongMode);
  const addToSongChain      = useDrumStore((s) => s.addToSongChain);
  const removeFromSongChain = useDrumStore((s) => s.removeFromSongChain);
  const updateSongEntryRepeats = useDrumStore((s) => s.updateSongEntryRepeats);
  const moveSongEntry       = useDrumStore((s) => s.moveSongEntry);
  const setSongPosition     = useDrumStore((s) => s.setSongPosition);
  const clearSongChain      = useDrumStore((s) => s.clearSongChain);
  const updateSongEntry     = useDrumStore((s) => s.updateSongEntry);

  const scenes              = useSceneStore((s) => s.scenes);

  const [barPx, setBarPx]         = useState(DEFAULT_BAR_PX);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [selected, setSelected]   = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recCount, setRecCount]   = useState(0); // # entries recorded this session

  const timelineRef = useRef<HTMLDivElement>(null);
  const lastRecScene = useRef<number>(-1);

  // ── Keyboard shortcut ──
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Delete" && selected !== null) {
        removeFromSongChain(selected);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, selected, removeFromSongChain]);

  // ── Ctrl+Scroll zoom ──
  useEffect(() => {
    if (!isOpen) return;
    const el = timelineRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setBarPx(px => Math.max(16, Math.min(MAX_BAR_PX, px - Math.sign(e.deltaY) * 4)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isOpen]);

  // ── REC mode: watch for scene changes and append to chain ──
  useEffect(() => {
    if (!isRecording) { lastRecScene.current = -1; return; }
    setRecCount(0);

    const unsub = useSceneStore.subscribe((state, prev) => {
      const newScene = state.activeScene;
      if (newScene === prev.activeScene || newScene < 0) return;
      const scene = state.scenes[newScene];
      if (!scene) return;

      // Duration: derive from drum pattern length (steps → bars at 16 steps/bar, min 1)
      const bars = Math.max(1, Math.ceil((scene.drumPattern.length ?? 16) / 16));
      // Use getState() to avoid stale closure — addToSongChain must NOT be in deps
      useDrumStore.getState().addToSongChain(newScene, bars);
      lastRecScene.current = newScene;
      setRecCount(c => c + 1);
    });

    return () => unsub();
  }, [isRecording]); // addToSongChain intentionally omitted — using getState() above

  // ── Playhead position in px ──
  const playheadBarOffset = songChain
    .slice(0, songPosition)
    .reduce((sum, e) => sum + e.repeats, 0) + songRepeatCount;
  const playheadPx = playheadBarOffset * barPx;

  // ── Total bars ──
  const totalBars = Math.max(songChain.reduce((s, e) => s + e.repeats, 0), 32);

  // ── Ruler bar numbers ──
  const rulerBars = Array.from({ length: totalBars }, (_, i) => i);

  // ── Drag & drop handlers ──
  const handleSceneDrop = useCallback((e: React.DragEvent, atIndex?: number) => {
    e.preventDefault();
    const sceneIdx = parseInt(e.dataTransfer.getData("sceneIndex"));
    if (!isNaN(sceneIdx)) {
      const scene = useSceneStore.getState().scenes[sceneIdx];
      const bars = scene ? Math.max(1, Math.ceil((scene.drumPattern.length ?? 16) / 16)) : 1;
      addToSongChain(sceneIdx, bars);
      // Use fresh length from store — songChain in closure may be stale after addToSongChain
      if (atIndex !== undefined) moveSongEntry(useDrumStore.getState().songChain.length - 1, atIndex);
      setDropIndex(null);
    }
  }, [addToSongChain, moveSongEntry]);

  const handleEntryDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const fromStr = e.dataTransfer.getData("entryIndex");
    if (fromStr !== "") {
      const from = parseInt(fromStr);
      if (!isNaN(from) && from !== toIndex) moveSongEntry(from, toIndex);
    } else {
      handleSceneDrop(e, toIndex);
    }
    setDragIndex(null);
    setDropIndex(null);
  }, [moveSongEntry, handleSceneDrop]);

  const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const clickBar = Math.floor((e.clientX - rect.left) / barPx);
    // Find which entry this bar belongs to
    let barAcc = 0;
    for (let i = 0; i < songChain.length; i++) {
      barAcc += songChain[i]!.repeats;
      if (clickBar < barAcc) { setSongPosition(i); setSelected(i); break; }
    }
  }, [barPx, songChain, setSongPosition]);

  if (!isOpen) return null;

  const MAX_BAR_PX = 96;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="flex flex-col bg-[linear-gradient(180deg,rgba(14,15,20,0.99),rgba(8,9,13,0.99))] border border-white/10 rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.6)] w-[98vw] max-w-[1400px] max-h-[88vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >

        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-[11px] font-black tracking-[0.22em] text-white/85">ARRANGEMENT</div>
              <div className="text-[7px] font-bold tracking-[0.16em] text-white/28 mt-0.5">
                {songChain.length} SCENES · {totalBars} BARS
              </div>
            </div>

            {/* Song mode toggle */}
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

            {/* REC button */}
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
            {/* Zoom */}
            <div className="flex items-center gap-1 border border-white/8 rounded-lg px-1.5 py-1">
              <button
                onClick={() => setBarPx(px => Math.max(16, px - 8))}
                className="w-5 h-5 text-[10px] font-bold text-white/30 hover:text-white/70 transition-colors"
              >−</button>
              <span className="text-[8px] font-mono text-white/35 w-7 text-center tabular-nums">
                {Math.round(barPx / DEFAULT_BAR_PX * 100)}%
              </span>
              <button
                onClick={() => setBarPx(px => Math.min(MAX_BAR_PX, px + 8))}
                className="w-5 h-5 text-[10px] font-bold text-white/30 hover:text-white/70 transition-colors"
              >+</button>
            </div>

            {/* Clear */}
            <button
              onClick={() => { if (confirm("Clear entire arrangement?")) { clearSongChain(); setSelected(null); } }}
              className="px-2 py-1 rounded text-[8px] font-bold text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              CLEAR
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full text-white/30 hover:text-white hover:bg-white/8 transition-all text-lg flex items-center justify-center"
            >
              ×
            </button>
          </div>
        </div>

        {/* ── Timeline area ─────────────────────────────────────── */}
        <div className="flex overflow-x-auto flex-1 min-h-0" ref={timelineRef}>

          {/* Track label column */}
          <div className="shrink-0 border-r border-white/8" style={{ width: LABEL_W }}>
            {/* Ruler placeholder */}
            <div style={{ height: RULER_H }} className="border-b border-white/8" />
            {TRACKS.map(({ id, label, color }) => (
              <div
                key={id}
                className="flex items-center justify-center border-b border-white/5"
                style={{ height: TRACK_H }}
              >
                <span
                  className="text-[8px] font-black tracking-[0.18em]"
                  style={{ color: `${color}99` }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Scrollable timeline */}
          <div className="relative flex-1 overflow-x-auto overflow-y-hidden">

            {/* Ruler */}
            <div
              className="flex border-b border-white/8 sticky top-0 z-20 bg-[rgba(8,9,13,0.92)] cursor-pointer"
              style={{ height: RULER_H, minWidth: totalBars * barPx }}
              onClick={handleRulerClick}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleSceneDrop(e)}
            >
              {rulerBars.map(i => (
                <div
                  key={i}
                  className="border-r border-white/5 flex items-center shrink-0"
                  style={{ width: barPx, minWidth: barPx }}
                >
                  {(i % 4 === 0) && (
                    <span className="text-[7px] font-mono text-white/25 px-0.5">{i + 1}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Track rows + blocks */}
            <div
              className="relative"
              style={{ minWidth: totalBars * barPx }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.getData("entryIndex") === "") handleSceneDrop(e);
              }}
            >
              {/* Horizontal track backgrounds */}
              {TRACKS.map(({ id }) => (
                <div
                  key={id}
                  className="absolute left-0 right-0 border-b border-white/5"
                  style={{
                    top:    TRACKS.findIndex(t => t.id === id) * TRACK_H,
                    height: TRACK_H,
                    backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent ${barPx * 4 - 1}px, rgba(255,255,255,0.02) ${barPx * 4 - 1}px, rgba(255,255,255,0.02) ${barPx * 4}px)`,
                  }}
                />
              ))}

              {/* Blocks row */}
              <div className="flex" style={{ height: TRACKS.length * TRACK_H }}>
                {songChain.map((entry, index) => {
                  const scene    = scenes[entry.sceneIndex] ?? null;
                  const isActive = songMode === "song" && index === songPosition;
                  const progress = isActive ? songRepeatCount / Math.max(1, entry.repeats) : 0;

                  return (
                    <SceneBlock
                      key={index}
                      entry={entry}
                      index={index}
                      scene={scene}
                      barPx={barPx}
                      isActive={isActive}
                      progress={progress}
                      isDragging={dragIndex === index}
                      isDropTarget={dropIndex === index && dragIndex !== index}
                      isSelected={selected === index}
                      onSelect={() => setSelected(selected === index ? null : index)}
                      onDragStart={(e) => {
                        setDragIndex(index);
                        e.dataTransfer.setData("entryIndex", String(index));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                      onDragOver={() => setDropIndex(index)}
                      onDrop={(e) => handleEntryDrop(e, index)}
                      onRepeat={(delta) => updateSongEntryRepeats(index, Math.max(1, entry.repeats + delta))}
                      onRemove={() => { removeFromSongChain(index); if (selected === index) setSelected(null); }}
                    />
                  );
                })}

                {/* Empty-state drop hint */}
                {songChain.length === 0 && (
                  <div
                    className="flex-1 flex items-center justify-center border-2 border-dashed border-white/8 rounded m-2"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleSceneDrop(e)}
                  >
                    <span className="text-[10px] text-white/20 font-bold tracking-wider">
                      Drag scenes here · or press REC and trigger scenes live
                    </span>
                  </div>
                )}
              </div>

              {/* Playhead */}
              {songMode === "song" && songChain.length > 0 && (
                <div
                  className="absolute top-0 bottom-0 z-30 pointer-events-none"
                  style={{ left: playheadPx, width: 2, backgroundColor: "rgba(255,255,255,0.55)" }}
                >
                  {/* Triangle cap */}
                  <div
                    className="absolute"
                    style={{
                      top: -6,
                      left: -4,
                      width: 0,
                      height: 0,
                      borderLeft: "5px solid transparent",
                      borderRight: "5px solid transparent",
                      borderTop: "6px solid rgba(255,255,255,0.7)",
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Entry detail panel (selected entry) ───────────────── */}
        {selected !== null && songChain[selected] && (() => {
          const entry = songChain[selected]!;
          const scene = scenes[entry.sceneIndex];
          return (
            <div className="shrink-0 border-t border-white/8 px-4 py-2 flex items-center gap-4 flex-wrap bg-white/[0.02]">
              <span className="text-[9px] font-black text-white/60">
                ENTRY {selected + 1} —{" "}
                <span className="text-[var(--ed-accent-orange)]">{scene?.name ?? `Scene ${entry.sceneIndex + 1}`}</span>
                {" "}×{entry.repeats}
              </span>
              <label className="flex items-center gap-1.5 text-[9px] text-white/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={entry.tempoBpm !== undefined}
                  onChange={(e) => updateSongEntry(selected, {
                    tempoBpm:  e.target.checked ? 120 : undefined,
                    tempoRamp: e.target.checked ? false : undefined,
                  })}
                  className="accent-[var(--ed-accent-orange)]"
                />
                Tempo change
              </label>
              {entry.tempoBpm !== undefined && (
                <>
                  <input
                    type="number" min={60} max={200}
                    value={entry.tempoBpm}
                    onChange={(e) => updateSongEntry(selected, { tempoBpm: parseInt(e.target.value) || 120 })}
                    className="w-14 h-6 px-1 text-[10px] bg-black/30 border border-white/15 rounded text-white font-mono"
                  />
                  <label className="flex items-center gap-1.5 text-[9px] text-white/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={entry.tempoRamp ?? false}
                      onChange={(e) => updateSongEntry(selected, { tempoRamp: e.target.checked })}
                      className="accent-[var(--ed-accent-orange)]"
                    />
                    Ramp
                  </label>
                </>
              )}
              <button
                onClick={() => setSelected(null)}
                className="ml-auto text-[8px] text-white/25 hover:text-white/60 transition-colors"
              >close ×</button>
            </div>
          );
        })()}

        {/* ── Scene palette ─────────────────────────────────────── */}
        <div className="shrink-0 border-t border-white/8 px-4 py-3 bg-black/20">
          <div className="text-[7px] font-black tracking-[0.2em] text-white/25 mb-2">
            SCENE PALETTE — drag to timeline {isRecording && "· REC: trigger a scene to record"}
          </div>
          <div className="grid grid-cols-8 gap-1.5">
            {scenes.map((scene, i) => (
              <div
                key={i}
                draggable={!!scene}
                onDragStart={(e) => {
                  if (!scene) { e.preventDefault(); return; }
                  e.dataTransfer.setData("sceneIndex", String(i));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => scene && addToSongChain(i, Math.max(1, Math.ceil((scene.drumPattern.length ?? 16) / 16)))}
                className={`h-10 rounded-lg border flex flex-col items-center justify-center transition-all ${
                  scene
                    ? "border-[var(--ed-accent-orange)]/35 bg-[var(--ed-accent-orange)]/8 cursor-grab hover:bg-[var(--ed-accent-orange)]/20 hover:border-[var(--ed-accent-orange)]/60 active:cursor-grabbing"
                    : "border-white/5 bg-white/[0.015] cursor-not-allowed opacity-40"
                }`}
              >
                {scene ? (
                  <>
                    <span className="text-[8px] font-bold text-white/75 truncate w-full text-center px-1 leading-tight">{scene.name}</span>
                    <span className="text-[6px] text-white/30 tabular-nums">#{i + 1}</span>
                  </>
                ) : (
                  <span className="text-[7px] text-white/15">#{i + 1}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
