import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * 3-second outro — URL + soft CTA.
 */
export const OutroCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entry = spring({ frame, fps, config: { damping: 18, stiffness: 80, mass: 0.5 } });
  const titleY = interpolate(entry, [0, 1], [40, 0]);
  const titleOpacity = interpolate(entry, [0, 1], [0, 1]);
  const subOpacity = interpolate(frame, [12, 30], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(circle at 50% 50%, #1a1a22 0%, #0a0a0c 60%)",
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
          fontSize: 96,
          fontWeight: 900,
          letterSpacing: "-0.03em",
          color: "#fff",
          textAlign: "center",
        }}
      >
        elasticgroove<span style={{ color: "#f59e0b" }}>.app</span>
      </div>
      <div
        style={{
          opacity: subOpacity,
          marginTop: 18,
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: "0.22em",
          color: "rgba(255,255,255,0.5)",
          textTransform: "uppercase",
        }}
      >
        Open in any browser · No install required
      </div>
    </AbsoluteFill>
  );
};
