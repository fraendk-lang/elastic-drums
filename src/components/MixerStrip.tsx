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
  const activeCount = levels.filter((level) => level > 0.02).length;
  const hotCount = levels.filter((level) => level > 0.75).length;
  const masterDb = masterLevel > 0.001 ? 20 * Math.log10(masterLevel) : -Infinity;

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
    <div className="flex flex-col h-full gap-2 rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,19,24,0.98),rgba(8,9,12,0.98))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_40px_rgba(0,0,0,0.35)]">
      <div className="rounded-[14px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[9px] font-black tracking-[0.24em] text-white/75">MIX BUS</div>
            <div className="mt-1 text-[7px] font-bold tracking-[0.16em] text-white/28">CONSOLE OVERVIEW</div>
          </div>
          <button
            onClick={onOpenMixer}
            className="rounded-full border border-[var(--ed-accent-orange)]/25 bg-[var(--ed-accent-orange)]/10 px-2.5 py-1 text-[8px] font-black tracking-[0.18em] text-[var(--ed-accent-orange)] transition-all hover:bg-[var(--ed-accent-orange)]/16 hover:text-white"
          >
            OPEN
          </button>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <div className="rounded-xl border border-white/6 bg-black/20 px-2 py-1.5">
            <div className="text-[6px] font-bold tracking-[0.18em] text-white/30">ACTIVE</div>
            <div className="mt-1 text-[11px] font-black tracking-[0.12em] text-white/82">{activeCount}</div>
          </div>
          <div className="rounded-xl border border-white/6 bg-black/20 px-2 py-1.5">
            <div className="text-[6px] font-bold tracking-[0.18em] text-white/30">HOT</div>
            <div className="mt-1 text-[11px] font-black tracking-[0.12em] text-amber-300">{hotCount}</div>
          </div>
          <div className="rounded-xl border border-white/6 bg-black/20 px-2 py-1.5">
            <div className="text-[6px] font-bold tracking-[0.18em] text-white/30">MASTER</div>
            <div className="mt-1 text-[11px] font-black tracking-[0.05em] text-[var(--ed-accent-green)]">
              {isFinite(masterDb) ? `${masterDb.toFixed(1)}` : "-∞"}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[14px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-2 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[7px] font-bold tracking-[0.2em] text-white/30">CHANNEL BRIDGE</span>
          <span className="text-[7px] font-mono text-white/25">-60 / 0 dB</span>
        </div>

      <button
        onClick={onOpenMixer}
        className="mb-2 hidden"
      >
        MIXER &rsaquo;
      </button>

      <div className="flex-1 flex gap-[3px] items-end min-h-[144px]">
        {LABELS.map((ch, i) => {
          const level = levels[i] ?? 0;
          const isHot = level > 0.75;
          return (
            <div key={i} className="flex flex-col items-center flex-1 min-w-0 gap-1">
              <div className="flex h-full w-full min-h-[84px] flex-col justify-end rounded-[10px] border border-white/6 bg-[linear-gradient(180deg,rgba(6,7,10,0.96),rgba(14,15,19,0.96))] p-[3px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="relative h-full overflow-hidden rounded-[7px] border border-white/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(0,0,0,0.18))]">
                  {[20, 40, 60, 80].map((pct) => (
                    <div key={pct} className="absolute inset-x-0 border-t border-white/5" style={{ bottom: `${pct}%` }} />
                  ))}
                <div
                  className="ed-meter-bar absolute bottom-0 left-[2px] right-[2px] rounded-[5px]"
                  style={{
                    height: `${Math.min(level * 100, 100)}%`,
                    background: level > 0.85
                      ? "linear-gradient(180deg, #ef4444, #dc2626)"
                      : level > 0.5
                        ? `linear-gradient(180deg, #eab308, ${COLORS[i]})`
                        : `linear-gradient(180deg, ${COLORS[i]}90, ${COLORS[i]}50)`,
                    boxShadow: level > 0.3 ? `0 0 10px ${COLORS[i]}20` : "none",
                  }}
                />
                  {isHot && (
                    <div className="absolute inset-x-[2px] top-[2px] h-[4px] rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.65)]" />
                  )}
                </div>
              </div>
              <span className="text-[6px] font-black tracking-[0.14em] transition-colors" style={{
                color: level > 0.1 ? COLORS[i] + "D0" : COLORS[i] + "46",
              }}>
                {ch}
              </span>
            </div>
          );
        })}
      </div>
      </div>

      <div className="rounded-[14px] border border-[var(--ed-accent-green)]/15 bg-[linear-gradient(180deg,rgba(16,38,23,0.28),rgba(4,10,7,0.7))] px-2.5 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[7px] font-black tracking-[0.2em] text-[var(--ed-accent-green)]">MASTER BUS</span>
          <span className="text-[7px] font-mono text-white/32">{isFinite(masterDb) ? `${masterDb.toFixed(1)} dB` : "-∞ dB"}</span>
        </div>
        <div className="flex items-center gap-1.5">
        <span className="text-[7px] font-bold text-[var(--ed-accent-green)] tracking-wider">MST</span>
        <div className="relative h-3 flex-1 overflow-hidden rounded-full border border-white/8 bg-black/30">
          {[25, 50, 75].map((pct) => (
            <div key={pct} className="absolute top-0 bottom-0 border-l border-white/6" style={{ left: `${pct}%` }} />
          ))}
          <div
            className="absolute left-0 top-0 bottom-0 rounded-full ed-meter-bar"
            style={{
              width: `${Math.min(masterLevel * 100, 100)}%`,
              background: masterLevel > 0.85
                ? "linear-gradient(90deg, #22c55e, #ef4444)"
                : "linear-gradient(90deg, #22c55e80, #22c55e)",
              boxShadow: masterLevel > 0.5 ? "0 0 6px rgba(34,197,94,0.15)" : "none",
            }}
          />
        </div>
        <span className="w-8 text-right text-[7px] font-mono text-[var(--ed-text-muted)] tabular-nums">
          {masterLevel > 0.001 ? `${masterDb.toFixed(0)}` : "-\u221E"}
        </span>
      </div>
      </div>
    </div>
  );
}
