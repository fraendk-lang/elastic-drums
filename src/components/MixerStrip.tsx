/**
 * Compact mixer sidebar — shows mini meters + toggle for full mixer panel
 */

import { useEffect, useRef, useState } from "react";
import { audioEngine } from "../audio/AudioEngine";

const CHANNEL_LABELS = [
  "KCK", "SNR", "CLP", "TL", "TM", "TH",
  "HHC", "HHO", "CYM", "RDE", "P1", "P2",
];

interface MixerStripProps {
  onOpenMixer: () => void;
}

export function MixerStrip({ onOpenMixer }: MixerStripProps) {
  const [levels, setLevels] = useState<number[]>(new Array(12).fill(0));
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const update = () => {
      const newLevels: number[] = [];
      for (let i = 0; i < 12; i++) {
        newLevels.push(audioEngine.getChannelLevel(i));
      }
      setLevels(newLevels);
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div className="flex flex-col h-full p-2">
      {/* Header with expand button */}
      <button
        onClick={onOpenMixer}
        className="text-xs font-semibold text-[var(--ed-text-secondary)] mb-2 hover:text-[var(--ed-accent-orange)] transition-colors text-left flex items-center gap-1"
      >
        MIXER
        <span className="text-[var(--ed-text-muted)] text-[10px]">⬒</span>
      </button>

      {/* Mini meters */}
      <div className="flex-1 flex gap-[3px] items-end">
        {CHANNEL_LABELS.map((ch, i) => {
          const level = levels[i] ?? 0;
          return (
            <div key={i} className="flex flex-col items-center flex-1 min-w-0">
              {/* Meter bar */}
              <div className="w-full h-28 rounded-sm bg-[var(--ed-bg-primary)] relative overflow-hidden border border-[var(--ed-border)]/30">
                <div
                  className="absolute bottom-0 left-0 right-0 transition-all duration-75"
                  style={{
                    height: `${Math.min(level * 100, 100)}%`,
                    backgroundColor: level > 0.85 ? "#ef4444" : level > 0.5 ? "#eab308" : "#22c55e",
                  }}
                />
              </div>
              {/* Label */}
              <span className="text-[7px] font-medium text-[var(--ed-text-muted)] mt-0.5">
                {ch}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
