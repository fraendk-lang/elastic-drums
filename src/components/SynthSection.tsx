import { useState } from "react";
import { BassSequencer } from "./BassSequencer";
import { ChordsSequencer } from "./ChordsSequencer";
import { MelodySequencer } from "./MelodySequencer";

type SynthTab = "bass" | "chords" | "melody";

const TABS: { id: SynthTab; label: string; color: string }[] = [
  { id: "bass", label: "BASS", color: "var(--ed-accent-bass)" },
  { id: "chords", label: "CHORDS", color: "var(--ed-accent-chords)" },
  { id: "melody", label: "MELODY", color: "var(--ed-accent-melody)" },
];

export function SynthSection() {
  const [active, setActive] = useState<SynthTab>("bass");

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
      </div>

      {/* Active sequencer */}
      {active === "bass" && <BassSequencer />}
      {active === "chords" && <ChordsSequencer />}
      {active === "melody" && <MelodySequencer />}
    </div>
  );
}
