import React, { useCallback } from "react";
import { useDrumStore } from "../store/drumStore";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM L",
  "TOM M", "TOM H", "HH CL", "HH OP",
  "CYM", "RIDE", "PRC1", "PRC2",
];

const VOICE_COLORS = [
  "var(--ed-accent-orange)", "var(--ed-accent-orange)", "var(--ed-accent-orange)",
  "var(--ed-accent-orange)", "var(--ed-accent-orange)", "var(--ed-accent-orange)",
  "var(--ed-accent-blue)", "var(--ed-accent-blue)",
  "var(--ed-accent-blue)", "var(--ed-accent-blue)",
  "var(--ed-pad-hybrid)", "var(--ed-pad-hybrid)",
];

export function StepSequencer() {
  const {
    pattern, currentStep, isPlaying, selectedPage, heldStep,
    setSelectedPage, toggleStep, setStepVelocity, setStepRatchet,
    holdStep, releaseStep, setSelectedVoice,
  } = useDrumStore();

  const pageOffset = selectedPage * 16;

  // Right-click: velocity cycle, Shift+right-click: ratchet cycle
  const handleContextMenu = useCallback((e: React.MouseEvent, track: number, absStep: number) => {
    e.preventDefault();
    const step = pattern.tracks[track]?.steps[absStep];
    if (!step?.active) return;

    if (e.shiftKey) {
      // Cycle ratchet: 1→2→3→4→6→8→1
      const ratchetLevels = [1, 2, 3, 4, 6, 8];
      const current = step.ratchetCount ?? 1;
      const idx = ratchetLevels.indexOf(current);
      const next = ratchetLevels[(idx + 1) % ratchetLevels.length]!;
      setStepRatchet(track, absStep, next);
    } else {
      // Cycle velocity
      const levels = [127, 100, 70, 40];
      const current = step.velocity;
      const idx = levels.findIndex((v) => v <= current);
      const next = levels[(idx + 1) % levels.length]!;
      setStepVelocity(track, absStep, next);
    }
  }, [pattern, setStepVelocity, setStepRatchet]);

  // Hold step for P-Lock editing
  const handleStepMouseDown = useCallback((e: React.MouseEvent, track: number, absStep: number) => {
    const step = pattern.tracks[track]?.steps[absStep];
    if (!step?.active) return;
    // Only hold on left-click (not right-click context menu)
    if (e.button !== 0) return;
    holdStep(track, absStep);
    setSelectedVoice(track);
  }, [pattern, holdStep, setSelectedVoice]);

  const handleStepMouseUp = useCallback(() => {
    releaseStep();
  }, [releaseStep]);

  return (
    <div className="flex flex-col h-full p-3" onMouseUp={handleStepMouseUp}>
      {/* Page Selector + Help */}
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
        <span className="ml-auto text-[10px] text-[var(--ed-text-muted)]">
          {heldStep
            ? `P-LOCK: ${VOICE_LABELS[heldStep.track]} Step ${heldStep.step + 1} — move sliders`
            : "hold=P-Lock · right-click=velocity · shift+right=ratchet"
          }
        </span>
      </div>

      {/* Step Grid */}
      <div className="flex-1 overflow-auto">
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: "52px repeat(16, 1fr)" }}>
          {/* Header row – step numbers */}
          <div />
          {Array.from({ length: 16 }, (_, i) => (
            <div
              key={i}
              className={`text-center text-[10px] font-mono pb-1 ${
                isPlaying && currentStep === pageOffset + i
                  ? "text-[var(--ed-accent-orange)] font-bold"
                  : "text-[var(--ed-text-muted)]"
              }`}
            >
              {pageOffset + i + 1}
            </div>
          ))}

          {/* Track rows */}
          {VOICE_LABELS.map((label, track) => (
            <React.Fragment key={track}>
              {/* Track label */}
              <div className="flex items-center text-[10px] font-medium text-[var(--ed-text-secondary)] pr-2 h-7">
                {label}
              </div>

              {/* Steps */}
              {Array.from({ length: 16 }, (_, stepIdx) => {
                const absoluteStep = pageOffset + stepIdx;
                const step = pattern.tracks[track]?.steps[absoluteStep];
                const isActive = step?.active ?? false;
                const isCurrent = isPlaying && currentStep === absoluteStep;
                const velocity = step?.velocity ?? 100;
                const hasLocks = isActive && step !== undefined && Object.keys(step.paramLocks).length > 0;
                const ratchetCount = step?.ratchetCount ?? 1;
                const hasRatchet = isActive && ratchetCount > 1;
                const isHeld = heldStep?.track === track && heldStep?.step === absoluteStep;
                const velOpacity = isActive ? 0.3 + (velocity / 127) * 0.7 : 1;
                const color = VOICE_COLORS[track] ?? "var(--ed-accent-orange)";

                return (
                  <button
                    key={`${track}-${stepIdx}`}
                    onClick={() => toggleStep(track, absoluteStep)}
                    onContextMenu={(e) => handleContextMenu(e, track, absoluteStep)}
                    onMouseDown={(e) => handleStepMouseDown(e, track, absoluteStep)}
                    className={`h-7 rounded-sm transition-all relative overflow-hidden ${
                      isCurrent ? "ring-1 ring-white/50" : ""
                    } ${
                      isHeld ? "ring-2 ring-[var(--ed-accent-green)]" : ""
                    } ${
                      isActive
                        ? "hover:brightness-110"
                        : stepIdx % 4 === 0
                          ? "bg-[var(--ed-bg-elevated)] hover:bg-[var(--ed-bg-surface)]"
                          : "bg-[var(--ed-bg-surface)] hover:bg-[var(--ed-bg-elevated)]"
                    }`}
                    style={isActive ? {
                      backgroundColor: color,
                      opacity: velOpacity,
                    } : undefined}
                  >
                    {/* Velocity bar */}
                    {isActive && (
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-black/20"
                        style={{ height: `${100 - (velocity / 127) * 100}%` }}
                      />
                    )}
                    {/* P-Lock indicator dot */}
                    {hasLocks && (
                      <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--ed-accent-green)]" />
                    )}
                    {/* Ratchet indicator */}
                    {hasRatchet && (
                      <span className="absolute bottom-0 left-0.5 text-[7px] font-bold text-black/60">
                        ×{ratchetCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
