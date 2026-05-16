import { useState, useEffect } from "react";
import { BassSequencer } from "./BassSequencer";
import { ChordsSequencer } from "./ChordsSequencer";
import { MelodySequencer } from "./MelodySequencer";
import { SamplerTab } from "./SamplerTab";
import { LoopPlayerTab } from "./LoopPlayerTab";
import { StockLibrary } from "./StockLibrary";
import { useOverlayStore } from "../store/overlayStore";
import { STYLE_META } from "../audio/MelodyGeneratorEngine";
import { useBassStore, BASS_PRESETS } from "../store/bassStore";
import { useChordsStore, CHORDS_PRESETS } from "../store/chordsStore";
import { useMelodyStore, MELODY_PRESETS } from "../store/melodyStore";
import { useLoopPlayerStore } from "../store/loopPlayerStore";
import { useDrumStore } from "../store/drumStore";
import { audioEngine } from "../audio/AudioEngine";
import { bassEngine } from "../audio/BassEngine";
import { chordsEngine } from "../audio/ChordsEngine";
import { melodyEngine } from "../audio/MelodyEngine";
import { soundFontEngine } from "../audio/SoundFontEngine";

type SynthTab = "bass" | "chords" | "melody" | "sampler" | "loops" | "library";

const TABS: { id: SynthTab; label: string; color: string }[] = [
  { id: "bass",    label: "BASS",    color: "var(--ed-accent-bass)"   },
  { id: "chords",  label: "CHORDS",  color: "var(--ed-accent-chords)" },
  { id: "melody",  label: "MELODY",  color: "var(--ed-accent-melody)" },
  { id: "sampler", label: "SAMPLER", color: "#f59e0b"                 },
  { id: "loops",   label: "LOOPS",   color: "#2EC4B6"                 },
  { id: "library", label: "LIBRARY", color: "#a78bfa"                 },
];

interface HouseMacro {
  id: string;
  label: string;
  hint: string;
  bassPreset: string;
  chordsPreset: string;
  melodyPreset: string;
  reverb: number;
  delay: number;
  activeTab: SynthTab;
}

const HOUSE_MACROS: HouseMacro[] = [
  {
    id: "soulful-house",
    label: "SOULFUL HOUSE",
    hint: "warm sub, organ stab, muted top",
    bassPreset: "Analog Warmth",
    chordsPreset: "House Organ",
    melodyPreset: "Muted",
    reverb: 0.18,
    delay: 0.08,
    activeTab: "chords",
  },
  {
    id: "deep-night",
    label: "DEEP NIGHT",
    hint: "deep sub, dark stabs, low hook",
    bassPreset: "Deep Sub",
    chordsPreset: "Deep House",
    melodyPreset: "Muted",
    reverb: 0.16,
    delay: 0.06,
    activeTab: "bass",
  },
  {
    id: "tape-groove",
    label: "TAPE GROOVE",
    hint: "worn bass, dusty chords, soft hook",
    bassPreset: "Tape Bass",
    chordsPreset: "Warm Analog Pad",
    melodyPreset: "Vinyl Keys",
    reverb: 0.14,
    delay: 0.1,
    activeTab: "melody",
  },
  {
    id: "late-garage",
    label: "LATE GARAGE",
    hint: "garage bass, soft stack, muted accents",
    bassPreset: "House Groove",
    chordsPreset: "Deep House",
    melodyPreset: "Muted",
    reverb: 0.12,
    delay: 0.08,
    activeTab: "bass",
  },
];

function findPresetIndex<T extends { name: string }>(presets: T[], name: string): number {
  return presets.findIndex((preset) => preset.name === name);
}

export function SynthSection() {
  const [active, setActive] = useState<SynthTab>("bass");
  const [macrosOpen, setMacrosOpen] = useState(false);
  const overlay = useOverlayStore();

  // Tab badge: dim color underline when tab content is producing sound but not selected
  const isTransportPlay = useDrumStore((s) => s.isPlaying);
  const loopSlotPlaying = useLoopPlayerStore((s) => s.slots.some((slot) => slot.playing));

  function getTabBadgeColor(tabId: SynthTab, isSelected: boolean): string | undefined {
    if (isSelected) return undefined; // already shown at full opacity
    switch (tabId) {
      case "loops":
        return loopSlotPlaying ? "#2EC4B6" : undefined;
      case "bass":
        return isTransportPlay ? "#10b981" : undefined;
      case "chords":
        return isTransportPlay ? "var(--ed-accent-chords)" : undefined;
      case "melody":
        return isTransportPlay ? "var(--ed-accent-melody)" : undefined;
      default:
        return undefined;
    }
  }

  // Allow StockLibrary (and other components) to switch the active synth tab
  // via a CustomEvent — avoids prop-drilling through the component tree.
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<{ tab: SynthTab }>).detail?.tab;
      if (tab) setActive(tab);
    };
    window.addEventListener("synth-tab-switch", handler);
    return () => window.removeEventListener("synth-tab-switch", handler);
  }, []);
  const applyHouseMacro = (macro: HouseMacro) => {
    const bassStore = useBassStore.getState();
    const chordsStore = useChordsStore.getState();
    const melodyStore = useMelodyStore.getState();
    const now = audioEngine.getAudioContext()?.currentTime;

    const bassPresetIndex = findPresetIndex(BASS_PRESETS, macro.bassPreset);
    const chordsPresetIndex = findPresetIndex(CHORDS_PRESETS, macro.chordsPreset);
    const melodyPresetIndex = findPresetIndex(MELODY_PRESETS, macro.melodyPreset);

    bassEngine.panic(now);
    chordsEngine.panic(now);
    melodyEngine.panic(now);
    soundFontEngine.stopAll("bass");
    soundFontEngine.stopAll("chords");
    soundFontEngine.stopAll("melody");

    // House macros should start from a neutral modulation state so old motion
    // lanes cannot force the new presets into brittle or shrill settings.
    useBassStore.setState({ automationData: {}, automationParam: "cutoff" });
    useChordsStore.setState({ automationData: {}, automationParam: "cutoff" });
    useMelodyStore.setState({ automationData: {}, automationParam: "cutoff" });

    bassStore.setInstrument("_synth_");
    chordsStore.setInstrument("_synth_");
    melodyStore.setInstrument("_synth_");

    if (bassPresetIndex >= 0) bassStore.loadPreset(bassPresetIndex);
    if (chordsPresetIndex >= 0) chordsStore.loadPreset(chordsPresetIndex);
    if (melodyPresetIndex >= 0) melodyStore.loadPreset(melodyPresetIndex);

    audioEngine.setReverbType("hall");
    audioEngine.setDelayType("stereo");
    audioEngine.setDelayDivision("1/8", 120);
    audioEngine.setReverbLevel(macro.reverb);
    audioEngine.setDelayLevel(macro.delay);

    setActive(macro.activeTab);
  };

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center border-t border-[var(--ed-border)]/30 bg-[var(--ed-bg-primary)]">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          const badgeColor = getTabBadgeColor(tab.id, false);
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`flex-1 py-1.5 text-[9px] font-bold tracking-[0.15em] transition-all border-b-2 relative ${
                isActive
                  ? "text-white/90 bg-white/[0.02]"
                  : "text-white/35 hover:text-white/60 border-transparent"
              }`}
              style={{
                borderBottomColor: isActive
                  ? tab.color
                  : (badgeColor ?? "transparent"),
                textShadow: isActive ? `0 0 12px ${tab.color}40` : "none",
              }}
            >
              {tab.label}
              {/* Tiny pulse dot when tab is playing but not selected */}
              {!isActive && badgeColor && (
                <span
                  className="absolute top-1 right-1 w-1 h-1 rounded-full animate-pulse"
                  style={{ backgroundColor: badgeColor }}
                />
              )}
            </button>
          );
        })}

        {/* Right-side action buttons */}
        <div className="ml-auto flex items-center shrink-0 border-l border-white/[0.06]">
          <button
            onClick={() => setMacrosOpen((o) => !o)}
            className="px-2.5 py-1.5 text-[8px] font-bold tracking-[0.15em] transition-all border-b-2"
            title="Toggle house macros"
            style={{
              color: macrosOpen ? "var(--ed-accent-orange)" : "rgba(255,255,255,0.3)",
              borderBottomColor: macrosOpen ? "var(--ed-accent-orange)" : "transparent",
              backgroundColor: macrosOpen ? "rgba(245,158,11,0.06)" : "transparent",
            }}
          >
            MACROS
          </button>
          <button
            onClick={() => overlay.openOverlay("midiPlayer")}
            className="px-2.5 py-1.5 text-[8px] font-bold tracking-[0.15em] transition-all border-b-2 border-transparent text-white/30 hover:text-white/60"
            title="Open MIDI arranger"
          >
            MIDI
          </button>
          <button
            onClick={() => overlay.openOverlay("pianoRoll")}
            className="px-2.5 py-1.5 text-[8px] font-bold tracking-[0.15em] transition-all border-b-2 border-transparent text-white/30 hover:text-white/60"
            title="Open Piano Roll Editor"
          >
            ROLL
          </button>
          <button
            onClick={() => overlay.openOverlay("melodyGen")}
            className="px-2.5 py-1.5 text-[8px] font-bold tracking-[0.15em] transition-all border-b-2 border-transparent hover:text-white/60"
            title="Open Melody Generator"
            style={{ color: STYLE_META.harbourGlow.color + "80" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = STYLE_META.harbourGlow.color; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = STYLE_META.harbourGlow.color + "80"; }}
          >
            GEN
          </button>
        </div>
      </div>

      {/* House Macros — collapsed by default, toggle via MACROS button */}
      {macrosOpen && (
        <div className="border-b border-white/[0.06] bg-black/30 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[7px] font-black tracking-[0.18em] text-[var(--ed-accent-orange)]/60 mr-1 shrink-0">
              STARTING WORLDS
            </span>
            {HOUSE_MACROS.map((macro) => (
              <button
                key={macro.id}
                onClick={() => { applyHouseMacro(macro); setMacrosOpen(false); }}
                className="rounded border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-left transition-all hover:border-[var(--ed-accent-orange)]/40 hover:bg-[var(--ed-accent-orange)]/10 active:scale-95"
              >
                <div className="text-[8px] font-black tracking-[0.14em] text-white/80">{macro.label}</div>
                <div className="mt-0.5 text-[7px] font-medium text-white/30">{macro.hint}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active sequencer — a 2px engine-coloured strip at the top ties the
          content visually to its tab, so it's instantly obvious which
          engine you're editing without reading the tab label. */}
      <div
        className="border-t-2"
        style={{ borderTopColor: (TABS.find((t) => t.id === active)?.color) ?? "transparent" }}
      >
        {active === "bass" && <BassSequencer />}
        {active === "chords" && (
          <ChordsSequencer
            onOpenPianoRoll={() => overlay.openOverlay("chordPianoRoll")}
          />
        )}
        {active === "melody" && <MelodySequencer />}
        {active === "sampler"  && <SamplerTab />}
        {active === "loops"    && <LoopPlayerTab />}
        {active === "library"  && <StockLibrary />}
      </div>
    </div>
  );
}
