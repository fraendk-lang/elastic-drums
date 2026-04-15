/**
 * Performance Mode — fullscreen scene launcher with transport + quick mixer.
 * Abgespeckte Live-Ansicht: Scene Pads, Play/Stop, BPM, Group Faders.
 */

import { useCallback } from "react";
import { useDrumStore } from "../store/drumStore";
import { useSceneStore } from "../store/sceneStore";
import { audioEngine } from "../audio/AudioEngine";

interface PerformanceModeProps {
  onClose: () => void;
}

export function PerformanceMode({ onClose }: PerformanceModeProps) {
  const { bpm, isPlaying, setBpm } = useDrumStore();
  const togglePlay = useDrumStore((s) => s.togglePlay);
  const { scenes, activeScene, nextScene, loadScene, queueScene } = useSceneStore();

  const handleSceneTap = useCallback((slot: number) => {
    const scene = scenes[slot];
    if (!scene) return;
    if (isPlaying) {
      // While playing: queue for next bar
      queueScene(slot);
    } else {
      // While stopped: load immediately
      loadScene(slot);
    }
  }, [scenes, isPlaying, loadScene, queueScene]);

  const handlePlay = useCallback(() => {
    if (!audioEngine.isInitialized) {
      audioEngine.resume().then(() => togglePlay());
    } else {
      togglePlay();
    }
  }, [togglePlay]);

  const groupNames = ["drums", "bass", "chords", "melody"];
  const groupColors: Record<string, string> = {
    drums: "#f59e0b",
    bass: "#10b981",
    chords: "#a78bfa",
    melody: "#f472b6",
  };
  const groupLabels: Record<string, string> = {
    drums: "DRUMS",
    bass: "BASS",
    chords: "CHORDS",
    melody: "MELODY",
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#0d0d12" }}>

      {/* ─── HEADER ─── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10"
        style={{ background: "#141418" }}>
        <span className="text-[11px] font-extrabold tracking-[0.2em] text-[var(--ed-accent-orange)]">
          PERFORMANCE
        </span>
        <button onClick={onClose}
          className="px-3 py-1 text-[10px] font-bold rounded-md bg-white/8 text-white/60 hover:text-white hover:bg-white/15 transition-all">
          EXIT
        </button>
      </div>

      {/* ─── TRANSPORT ─── */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-white/8"
        style={{ background: "#101014" }}>
        {/* Play/Stop */}
        <button onClick={handlePlay}
          className="w-12 h-12 rounded-full border-2 flex items-center justify-center text-lg transition-all"
          style={{
            borderColor: isPlaying ? "#f59e0b" : "#555",
            background: isPlaying ? "#f59e0b" : "transparent",
            color: isPlaying ? "#000" : "#888",
          }}>
          {isPlaying ? "■" : "▶"}
        </button>

        {/* BPM */}
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1">
            <button onClick={() => setBpm(Math.max(60, bpm - 1))}
              className="w-6 h-6 rounded text-[12px] font-bold bg-white/8 text-white/50 hover:text-white hover:bg-white/15">−</button>
            <span className="text-[28px] font-black tabular-nums text-white leading-none min-w-[60px] text-center">
              {bpm}
            </span>
            <button onClick={() => setBpm(Math.min(200, bpm + 1))}
              className="w-6 h-6 rounded text-[12px] font-bold bg-white/8 text-white/50 hover:text-white hover:bg-white/15">+</button>
          </div>
          <span className="text-[7px] font-bold tracking-[0.2em] text-white/30">BPM</span>
        </div>

        {/* Active Scene Info */}
        <div className="ml-auto text-right">
          <div className="text-[14px] font-bold text-[var(--ed-accent-orange)]">
            {activeScene >= 0 ? scenes[activeScene]?.name ?? "—" : "No Scene"}
          </div>
          {nextScene !== null && scenes[nextScene] && (
            <div className="text-[10px] text-blue-400 font-medium">
              Next: {scenes[nextScene]?.name}
            </div>
          )}
        </div>
      </div>

      {/* ─── SCENE GRID ─── */}
      <div className="flex-1 p-4 overflow-auto">
        <div className="grid grid-cols-4 gap-2 h-full" style={{ maxHeight: "calc(100vh - 240px)" }}>
          {scenes.map((scene, i) => {
            const isActive = activeScene === i;
            const isQueued = nextScene === i;
            const isEmpty = !scene;

            return (
              <button
                key={i}
                onClick={() => handleSceneTap(i)}
                disabled={isEmpty}
                className="rounded-xl border flex flex-col items-center justify-center gap-1 transition-all active:scale-95 relative"
                style={{
                  background: isActive
                    ? "rgba(245,158,11,0.1)"
                    : isQueued
                      ? "rgba(59,130,246,0.08)"
                      : isEmpty ? "transparent" : "#1a1a22",
                  borderColor: isActive
                    ? "#f59e0b"
                    : isQueued
                      ? "#3b82f6"
                      : isEmpty ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)",
                  borderStyle: isEmpty ? "dashed" : "solid",
                  opacity: isEmpty ? 0.3 : 1,
                  boxShadow: isActive
                    ? "0 0 20px rgba(245,158,11,0.15)"
                    : isQueued
                      ? "0 0 16px rgba(59,130,246,0.12)"
                      : "none",
                  minHeight: 70,
                }}
              >
                {/* Slot number */}
                <span className="absolute top-2 left-3 text-[9px] font-bold text-white/25">
                  {i + 1}
                </span>

                {/* Scene name */}
                {scene && (
                  <span className="text-[12px] font-bold text-white/90 text-center px-2 leading-tight">
                    {scene.name}
                  </span>
                )}

                {/* Badge */}
                {isActive && (
                  <span className="absolute bottom-2 text-[7px] font-extrabold tracking-wider px-2 py-0.5 rounded bg-[#f59e0b] text-black">
                    LIVE
                  </span>
                )}
                {isQueued && (
                  <span className="absolute bottom-2 text-[7px] font-extrabold tracking-wider px-2 py-0.5 rounded bg-[#3b82f6] text-white">
                    NEXT
                  </span>
                )}

                {/* Pulse ring on active */}
                {isActive && (
                  <div className="absolute inset-[-1px] rounded-xl border-2 border-[#f59e0b] pointer-events-none"
                    style={{ animation: "pulse-border 1.5s ease-in-out infinite" }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── QUICK MIXER ─── */}
      <div className="px-4 py-3 border-t border-white/10" style={{ background: "#141418" }}>
        <div className="flex gap-3">
          {groupNames.map((group) => {
            const level = audioEngine.isInitialized
              ? Math.max(0, Math.min(1, audioEngine.getGroupLevel(group)))
              : 0.5;
            const color = groupColors[group] ?? "#888";

            return (
              <div key={group} className="flex-1 flex flex-col items-center gap-1.5">
                {/* Meter bar */}
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-full rounded-full transition-all duration-100"
                    style={{
                      width: `${Math.max(5, level * 100)}%`,
                      background: `linear-gradient(90deg, ${color}88, ${color})`,
                    }}
                  />
                </div>
                <span className="text-[7px] font-bold tracking-[0.12em]" style={{ color: `${color}99` }}>
                  {groupLabels[group]}
                </span>
              </div>
            );
          })}

          {/* Master */}
          <div className="flex-1 flex flex-col items-center gap-1.5">
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="h-full rounded-full transition-all duration-100"
                style={{
                  width: `${Math.max(5, (audioEngine.isInitialized ? audioEngine.getMasterLevel() : 0.5) * 100)}%`,
                  background: "linear-gradient(90deg, #aaa, #eee)",
                }}
              />
            </div>
            <span className="text-[7px] font-bold tracking-[0.12em] text-white/40">MASTER</span>
          </div>
        </div>
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse-border {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
