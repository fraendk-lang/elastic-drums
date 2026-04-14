// ── Elastic Drum — Analog Filter Models ──
// Ladder (Moog-style 24dB/oct) + Steiner-Parker (multi-mode)

export type FilterModel = "lpf" | "ladder" | "steiner-lp" | "steiner-bp" | "steiner-hp";

export const FILTER_MODELS: { id: FilterModel; name: string; description: string }[] = [
  { id: "lpf",         name: "LPF 12dB",      description: "Standard Lowpass (clean)" },
  { id: "ladder",      name: "Ladder 24dB",    description: "Moog-style (warm, fat)" },
  { id: "steiner-lp",  name: "Steiner LP",     description: "Steiner-Parker Lowpass (aggressive)" },
  { id: "steiner-bp",  name: "Steiner BP",     description: "Steiner-Parker Bandpass (nasal)" },
  { id: "steiner-hp",  name: "Steiner HP",     description: "Steiner-Parker Highpass (thin, airy)" },
];

/**
 * Create a filter chain for the given model.
 * Returns { input, output } AudioNodes to connect in series.
 * Call `update(freq, res)` to modulate cutoff and resonance in real-time.
 */
export interface FilterChain {
  input: AudioNode;
  output: AudioNode;
  update: (freq: number, resonance: number, time: number) => void;
}

/**
 * Standard 12dB/oct lowpass — single BiquadFilter
 */
function createLPF(ctx: AudioContext): FilterChain {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2000;
  filter.Q.value = 2;

  return {
    input: filter,
    output: filter,
    update(freq, res, time) {
      filter.frequency.setTargetAtTime(freq, time, 0.01);
      filter.Q.setTargetAtTime(res * 20, time, 0.01); // 0-1 → 0-20 Q
    },
  };
}

/**
 * Moog Ladder Filter — 4 cascaded lowpass stages (24dB/oct)
 * Classic warm, fat analog sound with self-oscillation at high resonance
 */
function createLadder(ctx: AudioContext): FilterChain {
  // 4 cascaded 1-pole lowpass filters (each ~6dB/oct = total 24dB/oct)
  const stages: BiquadFilterNode[] = [];
  for (let i = 0; i < 4; i++) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2000;
    lp.Q.value = 0; // No resonance per stage — resonance comes from feedback
    stages.push(lp);
  }

  // Chain: stage0 → stage1 → stage2 → stage3
  stages[0]!.connect(stages[1]!);
  stages[1]!.connect(stages[2]!);
  stages[2]!.connect(stages[3]!);

  // Feedback path for resonance: output → gain (negative) → input
  // We simulate this by boosting Q on the last stage
  // (True analog feedback requires AudioWorklet, this is a practical approximation)

  return {
    input: stages[0]!,
    output: stages[3]!,
    update(freq, res, time) {
      // Set all 4 stages to the same cutoff
      for (const stage of stages) {
        stage.frequency.setTargetAtTime(freq, time, 0.01);
      }
      // Resonance: boost Q on last 2 stages for that Moog peak
      // res 0-1 maps to Q 0-25 (self-oscillation starts around Q=20)
      stages[2]!.Q.setTargetAtTime(res * 12, time, 0.01);
      stages[3]!.Q.setTargetAtTime(res * 25, time, 0.01);
    },
  };
}

/**
 * Steiner-Parker Filter — parallel multi-mode design
 * More aggressive and "dirty" than Moog ladder.
 * LP/BP/HP modes using parallel BiquadFilter configuration
 */
function createSteiner(ctx: AudioContext, mode: BiquadFilterType): FilterChain {
  // Steiner-Parker uses 2 state-variable filter stages in series
  // Approximation: 2 cascaded biquads with the chosen mode
  const stage1 = ctx.createBiquadFilter();
  const stage2 = ctx.createBiquadFilter();
  stage1.type = mode;
  stage2.type = mode;
  stage1.frequency.value = 2000;
  stage2.frequency.value = 2000;
  stage1.Q.value = 4;
  stage2.Q.value = 2;

  // Saturation node (overdrive characteristic of Steiner-Parker)
  const drive = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 128) - 1;
    // Soft clipping tanh curve for analog warmth
    curve[i] = Math.tanh(x * 1.5);
  }
  drive.curve = curve;
  drive.oversample = "2x";

  // Chain: input → stage1 → drive → stage2 → output
  stage1.connect(drive);
  drive.connect(stage2);

  return {
    input: stage1,
    output: stage2,
    update(freq, res, time) {
      stage1.frequency.setTargetAtTime(freq, time, 0.01);
      stage2.frequency.setTargetAtTime(freq, time, 0.01);
      // Steiner resonance is more aggressive — maps 0-1 to Q 1-30
      const q = 1 + res * 29;
      stage1.Q.setTargetAtTime(q, time, 0.01);
      stage2.Q.setTargetAtTime(q * 0.5, time, 0.01);
    },
  };
}

/**
 * Factory: create a filter chain for the given model
 */
export function createFilterChain(ctx: AudioContext, model: FilterModel): FilterChain {
  switch (model) {
    case "lpf":         return createLPF(ctx);
    case "ladder":      return createLadder(ctx);
    case "steiner-lp":  return createSteiner(ctx, "lowpass");
    case "steiner-bp":  return createSteiner(ctx, "bandpass");
    case "steiner-hp":  return createSteiner(ctx, "highpass");
    default:            return createLPF(ctx);
  }
}
