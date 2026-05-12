import { AbsoluteFill } from "remotion";
import { AppFootage } from "../components/AppFootage";
import { Caption } from "../components/Caption";

/**
 * 0:14 – 0:25 — Bass-303 + Melody (Piano-Roll).
 * Source clip: assets/bass-melody.mp4 (captured via ?demo=record at bar 4–11).
 */
export const BassMelodyScene: React.FC = () => (
  <AbsoluteFill>
    <AppFootage src="bass-melody.mp4" startFrom={0} />
    <Caption
      eyebrow="02 · Bass + Melody"
      headline="TB-303-Acid + Ableton-Piano-Roll"
      sub="Slide, Accent, Tie · Scale-Snap auf 12 Modi · Drag-to-Pitch im 6-Oktav-Grid."
      position="br"
    />
  </AbsoluteFill>
);
