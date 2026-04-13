import { useState, useCallback, useEffect } from "react";
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
import { SynthSection } from "./components/SynthSection";
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
import { useKeyboard } from "./hooks/useKeyboard";
import { useMidi } from "./hooks/useMidi";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { loadSharedPattern } from "./utils/patternShare";

export function App() {
  const [audioReady, setAudioReady] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [euclideanOpen, setEuclideanOpen] = useState(false);
  const [songOpen, setSongOpen] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [fxPanelOpen, setFxPanelOpen] = useState(false);
  const [kitBrowserOpen, setKitBrowserOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [mobileVoiceOpen, setMobileVoiceOpen] = useState(false);

  useKeyboard();
  useMidi();
  useUndoRedo();

  // Load shared pattern from URL hash on mount
  useEffect(() => {
    const shared = loadSharedPattern();
    if (shared) {
      useDrumStore.setState({
        pattern: shared.pattern,
        bpm: shared.bpm,
        currentPatternIndex: -1,
      });
    }
  }, []);

  const startAudio = useCallback(async () => {
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
    });
    // Expose drum store for bass scheduler to read BPM
    (window as unknown as Record<string, unknown>).__drumStore = useDrumStore;
    // Register scene store for song mode integration
    setSceneStoreRef(useSceneStore as unknown as Parameters<typeof setSceneStoreRef>[0]);
    return unsub;
  }, []);

  // ─── Audio Init Overlay ──────────────────────────────────
  if (!audioReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--ed-bg-primary)] ed-noise">
        <button
          onClick={startAudio}
          className="group relative w-20 h-20 rounded-full bg-[var(--ed-bg-elevated)] border-2 border-[var(--ed-accent-orange)]/40 flex items-center justify-center hover:border-[var(--ed-accent-orange)] hover:bg-[var(--ed-accent-orange)] transition-all duration-300 cursor-pointer hover:shadow-[0_0_40px_rgba(245,158,11,0.3)]"
        >
          <span className="text-2xl text-[var(--ed-accent-orange)] group-hover:text-black transition-colors ml-1">
            &#9654;
          </span>
          <div className="absolute inset-0 rounded-full border-2 border-[var(--ed-accent-orange)]/20 animate-ping" />
        </button>
      </div>
    );
  }

  // ─── Main App ───────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-[var(--ed-bg-primary)] relative ed-noise">
      <Transport
        onOpenBrowser={() => setBrowserOpen(true)}
        onOpenEuclidean={() => setEuclideanOpen(true)}
        onOpenSong={() => setSongOpen(true)}
        onOpenScenes={() => setSceneOpen(true)}
        onOpenFx={() => setFxPanelOpen(true)}
        onOpenMixer={() => setMixerOpen(true)}
        onOpenKits={() => setKitBrowserOpen(true)}
        onToggleHelp={() => setShowHelp((h) => !h)}
      />

      {/* Keyboard Help Bar */}
      {showHelp && (
        <div className="flex items-center gap-6 px-4 py-1.5 bg-[var(--ed-bg-surface)]/80 backdrop-blur-sm border-b border-[var(--ed-border)] text-[10px] text-[var(--ed-text-muted)]">
          <span><kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">Q W E R</kbd> <kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">A S D F</kbd> <kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">Z X C V</kbd> = Pads</span>
          <span><kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">Space</kbd> = Play/Stop</span>
          <span><kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">1-6</kbd> = Presets</span>
          <span><kbd className="px-1.5 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)] border border-[var(--ed-border)]/50">&larr; &rarr;</kbd> = Prev/Next</span>
          <span className="ml-auto hidden sm:inline">Drop audio on pads &middot; Right-click = velocity &middot; Shift+right = ratchet</span>
        </div>
      )}

      {/* Main Content — responsive: stack on small screens */}
      <div className="flex flex-1 min-h-0 relative z-10 overflow-hidden">
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
              onClick={() => setMobileVoiceOpen(true)}
              className="w-full py-1.5 text-[9px] font-bold tracking-wider text-[var(--ed-accent-orange)]/60 hover:text-[var(--ed-accent-orange)] bg-[var(--ed-bg-surface)]/50 border-t border-b border-[var(--ed-border)]/50 transition-colors"
            >
              VOICE EDITOR
            </button>
          </div>
          <StepSequencer />
        </div>

        {/* Right: Mini Mixer (hidden on small screens) */}
        <div className="hidden lg:block w-44 border-l border-[var(--ed-border)] shrink-0">
          <MixerStrip onOpenMixer={() => setMixerOpen(true)} />
        </div>
      </div>

      {/* Synth Section: Bass / Chords / Melody */}
      <SynthSection />

      {/* Mobile Voice Editor Overlay */}
      {mobileVoiceOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileVoiceOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-[var(--ed-bg-secondary)] border-t border-[var(--ed-border)] rounded-t-2xl max-h-[70vh] overflow-auto">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--ed-border)]/50">
              <span className="text-[10px] font-bold tracking-wider text-[var(--ed-text-secondary)]">VOICE EDITOR</span>
              <button onClick={() => setMobileVoiceOpen(false)} className="text-[var(--ed-text-muted)] hover:text-[var(--ed-text-primary)] text-sm px-2">&times;</button>
            </div>
            <VoiceEditor />
          </div>
        </div>
      )}

      {/* Overlays */}
      <MixerPanel isOpen={mixerOpen} onClose={() => setMixerOpen(false)} />
      <PatternBrowser isOpen={browserOpen} onClose={() => setBrowserOpen(false)} />
      <EuclideanGenerator isOpen={euclideanOpen} onClose={() => setEuclideanOpen(false)} />
      <SongEditor isOpen={songOpen} onClose={() => setSongOpen(false)} />
      <SceneLauncher isOpen={sceneOpen} onClose={() => setSceneOpen(false)} />
      <FxPanel isOpen={fxPanelOpen} onClose={() => setFxPanelOpen(false)} />
      <KitBrowser isOpen={kitBrowserOpen} onClose={() => setKitBrowserOpen(false)} />
    </div>
  );
}
