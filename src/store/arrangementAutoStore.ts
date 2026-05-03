import { create } from "zustand";

export type AutoParam =
  | "volume"       // 0-1 → faderToGain(val*1000)
  | "pan"          // 0-1 → -1..+1
  | "reverb"       // 0-1 send amount
  | "delay"        // 0-1 send amount
  | "filterCutoff" // 0-1 → 80..18 000 Hz (exp)
  | "drive"        // 0-1 → 0..100
  | "chorus"       // 0-1 send amount
  | "eqHi"         // 0-1 → -12..+12 dB (0.5 = flat)
  | "eqMid";       // 0-1 → -12..+12 dB (0.5 = flat)

/** Default (no-point) value per param — used by interpolateAuto */
export const AUTO_PARAM_DEFAULTS: Record<AutoParam, number> = {
  volume:      0.75,
  pan:         0.5,
  reverb:      0,
  delay:       0,
  filterCutoff:1.0,
  drive:       0,
  chorus:      0,
  eqHi:        0.5,
  eqMid:       0.5,
};

/** Context-aware param options per track */
export const TRACK_AUTO_PARAMS: Record<string, { value: AutoParam; label: string }[]> = {
  drums: [
    { value: "volume",  label: "VOL"   },
    { value: "reverb",  label: "REV"   },
    { value: "delay",   label: "DLY"   },
  ],
  bass: [
    { value: "volume",       label: "VOL"    },
    { value: "filterCutoff", label: "FILTER" },
    { value: "drive",        label: "DRIVE"  },
    { value: "eqHi",         label: "EQ HI"  },
    { value: "reverb",       label: "REV"    },
    { value: "delay",        label: "DLY"    },
  ],
  chords: [
    { value: "volume",       label: "VOL"    },
    { value: "filterCutoff", label: "FILTER" },
    { value: "chorus",       label: "CHORUS" },
    { value: "eqHi",         label: "EQ HI"  },
    { value: "reverb",       label: "REV"    },
    { value: "delay",        label: "DLY"    },
  ],
  melody: [
    { value: "volume",       label: "VOL"    },
    { value: "filterCutoff", label: "FILTER" },
    { value: "drive",        label: "DRIVE"  },
    { value: "eqHi",         label: "EQ HI"  },
    { value: "chorus",       label: "CHORUS" },
    { value: "reverb",       label: "REV"    },
    { value: "delay",        label: "DLY"    },
  ],
};

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
 * Pass the param's default via AUTO_PARAM_DEFAULTS[lane.param].
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
