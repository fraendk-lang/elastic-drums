import { useState, useRef, useCallback } from "react";
import { useDrumStore, setFillMode } from "../store/drumStore";
import { downloadMidi } from "../utils/midiExport";
import { sharePattern } from "../utils/patternShare";
import { exportPatternAsWav } from "../utils/audioExport";

interface TransportProps {
  onOpenBrowser: () => void;
  onOpenEuclidean: () => void;
  onOpenSong: () => void;
  onOpenMixer: () => void;
  onOpenKits: () => void;
  onToggleHelp: () => void;
}

export function Transport({
  onOpenBrowser, onOpenEuclidean, onOpenSong, onOpenMixer, onOpenKits, onToggleHelp,
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
    <header className="flex items-center h-10 px-3 border-b border-[var(--ed-border)] bg-[#0e0e12] gap-1.5">

      {/* ── Brand ── */}
      <span className="text-[10px] font-black tracking-[0.25em] text-[var(--ed-accent-orange)] mr-1 hidden lg:block">
        ELASTIC DRUMS
      </span>
      <span className="text-[10px] font-black tracking-[0.25em] text-[var(--ed-accent-orange)] mr-1 lg:hidden">ED</span>

      <Sep />

      {/* ── Transport ── */}
      <button
        onClick={togglePlay}
        className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold transition-all ${
          isPlaying
            ? "bg-white/10 text-red-400 border border-red-400/30"
            : "bg-white/5 text-white/70 border border-white/10 hover:bg-white/10 hover:text-white"
        }`}
      >
        {isPlaying ? "■" : "▶"}
      </button>

      <FillButton />

      {/* BPM */}
      <input
        type="number" min={30} max={300} value={bpm}
        onChange={(e) => setBpm(Number(e.target.value))}
        className="w-11 h-6 px-1 text-center text-[11px] font-mono bg-black/40 border border-white/8 rounded text-white/90 focus:border-[var(--ed-accent-orange)]/50 focus:outline-none"
      />
      <button
        onClick={handleTap}
        className="h-5 px-1.5 text-[7px] font-bold tracking-wider text-white/30 hover:text-white/60 transition-colors"
      >
        TAP
      </button>

      {/* Swing */}
      <div className="flex items-center gap-0.5">
        <span className="text-[7px] text-white/25 uppercase">Swg</span>
        <input type="range" min={50} max={75} value={swing}
          onChange={(e) => setSwing(Number(e.target.value))}
          className="w-10 h-[3px] accent-white/40" />
        <span className="text-[8px] font-mono text-white/30 w-4">{swing}</span>
      </div>

      {/* Length */}
      <div className="flex items-center gap-0.5">
        <span className="text-[7px] text-white/25 uppercase">Len</span>
        <select
          value={pattern.length}
          onChange={(e) => {
            const len = Number(e.target.value);
            useDrumStore.setState((s) => ({ pattern: { ...s.pattern, length: len } }));
          }}
          className="h-5 px-0.5 text-[9px] bg-black/40 border border-white/8 rounded text-white/70 focus:outline-none"
        >
          {[4, 8, 12, 16, 24, 32, 48, 64].map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      <Sep />

      {/* ── Pattern ── */}
      <button onClick={prevPreset} className="w-4 h-4 text-[8px] text-white/30 hover:text-white/70 transition-colors">◀</button>
      <span className="text-[10px] font-medium text-white/80 min-w-[60px] text-center truncate">{pattern.name}</span>
      <button onClick={nextPreset} className="w-4 h-4 text-[8px] text-white/30 hover:text-white/70 transition-colors">▶</button>
      <button onClick={clearPattern} className="text-[7px] text-white/20 hover:text-red-400/60 transition-colors ml-0.5">CLR</button>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Tools (monochrome, subtle) ── */}
      <div className="flex items-center gap-[3px]">
        <ToolBtn onClick={onOpenKits} label="KITS" />
        <ToolBtn onClick={onOpenEuclidean} label="EUCLID" />
        <ToolBtn onClick={onOpenSong} label="SONG" />
        <ToolBtn onClick={onOpenMixer} label="MIXER" accent />

        <Sep />

        <ToolBtn onClick={onOpenBrowser} label="SAVE" />
        <ToolBtn onClick={() => downloadMidi(pattern, bpm)} label="MIDI" />
        <ToolBtn onClick={() => exportPatternAsWav(pattern, bpm, 4)} label="WAV" />
        <ToolBtn onClick={() => { sharePattern(pattern, bpm); }} label="SHARE" />

        <Sep />

        <button onClick={onToggleHelp}
          className="w-5 h-5 rounded text-[9px] text-white/20 hover:text-white/50 transition-colors">?</button>
      </div>
    </header>
  );
}

// ─── Sub-components ──────────────────────────────────────

function Sep() {
  return <div className="w-px h-4 bg-white/8 mx-0.5" />;
}

function ToolBtn({ onClick, label, accent }: { onClick: () => void; label: string; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`h-5 px-2 rounded text-[8px] font-bold tracking-wider transition-all ${
        accent
          ? "bg-white/8 text-[var(--ed-accent-orange)]/80 hover:bg-white/12 hover:text-[var(--ed-accent-orange)]"
          : "text-white/35 hover:text-white/70 hover:bg-white/5"
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
      className={`h-5 px-1.5 rounded text-[7px] font-bold tracking-wider transition-all ${
        active
          ? "bg-yellow-400/20 text-yellow-300"
          : "text-white/20 hover:text-white/40"
      }`}
    >
      FILL
    </button>
  );
}
