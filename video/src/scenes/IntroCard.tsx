import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * 4-second intro card. Logo type animates in with a soft spring, claim
 * fades in 18 frames later, then the whole card fades out over the last
 * 18 frames as the Drum scene takes over.
 */
export const IntroCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const titleSpring = spring({ frame, fps, config: { damping: 18, stiffness: 80, mass: 0.5 } });
  const titleY = interpolate(titleSpring, [0, 1], [60, 0]);
  const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);

  const claimOpacity = interpolate(frame, [18, 36], [0, 1], { extrapolateRight: "clamp" });
  const claimY = interpolate(frame, [18, 36], [16, 0], { extrapolateRight: "clamp" });

  const cardFadeOut = interpolate(
    frame,
    [durationInFrames - 18, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(circle at 50% 50%, #1a1a22 0%, #0a0a0c 60%)",
        opacity: cardFadeOut,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          fontSize: 140,
          fontWeight: 900,
          letterSpacing: "-0.04em",
          color: "#fff",
          textAlign: "center",
        }}
      >
        Elastic <span style={{ color: "#f59e0b" }}>Groove</span>
      </div>
      <div
        style={{
          opacity: claimOpacity,
          transform: `translateY(${claimY}px)`,
          marginTop: 24,
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: "0.18em",
          color: "rgba(255,255,255,0.6)",
          textTransform: "uppercase",
        }}
      >
        Browser Groovebox · VA Synth · Sampler · Live
      </div>
    </AbsoluteFill>
  );
};
