import { AbsoluteFill } from "remotion";
import { AppFootage } from "../components/AppFootage";
import { Caption } from "../components/Caption";

/**
 * 0:04 – 0:14 — Drums + Pads.
 * Source clip: assets/drums.mp4 (captured via ?demo=record at bar 0–5).
 */
export const DrumScene: React.FC = () => (
  <AbsoluteFill>
    <AppFootage src="drums.mp4" startFrom={0} />
    <Caption
      eyebrow="01 · Drums"
      headline="Step-Sequencer + 12 VA-Drums"
      sub="Conditional Trigs, Ratchets, Swing, Per-Pad-P-Locks. Tight wie Elektron, schnell wie ein TR-808."
      position="bl"
    />
  </AbsoluteFill>
);
