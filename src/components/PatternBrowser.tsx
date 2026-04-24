import { useState, useEffect, useCallback } from "react";
import { useDrumStore } from "../store/drumStore";
import {
  listPatterns, savePattern, deletePattern,
  type StoredPattern,
} from "../storage/patternStorage";

interface PatternBrowserProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PatternBrowser({ isOpen, onClose }: PatternBrowserProps) {
  const { pattern, bpm } = useDrumStore();
  const [patterns, setPatterns] = useState<StoredPattern[]>([]);
  const [saveName, setSaveName] = useState("");
  const [loading, setLoading] = useState(false);

  // Load pattern list
  const refreshList = useCallback(async () => {
    setLoading(true);
    const list = await listPatterns();
    setPatterns(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) refreshList();
  }, [isOpen, refreshList]);

  // Save current pattern
  const handleSave = useCallback(async () => {
    const name = saveName.trim() || `Pattern ${new Date().toLocaleTimeString()}`;
    await savePattern(name, { ...pattern, name });
    setSaveName("");
    await refreshList();
  }, [saveName, pattern, refreshList]);

  // Load a pattern
  const handleLoad = useCallback((stored: StoredPattern) => {
    const wasPlaying = useDrumStore.getState().isPlaying;
    if (wasPlaying) useDrumStore.getState().togglePlay();

    useDrumStore.setState({
      pattern: structuredClone(stored.pattern),
      currentPatternIndex: -1,
    });
    onClose();
  }, [onClose]);

  // Delete a pattern
  const handleDelete = useCallback(async (id: string) => {
    await deletePattern(id);
    await refreshList();
  }, [refreshList]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-[var(--ed-bg-secondary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[var(--ed-text-primary)] tracking-wider">
            PATTERN BROWSER
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg"
          >
            ✕
          </button>
        </div>

        {/* Save section */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Pattern name..."
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="flex-1 h-8 px-3 text-sm bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded text-[var(--ed-text-primary)] placeholder-[var(--ed-text-muted)] focus:border-[var(--ed-accent-orange)] focus:outline-none"
          />
          <button
            onClick={handleSave}
            className="px-4 h-8 text-xs font-bold bg-[var(--ed-accent-orange)] text-black rounded hover:brightness-110 transition-all"
          >
            SAVE
          </button>
        </div>

        {/* Pattern list */}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {loading && (
            <p className="text-xs text-[var(--ed-text-muted)] text-center py-4">Loading...</p>
          )}

          {!loading && patterns.length === 0 && (
            <p className="text-xs text-[var(--ed-text-muted)] text-center py-4">
              No saved patterns yet. Create a beat and hit SAVE!
            </p>
          )}

          {patterns.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--ed-bg-surface)] hover:bg-[var(--ed-bg-elevated)] transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--ed-text-primary)] truncate">
                  {p.name}
                </div>
                <div className="text-[10px] text-[var(--ed-text-muted)]">
                  {new Date(p.updatedAt).toLocaleDateString()} · {p.pattern.length} steps
                </div>
              </div>

              <button
                onClick={() => handleLoad(p)}
                className="px-3 py-1 text-[10px] font-bold bg-[var(--ed-accent-blue)] text-white rounded hover:brightness-110 opacity-0 group-hover:opacity-100 transition-all"
              >
                LOAD
              </button>

              <button
                onClick={() => handleDelete(p.id)}
                className="px-2 py-1 text-[10px] font-bold text-[var(--ed-text-muted)] hover:text-[var(--ed-accent-red)] opacity-0 group-hover:opacity-100 transition-all"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Info */}
        <p className="text-[9px] text-[var(--ed-text-muted)] mt-3 text-center">
          Patterns are saved in your browser (IndexedDB) • BPM: {bpm}
        </p>
      </div>
    </div>
  );
}
