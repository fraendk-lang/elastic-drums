import { useEffect, useRef, useState } from "react";
import { beatFxManager, type BeatFxId, type BeatFxParams } from "../audio/BeatFx";
import { audioEngine } from "../audio/AudioEngine";

interface EffectDef {
  id: BeatFxId;
  label: string;
  color: string;
  params: { key: keyof BeatFxParams; label: string }[];
}

const EFFECTS: EffectDef[] = [
  { id: "throw",  label: "THROW",  color: "#3b82f6", params: [{ key: "throwSize",    label: "SIZE" }] },
  { id: "spiral", label: "SPIRAL", color: "#ec4899", params: [{ key: "spiralSpeed",  label: "SPD"  }] },
  { id: "echo",   label: "ECHO",   color: "#10b981", params: [{ key: "echoFeedback", label: "FBK"  }] },
  { id: "freeze", label: "FREEZE", color: "#a78bfa", params: [{ key: "freezeLength", label: "LEN"  }] },
  { id: "choke",  label: "CHOKE",  color: "#0ea5e9", params: [{ key: "chokeFreq",    label: "FRQ"  }] },
  { id: "noise",  label: "NOISE",  color: "#6b7280", params: [
    { key: "noiseVol", label: "VOL" },
    { key: "noiseCut", label: "CUT" },
  ]},
];

export function BeatFxPanel() {
  const [active, setActive] = useState<BeatFxId | null>(null);
  const [params, setParams] = useState<BeatFxParams>({ ...beatFxManager.params });
  const connected = useRef(false);

  // Connect BeatFxManager once audio engine is ready
  useEffect(() => {
    if (connected.current) return;
    if (!audioEngine.isInitialized) return;
    beatFxManager.connect();
    connected.current = true;
  });

  const handlePointerDown = (id: BeatFxId) => {
    if (!connected.current) {
      beatFxManager.connect();
      connected.current = true;
    }
    setActive(id);
    beatFxManager.startEffect(id);
  };

  const handlePointerUp = (id: BeatFxId) => {
    setActive((prev) => (prev === id ? null : prev));
    beatFxManager.stopEffect(id);
  };

  const handleParam = (id: BeatFxId, key: keyof BeatFxParams, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    beatFxManager.setParam(id, key, value);
  };

  return (
    <div
      className="flex flex-col gap-1.5 p-1.5 border-l border-white/[0.07] select-none shrink-0"
      style={{ width: 84, background: "#09090f" }}
    >
      <div className="text-[7px] font-black tracking-[0.18em] text-white/25 text-center py-0.5">
        BEAT FX
      </div>

      {EFFECTS.map((fx) => {
        const isActive = active === fx.id;
        return (
          <div key={fx.id} className="flex flex-col gap-1">
            {/* Hold Button */}
            <button
              className="w-full rounded-md font-black text-[9px] tracking-widest transition-all active:scale-[0.97] touch-none"
              style={{
                height: 32,
                background: isActive ? fx.color : `${fx.color}22`,
                color: isActive ? "#fff" : fx.color,
                border: `1px solid ${fx.color}${isActive ? "ff" : "55"}`,
                boxShadow: isActive ? `0 0 12px ${fx.color}66, inset 0 0 8px ${fx.color}33` : "none",
              }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePointerDown(fx.id); }}
              onPointerUp={() => handlePointerUp(fx.id)}
              onPointerCancel={() => handlePointerUp(fx.id)}
            >
              {fx.label}
            </button>

            {/* Mini Slider(s) */}
            {fx.params.map((p) => (
              <div key={p.key} className="flex items-center gap-1 px-0.5">
                <span className="text-[6px] font-bold text-white/30 w-5 shrink-0">{p.label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(params[p.key] * 100)}
                  onChange={(e) => handleParam(fx.id, p.key, Number(e.target.value) / 100)}
                  className="flex-1 h-0.5 cursor-pointer"
                  style={{ accentColor: fx.color }}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
