import { useState, useCallback, useRef, useEffect } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { getSamplesForVoice, getSampleById } from "../audio/SampleLibrary";
import type { LibrarySample, SampleCategory } from "../audio/SampleLibrary";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM LO",
  "TOM MID", "TOM HI", "HH CL", "HH OP",
  "CYMBAL", "RIDE", "PERC 1", "PERC 2",
];

const CATEGORY_NAMES: Record<SampleCategory, string> = {
  "kicks": "KICKS",
  "boom-kicks": "BOOM",
  "snares": "SNARES",
  "rims": "RIMS",
  "hats": "HATS",
  "hats-closed": "HH CL",
  "hats-open": "HH OP",
  "claps": "CLAPS",
  "cymbals": "CYMBALS",
  "toms": "TOMS",
  "percussions": "PERC",
  "shakers": "SHAKE",
  "snaps": "SNAPS",
  "sfx": "SFX",
  "chords": "CHORD",
  "oneshots": "1-SHOT",
};

interface SampleBrowserProps {
  isOpen: boolean;
  voiceIndex: number;
  selectedSampleId?: string;
  onClose: () => void;
  onSelect: (sample: LibrarySample | null) => void;
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
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const keydownListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null);

  const voiceLabel = VOICE_LABELS[voiceIndex] || "SAMPLE";
  const availableSamples = getSamplesForVoice(voiceIndex);

  // Get unique categories for this voice
  const categories = Array.from(
    new Set(availableSamples.map(s => s.category))
  ).sort((a, b) => {
    const orderMap: Record<SampleCategory, number> = {
      kicks: 0, "boom-kicks": 1, snares: 2, rims: 3, claps: 4, snaps: 5,
      hats: 6, "hats-closed": 7, "hats-open": 8, cymbals: 9, toms: 10, percussions: 11, shakers: 12, sfx: 13, chords: 14, oneshots: 15,
    };
    return (orderMap[a] ?? 16) - (orderMap[b] ?? 16);
  });

  // Set initial category if not set
  useEffect(() => {
    if (activeCategory === null && categories.length > 0) {
      setActiveCategory(categories[0] ?? null);
    }
  }, [categories, activeCategory]);

  // Filter samples
  const filteredSamples = availableSamples.filter(s => {
    if (activeCategory && s.category !== activeCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q);
    }
    return true;
  });

  // Stop any playing preview when closing
  useEffect(() => {
    if (!isOpen && previewSourceRef.current) {
      try {
        previewSourceRef.current.stop();
        previewSourceRef.current.disconnect();
      } catch (e) {
        // Already stopped
      }
      previewSourceRef.current = null;
      setPreviewingId(null);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && previewingId) {
        const sample = getSampleById(previewingId);
        if (sample) {
          onSelect(sample);
          onClose();
        }
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = listRef.current?.querySelectorAll("[data-sample-id]");
        if (!items || items.length === 0) return;

        const currentIdx = previewingId
          ? Array.from(items).findIndex(
              item => (item as HTMLElement).dataset.sampleId === previewingId
            )
          : -1;

        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(currentIdx + 1, items.length - 1)
            : Math.max(currentIdx - 1, 0);

        const nextId = (items[nextIdx] as HTMLElement).dataset.sampleId;
        if (nextId) {
          setPreviewingId(nextId);
          items[nextIdx]?.scrollIntoView({ block: "nearest" });
        }
      }
    };

    keydownListenerRef.current = handleKeydown;
    window.addEventListener("keydown", handleKeydown);

    return () => {
      if (keydownListenerRef.current) {
        window.removeEventListener("keydown", keydownListenerRef.current);
      }
    };
  }, [isOpen, previewingId, onClose, onSelect]);

  const playPreview = useCallback(async (sample: LibrarySample) => {
    // Stop any existing preview
    if (previewSourceRef.current) {
      try {
        previewSourceRef.current.stop();
        previewSourceRef.current.disconnect();
      } catch (e) {
        // Already stopped
      }
    }

    setPreviewingId(sample.id);
    setIsPreloading(true);

    try {
      const response = await fetch(sample.path);
      const arrayBuffer = await response.arrayBuffer();
      const ctx = audioEngine.getAudioContext();
      if (!ctx) throw new Error("AudioContext not initialized");

      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      // Play through the voice's channel
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      const output = audioEngine.getChannelOutput(voiceIndex);
      source.connect(output);
      source.start(ctx.currentTime);

      previewSourceRef.current = source;

      // Auto-stop after duration
      setTimeout(() => {
        try {
          if (previewSourceRef.current === source) {
            source.stop();
            source.disconnect();
            previewSourceRef.current = null;
          }
        } catch (e) {
          // Already stopped
        }
      }, audioBuffer.duration * 1000 + 100);
    } catch (err) {
      console.error("Failed to preview sample:", err);
    } finally {
      setIsPreloading(false);
    }
  }, [voiceIndex]);

  const handleSampleClick = useCallback(
    (sample: LibrarySample) => {
      playPreview(sample);
    },
    [playPreview]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[var(--ed-bg-surface)] border border-[var(--ed-border)] rounded-lg w-96 max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-[var(--ed-border)]">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-[var(--ed-text-primary)]">
              SELECT SAMPLE — {voiceLabel}
            </h2>
            <button
              onClick={onClose}
              className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg leading-none"
            >
              ×
            </button>
          </div>
          <input
            type="text"
            placeholder="Search samples..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-2 py-1.5 bg-[var(--ed-bg-elevated)] border border-[var(--ed-border)] rounded text-xs text-[var(--ed-text-primary)] placeholder-[var(--ed-text-muted)]"
          />
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 p-2 border-b border-[var(--ed-border)] overflow-x-auto">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => {
                setActiveCategory(cat);
                setSearchQuery("");
              }}
              className={`px-2 py-1 text-[10px] font-bold rounded whitespace-nowrap transition-colors ${
                activeCategory === cat
                  ? "bg-[var(--ed-accent-green)] text-black"
                  : "bg-[var(--ed-bg-elevated)] text-[var(--ed-text-secondary)] hover:bg-[var(--ed-border)]"
              }`}
            >
              {CATEGORY_NAMES[cat]}
            </button>
          ))}
        </div>

        {/* Sample list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-2 space-y-1"
        >
          {filteredSamples.length === 0 ? (
            <div className="text-xs text-[var(--ed-text-muted)] text-center py-8">
              No samples found
            </div>
          ) : (
            filteredSamples.map(sample => {
              const isSelected = sample.id === selectedSampleId;
              const isPreviewing = sample.id === previewingId;

              return (
                <button
                  key={sample.id}
                  data-sample-id={sample.id}
                  onClick={() => handleSampleClick(sample)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between group ${
                    isPreviewing
                      ? "bg-[var(--ed-accent-green)]/20 text-[var(--ed-accent-green)]"
                      : isSelected
                        ? "bg-[var(--ed-accent-green)]/10 text-[var(--ed-text-primary)]"
                        : "bg-transparent text-[var(--ed-text-secondary)] hover:bg-[var(--ed-border)]"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{sample.name}</div>
                    {sample.key && (
                      <div className="text-[9px] opacity-60 truncate">
                        Key: {sample.key}
                      </div>
                    )}
                  </div>
                  {isPreviewing && (
                    <div className="ml-1 text-xs font-bold">
                      {isPreloading ? "..." : ">"}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[var(--ed-border)] flex gap-2 justify-between">
          <button
            onClick={() => onSelect(null)}
            className="px-3 py-1.5 text-xs font-bold bg-[var(--ed-bg-elevated)] text-[var(--ed-text-secondary)] border border-[var(--ed-border)] rounded hover:bg-[var(--ed-border)] transition-colors"
          >
            CLEAR
          </button>
          <button
            onClick={() => {
              if (previewingId) {
                const sample = getSampleById(previewingId);
                if (sample) {
                  onSelect(sample);
                  onClose();
                }
              }
            }}
            disabled={!previewingId}
            className="px-3 py-1.5 text-xs font-bold bg-[var(--ed-accent-green)] text-black rounded disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:opacity-90 transition-opacity"
          >
            CONFIRM
          </button>
        </div>
      </div>
    </div>
  );
}
