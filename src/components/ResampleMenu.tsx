/**
 * ResampleMenu — Transport-bar "bounce" UI.
 *
 * Opens a popover with:
 *   - Bar-count selector (1 / 2 / 4 / 8)
 *   - Target pad picker (12 voices)
 *   - Big RESAMPLE button
 *
 * On click, calls `resampleToPad()` from utils/resample.ts which records the
 * live master output for the chosen number of bars and replaces the sample
 * on the chosen pad. Shows recording progress + a "✓ Done" flash on success.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { resampleToPad } from "../utils/resample";
import { HintPopover } from "./Hints";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM L",
  "TOM M", "TOM H", "HH CL", "HH OP",
  "CYM", "RIDE", "PRC1", "PRC2",
] as const;

const BARS_CHOICES = [1, 2, 4, 8] as const;

export function ResampleMenu() {
  const [open, setOpen] = useState(false);
  const [bars, setBars] = useState<1|2|4|8>(2);
  const [target, setTarget] = useState<number>(10); // default: PRC1 — least likely to overwrite drums
  const [state, setState] = useState<"idle" | "recording" | "encoding" | "done">("idle");
  const [barsDone, setBarsDone] = useState(0);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const startResample = useCallback(async () => {
    if (state === "recording" || state === "encoding") return;
    setState("recording");
    setBarsDone(0);
    try {
      await resampleToPad({
        bars,
        voiceIndex: target,
        name: `Bounce ${bars}b → ${VOICE_LABELS[target]}`,
        onProgress: (s, n) => {
          if (s === "recording") { setState("recording"); setBarsDone(n); }
          else if (s === "encoding") setState("encoding");
          else if (s === "done") {
            setState("done");
            setTimeout(() => setState("idle"), 1200);
          }
        },
      });
    } catch (err) {
      console.error("[Resample] failed:", err);
      setState("idle");
    }
  }, [bars, target, state]);

  const busy = state === "recording" || state === "encoding";

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className={`h-7 px-2.5 text-[10px] font-bold tracking-wider rounded transition-all ${
          busy
            ? "bg-red-500/25 text-red-200 animate-pulse"
            : open
              ? "bg-[var(--ed-accent-orange)]/25 text-[var(--ed-accent-orange)]"
              : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-white/5"
        }`}
        title="Resample — record master output and drop on a pad"
      >
        {state === "recording" ? `● ${barsDone}/${bars}` : state === "encoding" ? "..." : "BOUNCE"}
      </button>
      <HintPopover
        id="resample-bounce"
        anchor={btnRef.current}
        position="bottom"
        title="Bounce to a Pad"
        body="Record the live master output for N bars and drop the result on a pad slot — layer-on-layer producer workflow."
        triggered={open || state !== "idle"}
      />

      {open && (
        <div
          ref={popRef}
          className="absolute top-12 right-2 z-[180] w-[280px] rounded-lg border border-[var(--ed-accent-orange)]/40 bg-[#0d0d12]/97 backdrop-blur-md shadow-2xl p-3"
          style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.7)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="text-[9px] font-black tracking-[0.25em] uppercase text-[var(--ed-accent-orange)]">
              Resample → Pad
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-white/40 hover:text-white text-sm leading-none -mt-0.5 -mr-1"
            >×</button>
          </div>

          <div className="text-[10px] text-white/55 leading-snug mb-3">
            Records the live master output for the chosen length and replaces the sample on the chosen pad.
          </div>

          {/* Bars selector */}
          <div className="mb-3">
            <div className="text-[8px] font-bold tracking-[0.2em] uppercase text-white/45 mb-1">Length</div>
            <div className="flex gap-1">
              {BARS_CHOICES.map((n) => (
                <button
                  key={n}
                  onClick={() => setBars(n)}
                  disabled={busy}
                  className={`flex-1 py-1.5 rounded text-[10px] font-bold transition-all ${
                    bars === n
                      ? "bg-[var(--ed-accent-orange)] text-black"
                      : "bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-40"
                  }`}
                >
                  {n} {n === 1 ? "bar" : "bars"}
                </button>
              ))}
            </div>
          </div>

          {/* Target pad picker */}
          <div className="mb-3">
            <div className="text-[8px] font-bold tracking-[0.2em] uppercase text-white/45 mb-1">Target Pad</div>
            <div className="grid grid-cols-4 gap-1">
              {VOICE_LABELS.map((label, i) => (
                <button
                  key={label}
                  onClick={() => setTarget(i)}
                  disabled={busy}
                  className={`py-1.5 rounded text-[9px] font-bold transition-all ${
                    target === i
                      ? "bg-[var(--ed-accent-orange)] text-black"
                      : "bg-white/5 text-white/65 hover:bg-white/10 disabled:opacity-40"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Action */}
          <button
            onClick={startResample}
            disabled={busy}
            className={`w-full py-2.5 rounded-md text-[11px] font-black tracking-[0.2em] uppercase transition-all ${
              state === "done"
                ? "bg-green-500/30 text-green-200"
                : busy
                  ? "bg-red-500/30 text-red-200 cursor-not-allowed animate-pulse"
                  : "bg-[var(--ed-accent-orange)] text-black hover:brightness-110"
            }`}
          >
            {state === "recording" ? `● Recording ${barsDone}/${bars}` :
             state === "encoding"  ? "Decoding…" :
             state === "done"      ? `✓ Bounced to ${VOICE_LABELS[target]}` :
                                     "● Start Resample"}
          </button>
        </div>
      )}
    </>
  );
}
