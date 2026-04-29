// src/components/ArpPanel.tsx
import { memo } from "react";
import type { ArpSettings } from "../audio/Arpeggiator";

interface ArpPanelProps {
  arp:         ArpSettings;
  setArp:      <K extends keyof ArpSettings>(key: K, value: ArpSettings[K]) => void;
  /** CSS color value — e.g. "var(--ed-accent-green)" or "var(--ed-accent-chords)" */
  accentColor: string;
}

const ARP_MODES = ["off","up","down","updown","downup","converge","diverge","random","chord"] as const;
const ARP_RATES = ["1/4","1/8","1/8t","1/16","1/16t","1/32"] as const;
const ARP_GATES = ["short","medium","long"] as const;

export const ArpPanel = memo(function ArpPanel({ arp, setArp, accentColor }: ArpPanelProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1 border-b border-white/5 text-[7px] font-bold tracking-wider">

      {/* Mode buttons */}
      {ARP_MODES.map((m) => (
        <button
          key={m}
          onClick={() => setArp("mode", m)}
          className="px-1.5 h-5 rounded transition-all text-white/25 hover:text-white/55"
          style={arp.mode === m ? {
            background: `color-mix(in srgb, ${accentColor} 25%, transparent)`,
            color: accentColor,
          } : undefined}
          title={`Arpeggiator: ${m}`}
        >
          {m === "off" ? "—" : m.toUpperCase().slice(0, 4)}
        </button>
      ))}

      {arp.mode !== "off" && (
        <>
          <span className="mx-0.5 text-white/15">|</span>

          {/* Rate */}
          {ARP_RATES.map((r) => (
            <button key={r} onClick={() => setArp("rate", r)}
              className={`px-1 h-5 rounded transition-all ${
                arp.rate === r ? "bg-white/15 text-white/90" : "text-white/25 hover:text-white/55"
              }`}
            >{r}</button>
          ))}

          <span className="mx-0.5 text-white/15">|</span>

          {/* Octaves */}
          {[1, 2, 3, 4].map((o) => (
            <button key={o} onClick={() => setArp("octaves", o)}
              className={`w-5 h-5 rounded transition-all ${
                arp.octaves === o ? "bg-white/15 text-white/90" : "text-white/25 hover:text-white/55"
              }`}
            >{o}</button>
          ))}

          <span className="mx-0.5 text-white/15">|</span>

          {/* Gate */}
          {ARP_GATES.map((g) => (
            <button key={g} onClick={() => setArp("gate", g)}
              className={`px-1 h-5 rounded transition-all ${
                arp.gate === g ? "bg-white/15 text-white/90" : "text-white/25 hover:text-white/55"
              }`}
            >{g[0]!.toUpperCase()}</button>
          ))}

          <span className="mx-0.5 text-white/15">|</span>

          {/* Swing */}
          <label className="flex items-center gap-1 text-white/40">
            SW
            <input type="range" min={0} max={50} value={Math.round(arp.swing * 100)}
              onChange={(e) => setArp("swing", Number(e.target.value) / 100)}
              className="w-12" style={{ accentColor }} />
            <span className="w-5 text-[6px] text-white/50 font-mono">{Math.round(arp.swing * 100)}</span>
          </label>

          {/* Skip probability */}
          <label className="flex items-center gap-1 text-white/40">
            SKIP
            <input type="range" min={0} max={80} value={Math.round(arp.skipProb * 100)}
              onChange={(e) => setArp("skipProb", Number(e.target.value) / 100)}
              className="w-12" style={{ accentColor }} />
            <span className="w-5 text-[6px] text-white/50 font-mono">{Math.round(arp.skipProb * 100)}</span>
          </label>

          {/* Velocity decay */}
          <label className="flex items-center gap-1 text-white/40">
            DECAY
            <input type="range" min={0} max={100} value={Math.round(arp.velDecay * 100)}
              onChange={(e) => setArp("velDecay", Number(e.target.value) / 100)}
              className="w-12" style={{ accentColor }} />
            <span className="w-5 text-[6px] text-white/50 font-mono">{Math.round(arp.velDecay * 100)}</span>
          </label>

          {/* Velocity jitter — previously missing from all three sequencers */}
          <label className="flex items-center gap-1 text-white/40">
            JITTER
            <input type="range" min={0} max={100} value={Math.round(arp.velocityJitter * 100)}
              onChange={(e) => setArp("velocityJitter", Number(e.target.value) / 100)}
              className="w-12" style={{ accentColor }} />
            <span className="w-5 text-[6px] text-white/50 font-mono">{Math.round(arp.velocityJitter * 100)}</span>
          </label>
        </>
      )}
    </div>
  );
});
