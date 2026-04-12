import { useEffect, useRef, useState } from "react";
import { audioEngine } from "../audio/AudioEngine";

const LABELS = ["KCK", "SNR", "CLP", "TL", "TM", "TH", "HHC", "HHO", "CYM", "RDE", "P1", "P2"];
const COLORS = [
  "#f59e0b", "#f59e0b", "#f59e0b", "#f59e0b", "#f59e0b", "#f59e0b",
  "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#8b5cf6", "#8b5cf6",
];

interface MixerStripProps {
  onOpenMixer: () => void;
}

export function MixerStrip({ onOpenMixer }: MixerStripProps) {
  const [levels, setLevels] = useState<number[]>(new Array(12).fill(0));
  const [masterLevel, setMasterLevel] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const update = () => {
      const newLevels: number[] = [];
      for (let i = 0; i < 12; i++) newLevels.push(audioEngine.getChannelLevel(i));
      setLevels(newLevels);
      setMasterLevel(audioEngine.getMasterLevel());
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div className="flex flex-col h-full p-2 gap-1">
      {/* Open mixer button */}
      <button
        onClick={onOpenMixer}
        className="text-[10px] font-bold text-[var(--ed-text-secondary)] hover:text-[var(--ed-accent-orange)] transition-colors text-left tracking-wider mb-1"
      >
        MIXER ⬒
      </button>

      {/* Channel meters */}
      <div className="flex-1 flex gap-[2px] items-end">
        {LABELS.map((ch, i) => {
          const level = levels[i] ?? 0;
          return (
            <div key={i} className="flex flex-col items-center flex-1 min-w-0 gap-0.5">
              <div className="w-full h-full min-h-[60px] rounded-sm bg-[var(--ed-bg-primary)] relative overflow-hidden border border-[var(--ed-border)]/20">
                <div
                  className="absolute bottom-0 left-0 right-0 transition-all duration-75 rounded-sm"
                  style={{
                    height: `${Math.min(level * 100, 100)}%`,
                    backgroundColor: level > 0.85 ? "#ef4444" : level > 0.5 ? "#eab308" : "#22c55e",
                  }}
                />
              </div>
              <span className="text-[6px] font-bold" style={{ color: COLORS[i] + "80" }}>
                {ch}
              </span>
            </div>
          );
        })}
      </div>

      {/* Master meter */}
      <div className="flex items-center gap-1 pt-1 border-t border-[var(--ed-border)]">
        <span className="text-[7px] font-bold text-[var(--ed-accent-green)] tracking-wider">MST</span>
        <div className="flex-1 h-2 rounded-sm bg-[var(--ed-bg-primary)] relative overflow-hidden">
          <div
            className="absolute left-0 top-0 bottom-0 rounded-sm transition-all duration-75"
            style={{
              width: `${Math.min(masterLevel * 100, 100)}%`,
              backgroundColor: masterLevel > 0.85 ? "#ef4444" : "#22c55e",
            }}
          />
        </div>
        <span className="text-[7px] font-mono text-[var(--ed-text-muted)]">
          {masterLevel > 0.001 ? `${(20 * Math.log10(masterLevel)).toFixed(0)}` : "-∞"}
        </span>
      </div>
    </div>
  );
}
