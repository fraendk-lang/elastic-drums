import { useState, useCallback, useRef } from "react";
import { useDrumStore } from "../store/drumStore";
import { sampleManager } from "../audio/SampleManager";

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
    // Check if it's an audio file
    if (!file.type.startsWith("audio/") && !file.name.match(/\.(wav|mp3|aiff|ogg|flac|m4a)$/i)) {
      console.warn("Not an audio file:", file.name);
      return;
    }

    try {
      const sample = await sampleManager.loadFromFile(file, voiceIndex);
      setSampleNames((prev) => new Map(prev).set(voiceIndex, sample.name));
      setSelectedVoice(voiceIndex);
      // Trigger to preview
      triggerVoice(voiceIndex);
    } catch (err) {
      console.error("Failed to load sample:", err);
    }
  }, [setSelectedVoice, triggerVoice]);

  // Clear sample on right-click when sample is loaded
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
      <div className="grid grid-cols-4 gap-2">
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
              className={`relative flex flex-col items-center justify-center h-16 rounded-lg transition-all ${
                isTriggered ? "scale-95" : "scale-100"
              } ${
                isDragTarget
                  ? "ring-2 ring-[var(--ed-accent-green)] bg-[var(--ed-accent-green)]/10"
                  : isSelected
                    ? "ring-2 bg-[var(--ed-bg-elevated)]"
                    : "bg-[var(--ed-bg-surface)] hover:bg-[var(--ed-bg-elevated)]"
              }`}
              style={{
                boxShadow: isDragTarget
                  ? "0 0 20px rgba(34,197,94,0.3)"
                  : isTriggered
                    ? `0 0 20px ${color}40, inset 0 0 15px ${color}30`
                    : isSelected
                      ? `0 0 8px ${color}20, inset 0 0 0 2px ${color}`
                      : "none",
                borderColor: isDragTarget ? "var(--ed-accent-green)" : isSelected ? color : "transparent",
                borderWidth: "1px",
                borderStyle: "solid",
              }}
            >
              {/* Trigger flash overlay */}
              {isTriggered && (
                <div
                  className="absolute inset-0 rounded-lg opacity-30"
                  style={{ backgroundColor: color }}
                />
              )}

              {/* Drop hint */}
              {isDragTarget && (
                <div className="absolute inset-0 rounded-lg flex items-center justify-center">
                  <span className="text-[10px] font-bold text-[var(--ed-accent-green)]">DROP</span>
                </div>
              )}

              {/* Color dot — filled circle if sample loaded */}
              <div
                className={`${hasSample ? "w-3 h-3" : "w-2.5 h-2.5"} rounded-full mb-1 transition-all`}
                style={{
                  backgroundColor: hasSample ? "#22c55e" : color,
                  boxShadow: isTriggered ? `0 0 8px ${color}` : "none",
                }}
              />

              {/* Label — show sample name or voice label */}
              <span className="text-[10px] font-medium text-[var(--ed-text-secondary)] truncate max-w-full px-1">
                {hasSample ? sampleNames.get(i) : label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[9px] text-[var(--ed-text-muted)] mt-2 text-center">
        drop audio files on pads • right-click to clear sample
      </p>
    </div>
  );
}
