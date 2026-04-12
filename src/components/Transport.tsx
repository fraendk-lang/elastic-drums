import { useDrumStore } from "../store/drumStore";

interface TransportProps {
  onOpenBrowser: () => void;
  onOpenEuclidean: () => void;
  onToggleHelp: () => void;
}

export function Transport({ onOpenBrowser, onOpenEuclidean, onToggleHelp }: TransportProps) {
  const {
    bpm, isPlaying, swing, pattern,
    setBpm, setSwing, togglePlay,
    nextPreset, prevPreset, clearPattern,
  } = useDrumStore();

  return (
    <header className="flex items-center justify-between h-12 px-4 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-bold tracking-wider text-[var(--ed-accent-orange)]">
          ELASTIC DRUMS
        </h1>
      </div>

      {/* Transport Controls */}
      <div className="flex items-center gap-3">
        {/* Play/Stop */}
        <button
          onClick={togglePlay}
          className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold transition-all ${
            isPlaying
              ? "bg-[var(--ed-accent-red)] text-white shadow-lg shadow-red-500/20"
              : "bg-[var(--ed-bg-elevated)] text-[var(--ed-text-primary)] hover:bg-[var(--ed-accent-green)] hover:shadow-lg hover:shadow-green-500/20"
          }`}
        >
          {isPlaying ? "■" : "▶"}
        </button>

        {/* BPM */}
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-[var(--ed-text-muted)] uppercase">Bpm</label>
          <input
            type="number"
            min={30}
            max={300}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="w-14 h-7 px-1.5 text-center text-sm font-mono bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded text-[var(--ed-text-primary)] focus:border-[var(--ed-accent-orange)] focus:outline-none"
          />
        </div>

        {/* Swing */}
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-[var(--ed-text-muted)] uppercase">Swing</label>
          <input
            type="range"
            min={50}
            max={75}
            value={swing}
            onChange={(e) => setSwing(Number(e.target.value))}
            className="w-16 h-1 accent-[var(--ed-accent-orange)]"
          />
          <span className="text-[10px] font-mono text-[var(--ed-text-secondary)] w-6">
            {swing}%
          </span>
        </div>
      </div>

      {/* Pattern / Preset */}
      <div className="flex items-center gap-2">
        <button
          onClick={prevPreset}
          className="w-6 h-6 rounded text-xs bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)] transition-colors"
        >
          ◀
        </button>
        <span className="text-xs font-medium text-[var(--ed-text-primary)] min-w-[80px] text-center">
          {pattern.name}
        </span>
        <button
          onClick={nextPreset}
          className="w-6 h-6 rounded text-xs bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)] transition-colors"
        >
          ▶
        </button>
        <button
          onClick={clearPattern}
          className="ml-1 px-2 h-6 rounded text-[10px] bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-accent-red)] hover:bg-[var(--ed-bg-elevated)] transition-colors"
        >
          CLR
        </button>

        {/* Euclidean */}
        <button
          onClick={onOpenEuclidean}
          className="ml-2 px-2 h-6 rounded text-[10px] font-bold bg-[var(--ed-pad-hybrid)] text-white hover:brightness-110 transition-all"
        >
          EUCLID
        </button>

        {/* Save/Load */}
        <button
          onClick={onOpenBrowser}
          className="px-2 h-6 rounded text-[10px] font-bold bg-[var(--ed-accent-blue)] text-white hover:brightness-110 transition-all"
        >
          SAVE/LOAD
        </button>

        {/* Help toggle */}
        <button
          onClick={onToggleHelp}
          className="px-2 h-6 rounded text-[10px] bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)] transition-colors"
        >
          ?
        </button>
      </div>
    </header>
  );
}
