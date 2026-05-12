import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  /** Optional one-word eyebrow (e.g. "01 / DRUMS"). */
  eyebrow?: string;
  /** Main caption headline. */
  headline: string;
  /** Optional sub-line under the headline. */
  sub?: string;
  /** Bottom-left | bottom-right | top-left | top-right (default: bottom-left). */
  position?: "tl" | "tr" | "bl" | "br";
}

/**
 * Kinetic caption block — fades in + slides up over the first ~12 frames
 * (using spring physics), then sits still, then fades out over the last
 * 12 frames of its parent <Sequence>.
 *
 * Uses brand color (#f59e0b — same orange as the app's accent) so the
 * video reads as "from the same product".
 */
export const Caption: React.FC<Props> = ({ eyebrow, headline, sub, position = "bl" }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ── Slide-in spring ───────────────────────────────────────
  const entry = spring({ frame, fps, config: { damping: 14, stiffness: 90, mass: 0.6 } });
  const slideY = interpolate(entry, [0, 1], [40, 0]);
  const opacityIn = interpolate(entry, [0, 1], [0, 1]);

  // ── Fade-out over last 12 frames of the scene ─────────────
  const opacityOut = interpolate(
    frame,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const opacity = Math.min(opacityIn, opacityOut);

  // ── Position anchoring ────────────────────────────────────
  const anchor: React.CSSProperties = (() => {
    switch (position) {
      case "tl": return { top: 64,    left: 96,  textAlign: "left"  as const };
      case "tr": return { top: 64,    right: 96, textAlign: "right" as const };
      case "br": return { bottom: 88, right: 96, textAlign: "right" as const };
      default:   return { bottom: 88, left: 96,  textAlign: "left"  as const };
    }
  })();

  return (
    <div
      style={{
        position: "absolute",
        ...anchor,
        opacity,
        transform: `translateY(${slideY}px)`,
        fontFamily: "Inter, system-ui, sans-serif",
        color: "#fff",
      }}
    >
      {eyebrow && (
        <div
          style={{
            fontSize: 18,
            fontWeight: 900,
            letterSpacing: "0.4em",
            color: "#f59e0b",
            marginBottom: 12,
            textTransform: "uppercase",
          }}
        >
          {eyebrow}
        </div>
      )}
      <div
        style={{
          fontSize: 72,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
          textShadow: "0 4px 24px rgba(0,0,0,0.7)",
        }}
      >
        {headline}
      </div>
      {sub && (
        <div
          style={{
            marginTop: 16,
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: "0.01em",
            color: "rgba(255,255,255,0.78)",
            maxWidth: 760,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
};
