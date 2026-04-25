import { useState } from "react";
import { BassSequencer } from "./BassSequencer";
import { ChordsSequencer } from "./ChordsSequencer";
import { MelodySequencer } from "./MelodySequencer";
import { SamplerTab } from "./SamplerTab";
import { LoopPlayerTab } from "./LoopPlayerTab";
import { StockLibrary } from "./StockLibrary";
import { useOverlayStore } from "../store/overlayStore";
import { useBassStore, BASS_PRESETS } from "../store/bassStore";
import { useChordsStore, CHORDS_PRESETS } from "../store/chordsStore";
import { useMelodyStore, MELODY_PRESETS } from "../store/melodyStore";
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
  const overlay = useOverlayStore();
  const activeTab = TABS.find((tab) => tab.id === active) ?? TABS[0]!;

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
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`flex-1 py-1.5 text-[9px] font-bold tracking-[0.15em] transition-all border-b-2 ${
                isActive
                  ? "text-white/90 bg-white/[0.02]"
                  : "text-white/20 hover:text-white/40 border-transparent"
              }`}
              style={{
                borderBottomColor: isActive ? tab.color : "transparent",
                textShadow: isActive ? `0 0 12px ${tab.color}40` : "none",
              }}
            >
              {tab.label}
            </button>
          );
        })}

        <div className="ml-auto flex items-center">
          <button
            onClick={() => overlay.openOverlay("midiPlayer")}
            className="px-3 py-1.5 text-[9px] font-bold tracking-[0.15em] transition-all border-b-2 border-transparent text-white/20 hover:text-white/40 bg-white/[0.02] hover:bg-white/[0.05]"
            title="Open MIDI arranger"
          >
            MIDI
          </button>
          <button
            onClick={() => overlay.openOverlay("pianoRoll")}
            className="px-3 py-1.5 text-[9px] font-bold tracking-[0.15em] transition-all border-b-2 border-transparent text-white/20 hover:text-white/40 bg-white/[0.02] hover:bg-white/[0.05]"
            title="Open Piano Roll Editor"
          >
            PIANO ROLL
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t border-white/5 border-b border-white/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))]">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-black tracking-[0.2em]"
            style={{ color: activeTab.color, textShadow: `0 0 12px ${activeTab.color}33` }}
          >
            {activeTab.label} WORKSPACE
          </span>
          <span className="text-[8px] font-bold tracking-[0.18em] text-white/20">
            ARRANGE / EDIT / AUTOMATE
          </span>
        </div>

        <div className="flex items-center gap-2 text-[8px] font-bold tracking-[0.12em] text-white/35">
          <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">CLIP EDITOR</span>
          <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">MOTION LANES</span>
          <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">PERFORMANCE READY</span>
        </div>
      </div>

      <div className="border-b border-white/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.022),rgba(255,255,255,0.008))] px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black tracking-[0.18em] text-[var(--ed-accent-orange)]">
              HOUSE MACROS
            </span>
            <span className="text-[8px] font-bold tracking-[0.16em] text-white/20">
              CURATED STARTING WORLDS + PATTERN SEEDS
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {HOUSE_MACROS.map((macro) => (
              <button
                key={macro.id}
                onClick={() => applyHouseMacro(macro)}
                className="rounded-lg border border-white/8 bg-black/20 px-2.5 py-1.5 text-left transition-all hover:border-[var(--ed-accent-orange)]/30 hover:bg-[var(--ed-accent-orange)]/10"
              >
                <div className="text-[8px] font-black tracking-[0.16em] text-white/75">{macro.label}</div>
                <div className="mt-0.5 text-[7px] font-bold tracking-[0.12em] text-white/28">{macro.hint}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Active sequencer */}
      {active === "bass" && <BassSequencer />}
      {active === "chords" && <ChordsSequencer />}
      {active === "melody" && <MelodySequencer />}
      {active === "sampler"  && <SamplerTab />}
      {active === "loops"    && <LoopPlayerTab />}
      {active === "library"  && <StockLibrary />}
    </div>
  );
}
