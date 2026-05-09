import { useState, useCallback, useRef, lazy, Suspense } from "react";
import { useDrumStore } from "../store/drumStore";
import { useOverlayStore } from "../store/overlayStore";
import { useCustomKitStore } from "../store/customKitStore";
import { useMixerBarStore, faderToGain } from "../store/mixerBarStore";
import { audioEngine } from "../audio/AudioEngine";
import { sampleManager, type LoopData } from "../audio/SampleManager";
import { WaveformPreview } from "./WaveformPreview";
import { LoopEditor } from "./LoopEditor";
import { HintPopover } from "./Hints";
import type { LibrarySample } from "../audio/SampleLibrary";

// Lazy-load SampleBrowser (pulls in the 400KB sample catalog — only needed on demand)
const SampleBrowser = lazy(() =>
  import("./SampleBrowser").then((m) => ({ default: m.SampleBrowser }))
);

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
  // Per-field selectors — avoid re-rendering on every currentStep tick
  const selectedVoice = useDrumStore((s) => s.selectedVoice);
  const setSelectedVoice = useDrumStore((s) => s.setSelectedVoice);
  const triggerVoice = useDrumStore((s) => s.triggerVoice);
  const overlay = useOverlayStore();
  const { voiceSamples, setVoiceSample } = useCustomKitStore();
  const [triggered, setTriggered] = useState<Set<number>>(new Set());
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [sampleNames, setSampleNames] = useState<Map<number, string>>(
    () => new Map(
      Array.from(sampleManager.getLoadedSamples().entries()).map(([voiceIndex, sample]) => [voiceIndex, sample.name])
    )
  );
  const [browserVoiceIndex, setBrowserVoiceIndex] = useState<number | null>(null);
  const [loopEditorVoice, setLoopEditorVoice] = useState<number | null>(null);
  const [volumeKnobVoice, setVolumeKnobVoice] = useState<number | null>(null);
  const [panKnobVoice, setPanKnobVoice] = useState<number | null>(null);
  const [pitchKnobVoice, setPitchKnobVoice] = useState<number | null>(null);
  // Subscribe to the channels array directly — its reference is stable until
  // a channel actually changes. Mapping inside the selector would create a
  // new array every selector call → infinite re-render loop in Zustand v5.
  const mixerChannels = useMixerBarStore((s) => s.channels);
  const setMixerFader = useMixerBarStore((s) => s.setFader);
  const setMixerPan = useMixerBarStore((s) => s.setPan);
  // Per-voice sample-tune (pitch in semitones, -24..+24). Reactive local state
  // so the bar reflects current value; engine is source of truth on change.
  const [voicePitch, setVoicePitch] = useState<number[]>(() => {
    const arr = new Array(12).fill(0);
    for (let v = 0; v < 12; v++) {
      arr[v] = audioEngine.getVoiceParam(v, "sampleTune") ?? 0;
    }
    return arr;
  });
  const [loopData, setLoopData] = useState<Map<number, LoopData>>(
    () => {
      const map = new Map<number, LoopData>();
      for (let v = 0; v < 12; v++) {
        const d = sampleManager.getLoopData(v);
        if (d) map.set(v, d);
      }
      return map;
    }
  );
  const timeouts = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const fileInputs = useRef<Array<HTMLInputElement | null>>([]);
  // Anchors for contextual hints — populated by ref callbacks on the first pad
  // that ends up matching each criterion.
  const [loopBadgeAnchor, setLoopBadgeAnchor] = useState<HTMLElement | null>(null);
  const [volumeKnobAnchor, setVolumeKnobAnchor] = useState<HTMLElement | null>(null);

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

  const refreshLoopData = useCallback((voiceIndex: number) => {
    const d = sampleManager.getLoopData(voiceIndex);
    setLoopData((prev) => {
      const next = new Map(prev);
      if (d) next.set(voiceIndex, d);
      else next.delete(voiceIndex);
      return next;
    });
  }, []);

  // Per-pad volume quick-knob: vertical drag adjusts the channel fader.
  // Uses pointer-capture on the knob element so the drag works even past
  // the original click point.
  const handleVolumeKnobPointerDown = useCallback((e: React.PointerEvent, voiceIndex: number) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    // Read fader fresh at drag start to avoid stale closure issues
    const startFader = useMixerBarStore.getState().channels[voiceIndex]?.fader ?? 750;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    setVolumeKnobVoice(voiceIndex);

    const onMove = (ev: PointerEvent) => {
      const dy = startY - ev.clientY; // up = positive
      // 100px drag = full range (0..1000)
      const next = Math.max(0, Math.min(1000, startFader + dy * 5));
      setMixerFader(voiceIndex, Math.round(next));
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setVolumeKnobVoice(null);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, [setMixerFader]);

  const handleVolumeKnobDoubleClick = useCallback((e: React.MouseEvent, voiceIndex: number) => {
    e.stopPropagation();
    setMixerFader(voiceIndex, 750); // unity
  }, [setMixerFader]);

  // ── Pan quick-knob (left edge): vertical drag, -1..+1 ──
  // Up = pan right, down = pan left (matches mixer console "tilt" direction).
  // Double-click to reset to center.
  const handlePanKnobPointerDown = useCallback((e: React.PointerEvent, voiceIndex: number) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startPan = useMixerBarStore.getState().channels[voiceIndex]?.pan ?? 0;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    setPanKnobVoice(voiceIndex);

    const onMove = (ev: PointerEvent) => {
      const dy = startY - ev.clientY;
      // 80px drag = full range (-1..+1)
      const next = Math.max(-1, Math.min(1, startPan + dy / 80));
      setMixerPan(voiceIndex, next);
      // The MixerBar effect doesn't auto-sync pan to the audio engine — push directly.
      audioEngine.setChannelPan(voiceIndex, next);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setPanKnobVoice(null);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, [setMixerPan]);

  const handlePanKnobDoubleClick = useCallback((e: React.MouseEvent, voiceIndex: number) => {
    e.stopPropagation();
    setMixerPan(voiceIndex, 0); // center
    audioEngine.setChannelPan(voiceIndex, 0);
  }, [setMixerPan]);

  // ── Pitch quick-knob (top edge): horizontal drag, -24..+24 semitones ──
  // Right = up in pitch (intuitive piano direction).
  // Double-click to reset to 0.
  const handlePitchKnobPointerDown = useCallback((e: React.PointerEvent, voiceIndex: number) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startPitch = audioEngine.getVoiceParam(voiceIndex, "sampleTune") ?? 0;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    setPitchKnobVoice(voiceIndex);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      // 96px drag = ±24 semitones (1px per quarter-tone, snap to whole semitone)
      const next = Math.max(-24, Math.min(24, Math.round(startPitch + dx / 4)));
      audioEngine.setVoiceParam(voiceIndex, "sampleTune", next);
      setVoicePitch((prev) => {
        if (prev[voiceIndex] === next) return prev;
        const updated = [...prev];
        updated[voiceIndex] = next;
        return updated;
      });
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setPitchKnobVoice(null);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, []);

  const handlePitchKnobDoubleClick = useCallback((e: React.MouseEvent, voiceIndex: number) => {
    e.stopPropagation();
    audioEngine.setVoiceParam(voiceIndex, "sampleTune", 0);
    setVoicePitch((prev) => {
      const updated = [...prev];
      updated[voiceIndex] = 0;
      return updated;
    });
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
      refreshLoopData(voiceIndex);
    } catch (err) {
      console.error("Failed to decode audio:", file.name, err);
      // Brief visual feedback — flash the pad red (reuse trigger animation)
      setDragOver(voiceIndex);
      setTimeout(() => setDragOver(null), 500);
    }
  }, [setSelectedVoice, triggerVoice, refreshLoopData]);

  const handleContextMenu = useCallback((e: React.MouseEvent, i: number) => {
    if (sampleManager.hasSample(i)) {
      e.preventDefault();
      sampleManager.clearSample(i);
      setVoiceSample(i, null);
      setSampleNames((prev) => {
        const next = new Map(prev);
        next.delete(i);
        return next;
      });
      setLoopData((prev) => {
        const next = new Map(prev);
        next.delete(i);
        return next;
      });
    }
  }, [setVoiceSample]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>, voiceIndex: number) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const isAudio = file.type.startsWith("audio/") || file.name.match(/\.(wav|mp3|ogg|flac|m4a|aac|webm|aif|aiff)$/i);
    if (!isAudio) {
      console.warn("Not a supported audio file:", file.name);
      return;
    }

    try {
      const sample = await sampleManager.loadFromFile(file, voiceIndex);
      setSampleNames((prev) => new Map(prev).set(voiceIndex, sample.name));
      setVoiceSample(voiceIndex, null);
      setSelectedVoice(voiceIndex);
      triggerVoice(voiceIndex);
      refreshLoopData(voiceIndex);
    } catch (err) {
      console.error("Failed to decode audio:", file.name, err);
      setDragOver(voiceIndex);
      setTimeout(() => setDragOver(null), 500);
    }
  }, [setSelectedVoice, setVoiceSample, triggerVoice, refreshLoopData]);

  const handleBrowseClick = useCallback((e: React.MouseEvent, voiceIndex: number) => {
    e.stopPropagation();
    if (e.shiftKey || e.altKey || e.metaKey) {
      fileInputs.current[voiceIndex]?.click();
      return;
    }

    if (e.button === 0) {
      setBrowserVoiceIndex(voiceIndex);
      overlay.openOverlay("sampleBrowser");
      return;
    }
  }, [overlay]);

  const handleSampleSelect = useCallback(async (sample: LibrarySample | null) => {
    if (browserVoiceIndex === null) return;

    if (sample === null) {
      // Clear sample
      sampleManager.clearSample(browserVoiceIndex);
      setSampleNames((prev) => {
        const next = new Map(prev);
        next.delete(browserVoiceIndex);
        return next;
      });
      setVoiceSample(browserVoiceIndex, null);
      overlay.closeOverlay("sampleBrowser");
      return;
    }

    await sampleManager.loadFromUrl(sample.path, sample.name, browserVoiceIndex);
    setSampleNames((prev) => new Map(prev).set(browserVoiceIndex, sample.name));
    setVoiceSample(browserVoiceIndex, sample.id);
    setSelectedVoice(browserVoiceIndex);
    triggerVoice(browserVoiceIndex);
    refreshLoopData(browserVoiceIndex);
    overlay.closeOverlay("sampleBrowser");
  }, [browserVoiceIndex, overlay, setSelectedVoice, setVoiceSample, triggerVoice, refreshLoopData]);

  return (
    <div className="p-3">
      <div className="grid grid-cols-4 gap-1.5">
        {VOICE_LABELS.map((label, i) => {
          const isSelected = selectedVoice === i;
          const isTriggered = triggered.has(i);
          const isDragTarget = dragOver === i;
          const hasSample = sampleNames.has(i);
          const color = VOICE_COLORS[i]!;
          const padLoopData = loopData.get(i);
          const isLooping = padLoopData?.isLoop ?? false;

          return (
            <div
              key={i}
              className="relative group"
            >
              <input
                ref={(node) => {
                  fileInputs.current[i] = node;
                }}
                type="file"
                accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm,.aif,.aiff"
                className="hidden"
                onChange={(e) => handleFileChange(e, i)}
              />
              <button
                onMouseDown={() => handlePadDown(i)}
                onPointerDown={(e) => {
                  if (e.pointerType !== "mouse") handlePadDown(i);
                }}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, i)}
                onContextMenu={(e) => handleContextMenu(e, i)}
                className={`ed-pad-press touch-manipulation w-full relative flex flex-col items-center justify-center h-[68px] rounded-lg overflow-hidden ${
                  isDragTarget
                    ? "ring-2 ring-[var(--ed-accent-green)]"
                    : isSelected
                      ? "ring-1"
                      : ""
                }`}
              style={{
                background: isTriggered
                  ? `linear-gradient(135deg, ${color}28, ${color}14)`
                  : isSelected
                    ? `linear-gradient(180deg, ${color}14 0%, ${color}08 60%, #0a0a0d 100%)`
                    : `linear-gradient(180deg, var(--ed-bg-surface) 0%, #0a0a0d 100%)`,
                boxShadow: isDragTarget
                  ? `0 0 20px rgba(34,197,94,0.3), inset 0 1px 0 rgba(255,255,255,0.03)`
                  : isTriggered
                    ? `0 0 32px ${color}45, 0 0 16px ${color}25, inset 0 0 20px ${color}18`
                    : isSelected
                      ? `0 0 20px ${color}28, inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.3)`
                      : `inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.3)`,
                borderColor: isDragTarget ? "var(--ed-accent-green)" : isSelected ? color + "80" : "var(--ed-border)",
                borderWidth: "1px",
                borderStyle: "solid",
                transform: isTriggered ? "scale(1.05)" : "scale(1)",
                transition: "transform 0.08s ease-out",
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

              {/* LOOP badge — visible on ALL sample pads, opens Loop Editor */}
              {hasSample && (
                <button
                  ref={(node) => {
                    // Pin the first sample pad's loop badge as the hint anchor
                    if (node && !loopBadgeAnchor) setLoopBadgeAnchor(node);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLoopEditorVoice(loopEditorVoice === i ? null : i);
                  }}
                  title={
                    isLooping
                      ? `Loop aktiv${padLoopData?.nativeBpm ? ` · ${padLoopData.nativeBpm} BPM` : ""} — klicken zum Bearbeiten`
                      : padLoopData?.nativeBpm
                        ? `${padLoopData.nativeBpm} BPM erkannt — klicken zum Aktivieren`
                        : "Loop-Editor öffnen"
                  }
                  className={`absolute bottom-1 left-1 px-1 py-px rounded text-[7px] font-bold leading-none transition-all ${
                    isLooping
                      ? "bg-[var(--ed-accent-green)]/25 text-[var(--ed-accent-green)] border border-[var(--ed-accent-green)]/50"
                      : padLoopData?.nativeBpm
                        ? "bg-white/8 text-white/60 border border-white/20 hover:text-white/90 hover:border-white/35"
                        : "bg-white/5 text-white/35 border border-white/10 hover:text-white/65 hover:border-white/25"
                  }`}
                >
                  {padLoopData?.nativeBpm ? `↻${padLoopData.nativeBpm}` : "LOOP"}
                </button>
              )}

              {/* Per-pad volume quick-knob — vertical bar at right edge */}
              {(() => {
                const fader = mixerChannels[i]?.fader ?? 750;
                const pct = fader / 1000;
                const isActive = volumeKnobVoice === i;
                const dbApprox = Math.round(20 * Math.log10(Math.max(0.001, faderToGain(fader))));
                return (
                  <div
                    ref={(node) => {
                      if (node && !volumeKnobAnchor) setVolumeKnobAnchor(node);
                    }}
                    onPointerDown={(e) => handleVolumeKnobPointerDown(e, i)}
                    onDoubleClick={(e) => handleVolumeKnobDoubleClick(e, i)}
                    title={`Volume · ${dbApprox > 0 ? "+" : ""}${dbApprox} dB · drag to adjust · double-click to reset`}
                    className={`absolute top-0.5 bottom-0.5 right-0.5 w-1 rounded-full overflow-hidden cursor-ns-resize transition-opacity ${
                      isActive ? "opacity-100" : "opacity-40 group-hover:opacity-80"
                    }`}
                    style={{ touchAction: "none", background: "rgba(255,255,255,0.06)" }}
                  >
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-full"
                      style={{
                        height: `${pct * 100}%`,
                        background: isActive
                          ? "linear-gradient(to top, var(--ed-accent-orange), var(--ed-accent-orange))"
                          : "linear-gradient(to top, rgba(245,158,11,0.6), rgba(245,158,11,0.4))",
                      }}
                    />
                  </div>
                );
              })()}

              {/* Per-pad PAN quick-knob — vertical bar at left edge.
                  Fill grows from center to top (right-pan) or to bottom (left-pan). */}
              {(() => {
                const pan = mixerChannels[i]?.pan ?? 0;          // -1 .. +1
                const isActive = panKnobVoice === i;
                const labelL = pan < -0.05 ? `L${Math.round(-pan * 100)}` : pan > 0.05 ? `R${Math.round(pan * 100)}` : "C";
                return (
                  <div
                    onPointerDown={(e) => handlePanKnobPointerDown(e, i)}
                    onDoubleClick={(e) => handlePanKnobDoubleClick(e, i)}
                    title={`Pan · ${labelL} · drag up=R, down=L · double-click to center`}
                    className={`absolute top-0.5 bottom-0.5 left-0.5 w-1 rounded-full overflow-hidden cursor-ns-resize transition-opacity ${
                      isActive ? "opacity-100" : "opacity-40 group-hover:opacity-80"
                    }`}
                    style={{ touchAction: "none", background: "rgba(255,255,255,0.06)" }}
                  >
                    {/* Center tick */}
                    <div
                      className="absolute left-0 right-0"
                      style={{ top: "calc(50% - 0.5px)", height: "1px", background: "rgba(255,255,255,0.18)" }}
                    />
                    {/* Fill from center upward (pan > 0 = R) or downward (pan < 0 = L) */}
                    <div
                      className="absolute left-0 right-0"
                      style={{
                        ...(pan >= 0
                          ? { bottom: "50%", height: `${pan * 50}%` }
                          : { top: "50%", height: `${-pan * 50}%` }),
                        background: isActive
                          ? "var(--ed-accent-blue)"
                          : pan === 0 ? "transparent" : "rgba(59,130,246,0.55)",
                      }}
                    />
                  </div>
                );
              })()}

              {/* Per-pad PITCH quick-knob — horizontal bar at top edge.
                  Filled from center: right = up in pitch, left = down. */}
              {(() => {
                const pitch = voicePitch[i] ?? 0;          // -24..+24 semitones
                const isActive = pitchKnobVoice === i;
                const sign = pitch === 0 ? "" : pitch > 0 ? "+" : "";
                return (
                  <div
                    onPointerDown={(e) => handlePitchKnobPointerDown(e, i)}
                    onDoubleClick={(e) => handlePitchKnobDoubleClick(e, i)}
                    title={`Pitch · ${sign}${pitch} st · drag right=up · double-click to reset`}
                    className={`absolute top-0.5 left-2.5 right-2.5 h-1 rounded-full overflow-hidden cursor-ew-resize transition-opacity ${
                      isActive ? "opacity-100" : "opacity-40 group-hover:opacity-80"
                    }`}
                    style={{ touchAction: "none", background: "rgba(255,255,255,0.06)" }}
                  >
                    {/* Center tick */}
                    <div
                      className="absolute top-0 bottom-0"
                      style={{ left: "calc(50% - 0.5px)", width: "1px", background: "rgba(255,255,255,0.18)" }}
                    />
                    <div
                      className="absolute top-0 bottom-0"
                      style={{
                        ...(pitch >= 0
                          ? { left: "50%", width: `${(pitch / 24) * 50}%` }
                          : { right: "50%", width: `${(-pitch / 24) * 50}%` }),
                        background: isActive
                          ? "var(--ed-accent-melody)"
                          : pitch === 0 ? "transparent" : "rgba(244,114,182,0.55)",
                      }}
                    />
                  </div>
                );
              })()}

              {/* Sample Browser button (folder icon) */}
              <button
                onClick={(e) => handleBrowseClick(e, i)}
                aria-label={`Browse samples for ${label}`}
                className="absolute top-1 right-2.5 p-1 rounded opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity bg-black/40 hover:bg-black/60"
                title="Open stock sample library (Shift-click for local file)"
              >
                <svg className="w-3 h-3 text-[var(--ed-accent-green)]" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M7 2H2a1 1 0 00-1 1v11a1 1 0 001 1h12a1 1 0 001-1V6a1 1 0 00-1-1h-4L7 2z" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-[8px] text-[var(--ed-text-muted)] mt-2 text-center opacity-60">
        folder = stock library &middot; Shift-click = file import &middot; drop audio &middot; right-click to clear
      </p>

      {/* Contextual hints — shown ONCE per user, dismissable, persisted */}
      <HintPopover
        id="loop-badge"
        anchor={loopBadgeAnchor}
        position="top"
        title="Loop Editor"
        body="Tap the ↻ badge on a sample pad to open the Loop Editor — set BPM, warp markers, time-stretch."
        triggered={loopEditorVoice !== null}
      />
      <HintPopover
        id="volume-knob"
        anchor={volumeKnobAnchor}
        position="left"
        title="Per-Pad Quick Knobs"
        body="Drag the right edge for volume, left edge for pan, top edge for pitch. Double-click any knob to reset."
      />

      {/* Loop Editor — inline panel below pad grid, shown when a loop badge is clicked */}
      {loopEditorVoice !== null && (
        <LoopEditor
          voiceIndex={loopEditorVoice}
          label={VOICE_LABELS[loopEditorVoice] ?? ""}
          onClose={() => setLoopEditorVoice(null)}
          onLoopDataChange={(data) => {
            setLoopData((prev) => {
              const next = new Map(prev);
              if (data) next.set(loopEditorVoice, data);
              else next.delete(loopEditorVoice);
              return next;
            });
          }}
        />
      )}

      {/* Sample Browser Modal — lazy-loaded so the 400KB catalog doesn't block initial render */}
      <Suspense fallback={null}>
        <SampleBrowser
          isOpen={overlay.isOpen("sampleBrowser") && browserVoiceIndex !== null}
          voiceIndex={browserVoiceIndex ?? 0}
          selectedSampleId={browserVoiceIndex !== null ? voiceSamples[browserVoiceIndex] ?? undefined : undefined}
          onClose={() => overlay.closeOverlay("sampleBrowser")}
          onSelect={handleSampleSelect}
        />
      </Suspense>
    </div>
  );
}
