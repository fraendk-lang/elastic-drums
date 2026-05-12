import { AbsoluteFill } from "remotion";
import { AppFootage } from "../components/AppFootage";
import { Caption } from "../components/Caption";

/**
 * 0:35 – 0:42 — Scenes / Arrangement / Live-Performance.
 * Source clip: assets/scenes.mp4 (captured at bar 16–20 around the scene
 * transition queued by the orchestrator at bar 16).
 */
export const ScenesArrangScene: React.FC = () => (
  <AbsoluteFill>
    <AppFootage src="scenes.mp4" startFrom={0} />
    <Caption
      eyebrow="04 · Live-Arrangement"
      headline="Scenes · Clip-Launcher · Tempo-Ramp"
      sub="16 Scenes, quantisierte Übergänge, Follow-Actions. Jam wie Ableton, im Browser."
      position="br"
    />
  </AbsoluteFill>
);
