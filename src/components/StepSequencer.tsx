import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useDrumStore, drumCurrentStepStore } from "../store/drumStore";

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
      className={`ed-step-btn h-[28px] rounded-[3px] relative ${hasGate ? "overflow-visible z-20" : "overflow-hidden"} ${
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
      {hasGate && (
        <div
          className="absolute left-[4px] top-1/2 -translate-y-1/2 h-[16px] rounded-[4px] pointer-events-none"
          style={{
            width: `calc(${gateLength * 100}% + ${(gateLength - 1) * 2}px - 8px)`,
            background: `linear-gradient(90deg, ${trackColor}88 0%, ${trackColor}55 82%, ${trackColor}22 100%)`,
            boxShadow: `0 0 0 1px ${trackColor}55 inset, 0 0 10px ${trackColor}25`,
          }}
        />
      )}
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
      {hasGate && (
        <span className="absolute right-[8px] top-[2px] text-[6px] font-black leading-none text-black/55 pointer-events-none">
          {gateLength}
        </span>
      )}
      {isTiedStep && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-[2px] rounded-full bg-white/40" />
        </div>
      )}
      {isActive && (
        <div className={`absolute right-0 top-0 bottom-0 w-[10px] cursor-e-resize transition-opacity rounded-r-[3px] ${
          hasGate ? "opacity-100 bg-white/35" : "opacity-70 hover:opacity-100 bg-white/18"
        }`} />
      )}
      {hasLocks && (
        <div className="absolute top-[1px] right-[1px] w-[6px] h-[6px] rounded-full bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.6)] border border-yellow-500/50" title="P-Lock" />
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

const SWING_CYCLE = [undefined, 55, 60, 65, 70, 75] as const;

const TrackRow = React.memo(function TrackRow({
  track, label, color, pageOffset, selectedVoice, isPlaying, heldStep,
  pattern, gateDrag, gateDragEnd, stepRefs, onSelectTrack, onToggleStep,
  onSetStepVelocity, onContextMenu, onStepMouseDown, onGateDragStart,
}: TrackRowProps) {
  const currentStep = useSyncExternalStore(drumCurrentStepStore.subscribe, drumCurrentStepStore.getSnapshot);
  const isSelectedTrack = selectedVoice === track;
  const trackSwing = pattern.tracks[track]?.swing as number | undefined;
  const hasSwing = trackSwing !== undefined;

  // Right-click track label → cycle per-track swing preset
  const handleSwingCycle = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const { setTrackSwing } = useDrumStore.getState();
    const idx = SWING_CYCLE.findIndex((v) => v === trackSwing);
    const next = SWING_CYCLE[(idx + 1) % SWING_CYCLE.length];
    setTrackSwing(track, next);
  }, [track, trackSwing]);

  return (
    <React.Fragment>
      <button
        onClick={() => onSelectTrack(track)}
        onContextMenu={handleSwingCycle}
        aria-label={`Select track: ${label}${hasSwing ? ` (swing ${trackSwing})` : ""}`}
        title={hasSwing ? `Swing: ${trackSwing} · Right-click to cycle` : "Right-click to set per-track swing"}
        className={`flex min-w-0 items-center text-[9px] font-semibold pr-1 h-[28px] rounded-l transition-all whitespace-nowrap overflow-hidden ${
          isSelectedTrack
            ? "text-[var(--ed-text-primary)]"
            : "text-[var(--ed-text-muted)] hover:text-[var(--ed-text-secondary)]"
        }`}
      >
        {/* Color bar — turns amber + grows when per-track swing is set */}
        <div
          className="rounded-full mr-1.5 shrink-0 transition-all"
          style={{
            width: hasSwing ? "5px" : "3px",
            height: hasSwing ? "18px" : "14px",
            backgroundColor: hasSwing
              ? `color-mix(in srgb, #f59e0b 70%, ${color})`
              : isSelectedTrack ? color : color + "30",
            boxShadow: hasSwing
              ? "0 0 6px rgba(245,158,11,0.5)"
              : isSelectedTrack ? `0 0 6px ${color}30` : "none",
          }}
        />
        <span className="truncate leading-none flex-1">{label}</span>
        {/* Swing value badge */}
        {hasSwing && (
          <span
            className="text-[6px] font-black tabular-nums shrink-0 ml-0.5"
            style={{ color: "rgba(245,158,11,0.75)" }}
          >
            {trackSwing}
          </span>
        )}
      </button>

      {Array.from({ length: 16 }, (_, stepIdx) => {
        const absoluteStep = pageOffset + stepIdx;
        const step = pattern.tracks[track]?.steps[absoluteStep];
        const isActive = step?.active ?? false;
        const isCurrent = isPlaying && currentStep === absoluteStep;
        const velocity = step?.velocity ?? 100;
        const hasLocks = step !== undefined && Object.keys(step.paramLocks).length > 0;
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
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.heldStep === nextProps.heldStep &&
    prevProps.pattern === nextProps.pattern &&
    prevProps.gateDrag === nextProps.gateDrag &&
    prevProps.gateDragEnd === nextProps.gateDragEnd
  );
});

export function StepSequencer() {
  // Per-field selectors — prevents re-render cascade from currentStep tick
  const pattern = useDrumStore((s) => s.pattern);
  const isPlaying = useDrumStore((s) => s.isPlaying);
  // currentStep from external store — only this component and TrackRow subscribe
  const currentStep = useSyncExternalStore(drumCurrentStepStore.subscribe, drumCurrentStepStore.getSnapshot);
  const selectedPage = useDrumStore((s) => s.selectedPage);
  const heldStep = useDrumStore((s) => s.heldStep);
  const selectedVoice = useDrumStore((s) => s.selectedVoice);
  const pageClipboard = useDrumStore((s) => s.pageClipboard);
  const setSelectedPage = useDrumStore((s) => s.setSelectedPage);
  const toggleStep = useDrumStore((s) => s.toggleStep);
  const setStepVelocity = useDrumStore((s) => s.setStepVelocity);
  const setStepRatchet = useDrumStore((s) => s.setStepRatchet);
  const setStepCondition = useDrumStore((s) => s.setStepCondition);
  const setStepGateLength = useDrumStore((s) => s.setStepGateLength);
  const holdStep = useDrumStore((s) => s.holdStep);
  const releaseStep = useDrumStore((s) => s.releaseStep);
  const setSelectedVoice = useDrumStore((s) => s.setSelectedVoice);
  const copyPage = useDrumStore((s) => s.copyPage);
  const pastePage = useDrumStore((s) => s.pastePage);

  const pageOffset = selectedPage * 16;

  // Memoize expensive aggregate counters — only recompute when pattern/page changes,
  // NOT on every currentStep tick (which was triggering 768 iterations per frame)
  const { totalActiveSteps, activeTracks, currentPageActive } = useMemo(() => {
    let totalActive = 0;
    let activeTr = 0;
    let pageActive = 0;
    for (const track of pattern.tracks) {
      let trackHasActive = false;
      for (let i = 0; i < pattern.length; i++) {
        const step = track.steps[i];
        if (step?.active) {
          totalActive++;
          trackHasActive = true;
          if (i >= pageOffset && i < pageOffset + 16) pageActive++;
        }
      }
      if (trackHasActive) activeTr++;
    }
    return { totalActiveSteps: totalActive, activeTracks: activeTr, currentPageActive: pageActive };
  }, [pattern, pageOffset]);
  const selectedTrack = pattern.tracks[selectedVoice];

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
    if (offsetX < rect.width - 12) return;

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
      <div className="mb-2 rounded-xl border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))] px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black tracking-[0.18em] text-[var(--ed-accent-orange)]">
              DRUM ARRANGER
            </span>
            <span className="text-[8px] font-bold tracking-[0.15em] text-white/20">
              STEP / MOTION / PERFORMANCE
            </span>
          </div>

          <div className="flex items-center gap-2 text-[8px] font-bold tracking-[0.12em] text-white/40">
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">
              {pattern.name}
            </span>
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">
              {activeTracks} TRACKS ACTIVE
            </span>
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">
              {totalActiveSteps} TRIGS
            </span>
            <span className="rounded-full border border-white/8 bg-black/25 px-2 py-0.5">
              PAGE {selectedPage + 1} · {currentPageActive} STEPS
            </span>
          </div>
        </div>

        <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
          <div className="grid grid-cols-4 gap-1.5">
            {[0, 1, 2, 3].map((page) => {
              const start = page * 16;
              const pageCount = pattern.tracks.reduce((sum, track) => (
                sum + track.steps.slice(start, start + 16).filter((step) => step.active).length
              ), 0);
              const density = Math.min(1, pageCount / 48);
              return (
                <button
                  key={`overview-page-${page}`}
                  onClick={() => setSelectedPage(page)}
                  className={`relative overflow-hidden rounded-lg border px-2 py-2 text-left transition-all ${
                    selectedPage === page
                      ? "border-[var(--ed-accent-orange)]/40 bg-[var(--ed-accent-orange)]/10"
                      : "border-white/6 bg-black/20 hover:border-white/12"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-black tracking-[0.16em] text-white/70">PAGE {page + 1}</span>
                    <span className="text-[8px] font-mono text-white/35">{pageCount}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-white/6">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(8, density * 100)}%`,
                        background: "linear-gradient(90deg, rgba(245,158,11,0.95), rgba(245,158,11,0.35))",
                      }}
                    />
                  </div>
                  <div className="mt-1 text-[7px] font-bold tracking-[0.12em] text-white/25">
                    {start + 1}-{start + 16}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/6 bg-black/20 px-3 py-2">
            <span className="text-[8px] font-black tracking-[0.16em] text-white/55">
              SELECTED LANE
            </span>
            <span className="text-[10px] font-bold tracking-[0.12em]" style={{ color: TRACK_COLORS[selectedVoice] }}>
              {VOICE_LABELS[selectedVoice]}
            </span>
            <span className="text-[8px] font-bold tracking-[0.12em] text-white/30">
              VOL {selectedTrack?.volume ?? 100}
            </span>
            <span className="text-[8px] font-bold tracking-[0.12em] text-white/30">
              LEN {selectedTrack?.length ?? pattern.length}
            </span>

            {/* Per-track swing — always visible for selected lane */}
            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-[8px] font-black tracking-[0.14em]" style={{
                color: (selectedTrack?.swing !== undefined) ? "rgba(245,158,11,0.85)" : "rgba(255,255,255,0.28)"
              }}>SWG</span>
              <input
                type="range"
                min={50} max={75}
                value={selectedTrack?.swing ?? pattern.swing}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  // Always set the numeric value — use the × button to reset to global
                  useDrumStore.getState().setTrackSwing(selectedVoice, val);
                }}
                className="w-14 h-[3px]"
                style={{ accentColor: selectedTrack?.swing !== undefined ? "#f59e0b" : "rgba(255,255,255,0.3)" }}
                title={`Per-track swing: ${selectedTrack?.swing ?? "follows global"}`}
              />
              <span className="text-[8px] font-mono tabular-nums w-5" style={{
                color: (selectedTrack?.swing !== undefined) ? "rgba(245,158,11,0.75)" : "rgba(255,255,255,0.22)"
              }}>
                {selectedTrack?.swing ?? "—"}
              </span>
              {selectedTrack?.swing !== undefined && (
                <button
                  onClick={() => useDrumStore.getState().setTrackSwing(selectedVoice, undefined)}
                  className="text-[7px] text-white/20 hover:text-amber-400 transition-colors leading-none"
                  title="Reset to global swing"
                >×</button>
              )}
            </div>

            <span className={`text-[8px] font-bold tracking-[0.14em] ml-auto ${isPlaying ? "text-[var(--ed-accent-green)]" : "text-white/30"}`}>
              {isPlaying ? `PLAYHEAD ${currentStep + 1}` : "STOPPED"}
            </span>
          </div>
        </div>
      </div>

      {/* Header: Pages + Status */}
      <div className="flex items-center gap-2 mb-2.5">
        {/* Page buttons */}
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((page) => (
            <button
              key={`header-page-${page}`}
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
            : <span className="opacity-40">hold step = P-Lock &middot; rclick = vel &middot; shift+rclick = ratchet &middot; drag bright edge = note length</span>
          }
        </span>
      </div>

      {/* Step Grid */}
      <div className="flex-1 overflow-auto">
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: "72px repeat(16, 1fr)" }}>

          {/* Header: step numbers */}
          <div className="flex items-end pb-0.5">
            <span className="text-[8px] font-black tracking-[0.16em] text-white/20">RULER</span>
          </div>
          {Array.from({ length: 16 }, (_, i) => {
            const absIdx = pageOffset + i;
            const isCurrent = isPlaying && currentStep === absIdx;
            return (
              <div
                key={i}
                className={`text-center text-[9px] font-mono pb-0.5 transition-colors border-b ${
                  isCurrent
                    ? "text-[var(--ed-accent-orange)] font-bold"
                    : i % 4 === 0
                      ? "text-[var(--ed-text-secondary)]"
                      : "text-[var(--ed-text-muted)]/60"
                } ${i % 4 === 0 ? "border-white/10" : "border-white/5"}`}
              >
                <div className="text-[6px] font-black tracking-[0.18em] text-white/20">
                  {Math.floor(i / 4) + 1}.{(i % 4) + 1}
                </div>
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
