/**
 * SliceMenu — drop a long sample, get an MPC-style slice kit.
 *
 * Transport-bar popover with:
 *   - File chooser (or "drop a file here" zone)
 *   - Slice count (4 / 8 / 12 / 16)
 *   - Mode toggle (Even — grid divisions / Transient — onset-detected)
 *   - Start pad (default KICK = 0, so the original 12 drum voices get
 *     overwritten with the slices — user can pick PRC1 etc. to preserve
 *     drums and put slices on a subset)
 *   - Big SLICE button
 *
 * Result: the chosen number of slices is dropped on consecutive pad
 * slots starting at the chosen start pad, ready to trigger via the
 * sequencer / keyboard / MIDI.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { sliceToPads, type SliceMode } from "../utils/sliceSample";
import { HintPopover } from "./Hints";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM L",
  "TOM M", "TOM H", "HH CL", "HH OP",
  "CYM", "RIDE", "PRC1", "PRC2",
] as const;

const COUNT_CHOICES = [4, 8, 12, 16] as const;

export function SliceMenu() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<4 | 8 | 12 | 16>(8);
  const [mode, setMode] = useState<SliceMode>("transient");
  const [startVoice, setStartVoice] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click / Escape
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

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && (f.type.startsWith("audio/") || /\.(wav|mp3|ogg|flac|m4a|webm)$/i.test(f.name))) {
      setFile(f);
    }
  }, []);

  const onFilePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) setFile(f);
  }, []);

  const onSlice = useCallback(async () => {
    if (!file || busy) return;
    setBusy(true);
    setDone(null);
    try {
      const result = await sliceToPads({ source: file, count, mode, startVoice });
      setDone(result.slicesWritten);
      setTimeout(() => setDone(null), 1500);
    } catch (err) {
      console.error("[Slice] failed:", err);
    } finally {
      setBusy(false);
    }
  }, [file, count, mode, startVoice, busy]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className={`h-7 px-2.5 text-[10px] font-bold tracking-wider rounded transition-all ${
          open
            ? "bg-[var(--ed-accent-orange)]/25 text-[var(--ed-accent-orange)]"
            : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-white/5"
        }`}
        title="Slice — chop a long sample into pad slots"
      >
        SLICE
      </button>
      <HintPopover
        id="slice-chop"
        anchor={btnRef.current}
        position="bottom"
        title="Slice a Long Sample"
        body="Drop a break / vocal / loop and split it into N pads (Even or Transient-detected). Each slice becomes a one-shot — chop and rearrange."
        triggered={open || busy}
      />

      {open && (
        <div
          ref={popRef}
          className="absolute top-12 right-2 z-[180] w-[320px] rounded-lg border border-[var(--ed-accent-orange)]/40 bg-[#0d0d12]/97 backdrop-blur-md shadow-2xl p-3"
          style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.7)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-[9px] font-black tracking-[0.25em] uppercase text-[var(--ed-accent-orange)]">
              Slice → Pads
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-white/40 hover:text-white text-sm leading-none -mt-0.5 -mr-1"
            >×</button>
          </div>

          <div className="text-[10px] text-white/55 leading-snug mb-3">
            Chop a long sample (drum break, vocal loop, melodic phrase) into N pieces and lay them across consecutive pads.
          </div>

          {/* File drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`mb-3 px-3 py-3 rounded border-2 border-dashed text-[10px] font-bold tracking-wide uppercase text-center cursor-pointer transition-all ${
              dragging
                ? "border-[var(--ed-accent-orange)] bg-[var(--ed-accent-orange)]/10 text-[var(--ed-accent-orange)]"
                : file
                  ? "border-green-400/40 bg-green-400/5 text-green-300"
                  : "border-white/15 hover:border-white/30 text-white/55"
            }`}
          >
            {file ? `✓ ${file.name}` : "Drop file · or click to pick"}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.webm"
              onChange={onFilePicked}
              className="hidden"
            />
          </div>

          {/* Count */}
          <div className="mb-3">
            <div className="text-[8px] font-bold tracking-[0.2em] uppercase text-white/45 mb-1">Slices</div>
            <div className="flex gap-1">
              {COUNT_CHOICES.map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  disabled={busy}
                  className={`flex-1 py-1.5 rounded text-[10px] font-bold transition-all ${
                    count === n
                      ? "bg-[var(--ed-accent-orange)] text-black"
                      : "bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-40"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Mode */}
          <div className="mb-3">
            <div className="text-[8px] font-bold tracking-[0.2em] uppercase text-white/45 mb-1">Mode</div>
            <div className="flex gap-1">
              <button
                onClick={() => setMode("even")}
                disabled={busy}
                title="Divide into equal-length pieces — best for already-quantised loops"
                className={`flex-1 py-1.5 rounded text-[10px] font-bold transition-all ${
                  mode === "even" ? "bg-[var(--ed-accent-orange)] text-black" : "bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-40"
                }`}
              >
                Even
              </button>
              <button
                onClick={() => setMode("transient")}
                disabled={busy}
                title="Detect note onsets via spectral flux — best for drum breaks"
                className={`flex-1 py-1.5 rounded text-[10px] font-bold transition-all ${
                  mode === "transient" ? "bg-[var(--ed-accent-orange)] text-black" : "bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-40"
                }`}
              >
                Transient
              </button>
            </div>
          </div>

          {/* Start pad */}
          <div className="mb-3">
            <div className="text-[8px] font-bold tracking-[0.2em] uppercase text-white/45 mb-1">Start at pad</div>
            <div className="grid grid-cols-4 gap-1">
              {VOICE_LABELS.map((label, i) => (
                <button
                  key={label}
                  onClick={() => setStartVoice(i)}
                  disabled={busy}
                  className={`py-1.5 rounded text-[9px] font-bold transition-all ${
                    startVoice === i
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
            onClick={onSlice}
            disabled={busy || !file}
            className={`w-full py-2.5 rounded-md text-[11px] font-black tracking-[0.2em] uppercase transition-all ${
              done !== null
                ? "bg-green-500/30 text-green-200"
                : !file
                  ? "bg-white/5 text-white/30 cursor-not-allowed"
                  : busy
                    ? "bg-red-500/30 text-red-200 cursor-not-allowed animate-pulse"
                    : "bg-[var(--ed-accent-orange)] text-black hover:brightness-110"
            }`}
          >
            {done !== null   ? `✓ ${done} slices to pads` :
             busy            ? "Slicing…" :
             !file           ? "Pick a file first" :
                               `▷ Slice into ${count} pieces`}
          </button>
        </div>
      )}
    </>
  );
}
