import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { IntroCard } from "./scenes/IntroCard";
import { DrumScene } from "./scenes/DrumScene";
import { BassMelodyScene } from "./scenes/BassMelodyScene";
import { PerformanceScene } from "./scenes/PerformanceScene";
import { ScenesArrangScene } from "./scenes/ScenesArrangScene";
import { OutroCard } from "./scenes/OutroCard";

/**
 * Master 45-second composition. The soundtrack.wav (exported from the
 * Elastic Groove app via `?demo=record&audio=1`) plays under all scenes
 * starting at frame 120 (so the intro card breathes for 4 s).
 *
 * Each <Sequence> hosts one scene component which renders a captured MP4
 * clip from `assets/` plus a kinetic typography caption.
 */
export const ElasticGrooveVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0c" }}>
      {/* Soundtrack — starts at intro-card-end, plays under the rest */}
      <Sequence from={120}>
        <Audio src={staticFile("soundtrack.wav")} />
      </Sequence>

      <Sequence from={0}    durationInFrames={120} layout="none">  <IntroCard />          </Sequence>
      <Sequence from={120}  durationInFrames={300} layout="none">  <DrumScene />          </Sequence>
      <Sequence from={420}  durationInFrames={330} layout="none">  <BassMelodyScene />    </Sequence>
      <Sequence from={750}  durationInFrames={300} layout="none">  <PerformanceScene />   </Sequence>
      <Sequence from={1050} durationInFrames={210} layout="none">  <ScenesArrangScene />  </Sequence>
      <Sequence from={1260} durationInFrames={90}  layout="none">  <OutroCard />          </Sequence>
    </AbsoluteFill>
  );
};
