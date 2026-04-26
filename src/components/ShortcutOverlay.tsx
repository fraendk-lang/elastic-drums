/**
 * ShortcutOverlay — Centered modal showing all keyboard shortcuts.
 * Toggle with ? key. Close with Escape or backdrop click.
 */
import { useEffect } from "react";
import { useOverlayStore } from "../store/overlayStore";

interface ShortcutGroup {
  title: string;
  color: string;
  shortcuts: [string, string][];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: "DRUMS / SEQUENCER",
    color: "#f59e0b",
    shortcuts: [
      ["Q W E R", "Kick · Snare · Clap · Tom Lo"],
      ["A S D F", "Tom M · Tom H · HH Cl · HH Op"],
      ["Z X C V", "Cym · Ride · Perc 1 · Perc 2"],
      ["Space", "Play / Stop"],
      ["1 – 9, 0", "Load preset 1–10"],
      ["← →", "Prev / Next preset"],
      ["Ctrl+Z", "Undo"],
      ["Ctrl+Shift+Z", "Redo"],
    ],
  },
  {
    title: "PIANO ROLL",
    color: "#a78bfa",
    shortcuts: [
      ["B", "Draw mode"],
      ["S", "Select mode"],
      ["L", "Toggle loop brace"],
      ["D", "Duplicate selected"],
      ["↑ ↓", "Transpose ±1 semitone"],
      ["Shift+↑↓", "Transpose ±1 octave"],
      ["Ctrl+A", "Select all"],
      ["Ctrl+C / V", "Copy / Paste"],
      ["Delete", "Delete selected"],
    ],
  },
  {
    title: "LOOPS / GLOBAL",
    color: "#2EC4B6",
    shortcuts: [
      ["Shift+1–0", "Queue scene 1–10"],
      ["T", "Tap tempo"],
      ["?", "Toggle this overlay"],
      ["Escape", "Close overlay"],
    ],
  },
];

export function ShortcutOverlay() {
  const isOpen = useOverlayStore((s) => s.isOpen("shortcuts"));
  const close  = useOverlayStore((s) => s.closeOverlay);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close("shortcuts");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}
      onClick={() => close("shortcuts")}
    >
      <div
        className="relative rounded-xl border border-white/10 bg-[var(--ed-bg-surface)] shadow-2xl"
        style={{ width: "min(860px, 95vw)", maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div>
            <h2 className="text-[13px] font-black tracking-[0.18em] text-white/90">KEYBOARD SHORTCUTS</h2>
            <p className="text-[9px] font-bold tracking-[0.12em] text-white/30 mt-0.5">Press ? or Escape to dismiss</p>
          </div>
          <button
            onClick={() => close("shortcuts")}
            className="text-[18px] text-white/30 hover:text-white/70 transition-colors leading-none"
            aria-label="Close shortcuts"
          >
            ×
          </button>
        </div>

        {/* 3-column grid */}
        <div className="grid grid-cols-3 gap-0 divide-x divide-white/5 px-2 py-4">
          {GROUPS.map((group) => (
            <div key={group.title} className="px-4 py-2">
              <div
                className="text-[8px] font-black tracking-[0.2em] mb-3 pb-1.5 border-b"
                style={{ color: group.color, borderColor: `${group.color}30` }}
              >
                {group.title}
              </div>
              <div className="flex flex-col gap-1.5">
                {group.shortcuts.map(([key, desc]) => (
                  <div key={key} className="flex items-start gap-2">
                    <kbd
                      className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        color: "rgba(255,255,255,0.75)",
                        minWidth: 28,
                        textAlign: "center",
                        fontFamily: "monospace",
                      }}
                    >
                      {key}
                    </kbd>
                    <span className="text-[9px] text-white/45 leading-tight pt-0.5">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
