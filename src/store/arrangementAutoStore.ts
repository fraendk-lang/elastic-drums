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
  volume:       0.75,
  pan:          0.5,
  reverb:       0,
  delay:        0,
  filterCutoff: 1.0,
  drive:        0,
  chorus:       0,
  eqHi:         0.5,
  eqMid:        0.5,
};

/** Context-aware param options per track */
export const TRACK_AUTO_PARAMS: Record<string, { value: AutoParam; label: string }[]> = {
  drums: [
    { value: "volume",  label: "VOL" },
    { value: "reverb",  label: "REV" },
    { value: "delay",   label: "DLY" },
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
  id:     string;
  param:  AutoParam;
  points: AutoPoint[];
  open:   boolean;
}

interface ArrangementAutoState {
  /** trackId → ordered array of lanes */
  lanes: Record<string, AutoLane[]>;

  addLane:    (trackId: string) => void;
  removeLane: (trackId: string, laneId: string) => void;
  toggleLane: (trackId: string, laneId: string) => void;
  setParam:   (trackId: string, laneId: string, param: AutoParam)    => void;
  setPoints:  (trackId: string, laneId: string, points: AutoPoint[]) => void;
}

let _laneSeq = 0;
const newLaneId = () => `lane-${++_laneSeq}`;

/** Pick the first param not already used in this track, or "volume" */
function nextParam(trackId: string, existingLanes: AutoLane[]): AutoParam {
  const options = TRACK_AUTO_PARAMS[trackId] ?? TRACK_AUTO_PARAMS["melody"]!;
  const used = new Set(existingLanes.map((l) => l.param));
  return options.find((o) => !used.has(o.value))?.value ?? "volume";
}

export const useArrangementAutoStore = create<ArrangementAutoState>((set) => ({
  lanes: {},

  addLane: (trackId) =>
    set((s) => {
      const existing = s.lanes[trackId] ?? [];
      const lane: AutoLane = {
        id:     newLaneId(),
        param:  nextParam(trackId, existing),
        points: [],
        open:   true,
      };
      return { lanes: { ...s.lanes, [trackId]: [...existing, lane] } };
    }),

  removeLane: (trackId, laneId) =>
    set((s) => ({
      lanes: {
        ...s.lanes,
        [trackId]: (s.lanes[trackId] ?? []).filter((l) => l.id !== laneId),
      },
    })),

  toggleLane: (trackId, laneId) =>
    set((s) => ({
      lanes: {
        ...s.lanes,
        [trackId]: (s.lanes[trackId] ?? []).map((l) =>
          l.id === laneId ? { ...l, open: !l.open } : l,
        ),
      },
    })),

  setParam: (trackId, laneId, param) =>
    set((s) => ({
      lanes: {
        ...s.lanes,
        [trackId]: (s.lanes[trackId] ?? []).map((l) =>
          l.id === laneId ? { ...l, param } : l,
        ),
      },
    })),

  setPoints: (trackId, laneId, points) =>
    set((s) => ({
      lanes: {
        ...s.lanes,
        [trackId]: (s.lanes[trackId] ?? []).map((l) =>
          l.id === laneId ? { ...l, points } : l,
        ),
      },
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
  if (bar >= sorted[sorted.length - 1]!.bar) return sorted[sorted.length - 1]!.value;
  // Linear interpolation between adjacent points for smooth automation
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (bar >= a.bar && bar <= b.bar) {
      const t = (bar - a.bar) / (b.bar - a.bar);
      return a.value + t * (b.value - a.value);
    }
  }
  return def;
}

/** Track ID → mixer channel mapping */
export const AUTO_TRACK_CHANNELS: Record<string, number | null> = {
  drums:  null,  // group bus
  bass:   12,
  chords: 13,
  melody: 14,
};
