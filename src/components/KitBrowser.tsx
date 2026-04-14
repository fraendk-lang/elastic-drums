/**
 * Kit Browser — Soundset-based navigation
 *
 * Top row: Soundset categories (808, 909, Trap, DnB, etc.) as large selectable cards.
 * Below: Variations within the selected soundset, with instant preview.
 * Click a soundset = loads the default kit. Click a variation = switches to it.
 */

import { useState, useCallback, useMemo } from "react";
import { useDrumStore } from "../store/drumStore";
import { FACTORY_KITS, KIT_CATEGORIES } from "../kits/factoryKits";
import { applyKit, kitToPattern } from "../kits/KitManager";
import type { DrumKit } from "../kits/KitManager";
import { SAMPLE_KITS, loadSampleKit } from "../audio/SampleKitLoader";
import { sampleManager } from "../audio/SampleManager";

interface KitBrowserProps {
  isOpen: boolean;
  onClose: () => void;
}

// Soundset = a category with its kits grouped together
interface Soundset {
  id: string;
  label: string;
  description: string;
  color: string;
  kits: DrumKit[];
}

const SOUNDSET_COLORS: Record<string, string> = {
  "808":       "#f59e0b",
  "909":       "#3b82f6",
  "Trap":      "#ef4444",
  "DnB":       "#10b981",
  "Electro":   "#06b6d4",
  "Retro":     "#a855f7",
  "World":     "#f97316",
  "Acoustic":  "#84cc16",
  "Ambient":   "#8b5cf6",
  "Cinematic": "#64748b",
};

const SOUNDSET_DESCRIPTIONS: Record<string, string> = {
  "808":       "Classic Roland TR-808 emulations — deep kicks, snappy snares",
  "909":       "Roland TR-909 & house/techno variations — punchy, bright",
  "Trap":      "Modern trap & drill — heavy 808s, rapid hats, hard snares",
  "DnB":       "Drum & Bass — breakbeats, liquid, neurofunk",
  "Electro":   "Electro & industrial — EBM, aggressive, cold",
  "Retro":     "80s synth-pop, Italo disco, synthwave",
  "World":     "Afrobeats, Amapiano, Latin, Reggaeton",
  "Acoustic":  "Natural drum kits — jazz brush, acoustic, organic",
  "Ambient":   "Ambient textures, IDM, glitch, experimental",
  "Cinematic": "Film scoring — impacts, tension, atmospheric",
};

function buildSoundsets(kits: DrumKit[]): Soundset[] {
  const categories = KIT_CATEGORIES.filter((c) => c !== "All");
  return categories.map((cat) => ({
    id: cat.toLowerCase().replace(/\s+/g, "-"),
    label: cat,
    description: SOUNDSET_DESCRIPTIONS[cat] ?? "",
    color: SOUNDSET_COLORS[cat] ?? "#6b7280",
    kits: kits.filter((k) => k.category === cat),
  })).filter((s) => s.kits.length > 0);
}

export function KitBrowser({ isOpen, onClose }: KitBrowserProps) {
  const [activeSoundset, setActiveSoundset] = useState<string | null>(null);
  const [activeKitId, setActiveKitId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingSampleKit, setLoadingSampleKit] = useState(false);

  const soundsets = useMemo(() => buildSoundsets(FACTORY_KITS), []);

  const filteredSoundsets = useMemo(() => {
    if (!searchQuery) return soundsets;
    const q = searchQuery.toLowerCase();
    return soundsets.map((s) => ({
      ...s,
      kits: s.kits.filter((k) =>
        k.name.toLowerCase().includes(q) ||
        k.tags.some((t) => t.includes(q)) ||
        k.category.toLowerCase().includes(q)
      ),
    })).filter((s) => s.kits.length > 0);
  }, [soundsets, searchQuery]);

  const selectedSoundset = filteredSoundsets.find((s) => s.id === activeSoundset) ?? null;

  const loadKit = useCallback((kit: DrumKit, autoPlay = true) => {
    const { isPlaying, togglePlay } = useDrumStore.getState();
    if (isPlaying) togglePlay();

    applyKit(kit);
    setActiveKitId(kit.id);

    const pattern = kitToPattern(kit);
    if (pattern) {
      useDrumStore.setState({
        pattern,
        bpm: Math.round((kit.bpmRange[0] + kit.bpmRange[1]) / 2),
        currentStep: 0,
        currentPatternIndex: -1,
      });
    }

    if (autoPlay && pattern) {
      setTimeout(() => {
        if (!useDrumStore.getState().isPlaying) {
          useDrumStore.getState().togglePlay();
        }
      }, 50);
    }
  }, []);

  const loadSampleKitHandler = useCallback(async (kitId: string) => {
    const kit = SAMPLE_KITS.find((k) => k.id === kitId);
    if (!kit) return;

    setLoadingSampleKit(true);
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const buffers = await loadSampleKit(ctx, kit);

      // Load each buffer into the corresponding voice
      const voiceMap = [
        "kick", "snare", "clap", "tom-lo", "tom-mid", "tom-hi",
        "hh-closed", "hh-open", "cymbal", "ride", "perc1", "perc2",
      ];

      for (let i = 0; i < buffers.length; i++) {
        const buffer = buffers[i];
        if (buffer && voiceMap[i]) {
          sampleManager.loadFromBuffer(buffer, voiceMap[i]!, i);
        }
      }

      setActiveKitId(kit.id);
      // Stop playback when loading samples
      const { isPlaying, togglePlay } = useDrumStore.getState();
      if (isPlaying) togglePlay();

      console.log(`Sample kit "${kit.name}" loaded`);
    } catch (error) {
      console.error("Failed to load sample kit:", error);
    } finally {
      setLoadingSampleKit(false);
    }
  }, []);

  const handleSoundsetClick = useCallback((soundset: Soundset) => {
    setActiveSoundset(soundset.id);
    // Auto-load the first kit in this soundset
    if (soundset.kits.length > 0) {
      loadKit(soundset.kits[0]!);
    }
  }, [loadKit]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-4xl max-h-[85vh] bg-[var(--ed-bg-secondary)] border border-[var(--ed-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ed-border)]">
          <div>
            <h2 className="text-sm font-bold text-[var(--ed-text-primary)] tracking-wider">
              SOUNDSETS
            </h2>
            <p className="text-[10px] text-[var(--ed-text-muted)] mt-0.5">
              {soundsets.length} sets &middot; {FACTORY_KITS.length} kits
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-36 h-7 px-2 text-xs bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded text-[var(--ed-text-primary)] placeholder-[var(--ed-text-muted)] focus:border-[var(--ed-accent-orange)] focus:outline-none"
            />
            <button onClick={onClose} className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg px-1" aria-label="Close">
              &times;
            </button>
          </div>
        </div>

        {/* Soundset Cards + Variations */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: Soundset cards */}
          <div className="w-56 border-r border-[var(--ed-border)] overflow-y-auto p-3 flex flex-col gap-1.5">
            {/* Sample Kits Section */}
            {SAMPLE_KITS.length > 0 && (
              <>
                <div className="text-[9px] font-bold text-[var(--ed-text-muted)] px-1 py-2 border-b border-[var(--ed-border)]">
                  SAMPLE KITS
                </div>
                {SAMPLE_KITS.map((sampleKit) => {
                  const isActive = activeKitId === sampleKit.id;
                  return (
                    <button
                      key={sampleKit.id}
                      onClick={() => loadSampleKitHandler(sampleKit.id)}
                      disabled={loadingSampleKit}
                      className={`text-left p-3 rounded-lg transition-all ${
                        isActive
                          ? "border-2"
                          : "border border-[var(--ed-border)] hover:border-opacity-50"
                      } ${loadingSampleKit ? "opacity-50 cursor-not-allowed" : ""}`}
                      style={{
                        backgroundColor: isActive ? "#ec4899" + "15" : "var(--ed-bg-surface)",
                        borderColor: isActive ? "#ec4899" : undefined,
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: "#ec4899" }}
                        />
                        <span
                          className="text-[11px] font-bold tracking-wider"
                          style={{ color: isActive ? "#ec4899" : "var(--ed-text-primary)" }}
                        >
                          {sampleKit.name}
                        </span>
                      </div>
                      <p className="text-[8px] text-[var(--ed-text-muted)] leading-relaxed">
                        {loadingSampleKit && activeKitId === sampleKit.id ? "Loading..." : "12 drum samples"}
                      </p>
                    </button>
                  );
                })}
                <div className="h-2" />
              </>
            )}

            {filteredSoundsets.map((soundset) => {
              const isActive = activeSoundset === soundset.id;
              return (
                <button
                  key={soundset.id}
                  onClick={() => handleSoundsetClick(soundset)}
                  className={`text-left p-3 rounded-lg transition-all ${
                    isActive
                      ? "border-2"
                      : "border border-[var(--ed-border)] hover:border-opacity-50"
                  }`}
                  style={{
                    backgroundColor: isActive ? soundset.color + "15" : "var(--ed-bg-surface)",
                    borderColor: isActive ? soundset.color : undefined,
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: soundset.color }}
                    />
                    <span
                      className="text-[11px] font-bold tracking-wider"
                      style={{ color: isActive ? soundset.color : "var(--ed-text-primary)" }}
                    >
                      {soundset.label}
                    </span>
                    <span className="text-[8px] text-[var(--ed-text-muted)] ml-auto">
                      {soundset.kits.length}
                    </span>
                  </div>
                  <p className="text-[8px] text-[var(--ed-text-muted)] leading-relaxed line-clamp-2">
                    {soundset.description}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Right: Kit variations within selected soundset */}
          <div className="flex-1 overflow-y-auto p-4">
            {selectedSoundset ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: selectedSoundset.color }}
                  />
                  <h3
                    className="text-xs font-bold tracking-wider"
                    style={{ color: selectedSoundset.color }}
                  >
                    {selectedSoundset.label} KITS
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {selectedSoundset.kits.map((kit) => {
                    const isLoaded = activeKitId === kit.id;
                    return (
                      <button
                        key={kit.id}
                        onClick={() => loadKit(kit)}
                        className={`text-left p-3 rounded-lg transition-all ${
                          isLoaded
                            ? "ring-2 bg-[var(--ed-bg-elevated)]"
                            : "bg-[var(--ed-bg-surface)] border border-[var(--ed-border)] hover:border-opacity-60 hover:bg-[var(--ed-bg-elevated)]"
                        }`}
                        style={{
                          outline: isLoaded ? `2px solid ${selectedSoundset.color}` : undefined,
                          outlineOffset: "-2px",
                          boxShadow: isLoaded ? `0 0 12px ${selectedSoundset.color}25` : undefined,
                          borderColor: isLoaded ? selectedSoundset.color : undefined,
                        }}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-bold text-[var(--ed-text-primary)]">
                            {kit.name}
                          </span>
                          {isLoaded && (
                            <span
                              className="text-[7px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{
                                backgroundColor: selectedSoundset.color + "20",
                                color: selectedSoundset.color,
                              }}
                            >
                              ACTIVE
                            </span>
                          )}
                        </div>

                        {kit.description && (
                          <p className="text-[9px] text-[var(--ed-text-muted)] mb-1.5 line-clamp-1">
                            {kit.description}
                          </p>
                        )}

                        <div className="flex items-center gap-2">
                          <div className="flex gap-1 flex-wrap">
                            {kit.tags.slice(0, 4).map((tag) => (
                              <span key={tag} className="text-[7px] px-1 py-0.5 rounded bg-[var(--ed-bg-primary)] text-[var(--ed-text-muted)]">
                                {tag}
                              </span>
                            ))}
                          </div>
                          <span className="text-[8px] text-[var(--ed-text-muted)] ml-auto whitespace-nowrap">
                            {kit.bpmRange[0]}–{kit.bpmRange[1]}
                          </span>
                          {kit.pattern && (
                            <span className="text-[8px] text-[var(--ed-accent-green)] whitespace-nowrap">
                              +PAT
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-[var(--ed-text-muted)] text-sm mb-2">
                  Select a soundset
                </p>
                <p className="text-[var(--ed-text-muted)] text-[10px] max-w-xs">
                  Each soundset configures all 12 voices for a specific sonic character — from classic 808 to cinematic impacts.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
