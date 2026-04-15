import { useState } from "react";
import { useDrumStore } from "../store/drumStore";
import { useSceneStore } from "../store/sceneStore";

interface SongEditorProps {
  isOpen: boolean;
  onClose: () => void;
}

function stepsToBars(steps: number): number {
  return Math.max(1, Math.ceil(steps / 16));
}

export function SongEditor({ isOpen, onClose }: SongEditorProps) {
  const {
    songMode,
    songChain,
    songPosition,
    setSongMode,
    addToSongChain,
    insertIntoSongChain,
    removeFromSongChain,
    duplicateSongEntry,
    moveSongEntry,
    updateSongEntryRepeats,
    updateSongEntryScene,
    setSongPosition,
    clearSongChain,
  } = useDrumStore();

  const { scenes } = useSceneStore();

  const [selectedClipIndex, setSelectedClipIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleSceneClick = (slotIndex: number) => {
    if (!scenes[slotIndex]) return;
    if (selectedClipIndex !== null && songChain[selectedClipIndex]) {
      updateSongEntryScene(selectedClipIndex, slotIndex);
      return;
    }
    if (songChain.length === 0) {
      addToSongChain(slotIndex, 1);
      return;
    }
    insertIntoSongChain(songPosition + 1, slotIndex, 1);
  };

  const handleCycleRepeats = (chainIndex: number) => {
    // Cycle: 1 → 2 → 4 → 8 → 1
    const entry = songChain[chainIndex];
    if (!entry) return;
    const cycle = [1, 2, 4, 8];
    const currentIdx = cycle.indexOf(entry.repeats);
    const nextRepeats = cycle[(currentIdx + 1) % cycle.length] ?? 1;
    updateSongEntryRepeats(chainIndex, nextRepeats);
  };

  const handleNudgeRepeats = (chainIndex: number, delta: number) => {
    const entry = songChain[chainIndex];
    if (!entry) return;
    updateSongEntryRepeats(chainIndex, entry.repeats + delta);
  };

  const totalEntries = songChain.length;
  const totalBars = songChain.reduce((sum, entry) => sum + entry.repeats, 0);
  const totalMidiBars = songChain.reduce((sum, entry) => {
    const scene = scenes[entry.sceneIndex];
    if (!scene) return sum;
    const maxMidiBars = Math.max(
      stepsToBars(scene.bassLength),
      stepsToBars(scene.chordsLength),
      stepsToBars(scene.melodyLength),
    );
    return sum + maxMidiBars;
  }, 0);
  const activeEntry = songChain[songPosition] ?? null;
  const activeSceneName = activeEntry ? scenes[activeEntry.sceneIndex]?.name ?? "Empty" : "None";
  const selectedEntry = selectedClipIndex !== null ? songChain[selectedClipIndex] ?? null : null;
  const selectedSceneName = selectedEntry ? scenes[selectedEntry.sceneIndex]?.name ?? "Empty" : "None";
  const rulerBars = Math.max(32, totalBars);
  let runningBar = 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--ed-bg-secondary)]">
      {/* Header */}
      <div className="flex items-center justify-between h-10 px-4 border-b border-[var(--ed-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-black text-[var(--ed-accent-orange)] tracking-[0.2em]">
            ARRANGER
          </span>
          <span className="text-[9px] font-bold tracking-[0.16em] text-white/20">
            TIMELINE / SCENES / SONG FORM
          </span>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 text-[10px] bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:text-white rounded transition-colors"
        >
          ← BACK
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Scene Palette */}
        <div className="w-56 shrink-0 border-r border-[var(--ed-border)] overflow-y-auto p-3 bg-black/10">
            <div className="mb-3 rounded-xl border border-white/6 bg-black/20 px-3 py-2">
              <div className="text-[9px] font-black tracking-[0.16em] text-white/60">SCENE PALETTE</div>
              <div className="mt-1 text-[8px] font-bold tracking-[0.12em] text-white/25">
                {selectedClipIndex !== null
                  ? `replace clip ${selectedClipIndex + 1} with a new scene`
                  : "click a scene to insert it after the playhead"}
              </div>
            </div>
          <div className="grid grid-cols-2 gap-1.5">
            {scenes.map((scene, i) => {
              const hasData = scene !== null;
              return (
                <button
                  key={i}
                  onClick={() => handleSceneClick(i)}
                  disabled={!hasData}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-left transition-colors ${
                    hasData
                      ? "bg-[var(--ed-bg-surface)] hover:bg-[var(--ed-accent-orange)] hover:text-black cursor-pointer"
                      : "bg-[var(--ed-bg-surface)]/40 cursor-not-allowed opacity-40"
                  }`}
                >
                  <span
                    className={`text-[9px] font-mono font-bold ${
                      hasData
                        ? "text-green-400"
                        : "text-[var(--ed-text-muted)]"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={`text-[9px] truncate ${
                      hasData
                        ? "text-[var(--ed-text-primary)]"
                        : "text-[var(--ed-text-muted)]"
                    }`}
                  >
                    {scene?.name ?? "Empty"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Song Chain Timeline */}
        <div className="flex-1 flex flex-col min-w-0 p-3 gap-3">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
            <div className="rounded-xl border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))] px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[9px] font-black tracking-[0.16em] text-white/60">ARRANGEMENT STATUS</span>
                <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] text-white/40">
                  {totalEntries} CLIPS
                </span>
                <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] text-white/40">
                  {totalBars} BARS
                </span>
                <span className="rounded-full border border-[var(--ed-accent-green)]/20 bg-[var(--ed-accent-green)]/8 px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] text-[var(--ed-accent-green)]">
                  MIDI {totalMidiBars}B
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] ${
                  songMode === "song"
                    ? "border-[var(--ed-accent-orange)]/30 bg-[var(--ed-accent-orange)]/10 text-[var(--ed-accent-orange)]"
                    : "border-white/8 bg-black/25 text-white/35"
                }`}>
                  {songMode === "song" ? "SONG PLAYBACK" : "PATTERN LOOP"}
                </span>
              </div>
              <div className="mt-2 text-[8px] font-bold tracking-[0.12em] text-white/25">
                {songMode === "song"
                  ? `currently following arranged scene order · active clip: ${activeSceneName}`
                  : "pattern mode ignores the timeline and loops the current groove"}
              </div>
            </div>

            <div className="rounded-xl border border-white/6 bg-black/20 px-3 py-2">
              <div className="text-[9px] font-black tracking-[0.16em] text-white/60">TRANSPORT FOCUS</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] ${
                  songMode === "song" ? "bg-[var(--ed-accent-orange)]/15 text-[var(--ed-accent-orange)]" : "bg-white/5 text-white/35"
                }`}>
                  PLAYHEAD {songMode === "song" ? songPosition + 1 : 1}
                </span>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] text-white/35">
                  SCENE {activeSceneName}
                </span>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] text-white/35">
                  NEXT {songMode === "song" && songChain[songPosition + 1] ? scenes[songChain[songPosition + 1]!.sceneIndex]?.name ?? "Empty" : "—"}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold tracking-[0.12em] ${
                  selectedClipIndex !== null ? "bg-white/10 text-white/75" : "bg-white/5 text-white/35"
                }`}>
                  EDIT {selectedClipIndex !== null ? `${selectedClipIndex + 1} · ${selectedSceneName}` : "NONE"}
                </span>
              </div>
            </div>
          </div>

          {songChain.length === 0 ? (
            <div className="flex-1 flex items-center justify-center rounded-xl border border-dashed border-white/8 bg-black/10">
              <span className="text-xs text-[var(--ed-text-muted)]">
                Add scenes from the palette to start building the arrangement
              </span>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-white/6 bg-black/10">
              <div className="min-w-[900px] px-3 py-3">
                <div className={`grid gap-x-1 gap-y-1`} style={{ gridTemplateColumns: `160px repeat(${rulerBars}, minmax(20px, 1fr))` }}>
                  <div className="text-[8px] font-black tracking-[0.16em] text-white/35">RULER</div>
                  {Array.from({ length: rulerBars }, (_, bar) => (
                    <div
                      key={bar}
                      className={`text-center text-[8px] font-mono pb-1 border-b ${bar % 4 === 0 ? "border-white/12 text-white/45" : "border-white/6 text-white/25"}`}
                    >
                      {bar + 1}
                    </div>
                  ))}

                  <div className="flex items-center text-[8px] font-black tracking-[0.16em] text-white/35">SECTIONS</div>
                  <div className="relative rounded-lg border border-white/6 bg-black/20 px-2 py-1.5" style={{ gridColumn: `span ${rulerBars}` }}>
                    <div className="flex h-8 items-center gap-1.5">
                      {songChain.map((entry, i) => {
                        const scene = scenes[entry.sceneIndex];
                        const isSelected = selectedClipIndex === i;
                        const startBar = runningBar;
                        const endBar = runningBar + entry.repeats - 1;
                        const bassBars = scene ? stepsToBars(scene.bassLength) : 1;
                        const chordsBars = scene ? stepsToBars(scene.chordsLength) : 1;
                        const melodyBars = scene ? stepsToBars(scene.melodyLength) : 1;
                        const maxMidiBars = Math.max(bassBars, chordsBars, melodyBars);
                        runningBar += entry.repeats;
                        return (
                          <button
                            key={`section-${i}`}
                            onClick={() => {
                              setSelectedClipIndex(i);
                              setSongPosition(i);
                            }}
                            className={`flex min-w-[88px] items-center justify-between rounded-md border px-2 py-1 text-left transition-colors ${
                              isSelected
                                ? "border-[var(--ed-accent-orange)] bg-[var(--ed-accent-orange)]/14"
                                : "border-white/8 bg-white/[0.03] hover:bg-white/[0.06]"
                            }`}
                            style={{ width: `${Math.max(88, entry.repeats * 36)}px` }}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-[8px] font-black tracking-[0.12em] text-white/75">{scene?.name ?? "Empty"}</div>
                              <div className="mt-1 text-[7px] font-bold tracking-[0.12em] text-[var(--ed-accent-green)]/80">
                                MIDI {maxMidiBars}B
                              </div>
                            </div>
                            <span className="ml-2 text-[7px] font-mono text-white/35">{startBar}-{endBar}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center text-[8px] font-black tracking-[0.16em] text-white/35">SCENE LANE</div>
                  <div className="relative h-20 rounded-lg border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))]" style={{ gridColumn: `span ${rulerBars}` }}>
                    <div className="absolute inset-y-0 left-0 right-0 grid grid-cols-32">
                      {Array.from({ length: rulerBars }, (_, bar) => (
                        <div key={bar} className={`border-r ${bar % 4 === 3 ? "border-white/10" : "border-white/5"}`} />
                      ))}
                    </div>
                    <div className="relative h-full px-2 py-2 flex gap-2">
                      {songChain.map((entry, i) => {
                        const scene = scenes[entry.sceneIndex];
                        const isActive = songMode === "song" && songPosition === i;
                        const isSelected = selectedClipIndex === i;
                        const bassBars = scene ? stepsToBars(scene.bassLength) : 1;
                        const chordsBars = scene ? stepsToBars(scene.chordsLength) : 1;
                        const melodyBars = scene ? stepsToBars(scene.melodyLength) : 1;
                        return (
                          <div
                            key={i}
                            onClick={() => {
                              setSelectedClipIndex(i);
                              setSongPosition(i);
                            }}
                            className={`relative flex h-full min-w-[84px] cursor-pointer items-center justify-between rounded-lg border px-3 transition-colors ${
                              isActive
                                ? "border-[var(--ed-accent-orange)] bg-[var(--ed-accent-orange)]/12 shadow-[0_0_14px_rgba(245,158,11,0.18)]"
                                : isSelected
                                  ? "border-white/18 bg-white/[0.06]"
                                  : "border-white/8 bg-[var(--ed-bg-surface)]/80"
                            }`}
                            style={{ width: `${Math.max(84, entry.repeats * 44)}px` }}
                          >
                            <div className="absolute inset-x-2 bottom-2 flex gap-1">
                              {Array.from({ length: entry.repeats }, (_, loopIndex) => (
                                <div
                                  key={loopIndex}
                                  className={`h-1 flex-1 rounded-full ${
                                    isActive ? "bg-[var(--ed-accent-orange)]/75" : "bg-white/10"
                                  }`}
                                />
                              ))}
                            </div>
                            <div className="min-w-0">
                              <div className={`text-[8px] font-mono ${isActive ? "text-[var(--ed-accent-orange)]" : "text-white/30"}`}>
                                {i + 1}
                              </div>
                              <div className="truncate text-[10px] font-bold text-white/85">
                                {scene?.name ?? "Empty"}
                              </div>
                              <div className="mt-1 text-[7px] font-bold tracking-[0.12em] text-white/30">
                                LOOP x{entry.repeats}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <span className="rounded-full border border-[var(--ed-accent-bass)]/20 bg-[var(--ed-accent-bass)]/10 px-1.5 py-0.5 text-[7px] font-black tracking-[0.12em] text-[var(--ed-accent-bass)]/85">
                                  B {bassBars}B
                                </span>
                                <span className="rounded-full border border-[var(--ed-accent-chords)]/20 bg-[var(--ed-accent-chords)]/10 px-1.5 py-0.5 text-[7px] font-black tracking-[0.12em] text-[var(--ed-accent-chords)]/85">
                                  C {chordsBars}B
                                </span>
                                <span className="rounded-full border border-[var(--ed-accent-melody)]/20 bg-[var(--ed-accent-melody)]/10 px-1.5 py-0.5 text-[7px] font-black tracking-[0.12em] text-[var(--ed-accent-melody)]/85">
                                  M {melodyBars}B
                                </span>
                              </div>
                            </div>
                            <div className="ml-2 flex items-center gap-1 pb-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveSongEntry(i, Math.max(0, i - 1));
                                }}
                                className="rounded bg-black/25 px-1 py-0.5 text-[8px] font-black text-white/35 hover:text-white/70"
                                title="Move clip left"
                              >
                                ←
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveSongEntry(i, Math.min(songChain.length - 1, i + 1));
                                }}
                                className="rounded bg-black/25 px-1 py-0.5 text-[8px] font-black text-white/35 hover:text-white/70"
                                title="Move clip right"
                              >
                                →
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  duplicateSongEntry(i);
                                }}
                                className="rounded bg-black/25 px-1.5 py-0.5 text-[8px] font-black text-white/35 hover:text-white/70"
                                title="Duplicate clip"
                              >
                                DUP
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleNudgeRepeats(i, -1);
                                }}
                                className="rounded bg-black/25 px-1.5 py-0.5 text-[8px] font-black text-white/35 hover:text-white/70"
                                title="Shorter clip"
                              >
                                -B
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCycleRepeats(i);
                                }}
                                className={`rounded px-1.5 py-0.5 text-[8px] font-black ${
                                  isActive
                                    ? "bg-[var(--ed-accent-orange)] text-black"
                                    : "bg-black/30 text-white/55 hover:bg-[var(--ed-accent-orange)] hover:text-black"
                                }`}
                                title="Cycle bars"
                              >
                                {entry.repeats}B
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleNudgeRepeats(i, 1);
                                }}
                                className="rounded bg-black/25 px-1.5 py-0.5 text-[8px] font-black text-white/35 hover:text-white/70"
                                title="Longer clip"
                              >
                                +B
                              </button>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (selectedClipIndex === i) setSelectedClipIndex(null);
                                removeFromSongChain(i);
                              }}
                              className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-white/10 bg-black/70 text-[8px] text-white/35 hover:text-red-400"
                              title="Remove clip"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center text-[8px] font-black tracking-[0.16em] text-white/35">BAR COUNT</div>
                    <div className="flex items-center rounded-lg border border-white/6 bg-black/20 px-3 py-2 text-[8px] font-bold tracking-[0.12em] text-white/30" style={{ gridColumn: `span ${rulerBars}` }}>
                    click a clip to focus it · scene palette replaces the focused clip · `-B / +B` trims and extends loop length · `B/C/M` show internal bass, chords and melody clip spans
                  </div>
                </div>
              </div>
            </div>
          )}

          {songChain.length > 0 && (
            <div className="flex items-center justify-end">
              <button
                onClick={clearSongChain}
                className="text-[9px] text-[var(--ed-text-muted)] hover:text-[var(--ed-accent-red,#f44)] transition-colors"
              >
                CLEAR ARRANGEMENT
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between h-10 px-4 border-t border-[var(--ed-border)] bg-[var(--ed-bg-secondary)] shrink-0">
        <div className="flex items-center gap-3">
          {/* Song mode toggle */}
          <div className="flex gap-1">
            <button
              onClick={() => setSongMode("pattern")}
              className={`px-3 py-1 text-[10px] font-bold rounded transition-colors ${
                songMode === "pattern"
                  ? "bg-[var(--ed-accent-orange)] text-black"
                  : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)]"
              }`}
            >
              PATTERN
            </button>
            <button
              onClick={() => setSongMode("song")}
              className={`px-3 py-1 text-[10px] font-bold rounded transition-colors ${
                songMode === "song"
                  ? "bg-[var(--ed-accent-orange)] text-black"
                  : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)]"
              }`}
            >
              SONG
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 text-[9px] text-[var(--ed-text-muted)]">
          <span>{totalEntries} clips</span>
          <span>{totalBars} bars</span>
          <span>{totalMidiBars} midi bars</span>
          {songMode === "song" && totalEntries > 0 && (
            <span className="text-[var(--ed-accent-orange)]">LOOP</span>
          )}
          <span>
            {songMode === "pattern"
              ? "loops current pattern"
              : "plays arranged clips in sequence"}
          </span>
        </div>
      </div>
    </div>
  );
}
