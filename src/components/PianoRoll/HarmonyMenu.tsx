import React, { useEffect, useRef, useState } from "react";
import { HARMONY_PRESETS, type HarmonyType } from "./harmony";

export function HarmonyMenu({
  accentColor,
  onGenerate,
}: {
  accentColor: string;
  onGenerate: (type: HarmonyType) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  let lastGroup = "";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-0.5 text-[7px] font-bold tracking-wider rounded transition-all hover:brightness-110"
        style={{
          backgroundColor: open ? accentColor : "rgba(255,255,255,0.05)",
          color: open ? "#000" : accentColor,
          border: `1px solid ${open ? accentColor : accentColor + "50"}`,
          boxShadow: open ? `0 0 8px ${accentColor}40` : "none",
        }}
      >
        HARMONY
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] bg-[#1a1a22] border border-[var(--ed-border)] rounded-lg shadow-2xl py-1 overflow-hidden">
          {HARMONY_PRESETS.map((preset) => {
            const showGroupHeader = preset.group !== lastGroup;
            lastGroup = preset.group;
            return (
              <React.Fragment key={preset.id}>
                {showGroupHeader && (
                  <div className="px-3 pt-2 pb-1 text-[6px] font-bold tracking-[0.2em] text-white/25 uppercase">
                    {preset.group}
                  </div>
                )}
                <button
                  onClick={() => {
                    onGenerate(preset.id);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-[9px] text-white/70 hover:text-white hover:bg-white/8 transition-colors"
                >
                  {preset.label}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
