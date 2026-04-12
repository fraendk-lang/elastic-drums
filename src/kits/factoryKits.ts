/**
 * Factory Kit Library — 24 Drum Kits across 12 Genres
 *
 * Each kit tunes all 12 voices for a specific sonic character.
 * Parameters control the VA synthesis engine directly.
 */

import type { DrumKit } from "./KitManager";

export const FACTORY_KITS: DrumKit[] = [

  // ═══════════════════════════════════════════════════════
  // 808 CLASSICS
  // ═══════════════════════════════════════════════════════

  {
    id: "808-classic", name: "808 Classic", category: "808",
    tags: ["boom-bap", "hip-hop", "classic"], author: "Factory", bpmRange: [80, 100],
    voices: {
      0: { tune: 48, decay: 600, click: 40, drive: 25, sub: 70, pitch: 45 },
      1: { tune: 180, decay: 200, tone: 50, snap: 65, body: 55 },
      2: { decay: 350, tone: 1800, spread: 50, level: 100 },
      3: { tune: 100, decay: 300 }, 4: { tune: 140, decay: 250 }, 5: { tune: 200, decay: 200 },
      6: { tune: 330, decay: 45 }, 7: { tune: 330, decay: 250 },
      8: { tune: 380, decay: 800 }, 9: { tune: 480, decay: 800 },
      10: { tune: 800, decay: 120 }, 11: { tune: 1200, decay: 100 },
    },
    pattern: { length: 16, swing: 54, tracks: {
      0: { steps: [0, 6, 10], vel: [127, 90, 110] },
      1: { steps: [4, 12], vel: [120, 110] },
      6: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [100, 60, 80, 60, 100, 60, 80, 60] },
    }},
  },

  {
    id: "808-deep", name: "808 Deep Sub", category: "808",
    tags: ["sub", "bass", "deep"], author: "Factory", bpmRange: [70, 90],
    voices: {
      0: { tune: 38, decay: 900, click: 20, drive: 15, sub: 90, pitch: 40 },
      1: { tune: 160, decay: 180, tone: 40, snap: 50, body: 70 },
      2: { decay: 400, tone: 1500, spread: 60, level: 90 },
      3: { tune: 80, decay: 350 }, 4: { tune: 110, decay: 300 }, 5: { tune: 160, decay: 250 },
      6: { tune: 300, decay: 40 }, 7: { tune: 300, decay: 280 },
      8: { tune: 350, decay: 900 }, 9: { tune: 450, decay: 900 },
      10: { tune: 600, decay: 150 }, 11: { tune: 900, decay: 130 },
    },
    pattern: { length: 16, swing: 56, tracks: {
      0: { steps: [0, 10], vel: [127, 100] },
      1: { steps: [4, 12] },
      6: { steps: [0, 4, 8, 12], vel: [80, 60, 80, 60] },
    }},
  },

  {
    id: "808-distorted", name: "808 Distorted", category: "808",
    tags: ["distorted", "hard", "aggressive"], author: "Factory", bpmRange: [60, 80],
    voices: {
      0: { tune: 42, decay: 1100, click: 60, drive: 80, sub: 60, pitch: 50 },
      1: { tune: 200, decay: 150, tone: 60, snap: 80, body: 40 },
      2: { decay: 250, tone: 2200, spread: 40, level: 120 },
      3: { tune: 90, decay: 200 }, 4: { tune: 130, decay: 180 }, 5: { tune: 180, decay: 150 },
      6: { tune: 350, decay: 35 }, 7: { tune: 350, decay: 200 },
      8: { tune: 400, decay: 600 }, 9: { tune: 500, decay: 600 },
      10: { tune: 1000, decay: 80 }, 11: { tune: 1500, decay: 70 },
    },
  },

  // ═══════════════════════════════════════════════════════
  // 909 / HOUSE / TECHNO
  // ═══════════════════════════════════════════════════════

  {
    id: "909-house", name: "909 House", category: "909",
    tags: ["house", "classic", "four-on-floor"], author: "Factory", bpmRange: [118, 128],
    voices: {
      0: { tune: 55, decay: 450, click: 55, drive: 30, sub: 40, pitch: 48 },
      1: { tune: 190, decay: 220, tone: 55, snap: 70, body: 50 },
      2: { decay: 300, tone: 2000, spread: 45, level: 105 },
      3: { tune: 110, decay: 280 }, 4: { tune: 150, decay: 230 }, 5: { tune: 210, decay: 190 },
      6: { tune: 340, decay: 50 }, 7: { tune: 340, decay: 220 },
      8: { tune: 390, decay: 700 }, 9: { tune: 500, decay: 700 },
      10: { tune: 900, decay: 100 }, 11: { tune: 1300, decay: 90 },
    },
    pattern: { length: 16, swing: 50, tracks: {
      0: { steps: [0, 4, 8, 12], vel: [127, 120, 127, 120] },
      2: { steps: [4, 12], vel: [110, 100] },
      6: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [110, 70, 100, 70, 110, 70, 100, 70] },
      7: { steps: [2, 6, 10, 14], vel: [60, 80, 60, 80] },
    }},
  },

  {
    id: "909-techno", name: "909 Techno", category: "909",
    tags: ["techno", "minimal", "hard"], author: "Factory", bpmRange: [128, 140],
    voices: {
      0: { tune: 58, decay: 380, click: 65, drive: 45, sub: 30, pitch: 52 },
      1: { tune: 200, decay: 180, tone: 60, snap: 80, body: 35 },
      2: { decay: 280, tone: 2200, spread: 35, level: 110 },
      3: { tune: 120, decay: 200 }, 4: { tune: 165, decay: 170 }, 5: { tune: 230, decay: 140 },
      6: { tune: 360, decay: 40 }, 7: { tune: 360, decay: 180 },
      8: { tune: 420, decay: 600 }, 9: { tune: 520, decay: 600 },
      10: { tune: 1100, decay: 60 }, 11: { tune: 1600, decay: 50 },
    },
    pattern: { length: 16, swing: 50, tracks: {
      0: { steps: [0, 4, 8, 12], vel: [127, 127, 127, 127] },
      6: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [100, 60, 90, 60, 100, 60, 90, 60] },
      7: { steps: [4, 10], vel: [80, 75] },
    }},
  },

  {
    id: "deep-house", name: "Deep House", category: "909",
    tags: ["deep", "warm", "organic"], author: "Factory", bpmRange: [118, 124],
    voices: {
      0: { tune: 50, decay: 500, click: 35, drive: 20, sub: 55, pitch: 42 },
      1: { tune: 170, decay: 250, tone: 45, snap: 55, body: 65 },
      2: { decay: 380, tone: 1600, spread: 55, level: 90 },
      3: { tune: 95, decay: 320 }, 4: { tune: 135, decay: 270 }, 5: { tune: 195, decay: 220 },
      6: { tune: 310, decay: 55 }, 7: { tune: 310, decay: 260 },
      8: { tune: 370, decay: 900 }, 9: { tune: 460, decay: 900 },
      10: { tune: 700, decay: 140 }, 11: { tune: 1100, decay: 120 },
    },
    pattern: { length: 16, swing: 52, tracks: {
      0: { steps: [0, 4, 8, 12], vel: [120, 115, 120, 115] },
      2: { steps: [4, 12], vel: [90, 85] },
      6: { steps: [2, 6, 10, 14] },
      10: { steps: [0, 3, 8, 11], vel: [50, 40, 50, 40] },
    }},
  },

  // ═══════════════════════════════════════════════════════
  // TRAP / HIP HOP
  // ═══════════════════════════════════════════════════════

  {
    id: "trap-hard", name: "Trap Hard", category: "Trap",
    tags: ["trap", "808", "hard", "sub-bass"], author: "Factory", bpmRange: [130, 160],
    voices: {
      0: { tune: 35, decay: 1200, click: 50, drive: 60, sub: 85, pitch: 38 },
      1: { tune: 210, decay: 170, tone: 65, snap: 85, body: 30 },
      2: { decay: 250, tone: 2500, spread: 30, level: 115 },
      3: { tune: 85, decay: 200 }, 4: { tune: 120, decay: 170 }, 5: { tune: 170, decay: 140 },
      6: { tune: 370, decay: 30 }, 7: { tune: 370, decay: 150 },
      8: { tune: 430, decay: 500 }, 9: { tune: 530, decay: 500 },
      10: { tune: 1200, decay: 50 }, 11: { tune: 1800, decay: 40 },
    },
    pattern: { length: 16, swing: 50, tracks: {
      0: { steps: [0, 3, 7, 10, 14], vel: [127, 100, 110, 90, 100] },
      1: { steps: [4, 12] },
      6: { steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
           vel: [100, 50, 70, 50, 100, 50, 70, 50, 100, 50, 70, 50, 100, 50, 70, 50] },
    }},
  },

  {
    id: "trap-melodic", name: "Trap Melodic", category: "Trap",
    tags: ["melodic", "emotional", "soft"], author: "Factory", bpmRange: [130, 150],
    voices: {
      0: { tune: 40, decay: 800, click: 30, drive: 35, sub: 75, pitch: 42 },
      1: { tune: 185, decay: 200, tone: 50, snap: 60, body: 50 },
      2: { decay: 320, tone: 1800, spread: 50, level: 95 },
      3: { tune: 90, decay: 280 }, 4: { tune: 130, decay: 230 }, 5: { tune: 185, decay: 190 },
      6: { tune: 320, decay: 35 }, 7: { tune: 320, decay: 200 },
      8: { tune: 380, decay: 700 }, 9: { tune: 470, decay: 700 },
      10: { tune: 900, decay: 100 }, 11: { tune: 1400, decay: 80 },
    },
  },

  {
    id: "lofi-hiphop", name: "Lo-Fi Hip Hop", category: "Trap",
    tags: ["lofi", "chill", "dusty", "vinyl"], author: "Factory", bpmRange: [75, 95],
    voices: {
      0: { tune: 52, decay: 500, click: 25, drive: 15, sub: 50, pitch: 40 },
      1: { tune: 165, decay: 230, tone: 40, snap: 45, body: 70 },
      2: { decay: 400, tone: 1400, spread: 60, level: 85 },
      3: { tune: 95, decay: 350 }, 4: { tune: 130, decay: 300 }, 5: { tune: 180, decay: 250 },
      6: { tune: 290, decay: 50 }, 7: { tune: 290, decay: 280 },
      8: { tune: 350, decay: 1000 }, 9: { tune: 440, decay: 1000 },
      10: { tune: 600, decay: 160 }, 11: { tune: 950, decay: 140 },
    },
    pattern: { length: 16, swing: 58, tracks: {
      0: { steps: [0, 5, 10], vel: [110, 80, 95] },
      1: { steps: [4, 12], vel: [100, 90] },
      6: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [80, 40, 65, 40, 80, 40, 65, 40] },
    }},
  },

  // ═══════════════════════════════════════════════════════
  // DRUM & BASS
  // ═══════════════════════════════════════════════════════

  {
    id: "dnb-neurofunk", name: "DnB Neurofunk", category: "DnB",
    tags: ["neurofunk", "dark", "rolling"], author: "Factory", bpmRange: [170, 180],
    voices: {
      0: { tune: 55, decay: 350, click: 70, drive: 50, sub: 35, pitch: 55 },
      1: { tune: 200, decay: 160, tone: 65, snap: 85, body: 30 },
      2: { decay: 200, tone: 2400, spread: 30, level: 110 },
      3: { tune: 115, decay: 180 }, 4: { tune: 160, decay: 150 }, 5: { tune: 220, decay: 120 },
      6: { tune: 380, decay: 25 }, 7: { tune: 380, decay: 150 },
      8: { tune: 440, decay: 500 }, 9: { tune: 540, decay: 500 },
      10: { tune: 1400, decay: 40 }, 11: { tune: 2000, decay: 35 },
    },
    pattern: { length: 16, swing: 50, tracks: {
      0: { steps: [0, 4, 9, 10], vel: [127, 100, 110, 80] },
      1: { steps: [4, 10, 12], vel: [120, 100, 110] },
      6: { steps: [0, 2, 4, 5, 6, 8, 10, 12, 13, 14] },
    }},
  },

  {
    id: "dnb-liquid", name: "DnB Liquid", category: "DnB",
    tags: ["liquid", "smooth", "melodic"], author: "Factory", bpmRange: [170, 176],
    voices: {
      0: { tune: 50, decay: 400, click: 45, drive: 25, sub: 45, pitch: 45 },
      1: { tune: 185, decay: 190, tone: 50, snap: 65, body: 50 },
      2: { decay: 280, tone: 1800, spread: 50, level: 100 },
      3: { tune: 100, decay: 250 }, 4: { tune: 145, decay: 210 }, 5: { tune: 200, decay: 180 },
      6: { tune: 340, decay: 35 }, 7: { tune: 340, decay: 200 },
      8: { tune: 400, decay: 700 }, 9: { tune: 500, decay: 700 },
      10: { tune: 1000, decay: 80 }, 11: { tune: 1500, decay: 60 },
    },
  },

  // ═══════════════════════════════════════════════════════
  // ELECTRO / EBM
  // ═══════════════════════════════════════════════════════

  {
    id: "electro-classic", name: "Electro Classic", category: "Electro",
    tags: ["electro", "breakdance", "kraftwerk"], author: "Factory", bpmRange: [110, 130],
    voices: {
      0: { tune: 52, decay: 400, click: 60, drive: 35, sub: 45, pitch: 50 },
      1: { tune: 195, decay: 190, tone: 55, snap: 75, body: 45 },
      2: { decay: 300, tone: 2100, spread: 40, level: 105 },
      3: { tune: 105, decay: 260 }, 4: { tune: 148, decay: 220 }, 5: { tune: 205, decay: 180 },
      6: { tune: 350, decay: 40 }, 7: { tune: 350, decay: 190 },
      8: { tune: 410, decay: 650 }, 9: { tune: 510, decay: 650 },
      10: { tune: 1100, decay: 70 }, 11: { tune: 1700, decay: 55 },
    },
    pattern: { length: 16, swing: 50, tracks: {
      0: { steps: [0, 3, 8, 11], vel: [127, 100, 120, 95] },
      1: { steps: [4, 12] },
      2: { steps: [7, 15], vel: [80, 90] },
      6: { steps: [0, 2, 4, 6, 8, 10, 12, 14] },
    }},
  },

  {
    id: "ebm-industrial", name: "EBM Industrial", category: "Electro",
    tags: ["industrial", "dark", "ebm", "harsh"], author: "Factory", bpmRange: [120, 140],
    voices: {
      0: { tune: 45, decay: 350, click: 80, drive: 70, sub: 25, pitch: 55 },
      1: { tune: 220, decay: 140, tone: 70, snap: 90, body: 25 },
      2: { decay: 220, tone: 2800, spread: 25, level: 130 },
      3: { tune: 90, decay: 180 }, 4: { tune: 125, decay: 150 }, 5: { tune: 175, decay: 120 },
      6: { tune: 400, decay: 30 }, 7: { tune: 400, decay: 160 },
      8: { tune: 450, decay: 500 }, 9: { tune: 550, decay: 500 },
      10: { tune: 1500, decay: 45 }, 11: { tune: 2200, decay: 35 },
    },
  },

  // ═══════════════════════════════════════════════════════
  // AFROBEATS / AMAPIANO / REGGAETON
  // ═══════════════════════════════════════════════════════

  {
    id: "afrobeats", name: "Afrobeats", category: "World",
    tags: ["afrobeats", "nigeria", "dancehall"], author: "Factory", bpmRange: [95, 115],
    voices: {
      0: { tune: 50, decay: 450, click: 40, drive: 20, sub: 50, pitch: 44 },
      1: { tune: 175, decay: 210, tone: 50, snap: 60, body: 55 },
      2: { decay: 320, tone: 1700, spread: 50, level: 100 },
      3: { tune: 95, decay: 300 }, 4: { tune: 135, decay: 260 }, 5: { tune: 190, decay: 220 },
      6: { tune: 320, decay: 45 }, 7: { tune: 320, decay: 230 },
      8: { tune: 380, decay: 750 }, 9: { tune: 470, decay: 750 },
      10: { tune: 750, decay: 130 }, 11: { tune: 1100, decay: 110 },
    },
    pattern: { length: 16, swing: 55, tracks: {
      0: { steps: [0, 5, 10], vel: [120, 90, 100] },
      1: { steps: [4, 12] },
      6: { steps: [0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15] },
      10: { steps: [2, 6, 8, 14], vel: [80, 60, 70, 60] },
    }},
  },

  {
    id: "amapiano", name: "Amapiano", category: "World",
    tags: ["amapiano", "south-africa", "log-drum"], author: "Factory", bpmRange: [110, 120],
    voices: {
      0: { tune: 48, decay: 480, click: 30, drive: 15, sub: 55, pitch: 42 },
      1: { tune: 170, decay: 200, tone: 45, snap: 55, body: 60 },
      2: { decay: 350, tone: 1600, spread: 55, level: 95 },
      3: { tune: 88, decay: 350 }, 4: { tune: 125, decay: 300 }, 5: { tune: 175, decay: 250 },
      6: { tune: 310, decay: 50 }, 7: { tune: 310, decay: 240 },
      8: { tune: 370, decay: 800 }, 9: { tune: 460, decay: 800 },
      10: { tune: 650, decay: 150 }, 11: { tune: 1000, decay: 130 },
    },
    pattern: { length: 16, swing: 50, tracks: {
      0: { steps: [0, 4, 8, 12] },
      3: { steps: [2, 6, 10, 14], vel: [90, 70, 85, 70] },
      6: { steps: [0, 2, 4, 6, 8, 10, 12, 14] },
      10: { steps: [3, 7, 11, 15], vel: [80, 60, 75, 60] },
    }},
  },

  {
    id: "reggaeton", name: "Reggaeton Dembow", category: "World",
    tags: ["reggaeton", "dembow", "latin"], author: "Factory", bpmRange: [88, 100],
    voices: {
      0: { tune: 50, decay: 500, click: 45, drive: 25, sub: 55, pitch: 45 },
      1: { tune: 185, decay: 190, tone: 55, snap: 70, body: 45 },
      2: { decay: 300, tone: 1900, spread: 45, level: 105 },
      3: { tune: 100, decay: 280 }, 4: { tune: 140, decay: 240 }, 5: { tune: 195, decay: 200 },
      6: { tune: 330, decay: 45 }, 7: { tune: 330, decay: 220 },
      8: { tune: 390, decay: 700 }, 9: { tune: 480, decay: 700 },
      10: { tune: 800, decay: 110 }, 11: { tune: 1200, decay: 95 },
    },
    pattern: { length: 16, swing: 50, tracks: {
      0: { steps: [0, 7], vel: [127, 100] },
      1: { steps: [3, 7, 11, 15], vel: [120, 80, 110, 80] },
      6: { steps: [0, 2, 4, 6, 8, 10, 12, 14] },
    }},
  },

  // ═══════════════════════════════════════════════════════
  // AMBIENT / EXPERIMENTAL
  // ═══════════════════════════════════════════════════════

  {
    id: "ambient-organic", name: "Ambient Organic", category: "Ambient",
    tags: ["ambient", "organic", "soft", "texture"], author: "Factory", bpmRange: [60, 90],
    voices: {
      0: { tune: 42, decay: 700, click: 15, drive: 10, sub: 65, pitch: 35 },
      1: { tune: 150, decay: 300, tone: 35, snap: 35, body: 75 },
      2: { decay: 500, tone: 1200, spread: 70, level: 80 },
      3: { tune: 80, decay: 450 }, 4: { tune: 115, decay: 400 }, 5: { tune: 165, decay: 350 },
      6: { tune: 280, decay: 70 }, 7: { tune: 280, decay: 350 },
      8: { tune: 330, decay: 1200 }, 9: { tune: 420, decay: 1200 },
      10: { tune: 500, decay: 200 }, 11: { tune: 800, decay: 180 },
    },
  },

  {
    id: "idm-glitch", name: "IDM Glitch", category: "Ambient",
    tags: ["idm", "glitch", "experimental", "autechre"], author: "Factory", bpmRange: [90, 160],
    voices: {
      0: { tune: 60, decay: 300, click: 75, drive: 55, sub: 20, pitch: 60 },
      1: { tune: 230, decay: 120, tone: 70, snap: 90, body: 20 },
      2: { decay: 180, tone: 3000, spread: 20, level: 120 },
      3: { tune: 130, decay: 150 }, 4: { tune: 180, decay: 120 }, 5: { tune: 250, decay: 100 },
      6: { tune: 400, decay: 20 }, 7: { tune: 400, decay: 120 },
      8: { tune: 480, decay: 400 }, 9: { tune: 580, decay: 400 },
      10: { tune: 1800, decay: 30 }, 11: { tune: 2500, decay: 25 },
    },
    pattern: { length: 16, swing: 50, tracks: {
      0: { steps: [0, 3, 5, 8, 11, 13], vel: [127, 70, 90, 110, 60, 85] },
      1: { steps: [2, 7, 9, 14], vel: [100, 80, 110, 70] },
      6: { steps: [0, 1, 3, 5, 6, 8, 9, 11, 13, 14] },
    }},
  },

  // ═══════════════════════════════════════════════════════
  // SYNTHWAVE / RETRO
  // ═══════════════════════════════════════════════════════

  {
    id: "synthwave-80s", name: "Synthwave 80s", category: "Retro",
    tags: ["synthwave", "80s", "retro", "gated-reverb"], author: "Factory", bpmRange: [100, 130],
    voices: {
      0: { tune: 55, decay: 420, click: 50, drive: 30, sub: 40, pitch: 48 },
      1: { tune: 195, decay: 240, tone: 50, snap: 65, body: 55 },
      2: { decay: 350, tone: 1900, spread: 50, level: 100 },
      3: { tune: 108, decay: 280 }, 4: { tune: 150, decay: 240 }, 5: { tune: 210, decay: 200 },
      6: { tune: 340, decay: 45 }, 7: { tune: 340, decay: 220 },
      8: { tune: 400, decay: 750 }, 9: { tune: 500, decay: 750 },
      10: { tune: 900, decay: 100 }, 11: { tune: 1300, decay: 85 },
    },
    pattern: { length: 16, swing: 50, tracks: {
      0: { steps: [0, 4, 8, 12] },
      1: { steps: [4, 12], vel: [127, 120] },
      6: { steps: [0, 2, 4, 6, 8, 10, 12, 14] },
      8: { steps: [0, 8], vel: [50, 45] },
    }},
  },

  {
    id: "italo-disco", name: "Italo Disco", category: "Retro",
    tags: ["italo", "disco", "euro", "dance"], author: "Factory", bpmRange: [118, 135],
    voices: {
      0: { tune: 52, decay: 380, click: 55, drive: 25, sub: 45, pitch: 46 },
      1: { tune: 185, decay: 200, tone: 55, snap: 70, body: 50 },
      2: { decay: 280, tone: 2000, spread: 45, level: 105 },
      3: { tune: 100, decay: 260 }, 4: { tune: 140, decay: 220 }, 5: { tune: 200, decay: 185 },
      6: { tune: 345, decay: 42 }, 7: { tune: 345, decay: 210 },
      8: { tune: 400, decay: 700 }, 9: { tune: 500, decay: 700 },
      10: { tune: 850, decay: 95 }, 11: { tune: 1250, decay: 80 },
    },
  },

  // ═══════════════════════════════════════════════════════
  // ACOUSTIC / JAZZ
  // ═══════════════════════════════════════════════════════

  {
    id: "acoustic-kit", name: "Acoustic Kit", category: "Acoustic",
    tags: ["acoustic", "jazz", "brush", "natural"], author: "Factory", bpmRange: [80, 140],
    voices: {
      0: { tune: 60, decay: 350, click: 35, drive: 10, sub: 30, pitch: 40 },
      1: { tune: 175, decay: 250, tone: 45, snap: 50, body: 70 },
      2: { decay: 400, tone: 1500, spread: 60, level: 85 },
      3: { tune: 100, decay: 350 }, 4: { tune: 145, decay: 300 }, 5: { tune: 200, decay: 260 },
      6: { tune: 300, decay: 55 }, 7: { tune: 300, decay: 280 },
      8: { tune: 360, decay: 1000 }, 9: { tune: 450, decay: 1000 },
      10: { tune: 600, decay: 170 }, 11: { tune: 900, decay: 150 },
    },
    pattern: { length: 16, swing: 56, tracks: {
      0: { steps: [0, 8], vel: [100, 90] },
      1: { steps: [4, 12], vel: [90, 85] },
      9: { steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [70, 50, 65, 50, 70, 50, 65, 50] },
    }},
  },

  {
    id: "jazz-brush", name: "Jazz Brush", category: "Acoustic",
    tags: ["jazz", "brush", "soft", "swing"], author: "Factory", bpmRange: [100, 180],
    voices: {
      0: { tune: 55, decay: 300, click: 20, drive: 5, sub: 35, pitch: 38 },
      1: { tune: 160, decay: 280, tone: 35, snap: 40, body: 75 },
      2: { decay: 450, tone: 1300, spread: 65, level: 80 },
      3: { tune: 90, decay: 400 }, 4: { tune: 128, decay: 350 }, 5: { tune: 185, decay: 300 },
      6: { tune: 280, decay: 60 }, 7: { tune: 280, decay: 300 },
      8: { tune: 340, decay: 1100 }, 9: { tune: 430, decay: 1100 },
      10: { tune: 550, decay: 190 }, 11: { tune: 850, decay: 170 },
    },
  },

  // ═══════════════════════════════════════════════════════
  // CINEMATIC
  // ═══════════════════════════════════════════════════════

  {
    id: "cinematic-impact", name: "Cinematic Impact", category: "Cinematic",
    tags: ["cinematic", "impact", "boom", "trailer"], author: "Factory", bpmRange: [60, 100],
    voices: {
      0: { tune: 35, decay: 1200, click: 30, drive: 40, sub: 80, pitch: 35 },
      1: { tune: 140, decay: 350, tone: 40, snap: 45, body: 70 },
      2: { decay: 600, tone: 1200, spread: 70, level: 90 },
      3: { tune: 70, decay: 500 }, 4: { tune: 100, decay: 450 }, 5: { tune: 150, decay: 400 },
      6: { tune: 260, decay: 80 }, 7: { tune: 260, decay: 400 },
      8: { tune: 320, decay: 1500 }, 9: { tune: 400, decay: 1500 },
      10: { tune: 400, decay: 250 }, 11: { tune: 700, decay: 220 },
    },
  },

  {
    id: "cinematic-tension", name: "Cinematic Tension", category: "Cinematic",
    tags: ["tension", "suspense", "dark", "score"], author: "Factory", bpmRange: [80, 120],
    voices: {
      0: { tune: 30, decay: 800, click: 15, drive: 20, sub: 90, pitch: 30 },
      1: { tune: 130, decay: 400, tone: 30, snap: 35, body: 80 },
      2: { decay: 700, tone: 1000, spread: 75, level: 80 },
      3: { tune: 65, decay: 550 }, 4: { tune: 95, decay: 500 }, 5: { tune: 140, decay: 450 },
      6: { tune: 250, decay: 90 }, 7: { tune: 250, decay: 450 },
      8: { tune: 300, decay: 2000 }, 9: { tune: 380, decay: 2000 },
      10: { tune: 350, decay: 300 }, 11: { tune: 600, decay: 270 },
    },
  },
];

// Categories for the kit browser
export const KIT_CATEGORIES = [
  "All", "808", "909", "Trap", "DnB", "Electro", "World", "Ambient", "Retro", "Acoustic", "Cinematic",
];
