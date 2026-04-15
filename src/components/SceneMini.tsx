/**
 * SceneMini — compact floating scene switcher panel.
 * Always accessible from any view via LIVE button. Same logic as Scene launcher.
 */

import { useCallback } from "react";
import { useDrumStore } from "../store/drumStore";
import { useSceneStore } from "../store/sceneStore";

interface SceneMiniProps {
  onClose: () => void;
}

export function SceneMini({ onClose }: SceneMiniProps) {
  const isPlaying = useDrumStore((s) => s.isPlaying);
  const scenes = useSceneStore((s) => s.scenes);
  const activeScene = useSceneStore((s) => s.activeScene);
  const nextScene = useSceneStore((s) => s.nextScene);
  const loadScene = useSceneStore((s) => s.loadScene);
  const queueScene = useSceneStore((s) => s.queueScene);

  const handleTap = useCallback((slot: number) => {
    if (!scenes[slot]) return;
    // Always load immediately — same behavior as Scene launcher
    loadScene(slot);
  }, [scenes, loadScene]);

  const handleShiftTap = useCallback((e: React.MouseEvent, slot: number) => {
    if (!scenes[slot]) return;
    if (e.shiftKey && isPlaying) {
      // Shift+Click = queue for next bar (only while playing)
      queueScene(slot);
    } else {
      loadScene(slot);
    }
  }, [scenes, isPlaying, loadScene, queueScene]);

  const filledCount = scenes.filter(Boolean).length;

  return (
    <div
      className="fixed z-[999] rounded-xl border border-white/15 shadow-2xl"
      style={{
        background: "rgba(14,14,20,0.96)",
        backdropFilter: "blur(16px)",
        width: 210,
        top: 48,
        right: 8,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="text-[9px] font-bold tracking-[0.2em] text-[var(--ed-accent-orange)]">SCENES</span>
        <button onClick={onClose}
          className="w-5 h-5 rounded flex items-center justify-center text-[10px] text-white/30 hover:text-white/70 hover:bg-white/10 transition-colors">✕</button>
      </div>

      {/* 4×4 Grid */}
      <div className="grid grid-cols-4 gap-1.5 p-2.5">
        {scenes.map((scene, i) => {
          const isActive = activeScene === i;
          const isQueued = nextScene === i;
          const isEmpty = !scene;

          return (
            <button
              key={i}
              onClick={(e) => handleShiftTap(e, i)}
              disabled={isEmpty}
              title={scene ? `${scene.name}${isPlaying ? " (Shift+Click = Queue)" : ""}` : `Empty slot ${i + 1}`}
              className="relative aspect-square rounded-lg border text-[9px] font-bold transition-all active:scale-90 flex flex-col items-center justify-center gap-0.5"
              style={{
                background: isActive
                  ? "rgba(245,158,11,0.2)"
                  : isQueued
                    ? "rgba(59,130,246,0.15)"
                    : isEmpty ? "transparent" : "rgba(255,255,255,0.04)",
                borderColor: isActive
                  ? "#f59e0b"
                  : isQueued
                    ? "#3b82f6"
                    : isEmpty ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.1)",
                borderStyle: isEmpty ? "dashed" : "solid",
                borderWidth: isActive ? 2 : 1,
                opacity: isEmpty ? 0.2 : 1,
                color: isActive ? "#f59e0b" : isQueued ? "#60a5fa" : "rgba(255,255,255,0.6)",
              }}
            >
              <span>{i + 1}</span>
              {isActive && (
                <div className="absolute inset-0 rounded-lg border-2 border-[#f59e0b] pointer-events-none"
                  style={{ animation: "scene-mini-pulse 1.5s ease-in-out infinite" }} />
              )}
              {isQueued && !isActive && (
                <span className="absolute bottom-0.5 text-[6px] text-blue-400 font-bold animate-pulse">NEXT</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Status bar */}
      <div className="px-3 py-1.5 border-t border-white/8 text-[8px] flex justify-between items-center">
        <span className="text-white/25">{filledCount} scenes</span>
        <div className="flex items-center gap-1 truncate ml-2">
          {activeScene >= 0 && (
            <span className="text-[#f59e0b] font-bold truncate">
              {scenes[activeScene]?.name}
            </span>
          )}
          {nextScene !== null && scenes[nextScene] && (
            <span className="text-blue-400 font-bold animate-pulse truncate">
              → {scenes[nextScene]?.name}
            </span>
          )}
        </div>
      </div>

      <style>{`
        @keyframes scene-mini-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
