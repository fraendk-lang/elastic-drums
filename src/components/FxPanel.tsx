/**
 * FxPanel — Fullscreen Performance FX Overlay
 *
 * Kaoss Pad-style XY controller + Beat FX buttons.
 * Completely rewritten with musical parameter mapping, BPM sync, and proper audio algorithms.
 */

import { useState, useCallback, useRef } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { useDrumStore } from "../store/drumStore";

// ─── Types ───────────────────────────────────────────────

type FxTarget = "master" | "drums" | "bass" | "chords" | "melody";

const FX_TARGETS: { id: FxTarget; label: string; channels: number[] }[] = [
  { id: "master", label: "MASTER", channels: [] },
  { id: "drums", label: "DRUMS", channels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: "bass", label: "BASS", channels: [12] },
  { id: "chords", label: "CHORDS", channels: [13] },
  { id: "melody", label: "MELODY", channels: [14] },
];

interface FxPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type FxMode = "FILTER" | "DELAY" | "REVERB" | "FLANGER" | "CRUSH";

interface ModeConfig {
  color: string;
  xLabel: string;
  yLabel: string;
}

interface MusicalValue {
  text: string;
  description: string;
}

// ─── Constants ───────────────────────────────────────────

const MODE_CONFIG: Record<FxMode, ModeConfig> = {
  FILTER: { color: "#f59e0b", xLabel: "Frequency", yLabel: "Resonance" },
  DELAY: { color: "#3b82f6", xLabel: "Division", yLabel: "Feedback" },
  REVERB: { color: "#8b5cf6", xLabel: "Brightness", yLabel: "Level" },
  FLANGER: { color: "#06b6d4", xLabel: "Rate", yLabel: "Depth + Feedback" },
  CRUSH: { color: "#ef4444", xLabel: "Filter Mode", yLabel: "Drive" },
};

const FX_MODES: FxMode[] = ["FILTER", "DELAY", "REVERB", "FLANGER", "CRUSH"];

// ─── Musical Value Formatters ────────────────────────────

function getMusicalValue(mode: FxMode, x: number, y: number, _bpm: number): MusicalValue {
  switch (mode) {
    case "FILTER": {
      if (x < 0.5) {
        const norm = 1 - x * 2;
        const freq = Math.round(80 * Math.pow(20000 / 80, 1 - norm));
        const q = Math.round((0.5 + y * 25) * 10) / 10;
        return { text: `LP ${freq}Hz`, description: `Q: ${q}` };
      } else {
        const norm = (x - 0.5) * 2;
        const freq = Math.round(20 * Math.pow(12000 / 20, norm));
        const q = Math.round((0.5 + y * 25) * 10) / 10;
        return { text: `HP ${freq}Hz`, description: `Q: ${q}` };
      }
    }
    case "DELAY": {
      const divisions = [0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 1.0, 2.0];
      const divNames = ["1/32", "1/16T", "1/16", "1/8T", "1/8", "1/4T", "1/4", "1/2"];
      const divIdx = Math.min(divisions.length - 1, Math.floor(x * divisions.length));
      const feedback = Math.round(Math.pow(y, 1.5) * 88);
      return { text: `${divNames[divIdx]}`, description: `FB: ${feedback}%` };
    }
    case "REVERB": {
      const damping = Math.round(16000 * Math.pow(500 / 16000, x));
      const level = Math.round(Math.pow(y, 0.8) * 120);
      return { text: `${damping}Hz`, description: `${level}%` };
    }
    case "FLANGER": {
      const rate = Math.round((0.05 * Math.pow(4 / 0.05, x)) * 100) / 100;
      const depth = Math.round(Math.min(1.0, y * 1.5) * 100);
      const hasFeedback = y > 0.3 ? "+" : "";
      return { text: `${rate}Hz${hasFeedback}`, description: `Depth: ${depth}%` };
    }
    case "CRUSH": {
      if (x < 0.4) {
        return { text: "TEL", description: `Drive: ${Math.round(Math.pow(y, 1.3) * 100)}%` };
      } else {
        return { text: "CRUSH", description: `Drive: ${Math.round(Math.pow(y, 1.3) * 100)}%` };
      }
    }
  }
}

// ─── FX Parameter Application ────────────────────────────

function applyFilter(target: FxTarget, type: BiquadFilterType, freq: number, q: number): void {
  const t = FX_TARGETS.find((t) => t.id === target);
  if (!t || target === "master") {
    audioEngine.setMasterFilter(type, freq, q);
  } else {
    for (const ch of t.channels) audioEngine.setChannelFilter(ch, type, freq, q);
  }
}

function releaseFilter(target: FxTarget): void {
  const t = FX_TARGETS.find((t) => t.id === target);
  if (!t || target === "master") {
    audioEngine.bypassMasterFilter();
  } else {
    for (const ch of t.channels) audioEngine.bypassChannelFilter(ch);
  }
}

// ─── FX Application ─────────────────────────────────────

function applyFxMode(mode: FxMode, x: number, y: number, target: FxTarget, bpm: number): void {
  switch (mode) {
    case "FILTER": {
      const q = 0.5 + y * 25;
      if (x < 0.5) {
        // Left half: LOWPASS sweep 20kHz → 80Hz
        const norm = 1 - x * 2;
        const freq = 80 * Math.pow(20000 / 80, 1 - norm);
        applyFilter(target, "lowpass", freq, q);
      } else {
        // Right half: HIGHPASS sweep 20Hz → 12kHz
        const norm = (x - 0.5) * 2;
        const freq = 20 * Math.pow(12000 / 20, norm);
        applyFilter(target, "highpass", freq, q);
      }
      break;
    }
    case "DELAY": {
      const beatSec = 60 / bpm;
      const divisions = [0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 1.0, 2.0];
      const divIdx = Math.min(divisions.length - 1, Math.floor(x * divisions.length));
      const time = Math.min(2.0, beatSec * divisions[divIdx]!);
      const feedback = Math.pow(y, 1.5) * 0.88;
      const filterFreq = 8000 - feedback * 5000;
      audioEngine.setDelayParams(time, feedback, filterFreq);
      audioEngine.setDelayLevel(0.3 + y * 0.5);
      break;
    }
    case "REVERB": {
      // X: bright↔dark damping
      const damping = 16000 * Math.pow(500 / 16000, x);
      audioEngine.setReverbDamping(damping);
      // Also adjust pre-delay for spatial effect
      audioEngine.setReverbPreDelay(x * 60);
      // Y: wet level with smooth curve
      const level = Math.pow(y, 0.8) * 1.2;
      audioEngine.setReverbLevel(Math.min(level, 1.5));
      break;
    }
    case "FLANGER": {
      // X = sweep rate: 0.05→4 Hz
      const rate = 0.05 * Math.pow(4 / 0.05, x);
      // Y = depth + feedback (bottom half depth, top half feedback)
      const depth = Math.min(1.0, y * 1.5);
      const feedback = y > 0.3 ? 0.3 + (y - 0.3) * 0.93 : 0.3;
      audioEngine.setFlangerParams(rate, depth, feedback);
      break;
    }
    case "CRUSH": {
      // X: left = telephone/bandpass, center = normal, right = bright
      if (x < 0.4) {
        // Telephone: bandpass 300-3kHz
        const bpFreq = 300 + (x / 0.4) * 2700;
        applyFilter(target, "bandpass", bpFreq, 2 + (0.4 - x) * 15);
      } else {
        // Low-pass with resonance peak
        const freq = 800 + ((x - 0.4) / 0.6) * 14000;
        applyFilter(target, "lowpass", freq, 1 + y * 6);
      }
      // Y = saturation/distortion intensity
      const drive = Math.pow(y, 1.3);
      audioEngine.setMasterSaturation(drive);
      break;
    }
  }
}

function activateFxMode(mode: FxMode, x: number, y: number, target: FxTarget, bpm: number): void {
  if (mode === "FLANGER") {
    const rate = 0.05 * Math.pow(4 / 0.05, x);
    const depth = Math.min(1.0, y * 1.5);
    const feedback = y > 0.3 ? 0.3 + (y - 0.3) * 0.93 : 0.3;
    audioEngine.startFlanger(rate, depth, feedback);
  }
  applyFxMode(mode, x, y, target, bpm);
}

function releaseFxMode(mode: FxMode, target: FxTarget): void {
  switch (mode) {
    case "FILTER":
      releaseFilter(target);
      break;
    case "DELAY":
      audioEngine.setDelayParams(0.375, 0.4, 4000);
      audioEngine.setDelayLevel(0.3);
      break;
    case "REVERB":
      audioEngine.setReverbLevel(0.35);
      audioEngine.setReverbDamping(8000);
      audioEngine.setReverbPreDelay(0);
      break;
    case "FLANGER":
      audioEngine.stopFlanger();
      break;
    case "CRUSH":
      releaseFilter(target);
      audioEngine.setMasterSaturation(0);
      break;
  }
}

// ─── Beat FX Definitions ─────────────────────────────────

interface BeatFx {
  label: string;
  color: string;
  activate: (bpm: number) => void;
  deactivate: (bpm: number) => void;
  _savedGain?: number;
  _sweepTimer?: ReturnType<typeof setInterval> | null;
  _divIndex?: number;
}

function createBeatFxList(): BeatFx[] {
  return [
    {
      label: "ROLL",
      color: "#f59e0b",
      _divIndex: 0,
      activate: function (bpm: number) {
        const divisions = [2, 4, 8];
        const rate = (bpm / 60) * divisions[this._divIndex! % divisions.length]!;
        this._divIndex = (this._divIndex ?? 0) + 1;
        audioEngine.startStutter(rate);
      },
      deactivate: () => {
        audioEngine.stopStutter();
      },
    },
    {
      label: "BRAKE",
      color: "#ef4444",
      _savedGain: 0.85,
      activate: function (bpm: number) {
        const masterGain = audioEngine.getMasterGainNode();
        if (masterGain) {
          this._savedGain = masterGain.gain.value;
          const now = audioEngine.currentTime;
          const rampTime = (60 / bpm) * 8;
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(masterGain.gain.value, now);
          masterGain.gain.exponentialRampToValueAtTime(0.01, now + rampTime);
        }
      },
      deactivate: function () {
        const masterGain = audioEngine.getMasterGainNode();
        if (masterGain) {
          const now = audioEngine.currentTime;
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(masterGain.gain.value, now);
          masterGain.gain.linearRampToValueAtTime(this._savedGain ?? 0.85, now + 0.3);
        }
      },
    },
    {
      label: "BUILD",
      color: "#06b6d4",
      _sweepTimer: null,
      activate: function (bpm: number) {
        audioEngine.startNoise(0.3);
        audioEngine.setMasterFilter("highpass", 200, 2);
        const sweepDuration = (60 / bpm) * 16;
        let filterFreq = 200;
        const step = (8000 - 200) / (sweepDuration * 10);
        this._sweepTimer = setInterval(() => {
          filterFreq = Math.min(8000, filterFreq + step);
          const q = 2 + (filterFreq / 8000) * 8;
          audioEngine.setMasterFilter("highpass", filterFreq, q);
        }, 100);
      },
      deactivate: function () {
        if (this._sweepTimer) {
          clearInterval(this._sweepTimer);
          this._sweepTimer = null;
        }
        audioEngine.stopNoise();
        audioEngine.bypassMasterFilter();
      },
    },
    {
      label: "NOISE",
      color: "#ffffff",
      activate: () => {
        audioEngine.startNoise(0.3);
      },
      deactivate: () => {
        audioEngine.stopNoise();
      },
    },
    {
      label: "TAPE",
      color: "#a855f7",
      _savedGain: 0.85,
      activate: function (bpm: number) {
        const masterGain = audioEngine.getMasterGainNode();
        if (masterGain) {
          this._savedGain = masterGain.gain.value;
          const now = audioEngine.currentTime;
          const stopTime = (60 / bpm) * 2;
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(this._savedGain, now);
          masterGain.gain.setTargetAtTime(0.02, now, stopTime * 0.3);
        }
      },
      deactivate: function () {
        const masterGain = audioEngine.getMasterGainNode();
        if (masterGain) {
          const now = audioEngine.currentTime;
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(masterGain.gain.value, now);
          masterGain.gain.linearRampToValueAtTime(this._savedGain ?? 0.85, now + 0.15);
        }
      },
    },
    {
      label: "ECHO",
      color: "#3b82f6",
      activate: (bpm: number) => {
        const beatSec = 60 / bpm;
        audioEngine.setDelayLevel(0.9);
        audioEngine.setDelayParams(beatSec * 0.75, 0.8, 5000);
      },
      deactivate: () => {
        audioEngine.setDelayLevel(0.3);
        audioEngine.setDelayParams(0.375, 0.4, 4000);
      },
    },
  ];
}

// ─── Component ───────────────────────────────────────────

export function FxPanel({ isOpen, onClose }: FxPanelProps) {
  const bpm = useDrumStore((s) => s.bpm);

  const [activeMode, setActiveMode] = useState<FxMode>("FILTER");
  const [fxTarget, setFxTarget] = useState<FxTarget>("master");
  const [padActive, setPadActive] = useState(false);
  const [holdMode, setHoldMode] = useState(false);
  const [holdLocked, setHoldLocked] = useState(false);
  const [padX, setPadX] = useState(0.5);
  const [padY, setPadY] = useState(0.5);
  const [activeBeatFx, setActiveBeatFx] = useState<Set<number>>(new Set());

  const padRef = useRef<HTMLDivElement>(null);
  const beatFxListRef = useRef(createBeatFxList());

  // ─── XY Pad Handlers ────────────────────────────────

  const calcXY = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0.5, y: 0.5 };
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    return { x, y };
  }, []);

  const handlePadDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setPadActive(true);
      const { x, y } = calcXY(e);
      setPadX(x);
      setPadY(y);
      activateFxMode(activeMode, x, y, fxTarget, bpm);
    },
    [activeMode, fxTarget, bpm, calcXY]
  );

  const handlePadMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!padActive) return;
      const { x, y } = calcXY(e);
      setPadX(x);
      setPadY(y);
      applyFxMode(activeMode, x, y, fxTarget, bpm);
    },
    [padActive, activeMode, fxTarget, bpm, calcXY]
  );

  const handlePadUp = useCallback(() => {
    setPadActive(false);
    if (holdMode) {
      setHoldLocked(true);
    } else {
      releaseFxMode(activeMode, fxTarget);
    }
  }, [activeMode, fxTarget, holdMode]);

  const releaseHold = useCallback(() => {
    setHoldLocked(false);
    releaseFxMode(activeMode, fxTarget);
  }, [activeMode, fxTarget]);

  // ─── Beat FX Handlers ───────────────────────────────

  const handleBeatFxDown = useCallback(
    (index: number) => {
      beatFxListRef.current[index]?.activate(bpm);
      setActiveBeatFx((prev) => {
        const next = new Set(prev);
        next.add(index);
        return next;
      });
    },
    [bpm]
  );

  const handleBeatFxUp = useCallback(
    (index: number) => {
      beatFxListRef.current[index]?.deactivate(bpm);
      setActiveBeatFx((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    },
    [bpm]
  );

  // ─── Render ─────────────────────────────────────────

  if (!isOpen) return null;

  const modeConfig = MODE_CONFIG[activeMode];
  const modeColor = modeConfig.color;
  const musicalValue = getMusicalValue(activeMode, padX, padY, bpm);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#08080a]">
      {/* Header */}
      <div className="flex items-center h-10 px-4 border-b border-[var(--ed-border)]">
        {/* Left: Title */}
        <span className="font-bold text-sm tracking-wider text-[var(--ed-text-primary)]">
          FX PAD
        </span>

        {/* Center: Mode buttons */}
        <div className="flex-1 flex items-center justify-center gap-1">
          {FX_MODES.map((mode) => {
            const cfg = MODE_CONFIG[mode];
            const isActive = activeMode === mode;
            return (
              <button
                key={mode}
                onClick={() => {
                  if (holdLocked) releaseHold();
                  setActiveMode(mode);
                }}
                className="px-3 py-1 rounded text-xs font-bold tracking-wider transition-all"
                style={{
                  backgroundColor: isActive ? cfg.color : "transparent",
                  color: isActive ? "#000" : cfg.color,
                  border: `1px solid ${isActive ? cfg.color : cfg.color + "40"}`,
                }}
              >
                {mode}
              </button>
            );
          })}
        </div>

        {/* Right: Hold + Close */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (holdMode && holdLocked) releaseHold();
              setHoldMode(!holdMode);
            }}
            className="px-3 py-1 rounded text-xs font-bold tracking-wider transition-all"
            style={{
              backgroundColor: holdMode ? (holdLocked ? modeColor : "#ffffff20") : "transparent",
              color: holdMode ? (holdLocked ? "#000" : "#fff") : "rgba(255,255,255,0.35)",
              border: `1px solid ${holdMode ? (holdLocked ? modeColor : "rgba(255,255,255,0.3)") : "rgba(255,255,255,0.1)"}`,
              boxShadow: holdLocked ? `0 0 12px ${modeColor}40` : "none",
            }}
          >
            HOLD
          </button>
          <button
            onClick={() => {
              if (holdLocked) releaseHold();
              onClose();
            }}
            className="text-xs font-bold tracking-wider text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] transition-colors"
          >
            ← BACK
          </button>
        </div>
      </div>

      {/* Target selector */}
      <div className="flex items-center h-8 px-4 border-b border-[var(--ed-border)]/50 gap-1">
        <span className="text-[8px] font-bold text-white/25 tracking-wider mr-2">TARGET</span>
        {FX_TARGETS.map((t) => (
          <button
            key={t.id}
            onClick={() => setFxTarget(t.id)}
            className={`px-2.5 py-0.5 text-[9px] font-bold tracking-wider rounded transition-all ${
              fxTarget === t.id
                ? "bg-white/10 text-white border border-white/20"
                : "text-white/30 hover:text-white/60 border border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: XY Pad */}
        <div className="flex-1 flex flex-col p-4 min-w-0">
          <div className="relative flex-1 flex">
            {/* Y-axis label */}
            <div className="flex items-center justify-center w-6 shrink-0">
              <span
                className="text-[10px] font-bold tracking-wider whitespace-nowrap"
                style={{
                  color: modeColor + "80",
                  writingMode: "vertical-lr",
                  transform: "rotate(180deg)",
                }}
              >
                Y: {modeConfig.yLabel}
              </span>
            </div>

            {/* Pad area */}
            <div
              ref={padRef}
              onPointerDown={handlePadDown}
              onPointerMove={handlePadMove}
              onPointerUp={handlePadUp}
              onPointerCancel={handlePadUp}
              className="relative flex-1 bg-[#0a0a0e] border rounded-xl cursor-crosshair touch-none overflow-hidden select-none transition-all duration-150"
              style={{
                borderColor: padActive ? modeColor + "60" : "rgba(255,255,255,0.1)",
                boxShadow: padActive ? `inset 0 0 60px ${modeColor}08, 0 0 20px ${modeColor}15` : "none",
              }}
            >
              {/* Grid lines */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
                {/* Vertical grid lines */}
                {[0.25, 0.5, 0.75].map((pos) => (
                  <line
                    key={`v-${pos}`}
                    x1={`${pos * 100}%`}
                    y1="0"
                    x2={`${pos * 100}%`}
                    y2="100%"
                    stroke="white"
                    strokeOpacity="0.05"
                    strokeWidth="1"
                  />
                ))}
                {/* Horizontal grid lines */}
                {[0.25, 0.5, 0.75].map((pos) => (
                  <line
                    key={`h-${pos}`}
                    x1="0"
                    y1={`${pos * 100}%`}
                    x2="100%"
                    y2={`${pos * 100}%`}
                    stroke="white"
                    strokeOpacity="0.05"
                    strokeWidth="1"
                  />
                ))}
                {/* Center crosshair */}
                <line x1="50%" y1="0" x2="50%" y2="100%" stroke="white" strokeOpacity="0.08" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="0" y1="50%" x2="100%" y2="50%" stroke="white" strokeOpacity="0.08" strokeWidth="1" strokeDasharray="4 4" />

                {/* Mode-specific zone lines */}
                {activeMode === "FILTER" && (
                  <line x1="50%" y1="0" x2="50%" y2="100%" stroke={modeColor} strokeOpacity="0.15" strokeWidth="2" />
                )}
                {activeMode === "DELAY" && (
                  <>
                    {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <line
                        key={`delay-${i}`}
                        x1={`${(i / 8) * 100}%`}
                        y1="0"
                        x2={`${(i / 8) * 100}%`}
                        y2="100%"
                        stroke={modeColor}
                        strokeOpacity="0.1"
                        strokeWidth="1"
                      />
                    ))}
                  </>
                )}
                {activeMode === "CRUSH" && (
                  <line x1="40%" y1="0" x2="40%" y2="100%" stroke={modeColor} strokeOpacity="0.15" strokeWidth="2" />
                )}
              </svg>

              {/* Crosshair guide lines at dot position (only when active) */}
              {padActive && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  <line
                    x1={`${padX * 100}%`}
                    y1="0"
                    x2={`${padX * 100}%`}
                    y2="100%"
                    stroke={modeColor}
                    strokeOpacity="0.15"
                    strokeWidth="1"
                  />
                  <line
                    x1="0"
                    y1={`${(1 - padY) * 100}%`}
                    x2="100%"
                    y2={`${(1 - padY) * 100}%`}
                    stroke={modeColor}
                    strokeOpacity="0.15"
                    strokeWidth="1"
                  />
                </svg>
              )}

              {/* Glow halo (large, behind dot) */}
              {padActive && (
                <div
                  className="absolute w-24 h-24 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  style={{
                    left: `${padX * 100}%`,
                    top: `${(1 - padY) * 100}%`,
                    background: `radial-gradient(circle, ${modeColor}30 0%, transparent 70%)`,
                  }}
                />
              )}

              {/* Glowing dot */}
              <div
                className="absolute w-6 h-6 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-150"
                style={{
                  left: `${padX * 100}%`,
                  top: `${(1 - padY) * 100}%`,
                  backgroundColor: modeColor,
                  boxShadow: padActive
                    ? `0 0 20px ${modeColor}, 0 0 40px ${modeColor}80, 0 0 80px ${modeColor}30`
                    : `0 0 8px ${modeColor}60`,
                  opacity: padActive ? 1 : 0.4,
                }}
              />

              {/* Musical value readout (top-right overlay) */}
              {padActive && (
                <div
                  className="absolute top-3 right-3 text-[10px] font-mono pointer-events-none text-center"
                  style={{ color: modeColor + "cc" }}
                >
                  <div className="font-bold">{musicalValue.text}</div>
                  <div className="text-[9px] opacity-75">{musicalValue.description}</div>
                </div>
              )}
            </div>
          </div>

          {/* X-axis label */}
          <div className="flex justify-center mt-2 ml-6">
            <span
              className="text-[10px] font-bold tracking-wider"
              style={{ color: modeColor + "80" }}
            >
              X: {modeConfig.xLabel}
            </span>
          </div>
        </div>

        {/* Right: Beat FX Buttons */}
        <div className="w-48 flex flex-col p-4 pl-0">
          <div className="text-[10px] font-bold tracking-wider text-[var(--ed-text-muted)] mb-2 text-center">
            BEAT FX
          </div>
          <div className="grid grid-cols-2 gap-2 flex-1 content-start">
            {beatFxListRef.current.map((fx, index) => {
              const isActive = activeBeatFx.has(index);
              return (
                <button
                  key={fx.label}
                  onPointerDown={() => handleBeatFxDown(index)}
                  onPointerUp={() => handleBeatFxUp(index)}
                  onPointerLeave={() => {
                    if (activeBeatFx.has(index)) handleBeatFxUp(index);
                  }}
                  className="h-16 rounded-xl font-bold text-sm tracking-wider transition-all select-none touch-none"
                  style={{
                    backgroundColor: isActive ? fx.color : "#141418",
                    color: isActive ? "#000" : fx.color + "90",
                    border: `1px solid ${isActive ? fx.color : fx.color + "30"}`,
                    boxShadow: isActive ? `0 0 20px ${fx.color}40` : "none",
                  }}
                >
                  {fx.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
