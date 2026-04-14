/**
 * FX Rack — Compact pedalboard-style effect modules
 * 7 hardware-inspired FX modules (Reverb, Delay, Filter, Drive, Sidechain, Chorus, Comp)
 * Each with 2 knobs and on/off toggle.
 */

import { useState, useCallback } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { Knob } from "./Knob";

// ─── Types ──────────────────────────────────────────────────────────

interface FxModuleDef {
  id: string;
  name: string;
  color: string;
  params: {
    id: string;
    label: string;
    min: number;
    max: number;
    default: number;
  }[];
}

interface FxModuleState {
  enabled: boolean;
  params: Record<string, number>;
}

interface FxRackProps {
  isOpen: boolean;
  onToggle: () => void;
}

// ─── Module Definitions ──────────────────────────────────────────────

const MODULE_DEFS: FxModuleDef[] = [
  {
    id: "reverb",
    name: "REVERB",
    color: "#8b5cf6",
    params: [
      { id: "level", label: "LVL", min: 0, max: 100, default: 35 },
      { id: "damping", label: "DMP", min: 0, max: 100, default: 60 },
    ],
  },
  {
    id: "delay",
    name: "DELAY",
    color: "#3b82f6",
    params: [
      { id: "time", label: "TIME", min: 0, max: 100, default: 50 },
      { id: "feedback", label: "FB", min: 0, max: 100, default: 40 },
    ],
  },
  {
    id: "filter",
    name: "FILTER",
    color: "#f59e0b",
    params: [
      { id: "cutoff", label: "CUT", min: 0, max: 100, default: 80 },
      { id: "resonance", label: "RES", min: 0, max: 100, default: 20 },
    ],
  },
  {
    id: "drive",
    name: "DRIVE",
    color: "#ef4444",
    params: [
      { id: "amount", label: "AMT", min: 0, max: 100, default: 0 },
      { id: "tone", label: "TONE", min: 0, max: 100, default: 50 },
    ],
  },
  {
    id: "sidechain",
    name: "SIDECHAIN",
    color: "#10b981",
    params: [
      { id: "amount", label: "AMT", min: 0, max: 100, default: 70 },
      { id: "release", label: "REL", min: 0, max: 100, default: 30 },
    ],
  },
  {
    id: "chorus",
    name: "CHORUS",
    color: "#06b6d4",
    params: [
      { id: "rate", label: "RATE", min: 0, max: 100, default: 30 },
      { id: "depth", label: "DEPTH", min: 0, max: 100, default: 40 },
    ],
  },
  {
    id: "comp",
    name: "COMP",
    color: "#ec4899",
    params: [
      { id: "threshold", label: "THR", min: 0, max: 100, default: 50 },
      { id: "ratio", label: "RAT", min: 0, max: 100, default: 40 },
    ],
  },
];

// ─── Helper: Apply FX Parameter Changes ──────────────────────────────

function applyFxParam(
  moduleId: string,
  paramId: string,
  value: number,
  enabled: boolean,
  allParams: Record<string, number>
) {
  if (!enabled) return; // Don't apply if module is disabled

  switch (moduleId) {
    case "reverb":
      if (paramId === "level") {
        audioEngine.setReverbLevel(value / 100);
      } else if (paramId === "damping") {
        // Map 0-100 to 500-16000 Hz
        const freq = 500 + (value / 100) * 15500;
        audioEngine.setReverbDamping(freq);
      }
      break;

    case "delay":
      if (paramId === "time" || paramId === "feedback") {
        // setDelayParams(time in sec, feedback 0-0.95, filterFreq)
        const time = (allParams.time ?? 50) / 100 * 3; // 0-3 sec
        const feedback = Math.min(0.95, (allParams.feedback ?? 40) / 100);
        audioEngine.setDelayParams(time, feedback, 8000);
      }
      break;

    case "filter":
      if (paramId === "cutoff" || paramId === "resonance") {
        // Map cutoff 0-100 to 80Hz-20kHz
        const cutoff = allParams.cutoff ?? 80;
        const resonance = allParams.resonance ?? 20;
        const freq = 80 * Math.pow(20000 / 80, cutoff / 100);
        const q = 0.5 + (resonance / 100) * 15; // 0.5 to 15.5
        audioEngine.setMasterFilter("lowpass", freq, q);
      }
      break;

    case "drive":
      if (paramId === "amount") {
        audioEngine.setMasterSaturation(value / 100);
      }
      // tone parameter doesn't directly map to an audioEngine method
      // but we could extend it later
      break;

    case "sidechain":
      if (paramId === "amount" || paramId === "release") {
        const amount = (allParams.amount ?? 70) / 100;
        const release = (allParams.release ?? 30) / 100 * 0.5; // 0-0.5 sec
        audioEngine.setSidechain(true, amount, release);
      }
      break;

    case "chorus":
      if (paramId === "rate" || paramId === "depth") {
        // Use flanger as chorus (slow sweep with moderate depth)
        const rate = 0.8 + (allParams.rate ?? 30) / 100 * 2; // 0.8-2.8 Hz
        const depth = (allParams.depth ?? 40) / 100 * 0.6; // 0-0.6
        const feedback = 0.3; // Fixed feedback for chorus effect
        audioEngine.setFlangerParams(rate, depth, feedback);
      }
      break;

    case "comp":
      if (paramId === "threshold" || paramId === "ratio") {
        // Threshold: -24 to -6 dB
        const thr = -24 + (allParams.threshold ?? 50) / 100 * 18;
        // Ratio: 1:1 to 16:1
        const rat = 1 + (allParams.ratio ?? 40) / 100 * 15;
        const attack = 0.01;
        const release = 0.15;
        const knee = 6;
        audioEngine.setMasterCompressor(thr, rat, attack, release, knee);
      }
      break;
  }
}

// ─── Helper: Toggle Module On/Off ───────────────────────────────────

function applyModuleToggle(
  id: string,
  enabled: boolean,
  params: Record<string, number>
) {
  switch (id) {
    case "reverb":
      audioEngine.setReverbLevel(enabled ? (params.level ?? 35) / 100 : 0);
      break;

    case "delay":
      audioEngine.setDelayLevel(enabled ? 0.5 : 0);
      break;

    case "filter":
      if (enabled) {
        const freq = 80 * Math.pow(20000 / 80, (params.cutoff ?? 80) / 100);
        const q = 0.5 + ((params.resonance ?? 20) / 100) * 15;
        audioEngine.setMasterFilter("lowpass", freq, q);
      } else {
        audioEngine.bypassMasterFilter();
      }
      break;

    case "drive":
      audioEngine.setMasterSaturation(enabled ? (params.amount ?? 0) / 100 : 0);
      break;

    case "sidechain":
      if (enabled) {
        const amount = (params.amount ?? 70) / 100;
        const release = (params.release ?? 30) / 100 * 0.5;
        audioEngine.setSidechain(true, amount, release);
      } else {
        audioEngine.setSidechain(false);
      }
      break;

    case "chorus":
      if (enabled) {
        const rate = 0.8 + (params.rate ?? 30) / 100 * 2;
        const depth = (params.depth ?? 40) / 100 * 0.6;
        audioEngine.setFlangerParams(rate, depth, 0.3);
      } else {
        audioEngine.stopFlanger();
      }
      break;

    case "comp":
      if (enabled) {
        const thr = -24 + (params.threshold ?? 50) / 100 * 18;
        const rat = 1 + (params.ratio ?? 40) / 100 * 15;
        audioEngine.setMasterCompressor(thr, rat, 0.01, 0.15, 6);
      } else {
        // Reset to neutral (soft compression)
        audioEngine.setMasterCompressor(-24, 1, 0.01, 0.15, 6);
      }
      break;
  }
}

// ─── Sub-Component: FxModuleCard ────────────────────────────────────

interface FxModuleCardProps {
  def: FxModuleDef;
  enabled: boolean;
  params: Record<string, number>;
  onToggle: () => void;
  onParamChange: (paramId: string, value: number) => void;
}

function FxModuleCard({
  def,
  enabled,
  params,
  onToggle,
  onParamChange,
}: FxModuleCardProps) {
  return (
    <div
      className="shrink-0 rounded-lg border p-2 flex flex-col items-center gap-1.5 transition-all"
      style={{
        width: 130,
        backgroundColor: enabled ? `${def.color}08` : "#111116",
        borderColor: enabled ? `${def.color}30` : "rgba(255,255,255,0.05)",
      }}
    >
      {/* Module name */}
      <span
        className="text-[8px] font-bold tracking-[0.15em]"
        style={{
          color: enabled ? def.color : "rgba(255,255,255,0.25)",
        }}
      >
        {def.name}
      </span>

      {/* Knobs row */}
      <div className="flex gap-2">
        {def.params.map((paramDef) => (
          <Knob
            key={paramDef.id}
            value={params[paramDef.id] ?? paramDef.default}
            min={paramDef.min}
            max={paramDef.max}
            defaultValue={paramDef.default}
            label={paramDef.label}
            color={enabled ? def.color : "rgba(255,255,255,0.2)"}
            size={36}
            onChange={(v) => onParamChange(paramDef.id, v)}
          />
        ))}
      </div>

      {/* On/Off toggle */}
      <button
        onClick={onToggle}
        className="w-full py-1 rounded text-[7px] font-bold tracking-wider transition-all"
        style={{
          backgroundColor: enabled ? `${def.color}25` : "rgba(255,255,255,0.03)",
          color: enabled ? def.color : "rgba(255,255,255,0.15)",
          border: `1px solid ${enabled ? `${def.color}40` : "rgba(255,255,255,0.05)"}`,
        }}
      >
        {enabled ? "ON" : "OFF"}
      </button>
    </div>
  );
}

// ─── Main Component: FxRack ──────────────────────────────────────────

export function FxRack({ isOpen, onToggle }: FxRackProps) {
  // State for each module
  const [modules, setModules] = useState<
    Record<string, FxModuleState>
  >({
    reverb: { enabled: false, params: { level: 35, damping: 60 } },
    delay: { enabled: false, params: { time: 50, feedback: 40 } },
    filter: { enabled: false, params: { cutoff: 80, resonance: 20 } },
    drive: { enabled: false, params: { amount: 0, tone: 50 } },
    sidechain: { enabled: false, params: { amount: 70, release: 30 } },
    chorus: { enabled: false, params: { rate: 30, depth: 40 } },
    comp: { enabled: false, params: { threshold: 50, ratio: 40 } },
  });

  // Generic parameter change handler
  const setParam = useCallback(
    (moduleId: string, paramId: string, value: number) => {
      setModules((prev) => {
        const mod = prev[moduleId];
        if (!mod) return prev;

        const next = {
          ...mod,
          params: { ...mod.params, [paramId]: value },
        };

        applyFxParam(
          moduleId,
          paramId,
          value,
          mod.enabled,
          next.params
        );

        return { ...prev, [moduleId]: next };
      });
    },
    []
  );

  // Toggle module on/off
  const toggleModule = useCallback((moduleId: string) => {
    setModules((prev) => {
      const mod = prev[moduleId];
      if (!mod) return prev;

      const next = { ...mod, enabled: !mod.enabled };
      applyModuleToggle(moduleId, next.enabled, next.params);

      return { ...prev, [moduleId]: next };
    });
  }, []);

  // Render collapsed tab
  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="w-full py-1 text-[8px] font-bold tracking-[0.2em] text-white/20 hover:text-white/40 bg-[var(--ed-bg-primary)] border-t border-[var(--ed-border)]/30 transition-colors"
        aria-label="Open FX Rack"
      >
        ▲ FX RACK
      </button>
    );
  }

  // Render expanded FX rack
  return (
    <div className="border-t border-[var(--ed-border)]/50 bg-gradient-to-b from-[#0c0c10] to-[#08080c]">
      {/* Header with close button */}
      <button
        onClick={onToggle}
        className="w-full py-1 text-[8px] font-bold tracking-[0.2em] text-white/30 hover:text-white/50 transition-colors"
        aria-label="Close FX Rack"
      >
        ▼ FX RACK
      </button>

      {/* Module grid */}
      <div className="flex gap-2 px-3 pb-3 overflow-x-auto">
        {MODULE_DEFS.map((def) => {
          const mod = modules[def.id];
          if (!mod) return null;

          return (
            <FxModuleCard
              key={def.id}
              def={def}
              enabled={mod.enabled}
              params={mod.params}
              onToggle={() => toggleModule(def.id)}
              onParamChange={(paramId, value) =>
                setParam(def.id, paramId, value)
              }
            />
          );
        })}
      </div>
    </div>
  );
}
