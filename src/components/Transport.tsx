import { useState } from "react";
import { useDrumStore, setFillMode } from "../store/drumStore";

interface TransportProps {
  onOpenBrowser: () => void;
  onOpenEuclidean: () => void;
  onOpenSong: () => void;
  onOpenMixer: () => void;
  onToggleHelp: () => void;
}

export function Transport({
  onOpenBrowser, onOpenEuclidean, onOpenSong, onOpenMixer, onToggleHelp,
}: TransportProps) {
  const {
    bpm, isPlaying, swing, pattern,
    setBpm, setSwing, togglePlay,
    nextPreset, prevPreset, clearPattern,
  } = useDrumStore();

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
        <ToolButton onClick={onOpenEuclidean} color="var(--ed-pad-hybrid)" label="EUCLID" />
        <ToolButton onClick={onOpenSong} color="var(--ed-accent-green)" label="SONG" />
        <ToolButton onClick={onOpenMixer} color="var(--ed-accent-orange)" label="MIXER" />
        <ToolButton onClick={onOpenBrowser} color="var(--ed-accent-blue)" label="SAVE" />

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
