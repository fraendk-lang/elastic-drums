import { AbsoluteFill } from "remotion";
import { AppFootage } from "../components/AppFootage";
import { Caption } from "../components/Caption";

/**
 * 0:25 – 0:35 — Performance Pad + FX.
 * Source clip: assets/performance-fx.mp4 (captured at bar 12–16 with the
 * filter-sweep + send-rev automation running).
 */
export const PerformanceScene: React.FC = () => (
  <AbsoluteFill>
    <AppFootage src="performance-fx.mp4" startFrom={0} />
    <Caption
      eyebrow="03 · Live FX"
      headline="Performance-Pad + Korg-Kaoss-FX"
      sub="XY-Modulation auf Cutoff, Reverb, Delay, Drive · Beat-Repeat · Crossfader · MIDI-CC-Learn."
      position="bl"
    />
  </AbsoluteFill>
);
