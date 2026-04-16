import { useState, useRef, useCallback, useEffect } from "react";
import { useDrumStore, setFillMode } from "../store/drumStore";
import { downloadMidi } from "../utils/midiExport";
import { sharePattern } from "../utils/patternShare";
import { exportPatternAsWav } from "../utils/audioExport";
import { startSongRecording, stopSongRecording, isRecording, type ExportState } from "../utils/songExport";

interface TransportProps {
  onOpenBrowser: () => void;
  onOpenEuclidean: () => void;
  onOpenSong: () => void;
  onOpenScenes: () => void;
  onOpenFx: () => void;
  onOpenMixer: () => void;
  onOpenKits: () => void;
  onToggleHelp: () => void;
  onOpenMidi: () => void;
  onOpenPerformance?: () => void;
}

export function Transport({
  onOpenBrowser, onOpenEuclidean, onOpenSong, onOpenScenes, onOpenFx, onOpenMixer, onOpenKits, onOpenMidi, onToggleHelp, onOpenPerformance,
}: TransportProps) {
  const {
    bpm, isPlaying, swing, pattern,
    setBpm, setSwing, togglePlay,
    nextPreset, prevPreset, clearPattern, newSession,
  } = useDrumStore();

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
          className="w-10 h-[3px] accent-white/40" />
        <span className="text-[9px] font-mono text-white/35 w-4 tabular-nums">{swing}</span>
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
        {onOpenPerformance && <ToolBtn onClick={onOpenPerformance} label="LIVE" accent />}
        <ToolBtn onClick={onOpenFx} label="FX" accent />
        <ToolBtn onClick={onOpenMixer} label="MIXER" accent />

        <Sep />

        <ExportMenu
          onSave={onOpenBrowser}
          onMidiExport={() => downloadMidi(pattern, bpm)}
          onWavExport={() => exportPatternAsWav(pattern, bpm, 4)}
          onShare={() => sharePattern(pattern, bpm)}
        />

        <Sep />

        <ZoomControl />

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
      className={`h-6 px-2.5 rounded-md text-[8px] font-bold tracking-wider transition-all flex items-center gap-1 ${
        recording
          ? "bg-red-500/20 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.2)] border border-red-500/30"
          : processing
            ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20"
            : "text-white/30 hover:text-white/70 hover:bg-white/5"
      }`}
    >
      {recording && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
      {recording ? formatTime(elapsed) : processing ? "..." : "REC"}
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

function ExportMenu({ onSave, onMidiExport, onWavExport, onShare }: {
  onSave: () => void;
  onMidiExport: () => void;
  onWavExport: () => void;
  onShare: () => void;
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`h-6 px-2.5 rounded-md text-[8px] font-bold tracking-wider transition-all flex items-center gap-1 ${
          open
            ? "bg-[var(--ed-accent-orange)]/15 text-[var(--ed-accent-orange)]"
            : "text-white/30 hover:text-white/70 hover:bg-white/5"
        }`}
      >
        EXPORT ▾
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[140px] bg-[#1a1a22] border border-[var(--ed-border)] rounded-lg shadow-2xl py-1 overflow-hidden">
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
          <button
            onClick={() => { onWavExport(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-[9px] text-white/70 hover:text-white hover:bg-white/8 transition-colors flex items-center gap-2"
          >
            <span className="text-[7px] text-white/30">🔊</span> Export WAV
          </button>
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
      onMouseDown={() => { setActive(true); setFillMode(true); }}
      onMouseUp={() => { setActive(false); setFillMode(false); }}
      onMouseLeave={() => { setActive(false); setFillMode(false); }}
      aria-label="Fill mode (hold)"
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
