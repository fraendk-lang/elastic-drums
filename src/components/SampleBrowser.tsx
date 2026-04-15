import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { SAMPLE_LIBRARY, VOICE_CATEGORIES, getSampleById } from "../audio/SampleLibrary";
import type { LibrarySample, SampleCategory } from "../audio/SampleLibrary";

type BrowserScope = "all" | "suggested" | "recent";
const RECENT_SAMPLE_STORAGE_KEY = "elastic-drums-recent-samples";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM LO",
  "TOM MID", "TOM HI", "HH CL", "HH OP",
  "CYMBAL", "RIDE", "PERC 1", "PERC 2",
];

const CATEGORY_NAMES: Record<SampleCategory, string> = {
  "kicks": "KICKS",
  "boom-kicks": "BOOM KICKS",
  "snares": "SNARES",
  "rims": "RIMS",
  "hats": "HATS",
  "hats-closed": "CLOSED HATS",
  "hats-open": "OPEN HATS",
  "claps": "CLAPS",
  "cymbals": "CYMBALS",
  "toms": "TOMS",
  "percussions": "PERCUSSION",
  "shakers": "SHAKERS",
  "snaps": "SNAPS",
  "sfx": "SFX",
  "chords": "CHORD SHOTS",
  "oneshots": "ONE SHOTS",
};

interface SampleBrowserProps {
  isOpen: boolean;
  voiceIndex: number;
  selectedSampleId?: string;
  onClose: () => void;
  onSelect: (sample: LibrarySample | null) => Promise<void> | void;
}

function prettifyPack(pack?: string): string {
  if (!pack) return "CORE";
  return pack
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isBrowsableSample(sample: LibrarySample): boolean {
  return !sample.id.endsWith("-") && !sample.path.endsWith("-.ogg");
}

function sortSamplesForVoice(
  samples: LibrarySample[],
  scope: BrowserScope,
  suggestedCategories: SampleCategory[]
): LibrarySample[] {
  if (scope === "recent") return samples;

  return [...samples].sort((a, b) => {
    const aRank = suggestedCategories.indexOf(a.category);
    const bRank = suggestedCategories.indexOf(b.category);
    const aSuggested = aRank >= 0 ? aRank : 999;
    const bSuggested = bRank >= 0 ? bRank : 999;

    if (aSuggested !== bSuggested) return aSuggested - bSuggested;

    const categoryCompare = CATEGORY_NAMES[a.category].localeCompare(CATEGORY_NAMES[b.category]);
    if (categoryCompare !== 0) return categoryCompare;

    const packCompare = prettifyPack(a.pack).localeCompare(prettifyPack(b.pack));
    if (packCompare !== 0) return packCompare;

    return a.name.localeCompare(b.name);
  });
}

export function SampleBrowser({
  isOpen,
  voiceIndex,
  selectedSampleId,
  onClose,
  onSelect,
}: SampleBrowserProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<SampleCategory | null>(null);
  const [activePack, setActivePack] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [activeSampleId, setActiveSampleId] = useState<string | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [scope, setScope] = useState<BrowserScope>("all");
  const [recentSampleIds, setRecentSampleIds] = useState<string[]>([]);

  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const keydownListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null);

  const voiceLabel = VOICE_LABELS[voiceIndex] || "SAMPLE";
  const suggestedCategories = useMemo(() => VOICE_CATEGORIES[voiceIndex] ?? [], [voiceIndex]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(RECENT_SAMPLE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecentSampleIds(parsed.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      // Ignore invalid persisted state
    }
  }, []);

  const availableSamples = useMemo(() => {
    if (scope === "suggested") {
      return sortSamplesForVoice(
        SAMPLE_LIBRARY.filter((sample) => isBrowsableSample(sample) && suggestedCategories.includes(sample.category)),
        scope,
        suggestedCategories
      );
    }

    if (scope === "recent") {
      const recentMap = new Map(recentSampleIds.map((id, index) => [id, index]));
      return SAMPLE_LIBRARY
        .filter((sample) => isBrowsableSample(sample) && recentMap.has(sample.id))
        .sort((a, b) => (recentMap.get(a.id) ?? 0) - (recentMap.get(b.id) ?? 0));
    }

    return sortSamplesForVoice(
      SAMPLE_LIBRARY.filter((sample) => isBrowsableSample(sample)),
      scope,
      suggestedCategories
    );
  }, [recentSampleIds, scope, suggestedCategories]);

  const categoryStats = useMemo(() => {
    const counts = new Map<SampleCategory, number>();
    for (const sample of availableSamples) {
      counts.set(sample.category, (counts.get(sample.category) ?? 0) + 1);
    }
    return counts;
  }, [availableSamples]);

  const categories = useMemo(() => (
    Array.from(categoryStats.keys()).sort((a, b) => CATEGORY_NAMES[a].localeCompare(CATEGORY_NAMES[b]))
  ), [categoryStats]);

  useEffect(() => {
    if (!isOpen) return;

    if (scope === "all") {
      setActiveCategory(null);
      return;
    }

    if (scope === "suggested") {
      if (activeCategory && suggestedCategories.includes(activeCategory)) return;
      setActiveCategory(suggestedCategories[0] ?? null);
      return;
    }

    if (scope === "recent") {
      if (activeCategory && categories.includes(activeCategory)) return;
      setActiveCategory(null);
    }
  }, [isOpen, scope, activeCategory, categories, suggestedCategories]);

  const packs = useMemo(() => {
    const packSet = new Set<string>();
    for (const sample of availableSamples) {
      if (sample.pack) packSet.add(sample.pack);
    }
    return Array.from(packSet).sort((a, b) => a.localeCompare(b));
  }, [availableSamples]);

  const filteredSamples = useMemo(() => (
    availableSamples.filter((sample) => {
      if (activeCategory && sample.category !== activeCategory) return false;
      if (activePack && sample.pack !== activePack) return false;
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return [
        sample.name,
        sample.key,
        sample.pack ?? "",
        CATEGORY_NAMES[sample.category],
      ].some((value) => value.toLowerCase().includes(query));
    })
  ), [availableSamples, activeCategory, activePack, searchQuery]);

  const activeSample = useMemo(
    () => (activeSampleId ? getSampleById(activeSampleId) : undefined),
    [activeSampleId]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (selectedSampleId) {
      setActiveSampleId(selectedSampleId);
      setPreviewingId(selectedSampleId);
    } else if (filteredSamples.length > 0) {
      const firstId = filteredSamples[0]?.id ?? null;
      setActiveSampleId(firstId);
      setPreviewingId(firstId);
    }
  }, [isOpen, selectedSampleId, filteredSamples]);

  useEffect(() => {
    if (!isOpen && previewSourceRef.current) {
      try {
        previewSourceRef.current.stop();
        previewSourceRef.current.disconnect();
      } catch {
        // no-op
      }
      previewSourceRef.current = null;
      setPreviewingId(null);
      setActiveSampleId(null);
      setIsApplying(false);
      setApplyError(null);
    }
  }, [isOpen]);

  const handleApplySample = useCallback(async (sampleId: string | null) => {
    setApplyError(null);
    setIsApplying(true);

    try {
      if (sampleId === null) {
        await onSelect(null);
        return;
      }

      const sample = getSampleById(sampleId);
      if (!sample) {
        throw new Error("Selected sample could not be resolved.");
      }

      setRecentSampleIds((prev) => {
        const next = [sample.id, ...prev.filter((id) => id !== sample.id)].slice(0, 24);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(RECENT_SAMPLE_STORAGE_KEY, JSON.stringify(next));
        }
        return next;
      });
      await onSelect(sample);
    } catch (err) {
      console.error("Failed to assign sample:", err);
      setApplyError(err instanceof Error ? err.message : "Sample could not be loaded.");
    } finally {
      setIsApplying(false);
    }
  }, [onSelect]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "Enter" && activeSampleId) {
        void handleApplySample(activeSampleId);
        return;
      }

      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();

      if (filteredSamples.length === 0) return;
      const currentIndex = activeSampleId
        ? filteredSamples.findIndex((sample) => sample.id === activeSampleId)
        : -1;

      const nextIndex = e.key === "ArrowDown"
        ? Math.min(currentIndex + 1, filteredSamples.length - 1)
        : Math.max(currentIndex - 1, 0);

      const next = filteredSamples[nextIndex];
      if (!next) return;
      setActiveSampleId(next.id);
      setPreviewingId(next.id);

      const node = listRef.current?.querySelector<HTMLElement>(`[data-sample-id="${next.id}"]`);
      node?.scrollIntoView({ block: "nearest" });
    };

    keydownListenerRef.current = handleKeydown;
    window.addEventListener("keydown", handleKeydown);

    return () => {
      if (keydownListenerRef.current) {
        window.removeEventListener("keydown", keydownListenerRef.current);
      }
    };
  }, [isOpen, activeSampleId, filteredSamples, onClose]);

  const stopPreview = useCallback(() => {
    if (!previewSourceRef.current) return;
    try {
      previewSourceRef.current.stop();
      previewSourceRef.current.disconnect();
    } catch {
      // no-op
    }
    previewSourceRef.current = null;
  }, []);

  const playPreview = useCallback(async (sample: LibrarySample) => {
    stopPreview();
    setPreviewingId(sample.id);
    setActiveSampleId(sample.id);
    setIsPreloading(true);

    try {
      const response = await fetch(sample.path);
      const arrayBuffer = await response.arrayBuffer();
      await audioEngine.resume();
      const ctx = audioEngine.getAudioContext();
      if (!ctx) throw new Error("AudioContext not initialized");

      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioEngine.getChannelOutput(voiceIndex));
      source.start(ctx.currentTime);
      previewSourceRef.current = source;

      setTimeout(() => {
        if (previewSourceRef.current === source) {
          stopPreview();
        }
      }, audioBuffer.duration * 1000 + 100);
    } catch (err) {
      console.error("Failed to preview sample:", err);
    } finally {
      setIsPreloading(false);
    }
  }, [stopPreview, voiceIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-3 md:p-6">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative w-full max-w-6xl h-[min(86vh,820px)] rounded-2xl overflow-hidden border border-[var(--ed-border)] bg-[var(--ed-bg-secondary)] shadow-[0_18px_120px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ed-border)]">
          <div>
            <div className="text-[11px] font-black tracking-[0.24em] text-[var(--ed-text-primary)]">
              SAMPLE LIBRARY
            </div>
            <div className="text-[10px] text-[var(--ed-text-muted)] mt-1">
              Curated browser for {voiceLabel} with preview, packs and direct assignment
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-white/5 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="grid h-[calc(100%-65px)] min-h-0 md:grid-cols-[220px,minmax(0,1fr)] md:grid-rows-[minmax(0,1fr),auto] xl:grid-cols-[220px,minmax(0,1fr),280px] xl:grid-rows-1">
          <aside className="min-h-0 border-b border-[var(--ed-border)] p-4 overflow-y-auto md:row-span-2 md:border-b-0 md:border-r xl:row-span-1">
            <div className="text-[10px] font-bold tracking-[0.2em] text-[var(--ed-text-secondary)] mb-3">
              CATEGORIES
            </div>
            <div className="space-y-1.5">
              <button
                onClick={() => {
                  setActiveCategory(null);
                  setActivePack(null);
                }}
                className={`w-full px-3 py-2 rounded-xl text-left text-[11px] transition-colors flex items-center justify-between ${
                  activeCategory === null
                    ? "bg-[var(--ed-accent-green)]/14 text-[var(--ed-accent-green)] border border-[var(--ed-accent-green)]/25"
                    : "bg-[var(--ed-bg-surface)]/35 text-[var(--ed-text-secondary)] border border-transparent hover:bg-[var(--ed-bg-surface)]/65"
                }`}
              >
                <span className="font-bold">ALL CATEGORIES</span>
                <span className="text-[10px] opacity-70">{availableSamples.length}</span>
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => {
                    setActiveCategory(category);
                    setActivePack(null);
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-left text-[11px] transition-colors flex items-center justify-between ${
                    activeCategory === category
                      ? "bg-[var(--ed-accent-green)]/14 text-[var(--ed-accent-green)] border border-[var(--ed-accent-green)]/25"
                      : "bg-[var(--ed-bg-surface)]/35 text-[var(--ed-text-secondary)] border border-transparent hover:bg-[var(--ed-bg-surface)]/65"
                  }`}
                >
                  <span className="font-bold">{CATEGORY_NAMES[category]}</span>
                  <span className="text-[10px] opacity-70">{categoryStats.get(category) ?? 0}</span>
                </button>
              ))}
            </div>

            <div className="mt-5 text-[10px] font-bold tracking-[0.2em] text-[var(--ed-text-secondary)] mb-3">
              PACKS
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActivePack(null)}
                className={`px-2.5 py-1.5 rounded-full text-[10px] font-bold transition-colors ${
                  activePack === null
                    ? "bg-white/12 text-[var(--ed-text-primary)]"
                    : "bg-[var(--ed-bg-surface)]/45 text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
                }`}
              >
                ALL
              </button>
              {packs.map((pack) => (
                <button
                  key={pack}
                  onClick={() => setActivePack(pack)}
                  className={`px-2.5 py-1.5 rounded-full text-[10px] font-bold transition-colors ${
                    activePack === pack
                      ? "bg-[var(--ed-accent-orange)]/14 text-[var(--ed-accent-orange)]"
                      : "bg-[var(--ed-bg-surface)]/45 text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
                  }`}
                >
                  {prettifyPack(pack)}
                </button>
              ))}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col min-w-0 border-b border-[var(--ed-border)] md:border-b-0 xl:border-r">
            <div className="p-4 border-b border-[var(--ed-border)] space-y-3">
              <div className="flex flex-wrap gap-2">
                {([
                  { id: "all", label: "ALL SAMPLES", count: SAMPLE_LIBRARY.length },
                  { id: "suggested", label: `SUGGESTED FOR ${voiceLabel}`, count: SAMPLE_LIBRARY.filter((sample) => suggestedCategories.includes(sample.category)).length },
                  { id: "recent", label: "RECENT", count: recentSampleIds.length },
                ] as Array<{ id: BrowserScope; label: string; count: number }>).map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setScope(option.id);
                      setActivePack(null);
                    }}
                    className={`rounded-full px-3 py-1.5 text-[10px] font-bold tracking-[0.14em] transition-colors ${
                      scope === option.id
                        ? "bg-[var(--ed-accent-green)]/16 text-[var(--ed-accent-green)] border border-[var(--ed-accent-green)]/25"
                        : "bg-[var(--ed-bg-surface)]/45 text-[var(--ed-text-muted)] border border-transparent hover:text-[var(--ed-text-secondary)]"
                    }`}
                  >
                    {option.label} · {option.count}
                  </button>
                ))}
              </div>

              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <input
                  type="text"
                  placeholder="Search name, key, pack..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 px-3 py-2.5 bg-[var(--ed-bg-elevated)] border border-[var(--ed-border)] rounded-xl text-sm text-[var(--ed-text-primary)] placeholder-[var(--ed-text-muted)]"
                />
                <div className="shrink-0 rounded-xl px-3 py-2 bg-[var(--ed-bg-surface)]/45 border border-[var(--ed-border)] text-[10px] text-[var(--ed-text-secondary)]">
                  {filteredSamples.length} matches
                </div>
              </div>

              <div className="flex items-center gap-2 text-[10px] text-[var(--ed-text-muted)]">
                <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/8">
                  {scope === "all" ? "Full project library" : scope === "suggested" ? `Suggested for ${voiceLabel}` : "Recently loaded"}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/8">
                  {activeCategory ? CATEGORY_NAMES[activeCategory] : "All categories"}
                </span>
                {activePack && (
                  <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/8">
                    {prettifyPack(activePack)}
                  </span>
                )}
              </div>
            </div>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
              {filteredSamples.length === 0 ? (
                <div className="h-full min-h-[260px] rounded-2xl border border-dashed border-[var(--ed-border)] flex items-center justify-center text-[12px] text-[var(--ed-text-muted)]">
                  No samples match the current search and filters.
                </div>
              ) : (
                filteredSamples.map((sample) => {
                  const isSelected = sample.id === selectedSampleId;
                  const isPreviewing = sample.id === previewingId;
                  const isActive = sample.id === activeSampleId;

                  return (
                    <button
                      key={sample.id}
                      data-sample-id={sample.id}
                      onClick={() => {
                        setActiveSampleId(sample.id);
                        playPreview(sample);
                      }}
                      className={`w-full rounded-2xl px-4 py-3 text-left transition-colors border ${
                        isPreviewing
                          ? "bg-[var(--ed-accent-green)]/10 border-[var(--ed-accent-green)]/35"
                          : isActive
                            ? "bg-white/5 border-white/10"
                            : "bg-transparent border-transparent hover:bg-white/4"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className={`text-[12px] font-bold truncate ${
                            isSelected ? "text-[var(--ed-text-primary)]" : "text-[var(--ed-text-secondary)]"
                          }`}>
                            {sample.name}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[var(--ed-text-muted)]">
                            <span>{CATEGORY_NAMES[sample.category]}</span>
                            {sample.key && <span>Key {sample.key}</span>}
                            {sample.pack && <span>{prettifyPack(sample.pack)}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          {isSelected && (
                            <span className="px-2 py-1 rounded-full bg-[var(--ed-accent-green)]/14 text-[var(--ed-accent-green)] text-[9px] font-bold tracking-[0.12em]">
                              LOADED
                            </span>
                          )}
                          {isPreviewing && (
                            <span className="text-[11px] font-black text-[var(--ed-accent-green)]">
                              {isPreloading ? "..." : "PLAY"}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <aside className="min-h-0 overflow-y-auto border-t border-[var(--ed-border)] p-4 md:col-start-2 xl:col-start-auto xl:border-t-0">
            <div className="text-[10px] font-bold tracking-[0.2em] text-[var(--ed-text-secondary)] mb-3">
              INSPECTOR
            </div>

            {activeSample ? (
              <div className="flex min-h-0 flex-col space-y-4">
                <div className="rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/35 p-4">
                  <div className="text-[18px] font-black leading-tight text-[var(--ed-text-primary)]">
                    {activeSample.name}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                    <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/8 text-[var(--ed-text-secondary)]">
                      {CATEGORY_NAMES[activeSample.category]}
                    </span>
                    {activeSample.key && (
                      <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/8 text-[var(--ed-text-secondary)]">
                        Key {activeSample.key}
                      </span>
                    )}
                    <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/8 text-[var(--ed-text-secondary)]">
                      {prettifyPack(activeSample.pack)}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/35 p-4 space-y-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--ed-text-muted)]">Voice target</span>
                    <span className="font-bold text-[var(--ed-text-primary)]">{voiceLabel}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--ed-text-muted)]">Preview</span>
                    <span className={previewingId === activeSample.id ? "font-bold text-[var(--ed-accent-green)]" : "text-[var(--ed-text-muted)]"}>
                      {previewingId === activeSample.id ? "Active" : "Idle"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--ed-text-muted)]">Loaded on pad</span>
                    <span className={selectedSampleId === activeSample.id ? "font-bold text-[var(--ed-accent-green)]" : "text-[var(--ed-text-muted)]"}>
                      {selectedSampleId === activeSample.id ? "Yes" : "No"}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/35 p-4 space-y-2">
                  <div className="text-[10px] font-bold tracking-[0.18em] text-[var(--ed-text-secondary)]">
                    WORKFLOW
                  </div>
                  <div className="text-[11px] leading-5 text-[var(--ed-text-muted)]">
                    Click a row to preview. Arrow keys move through the list. Press Enter to assign instantly.
                  </div>
                </div>

                <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]/95 pt-3 backdrop-blur-md">
                  <button
                    onClick={() => {
                      void handleApplySample(null);
                    }}
                    disabled={isApplying}
                    className="rounded-xl px-3 py-3 text-[10px] font-bold tracking-[0.14em] bg-[var(--ed-bg-elevated)] border border-[var(--ed-border)] text-[var(--ed-text-secondary)] hover:bg-white/5 transition-colors disabled:opacity-60"
                  >
                    {isApplying ? "WORKING..." : "CLEAR"}
                  </button>
                  <button
                    onClick={() => {
                      void handleApplySample(activeSample.id);
                    }}
                    disabled={isApplying}
                    className="rounded-xl px-3 py-3 text-[10px] font-black tracking-[0.14em] bg-[var(--ed-accent-green)] text-black hover:opacity-90 transition-opacity disabled:opacity-60"
                  >
                    {isApplying ? "LOADING..." : "CONFIRM"}
                  </button>
                </div>
                {applyError && (
                  <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                    {applyError}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--ed-border)] p-8 text-center text-[12px] text-[var(--ed-text-muted)]">
                Choose a sample to inspect its metadata and load it onto the selected pad.
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
