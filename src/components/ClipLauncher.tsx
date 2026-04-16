/**
 * Clip Launcher — Ableton Session View-style clip matrix.
 *
 * Shows 4 tracks × 8 clip slots. Click = Launch, Shift+Click = Queue,
 * Ctrl/Cmd+Click = Capture current track state into that slot.
 */

import { useCallback, useEffect, useState } from "react";
import { useClipStore, CLIP_TRACKS, CLIP_SLOTS_PER_TRACK, type ClipTrack } from "../store/clipStore";
import { useSceneStore } from "../store/sceneStore";

interface ClipLauncherProps {
  isOpen: boolean;
  onClose: () => void;
}

const TRACK_META: Record<ClipTrack, { label: string; color: string }> = {
  drums: { label: "DRUMS", color: "var(--ed-accent-orange)" },
  bass: { label: "BASS", color: "var(--ed-accent-bass)" },
  chords: { label: "CHORDS", color: "var(--ed-accent-chords)" },
  melody: { label: "MELODY", color: "var(--ed-accent-melody)" },
};

export function ClipLauncher({ isOpen, onClose }: ClipLauncherProps) {
  const { clips, activeClips, queuedClips, captureClip, launchClip, queueClip, clearClip, renameClip, stopTrack } = useClipStore();
  const { launchQuantize, setLaunchQuantize } = useSceneStore();
  const [renaming, setRenaming] = useState<{ track: ClipTrack; slot: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const handleClipClick = useCallback((track: ClipTrack, slot: number, e: React.MouseEvent) => {
    const hasClip = !!clips[track][slot];
    if (e.ctrlKey || e.metaKey) {
      captureClip(track, slot);
      return;
    }
    if (!hasClip) {
      // Empty slot → capture on plain click
      captureClip(track, slot);
      return;
    }
    if (e.shiftKey || launchQuantize !== "immediate") {
      queueClip(track, slot);
    } else {
      launchClip(track, slot);
    }
  }, [clips, launchQuantize, captureClip, launchClip, queueClip]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded-xl shadow-2xl p-5 max-w-5xl w-[95vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold tracking-wider">CLIP LAUNCHER</h2>
            <div className="text-[9px] text-[var(--ed-text-muted)]">
              Empty slot: Click = Capture · Filled: Click/Shift+Click = Launch/Queue · Ctrl+Click = Re-capture · Right-click = Menu
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-lg px-2">×</button>
        </div>

        {/* Launch Quantize */}
        <div className="flex items-center gap-2 mb-3 text-[9px]">
          <span className="text-white/40 font-bold">QUANTIZE:</span>
          {(["immediate", "1bar", "2bar", "4bar"] as const).map((q) => (
            <button
              key={q}
              onClick={() => setLaunchQuantize(q)}
              className={`px-2 py-0.5 text-[8px] font-bold rounded transition-colors ${
                launchQuantize === q
                  ? "bg-[var(--ed-accent-orange)]/30 text-[var(--ed-accent-orange)]"
                  : "bg-white/5 text-white/40 hover:text-white/70"
              }`}
            >
              {q === "immediate" ? "NOW" : q.toUpperCase().replace("BAR", " BAR")}
            </button>
          ))}
        </div>

        {/* Matrix: rows = slots, columns = tracks */}
        <div className="grid gap-2" style={{ gridTemplateColumns: "40px repeat(4, 1fr)" }}>
          {/* Header row */}
          <div />
          {CLIP_TRACKS.map((t) => (
            <div key={t} className="flex items-center justify-between px-2 py-1 rounded bg-white/5">
              <span className="text-[10px] font-bold" style={{ color: TRACK_META[t].color }}>
                {TRACK_META[t].label}
              </span>
              <button
                onClick={() => stopTrack(t)}
                className="text-[8px] text-white/30 hover:text-white/70 font-bold"
                title="Stop track"
              >
                ■
              </button>
            </div>
          ))}

          {/* Slot rows */}
          {Array.from({ length: CLIP_SLOTS_PER_TRACK }, (_, slot) => (
            <div key={`row-${slot}`} className="contents">
              <div className="flex items-center justify-center text-[9px] text-white/25 font-mono">
                {slot + 1}
              </div>
              {CLIP_TRACKS.map((track) => {
                const clip = clips[track][slot];
                const isActive = activeClips[track] === slot;
                const isQueued = queuedClips[track] === slot;
                const color = TRACK_META[track].color;

                return (
                  <div
                    key={`${track}-${slot}`}
                    onClick={(e) => {
                      if (renaming?.track === track && renaming.slot === slot) return;
                      handleClipClick(track, slot, e);
                    }}
                    onDoubleClick={() => clip && setRenaming({ track, slot })}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (clip && confirm(`Delete clip "${clip.name}"?`)) clearClip(track, slot);
                    }}
                    className="relative h-14 rounded border cursor-pointer transition-all overflow-hidden"
                    style={{
                      borderColor: isActive
                        ? color
                        : isQueued
                          ? `${color}88`
                          : clip
                            ? `${color}44`
                            : "rgba(255,255,255,0.08)",
                      backgroundColor: isActive
                        ? `${color}33`
                        : isQueued
                          ? `${color}1a`
                          : clip
                            ? `${color}0f`
                            : "rgba(255,255,255,0.02)",
                      boxShadow: isActive ? `0 0 12px ${color}55` : "none",
                    }}
                  >
                    {clip ? (
                      <>
                        {/* Active/Queue indicator */}
                        <div
                          className="absolute top-1 right-1 w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: isActive ? color : isQueued ? `${color}aa` : "transparent",
                            border: isQueued && !isActive ? `1px solid ${color}` : "none",
                            animation: isQueued && !isActive ? "pulse 1s infinite" : "none",
                          }}
                        />
                        {/* Clip name */}
                        {renaming?.track === track && renaming.slot === slot ? (
                          <input
                            autoFocus
                            defaultValue={clip.name}
                            onBlur={(e) => {
                              renameClip(track, slot, e.target.value || clip.name);
                              setRenaming(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setRenaming(null);
                            }}
                            className="absolute inset-1 bg-black/40 text-[10px] px-1 rounded text-white outline-none"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-white/85 truncate px-1">
                              {clip.name}
                            </span>
                          </div>
                        )}
                        {/* Play triangle */}
                        <div
                          className="absolute bottom-1 left-1 w-0 h-0 pointer-events-none"
                          style={{
                            borderLeft: `5px solid ${color}`,
                            borderTop: "3px solid transparent",
                            borderBottom: "3px solid transparent",
                            opacity: isActive ? 1 : 0.4,
                          }}
                        />
                      </>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-white/15 text-[8px]">
                        +
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-3 text-[8px] text-white/25">
          Tip: Launch Queue resolves at bar boundaries based on the QUANTIZE setting. "NOW" launches immediately.
        </div>
      </div>
    </div>
  );
}
