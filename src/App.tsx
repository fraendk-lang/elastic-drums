import { useState, useCallback, useEffect, useRef } from "react";
import { PadGrid } from "./components/PadGrid";
import { StepSequencer } from "./components/StepSequencer";
import { Transport } from "./components/Transport";
import { MixerStrip } from "./components/MixerStrip";
import { MixerPanel } from "./components/MixerPanel";
import { PatternBrowser } from "./components/PatternBrowser";
import { EuclideanGenerator } from "./components/EuclideanGenerator";
import { SongEditor } from "./components/SongEditor";
import { SceneLauncher } from "./components/SceneLauncher";
import { FxPanel } from "./components/FxPanel";
import { KitBrowser } from "./components/KitBrowser";
import { VoiceEditor } from "./components/VoiceEditor";
import { FxRack } from "./components/FxRack";
import { SynthSection } from "./components/SynthSection";
import { MidiPlayerPanel } from "./components/MidiPlayerPanel";
import { PianoRoll } from "./components/PianoRoll";
import { SceneMini } from "./components/SceneMini";
import { bassEngine } from "./audio/BassEngine";
import { chordsEngine } from "./audio/ChordsEngine";
import { melodyEngine } from "./audio/MelodyEngine";
import { startBassScheduler, stopBassScheduler } from "./store/bassStore";
import { startChordsScheduler, stopChordsScheduler } from "./store/chordsStore";
import { startMelodyScheduler, stopMelodyScheduler } from "./store/melodyStore";
import { useSceneStore } from "./store/sceneStore";
import { setSceneStoreRef } from "./store/drumStore";
import { audioEngine } from "./audio/AudioEngine";
import { useDrumStore } from "./store/drumStore";
import { useOverlayStore } from "./store/overlayStore";
import { useKeyboard } from "./hooks/useKeyboard";
import { useMidi } from "./hooks/useMidi";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { loadSharedPattern } from "./utils/patternShare";
import { scheduleAutoSave, loadAutoSave } from "./store/autoSave";
import { useTransportStore } from "./store/transportStore";

export function App() {
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saved" | "restored">("idle");
  const [fxRackOpen, setFxRackOpen] = useState(false);
  const [sceneMiniOpen, setSceneMiniOpen] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(360);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const appShellRef = useRef<HTMLDivElement>(null);

  // Overlay store replaces individual useState booleans
  const overlay = useOverlayStore();
  const minBottomPanelHeight = fxRackOpen ? 92 : 34;

  useKeyboard();
  useMidi();
  useUndoRedo();

  // Load shared pattern or auto-save on mount
  useEffect(() => {
    const shared = loadSharedPattern();
    if (shared) {
      useDrumStore.setState({
        pattern: shared.pattern,
        bpm: shared.bpm,
        currentPatternIndex: -1,
      });
      return;
    }

    // Try to restore auto-saved state
    loadAutoSave().then((data) => {
      if (data && data.drumPattern) {
        useDrumStore.setState({
          pattern: data.drumPattern as never,
          bpm: data.bpm ?? 120,
        });
        setAutoSaveStatus("restored");
        setTimeout(() => setAutoSaveStatus("idle"), 2000);
      }
    }).catch(() => { /* ignore auto-save load failures */ });
  }, []);

  // Auto-save on state changes (debounced)
  const autoSaveRef = useRef(false);
  useEffect(() => {
    // Skip the initial render
    if (!autoSaveRef.current) {
      autoSaveRef.current = true;
      return;
    }

    const unsub = useDrumStore.subscribe(() => {
      const state = useDrumStore.getState();
      scheduleAutoSave(() => ({
        drumPattern: state.pattern,
        bpm: state.bpm,
        swing: state.swing,
        bassState: null,
        chordsState: null,
        melodyState: null,
        timestamp: Date.now(),
      }));
    });
    return unsub;
  }, []);

  const startAudio = useCallback(async () => {
    try {
      setAudioError(null);
      await audioEngine.resume();
      // Init all synth engines and route through mixer channels
      const ctx = audioEngine.getAudioContext();
      if (ctx) {
        // Bass 303 → Channel 12
        bassEngine.init(ctx);
        const bassOut = bassEngine.getOutput();
        const bassCh = audioEngine.getChannelOutput(12);
        if (bassOut && bassCh) bassOut.connect(bassCh);

        // Chords Pad → Channel 13
        chordsEngine.init(ctx);
        const chordsOut = chordsEngine.getOutput();
        const chordsCh = audioEngine.getChannelOutput(13);
        if (chordsOut && chordsCh) chordsOut.connect(chordsCh);

        // Melody Lead → Channel 14
        melodyEngine.init(ctx);
        const melodyOut = melodyEngine.getOutput();
        const melodyCh = audioEngine.getChannelOutput(14);
        if (melodyOut && melodyCh) melodyOut.connect(melodyCh);
      }
      setAudioReady(true);

      // Monitor AudioContext state — auto-resume if browser suspends it
      // (happens on mobile tab switch, Bluetooth disconnect, etc.)
      const ctx2 = audioEngine.getAudioContext();
      if (ctx2) {
        ctx2.onstatechange = () => {
          if (ctx2.state === "interrupted" || ctx2.state === "suspended") {
            console.warn("AudioContext suspended — attempting resume...");
            ctx2.resume().catch(() => {
              setAudioError("Audio was interrupted. Tap anywhere to resume.");
            });
          } else if (ctx2.state === "running") {
            setAudioError(null); // Clear error when recovered
          }
        };
      }
    } catch (err) {
      console.error("Audio init failed:", err);
      setAudioError(
        err instanceof Error
          ? `Audio initialization failed: ${err.message}`
          : "Audio initialization failed. Please check your browser settings."
      );
    }
  }, []);

  // Sync all synth schedulers with drum transport
  useEffect(() => {
    const unsub = useDrumStore.subscribe((state, prev) => {
      if (state.isPlaying && !prev.isPlaying) {
        startBassScheduler();
        startChordsScheduler();
        startMelodyScheduler();
      }
      if (!state.isPlaying && prev.isPlaying) {
        stopBassScheduler();
        stopChordsScheduler();
        stopMelodyScheduler();
      }

      // Sync transport store (replaces window.__drumStore hack)
      if (state.bpm !== prev.bpm) useTransportStore.getState().setBpm(state.bpm);
      if (state.isPlaying !== prev.isPlaying) useTransportStore.getState().setPlaying(state.isPlaying);
      if (state.swing !== prev.swing) useTransportStore.getState().setSwing(state.swing);
      if (state.currentStep !== prev.currentStep) useTransportStore.getState().setCurrentStep(state.currentStep);
    });

    // Initialize transport store with current values
    const { bpm, isPlaying, swing, currentStep } = useDrumStore.getState();
    useTransportStore.setState({ bpm, isPlaying, swing, currentStep });

    // Legacy compat: still set window ref for any code that reads it
    (window as unknown as Record<string, unknown>).__drumStore = useDrumStore;
    // Register scene store for song mode integration
    setSceneStoreRef(useSceneStore as unknown as Parameters<typeof setSceneStoreRef>[0]);
    return unsub;
  }, []);

  useEffect(() => {
    const clampBottomHeight = () => {
      const viewportHeight = window.innerHeight;
      const maxHeight = Math.max(minBottomPanelHeight, Math.floor(viewportHeight * 0.62));
      setBottomPanelHeight((prev) => Math.min(maxHeight, Math.max(minBottomPanelHeight, prev)));
    };

    clampBottomHeight();
    window.addEventListener("resize", clampBottomHeight);
    return () => window.removeEventListener("resize", clampBottomHeight);
  }, [minBottomPanelHeight]);

  const handleBottomPanelResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStateRef.current = { startY: event.clientY, startHeight: bottomPanelHeight };

    if ("pointerId" in event && typeof event.currentTarget.setPointerCapture === "function") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Safari can be picky here; window listeners below are the real fallback.
      }
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = moveEvent.clientY - (resizeStateRef.current?.startY ?? moveEvent.clientY);
      const viewportHeight = window.innerHeight;
      const minHeight = minBottomPanelHeight;
      const maxHeight = Math.max(minHeight, Math.floor(viewportHeight * 0.62));
      const nextHeight = Math.max(minHeight, Math.min(maxHeight, (resizeStateRef.current?.startHeight ?? bottomPanelHeight) - drag));
      setBottomPanelHeight(nextHeight);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    };

    const stopResize = () => {
      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("mousemove", handlePointerMove as unknown as EventListener);
      window.removeEventListener("mouseup", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("mousemove", handlePointerMove as unknown as EventListener);
    window.addEventListener("mouseup", stopResize);
  }, [bottomPanelHeight, minBottomPanelHeight]);

  // ─── Audio Init Overlay ──────────────────────────────────
  if (!audioReady) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--ed-bg-primary)] ed-noise gap-4 app-shell">
        <button
          onClick={startAudio}
          aria-label="Start audio engine"
          className="group relative w-20 h-20 rounded-full bg-[var(--ed-bg-elevated)] border-2 border-[var(--ed-accent-orange)]/40 flex items-center justify-center hover:border-[var(--ed-accent-orange)] hover:bg-[var(--ed-accent-orange)] transition-all duration-300 cursor-pointer hover:shadow-[0_0_40px_rgba(245,158,11,0.3)]"
        >
          <span className="text-2xl text-[var(--ed-accent-orange)] group-hover:text-black transition-colors ml-1">
            &#9654;
          </span>
          <div className="absolute inset-0 rounded-full border-2 border-[var(--ed-accent-orange)]/20 animate-ping" />
        </button>
        <span className="text-[10px] text-[var(--ed-text-muted)] tracking-wider">CLICK TO START</span>
        {audioError && (
          <div className="mt-4 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg max-w-sm text-center">
            <p className="text-[11px] text-red-400">{audioError}</p>
            <button
              onClick={startAudio}
              className="mt-2 px-3 py-1 text-[10px] font-bold tracking-wider text-red-400 border border-red-500/30 rounded hover:bg-red-500/10 transition-colors"
            >
              RETRY
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── Main App ───────────────────────────────────────────
  return (
    <div ref={appShellRef} className="flex flex-col min-h-screen bg-[var(--ed-bg-primary)] relative ed-noise app-shell">
      {/* Auto-save indicator */}
      {autoSaveStatus === "restored" && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-50 px-3 py-1 bg-[var(--ed-accent-green)]/10 border border-[var(--ed-accent-green)]/30 rounded-b-lg text-[9px] text-[var(--ed-accent-green)] font-bold tracking-wider animate-pulse">
          SESSION RESTORED
        </div>
      )}

      <Transport
        onOpenBrowser={() => overlay.openOverlay("browser")}
        onOpenEuclidean={() => overlay.openOverlay("euclidean")}
        onOpenSong={() => overlay.openOverlay("song")}
        onOpenScenes={() => overlay.openOverlay("scene")}
        onOpenFx={() => overlay.openOverlay("fxPanel")}
        onOpenMixer={() => overlay.openOverlay("mixer")}
        onOpenKits={() => overlay.openOverlay("kitBrowser")}
        onOpenMidi={() => overlay.openOverlay("midiPlayer")}
        onToggleHelp={() => overlay.toggle("help")}
        onOpenPerformance={() => setSceneMiniOpen((o) => !o)}
      />

      {/* Keyboard Help Bar */}
      {overlay.isOpen("help") && (
        <div className="flex items-center gap-6 px-4 py-1.5 bg-[var(--ed-bg-surface)]/80 backdrop-blur-sm border-b border-[var(--ed-border)] text-[10px] text-[var(--ed-text-muted)] overflow-x-auto overflow-y-hidden" role="status" aria-label="Keyboard shortcuts">
          <span><kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">Q W E R</kbd> <kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">A S D F</kbd> <kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">Z X C V</kbd> = Pads</span>
          <span><kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">Space</kbd> = Play/Stop</span>
          <span><kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">1-6</kbd> = Presets</span>
          <span><kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">&larr; &rarr;</kbd> = Prev/Next</span>
          <span><kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">T</kbd> = Tap Tempo</span>
          <span className="ml-auto hidden sm:inline">Drop audio on pads &middot; Right-click = velocity &middot; Shift+right = ratchet</span>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {/* Main Content — responsive: stack on small screens */}
        <div className="flex min-h-0 flex-1 relative z-10 overflow-hidden">
          {/* Left: Pad Grid + Voice Editor (hidden on small screens) */}
          <div className="hidden md:flex flex-col w-72 lg:w-80 border-r border-[var(--ed-border)] shrink-0">
            <PadGrid />
            <VoiceEditor />
          </div>

          {/* Center: Step Sequencer (always visible) */}
          <div className="flex-1 min-w-0 flex flex-col overflow-auto">
            {/* Mobile: compact pad row above sequencer + edit button */}
            <div className="md:hidden">
              <PadGrid />
              <button
                onClick={() => overlay.openOverlay("mobileVoice")}
                aria-label="Open voice editor"
                className="w-full py-1.5 text-[9px] font-bold tracking-wider text-[var(--ed-accent-orange)]/60 hover:text-[var(--ed-accent-orange)] bg-[var(--ed-bg-surface)]/50 border-t border-b border-[var(--ed-border)]/50 transition-colors"
              >
                VOICE EDITOR
              </button>
            </div>
            <StepSequencer />
          </div>

          {/* Right: Mini Mixer (hidden on small screens) */}
          <div className="hidden lg:block w-44 border-l border-[var(--ed-border)] shrink-0">
            <MixerStrip onOpenMixer={() => overlay.openOverlay("mixer")} />
          </div>
        </div>

        <div className="relative shrink-0">
          <div
            role="separator"
            aria-orientation="horizontal"
            onPointerDown={handleBottomPanelResizeStart}
            onMouseDown={handleBottomPanelResizeStart}
            className="group flex h-[14px] w-full cursor-row-resize touch-none select-none items-center justify-center border-t border-[var(--ed-border)]/50 bg-[var(--ed-bg-secondary)] hover:bg-[var(--ed-bg-elevated)] transition-colors"
            aria-label="Resize drum and synth workspace"
            title="Drag to resize"
            style={{ touchAction: "none" }}
          >
            {/* Visible grab handle — three horizontal lines */}
            <div className="flex flex-col gap-[2px] items-center opacity-30 group-hover:opacity-60 transition-opacity">
              <div className="w-8 h-[1.5px] rounded-full bg-white/60" />
              <div className="w-5 h-[1.5px] rounded-full bg-white/40" />
            </div>
          </div>
        </div>

        <div
          className="shrink-0 overflow-hidden border-t border-[var(--ed-border)]/20 bg-[var(--ed-bg-primary)]"
          style={{ height: bottomPanelHeight }}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {/* FX Rack: 7 effect modules (Reverb, Delay, Filter, Drive, Sidechain, Chorus, Comp) */}
            <FxRack isOpen={fxRackOpen} onToggle={() => setFxRackOpen(o => !o)} />

            {/* Synth Section: Bass / Chords / Melody */}
            <div className="min-h-0 flex-1 overflow-auto">
              <SynthSection />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Voice Editor Overlay */}
      {overlay.isOpen("mobileVoice") && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => overlay.closeOverlay("mobileVoice")} />
          <div className="absolute bottom-0 left-0 right-0 bg-[var(--ed-bg-secondary)] border-t border-[var(--ed-border)] rounded-t-2xl max-h-[70vh] overflow-auto">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--ed-border)]/50">
              <span className="text-[10px] font-bold tracking-wider text-[var(--ed-text-secondary)]">VOICE EDITOR</span>
              <button onClick={() => overlay.closeOverlay("mobileVoice")} aria-label="Close voice editor" className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-sm px-2">&times;</button>
            </div>
            <VoiceEditor />
          </div>
        </div>
      )}

      {/* Overlays */}
      <MixerPanel isOpen={overlay.isOpen("mixer")} onClose={() => overlay.closeOverlay("mixer")} />
      <PatternBrowser isOpen={overlay.isOpen("browser")} onClose={() => overlay.closeOverlay("browser")} />
      <EuclideanGenerator isOpen={overlay.isOpen("euclidean")} onClose={() => overlay.closeOverlay("euclidean")} />
      <SongEditor isOpen={overlay.isOpen("song")} onClose={() => overlay.closeOverlay("song")} />
      <SceneLauncher isOpen={overlay.isOpen("scene")} onClose={() => overlay.closeOverlay("scene")} />
      <FxPanel isOpen={overlay.isOpen("fxPanel")} onClose={() => overlay.closeOverlay("fxPanel")} />
      <KitBrowser isOpen={overlay.isOpen("kitBrowser")} onClose={() => overlay.closeOverlay("kitBrowser")} />
      <MidiPlayerPanel
        isOpen={overlay.isOpen("midiPlayer")}
        onClose={() => overlay.closeOverlay("midiPlayer")}
        onOpenEditor={() => overlay.openOverlay("pianoRoll")}
      />
      <PianoRoll isOpen={overlay.isOpen("pianoRoll")} onClose={() => overlay.closeOverlay("pianoRoll")} />
      {sceneMiniOpen && <SceneMini onClose={() => setSceneMiniOpen(false)} />}
    </div>
  );
}
