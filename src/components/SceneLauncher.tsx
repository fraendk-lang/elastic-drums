/**
 * Scene Launcher
 *
 * Modal overlay with a 4x4 grid of scene slots.
 * Click = load immediately, Shift+click = queue for next bar,
 * Right-click = capture current state into slot.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useSceneStore, type Scene } from "../store/sceneStore";

interface SceneLauncherProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Slot Component ─────────────────────────────────────

interface SlotProps {
  index: number;
  scene: Scene | null;
  isActive: boolean;
  isQueued: boolean;
  onLoad: (slot: number) => void;
  onQueue: (slot: number) => void;
  onCapture: (slot: number) => void;
  onClear: (slot: number) => void;
  onRename: (slot: number, name: string) => void;
}

function SceneSlot({ index, scene, isActive, isQueued, onLoad, onQueue, onCapture, onClear, onRename }: SlotProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = useCallback(() => {
    if (!scene) return;
    setEditName(scene.name);
    setIsEditing(true);
  }, [scene]);

  const commitRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed) {
      onRename(index, trimmed);
    }
    setIsEditing(false);
  }, [editName, index, onRename]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isEditing) return;
    if (!scene) return;
    if (e.shiftKey) {
      onQueue(index);
    } else {
      onLoad(index);
    }
  }, [scene, index, isEditing, onLoad, onQueue]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (scene && e.shiftKey) {
      onClear(index); // Shift+right-click = clear slot
    } else {
      onCapture(index); // Right-click = capture to slot
    }
  }, [scene, index, onCapture, onClear]);

  // Determine border and background colors
  let borderColor = "var(--ed-border)";
  let bgColor = "var(--ed-bg-surface)";
  let glowShadow = "none";

  if (isActive) {
    borderColor = "var(--ed-accent-orange)";
    bgColor = "color-mix(in srgb, var(--ed-accent-orange) 10%, var(--ed-bg-surface))";
    glowShadow = "0 0 12px rgba(245, 158, 11, 0.3)";
  } else if (isQueued) {
    borderColor = "var(--ed-accent-blue)";
    bgColor = "color-mix(in srgb, var(--ed-accent-blue) 8%, var(--ed-bg-surface))";
  }

  const hasData = scene !== null;
  const dotColor = isActive
    ? "var(--ed-accent-orange)"
    : isQueued
      ? "var(--ed-accent-blue)"
      : hasData
        ? "#10b981"
        : "var(--ed-text-muted)";

  return (
    <button
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      className="relative flex flex-col items-center justify-center gap-1 rounded-lg border transition-all duration-150 hover:brightness-110 cursor-pointer select-none"
      style={{
        borderColor,
        backgroundColor: bgColor,
        boxShadow: glowShadow,
        minHeight: "72px",
        animation: isQueued ? "ed-pulse-border 1.2s ease-in-out infinite" : undefined,
      }}
    >
      {/* Status dot */}
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: dotColor }}
      />

      {/* Scene number */}
      <span className="text-[10px] font-mono text-[var(--ed-text-muted)]">
        {index + 1}
      </span>

      {/* Name or edit input */}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setIsEditing(false);
          }}
          className="w-[90%] text-[9px] text-center bg-black/40 text-[var(--ed-text-primary)] border border-[var(--ed-accent-orange)] rounded px-1 py-0.5 outline-none"
          maxLength={16}
        />
      ) : (
        <span className="text-[9px] font-medium tracking-wider truncate max-w-full px-1"
          style={{
            color: hasData ? "var(--ed-text-secondary)" : "var(--ed-text-muted)",
            opacity: hasData ? 1 : 0.4,
          }}
        >
          {scene?.name ?? "EMPTY"}
        </span>
      )}

      {/* Active / Queued badge */}
      {isActive && (
        <span className="absolute top-1 right-1 text-[7px] font-bold tracking-wider text-[var(--ed-accent-orange)]">
          LIVE
        </span>
      )}
      {isQueued && !isActive && (
        <span className="absolute top-1 right-1 text-[7px] font-bold tracking-wider text-[var(--ed-accent-blue)]">
          NEXT
        </span>
      )}
    </button>
  );
}

// ─── Scene Launcher Modal ───────────────────────────────

export function SceneLauncher({ isOpen, onClose }: SceneLauncherProps) {
  const { scenes, activeScene, nextScene, captureScene, loadScene, queueScene, clearScene, renameScene } = useSceneStore();

  const handleCapture = useCallback((slot: number) => {
    captureScene(slot);
  }, [captureScene]);

  const handleCaptureNext = useCallback(() => {
    // Find next empty slot
    const emptyIndex = scenes.findIndex((s) => s === null);
    if (emptyIndex !== -1) {
      captureScene(emptyIndex);
    }
  }, [scenes, captureScene]);

  const handleClearAll = useCallback(() => {
    for (let i = 0; i < 16; i++) {
      clearScene(i);
    }
  }, [clearScene]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filledCount = scenes.filter((s) => s !== null).length;
  const hasEmpty = filledCount < 16;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-lg bg-[var(--ed-bg-secondary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[var(--ed-text-primary)] tracking-wider">
            SCENE LAUNCHER
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg px-1"
          >
            &times;
          </button>
        </div>

        {/* Instructions */}
        <div className="text-[9px] text-[var(--ed-text-muted)] mb-3 flex gap-4">
          <span>Click = Load</span>
          <span>Shift+Click = Queue</span>
          <span>Right-click = Capture</span>
        </div>

        {/* 4x4 Grid */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {scenes.map((scene, i) => (
            <SceneSlot
              key={i}
              index={i}
              scene={scene}
              isActive={activeScene === i}
              isQueued={nextScene === i}
              onLoad={loadScene}
              onQueue={queueScene}
              onCapture={handleCapture}
              onClear={clearScene}
              onRename={renameScene}
            />
          ))}
        </div>

        {/* Bottom bar */}
        <div className="flex gap-2">
          <button
            onClick={handleCaptureNext}
            disabled={!hasEmpty}
            className="flex-1 py-2 text-[10px] font-bold tracking-wider rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              backgroundColor: hasEmpty
                ? "color-mix(in srgb, var(--ed-accent-orange) 15%, transparent)"
                : undefined,
              color: hasEmpty ? "var(--ed-accent-orange)" : "var(--ed-text-muted)",
              border: `1px solid ${hasEmpty ? "color-mix(in srgb, var(--ed-accent-orange) 30%, transparent)" : "var(--ed-border)"}`,
            }}
          >
            CAPTURE ({filledCount}/16)
          </button>
          <button
            onClick={handleClearAll}
            disabled={filledCount === 0}
            className="px-4 py-2 text-[10px] font-bold tracking-wider rounded-lg text-[var(--ed-text-muted)] hover:text-red-400 bg-[var(--ed-bg-surface)] border border-[var(--ed-border)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            CLEAR ALL
          </button>
        </div>
      </div>

      {/* Pulsing border animation for queued slots */}
      <style>{`
        @keyframes ed-pulse-border {
          0%, 100% { border-color: var(--ed-accent-blue); opacity: 1; }
          50% { border-color: color-mix(in srgb, var(--ed-accent-blue) 40%, transparent); opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}
