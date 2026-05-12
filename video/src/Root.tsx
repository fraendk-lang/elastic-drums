import { Composition } from "remotion";
import { ElasticGrooveVideo } from "./ElasticGrooveVideo";

/**
 * Master composition: 45 s @ 30 fps = 1350 frames, 1920×1080, H.264 output.
 *
 * Frame budget per segment (30 fps):
 *   Intro          0 –  120  ( 4 s)
 *   Drums        120 –  420  (10 s)
 *   Bass+Melody  420 –  750  (11 s)
 *   Performance  750 – 1050  (10 s)
 *   Scenes      1050 – 1260  ( 7 s)
 *   Outro       1260 – 1350  ( 3 s)
 */
export const RemotionRoot: React.FC = () => (
  <Composition
    id="ElasticGrooveVideo"
    component={ElasticGrooveVideo}
    durationInFrames={1350}
    fps={30}
    width={1920}
    height={1080}
  />
);
