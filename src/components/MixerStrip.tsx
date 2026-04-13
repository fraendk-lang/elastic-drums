import { useEffect, useRef, useState } from "react";
import { audioEngine } from "../audio/AudioEngine";

const LABELS = ["KCK", "SNR", "CLP", "TL", "TM", "TH", "HHC", "HHO", "CYM", "RDE", "P1", "P2", "BAS", "CHD", "LED"];
const COLORS = [
  "#f59e0b", "#f59e0b", "#f59e0b", "#f59e0b", "#f59e0b", "#f59e0b",
  "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#8b5cf6", "#8b5cf6",
  "#10b981", "#a78bfa", "#f472b6",
];

interface MixerStripProps {
  onOpenMixer: () => void;
}

export function MixerStrip({ onOpenMixer }: MixerStripProps) {
  const [levels, setLevels] = useState<number[]>(new Array(15).fill(0));
  const [masterLevel, setMasterLevel] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const update = () => {
      const newLevels: number[] = [];
      for (let i = 0; i < 15; i++) newLevels.push(audioEngine.getChannelLevel(i));
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
        className="text-[10px] font-bold text-[var(--ed-text-secondary)] hover:text-[var(--ed-accent-orange)] transition-all text-left tracking-wider mb-1 ed-tool-btn"
      >
        MIXER &rsaquo;
      </button>

      {/* Channel meters */}
      <div className="flex-1 flex gap-[2px] items-end">
        {LABELS.map((ch, i) => {
          const level = levels[i] ?? 0;
          return (
            <div key={i} className="flex flex-col items-center flex-1 min-w-0 gap-0.5">
              <div className="w-full h-full min-h-[60px] rounded-sm bg-[var(--ed-bg-primary)] relative overflow-hidden border border-[var(--ed-border)]/15">
                <div
                  className="ed-meter-bar absolute bottom-0 left-0 right-0 rounded-sm"
                  style={{
                    height: `${Math.min(level * 100, 100)}%`,
                    background: level > 0.85
                      ? "linear-gradient(180deg, #ef4444, #dc2626)"
                      : level > 0.5
                        ? `linear-gradient(180deg, #eab308, ${COLORS[i]})`
                        : `linear-gradient(180deg, ${COLORS[i]}90, ${COLORS[i]}50)`,
                    boxShadow: level > 0.3 ? `0 0 4px ${COLORS[i]}20` : "none",
                  }}
                />
              </div>
              <span className="text-[6px] font-bold transition-colors" style={{
                color: level > 0.1 ? COLORS[i] + "B0" : COLORS[i] + "40",
              }}>
                {ch}
              </span>
            </div>
          );
        })}
      </div>

      {/* Master meter */}
      <div className="flex items-center gap-1 pt-1.5 border-t border-[var(--ed-border)]/50">
        <span className="text-[7px] font-bold text-[var(--ed-accent-green)] tracking-wider">MST</span>
        <div className="flex-1 h-2.5 rounded-sm bg-[var(--ed-bg-primary)] relative overflow-hidden border border-[var(--ed-border)]/15">
          <div
            className="absolute left-0 top-0 bottom-0 rounded-sm ed-meter-bar"
            style={{
              width: `${Math.min(masterLevel * 100, 100)}%`,
              background: masterLevel > 0.85
                ? "linear-gradient(90deg, #22c55e, #ef4444)"
                : "linear-gradient(90deg, #22c55e80, #22c55e)",
              boxShadow: masterLevel > 0.5 ? "0 0 6px rgba(34,197,94,0.15)" : "none",
            }}
          />
        </div>
        <span className="text-[7px] font-mono text-[var(--ed-text-muted)] tabular-nums w-6 text-right">
          {masterLevel > 0.001 ? `${(20 * Math.log10(masterLevel)).toFixed(0)}` : "-\u221E"}
        </span>
      </div>
    </div>
  );
}
