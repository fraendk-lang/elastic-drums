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

function MiniSlider({
  value,
  color,
  onChange,
}: {
  value: number;
  color: string;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const setFromPointer = (e: React.PointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    onChange(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  return (
    <div
      ref={trackRef}
      className="relative flex-1 cursor-pointer"
      style={{ height: 12, display: "flex", alignItems: "center" }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setFromPointer(e); }}
      onPointerMove={(e) => { if (e.buttons) setFromPointer(e); }}
    >
      {/* Track */}
      <div className="w-full rounded-full" style={{ height: 2, background: "#ffffff10" }}>
        <div className="h-full rounded-full" style={{ width: `${value * 100}%`, background: `${color}99` }} />
      </div>
      {/* Thumb */}
      <div
        className="absolute rounded-full"
        style={{
          width: 6,
          height: 6,
          background: color,
          left: `calc(${value * 100}% - 3px)`,
          boxShadow: `0 0 4px ${color}`,
          top: "50%",
          transform: "translateY(-50%)",
        }}
      />
    </div>
  );
}

export function BeatFxPanel() {
  const [active, setActive] = useState<BeatFxId | null>(null);
  const [params, setParams] = useState<BeatFxParams>({ ...beatFxManager.params });
  const [collapsed, setCollapsed] = useState(false);
  const connected = useRef(false);

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

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center justify-start select-none shrink-0 cursor-pointer"
        style={{ width: 16, background: "#07070e", borderLeft: "1px solid rgba(255,255,255,0.05)" }}
        onClick={() => setCollapsed(false)}
        title="Beat FX einblenden"
      >
        <div
          style={{
            marginTop: 40,
            fontSize: 6,
            fontWeight: 900,
            letterSpacing: "0.18em",
            color: "rgba(255,255,255,0.22)",
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            cursor: "pointer",
          }}
        >
          BEAT FX
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col select-none shrink-0"
      style={{ width: 80, background: "#07070e", borderLeft: "1px solid rgba(255,255,255,0.05)" }}
    >
      {/* Header with collapse button */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{ padding: "5px 5px 3px 8px" }}
      >
        <span style={{ fontSize: 6, fontWeight: 900, letterSpacing: "0.2em", color: "rgba(255,255,255,0.18)" }}>
          BEAT FX
        </span>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.2)",
            cursor: "pointer",
            fontSize: 8,
            lineHeight: 1,
            padding: "1px 2px",
          }}
          title="Beat FX ausblenden"
        >
          ✕
        </button>
      </div>

      {/* Effects */}
      <div className="flex flex-col flex-1" style={{ gap: 3, padding: "0 5px 5px" }}>
        {EFFECTS.map((fx) => {
          const isActive = active === fx.id;
          return (
            <div key={fx.id} style={{ background: "#0d0d1a", borderRadius: 5, padding: "4px 5px 5px" }}>
              {/* Hold Button */}
              <button
                className="w-full touch-none"
                style={{
                  height: 26,
                  borderRadius: 4,
                  fontSize: 8,
                  fontWeight: 900,
                  letterSpacing: "0.1em",
                  background: isActive ? fx.color : `${fx.color}18`,
                  color: isActive ? "#fff" : `${fx.color}cc`,
                  border: `1px solid ${fx.color}${isActive ? "cc" : "30"}`,
                  boxShadow: isActive ? `0 0 10px ${fx.color}55` : "none",
                  transition: "background 80ms, box-shadow 80ms, border-color 80ms",
                  cursor: "pointer",
                  display: "block",
                  width: "100%",
                  userSelect: "none",
                }}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePointerDown(fx.id); }}
                onPointerUp={() => handlePointerUp(fx.id)}
                onPointerCancel={() => handlePointerUp(fx.id)}
              >
                {fx.label}
              </button>

              {/* Mini Slider(s) */}
              {fx.params.map((p) => (
                <div key={p.key} className="flex items-center" style={{ marginTop: 4, gap: 4 }}>
                  <span style={{ fontSize: 6, fontWeight: 700, color: `${fx.color}55`, width: 14, flexShrink: 0, letterSpacing: "0.05em" }}>
                    {p.label}
                  </span>
                  <MiniSlider
                    value={params[p.key]}
                    color={fx.color}
                    onChange={(v) => handleParam(fx.id, p.key, v)}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
