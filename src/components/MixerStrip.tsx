const CHANNELS = [
  "KCK", "SNR", "CLP", "TL", "TM", "TH",
  "HHC", "HHO", "CYM", "RDE", "P1", "P2",
];

export function MixerStrip() {
  return (
    <div className="flex flex-col h-full p-3">
      <h3 className="text-xs font-semibold text-[var(--ed-text-secondary)] mb-3">
        MIXER
      </h3>

      <div className="flex-1 flex gap-1 overflow-x-auto">
        {CHANNELS.map((ch, i) => (
          <div key={i} className="flex flex-col items-center gap-1 min-w-[28px]">
            {/* Meter placeholder */}
            <div className="flex-1 w-3 rounded-full bg-[var(--ed-bg-surface)] relative overflow-hidden">
              <div
                className="absolute bottom-0 w-full rounded-full bg-[var(--ed-accent-green)]"
                style={{ height: `${60 + Math.random() * 30}%` }}
              />
            </div>

            {/* Fader */}
            <input
              type="range"
              min={0}
              max={127}
              defaultValue={100}
              orient="vertical"
              className="h-20 accent-[var(--ed-text-primary)]"
              style={{ writingMode: "vertical-lr", direction: "rtl" }}
            />

            {/* Label */}
            <span className="text-[8px] font-medium text-[var(--ed-text-muted)]">
              {ch}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
