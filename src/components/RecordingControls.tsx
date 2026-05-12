/**
 * RecordingControls — visible when `?demo=record&audio=1` is active.
 *
 * Lets Frank trigger an `autoRecordExport()` of the choreographed
 * RecordingOrchestrator performance so the resulting WAV can be dropped
 * straight into the Remotion project as the video soundtrack.
 *
 * Renders a single fixed-position pill (bottom-center) with:
 *   - State label ("READY" / "RECORDING" / "ENCODING" / "DONE")
 *   - Bars-done / bars-total progress
 *   - Big EXPORT button
 *
 * Hidden by default — only mounts when the parent App passes audioMode=true.
 */

import { useCallback, useState } from "react";
import { autoRecordExport, type RecordExportProgress } from "../utils/autoRecordExport";

interface Props {
  /** Bars to record — should equal the orchestrator's timeline length. */
  bars: number;
}

export function RecordingControls({ bars }: Props) {
  const [progress, setProgress] = useState<RecordExportProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const onExport = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setProgress({ state: "starting", barsDone: 0, barsTotal: bars, elapsedSec: 0, totalSec: 0 });
    try {
      await autoRecordExport({
        bars,
        tail: 0.5,
        filename: "elastic-groove-soundtrack",
        onProgress: setProgress,
      });
    } catch (err) {
      console.error("[RecCtrl] export failed:", err);
      setProgress({
        state: "error", barsDone: 0, barsTotal: bars, elapsedSec: 0, totalSec: 0,
        errorMsg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [bars, busy]);

  const state = progress?.state ?? "idle";
  const label =
    state === "starting"  ? "Starting…" :
    state === "recording" ? `Recording ${progress?.barsDone}/${bars}` :
    state === "encoding"  ? "Encoding WAV…" :
    state === "uploading" ? "Uploading…" :
    state === "done"      ? "✓ WAV downloaded" :
    state === "error"     ? `Error: ${progress?.errorMsg ?? ""}` :
                            "Ready";

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[180] flex items-center gap-3 rounded-full border border-[var(--ed-accent-orange)]/50 bg-[#0d0d12]/95 backdrop-blur-md shadow-2xl px-5 py-3"
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.7)" }}
    >
      <div className="text-[10px] font-black tracking-[0.2em] uppercase text-white/70 min-w-[140px]">
        {label}
      </div>
      <button
        onClick={onExport}
        disabled={busy}
        className={`px-4 py-1.5 rounded-full text-[10px] font-black tracking-[0.2em] uppercase transition-all ${
          busy
            ? "bg-white/10 text-white/40 cursor-not-allowed"
            : "bg-[var(--ed-accent-orange)] text-black hover:brightness-110"
        }`}
      >
        Export Soundtrack
      </button>
    </div>
  );
}
