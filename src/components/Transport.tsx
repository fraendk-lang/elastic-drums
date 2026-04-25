import { useState, useRef, useCallback, useEffect } from "react";
import { useDrumStore, setFillMode } from "../store/drumStore";
import { useSceneStore } from "../store/sceneStore";
import { downloadMidi } from "../utils/midiExport";
import { sharePattern } from "../utils/patternShare";
import { startSongRecording, stopSongRecording, isRecording, type ExportState } from "../utils/songExport";
import { autoRecordExport, cancelAutoRecord, type RecordExportProgress } from "../utils/autoRecordExport";

interface TransportProps {
  onOpenBrowser: () => void;
  onOpenEuclidean: () => void;
  onOpenSong: () => void;
  onOpenScenes: () => void;
  onOpenClips: () => void;
  onOpenArrangement: () => void;
  onOpenModMatrix: () => void;
  onOpenMacros: () => void;
  onOpenMidiLearn: () => void;
  onOpenMidiClock: () => void;
  onOpenFx: () => void;
  onOpenMixer: () => void;
  onOpenKits: () => void;
  onToggleHelp: () => void;
  onOpenMidi: () => void;
  onOpenPerformance?: () => void;
  onOpenPad?: () => void;
}

export function Transport({
  onOpenBrowser, onOpenEuclidean, onOpenSong, onOpenScenes, onOpenClips, onOpenArrangement, onOpenModMatrix, onOpenMacros, onOpenMidiLearn, onOpenMidiClock, onOpenFx, onOpenMixer, onOpenKits, onOpenMidi, onToggleHelp, onOpenPerformance, onOpenPad,
}: TransportProps) {
  // Per-field selectors so Transport does NOT re-render on every currentStep tick
  const bpm = useDrumStore((s) => s.bpm);
  const isPlaying = useDrumStore((s) => s.isPlaying);
  const swing = useDrumStore((s) => s.swing);
  const pattern = useDrumStore((s) => s.pattern);
  const setBpm = useDrumStore((s) => s.setBpm);
  const setSwing = useDrumStore((s) => s.setSwing);
  const togglePlay = useDrumStore((s) => s.togglePlay);
  const nextPreset = useDrumStore((s) => s.nextPreset);
  const prevPreset = useDrumStore((s) => s.prevPreset);
  const clearPattern = useDrumStore((s) => s.clearPattern);
  const newSession = useDrumStore((s) => s.newSession);
  const launchQuantize = useSceneStore((s) => s.launchQuantize);
  const setLaunchQuantize = useSceneStore((s) => s.setLaunchQuantize);

  // Tap Tempo with visual feedback
  const [tapFlash, setTapFlash] = useState(false);
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  const tapTimes = useRef<number[]>([]);

  const handleTap = useCallback(() => {
    // Visual feedback: flash the button
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 150);

    const now = performance.now();
    tapTimes.current.push(now);
    if (tapTimes.current.length > 6) tapTimes.current.shift();
    if (tapTimes.current.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < tapTimes.current.length; i++) {
        intervals.push(tapTimes.current[i]! - tapTimes.current[i - 1]!);
      }
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const tappedBpm = Math.round(60000 / avgMs);
      if (tappedBpm >= 30 && tappedBpm <= 300) {
        setBpm(tappedBpm);
        setDetectedBpm(tappedBpm);
        setTimeout(() => setDetectedBpm(null), 1500);
      }
    }
    setTimeout(() => {
      if (tapTimes.current.length > 0 && performance.now() - tapTimes.current[tapTimes.current.length - 1]! > 2000) {
        tapTimes.current = [];
      }
    }, 2100);
  }, [setBpm]);

  // Keyboard shortcut for tap tempo (T key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 't' || e.key === 'T') {
        handleTap();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTap]);

  return (
    <header className="flex items-center h-11 px-3 border-b border-[var(--ed-border)]/70 bg-gradient-to-b from-[#111116] to-[#0d0d11] gap-1.5 relative z-20 overflow-x-auto overflow-y-hidden">

      {/* ── Brand ── */}
      <span className="text-[10px] font-black tracking-[0.25em] text-[var(--ed-accent-orange)] mr-1.5 hidden lg:block">
        ELASTIC GROOVE
      </span>
      <span className="text-[10px] font-black tracking-[0.25em] text-[var(--ed-accent-orange)] mr-1 lg:hidden">EG</span>

      <Sep />

      {/* ── Transport ── */}
      <button
        onClick={togglePlay}
        aria-label={isPlaying ? "Stop" : "Play"}
        className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold transition-all ed-pad-press ${
          isPlaying
            ? "bg-red-500/15 text-red-400 border border-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.15)]"
            : "bg-white/5 text-white/70 border border-white/10 hover:bg-white/10 hover:text-white hover:shadow-[0_0_10px_rgba(255,255,255,0.05)]"
        }`}
      >
        {isPlaying ? "■" : "▶"}
      </button>

      <FillButton />

      {/* BPM */}
      <div className="flex items-center bg-black/30 rounded-md border border-white/6 px-0.5 relative">
        <input
          type="number" min={30} max={300} value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
          aria-label="Tempo in BPM"
          className="w-11 h-7 px-1 text-center text-[12px] font-mono bg-transparent text-[var(--ed-accent-orange)] focus:outline-none font-bold tabular-nums"
        />
        <button
          onClick={handleTap}
          aria-label="Tap to set tempo"
          className={`h-5 px-1.5 text-[7px] font-bold tracking-wider transition-all border-l border-white/6 ${
            tapFlash
              ? "text-white/80 bg-white/20"
              : "text-white/25 hover:text-white/60"
          }`}
        >
          TAP
        </button>
        {detectedBpm && (
          <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-[10px] font-bold text-white/60 pointer-events-none whitespace-nowrap bg-black/50 px-2 py-0.5 rounded">
            {detectedBpm} BPM
          </div>
        )}
      </div>

      {/* Swing */}
      <div className="flex items-center gap-1 ml-0.5">
        <span className="text-[7px] text-white/25 uppercase font-bold">Swg</span>
        <input type="range" min={50} max={75} value={swing}
          onChange={(e) => setSwing(Number(e.target.value))}
          aria-label="Swing amount"
          className="w-10 h-[3px] accent-gray-500" />
        <span className="text-[9px] font-mono text-white/35 w-4 tabular-nums">{swing}</span>
      </div>

      {/* Launch Quantize */}
      <div className="flex items-center gap-1 ml-0.5">
        <span className="text-[7px] text-white/25 uppercase font-bold shrink-0">Q</span>
        {(["immediate", "1bar", "2bar", "4bar"] as const).map((q) => (
          <button
            key={q}
            onClick={() => setLaunchQuantize(q)}
            title={q === "immediate" ? "Scene launches immediately" : `Scene launches at next ${q.replace("bar","")}‑bar boundary`}
            className={`px-1 py-0.5 text-[7px] font-black rounded transition-all ${
              launchQuantize === q
                ? "bg-[var(--ed-accent-orange)]/22 text-[var(--ed-accent-orange)]"
                : "text-white/20 hover:text-white/55"
            }`}
          >
            {q === "immediate" ? "NOW" : q === "1bar" ? "1B" : q === "2bar" ? "2B" : "4B"}
          </button>
        ))}
      </div>

      {/* Length */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[7px] text-white/25 uppercase font-bold">Len</span>
        <select
          value={pattern.length}
          onChange={(e) => {
            const len = Number(e.target.value);
            useDrumStore.setState((s) => ({ pattern: { ...s.pattern, length: len } }));
          }}
          className="h-5 px-0.5 text-[9px] bg-black/30 border border-white/8 rounded text-white/70 focus:outline-none"
        >
          {[4, 8, 12, 16, 24, 32, 48, 64].map((l) => (
            <option key={`transport-len-${l}`} value={l}>{l}</option>
          ))}
        </select>
      </div>

      <Sep />

      {/* ── Pattern ── */}
      <div className="flex items-center gap-1">
        <button
          onClick={prevPreset}
          aria-label="Previous pattern"
          className="w-5 h-5 rounded text-[9px] text-white/30 hover:text-white/70 hover:bg-white/5 transition-all"
        >
          &lsaquo;
        </button>
        <span className="text-[10px] font-medium text-white/80 min-w-[65px] text-center truncate px-1">{pattern.name}</span>
        <button
          onClick={nextPreset}
          aria-label="Next pattern"
          className="w-5 h-5 rounded text-[9px] text-white/30 hover:text-white/70 hover:bg-white/5 transition-all"
        >
          &rsaquo;
        </button>
        <button
          onClick={clearPattern}
          aria-label="Clear pattern"
          className="text-[7px] text-white/15 hover:text-red-400/60 transition-colors ml-0.5 font-bold tracking-wider"
        >
          CLR
        </button>
        <button
          onClick={newSession}
          aria-label="New empty session"
          className="text-[7px] text-white/15 hover:text-[var(--ed-accent-green)]/60 transition-colors ml-1 font-bold tracking-wider"
        >
          NEW
        </button>
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          className="text-[7px] text-white/15 hover:text-white/55 transition-colors ml-1 font-bold tracking-wider"
        >
          ↺
        </button>
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true }))}
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          className="text-[7px] text-white/15 hover:text-white/55 transition-colors ml-0.5 font-bold tracking-wider"
        >
          ↻
        </button>
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Tools ── */}
      <div className="flex items-center gap-[2px] shrink-0">
        <ToolBtn onClick={onOpenKits} label="KITS" />
        <ToolBtn onClick={onOpenMidi} label="MIDI" />
        <ToolBtn onClick={onOpenEuclidean} label="EUCLID" />
        <ToolBtn onClick={onOpenSong} label="SONG" />
        <ToolBtn onClick={onOpenScenes} label="SCENE" />
        <ToolBtn onClick={onOpenClips} label="CLIPS" />
        <ToolBtn onClick={onOpenArrangement} label="ARR" />
        <ToolBtn onClick={onOpenModMatrix} label="MOD" />
        <ToolBtn onClick={onOpenMacros} label="MACRO" />
        <ToolBtn onClick={onOpenMidiLearn} label="MIDI MAP" />
        <ToolBtn onClick={onOpenMidiClock} label="SYNC" />
        {onOpenPerformance && <ToolBtn onClick={onOpenPerformance} label="LIVE" accent />}
        {onOpenPad && <ToolBtn onClick={onOpenPad} label="XY PAD" accent />}
        <ToolBtn onClick={onOpenFx} label="FX" accent />
        <ToolBtn onClick={onOpenMixer} label="MIXER" accent />

        <Sep />

        <ExportMenu
          onSave={onOpenBrowser}
          onMidiExport={() => downloadMidi(pattern, bpm)}
          onShare={() => sharePattern(pattern, bpm)}
        />

        <Sep />

        <ZoomControl />
        <ThemeToggle />

        <button
          onClick={onToggleHelp}
          aria-label="Help"
          className="w-6 h-6 rounded-md text-[10px] text-white/20 hover:text-white/50 hover:bg-white/5 transition-all"
        >
          ?
        </button>
      </div>
    </header>
  );
}

function ZoomControl() {
  const [zoom, setZoomState] = useState(() => {
    const saved = localStorage.getItem("ed-ui-zoom");
    return saved ? parseFloat(saved) : 1.0;
  });

  const applyZoom = useCallback((z: number) => {
    const clamped = Math.max(0.8, Math.min(1.5, Math.round(z * 20) / 20)); // Step 0.05
    setZoomState(clamped);
    document.documentElement.style.setProperty("--ed-ui-zoom", String(clamped));
    localStorage.setItem("ed-ui-zoom", String(clamped));
  }, []);

  // Apply saved zoom on mount
  useEffect(() => {
    document.documentElement.style.setProperty("--ed-ui-zoom", String(zoom));
  }, []);

  return (
    <div className="flex items-center gap-1 ml-1">
      <button onClick={() => applyZoom(zoom - 0.05)}
        className="w-5 h-5 rounded text-[10px] font-bold bg-white/5 text-white/30 hover:text-white/60 hover:bg-white/10 transition-all">−</button>
      <span className="text-[8px] font-bold text-white/25 min-w-[28px] text-center tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <button onClick={() => applyZoom(zoom + 0.05)}
        className="w-5 h-5 rounded text-[10px] font-bold bg-white/5 text-white/30 hover:text-white/60 hover:bg-white/10 transition-all">+</button>
    </div>
  );
}

function ThemeToggle() {
  type Theme = "dark" | "grey";
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("ed-theme");
    return saved === "grey" ? "grey" : "dark";
  });

  // Apply on mount + whenever theme changes
  useEffect(() => {
    if (theme === "grey") {
      document.documentElement.setAttribute("data-theme", "grey");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem("ed-theme", theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "grey" : "dark"));
  }, []);

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "grey" : "dark"} mode`}
      title={theme === "dark" ? "Dark mode (click for grey)" : "Grey mode (click for dark)"}
      className="w-6 h-6 rounded-md text-[11px] text-white/25 hover:text-white/60 hover:bg-white/5 transition-all flex items-center justify-center"
    >
      {theme === "dark" ? "☾" : "☀"}
    </button>
  );
}

// ─── Sub-components ──────────────────────────────────────

function RecordButton() {
  const [state, setState] = useState<ExportState>("idle");
  const [elapsed, setElapsed] = useState(0);

  const handleClick = useCallback(async () => {
    if (isRecording()) {
      await stopSongRecording({
        onStateChange: setState,
      });
      setElapsed(0);
    } else {
      startSongRecording({
        onStateChange: setState,
        onProgress: (s) => setElapsed(Math.floor(s)),
      });
    }
  }, []);

  const recording = state === "recording";
  const processing = state === "processing";

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <button
      onClick={handleClick}
      disabled={processing}
      aria-label={recording ? `Recording ${formatTime(elapsed)}` : processing ? "Processing" : "Record"}
      className={`w-full text-left px-3 py-1.5 text-[9px] font-bold tracking-wider transition-colors flex items-center gap-2 ${
        recording
          ? "bg-red-500/15 text-red-400"
          : processing
            ? "bg-yellow-500/10 text-yellow-400"
            : "text-white/70 hover:text-white hover:bg-white/8"
      }`}
    >
      {recording && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />}
      {!recording && <span className="text-[7px] text-white/30">⏺</span>}
      {recording ? `REC ${formatTime(elapsed)}` : processing ? "Processing..." : "Record Audio"}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-4 bg-white/6 mx-1" />;
}

function ToolBtn({ onClick, label, accent }: { onClick: () => void; label: string; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={`Open ${label}`}
      className={`h-6 px-2.5 rounded-md text-[8px] font-bold tracking-wider transition-all ed-tool-btn ${
        accent
          ? "bg-[var(--ed-accent-orange)]/8 text-[var(--ed-accent-orange)]/80 hover:bg-[var(--ed-accent-orange)]/15 hover:text-[var(--ed-accent-orange)]"
          : "text-white/30 hover:text-white/70 hover:bg-white/5"
      }`}
    >
      {label}
    </button>
  );
}

function ExportMenu({ onSave, onMidiExport, onShare }: {
  onSave:       () => void;
  onMidiExport: () => void;
  onShare:      () => void;
}) {
  const [open,     setOpen]     = useState(false);
  const [bars,     setBars]     = useState(4);
  const [progress, setProgress] = useState<RecordExportProgress | null>(null);
  const ref    = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 40, right: 4 });

  const mp3ServerUrl = (import.meta.env.VITE_MP3_SERVER_URL as string | undefined)?.replace(/\/$/, "");

  const isExporting = !!progress && progress.state !== "idle" && progress.state !== "done" && progress.state !== "error";
  const isDone      = progress?.state === "done";
  const isError     = progress?.state === "error";

  // Close on outside click — but not while exporting
  useEffect(() => {
    if (!open || isExporting) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open, isExporting]);

  const handleToggle = useCallback(() => {
    if (isExporting) return;
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen((v) => !v);
  }, [open, isExporting]);

  const runExport = useCallback(async (mode: "wav" | "mp3") => {
    if (isExporting) return;
    setProgress({ state: "starting", barsDone: 0, barsTotal: bars, elapsedSec: 0, totalSec: 0 });
    await autoRecordExport({
      bars,
      tail: 0.5,
      mp3ServerUrl: mode === "mp3" ? mp3ServerUrl : undefined,
      onProgress:   setProgress,
    });
    // Auto-clear after 3 s
    setTimeout(() => setProgress(null), 3000);
  }, [bars, isExporting, mp3ServerUrl]);

  // Progress bar fraction 0–1
  const fraction = progress
    ? progress.state === "encoding" || progress.state === "uploading" || progress.state === "done"
      ? 1
      : Math.min(1, progress.barsDone / Math.max(1, progress.barsTotal))
    : 0;

  const stateLabel: Record<RecordExportProgress["state"], string> = {
    idle:      "",
    starting:  "Starting…",
    recording: `Recording bar ${Math.ceil(progress?.barsDone ?? 0)} / ${progress?.barsTotal ?? bars}`,
    encoding:  "Encoding WAV…",
    uploading: "Uploading to MP3 server…",
    done:      "✓ Done",
    error:     progress?.errorMsg ?? "Error",
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        onClick={handleToggle}
        className={`h-6 px-2.5 rounded-md text-[8px] font-bold tracking-wider transition-all flex items-center gap-1 ${
          open || isExporting
            ? "bg-[var(--ed-accent-orange)]/15 text-[var(--ed-accent-orange)]"
            : "text-white/30 hover:text-white/70 hover:bg-white/5"
        }`}
      >
        {isExporting ? "● REC" : "EXPORT ▾"}
      </button>

      {open && (
        <div
          className="fixed z-[9999] min-w-[172px] bg-[#1a1a22] border border-[var(--ed-border)] rounded-lg shadow-2xl py-1 overflow-hidden"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          {/* ── Save / Share ───────────────────────────────── */}
          <button
            onClick={() => { onSave(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-[9px] text-white/70 hover:text-white hover:bg-white/8 transition-colors flex items-center gap-2"
          >
            <span className="text-[7px] text-white/30">💾</span> Save / Load
          </button>
          <button
            onClick={() => { onMidiExport(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-[9px] text-white/70 hover:text-white hover:bg-white/8 transition-colors flex items-center gap-2"
          >
            <span className="text-[7px] text-white/30">🎹</span> Export MIDI
          </button>

          <div className="border-t border-white/8 my-1" />

          {/* ── Bar count selector ─────────────────────────── */}
          <div className="px-3 py-1 flex items-center gap-1.5">
            <span className="text-[7px] font-bold tracking-[0.1em] text-white/25">BARS</span>
            {[1, 2, 4, 8].map((b) => (
              <button
                key={b}
                disabled={isExporting}
                onClick={() => setBars(b)}
                className="w-6 h-5 rounded text-[8px] font-bold transition-all"
                style={{
                  background: bars === b ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.04)",
                  color:      bars === b ? "rgb(245,158,11)"       : "rgba(255,255,255,0.35)",
                  border:     `1px solid ${bars === b ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.06)"}`,
                }}
              >
                {b}
              </button>
            ))}
          </div>

          {/* ── Progress / status bar ─────────────────────── */}
          {progress && (
            <div className="px-3 py-1.5">
              <div
                className="h-0.5 rounded-full mb-1 overflow-hidden"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width:      `${fraction * 100}%`,
                    background: isDone ? "#34d399" : isError ? "#f87171" : "rgb(245,158,11)",
                  }}
                />
              </div>
              <span
                className="text-[7px] font-bold tabular-nums"
                style={{ color: isDone ? "#34d399" : isError ? "#f87171" : "rgba(255,255,255,0.55)" }}
              >
                {stateLabel[progress.state]}
              </span>
            </div>
          )}

          {/* ── WAV export ─────────────────────────────────── */}
          <button
            disabled={isExporting}
            onClick={() => void runExport("wav")}
            className="w-full text-left px-3 py-1.5 text-[9px] text-white/70 hover:text-white hover:bg-white/8 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-wait"
          >
            <span className="text-[7px] text-white/30">🔊</span>
            Export WAV ({bars} bar{bars > 1 ? "s" : ""})
          </button>

          {/* ── MP3 export ─────────────────────────────────── */}
          <button
            disabled={isExporting}
            onClick={() => {
              if (!mp3ServerUrl) {
                alert(
                  "MP3 export server not configured.\n" +
                  "Set VITE_MP3_SERVER_URL in your .env file.\n\n" +
                  "Deploy export-server/ to Railway to get the URL."
                );
                return;
              }
              void runExport("mp3");
            }}
            className={`w-full text-left px-3 py-1.5 text-[9px] hover:bg-white/8 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-wait ${
              mp3ServerUrl ? "text-white/70 hover:text-white" : "text-white/30"
            }`}
          >
            <span className="text-[7px] text-white/30">🎵</span>
            Export MP3{!mp3ServerUrl ? " (server needed)" : ` (${bars} bar${bars > 1 ? "s" : ""})`}
          </button>

          {/* ── Cancel (during export) ───────────────────── */}
          {isExporting && (
            <button
              onClick={() => cancelAutoRecord()}
              className="w-full text-left px-3 py-1.5 text-[9px] text-red-400/70 hover:text-red-400 hover:bg-white/5 transition-colors flex items-center gap-2"
            >
              <span className="text-[7px]">✕</span> Cancel
            </button>
          )}

          <div className="border-t border-white/8 my-1" />
          <RecordButton />
          <div className="border-t border-white/8 my-1" />
          <button
            onClick={() => { onShare(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-[9px] text-white/70 hover:text-white hover:bg-white/8 transition-colors flex items-center gap-2"
          >
            <span className="text-[7px] text-white/30">🔗</span> Share URL
          </button>
        </div>
      )}
    </div>
  );
}

function FillButton() {
  const [active, setActive] = useState(false);
  return (
    <button
      onClick={() => { const next = !active; setActive(next); setFillMode(next); }}
      aria-label={active ? "Fill mode ON (click to disable)" : "Fill mode OFF (click to enable)"}
      className={`h-6 px-2 rounded-md text-[7px] font-bold tracking-wider transition-all ${
        active
          ? "bg-yellow-400/20 text-yellow-300 shadow-[0_0_10px_rgba(250,204,21,0.15)]"
          : "text-white/20 hover:text-white/40 hover:bg-white/5"
      }`}
    >
      FILL
    </button>
  );
}
