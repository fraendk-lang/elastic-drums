/**
 * FxPanel — Fullscreen Performance FX Overlay
 *
 * Kaoss Pad-style XY controller + Beat FX buttons.
 * Completely rewritten with musical parameter mapping, BPM sync, and proper audio algorithms.
 */

import { useState, useCallback, useRef } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { useDrumStore } from "../store/drumStore";
import { motionRecorder, type MotionRecording } from "../audio/MotionRecorder";

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

// Compact SVG icons — each tells you at a glance what the FX does
function ModeIcon({ mode, color }: { mode: FxMode; color: string }) {
  const stroke = color;
  const strokeWidth = 1.6;
  const common = { fill: "none", stroke, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (mode) {
    case "FILTER": // Lowpass curve rolling off on the right
      return (
        <svg viewBox="0 0 28 14" className="w-5 h-[12px]" aria-hidden>
          <path d="M 1 7 L 13 7 Q 17 7 19 4 T 27 13" {...common} />
        </svg>
      );
    case "DELAY": // Repeating echoes — decreasing amplitude
      return (
        <svg viewBox="0 0 28 14" className="w-5 h-[12px]" aria-hidden>
          <line x1="3" y1="3" x2="3" y2="11" {...common} />
          <line x1="10" y1="4" x2="10" y2="10" {...common} />
          <line x1="16" y1="5" x2="16" y2="9" {...common} />
          <line x1="21" y1="6" x2="21" y2="8" {...common} />
          <line x1="25" y1="6.5" x2="25" y2="7.5" {...common} />
        </svg>
      );
    case "REVERB": // Exponential decay curve
      return (
        <svg viewBox="0 0 28 14" className="w-5 h-[12px]" aria-hidden>
          <path d="M 2 11 Q 2 2 4 2 L 26 11" {...common} />
          <path d="M 6 11 Q 6 6 8 6" {...common} opacity="0.5" />
        </svg>
      );
    case "FLANGER": // Zig-zag comb-sweep
      return (
        <svg viewBox="0 0 28 14" className="w-5 h-[12px]" aria-hidden>
          <path d="M 2 7 Q 5 2 8 7 T 14 7 T 20 7 T 26 7" {...common} />
        </svg>
      );
    case "CRUSH": // Stepped staircase (bit reduction)
      return (
        <svg viewBox="0 0 28 14" className="w-5 h-[12px]" aria-hidden>
          <path d="M 1 11 L 5 11 L 5 8 L 11 8 L 11 5 L 17 5 L 17 8 L 23 8 L 23 11 L 27 11" {...common} />
        </svg>
      );
  }
}

const FX_MODES: FxMode[] = ["FILTER", "DELAY", "REVERB", "FLANGER", "CRUSH"];

const FX_MODE_PRESETS: Record<FxMode, { label: string; x: number; y: number }[]> = {
  FILTER: [
    { label: "Warm LP", x: 0.18, y: 0.42 },
    { label: "Sweep Peak", x: 0.48, y: 0.84 },
    { label: "Thin HP", x: 0.82, y: 0.38 },
  ],
  DELAY: [
    { label: "Dub 1/8", x: 0.56, y: 0.64 },
    { label: "Ping 1/4", x: 0.82, y: 0.55 },
    { label: "Tight Slap", x: 0.24, y: 0.28 },
  ],
  REVERB: [
    { label: "Wide Hall", x: 0.32, y: 0.8 },
    { label: "Dark Wash", x: 0.76, y: 0.72 },
    { label: "Short Room", x: 0.18, y: 0.3 },
  ],
  FLANGER: [
    { label: "Slow Jet", x: 0.22, y: 0.6 },
    { label: "Fast Metal", x: 0.84, y: 0.88 },
    { label: "Soft Chorus", x: 0.34, y: 0.36 },
  ],
  CRUSH: [
    { label: "Telephone", x: 0.2, y: 0.48 },
    { label: "Dusty Drive", x: 0.62, y: 0.54 },
    { label: "Hard Smash", x: 0.88, y: 0.92 },
  ],
};

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
  const [isRecording, setIsRecording] = useState(false);
  const [isPlayingMotion, setIsPlayingMotion] = useState(false);
  const [recordings, setRecordings] = useState<MotionRecording[]>([]);

  const padRef = useRef<HTMLDivElement>(null);
  const beatFxListRef = useRef(createBeatFxList());

  const applyPadState = useCallback((x: number, y: number, latch = false) => {
    setPadX(x);
    setPadY(y);
    activateFxMode(activeMode, x, y, fxTarget, bpm);
    if (latch) {
      setHoldMode(true);
      setHoldLocked(true);
    }
  }, [activeMode, bpm, fxTarget]);

  const resetFxState = useCallback(() => {
    releaseFxMode(activeMode, fxTarget);
    beatFxListRef.current.forEach((fx, index) => {
      if (activeBeatFx.has(index)) fx.deactivate(bpm);
    });
    motionRecorder.stopPlayback();
    setIsPlayingMotion(false);
    setActiveBeatFx(new Set());
    setPadActive(false);
    setHoldLocked(false);
    setHoldMode(false);
    setPadX(0.5);
    setPadY(0.5);
  }, [activeBeatFx, activeMode, bpm, fxTarget]);

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
      // Record motion if recording is active
      if (isRecording) {
        motionRecorder.addPoint(x, y);
      }
    },
    [padActive, activeMode, fxTarget, bpm, calcXY, isRecording]
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

        {/* Center: Mode tiles with icons */}
        <div className="flex-1 flex items-center justify-center gap-1.5">
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
                className="group relative flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[10px] font-black tracking-[0.14em] transition-all overflow-hidden"
                style={{
                  backgroundColor: isActive
                    ? `${cfg.color}`
                    : "rgba(255,255,255,0.025)",
                  color: isActive ? "#000" : cfg.color,
                  border: `1px solid ${isActive ? cfg.color : cfg.color + "30"}`,
                  boxShadow: isActive
                    ? `0 0 16px ${cfg.color}55, inset 0 0 12px rgba(255,255,255,0.15)`
                    : "inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                {/* Subtle shimmer on active */}
                {isActive && (
                  <span
                    className="absolute inset-0 opacity-30 pointer-events-none"
                    style={{
                      background: "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%)",
                    }}
                  />
                )}
                <ModeIcon mode={mode} color={isActive ? "#000" : cfg.color} />
                <span>{mode}</span>
              </button>
            );
          })}
        </div>

        {/* Right: REC + HOLD + Close */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (isRecording) {
                const rec = motionRecorder.stopRecording(activeMode, fxTarget, bpm);
                setIsRecording(false);
                if (rec) setRecordings(motionRecorder.allRecordings);
              } else {
                motionRecorder.startRecording();
                setIsRecording(true);
              }
            }}
            style={{
              backgroundColor: isRecording ? "#ef4444" : "transparent",
              color: isRecording ? "#fff" : "rgba(255,255,255,0.35)",
              border: `1px solid ${isRecording ? "#ef4444" : "rgba(255,255,255,0.1)"}`,
            }}
            className="px-3 py-1 rounded text-xs font-bold tracking-wider transition-all"
          >
            {isRecording ? "● STOP" : "REC"}
          </button>
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
            onClick={resetFxState}
            className="px-3 py-1 rounded text-xs font-bold tracking-wider text-[var(--ed-text-muted)] border border-white/10 hover:text-[var(--ed-text-primary)] hover:bg-white/5 transition-colors"
          >
            RESET
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
        {/* XY Pad */}
        <div className="flex-1 flex flex-col p-3 min-w-0">
          {/* Parameter display — always visible */}
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-bold tracking-wider" style={{ color: modeColor + "90" }}>
                X: {modeConfig.xLabel}
              </span>
              <span className="text-[9px] font-bold tracking-wider" style={{ color: modeColor + "90" }}>
                Y: {modeConfig.yLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 text-right">
              <span className="text-sm font-black font-mono tracking-wider" style={{ color: modeColor, textShadow: `0 0 20px ${modeColor}60` }}>
                {musicalValue.text}
              </span>
              <span className="text-[10px] font-medium" style={{ color: modeColor + "80" }}>
                {musicalValue.description}
              </span>
              {recordings.length > 0 && (
                <button
                  onClick={() => {
                    if (isPlayingMotion) {
                      motionRecorder.stopPlayback();
                      setIsPlayingMotion(false);
                      releaseFxMode(activeMode, fxTarget);
                    } else {
                      const lastRec = recordings[recordings.length - 1]!;
                      // First activate the FX mode
                      activateFxMode(lastRec.mode as FxMode, 0.5, 0.5, lastRec.target as FxTarget, bpm);
                      motionRecorder.startPlayback(lastRec, (x, y) => {
                        setPadX(x);
                        setPadY(y);
                        applyFxMode(lastRec.mode as FxMode, x, y, lastRec.target as FxTarget, bpm);
                      });
                      setIsPlayingMotion(true);
                    }
                  }}
                  className="px-3 py-1 rounded text-xs font-bold tracking-wider transition-all"
                  style={{
                    backgroundColor: isPlayingMotion ? "#10b981" : "transparent",
                    color: isPlayingMotion ? "#000" : "#10b981",
                    border: `1px solid ${isPlayingMotion ? "#10b981" : "#10b98140"}`,
                  }}
                >
                  {isPlayingMotion ? "■ STOP" : "▶ PLAY"}
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3 px-1">
            {FX_MODE_PRESETS[activeMode].map((preset) => (
              <button
                key={preset.label}
                onClick={() => applyPadState(preset.x, preset.y, true)}
                className="px-3 py-1.5 rounded-full text-[10px] font-bold tracking-[0.14em] border transition-colors"
                style={{
                  color: modeColor,
                  borderColor: `${modeColor}35`,
                  backgroundColor: `${modeColor}10`,
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Pad area */}
          <div
            ref={padRef}
            onPointerDown={handlePadDown}
            onPointerMove={handlePadMove}
            onPointerUp={handlePadUp}
            onPointerCancel={handlePadUp}
            className="relative flex-1 rounded-xl cursor-crosshair touch-none overflow-hidden select-none"
            style={{
              background: padActive
                ? `radial-gradient(ellipse at ${padX * 100}% ${(1 - padY) * 100}%, ${modeColor}12 0%, #0a0a0e 60%)`
                : `linear-gradient(180deg, #0e0e14 0%, #08080c 100%)`,
              border: `2px solid ${padActive ? modeColor + "50" : modeColor + "18"}`,
              boxShadow: padActive
                ? `inset 0 0 120px ${modeColor}10, 0 0 30px ${modeColor}15, inset 0 0 40px ${modeColor}08`
                : `inset 0 0 60px rgba(0,0,0,0.5)`,
              transition: "border-color 0.15s, box-shadow 0.3s",
            }}
          >
            {/* Background grid — more visible */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
              {/* 8×8 fine grid */}
              {[0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map((pos) => (
                <line key={`v-${pos}`} x1={`${pos * 100}%`} y1="0" x2={`${pos * 100}%`} y2="100%" stroke={modeColor} strokeOpacity="0.06" strokeWidth="1" />
              ))}
              {[0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map((pos) => (
                <line key={`h-${pos}`} x1="0" y1={`${pos * 100}%`} x2="100%" y2={`${pos * 100}%`} stroke={modeColor} strokeOpacity="0.06" strokeWidth="1" />
              ))}
              {/* Center crosshair — brighter */}
              <line x1="50%" y1="0" x2="50%" y2="100%" stroke={modeColor} strokeOpacity="0.12" strokeWidth="1" strokeDasharray="6 4" />
              <line x1="0" y1="50%" x2="100%" y2="50%" stroke={modeColor} strokeOpacity="0.12" strokeWidth="1" strokeDasharray="6 4" />

              {/* Mode-specific zones */}
              {activeMode === "FILTER" && <>
                <line x1="50%" y1="0" x2="50%" y2="100%" stroke={modeColor} strokeOpacity="0.3" strokeWidth="2" />
                <text x="20%" y="95%" fill={modeColor} fillOpacity="0.2" fontSize="11" fontWeight="bold" textAnchor="middle">LP</text>
                <text x="80%" y="95%" fill={modeColor} fillOpacity="0.2" fontSize="11" fontWeight="bold" textAnchor="middle">HP</text>
              </>}
              {activeMode === "DELAY" && <>
                {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <line key={`d-${i}`} x1={`${(i / 8) * 100}%`} y1="0" x2={`${(i / 8) * 100}%`} y2="100%" stroke={modeColor} strokeOpacity="0.12" strokeWidth="1" strokeDasharray="3 5" />
                ))}
                {["1/32", "1/16T", "1/16", "1/8T", "1/8", "1/4T", "1/4", "1/2"].map((label, i) => (
                  <text key={label} x={`${(i + 0.5) / 8 * 100}%`} y="97%" fill={modeColor} fillOpacity="0.15" fontSize="8" fontWeight="bold" textAnchor="middle">{label}</text>
                ))}
              </>}
              {activeMode === "CRUSH" && <>
                <line x1="40%" y1="0" x2="40%" y2="100%" stroke={modeColor} strokeOpacity="0.3" strokeWidth="2" />
                <text x="20%" y="95%" fill={modeColor} fillOpacity="0.2" fontSize="10" fontWeight="bold" textAnchor="middle">TEL</text>
                <text x="70%" y="95%" fill={modeColor} fillOpacity="0.2" fontSize="10" fontWeight="bold" textAnchor="middle">CRUSH</text>
              </>}
            </svg>

            {/* Active crosshair lines — brighter, thicker */}
            {(padActive || holdLocked) && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <line x1={`${padX * 100}%`} y1="0" x2={`${padX * 100}%`} y2="100%" stroke={modeColor} strokeOpacity="0.3" strokeWidth="1" />
                <line x1="0" y1={`${(1 - padY) * 100}%`} x2="100%" y2={`${(1 - padY) * 100}%`} stroke={modeColor} strokeOpacity="0.3" strokeWidth="1" />
              </svg>
            )}

            {/* Outer glow halo — MUCH bigger */}
            {padActive && (
              <div className="absolute rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{
                left: `${padX * 100}%`, top: `${(1 - padY) * 100}%`,
                width: "240px", height: "240px",
                background: `radial-gradient(circle, ${modeColor}20 0%, ${modeColor}08 40%, transparent 70%)`,
              }} />
            )}

            {/* Inner glow ring */}
            {(padActive || holdLocked) && (
              <div className="absolute rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{
                left: `${padX * 100}%`, top: `${(1 - padY) * 100}%`,
                width: "80px", height: "80px",
                background: `radial-gradient(circle, ${modeColor}35 0%, ${modeColor}15 50%, transparent 100%)`,
              }} />
            )}

            {/* Main dot — BIGGER, more glow */}
            <div className="absolute rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{
              left: `${padX * 100}%`, top: `${(1 - padY) * 100}%`,
              width: padActive ? "36px" : "20px", height: padActive ? "36px" : "20px",
              backgroundColor: modeColor,
              boxShadow: padActive
                ? `0 0 30px ${modeColor}, 0 0 60px ${modeColor}90, 0 0 120px ${modeColor}40, inset 0 0 8px rgba(255,255,255,0.3)`
                : holdLocked
                  ? `0 0 20px ${modeColor}80, 0 0 40px ${modeColor}40`
                  : `0 0 10px ${modeColor}50`,
              opacity: padActive ? 1 : holdLocked ? 0.8 : 0.35,
              transition: "width 0.1s, height 0.1s, opacity 0.15s",
            }} />

            {/* Center bright spot on dot */}
            {padActive && (
              <div className="absolute rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{
                left: `${padX * 100}%`, top: `${(1 - padY) * 100}%`,
                width: "12px", height: "12px",
                backgroundColor: "white",
                opacity: 0.6,
                filter: "blur(2px)",
              }} />
            )}

            {/* "Touch to engage" hint when idle */}
            {!padActive && !holdLocked && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[11px] font-bold tracking-[0.3em] uppercase" style={{ color: modeColor + "20" }}>
                  Touch to engage
                </span>
              </div>
            )}

            {/* Hold locked indicator */}
            {holdLocked && !padActive && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5 pointer-events-none">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: modeColor }} />
                <span className="text-[9px] font-bold tracking-wider" style={{ color: modeColor }}>HELD</span>
              </div>
            )}

            {/* Recording indicator — pulsing red border */}
            {isRecording && (
              <div
                className="absolute inset-0 rounded-xl pointer-events-none animate-pulse"
                style={{
                  border: "3px solid #ef4444",
                  boxShadow: "0 0 20px #ef444460, inset 0 0 20px #ef444415",
                }}
              />
            )}
          </div>
        </div>

        {/* Right: Beat FX Buttons — bigger, more dramatic */}
        <div className="w-52 flex flex-col p-3 pl-0 gap-2">
          <div className="rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/35 p-3 space-y-2">
            <div className="text-[9px] font-bold tracking-[0.2em] text-[var(--ed-text-muted)]">
              PERFORMANCE STATE
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--ed-text-muted)]">Mode</span>
              <span className="font-bold" style={{ color: modeColor }}>{activeMode}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--ed-text-muted)]">Target</span>
              <span className="font-bold text-[var(--ed-text-primary)]">{fxTarget.toUpperCase()}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--ed-text-muted)]">Hold</span>
              <span className={holdLocked ? "font-bold text-[var(--ed-accent-green)]" : "text-[var(--ed-text-muted)]"}>
                {holdLocked ? "Latched" : holdMode ? "Armed" : "Off"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--ed-text-muted)]">Motion</span>
              <span className={isRecording ? "font-bold text-[#ef4444]" : isPlayingMotion ? "font-bold text-[var(--ed-accent-green)]" : "text-[var(--ed-text-muted)]"}>
                {isRecording ? "Recording" : isPlayingMotion ? "Playing" : "Idle"}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-bg-surface)]/35 p-3 space-y-2">
            <div className="text-[9px] font-bold tracking-[0.2em] text-[var(--ed-text-muted)]">
              MACRO VALUES
            </div>
            <div className="text-[11px] text-[var(--ed-text-primary)] flex items-center justify-between">
              <span>X</span>
              <span className="font-mono">{Math.round(padX * 100)}%</span>
            </div>
            <div className="text-[11px] text-[var(--ed-text-primary)] flex items-center justify-between">
              <span>Y</span>
              <span className="font-mono">{Math.round(padY * 100)}%</span>
            </div>
            <div className="text-[10px] leading-4 text-[var(--ed-text-muted)]">
              Presets above drop the pad into musical sweet spots and latch them automatically.
            </div>
          </div>

          <div className="text-[9px] font-bold tracking-[0.2em] text-[var(--ed-text-muted)] text-center mb-1">
            BEAT FX
          </div>
          <div className="grid grid-cols-2 gap-2.5 flex-1 content-start">
            {beatFxListRef.current.map((fx, index) => {
              const isActive = activeBeatFx.has(index);
              return (
                <button
                  key={fx.label}
                  onPointerDown={() => handleBeatFxDown(index)}
                  onPointerUp={() => handleBeatFxUp(index)}
                  onPointerLeave={() => { if (activeBeatFx.has(index)) handleBeatFxUp(index); }}
                  className="rounded-xl font-black text-sm tracking-[0.15em] transition-all select-none touch-none"
                  style={{
                    height: "72px",
                    backgroundColor: isActive ? fx.color : "#111116",
                    color: isActive ? "#000" : fx.color,
                    border: `2px solid ${isActive ? fx.color : fx.color + "25"}`,
                    boxShadow: isActive
                      ? `0 0 30px ${fx.color}50, inset 0 0 20px rgba(255,255,255,0.1)`
                      : `inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -2px 0 rgba(0,0,0,0.3)`,
                    textShadow: isActive ? "none" : `0 0 12px ${fx.color}40`,
                    transform: isActive ? "scale(0.96)" : "scale(1)",
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
