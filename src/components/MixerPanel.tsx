import { useEffect, useRef, useState, useCallback } from "react";
import { audioEngine } from "../audio/AudioEngine";

const CHANNELS = [
  { id: 0, label: "KICK", short: "KCK", color: "#f59e0b" },
  { id: 1, label: "SNARE", short: "SNR", color: "#f59e0b" },
  { id: 2, label: "CLAP", short: "CLP", color: "#f59e0b" },
  { id: 3, label: "TOM L", short: "TL", color: "#f59e0b" },
  { id: 4, label: "TOM M", short: "TM", color: "#f59e0b" },
  { id: 5, label: "TOM H", short: "TH", color: "#f59e0b" },
  { id: 6, label: "HH CL", short: "HHC", color: "#3b82f6" },
  { id: 7, label: "HH OP", short: "HHO", color: "#3b82f6" },
  { id: 8, label: "CYMBAL", short: "CYM", color: "#3b82f6" },
  { id: 9, label: "RIDE", short: "RDE", color: "#3b82f6" },
  { id: 10, label: "PERC 1", short: "P1", color: "#8b5cf6" },
  { id: 11, label: "PERC 2", short: "P2", color: "#8b5cf6" },
];

interface MixerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MixerPanel({ isOpen, onClose }: MixerPanelProps) {
  const [levels, setLevels] = useState<number[]>(new Array(12).fill(0));
  const [masterLevel, setMasterLevel] = useState(0);
  const [volumes, setVolumes] = useState<number[]>(new Array(12).fill(100));
  const [masterVol, setMasterVol] = useState(85);
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [soloed, setSoloed] = useState<Set<number>>(new Set());
  const rafRef = useRef<number>(0);
  const peakHold = useRef<number[]>(new Array(12).fill(0));
  const peakDecay = useRef<number[]>(new Array(12).fill(0));
  const masterPeakHold = useRef(0);
  const masterPeakDecay = useRef(0);

  // Meter animation loop
  useEffect(() => {
    if (!isOpen) return;

    const updateMeters = () => {
      const newLevels: number[] = [];
      for (let i = 0; i < 12; i++) {
        const raw = audioEngine.getChannelLevel(i);
        // Peak hold with decay
        if (raw > peakHold.current[i]!) {
          peakHold.current[i] = raw;
          peakDecay.current[i] = 0;
        } else {
          peakDecay.current[i]! += 1;
          if (peakDecay.current[i]! > 15) {
            peakHold.current[i]! *= 0.95;
          }
        }
        newLevels.push(raw);
      }

      const rawMaster = audioEngine.getMasterLevel();
      if (rawMaster > masterPeakHold.current) {
        masterPeakHold.current = rawMaster;
        masterPeakDecay.current = 0;
      } else {
        masterPeakDecay.current += 1;
        if (masterPeakDecay.current > 15) {
          masterPeakHold.current *= 0.95;
        }
      }

      setLevels(newLevels);
      setMasterLevel(rawMaster);
      rafRef.current = requestAnimationFrame(updateMeters);
    };

    rafRef.current = requestAnimationFrame(updateMeters);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isOpen]);

  const handleVolume = useCallback((ch: number, value: number) => {
    setVolumes((prev) => {
      const next = [...prev];
      next[ch] = value;
      return next;
    });
    audioEngine.setChannelVolume(ch, value / 100);
  }, []);

  const handleMasterVolume = useCallback((value: number) => {
    setMasterVol(value);
    audioEngine.setMasterVolume(value / 100);
  }, []);

  const toggleMute = useCallback((ch: number) => {
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) {
        next.delete(ch);
        audioEngine.setChannelVolume(ch, volumes[ch]! / 100);
      } else {
        next.add(ch);
        audioEngine.setChannelVolume(ch, 0);
      }
      return next;
    });
  }, [volumes]);

  const toggleSolo = useCallback((ch: number) => {
    setSoloed((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) {
        next.delete(ch);
      } else {
        next.add(ch);
      }
      // Apply solo logic
      for (let i = 0; i < 12; i++) {
        if (next.size === 0) {
          // No solo: restore all (except muted)
          audioEngine.setChannelVolume(i, muted.has(i) ? 0 : volumes[i]! / 100);
        } else {
          // Solo active: only soloed channels audible
          audioEngine.setChannelVolume(i, next.has(i) ? volumes[i]! / 100 : 0);
        }
      }
      return next;
    });
  }, [volumes, muted]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-4xl bg-[var(--ed-bg-secondary)] border-t border-[var(--ed-border)] rounded-t-xl shadow-2xl p-4 pb-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[var(--ed-text-primary)] tracking-wider">MIXER</h2>
          <button
            onClick={onClose}
            className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-lg"
          >
            ✕
          </button>
        </div>

        {/* Channel Strips */}
        <div className="flex gap-2 justify-center">
          {CHANNELS.map((ch, i) => (
            <ChannelStrip
              key={ch.id}
              label={ch.short}
              color={ch.color}
              level={levels[i] ?? 0}
              peakLevel={peakHold.current[i] ?? 0}
              volume={volumes[i] ?? 100}
              isMuted={muted.has(i)}
              isSoloed={soloed.has(i)}
              onVolumeChange={(v) => handleVolume(i, v)}
              onMute={() => toggleMute(i)}
              onSolo={() => toggleSolo(i)}
            />
          ))}

          {/* Divider */}
          <div className="w-px bg-[var(--ed-border)] mx-1" />

          {/* Master */}
          <ChannelStrip
            label="MST"
            color="#22c55e"
            level={masterLevel}
            peakLevel={masterPeakHold.current}
            volume={masterVol}
            isMuted={false}
            isSoloed={false}
            onVolumeChange={handleMasterVolume}
            isMaster
          />
        </div>
      </div>
    </div>
  );
}

// ─── Channel Strip Component ─────────────────────────────

interface ChannelStripProps {
  label: string;
  color: string;
  level: number;
  peakLevel: number;
  volume: number;
  isMuted: boolean;
  isSoloed: boolean;
  onVolumeChange: (v: number) => void;
  onMute?: () => void;
  onSolo?: () => void;
  isMaster?: boolean;
}

function ChannelStrip({
  label, color, level, peakLevel, volume, isMuted, isSoloed,
  onVolumeChange, onMute, onSolo, isMaster,
}: ChannelStripProps) {
  return (
    <div className={`flex flex-col items-center gap-1 ${isMaster ? "min-w-[52px]" : "min-w-[42px]"}`}>
      {/* Meter */}
      <div className={`relative ${isMaster ? "w-5" : "w-3"} h-36 rounded-full bg-[var(--ed-bg-primary)] overflow-hidden border border-[var(--ed-border)]`}>
        {/* Level fill */}
        <div
          className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-75"
          style={{
            height: `${Math.min(level * 100, 100)}%`,
            background: level > 0.85
              ? "linear-gradient(to top, #22c55e, #eab308, #ef4444)"
              : level > 0.5
                ? `linear-gradient(to top, #22c55e, ${color})`
                : "#22c55e",
          }}
        />

        {/* Peak indicator */}
        {peakLevel > 0.02 && (
          <div
            className="absolute left-0 right-0 h-[2px]"
            style={{
              bottom: `${Math.min(peakLevel * 100, 100)}%`,
              backgroundColor: peakLevel > 0.85 ? "#ef4444" : color,
            }}
          />
        )}

        {/* Clip indicator */}
        {level > 0.95 && (
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-red-500 rounded-t-full" />
        )}
      </div>

      {/* dB label */}
      <span className="text-[8px] font-mono text-[var(--ed-text-muted)]">
        {level > 0.001 ? `${(20 * Math.log10(level)).toFixed(0)}` : "-∞"}
      </span>

      {/* Volume fader */}
      <input
        type="range"
        min={0}
        max={127}
        value={volume}
        onChange={(e) => onVolumeChange(Number(e.target.value))}
        className="h-16 accent-[var(--ed-text-primary)]"
        style={{ writingMode: "vertical-lr", direction: "rtl", width: "18px" }}
      />

      {/* Mute / Solo buttons */}
      {!isMaster && (
        <div className="flex gap-0.5">
          <button
            onClick={onMute}
            className={`w-5 h-4 rounded text-[7px] font-bold transition-colors ${
              isMuted
                ? "bg-[var(--ed-accent-red)] text-white"
                : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)]"
            }`}
          >
            M
          </button>
          <button
            onClick={onSolo}
            className={`w-5 h-4 rounded text-[7px] font-bold transition-colors ${
              isSoloed
                ? "bg-[var(--ed-accent-orange)] text-black"
                : "bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)]"
            }`}
          >
            S
          </button>
        </div>
      )}

      {/* Channel label */}
      <span
        className="text-[9px] font-semibold"
        style={{ color: isMuted ? "var(--ed-text-muted)" : color }}
      >
        {label}
      </span>
    </div>
  );
}
