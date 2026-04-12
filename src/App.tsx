import { useState, useCallback, useEffect } from "react";
import { PadGrid } from "./components/PadGrid";
import { StepSequencer } from "./components/StepSequencer";
import { Transport } from "./components/Transport";
import { MixerStrip } from "./components/MixerStrip";
import { MixerPanel } from "./components/MixerPanel";
import { PatternBrowser } from "./components/PatternBrowser";
import { EuclideanGenerator } from "./components/EuclideanGenerator";
import { SongEditor } from "./components/SongEditor";
import { KitBrowser } from "./components/KitBrowser";
import { VoiceEditor } from "./components/VoiceEditor";
import { audioEngine } from "./audio/AudioEngine";
import { useDrumStore } from "./store/drumStore";
import { useKeyboard } from "./hooks/useKeyboard";
import { useMidi } from "./hooks/useMidi";
import { loadSharedPattern } from "./utils/patternShare";

export function App() {
  const [audioReady, setAudioReady] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [euclideanOpen, setEuclideanOpen] = useState(false);
  const [songOpen, setSongOpen] = useState(false);
  const [kitBrowserOpen, setKitBrowserOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useKeyboard();
  useMidi();

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
    setAudioReady(true);
  }, []);

  // ─── Splash Screen ──────────────────────────────────────
  if (!audioReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--ed-bg-primary)] overflow-hidden">
        {/* Background grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: "linear-gradient(var(--ed-text-muted) 1px, transparent 1px), linear-gradient(90deg, var(--ed-text-muted) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }} />

        <div className="relative text-center z-10">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="flex gap-1">
              <div className="w-3 h-3 rounded-sm bg-[var(--ed-accent-orange)]" />
              <div className="w-3 h-3 rounded-sm bg-[var(--ed-accent-orange)]" />
              <div className="w-3 h-3 rounded-sm bg-[var(--ed-accent-blue)]" />
              <div className="w-3 h-3 rounded-sm bg-[var(--ed-pad-hybrid)]" />
            </div>
          </div>

          <h1 className="text-4xl font-black tracking-[0.3em] text-[var(--ed-accent-orange)] mb-1">
            ELASTIC DRUMS
          </h1>
          <p className="text-[var(--ed-text-muted)] text-[11px] tracking-[0.15em] uppercase mb-10">
            VA Synth &middot; Sample Engine &middot; Elektron Sequencer
          </p>

          {/* Start button */}
          <button
            onClick={startAudio}
            className="group relative w-24 h-24 mx-auto rounded-full bg-[var(--ed-bg-elevated)] border-2 border-[var(--ed-accent-orange)]/50 flex items-center justify-center hover:border-[var(--ed-accent-orange)] hover:bg-[var(--ed-accent-orange)] transition-all duration-300 cursor-pointer"
          >
            <span className="text-3xl text-[var(--ed-accent-orange)] group-hover:text-black transition-colors ml-1">
              &#9654;
            </span>
            {/* Pulse ring */}
            <div className="absolute inset-0 rounded-full border-2 border-[var(--ed-accent-orange)]/30 animate-ping" />
          </button>

          <p className="text-[var(--ed-text-muted)] text-[10px] mt-6 tracking-wide">
            Click to initialize audio engine
          </p>

          {/* Feature tags */}
          <div className="flex gap-2 justify-center mt-8 flex-wrap max-w-sm mx-auto">
            {["12 Voices", "P-Locks", "Euclidean", "Reverb/Delay", "MIDI", "14 Presets", "WASM DSP"].map((tag) => (
              <span key={tag} className="px-2 py-0.5 text-[9px] rounded-full bg-[var(--ed-bg-surface)] text-[var(--ed-text-muted)] border border-[var(--ed-border)]">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── Main App ───────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-[var(--ed-bg-primary)]">
      <Transport
        onOpenBrowser={() => setBrowserOpen(true)}
        onOpenEuclidean={() => setEuclideanOpen(true)}
        onOpenSong={() => setSongOpen(true)}
        onOpenMixer={() => setMixerOpen(true)}
        onOpenKits={() => setKitBrowserOpen(true)}
        onToggleHelp={() => setShowHelp((h) => !h)}
      />

      {/* Keyboard Help Bar */}
      {showHelp && (
        <div className="flex items-center gap-6 px-4 py-1.5 bg-[var(--ed-bg-surface)] border-b border-[var(--ed-border)] text-[10px] text-[var(--ed-text-muted)]">
          <span><kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">Q W E R</kbd> <kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">A S D F</kbd> <kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">Z X C V</kbd> = Pads</span>
          <span><kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">Space</kbd> = Play/Stop</span>
          <span><kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">1-6</kbd> = Presets</span>
          <span><kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">← →</kbd> = Prev/Next</span>
          <span className="ml-auto">Drop audio on pads &middot; Right-click = velocity &middot; Shift+right = ratchet</span>
        </div>
      )}

      {/* Main Content — responsive: stack on small screens */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Pad Grid + Voice Editor (hidden on small screens, use overlay) */}
        <div className="hidden md:flex flex-col w-72 lg:w-80 border-r border-[var(--ed-border)] shrink-0">
          <PadGrid />
          <VoiceEditor />
        </div>

        {/* Center: Step Sequencer (always visible) */}
        <div className="flex-1 min-w-0">
          {/* Mobile: compact pad row above sequencer */}
          <div className="md:hidden">
            <PadGrid />
          </div>
          <StepSequencer />
        </div>

        {/* Right: Mini Mixer (hidden on small screens) */}
        <div className="hidden lg:block w-44 border-l border-[var(--ed-border)] shrink-0">
          <MixerStrip onOpenMixer={() => setMixerOpen(true)} />
        </div>
      </div>

      {/* Overlays */}
      <MixerPanel isOpen={mixerOpen} onClose={() => setMixerOpen(false)} />
      <PatternBrowser isOpen={browserOpen} onClose={() => setBrowserOpen(false)} />
      <EuclideanGenerator isOpen={euclideanOpen} onClose={() => setEuclideanOpen(false)} />
      <SongEditor isOpen={songOpen} onClose={() => setSongOpen(false)} />
      <KitBrowser isOpen={kitBrowserOpen} onClose={() => setKitBrowserOpen(false)} />
    </div>
  );
}
