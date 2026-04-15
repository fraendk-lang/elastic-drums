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
 * Classic warm, fat analog sound with self-oscillation at high resonance.
 *
 * Improved: feedback gain node simulates analog resonance feedback path,
 * thermal drift on cutoff per stage for analog character,
 * and compensation gain to prevent volume loss at high resonance.
 */
function createLadder(ctx: AudioContext): FilterChain {
  // 4 cascaded 1-pole lowpass filters (each ~6dB/oct = total 24dB/oct)
  const stages: BiquadFilterNode[] = [];
  // Slight cutoff offset per stage simulates component mismatch in analog circuits
  const stageOffsets = [1.0, 0.98, 1.02, 0.99];
  for (let i = 0; i < 4; i++) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2000;
    lp.Q.value = 0.5; // Slight Q per stage for warmer rolloff
    stages.push(lp);
  }

  // Chain: stage0 → stage1 → stage2 → stage3
  stages[0]!.connect(stages[1]!);
  stages[1]!.connect(stages[2]!);
  stages[2]!.connect(stages[3]!);

  // Feedback path: output → waveshaper (soft-clip) → gain → input
  // This creates the characteristic Moog self-oscillation and warmth
  const feedbackGain = ctx.createGain();
  feedbackGain.gain.value = 0; // Controlled by resonance

  // Saturation in the feedback path (critical for authentic Moog character)
  const feedbackSat = ctx.createWaveShaper();
  const fbCurve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 512 - 1) * 2;
    fbCurve[i] = Math.tanh(x); // Soft-clip prevents runaway self-oscillation
  }
  feedbackSat.curve = fbCurve;
  feedbackSat.oversample = "2x";

  // Resonance compensation: boosts signal to counteract volume loss
  const compensationGain = ctx.createGain();
  compensationGain.gain.value = 1.0;

  // Feedback loop: stage3 → feedbackSat → feedbackGain → stage0
  stages[3]!.connect(feedbackSat);
  feedbackSat.connect(feedbackGain);
  feedbackGain.connect(stages[0]!);

  // Output goes through compensation
  stages[3]!.connect(compensationGain);

  return {
    input: stages[0]!,
    output: compensationGain,
    update(freq, res, time) {
      // Set all 4 stages with slight analog-style offsets
      for (let i = 0; i < 4; i++) {
        stages[i]!.frequency.setTargetAtTime(freq * stageOffsets[i]!, time, 0.005);
      }
      // Gentle Q distribution — keeps warmth without harsh resonance peaks
      const baseQ = 0.5 + res * 1.2;
      stages[0]!.Q.setTargetAtTime(baseQ * 0.3, time, 0.005);
      stages[1]!.Q.setTargetAtTime(baseQ * 0.5, time, 0.005);
      stages[2]!.Q.setTargetAtTime(baseQ * 0.7, time, 0.005);
      stages[3]!.Q.setTargetAtTime(baseQ * 1.0, time, 0.005);

      // Feedback: gentle warmth, not screaming self-oscillation
      // res 0-1 maps to 0-1.2 feedback (self-oscillation would be ~3+, we stay well below)
      feedbackGain.gain.setTargetAtTime(res * 1.2, time, 0.005);

      // Mild compensation for volume loss at higher resonance
      compensationGain.gain.setTargetAtTime(1.0 + res * 0.25, time, 0.005);
    },
  };
}

/**
 * Steiner-Parker Filter — parallel multi-mode design
 * More aggressive and "dirty" than Moog ladder.
 * LP/BP/HP modes using parallel BiquadFilter configuration
 */
function createSteiner(ctx: AudioContext, mode: BiquadFilterType): FilterChain {
  // Steiner-Parker: 2 state-variable stages with inter-stage saturation.
  // The Steiner circuit is known for its aggressive, "dirty" character
  // that breaks up beautifully at high resonance.
  const stage1 = ctx.createBiquadFilter();
  const stage2 = ctx.createBiquadFilter();
  stage1.type = mode;
  stage2.type = mode;
  stage1.frequency.value = 2000;
  stage2.frequency.value = 2000;
  stage1.Q.value = 4;
  stage2.Q.value = 2;

  // Inter-stage saturation (core Steiner-Parker character)
  const drive = ctx.createWaveShaper();
  const curve = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) {
    const x = (i / 1024) - 1;
    // Asymmetric soft-clip: positive half clips harder → even harmonics (tube-like)
    if (x >= 0) {
      curve[i] = Math.tanh(x * 2.0) * 0.9;
    } else {
      curve[i] = Math.tanh(x * 1.4) * 0.95;
    }
  }
  drive.curve = curve;
  drive.oversample = "4x";

  // Pre-drive gain to push into saturation harder at high resonance
  const preGain = ctx.createGain();
  preGain.gain.value = 1.0;

  // Chain: input → stage1 → preGain → drive → stage2 → output
  stage1.connect(preGain);
  preGain.connect(drive);
  drive.connect(stage2);

  return {
    input: stage1,
    output: stage2,
    update(freq, res, time) {
      // Slight frequency offset between stages for thicker sound
      stage1.frequency.setTargetAtTime(freq * 1.01, time, 0.005);
      stage2.frequency.setTargetAtTime(freq * 0.99, time, 0.005);
      // Steiner resonance is more aggressive — maps 0-1 to Q 1-30
      const q = 1 + res * 29;
      stage1.Q.setTargetAtTime(q, time, 0.005);
      stage2.Q.setTargetAtTime(q * 0.6, time, 0.005);
      // Push pre-gain harder with resonance for increasing grit
      preGain.gain.setTargetAtTime(1.0 + res * 1.5, time, 0.005);
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
