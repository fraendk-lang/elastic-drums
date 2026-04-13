import { useState, useRef, useCallback } from "react";
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
}

export function Transport({
  onOpenBrowser, onOpenEuclidean, onOpenSong, onOpenScenes, onOpenFx, onOpenMixer, onOpenKits, onToggleHelp,
}: TransportProps) {
  const {
    bpm, isPlaying, swing, pattern,
    setBpm, setSwing, togglePlay,
    nextPreset, prevPreset, clearPattern,
  } = useDrumStore();

  // Tap Tempo
  const tapTimes = useRef<number[]>([]);
  const handleTap = useCallback(() => {
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
      if (tappedBpm >= 30 && tappedBpm <= 300) setBpm(tappedBpm);
    }
    setTimeout(() => {
      if (tapTimes.current.length > 0 && performance.now() - tapTimes.current[tapTimes.current.length - 1]! > 2000) {
        tapTimes.current = [];
      }
    }, 2100);
  }, [setBpm]);

  return (
    <header className="flex items-center h-11 px-3 border-b border-[var(--ed-border)]/70 bg-gradient-to-b from-[#111116] to-[#0d0d11] gap-1.5 relative z-20">

      {/* ── Brand ── */}
      <span className="text-[10px] font-black tracking-[0.25em] text-[var(--ed-accent-orange)] mr-1.5 hidden lg:block">
        ELASTIC DRUMS
      </span>
      <span className="text-[10px] font-black tracking-[0.25em] text-[var(--ed-accent-orange)] mr-1 lg:hidden">ED</span>

      <Sep />

      {/* ── Transport ── */}
      <button
        onClick={togglePlay}
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
      <div className="flex items-center bg-black/30 rounded-md border border-white/6 px-0.5">
        <input
          type="number" min={30} max={300} value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
          className="w-11 h-7 px-1 text-center text-[12px] font-mono bg-transparent text-[var(--ed-accent-orange)] focus:outline-none font-bold tabular-nums"
        />
        <button
          onClick={handleTap}
          className="h-5 px-1.5 text-[7px] font-bold tracking-wider text-white/25 hover:text-white/60 transition-colors border-l border-white/6"
        >
          TAP
        </button>
      </div>

      {/* Swing */}
      <div className="flex items-center gap-1 ml-0.5">
        <span className="text-[7px] text-white/25 uppercase font-bold">Swg</span>
        <input type="range" min={50} max={75} value={swing}
          onChange={(e) => setSwing(Number(e.target.value))}
          className="w-10 h-[3px] accent-white/40" />
        <span className="text-[9px] font-mono text-white/35 w-4 tabular-nums">{swing}</span>
      </div>

      {/* Length */}
      <div className="flex items-center gap-1">
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
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      <Sep />

      {/* ── Pattern ── */}
      <div className="flex items-center gap-1">
        <button onClick={prevPreset} className="w-5 h-5 rounded text-[9px] text-white/30 hover:text-white/70 hover:bg-white/5 transition-all">&lsaquo;</button>
        <span className="text-[10px] font-medium text-white/80 min-w-[65px] text-center truncate px-1">{pattern.name}</span>
        <button onClick={nextPreset} className="w-5 h-5 rounded text-[9px] text-white/30 hover:text-white/70 hover:bg-white/5 transition-all">&rsaquo;</button>
        <button onClick={clearPattern} className="text-[7px] text-white/15 hover:text-red-400/60 transition-colors ml-0.5 font-bold tracking-wider">CLR</button>
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Tools ── */}
      <div className="flex items-center gap-[2px]">
        <ToolBtn onClick={onOpenKits} label="KITS" />
        <ToolBtn onClick={onOpenEuclidean} label="EUCLID" />
        <ToolBtn onClick={onOpenSong} label="SONG" />
        <ToolBtn onClick={onOpenScenes} label="SCENE" />
        <ToolBtn onClick={onOpenFx} label="FX" accent />
        <ToolBtn onClick={onOpenMixer} label="MIXER" accent />

        <Sep />

        <ToolBtn onClick={onOpenBrowser} label="SAVE" />
        <ToolBtn onClick={() => downloadMidi(pattern, bpm)} label="MIDI" />
        <ToolBtn onClick={() => exportPatternAsWav(pattern, bpm, 4)} label="WAV" />
        <RecordButton />
        <ToolBtn onClick={() => { sharePattern(pattern, bpm); }} label="SHARE" />

        <Sep />

        <button onClick={onToggleHelp}
          className="w-6 h-6 rounded-md text-[10px] text-white/20 hover:text-white/50 hover:bg-white/5 transition-all">?</button>
      </div>
    </header>
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

function FillButton() {
  const [active, setActive] = useState(false);
  return (
    <button
      onMouseDown={() => { setActive(true); setFillMode(true); }}
      onMouseUp={() => { setActive(false); setFillMode(false); }}
      onMouseLeave={() => { setActive(false); setFillMode(false); }}
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
