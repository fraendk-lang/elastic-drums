/**
 * Arrangement View — Ableton-style linear timeline of scenes.
 *
 * Renders the song chain as horizontal blocks sized by repeat count.
 * Drag to reorder, click to jump, +/- to add/remove repeats.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDrumStore } from "../store/drumStore";
import { useSceneStore } from "../store/sceneStore";

interface ArrangementViewProps {
  isOpen: boolean;
  onClose: () => void;
}

const BAR_PX = 30; // pixels per bar

export function ArrangementView({ isOpen, onClose }: ArrangementViewProps) {
  const songChain = useDrumStore((s) => s.songChain);
  const songPosition = useDrumStore((s) => s.songPosition);
  const songRepeatCount = useDrumStore((s) => s.songRepeatCount);
  const songMode = useDrumStore((s) => s.songMode);
  const setSongMode = useDrumStore((s) => s.setSongMode);
  const addToSongChain = useDrumStore((s) => s.addToSongChain);
  const removeFromSongChain = useDrumStore((s) => s.removeFromSongChain);
  const updateSongEntryRepeats = useDrumStore((s) => s.updateSongEntryRepeats);
  const moveSongEntry = useDrumStore((s) => s.moveSongEntry);
  const setSongPosition = useDrumStore((s) => s.setSongPosition);
  const clearSongChain = useDrumStore((s) => s.clearSongChain);
  const updateSongEntry = useDrumStore((s) => s.updateSongEntry);

  const scenes = useSceneStore((s) => s.scenes);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<number | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const totalBars = songChain.reduce((sum, e) => sum + e.repeats, 0);

  const handleSceneDrop = useCallback((e: React.DragEvent, atIndex?: number) => {
    e.preventDefault();
    const sceneIdx = parseInt(e.dataTransfer.getData("sceneIndex"));
    if (isNaN(sceneIdx)) return;
    if (atIndex === undefined) addToSongChain(sceneIdx, 1);
    else {
      addToSongChain(sceneIdx, 1);
      // Move newly-added entry to atIndex
      const newIndex = songChain.length; // will be this after add
      moveSongEntry(newIndex, atIndex);
    }
  }, [addToSongChain, moveSongEntry, songChain.length]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5 w-[95vw] max-w-6xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold tracking-wider">ARRANGEMENT</h2>
            <div className="text-[9px] text-[var(--ed-text-muted)]">
              Linear timeline · Drag scene from below to add · Drag entries to reorder · Click to jump
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSongMode(songMode === "song" ? "pattern" : "song")}
              className={`px-3 py-1 text-[10px] font-bold rounded transition-colors ${
                songMode === "song"
                  ? "bg-[var(--ed-accent-green)]/30 text-[var(--ed-accent-green)]"
                  : "bg-white/5 text-white/40 hover:text-white/70"
              }`}
            >
              {songMode === "song" ? "SONG MODE ON" : "SONG MODE OFF"}
            </button>
            <button onClick={onClose} className="text-white/40 hover:text-white text-lg px-2">×</button>
          </div>
        </div>

        {/* Timeline */}
        <div className="mb-4">
          <div className="text-[8px] text-white/30 font-bold mb-1 flex justify-between">
            <span>TIMELINE · {totalBars} bars</span>
            <button
              onClick={() => { if (confirm("Clear entire arrangement?")) clearSongChain(); }}
              className="text-[8px] text-red-400/60 hover:text-red-400"
            >
              CLEAR
            </button>
          </div>
          <div
            ref={timelineRef}
            className="relative border border-white/10 rounded bg-black/40 overflow-x-auto min-h-[90px]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleSceneDrop(e)}
          >
            {/* Bar ruler */}
            <div className="flex border-b border-white/8 h-4">
              {Array.from({ length: Math.max(totalBars, 16) }, (_, i) => (
                <div
                  key={i}
                  className="border-r border-white/5 text-[7px] text-white/25 font-mono px-0.5"
                  style={{ width: BAR_PX, minWidth: BAR_PX }}
                >
                  {i % 4 === 0 ? i + 1 : ""}
                </div>
              ))}
            </div>

            {/* Entries */}
            <div className="flex items-stretch h-[70px]">
              {songChain.map((entry, index) => {
                const scene = scenes[entry.sceneIndex];
                const width = entry.repeats * BAR_PX;
                const isActive = songMode === "song" && index === songPosition;
                const progress = isActive ? (songRepeatCount / entry.repeats) : 0;

                return (
                  <div
                    key={index}
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(index);
                      e.dataTransfer.setData("entryIndex", String(index));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => { setDragIndex(null); setHoverIndex(null); }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setHoverIndex(index);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const fromStr = e.dataTransfer.getData("entryIndex");
                      if (fromStr) {
                        const from = parseInt(fromStr);
                        if (!isNaN(from) && from !== index) moveSongEntry(from, index);
                      } else {
                        handleSceneDrop(e, index);
                      }
                      setHoverIndex(null);
                    }}
                    onClick={() => { setSongPosition(index); setSelectedEntry(index); }}
                    className="relative border-r border-black/30 cursor-pointer hover:brightness-125 transition-all"
                    style={{
                      width,
                      minWidth: width,
                      backgroundColor: scene
                        ? "var(--ed-accent-orange)"
                        : "var(--ed-bg-surface)",
                      opacity: dragIndex === index ? 0.4 : 1,
                      outline: hoverIndex === index && dragIndex !== index ? "2px solid white" : "none",
                    }}
                  >
                    {/* Active progress bar */}
                    {isActive && (
                      <div
                        className="absolute top-0 left-0 bottom-0 bg-white/30 pointer-events-none"
                        style={{ width: `${progress * 100}%` }}
                      />
                    )}
                    {/* Label */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-black px-1">
                      <span className="text-[9px] font-bold truncate w-full text-center">
                        {scene?.name ?? `#${entry.sceneIndex + 1}`}
                      </span>
                      <span className="text-[7px] opacity-70">×{entry.repeats}</span>
                    </div>
                    {/* Repeat controls */}
                    <div className="absolute top-0 right-0 flex flex-col">
                      <button
                        onClick={(e) => { e.stopPropagation(); updateSongEntryRepeats(index, entry.repeats + 1); }}
                        className="w-3 h-3 text-[8px] text-black/70 hover:bg-black/20 leading-none"
                      >+</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); updateSongEntryRepeats(index, entry.repeats - 1); }}
                        className="w-3 h-3 text-[8px] text-black/70 hover:bg-black/20 leading-none"
                      >−</button>
                    </div>
                    {/* Delete */}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFromSongChain(index); }}
                      className="absolute bottom-0 right-0 w-3 h-3 text-[8px] text-black/60 hover:text-red-700 hover:bg-black/20 leading-none"
                    >×</button>
                  </div>
                );
              })}
              {songChain.length === 0 && (
                <div className="flex items-center justify-center w-full text-white/20 text-[10px]">
                  Drop scenes here to build your arrangement
                </div>
              )}
            </div>
          </div>

          {/* Tempo automation editor for selected entry */}
          {selectedEntry !== null && songChain[selectedEntry] && (() => {
            const entry = songChain[selectedEntry]!;
            const sceneName = scenes[entry.sceneIndex]?.name ?? `Scene ${entry.sceneIndex + 1}`;
            return (
              <div className="mt-2 p-3 rounded-md border border-white/10 bg-white/[0.03]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-bold text-white/70">
                    Entry {selectedEntry + 1} — <span className="text-[var(--ed-accent-orange)]">{sceneName}</span> ×{entry.repeats}
                  </span>
                  <button
                    onClick={() => setSelectedEntry(null)}
                    className="text-[9px] text-white/30 hover:text-white/70"
                  >
                    close
                  </button>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Tempo toggle */}
                  <label className="flex items-center gap-1.5 text-[9px] text-white/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={entry.tempoBpm !== undefined}
                      onChange={(e) => updateSongEntry(selectedEntry, {
                        tempoBpm: e.target.checked ? 120 : undefined,
                        tempoRamp: e.target.checked ? (entry.tempoRamp ?? false) : undefined,
                      })}
                    />
                    Tempo change
                  </label>

                  {entry.tempoBpm !== undefined && (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[8px] font-bold text-white/40">BPM</span>
                        <input
                          type="number"
                          min={60} max={200}
                          value={entry.tempoBpm}
                          onChange={(e) => updateSongEntry(selectedEntry, { tempoBpm: parseInt(e.target.value) || 120 })}
                          className="w-14 h-6 px-1 text-[10px] bg-black/30 border border-white/15 rounded text-white font-mono"
                        />
                      </div>
                      <label className="flex items-center gap-1.5 text-[9px] text-white/60 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={entry.tempoRamp ?? false}
                          onChange={(e) => updateSongEntry(selectedEntry, { tempoRamp: e.target.checked })}
                        />
                        Ramp (gradually over entry)
                      </label>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Scene palette */}
        <div>
          <div className="text-[8px] text-white/30 font-bold mb-1">
            SCENE PALETTE · Drag to timeline
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
                className={`h-12 rounded border flex flex-col items-center justify-center transition-all ${
                  scene
                    ? "border-[var(--ed-accent-orange)]/40 bg-[var(--ed-accent-orange)]/10 cursor-grab hover:bg-[var(--ed-accent-orange)]/25"
                    : "border-white/5 bg-white/[0.02] cursor-not-allowed"
                }`}
              >
                {scene ? (
                  <>
                    <span className="text-[9px] font-bold text-white/80 truncate px-1">{scene.name}</span>
                    <span className="text-[7px] text-white/40">#{i + 1}</span>
                  </>
                ) : (
                  <span className="text-[8px] text-white/15">#{i + 1}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
