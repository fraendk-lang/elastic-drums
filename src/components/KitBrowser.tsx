import { useState, useCallback, useMemo } from "react";
import { useDrumStore } from "../store/drumStore";
import { FACTORY_KITS, KIT_CATEGORIES } from "../kits/factoryKits";
import { applyKit, kitToPattern } from "../kits/KitManager";

interface KitBrowserProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KitBrowser({ isOpen, onClose }: KitBrowserProps) {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredKits = useMemo(() => {
    return FACTORY_KITS.filter((kit) => {
      const matchesCategory = selectedCategory === "All" || kit.category === selectedCategory;
      const matchesSearch = searchQuery === "" ||
        kit.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        kit.tags.some((t) => t.includes(searchQuery.toLowerCase()));
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

  const loadKit = useCallback((kitId: string, autoPlay = true) => {
    const kit = FACTORY_KITS.find((k) => k.id === kitId);
    if (!kit) return;

    const { isPlaying, togglePlay } = useDrumStore.getState();

    // Stop if playing (to reset step)
    if (isPlaying) togglePlay();

    // Apply voice parameters + mix + FX
    applyKit(kit);

    // Load pattern if available
    const pattern = kitToPattern(kit);
    if (pattern) {
      useDrumStore.setState({
        pattern,
        bpm: Math.round((kit.bpmRange[0] + kit.bpmRange[1]) / 2),
        currentStep: 0,
        currentPatternIndex: -1,
      });
    }

    // Auto-play for instant preview
    if (autoPlay && pattern) {
      // Small delay to let state settle
      setTimeout(() => {
        if (!useDrumStore.getState().isPlaying) {
          useDrumStore.getState().togglePlay();
        }
      }, 50);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-3xl max-h-[80vh] bg-[var(--ed-bg-secondary)] border border-[var(--ed-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ed-border)]">
          <div>
            <h2 className="text-sm font-bold text-[var(--ed-text-primary)] tracking-wider">
              KIT BROWSER
            </h2>
            <p className="text-[10px] text-[var(--ed-text-muted)] mt-0.5">
              {FACTORY_KITS.length} kits &middot; {KIT_CATEGORIES.length - 1} categories
            </p>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search kits..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-40 h-7 px-2 text-xs bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded text-[var(--ed-text-primary)] placeholder-[var(--ed-text-muted)] focus:border-[var(--ed-accent-orange)] focus:outline-none"
            />
            <button onClick={onClose} className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg">
              ✕
            </button>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-[var(--ed-border)] overflow-x-auto">
          {KIT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 text-[10px] font-medium rounded-full whitespace-nowrap transition-colors ${
                selectedCategory === cat
                  ? "bg-[var(--ed-accent-orange)] text-black font-bold"
                  : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Kit Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {filteredKits.map((kit) => (
              <button
                key={kit.id}
                onClick={() => loadKit(kit.id)}
                className="text-left p-3 rounded-lg bg-[var(--ed-bg-surface)] border border-[var(--ed-border)] hover:border-[var(--ed-accent-orange)]/50 hover:bg-[var(--ed-bg-elevated)] transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold text-[var(--ed-text-primary)] group-hover:text-[var(--ed-accent-orange)] transition-colors">
                    {kit.name}
                  </span>
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-[var(--ed-bg-primary)] text-[var(--ed-text-muted)]">
                    {kit.category}
                  </span>
                </div>

                <div className="flex gap-1 flex-wrap mb-1.5">
                  {kit.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="text-[7px] px-1 py-0.5 rounded bg-[var(--ed-bg-elevated)] text-[var(--ed-text-muted)]">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[8px] text-[var(--ed-text-muted)]">
                    {kit.bpmRange[0]}–{kit.bpmRange[1]} BPM
                  </span>
                  {kit.pattern && (
                    <span className="text-[8px] text-[var(--ed-accent-green)]">
                      + pattern
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {filteredKits.length === 0 && (
            <p className="text-center text-xs text-[var(--ed-text-muted)] py-8">
              No kits found for "{searchQuery}"
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
