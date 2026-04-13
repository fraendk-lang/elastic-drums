import { useState } from "react";
import { useDrumStore } from "../store/drumStore";
import { useSceneStore } from "../store/sceneStore";

interface SongEditorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SongEditor({ isOpen, onClose }: SongEditorProps) {
  const {
    songMode,
    songChain,
    songPosition,
    setSongMode,
    addToSongChain,
    removeFromSongChain,
    clearSongChain,
  } = useDrumStore();

  const { scenes } = useSceneStore();

  // Track which chain entry repeat badge was last clicked (for visual feedback)
  const [_, setTick] = useState(0);

  if (!isOpen) return null;

  const handleSceneClick = (slotIndex: number) => {
    if (!scenes[slotIndex]) return;
    addToSongChain(slotIndex, 1);
  };

  const handleCycleRepeats = (chainIndex: number) => {
    // Cycle: 1 → 2 → 4 → 8 → 1
    const entry = songChain[chainIndex];
    if (!entry) return;
    const cycle = [1, 2, 4, 8];
    const currentIdx = cycle.indexOf(entry.repeats);
    const nextRepeats = cycle[(currentIdx + 1) % cycle.length] ?? 1;
    // Update via remove + re-add at same position
    useDrumStore.setState((state) => ({
      songChain: state.songChain.map((e, i) =>
        i === chainIndex ? { ...e, repeats: nextRepeats } : e
      ),
    }));
    setTick((t) => t + 1); // Force re-render
  };

  const totalEntries = songChain.length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--ed-bg-secondary)]">
      {/* Header */}
      <div className="flex items-center justify-between h-9 px-4 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-black text-[var(--ed-accent-orange)] tracking-[0.2em]">
            SONG ARRANGER
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
        <div className="w-48 shrink-0 border-r border-[var(--ed-border)] overflow-y-auto p-3">
          <h3 className="text-[9px] font-bold text-[var(--ed-text-muted)] tracking-wider mb-2">
            SCENES — click to add
          </h3>
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
        <div className="flex-1 flex flex-col min-w-0 p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[9px] font-bold text-[var(--ed-text-muted)] tracking-wider">
              SONG CHAIN
            </h3>
            {songChain.length > 0 && (
              <button
                onClick={clearSongChain}
                className="text-[9px] text-[var(--ed-text-muted)] hover:text-[var(--ed-accent-red,#f44)] transition-colors"
              >
                CLEAR ALL
              </button>
            )}
          </div>

          {songChain.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-xs text-[var(--ed-text-muted)]">
                Click scenes on the left to build a song chain
              </span>
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto overflow-y-hidden">
              <div className="flex gap-2 pb-2">
                {songChain.map((entry, i) => {
                  const scene = scenes[entry.sceneIndex];
                  const isActive =
                    songMode === "song" && songPosition === i;
                  return (
                    <div
                      key={i}
                      className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-lg border transition-all shrink-0 ${
                        isActive
                          ? "border-[var(--ed-accent-orange)] bg-[var(--ed-accent-orange)]/10 shadow-[0_0_12px_rgba(255,160,0,0.25)]"
                          : "border-[var(--ed-border)] bg-[var(--ed-bg-surface)]"
                      }`}
                    >
                      {/* Delete button */}
                      <button
                        onClick={() => removeFromSongChain(i)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-[var(--ed-bg-elevated)] border border-[var(--ed-border)] text-[8px] text-[var(--ed-text-muted)] hover:text-[var(--ed-accent-red,#f44)] hover:border-[var(--ed-accent-red,#f44)] transition-colors"
                      >
                        ×
                      </button>

                      {/* Chain position */}
                      <span className="text-[8px] font-mono text-[var(--ed-text-muted)]">
                        {i + 1}
                      </span>

                      {/* Scene name */}
                      <span
                        className={`text-[10px] font-medium ${
                          isActive
                            ? "text-[var(--ed-accent-orange)]"
                            : "text-[var(--ed-text-primary)]"
                        }`}
                      >
                        {scene?.name ?? "Empty"}
                      </span>

                      {/* Repeat badge */}
                      <button
                        onClick={() => handleCycleRepeats(i)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors ${
                          isActive
                            ? "bg-[var(--ed-accent-orange)] text-black"
                            : "bg-[var(--ed-bg-elevated)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-accent-orange)] hover:text-black"
                        }`}
                        title="Click to cycle repeats: 1→2→4→8"
                      >
                        ×{entry.repeats}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between h-9 px-4 border-t border-[var(--ed-border)] bg-[var(--ed-bg-secondary)] shrink-0">
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
          <span>{totalEntries} entries</span>
          {songMode === "song" && totalEntries > 0 && (
            <span className="text-[var(--ed-accent-orange)]">LOOP</span>
          )}
          <span>
            {songMode === "pattern"
              ? "Loops current pattern"
              : "Plays chain in sequence"}
          </span>
        </div>
      </div>
    </div>
  );
}
