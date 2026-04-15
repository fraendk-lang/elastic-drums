/**
 * Factory Preset Patterns
 * Extracted from drumStore to reduce file size and improve maintainability.
 */

import type { PatternData, TrackData, StepData } from "../store/drumStore";

// Re-export for convenience
export type { PatternData };

function createEmptyStep(): StepData {
  return {
    active: false,
    velocity: 100,
    microTiming: 0,
    probability: 100,
    ratchetCount: 1,
    condition: "always",
    gateLength: 1,
    paramLocks: {},
  };
}

function createEmptyTrack(): TrackData {
  return {
    steps: Array.from({ length: 64 }, createEmptyStep),
    mute: false,
    solo: false,
    volume: 100,
    pan: 0,
    length: 16,
  };
}

export function createEmptyPattern(): PatternData {
  return {
    name: "A01",
    tracks: Array.from({ length: 12 }, createEmptyTrack),
    length: 16,
    swing: 50,
  };
}

function createPresetPattern(
  name: string,
  length: number,
  swing: number,
  data: Record<number, { steps: number[]; vel?: number[] }>,
): PatternData {
  const pattern = createEmptyPattern();
  pattern.name = name;
  pattern.length = length;
  pattern.swing = swing;

  for (const [track, info] of Object.entries(data)) {
    const t = Number(track);
    const trackData = pattern.tracks[t]!;
    trackData.length = length;
    for (let i = 0; i < info.steps.length; i++) {
      const stepIdx = info.steps[i]!;
      trackData.steps[stepIdx]!.active = true;
      if (info.vel?.[i] !== undefined) {
        trackData.steps[stepIdx]!.velocity = info.vel[i]!;
      }
    }
  }
  return pattern;
}

export const PRESET_PATTERNS: PatternData[] = [
  createPresetPattern("808 Boom", 16, 54, {
    0: { steps: [0, 6, 10], vel: [127, 90, 110] },
    1: { steps: [4, 12], vel: [120, 110] },
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [100, 60, 80, 60, 100, 60, 80, 60] },
    7: { steps: [3, 11] },
  }),
  createPresetPattern("909 House", 16, 50, {
    0: { steps: [0, 4, 8, 12], vel: [127, 120, 127, 120] },
    2: { steps: [4, 12], vel: [110, 100] },
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [110, 70, 100, 70, 110, 70, 100, 70] },
    7: { steps: [2, 6, 10, 14], vel: [60, 80, 60, 80] },
  }),
  createPresetPattern("Trap 808", 16, 50, {
    0: { steps: [0, 3, 7, 10, 14], vel: [127, 100, 110, 90, 100] },
    1: { steps: [4, 12] },
    6: { steps: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], vel: [100,50,70,50,100,50,70,50,100,50,70,50,100,50,70,50] },
    7: { steps: [6, 14] },
  }),
  createPresetPattern("Electro", 16, 50, {
    0: { steps: [0, 3, 8, 11], vel: [127, 100, 120, 95] },
    1: { steps: [4, 12] },
    2: { steps: [7, 15], vel: [80, 90] },
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14] },
    3: { steps: [6, 14], vel: [80, 70] },
  }),
  createPresetPattern("DnB Amen", 16, 50, {
    0: { steps: [0, 4, 9, 10], vel: [127, 100, 110, 80] },
    1: { steps: [4, 10, 12], vel: [120, 100, 110] },
    6: { steps: [0,2,4,5,6,8,10,12,13,14], vel: [100,60,90,50,80,100,60,90,50,80] },
    9: { steps: [0, 8], vel: [70, 60] },
  }),
  createPresetPattern("Dembow", 16, 50, {
    0: { steps: [0, 7], vel: [127, 100] },
    1: { steps: [3, 7, 11, 15], vel: [120, 80, 110, 80] },
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14] },
    10: { steps: [2, 6, 10, 14], vel: [70, 60, 70, 60] },
  }),
  createPresetPattern("Lo-Fi", 16, 58, {
    0: { steps: [0, 5, 10], vel: [110, 80, 95] },
    1: { steps: [4, 12], vel: [100, 90] },
    6: { steps: [0,2,4,6,8,10,12,14], vel: [80,40,65,40,80,40,65,40] },
    10: { steps: [7, 15], vel: [50, 45] },
  }),
  createPresetPattern("Deep House", 16, 52, {
    0: { steps: [0, 4, 8, 12], vel: [120, 115, 120, 115] },
    2: { steps: [4, 12], vel: [90, 85] },
    6: { steps: [2, 6, 10, 14], vel: [90, 70, 90, 70] },
    7: { steps: [4, 12], vel: [60, 55] },
    10: { steps: [0, 3, 8, 11], vel: [50, 40, 50, 40] },
  }),
  createPresetPattern("Techno", 16, 50, {
    0: { steps: [0, 4, 8, 12], vel: [127, 127, 127, 127] },
    6: { steps: [0,2,4,6,8,10,12,14], vel: [100,60,90,60,100,60,90,60] },
    7: { steps: [4, 10], vel: [80, 75] },
    2: { steps: [8], vel: [70] },
    11: { steps: [3, 7, 11, 15], vel: [40, 35, 40, 35] },
  }),
  createPresetPattern("Afrobeats", 16, 55, {
    0: { steps: [0, 5, 10], vel: [120, 90, 100] },
    1: { steps: [4, 12], vel: [110, 105] },
    6: { steps: [0,1,3,4,6,7,9,10,12,13,15], vel: [90,50,70,90,50,70,90,50,90,50,70] },
    10: { steps: [2, 6, 8, 14], vel: [80, 60, 70, 60] },
    11: { steps: [3, 7, 11, 15], vel: [50, 45, 50, 45] },
  }),
  createPresetPattern("Amapiano", 16, 50, {
    0: { steps: [0, 4, 8, 12], vel: [110, 100, 110, 100] },
    3: { steps: [2, 6, 10, 14], vel: [90, 70, 85, 70] },
    6: { steps: [0,2,4,6,8,10,12,14], vel: [70,40,60,40,70,40,60,40] },
    10: { steps: [3, 7, 11, 15], vel: [80, 60, 75, 60] },
  }),
  createPresetPattern("Synthwave", 16, 50, {
    0: { steps: [0, 4, 8, 12], vel: [120, 110, 120, 110] },
    1: { steps: [4, 12], vel: [127, 120] },
    4: { steps: [6, 14], vel: [80, 75] },
    6: { steps: [0, 2, 4, 6, 8, 10, 12, 14] },
    8: { steps: [0, 8], vel: [50, 45] },
  }),
  createPresetPattern("IDM Glitch", 16, 50, {
    0: { steps: [0, 3, 5, 8, 11, 13], vel: [127, 70, 90, 110, 60, 85] },
    1: { steps: [2, 7, 9, 14], vel: [100, 80, 110, 70] },
    6: { steps: [0,1,3,5,6,8,9,11,13,14], vel: [90,40,70,50,90,40,70,50,90,40] },
    10: { steps: [4, 10, 12], vel: [60, 50, 55] },
    11: { steps: [1, 6, 11], vel: [40, 50, 35] },
  }),
  createPresetPattern("Acoustic", 16, 56, {
    0: { steps: [0, 8], vel: [100, 90] },
    1: { steps: [4, 12], vel: [90, 85] },
    9: { steps: [0,2,4,6,8,10,12,14], vel: [70,50,65,50,70,50,65,50] },
    7: { steps: [6, 14], vel: [50, 45] },
    3: { steps: [10], vel: [60] },
  }),
  // ── New patterns with advanced features ──
  createPresetPattern("Garage 2-Step", 16, 54, {
    0: { steps: [0, 10], vel: [120, 100] },                    // Kick: sparse, off-grid
    1: { steps: [4, 12], vel: [110, 100] },                    // Snare: backbeat
    2: { steps: [7, 15], vel: [80, 70] },                      // Clap: shuffle
    6: { steps: [0,2,4,6,8,10,12,14], vel: [90,40,80,40,90,40,80,40] }, // HH: ghost dynamics
    7: { steps: [3, 11], vel: [60, 50] },                      // OH: offbeat
    10: { steps: [5, 13], vel: [50, 45] },                     // Perc: shaker
  }),
  createPresetPattern("Dub Techno", 16, 50, {
    0: { steps: [0, 4, 8, 12], vel: [110, 105, 110, 105] },   // Kick: steady four
    2: { steps: [4, 12], vel: [75, 70] },                      // Clap: soft backbeat
    9: { steps: [0,2,4,6,8,10,12,14], vel: [60,35,55,35,60,35,55,35] }, // Ride: subtle
    6: { steps: [2, 6, 10, 14], vel: [50, 40, 50, 40] },      // HH: sparse offbeats
    11: { steps: [3, 7, 11, 15], vel: [30, 25, 30, 25] },     // Perc2: rimshot ghost
  }),
  createPresetPattern("Broken Beat", 16, 52, {
    0: { steps: [0, 3, 6, 10, 13], vel: [127, 80, 110, 100, 75] }, // Kick: syncopated
    1: { steps: [4, 11], vel: [120, 100] },                    // Snare: offbeat accent
    6: { steps: [0,1,2,4,5,6,8,9,10,12,13,14], vel: [90,40,60,90,40,60,90,40,60,90,40,60] }, // HH: busy
    10: { steps: [2, 7, 14], vel: [70, 60, 65] },              // Perc: congas
    8: { steps: [0], vel: [40] },                               // Cymbal: ride bell
  }),
  createPresetPattern("Minimal House", 16, 51, {
    0: { steps: [0, 4, 8, 12], vel: [115, 110, 115, 110] },   // Kick: four on floor
    2: { steps: [4, 12], vel: [60, 55] },                      // Clap: soft
    6: { steps: [2, 6, 10, 14], vel: [80, 60, 80, 60] },      // HH: just offbeats
    10: { steps: [7], vel: [45] },                              // Perc: single hit
  }),
  createPresetPattern("Jersey Club", 16, 50, {
    0: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [127,70,110,70,127,70,110,70] }, // Kick: fast
    1: { steps: [4, 12], vel: [120, 115] },                    // Snare: hard
    2: { steps: [2, 6, 10, 14], vel: [100, 80, 100, 80] },    // Clap: offbeat stacks
    6: { steps: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], vel: [100,50,80,50,100,50,80,50,100,50,80,50,100,50,80,50] }, // HH: all 16ths
  }),
  createPresetPattern("Reggae One Drop", 16, 55, {
    0: { steps: [12], vel: [120] },                             // Kick: only on 3
    1: { steps: [12], vel: [110] },                             // Snare: stacks with kick
    9: { steps: [0,4,8,12], vel: [70,50,65,55] },              // Ride: steady
    6: { steps: [2, 6, 10, 14], vel: [60, 50, 60, 50] },      // HH: skank
    10: { steps: [0, 4, 8], vel: [55, 45, 50] },               // Perc: cross-stick
  }),
];
