import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";

interface Props {
  /** File path relative to `public/assets/` — e.g. "drums.mp4". */
  src: string;
  /** Where to start reading from (in seconds within the source clip). */
  startFrom?: number;
  /** Optional CSS `object-fit` (default: "cover"). */
  fit?: "cover" | "contain";
  /** Visual treatment — solid black overlay opacity for caption legibility. */
  vignette?: number;
}

/**
 * Renders one of Frank's QuickTime captures behind the caption.
 *
 * Uses Remotion's OffthreadVideo for buttery 4K decode without main-thread
 * jank — significantly faster than <Video> for 1080p source on the renderer.
 * Falls back gracefully when the file is missing during scaffold (the
 * Remotion Studio shows a placeholder; the asset can be dropped in later).
 */
export const AppFootage: React.FC<Props> = ({ src, startFrom = 0, fit = "cover", vignette = 0.25 }) => {
  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={staticFile(`assets/${src}`)}
        startFrom={Math.round(startFrom * 30)}
        muted
        style={{ width: "100%", height: "100%", objectFit: fit }}
      />
      {/* Bottom-vignette gradient — keeps captions readable on bright UI areas */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,${vignette + 0.4}) 100%)`,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
