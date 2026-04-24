/**
 * Performance Mode — fullscreen scene launcher with transport + quick mixer.
 * Live-Ansicht: Scene Pads, Play/Stop, BPM, animated level meters.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDrumStore, getDrumCurrentStep } from "../store/drumStore";
import { useSceneStore } from "../store/sceneStore";
import { audioEngine } from "../audio/AudioEngine";

interface PerformanceModeProps {
  onClose: () => void;
}

const GROUP_NAMES = ["drums", "bass", "chords", "melody"] as const;
const GROUP_COLORS: Record<string, string> = {
  drums: "#f59e0b", bass: "#10b981", chords: "#a78bfa", melody: "#f472b6",
};
const GROUP_LABELS: Record<string, string> = {
  drums: "DRUMS", bass: "BASS", chords: "CHORDS", melody: "MELODY",
};

export function PerformanceMode({ onClose }: PerformanceModeProps) {
  const bpm = useDrumStore((s) => s.bpm);
  const isPlaying = useDrumStore((s) => s.isPlaying);
  const setBpm = useDrumStore((s) => s.setBpm);
  const togglePlay = useDrumStore((s) => s.togglePlay);
  const patternLength = useDrumStore((s) => s.pattern.length);

  const scenes = useSceneStore((s) => s.scenes);
  const activeScene = useSceneStore((s) => s.activeScene);
  const nextScene = useSceneStore((s) => s.nextScene);
  const loadScene = useSceneStore((s) => s.loadScene);
  const queueScene = useSceneStore((s) => s.queueScene);

  // ─── Live meters via requestAnimationFrame ───
  const [meters, setMeters] = useState<Record<string, number>>({});
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let running = true;
    const tick = () => {
      if (!running) return;
      if (audioEngine.isInitialized) {
        const next: Record<string, number> = {};
        for (const g of GROUP_NAMES) {
          next[g] = Math.max(0, Math.min(1, audioEngine.getGroupLevel(g)));
        }
        next.master = Math.max(0, Math.min(1, audioEngine.getMasterLevel()));
        setMeters(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, []);

  // ─── Keyboard: Space = play/stop, Escape = exit ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); handlePlay(); }
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      // Number keys 1-9 = load/queue scene
      if (e.key >= "1" && e.key <= "9") {
        const slot = parseInt(e.key) - 1;
        if (scenes[slot]) handleSceneTap(slot);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const handleSceneTap = useCallback((slot: number) => {
    if (!scenes[slot]) return;
    if (isPlaying) {
      queueScene(slot);
    } else {
      loadScene(slot);
    }
  }, [scenes, isPlaying, loadScene, queueScene]);

  const handlePlay = useCallback(() => {
    audioEngine.resume().then(() => togglePlay());
  }, [togglePlay]);

  // Bar counter (non-reactive read — acceptable for cosmetic bar counter)
  const currentBar = Math.floor(getDrumCurrentStep() / patternLength * (patternLength / 4)) + 1;
  const totalBars = patternLength / 4;

  return (
    <div className="fixed inset-0 z-50 flex flex-col select-none" style={{ background: "#0a0a0f" }}>

      {/* ─── HEADER ─── */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/10"
        style={{ background: "#111116" }}>
        <span className="text-[11px] font-extrabold tracking-[0.25em] text-[var(--ed-accent-orange)]">
          PERFORMANCE
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[9px] text-white/30 font-mono">ESC to exit</span>
          <button onClick={onClose}
            className="px-3 py-1.5 text-[10px] font-bold rounded-md bg-white/8 text-white/60 hover:text-white hover:bg-white/15 transition-all">
            EXIT
          </button>
        </div>
      </div>

      {/* ─── TRANSPORT ─── */}
      <div className="flex items-center gap-5 px-5 py-3 border-b border-white/8"
        style={{ background: "#0d0d12" }}>
        {/* Play/Stop */}
        <button onClick={handlePlay}
          className="w-14 h-14 rounded-full border-2 flex items-center justify-center text-xl font-bold transition-all active:scale-90"
          style={{
            borderColor: isPlaying ? "#f59e0b" : "#444",
            background: isPlaying ? "#f59e0b" : "transparent",
            color: isPlaying ? "#000" : "#666",
            boxShadow: isPlaying ? "0 0 20px rgba(245,158,11,0.3)" : "none",
          }}>
          {isPlaying ? "■" : "▶"}
        </button>

        {/* BPM */}
        <div className="flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-2">
            <button onClick={() => setBpm(Math.max(60, bpm - 1))}
              className="w-7 h-7 rounded-md text-[14px] font-bold bg-white/8 text-white/50 hover:text-white hover:bg-white/15 active:scale-90 transition-all">−</button>
            <span className="text-[32px] font-black tabular-nums text-white leading-none min-w-[70px] text-center">
              {bpm}
            </span>
            <button onClick={() => setBpm(Math.min(200, bpm + 1))}
              className="w-7 h-7 rounded-md text-[14px] font-bold bg-white/8 text-white/50 hover:text-white hover:bg-white/15 active:scale-90 transition-all">+</button>
          </div>
          <span className="text-[8px] font-bold tracking-[0.2em] text-white/25">BPM</span>
        </div>

        {/* Bar counter */}
        {isPlaying && (
          <div className="flex flex-col items-center gap-0.5 ml-2">
            <span className="text-[20px] font-black tabular-nums text-white/60">{currentBar}<span className="text-white/20">/{totalBars}</span></span>
            <span className="text-[8px] font-bold tracking-[0.2em] text-white/25">BAR</span>
          </div>
        )}

        {/* Active Scene Info */}
        <div className="ml-auto text-right">
          <div className="text-[16px] font-bold text-[var(--ed-accent-orange)]">
            {activeScene >= 0 ? scenes[activeScene]?.name ?? "—" : "No Scene"}
          </div>
          {nextScene !== null && scenes[nextScene] && (
            <div className="text-[11px] text-blue-400 font-semibold animate-pulse">
              Next: {scenes[nextScene]?.name}
            </div>
          )}
        </div>
      </div>

      {/* ─── SCENE GRID ─── */}
      <div className="flex-1 p-3 overflow-auto">
        <div className="grid grid-cols-4 gap-2.5 h-full">
          {scenes.map((scene, i) => {
            const isActive = activeScene === i;
            const isQueued = nextScene === i;
            const isEmpty = !scene;

            return (
              <button
                key={i}
                onClick={() => handleSceneTap(i)}
                disabled={isEmpty}
                className="rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all active:scale-[0.97] relative overflow-hidden"
                style={{
                  background: isActive
                    ? "linear-gradient(180deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.04) 100%)"
                    : isQueued
                      ? "linear-gradient(180deg, rgba(59,130,246,0.1) 0%, rgba(59,130,246,0.03) 100%)"
                      : isEmpty ? "transparent" : "linear-gradient(180deg, #1c1c24 0%, #161620 100%)",
                  borderColor: isActive
                    ? "#f59e0b"
                    : isQueued
                      ? "#3b82f6"
                      : isEmpty ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.1)",
                  borderStyle: isEmpty ? "dashed" : "solid",
                  opacity: isEmpty ? 0.25 : 1,
                  boxShadow: isActive
                    ? "0 0 30px rgba(245,158,11,0.15), inset 0 0 30px rgba(245,158,11,0.05)"
                    : isQueued
                      ? "0 0 20px rgba(59,130,246,0.1)"
                      : "none",
                  minHeight: 80,
                }}
              >
                {/* Slot number */}
                <span className="absolute top-2.5 left-3 text-[10px] font-bold text-white/20">
                  {i + 1}
                </span>

                {/* Keyboard hint */}
                {!isEmpty && i < 9 && (
                  <span className="absolute top-2.5 right-3 text-[8px] font-mono text-white/15">
                    {i + 1}
                  </span>
                )}

                {/* Scene name */}
                {scene && (
                  <span className={`text-[14px] font-bold text-center px-3 leading-tight ${isActive ? "text-[#f59e0b]" : isQueued ? "text-blue-300" : "text-white/80"}`}>
                    {scene.name}
                  </span>
                )}

                {/* Badge */}
                {isActive && (
                  <span className="text-[8px] font-extrabold tracking-[0.15em] px-3 py-1 rounded-full bg-[#f59e0b] text-black">
                    LIVE
                  </span>
                )}
                {isQueued && !isActive && (
                  <span className="text-[8px] font-extrabold tracking-[0.15em] px-3 py-1 rounded-full bg-[#3b82f6] text-white animate-pulse">
                    NEXT
                  </span>
                )}

                {/* Pulse ring on active */}
                {isActive && (
                  <div className="absolute inset-[-2px] rounded-xl border-2 border-[#f59e0b] pointer-events-none"
                    style={{ animation: "perf-pulse 1.5s ease-in-out infinite" }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── QUICK MIXER (live animated) ─── */}
      <div className="px-5 py-3 border-t border-white/10" style={{ background: "#111116" }}>
        <div className="flex gap-4">
          {GROUP_NAMES.map((group) => {
            const level = meters[group] ?? 0;
            const color = GROUP_COLORS[group]!;
            return (
              <div key={group} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, level * 100)}%`,
                      background: `linear-gradient(90deg, ${color}66, ${color})`,
                      transition: "width 60ms linear",
                    }}
                  />
                </div>
                <span className="text-[8px] font-bold tracking-[0.15em]" style={{ color: `${color}88` }}>
                  {GROUP_LABELS[group]}
                </span>
              </div>
            );
          })}
          {/* Master */}
          <div className="flex-1 flex flex-col items-center gap-2">
            <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, (meters.master ?? 0) * 100)}%`,
                  background: "linear-gradient(90deg, #88888866, #cccccc)",
                  transition: "width 60ms linear",
                }}
              />
            </div>
            <span className="text-[8px] font-bold tracking-[0.15em] text-white/35">MASTER</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes perf-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
