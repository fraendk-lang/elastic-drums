/**
 * FX Rack — Compact pedalboard-style effect modules
 * 7 hardware-inspired FX modules (Reverb, Delay, Filter, Drive, Sidechain, Chorus, Comp)
 * Each with 2 knobs and on/off toggle.
 */

import { useState, useCallback } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { useDrumStore } from "../store/drumStore";
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

type FxTarget = "master" | "drums" | "bass" | "chords" | "melody";

const FX_TARGET_CHANNELS: Record<FxTarget, number[]> = {
  master: [],  // = use master FX methods
  drums:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  bass:   [12],
  chords: [13],
  melody: [14],
};

const FX_TARGET_LABELS: { id: FxTarget; label: string; color: string }[] = [
  { id: "master", label: "MST", color: "#f59e0b" },
  { id: "drums",  label: "DRM", color: "#f59e0b" },
  { id: "bass",   label: "BAS", color: "#10b981" },
  { id: "chords", label: "CHD", color: "#a78bfa" },
  { id: "melody", label: "MEL", color: "#f472b6" },
];

interface FxModuleState {
  enabled: boolean;
  target: FxTarget;
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
      { id: "level",   label: "LVL",  min: 0, max: 100, default: 35 },
      { id: "damping", label: "DMP",  min: 0, max: 100, default: 60 },
      { id: "type",    label: "TYPE", min: 0, max: 3,   default: 1  }, // 0=room 1=hall 2=plate 3=spring
    ],
  },
  {
    id: "delay",
    name: "DELAY",
    color: "#3b82f6",
    params: [
      { id: "division", label: "DIV",  min: 0, max: 7,   default: 4 }, // 0=1/32…7=1/2
      { id: "feedback", label: "FB",   min: 0, max: 100, default: 40 },
      { id: "mix",      label: "MIX",  min: 0, max: 100, default: 30 },
      { id: "mode",     label: "MODE", min: 0, max: 2,   default: 0  }, // 0=clean 1=tape 2=analog
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

// ─── Helper: Get channels for a target ─────────────────────────────

function getChannels(target: FxTarget): number[] {
  return FX_TARGET_CHANNELS[target] ?? [];
}

// ─── Helper: Apply FX Parameter Changes ──────────────────────────────

function applyFxParam(
  moduleId: string,
  paramId: string,
  value: number,
  enabled: boolean,
  allParams: Record<string, number>,
  target: FxTarget = "master"
) {
  if (!enabled) return; // Don't apply if module is disabled

  switch (moduleId) {
    case "reverb": {
      const rvbLvl = paramId === "level" ? value / 100 : (allParams.level ?? 35) / 100;
      audioEngine.setReverbLevel(rvbLvl);
      const rvbSend = Math.max(0.15, rvbLvl * 0.6);
      const channels = getChannels(target);
      if (target === "master" || channels.length === 0) {
        for (let ch = 0; ch < 15; ch++) audioEngine.setChannelReverbSend(ch, rvbSend);
      } else {
        for (const ch of channels) audioEngine.setChannelReverbSend(ch, rvbSend);
      }
      if (paramId === "damping") {
        audioEngine.setReverbDamping(500 + (value / 100) * 15500);
      }
      if (paramId === "type") {
        const types = ["room", "hall", "plate", "spring"] as const;
        audioEngine.setReverbType(types[Math.round(value)] ?? "hall");
      }
      break;
    }

    case "delay": {
      // BPM-synced delay divisions
      const DIVISIONS = [0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 1.0, 2.0]; // 1/32 → 1/2
      const bpm = useDrumStore.getState().bpm;
      const beatSec = 60 / bpm;
      const divIdx = Math.round(paramId === "division" ? value : allParams.division ?? 4);
      const time = Math.min(2.0, beatSec * (DIVISIONS[divIdx] ?? 0.5));
      const fb = Math.min(0.88, (paramId === "feedback" ? value : allParams.feedback ?? 40) / 100);
      const mix = (paramId === "mix" ? value : allParams.mix ?? 30) / 100;
      const filterFreq = 8000 - fb * 5000; // Darker with more feedback
      audioEngine.setDelayParams(time, fb, filterFreq);
      audioEngine.setDelayLevel(mix);
      if (paramId === "mode") {
        const modes = ["clean", "tape", "analog"] as const;
        audioEngine.setDelayMode(modes[Math.round(value)] ?? "clean");
      }
      break;
    }

    case "filter": {
      const cutoff = allParams.cutoff ?? 80;
      const resonance = allParams.resonance ?? 20;
      const freq = 80 * Math.pow(20000 / 80, cutoff / 100);
      const q = 0.5 + (resonance / 100) * 15;
      const channels = getChannels(target);
      if (target === "master" || channels.length === 0) {
        audioEngine.setMasterFilter("lowpass", freq, q);
      } else {
        for (const ch of channels) audioEngine.setChannelFilter(ch, "lowpass", freq, q);
      }
      break;
    }

    case "drive": {
      const driveAmt = (paramId === "amount" ? value : allParams.amount ?? 0) / 100;
      const channels = getChannels(target);
      if (target === "master" || channels.length === 0) {
        audioEngine.setMasterSaturation(driveAmt);
      } else {
        for (const ch of channels) audioEngine.setChannelDrive(ch, driveAmt);
      }
      break;
    }

    case "sidechain":
      if (paramId === "amount" || paramId === "release") {
        const amount = (allParams.amount ?? 70) / 100;
        const release = (allParams.release ?? 30) / 100 * 0.5; // 0-0.5 sec
        audioEngine.setSidechain(true, amount, release);
      }
      break;

    case "chorus":
      if (paramId === "rate" || paramId === "depth") {
        const rate  = 0.8 + (allParams.rate  ?? 30) / 100 * 2.0; // 0.8–2.8 Hz
        const depth = (allParams.depth ?? 40) / 100;              // 0–1
        audioEngine.setChorusRate(rate);
        audioEngine.setChorusDepth(depth);
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
  params: Record<string, number>,
  target: FxTarget = "master"
) {
  const channels = getChannels(target);
  const isPerChannel = target !== "master" && channels.length > 0;

  switch (id) {
    case "reverb": {
      const lvl = enabled ? (params.level ?? 35) / 100 : 0;
      audioEngine.setReverbLevel(Math.max(audioEngine.getSidechainAmount() > 0 ? 0.1 : 0, lvl));
      const reverbSend = enabled ? Math.max(0.15, lvl * 0.6) : 0;
      if (isPerChannel) {
        for (const ch of channels) audioEngine.setChannelReverbSend(ch, reverbSend);
      } else {
        for (let ch = 0; ch < 15; ch++) audioEngine.setChannelReverbSend(ch, reverbSend);
      }
      if (enabled) {
        audioEngine.setReverbDamping(500 + ((params.damping ?? 60) / 100) * 15500);
        const types = ["room", "hall", "plate", "spring"] as const;
        audioEngine.setReverbType(types[Math.round(params.type ?? 1)] ?? "hall");
      }
      break;
    }

    case "delay": {
      const mix = enabled ? (params.mix ?? 30) / 100 : 0;
      audioEngine.setDelayLevel(mix);
      const delaySend = enabled ? 0.25 : 0;
      if (isPerChannel) {
        for (const ch of channels) audioEngine.setChannelDelaySend(ch, delaySend);
      } else {
        for (let ch = 0; ch < 15; ch++) audioEngine.setChannelDelaySend(ch, delaySend);
      }
      if (enabled) {
        const DIVISIONS = [0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 1.0, 2.0];
        const bpm = useDrumStore.getState().bpm;
        const divIdx = Math.round(params.division ?? 4);
        const time = Math.min(2.0, (60 / bpm) * (DIVISIONS[divIdx] ?? 0.5));
        const fb = Math.min(0.88, (params.feedback ?? 40) / 100);
        audioEngine.setDelayParams(time, fb, 8000 - fb * 5000);
        const modes = ["clean", "tape", "analog"] as const;
        audioEngine.setDelayMode(modes[Math.round(params.mode ?? 0)] ?? "clean");
      }
      break;
    }

    case "filter": {
      const freq = 80 * Math.pow(20000 / 80, (params.cutoff ?? 80) / 100);
      const q = 0.5 + ((params.resonance ?? 20) / 100) * 15;
      if (isPerChannel) {
        for (const ch of channels) {
          if (enabled) audioEngine.setChannelFilter(ch, "lowpass", freq, q);
          else audioEngine.bypassChannelFilter(ch);
        }
      } else {
        if (enabled) audioEngine.setMasterFilter("lowpass", freq, q);
        else audioEngine.bypassMasterFilter();
      }
      break;
    }

    case "drive": {
      const drv = enabled ? (params.amount ?? 0) / 100 : 0;
      if (isPerChannel) {
        for (const ch of channels) audioEngine.setChannelDrive(ch, drv);
      } else {
        audioEngine.setMasterSaturation(drv);
      }
      break;
    }

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
        const rate  = 0.8 + (params.rate  ?? 30) / 100 * 2.0; // 0.8–2.8 Hz
        const depth = (params.depth ?? 40) / 100;              // 0–1
        audioEngine.setChorusRate(rate);
        audioEngine.setChorusDepth(depth);
        audioEngine.setChorusLevel(0.65);
        if (isPerChannel) {
          for (const ch of channels) audioEngine.setChannelChorusSend(ch, 0.4);
        } else {
          for (let ch = 0; ch < 15; ch++) audioEngine.setChannelChorusSend(ch, 0.3);
        }
      } else {
        audioEngine.setChorusLevel(0);
        if (isPerChannel) {
          for (const ch of channels) audioEngine.setChannelChorusSend(ch, 0);
        } else {
          for (let ch = 0; ch < 15; ch++) audioEngine.setChannelChorusSend(ch, 0);
        }
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
  target: FxTarget;
  params: Record<string, number>;
  onToggle: () => void;
  onTargetChange: (target: FxTarget) => void;
  onParamChange: (paramId: string, value: number) => void;
}

function FxModuleCard({
  def,
  enabled,
  target,
  params,
  onToggle,
  onTargetChange,
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
        style={{ color: enabled ? def.color : "rgba(255,255,255,0.25)" }}
      >
        {def.name}
      </span>

      {/* Target selector: MST DRM BAS CHD MEL */}
      <div className="flex gap-[1px]">
        {FX_TARGET_LABELS.map((t) => (
          <button key={t.id} onClick={() => onTargetChange(t.id)}
            className="px-1 py-0 text-[6px] font-bold rounded transition-all"
            style={{
              backgroundColor: target === t.id ? (enabled ? t.color + "30" : "rgba(255,255,255,0.08)") : "transparent",
              color: target === t.id ? (enabled ? t.color : "rgba(255,255,255,0.4)") : "rgba(255,255,255,0.15)",
            }}>
            {t.label}
          </button>
        ))}
      </div>

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

      {/* Delay: show synced division name */}
      {def.id === "delay" && (
        <span className="text-[8px] font-mono font-bold" style={{ color: enabled ? def.color : "rgba(255,255,255,0.15)" }}>
          {["1/32", "1/16T", "1/16", "1/8T", "1/8", "1/4T", "1/4", "1/2"][Math.round(params.division ?? 4)] ?? "1/8"}
          {" SYNC"}
        </span>
      )}

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
    reverb: { enabled: false, target: "master", params: { level: 35, damping: 60, type: 1 } },
    delay: { enabled: false, target: "master", params: { division: 4, feedback: 40, mix: 30 } },
    filter: { enabled: false, target: "master", params: { cutoff: 80, resonance: 20 } },
    drive: { enabled: false, target: "master", params: { amount: 0, tone: 50 } },
    sidechain: { enabled: false, target: "master", params: { amount: 70, release: 30 } },
    chorus: { enabled: false, target: "master", params: { rate: 30, depth: 40 } },
    comp: { enabled: false, target: "master", params: { threshold: 50, ratio: 40 } },
  });

  // Generic parameter change handler
  const setParam = useCallback(
    (moduleId: string, paramId: string, value: number) => {
      setModules((prev) => {
        const mod = prev[moduleId];
        if (!mod) return prev;

        const next = { ...mod, params: { ...mod.params, [paramId]: value } };
        applyFxParam(moduleId, paramId, value, mod.enabled, next.params, mod.target);
        return { ...prev, [moduleId]: next };
      });
    },
    []
  );

  // Change which target (channel) a module affects
  const setTarget = useCallback(
    (moduleId: string, target: FxTarget) => {
      setModules((prev) => {
        const mod = prev[moduleId];
        if (!mod) return prev;
        // Disable on old target first
        if (mod.enabled) applyModuleToggle(moduleId, false, mod.params, mod.target);
        const next = { ...mod, target };
        // Re-enable on new target
        if (mod.enabled) applyModuleToggle(moduleId, true, next.params, next.target);
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
      applyModuleToggle(moduleId, next.enabled, next.params, next.target);

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
              target={mod.target}
              params={mod.params}
              onToggle={() => toggleModule(def.id)}
              onTargetChange={(t) => setTarget(def.id, t)}
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
