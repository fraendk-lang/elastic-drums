import { useCallback } from "react";
import { useDrumStore } from "../store/drumStore";

interface SongEditorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SongEditor({ isOpen, onClose }: SongEditorProps) {
  const {
    songChain, patternBank, songMode,
    setSongMode, addToSongChain, removeFromSongChain, clearSongChain,
    loadPreset,
  } = useDrumStore();

  const handleAddPattern = useCallback((index: number) => {
    addToSongChain(index, 1);
  }, [addToSongChain]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-[var(--ed-bg-secondary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-[var(--ed-text-primary)] tracking-wider">SONG MODE</h2>
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
          <button onClick={onClose} className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg">✕</button>
        </div>

        {/* Pattern Bank */}
        <div className="mb-4">
          <h3 className="text-[10px] font-bold text-[var(--ed-text-muted)] mb-2 tracking-wider">PATTERN BANK — click to add to chain</h3>
          <div className="flex flex-wrap gap-1.5">
            {patternBank.map((p, i) => (
              <button
                key={i}
                onClick={() => handleAddPattern(i)}
                onDoubleClick={() => loadPreset(i)}
                className="px-3 py-1.5 text-[10px] font-medium rounded bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-accent-orange)] hover:text-black transition-colors"
                title={`Click: add to chain · Double-click: load pattern`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Song Chain */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-bold text-[var(--ed-text-muted)] tracking-wider">
              SONG CHAIN ({songChain.length} patterns)
            </h3>
            {songChain.length > 0 && (
              <button
                onClick={clearSongChain}
                className="text-[10px] text-[var(--ed-text-muted)] hover:text-[var(--ed-accent-red)] transition-colors"
              >
                CLEAR ALL
              </button>
            )}
          </div>

          {songChain.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--ed-text-muted)]">
              Click patterns above to build a song chain
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {songChain.map((entry, i) => {
                const pattern = patternBank[entry.patternIndex];
                return (
                  <div
                    key={i}
                    className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--ed-bg-elevated)] border border-[var(--ed-border)] group"
                  >
                    <span className="text-[9px] font-mono text-[var(--ed-text-muted)]">{i + 1}.</span>
                    <span className="text-[10px] font-medium text-[var(--ed-text-primary)]">
                      {pattern?.name ?? "?"}
                    </span>
                    <span className="text-[9px] text-[var(--ed-accent-orange)]">×{entry.repeats}</span>
                    <button
                      onClick={() => removeFromSongChain(i)}
                      className="ml-1 text-[9px] text-[var(--ed-text-muted)] hover:text-[var(--ed-accent-red)] opacity-0 group-hover:opacity-100 transition-all"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="text-[9px] text-[var(--ed-text-muted)] mt-4 text-center">
          Pattern mode: loops current pattern · Song mode: plays chain in sequence
        </p>
      </div>
    </div>
  );
}
