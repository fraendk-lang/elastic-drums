import { create } from "zustand";

export type AutoParam = "volume" | "pan" | "reverb" | "delay";

export interface AutoPoint {
  bar:   number;  // 0-based bar index
  value: number;  // 0-1 normalised
}

export interface AutoLane {
  param:  AutoParam;
  points: AutoPoint[];
}

interface ArrangementAutoState {
  lanes:     Record<string, AutoLane>;   // keyed by trackId
  openLanes: Record<string, boolean>;    // which tracks have the lane open

  toggleLane: (trackId: string) => void;
  setParam:   (trackId: string, param: AutoParam)     => void;
  setPoints:  (trackId: string, points: AutoPoint[])  => void;
}

const defaultLane = (): AutoLane => ({ param: "volume", points: [] });

export const useArrangementAutoStore = create<ArrangementAutoState>((set) => ({
  lanes:     {},
  openLanes: {},

  toggleLane: (id) =>
    set((s) => {
      const open = !s.openLanes[id];
      return {
        openLanes: { ...s.openLanes, [id]: open },
        lanes: open && !s.lanes[id]
          ? { ...s.lanes, [id]: defaultLane() }
          : s.lanes,
      };
    }),

  setParam: (id, param) =>
    set((s) => ({
      lanes: { ...s.lanes, [id]: { ...(s.lanes[id] ?? defaultLane()), param } },
    })),

  setPoints: (id, points) =>
    set((s) => ({
      lanes: { ...s.lanes, [id]: { ...(s.lanes[id] ?? defaultLane()), points } },
    })),
}));

/**
 * Stepped interpolation — holds value until next point.
 * Returns defaultValue (0.75 = unity) when no points are defined.
 */
export function interpolateAuto(points: AutoPoint[], bar: number, def = 0.75): number {
  if (points.length === 0) return def;
  const sorted = [...points].sort((a, b) => a.bar - b.bar);
  if (bar <= sorted[0]!.bar) return sorted[0]!.value;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]!.bar <= bar) return sorted[i]!.value;
  }
  return def;
}

/** Track ID → mixer channel mapping (matches ArrangementView TRACK_MIXER) */
export const AUTO_TRACK_CHANNELS: Record<string, number | null> = {
  drums:  null,  // group bus
  bass:   12,
  chords: 13,
  melody: 14,
};
