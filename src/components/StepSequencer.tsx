import React, { useCallback, useRef, useState } from "react";
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

// ─── StepButton Component (memoized) ─────────────────────────────
interface StepButtonProps {
  track: number;
  absoluteStep: number;
  isActive: boolean;
  isCurrent: boolean;
  trackColor: string;
  velocity: number;
  ratchetCount: number;
  condition: string;
  gateLength: number;
  hasLocks: boolean;
  isHeld: boolean;
  isTiedStep: boolean;
  isInGateDragRange: boolean;
  isBeat: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  stepRef: (el: HTMLButtonElement | null) => void;
}

const StepButton = React.memo(function StepButton({
  track, absoluteStep, isActive, isCurrent, trackColor, velocity,
  ratchetCount, condition, gateLength, hasLocks, isHeld, isTiedStep,
  isInGateDragRange, isBeat, onClick, onContextMenu, onMouseDown, onPointerDown,
  stepRef,
}: StepButtonProps) {
  const velNorm = velocity / 127;
  const hasRatchet = isActive && ratchetCount > 1;
  const hasCondition = isActive && condition !== "always";
  const hasGate = isActive && gateLength > 1;
  const activeText = isActive ? "active" : "off";
  const velText = isActive ? `velocity ${velocity}` : "";

  return (
    <button
      ref={stepRef}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseDown={onMouseDown}
      onPointerDown={onPointerDown}
      aria-label={`Step ${absoluteStep + 1}, ${VOICE_LABELS[track]}, ${activeText}${velText ? ", " + velText : ""}`}
      className={`ed-step-btn h-[28px] rounded-[3px] relative overflow-hidden ${
        isHeld ? "ring-2 ring-[var(--ed-accent-green)] z-10" : ""
      } ${
        isActive
          ? "hover:brightness-125"
          : isBeat
            ? "bg-[var(--ed-bg-elevated)] hover:bg-[var(--ed-bg-surface)]"
            : "bg-[var(--ed-bg-surface)]/50 hover:bg-[var(--ed-bg-surface)]"
      }`}
      style={isActive ? {
        backgroundColor: trackColor,
        opacity: 0.35 + velNorm * 0.65,
        boxShadow: isCurrent ? `0 0 8px ${trackColor}40` : "none",
      } : (isTiedStep || isInGateDragRange) ? {
        backgroundColor: trackColor,
        opacity: 0.2,
      } : undefined}
    >
      {isCurrent && (
        <div className="absolute inset-0 bg-white/15 rounded-[3px]" />
      )}
      {isActive && (
        <div
          className="absolute bottom-0 left-0 right-0 bg-black/20"
          style={{ height: `${100 - velNorm * 100}%` }}
        />
      )}
      {hasGate && (
        <div
          className="absolute bottom-0 left-0 h-[3px] rounded-full"
          style={{ backgroundColor: "#fff", opacity: 0.5, width: "100%" }}
        />
      )}
      {isTiedStep && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-[2px] rounded-full bg-white/40" />
        </div>
      )}
      {isActive && (
        <div className="absolute right-0 top-0 bottom-0 w-[6px] cursor-e-resize opacity-0 hover:opacity-100 transition-opacity bg-white/30 rounded-r-[3px]" />
      )}
      {hasLocks && (
        <div className="absolute top-[2px] right-[8px] w-[5px] h-[5px] rounded-full bg-[var(--ed-accent-green)] shadow-[0_0_4px_rgba(34,197,94,0.5)]" />
      )}
      {hasRatchet && (
        <span className="absolute bottom-[1px] left-[2px] text-[6px] font-bold leading-none text-black/50">
          {ratchetCount}×
        </span>
      )}
      {hasCondition && (
        <span className="absolute top-[1px] left-[2px] text-[5px] font-bold leading-none text-yellow-200/80">
          {condition}
        </span>
      )}
    </button>
  );
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if key properties change
  return (
    prevProps.isActive === nextProps.isActive &&
    prevProps.isCurrent === nextProps.isCurrent &&
    prevProps.velocity === nextProps.velocity &&
    prevProps.ratchetCount === nextProps.ratchetCount &&
    prevProps.condition === nextProps.condition &&
    prevProps.gateLength === nextProps.gateLength &&
    prevProps.hasLocks === nextProps.hasLocks &&
    prevProps.isHeld === nextProps.isHeld &&
    prevProps.isTiedStep === nextProps.isTiedStep &&
    prevProps.isInGateDragRange === nextProps.isInGateDragRange
  );
});

// ─── TrackRow Component (memoized) ──────────────────────────────
interface TrackRowProps {
  track: number;
  label: string;
  color: string;
  pageOffset: number;
  selectedVoice: number;
  currentStep: number;
  isPlaying: boolean;
  heldStep: { track: number; step: number } | null;
  pattern: any;
  gateDrag: { track: number; startStep: number } | null;
  gateDragEnd: number;
  stepRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  onSelectTrack: (track: number) => void;
  onToggleStep: (track: number, absoluteStep: number) => void;
  onSetStepVelocity: (track: number, absoluteStep: number, velocity: number) => void;
  onContextMenu: (e: React.MouseEvent, track: number, absStep: number) => void;
  onStepMouseDown: (e: React.MouseEvent, track: number, absStep: number) => void;
  onGateDragStart: (e: React.PointerEvent, track: number, absStep: number) => void;
}

const TrackRow = React.memo(function TrackRow({
  track, label, color, pageOffset, selectedVoice, currentStep, isPlaying, heldStep,
  pattern, gateDrag, gateDragEnd, stepRefs, onSelectTrack, onToggleStep,
  onSetStepVelocity, onContextMenu, onStepMouseDown, onGateDragStart,
}: TrackRowProps) {
  const isSelectedTrack = selectedVoice === track;

  return (
    <React.Fragment>
      <button
        onClick={() => onSelectTrack(track)}
        aria-label={`Select track: ${label}`}
        className={`flex items-center text-[9px] font-semibold pr-1 h-[28px] rounded-l transition-all ${
          isSelectedTrack
            ? "text-[var(--ed-text-primary)]"
            : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
        }`}
      >
        <div className="w-[3px] h-3.5 rounded-full mr-1.5 shrink-0 transition-all" style={{
          backgroundColor: isSelectedTrack ? color : color + "30",
          boxShadow: isSelectedTrack ? `0 0 6px ${color}30` : "none",
        }} />
        {label}
      </button>

      {Array.from({ length: 16 }, (_, stepIdx) => {
        const absoluteStep = pageOffset + stepIdx;
        const step = pattern.tracks[track]?.steps[absoluteStep];
        const isActive = step?.active ?? false;
        const isCurrent = isPlaying && currentStep === absoluteStep;
        const velocity = step?.velocity ?? 100;
        const hasLocks = isActive && step !== undefined && Object.keys(step.paramLocks).length > 0;
        const ratchetCount = step?.ratchetCount ?? 1;
        const condition = step?.condition ?? "always";
        const isHeld = heldStep?.track === track && heldStep?.step === absoluteStep;
        const isBeat = stepIdx % 4 === 0;
        const gateLength = step?.gateLength ?? 1;

        let isTiedStep = false;
        if (!isActive) {
          for (let g = 1; g <= 16; g++) {
            const prevAbsStep = absoluteStep - g;
            if (prevAbsStep < 0) break;
            const prev = pattern.tracks[track]?.steps[prevAbsStep];
            if (prev?.active && (prev.gateLength ?? 1) > g) { isTiedStep = true; break; }
            if (prev?.active) break;
          }
        }

        const isInGateDragRange = gateDrag?.track === track
          && absoluteStep > gateDrag.startStep
          && absoluteStep <= gateDragEnd;

        return (
          <StepButton
            key={`${track}-${stepIdx}`}
            track={track}
            absoluteStep={absoluteStep}
            isActive={isActive}
            isCurrent={isCurrent}
            trackColor={color}
            velocity={velocity}
            ratchetCount={ratchetCount}
            condition={condition}
            gateLength={gateLength}
            hasLocks={hasLocks}
            isHeld={isHeld}
            isTiedStep={isTiedStep}
            isInGateDragRange={isInGateDragRange}
            isBeat={isBeat}
            onClick={(e) => {
              if (gateDrag) return;
              if (e.shiftKey && step?.active) {
                const levels = [127, 100, 70, 40];
                const current = step.velocity;
                const idx = levels.findIndex((v) => v <= current);
                const next = levels[(idx + 1) % levels.length]!;
                onSetStepVelocity(track, absoluteStep, next);
              } else {
                onToggleStep(track, absoluteStep);
              }
            }}
            onContextMenu={(e) => onContextMenu(e, track, absoluteStep)}
            onMouseDown={(e) => onStepMouseDown(e, track, absoluteStep)}
            onPointerDown={(e) => onGateDragStart(e, track, absoluteStep)}
            stepRef={(el) => {
              if (el) stepRefs.current.set(`${track}-${stepIdx}`, el);
              else stepRefs.current.delete(`${track}-${stepIdx}`);
            }}
          />
        );
      })}
    </React.Fragment>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.track === nextProps.track &&
    prevProps.selectedVoice === nextProps.selectedVoice &&
    prevProps.currentStep === nextProps.currentStep &&
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.heldStep === nextProps.heldStep &&
    prevProps.pattern === nextProps.pattern &&
    prevProps.gateDrag === nextProps.gateDrag &&
    prevProps.gateDragEnd === nextProps.gateDragEnd
  );
});

export function StepSequencer() {
  const {
    pattern, currentStep, isPlaying, selectedPage, heldStep, selectedVoice,
    setSelectedPage, toggleStep, setStepVelocity, setStepRatchet, setStepCondition,
    setStepGateLength, holdStep, releaseStep, setSelectedVoice,
    copyPage, pastePage, pageClipboard,
  } = useDrumStore();

  const pageOffset = selectedPage * 16;

  // ─── Gate-Length Drag State ─────────────────────────────
  const [gateDrag, setGateDrag] = useState<{ track: number; startStep: number } | null>(null);
  const [gateDragEnd, setGateDragEnd] = useState<number>(0);
  const stepRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const CONDITIONS: import("../store/drumStore").ConditionType[] = [
    "always", "prob", "fill", "!fill", "pre", "!pre", "nei", "!nei",
    "1st", "!1st", "2:2", "3:3", "4:4", "2:3", "2:4", "3:4",
  ];

  // Use refs to avoid re-creating callbacks when pattern changes
  const patternRef = useRef(pattern);
  const setStepConditionRef = useRef(setStepCondition);
  const setStepRatchetRef = useRef(setStepRatchet);
  const setStepVelocityRef = useRef(setStepVelocity);

  patternRef.current = pattern;
  setStepConditionRef.current = setStepCondition;
  setStepRatchetRef.current = setStepRatchet;
  setStepVelocityRef.current = setStepVelocity;

  const handleContextMenu = useCallback((e: React.MouseEvent, track: number, absStep: number) => {
    e.preventDefault();
    const step = patternRef.current.tracks[track]?.steps[absStep];
    if (!step?.active) return;

    if (e.altKey || e.metaKey) {
      const current = step.condition ?? "always";
      const idx = CONDITIONS.indexOf(current);
      const next = CONDITIONS[(idx + 1) % CONDITIONS.length]!;
      setStepConditionRef.current(track, absStep, next);
      return;
    }

    if (e.shiftKey) {
      const ratchetLevels = [1, 2, 3, 4, 6, 8];
      const current = step.ratchetCount ?? 1;
      const idx = ratchetLevels.indexOf(current);
      const next = ratchetLevels[(idx + 1) % ratchetLevels.length]!;
      setStepRatchetRef.current(track, absStep, next);
    } else {
      const levels = [127, 100, 70, 40];
      const current = step.velocity;
      const idx = levels.findIndex((v) => v <= current);
      const next = levels[(idx + 1) % levels.length]!;
      setStepVelocityRef.current(track, absStep, next);
    }
  }, []);

  const holdStepRef = useRef(holdStep);
  const setSelectedVoiceRef = useRef(setSelectedVoice);

  holdStepRef.current = holdStep;
  setSelectedVoiceRef.current = setSelectedVoice;

  const handleStepMouseDown = useCallback((e: React.MouseEvent, track: number, absStep: number) => {
    const step = patternRef.current.tracks[track]?.steps[absStep];
    if (!step?.active || e.button !== 0) return;
    holdStepRef.current(track, absStep);
    setSelectedVoiceRef.current(track);
  }, []);

  // ─── Gate-Length Drag Handlers ──────────────────────────
  // Right edge of an active step: drag right to extend gate length

  const setGateDragRef = useRef(setGateDrag);
  const setGateDragEndRef = useRef(setGateDragEnd);

  setGateDragRef.current = setGateDrag;
  setGateDragEndRef.current = setGateDragEnd;

  const handleGateDragStart = useCallback((e: React.PointerEvent, track: number, absStep: number) => {
    const step = patternRef.current.tracks[track]?.steps[absStep];
    if (!step?.active) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    if (offsetX < rect.width - 8) return;

    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setGateDragRef.current({ track, startStep: absStep });
    setGateDragEndRef.current(absStep);
  }, []);

  const handleGateDragMove = useCallback((e: React.PointerEvent) => {
    if (!gateDrag) return;
    // Find which step column the pointer is over
    const pageSteps = Array.from({ length: 16 }, (_, i) => pageOffset + i);
    for (const absStep of pageSteps) {
      const key = `${gateDrag.track}-${absStep - pageOffset}`;
      const el = stepRefs.current.get(key);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX < rect.right) {
        if (absStep >= gateDrag.startStep) {
          setGateDragEnd(absStep);
        }
        break;
      }
    }
  }, [gateDrag, pageOffset]);

  const setStepGateLengthRef = useRef(setStepGateLength);
  const releaseSepRef = useRef(releaseStep);

  setStepGateLengthRef.current = setStepGateLength;
  releaseSepRef.current = releaseStep;

  const handleGateDragEnd = useCallback(() => {
    if (!gateDrag) return;
    const gateLen = gateDragEnd - gateDrag.startStep + 1;
    if (gateLen >= 1) {
      setStepGateLengthRef.current(gateDrag.track, gateDrag.startStep, gateLen);
    }
    setGateDragRef.current(null);
  }, [gateDrag, gateDragEnd]);

  return (
    <div className="flex flex-col h-full p-3" onMouseUp={() => { releaseStep(); handleGateDragEnd(); }} onPointerMove={handleGateDragMove}>
      {/* Header: Pages + Status */}
      <div className="flex items-center gap-2 mb-2.5">
        {/* Page buttons */}
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((page) => (
            <button
              key={page}
              onClick={() => setSelectedPage(page)}
              aria-label={`Page ${page + 1}, steps ${page * 16 + 1} to ${(page + 1) * 16}`}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-all ${
                selectedPage === page
                  ? "bg-[var(--ed-accent-orange)] text-black font-bold shadow-[0_0_8px_rgba(245,158,11,0.2)]"
                  : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)] hover:bg-[var(--ed-bg-elevated)]"
              }`}
            >
              {page * 16 + 1}-{(page + 1) * 16}
            </button>
          ))}
        </div>

        {/* Page Copy/Paste */}
        <div className="flex items-center gap-1 ml-1">
          <button
            onClick={() => copyPage(selectedPage)}
            aria-label="Copy page"
            className="px-2 py-0.5 text-[8px] font-bold rounded-md bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] hover:bg-[var(--ed-bg-elevated)] transition-all"
          >
            COPY
          </button>
          <button
            onClick={() => pastePage(selectedPage)}
            aria-label="Paste page"
            className={`px-2 py-0.5 text-[8px] font-bold rounded-md transition-all ${
              pageClipboard
                ? "bg-[var(--ed-accent-blue)]/15 text-[var(--ed-accent-blue)] hover:bg-[var(--ed-accent-blue)]/25"
                : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] opacity-30"
            }`}
            disabled={!pageClipboard}
          >
            PASTE
          </button>
        </div>

        {/* Length +/- */}
        <div className="flex items-center gap-1 ml-1">
          {(() => {
            const VALID_LENGTHS = [4, 8, 12, 16, 24, 32, 48, 64];
            const currentIdx = VALID_LENGTHS.indexOf(pattern.length);
            const snapIdx = currentIdx >= 0 ? currentIdx
              : VALID_LENGTHS.findIndex((l) => l >= pattern.length);

            return (<>
              <button
                onClick={() => {
                  const idx = Math.max(0, (snapIdx >= 0 ? snapIdx : 3) - 1);
                  useDrumStore.setState((s) => ({
                    pattern: { ...s.pattern, length: VALID_LENGTHS[idx]! },
                  }));
                }}
                className="w-5 h-5 rounded-md text-[10px] font-bold bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-white hover:bg-[var(--ed-bg-elevated)] transition-all"
              >−</button>
              <span className="text-[10px] font-mono text-[var(--ed-accent-orange)] min-w-[24px] text-center font-bold tabular-nums">
                {pattern.length}
              </span>
              <button
                onClick={() => {
                  const idx = Math.min(VALID_LENGTHS.length - 1, (snapIdx >= 0 ? snapIdx : 3) + 1);
                  useDrumStore.setState((s) => ({
                    pattern: { ...s.pattern, length: VALID_LENGTHS[idx]! },
                  }));
                }}
                className="w-5 h-5 rounded-md text-[10px] font-bold bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-white hover:bg-[var(--ed-bg-elevated)] transition-all"
              >+</button>
              <span className="text-[7px] text-[var(--ed-text-muted)] font-bold">STEPS</span>
            </>);
          })()}
        </div>

        <div className="flex-1" />

        <span className="text-[9px] text-[var(--ed-text-muted)] hidden lg:block truncate max-w-[300px]">
          {heldStep
            ? <span className="text-[var(--ed-accent-green)]">P-LOCK: {VOICE_LABELS[heldStep.track]} Step {heldStep.step + 1}</span>
            : <span className="opacity-40">hold step = P-Lock &middot; rclick = vel &middot; shift+rclick = ratchet &middot; drag edge = gate</span>
          }
        </span>
      </div>

      {/* Step Grid */}
      <div className="flex-1 overflow-auto">
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: "52px repeat(16, 1fr)" }}>

          {/* Header: step numbers */}
          <div />
          {Array.from({ length: 16 }, (_, i) => {
            const absIdx = pageOffset + i;
            const isCurrent = isPlaying && currentStep === absIdx;
            return (
              <div
                key={i}
                className={`text-center text-[9px] font-mono pb-0.5 transition-colors ${
                  isCurrent
                    ? "text-[var(--ed-accent-orange)] font-bold"
                    : i % 4 === 0
                      ? "text-[var(--ed-text-secondary)]"
                      : "text-[var(--ed-text-muted)]/60"
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
              <div key={`ph-${i}`} className={`h-[3px] rounded-full mx-0.5 transition-all duration-[40ms] ${isCurrent ? "ed-playhead-glow" : ""}`} style={{
                backgroundColor: isCurrent ? "var(--ed-accent-orange)" : "transparent",
              }} />
            );
          })}

          {/* Track rows */}
          {VOICE_LABELS.map((label, track) => {
            const trackColor = TRACK_COLORS[track]!;

            return (
              <TrackRow
                key={track}
                track={track}
                label={label}
                color={trackColor}
                pageOffset={pageOffset}
                selectedVoice={selectedVoice}
                currentStep={currentStep}
                isPlaying={isPlaying}
                heldStep={heldStep}
                pattern={pattern}
                gateDrag={gateDrag}
                gateDragEnd={gateDragEnd}
                stepRefs={stepRefs}
                onSelectTrack={setSelectedVoice}
                onToggleStep={toggleStep}
                onSetStepVelocity={setStepVelocity}
                onContextMenu={handleContextMenu}
                onStepMouseDown={handleStepMouseDown}
                onGateDragStart={handleGateDragStart}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
