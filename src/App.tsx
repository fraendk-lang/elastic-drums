import { useState, useCallback } from "react";
import { PadGrid } from "./components/PadGrid";
import { StepSequencer } from "./components/StepSequencer";
import { Transport } from "./components/Transport";
import { MixerStrip } from "./components/MixerStrip";
import { MixerPanel } from "./components/MixerPanel";
import { PatternBrowser } from "./components/PatternBrowser";
import { EuclideanGenerator } from "./components/EuclideanGenerator";
import { SongEditor } from "./components/SongEditor";
import { VoiceEditor } from "./components/VoiceEditor";
import { audioEngine } from "./audio/AudioEngine";
import { useKeyboard } from "./hooks/useKeyboard";
import { useMidi } from "./hooks/useMidi";

export function App() {
  const [audioReady, setAudioReady] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [euclideanOpen, setEuclideanOpen] = useState(false);
  const [songOpen, setSongOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useKeyboard();
  useMidi();

  const startAudio = useCallback(async () => {
    await audioEngine.resume();
    setAudioReady(true);
  }, []);

  if (!audioReady) {
    return (
      <div
        className="flex items-center justify-center h-screen bg-[var(--ed-bg-primary)] cursor-pointer"
        onClick={startAudio}
      >
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-wider text-[var(--ed-accent-orange)] mb-4">
            ELASTIC DRUMS
          </h1>
          <p className="text-[var(--ed-text-secondary)] text-sm mb-8">
            Hybrid Drum Machine — VA Synth + Samples + Elektron Sequencer
          </p>
          <div className="w-20 h-20 mx-auto rounded-full bg-[var(--ed-bg-elevated)] border-2 border-[var(--ed-accent-orange)] flex items-center justify-center hover:bg-[var(--ed-accent-orange)] hover:text-black transition-all">
            <span className="text-2xl ml-1">&#9654;</span>
          </div>
          <p className="text-[var(--ed-text-muted)] text-xs mt-4">
            Click to start audio engine
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--ed-bg-primary)]">
      {/* Header / Transport */}
      <Transport
        onOpenBrowser={() => setBrowserOpen(true)}
        onOpenEuclidean={() => setEuclideanOpen(true)}
        onOpenSong={() => setSongOpen(true)}
        onToggleHelp={() => setShowHelp((h) => !h)}
      />

      {/* Keyboard Help Bar */}
      {showHelp && (
        <div className="flex items-center gap-6 px-4 py-1.5 bg-[var(--ed-bg-surface)] border-b border-[var(--ed-border)] text-[10px] text-[var(--ed-text-muted)]">
          <span><kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">Q W E R</kbd> <kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">A S D F</kbd> <kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">Z X C V</kbd> = Pads</span>
          <span><kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">Space</kbd> = Play/Stop</span>
          <span><kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">1-6</kbd> = Presets</span>
          <span><kbd className="px-1 py-0.5 bg-[var(--ed-bg-elevated)] rounded text-[var(--ed-text-secondary)]">← →</kbd> = Prev/Next</span>
          <span className="ml-auto">Drop audio files on pads to load samples</span>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Pad Grid + Voice Editor */}
        <div className="flex flex-col w-80 border-r border-[var(--ed-border)]">
          <PadGrid />
          <VoiceEditor />
        </div>

        {/* Center: Step Sequencer */}
        <div className="flex-1 min-w-0">
          <StepSequencer />
        </div>

        {/* Right: Mini Mixer */}
        <div className="w-48 border-l border-[var(--ed-border)]">
          <MixerStrip onOpenMixer={() => setMixerOpen(true)} />
        </div>
      </div>

      {/* Overlays */}
      <MixerPanel isOpen={mixerOpen} onClose={() => setMixerOpen(false)} />
      <PatternBrowser isOpen={browserOpen} onClose={() => setBrowserOpen(false)} />
      <EuclideanGenerator isOpen={euclideanOpen} onClose={() => setEuclideanOpen(false)} />
      <SongEditor isOpen={songOpen} onClose={() => setSongOpen(false)} />
    </div>
  );
}
