import React, { useCallback } from "react";
import { useDrumStore } from "../store/drumStore";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM L",
  "TOM M", "TOM H", "HH CL", "HH OP",
  "CYM", "RIDE", "PRC1", "PRC2",
];

const TRACK_COLORS = [
  "#f59e0b", "#f59e0b", "#f59e0b",
  "#f59e0b", "#f59e0b", "#f59e0b",
  "#3b82f6", "#3b82f6",
  "#3b82f6", "#3b82f6",
  "#8b5cf6", "#8b5cf6",
];

export function StepSequencer() {
  const {
    pattern, currentStep, isPlaying, selectedPage, heldStep, selectedVoice,
    setSelectedPage, toggleStep, setStepVelocity, setStepRatchet, setStepCondition,
    holdStep, releaseStep, setSelectedVoice,
    copyPage, pastePage, pageClipboard,
  } = useDrumStore();

  const pageOffset = selectedPage * 16;

  // All available conditions for cycling
  const CONDITIONS: import("../store/drumStore").ConditionType[] = [
    "always", "prob", "fill", "!fill", "pre", "!pre", "nei", "!nei",
    "1st", "!1st", "2:2", "3:3", "4:4", "2:3", "2:4", "3:4",
  ];

  const handleContextMenu = useCallback((e: React.MouseEvent, track: number, absStep: number) => {
    e.preventDefault();
    const step = pattern.tracks[track]?.steps[absStep];
    if (!step?.active) return;

    if (e.altKey || e.metaKey) {
      // Alt+right-click: cycle conditional trig
      const current = step.condition ?? "always";
      const idx = CONDITIONS.indexOf(current);
      const next = CONDITIONS[(idx + 1) % CONDITIONS.length]!;
      setStepCondition(track, absStep, next);
      return;
    }

    if (e.shiftKey) {
      const ratchetLevels = [1, 2, 3, 4, 6, 8];
      const current = step.ratchetCount ?? 1;
      const idx = ratchetLevels.indexOf(current);
      const next = ratchetLevels[(idx + 1) % ratchetLevels.length]!;
      setStepRatchet(track, absStep, next);
    } else {
      const levels = [127, 100, 70, 40];
      const current = step.velocity;
      const idx = levels.findIndex((v) => v <= current);
      const next = levels[(idx + 1) % levels.length]!;
      setStepVelocity(track, absStep, next);
    }
  }, [pattern, setStepVelocity, setStepRatchet]);

  const handleStepMouseDown = useCallback((e: React.MouseEvent, track: number, absStep: number) => {
    const step = pattern.tracks[track]?.steps[absStep];
    if (!step?.active || e.button !== 0) return;
    holdStep(track, absStep);
    setSelectedVoice(track);
  }, [pattern, holdStep, setSelectedVoice]);

  return (
    <div className="flex flex-col h-full p-3" onMouseUp={() => releaseStep()}>
      {/* Header: Pages + Status */}
      <div className="flex items-center gap-2 mb-2">
        {[0, 1, 2, 3].map((page) => (
          <button
            key={page}
            onClick={() => setSelectedPage(page)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors ${
              selectedPage === page
                ? "bg-[var(--ed-accent-orange)] text-black font-bold"
                : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
            }`}
          >
            {page * 16 + 1}-{(page + 1) * 16}
          </button>
        ))}

        {/* Page Copy/Paste */}
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => copyPage(selectedPage)}
            className="px-2 py-0.5 text-[8px] font-bold rounded bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)] transition-colors"
          >
            COPY
          </button>
          <button
            onClick={() => pastePage(selectedPage)}
            className={`px-2 py-0.5 text-[8px] font-bold rounded transition-colors ${
              pageClipboard
                ? "bg-[var(--ed-accent-blue)]/20 text-[var(--ed-accent-blue)] hover:bg-[var(--ed-accent-blue)]/30"
                : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] opacity-40"
            }`}
            disabled={!pageClipboard}
          >
            PASTE
          </button>
        </div>

        {/* Length +/- */}
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => {
              const newLen = Math.max(4, pattern.length - 4);
              useDrumStore.setState((s) => ({ pattern: { ...s.pattern, length: newLen } }));
            }}
            className="w-5 h-5 rounded text-[10px] font-bold bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-white transition-colors"
          >−</button>
          <span className="text-[9px] font-mono text-[var(--ed-accent-orange)] min-w-[24px] text-center">
            {pattern.length}
          </span>
          <button
            onClick={() => {
              const newLen = Math.min(64, pattern.length + 4);
              useDrumStore.setState((s) => ({ pattern: { ...s.pattern, length: newLen } }));
            }}
            className="w-5 h-5 rounded text-[10px] font-bold bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-white transition-colors"
          >+</button>
          <span className="text-[7px] text-[var(--ed-text-muted)]">STEPS</span>
        </div>

        <div className="flex-1" />

        <span className="text-[9px] text-[var(--ed-text-muted)]">
          {heldStep
            ? `⬤ P-LOCK: ${VOICE_LABELS[heldStep.track]} Step ${heldStep.step + 1}`
            : "shift+click=vel · hold=P-Lock · rclick=ratchet · alt+rclick=cond"
          }
        </span>
      </div>

      {/* Step Grid */}
      <div className="flex-1 overflow-auto">
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: "48px repeat(16, 1fr)" }}>

          {/* Header: step numbers */}
          <div />
          {Array.from({ length: 16 }, (_, i) => {
            const absIdx = pageOffset + i;
            const isCurrent = isPlaying && currentStep === absIdx;
            const beyondLen = absIdx >= pattern.length;
            return (
              <div
                key={i}
                className={`text-center text-[9px] font-mono pb-0.5 transition-colors ${
                  beyondLen
                    ? "text-[var(--ed-text-muted)] opacity-20"
                    : isCurrent
                      ? "text-[var(--ed-accent-orange)] font-bold"
                      : i % 4 === 0
                        ? "text-[var(--ed-text-secondary)]"
                        : "text-[var(--ed-text-muted)]"
                }`}
              >
                {absIdx + 1}
              </div>
            );
          })}

          {/* Playhead row */}
          <div />
          {Array.from({ length: 16 }, (_, i) => {
            const isCurrent = isPlaying && currentStep === pageOffset + i;
            return (
              <div key={`ph-${i}`} className="h-[3px] rounded-full mx-0.5" style={{
                backgroundColor: isCurrent ? "var(--ed-accent-orange)" : "transparent",
                boxShadow: isCurrent ? "0 0 6px var(--ed-accent-orange)" : "none",
                transition: "all 50ms",
              }} />
            );
          })}

          {/* Track rows */}
          {VOICE_LABELS.map((label, track) => {
            const trackColor = TRACK_COLORS[track]!;
            const isSelectedTrack = selectedVoice === track;

            return (
              <React.Fragment key={track}>
                {/* Track label */}
                <button
                  onClick={() => setSelectedVoice(track)}
                  className={`flex items-center text-[9px] font-medium pr-1 h-[26px] rounded-l transition-colors ${
                    isSelectedTrack
                      ? "text-[var(--ed-text-primary)]"
                      : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
                  }`}
                >
                  <div className="w-1 h-3 rounded-full mr-1.5 shrink-0" style={{
                    backgroundColor: isSelectedTrack ? trackColor : trackColor + "40",
                  }} />
                  {label}
                </button>

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
                  const condition = step?.condition ?? "always";
                  const hasCondition = isActive && condition !== "always";
                  const isHeld = heldStep?.track === track && heldStep?.step === absoluteStep;
                  const velNorm = velocity / 127;
                  const isBeat = stepIdx % 4 === 0;
                  const isBeyondLength = absoluteStep >= pattern.length;

                  return (
                    <button
                      key={`${track}-${stepIdx}`}
                      onClick={(e) => {
                        if (isBeyondLength) return; // Can't edit beyond pattern length
                        if (e.shiftKey && step?.active) {
                          const levels = [127, 100, 70, 40];
                          const current = step.velocity;
                          const idx = levels.findIndex((v) => v <= current);
                          const next = levels[(idx + 1) % levels.length]!;
                          setStepVelocity(track, absoluteStep, next);
                        } else {
                          toggleStep(track, absoluteStep);
                        }
                      }}
                      onContextMenu={(e) => handleContextMenu(e, track, absoluteStep)}
                      onMouseDown={(e) => handleStepMouseDown(e, track, absoluteStep)}
                      className={`h-[26px] rounded-[3px] transition-all relative overflow-hidden ${
                        isHeld ? "ring-2 ring-[var(--ed-accent-green)] z-10" : ""
                      } ${
                        isBeyondLength
                          ? "bg-[var(--ed-bg-primary)]/50 cursor-default"
                          : isActive
                            ? "hover:brightness-125"
                            : isBeat
                              ? "bg-[var(--ed-bg-elevated)] hover:bg-[var(--ed-bg-surface)]"
                              : "bg-[var(--ed-bg-surface)]/60 hover:bg-[var(--ed-bg-surface)]"
                      }`}
                      style={
                        isBeyondLength
                          ? { opacity: 0.2 }
                          : isActive
                            ? { backgroundColor: trackColor, opacity: 0.35 + velNorm * 0.65 }
                            : undefined
                      }
                    >
                      {/* Playhead highlight */}
                      {isCurrent && (
                        <div className="absolute inset-0 bg-white/10 rounded-[3px]" />
                      )}

                      {/* Velocity bar */}
                      {isActive && (
                        <div
                          className="absolute bottom-0 left-0 right-0 bg-black/15"
                          style={{ height: `${100 - velNorm * 100}%` }}
                        />
                      )}

                      {/* P-Lock dot */}
                      {hasLocks && (
                        <div className="absolute top-[2px] right-[2px] w-[5px] h-[5px] rounded-full bg-[var(--ed-accent-green)] shadow-sm shadow-green-500/50" />
                      )}

                      {/* Ratchet indicator */}
                      {hasRatchet && (
                        <span className="absolute bottom-[1px] left-[2px] text-[6px] font-bold leading-none" style={{ color: "rgba(0,0,0,0.4)" }}>
                          {ratchetCount}×
                        </span>
                      )}

                      {/* Condition indicator */}
                      {hasCondition && (
                        <span className="absolute top-[1px] left-[2px] text-[5px] font-bold leading-none text-yellow-300/80">
                          {condition}
                        </span>
                      )}
                    </button>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
