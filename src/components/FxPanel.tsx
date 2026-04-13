/**
 * FxPanel — Fullscreen Performance FX Overlay
 *
 * Kaoss Pad-style XY controller + Beat FX buttons (Roll, Brake, Build, Noise, Stutter, Echo).
 * Inspired by Korg Kaoss Pad and Pioneer RMX-1000.
 */

import { useState, useCallback, useRef } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { useDrumStore } from "../store/drumStore";

// ─── Types ───────────────────────────────────────────────

type FxTarget = "master" | "drums" | "bass" | "chords" | "melody";

const FX_TARGETS: { id: FxTarget; label: string; channels: number[] }[] = [
  { id: "master", label: "MASTER", channels: [] }, // master = use setMasterFilter
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

// ─── Constants ───────────────────────────────────────────

const MODE_CONFIG: Record<FxMode, ModeConfig> = {
  FILTER:  { color: "#f59e0b", xLabel: "Cutoff",     yLabel: "Resonance" },
  DELAY:   { color: "#3b82f6", xLabel: "Time",        yLabel: "Feedback" },
  REVERB:  { color: "#8b5cf6", xLabel: "Size",        yLabel: "Level" },
  FLANGER: { color: "#06b6d4", xLabel: "Rate",        yLabel: "Depth" },
  CRUSH:   { color: "#ef4444", xLabel: "Cutoff",      yLabel: "Drive" },
};

const FX_MODES: FxMode[] = ["FILTER", "DELAY", "REVERB", "FLANGER", "CRUSH"];

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

// Store original values for clean release
let _savedDelayFB = 0.4;
let _savedDelayLevel = 0.3;
let _savedSaturation = 0;

function applyFxMode(mode: FxMode, x: number, y: number, target: FxTarget): void {
  switch (mode) {
    case "FILTER": {
      // X = cutoff sweep: left half = lowpass, right half = highpass (DJ-style isolator)
      const q = y * 30;
      const type: BiquadFilterType = x < 0.5 ? "lowpass" : "highpass";
      const mappedFreq = x < 0.5
        ? 100 * Math.pow(15000 / 100, x * 2)       // LP: sweep 100→15kHz
        : 20 + Math.pow(15000, (x - 0.5) * 2);     // HP: sweep 20→15kHz
      applyFilter(target, type, mappedFreq, q);
      break;
    }
    case "DELAY": {
      // X = delay time synced to divisions, Y = feedback (0–0.92) + auto wet boost
      const time = 0.05 + x * 0.95;
      const feedback = y * 0.92;
      audioEngine.setDelayParams(time, feedback, 2000 + x * 6000);
      audioEngine.setDelayLevel(0.4 + y * 0.6);
      break;
    }
    case "REVERB": {
      // X = reverb damping (bright→dark), Y = level (0–1.0)
      // NO IR regeneration — only damping filter + wet level
      audioEngine.setReverbDamping(16000 - x * 15000); // X left = bright, right = dark
      audioEngine.setReverbLevel(y);                    // Y up = more reverb
      break;
    }
    case "FLANGER": {
      // DEDICATED FLANGER: X = sweep rate (0.1–8 Hz), Y = depth + feedback
      const rate = 0.1 + x * 7.9;     // Sweep speed
      const depth = y;                  // Sweep depth
      const feedback = 0.3 + y * 0.6;  // More depth = more resonance
      audioEngine.setFlangerParams(rate, depth, feedback);
      break;
    }
    case "CRUSH": {
      // X = cutoff (dark→bright), Y = saturation drive
      const cutoff = 150 + x * 3000;
      const sat = y;
      applyFilter(target, "lowpass", cutoff, 3 + y * 8);
      audioEngine.setMasterSaturation(sat);
      break;
    }
  }
}

function activateFxMode(mode: FxMode, x: number, y: number, target: FxTarget): void {
  // Called once on pad-down — set up the FX
  if (mode === "FLANGER") {
    const rate = 0.1 + x * 7.9;
    const depth = y;
    const feedback = 0.3 + y * 0.6;
    audioEngine.startFlanger(rate, depth, feedback);
  }
  applyFxMode(mode, x, y, target);
}

function releaseFxMode(mode: FxMode, target: FxTarget): void {
  switch (mode) {
    case "FILTER":
      releaseFilter(target);
      break;
    case "DELAY":
      audioEngine.setDelayParams(0.375, _savedDelayFB, 4000);
      audioEngine.setDelayLevel(_savedDelayLevel);
      break;
    case "REVERB":
      audioEngine.setReverbLevel(0.35);
      audioEngine.setReverbDamping(8000);
      break;
    case "FLANGER":
      audioEngine.stopFlanger(); // Clean release — no global delay affected!
      break;
    case "CRUSH":
      releaseFilter(target);
      audioEngine.setMasterSaturation(_savedSaturation);
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
}

function createBeatFxList(): BeatFx[] {
  return [
    {
      label: "ROLL",
      color: "#f59e0b",
      activate: (bpm: number) => {
        // 1/16 note rate at current BPM
        const rate = (bpm / 60) * 4;
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
      activate: function() {
        const masterGain = audioEngine.getMasterGainNode();
        if (masterGain) {
          this._savedGain = masterGain.gain.value; // Save current level
          const now = audioEngine.currentTime;
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(masterGain.gain.value, now);
          masterGain.gain.linearRampToValueAtTime(0.05, now + 2);
        }
      },
      deactivate: function() {
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
      _sweepTimer: null as ReturnType<typeof setInterval> | null,
      activate: function() {
        // Start noise at low volume — ramp up via filter sweep only (no stop/start glitches)
        audioEngine.startNoise(0.4);
        audioEngine.setMasterFilter("highpass", 200, 2);
        // Sweep highpass filter 200→8000 Hz over ~4 seconds (40 ticks × 100ms)
        let filterFreq = 200;
        this._sweepTimer = setInterval(() => {
          filterFreq = Math.min(8000, filterFreq + 200);
          audioEngine.setMasterFilter("highpass", filterFreq, 2 + filterFreq / 2000);
        }, 100);
      },
      deactivate: function() {
        if (this._sweepTimer) { clearInterval(this._sweepTimer); this._sweepTimer = null; }
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
      label: "STUTTER",
      color: "#a855f7",
      activate: () => {
        audioEngine.startStutter(4);
      },
      deactivate: () => {
        audioEngine.stopStutter();
      },
    },
    {
      label: "ECHO",
      color: "#3b82f6",
      activate: () => {
        audioEngine.setDelayLevel(1.0);
        audioEngine.setDelayParams(0.375, 0.85, 4000);
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
  const [holdMode, setHoldMode] = useState(false);   // Latch: keep FX active on pad release
  const [holdLocked, setHoldLocked] = useState(false); // True when effect is latched
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

  const handlePadDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setPadActive(true);
    const { x, y } = calcXY(e);
    setPadX(x);
    setPadY(y);
    activateFxMode(activeMode, x, y, fxTarget);
  }, [activeMode, fxTarget, calcXY]);

  const handlePadMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!padActive) return;
    const { x, y } = calcXY(e);
    setPadX(x);
    setPadY(y);
    applyFxMode(activeMode, x, y, fxTarget);
  }, [padActive, activeMode, fxTarget, calcXY]);

  const handlePadUp = useCallback(() => {
    setPadActive(false);
    if (holdMode) {
      // Latch: keep the effect active at current position
      setHoldLocked(true);
    } else {
      releaseFxMode(activeMode, fxTarget);
    }
  }, [activeMode, fxTarget, holdMode]);

  // Release held effect (when toggling hold off or switching modes)
  const releaseHold = useCallback(() => {
    setHoldLocked(false);
    releaseFxMode(activeMode, fxTarget);
  }, [activeMode, fxTarget]);

  // ─── Beat FX Handlers ───────────────────────────────

  const handleBeatFxDown = useCallback((index: number) => {
    beatFxListRef.current[index]?.activate(bpm);
    setActiveBeatFx((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, [bpm]);

  const handleBeatFxUp = useCallback((index: number) => {
    beatFxListRef.current[index]?.deactivate(bpm);
    setActiveBeatFx((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }, [bpm]);

  // ─── Render ─────────────────────────────────────────

  if (!isOpen) return null;

  const modeConfig = MODE_CONFIG[activeMode];
  const modeColor = modeConfig.color;

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
                  if (holdLocked) releaseHold(); // Release held effect when switching modes
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
              if (holdMode && holdLocked) releaseHold(); // Release when turning hold off
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
          <button key={t.id} onClick={() => setFxTarget(t.id)}
            className={`px-2.5 py-0.5 text-[9px] font-bold tracking-wider rounded transition-all ${
              fxTarget === t.id
                ? "bg-white/10 text-white border border-white/20"
                : "text-white/30 hover:text-white/60 border border-transparent"
            }`}>
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

              {/* XY value readout (only when active) */}
              {padActive && (
                <div
                  className="absolute top-3 right-3 text-[10px] font-mono pointer-events-none"
                  style={{ color: modeColor + "cc" }}
                >
                  X: {padX.toFixed(2)} &nbsp; Y: {padY.toFixed(2)}
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
