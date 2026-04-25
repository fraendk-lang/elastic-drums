/**
 * Scene Launcher — with right-click context menu
 *
 * 4x4 grid of scene slots.
 * Click = load, Shift+Click = queue for next bar.
 * Right-click = context menu with: Capture, Edit (rename), Delete, Load, Queue.
 * Double-click = rename.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useSceneStore, type Scene, type FollowAction } from "../store/sceneStore";

interface SceneLauncherProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Context Menu ──────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  slotIndex: number;
  hasData: boolean;
}

interface ContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  onCapture: (slot: number) => void;
  onUpdate: (slot: number) => void;
  onLoad: (slot: number) => void;
  onQueue: (slot: number) => void;
  onRename: (slot: number) => void;
  onClear: (slot: number) => void;
  onDuplicate: (slot: number) => void;
  onSetFollowAction: (slot: number, action: FollowAction) => void;
  currentFollowAction?: FollowAction;
}

function SceneContextMenu({ menu, onClose, onCapture, onUpdate, onLoad, onQueue, onRename, onClear, onDuplicate, onSetFollowAction, currentFollowAction }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const FA_OPTIONS: { action: FollowAction; label: string; icon: string }[] = [
    { action: "none",   label: "Loop (default)", icon: "↺" },
    { action: "next",   label: "Next Scene →",   icon: "⏭" },
    { action: "random", label: "Random Scene ⚄", icon: "⚄" },
  ];

  const items = menu.hasData
    ? [
        { label: "Load", icon: "▶", action: () => onLoad(menu.slotIndex), color: "var(--ed-accent-orange)" },
        { label: "Queue Next", icon: "⏭", action: () => onQueue(menu.slotIndex), color: "var(--ed-accent-blue)" },
        { label: "divider" },
        { label: "Rename", icon: "✎", action: () => onRename(menu.slotIndex) },
        { label: "Duplicate", icon: "⧉", action: () => onDuplicate(menu.slotIndex) },
        { label: "Update (Save Edits)", icon: "↻", action: () => onUpdate(menu.slotIndex), color: "var(--ed-accent-green)" },
        { label: "Overwrite (Fresh)", icon: "⏺", action: () => onCapture(menu.slotIndex) },
        { label: "divider" },
        { label: "Delete", icon: "✕", action: () => onClear(menu.slotIndex), color: "#ef4444" },
      ]
    : [
        { label: "Capture Here", icon: "⏺", action: () => onCapture(menu.slotIndex), color: "var(--ed-accent-green)" },
      ];

  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-[160px] py-1 bg-[#1a1a20] border border-[var(--ed-border)] rounded-lg shadow-2xl"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.label === "divider") {
          return <div key={`div-${i}`} className="h-px bg-[var(--ed-border)]/50 my-1 mx-2" />;
        }
        return (
          <button
            key={item.label}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              item.action?.(); onClose();
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-left hover:bg-white/5 transition-colors"
            style={{ color: item.color ?? "var(--ed-text-secondary)" }}
          >
            <span className="w-4 text-center text-[11px] opacity-70">{item.icon}</span>
            <span className="font-medium tracking-wider">{item.label}</span>
          </button>
        );
      })}

      {/* Follow Actions — only for filled slots */}
      {menu.hasData && (
        <>
          <div className="h-px bg-[var(--ed-border)]/50 my-1 mx-2" />
          <div className="px-3 pt-1 pb-0.5">
            <span className="text-[8px] font-bold tracking-[0.18em] text-white/25">FOLLOW ACTION</span>
          </div>
          {FA_OPTIONS.map(({ action, label, icon }) => {
            const isActive = (currentFollowAction ?? "none") === action;
            return (
              <button
                key={action}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  onSetFollowAction(menu.slotIndex, action);
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-left hover:bg-white/5 transition-colors"
                style={{
                  color: isActive ? "var(--ed-accent-orange)" : "var(--ed-text-secondary)",
                  fontWeight: isActive ? "700" : "400",
                }}
              >
                <span className="w-4 text-center text-[11px] opacity-70">{icon}</span>
                <span className="tracking-wider">{label}</span>
                {isActive && <span className="ml-auto text-[8px] text-[var(--ed-accent-orange)]">●</span>}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── Slot Component ─────────────────────────────────────

interface SlotProps {
  index: number;
  scene: Scene | null;
  isActive: boolean;
  isQueued: boolean;
  onLoad: (slot: number) => void;
  onQueue: (slot: number) => void;
  onContextMenu: (e: React.MouseEvent, slot: number) => void;
  onStartRename: (slot: number) => void;
  onRename: (slot: number, name: string) => void;
  isRenaming: boolean;
}

function SceneSlot({ index, scene, isActive, isQueued, onLoad, onQueue, onContextMenu, onStartRename, onRename, isRenaming }: SlotProps) {
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current && scene) {
      setEditName(scene.name);
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming, scene]);

  const commitRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed) onRename(index, trimmed);
  }, [editName, index, onRename]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isRenaming) return;
    if (!scene) return;
    if (e.shiftKey) {
      onQueue(index);
    } else {
      onLoad(index);
    }
  }, [scene, index, isRenaming, onLoad, onQueue]);

  const handleCtxMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(e, index);
  }, [index, onContextMenu]);

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
      onDoubleClick={() => { if (scene) onStartRename(index); }}
      onContextMenu={handleCtxMenu}
      className="relative flex flex-col items-center justify-center gap-1 rounded-lg border transition-all duration-150 hover:brightness-110 cursor-pointer select-none"
      style={{
        borderColor,
        backgroundColor: bgColor,
        boxShadow: glowShadow,
        minHeight: "72px",
        animation: isQueued ? "ed-pulse-border 1.2s ease-in-out infinite" : undefined,
      }}
      aria-label={`Scene ${index + 1}${scene ? `: ${scene.name}` : ", empty"}${isActive ? " (active)" : ""}${isQueued ? " (queued)" : ""}`}
    >
      {/* Status dot */}
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: dotColor }} />

      {/* Scene number */}
      <span className="text-[10px] font-mono text-[var(--ed-text-muted)]">{index + 1}</span>

      {/* Name or edit input */}
      {isRenaming ? (
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") onRename(index, scene?.name ?? "");
          }}
          onClick={(e) => e.stopPropagation()}
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
        <span className="absolute top-1 right-1 text-[7px] font-bold tracking-wider text-[var(--ed-accent-orange)]">LIVE</span>
      )}
      {isQueued && !isActive && (
        <span className="absolute top-1 right-1 text-[7px] font-bold tracking-wider text-[var(--ed-accent-blue)]">NEXT</span>
      )}
      {/* Follow Action indicator */}
      {scene?.followAction && scene.followAction !== "none" && (
        <span
          className="absolute bottom-1 right-1 text-[8px] leading-none"
          title={`Follow: ${scene.followAction}`}
        >
          {scene.followAction === "next" ? "⏭" : "⚄"}
        </span>
      )}
    </button>
  );
}

// ─── Scene Launcher Modal ───────────────────────────────

export function SceneLauncher({ isOpen, onClose }: SceneLauncherProps) {
  const { scenes, activeScene, nextScene, captureScene, updateScene, loadScene, queueScene, clearScene, renameScene, duplicateScene, launchQuantize, setLaunchQuantize, setSceneFollowAction } = useSceneStore();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingSlot, setRenamingSlot] = useState<number | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, slotIndex: number) => {
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 160),
      y: Math.min(e.clientY, window.innerHeight - 250),
      slotIndex,
      hasData: scenes[slotIndex] !== null,
    });
  }, [scenes]);

  const handleCapture = useCallback((slot: number) => {
    captureScene(slot);
  }, [captureScene]);

  const handleDuplicate = useCallback((slot: number) => {
    duplicateScene(slot);
  }, [duplicateScene]);

  const handleUpdate = useCallback((slot: number) => {
    updateScene(slot);
  }, [updateScene]);

  const handleStartRename = useCallback((slot: number) => {
    setRenamingSlot(slot);
    setContextMenu(null);
  }, []);

  const handleRename = useCallback((slot: number, name: string) => {
    if (name) renameScene(slot, name);
    setRenamingSlot(null);
  }, [renameScene]);

  const handleCaptureNext = useCallback(() => {
    const emptyIndex = scenes.findIndex((s) => s === null);
    if (emptyIndex !== -1) captureScene(emptyIndex);
  }, [scenes, captureScene]);

  const handleClearAll = useCallback(() => {
    for (let i = 0; i < 16; i++) clearScene(i);
  }, [clearScene]);

  // Close context menu on scroll or modal close
  useEffect(() => {
    if (!isOpen) { setContextMenu(null); setRenamingSlot(null); }
  }, [isOpen]);

  // Escape closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (contextMenu) { setContextMenu(null); return; }
        if (renamingSlot !== null) { setRenamingSlot(null); return; }
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose, contextMenu, renamingSlot]);

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
          <h2 className="text-sm font-bold text-[var(--ed-text-primary)] tracking-wider">SCENE LAUNCHER</h2>
          <button onClick={onClose} className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg px-1" aria-label="Close">&times;</button>
        </div>

        {/* Instructions + Launch Quantize */}
        <div className="text-[9px] text-[var(--ed-text-muted)] mb-3 flex items-center gap-4">
          <span>Click = Load</span>
          <span>Shift+Click = Queue</span>
          <span>Right-click = Menu</span>
          <span>Double-click = Rename</span>
          <span className="ml-auto" />
          <div className="flex items-center gap-1 border border-white/8 rounded-lg px-2 py-1 bg-black/20">
            <span className="text-[7px] font-black tracking-[0.16em] text-white/35 mr-0.5">LAUNCH</span>
            {(["immediate", "1bar", "2bar", "4bar"] as const).map((q) => (
              <button
                key={q}
                onClick={() => setLaunchQuantize(q)}
                title={q === "immediate" ? "Launch immediately" : `Wait for next ${q.replace("bar","")}-bar boundary`}
                className={`px-1.5 py-0.5 text-[7px] font-black rounded transition-all ${
                  launchQuantize === q
                    ? "bg-[var(--ed-accent-orange)]/25 text-[var(--ed-accent-orange)] border border-[var(--ed-accent-orange)]/40"
                    : "text-white/30 hover:text-white/65 hover:bg-white/5 border border-transparent"
                }`}
              >
                {q === "immediate" ? "NOW" : q === "1bar" ? "1B" : q === "2bar" ? "2B" : "4B"}
              </button>
            ))}
          </div>
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
              onContextMenu={handleContextMenu}
              onStartRename={handleStartRename}
              onRename={handleRename}
              isRenaming={renamingSlot === i}
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
              backgroundColor: hasEmpty ? "color-mix(in srgb, var(--ed-accent-orange) 15%, transparent)" : undefined,
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

      {/* Context Menu */}
      {contextMenu && (
        <SceneContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onCapture={handleCapture}
          onUpdate={handleUpdate}
          onLoad={loadScene}
          onQueue={queueScene}
          onRename={handleStartRename}
          onClear={clearScene}
          onDuplicate={handleDuplicate}
          onSetFollowAction={setSceneFollowAction}
          currentFollowAction={scenes[contextMenu.slotIndex]?.followAction}
        />
      )}

      {/* Pulsing border animation */}
      <style>{`
        @keyframes ed-pulse-border {
          0%, 100% { border-color: var(--ed-accent-blue); opacity: 1; }
          50% { border-color: color-mix(in srgb, var(--ed-accent-blue) 40%, transparent); opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}
