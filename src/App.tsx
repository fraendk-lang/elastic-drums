import { PadGrid } from "./components/PadGrid";
import { StepSequencer } from "./components/StepSequencer";
import { Transport } from "./components/Transport";
import { MixerStrip } from "./components/MixerStrip";
import { VoiceEditor } from "./components/VoiceEditor";

export function App() {
  return (
    <div className="flex flex-col h-screen bg-[var(--ed-bg-primary)]">
      {/* Header / Transport */}
      <Transport />

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

        {/* Right: Mixer */}
        <div className="w-64 border-l border-[var(--ed-border)]">
          <MixerStrip />
        </div>
      </div>
    </div>
  );
}
