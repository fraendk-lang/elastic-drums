import type { SongChainEntry } from "../store/drumStore";

/** 8 scene colours — cycled by sceneIndex when no custom color is set */
export const SCENE_COLORS: readonly string[] = [
  "#f97316", // Orange
  "#22c55e", // Green
  "#a855f7", // Purple
  "#ec4899", // Pink
  "#3b82f6", // Blue
  "#f59e0b", // Amber
  "#22d3ee", // Teal
  "#ef4444", // Red
] as const;

/** Loop lane accent colour */
export const LOOP_COLOR = "#22d3ee";

/** Returns the effective hex colour for a chain entry */
export function getEntryColor(entry: Pick<SongChainEntry, "sceneIndex" | "color">): string {
  if (entry.color) return entry.color;
  return SCENE_COLORS[entry.sceneIndex % SCENE_COLORS.length]!;
}

/** Returns display label for a chain entry (1-indexed for UX) */
export function getEntryLabel(entry: Pick<SongChainEntry, "sceneIndex" | "label">): string {
  return entry.label ?? `Scene ${entry.sceneIndex + 1}`;
}

/** Returns a semi-transparent version of a hex color at given opacity 0–1 */
export function hexAlpha(hex: string, alpha: number): string {
  // Expand shorthand #abc → #aabbcc
  const full = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
