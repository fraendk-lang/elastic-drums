import { useDrumStore } from "../store/drumStore";

export function Transport() {
  const { bpm, isPlaying, setBpm, togglePlay } = useDrumStore();

  return (
    <header className="flex items-center justify-between h-12 px-4 border-b border-[var(--ed-border)] bg-[var(--ed-bg-secondary)]">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-bold tracking-wider text-[var(--ed-accent-orange)]">
          ELASTIC DRUMS
        </h1>
      </div>

      {/* Transport Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={togglePlay}
          className={`w-8 h-8 rounded flex items-center justify-center text-sm font-bold transition-colors ${
            isPlaying
              ? "bg-[var(--ed-accent-red)] text-white"
              : "bg-[var(--ed-bg-elevated)] text-[var(--ed-text-primary)] hover:bg-[var(--ed-accent-green)]"
          }`}
        >
          {isPlaying ? "■" : "▶"}
        </button>

        {/* BPM */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--ed-text-secondary)]">BPM</label>
          <input
            type="number"
            min={30}
            max={300}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="w-16 h-7 px-2 text-center text-sm font-mono bg-[var(--ed-bg-primary)] border border-[var(--ed-border)] rounded text-[var(--ed-text-primary)] focus:border-[var(--ed-accent-orange)] focus:outline-none"
          />
        </div>
      </div>

      {/* Pattern / Kit Info */}
      <div className="flex items-center gap-4 text-xs text-[var(--ed-text-secondary)]">
        <span>Pattern A01</span>
        <span>Kit: 808 Classic</span>
      </div>
    </header>
  );
}
