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
    // Keep last 6 taps
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
    // Reset after 2s pause
    setTimeout(() => {
      if (tapTimes.current.length > 0 && performance.now() - tapTimes.current[tapTimes.current.length - 1]! > 2000) {
        tapTimes.current = [];
      }
    }, 2100);
  }, [setBpm]);

  return (
    <header className="flex items-center h-11 px-3 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)] gap-2">
      {/* Logo */}
      <span className="text-[11px] font-black tracking-[0.2em] text-[var(--ed-accent-orange)] mr-2 hidden lg:block">
        ELASTIC DRUMS
      </span>
      <span className="text-[11px] font-black tracking-[0.2em] text-[var(--ed-accent-orange)] mr-2 lg:hidden">
        ED
      </span>

      {/* Divider */}
      <div className="w-px h-5 bg-[var(--ed-border)]" />

      {/* ── Transport Group ── */}
      <button
        onClick={togglePlay}
        className={`w-8 h-8 rounded-md flex items-center justify-center text-sm font-bold transition-all shrink-0 ${
          isPlaying
            ? "bg-[var(--ed-accent-red)] text-white shadow-lg shadow-red-500/20"
            : "bg-[var(--ed-bg-elevated)] text-[var(--ed-text-primary)] hover:bg-[var(--ed-accent-green)] hover:shadow-lg hover:shadow-green-500/20"
        }`}
      >
        {isPlaying ? "■" : "▶"}
      </button>

      {/* Fill button (hold for fill mode) */}
      <FillButton />

      {/* BPM */}
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={30}
          max={300}
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
          className="w-12 h-7 px-1 text-center text-[12px] font-mono bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded text-[var(--ed-text-primary)] focus:border-[var(--ed-accent-orange)] focus:outline-none"
        />
        <span className="text-[8px] text-[var(--ed-text-muted)] uppercase">bpm</span>
      </div>

      {/* Swing */}
      <div className="flex items-center gap-1">
        <span className="text-[8px] text-[var(--ed-text-muted)] uppercase">Swg</span>
        <input
          type="range" min={50} max={75} value={swing}
          onChange={(e) => setSwing(Number(e.target.value))}
          className="w-12 h-1 accent-[var(--ed-accent-orange)]"
        />
        <span className="text-[9px] font-mono text-[var(--ed-text-secondary)] w-5">{swing}</span>
      </div>

      {/* Tap Tempo */}
      <button
        onClick={handleTap}
        className="px-1.5 h-6 rounded text-[8px] font-bold bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)] transition-colors"
      >
        TAP
      </button>

      {/* Pattern Length */}
      <div className="flex items-center gap-1">
        <span className="text-[8px] text-[var(--ed-text-muted)] uppercase">Len</span>
        <select
          value={pattern.length}
          onChange={(e) => {
            const len = Number(e.target.value);
            useDrumStore.setState((s) => ({
              pattern: { ...s.pattern, length: len },
            }));
          }}
          className="h-6 px-1 text-[10px] bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded text-[var(--ed-text-primary)] focus:outline-none"
        >
          {[4, 8, 12, 16, 24, 32, 48, 64].map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      <div className="w-px h-5 bg-[var(--ed-border)]" />

      {/* ── Pattern Group ── */}
      <div className="flex items-center gap-1">
        <button onClick={prevPreset} className="w-5 h-5 rounded text-[10px] bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] transition-colors">◀</button>
        <span className="text-[11px] font-medium text-[var(--ed-text-primary)] min-w-[70px] text-center truncate">
          {pattern.name}
        </span>
        <button onClick={nextPreset} className="w-5 h-5 rounded text-[10px] bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] transition-colors">▶</button>
        <button
          onClick={clearPattern}
          className="px-1.5 h-5 rounded text-[8px] text-[var(--ed-text-muted)] hover:text-[var(--ed-accent-red)] transition-colors"
        >
          CLR
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* ── Tools Group ── */}
      <div className="flex items-center gap-1">
        <ToolButton onClick={onOpenKits} color="#d97706" label="KITS" />
        <ToolButton onClick={onOpenEuclidean} color="var(--ed-pad-hybrid)" label="EUCLID" />
        <ToolButton onClick={onOpenSong} color="var(--ed-accent-green)" label="SONG" />
        <ToolButton onClick={onOpenMixer} color="var(--ed-accent-orange)" label="MIXER" />
        <ToolButton onClick={onOpenBrowser} color="var(--ed-accent-blue)" label="SAVE" />
        <ToolButton onClick={() => downloadMidi(pattern, bpm)} color="#6366f1" label="MIDI" />
        <ToolButton onClick={() => exportPatternAsWav(pattern, bpm, 4)} color="#10b981" label="WAV" />
        <ToolButton onClick={() => { sharePattern(pattern, bpm); alert("Pattern URL copied!"); }} color="#06b6d4" label="SHARE" />

        <div className="w-px h-5 bg-[var(--ed-border)] mx-0.5" />

        <button
          onClick={onToggleHelp}
          className="w-5 h-5 rounded text-[10px] bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)] transition-colors"
        >
          ?
        </button>
      </div>
    </header>
  );
}

function ToolButton({ onClick, color, label }: { onClick: () => void; color: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className="px-2 h-6 rounded text-[9px] font-bold text-white hover:brightness-125 transition-all"
      style={{ backgroundColor: color }}
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
      className={`px-2 h-6 rounded text-[9px] font-bold transition-all ${
        active
          ? "bg-yellow-400 text-black"
          : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)]"
      }`}
    >
      FILL
    </button>
  );
}
