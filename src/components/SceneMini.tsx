/**
 * SceneMini — compact floating scene switcher panel.
 * Always accessible from any view. Shows 16 scene slots as small pads.
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
    if (isPlaying) {
      queueScene(slot);
    } else {
      loadScene(slot);
    }
  }, [scenes, isPlaying, loadScene, queueScene]);

  const filledCount = scenes.filter(Boolean).length;

  return (
    <div
      className="fixed bottom-16 right-3 z-40 rounded-xl border border-white/15 shadow-2xl"
      style={{
        background: "rgba(14,14,20,0.95)",
        backdropFilter: "blur(12px)",
        width: 200,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
        <span className="text-[9px] font-bold tracking-[0.2em] text-white/50">SCENES</span>
        <button onClick={onClose}
          className="text-[10px] text-white/30 hover:text-white/70 transition-colors leading-none">✕</button>
      </div>

      {/* 4×4 Grid */}
      <div className="grid grid-cols-4 gap-1 p-2">
        {scenes.map((scene, i) => {
          const isActive = activeScene === i;
          const isQueued = nextScene === i;
          const isEmpty = !scene;

          return (
            <button
              key={i}
              onClick={() => handleTap(i)}
              disabled={isEmpty}
              title={scene?.name ?? `Slot ${i + 1}`}
              className="relative aspect-square rounded-md border text-[8px] font-bold transition-all active:scale-90 flex items-center justify-center"
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
                opacity: isEmpty ? 0.25 : 1,
                color: isActive ? "#f59e0b" : isQueued ? "#60a5fa" : "rgba(255,255,255,0.6)",
              }}
            >
              {i + 1}
              {isActive && (
                <div className="absolute inset-0 rounded-md border border-[#f59e0b] pointer-events-none"
                  style={{ animation: "scene-mini-pulse 1.5s ease-in-out infinite" }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Status */}
      <div className="px-3 py-1.5 border-t border-white/8 text-[8px] text-white/30 flex justify-between">
        <span>{filledCount} scenes</span>
        {activeScene >= 0 && (
          <span className="text-[#f59e0b] font-bold truncate ml-2">
            {scenes[activeScene]?.name}
          </span>
        )}
        {nextScene !== null && scenes[nextScene] && (
          <span className="text-blue-400 font-bold animate-pulse ml-1">
            → {scenes[nextScene]?.name}
          </span>
        )}
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
