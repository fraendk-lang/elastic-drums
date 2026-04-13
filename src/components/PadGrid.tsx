import { useState, useCallback, useRef } from "react";
import { useDrumStore } from "../store/drumStore";
import { sampleManager } from "../audio/SampleManager";
import { WaveformPreview } from "./WaveformPreview";

const VOICE_LABELS = [
  "KICK", "SNARE", "CLAP", "TOM LO",
  "TOM MID", "TOM HI", "HH CL", "HH OP",
  "CYMBAL", "RIDE", "PERC 1", "PERC 2",
];

const VOICE_COLORS = [
  "#f59e0b", "#f59e0b", "#f59e0b", "#f59e0b",
  "#f59e0b", "#f59e0b", "#3b82f6", "#3b82f6",
  "#3b82f6", "#3b82f6", "#8b5cf6", "#8b5cf6",
];

export function PadGrid() {
  const { selectedVoice, setSelectedVoice, triggerVoice } = useDrumStore();
  const [triggered, setTriggered] = useState<Set<number>>(new Set());
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [sampleNames, setSampleNames] = useState<Map<number, string>>(new Map());
  const timeouts = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const handlePadDown = useCallback((i: number) => {
    triggerVoice(i);
    setSelectedVoice(i);

    // Flash animation
    setTriggered((prev) => new Set(prev).add(i));
    const prev = timeouts.current.get(i);
    if (prev) clearTimeout(prev);

    const timeout = setTimeout(() => {
      setTriggered((prev) => {
        const next = new Set(prev);
        next.delete(i);
        return next;
      });
    }, 120);
    timeouts.current.set(i, timeout);
  }, [triggerVoice, setSelectedVoice]);

  // ─── Drag & Drop sample loading ───────────────────────
  const handleDragOver = useCallback((e: React.DragEvent, i: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(i);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, voiceIndex: number) => {
    e.preventDefault();
    setDragOver(null);

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const file = files[0]!;
    const isAudio = file.type.startsWith("audio/") || file.name.match(/\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i);
    if (!isAudio) {
      console.warn("Not a supported audio file:", file.name);
      return;
    }

    try {
      const sample = await sampleManager.loadFromFile(file, voiceIndex);
      setSampleNames((prev) => new Map(prev).set(voiceIndex, sample.name));
      setSelectedVoice(voiceIndex);
      triggerVoice(voiceIndex);
    } catch (err) {
      console.error("Failed to decode audio:", file.name, err);
      // Brief visual feedback — flash the pad red (reuse trigger animation)
      setDragOver(voiceIndex);
      setTimeout(() => setDragOver(null), 500);
    }
  }, [setSelectedVoice, triggerVoice]);

  const handleContextMenu = useCallback((e: React.MouseEvent, i: number) => {
    if (sampleManager.hasSample(i)) {
      e.preventDefault();
      sampleManager.clearSample(i);
      setSampleNames((prev) => {
        const next = new Map(prev);
        next.delete(i);
        return next;
      });
    }
  }, []);

  return (
    <div className="p-3">
      <div className="grid grid-cols-4 gap-1.5">
        {VOICE_LABELS.map((label, i) => {
          const isSelected = selectedVoice === i;
          const isTriggered = triggered.has(i);
          const isDragTarget = dragOver === i;
          const hasSample = sampleNames.has(i);
          const color = VOICE_COLORS[i]!;

          return (
            <button
              key={i}
              onMouseDown={() => handlePadDown(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, i)}
              onContextMenu={(e) => handleContextMenu(e, i)}
              className={`ed-pad-press relative flex flex-col items-center justify-center h-[68px] rounded-lg overflow-hidden ${
                isDragTarget
                  ? "ring-2 ring-[var(--ed-accent-green)]"
                  : isSelected
                    ? "ring-1"
                    : ""
              }`}
              style={{
                background: isTriggered
                  ? `linear-gradient(135deg, ${color}20, ${color}10)`
                  : isSelected
                    ? `linear-gradient(180deg, var(--ed-bg-elevated) 0%, var(--ed-bg-surface) 100%)`
                    : `linear-gradient(180deg, var(--ed-bg-surface) 0%, #151519 100%)`,
                boxShadow: isDragTarget
                  ? `0 0 20px rgba(34,197,94,0.3), inset 0 1px 0 rgba(255,255,255,0.03)`
                  : isTriggered
                    ? `0 0 24px ${color}30, inset 0 0 20px ${color}15`
                    : isSelected
                      ? `0 0 12px ${color}15, inset 0 1px 0 rgba(255,255,255,0.04)`
                      : `inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.3)`,
                borderColor: isDragTarget ? "var(--ed-accent-green)" : isSelected ? color + "80" : "var(--ed-border)",
                borderWidth: "1px",
                borderStyle: "solid",
              }}
            >
              {/* Waveform oscilloscope */}
              <WaveformPreview voiceIndex={i} width={72} height={56} color={color} active={isSelected || isTriggered} />

              {/* Trigger flash overlay */}
              {isTriggered && (
                <div
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background: `radial-gradient(circle at center, ${color}30, transparent 70%)`,
                  }}
                />
              )}

              {/* Drop hint */}
              {isDragTarget && (
                <div className="absolute inset-0 rounded-lg flex items-center justify-center bg-[var(--ed-accent-green)]/5">
                  <span className="text-[10px] font-bold text-[var(--ed-accent-green)]">DROP</span>
                </div>
              )}

              {/* Color indicator — sample=green dot, VA=colored line */}
              {hasSample ? (
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--ed-accent-green)] mb-0.5"
                  style={{ boxShadow: "0 0 6px rgba(34,197,94,0.4)" }} />
              ) : (
                <div className="w-4 h-[2px] rounded-full mb-1" style={{
                  backgroundColor: isSelected ? color : color + "60",
                  boxShadow: isTriggered ? `0 0 8px ${color}` : "none",
                }} />
              )}

              {/* Label */}
              <span className={`text-[9px] font-semibold truncate max-w-full px-1 transition-colors ${
                isSelected ? "text-[var(--ed-text-primary)]" : "text-[var(--ed-text-secondary)]"
              }`}>
                {hasSample ? sampleNames.get(i) : label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[8px] text-[var(--ed-text-muted)] mt-2 text-center opacity-60">
        drop audio &middot; right-click to clear
      </p>
    </div>
  );
}
