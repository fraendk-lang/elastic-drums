import { useDrumStore } from "../store/drumStore";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM L",
  "TOM M", "TOM H", "HH CL", "HH OP",
  "CYM", "RIDE", "PRC1", "PRC2",
];

export function StepSequencer() {
  const { pattern, currentStep, isPlaying, selectedPage, setSelectedPage, toggleStep } =
    useDrumStore();

  const pageOffset = selectedPage * 16;

  return (
    <div className="flex flex-col h-full p-3">
      {/* Page Selector */}
      <div className="flex items-center gap-2 mb-3">
        {[0, 1, 2, 3].map((page) => (
          <button
            key={page}
            onClick={() => setSelectedPage(page)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              selectedPage === page
                ? "bg-[var(--ed-accent-orange)] text-black"
                : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-secondary)] hover:text-[var(--ed-text-primary)]"
            }`}
          >
            {page * 16 + 1}–{(page + 1) * 16}
          </button>
        ))}
      </div>

      {/* Step Grid */}
      <div className="flex-1 overflow-auto">
        <div className="grid gap-1" style={{ gridTemplateColumns: "56px repeat(16, 1fr)" }}>
          {/* Header row – step numbers */}
          <div />
          {Array.from({ length: 16 }, (_, i) => (
            <div
              key={i}
              className={`text-center text-[10px] font-mono pb-1 ${
                isPlaying && currentStep === pageOffset + i
                  ? "text-[var(--ed-accent-orange)]"
                  : "text-[var(--ed-text-muted)]"
              }`}
            >
              {pageOffset + i + 1}
            </div>
          ))}

          {/* Track rows */}
          {VOICE_LABELS.map((label, track) => (
            <>
              {/* Track label */}
              <div
                key={`label-${track}`}
                className="flex items-center text-[10px] font-medium text-[var(--ed-text-secondary)] pr-2"
              >
                {label}
              </div>

              {/* Steps */}
              {Array.from({ length: 16 }, (_, stepIdx) => {
                const absoluteStep = pageOffset + stepIdx;
                const step = pattern.tracks[track]?.steps[absoluteStep];
                const isActive = step?.active ?? false;
                const isCurrent = isPlaying && currentStep === absoluteStep;

                return (
                  <button
                    key={`${track}-${stepIdx}`}
                    onClick={() => toggleStep(track, absoluteStep)}
                    className={`h-6 rounded-sm transition-all ${
                      isCurrent
                        ? "ring-1 ring-[var(--ed-accent-orange)]"
                        : ""
                    } ${
                      isActive
                        ? "bg-[var(--ed-accent-orange)] hover:bg-[var(--ed-accent-amber)]"
                        : stepIdx % 4 === 0
                          ? "bg-[var(--ed-bg-elevated)] hover:bg-[var(--ed-bg-surface)]"
                          : "bg-[var(--ed-bg-surface)] hover:bg-[var(--ed-bg-elevated)]"
                    }`}
                  />
                );
              })}
            </>
          ))}
        </div>
      </div>
    </div>
  );
}
