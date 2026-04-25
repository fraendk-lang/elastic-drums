import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { PadGrid } from "./components/PadGrid";
import { StepSequencer } from "./components/StepSequencer";
import { Transport } from "./components/Transport";
import { MixerStrip } from "./components/MixerStrip";
import { MixerBar } from "./components/MixerBar";
import { VoiceEditor } from "./components/VoiceEditor";
import { FxRack } from "./components/FxRack";
import { SynthSection } from "./components/SynthSection";
import { SceneMini } from "./components/SceneMini";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Lazy-loaded overlays — pulled in only when opened for the first time
const MixerPanel = lazy(() => import("./components/MixerPanel").then((m) => ({ default: m.MixerPanel })));
const PatternBrowser = lazy(() => import("./components/PatternBrowser").then((m) => ({ default: m.PatternBrowser })));
const EuclideanGenerator = lazy(() => import("./components/EuclideanGenerator").then((m) => ({ default: m.EuclideanGenerator })));
const SongEditor = lazy(() => import("./components/SongEditor").then((m) => ({ default: m.SongEditor })));
const SceneLauncher = lazy(() => import("./components/SceneLauncher").then((m) => ({ default: m.SceneLauncher })));
const FxPanel = lazy(() => import("./components/FxPanel").then((m) => ({ default: m.FxPanel })));
const KitBrowser = lazy(() => import("./components/KitBrowser").then((m) => ({ default: m.KitBrowser })));
const MidiPlayerPanel = lazy(() => import("./components/MidiPlayerPanel").then((m) => ({ default: m.MidiPlayerPanel })));
const PianoRoll = lazy(() => import("./components/PianoRoll").then((m) => ({ default: m.PianoRoll })));
const ClipLauncher = lazy(() => import("./components/ClipLauncher").then((m) => ({ default: m.ClipLauncher })));
const ArrangementView = lazy(() => import("./components/ArrangementView").then((m) => ({ default: m.ArrangementView })));
const ModMatrixEditor = lazy(() => import("./components/ModMatrixEditor").then((m) => ({ default: m.ModMatrixEditor })));
const MacroPanel = lazy(() => import("./components/MacroPanel").then((m) => ({ default: m.MacroPanel })));
const MidiLearnPanel = lazy(() => import("./components/MidiLearnPanel").then((m) => ({ default: m.MidiLearnPanel })));
const MidiClockPanel = lazy(() => import("./components/MidiClockPanel").then((m) => ({ default: m.MidiClockPanel })));
const UserGuide = lazy(() => import("./components/UserGuide").then((m) => ({ default: m.UserGuide })));
const PerformancePad = lazy(() => import("./components/PerformancePad").then((m) => ({ default: m.PerformancePad })));
const MelodyGenerator = lazy(() => import("./components/MelodyGenerator").then((m) => ({ default: m.MelodyGenerator })));
import { getMidiClockMode, subscribeMidiClockMode } from "./store/midiClockMode";
import { bassEngine } from "./audio/BassEngine";
import { chordsEngine } from "./audio/ChordsEngine";
import { melodyEngine } from "./audio/MelodyEngine";
import { samplerEngine } from "./audio/SamplerEngine";
import { loopPlayerEngine } from "./audio/LoopPlayerEngine";
import { useBassStore, startBassScheduler, stopBassScheduler } from "./store/bassStore";
import { useChordsStore, startChordsScheduler, stopChordsScheduler } from "./store/chordsStore";
import { useMelodyStore, startMelodyScheduler, stopMelodyScheduler } from "./store/melodyStore";
import { startSamplerScheduler, stopSamplerScheduler } from "./store/samplerStore";
import { useSceneStore } from "./store/sceneStore";
import { useClipStore } from "./store/clipStore";
import { setSceneStoreRef, setClipStoreRef } from "./store/drumStore";
import { audioEngine } from "./audio/AudioEngine";
import { useDrumStore } from "./store/drumStore";
import { useOverlayStore } from "./store/overlayStore";
import { useKeyboard } from "./hooks/useKeyboard";
import { useMidi } from "./hooks/useMidi";
import { useMidiClock } from "./hooks/useMidiClock";
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

  // MIDI Clock sync — mode is set via MidiClockPanel UI
  const [midiClockMode, setMidiClockModeState] = useState<"off" | "send" | "receive">(getMidiClockMode());
  useEffect(() => subscribeMidiClockMode(() => setMidiClockModeState(getMidiClockMode())), []);
  const bpm = useDrumStore((s) => s.bpm);
  const isPlaying = useDrumStore((s) => s.isPlaying);
  const setBpm = useDrumStore((s) => s.setBpm);
  const togglePlay = useDrumStore((s) => s.togglePlay);
  const midiClock = useMidiClock({
    mode: midiClockMode,
    bpm,
    isPlaying,
    onExternalBpm: (b) => setBpm(b),
    onExternalStart: () => { if (!useDrumStore.getState().isPlaying) togglePlay(); },
    onExternalStop: () => { if (useDrumStore.getState().isPlaying) togglePlay(); },
  });

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
      if (!data) return;
      if (data.drumPattern) {
        useDrumStore.setState({
          pattern: data.drumPattern as never,
          bpm: data.bpm ?? 120,
        });
      }
      if (data.bassState) {
        useBassStore.getState().loadBassPattern(data.bassState as Parameters<ReturnType<typeof useBassStore.getState>["loadBassPattern"]>[0]);
      }
      if (data.chordsState) {
        useChordsStore.getState().loadChordsPattern(data.chordsState as Parameters<ReturnType<typeof useChordsStore.getState>["loadChordsPattern"]>[0]);
      }
      if (data.melodyState) {
        useMelodyStore.getState().loadMelodyPattern(data.melodyState as Parameters<ReturnType<typeof useMelodyStore.getState>["loadMelodyPattern"]>[0]);
      }
      if (data.drumPattern || data.bassState || data.chordsState || data.melodyState) {
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

    const triggerSave = () => {
      scheduleAutoSave(() => {
        const drum = useDrumStore.getState();
        const bass = useBassStore.getState();
        const chords = useChordsStore.getState();
        const melody = useMelodyStore.getState();
        return {
          drumPattern: drum.pattern,
          bpm: drum.bpm,
          swing: drum.swing,
          bassState: {
            steps: bass.steps,
            length: bass.length,
            params: bass.params,
            rootNote: bass.rootNote,
            rootName: bass.rootName,
            scaleName: bass.scaleName,
          },
          chordsState: {
            steps: chords.steps,
            length: chords.length,
            params: chords.params,
            rootNote: chords.rootNote,
            rootName: chords.rootName,
            scaleName: chords.scaleName,
          },
          melodyState: {
            steps: melody.steps,
            length: melody.length,
            params: melody.params,
            rootNote: melody.rootNote,
            rootName: melody.rootName,
            scaleName: melody.scaleName,
          },
          timestamp: Date.now(),
        };
      });
    };

    const unsubDrum   = useDrumStore.subscribe(triggerSave);
    const unsubBass   = useBassStore.subscribe(triggerSave);
    const unsubChords = useChordsStore.subscribe(triggerSave);
    const unsubMelody = useMelodyStore.subscribe(triggerSave);

    return () => {
      unsubDrum();
      unsubBass();
      unsubChords();
      unsubMelody();
    };
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

        // Sampler → Ch 15 (dedicated mixer strip: EQ, sends, fader, meter)
        samplerEngine.init(ctx);
        const samplerOut = samplerEngine.getOutput();
        const samplerCh  = audioEngine.getChannelOutput(15);
        if (samplerOut && samplerCh) samplerOut.connect(samplerCh);

        // Loop Player → Channel 16 (dedicated mixer strip: EQ, sends, fader, meter)
        loopPlayerEngine.init(ctx);
        const loopOut = loopPlayerEngine.getOutput();
        const loopCh  = audioEngine.getChannelOutput(16);
        if (loopOut && loopCh) loopOut.connect(loopCh);
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
        startSamplerScheduler();
      }
      if (!state.isPlaying && prev.isPlaying) {
        stopBassScheduler();
        stopChordsScheduler();
        stopMelodyScheduler();
        stopSamplerScheduler();
      }

      // Sync transport store (replaces window.__drumStore hack)
      if (state.bpm !== prev.bpm) useTransportStore.getState().setBpm(state.bpm);
      if (state.isPlaying !== prev.isPlaying) useTransportStore.getState().setPlaying(state.isPlaying);
      if (state.swing !== prev.swing) useTransportStore.getState().setSwing(state.swing);
    });

    // Initialize transport store with current values
    const { bpm, isPlaying, swing } = useDrumStore.getState();
    useTransportStore.setState({ bpm, isPlaying, swing });

    // Legacy compat: still set window ref for any code that reads it
    (window as unknown as Record<string, unknown>).__drumStore = useDrumStore;
    // Register scene store for song mode integration
    setSceneStoreRef(useSceneStore as unknown as Parameters<typeof setSceneStoreRef>[0]);
    setClipStoreRef(useClipStore as unknown as Parameters<typeof setClipStoreRef>[0]);
    return unsub;
  }, []);

  useEffect(() => {
    const clampBottomHeight = () => {
      const viewportHeight = window.innerHeight;
      const maxHeight = Math.max(minBottomPanelHeight, Math.floor(viewportHeight * 0.85));
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
      const maxHeight = Math.max(minHeight, Math.floor(viewportHeight * 0.85));
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
    <ErrorBoundary>
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
        onOpenClips={() => overlay.openOverlay("clipLauncher")}
        onOpenArrangement={() => overlay.openOverlay("arrangement")}
        onOpenModMatrix={() => overlay.openOverlay("modMatrix")}
        onOpenMacros={() => overlay.openOverlay("macros")}
        onOpenMidiLearn={() => overlay.openOverlay("midiLearn")}
        onOpenMidiClock={() => overlay.openOverlay("midiClock")}
        onOpenFx={() => overlay.openOverlay("fxPanel")}
        onOpenMixer={() => overlay.openOverlay("mixer")}
        onOpenKits={() => overlay.openOverlay("kitBrowser")}
        onOpenMidi={() => overlay.openOverlay("midiPlayer")}
        onToggleHelp={() => overlay.openOverlay("userGuide")}
        onOpenPad={() => overlay.openOverlay("performancePad")}
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

        {/* Permanent Mixer Bar — always visible below sequencer */}
        <MixerBar />

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

      {/* Overlays — lazy-loaded, only mounted when open */}
      <Suspense fallback={null}>
        {overlay.isOpen("mixer") && <MixerPanel isOpen onClose={() => overlay.closeOverlay("mixer")} />}
        {overlay.isOpen("browser") && <PatternBrowser isOpen onClose={() => overlay.closeOverlay("browser")} />}
        {overlay.isOpen("euclidean") && <EuclideanGenerator isOpen onClose={() => overlay.closeOverlay("euclidean")} />}
        {overlay.isOpen("song") && <SongEditor isOpen onClose={() => overlay.closeOverlay("song")} />}
        {overlay.isOpen("scene") && <SceneLauncher isOpen onClose={() => overlay.closeOverlay("scene")} />}
        {overlay.isOpen("fxPanel") && <FxPanel isOpen onClose={() => overlay.closeOverlay("fxPanel")} />}
        {overlay.isOpen("kitBrowser") && <KitBrowser isOpen onClose={() => overlay.closeOverlay("kitBrowser")} />}
        {overlay.isOpen("midiPlayer") && (
          <MidiPlayerPanel
            isOpen
            onClose={() => overlay.closeOverlay("midiPlayer")}
            onOpenEditor={() => overlay.openOverlay("pianoRoll")}
          />
        )}
        {overlay.isOpen("pianoRoll") && <PianoRoll isOpen onClose={() => overlay.closeOverlay("pianoRoll")} />}
        {overlay.isOpen("clipLauncher") && <ClipLauncher isOpen onClose={() => overlay.closeOverlay("clipLauncher")} />}
        {overlay.isOpen("arrangement") && <ArrangementView isOpen onClose={() => overlay.closeOverlay("arrangement")} />}
        {overlay.isOpen("modMatrix") && <ModMatrixEditor isOpen onClose={() => overlay.closeOverlay("modMatrix")} />}
        {overlay.isOpen("macros") && <MacroPanel isOpen onClose={() => overlay.closeOverlay("macros")} />}
        {overlay.isOpen("midiLearn") && <MidiLearnPanel isOpen onClose={() => overlay.closeOverlay("midiLearn")} />}
        {overlay.isOpen("midiClock") && (
          <MidiClockPanel
            isOpen
            onClose={() => overlay.closeOverlay("midiClock")}
            getOutputs={midiClock.getOutputs}
            selectOutput={midiClock.selectOutput}
          />
        )}
        {overlay.isOpen("userGuide") && <UserGuide isOpen onClose={() => overlay.closeOverlay("userGuide")} />}
        {overlay.isOpen("performancePad") && <PerformancePad isOpen onClose={() => overlay.closeOverlay("performancePad")} />}
        {overlay.isOpen("melodyGen") && <MelodyGenerator isOpen onClose={() => overlay.closeOverlay("melodyGen")} />}
      </Suspense>
      {sceneMiniOpen && <SceneMini onClose={() => setSceneMiniOpen(false)} />}
    </div>
    </ErrorBoundary>
  );
}
